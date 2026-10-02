/* 记电 · 纯 JS SHA-256（零依赖）
   为什么不用 crypto.subtle：它在 file:// 下不可用（非安全上下文），
   而本页面需要支持「双击 index.html 本地打开」这种用法。
   用途：把 5 份登录密码的摘要写进公开页面用于本地预鉴权。
   密码本体是高熵的长 token，单轮哈希不存在被反查的空间。 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  // FIPS 180-4 轮常量
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /** 输入字符串（UTF-8）或 Uint8Array，返回 32 字节 Uint8Array */
  function sha256Bytes(input) {
    var bytes;
    if (typeof input === 'string') {
      bytes = new TextEncoder().encode(input);
    } else if (input instanceof Uint8Array) {
      bytes = input;
    } else if (Array.isArray(input)) {
      bytes = new Uint8Array(input);
    } else {
      bytes = new TextEncoder().encode(String(input));
    }

    var len = bytes.length;
    var total = ((len + 9 + 63) >> 6) << 6;   // 追加 0x80 + 8 字节长度，补齐到 64 的倍数
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;

    var dv = new DataView(buf.buffer);
    var bitHi = Math.floor(len / 536870912);   // len * 8 的高 32 位
    var bitLo = (len << 3) >>> 0;
    dv.setUint32(total - 8, bitHi);
    dv.setUint32(total - 4, bitLo);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    var i, t, s0, s1, S0, S1, ch, maj, t1, t2;
    var a, b, c, d, e, f, g, h;

    for (i = 0; i < total; i += 64) {
      for (t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4);
      for (t = 16; t < 64; t++) {
        s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3];
      e = H[4]; f = H[5]; g = H[6]; h = H[7];

      for (t = 0; t < 64; t++) {
        S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        ch = (e & f) ^ (~e & g);
        t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
        S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var out = new Uint8Array(32);
    var odv = new DataView(out.buffer);
    for (i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }

  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  /** 返回小写十六进制摘要 */
  function sha256Hex(input) {
    return toHex(sha256Bytes(input));
  }

  DJ.sha256 = { bytes: sha256Bytes, hex: sha256Hex, toHex: toHex };
})(typeof window !== 'undefined' ? window : globalThis);
