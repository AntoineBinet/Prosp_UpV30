# ProspUp — CRM Prospection B2B (Up Technologies)

> **Version courante** : 31.7 (APP_VERSION dans app.py) — voir [CHANGELOG.md](CHANGELOG.md) pour l'historique récent.
> **Interface unique** : v30/v31. L'UI v29 a été dépréciée à la v31.7 — son code est archivé dans `archives/v29/` (templates, JS, opt-in). Les anciennes URLs (`/dashboard`, `/sourcing`, `/candidat?id=…`, etc.) renvoient désormais des **redirects 302** vers leur équivalent `/v30/...`. Aucun escape hatch (plus de bouton sidebar v29, plus de flag `?force_v29=1`).

## Stack technique
- **Backend** : Flask (app.py ~17 500 lignes), SQLite, Waitress WSGI en prod, ReportLab pour génération PDF, python-docx pour DOCX
- **Frontend** : Vanilla JS (pas de framework), templates Jinja2 (v30 uniquement), Chart.js (stats uniquement)
- **CSS** : design system v30 (`static/css/v30/*.css`), `prefers-color-scheme` pour light mode. Le skin legacy `style.css` n'est plus chargé.
- **PWA** : Service Worker (`static/sw.js`), manifest (`start_url=/v30/dashboard`), offline.html
- **Hébergement** : Cloudflare Tunnel → prospup.work, port 8000
- **Tests E2E** : Playwright (Chromium), 14+ specs desktop + mobile Pixel 5

## Architecture fichiers
```
app.py                  # Backend Flask monolithique — routes, API, auth, DB
routes/                 # Blueprints (ai.py, auth.py, deploy.py)
services/               # Logique métier (dashboard_goals.py)
templates/
  v30/                  # Templates v30 (dashboard, prospects, candidate_detail, …)
  _partials/            # Partials (v30/topbar, v30/sidebar, v30/palette, …)
static/
  css/
    v30/                 # Design system v30 (palette, components, tokens, *.css par page)
    mode-prosp.css       # Mode Prosp (deck 3D, autonome — réutilisé par /v30/mode-prosp)
    mobile-2026*.css     # Skin mobile commun (PWA)
  js/
    v30/                 # Tous les scripts v30 (un fichier par page + utilitaires)
    sidebar.js           # Sidebar mobile (déclarative)
    v8-features.js       # SW, bottom nav, haptic
    mobile-2026.js       # Bottom nav v8 mobile
    notifications.js     # Push notifications
    metiers-data.js      # Données métiers statiques
    mode-prosp-tab.js    # Helper Mode Prosp
    xlsx.min.js          # SheetJS (import Excel)
  sw.js                  # Service Worker (network-first HTML/API, cache-first static)
  manifest.json          # PWA manifest (shortcuts, share_target — tous /v30/...)
scripts/                # Outils admin (supervisor, watchdog, audit)
tests/
  e2e/                   # Tests Playwright
  test_*.py              # Tests pytest (API, services)
  audit_multi_user.py    # Audit multi-user
sample/                 # Templates DOCX (dossier compétence)
pushs/                  # Templates push par catégorie
archives/v29/           # Code v29 archivé (templates legacy + page-*.js + app.js +
                        # opt-in.js). Non chargé par l'app — voir
                        # archives/v29/README.md pour la procédure de restauration.
```

## Migration v29 → v30 (v31.7)
- **20 routes legacy** (`/`, `/dashboard`, `/sourcing`, `/candidat`, `/entreprises`, `/push`, `/stats`, `/calendrier`, `/rapport`, `/focus`, `/duplicates`, `/snapshots`, `/activity`, `/help`, `/aide`, `/metiers`, `/users`, `/parametres`, `/collab`, `/dc-generator`, `/prospects/mode-prosp`) → **redirect 302** vers `/v30/...`. `/candidat?id=X` et `/dc-generator?candidate=X` extraient le query param et redirigent vers `/v30/candidat/<X>` ou `/v30/dc/<X>`.
- Toute autre URL legacy (sans équivalent v30) → 404 Flask par défaut.
- Aucune table SQL n'a été migrée — les données restent identiques, seule l'UI change.

## Auth
- Session cookie Flask (`session['user_id']`) + JWT Bearer (mobile)
- `@app.before_request` protège toutes les routes sauf `/login`, `/static`, `/api/auth/`
- Login via `POST /api/auth/login` avec `{username, password}` JSON
- Rôles : **admin** (3) et **editor** (2)
- Multi-tenant : `owner_id` sur chaque enregistrement ; DB isolée par user dans `data/user_<id>/prospects.db` si elle existe

## Workflow développement (IMPORTANT)
- **Branche unique** : toujours travailler directement sur `main`. Ne **jamais** créer de branches feature.
- **Cycle** : éditer → `git add` → `git commit` → `git push origin main`.
- **Fin de session** : si du code a été modifié, committer et pousser avant de rendre la main. Sinon le bouton « Mettre à jour et redémarrer » du PC hébergeur n'aura rien à tirer.
- **Déploiement hébergeur** : bouton « Mettre à jour et redémarrer » dans Paramètres (admin). Le flux SSE affiche les logs git puis recharge automatiquement.
- **Rollback** : bouton dans Paramètres ou depuis la page 404 (restart intégré).
- **En cas de divergence** : le flux de pull fait un `git pull --ff-only`, et en cas d'échec fait un `git reset --hard origin/main` + snapshot DB préalable.

