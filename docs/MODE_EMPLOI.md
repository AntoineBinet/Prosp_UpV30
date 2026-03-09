# 🚀 ProspUp v21 — Mode d'emploi complet

## Installation, démarrage & accès HTTPS depuis partout

---

## 📋 Sommaire

1. [Prérequis](#1--prérequis)
2. [Installation](#2--installation)
3. [Premier lancement](#3--premier-lancement)
4. [Accès HTTPS partout (Cloudflare Tunnel)](#4--accès-https-partout-cloudflare-tunnel)
5. [Accès depuis iPhone (PWA)](#5--accès-depuis-iphone-pwa)
6. [Gestion des utilisateurs](#6--gestion-des-utilisateurs)
7. [Démarrage automatique (Windows)](#7--démarrage-automatique-au-boot-windows)
8. [FAQ / Troubleshooting](#8--faq--troubleshooting)

---

## 1 — Prérequis

| Élément | Version | Où le télécharger |
|---------|---------|-------------------|
| **Windows** | 10 ou 11 | *(déjà installé)* |
| **Python** | 3.10+ | [python.org/downloads](https://www.python.org/downloads/) |
| **cloudflared** | dernière | `winget install Cloudflare.cloudflared` |

### Installer Python

1. Allez sur [python.org/downloads](https://www.python.org/downloads/)
2. Téléchargez la dernière version (3.12+)
3. **⚠️ IMPORTANT** : Cochez **"Add Python to PATH"** en bas de l'installeur !
4. Cliquez "Install Now"
5. Vérifiez dans un terminal :
   ```
   python --version
   ```
   → Doit afficher `Python 3.12.x` ou similaire

### Installer cloudflared

Ouvrez **PowerShell** ou **Terminal** et tapez :

```powershell
winget install Cloudflare.cloudflared
```

Si winget n'est pas dispo, téléchargez le `.msi` depuis :
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Vérifiez :
```
cloudflared --version
```

---

## 2 — Installation

1. **Décompressez** le dossier `ProspUp_v15.zip` où vous voulez (ex: `C:\ProspUp`)
2. C'est tout ! Pas besoin d'installer autre chose, le script de démarrage s'en charge.

Structure du dossier :
```
ProspUp_v15/
├── app.py              ← Serveur Flask
├── prospects.db        ← Base de données SQLite
├── PROSPUP.bat         ← Double-cliquez pour tout lancer (serveur + tunnel)
├── requirements.txt    ← Dépendances Python
├── static/             ← CSS, JS, icônes PWA
├── pushs/              ← Templates de push (fichiers)
├── snapshots/          ← Sauvegardes auto
└── *.html              ← Pages de l'application
```

---

## 3 — Premier lancement

### Étape 1 : Lancer le serveur

**Double-cliquez sur `PROSPUP.bat`**

Deux fenêtres s'ouvrent (serveur + tunnel). La première affiche :
```
🚀 ProspUp démarré en production (waitress) sur http://0.0.0.0:8000
```

> Le serveur et le tunnel tournent tant que les fenêtres sont ouvertes. Ne les fermez pas !

### Étape 2 : Se connecter

Ouvrez votre navigateur et allez sur : **http://localhost:8000**

Page de connexion :
- **Identifiant** : `admin`
- **Mot de passe** : `admin`

> ⚠️ **Changez immédiatement votre mot de passe** après la première connexion !
> → Allez dans ⚙️ Paramètres ou 👥 Utilisateurs pour modifier.

---

## 4 — Accès HTTPS partout (Cloudflare Tunnel)

C'est **gratuit**, **sans ouvrir de port**, et donne une URL HTTPS accessible partout dans le monde.

### Comment ça marche ?

```
Votre iPhone  →→→  Internet  →→→  Cloudflare  →→→  Tunnel  →→→  Votre PC
   (HTTPS)                        (proxy gratuit)    (chiffré)    (localhost:8000)
```

Cloudflare crée un tunnel sécurisé entre votre PC et leurs serveurs. Aucun port à ouvrir sur votre box !

### Lancement

1. **Lancez `PROSPUP.bat`** — le serveur et le tunnel démarrent automatiquement.
2. Si vous utilisez un tunnel nommé (SETUP_TUNNEL.bat déjà fait), ouvrez **https://crm.prospup.work** (ou votre URL).
3. Sinon (tunnel rapide), une URL apparaît dans la fenêtre tunnel :

```
+-------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take     |
|  some time to be reachable):                                       |
|  https://random-words-here.trycloudflare.com                      |
+-------------------------------------------------------------------+
```

4. **Copiez cette URL** — c'est votre adresse HTTPS !
5. Ouvrez-la dans n'importe quel navigateur, même sur votre iPhone en 4G.

### ⚠️ Note importante

L'URL **change à chaque lancement** du tunnel (c'est la version gratuite).
Pour une URL fixe (ex: `prospup.mondomaine.com`), voir la section "Tunnel nommé" plus bas.

### Option avancée : Tunnel permanent avec URL fixe

Si vous voulez une URL qui ne change jamais :

1. **Créez un compte Cloudflare** (gratuit) : https://dash.cloudflare.com/sign-up
2. **Ajoutez un domaine** (achetez-en un pour ~10€/an sur Cloudflare ou transférez le vôtre)
3. **Créez un tunnel nommé** :

```powershell
# Connectez-vous une seule fois :
cloudflared login

# Créez le tunnel :
cloudflared tunnel create prospup

# Configurez le DNS :
cloudflared tunnel route dns prospup crm.votredomaine.com

# Créez le fichier config :
```

4. Créez `C:\Users\VOTRE_NOM\.cloudflared\config.yml` :

```yaml
tunnel: prospup
credentials-file: C:\Users\VOTRE_NOM\.cloudflared\XXXXX.json

ingress:
  - hostname: crm.votredomaine.com
    service: http://localhost:8000
  - service: http_status:404
```

5. Lancez avec :
```powershell
cloudflared tunnel run prospup
```

→ Votre CRM est maintenant accessible en permanence sur `https://crm.votredomaine.com` 🎉

---

## 5 — Accès depuis iPhone (PWA)

ProspUp est optimisé pour iPhone via Safari. Il s'installe comme une vraie app !

### Ajouter à l'écran d'accueil

1. Ouvrez **Safari** sur votre iPhone
2. Allez sur l'URL du tunnel : `https://random-words.trycloudflare.com`
3. Connectez-vous (admin / admin)
4. Appuyez sur l'icône **Partager** (carré avec flèche vers le haut)
5. Faites défiler et appuyez sur **"Sur l'écran d'accueil"**
6. Nommez-la "ProspUp" et appuyez sur **Ajouter**

→ L'icône ProspUp apparaît sur votre écran d'accueil ! 📱

### Fonctionnalités mobiles

- **📞 Appels directs** : Appuyez sur un numéro de téléphone dans la fiche prospect → lance directement l'appel sur votre iPhone
- **Navigation** : Barre de navigation horizontale en bas de l'écran (scrollable)
- **Mode plein écran** : Quand lancée depuis l'écran d'accueil, l'app s'affiche sans les barres Safari
- **Touch optimisé** : Boutons de 44px minimum, cases à cocher agrandies

### Astuce : Appeler depuis la fiche prospect

1. Ouvrez un prospect
2. Vous voyez **📞 06 xx xx xx xx** (lien cliquable)
3. Appuyez dessus → votre iPhone lance l'appel directement
4. Le bouton **📞 Appeler** dans la toolbar fonctionne aussi

---

## 6 — Gestion des utilisateurs

### Rôles disponibles

| Rôle | Permissions |
|------|-------------|
| 🔑 **Admin** | Tout : lecture, modification, suppression, gestion des utilisateurs |
| ✏️ **Éditeur** | Lecture + modification (ajout prospects, édition, push, etc.) |
| 👁️ **Lecteur** | Lecture seule (consultation, pas de modification possible) |

### Créer un utilisateur

1. Connectez-vous en **admin**
2. Allez dans **👥 Utilisateurs** (menu latéral)
3. Cliquez **+ Nouvel utilisateur**
4. Remplissez : identifiant, nom affiché, mot de passe, rôle
5. Cliquez **Enregistrer**

### Modifier / Désactiver un utilisateur

- Cliquez **✏️ Modifier** sur l'utilisateur
- Décochez "Compte actif" pour désactiver sans supprimer
- Changez le rôle ou le mot de passe

### Changer son propre mot de passe

Chaque utilisateur peut changer son mot de passe via l'API :
```
POST /api/auth/change-password
{ "old_password": "ancien", "new_password": "nouveau" }
```

*(Une interface dédiée sera ajoutée dans une future version)*

---

## 7 — Démarrage automatique au boot (Windows)

Pour que ProspUp se lance automatiquement quand Windows démarre :

### Méthode 1 : Planificateur de tâches (recommandé)

1. Ouvrez le **Planificateur de tâches** (cherchez "Planificateur" dans le menu Démarrer)
2. Cliquez **Créer une tâche...**
3. Onglet **Général** :
   - Nom : `ProspUp Serveur`
   - Cochez "Exécuter même si l'utilisateur n'est pas connecté"
   - Cochez "Exécuter avec les privilèges les plus élevés"
4. Onglet **Déclencheurs** :
   - Nouveau → "Au démarrage"
   - Retarder la tâche de : 30 secondes
5. Onglet **Actions** :
   - Nouvelle → Programme : `python`
   - Arguments : `app.py --production`
   - Démarrer dans : `C:\ProspUp` (votre dossier)
6. OK

Répétez pour le tunnel (optionnel) :
- Programme : `cloudflared`
- Arguments : `tunnel --url http://localhost:8000`

### Méthode 2 : Dossier Démarrage (simple)

1. Appuyez `Win + R`, tapez `shell:startup`, Entrée
2. Créez un raccourci vers `PROSPUP.bat`

---

## 8 — FAQ / Troubleshooting

### "Python n'est pas reconnu comme commande"

→ Python n'est pas dans le PATH. Réinstallez Python et cochez **"Add to PATH"**.
Ou ajoutez manuellement : `Paramètres > Système > Variables d'environnement > Path > Nouveau > C:\Users\VOTRE_NOM\AppData\Local\Programs\Python\Python312\`

### "Le tunnel ne démarre pas"

→ Vérifiez que cloudflared est installé : `cloudflared --version`
→ Si bloqué par le pare-feu Windows, autorisez cloudflared dans les paramètres du pare-feu.

### "L'URL du tunnel change à chaque fois"

→ Normal en mode gratuit ! Pour une URL fixe, suivez la section "Tunnel nommé" ci-dessus.

### "Erreur 401 / Non authentifié"

→ Votre session a expiré. Reconnectez-vous sur `/login`.

### "Accès en lecture seule"

→ Vous êtes connecté en tant que **lecteur**. Demandez à l'admin de passer votre rôle en **éditeur** ou **admin**.

### "Le serveur ne répond pas depuis l'iPhone"

1. Vérifiez que `PROSPUP.bat` tourne (deux fenêtres : serveur + tunnel)
3. L'URL a peut-être changé — re-copiez l'URL du tunnel

### Sauvegarder la base de données

Le fichier `prospects.db` contient toutes vos données. Pour sauvegarder :
- Copiez `prospects.db` sur un disque externe ou dans le cloud
- L'app crée aussi des snapshots automatiques dans le dossier `snapshots/`

### Changer le port

Par défaut, ProspUp tourne sur le port 8000. Pour changer :
```
set PORT=3000
python app.py --production
```

---

## 📱 Résumé rapide

```
1. Double-cliquez PROSPUP.bat           → serveur + tunnel (prospup.work ou :8000)
3. Sur iPhone Safari : ouvrez l'URL     → connectez-vous
4. Partager > "Sur l'écran d'accueil"   → app installée !
5. Appelez vos prospects direct depuis l'app 📞
```

---

*ProspUp v21 — Up Technologies — Mars 2026*
