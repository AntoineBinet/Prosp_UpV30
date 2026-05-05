/* ProspUp v30 — Fiche prospect : rendu */
(function () {
  'use strict';
  var FP = window.ProspFP;
  if (!FP) return;

  function splitPhonesDetail(tel) {
    if (!tel) return [];
    var m = String(tel).match(/\+?\d[\d\s().-]{6,}\d/g);
    if (!m) return [];
    var seen = {};
    return m.map(function (s) { return s.trim().replace(/\s+/g, ' '); })
      .filter(function (s) { if (seen[s]) return false; seen[s] = true; return true; });
  }
  function normTelDetail(ph) {
    var plus = String(ph).charAt(0) === '+';
    var r = String(ph).replace(/[^\d]/g, '');
    return plus ? '+' + r : r;
  }

  function renderHeader(p) {
    var h = FP.$('[data-v30-fp-header]');
    if (!h || !p) return;
    var av = h.querySelector('[data-field="initials"]');
    if (av) av.textContent = FP.initials(p.name);
    var name = h.querySelector('[data-field="name"]');
    if (name) name.textContent = p.name || '—';
    var pill = h.querySelector('[data-field="statut-pill"]');
    if (pill) {
      pill.innerHTML = p.statut
        ? '<span class="status ' + FP.statusClass(p.statut) + '">' + FP.esc(p.statut) + '</span>'
        : '';
    }
    var meta = h.querySelector('[data-field="meta"]');
    if (meta) {
      var parts = [];
      if (p.fonction) parts.push(FP.esc(p.fonction));
      if (p.company_groupe) parts.push('chez <b>' + FP.esc(p.company_groupe) + '</b>');
      if (p.company_site) parts.push(FP.esc(p.company_site));
      if (p.lastContact) parts.push('<span class="mono">Dernière activité ' + FP.esc(FP.relativeTime(p.lastContact)) + '</span>');
      meta.innerHTML = parts.join(' · ') || '—';
    }
    var chips = h.querySelector('[data-field="chips"]');
    if (chips) {
      var c = '';
      if (p.email)     c += '<span class="badge">' + FP.esc(p.email) + '</span> ';
      if (p.telephone) c += '<span class="badge mono">' + FP.esc(p.telephone) + '</span> ';
      if (p.linkedin)  c += '<a class="badge" href="' + FP.esc(p.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>';
      chips.innerHTML = c || '<span class="muted" style="font-size:11.5px;">Aucun contact.</span>';
    }
    var telBtn = h.querySelector('[data-field="tel-link"]');
    if (telBtn) {
      if (p.telephone) {
        telBtn.hidden = false;
        var fpPhones = splitPhonesDetail(p.telephone);
        function logFpCall() {
          fetch('/api/prospect/log-call', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: p.id })
          }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              if (!d || !d.ok || !d.lastContact) return;
              p.lastContact = d.lastContact;
              var aside = FP.$('[data-field="aside-last"]');
              if (aside) aside.textContent = FP.relativeTime(d.lastContact);
            }).catch(function () {});
        }
        if (fpPhones.length > 1) {
          telBtn.href = '#';
          telBtn.onclick = function (ev) {
            ev.preventDefault();
            var existing = document.querySelector('[data-v30-fp-tel-pick]');
            if (existing) { existing.remove(); return; }
            var pick = document.createElement('div');
            pick.setAttribute('data-v30-fp-tel-pick', '');
            pick.className = 'popover v30-pp-tel-drop';
            pick.style.cssText = 'position:fixed;z-index:200;min-width:180px;';
            var rect = telBtn.getBoundingClientRect();
            pick.style.top = (rect.bottom + 4) + 'px';
            pick.style.left = rect.left + 'px';
            fpPhones.forEach(function (ph) {
              var a = document.createElement('a');
              a.className = 'popover__item v30-pp-tel-opt';
              a.href = 'tel:' + normTelDetail(ph);
              a.textContent = ph;
              a.addEventListener('click', function () { logFpCall(); pick.remove(); });
              pick.appendChild(a);
            });
            document.body.appendChild(pick);
            setTimeout(function () {
              function closeP(ev2) {
                if (!pick.contains(ev2.target) && ev2.target !== telBtn) {
                  pick.remove();
                  document.removeEventListener('click', closeP);
                }
              }
              document.addEventListener('click', closeP);
            }, 10);
          };
        } else {
          telBtn.href = 'tel:' + (fpPhones.length ? normTelDetail(fpPhones[0]) : String(p.telephone).replace(/\s/g, ''));
          telBtn.onclick = logFpCall;
        }
      } else {
        telBtn.hidden = false;
        telBtn.setAttribute('aria-disabled', 'true');
        telBtn.setAttribute('title', 'Aucun numéro renseigné');
        telBtn.removeAttribute('href');
        telBtn.onclick = function(ev) { ev.preventDefault(); };
      }
    }
    document.title = (p.name || 'Fiche') + " — Prosp'Up v30";
  }

  function renderAside(p) {
    if (!p) return;
    var set = function (sel, value) {
      var el = FP.$(sel);
      if (el) el.textContent = value || '—';
    };
    set('[data-field="aside-company-name"]', p.company_groupe
      ? (p.company_groupe + (p.company_site ? ' · ' + p.company_site : ''))
      : null);
    set('[data-field="aside-fonction"]', p.fonction);
    set('[data-field="aside-email"]',    p.email);
    set('[data-field="aside-tel"]',      p.telephone);
    set('[data-field="aside-next-rdv"]', FP.shortDate(p.nextFollowUp || p.rdvDate));
    set('[data-field="aside-last"]',     FP.relativeTime(p.lastContact));

    var statutEl = FP.$('[data-field="aside-statut"]');
    if (statutEl) {
      statutEl.innerHTML = p.statut
        ? '<span class="status ' + FP.statusClass(p.statut) + '">' + FP.esc(p.statut) + '</span>'
        : '—';
    }

    var pertEl = FP.$('[data-field="aside-pertinence"]');
    if (pertEl) {
      var n = Math.max(0, Math.min(5, Number(p.pertinence) || 0));
      var h = '';
      for (var i = 1; i <= 5; i++) {
        h += '<span style="display:inline-block;width:4px;height:10px;border-radius:1px;background:' +
             (i <= n ? 'var(--accent)' : 'var(--surface-3)') + ';margin-right:2px;"></span>';
      }
      pertEl.innerHTML = h;
    }

    var liEl = FP.$('[data-field="aside-linkedin"]');
    if (liEl) {
      liEl.innerHTML = p.linkedin
        ? '<a href="' + FP.esc(p.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>'
        : '—';
    }

    var tagsHost = FP.$('[data-field="aside-tags"]');
    if (tagsHost) {
      var tags = FP.parseTags(p.tags);
      tagsHost.innerHTML = tags.length
        ? tags.map(function (t) { return '<span class="badge badge-accent">' + FP.esc(t) + '</span>'; }).join(' ')
        : '<span class="muted" style="font-size:11.5px;">Aucun tag.</span>';
    }

    var notesEl = FP.$('[data-field="notes"]');
    if (notesEl) notesEl.textContent = p.notes || '';

    // Bloc aside "Activité" : prochaine action + tâches en attente
    var asideAct = FP.$('[data-v30-aside-activity]');
    if (asideAct) {
      var summary = FP.STATE.activity_summary || {};
      var blocks = [];
      if (summary.next_action) {
        var fromHtml = '';
        if (summary.next_action_from || summary.next_action_date) {
          var src = [];
          if (summary.next_action_from) src.push(FP.esc(summary.next_action_from));
          if (summary.next_action_date) src.push(FP.esc(summary.next_action_date));
          fromHtml = '<div class="v30-fp-aside-next-action__from">' + src.join(' · ') + '</div>';
        }
        blocks.push(
          '<div class="v30-fp-aside-next-action">' +
            '<div class="v30-fp-aside-next-action__label">Prochaine action</div>' +
            '<div class="v30-fp-aside-next-action__text">' + FP.esc(summary.next_action).replace(/\n/g,'<br>') + '</div>' +
            fromHtml +
          '</div>'
        );
      }
      if (summary.pending_tasks) {
        blocks.push(
          '<button type="button" class="v30-fp-aside-pending" data-v30-goto-cr-tab>' +
            '⏳ ' + summary.pending_tasks + ' tâche' + (summary.pending_tasks > 1 ? 's' : '') + ' en attente' +
          '</button>'
        );
      }
      if (blocks.length) {
        asideAct.style.display = 'flex';
        asideAct.innerHTML = blocks.join('');
      } else {
        asideAct.style.display = 'none';
        asideAct.innerHTML = '';
      }
    }
  }

  // ─── Timeline events ──────────────────────────────────────
  var DOT_COLOR = {
    push:         'var(--accent)',
    push_email:   'var(--accent)',
    push_linkedin:'var(--accent)',
    rdv_taken:    'oklch(0.50 0.15 280)',
    reunion_tech: 'oklch(0.50 0.15 280)',
    contrat_signe:'var(--success)',
    call:         'oklch(0.55 0.15 220)',
    call_note:    'oklch(0.55 0.15 220)',
    note:         'oklch(0.55 0.12 60)',
    status_change:'var(--success)',
    ia_scrap:     'oklch(0.60 0.15 295)',
    ia_before:    'oklch(0.60 0.15 295)',
    ia_after:     'oklch(0.60 0.15 295)',
    cr:           'oklch(0.55 0.15 25)',
    attachment:   'oklch(0.60 0.10 200)',
    event:        'var(--text-3)'
  };

  function evIsPush(e)  { return (e.type || '').startsWith('push'); }
  function evIsNote(e)  { return (e.type || '') === 'call_note' || (e.type || '') === 'note'; }
  function evIsCR(e)    { return (e.type || '') === 'cr'; }
  function evIsAttach(e){ return (e.type || '') === 'attachment'; }

  function fileIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  function fmtSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }

  // Construit le contenu enrichi d'un événement (panel d'expansion).
  function eventExpandHtml(e) {
    var type = e.type || '';
    var meta = e.meta || {};
    var html = '';

    if (type === 'cr') {
      // CR : afficher next_action, tâches en attente, tags, lien d'ouverture
      if (e.content) {
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Synthèse</span>' +
          '<span class="v30-fp-ev__expand-val">' + FP.esc(e.content).replace(/\n/g, '<br>') + '</span>' +
          '</div>';
      }
      if (meta.next_action) {
        html += '<div class="v30-fp-ev__next-action"><strong>Prochaine action</strong>' +
          FP.esc(meta.next_action).replace(/\n/g, '<br>') + '</div>';
      }
      if (meta.action_count) {
        var pending = meta.action_pending || 0;
        var done = (meta.action_count || 0) - pending;
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Tâches</span>' +
          '<span class="v30-fp-ev__expand-val">' + done + ' fait · <b>' + pending + ' en attente</b></span>' +
          '</div>';
      }
      if (meta.tags && meta.tags.length) {
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Tags</span>' +
          '<span class="v30-fp-ev__expand-val">' + meta.tags.map(function(t){ return '<span class="badge">' + FP.esc(t) + '</span>'; }).join(' ') + '</span>' +
          '</div>';
      }
      html += '<div class="v30-fp-ev__actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-ev-open-cr data-cr-id="' + FP.esc(e.id) + '">Ouvrir le CR</button>' +
        '</div>';
    } else if (type === 'attachment') {
      var customTitle = (meta && meta.custom_title) || '';
      var origName = (meta && meta.original_name) || '';
      html += '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Titre</span>' +
        '<span class="v30-fp-ev__expand-val">' +
          '<input type="text" class="v30-fp-tag-input" data-v30-att-title data-att-id="' + FP.esc(e.id) + '" value="' + FP.esc(customTitle) + '" placeholder="' + FP.esc(origName) + '" maxlength="120" style="width:100%;border-radius:var(--r-sm);">' +
        '</span>' +
        '</div>' +
        '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Fichier</span>' +
        '<span class="v30-fp-ev__expand-val" style="font-size:11.5px;color:var(--text-3);">' + FP.esc(origName || '—') + '</span>' +
        '</div>' +
        '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Type</span>' +
        '<span class="v30-fp-ev__expand-val">' + FP.esc(meta.mime_type || '—') + '</span>' +
        '</div>' +
        '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Taille</span>' +
        '<span class="v30-fp-ev__expand-val">' + FP.esc(fmtSize(meta.size)) + '</span>' +
        '</div>';
      // Tags (pills + input pour ajouter)
      var tagsHtml = '';
      (meta.tags || []).forEach(function (t) {
        tagsHtml += '<span class="v30-fp-tag-pill">' + FP.esc(t) +
          '<button type="button" class="v30-fp-tag-pill__rm" data-v30-att-tag-rm data-att-id="' + FP.esc(e.id) + '" data-tag="' + FP.esc(t) + '" aria-label="Retirer">×</button>' +
          '</span>';
      });
      tagsHtml += '<input type="text" class="v30-fp-tag-input" data-v30-att-tag-add data-att-id="' + FP.esc(e.id) + '" placeholder="+ tag" maxlength="30">';
      html += '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Tags</span>' +
        '<span class="v30-fp-ev__expand-val">' + tagsHtml + '</span>' +
        '</div>';
      // Description éditable
      html += '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Description</span>' +
        '<span class="v30-fp-ev__expand-val">' +
          '<input type="text" class="v30-fp-tag-input" data-v30-att-desc data-att-id="' + FP.esc(e.id) + '" value="' + FP.esc(e.content || '') + '" placeholder="Note (optionnel)" maxlength="200" style="width:100%;border-radius:var(--r-sm);">' +
        '</span>' +
        '</div>';
      html += '<div class="v30-fp-ev__actions">' +
        '<button type="button" class="btn btn-accent btn-sm" data-v30-ev-preview-file data-att-id="' + FP.esc(e.id) + '" data-att-name="' + FP.esc(meta.original_name || '') + '" data-att-mime="' + FP.esc(meta.mime_type || '') + '">Aperçu</button>' +
        '<a class="btn btn-ghost btn-sm" href="/api/prospect/attachments/' + FP.esc(e.id) + '/file" target="_blank" download>Télécharger</a>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-ev-delete-file data-att-id="' + FP.esc(e.id) + '" style="color:var(--red,oklch(0.55 0.20 15));">Supprimer</button>' +
        '</div>';
    } else if (type === 'call_note' || type === 'note') {
      // Note éditable — titre uniquement pour les events DB (call_note JSON n'a pas de titre)
      var titleField = '';
      if (type === 'note') {
        titleField =
          '<input type="text" data-v30-ev-edit-title maxlength="120" value="' + FP.esc(e.title || '') + '" ' +
          'placeholder="Titre (optionnel)" ' +
          'style="width:100%;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-1);font-family:inherit;margin-bottom:6px;">';
      }
      html += '<div class="v30-fp-ev__edit-form" data-v30-ev-edit-form>' +
        titleField +
        '<textarea data-v30-ev-edit-text>' + FP.esc(e.content || '') + '</textarea>' +
        '<div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end;">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-ev-cancel>Annuler</button>' +
          (type === 'call_note' && e.note_index != null
            ? '<button type="button" class="btn btn-ghost btn-sm" data-v30-ev-delete-note data-note-index="' + FP.esc(e.note_index) + '" style="color:var(--red,oklch(0.55 0.20 15));">Supprimer</button>'
            : (e.id ? '<button type="button" class="btn btn-ghost btn-sm" data-v30-ev-delete-event data-ev-id="' + FP.esc(e.id) + '" style="color:var(--red,oklch(0.55 0.20 15));">Supprimer</button>' : '')) +
          '<button type="button" class="btn btn-accent btn-sm" data-v30-ev-save data-ev-id="' + FP.esc(e.id || '') + '" data-ev-type="' + FP.esc(type) + '" data-note-index="' + FP.esc(e.note_index != null ? e.note_index : '') + '">Enregistrer</button>' +
        '</div>' +
      '</div>';
    } else if (type === 'push' || type === 'push_email' || type === 'push_linkedin') {
      var chan = (meta.channel) || (type === 'push_linkedin' ? 'linkedin' : 'email');
      html += '<div class="v30-fp-ev__expand-row">' +
        '<span class="v30-fp-ev__expand-label">Canal</span>' +
        '<span class="v30-fp-ev__expand-val">' + FP.esc(chan) + '</span></div>';
      if (meta.template) {
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Template</span>' +
          '<span class="v30-fp-ev__expand-val">' + FP.esc(meta.template) + '</span></div>';
      }
      if (meta.candidates && meta.candidates.length) {
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Consultants proposés</span>' +
          '<span class="v30-fp-ev__expand-val">' + meta.candidates.map(function(c){ return FP.esc(c); }).join(', ') + '</span></div>';
      }
      if (meta.consultants && meta.consultants.length) {
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Envoyé par</span>' +
          '<span class="v30-fp-ev__expand-val">' + meta.consultants.map(function(c){ return FP.esc(c); }).join(', ') + '</span></div>';
      }
    } else {
      // Autres types : juste le contenu si dispo
      if (e.content) {
        html += '<div class="v30-fp-ev__expand-row">' +
          '<span class="v30-fp-ev__expand-label">Détail</span>' +
          '<span class="v30-fp-ev__expand-val">' + FP.esc(e.content).replace(/\n/g, '<br>') + '</span></div>';
      }
      // Bouton supprimer pour les events DB
      if (e.source === 'event' && e.id) {
        html += '<div class="v30-fp-ev__actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-ev-delete-event data-ev-id="' + FP.esc(e.id) + '" style="color:var(--red,oklch(0.55 0.20 15));">Supprimer</button>' +
          '</div>';
      }
    }
    return html;
  }

  function eventMatchesSearch(e, q) {
    if (!q) return true;
    q = q.toLowerCase();
    var fields = [e.title, e.content];
    var meta = e.meta || {};
    if (meta.next_action) fields.push(meta.next_action);
    if (meta.original_name) fields.push(meta.original_name);
    if (meta.tags) fields.push((meta.tags || []).join(' '));
    if (meta.candidates) fields.push((meta.candidates || []).join(' '));
    if (meta.consultants) fields.push((meta.consultants || []).join(' '));
    if (meta.template) fields.push(meta.template);
    return fields.some(function (f) { return f && String(f).toLowerCase().indexOf(q) !== -1; });
  }

  function renderEvents(filter, hostSel, limit, opts) {
    opts = opts || {};
    var host = FP.$(hostSel);
    if (!host) return;
    var events = (FP.STATE.events || []).slice();
    var totalCount = events.length;
    if (filter === 'push') events = events.filter(evIsPush);
    else if (filter === 'note') events = events.filter(evIsNote);
    else if (filter === 'cr') events = events.filter(evIsCR);
    else if (filter === 'attachment') events = events.filter(evIsAttach);
    var q = (FP.STATE.searchQuery || '').trim();
    if (q) events = events.filter(function (e) { return eventMatchesSearch(e, q); });
    if (opts.reverse) events = events.slice().reverse();

    if (events.length === 0) {
      host.innerHTML = '<div class="empty">' + (q ? 'Aucun résultat pour "' + FP.esc(q) + '".' : 'Aucun événement.') + '</div>';
      return;
    }
    if (limit) events = events.slice(0, limit);
    host.innerHTML = events.map(function (e, idx) {
      var color = DOT_COLOR[e.type] || 'var(--text-3)';
      var when = FP.relativeTime(e.date);
      var title = e.title || (e.type || 'Événement');
      var body = e.content || '';
      var showBody = body && !evIsCR(e) && !evIsAttach(e);
      var bodyHtml = showBody ? FP.esc(body).replace(/\n/g, '<br>') : '';

      // Préfixes / suffixes
      var titlePrefix = '';
      if (evIsAttach(e)) {
        var meta = e.meta || {};
        if (meta.has_thumbnail) {
          titlePrefix = '<span class="v30-fp-ev__thumb" data-v30-thumb-preview data-att-id="' + FP.esc(e.id) + '" data-att-name="' + FP.esc(meta.original_name || '') + '" data-att-mime="' + FP.esc(meta.mime_type || '') + '">' +
            '<img src="/api/prospect/attachments/' + FP.esc(e.id) + '/thumb" alt="" loading="lazy">' +
            '</span>';
        } else {
          titlePrefix = '<span class="v30-fp-ev__file-icon">' + fileIconSvg() + '</span>';
        }
      }
      var titleSuffix = '';
      if (evIsCR(e) && e.meta) {
        if (e.meta.action_pending > 0) {
          titleSuffix = ' <span class="v30-fp-ev__badge v30-fp-ev__badge--pending">' + e.meta.action_pending + ' en attente</span>';
        } else if (e.meta.action_count > 0) {
          titleSuffix = ' <span class="v30-fp-ev__badge v30-fp-ev__badge--ok">✓ ' + e.meta.action_count + '</span>';
        }
      }
      // Tags inline (attachment)
      if (evIsAttach(e) && e.meta && e.meta.tags && e.meta.tags.length) {
        titleSuffix = e.meta.tags.map(function (t) {
          return ' <span class="v30-fp-ev__badge v30-fp-ev__badge--ok">' + FP.esc(t) + '</span>';
        }).join('');
      }

      var dataAttrs = ' data-v30-ev-idx="' + idx + '" data-v30-ev-filter="' + FP.esc(filter || 'all') + '"';
      var classes = 'v30-fp-ev' + (evIsAttach(e) ? ' v30-fp-ev--attachment' : '');
      return '<div class="' + classes + '"' + dataAttrs + '>' +
        '<span class="v30-fp-ev__time mono">' + FP.esc(when) + '</span>' +
        '<span class="v30-fp-ev__dot" style="background:' + color + ';"></span>' +
        '<div>' +
          '<div class="v30-fp-ev__title">' + titlePrefix + FP.esc(title) + titleSuffix + '</div>' +
          (bodyHtml ? '<div class="v30-fp-ev__body">' + bodyHtml + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    // Met à jour le compteur de la barre de recherche
    var countEl = document.querySelector('[data-v30-tl-search-count]');
    if (countEl) {
      if (q) countEl.textContent = events.length + ' / ' + totalCount;
      else countEl.textContent = '';
    }
  }

  // Rend (ou re-rend) le panel d'expansion d'un événement.
  function renderEventExpand(evEl, e) {
    // Retire un panel existant
    var existing = evEl.querySelector('.v30-fp-ev__expand, .v30-fp-ev__edit-form');
    if (existing) existing.remove();
    var html = eventExpandHtml(e);
    if (!html) return;
    // Wrap dans .v30-fp-ev__expand sauf si c'est déjà un edit-form
    var wrap;
    if (html.indexOf('v30-fp-ev__edit-form') !== -1) {
      // On prend le HTML brut (déjà wrappé)
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      wrap = tmp.firstElementChild;
    } else {
      wrap = document.createElement('div');
      wrap.className = 'v30-fp-ev__expand';
      wrap.innerHTML = html;
    }
    evEl.appendChild(wrap);
  }
  // Expose pour que prospect_detail_ui.js puisse l'utiliser
  window._v30RenderEventExpand = renderEventExpand;

  function renderPushList() {
    var host = FP.$('[data-v30-fp-push-list]');
    if (!host) return;
    var pushes = FP.STATE.pushLogs || [];
    if (pushes.length === 0) {
      host.innerHTML = '<div class="empty">Aucun push envoyé.</div>';
      return;
    }
    host.innerHTML = pushes.map(function (p) {
      var meta = p.meta || {};
      var chan = meta.channel || (p.type === 'push_linkedin' ? 'linkedin' : 'email');
      var candidates = meta.candidates || [];
      var consultants = meta.consultants || [];
      var details = '';
      if (candidates.length) {
        details += '<div style="font-size:11.5px;color:var(--text-2);margin-top:3px;">' +
          '<span style="color:var(--text-3);">Consultant' + (candidates.length > 1 ? 's' : '') + ' proposé' + (candidates.length > 1 ? 's' : '') + ' :</span> ' +
          candidates.map(function(n){ return FP.esc(n); }).join(', ') +
        '</div>';
      }
      if (consultants.length) {
        details += '<div style="font-size:11.5px;color:var(--text-2);margin-top:2px;">' +
          '<span style="color:var(--text-3);">Envoyé par :</span> ' +
          consultants.map(function(n){ return FP.esc(n); }).join(', ') +
        '</div>';
      }
      return '<div class="v30-fp-push-row" data-push-id="' + FP.esc(p.id || '') + '" style="display:grid;grid-template-columns:80px 1fr auto;gap:10px;padding:8px 0;border-top:1px solid var(--border);align-items:start;">' +
        '<span class="mono" style="font-size:11px;color:var(--text-3);padding-top:2px;">' + FP.esc(FP.relativeTime(p.date)) + '</span>' +
        '<div>' +
          '<div style="font-size:12.5px;font-weight:500;">' + FP.esc(p.title || '—') + '</div>' +
          (p.content ? '<div style="font-size:12px;color:var(--text-2);">' + FP.esc(p.content) + '</div>' : '') +
          details +
        '</div>' +
        '<span class="badge badge-accent">' + FP.esc(chan) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderCounts() {
    var timelineCount = FP.$('[data-field="count-timeline"]');
    if (timelineCount) timelineCount.textContent = FP.STATE.events.length;
    var pushCount = FP.$('[data-field="count-push"]');
    if (pushCount) pushCount.textContent = FP.STATE.pushLogs.length;
  }

  function renderAll() {
    var p = FP.STATE.prospect;
    renderHeader(p);
    renderAside(p);
    renderEvents('all', '[data-v30-fp-events]', 6);
    renderEvents('all', '[data-v30-fp-events-full]');
    renderPushList();
    renderCounts();
  }

  window.ProspFPRender = {
    all: renderAll,
    header: renderHeader,
    aside: renderAside,
    events: renderEvents,
    pushList: renderPushList
  };
})();
