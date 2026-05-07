/* ProspUp v30 — Push : catégories + historique + templates (mécanique v29 sous UI v30). */
(function () {
  'use strict';

  // ─── STATE ────────────────────────────────────────────────
  var STATE = {
    categories: [],
    categoriesLoaded: false,
    pushLogs: [],
    pushFiltered: [],
    historiqueLoaded: false,
    allCandidates: null,
    catFiles: {},
    templates: [],
    openCatDetailId: null,
    catProspectsId: null
  };

  // ─── Helpers ──────────────────────────────────────────────
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : String(s));
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function safeStr(v) {
    if (typeof window.safeStr === 'function') return window.safeStr(v);
    return (v === null || v === undefined) ? '' : String(v);
  }
  function ic(name, size) {
    if (typeof window.icon === 'function') return window.icon(name, { size: size || 13 });
    return '';
  }
  function toast(msg, type, duration) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info', duration);
  }
  function fetchJSON(url, opts) {
    var o = opts || {};
    o.credentials = o.credentials || 'same-origin';
    o.headers = Object.assign({ 'Accept': 'application/json' }, o.headers || {});
    return fetch(url, o).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function postJSON(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }
  function parseKeywords(raw) {
    if (Array.isArray(raw)) return raw.filter(Boolean);
    if (!raw) return [];
    try { var v = JSON.parse(raw); if (Array.isArray(v)) return v; } catch (_) {}
    return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    if (typeof window.formatPushDate === 'function') return window.formatPushDate(iso);
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    } catch (_) { return iso; }
  }
  function fmtCompany(groupe, site) {
    if (typeof window.formatPushCompany === 'function') return window.formatPushCompany(groupe, site);
    if (!groupe && !site) return '—';
    return safeStr(groupe) + (site ? ' (' + safeStr(site) + ')' : '');
  }
  function pushChannelLabel(ch) {
    var s = (ch || '').trim().toLowerCase();
    if (s === 'linkedin') return ic('linkedin', 13) + ' LinkedIn';
    if (s === 'other')    return ic('send', 13) + ' Autre';
    return ic('mail', 13) + ' Email';
  }
  function pushChannelPill(ch) {
    var s = (ch || '').trim().toLowerCase();
    if (s === 'linkedin') return '<span class="push-channel-pill push-channel-pill--linkedin">' + ic('linkedin', 11) + ' LinkedIn</span>';
    if (s === 'other')    return '<span class="push-channel-pill push-channel-pill--other">' + ic('send', 11) + ' Autre</span>';
    return '<span class="push-channel-pill push-channel-pill--email">' + ic('mail', 11) + ' Email</span>';
  }
  function channelRowClass(ch) {
    var s = (ch || '').trim().toLowerCase();
    if (s === 'linkedin') return 'push-hist-row push-hist-row--linkedin';
    if (s === 'other')    return 'push-hist-row push-hist-row--other';
    return 'push-hist-row push-hist-row--email';
  }
  function renderDateCell(iso) {
    if (!iso) return '<span class="muted">—</span>';
    try {
      var d = new Date(iso);
      var now = new Date();
      var day = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
      var year = d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '';
      var time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      return '<div class="push-hist-date">' +
        '<div class="push-hist-date__day">' + esc(day + year) + '</div>' +
        '<div class="push-hist-date__time">' + esc(time) + '</div>' +
      '</div>';
    } catch (_) { return esc(iso); }
  }
  function updatePushStats() {
    var stats = document.querySelector('[data-v30-push-stats]');
    if (!stats) return;
    var total = STATE.pushFiltered.length;
    var allTotal = STATE.pushLogs.length;
    var today = new Date().toDateString();
    var todayCount = STATE.pushLogs.filter(function (l) {
      try { return new Date(l.sentAt || l.createdAt).toDateString() === today; } catch (_) { return false; }
    }).length;
    if (!allTotal) { stats.innerHTML = ''; return; }
    var parts = [];
    if (total < allTotal) {
      parts.push('<strong>' + total + '</strong> résultat' + (total > 1 ? 's' : '') + ' sur ' + allTotal);
    } else {
      parts.push('<strong>' + total + '</strong> push' + (total > 1 ? 's' : ''));
    }
    if (todayCount > 0) {
      parts.push('<span class="push-hist-today-badge">' + todayCount + ' aujourd\'hui</span>');
    }
    stats.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  // ─── Modal helpers ────────────────────────────────────────
  function modalByKey(key) {
    return document.querySelector('.v30-modal-bd[data-v30-modal="' + key + '"]');
  }
  function openModal(bd) {
    if (!bd) return;
    bd.hidden = false;
    void bd.offsetWidth;
    bd.classList.add('is-open');
  }
  function closeModal(bd) {
    if (!bd) return;
    bd.classList.remove('is-open');
    setTimeout(function () { bd.hidden = true; }, 160);
  }
  function closeTopmostModal() {
    var opens = document.querySelectorAll('.v30-modal-bd.is-open');
    if (!opens.length) return false;
    closeModal(opens[opens.length - 1]);
    return true;
  }
  function bindModalCloseAndEsc() {
    document.addEventListener('click', function (e) {
      var closer = e.target.closest('[data-v30-modal-close]');
      if (closer) {
        var bd = closer.closest('.v30-modal-bd');
        if (bd) closeModal(bd);
        return;
      }
      if (e.target.classList && e.target.classList.contains('v30-modal-bd') && e.target.classList.contains('is-open')) {
        closeModal(e.target);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeTopmostModal();
    });
  }

  // ─── Tabs ─────────────────────────────────────────────────
  function bindTabs() {
    var host = document.querySelector('[data-v30-push-tabs]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      host.querySelectorAll('button[data-tab]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-push-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30PushPanel !== key);
      });
      if (key === 'historique' && !STATE.historiqueLoaded) {
        reloadPushLogs();
        STATE.historiqueLoaded = true;
      }
    });
  }

  // ─── Descriptions catégories ──────────────────────────────
  var CAT_DESCRIPTIONS = {
    'Automatisme_Informatique_Industrielle': "Conception, programmation et mise en service de systèmes automatisés de production — automates (PLC/API), SCADA/supervision, réseaux industriels (Modbus, Profibus, EtherNet/IP, OPC-UA). Managers cibles : Responsable Automatisme, Directeur de Production.",
    'Cybersécurité': "Protection des systèmes IT/OT : audit, politiques de sécurité (firewall, IAM, SOC), détection d'incidents (SIEM/XDR), conformité (NIS2, ISO 27001, ANSSI). Managers cibles : RSSI, DSI.",
    'Data_IA': "Data Engineer, Data Scientist, Développeur IA — pipelines ETL, modèles ML/DL, mise en production. Maintenance prédictive, analyse de données biologiques. Managers : CDO, Directeur R&D.",
    'DevOps': "Pont dev/ops : pipelines CI/CD, Terraform, Ansible, Docker, Kubernetes, DevSecOps. Essentiel pour logiciels embarqués et plateformes IoT industrielles. Managers : Responsable Infrastructure, DSI.",
    'Electronique_Système': "Conception cartes électroniques (PCB), FPGA/VHDL, électronique analogique/numérique, validation hardware. Ferroviaire, automobile embarqué, instrumentation médicale.",
    'Gestion_de_Projet': "Pilotage de projets techniques — planification, ressources, coûts, délais. PMI/PMP, Prince2, Agile industriel. Profil transversal valorisé sur projets pluriannuels.",
    'Ingenierie_Mecanique_CAO': "Conception CAO (CATIA, SolidWorks, NX, Creo) + calcul de structures (éléments finis). Poids lourds, matériel ferroviaire, instrumentation médicale.",
    'Logiciels': "Applications logicielles industrielles : C/C++, .NET/Java, architecture logicielle, embarqué. Clients développant supervision, pilotage, analyse en interne.",
    'Systèmes Embarqués & Traitement du Signal': "Bare metal, RTOS (FreeRTOS, VxWorks, Linux embarqué), DSP, FFT, BSP/Firmware. Cœur de métier Up Technologie : ferroviaire, ECU/BCM automobile, capteurs biologiques.",
    'Systèmes_Réseaux': "Infrastructure IT/OT : serveurs, LAN/WAN, virtualisation (VMware, Hyper-V), SAN/NAS, supervision multi-sites. Managers : Responsable Infrastructure IT, DSI.",
    'Test_Qualite_Logicielle': "Plans de test (unitaires, intégration, validation), frameworks automatisés (Robot Framework, Selenium, pytest), normes ISO 26262, EN 50128, IEC 62304.",
    'Simulation_Modélisation': "Modèles de simulation numérique : Matlab/Simulink, ANSYS, Altair, Model-Based Design. R&D embarquée, ferroviaire, automobile.",
    'Electrotechnique_Energie': "Électronique de puissance, variateurs, motorisation, HTA/HTB, énergies renouvelables, stockage. Producteurs/distributeurs d'énergie, traction électrique.",
    'Surete_Fonctionnement_SdF': "Sûreté de fonctionnement (RAMS) : FMECA, HAZOP, FTA, normes IEC 61508, IEC 61511, EN 50129. Nucléaire, ferroviaire, industriel certifié."
  };

  // ─── Topbar + category editor ─────────────────────────────
  function bindTopbar() {
    var bNew  = document.querySelector('[data-v30-btn-new-cat]');
    var bScan = document.querySelector('[data-v30-btn-scan]');
    var bTpl  = document.querySelector('[data-v30-btn-manage-templates]');
    if (bNew)  bNew.addEventListener('click', function () { resetCatEditor(); showCatEditor(true); });
    if (bScan) bScan.addEventListener('click', scanPushs);
    if (bTpl)  bTpl.addEventListener('click', openTemplateManager);
  }
  function bindCatEditor() {
    var bSave   = document.querySelector('[data-v30-cat-save]');
    var bCancel = document.querySelector('[data-v30-cat-cancel]');
    if (bSave)   bSave.addEventListener('click', saveCat);
    if (bCancel) bCancel.addEventListener('click', function () { showCatEditor(false); resetCatEditor(); });
  }
  function showCatEditor(show) {
    var el = document.querySelector('[data-v30-cat-editor]');
    if (!el) return;
    el.hidden = !show;
    if (show) {
      try { window.scrollTo({ top: el.offsetTop - 20, behavior: 'smooth' }); } catch (_) {}
      var n = document.querySelector('[data-v30-cat-name]');
      if (n) try { n.focus(); } catch (_) {}
    }
  }
  function resetCatEditor() {
    var t = document.querySelector('[data-v30-cat-editor-title]');
    var id = document.querySelector('[data-v30-cat-id]');
    var n = document.querySelector('[data-v30-cat-name]');
    var k = document.querySelector('[data-v30-cat-keywords]');
    var nc = document.querySelector('[data-v30-cat-no-candidates]');
    if (t) t.textContent = 'Nouvelle catégorie';
    if (id) id.value = '';
    if (n) n.value = '';
    if (k) k.value = '';
    if (nc) nc.checked = false;
  }

  // ─── Catégories : load + render ───────────────────────────
  function loadCategories() {
    return fetchJSON('/api/push-categories').then(function (rows) {
      STATE.categories = Array.isArray(rows) ? rows.map(function (r) {
        r.keywords = parseKeywords(r.keywords);
        return r;
      }) : [];
      renderCategories();
    }).catch(function (err) {
      console.error('[v30 push] loadCategories:', err);
      STATE.categories = [];
      renderCategories();
    });
  }
  function renderCategories() {
    var grid = document.querySelector('[data-v30-cat-grid]');
    var empty = document.querySelector('[data-v30-cat-empty]');
    if (!grid) return;
    if (!STATE.categories.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = STATE.categories.map(catCardHtml).join('');
    STATE.categories.forEach(function (cat) { loadCatFiles(cat.id); });
  }
  function catCardHtml(cat) {
    var noCand = !!cat.no_candidates;
    var nCand = (cat.candidate1_id ? 1 : 0) + (cat.candidate2_id ? 1 : 0);
    var candText = noCand ? 'Sans candidat'
                 : nCand === 0 ? 'Aucun candidat'
                 : nCand === 1 ? '1 candidat sélectionné'
                 : '2 candidats sélectionnés';
    var candBadgeCls = noCand ? 'has' : (nCand > 0 ? 'has' : 'none');
    var desc = CAT_DESCRIPTIONS[cat.name] || '';
    var shortDesc = desc ? (desc.length > 180 ? desc.slice(0, 180) + '…' : desc) : '';
    return '<div class="v30-cat-card" data-cat-open="' + cat.id + '" role="button" tabindex="0" aria-label="Ouvrir la catégorie ' + esc(cat.name) + '">' +
      (shortDesc ? '<div class="v30-cat-tooltip">' + esc(shortDesc) + '</div>' : '') +
      '<div class="v30-cat-card__title">' + esc(cat.name) +
        (cat.auto_detected ? ' <span class="v30-cat-card__auto">auto</span>' : '') +
      '</div>' +
      '<div class="v30-cat-card__badges">' +
        '<span class="v30-cat-badge ' + candBadgeCls + '" id="v30CatCandBadge_' + cat.id + '">' +
          ic('userSingle', 12) + ' ' + esc(candText) +
        '</span>' +
        '<span class="v30-cat-badge loading" id="v30CatTplBadge_' + cat.id + '">' +
          ic('mail', 12) + ' …' +
        '</span>' +
      '</div>' +
    '</div>';
  }
  function bindCatGridClicks() {
    document.addEventListener('click', function (e) {
      var card = e.target.closest('[data-cat-open]');
      if (!card) return;
      var id = Number(card.dataset.catOpen);
      if (id) openCatDetail(id);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest && e.target.closest('[data-cat-open]');
      if (!card) return;
      e.preventDefault();
      openCatDetail(Number(card.dataset.catOpen));
    });
  }

  // ─── Cat files (.msg templates) ───────────────────────────
  function loadCatFiles(catId) {
    return fetchJSON('/api/push-categories/' + catId + '/files').then(function (data) {
      STATE.catFiles[catId] = (data && data.ok && Array.isArray(data.files)) ? data.files : [];
    }).catch(function () {
      STATE.catFiles[catId] = [];
    }).then(function () {
      updateCatTplBadge(catId);
      renderModalCatFiles(catId);
    });
  }
  function updateCatTplBadge(catId) {
    var badge = document.getElementById('v30CatTplBadge_' + catId);
    if (!badge) return;
    var files = STATE.catFiles[catId] || [];
    var n = files.length;
    badge.className = 'v30-cat-badge ' + (n > 0 ? 'has' : 'none');
    badge.innerHTML = ic('mail', 12) + ' ' + (n === 0 ? 'Aucun template' : (n + ' template' + (n > 1 ? 's' : '')));
  }
  function updateCatCandBadge(catId) {
    var cat = findCat(catId);
    if (!cat) return;
    var badge = document.getElementById('v30CatCandBadge_' + catId);
    if (!badge) return;
    if (cat.no_candidates) {
      badge.className = 'v30-cat-badge has';
      badge.innerHTML = ic('userSingle', 12) + ' Sans candidat';
      return;
    }
    var n = (cat.candidate1_id ? 1 : 0) + (cat.candidate2_id ? 1 : 0);
    var text = n === 0 ? 'Aucun candidat' : n === 1 ? '1 candidat sélectionné' : '2 candidats sélectionnés';
    badge.className = 'v30-cat-badge ' + (n > 0 ? 'has' : 'none');
    badge.innerHTML = ic('userSingle', 12) + ' ' + esc(text);
  }
  function renderModalCatFiles(catId) {
    var box = document.getElementById('v30CatFiles_' + catId);
    if (!box) return;
    var files = STATE.catFiles[catId];
    if (files === undefined) { box.innerHTML = '<span class="muted">Chargement…</span>'; return; }
    if (!files.length) {
      box.innerHTML = '<span class="muted" style="font-size:12px;">Aucun template — cliquez « Ajouter » pour en importer un.</span>';
      return;
    }
    box.innerHTML = files.map(function (f) {
      var sizeKo = (f.size / 1024).toFixed(0);
      return '<div class="v30-cat-file">' +
        '<span class="v30-cat-file__name" title="' + esc(f.name) + '">' +
          ic('file', 13) + ' ' + esc(f.name) +
          '<span class="v30-cat-file__size">' + sizeKo + ' Ko</span>' +
        '</span>' +
        '<div class="v30-cat-file__actions">' +
          '<a href="' + esc(f.url) + '" download="' + esc(f.name) + '" title="Télécharger" aria-label="Télécharger ' + esc(f.name) + '">' + ic('download', 13) + '</a>' +
          '<label title="Remplacer" aria-label="Remplacer ' + esc(f.name) + '">' +
            ic('refreshCw', 13) +
            '<input type="file" accept=".msg,.eml,.oft" style="display:none;" data-v30-replace-file="' + catId + '" data-v30-replace-name="' + esc(f.name) + '">' +
          '</label>' +
          '<button type="button" class="danger" data-v30-delete-file="' + catId + '" data-v30-delete-name="' + esc(f.name) + '" title="Supprimer" aria-label="Supprimer ' + esc(f.name) + '">' + ic('trash', 13) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  function uploadCatTemplate(catId, fileObj, isReplace) {
    if (!fileObj) return;
    var formData = new FormData();
    formData.append('file', fileObj);
    toast(isReplace ? 'Remplacement en cours…' : 'Upload en cours…', 'info');
    fetch('/api/push-categories/' + catId + '/upload-template', {
      method: 'POST', credentials: 'same-origin', body: formData
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok) {
          toast(isReplace ? 'Template remplacé !' : 'Template ajouté !', 'success');
          loadCatFiles(catId);
        } else {
          toast((data && data.error) || 'Erreur upload', 'error');
        }
      })
      .catch(function (e) { toast('Erreur réseau : ' + e.message, 'error'); });
  }
  function deleteCatFile(catId, filename) {
    if (!confirm('Supprimer le template « ' + filename + ' » ?')) return;
    postJSON('/api/push-categories/' + catId + '/delete-template', { filename: filename })
      .then(function (data) {
        if (data && data.ok) {
          toast('Template supprimé', 'success');
          loadCatFiles(catId);
        } else {
          toast((data && data.error) || 'Erreur', 'error');
        }
      })
      .catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }

  // ─── Candidate slots (dans cat-detail) ────────────────────
  function loadAllCandidatesCache() {
    if (STATE.allCandidates) return Promise.resolve();
    return fetchJSON('/api/candidates').then(function (data) {
      var arr = Array.isArray(data) ? data : (data && data.candidates) || [];
      STATE.allCandidates = arr.filter(function (c) { return !c.is_archived; })
        .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    }).catch(function () { STATE.allCandidates = []; });
  }
  function findCat(id) {
    for (var i = 0; i < STATE.categories.length; i++) {
      if (STATE.categories[i].id === id) return STATE.categories[i];
    }
    return null;
  }
  function candSlotHtml(cat, slot) {
    var cid = cat['candidate' + slot + '_id'];
    var name = cat['candidate' + slot + '_name'];
    var role = cat['candidate' + slot + '_role'];
    var value = cid
      ? esc(name || '') + (role ? ' <span class="v30-cand-slot__role">· ' + esc(role) + '</span>' : '')
      : '<span class="muted">Non défini</span>';
    var clearBtn = cid
      ? '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cand-clear="' + cat.id + ':' + slot + '" title="Effacer" aria-label="Effacer le candidat ' + slot + '">' + ic('x', 11) + '</button>'
      : '';
    return '<div class="v30-cand-slot" data-v30-cand-slot="' + cat.id + ':' + slot + '">' +
      '<span class="v30-cand-slot__label">Candidat ' + slot + ' :</span>' +
      '<span class="v30-cand-slot__value">' + value + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cand-edit="' + cat.id + ':' + slot + '" title="Modifier" aria-label="Modifier le candidat ' + slot + '">' + ic('edit', 11) + '</button>' +
      clearBtn +
    '</div>';
  }
  function saveCatCandidates(catId, c1Id, c2Id) {
    return postJSON('/api/push-categories/' + catId + '/set-candidates', {
      candidate1_id: c1Id || null, candidate2_id: c2Id || null
    });
  }
  function autoSuggestCandidates(catId) {
    toast('Recherche des meilleurs candidats…', 'info', 2000);
    fetchJSON('/api/push-categories/' + catId + '/match-candidates').then(function (data) {
      if (!data || !data.ok) { toast((data && data.error) || 'Erreur', 'error'); return; }
      var top2 = (data.candidates || []).slice(0, 2);
      return saveCatCandidates(catId, top2[0] && top2[0].id, top2[1] && top2[1].id).then(function () {
        var cat = findCat(catId);
        if (cat) {
          cat.candidate1_id   = (top2[0] && top2[0].id) || null;
          cat.candidate1_name = (top2[0] && top2[0].name) || null;
          cat.candidate1_role = (top2[0] && top2[0].role) || null;
          cat.candidate2_id   = (top2[1] && top2[1].id) || null;
          cat.candidate2_name = (top2[1] && top2[1].name) || null;
          cat.candidate2_role = (top2[1] && top2[1].role) || null;
          var box = document.getElementById('v30CatSlots_' + catId);
          if (box) box.innerHTML = candSlotHtml(cat, 1) + candSlotHtml(cat, 2);
          updateCatCandBadge(catId);
        }
        if (top2.length === 0) toast('Aucun candidat trouvé pour ces mots-clés', 'warning');
        else toast(top2.length + ' candidat(s) suggéré(s)', 'success');
      });
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }
  function editCatCandidate(catId, slot) {
    loadAllCandidatesCache().then(function () {
      var cat = findCat(catId);
      var currentId = (cat && cat['candidate' + slot + '_id']) || '';
      var otherSlot = slot === 1 ? 2 : 1;
      var otherId = (cat && cat['candidate' + otherSlot + '_id']) || null;
      var slotEl = document.querySelector('[data-v30-cand-slot="' + catId + ':' + slot + '"]');
      if (!slotEl) return;
      var options = (STATE.allCandidates || []).map(function (c) {
        return '<option value="' + c.id + '"' + (String(c.id) === String(currentId) ? ' selected' : '') + '>' +
          esc(c.name || '') + (c.role ? ' · ' + esc(c.role) : '') + '</option>';
      }).join('');
      slotEl.outerHTML =
        '<div class="v30-cand-slot" data-v30-cand-slot="' + catId + ':' + slot + '">' +
          '<span class="v30-cand-slot__label">Candidat ' + slot + ' :</span>' +
          '<select class="v30-input" data-v30-cand-select="' + catId + ':' + slot + '" style="flex:1;min-width:0;">' +
            '<option value="">— Aucun —</option>' + options +
          '</select>' +
          '<button type="button" class="btn btn-accent btn-sm btn-icon" data-v30-cand-confirm="' + catId + ':' + slot + ':' + (otherId || '') + '" title="Valider">' + ic('check', 12) + '</button>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-cand-cancel="' + catId + ':' + slot + '" title="Annuler">' + ic('x', 12) + '</button>' +
        '</div>';
    });
  }
  function confirmCatCandidate(catId, slot, otherId) {
    var sel = document.querySelector('[data-v30-cand-select="' + catId + ':' + slot + '"]');
    var newId = (sel && sel.value) ? Number(sel.value) : null;
    var c1 = slot === 1 ? newId : otherId;
    var c2 = slot === 2 ? newId : otherId;
    saveCatCandidates(catId, c1, c2).then(function () {
      var cat = findCat(catId);
      var picked = newId ? (STATE.allCandidates || []).filter(function (c) { return c.id === newId; })[0] : null;
      if (cat) {
        cat['candidate' + slot + '_id']   = newId;
        cat['candidate' + slot + '_name'] = (picked && picked.name) || null;
        cat['candidate' + slot + '_role'] = (picked && picked.role) || null;
        var box = document.getElementById('v30CatSlots_' + catId);
        if (box) box.innerHTML = candSlotHtml(cat, 1) + candSlotHtml(cat, 2);
        updateCatCandBadge(catId);
      }
      toast('Candidat enregistré', 'success', 2000);
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }
  function cancelEditCatCandidate(catId) {
    var cat = findCat(catId);
    if (!cat) return;
    var box = document.getElementById('v30CatSlots_' + catId);
    if (box) box.innerHTML = candSlotHtml(cat, 1) + candSlotHtml(cat, 2);
  }
  function clearCatCandidate(catId, slot) {
    var cat = findCat(catId);
    var c1 = slot === 1 ? null : ((cat && cat.candidate1_id) || null);
    var c2 = slot === 2 ? null : ((cat && cat.candidate2_id) || null);
    saveCatCandidates(catId, c1, c2).then(function () {
      if (cat) {
        cat['candidate' + slot + '_id']   = null;
        cat['candidate' + slot + '_name'] = null;
        cat['candidate' + slot + '_role'] = null;
        var box = document.getElementById('v30CatSlots_' + catId);
        if (box) box.innerHTML = candSlotHtml(cat, 1) + candSlotHtml(cat, 2);
        updateCatCandBadge(catId);
      }
      toast('Candidat effacé', 'info', 2000);
    });
  }

  // ─── Cat detail modal ─────────────────────────────────────
  function openCatDetail(catId) {
    STATE.openCatDetailId = catId;
    var cat = findCat(catId);
    if (!cat) return;
    var bd = modalByKey('cat-detail');
    if (!bd) return;
    var titleSpan = bd.querySelector('[data-v30-cat-detail-title]');
    if (titleSpan) titleSpan.textContent = cat.name;
    var body = bd.querySelector('[data-v30-cat-detail-body]');
    var desc = CAT_DESCRIPTIONS[cat.name] || '';
    var kw = Array.isArray(cat.keywords) ? cat.keywords : [];
    var kwHtml = kw.length
      ? kw.map(function (k) { return '<span class="v30-kw-pill">' + esc(k) + '</span>'; }).join(' ')
      : '<span class="muted">Aucun mot-clé</span>';
    var noCand = !!cat.no_candidates;
    var candSection = noCand
      ? '<div class="v30-cat-detail__section">' +
          '<div class="v30-cat-detail__eyebrow">' +
            '<span class="v30-cat-detail__label">' + ic('userSingle', 12) + ' Candidats par défaut</span>' +
          '</div>' +
          '<div class="muted" style="font-size:12px; padding:6px 0;">Catégorie « sans consultant » — aucun candidat ni dossier de compétence ne sera attaché lors du push.</div>' +
        '</div>'
      : '<div class="v30-cat-detail__section">' +
          '<div class="v30-cat-detail__eyebrow">' +
            '<span class="v30-cat-detail__label">' + ic('userSingle', 12) + ' Candidats par défaut</span>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-v30-cand-auto="' + cat.id + '" title="Suggérer automatiquement">' + ic('refreshCw', 11) + ' Auto</button>' +
          '</div>' +
          '<div id="v30CatSlots_' + cat.id + '">' +
            candSlotHtml(cat, 1) + candSlotHtml(cat, 2) +
          '</div>' +
        '</div>';
    body.innerHTML =
      (desc ? '<p class="v30-cat-detail__desc">' + esc(desc) + '</p>' : '') +
      '<div class="v30-cat-detail__section">' +
        '<div class="v30-cat-detail__eyebrow">' +
          '<span class="v30-cat-detail__label">Mots-clés</span>' +
        '</div>' +
        '<div class="v30-cat-detail__kw">' + kwHtml + '</div>' +
      '</div>' +
      candSection +
      '<div class="v30-cat-detail__section">' +
        '<div class="v30-cat-detail__eyebrow">' +
          '<span class="v30-cat-detail__label">' + ic('mail', 12) + ' Templates email (.msg)</span>' +
          '<label class="btn btn-ghost btn-sm" style="cursor:pointer;" title="Ajouter un template .msg">' +
            ic('plus', 12) + ' Ajouter' +
            '<input type="file" accept=".msg,.eml,.oft" style="display:none;" data-v30-upload-file="' + cat.id + '">' +
          '</label>' +
        '</div>' +
        '<div class="v30-cat-files" id="v30CatFiles_' + cat.id + '"><span class="muted">Chargement…</span></div>' +
      '</div>';
    // Wire footer buttons
    var bProspects = bd.querySelector('[data-v30-cat-detail-prospects]');
    var bEdit      = bd.querySelector('[data-v30-cat-detail-edit]');
    var bDelete    = bd.querySelector('[data-v30-cat-detail-delete]');
    if (bProspects) bProspects.onclick = function () { closeModal(bd); openCatProspects(cat.id); };
    if (bEdit)      bEdit.onclick      = function () { closeModal(bd); editCat(cat.id); };
    if (bDelete)    bDelete.onclick    = function () { deleteCat(cat.id); };
    openModal(bd);
    loadCatFiles(cat.id);
  }
  function bindCatDetailDelegation() {
    var bd = modalByKey('cat-detail');
    if (!bd) return;
    bd.addEventListener('click', function (e) {
      var auto = e.target.closest('[data-v30-cand-auto]');
      if (auto) { autoSuggestCandidates(Number(auto.dataset.v30CandAuto)); return; }
      var edit = e.target.closest('[data-v30-cand-edit]');
      if (edit) {
        var p = edit.dataset.v30CandEdit.split(':');
        editCatCandidate(Number(p[0]), Number(p[1])); return;
      }
      var clr = e.target.closest('[data-v30-cand-clear]');
      if (clr) {
        var pc = clr.dataset.v30CandClear.split(':');
        clearCatCandidate(Number(pc[0]), Number(pc[1])); return;
      }
      var conf = e.target.closest('[data-v30-cand-confirm]');
      if (conf) {
        var pf = conf.dataset.v30CandConfirm.split(':');
        var other = pf[2] ? Number(pf[2]) : null;
        confirmCatCandidate(Number(pf[0]), Number(pf[1]), other); return;
      }
      var cancel = e.target.closest('[data-v30-cand-cancel]');
      if (cancel) {
        var pk = cancel.dataset.v30CandCancel.split(':');
        cancelEditCatCandidate(Number(pk[0])); return;
      }
      var delFile = e.target.closest('[data-v30-delete-file]');
      if (delFile) {
        deleteCatFile(Number(delFile.dataset.v30DeleteFile), delFile.dataset.v30DeleteName);
        return;
      }
    });
    bd.addEventListener('change', function (e) {
      var up = e.target.closest('[data-v30-upload-file]');
      if (up && up.files && up.files[0]) {
        uploadCatTemplate(Number(up.dataset.v30UploadFile), up.files[0], false);
        up.value = '';
        return;
      }
      var rep = e.target.closest('[data-v30-replace-file]');
      if (rep && rep.files && rep.files[0]) {
        var oldName = rep.dataset.v30ReplaceName;
        var file = rep.files[0];
        var renamed = new File([file], oldName, { type: file.type });
        uploadCatTemplate(Number(rep.dataset.v30ReplaceFile), renamed, true);
        rep.value = '';
        return;
      }
    });
  }

  // ─── Cat CRUD ─────────────────────────────────────────────
  function saveCat() {
    var nameEl = document.querySelector('[data-v30-cat-name]');
    var kwEl   = document.querySelector('[data-v30-cat-keywords]');
    var idEl   = document.querySelector('[data-v30-cat-id]');
    var ncEl   = document.querySelector('[data-v30-cat-no-candidates]');
    var name = (nameEl && nameEl.value || '').trim();
    if (!name) { toast('Nom requis', 'warning'); return; }
    var keywords = (kwEl && kwEl.value || '').split(',')
      .map(function (k) { return k.trim().toLowerCase(); })
      .filter(Boolean);
    var payload = {
      id: (idEl && idEl.value) ? Number(idEl.value) : null,
      name: name,
      keywords: keywords,
      no_candidates: !!(ncEl && ncEl.checked)
    };
    postJSON('/api/push-categories/save', payload).then(function (data) {
      if (data && data.ok === false) { toast(data.error || 'Erreur', 'error'); return; }
      showCatEditor(false);
      resetCatEditor();
      toast('Catégorie enregistrée', 'success');
      loadCategories();
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }
  function editCat(id) {
    var cat = findCat(id);
    if (!cat) return;
    var t = document.querySelector('[data-v30-cat-editor-title]');
    var idEl = document.querySelector('[data-v30-cat-id]');
    var n = document.querySelector('[data-v30-cat-name]');
    var k = document.querySelector('[data-v30-cat-keywords]');
    var nc = document.querySelector('[data-v30-cat-no-candidates]');
    if (t) t.textContent = 'Modifier : ' + cat.name;
    if (idEl) idEl.value = cat.id;
    if (n) n.value = cat.name;
    if (k) k.value = (Array.isArray(cat.keywords) ? cat.keywords : []).join(', ');
    if (nc) nc.checked = !!cat.no_candidates;
    showCatEditor(true);
  }
  function deleteCat(id) {
    var cat = findCat(id);
    if (!confirm('Supprimer « ' + ((cat && cat.name) || id) + ' » ?')) return;
    postJSON('/api/push-categories/delete', { id: id }).then(function (data) {
      if (data && data.ok === false) { toast(data.error || 'Erreur', 'error'); return; }
      var bd = modalByKey('cat-detail');
      if (bd) closeModal(bd);
      toast('Catégorie supprimée', 'success');
      loadCategories();
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }
  function scanPushs() {
    var btn = document.querySelector('[data-v30-btn-scan]');
    if (btn) btn.disabled = true;
    postJSON('/api/push-categories/scan').then(function (data) {
      if (data && data.ok) {
        var folders = (data.found || []).join(', ') || 'aucun';
        toast('Scan terminé — Dossiers : ' + folders + ' · Nouvelles : ' + (data.created || 0), 'success', 5000);
      } else {
        toast((data && data.error) || 'Erreur', 'error');
      }
      loadCategories();
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  // ─── Prospects suggérés ───────────────────────────────────
  function openCatProspects(catId) {
    STATE.catProspectsId = catId;
    var bd = modalByKey('cat-prospects');
    if (!bd) return;
    var cat = findCat(catId);
    var titleSpan = bd.querySelector('[data-v30-cat-prospects-title]');
    if (titleSpan) titleSpan.textContent = 'Prospects suggérés — ' + ((cat && cat.name) || '');
    var info = bd.querySelector('[data-v30-cat-prospects-info]');
    var list = bd.querySelector('[data-v30-cat-prospects-list]');
    if (info) info.innerHTML = '';
    if (list) list.innerHTML = '<div class="muted" style="padding:20px;text-align:center;">Chargement…</div>';
    var bRef = bd.querySelector('[data-v30-cat-prospects-refresh]');
    if (bRef) bRef.onclick = function () { fetchAndRenderCatProspects(catId); };
    openModal(bd);
    fetchAndRenderCatProspects(catId);
  }
  function fetchAndRenderCatProspects(catId) {
    var bd = modalByKey('cat-prospects');
    var list = bd && bd.querySelector('[data-v30-cat-prospects-list]');
    var info = bd && bd.querySelector('[data-v30-cat-prospects-info]');
    fetchJSON('/api/push-categories/' + catId + '/match-prospects').then(function (data) {
      if (!data || !data.ok) {
        if (list) list.innerHTML = '<div class="muted" style="color:var(--danger);padding:12px;">' + esc((data && data.error) || 'Erreur') + '</div>';
        return;
      }
      if (info) {
        var kwPills = (data.keywords || []).map(function (k) { return '<span class="v30-kw-pill">' + esc(k) + '</span>'; }).join(' ');
        info.innerHTML = 'Mots-clés : ' + (kwPills || '<span class="muted">—</span>') + ' &nbsp;·&nbsp; ' +
          (data.total_scored || 0) + ' prospect(s) avec correspondance sur ' + (data.total_available || 0) + ' éligibles';
      }
      var prospects = data.prospects || [];
      if (!prospects.length) {
        if (list) list.innerHTML = '<div class="muted" style="text-align:center;padding:30px;">Aucun prospect éligible (email sans téléphone, jamais pushé).</div>';
        return;
      }
      if (list) list.innerHTML = prospects.map(function (p) {
        var tagPills = (p.tags || []).map(function (t) { return '<span class="v30-kw-pill">' + esc(t) + '</span>'; }).join(' ');
        var matchedPills = (p.matched_keywords || []).map(function (k) { return '<span class="v30-kw-pill matched">' + esc(k) + '</span>'; }).join(' ');
        var score = p.score > 0 ? '<span class="v30-sg-prospect__score">▲' + p.score + ' pts</span>' : '';
        var metaParts = [];
        if (p.email) metaParts.push(esc(p.email));
        if (p.fonction) metaParts.push(esc(p.fonction));
        if (p.company) metaParts.push(esc(p.company));
        return '<div class="v30-sg-prospect">' +
          '<div class="v30-sg-prospect__head">' +
            '<div class="v30-sg-prospect__name">' + esc(p.name) + score + '</div>' +
            '<div class="v30-sg-prospect__actions">' +
              '<a href="/v30/prospect/' + p.id + '" class="btn btn-ghost btn-sm" title="Voir la fiche">' + ic('eye', 11) + ' Fiche</a>' +
              '<a href="mailto:' + (p.email ? encodeURIComponent(p.email) : '') + '" class="btn btn-ghost btn-sm" title="Email" data-v30-sg-mail="' + (p.email ? '1' : '0') + '">' + ic('mail', 11) + ' Email</a>' +
            '</div>' +
          '</div>' +
          '<div class="v30-sg-prospect__meta">' + metaParts.join(' · ') + '</div>' +
          (tagPills ? '<div class="v30-sg-prospect__pills">' + tagPills + '</div>' : '') +
          (matchedPills ? '<div class="v30-sg-prospect__pills">' + matchedPills + '</div>' : '') +
        '</div>';
      }).join('');
      // Email sans adresse : intercepte et toast warning
      if (list) {
        list.querySelectorAll('[data-v30-sg-mail="0"]').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            toast('Email introuvable pour ce prospect.', 'warning');
          });
        });
      }
    }).catch(function (e) {
      if (list) list.innerHTML = '<div class="muted" style="color:var(--danger);padding:12px;">Erreur réseau : ' + esc(e.message) + '</div>';
    });
  }

  // ─── Historique (push_logs) ───────────────────────────────
  function bindHistoryFilters() {
    var q  = document.querySelector('[data-v30-push-search]');
    var ch = document.querySelector('[data-v30-push-channel]');
    var rb = document.querySelector('[data-v30-push-reload]');
    if (q)  q.addEventListener('input', applyPushFilters);
    if (ch) ch.addEventListener('change', applyPushFilters);
    if (rb) rb.addEventListener('click', function () { reloadPushLogs(); });
    var tbody = document.querySelector('[data-v30-push-table]');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var eye = e.target.closest('[data-v30-push-view]');
        if (eye) { openPushDetail(Number(eye.dataset.v30PushView)); return; }
        var del = e.target.closest('[data-v30-push-delete]');
        if (del) { deletePushLog(Number(del.dataset.v30PushDelete)); return; }
        if (e.target.closest('a') || e.target.closest('button')) return;
        var row = e.target.closest('[data-push-row-id]');
        if (row) openPushDetail(Number(row.dataset.pushRowId));
      });
    }
  }
  function reloadPushLogs() {
    return fetchJSON('/api/push-logs').then(function (data) {
      STATE.pushLogs = Array.isArray(data) ? data : [];
      applyPushFilters();
    }).catch(function (err) {
      console.error('[v30 push] push-logs:', err);
      STATE.pushLogs = [];
      applyPushFilters();
      toast("Impossible de charger l'historique des push : " + err.message, 'error');
    });
  }
  function applyPushFilters() {
    var qEl  = document.querySelector('[data-v30-push-search]');
    var chEl = document.querySelector('[data-v30-push-channel]');
    var q  = (qEl && qEl.value || '').trim().toLowerCase();
    var ch = (chEl && chEl.value || '').trim().toLowerCase();
    STATE.pushFiltered = STATE.pushLogs.filter(function (l) {
      var hay = [
        l.prospect_name, l.company_groupe, l.company_site, l.prospect_email, l.to_email,
        l.subject, l.channel, l.consultant1_name, l.consultant2_name
      ].map(safeStr).join(' ').toLowerCase();
      var okQ = !q || hay.indexOf(q) !== -1;
      var okC = !ch || safeStr(l.channel).toLowerCase() === ch;
      return okQ && okC;
    });
    renderPushTable();
  }
  function renderPushTable() {
    var tbody = document.querySelector('[data-v30-push-table]');
    var empty = document.querySelector('[data-v30-push-empty]');
    if (!tbody) return;
    updatePushStats();
    if (!STATE.pushLogs.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty" style="padding:30px;">Aucun push enregistré pour le moment.</td></tr>';
      if (empty) empty.hidden = true;
      return;
    }
    if (!STATE.pushFiltered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty" style="padding:30px;">Aucun résultat pour ces filtres.</td></tr>';
      if (empty) empty.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    tbody.innerHTML = STATE.pushFiltered.map(function (l) {
      var company = fmtCompany(l.company_groupe, l.company_site);
      var consultants = [l.consultant1_name, l.consultant2_name].filter(Boolean);
      var consultantsHtml = consultants.length
        ? consultants.map(function (c) {
            var label = c.split(' ')[0];
            return '<span class="push-consultant-chip" title="' + esc(c) + '">' + esc(label) + '</span>';
          }).join('')
        : '<span class="muted">—</span>';
      var mailAddr = l.to_email || l.prospect_email || '';
      var prospectHtml = l.prospect_id
        ? '<a href="/v30/prospect/' + l.prospect_id + '" class="push-prospect-link" title="' + esc(l.prospect_name || '') + '">' + esc(l.prospect_name || '—') + '</a>'
        : '<span class="table-cell-clamp" title="' + esc(l.prospect_name || '') + '">' + esc(l.prospect_name || '—') + '</span>';
      var emailHtml = mailAddr
        ? '<a href="mailto:' + esc(mailAddr) + '" class="push-email-link table-cell-clamp" title="' + esc(mailAddr) + '">' + esc(mailAddr) + '</a>'
        : '<span class="muted">—</span>';
      return '<tr class="' + channelRowClass(l.channel) + '" data-push-row-id="' + l.id + '">' +
        '<td>' + renderDateCell(l.sentAt || l.createdAt) + '</td>' +
        '<td>' + prospectHtml + '</td>' +
        '<td><span class="table-cell-clamp" title="' + esc(company) + '">' + esc(company) + '</span></td>' +
        '<td>' + emailHtml + '</td>' +
        '<td><span class="table-cell-clamp" title="' + esc(l.subject || '') + '">' + esc(l.subject || '—') + '</span></td>' +
        '<td>' + consultantsHtml + '</td>' +
        '<td>' + pushChannelPill(l.channel) + '</td>' +
        '<td>' +
          '<button type="button" class="mini-action" data-v30-push-view="' + l.id + '" title="Voir le détail" aria-label="Voir le détail">' + ic('eye', 13) + '</button>' +
          '<button type="button" class="mini-action danger" data-v30-push-delete="' + l.id + '" title="Supprimer" aria-label="Supprimer">' + ic('trash', 13) + '</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }
  function openPushDetail(id) {
    var l = STATE.pushLogs.filter(function (x) { return x.id === id; })[0];
    if (!l) return;
    var bd = modalByKey('push-detail');
    if (!bd) return;
    var body = bd.querySelector('[data-v30-push-detail-body]');
    var company = fmtCompany(l.company_groupe, l.company_site);
    var consultants = [l.consultant1_name, l.consultant2_name].filter(Boolean).join(', ') || '—';
    var mailAddr = l.to_email || l.prospect_email || '';
    body.innerHTML =
      '<div class="v30-pd-info">' +
        '<div><strong>Date :</strong>' + esc(fmtDate(l.sentAt || l.createdAt)) + '</div>' +
        '<div><strong>Prospect :</strong>' + esc(l.prospect_name || '—') + '</div>' +
        '<div><strong>Entreprise :</strong>' + esc(company) + '</div>' +
        '<div><strong>Email :</strong>' + esc(mailAddr) + '</div>' +
        '<div><strong>Canal :</strong>' + pushChannelLabel(l.channel) + '</div>' +
        '<div><strong>Template :</strong>' + esc(l.template_name || '—') + '</div>' +
        '<div><strong>Consultant(s) :</strong>' + esc(consultants) + '</div>' +
      '</div>' +
      '<div class="v30-pd-block">' +
        '<div class="v30-pd-block__label">Sujet</div>' +
        '<div class="v30-pd-block__content">' + esc(l.subject || '—') + '</div>' +
      '</div>' +
      '<div class="v30-pd-block">' +
        '<div class="v30-pd-block__label">Contenu</div>' +
        '<div class="v30-pd-block__content"><pre>' + esc(l.body || '') + '</pre></div>' +
      '</div>';
    openModal(bd);
  }
  function deletePushLog(id) {
    var l = STATE.pushLogs.filter(function (x) { return x.id === id; })[0];
    var label = l ? (safeStr(l.prospect_name) + ' — ' + safeStr(l.sentAt || l.createdAt)) : ('ID ' + id);
    if (!confirm('Supprimer ce push ?\n\n' + label)) return;
    postJSON('/api/push-logs/delete', { id: id }).then(function (data) {
      if (data && data.ok === false) { toast('Impossible de supprimer : ' + (data.error || ''), 'error'); return; }
      toast('Push supprimé', 'success');
      reloadPushLogs();
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }

  // ─── Templates texte manager (modal D) ────────────────────
  function openTemplateManager() {
    var bd = modalByKey('tpl-manager');
    if (!bd) return;
    tplShowEditor(false);
    var list = bd.querySelector('[data-v30-tpl-list]');
    if (list) list.innerHTML = '<span class="muted" style="font-size:12px;">Chargement…</span>';
    openModal(bd);
    loadTemplates();
  }
  function loadTemplates() {
    return fetchJSON('/api/templates').then(function (data) {
      STATE.templates = Array.isArray(data) ? data : [];
      renderTemplateList();
    }).catch(function () {
      STATE.templates = [];
      renderTemplateList();
    });
  }
  function renderTemplateList() {
    var list = document.querySelector('[data-v30-tpl-list]');
    if (!list) return;
    if (!STATE.templates.length) {
      list.innerHTML = '<span class="muted" style="font-size:12px;">Aucun template. Créez-en un.</span>';
      return;
    }
    var currentId = document.getElementById('v30-tpl-id') ? document.getElementById('v30-tpl-id').value : '';
    list.innerHTML = STATE.templates.map(function (t) {
      var active = String(t.id) === String(currentId);
      var def = t.is_default ? '<span class="v30-tpl-item__default">défaut</span>' : '';
      return '<button type="button" class="v30-tpl-item' + (active ? ' is-active' : '') + '" data-v30-tpl-select="' + t.id + '">' +
        '<span class="v30-tpl-item__name">' + esc(t.name) + def + '</span>' +
        (t.subject ? '<span class="v30-tpl-item__subject">' + esc(t.subject) + '</span>' : '') +
      '</button>';
    }).join('');
  }
  function tplShowEditor(show) {
    var editor = document.querySelector('[data-v30-tpl-editor]');
    var empty = document.querySelector('[data-v30-tpl-editor-empty]');
    if (editor) editor.hidden = !show;
    if (empty) empty.hidden = show;
  }
  function selectTemplate(id) {
    var t = STATE.templates.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var setVal = function (sel, v) { var el = document.getElementById(sel); if (el) el.value = v || ''; };
    setVal('v30-tpl-id', t.id);
    setVal('v30-tpl-name', t.name);
    setVal('v30-tpl-subject', t.subject);
    setVal('v30-tpl-body', t.body);
    setVal('v30-tpl-li', t.linkedin_body);
    var def = document.getElementById('v30-tpl-default');
    if (def) def.checked = !!t.is_default;
    var delBtn = document.querySelector('[data-v30-tpl-delete]');
    if (delBtn) delBtn.hidden = false;
    tplShowEditor(true);
    renderTemplateList();
  }
  function newTemplate() {
    var setVal = function (sel, v) { var el = document.getElementById(sel); if (el) el.value = v || ''; };
    setVal('v30-tpl-id', '');
    setVal('v30-tpl-name', '');
    setVal('v30-tpl-subject', '');
    setVal('v30-tpl-body', '');
    setVal('v30-tpl-li', '');
    var def = document.getElementById('v30-tpl-default');
    if (def) def.checked = false;
    var delBtn = document.querySelector('[data-v30-tpl-delete]');
    if (delBtn) delBtn.hidden = true;
    tplShowEditor(true);
    renderTemplateList();
    var f = document.getElementById('v30-tpl-name');
    if (f) try { f.focus(); } catch (_) {}
  }
  function saveTemplate() {
    var val = function (id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; };
    var name = val('v30-tpl-name').trim();
    if (!name) { toast('Le nom du template est requis', 'warning'); return; }
    var idRaw = val('v30-tpl-id');
    var payload = {
      id: idRaw ? Number(idRaw) : null,
      name: name,
      subject: val('v30-tpl-subject'),
      body: val('v30-tpl-body'),
      linkedin_body: val('v30-tpl-li'),
      is_default: !!(document.getElementById('v30-tpl-default') && document.getElementById('v30-tpl-default').checked)
    };
    postJSON('/api/templates/save', payload).then(function (data) {
      if (!data || data.ok === false) { toast((data && data.error) || 'Erreur', 'error'); return; }
      if (data.id) {
        var idEl = document.getElementById('v30-tpl-id');
        if (idEl) idEl.value = data.id;
      }
      var delBtn = document.querySelector('[data-v30-tpl-delete]');
      if (delBtn) delBtn.hidden = false;
      toast('Template enregistré', 'success');
      loadTemplates();
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }
  function deleteTemplate() {
    var idEl = document.getElementById('v30-tpl-id');
    var id = idEl && idEl.value ? Number(idEl.value) : null;
    if (!id) return;
    var t = STATE.templates.filter(function (x) { return x.id === id; })[0];
    if (!confirm('Supprimer le template « ' + ((t && t.name) || id) + ' » ?')) return;
    postJSON('/api/templates/delete', { id: id }).then(function (data) {
      if (!data || data.ok === false) { toast((data && data.error) || 'Erreur', 'error'); return; }
      toast('Template supprimé', 'success');
      tplShowEditor(false);
      loadTemplates();
    }).catch(function (e) { toast('Erreur : ' + e.message, 'error'); });
  }
  function bindTemplateManagerStatic() {
    document.addEventListener('click', function (e) {
      var sel = e.target.closest('[data-v30-tpl-select]');
      if (sel) { selectTemplate(Number(sel.dataset.v30TplSelect)); return; }
      var nw = e.target.closest('[data-v30-tpl-new]');
      if (nw)  { newTemplate(); return; }
      var sv = e.target.closest('[data-v30-tpl-save]');
      if (sv)  { saveTemplate(); return; }
      var dl = e.target.closest('[data-v30-tpl-delete]');
      if (dl)  { deleteTemplate(); return; }
    });
  }

  // ─── Built-in categories auto-create ──────────────────────
  var BUILTIN_CATEGORIES = [
    {
      name: 'Simulation_Modélisation',
      keywords: ['simulation', 'modélisation', 'matlab', 'simulink', 'ansys', 'altair', 'model-based design', 'mbd', 'éléments finis', 'fem', 'cfd', 'ansys fluent', 'dymola', 'modelica', 'dspace', 'rapid prototyping', 'hil', 'sil', 'validation', 'vérification', 'ferroviaire', 'automobile', 'aéronautique']
    },
    {
      name: 'Electrotechnique_Energie',
      keywords: ['électrotechnique', 'génie électrique', 'énergie', 'électronique de puissance', 'variateur', 'onduleur', 'convertisseur', 'hta', 'htb', 'poste de transformation', 'transformateur', 'motorisation', 'vfd', 'igbt', 'ups', 'alimentation', 'réseau électrique', 'smartgrid', 'energies renouvelables', 'photovoltaique', 'stockage énergie', 'batterie', 'bms', 'traction électrique', 'ev', 'véhicule électrique']
    },
    {
      name: 'Surete_Fonctionnement_SdF',
      keywords: ['sûreté de fonctionnement', 'sdf', 'rams', 'fiabilité', 'disponibilité', 'maintenabilité', 'sécurité', 'fmea', 'fmeca', 'hazop', 'fta', 'amdec', 'iec 61508', 'iec 61511', 'en 50128', 'en 50129', 'iso 26262', 'sil', 'asil', 'sécurité fonctionnelle', 'analyse de risque', 'nucléaire', 'ferroviaire', 'certification']
    }
  ];
  function ensureBuiltinCategories() {
    var existing = {};
    STATE.categories.forEach(function (c) { existing[c.name] = true; });
    var missing = BUILTIN_CATEGORIES.filter(function (b) { return !existing[b.name]; });
    if (!missing.length) return Promise.resolve();
    var chain = Promise.resolve();
    var created = 0;
    missing.forEach(function (cat) {
      chain = chain.then(function () {
        return postJSON('/api/push-categories/save', { id: null, name: cat.name, keywords: cat.keywords })
          .then(function (data) {
            if (data && (data.ok || data.id || (typeof data.error === 'string' && data.error.indexOf('existe déjà') !== -1))) {
              created++;
            }
          })
          .catch(function () {});
      });
    });
    return chain.then(function () {
      return loadCategories().then(function () {
        if (created > 0) toast(created + ' catégorie(s) ajoutée(s) automatiquement', 'success', 3000);
      });
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindTabs();
    bindTopbar();
    bindCatEditor();
    bindModalCloseAndEsc();
    bindHistoryFilters();
    bindTemplateManagerStatic();
    bindCatGridClicks();
    bindCatDetailDelegation();
    loadCategories().then(function () {
      STATE.categoriesLoaded = true;
      return ensureBuiltinCategories();
    });
    // Auto-refresh quand l'onglet redevient actif (historique des push)
    var lastRefresh = Date.now();
    function maybeRefresh() {
      if (document.hidden) return;
      var now = Date.now();
      if (now - lastRefresh < 5000) return;
      lastRefresh = now;
      reloadPushLogs();
    }
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
