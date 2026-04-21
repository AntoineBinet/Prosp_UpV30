# Changelog

Historique des versions significatives. Incrément dans [app.py:38](app.py).

## [30.0-alpha] — 2026-04-21

### UI v30 — étape 3 (Dashboard branché + Prospects + Fiche prospect + Entreprises)

- **Entreprises v30** — preview sur `/v30/entreprises` :
  - Topbar : titre + compteur + recherche inline + Filtres + Ajouter.
  - 4 KPI (Total entreprises · En pipeline · Total prospects · Actives 30j) en Instrument Serif.
  - Table 8 colonnes : Entreprise (logo 28×28 + nom), Site, Prospects (accent), RDV/Propale, Gagnés, Dernier contact, Tags (2+extra), lien clic → `/v30/entreprise/<id>` (la fiche entreprise v30 viendra après).
  - Branchée sur `GET /api/data` (réutilise le style prospects.css) ; agrégation par `company_id` côté client (total / piped / won / max lastContact).
  - Recherche fuzzy client-side (groupe + site + tags), debounce 150 ms.
  - Note : le schéma `companies` n'a pas `secteur`/`effectif`/`CA` du JSX de référence — la colonne JSX "CA prévu" a été remplacée par un comptage `Gagnés`. Ajout éventuel en migration DB plus tard si demandé.

- **Fiche prospect v30** — preview sur `/v30/prospect/<id>` :
  - Header : avatar 56 px, nom éditable inline, pill statut, chips email/tél/LinkedIn, actions Pousser / Appeler / Planifier.
  - Layout 2 cols : main (tabs Aperçu / Timeline / Push / IA) + aside (Détails, Tags, Entreprise).
  - **Edit-in-place** sur Nom, Notes, Fonction, Email, Téléphone via `POST /api/prospects/bulk-edit` (ids=[pid], field, value). Enter pour sauver, Esc pour annuler, checkmark vert 1.2 s.
  - Timeline Activité branchée sur `/api/prospect/timeline?id=X` (push / RDV / notes / status change, dots colorés par type).
  - Tab Push : liste des pushs avec badge channel.
  - **Drawer IA** (480 px) avec backdrop + Esc pour fermer ; placeholder pour Scraping / Avant-RDV / Après-RDV (branchement complet dans un commit ultérieur).
  - Route Flask : ownership vérifié via `owner_id + deleted_at`, redirection vers `/v30/prospects` si inaccessible.
  - `prospects.js` : redirection clic ligne/carte désormais vers `/v30/prospect/<id>` (plus vers la fiche legacy).
  - 3 fichiers JS chargés defer : `prospect_detail.js` (helpers + fetch), `prospect_detail_render.js` (rendu), `prospect_detail_ui.js` (events + drawer). Architecture modulaire pour éviter les gros fichiers.

### UI v30 — étape 3 (branchement Dashboard + écran Prospects)

- **Dashboard v3 branché** sur les vraies données via `static/js/v30/dashboard.js` :
  `/api/dashboard` pour hero KPIs, goals, feed activité ; `/api/dashboard/pipeline-stages`
  pour pipeline + priorités IA ; `/api/tasks?status=pending` pour l'action center
  "À faire". Plus aucune donnée mockée (sauf streak, faute de table dédiée).
  `page_v30_dashboard()` passe désormais `display_name`, `user_initials` et les
  compteurs sidebar réels.
- **Prospects v30** — preview sur `/v30/prospects` :
  - 3 vues switchables : Table (densité 32px, 10 colonnes incluant Mobile avec
    pastille de disponibilité, Pertinence en 5 barres), Kanban (5 statuts,
    cartes compactes), Split (320px liste + panel détail).
  - Bulk bar flottante (fond `var(--text)`) apparaissant dès une sélection :
    Pousser · Email IA · Tel IA · Tag · Assigner · Effacer.
  - Recherche fuzzy inline branchée sur `GET /api/search` (debounce 200 ms).
  - Pagination offset-based (50/page).
  - Sélection multi-lignes (checkbox + cocher tout).
  - Bulk tags branché sur `POST /api/prospects/bulk-status-tags` ; push bulk
    redirige vers `/push?ids=…` faute d'endpoint bulk-push.
  - Clic sur une ligne → redirection vers la fiche legacy `/?prospect=id`
    (la fiche v30 viendra dans un commit ultérieur).
- Nouveau fichier JS chargé defer, aucun framework. Nouveau CSS
  `static/css/v30/prospects.css`. `APP_VERSION` bumpée 29.9 → 30.0-alpha.

