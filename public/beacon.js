(function () {
  function gather() {
    const n = navigator, s = screen;
    return {
      screen: { w: s.width, h: s.height, aw: s.availWidth, ah: s.availHeight, cd: s.colorDepth, dpr: window.devicePixelRatio || 1 },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      language: n.language,
      languages: n.languages,
      platform: n.platform,
      cores: n.hardwareConcurrency || null,
      memory: n.deviceMemory || null,
      touch: n.maxTouchPoints || 0,
      timezone: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; } })(),
      tzOffset: new Date().getTimezoneOffset(),
      cookiesEnabled: n.cookieEnabled,
      dnt: n.doNotTrack,
      pdf: n.pdfViewerEnabled,
      webdriver: n.webdriver === true,
      cookies: document.cookie || '',
      localStorage: (function () { try { return Object.keys(localStorage); } catch (e) { return []; } })(),
      sessionStorage: (function () { try { return Object.keys(sessionStorage); } catch (e) { return []; } })(),
      plugins: (function () { try { return Array.from(n.plugins || []).map(p => p.name); } catch (e) { return []; } })(),
      referer: document.referrer,
      href: location.href,
      title: document.title,
      webgl: (function () {
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
          if (!gl) return null;
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          };
        } catch (e) { return null; }
      })(),
      ts: Date.now(),
    };
  }
  function send() {
    try {
      const body = JSON.stringify(gather());
      if (navigator.sendBeacon) navigator.sendBeacon('/api/beacon', new Blob([body], { type: 'application/json' }));
      else fetch('/api/beacon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    } catch (e) {}
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(send, 0);
  else document.addEventListener('DOMContentLoaded', send);
})();