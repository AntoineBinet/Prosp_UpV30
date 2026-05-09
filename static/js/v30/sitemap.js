/* ============================================================
   ProspUp v30 — Toile d'araignée (minimaliste, calque sur réf HTML)
   2 colonnes : Toile (gauche) + Détail (droite).
   - Lignes droites fines (pas de béziers)
   - Cercles white-fill avec stroke catégorie
   - Pas de halos / drop-shadows / animations
   - Labels uniquement sur la branche active
   - Default = "2°" (focal sur le nœud sélectionné + 2 sauts)
   ============================================================ */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const data = window.SITEMAP_DATA || { pages: [], categories: {}, root: {} };

  // Layout réf HTML : viewBox 540×600, hub à (270,300), ring1=130, ring2=220
  const VIEWBOX_W = 540;
  const VIEWBOX_H = 600;
  const CENTER_X = 270;
  const CENTER_Y = 300;
  const RING1 = 130;
  const RING2 = 220;
  const RING3 = 295;
  // Layout "Tout"
  const HUB_RADIUS = 18;
  const PAGE_RADIUS = 6;
  const ACTION_RADIUS = 4.5;
  const PAGE_RADIUS_BIG = 7; // selected/page actif
  const FULL_RING_PAGES = 280;
  const FULL_RING_ACTIONS_INNER = 78;
  const FULL_RING_ACTIONS_OUTER = 130;
  const FULL_MAX_PER_RING = 4;
  const FULL_ACTION_ARC_DEG = 50;
  const FULL_HUB_ACTION_ARC = 290;
  const FULL_HUB_ACTION_START = -180 + 35;
  const FULL_LOGIN_OFFSET = 130;
  const START_ANGLE = -90;

  // ─── Modèle ───────────────────────────────────────────
  const allNodes = new Map();
  const adjacency = new Map();
  const edgesList = [];

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

    if (root && root.id) {
      allNodes.set(root.id, {
        id: root.id, label: root.label || 'Connexion', kind: 'root', cat: 'hub',
        tier: 'T0', href: root.href || '/login', sub: root.sub || '',
        icon: root.icon || '🔐', tools: null, status: null, status_note: null, parentId: null,
      });
    }

    pages.forEach(function (p) {
      const isHub = p.id === hubId;
      allNodes.set(p.id, {
        id: p.id, label: p.label, kind: isHub ? 'hub' : 'page', cat: p.cat,
        tier: isHub ? 'T0' : 'T1', href: p.href, sub: p.summary || '',
        icon: p.icon || '', tools: null,
        status: p.status || 'unknown', status_note: p.status_note || '',
        bugs: p.bugs || null, parentId: null,
      });
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
        allNodes.set(aid, {
          id: aid, label: act.label, kind: 'action', cat: p.cat, tier: 'T2',
          href: act.href, sub: '', icon: '', tools: act.tools || null,
          status: act.status || 'unknown', status_note: act.status_note || '',
          bugs: act.bugs || null, parentId: p.id,
        });
        addAdj(p.id, aid);
        edgesList.push({ a: p.id, b: aid, cat: p.cat, status: act.status, kind: 'action' });
      });
    });
  }

  // ─── État UI ──────────────────────────────────────────
  const state = {
    selectedId: null,
    depth: 2,
    searchOpen: false,
    helpOpen: false,
    scale: 1, minScale: 0.25, maxScale: 4,
    tx: 0, ty: 0,
    panning: false, panStart: { x: 0, y: 0 }, panInitial: { tx: 0, ty: 0 },
    pinching: false, pinchStart: 0, pinchScale: 1,
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
  function normalize(s) {
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
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

  // ─── Sous-graphe focal ────────────────────────────────
  function computeVisible(centerId, depth) {
    const visible = new Set([centerId]);
    if (depth === 'all') {
      allNodes.forEach(function (_, id) { visible.add(id); });
      return visible;
    }
    let frontier = [centerId];
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach(function (id) {
        const adj = adjacency.get(id);
        if (!adj) return;
        adj.forEach(function (n) {
          if (!visible.has(n)) { visible.add(n); next.push(n); }
        });
      });
      frontier = next;
    }
    return visible;
  }

  // Voisins du nœud central : on les classe en deux anneaux selon profondeur
  function depthMap(centerId, visible) {
    const map = new Map();
    map.set(centerId, 0);
    let frontier = [centerId];
    let curDepth = 0;
    while (frontier.length > 0 && curDepth < 4) {
      const next = [];
      frontier.forEach(function (id) {
        const adj = adjacency.get(id) || new Set();
        adj.forEach(function (n) {
          if (!visible.has(n)) return;
          if (!map.has(n)) { map.set(n, curDepth + 1); next.push(n); }
        });
      });
      frontier = next;
      curDepth++;
    }
    return map;
  }

  // Layout focal : centerNode au centre, voisins en anneaux
  function computeFocalLayout(centerId, depth) {
    const visible = computeVisible(centerId, depth);
    const dMap = depthMap(centerId, visible);

    // Le hub (Dashboard) reste au centre si possible.
    // Si le centerId n'est PAS le hub, on positionne le hub en haut comme dans la réf,
    // et le centerId à un emplacement qui fait sens.
    const positions = new Map();
    const centerNode = allNodes.get(centerId);

    if (!centerNode) return visible;

    // Approche : centre = centerId. Place les voisins en anneaux.
    const byDepth = {};
    dMap.forEach(function (d, id) {
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(id);
    });

    positions.set(centerId, { x: CENTER_X, y: CENTER_Y });

    // Trie les voisins de niveau 1 par catégorie / kind pour stabilité visuelle
    if (byDepth[1]) {
      byDepth[1].sort(function (a, b) {
        const na = allNodes.get(a), nb = allNodes.get(b);
        return (na.cat || '').localeCompare(nb.cat || '') || (na.label || '').localeCompare(nb.label || '');
      });
    }
    if (byDepth[2]) {
      byDepth[2].sort(function (a, b) {
        const na = allNodes.get(a), nb = allNodes.get(b);
        return (na.cat || '').localeCompare(nb.cat || '') || (na.label || '').localeCompare(nb.label || '');
      });
    }

    Object.keys(byDepth).forEach(function (dKey) {
      const d = parseInt(dKey, 10);
      if (d === 0) return;
      const ids = byDepth[d];
      const r = d === 1 ? RING1 : (d === 2 ? RING2 : RING3);
      ids.forEach(function (id, i) {
        const angle = START_ANGLE + (360 / ids.length) * i;
        const a = deg2rad(angle);
        positions.set(id, { x: CENTER_X + r * Math.cos(a), y: CENTER_Y + r * Math.sin(a) });
      });
    });

    // Applique les positions au modèle
    allNodes.forEach(function (node, id) {
      if (positions.has(id)) {
        const p = positions.get(id);
        node.x = p.x; node.y = p.y;
      } else {
        node.x = -99999; node.y = -99999;
      }
    });

    return visible;
  }

  // Layout "Tout" : full radial
  function computeFullLayout() {
    const pages = data.pages || [];
    const hubId = data.hub || 'dashboard';
    const root = data.root;
    const dashboard = pages.find(function (p) { return p.id === hubId; }) || pages[0];
    if (!dashboard) return;

    const hubNode = allNodes.get(hubId);
    if (hubNode) { hubNode.x = CENTER_X; hubNode.y = CENTER_Y; hubNode._angle = 0; }
    if (root && root.id) {
      const r = allNodes.get(root.id);
      if (r) { r.x = CENTER_X - FULL_LOGIN_OFFSET; r.y = CENTER_Y; }
    }

    const otherPages = pages.filter(function (p) { return p.id !== hubId; });
    const n = otherPages.length;
    otherPages.forEach(function (p, i) {
      const angle = START_ANGLE + (360 / n) * i;
      const a = deg2rad(angle);
      const node = allNodes.get(p.id);
      if (!node) return;
      node.x = CENTER_X + FULL_RING_PAGES * Math.cos(a);
      node.y = CENTER_Y + FULL_RING_PAGES * Math.sin(a);
      node._angle = angle;
    });

    pages.forEach(function (p) {
      const acts = p.actions || [];
      const an = acts.length;
      if (an === 0) return;
      const isHub = p.id === hubId;
      const pageNode = allNodes.get(p.id);
      const baseAngle = isHub ? FULL_HUB_ACTION_START : (pageNode._angle || 0);
      const arcDeg = isHub ? FULL_HUB_ACTION_ARC : FULL_ACTION_ARC_DEG;
      const useTwoRings = !isHub && an > FULL_MAX_PER_RING;
      const ring1Count = useTwoRings ? Math.ceil(an / 2) : an;
      acts.forEach(function (act, j) {
        const onRing2 = useTwoRings && j >= ring1Count;
        const idxInRing = onRing2 ? (j - ring1Count) : j;
        const ringTotal = onRing2 ? (an - ring1Count) : ring1Count;
        const r = isHub
          ? FULL_RING_ACTIONS_INNER
          : (onRing2 ? FULL_RING_ACTIONS_OUTER : FULL_RING_ACTIONS_INNER);
        let angle;
        if (isHub) angle = baseAngle + (arcDeg / Math.max(1, an - 1)) * j;
        else if (ringTotal === 1) angle = baseAngle;
        else {
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

  // ─── Rendu graph ──────────────────────────────────────
  function render() {
    let visible;
    if (state.depth === 'all') {
      visible = new Set(Array.from(allNodes.keys()));
      computeFullLayout();
    } else {
      const center = state.selectedId || (data.hub || 'dashboard');
      visible = computeFocalLayout(center, state.depth);
    }

    refs.graphEdges.innerHTML = '';
    refs.graphNodes.innerHTML = '';

    // Branche active = chemin du sélectionné jusqu'au hub + ses voisins directs
    const activeIds = computeActiveBranch();

    // Edges : lignes droites
    edgesList.forEach(function (e) {
      if (!visible.has(e.a) || !visible.has(e.b)) return;
      const na = allNodes.get(e.a);
      const nb = allNodes.get(e.b);
      if (!na || !nb) return;
      const isActive = activeIds.has(e.a) && activeIds.has(e.b);
      const cls = ['v30-sm-edge'];
      if (isActive) cls.push('is-active');
      if (e.status === 'ko') cls.push('is-status-ko');

      const path = el('line', {
        x1: na.x, y1: na.y, x2: nb.x, y2: nb.y,
        class: cls.join(' '),
        'data-cat': e.cat,
        'data-edge-a': e.a, 'data-edge-b': e.b,
      });
      if (e.status) path.setAttribute('data-status', e.status);
      refs.graphEdges.appendChild(path);
    });

    // Nodes
    visible.forEach(function (id) {
      const n = allNodes.get(id);
      if (!n) return;
      const isActive = activeIds.has(id);
      refs.graphNodes.appendChild(makeNode(n, isActive));
    });

    fitToView();
  }

  // Branche active : sélectionné + chemin vers hub + ses voisins
  function computeActiveBranch() {
    const ids = new Set();
    if (!state.selectedId) return ids;
    const n = allNodes.get(state.selectedId);
    if (!n) return ids;
    ids.add(n.id);

    const hubId = data.hub || 'dashboard';
    if (n.kind !== 'root') ids.add(hubId);

    if (n.kind === 'action' && n.parentId) ids.add(n.parentId);

    // Voisins directs du sélectionné
    const adj = adjacency.get(n.id) || new Set();
    adj.forEach(function (a) { ids.add(a); });

    // Chemin sélectionné → hub
    if (n.kind === 'action' && n.parentId) {
      const parent = allNodes.get(n.parentId);
      if (parent && parent.kind !== 'hub') ids.add(parent.id);
    }
    return ids;
  }

  function makeNode(node, isActive) {
    const isCurrent = node.id === state.selectedId;
    const isRoot = node.kind === 'root';
    const isHub = node.kind === 'hub';
    const isAction = node.kind === 'action';

    let r;
    if (isHub || isRoot) r = HUB_RADIUS;
    else if (isCurrent) r = PAGE_RADIUS_BIG;
    else if (isAction) r = ACTION_RADIUS;
    else r = PAGE_RADIUS;

    const status = node.status || 'unknown';
    const g = el('g', {
      class: 'v30-sm-gnode'
        + ' v30-sm-gnode--' + node.kind
        + ' v30-sm-gnode--status-' + status
        + (isActive ? ' is-active' : '')
        + (isCurrent ? ' v30-sm-gnode--current' : ''),
      'data-id': node.id,
      'data-cat': node.cat,
      'data-kind': node.kind,
      'data-status': status,
      transform: 'translate(' + node.x + ',' + node.y + ')',
    });

    const c = el('circle', {
      class: 'v30-sm-gnode__circle',
      cx: 0, cy: 0, r: r,
    });
    g.appendChild(c);

    // Status pastille uniquement si active
    if (!isRoot && (isActive || status === 'ko')) {
      const dotR = isAction ? 2.5 : (isHub ? 4 : 3);
      const dotOffset = r * 0.72;
      const sd = el('circle', {
        class: 'v30-sm-gnode__status v30-sm-gnode__status--' + status,
        r: dotR, cx: dotOffset, cy: -dotOffset,
      });
      g.appendChild(sd);
    }

    // Label
    let lbl = node.label || '';
    if (isAction && lbl.length > 22) lbl = lbl.slice(0, 20) + '…';
    if ((isRoot || isHub || node.kind === 'page') && lbl.length > 18) lbl = lbl.slice(0, 16) + '…';

    if (isHub || isRoot) {
      // Hub label centré dedans
      const t = el('text', {
        class: 'v30-sm-gnode__label v30-sm-gnode__label--inside',
        x: 0, y: 4, text: lbl,
      });
      g.appendChild(t);
    } else {
      // Label au-dessus
      const t = el('text', {
        class: 'v30-sm-gnode__label',
        x: 0, y: -r - 8, text: lbl,
      });
      g.appendChild(t);
    }

    return g;
  }

  // ─── Fit / Zoom / Pan ─────────────────────────────────
  function applyTransform() {
    refs.graphCanvas.setAttribute('transform',
      'translate(' + state.tx + ',' + state.ty + ') scale(' + state.scale + ')'
    );
  }

  function fitToView() {
    const rect = refs.graphContainer.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    refs.graphSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    let halfBox;
    if (state.depth === 'all') halfBox = FULL_RING_PAGES + FULL_RING_ACTIONS_OUTER + 50;
    else if (state.depth === 1) halfBox = RING1 + 60;
    else halfBox = RING2 + 70;
    const padding = 40;
    const sx = (w - 2 * padding) / (2 * halfBox);
    const sy = (h - 2 * padding) / (2 * halfBox);
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, Math.min(sx, sy)));
    // Centre du graphe dans coordonnées modèle = (CENTER_X, CENTER_Y)
    state.tx = w / 2 - CENTER_X * state.scale;
    state.ty = h / 2 - CENTER_Y * state.scale;
    applyTransform();
  }

  function zoomBy(factor, cx, cy) {
    const newScale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * factor));
    if (newScale === state.scale) return;
    if (cx == null || cy == null) {
      const r = refs.graphContainer.getBoundingClientRect();
      cx = r.width / 2; cy = r.height / 2;
    }
    const wx = (cx - state.tx) / state.scale;
    const wy = (cy - state.ty) / state.scale;
    state.scale = newScale;
    state.tx = cx - wx * newScale;
    state.ty = cy - wy * newScale;
    applyTransform();
  }

  // ─── Sélection ────────────────────────────────────────
  function selectNode(id) {
    if (!allNodes.has(id)) return;
    state.selectedId = id;
    render();
    renderDetail();
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
      d.desc.textContent = 'Cliquez sur un nœud de la toile pour voir son détail.';
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

    let desc = n.sub || '';
    if (!desc && n.kind === 'action') {
      const tools = n.tools || {};
      const hasEndpoints = (tools.endpoints || []).length > 0;
      const hasBackend = (tools.backend || []).length > 0;
      if (!hasEndpoints && !hasBackend) desc = 'Aucun endpoint testable (action UI/frontend uniquement).';
      else {
        const parent = allNodes.get(n.parentId);
        desc = 'Action de la page « ' + (parent ? parent.label : '?') + ' ».';
      }
    }
    if (!desc && n.kind === 'page') desc = 'Page ProspUp.';
    if (!desc && n.kind === 'hub') desc = 'Hub central de l\'application.';
    if (!desc && n.kind === 'root') desc = 'Point d\'entrée de l\'application.';
    d.desc.textContent = desc;

    d.meta.hidden = false;
    d.cat.textContent = categoryLabel(n.cat);
    d.cat.dataset.cat = n.cat;
    d.tier.textContent = n.tier;
    d.kind.textContent = kindLabel(n);

    const tools = n.tools || {};
    setCodeList(d.handlersWrap, d.handlers, tools.handlers, function (h) { return h + '()'; });
    setCodeList(d.endpointsWrap, d.endpoints, tools.endpoints, null);
    setCodeList(d.backendWrap, d.backend, tools.backend, null);

    if (n.status && n.kind !== 'root') {
      d.statusWrap.hidden = false;
      const labels = { ok: 'OK', warn: 'Améliorable', ko: 'En erreur', unknown: 'Non testé' };
      d.status.innerHTML = '';
      const dot = document.createElement('span');
      dot.className = 'dot dot--' + n.status;
      d.status.appendChild(dot);
      d.status.appendChild(document.createTextNode(' ' + (labels[n.status] || '?')));
      if (n.status_note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = n.status_note;
        d.status.appendChild(note);
      }
    } else {
      d.statusWrap.hidden = true;
    }

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
        card.addEventListener('click', function () { selectNode(nid); });
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
        selectNode(n.id);
        closeSearch();
        refs.searchInput.blur();
      });
      refs.searchResults.appendChild(li);
    });
  }

  function toggleHelp() {
    state.helpOpen = !state.helpOpen;
    refs.helpPanel.hidden = !state.helpOpen;
  }

  // ─── Bindings ─────────────────────────────────────────
  function bindEvents() {
    refs.toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const depth = btn.dataset.depth;
        state.depth = depth === 'all' ? 'all' : parseInt(depth, 10);
        refs.toggleBtns.forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        if (state.depth !== 'all' && !state.selectedId) {
          state.selectedId = data.hub || 'dashboard';
        }
        render();
      });
    });

    document.querySelector('[data-zoom-in]').addEventListener('click', function () { zoomBy(1.25); });
    document.querySelector('[data-zoom-out]').addEventListener('click', function () { zoomBy(0.8); });
    document.querySelector('[data-zoom-reset]').addEventListener('click', function () { fitToView(); });

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
          selectNode(items[idx].dataset.id);
          closeSearch();
          refs.searchInput.blur();
        }
        return;
      } else if (e.key === 'Escape') {
        e.preventDefault(); closeSearch(); refs.searchInput.blur(); return;
      }
      items.forEach(function (li, i) { li.classList.toggle('is-active', i === idx); });
    });
    document.addEventListener('click', function (e) {
      if (!state.searchOpen) return;
      if (e.target.closest('.v30-sm-search') || e.target.closest('.v30-sm-searchpop')) return;
      closeSearch();
    });

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

    refs.graphContainer.addEventListener('wheel', function (e) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const r = refs.graphContainer.getBoundingClientRect();
      zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

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

    if (refs.detail.open) refs.detail.open.addEventListener('click', openSelected);

    document.querySelectorAll('[data-toggle-help]').forEach(function (b) {
      b.addEventListener('click', toggleHelp);
    });
    refs.helpPanel.addEventListener('click', function (e) {
      if (e.target === refs.helpPanel) toggleHelp();
    });

    document.addEventListener('keydown', function (e) {
      const inField = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      if ((e.key === 'f' || e.key === 'F') && !inField) { e.preventDefault(); openSearch(); return; }
      if (e.key === '/' && !inField) { e.preventDefault(); openSearch(); return; }
      if ((e.key === 'h' || e.key === 'H' || e.key === '?') && !inField) { toggleHelp(); return; }
      if ((e.key === 'r' || e.key === 'R') && !inField) { fitToView(); return; }
      if ((e.key === '+' || e.key === '=') && !inField) { zoomBy(1.25); return; }
      if ((e.key === '-' || e.key === '_') && !inField) { zoomBy(0.8); return; }
      if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSelected(); return; }
      if (e.key === 'Escape') {
        if (state.searchOpen) { closeSearch(); refs.searchInput.blur(); return; }
        if (state.helpOpen) toggleHelp();
        return;
      }
    });

    let resizeTO;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(function () { fitToView(); }, 120);
    });
  }

  function init() {
    if (!data.pages || data.pages.length === 0) {
      console.warn('[sitemap] aucune donnée');
      return;
    }
    buildModel();

    if (refs.statsNodes) refs.statsNodes.textContent = allNodes.size;
    if (refs.statsEdges) refs.statsEdges.textContent = edgesList.length;

    state.selectedId = data.hub || (data.pages[0] && data.pages[0].id);
    bindEvents();
    render();
    renderDetail();
  }

  init();
})();
