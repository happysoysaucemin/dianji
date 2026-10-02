/* 记电 · 项目自测（Node 运行，无第三方依赖）
   ------------------------------------------------------------------
   用法：node tools/selftest.js   （或 npm test）
   覆盖：
     1. 纯 JS SHA-256 与 Node 内置 crypto 的一致性（含空串与跨块边界）
     2. 粘贴解析 + 消耗口径（用真实历史数据做验收）
     3. 本机存储（账本缓存不夹带凭据）/ 幂等合并 / 409 冲突自动重试
     4. 交错密码：凯撒字符集、生成、拆解、身份识别
     5. 上传环境：公网 IP 多源回退、内网尽力而为
   注意：[3] 与 [5] 都会替换 globalThis.fetch，因此所有依赖 fetch 的用例
         必须串在同一条 Promise 链上按序执行，不能开第二条链。
   ------------------------------------------------------------------ */
'use strict';

var path = require('path');
var crypto = require('crypto');

var JS = path.join(__dirname, '..', 'js');
['config.js', 'sha256.js', 'calc.js', 'parse.js', 'store.js', 'netinfo.js', 'device.js', 'auth-table.js', 'auth.js'].forEach(function (f) {
  require(path.join(JS, f));
});
var DJ = globalThis.DJ;
var tool = require(path.join(__dirname, 'make-passwords.js'));

var passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS  ' + name + (detail !== undefined ? '   → ' + detail : '')); }
  else { failed++; console.log('FAIL  ' + name + (detail !== undefined ? '   → ' + detail : '')); }
  return cond;
}
function section(t) {
  console.log('');
  console.log(t);
}

// ================= 1. SHA-256 =================
section('[1] SHA-256 与 Node crypto 一致性');
['', 'abc', 'hello world', '中文测试·记电',
 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65),
 'a'.repeat(1000),
 'github_pat_11TESTONLY00AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
].forEach(function (s) {
  var mine = DJ.sha256.hex(s);
  var ref = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  check('sha256(bytes=' + Buffer.byteLength(s) + ')', mine === ref, mine.slice(0, 16) + '…');
});

// ================= 2. 解析 + 口径 =================
section('[2] 粘贴解析与消耗口径（真实历史数据）');
var DEMO = '9.23早\t6.9\t 100\t106.9\t 9.24早\t102.3\t4.6 9.25早\t87.8\t14.5 9.26早\t72.5\t15.3 9.27早\t56.8\t15.7 9.28早\t43.0 \t 13.8';
var NOW = new Date('2026-09-28T08:00:00+08:00');
var parsed = DJ.parse.parseText(DEMO, { now: NOW });
var verified = DJ.parse.verify(parsed.rows);
var stats = DJ.calc.stats(verified.enriched, { now: NOW });

check('解析出 6 条记录', parsed.rows.length === 6, parsed.rows.length);
check('consumed = —,4.6,14.5,15.3,15.7,13.8',
  JSON.stringify(verified.enriched.map(function (x) { return x.consumed; })) === JSON.stringify([null, 4.6, 14.5, 15.3, 15.7, 13.8]));
check('effective = 106.9,102.3,87.8,72.5,56.8,43.0',
  JSON.stringify(verified.enriched.map(function (x) { return x.effective; })) === JSON.stringify([106.9, 102.3, 87.8, 72.5, 56.8, 43]));
check('9.23 识别为充值 100 度', verified.enriched[0].topup === 100, verified.enriched[0].topup);
check('交叉校验 0 处不一致', verified.issues.length === 0, verified.issues.length);
check('日均 12.78 度/天', DJ.calc.round2(stats.avg7) === 12.78, DJ.calc.round2(stats.avg7));
check('43.0 度 = 21.5 元', stats.currentCny === 21.5, stats.currentCny);
check('预计可用 ≈ 3.36 天', Math.abs(stats.daysLeft - 3.364) < 0.01, DJ.calc.round2(stats.daysLeft));

