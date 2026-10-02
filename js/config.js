/* 记电 · 全局配置 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  DJ.config = {
    ledgerName: '家用电表',
    unit: 'kWh',
    unitLabel: '度',
    unitPriceCny: 0.5,            // 1 度 = 0.5 元

    // 数据仓库（私有）。成员名单与凯撒位移见 js/auth-table.js，由 tools/make-passwords.js 生成
    repo: 'happysoysaucemin/dateofhappy',
    path: 'readings.json',
    branch: 'main',
    apiBase: 'https://api.github.com',

    alertDays: 3,                 // 可用天数低于此值 → 告警
    slotHour: { am: 7, pm: 19 },  // 早/晚抄表对应的小时
    tz: '+08:00',

    localKey: 'dianji.v1.data',
    prefKey: 'dianji.v1.pref'
  };
})(typeof window !== 'undefined' ? window : globalThis);
