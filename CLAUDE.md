# ProspUp — CRM Prospection B2B (Up Technologies)

## Stack technique
- **Backend** : Flask (app.py ~10500 lignes), SQLite, Waitress WSGI en prod, ReportLab pour génération PDF
- **Frontend** : Vanilla JS (pas de framework), 20 pages HTML standalone
- **CSS** : Glassmorphism dark theme, `prefers-color-scheme` pour light mode
- **PWA** : Service Worker (sw.js), manifest.json, offline.html
- **Hebergement** : Cloudflare Tunnel → prospup.work, port 8000
- **Tests E2E** : Playwright (Chromium), 38 tests (desktop + mobile Pixel 5)

## Architecture fichiers
```
app.py                  # Backend Flask — routes, API, auth, DB
static/
  css/style.css         # ~7200 lignes, tout le style
  js/app.js             # ~7200 lignes, logique globale (showToast, fetch wrappers…)
  js/page-*.js          # Un fichier JS par page (page-dashboard.js, page-focus.js…)
  js/v8-features.js     # Features transversales (SW registration, bottom nav, haptic, error states)
  js/metiers-data.js    # Donnees metiers statiques
  js/notifications.js   # Push notifications
  sw.js                 # Service Worker (cache shell + API runtime cache)
  manifest.json         # PWA manifest (shortcuts, share_target, maskable icon)
*.html                  # 20 pages (index, dashboard, focus, login, entreprises…)
offline.html            # Fallback hors-ligne
tests/e2e/              # Tests Playwright
  auth.setup.js         # Auth session persistee
  *.spec.js             # login, dashboard, prospects, focus, navigation, mobile, pwa
minify.py               # Script de minification CSS/JS (rjsmin, csscompressor)
playwright.config.js    # Config Playwright (2 projets: desktop-chrome, mobile-pixel5)
```

## Auth
- Session cookie Flask (`session['user_id']`)
- `@app.before_request` protege toutes les routes sauf /login, /static, /api/auth/
- Login via POST `/api/auth/login` avec `{username, password}` JSON
- Roles : **admin** (accès total) et **editor** (lecture + modification) uniquement
- Multi-tenant : `owner_id` sur chaque enregistrement ; DB isolée par user dans `data/user_<id>/prospects.db` si elle existe

## Moyens de travailler (workflow développement)
- **Claude Code CLI** : développement via Claude Code CLI (outil Anthropic) exécuté dans le répertoire du projet. Les modifications sont faites directement sur les fichiers locaux, puis commitées et poussées sur `main`.
- **Workflow Git simplifié** :
  - Travail direct sur `main` (pas de branches feature)
  - Après chaque modification : `git add`, `git commit -m "message"`, `git push origin main`
  - Mise à jour sur le PC hébergeur via le bouton "Mettre à jour et redémarrer" dans l'app (admin)
  - Le flux de mise à jour gère automatiquement les divergences (fallback `git reset --hard origin/main`)
- **Requêtes typiques** :
  - **Mise à jour auto depuis l'app** : utiliser le bouton "Mettre à jour et redémarrer" dans Paramètres (section admin). Le flux affiche les logs git en direct (SSE) puis recharge la page après redémarrage.
  - **Gestion Git** : toutes les opérations git (pull, rollback) sont gérées depuis l'app via les routes `/api/deploy/*`. Pas besoin d'accès SSH au serveur.
  - **Version mobile vs desktop** : l'app détecte automatiquement le device et adapte l'UI (sidebar desktop vs bottom nav mobile, tableaux vs cartes, etc.). Pas de configuration nécessaire.
  - **Règles multi-user** : les permissions sont gérées via les rôles (admin/editor) et le décorateur `@role_required()`. Les données sont isolées par `owner_id` (multi-tenant).
