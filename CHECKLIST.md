# ProspUp v30 — Checklist de migration UI

> Source : `update UX web app/handoff/HANDOFF.md` et `SPEC.md`.
> Branche : `claude/update-ux-handoff-docs-kF0YN`.

## Étape 1 · Design system

- [x] `static/css/v30/tokens.css` (OKLCH, light + dark)
- [x] `static/css/v30/components.css` (.btn .card .badge .status .table etc.)
- [x] Google Fonts (Inter · Instrument Serif · JetBrains Mono) via `base_v30.html`
- [x] Script d'init thème inline dans `<head>` de `base_v30.html`
- [x] `data-theme="dark"` par défaut sur `<html>`
- [ ] Archiver l'ancien CSS dans `static/css/legacy/` (à faire après validation screens)

## Étape 2 · Navigation globale

- [x] `templates/_partials/v30/icon.html` (macro SVG reproduisant `Icon` de `_chrome.jsx`)
- [x] `templates/_partials/v30/topbar.html` (breadcrumbs, ⌘K placeholder, Créer, bell, avatar)
- [x] `templates/_partials/v30/sidebar.html` (Navigate / Records / Épinglés, compteurs, footer)
- [x] `templates/_partials/v30/theme_toggle.html` (bouton soleil/lune + persistance localStorage)
- [x] Intégration dans `templates/v30/base.html` (`app-shell` + `app-body`)
- [x] Route preview `/v30/preview` pour valider le chrome

## Étape 3 · Écrans (ordre recommandé)

- [x] **Login** (`screens/login-palette.jsx` → `templates/v30/login.html`) — preview sur `/v30/login`, formulaire fonctionnel (POST `/api/auth/login`)
- [x] **Dashboard v3** (`screens/dashboard.jsx` → `templates/v30/dashboard.html`) — preview sur `/v30/dashboard`, hero + bento 2:2:1 (Action center · Pipeline · Goals ring SVG) + bento 1:1 (Priorités IA · Activité). **Branché sur `/api/dashboard` + `/api/dashboard/pipeline-stages` + `/api/tasks`** via `static/js/v30/dashboard.js`
- [x] **Prospects** (`screens/prospects.jsx` → `templates/v30/prospects.html`) — preview sur `/v30/prospects`. 3 vues Table/Kanban/Split + bulk bar. Branché sur `/api/search` (liste + fuzzy), `/api/prospects/bulk-status-tags`. Pagination offset-based. **Clic ligne → fiche legacy** pour l'instant, la fiche v30 arrive ensuite.
- [x] **Fiche prospect** (`prospect-detail.jsx` → `templates/v30/prospect_detail.html`) — route `/v30/prospect/<id>`. Header éditable inline, tabs Aperçu/Timeline/Push/IA, drawer IA 480px. Branchée sur `/api/prospect/timeline` + `/api/prospects/bulk-edit` pour l'edit-in-place. Clic liste → v30 (plus legacy).
- [x] **Entreprises** (`screens/entreprises.jsx` → `templates/v30/entreprises.html`) — route `/v30/entreprises`. Topbar + 4 KPI Instrument Serif + table 8 colonnes. Branché sur `GET /api/data`, agrégation par company_id (total / piped / won / lastContact). Recherche fuzzy client-side. Fiche entreprise dédiée (clic sur une ligne → `/v30/entreprise/<id>`) à faire.
- [x] **Push** (`screens/push.jsx` → `templates/v30/push.html`) — route `/v30/push`. **Templates + Historique + Campagnes** branchés. Table `push_campaigns` + endpoints CRUD + `/recipients-preview` + `/send`. Wizard 3 étapes (Cible → Message → Envoi) interactif.
- [x] **Sourcing** (`screens/sourcing.jsx` → `templates/v30/sourcing.html`) — route `/v30/sourcing`. Kanban 5 statuts (mapping défensif sur `candidates.status`) + vue Grille. Branché sur `GET /api/candidates`.
- [x] **Fiche candidat** (`prospect-detail.jsx` candidate variant → `templates/v30/candidate_detail.html`) — route `/v30/candidat/<cid>`. Header éditable inline + Compétences (barres 1-5 **cliquables**, tables `candidate_skills`) + Dispo 8 semaines (cycle `libre→busy→placed`, table `candidate_availability`) + Missions + Notes éditables.
- [x] **Stats + Rapport** (`screens/stats.jsx` → `templates/v30/stats.html`) — route `/v30/stats`. Topbar + period filter + 4 KPI + Top entreprises. **Onglet Rapport** : éditeur WYSIWYG complet (zones contenteditable, sections auto KPI/Top/Trend, autosave local, export PDF via `/api/rapport/export-pdf`). Les 8 charts Chart.js détaillés restent sur `/stats` legacy.

## Écrans secondaires v30

