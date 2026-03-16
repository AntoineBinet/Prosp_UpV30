# Plan de déploiement — Bouton "Avant réunion IA"

## 📋 Vue d'ensemble

Implémenter un bouton **"📋 Avant réunion IA"** qui apparaît uniquement pour les prospects au statut **"Rendez-vous"**, et qui :
1. Scrape le profil LinkedIn via Ollama (analyse du profil)
2. Affiche le streaming en direct (SSE) du raisonnement Ollama
3. Génère automatiquement un PDF A4 (fiche de préparation RDV) avec ReportLab
4. Télécharge automatiquement le PDF dans le navigateur
5. Affiche un fallback prompt si Ollama échoue

---

## 🎯 Objectifs techniques

- **Bouton conditionnel** : visible uniquement si `prospect.statut === "Rendez-vous"`
- **Streaming SSE** : affichage en temps réel des tokens Ollama
- **Génération PDF** : format identique au modèle fourni (fiche_rdv_samir_khoucha.pdf)
- **Téléchargement auto** : déclenchement automatique après génération
- **Fallback** : prompt pré-rempli à copier-coller si Ollama indisponible

---

## 📁 Fichiers à modifier/créer

### 1. Backend Flask (`app.py`)

#### 1.1. Ajouter ReportLab aux imports
- **Ligne ~20** : Ajouter `from reportlab.lib.pagesizes import A4`
- **Ligne ~20** : Ajouter les imports ReportLab nécessaires (voir code fourni)
- **Vérifier** : `pip install reportlab` dans les dépendances

#### 1.2. Nouvelle route SSE : `/api/prospect/<id>/infos-rdv-stream`
- **Emplacement** : Après la route `/api/ollama/generate-stream` (~ligne 7600)
- **Méthode** : `GET`
- **Fonctionnalités** :
  - Récupère le prospect depuis la DB (vérifier `owner_id`)
  - Construit le prompt Ollama avec `build_ollama_prompt_rdv(prospect)`
  - Appelle Ollama en streaming via `/api/generate` (stream=True)
  - Renvoie SSE avec :
    - `{"type": "token", "content": "..."}` pour chaque token
    - `{"type": "done", "pdf_url": "/api/prospect/<id>/download-rdv-pdf"}` à la fin
    - `{"type": "error", "fallback_prompt": "..."}` en cas d'erreur
  - Stocke la réponse complète dans `session[f"rdv_analysis_{prospect_id}"]`

#### 1.3. Nouvelle route PDF : `/api/prospect/<id>/download-rdv-pdf`
- **Emplacement** : Après la route SSE (~ligne 7650)
- **Méthode** : `GET`
- **Fonctionnalités** :
  - Récupère `session[f"rdv_analysis_{prospect_id}"]`
  - Parse le JSON retourné par Ollama
  - Appelle `build_fiche_rdv_pdf(prospect, ollama_json)` (nouvelle fonction)
  - Retourne le PDF avec `send_file(..., as_attachment=True, download_name="fiche_rdv_<nom>.pdf")`

#### 1.4. Fonction `build_ollama_prompt_rdv(prospect)`
- **Emplacement** : Avant les routes (~ligne 7400)
- **Paramètres** : `prospect` (dict avec nom, prenom, poste, entreprise, ville, linkedin)
- **Retour** : String prompt structuré pour Ollama
- **Format JSON attendu** :
  ```json
  {
    "qui_est_il": {...},
    "contexte_entreprise": {...},
    "besoins_probables": {...},
    "interlocuteurs_potentiels": {...}
  }
  ```

#### 1.5. Fonction `build_fallback_prompt_rdv(prospect)`
- **Emplacement** : Même zone que `build_ollama_prompt_rdv`
- **Retour** : Prompt complet à copier-coller dans une autre IA

#### 1.6. Fonction `build_fiche_rdv_pdf(prospect, ollama_data)`
- **Emplacement** : Avant les routes (~ligne 7400)
- **Paramètres** :
  - `prospect` : dict avec toutes les infos du prospect
  - `ollama_data` : dict JSON parsé depuis la réponse Ollama
- **Retour** : BytesIO du PDF généré
- **Structure PDF** :
  - **Page de titre** : Titre centré + sous-titre + ligne bleue
  - **SECTION 1** : Synthèse prospect (4 sous-sections)
  - **SECTION 2** : Checklist RDV (8 sous-sections fixes + notes libres)
