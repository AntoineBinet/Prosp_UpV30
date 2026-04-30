/* ProspUp v30 — DC Generator */
(function () {
  'use strict';

  var root = document.querySelector('[data-v30-dc]');
  if (!root) return;

  var CID = Number(root.dataset.candidateId || 0) || null;
  var _interviewData = {};
  var _downloadUrl = null;

  function $(s, ctx) { return (ctx || root).querySelector(s); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return iso; }
  }

  // ─── Candidate info ────────────────────────────────────
  function loadCandidate() {
    if (!CID) return;
    var host = $('[data-v30-dc-cand-info]');
    if (!host) return;
    fetchJSON('/api/candidates/' + CID).then(function (res) {
      var c = (res && res.candidate) || {};
      host.innerHTML =
        '<div class="v30-dc__cand-name">' + esc(c.name || '—') + '</div>' +
        '<div class="v30-dc__cand-role">' + esc([c.role || c.titre, c.location].filter(Boolean).join(' · ') || '—') + '</div>';
      if (c.entretien_date) {
        var el = $('[name="entretien_date"]');
        if (el) el.value = c.entretien_date;
      }
      if (c.entretien_lieu) {
        var el2 = $('[name="entretien_lieu"]');
        if (el2) el2.value = c.entretien_lieu;
      }
      if (c.entretien_notes) {
        var el3 = $('[name="entretien_notes"]');
        if (el3) el3.value = c.entretien_notes;
      }
      if (c.eval_technique) {
        var el4 = $('[name="eval_technique"]');
        if (el4) el4.value = c.eval_technique;
      }
    }).catch(function () {
      host.innerHTML = '<div class="empty" style="font-size:12px;color:var(--text-3);">Candidat #' + CID + '</div>';
    });
  }

  // ─── File upload drop zone ─────────────────────────────
  function bindUpload() {
    var zone = $('[data-v30-dc-drop-zone]');
    var fileInput = $('[data-v30-dc-file-input]');
    var fileName = $('[data-v30-dc-file-name]');
    if (!zone || !fileInput) return;

    function setFile(file) {
      if (!file) return;
      fileInput._selectedFile = file;
      if (fileName) {
        fileName.textContent = file.name;
        fileName.hidden = false;
      }
      zone.classList.add('has-file');
      zone.classList.remove('is-over');
    }

    zone.addEventListener('dragover', function (e) {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', function () {
      zone.classList.remove('is-over');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFile(f);
    });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (f) setFile(f);
    });
  }

  // ─── Interview modal ────────────────────────────────────
  function openInterviewModal() {
    var modal = document.querySelector('[data-v30-dc-interview-modal]');
    if (!modal) return;
    Object.keys(_interviewData).forEach(function (k) {
      var el = modal.querySelector('[name="' + k + '"]');
      if (el) el.value = _interviewData[k] || '';
    });
    modal.hidden = false;
    var first = modal.querySelector('input,textarea');
    if (first) first.focus();
  }

  function saveInterviewModal() {
    var modal = document.querySelector('[data-v30-dc-interview-modal]');
    if (!modal) return;
    ['entretien_date', 'entretien_lieu', 'entretien_notes', 'eval_technique'].forEach(function (k) {
      var el = modal.querySelector('[name="' + k + '"]');
      if (el) _interviewData[k] = el.value.trim();
    });
    modal.hidden = true;
    updateInterviewPreview();
  }

  function updateInterviewPreview() {
    var preview = $('[data-v30-dc-interview-preview]');
    if (!preview) return;
    var parts = [];
    if (_interviewData.entretien_date) parts.push('Date : ' + _interviewData.entretien_date);
    if (_interviewData.entretien_lieu)  parts.push('Lieu : ' + _interviewData.entretien_lieu);
    if (_interviewData.entretien_notes) parts.push('Notes : ' + _interviewData.entretien_notes.slice(0, 80) + (_interviewData.entretien_notes.length > 80 ? '…' : ''));
    if (parts.length) {
      preview.textContent = parts.join('\n');
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
  }

  // ─── Generation ────────────────────────────────────────
  function setGenerating(on) {
    var genArea = $('[data-v30-dc-generate-area]');
    var progress = $('[data-v30-dc-progress]');
    var result = $('[data-v30-dc-result]');
    var errEl = $('[data-v30-dc-error]');
    if (genArea) genArea.hidden = on;
    if (progress) progress.hidden = !on;
    if (result) result.hidden = true;
    if (errEl) errEl.hidden = true;
  }

  function showResult(data) {
    var progress = $('[data-v30-dc-progress]');
    var result = $('[data-v30-dc-result]');
    if (progress) progress.hidden = true;
    if (!result) return;
    result.hidden = false;
    var nameEl = result.querySelector('[data-v30-dc-result-name]');
    var dateEl = result.querySelector('[data-v30-dc-result-date]');
    var dlBtn  = result.querySelector('[data-v30-dc-download]');
    if (nameEl) nameEl.textContent = data.filename || 'DC généré';
    if (dateEl) {
      var label = 'Généré ' + (data.generated_at || '');
      if (data.used_ollama) label += ' · extraction IA';
      dateEl.textContent = label;
    }
    _downloadUrl = data.download_url;
    if (dlBtn) {
      dlBtn.href = _downloadUrl;
      dlBtn.setAttribute('download', data.filename || 'dossier.docx');
    }
    addToHistory({ filename: data.filename, date: data.generated_at, url: _downloadUrl });

    var missing = data.missing_fields || [];
    if (missing.length) {
      var warn = 'DC généré · champs à compléter manuellement : ' + missing.join(', ');
      if (window.showToast) window.showToast(warn, 'warning', 6000);
    } else {
      if (window.showToast) window.showToast('DC généré avec succès', 'success', 3000);
    }
  }

  function showError(msg) {
    var progress = $('[data-v30-dc-progress]');
    var errEl = $('[data-v30-dc-error]');
    var genArea = $('[data-v30-dc-generate-area]');
    if (progress) progress.hidden = true;
    if (genArea) genArea.hidden = false;
    if (!errEl) return;
    errEl.hidden = false;
    var msgEl = errEl.querySelector('[data-v30-dc-error-msg]');
    if (msgEl) msgEl.textContent = msg || 'Erreur lors de la génération';
    if (window.showToast) window.showToast(msg || 'Erreur génération DC', 'error', 4000);
  }

  function generate() {
    setGenerating(true);

    var fd = new FormData();
    if (CID) fd.append('candidate_id', CID);
    fd.append('titre_override', ($('#v30-dc-titre') && document.getElementById('v30-dc-titre').value.trim()) || '');
    fd.append('exp_override', ($('#v30-dc-exp') && document.getElementById('v30-dc-exp').value.trim()) || '');
    fd.append('use_ollama', 'auto');

    var fileInput = $('[data-v30-dc-file-input]');
    if (fileInput && fileInput._selectedFile) {
      fd.append('cv_file', fileInput._selectedFile);
    }

    var progressLabel = $('[data-v30-dc-progress-label]');
    if (progressLabel) progressLabel.textContent = 'Génération en cours…';

    fetch('/dc-generator/generate', {
      method: 'POST',
      credentials: 'same-origin',
      body: fd
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error((j && j.error) || 'HTTP ' + r.status); });
      return r.json();
    }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'Échec');
      showResult(data);
    }).catch(function (err) {
      showError(err.message || 'Erreur inconnue');
    });
  }

  // ─── History (persistent, DB-backed) ────────────────────
  var _history = [];

  function addToHistory(_item) {
    // After a fresh generation, refetch full history from server
    loadHistory();
  }

  function loadHistory() {
    var url = '/api/dc/history' + (CID ? '?candidate_id=' + CID : '');
    fetchJSON(url).then(function (res) {
      _history = (res && res.data) || [];
      renderHistory();
    }).catch(function () {
      var host = $('[data-v30-dc-history]');
      var side = $('[data-v30-dc-history-side]');
      var msg = '<div class="empty" style="font-size:12px;color:var(--text-3);padding:8px 0;">Historique indisponible.</div>';
      if (host) host.innerHTML = msg;
      if (side) side.innerHTML = msg;
    });
  }

  function _historyItemHTML(h, compact) {
    var actions = '';
    if (h.exists !== false) {
      actions += '<a class="btn btn-ghost btn-sm" href="' + esc(h.download_url || '#') + '" target="_blank" rel="noopener" download>Télécharger</a>';
    } else {
      actions += '<span class="muted" style="font-size:11px;">Fichier introuvable</span>';
    }
    actions += ' <button type="button" class="btn btn-ghost btn-sm" data-v30-dc-hist-del="' + esc(h.id) + '">Supprimer</button>';
    var candLine = h.candidate_name
      ? '<div class="v30-dc__hist-cand muted" style="font-size:11px;">' + esc(h.candidate_name) + (h.candidate_role ? ' · ' + esc(h.candidate_role) : '') + '</div>'
      : '';
    var ollamaBadge = h.used_ollama
      ? ' <span class="badge badge-dot" title="Extraction IA locale">IA</span>'
      : '';
    return '<div class="v30-dc__hist-item" data-hist-id="' + esc(h.id) + '">' +
      '<div class="v30-dc__hist-name">' + esc(h.filename || '—') + ollamaBadge + '</div>' +
      candLine +
      '<div class="v30-dc__hist-date muted" style="font-size:11px;">' + esc(h.generated_at_human || '') + '</div>' +
      '<div class="v30-dc__hist-actions" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">' + actions + '</div>' +
    '</div>';
  }

  function renderHistory() {
    var host = $('[data-v30-dc-history]');
    var side = $('[data-v30-dc-history-side]');
    var emptyMsg = '<div class="empty" style="font-size:12px;color:var(--text-3);padding:8px 0;">Aucun DC généré pour le moment.</div>';
    if (!_history.length) {
      if (host) host.innerHTML = emptyMsg;
      if (side) side.innerHTML = emptyMsg;
      return;
    }
    if (host) host.innerHTML = _history.map(function (h) { return _historyItemHTML(h, false); }).join('');
    if (side) side.innerHTML = _history.slice(0, 5).map(function (h) { return _historyItemHTML(h, true); }).join('');
  }

  function deleteHistory(genId) {
    if (!genId) return;
    if (!window.confirm('Supprimer ce DC ? Le fichier sera également retiré du disque.')) return;
    fetch('/api/dc/' + encodeURIComponent(genId), {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function () {
      if (window.showToast) window.showToast('DC supprimé', 'success', 2500);
      loadHistory();
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur suppression : ' + (err.message || ''), 'error', 4000);
    });
  }

  // ─── Tabs (Générateur | Historique) ─────────────────────
  function switchTab(tab) {
    var btns = document.querySelectorAll('[data-v30-dc-tab-btn]');
    var panels = document.querySelectorAll('[data-v30-dc-tab-panel]');
    btns.forEach(function (b) {
      var on = b.getAttribute('data-v30-dc-tab-btn') === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach(function (p) {
      p.hidden = (p.getAttribute('data-v30-dc-tab-panel') !== tab);
    });
    if (tab === 'history') loadHistory();
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    loadCandidate();
    bindUpload();
    loadHistory();

    document.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-v30-dc-tab-btn]');
      if (tabBtn) {
        switchTab(tabBtn.getAttribute('data-v30-dc-tab-btn')); return;
      }
      var delBtn = e.target.closest('[data-v30-dc-hist-del]');
      if (delBtn) {
        deleteHistory(delBtn.getAttribute('data-v30-dc-hist-del')); return;
      }
      if (e.target.closest('[data-v30-dc-open-interview]')) {
        openInterviewModal(); return;
      }
      if (e.target.closest('[data-v30-dc-generate]')) {
        generate(); return;
      }
      if (e.target.closest('[data-v30-dc-retry]')) {
        var genArea = $('[data-v30-dc-generate-area]');
        var errEl = $('[data-v30-dc-error]');
        if (genArea) genArea.hidden = false;
        if (errEl) errEl.hidden = true;
        return;
      }
      if (e.target.closest('[data-v30-dc-interview-save]')) {
        saveInterviewModal(); return;
      }
      var closeBtn = e.target.closest('[data-v30-modal-close]');
      if (closeBtn && closeBtn.closest('[data-v30-dc-interview-modal]')) {
        document.querySelector('[data-v30-dc-interview-modal]').hidden = true; return;
      }
      var backdrop = e.target.closest('[data-v30-dc-interview-modal]');
      if (backdrop && e.target === backdrop) {
        backdrop.hidden = true; return;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = document.querySelector('[data-v30-dc-interview-modal]');
        if (m && !m.hidden) m.hidden = true;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
