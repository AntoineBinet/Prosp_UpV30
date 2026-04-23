/* ProspUp v30 — Collaboration : partages d'entreprises entre collaborateurs */
(function () {
  'use strict';

  var STATE = {
    collaborators: [],
    sent: [],
    received: [],
    sharedProspects: [],
    companies: [],
    // modale "voir prospects"
    currentCompanyId: null,
    currentFromUserId: null,
    currentSharerName: '',
    // modale "édition prospect partagé"
    editingProspectId: null,
    editingCompanyId: null
  };

  var STATUTS = ['', 'À contacter', 'Contacté', 'Intéressé', 'Rendez-vous', 'Proposition', 'Client', 'Non pertinent'];

  // ─── Helpers ─────────────────────────────────────────────────
  function $(s, root) { return (root || document).querySelector(s); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) { return iso; }
  }
  function companyLabel(share) {
    return share.groupe || share.site || ('Entreprise #' + share.company_id);
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }, opts || {})).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function fetchPost(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }
  function fetchPut(url, body) {
    return fetchJSON(url, {
      method: 'PUT',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  // Icônes inline (non présentes dans le macro Jinja v30)
  var SVG = {
    eye:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/></svg>',
    edit:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>',
    linkedin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.854 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.266 2.37 4.266 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zm1.777 13.019H3.56V9h3.554v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    mail:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></svg>',
    phone: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>'
  };

  // ─── Modal helpers ───────────────────────────────────────────
  function getModal(name) { return document.querySelector('[data-v30-pp-modal="' + name + '"]'); }
  function openModal(m) {
    if (!m) return;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('is-open');
    var f = m.querySelector('input:not([type=hidden]),select,textarea,button:not([data-v30-modal-close])');
    if (f) try { f.focus(); } catch (_) {}
  }
  function closeModal(m) {
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { m.hidden = true; }, 160);
  }
  function bindModalDismiss() {
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-v30-modal-close]');
      if (close) {
        var m = close.closest('[data-v30-pp-modal]');
        if (m) closeModal(m);
        return;
      }
      var bd = e.target.closest('.v30-modal-bd');
      if (bd && e.target === bd && bd.dataset.v30PpModal) closeModal(bd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.v30-modal-bd.is-open[data-v30-pp-modal]').forEach(closeModal);
    });
  }

  // ─── Data loaders ────────────────────────────────────────────
  function loadAll() {
    return Promise.all([
      fetchJSON('/api/collab/collaborators').catch(function () { return { collaborators: [] }; }),
      fetchJSON('/api/collab/shared-companies').catch(function () { return { sent: [], received: [] }; }),
      fetchJSON('/api/data').catch(function () { return { companies: [] }; })
    ]).then(function (res) {
      STATE.collaborators = (res[0] && res[0].collaborators) || [];
      STATE.sent = (res[1] && res[1].sent) || [];
      STATE.received = (res[1] && res[1].received) || [];
      STATE.companies = (res[2] && res[2].companies) || [];
      renderSent();
      renderReceived();
      return loadSharedProspects();
    });
  }

  function loadSharedProspects() {
    return fetchJSON('/api/collab/shared-prospects')
      .then(function (json) {
        STATE.sharedProspects = (json && json.prospects) || [];
        renderSharedProspects();
      })
      .catch(function () {
        STATE.sharedProspects = [];
        renderSharedProspects();
      });
  }

  // ─── Section 1 : Mes partages (envoyés) ──────────────────────
  function renderSent() {
    var host = document.querySelector('[data-v30-collab-sent]');
    var countEl = document.querySelector('[data-v30-collab-sent-count]');
    if (!host) return;

    // Grouper par utilisateur destinataire
    var byUser = {};
    STATE.sent.forEach(function (share) {
      var uid = share.to_user_id;
      if (!byUser[uid]) {
        var user = STATE.collaborators.find(function (c) { return c.id === uid; })
                   || { id: uid, display_name: share.display_name || share.username || 'Inconnu', username: share.username };
        byUser[uid] = { user: user, shares: [] };
      }
      byUser[uid].shares.push(share);
    });

    var groups = Object.values(byUser);
    if (countEl) countEl.textContent = String(STATE.sent.length);

    if (groups.length === 0) {
      host.innerHTML = '<div class="v30-collab__empty">Aucune entreprise partagée. Cliquez sur « Partager une entreprise » pour commencer.</div>';
      return;
    }

    host.innerHTML = groups.map(function (g) {
      var sharesHtml = g.shares.map(function (share) {
        var name = companyLabel(share);
        var sub = (share.site && share.groupe)
          ? esc(share.site) + ' · Partagé le ' + esc(formatDate(share.shared_at))
          : 'Partagé le ' + esc(formatDate(share.shared_at));
        return '<div class="v30-collab__share">' +
          '<div class="v30-collab__share-main">' +
            '<div class="v30-collab__share-title">' + esc(name) + '</div>' +
            '<div class="v30-collab__share-meta">' + sub + '</div>' +
          '</div>' +
          '<div class="v30-collab__share-actions">' +
            '<button type="button" class="btn btn-sm js-collab-view" ' +
              'data-company-id="' + share.company_id + '" ' +
              'data-company-name="' + esc(name) + '" ' +
              'data-from-user-id="" ' +
              'data-sharer-name="">' +
              SVG.eye + ' Prospects' +
            '</button>' +
            '<button type="button" class="btn btn-sm btn-danger js-collab-unshare" ' +
              'data-share-id="' + share.id + '" ' +
              'data-company-name="' + esc(name) + '" ' +
              'title="Retirer le partage" aria-label="Retirer">' +
              SVG.trash +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      var displayName = g.user.display_name || g.user.username || 'Inconnu';
      return '<div class="v30-collab__group">' +
        '<div class="v30-collab__group-head">' +
          '<span class="v30-collab__group-avatar">' + esc(initials(displayName)) + '</span>' +
          '<div>' +
            '<div class="v30-collab__group-name">' + esc(displayName) + '</div>' +
            '<div class="v30-collab__group-user">@' + esc(g.user.username || '') + '</div>' +
          '</div>' +
          '<div class="v30-collab__group-actions">' +
            '<button type="button" class="btn btn-sm js-collab-share-user" data-user-id="' + g.user.id + '">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
              ' Partager une autre entreprise' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="v30-collab__share-list">' + sharesHtml + '</div>' +
      '</div>';
    }).join('');
  }

  // ─── Section 2 : Partagés avec moi ──────────────────────────
  function renderReceived() {
    var host = document.querySelector('[data-v30-collab-received]');
    var countEl = document.querySelector('[data-v30-collab-received-count]');
    if (!host) return;

    if (countEl) countEl.textContent = String(STATE.received.length);

    if (STATE.received.length === 0) {
      host.innerHTML = '<div class="v30-collab__empty">Aucune entreprise partagée avec vous.</div>';
      return;
    }

    host.innerHTML = '<div class="v30-collab__share-list">' + STATE.received.map(function (share) {
      var name = companyLabel(share);
      var sharerName = share.display_name || share.username || 'Inconnu';
      var sub = (share.site && share.groupe)
        ? esc(share.site) + ' · Partagé par <strong>' + esc(sharerName) + '</strong> le ' + esc(formatDate(share.shared_at))
        : 'Partagé par <strong>' + esc(sharerName) + '</strong> le ' + esc(formatDate(share.shared_at));
      return '<div class="v30-collab__share">' +
        '<div class="v30-collab__share-main">' +
          '<div class="v30-collab__share-title">' + esc(name) + '</div>' +
          '<div class="v30-collab__share-meta">' + sub + '</div>' +
        '</div>' +
        '<div class="v30-collab__share-actions">' +
          '<button type="button" class="btn btn-sm js-collab-view" ' +
            'data-company-id="' + share.company_id + '" ' +
            'data-company-name="' + esc(name) + '" ' +
            'data-from-user-id="' + (share.from_user_id || '') + '" ' +
            'data-sharer-name="' + esc(sharerName) + '">' +
            SVG.eye + ' Prospects' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  // ─── Section 3 : Prospects des entreprises partagées ─────────
  function renderSharedProspects() {
    var host = document.querySelector('[data-v30-collab-prospects]');
    var countEl = document.querySelector('[data-v30-collab-prospects-count]');
    if (!host) return;

    if (countEl) countEl.textContent = String(STATE.sharedProspects.length);

    if (STATE.sharedProspects.length === 0) {
      host.innerHTML = '<div class="v30-collab__empty">Aucun prospect dans les entreprises partagées avec vous.</div>';
      return;
    }

    // Grouper par entreprise + sharer
    var byCompany = {};
    STATE.sharedProspects.forEach(function (p) {
      var key = p.shared_company_id + '-' + p.shared_from_user_id;
      if (!byCompany[key]) {
        byCompany[key] = {
          companyId: p.shared_company_id,
          fromUserId: p.shared_from_user_id,
          companyName: p.shared_company_name || ('Entreprise #' + p.shared_company_id),
          sharerName: p.shared_from || '',
          prospects: []
        };
      }
      byCompany[key].prospects.push(p);
    });

    host.innerHTML = Object.values(byCompany).map(function (g) {
      var rows = g.prospects.map(function (p) {
        var meta = [];
        if (p.fonction) meta.push(esc(p.fonction));
        if (p.telephone) meta.push('<span>' + SVG.phone + ' ' + esc(p.telephone) + '</span>');
        if (p.email) meta.push('<span>' + SVG.mail + ' ' + esc(p.email) + '</span>');
        var statutBadge = p.statut ? '<span class="badge">' + esc(p.statut) + '</span>' : '';
        var prospectJson = encodeURIComponent(JSON.stringify({
          statut: p.statut, notes: p.notes, lastContact: p.lastContact,
          nextFollowUp: p.nextFollowUp, pertinence: p.pertinence, nextAction: p.nextAction
        }));
        return '<div class="v30-collab__prospect">' +
          '<div class="v30-collab__prospect-main">' +
            '<div class="v30-collab__prospect-title">' +
              esc(p.name || '') +
              ' ' + statutBadge +
            '</div>' +
            '<div class="v30-collab__prospect-sub">' + meta.join('') + '</div>' +
          '</div>' +
          '<div class="v30-collab__prospect-actions">' +
            (p.telephone ? '<a class="v30-collab__mini" href="tel:' + esc(p.telephone) + '" title="Appeler" aria-label="Appeler">' + SVG.phone + '</a>' : '') +
            (p.email ? '<a class="v30-collab__mini" href="mailto:' + esc(p.email) + '" title="Email" aria-label="Email">' + SVG.mail + '</a>' : '') +
            (p.linkedin ? '<a class="v30-collab__mini" href="' + esc(p.linkedin) + '" target="_blank" rel="noopener" title="LinkedIn" aria-label="LinkedIn">' + SVG.linkedin + '</a>' : '') +
            '<button type="button" class="v30-collab__mini js-collab-edit" ' +
              'data-prospect-id="' + p.id + '" ' +
              'data-company-id="' + p.shared_company_id + '" ' +
              'data-prospect="' + prospectJson + '" ' +
              'title="Modifier" aria-label="Modifier">' + SVG.edit + '</button>' +
          '</div>' +
        '</div>';
      }).join('');

      return '<div class="v30-collab__shared-group">' +
        '<div class="v30-collab__shared-group-head">' +
          '<div class="v30-collab__shared-group-title">' + esc(g.companyName) + '</div>' +
          '<span class="badge v30-collab__badge-sharer">partagé par ' + esc(g.sharerName) + '</span>' +
        '</div>' +
        rows +
      '</div>';
    }).join('');
  }

  // ─── Modale : partager une entreprise ────────────────────────
  function openShareModal(preselectedUserId) {
    var modal = getModal('collab-share');
    if (!modal) return;

    var userSel = $('#v30-collab-share-user');
    var compSel = $('#v30-collab-share-company');
    var search = $('#v30-collab-share-search');

    if (userSel) {
      userSel.innerHTML = '<option value="">— Sélectionner —</option>' + STATE.collaborators.map(function (c) {
        var selected = (preselectedUserId && c.id === preselectedUserId) ? ' selected' : '';
        return '<option value="' + c.id + '"' + selected + '>' + esc((c.display_name || c.username) + ' (' + c.username + ')') + '</option>';
      }).join('');
    }
    if (compSel) {
      compSel.innerHTML = '<option value="">— Sélectionner —</option>' + STATE.companies.map(function (c) {
        var name = c.groupe || c.site || ('Entreprise #' + c.id);
        var label = name + (c.site && c.groupe ? ' (' + c.site + ')' : '');
        return '<option value="' + c.id + '">' + esc(label) + '</option>';
      }).join('');
    }
    if (search) search.value = '';

    openModal(modal);
  }

  function filterCompanyOptions() {
    var q = ($('#v30-collab-share-search') && $('#v30-collab-share-search').value || '').toLowerCase().trim();
    var sel = $('#v30-collab-share-company');
    if (!sel) return;
    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      if (opt.value === '') continue;
      var text = (opt.textContent || '').toLowerCase();
      opt.style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
    }
  }

  function shareCompany() {
    var userId = $('#v30-collab-share-user') && $('#v30-collab-share-user').value;
    var companyId = $('#v30-collab-share-company') && $('#v30-collab-share-company').value;
    if (!userId || !companyId) {
      toast('Veuillez sélectionner un collaborateur et une entreprise.', 'error');
      return;
    }
    var btn = $('[data-v30-collab-share-save]');
    if (btn) btn.disabled = true;
    fetchPost('/api/collab/share-company', {
      company_id: Number(companyId),
      to_user_id: Number(userId)
    }).then(function (json) {
      if (!json.ok) throw new Error(json.error || 'Erreur');
      toast('Entreprise partagée avec succès.', 'success');
      closeModal(getModal('collab-share'));
      return loadAll();
    }).catch(function (e) {
      toast('Erreur : ' + (e.message || 'inconnue'), 'error');
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function unshareCompany(shareId, companyName) {
    if (!confirm('Retirer le partage de « ' + companyName + ' » ?')) return;
    fetchPost('/api/collab/unshare-company', { share_id: Number(shareId) })
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Erreur');
        toast('Partage retiré.', 'success');
        return loadAll();
      })
      .catch(function (e) {
        toast('Erreur : ' + (e.message || 'inconnue'), 'error');
      });
  }

  // ─── Modale : voir prospects d'une entreprise partagée ───────
  function openProspectsModal(companyId, companyName, fromUserId, sharerName) {
    var modal = getModal('collab-prospects');
    var title = $('#v30-collab-pros-title');
    var list = document.querySelector('[data-v30-collab-pros-list]');
    if (!modal || !list) return;

    STATE.currentCompanyId = companyId;
    STATE.currentFromUserId = fromUserId;
    STATE.currentSharerName = sharerName || '';

    if (title) title.textContent = 'Prospects — ' + companyName;
    list.innerHTML = '<div class="muted">Chargement…</div>';
    openModal(modal);

    fetchJSON('/api/collab/shared-company/' + companyId + '/prospects')
      .then(function (json) {
        if (!json.ok) throw new Error(json.error || 'Erreur');
        var displaySharerName = sharerName || json.sharer_name || '';
        STATE.currentFromUserId = fromUserId || json.from_user_id || null;
        STATE.currentSharerName = displaySharerName;

        var prospects = Array.isArray(json.prospects) ? json.prospects : [];
        if (prospects.length === 0) {
          list.innerHTML = '<div class="v30-collab__empty">Aucun prospect pour cette entreprise.</div>';
          return;
        }

        var isReceived = !!displaySharerName;
        list.innerHTML = prospects.map(function (p) {
          var tags = Array.isArray(p.tags) ? p.tags : [];
          var tagsHtml = tags.length
            ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' +
              tags.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join('') +
              '</div>'
            : '';
          var sharerBadge = displaySharerName
            ? '<span class="badge v30-collab__badge-sharer" style="margin-left:6px;">' + esc(displaySharerName) + '</span>'
            : '';
          var prospectJson = encodeURIComponent(JSON.stringify({
            statut: p.statut, notes: p.notes, lastContact: p.lastContact,
            nextFollowUp: p.nextFollowUp, pertinence: p.pertinence, nextAction: p.nextAction
          }));
          var editBtn = isReceived
            ? '<button type="button" class="v30-collab__mini js-collab-edit" ' +
              'data-prospect-id="' + p.id + '" data-company-id="' + companyId + '" ' +
              'data-prospect="' + prospectJson + '" ' +
              'title="Modifier" aria-label="Modifier">' + SVG.edit + '</button>'
            : '';
          return '<div class="card" style="margin-bottom:10px;padding:12px;">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-weight:500;color:var(--text);">' + esc(p.name || '') + sharerBadge + '</div>' +
                (p.fonction ? '<div class="muted" style="font-size:12px;margin-top:2px;">' + esc(p.fonction) + '</div>' : '') +
                (p.email ? '<div class="muted" style="font-size:11.5px;margin-top:4px;display:flex;align-items:center;gap:4px;">' + SVG.mail + ' ' + esc(p.email) + '</div>' : '') +
                (p.telephone ? '<div class="muted" style="font-size:11.5px;display:flex;align-items:center;gap:4px;">' + SVG.phone + ' ' + esc(p.telephone) + '</div>' : '') +
                (p.statut ? '<div style="margin-top:6px;"><span class="badge">' + esc(p.statut) + '</span></div>' : '') +
                tagsHtml +
                (p.notes ? '<div class="muted" style="font-size:11.5px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);white-space:pre-wrap;">' + esc(p.notes) + '</div>' : '') +
              '</div>' +
              '<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:flex-start;">' +
                (p.email ? '<a class="v30-collab__mini" href="mailto:' + esc(p.email) + '" title="Email">' + SVG.mail + '</a>' : '') +
                (p.telephone ? '<a class="v30-collab__mini" href="tel:' + esc(p.telephone) + '" title="Appeler">' + SVG.phone + '</a>' : '') +
                (p.linkedin ? '<a class="v30-collab__mini" href="' + esc(p.linkedin) + '" target="_blank" rel="noopener" title="LinkedIn">' + SVG.linkedin + '</a>' : '') +
                editBtn +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function (e) {
        list.innerHTML = '<div class="v30-collab__empty" style="color:var(--danger);">Erreur lors du chargement : ' + esc(e.message || 'inconnue') + '</div>';
      });
  }

  // ─── Modale : édition prospect partagé ───────────────────────
  function openEditModal(prospectId, companyId, data) {
    STATE.editingProspectId = prospectId;
    STATE.editingCompanyId = companyId;

    var statutSel = $('#v30-collab-edit-statut');
    if (statutSel) {
      statutSel.innerHTML = STATUTS.map(function (s) {
        var sel = data.statut === s ? ' selected' : '';
        return '<option value="' + esc(s) + '"' + sel + '>' + (s || '— Statut —') + '</option>';
      }).join('');
    }
    var notesEl = $('#v30-collab-edit-notes');
    if (notesEl) notesEl.value = data.notes || '';
    var lastEl = $('#v30-collab-edit-last');
    if (lastEl) lastEl.value = data.lastContact || '';
    var nextEl = $('#v30-collab-edit-next');
    if (nextEl) nextEl.value = data.nextFollowUp || '';
    var actionEl = $('#v30-collab-edit-action');
    if (actionEl) actionEl.value = data.nextAction || '';

    openModal(getModal('collab-edit'));
  }

  function saveEdit() {
    if (!STATE.editingProspectId || !STATE.editingCompanyId) return;
    var payload = {
      statut: ($('#v30-collab-edit-statut') || {}).value || '',
      notes: ($('#v30-collab-edit-notes') || {}).value || '',
      lastContact: ($('#v30-collab-edit-last') || {}).value || '',
      nextFollowUp: ($('#v30-collab-edit-next') || {}).value || '',
      nextAction: ($('#v30-collab-edit-action') || {}).value || ''
    };
    var btn = $('[data-v30-collab-edit-save]');
    if (btn) btn.disabled = true;
    fetchPut(
      '/api/collab/shared-company/' + STATE.editingCompanyId + '/prospect/' + STATE.editingProspectId,
      payload
    ).then(function (json) {
      if (!json.ok) throw new Error(json.error || 'Erreur');
      toast('Prospect mis à jour.', 'success');
      closeModal(getModal('collab-edit'));

      // Rafraîchir la liste des prospects (dans la modale si ouverte et section 3)
      var prosModal = getModal('collab-prospects');
      if (prosModal && !prosModal.hidden && STATE.currentCompanyId) {
        var title = $('#v30-collab-pros-title');
        var name = title ? title.textContent.replace('Prospects — ', '') : '';
        openProspectsModal(STATE.currentCompanyId, name, STATE.currentFromUserId, STATE.currentSharerName);
      }
      return loadSharedProspects();
    }).catch(function (e) {
      toast('Erreur : ' + (e.message || 'inconnue'), 'error');
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  // ─── Bindings ───────────────────────────────────────────────
  function bind() {
    bindModalDismiss();

    var reloadBtn = document.querySelector('[data-v30-collab-reload]');
    if (reloadBtn) reloadBtn.addEventListener('click', loadAll);

    var shareBtn = document.querySelector('[data-v30-collab-share]');
    if (shareBtn) shareBtn.addEventListener('click', function () { openShareModal(); });

    var search = $('#v30-collab-share-search');
    if (search) search.addEventListener('input', filterCompanyOptions);

    var saveShareBtn = document.querySelector('[data-v30-collab-share-save]');
    if (saveShareBtn) saveShareBtn.addEventListener('click', shareCompany);

    var saveEditBtn = document.querySelector('[data-v30-collab-edit-save]');
    if (saveEditBtn) saveEditBtn.addEventListener('click', saveEdit);

    // Event delegation pour boutons rendus dynamiquement
    document.addEventListener('click', function (e) {
      var viewBtn = e.target.closest('.js-collab-view');
      if (viewBtn) {
        var cid = parseInt(viewBtn.dataset.companyId, 10);
        var cname = viewBtn.dataset.companyName || '';
        var fuid = viewBtn.dataset.fromUserId ? parseInt(viewBtn.dataset.fromUserId, 10) : null;
        var sname = viewBtn.dataset.sharerName || null;
        openProspectsModal(cid, cname, fuid, sname);
        return;
      }
      var unshareBtn = e.target.closest('.js-collab-unshare');
      if (unshareBtn) {
        unshareCompany(unshareBtn.dataset.shareId, unshareBtn.dataset.companyName || '');
        return;
      }
      var shareUserBtn = e.target.closest('.js-collab-share-user');
      if (shareUserBtn) {
        openShareModal(parseInt(shareUserBtn.dataset.userId, 10));
        return;
      }
      var editBtn = e.target.closest('.js-collab-edit');
      if (editBtn) {
        var pid = parseInt(editBtn.dataset.prospectId, 10);
        var compId = parseInt(editBtn.dataset.companyId, 10);
        try {
          var data = JSON.parse(decodeURIComponent(editBtn.dataset.prospect || '{}'));
          openEditModal(pid, compId, data);
        } catch (_) {}
        return;
      }
    });
  }

  function init() {
    bind();
    loadAll().catch(function (e) {
      console.error('[v30 collab]', e);
      toast('Erreur lors du chargement de la collaboration.', 'error');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
