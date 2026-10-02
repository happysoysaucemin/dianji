/* 记电 · 界面层：DOM 渲染与事件绑定
   - 登录采用弹窗形态：未登录时卡片里只有一个「登录」按钮，点开弹窗；
     登录后卡片里直接显示用户信息（身份由密码解析得出，无需用户选择）。
   - 凭据来自 DJ.auth（内存 / 会话级），本层只负责取用，不做任何持久化。
   - 每条记录会带上：上传者(by)、上传时间戳(uploaded_at)、公网 IP(ip_public)、内网地址(ip_local)。 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};
  var C = DJ.config;
  var U = DJ.calc;
  var P = DJ.parse;

  var state = { data: null, enr: [], rows: [], pref: {}, stats: null, busy: false, netinfo: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return DJ.chart.esc(s); }
  function fmtNum(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return Number(n).toFixed(digits == null ? 2 : digits).replace(/\.00$/, '');
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  }
  function setHint(id, text, ok) {
    var el = $(id);
    if (!el) return;
    el.className = 'dj-hint' + (ok === true ? ' dj-ok' : ok === false ? ' dj-warn' : '');
    el.textContent = text || '';
  }
  function shortTime(iso) {
    return String(iso || '').slice(5, 16).replace('T', ' ');
  }
  function deviceLabel(rec) {
    if (rec.device && DJ.device) return DJ.device.label(rec.device);
    if (rec.device && rec.device.ua) return String(rec.device.ua).slice(0, 28) + '…';
    return '';
  }
  function loggedIn() {
    var c = DJ.auth.current();
    return !!(c && c.token);
  }
  function currentBy() {
    var c = DJ.auth.current();
    return c ? (c.by || '未署名') : '';
  }

  // ---------------- 上传环境（上传者 / 时间戳 / IP） ----------------
  function envSnapshot() {
    if (state.netinfo) return Promise.resolve(state.netinfo);
    if (!DJ.netinfo) return Promise.resolve(null);
    return DJ.netinfo.cached().then(function (i) {
      state.netinfo = i;
      renderEnvHint();
      return i;
    }).catch(function () { return null; });
  }

  function renderEnvHint() {
    if (!$('envHint')) return;
    var i = state.netinfo;
    if (!i) { $('envHint').textContent = ''; return; }
    var bits = [];
    if (i.public) bits.push('本机公网 IP：' + i.public);
    if (i.local) {
      bits.push('本地地址：' + i.local +
        (i.localNote === 'webrtc' ? '' : '（mDNS 混淆名 —— 浏览器已屏蔽真实内网 IP，这是当下能拿到的极限）'));
    }
    if (!i.public && !i.local) bits.push('未能获取上传环境信息（字段将留空，不影响记账）');
    $('envHint').textContent = '上传元数据：' + bits.join(' · ');
  }

  function stampEnv(rec, env) {
    rec.by = rec.by || currentBy();
    rec.uploaded_at = new Date().toISOString();
    if (env) {
      rec.ip_public = env.public || '';
      rec.ip_local = env.local || '';
    }
    if (DJ.device) rec.device = DJ.device.collect();
    return rec;
  }

  // ---------------- 数据 ----------------
  function refresh() {
    state.all = (state.data && state.data.readings) || [];
    state.enr = U.enrich(state.all);
    renderStats();
    renderCharts();
    renderLedger();
  }

  function persist() {
    DJ.store.saveLocal(state.data);
    refresh();
  }

  function upsertAll(incoming) {
    var map = {};
    (state.data.readings || []).forEach(function (r) { map[r.id] = r; });
    incoming.forEach(function (r) { map[r.id] = r; });
    state.data.readings = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return String(a.recorded_at).localeCompare(String(b.recorded_at)); });
    state.data.updated_at = new Date().toISOString();
    persist();
  }

  // ---------------- 登录（弹窗） ----------------
  function renderLogin() {
    var box = $('loginState');
    if (!box) return;

    if (loggedIn()) {
      var name = currentBy();
      box.innerHTML =
        '<div class="dj-inline">' +
          '<span class="dj-user-avatar">' + esc(name.slice(0, 1)) + '</span>' +
          '<b class="dj-inline-name">' + esc(name) + '</b>' +
          '<button class="neu-btn primary" type="button" id="btnInlineSync">同步数据</button>' +
          '<button class="neu-btn" type="button" id="btnLogout">退出登录</button>' +
        '</div>';
      var sy = $('btnInlineSync');
      if (sy) sy.addEventListener('click', function () { onSync(this); });
      var lo = $('btnLogout');
      if (lo) lo.addEventListener('click', onLogout);
      setHint('loginHint', '');
    } else {
      box.innerHTML =
        '<div class="dj-inline">' +
          '<span class="dj-inline-text">尚未登录 —— 登录后才能写入云端账本</span>' +
          '<button class="neu-btn primary" type="button" id="btnOpenLogin">登录</button>' +
        '</div>';
      var op = $('btnOpenLogin');
      if (op) op.addEventListener('click', openLogin);
      setHint('loginHint', DJ.auth.enabled()
        ? ''
        : '尚未配置密码名单：此时登录框会把输入直接当作完整 token 使用。', false);
      if (DJ.auth.enabled()) setHint('loginHint', '');
    }

    renderEntryBy();
    renderSync();
  }

  function openLogin() {
    var m = $('loginModal');
    if (!m) return;
    m.hidden = false;
    setHint('loginModalHint', '');
    var p = $('loginPwd');
    if (p) { p.value = ''; setTimeout(function () { p.focus(); }, 30); }
  }

  function closeLogin() {
    var m = $('loginModal');
    if (!m) return;
    m.hidden = true;
    var p = $('loginPwd');
    if (p) p.value = '';
    setHint('loginModalHint', '');
  }

  function onLoginSubmit(ev) {
    ev.preventDefault();
    var pwd = $('loginPwd') ? $('loginPwd').value : '';
    var un = $('loginUser');

    // 先把身份解出来填进 username 字段（纯本地同步解析）：
    // 浏览器只有在能配到用户名时才愿意把这份密码存进密码管理器。
    try {
      var guess = DJ.auth.decodePassword ? DJ.auth.decodePassword(pwd) : null;
      if (un && guess && guess.by) un.value = guess.by;
    } catch (e) { /* ignore */ }

    setHint('loginModalHint', '正在校验…');
    DJ.auth.login(pwd).then(function (r) {
      if (!r.ok) { setHint('loginModalHint', r.reason, false); return; }
      if (un && r.by) un.value = r.by;
      rememberPassword(r.by, pwd);
      closeLogin();
      renderLogin();
      setHint('loginHint', '已登录为 ' + (r.by || '未署名') + '，正在拉取云端数据…', true);
      envSnapshot();
      autoPull();
    });
  }

  /** 登录后自动从云端拉取并合并（失败不影响已建立的本机状态） */
  function autoPull() {
    var cfg = readSyncCfg();
    if (!cfg.pat) return;
    DJ.store.ghRead(cfg).then(function (res) {
      var before = (state.data.readings || []).length;
      state.data = DJ.store.mergeMeta(res.data, state.data);
      persist();
      var after = (state.data.readings || []).length;
      setHint('loginHint', '已登录为 ' + currentBy() + '，云端已同步（本机 ' + before + ' → ' + after + ' 条）', true);
    }).catch(function (e) {
      setHint('loginHint', '已登录为 ' + currentBy() + '，但拉取云端数据失败：'
        + (e && e.message ? e.message : e) + '（可稍后在「同步与导出」里手动拉取）', false);
    });
  }

  /** 主动请浏览器保存密码。表单提交被 preventDefault 拦掉后，浏览器不会自己弹保存提示，
   *  必须走 Credential Management API —— 它只在安全上下文（HTTPS / localhost）可用。 */
  function rememberPassword(name, pwd) {
    try {
      if (!pwd) return;
      if (typeof navigator === 'undefined' || !navigator.credentials) return;
      if (typeof PasswordCredential === 'undefined') return;
      navigator.credentials.store(new PasswordCredential({
        id: name || 'dianji',
        name: name || '403记账本',
        password: pwd
      }));
    } catch (e) { /* 非 HTTPS 或浏览器不支持，忽略 */ }
  }

  /** 一键同步：先把云端并入本机、再把合并结果推回去（失败不影响本机数据） */
  function onSync(btn) {
    return withBusy(btn, function () {
      var cfg = readSyncCfg();
      if (!cfg.pat) throw new Error('请先登录');
      return DJ.store.push(cfg, state.data).then(function (merged) {
        state.data = merged;
        persist();
        setHint('loginHint', '同步完成（共 ' + (merged.readings || []).length + ' 条）', true);
      }).catch(function (e) {
        setHint('loginHint', '同步失败：' + (e && e.message ? e.message : e), false);
      });
    });
  }

  function onLogout() {
    DJ.auth.logout();
    renderLogin();
    setHint('loginHint', '已退出登录', true);
  }

  function renderEntryBy() {
    var el = $('entryBy');
    if (el) el.value = loggedIn() ? currentBy() : '';
  }

  // ---------------- 统计卡 ----------------
  function card(k, v, alert, sub) {
    return '<div class="dj-stat' + (alert ? ' dj-alert' : '') + '">' +
      '<span class="dj-k">' + esc(k) + '</span>' +
      '<span class="dj-v">' + v + '</span>' +
      (sub ? '<span class="dj-k">' + esc(sub) + '</span>' : '') +
      '</div>';
  }
  function deg(v, unit) { return fmtNum(v) + '<small>' + (unit || '度') + '</small>'; }

  function renderStats() {
    var box = $('statGrid');
    if (!box) return;
    var st = U.stats(state.enr, { allReadings: state.all || [] });
    state.stats = st;

    if (!st.count) {
      box.innerHTML = '<p class="dj-empty">还没有记录。可以先在上面录入一条，或把历史账单整段粘到下面的「批量粘贴」。</p>';
      setHint('statHint', '');
      return;
    }

    var price = C.unitPriceCny;
    var alert = st.daysLeft !== null && st.daysLeft < C.alertDays;
    var html = [];
    html.push(card('当前余额', deg(st.current), alert, fmtNum(U.toCny(st.current, price)) + ' 元'));
    html.push(card('近 7 日均耗', deg(st.avg7, '度/天'), false, fmtNum(U.toCny(st.avg7, price)) + ' 元/天'));
    html.push(card('预计可用', st.daysLeft === null ? '—' : fmtNum(st.daysLeft, 1) + '<small>天</small>', alert));
    html.push(card('本月充值', deg(st.monthTopup), false, fmtNum(U.toCny(st.monthTopup, price)) + ' 元'));
    html.push(card('本月消耗', deg(st.monthConsumed), false, fmtNum(U.toCny(st.monthConsumed, price)) + ' 元'));
    box.innerHTML = html.join('');

    var hint = [];
    hint.push('共 ' + st.count + ' 条记录，最新一条：' + String(st.lastAt || '').slice(0, 16).replace('T', ' '));
    if (st.avg30) hint.push('近 30 日均耗 ' + fmtNum(st.avg30) + ' 度/天');
    if (st.anomalies) hint.push('⚠ 有 ' + st.anomalies + ' 条记录余额不降反升，可能是漏记充值');
    if (st.deletedCount) hint.push('另有 ' + st.deletedCount + ' 条已删除（保留痕迹，不计入统计）');
    setHint('statHint', hint.join(' · '), st.anomalies ? false : null);

    var memberBox = $('memberStats');
    if (memberBox) {
      var keys = Object.keys(st.byMember);
      memberBox.textContent = keys.length
        ? '按录入人：' + keys.map(function (k) { return k + ' ' + st.byMember[k] + ' 条'; }).join(' · ')
        : '';
    }
  }

  // ---------------- 图表 ----------------
  function renderCharts() {
    var bar = $('barChart'), line = $('lineChart');
    if (bar) DJ.chart.barChart(bar, U.dailySeries(state.enr, 30), {});
    if (line) DJ.chart.lineChart(line, U.balanceSeries(state.enr, 30), { zeroBase: false });
  }

  // ---------------- 流水表 ----------------
  function renderLedger() {
    var wrap = $('ledgerWrap');
    if (!wrap) return;
    var list = state.enr.slice().reverse();
    if (!list.length) { wrap.innerHTML = '<p class="dj-empty">暂无流水</p>'; return; }

    var h = ['<table class="dj-table"><thead><tr>',
      '<th>日期</th><th>时段</th><th>余额</th><th>充值</th><th>有效余额</th><th>本期消耗</th><th>折合</th>',
      '<th>录入人</th><th>上传</th><th>IP</th><th>设备</th><th>备注</th><th></th>',
      '</tr></thead><tbody>'];
    list.forEach(function (x) {
      h.push('<tr' + (x.anomaly ? ' class="dj-bad"' : '') + '>');
      h.push('<td>' + esc(String(x.recorded_at).slice(0, 10)) + '</td>');
      h.push('<td>' + (x.slot === 'pm' ? '晚' : '早') + '</td>');
      h.push('<td>' + (x.noReading ? '<span class="dj-hint">仅充值</span>' : fmtNum(x.balance)) + '</td>');
      h.push('<td>' + (x.topup ? fmtNum(x.topup) : '') + '</td>');
      h.push('<td>' + fmtNum(x.effective) + '</td>');
      h.push('<td>' + (x.consumed === null ? '—' : fmtNum(x.consumed)) + '</td>');
      h.push('<td>' + (x.consumed === null ? '—' : fmtNum(U.toCny(x.consumed)) + ' 元') + '</td>');
      h.push('<td>' + esc(x.by || '') + '</td>');
      h.push('<td>' + esc(shortTime(x.uploaded_at)) + '</td>');
      h.push('<td>' + esc(x.ip_public || '—') +
        (x.ip_local ? '<br><span class="dj-hint">' + esc(x.ip_local) + '</span>' : '') + '</td>');
      h.push('<td>' + esc(deviceLabel(x)) + '</td>');
      h.push('<td>' + esc(x.note || '') + '</td>');
      h.push('<td><button class="dj-del" type="button" data-id="' + esc(x.id) + '" title="删除这条">×</button></td>');
      h.push('</tr>');
    });
    h.push('</tbody></table>');
    wrap.innerHTML = h.join('');
  }

  // ---------------- 录入表单 ----------------
  function initForm() {
    $('fDate').value = todayStr();
    $('fTopup').value = '0';
    $('fBalance').addEventListener('input', updateEntryHint);
    $('entryForm').addEventListener('submit', onEntrySubmit);
  }

  function updateEntryHint() {
    var raw = $('fBalance').value.trim();
    var bal = parseFloat(raw);
    if (raw === '' || !isFinite(bal)) {
      var top = parseFloat($('fTopup').value) || 0;
      setHint('entryHint', top > 0 ? '仅充值：将以上一条余额 + ' + fmtNum(top) + ' 度推算，不计本期消耗' : '');
      return;
    }
    if (!state.enr.length) { setHint('entryHint', ''); return; }
    var prev = state.enr[state.enr.length - 1];
    var diff = U.round2(prev.effective - bal);
    setHint('entryHint',
      '上一条有效余额 ' + fmtNum(prev.effective) + ' 度 → 本次消耗 ' + fmtNum(diff) + ' 度（' +
      fmtNum(U.toCny(diff)) + ' 元）', diff >= 0);
  }

  function onEntrySubmit(ev) {
    ev.preventDefault();
    var date = $('fDate').value;
    var slot = $('fSlot').value;
    var rawBalance = $('fBalance').value.trim();
    var hasReading = rawBalance !== '' && isFinite(parseFloat(rawBalance));
    var balance = hasReading ? parseFloat(rawBalance) : null;
    var topup = parseFloat($('fTopup').value) || 0;
    if (!date) { setHint('entryHint', '日期必填', false); return; }
    if (!hasReading && !(topup > 0)) {
      setHint('entryHint', '请填写电表余额；若本次只是充值，请至少填上充值额度', false);
      return;
    }

    var hour = U.pad2(C.slotHour[slot] != null ? C.slotHour[slot] : 7);
    var stamp = date + 'T' + hour + ':00';
    setHint('entryHint', '正在附加上传信息…');

    envSnapshot().then(function (env) {
      var rec = stampEnv({
        id: stamp,
        recorded_at: stamp + C.tz,
        slot: slot,
        balance: balance,
        topup: topup,
        by: currentBy(),
        note: $('fNote').value.trim()
      }, env);
      upsertAll([rec]);
      $('fBalance').value = '';
      $('fTopup').value = '0';
      $('fNote').value = '';
      setHint('entryHint', '已保存 ' + date + ' ' + (slot === 'pm' ? '晚' : '早') + ' 的记录'
        + (hasReading ? '' : '（仅充值，未抄表）')
        + '（上传者 ' + (rec.by || '未署名') + '，公网 IP ' + (rec.ip_public || '未知') + '）', true);
    });
  }

  // ---------------- 批量粘贴 ----------------
  var DEMO = '9.23早\t6.9\t 100\t106.9\t 9.24早\t102.3\t4.6 9.25早\t87.8\t14.5 9.26早\t72.5\t15.3 9.27早\t56.8\t15.7 9.28早\t43.0 \t 13.8';

  function onParse() {
    var text = $('pasteArea').value;
    if (!text.trim()) { setHint('ioHint', '先粘贴文本再解析', false); return; }
    var r = P.parseText(text, {});
    state.rows = r.rows;
    renderPreview();
    var v = P.verify(state.rows);
    if (r.errors.length) setHint('ioHint', r.errors.join('；'), false);
    else if (v.issues.length) setHint('ioHint', '解析出 ' + r.rows.length + ' 条，但有 ' + v.issues.length + ' 处与文本里记录的数值不一致（下表已标红）', false);
    else setHint('ioHint', '解析出 ' + r.rows.length + ' 条，全部与文本里记录的消耗值吻合 ✓', true);
  }

  function renderPreview() {
    var wrap = $('previewWrap');
    var rows = state.rows;
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = ''; $('btnImport').disabled = true; return; }

    var v = P.verify(rows);
    var h = ['<table class="dj-table"><thead><tr>',
      '<th>导入</th><th>日期</th><th>时段</th><th>余额</th><th>充值</th><th>有效余额</th><th>本期消耗</th><th>文本里的消耗</th><th>校验</th>',
      '</tr></thead><tbody>'];
    v.enriched.forEach(function (e, i) {
      var r = rows[i];
      var bad = r.checkConsumed != null && e.consumed != null && Math.abs(r.checkConsumed - e.consumed) > 0.011;
      h.push('<tr' + (bad ? ' class="dj-bad"' : '') + '>');
      h.push('<td><input type="checkbox" class="dj-skip" data-i="' + i + '"' + (r.skip ? '' : ' checked') + '></td>');
      h.push('<td>' + esc(r.date) + '</td>');
      h.push('<td>' + (r.slot === 'pm' ? '晚' : '早') + '</td>');
      h.push('<td>' + fmtNum(e.balance) + '</td>');
      h.push('<td>' + (e.topup ? fmtNum(e.topup) : '') + '</td>');
      h.push('<td>' + fmtNum(e.effective) + '</td>');
      h.push('<td>' + (e.consumed === null ? '—' : fmtNum(e.consumed)) + '</td>');
      h.push('<td>' + (r.checkConsumed == null ? '' : fmtNum(r.checkConsumed)) + '</td>');
      h.push('<td>' + (bad ? '<span class="dj-warn">不一致</span>' : '<span class="dj-ok">✓</span>') + '</td>');
      h.push('</tr>');
    });
    h.push('</tbody></table>');
    var picked = rows.filter(function (r) { return !r.skip; }).length;
    h.push('<p class="dj-hint">共 ' + rows.length + ' 条，已勾选 ' + picked + ' 条待导入。' +
      (v.issues.length ? ' <span class="dj-warn">有 ' + v.issues.length + ' 处需人工确认。</span>' : '') + '</p>');
    wrap.innerHTML = h.join('');
    $('btnImport').disabled = picked === 0;
  }

  function onImport() {
    var rs = P.toReadings(state.rows);
    if (!rs.length) return;
    setHint('ioHint', '正在附加上传信息…');
    envSnapshot().then(function (env) {
      rs.forEach(function (r) { stampEnv(r, env); });
      upsertAll(rs);
      setHint('ioHint', '已导入 ' + rs.length + ' 条记录（上传者 ' + (currentBy() || '未署名') +
        '，公网 IP ' + ((env && env.public) || '未知') + '）', true);
      state.rows = [];
      renderPreview();
    });
  }

  // ---------------- 同步与导出 ----------------
  function readSyncCfg() {
    return { repo: ($('sRepo').value || '').trim() || C.repo, pat: DJ.auth.token() };
  }

  function renderSync() {
    if (!$('sRepo')) return;
    $('sRepo').value = state.pref.repo || C.repo;
    var on = loggedIn();
    $('syncState').innerHTML = on
      ? '已登录（' + esc(currentBy()) + '）· 云端仓库：' + esc(state.pref.repo || C.repo)
      : '未登录 —— 目前只操作本机缓存；登录后才能从云端拉取或推送。';
    $('btnPull').disabled = !on;
    $('btnPush').disabled = !on;
  }

  function withBusy(btn, fn) {
    if (state.busy) return;
    state.busy = true;
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = '处理中…';
    Promise.resolve().then(fn).catch(function (e) {
      setHint('ioHint', String(e && e.message ? e.message : e), false);
    }).then(function () {
      state.busy = false; btn.disabled = false; btn.textContent = old;
      renderSync();
    });
  }

  function onProbe(btn) {
    return withBusy(btn, function () {
      var cfg = readSyncCfg();
      return DJ.store.ghProbe(cfg).then(function (r) {
        if (!r.ok) { setHint('ioHint', r.reason, false); return; }
        var head = '连接正常：' + r.repo + '（' + (r.isPrivate ? '私有' : '公开')
          + '，默认分支 ' + r.defaultBranch + '）';
        if (r.warn) setHint('ioHint', head + ' · ' + r.warn, false);
        else setHint('ioHint', head + ' · 注意：浏览器无法预先探测写权限，首次推送若报 403，即表示 token 缺 Contents: Read and write', true);
      });
    });
  }

  function onSaveCfg() {
    state.pref.repo = ($('sRepo').value || '').trim() || C.repo;
    DJ.store.setPref(state.pref);
    renderSync();
    setHint('ioHint', '设置已保存在本机（不含任何凭据）', true);
  }

  function onPull(btn) {
    return withBusy(btn, function () {
      var cfg = readSyncCfg();
      if (!cfg.pat) throw new Error('请先登录');
      return DJ.store.ghRead(cfg).then(function (res) {
        state.data = DJ.store.mergeMeta(res.data, state.data);
        persist();
        setHint('ioHint', '已从云端拉取（合并后共 ' + (state.data.readings || []).length + ' 条）', true);
      });
    });
  }

  function onPush(btn) {
    return withBusy(btn, function () {
      var cfg = readSyncCfg();
      if (!cfg.pat) throw new Error('请先登录');
      return DJ.store.push(cfg, state.data).then(function (merged) {
        state.data = merged;
        persist();
        setHint('ioHint', '已推送到云端（合并后共 ' + (merged.readings || []).length + ' 条）', true);
      });
    });
  }

  function onExport(kind) {
    var enr = state.enr;
    if (!enr.length) { setHint('ioHint', '还没有记录可导出', false); return; }
    var d = new Date();
    var stamp = '' + d.getFullYear() + U.pad2(d.getMonth() + 1) + U.pad2(d.getDate());
    if (kind === 'csv') {
      DJ.store.download('dianji-' + stamp + '.csv', DJ.store.toCsv(enr), 'text/csv;charset=utf-8');
    } else if (kind === 'json') {
      DJ.store.download('dianji-' + stamp + '.json', JSON.stringify(state.data, null, 2), 'application/json;charset=utf-8');
    } else {
      DJ.store.download('dianji-' + stamp + '.md', DJ.store.toMarkdown(enr, state.stats, state.data), 'text/markdown;charset=utf-8');
    }
    setHint('ioHint', '已导出 ' + enr.length + ' 条记录', true);
  }

  // ---------------- 启动 ----------------
  function bind() {
    $('loginForm').addEventListener('submit', onLoginSubmit);
    $('btnCloseLogin').addEventListener('click', closeLogin);
    $('loginMask').addEventListener('click', closeLogin);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && $('loginModal') && !$('loginModal').hidden) closeLogin();
    });

    $('btnParse').addEventListener('click', onParse);
    $('btnImport').addEventListener('click', onImport);
    $('btnPasteDemo').addEventListener('click', function () { $('pasteArea').value = DEMO; });
    $('btnSaveCfg').addEventListener('click', onSaveCfg);
    $('btnPull').addEventListener('click', function () { onPull(this); });
    $('btnPush').addEventListener('click', function () { onPush(this); });
    $('btnProbe').addEventListener('click', function () { onProbe(this); });
    $('btnCsv').addEventListener('click', function () { onExport('csv'); });
    $('btnJson').addEventListener('click', function () { onExport('json'); });
    $('btnMd').addEventListener('click', function () { onExport('md'); });

    $('previewWrap').addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.classList.contains('dj-skip')) {
        var i = parseInt(t.getAttribute('data-i'), 10);
        if (state.rows[i]) state.rows[i].skip = !t.checked;
        renderPreview();
      }
    });

    $('ledgerWrap').addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.classList.contains('dj-del')) return;
      var id = t.getAttribute('data-id');
      if (!confirm('删除这条记录？记录不会被真正抹掉，会记下删除时间与操作人，只是不再计入统计。')) return;
      var at = new Date().toISOString();
      var who = currentBy() || '未署名';
      (state.data.readings || []).forEach(function (r) {
        if (r.id === id) { r.deleted_at = at; r.deleted_by = who; }
      });
      persist();
    });
  }

  function init() {
    state.pref = DJ.store.getPref();
    state.data = DJ.store.loadLocal();
    if (!state.data.readings) state.data = DJ.store.empty();
    initForm();
    bind();
    renderLogin();
    refresh();
    envSnapshot();
  }

  DJ.ui = {
    init: init, state: state, refresh: refresh, renderLogin: renderLogin,
    renderSync: renderSync, stampEnv: stampEnv, openLogin: openLogin, closeLogin: closeLogin, autoPull: autoPull, onSync: onSync
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
