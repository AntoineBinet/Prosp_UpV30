/* ProspUp v30 — Page détail Transcription
   - Charge GET /api/transcription/<id>
   - Polling tant que status != done/error
   - Render transcript par orateur + analyse Claude
   - Actions : retry, delete, copy, export */
(function () {
  'use strict';

  var root = document.querySelector('[data-v30-tx-detail]');
  if (!root) return;
  var TID = root.getAttribute('data-tx-id');
  if (!TID) return;

  var POLL_MS = 3000;
  var pollTimer = null;
  var SPEAKER_COLORS = [
    'oklch(0.55 0.18 280)',
    'oklch(0.60 0.16 200)',
    'oklch(0.58 0.18 130)',
    'oklch(0.65 0.16 50)',
    'oklch(0.60 0.20 0)',
    'oklch(0.55 0.18 320)',
  ];
  var SPEAKER_MAP = {};

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function esc(v) {
    var t = document.createElement('span');
    t.textContent = v == null ? '' : String(v);
    return t.innerHTML;
  }
  function fmtDuration(s) {
    if (!s || s < 0) return '';
    s = Math.round(s);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return h ? (h + 'h' + String(m).padStart(2, '0') + 'min') :
               (m + 'min ' + String(sec).padStart(2, '0') + 's');
  }
  function speakerColor(label) {
    if (!SPEAKER_MAP[label]) {
      var idx = Object.keys(SPEAKER_MAP).length % SPEAKER_COLORS.length;
      SPEAKER_MAP[label] = SPEAKER_COLORS[idx];
    }
    return SPEAKER_MAP[label];
  }
  function statusBadgeHtml(status, progress) {
    if (status === 'pending')    return '<span class="v30-tx-badge is-pending">En attente</span>';
    if (status === 'processing') return '<span class="v30-tx-badge is-processing">En cours · ' + (progress || 0) + '%</span>';
    if (status === 'done')       return '<span class="v30-tx-badge is-done">Terminé</span>';
    if (status === 'error')      return '<span class="v30-tx-badge is-error">Erreur</span>';
    return '<span class="v30-tx-badge">' + esc(status || '—') + '</span>';
  }

  // ─── Render ─────────────────────────────────────────────────────────
  function render(item) {
    if (!item) return;
    $('[data-v30-tx-title]').textContent = item.title || '—';
    $('[data-v30-tx-status]').outerHTML = statusBadgeHtml(item.status, item.progress).replace(/^<span/, '<span data-v30-tx-status');

    // Pending / processing
    var pending = $('[data-v30-tx-pending]');
    var fill = $('[data-v30-tx-progress-fill]');
    var stage = $('[data-v30-tx-progress-stage]');
    var inProgress = (item.status === 'pending' || item.status === 'processing');
    pending.hidden = !inProgress;
    if (inProgress) {
      if (fill) fill.style.width = Math.max(0, Math.min(100, item.progress || 0)) + '%';
      if (stage) stage.textContent = item.stage || 'Démarrage…';
    }

    // Erreur
    var err = $('[data-v30-tx-error]');
    var errMsg = $('[data-v30-tx-error-msg]');
    if (item.status === 'error' && item.error_message) {
      err.hidden = false;
      errMsg.textContent = item.error_message;
      var rb = $('[data-v30-tx-retry]');
      if (rb) rb.hidden = false;
    } else {
      err.hidden = true;
      var rb2 = $('[data-v30-tx-retry]');
      if (rb2) rb2.hidden = !(item.status === 'error');
    }

    // Audio
    var audio = $('[data-v30-tx-audio]');
    var audSrc = $('[data-v30-tx-audio-src]');
    var audEl = $('[data-v30-tx-audio-el]');
    if (audio && audSrc && audEl) {
      audSrc.src = '/api/transcription/' + TID + '/audio';
      audEl.load();
      audio.hidden = false;
      $('[data-v30-tx-meta-duration]').textContent = item.duration_sec ? fmtDuration(item.duration_sec) : '';
      $('[data-v30-tx-meta-language]').textContent = item.language ? '· ' + item.language.toUpperCase() : '';
      var modelBits = [];
      if (item.whisper_model)  modelBits.push('Whisper ' + item.whisper_model);
      if (item.analysis_model) modelBits.push(item.analysis_model);
      $('[data-v30-tx-meta-model]').textContent = modelBits.length ? '· ' + modelBits.join(' · ') : '';
    }

    // Transcript + analyse uniquement si done (ou si transcript dispo malgré erreur d'analyse)
    var grid = $('[data-v30-tx-grid]');
    var hasTranscript = (item.transcript_text || '').trim().length > 0;
    grid.hidden = !hasTranscript;
    if (hasTranscript) {
      renderTranscript(item.segments || [], item.transcript_text || '');
      renderAnalysis(item.analysis || null);
    }

    // Export
    var exp = $('[data-v30-tx-export]');
    if (exp) exp.href = '/api/transcription/' + TID + '/export.txt';
  }

  function renderTranscript(segments, fallbackText) {
    var c = $('[data-v30-tx-transcript]');
    if (!c) return;
    if (segments && segments.length) {
      var groups = [];
      var current = null;
      segments.forEach(function (s) {
        var sp = s.speaker || 'Speaker 1';
        if (!current || current.speaker !== sp) {
          current = { speaker: sp, start: s.start, lines: [] };
          groups.push(current);
        }
        current.lines.push(s.text || '');
      });
      c.innerHTML = groups.map(function (g) {
        var color = speakerColor(g.speaker);
        var ts = fmtTimestamp(g.start);
        return (
          '<div class="v30-tx-turn">' +
            '<div class="v30-tx-turn__head">' +
              '<span class="v30-tx-turn__speaker" style="--c:' + color + '">' + esc(g.speaker) + '</span>' +
              '<span class="v30-tx-turn__time muted">' + esc(ts) + '</span>' +
            '</div>' +
            '<p class="v30-tx-turn__text">' + esc(g.lines.join(' ').trim()) + '</p>' +
          '</div>'
        );
      }).join('');
    } else {
      c.innerHTML = '<pre class="v30-tx-transcript-raw">' + esc(fallbackText) + '</pre>';
    }
  }
  function fmtTimestamp(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return h ? (pad(h) + ':' + pad(m) + ':' + pad(s)) : (pad(m) + ':' + pad(s));
  }

  function renderAnalysis(a) {
    var hide = function (sel) { var el = $(sel); if (el) el.hidden = true; };
    var show = function (sel) { var el = $(sel); if (el) el.hidden = false; };
    var setText = function (sel, val) { var el = $(sel); if (el) el.textContent = val == null ? '—' : val; };
    var setList = function (sel, items, mapper) {
      var ul = $(sel);
      if (!ul) return;
      ul.innerHTML = (items || []).map(mapper).join('');
    };
    if (!a) {
      hide('[data-v30-tx-summary-block]');
      hide('[data-v30-tx-participants-block]');
      hide('[data-v30-tx-topics-block]');
      hide('[data-v30-tx-decisions-block]');
      hide('[data-v30-tx-actions-block]');
      hide('[data-v30-tx-next-block]');
      hide('[data-v30-tx-quality-block]');
      hide('[data-v30-tx-quotes-block]');
      return;
    }
    if (a.summary) {
      show('[data-v30-tx-summary-block]');
      setText('[data-v30-tx-summary]', a.summary);
    }
    if (a.participants && a.participants.length) {
      show('[data-v30-tx-participants-block]');
      setList('[data-v30-tx-participants]', a.participants, function (p) {
        var name = p.guessed_name || p.label;
        var role = p.guessed_role ? ' · ' + esc(p.guessed_role) : '';
        var lab = (p.guessed_name && p.guessed_name !== p.label) ? '<span class="muted"> (' + esc(p.label) + ')</span>' : '';
        return '<li><strong>' + esc(name) + '</strong>' + lab + role + '</li>';
      });
    }
    if (a.topics && a.topics.length) {
      show('[data-v30-tx-topics-block]');
      setList('[data-v30-tx-topics]', a.topics, function (t) { return '<li>' + esc(t) + '</li>'; });
    }
    if (a.decisions && a.decisions.length) {
      show('[data-v30-tx-decisions-block]');
      setList('[data-v30-tx-decisions]', a.decisions, function (t) { return '<li>' + esc(t) + '</li>'; });
    }
    if (a.action_items && a.action_items.length) {
      show('[data-v30-tx-actions-block]');
      setList('[data-v30-tx-actions]', a.action_items, function (it) {
        var prio = it.priority ? '<span class="v30-tx-pill is-prio-' + esc(it.priority) + '">' + esc(it.priority) + '</span>' : '';
        var who  = it.assignee ? '<span class="muted"> · ' + esc(it.assignee) + '</span>' : '';
        var when = it.due_date ? '<span class="muted"> · échéance ' + esc(it.due_date) + '</span>' : '';
        return '<li>' + prio + ' <span>' + esc(it.task || '?') + '</span>' + who + when + '</li>';
      });
    }
    if (a.next_steps && a.next_steps.length) {
      show('[data-v30-tx-next-block]');
      setList('[data-v30-tx-next-steps]', a.next_steps, function (t) { return '<li>' + esc(t) + '</li>'; });
    }
    if (a.sentiment || a.quality_score != null) {
      show('[data-v30-tx-quality-block]');
      var sentEl = $('[data-v30-tx-sentiment]');
      if (sentEl) {
        sentEl.textContent = a.sentiment ? ('Sentiment : ' + a.sentiment) : '—';
        sentEl.className = 'v30-tx-pill is-sent-' + (a.sentiment || 'neutre');
      }
      var qEl = $('[data-v30-tx-quality]');
      if (qEl) qEl.textContent = a.quality_score != null ? ('Qualité : ' + a.quality_score + '/100') : '';
    }
    if (a.key_quotes && a.key_quotes.length) {
      show('[data-v30-tx-quotes-block]');
      setList('[data-v30-tx-quotes]', a.key_quotes, function (q) { return '<li>« ' + esc(q) + ' »</li>'; });
    }
  }

  // ─── Polling ────────────────────────────────────────────────────────
  function load() {
    return fetch('/api/transcription/' + TID, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'erreur');
        render(j.item);
        var s = j.item && j.item.status;
        if (s === 'pending' || s === 'processing') {
          schedulePoll();
        } else if (pollTimer) {
          clearTimeout(pollTimer); pollTimer = null;
        }
      })
      .catch(function (e) {
        console.warn('tx detail load:', e);
        if (window.showToast) window.showToast('Erreur : ' + e.message, 'error');
      });
  }
  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(load, POLL_MS);
  }

  // ─── Actions ────────────────────────────────────────────────────────
  function bind() {
    var rfresh = $('[data-v30-tx-refresh]');
    if (rfresh) rfresh.addEventListener('click', load);

    var retry = $('[data-v30-tx-retry]');
    if (retry) retry.addEventListener('click', function () {
      retry.disabled = true;
      fetch('/api/transcription/' + TID + '/retry', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            if (window.showToast) window.showToast('Transcription relancée', 'success');
            load();
          } else {
            if (window.showToast) window.showToast('Erreur : ' + ((j && j.error) || 'échec'), 'error');
          }
        })
        .finally(function () { retry.disabled = false; });
    });

    var del = $('[data-v30-tx-delete]');
    if (del) del.addEventListener('click', function () {
      if (!confirm('Supprimer cette transcription ?')) return;
      fetch('/api/transcription/' + TID, { method: 'DELETE', credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            window.location.href = '/v30/transcription';
          } else {
            if (window.showToast) window.showToast('Suppression échouée', 'error');
          }
        });
    });

    var cp = $('[data-v30-tx-copy]');
    if (cp) cp.addEventListener('click', function () {
      var c = $('[data-v30-tx-transcript]');
      if (!c) return;
      var txt = c.innerText || c.textContent || '';
      if (!txt) return;
      navigator.clipboard.writeText(txt).then(function () {
        if (window.showToast) window.showToast('Transcript copié', 'success');
      }, function () {
        if (window.showToast) window.showToast('Copie impossible', 'error');
      });
    });
  }

  function init() { bind(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