- **Tests et vérifications** :
  - Tests E2E : `npx playwright test` (38 tests desktop + mobile)
  - Vérification système : bouton "Vérifier le déploiement" dans Paramètres (admin)
  - Logs serveur : bouton "Voir les logs serveur" dans Paramètres (admin)
- **Déploiement** :
  - Les modifications sont poussées sur `main` depuis Claude Code CLI
  - Sur le PC hébergeur : utiliser le bouton "Mettre à jour et redémarrer" dans l'app
  - Le superviseur (`scripts/supervise_prospup.py`) peut aussi faire un pull automatique et redémarrer
  - En cas de problème : rollback possible via le bouton "Rollback" dans Paramètres ou depuis la page 404

## Conventions
- `APP_VERSION` dans app.py (actuellement "28.0") — incrementer a chaque release
- **Workflow git (IMPORTANT)** : TOUJOURS travailler directement sur `main`. Ne JAMAIS créer de branches. Après chaque demande avec modifications, vérifier qu'on est sur `main` (`git checkout main` si nécessaire), puis committer et pousser directement sur `main` (`git add`, `git commit`, `git push origin main`). Pour mettre à jour le serveur sur le PC hébergeur : utiliser le bouton « Mettre à jour et redémarrer » dans Paramètres (section admin). Le flux affiche la sortie git en direct puis recharge la page après redémarrage.
- **Rappel fin de session** : À chaque fin de réponse où du code a été modifié, committer et pousser sur `main` pour que la session cloud et le pull (bouton Mettre à jour) soient à jour. Sinon les modifications ne seront pas sur Git donc pas dans le pull sur l'hébergeur.
- Cache busters automatiques : app.py calcule les hash MD5 des fichiers statiques au demarrage et remplace `?v=XXXX` dans le HTML
- Pas de bundler/build system — fichiers servis directement par Flask
- Scripts avec `defer` sur toutes les pages (sauf Chart.js CDN dans stats.html)
- Service Worker : network-first pour HTML/API, cache-first pour static assets
- Toast notifications via `window.showToast(msg, type, duration)` dans app.js
- Haptic feedback via `window.haptic(ms)` dans v8-features.js

## Mise à jour automatique depuis l'app (gestion Git)
- **Bouton "Mettre à jour et redémarrer"** : Paramètres > Mise à jour du serveur (admin uniquement). Déclenche un flux SSE en direct avec logs git.
- **Routes API deploy** :
  - `POST /api/deploy/pull` — streaming git pull depuis origin/main puis redémarrage automatique (SSE)
  - `POST /api/deploy/pull-from-404` — pull depuis la page 404 (accessible sans auth)
  - `POST /api/deploy/rollback` — rollback vers le commit précédent (sauvegardé dans `.last_commit_hash`)
  - `GET /api/deploy/health` — health check simple (accessible sans auth)
- **Flux de mise à jour** :
  1. Vérification que le repo est sur `main` (auto-checkout si nécessaire)
  2. `git fetch --prune origin main`
  3. Sauvegarde du commit actuel dans `.last_commit_hash` pour rollback possible
  4. Création snapshot DB automatique (`before_update`)
  5. Stash des modifications locales si présentes
  6. `git pull --ff-only origin main` (fallback vers `git reset --hard origin/main` si divergence)
  7. Redémarrage automatique via `_schedule_restart(delay=10.0)`
  8. Rechargement de la page après redémarrage
- **Badge version/commit** : Paramètres > À propos affiche `v{version} · {branch} · {commit_hash}` avec mise à jour automatique toutes les 30 s. Indicateur visuel si nouvelle version détectée.
- **Page 404 améliorée** : retry automatique avec countdown, boutons MAJ + Rollback avec restart intégré.
- **Sécurité** : toutes les routes deploy vérifient l'origine (CSRF), nécessitent le rôle admin (sauf pull-from-404 et rollback depuis 404), et sauvegardent le commit actuel avant toute modification.

