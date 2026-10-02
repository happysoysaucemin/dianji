/* 记电 · 上传环境信息
   ------------------------------------------------------------------
   每条记录都要带上「谁在什么时候、从哪个 IP 传的」。其中：

   公网 IP：浏览器无法直接知道，必须请求一个外部服务。这里按顺序多源回退，
            全部失败就留空（不阻塞数据写入）。
   内网 IP：**现代浏览器已经主动屏蔽真实内网 IP** —— WebRTC 只会给出
            mDNS 混淆地址（形如 8f2a-1b3c.local）。这里尽力而为：能拿到
            私有网段地址就记真的，拿不到就记 mDNS 标识，再拿不到就留空，
            并在 note 里标明来源，避免把无效值当成真实内网 IP。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};

  var PUBLIC_SOURCES = [
    { url: 'https://api.ipify.org?format=json', pick: function (j) { return j && j.ip; } },
    { url: 'https://ipapi.co/json/', pick: function (j) { return j && j.ip; } },
    { url: 'https://ipinfo.io/json', pick: function (j) { return j && j.ip; } },
    { url: 'https://api.ip.sb/geoip', pick: function (j) { return j && j.ip; } }
  ];

  var CACHE_MS = 10 * 60 * 1000;
  var cache = null;

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(promise).then(function (v) {
        clearTimeout(t); resolve(v);
      }, function (e) {
        clearTimeout(t); reject(e);
      });
    });
  }

  /** 公网 IP：多源顺序回退 */
  function fetchPublic(timeoutMs) {
    var i = 0;
    function next() {
      if (i >= PUBLIC_SOURCES.length) return Promise.resolve({ value: '', note: 'all-failed' });
      var src = PUBLIC_SOURCES[i++];
      return withTimeout(fetch(src.url, { cache: 'no-store' }), timeoutMs || 4000)
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (j) {
          var ip = src.pick(j);
          if (!ip) throw new Error('empty');
          return { value: String(ip).trim(), note: src.url };
        })
        .catch(function () { return next(); });
    }
    return next();
  }

  /** 内网地址：WebRTC 尽力而为（多数情况只能拿到 mDNS 混淆名） */
  function fetchLocal(timeoutMs) {
    return new Promise(function (resolve) {
      if (typeof RTCPeerConnection === 'undefined') {
        resolve({ value: '', note: 'no-webrtc' });
        return;
      }
      var pc = null, done = false;
      var hits = [];
      function finish(note) {
        if (done) return;
        done = true;
        try { if (pc) pc.close(); } catch (e) { /* ignore */ }
        resolve({ value: hits[0] || '', note: hits.length ? 'webrtc' : note });
      }
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('probe');
        pc.onicecandidate = function (e) {
          if (!e || !e.candidate) { finish('done'); return; }
          var m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})|([0-9a-f][0-9a-f-]{6,}\.local)/i.exec(e.candidate.candidate);
          if (m && hits.indexOf(m[0]) < 0) hits.push(m[0]);
        };
        pc.createOffer()
          .then(function (o) { return pc.setLocalDescription(o); })
          .catch(function () { finish('error'); });
        setTimeout(function () { finish('timeout'); }, timeoutMs || 2500);
      } catch (e) {
        finish('error');
      }
    });
  }

  /** 并发采集；结果只用于「追加到记录上」，任何失败都不影响写入 */
  function collect(opts) {
    opts = opts || {};
    return Promise.all([fetchPublic(opts.publicTimeout), fetchLocal(opts.localTimeout)])
      .then(function (r) {
        cache = {
          at: new Date().toISOString(),
          public: r[0].value || '',
          publicNote: r[0].note || '',
          local: r[1].value || '',
          localNote: r[1].note || ''
        };
        return cache;
      });
  }

  /** 取缓存（10 分钟内有效），过期或不存在时重新采集 */
  function cached(opts) {
    opts = opts || {};
    if (cache && !opts.force) {
      var age = Date.now() - new Date(cache.at).getTime();
      if (age >= 0 && age < CACHE_MS) return Promise.resolve(cache);
    }
    return collect(opts);
  }

  DJ.netinfo = {
    collect: collect,
    cached: cached,
    fetchPublic: fetchPublic,
    fetchLocal: fetchLocal
  };
})(typeof window !== 'undefined' ? window : globalThis);
