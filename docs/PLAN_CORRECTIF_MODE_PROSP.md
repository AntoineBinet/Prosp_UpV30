# Plan de correction - Mode Prosp

## Bugs identifiés et corrections à apporter

### Bug 1 : Conflit `?open=` et reprise de session
**Localisation :** Lignes 11375-11395
**Problème :** Si l'URL contient `?open=123` et qu'une session prosp existe, `viewDetail(123)` est exécuté puis `resumeProspSession()` écrase la fiche.
**Solution :** Ne pas appeler `resumeProspSession()` si `?open=` est présent dans l'URL.

### Bug 2 : `_syncProspCurrent(id)` dans `saveAndNext` après filtrage
**Localisation :** Lignes 5321-5324
**Problème :** Après `saveDetail` (qui appelle `filterProspects`), `_syncProspCurrent(id)` peut réassigner `currentId = id` alors que `id` n'est plus dans `_prospSession.ids`.
**Solution :** Vérifier que `id` est toujours dans `_prospSession.ids` avant de sync, sinon utiliser la logique de `syncProspSessionWithFilteredList`.

### Bug 3 : Restauration du scroll avant `filterProspects`
**Localisation :** Lignes 9687-9694
**Problème :** En sortie du mode prosp, on restaure le scroll avant `filterProspects()`, donc le DOM n'est pas encore à jour.
**Solution :** Restaurer le scroll après `filterProspects()` dans un callback ou après le rendu.

### Bug 4 : Reprise automatique sur `visibilitychange`
**Localisation :** Lignes 9805-9818
**Problème :** Quand l'onglet redevient visible, si une session existe et `_currentView !== 'prosp'`, on appelle `resumeProspSession()`. Si l'utilisateur a quitté volontairement, on le force à y revenir.
**Solution :** Ajouter un flag `_prospManuallyExited` qui est mis à `true` quand on sort volontairement du mode prosp, et ne pas reprendre automatiquement si ce flag est `true`.

### Bug 5 : Capture du scroll sur élément masqué
**Localisation :** Lignes 5108-5113, 4877-4885
**Problème :** En mode prosp, la table est masquée. `_captureProspectsScrollState` lit `tableView.scrollTop` sur un élément masqué.
**Solution :** Capturer le scroll avant de masquer la table dans `switchTableKanban`.

### Bug 6 : `goToProspPrev` ne sauvegarde pas la session
**Localisation :** Lignes 5352-5358
**Problème :** `goToProspPrev` ne sauvegarde pas la session. La sauvegarde se fait via `visibilitychange` / `pagehide`, donc la session peut être légèrement en retard.
**Solution :** Appeler `_saveProspSessionToStorage()` après la mise à jour de `_prospSession`.

## Ordre de correction

1. Bug 5 (capture scroll avant masquage) - Prérequis pour les autres
2. Bug 4 (flag sortie volontaire) - Prérequis pour Bug 1
3. Bug 1 (conflit ?open=)
4. Bug 2 (syncProspCurrent)
5. Bug 3 (restauration scroll)
6. Bug 6 (sauvegarde goToProspPrev)
