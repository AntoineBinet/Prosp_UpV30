# Texte prêt pour la PR v30

Copie le **titre** et le **body** ci-dessous dans GitHub quand tu crées la PR.

---

## Titre (à coller dans le champ "Add a title")

```
feat(v30): release 30.0 complète — 18 routes, rapport WYSIWYG, nav clavier
```

---

## Body (à coller dans le champ "Leave a comment")

## Résumé

Release **v30.0** complète de ProspUp. Cette PR finalise la refonte UX (design
system OKLCH, palette ⌘K, sidebar, topbar) et migre **10 pages legacy** restantes
vers `/v30/*`, ajoute les **migrations DB** additives (push campaigns, skills,
availability, saved_views enrichi), un **rapport WYSIWYG** dans `/v30/stats`, et
la **navigation clavier J/K/X/E/Enter** sur les tables.

- APP_VERSION `29.7` → **`30.0`**
- 28 commits, 18 routes `/v30/*` opérationnelles
- Backup DB automatique avant toute migration additive (voir `docs/ROLLBACK_V30.md`)
- v29 reste 100 % fonctionnelle (opt-in/out via localStorage + bouton "v29" dans la sidebar v30)

## Points clés par phase

### Phase 1 — Filet

- Service Worker bumpé (`prospup-v30.0-beta-shell-3`) avec les 13 CSS + 16 JS v30 pré-cachés
- 5 specs Playwright v30 critiques (dashboard, prospects, fiche, palette, shortcuts)

### Phase 2 — Migrations DB & API

- `scripts/v30_backup.py` : `data/backups/v30_migration/<stamp>/` avec `manifest.json`
- `_migrate_v30_all()` au démarrage, idempotent :
  - `push_campaigns` + `push_logs.campaign_id`
  - `candidate_skills` (level 1-5, backfill depuis `candidates.tech`)
  - `candidate_availability` (week_iso + status libre|busy|placed)
  - `saved_views` enrichi (owner_id, filters_json, columns_json, is_shared)
- Endpoints `/api/push-campaigns` CRUD + `/recipients-preview` + `/send`
- Endpoints `/api/candidates/<cid>/{skills,availability}` CRUD
- Front branché : push wizard 3 étapes, pills saved_views, skills/dispo cliquables

### Phase 3 — 10 pages legacy migrées vers v30

`/v30/rapport`, `/v30/users`, `/v30/parametres`, `/v30/snapshots`, `/v30/activity`,
`/v30/metiers`, `/v30/help`, `/v30/collab`, `/v30/duplicates`, `/v30/dc`.
Sidebar, palette ⌘K, shortcuts (G+R, G+A, G+H), opt-in mis à jour.

### Phase 4 — Rapport WYSIWYG dans /v30/stats

- Document centré éditable, sections auto (KPI, Top entreprises, Top pushés, sparkline trend)
- Autosave localStorage (clé `prospup_rapport_<YYYY-Wnn>`)
- Export PDF via nouveau `POST /api/rapport/export-pdf` (ReportLab, parse markdown)

### Phase 5 — Navigation clavier tables

- `static/js/v30/table_nav.js` : J/K/X/E/Enter sur `[data-v30-table-nav]`
- Branché sur `/v30/prospects` et `/v30/entreprises`

### Phase 6 — Finalisation

- APP_VERSION → 30.0
- 13 specs Playwright v30 au total

## Test plan

- [ ] Login admin → dashboard v30 → palette ⌘K → teste une navigation
- [ ] `/v30/push` : clique Nouvelle campagne → wizard 3 étapes → envoie
- [ ] `/v30/prospects` : pills Tous/Mes/Hot, sauvegarde une vue, supprime-la
- [ ] `/v30/prospects` : J, K, X, E, Enter avec des lignes réelles
- [ ] `/v30/candidat/<cid>` : clic sur barres de skill change le niveau, clic sur
  cellules dispo cycle libre → busy → placed
- [ ] `/v30/stats` → onglet Rapport → édite les zones → export PDF
- [ ] Teste opt-out v30 → v29 → "Essayer la v30" dans paramètres v29 → retour v30
- [ ] Vérifier que les routes legacy (`/dashboard`, `/push`, etc.) fonctionnent

## Captures suggérées

Desktop 1280px + Mobile Pixel 5, light + dark : dashboard, prospects (3 vues),
fiche prospect, entreprises, sourcing, candidat, push + wizard ouvert, stats +
rapport, focus, calendrier, paramètres, palette ⌘K ouverte, help modal.

## Rollback

Voir `docs/ROLLBACK_V30.md`. Les backups sont dans
`data/backups/v30_migration/<timestamp>/`. Les migrations sont **additives**
(aucun DROP, aucun RENAME), donc un rollback ne devrait pas être nécessaire.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
