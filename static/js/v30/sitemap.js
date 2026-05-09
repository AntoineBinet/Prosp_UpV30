/* ============================================================
   ProspUp v30 — Toile d'araignée (toile complète + détail)
   2 colonnes :
     - Toile interactive : SVG radial pannable/zoomable, 3 modes
       (Tout / 2° / Voisins), filtres catégorie + statut
     - Détail : titre, description, JS handlers, voisins, action Ouvrir
   ============================================================ */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const data = window.SITEMAP_DATA || { pages: [], categories: {}, root: {} };

  // ─── Layout constantes ────────────────────────────────
  const HUB_RADIUS = 38;
  const PAGE_RADIUS = 30;
  const ACTION_RADIUS = 9;
  const ROOT_RADIUS = 32;
  const RING_PAGES = 540;
  const RING_ACTIONS_INNER = 130;
  const RING_ACTIONS_OUTER = 220;
  const MAX_PER_RING = 4;
  const ACTION_ARC_DEG = 50;
  const HUB_ACTION_ARC = 290;
  const HUB_ACTION_START = -180 + 35;
  const LOGIN_OFFSET = 220;
  const START_ANGLE = -90;

  // ─── Modélisation ─────────────────────────────────────
  const allNodes = new Map();        // id → node {id, label, kind, cat, tier, href, x, y, status, tools, parentId}
  const adjacency = new Map();       // id → Set<id>
  const edgesList = [];              // {a, b, cat, status, kind:'root'|'page'|'action'}

  function addAdj(a, b) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }

  function buildModel() {
    allNodes.clear();
    adjacency.clear();
    edgesList.length = 0;

    const root = data.root || {};
    const hubId = data.hub || 'dashboard';
    const pages = data.pages || [];

    // root
    if (root && root.id) {
      allNodes.set(root.id, {
        id: root.id,
        label: root.label || 'Connexion',
        kind: 'root',
        cat: 'hub',
        tier: 'T0',
        href: root.href || '/login',
        sub: root.sub || '',
        icon: root.icon || '🔐',
        tools: null,
        status: null,
        status_note: null,
        parentId: null,
      });
    }

    pages.forEach(function (p) {
      const isHub = p.id === hubId;
      const node = {
        id: p.id,
        label: p.label,
        kind: isHub ? 'hub' : 'page',
        cat: p.cat,
        tier: isHub ? 'T0' : 'T1',
        href: p.href,
        sub: p.summary || '',
        icon: p.icon || '',
        tools: null,
        status: p.status || 'unknown',
        status_note: p.status_note || '',
        bugs: p.bugs || null,
        parentId: null,
      };
      allNodes.set(p.id, node);

      if (root && root.id && isHub) {
        addAdj(root.id, hubId);
        edgesList.push({ a: root.id, b: hubId, cat: 'hub', status: null, kind: 'root' });
      }
      if (!isHub) {
        addAdj(hubId, p.id);
        edgesList.push({ a: hubId, b: p.id, cat: p.cat, status: p.status, kind: 'page' });
      }

      (p.actions || []).forEach(function (act, idx) {
        const aid = p.id + '__act_' + idx;
        act._uid = aid;
        const aNode = {
          id: aid,
          label: act.label,
          kind: 'action',
          cat: p.cat,
          tier: 'T2',
          href: act.href,
          sub: '',
          icon: '',
          tools: act.tools || null,
          status: act.status || 'unknown',
          status_note: act.status_note || '',
          bugs: act.bugs || null,
          parentId: p.id,
        };
        allNodes.set(aid, aNode);
        addAdj(p.id, aid);
        edgesList.push({ a: p.id, b: aid, cat: p.cat, status: act.status, kind: 'action' });
      });
    });
  }

  // ─── État UI ──────────────────────────────────────────
  const state = {
    selectedId: null,
    depth: 'all',            // 'all' | 1 | 2
    catFilter: 'all',        // 'all' | 'navigate' | …
    statusFilter: null,      // null | 'ko' | 'warn'
    searchOpen: false,
    helpOpen: false,
    // pan/zoom
    scale: 1,
    minScale: 0.2,
    maxScale: 4,
    tx: 0,
    ty: 0,
    panning: false,
    panStart: { x: 0, y: 0 },
    panInitial: { tx: 0, ty: 0 },
    pinching: false,
    pinchStart: 0,
    pinchScale: 1,
  };

  // ─── DOM refs ─────────────────────────────────────────
  const refs = {
    crumbCurrent: document.querySelector('[data-crumb-current]'),
    statsNodes: document.querySelector('[data-stats-nodes]'),
    statsEdges: document.querySelector('[data-stats-edges]'),
    searchInput: document.getElementById('v30-sm-search-input'),
    searchPop: document.getElementById('v30-sm-searchpop'),
    searchResults: document.getElementById('v30-sm-search-results'),
    helpPanel: document.getElementById('v30-sm-help'),
    graphSvg: document.getElementById('v30-sm-graph-svg'),
    graphCanvas: document.getElementById('v30-sm-graph-canvas'),
    graphEdges: document.getElementById('v30-sm-graph-edges'),
    graphNodes: document.getElementById('v30-sm-graph-nodes'),
    graphContainer: document.getElementById('v30-sm-graph'),
    toggleBtns: document.querySelectorAll('[data-depth]'),
    catBtns: document.querySelectorAll('[data-cat-filter]'),
    statusBtns: document.querySelectorAll('[data-status-filter]'),
    detail: {
      kicker: document.querySelector('[data-detail-kicker]'),
      title: document.querySelector('[data-detail-title]'),
      desc: document.querySelector('[data-detail-desc]'),
      meta: document.querySelector('[data-detail-meta]'),
      cat: document.querySelector('[data-detail-cat]'),
      tier: document.querySelector('[data-detail-tier]'),
      kind: document.querySelector('[data-detail-kind]'),
      handlers: document.querySelector('[data-detail-handlers]'),
      handlersWrap: document.querySelector('[data-detail-handlers-wrap]'),
      endpoints: document.querySelector('[data-detail-endpoints]'),
      endpointsWrap: document.querySelector('[data-detail-endpoints-wrap]'),
      backend: document.querySelector('[data-detail-backend]'),
      backendWrap: document.querySelector('[data-detail-backend-wrap]'),
      status: document.querySelector('[data-detail-status]'),
      statusWrap: document.querySelector('[data-detail-status-wrap]'),
      neighbors: document.querySelector('[data-detail-neighbors]'),
      neighborsWrap: document.querySelector('[data-detail-neighbors-wrap]'),
      neighborsCount: document.querySelector('[data-detail-neighbors-count]'),
      actions: document.querySelector('[data-detail-actions]'),
      open: document.querySelector('[data-detail-open]'),
    },
  };

  // ─── Utils ────────────────────────────────────────────
  function el(tag, attrs, children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (children) children.forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function deg2rad(d) { return d * Math.PI / 180; }

  function curvePath(p1, p2, curvature) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy) || 1;
    const c = (curvature == null ? 0.18 : curvature) * dist;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const nx = -dy / dist;
    const ny = dx / dist;
    const ctrl = { x: mid.x + nx * c, y: mid.y + ny * c };
    return 'M' + p1.x + ',' + p1.y + ' Q' + ctrl.x + ',' + ctrl.y + ' ' + p2.x + ',' + p2.y;
  }

  function normalize(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  function truncate(s, n) {
    s = (s || '').toString();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function kindLabel(node) {
    if (!node) return '';
    if (node.kind === 'root') return 'Entry';
    if (node.kind === 'hub') return 'Hub';
    if (node.kind === 'page') return 'Route';
    if (node.kind === 'action') return 'Action';
    return '';
  }

  function categoryLabel(catKey) {
    if (catKey === 'hub') return 'Hub';
    const cat = (data.categories || {})[catKey];
    return cat ? cat.label : (catKey || '').toString();
  }

  // ─── Layout : positionne TOUS les nœuds en mode "Tout" ─
  function computeFullLayout() {
    const pages = data.pages || [];
    const root = data.root;
    const hubId = data.hub || 'dashboard';
    const dashboard = pages.find(function (p) { return p.id === hubId; }) || pages[0];
    if (!dashboard) return;

    // Hub au centre
    const hubNode = allNodes.get(hubId);
    if (hubNode) { hubNode.x = 0; hubNode.y = 0; hubNode._angle = 0; }

    // Connexion à gauche du hub
    if (root && root.id) {
      const r = allNodes.get(root.id);
      if (r) { r.x = -LOGIN_OFFSET; r.y = 0; }
    }

    // Pages réparties autour du hub
    const otherPages = pages.filter(function (p) { return p.id !== hubId; });
    const n = otherPages.length;
    otherPages.forEach(function (p, i) {
      const angle = START_ANGLE + (360 / n) * i;
      const a = deg2rad(angle);
      const node = allNodes.get(p.id);
      if (!node) return;
      node.x = RING_PAGES * Math.cos(a);
      node.y = RING_PAGES * Math.sin(a);
      node._angle = angle;
    });

    // Actions de chaque page disposées en éventail vers l'extérieur
    pages.forEach(function (p) {
      const acts = p.actions || [];
      const an = acts.length;
      if (an === 0) return;

      const isHub = p.id === hubId;
      const pageNode = allNodes.get(p.id);
      const baseAngle = isHub ? HUB_ACTION_START : (pageNode._angle || 0);
      const arcDeg = isHub ? HUB_ACTION_ARC : ACTION_ARC_DEG;

      const useTwoRings = !isHub && an > MAX_PER_RING;
      const ring1Count = useTwoRings ? Math.ceil(an / 2) : an;

      acts.forEach(function (act, j) {
        const onRing2 = useTwoRings && j >= ring1Count;
        const idxInRing = onRing2 ? (j - ring1Count) : j;
        const ringTotal = onRing2 ? (an - ring1Count) : ring1Count;
        const r = isHub
          ? RING_ACTIONS_INNER
          : (onRing2 ? RING_ACTIONS_OUTER : RING_ACTIONS_INNER);

        let angle;
        if (isHub) {
          angle = baseAngle + (arcDeg / Math.max(1, an - 1)) * j;
        } else if (ringTotal === 1) {
          angle = baseAngle;
        } else {
          const t = (idxInRing / (ringTotal - 1)) - 0.5;
          const localArc = onRing2 ? arcDeg * 1.15 : arcDeg;
          angle = baseAngle + t * localArc;
        }

        const a = deg2rad(angle);
        const node = allNodes.get(act._uid);
        if (!node) return;
        node.x = pageNode.x + r * Math.cos(a);
        node.y = pageNode.y + r * Math.sin(a);
        node._angle = angle;
      });
    });
  }

  // ─── Layout focal pour Voisins / 2° ───────────────────
  function computeFocalLayout(centerId, depth) {
    // Toujours mettre à jour le full layout d'abord (assure que hubNode etc. ont x,y)
    // puis on REPLACE les positions pour le sous-graphe centré.
    const visible = computeVisible(centerId, depth);
    const positions = new Map();
    positions.set(centerId, { x: 0, y: 0 });

    // Profondeur de chaque nœud
    const depthOf = new Map();
    depthOf.set(centerId, 0);
    let frontier = [centerId];
    let curDepth = 0;
    while (frontier.length > 0 && curDepth < 4) {
      const next = [];
      frontier.forEach(function (id) {
        const adj = adjacency.get(id) || new Set();
        adj.forEach(function (n) {
          if (!visible.has(n)) return;
          if (!depthOf.has(n)) {
            depthOf.set(n, curDepth + 1);
            next.push(n);
          }
        });
      });
      frontier = next;
      curDepth++;
    }

    // Groupes par profondeur
    const byDepth = {};
    depthOf.forEach(function (d, id) {
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(id);
    });

    const radii = { 0: 0, 1: 200, 2: 380, 3: 540 };
    Object.keys(byDepth).forEach(function (dKey) {
      const d = parseInt(dKey, 10);
      if (d === 0) return;
      const ids = byDepth[d];
      const r = radii[d] || (160 + d * 140);
      ids.forEach(function (id, i) {
        const angle = -90 + (360 / ids.length) * i;
        const a = deg2rad(angle);
        positions.set(id, { x: r * Math.cos(a), y: r * Math.sin(a) });
      });
    });

    // Applique les positions au modèle
    allNodes.forEach(function (node, id) {
      if (positions.has(id)) {
        const p = positions.get(id);
        node.x = p.x;
        node.y = p.y;
      } else {
        // Hors du sous-graphe : on les éloigne pour qu'ils soient hors viewport
        node.x = 99999;
        node.y = 99999;
      }
    });

    return visible;
  }

  function computeVisible(centerId, depth) {
    const visible = new Set([centerId]);
    if (depth === 'all') {
      allNodes.forEach(function (_, id) { visible.add(id); });
      return visible;
    }
    const maxDepth = depth || 1;
    let frontier = [centerId];
    for (let d = 0; d < maxDepth; d++) {
      const next = [];
      frontier.forEach(function (id) {
        const adj = adjacency.get(id);
        if (!adj) return;
        adj.forEach(function (n) {
          if (!visible.has(n)) {
            visible.add(n);
            next.push(n);
          }
        });
      });
      frontier = next;
    }
    return visible;
  }

  // ─── Rendu graph ──────────────────────────────────────
  function render() {
    const visible = (state.depth === 'all')
      ? new Set(Array.from(allNodes.keys()))
      : computeFocalLayout(state.selectedId || (data.hub || 'dashboard'), state.depth);

    if (state.depth === 'all') computeFullLayout();

    refs.graphEdges.innerHTML = '';
    refs.graphNodes.innerHTML = '';

    // Edges
    edgesList.forEach(function (e) {
      if (!visible.has(e.a) || !visible.has(e.b)) return;
      const na = allNodes.get(e.a);
      const nb = allNodes.get(e.b);
      if (!na || !nb) return;
      const isRoot = e.kind === 'root';
      const cls = ['v30-sm-edge'];
      if (isRoot) cls.push('v30-sm-edge--root');
      else cls.push('v30-sm-edge--cat-' + e.cat);
      if (e.status === 'ko') cls.push('is-status-ko');

      const path = el('path', {
        d: curvePath({ x: na.x, y: na.y }, { x: nb.x, y: nb.y }, e.kind === 'page' ? 0.1 : 0.05),
        class: cls.join(' '),
        'data-cat': e.cat,
        'data-edge-a': e.a,
        'data-edge-b': e.b,
      });
      if (e.status) path.setAttribute('data-status', e.status);
      refs.graphEdges.appendChild(path);
    });

    // Nodes
    visible.forEach(function (id) {
      const n = allNodes.get(id);
      if (!n) return;
      refs.graphNodes.appendChild(makeNode(n));
    });

    // Cascade
    Array.prototype.forEach.call(refs.graphNodes.querySelectorAll('.v30-sm-gnode'), function (node, i) {
      node.style.animationDelay = Math.min(i * 8, 600) + 'ms';
    });

    // Apply highlight + filters
    applyHighlight();
    applyCategoryFilter();
    applyStatusFilter();

    // Fit screen
    if (state.depth === 'all') {
      fitToScreen(false);
    } else {
      fitFocal();
    }
  }

  function makeNode(node) {
    const isCurrent = node.id === state.selectedId;
    const isRoot = node.kind === 'root';
    const isHub = node.kind === 'hub';
    const isAction = node.kind === 'action';

    let r = PAGE_RADIUS;
    if (isAction) r = ACTION_RADIUS;
    else if (isRoot) r = ROOT_RADIUS;
    else if (isHub) r = HUB_RADIUS;

    const status = node.status || 'unknown';
    const g = el('g', {
      class: 'v30-sm-gnode'
        + ' v30-sm-gnode--' + node.kind
        + ' v30-sm-gnode--status-' + status
        + (isCurrent ? ' v30-sm-gnode--current is-active' : ''),
      'data-id': node.id,
      'data-cat': node.cat,
      'data-kind': node.kind,
      'data-status': status,
      transform: 'translate(' + node.x + ',' + node.y + ')',
    });

    // Halo
    if (!isAction) {
      const halo = el('circle', {
        class: 'v30-sm-gnode__halo',
        r: r + 8,
        cx: 0, cy: 0,
      });
      g.appendChild(halo);
    }

    // Cercle principal
    const c = el('circle', {
      class: 'v30-sm-gnode__circle',
      cx: 0, cy: 0, r: r,
    });
    g.appendChild(c);

    // Status pastille (sauf root)
    if (!isRoot) {
      const dotR = isAction ? 3.2 : 5.5;
      const dotOffset = r * 0.74;
      const sd = el('circle', {
        class: 'v30-sm-gnode__status v30-sm-gnode__status--' + status,
        r: dotR,
        cx: dotOffset,
        cy: -dotOffset,
      });
      g.appendChild(sd);
    }

    // Label
    let lbl = node.label || '';
    if (isAction && lbl.length > 24) lbl = lbl.slice(0, 22) + '…';
    if ((isRoot || isHub || node.kind === 'page') && lbl.length > 18) lbl = lbl.slice(0, 16) + '…';

    if (isAction) {
      // Label sous la bulle
      const t = el('text', {
        class: 'v30-sm-gnode__label',
        x: 0,
        y: r + 12,
        text: lbl,
      });
      g.appendChild(t);
    } else {
      // Label centré dans la bulle
      const t = el('text', {
        class: 'v30-sm-gnode__label',
        x: 0,
        y: 0,
        text: lbl,
      });
      g.appendChild(t);
    }

    return g;
  }

  // ─── Highlight branche du sélectionné ────────────────
  function applyHighlight() {
    const id = state.selectedId;
    if (!id || state.depth !== 'all') {
      refs.graphNodes.classList.remove('is-dimmed');
      refs.graphEdges.classList.remove('is-dimmed');
      Array.prototype.forEach.call(refs.graphNodes.querySelectorAll('.is-active'), function (n) {
        if (!n.classList.contains('v30-sm-gnode--current')) n.classList.remove('is-active');
      });
      Array.prototype.forEach.call(refs.graphEdges.querySelectorAll('.is-active'), function (e) {
        e.classList.remove('is-active');
      });
      return;
    }

    refs.graphNodes.classList.add('is-dimmed');
    refs.graphEdges.classList.add('is-dimmed');

    const n = allNodes.get(id);
    if (!n) return;

    const activeIds = new Set([id]);
    if (n.kind === 'action' && n.parentId) activeIds.add(n.parentId);
    if (n.kind !== 'root' && (data.hub || 'dashboard')) activeIds.add(data.hub || 'dashboard');
    if (data.root && data.root.id) activeIds.add(data.root.id);

    // Pour une page : aussi ses actions
    if (n.kind === 'page' || n.kind === 'hub') {
      const adj = adjacency.get(n.id) || new Set();
      adj.forEach(function (a) {
        const ax = allNodes.get(a);
        if (ax && ax.kind === 'action') activeIds.add(a);
      });
    }

    Array.prototype.forEach.call(refs.graphNodes.querySelectorAll('.v30-sm-gnode'), function (node) {
      node.classList.toggle('is-active', activeIds.has(node.dataset.id));
    });

    Array.prototype.forEach.call(refs.graphEdges.querySelectorAll('.v30-sm-edge'), function (edge) {
      const a = edge.dataset.edgeA;
      const b = edge.dataset.edgeB;
      const active = activeIds.has(a) && activeIds.has(b);
      edge.classList.toggle('is-active', active);
    });
  }

  // ─── Filtre catégorie ─────────────────────────────────
  function applyCategoryFilter() {
    const cat = state.catFilter;
    refs.catBtns.forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.catFilter === cat);
    });
    if (cat === 'all') {
      refs.graphNodes.classList.remove('has-cat-filter');
      refs.graphEdges.classList.remove('has-cat-filter');
      Array.prototype.forEach.call(document.querySelectorAll('.v30-sm-gnode, .v30-sm-edge'), function (n) {
        n.classList.remove('is-cat-match');
      });
      return;
    }
    refs.graphNodes.classList.add('has-cat-filter');
    refs.graphEdges.classList.add('has-cat-filter');
    Array.prototype.forEach.call(refs.graphNodes.querySelectorAll('.v30-sm-gnode'), function (node) {
      node.classList.toggle('is-cat-match', node.dataset.cat === cat);
    });
    Array.prototype.forEach.call(refs.graphEdges.querySelectorAll('.v30-sm-edge'), function (edge) {
      edge.classList.toggle('is-cat-match', edge.dataset.cat === cat);
    });
  }

  // ─── Filtre statut ────────────────────────────────────
  function applyStatusFilter() {
    const status = state.statusFilter;
    refs.statusBtns.forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.statusFilter === status);
    });
    if (!status) {
      refs.graphNodes.classList.remove('has-status-filter');
      refs.graphEdges.classList.remove('has-status-filter');
      Array.prototype.forEach.call(document.querySelectorAll('.v30-sm-gnode, .v30-sm-edge'), function (n) {
        n.classList.remove('is-status-match');
      });
      return;
    }
    refs.graphNodes.classList.add('has-status-filter');
    refs.graphEdges.classList.add('has-status-filter');
    Array.prototype.forEach.call(refs.graphNodes.querySelectorAll('.v30-sm-gnode'), function (node) {
      node.classList.toggle('is-status-match', node.dataset.status === status);
    });
    Array.prototype.forEach.call(refs.graphEdges.querySelectorAll('.v30-sm-edge'), function (edge) {
      edge.classList.toggle('is-status-match', edge.dataset.status === status);
    });
  }

  // ─── Pan / Zoom ───────────────────────────────────────
  function applyTransform() {
    refs.graphCanvas.setAttribute('transform',
      'translate(' + state.tx + ',' + state.ty + ') scale(' + state.scale + ')'
    );
  }

  function fitToScreen(animate) {
    const rect = refs.graphContainer.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    refs.graphSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    const halfBox = RING_PAGES + RING_ACTIONS_OUTER + 80;
    const padding = 40;
    const sx = (w - 2 * padding) / (2 * halfBox);
    const sy = (h - 2 * padding) / (2 * halfBox);
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, Math.min(sx, sy)));
    state.tx = w / 2;
    state.ty = h / 2;
    if (!animate) refs.graphCanvas.classList.add('is-panning');
    applyTransform();
    if (!animate) {
      requestAnimationFrame(function () { refs.graphCanvas.classList.remove('is-panning'); });
    }
  }

  function fitFocal() {
    const rect = refs.graphContainer.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    refs.graphSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    // Taille basée sur la profondeur active : 1 → ~250, 2 → ~430
    const halfBox = state.depth === 1 ? 280 : 460;
    const padding = 40;
    const sx = (w - 2 * padding) / (2 * halfBox);
    const sy = (h - 2 * padding) / (2 * halfBox);
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, Math.min(sx, sy)));
    state.tx = w / 2;
    state.ty = h / 2;
    applyTransform();
  }

  function zoomBy(factor, cx, cy) {
    const newScale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * factor));
    if (newScale === state.scale) return;
    if (cx == null || cy == null) {
      const r = refs.graphContainer.getBoundingClientRect();
      cx = r.width / 2;
      cy = r.height / 2;
    }
    const wx = (cx - state.tx) / state.scale;
    const wy = (cy - state.ty) / state.scale;
    state.scale = newScale;
    state.tx = cx - wx * newScale;
    state.ty = cy - wy * newScale;
    applyTransform();
  }

  // ─── Sélection ────────────────────────────────────────
  function selectNode(id, opts) {
    if (!allNodes.has(id)) return;
    state.selectedId = id;
    opts = opts || {};

    // Mise à jour visuelle des nodes (sans re-render si en mode all)
    if (state.depth === 'all') {
      Array.prototype.forEach.call(refs.graphNodes.querySelectorAll('.v30-sm-gnode'), function (g) {
        const isCur = g.dataset.id === id;
        g.classList.toggle('v30-sm-gnode--current', isCur);
        g.classList.toggle('is-active', isCur);
      });
      applyHighlight();
    } else {
      // En mode focal : on re-layout autour du nouveau nœud
      render();
    }

    renderDetail();

    // Scroll into view en mode all : centre la vue sur le nœud
    if (opts.center && state.depth === 'all') {
      const n = allNodes.get(id);
      if (n) {
        const rect = refs.graphContainer.getBoundingClientRect();
        state.tx = rect.width / 2 - n.x * state.scale;
        state.ty = rect.height / 2 - n.y * state.scale;
        applyTransform();
      }
    }
  }

  function openSelected() {
    const n = state.selectedId ? allNodes.get(state.selectedId) : null;
    if (!n || !n.href || n.href === '#') return;
    window.location.href = n.href;
  }

  // ─── Détail ───────────────────────────────────────────
  function renderDetail() {
    const d = refs.detail;
    if (!state.selectedId) {
      d.kicker.textContent = 'Détail · Sélectionnez un nœud';
      d.title.textContent = '—';
      d.desc.textContent = 'Cliquez sur un nœud de la toile pour voir son détail, ou utilisez F pour rechercher.';
      d.meta.hidden = true;
      d.handlersWrap.hidden = true;
      d.endpointsWrap.hidden = true;
      d.backendWrap.hidden = true;
      d.statusWrap.hidden = true;
      d.neighborsWrap.hidden = true;
      d.actions.hidden = true;
      updateBreadcrumb(null);
      return;
    }

    const n = allNodes.get(state.selectedId);
    if (!n) return;

    const kind = (n.kind || '').toUpperCase();
    d.kicker.textContent = 'Détail · ' + (kind === 'ROOT' ? 'ENTRY' : kind);
    d.title.textContent = n.label;

    // Description
    let desc = n.sub || '';
    if (!desc && n.kind === 'action') {
      const tools = n.tools || {};
      const hasEndpoints = (tools.endpoints || []).length > 0;
      const hasBackend = (tools.backend || []).length > 0;
      if (!hasEndpoints && !hasBackend) {
        desc = 'Aucun endpoint testable (action UI/frontend uniquement).';
      } else {
        const parent = allNodes.get(n.parentId);
        desc = 'Action de la page « ' + (parent ? parent.label : '?') + ' ».';
      }
    }
    if (!desc && n.kind === 'page') desc = 'Page ProspUp.';
    if (!desc && n.kind === 'hub') desc = 'Hub central de l\'application.';
    if (!desc && n.kind === 'root') desc = 'Point d\'entrée de l\'application.';
    d.desc.textContent = desc;

    // Meta : catégorie + tier + kind
    d.meta.hidden = false;
    d.cat.textContent = categoryLabel(n.cat);
    d.cat.dataset.cat = n.cat;
    d.tier.textContent = n.tier;
    d.kind.textContent = kindLabel(n);

    // Tools
    const tools = n.tools || {};
    setCodeList(d.handlersWrap, d.handlers, tools.handlers, function (h) { return h + '()'; });
    setCodeList(d.endpointsWrap, d.endpoints, tools.endpoints, null);
    setCodeList(d.backendWrap, d.backend, tools.backend, null);

    // Statut
    if (n.status && n.kind !== 'root') {
      d.statusWrap.hidden = false;
      const labels = { ok: 'OK', warn: 'Améliorable', ko: 'En erreur', unknown: 'Non testé' };
      d.status.innerHTML = '';
      const dot = document.createElement('span');
      dot.className = 'dot dot--' + n.status;
      const txt = document.createTextNode(' ' + (labels[n.status] || '?'));
      d.status.appendChild(dot);
      d.status.appendChild(txt);
      if (n.status_note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = n.status_note;
        d.status.appendChild(note);
      }
    } else {
      d.statusWrap.hidden = true;
    }

    // Voisins
    const adj = Array.from(adjacency.get(n.id) || []);
    if (adj.length > 0) {
      d.neighborsWrap.hidden = false;
      d.neighborsCount.textContent = adj.length;
      d.neighbors.innerHTML = '';
      adj.forEach(function (nid) {
        const nb = allNodes.get(nid);
        if (!nb) return;
        const card = document.createElement('div');
        card.className = 'v30-sm-neighbor';
        card.dataset.id = nid;
        const dot = document.createElement('span');
        dot.className = 'v30-sm-neighbor__dot';
        dot.dataset.cat = nb.cat;
        const lbl = document.createElement('span');
        lbl.className = 'v30-sm-neighbor__label';
        lbl.textContent = nb.label;
        const arr = document.createElement('span');
        arr.className = 'v30-sm-neighbor__arrow';
        arr.textContent = '→';
        card.appendChild(dot);
        card.appendChild(lbl);
        card.appendChild(arr);
        card.addEventListener('click', function () { selectNode(nid, { center: true }); });
        d.neighbors.appendChild(card);
      });
    } else {
      d.neighborsWrap.hidden = true;
    }

    const canOpen = !!n.href && n.href !== '#';
    d.actions.hidden = !canOpen;

    updateBreadcrumb(n);
  }

  function setCodeList(wrap, codeEl, list, fmt) {
    if (!list || list.length === 0) { wrap.hidden = true; return; }
    wrap.hidden = false;
    codeEl.innerHTML = '';
    list.forEach(function (item) {
      const span = document.createElement('span');
      span.className = 'item';
      span.textContent = fmt ? fmt(item) : item;
      codeEl.appendChild(span);
    });
  }

  function updateBreadcrumb(n) {
    if (!refs.crumbCurrent) return;
    if (!n) { refs.crumbCurrent.textContent = '—'; return; }
    let txt = n.label;
    if (n.kind === 'action' && n.parentId) {
      const parent = allNodes.get(n.parentId);
      if (parent) txt = parent.label + ' › ' + n.label;
    }
    refs.crumbCurrent.textContent = txt;
  }

  // ─── Recherche ────────────────────────────────────────
  function openSearch() {
    state.searchOpen = true;
    refs.searchPop.hidden = false;
    refs.searchInput.focus();
    refs.searchInput.select();
    buildSearchResults('');
  }
  function closeSearch() {
    state.searchOpen = false;
    refs.searchPop.hidden = true;
  }

  function buildSearchResults(q) {
    refs.searchResults.innerHTML = '';
    const query = normalize((q || '').trim());
    const matches = [];
    allNodes.forEach(function (n) {
      const lbl = normalize(n.label);
      const sub = normalize(n.sub);
      if (!query || lbl.indexOf(query) !== -1 || sub.indexOf(query) !== -1) matches.push(n);
    });
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'v30-sm-searchpop__empty';
      empty.textContent = 'Aucun résultat';
      refs.searchResults.appendChild(empty);
      return;
    }
    matches.slice(0, 50).forEach(function (n, idx) {
      const li = document.createElement('li');
      li.dataset.id = n.id;
      if (idx === 0) li.classList.add('is-active');
      const dot = document.createElement('span');
      dot.className = 'v30-sm-searchpop__dot';
      const cat = (data.categories || {})[n.cat];
      dot.style.background = cat ? cat.color : (n.cat === 'hub' ? 'var(--v30-sm-cat-hub)' : 'var(--v30-sm-text-3)');
      const span = document.createElement('span');
      let label = n.label;
      if (n.kind === 'action' && n.parentId) {
        const parent = allNodes.get(n.parentId);
        if (parent) label = parent.label + ' › ' + n.label;
      }
      span.textContent = label;
      const tag = document.createElement('span');
      tag.className = 'v30-sm-searchpop__type';
      tag.textContent = n.tier;
      li.appendChild(dot);
      li.appendChild(span);
      li.appendChild(tag);
      li.addEventListener('click', function () {
        selectNode(n.id, { center: true });
        closeSearch();
        refs.searchInput.blur();
      });
      refs.searchResults.appendChild(li);
    });
  }

  // ─── Help ─────────────────────────────────────────────
  function toggleHelp() {
    state.helpOpen = !state.helpOpen;
    refs.helpPanel.hidden = !state.helpOpen;
  }

  // ─── Bindings ─────────────────────────────────────────
  function bindEvents() {
    // Toggle profondeur
    refs.toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const depth = btn.dataset.depth;
        state.depth = depth === 'all' ? 'all' : parseInt(depth, 10);
        refs.toggleBtns.forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        // En mode focal, on a besoin d'un nœud sélectionné
        if (state.depth !== 'all' && !state.selectedId) {
          state.selectedId = data.hub || 'dashboard';
        }
        render();
      });
    });

    // Filtres catégorie
    refs.catBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.catFilter = btn.dataset.catFilter;
        applyCategoryFilter();
      });
    });

    // Filtres statut (toggle)
    refs.statusBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const s = btn.dataset.statusFilter;
        state.statusFilter = (state.statusFilter === s) ? null : s;
        applyStatusFilter();
      });
    });

    // Zoom buttons
    document.querySelector('[data-zoom-in]').addEventListener('click', function () { zoomBy(1.25); });
    document.querySelector('[data-zoom-out]').addEventListener('click', function () { zoomBy(0.8); });
    document.querySelector('[data-zoom-reset]').addEventListener('click', function () {
      if (state.depth === 'all') fitToScreen(true);
      else fitFocal();
    });

    // Recherche
    refs.searchInput.addEventListener('focus', function () { if (!state.searchOpen) openSearch(); });
    refs.searchInput.addEventListener('input', function () {
      if (!state.searchOpen) openSearch();
      buildSearchResults(refs.searchInput.value);
    });
    refs.searchInput.addEventListener('keydown', function (e) {
      const items = Array.from(refs.searchResults.querySelectorAll('li'));
      let idx = items.findIndex(function (li) { return li.classList.contains('is-active'); });
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[idx]) {
          selectNode(items[idx].dataset.id, { center: true });
          closeSearch();
          refs.searchInput.blur();
        }
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSearch();
        refs.searchInput.blur();
        return;
      }
      items.forEach(function (li, i) { li.classList.toggle('is-active', i === idx); });
    });
    document.addEventListener('click', function (e) {
      if (!state.searchOpen) return;
      if (e.target.closest('.v30-sm-search') || e.target.closest('.v30-sm-searchpop')) return;
      closeSearch();
    });

    // Click sur node graphe
    refs.graphNodes.addEventListener('click', function (e) {
      const node = e.target.closest('.v30-sm-gnode');
      if (!node) return;
      e.stopPropagation();
      selectNode(node.dataset.id);
    });
    refs.graphNodes.addEventListener('dblclick', function (e) {
      const node = e.target.closest('.v30-sm-gnode');
      if (!node) return;
      selectNode(node.dataset.id);
      openSelected();
    });

    // Pan
    refs.graphContainer.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.v30-sm-gnode')) return;
      state.panning = true;
      state.panStart = { x: e.clientX, y: e.clientY };
      state.panInitial = { tx: state.tx, ty: state.ty };
      refs.graphContainer.classList.add('is-panning');
      refs.graphCanvas.classList.add('is-panning');
      try { refs.graphContainer.setPointerCapture(e.pointerId); } catch (_) {}
    });
    refs.graphContainer.addEventListener('pointermove', function (e) {
      if (!state.panning) return;
      state.tx = state.panInitial.tx + (e.clientX - state.panStart.x);
      state.ty = state.panInitial.ty + (e.clientY - state.panStart.y);
      applyTransform();
    });
    function endPan(e) {
      if (!state.panning) return;
      state.panning = false;
      refs.graphContainer.classList.remove('is-panning');
      refs.graphCanvas.classList.remove('is-panning');
      try { if (e && e.pointerId != null) refs.graphContainer.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    refs.graphContainer.addEventListener('pointerup', endPan);
    refs.graphContainer.addEventListener('pointercancel', endPan);
    refs.graphContainer.addEventListener('pointerleave', endPan);

    // Wheel zoom
    refs.graphContainer.addEventListener('wheel', function (e) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const r = refs.graphContainer.getBoundingClientRect();
      zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // Pinch to zoom
    let pointers = new Map();
    refs.graphContainer.addEventListener('pointerdown', function (e) { pointers.set(e.pointerId, e); });
    refs.graphContainer.addEventListener('pointermove', function (e) {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        const arr = Array.from(pointers.values());
        const dx = arr[0].clientX - arr[1].clientX;
        const dy = arr[0].clientY - arr[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (!state.pinching) {
          state.pinching = true;
          state.pinchStart = dist;
          state.pinchScale = state.scale;
        } else {
          const r = refs.graphContainer.getBoundingClientRect();
          const cx = (arr[0].clientX + arr[1].clientX) / 2 - r.left;
          const cy = (arr[0].clientY + arr[1].clientY) / 2 - r.top;
          const targetScale = Math.max(state.minScale, Math.min(state.maxScale, state.pinchScale * (dist / state.pinchStart)));
          const factor = targetScale / state.scale;
          zoomBy(factor, cx, cy);
        }
      }
    });
    function clearPointer(e) { pointers.delete(e.pointerId); if (pointers.size < 2) state.pinching = false; }
    refs.graphContainer.addEventListener('pointerup', clearPointer);
    refs.graphContainer.addEventListener('pointercancel', clearPointer);

    // Bouton ouvrir
    if (refs.detail.open) refs.detail.open.addEventListener('click', openSelected);

    // Help
    document.querySelectorAll('[data-toggle-help]').forEach(function (b) {
      b.addEventListener('click', toggleHelp);
    });
    refs.helpPanel.addEventListener('click', function (e) {
      if (e.target === refs.helpPanel) toggleHelp();
    });

    // Raccourcis clavier
    document.addEventListener('keydown', function (e) {
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if ((e.key === 'f' || e.key === 'F') && !inField) { e.preventDefault(); openSearch(); return; }
      if (e.key === '/' && !inField) { e.preventDefault(); openSearch(); return; }
      if ((e.key === 'h' || e.key === 'H' || e.key === '?') && !inField) { toggleHelp(); return; }
      if ((e.key === 'r' || e.key === 'R') && !inField) {
        if (state.depth === 'all') fitToScreen(true);
        else fitFocal();
        return;
      }
      if ((e.key === '+' || e.key === '=') && !inField) { zoomBy(1.25); return; }
      if ((e.key === '-' || e.key === '_') && !inField) { zoomBy(0.8); return; }
      if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSelected(); return; }
      if (e.key === 'Escape') {
        if (state.searchOpen) { closeSearch(); refs.searchInput.blur(); return; }
        if (state.helpOpen) toggleHelp();
        return;
      }
    });

    // Resize
    let resizeTO;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(function () {
        if (state.depth === 'all') fitToScreen(true);
        else fitFocal();
      }, 120);
    });
  }

  // ─── Init ─────────────────────────────────────────────
  function countEdges() {
    return edgesList.length;
  }

  function init() {
    if (!data.pages || data.pages.length === 0) {
      console.warn('[sitemap] aucune donnée');
      return;
    }
    buildModel();

    if (refs.statsNodes) refs.statsNodes.textContent = allNodes.size;
    if (refs.statsEdges) refs.statsEdges.textContent = countEdges();

    // Sélection initiale = hub (mais en mode "Tout" : pas de focus, juste highlight)
    state.selectedId = data.hub || (data.pages[0] && data.pages[0].id);
    bindEvents();
    render();
    renderDetail();
  }

  init();
})();
