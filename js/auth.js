/* 记电 · 登录与鉴权层（v4：交错加密方案）
   ------------------------------------------------------------------
   密码怎么来（由 tools/make-passwords.js 生成）：
     密码 = 交错(用户标识 ID, 凯撒(token, 位移))
     交错规则：前 min(len(ID), len(密文)) 对交替 —— ID₀ 密文₀ ID₁ 密文₁ …
               剩余字符（实际是 token 的尾巴）原样追加
     ID 为 32 位用户标识（由你指定，随机、无规律，写在 js/auth-table.js 的名单里），
     位移就是该成员对应的凯撒位数（3 / 1 / 4 / 5 / 6）。

   登录时怎么反着解：
     1. 按「ID 在偶数位」和「ID 在奇数位」两种顺序各拆一次，得到两个候选 ID
     2. 候选 ID 命中名单 → 既确认了身份，也拿到了该成员的位移
     3. 另一半 + 尾巴 拼回密文 → 反向凯撒 → 真实 token
     4. token 只存内存 / 会话级 sessionStorage，**绝不写 localStorage**

   凯撒字符集（每一类各自循环，互不干扰）：
     数字 0-9 → 在 0-9 内循环（例：9 右移一位 = 0）
     小写字母 → 在 a-z 内循环        大写字母 → 在 A-Z 内循环
     其它字符（如 token 里的下划线）→ 原样不动
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  var LOWER = 'abcdefghijklmnopqrstuvwxyz';
  var UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var DIGIT = '0123456789';

  var CONF = {
    persist: 'session',  // 'session' = 存 sessionStorage（关浏览器即失效）；'memory' = 只在内存
    table: []            // 由 js/auth-table.js 提供：[{ by, id, shift }]
  };

  var SESS_KEY = 'dianji.v1.session';
  var mem = null;

  // ---------------- 凯撒 ----------------
  function caesarChar(c, shift, dir) {
    var set = null;
    if (DIGIT.indexOf(c) >= 0) set = DIGIT;
    else if (LOWER.indexOf(c) >= 0) set = LOWER;
    else if (UPPER.indexOf(c) >= 0) set = UPPER;
    if (!set) return c;
    var n = set.length;
    return set[(((set.indexOf(c) + dir * shift) % n) + n) % n];
  }

  function caesar(text, shift, dir) {
    var out = '';
    for (var i = 0; i < text.length; i++) out += caesarChar(text.charAt(i), shift, dir);
    return out;
  }

  // ---------------- 交错 / 反交错 ----------------
  /** 交错：以 idLen 对交替，剩余密文（token 尾巴）原样追加 */
  function interleave(id, src, idFirst) {
    var n = Math.min(id.length, src.length);
    var out = '';
    for (var i = 0; i < n; i++) {
      out += idFirst ? (id.charAt(i) + src.charAt(i)) : (src.charAt(i) + id.charAt(i));
    }
    out += src.slice(n);
    if (id.length > n) out += id.slice(n);
    return out;
  }

  /** 反交错：按给定顺序拆出候选 ID 与密文 */
  function split(pwd, idLen, idFirst) {
    if (pwd.length < idLen * 2) return null;
    var id = '', ct = '';
    for (var i = 0; i < idLen; i++) {
      var a = pwd.charAt(i * 2);
      var b = pwd.charAt(i * 2 + 1);
      if (idFirst) { id += a; ct += b; } else { id += b; ct += a; }
    }
    ct += pwd.slice(idLen * 2);
    return { id: id, ct: ct };
  }

  // ---------------- 编 / 解码 ----------------
  /** 生成登录密码（工具与自测共用） */
  /** 生成登录密码。交错时密文在偶数位、ID 在奇数位（与样例 2F 3D 4C 50 64… 一致）。
   *  读取端两种顺序都会尝试，所以顺序不会成为兼容性问题。 */
  function encodePassword(token, id, shift) {
    return interleave(id, caesar(token, shift, 1), false);
  }

  /** 从登录密码解出 { by, id, shift, token }；失败返回 null */
  function decodePassword(pwd) {
    var p = String(pwd == null ? '' : pwd).trim();
    if (!enabled()) return null;
    var idLen = CONF.table[0].id.length;

    var orders = [true, false];
    for (var k = 0; k < orders.length; k++) {
      var s = split(p, idLen, orders[k]);
      if (!s) continue;
      var hit = null;
      for (var i = 0; i < CONF.table.length; i++) {
        if (CONF.table[i].id === s.id) { hit = CONF.table[i]; break; }
      }
      if (!hit) continue;
      return {
        by: hit.by,
        id: hit.id,
        shift: hit.shift,
        token: caesar(s.ct, hit.shift, -1)
      };
    }
    return null;
  }

  // ---------------- 会话 ----------------
  function readSession() {
    if (CONF.persist !== 'session') return null;
    try {
      var raw = sessionStorage.getItem(SESS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeSession(v) {
    if (CONF.persist !== 'session') return;
    try { sessionStorage.setItem(SESS_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESS_KEY); } catch (e) { /* ignore */ }
  }

  function setCurrent(v) { mem = v; writeSession(v); }
  function current() { return mem || readSession(); }
  function token() { var c = current(); return c ? c.token : null; }
  function by() { var c = current(); return c ? c.by : ''; }
  function enabled() { return !!(CONF.table && CONF.table.length); }

  function setTable(list) {
    CONF.table = (list || []).filter(function (x) { return x && x.by && x.id; })
      .map(function (x) { return { by: x.by, id: String(x.id), shift: Number(x.shift) || 0 }; });
    return CONF.table.length;
  }
  function members() { return CONF.table.map(function (x) { return x.by; }); }

  /**
   * 本地预鉴权 + 建立会话。
   * @returns Promise<{ok:true, by, token} | {ok:false, reason}>
   */
  function login(pwd) {
    var p = String(pwd == null ? '' : pwd).trim();
    if (!p) return Promise.resolve({ ok: false, reason: '请输入登录密码' });

    // 尚未配置名单时：把输入直接当完整 token（便于先把功能跑通）
    if (!enabled()) {
      if (p.length < 20) {
        return Promise.resolve({
          ok: false,
          reason: '请输入完整 token，或先运行 node tools/make-passwords.js … --write 生成 5 份登录密码'
        });
      }
      var v0 = { by: '未署名', token: p, at: Date.now() };
      setCurrent(v0);
      return Promise.resolve({ ok: true, by: v0.by, token: p, direct: true });
    }

    var got = decodePassword(p);
    if (!got) return Promise.resolve({ ok: false, reason: '登录密码不正确（用户标识对不上名单）' });
    if (!got.token || got.token.length < 20) {
      return Promise.resolve({ ok: false, reason: '密码里还原出的 token 不合法，请确认生成时用的位数与字符集' });
    }

    var v = { by: got.by, token: got.token, at: Date.now() };
    setCurrent(v);
    return Promise.resolve({ ok: true, by: v.by, token: v.token });
  }

  function logout() { mem = null; clearSession(); }

  DJ.auth = {
    conf: CONF,
    login: login,
    logout: logout,
    current: current,
    token: token,
    by: by,
    enabled: enabled,
    members: members,
    setTable: setTable,
    caesar: caesar,
    interleave: interleave,
    split: split,
    encodePassword: encodePassword,
    decodePassword: decodePassword
  };

  // 吸收名单（js/auth-table.js，由 tools/make-passwords.js 重写）
  if (Array.isArray(DJ.authTable) && DJ.authTable.length) setTable(DJ.authTable);
})(typeof window !== 'undefined' ? window : globalThis);
