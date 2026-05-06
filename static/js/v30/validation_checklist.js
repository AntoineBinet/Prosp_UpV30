/* ProspUp v30 — Checklist de validation post-merge (interactive).
   Persiste l'état dans localStorage. Export final en Markdown
   avec un prompt prêt à copier dans une nouvelle session Claude. */
(function () {
  'use strict';

  var STORAGE_KEY = 'prospup.validation.v1';
  var SESSION_URL = 'https://claude.ai/code/session_01XmPkseGtsJ7qwEgRw3YYeg';

  // ─── Données : checklist ────────────────────────────────────────────
  var SECTIONS = [
    {
      id: 'bloquants',
      priority: 'high',
      title: 'BLOQUANTS — à tester en priorité',
      items: [
        { id: 'b1', label: '<code>python app.py</code> démarre sans erreur — log "Outlook disponible" affiché, ≥296 routes enregistrées' },
        { id: 'b2', label: '<code>python app.py --prod</code> (Waitress) démarre sans erreur' },
        { id: 'b3', label: 'Login <code>admin/admin</code> → redirige vers <code>/v30/dashboard</code>' },
        { id: 'b4', label: '<code>python -c "import app"</code> → 296+ routes via <code>app.url_map</code>' },
        { id: 'b5', label: '<code>pytest tests/</code> passe (en particulier <code>test_api_phase3_security_p0.py</code>)' },
        { id: 'b6', label: '<code>python -m tests.audit_multi_user</code> passe' },
      ],
    },
    {
      id: 'pwa',
      priority: 'high',
      title: 'PWA & Service Worker',
      items: [
        { id: 'pwa1', label: 'Chrome DevTools → Application → Service Workers : SW à jour, aucune 404 dans la console' },
        { id: 'pwa2', label: 'Cache version <code>prospup-v32.25-shell-1</code> visible dans Application > Cache Storage' },
        { id: 'pwa3', label: 'Hard reload (Ctrl+Shift+R) : app charge proprement' },
      ],
    },
    {
      id: 'auth',
      priority: 'high',
      title: 'Auth & sessions',
      items: [
        { id: 'a1', label: 'Login → dashboard (cookie session)' },
        { id: 'a2', label: 'Logout → redirection <code>/login</code>' },
        { id: 'a3', label: 'Session persiste après refresh' },
        { id: 'a4', label: 'JWT mobile (si app mobile) : <code>/api/auth/login</code> retourne tokens' },
      ],
    },
    {
      id: 'nav',
      priority: 'high',
      title: 'Navigation v30',
      items: [
        { id: 'n1', label: 'Pages v30 chargent : <code>/v30/dashboard</code>, <code>/v30/prospects</code>, <code>/v30/entreprises</code>, <code>/v30/sourcing</code>, <code>/v30/calendrier</code>, <code>/v30/focus</code>, <code>/v30/stats</code>, <code>/v30/push</code>, <code>/v30/parametres</code>' },
        { id: 'n2', label: 'Détail candidat <code>/v30/candidat/&lt;id&gt;</code> charge' },
        { id: 'n3', label: 'Anciennes URLs redirigent (302) : <code>/dashboard</code>, <code>/sourcing</code>, <code>/candidat?id=42</code>' },
        { id: 'n4', label: 'Mode Prosp <code>/v30/mode-prosp</code> : deck 3D charge' },
      ],
    },
    {
      id: 'prospects',
      priority: 'high',
      title: 'Prospects',
      items: [
        { id: 'p1', label: 'Liste prospects (tableau desktop / cartes mobile)' },
        { id: 'p2', label: 'Détail prospect → timeline charge' },
        { id: 'p3', label: 'Log call (mark as called) fonctionne' },
        { id: 'p4', label: 'Ajout note via modale' },
        { id: 'p5', label: 'Bulk action (sélection multiple → changer statut)' },
        { id: 'p6', label: 'Drag & drop pipeline dashboard' },
      ],
    },
    {
      id: 'candidats',
      priority: 'high',
      title: 'Candidats',
      items: [
        { id: 'c1', label: 'Liste candidats <code>/v30/sourcing</code>' },
        { id: 'c2', label: 'Fiche candidat charge (expériences, formations, certifs, skills)' },
        { id: 'c3', label: 'Upload DC PDF → <code>/api/candidates/&lt;id&gt;/dossier-competence</code>' },
        { id: 'c4', label: 'DC generator <code>/v30/dc/&lt;id&gt;</code> génère un PDF' },
        { id: 'c5', label: 'Description IA candidat (bouton Push regenère)' },
      ],
    },
    {
      id: 'push',
      priority: 'high',
      title: 'Push (emails de prospection)',
      items: [
        { id: 'pu1', label: 'Templates push → bouton "Email IA" sur prospect → modale s\'ouvre' },
        { id: 'pu2', label: 'Catégories push (DevOps, Electronique...) → match candidates fonctionne' },
        { id: 'pu3', label: 'Génération <code>.msg</code> (Outlook installé) ou <code>.eml</code> (fallback)' },
      ],
    },
    {
      id: 'calendar',
      priority: 'med',
      title: 'Calendrier',
      items: [
        { id: 'cal1', label: 'Vue mois charge avec RDV' },
        { id: 'cal2', label: 'Création événement' },
        { id: 'cal3', label: 'Suppression / modification événement' },
      ],
    },
    {
      id: 'dashboard',
      priority: 'med',
      title: 'Dashboard',
      items: [
        { id: 'd1', label: 'KPIs charge (prospects, push, calls, RDV)' },
        { id: 'd2', label: 'Pipeline stages affiché' },
        { id: 'd3', label: 'Action center fonctionnel' },
        { id: 'd4', label: 'Assistant IA <code>/api/dashboard/assistant</code>' },
      ],
    },
    {
      id: 'stats',
      priority: 'med',
      title: 'Stats',
      items: [
        { id: 's1', label: '<code>/v30/stats</code> charge tous les charts Chart.js' },
        { id: 's2', label: 'Export XLSX <code>/api/stats/export_weekly_xlsx</code>' },
        { id: 's3', label: 'Heatmap, prédictions IA' },
      ],
    },
    {
      id: 'snapshot',
      priority: 'med',
      title: 'Snapshots & déploiement',
      items: [
        { id: 'sn1', label: 'Paramètres → Snapshots : liste, création, restauration' },
        { id: 'sn2', label: 'Bouton "Mettre à jour et redémarrer" (admin) → flux SSE OK' },
        { id: 'sn3', label: 'Health check <code>/api/deploy/health</code> répond 200' },
      ],
    },
    {
      id: 'multiuser',
      priority: 'med',
      title: 'Multi-user / sécurité',
      items: [
        { id: 'mu1', label: 'User <code>editor</code> ne peut pas accéder à <code>/users</code> ni <code>/api/admin/*</code>' },
        { id: 'mu2', label: 'Isolation owner_id : un user ne voit pas les prospects d\'un autre' },
        { id: 'mu3', label: 'CSRF actif sur POST <code>/api/*</code> (cookie auth)' },
        { id: 'mu4', label: 'Headers de sécurité présents (<code>X-Frame-Options</code>, <code>Strict-Transport-Security</code>, CSP)' },
        { id: 'mu5', label: 'Rate limit login (5 tentatives en 5 min)' },
      ],
    },
    {
      id: 'imports',
      priority: 'med',
      title: 'Imports / Exports',
      items: [
        { id: 'i1', label: 'Import Excel prospects (xlsx.min.js chargé à la demande)' },
        { id: 'i2', label: 'Export CSV candidats <code>/api/candidates/export.csv</code>' },
        { id: 'i3', label: 'Export PDF rapport hebdo' },
      ],
    },
    {
      id: 'iphone',
      priority: 'med',
      title: 'iPhone PWA (test sur appareil réel)',
      items: [
        { id: 'ip1', label: 'Ajouter à l\'écran d\'accueil → ouvrir l\'app PWA standalone' },
        { id: 'ip2', label: '⚠️ Boutons en haut accessibles sous Dynamic Island (le bug fixé en commit beb35a1)' },
        { id: 'ip3', label: 'Bottom nav fonctionnelle, swipes prospects fluides' },
        { id: 'ip4', label: 'Service Worker précache les assets' },
      ],
    },
    {
      id: 'tech',
      priority: 'low',
      title: 'Points techniques avancés',
      items: [
        { id: 't1', label: 'Test : <code>python -c "from routes import auth, ai, deploy, transcription, besoins, companies, pages, settings, calendar, attachments, candidates, push, dashboard, prospects, duplicates, push_logs, meetings, bulk, admin, misc, dc, collab; print(\'OK\')"</code>' },
        { id: 't2', label: 'Logs : <code>logs/prospup.log</code> créé et reçoit les entrées (rotating à 5 MB)' },
        { id: 't3', label: 'Pas de stack traces inattendues au démarrage' },
        { id: 't4', label: '<code>npx playwright test</code> (E2E Chromium + Pixel 5)' },
      ],
    },
  ];

  // ─── State ──────────────────────────────────────────────────────────
  var state = loadState();

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { items: {}, comments: {}, sectionsCollapsed: {}, startedAt: new Date().toISOString() };
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ─── Render ─────────────────────────────────────────────────────────
  var totalItems = SECTIONS.reduce(function (n, s) { return n + s.items.length; }, 0);

  function render() {
    var root = document.getElementById('vc-sections-root');
    root.innerHTML = '';
    SECTIONS.forEach(function (sec) {
      var collapsed = !!state.sectionsCollapsed[sec.id];
      var sEl = document.createElement('div');
      sEl.className = 'vc-section' + (collapsed ? ' is-collapsed' : '');
      sEl.dataset.section = sec.id;

      var done = sec.items.filter(function (it) { return state.items[it.id]; }).length;

      sEl.innerHTML = (
        '<div class="vc-section__head" data-toggle>'
        + '<span class="vc-section__priority vc-section__priority--' + sec.priority + '" title="Priorité ' + sec.priority + '"></span>'
        + '<span class="vc-section__title">' + escapeHtml(sec.title) + '</span>'
        + '<span class="vc-section__progress" data-section-progress>' + done + '/' + sec.items.length + '</span>'
        + '<span class="vc-section__chevron">▾</span>'
        + '</div>'
        + '<div class="vc-section__body">'
        + sec.items.map(function (it) {
          var status = state.items[it.id] || '';
          var comment = state.comments[it.id] || '';
          var itemClass = 'vc-item';
          if (status === 'ok') itemClass += ' is-passed';
          if (status === 'ko') itemClass += ' is-failed';
          return (
            '<div class="' + itemClass + '" data-item-id="' + it.id + '">'
            + '<div class="vc-item__label" data-toggle-comment>' + it.label + '</div>'
            + '<div class="vc-item__actions">'
            + '<button type="button" class="vc-status-btn ' + (status === 'ok' ? 'is-active--ok' : '') + '" data-status="ok" title="OK">✓</button>'
            + '<button type="button" class="vc-status-btn ' + (status === 'ko' ? 'is-active--ko' : '') + '" data-status="ko" title="KO">✗</button>'
            + '<button type="button" class="vc-status-btn ' + (status === 'skip' ? 'is-active--skip' : '') + '" data-status="skip" title="Skipper">⊘</button>'
            + '</div>'
            + '<textarea class="vc-comment ' + (comment || status === 'ko' ? 'is-visible' : '') + '"'
            + ' placeholder="Détails du problème (optionnel)…" data-comment>' + escapeHtml(comment) + '</textarea>'
            + '</div>'
          );
        }).join('')
        + '</div>'
      );

      root.appendChild(sEl);
    });

    updateProgress();
    bindEvents();
  }

  function bindEvents() {
    document.querySelectorAll('[data-toggle]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        var section = el.closest('.vc-section');
        var sid = section.dataset.section;
        section.classList.toggle('is-collapsed');
        state.sectionsCollapsed[sid] = section.classList.contains('is-collapsed');
        saveState();
      });
    });

    document.querySelectorAll('.vc-status-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var item = btn.closest('.vc-item');
        var id = item.dataset.itemId;
        var newStatus = btn.dataset.status;
        // Toggle off if clicking active button
        if (state.items[id] === newStatus) {
          delete state.items[id];
        } else {
          state.items[id] = newStatus;
        }
        saveState();
        render();
      });
    });

    document.querySelectorAll('[data-toggle-comment]').forEach(function (el) {
      el.addEventListener('click', function () {
        var ta = el.parentElement.querySelector('[data-comment]');
        if (ta) {
          ta.classList.toggle('is-visible');
          if (ta.classList.contains('is-visible')) ta.focus();
        }
      });
    });

    document.querySelectorAll('[data-comment]').forEach(function (ta) {
      ta.addEventListener('input', function () {
        var item = ta.closest('.vc-item');
        var id = item.dataset.itemId;
        if (ta.value.trim()) {
          state.comments[id] = ta.value;
        } else {
          delete state.comments[id];
        }
        saveState();
      });
    });
  }

  function updateProgress() {
    var counts = { ok: 0, ko: 0, skip: 0 };
    SECTIONS.forEach(function (sec) {
      sec.items.forEach(function (it) {
        var s = state.items[it.id];
        if (s) counts[s]++;
      });
    });
    var done = counts.ok + counts.ko + counts.skip;
    var pending = totalItems - done;
    var pct = totalItems ? Math.round(done * 100 / totalItems) : 0;

    document.getElementById('vc-done').textContent = done;
    document.getElementById('vc-total').textContent = totalItems;
    document.getElementById('vc-progress-fill').style.width = pct + '%';
    document.getElementById('vc-ok-count').textContent = counts.ok;
    document.getElementById('vc-ko-count').textContent = counts.ko;
    document.getElementById('vc-skip-count').textContent = counts.skip;
    document.getElementById('vc-pending-count').textContent = pending;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripHtml(s) {
    return String(s).replace(/<[^>]+>/g, '');
  }

  // ─── Export Markdown ────────────────────────────────────────────────
  function buildMarkdown() {
    var counts = { ok: 0, ko: 0, skip: 0, pending: 0 };
    var koItems = [];
    var skipItems = [];
    var commentedItems = [];

    SECTIONS.forEach(function (sec) {
      sec.items.forEach(function (it) {
        var s = state.items[it.id];
        if (!s) counts.pending++;
        else counts[s]++;
        if (s === 'ko') koItems.push({ section: sec.title, label: stripHtml(it.label), comment: state.comments[it.id] || '' });
        if (s === 'skip') skipItems.push({ section: sec.title, label: stripHtml(it.label) });
        if (state.comments[it.id]) commentedItems.push({ section: sec.title, label: stripHtml(it.label), status: s, comment: state.comments[it.id] });
      });
    });

    var md = '# Validation post-merge ProspUp v' + (window.__APP_VERSION__ || '?') + '\n\n';
    md += '**Date du test** : ' + new Date().toLocaleString('fr-FR') + '\n';
    md += '**Branche testée** : `claude/prospup-audit-cleanup-W1i91`\n';
    md += '**Total** : ' + totalItems + ' checks\n\n';
    md += '## Résultats\n\n';
    md += '| Statut | Nombre |\n|---|---|\n';
    md += '| ✅ OK | ' + counts.ok + ' |\n';
    md += '| ❌ KO | ' + counts.ko + ' |\n';
    md += '| ⊘ Skippés | ' + counts.skip + ' |\n';
    md += '| ⏳ Non testés | ' + counts.pending + ' |\n\n';

    if (koItems.length) {
      md += '## ❌ Échecs (' + koItems.length + ')\n\n';
      koItems.forEach(function (it) {
        md += '### ' + it.section + ' — ' + it.label + '\n';
        if (it.comment) md += '\n> ' + it.comment.split('\n').join('\n> ') + '\n';
        md += '\n';
      });
    }

    if (commentedItems.length) {
      var withoutKo = commentedItems.filter(function (it) { return it.status !== 'ko'; });
      if (withoutKo.length) {
        md += '## 💬 Commentaires (autres)\n\n';
        withoutKo.forEach(function (it) {
          var statusIcon = it.status === 'ok' ? '✅' : (it.status === 'skip' ? '⊘' : '⏳');
          md += '- ' + statusIcon + ' **' + it.section + '** — ' + it.label + '\n';
          md += '  > ' + it.comment.split('\n').join('\n  > ') + '\n';
        });
        md += '\n';
      }
    }

    if (skipItems.length) {
      md += '## ⊘ Skippés (' + skipItems.length + ')\n\n';
      skipItems.forEach(function (it) {
        md += '- **' + it.section + '** — ' + it.label + '\n';
      });
      md += '\n';
    }

    md += '## Détail complet\n\n';
    SECTIONS.forEach(function (sec) {
      var done = sec.items.filter(function (it) { return state.items[it.id]; }).length;
      md += '### ' + sec.title + ' (' + done + '/' + sec.items.length + ')\n\n';
      sec.items.forEach(function (it) {
        var s = state.items[it.id];
        var icon = s === 'ok' ? '[x]' : (s === 'ko' ? '[!]' : (s === 'skip' ? '[-]' : '[ ]'));
        md += '- ' + icon + ' ' + stripHtml(it.label);
        if (state.comments[it.id]) md += ' — _' + state.comments[it.id].replace(/\n/g, ' ') + '_';
        md += '\n';
      });
      md += '\n';
    });

    md += '\n---\n\n';
    md += '## 🤖 Prompt à donner à Claude pour corriger les échecs\n\n';
    md += 'Copie tout le bloc ci-dessous (entre les ```) et colle-le dans une nouvelle session Claude Code :\n\n';
    md += '```\n';
    md += 'Suite aux tests post-merge de la PR #179 (modularisation ProspUp v32.25), voici les échecs constatés.\n';
    md += 'Branche concernée : claude/prospup-audit-cleanup-W1i91\n';
    md += 'Date du test : ' + new Date().toLocaleString('fr-FR') + '\n\n';

    if (counts.ko === 0 && counts.pending === 0) {
      md += 'TOUS LES CHECKS SONT PASSÉS ✅ — aucune correction nécessaire, la PR est prête à merger.\n';
    } else if (counts.ko === 0) {
      md += counts.pending + ' check(s) non testé(s), aucun échec constaté. La PR semble prête mais des tests restent à faire.\n';
    } else {
      md += 'ÉCHECS À CORRIGER (' + counts.ko + ') :\n\n';
      koItems.forEach(function (it, idx) {
        md += (idx + 1) + '. [' + it.section + '] ' + it.label + '\n';
        if (it.comment) md += '   Détails : ' + it.comment.replace(/\n/g, ' / ') + '\n';
      });
      md += '\nMerci d\'analyser chaque échec, identifier la cause racine (probablement liée à la modularisation : import manquant, helper non ré-exposé au niveau module app, ordre d\'import des blueprints, etc.), corriger le code, valider avec un smoke test python, puis commit + push sur la même branche.\n\n';
      md += 'Si plusieurs échecs sont liés au même symptôme (ex: tous les imports `from app import X` échouent), corriger en bulk.\n\n';
      md += 'À la fin, redonne-moi une mini-checklist des points à re-tester pour vérifier la correction.\n';
    }
    md += '```\n';

    return md;
  }

  function downloadFile(filename, content) {
    var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ─── Init ───────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('vc-test-date').textContent = new Date().toLocaleDateString('fr-FR');

    // Capture app_version from page
    var meta = document.querySelector('.vc-meta code');
    if (meta) window.__APP_VERSION__ = meta.textContent.trim();

    render();

    document.getElementById('vc-export').addEventListener('click', function () {
      var md = buildMarkdown();
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      downloadFile('prospup-validation-' + ts + '.md', md);
    });

    document.getElementById('vc-reset').addEventListener('click', function () {
      if (confirm('Effacer toutes les réponses et commentaires ?')) {
        state = { items: {}, comments: {}, sectionsCollapsed: {}, startedAt: new Date().toISOString() };
        saveState();
        render();
      }
    });
  });
})();
