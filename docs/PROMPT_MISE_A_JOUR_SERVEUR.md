# Prompt pour mettre à jour prospup.work en production

## Contexte
- Les corrections pour l'erreur 405 sur `/api/app-version` et la CSP ont été poussées sur `main` il y a quelques minutes
- Le serveur en production (prospup.work) n'a pas encore récupéré les changements
- Le superviseur (`supervise_prospup.py`) devrait normalement faire le pull automatiquement toutes les 90 secondes, mais ça ne semble pas avoir fonctionné

## Tâche à exécuter

**Sur le PC qui héberge prospup.work, dans le dossier du projet ProspUp :**

1. **Vérifier l'état actuel :**
   - Vérifier sur quelle branche on est (`git branch --show-current`)
   - Vérifier si le superviseur tourne (processus `supervise_prospup.py` ou `python app.py --prod`)
   - Vérifier l'état du dépôt git (`git status`)

2. **Mettre à jour le code :**
   - S'assurer qu'on est sur `main` (`git checkout main` si nécessaire)
   - Faire un pull depuis origin/main (`git pull origin main`)
   - Vérifier que les changements sont bien arrivés (le commit devrait être `070220a` ou plus récent)

3. **Vérifier/Redémarrer le serveur :**
   - Si le superviseur tourne, il devrait redémarrer automatiquement après le pull
   - Si le superviseur ne tourne pas, le redémarrer avec : `python scripts/supervise_prospup.py`
   - Vérifier que le serveur répond correctement après redémarrage

4. **Vérifier que ça fonctionne :**
   - Tester que `/api/app-version` répond correctement (plus d'erreur 405)
   - Vérifier dans le navigateur que la pastille de version dans "À propos" s'affiche correctement

## Commandes à exécuter (dans l'ordre)

```bash
# 1. Vérifier l'état
cd "CHEMIN_VERS_LE_PROJET_PROSPUP"
git branch --show-current
git status

# 2. Mettre à jour
git checkout main
git pull origin main

# 3. Vérifier que les changements sont arrivés
git log --oneline -3

# 4. Vérifier/Redémarrer le superviseur
# Si le superviseur tourne déjà, il devrait redémarrer automatiquement
# Sinon, le lancer avec :
python scripts/supervise_prospup.py
```

## Fichiers modifiés à vérifier

Les corrections sont dans `app.py` :
- Ligne ~6485 : La route `/api/app-version` doit être `@app.route("/api/app-version", methods=["GET"])` (pas `@app.get()`)
- Ligne ~138-146 : La CSP doit inclure `https://cdnjs.cloudflare.com` dans `script-src`

## Résultat attendu

Après la mise à jour :
- ✅ L'erreur 405 sur `/api/app-version` doit disparaître dans la console du navigateur
- ✅ La pastille de version dans "À propos" doit s'afficher correctement avec la version et le hash du commit
- ✅ Plus d'erreurs CSP pour le script xlsx

## Si ça ne fonctionne pas

- Vérifier les logs du superviseur pour voir s'il y a des erreurs
- Vérifier que le worktree est propre (pas de modifications non commitées qui bloquent le pull)
- Vérifier la connexion réseau vers GitHub
- Vérifier que le serveur Flask/Waitress répond bien après redémarrage
