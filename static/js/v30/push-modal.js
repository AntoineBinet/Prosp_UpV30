/* ProspUp v30 — Popup « Pousser » depuis une fiche prospect ou une ligne de la table.
 *
 * Porte la logique v29 (app.js:openPushSelectModal/confirmPushSend) sous un
 * habillage v30 (.v30-modal-bd / .v30-field / .v30-input). Exposé sur
 * window.V30PushModal.open(prospectId, channel='email'|'linkedin').
 *
 * Aucun changement backend : utilise /api/push-categories,
 * /api/prospect/<id>/best-candidates, /api/users/for-push, /api/push-logs/add,
 * /api/pushs/open, /api/settings, /api/candidates/<id>/dossier-competence,
 * /api/ollama/generate-stream.
 */
(function () {
  'use strict';

  var MODAL_ID = 'v30PushModal';

  var STATE = {
    prospectId: null,
    channel: 'email',
    prospect: null,
    company: null,
    candidates: [],       // liste des best-candidates chargés
    users: [],            // liste des consultants
    currentUserId: null
  };

  // ─── Helpers ──────────────────────────────────────────────
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : String(s));
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function safeStr(v) {
    return (v === null || v === undefined) ? '' : String(v);
  }
  function ic(name, size) {
    if (typeof window.icon === 'function') return window.icon(name, { size: size || 13 });
    return '';
  }
  function toast(msg, type, duration) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info', duration);
  }
  function todayISO() {
    if (typeof window.todayISO === 'function') return window.todayISO();
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(txt).catch(function () { return fallbackCopy(txt); });
    }
    return fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    return new Promise(function (resolve) {
      var ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      resolve();
    });
  }

  // ─── Ensure modale DOM ────────────────────────────────────
  function ensureModal() {
    var bd = document.getElementById(MODAL_ID);
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = MODAL_ID;
    bd.className = 'v30-modal-bd';
    bd.setAttribute('hidden', '');
    bd.innerHTML =
      '<div class="v30-modal v30-modal--xl" role="dialog" aria-modal="true" aria-labelledby="v30PushModalTitle">' +
        '<div class="v30-modal__head">' +
          '<div class="v30pm-head">' +
            '<span class="v30pm-head__eyebrow">Nouveau push</span>' +
            '<h2 class="v30pm-head__title" id="v30PushModalTitle">' +
              ic('send', 15) + '<span data-v30pm-title>Push Email</span>' +
            '</h2>' +
          '</div>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30pm-close aria-label="Fermer">' + ic('x', 13) + '</button>' +
        '</div>' +
        '<div class="v30-modal__body" data-v30pm-body>' +

          // ─ Destinataire
          '<section class="v30pm-section">' +
            '<div class="v30pm-section__label">' + ic('userSingle', 11) + ' Destinataire</div>' +
            '<div data-v30pm-prospect></div>' +
          '</section>' +

          // ─ Contexte : catégorie + candidats (sur UNE ligne)
          '<section class="v30pm-section">' +
            '<div class="v30pm-section__label">' + ic('clipboard', 11) + ' Contexte</div>' +
            '<label class="v30-field">' +
              '<span class="v30-field__label">Catégorie push</span>' +
              '<select class="v30-input" data-v30pm-cat aria-label="Catégorie push"></select>' +
            '</label>' +

            // Barre IA (progression scoring candidats)
            '<div class="v30pm-ia-bar" data-v30pm-iabar>' +
              '<span class="v30pm-ai-progress__pulse"></span>' +
              '<span class="v30pm-ia-bar__msg" data-v30pm-iabar-msg>L\'IA réfléchit aux meilleurs candidats…</span>' +
              '<span class="v30pm-ia-bar__stats" data-v30pm-iabar-stats></span>' +
            '</div>' +

            '<div class="v30-field">' +
              '<span class="v30-field__label">Candidats à proposer</span>' +
              '<div class="v30pm-grid">' +
                // Combobox custom 1
                '<div class="v30pm-combo" data-v30pm-combo="1">' +
                  '<button type="button" class="v30pm-combo__btn" data-v30pm-combo-btn="1" aria-haspopup="listbox" aria-expanded="false">' +
                    '<span class="v30pm-combo__label" data-v30pm-combo-label="1">— Choisir un candidat —</span>' +
                    '<span class="v30pm-combo__chev" aria-hidden="true">' + ic('chevronD', 12) + '</span>' +
                  '</button>' +
                  '<div class="v30pm-combo__panel" data-v30pm-combo-panel="1" role="listbox"></div>' +
                '</div>' +
                // Combobox custom 2
                '<div class="v30pm-combo" data-v30pm-combo="2">' +
                  '<button type="button" class="v30pm-combo__btn" data-v30pm-combo-btn="2" aria-haspopup="listbox" aria-expanded="false">' +
                    '<span class="v30pm-combo__label" data-v30pm-combo-label="2">— Choisir un candidat —</span>' +
                    '<span class="v30pm-combo__chev" aria-hidden="true">' + ic('chevronD', 12) + '</span>' +
                  '</button>' +
                  '<div class="v30pm-combo__panel" data-v30pm-combo-panel="2" role="listbox"></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</section>' +

          // ─ Message
          '<section class="v30pm-section">' +
            '<div class="v30pm-section__label">' + ic('note', 11) + ' Message <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-3);">· optionnel</span></div>' +
            '<div class="v30pm-msg-actions">' +
              '<button type="button" class="v30pm-ai-btn" data-v30pm-ai="1" aria-label="Générer avec l\'IA">' + ic('robot', 12) + ' Générer avec l\'IA</button>' +
              '<button type="button" class="v30pm-ai-btn" data-v30pm-ai="3" aria-label="Générer 3 variantes">' + ic('refreshCw', 12) + ' 3 variantes</button>' +
            '</div>' +
            '<div class="v30pm-ai-progress" data-v30pm-progress>' +
              '<span class="v30pm-ai-progress__pulse"></span>' +
              '<span class="v30pm-ai-progress__msg" data-v30pm-progress-msg>Préparation de l\'IA…</span>' +
              '<span class="v30pm-ai-progress__stats" data-v30pm-progress-stats></span>' +
            '</div>' +
            '<textarea class="v30-input" data-v30pm-message placeholder="Cliquez « Générer avec l\'IA » ou rédigez votre message ici…"></textarea>' +
          '</section>' +
        '</div>' +
        '<div class="v30-modal__foot">' +
          '<div class="v30-spacer"></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30pm-close>Annuler</button>' +
          '<button type="button" class="btn btn-accent" data-v30pm-send>' + ic('send', 13) + ' Envoyer</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    bindModalEvents(bd);
    return bd;
  }

  function openBd(bd)  { bd.hidden = false; void bd.offsetWidth; bd.classList.add('is-open'); }
  function closeBd(bd) { bd.classList.remove('is-open'); setTimeout(function () { bd.hidden = true; }, 160); }

  function bindModalEvents(bd) {
    bd.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30pm-close]')) { close(); return; }
      if (e.target === bd) { close(); return; }
      var aiBtn = e.target.closest('[data-v30pm-ai]');
      if (aiBtn) {
        var n = parseInt(aiBtn.dataset.v30pmAi, 10) || 1;
        generateAI(n);
        return;
      }
      if (e.target.closest('[data-v30pm-send]')) { send(); return; }
      // Combobox : toggle panel
      var cbBtn = e.target.closest('[data-v30pm-combo-btn]');
      if (cbBtn) {
        e.stopPropagation();
        var slot = cbBtn.dataset.v30pmComboBtn;
        var wrap = document.querySelector('[data-v30pm-combo="' + slot + '"]');
        if (wrap && wrap.classList.contains('is-open')) closeCombos();
        else openCombo(slot);
        return;
      }
      // Combobox : option
      var opt = e.target.closest('[data-v30pm-opt-id]');
      if (opt) {
        var s = opt.dataset.v30pmOptSlot;
        selectCandidate(s, opt.dataset.v30pmOptId);
        return;
      }
      // Clic hors combobox -> ferme
      if (!e.target.closest('[data-v30pm-combo]')) closeCombos();
    });
    bd.addEventListener('change', function (e) {
      if (e.target.closest('[data-v30pm-cat]')) {
        // Nouvelle passe IA pour la catégorie choisie
        var cat = $sel('data-v30pm-cat');
        loadAISuggestions(cat && cat.value ? cat.value : null);
      }
    });
    // Escape ferme d'abord un combobox ouvert, sinon la modale
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!bd.classList.contains('is-open')) return;
      var anyOpen = bd.querySelector('[data-v30pm-combo].is-open');
      if (anyOpen) { closeCombos(); return; }
      close();
    });
    // Clic document hors modale -> ferme le combobox ouvert
    document.addEventListener('click', function (e) {
      if (!bd.classList.contains('is-open')) return;
      if (!e.target.closest('[data-v30pm-combo]')) closeCombos();
    });
  }

  function close() {
    var bd = document.getElementById(MODAL_ID);
    if (bd) closeBd(bd);
    STATE.prospectId = null;
    STATE.channel = 'email';
    STATE.prospect = null;
    STATE.company = null;
    STATE.candidates = [];
    STATE.users = [];
  }

  // ─── Fetch helpers ────────────────────────────────────────
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, data: j, status: r.status }; }); });
  }

  function getProspectInfo(prospectId) {
    // L'endpoint est /api/prospect/timeline?id=X (query param, pas URL path).
    // Il renvoie {ok, prospect: {...+company_groupe, company_site joined}, events}.
    return fetchJSON('/api/prospect/timeline?id=' + encodeURIComponent(prospectId)).then(function (res) {
      var p = (res && res.prospect) || null;
      if (!p) throw new Error('Prospect introuvable');
      // Synthèse d'un objet company à partir des champs aplatis pour compat
      // avec le reste du module (buildAIPrompt, renderProspectInfo, send()).
      var company = null;
      if (p.company_id || p.company_groupe || p.company_site) {
        company = {
          id: p.company_id || null,
          groupe: p.company_groupe || '',
          site: p.company_site || ''
        };
      }
      return { prospect: p, company: company };
    });
  }

  // ─── Populate selects ─────────────────────────────────────
  function $sel(attr) { return document.querySelector('#' + MODAL_ID + ' [' + attr + ']'); }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function renderProspectSkeleton() {
    var el = $sel('data-v30pm-prospect');
    if (!el) return;
    el.innerHTML =
      '<div class="v30pm-recipient v30pm-recipient--skeleton">' +
        '<span class="v30pm-recipient__avatar">·</span>' +
        '<div class="v30pm-recipient__body">' +
          '<span class="v30pm-skel v30pm-skel--text" style="width:55%;display:block;"></span>' +
          '<span class="v30pm-skel v30pm-skel--sm" style="width:75%;display:block;margin-top:6px;"></span>' +
        '</div>' +
      '</div>';
  }

  function renderProspectInfo() {
    var el = $sel('data-v30pm-prospect');
    if (!el) return;
    var p = STATE.prospect || {};
    var co = STATE.company || {};
    var chanLabel = STATE.channel === 'linkedin' ? 'LinkedIn' : 'Email';
    var dest = STATE.channel === 'linkedin' ? (p.linkedin || '—') : (p.email || '—');
    var metaParts = [];
    if (p.fonction) metaParts.push(esc(p.fonction));
    if (co.groupe) metaParts.push(esc(co.groupe));
    if (co.site) metaParts.push(esc(co.site));
    var meta = metaParts.length
      ? metaParts.join(' · ') + ' · <span class="mono">' + esc(dest) + '</span>'
      : '<span class="mono">' + esc(dest) + '</span>';
    el.innerHTML =
      '<div class="v30pm-recipient">' +
        '<span class="v30pm-recipient__avatar" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
        '<div class="v30pm-recipient__body">' +
          '<div class="v30pm-recipient__name">' + esc(p.name || '—') + '</div>' +
          '<div class="v30pm-recipient__meta">' + meta + '</div>' +
        '</div>' +
        '<span class="v30pm-recipient__chan">' + esc(chanLabel) + '</span>' +
      '</div>';
  }

  function renderSelectLoading(sel, placeholder) {
    if (!sel) return;
    // Remplace le <select> visuellement par un skeleton le temps du chargement
    sel.innerHTML = '<option value="">' + (placeholder || '…') + '</option>';
    sel.disabled = true;
    sel.style.opacity = '0.6';
  }
  function restoreSelect(sel) {
    if (!sel) return;
    sel.disabled = false;
    sel.style.opacity = '';
  }

  function loadPushCategories() {
    var sel = $sel('data-v30pm-cat');
    if (!sel) return Promise.resolve();
    renderSelectLoading(sel, 'Chargement des catégories…');
    return fetchJSON('/api/push-categories').then(function (cats) {
      var list = Array.isArray(cats) ? cats : [];
      sel.innerHTML = '<option value="">— Aucune catégorie —</option>' +
        list.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      var p = STATE.prospect || {};
      if (p.push_category_id) sel.value = String(p.push_category_id);
      restoreSelect(sel);
    }).catch(function () {
      sel.innerHTML = '<option value="">Erreur de chargement</option>';
      restoreSelect(sel);
    });
  }

  // ─── Candidats : combobox custom avec optgroups ──────────
  // STATE additionnel :
  //   STATE.allCandidates    : liste brute /api/candidates (avec has_dc)
  //   STATE.aiSuggestions    : array d'ids triés retournés par best-candidates
  //   STATE.selectedCand[1|2]: ids sélectionnés dans chaque combobox
  STATE.allCandidates = [];
  STATE.aiSuggestions = [];
  STATE.selectedCand = { 1: null, 2: null };

  function findCandidate(id) {
    if (!id) return null;
    for (var i = 0; i < STATE.allCandidates.length; i++) {
      if (String(STATE.allCandidates[i].id) === String(id)) return STATE.allCandidates[i];
    }
    return null;
  }

  function renderComboLabel(slot) {
    var btn = document.querySelector('[data-v30pm-combo-label="' + slot + '"]');
    if (!btn) return;
    var id = STATE.selectedCand[slot];
    var c = findCandidate(id);
    if (!c) {
      btn.innerHTML = '<span style="color:var(--text-3);">— Choisir un candidat —</span>';
      return;
    }
    var dc = c.has_dc ? '<span class="v30pm-combo__dc v30pm-combo__dc--ok" title="DC disponible">' + ic('checkCircle', 11) + ' DC</span>' : '';
    btn.innerHTML = '<span class="v30pm-combo__name">' + esc(c.name || '') + '</span>' +
      (c.role ? '<span class="v30pm-combo__role">' + esc(c.role) + '</span>' : '') +
      dc;
  }

  function buildComboPanelHTML() {
    var aiSet = {};
    (STATE.aiSuggestions || []).forEach(function (id) { aiSet[String(id)] = true; });
    var withDC = [];
    var withoutDC = [];
    STATE.allCandidates.forEach(function (c) {
      if (c.has_dc) withDC.push(c);
      else withoutDC.push(c);
    });
    function row(c, slot, extraCls) {
      var dcPill = c.has_dc
        ? '<span class="v30pm-combo__dc v30pm-combo__dc--ok" title="DC disponible">' + ic('checkCircle', 10) + '</span>'
        : '<span class="v30pm-combo__dc v30pm-combo__dc--ko" title="Pas de DC">' + ic('x', 10) + '</span>';
      return '<button type="button" class="v30pm-combo__opt ' + (extraCls || '') + '" role="option" data-v30pm-opt-id="' + c.id + '" data-v30pm-opt-slot="' + slot + '">' +
        dcPill +
        '<span class="v30pm-combo__opt-body">' +
          '<span class="v30pm-combo__opt-name">' + esc(c.name || '') + '</span>' +
          (c.role ? '<span class="v30pm-combo__opt-role">' + esc(c.role) + '</span>' : '') +
        '</span>' +
      '</button>';
    }
    function section(label, list, slot, cls) {
      if (!list.length) return '';
      return '<div class="v30pm-combo__group"><div class="v30pm-combo__group-label">' + label + '</div>' +
        list.map(function (c) { return row(c, slot, cls); }).join('') +
      '</div>';
    }
    return function (slot) {
      var suggested = (STATE.aiSuggestions || [])
        .map(function (id) { return findCandidate(id); })
        .filter(Boolean);
      var html = '';
      // Option "aucun"
      html += '<button type="button" class="v30pm-combo__opt v30pm-combo__opt--none" role="option" data-v30pm-opt-id="" data-v30pm-opt-slot="' + slot + '">' +
        '<span class="v30pm-combo__opt-body"><span class="v30pm-combo__opt-name" style="color:var(--text-3);">— Aucun candidat —</span></span>' +
      '</button>';
      html += section(
        '<span class="v30pm-combo__sparkle">' + ic('robot', 10) + '</span> Suggérés par l\'IA',
        suggested, slot, 'is-ai');
      html += section('✓ DC présent', withDC, slot);
      html += section('Sans DC', withoutDC, slot);
      if (!withDC.length && !withoutDC.length && !suggested.length) {
        html += '<div class="v30pm-combo__empty">Aucun candidat disponible.</div>';
      }
      return html;
    };
  }

  function renderCombos() {
    var builder = buildComboPanelHTML();
    [1, 2].forEach(function (slot) {
      var panel = document.querySelector('[data-v30pm-combo-panel="' + slot + '"]');
      if (panel) panel.innerHTML = builder(slot);
      renderComboLabel(slot);
    });
  }

  function openCombo(slot) {
    [1, 2].forEach(function (s) {
      var el = document.querySelector('[data-v30pm-combo="' + s + '"]');
      if (el) el.classList.toggle('is-open', String(s) === String(slot));
      var btn = document.querySelector('[data-v30pm-combo-btn="' + s + '"]');
      if (btn) btn.setAttribute('aria-expanded', String(s) === String(slot) ? 'true' : 'false');
    });
  }
  function closeCombos() {
    [1, 2].forEach(function (s) {
      var el = document.querySelector('[data-v30pm-combo="' + s + '"]');
      if (el) el.classList.remove('is-open');
      var btn = document.querySelector('[data-v30pm-combo-btn="' + s + '"]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }
  function selectCandidate(slot, id) {
    STATE.selectedCand[slot] = id ? Number(id) : null;
    renderComboLabel(slot);
    closeCombos();
  }

  // ─── Barre IA (scoring candidats) ─────────────────────────
  function showIABar(msg) {
    var bar = $sel('data-v30pm-iabar');
    if (bar) bar.classList.add('is-active');
    var m = $sel('data-v30pm-iabar-msg');
    if (m) m.textContent = msg || 'L\'IA réfléchit aux meilleurs candidats…';
    updateIABarStats(0);
  }
  function updateIABarMsg(msg) {
    var m = $sel('data-v30pm-iabar-msg');
    if (m) m.textContent = msg;
  }
  function updateIABarStats(secs) {
    var s = $sel('data-v30pm-iabar-stats');
    if (s) s.textContent = secs ? secs.toFixed(1) + ' s' : '';
  }
  function hideIABar() {
    var bar = $sel('data-v30pm-iabar');
    if (bar) bar.classList.remove('is-active');
  }

  // ─── Loaders ──────────────────────────────────────────────
  function loadAllCandidates() {
    return fetchJSON('/api/candidates').then(function (resp) {
      var arr = Array.isArray(resp) ? resp : (resp && resp.candidates) || [];
      STATE.allCandidates = arr.sort(function (a, b) {
        return (a.name || '').localeCompare(b.name || '');
      });
      STATE.candidates = STATE.allCandidates; // compat avec buildAIPrompt
      renderCombos();
    }).catch(function () {
      STATE.allCandidates = [];
      renderCombos();
    });
  }

  function loadAISuggestions(catId) {
    // Deuxième passe : scoring côté serveur (tags × 3 + notes + catégorie…).
    // Affiche la barre IA contextuelle.
    var p = STATE.prospect || {};
    var cat = (STATE.categories || []).filter(function (c) { return String(c.id) === String(catId); })[0];
    var ctxMsg = 'L\'IA analyse ' + (p.name ? esc(p.name) : 'ce prospect') +
                 (cat ? ' pour la catégorie « ' + esc(cat.name) + ' »' : '') + '…';
    showIABar(ctxMsg);
    var startTs = Date.now();
    var tick = setInterval(function () { updateIABarStats((Date.now() - startTs) / 1000); }, 150);
    var qs = catId ? ('?push_category_id=' + encodeURIComponent(catId)) : '';
    return fetchJSON('/api/prospect/' + STATE.prospectId + '/best-candidates' + qs).then(function (j) {
      var arr = (j && j.candidates) || [];
      // On garde les 5 meilleurs
      STATE.aiSuggestions = arr.slice(0, 5).map(function (c) { return c.id; });
      // Si certains candidats suggérés ne sont pas dans allCandidates (filtrage
      // serveur différent), on les ajoute pour pouvoir les afficher.
      arr.forEach(function (c) {
        if (!findCandidate(c.id)) STATE.allCandidates.push(c);
      });
      renderCombos();
      clearInterval(tick);
      var elapsed = (Date.now() - startTs) / 1000;
      if (arr.length) {
        updateIABarMsg('✨ ' + arr.length + ' candidats suggérés par pertinence');
        updateIABarStats(elapsed);
        setTimeout(hideIABar, 2400);
      } else {
        updateIABarMsg('Aucune suggestion trouvée');
        setTimeout(hideIABar, 2000);
      }
    }).catch(function () {
      clearInterval(tick);
      STATE.aiSuggestions = [];
      renderCombos();
      updateIABarMsg('Impossible de calculer les suggestions');
      setTimeout(hideIABar, 2000);
    });
  }

  function loadCurrentUser() {
    // On charge juste current_user_id (pour envoyer comme consultant1_id à /api/push-logs/add).
    // Pas d'UI pour les users — Antoine tout seul ne justifiait pas un dropdown.
    return fetchJSON('/api/users/for-push').then(function (resp) {
      STATE.users = (resp && resp.users) || [];
      STATE.currentUserId = (resp && resp.current_user_id) || null;
    }).catch(function () {
      STATE.users = [];
      STATE.currentUserId = null;
    });
  }

  // ─── AI generation ────────────────────────────────────────
  function selectedValuesMulti() {
    return {
      catId: ($sel('data-v30pm-cat') || {}).value || null,
      candidateId1: STATE.selectedCand[1] || null,
      candidateId2: STATE.selectedCand[2] || null,
      consultantId1: STATE.currentUserId || null,
      consultantId2: null
    };
  }

  function buildAIPrompt(variants) {
    var vals = selectedValuesMulti();
    var p = STATE.prospect || {};
    var co = STATE.company || {};
    var cand1 = vals.candidateId1 ? STATE.candidates.filter(function (c) { return String(c.id) === String(vals.candidateId1); })[0] : null;
    var cand2 = vals.candidateId2 ? STATE.candidates.filter(function (c) { return String(c.id) === String(vals.candidateId2); })[0] : null;
    var cons1 = vals.consultantId1 ? STATE.users.filter(function (u) { return String(u.id) === String(vals.consultantId1); })[0] : null;
    var cons2 = vals.consultantId2 ? STATE.users.filter(function (u) { return String(u.id) === String(vals.consultantId2); })[0] : null;

    var prospectInfo = 'Prospect: ' + (p.name || '') + '\n' +
      'Entreprise: ' + (co.groupe || '') + '\n' +
      'Fonction: ' + (p.fonction || '') + '\n' +
      'Tags techniques: ' + ((p.tags || []).join(', ') || 'Aucun') + '\n' +
      'Notes: ' + String(p.notes || '').substring(0, 200);

    var candidatesInfo = '';
    var cands = [cand1, cand2].filter(Boolean);
    if (cands.length) {
      candidatesInfo = '\n\nCandidats à présenter:\n' + cands.map(function (c) {
        return '- ' + (c.name || '') + ' (' + (c.role || '') + '): ' + ((c.skills || []).slice(0, 5).join(', '));
      }).join('\n');
    }
    var consultantsInfo = '';
    var cons = [cons1, cons2].filter(Boolean);
    if (cons.length) {
      consultantsInfo = '\n\nConsultants à mentionner:\n' + cons.map(function (u) {
        return '- ' + (u.display_name || u.username || '');
      }).join('\n');
    }
    var channel = STATE.channel || 'email';
    var channelType = channel === 'linkedin' ? 'message LinkedIn InMail' : 'email professionnel';
    var variantsText = variants > 1 ? 'Génère ' + variants + ' variantes différentes du message, numérotées "Variante 1:", "Variante 2:", etc.' : '';

    return 'Tu es un assistant de prospection B2B spécialisé en ingénierie (systèmes embarqués, électronique, robotique, logiciel).\n\n' +
      'Je dois rédiger un ' + channelType + ' personnalisé pour un prospect.\n\n' +
      prospectInfo + candidatesInfo + consultantsInfo + '\n\n' +
      'Instructions:\n' +
      '- Ton professionnel mais chaleureux\n' +
      '- Mentionne les compétences techniques pertinentes si des candidats sont sélectionnés\n' +
      "- Référence l'entreprise du prospect si possible\n" +
      '- Longueur: ' + (channel === 'linkedin' ? '150-200 mots (InMail LinkedIn)' : '200-300 mots (email)') + '\n' +
      "- Structure: Salutation personnalisée, présentation brève de votre ESN, proposition de valeur, appel à l'action, signature\n" +
      variantsText + '\n\n' +
      'Réponds UNIQUEMENT par le message ' + (variants > 1 ? '(variantes numérotées)' : '') + ', sans texte avant ou après, sans markdown.';
  }

  // ─── AI Progress UI ───────────────────────────────────────
  function showAIProgress(msg) {
    var bar = $sel('data-v30pm-progress');
    var m = $sel('data-v30pm-progress-msg');
    if (bar) bar.classList.add('is-active');
    if (m) m.textContent = msg || 'Préparation de l\'IA…';
    updateAIStats(0, null);
  }
  function updateAIProgressMsg(msg) {
    var m = $sel('data-v30pm-progress-msg');
    if (m) m.textContent = msg;
  }
  function updateAIStats(charCount, elapsedSec) {
    var s = $sel('data-v30pm-progress-stats');
    if (!s) return;
    var parts = [];
    if (elapsedSec != null) parts.push(elapsedSec.toFixed(1) + ' s');
    if (charCount) parts.push(charCount + ' car.');
    s.textContent = parts.join(' · ');
  }
  function hideAIProgress() {
    var bar = $sel('data-v30pm-progress');
    if (bar) bar.classList.remove('is-active');
  }
  function setAIButtonsDisabled(disabled) {
    var bd = document.getElementById(MODAL_ID);
    if (!bd) return;
    bd.querySelectorAll('[data-v30pm-ai]').forEach(function (b) { b.disabled = !!disabled; });
  }

  // ─── AI generation (streaming SSE direct) ─────────────────
  function generateAI(variants) {
    var messageEl = $sel('data-v30pm-message');
    if (!messageEl) return;
    var prompt = buildAIPrompt(variants);

    messageEl.value = '';
    setAIButtonsDisabled(true);
    showAIProgress(variants > 1 ? 'Connexion IA (' + variants + ' variantes)…' : 'Connexion à l\'IA…');

    var startTs = Date.now();
    var fullText = '';
    var controller = (typeof AbortController === 'function') ? new AbortController() : null;
    var timeoutMs = variants > 1 ? 180000 : 120000;
    var timeoutId = setTimeout(function () {
      if (controller) controller.abort();
    }, timeoutMs);

    // Met à jour l'horloge pendant le stream, même si aucun token n'arrive
    var tickTimer = setInterval(function () {
      updateAIStats(fullText.length, (Date.now() - startTs) / 1000);
    }, 300);

    function done(ok, errMsg) {
      clearTimeout(timeoutId);
      clearInterval(tickTimer);
      setAIButtonsDisabled(false);
      if (ok) {
        hideAIProgress();
        // Post-traitement variants
        if (variants > 1 && fullText) {
          var parts = fullText.split(/Variante\s+\d+\s*:/i).filter(function (v) { return v.trim(); }).map(function (v) { return v.trim(); });
          if (parts.length >= variants) {
            messageEl.value = parts.slice(0, variants).map(function (v, i) {
              return '=== VARIANTE ' + (i + 1) + ' ===\n' + v;
            }).join('\n\n');
          }
          toast(variants + ' variantes générées', 'success', 3000);
        } else {
          toast('Message généré', 'success', 2500);
        }
      } else {
        updateAIProgressMsg(errMsg || 'Erreur IA');
        toast('Erreur IA : ' + (errMsg || 'inconnue'), 'error', 5000);
        setTimeout(hideAIProgress, 2500);
      }
    }

    var body = { prompt: prompt, timeout: Math.min(600, Math.ceil(timeoutMs / 1000)) };
    var fetchOpts = {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (controller) fetchOpts.signal = controller.signal;

    fetch('/api/ollama/generate-stream', fetchOpts).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error((j && j.error) || ('HTTP ' + res.status));
        });
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        // Navigateur sans ReadableStream : fallback via callOllama (non-stream)
        if (typeof window.callOllama === 'function') {
          return window.callOllama(prompt, { timeoutMs: timeoutMs, stream: false }).then(function (text) {
            fullText = String(text || '').trim();
            messageEl.value = fullText;
            updateAIStats(fullText.length, (Date.now() - startTs) / 1000);
          });
        }
        throw new Error('Stream non supporté');
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buffer += decoder.decode(r.value, { stream: true });
          var chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          chunks.forEach(function (chunk) {
            chunk.split('\n').forEach(function (line) {
              if (!line.indexOf('data: ')) {
                try {
                  var ev = JSON.parse(line.slice(6));
                  if (ev.type === 'start') {
                    updateAIProgressMsg(ev.message || 'Génération IA en cours…');
                  } else if (ev.type === 'token') {
                    fullText += ev.text || '';
                    messageEl.value = fullText;
                    // Auto-scroll vers le bas
                    messageEl.scrollTop = messageEl.scrollHeight;
                    updateAIStats(fullText.length, (Date.now() - startTs) / 1000);
                    if (ev.done) updateAIProgressMsg('Finalisation…');
                  } else if (ev.type === 'end') {
                    updateAIProgressMsg(ev.message || 'Terminé');
                  } else if (ev.type === 'error') {
                    throw new Error(ev.message || 'Erreur serveur IA');
                  }
                } catch (_) { /* ignore parse errors (SSE framing) */ }
              }
            });
          });
          return pump();
        });
      }
      return pump();
    }).then(function () {
      done(true);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') {
        done(false, 'Timeout — l\'IA a mis trop de temps');
      } else {
        done(false, (e && e.message) || 'Erreur inconnue');
      }
    });
  }

  // ─── Envoi (confirmPushSend) ─────────────────────────────
  function send() {
    var p = STATE.prospect;
    if (!p) { toast('Prospect introuvable', 'error'); return; }
    var channel = STATE.channel || 'email';
    if (channel === 'email' && !p.email) { toast('Aucun email renseigné pour ce prospect.', 'error'); return; }
    if (channel === 'linkedin' && !p.linkedin) { toast('Aucun LinkedIn renseigné pour ce prospect.', 'error'); return; }

    var sendBtn = document.querySelector('#' + MODAL_ID + ' [data-v30pm-send]');
    if (sendBtn) sendBtn.disabled = true;

    var vals = selectedValuesMulti();
    var customMessage = ($sel('data-v30pm-message') || {}).value || '';
    customMessage = String(customMessage).trim();
    var companyName = (STATE.company && STATE.company.groupe) || '';
    var templateName = '';
    var templateOpened = false;

    var chain = Promise.resolve();

    if (channel === 'email') {
      chain = chain.then(function () { return copyText(p.email); });
      if (vals.catId) {
        chain = chain.then(function () {
          return fetchJSON('/api/push-categories/' + vals.catId + '/files').then(function (fdata) {
            if (fdata && fdata.ok && fdata.files && fdata.files.length) {
              var file = fdata.files[0];
              templateName = file.name;
              return postJSON('/api/pushs/open', { category_id: vals.catId, filename: file.name }).then(function (r) {
                if (r.ok && r.data && r.data.ok) {
                  templateOpened = true;
                } else {
                  toast("Impossible d'ouvrir le template : " + ((r.data && r.data.error) || 'erreur'), 'warning', 5000);
                }
              });
            } else {
              toast('Aucun fichier template (.msg/.eml) dans cette catégorie.', 'warning', 4000);
            }
          }).catch(function (e) {
            toast('Erreur réseau : ' + e.message, 'warning');
          });
        });
      }
      // Télécharger les dossiers de compétences des candidats sélectionnés
      [vals.candidateId1, vals.candidateId2].filter(Boolean).forEach(function (candId) {
        chain = chain.then(function () {
          return fetchJSON('/api/candidates/' + candId).then(function (candData) {
            if (candData && candData.ok && candData.candidate && candData.candidate.dossier_competence_pdf) {
              var link = document.createElement('a');
              link.href = '/api/candidates/' + candId + '/dossier-competence';
              link.download = candData.candidate.dossier_competence_pdf;
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              return new Promise(function (r) { setTimeout(r, 300); });
            }
          }).catch(function () {});
        });
      });
    } else if (channel === 'linkedin') {
      chain = chain.then(function () {
        if (customMessage) return customMessage;
        // Cherche un template LinkedIn InMail custom dans settings, sinon fallback
        return fetchJSON('/api/settings').then(function (s) {
          if (s && s.linkedin_inmail_template && s.linkedin_inmail_template.trim()) {
            return renderTemplateString(s.linkedin_inmail_template, buildTemplateVars(p, STATE.company));
          }
          return defaultLinkedInMessage(p);
        }).catch(function () { return defaultLinkedInMessage(p); });
      }).then(function (text) {
        return copyText(text).then(function () {
          if (p.linkedin) window.open(p.linkedin, '_blank', 'noopener');
          return text;
        });
      });
    }

    var sentAt = todayISO();
    chain = chain.then(function (linkedInText) {
      // Logger le push
      var body = {
        prospect_id: p.id,
        sentAt: sentAt,
        channel: channel,
        to_email: channel === 'email' ? p.email : null,
        subject: channel === 'email' ? (templateOpened ? ('Push ' + companyName) : (customMessage ? 'Push IA personnalisé' : 'Push manuel')) : null,
        body: channel === 'email' ? (templateOpened ? ('Template: ' + templateName) : (customMessage || '')) : (customMessage || linkedInText || ''),
        template_id: null,
        template_name: templateName || null,
        candidate_id1: vals.candidateId1 ? parseInt(vals.candidateId1, 10) : null,
        candidate_id2: vals.candidateId2 ? parseInt(vals.candidateId2, 10) : null,
        consultant1_id: vals.consultantId1 ? parseInt(vals.consultantId1, 10) : null,
        consultant2_id: vals.consultantId2 ? parseInt(vals.consultantId2, 10) : null,
        ai_generated: customMessage ? true : null
      };
      return postJSON('/api/push-logs/add', body).then(function (r) {
        if (!r.ok) toast("Push enregistré localement mais log serveur KO.", 'warning', 5000);
      });
    });

    chain.then(function () {
      if (channel === 'email') {
        if (templateOpened) {
          toast('Email ' + p.email + ' copié ! Template Outlook ouvert.', 'success', 6000);
        } else {
          toast('Email ' + p.email + ' copié dans le presse-papier.', 'info', 4000);
        }
      } else {
        toast('Message LinkedIn copié ! Profil ouvert dans un nouvel onglet.', 'success', 4000);
      }
      close();
      // Notifier la page hôte qu'un push a été loggué (pour qu'elle refresh sa timeline)
      try {
        document.dispatchEvent(new CustomEvent('v30-push-sent', {
          detail: { prospect_id: p.id, channel: channel, sentAt: sentAt }
        }));
      } catch (_) {}
    }).catch(function (e) {
      toast('Erreur envoi : ' + (e.message || 'inconnue'), 'error', 5000);
    }).then(function () {
      if (sendBtn) sendBtn.disabled = false;
    });
  }

  // ─── Helpers templates ────────────────────────────────────
  function buildTemplateVars(p, co) {
    p = p || {}; co = co || {};
    var civ = p.civilite || p.gender || '';
    return {
      civilite: civ || '',
      nom: p.lastname || p.nom || ((p.name || '').split(' ').slice(-1)[0] || ''),
      prenom: p.firstname || p.prenom || ((p.name || '').split(' ')[0] || ''),
      nom_complet: p.name || '',
      entreprise: co.groupe || p.company_groupe || '',
      fonction: p.fonction || ''
    };
  }
  function renderTemplateString(tpl, vars) {
    return String(tpl || '').replace(/\{\{?\s*(\w+)\s*\}?\}/g, function (_, k) {
      return (vars && vars[k]) != null ? String(vars[k]) : '';
    });
  }
  function defaultLinkedInMessage(p) {
    var co = STATE.company || {};
    var vars = buildTemplateVars(p, co);
    return 'Bonjour ' + (vars.civilite ? vars.civilite + ' ' : '') + (vars.nom || vars.nom_complet || '') + ',\n\n' +
      'Je me permets de vous contacter concernant ' + (vars.entreprise || 'votre entreprise') + '.\n\nBelle journée,';
  }

  // ─── Entry point ──────────────────────────────────────────
  function open(prospectId, channel) {
    if (!prospectId) { toast('Prospect inconnu', 'warning'); return; }
    STATE.prospectId = prospectId;
    STATE.channel = (channel === 'linkedin') ? 'linkedin' : 'email';
    STATE.prospect = null;
    STATE.company = null;
    STATE.candidates = [];
    STATE.users = [];
    STATE.currentUserId = null;
    STATE.allCandidates = [];
    STATE.aiSuggestions = [];
    STATE.selectedCand = { 1: null, 2: null };
    var bd = ensureModal();
    // Titre dynamique
    var title = bd.querySelector('[data-v30pm-title]');
    if (title) title.textContent = STATE.channel === 'linkedin' ? 'Push LinkedIn' : 'Push Email';
    // Reset form
    ['data-v30pm-message'].forEach(function (a) { var el = bd.querySelector('[' + a + ']'); if (el) el.value = ''; });
    // Skeletons immédiats
    renderProspectSkeleton();
    renderSelectLoading(bd.querySelector('[data-v30pm-cat]'), '…');
    renderCombos();  // affiche l'état vide « aucun candidat disponible »
    hideIABar();
    hideAIProgress();
    openBd(bd);
    // Charger les données en parallèle (sauf besoin de prospect pour l'IA contextuelle)
    getProspectInfo(prospectId).then(function (res) {
      STATE.prospect = res.prospect;
      STATE.company = res.company;
      // Validation canal
      if (STATE.channel === 'email' && !STATE.prospect.email) {
        toast('Aucun email renseigné pour ce prospect.', 'warning');
        close();
        return Promise.reject(new Error('no_email'));
      }
      if (STATE.channel === 'linkedin' && !STATE.prospect.linkedin) {
        toast('Aucun LinkedIn renseigné pour ce prospect.', 'warning');
        close();
        return Promise.reject(new Error('no_linkedin'));
      }
      renderProspectInfo();
      // Charger catégories, candidats complets et current user en parallèle
      return Promise.all([
        loadPushCategories(),
        loadAllCandidates(),
        loadCurrentUser()
      ]).then(function () {
        // Si le prospect a une catégorie par défaut, déclencher la passe IA
        var catSel = $sel('data-v30pm-cat');
        var catId = catSel && catSel.value ? catSel.value : null;
        if (catId) return loadAISuggestions(catId);
      });
    }).catch(function (e) {
      if (e && e.message === 'no_email') return;
      if (e && e.message === 'no_linkedin') return;
      toast('Erreur de chargement : ' + (e && e.message || 'inconnue'), 'error');
    });
  }

  // ─── Exposition globale ───────────────────────────────────
  window.V30PushModal = {
    open: open,
    close: close
  };
})();
