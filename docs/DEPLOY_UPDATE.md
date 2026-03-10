# Mise à jour via le bouton « Mettre à jour et redémarrer »

Le bouton dans **Paramètres (admin)** déclenche : `git fetch` → détection des modifs locales → préparation du pull → `git pull --ff-only origin main` → redémarrage du serveur.

## Comportement

1. **Déjà à jour** : si `origin/main` est au même commit que `HEAD`, le flux renvoie « Déjà à jour » sans pull ni redémarrage.
2. **Fichiers sous `logs/`** : pour éviter les échecs dus aux fichiers de log verrouillés par l’app, tout fichier suivi sous `logs/` est temporairement marqué `assume-unchanged` avant le pull, puis restauré après. Les logs ne bloquent plus la mise à jour.
3. **Autres modifications locales** : si des fichiers (hors `logs/`) sont modifiés, un `git stash push` est effectué avant le pull. En cas d’échec du stash (fichier verrouillé ailleurs), l’erreur est affichée et le flux s’arrête ; restaurer le dépôt à la main si besoin (fermer les processus qui tiennent les fichiers, ou annuler les modifs).
4. **Pull non fast-forward** : si `git pull --ff-only` échoue (historique divergent, conflits), le message d’erreur Git est affiché. Il faut alors mettre à jour à la main sur le PC hébergeur (`git pull` ou merge/rebase) puis relancer l’app.
5. **Timeout** : fetch/pull ont des timeouts (15 s) ; en cas de dépassement, un message d’erreur est envoyé.

## Bonnes pratiques

- **`logs/`** est dans `.gitignore` ; les fichiers de log ne sont pas versionnés, ce qui évite les conflits et les blocages.
- Travailler toujours sur `main`, committer et pousser après les changements pour que le serveur puisse faire un pull propre.
- En cas d’échec du bouton, mettre à jour en SSH/bureau sur le PC hébergeur : `git pull --ff-only origin main` puis redémarrer l’app (ou le superviseur).

## Test du flux

Avec identifiants admin :

```bash
PROSPUP_DEPLOY_TEST_USER=admin PROSPUP_DEPLOY_TEST_PASS=... python -m tests.test_deploy_flow
```

Sans ces variables, le test est ignoré (skip).
