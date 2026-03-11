# Prompt pour mettre à jour prospup.work en production

## Contexte
- Les corrections ont été poussées sur `main`
- Le serveur en production (prospup.work) doit être mis à jour
- **IMPORTANT** : Le pull automatique a été désactivé. Les mises à jour se font maintenant via le bouton "Mettre à jour et redémarrer" dans les paramètres de l'application (section admin)

## Tâche à exécuter

**Sur le PC qui héberge prospup.work, dans le dossier du projet ProspUp :**

1. **Vérifier l'état actuel :**
   - Vérifier sur quelle branche on est (`git branch --show-current`)
   - Vérifier si le superviseur tourne (processus `supervise_prospup.py` ou `python app.py --prod`)
   - Vérifier l'état du dépôt git (`git status`)

2. **Mettre à jour le code (méthode recommandée) :**
   - Se connecter à l'application (prospup.work)
   - Aller dans les Paramètres (section admin)
   - Cliquer sur le bouton "Mettre à jour et redémarrer"
   - Le serveur va automatiquement faire un `git pull` et redémarrer si nécessaire

   **Alternative (méthode manuelle) :**
   - S'assurer qu'on est sur `main` (`git checkout main` si nécessaire)
   - Faire un pull depuis origin/main (`git pull origin main`)
   - Le superviseur redémarrera automatiquement si des changements sont détectés

4. **Vérifier que ça fonctionne :**
   - Tester que `/api/app-version` répond correctement (plus d'erreur 405)
   - Vérifier dans le navigateur que la pastille de version dans "À propos" s'affiche correctement

## Méthode recommandée (via l'interface web)

1. Se connecter à prospup.work
2. Aller dans Paramètres (section admin)
3. Cliquer sur "Mettre à jour et redémarrer"
4. Attendre la confirmation de mise à jour

## Méthode alternative (ligne de commande)

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

# 4. Le superviseur redémarrera automatiquement si des changements sont détectés
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
