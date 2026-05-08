/* ============================================================
   ProspUp v30 — Toile d'araignée
   Rendu SVG radial : Connexion → Dashboard (hub) → pages → actions.
   Pan/zoom souris + tactile, tooltip, recherche, isolation de branche.
   ============================================================ */
(function () {
  'use strict';

  // ─── Constantes layout ────────────────────────────────────
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HUB_RADIUS = 44;          // Rayon du nœud central (Connexion + Dashboard)
  const PAGE_RADIUS = 36;         // Rayon des nœuds page
  const ACTION_RADIUS = 11;       // Rayon des nœuds action
  const RING_PAGES = 640;         // Distance Dashboard → pages
  const RING_ACTIONS_INNER = 145; // Distance page → action ring 1
  const RING_ACTIONS_OUTER = 245; // Distance page → action ring 2 (si > MAX_PER_RING)
  const MAX_PER_RING = 4;         // Au-delà : on passe sur 2 anneaux
  const ACTION_ARC_DEG = 50;      // Ouverture de l'éventail d'actions (en degrés)
  const HUB_ACTION_ARC = 290;     // Hub Dashboard : arc < 360 pour laisser de la place à Connexion
  const HUB_ACTION_START = -180 + 35; // Démarre après la zone Connexion (à 180° = gauche)
  const LOGIN_OFFSET = 240;       // Distance Connexion → Dashboard (hors action ring)

  // Angles : on commence en haut (12h) et tourne sens horaire
  const START_ANGLE = -90; // -90° = top

  // ─── État ────────────────────────────────────────────────
  const state = {
    scale: 1,
    minScale: 0.25,
    maxScale: 4,
    tx: 0,
    ty: 0,
    panning: false,
    pinching: false,
    panStart: { x: 0, y: 0 },
    panInitial: { tx: 0, ty: 0 },
    pinchStart: 0,
    pinchScale: 1,
    activeId: null,
    helpOpen: false,
    searchOpen: false,
    catFilter: null,
  };

  const data = window.SITEMAP_DATA || { pages: [], categories: {}, root: {} };

  // Map id → nœud calculé (page ou action)
  const nodeIndex = new Map();
  // Map id → liste de descendants (pour highlight)
  const branchIndex = new Map();

  // ─── DOM refs ────────────────────────────────────────────
  const stage = document.getElementById('v30-sitemap-stage');
  const svg = document.getElementById('v30-sitemap-svg');
  const canvas = document.getElementById('v30-sitemap-canvas');
  const edgesG = document.getElementById('v30-sitemap-edges');
  const nodesG = document.getElementById('v30-sitemap-nodes');
  const tooltip = document.getElementById('v30-sitemap-tooltip');
  const tooltipTitle = tooltip.querySelector('[data-tooltip-title]');
  const tooltipSub = tooltip.querySelector('[data-tooltip-sub]');
  const tooltipStatus = tooltip.querySelector('[data-tooltip-status]');
  const tooltipNote = tooltip.querySelector('[data-tooltip-note]');
  const tooltipTools = tooltip.querySelector('[data-tooltip-tools]');

  const STATUS_LABELS = { ok: 'OK', warn: 'Améliorable', ko: 'KO', unknown: '?' };
  const helpPanel = document.getElementById('v30-sitemap-help');
  const searchPanel = document.getElementById('v30-sitemap-search');
  const searchInput = document.getElementById('v30-sitemap-search-input');
  const searchResults = document.getElementById('v30-sitemap-search-results');
  const statsPagesEl = document.querySelector('[data-stats-pages]');
  const statsActionsEl = document.querySelector('[data-stats-actions]');

  // ─── Utilitaires ─────────────────────────────────────────
  function deg2rad(d) { return d * Math.PI / 180; }

  function el(tag, attrs, children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') {
          e.textContent = attrs[k];
        } else {
          e.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      children.forEach(function (c) { if (c) e.appendChild(c); });
    }
    return e;
  }

  // Trace un Bezier courbe entre deux points
  function curvePath(p1, p2, curvature) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy);
    const c = (curvature == null ? 0.18 : curvature) * dist;
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    // Normale perpendiculaire (rotation 90°)
    const nx = -dy / dist;
    const ny = dx / dist;
    const ctrl = { x: mid.x + nx * c, y: mid.y + ny * c };
    return 'M' + p1.x + ',' + p1.y + ' Q' + ctrl.x + ',' + ctrl.y + ' ' + p2.x + ',' + p2.y;
  }

  // ─── Layout calcul ────────────────────────────────────────
  function computeLayout() {
    const pages = data.pages || [];
    const total = pages.length;
    if (total === 0) return;

    // Connexion à gauche du Dashboard
    const root = data.root;
    const dashboard = pages.find(function (p) { return p.id === (data.hub || 'dashboard'); }) || pages[0];

    // Dashboard placé au centre (0, 0)
    dashboard.x = 0;
    dashboard.y = 0;
    dashboard._angle = 0;
    dashboard._isHub = true;

    // Connexion placée à gauche du Dashboard
    root.x = -LOGIN_OFFSET;
    root.y = 0;

    // Pages réparties autour du Dashboard
    const otherPages = pages.filter(function (p) { return p !== dashboard; });
    const n = otherPages.length;
    otherPages.forEach(function (p, i) {
      const angle = START_ANGLE + (360 / n) * i;
      const a = deg2rad(angle);
      p.x = dashboard.x + RING_PAGES * Math.cos(a);
      p.y = dashboard.y + RING_PAGES * Math.sin(a);
      p._angle = angle;
    });

    // Actions de chaque page disposées en éventail vers l'extérieur
    // Pour les pages avec beaucoup d'actions, on étale sur deux anneaux
    pages.forEach(function (p) {
      const acts = p.actions || [];
      const an = acts.length;
      if (an === 0) return;

      const isHub = !!p._isHub;
      const baseAngle = isHub ? HUB_ACTION_START : p._angle;
      const arcDeg = isHub ? HUB_ACTION_ARC : ACTION_ARC_DEG;

      // Découpe en 1 ou 2 anneaux selon le nombre d'actions
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
          // Arc < 360 démarrant à HUB_ACTION_START : répartition uniforme
          angle = baseAngle + (arcDeg / Math.max(1, an - 1)) * j;
        } else if (ringTotal === 1) {
          angle = baseAngle;
        } else {
          // Éventail centré sur baseAngle
          // t va de -0.5 à +0.5
          const t = (idxInRing / (ringTotal - 1)) - 0.5;
          // Anneau extérieur : arc plus large pour respecter l'espacement
          const localArc = onRing2 ? arcDeg * 1.15 : arcDeg;
          angle = baseAngle + t * localArc;
        }

        const a = deg2rad(angle);
        act.x = p.x + r * Math.cos(a);
        act.y = p.y + r * Math.sin(a);
        act._angle = angle;
        act._ring = onRing2 ? 2 : 1;
        act._parentId = p.id;
        act._cat = p.cat;
      });
    });
  }

  // ─── Rendu SVG ────────────────────────────────────────────
  function render() {
    edgesG.innerHTML = '';
    nodesG.innerHTML = '';
    nodeIndex.clear();
    branchIndex.clear();

    const root = data.root;
    const pages = data.pages || [];
    const dashboard = pages.find(function (p) { return p._isHub; });

    // Edges : Connexion → Dashboard
    const e0 = el('path', {
      d: curvePath(root, dashboard, 0),
      class: 'v30-sm-edge v30-sm-edge--root',
    });
    edgesG.appendChild(e0);

    // Edges : Dashboard → pages
    pages.forEach(function (p) {
      if (p._isHub) return;
      const e = el('path', {
        d: curvePath(dashboard, p, 0.12),
        class: 'v30-sm-edge v30-sm-edge--cat-' + p.cat + ' is-edge-page',
        'data-edge-page': p.id,
        'data-cat': p.cat,
      });
      edgesG.appendChild(e);
    });

    // Edges : pages → actions
    pages.forEach(function (p) {
      const acts = p.actions || [];
      acts.forEach(function (act, idx) {
        const e = el('path', {
          d: curvePath(p, act, 0.06),
          class: 'v30-sm-edge v30-sm-edge--cat-' + p.cat + ' is-edge-action',
          'data-edge-page': p.id,
          'data-edge-action-id': p.id + '__act_' + idx,
          'data-cat': p.cat,
        });
        edgesG.appendChild(e);
      });
    });

    // Nodes
    let totalActions = 0;

    // Connexion
    nodesG.appendChild(makeNode({
      id: 'login',
      label: root.label || 'Connexion',
      icon: root.icon || '🔐',
      sub: root.sub || '',
      href: root.href || '/login',
      x: root.x,
      y: root.y,
      kind: 'root',
      cat: 'autres',
      r: HUB_RADIUS,
    }));
    nodeIndex.set('login', { kind: 'root', node: root });

    // Pages
    pages.forEach(function (p) {
      const isHub = p._isHub;
      nodesG.appendChild(makeNode({
        id: p.id,
        label: p.label,
        icon: p.icon || '',
        sub: p.summary || '',
        href: p.href,
        x: p.x,
        y: p.y,
        kind: isHub ? 'hub' : 'page',
        cat: p.cat,
        r: isHub ? HUB_RADIUS : PAGE_RADIUS,
        status: p.status || 'unknown',
      }));
      nodeIndex.set(p.id, { kind: isHub ? 'hub' : 'page', node: p });

      const acts = p.actions || [];
      acts.forEach(function (act, idx) {
        const aid = p.id + '__act_' + idx;
        act._uid = aid;
        nodesG.appendChild(makeNode({
          id: aid,
          label: act.label,
          icon: '',
          sub: act.label,
          href: act.href,
          x: act.x,
          y: act.y,
          kind: 'action',
          cat: p.cat,
          r: ACTION_RADIUS,
          status: act.status || 'unknown',
        }));
        nodeIndex.set(aid, { kind: 'action', node: act, parentId: p.id });
        totalActions++;
      });

      // Index branche : page + ses actions
      branchIndex.set(p.id, [p.id].concat(acts.map(function (a) { return a._uid; })));
    });

    // Stats
    if (statsPagesEl) statsPagesEl.textContent = pages.length;
    if (statsActionsEl) statsActionsEl.textContent = totalActions;

    // Cascade animée
    Array.prototype.forEach.call(nodesG.querySelectorAll('.v30-sm-node'), function (n, i) {
      n.style.animationDelay = Math.min(i * 12, 700) + 'ms';
    });
  }

  function makeNode(spec) {
    const status = spec.status || 'unknown';
    const g = el('g', {
      class: 'v30-sm-node v30-sm-node--' + spec.kind + ' v30-sm-node--status-' + status,
      'data-id': spec.id,
      'data-href': spec.href || '',
      'data-cat': spec.cat,
      'data-kind': spec.kind,
      'data-label': spec.label,
      'data-status': status,
      transform: 'translate(' + spec.x + ',' + spec.y + ')',
    });

    const c = el('circle', {
      class: 'v30-sm-node__circle',
      r: spec.r,
      cx: 0,
      cy: 0,
    });
    g.appendChild(c);

    // Pastille de statut (vert/orange/rouge) — coin haut-droit
    if (spec.kind !== 'root' && status !== 'unknown') {
      // Pour root on garde sobre. Action : pastille plus petite.
      const dotR = spec.kind === 'action' ? 4 : 7;
      const dotOffset = spec.r * 0.74;
      const dot = el('circle', {
        class: 'v30-sm-node__status v30-sm-node__status--' + status,
        r: dotR,
        cx: dotOffset,
        cy: -dotOffset,
      });
      g.appendChild(dot);
    } else if (status === 'unknown' && spec.kind !== 'root') {
      const dotR = spec.kind === 'action' ? 4 : 7;
      const dotOffset = spec.r * 0.74;
      const dot = el('circle', {
        class: 'v30-sm-node__status v30-sm-node__status--unknown',
        r: dotR,
        cx: dotOffset,
        cy: -dotOffset,
      });
      g.appendChild(dot);
    }

    // Icône (si présente, au-dessus du label)
    if (spec.icon) {
      const i = el('text', {
        class: 'v30-sm-node__icon',
        x: 0,
        y: spec.kind === 'root' || spec.kind === 'hub' ? -10 : -8,
        text: spec.icon,
      });
      g.appendChild(i);
    }

    // Label (multi-line si > 14 chars pour les pages, troncature pour les actions)
    let lbl = spec.label || '';
    if (spec.kind === 'action' && lbl.length > 28) {
      lbl = lbl.slice(0, 26) + '…';
    }

    if (spec.kind === 'action') {
      // Action : label en dehors du cercle (à droite du cercle, dans la direction radiale)
      const t = el('text', {
        class: 'v30-sm-node__label v30-sm-node__label--ext',
        x: 0,
        y: spec.r + 11,
        text: lbl,
      });
      g.appendChild(t);
    } else {
      const yLbl = spec.icon ? 12 : 0;
      const t = el('text', {
        class: 'v30-sm-node__label',
        x: 0,
        y: yLbl,
        text: lbl,
      });
      g.appendChild(t);
    }

    return g;
  }

  // ─── Pan / Zoom ──────────────────────────────────────────
  function applyTransform() {
    canvas.setAttribute('transform',
      'translate(' + state.tx + ',' + state.ty + ') scale(' + state.scale + ')'
    );
  }

  function fitToScreen(animate) {
    const stageRect = stage.getBoundingClientRect();
    const w = stageRect.width;
    const h = stageRect.height;
    // Boîte englobante approximative : RING_PAGES + RING_ACTIONS_OUTER + label
    const halfBox = RING_PAGES + RING_ACTIONS_OUTER + 110;
    const padding = 40;
    const sx = (w - 2 * padding) / (2 * halfBox);
    const sy = (h - 2 * padding) / (2 * halfBox);
    state.scale = Math.max(state.minScale, Math.min(state.maxScale, Math.min(sx, sy)));
    state.tx = w / 2;
    state.ty = h / 2;
    canvas.classList.toggle('is-panning', !animate);
    applyTransform();
    if (!animate) {
      // Force layout puis remet la transition
      requestAnimationFrame(function () { canvas.classList.remove('is-panning'); });
    }
  }

  function zoomBy(factor, cx, cy) {
    const newScale = Math.max(state.minScale, Math.min(state.maxScale, state.scale * factor));
    if (newScale === state.scale) return;
    if (cx == null || cy == null) {
      const r = stage.getBoundingClientRect();
      cx = r.width / 2;
      cy = r.height / 2;
    }
    // Conserver le point sous le curseur
    const wx = (cx - state.tx) / state.scale;
    const wy = (cy - state.ty) / state.scale;
    state.scale = newScale;
    state.tx = cx - wx * newScale;
    state.ty = cy - wy * newScale;
    applyTransform();
  }

  // Souris : drag
  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.v30-sitemap-help, .v30-sitemap-search, .v30-sitemap-tooltip')) return;
    if (e.target.closest('.v30-sm-node')) return; // click géré ailleurs
    state.panning = true;
    state.panStart = { x: e.clientX, y: e.clientY };
    state.panInitial = { tx: state.tx, ty: state.ty };
    stage.classList.add('is-panning');
    canvas.classList.add('is-panning');
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  });

  stage.addEventListener('pointermove', function (e) {
    if (!state.panning) return;
    state.tx = state.panInitial.tx + (e.clientX - state.panStart.x);
    state.ty = state.panInitial.ty + (e.clientY - state.panStart.y);
    applyTransform();
  });

  function endPan(e) {
    if (!state.panning) return;
    state.panning = false;
    stage.classList.remove('is-panning');
    canvas.classList.remove('is-panning');
    try { if (e && e.pointerId != null) stage.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);
  stage.addEventListener('pointerleave', endPan);

  // Wheel zoom
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const r = stage.getBoundingClientRect();
    zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Pinch to zoom (mobile)
  let pointers = new Map();
  stage.addEventListener('pointerdown', function (e) { pointers.set(e.pointerId, e); });
  stage.addEventListener('pointermove', function (e) {
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
        const r = stage.getBoundingClientRect();
        const cx = (arr[0].clientX + arr[1].clientX) / 2 - r.left;
        const cy = (arr[0].clientY + arr[1].clientY) / 2 - r.top;
        const targetScale = Math.max(state.minScale, Math.min(state.maxScale, state.pinchScale * (dist / state.pinchStart)));
        const factor = targetScale / state.scale;
        zoomBy(factor, cx, cy);
      }
    }
  });
  function clearPointer(e) { pointers.delete(e.pointerId); if (pointers.size < 2) state.pinching = false; }
  stage.addEventListener('pointerup', clearPointer);
  stage.addEventListener('pointercancel', clearPointer);

  // ─── Boutons zoom ────────────────────────────────────────
  document.querySelector('[data-zoom-in]').addEventListener('click', function () { zoomBy(1.25); });
  document.querySelector('[data-zoom-out]').addEventListener('click', function () { zoomBy(0.8); });
  document.querySelector('[data-zoom-reset]').addEventListener('click', function () { fitToScreen(true); });
  document.querySelectorAll('[data-toggle-help]').forEach(function (b) {
    b.addEventListener('click', toggleHelp);
  });

  // ─── Hover & Click sur nodes ─────────────────────────────
  function highlightBranch(id) {
    if (!id) {
      nodesG.classList.remove('is-dimmed');
      edgesG.classList.remove('is-dimmed');
      Array.prototype.forEach.call(document.querySelectorAll('.is-active'), function (n) {
        n.classList.remove('is-active');
      });
      return;
    }

    const idx = nodeIndex.get(id);
    if (!idx) return;

    let activeIds = new Set([id]);
    const activeEdges = new Set();

    if (idx.kind === 'action') {
      // Action : remonte au parent (page) puis Dashboard puis Connexion
      activeIds.add(idx.parentId);
      activeIds.add(data.hub || 'dashboard');
      activeIds.add('login');
      activeEdges.add(idx.parentId + '|' + id);
      activeEdges.add('hub|' + idx.parentId);
      activeEdges.add('root');
    } else if (idx.kind === 'page' || idx.kind === 'hub') {
      // Page : descend vers ses actions et remonte au Dashboard + Connexion
      const branch = branchIndex.get(id) || [id];
      branch.forEach(function (b) { activeIds.add(b); });
      if (idx.kind !== 'hub') {
        activeIds.add(data.hub || 'dashboard');
        activeEdges.add('hub|' + id);
      }
      activeIds.add('login');
      activeEdges.add('root');
      // Edges page → actions
      (idx.node.actions || []).forEach(function (a) {
        if (a._uid) activeEdges.add(id + '|' + a._uid);
      });
    } else if (idx.kind === 'root') {
      activeIds.add(data.hub || 'dashboard');
      activeEdges.add('root');
    }

    nodesG.classList.add('is-dimmed');
    edgesG.classList.add('is-dimmed');

    Array.prototype.forEach.call(document.querySelectorAll('.v30-sm-node'), function (n) {
      n.classList.toggle('is-active', activeIds.has(n.getAttribute('data-id')));
    });

    Array.prototype.forEach.call(edgesG.querySelectorAll('.v30-sm-edge'), function (eEl) {
      const isRootEdge = eEl.classList.contains('v30-sm-edge--root');
      const pid = eEl.getAttribute('data-edge-page');
      const aid = eEl.getAttribute('data-edge-action-id');
      let active = false;
      if (isRootEdge && activeEdges.has('root')) active = true;
      if (pid && !aid && activeEdges.has('hub|' + pid)) active = true;
      if (pid && aid && activeEdges.has(pid + '|' + aid)) active = true;
      eEl.classList.toggle('is-active', active);
    });
  }

  function showTooltip(node, evt) {
    const id = node.getAttribute('data-id');
    const idx = nodeIndex.get(id);
    if (!idx) return;
    const n = idx.node;
    tooltipTitle.textContent = n.label;
    tooltipSub.textContent = n.summary || (idx.kind === 'action' ? 'Action' : '');

    // Status badge
    const status = n.status || (idx.kind === 'root' ? null : 'unknown');
    if (status) {
      tooltipStatus.hidden = false;
      tooltipStatus.className = 'v30-sitemap-tooltip__status v30-sitemap-tooltip__status--' + status;
      tooltipStatus.textContent = STATUS_LABELS[status] || '?';
    } else {
      tooltipStatus.hidden = true;
    }

    // Status note
    const note = n.status_note || '';
    if (note) {
      tooltipNote.hidden = false;
      tooltipNote.textContent = note;
    } else {
      tooltipNote.hidden = true;
    }

    // Tools (handlers, endpoints, backend) — uniquement pour les actions / pages
    tooltipTools.innerHTML = '';
    const tools = n.tools;
    if (tools && (tools.handlers || tools.endpoints || tools.backend)) {
      const sections = [
        { key: 'handlers', label: 'JS handler' },
        { key: 'endpoints', label: 'Endpoints' },
        { key: 'backend', label: 'Backend' },
      ];
      sections.forEach(function (s) {
        const list = tools[s.key] || [];
        if (!list.length) return;
        const row = document.createElement('div');
        row.className = 'v30-sitemap-tooltip__tool-row';
        const lab = document.createElement('span');
        lab.className = 'v30-sitemap-tooltip__tool-label';
        lab.textContent = s.label;
        row.appendChild(lab);
        const val = document.createElement('span');
        val.className = 'v30-sitemap-tooltip__tool-val';
        val.textContent = list.join(' · ');
        row.appendChild(val);
        tooltipTools.appendChild(row);
      });
      tooltipTools.hidden = (tooltipTools.children.length === 0);
    } else {
      tooltipTools.hidden = true;
    }

    tooltip.hidden = false;
    moveTooltip(evt);
  }

  function moveTooltip(evt) {
    if (tooltip.hidden) return;
    const r = stage.getBoundingClientRect();
    let x = evt.clientX - r.left + 14;
    let y = evt.clientY - r.top + 14;
    // Garde le tooltip dans la stage
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw > r.width - 8) x = evt.clientX - r.left - tw - 14;
    if (y + th > r.height - 8) y = evt.clientY - r.top - th - 14;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  nodesG.addEventListener('mouseover', function (e) {
    const node = e.target.closest('.v30-sm-node');
    if (!node) return;
    highlightBranch(node.getAttribute('data-id'));
    showTooltip(node, e);
  });

  nodesG.addEventListener('mousemove', function (e) {
    if (e.target.closest('.v30-sm-node')) moveTooltip(e);
  });

  nodesG.addEventListener('mouseout', function (e) {
    const node = e.target.closest('.v30-sm-node');
    const related = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.v30-sm-node');
    if (!node || related === node) return;
    if (!state.activeId) {
      highlightBranch(null);
      hideTooltip();
    }
  });

  // Click → ouvre la page (nouvel onglet pour le centre de la stage : on garde l'onglet sitemap)
  nodesG.addEventListener('click', function (e) {
    const node = e.target.closest('.v30-sm-node');
    if (!node) return;
    const href = node.getAttribute('data-href');
    if (!href || href === '#') return;
    // Modifier+click → nouvel onglet, sinon même onglet (l'utilisateur peut revenir avec back)
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
      window.open(href, '_blank', 'noopener');
    } else {
      window.location.href = href;
    }
  });

  // ─── Légende cliquable (filtre par catégorie) ────────────
  document.querySelectorAll('.v30-sitemap-legend__item').forEach(function (item) {
    item.addEventListener('click', function () {
      const cat = item.getAttribute('data-cat');
      if (state.catFilter === cat) {
        state.catFilter = null;
      } else {
        state.catFilter = cat;
      }
      applyCategoryFilter();
    });
  });

  function applyCategoryFilter() {
    const cat = state.catFilter;
    document.querySelectorAll('.v30-sitemap-legend__item').forEach(function (i) {
      const c = i.getAttribute('data-cat');
      i.classList.toggle('is-muted', !!cat && c !== cat);
    });
    if (!cat) {
      nodesG.classList.remove('has-filter');
      edgesG.classList.remove('has-filter');
      Array.prototype.forEach.call(document.querySelectorAll('.v30-sm-node, .v30-sm-edge'), function (n) {
        n.classList.remove('is-cat-match');
      });
      return;
    }
    nodesG.classList.add('has-filter');
    edgesG.classList.add('has-filter');
    Array.prototype.forEach.call(document.querySelectorAll('.v30-sm-node'), function (n) {
      n.classList.toggle('is-cat-match', n.getAttribute('data-cat') === cat);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.v30-sm-edge'), function (eEl) {
      eEl.classList.toggle('is-cat-match', eEl.getAttribute('data-cat') === cat);
    });
  }

  // ─── Recherche ───────────────────────────────────────────
  function toggleSearch(open) {
    const willOpen = open == null ? !state.searchOpen : open;
    state.searchOpen = willOpen;
    searchPanel.hidden = !willOpen;
    if (willOpen) {
      searchInput.value = '';
      buildSearchResults('');
      searchInput.focus();
    }
  }

  function normalize(s) {
    // Lowercase + retire les diacritiques (é → e, à → a, ç → c…)
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  function buildSearchResults(query) {
    searchResults.innerHTML = '';
    const q = normalize((query || '').trim());
    const results = [];
    (data.pages || []).forEach(function (p) {
      const pLabel = normalize(p.label);
      const pSummary = normalize(p.summary);
      const matchPage = !q || pLabel.indexOf(q) !== -1 || pSummary.indexOf(q) !== -1;
      if (matchPage) {
        results.push({ id: p.id, label: p.label, cat: p.cat, kind: 'page' });
      }
      (p.actions || []).forEach(function (a) {
        const aLabel = normalize(a.label);
        if (!q || aLabel.indexOf(q) !== -1) {
          results.push({ id: a._uid, label: a.label, cat: p.cat, kind: 'action', parentLabel: p.label });
        }
      });
    });

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'v30-sitemap-search__empty';
      empty.textContent = 'Aucun résultat';
      searchResults.appendChild(empty);
      return;
    }

    results.slice(0, 50).forEach(function (r, idx) {
      const li = document.createElement('li');
      li.setAttribute('data-id', r.id);
      if (idx === 0) li.classList.add('is-active');
      const dot = document.createElement('span');
      dot.className = 'v30-sitemap-search__dot';
      const cat = data.categories[r.cat];
      dot.style.background = cat ? cat.color : 'var(--text-3)';
      li.appendChild(dot);
      const text = document.createElement('span');
      text.textContent = r.kind === 'action' ? r.parentLabel + ' › ' + r.label : r.label;
      li.appendChild(text);
      const tag = document.createElement('span');
      tag.className = 'v30-sitemap-search__cat';
      tag.textContent = r.kind;
      li.appendChild(tag);
      li.addEventListener('click', function () { focusNode(r.id); toggleSearch(false); });
      searchResults.appendChild(li);
    });
  }

  function focusNode(id) {
    const idx = nodeIndex.get(id);
    if (!idx) return;
    const n = idx.node;
    // Centre la vue sur le nœud
    const stageRect = stage.getBoundingClientRect();
    state.tx = stageRect.width / 2 - n.x * state.scale;
    state.ty = stageRect.height / 2 - n.y * state.scale;
    applyTransform();
    state.activeId = id;
    highlightBranch(id);
    setTimeout(function () { state.activeId = null; }, 2400);
  }

  searchInput.addEventListener('input', function () {
    buildSearchResults(searchInput.value);
  });

  searchInput.addEventListener('keydown', function (e) {
    const items = Array.from(searchResults.querySelectorAll('li'));
    let idx = items.findIndex(function (li) { return li.classList.contains('is-active'); });
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(items.length - 1, idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(0, idx - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[idx]) {
        const id = items[idx].getAttribute('data-id');
        focusNode(id);
        toggleSearch(false);
      }
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleSearch(false);
      return;
    }
    items.forEach(function (li, i) { li.classList.toggle('is-active', i === idx); });
  });

  // ─── Help panel ──────────────────────────────────────────
  function toggleHelp() {
    state.helpOpen = !state.helpOpen;
    helpPanel.hidden = !state.helpOpen;
  }

  // ─── Raccourcis clavier ──────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { zoomBy(1.25); }
    else if (e.key === '-' || e.key === '_') { zoomBy(0.8); }
    else if (e.key === 'r' || e.key === 'R') { fitToScreen(true); }
    else if (e.key === 'h' || e.key === 'H' || e.key === '?') { toggleHelp(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleSearch(true); }
    else if (e.key === 'Escape') {
      if (state.searchOpen) toggleSearch(false);
      else if (state.helpOpen) toggleHelp();
    }
  });

  // ─── Init ────────────────────────────────────────────────
  function init() {
    if (!data.pages || data.pages.length === 0) {
      console.warn('[sitemap] aucune donnée');
      return;
    }
    computeLayout();
    render();
    // Premier paint puis fit
    requestAnimationFrame(function () {
      fitToScreen(false);
    });
  }

  // Resize
  let resizeTO;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(function () { fitToScreen(true); }, 150);
  });

  init();
})();
