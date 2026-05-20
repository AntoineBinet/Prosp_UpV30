/* ProspUp — Popup « Pousser » depuis une fiche prospect ou une ligne de la table.
 *
 * Exposé sur window.V30PushModal.open(prospectId, channel='email'|'linkedin').
 *
 * Utilise /api/push-categories, /api/prospect/<id>/push-ai-plan (SSE),
 * /api/prospect/<id>/best-candidates, /api/users/for-push, /api/push-logs/add,
 * /api/pushs/open, /api/settings, /api/candidates/<id>/dossier-competence,
 * /api/ollama/generate-stream.
 */
(function () {
  'use strict';

  var MODAL_ID = 'v30PushModal';

  // Étapes du plan IA (panneau « Analyse IA » — pipeline transparent).
  var STEP_ORDER = ['profil', 'web', 'secteur', 'categorie', 'candidats'];
  var STEP_TITLES = {
    profil:    'Analyse du profil',
    web:       'Recherche web',
    secteur:   'Détection du secteur',
    categorie: 'Choix de la catégorie',
    candidats: 'Sélection des consultants'
  };

  var STATE = {
    prospectId: null,
    channel: 'email',
    prospect: null,
    company: null,
    candidates: [],       // liste des best-candidates chargés
    categories: [],       // catégories push (pour détecter no_candidates)
    users: [],            // liste des consultants
    currentUserId: null,
    activeTab: 'classique',
    callNote: '',
    // ─ Plan IA (panneau « Analyse IA »)
    aiPlanSteps: {},      // { key: {status,label,detail,sources} }
    aiPlanES: null,       // EventSource du flux SSE en cours
    aiPlanStartTs: 0,
    aiPlanTimer: null,
    aiPlanCollapsed: false,
    catPreset: false,     // une catégorie était présélectionnée à l'ouverture
    userPickedCat: false  // l'utilisateur a changé la catégorie manuellement
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

          // ─ Onglets
          '<div class="v30pm-tabs" role="tablist">' +
            '<button type="button" class="v30pm-tab is-active" data-v30pm-tab="classique" role="tab" aria-selected="true">Push classique</button>' +
            '<button type="button" class="v30pm-tab" data-v30pm-tab="suivi" role="tab" aria-selected="false">Push suivi d\'appel</button>' +
          '</div>' +

          // ─ Destinataire
          '<section class="v30pm-section">' +
            '<div class="v30pm-section__label">' + ic('userSingle', 11) + ' Destinataire</div>' +
            '<div data-v30pm-prospect></div>' +
          '</section>' +

          // ─ Accroche appel manqué (visible seulement en mode "suivi d'appel")
          '<section class="v30pm-section" data-v30pm-callnote-section hidden>' +
            '<div class="v30pm-section__label">' + ic('phone', 11) + ' Accroche appel manqué</div>' +
            '<div class="v30pm-callnote-wrap">' +
              '<textarea class="v30-input v30pm-callnote__ta" data-v30pm-callnote rows="3" placeholder="Cliquez sur « Générer via IA » pour créer une phrase personnalisée…"></textarea>' +
              '<div class="v30pm-callnote-actions">' +
                '<button type="button" class="btn btn-sm btn-accent-soft btn-pill" data-v30pm-callnote-gen>' +
                  ic('robot', 12) + ' Générer via IA' +
                '</button>' +
                '<span class="v30pm-callnote__status" data-v30pm-callnote-status></span>' +
              '</div>' +
            '</div>' +
          '</section>' +

          // ─ Contexte : catégorie + candidats (sur UNE ligne)
          '<section class="v30pm-section">' +
            '<div class="v30pm-section__label">' + ic('clipboard', 11) + ' Contexte</div>' +
            '<label class="v30-field">' +
              '<span class="v30-field__label">Catégorie push' +
                '<span class="v30pm-cat-aibadge" data-v30pm-cat-aibadge hidden>' + ic('robot', 10) + ' Suggérée par l\'IA</span>' +
              '</span>' +
              '<select class="v30-input v30-input--lg" data-v30pm-cat aria-label="Catégorie push"></select>' +
            '</label>' +

            // Panneau « Analyse IA » — pipeline transparent (secteur → catégorie → candidats).
            // Chaque étape du raisonnement IA s\'affiche en direct.
            '<div class="v30pm-aiplan" data-v30pm-aiplan hidden>' +
              '<div class="v30pm-aiplan__head">' +
                '<span class="v30pm-aiplan__pulse" data-v30pm-aiplan-pulse aria-hidden="true"></span>' +
                '<span class="v30pm-aiplan__title">' + ic('robot', 12) + ' Analyse IA du push</span>' +
                '<span class="v30pm-aiplan__time" data-v30pm-aiplan-time></span>' +
                '<button type="button" class="v30pm-aiplan__toggle" data-v30pm-aiplan-toggle aria-expanded="true">Masquer</button>' +
              '</div>' +
              '<div class="v30pm-aiplan__steps" data-v30pm-aiplan-steps></div>' +
            '</div>' +

            '<div class="v30-field" data-v30pm-cand-section>' +
              '<span class="v30-field__label">Candidats à proposer</span>' +
              '<div class="v30pm-grid">' +
                // Combobox custom 1
                '<div class="v30pm-combo" data-v30pm-combo="1">' +
                  '<button type="button" class="v30pm-combo__btn" data-v30pm-combo-btn="1" aria-haspopup="listbox" aria-expanded="false">' +
                    '<span class="v30pm-combo__label" data-v30pm-combo-label="1">— Choisir un candidat —</span>' +
                    '<span class="v30pm-combo__chev" aria-hidden="true">' + ic('chevronD', 12) + '</span>' +
                  '</button>' +
                  '<div class="popover popover--reveal v30pm-combo__panel" data-v30pm-combo-panel="1" role="listbox"></div>' +
                '</div>' +
                // Combobox custom 2
                '<div class="v30pm-combo" data-v30pm-combo="2">' +
                  '<button type="button" class="v30pm-combo__btn" data-v30pm-combo-btn="2" aria-haspopup="listbox" aria-expanded="false">' +
                    '<span class="v30pm-combo__label" data-v30pm-combo-label="2">— Choisir un candidat —</span>' +
                    '<span class="v30pm-combo__chev" aria-hidden="true">' + ic('chevronD', 12) + '</span>' +
                  '</button>' +
                  '<div class="popover popover--reveal v30pm-combo__panel" data-v30pm-combo-panel="2" role="listbox"></div>' +
                '</div>' +
              '</div>' +
              // Cartes description par candidat (apparaissent quand sélectionné)
              '<div class="v30pm-candcards" data-v30pm-candcards></div>' +
            '</div>' +
            // Hint affiché à la place quand la catégorie est "sans consultant"
            '<div class="v30-field muted" data-v30pm-cand-skip hidden style="font-size:12px;">' +
              ic('checkCircle', 12) + ' Catégorie « sans consultant » — aucun candidat ni dossier ne sera attaché. Le push utilisera uniquement le template email.' +
            '</div>' +
          '</section>' +

          // NB : plus de section Message — tout le contenu du push vient du
          // template .msg Outlook. Seules les présentations par candidat sont
          // éditables (cartes au-dessus).
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
      if (e.target.closest('[data-v30pm-send]')) { send(); return; }
      // Onglets
      var tabBtn = e.target.closest('[data-v30pm-tab]');
      if (tabBtn) { setActiveTab(tabBtn.dataset.v30pmTab); return; }
      // Panneau « Analyse IA » : replier / déplier
      if (e.target.closest('[data-v30pm-aiplan-toggle]')) { toggleAIPlan(); return; }
      // Générer accroche appel
      if (e.target.closest('[data-v30pm-callnote-gen]')) { generateCallNote(); return; }
      // Lien optionnel "Enrichir le profil" (affiché après génération si peu de données)
      if (e.target.closest('[data-v30pm-enrich-hint]')) {
        e.preventDefault();
        showEnrichmentDialog(function () { generateCallNote(); });
        return;
      }
      // Régénérer description IA du candidat
      var regen = e.target.closest('[data-v30pm-regen]');
      if (regen) {
        regenerateCandDesc(Number(regen.dataset.v30pmRegen));
        return;
      }
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
        var cat = $sel('data-v30pm-cat');
        var catId = cat && cat.value ? cat.value : null;
        STATE.userPickedCat = true;
        var aibadge = $sel('data-v30pm-cat-aibadge');
        if (aibadge) aibadge.hidden = true;
        applyCategoryChange(catId);
        onCategoryPicked(catId);
      }
    });
    // Auto-save description candidat (onBlur)
    bd.addEventListener('blur', function (e) {
      var ta = e.target.closest('[data-v30pm-desc]');
      if (ta) {
        var id = Number(ta.dataset.v30pmDesc);
        if (id) saveCandDesc(id, ta.value || '');
      }
      // Synchronise l'accroche appel dans STATE
      var cn = e.target.closest('[data-v30pm-callnote]');
      if (cn) STATE.callNote = cn.value || '';
    }, true); // capture pour attraper le blur qui ne bubble pas
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
    stopAIPlan();
    var bd = document.getElementById(MODAL_ID);
    if (bd) closeBd(bd);
    STATE.prospectId = null;
    STATE.channel = 'email';
    STATE.prospect = null;
    STATE.company = null;
    STATE.candidates = [];
    STATE.users = [];
    STATE.activeTab = 'classique';
    STATE.callNote = '';
    STATE.aiPlanSteps = {};
    STATE.catPreset = false;
    STATE.userPickedCat = false;
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
        '<span class="avatar avatar--lg v30pm-recipient__avatar">·</span>' +
        '<div class="v30pm-recipient__body">' +
          '<span class="skel" style="width:55%;height:14px;display:block;"></span>' +
          '<span class="skel" style="width:75%;height:11px;display:block;margin-top:6px;"></span>' +
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
        '<span class="avatar avatar--lg v30pm-recipient__avatar" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
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
      STATE.categories = list;
      sel.innerHTML = '<option value="">— Aucune catégorie —</option>' +
        list.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      var p = STATE.prospect || {};
      if (p.push_category_id) sel.value = String(p.push_category_id);
      restoreSelect(sel);
      applyCategoryChange(sel.value || null);
    }).catch(function () {
      sel.innerHTML = '<option value="">Erreur de chargement</option>';
      restoreSelect(sel);
    });
  }

  function findCategory(catId) {
    if (!catId) return null;
    var list = STATE.categories || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(catId)) return list[i];
    }
    return null;
  }
  function applyCategoryChange(catId) {
    var cat = findCategory(catId);
    var noCand = !!(cat && cat.no_candidates);
    var bd = document.getElementById(MODAL_ID);
    if (!bd) return;
    var section = bd.querySelector('[data-v30pm-cand-section]');
    var skip = bd.querySelector('[data-v30pm-cand-skip]');
    if (section) section.hidden = noCand;
    if (skip) skip.hidden = !noCand;
    if (noCand) {
      // Reset des candidats sélectionnés (pas envoyés au backend)
      STATE.selectedCand = { 1: null, 2: null };
      STATE.aiSuggestions = [];
    }
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
    // Si le candidat a été auto-sélectionné par l'IA, montre un petit badge
    var isAI = (STATE.aiSuggestions || []).some(function (s) { return String(s.id) === String(c.id); });
    var aiBadge = isAI ? '<span class="v30pm-combo__hint" title="Suggéré par l\'IA">' + ic('robot', 11) + ' IA</span>' : '';
    var dc = c.has_dc ? '<span class="v30pm-combo__dc v30pm-combo__dc--ok" title="DC disponible">' + ic('checkCircle', 11) + ' DC</span>' : '';
    btn.innerHTML = aiBadge +
      '<span class="v30pm-combo__name">' + esc(c.name || '') + '</span>' +
      (c.role ? '<span class="v30pm-combo__role">' + esc(c.role) + '</span>' : '') +
      dc;
  }

  function buildComboPanelHTML() {
    var withDC = [];
    var withoutDC = [];
    STATE.allCandidates.forEach(function (c) {
      if (c.has_dc) withDC.push(c);
      else withoutDC.push(c);
    });
    function row(c, slot, extraCls, pct, explanation) {
      var dcPill = c.has_dc
        ? '<span class="v30pm-combo__dc v30pm-combo__dc--ok" title="DC disponible">' + ic('checkCircle', 10) + '</span>'
        : '<span class="v30pm-combo__dc v30pm-combo__dc--ko" title="Pas de DC">' + ic('x', 10) + '</span>';
      var pctPill = (pct != null && pct > 0)
        ? '<span class="v30pm-combo__pct" title="Score de pertinence">' + Math.round(pct) + '%</span>'
        : '';
      var why = (explanation && String(explanation).trim()) || '';
      var whyLine = why
        ? '<span class="v30pm-combo__opt-why" title="Justification IA">' + esc(why) + '</span>'
        : '';
      return '<button type="button" class="v30pm-combo__opt ' + (extraCls || '') + '" role="option" data-v30pm-opt-id="' + c.id + '" data-v30pm-opt-slot="' + slot + '">' +
        dcPill +
        '<span class="v30pm-combo__opt-body">' +
          '<span class="v30pm-combo__opt-name">' + esc(c.name || '') + '</span>' +
          (c.role ? '<span class="v30pm-combo__opt-role">' + esc(c.role) + '</span>' : '') +
          whyLine +
        '</span>' +
        pctPill +
      '</button>';
    }
    function section(label, list, slot, cls) {
      if (!list.length) return '';
      return '<div class="v30pm-combo__group"><div class="v30pm-combo__group-label">' + label + '</div>' +
        list.map(function (item) {
          if (item && typeof item === 'object' && 'candidate' in item) {
            return row(item.candidate, slot, cls, item.pct, item.explanation);
          }
          return row(item, slot, cls);
        }).join('') +
      '</div>';
    }
    return function (slot) {
      // aiSuggestions : array de {id, pct, explanation}. On résout les candidats correspondants.
      var suggested = (STATE.aiSuggestions || []).map(function (s) {
        var c = findCandidate(s.id != null ? s.id : s);
        if (!c) return null;
        return {
          candidate: c,
          pct: (s && s.pct) || 0,
          explanation: (s && s.explanation) || ''
        };
      }).filter(Boolean);
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
    renderCandCards();
    closeCombos();
  }

  // ─── Cartes description par candidat (IA sur DC) ─────────
  // Cache : candId -> { description, dirty, savedAt }
  STATE.candDescCache = {};

  // L'endpoint /api/candidates/<id>/generate-description renvoie du HTML
  // (<b>Nom</b>, <br>, <p>…) conçu pour être collé tel quel dans Outlook.
  // Dans un <textarea> on veut afficher du texte lisible — on strip les balises
  // à l'affichage. La version complète (HTML) reste côté serveur + DB.
  function stripHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cachedDesc(id) {
    if (!id) return '';
    if (STATE.candDescCache[id] != null) return STATE.candDescCache[id];
    var c = findCandidate(id);
    return stripHtml((c && c.description_push) || '');
  }
  function setCachedDesc(id, text) {
    STATE.candDescCache[id] = text;
    var c = findCandidate(id);
    if (c) c.description_push = text;
  }

  function renderCandCards() {
    var host = $sel('data-v30pm-candcards');
    if (!host) return;
    var slots = [1, 2];
    var nSelected = (STATE.selectedCand[1] ? 1 : 0) + (STATE.selectedCand[2] ? 1 : 0);
    // Placeholder empty-state quand rien n'est sélectionné : explicite
    // le comportement à venir (présentation IA auto-générée depuis le DC).
    if (nSelected === 0) {
      host.innerHTML =
        '<div class="v30pm-candcard v30pm-candcard--hint">' +
          '<div class="v30pm-candcard__hint-title">' +
            ic('robot', 12) + ' <b>Présentation IA par candidat</b>' +
          '</div>' +
          '<div class="v30pm-candcard__hint-body">' +
            'Sélectionne un candidat ci-dessus pour afficher sa présentation courte. ' +
            'Si un dossier de compétences est disponible, un bouton <em>Générer IA</em> ' +
            'analyse le PDF et produit automatiquement 3-4 lignes prêtes à coller dans le mail. ' +
            'Tu peux l\'éditer — l\'enregistrement est automatique.' +
          '</div>' +
        '</div>';
      return;
    }
    var html = '';
    var explanations = STATE.aiExplanations || {};
    slots.forEach(function (slot) {
      var id = STATE.selectedCand[slot];
      if (!id) return;
      var c = findCandidate(id);
      if (!c) return;
      var desc = cachedDesc(id);
      var noDc = !c.has_dc;
      var cls = 'v30pm-candcard' + (noDc ? ' v30pm-candcard--no-dc' : '');
      var why = explanations[String(id)] || '';
      var whyLine = why
        ? '<div class="v30pm-candcard__why" title="Justification IA">' + ic('robot', 11) + ' ' + esc(why) + '</div>'
        : '';
      html +=
        '<div class="' + cls + '" data-v30pm-candcard="' + id + '">' +
          '<div class="v30pm-candcard__head">' +
            '<div class="v30pm-candcard__title">' +
              '<span class="v30pm-candcard__title-idx">Candidat ' + slot + '</span>' +
              '<span>' + esc(c.name || '—') +
                (c.role ? ' · <span style="color:var(--text-3);font-weight:400;">' + esc(c.role) + '</span>' : '') +
              '</span>' +
            '</div>' +
            '<div class="v30pm-candcard__actions">' +
              (noDc
                ? ''
                : '<button type="button" class="btn btn-sm btn-accent-soft btn-pill" data-v30pm-regen="' + id + '" aria-label="Régénérer la description IA depuis le DC">' +
                    ic('robot', 11) + ' ' + (desc ? 'Régénérer' : 'Générer IA') +
                  '</button>') +
            '</div>' +
          '</div>' +
          whyLine +
          (noDc
            ? '<div class="v30pm-candcard__empty">Ce candidat n\'a pas de dossier de compétences — impossible de générer automatiquement. Tu peux rédiger manuellement ci-dessous.</div>' +
              '<textarea class="v30pm-candcard__textarea" data-v30pm-desc="' + id + '" placeholder="Rédige une courte présentation du candidat…">' + esc(desc) + '</textarea>'
            : '<textarea class="v30pm-candcard__textarea" data-v30pm-desc="' + id + '" placeholder="Clique « Générer IA » pour analyser le dossier de compétences, ou rédige manuellement…">' + esc(desc) + '</textarea>') +
          '<div class="v30pm-candcard__status" data-v30pm-descstatus="' + id + '"></div>' +
        '</div>';
    });
    host.innerHTML = html;
  }

  function setDescStatus(id, msg, cls) {
    var el = document.querySelector('[data-v30pm-descstatus="' + id + '"]');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'v30pm-candcard__status' + (cls ? ' ' + cls : '');
  }

  function regenerateCandDesc(id) {
    var c = findCandidate(id);
    if (!c) return;
    if (!c.has_dc) { toast('Ce candidat n\'a pas de DC', 'warning'); return; }
    var btn = document.querySelector('[data-v30pm-regen="' + id + '"]');
    var ta = document.querySelector('[data-v30pm-desc="' + id + '"]');
    if (btn) btn.disabled = true;
    setDescStatus(id, 'Analyse du DC en cours…');
    if (ta) ta.value = 'Analyse du dossier de compétences en cours…';
    fetch('/api/candidates/' + id + '/generate-description', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, data: j }; });
    }).then(function (res) {
      if (!res.ok || !res.data || !res.data.ok || !res.data.description) {
        var err = (res.data && res.data.error) || ('Erreur ' + (res.data && res.data.status || ''));
        if (ta) ta.value = cachedDesc(id);
        setDescStatus(id, err, 'is-error');
        toast(err, 'error');
        return;
      }
      var text = stripHtml(String(res.data.description || '')).trim();
      if (ta) ta.value = text;
      setCachedDesc(id, text);
      setDescStatus(id, 'Description IA générée', 'is-saved');
      setTimeout(function () { setDescStatus(id, ''); }, 2500);
      toast('Description IA générée', 'success', 2500);
      // Met à jour le label du combobox (inchangé, mais au cas où role arrive)
      [1, 2].forEach(function (s) { if (STATE.selectedCand[s] === id) renderComboLabel(s); });
    }).catch(function (e) {
      if (ta) ta.value = cachedDesc(id);
      setDescStatus(id, 'Erreur : ' + (e.message || 'inconnue'), 'is-error');
      toast('Erreur IA : ' + e.message, 'error');
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  // Auto-régénère la description pour les candidats sélectionnés qui n'ont
  // pas encore de description_push en cache (et qui ont un DC). Appelé après
  // auto-sélection des Top IA.
  function autoGenerateSelectedDescriptions() {
    [1, 2].forEach(function (slot) {
      var id = STATE.selectedCand[slot];
      if (!id) return;
      var c = findCandidate(id);
      if (!c || !c.has_dc) return;
      var existing = cachedDesc(id);
      if (existing) return; // rien à faire, déjà rempli
      // Déclenche en arrière-plan (non-bloquant)
      regenerateCandDesc(id);
    });
  }

  function saveCandDesc(id, text) {
    setCachedDesc(id, text);
    setDescStatus(id, 'Sauvegarde…');
    fetch('/api/candidates/' + id + '/save-description', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: text })
    }).then(function (r) {
      if (r.ok) {
        setDescStatus(id, 'Sauvegardé', 'is-saved');
        setTimeout(function () { setDescStatus(id, ''); }, 1800);
      } else {
        setDescStatus(id, 'Erreur sauvegarde', 'is-error');
      }
    }).catch(function () {
      setDescStatus(id, 'Erreur réseau', 'is-error');
    });
  }

  // ─── Panneau « Analyse IA » (pipeline transparent) ────────
  // Affiche en direct chaque étape du raisonnement IA : profil → recherche web
  // → secteur → catégorie → candidats. Reste visible après l'analyse pour que
  // l'utilisateur garde la trace de ce que l'IA a trouvé.
  function showAIPlan() {
    var panel = $sel('data-v30pm-aiplan');
    if (panel) panel.hidden = false;
  }
  function resetAIPlan() {
    STATE.aiPlanSteps = {};
    STATE.aiPlanCollapsed = false;
    var panel = $sel('data-v30pm-aiplan');
    if (panel) panel.classList.remove('is-collapsed');
    var pulse = $sel('data-v30pm-aiplan-pulse');
    if (pulse) pulse.classList.remove('is-done');
    var btn = $sel('data-v30pm-aiplan-toggle');
    if (btn) { btn.textContent = 'Masquer'; btn.setAttribute('aria-expanded', 'true'); }
    var time = $sel('data-v30pm-aiplan-time');
    if (time) time.textContent = '';
    renderAIPlan();
  }
  function toggleAIPlan() {
    STATE.aiPlanCollapsed = !STATE.aiPlanCollapsed;
    var panel = $sel('data-v30pm-aiplan');
    var btn = $sel('data-v30pm-aiplan-toggle');
    if (panel) panel.classList.toggle('is-collapsed', STATE.aiPlanCollapsed);
    if (btn) {
      btn.textContent = STATE.aiPlanCollapsed ? 'Détails' : 'Masquer';
      btn.setAttribute('aria-expanded', STATE.aiPlanCollapsed ? 'false' : 'true');
    }
  }
  function updateAIPlanTime() {
    var el = $sel('data-v30pm-aiplan-time');
    if (el && STATE.aiPlanStartTs) {
      el.textContent = ((Date.now() - STATE.aiPlanStartTs) / 1000).toFixed(1) + ' s';
    }
  }
  function aiStepMarker(status) {
    if (status === 'running') return '<span class="v30pm-aiplan-spin" aria-hidden="true"></span>';
    if (status === 'done')    return '<span class="v30pm-aiplan-mk v30pm-aiplan-mk--done">' + ic('checkCircle', 12) + '</span>';
    if (status === 'warn')    return '<span class="v30pm-aiplan-mk v30pm-aiplan-mk--warn">!</span>';
    if (status === 'error')   return '<span class="v30pm-aiplan-mk v30pm-aiplan-mk--error">' + ic('x', 11) + '</span>';
    if (status === 'skipped') return '<span class="v30pm-aiplan-mk v30pm-aiplan-mk--skip">–</span>';
    return '<span class="v30pm-aiplan-mk v30pm-aiplan-mk--pending"></span>';
  }
  function renderAIPlan() {
    var host = $sel('data-v30pm-aiplan-steps');
    if (!host) return;
    host.innerHTML = STEP_ORDER.map(function (key) {
      var s = STATE.aiPlanSteps[key] || { status: 'pending', label: STEP_TITLES[key] };
      var detail = s.detail
        ? '<div class="v30pm-aiplan-step__detail">' + esc(s.detail) + '</div>' : '';
      var sources = '';
      if (s.sources && s.sources.length) {
        sources = '<div class="v30pm-aiplan-step__sources">' +
          s.sources.map(function (src) {
            var label = src.title || src.url || '';
            return '<a class="v30pm-aiplan-step__src" href="' + esc(src.url || '#') + '"' +
              ' target="_blank" rel="noopener" title="' + esc(src.url || '') + '">' + esc(label) + '</a>';
          }).join('') + '</div>';
      }
      return '<div class="v30pm-aiplan-step is-' + esc(s.status || 'pending') + '">' +
        '<span class="v30pm-aiplan-step__marker">' + aiStepMarker(s.status) + '</span>' +
        '<div class="v30pm-aiplan-step__body">' +
          '<div class="v30pm-aiplan-step__label">' + esc(s.label || STEP_TITLES[key]) + '</div>' +
          detail + sources +
        '</div>' +
      '</div>';
    }).join('');
  }
  function upsertStep(evt) {
    if (!evt || !evt.key) return;
    STATE.aiPlanSteps[evt.key] = {
      status: evt.status || 'done',
      label: evt.label || STEP_TITLES[evt.key],
      detail: evt.detail || '',
      sources: evt.sources || null
    };
    renderAIPlan();
  }
  function stopAIPlan() {
    if (STATE.aiPlanES) {
      try { STATE.aiPlanES.close(); } catch (_) {}
      STATE.aiPlanES = null;
    }
    if (STATE.aiPlanTimer) { clearInterval(STATE.aiPlanTimer); STATE.aiPlanTimer = null; }
  }

  // ─── Loaders ──────────────────────────────────────────────
  function loadAllCandidates() {
    return fetchJSON('/api/candidates').then(function (resp) {
      var arr = Array.isArray(resp) ? resp : (resp && resp.candidates) || [];
      STATE.allCandidates = arr.filter(function (c) { return !c.is_archived; }).sort(function (a, b) {
        return (a.name || '').localeCompare(b.name || '');
      });
      STATE.candidates = STATE.allCandidates; // compat avec buildAIPrompt
      renderCombos();
    }).catch(function () {
      STATE.allCandidates = [];
      renderCombos();
    });
  }

  // ─── Plan IA : flux SSE /api/prospect/<id>/push-ai-plan ───
  // Lance l'analyse complète (profil → web → secteur → catégorie → candidats)
  // et affiche chaque étape en direct dans le panneau « Analyse IA ».
  function runAIPlan(presetCatId) {
    if (!STATE.prospectId) return;
    stopAIPlan();
    resetAIPlan();
    showAIPlan();
    STATE.aiPlanStartTs = Date.now();
    STATE.aiPlanTimer = setInterval(updateAIPlanTime, 200);

    var url = '/api/prospect/' + encodeURIComponent(STATE.prospectId) + '/push-ai-plan';
    if (presetCatId) url += '?category_id=' + encodeURIComponent(presetCatId);

    var es;
    try { es = new EventSource(url); }
    catch (e) { onAIPlanError('Flux IA indisponible'); return; }
    STATE.aiPlanES = es;
    var finished = false;

    es.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'done')  { finished = true; stopAIPlan(); finishAIPlan(); return; }
      if (msg.type === 'error') { finished = true; stopAIPlan(); onAIPlanError(msg.message); return; }
      applyPlanEvent(msg);
    };
    // EventSource tente de se reconnecter quand le serveur clôt le flux ;
    // on ferme nous-mêmes dès 'done' pour éviter de relancer tout le pipeline.
    es.onerror = function () {
      if (finished) return;
      finished = true;
      stopAIPlan();
      onAIPlanError('Connexion au flux IA interrompue');
    };
  }

  function applyPlanEvent(msg) {
    if (msg.type === 'step') {
      upsertStep(msg);
      if (msg.key === 'categorie' && msg.status === 'done' && msg.category_id) {
        maybeApplyAICategory(msg);
      }
      return;
    }
    if (msg.type === 'result') {
      applyCandidatesResult(msg.candidates || []);
    }
  }

  // Applique la catégorie suggérée par l'IA — sauf si l'utilisateur a déjà
  // choisi (manuellement ou via présélection).
  function maybeApplyAICategory(msg) {
    if (STATE.userPickedCat || STATE.catPreset || msg.category_origin === 'preset') return;
    var sel = $sel('data-v30pm-cat');
    if (!sel) return;
    if (String(sel.value) === String(msg.category_id)) return;
    sel.value = String(msg.category_id);
    applyCategoryChange(sel.value || null);
    var badge = $sel('data-v30pm-cat-aibadge');
    if (badge) badge.hidden = false;
  }

  function finishAIPlan() {
    updateAIPlanTime();
    var pulse = $sel('data-v30pm-aiplan-pulse');
    if (pulse) pulse.classList.add('is-done');
  }

  function onAIPlanError(message) {
    // Marque les étapes non abouties en erreur pour rester transparent.
    STEP_ORDER.forEach(function (k) {
      var s = STATE.aiPlanSteps[k];
      if (!s || s.status === 'pending' || s.status === 'running') {
        STATE.aiPlanSteps[k] = { status: 'error', label: STEP_TITLES[k], detail: '' };
      }
    });
    renderAIPlan();
    var pulse = $sel('data-v30pm-aiplan-pulse');
    if (pulse) pulse.classList.add('is-done');
    if (message) toast('Analyse IA : ' + message, 'warning', 4000);
    // Repli déterministe : on tente un classement rapide des candidats sans IA.
    quickRescoreCandidates(($sel('data-v30pm-cat') || {}).value || null, true);
  }

  // Choix manuel de catégorie : l'utilisateur prime sur le plan IA en cours.
  function onCategoryPicked(catId) {
    stopAIPlan();
    var pulse = $sel('data-v30pm-aiplan-pulse');
    if (pulse) pulse.classList.add('is-done');
    showAIPlan();
    var catObj = findCategory(catId);
    if (catObj && catObj.no_candidates) {
      upsertStep({ key: 'categorie', status: 'done',
        label: 'Catégorie : ' + (catObj.name || ''),
        detail: 'Catégorie « sans consultant » — choisie manuellement.' });
      upsertStep({ key: 'candidats', status: 'skipped',
        label: 'Catégorie « sans consultant »',
        detail: 'Aucun candidat ni dossier ne sera attaché.' });
      return;
    }
    upsertStep({ key: 'categorie', status: 'done',
      label: 'Catégorie : ' + (catObj ? catObj.name : '— Aucune —'),
      detail: 'Choisie manuellement.' });
    quickRescoreCandidates(catId, false);
  }

  // Re-score des candidats pour une catégorie donnée (changement manuel ou
  // repli). deterministicOnly=true → best-candidates sans Ollama (rapide).
  function quickRescoreCandidates(catId, deterministicOnly) {
    upsertStep({ key: 'candidats', status: 'running',
      label: 'Mise à jour des consultants…' });
    var qs = [];
    if (catId) qs.push('push_category_id=' + encodeURIComponent(catId));
    if (!deterministicOnly) { qs.push('use_ollama=1'); qs.push('ai_explanations=1'); }
    var url = '/api/prospect/' + STATE.prospectId + '/best-candidates' +
      (qs.length ? ('?' + qs.join('&')) : '');
    return fetchJSON(url).then(function (j) {
      var arr = (j && j.candidates) || [];
      applyCandidatesResult(arr);
      upsertStep({
        key: 'candidats',
        status: arr.length ? 'done' : 'warn',
        label: arr.length
          ? (arr.length + ' consultant(s) pertinent(s) trouvé(s)')
          : 'Aucun consultant pertinent',
        detail: deterministicOnly
          ? 'Classement rapide (IA indisponible).'
          : 'Catégorie mise à jour.'
      });
    }).catch(function () {
      upsertStep({ key: 'candidats', status: 'error',
        label: 'Échec du classement des consultants', detail: '' });
    });
  }

  // Applique une liste de candidats classés (résultat SSE ou best-candidates).
  function applyCandidatesResult(arr) {
    arr = arr || [];
    STATE.aiSuggestions = arr.slice(0, 5).map(function (c) {
      return {
        id: c.id,
        pct: (c.relevance_pct != null ? c.relevance_pct : c.pct) || 0,
        explanation: c.ai_explanation || ''
      };
    });
    STATE.aiExplanations = STATE.aiExplanations || {};
    arr.forEach(function (c) {
      if (c.ai_explanation) STATE.aiExplanations[String(c.id)] = c.ai_explanation;
      // Candidat suggéré absent de allCandidates → on l'ajoute pour l'afficher.
      if (!findCandidate(c.id)) STATE.allCandidates.push(c);
    });
    // Auto-sélection des 2 meilleurs candidats AVEC DC, si l'utilisateur n'a pas
    // encore choisi (la description IA ne peut se générer que depuis un DC).
    if (!STATE.selectedCand[1] && !STATE.selectedCand[2]) {
      var withDc = arr.filter(function (c) {
        var full = findCandidate(c.id);
        return full && full.has_dc;
      });
      var pick1 = withDc[0] || arr[0];
      var pick2 = withDc[1] || arr[1];
      if (pick1) STATE.selectedCand[1] = pick1.id;
      if (pick2 && (!pick1 || pick2.id !== pick1.id)) STATE.selectedCand[2] = pick2.id;
    }
    renderCombos();
    renderCandCards();
    autoGenerateSelectedDescriptions();
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

  // AI message generation removed (30.17) — tout passe par le template .msg + cartes candidats.

  // ─── Onglets ──────────────────────────────────────────────
  function setActiveTab(tab) {
    STATE.activeTab = tab;
    var bd = document.getElementById(MODAL_ID);
    if (!bd) return;
    bd.querySelectorAll('[data-v30pm-tab]').forEach(function (btn) {
      var active = btn.dataset.v30pmTab === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    var cnSection = bd.querySelector('[data-v30pm-callnote-section]');
    if (cnSection) cnSection.hidden = (tab !== 'suivi');
  }

  // ─── Accroche appel manqué (génération Ollama) ─────────────

  function _hasEnoughProfileData(p) {
    var fonction = safeStr(p.fonction).trim();
    var notes    = safeStr(p.notes).trim();
    var company  = (STATE.company && STATE.company.groupe) || safeStr(p.company_groupe).trim();
    return !!(fonction || notes.length > 20 || company);
  }

  function _buildRichCallNotePrompt(p) {
    var fonction = safeStr(p.fonction).trim();
    var notes    = safeStr(p.notes).trim();
    var company  = (STATE.company && STATE.company.groupe) || safeStr(p.company_groupe).trim();
    var site     = (STATE.company && STATE.company.site)   || safeStr(p.company_site).trim();

    // Construire les contraintes de personnalisation obligatoires
    var mustMention = [];
    if (fonction) mustMention.push('"' + fonction + '"');
    if (company)  mustMention.push('"' + company + '"');

    var ctx = '';
    if (company)  ctx += 'Entreprise : ' + company + (site ? ' (' + site + ')' : '') + '\n';
    if (fonction) ctx += 'Poste : ' + fonction + '\n';
    if (notes)    ctx += 'Notes : ' + (notes.length > 300 ? notes.slice(0, 300) + '…' : notes) + '\n';

    return 'Rédige UNE phrase d\'accroche email (15-22 mots) pour un cabinet de conseil, après un appel manqué.\n\n' +
      'PROFIL DU DESTINATAIRE :\n' + ctx + '\n' +
      (mustMention.length
        ? 'OBLIGATION ABSOLUE : la phrase DOIT inclure ' + mustMention.join(' et ') + '. Pas de phrase générique sans ces mots.\n\n'
        : '') +
      'La phrase commence par "Je souhaitais" ou "J\'ai essayé de vous joindre".\n' +
      'Elle montre que tu connais le poste du destinataire ou son secteur.\n\n' +
      'INTERDIT :\n' +
      '- Phrases vagues du type "quelques profils qui pourraient vous intéresser" sans mention du profil\n' +
      '- Inventions ou suppositions non fondées sur le profil fourni\n' +
      '- Formules creuses ou flatterie\n\n' +
      'Réponds UNIQUEMENT avec la phrase. Rien d\'autre.';
  }

  function generateCallNote() {
    var p = STATE.prospect;
    if (!p) { toast('Prospect non chargé', 'warning'); return; }

    var btn = $sel('data-v30pm-callnote-gen');
    var ta  = $sel('data-v30pm-callnote');
    var st  = $sel('data-v30pm-callnote-status');
    if (btn) btn.disabled = true;
    if (st)  { st.textContent = 'Génération en cours…'; st.className = 'v30pm-callnote__status'; }
    if (ta)  ta.value = '';
    STATE.callNote = '';

    // Garde-fou : callOllama peut être absent si la page ne charge pas ollama.js
    var callFn = (typeof window.callOllama === 'function')
      ? window.callOllama.bind(window)
      : function (prompt) {
          return fetch('/api/ollama/generate', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
          }).then(function (r) { return r.json(); })
            .then(function (j) {
              if (!j || j.ok === false) throw new Error(j && j.error || 'Erreur IA');
              return j.text || j.response || '';
            });
        };

    callFn(_buildRichCallNotePrompt(p))
      .then(function (text) {
        var raw = String(text || '').trim().replace(/^["«»""'']|["«»""'']$/g, '').trim();
        if (!raw.toLowerCase().startsWith('j\'ai') && !raw.toLowerCase().startsWith('je ')) {
          raw = 'Je souhaitais vous présenter quelques profils de consultants qui pourraient vous intéresser.';
        }
        if (ta) ta.value = raw;
        STATE.callNote = raw;
        if (st) {
          // Si peu de données : propose d'enrichir après la génération (non-bloquant)
          var hasData = _hasEnoughProfileData(p);
          st.innerHTML = hasData
            ? 'Phrase générée ✓'
            : 'Phrase générée ✓ — <a href="#" class="v30pm-enrich-link" data-v30pm-enrich-hint>Enrichir le profil</a> pour cibler davantage';
          st.className = 'v30pm-callnote__status is-ok';
          if (hasData) setTimeout(function () { if (st) st.textContent = ''; }, 3000);
        }
        toast('Accroche générée', 'success', 2000);
      }).catch(function (e) {
        if (st) { st.textContent = 'Erreur IA : ' + (e.message || 'inconnue'); st.className = 'v30pm-callnote__status is-error'; }
        toast('Génération IA échouée : ' + (e.message || 'inconnue'), 'error');
      }).then(function () {
        if (btn) btn.disabled = false;
      });
  }

  // ─── Popup d'enrichissement prospect (depuis push modal) ────

  var ENRICH_PANEL_ID = 'v30PushEnrichPanel';

  function showEnrichmentDialog(onEnriched) {
    _injectEnrichCSS();
    var existing = document.getElementById(ENRICH_PANEL_ID);
    if (existing) existing.parentNode.removeChild(existing);

    var panel = document.createElement('div');
    panel.id = ENRICH_PANEL_ID;
    panel.className = 'v30pm-enrich-overlay';
    panel.innerHTML =
      '<div class="v30pm-enrich-card">' +
        '<div class="v30pm-enrich-head">' +
          ic('sparkles', 14) + ' <strong>Enrichir le profil pour personnaliser</strong>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon v30pm-enrich-close" aria-label="Fermer">' + ic('x', 12) + '</button>' +
        '</div>' +
        '<p class="v30pm-enrich-hint">Pas assez d\'informations pour générer une accroche ciblée. Ajoute la <b>fonction</b> et/ou des <b>notes</b> sur ce prospect.</p>' +
        '<div class="v30pm-enrich-tabs">' +
          '<button type="button" class="v30pm-enrich-tab is-active" data-v30enrich-tab="manual">Saisie rapide</button>' +
          '<button type="button" class="v30pm-enrich-tab" data-v30enrich-tab="linkedin">Coller profil LinkedIn</button>' +
        '</div>' +
        // ─ Onglet saisie manuelle
        '<div class="v30pm-enrich-pane" data-v30enrich-pane="manual">' +
          '<label class="v30-field">' +
            '<span class="v30-field__label">Fonction / Poste</span>' +
            '<input type="text" class="v30-input" data-v30enrich-fonction placeholder="ex : Directeur Technique, DRH, DSI…" />' +
          '</label>' +
          '<label class="v30-field">' +
            '<span class="v30-field__label">Notes (secteur, contexte, projets…)</span>' +
            '<textarea class="v30-input" data-v30enrich-notes rows="3" placeholder="ex : Entreprise BTP 200 personnes, projets infrastructure, cherche à externaliser…"></textarea>' +
          '</label>' +
          '<div class="v30pm-enrich-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30enrich-cancel>Annuler</button>' +
            '<button type="button" class="btn btn-accent btn-sm" data-v30enrich-save-manual>' + ic('save', 12) + ' Enregistrer &amp; générer</button>' +
          '</div>' +
        '</div>' +
        // ─ Onglet LinkedIn
        '<div class="v30pm-enrich-pane" data-v30enrich-pane="linkedin" hidden>' +
          '<p class="v30pm-enrich-hint" style="margin-top:0;">Copie le contenu de la page LinkedIn du prospect et colle-le ci-dessous. L\'IA extraira automatiquement les informations utiles.</p>' +
          '<textarea class="v30-input v30pm-enrich-linkedin-ta" data-v30enrich-linkedin rows="6" placeholder="Colle ici le texte de la page LinkedIn (expérience, formation, résumé…)"></textarea>' +
          '<div class="v30pm-enrich-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30enrich-cancel>Annuler</button>' +
            '<button type="button" class="btn btn-accent-soft btn-sm" data-v30enrich-parse>' + ic('robot', 12) + ' Analyser via IA</button>' +
            '<button type="button" class="btn btn-accent btn-sm" data-v30enrich-save-linkedin hidden>' + ic('save', 12) + ' Appliquer &amp; générer</button>' +
          '</div>' +
          '<div class="v30pm-enrich-preview" data-v30enrich-preview hidden></div>' +
        '</div>' +
      '</div>';

    var bd = document.getElementById(MODAL_ID);
    if (bd) bd.appendChild(panel);
    else document.body.appendChild(panel);
    void panel.offsetWidth;
    panel.classList.add('is-open');

    // Préfill avec les données actuelles
    var p = STATE.prospect || {};
    var fonctionEl = panel.querySelector('[data-v30enrich-fonction]');
    var notesEl    = panel.querySelector('[data-v30enrich-notes]');
    if (fonctionEl && p.fonction) fonctionEl.value = p.fonction;
    if (notesEl    && p.notes)    notesEl.value    = p.notes;

    var parsedData = null;

    function closePanel() {
      panel.classList.remove('is-open');
      setTimeout(function () { if (panel.parentNode) panel.parentNode.removeChild(panel); }, 200);
    }

    // Onglets enrichissement
    panel.querySelectorAll('[data-v30enrich-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.dataset.v30enrichTab;
        panel.querySelectorAll('[data-v30enrich-tab]').forEach(function (t) { t.classList.toggle('is-active', t.dataset.v30enrichTab === target); });
        panel.querySelectorAll('[data-v30enrich-pane]').forEach(function (pane) { pane.hidden = pane.dataset.v30enrichPane !== target; });
        parsedData = null;
      });
    });

    panel.querySelector('.v30pm-enrich-close').addEventListener('click', closePanel);
    panel.querySelectorAll('[data-v30enrich-cancel]').forEach(function (btn) { btn.addEventListener('click', closePanel); });

    // Enregistrer saisie manuelle
    panel.querySelector('[data-v30enrich-save-manual]').addEventListener('click', function () {
      var fonctionVal = (fonctionEl && fonctionEl.value.trim()) || '';
      var notesVal    = (notesEl    && notesEl.value.trim())    || '';
      if (!fonctionVal && !notesVal) { toast('Saisis au moins la fonction ou des notes', 'warning'); return; }
      var updates = {};
      if (fonctionVal) updates.fonction = fonctionVal;
      if (notesVal)    updates.notes    = notesVal;
      _enrichSave(updates, function () {
        closePanel();
        if (onEnriched) onEnriched();
      });
    });

    // Parsing LinkedIn via IA
    panel.querySelector('[data-v30enrich-parse]').addEventListener('click', function () {
      var linkedinText = (panel.querySelector('[data-v30enrich-linkedin]') || {}).value || '';
      if (!linkedinText.trim()) { toast('Colle d\'abord le texte LinkedIn', 'warning'); return; }
      var parseBtn = panel.querySelector('[data-v30enrich-parse]');
      var saveLinkedinBtn = panel.querySelector('[data-v30enrich-save-linkedin]');
      var preview = panel.querySelector('[data-v30enrich-preview]');
      if (parseBtn) { parseBtn.disabled = true; parseBtn.textContent = 'Analyse en cours…'; }
      if (preview)  { preview.hidden = true; preview.innerHTML = ''; }
      if (saveLinkedinBtn) saveLinkedinBtn.hidden = true;
      parsedData = null;
      _enrichFromLinkedIn(linkedinText, function (data) {
        if (parseBtn) { parseBtn.disabled = false; parseBtn.innerHTML = ic('robot', 12) + ' Relancer l\'IA'; }
        if (!data) { toast('L\'IA n\'a pas pu extraire les informations', 'error'); return; }
        parsedData = data;
        if (preview) {
          preview.hidden = false;
          var lines = [];
          if (data.fonction) lines.push('<b>Fonction :</b> ' + esc(data.fonction));
          if (data.notes)    lines.push('<b>Notes :</b> '    + esc(data.notes));
          if (data.tags && data.tags.length) lines.push('<b>Tags :</b> ' + esc(data.tags.join(', ')));
          preview.innerHTML = '<div class="v30pm-enrich-preview-inner">' + lines.join('<br>') + '</div>';
        }
        if (saveLinkedinBtn) saveLinkedinBtn.hidden = false;
        toast('Informations extraites — vérifie avant d\'appliquer', 'success', 3000);
      });
    });

    // Appliquer + générer depuis parsing LinkedIn
    panel.querySelector('[data-v30enrich-save-linkedin]').addEventListener('click', function () {
      if (!parsedData) { toast('Relance l\'analyse IA d\'abord', 'warning'); return; }
      var updates = {};
      if (parsedData.fonction) updates.fonction = parsedData.fonction;
      if (parsedData.notes)    updates.notes    = parsedData.notes;
      _enrichSave(updates, function () {
        // Sauvegarde aussi les tags si présents
        if (parsedData.tags && parsedData.tags.length) {
          postJSON('/api/prospects/bulk-status-tags', { ids: [STATE.prospectId], add_tags: parsedData.tags })
            .catch(function () {});
        }
        closePanel();
        if (onEnriched) onEnriched();
      });
    });
  }

  function _enrichSave(updates, cb) {
    if (!STATE.prospectId || !updates || !Object.keys(updates).length) { if (cb) cb(); return; }
    postJSON('/api/prospects/bulk-edit', { ids: [STATE.prospectId], fields: updates })
      .then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || 'Erreur sauvegarde');
        // Mettre à jour STATE.prospect localement pour que la génération profite des nouvelles données
        if (STATE.prospect) Object.assign(STATE.prospect, updates);
        toast('Profil mis à jour', 'success', 2000);
        if (cb) cb();
      })
      .catch(function (e) { toast('Erreur enregistrement : ' + (e.message || 'inconnue'), 'error'); });
  }

  function _enrichFromLinkedIn(text, cb) {
    var prompt =
      'Extrait les informations professionnelles depuis ce texte de profil LinkedIn.\n' +
      'Retourne UNIQUEMENT un objet JSON avec les clés suivantes (omets celles que tu ne trouves pas) :\n' +
      '- fonction : string (titre/poste actuel)\n' +
      '- notes : string (résumé en 1-3 phrases : secteur, expérience clé, contexte pertinent)\n' +
      '- tags : array de strings (secteurs/domaines : ex ["BTP", "Ingénierie", "Infrastructure"])\n\n' +
      'Texte LinkedIn :\n' + text.slice(0, 3000) + '\n\n' +
      'Réponds UNIQUEMENT avec le JSON brut, sans explications.';
    // Utilise le helper unifié (provider-agnostic), timeout 180 s par défaut
    window.callOllama(prompt)
      .then(function (raw) {
        var m = (raw || '').match(/\{[\s\S]*\}/);
        if (!m) { cb(null); return; }
        try { cb(JSON.parse(m[0])); }
        catch (_) { cb(null); }
      })
      .catch(function () { cb(null); });
  }

  var _enrichCSSInjected = false;
  function _injectEnrichCSS() {
    if (_enrichCSSInjected) return;
    _enrichCSSInjected = true;
    var s = document.createElement('style');
    s.textContent = [
      '.v30pm-enrich-overlay{position:absolute;inset:0;background:color-mix(in oklch,var(--surface) 60%,transparent);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center;z-index:10;border-radius:inherit;opacity:0;transition:opacity .18s ease;pointer-events:none;}',
      '.v30pm-enrich-overlay.is-open{opacity:1;pointer-events:auto;}',
      '.v30pm-enrich-card{width:100%;background:var(--surface);border-top:1px solid var(--border);border-radius:0 0 var(--r-xl) var(--r-xl);padding:16px 20px 20px;display:flex;flex-direction:column;gap:10px;box-shadow:0 -4px 20px color-mix(in oklch,var(--text) 8%,transparent);transform:translateY(12px);transition:transform .18s ease;max-height:90%;overflow-y:auto;}',
      '.v30pm-enrich-overlay.is-open .v30pm-enrich-card{transform:translateY(0);}',
      '.v30pm-enrich-head{display:flex;align-items:center;gap:6px;font-size:14px;}',
      '.v30pm-enrich-head .v30pm-enrich-close{margin-left:auto;}',
      '.v30pm-enrich-hint{font-size:12.5px;color:var(--text-2);margin:0;line-height:1.5;}',
      '.v30pm-enrich-tabs{display:flex;gap:2px;padding:3px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-lg);}',
      '.v30pm-enrich-tab{flex:1;height:28px;padding:0 10px;border:none;border-radius:calc(var(--r-lg) - 2px);background:transparent;color:var(--text-2);font:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:background var(--dur-1),color var(--dur-1);}',
      '.v30pm-enrich-tab.is-active{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 3px color-mix(in oklch,var(--text) 10%,transparent);}',
      '.v30pm-enrich-pane{display:flex;flex-direction:column;gap:8px;}',
      '.v30pm-enrich-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:2px;}',
      '.v30pm-enrich-linkedin-ta{min-height:90px;resize:vertical;font-size:12px;}',
      '.v30pm-enrich-preview{background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 12px;}',
      '.v30pm-enrich-preview-inner{font-size:12.5px;line-height:1.6;color:var(--text-2);}'
    ].join('');
    document.head.appendChild(s);
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
    // Message section retirée en 30.17 — tout le contenu passe par le
    // template .msg Outlook. On concatène les présentations par candidat
    // (description_push) dans le body du log pour la trace.
    var customMessage = '';
    [1, 2].forEach(function (slot) {
      var cid = STATE.selectedCand[slot];
      if (!cid) return;
      var cc = findCandidate(cid);
      var d = cachedDesc(cid);
      if (d) {
        if (customMessage) customMessage += '\n\n';
        customMessage += '— ' + ((cc && cc.name) || ('Candidat ' + slot)) + ' —\n' + d;
      }
    });
    var companyName = (STATE.company && STATE.company.groupe) || '';
    var templateName = '';
    var emailOutlookDraft = false;
    var emailOutlookMessage = '';
    var emailEmlDownloaded = false;
    var emailPjCount = 0;
    var emailExpectedPjCount = 0;

    var chain = Promise.resolve();

    if (channel === 'email') {
      chain = chain.then(function () { return copyText(p.email); });
      if (vals.catId) {
        chain = chain.then(function () {
          return fetchJSON('/api/push-categories/' + vals.catId + '/files').then(function (fdata) {
            if (fdata && fdata.ok && fdata.files && fdata.files.length) {
              templateName = fdata.files[0].name;
            } else {
              toast('Aucun fichier template (.msg/.eml) dans cette catégorie.', 'warning', 4000);
            }
          }).catch(function (e) {
            toast('Erreur réseau : ' + e.message, 'warning');
          });
        });
      }
      // Générer le mail Outlook (.eml téléchargé ou brouillon Outlook) avec DC candidats en PJ
      // via /api/push/generate.
      chain = chain.then(function () {
        if (!vals.catId || !templateName) return null;
        // Synchronise l'accroche depuis la textarea si l'utilisateur a édité manuellement
        var cnTa = document.querySelector('#' + MODAL_ID + ' [data-v30pm-callnote]');
        if (cnTa) STATE.callNote = cnTa.value || '';
        var callNote = (STATE.activeTab === 'suivi') ? (STATE.callNote || '') : '';
        var genPayload = {
          prospect_id: p.id,
          category_id: parseInt(vals.catId, 10),
          template_filename: templateName,
          candidate_id1: vals.candidateId1 ? parseInt(vals.candidateId1, 10) : null,
          candidate_id2: vals.candidateId2 ? parseInt(vals.candidateId2, 10) : null,
          ai_descriptions: true,
          call_note: callNote || null
        };
        return fetch('/api/push/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(genPayload)
        }).then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (err) {
              throw new Error((err && (err.error || err.message)) || ('HTTP ' + res.status));
            });
          }
          var ct = res.headers.get('content-type') || '';
          if (ct.indexOf('application/json') >= 0) {
            return res.json().then(function (data) {
              emailOutlookDraft = true;
              emailOutlookMessage = (data && data.message) || 'Brouillon Outlook créé';
              emailPjCount = (data && typeof data.pj_count === 'number') ? data.pj_count : 0;
              emailExpectedPjCount = [vals.candidateId1, vals.candidateId2].filter(Boolean).length;
            });
          }
          emailPjCount = parseInt(res.headers.get('X-PJ-Count') || '0', 10) || 0;
          emailExpectedPjCount = parseInt(res.headers.get('X-Candidate-Count') || '0', 10)
            || [vals.candidateId1, vals.candidateId2].filter(Boolean).length;
          return res.blob().then(function (blob) {
            if (!blob || blob.size === 0) throw new Error('Fichier email vide');
            var cd = res.headers.get('content-disposition') || '';
            var fn = cd.match(/filename[^;=\n]*=(['"]?)([^'";\n]*)\1/);
            var fileName = fn ? fn[2] : ('push_' + (p.name || 'prospect') + '.eml');
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = fileName;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            emailEmlDownloaded = true;
          });
        }).catch(function (e) {
          toast('Erreur génération email : ' + (e.message || 'inconnue'), 'error', 6000);
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

    var sentAt = new Date().toISOString();
    chain = chain.then(function (linkedInText) {
      // Logger le push
      var body = {
        prospect_id: p.id,
        sentAt: sentAt,
        channel: channel,
        to_email: channel === 'email' ? p.email : null,
        subject: channel === 'email' ? ((emailOutlookDraft || emailEmlDownloaded) ? ('Push ' + companyName) : (customMessage ? 'Push IA personnalisé' : 'Push manuel')) : null,
        body: channel === 'email' ? ((emailOutlookDraft || emailEmlDownloaded) ? ('Template: ' + templateName) : (customMessage || '')) : (customMessage || linkedInText || ''),
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
        var pjMissing = emailExpectedPjCount > emailPjCount;
        if (emailOutlookDraft) {
          var okMsg = (emailOutlookMessage || 'Brouillon Outlook créé') + ' — Email ' + p.email + ' copié.';
          if (pjMissing) {
            toast(okMsg + ' ⚠ DC manquants (' + emailPjCount + '/' + emailExpectedPjCount + ') — vérifiez que le PDF est bien uploadé pour chaque candidat.', 'warning', 8000);
          } else {
            toast(okMsg, 'success', 6000);
          }
        } else if (emailEmlDownloaded) {
          var dlMsg = 'Email .eml téléchargé (' + emailPjCount + ' PJ) — ouvrir pour envoyer. Email ' + p.email + ' copié.';
          if (pjMissing) {
            toast(dlMsg + ' ⚠ DC manquants (' + emailPjCount + '/' + emailExpectedPjCount + ').', 'warning', 8000);
          } else {
            toast(dlMsg, 'success', 6000);
          }
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
    STATE.aiExplanations = {};
    STATE.selectedCand = { 1: null, 2: null };
    STATE.candDescCache = {};
    STATE.categories = [];
    STATE.activeTab = 'classique';
    STATE.callNote = '';
    STATE.aiPlanSteps = {};
    STATE.catPreset = false;
    STATE.userPickedCat = false;
    var bd = ensureModal();
    // Titre dynamique
    var title = bd.querySelector('[data-v30pm-title]');
    if (title) title.textContent = STATE.channel === 'linkedin' ? 'Push LinkedIn' : 'Push Email';
    // Skeletons immédiats
    renderProspectSkeleton();
    renderSelectLoading(bd.querySelector('[data-v30pm-cat]'), '…');
    renderCombos();      // affiche l'état vide « aucun candidat disponible »
    renderCandCards();   // affiche le hint « sélectionne un candidat… »
    var aiPanel = bd.querySelector('[data-v30pm-aiplan]');
    if (aiPanel) aiPanel.hidden = true;
    setActiveTab('classique');
    // Vider l'accroche de la session précédente
    var cnTa = bd.querySelector('[data-v30pm-callnote]');
    if (cnTa) cnTa.value = '';
    var cnSt = bd.querySelector('[data-v30pm-callnote-status]');
    if (cnSt) { cnSt.textContent = ''; cnSt.className = 'v30pm-callnote__status'; }
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
        // Lancer le plan IA : profil → recherche web → secteur → catégorie →
        // candidats, diffusé en SSE et affiché étape par étape. Si une catégorie
        // est déjà choisie, le plan la conserve plutôt que de la deviner.
        var catSel = $sel('data-v30pm-cat');
        var catId = catSel && catSel.value ? catSel.value : null;
        STATE.catPreset = !!catId;
        var catObj = findCategory(catId);
        if (catObj && catObj.no_candidates) return null;
        runAIPlan(catId);
        return null;
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
