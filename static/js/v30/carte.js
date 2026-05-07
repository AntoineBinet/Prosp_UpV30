// ProspUp v30 — Carte géographique (Leaflet + OSM + Nominatim).
// Affiche entreprises et prospects géocodés, supporte heatmap et filtres.
(function () {
  'use strict';

  // Synchro avec static/js/v30/prospects.js (STATUS_OPTIONS)
  const STATUS_OPTIONS = [
    "Pas d'actions", 'Appelé', 'À rappeler', 'Rendez-vous',
    'Prospecté', 'Messagerie', 'Pas intéressé'
  ];

  const ROOT = document.querySelector('[data-v30-carte]');
  if (!ROOT) return;

  const state = {
    companies: [],
    prospects: [],
    layers: { companies: true, prospects: true, heatmap: false },
    filters: { search: '', status: '', priority: 0, tag: '' },
    map: null,
    coCluster: null,
    prCluster: null,
    heatLayer: null,
    locateMarker: null,
    locateCircle: null,
    initialFitDone: false,
  };

  // ─── DOM ────────────────────────────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(msg, type, dur) {
    if (window.showToast) window.showToast(msg, type, dur);
  }

  // ─── Initialisation Leaflet ────────────────────────────────────────
  function initMap() {
    state.map = L.map('v30-carte-map', {
      zoomControl: true,
      worldCopyJump: true,
    }).setView([46.6, 2.5], 6); // France centroïde

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);

    state.coCluster = L.markerClusterGroup({
      iconCreateFunction: (cluster) => clusterIcon(cluster, 'co'),
      maxClusterRadius: 50,
    });
    state.prCluster = L.markerClusterGroup({
      iconCreateFunction: (cluster) => clusterIcon(cluster, 'pr'),
      maxClusterRadius: 50,
    });
    state.coCluster.addTo(state.map);
    state.prCluster.addTo(state.map);
  }

  function clusterIcon(cluster, kind) {
    const n = cluster.getChildCount();
    const cls = kind === 'co' ? 'v30-carte-cluster--co' : 'v30-carte-cluster--pr';
    return L.divIcon({
      html: '<span>' + n + '</span>',
      className: 'v30-carte-cluster ' + cls,
      iconSize: L.point(36, 36, true),
    });
  }

  function makeCompanyIcon() {
    return L.divIcon({
      className: 'v30-carte-pin v30-carte-pin--co',
      html: '<svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-4h4v4"/></svg>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -26],
    });
  }
  function makeProspectIcon(priority) {
    const lvl = Math.max(0, Math.min(5, Number(priority || 0)));
    return L.divIcon({
      className: 'v30-carte-pin v30-carte-pin--pr v30-carte-pin--p' + lvl,
      html: '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
      popupAnchor: [0, -24],
    });
  }

  // ─── Popup HTML ─────────────────────────────────────────────────────
  function popupCompany(c) {
    const subtitle = [c.industry, c.size, c.city, c.country]
      .filter(Boolean).map(escapeHtml).join(' · ');
    const addr = [c.address, c.city, c.country].filter(Boolean).join(', ');
    return `
      <div class="v30-carte-popup">
        <div class="v30-carte-popup__kind v30-carte-popup__kind--co">Entreprise</div>
        <div class="v30-carte-popup__title">${escapeHtml(c.name)}</div>
        ${subtitle ? `<div class="v30-carte-popup__sub">${subtitle}</div>` : ''}
        ${addr ? `<div class="v30-carte-popup__addr">${escapeHtml(addr)}</div>` : ''}
        <div class="v30-carte-popup__actions">
          <a href="/v30/entreprises?id=${c.id}" class="btn btn-ghost btn-sm">Fiche</a>
          <a href="https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=17/${c.lat}/${c.lon}"
             target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">OSM</a>
        </div>
      </div>`;
  }
  function popupProspect(p) {
    const subtitle = [p.fonction, p.company_name].filter(Boolean).map(escapeHtml).join(' · ');
    const addr = [p.city, p.country].filter(Boolean).join(', ');
    const status = p.status ? `<span class="v30-carte-pill v30-carte-pill--status">${escapeHtml(p.status)}</span>` : '';
    const prio = p.priority ? `<span class="v30-carte-pill v30-carte-pill--p${p.priority}">P${p.priority}</span>` : '';
    return `
      <div class="v30-carte-popup">
        <div class="v30-carte-popup__kind v30-carte-popup__kind--pr">Prospect</div>
        <div class="v30-carte-popup__title">${escapeHtml(p.name)}</div>
        ${subtitle ? `<div class="v30-carte-popup__sub">${subtitle}</div>` : ''}
        ${addr ? `<div class="v30-carte-popup__addr">${escapeHtml(addr)}</div>` : ''}
        <div class="v30-carte-popup__pills">${status}${prio}</div>
        <div class="v30-carte-popup__actions">
          <a href="/v30/prospect/${p.id}" class="btn btn-ghost btn-sm">Fiche</a>
          ${p.email ? `<a href="mailto:${escapeHtml(p.email)}" class="btn btn-ghost btn-sm">Email</a>` : ''}
          ${p.phone ? `<a href="tel:${escapeHtml(p.phone)}" class="btn btn-ghost btn-sm">Appel</a>` : ''}
        </div>
      </div>`;
  }

  // ─── Filters ────────────────────────────────────────────────────────
  function matchFilters(item, kind) {
    const f = state.filters;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = [
        item.name, item.city, item.country, item.fonction,
        item.company_name, item.industry, item.tags,
      ].filter(Boolean).map(s => String(s).toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    if (kind === 'pr') {
      if (f.status && item.status !== f.status) return false;
      if (f.priority && (Number(item.priority) || 0) < f.priority) return false;
      if (f.tag) {
        const t = (item.tags || '').toLowerCase();
        if (!t.includes(f.tag.toLowerCase())) return false;
      }
    }
    return true;
  }

  // ─── Render ─────────────────────────────────────────────────────────
  function render() {
    state.coCluster.clearLayers();
    state.prCluster.clearLayers();

    let coShown = 0, prShown = 0;
    const heatPoints = [];

    if (state.layers.companies) {
      state.companies.forEach(c => {
        if (!matchFilters(c, 'co')) return;
        const m = L.marker([c.lat, c.lon], { icon: makeCompanyIcon() });
        m.bindPopup(popupCompany(c));
        state.coCluster.addLayer(m);
        coShown++;
        heatPoints.push([c.lat, c.lon, 0.7]);
      });
    }
    if (state.layers.prospects) {
      state.prospects.forEach(p => {
        if (!matchFilters(p, 'pr')) return;
        const m = L.marker([p.lat, p.lon], { icon: makeProspectIcon(p.priority) });
        m.bindPopup(popupProspect(p));
        state.prCluster.addLayer(m);
        prShown++;
        const w = 0.4 + 0.12 * (Number(p.priority) || 0);
        heatPoints.push([p.lat, p.lon, Math.min(1, w)]);
      });
    }

    if (state.heatLayer) {
      state.map.removeLayer(state.heatLayer);
      state.heatLayer = null;
    }
    if (state.layers.heatmap && heatPoints.length && L.heatLayer) {
      state.heatLayer = L.heatLayer(heatPoints, {
        radius: 28, blur: 22, maxZoom: 12,
        gradient: { 0.2: '#3b82f6', 0.4: '#22c55e', 0.6: '#f59e0b', 0.8: '#ef4444', 1.0: '#8b5cf6' },
      }).addTo(state.map);
    }

    const $coCount = document.querySelector('[data-v30-count="companies"]');
    const $prCount = document.querySelector('[data-v30-count="prospects"]');
    if ($coCount) $coCount.textContent = String(coShown);
    if ($prCount) $prCount.textContent = String(prShown);

    // Auto-fit au premier rendu si on a des points
    if (!state.initialFitDone && (coShown + prShown) > 0) {
      state.initialFitDone = true;
      const all = [
        ...state.companies.filter(c => state.layers.companies && matchFilters(c, 'co')),
        ...state.prospects.filter(p => state.layers.prospects && matchFilters(p, 'pr')),
      ];
      if (all.length) {
        const bounds = L.latLngBounds(all.map(x => [x.lat, x.lon]));
        if (bounds.isValid()) state.map.fitBounds(bounds.pad(0.15));
      }
    }
  }

  // ─── Data loading ──────────────────────────────────────────────────
  async function loadMarkers() {
    const $loader = document.querySelector('[data-v30-carte-loading]');
    if ($loader) $loader.hidden = false;
    try {
      const r = await fetch('/api/map/markers');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      state.companies = Array.isArray(data.companies) ? data.companies : [];
      state.prospects = Array.isArray(data.prospects) ? data.prospects : [];
      render();
    } catch (e) {
      console.error('[carte] loadMarkers', e);
      toast('Impossible de charger les marqueurs : ' + e.message, 'error');
    } finally {
      if ($loader) $loader.hidden = true;
    }
  }

  async function loadStats() {
    try {
      const r = await fetch('/api/map/stats');
      if (!r.ok) return;
      const d = await r.json();
      const $co = document.querySelector('[data-v30-stat="companies"]');
      const $pr = document.querySelector('[data-v30-stat="prospects"]');
      if ($co && d.companies) {
        $co.textContent = `${d.companies.geocoded} / ${d.companies.with_address}`;
        $co.title = `Total entreprises : ${d.companies.total}`;
      }
      if ($pr && d.prospects) {
        $pr.textContent = `${d.prospects.geocoded} / ${d.prospects.with_address}`;
        $pr.title = `Total prospects actifs : ${d.prospects.total}`;
      }
    } catch (e) {
      // silencieux
    }
  }

  // ─── Bulk geocode (SSE) ─────────────────────────────────────────────
  function openBulkModal() {
    const $m = document.querySelector('[data-v30-bulk-modal]');
    if ($m) {
      $m.hidden = false;
      void $m.offsetWidth; // force reflow pour activer la transition
      $m.classList.add('is-open');
    }
    const $log = document.querySelector('[data-v30-bulk-log]');
    if ($log) $log.innerHTML = '';
    const $bar = document.querySelector('[data-v30-bulk-bar]');
    if ($bar) $bar.style.width = '0%';
    const $sum = document.querySelector('[data-v30-bulk-summary]');
    if ($sum) { $sum.hidden = true; $sum.innerHTML = ''; }
    const $prog = document.querySelector('[data-v30-bulk-progress]');
    if ($prog) $prog.hidden = true;
  }
  function closeBulkModal() {
    const $m = document.querySelector('[data-v30-bulk-modal]');
    if (!$m) return;
    $m.classList.remove('is-open');
    setTimeout(() => { $m.hidden = true; }, 160);
  }

  let _bulkController = null;
  async function startBulk() {
    if (_bulkController) return;
    const $entity = document.getElementById('v30-carte-bulk-entity');
    const $limit = document.getElementById('v30-carte-bulk-limit');
    const entity = $entity ? $entity.value : 'all';
    const limit = $limit ? $limit.value : '200';

    const $prog = document.querySelector('[data-v30-bulk-progress]');
    const $bar = document.querySelector('[data-v30-bulk-bar]');
    const $counter = document.querySelector('[data-v30-bulk-counter]');
    const $current = document.querySelector('[data-v30-bulk-current]');
    const $log = document.querySelector('[data-v30-bulk-log]');
    const $sum = document.querySelector('[data-v30-bulk-summary]');
    const $start = document.querySelector('[data-v30-bulk-start]');

    if ($prog) $prog.hidden = false;
    if ($sum) $sum.hidden = true;
    if ($start) $start.disabled = true;

    _bulkController = new AbortController();
    try {
      const url = `/api/map/geocode/bulk?entity=${encodeURIComponent(entity)}&limit=${encodeURIComponent(limit)}`;
      const r = await fetch(url, { signal: _bulkController.signal });
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'start') {
            if ($counter) $counter.textContent = `0 / ${ev.total}`;
            if ($current) $current.textContent = `Cible : ${ev.total} entité(s)`;
            if ($log) $log.innerHTML = '';
          } else if (ev.type === 'progress') {
            const pct = ev.total ? Math.round((ev.i / ev.total) * 100) : 0;
            if ($bar) $bar.style.width = pct + '%';
            if ($counter) $counter.textContent = `${ev.i} / ${ev.total}`;
            if ($current) $current.textContent = `${ev.kind === 'company' ? 'Entreprise' : 'Prospect'} · ${ev.name}`;
            if ($log) {
              const li = document.createElement('li');
              li.className = 'v30-carte__bulk-log-item v30-carte__bulk-log-item--' + (ev.status || '');
              const dot = ev.status === 'ok' ? '✓' : ev.status === 'skip' ? '·' : '×';
              li.innerHTML = `<span class="v30-carte__bulk-log-dot">${dot}</span> <span>${escapeHtml(ev.name || '—')}</span>`;
              $log.prepend(li);
              while ($log.children.length > 80) $log.removeChild($log.lastChild);
            }
          } else if (ev.type === 'done') {
            if ($sum) {
              $sum.hidden = false;
              $sum.innerHTML = `
                <div class="v30-carte__bulk-summary-row"><strong>Terminé</strong></div>
                <div class="v30-carte__bulk-summary-row">✓ ${ev.ok} géocodé${ev.ok > 1 ? 's' : ''}</div>
                <div class="v30-carte__bulk-summary-row">· ${ev.skipped} ignoré${ev.skipped > 1 ? 's' : ''}</div>
                <div class="v30-carte__bulk-summary-row">× ${ev.errors} erreur${ev.errors > 1 ? 's' : ''}</div>`;
            }
            toast(`Geocoding terminé : ${ev.ok} ok, ${ev.errors} erreurs`, 'success');
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('[carte] bulk', e);
        toast('Erreur géocoding : ' + e.message, 'error');
      }
    } finally {
      _bulkController = null;
      if ($start) $start.disabled = false;
      // Recharger les marqueurs et stats
      state.initialFitDone = false;
      await Promise.all([loadMarkers(), loadStats()]);
    }
  }

  // ─── Geolocation ────────────────────────────────────────────────────
  function locateMe() {
    if (!navigator.geolocation) {
      toast('Géolocalisation non supportée', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const ll = [latitude, longitude];
      if (state.locateMarker) state.map.removeLayer(state.locateMarker);
      if (state.locateCircle) state.map.removeLayer(state.locateCircle);
      state.locateMarker = L.circleMarker(ll, {
        radius: 7, color: '#3b82f6', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.85,
      }).addTo(state.map).bindPopup('Vous êtes ici');
      state.locateCircle = L.circle(ll, {
        radius: Math.max(50, accuracy || 100),
        color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.08,
      }).addTo(state.map);
      state.map.setView(ll, 13);
    }, (err) => {
      toast('Géolocalisation refusée ou indisponible : ' + err.message, 'warn');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ─── Wire up UI ─────────────────────────────────────────────────────
  function wireUI() {
    // Couches
    $$('input[data-v30-layer]').forEach(el => {
      el.addEventListener('change', () => {
        const key = el.getAttribute('data-v30-layer');
        state.layers[key] = !!el.checked;
        if (key === 'companies') {
          if (state.layers.companies) state.map.addLayer(state.coCluster);
          else state.map.removeLayer(state.coCluster);
        } else if (key === 'prospects') {
          if (state.layers.prospects) state.map.addLayer(state.prCluster);
          else state.map.removeLayer(state.prCluster);
        }
        render();
      });
    });

    // Filtres
    const $search = $('#v30-carte-search');
    if ($search) {
      let t;
      $search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { state.filters.search = $search.value.trim(); render(); }, 200);
      });
    }
    const $status = $('#v30-carte-status');
    if ($status) {
      STATUS_OPTIONS.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        $status.appendChild(opt);
      });
      $status.addEventListener('change', () => {
        state.filters.status = $status.value;
        render();
      });
    }
    const $prio = $('#v30-carte-priority');
    if ($prio) {
      $prio.addEventListener('change', () => {
        state.filters.priority = Number($prio.value) || 0;
        render();
      });
    }
    const $tag = $('#v30-carte-tag');
    if ($tag) {
      let t;
      $tag.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { state.filters.tag = $tag.value.trim(); render(); }, 200);
      });
    }

    // Header buttons
    const $refresh = $('[data-v30-carte-refresh]');
    if ($refresh) $refresh.addEventListener('click', () => {
      state.initialFitDone = false;
      loadMarkers(); loadStats();
    });
    const $locate = $('[data-v30-carte-locate]');
    if ($locate) $locate.addEventListener('click', locateMe);
    const $bulk = $('[data-v30-carte-bulk]');
    if ($bulk) $bulk.addEventListener('click', openBulkModal);

    // Bulk modal
    $$('[data-v30-bulk-close]').forEach(b => b.addEventListener('click', closeBulkModal));
    const $start = $('[data-v30-bulk-start]');
    if ($start) $start.addEventListener('click', startBulk);
    const $modal = $('[data-v30-bulk-modal]');
    if ($modal) {
      $modal.addEventListener('click', (e) => { if (e.target === $modal) closeBulkModal(); });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = $('[data-v30-bulk-modal]');
      if (m && !m.hidden) closeBulkModal();
    });
  }

  // ─── Boot ───────────────────────────────────────────────────────────
  let _bootAttempts = 0;
  function boot() {
    if (typeof L === 'undefined') {
      // Leaflet pas encore chargé : retry borné (~5 s max)
      if (_bootAttempts++ > 100) {
        toast('Leaflet n\'a pas pu être chargé (CDN injoignable ?)', 'error');
        return;
      }
      setTimeout(boot, 50);
      return;
    }
    initMap();
    wireUI();
    loadMarkers();
    loadStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
