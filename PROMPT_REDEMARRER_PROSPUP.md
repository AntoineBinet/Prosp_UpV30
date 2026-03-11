# Script pour redémarrer ProspUp sur le PC hébergeur

Copiez-collez ce prompt dans Cursor sur le PC qui héberge ProspUp :

---

**Redémarrer ProspUp et vérifier l'accès distant sur prospup.work**

1. Vérifier si le serveur ProspUp tourne (processus Python sur le port 8000)
2. Si le serveur tourne, l'arrêter proprement
3. Redémarrer ProspUp en mode production avec la commande : `python app.py --prod`
4. Vérifier que le serveur répond sur http://localhost:8000
5. Vérifier que le tunnel Cloudflare est actif et que prospup.work pointe bien vers localhost:8000
6. Tester l'accès à https://prospup.work depuis le navigateur
7. Si tout fonctionne, confirmer que l'application est accessible à distance

Si le serveur ne démarre pas ou s'il y a des erreurs, afficher les logs d'erreur et proposer des solutions.

---
