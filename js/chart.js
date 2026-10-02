/* 记电 · 图表层
   手写 SVG，零第三方依赖 / 零 CDN —— 既规避供应链风险，也避免国内 CDN 不可达。 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 柱状图：items = [{label, value, date}] */
  function barChart(el, items, opts) {
    opts = opts || {};
    if (!el) return;
    items = (items || []).filter(Boolean);
    if (!items.length) { el.innerHTML = '<p class="dj-empty">暂无数据</p>'; return; }

    var W = 320, H = 120, padL = 4, padR = 4, padT = 14, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = items.reduce(function (a, x) { return Math.max(a, x.value || 0); }, 0);
    if (!(max > 0)) max = 1;
    var bw = iw / items.length;
    var barW = Math.max(1.5, bw * 0.66);

    var svg = ['<svg class="dj-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="逐日消耗柱状图">'];
    svg.push('<line class="dj-axis" x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (W - padR) + '" y2="' + (padT + ih) + '"/>');

    items.forEach(function (x, i) {
      var v = x.value || 0;
      var h = Math.max(v > 0 ? 1 : 0, v / max * ih);
      var cx = padL + bw * i + bw / 2;
      var y = padT + ih - h;
      var hi = opts.highlight ? opts.highlight(x, i) : false;
      svg.push('<rect class="' + (hi ? 'dj-bar dj-bar-hi' : 'dj-bar') +
        '" x="' + (cx - barW / 2).toFixed(2) + '" y="' + y.toFixed(2) +
        '" width="' + barW.toFixed(2) + '" height="' + h.toFixed(2) + '" rx="1">' +
        '<title>' + esc(x.date || x.label) + '：' + v + ' 度</title></rect>');
    });

    var marks = [0, Math.floor((items.length - 1) / 2), items.length - 1];
    marks.forEach(function (i, k) {
      if (i < 0) return;
      var x = padL + bw * i + bw / 2;
      var anchor = (i === 0) ? 'start' : (i === items.length - 1 ? 'end' : 'middle');
      var tx = (i === 0) ? padL : (i === items.length - 1 ? W - padR : x);
      svg.push('<text class="dj-axis-label" x="' + tx.toFixed(2) + '" y="' + (H - 4) +
        '" text-anchor="' + anchor + '">' + esc(items[i].label) + '</text>');
    });
    svg.push('</svg>');
    el.innerHTML = svg.join('');
  }

  /** 折线图：items = [{label, value}] */
  function lineChart(el, items, opts) {
    opts = opts || {};
    if (!el) return;
    items = (items || []).filter(Boolean);
    if (items.length < 2) { el.innerHTML = '<p class="dj-empty">数据不足（至少需要两条）</p>'; return; }

    var W = 320, H = 120, padL = 8, padR = 8, padT = 12, padB = 18;
    var iw = W - padL - padR, ih = H - padT - padB;
    var vals = items.map(function (x) { return Number(x.value) || 0; });
    var max = Math.max.apply(null, vals);
    var min = Math.min.apply(null, vals);
    if (max === min) { max = min + 1; }
    if (opts.zeroBase) min = 0;

    function px(i) { return padL + (items.length === 1 ? iw / 2 : iw * i / (items.length - 1)); }
    function py(v) { return padT + ih - (v - min) / (max - min) * ih; }

    var pts = items.map(function (x, i) { return px(i).toFixed(2) + ',' + py(Number(x.value) || 0).toFixed(2); });

    var svg = ['<svg class="dj-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="余额趋势折线图">'];
    svg.push('<line class="dj-axis" x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (W - padR) + '" y2="' + (padT + ih) + '"/>');
    svg.push('<polyline class="dj-line" points="' + pts.join(' ') + '"/>');
    items.forEach(function (x, i) {
      svg.push('<circle class="dj-dot" cx="' + px(i).toFixed(2) + '" cy="' + py(Number(x.value) || 0).toFixed(2) +
        '" r="1.8"><title>' + esc(x.date || x.label) + '：' + x.value + ' 度</title></circle>');
    });
    var marks = [0, items.length - 1];
    marks.forEach(function (i) {
      var anchor = (i === 0) ? 'start' : 'end';
      var tx = (i === 0) ? padL : W - padR;
      svg.push('<text class="dj-axis-label" x="' + tx.toFixed(2) + '" y="' + (H - 4) +
        '" text-anchor="' + anchor + '">' + esc(items[i].label) + '</text>');
    });
    svg.push('</svg>');
    el.innerHTML = svg.join('');
  }

  DJ.chart = { barChart: barChart, lineChart: lineChart, esc: esc };
})(typeof window !== 'undefined' ? window : globalThis);
