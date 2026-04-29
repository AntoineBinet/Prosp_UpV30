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

    // Erreur / warning : on affiche dès qu'il y a un error_message (statut error
    // OU done avec warning de diarisation). Le bouton « Relancer » est visible
    // pour TOUS les statuts sauf en cours (pending/processing) — c'est ce qui
    // permet de re-lancer l'analyse avec un nouveau prompt après avoir édité
    // la config IA.
    var err = $('[data-v30-tx-error]');
    var errMsg = $('[data-v30-tx-error-msg]');
    var billingLink = $('[data-v30-tx-billing-link]');
    if (item.error_message) {
      err.hidden = false;
      errMsg.textContent = item.error_message;
      // Le bouton « Recharger crédits Claude » apparaît seulement si l'erreur
      // contient des mots-clés liés au crédit / billing Anthropic.
      var lower = String(item.error_message).toLowerCase();
      var isCredit = (lower.indexOf('crédit') !== -1)
                  || (lower.indexOf('credit') !== -1)
                  || (lower.indexOf('billing') !== -1)
                  || (lower.indexOf('insufficient') !== -1);
      if (billingLink) billingLink.hidden = !isCredit;
    } else {
      err.hidden = true;
      if (billingLink) billingLink.hidden = true;
    }
    var rb = $('[data-v30-tx-retry]');
    var rba = $('[data-v30-tx-reanalyze]');
    var rext = $('[data-v30-tx-external]');
    var rxcrm = $('[data-v30-tx-extract-crm]');
    var inProg = (item.status === 'pending' || item.status === 'processing');
    if (rb)  rb.hidden = inProg;
    // « Re-analyser (Claude API) » et « Analyser via IA externe » dispos
    // uniquement si on a déjà un transcript_text (sinon rien à analyser
    // → on doit relancer le pipeline complet via Whisper)
    var hasTx = !!(item.transcript_text && item.transcript_text.trim());
    var hasNarrative = !!(item.analysis && (item.analysis.narrative_markdown || '').trim());
    if (rba)   rba.hidden   = inProg || !hasTx;
    if (rext)  rext.hidden  = inProg || !hasTx;
    // « Ré-extraire CRM » : besoin d'un CR narratif existant (sinon rien à extraire)
    if (rxcrm) rxcrm.hidden = inProg || !hasNarrative;

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

    // Compte-rendu narratif (markdown rendu)
    renderNarrative(item.analysis || null, item.title);

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

  // ─── Renderer markdown léger (sécurisé : on échappe AVANT de remplacer) ────
  // Gère : H1 (#), H2 (##), H3 (###), bold (**…**), italic (*…*),
  // code inline (`…`), listes - / *, listes numérotées 1., paragraphes vides.
  function mdToHtml(md) {
    if (!md) return '';
    // 1. Échappement HTML d'abord (anti-XSS)
    var safe = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    var lines = safe.split(/\r?\n/);
    var out = [];
    var inUl = false, inOl = false, paragraph = [];

    function flushPara() {
      if (paragraph.length) {
        out.push('<p>' + inlineMd(paragraph.join(' ')) + '</p>');
        paragraph = [];
      }
    }
    function closeLists() {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    }
    function inlineMd(s) {
      return s
        .replace(/`([^`]+?)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|\W)\*([^*]+?)\*(\W|$)/g, '$1<em>$2</em>$3');
    }

    lines.forEach(function (raw) {
      var line = raw.trimEnd();
      if (!line.trim()) {
        flushPara();
        closeLists();
        return;
      }
      var h3 = /^###\s+(.+)/.exec(line);
      var h2 = /^##\s+(.+)/.exec(line);
      var h1 = /^#\s+(.+)/.exec(line);
      var ul = /^[-*]\s+(.+)/.exec(line);
      var ol = /^\d+\.\s+(.+)/.exec(line);
      if (h1) { flushPara(); closeLists(); out.push('<h1>' + inlineMd(h1[1]) + '</h1>'); return; }
      if (h2) { flushPara(); closeLists(); out.push('<h2>' + inlineMd(h2[1]) + '</h2>'); return; }
      if (h3) { flushPara(); closeLists(); out.push('<h3>' + inlineMd(h3[1]) + '</h3>'); return; }
      if (ul) {
        flushPara();
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (!inUl) { out.push('<ul>'); inUl = true; }
        out.push('<li>' + inlineMd(ul[1]) + '</li>');
        return;
      }
      if (ol) {
        flushPara();
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (!inOl) { out.push('<ol>'); inOl = true; }
        out.push('<li>' + inlineMd(ol[1]) + '</li>');
        return;
      }
      // Continuation de paragraphe
      closeLists();
      paragraph.push(line);
    });
    flushPara();
    closeLists();
    return out.join('\n');
  }

  function renderNarrative(a, fallbackTitle) {
    var box = $('[data-v30-tx-narrative]');
    var titleEl = $('[data-v30-tx-narrative-title]');
    var bodyEl = $('[data-v30-tx-narrative-body]');
    var badgeEl = $('[data-v30-tx-provider-badge]');
    if (!box || !bodyEl) return;
    var md = a && a.narrative_markdown;
    if (!md || !String(md).trim()) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (titleEl) titleEl.textContent = (a && a.title) || fallbackTitle || 'Compte-rendu';
    // Badge provider : visible si Ollama (qualité moindre) OU externe
    // (collé à la main depuis claude.ai/ChatGPT/Gemini)
    if (badgeEl) {
      var provider = a && a._provider;
      var modelUsed = a && a._model_used;
      if (provider === 'ollama') {
        var reason = (a && a._fallback_reason) || 'Claude indisponible';
        badgeEl.hidden = false;
        badgeEl.className = 'v30-tx-provider-badge is-fallback';
        badgeEl.title = reason;
        badgeEl.textContent = '✦ Ollama (fallback) · ' + reason;
      } else if (provider === 'external') {
        badgeEl.hidden = false;
        badgeEl.className = 'v30-tx-provider-badge is-external';
        badgeEl.title = 'Analyse collée manuellement depuis ' + (modelUsed || 'IA externe');
        badgeEl.textContent = '✦ Collé · ' + (modelUsed || 'IA externe');
      } else {
        badgeEl.hidden = true;
      }
    }
    bodyEl.innerHTML = mdToHtml(String(md));
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

    function genericClickHandler(btn, url, successMsg) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.showToast) window.showToast('Lancement…', 'success');
        btn.disabled = true;
        var origHTML = btn.innerHTML;
        btn.textContent = 'En cours…';
        fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
        })
          .then(function (r) {
            return r.json().then(function (j) { return { status: r.status, body: j }; });
          })
          .then(function (res) {
            var j = res.body || {};
            if (res.status >= 200 && res.status < 300 && j.ok) {
              if (window.showToast) window.showToast(successMsg, 'success');
              setTimeout(load, 600);
            } else {
              var msg = (j && j.error) || ('HTTP ' + res.status);
              if (window.showToast) window.showToast('Échec : ' + msg, 'error');
              else alert('Échec : ' + msg);
            }
          })
          .catch(function (err) {
            console.error('[transcription_detail] click error:', err);
            if (window.showToast) window.showToast('Erreur réseau : ' + (err && err.message), 'error');
            else alert('Erreur réseau : ' + (err && err.message));
          })
          .finally(function () {
            btn.disabled = false;
            btn.innerHTML = origHTML;
          });
      });
    }

    var retry = $('[data-v30-tx-retry]');
    console.log('[transcription_detail] retry button bound:', !!retry);
    if (retry) {
      genericClickHandler(retry, '/api/transcription/' + TID + '/retry',
                          'Pipeline relancé — actualisation…');
    }
    var reanalyze = $('[data-v30-tx-reanalyze]');
    console.log('[transcription_detail] reanalyze button bound:', !!reanalyze);
    if (reanalyze) {
      genericClickHandler(reanalyze, '/api/transcription/' + TID + '/reanalyze',
                          'Re-analyse Claude lancée — actualisation…');
    }
    var extractCrm = $('[data-v30-tx-extract-crm]');
    if (extractCrm) {
      extractCrm.addEventListener('click', function (e) {
        e.preventDefault();
        if (_crmEdited) {
          if (!confirm('Tu as des modifications CRM non enregistrées. Ré-extraire écrasera les champs CRM avec ce que l\'IA renverra. Continuer ?')) return;
        }
        extractCrm.disabled = true;
        var orig = extractCrm.innerHTML;
        extractCrm.textContent = 'Extraction…';
        if (window.showToast) window.showToast('Ré-extraction CRM en cours (Ollama, ~30 s)…', 'info');
        fetch('/api/transcription/' + TID + '/extract-crm', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
        })
          .then(function (r) { return r.json().then(function (j) { return { st: r.status, body: j }; }); })
          .then(function (res) {
            if (res.st >= 200 && res.st < 300 && res.body.ok) {
              if (window.showToast) window.showToast('Champs CRM ré-extraits', 'success');
              _crmHydrated = false;
              _crmEdited = false;
              setTimeout(load, 300);
            } else {
              if (window.showToast) window.showToast('Échec : ' + (res.body.error || 'erreur'), 'error');
            }
          })
          .catch(function (err) {
            if (window.showToast) window.showToast('Erreur réseau : ' + err.message, 'error');
          })
          .finally(function () {
            extractCrm.disabled = false;
            extractCrm.innerHTML = orig;
          });
      });
    }
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

    // ─── Bouton « Analyser via IA externe » + modal copy-paste ─────────
    var extBtn = $('[data-v30-tx-external]');
    if (extBtn) extBtn.addEventListener('click', openExternalModal);

    Array.prototype.forEach.call(document.querySelectorAll('[data-v30-tx-ext-close]'), function (b) {
      b.addEventListener('click', closeExternalModal);
    });
    var extModal = $('[data-v30-tx-external-modal]');
    if (extModal) {
      extModal.addEventListener('click', function (e) {
        if (e.target === extModal) closeExternalModal();
      });
    }

    var copyBtn = $('[data-v30-tx-ext-copy]');
    if (copyBtn) copyBtn.addEventListener('click', copyExternalPrompt);

    var applyBtn = $('[data-v30-tx-ext-apply]');
    if (applyBtn) applyBtn.addEventListener('click', applyExternalAnalysis);

    var cpN = $('[data-v30-tx-copy-narrative]');
    if (cpN) cpN.addEventListener('click', function () {
      // On copie le markdown brut depuis l'analyse en mémoire (pas l'HTML rendu)
      fetch('/api/transcription/' + TID, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var md = j && j.item && j.item.analysis && j.item.analysis.narrative_markdown;
          if (!md) {
            if (window.showToast) window.showToast('Pas de CR à copier', 'warn');
            return;
          }
          navigator.clipboard.writeText(md).then(function () {
            if (window.showToast) window.showToast('CR markdown copié', 'success');
          });
        });
    });
  }

  // ─── Workflow « IA externe (copy-paste) » ──────────────────────────
  function openExternalModal() {
    var m = $('[data-v30-tx-external-modal]');
    if (!m) return;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('is-open');
    var ta = $('[data-v30-tx-ext-response]');
    if (ta) ta.value = '';
    var info = $('[data-v30-tx-ext-copy-info]');
    if (info) info.textContent = '';
  }
  function closeExternalModal() {
    var m = $('[data-v30-tx-external-modal]');
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { m.hidden = true; }, 180);
  }

  function copyExternalPrompt() {
    var btn = $('[data-v30-tx-ext-copy]');
    var info = $('[data-v30-tx-ext-copy-info]');
    if (btn) { btn.disabled = true; btn.textContent = 'Récupération…'; }
    fetch('/api/transcription/' + TID + '/external-prompt', {
      credentials: 'same-origin', cache: 'no-store',
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || 'erreur');
        return navigator.clipboard.writeText(j.prompt).then(function () { return j; });
      })
      .then(function (j) {
        if (info) info.textContent = '✓ ' + (j.transcript_length || 0) + ' caractères copiés (~' + (j.approx_tokens || 0) + ' tokens)';
        if (window.showToast) window.showToast('Prompt + transcript copiés. Va sur claude.ai et colle.', 'success');
      })
      .catch(function (e) {
        if (info) info.textContent = '✗ ' + e.message;
        if (window.showToast) window.showToast('Copie échouée : ' + e.message, 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5 12.6 21a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.6 19a2 2 0 0 1-2.8-2.8l8-8"/></svg> Copier dans le presse-papier';
        }
      });
  }

  function applyExternalAnalysis() {
    var ta = $('[data-v30-tx-ext-response]');
    var srcEl = $('[data-v30-tx-ext-source]');
    var btn = $('[data-v30-tx-ext-apply]');
    if (!ta) return;
    var text = (ta.value || '').trim();
    if (!text) {
      if (window.showToast) window.showToast('Colle d\'abord la réponse de l\'IA dans le textarea', 'warn');
      return;
    }
    if (text.length < 50) {
      if (window.showToast) window.showToast('Réponse trop courte — colle bien le JSON complet', 'warn');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Application…'; }
    fetch('/api/transcription/' + TID + '/external-analysis', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_text: text,
        source: (srcEl && srcEl.value) || 'external',
      }),
    })
      .then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j }; });
      })
      .then(function (res) {
        var j = res.body || {};
        if (res.status >= 200 && res.status < 300 && j.ok) {
          if (window.showToast) window.showToast('Analyse appliquée — actualisation', 'success');
          closeExternalModal();
          setTimeout(load, 400);
        } else {
          var msg = (j && j.error) || ('HTTP ' + res.status);
          if (window.showToast) window.showToast('Échec : ' + msg, 'error');
          else alert('Échec : ' + msg);
        }
      })
      .catch(function (err) {
        if (window.showToast) window.showToast('Erreur réseau : ' + err.message, 'error');
      })
      .finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Appliquer l'analyse"; }
      });
  }

  // ─── Section CRM structurée (v32.11) ───────────────────────────────
  // L'utilisateur peut éditer les infos extraites avant de pousser vers
  // une fiche candidat ou prospect. On hydrate UNE FOIS au premier render
  // pour ne pas écraser les saisies en cours pendant le polling.
  var _crmHydrated = false;
  var _crmEdited = false;

  function _setSavedState(cls, txt) {
    var s = $('[data-v30-tx-crm-saved]');
    if (!s) return;
    s.className = 'v30-tx-saved-state muted ' + (cls || '');
    s.textContent = txt || '';
  }

  function _setVal(sel, val) {
    var el = $(sel);
    if (!el) return;
    if (val === null || val === undefined) val = '';
    if (el.tagName === 'SELECT') {
      el.value = String(val);
    } else if (typeof val === 'boolean') {
      el.value = val ? 'true' : 'false';
    } else {
      el.value = String(val);
    }
  }

  function renderCRM(item) {
    var box = $('[data-v30-tx-crm]');
    if (!box) return;
    var a = (item && item.analysis) || null;
    var hasTx = !!(item && item.transcript_text && item.transcript_text.trim());
    if (!a || !hasTx) { box.hidden = true; return; }
    box.hidden = false;

    if (_crmHydrated && _crmEdited) {
      // L'utilisateur a déjà commencé à éditer — on ne touche plus aux
      // valeurs des inputs pour ne pas perdre sa saisie. Le polling
      // continuera de mettre à jour le reste de l'UI.
      return;
    }

    var type = a.meeting_type || 'autre';
    var pill = $('[data-v30-tx-crm-type]');
    if (pill) pill.textContent = type.replace(/_/g, ' ');

    // v32.13 — Badge cohérence + bandeau warnings (item.consistency injecté
    // par le backend via audit_crm_consistency). Aide l'utilisateur à
    // repérer instantanément les divergences entre le transcript et les
    // champs extraits par l'IA.
    var consPill = $('[data-v30-tx-crm-consistency]');
    var auditBox = $('[data-v30-tx-crm-audit]');
    var auditList = $('[data-v30-tx-crm-audit-list]');
    var cons = item && item.consistency;
    if (consPill && cons) {
      if (cons.ok) {
        consPill.hidden = false;
        consPill.className = 'v30-tx-pill is-cons-ok';
        consPill.textContent = '✓ cohérent';
        if (auditBox) auditBox.hidden = true;
      } else {
        consPill.hidden = false;
        consPill.className = 'v30-tx-pill is-cons-warn';
        consPill.textContent = '⚠ ' + (cons.warnings || []).length + ' point(s) à vérifier';
        if (auditBox && auditList) {
          auditBox.hidden = false;
          auditList.innerHTML = (cons.warnings || []).map(function (w) {
            return '<li>' + esc(w) + '</li>';
          }).join('');
        }
      }
    } else if (consPill) {
      consPill.hidden = true;
      if (auditBox) auditBox.hidden = true;
    }

    // Volets candidat/prospect : visible selon meeting_type, mais on
    // affiche aussi le volet « rempli » si l'IA a mis des infos même si
    // le type n'est pas le bon.
    var candPanel = $('[data-v30-tx-crm-candidate]');
    var prosPanel = $('[data-v30-tx-crm-prospect]');
    var ci = a.candidate_info || null;
    var pi = a.prospect_info  || null;
    var showCand = type === 'entretien_candidat' || (ci && Object.keys(ci).length);
    var showProsp = type === 'rdv_commercial' || (pi && Object.keys(pi).length);
    if (candPanel) candPanel.hidden = !showCand;
    if (prosPanel) prosPanel.hidden = !showProsp;

    // Hydrate candidat
    if (ci && showCand) {
      ['prenom','nom','titre','annees_experience','domaine_principal',
       'mobilite','disponibilite','remuneration_actuelle',
       'pretentions_salariales','fonctions_recherchees',
       'motif_recherche','email','telephone','linkedin'].forEach(function(k) {
        _setVal('[data-crm-candidate="'+k+'"]', ci[k]);
      });
      // Compétences (array) → CSV
      var comp = ci.competences_cles;
      _setVal('[data-crm-candidate="competences_cles"]',
        Array.isArray(comp) ? comp.join(', ') : (comp || ''));
      // Langues (array of objects) → string lisible
      var langs = ci.langues;
      var langStr = '';
      if (Array.isArray(langs)) {
        langStr = langs.map(function(l) {
          if (typeof l === 'string') return l;
          return (l.langue || '?') + (l.niveau ? '/'+l.niveau : '');
        }).join(', ');
      } else if (typeof langs === 'string') {
        langStr = langs;
      }
      _setVal('[data-crm-candidate="langues"]', langStr);
      // Bool : permis / véhicule
      ['permis_conduire','vehicule'].forEach(function(k) {
        var v = ci[k];
        var s = (v === true) ? 'true' : (v === false ? 'false' : '');
        _setVal('[data-crm-candidate="'+k+'"]', s);
      });
      // Évaluations
      ['eval_technique','eval_personnalite','eval_communication'].forEach(function(k) {
        var e = ci[k] || {};
        _setVal('[data-crm-eval="'+k+'.note"]', e.note);
        _setVal('[data-crm-eval="'+k+'.commentaire"]', e.commentaire);
      });
      // Missions
      _renderMissions(a.opportunites_missions || []);
    }

    // Hydrate prospect
    if (pi && showProsp) {
      ['entreprise','contact_prenom','contact_nom','contact_fonction',
       'email','telephone','linkedin','besoin','urgence','budget',
       'city','country'].forEach(function(k) {
        _setVal('[data-crm-prospect="'+k+'"]', pi[k]);
      });
      _setVal('[data-crm-prospect="stack"]',
        Array.isArray(pi.stack) ? pi.stack.join(', ') : (pi.stack || ''));
      _setVal('[data-crm-prospect="pain_points"]',
        Array.isArray(pi.pain_points) ? pi.pain_points.join(', ') : (pi.pain_points || ''));
    }

    // Suivi
    var s = a.suivi || {};
    _setVal('[data-crm-suivi="proposed_followup_date"]', s.proposed_followup_date);
    _setVal('[data-crm-suivi="followup_channel"]', s.followup_channel);
    _renderActions('up', s.up_tech || []);
    _renderActions('other', s.autre_partie || []);

    // Boutons « Créer / Mettre à jour fiche » : visibles selon données dispo,
    // libellé adaptatif selon idempotence
    var btnC = $('[data-v30-tx-crm-create-candidate]');
    var btnP = $('[data-v30-tx-crm-create-prospect]');
    _existingFicheIds.candidate = a._candidate_id || null;
    _existingFicheIds.prospect = a._prospect_id || null;
    if (btnC) {
      btnC.hidden = !(showCand && ci && (ci.nom || ci.prenom));
      btnC.textContent = a._candidate_id
        ? '↺ Mettre à jour fiche #' + a._candidate_id
        : '＋ Créer fiche candidat';
    }
    if (btnP) {
      btnP.hidden = !(showProsp && pi && (pi.entreprise || pi.contact_nom));
      btnP.textContent = a._prospect_id
        ? '↺ Mettre à jour fiche #' + a._prospect_id
        : '＋ Créer fiche prospect';
    }

    // Lien vers fiche déjà créée (idempotence)
    var hint = $('[data-v30-tx-crm-link]');
    if (hint) {
      var parts = [];
      if (a._candidate_id) parts.push('<a href="/v30/candidat/'+a._candidate_id+'">Fiche candidat #'+a._candidate_id+' déjà créée</a>');
      if (a._prospect_id)  parts.push('<a href="/v30/prospects?focus='+a._prospect_id+'">Fiche prospect #'+a._prospect_id+' déjà créée</a>');
      hint.innerHTML = parts.join(' · ');
    }
    if (a._user_edited_at) {
      _setSavedState('is-saved', '✓ Édité ' + a._user_edited_at);
    }
    _crmHydrated = true;
  }

  function _renderMissions(missions) {
    var ul = $('[data-v30-tx-crm-missions]');
    if (!ul) return;
    ul.innerHTML = '';
    missions.forEach(function(m, i) { ul.appendChild(_buildMissionRow(m, i)); });
  }
  function _buildMissionRow(m, i) {
    m = m || {};
    var li = document.createElement('li');
    li.className = 'v30-tx-crm__row';
    li.innerHTML =
      '<input type="text" data-mission-field="nom" placeholder="Nom de la mission" value="'+esc(m.nom || '')+'">'
    + '<input type="text" data-mission-field="client" placeholder="Client" value="'+esc(m.client || '')+'">'
    + '<select data-mission-field="statut">'
    +   ['à_creuser','discutée','proposée','refusée'].map(function(s) {
          return '<option value="'+s+'"'+(m.statut===s?' selected':'')+'>'+s.replace('_',' ')+'</option>';
        }).join('')
    + '</select>'
    + '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-mission-del title="Supprimer">×</button>';
    li.querySelector('[data-mission-del]').addEventListener('click', function() { li.remove(); _markEdited(); });
    li.querySelectorAll('input,select').forEach(function(el) {
      el.addEventListener('input', _markEdited);
    });
    return li;
  }

  function _renderActions(side, list) {
    var ul = $('[data-v30-tx-crm-'+side+'-list]');
    if (!ul) return;
    ul.innerHTML = '';
    list.forEach(function(a) { ul.appendChild(_buildActionRow(side, a)); });
  }
  function _buildActionRow(side, a) {
    a = a || {};
    var li = document.createElement('li');
    li.className = 'v30-tx-crm__row';
    li.innerHTML =
      '<input type="text" data-action-field="action" placeholder="Action" value="'+esc(a.action || '')+'">'
    + '<input type="text" data-action-field="deadline" placeholder="Échéance" value="'+esc(a.deadline || '')+'">'
    + '<input type="text" data-action-field="owner" placeholder="Responsable" value="'+esc(a.owner || '')+'">'
    + '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-action-del title="Supprimer">×</button>';
    li.querySelector('[data-action-del]').addEventListener('click', function() { li.remove(); _markEdited(); });
    li.querySelectorAll('input').forEach(function(el) {
      el.addEventListener('input', _markEdited);
    });
    return li;
  }

  function _markEdited() {
    _crmEdited = true;
    _setSavedState('is-saving', '● Modifications non enregistrées');
    _enableBeforeunloadGuard();
  }

  // ─── Beforeunload guard (v32.12) ───────────────────────────────────
  function _beforeunloadHandler(e) {
    // Le navigateur affichera son propre message générique — la valeur
    // de retour ne sert qu'à déclencher le prompt.
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
  function _enableBeforeunloadGuard() {
    window.addEventListener('beforeunload', _beforeunloadHandler);
  }
  function _disableBeforeunloadGuard() {
    window.removeEventListener('beforeunload', _beforeunloadHandler);
  }

  function _readBool(sel) {
    var el = $(sel); if (!el || !el.value) return null;
    return el.value === 'true';
  }
  function _readEval(prefix) {
    var note = $('[data-crm-eval="'+prefix+'.note"]')?.value || '';
    var com  = $('[data-crm-eval="'+prefix+'.commentaire"]')?.value || '';
    note = note.trim(); com = com.trim();
    if (!note && !com) return null;
    return { note: note ? Number(note) : null, commentaire: com || null };
  }
  function _csvToArr(s) {
    return (s || '').split(',').map(function(x){return x.trim();}).filter(Boolean);
  }
  function _readLangues(s) {
    return _csvToArr(s).map(function(x) {
      var m = /^(.+?)\s*[\/(]\s*(.+?)\s*\)?$/.exec(x);
      if (m) return { langue: m[1].trim(), niveau: m[2].trim() };
      return { langue: x, niveau: null };
    });
  }

  function collectCRM() {
    var type = $('[data-v30-tx-crm-type]')?.textContent?.trim().replace(/\s/g,'_') || null;
    var ci = null, pi = null;
    var candPanel = $('[data-v30-tx-crm-candidate]');
    if (candPanel && !candPanel.hidden) {
      ci = {};
      ['prenom','nom','titre','annees_experience','domaine_principal',
       'mobilite','disponibilite','remuneration_actuelle',
       'pretentions_salariales','fonctions_recherchees',
       'motif_recherche','email','telephone','linkedin'].forEach(function(k) {
        var v = $('[data-crm-candidate="'+k+'"]')?.value;
        ci[k] = v && v.trim() ? (k === 'annees_experience' ? Number(v) : v.trim()) : null;
      });
      ci.competences_cles = _csvToArr($('[data-crm-candidate="competences_cles"]')?.value);
      ci.langues = _readLangues($('[data-crm-candidate="langues"]')?.value);
      ci.permis_conduire = _readBool('[data-crm-candidate="permis_conduire"]');
      ci.vehicule = _readBool('[data-crm-candidate="vehicule"]');
      ci.eval_technique = _readEval('eval_technique');
      ci.eval_personnalite = _readEval('eval_personnalite');
      ci.eval_communication = _readEval('eval_communication');
    }
    var prosPanel = $('[data-v30-tx-crm-prospect]');
    if (prosPanel && !prosPanel.hidden) {
      pi = {};
      ['entreprise','contact_prenom','contact_nom','contact_fonction',
       'email','telephone','linkedin','besoin','urgence','budget',
       'city','country'].forEach(function(k) {
        var v = $('[data-crm-prospect="'+k+'"]')?.value;
        pi[k] = v && v.trim() ? v.trim() : null;
      });
      pi.stack = _csvToArr($('[data-crm-prospect="stack"]')?.value);
      pi.pain_points = _csvToArr($('[data-crm-prospect="pain_points"]')?.value);
    }
    // Missions
    var missions = $$('[data-v30-tx-crm-missions] li').map(function(li) {
      return {
        nom: li.querySelector('[data-mission-field="nom"]')?.value || null,
        client: li.querySelector('[data-mission-field="client"]')?.value || null,
        statut: li.querySelector('[data-mission-field="statut"]')?.value || null,
      };
    }).filter(function(m){ return m.nom || m.client; });
    // Suivi
    function readActions(side) {
      return $$('[data-v30-tx-crm-'+side+'-list] li').map(function(li) {
        return {
          action: li.querySelector('[data-action-field="action"]')?.value || null,
          deadline: li.querySelector('[data-action-field="deadline"]')?.value || null,
          owner: li.querySelector('[data-action-field="owner"]')?.value || null,
        };
      }).filter(function(a){ return a.action; });
    }
    var suivi = {
      up_tech: readActions('up'),
      autre_partie: readActions('other'),
      proposed_followup_date: $('[data-crm-suivi="proposed_followup_date"]')?.value?.trim() || null,
      followup_channel: $('[data-crm-suivi="followup_channel"]')?.value || null,
    };
    return {
      meeting_type: type,
      candidate_info: ci,
      prospect_info: pi,
      opportunites_missions: missions,
      suivi: suivi,
    };
  }

  function saveCRM() {
    var payload = collectCRM();
    _setSavedState('is-saving', 'Enregistrement…');
    return fetch('/api/transcription/' + TID + '/structured-fields', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    })
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (j && j.ok) {
          _setSavedState('is-saved', '✓ Enregistré');
          _crmEdited = false;
          _disableBeforeunloadGuard();
          if (window.showToast) window.showToast('Champs CRM enregistrés', 'success');
        } else {
          _setSavedState('is-error', '✗ ' + ((j && j.error) || 'erreur'));
        }
      })
      .catch(function(e) {
        _setSavedState('is-error', '✗ ' + e.message);
      });
  }

  // _existingFicheIds : refresh à chaque renderCRM, utilisé pour la confirm dialog
  var _existingFicheIds = { candidate: null, prospect: null };

  function createFiche(kind) {
    var url = '/api/transcription/' + TID + '/create-' + kind;
    var existingId = _existingFicheIds[kind] || null;
    var forceNew = false;

    if (existingId) {
      var msg = kind === 'candidate'
        ? 'Une fiche candidat #' + existingId + ' a déjà été créée depuis cette transcription.\n\n'
          + 'OK = Mettre à jour la fiche existante avec les champs édités\n'
          + 'Annuler = Créer un doublon (nouvelle fiche)'
        : 'Une fiche prospect #' + existingId + ' a déjà été créée depuis cette transcription.\n\n'
          + 'OK = Mettre à jour la fiche existante avec les champs édités\n'
          + 'Annuler = Créer un doublon (nouvelle fiche)';
      var update = confirm(msg);
      if (!update) {
        // Création doublon — confirm une 2ᵉ fois pour éviter les fausses manips
        if (!confirm('Confirmer la création d\'un doublon (nouvelle fiche, l\'ancienne reste) ?')) {
          return;
        }
        forceNew = true;
      }
    }

    var label = kind === 'candidate' ? 'Création fiche candidat…' : 'Création fiche prospect…';
    if (existingId && !forceNew) {
      label = kind === 'candidate' ? 'Mise à jour fiche candidat…' : 'Mise à jour fiche prospect…';
    }
    if (window.showToast) window.showToast(label, 'info');

    saveCRM().then(function() {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ force_new: forceNew }),
      });
    })
      .then(function(r) { return r.json().then(function(j) { return {st: r.status, body: j}; }); })
      .then(function(res) {
        if (res.st >= 200 && res.st < 300 && res.body.ok) {
          var verb = res.body.action === 'updated' ? 'mise à jour' : 'créée';
          if (window.showToast) window.showToast('Fiche ' + verb + ' — redirection…', 'success');
          if (res.body.redirect) {
            setTimeout(function() { window.location.href = res.body.redirect; }, 600);
          } else {
            setTimeout(load, 600);
          }
        } else {
          if (window.showToast) window.showToast('Échec : ' + (res.body.error || 'erreur'), 'error');
        }
      });
  }

  function bindCRM() {
    // Marquer comme édité dès qu'un champ change
    $$('[data-v30-tx-crm] input, [data-v30-tx-crm] select, [data-v30-tx-crm] textarea').forEach(function(el) {
      el.addEventListener('input', _markEdited);
      el.addEventListener('change', _markEdited);
    });
    var save = $('[data-v30-tx-crm-save]');
    if (save) save.addEventListener('click', saveCRM);
    var addUp    = $('[data-v30-tx-crm-add-up]');
    var addOther = $('[data-v30-tx-crm-add-other]');
    var addMission = $('[data-v30-tx-crm-add-mission]');
    if (addUp) addUp.addEventListener('click', function() {
      $('[data-v30-tx-crm-up-list]').appendChild(_buildActionRow('up', {})); _markEdited();
    });
    if (addOther) addOther.addEventListener('click', function() {
      $('[data-v30-tx-crm-other-list]').appendChild(_buildActionRow('other', {})); _markEdited();
    });
    if (addMission) addMission.addEventListener('click', function() {
      $('[data-v30-tx-crm-missions]').appendChild(_buildMissionRow({})); _markEdited();
    });
    var bC = $('[data-v30-tx-crm-create-candidate]');
    var bP = $('[data-v30-tx-crm-create-prospect]');
    if (bC) bC.addEventListener('click', function() { createFiche('candidate'); });
    if (bP) bP.addEventListener('click', function() { createFiche('prospect'); });
    // v32.13 — Reset : vide les champs CRM (utile après erreur IA / artefact)
    var bR = $('[data-v30-tx-crm-reset]');
    if (bR) bR.addEventListener('click', function() {
      if (!confirm('Vider tous les champs CRM ? Le compte-rendu narratif et le transcript ne sont PAS touchés. Tu pourras ensuite cliquer « ✦ Ré-extraire CRM » ou tout saisir à la main.')) return;
      var emptyPayload = {
        meeting_type: null,
        candidate_info: null,
        prospect_info: null,
        opportunites_missions: [],
        suivi: { up_tech: [], autre_partie: [], proposed_followup_date: null, followup_channel: null }
      };
      _setSavedState('is-saving', 'Réinitialisation…');
      fetch('/api/transcription/' + TID + '/structured-fields', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(emptyPayload),
      })
        .then(function(r) { return r.json(); })
        .then(function(j) {
          if (j && j.ok) {
            _setSavedState('is-saved', '✓ Champs vidés');
            _crmEdited = false;
            _crmHydrated = false;
            _disableBeforeunloadGuard();
            if (window.showToast) window.showToast('Champs CRM réinitialisés', 'success');
            setTimeout(load, 300);
          } else {
            _setSavedState('is-error', '✗ ' + ((j && j.error) || 'erreur'));
          }
        });
    });
  }

  // Hook : appeler renderCRM depuis le render existant
  var _origRender = render;
  render = function(item) {
    _origRender(item);
    renderCRM(item);
  };

  function init() { bind(); bindCRM(); load(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