## Conventions
- `APP_VERSION` dans [app.py:38](app.py) — incrémenter à chaque release.
- Cache-busters auto : app.py hash MD5 des statiques au démarrage et remplace `?v=XXXX` dans le HTML.
- Pas de bundler/build — fichiers servis directement par Flask.
- Scripts HTML avec `defer` partout (sauf Chart.js CDN dans stats.html).
- Toast : `window.showToast(msg, type, duration)` — défini dans `static/js/v30/toast.js`, chargé globalement par `templates/v30/base.html`.
- IA : `window.callOllama(prompt, { stream, timeoutMs, model, webSearch })` — helper non-streaming dans `static/js/v30/ollama.js` (proxy vers `POST /api/ollama/generate`). Streaming SSE → fetch direct sur `/api/ollama/generate-stream`.
- Haptic : `window.haptic(ms)` dans `static/js/v8-features.js` (mobile uniquement).
- **Pas de `cache: 'no-store'`** sur les fetch — le SW et les headers Cache-Control gèrent déjà.

## Mise à jour depuis l'app (gestion Git)
- **Bouton « Mettre à jour et redémarrer »** : Paramètres > Mise à jour du serveur (admin). Flux SSE temps réel.
- **Routes API** :
  - `POST /api/deploy/pull` — pull streaming + restart (SSE)
  - `POST /api/deploy/pull-from-404` — pull depuis la page 404 (accessible sans auth)
  - `POST /api/deploy/rollback` — rollback via `.last_commit_hash`
  - `GET /api/deploy/health` — health check
- **Flux** : auto-checkout main → fetch origin main → save `.last_commit_hash` → snapshot DB (`before_update`) → stash locales → `git pull --ff-only` (fallback `git reset --hard`) → `_schedule_restart(delay=10.0)` → reload front.
- **Badge version/commit** : Paramètres > À propos, refresh auto toutes les 30 s.

## Versions mobile / desktop
- **Détection** : `window.matchMedia('(max-width: 900px)')`.
- **Nav desktop** : sidebar fixe à gauche (`sidebar.js` déclaratif, role-aware).
- **Nav mobile** : bottom nav fixe (Dashboard, Prospects, Focus, Calendrier, Push) + hamburger pour la sidebar complète.
- **Rendu adaptatif** :
  - Prospects : tableau 13 colonnes (desktop) vs cartes (`prospect-card-mobile`).
  - Entreprises : liste vs cartes.
  - Dashboard : grille vs colonne.
- **Interactions mobile uniquement** : swipe-to-action, pull-to-refresh, haptic.
- **Drag & drop** : desktop (mousedown) + mobile (touchstart) unifiés — widgets dashboard, tâches.

## Multi-user
- `ROLE_LEVELS = {'admin': 3, 'editor': 2}`.
- `@role_required('admin')` pour routes sensibles (deploy, config IA, users).
- `owner_id` sur chaque ligne ; requêtes filtrées automatiquement.
- `_prospect_owned()` / `_company_owned()` / `_candidate_owned()` pour les modifs.
- DB isolée : si `data/user_<id>/prospects.db` existe → utilisée, sinon fallback DB principale avec filtre `owner_id`.
- Migration au démarrage : `_migrate_all_user_dbs()` ajoute `deleted_at` aux DB user + nettoie les dossiers orphelins.

## IA — Ollama + Tavily
- **Ollama** (local, gratuit, `http://127.0.0.1:11434`) : génération de texte.
- **Tavily** (cloud, optionnel) : recherche web pour enrichir prompts. Config dans Paramètres > Configuration IA (persisté `data/ai_config.json`, gitignored).
- **Flux web_search** : Tavily → injecte résultats dans le prompt → Ollama génère → citations Tavily.
- **Routes** : `POST /api/ollama/generate`, `POST /api/ollama/generate-stream`, `GET|POST /api/ai/config`, `POST /api/ai/test`.
- **Front** : `window.callOllama(prompt, { webSearch: true })` (`static/js/v30/ollama.js`) active le routing web.
- **Variables env** (override par UI) : `OLLAMA_URL`, `OLLAMA_MODEL` (défaut `llama3.2`), `OLLAMA_TIMEOUT` (120 s), `TAVILY_API_KEY`.

### Entrées IA
| Où | Bouton | Comportement |
|----|--------|--------------|
| Prospects (ligne) | Scrapping IA | Prompt enrichissement → modale → analyse → apply |
| Entreprise | Scrapping IA | Prompt entreprise |
| Candidat | Scrapping IA | Prompt candidat |
| Prospects (RDV) | Avant réunion IA | Analyse LinkedIn → PDF fiche prépa |
| Prospects | Après réunion IA | Prompt compte-rendu → JSON → apply |
| Prospects (barre bulk) | Email IA / Tel IA | Bulk generation |
| Prospects | Ajout IA | Quick Add (prospect / entreprise / candidat) |
| Import Excel | Suggérer mapping | JSON header→champ |
| Import Excel | Reformater champ | Normalisation une valeur/ligne |