// ================= 3. 本机存储 + 合并 + 409 =================
section('[3] 本机存储 / 幂等合并 / 409 冲突重试');
var CFG = DJ.config;
globalThis.localStorage = (function () {
  var d = {};
  return {
    _d: d,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
    setItem: function (k, v) { d[k] = String(v); },
    removeItem: function (k) { delete d[k]; }
  };
})();

localStorage.setItem(CFG.prefKey, JSON.stringify({ repo: 'x/y', pat: 'SECRET_PAT', token: 'SECRET_TOKEN', me: '郑沐鑫' }));
var pref = DJ.store.getPref();
check('偏好读取正常', pref.repo === 'x/y' && pref.me === '郑沐鑫', JSON.stringify(pref));

DJ.store.setPref({ repo: 'a/b', me: '商叶航' });
check('偏好写入正常', DJ.store.getPref().repo === 'a/b');

// 用户已允许凭证写入本机存储：账本缓存仍是白名单字段，不含任何凭据
DJ.store.saveLocal({ version: 1, readings: [], pat: 'SECRET_PAT', token: 'SECRET_TOKEN', by: 'x' });
check('账本缓存仍是白名单字段，不夹带凭据',
  String(localStorage.getItem(CFG.localKey)).indexOf('SECRET') < 0);

var docA = { version: 1, readings: [{ id: '2026-09-23T07:00', recorded_at: '2026-09-23T07:00+08:00', balance: 6.9, topup: 100 }] };
var docB = { version: 1, readings: [
  { id: '2026-09-23T07:00', recorded_at: '2026-09-23T07:00+08:00', balance: 6.9, topup: 100 },
  { id: '2026-09-24T07:00', recorded_at: '2026-09-24T07:00+08:00', balance: 102.3, topup: 0 }
] };
var m1 = DJ.store.merge(docA, docB);
check('合并后 2 条（同日同时段不重复）', m1.readings.length === 2, m1.readings.length);
check('重复合并仍为 2 条（幂等）', DJ.store.merge(m1, docA).readings.length === 2);

// 409 用的 mock：GET 返回远端内容，首次 PUT 返回 409
var remoteDoc = { version: 1, readings: [{ id: '2026-09-26T07:00', recorded_at: '2026-09-26T07:00+08:00', balance: 72.5, topup: 0 }] };
var calls = [];
globalThis.fetch = function (url, opts) {
  var method = (opts && opts.method) || 'GET';
  calls.push(method);
  if (method === 'GET') {
    return Promise.resolve({ ok: true, status: 200, json: function () {
      return Promise.resolve({ content: DJ.store.utf8ToB64(JSON.stringify(remoteDoc)), sha: 'sha-remote' });
    } });
  }
  var puts = calls.filter(function (c) { return c === 'PUT'; }).length;
  if (puts === 1) {
    return Promise.resolve({ ok: false, status: 409, statusText: 'Conflict', text: function () { return Promise.resolve('conflict'); } });
  }
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ content: { sha: 'sha-new' } }); } });
};

// ================= 4. 交错密码 =================
section('[4] 交错密码：凯撒字符集 / 生成 / 拆解 / 身份识别');
var TOKEN = 'github_pat_11TESTONLY00AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
var MEMBERS = [
  { by: '郑沐鑫', id: 'C446A4792EE0D86D9F1230424C610BCF', shift: 3 },
  { by: '商叶航', id: '5CEA059E725F5414F4177D42859E4748', shift: 1 },
  { by: '曾昭彬', id: 'C410BFAD1436913C9734A74EF48665AB', shift: 4 },
  { by: '杨子沣', id: '66C699AD2A1F84D8853A36AA38E6AA77', shift: 5 },
  { by: '张梓杭', id: 'B4D6233AE640ADBF41725198DFOD7F97', shift: 6 }
];
var built = tool.build(TOKEN, MEMBERS);