- **Styles** : Utiliser les couleurs et polices du modèle (Helvetica, couleurs #2980B9, #2C3E50, etc.)

---

### 2. Frontend JavaScript (`static/js/app.js`)

#### 2.1. Ajouter le bouton dans la fiche prospect
- **Emplacement** : Ligne ~3395, dans `rdv-checklist-actions`
- **Code** : Ajouter AVANT le bouton "Après réunion IA" :
  ```javascript
  <button class="btn btn-accent btn-sm" id="btnPreMeetingIA_${prospect.id}" 
          onclick="handlePreMeetingIA(${prospect.id})" 
          title="Générer une fiche de préparation RDV avec IA"
          data-help-section="scrapping-ia">
    📋 Avant réunion IA
  </button>
  ```
- **Condition** : Le bouton est déjà dans l'onglet RDV qui n'apparaît que si `statut === "Rendez-vous"`

#### 2.2. Fonction `handlePreMeetingIA(prospectId)`
- **Emplacement** : Après `handlePostMeetingIA` (~ligne 10560)
- **Fonctionnalités** :
  - Affiche un panneau de progression (style terminal noir)
  - Ouvre une connexion EventSource vers `/api/prospect/${prospectId}/infos-rdv-stream`
  - Gère les événements SSE :
    - `token` : ajoute le contenu au log de progression
    - `done` : déclenche le téléchargement via `window.location.href = data.pdf_url`
    - `error` : affiche le fallback prompt dans un textarea

#### 2.3. Panneau de progression (HTML dynamique)
- **Emplacement** : Créer une modale similaire à `modalPostMeetingIA`
- **ID** : `modalPreMeetingIA`
- **Contenu** :
  - Header : "📋 Génération fiche préparation RDV"
  - Zone de log : `<div id="preMeetingProgressLog" class="progress-log"></div>`
  - Zone fallback (masquée) : `<div id="preMeetingFallback" style="display:none;">...</div>`
  - Bouton fermer

#### 2.4. CSS pour `.progress-log`
- **Emplacement** : `static/css/style.css`
- **Styles** : Fond noir (#0d1117), texte bleu (#58a6ff), monospace, scrollable, max-height 300px

---

### 3. Dépendances Python

#### 3.1. Ajouter ReportLab
- **Fichier** : `requirements.txt` (si existe) ou documenter dans `CLAUDE.md`
- **Commande** : `pip install reportlab`
- **Version** : Dernière stable (>= 4.0.0)

---

## 🔄 Flux d'exécution détaillé

### Étape 1 : Clic sur "Avant réunion IA"
1. Utilisateur clique sur le bouton dans l'onglet RDV
2. `handlePreMeetingIA(prospectId)` est appelé
3. La modale `modalPreMeetingIA` s'ouvre
4. Le panneau de progression s'affiche (vide)

### Étape 2 : Streaming Ollama
1. EventSource se connecte à `/api/prospect/<id>/infos-rdv-stream`
2. Backend récupère le prospect depuis la DB
3. Backend construit le prompt avec `build_ollama_prompt_rdv(prospect)`
4. Backend appelle Ollama en streaming
5. Chaque token Ollama est envoyé via SSE : `{"type": "token", "content": "..."}`
6. Frontend affiche les tokens en temps réel dans `#preMeetingProgressLog`

### Étape 3 : Génération PDF
1. Quand Ollama termine, backend envoie : `{"type": "done", "pdf_url": "/api/prospect/<id>/download-rdv-pdf"}`
2. Backend stocke la réponse complète dans `session[f"rdv_analysis_{prospect_id}"]`
3. Frontend reçoit l'événement `done`
4. Frontend déclenche : `window.location.href = data.pdf_url`

### Étape 4 : Téléchargement
1. Route `/api/prospect/<id>/download-rdv-pdf` est appelée
2. Backend récupère `session[f"rdv_analysis_{prospect_id}"]`
3. Backend parse le JSON Ollama
4. Backend appelle `build_fiche_rdv_pdf(prospect, ollama_json)`
5. Backend retourne le PDF avec `send_file(..., as_attachment=True)`
6. Le navigateur télécharge automatiquement `fiche_rdv_<nom_prospect>.pdf`

### Étape 5 : Gestion d'erreur (fallback)
1. Si Ollama échoue, backend envoie : `{"type": "error", "fallback_prompt": "..."}`
2. Frontend affiche la zone fallback avec le prompt pré-rempli
3. Utilisateur peut copier le prompt et le coller dans ChatGPT/Claude

---

## 🧪 Tests à effectuer

### Tests unitaires
- [ ] `build_ollama_prompt_rdv()` génère un prompt valide
- [ ] `build_fallback_prompt_rdv()` génère un prompt complet
- [ ] `build_fiche_rdv_pdf()` génère un PDF valide avec les bonnes sections
- [ ] Parsing du JSON Ollama fonctionne correctement

### Tests d'intégration
- [ ] Route SSE `/api/prospect/<id>/infos-rdv-stream` renvoie des événements valides
- [ ] Route PDF `/api/prospect/<id>/download-rdv-pdf` génère et télécharge le PDF
- [ ] Session Flask stocke correctement les données entre les deux routes

### Tests E2E (Playwright)
- [ ] Ouvrir un prospect au statut "Rendez-vous"
- [ ] Cliquer sur "Avant réunion IA"
- [ ] Vérifier que le streaming s'affiche
- [ ] Vérifier que le PDF se télécharge automatiquement
- [ ] Vérifier le contenu du PDF (sections, styles, données)

### Tests de fallback
- [ ] Désactiver Ollama (arrêter le service)
- [ ] Cliquer sur "Avant réunion IA"
- [ ] Vérifier que le fallback prompt s'affiche
- [ ] Vérifier que le prompt est copiable

---

## 📝 Points d'attention

### 1. Vérifications préalables
- [ ] Vérifier le nom exact du champ `statut` dans la DB (probablement `statut` en minuscule)
- [ ] Vérifier la valeur exacte du statut "Rendez-vous" (probablement `"Rendez-vous"` avec majuscule)
- [ ] Vérifier les noms des champs prospect : `linkedin`, `prenom`, `nom`, `poste`, `entreprise`, `ville`
- [ ] Vérifier que la session Flask est bien configurée (déjà fait dans le projet)

### 2. Configuration Ollama
- [ ] Vérifier que `OLLAMA_URL` pointe vers `http://127.0.0.1:11434` (déjà configuré)
- [ ] Vérifier que `OLLAMA_MODEL` est défini (défaut : `llama3.2`)
- [ ] Timeout : utiliser 120s par défaut (déjà configuré)

### 3. Gestion de la session
- [ ] S'assurer que `session[f"rdv_analysis_{prospect_id}"]` persiste entre les deux requêtes
- [ ] Nettoyer la session après téléchargement (optionnel, pour éviter l'accumulation)

### 4. Parsing JSON Ollama
- [ ] Gérer les cas où Ollama renvoie du texte avant/après le JSON
- [ ] Extraire uniquement le JSON valide (fonction `extractJSONFromText` existe déjà dans `app.js`)

### 5. Styles PDF
- [ ] Reproduire exactement les styles du modèle fourni
- [ ] Vérifier les marges (1.8cm latérales, 1.5cm haut/bas)
- [ ] Vérifier les couleurs (#2980B9, #2C3E50, #BDC3C7, etc.)
- [ ] Vérifier les polices (Helvetica-Bold, Helvetica-BoldOblique, Helvetica)

### 6. Checklist RDV (section 2)
- [ ] Les 8 sous-sections de la checklist sont **FIXES** (ne changent pas selon le prospect)
- [ ] Seule la SECTION 1 change selon les données Ollama
- [ ] Notes libres : 4 lignes horizontales en bas

---

## 🚀 Ordre d'implémentation recommandé

### Phase 1 : Backend — Fonctions utilitaires
1. ✅ Installer ReportLab : `pip install reportlab`
2. ✅ Créer `build_ollama_prompt_rdv(prospect)`
3. ✅ Créer `build_fallback_prompt_rdv(prospect)`
4. ✅ Créer `build_fiche_rdv_pdf(prospect, ollama_data)` (utiliser le code fourni comme base)

### Phase 2 : Backend — Routes API
1. ✅ Créer route SSE `/api/prospect/<id>/infos-rdv-stream`
2. ✅ Créer route PDF `/api/prospect/<id>/download-rdv-pdf`
3. ✅ Tester les routes individuellement (avec curl/Postman)

### Phase 3 : Frontend — UI et JavaScript
1. ✅ Ajouter le bouton dans `app.js` (ligne ~3395)
2. ✅ Créer la modale `modalPreMeetingIA` (HTML dynamique)
3. ✅ Créer la fonction `handlePreMeetingIA(prospectId)`
4. ✅ Ajouter le CSS `.progress-log`

### Phase 4 : Intégration et tests
1. ✅ Tester le flux complet (clic → streaming → PDF)
2. ✅ Tester le fallback (Ollama désactivé)
3. ✅ Vérifier le contenu du PDF généré
4. ✅ Tests E2E avec Playwright

### Phase 5 : Documentation et finalisation
1. ✅ Mettre à jour `CLAUDE.md` avec la nouvelle fonctionnalité
2. ✅ Ajouter une section dans `help.html` (optionnel)
3. ✅ Commit et push sur `main`

---

## 📚 Références

- **Code PDF fourni** : Utiliser le code Python fourni pour `build_fiche_rdv_pdf()`
- **Modèle PDF** : `fiche_rdv_samir_khoucha.pdf` (référence visuelle)
- **Route SSE existante** : `/api/ollama/generate-stream` (ligne 7528) comme modèle
- **Bouton similaire** : "Après réunion IA" (ligne 3396) comme référence UI

---

## ✅ Checklist finale avant déploiement

- [ ] ReportLab installé et testé
- [ ] Routes backend fonctionnelles (SSE + PDF)
- [ ] Bouton visible uniquement pour statut "Rendez-vous"
- [ ] Streaming SSE fonctionne en temps réel
- [ ] PDF généré avec toutes les sections
- [ ] Téléchargement automatique fonctionne
- [ ] Fallback prompt affiché en cas d'erreur Ollama
- [ ] Tests E2E passent
- [ ] Documentation mise à jour
- [ ] Code commité et poussé sur `main`

---

**Date de création** : 2026-03-13  
**Auteur** : Plan généré pour implémentation "Avant réunion IA"