- [x] **Focus** → `/v30/focus` (3 colonnes overdue / today / upcoming, hero éditorial)
- [x] **Calendrier** → `/v30/calendrier` (grille mois, nav < > Today, events RDV/relance/EC1)
- [x] **Rapport** → `/v30/rapport` (topbar + KPI + activité + pipeline + notes WYSIWYG autosave)
- [x] **Utilisateurs** → `/v30/users` (admin) : cartes + modale CRUD
- [x] **Paramètres** → `/v30/parametres` : hub 8 cartes (opt-out v29 inclus)
- [x] **Snapshots** → `/v30/snapshots` (admin) : liste + create/restore/delete
- [x] **Activité** → `/v30/activity` (admin) : table filtrable paginée
- [x] **Collaboration** → `/v30/collab` : hub 3 cartes
- [x] **Doublons** → `/v30/duplicates` : hub 3 cartes
- [x] **Métiers IA** → `/v30/metiers` (admin) : liste + add/delete
- [x] **Aide** → `/v30/help` : 8 cartes + astuces + bouton raccourcis
- [x] **Dossier de compétence** → `/v30/dc[/<cid>]` : hub + lien vers /dc_generator

## Étape 4 · Command Palette ⌘K

- [x] Composant `static/js/v30/palette.js` (`window.ProspPalette.open()`)
- [x] Endpoint `GET /api/search` (réutilise l'existant, pas besoin d'en créer)
- [x] Sections : Actions rapides · Aller à… · Résultats (Prospects + Entreprises + Candidats)
- [x] Raccourcis globaux : `⌘K` / `Ctrl+K` ouvrir, `↑↓` + `Enter` naviguer, `⌘+Enter` nouvel onglet, `Esc` fermer, action « Basculer thème »
- [x] Raccourcis chainés `G + {D,P,E,S,F,U,T}` (goto), `C` (créer), `[` (toggle sidebar), `?` (modal aide), `⌘B` (focus mode), `/` (palette alternative), `⇧T` (thème)
- [x] Raccourcis tableaux `J/K/X/E/Enter` (nav lignes + select + edit + ouvrir) — branchés via `static/js/v30/table_nav.js` sur `/v30/prospects` et `/v30/entreprises`

## Étape 5 · Polish & QA

- [ ] Dark/light parité visuelle
- [ ] Toasts, skeletons, empty states cohérents
- [ ] Responsive desktop 1440 (rien ne doit casser <1280)
- [ ] Tests Playwright adaptés (14 specs)
- [~] Flag UI client-only (localStorage `prospup_ui_mode`) + bouton `v29` dans la sidebar v30 + bannière opt-in sur les pages legacy. Un flag serveur Flask reste à faire si on veut forcer le mode à la connexion.
- [ ] PR `feat/ui-v30` → `main` avec récap + captures light + dark

## Étape 6 · Back-office

- [x] Migration DB : `saved_views` enrichi (`owner_id`, `filters_json`, `columns_json`, `is_shared`, backfill depuis `state`)
- [x] Migration DB : table `push_campaigns` (+ index `owner_id`)
- [x] Migration DB : tables `candidate_skills` (UNIQUE candidate_id+name, level 1-5) + `candidate_availability` (UNIQUE candidate_id+week_iso)
- [x] Migration DB : `push_logs.campaign_id` (+ index)
- [x] Backup automatique avant migration (`scripts/v30_backup.py` + `docs/ROLLBACK_V30.md`)
- [x] Endpoint `POST /api/views/save` (déjà présent) + nouveau `DELETE /api/views/<id>`
- [x] Service Worker : refresh cache manifest avec nouveaux assets v30 (12 CSS + 15 JS)
- [x] Endpoints `/api/push-campaigns` (CRUD + recipients-preview + send)
- [x] Endpoints `/api/candidates/<cid>/skills` (CRUD) + `/availability` (CRUD)

---

## Règles de reproduction (rappel HANDOFF §4)

1. Fidélité pixel — tailles, espacements, weights, couleurs = JSX de référence
2. Toutes couleurs via tokens (`var(--text)`, etc.) — **aucun hex en dur**
3. Pas d'emoji, pas d'icônes inventées — SVG du dict `Icon` uniquement
4. Fonts : Inter (UI), Instrument Serif (grands chiffres éditoriaux), JetBrains Mono (numéros, mono)
5. Light ET dark doivent marcher à l'identique
6. Pas de nouvelle dépendance JS sans demander

## Interdits (rappel HANDOFF §5)

- ❌ Modifier le schéma DB ou les migrations sans demander
- ❌ Renommer / supprimer des routes Flask
- ❌ Ajouter un framework (React, Vue, Tailwind…)
- ❌ Toucher à l'auth ou aux permissions
- ❌ Force-push, rebase sur `main`, merge tout seul
- ❌ Inventer du contenu (copy, labels) — reprendre celui du JSX
