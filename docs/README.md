# ProspUp v21

**Application de gestion de prospects et prospection B2B** — Up Technologies (Embedded Systems, Électronique & Robotique).

---

## Nouveautés v21

- **Base de données fusionnée** : 463 prospects, 63 entreprises, 39 candidats (données v17 + schéma Cursor complet).
- **Cache busters unifiés** : tous les assets JS/CSS versionnés uniformément (v=2000).
- **Nettoyage projet** : scripts de correction archivés, structure optimisée.
- **Intégrité vérifiée** : 0 violation FK, 0 prospect orphelin, 18 tables, 19 index.
- **API versionnée** : `/api/auth/me` retourne la version de l'application.

## En bref

- **Dashboard** : vue d'ensemble, KPIs, objectifs personnalisables, relances.
- **Prospects & entreprises** : fiches, filtres avancés, import/export CSV/Excel, dédoublonnage.
- **Candidats & sourcing** : fiches candidats, matching compétences, checklist EC1.
- **Focus & calendrier** : prochaines actions, RDV, suivi pipeline.
- **Push & templates** : envoi email/LinkedIn, catégories, templates Outlook, historique.
- **Stats & rapports** : tableaux de bord, charts, rapport hebdomadaire, export.
- **Référentiel métiers** : 251 tags techniques en 15 catégories.
- **Multi-utilisateurs** : rôles (admin / éditeur / lecteur), isolation des données.
- **Accès distant** : tunnel HTTPS (Cloudflare), PWA mobile optimisée iPhone.
- **Mise à jour intégrée** : upload de fichiers, staging, rollback.

## Démarrage rapide

| Étape | Action |
|-------|--------|
| **Prérequis** | Python 3.10+ — voir MODE_EMPLOI.md pour l'installation détaillée. |
| **Lancer** | Double-clic sur `PROSPUP.bat` (Windows) ou `python app.py` en ligne de commande. |
| **Accès** | http://127.0.0.1:8000 (local) ou via tunnel (ex. prospup.work). |
| **Import** | `initial_data.json` est chargé automatiquement si la DB est vide. |

Documentation complète : MODE_EMPLOI.md (tunnel HTTPS, PWA, utilisateurs, FAQ).

## Run local (standard)

### 1) Installer les dépendances

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt pytest ruff
```

### 2) Lancer l'application

```powershell
python app.py
```

Application disponible sur `http://127.0.0.1:8000`.

### 3) Lancer les tests

```powershell
python -m pytest -q
```

Les tests API utilisent une base SQLite temporaire via `PROSPECTION_DB` et n'écrasent pas `prospects.db`.

### 4) Lancer le lint

```powershell
python -m ruff check tests
```

## Structure du projet

| Dossier / fichier | Rôle |
|-------------------|------|
| `app.py` | Backend Flask (API, auth, SQLite) — 6300+ lignes. |
| `services/` | Modules de logique métier extraits progressivement de `app.py` (phase 2 en cours). |
| `*.html` | 20 pages de l'application. |
| `static/css/` | Style glassmorphism (style.css). |
| `static/js/` | Modules JS : app.js, v8-features.js, page-*.js, metiers-data.js. |
| `static/` | Icônes, PWA manifest, service worker. |
| `pushs/` | Dossiers de CV/pushs par catégorie. |
| `scripts/_archive/` | Scripts de maintenance historiques. |
| `docs/_archive/` | Guides et rapports historiques. |
| `snapshots/` | Sauvegardes auto/manuelles de la DB. |

### Modularisation - phase 2

- Premier slice extrait vers `services/dashboard_goals.py` (helpers objectifs dashboard).
- Construction du payload goals (config + decoration daily/weekly) deplacee en service pour alleger `app.py`.
- `app.py` consomme ce module via import pour conserver les routes/reponses existantes.
- Tests unitaires ajoutes dans `tests/test_dashboard_goals_service.py`.

## Base de données

Base locale : `prospects.db` (créée au premier lancement ou depuis `initial_data.json`).

| Table | Données |
|-------|---------|
| prospects | 463 fiches |
| companies | 63 sites |
| candidates | 39 profils |
| push_logs | 57 envois |
| + 14 tables | templates, events, tasks, KPI, users, etc. |
