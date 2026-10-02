/* 记电 · 上传环境探测（真实网络，只读）
   ------------------------------------------------------------------
   用法：node tools/netinfo-check.js
   做什么：
     1. 逐个尝试公网 IP 的各个数据源，看哪些在你当前网络下可用
     2. 说明内网 IP 为何拿不到（Node 环境没有 WebRTC，浏览器里也已被
        mDNS 混淆名取代），这一步只做解释性输出
   只发 GET，不写入任何东西。
   ------------------------------------------------------------------ */
'use strict';

var path = require('path');
var JS = path.join(__dirname, '..', 'js');
['config.js', 'netinfo.js'].forEach(function (f) { require(path.join(JS, f)); });
var DJ = globalThis.DJ;

var SOURCES = [
  'https://api.ipify.org?format=json',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json',
  'https://api.ip.sb/geoip'
];

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
    Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); },
      function (e) { clearTimeout(t); reject(e); });
  });
}

console.log('逐个探测公网 IP 数据源（每个 5 秒超时）：');
console.log('');

var results = [];
SOURCES.reduce(function (p, url) {
  return p.then(function () {
    var t0 = Date.now();
    return withTimeout(fetch(url, { cache: 'no-store' }), 5000)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (j) {
        var ip = j && (j.ip || (j.data && j.data.ip));
        var ms = Date.now() - t0;
        if (!ip) throw new Error('响应里没有 ip 字段');
        results.push({ url: url, ok: true, ip: String(ip).trim(), ms: ms });
        console.log('  OK    ' + url + '  →  ' + ip + '   (' + ms + 'ms)');
      })
      .catch(function (e) {
        results.push({ url: url, ok: false, note: e && e.message || String(e) });
        console.log('  FAIL  ' + url + '  →  ' + (e && e.message || e));
      });
  });
}, Promise.resolve()).then(function () {
  console.log('');
  var good = results.filter(function (r) { return r.ok; });
  console.log(good.length
    ? '可用源 ' + good.length + '/' + results.length + '，默认走第一个可用的：' + good[0].url
    : '⚠ 所有公网 IP 源都不可用 —— 页面会把 ip_public 留空，不影响记账。');

  console.log('');
  console.log('关于内网 IP：');
  console.log('  · Node 环境没有 WebRTC，拿不到任何本地地址；');
  console.log('  · 浏览器里会被主动降级为 mDNS 混淆名（如 8f2a-1b3c.local），');
  console.log('    这是 Chrome/Safari/Firefox 共同的隐私策略，不是权限问题。');
  console.log('  · 页面会尽力而为：能拿到就记真的，拿到 mDNS 名就照实记录，');
  console.log('    都拿不到则留空，并在字段来源上标明，绝不伪造。');
  process.exit(good.length ? 0 : 1);
});
