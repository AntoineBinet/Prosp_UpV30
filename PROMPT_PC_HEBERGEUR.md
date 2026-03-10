# Prompt pour le PC hébergeur — Application de la mise à jour

## Contexte
Cette mise à jour remplace le système de pull automatique toutes les 90 secondes par un bouton manuel dans l'interface web. Le superviseur continue de lancer et surveiller le serveur, mais ne fait plus de pull automatique.

## Instructions pour Cursor sur le PC hébergeur

Copiez-collez ce prompt dans Cursor sur le PC qui héberge prospup.work :

---

**Prompt à donner à Cursor :**

```
Je dois appliquer une mise à jour sur le serveur ProspUp. Cette mise à jour remplace le système de pull automatique toutes les 90 secondes par un bouton manuel dans l'interface web.

Voici ce que je veux que tu fasses :
1. Vérifier que je suis sur la branche main : `git checkout main`
2. Faire un pull pour récupérer les dernières modifications : `git pull origin main`
3. Redémarrer le serveur ProspUp (si le superviseur est en cours, l'arrêter puis le relancer, ou simplement redémarrer l'application)

Le superviseur (`python scripts/supervise_prospup.py`) continue de fonctionner mais ne fera plus de pull automatique. Les mises à jour se feront désormais via un bouton "Mettre à jour et redémarrer" dans les paramètres de l'application (section admin, visible uniquement pour les administrateurs).

Après le redémarrage, je pourrai utiliser ce nouveau bouton pour les prochaines mises à jour.
```

---

## Vérification après application

Une fois la mise à jour appliquée et le serveur redémarré :

1. Connectez-vous à https://prospup.work en tant qu'administrateur
2. Allez dans **Paramètres** (menu latéral ou navigation)
3. Faites défiler jusqu'à la section **"🔄 Mise à jour du serveur"** (visible uniquement pour les admins)
4. Vous devriez voir le bouton **"🔄 Mettre à jour et redémarrer"**
5. Cliquez sur ce bouton pour tester la fonctionnalité (il vous demandera confirmation)

## Changements apportés

- ✅ **Nouveau bouton** dans les paramètres (section admin) pour déclencher manuellement un pull et redémarrage
- ✅ **Script superviseur modifié** : `scripts/supervise_prospup.py` ne fait plus de pull automatique, il lance juste le serveur et le surveille
- ✅ **Route API existante** : `/api/deploy/pull` (déjà présente, utilisée par le nouveau bouton)
- ✅ **Documentation mise à jour** : `CLAUDE.md` reflète les changements

## Avantages

- Contrôle total sur les mises à jour (pas de pull automatique non désiré)
- Possibilité de mettre à jour depuis n'importe où via l'interface web
- Le superviseur continue de surveiller et relancer le serveur en cas de crash
- Confirmation avant chaque mise à jour pour éviter les erreurs