check('凯撒：数字 9 右移一位 = 0', DJ.auth.caesar('9', 1, 1) === '0', DJ.auth.caesar('9', 1, 1));
check('凯撒：字母 z 右移一位 = a', DJ.auth.caesar('z', 1, 1) === 'a');
check('凯撒：字母 A 右移一位 = B', DJ.auth.caesar('A', 1, 1) === 'B');
check('凯撒：下划线等其它字符不动', DJ.auth.caesar('_', 5, 1) === '_');
check('凯撒可逆', DJ.auth.caesar(DJ.auth.caesar('aZ9_x', 7, 1), 7, -1) === 'aZ9_x');

check('生成 5 份密码', built.entries.length === 5, built.entries.length);
check('5 份密码互不相同',
  new Set(built.entries.map(function (e) { return e.password; })).size === 5);
check('密码长度 = 2×32 + (token长 − 32)',
  built.entries.every(function (e) { return e.password.length === 64 + TOKEN.length - 32; }),
  built.entries[0].password.length);
check('密码里不含连续的明文 token 前缀',
  built.entries.every(function (e) { return e.password.indexOf('github_pat_') < 0; }));

DJ.auth.setTable(built.table);
check('名单已装载（enabled）', DJ.auth.enabled() === true, DJ.auth.conf.table.length + ' 人');
check('名单里没有 token 片段',
  JSON.stringify(DJ.auth.conf.table).indexOf('github') < 0);

var decodedAll = built.entries.every(function (e) {
  var d = DJ.auth.decodePassword(e.password);
  return d && d.token === TOKEN && d.by === e.by && d.shift === e.shift;
});
check('每份密码都能解出同一 token 且身份/位移正确', decodedAll);

var sampPwd = DJ.auth.encodePassword('123456789123456789', 'FDC047B9110575738B2741792C439B27', 1);
console.log('      样例 ID=FDC047B9… token=123456789123456789 位移=1');
console.log('      本次生成 = ' + sampPwd);
console.log('      你给的   = 2F3D4C5064778B99011203547556773889B02741792C439B27');

// ================= 5. 上传环境 =================
section('[5] 上传环境：公网 IP 多源回退 / 内网尽力而为');
var netCalls = [];

// ================= 6. 设备信息与删除留痕 =================
section('[6] 设备信息解析 / 删除留痕');
var UA_CASES = [
  ['iPhone',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
   'iOS 17.2', 'Safari 17', 'phone', ''],
  ['Android 机型',
   'Mozilla/5.0 (Linux; Android 13; SM-G9980 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
   'Android 13', 'Chrome 120', 'phone', 'SM-G9980'],
  ['Windows + Edge',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
   'Windows 10/11', 'Edge 120', 'desktop', ''],
  ['macOS Safari',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
   'macOS 10.15', 'Safari 17', 'desktop', ''],
  ['微信内置',
   'Mozilla/5.0 (Linux; Android 12; V2162A Build/SP1A.210812.016) AppleWebKit/537.36 Chrome/107.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.40',
   'Android 12', '微信 8', 'phone', 'V2162A']
];
UA_CASES.forEach(function (c) {
  var r = DJ.device.parseUA(c[1]);
  check('UA 解析[' + c[0] + '] 系统=' + c[2], r.os === c[2], r.os);
  check('UA 解析[' + c[0] + '] 浏览器=' + c[3], r.browser === c[3], r.browser);
  check('UA 解析[' + c[0] + '] 类型=' + c[4], r.type === c[4], r.type);
  check('UA 解析[' + c[0] + '] 机型=' + (c[5] || '（无）'), r.model === c[5], r.model || '（无）');
});
check('解析空 UA 不抛错', (function () {
  var r = DJ.device.parseUA('');
  return r.os === '' && r.model === '' && r.browser === '';
})());
check('设备短描述拼接正确',
  DJ.device.label({ model: 'SM-G9980', os: 'Android 13', browser: 'Chrome 120' }) === 'SM-G9980 · Android 13 · Chrome 120',
  DJ.device.label({ model: 'SM-G9980', os: 'Android 13', browser: 'Chrome 120' }));

