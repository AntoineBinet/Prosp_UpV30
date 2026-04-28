# Archives v29

Archive figée de l'ancienne interface v29 (legacy) déprécisée à partir de la v31.7.

Ce dossier conserve le code historique au cas où :
- une régression v30 demanderait de revoir l'ancienne implémentation,
- une feature manquante en v30 devrait être réimportée,
- on aurait besoin d'auditer un comportement legacy.

## Contenu

- `templates/legacy/` — 22 templates Jinja2 v29 (~7 300 lignes)
- `static/js/` — 19 scripts (page-*.js + app.js global, ~15 300 lignes)

## Statut

**Non chargé par l'application.** Les routes Flask legacy (`/dashboard`, `/`,
`/sourcing`, `/candidat`, etc.) ont été remplacées par des redirects 302 vers
leurs équivalents `/v30/...`. Le manifest PWA, la sidebar et le flag
`?force_v29=1` ont été retirés.

Pour restaurer la v29 (à éviter — préfère corriger v30) :

```bash
git mv archives/v29/templates/legacy templates/legacy
git mv archives/v29/static/js/* static/js/
git revert <commit-deprecation-v29>
```
