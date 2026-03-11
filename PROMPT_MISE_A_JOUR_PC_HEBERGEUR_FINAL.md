# Prompt pour mettre à jour le PC hébergeur Prosp'Up (une fois pour toutes)

## Contexte
Le système de pull automatique toutes les 90 secondes a été complètement supprimé et remplacé par un bouton manuel dans l'interface web. Cette mise à jour doit être appliquée sur le PC qui héberge prospup.work pour que le nouveau système fonctionne.

## Tâche à exécuter

**Sur le PC qui héberge prospup.work, dans le dossier du projet Prosp'Up :**

### 1. Arrêter le superviseur (si il tourne)
- Fermer la fenêtre du superviseur ou arrêter le processus `supervise_prospup.py`
- Attendre quelques secondes que le serveur s'arrête complètement

### 2. Vérifier l'état du dépôt Git
```bash
cd "CHEMIN_VERS_LE_PROJET_PROSPUP"
git status
git branch --show-current
```

**Si `git status` montre des modifications non commitées :**
- Soit les committer si elles sont importantes
- Soit les stasher avec : `git stash push -m "Modifications locales avant mise à jour"`
- Soit les annuler avec : `git restore .` (ATTENTION : cela supprime les modifications non sauvegardées)

### 3. Mettre à jour le code
```bash
# S'assurer qu'on est sur main
git checkout main

# Récupérer les dernières modifications
git pull origin main

# Vérifier que les changements sont bien arrivés
git log --oneline -5
```

Vous devriez voir les commits récents incluant :
- "Changement du titre 'ProspUp' en 'Prosp'Up'"
- "Fix: Gestion automatique des modifications locales lors du pull"
- "Nettoyage: Suppression des références au pull automatique"

### 4. Redémarrer le superviseur
```bash
python scripts/supervise_prospup.py
```

Le superviseur va :
- Lancer le serveur Flask/Waitress
- Surveiller le processus et le relancer en cas de crash
- **NE PLUS faire de pull automatique** (c'est normal et voulu)

### 5. Vérifier que tout fonctionne
1. Ouvrir https://prospup.work dans un navigateur
2. Se connecter avec un compte admin
3. Aller dans **Paramètres** (section admin)
4. Vérifier que la section **"Mise à jour du serveur"** est visible
5. Vérifier que le bouton **"Mettre à jour et redémarrer"** est présent

### 6. Tester le nouveau système de mise à jour
1. Cliquer sur **"Mettre à jour et redémarrer"**
2. Confirmer l'action
3. Le système va :
   - Faire un `git fetch` puis `git pull`
   - Stasher automatiquement les modifications locales si nécessaire
   - Redémarrer le serveur si des changements sont détectés
4. Vérifier que la mise à jour s'est bien passée

## Résultat attendu

Après cette mise à jour :
- ✅ Le superviseur tourne et surveille le serveur
- ✅ **Plus de pull automatique toutes les 90s** (c'est normal)
- ✅ Le bouton "Mettre à jour et redémarrer" fonctionne dans les paramètres
- ✅ Les mises à jour futures se font uniquement via ce bouton
- ✅ Le titre de l'application affiche "Prosp'Up" au lieu de "ProspUp"

## Commandes complètes (copier-coller)

```bash
# 1. Aller dans le dossier du projet
cd "CHEMIN_VERS_LE_PROJET_PROSPUP"

# 2. Vérifier l'état
git status
git branch --show-current

# 3. Si des modifications locales existent, les stasher
git stash push -m "Modifications locales avant mise à jour"

# 4. Mettre à jour
git checkout main
git pull origin main

# 5. Vérifier les commits récents
git log --oneline -5

# 6. Redémarrer le superviseur
python scripts/supervise_prospup.py
```

## Important pour l'avenir

**Désormais, pour mettre à jour prospup.work :**
1. Les modifications sont poussées sur `main` (comme d'habitude)
2. Se connecter à prospup.work
3. Aller dans **Paramètres** (section admin)
4. Cliquer sur **"Mettre à jour et redémarrer"**
5. Le serveur se met à jour et redémarre automatiquement

**Plus besoin de :**
- ❌ Faire un `git pull` manuel sur le PC hébergeur
- ❌ Attendre 90 secondes pour le pull automatique
- ❌ Redémarrer manuellement le serveur

## Si ça ne fonctionne pas

1. **Erreur "modifications locales" lors du pull via le bouton :**
   - Le système stashe automatiquement maintenant, mais si ça échoue :
   - Aller sur le PC hébergeur et faire : `git stash push -m "Nettoyage"`
   - Réessayer le bouton

2. **Le bouton ne s'affiche pas :**
   - Vérifier que vous êtes connecté avec un compte **admin** (pas editor)
   - Vérifier que la route `/api/deploy/pull` existe dans `app.py`

3. **Le superviseur ne redémarre pas après le pull :**
   - Le superviseur redémarre automatiquement si l'app sort avec le code 42
   - Vérifier les logs du superviseur pour voir s'il y a des erreurs

## Notes techniques

- Le superviseur (`supervise_prospup.py`) ne fait plus de pull automatique
- La fonction `_auto_pull()` existe toujours dans le code mais n'est plus appelée
- Les variables d'environnement `PROSPUP_AUTO_DEPLOY` et `PROSPUP_AUTO_DEPLOY_INTERVAL` ne sont plus utilisées
- Le bouton utilise la route `/api/deploy/pull` qui gère automatiquement le stash des modifications locales
