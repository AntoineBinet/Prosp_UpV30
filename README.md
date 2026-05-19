# ProspUp

CRM de prospection et sourcing pour ESN/ingénierie — Up Technologies.

> Version courante : voir `APP_VERSION` dans `app.py` et [CHANGELOG.md](CHANGELOG.md).

## Fonctionnalités

- **Prospects** : gestion centralisée avec fiches enrichies (tags, notes, statuts, scores)
- **Mode Prosp** : défilement rapide fiche par fiche, optimisé mobile (swipe, reprise de session)
- **Entreprises** : fiches entreprise avec opportunités et évènements
- **Focus** : file d'actions (relances, rappels) triée par échéance
- **Calendrier** : vue mensuelle/semaine des RDV et relances
- **Sourcing** : pipeline candidats avec matching par compétences
- **Push** : envoi d'emails/LinkedIn avec templates et suivi
- **Stats & Rapport** : KPI, graphiques, rapport hebdomadaire exportable
- **Dashboard** : objectifs gamifiés, XP, progression quotidienne/hebdomadaire
- **IA** : enrichissement prospects via Ollama (local) + Tavily (recherche web)
- **Multi-utilisateurs** : isolation par `owner_id`, base par utilisateur (`data/user_<id>/`)

## Démarrage rapide

### Prérequis
- Python 3.10+
- pip
- (Optionnel) Node 18+ pour les tests E2E Playwright

### Installation

```bash
pip install -r requirements.txt
python app.py
```

Ouvrir http://127.0.0.1:8000 dans le navigateur.

### Windows (simple)

Double-cliquer sur `PROSPUP.bat` — installe les dépendances et lance serveur + tunnel Cloudflare.

Les mises à jour se font via le bouton **« Mettre à jour et redémarrer »** dans les paramètres de l'application (section admin).

Compte initial : `admin / admin` (à changer immédiatement).

### prospup.work inaccessible ?

L'accès passe par un **tunnel Cloudflare** qui tourne sur le PC hébergeur.
Si l'accès est coupé :
- **Relancer tout** : double-cliquer sur `RELANCE.bat`
- **Serveur OK, tunnel KO** : `RELANCE_TUNNEL_SEUL.bat`
- Détails : [docs/GUIDE_TUNNEL.md](docs/GUIDE_TUNNEL.md)

## Structure du projet

```
Prosp_UpV30/
├── app.py                 # Backend Flask monolithique — routes, API, auth, DB
├── routes/                # Blueprints (pages, ai, auth, deploy, calendar, …)
├── services/              # Logique métier (dashboard_goals, working_days, …)
├── templates/
│   ├── v30/               # Pages HTML (Jinja2) — toutes les vues
│   └── _partials/v30/     # Partials (topbar, sidebar, palette, …)
├── static/
│   ├── css/v30/           # Design system (tokens, components, *.css par page)
│   └── js/v30/            # Scripts par page + helpers (toast, ollama, …)
├── scripts/               # Outils admin (supervisor, audit, watchdog, …)
├── tests/
│   ├── e2e/               # Tests Playwright (v30-*.spec.js)
│   └── test_*.py          # Tests pytest (API, services)
├── docs/                  # Documentation
├── sample/                # Templates Word (dossier compétence)
├── pushs/                 # Templates push par catégorie (built-in + custom)
├── data/                  # Runtime — user DBs, photos, avatars (gitignored)
├── snapshots/             # Sauvegardes manuelles DB (gitignored)
├── backups/               # Sauvegardes auto DB (gitignored)
├── requirements.txt       # Dépendances Python
├── package.json           # Dépendances Node (Playwright uniquement)
├── playwright.config.js   # Config tests E2E
└── PROSPUP.bat            # Lanceur Windows
```

## Stack technique

- **Backend** : Flask + SQLite + Waitress (prod), ReportLab (PDF), python-docx (DOCX)
- **Frontend** : Vanilla JS (no framework), Chart.js (stats uniquement), xlsx.js (import Excel)
- **CSS** : Glassmorphism dark theme + light via `prefers-color-scheme`
- **PWA** : Service Worker + manifest + offline.html
- **Hébergement** : PC local + tunnel Cloudflare → prospup.work, port 8000
- **Tests** : Playwright (Chromium desktop + Pixel 5 mobile)

## Multi-utilisateurs (résumé)

- Chaque API métier filtre par `_uid()` (session cookie ou JWT Bearer).
- Lecture/écriture filtrent par `owner_id`.
- Création de compte → base dédiée `data/user_<id>/prospects.db`.
- Rôles : `admin` (3) et `editor` (2).

## IA (Ollama + Tavily)

- **Ollama** (local, gratuit) : génération de texte. Proxy vers `http://127.0.0.1:11434`.
- **Tavily** (cloud, optionnel) : recherche web pour enrichir les prompts. ~0.005$/recherche.
- Config : Paramètres > Configuration IA (admin). Persistée dans `data/ai_config.json` (gitignored).

## Commandes utiles

```bash
python app.py                      # Dev server (port 8000, debug=True)
python app.py --prod                # Prod avec Waitress
python scripts/supervise_prospup.py # Superviseur : crash loop detection + rollback
npx playwright test                 # Tests E2E
python minify.py                    # Minification CSS/JS (optionnel)
```

## Documentation

- [CLAUDE.md](CLAUDE.md) — Référence technique complète (architecture, conventions, workflow)
- [docs/MODE_EMPLOI.md](docs/MODE_EMPLOI.md) — Guide utilisateur
- [docs/GUIDE_TUNNEL.md](docs/GUIDE_TUNNEL.md) — Accès distant Cloudflare
- [docs/DEPLOY_UPDATE.md](docs/DEPLOY_UPDATE.md) — Flux de mise à jour
- [docs/MISE_A_JOUR_PC_HEBERGEUR.md](docs/MISE_A_JOUR_PC_HEBERGEUR.md) — Procédure PC hébergeur
- [docs/AUDIT_SECURITE.md](docs/AUDIT_SECURITE.md) — Audit sécurité
- [docs/AUDIT_UI_NAVIGATION.md](docs/AUDIT_UI_NAVIGATION.md) — Audit UI/navigation
- [docs/AUDIT_MODE_PROSP_ARCHITECTURE.md](docs/AUDIT_MODE_PROSP_ARCHITECTURE.md) — Architecture Mode Prosp
