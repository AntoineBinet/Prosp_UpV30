/* ProspUp v30 — Fiche candidat : fetch + rendu */
(function () {
  'use strict';

  var fc = document.querySelector('[data-v30-fc]');
  if (!fc) return;
  var CID = Number(fc.dataset.candidateId || 0);
  if (!CID) return;

  var STATE = { candidate: null, experiences: [], skills: [], availability: {}, dc: null, events: [] };

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
      if (c.source)   cc += '<span class="badge">Source : ' + esc(c.source) + '</span>';
      chips.innerHTML = cc;
    }

    var notes = $('[data-field="notes"]');
    if (notes) notes.textContent = c.notes || '';

    document.title = (c.name || 'Candidat') + " — Prosp'Up v30";
  }

  // ─── Bloc Informations (parite v29 : STATUT/RÔLE/LOCALISATION/etc.) ──
  function renderInfo(c) {
    var host = $('[data-v30-fc-info]');
    if (!host || !c) return;
    var mailto = c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '—';
    var telto = c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/\s/g, '')) + '">' + esc(c.phone) + '</a>' : '—';
    var lnk = c.linkedin
      ? '<a href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">' +
        esc(c.linkedin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a>'
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
      ['LinkedIn',     lnk,     true]
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
      var val = c[f.key] || '';
      var input = '';
      if (f.type === 'textarea') {
        input = '<textarea class="input" id="fc-edit-' + f.key + '" name="' + f.key +
          '" placeholder="' + esc(f.placeholder || '') + '" rows="3" style="width:100%;resize:vertical;">' +
          esc(val) + '</textarea>';
      } else {
        input = '<input class="input" type="' + f.type + '" id="fc-edit-' + f.key + '" name="' + f.key +
          '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder || '') + '" style="width:100%;">';
      }
      return '<div class="v30-field" style="margin-bottom:12px;">' +
        '<label for="fc-edit-' + f.key + '" style="display:block;margin-bottom:4px;font-size:12px;color:var(--text-3);">' +
        esc(f.label) + '</label>' + input + '</div>';
    }).join('');
    modal.hidden = false;
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
      closeSectionModal();
      flashSaved();
      if (window.showToast) window.showToast('Modifications enregistrées', 'success', 2000);
    }).catch(function (err) {
      if (window.showToast) window.showToast('Erreur : ' + err.message, 'error', 3000);
    });
  }

  function closeSectionModal() {
    var modal = document.querySelector('[data-v30-fc-edit-modal]');
    if (modal) modal.hidden = true;
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
    if (!dc.has_dc || !files.length) {
      host.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;color:var(--text-3);font-size:12.5px;">' +
          '<span class="v30-fc-dc-dot v30-fc-dc-dot--off"></span>' +
          'Aucun DC chargé pour ce candidat.' +
        '</div>' +
        '<div style="margin-top:8px;font-size:11.5px;color:var(--text-3);">' +
          'Cliquez sur <strong>Charger</strong> pour téléverser un PDF, ou sur <strong>Générer</strong> pour le créer avec l\'éditeur.' +
        '</div>';
      return;
    }
    var fname = files[0];
    var pdfUrl = '/api/candidates/' + CID + '/dossier-competence';
    var updatedAt = STATE.candidate && STATE.candidate.updatedAt;
    host.innerHTML =
      '<div class="v30-fc-dc-row">' +
        '<span class="v30-fc-dc-dot v30-fc-dc-dot--on" aria-hidden="true"></span>' +
        '<div class="v30-fc-dc-name" data-v30-fc-dc-name title="' + esc(fname) + '">' + esc(fname) + '</div>' +
        '<div class="v30-fc-dc-actions">' +
          '<a class="btn btn-ghost btn-sm" href="' + pdfUrl + '" target="_blank" rel="noopener" title="Ouvrir le PDF">Voir</a>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-dc-rename title="Renommer le fichier">Renommer</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-dc-replace title="Remplacer par un autre PDF">Remplacer</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-fc-dc-delete title="Supprimer le DC" style="color:var(--danger);">Supprimer</button>' +
        '</div>' +
      '</div>' +
      (updatedAt
        ? '<div style="margin-top:6px;font-size:11px;color:var(--text-3);">Mis à jour le ' + esc(fmtDate(updatedAt)) + '</div>'
        : '');
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
      if (e.target.closest('[data-v30-fc-dc-generate]')) {
        window.location.href = '/v30/dc/' + CID;
        return;
      }
      if (e.target.closest('[data-v30-fc-dc-upload-btn]') || e.target.closest('[data-v30-fc-dc-replace]')) {
        if (fileInput) fileInput.click();
        return;
      }
      if (e.target.closest('[data-v30-fc-dc-rename]')) { renameDc(); return; }
      if (e.target.closest('[data-v30-fc-dc-delete]')) { deleteDc(); return; }
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

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindInlineEdit();
    bindActions();
    bindSectionEdit();
    bindDcActions();
    bindNoteForm();

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
