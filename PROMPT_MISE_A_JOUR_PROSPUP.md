# 🔄 Mise à jour ProspUp sur prospup.work

**Contexte :** Le serveur prospup.work doit être mis à jour avec les dernières modifications (fusion KPI→Stats, badge version, etc.). Le superviseur automatique n'a pas encore fait le pull.

**Objectif :** Forcer la mise à jour manuellement et vérifier que tout fonctionne.

---

## 📋 Instructions à suivre dans l'ordre

### 1️⃣ Vérifier l'état actuel

Ouvre un terminal/PowerShell dans le dossier du projet ProspUp et exécute :

```bash
cd [chemin_vers_prospup]
git status
git log --oneline -3
```

**Note :** Note le hash du dernier commit affiché (ex: `b073628` ou autre).

---

### 2️⃣ Forcer le pull depuis main

```bash
git fetch origin main
git pull origin main
```

**Résultat attendu :** Tu devrais voir des fichiers modifiés/supprimés (kpi.html supprimé, stats.html modifié, etc.).

Si tu vois des erreurs de conflit ou "divergence", **STOP** et dis-moi. Sinon, continue.

---

### 3️⃣ Vérifier que le pull a bien fonctionné

```bash
git log --oneline -1
```

**Vérification :** Le hash devrait être `b073628` (ou plus récent). Si c'est le cas, c'est bon ✅

---

### 4️⃣ Redémarrer le serveur

Le superviseur (`supervise_prospup.py`) devrait redémarrer automatiquement, mais pour être sûr :

**Option A - Si le superviseur tourne :**
- Le serveur devrait redémarrer automatiquement dans les 10-30 secondes
- Vérifie les logs du superviseur pour confirmer

**Option B - Si tu dois redémarrer manuellement :**
- Arrête le processus actuel (Ctrl+C dans le terminal où il tourne)
- Relance : `python scripts/supervise_prospup.py` ou `python app.py --prod`

---

### 5️⃣ Vérifier que prospup.work fonctionne

Attends 30 secondes après le redémarrage, puis :

1. Ouvre https://prospup.work dans un navigateur
2. Connecte-toi (admin/admin ou tes identifiants)
3. Vérifie ces points :

   ✅ **La page `/kpi` doit rediriger ou donner une 404** (plus de page KPI)
   
   ✅ **La page `/stats` doit avoir deux onglets** :
      - "📊 Statistiques" (onglet actif par défaut)
      - "📄 Rapport & KPI" (deuxième onglet)
   
   ✅ **Dans Paramètres → À propos**, il doit y avoir un **badge de version** avec :
      - Un point coloré qui pulse
      - Le texte "v25.2 • [hash] • [date]"
   
   ✅ **Dans la sidebar**, le lien "KPI" sous "Outils" doit avoir **disparu**

---

### 6️⃣ Test rapide de l'API version

Dans un terminal, teste :

```bash
curl https://prospup.work/api/app-version
```

**Résultat attendu :** Un JSON avec `"ok": true`, `"version": "25.2"`, `"commit_hash": "b073628"` (ou similaire)

Si tu obtiens `"Non authentifié"`, c'est que la mise à jour n'est pas complète.

---

## ⚠️ En cas de problème

**Si le pull échoue :**
- Vérifie que tu es sur la branche `main` : `git branch`
- Si tu es sur une autre branche : `git checkout main` puis refais le pull

**Si le serveur ne redémarre pas :**
- Vérifie que `supervise_prospup.py` tourne
- Redémarre manuellement si nécessaire

**Si prospup.work ne répond plus :**
- Vérifie que le serveur tourne : `python app.py --prod` dans un terminal
- Vérifie les logs pour des erreurs

---

## ✅ Confirmation

Une fois que tout est fait et vérifié, dis-moi :
- ✅ "C'est fait, prospup.work est à jour"
- Ou ❌ "Problème : [décris ce qui ne va pas]"

---

**Note :** Si tu as des questions ou des doutes, n'hésite pas à me demander avant de continuer !
