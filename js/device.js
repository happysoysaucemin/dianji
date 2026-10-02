/* 记电 · 设备信息
   浏览器不会告诉网页设备型号 —— iOS 的 UA 里只有 "iPhone"，不带机型；
   Android 的 UA 里通常带机型串（如 SM-G9980）。所以这里能解析多少记多少，
   拿不到就留空，绝不猜或伪造。
   导出的 parseUA 是纯函数，便于离线自测。 */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  function parseUA(ua) {
    ua = String(ua || '');
    var out = { os: '', browser: '', model: '', type: 'desktop' };
    var m;

    if (/iPhone/.test(ua)) {
      out.os = 'iOS';
      out.type = 'phone';
      if ((m = /OS (\d+)[_.](\d+)/.exec(ua))) out.os = 'iOS ' + m[1] + '.' + m[2];
    } else if (/iPad/.test(ua)) {
      out.os = 'iPadOS';
      out.type = 'tablet';
    } else if ((m = /Android[\s/]([\d.]+)/.exec(ua))) {
      out.os = 'Android ' + m[1];
      out.type = /Mobile/.test(ua) ? 'phone' : 'tablet';
    } else if (/Windows NT 10/.test(ua)) {
      out.os = 'Windows 10/11';
    } else if (/Windows NT 6\.1/.test(ua)) {
      out.os = 'Windows 7';
    } else if ((m = /Mac OS X (\d+)[_.](\d+)/.exec(ua))) {
      out.os = 'macOS ' + m[1] + '.' + m[2];
    } else if (/CrOS/.test(ua)) {
      out.os = 'ChromeOS';
    } else if (/Linux/.test(ua)) {
      out.os = 'Linux';
    }

    // Android 机型串：形如 "Android 13; SM-G9980 Build/..."
    if (out.type === 'phone' || out.type === 'tablet') {
      if ((m = /Android[^;)]*;\s*([^;)]+?)\s*(?:Build|\))/i.exec(ua))) {
        var cand = m[1].trim().replace(/\s+/g, ' ');
        if (cand && !/^wv$/i.test(cand) && cand.length <= 40) out.model = cand;
      }
    }

    // 浏览器（顺序有讲究：Edge/Opera 的 UA 里也含 Chrome）
    if ((m = /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua))) out.browser = 'Edge ' + m[1];
    else if ((m = /OPR\/(\d+)/.exec(ua))) out.browser = 'Opera ' + m[1];
    else if ((m = /MicroMessenger\/(\d+)/.exec(ua))) out.browser = '微信 ' + m[1];
    else if ((m = /Chrome\/(\d+)/.exec(ua))) out.browser = 'Chrome ' + m[1];
    else if ((m = /Firefox\/(\d+)/.exec(ua))) out.browser = 'Firefox ' + m[1];
    else if ((m = /Version\/(\d+)[\d.]*\s+Mobile.*Safari/.exec(ua))) out.browser = 'Safari ' + m[1];
    else if ((m = /Version\/(\d+)[\d.]*\s+Safari/.exec(ua))) out.browser = 'Safari ' + m[1];

    return out;
  }

  /** 采集当前设备的可获取信息 */
  function collect() {
    var nav = (typeof navigator !== 'undefined') ? navigator : {};
    var scr = (typeof screen !== 'undefined') ? screen : {};
    var ua = nav.userAgent || '';
    var d = parseUA(ua);
    return {
      ua: ua,
      os: d.os,
      browser: d.browser,
      model: d.model,
      type: d.type,
      lang: nav.language || '',
      screen: (scr.width && scr.height) ? (scr.width + 'x' + scr.height) : ''
    };
  }

  /** 压成一行短描述，便于在流水表里显示 */
  function label(dev) {
    if (!dev) return '';
    var bits = [];
    if (dev.model) bits.push(dev.model);
    if (dev.os) bits.push(dev.os);
    if (dev.browser) bits.push(dev.browser);
    return bits.join(' · ');
  }

  DJ.device = { parseUA: parseUA, collect: collect, label: label };
})(typeof window !== 'undefined' ? window : globalThis);
