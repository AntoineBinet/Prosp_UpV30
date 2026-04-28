/* ProspUp v30 — helper window.callOllama (extrait minimal de l'app.js legacy)
   Conserve la signature `callOllama(prompt, { stream, timeoutMs, model, webSearch })`
   utilisée par /v30/rapport et /v30/stats. Mode non-streaming uniquement —
   les pages v30 qui veulent du streaming appellent directement
   /api/ollama/generate-stream. */
(function () {
  'use strict';

  if (typeof window.callOllama === 'function') return;

  window.callOllama = async function (prompt, options) {
    options = options || {};
    var timeoutMs = options.timeoutMs != null
      ? Math.max(10000, Math.min(600000, options.timeoutMs))
      : 180000;

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    var body = { prompt: prompt };
    if (options.model)     body.model = options.model;
    if (options.webSearch) body.web_search = true;
    body.timeout = Math.min(600, Math.ceil(timeoutMs / 1000));

    try {
      var res = await fetch('/api/ollama/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      var data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok || data.ok === false) {
        var msg = data.error || ('Erreur ' + res.status);
        throw new Error(msg);
      }
      return (data.text || data.response || '').toString();
    } finally {
      clearTimeout(timer);
    }
  };
})();
