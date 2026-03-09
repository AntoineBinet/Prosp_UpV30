# ProspUp v21

CRM de prospection et sourcing pour ESN/ingenierie — Up Technologies.

## Fonctionnalites

- **Prospects** : gestion centralisee avec fiches enrichies (tags, notes, statuts, scores)
- **Mode Prosp** : defilement rapide fiche par fiche, optimise mobile (swipe, reprise de session)
- **Entreprises** : fiches entreprise avec opportunites et evenements
- **Focus** : file d'actions (relances, rappels) triee par echeance
- **Calendrier** : vue mensuelle/semaine des RDV et relances
- **Sourcing** : pipeline candidats avec matching par competences
- **Push** : envoi d'emails/LinkedIn avec templates et suivi
- **Stats & Rapport** : KPI, graphiques, rapport hebdomadaire exportable
- **Dashboard** : objectifs gamifies, XP, progression quotidienne/hebdomadaire
- **Multi-utilisateurs** : isolation par `owner_id`, base par utilisateur (`data/user_<id>/`)

## Demarrage rapide

### Prerequis
- Python 3.10+
- pip

### Installation

```bash
pip install -r requirements.txt
python app.py
```

Ouvrir http://127.0.0.1:8000 dans le navigateur.

### Windows

Double-cliquer sur `PROSPUP.bat` — installe les dependances, lance le serveur et active l'auto-deploiement (pull `main` + redemarrage auto en cas de nouvelle version).

Variables utiles (optionnelles) :
- `PROSPUP_DEPLOY_BRANCH` (defaut `main`)
- `PROSPUP_AUTO_DEPLOY_INTERVAL` en secondes (defaut `90`)

Compte initial : `admin / admin` (a changer immediatement).

### prospup.work inaccessible depuis l'iPhone ?

L'acces passe par un **tunnel Cloudflare** qui tourne sur le PC. Si le PC est eteint, en veille, ou si les fenetres ProspUp ont ete fermees, le tunnel s'arrete.

- **Relancer tout** : double-cliquer sur `RELANCE.bat` (fermer d'abord les fenetres Serveur + Tunnel si elles sont encore ouvertes).
- **Le serveur tourne deja** : lancer `RELANCE_TUNNEL_SEUL.bat` pour ne redemarrer que le tunnel.
- Details : `docs/GUIDE_TUNNEL.md`

## Structure du projet

```
ProspUp v21/
  app.py                 # Backend Flask (routes, auth, API, DB)
  index.html             # Page Prospects (principale)
  login.html             # Page de connexion
  dashboard.html         # Tableau de bord
  entreprises.html       # Gestion entreprises
  focus.html             # File d'actions (relances)
  calendrier.html        # Calendrier RDV/relances
  sourcing.html          # Pipeline candidats
  push.html              # Historique push emails/LinkedIn
  templates.html         # Categories push
  stats.html             # Statistiques
  rapport.html           # Rapport hebdomadaire
  parametres.html        # Parametres & export
  users.html             # Gestion utilisateurs (admin)
  static/
    css/style.css         # Feuille de style unique
    js/app.js             # JS principal (auth, data, mode Prosp)
    js/page-*.js          # Scripts specifiques par page
  services/
    dashboard_goals.py    # Logique objectifs/gamification
  docs/
    README.md             # Documentation detaillee
    CHANGELOG_v21.md      # Changelog v21
    MODE_EMPLOI.md        # Guide utilisateur
    GUIDE_TUNNEL.md       # Acces distant (Cloudflare)
  tests/                  # Tests automatises (pytest)
  pushs/                  # Templates push par categorie
  data/                   # Bases utilisateurs (runtime)
  snapshots/              # Sauvegardes DB (runtime)
  initial_data.json       # Donnees de demarrage (seed)
  requirements.txt        # Dependances Python
  PROSPUP.bat             # Lanceur Windows
```

## Multi-utilisateurs (resume direction)

- Chaque API metier est protegee par l'utilisateur connecte (`_uid()`).
- Les requetes de lecture/ecriture critiques filtrent les donnees par `owner_id`.
- La creation de compte initialise une base dediee `data/user_<id>/prospects.db`.
- Resultat : un utilisateur ne voit/modifie pas les prospects/candidats d'un autre.

## Changelog v21

Voir `docs/CHANGELOG_v21.md` pour le detail :
1. Mode Prosp mobile (defilement + reprise session avec fallback lastContact)
2. Revue visuelle (CSS harmonise, tables en cartes mobile, touch targets 44px)
3. Isolation multi-utilisateur (12+ endpoints securises, owner_id strict)
4. Depot propre (restructuration racine, .gitignore, version 21.0)

## Documentation

- `docs/README.md` — Documentation detaillee
- `docs/CHANGELOG_v21.md` — Changelog v21
- `docs/MODE_EMPLOI.md` — Guide utilisateur
- `docs/GUIDE_TUNNEL.md` — Acces distant (Cloudflare)
