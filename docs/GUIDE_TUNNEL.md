# 🌐 Guide : Accéder à ProspUp depuis Internet

## Résumé

Ce guide vous permet d'accéder à votre CRM ProspUp **depuis n'importe où** (iPhone, PC externe, etc.) via une **adresse HTTPS fixe** comme `https://crm.prospup.work`.

**Technologie** : Cloudflare Tunnel (gratuit, sécurisé, aucun port à ouvrir)  
**Coût** : ~10€/an pour le nom de domaine  
**Temps de setup** : ~15 minutes

---

## Prérequis

| Élément | Détail |
|---------|--------|
| **Windows** | 10 ou 11 |
| **Python** | 3.10+ ([python.org](https://www.python.org/downloads/)) |
| **ProspUp** | Doit fonctionner en local (`http://localhost:8000`) |
| **Compte Cloudflare** | Gratuit sur [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) |
| **Nom de domaine** | ~10€/an (achetable directement sur Cloudflare) |

---

## Étape 1 — Acheter un domaine (5 min)

1. Allez sur [dash.cloudflare.com](https://dash.cloudflare.com)
2. Créez un compte si ce n'est pas déjà fait
3. Dans le menu latéral, cliquez **"Domain Registration"** → **"Register Domains"**
4. Cherchez un domaine (ex: `prospup.work`) ✅ **Déjà fait !**
5. Achetez-le (~10€/an, paiement par carte) ✅ **Déjà fait !**
6. Attendez que le domaine soit actif (quelques minutes)

> 💡 **Astuce** : Les domaines en `.fr` ou `.com` sont les plus courants. Cloudflare les vend **au prix coûtant** (pas de marge).

---

## Étape 2 — Configurer le tunnel (10 min)

### Option A : Script automatique (recommandé)

1. **Double-cliquez sur `SETUP_TUNNEL.bat`** dans le dossier ProspUp
2. Le script va :
   - ✅ Installer `cloudflared` automatiquement
   - ✅ Ouvrir votre navigateur pour vous connecter à Cloudflare
   - ✅ Créer le tunnel "prospup"
   - ✅ Vous demander votre sous-domaine (par défaut : `crm.prospup.work`)
   - ✅ Configurer le DNS automatiquement
   - ✅ Générer le fichier de configuration

3. À la fin, vous verrez :
   ```
   INSTALLATION TERMINEE !
   Votre CRM sera accessible sur : https://crm.prospup.work
   ```

> ⚠️ `SETUP_TUNNEL.bat` ne se lance qu'**une seule fois**. Ensuite, tout démarre avec `PROSPUP.bat`.

### Option B : Installation manuelle

Si le script ne fonctionne pas, suivez ces étapes manuellement :

```powershell
# 1. Installer cloudflared
winget install Cloudflare.cloudflared

# 2. Se connecter (ouvre le navigateur)
cloudflared login

# 3. Créer le tunnel
cloudflared tunnel create prospup

# 4. Configurer le DNS (remplacez par votre domaine)
cloudflared tunnel route dns prospup crm.prospup.work
```

5. Créez le fichier `C:\Users\VOTRE_NOM\.cloudflared\config.yml` :

```yaml
tunnel: prospup
credentials-file: C:\Users\VOTRE_NOM\.cloudflared\XXXXX.json

ingress:
  - hostname: crm.prospup.work
    service: http://localhost:8000
  - service: http_status:404
```

> ⚠️ Remplacez `XXXXX.json` par le vrai nom du fichier dans le dossier `.cloudflared`.

---

## Étape 3 — Lancement quotidien

**Double-cliquez `PROSPUP.bat`** — c'est tout !

Le script lance automatiquement :
- Le serveur ProspUp (Waitress, production) dans une fenêtre
- Le tunnel Cloudflare dans une seconde fenêtre (s'il est configuré)

Votre CRM est accessible sur `https://crm.prospup.work` 🎉

> Le tunnel se reconnecte automatiquement en cas de coupure réseau.

---

## Étape 4 — Démarrage automatique (optionnel)

Pour que ProspUp se lance **au démarrage de Windows** :

### Méthode simple (dossier Démarrage)

1. Appuyez `Win + R`
2. Tapez `shell:startup` et appuyez Entrée
3. Créez un **raccourci** vers `PROSPUP.bat`

→ Au prochain redémarrage, tout se lance automatiquement !

### Méthode avancée (Planificateur de tâches)

Pour un lancement silencieux en arrière-plan :

1. Ouvrez le **Planificateur de tâches** (recherchez "Planificateur" dans le menu Démarrer)
2. **Tâche 1 — Serveur** :
   - Nom : `ProspUp`
   - Déclencheur : Au démarrage, retarder 15 secondes
   - Action : Programme `C:\ProspUp\PROSPUP.bat`, Démarrer dans : `C:\ProspUp`

---

## Installer comme service Windows (avancé)

Pour une fiabilité maximale, cloudflared peut s'installer comme un **service Windows** :

```powershell
# En tant qu'administrateur :
cloudflared service install
```

Le tunnel démarrera automatiquement avec Windows, sans fenêtre visible, et redémarrera en cas de crash.

> Pour le désinstaller : `cloudflared service uninstall`

---

## Accès depuis iPhone (PWA)

1. Ouvrez **Safari** sur votre iPhone
2. Allez sur `https://crm.prospup.work`
3. Connectez-vous (admin / votre mot de passe)
4. Appuyez sur **Partager** (icône ⬆️) → **"Sur l'écran d'accueil"**
5. Nommez l'app **"ProspUp"** et appuyez **Ajouter**

→ ProspUp apparaît comme une **vraie app** sur votre écran d'accueil ! 📱

---

## Sécurité

| Protection | Détail |
|-----------|--------|
| **HTTPS** | Certificat SSL automatique géré par Cloudflare |
| **Chiffrement** | Trafic chiffré de bout en bout |
| **Pas de port ouvert** | Votre box Internet reste fermée |
| **Authentification** | Session ProspUp (login/mot de passe) |
| **DDoS** | Protection DDoS incluse par Cloudflare |

### Recommandations

- ⚠️ **Changez le mot de passe admin** par défaut (`admin`) immédiatement
- ⚠️ Utilisez un mot de passe **fort** (12+ caractères, chiffres, symboles)
- Créez des comptes séparés pour chaque utilisateur (rôle éditeur ou lecteur)

---

## Dépannage

### "cloudflared n'est pas reconnu"
→ Fermez et rouvrez votre terminal après l'installation.  
→ Ou ajoutez `C:\Program Files (x86)\cloudflared\` au PATH Windows.

### "Le tunnel ne se connecte pas"
→ Vérifiez votre connexion Internet.  
→ Vérifiez que le fichier `config.yml` existe dans `%USERPROFILE%\.cloudflared\`.  
→ Relancez `SETUP_TUNNEL.bat`.

### "Error 1033" (Cloudflare Tunnel)
→ Le tunnel n'est pas connecté. À faire dans l'ordre :
1. **Lancez `PROSPUP.bat`** et gardez **les deux fenêtres ouvertes** (serveur + tunnel).
2. Utilisez l'URL exacte configurée : **https://crm.prospup.work** ou **https://prospup.work** (pas une autre).
3. Si ça persiste : **relancez `SETUP_TUNNEL.bat`** une fois (il met à jour la config avec 127.0.0.1 et les bons hostnames), puis relancez `PROSPUP.bat`.

### "Le site affiche 502 Bad Gateway"
→ Le serveur ProspUp n'est pas lancé. Lancez `PROSPUP.bat`.

### "Le domaine ne fonctionne pas"
→ Le DNS peut prendre jusqu'à 5 minutes pour se propager.  
→ Vérifiez dans le dashboard Cloudflare que le CNAME est bien créé.

---

## Architecture

```
iPhone/PC externe
       ↓ HTTPS
   Cloudflare CDN (gratuit, mondial)
       ↓ Tunnel chiffré
   cloudflared (sur votre PC)
       ↓ HTTP local
   ProspUp (localhost:8000)
       ↓
   SQLite (prospects.db)
```

Aucun port n'est ouvert sur votre box. Le tunnel est **sortant uniquement** — c'est votre PC qui se connecte à Cloudflare, pas l'inverse.

---

*ProspUp v21 — Up Technologies*
