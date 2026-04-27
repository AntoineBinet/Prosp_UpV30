/* ProspUp v30 — Entreprises : fetch + agrégation + rendu + CRUD/merge/filtres */
(function () {
  'use strict';

  var STATE = {
    companies: [],
    prospects: [],
    rows: [],
    filtered: [],
    selected: new Set(),
    q: '',
    filters: { piped: false, hasProspects: false, emptyOnly: false, tags: [] }
  };

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function initials(name) {
    var n = String(name || '').trim();
    if (!n) return '—';
    return n.slice(0, 2).toUpperCase();
  }
  function relativeDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var diffJ = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (diffJ <= 0) return "aujourd'hui";
      if (diffJ === 1) return 'hier';
      if (diffJ < 7) return 'il y a ' + diffJ + ' j';
      if (diffJ < 60) return 'il y a ' + Math.floor(diffJ / 7) + ' sem';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch (_) { return iso; }
  }
  function parseTags(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
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
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  // ─── Modal helpers (shared pattern) ────────────────────────
  function getModal(name) { return document.querySelector('[data-v30-pp-modal="' + name + '"]'); }
  function openModal(m) { if (!m) return; m.hidden = false; void m.offsetWidth; m.classList.add('is-open'); var f = m.querySelector('input:not([type=hidden]),select,textarea,button:not([data-v30-modal-close])'); if (f) try { f.focus(); } catch (_) {} }
  function closeModal(m) { if (!m) return; m.classList.remove('is-open'); setTimeout(function () { m.hidden = true; }, 160); }
  function bindModalDismiss() {
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-v30-modal-close]');
      if (close) { var m = close.closest('[data-v30-pp-modal]'); if (m) closeModal(m); return; }
      var bd = e.target.closest('.v30-modal-bd');
      if (bd && e.target === bd && bd.dataset.v30PpModal) closeModal(bd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.v30-modal-bd.is-open[data-v30-pp-modal]').forEach(closeModal);
    });
  }

  // ─── Agrégation ────────────────────────────────────────────
  var PIPED = ['Rendez-vous', 'Proposition', 'À rappeler'];
  function buildRows() {
    var byCid = {};
    STATE.prospects.forEach(function (p) {
      var cid = p.company_id;
      if (!cid) return;
      if (!byCid[cid]) byCid[cid] = { total: 0, piped: 0, won: 0, lastContact: '' };
      byCid[cid].total++;
      if (PIPED.indexOf(p.statut) >= 0) byCid[cid].piped++;
      if (p.statut === 'Gagné') byCid[cid].won++;
      var lc = p.lastContact || '';
      if (lc > byCid[cid].lastContact) byCid[cid].lastContact = lc;
    });
    return STATE.companies.map(function (c) {
      var agg = byCid[c.id] || { total: 0, piped: 0, won: 0, lastContact: '' };
      return {
        id: c.id,
        groupe: c.groupe || '',
        site: c.site || '',
        tags: parseTags(c.tags),
        total: agg.total,
        piped: agg.piped,
        won: agg.won,
        lastContact: agg.lastContact
      };
    }).sort(function (a, b) {
      if (b.piped !== a.piped) return b.piped - a.piped;
      if (b.total !== a.total) return b.total - a.total;
      return (a.groupe || '').localeCompare(b.groupe || '');
    });
  }

  // ─── KPIs ─────────────────────────────────────────────────
  function renderKPIs(rows) {
    var total = rows.length;
    var piped = rows.filter(function (r) { return r.piped > 0; }).length;
    var prospectsTotal = rows.reduce(function (s, r) { return s + r.total; }, 0);
    var thresholdMs = Date.now() - 30 * 86400000;
    var active = rows.filter(function (r) { return r.lastContact && new Date(r.lastContact).getTime() >= thresholdMs; }).length;
    var set = function (k, v) { var el = $('[data-kpi="' + k + '"]'); if (el) el.textContent = v.toLocaleString('fr-FR'); };
    set('total', total); set('piped', piped); set('prospects', prospectsTotal); set('last', active);
    var totalH = $('[data-v30-entreprises] [data-field="total"]');
    if (totalH) totalH.textContent = total.toLocaleString('fr-FR');
  }

  // ─── Tags (2 + extra) ─────────────────────────────────────
  function renderTags(tags) {
    if (!tags || !tags.length) return '';
    var shown = tags.slice(0, 2);
    var extra = tags.length - 2;
    var html = shown.map(function (t) { return '<span class="badge">' + esc(t) + '</span>'; }).join(' ');
    if (extra > 0) html += ' <span class="badge muted">+' + extra + '</span>';
    return html;
  }

  // ─── Table ────────────────────────────────────────────────
  function renderRows(rows) {
    var tbody = $('[data-v30-rows]');
    if (!tbody) return;
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9"><div class="v30-pp-empty">Aucune entreprise pour ce filtre.</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      var sel = STATE.selected.has(r.id);
      return '<tr class="' + (sel ? 'is-selected' : '') + '" data-id="' + r.id + '">' +
        '<td style="padding-left:14px;">' +
          '<input type="checkbox" data-v30-ent-select' + (sel ? ' checked' : '') + ' aria-label="Sélectionner">' +
        '</td>' +
        '<td>' +
          '<a href="#" data-v30-ent-open="' + r.id + '" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit;">' +
            '<span style="width:28px;height:28px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">' + esc(initials(r.groupe)) + '</span>' +
            '<span style="font-weight:500;" class="truncate">' + esc(r.groupe || '—') + '</span>' +
          '</a>' +
        '</td>' +
        '<td class="truncate" style="max-width:180px;color:var(--text-2);">' + esc(r.site || '—') + '</td>' +
        '<td class="num"><span style="color:var(--accent);font-weight:500;">' + r.total + '</span></td>' +
        '<td class="num">' + (r.piped || '—') + '</td>' +
        '<td class="num">' + (r.won || '—') + '</td>' +
        '<td style="color:var(--text-2);">' + esc(relativeDate(r.lastContact)) + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + renderTags(r.tags) + '</div></td>' +
        '<td><div style="display:flex;gap:4px;">' +
          '<a class="btn btn-sm" href="/v30/prospects?company=' + r.id + '" title="Voir les prospects">Prospects</a>' +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function renderPagination(rows) {
    var host = $('[data-v30-pagination] [data-field="range"]');
    if (host) host.textContent = rows.length === 0 ? '0 entreprise' : rows.length + ' entreprise' + (rows.length > 1 ? 's' : '');
  }

  // ─── Vue Cartes ─────────────────────────────────────────
  function renderCards(rows) {
    var host = $('[data-v30-ent-panel="cards"]');
    if (!host) return;
    if (rows.length === 0) {
      host.innerHTML = '<div class="v30-pp-empty" style="padding:40px;text-align:center;">Aucune entreprise pour ce filtre.</div>';
      return;
    }
    host.innerHTML = rows.map(function (r) {
      var tagsHtml = (r.tags || []).slice(0, 3).map(function (t) { return '<span class="badge" style="font-size:10px;">' + esc(t) + '</span>'; }).join(' ');
      var extra = (r.tags || []).length - 3;
      if (extra > 0) tagsHtml += ' <span class="badge muted" style="font-size:10px;">+' + extra + '</span>';
      return '<a class="v30-ent-card" href="#" data-v30-ent-open="' + r.id + '">' +
        '<div class="v30-ent-card__head">' +
          '<span class="avatar avatar--md avatar--square avatar--logo v30-ent-card__logo">' + esc(initials(r.groupe)) + '</span>' +
          '<div class="v30-ent-card__title-box">' +
            '<div class="v30-ent-card__title truncate">' + esc(r.groupe || '—') + '</div>' +
            '<div class="v30-ent-card__site truncate">' + esc(r.site || '—') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="v30-ent-card__stats">' +
          '<div class="kpi kpi--sm kpi--bare"><div class="kpi__value num">' + r.total + '</div><div class="kpi__label">prosp</div></div>' +
          '<div class="kpi kpi--sm kpi--bare"><div class="kpi__value num">' + (r.piped || 0) + '</div><div class="kpi__label">RDV/propale</div></div>' +
          '<div class="kpi kpi--sm kpi--bare"><div class="kpi__value num">' + (r.won || 0) + '</div><div class="kpi__label">gagnés</div></div>' +
        '</div>' +
        (tagsHtml ? '<div class="v30-ent-card__tags">' + tagsHtml + '</div>' : '') +
        '<div class="v30-ent-card__foot muted">' + esc(relativeDate(r.lastContact)) + '</div>' +
      '</a>';
    }).join('');
  }

  // ─── View switch ─────────────────────────────────────────
  function bindViewSwitch() {
    var seg = $('[data-v30-ent-view]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (!btn) return;
      var v = btn.dataset.view;
      seg.querySelectorAll('button[data-view]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-ent-panel]').forEach(function (p) { p.hidden = (p.dataset.v30EntPanel !== v); });
      if (v === 'cards') renderCards(STATE.filtered);
    });
  }

  // ─── Recherche + filtres ─────────────────────────────────
  function passesFilters(r) {
    var F = STATE.filters;
    if (F.piped && r.piped <= 0) return false;
    if (F.hasProspects && r.total <= 0) return false;
    if (F.emptyOnly && r.total > 0) return false;
    if (F.tags && F.tags.length) {
      var lower = (r.tags || []).map(function (t) { return String(t).toLowerCase(); });
      for (var i = 0; i < F.tags.length; i++) {
        if (lower.indexOf(F.tags[i].toLowerCase()) < 0) return false;
      }
    }
    return true;
  }
  function applyFilter() {
    var q = (STATE.q || '').trim().toLowerCase();
    STATE.filtered = STATE.rows.filter(function (r) {
      if (!passesFilters(r)) return false;
      if (!q) return true;
      return (r.groupe || '').toLowerCase().indexOf(q) >= 0
          || (r.site || '').toLowerCase().indexOf(q) >= 0
          || (r.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
    });
    renderRows(STATE.filtered);
    var cardsPanel = $('[data-v30-ent-panel="cards"]');
    if (cardsPanel && !cardsPanel.hidden) renderCards(STATE.filtered);
    renderPagination(STATE.filtered);
  }
  function bindSearch() {
    var input = $('[data-v30-search]');
    if (!input) return;
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { STATE.q = input.value; applyFilter(); }, 150);
    });
  }

  function countActiveFilters() {
    var F = STATE.filters;
    var n = 0;
    if (F.piped) n++;
    if (F.hasProspects) n++;
    if (F.emptyOnly) n++;
    if (F.tags && F.tags.length) n++;
    return n;
  }
  function updateFilterBadge() {
    var host = $('[data-v30-ent-filters] [data-field="active"]');
    if (!host) return;
    var n = countActiveFilters();
    host.hidden = (n === 0);
    host.textContent = n;
  }
  function bindFilters() {
    var btn = $('[data-v30-ent-filters]');
    if (btn) btn.addEventListener('click', function () {
      var m = getModal('ent-filters');
      var F = STATE.filters;
      (m.querySelector('[data-v30-ent-flt-piped]') || {}).checked = !!F.piped;
      (m.querySelector('[data-v30-ent-flt-has]') || {}).checked = !!F.hasProspects;
      (m.querySelector('[data-v30-ent-flt-empty]') || {}).checked = !!F.emptyOnly;
      (m.querySelector('[data-v30-ent-flt-tags]') || {}).value = (F.tags || []).join(', ');
      openModal(m);
    });
    var apply = $('[data-v30-ent-flt-apply]');
    if (apply) apply.addEventListener('click', function () {
      var m = getModal('ent-filters');
      var tags = ((m.querySelector('[data-v30-ent-flt-tags]') || {}).value || '')
        .split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      STATE.filters = {
        piped: !!(m.querySelector('[data-v30-ent-flt-piped]') || {}).checked,
        hasProspects: !!(m.querySelector('[data-v30-ent-flt-has]') || {}).checked,
        emptyOnly: !!(m.querySelector('[data-v30-ent-flt-empty]') || {}).checked,
        tags: tags
      };
      updateFilterBadge();
      closeModal(m);
      applyFilter();
    });
    var reset = $('[data-v30-ent-flt-reset]');
    if (reset) reset.addEventListener('click', function () {
      STATE.filters = { piped: false, hasProspects: false, emptyOnly: false, tags: [] };
      updateFilterBadge();
      closeModal(getModal('ent-filters'));
      applyFilter();
    });
  }

  // ─── Selection + bulk bar ────────────────────────────────
  function renderBulk() {
    var bar = $('[data-v30-ent-bulk]');
    if (!bar) return;
    var n = STATE.selected.size;
    bar.hidden = (n === 0);
    var c = bar.querySelector('[data-field="n"]');
    if (c) c.textContent = n;
  }
  function bindSelection() {
    document.addEventListener('change', function (e) {
      var cb = e.target.closest('[data-v30-ent-select]');
      if (cb) {
        var tr = cb.closest('tr');
        var id = Number(tr && tr.dataset.id);
        if (!id) return;
        if (cb.checked) STATE.selected.add(id);
        else STATE.selected.delete(id);
        tr.classList.toggle('is-selected', cb.checked);
        renderBulk();
        return;
      }
      if (e.target.matches('[data-v30-ent-select-all]')) {
        var all = e.target.checked;
        STATE.selected.clear();
        if (all) STATE.filtered.forEach(function (r) { STATE.selected.add(r.id); });
        renderRows(STATE.filtered);
        renderBulk();
      }
    });
  }

  // ─── Champs étendus : mapping id HTML -> champ backend ────
  // Couvre les 16 champs acceptés par /api/company/update
  var ENT_FIELDS_BASIC = ['groupe', 'site', 'phone', 'website', 'linkedin', 'industry', 'notes'];
  var ENT_FIELDS_EXTRA = ['size', 'city', 'country', 'address', 'stack', 'pain_points', 'budget', 'urgency'];
  function htmlIdFor(prefix, field) {
    // pain_points -> v30-ent-<prefix>-pain-points
    return 'v30-ent-' + prefix + '-' + field.replace(/_/g, '-');
  }

  // ─── Tabs switching pour modales (Add + Edit) ────────────
  function bindEntTabs(tabsHost, panelSelector) {
    if (!tabsHost) return;
    tabsHost.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      tabsHost.querySelectorAll('button[data-tab]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll(panelSelector).forEach(function (p) {
        var name = panelSelector.match(/panel="([^"]+)"/) ? null : null;
        p.hidden = (p.getAttribute('data-v30-ent-add-panel') !== key && p.getAttribute('data-v30-ent-edit-panel') !== key);
      });
    });
  }
  function bindTabs() {
    bindEntTabs(document.querySelector('[data-v30-ent-add-tabs]'), '[data-v30-ent-add-panel]');
    bindEntTabs(document.querySelector('[data-v30-ent-edit-tabs]'), '[data-v30-ent-edit-panel]');
  }

  // ─── Add ─────────────────────────────────────────────────
  function bindAdd() {
    var btn = $('[data-v30-ent-add]');
    if (btn) btn.addEventListener('click', function () {
      // Reset : on repasse sur le 1er onglet et on vide tous les champs
      var addTabs = document.querySelector('[data-v30-ent-add-tabs]');
      if (addTabs) {
        addTabs.querySelectorAll('button[data-tab]').forEach(function (b, i) {
          var active = (i === 0);
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
      }
      document.querySelectorAll('[data-v30-ent-add-panel]').forEach(function (p, i) { p.hidden = (i !== 0); });
      ENT_FIELDS_BASIC.concat(ENT_FIELDS_EXTRA).concat(['tags']).forEach(function (f) {
        var el = document.getElementById(htmlIdFor('add', f));
        if (el) el.value = '';
      });
      openModal(getModal('ent-add'));
    });
    var save = $('[data-v30-ent-add-save]');
    if (save) save.addEventListener('click', function () {
      var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      var groupe = val('v30-ent-add-groupe');
      if (!groupe) { toast('Le groupe est obligatoire', 'warning'); return; }
      var tagsRaw = val('v30-ent-add-tags');
      var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
      // Étape 1 : /api/companies/create accepte groupe, site, phone, notes, website, linkedin, industry, tags
      var basePayload = {
        groupe: groupe,
        site: val('v30-ent-add-site'),
        phone: val('v30-ent-add-phone'),
        website: val('v30-ent-add-website'),
        linkedin: val('v30-ent-add-linkedin'),
        industry: val('v30-ent-add-industry'),
        notes: val('v30-ent-add-notes'),
        tags: tags
      };
      // Étape 2 (si besoin) : /api/company/update pour les champs étendus
      var extra = {};
      ENT_FIELDS_EXTRA.forEach(function (f) {
        var v = val(htmlIdFor('add', f));
        if (v) extra[f] = v;
      });
      save.disabled = true;
      fetchPost('/api/companies/create', basePayload)
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'création impossible');
          var createdId = res.id;
          var deduped = !!res.deduped;
          // Si on a des champs étendus, on les applique via /api/company/update
          if (Object.keys(extra).length && createdId) {
            return fetchPost('/api/company/update', Object.assign({ id: createdId }, extra))
              .then(function () { return { id: createdId, deduped: deduped }; });
          }
          return { id: createdId, deduped: deduped };
        })
        .then(function (result) {
          if (result.deduped) toast('Entreprise déjà existante (id ' + result.id + ')', 'info');
          else toast('Entreprise ajoutée', 'success');
          closeModal(getModal('ent-add'));
          ENT_FIELDS_BASIC.concat(ENT_FIELDS_EXTRA).concat(['tags']).forEach(function (f) {
            var el = document.getElementById(htmlIdFor('add', f));
            if (el) el.value = '';
          });
          reload();
        })
        .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
        .then(function () { save.disabled = false; });
    });
  }

  // ─── Edit ────────────────────────────────────────────────
  function populateEditModal(company, computed) {
    var m = getModal('ent-edit');
    if (!m) return;
    var set = function (f, v) {
      var el = document.getElementById(htmlIdFor('edit', f));
      if (el) el.value = v == null ? '' : String(v);
    };
    set('groupe', company.groupe);
    set('site', company.site);
    set('phone', company.phone);
    set('website', company.website);
    set('linkedin', company.linkedin);
    set('industry', company.industry);
    set('notes', company.notes);
    ENT_FIELDS_EXTRA.forEach(function (f) { set(f, company[f]); });
    // Tags JSON -> liste virgule
    var tagsArr = parseTags(company.tags);
    var tagsEl = document.getElementById(htmlIdFor('edit', 'tags'));
    if (tagsEl) tagsEl.value = tagsArr.join(', ');
    // ID caché
    var idEl = m.querySelector('[data-v30-ent-edit-id]');
    if (idEl) idEl.value = company.id;
    // Meta sub-text
    var metaEl = m.querySelector('[data-v30-ent-edit-meta]');
    if (metaEl) {
      var parts = [];
      if (company.groupe) parts.push(company.groupe);
      if (company.site) parts.push(company.site);
      var countTxt = (computed && computed.total != null) ? (computed.total + ' prospect' + (computed.total > 1 ? 's' : '')) : '';
      if (countTxt) parts.push(countTxt);
      metaEl.textContent = parts.join(' · ') || '—';
    }
    // Quick action links
    var setQA = function (kind, href) {
      var a = m.querySelector('[data-v30-ent-qa="' + kind + '"]');
      if (!a) return;
      if (!href) { a.hidden = true; return; }
      a.hidden = false;
      a.href = href;
      var span = a.querySelector('span');
      if (span && kind === 'phone') span.textContent = href.replace(/^tel:/, '');
    };
    setQA('phone', company.phone ? ('tel:' + String(company.phone).replace(/\s+/g, '')) : '');
    setQA('website', company.website || '');
    setQA('linkedin', company.linkedin || '');
    var prospectsA = m.querySelector('[data-v30-ent-qa="prospects"]');
    if (prospectsA) {
      prospectsA.hidden = false;
      prospectsA.href = '/v30/prospects?company=' + company.id;
      var cnt = prospectsA.querySelector('[data-field="prospects-count"]');
      if (cnt) cnt.textContent = (computed && computed.total != null) ? computed.total : 0;
    }
    // Reset tabs to first
    var editTabs = document.querySelector('[data-v30-ent-edit-tabs]');
    if (editTabs) {
      editTabs.querySelectorAll('button[data-tab]').forEach(function (b, i) {
        var active = (i === 0);
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    document.querySelectorAll('[data-v30-ent-edit-panel]').forEach(function (p, i) { p.hidden = (i !== 0); });
  }

  function openEditFor(id) {
    var cached = findRow(id);
    fetchJSON('/api/company/full?id=' + encodeURIComponent(id))
      .then(function (res) {
        if (!res || !res.ok || !res.company) throw new Error((res && res.error) || 'Impossible de charger');
        populateEditModal(res.company, cached || { total: (res.prospects || []).length });
        openModal(getModal('ent-edit'));
      })
      .catch(function (e) {
        console.error('[v30 entreprises] open edit failed:', e);
        toast('Erreur : ' + e.message, 'error');
      });
  }

  function bindEdit() {
    var save = $('[data-v30-ent-edit-save]');
    if (!save) return;
    save.addEventListener('click', function () {
      var m = getModal('ent-edit');
      var idEl = m && m.querySelector('[data-v30-ent-edit-id]');
      var id = idEl && idEl.value ? Number(idEl.value) : 0;
      if (!id) { toast('Aucune entreprise sélectionnée', 'warning'); return; }
      var val = function (field) {
        var el = document.getElementById(htmlIdFor('edit', field));
        return el ? el.value.trim() : '';
      };
      var groupe = val('groupe');
      if (!groupe) { toast('Le groupe est obligatoire', 'warning'); return; }
      var tagsRaw = val('tags');
      var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];
      var payload = { id: id, groupe: groupe, tags: tags };
      ENT_FIELDS_BASIC.forEach(function (f) { if (f !== 'groupe') payload[f] = val(f); });
      ENT_FIELDS_EXTRA.forEach(function (f) { payload[f] = val(f); });
      save.disabled = true;
      fetchPost('/api/company/update', payload)
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'mise à jour impossible');
          toast('Entreprise mise à jour', 'success');
          closeModal(getModal('ent-edit'));
          reload();
        })
        .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
        .then(function () { save.disabled = false; });
    });
  }

  // ─── Export ──────────────────────────────────────────────
  function bindExport() {
    var btn = $('[data-v30-ent-export]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      toast('Export en cours…', 'info');
      window.location.href = '/api/export/xlsx';
    });
  }

  // ─── Merge / Delete bulk ─────────────────────────────────
  function findRow(id) { return STATE.rows.find(function (r) { return r.id === id; }); }
  function renderMergePreview(keepId, mergeId) {
    var k = findRow(keepId), m = findRow(mergeId);
    var box = function (r) {
      if (!r) return '<span class="muted">—</span>';
      return '<div style="font-weight:500;">' + esc(r.groupe || '—') + '</div>' +
        '<div class="muted" style="font-size:11px;">' + esc(r.site || '') + ' · ' + r.total + ' prospect(s)</div>';
    };
    (document.querySelector('[data-v30-ent-merge-keep]') || {}).innerHTML = box(k);
    (document.querySelector('[data-v30-ent-merge-merge]') || {}).innerHTML = box(m);
  }
  function bindBulk() {
    var bar = $('[data-v30-ent-bulk]');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      var ids = Array.from(STATE.selected);
      if (action === 'clear') {
        STATE.selected.clear();
        renderRows(STATE.filtered);
        renderBulk();
        return;
      }
      if (!ids.length) { toast('Aucune sélection', 'warning'); return; }
      if (action === 'merge') {
        if (ids.length !== 2) { toast('Sélectionne exactement 2 entreprises', 'warning'); return; }
        STATE.mergeCtx = { keep: ids[0], merge: ids[1] };
        var m = getModal('ent-merge');
        var swap = m.querySelector('[data-v30-ent-merge-swap]');
        if (swap) swap.checked = false;
        renderMergePreview(STATE.mergeCtx.keep, STATE.mergeCtx.merge);
        openModal(m);
      } else if (action === 'delete') {
        if (!confirm('Supprimer ' + ids.length + ' entreprise(s) ? (les prospects restent mais orphelins)')) return;
        var done = 0, errors = 0, i = 0;
        function next() {
          if (i >= ids.length) {
            toast(done + ' supprimée(s)' + (errors ? ', ' + errors + ' erreur(s)' : ''), errors ? 'warning' : 'success');
            STATE.selected.clear();
            reload();
            return;
          }
          fetchPost('/api/companies/delete', { id: ids[i] })
            .then(function () { done++; })
            .catch(function () { errors++; })
            .then(function () { i++; next(); });
        }
        next();
      }
    });
    var swap = document.querySelector('[data-v30-ent-merge-swap]');
    if (swap) swap.addEventListener('change', function () {
      if (!STATE.mergeCtx) return;
      var keep = STATE.mergeCtx.keep, merge = STATE.mergeCtx.merge;
      if (swap.checked) { STATE.mergeCtx = { keep: merge, merge: keep }; }
      else { STATE.mergeCtx = { keep: keep, merge: merge }; }
      renderMergePreview(STATE.mergeCtx.keep, STATE.mergeCtx.merge);
    });
    var runBtn = document.querySelector('[data-v30-ent-merge-run]');
    if (runBtn) runBtn.addEventListener('click', function () {
      if (!STATE.mergeCtx) return;
      runBtn.disabled = true;
      fetchPost('/api/companies/merge', { keep_id: STATE.mergeCtx.keep, merge_id: STATE.mergeCtx.merge })
        .then(function (res) {
          if (!res || !res.ok) throw new Error((res && res.error) || 'Fusion impossible');
          toast('Fusion effectuée', 'success');
          closeModal(getModal('ent-merge'));
          STATE.selected.clear();
          reload();
        })
        .catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
        .then(function () { runBtn.disabled = false; });
    });
  }

  // ─── Open entreprise : ouvre la modale Edit (fiche détaillée) ────
  function bindOpen() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-v30-ent-open]');
      if (!t) return;
      e.preventDefault();
      var id = Number(t.dataset.v30EntOpen);
      if (!id) return;
      openEditFor(id);
    });
  }

  // ─── Orchestration ───────────────────────────────────────
  function reload() {
    return fetchJSON('/api/data').then(function (res) {
      STATE.companies = (res && res.companies) || [];
      STATE.prospects = (res && res.prospects) || [];
      STATE.rows = buildRows();
      STATE.selected.clear();
      renderKPIs(STATE.rows);
      applyFilter();
      renderBulk();
    }).catch(function (err) {
      console.error('[v30 entreprises] /api/data failed:', err);
      var tbody = $('[data-v30-rows]');
      if (tbody) tbody.innerHTML = '<tr><td colspan="9"><div class="v30-pp-empty">Erreur de chargement. Réessayez.</div></td></tr>';
    });
  }

  function init() {
    bindSearch();
    bindViewSwitch();
    bindModalDismiss();
    bindSelection();
    bindTabs();
    bindAdd();
    bindEdit();
    bindFilters();
    bindExport();
    bindBulk();
    bindOpen();
    reload();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