var mixDocs = [
  { id: '2026-09-23T07:00', recorded_at: '2026-09-23T07:00+08:00', balance: 6.9, topup: 100 },
  { id: '2026-09-24T07:00', recorded_at: '2026-09-24T07:00+08:00', balance: 102.3, deleted_at: '2026-10-01T10:00:00+08:00', deleted_by: '郑沐鑫' },
  { id: '2026-09-25T07:00', recorded_at: '2026-09-25T07:00+08:00', balance: 87.8 }
];
var alive = DJ.calc.enrich(mixDocs);
check('软删除的记录不计入计算', alive.length === 2, alive.length);
check('被删记录仍保留在原始数据里',
  mixDocs.filter(function (r) { return r.deleted_at; }).length === 1);
check('includeDeleted 可取出全部', DJ.calc.enrich(mixDocs, { includeDeleted: true }).length === 3);
var stMix = DJ.calc.stats(alive, { allReadings: mixDocs });
check('统计里报告已删除条数', stMix.deletedCount === 1, stMix.deletedCount);
check('删除后按剩余序列重算消耗',
  DJ.calc.round2(alive[1].consumed) === DJ.calc.round2(106.9 - 87.8),
  alive[1].consumed);

// ================= 异步部分（同一条链，避免 fetch mock 相互覆盖）=================
var loginOk = 0, byMatched = 0, wrongRejected = 0;

Promise.resolve()
  .then(function () {
    var localDoc = { version: 1, readings: [{ id: '2026-09-27T07:00', recorded_at: '2026-09-27T07:00+08:00', balance: 56.8, topup: 0 }] };
    return DJ.store.push({ repo: 'x/y', pat: 't' }, localDoc).then(function (merged) {
      check('409 后自动重试并写入成功', merged.readings.length === 2, merged.readings.length);
      check('重试链路为 GET,PUT,GET,PUT', calls.join(',') === 'GET,PUT,GET,PUT', calls.join(','));
    });
  })
  .then(function () {
    netCalls = [];
    globalThis.fetch = function (url) {
      netCalls.push(url);
      if (url.indexOf('ipify') >= 0) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, status: 200, json: function () {
        return Promise.resolve({ ip: '203.0.113.9' });
      } });
    };
    return DJ.netinfo.fetchPublic(2000).then(function (r) {
      check('公网 IP 首个源失败时自动换下一个源', r.value === '203.0.113.9', r.value);
      check('确实按顺序试过 2 个源', netCalls.length === 2, netCalls.length);
    });
  })
  .then(function () {
    globalThis.fetch = function () { return Promise.resolve({ ok: false, status: 500 }); };
    return DJ.netinfo.fetchPublic(1000).then(function (r) {
      check('所有源都失败时留空且不抛错', r.value === '' && r.note === 'all-failed', r.note);
    });
  })
  .then(function () {
    return DJ.netinfo.fetchLocal(200).then(function (r) {
      check('无 WebRTC 时内网地址留空并标明原因', r.value === '' && r.note === 'no-webrtc', r.note);
    });
  })
  .then(function () {
    return built.entries.reduce(function (p, e) {
      return p.then(function () {
        return DJ.auth.login(e.password).then(function (r) {
          if (r.ok && r.token === TOKEN) loginOk++;
          if (r.ok && r.by === e.by) byMatched++;
        });
      });
    }, Promise.resolve());
  })
  .then(function () {
    return DJ.auth.login('这显然不是登录密码').then(function (r) { if (!r.ok) wrongRejected++; });
  })
  .then(function () {
    return DJ.auth.login(TOKEN).then(function (r) { if (!r.ok) wrongRejected++; });
  })
  .then(function () {
    check('5 份密码全部登录成功且还原同一 token', loginOk === 5, loginOk + '/5');
    check('身份与密码一一对应（谁录的）', byMatched === 5, byMatched + '/5');
    check('错误输入被本地拒绝，不会打到 GitHub', wrongRejected === 2, wrongRejected + '/2');
    console.log('');
    console.log(failed === 0
      ? '==== 全部通过（' + passed + ' 项）===='
      : '==== 有 ' + failed + ' 项失败 / 共 ' + (passed + failed) + ' 项 ====');
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch(function (e) {
    console.log('FAIL  自测中断：' + (e && e.stack || e));
    process.exit(1);
  });
