/* 记电 · 真实网络自检
   ------------------------------------------------------------------
   用法：
     GH_TOKEN=<fine-grained-token> node tools/netcheck.js [owner/repo] [--write]
     （或：GH_TOKEN=<token> npm run netcheck ／ npm run netcheck -- --write）

   不加 --write（默认）：**全程只读**，不产生任何提交
     1. ghProbe  —— 仓库是否可见、是否已私有、默认分支
     2. ghRead   —— 走真实 Contents API 读回账本，验证 base64 解码与中文
     3. 口径核对 —— 用读回的记录重算 consumed / 日均 / 耗尽预测

   加 --write：在只读检查之外，再做一次**幂等写回**（内容不变，只刷新 updated_at），
     用来验证页面真正会用到的那条写路径与 token 的 Contents 写权限。
     它会在仓库里留下一个「写入链路验证」的提交 —— 这是唯一会产生副作用的模式。
   ------------------------------------------------------------------ */
'use strict';

var path = require('path');
var JS = path.join(__dirname, '..', 'js');
['config.js', 'calc.js', 'store.js'].forEach(function (f) {
  require(path.join(JS, f));
});
var DJ = globalThis.DJ;

var args = process.argv.slice(2);
var verifyWrite = args.indexOf('--write') >= 0;
var repoArg = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];
var token = process.env.GH_TOKEN;
var repo = repoArg || DJ.config.repo;

if (!token) {
  console.error('用法：GH_TOKEN=<fine-grained-token> node tools/netcheck.js [owner/repo] [--write]');
  process.exit(2);
}

var cfg = { repo: repo, pat: token };
var failed = 0;

DJ.store.ghProbe(cfg)
  .then(function (p) {
    if (p.ok) {
      console.log('仓库自检   : OK');
      console.log('  仓库     : ' + p.repo);
      console.log('  可见性   : ' + (p.isPrivate ? '私有 ✓' : '公开 ⚠'));
      console.log('  默认分支 : ' + p.defaultBranch);
      if (p.warn) console.log('  警告     : ' + p.warn);
    } else {
      failed++;
      console.log('仓库自检   : FAIL');
      console.log('  原因     : ' + p.reason);
    }
    return DJ.store.ghRead(cfg);
  })
  .then(function (r) {
    var list = (r.data && r.data.readings) || [];
    console.log('读取账本   : OK  ' + list.length + ' 条记录  blob sha=' + String(r.sha).slice(0, 12));
    console.log('  账本     : ' + r.data.ledger + ' · 单位 ' + r.data.unit + ' · 单价 ' + r.data.unit_price_cny);

    var enr = DJ.calc.enrich(list);
    console.log('  本期消耗 : ' + enr.map(function (x) {
      return x.consumed === null ? '—' : x.consumed;
    }).join(', '));

    var st = DJ.calc.stats(enr, { now: new Date('2026-09-28T08:00:00+08:00') });
    console.log('  当前余额 : ' + st.current + ' 度 = ' + st.currentCny + ' 元');
    console.log('  近 7 日均耗: ' + DJ.calc.round2(st.avg7) + ' 度/天');
    console.log('  预计可用 : ' + DJ.calc.round2(st.daysLeft) + ' 天（约 ' + st.emptyDateStr + ' 耗尽）');

    if (!verifyWrite) return null;

    console.log('');
    console.log('写入验证   : 进行中（幂等写回，内容不变，会留下一个提交）…');
    var doc = DJ.store.normalize(r.data);
    doc.updated_at = new Date().toISOString();
    return DJ.store.ghWrite(cfg, doc, r.sha, '写入链路验证（内容未变更）')
      .then(function (res) {
        var sha = (res && res.commit && res.commit.sha) || '';
        console.log('写入验证   : OK  新 commit = ' + String(sha).slice(0, 12));
        return DJ.store.ghRead(cfg);
      })
      .then(function (r2) {
        console.log('  回读     : ' + ((r2.data.readings) || []).length
          + ' 条  blob sha=' + String(r2.sha).slice(0, 12));
      })
      .catch(function (e) {
        failed++;
        console.log('写入验证   : FAIL —— ' + (e && e.message ? e.message : e));
      });
  })
  .then(function () {
    console.log('');
    console.log(failed === 0 ? '==== 网络自检通过 ====' : '==== 网络自检有问题 ====');
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(function (e) {
    console.log('读取账本   : FAIL —— ' + (e && e.message ? e.message : e));
    process.exit(1);
  });
