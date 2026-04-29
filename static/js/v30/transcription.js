/* ProspUp v30 — Page liste Transcription
   - Charge la liste via /api/transcription
   - Modal upload → POST /api/transcription/upload
   - Polling auto pour les jobs en cours (status pending/processing) */
(function () {
  'use strict';

  if (!document.querySelector('[data-v30-tx]')) return;

  var POLL_MS = 4000;
  var pollTimer = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function fmtBytes(n) {
    if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function fmtDuration(s) {
    if (!s || s < 0) return '';
    s = Math.round(s);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h ? (h + 'h' + String(m).padStart(2, '0')) : (m + 'min ' + String(sec).padStart(2, '0') + 's');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
           ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function statusBadge(status, progress) {
    var cls = 'v30-tx-badge';
    var label = status;
    if (status === 'pending')    { cls += ' is-pending';    label = 'En attente'; }
    if (status === 'processing') { cls += ' is-processing'; label = 'En cours · ' + (progress || 0) + '%'; }
    if (status === 'done')       { cls += ' is-done';       label = 'Terminé'; }
    if (status === 'error')      { cls += ' is-error';      label = 'Erreur'; }
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }

  // ─── Liste ──────────────────────────────────────────────────────────
  function loadList() {
    return fetch('/api/transcription', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'erreur');
        renderList(j.items || []);
      })
      .catch(function (e) {
        var c = $('[data-v30-tx-list]');
        if (c) c.innerHTML = '<p class="v30-tx-empty">Erreur : ' + esc(e.message) + '</p>';
      });
  }

  function renderList(items) {
    var c = $('[data-v30-tx-list]');
    if (!c) return;
    if (!items.length) {
      c.innerHTML =
        '<div class="v30-tx-empty">' +
          '<p>Aucune transcription pour le moment.</p>' +
          '<p class="muted">Clique sur « Nouveau fichier audio » pour démarrer.</p>' +
        '</div>';
      return;
    }
    var html = items.map(function (it) {
      var hasErr = it.status === 'error';
      var url = '/v30/transcription/' + it.id;
      var subBits = [];
      if (it.duration_sec) subBits.push(fmtDuration(it.duration_sec));
      if (it.audio_size)   subBits.push(fmtBytes(it.audio_size));
      if (it.language)     subBits.push(it.language.toUpperCase());
      return (
        '<a class="v30-tx-card" href="' + url + '">' +
          '<div class="v30-tx-card__top">' +
            '<span class="v30-tx-card__title">' + esc(it.title || '—') + '</span>' +
            statusBadge(it.status, it.progress) +
          '</div>' +
          '<div class="v30-tx-card__meta muted">' +
            '<span>' + esc(it.audio_filename || '—') + '</span>' +
            (subBits.length ? '<span> · ' + esc(subBits.join(' · ')) + '</span>' : '') +
          '</div>' +
          '<div class="v30-tx-card__bottom muted">' +
            '<span>' + esc(fmtDate(it.created_at)) + '</span>' +
            (hasErr ? '<span class="v30-tx-card__err">⚠ ' + esc(it.error_message || '') + '</span>' : '') +
          '</div>' +
          (it.status === 'processing'
            ? '<div class="v30-tx-progress__bar v30-tx-progress__bar--mini">' +
              '<div class="v30-tx-progress__fill" style="width:' + Math.max(0, Math.min(100, it.progress || 0)) + '%"></div></div>'
            : '') +
        '</a>'
      );
    }).join('');
    c.innerHTML = html;
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      // Si au moins un item est pending/processing, on rafraîchit
      var hasActive = $$('.v30-tx-badge.is-pending, .v30-tx-badge.is-processing').length > 0;
      if (hasActive) loadList();
    }, POLL_MS);
  }

  // ─── Modal upload ───────────────────────────────────────────────────
  // currentFile : on stocke le fichier sélectionné dans une closure plutôt
  // que de relire fileInput.files au moment du submit. Sur certains
  // navigateurs (Safari, Edge), input.files = dt2.files (assignation après
  // drag&drop) échoue silencieusement → le bouton « Lancer » paraissait
  // mort.
  var currentFile = null;

  function openModal() {
    var m = $('[data-v30-tx-upload-modal]');
    if (!m) return;
    m.hidden = false;
    void m.offsetWidth; // force reflow pour activer la transition opacity
    m.classList.add('is-open');
    setTimeout(function () { var t = $('#v30-tx-title'); if (t) t.focus(); }, 30);
    // Preflight auto à l'ouverture (informatif, le clic Lancer le refera)
    runPreflight().then(updatePreflightUI);
  }
  function closeModal() {
    var m = $('[data-v30-tx-upload-modal]');
    if (m) {
      m.classList.remove('is-open');
      setTimeout(function () { m.hidden = true; }, 180);
    }
    resetForm();
  }
  function resetForm() {
    var t = $('#v30-tx-title'); if (t) t.value = '';
    var f = $('#v30-tx-file');  if (f) f.value = '';
    currentFile = null;
    showFile(null);
    showProgress(false);
    var sb = $('[data-v30-tx-submit]'); if (sb) sb.disabled = true;
  }
  function showFile(file) {
    var inner = $('[data-v30-tx-drop-inner]');
    var box = $('[data-v30-tx-drop-file]');
    var name = $('[data-v30-tx-file-name]');
    var size = $('[data-v30-tx-file-size]');
    var sb = $('[data-v30-tx-submit]');
    currentFile = file || null;
    if (!file) {
      if (inner) inner.hidden = false;
      if (box)   box.hidden = true;
      if (sb)    sb.disabled = true;
      return;
    }
    if (inner) inner.hidden = true;
    if (box)   box.hidden = false;
    if (name)  name.textContent = file.name;
    if (size)  size.textContent = '· ' + fmtBytes(file.size);
    var titleEl = $('#v30-tx-title');
    if (titleEl && !titleEl.value) titleEl.value = file.name.replace(/\.[^.]+$/, '');
    if (sb && titleEl && titleEl.value.trim()) sb.disabled = false;
  }
  function showProgress(on, pct, label) {
    var box = $('[data-v30-tx-progress]');
    var fill = $('[data-v30-tx-progress-fill]');
    var lab = $('[data-v30-tx-progress-label]');
    if (!box) return;
    box.hidden = !on;
    if (on) {
      if (fill) fill.style.width = (pct || 0) + '%';
      if (lab) lab.textContent = label || 'Upload…';
    }
  }

  function bindUpload() {
    var btnNew = $('[data-v30-tx-new]');
    if (btnNew) btnNew.addEventListener('click', openModal);

    $$('[data-v30-modal-close]').forEach(function (b) { b.addEventListener('click', closeModal); });
    var modal = $('[data-v30-tx-upload-modal]');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal && !modal.hidden) closeModal();
    });

    var browse = $('[data-v30-tx-browse]');
    if (browse) browse.addEventListener('click', function () { var f = $('#v30-tx-file'); if (f) f.click(); });

    var fileInput = $('#v30-tx-file');
    if (fileInput) fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) showFile(f);
    });

    var clear = $('[data-v30-tx-file-clear]');
    if (clear) clear.addEventListener('click', function (e) {
      e.preventDefault();
      var f = $('#v30-tx-file'); if (f) f.value = '';
      currentFile = null;
      showFile(null);
    });

    var titleEl = $('#v30-tx-title');
    if (titleEl) titleEl.addEventListener('input', function () {
      var sb = $('[data-v30-tx-submit]');
      if (sb) sb.disabled = !(titleEl.value.trim() && currentFile);
    });

    var drop = $('[data-v30-tx-drop]');
    if (drop) {
      ['dragenter','dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-dragover'); });
      });
      ['dragleave','drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-dragover'); });
      });
      drop.addEventListener('drop', function (e) {
        var dt = e.dataTransfer;
        if (!dt || !dt.files || !dt.files[0]) return;
        var f = dt.files[0];
        // Tente de syncer avec le file input (utile si jamais on en a besoin
        // ailleurs), mais on n'en dépend plus — currentFile fait foi.
        var inp = $('#v30-tx-file');
        if (inp) {
          try {
            var dt2 = new DataTransfer();
            dt2.items.add(f);
            inp.files = dt2.files;
          } catch (_err) { /* certains navigateurs bloquent l'assignation */ }
        }
        showFile(f);
      });
    }

    var submit = $('[data-v30-tx-submit]');
    if (submit) submit.addEventListener('click', onSubmitClick);

    var recheck = $('[data-v30-tx-preflight-recheck]');
    if (recheck) recheck.addEventListener('click', function () {
      runPreflight().then(updatePreflightUI);
    });
  }

  // ─── Preflight ──────────────────────────────────────────────────────
  function runPreflight() {
    return fetch('/api/transcription/preflight', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  }

  function updatePreflightUI(data) {
    var box = $('[data-v30-tx-preflight]');
    var listEl = $('[data-v30-tx-preflight-list]');
    var titleEl = $('[data-v30-tx-preflight-title]');
    var actionsEl = $('[data-v30-tx-preflight-actions]');
    var billing = $('[data-v30-tx-preflight-billing]');
    var settings = $('[data-v30-tx-preflight-settings]');
    var sb = $('[data-v30-tx-submit]');
    if (!box || !listEl) return data;
    box.hidden = false;
    if (!data) {
      titleEl.textContent = '⚠ Échec du preflight (réseau ?)';
      listEl.innerHTML = '';
      if (sb) sb.disabled = false;
      return data;
    }
    var rows = [];
    var c = data.claude || {};
    if (c.ok) {
      rows.push({ icon: '✓', cls: 'ok', label: 'Claude API', detail: 'Crédits OK · ' + (c.model || 'modèle ?') });
    } else if (c.error === 'credits_exhausted') {
      rows.push({ icon: '✗', cls: 'err', label: 'Claude API', detail: 'Crédits épuisés — recharge requise.' });
    } else if (c.error === 'invalid_key') {
      rows.push({ icon: '✗', cls: 'err', label: 'Claude API', detail: 'Clé invalide. Vérifie dans Paramètres.' });
    } else {
      rows.push({ icon: '✗', cls: 'err', label: 'Claude API', detail: c.error_msg || c.error || 'erreur' });
    }
    var h = data.huggingface || {};
    if (h.skipped)    rows.push({ icon: '–', cls: 'skip', label: 'Diarisation', detail: 'Désactivée dans Paramètres' });
    else if (h.ok)    rows.push({ icon: '✓', cls: 'ok',   label: 'HuggingFace · pyannote', detail: 'Accès aux 2 modèles validé' });
    else              rows.push({ icon: '✗', cls: 'warn', label: 'HuggingFace · pyannote', detail: h.error || 'erreur' });
    var g = data.gpu || {};
    if (g.ok)         rows.push({ icon: '✓', cls: 'ok',   label: 'GPU CUDA', detail: (g.device || '?') + (g.vram_gb ? ' · ' + g.vram_gb + ' GB' : '') });
    else              rows.push({ icon: '⚠', cls: 'warn', label: 'GPU CUDA', detail: 'Indisponible — Whisper en CPU (lent)' });
    if (data.fallback_ollama_active) {
      rows.push({ icon: '!', cls: 'warn', label: 'Fallback Ollama', detail: 'Activé — sera utilisé si Claude KO (qualité moindre)' });
    }
    listEl.innerHTML = rows.map(function (r) {
      return '<li><span class="icon ' + r.cls + '">' + r.icon + '</span>'
           + '<span class="label">' + r.label + '</span>'
           + '<span class="detail">— ' + escapeHtml(r.detail) + '</span></li>';
    }).join('');

    var canStart = !!data.ok;
    if (sb) sb.disabled = !canStart || !($('#v30-tx-title').value.trim() && currentFile);

    var needBilling = (c.error === 'credits_exhausted');
    var needSettings = (c.error === 'invalid_key' || c.error === 'credits_exhausted');
    if (billing) billing.hidden = !needBilling;
    if (settings) settings.hidden = !needSettings;
    if (actionsEl) actionsEl.hidden = !(needBilling || needSettings);

    if (canStart) {
      titleEl.textContent = data.warnings && data.warnings.length
        ? '⚠ Prêt à lancer (avec avertissements)'
        : '✓ Prêt à lancer';
    } else {
      titleEl.textContent = '✗ Lancement bloqué — corrige les points ✗ ci-dessus';
    }
    return data;
  }

  function escapeHtml(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }

  // Le clic « Lancer » fait d'abord un preflight, puis si OK → upload
  function onSubmitClick() {
    var titleEl = $('#v30-tx-title');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) {
      if (window.showToast) window.showToast('Donne un titre à la réunion', 'warn');
      return;
    }
    if (!currentFile) {
      if (window.showToast) window.showToast('Sélectionne un fichier audio', 'warn');
      return;
    }
    var sb = $('[data-v30-tx-submit]');
    if (sb) { sb.disabled = true; sb.textContent = 'Vérification…'; }
    runPreflight().then(function (data) {
      if (sb) sb.textContent = 'Lancer la transcription';
      var ok = updatePreflightUI(data);
      if (!ok || !ok.ok) {
        if (sb) sb.disabled = false;
        if (window.showToast) window.showToast('Lancement bloqué — corrige les points rouges', 'error');
        return;
      }
      doUpload();
    });
  }

  function doUpload() {
    var titleEl = $('#v30-tx-title');
    var title = titleEl ? titleEl.value.trim() : '';
    var sb = $('[data-v30-tx-submit]');
    if (sb) sb.disabled = true;

    var fd = new FormData();
    fd.append('title', title);
    fd.append('audio', currentFile);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcription/upload', true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var pct = Math.round(e.loaded / e.total * 100);
        showProgress(true, pct, 'Upload ' + pct + '%…');
      }
    };
    xhr.onload = function () {
      var ok = xhr.status >= 200 && xhr.status < 300;
      var data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (!ok || !data.ok) {
        showProgress(false);
        if (sb) sb.disabled = false;
        var msg = (data && data.error) || ('HTTP ' + xhr.status);
        if (window.showToast) window.showToast('Upload échoué : ' + msg, 'error');
        else alert('Upload échoué : ' + msg);
        return;
      }
      if (window.showToast) window.showToast('Transcription démarrée', 'success');
      closeModal();
      // Redirige direct sur la fiche détail (le polling y prend le relais)
      window.location.href = '/v30/transcription/' + data.id;
    };
    xhr.onerror = function () {
      showProgress(false);
      if (sb) sb.disabled = false;
      if (window.showToast) window.showToast('Erreur réseau', 'error');
    };
    showProgress(true, 0, 'Upload…');
    xhr.send(fd);
  }

  // ─── Init ───────────────────────────────────────────────────────────
  function init() {
    bindUpload();
    var refresh = $('[data-v30-tx-refresh]');
    if (refresh) refresh.addEventListener('click', loadList);
    loadList().then(startPolling);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
