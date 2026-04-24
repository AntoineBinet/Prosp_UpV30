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
              // Cartes description par candidat (apparaissent quand sélectionné)
              '<div class="v30pm-candcards" data-v30pm-candcards></div>' +
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
        // Nouvelle passe IA pour la catégorie choisie
        var cat = $sel('data-v30pm-cat');
        loadAISuggestions(cat && cat.value ? cat.value : null);
      }
    });
    // Auto-save description candidat (onBlur)
    bd.addEventListener('blur', function (e) {
      var ta = e.target.closest('[data-v30pm-desc]');
      if (ta) {
        var id = Number(ta.dataset.v30pmDesc);
        if (id) saveCandDesc(id, ta.value || '');
      }
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
    function row(c, slot, extraCls, pct) {
      var dcPill = c.has_dc
        ? '<span class="v30pm-combo__dc v30pm-combo__dc--ok" title="DC disponible">' + ic('checkCircle', 10) + '</span>'
        : '<span class="v30pm-combo__dc v30pm-combo__dc--ko" title="Pas de DC">' + ic('x', 10) + '</span>';
      var pctPill = (pct != null && pct > 0)
        ? '<span class="v30pm-combo__pct" title="Score de pertinence">' + Math.round(pct) + '%</span>'
        : '';
      return '<button type="button" class="v30pm-combo__opt ' + (extraCls || '') + '" role="option" data-v30pm-opt-id="' + c.id + '" data-v30pm-opt-slot="' + slot + '">' +
        dcPill +
        '<span class="v30pm-combo__opt-body">' +
          '<span class="v30pm-combo__opt-name">' + esc(c.name || '') + '</span>' +
          (c.role ? '<span class="v30pm-combo__opt-role">' + esc(c.role) + '</span>' : '') +
        '</span>' +
        pctPill +
      '</button>';
    }
    function section(label, list, slot, cls) {
      if (!list.length) return '';
      return '<div class="v30pm-combo__group"><div class="v30pm-combo__group-label">' + label + '</div>' +
        list.map(function (item) {
          if (item && typeof item === 'object' && 'candidate' in item) {
            return row(item.candidate, slot, cls, item.pct);
          }
          return row(item, slot, cls);
        }).join('') +
      '</div>';
    }
    return function (slot) {
      // aiSuggestions : array de {id, pct}. On résout les candidats correspondants.
      var suggested = (STATE.aiSuggestions || []).map(function (s) {
        var c = findCandidate(s.id != null ? s.id : s);
        return c ? { candidate: c, pct: (s && s.pct) || 0 } : null;
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
    slots.forEach(function (slot) {
      var id = STATE.selectedCand[slot];
      if (!id) return;
      var c = findCandidate(id);
      if (!c) return;
      var desc = cachedDesc(id);
      var noDc = !c.has_dc;
      var cls = 'v30pm-candcard' + (noDc ? ' v30pm-candcard--no-dc' : '');
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
                : '<button type="button" class="v30pm-candcard__regen" data-v30pm-regen="' + id + '" aria-label="Régénérer la description IA depuis le DC">' +
                    ic('robot', 11) + ' ' + (desc ? 'Régénérer' : 'Générer IA') +
                  '</button>') +
            '</div>' +
          '</div>' +
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
      // On garde les 5 meilleurs avec leur score (relevance_pct 0-100)
      STATE.aiSuggestions = arr.slice(0, 5).map(function (c) {
        return { id: c.id, pct: (c.relevance_pct != null ? c.relevance_pct : c.pct) || 0 };
      });
      // Si certains candidats suggérés ne sont pas dans allCandidates (filtrage
      // serveur différent), on les ajoute pour pouvoir les afficher.
      arr.forEach(function (c) {
        if (!findCandidate(c.id)) STATE.allCandidates.push(c);
      });
      // 30.17 : auto-sélection des 2 meilleurs candidats AVEC DC (si l'user
      // n'a pas encore fait son propre choix). On saute les candidats sans DC
      // pour la pré-sélection automatique, car la description IA ne peut pas
      // être générée sans DC.
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
      // 30.17 : déclenche en arrière-plan la génération de description pour
      // les candidats sélectionnés qui n'en ont pas encore.
      autoGenerateSelectedDescriptions();
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

  // AI message generation removed (30.17) — tout passe par le template .msg + cartes candidats.


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
      // via /api/push/generate — reprise du comportement v29.
      chain = chain.then(function () {
        if (!vals.catId || !templateName) return null;
        var genPayload = {
          prospect_id: p.id,
          category_id: parseInt(vals.catId, 10),
          template_filename: templateName,
          candidate_id1: vals.candidateId1 ? parseInt(vals.candidateId1, 10) : null,
          candidate_id2: vals.candidateId2 ? parseInt(vals.candidateId2, 10) : null,
          ai_descriptions: true
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

    var sentAt = todayISO();
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
    STATE.selectedCand = { 1: null, 2: null };
    STATE.candDescCache = {};
    var bd = ensureModal();
    // Titre dynamique
    var title = bd.querySelector('[data-v30pm-title]');
    if (title) title.textContent = STATE.channel === 'linkedin' ? 'Push LinkedIn' : 'Push Email';
    // Skeletons immédiats
    renderProspectSkeleton();
    renderSelectLoading(bd.querySelector('[data-v30pm-cat]'), '…');
    renderCombos();      // affiche l'état vide « aucun candidat disponible »
    renderCandCards();   // affiche le hint « sélectionne un candidat… »
    hideIABar();
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
        // Déclencher la passe IA inconditionnellement : même sans catégorie,
        // l'endpoint best-candidates score sur les tags/notes/fonction du prospect.
        // Si une catégorie est pré-sélectionnée, elle sera utilisée pour raffiner.
        var catSel = $sel('data-v30pm-cat');
        var catId = catSel && catSel.value ? catSel.value : null;
        return loadAISuggestions(catId);
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