## [29.9] — 2026-04-21

### UI v30 — étape 3 (écrans 1 & 2)

- **Login v30** (`templates/v30/login.html`, route `/v30/login`) : split 60/40 (formulaire + colonne éditoriale avec citation + 3 stats). Formulaire fonctionnel (POST `/api/auth/login`, redirection `/dashboard` ou `/parametres?change_password=1`). `/v30/login` ajouté à la liste des routes publiques dans `before_request`.
- **Dashboard v3** (`templates/v30/dashboard.html`, route `/v30/dashboard`, CSS `static/css/v30/dashboard.css`) : hero éditorial + 4 KPI Instrument Serif + streak card ; bento 2:2:1 (Action center avec tabs À faire/RDV/En retard · Pipeline 5 étages · Objectifs avec ring SVG) ; bento 1:1 (Priorités IA · Timeline activité). Données mockées reprises du JSX de référence — branchement SQL dans un futur commit.
- Tabs Action center : switch client-side vanilla (aucun framework ajouté).

## [29.8] — 2026-04-21

### UI v30 — étape 1 & 2 (design system + navigation)

- Design system v30 intégré dans `static/css/v30/` (tokens OKLCH light + dark, 286 lignes `components.css`, chrome topbar/sidebar). Non destructif : le v29 reste intact.
- Partials Jinja v30 : `templates/_partials/v30/icon.html` (macro SVG reproduisant le dict `Icon` de `_chrome.jsx`), `topbar.html`, `sidebar.html`, `theme_toggle.html`.
- `templates/v30/base.html` : squelette autonome avec Google Fonts (Inter · Instrument Serif · JetBrains Mono), init thème inline, `data-theme="dark"` par défaut, persistance localStorage.
- Route preview isolée `GET /v30/preview` (template `templates/v30/preview.html`) pour valider visuellement le chrome et une sélection de composants avant migration écran par écran.
- `CHECKLIST.md` ajouté à la racine pour suivre la migration v30 étape par étape (SPEC.md § Page-by-page).

## [29.7] — 2026-04-18

### Nettoyage
- Suppression de 13 docs obsolètes dans `docs/` (plans non implémentés, audits historiques, rapports ponctuels).
- Suppression du duplicata `Template_DC/` (la vraie template vit dans `sample/template_dc.docx`).
- Suppression de fichiers accidentels (`nul`, logs root non gitignored).
- `node_modules/` retiré du git tracking (559 fichiers ~14 MB, ajouté à `.gitignore`).

### .gitignore
- Ajout : `node_modules/`, `.supervisor_pid`, `snapshots/`, `backups/`, `*.log`, `Thumbs.db`, `.claude/settings.local.json`.
- Réorganisation par section (Python, Node, Secrets, DB, Runtime, Logs, Outputs, Misc).

### Docs
- `README.md` réécrit (version 29.6, structure à jour, commandes, liens valides).
- `CLAUDE.md` réécrit — tailles de fichiers actualisées, sections simplifiées, liens vers les nouveaux docs workflow.
- Nouveaux : `.claude/WORKFLOW.md` (règles non-négociables) + `.claude/CHEATSHEET.md` (patterns récurrents).
- Nouveau : `CHANGELOG.md` (ce fichier).

## [29.5] — 2026-04 (non taggé)

- Stats : ajout `topPushedConsultants` (top 6 consultants pushés, historique complet).
- Stats : ajout `urgencyDistribution` (Priorités IA — répartition overdue/today/week/later).

## [29.4] — avril 2026

- Bouton « Ajouter » disponible dans tous les onglets candidats (PR #211).
- Fix dropdown téléphone décalé (suppression classe animation après `animationend`, PR #210).

## [29.x] — mars-avril 2026

- Mode Prosp v6 : redesign deck 3D premium (b15e222, d95df8b).
- Sourcing : onglet LinkedIn avec statuts exclusifs (f751d67).
- Support CV/LinkedIn dans l'assistant d'ajout candidat (1b323e0).
- Sessions Mode Prosp persistées en DB (bcef4fd).
- Push : grille 3 colonnes au lieu de liste verticale (71dc33d).

## Historique plus ancien

Voir `git log --oneline`. Versions antérieures (21.x à 28.x) documentaient les grands chantiers :
- v21.0 : restructuration racine, multi-user owner_id strict.
- v23.5 : soft delete (colonne `deleted_at`).
- v25.1 : sécurisation users + JWT mobile.
- v27.x : cohérence UI.
- v28.0 : IA Ollama + Tavily unifiée.
