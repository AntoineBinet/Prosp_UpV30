# Mise à jour ProspUp sur le PC qui héberge

Pour que le correctif **« Générer avec Ollama (plusieurs) »** (erreur 405) et les origines CORS (403) soient actifs sur le PC qui héberge l’app :

## 1. Récupérer le code et redémarrer

Sur le PC qui héberge ProspUp (dans le dossier du projet) :

```bash
git checkout main
git pull --ff-only origin main
```

Puis **redémarrer l’application** :

- Si vous lancez à la main : arrêter puis relancer `python app.py --prod` (ou `python app.py` en dev).
- Si vous utilisez le superviseur (`scripts/supervise_prospup.py`) : il fait un pull puis redémarre ; vérifier qu’un cycle a bien eu lieu après le push, ou redémarrer le script une fois.

## 2. Côté navigateur

Après la mise à jour du serveur :

- **Rechargement forcé** de la page (Ctrl+F5 ou Ctrl+Shift+R) pour charger le nouveau `page-quickadd.js`.
- Ou vider le cache du site pour prospup.work.

Sans ça, l’ancien JS peut encore appeler le streaming et provoquer 405.

## 3. Si vous voyez « Erreur 403 » (Origine non autorisée)

L’app n’accepte que certaines origines (ex. `https://prospup.work`). Si vous accédez avec une autre URL (autre domaine, IP, ou `http://` au lieu de `https://`) :

- Soit utilisez **exactement** une URL déjà autorisée : `https://prospup.work` (sans slash final).
- Soit, sur le PC qui héberge, définissez la variable d’environnement **`PROSPUP_ALLOWED_ORIGINS`** avec l’URL que vous utilisez, par exemple :
  - `https://votredomaine.fr`
  - ou plusieurs URLs séparées par des virgules : `https://a.com,https://b.com`
  Puis redémarrez l’app.

## 4. Vérifier que le correctif est bien déployé

- Dans le dossier du projet sur le PC hébergeur : `git log -1 --oneline` doit montrer un commit du type :  
  `fix(quickadd): utiliser mode non-streaming pour Générer avec Ollama (plusieurs)`.
- Dans `static/js/page-quickadd.js`, vers la ligne 74–75, vous devez voir :  
  `const opts = multiple ? { timeoutMs: 300000, stream: false } : ...`

Si ces deux points sont OK et que vous avez fait un rechargement forcé, « Générer avec Ollama (plusieurs) » utilise bien le mode non-streaming et ne devrait plus provoquer l’erreur 405.
