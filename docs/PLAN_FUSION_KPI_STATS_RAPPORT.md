# Plan de fusion KPI → Stats + Rapport hebdomadaire Excel

## Vue d'ensemble

Fusionner la page KPI dans la page Stats, et ajouter une vue "Rapport" pour générer un Excel hebdomadaire au format spécifié.

---

## 1. Fusion KPI → Stats

### 1.1 Suppression de la page KPI
- [ ] Supprimer `kpi.html`
- [ ] Supprimer `static/js/page-kpi.js`
- [ ] Supprimer la route `/kpi` dans `app.py` (si elle existe)
- [ ] Supprimer les liens vers `/kpi` dans :
  - `parametres.html` (ligne 39 et 287)
  - `sidebar.js` (si présent)
  - Autres fichiers référençant KPI

### 1.2 Intégration dans Stats
- [ ] Ajouter un système d'onglets dans `stats.html` :
  - Onglet "📊 Statistiques" (vue actuelle)
  - Onglet "📄 Rapport" (nouvelle vue)
- [ ] Migrer la fonctionnalité KPI dans l'onglet "Rapport" (checklist simple)
- [ ] Adapter `page-stats.js` pour gérer les deux vues

---

## 2. Vue Rapport dans Stats

### 2.1 Interface utilisateur
- [ ] Créer une section "Rapport hebdomadaire" dans l'onglet Rapport
- [ ] Ajouter un sélecteur de semaine (format ISO : `2026-W10`)
- [ ] Bouton "📥 Générer Excel" pour la semaine sélectionnée
- [ ] Aperçu des données qui seront exportées (optionnel, pour validation)

### 2.2 Structure Excel (basée sur les images fournies)

#### Colonnes du template :
1. **Semaine** (A) : Format "S10", "S11", etc.
2. **Entretiens** (B) : Nom du candidat
3. **Métier** (C) : Métier du candidat
4. **Exp** (D) : Années d'expérience
5. **Dispo** (E) : Disponibilité
6. **Notes** (F) : Notes courtes (ex: "B OKS", "NOK")
7. **Commenta** (G) : Commentaires détaillés
8. **Prospections** (H) : Nom du prospect (RDV pris)
9. **Clients vus** (I) : Nom du prospect (RDV effectué)
10. **Besoins** (J) : Besoins identifiés
11. **RT** (K) : Vide (réservé)
12. **Suivi Mission** (L) : Vide (réservé)
13. **Pushs consultant** (M) : Nom du consultant qui a poussé
14. **Nb pushs** (N) : Nombre de pushs
15. **Attendus Prosp** (O) : Objectif prospection (gamification)
16. **Attendus Entretiens** (P) : Objectif entretiens (gamification)
17. **Attendus Pushs** (Q) : Objectif pushs (gamification)

#### Format Excel :
- Ligne 1 : En-têtes
- Lignes suivantes : Une ligne par entrée (candidat, prospection, client, push)
- Fusion des cellules "Semaine" pour regrouper les entrées d'une même semaine
- Séparateur visuel (colonne G épaisse) entre "Commenta" et "Prospections"

---

## 3. Ajout des EC dans le calendrier

