/* ProspUp v30 — Métiers v6 : arbre courbe + panneau détail (Design Piste F)
   Remplace l'ancienne grille de cartes. Conserve export JSON et custom métiers admin. */
(function () {
  'use strict';

  // ─── Utilitaires ─────────────────────────────────────────
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = (s == null) ? '' : String(s);
    return t.innerHTML;
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }

  // ─── Données : catégories ────────────────────────────────
  var CATS = [
    { k: 'logi', label: 'Ingénierie Logicielle',   color: 'oklch(0.62 0.18 278)' },
    { k: 'elec', label: 'Ingénierie Électronique', color: 'oklch(0.72 0.16 75)'  },
    { k: 'sys',  label: 'Ingénierie Système',      color: 'oklch(0.66 0.12 175)' },
    { k: 'life', label: 'Life Science',            color: 'oklch(0.70 0.18 350)' }
  ];

  var SECTEURS = {
    auto:   'Automobile',
    aero:   'Aéronautique',
    ferro:  'Ferroviaire',
    iot:    'IoT',
    telco:  'Télécommunications',
    energ:  'Énergie',
    semi:   'Semiconducteurs',
    def:    'Défense',
    prod:   'Production & robots industriels',
    drones: 'Drones',
    elec:   'Électronique',
    spa:    'Spatial',
    pharm:  'Pharmaceutique',
    dm:     'Dispositifs médicaux',
    bio:    'Biomédical',
    all:    'Tous secteurs'
  };

  var METIERS = [
    { cat:'logi', name:'Logiciel applicatif',
      desc:'Analyse des exigences fonctionnelles et techniques, conception architecture logicielle, développement et intégration, rédaction documentation technique.',
      secteurs:['auto','aero','ferro'] },
    { cat:'logi', name:'Test / Validation / Qualification logicielle',
      desc:'Élaboration de la stratégie de validation, rédaction et exécution des plans de tests, gestion des anomalies, qualification logicielle.',
      secteurs:['auto','aero','ferro'] },
    { cat:'logi', name:'Logiciels embarqués / Systèmes embarqués / IoT',
      desc:'Conception des fonctionnalités logicielles, architecture, programmation bas niveau, développement drivers et BSP, intégration matérielle.',
      secteurs:['auto','aero','iot'] },
    { cat:'logi', name:'Data Science / ML / Deep Learning / Vision',
      desc:'Développement Python, algorithmes de traitement de données, classification, réseaux de neurones, traitement d\'images, computer vision.',
      secteurs:['auto','aero','semi'] },
    { cat:'logi', name:'DevOps / Infrastructure / Cloud',
      desc:'Développement d\'environnements de tests et de production, supervision de l\'infrastructure, CI/CD, automatisation des déploiements.',
      secteurs:['telco','energ','auto'] },
    { cat:'logi', name:'Automatisme / Robotique Industrielle',
      desc:'Analyse fonctionnelle, conception et réalisation de schémas, programmation d\'automates, mise en service, supervision industrielle.',
      secteurs:['prod','auto','energ'] },
    { cat:'logi', name:'Gestion de projet logiciel / Scrum Master',
      desc:'Pilotage des activités de développement, interface fournisseurs, gestion planning et budget, reporting, coordination d\'équipe.',
      secteurs:['all'] },
    { cat:'logi', name:'Développement Web / Fullstack',
      desc:'Développement frontend, développement backend, design de l\'expérience utilisateur, intégration API, déploiement.',
      secteurs:['telco','energ'] },
    { cat:'elec', name:'Électronique analogique',
      desc:'Systèmes électroniques traitant des données continues (capteurs, amplification, filtrage), conception circuits analogiques, caractérisation.',
      secteurs:['auto','aero','elec'] },
    { cat:'elec', name:'Industrialisation',
      desc:'Transfert de production de cartes électroniques, suivi fournisseurs, traitement des non-conformités, optimisation processus.',
      secteurs:['elec','auto','prod'] },
    { cat:'elec', name:'FPGA / ASIC / SoC',
      desc:'Conception FPGA (circuit intégré programmable), développement VHDL/Verilog, simulation, vérification, intégration sur silicium.',
      secteurs:['semi','aero','def'] },
    { cat:'elec', name:'Électronique numérique',
      desc:'Conception cartes numériques, microcontrôleurs, bus de communication, intégration et tests sur banc.',
      secteurs:['auto','elec','def'] },
    { cat:'sys',  name:'Mécatronique / Robotique',
      desc:'Concevoir, dimensionner et modéliser l\'architecture des systèmes mécaniques et électroniques intégrés, prototypage, tests.',
      secteurs:['prod','auto','drones'] },
    { cat:'sys',  name:'Model Based Design (MBD)',
      desc:'Méthode de gestion de projet permettant de tester chaque fonctionnalité sur modèle avant implémentation, génération de code automatique.',
      secteurs:['auto','aero','ferro'] },
    { cat:'sys',  name:'Safety / Sûreté de fonctionnement',
      desc:'Évaluation des risques, analyses de sûreté, définition des exigences de sécurité fonctionnelle, conformité normative.',
      secteurs:['auto','aero','ferro'] },
    { cat:'sys',  name:'Contrôle commande / Automatique',
      desc:'Lois de commandes, asservissements, pilotage automatique, modélisation et simulation de systèmes dynamiques.',
      secteurs:['auto','aero','energ'] },
    { cat:'sys',  name:'Simulation multiphysique / Modélisation',
      desc:'Modélisation physique du système, conception des lois de régulation, simulation thermodynamique et mécanique.',
      secteurs:['auto','aero','energ'] },
    { cat:'sys',  name:'Mécanique',
      desc:'Conception et développement de solutions sous CATIA, réalisation des calculs de structure, dimensionnement, tolérancement.',
      secteurs:['auto','aero','spa'] },
    { cat:'sys',  name:'Système (ingénierie système)',
      desc:'Analyse des exigences, analyse fonctionnelle, identification des sous-systèmes, allocation des fonctions, spécifications techniques.',
      secteurs:['auto','aero','ferro'] },
    { cat:'sys',  name:'Test / Validation / Essais système',
      desc:'Identification des exigences techniques, rédaction des plans d\'essais, exécution des tests, gestion de configuration.',
      secteurs:['auto','aero','ferro'] },
    { cat:'life', name:'Qualification d\'équipements (Pharma & DM)',
      desc:'Rédaction et exécution des protocoles de qualification d\'équipements, analyse de risques, gestion des CAPA, documentation qualité.',
      secteurs:['pharm','dm','bio'] },
    { cat:'life', name:'Validation de systèmes automatisés (VSA)',
      desc:'Analyse des risques et des impacts, qualification et validation des automates, documentation de conformité.',
      secteurs:['pharm','dm','bio'] },
    { cat:'life', name:'Validation de systèmes d\'informations (VSI)',
      desc:'Analyse des risques et des impacts, qualification et validation des systèmes d\'information, conformité réglementaire.',
      secteurs:['pharm','dm','bio'] },
    { cat:'life', name:'Validation de produits (Dispositifs Médicaux)',
      desc:'Rédaction de plans de validation, identification des risques (FMEA), tests et essais cliniques, conformité marquage CE.',
      secteurs:['dm','bio','pharm'] },
    { cat:'life', name:'Affaires réglementaires',
      desc:'Veille réglementaire, dossiers d\'enregistrement, suivi des évolutions normatives (ISO 13485, IVDR, MDR), interface autorités.',
      secteurs:['pharm','dm','bio'] },
    { cat:'life', name:'Bio-statistiques / Data Clinique',
      desc:'Analyse statistique d\'essais cliniques, plans d\'analyse, data management, traitement de données patient.',
      secteurs:['pharm','bio','dm'] }
  ];

  var KEYWORDS = {
    'Logiciel applicatif': ['C/C++','Python','Java','UML','SCRUM','Git','Linux','SQL','REST','Agile'],
    'Test / Validation / Qualification logicielle': ['ISTQB','Python','RobotFramework','Selenium','LabVIEW','TestStand','CI/CD','TCL','JIRA','cycle V'],
    'Logiciels embarqués / Systèmes embarqués / IoT': ['embarqué','firmware','BSP','RTOS','C/C++','Linux embarqué','bare-metal','MCU','I²C/SPI','CAN'],
    'Data Science / ML / Deep Learning / Vision': ['Python','TensorFlow','PyTorch','OpenCV','Pandas','ML','deep learning','Jupyter','NumPy','Computer Vision'],
    'DevOps / Infrastructure / Cloud': ['Docker','Kubernetes','CI/CD','AWS','GitLab CI','Terraform','Linux','Jenkins','Python','Ansible'],
    'Automatisme / Robotique Industrielle': ['PLC','SCADA','Siemens','Schneider','automate','ROS','IEC 61131','WinCC','LabVIEW','robotique'],
    'Gestion de projet logiciel / Scrum Master': ['Agile','Scrum','JIRA','MS Project','planification','backlog','sprint','PMP','Kanban','reporting'],
    'Développement Web / Fullstack': ['React','Node.js','HTML/CSS','REST API','Python','Docker','PostgreSQL','Git','TypeScript','déploiement'],
    'Électronique analogique': ['LTSpice','Altium','ampli-op','filtres','capteurs','PCB','SPICE','oscilloscope','signal','caractérisation'],
    'Industrialisation': ['Altium','SAP','APQP','PPAP','DFM','BOM','fournisseurs','ERP','AOI','IPC-A-610'],
    'FPGA / ASIC / SoC': ['VHDL','Verilog','Xilinx','Intel FPGA','Vivado','ModelSim','simulation HDL','timing','SoC','IP core'],
    'Électronique numérique': ['STM32','Altium','CAN','SPI','I²C','UART','USB','protocoles','banc test','µC'],
    'Mécatronique / Robotique': ['CATIA','SolidWorks','Simulink','Adams','mécatronique','prototype','actionneurs','capteurs','intégration','robotique'],
    'Model Based Design (MBD)': ['MATLAB','Simulink','Stateflow','génération code','Embedded Coder','AUTOSAR','MIL/SIL/HIL','dSPACE','modélisation','vérification'],
    'Safety / Sûreté de fonctionnement': ['ISO 26262','IEC 61508','DO-178','FMEA','HAZOP','SIL/ASIL','FTA','analyse risques','functional safety','normes'],
    'Contrôle commande / Automatique': ['MATLAB','Simulink','PID','asservissement','LabVIEW','régulation','modélisation','système dynamique','commande','BMS'],
    'Simulation multiphysique / Modélisation': ['ANSYS','Fluent','COMSOL','MATLAB','thermodynamique','éléments finis','CFD','Simulink','AMESim','modélisation'],
    'Mécanique': ['CATIA','SolidWorks','Pro/ENGINEER','calculs structure','RDM','tolérancement','FEA','ANSYS','conception','CAO'],
    'Système (ingénierie système)': ['SysML','MBSE','Capella','DOORS','IBM Rhapsody','exigences','architecture système','allocation','modélisation','intégration'],
    'Test / Validation / Essais système': ['plans essais','banc test','dSPACE','HIL','configuration','LabVIEW','qualification','documentation','anomalies','traçabilité'],
    'Qualification d\'équipements (Pharma & DM)': ['QI/QO/QP','CAPA','GMP','BPF','validation équipements','FDA','protocoles','risk assessment','traçabilité','IQ/OQ/PQ'],
    'Validation de systèmes automatisés (VSA)': ['GAMP5','21 CFR Part 11','automates','validation CSV','risk-based','BPF','SCADA validation','DQ/IQ/OQ','Annex 11','LIMS'],
    'Validation de systèmes d\'informations (VSI)': ['GAMP5','ERP','LIMS','validation CSV','21 CFR Part 11','Annex 11','risk-based','SAP','documentation','tests'],
    'Validation de produits (Dispositifs Médicaux)': ['IEC 62304','ISO 13485','FMEA','marquage CE','MDR','essais cliniques','validation process','risk management','DHF','V&V'],
    'Affaires réglementaires': ['MDR','IVDR','ISO 13485','CEI','FDA 510k','dossiers enregistrement','veille réglementaire','CE marking','EUDAMED','PMA'],
    'Bio-statistiques / Data Clinique': ['SAS','R','analyse stats','ICH E9','data management','CDISC','rapports cliniques','randomisation','SAS/STAT','biostatistique']
  };

  var VOLUMES = {
    'Logiciel applicatif':                            { p:214, e:47, b:12, tr:'↑ 18' },
    'Test / Validation / Qualification logicielle':   { p:187, e:42, b:9,  tr:'↑ 12' },
    'Logiciels embarqués / Systèmes embarqués / IoT': { p:162, e:34, b:7,  tr:'↑ 9'  },
    'Data Science / ML / Deep Learning / Vision':     { p:143, e:31, b:5,  tr:'↑ 21' },
    'DevOps / Infrastructure / Cloud':                { p:121, e:28, b:8,  tr:'↑ 15' },
    'Automatisme / Robotique Industrielle':           { p:98,  e:24, b:6              },
    'Gestion de projet logiciel / Scrum Master':      { p:88,  e:21, b:4              },
    'Développement Web / Fullstack':                  { p:76,  e:18, b:3,  tr:'↑ 7'  },
    'Électronique analogique':                        { p:134, e:29, b:5              },
    'Industrialisation':                              { p:112, e:26, b:4              },
    'FPGA / ASIC / SoC':                              { p:89,  e:22, b:6,  tr:'↑ 11' },
    'Électronique numérique':                         { p:117, e:27, b:5              },
    'Mécatronique / Robotique':                       { p:108, e:25, b:5              },
    'Model Based Design (MBD)':                       { p:94,  e:23, b:6,  tr:'↑ 8'  },
    'Safety / Sûreté de fonctionnement':              { p:118, e:28, b:9,  tr:'↑ 14' },
    'Contrôle commande / Automatique':                { p:103, e:24, b:6              },
    'Simulation multiphysique / Modélisation':        { p:87,  e:20, b:4              },
    'Mécanique':                                      { p:145, e:32, b:7              },
    'Système (ingénierie système)':                   { p:96,  e:23, b:5              },
    'Test / Validation / Essais système':             { p:107, e:26, b:8              },
    'Qualification d\'équipements (Pharma & DM)':     { p:72,  e:18, b:4,  tr:'↑ 6'  },
    'Validation de systèmes automatisés (VSA)':       { p:65,  e:16, b:3              },
    'Validation de systèmes d\'informations (VSI)':   { p:58,  e:14, b:2              },
    'Validation de produits (Dispositifs Médicaux)':  { p:61,  e:15, b:3,  tr:'↑ 5'  },
    'Affaires réglementaires':                        { p:54,  e:13, b:2              },
    'Bio-statistiques / Data Clinique':               { p:41,  e:10, b:1,  tr:'↑ 4'  }
  };

  // ─── Géométrie de l'arbre ────────────────────────────────
  var TW = 800, TH = 612;
  var CAT_X = 14, CAT_W = 184, CAT_H = 50;
  var COL1_X = 230, COL2_X = 522;
  var MET_W = 258, MET_H = 30, MET_GAP = 6;
  var CAT_GAP = 22, TOP = 16;

  // Placement vertical des catégories + chips
  var placed = [];
  var yCursor = TOP;
  CATS.forEach(function (c) {
    var items = METIERS.filter(function (m) { return m.cat === c.k; });
    var half = Math.ceil(items.length / 2);
    var zoneH = half * (MET_H + MET_GAP) - MET_GAP;
    var cy = yCursor + zoneH / 2;
    placed.push({ k: c.k, label: c.label, color: c.color, items: items, half: half, zoneH: zoneH, startY: yCursor, cy: cy });
    yCursor += zoneH + CAT_GAP;
  });
  var totalH = Math.max(yCursor - CAT_GAP + TOP, TH);

  // Chips : liste plate avec positions absolues
  var chips = [];
  placed.forEach(function (pc) {
    pc.items.forEach(function (m, i) {
      var col = (i < pc.half) ? 0 : 1;
      var row = (i < pc.half) ? i : i - pc.half;
      var x = (col === 0) ? COL1_X : COL2_X;
      var y = pc.startY + row * (MET_H + MET_GAP);
      chips.push({ name: m.name, desc: m.desc, cat: m.cat, secteurs: m.secteurs, x: x, y: y, catY: pc.cy, catColor: pc.color, catLabel: pc.label });
    });
  });

  // Courbe cubic bezier
  function curve(x1, y1, x2, y2) {
    var dx = (x2 - x1) * 0.55;
    return 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + dx) + ' ' + y1 + ', ' + (x2 - dx) + ' ' + y2 + ', ' + x2 + ' ' + y2;
  }

  // ─── État de sélection ───────────────────────────────────
  var STATE = {
    selectedName: chips[0] ? chips[0].name : '',
    searchQuery: ''
  };

  // ─── Références DOM vers les éléments de l'arbre ─────────
  var domChips = {};   // name → element
  var domPaths = {};   // name → SVGPathElement
  var domCats  = {};   // catK → element

  // ─── Construction du DOM de l'arbre ─────────────────────
  function buildTree() {
    var inner = document.querySelector('[data-v6-inner]');
    if (!inner) return;

    inner.style.width  = TW + 'px';
    inner.style.height = totalH + 'px';

    // --- SVG ---
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'v6-svg');
    svg.setAttribute('viewBox', '0 0 ' + TW + ' ' + totalH);
    svg.setAttribute('preserveAspectRatio', 'none');

    // Courbes (une par chip)
    chips.forEach(function (ch) {
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', curve(CAT_X + CAT_W, ch.catY, ch.x, ch.y + MET_H / 2));
      path.setAttribute('stroke', ch.catColor);
      path.setAttribute('stroke-width', '1.25');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.32');
      svg.appendChild(path);
      domPaths[ch.name] = path;
    });

    // Cercles d'ancrage (un par catégorie)
    placed.forEach(function (pc) {
      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', CAT_X + CAT_W);
      circle.setAttribute('cy', pc.cy);
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', pc.color);
      svg.appendChild(circle);
    });

    inner.appendChild(svg);

    // --- Cartes catégorie ---
    placed.forEach(function (pc) {
      var el = document.createElement('div');
      el.className = 'v6-cat';
      el.setAttribute('data-v6-cat', pc.k);
      el.style.left   = CAT_X + 'px';
      el.style.top    = (pc.cy - CAT_H / 2) + 'px';
      el.style.width  = CAT_W + 'px';
      el.style.height = CAT_H + 'px';
      el.style.setProperty('--cat-color', pc.color);

      var swatch = document.createElement('span');
      swatch.className = 'v6-cat__swatch';
      swatch.style.background = pc.color;

      var nm = document.createElement('span');
      nm.className = 'v6-cat__nm';
      nm.textContent = pc.label;

      var ct = document.createElement('span');
      ct.className = 'v6-cat__ct';
      ct.textContent = pc.items.length;

      el.appendChild(swatch);
      el.appendChild(nm);
      el.appendChild(ct);
      inner.appendChild(el);
      domCats[pc.k] = el;
    });

    // --- Chips métiers ---
    chips.forEach(function (ch) {
      var vol = VOLUMES[ch.name] || {};
      var el = document.createElement('div');
      el.className = 'v6-met';
      el.setAttribute('data-v6-chip', ch.name);
      el.style.left  = ch.x + 'px';
      el.style.top   = ch.y + 'px';
      el.style.width = MET_W + 'px';
      el.title = ch.name;

      var dot = document.createElement('span');
      dot.className = 'v6-met__dot';
      dot.style.background = ch.catColor;

      var nm = document.createElement('span');
      nm.className = 'v6-met__nm';
      nm.textContent = ch.name;

      var volSpan = document.createElement('span');
      volSpan.className = 'v6-met__vol';
      volSpan.textContent = vol.p || '';

      el.appendChild(dot);
      el.appendChild(nm);
      el.appendChild(volSpan);

      el.addEventListener('click', function () {
        selectMetier(ch.name);
      });

      inner.appendChild(el);
      domChips[ch.name] = el;
    });
  }

  // ─── Visuel des paths SVG (sélection + recherche) ────────
  function refreshPaths() {
    chips.forEach(function (ch) {
      var path = domPaths[ch.name];
      if (!path) return;
      var chipEl = domChips[ch.name];
      var isHidden   = chipEl && chipEl.classList.contains('is-hidden');
      var isSelected = ch.name === STATE.selectedName;
      if (isSelected) {
        path.setAttribute('stroke-width', '2');
        path.setAttribute('opacity', '0.95');
      } else if (isHidden) {
        path.setAttribute('stroke-width', '1.25');
        path.setAttribute('opacity', '0.04');
      } else {
        path.setAttribute('stroke-width', '1.25');
        path.setAttribute('opacity', '0.32');
      }
    });
  }

  // ─── Sélection d'un métier ───────────────────────────────
  function selectMetier(name) {
    STATE.selectedName = name;

    // Mise à jour des classes sur les chips
    chips.forEach(function (ch) {
      var el = domChips[ch.name];
      if (!el) return;
      el.classList.toggle('is-on', ch.name === name);
    });

    // Mise à jour des classes sur les catégories
    var selectedChip = null;
    chips.forEach(function (ch) { if (ch.name === name) selectedChip = ch; });
    CATS.forEach(function (c) {
      var el = domCats[c.k];
      if (!el) return;
      el.classList.toggle('is-on', !!(selectedChip && selectedChip.cat === c.k));
    });

    refreshPaths();
    updateDetail(name);
  }

  // ─── Mise à jour du panneau détail ───────────────────────
  function updateDetail(name) {
    var chip = chips.find(function (c) { return c.name === name; });
    if (!chip) return;

    var cat = CATS.find(function (c) { return c.k === chip.cat; });
    var vol = VOLUMES[name] || { p: '—', e: '—', b: '—' };
    var kws = KEYWORDS[name] || [];

    // Crumb
    var crumbEl = document.querySelector('[data-v6-crumb]');
    if (crumbEl) {
      var swatchEl = document.createElement('span');
      swatchEl.className = 'v6-crumb__swatch';
      swatchEl.style.background = cat ? cat.color : 'var(--accent)';
      var catLabelEl = document.createTextNode(cat ? cat.label : '');
      var sepEl = document.createElement('span');
      sepEl.className = 'v6-crumb__sep';
      sepEl.textContent = '›';
      var metierLabelEl = document.createTextNode('Métier');
      crumbEl.innerHTML = '';
      crumbEl.appendChild(swatchEl);
      crumbEl.appendChild(catLabelEl);
      crumbEl.appendChild(sepEl);
      crumbEl.appendChild(metierLabelEl);
    }

    // Titre
    var titleEl = document.querySelector('[data-v6-det-title]');
    if (titleEl) titleEl.textContent = name;

    // Description
    var descEl = document.querySelector('[data-v6-desc]');
    if (descEl) descEl.textContent = chip.desc;

    // Volumes
    var pEl = document.querySelector('[data-v6-vol-p]');
    var eEl = document.querySelector('[data-v6-vol-e]');
    var bEl = document.querySelector('[data-v6-vol-b]');
    var trEl = document.querySelector('[data-v6-trend]');
    if (pEl) pEl.textContent = vol.p;
    if (eEl) eEl.textContent = vol.e;
    if (bEl) bEl.textContent = vol.b;
    if (trEl) trEl.textContent = vol.tr || '';

    // Secteurs
    var secCt = document.querySelector('[data-v6-sec-ct]');
    var secsEl = document.querySelector('[data-v6-sectors]');
    if (secCt) secCt.textContent = chip.secteurs.length;
    if (secsEl) {
      secsEl.innerHTML = chip.secteurs.map(function (sk) {
        var label = SECTEURS[sk] || sk;
        var dotColor = cat ? cat.color : 'var(--accent)';
        return '<span class="v6-pill"><span class="v6-pill__dot" style="background:' + esc(dotColor) + '"></span>' + esc(label) + '</span>';
      }).join('') + '<span class="v6-pill v6-pill--add">＋ Ajouter</span>';
    }

    // Mots-clés
    var kwCt = document.querySelector('[data-v6-kw-ct]');
    var kwEl = document.querySelector('[data-v6-keywords]');
    if (kwCt) kwCt.textContent = kws.length;
    if (kwEl) {
      kwEl.innerHTML = kws.map(function (k) {
        return '<span class="v6-pill">' + esc(k) + '</span>';
      }).join('');
    }
  }

  // ─── Recherche : filtre les chips ────────────────────────
  function applySearch(q) {
    STATE.searchQuery = q;
    chips.forEach(function (ch) {
      var el = domChips[ch.name];
      if (!el) return;
      var kws = KEYWORDS[ch.name] || [];
      var secLabels = (ch.secteurs || []).map(function (sk) { return SECTEURS[sk] || sk; });
      var haystack = [ch.name, ch.desc].concat(kws).concat(secLabels).join(' ').toLowerCase();
      var hidden = q.length > 0 && haystack.indexOf(q) === -1;
      el.classList.toggle('is-hidden', hidden);
    });
    refreshPaths();
  }

  // ─── Segmented control ───────────────────────────────────
  function bindSeg() {
    var seg = document.querySelector('[data-v6-seg]');
    if (!seg) return;
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-seg]');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('is-on'); });
      btn.classList.add('is-on');
    });
  }

  // ─── Boutons header arbre ────────────────────────────────
  function bindTreeButtons() {
    var centerBtn = document.querySelector('[data-v6-center]');
    if (centerBtn) centerBtn.addEventListener('click', function () {
      var canvas = document.querySelector('[data-v6-canvas]');
      if (canvas) { canvas.scrollTop = 0; canvas.scrollLeft = 0; }
    });
  }

  // ─── Raccourci clavier ⌘K ────────────────────────────────
  function bindKbd() {
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        var input = document.querySelector('[data-v6-search]');
        if (input) { e.preventDefault(); input.focus(); input.select(); }
      }
    });
  }

  // ─── Barre de recherche ──────────────────────────────────
  function bindSearch() {
    var input = document.querySelector('[data-v6-search]');
    if (!input) return;
    var t = null;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        applySearch((input.value || '').trim().toLowerCase());
      }, 80);
    });
  }

  // ─── Export JSON (réutilise METIERS_DATA) ────────────────
  function bindExport() {
    var btn = document.querySelector('[data-v30-metiers-export]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var payload;
      if (typeof METIERS_DATA !== 'undefined' && Array.isArray(METIERS_DATA)) {
        var items = [];
        METIERS_DATA.forEach(function (metier) {
          (metier.specialties || []).forEach(function (spec) {
            items.push({
              domain: metier.name,
              specialty: spec.name,
              description: spec.ops || '',
              tech: spec.tech || {},
              sectors: spec.sectors || [],
              certifs: spec.certifs || []
            });
          });
        });
        payload = { generated_at: new Date().toISOString(), count: items.length, items: items };
      } else {
        payload = { generated_at: new Date().toISOString(), count: METIERS.length, items: METIERS };
      }
      var json = JSON.stringify(payload, null, 2);
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

  // ─── Custom métiers (admin CRUD) ─────────────────────────
  var CUSTOM = { items: [] };

  function renderCustom() {
    var host = document.querySelector('[data-v30-metiers-list]');
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
    if (!document.querySelector('[data-v30-metiers-list]')) return;
    return fetchJSON('/api/custom_metiers').then(function (res) {
      CUSTOM.items = (res && (res.items || res.metiers || (Array.isArray(res) ? res : []))) || [];
      renderCustom();
    }).catch(function () {
      var host = document.querySelector('[data-v30-metiers-list]');
      if (host) host.innerHTML = '<div class="empty" style="padding:18px;">Erreur de chargement.</div>';
    });
  }

  function bindCustom() {
    var addBtn = document.querySelector('[data-v30-metier-add]');
    if (addBtn) addBtn.addEventListener('click', function () {
      var type     = prompt('Type (ex: metier, tech, specialty) :', 'tech');
      if (!type) return;
      var category = prompt('Catégorie (ex: Compétences) :', 'Compétences');
      if (!category) return;
      var value    = prompt('Valeur (ex: Kubernetes) :');
      if (!value) return;
      postJSON('/api/custom_metiers', { type: type.trim(), category: category.trim(), value: value.trim() })
        .then(function (res) {
          if (res.ok !== false) loadCustom();
          else toast('Échec : ' + (res.error || 'inconnu'), 'error');
        });
    });
    var host = document.querySelector('[data-v30-metiers-list]');
    if (host) host.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (!btn) return;
      if (!confirm('Supprimer ce métier ?')) return;
      fetch('/api/custom_metiers/' + btn.dataset.del, { method: 'DELETE', credentials: 'same-origin' })
        .then(loadCustom);
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    if (!document.querySelector('[data-v30-metiers]')) return;

    buildTree();
    selectMetier(chips[0] ? chips[0].name : '');

    bindSearch();
    bindSeg();
    bindTreeButtons();
    bindKbd();
    bindExport();
    bindCustom();
    loadCustom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