## Versions mobile et desktop
- **Détection device** : `window.matchMedia('(max-width: 900px)')` pour mobile, sinon desktop.
- **Navigation** :
  - **Desktop** : sidebar fixe à gauche (`sidebar.js` génère depuis données déclaratives)
  - **Mobile** : bottom nav fixe en bas (`mobile-bottom-nav`), sidebar masquée par défaut (hamburger menu)
  - Pages mobiles : `dashboard`, `prospects`, `focus`, `calendar`, `push` (défini dans `MOBILE_NAV`)
- **Rendu adaptatif** :
  - **Prospects** : tableau desktop (13 colonnes triables) vs cartes compactes mobile (`prospect-card-mobile`)
  - **Entreprises** : vue liste desktop vs cartes mobile
  - **Dashboard** : widgets en grille desktop vs colonne mobile
- **Interactions** :
  - **Drag & drop** : système unifié desktop (mousedown) + mobile (touchstart) — widgets dashboard, réorganisation tâches
  - **Swipe gestures** : mobile uniquement — swipe-to-action sur cartes prospects, swipe pour fermer modales
  - **Pull-to-refresh** : mobile uniquement (détection via `matchMedia`)
  - **Haptic feedback** : mobile uniquement via `window.haptic(ms)`
- **Barre d'actions rapides mobile** : `mobile-quick-actions-bar` avec Focus, Recherche, Ajouter prospect (visible uniquement sur mobile).
- **CSS responsive** : media queries `@media (max-width: 900px)` pour adapter layout, tailles de police, espacements. Classes `.mobile-only` et `.desktop-only` pour affichage conditionnel.

## Gestion des règles multi-user
- **Rôles** : `ROLE_LEVELS = {'admin': 3, 'editor': 2}` — admin (accès total) et editor (lecture + modification) uniquement.
- **Décorateur `@role_required(min_role)`** : vérifie que l'utilisateur a le niveau requis. Exemple : `@role_required('admin')` pour les routes sensibles (deploy, config IA, gestion utilisateurs).
- **Multi-tenant** : chaque enregistrement (prospect, entreprise, candidat) a un `owner_id` qui correspond à `session['user_id']`. Les requêtes filtrent automatiquement par `owner_id`.
- **DB isolée par user** : si `data/user_<id>/prospects.db` existe, elle est utilisée à la place de la DB principale. Sinon, utilisation de la DB principale avec filtrage par `owner_id`.
- **Permissions** :
  - **Admin** : accès à toutes les routes (deploy, config IA, gestion utilisateurs, snapshots, stats globales)
  - **Editor** : accès aux routes de lecture/écriture (prospects, entreprises, candidats, focus, calendrier, push), mais pas aux routes admin
- **Vérifications** : `_prospect_owned()`, `_company_owned()`, `_candidate_owned()` pour s'assurer qu'un utilisateur ne peut modifier que ses propres données.
- **Migration rôles** : au démarrage, migration automatique `UPDATE users SET role='editor' WHERE role='reader'` (rôle reader supprimé).

## IA — Ollama + Tavily (v28.0)
- **Architecture** : **Ollama** (local, génération de texte) + **Tavily** (cloud, recherche web). Tavily enrichit les prompts Ollama avec des données web réelles.
- **Composants** :
  - **Ollama** (local, défaut) : gratuit, hors-ligne, requiert GPU. Proxy backend vers `http://127.0.0.1:11434`.
  - **Tavily** (recherche web cloud) : enrichissement avec données web réelles. ~0.005-0.008$/recherche. 1000 recherches gratuites/mois. Clé API sur app.tavily.com.
- **Flux web_search** : Tavily recherche → résultats injectés dans le prompt → Ollama génère le texte final → citations Tavily ajoutées.
- **Configuration** : Paramètres > Configuration IA (admin). Persisté dans `data/ai_config.json` (gitignored, jamais écrasé par MAJ).
- **Variables d'environnement** (défauts, surchargés par la config UI) :
  - `OLLAMA_URL` (défaut `http://127.0.0.1:11434`), `OLLAMA_MODEL` (défaut `llama3.2`), `OLLAMA_TIMEOUT` (secondes, défaut 120)
  - `TAVILY_API_KEY` (vide par défaut)
