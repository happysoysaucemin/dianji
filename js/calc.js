/* 记电 · 计算层（唯一口径，全站只在这里算）
   单位统一为「度」(kWh)：
     effective（有效余额） = balance + topup
     consumed （本期消耗） = 上一条 effective − 本条 balance
   金额折算只发生在前端展示层：cny = 度 × unitPriceCny */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};
  var MS_DAY = 86400000;

  function round2(n) {
    return Math.round((Number(n) + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
  }
  function ts(r) { return new Date(r.recorded_at).getTime(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDay(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 按抄表时间升序排序（同年同月同日同刻时按 am 在前） */
  function sortReadings(list) {
    return (list || []).slice().sort(function (a, b) {
      var d = ts(a) - ts(b);
      if (d !== 0) return d;
      return String(a.slot || '').localeCompare(String(b.slot || ''));
    });
  }

  /** 计算派生字段，返回新数组（升序）。不修改入参。 */
  function enrich(list) {
    var prev = null;
    return sortReadings(list).map(function (src) {
      var balance = Number(src.balance) || 0;
      var topup = Number(src.topup) || 0;
      var effective = round2(balance + topup);
      var consumed = prev === null ? null : round2(prev.effective - balance);
      var item = {
        id: src.id || src.recorded_at,
        recorded_at: src.recorded_at,
        slot: src.slot || 'am',
        balance: balance,
        topup: topup,
        by: src.by || '',
        note: src.note || '',
        effective: effective,
        consumed: consumed,
        anomaly: consumed !== null && consumed < -0.01   // 余额反而变多 → 可能漏记充值
      };
      prev = item;
      return item;
    });
  }

  /** 近 days 天的日均消耗（度/天）。
   *  口径：取窗口内第一条记录的前一条作为基准，消耗之和 ÷ 基准到末条的实际天数。
   *  校验：9.23~9.28 六条 → 63.9 / 5 天 = 12.78 度/天 */
  function dailyAvg(enr, days) {
    if (!enr || enr.length < 2) return null;
    var lastTs = ts(enr[enr.length - 1]);
    var cutoff = lastTs - days * MS_DAY;
    var i = 0;
    while (i < enr.length && ts(enr[i]) < cutoff) i++;
    var base = Math.min(Math.max(i - 1, 0), enr.length - 2);
    var sum = 0;
    for (var k = base + 1; k < enr.length; k++) sum += (enr[k].consumed || 0);
    var span = (lastTs - ts(enr[base])) / MS_DAY;
    if (!(span > 0)) span = 1;
    return sum / span;
  }

  /** 汇总指标 */
  function stats(enr, opts) {
    opts = opts || {};
    var price = opts.unitPriceCny != null ? opts.unitPriceCny : DJ.config.unitPriceCny;
    var now = opts.now ? new Date(opts.now) : new Date();
    var out = {
      count: enr.length,
      price: price,
      current: null, currentCny: null, lastAt: null,
      avg7: dailyAvg(enr, 7), avg30: dailyAvg(enr, 30),
      avgUsed: null, daysLeft: null, emptyDate: null, emptyDateStr: null,
      monthTopup: 0, monthConsumed: 0, byMember: {}, anomalies: 0
    };
    if (!enr.length) return out;

    var last = enr[enr.length - 1];
    out.current = last.effective;
    out.currentCny = round2(last.effective * price);
    out.lastAt = last.recorded_at;

    var avg = out.avg7 || out.avg30 || dailyAvg(enr, 3650);
    out.avgUsed = avg ? round2(avg) : null;
    if (avg && avg > 0) {
      out.daysLeft = last.effective / avg;
      var empty = new Date(now.getTime() + out.daysLeft * MS_DAY);
      out.emptyDate = empty;
      out.emptyDateStr = empty.getFullYear() + '-' + pad2(empty.getMonth() + 1) + '-' + pad2(empty.getDate());
    }

    var ym = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    enr.forEach(function (x) {
      if (String(x.recorded_at).slice(0, 7) === ym) {
        out.monthTopup += x.topup || 0;
        out.monthConsumed += x.consumed || 0;
      }
      var who = x.by || '未署名';
      out.byMember[who] = (out.byMember[who] || 0) + 1;
      if (x.anomaly) out.anomalies++;
    });
    out.monthTopup = round2(out.monthTopup);
    out.monthConsumed = round2(out.monthConsumed);
    return out;
  }

  /** 近 days 天的逐日消耗（柱状图用） */
  function dailySeries(enr, days, now) {
    now = now || new Date();
    var byDay = {};
    (enr || []).forEach(function (x) {
      if (x.consumed === null) return;
      var d = String(x.recorded_at).slice(0, 10);
      byDay[d] = (byDay[d] || 0) + x.consumed;
    });
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(now.getTime() - i * MS_DAY);
      var key = fmtDay(d);
      out.push({ date: key, label: key.slice(5), value: round2(byDay[key] || 0) });
    }
    return out;
  }

  /** 余额趋势（折线图用） */
  function balanceSeries(enr, limit) {
    var list = (enr || []).slice(-(limit || 30));
    return list.map(function (x) {
      return {
        date: String(x.recorded_at).slice(0, 10),
        label: String(x.recorded_at).slice(5, 10),
        value: x.effective
      };
    });
  }

  /** 度 → 元 */
  function toCny(kwh, price) {
    return round2((Number(kwh) || 0) * (price != null ? price : DJ.config.unitPriceCny));
  }

  DJ.calc = {
    sortReadings: sortReadings,
    enrich: enrich,
    dailyAvg: dailyAvg,
    stats: stats,
    dailySeries: dailySeries,
    balanceSeries: balanceSeries,
    toCny: toCny,
    round2: round2,
    fmtDay: fmtDay,
    pad2: pad2,
    MS_DAY: MS_DAY
  };
})(typeof window !== 'undefined' ? window : globalThis);
