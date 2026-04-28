/* ProspUp v30 — Métiers : grille référentiel + recherche + filtres + modale détail + export
   Réutilise METIERS_DATA chargé depuis /static/js/metiers-data.js. */
(function () {
  'use strict';

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  // ─── Salaires médians + tendances (statique) ────────────
  // Mapping clé = nom de catégorie ou patterns dans le nom de la spécialité.
  var SALARY_MEDIAN = {
    'Ingénierie Logicielle': 48000,
    'Ingénierie Électronique': 45000,
    'Ingénierie Système': 47000,
    'Ingénierie Mécanique': 44000,
    'Sciences de la donnée': 52000,
    'Cybersécurité': 55000,
    'IT / DSI': 47000,
    'Industrie / Production': 42000
  };
  var TREND_RULES = [
    { match: /(IA|AI|Data|ML|DevOps|Cloud|Cyber|Sec|Sécurité|Embed|IoT|FPGA)/i, level: 90, label: 'Très demandé' },
    { match: /(Web|Fullstack|Logiciel|Test|Validation|Robot|Auto)/i, level: 75, label: 'Demandé' },
    { match: /(Mécanique|Électrotechnique|Industrialisation|Production)/i, level: 60, label: 'Stable' },
    { match: /.*/, level: 65, label: 'Stable' }
  ];

  function salaryFor(metier) {
    return SALARY_MEDIAN[metier.name] || 45000;
  }
  function trendFor(spec) {
    var name = spec && spec.name ? spec.name : '';
    for (var i = 0; i < TREND_RULES.length; i++) {
      if (TREND_RULES[i].match.test(name)) return TREND_RULES[i];
    }
    return TREND_RULES[TREND_RULES.length - 1];
  }
  function fmtSalary(n) {
    if (!n) return '—';
    return n.toLocaleString('fr-FR') + ' € / an';
  }

  // ─── State ─────────────────────────────────────────────
  var STATE = {
    items: [],         // [{metier, spec, key}]
    domains: [],       // distincts (= categories)
    activeDomains: new Set(),
    search: ''
  };

  // ─── Préparation des items à plat depuis METIERS_DATA ───
  function buildItems() {
    if (typeof METIERS_DATA === 'undefined' || !Array.isArray(METIERS_DATA)) {
      return [];
    }
    var out = [];
    METIERS_DATA.forEach(function (metier) {
      (metier.specialties || []).forEach(function (spec) {
        out.push({
          metier: metier,
          spec: spec,
          key: (metier.name + ' / ' + spec.name).toLowerCase()
        });
      });
    });
    return out;
  }

  function buildDomains() {
    var seen = {};
    STATE.items.forEach(function (it) { seen[it.metier.name] = true; });
    return Object.keys(seen);
  }

  // ─── Filter helpers ────────────────────────────────────
  function matchesSearch(item, q) {
    if (!q) return true;
    if (item.key.indexOf(q) !== -1) return true;
    var spec = item.spec || {};
    var hayParts = [
      spec.ops || '',
      (spec.sectors || []).join(' '),
      (spec.certifs || []).join(' ')
    ];
    var tech = spec.tech || {};
    Object.keys(tech).forEach(function (g) {
      hayParts.push(g);
      (tech[g] || []).forEach(function (t) { hayParts.push(t); });
    });
    return hayParts.join(' ').toLowerCase().indexOf(q) !== -1;
  }
  function passesFilters(item) {
    if (STATE.activeDomains.size && !STATE.activeDomains.has(item.metier.name)) return false;
    return matchesSearch(item, STATE.search);
  }

  // ─── Render ─────────────────────────────────────────────
  function renderDomains() {
    var host = $('[data-v30-metiers-domains]');
    if (!host) return;
    if (!STATE.domains.length) { host.innerHTML = ''; return; }
    var allActive = !STATE.activeDomains.size;
    host.innerHTML =
      '<button type="button" class="v30-chip' + (allActive ? ' is-active' : '') + '" data-domain="__all">Tous</button>' +
      STATE.domains.map(function (d, i) {
        var active = STATE.activeDomains.has(d);
        return '<button type="button" class="v30-chip' + (active ? ' is-active' : '') +
          '" data-domain="' + esc(d) + '" style="--chip-i:' + i + ';">' +
          esc(d) + '</button>';
      }).join('');
    host.onclick = function (e) {
      var b = e.target.closest('button[data-domain]');
      if (!b) return;
      var d = b.getAttribute('data-domain');
      if (d === '__all') STATE.activeDomains.clear();
      else if (STATE.activeDomains.has(d)) STATE.activeDomains.delete(d);
      else STATE.activeDomains.add(d);
      renderDomains();
      renderGrid();
    };
  }

  function renderGrid() {
    var host = $('[data-v30-metiers-grid]');
    var count = $('[data-v30-metiers-count]');
    if (!host) return;
    var filtered = STATE.items.filter(passesFilters);
    if (count) count.textContent = filtered.length + ' spécialité(s) sur ' + STATE.items.length;
    if (!filtered.length) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1; padding:24px;">Aucun métier pour ces filtres.</div>';
      return;
    }
    host.innerHTML = filtered.map(function (it, i) {
      var color = it.metier.color || 'var(--accent)';
      var sectors = (it.spec.sectors || []).slice(0, 3);
      return '<button type="button" class="metier-card" data-key="' + esc(it.metier.name + '||' + it.spec.name) + '">' +
        '<div class="metier-card__head">' +
          '<span class="metier-card__cat">' +
            '<span class="metier-card__cat-dot" style="background:' + esc(color) + ';"></span>' +
            esc(it.metier.name) +
          '</span>' +
        '</div>' +
        '<h3 class="metier-card__name">' + esc(it.spec.name) + '</h3>' +
        '<p class="metier-card__desc">' + esc(it.spec.ops || '—') + '</p>' +
        '<div class="metier-card__foot">' +
          (sectors.length
            ? sectors.map(function (s) { return '<span class="metier-card__pill">' + esc(s) + '</span>'; }).join('')
            : '<span class="muted">—</span>') +
        '</div>' +
      '</button>';
    }).join('');
    host.querySelectorAll('button.metier-card').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-key') || '';
        var parts = key.split('||');
        var item = STATE.items.find(function (x) {
          return x.metier.name === parts[0] && x.spec.name === parts[1];
        });
        if (item) openDetail(item);
      });
    });
  }

  // ─── Modale détail ─────────────────────────────────────
  function openDetail(item) {
    var bd = $('[data-v30-metier-detail-bd]');
    if (!bd) return;
    var metier = item.metier;
    var spec = item.spec;
    $('[data-v30-metier-detail-title]').textContent = spec.name;
    $('[data-v30-metier-detail-desc]').textContent = spec.ops || '—';

    var sectorsHost = $('[data-v30-metier-detail-sectors]');
    if (sectorsHost) {
      sectorsHost.innerHTML = ((spec.sectors || []).length
        ? (spec.sectors || []).map(function (s) { return '<span class="skill-chip">' + esc(s) + '</span>'; }).join('')
        : '<span class="muted" style="font-size:12px;">—</span>');
    }

    var certs = $('[data-v30-metier-detail-certifs]');
    if (certs) {
      certs.innerHTML = ((spec.certifs || []).length
        ? (spec.certifs || []).map(function (c) { return '<span class="skill-chip">' + esc(c) + '</span>'; }).join('')
        : '<span class="muted" style="font-size:12px;">Aucune</span>');
    }

    var skillsHost = $('[data-v30-metier-detail-skills]');
    if (skillsHost) {
      var groups = Object.keys(spec.tech || {});
      if (!groups.length) skillsHost.innerHTML = '<span class="muted" style="font-size:12px;">Aucune compétence référencée</span>';
      else {
        skillsHost.innerHTML = groups.map(function (g) {
          var pills = (spec.tech[g] || []).map(function (t) {
            return '<span class="skill-chip">' + esc(t) + '</span>';
          }).join('');
          return '<span class="skill-chip skill-chip--group">' + esc(g) + '</span>' + pills;
        }).join('<span style="flex-basis:100%;height:2px;"></span>');
      }
    }

    $('[data-v30-metier-detail-salary]').textContent = fmtSalary(salaryFor(metier));
    var trend = trendFor(spec);
    var trendBar = bd.querySelector('.v30-metier-detail__trend-bar i');
    if (trendBar) trendBar.style.width = trend.level + '%';
    $('[data-v30-metier-detail-trend-label]').textContent = trend.label + ' (' + trend.level + '/100)';
    $('[data-v30-metier-detail-domain]').textContent = metier.name;

    bd.hidden = false;
    bd.classList.add('is-open');
  }
  function closeDetail() {
    var bd = $('[data-v30-metier-detail-bd]');
    if (!bd) return;
    bd.classList.remove('is-open');
    bd.hidden = true;
  }
  function bindDetail() {
    document.querySelectorAll('[data-v30-metier-detail-close]').forEach(function (b) {
      b.addEventListener('click', closeDetail);
    });
    var bd = $('[data-v30-metier-detail-bd]');
    if (bd) bd.addEventListener('click', function (e) { if (e.target === bd) closeDetail(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  }

  // ─── Search ────────────────────────────────────────────
  function bindSearch() {
    var input = $('[data-v30-metiers-search]');
    var clearBtn = $('[data-v30-metiers-search-clear]');
    if (!input) return;
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        STATE.search = (input.value || '').trim().toLowerCase();
        if (clearBtn) clearBtn.hidden = !STATE.search;
        renderGrid();
      }, 80);
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      input.value = '';
      STATE.search = '';
      clearBtn.hidden = true;
      input.focus();
      renderGrid();
    });
  }

  // ─── Export JSON ───────────────────────────────────────
  function bindExport() {
    var btn = $('[data-v30-metiers-export]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var payload = STATE.items.map(function (it) {
        return {
          domain: it.metier.name,
          specialty: it.spec.name,
          description: it.spec.ops || '',
          tech: it.spec.tech || {},
          sectors: it.spec.sectors || [],
          certifs: it.spec.certifs || [],
          salary_median_eur: salaryFor(it.metier),
          trending: trendFor(it.spec)
        };
      });
      var json = JSON.stringify({
        generated_at: new Date().toISOString(),
        count: payload.length,
        items: payload
      }, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'metiers-prospup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Export JSON téléchargé', 'success');
    });
  }

  // ─── Custom métiers (admin CRUD legacy) ────────────────
  var CUSTOM = { items: [] };
  function renderCustom() {
    var host = $('[data-v30-metiers-list]');
    if (!host) return;
    if (!CUSTOM.items.length) {
      host.innerHTML = '<div class="empty" style="padding:18px;">Aucun métier personnalisé. Clique sur <b>Ajouter</b>.</div>';
      return;
    }
    host.innerHTML = CUSTOM.items.map(function (m) {
      return '<div class="v30-metier-row" data-id="' + m.id + '">' +
        '<span class="v30-metier-row__type">' + esc(m.type || '—') + '</span>' +
        '<span class="v30-metier-row__category">' + esc(m.category || '—') + '</span>' +
        '<span class="v30-metier-row__value">' + esc(m.value || '') + '</span>' +
        '<span class="v30-metier-row__specialty">' + esc(m.specialty || m.tech_group || '') + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-del="' + m.id + '">×</button>' +
      '</div>';
    }).join('');
  }
  function loadCustom() {
    if (!$('[data-v30-metiers-list]')) return;
    return fetchJSON('/api/custom_metiers').then(function (res) {
      CUSTOM.items = (res && (res.items || res.metiers || (Array.isArray(res) ? res : []))) || [];
      renderCustom();
    }).catch(function () {
      var host = $('[data-v30-metiers-list]');
      if (host) host.innerHTML = '<div class="empty" style="padding:18px;">Erreur de chargement.</div>';
    });
  }
  function bindCustom() {
    var addBtn = $('[data-v30-metier-add]');
    if (addBtn) addBtn.addEventListener('click', function () {
      var type = prompt('Type (ex: metier, tech, specialty) :', 'tech');
      if (!type) return;
      var category = prompt('Catégorie (ex: Compétences) :', 'Compétences');
      if (!category) return;
      var value = prompt('Valeur (ex: Kubernetes) :');
      if (!value) return;
      postJSON('/api/custom_metiers', { type: type.trim(), category: category.trim(), value: value.trim() })
        .then(function (res) {
          if (res.ok !== false) loadCustom();
          else toast('Échec : ' + (res.error || 'inconnu'), 'error');
        });
    });
    var host = $('[data-v30-metiers-list]');
    if (host) host.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      if (!confirm('Supprimer ce métier ?')) return;
      fetch('/api/custom_metiers/' + btn.dataset.del, { method: 'DELETE', credentials: 'same-origin' })
        .then(loadCustom);
    });
  }

  // ─── Init ───────────────────────────────────────────────
  function init() {
    STATE.items = buildItems();
    STATE.domains = buildDomains();
    if (!STATE.items.length) {
      var host = $('[data-v30-metiers-grid]');
      if (host) host.innerHTML = '<div class="empty" style="grid-column:1/-1; padding:24px;">Référentiel non chargé. Vérifie que metiers-data.js est inclus.</div>';
      return;
    }
    renderDomains();
    renderGrid();
    bindSearch();
    bindExport();
    bindDetail();
    bindCustom();
    loadCustom();
  }

  // METIERS_DATA est un const top-level dans metiers-data.js, accessible
  // depuis ce script (chargé après). On attend néanmoins DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
