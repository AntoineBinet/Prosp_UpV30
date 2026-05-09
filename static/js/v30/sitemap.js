/* ============================================================
   ProspUp v30 — Toile d'araignée (split mini-graphe + index)
   Architecture 3 colonnes :
     1. Mini-graphe : SVG radial centré sur le nœud sélectionné
     2. Index complet : liste catégorisée de tous les nœuds
     3. Détail : titre, description, JS handlers, voisins, action Ouvrir
   ============================================================ */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const data = window.SITEMAP_DATA || { pages: [], categories: {}, root: {} };

  // ─── Modélisation des nœuds ────────────────────────────
  // On construit une structure unifiée : tous les nœuds (root, hub, pages, actions)
  // partagent le même schéma. id, label, kind, cat, tier, neighbors, ...
  //   - root  : Connexion (T0)
  //   - hub   : Dashboard (T0, hub central)
  //   - page  : pages principales (T1)
  //   - action: actions/boutons sur une page (T2)

  const allNodes = new Map(); // id → node
  const adjacency = new Map(); // id → Set<id>

  function addAdj(a, b) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }

  function buildModel() {
    allNodes.clear();
    adjacency.clear();

    const root = data.root || {};
    const hubId = data.hub || 'dashboard';

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

    (data.pages || []).forEach(function (p) {
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
      if (root && root.id) addAdj(root.id, hubId);
      if (!isHub) addAdj(hubId, p.id);

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
      });
    });
  }

  // Compte de liens unique
  function countEdges() {
    const seen = new Set();
    adjacency.forEach(function (set, k) {
      set.forEach(function (v) {
        const key = k < v ? k + '|' + v : v + '|' + k;
        seen.add(key);
      });
    });
    return seen.size;
  }

  // ─── État UI ──────────────────────────────────────────
  const state = {
    selectedId: null,
    depth: 1,            // 'all' | 1 | 2
    searchOpen: false,
    helpOpen: false,
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
    index: document.getElementById('v30-sm-index'),
    toggleBtns: document.querySelectorAll('[data-depth]'),
    detail: {
      kicker: document.querySelector('[data-detail-kicker]'),
      title: document.querySelector('[data-detail-title]'),
      desc: document.querySelector('[data-detail-desc]'),
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
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }

  function truncate(s, n) {
    s = (s || '').toString();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function kindLabel(node) {
    if (!node) return '';
    if (node.kind === 'root') return 'Route';
    if (node.kind === 'hub') return 'Hub';
    if (node.kind === 'page') return 'Route';
    if (node.kind === 'action') {
      const tools = node.tools || {};
      const hasEndpoints = (tools.endpoints || []).length > 0;
      const hasBackend = (tools.backend || []).length > 0;
      if (!hasEndpoints && !hasBackend) return 'Action';
      return 'Action';
    }
    return '';
  }

  function categoryLabel(catKey) {
    if (catKey === 'hub') return 'Hub';
    const cat = (data.categories || {})[catKey];
    return cat ? cat.label : (catKey || '').toString();
  }

  // ─── Rendu : Index complet ────────────────────────────
  function renderIndex() {
    const idx = refs.index;
    if (!idx) return;
    idx.innerHTML = '';

    const root = data.root;
    const hubId = data.hub || 'dashboard';
    const pages = data.pages || [];

    // Section HUB : root + hub page
    const hubSection = makeCatSection('hub', 'HUB');
    if (root && root.id) hubSection.list.appendChild(makeRow(allNodes.get(root.id)));
    const hubNode = allNodes.get(hubId);
    if (hubNode) hubSection.list.appendChild(makeRow(hubNode));
    hubSection.count.textContent = hubSection.list.children.length;
    idx.appendChild(hubSection.frag);

    // Une section par catégorie (ordre: navigate, records, outils, admin, autres)
    const catOrder = ['navigate', 'records', 'outils', 'admin', 'autres'];
    catOrder.forEach(function (catKey) {
      const catPages = pages.filter(function (p) { return p.cat === catKey && p.id !== hubId; });
      if (catPages.length === 0) return;
      const cat = (data.categories || {})[catKey] || { label: catKey };
      const sec = makeCatSection(catKey, cat.label.toUpperCase());

      catPages.forEach(function (p) {
        const pageNode = allNodes.get(p.id);
        if (pageNode) sec.list.appendChild(makeRow(pageNode));
        // Actions de la page directement après (T2, indentées)
        (p.actions || []).forEach(function (a) {
          const aNode = allNodes.get(a._uid);
          if (aNode) sec.list.appendChild(makeRow(aNode));
        });
      });

      const itemsCount = catPages.length + catPages.reduce(function (s, p) { return s + (p.actions || []).length; }, 0);
      sec.count.textContent = itemsCount;
      idx.appendChild(sec.frag);
    });
  }

  function makeCatSection(catKey, label) {
    const frag = document.createDocumentFragment();
    const wrap = document.createElement('div');
    wrap.className = 'v30-sm-cat';
    wrap.dataset.cat = catKey;

    const head = document.createElement('div');
    head.className = 'v30-sm-cat__head';
    const title = document.createElement('div');
    title.className = 'v30-sm-cat__title';
    title.innerHTML = '<span class="v30-sm-cat__dot" data-cat="' + catKey + '"></span>' + label;
    const count = document.createElement('div');
    count.className = 'v30-sm-cat__count';
    count.textContent = '0';
    head.appendChild(title);
    head.appendChild(count);

    const list = document.createElement('div');
    list.className = 'v30-sm-cat__list';

    wrap.appendChild(head);
    wrap.appendChild(list);
    frag.appendChild(wrap);

    return { frag, list, count };
  }

  function makeRow(node) {
    const row = document.createElement('div');
    row.className = 'v30-sm-row';
    if (node.kind === 'action') row.classList.add('is-action');
    row.dataset.id = node.id;
    row.setAttribute('role', 'option');
    row.setAttribute('tabindex', '0');

    const lbl = document.createElement('div');
    lbl.className = 'v30-sm-row__label';
    lbl.textContent = node.label;

    const kind = document.createElement('span');
    kind.className = 'v30-sm-row__kind';
    kind.textContent = kindLabel(node);

    const tier = document.createElement('span');
    tier.className = 'v30-sm-row__tier';
    tier.textContent = node.tier;

    row.appendChild(lbl);
    row.appendChild(kind);
    row.appendChild(tier);

    row.addEventListener('click', function () { selectNode(node.id); });
    row.addEventListener('dblclick', function () {
      selectNode(node.id);
      openSelected();
    });
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) openSelected();
        else selectNode(node.id);
      }
    });

    return row;
  }

  // ─── Rendu : Mini-graphe ──────────────────────────────
  function renderMiniGraph() {
    const svg = refs.graphSvg;
    const edgesG = refs.graphEdges;
    const nodesG = refs.graphNodes;
    edgesG.innerHTML = '';
    nodesG.innerHTML = '';

    // Empty state
    const existingEmpty = refs.graphContainer.querySelector('.v30-sm-graph__empty');
    if (existingEmpty) existingEmpty.remove();

    if (!state.selectedId) {
      const empty = document.createElement('div');
      empty.className = 'v30-sm-graph__empty';
      empty.textContent = 'Sélectionnez un nœud dans l\'index pour visualiser ses voisins.';
      refs.graphContainer.appendChild(empty);
      return;
    }

    const node = allNodes.get(state.selectedId);
    if (!node) return;

    const visible = computeVisible(state.selectedId, state.depth);

    // Layout : nœud sélectionné au centre, voisins immédiats sur ring 1, ring 2 plus loin
    const positions = layoutVisible(state.selectedId, visible);

    // ViewBox dynamique
    const stage = refs.graphContainer;
    const rect = stage.getBoundingClientRect();
    const w = Math.max(280, rect.width);
    const h = Math.max(220, rect.height);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    refs.graphCanvas.setAttribute('transform', 'translate(' + (w / 2) + ',' + (h / 2) + ')');

    // Edges (uniquement entre nœuds visibles)
    const edgeSeen = new Set();
    visible.forEach(function (id) {
      const adj = adjacency.get(id);
      if (!adj) return;
      adj.forEach(function (other) {
        if (!visible.has(other)) return;
        const key = id < other ? id + '|' + other : other + '|' + id;
        if (edgeSeen.has(key)) return;
        edgeSeen.add(key);
        const p1 = positions.get(id);
        const p2 = positions.get(other);
        if (!p1 || !p2) return;
        const isActive = (id === state.selectedId || other === state.selectedId);
        const e = el('path', {
          d: 'M' + p1.x + ',' + p1.y + ' L' + p2.x + ',' + p2.y,
          class: 'v30-sm-edge' + (isActive ? ' is-active' : ' is-dim'),
        });
        edgesG.appendChild(e);
      });
    });

    // Nodes
    visible.forEach(function (id) {
      const n = allNodes.get(id);
      const pos = positions.get(id);
      if (!n || !pos) return;
      nodesG.appendChild(makeGraphNode(n, pos));
    });
  }

  function computeVisible(centerId, depth) {
    // BFS jusqu'à profondeur donnée
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

  function layoutVisible(centerId, visible) {
    const positions = new Map();
    positions.set(centerId, { x: 0, y: 0 });

    if (state.depth === 'all') {
      // Layout simplifié : nœud central + voisins en ring + reste plus loin
      // On limite l'affichage à un sous-ensemble lisible
      const center = allNodes.get(centerId);
      const adj = Array.from(adjacency.get(centerId) || []);

      // Ring 1 : voisins directs
      const ring1Radius = 110;
      adj.forEach(function (id, i) {
        const angle = -90 + (360 / Math.max(1, adj.length)) * i;
        const a = deg2rad(angle);
        positions.set(id, { x: ring1Radius * Math.cos(a), y: ring1Radius * Math.sin(a) });
      });
      return positions;
    }

    // Profondeur 1 ou 2 : layout en anneaux successifs
    // Détermine la profondeur de chaque nœud
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

    // Plage de rayons selon viewBox approximatif
    const radii = { 0: 0, 1: 105, 2: 195, 3: 280 };

    Object.keys(byDepth).forEach(function (dKey) {
      const d = parseInt(dKey, 10);
      const ids = byDepth[d];
      const r = radii[d] || (60 + d * 80);
      if (d === 0) return; // centre déjà placé
      ids.forEach(function (id, i) {
        const angle = -90 + (360 / ids.length) * i;
        const a = deg2rad(angle);
        positions.set(id, { x: r * Math.cos(a), y: r * Math.sin(a) });
      });
    });

    return positions;
  }

  function makeGraphNode(node, pos) {
    const isCurrent = node.id === state.selectedId;
    const isRoot = node.kind === 'root';
    const isHub = node.kind === 'hub';
    const isAction = node.kind === 'action';

    const g = el('g', {
      class: 'v30-sm-gnode'
        + (isCurrent ? ' v30-sm-gnode--current' : '')
        + (isRoot ? ' v30-sm-gnode--root' : '')
        + (isHub ? ' v30-sm-gnode--hub' : ''),
      'data-id': node.id,
      'data-cat': node.cat,
      transform: 'translate(' + pos.x + ',' + pos.y + ')',
    });

    let r = 22;
    if (isAction) r = 8;
    else if (isCurrent) r = 14;
    else if (isHub) r = 22;
    else r = 14;

    const c = el('circle', {
      class: 'v30-sm-gnode__circle',
      cx: 0, cy: 0, r: r,
      'data-cat': node.cat,
    });
    g.appendChild(c);

    // Label
    if (isCurrent || isHub || node.kind === 'page' || node.kind === 'root') {
      const labelText = truncate(node.label, 22);
      const lbl = el('text', {
        class: 'v30-sm-gnode__label' + (!isCurrent && !isRoot ? ' v30-sm-gnode__label--ext' : ''),
        x: 0,
        y: isCurrent || isRoot ? -r - 8 : -r - 6,
        text: labelText,
      });
      g.appendChild(lbl);
    } else {
      // Petite étiquette pour les actions (au-dessus de la bulle)
      const lbl = el('text', {
        class: 'v30-sm-gnode__label v30-sm-gnode__label--ext',
        x: 0,
        y: -r - 5,
        text: truncate(node.label, 18),
      });
      g.appendChild(lbl);
    }

    g.addEventListener('click', function () { selectNode(node.id); });
    g.addEventListener('dblclick', function () { openSelected(); });

    return g;
  }

  // ─── Détail ───────────────────────────────────────────
  function renderDetail() {
    const d = refs.detail;
    if (!state.selectedId) {
      d.kicker.textContent = 'Détail · Sélectionnez un nœud';
      d.title.textContent = '—';
      d.desc.textContent = 'Cliquez sur un élément à gauche ou dans l\'index pour voir son détail.';
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
    const kicker = 'Détail · ' + (kind === 'ROOT' ? 'ENTRY' : kind);
    d.kicker.textContent = kicker;
    d.title.textContent = n.label;

    // Description (sub ou message contextuel)
    let desc = n.sub || '';
    if (!desc && n.kind === 'action') {
      const tools = n.tools || {};
      const hasEndpoints = (tools.endpoints || []).length > 0;
      const hasBackend = (tools.backend || []).length > 0;
      if (!hasEndpoints && !hasBackend) {
        desc = 'Aucun endpoint testable (action UI/frontend uniquement).';
      } else {
        desc = 'Action de la page « ' + (allNodes.get(n.parentId) || {}).label + ' ».';
      }
    }
    if (!desc && n.kind === 'page') desc = 'Page ProspUp.';
    if (!desc && n.kind === 'hub') desc = 'Hub central de l\'application.';
    if (!desc && n.kind === 'root') desc = 'Point d\'entrée de l\'application.';
    d.desc.textContent = desc;

    // Tools : handlers, endpoints, backend
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
        card.addEventListener('click', function () { selectNode(nid); });
        d.neighbors.appendChild(card);
      });
    } else {
      d.neighborsWrap.hidden = true;
    }

    // Actions
    const canOpen = !!n.href && n.href !== '#' && n.kind !== 'root';
    d.actions.hidden = !canOpen && n.kind !== 'root';
    if (n.kind === 'root' && n.href) d.actions.hidden = false;

    updateBreadcrumb(n);
  }

  function setCodeList(wrap, codeEl, list, fmt) {
    if (!list || list.length === 0) {
      wrap.hidden = true;
      return;
    }
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
    if (!n) {
      refs.crumbCurrent.textContent = '—';
      return;
    }
    let txt = n.label;
    if (n.kind === 'action' && n.parentId) {
      const parent = allNodes.get(n.parentId);
      if (parent) txt = parent.label + ' › ' + n.label;
    }
    refs.crumbCurrent.textContent = txt;
  }

  // ─── Sélection ────────────────────────────────────────
  function selectNode(id) {
    if (!allNodes.has(id)) return;
    state.selectedId = id;

    // Met à jour les rows
    Array.prototype.forEach.call(refs.index.querySelectorAll('.v30-sm-row'), function (r) {
      r.classList.toggle('is-active', r.dataset.id === id);
    });

    // Scroll into view
    const activeRow = refs.index.querySelector('.v30-sm-row.is-active');
    if (activeRow && typeof activeRow.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    renderMiniGraph();
    renderDetail();
  }

  function openSelected() {
    const n = state.selectedId ? allNodes.get(state.selectedId) : null;
    if (!n || !n.href || n.href === '#') return;
    window.location.href = n.href;
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
      if (!query || lbl.indexOf(query) !== -1 || sub.indexOf(query) !== -1) {
        matches.push(n);
      }
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
        renderMiniGraph();
      });
    });

    // Recherche
    refs.searchInput.addEventListener('focus', function () {
      if (!state.searchOpen) openSearch();
    });
    refs.searchInput.addEventListener('input', function () {
      if (!state.searchOpen) openSearch();
      buildSearchResults(refs.searchInput.value);
    });
    refs.searchInput.addEventListener('keydown', function (e) {
      const items = Array.from(refs.searchResults.querySelectorAll('li'));
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
          const id = items[idx].dataset.id;
          selectNode(id);
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

    // Ouvrir
    if (refs.detail.open) {
      refs.detail.open.addEventListener('click', openSelected);
    }

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
      // F (recherche) : toujours actif sauf quand on tape déjà
      if ((e.key === 'f' || e.key === 'F') && !inField) {
        e.preventDefault();
        openSearch();
        return;
      }
      // / (recherche)
      if (e.key === '/' && !inField) {
        e.preventDefault();
        openSearch();
        return;
      }
      // H (aide)
      if ((e.key === 'h' || e.key === 'H' || e.key === '?') && !inField) {
        toggleHelp();
        return;
      }
      // Cmd/Ctrl+O : ouvrir le nœud sélectionné
      if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openSelected();
        return;
      }
      // Esc : ferme search/help
      if (e.key === 'Escape') {
        if (state.searchOpen) { closeSearch(); refs.searchInput.blur(); return; }
        if (state.helpOpen) toggleHelp();
        return;
      }
      // Flèches haut/bas dans l'index
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !inField && !state.searchOpen) {
        e.preventDefault();
        const rows = Array.prototype.slice.call(refs.index.querySelectorAll('.v30-sm-row'));
        if (rows.length === 0) return;
        let curIdx = rows.findIndex(function (r) { return r.classList.contains('is-active'); });
        if (curIdx === -1) curIdx = 0;
        else curIdx = e.key === 'ArrowDown' ? Math.min(rows.length - 1, curIdx + 1) : Math.max(0, curIdx - 1);
        const row = rows[curIdx];
        if (row) selectNode(row.dataset.id);
      }
    });

    // Resize : re-render mini-graph (viewBox dépend de la taille)
    let resizeTO;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTO);
      resizeTO = setTimeout(function () { renderMiniGraph(); }, 120);
    });
  }

  // ─── Init ─────────────────────────────────────────────
  function init() {
    if (!data.pages || data.pages.length === 0) {
      console.warn('[sitemap] aucune donnée');
      return;
    }
    buildModel();

    // Stats
    if (refs.statsNodes) refs.statsNodes.textContent = allNodes.size;
    if (refs.statsEdges) refs.statsEdges.textContent = countEdges();

    renderIndex();
    bindEvents();

    // Sélection initiale = hub
    const initialId = data.hub || (data.pages[0] && data.pages[0].id);
    if (initialId) selectNode(initialId);
  }

  init();
})();
