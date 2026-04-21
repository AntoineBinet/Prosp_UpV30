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
- [~] **Push** (`screens/push.jsx` → `templates/v30/push.html`) — route `/v30/push`. **Templates + Historique branchés** sur `/api/templates` et `/api/data`. **Campagnes** : empty state + wizard preview non interactif (demande migration DB `push_campaigns`, SPEC §5.2, en attente de validation user).
- [x] **Sourcing** (`screens/sourcing.jsx` → `templates/v30/sourcing.html`) — route `/v30/sourcing`. Kanban 5 statuts (mapping défensif sur `candidates.status`) + vue Grille. Branché sur `GET /api/candidates`.
- [x] **Fiche candidat** (`prospect-detail.jsx` candidate variant → `templates/v30/candidate_detail.html`) — route `/v30/candidat/<cid>`. Header éditable inline + Compétences (barres 1-5) + Dispo 8 semaines (dérivée du status) + Missions (via `/api/candidates/<id>/experiences`) + Notes éditables. Niveaux réels / vraie dispo / matching par campagne = migrations DB futures.
- [~] **Stats + Rapport** (`screens/stats.jsx` → `templates/v30/stats.html`) — route `/v30/stats`. Topbar + period filter + 4 KPI + Top entreprises hydratés. Les 8 charts Chart.js et l'éditeur Rapport WYSIWYG restent sur `/stats` et `/rapport` legacy en attendant migration complète.

## Écrans secondaires v30

- [x] **Focus** → `/v30/focus` (3 colonnes overdue / today / upcoming, hero éditorial)
- [x] **Calendrier** → `/v30/calendrier` (grille mois, nav < > Today, events RDV/relance/EC1)

## Étape 4 · Command Palette ⌘K

- [x] Composant `static/js/v30/palette.js` (`window.ProspPalette.open()`)
- [x] Endpoint `GET /api/search` (réutilise l'existant, pas besoin d'en créer)
- [x] Sections : Actions rapides · Aller à… · Résultats (Prospects + Entreprises + Candidats)
- [x] Raccourcis globaux : `⌘K` / `Ctrl+K` ouvrir, `↑↓` + `Enter` naviguer, `⌘+Enter` nouvel onglet, `Esc` fermer, action « Basculer thème »
- [x] Raccourcis chainés `G + {D,P,E,S,F,U,T}` (goto), `C` (créer), `[` (toggle sidebar), `?` (modal aide), `⌘B` (focus mode), `/` (palette alternative), `⇧T` (thème)
- [ ] Raccourcis tableaux `J/K/X/E` (nav lignes + select + edit) — à brancher quand les tables v30 implémenteront la nav clavier

## Étape 5 · Polish & QA

- [ ] Dark/light parité visuelle
- [ ] Toasts, skeletons, empty states cohérents
- [ ] Responsive desktop 1440 (rien ne doit casser <1280)
- [ ] Tests Playwright adaptés (14 specs)
- [~] Flag UI client-only (localStorage `prospup_ui_mode`) + bouton `v29` dans la sidebar v30 + bannière opt-in sur les pages legacy. Un flag serveur Flask reste à faire si on veut forcer le mode à la connexion.
- [ ] PR `feat/ui-v30` → `main` avec récap + captures light + dark

## Étape 6 · Back-office

- [ ] Migration DB : table `saved_views (id, owner_id, page, name, filters_json, columns_json, is_shared)`
- [ ] Migration DB : table `push_campaigns (id, owner_id, name, category_id, template_id, filters_json, scheduled_at, sent_at, stats_json)`
- [ ] Endpoint `POST /api/views/save` (vues custom prospects)
- [ ] Service Worker : refresh cache manifest avec nouveaux assets

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
