/* 记电 · 全局配置
   站点 1551114.xyz/css/style.css 提供基础组件（container/card/neu-btn/stat-grid 等），
   本目录只补充记电专属样式与逻辑，不修改站点任何既有文件。 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  DJ.config = {
    ledgerName: '家用电表',
    unit: 'kWh',
    unitLabel: '度',
    unitPriceCny: 0.5,            // 1 度 = 0.5 元

    // 5 个预注册成员（改成真实称呼即可；不改这里也不影响使用）
    members: ['成员一', '成员二', '成员三', '成员四', '成员五'],

    // 数据仓库（P2 同步用；先在 GitHub 建一个私有仓库）
    repo: 'happysoysaucemin/dateofhappy',
    path: 'readings.json',
    branch: 'main',
    apiBase: 'https://api.github.com',   // 若某网络环境不可达，只改这一行

    alertDays: 3,                 // 预计可用天数低于此值 → 告警
    slotHour: { am: 7, pm: 19 },  // 早/晚抄表对应的默认小时
    tz: '+08:00',

    localKey: 'dianji.v1.data',
    prefKey: 'dianji.v1.pref'
  };
})(typeof window !== 'undefined' ? window : globalThis);
