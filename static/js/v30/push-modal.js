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
          '<h2 class="v30-modal__title" id="v30PushModalTitle">' +
            ic('send', 14) + ' <span data-v30pm-title>Envoyer un push</span>' +
          '</h2>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30pm-close aria-label="Fermer">' + ic('x', 13) + '</button>' +
        '</div>' +
        '<div class="v30-modal__body" data-v30pm-body>' +
          '<div class="v30-pm-prospect" data-v30pm-prospect></div>' +
          '<label class="v30-field">' +
            '<span class="v30-field__label">Catégorie push (optionnel)</span>' +
            '<select class="v30-input" data-v30pm-cat><option value="">Chargement…</option></select>' +
          '</label>' +
          '<div class="v30-field-grid">' +
            '<label class="v30-field">' +
              '<span class="v30-field__label">Candidat 1 (optionnel)</span>' +
              '<select class="v30-input" data-v30pm-cand1><option value="">Chargement…</option></select>' +
            '</label>' +
            '<label class="v30-field">' +
              '<span class="v30-field__label">Candidat 2 (optionnel)</span>' +
              '<select class="v30-input" data-v30pm-cand2><option value="">Chargement…</option></select>' +
            '</label>' +
          '</div>' +
          '<div class="v30-field-grid">' +
            '<label class="v30-field">' +
              '<span class="v30-field__label">Consultant 1 (optionnel)</span>' +
              '<select class="v30-input" data-v30pm-cons1><option value="">Chargement…</option></select>' +
            '</label>' +
            '<label class="v30-field">' +
              '<span class="v30-field__label">Consultant 2 (optionnel)</span>' +
              '<select class="v30-input" data-v30pm-cons2><option value="">Chargement…</option></select>' +
            '</label>' +
          '</div>' +
          '<label class="v30-field">' +
            '<span class="v30-field__label">Message personnalisé (optionnel — IA)</span>' +
            '<textarea class="v30-input" data-v30pm-message rows="6" placeholder="Le message sera généré automatiquement par l\'IA ou vous pouvez le saisir manuellement…" style="resize:vertical;font-family:inherit;"></textarea>' +
            '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-v30pm-ai="1">' + ic('robot', 12) + ' Générer avec l\'IA</button>' +
              '<button type="button" class="btn btn-ghost btn-sm" data-v30pm-ai="3">' + ic('refreshCw', 12) + ' 3 variantes</button>' +
            '</div>' +
          '</label>' +
        '</div>' +
        '<div class="v30-modal__foot">' +
          '<div class="v30-spacer"></div>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30pm-close>Annuler</button>' +
          '<button type="button" class="btn btn-accent btn-sm" data-v30pm-send>' + ic('send', 13) + ' Envoyer</button>' +
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
    });
    bd.addEventListener('change', function (e) {
      if (e.target.closest('[data-v30pm-cat]')) {
        // Recharger best-candidates avec la catégorie choisie
        reloadBestCandidates();
      }
    });
    // Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && bd.classList.contains('is-open')) close();
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
    // On utilise /api/data en dernier ressort car certaines pages v30 ont déjà
    // un prospect chargé ; mais pour la page v30 prospect_detail on n'a pas
    // besoin d'une autre requête, et pour les pages liste on peut utiliser la
    // même endpoint que le reste de l'app.
    // On interroge /api/prospect/<id>/timeline (renvoie prospect + events) car
    // il est déjà consommé par la v30 prospect_detail.
    return fetchJSON('/api/prospect/' + prospectId + '/timeline').then(function (res) {
      var p = (res && res.prospect) || null;
      if (!p) throw new Error('Prospect introuvable');
      return {
        prospect: p,
        company: (res && res.company) || null
      };
    });
  }

  // ─── Populate selects ─────────────────────────────────────
  function $sel(attr) { return document.querySelector('#' + MODAL_ID + ' [' + attr + ']'); }

  function renderProspectInfo() {
    var el = $sel('data-v30pm-prospect');
    if (!el) return;
    var p = STATE.prospect || {};
    var co = STATE.company || {};
    var chanLabel = STATE.channel === 'linkedin' ? 'LinkedIn' : 'Email';
    var dest = STATE.channel === 'linkedin' ? (p.linkedin || '—') : (p.email || '—');
    el.innerHTML =
      '<div class="v30-pm-prospect__row">' +
        '<span class="v30-pm-prospect__label">Prospect</span>' +
        '<span><b>' + esc(p.name || '—') + '</b>' +
          (p.fonction ? ' <span class="muted">· ' + esc(p.fonction) + '</span>' : '') +
          (co.groupe ? ' <span class="muted">· ' + esc(co.groupe) + '</span>' : '') +
        '</span>' +
      '</div>' +
      '<div class="v30-pm-prospect__row">' +
        '<span class="v30-pm-prospect__label">' + chanLabel + '</span>' +
        '<span class="mono">' + esc(dest) + '</span>' +
      '</div>';
  }

  function loadPushCategories() {
    var sel = $sel('data-v30pm-cat');
    if (!sel) return Promise.resolve();
    return fetchJSON('/api/push-categories').then(function (cats) {
      var list = Array.isArray(cats) ? cats : [];
      sel.innerHTML = '<option value="">— Aucune catégorie —</option>' +
        list.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
      var p = STATE.prospect || {};
      if (p.push_category_id) sel.value = String(p.push_category_id);
    }).catch(function () {
      sel.innerHTML = '<option value="">Erreur de chargement</option>';
    });
  }

  function loadBestCandidates(catId) {
    var sel1 = $sel('data-v30pm-cand1');
    var sel2 = $sel('data-v30pm-cand2');
    if (!sel1 || !sel2) return Promise.resolve();
    sel1.innerHTML = '<option value="">Chargement…</option>';
    sel2.innerHTML = '<option value="">Chargement…</option>';
    var qs = catId ? ('?push_category_id=' + encodeURIComponent(catId)) : '';
    return fetchJSON('/api/prospect/' + STATE.prospectId + '/best-candidates' + qs).then(function (j) {
      var arr = (j && j.candidates) || [];
      STATE.candidates = arr;
      var options = '<option value="">— Aucun candidat —</option>' +
        arr.map(function (c) {
          var label = (c.name || '') + (c.role ? ' — ' + c.role : '');
          return '<option value="' + c.id + '">' + esc(label) + '</option>';
        }).join('');
      sel1.innerHTML = options;
      sel2.innerHTML = options;
      // Pré-sélection si la catégorie a des candidats par défaut
      if (j && j.category_default_candidates && arr.length) {
        var def1 = j.category_default_candidates[0];
        var def2 = j.category_default_candidates[1];
        if (def1) sel1.value = String(def1);
        if (def2) sel2.value = String(def2);
      }
    }).catch(function () {
      sel1.innerHTML = '<option value="">— Aucun candidat —</option>';
      sel2.innerHTML = '<option value="">— Aucun candidat —</option>';
    });
  }

  function reloadBestCandidates() {
    var cat = $sel('data-v30pm-cat');
    var catId = cat && cat.value ? cat.value : null;
    loadBestCandidates(catId);
  }

  function loadUsers() {
    var sel1 = $sel('data-v30pm-cons1');
    var sel2 = $sel('data-v30pm-cons2');
    if (!sel1 || !sel2) return Promise.resolve();
    return fetchJSON('/api/users/for-push').then(function (resp) {
      var users = Array.isArray(resp) ? resp : (resp && resp.users) || [];
      var currentUserId = resp && resp.current_user_id;
      STATE.users = users;
      STATE.currentUserId = currentUserId || null;
      var options = '<option value="">— Aucun consultant —</option>' +
        users.map(function (u) {
          var label = u.display_name || u.username || ('Utilisateur ' + u.id);
          return '<option value="' + u.id + '">' + esc(label) + '</option>';
        }).join('');
      sel1.innerHTML = options;
      sel2.innerHTML = options;
      if (currentUserId) sel1.value = String(currentUserId);
    }).catch(function () {
      sel1.innerHTML = '<option value="">— Aucun consultant —</option>';
      sel2.innerHTML = '<option value="">— Aucun consultant —</option>';
    });
  }

  // ─── AI generation ────────────────────────────────────────
  function selectedValuesMulti() {
    return {
      catId: ($sel('data-v30pm-cat') || {}).value || null,
      candidateId1: ($sel('data-v30pm-cand1') || {}).value || null,
      candidateId2: ($sel('data-v30pm-cand2') || {}).value || null,
      consultantId1: ($sel('data-v30pm-cons1') || {}).value || null,
      consultantId2: ($sel('data-v30pm-cons2') || {}).value || null
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

  function generateAI(variants) {
    if (typeof window.callOllama !== 'function') {
      toast("IA indisponible (app.js non chargée sur cette page).", 'warning');
      return;
    }
    var messageEl = $sel('data-v30pm-message');
    if (!messageEl) return;
    messageEl.value = variants > 1 ? 'Génération de ' + variants + ' variantes en cours…' : 'Génération en cours…';
    var prompt = buildAIPrompt(variants);
    var timeoutMs = variants > 1 ? 90000 : 60000;
    window.callOllama(prompt, { timeoutMs: timeoutMs, stream: false })
      .then(function (text) {
        if (!text) return;
        text = String(text).trim();
        if (variants > 1) {
          var parts = text.split(/Variante\s+\d+\s*:/i).filter(function (v) { return v.trim(); }).map(function (v) { return v.trim(); });
          if (parts.length >= variants) {
            messageEl.value = parts.slice(0, variants).map(function (v, i) {
              return '=== VARIANTE ' + (i + 1) + ' ===\n' + v;
            }).join('\n\n');
          } else {
            messageEl.value = text;
          }
          toast(variants + ' variantes générées', 'success', 3000);
        } else {
          messageEl.value = text;
          toast('Message généré avec IA', 'success', 3000);
        }
      })
      .catch(function (e) {
        toast('Erreur IA : ' + (e.message || 'inconnue'), 'error', 5000);
        if (messageEl) messageEl.value = '';
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
    var bd = ensureModal();
    // Titre dynamique
    var title = bd.querySelector('[data-v30pm-title]');
    if (title) title.textContent = STATE.channel === 'linkedin' ? 'Push LinkedIn' : 'Push Email';
    // Reset form
    ['data-v30pm-message'].forEach(function (a) { var el = bd.querySelector('[' + a + ']'); if (el) el.value = ''; });
    // Afficher info prospect en état chargement
    var info = bd.querySelector('[data-v30pm-prospect]');
    if (info) info.innerHTML = '<span class="muted">Chargement du prospect…</span>';
    openBd(bd);
    // Charger les données
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
      return Promise.all([
        loadPushCategories().then(function () {
          var catSel = $sel('data-v30pm-cat');
          var catId = catSel && catSel.value ? catSel.value : null;
          return loadBestCandidates(catId);
        }),
        loadUsers()
      ]);
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