- **Routes API** :
  - `POST /api/ollama/generate` — proxy IA unifié non-streaming, supporte `web_search: true`
  - `POST /api/ollama/generate-stream` — proxy IA unifié streaming SSE, supporte `web_search: true`
  - `GET /api/ai/config` — config IA courante (clés masquées)
  - `POST /api/ai/config` — mise à jour config IA (admin)
  - `POST /api/ai/test` — test de connexion Ollama ou Tavily
- **Routing web** : les boutons Scrapping/Scan/Bulk passent `web_search: true` → Tavily+Ollama si clé Tavily configurée, sinon Ollama seul. Les autres fonctions (reformatage, mapping, après réunion) restent sur Ollama seul.
- **Frontend** : `callOllama(prompt, { webSearch: true })` dans app.js active le routing web.

### Entrées IA implémentées (boutons / flux)
| Où | Bouton / action | Comportement |
|----|-----------------|--------------|
| Page Prospects (ligne) | « Scrapping IA » | Un clic : envoie le prompt enrichissement prospect à Ollama, ouvre la modale avec le texte généré, analyse (Accepter / Ignorer) puis applique. Fallback : modale vide pour collage manuel si Ollama indisponible. |
| Fiche entreprise (index) | « Scrapping IA » | Même principe pour une entreprise (prompt + modale import). |
| Page Candidats (fiche) | « Scrapping IA » | Même principe pour un candidat (page-candidate.js + app.js). |
| Page Prospects (onglet RDV) | « Avant réunion IA » | Un clic : analyse profil LinkedIn via Ollama (streaming SSE) → génération PDF fiche préparation RDV → téléchargement automatique. Visible uniquement si statut = "Rendez-vous". Fallback : prompt pré-rempli si Ollama indisponible. |
| Page Prospects (ligne) | « Après réunion IA » | Un clic : prompt compte-rendu RDV → Ollama → modale avec JSON, analyse puis applique. |
| Page Prospects (barre d’actions) | « Email IA » / « Tel IA » | Ouvre la modale bulk ; bouton « Générer avec Ollama » remplit la zone résultat et lance l’analyse (email ou téléphone en masse). |
| Page Prospects | « Ajout IA » | Modale Quick Add : choix type (Prospect / Entreprise / Candidat), puis « Générer avec Ollama (un seul) » ou « (plusieurs) » ; résultat pré-rempli, analyse puis création. Boutons « Copier » en secours. |
| Import liste (étape mapping) | « Suggérer le mapping avec Ollama » | Envoie les en-têtes Excel à Ollama, reçoit un JSON header→champ, pré-remplit les listes déroulantes de mapping. |
| Import liste (étape aperçu) | « Reformater [champ] » | Modale avec prompt de normalisation ; bouton « Générer avec Ollama » remplit la zone résultat (une valeur par ligne). |

### Import Excel (nouvel utilisateur)
- Champs mappables : Nom, Prénom (combiné en « Prénom Nom »), Entreprise, Site, Fonction, Téléphone (plusieurs colonnes fusionnées, ex. TEL + PORTABLE), Email, LinkedIn, Notes, Tags, Pertinence, Statut, Date dernier contact.
- Détection auto des colonnes : `_guessMapping` dans app.js (NOM, PRENOM, GROUPE, SITE, TEL, PORTABLE, FONCTION, MAIL, COMMENTAIRE, LINKEDIN, ACTION, DATE DERNIER CONTACT, etc.).
- Fixture de test : `tests/fixtures/fichier_prosp_test_user.xlsx`. Plan de test manuel et E2E : `docs/PLAN_TEST_IMPORT_EXCEL.md`. Prompt de test complet (simulation nouvel utilisateur + IA) : `docs/PROMPT_TEST_NOUVEL_UTILISATEUR.md`.

