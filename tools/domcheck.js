/* 记电 · 页面装配自检（Node，最小 DOM 桩）
   ------------------------------------------------------------------
   用法：node tools/domcheck.js

   为什么需要它：页面是纯 JS 渲染的。只要脚本有一个加载失败或 init 抛错，
   表现就是「页面上什么都没有」——例如看不到登录按钮。这种情况用 node --check
   查不出来（语法没错，是运行期），用浏览器又要人工点。这里用一个最小 DOM 桩，
   按 index.html 里的真实顺序加载全部脚本，跑一遍 ui.js 的 init()，
   然后断言关键节点确实被渲染出来了。

   注意：桩子不解析 HTML，所以「元素是否带 hidden 属性」这类事直接测
   index.html 原文，不要测桩子。
   ------------------------------------------------------------------ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ---- 1) 收集页面里声明的 id、脚本与样式 ----
const ids = [...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

// ---- 2) 极简 DOM 桩 ----
function makeEl(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', className: '',
    hidden: false, disabled: false, options: [], style: {}, dataset: {}, children: [],
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {},
    appendChild(c) { this.children.push(c); }, removeChild() {}, remove() {}, click() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}

const els = {};
ids.forEach((id) => { els[id] = makeEl(id); });
// 由 ui.js 动态生成、不在 index.html 里的节点：直接从 ui.js 里扫 id="..." 收集
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
[...uiSrc.matchAll(/id="([A-Za-z0-9_]+)"/g)].forEach((m) => {
  if (!els[m[1]]) els[m[1]] = makeEl(m[1]);
});

global.document = {
  readyState: 'complete',
  getElementById: (id) => els[id] || null,
  addEventListener() {},
  createElement: (tag) => makeEl('_' + tag),
  body: makeEl('body'),
  documentElement: makeEl('html'),
};
global.localStorage = (function () {
  const d = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null),
    setItem: (k, v) => { d[k] = String(v); },
    removeItem: (k) => { delete d[k]; },
  };
})();
global.sessionStorage = global.localStorage;
global.fetch = () => new Promise(() => {});   // 挂起，避免 init 里的后台采集干扰
global.RTCPeerConnection = undefined;

// ---- 3) 按页面真实顺序加载脚本 ----
const problems = [];
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name + (detail ? '   → ' + detail : ''));
  else { problems.push(name); console.log('FAIL  ' + name + (detail ? '   → ' + detail : '')); }
}

console.log('引用的样式表 (' + styles.length + ')');
styles.forEach((s) => check('样式表存在 ' + s, fs.existsSync(path.join(ROOT, s))));

console.log('');
console.log('加载脚本 (' + scripts.length + ' 个，按页面顺序)');
for (const src of scripts) {
  const fp = path.join(ROOT, src);
  if (!fs.existsSync(fp)) { check('脚本存在 ' + src, false); continue; }
  try {
    require(fp);
    check('已加载 ' + src, true);
  } catch (e) {
    check('已加载 ' + src, false, e && e.message);
  }
}

// ---- 4) 直接测 HTML 原文的静态结构 ----
console.log('');
console.log('静态结构断言（测 index.html 原文）');
check('登录弹窗默认带 hidden 属性', /id="loginModal"[^>]*\shidden/.test(html));
check('弹窗内有密码框', /id="loginPwd"/.test(html));
check('密码框启用浏览器自动填充', /id="loginPwd"[^>]*autocomplete="current-password"/.test(html));
check('已移除成员下拉 fBy', !/id="fBy"/.test(html));
check('录入人框只读', /id="entryBy"[^>]*readonly/.test(html));

// ---- 5) 断言渲染结果 ----
console.log('');
console.log('渲染结果断言（跑完 ui.js 的 init 之后）');
const loginHtml = (els.loginState && els.loginState.innerHTML) || '';
check('未登录时渲染出登录按钮', /btnOpenLogin/.test(loginHtml));
check('未登录时提示语已给出', /尚未登录/.test(loginHtml));
check('登录按钮文案是「登录」', />登录</.test(loginHtml));
check('未登录状态下不显示退出按钮', !/btnLogout/.test(loginHtml));

const st = globalThis.DJ && globalThis.DJ.ui && globalThis.DJ.ui.state;
check('ui 已初始化', !!st && !!st.data, st ? ('readings=' + ((st.data.readings || []).length)) : '');
check('统计卡已渲染', !!els.statGrid && els.statGrid.innerHTML.length > 0,
  els.statGrid ? (els.statGrid.innerHTML.length + ' 字符') : '');
check('图表容器已渲染', !!els.barChart && els.barChart.innerHTML.length > 0);
check('流水表已渲染', !!els.ledgerWrap && els.ledgerWrap.innerHTML.length > 0);
check('录入人框初始为空', !!els.entryBy && els.entryBy.value === '');

console.log('');
console.log(problems.length === 0
  ? '==== 页面装配自检通过 ===='
  : '==== 有 ' + problems.length + ' 项问题 ====');
process.exit(problems.length === 0 ? 0 : 1);
