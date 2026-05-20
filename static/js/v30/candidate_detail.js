/* ProspUp v30 — Fiche candidat : fetch + rendu */
(function () {
  'use strict';

  var fc = document.querySelector('[data-v30-fc]');
  if (!fc) return;
  var CID = Number(fc.dataset.candidateId || 0);
  if (!CID) return;

  var STATE = { candidate: null, experiences: [], skills: [], availability: {}, dc: null, events: [], attachments: [], ec1Preview: null };

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function parseList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function fetchPostJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ─── Header ────────────────────────────────────────────
  function renderHeader(c) {
    if (!c) return;
    var h = $('[data-v30-fc-header]');
    if (!h) return;
    var av = h.querySelector('[data-field="initials"]');
    if (av) av.textContent = initials(c.name);
    var nm = h.querySelector('[data-field="name"]');
    if (nm) nm.textContent = c.name || '—';

    var pill = h.querySelector('[data-field="status-pill"]');
    if (pill) {
      var statut = c.status || 'Vivier';
      var cls = statut === 'Placé' ? 'badge-accent'
              : statut === 'En entretien' ? 'badge-warn'
              : statut === 'Vivier' || statut === 'Libre' ? 'badge-success'
              : 'badge';
      pill.innerHTML = '<span class="badge ' + cls + '">' + esc(statut) + '</span>';
    }

    var meta = h.querySelector('[data-field="meta"]');
    if (meta) {
      var parts = [];
      if (c.role)      parts.push(esc(c.role));
      if (c.seniority) parts.push(esc(c.seniority));
      if (c.location)  parts.push(esc(c.location));
      meta.innerHTML = parts.join(' · ') || '—';
    }

    var chips = h.querySelector('[data-field="chips"]');
    if (chips) {
      var cc = '';
      if (c.linkedin) cc += '<a class="badge" href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a> ';
      if (c.vsa_url)  cc += '<a class="badge" href="' + esc(c.vsa_url) + '" target="_blank" rel="noopener">VSA</a> ';
      if (c.source)   cc += '<span class="badge">Source : ' + esc(c.source) + '</span>';
      chips.innerHTML = cc;
    }

    var notes = $('[data-field="notes"]');
    if (notes) notes.textContent = c.notes || '';

    document.title = (c.name || 'Candidat') + " — Prosp'Up v30";
  }

  // ─── Bloc Informations (STATUT / RÔLE / LOCALISATION / etc.) ──
  function renderInfo(c) {
    var host = $('[data-v30-fc-info]');
    if (!host || !c) return;
    var mailto = c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—';
    var telto = c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/\s/g, '')) + '">' + esc(c.phone) + '</a>' : '—';
    var lnk = c.linkedin
      ? '<a href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">' +
        esc(c.linkedin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>'
      : '—';
    var vsaLnk = c.vsa_url
      ? '<a href="' + esc(c.vsa_url) + '" target="_blank" rel="noopener">Ouvrir ↗</a>'
      : '—';
    var tech = c.tech || (Array.isArray(c.skills) && c.skills.length
      ? c.skills.slice(0, 6).join(', ') : '') || '—';
    var rows = [
      ['Statut',       c.status || 'nouveau'],
      ['Rôle',         c.role || '—'],
      ['Localisation', c.location || '—'],
      ['Expérience',   c.years_experience || c.annees_experience || c.seniority || '—'],
      ['Secteur',      c.sector || c.domaine_principal || '—'],
      ['Source',       c.source || '—'],
      ['Tech',         tech],
      ['Téléphone',    telto,   true],
      ['Email',        mailto,  true],
      ['LinkedIn',     lnk,     true],
      ['Page VSA',     vsaLnk,  true]
    ];
    host.innerHTML = rows.map(function (r) {
      return '<div class="v30-fc-info-item">' +
        '<div class="v30-fc-info-item__label">' + esc(r[0]) + '</div>' +
        '<div class="v30-fc-info-item__value">' + (r[2] ? r[1] : esc(r[1])) + '</div>' +
      '</div>';
    }).join('');
  }

  // ─── Skills ──────────────────────────────────────────────
  //   Backend : table candidate_skills (nom, catégorie, level 1-5)
  //   Clic sur une barre -> change le level. Clic sur '+' -> prompt nouveau.
  function renderSkills() {
    var host = $('[data-v30-fc-skills]');
    if (!host) return;
    var skills = STATE.skills || [];
    // Groupe par catégorie
    var groups = {};
    skills.forEach(function (s) {
      var cat = s.category || 'Compétences';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    });
    var cats = Object.keys(groups);
    if (!cats.length) {
      host.innerHTML = '<div class="empty" style="padding:12px;font-size:12px;">Aucune compétence renseignée.</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-add-skill>+ Ajouter</button>';
    } else {
      host.innerHTML = cats.map(function (cat) {
        return '<div class="v30-fc-skills-group">' +
          '<div class="v30-fc-skills-cat">' + esc(cat) + '</div>' +
          '<div class="v30-fc-skills-row">' +
            groups[cat].map(function (s) {
              var bars = '';
              for (var i = 1; i <= 5; i++) {
                bars += '<span class="v30-fc-skill__bar' + (i <= s.level ? ' is-on' : '') +
                        '" data-skill-bar="' + s.id + '" data-level="' + i + '"></span>';
              }
              return '<div class="v30-fc-skill" data-skill-id="' + s.id + '">' +
                '<span>' + esc(s.name) + '</span>' +
                '<span class="v30-fc-skill__bars">' + bars + '</span>' +
                '<button type="button" class="v30-fc-skill__x" data-skill-delete="' + s.id +
                '" aria-label="Supprimer">×</button>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>';
      }).join('') +
      '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-add-skill style="margin-top:8px;">+ Ajouter</button>';
    }

    // Bind clic sur barre pour changer le level
    host.querySelectorAll('[data-skill-bar]').forEach(function (bar) {
      bar.addEventListener('click', function () {
        var sid = Number(bar.dataset.skillBar);
        var lvl = Number(bar.dataset.level);
        var sk = (STATE.skills || []).find(function (x) { return x.id === sid; });
        if (!sk) return;
        fetchPostJSON('/api/candidates/' + CID + '/skills', {
          name: sk.name, category: sk.category, level: lvl
        }).then(function () {
          sk.level = lvl;
          renderSkills();
          flashSaved();
        });
      });
    });
    host.querySelectorAll('[data-skill-delete]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var sid = btn.dataset.skillDelete;
        if (!confirm('Supprimer cette compétence ?')) return;
        fetch('/api/candidates/' + CID + '/skills/' + sid, { method: 'DELETE', credentials: 'same-origin' })
          .then(loadSkills);
      });
    });
    var addBtn = host.querySelector('[data-v30-fc-add-skill]');
    if (addBtn) addBtn.addEventListener('click', function () {
      var name = prompt('Nom de la compétence (ex: Kubernetes) :');
      if (!name) return;
      fetchPostJSON('/api/candidates/' + CID + '/skills', {
        name: name, category: 'Compétences', level: 3
      }).then(loadSkills);
    });
  }

  function loadSkills() {
    return fetchJSON('/api/candidates/' + CID + '/skills').then(function (res) {
      STATE.skills = (res && res.skills) || [];
      renderSkills();
    }).catch(function () { STATE.skills = []; renderSkills(); });
  }

  // ─── Disponibilités 8 semaines ───────────────────────────
  //   Backend : table candidate_availability (week_iso, status).
  //   Clic -> cycle libre → busy → placed → libre.
  function isoWeek(d) {
    var target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    var y1 = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    var w = Math.ceil(((target - y1) / 86400000 + 1) / 7);
    return target.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
  }
  function nextStatus(s) { return s === 'libre' ? 'busy' : s === 'busy' ? 'placed' : 'libre'; }

  function renderDispo() {
    var host = $('[data-v30-fc-dispo]');
    if (!host) return;
    var now = new Date();
    var fallback = (STATE.candidate && STATE.candidate.status) || 'Vivier';
    var defaultSt = fallback === 'Placé' ? 'placed' : fallback === 'En entretien' ? 'busy' : 'libre';
    var LABELS = { libre: 'Libre', busy: 'Mission', placed: 'Placé' };
    var cells = [];
    for (var i = 0; i < 8; i++) {
      var d = new Date(now.getTime() + i * 7 * 86400000);
      var wk = isoWeek(d);
      var st = STATE.availability[wk] || defaultSt;
      cells.push(
        '<div class="v30-fc-dispo__cell is-' + st + '" data-week="' + wk + '" data-status="' + st + '">' +
          '<div class="v30-fc-dispo__week mono">' + wk.split('-W')[1].replace(/^0/, 'S') + '</div>' +
          '<div class="v30-fc-dispo__label">' + LABELS[st] + '</div>' +
        '</div>'
      );
    }
    host.innerHTML = cells.join('');
    host.querySelectorAll('[data-week]').forEach(function (cell) {
      cell.addEventListener('click', function () {
        var wk = cell.dataset.week;
        var cur = cell.dataset.status || defaultSt;
        var nxt = nextStatus(cur);
        fetchPostJSON('/api/candidates/' + CID + '/availability', { week_iso: wk, status: nxt })
          .then(function () {
            STATE.availability[wk] = nxt;
            renderDispo();
            flashSaved();
          });
      });
    });
  }

  function loadAvailability() {
    return fetchJSON('/api/candidates/' + CID + '/availability').then(function (res) {
      STATE.availability = {};
      ((res && res.availability) || []).forEach(function (a) { STATE.availability[a.week_iso] = a.status; });
      renderDispo();
    }).catch(function () { STATE.availability = {}; renderDispo(); });
  }

  // ─── Historique des envois (pushes) ─────────────────────
  function formatPushDate(raw) {
    if (!raw) return '—';
    try {
      var d = new Date(raw);
      if (isNaN(d.getTime())) return esc(String(raw).slice(0, 10));
      var dd = String(d.getDate()).padStart(2, '0');
      var mm = String(d.getMonth() + 1).padStart(2, '0');
      var yyyy = d.getFullYear();
      var hh = String(d.getHours()).padStart(2, '0');
      var mi = String(d.getMinutes()).padStart(2, '0');
      return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + mi;
    } catch (_) {
      return esc(String(raw).slice(0, 10));
    }
  }
  function renderPushHistory(data) {
    var host = $('[data-v30-fc-push-history]');
    if (!host) return;
    var pushes = (data && data.pushes) || [];
    var companies = (data && data.companies) || [];
    var total = (data && data.total) || pushes.length || 0;

    var badge = $('[data-v30-fc-push-count]');
    if (badge) {
      if (total > 0) { badge.style.display = ''; badge.textContent = String(total); }
      else { badge.style.display = 'none'; }
    }

    if (!pushes.length) {
      host.innerHTML = '<div class="empty" style="padding:8px;font-size:12px;color:var(--text-3);">Aucun envoi enregistré pour ce candidat.</div>';
      return;
    }

    var summaryHtml = '';
    if (companies.length) {
      summaryHtml = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">' +
        companies.slice(0, 8).map(function (c) {
          var label = c.company_name && c.company_name !== '—' ? c.company_name : 'Société inconnue';
          return '<span class="badge" title="' + esc(label) + '" style="font-size:11px;">' +
            esc(label) + ' · ' + c.count + '</span>';
        }).join('') +
      '</div>';
    }

    var listHtml = pushes.slice(0, 20).map(function (p) {
      var prospect = p.prospect_name || (p.prospect_id ? ('Prospect #' + p.prospect_id) : '—');
      var company = p.company_name || '';
      var prospectLink = p.prospect_id
        ? '<a href="/v30/prospect/' + encodeURIComponent(p.prospect_id) + '" style="color:inherit;text-decoration:none;">' + esc(prospect) + '</a>'
        : esc(prospect);
      var channelLabel = p.channel === 'linkedin' ? 'LinkedIn'
        : p.channel === 'other' ? 'Autre'
        : p.channel === 'email' ? 'Email'
        : '';
      return '<div class="v30-fc-mission" style="padding:6px 0;border-bottom:1px solid var(--border, rgba(255,255,255,0.08));">' +
        '<div class="v30-fc-mission__co" style="font-weight:600;">' + prospectLink + '</div>' +
        (company ? '<div class="v30-fc-mission__role" style="font-size:12px;color:var(--text-2);">' + esc(company) + '</div>' : '') +
        '<div class="v30-fc-mission__date" style="font-size:11px;color:var(--text-3);display:flex;gap:6px;align-items:center;">' +
          '<span>' + formatPushDate(p.createdAt) + '</span>' +
          (channelLabel ? '<span class="badge" style="font-size:10px;">' + channelLabel + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');

    var moreHtml = pushes.length > 20
      ? '<div style="font-size:11px;color:var(--text-3);padding-top:6px;">… et ' + (pushes.length - 20) + ' autre(s).</div>'
      : '';

    host.innerHTML = summaryHtml + listHtml + moreHtml;
  }
  function loadPushHistory() {
    var host = $('[data-v30-fc-push-history]');
    if (!host) return;
    fetchJSON('/api/candidate-push?candidate_id=' + CID)
      .then(function (j) {
        if (!j || j.ok === false) {
          host.innerHTML = '<div class="empty" style="padding:8px;font-size:12px;color:var(--text-3);">Historique indisponible.</div>';
          return;
        }
        renderPushHistory(j);
      })
      .catch(function () {
        host.innerHTML = '<div class="empty" style="padding:8px;font-size:12px;color:var(--text-3);">Erreur de chargement de l\'historique.</div>';
      });
  }

  // ─── Missions (experiences) ──────────────────────────────
  function renderMissions() {
    var host = $('[data-v30-fc-missions]');
    if (!host) return;
    var items = STATE.experiences || [];
    if (!items.length) {
      host.innerHTML = '<div class="empty" style="padding:8px;font-size:12px;">Aucune mission renseignée.</div>';
      return;
    }
    host.innerHTML = items.slice(0, 8).map(function (ex) {
      var dates = [ex.start_date || ex.from || '', ex.end_date || ex.to || ''].filter(Boolean).join(' — ');
      return '<div class="v30-fc-mission">' +
        '<div class="v30-fc-mission__co">' + esc(ex.company || ex.entreprise || '—') + '</div>' +
        (ex.role || ex.title ? '<div class="v30-fc-mission__role">' + esc(ex.role || ex.title) + '</div>' : '') +
        (dates ? '<div class="v30-fc-mission__date">' + esc(dates) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  // ─── Inline edit (name / notes) ──────────────────────────
  //   Candidates n'ont pas de /bulk-edit côté API → on utilise /api/candidates/<id>
  //   en PUT si dispo ; sinon on fallback à /api/candidate/update (POST).
  function saveField(field, value) {
    var payload = {}; payload[field] = value;
    return fetch('/api/candidates/' + CID, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.ok) return r.json();
      // Fallback POST
      return fetchPostJSON('/api/candidates/' + CID + '/update', payload);
    });
  }
  function flashSaved() {
    var el = document.querySelector('[data-v30-saved-check]');
    if (!el) return;
    el.classList.add('is-visible');
    setTimeout(function () { el.classList.remove('is-visible'); }, 1200);
  }
  function bindInlineEdit() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-v30-edit]');
      if (!el) return;
      if (el.getAttribute('contenteditable') === 'true') return;
      var original = el.textContent;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      var range = document.createRange(); range.selectNodeContents(el);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      function commit(save) {
        el.removeAttribute('contenteditable');
        var newVal = el.textContent.trim();
        if (!save || newVal === original.trim()) { el.textContent = original; return; }
        saveField(el.dataset.v30Edit, newVal).then(function () {
          if (STATE.candidate) STATE.candidate[el.dataset.v30Edit] = newVal;
          flashSaved();
        }).catch(function (err) {
          el.textContent = original;
          alert('Échec de sauvegarde : ' + err.message);
        });
      }
      function onKey(ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); el.textContent = original; el.blur(); }
      }
      function onBlur() {
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('blur', onBlur);
        commit(true);
      }
      el.addEventListener('keydown', onKey);
      el.addEventListener('blur', onBlur);
    });
  }

  // ─── Floating picker (more menu) ─────────────────────────
  var _activePicker = null;
  function closePicker() {
    if (_activePicker) {
      _activePicker.remove();
      _activePicker = null;
    }
  }
  function buildPicker(items, anchorEl) {
    var picker = document.createElement('div');
    picker.className = 'v30-fp-picker';
    picker.setAttribute('role', 'menu');
    items.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement('div');
        sep.className = 'v30-fp-picker__sep';
        picker.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v30-fp-picker__item' +
        (item.danger ? ' danger' : '');
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = item.html || esc(item.label || '');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closePicker();
        if (item.action) item.action();
      });
      picker.appendChild(btn);
    });
    var rect = anchorEl.getBoundingClientRect();
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.right = (window.innerWidth - rect.right) + 'px';
    document.body.appendChild(picker);
    _activePicker = picker;
    setTimeout(function () {
      document.addEventListener('click', closePicker, { once: true, capture: true });
    }, 0);
    return picker;
  }

  function buildVcf(c) {
    var lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push('FN:' + (c.name || ''));
    var parts = String(c.name || '').trim().split(/\s+/);
    if (parts.length >= 2) lines.push('N:' + parts.slice(1).join(' ') + ';' + parts[0]);
    if (c.email)    lines.push('EMAIL:' + c.email);
    if (c.phone)    lines.push('TEL:' + c.phone);
    if (c.telephone)lines.push('TEL:' + c.telephone);
    if (c.role)     lines.push('TITLE:' + c.role);
    if (c.location) lines.push('ADR:;;;' + c.location + ';;;');
    if (c.linkedin) lines.push('URL:' + c.linkedin);
    if (c.notes)    lines.push('NOTE:' + String(c.notes).replace(/\r?\n/g, '\\n'));
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }

  function downloadVcf() {
    var c = STATE.candidate || {};
    var vcf = buildVcf(c);
    var blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var safeName = (c.name || 'candidat').replace(/[^a-z0-9_\- ]/gi, '').replace(/\s+/g, '_');
    a.href = url; a.download = safeName + '.vcf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (window.showToast) window.showToast('Fiche VCF téléchargée', 'success');
  }

  function archiveCandidate(archived) {
    var label = archived ? 'Archiver' : 'Désarchiver';
    if (!confirm(label + ' ce candidat ?')) return;
    fetchPostJSON('/api/candidates/status', {
      id: CID,
      status: (STATE.candidate && STATE.candidate.status) || 'Vivier',
      is_archived: archived ? 1 : 0
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Échec');
      if (window.showToast) window.showToast(label + ' OK', 'success');
      if (STATE.candidate) STATE.candidate.is_archived = archived ? 1 : 0;
    }).catch(function (err) {
      if (window.showToast) window.showToast(label + ' : ' + err.message, 'error');
      else alert(label + ' : ' + err.message);
    });
  }

  function deleteCandidate() {
    var name = (STATE.candidate && STATE.candidate.name) || 'ce candidat';
    if (!confirm('Supprimer définitivement ' + name + ' ?')) return;
    fetchPostJSON('/api/candidates/delete', { ids: [CID] })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Échec');
        if (window.showToast) window.showToast('Candidat supprimé', 'success');
        setTimeout(function () { window.location.href = '/v30/sourcing'; }, 500);
      })
      .catch(function (err) {
        if (window.showToast) window.showToast('Suppression : ' + err.message, 'error');
        else alert('Suppression : ' + err.message);
      });
  }

  function openMoreMenu(anchorEl) {
    if (_activePicker) { closePicker(); return; }
    var c = STATE.candidate || {};
    var items = [];
    if (c.linkedin) {
      items.push({
        label: 'Voir sur LinkedIn',
        action: function () { window.open(c.linkedin, '_blank', 'noopener'); }
      });
    }
    items.push({
      label: 'Télécharger le dossier DC',
      action: function () { window.location.href = '/candidates/' + CID + '/dossier/download'; }
    });
    items.push({
      label: 'Exporter VCF',
      action: downloadVcf
    });
    items.push({ sep: true });
    var isArchived = !!(c.is_archived);
    items.push({
      label: isArchived ? 'Désarchiver' : 'Archiver',
      action: function () { archiveCandidate(!isArchived); }
    });
    items.push({
      label: 'Supprimer le candidat',
      danger: true,
      action: deleteCandidate
    });
    buildPicker(items, anchorEl);
  }

  // ─── Render text fields (entretien / eval / refs / avis) ─
  function renderSectionFields(c) {
    if (!c) return;
    var fields = [
      'entretien_date', 'entretien_lieu', 'entretien_notes',
      'eval_technique', 'eval_personnalite', 'eval_communication',
      'references_candidat', 'avis_perso'
    ];
    fields.forEach(function (f) {
      var el = document.querySelector('[data-field="' + f + '"]');
      if (!el) return;
      var val = c[f] || '';
      el.textContent = val || (f === 'entretien_date' ? '—' : '');
      if (!val) el.style.color = 'var(--text-3)';
      else el.style.color = '';
    });
  }

  // ─── Edit section modal ───────────────────────────────────
  var _editSection = null;

  var SECTION_DEFS = {
    informations: {
      title: 'Informations',
      fields: [
        { key: 'status',           label: 'Statut',              type: 'select',
          options: ['Nouveau', 'Vivier', 'Libre', 'En entretien', 'Placé', 'Archivé'] },
        { key: 'role',             label: 'Rôle / Poste',        type: 'text',  placeholder: 'Ex: Consultant Automatisme' },
        { key: 'location',         label: 'Localisation',         type: 'text',  placeholder: 'Ex: Lyon, Mobile France' },
        { key: 'years_experience', label: 'Expérience',           type: 'text',  placeholder: 'Ex: 5 ans, Senior',
          getValue: function(c) { return c.years_experience || c.annees_experience || c.seniority || ''; } },
        { key: 'sector',           label: 'Secteur',              type: 'text',  placeholder: 'Ex: Industrie, IT' },
        { key: 'source',           label: 'Source',               type: 'text',  placeholder: 'Ex: LinkedIn, Cooptation' },
        { key: 'tech',             label: 'Compétences tech',     type: 'text',  placeholder: 'Ex: Python, Java, AUTOSAR' },
        { key: 'phone',            label: 'Téléphone',            type: 'tel',   placeholder: '+33 6 XX XX XX XX' },
        { key: 'email',            label: 'Email',                type: 'email', placeholder: 'prenom.nom@example.com' },
        { key: 'linkedin',         label: 'LinkedIn',             type: 'url',   placeholder: 'https://linkedin.com/in/...' },
        { key: 'vsa_url',          label: 'Page VSA',             type: 'url',   placeholder: 'Lien vers la page VSA / OneNote du candidat' },
      ]
    },
    entretien: {
      title: 'Entretien',
      fields: [
        { key: 'entretien_date',  label: 'Date entretien', type: 'date' },
        { key: 'entretien_lieu',  label: 'Lieu',           type: 'text', placeholder: 'Ex: Visio / Bureau Paris' },
        { key: 'entretien_notes', label: 'Notes',          type: 'textarea', placeholder: 'Compte-rendu, observations…' }
      ]
    },
    evaluation: {
      title: 'Évaluation',
      fields: [
        { key: 'eval_technique',     label: 'Technique',     type: 'textarea', placeholder: 'Compétences techniques observées…' },
        { key: 'eval_personnalite',  label: 'Personnalité',  type: 'textarea', placeholder: 'Soft skills, caractère…' },
        { key: 'eval_communication', label: 'Communication', type: 'textarea', placeholder: 'Expression, aisance relationnelle…' }
      ]
    },
    references: {
      title: 'Références',
      fields: [
        { key: 'references_candidat', label: 'Références', type: 'textarea', placeholder: 'Nom, société, avis, contact…' }
      ]
    },
    avis: {
      title: 'Avis perso',
      fields: [
        { key: 'avis_perso', label: 'Avis personnel', type: 'textarea', placeholder: 'Votre avis sur ce candidat…' }
      ]
    }
  };

  function openSectionModal(section) {
    var def = SECTION_DEFS[section];
    if (!def) return;
    _editSection = section;
    var modal = document.querySelector('[data-v30-fc-edit-modal]');
    if (!modal) return;
    var titleEl = modal.querySelector('[id="v30-fc-edit-modal-title"]');
    if (titleEl) titleEl.textContent = def.title;
    var body = modal.querySelector('[data-v30-fc-edit-modal-body]');
    if (!body) return;
    var c = STATE.candidate || {};
    body.innerHTML = def.fields.map(function (f) {
      var val = f.getValue ? f.getValue(c) : (c[f.key] || '');
      var input = '';
      if (f.type === 'textarea') {
        input = '<textarea class="input" id="fc-edit-' + f.key + '" name="' + f.key +
          '" placeholder="' + esc(f.placeholder || '') + '" rows="3" style="width:100%;resize:vertical;">' +
          esc(val) + '</textarea>';
      } else if (f.type === 'select') {
        var opts = (f.options || []).slice();
        if (val && opts.indexOf(val) === -1) opts.unshift(val);
        input = '<select class="input" id="fc-edit-' + f.key + '" name="' + f.key + '" style="width:100%;">' +
          opts.map(function(opt) {
            return '<option value="' + esc(opt) + '"' + (val === opt ? ' selected' : '') + '>' + esc(opt) + '</option>';
          }).join('') +
        '</select>';
      } else {
        input = '<input class="input" type="' + f.type + '" id="fc-edit-' + f.key + '" name="' + f.key +
          '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder || '') + '" style="width:100%;">';
      }
      return '<div class="v30-field" style="margin-bottom:12px;">' +
        '<label for="fc-edit-' + f.key + '" style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-3);">' +
        esc(f.label) + '</label>' + input + '</div>';
    }).join('');
    modal.hidden = false;
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    var first = body.querySelector('input,textarea');
    if (first) first.focus();
  }

  function saveSectionModal() {
    var def = _editSection ? SECTION_DEFS[_editSection] : null;
    if (!def) return;
    var modal = document.querySelector('[data-v30-fc-edit-modal]');
    if (!modal) return;
    var payload = {};
    def.fields.forEach(function (f) {
      var el = modal.querySelector('[name="' + f.key + '"]');
      if (el) payload[f.key] = el.value.trim();
    });
    fetch('/api/candidates/' + CID, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function () {
      Object.assign(STATE.candidate, payload);
      renderSectionFields(STATE.candidate);
      if (_editSection === 'informations') {
        renderHeader(STATE.candidate);
        renderInfo(STATE.candidate);
        if (typeof updateEc1CardVisibility === 'function') updateEc1CardVisibility();
      }
      closeSectionModal();
      flashSaved();
      if (window.showToast) window.showToast('Modifications enregistrées', 'success', 2000);
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3000);
    });
  }

  function closeSectionModal() {
    var modal = document.querySelector('[data-v30-fc-edit-modal]');
    if (modal) {
      modal.classList.remove('is-open');
      setTimeout(function () { modal.hidden = true; }, 160);
    }
    _editSection = null;
  }

  function bindSectionEdit() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-fc-edit-section]');
      if (btn) { openSectionModal(btn.dataset.v30FcEditSection); return; }

      var closeBtn = e.target.closest('[data-v30-modal-close]');
      if (closeBtn && closeBtn.closest('[data-v30-fc-edit-modal]')) { closeSectionModal(); return; }

      var saveBtn = e.target.closest('[data-v30-fc-edit-modal-save]');
      if (saveBtn) { saveSectionModal(); return; }

      var backdrop = e.target.closest('[data-v30-fc-edit-modal]');
      if (backdrop && e.target === backdrop) closeSectionModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var modal = document.querySelector('[data-v30-fc-edit-modal]');
        if (modal && !modal.hidden) closeSectionModal();
      }
    });
  }

  // ─── Actions header ──────────────────────────────────────
  function bindActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-fc-action]');
      if (!btn) return;
      var act = btn.dataset.v30FcAction;
      if (act === 'dc')        window.location.href = '/v30/dc/' + CID;
      else if (act === 'push') window.location.href = '/v30/push?candidate=' + CID;
      else if (act === 'more') { e.stopPropagation(); openMoreMenu(btn); }
    });
  }

  // ─── Dossier de compétences (DC) ─────────────────────────
  //   GET    /api/candidates/:id/dc-status   → { ok, has_dc, files: [filename] }
  //   POST   /api/candidates/upload-dc       → multipart (dc, candidate_id) - upload/replace
  //   POST   /api/candidates/:id/dc-rename   → { new_name }
  //   POST   /api/candidates/:id/dc-delete   → -
  //   GET    /api/candidates/:id/dossier-competence → PDF stream
  function fmtDate(raw) {
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return ''; }
  }

  function renderDc() {
    var host = document.querySelector('[data-v30-fc-dc-status]');
    if (!host) return;
    var dc = STATE.dc || {};
    var files = dc.files || [];
    var generated = dc.generated || [];

    if (!dc.has_dc) {
      host.innerHTML =
        '<div class="v30-fc-dc-dropzone" data-v30-fc-dc-dropzone>' +
          '<div class="v30-fc-dc-dropzone__icon">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
              '<polyline points="17 8 12 3 7 8"/>' +
              '<line x1="12" y1="3" x2="12" y2="15"/>' +
            '</svg>' +
          '</div>' +
          '<div class="v30-fc-dc-dropzone__body">' +
            '<div class="v30-fc-dc-dropzone__label">Glisser un PDF ici</div>' +
            '<div class="v30-fc-dc-dropzone__sub">ou cliquer sur <strong>Charger</strong> — PDF uniquement</div>' +
          '</div>' +
        '</div>';
      return;
    }

    // Bouton "Enrichir via DC" — visible uniquement quand un PDF uploadé existe
    var enrichBtn = document.querySelector('[data-v30-fc-dc-enrich]');
    if (enrichBtn) enrichBtn.style.display = files.length ? '' : 'none';

    var html = '';

    // DC uploadé manuellement (PDF)
    if (files.length) {
      var fname = files[0];
      var pdfUrl = '/api/candidates/' + CID + '/dossier-competence';
      html +=
        '<div class="v30-fc-dc-row">' +
          '<span class="v30-fc-dc-dot v30-fc-dc-dot--on" aria-hidden="true"></span>' +
          '<div class="v30-fc-dc-name" data-v30-fc-dc-name title="' + esc(fname) + '">' + esc(fname) + '</div>' +
          '<div class="v30-fc-dc-actions">' +
            '<a class="btn btn-ghost btn-sm" href="' + esc(pdfUrl) + '" target="_blank" rel="noopener">Voir</a>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-dc-rename>Renommer</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-dc-replace>Remplacer</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-dc-delete style="color:var(--danger);">Supprimer</button>' +
          '</div>' +
        '</div>';
    }

    // DC générés via le générateur
    if (generated.length) {
      var latest = generated[0];
      html +=
        '<div class="v30-fc-dc-row" style="margin-top:' + (files.length ? '8px' : '0') + ';padding-top:' + (files.length ? '8px' : '0') + ';' + (files.length ? 'border-top:1px solid var(--border-1);' : '') + '">' +
          '<span class="v30-fc-dc-dot v30-fc-dc-dot--on" aria-hidden="true" style="background:var(--accent-blue,#3b82f6);"></span>' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="v30-fc-dc-name" title="' + esc(latest.filename) + '">' + esc(latest.filename) + '</div>' +
            '<div style="font-size:11px;color:var(--text-3);margin-top:2px;">Généré le ' + esc(latest.generated_at) + (latest.used_ollama ? ' · IA' : '') + '</div>' +
          '</div>' +
          '<div class="v30-fc-dc-actions">' +
            '<a class="btn btn-ghost btn-sm" href="' + esc(latest.download_url) + '" download="' + esc(latest.filename) + '">Télécharger</a>' +
          '</div>' +
        '</div>';
      if (generated.length > 1) {
        html += '<div style="margin-top:4px;font-size:11px;color:var(--text-3);">' + (generated.length - 1) + ' autre(s) version(s) dans <a href="/v30/dc/' + CID + '" style="color:var(--accent);">l\'historique</a>.</div>';
      }
    }

    host.innerHTML = html;
  }

  function loadDc() {
    return fetchJSON('/api/candidates/' + CID + '/dc-status')
      .then(function (res) { STATE.dc = res || { has_dc: false, files: [] }; renderDc(); })
      .catch(function () { STATE.dc = { has_dc: false, files: [] }; renderDc(); });
  }

  function uploadDc(file) {
    if (!file) return Promise.resolve();
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      if (window.showToast) window.showToast('Seuls les PDF sont acceptés', 'error');
      return Promise.resolve();
    }
    var fd = new FormData();
    fd.append('dc', file);
    fd.append('candidate_id', String(CID));
    if (window.showToast) window.showToast('Upload en cours…', 'info', 1500);
    return fetch('/api/candidates/upload-dc', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      body: fd
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur upload');
      if (window.showToast) window.showToast('DC chargé : ' + (res.filename || ''), 'success');
      flashSaved();
      return loadDc();
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur upload : ' + err.message, 'error', 3000);
      else alert('Erreur upload : ' + err.message);
    });
  }

  function renameDc() {
    var dc = STATE.dc || {};
    var current = (dc.files && dc.files[0]) || '';
    var base = current.replace(/\.pdf$/i, '');
    var next = prompt('Nouveau nom du fichier (sans extension) :', base);
    if (next == null) return;
    next = String(next).trim();
    if (!next || next === base) return;
    fetchPostJSON('/api/candidates/' + CID + '/dc-rename', { new_name: next })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        if (window.showToast) window.showToast('Fichier renommé : ' + (res.filename || next), 'success');
        flashSaved();
        return loadDc();
      })
      .catch(function (err) {
        if (window.showToast) window.showToast('Erreur renommage : ' + err.message, 'error', 3000);
        else alert('Erreur renommage : ' + err.message);
      });
  }

  function deleteDc() {
    var dc = STATE.dc || {};
    var fname = (dc.files && dc.files[0]) || 'le DC';
    if (!confirm('Supprimer ' + fname + ' ?\n\nCette action est définitive.')) return;
    fetchPostJSON('/api/candidates/' + CID + '/dc-delete', {})
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        if (window.showToast) window.showToast('DC supprimé', 'success');
        flashSaved();
        return loadDc();
      })
      .catch(function (err) {
        if (window.showToast) window.showToast('Erreur suppression : ' + err.message, 'error', 3000);
        else alert('Erreur suppression : ' + err.message);
      });
  }

  function bindDcActions() {
    var card = document.querySelector('[data-v30-fc-dc-card]');
    if (!card) return;
    var fileInput = card.querySelector('[data-v30-fc-dc-input]');

    card.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-fc-dc-enrich]')) { openDcEnrichModal(); return; }
      if (e.target.closest('[data-v30-fc-dc-generate]')) {
        window.location.href = '/v30/dc/' + CID;
        return;
      }
      if (e.target.closest('[data-v30-fc-dc-upload-btn]') || e.target.closest('[data-v30-fc-dc-replace]') || e.target.closest('[data-v30-fc-dc-dropzone]')) {
        if (fileInput) fileInput.click();
        return;
      }
      if (e.target.closest('[data-v30-fc-dc-rename]')) { renameDc(); return; }
      if (e.target.closest('[data-v30-fc-dc-delete]')) { deleteDc(); return; }
    });

    card.addEventListener('dragover', function (e) {
      if (!card.querySelector('[data-v30-fc-dc-dropzone]')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      var dz = card.querySelector('[data-v30-fc-dc-dropzone]');
      if (dz) dz.classList.add('is-over');
    });
    card.addEventListener('dragleave', function (e) {
      if (card.contains(e.relatedTarget)) return;
      var dz = card.querySelector('[data-v30-fc-dc-dropzone]');
      if (dz) dz.classList.remove('is-over');
    });
    card.addEventListener('drop', function (e) {
      var dz = card.querySelector('[data-v30-fc-dc-dropzone]');
      if (!dz) return;
      e.preventDefault();
      dz.classList.remove('is-over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) uploadDc(f);
    });

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        uploadDc(f).then(function () { fileInput.value = ''; });
      });
    }
  }

  // ─── Notes & suivi (timeline candidate_events) ───────────
  //   GET  /api/candidate/timeline?id=:id  → { ok, events: [{date, type, title, content, meta}] }
  //   POST /api/candidate/events/add       → { candidate_id, type, title, content, date }
  function relativeTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return esc(String(iso).slice(0, 10));
      var diff = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diff < 60) return 'à l\'instant';
      if (diff < 3600) return 'il y a ' + Math.floor(diff / 60) + ' min';
      if (diff < 86400) return 'il y a ' + Math.floor(diff / 3600) + ' h';
      if (diff < 86400 * 30) return 'il y a ' + Math.floor(diff / 86400) + ' j';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return ''; }
  }

  function eventTitleFor(e) {
    if (e.title) return e.title;
    var t = e.type || '';
    if (t === 'note')              return 'Note';
    if (t === 'candidate_solid')   return 'Candidat solide';
    if (t === 'candidate_contacted') return 'Candidat contacté';
    if (t.indexOf('push') === 0)   return 'Push';
    if (t === 'status_change')     return 'Changement de statut';
    if (t === 'dc_uploaded')       return 'DC chargé';
    return 'Événement';
  }

  function eventDotColor(t) {
    switch ((t || '').toLowerCase()) {
      case 'note':                return 'var(--accent, #5b8def)';
      case 'candidate_solid':     return 'var(--success, #2ecc71)';
      case 'candidate_contacted': return 'var(--warn, #f39c12)';
      case 'status_change':       return 'var(--text-3)';
      case 'push':
      case 'candidate_push':      return 'var(--accent, #5b8def)';
      default:                    return 'var(--text-3)';
    }
  }

  function renderEvents() {
    var host = document.querySelector('[data-v30-fc-events]');
    if (!host) return;
    var events = STATE.events || [];
    if (!events.length) {
      host.innerHTML = '<div class="empty" style="padding:14px 16px;font-size:12px;color:var(--text-3);">' +
        'Aucune note ni événement. Cliquez sur <strong>+ Note</strong> pour ajouter un compte-rendu d\'après RDV.' +
      '</div>';
      return;
    }
    host.innerHTML = events.slice(0, 30).map(function (e) {
      var when  = relativeTime(e.date);
      var title = eventTitleFor(e);
      var body  = e.content || '';
      var dot   = eventDotColor(e.type);
      return '<div class="v30-fp-ev">' +
        '<span class="v30-fp-ev__time mono">' + esc(when) + '</span>' +
        '<span class="v30-fp-ev__dot" style="background:' + dot + ';"></span>' +
        '<div>' +
          '<div class="v30-fp-ev__title">' + esc(title) + '</div>' +
          (body ? '<div class="v30-fp-ev__body">' + esc(body).replace(/\n/g, '<br>') + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function loadEvents() {
    return fetchJSON('/api/candidate/timeline?id=' + CID)
      .then(function (res) { STATE.events = (res && res.events) || []; renderEvents(); })
      .catch(function () { STATE.events = []; renderEvents(); });
  }

  function bindNoteForm() {
    var card = document.querySelector('[data-v30-fc-timeline-card]');
    if (!card) return;
    var form = card.querySelector('[data-v30-fc-note-form]');
    var titleEl = card.querySelector('[data-v30-fc-note-title]');
    var textEl = card.querySelector('[data-v30-fc-note-text]');

    card.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-fc-add-note]')) {
        if (!form) return;
        form.style.display = 'block';
        if (titleEl && !titleEl.value) titleEl.value = 'Note d\'après RDV';
        if (textEl) textEl.focus();
        return;
      }
      if (e.target.closest('[data-v30-fc-note-cancel]')) {
        if (form) form.style.display = 'none';
        if (titleEl) titleEl.value = '';
        if (textEl) textEl.value = '';
        return;
      }
      if (e.target.closest('[data-v30-fc-note-save]')) {
        var title = (titleEl && titleEl.value || '').trim() || 'Note';
        var text  = (textEl && textEl.value || '').trim();
        if (!text) { if (textEl) textEl.focus(); return; }
        var saveBtn = e.target.closest('[data-v30-fc-note-save]');
        if (saveBtn) saveBtn.disabled = true;
        fetchPostJSON('/api/candidate/events/add', {
          candidate_id: CID,
          type: 'note',
          title: title,
          content: text
        }).then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
          if (form) form.style.display = 'none';
          if (titleEl) titleEl.value = '';
          if (textEl)  textEl.value = '';
          flashSaved();
          if (window.showToast) window.showToast('Note ajoutée', 'success', 1500);
          return loadEvents();
        }).catch(function (err) {
          if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3000);
          else alert('Erreur : ' + err.message);
        }).finally(function () {
          if (saveBtn) saveBtn.disabled = false;
        });
      }
    });
  }

  // ─── Enrichissement fiche depuis DC (IA) ─────────────────
  var ENRICH_FIELDS = [
    { key: 'name',                   label: 'Nom complet' },
    { key: 'prenom',                 label: 'Prénom' },
    { key: 'role',                   label: 'Rôle / Poste' },
    { key: 'location',               label: 'Localisation' },
    { key: 'sector',                 label: 'Secteur' },
    { key: 'domaine_principal',      label: 'Domaine principal' },
    { key: 'tech',                   label: 'Compétences tech' },
    { key: 'years_experience',       label: 'Expérience (années)',
      getValue: function(c) { return c.years_experience || c.annees_experience || c.seniority || ''; } },
    { key: 'phone',                  label: 'Téléphone' },
    { key: 'email',                  label: 'Email' },
    { key: 'linkedin',               label: 'LinkedIn' },
    { key: 'langues',                label: 'Langues' },
    { key: 'disponibilite',          label: 'Disponibilité' },
    { key: 'mobilite',               label: 'Mobilité' },
    { key: 'permis_travail',         label: 'Permis de travail' },
    { key: 'pretentions_salariales', label: 'Prétentions salariales' },
    { key: 'remuneration_actuelle',  label: 'Rémunération actuelle' },
    { key: 'motif_recherche',        label: 'Motif de recherche' },
    { key: 'fonctions_recherchees',  label: 'Fonctions recherchées' },
    { key: 'eval_technique',         label: 'Évaluation technique' },
    { key: 'eval_personnalite',      label: 'Évaluation personnalité' },
    { key: 'eval_communication',     label: 'Évaluation communication' },
  ];

  // Modale générique d'enrichissement : analyse un document (DC ou pièce
  // jointe) via IA puis affiche une comparaison champ par champ.
  function openEnrichModal(url, titleText) {
    var modal = document.querySelector('[data-v30-fc-dc-enrich-modal]');
    if (!modal) return;
    var titleEl = modal.querySelector('[data-v30-fc-enrich-title-text]');
    if (titleEl) titleEl.textContent = titleText || 'Enrichir la fiche depuis un document';
    var body = modal.querySelector('[data-v30-fc-dc-enrich-body]');
    if (body) body.innerHTML =
      '<div style="padding:28px 0;text-align:center;color:var(--text-3);font-size:13px;">' +
        'Analyse du document en cours via IA…<br><br>' +
        '<div class="skel" style="width:80%;height:12px;margin:6px auto;"></div>' +
        '<div class="skel" style="width:65%;height:12px;margin:6px auto;"></div>' +
        '<div class="skel" style="width:72%;height:12px;margin:6px auto;"></div>' +
      '</div>';
    STATE.enrichFields = null;
    modal.hidden = false;
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    var applyBtn = modal.querySelector('[data-v30-dc-enrich-apply]');
    if (applyBtn) applyBtn.disabled = true;
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json().then(
        function (j) { return { httpOk: r.ok, body: j }; },
        function () { return { httpOk: false, body: { error: 'HTTP ' + r.status } }; }
      );
    }).then(function (res) {
      if (!res.httpOk || !res.body || !res.body.ok) {
        throw new Error((res.body && res.body.error) || 'Erreur IA');
      }
      STATE.enrichFields = res.body.fields || {};
      renderDcEnrichFields(STATE.enrichFields);
      if (applyBtn) applyBtn.disabled = false;
    }).catch(function (err) {
      if (body) body.innerHTML =
        '<div style="padding:28px;text-align:center;color:var(--danger);font-size:13px;">' +
          'Erreur : ' + esc(String(err.message)) + '</div>';
    });
  }

  function openDcEnrichModal() {
    openEnrichModal('/api/candidates/' + CID + '/dc-enrich', 'Enrichir la fiche depuis le DC');
  }

  function renderDcEnrichFields(fields) {
    var c = STATE.candidate || {};
    var body = document.querySelector('[data-v30-fc-dc-enrich-body]');
    if (!body) return;
    var visibleFields = ENRICH_FIELDS.filter(function (f) {
      var extracted = fields[f.key];
      return extracted != null && String(extracted).trim() !== '';
    });
    if (!visibleFields.length) {
      body.innerHTML =
        '<div style="padding:28px;text-align:center;color:var(--text-3);font-size:13px;">' +
          'L\'IA n\'a pas pu extraire d\'informations exploitables de ce DC.</div>';
      return;
    }
    var html =
      '<div style="font-size:12px;color:var(--text-3);padding:10px 0 10px;">' +
        'Vérifiez les champs extraits et cochez ceux à appliquer sur la fiche candidat :' +
      '</div>' +
      '<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden;">';
    visibleFields.forEach(function (f, i) {
      var currentRaw = f.getValue ? f.getValue(c) : (c[f.key] || '');
      var current = String(currentRaw || '').trim();
      var extracted = String(fields[f.key] || '').trim();
      var same = current === extracted;
      var checked = (!same && extracted) ? ' checked' : '';
      html +=
        '<div style="display:grid;grid-template-columns:24px 1fr 1fr;gap:10px;align-items:start;padding:10px 12px;' +
          (i > 0 ? 'border-top:1px solid var(--border);' : '') + '">' +
          '<input type="checkbox" data-enrich-key="' + f.key + '"' + checked + ' style="margin-top:3px;">' +
          '<div>' +
            '<div style="font-size:10.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">' + esc(f.label) + ' · actuel</div>' +
            '<div style="font-size:12.5px;color:var(--text-2);">' +
              (current ? esc(current) : '<span style="color:var(--text-3);font-style:italic;">—</span>') +
            '</div>' +
          '</div>' +
          '<div style="background:var(--surface-2);border-radius:4px;padding:7px 8px;">' +
            '<div style="font-size:10.5px;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">Extrait du DC</div>' +
            '<div style="font-size:12.5px;font-weight:500;">' + esc(extracted) + '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    body.innerHTML = html;
  }

  function applyDcEnrich() {
    var modal = document.querySelector('[data-v30-fc-dc-enrich-modal]');
    if (!modal) return;
    var src = STATE.enrichFields || {};
    var payload = {};
    modal.querySelectorAll('[data-enrich-key]:checked').forEach(function (cb) {
      var k = cb.dataset.enrichKey;
      if (src[k] != null && String(src[k]).trim() !== '') payload[k] = String(src[k]);
    });
    if (!Object.keys(payload).length) { closeDcEnrichModal(); return; }
    var applyBtn = modal.querySelector('[data-v30-dc-enrich-apply]');
    if (applyBtn) applyBtn.disabled = true;
    fetch('/api/candidates/' + CID, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function () {
      Object.assign(STATE.candidate, payload);
      renderHeader(STATE.candidate);
      renderInfo(STATE.candidate);
      renderSectionFields(STATE.candidate);
      closeDcEnrichModal();
      flashSaved();
      var n = Object.keys(payload).length;
      if (window.showToast) window.showToast('Fiche enrichie (' + n + ' champ' + (n > 1 ? 's' : '') + ')', 'success', 2500);
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3000);
      if (applyBtn) applyBtn.disabled = false;
    });
  }

  function closeDcEnrichModal() {
    var modal = document.querySelector('[data-v30-fc-dc-enrich-modal]');
    if (modal) {
      modal.classList.remove('is-open');
      setTimeout(function () { modal.hidden = true; }, 160);
    }
  }

  function bindDcEnrichModal() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-dc-enrich-close]')) { closeDcEnrichModal(); return; }
      if (e.target.closest('[data-v30-dc-enrich-apply]')) { applyDcEnrich(); return; }
      var modal = document.querySelector('[data-v30-fc-dc-enrich-modal]');
      if (modal && !modal.hidden && e.target === modal) closeDcEnrichModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var modal = document.querySelector('[data-v30-fc-dc-enrich-modal]');
        if (modal && !modal.hidden) { closeDcEnrichModal(); e.stopPropagation(); }
      }
    });
  }

  // ─── Pièces jointes candidat ─────────────────────────────
  //   GET    /api/candidates/:id/attachments
  //   POST   /api/candidates/:id/attachments       (multipart)
  //   GET    /api/candidate-attachments/:aid/file
  //   PATCH  /api/candidate-attachments/:aid       { title, description, kind }
  //   DELETE /api/candidate-attachments/:aid
  var ATT_KIND_LABELS = { cv: 'CV', ec1: 'Fiche EC1', suivi: 'Suivi', autre: 'Autre' };

  function fmtSize(n) {
    n = Number(n || 0);
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' Ko';
    return (n / (1024 * 1024)).toFixed(1) + ' Mo';
  }
  function fmtAttDate(raw) {
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
    } catch (_) { return ''; }
  }

  function attDropzoneHtml() {
    return '<div class="v30-fc-att-dropzone" data-v30-fc-att-dropzone>' +
      '<div class="v30-fc-att-dropzone__icon">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
          '<polyline points="17 8 12 3 7 8"/>' +
          '<line x1="12" y1="3" x2="12" y2="15"/>' +
        '</svg>' +
      '</div>' +
      '<div>' +
        '<div class="v30-fc-att-dropzone__label">Glisser un fichier ici</div>' +
        '<div class="v30-fc-att-dropzone__sub">CV, fiche entretien Excel, fichier de suivi… (pdf, docx, xlsx, pptx, jpg, png — 50 Mo max)</div>' +
      '</div>' +
    '</div>';
  }

  function renderAttachments() {
    var host = document.querySelector('[data-v30-fc-att-list]');
    if (!host) return;
    var items = STATE.attachments || [];
    if (!items.length) {
      host.innerHTML = attDropzoneHtml();
      return;
    }
    var rows = items.map(function (a) {
      var name = a.title || a.original_name || 'Fichier';
      var kindLbl = ATT_KIND_LABELS[a.kind] || 'Autre';
      var fileUrl = '/api/candidate-attachments/' + a.id + '/file';
      var enrichable = _attEnrichable(a);
      return '<div class="v30-fc-att-row">' +
        '<span class="badge" style="font-size:10.5px;">' + esc(kindLbl) + '</span>' +
        '<div class="v30-fc-att-row__name">' +
          '<div style="font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.original_name) + '">' + esc(name) + '</div>' +
          '<div class="v30-fc-att-row__meta">' + esc(a.original_name) + ' · ' + fmtSize(a.size) + ' · ' + esc(fmtAttDate(a.createdAt)) + '</div>' +
        '</div>' +
        '<div class="v30-fc-att-row__actions">' +
          (enrichable ?
            '<button type="button" class="btn btn-ghost btn-sm v30-fc-att-enrich" data-v30-fc-att-enrich="' + a.id + '" title="Analyser ce document via IA et enrichir la fiche">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
                '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></svg>' +
            '</button>' : '') +
          '<a class="btn btn-ghost btn-sm" href="' + esc(fileUrl) + '" target="_blank" rel="noopener" title="Télécharger">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          '</a>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-att-rename="' + a.id + '" title="Renommer">Renommer</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-att-delete="' + a.id + '" title="Supprimer" style="color:var(--danger);">×</button>' +
        '</div>' +
      '</div>';
    }).join('');
    // Toujours afficher la dropzone en bas pour pouvoir glisser un nouveau fichier
    host.innerHTML = rows + attDropzoneHtml();
  }

  function loadAttachments() {
    return fetchJSON('/api/candidates/' + CID + '/attachments')
      .then(function (res) {
        STATE.attachments = (res && res.attachments) || [];
        renderAttachments();
      })
      .catch(function () { STATE.attachments = []; renderAttachments(); });
  }

  function uploadAttachment(file, kind) {
    if (!file) return Promise.resolve();
    var fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind || 'autre');
    if (window.showToast) window.showToast('Upload en cours…', 'info', 1500);
    return fetch('/api/candidates/' + CID + '/attachments', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      body: fd
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur upload');
      if (window.showToast) window.showToast('Fichier ajouté : ' + (res.original_name || ''), 'success', 2000);
      flashSaved();
      return loadAttachments();
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur upload : ' + err.message, 'error', 3000);
      else alert('Erreur upload : ' + err.message);
    });
  }

  function renameAttachment(aId) {
    var att = (STATE.attachments || []).find(function (a) { return String(a.id) === String(aId); });
    if (!att) return;
    var current = att.title || att.original_name || '';
    var next = prompt('Titre du fichier (visible dans la liste) :', current);
    if (next == null) return;
    next = String(next).trim();
    if (!next || next === current) return;
    fetch('/api/candidate-attachments/' + aId, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
      flashSaved();
      return loadAttachments();
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 2500);
      else alert('Erreur : ' + err.message);
    });
  }

  function deleteAttachment(aId) {
    var att = (STATE.attachments || []).find(function (a) { return String(a.id) === String(aId); });
    var label = att ? (att.title || att.original_name || 'ce fichier') : 'ce fichier';
    if (!confirm('Supprimer ' + label + ' ?\n\nCette action est définitive.')) return;
    fetch('/api/candidate-attachments/' + aId, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
      if (window.showToast) window.showToast('Fichier supprimé', 'success', 1800);
      flashSaved();
      return loadAttachments();
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 2500);
      else alert('Erreur : ' + err.message);
    });
  }

  function _detectAttKind(file) {
    var ext = ((file && file.name || '').match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (/^\.(pdf|docx?|odt)$/.test(ext)) return 'cv';
    if (/^\.(xlsx?|ods|csv)$/.test(ext)) return 'suivi';
    return 'autre';
  }

  // Pièce jointe dont le texte est exploitable par l'IA (sinon pas de bouton).
  function _attEnrichable(a) {
    var nm = (a && (a.original_name || a.filename) || '');
    var ext = (nm.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    return /^\.(pdf|docx|txt|xlsx|csv)$/.test(ext);
  }

  function bindAttachmentsCard() {
    var card = document.querySelector('[data-v30-fc-att-card]');
    if (!card) return;
    var fileInput = card.querySelector('[data-v30-fc-att-input]');

    card.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-fc-att-upload-btn]') ||
          e.target.closest('[data-v30-fc-att-dropzone]')) {
        if (fileInput) fileInput.click();
        return;
      }
      var enrichBtn = e.target.closest('[data-v30-fc-att-enrich]');
      if (enrichBtn) {
        var aid = enrichBtn.dataset.v30FcAttEnrich;
        var att = (STATE.attachments || []).find(function (a) { return String(a.id) === String(aid); });
        var nm = att ? (att.title || att.original_name || 'document') : 'document';
        openEnrichModal('/api/candidate-attachments/' + aid + '/enrich', 'Enrichir depuis : ' + nm);
        return;
      }
      var renameBtn = e.target.closest('[data-v30-fc-att-rename]');
      if (renameBtn) { renameAttachment(renameBtn.dataset.v30FcAttRename); return; }
      var delBtn = e.target.closest('[data-v30-fc-att-delete]');
      if (delBtn) { deleteAttachment(delBtn.dataset.v30FcAttDelete); return; }
    });

    // Drag & drop sur toute la carte (pas seulement la dropzone)
    card.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      var dz = card.querySelector('[data-v30-fc-att-dropzone]');
      if (dz) dz.classList.add('is-over');
    });
    card.addEventListener('dragleave', function (e) {
      if (card.contains(e.relatedTarget)) return;
      var dz = card.querySelector('[data-v30-fc-att-dropzone]');
      if (dz) dz.classList.remove('is-over');
    });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      var dz = card.querySelector('[data-v30-fc-att-dropzone]');
      if (dz) dz.classList.remove('is-over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) uploadAttachment(f, _detectAttKind(f));
    });

    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        uploadAttachment(f, _detectAttKind(f)).then(function () { fileInput.value = ''; });
      });
    }
  }

  // ─── EC1 (Excel + transcription IA) ──────────────────────
  function updateEc1CardVisibility() {
    // EC1 actions sont intégrées dans la carte Entretien (slot [data-v30-fc-ec1-actions])
    var slot = document.querySelector('[data-v30-fc-ec1-actions]');
    if (!slot) return;
    var status = (STATE.candidate && (STATE.candidate.status || '')) || '';
    var s = String(status).toLowerCase();
    // Visible quand statut indique un entretien EC1 :
    //   - 'entretien' (valeur post-migration v30 — défaut pour ec1/ec2/en_cours)
    //   - 'ec1', 'ec2', 'en entretien' (legacy)
    //   - tout statut contenant 'ec1' ou 'ec2'
    var show = (
      s === 'entretien' ||
      s === 'en entretien' ||
      s === 'ec1' || s === 'ec2' ||
      /ec[12]/.test(s)
    );
    slot.style.display = show ? '' : 'none';
  }

  function downloadEc1Excel() {
    var url = '/api/candidates/' + CID + '/ec1-export.xlsx';
    if (window.showToast) window.showToast('Génération de la fiche Excel…', 'info', 1500);
    // Téléchargement via lien direct
    var a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); }, 100);
  }

  // ─── Modèle du formulaire EC1 (calé sur le template Excel) ───
  var EC1_FORM_SECTIONS = [
    { title: 'Identité', fields: [
      { key: 'name', label: 'Prénom Nom', type: 'text' },
      { key: 'phone', label: 'Téléphone', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'diplomes_experience', label: 'Diplômes et expérience', type: 'text', full: true },
      { key: 'date_lieu_naissance', label: 'Date et lieu de naissance', type: 'text' },
      { key: 'etat_civil', label: 'État civil', type: 'text' },
      { key: 'source', label: 'Source CV', type: 'text' },
      { key: 'recruteur_trigramme', label: 'Recruteur (trigramme)', type: 'text' },
      { key: 'ec1_date', label: 'Date EC1', type: 'date' }
    ]},
    { title: 'Administratif', fields: [
      { key: 'permis_conduire', label: 'Permis de conduire', type: 'bool' },
      { key: 'vehicule', label: 'Véhicule', type: 'bool' },
      { key: 'permis_travail', label: 'Permis de travail', type: 'text' },
      { key: 'demarches_administratives', label: 'Détails démarches administratives', type: 'textarea', full: true }
    ]},
    { title: 'Disponibilité & mobilité', fields: [
      { key: 'disponibilite', label: 'Disponibilité', type: 'text' },
      { key: 'domicile', label: 'Domicile', type: 'text' },
      { key: 'mobilite', label: 'Zones de mobilité', type: 'zones', full: true }
    ]},
    { title: 'Recherche', fields: [
      { key: 'fonctions_recherchees', label: 'Fonctions recherchées', type: 'textarea', full: true },
      { key: 'motif_recherche', label: 'Motif / motivations', type: 'textarea', full: true }
    ]},
    { title: 'Rémunération', fields: [
      { key: 'remuneration_actuelle', label: 'Rémunération actuelle', type: 'text' },
      { key: 'pretentions_salariales', label: 'Prétentions salariales', type: 'text' },
      { key: 'propal_a', label: 'Propal à', type: 'text' },
      { key: 'mail_recap', label: 'Mail récap envoyé', type: 'text' },
      { key: 'montant_recap', label: 'Montant', type: 'text' },
      { key: 'avancement_recherches', label: 'Avancement des recherches', type: 'textarea', full: true }
    ]},
    { title: 'Évaluation', fields: [
      { key: 'eval_technique', label: 'Éval. technique', type: 'textarea', full: true },
      { key: 'eval_personnalite', label: 'Éval. personnalité', type: 'textarea', full: true },
      { key: 'eval_communication', label: 'Éval. communication', type: 'textarea', full: true },
      { key: 'avis_perso', label: 'Avis / synthèse perso', type: 'textarea', full: true },
      { key: 'ec1_statut', label: 'Statut EC1', type: 'text' }
    ]},
    { title: 'Langues', fields: [
      { key: 'langues', label: 'Langues', type: 'text', full: true }
    ]},
    { title: 'Références', fields: [
      { key: 'references_candidat', label: 'Références transmises', type: 'textarea', full: true }
    ]},
    { title: 'Notes EC1', fields: [
      { key: 'entretien_notes', label: 'Compte-rendu / notes EC1', type: 'textarea', full: true }
    ]}
  ];
  var EC1_CHECKLIST_ITEMS = [
    ['mobilite_dispo_souhaits', 'Infos : mobilité, disponibilité, souhaits'],
    ['impression_generale', 'Impression générale / debrief candidat'],
    ['evaluation_technique', 'Évaluation technique'],
    ['evaluation_personnalite', 'Évaluation personnalité'],
    ['evaluation_communication', 'Évaluation communication'],
    ['rappel_valeurs_up', 'Rappel usages / valeurs Up'],
    ['fourchette_salaire', "Annonce d'une fourchette de salaire"],
    ['reponse_questions_craintes', 'Réponses aux questions / craintes'],
    ['process_prochaines_etapes', 'Détail du process et prochaines étapes']
  ];
  // Zones de mobilité — calquées sur les cases à cocher du template Excel.
  var EC1_MOBILITY_ZONES = [
    'Banlieue parisienne', 'Lyon', 'Aix', 'Sophia', 'Paris', 'Grenoble',
    'Toulon', 'Province', 'Nationale', 'Valence', 'Montpellier', 'Rennes',
    'Internationale'
  ];
  function ec1ZoneSet(str) {
    var set = {};
    String(str || '').split(',').forEach(function (p) {
      var t = p.trim().toLowerCase();
      if (t) set[t] = true;
    });
    return set;
  }
  function ec1IsTrue(v) {
    return /^(oui|1|true|on|yes)$/i.test(String(v == null ? '' : v).trim());
  }

  // Fusionne la réponse serveur en état de formulaire (valeurs + provenance IA).
  function buildEc1State(res) {
    var ai = (res && res.fields) || {};
    var cand = (res && res.candidate) || {};
    var meta = (res && res.meta) || {};
    var values = {}, aiKeys = {};
    EC1_FORM_SECTIONS.forEach(function (sec) {
      sec.fields.forEach(function (f) {
        var v = cand[f.key];
        values[f.key] = (v == null ? '' : String(v));
      });
    });
    Object.keys(ai).forEach(function (k) {
      var v = ai[k];
      if (v == null || String(v).trim() === '') return;
      if (Object.prototype.hasOwnProperty.call(values, k)) {
        values[k] = String(v);
        aiKeys[k] = true;
      }
    });
    if (meta.recruteur_trigramme && !values.recruteur_trigramme) values.recruteur_trigramme = meta.recruteur_trigramme;
    if (meta.ec1_date && !values.ec1_date) values.ec1_date = meta.ec1_date;
    return { values: values, aiKeys: aiKeys, checklist: (res && res.checklist) || {} };
  }

  function renderEc1Form(st) {
    var host = document.querySelector('[data-v30-fc-ec1-fields]');
    if (!host) return;
    var html = '';
    EC1_FORM_SECTIONS.forEach(function (sec) {
      html += '<div class="v30-ec1-sec">';
      html += '<div class="v30-ec1-sec__title">' + esc(sec.title) + '</div>';
      html += '<div class="v30-ec1-grid">';
      sec.fields.forEach(function (f) {
        var val = st.values[f.key] || '';
        var isAi = !!st.aiKeys[f.key];
        html += '<div class="v30-ec1-field' + (f.full ? ' is-full' : '') + '">';
        html += '<label class="v30-ec1-field__label" for="ec1f-' + f.key + '">' + esc(f.label);
        if (isAi) html += ' <span class="v30-ec1-badge" title="Pré-rempli par l\'IA">IA</span>';
        html += '</label>';
        if (f.type === 'textarea') {
          html += '<textarea id="ec1f-' + f.key + '" class="v30-ec1-input" rows="3" data-ec1-field="' + f.key + '">' + esc(val) + '</textarea>';
        } else if (f.type === 'select') {
          html += '<select id="ec1f-' + f.key + '" class="v30-ec1-input" data-ec1-field="' + f.key + '">';
          (f.options || []).forEach(function (o) {
            html += '<option value="' + esc(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + esc(o || '—') + '</option>';
          });
          html += '</select>';
        } else if (f.type === 'bool') {
          html += '<label class="v30-ec1-check v30-ec1-bool"><input type="checkbox" data-ec1-field="' + f.key + '" data-ec1-bool="1"' + (ec1IsTrue(val) ? ' checked' : '') + '><span>Oui</span></label>';
        } else if (f.type === 'zones') {
          var zset = ec1ZoneSet(val);
          html += '<div class="v30-ec1-zones">';
          EC1_MOBILITY_ZONES.forEach(function (z) {
            html += '<label class="v30-ec1-check"><input type="checkbox" data-ec1-zone="' + esc(z) + '"' + (zset[z.toLowerCase()] ? ' checked' : '') + '><span>' + esc(z) + '</span></label>';
          });
          html += '</div>';
        } else {
          var t = (f.type === 'date') ? 'date' : 'text';
          html += '<input type="' + t + '" id="ec1f-' + f.key + '" class="v30-ec1-input" data-ec1-field="' + f.key + '" value="' + esc(val) + '">';
        }
        html += '</div>';
      });
      html += '</div></div>';
    });
    var done = 0;
    EC1_CHECKLIST_ITEMS.forEach(function (it) {
      if (st.checklist[it[0]] && st.checklist[it[0]].checked) done++;
    });
    html += '<div class="v30-ec1-sec">';
    html += '<div class="v30-ec1-sec__title">Checklist EC1 <span class="v30-ec1-count" data-ec1-count>' + done + '/' + EC1_CHECKLIST_ITEMS.length + '</span></div>';
    html += '<div class="v30-ec1-checklist">';
    EC1_CHECKLIST_ITEMS.forEach(function (it) {
      var ck = st.checklist[it[0]] && st.checklist[it[0]].checked;
      html += '<label class="v30-ec1-check"><input type="checkbox" data-ec1-check="' + it[0] + '"' + (ck ? ' checked' : '') + '><span>' + esc(it[1]) + '</span></label>';
    });
    html += '</div></div>';
    host.innerHTML = html;
    host.querySelectorAll('[data-ec1-check]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var n = host.querySelectorAll('[data-ec1-check]:checked').length;
        var badge = host.querySelector('[data-ec1-count]');
        if (badge) badge.textContent = n + '/' + EC1_CHECKLIST_ITEMS.length;
      });
    });
  }

  function collectEc1Form() {
    var modal = document.querySelector('[data-v30-fc-ec1-modal]');
    var fields = {}, checklist = {};
    if (modal) {
      modal.querySelectorAll('[data-ec1-field]').forEach(function (el) {
        var key = el.getAttribute('data-ec1-field');
        if (el.getAttribute('data-ec1-bool')) {
          fields[key] = el.checked ? 'Oui' : 'Non';
        } else {
          fields[key] = el.value;
        }
      });
      var zones = [];
      modal.querySelectorAll('[data-ec1-zone]').forEach(function (el) {
        if (el.checked) zones.push(el.getAttribute('data-ec1-zone'));
      });
      fields.mobilite = zones.join(', ');
      modal.querySelectorAll('[data-ec1-check]').forEach(function (el) {
        checklist[el.getAttribute('data-ec1-check')] = { checked: !!el.checked, note: '' };
      });
    }
    return { fields: fields, checklist: checklist };
  }

  function analyzeEc1Transcript() {
    var modal = document.querySelector('[data-v30-fc-ec1-modal]');
    if (!modal) return;
    var textarea = modal.querySelector('[data-v30-fc-ec1-transcript-input]');
    var transcript = (textarea && textarea.value || '').trim();
    if (!transcript) {
      if (window.showToast) window.showToast('Veuillez coller la transcription', 'warning', 2000);
      else alert('Transcription vide');
      return;
    }
    var loader = modal.querySelector('[data-v30-fc-ec1-loader]');
    var result = modal.querySelector('[data-v30-fc-ec1-result]');
    var applyBtn = modal.querySelector('[data-v30-fc-ec1-apply]');
    var applyDlBtn = modal.querySelector('[data-v30-fc-ec1-apply-download]');
    if (loader) loader.style.display = '';
    if (result) result.style.display = 'none';
    if (applyBtn) applyBtn.disabled = true;
    if (applyDlBtn) applyDlBtn.disabled = true;

    fetch('/api/candidates/' + CID + '/ec1-from-transcript', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcript })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        return { ok: r.ok, body: j };
      });
    }).then(function (w) {
      if (loader) loader.style.display = 'none';
      var res = w.body;
      if (!w.ok || !res || !res.ok) throw new Error((res && res.error) || 'Erreur IA');
      STATE.ec1Preview = buildEc1State(res);
      renderEc1Form(STATE.ec1Preview);
      if (result) result.style.display = '';
      if (applyBtn) applyBtn.disabled = false;
      if (applyDlBtn) applyDlBtn.disabled = false;
      var box = modal.querySelector('[data-v30-fc-ec1-transcript-box]');
      if (box) box.open = false;
    }).catch(function (err) {
      if (loader) loader.style.display = 'none';
      if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3500);
      else alert('Erreur : ' + err.message);
    });
  }

  function afterEc1Apply() {
    flashSaved();
    closeEc1Modal();
    fetchJSON('/api/candidates/' + CID).then(function (data) {
      var cand = data && (data.candidate || data);
      if (cand) {
        STATE.candidate = cand;
        renderHeader(STATE.candidate);
        renderInfo(STATE.candidate);
        renderSectionFields(STATE.candidate);
        updateEc1CardVisibility();
      }
    }).catch(function () {});
  }

  function applyEc1Form(doDownload) {
    var modal = document.querySelector('[data-v30-fc-ec1-modal]');
    if (!modal) return;
    var payload = collectEc1Form();
    var applyBtn = modal.querySelector('[data-v30-fc-ec1-apply]');
    var applyDlBtn = modal.querySelector('[data-v30-fc-ec1-apply-download]');
    if (applyBtn) applyBtn.disabled = true;
    if (applyDlBtn) applyDlBtn.disabled = true;
    var reEnable = function () {
      if (applyBtn) applyBtn.disabled = false;
      if (applyDlBtn) applyDlBtn.disabled = false;
    };

    if (doDownload) {
      if (window.showToast) window.showToast('Génération de la fiche Excel…', 'info', 1800);
      fetch('/api/candidates/' + CID + '/ec1-export.xlsx', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(
            function (j) { throw new Error((j && j.error) || ('HTTP ' + r.status)); },
            function () { throw new Error('HTTP ' + r.status); }
          );
        }
        return r.blob();
      }).then(function (blob) {
        var name = ((STATE.candidate && STATE.candidate.name) || 'candidat').replace(/[^A-Za-z0-9]+/g, '_');
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = u;
        a.download = 'Fiche_entretien_' + name + '_EC1.xlsx';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(u); }, 200);
        if (window.showToast) window.showToast('Fiche EC1 générée', 'success', 2500);
        afterEc1Apply();
      }).catch(function (err) {
        reEnable();
        if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3500);
        else alert('Erreur : ' + err.message);
      });
    } else {
      fetchPostJSON('/api/candidates/' + CID + '/ec1-apply', payload).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        if (window.showToast) window.showToast('Fiche EC1 mise à jour', 'success', 2500);
        afterEc1Apply();
      }).catch(function (err) {
        reEnable();
        if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3500);
        else alert('Erreur : ' + err.message);
      });
    }
  }

  function openEc1Modal() {
    var modal = document.querySelector('[data-v30-fc-ec1-modal]');
    if (!modal) return;
    var textarea = modal.querySelector('[data-v30-fc-ec1-transcript-input]');
    if (textarea) textarea.value = '';
    var loader = modal.querySelector('[data-v30-fc-ec1-loader]');
    if (loader) loader.style.display = 'none';
    var result = modal.querySelector('[data-v30-fc-ec1-result]');
    if (result) result.style.display = 'none';
    var fields = modal.querySelector('[data-v30-fc-ec1-fields]');
    if (fields) fields.innerHTML = '';
    var box = modal.querySelector('[data-v30-fc-ec1-transcript-box]');
    if (box) box.open = true;
    var applyBtn = modal.querySelector('[data-v30-fc-ec1-apply]');
    var applyDlBtn = modal.querySelector('[data-v30-fc-ec1-apply-download]');
    if (applyBtn) applyBtn.disabled = true;
    if (applyDlBtn) applyDlBtn.disabled = true;
    STATE.ec1Preview = null;
    modal.hidden = false;
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    if (textarea) textarea.focus();
  }

  function closeEc1Modal() {
    var modal = document.querySelector('[data-v30-fc-ec1-modal]');
    if (!modal) return;
    modal.classList.remove('is-open');
    setTimeout(function () { modal.hidden = true; }, 160);
  }

  function bindEc1Card() {
    // Délégation globale : capture les clics sur les actions EC1 où qu'elles soient.
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-fc-ec1-download]')) { downloadEc1Excel(); return; }
      if (e.target.closest('[data-v30-fc-ec1-transcript]')) { openEc1Modal(); return; }
      if (e.target.closest('[data-v30-fc-ec1-close]')) { closeEc1Modal(); return; }
      if (e.target.closest('[data-v30-fc-ec1-analyze]')) { analyzeEc1Transcript(); return; }
      if (e.target.closest('[data-v30-fc-ec1-apply-download]')) { applyEc1Form(true); return; }
      if (e.target.closest('[data-v30-fc-ec1-apply]')) { applyEc1Form(false); return; }
      var modal = document.querySelector('[data-v30-fc-ec1-modal]');
      if (modal && !modal.hidden && e.target === modal) closeEc1Modal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var modal = document.querySelector('[data-v30-fc-ec1-modal]');
        if (modal && !modal.hidden) { closeEc1Modal(); e.stopPropagation(); }
      }
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindInlineEdit();
    bindActions();
    bindSectionEdit();
    bindDcActions();
    bindDcEnrichModal();
    bindNoteForm();
    bindAttachmentsCard();
    bindEc1Card();

    Promise.all([
      fetchJSON('/api/candidates/' + CID).catch(function () { return null; }),
      fetchJSON('/api/candidates/' + CID + '/experiences').catch(function () { return null; })
    ]).then(function (both) {
      var cand = both[0] && (both[0].candidate || both[0]);
      STATE.candidate = cand || {};
      var exps = both[1] && (both[1].experiences || both[1].items || both[1] || []);
      STATE.experiences = Array.isArray(exps) ? exps : [];
      renderHeader(STATE.candidate);
      renderInfo(STATE.candidate);
      renderSectionFields(STATE.candidate);
      renderMissions();
      // Charge skills + availability via nouveaux endpoints v30
      loadSkills();
      loadAvailability();
      loadPushHistory();
      loadDc();
      loadEvents();
      loadAttachments();
      updateEc1CardVisibility();
    }).catch(function (err) {
      console.error('[v30 fiche candidat] load failed:', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
