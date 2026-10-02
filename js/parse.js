/* 记电 · 粘贴文本解析层
   支持两种输入形态：
     1) 多行文本，每行一条记录
     2) 一整行里塞了多条记录（从表格/微信里复制出来的形态，例如本次给你的样例）
   做法：先用词法扫描找出所有「确认是日期」的位置，再按这些位置把文本切段，
         每段里的数字就是该条记录的数值。 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};
  var MS_DAY = 86400000;

  var SLOT_WORDS = {
    '早': 'am', '上午': 'am', 'am': 'am', 'AM': 'am',
    '晚': 'pm', '下午': 'pm', 'pm': 'pm', 'PM': 'pm'
  };
  var SLOT_AHEAD = /^\s*(早|晚|am|pm|AM|PM|上午|下午)/;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 扫描所有可以确认为日期的位置。
   *  认定规则（任一满足）：
   *    a) 带 4 位年份，如 2026-09-24
   *    b) 两位月日，且紧跟「早/晚/am/pm/上午/下午」
   *    c) 两位月日，且位于行首
   *  且必须不处于更长的数字内部 —— 否则 102.3 会被误切成 02.3。 */
  function findDates(text) {
    var out = [];
    var re = /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})|(\d{1,2})\s*[-/.]\s*(\d{1,2})/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var year = m[1] ? parseInt(m[1], 10) : null;
      var month = parseInt(m[1] ? m[2] : m[4], 10);
      var day = parseInt(m[1] ? m[3] : m[5], 10);
      var prevChar = m.index > 0 ? text.charAt(m.index - 1) : '';
      if (/[\d.]/.test(prevChar)) continue;                 // 落在更长数字内部，跳过

      var after = text.slice(m.index + m[0].length);
      var slotM = SLOT_AHEAD.exec(after);
      var atLineStart = (m.index === 0) || /\n[^\S\n]*$/.test(text.slice(0, m.index));

      if (!year) {
        if (!slotM && !atLineStart) continue;               // 两位月日需有时段词或在行首
        if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      }
      out.push({
        index: m.index,
        end: m.index + m[0].length + (slotM ? slotM[0].length : 0),
        year: year, month: month, day: day,
        slot: slotM ? SLOT_WORDS[slotM[1]] : 'am'
      });
    }
    return out;
  }

  /** 缺年份时推断：若该月日比「今天」晚 1 天以上，视为去年（跨年记录场景） */
  function resolveYear(year, month, day, ref) {
    if (year) return year;
    var y = ref.getFullYear();
    var cand = new Date(y, month - 1, day, 23, 59, 59);
    if (cand.getTime() - ref.getTime() > MS_DAY) y -= 1;
    return y;
  }

  /** 解析主入口 → { rows, errors }
   *  row: {raw, date, year, month, day, slot, balance, topup, checkConsumed, checkEffective, warn} */
  function parseText(text, opts) {
    opts = opts || {};
    var ref = opts.now ? new Date(opts.now) : new Date();
    var raw = String(text || '');
    var dates = findDates(raw);
    var rows = [], errors = [];

    dates.forEach(function (d, idx) {
      var nextIdx = (idx + 1 < dates.length) ? dates[idx + 1].index : raw.length;
      var seg = raw.slice(d.end, nextIdx);
      var nums = (seg.match(/\d+(?:\.\d+)?/g) || []).map(Number);
      var year = resolveYear(d.year, d.month, d.day, ref);

      var row = {
        raw: raw.slice(d.index, Math.min(nextIdx, d.index + 48)).replace(/\s+/g, ' ').trim(),
        year: year, month: d.month, day: d.day, slot: d.slot,
        date: year + '-' + pad2(d.month) + '-' + pad2(d.day),
        balance: nums.length ? nums[0] : null,
        topup: 0,
        checkConsumed: null,
        checkEffective: null,
        warn: ''
      };

      if (nums.length >= 3 && Math.abs(nums[0] + nums[1] - nums[2]) < 0.011) {
        // 形如 6.9 | 100 | 106.9：第 2 个数是充值，第 3 个是充值后的有效余额（校验值）
        row.topup = nums[1];
        row.checkEffective = nums[2];
      } else if (nums.length >= 2) {
        // 形如 102.3 | 4.6：第 2 个数是当时记录的消耗值，用于交叉校验
        row.checkConsumed = nums[1];
      } else if (!nums.length) {
        row.warn = '未解析到数值';
      }

      if (row.balance === null) errors.push('第 ' + (idx + 1) + ' 条缺少余额：' + row.raw);
      rows.push(row);
    });

    if (!rows.length && raw.trim()) errors.push('没有识别到任何「日期 + 时段」的记录');
    return { rows: rows, errors: errors };
  }

  /** 预览行 → 标准记录（跳过被标记 skip 的行） */
  function toReadings(rows, cfg) {
    cfg = cfg || DJ.config;
    return (rows || []).filter(function (r) {
      return r.balance !== null && r.balance !== undefined && !r.skip;
    }).map(function (r) {
      var hour = pad2(cfg.slotHour[r.slot] != null ? cfg.slotHour[r.slot] : 7);
      var stamp = r.date + 'T' + hour + ':00';
      return {
        id: stamp,
        recorded_at: stamp + (cfg.tz || '+08:00'),
        slot: r.slot,
        balance: Number(r.balance) || 0,
        topup: Number(r.topup) || 0,
        by: r.by || '',
        note: r.note || ''
      };
    });
  }

  /** 交叉校验：把解析结果按口径算一遍，与文本里原有的消耗/有效余额比对。
   *  这就是「粘贴即导入」的正确性自检。 */
  function verify(rows) {
    var rs = toReadings(rows);
    var enr = DJ.calc.enrich(rs);
    var issues = [];

    // 逐个「未被跳过」的预览行与计算结果对齐（toReadings 会滤掉 skip 行，故用独立游标）
    var k = 0;
    rows.forEach(function (src) {
      if (src.balance === null || src.balance === undefined || src.skip) return;
      var e = enr[k++];
      if (!e) return;
      if (src.checkConsumed != null && e.consumed != null &&
          Math.abs(src.checkConsumed - e.consumed) > 0.011) {
        issues.push({ date: e.recorded_at, field: 'consumed', expect: src.checkConsumed, actual: e.consumed });
      }
      if (src.checkEffective != null && Math.abs(src.checkEffective - e.effective) > 0.011) {
        issues.push({ date: e.recorded_at, field: 'effective', expect: src.checkEffective, actual: e.effective });
      }
    });

    return { readings: rs, enriched: enr, issues: issues };
  }

  DJ.parse = {
    findDates: findDates,
    parseText: parseText,
    toReadings: toReadings,
    verify: verify
  };
})(typeof window !== 'undefined' ? window : globalThis);