## Import Excel
- Champs : Nom, Prénom (combinés), Entreprise, Site, Fonction, Téléphone (fusion multi-colonnes), Email, LinkedIn, Notes, Tags, Pertinence, Statut, Date dernier contact.
- Auto-mapping : header guessing inline dans `static/js/v30/prospects.js` (chargement de `xlsx.min.js` à la demande).
- Fixture : [tests/fixtures/fichier_prosp_test_user.xlsx](tests/fixtures/fichier_prosp_test_user.xlsx).

## Commandes
```bash
python app.py                       # Dev (port 8000, debug)
python app.py --prod                # Prod (Waitress)
python scripts/supervise_prospup.py # Superviseur (crash loop detection + rollback auto + health check)
python scripts/watch-prospup.py --loop  # Watchdog : relance si prospup.work tombe
npx playwright test                 # Tests E2E (14 specs)
python minify.py                    # Minification CSS/JS (optionnel)
python -m tests.audit_multi_user    # Audit isolation multi-user (PYTHONIOENCODING=utf-8 requis)
```

## Superviseur & fiabilité
- **Problème historique** : deux pushs simultanés sur `main` → pull fail → crash → 502.
- **Solutions empilées** :
  1. Git pull avec fallback `reset --hard` (app.py routes deploy).
  2. Auto-checkout main avant tout pull.
  3. Restart auto depuis page 404.
  4. Superviseur v2 (scripts/supervise_prospup.py) : crash loop detection (3 crashs / 120 s), rollback auto, health check.
  5. Page 404 avec retry + countdown.
- **Env superviseur** : `PROSPUP_CRASH_THRESHOLD` (3), `PROSPUP_CRASH_WINDOW` (120), `PROSPUP_HEALTH_PORT` (8000), `PROSPUP_HEALTH_TIMEOUT` (30), `PROSPUP_GRACE_PERIOD` (8).

## Dépendances
- **Python** : voir [requirements.txt](requirements.txt) — flask, openpyxl, waitress, pypdf, python-docx, reportlab, apscheduler. `rjsmin`/`csscompressor` ne servent que pour `minify.py` (optionnel).
- **Node** : voir [package.json](package.json) — `@playwright/test` uniquement (devDependency pour les tests E2E).

## UX standardisée
- Messages utilisateur : `showToast()` pour info/erreur/warning, `alert()` uniquement pour confirmations critiques (destructives).
- Libellés : `Enregistrer` pour sauvegarde, `Ajouter` uniquement pour ouvrir une modale.
- Champs obligatoires : classe CSS `.required`.
- États : skeletons loader ou « Chargement… ».
- Vide : « Aucun {élément} pour ces filtres » partout.
- Accessibilité : `role="dialog"`, `aria-modal="true"`, `aria-label` sur boutons icône, Escape ferme les modales.

## Points d'attention
- Dossier sur OneDrive — chemins avec espaces, toujours quoter.
- Python 3.14, encodage console cp1252 → `PYTHONIOENCODING=utf-8` pour Playwright et scripts avec caractères spéciaux.
- Identifiants par défaut : `admin / admin` (configurables via `PROSPUP_USER` / `PROSPUP_PASS`).
- Pas de `cache: 'no-store'` sur les fetch.
- `node_modules/` n'est **pas** versionné (ajouté au .gitignore au nettoyage v29.6). Si vous clonez fraîchement : `npm install` avant de lancer les tests.
- `backups/`, `snapshots/`, `logs/`, `data/` sont gitignored (runtime local).

## Fichiers Claude annexes
- [.claude/WORKFLOW.md](.claude/WORKFLOW.md) — workflow Git + tests + review avant commit.
- [.claude/CHEATSHEET.md](.claude/CHEATSHEET.md) — commandes et patterns fréquents.

## Documentation annexe
- [docs/MODE_EMPLOI.md](docs/MODE_EMPLOI.md) — guide utilisateur
- [docs/GUIDE_TUNNEL.md](docs/GUIDE_TUNNEL.md) — Cloudflare Tunnel
- [docs/DEPLOY_UPDATE.md](docs/DEPLOY_UPDATE.md) — flux de mise à jour
- [docs/MISE_A_JOUR_PC_HEBERGEUR.md](docs/MISE_A_JOUR_PC_HEBERGEUR.md) — PC hébergeur
- [docs/AUDIT_SECURITE.md](docs/AUDIT_SECURITE.md) — audit sécurité
- [docs/AUDIT_UI_NAVIGATION.md](docs/AUDIT_UI_NAVIGATION.md) — audit UI
- [docs/AUDIT_MODE_PROSP_ARCHITECTURE.md](docs/AUDIT_MODE_PROSP_ARCHITECTURE.md) — architecture Mode Prosp