## Commandes utiles
```bash
python app.py                    # Dev server (port 8000, debug=True)
python app.py --prod             # Prod avec Waitress
python scripts/supervise_prospup.py   # Superviseur v2: lance le serveur, détecte crash loops, rollback auto, health check
npx playwright test              # Lancer les 38 tests E2E
npx playwright test --headed     # Tests avec navigateur visible
python minify.py                 # Minifier CSS/JS
python scripts/watch-prospup.py  # Une vérification puis sortie
python scripts/watch-prospup.py --loop   # Surveillance en continu sur le PC hébergeur, relance si prospup.work ne répond plus
```
- **Surveillance ProspUp** : `scripts/watch-prospup.py` vérifie que l’app répond (GET sur l’URL configurée). Si échec (timeout 10 s ou status ≠ 200), lance la commande de relance. Variables d’environnement : `PROSPUP_WATCH_URL` (défaut https://prospup.work), `PROSPUP_WATCH_CMD` (défaut `python app.py --prod`), `PROSPUP_WATCH_DIR` (répertoire de travail), `PROSPUP_WATCH_INTERVAL` (900), `PROSPUP_WATCH_TIMEOUT` (10). Sous Windows : tâche planifiée toutes les 15 min ou exécuter en arrière-plan avec `--loop`.

## Fiabilité des mises à jour (mars 2026)
- **Problème** : quand deux modifications sont poussées simultanément sur `main` (ex: deux sessions Claude Code CLI), le `git pull --ff-only` échoue sur le serveur car les branches divergent → le serveur crashe → 502 Bad Gateway via Cloudflare.
- **Solution multi-couches** :
  1. **Git pull résilient** (`app.py`) : toutes les routes deploy (`/api/deploy/pull`, `/api/deploy/pull-from-404`, `/api/deploy/rollback`) essaient d'abord `git pull --ff-only`. Si ça échoue (divergence), fallback automatique vers `git reset --hard origin/main` pour forcer la synchronisation.
  2. **Auto-checkout main** : avant tout pull, les routes vérifient que le repo est sur `main` et font un `checkout main` si nécessaire.
  3. **Restart automatique depuis 404** : les routes `pull-from-404` et `rollback` appellent désormais `_schedule_restart()` pour un redémarrage automatique sans intervention manuelle.
  4. **Superviseur v2** (`scripts/supervise_prospup.py`) : détection de crash loop (3 crashs en 120 s par défaut), rollback automatique vers `.last_commit_hash`, health check HTTP après chaque restart, auto-checkout main au démarrage.
  5. **Page 404 améliorée** : retry automatique avec countdown, boutons MAJ + Rollback avec restart intégré.
- **Variables d'environnement superviseur** : `PROSPUP_CRASH_THRESHOLD` (défaut 3), `PROSPUP_CRASH_WINDOW` (120 s), `PROSPUP_HEALTH_PORT` (8000), `PROSPUP_HEALTH_TIMEOUT` (30 s), `PROSPUP_GRACE_PERIOD` (8 s).

## Tracabilité — Correctif utilisateurs et DB (mars 2025)
- **Problème** : les DB per-user (`data/user_<id>/prospects.db`) étaient créées sans la colonne `deleted_at` (soft delete v23.5), ce qui provoquait `sqlite3.OperationalError: no such column: deleted_at` au chargement des données. La suppression d’un utilisateur échouait parfois (fichier verrouillé).
- **Modifications** :
  - **app.py** : `_init_user_db()` crée désormais les tables `companies`, `prospects`, `candidates` avec `deleted_at TEXT`. Ajout de `_migrate_user_db_schema(db_path)` qui ajoute `deleted_at` à ces tables si absent, et de `_migrate_all_user_dbs()` qui applique cette migration à toutes les DB dans `data/user_*/prospects.db` et supprime les dossiers orphelins (user_X dont l’id n’existe plus dans la table `users`). `_migrate_all_user_dbs()` est appelée au démarrage après `init_db()`.
  - **Rôles** : simplification à deux rôles uniquement — admin et editor. Suppression du rôle reader dans `ROLE_LEVELS`, dans les vérifications JWT/session et dans l’UI. Valeur par défaut à la création d’un utilisateur : `editor`. Migration au démarrage : `UPDATE users SET role='editor' WHERE role='reader'`.
  - **users.html** : liste des rôles limitée à Admin et Éditeur ; défaut « editor » dans le formulaire ; `ROLE_LABELS` / `ROLE_COLORS` sans reader.
- **Résultat** : les données par utilisateur s’affichent correctement ; la suppression d’un utilisateur supprime d’abord l’entrée dans `users`, et au prochain redémarrage les dossiers orphelins sont nettoyés si le `rmtree` avait échoué (fichier verrouillé).

## Audit multi-utilisateurs
- Script : `python -m tests.audit_multi_user` (à lancer avec `PYTHONIOENCODING=utf-8`).
- Rapports : `tests/audit_reports/audit_multi_user_*.json`.
- **Correctif save partiel** : dans `upsert_all`, PRAGMA foreign_keys = OFF pendant la transaction + suppression des prospects référençant les companies à supprimer avant les autres deletes ; réactivation des FK en finally.
- **Problème connu** : dossiers `data/user_X` orphelins sous Windows si DB encore ouverte ; nettoyés au redémarrage.

## Audits sécurité et UI
- **Sécurité** : `docs/AUDIT_SECURITE.md` — correctifs XSS sidebar, erreurs 500 génériques en prod, path traversal pushs, recommandations (CORS, rate limit, CSP).
- **UI / navigation** : `docs/AUDIT_UI_NAVIGATION.md` — lien Aide unifié (/help), boutons modales sourcing (modal-close), cohérence sidebar/bottom nav.

## Efficacité de production (mars 2026)
- **Audit de cohérence** : `docs/AUDIT_COHERENCE_MARS_2026.md` — 47 incohérences identifiées et corrigées (textes, UX, fonctionnalités). Uniformisation du nom de l'application (`Prosp'Up`), standardisation des messages utilisateur (`showToast()` au lieu de `alert()`), cohérence des libellés de boutons.
- **Patterns UX standardisés** :
  - Messages utilisateur : `showToast()` pour info/erreur/warning, `alert()` uniquement pour confirmations critiques
  - Libellés boutons : `Enregistrer` pour sauvegarde, `Ajouter` uniquement pour ouvrir une modale
  - Champs obligatoires : classe CSS `required` plutôt que `*` en dur
  - États de chargement : skeletons ou messages "Chargement…" partout
  - Messages d'état vide : "Aucun {élément} pour ces filtres" partout
- **Accessibilité** : attributs ARIA sur modales (`role="dialog"`, `aria-modal="true"`), `aria-label` sur boutons sans label visible, navigation clavier (Escape pour fermer modales).
- **Performance** : skeletons loaders pour feedback visuel, Service Worker pour cache, cache busters automatiques via hash MD5.

## Points d'attention
- Le dossier est sur OneDrive — les chemins contiennent des espaces, toujours quoter
- Python sur ce PC : Python 3.14, encodage console cp1252 → utiliser PYTHONIOENCODING=utf-8 pour Playwright
- Les identifiants de test par defaut sont admin/admin (configurable via PROSPUP_USER/PROSPUP_PASS)
- Ne jamais ajouter `cache: 'no-store'` aux fetch — le SW et les headers Cache-Control gerent le cache
- **Claude Code CLI** : travailler directement sur `main`, committer et pousser après chaque modification pour que le bouton "Mettre à jour et redémarrer" fonctionne
