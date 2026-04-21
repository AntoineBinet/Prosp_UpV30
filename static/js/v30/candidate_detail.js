/* ProspUp v30 — Fiche candidat : fetch + rendu */
(function () {
  'use strict';

  var fc = document.querySelector('[data-v30-fc]');
  if (!fc) return;
  var CID = Number(fc.dataset.candidateId || 0);
  if (!CID) return;

  var STATE = { candidate: null, experiences: [], skills: [], availability: {} };

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

  // ─── Actions header ──────────────────────────────────────
  function bindActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-fc-action]');
      if (!btn) return;
      var act = btn.dataset.v30FcAction;
      if (act === 'dc')        window.location.href = '/dc_generator?candidate=' + CID;
      else if (act === 'push') window.location.href = '/push?candidate=' + CID;
      else if (act === 'more') window.location.href = '/candidate?id=' + CID;
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindInlineEdit();
    bindActions();

    Promise.all([
      fetchJSON('/api/candidates/' + CID).catch(function () { return null; }),
      fetchJSON('/api/candidates/' + CID + '/experiences').catch(function () { return null; })
    ]).then(function (both) {
      var cand = both[0] && (both[0].candidate || both[0]);
      STATE.candidate = cand || {};
      var exps = both[1] && (both[1].experiences || both[1].items || both[1] || []);
      STATE.experiences = Array.isArray(exps) ? exps : [];
      renderHeader(STATE.candidate);
      renderMissions();
      // Charge skills + availability via nouveaux endpoints v30
      loadSkills();
      loadAvailability();
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
