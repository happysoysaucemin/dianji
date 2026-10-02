/* 记电 · 存储层
   - 本机：localStorage 缓存账本数据（离线也能看、也能录）
   - 云端：GitHub Contents API（真相源；git 提交历史即账本变更历史）
   - 凭据：**一律不落 localStorage**，只从 DJ.auth 取会话内的 token
   文件形状：readings.json = { version, ledger, unit, unit_price_cny, updated_at, readings: [...] } */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};
  var C = DJ.config;

  // ---------------- 编码（浏览器与 Node 都可用） ----------------
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------------- 数据结构 ----------------
  function empty() {
    return {
      version: 1,
      ledger: C.ledgerName,
      unit: C.unit,
      unit_price_cny: C.unitPriceCny,
      updated_at: new Date().toISOString(),
      readings: []
    };
  }

  function normalize(obj) {
    var d = empty();
    if (!obj || typeof obj !== 'object') return d;
    if (Array.isArray(obj)) { d.readings = obj; return d; }
    d.version = obj.version || 1;
    d.ledger = obj.ledger || C.ledgerName;
    d.unit = obj.unit || C.unit;
    d.unit_price_cny = obj.unit_price_cny != null ? obj.unit_price_cny : C.unitPriceCny;
    d.updated_at = obj.updated_at || d.updated_at;
    d.readings = Array.isArray(obj.readings) ? obj.readings : [];
    return d;
  }

  /** 以 id(=recorded_at) 为键合并，incoming 覆盖 base。返回新对象，不修改入参。 */
  function merge(base, incoming) {
    var map = {};
    ((base && base.readings) || []).forEach(function (r) { if (r && r.id) map[r.id] = r; });
    ((incoming && incoming.readings) || []).forEach(function (r) { if (r && r.id) map[r.id] = r; });
    var out = normalize(base && base.version ? base : incoming);
    out.readings = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return String(a.recorded_at).localeCompare(String(b.recorded_at)); });
    out.updated_at = new Date().toISOString();
    return out;
  }

  /** 拉取远端后用：双向合并，谁的记录都不丢 */
  function mergeMeta(remote, local) {
    return merge(remote, local);
  }

  // ---------------- 本机缓存 ----------------
  function loadLocal() {
    try {
      var raw = localStorage.getItem(C.localKey);
      return raw ? normalize(JSON.parse(raw)) : empty();
    } catch (e) { return empty(); }
  }

  /** 只写账本数据。绝不接受、也绝不写入任何凭据字段。 */
  function saveLocal(data) {
    try {
      var safe = normalize(data);
      var keep = { version: safe.version, ledger: safe.ledger, unit: safe.unit,
                   unit_price_cny: safe.unit_price_cny, updated_at: safe.updated_at,
                   readings: safe.readings };
      localStorage.setItem(C.localKey, JSON.stringify(keep));
      return safe;
    } catch (e) { return data; }
  }

  /** 偏好设置：只保留非敏感项；历史版本可能残留的 token 会被就地清除。 */
  function getPref() {
    try {
      var p = JSON.parse(localStorage.getItem(C.prefKey)) || {};
      if (p.pat || p.token) {
        delete p.pat; delete p.token;
        localStorage.setItem(C.prefKey, JSON.stringify(p));
      }
      return p;
    } catch (e) { return {}; }
  }

  function setPref(p) {
    var safe = {};
    Object.keys(p || {}).forEach(function (k) {
      if (k === 'pat' || k === 'token') return;     // 凭据一律不落盘
      safe[k] = p[k];
    });
    try { localStorage.setItem(C.prefKey, JSON.stringify(safe)); } catch (e) { /* ignore */ }
    return safe;
  }

  /** 当前会话的写入凭据（来自 DJ.auth，内存/sessionStorage，不在 localStorage） */
  function credential() {
    return (DJ.auth && DJ.auth.token) ? DJ.auth.token() : null;
  }

  /** 连接与权限自检（纯只读，不产生任何提交）。
   *  把 GitHub 晦涩的 401/403/404 翻译成能直接照着做的提示。 */
  function ghProbe(cfg) {
    if (!cfg || !cfg.repo) return Promise.resolve({ ok: false, reason: '未配置数据仓库' });
    if (!cfg.pat) return Promise.resolve({ ok: false, reason: '尚未登录' });
    var url = (cfg.apiBase || C.apiBase) + '/repos/' + cfg.repo;
    return fetch(url, { headers: ghHeaders(cfg.pat), cache: 'no-store' }).then(function (res) {
      if (res.status === 401) {
        return { ok: false, code: 401, reason: '凭据无效或已过期 —— 请退出后重新登录' };
      }
      if (res.status === 404) {
        return { ok: false, code: 404,
          reason: '当前凭据看不到仓库 ' + cfg.repo + '。最常见原因：这个 fine-grained token 的'
            + ' Repository access 没有勾选该仓库（token 签发时若仓库还不存在，就会漏勾）。'
            + '请到 GitHub 编辑 token 勾上它，或直接选 All repositories。' };
      }
      if (!res.ok) return { ok: false, code: res.status, reason: '仓库访问失败：HTTP ' + res.status };
      return res.json().then(function (j) {
        return {
          ok: true,
          repo: j.full_name,
          isPrivate: !!j.private,
          defaultBranch: j.default_branch,
          warn: j.private ? '' : '⚠ 该仓库当前是【公开】的：任何人都能读到用电数据，建议改为私有'
        };
      });
    }).catch(function (e) {
      return { ok: false, reason: '网络请求失败：' + (e && e.message ? e.message : e)
        + '（若在国内网络，请确认 api.github.com 可访问）' };
    });
  }

  // ---------------- GitHub Contents API ----------------
  function ghHeaders(pat) {
    return {
      'Authorization': 'Bearer ' + pat,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }
  function contentsUrl(cfg) {
    return (cfg.apiBase || C.apiBase) + '/repos/' + cfg.repo + '/contents/' + (cfg.path || C.path);
  }

  function ghRead(cfg) {
    var url = contentsUrl(cfg) + '?ref=' + encodeURIComponent(cfg.branch || C.branch) + '&_=' + Date.now();
    return fetch(url, { headers: ghHeaders(cfg.pat), cache: 'no-store' }).then(function (res) {
      if (res.status === 404) return { data: empty(), sha: null, notFound: true };
      if (res.status === 401) throw new Error('凭据无效或已过期（HTTP 401）：请退出后重新登录');
      if (res.status === 403) throw new Error('权限不足（HTTP 403）：通常是 token 没有该仓库的 Contents 读写权限，或未勾选该仓库。点「检查连接」可查看诊断');
      if (!res.ok) throw new Error('读取失败：HTTP ' + res.status);
      return res.json().then(function (j) {
        return { data: normalize(JSON.parse(b64ToUtf8(j.content || ''))), sha: j.sha };
      });
    });
  }

  function ghWrite(cfg, data, sha, message) {
    var body = {
      message: message || ('记电：更新 ' + new Date().toISOString()),
      content: utf8ToB64(JSON.stringify(data, null, 2)),
      branch: cfg.branch || C.branch
    };
    if (sha) body.sha = sha;
    return fetch(contentsUrl(cfg), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(cfg.pat)),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 409 || res.status === 422) {
        var e = new Error('远端已被他人更新，正在重新合并');
        e.conflict = true;
        throw e;
      }
      if (res.status === 401) throw new Error('凭据无效或已过期（HTTP 401）：请退出后重新登录');
      if (res.status === 403) throw new Error('权限不足（HTTP 403）：通常是 token 没有该仓库的 Contents 读写权限，或未勾选该仓库。点「检查连接」可查看诊断');
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('写入失败：HTTP ' + res.status + ' ' + String(t).slice(0, 200));
        });
      }
      return res.json();
    });
  }

  /** 推送 = 先拉远端 → 合并 → 写回；遇冲突自动重试（最多 3 次） */
  function push(cfg, localData, attempt) {
    attempt = attempt || 0;
    return ghRead(cfg).then(function (remote) {
      var merged = merge(remote.data, localData);
      return ghWrite(cfg, merged, remote.sha).then(function () {
        return merged;
      }).catch(function (e) {
        if (e.conflict && attempt < 3) return push(cfg, localData, attempt + 1);
        throw e;
      });
    });
  }

  // ---------------- 导出 ----------------
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(enr) {
    var price = C.unitPriceCny;
    var lines = [['日期', '时段', '余额(度)', '充值(度)', '有效余额(度)', '本期消耗(度)', '折合(元)', '录入人', '备注'].join(',')];
    (enr || []).forEach(function (x) {
      lines.push([
        String(x.recorded_at).slice(0, 10),
        x.slot === 'pm' ? '晚' : '早',
        x.balance,
        x.topup || '',
        x.effective,
        x.consumed === null ? '' : x.consumed,
        x.consumed === null ? '' : DJ.calc.toCny(x.consumed, price),
        x.by,
        x.note
      ].map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\r\n');   // BOM：让 Excel 正确识别中文
  }

  function toMarkdown(enr, st, data) {
    var price = C.unitPriceCny;
    var L = [];
    L.push('# 记电月报 · ' + ((data && data.ledger) || C.ledgerName));
    L.push('');
    L.push('- 生成时间：' + new Date().toLocaleString('zh-CN'));
    L.push('- 记录条数：' + ((enr || []).length));
    if (st) {
      L.push('- 当前余额：' + st.current + ' 度（' + DJ.calc.toCny(st.current, price) + ' 元）');
      L.push('- 近 7 日均耗：' + (st.avg7 == null ? '—' : DJ.calc.round2(st.avg7)) + ' 度/天');
      if (st.daysLeft != null) {
        L.push('- 预计可用：' + DJ.calc.round2(st.daysLeft) + ' 天（约 ' + st.emptyDateStr + ' 耗尽）');
      }
    }
    L.push('');
    L.push('| 日期 | 时段 | 余额(度) | 充值(度) | 有效(度) | 消耗(度) | 折合(元) | 录入人 |');
    L.push('|---|---|---|---|---|---|---|---|');
    (enr || []).slice().reverse().forEach(function (x) {
      L.push('| ' + String(x.recorded_at).slice(0, 10) + ' | ' + (x.slot === 'pm' ? '晚' : '早') + ' | ' +
        x.balance + ' | ' + (x.topup || '') + ' | ' + x.effective + ' | ' +
        (x.consumed === null ? '—' : x.consumed) + ' | ' +
        (x.consumed === null ? '—' : DJ.calc.toCny(x.consumed, price)) + ' | ' + (x.by || '') + ' |');
    });
    return L.join('\n');
  }

  DJ.store = {
    empty: empty,
    normalize: normalize,
    merge: merge,
    mergeMeta: mergeMeta,
    loadLocal: loadLocal,
    saveLocal: saveLocal,
    getPref: getPref,
    setPref: setPref,
    credential: credential,
    ghProbe: ghProbe,
    ghRead: ghRead,
    ghWrite: ghWrite,
    push: push,
    download: download,
    toCsv: toCsv,
    toMarkdown: toMarkdown,
    utf8ToB64: utf8ToB64,
    b64ToUtf8: b64ToUtf8
  };
})(typeof window !== 'undefined' ? window : globalThis);