### 3.1 Base de données
- [ ] Vérifier que `ec1_checklist` existe avec `interviewAt` (déjà présent d'après le code)
- [ ] Vérifier que `candidates` a un champ `status` avec valeurs "ec1", "ec2"
- [ ] S'assurer que les événements EC sont loggés dans `candidate_events` ou créer une table `calendar_events` si nécessaire

### 3.2 API calendrier
- [ ] Créer/modifier `/api/calendar` pour inclure les EC1/EC2
- [ ] Requête SQL pour récupérer :
  - EC1 : `SELECT c.*, ec.interviewAt FROM candidates c JOIN ec1_checklist ec ON ec.candidate_id=c.id WHERE c.owner_id=? AND ec.interviewAt IS NOT NULL AND ec.interviewAt >= ? AND ec.interviewAt <= ?`
  - EC2 : `SELECT * FROM candidates WHERE owner_id=? AND status='ec2' AND ...` (date à déterminer selon structure)
- [ ] Retourner les événements au format calendrier existant

### 3.3 Frontend calendrier
- [ ] Modifier `page-calendrier.js` (ou équivalent) pour afficher les EC
- [ ] Icônes distinctes : 📞 pour EC1, 📞📞 pour EC2
- [ ] Lien vers la fiche candidat au clic

---

## 4. Génération du rapport Excel

### 4.1 Backend : Route API
- [ ] Créer `/api/stats/weekly-report` (POST ou GET avec paramètres)
- [ ] Paramètres : `week` (format "2026-W10") ou `start_date` + `end_date`
- [ ] Calculer le numéro de semaine ISO et les dates de début/fin (lundi → dimanche)

### 4.2 Collecte des données

#### 4.2.1 Candidats vus en EC1/EC2
- [ ] Requête SQL :
  ```sql
  SELECT c.*, ec.interviewAt, ec.data as ec1_data
  FROM candidates c
  LEFT JOIN ec1_checklist ec ON ec.candidate_id = c.id
  WHERE c.owner_id = ?
    AND c.status IN ('ec1', 'ec2')
    AND (
      (ec.interviewAt IS NOT NULL AND DATE(ec.interviewAt) BETWEEN ? AND ?)
      OR (c.status = 'ec2' AND ...) -- À adapter selon structure EC2
    )
  ORDER BY ec.interviewAt, c.name
  ```
- [ ] Pour chaque candidat :
  - **Entretiens** : `c.name` (Prénom Nom)
  - **Métier** : `c.sector` ou `c.fixedMetier` ou extrait des `skills`
  - **Exp** : `c.years_experience` ou calculé depuis `c.experience`
  - **Dispo** : `c.availability` ou extrait des notes
  - **Notes** : Statut court (ex: "B OKS" si statut = "ec1", "A OKS" si "ec2")
  - **Commenta** : Notes de l'EC1 (`ec.data.__note`) ou notes générales du candidat

#### 4.2.2 Prospections (RDV pris)
- [ ] Requête SQL :
  ```sql
  SELECT p.*, c.groupe, c.site
  FROM prospects p
  JOIN companies c ON c.id = p.company_id
  JOIN prospect_events e ON e.prospect_id = p.id
  WHERE p.owner_id = ?
    AND e.type = 'rdv_taken'
    AND e.date BETWEEN ? AND ?
  ORDER BY e.date, p.name
  ```
- [ ] Colonne **Prospections** : `p.name` ou `c.groupe`

#### 4.2.3 Clients vus (RDV effectué)
- [ ] Requête SQL :
  ```sql
  SELECT p.*, c.groupe, c.site, p.notes, p.callNotes
  FROM prospects p
  JOIN companies c ON c.id = p.company_id
  JOIN prospect_events e ON e.prospect_id = p.id
  WHERE p.owner_id = ?
    AND e.type = 'rdv_done' -- ou 'client_seen' selon événements
    AND e.date BETWEEN ? AND ?
  ORDER BY e.date, p.name
  ```
- [ ] Colonne **Clients vus** : `p.name` ou `c.groupe`
- [ ] Colonne **Besoins** : Extraire depuis `p.notes` ou `p.callNotes` (recherche mots-clés : "besoin", "recherche", etc.)

#### 4.2.4 Pushs
- [ ] Requête SQL :
  ```sql
  SELECT pl.*, p.name as prospect_name, u.username as consultant_name
  FROM push_logs pl
  JOIN prospects p ON p.id = pl.prospect_id
  LEFT JOIN users u ON u.id = pl.created_by -- si champ existe
  WHERE p.owner_id = ?
    AND DATE(pl.sentAt) BETWEEN ? AND ?
  ORDER BY pl.sentAt, u.username
  ```
- [ ] Grouper par consultant (`u.username` ou `pl.created_by`)
- [ ] Colonne **Pushs consultant** : Nom du consultant
- [ ] Colonne **Nb pushs** : Nombre de pushs par consultant

#### 4.2.5 Objectifs (Gamification)
- [ ] Utiliser `services/dashboard_goals.py` :
  - Appeler `get_goals_config(conn)` pour récupérer la config
  - Extraire `weekly.rdv.target` → **Attendus Prosp**
  - Extraire objectif entretiens (à créer si absent) → **Attendus Entretiens**
  - Extraire `weekly.push.target` → **Attendus Pushs**

### 4.3 Génération Excel (openpyxl)
- [ ] Créer un workbook avec `openpyxl`
- [ ] Feuille principale : "Rapport SXX"
- [ ] En-têtes ligne 1 (colonnes A à Q)
- [ ] Style :
  - Fusionner les cellules "Semaine" pour chaque groupe de lignes
  - Colonne G (séparateur) : bordure épaisse noire
  - Mise en forme conditionnelle (fond jaune pour semaine en cours si applicable)
- [ ] Remplir les lignes :
  - Une ligne par candidat EC1/EC2
  - Une ligne par prospection (RDV pris)
  - Une ligne par client vu (RDV effectué)
  - Une ligne par consultant (pushs)
  - Ligne d'objectifs (première ligne de la semaine)
- [ ] Largeurs de colonnes adaptées
- [ ] Retourner le fichier via `send_file()`

### 4.4 Frontend
- [ ] Dans `page-stats.js`, ajouter la fonction `generateWeeklyReport(weekStr)`
- [ ] Appel API : `POST /api/stats/weekly-report` avec `{ week: "2026-W10" }`
- [ ] Téléchargement automatique du fichier Excel

---

## 5. Corrections des bugs Stats

### 5.1 Vérification des graphiques
- [ ] Tester tous les graphiques dans la vue Statistiques
- [ ] Vérifier que les données s'affichent correctement
- [ ] Corriger les canvas vides ou les erreurs JavaScript
- [ ] Vérifier les appels API `/api/stats` et `/api/stats/charts`

### 5.2 Tests
- [ ] Tester avec des données réelles
- [ ] Vérifier les cas limites (semaine sans données, etc.)
- [ ] Tester la génération Excel avec différentes semaines

---

## 6. Structure des fichiers modifiés

### Fichiers à modifier :
1. `stats.html` : Ajout onglets + section Rapport
2. `static/js/page-stats.js` : Gestion deux vues + génération rapport
3. `app.py` : 
   - Suppression route KPI (si existe)
   - Nouvelle route `/api/stats/weekly-report`
   - Modification `/api/calendar` pour inclure EC
4. `parametres.html` : Supprimer liens vers `/kpi`
5. `sidebar.js` : Supprimer lien KPI (si présent)

### Fichiers à supprimer :
1. `kpi.html`
2. `static/js/page-kpi.js`

### Fichiers à créer :
1. Aucun (tout intégré dans Stats)

---

## 7. Ordre d'implémentation recommandé

1. ✅ **Phase 1** : Fusion KPI → Stats (onglets + migration checklist)
2. ✅ **Phase 2** : Ajout EC dans calendrier (backend + frontend)
3. ✅ **Phase 3** : Route API rapport hebdomadaire (collecte données)
4. ✅ **Phase 4** : Génération Excel (format exact)
5. ✅ **Phase 5** : Frontend rapport (sélecteur semaine + bouton)
6. ✅ **Phase 6** : Corrections bugs Stats + tests

---

## 8. Notes techniques

### Format semaine ISO
- Utiliser `datetime.date.isocalendar()` pour obtenir (année, semaine, jour)
- Format affiché : "S10", "S11", etc.
- Format API : "2026-W10" (ISO 8601)

### Dates EC1/EC2
- EC1 : `ec1_checklist.interviewAt` (datetime-local)
- EC2 : À déterminer (peut-être un champ similaire `ec2_checklist` ou date de changement de statut)

### Matching besoins
- Extraire depuis `prospects.notes` ou `prospects.callNotes`
- Rechercher patterns : "besoin", "recherche", "cherche", "poste", etc.
- Ou utiliser un champ dédié si ajouté ultérieurement

### Objectifs gamification
- Si objectif entretiens n'existe pas, utiliser une valeur par défaut ou laisser vide
- Ou créer un nouvel objectif dans `dashboard_goals.py`

---

## 9. Questions à clarifier

1. **EC2** : Comment est stockée la date de l'EC2 ? (même structure que EC1 ?)
2. **Besoins** : Champ dédié dans `prospects` ou extraction depuis notes ?
3. **Objectif entretiens** : Existe-t-il dans gamification ou à créer ?
4. **Consultant pushs** : Champ `created_by` dans `push_logs` ou utiliser `owner_id` (utilisateur connecté) ?
5. **Format notes** : Les codes "B OKS", "A OKS", etc. sont-ils stockés quelque part ou à générer depuis le statut ?

---

## 10. Validation

- [ ] Page Stats avec deux onglets fonctionnels
- [ ] Checklist KPI accessible dans onglet Rapport
- [ ] EC1/EC2 visibles dans le calendrier
- [ ] Génération Excel avec format exact (colonnes, fusion, séparateur)
- [ ] Données correctes (candidats, prospections, clients, pushs, objectifs)
- [ ] Tests avec différentes semaines
- [ ] Pas de régression sur les statistiques existantes
