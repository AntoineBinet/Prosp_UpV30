/* ProspUp v30 — Paramètres : déploiement + sections natives V30 */
(function () {
  'use strict';

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function setStatus(text, color) {
    var el = $('[data-v30-deploy-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || 'var(--text-3)';
  }
  function appendLog(line) {
    var pre = $('[data-v30-deploy-log]');
    if (!pre) return;
    pre.textContent += line + '\n';
    pre.scrollTop = pre.scrollHeight;
  }
  function resetLog() {
    var pre = $('[data-v30-deploy-log]');
    var sum = $('[data-v30-deploy-summary]');
    var box = $('[data-v30-deploy-results]');
    if (pre) pre.textContent = '';
    if (sum) sum.innerHTML = '';
    if (box) box.hidden = false;
  }
  function setSummary(html) {
    var sum = $('[data-v30-deploy-summary]');
    if (sum) sum.innerHTML = html;
  }
  function lockButtons(locked) {
    ['[data-v30-deploy-pull]', '[data-v30-deploy-rollback]', '[data-v30-deploy-restart]']
      .forEach(function (sel) { var b = $(sel); if (b) b.disabled = locked; });
  }

  // ─── Pull + restart (SSE streaming) ─────────────────────────
  async function doPull() {
    if (!confirm('Mettre à jour le serveur ?\n\n1. Récupération des modifications depuis Git (origin/main)\n2. Snapshot automatique de la base\n3. Redémarrage en ~10 s\n\nLe site sera indisponible environ 10-15 secondes.')) return;
    var btn = $('[data-v30-deploy-pull]');
    var originalLabel = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Mise à jour en cours…';
    lockButtons(true);
    setStatus('Pull en cours…', 'var(--text-2)');
    resetLog();
    var finalData = null;
    try {
      var res = await fetch('/api/deploy/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok || !res.body) {
        var errText = await res.text();
        var errObj = {};
        try { errObj = JSON.parse(errText); } catch (_) {}
        finalData = { step: 'error', error: errObj.error || errText || 'HTTP ' + res.status };
        appendLog('Erreur HTTP ' + res.status + ' : ' + (finalData.error || ''));
      } else {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (var i = 0; i < parts.length; i++) {
            var line = parts[i].trim();
            if (!line.startsWith('data: ')) continue;
            try {
              var data = JSON.parse(line.slice(6));
              if (data.step === 'log' && data.line) appendLog(data.line);
              else if (data.step === 'fetch' && data.message) appendLog(data.message);
              else if (data.step === 'pull' && data.message) appendLog(data.message);
              else if (data.step === 'error') { appendLog('Erreur : ' + (data.error || '')); finalData = data; break; }
              else if (data.step === 'done') finalData = data;
            } catch (_) {}
          }
          if (finalData && (finalData.step === 'error' || finalData.step === 'done')) break;
        }
        if (buffer.trim()) {
          var last = buffer.trim();
          if (last.startsWith('data: ')) {
            try {
              var d = JSON.parse(last.slice(6));
              if (d.step === 'done' || d.step === 'error') finalData = d;
            } catch (_) {}
          }
        }
      }

      if (finalData && finalData.step === 'error') {
        setSummary('<div style="color:var(--danger);font-weight:600;">Erreur : ' + esc(finalData.error) + '</div>');
        setStatus('Échec', 'var(--danger)');
        toast('Erreur lors de la mise à jour', 'error');
        if (btn) btn.innerHTML = originalLabel;
        lockButtons(false);
        return;
      }

      if (finalData && finalData.step === 'done') {
        if (finalData.updated && finalData.restarting) {
          var delay = finalData.restart_delay_s || 10;
          setSummary('<div style="padding:10px;border-radius:var(--r-sm);background:color-mix(in oklab, var(--success) 12%, transparent);border:1px solid color-mix(in oklab, var(--success) 40%, transparent);color:var(--success);font-weight:500;">Mise à jour appliquée. Redémarrage dans ' + delay + ' s… Rechargement automatique.</div>');
          setStatus('Redémarrage…', 'var(--success)');
          toast('Mise à jour appliquée, redémarrage en cours', 'success');
          setTimeout(function () { window.location.reload(); }, 12000);
          return;
        }
        if (finalData.updated) {
          setSummary('<div style="color:var(--success);font-weight:500;">Mise à jour appliquée.</div>');
          setStatus('OK', 'var(--success)');
        } else {
          setSummary('<div class="muted">Déjà à jour. ' + (finalData.local_hash ? 'Commit : <code class="mono">' + esc(finalData.local_hash) + '</code>' : '') + '</div>');
          setStatus('Déjà à jour', 'var(--text-3)');
          toast('Serveur déjà à jour', 'info');
        }
      } else {
        setSummary('<div style="color:var(--danger);">Réponse inattendue.</div>');
      }
    } catch (e) {
      appendLog('Erreur réseau : ' + e.message);
      setSummary('<div style="color:var(--danger);font-weight:500;">Erreur réseau : ' + esc(e.message) + '</div>');
      setStatus('Erreur', 'var(--danger)');
      toast('Erreur réseau', 'error');
    }
    if (btn) btn.innerHTML = originalLabel;
    lockButtons(false);
  }

  // ─── Rollback ───────────────────────────────────────────────
  async function doRollback() {
    if (!confirm('Rollback vers le commit précédent ?\n\nLa base actuelle sera conservée (pas de rollback DB automatique).')) return;
    var btn = $('[data-v30-deploy-rollback]');
    var original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Rollback…';
    lockButtons(true);
    resetLog();
    appendLog('Rollback en cours…');
    setStatus('Rollback…', 'var(--text-2)');
    try {
      var res = await fetch('/api/deploy/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      appendLog('Rollback OK → commit ' + (data.commit || '—'));
      setSummary('<div style="color:var(--success);font-weight:500;">Rollback appliqué. Rechargement dans 12 s…</div>');
      setStatus('Redémarrage…', 'var(--success)');
      toast('Rollback appliqué', 'success');
      setTimeout(function () { window.location.reload(); }, 12000);
    } catch (e) {
      appendLog('Erreur : ' + e.message);
      setSummary('<div style="color:var(--danger);">Erreur : ' + esc(e.message) + '</div>');
      setStatus('Échec', 'var(--danger)');
      toast('Rollback : ' + e.message, 'error');
      if (btn) btn.innerHTML = original;
      lockButtons(false);
    }
  }

  // ─── Restart simple ─────────────────────────────────────────
  async function doRestart() {
    if (!confirm('Redémarrer le serveur (sans pull) ?\n\nLe site sera indisponible environ 10 s.')) return;
    var btn = $('[data-v30-deploy-restart]');
    var original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Redémarrage…';
    lockButtons(true);
    setStatus('Redémarrage…', 'var(--text-2)');
    try {
      var res = await fetch('/api/deploy/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      toast('Redémarrage programmé, rechargement auto dans 12 s', 'info');
      setTimeout(function () { window.location.reload(); }, 12000);
    } catch (e) {
      setStatus('Échec', 'var(--danger)');
      toast('Redémarrage : ' + e.message, 'error');
      if (btn) btn.innerHTML = original;
      lockButtons(false);
    }
  }

  // ─── Remote Git (set-url à distance) ────────────────────────
  async function loadRemote() {
    var span = $('[data-v30-deploy-remote]');
    if (!span) return;
    try {
      var res = await fetch('/api/deploy/remote', { credentials: 'same-origin' });
      var data = await res.json();
      if (data && data.ok) {
        span.textContent = data.url || '—';
        span.title = data.url || '';
      } else {
        span.textContent = 'erreur : ' + ((data && data.error) || 'inconnue');
      }
    } catch (e) { span.textContent = 'erreur : ' + e.message; }
  }
  async function changeRemote() {
    var span = $('[data-v30-deploy-remote]');
    var current = span ? span.textContent : '';
    var next = prompt(
      'Nouvelle URL du remote Git (origin).\nExemple : https://github.com/AntoineBinet/Prosp_UpV30.git',
      current && current.indexOf('http') === 0 ? current : 'https://github.com/AntoineBinet/Prosp_UpV30.git'
    );
    if (!next) return;
    next = next.trim();
    if (!/^https:\/\/github\.com\/|^git@github\.com:/.test(next)) {
      alert('URL non autorisée. Elle doit commencer par https://github.com/ ou git@github.com:');
      return;
    }
    try {
      var res = await fetch('/api/deploy/set-remote', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: next })
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      toast('Remote mis à jour : ' + data.url, 'success');
      loadRemote();
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Helpers pour sections V30 natives
  // ══════════════════════════════════════════════════════════════
  function inlineStatus(selector, text, color) {
    var el = typeof selector === 'string' ? $(selector) : selector;
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || '';
  }
  function clearInlineStatus(selector, delay) {
    setTimeout(function () { inlineStatus(selector, ''); }, delay || 3500);
  }
  function safeInt(v) {
    var n = parseInt(String(v == null ? '' : v), 10);
    return Number.isFinite(n) ? n : 0;
  }

  // ══════════════════════════════════════════════════════════════
  //  1. Configuration IA
  // ══════════════════════════════════════════════════════════════

  var _ollamaModelsCache = null;
  var _ollamaRecsCache = null;

  function ollamaFmtSize(bytes) {
    if (!bytes) return '';
    if (bytes >= 1e9) return (Math.round(bytes / 1e8) / 10) + ' GB';
    return Math.round(bytes / 1e6) + ' MB';
  }

  function ollamaModelsRender(models) {
    var listEl = $('[data-v30-ollama-list]');
    var datalist = document.getElementById('v30-ollama-datalist');
    if (!listEl) return;
    _ollamaModelsCache = models;
    if (datalist) {
      datalist.innerHTML = (models || []).map(function (m) {
        return '<option value="' + m.name + '">';
      }).join('');
    }
    if (!models || !models.length) {
      listEl.innerHTML = '<span class="muted" style="font-size:13px;">Aucun modèle installé.</span>';
      return;
    }
    var currentModel = ($('[data-v30-ai-model]') && $('[data-v30-ai-model]').value) || '';
    listEl.innerHTML = '';
    models.forEach(function (m) {
      var isActive = currentModel === m.name;
      var row = document.createElement('div');
      row.className = 'v30-params__model-row' + (isActive ? ' is-active' : '');
      row.innerHTML =
        '<span class="v30-params__model-name">' + m.name + '</span>' +
        (m.size ? '<span class="muted v30-params__model-size">' + ollamaFmtSize(m.size) + '</span>' : '') +
        '<span style="flex:1"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-use="' + m.name + '"' +
          (isActive ? ' disabled' : '') + '>' + (isActive ? '✓ Actif' : 'Utiliser') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm v30-params__model-del" data-del="' + m.name + '"' +
          ' title="Supprimer ce modèle">✕</button>';
      listEl.appendChild(row);
    });
    listEl.querySelectorAll('[data-use]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modelEl = $('[data-v30-ai-model]');
        if (modelEl) modelEl.value = btn.getAttribute('data-use');
        ollamaModelsRender(_ollamaModelsCache);
      });
    });
    listEl.querySelectorAll('[data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () { ollamaDeleteModel(btn.getAttribute('data-del')); });
    });
  }

  async function ollamaModelsLoad() {
    var listEl = $('[data-v30-ollama-list]');
    if (!listEl) return;
    try {
      var res = await fetch('/api/ollama/models', { credentials: 'same-origin' });
      var j = await res.json();
      if (!j || !j.ok) {
        listEl.innerHTML = '<span class="muted" style="font-size:13px;">' +
          (j && j.error ? j.error : 'IA locale injoignable') + '</span>';
        return;
      }
      ollamaModelsRender(j.models || []);
      ollamaRecommendedRender();
    } catch (e) {
      listEl.innerHTML = '<span class="muted" style="font-size:13px;">Erreur : ' + e.message + '</span>';
    }
  }

  function ollamaRecommendedRender() {
    var grid = $('[data-v30-ollama-rec-grid]');
    if (!grid) return;
    var recs = _ollamaRecsCache || [];
    if (!recs.length) {
      grid.innerHTML = '<span class="muted" style="font-size:13px;">Aucune recommandation disponible.</span>';
      return;
    }
    var installed = (_ollamaModelsCache || []).map(function (m) { return m.name; });
    grid.innerHTML = '';
    recs.forEach(function (rec) {
      var isInstalled = installed.indexOf(rec.name) !== -1;
      var card = document.createElement('div');
      card.className = 'v30-params__rec-card' + (isInstalled ? ' is-installed' : '');
      var tagsHtml = (rec.tags || []).map(function (t) {
        var cls = t.indexOf('⭐') !== -1 ? ' is-top' : (t === 'Transcription' || t === 'Max local' ? ' is-tx' : '');
        return '<span class="v30-params__rec-tag' + cls + '">' + t + '</span>';
      }).join('');
      card.innerHTML =
        '<div class="v30-params__rec-name">' + rec.name + '</div>' +
        '<div class="v30-params__rec-tags">' + tagsHtml + '</div>' +
        '<div class="v30-params__rec-desc">' + (rec.desc || '') + '</div>' +
        '<div class="v30-params__rec-footer">' +
          '<span class="muted" style="font-size:11px;">' + (rec.size_hint || '') +
            (rec.vram_gb ? ' · ' + rec.vram_gb + ' GB VRAM' : '') + '</span>' +
          (isInstalled
            ? '<span class="v30-params__rec-installed">✓ Installé</span>'
            : '<button type="button" class="btn btn-sm" data-rec-install="' + rec.name + '">Installer</button>') +
        '</div>';
      grid.appendChild(card);
    });
    grid.querySelectorAll('[data-rec-install]').forEach(function (btn) {
      btn.addEventListener('click', function () { ollamaPull(btn.getAttribute('data-rec-install')); });
    });
  }

  async function ollamaRecommendedLoad() {
    var grid = $('[data-v30-ollama-rec-grid]');
    if (!grid) return;
    if (_ollamaRecsCache) { ollamaRecommendedRender(); return; }
    try {
      var res = await fetch('/api/ollama/recommended', { credentials: 'same-origin' });
      var j = await res.json();
      _ollamaRecsCache = (j && j.ok) ? (j.models || []) : [];
      ollamaRecommendedRender();
    } catch (e) {
      if (grid) grid.innerHTML = '<span class="muted" style="font-size:13px;">Erreur chargement recommandations.</span>';
    }
  }

  async function ollamaDeleteModel(name) {
    if (!confirm('Supprimer le modèle « ' + name + ' » ?\nCette action est irréversible.')) return;
    try {
      var res = await fetch('/api/ollama/model', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: name }),
      });
      var j = await res.json();
      if (j && j.ok) {
        toast('Modèle « ' + name + ' » supprimé', 'success');
        ollamaModelsLoad();
      } else {
        toast('Erreur : ' + ((j && j.error) || 'échec'), 'error');
      }
    } catch (e) {
      toast('Erreur réseau : ' + e.message, 'error');
    }
  }

  async function ollamaPull(overrideName) {
    var nameEl = $('[data-v30-ollama-pull-name]');
    var modelName = overrideName || (nameEl && nameEl.value.trim());
    if (!modelName) { toast('Saisir un nom de modèle', 'warning'); return; }
    var logBox = $('[data-v30-ollama-pull-log]');
    var statusEl = $('[data-v30-ollama-pull-status]');
    var pctEl = $('[data-v30-ollama-pull-pct]');
    var bodyEl = $('[data-v30-ollama-pull-body]');
    var btn = $('[data-v30-ollama-pull-btn]');
    if (logBox) logBox.hidden = false;
    if (bodyEl) bodyEl.textContent = '';
    if (statusEl) statusEl.textContent = 'Démarrage…';
    if (pctEl) pctEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Installation…'; }
    try {
      var res = await fetch('/api/ollama/pull', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });
      if (!res.ok) {
        var errJ = null;
        try { errJ = await res.json(); } catch (_) {}
        var errMsg = (errJ && errJ.error) || ('HTTP ' + res.status);
        if (statusEl) statusEl.textContent = '✗ ' + errMsg;
        toast('Pull échoué : ' + errMsg, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Installer'; }
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      var done = false;
      while (!done) {
        var chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          if (line.startsWith('data: ')) line = line.slice(6);
          if (line === '[DONE]') {
            if (statusEl) statusEl.textContent = '✓ Terminé';
            toast('Modèle « ' + modelName + ' » installé', 'success');
            if (nameEl) nameEl.value = '';
            ollamaModelsLoad();
            done = true;
            break;
          }
          try {
            var ev = JSON.parse(line);
            if (ev.error) {
              if (statusEl) statusEl.textContent = '✗ ' + ev.error;
              toast('Pull échoué : ' + ev.error, 'error');
              done = true;
              break;
            }
            if (statusEl && ev.status) statusEl.textContent = ev.status;
            if (pctEl && ev.total && ev.completed) {
              pctEl.textContent = Math.round(ev.completed / ev.total * 100) + '%';
            }
            if (bodyEl && ev.status) {
              var detail = ev.status;
              if (ev.digest) detail += ' · ' + ev.digest.slice(7, 19) + '…';
              bodyEl.textContent += detail + '\n';
              bodyEl.scrollTop = bodyEl.scrollHeight;
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗ Erreur réseau';
      toast('Erreur réseau : ' + e.message, 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Installer'; }
  }

  async function aiLoad() {
    var urlEl = $('[data-v30-ai-url]');
    if (!urlEl) return; // section absente (non-admin)
    try {
      var res = await fetch('/api/ai/config', { credentials: 'same-origin' });
      var j = await res.json();
      if (!j || !j.ok) return;
      var c = j.config || {};
      urlEl.value = c.ollama_url || '';
      var modelEl = $('[data-v30-ai-model]');
      if (modelEl) modelEl.value = c.ollama_model || '';
      var fb = $('[data-v30-ai-fallback]');
      if (fb) fb.checked = c.fallback_enabled !== false;
      var tav = $('[data-v30-ai-tavily]');
      if (tav) {
        tav.value = '';
        tav.placeholder = c.tavily_api_key_set
          ? (c.tavily_api_key_preview + ' (configurée)')
          : 'tvly-...';
      }
      // v32.1 — Transcription
      var anth = $('[data-v30-ai-anthropic]');
      if (anth) {
        anth.value = '';
        anth.placeholder = c.anthropic_api_key_set
          ? (c.anthropic_api_key_preview + ' (configurée)')
          : 'sk-ant-...';
      }
      var anthM = $('[data-v30-ai-anthropic-model]');
      if (anthM) anthM.value = c.anthropic_model || 'claude-haiku-4-5';
      var wM = $('[data-v30-ai-whisper-model]');
      if (wM) wM.value = c.whisper_model || 'large-v3';
      var wD = $('[data-v30-ai-whisper-device]');
      if (wD) wD.value = c.whisper_device || 'cuda';
      var wC = $('[data-v30-ai-whisper-compute]');
      if (wC) wC.value = c.whisper_compute_type || 'float16';
      var diar = $('[data-v30-ai-diar]');
      if (diar) diar.checked = c.diarization_enabled !== false;
      var txFb = $('[data-v30-ai-tx-fallback]');
      if (txFb) txFb.checked = !!c.transcription_fallback_ollama;
      var hf = $('[data-v30-ai-hf]');
      if (hf) {
        hf.value = '';
        hf.placeholder = c.huggingface_token_set
          ? (c.huggingface_token_preview + ' (configuré)')
          : 'hf_...';
      }
    } catch (e) {
      console.warn('AI config load:', e);
    }
    ollamaModelsLoad();
    ollamaRecommendedLoad();
  }

  async function aiSave() {
    var btn = $('[data-v30-ai-save]');
    var st = '[data-v30-ai-status]';
    inlineStatus(st, 'Enregistrement…', 'var(--text-2)');
    if (btn) btn.disabled = true;
    var payload = {
      fallback_enabled: !!($('[data-v30-ai-fallback]') && $('[data-v30-ai-fallback]').checked),
      ollama_url: (($('[data-v30-ai-url]') && $('[data-v30-ai-url]').value) || '').trim(),
      ollama_model: (($('[data-v30-ai-model]') && $('[data-v30-ai-model]').value) || '').trim()
    };
    var tavilyKey = (($('[data-v30-ai-tavily]') && $('[data-v30-ai-tavily]').value) || '').trim();
    if (tavilyKey) payload.tavily_api_key = tavilyKey;
    // v32.1 — Transcription
    var anthKey = (($('[data-v30-ai-anthropic]') && $('[data-v30-ai-anthropic]').value) || '').trim();
    if (anthKey) payload.anthropic_api_key = anthKey;
    var anthM = $('[data-v30-ai-anthropic-model]');
    if (anthM && anthM.value) payload.anthropic_model = anthM.value;
    var wM = $('[data-v30-ai-whisper-model]');
    if (wM && wM.value) payload.whisper_model = wM.value;
    var wD = $('[data-v30-ai-whisper-device]');
    if (wD && wD.value) payload.whisper_device = wD.value;
    var wC = $('[data-v30-ai-whisper-compute]');
    if (wC && wC.value) payload.whisper_compute_type = wC.value;
    var diar = $('[data-v30-ai-diar]');
    if (diar) payload.diarization_enabled = !!diar.checked;
    var txFb = $('[data-v30-ai-tx-fallback]');
    if (txFb) payload.transcription_fallback_ollama = !!txFb.checked;
    var hfKey = (($('[data-v30-ai-hf]') && $('[data-v30-ai-hf]').value) || '').trim();
    if (hfKey) payload.huggingface_token = hfKey;
    try {
      var res = await fetch('/api/ai/config', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Enregistré', 'var(--success)');
      toast('Configuration IA enregistrée', 'success');
      aiLoad();
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    if (btn) btn.disabled = false;
    clearInlineStatus(st);
  }

  async function aiTest(target) {
    var st = '[data-v30-ai-status]';
    var label = ({
      tavily: 'Tavily',
      anthropic: 'Claude',
      ollama: 'IA locale',
      huggingface: 'HuggingFace',
    })[target] || target;
    var waitHint = target === 'ollama' ? ' (peut prendre 30-60 s au premier appel)' : '';
    inlineStatus(st, 'Test ' + label + '…' + waitHint, 'var(--text-2)');
    var payload = { test_target: target };
    var urlEl = $('[data-v30-ai-url]');
    if (urlEl && urlEl.value.trim()) payload.ollama_url = urlEl.value.trim();
    var modelEl = $('[data-v30-ai-model]');
    if (modelEl && modelEl.value.trim()) payload.ollama_model = modelEl.value.trim();
    var tavEl = $('[data-v30-ai-tavily]');
    if (tavEl && tavEl.value.trim()) payload.tavily_api_key = tavEl.value.trim();
    var anthEl = $('[data-v30-ai-anthropic]');
    if (anthEl && anthEl.value.trim()) payload.anthropic_api_key = anthEl.value.trim();
    var anthMEl = $('[data-v30-ai-anthropic-model]');
    if (anthMEl && anthMEl.value) payload.anthropic_model = anthMEl.value;
    var hfEl = $('[data-v30-ai-hf]');
    if (hfEl && hfEl.value.trim()) payload.huggingface_token = hfEl.value.trim();
    var outBox = $('[data-v30-ai-test-output]');
    if (outBox) { outBox.hidden = true; outBox.className = 'v30-params__test-output'; outBox.textContent = ''; }
    try {
      var res = await fetch('/api/ai/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var j = await res.json();
      if (j && j.ok) {
        var msg = label + ' OK' + (j.model ? ' (' + j.model + ')' : '');
        inlineStatus(st, msg, 'var(--success)');
        toast(msg, 'success');
        if (outBox && j.response) {
          outBox.hidden = false;
          outBox.className = 'v30-params__test-output is-success';
          outBox.textContent = j.response;
        }
      } else {
        var shortErr = (j && j.error) || 'échec';
        inlineStatus(st, label + ' : ' + shortErr.split('\n')[0], 'var(--danger)');
        toast(label + ' : ' + shortErr.slice(0, 120), 'error');
        if (outBox) {
          outBox.hidden = false;
          outBox.className = 'v30-params__test-output is-error';
          outBox.textContent = shortErr;
        }
      }
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
      if (outBox) {
        outBox.hidden = false;
        outBox.className = 'v30-params__test-output is-error';
        outBox.textContent = 'Erreur : ' + e.message;
      }
    }
    clearInlineStatus(st, 6000);
  }

  function bindAi() {
    if (!$('[data-v30-ai-url]')) return;
    var save = $('[data-v30-ai-save]');
    if (save) save.addEventListener('click', aiSave);
    var tOll = $('[data-v30-ai-test-ollama]');
    if (tOll) tOll.addEventListener('click', function () { aiTest('ollama'); });
    var tTav = $('[data-v30-ai-test-tavily]');
    if (tTav) tTav.addEventListener('click', function () { aiTest('tavily'); });
    var tAnth = $('[data-v30-ai-test-anthropic]');
    if (tAnth) tAnth.addEventListener('click', function () { aiTest('anthropic'); });
    var tHf = $('[data-v30-ai-test-hf]');
    if (tHf) tHf.addEventListener('click', function () { aiTest('huggingface'); });
    var tog = $('[data-v30-ai-tavily-toggle]');
    if (tog) tog.addEventListener('click', function () {
      var inp = $('[data-v30-ai-tavily]');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    var togA = $('[data-v30-ai-anthropic-toggle]');
    if (togA) togA.addEventListener('click', function () {
      var inp = $('[data-v30-ai-anthropic]');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    var togHf = $('[data-v30-ai-hf-toggle]');
    if (togHf) togHf.addEventListener('click', function () {
      var inp = $('[data-v30-ai-hf]');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    var refreshBtn = $('[data-v30-ollama-refresh]');
    if (refreshBtn) refreshBtn.addEventListener('click', ollamaModelsLoad);
    var recRefreshBtn = $('[data-v30-ollama-rec-refresh]');
    if (recRefreshBtn) recRefreshBtn.addEventListener('click', function () {
      _ollamaRecsCache = null;
      ollamaRecommendedLoad();
    });
    var pullBtn = $('[data-v30-ollama-pull-btn]');
    if (pullBtn) pullBtn.addEventListener('click', function () { ollamaPull(); });
    aiLoad();
    bindCuda();
  }

  // ══════════════════════════════════════════════════════════════
  //  Réparation torch CUDA (v32.2)
  // ══════════════════════════════════════════════════════════════
  var CUDA_POLL_MS = 2500;
  var cudaPollTimer = null;

  function escDep(v) { var t = document.createElement('span'); t.textContent = v == null ? '' : String(v); return t.innerHTML; }

  function renderCudaStatus(s) {
    var statusBox = $('[data-v30-cuda-status]');
    var formBox = $('[data-v30-cuda-form]');
    if (!statusBox) return;

    var version = s.torch_version || '?';
    var built = !!s.torch_cuda_built;
    var avail = !!s.torch_cuda_available;
    var device = s.torch_cuda_device || '';
    var isCpu = /\+cpu/i.test(version);

    var badge, msg;
    if (avail && built && !isCpu) {
      badge = '<span class="v30-params__cuda-status-badge is-ok">✓ CUDA actif</span>';
      msg = 'torch <code class="mono">' + escDep(version) + '</code>'
          + (device ? ' · GPU : <strong>' + escDep(device) + '</strong>' : '');
      formBox && (formBox.hidden = true);
    } else if (isCpu || !built) {
      badge = '<span class="v30-params__cuda-status-badge is-warn">⚠ Build CPU</span>';
      msg = 'torch <code class="mono">' + escDep(version) + '</code> est compilé sans CUDA. '
          + 'La transcription tournera mais sera lente. Réinstalle ci-dessous pour activer le GPU.';
      formBox && (formBox.hidden = false);
    } else {
      badge = '<span class="v30-params__cuda-status-badge is-warn">CUDA built · GPU non détecté</span>';
      msg = 'torch est compilé avec CUDA mais aucun GPU n\'est accessible. '
          + 'Vérifie les drivers NVIDIA, ou force une autre version cu1xx ci-dessous.';
      formBox && (formBox.hidden = false);
    }
    statusBox.innerHTML = badge + ' <span class="muted" style="font-size:12px;">' + msg + '</span>';
  }

  function renderCudaLog(s) {
    var box = $('[data-v30-cuda-log]');
    var phaseEl = $('[data-v30-cuda-phase]');
    var metaEl = $('[data-v30-cuda-meta]');
    var bodyEl = $('[data-v30-cuda-log-body]');
    if (!box || !s) return;
    var hasLog = (s.log_tail && s.log_tail.length) || s.running || s.phase === 'done' || s.phase === 'error';
    box.hidden = !hasLog;
    if (!hasLog) return;

    var phaseLabel = {
      idle: 'En attente',
      downloading: '⬇ Téléchargement…',
      installing: '⚙ Installation…',
      done: '✓ Terminé',
      error: '✗ Erreur',
    }[s.phase] || s.phase;
    if (phaseEl) phaseEl.textContent = phaseLabel;

    var meta = [];
    if (s.started_at) meta.push('démarré ' + s.started_at);
    if (s.ended_at)   meta.push('fini ' + s.ended_at);
    if (s.log_lines)  meta.push(s.log_lines + ' lignes');
    if (metaEl) metaEl.textContent = meta.join(' · ');

    if (bodyEl) {
      var atBottom = (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight) < 30;
      bodyEl.textContent = (s.log_tail || []).join('\n');
      if (atBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  }

  function loadCudaStatus() {
    return fetch('/api/deploy/install-torch-cuda/status?tail=300', {
      credentials: 'same-origin', cache: 'no-store',
    })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s || s.ok === false) return;
        renderCudaStatus(s);
        renderCudaLog(s);
        if (s.running) schedulePoll();
        else if (cudaPollTimer) { clearTimeout(cudaPollTimer); cudaPollTimer = null; }
      })
      .catch(function (e) {
        console.warn('cuda status:', e);
      });
  }

  function schedulePoll() {
    if (cudaPollTimer) clearTimeout(cudaPollTimer);
    cudaPollTimer = setTimeout(loadCudaStatus, CUDA_POLL_MS);
  }

  function startCudaInstall() {
    var sel = $('[data-v30-cuda-tag]');
    var tag = (sel && sel.value) || 'cu121';
    var btn = $('[data-v30-cuda-install]');
    if (!confirm('Lancer la réinstallation forcée de torch / torchaudio depuis l\'index PyTorch ' + tag + ' ?\n\nDurée : ~10-15 min, ~3 GB de download.\n\nL\'installation tourne en arrière-plan : tu peux fermer la page, le job continue côté serveur.\n\nUne fois terminé, redémarre l\'app via « Mettre à jour et redémarrer » pour activer CUDA.')) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Démarrage…'; }
    fetch('/api/deploy/install-torch-cuda', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cuda_tag: tag }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.ok) {
          toast('Installation CUDA démarrée — log live ci-dessous', 'success');
          loadCudaStatus();
        } else {
          toast('Erreur : ' + ((j && j.error) || 'échec'), 'error');
        }
      })
      .catch(function (e) { toast('Erreur réseau : ' + e.message, 'error'); })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Forcer install CUDA (~10-15 min)'; }
      });
  }

  function bindCuda() {
    var btn = $('[data-v30-cuda-install]');
    if (btn) btn.addEventListener('click', startCudaInstall);
    loadCudaStatus();
  }

  // ══════════════════════════════════════════════════════════════
  //  2. Objectifs & Gamification
  // ══════════════════════════════════════════════════════════════
  var GOAL_LABELS = {
    daily: {
      rdv: 'Prendre 1 RDV Prosp',
      push: '3 push',
      sourcing_contacted: 'Sourcing : contacter 3 candidats qualifiés'
    },
    weekly: {
      rdv: 'Prendre 5 RDV Prosp',
      push: '15 push',
      sourcing_contacted: 'Sourcing : contacter 15 candidats qualifiés',
      sourcing_solid: 'Sourcing : 3 profils solides (EC1+)'
    }
  };
  async function goalsLoad() {
    if (!$('[data-v30-goal="daily.rdv.target"]')) return;
    try {
      var res = await fetch('/api/dashboard', { credentials: 'same-origin' });
      var j = await res.json();
      var cfg = j && j.ok && j.data && j.data.goals && j.data.goals.config ? j.data.goals.config : null;
      if (!cfg) return;
      ['daily', 'weekly'].forEach(function (scope) {
        Object.keys(GOAL_LABELS[scope]).forEach(function (key) {
          var o = (cfg[scope] && cfg[scope][key]) || {};
          var tEl = $('[data-v30-goal="' + scope + '.' + key + '.target"]');
          var xpEl = $('[data-v30-goal="' + scope + '.' + key + '.xp"]');
          if (tEl) tEl.value = safeInt(o.target);
          if (xpEl) xpEl.value = safeInt(o.xp);
        });
      });
    } catch (e) {
      console.warn('Goals load:', e);
    }
  }
  function goalsBuildFromUI() {
    var cfg = { daily: {}, weekly: {}, meta: { push_channels: 'any', xp_scale: 'linear' } };
    ['daily', 'weekly'].forEach(function (scope) {
      Object.keys(GOAL_LABELS[scope]).forEach(function (key) {
        var tEl = $('[data-v30-goal="' + scope + '.' + key + '.target"]');
        var xpEl = $('[data-v30-goal="' + scope + '.' + key + '.xp"]');
        cfg[scope][key] = {
          label: GOAL_LABELS[scope][key],
          target: safeInt(tEl && tEl.value),
          xp: safeInt(xpEl && xpEl.value)
        };
      });
    });
    return cfg;
  }
  async function goalsSave() {
    var st = '[data-v30-goals-status]';
    inlineStatus(st, 'Enregistrement…', 'var(--text-2)');
    try {
      var res = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { goals_config: JSON.stringify(goalsBuildFromUI()) } })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Enregistré', 'var(--success)');
      toast('Objectifs sauvegardés', 'success');
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    clearInlineStatus(st);
  }
  async function goalsReset() {
    if (!confirm('Restaurer les objectifs par défaut ?')) return;
    var st = '[data-v30-goals-status]';
    inlineStatus(st, 'Restauration…', 'var(--text-2)');
    try {
      var res = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { goals_config: '' } })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Valeurs par défaut', 'var(--success)');
      toast('Objectifs restaurés', 'success');
      await goalsLoad();
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    clearInlineStatus(st);
  }
  function bindGoals() {
    if (!$('[data-v30-goal="daily.rdv.target"]')) return;
    var s = $('[data-v30-goals-save]');
    if (s) s.addEventListener('click', goalsSave);
    var r = $('[data-v30-goals-reset]');
    if (r) r.addEventListener('click', goalsReset);
    goalsLoad();
  }

  // ══════════════════════════════════════════════════════════════
  //  3. Sauvegardes & données
  // ══════════════════════════════════════════════════════════════
  function formatBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' Ko';
    return (n / (1024 * 1024)).toFixed(1) + ' Mo';
  }
  function formatDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso.replace(' ', 'T'));
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) { return iso; }
  }
  async function snapshotsLoad() {
    var ul = $('[data-v30-snapshots-list]');
    if (!ul) return;
    try {
      var res = await fetch('/api/snapshots', { credentials: 'same-origin' });
      var j = await res.json();
      var items = (j && j.items) ? j.items.slice(0, 5) : [];
      if (!items.length) {
        ul.innerHTML = '<li class="muted v30-params__empty">Aucun snapshot pour le moment.</li>';
        return;
      }
      var isAdmin = !!$('[data-v30-snapshot-create]');
      ul.innerHTML = items.map(function (it) {
        var fn = esc(it.filename);
        var size = formatBytes(it.size);
        var date = formatDate(it.mtime || it.modifiedAt);
        var actions = isAdmin
          ? '<button type="button" class="btn btn-ghost btn-sm" data-v30-snapshot-restore="' + fn + '">Restaurer</button>'
            + ' <button type="button" class="btn btn-ghost btn-sm" data-v30-snapshot-delete="' + fn + '">Supprimer</button>'
          : '';
        return '<li class="v30-params__snapshot">'
          + '<div class="v30-params__snapshot-meta">'
          + '<span class="mono">' + fn + '</span>'
          + '<span class="muted"> · ' + esc(date) + (size ? ' · ' + esc(size) : '') + '</span>'
          + '</div>'
          + '<div class="v30-params__snapshot-actions">' + actions + '</div>'
          + '</li>';
      }).join('');
      // Bind per-item
      $$('[data-v30-snapshot-restore]', ul).forEach(function (btn) {
        btn.addEventListener('click', function () { snapshotRestore(btn.getAttribute('data-v30-snapshot-restore')); });
      });
      $$('[data-v30-snapshot-delete]', ul).forEach(function (btn) {
        btn.addEventListener('click', function () { snapshotDelete(btn.getAttribute('data-v30-snapshot-delete')); });
      });
    } catch (e) {
      ul.innerHTML = '<li class="muted v30-params__empty">Erreur : ' + esc(e.message) + '</li>';
    }
  }
  async function snapshotCreate() {
    var btn = $('[data-v30-snapshot-create]');
    var st = '[data-v30-backup-status]';
    if (btn) btn.disabled = true;
    inlineStatus(st, 'Création en cours…', 'var(--text-2)');
    try {
      var res = await fetch('/api/snapshots/create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'manual' })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Snapshot créé', 'var(--success)');
      toast('Snapshot créé : ' + (j.filename || ''), 'success');
      await snapshotsLoad();
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    if (btn) btn.disabled = false;
    clearInlineStatus(st);
  }
  async function snapshotRestore(filename) {
    if (!filename) return;
    if (!confirm('Restaurer ce snapshot ?\n\n' + filename + '\n\nUn snapshot de sécurité de la base actuelle sera créé avant l\'opération.')) return;
    var st = '[data-v30-backup-status]';
    inlineStatus(st, 'Restauration en cours…', 'var(--text-2)');
    try {
      var res = await fetch('/api/snapshots/restore', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Restauration OK', 'var(--success)');
      toast('Snapshot restauré — rechargement', 'success');
      setTimeout(function () { window.location.reload(); }, 1500);
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
  }
  async function snapshotDelete(filename) {
    if (!filename) return;
    if (!confirm('Supprimer ce snapshot ?\n\n' + filename + '\n\nCette action est définitive.')) return;
    var st = '[data-v30-backup-status]';
    inlineStatus(st, 'Suppression…', 'var(--text-2)');
    try {
      var res = await fetch('/api/snapshots/delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Supprimé', 'var(--success)');
      toast('Snapshot supprimé', 'success');
      await snapshotsLoad();
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    clearInlineStatus(st);
  }
  async function exportJson() {
    // Pas d'endpoint JSON dédié : on sérialise depuis /api/dashboard côté client (dump partiel).
    var st = '[data-v30-backup-status]';
    inlineStatus(st, 'Préparation de l\'export…', 'var(--text-2)');
    try {
      var res = await fetch('/api/dashboard', { credentials: 'same-origin' });
      var j = await res.json();
      var blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = 'prospup-dashboard-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      inlineStatus(st, 'Export JSON téléchargé', 'var(--success)');
      toast('Export JSON téléchargé', 'success');
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    clearInlineStatus(st);
  }
  function bindBackup() {
    if (!$('[data-v30-snapshots-list]')) return;
    var c = $('[data-v30-snapshot-create]');
    if (c) c.addEventListener('click', snapshotCreate);
    var ej = $('[data-v30-export-json]');
    if (ej) ej.addEventListener('click', exportJson);
    // Charge la liste à l'ouverture du <details>
    var details = document.querySelector('[data-v30-backup]');
    if (details) {
      details.addEventListener('toggle', function () {
        if (details.open) snapshotsLoad();
      });
      if (details.open) snapshotsLoad();
    } else {
      snapshotsLoad();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  4. Notifications navigateur
  // ══════════════════════════════════════════════════════════════
  function notifGetPrefs() {
    if (window.ProspUpNotifications && typeof window.ProspUpNotifications.getPrefs === 'function') {
      return window.ProspUpNotifications.getPrefs();
    }
    try {
      var raw = localStorage.getItem('prospup_notifications');
      if (!raw) return { enabled: false, hour: 9 };
      var o = JSON.parse(raw);
      return {
        enabled: !!o.enabled,
        hour: typeof o.hour === 'number' ? Math.max(0, Math.min(23, o.hour)) : 9
      };
    } catch (e) { return { enabled: false, hour: 9 }; }
  }
  function notifLoad() {
    var chk = $('[data-v30-notif-enabled]');
    var sel = $('[data-v30-notif-hour]');
    if (!chk || !sel) return;
    var prefs = notifGetPrefs();
    chk.checked = !!prefs.enabled;
    sel.value = String(prefs.hour || 9);
  }
  async function notifSave() {
    var chk = $('[data-v30-notif-enabled]');
    var sel = $('[data-v30-notif-hour]');
    var st = '[data-v30-notif-status]';
    var enabled = !!(chk && chk.checked);
    var hour = safeInt(sel && sel.value) || 9;

    if (enabled && 'Notification' in window) {
      if (Notification.permission !== 'granted') {
        try {
          var perm = await Notification.requestPermission();
          if (perm !== 'granted') {
            inlineStatus(st, 'Permission refusée', 'var(--danger)');
            toast('Permission de notification refusée par le navigateur', 'error');
            if (chk) chk.checked = false;
            return;
          }
        } catch (e) {
          inlineStatus(st, 'Erreur permission : ' + e.message, 'var(--danger)');
          return;
        }
      }
    }

    var prefs = { enabled: enabled, hour: hour };
    if (window.ProspUpNotifications && typeof window.ProspUpNotifications.setPrefs === 'function') {
      window.ProspUpNotifications.setPrefs(prefs);
    } else {
      try { localStorage.setItem('prospup_notifications', JSON.stringify(prefs)); } catch (e) {}
    }
    inlineStatus(st, 'Enregistré', 'var(--success)');
    toast('Préférences notifications enregistrées', 'success');
    clearInlineStatus(st);
  }
  function bindNotif() {
    if (!$('[data-v30-notif-enabled]')) return;
    var s = $('[data-v30-notif-save]');
    if (s) s.addEventListener('click', notifSave);
    notifLoad();
  }

  // ══════════════════════════════════════════════════════════════
  //  5. Mon compte (changement de mot de passe)
  // ══════════════════════════════════════════════════════════════
  async function pwChange() {
    var st = '[data-v30-pw-status]';
    var cur = $('[data-v30-pw-current]');
    var nw = $('[data-v30-pw-new]');
    var cf = $('[data-v30-pw-confirm]');
    if (!cur || !nw || !cf) return;
    var oldPw = cur.value || '';
    var newPw = nw.value || '';
    var cfPw = cf.value || '';

    if (!oldPw || !newPw || !cfPw) {
      inlineStatus(st, 'Tous les champs sont requis', 'var(--danger)');
      return;
    }
    if (newPw !== cfPw) {
      inlineStatus(st, 'Les mots de passe ne correspondent pas', 'var(--danger)');
      return;
    }
    if (newPw.length < 8) {
      inlineStatus(st, 'Mot de passe trop court (min 8)', 'var(--danger)');
      return;
    }

    var btn = $('[data-v30-pw-save]');
    if (btn) btn.disabled = true;
    inlineStatus(st, 'Envoi…', 'var(--text-2)');
    try {
      var res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Mot de passe changé', 'var(--success)');
      toast('Mot de passe mis à jour', 'success');
      cur.value = ''; nw.value = ''; cf.value = '';
      try { sessionStorage.removeItem('pending_password_change'); } catch (e) {}
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    if (btn) btn.disabled = false;
    clearInlineStatus(st, 5000);
  }
  function bindAccount() {
    var b = $('[data-v30-pw-save]');
    if (b) b.addEventListener('click', pwChange);
  }

  // ══════════════════════════════════════════════════════════════
  //  6. À propos (version / commit)
  // ══════════════════════════════════════════════════════════════
  var ABOUT_POLL_MS = 30000;
  var _aboutTimer = null;
  async function aboutLoad() {
    var root = $('[data-v30-about]');
    if (!root) return;
    try {
      var res = await fetch('/api/app-version', { credentials: 'same-origin' });
      var j = await res.json();
      if (!j) return;
      var v = $('[data-v30-about-version]');
      if (v) v.textContent = j.version || '—';
      var c = $('[data-v30-about-commit]');
      if (c) c.textContent = j.commit_hash || '—';
      var br = $('[data-v30-about-branch]');
      if (br) br.textContent = j.branch || '—';
      var d = $('[data-v30-about-date]');
      if (d) d.textContent = j.commit_date || '—';

      var dot = $('[data-v30-about-dot]');
      if (dot) {
        var last = '';
        try { last = localStorage.getItem('prospup_last_commit_hash') || ''; } catch (e) {}
        if (!last) {
          // Première visite : mémorise sans alerter
          try { localStorage.setItem('prospup_last_commit_hash', j.commit_hash || ''); } catch (e) {}
          dot.classList.remove('is-changed', 'is-loading');
          dot.classList.add('is-ok');
          dot.title = 'À jour';
        } else if (j.commit_hash && j.commit_hash !== last) {
          dot.classList.remove('is-ok', 'is-loading');
          dot.classList.add('is-changed');
          dot.title = 'Nouveau commit détecté (' + last + ' → ' + j.commit_hash + ')';
        } else {
          dot.classList.remove('is-changed', 'is-loading');
          dot.classList.add('is-ok');
          dot.title = 'À jour';
        }
      }
    } catch (e) {
      var dotErr = $('[data-v30-about-dot]');
      if (dotErr) {
        dotErr.classList.remove('is-ok', 'is-changed');
        dotErr.classList.add('is-loading');
        dotErr.title = 'Impossible de récupérer la version';
      }
    }
  }
  function bindAbout() {
    if (!$('[data-v30-about]')) return;
    aboutLoad();
    if (_aboutTimer) clearInterval(_aboutTimer);
    _aboutTimer = setInterval(aboutLoad, ABOUT_POLL_MS);
  }

  // ══════════════════════════════════════════════════════════════
  //  3. Calendrier externe (ICS / Outlook / Google)
  // ══════════════════════════════════════════════════════════════
  async function calSyncLoad() {
    var inp = $('[data-v30-calsync-url]');
    if (!inp) return;
    try {
      var res = await fetch('/api/settings', { credentials: 'same-origin' });
      var j = await res.json();
      var url = j && j.settings && j.settings.calendar_external_ics_url;
      inp.value = url || '';
    } catch (e) {
      console.warn('calSync load:', e);
    }
  }
  async function calSyncSave() {
    var inp = $('[data-v30-calsync-url]');
    var st = '[data-v30-calsync-status]';
    var url = (inp && inp.value || '').trim();
    inlineStatus(st, 'Enregistrement…', 'var(--text-2)');
    try {
      var res = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { calendar_external_ics_url: url } })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Enregistré', 'var(--success)');
      toast('URL de calendrier enregistrée', 'success');
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    clearInlineStatus(st);
  }
  async function calSyncTest() {
    var inp = $('[data-v30-calsync-url]');
    var st = '[data-v30-calsync-status]';
    var url = (inp && inp.value || '').trim();
    if (!url) {
      inlineStatus(st, 'Saisir une URL d\'abord', 'var(--warn)');
      clearInlineStatus(st);
      return;
    }
    inlineStatus(st, 'Test en cours…', 'var(--text-2)');
    try {
      var res = await fetch('/api/calendar_events_external?url=' + encodeURIComponent(url), {
        credentials: 'same-origin'
      });
      var j = await res.json();
      if (!j || !j.ok) throw new Error((j && j.error) || 'Erreur');
      var n = (j.events || []).length;
      var msg = 'OK · ' + n + ' événement' + (n > 1 ? 's' : '') + ' trouvé' + (n > 1 ? 's' : '');
      inlineStatus(st, msg, 'var(--success)');
      toast(msg, 'success');
    } catch (e) {
      inlineStatus(st, 'Échec : ' + e.message, 'var(--danger)');
      toast('Calendrier externe : ' + e.message, 'error');
    }
    clearInlineStatus(st, 6000);
  }
  async function calSyncClear() {
    if (!confirm('Supprimer le lien ICS enregistré ?')) return;
    var inp = $('[data-v30-calsync-url]');
    if (inp) inp.value = '';
    var st = '[data-v30-calsync-status]';
    inlineStatus(st, 'Suppression…', 'var(--text-2)');
    try {
      var res = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { calendar_external_ics_url: '' } })
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      inlineStatus(st, 'Supprimé', 'var(--success)');
      toast('Lien ICS supprimé', 'success');
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
    }
    clearInlineStatus(st);
  }
  function bindCalSync() {
    var root = $('[data-v30-calsync]');
    if (!root) return;
    var s = $('[data-v30-calsync-save]');
    if (s) s.addEventListener('click', calSyncSave);
    var t = $('[data-v30-calsync-test]');
    if (t) t.addEventListener('click', calSyncTest);
    var c = $('[data-v30-calsync-clear]');
    if (c) c.addEventListener('click', calSyncClear);
    // Charge l'URL à l'ouverture du <details>
    root.addEventListener('toggle', function () {
      if (root.open) calSyncLoad();
    });
    // Auto-ouvre si l'ancre #calsync est présente dans l'URL
    if (window.location.hash === '#calsync') {
      root.open = true;
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      calSyncLoad();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Tabs (filtre cards par data-tab)
  // ══════════════════════════════════════════════════════════════
  function applyTab(tab) {
    var grid = document.querySelector('.v30-params__grid');
    if (!grid) return;
    grid.setAttribute('data-active-tab', tab || 'all');
    var cards = grid.querySelectorAll('.v30-params__card[data-tab]');
    cards.forEach(function (c) {
      var cardTabs = (c.getAttribute('data-tab') || '').split(/\s+/).filter(Boolean);
      var match = (tab === 'all') || cardTabs.indexOf(tab) !== -1;
      if (match) c.setAttribute('data-tab-match', '1');
      else c.removeAttribute('data-tab-match');
    });
    // Rendre la persistance simple
    try { localStorage.setItem('v30_params_tab', tab || 'all'); } catch (_) {}
  }
  function bindTabs() {
    var bar = $('[data-v30-params-tabs]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      bar.querySelectorAll('button[data-tab]').forEach(function (b) {
        var act = (b === btn);
        b.classList.toggle('is-active', act);
        b.setAttribute('aria-selected', act ? 'true' : 'false');
      });
      applyTab(btn.getAttribute('data-tab'));
    });
    // Restaurer onglet précédent
    var saved = 'all';
    try { saved = localStorage.getItem('v30_params_tab') || 'all'; } catch (_) {}
    var match = bar.querySelector('button[data-tab="' + saved + '"]');
    if (match) {
      bar.querySelectorAll('button[data-tab]').forEach(function (b) {
        var act = (b === match);
        b.classList.toggle('is-active', act);
        b.setAttribute('aria-selected', act ? 'true' : 'false');
      });
      applyTab(saved);
    } else {
      applyTab('all');
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  KPI manuels (manual_kpi)
  // ══════════════════════════════════════════════════════════════
  var KPI_TYPE_LABEL = {
    rdv: 'RDV', call: 'Appel', email: 'Email',
    push: 'Push', sourcing: 'Sourcing', note: 'Note'
  };
  function kpiOpenModal() {
    var bd = $('[data-v30-kpi-modal-bd]');
    if (!bd) return;
    var d = $('[data-v30-kpi-date]');
    if (d && !d.value) {
      var t = new Date();
      d.value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }
    bd.hidden = false;
    bd.classList.add('is-open');
  }
  function kpiCloseModal() {
    var bd = $('[data-v30-kpi-modal-bd]');
    if (!bd) return;
    bd.classList.remove('is-open');
    bd.hidden = true;
  }
  async function kpiSave() {
    var st = '[data-v30-kpi-status]';
    var payload = {
      type: ($('[data-v30-kpi-type]') || {}).value || 'note',
      date: ($('[data-v30-kpi-date]') || {}).value || '',
      count: parseInt(($('[data-v30-kpi-count]') || {}).value || '1', 10) || 1,
      description: ($('[data-v30-kpi-desc]') || {}).value || ''
    };
    if (!payload.date) { toast('Date requise', 'error'); return; }
    inlineStatus(st, 'Enregistrement…', 'var(--text-2)');
    try {
      var res = await fetch('/api/manual-kpi', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error((j && j.error) || 'HTTP ' + res.status);
      kpiCloseModal();
      toast('KPI enregistré', 'success');
      inlineStatus(st, 'Enregistré', 'var(--success)');
      // Reset desc
      var desc = $('[data-v30-kpi-desc]');
      if (desc) desc.value = '';
      kpiLoadList();
    } catch (e) {
      inlineStatus(st, 'Erreur : ' + e.message, 'var(--danger)');
      toast('Erreur : ' + e.message, 'error');
    }
    clearInlineStatus(st);
  }
  async function kpiLoadList() {
    var ul = $('[data-v30-kpi-list]');
    if (!ul) return;
    ul.innerHTML = '<li class="muted v30-params__empty">Chargement…</li>';
    try {
      var res = await fetch('/api/manual-kpi', { credentials: 'same-origin' });
      var j = await res.json();
      var entries = (j && j.entries) ? j.entries.slice(0, 12) : [];
      if (!entries.length) {
        ul.innerHTML = '<li class="muted v30-params__empty">Aucune entrée pour le moment.</li>';
        return;
      }
      ul.innerHTML = entries.map(function (e) {
        var label = KPI_TYPE_LABEL[e.type] || e.type || '—';
        return '<li class="v30-params__snapshot">' +
          '<span class="v30-params__snapshot-meta">' +
            '<strong>' + esc(label) + '</strong> · ' +
            '<span class="mono">' + esc(e.date || '') + '</span> · ' +
            '×' + esc(e.count != null ? e.count : 1) +
            (e.description ? ' — <span class="muted">' + esc(e.description) + '</span>' : '') +
          '</span>' +
        '</li>';
      }).join('');
    } catch (e) {
      ul.innerHTML = '<li class="muted v30-params__empty">Erreur : ' + esc(e.message) + '</li>';
    }
  }
  function bindKpi() {
    if (!$('[data-v30-kpi-list]')) return;
    var add = $('[data-v30-kpi-add]');
    if (add) add.addEventListener('click', kpiOpenModal);
    var refresh = $('[data-v30-kpi-refresh]');
    if (refresh) refresh.addEventListener('click', kpiLoadList);
    document.querySelectorAll('[data-v30-kpi-close]').forEach(function (b) {
      b.addEventListener('click', kpiCloseModal);
    });
    var save = $('[data-v30-kpi-save]');
    if (save) save.addEventListener('click', kpiSave);
    var bd = $('[data-v30-kpi-modal-bd]');
    if (bd) bd.addEventListener('click', function (e) {
      if (e.target === bd) kpiCloseModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') kpiCloseModal();
    });
    // Charge à l'ouverture du <details>
    var card = $('[data-v30-kpi]');
    if (card) {
      card.addEventListener('toggle', function () {
        if (card.open) kpiLoadList();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  Vérification des dépendances Python
  // ══════════════════════════════════════════════════════════════
  function escDep(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }

  function depBadge(status) {
    if (status === 'ok') {
      return '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--success) 14%,transparent);color:var(--success);font-size:11px;font-weight:600;">✓ OK</span>';
    }
    if (status === 'outdated') {
      return '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,oklch(0.65 0.15 75) 18%,transparent);color:oklch(0.55 0.15 75);font-size:11px;font-weight:600;">⚠ Ancien</span>';
    }
    return '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--red,oklch(0.55 0.20 15)) 14%,transparent);color:var(--red,oklch(0.55 0.20 15));font-size:11px;font-weight:600;">✗ Manquant</span>';
  }

  function renderDeps(data) {
    var body = $('[data-v30-deps-body]');
    if (!body) return;
    var s = data.summary || {};
    var deps = data.deps || [];

    var summaryHtml = '<div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 12px;background:var(--surface-2);border-radius:var(--r-sm);margin-bottom:12px;font-size:12.5px;">' +
      '<span><b>' + s.total + '</b> dépendances</span>' +
      '<span style="color:var(--success);"><b>' + (s.ok || 0) + '</b> OK</span>' +
      '<span style="color:oklch(0.55 0.15 75);"><b>' + (s.outdated || 0) + '</b> à mettre à jour</span>' +
      '<span style="color:var(--red,oklch(0.55 0.20 15));"><b>' + (s.missing || 0) + '</b> manquantes</span>' +
      '<span class="muted" style="margin-left:auto;">Python ' + escDep(data.python_version || '?') + '</span>' +
      '</div>';

    var rowsHtml = '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
      '<thead><tr style="border-bottom:1px solid var(--border);text-align:left;color:var(--text-3);font-size:11px;text-transform:uppercase;letter-spacing:.04em;">' +
      '<th style="padding:6px 8px;">Paquet</th>' +
      '<th style="padding:6px 8px;">Requis</th>' +
      '<th style="padding:6px 8px;">Installé</th>' +
      '<th style="padding:6px 8px;text-align:right;">Statut</th>' +
      '</tr></thead><tbody>';
    deps.forEach(function (d) {
      rowsHtml += '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:8px;font-family:var(--font-mono,monospace);">' + escDep(d.name) + '</td>' +
        '<td style="padding:8px;color:var(--text-3);">' + escDep(d.required) + '</td>' +
        '<td style="padding:8px;font-family:var(--font-mono,monospace);">' + (d.installed ? escDep(d.installed) : '<span class="muted">—</span>') + '</td>' +
        '<td style="padding:8px;text-align:right;">' + depBadge(d.status) +
          (d.error ? '<div style="font-size:10.5px;color:var(--text-3);margin-top:2px;">' + escDep(d.error) + '</div>' : '') +
        '</td>' +
        '</tr>';
    });
    rowsHtml += '</tbody></table>';

    body.innerHTML = summaryHtml + rowsHtml;

    // Bouton "Installer ce qui manque" seulement si problème
    var installBtn = $('[data-v30-deps-install]');
    if (installBtn) {
      installBtn.hidden = !(s.missing || s.outdated);
    }
  }

  function loadDeps() {
    var body = $('[data-v30-deps-body]');
    if (body) body.innerHTML = '<div class="empty" style="padding:24px;">Analyse des dépendances…</div>';
    var installBtn = $('[data-v30-deps-install]');
    if (installBtn) installBtn.hidden = true;
    fetch('/api/deploy/check-deps', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || 'Échec');
        renderDeps(data);
      })
      .catch(function (err) {
        if (body) body.innerHTML = '<div class="empty" style="color:var(--red);padding:24px;">Erreur : ' + escDep(err.message) + '</div>';
      });
  }

  function installMissing() {
    var btn = $('[data-v30-deps-install]');
    if (!btn) return;
    if (!confirm('Lancer "pip install -r requirements.txt --upgrade" ?\n\nDurée : 1-2 min en temps normal, mais 10-15 min si torch / faster-whisper / pyannote sont à installer (~3 GB).\n\nNe ferme pas la fenêtre pendant l\'installation.')) return;
    btn.disabled = true;
    var origText = btn.textContent;
    btn.textContent = 'Installation en cours…';
    var body = $('[data-v30-deps-body]');
    if (body) body.innerHTML = '<div class="empty" style="padding:24px;">Installation en cours…<br><span class="muted" style="font-size:11.5px;">Si torch / whisper sont à installer pour la 1re fois : ~10 min (3 GB de download).<br>Reste sur cette page jusqu\'à la fin.</span></div>';
    fetch('/api/deploy/install-deps', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var ok = !!(data && data.ok);
        var log = (data && (data.stdout || data.stderr)) || data && data.error || '';
        if (body) {
          body.innerHTML =
            '<div style="padding:10px 12px;border-radius:var(--r-sm);background:' +
              (ok ? 'color-mix(in srgb,var(--success) 12%,transparent)' : 'color-mix(in srgb,var(--red,oklch(0.55 0.20 15)) 14%,transparent)') +
              ';color:' + (ok ? 'var(--success)' : 'var(--red,oklch(0.55 0.20 15))') + ';font-weight:500;margin-bottom:10px;">' +
              (ok ? '✓ Installation terminée' : '✗ Installation échouée') +
            '</div>' +
            '<pre style="background:var(--surface-2);padding:10px;border-radius:var(--r-sm);max-height:300px;overflow:auto;font-size:11px;line-height:1.5;white-space:pre-wrap;">' + escDep(log) + '</pre>' +
            '<div class="muted" style="font-size:11.5px;margin-top:8px;">Re-scan automatique…</div>';
        }
        // Auto re-check
        setTimeout(loadDeps, 1500);
      })
      .catch(function (err) {
        if (body) body.innerHTML = '<div class="empty" style="color:var(--red);padding:24px;">Erreur : ' + escDep(err.message) + '</div>';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = origText;
      });
  }

  function openDepsModal() {
    var bd = $('[data-v30-deps-modal-bd]');
    if (!bd) return;
    bd.hidden = false;
    bd.classList.add('is-open');
    loadDeps();
  }

  function closeDepsModal() {
    var bd = $('[data-v30-deps-modal-bd]');
    if (!bd) return;
    bd.classList.remove('is-open');
    bd.hidden = true;
  }

  function bindDepsCheck() {
    var trigger = $('[data-v30-deps-check]');
    if (trigger) trigger.addEventListener('click', openDepsModal);
    document.querySelectorAll('[data-v30-deps-close]').forEach(function (b) {
      b.addEventListener('click', closeDepsModal);
    });
    var bd = $('[data-v30-deps-modal-bd]');
    if (bd) {
      bd.addEventListener('click', function (e) { if (e.target === bd) closeDepsModal(); });
    }
    var refresh = $('[data-v30-deps-refresh]');
    if (refresh) refresh.addEventListener('click', loadDeps);
    var install = $('[data-v30-deps-install]');
    if (install) install.addEventListener('click', installMissing);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var bd2 = $('[data-v30-deps-modal-bd]');
        if (bd2 && !bd2.hidden) closeDepsModal();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  Bind global
  // ══════════════════════════════════════════════════════════════
  function bindDeploy() {
    var pull = $('[data-v30-deploy-pull]');
    if (pull) pull.addEventListener('click', doPull);
    var roll = $('[data-v30-deploy-rollback]');
    if (roll) roll.addEventListener('click', doRollback);
    var rest = $('[data-v30-deploy-restart]');
    if (rest) rest.addEventListener('click', doRestart);
    var chg = $('[data-v30-deploy-remote-change]');
    if (chg) chg.addEventListener('click', changeRemote);
    if ($('[data-v30-deploy-remote]')) loadRemote();
    bindDepsCheck();
  }

  function openCardFromQuery() {
    var params = new URLSearchParams(window.location.search);
    var cardId = params.get('card');
    if (!cardId) return;
    var attr = 'data-v30-' + cardId;
    var card = document.querySelector('[' + attr + ']');
    if (!card) return;
    card.open = true;
    setTimeout(function () {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  function bind() {
    bindTabs();
    bindDeploy();
    bindAi();
    bindGoals();
    bindKpi();
    bindCalSync();
    bindBackup();
    bindNotif();
    bindAccount();
    bindAbout();
    openCardFromQuery();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
