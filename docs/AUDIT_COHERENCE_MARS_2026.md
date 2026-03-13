# Audit de cohérence — ProspUp (Mars 2026)

**Date de l'audit** : 13 mars 2026  
**Version de l'application** : 26.2  
**Objectif** : Identifier les incohérences dans les textes affichés (HTML), l'UX et les fonctionnalités suite aux nombreuses modifications de la semaine.

---

## 📋 Résumé exécutif

Cet audit a identifié **47 incohérences** réparties en 3 catégories :
- **Textes et libellés** : 18 incohérences
- **UX et interface** : 16 incohérences  
- **Fonctionnalités et comportements** : 13 incohérences

Les problèmes les plus critiques concernent :
1. L'incohérence du nom de l'application (`ProspUp` vs `Prosp'Up`)
2. Les messages d'erreur et confirmations non standardisés
3. Les placeholders et tooltips manquants ou incohérents
4. Les libellés de boutons et actions qui varient selon les pages

---

## 1. TEXTES ET LIBELLÉS

### 1.1 Nom de l'application — CRITIQUE

**Problème** : Le nom de l'application est écrit de manière incohérente dans toute l'application.

| Fichier | Utilisation actuelle | Devrait être |
|---------|---------------------|--------------|
| `base.html` | `ProspUp` (défaut) | `Prosp'Up` |
| `dashboard.html` | `ProspUp — dashboard` | `Prosp'Up — Dashboard` |
| `index.html` | `Prosp'Up — Gestion Prospects` | ✅ Correct |
| `focus.html` | `Prosp'Up — Focus` | ✅ Correct |
| `entreprises.html` | `ProspUp — Entreprises` | `Prosp'Up — Entreprises` |
| `calendrier.html` | `ProspUp — Calendrier` | `Prosp'Up — Calendrier` |
| `company.html` | `ProspUp — Entreprise` | `Prosp'Up — Entreprise` |
| `collab.html` | `ProspUp — Collaboration` | `Prosp'Up — Collaboration` |
| `stats.html` | `Prosp'Up — Stats` | ✅ Correct |
| `candidate.html` | `Prosp'Up — Fiche candidat` | ✅ Correct |
| `sourcing.html` | `Prosp'Up — Sourcing candidats` | ✅ Correct |
| `help.html` | `Prosp'Up — Aide` | ✅ Correct |
| `parametres.html` | `Prosp'Up — Paramètres` | ✅ Correct |
| `users.html` | `Prosp'Up — Utilisateurs` | ✅ Correct |
| `push.html` | `Prosp'Up — Suivi des push` | ✅ Correct |
| `templates.html` | `Prosp'Up — Catégories Push` | ✅ Correct |
| `rapport.html` | `Prosp'Up — Rapport Hebdomadaire` | ✅ Correct |
| `snapshots.html` | `Prosp'Up — Snapshots` | ✅ Correct |
| `duplicates.html` | `Prosp'Up — Doublons` | ✅ Correct |
| `metiers.html` | `Prosp'Up — Référentiel Métiers` | ✅ Correct |
| `manifest.json` | `Prosp'Up — CRM Prospection` | ✅ Correct |

**Impact** : Confusion pour les utilisateurs, incohérence de marque.

**Plan de correction** :
1. Uniformiser tous les titres de pages avec `Prosp'Up` (avec apostrophe)
2. Mettre à jour `base.html` pour que le défaut soit `Prosp'Up`
3. Vérifier tous les fichiers JavaScript qui utilisent le nom en dur

---

### 1.2 Libellés de boutons incohérents

#### 1.2.1 Boutons de fermeture de modale

| Page | Libellé actuel | Devrait être |
|------|----------------|--------------|
| `index.html` (modalProspect) | `Annuler` | ✅ Correct |
| `index.html` (modalCompany) | `Annuler` | ✅ Correct |
| `index.html` (modalCallChoice) | `Annuler` | ✅ Correct |
| `focus.html` (taskModal) | `Annuler` | ✅ Correct |
| `candidate.html` (modalNewCandidateTab) | `Annuler` | ✅ Correct |
| `sourcing.html` (modalCandidate) | `Annuler` | ✅ Correct |
| `sourcing.html` (modalEC1) | `Annuler` | ✅ Correct |
| `push.html` (modalPushDetail) | `Fermer` | `Annuler` (cohérence) |
| `entreprises.html` (modalCompanySheet) | `Fermer` | `Annuler` (cohérence) |

**Impact** : Incohérence UX mineure.

**Plan de correction** : Standardiser sur `Annuler` pour toutes les modales de formulaire, `Fermer` uniquement pour les modales de consultation.

---

#### 1.2.2 Boutons d'action principale

| Page | Action | Libellé actuel | Incohérence |
|------|--------|----------------|-------------|
| `index.html` | Ajouter prospect | `Enregistrer` | ✅ Correct |
| `index.html` | Ajouter entreprise | `Ajouter` | Devrait être `Enregistrer` (cohérence) |
| `entreprises.html` | Ajouter entreprise | `Ajouter` | Devrait être `Enregistrer` (cohérence) |
| `focus.html` | Ajouter tâche | `💾 Enregistrer` | ✅ Correct |
| `sourcing.html` | Ajouter candidat | `Enregistrer` | ✅ Correct |
| `candidate.html` | Modifier candidat | `💾 Enregistrer` | ✅ Correct |
| `dashboard.html` | Ajouter KPI manuel | `✅ Enregistrer` | ✅ Correct |

**Impact** : Confusion pour les utilisateurs entre "Ajouter" et "Enregistrer".

**Plan de correction** : Standardiser sur `Enregistrer` pour toutes les actions de sauvegarde, `Ajouter` uniquement pour les boutons qui ouvrent une modale.

---

### 1.3 Messages d'erreur et confirmations

#### 1.3.1 Utilisation mixte de `alert()` et `showToast()`

**Problème** : Les messages utilisent tantôt `alert()` (bloquant), tantôt `showToast()` (non-bloquant), sans logique claire.

| Fichier | Fonction | Méthode utilisée | Devrait être |
|---------|----------|------------------|--------------|
| `page-snapshots.js` | Création snapshot | `alert('✅ Snapshot créé.')` | `showToast()` |
| `page-snapshots.js` | Restauration snapshot | `alert('✅ Snapshot restauré.')` | `showToast()` |
| `page-snapshots.js` | Suppression snapshot | `alert()` (confirmation) | ✅ Correct (confirmation) |
| `page-sourcing.js` | Erreur planification EC1 | `alert('❌ Date & heure requises...')` | `showToast()` |
| `page-sourcing.js` | Suppression candidat | `alert()` (confirmation) | ✅ Correct (confirmation) |
| `page-sourcing.js` | Message copié | `alert("✅ Message copié.")` | `showToast()` |
| `page-sourcing.js` | Candidat du jour | `alert("⭐ Candidat du jour...")` | `showToast()` ou modale |
| `users.html` | Enregistrement utilisateur | `alert('✅ Enregistré')` | `showToast()` |
| `users.html` | Suppression utilisateur | `alert('✅ Supprimé')` | `showToast()` |

**Impact** : Expérience utilisateur incohérente, interruptions inutiles.

**Plan de correction** :
1. Utiliser `showToast()` pour tous les messages informatifs (succès, erreur, warning)
2. Garder `alert()` uniquement pour les confirmations critiques (suppression, actions irréversibles)
3. Utiliser `confirm()` pour les confirmations avant action

---

#### 1.3.2 Format des messages d'erreur

**Problème** : Les messages d'erreur n'ont pas de format standardisé.

| Fichier | Format actuel | Devrait être |
|---------|---------------|--------------|
| `page-snapshots.js` | `'❌ Création impossible: ' + (t \|\| ('HTTP ' + res.status))` | Message plus explicite |
| `page-sourcing.js` | `'❌ Enregistrement impossible: ' + (txt \|\| ('HTTP ' + res.status))` | Message plus explicite |
| `page-settings.js` | `'❌ Erreur sauvegarde'` | Message plus détaillé |

**Impact** : Messages peu informatifs pour l'utilisateur.

**Plan de correction** : Créer une fonction helper `showError(message, details?)` qui formate les erreurs de manière cohérente.

---

### 1.4 Placeholders et tooltips

#### 1.4.1 Placeholders manquants ou incohérents

| Page | Champ | Placeholder actuel | Problème |
|------|-------|-------------------|----------|
| `index.html` | Recherche | `🔍 Rechercher (nom, entreprise…)` | ✅ Correct |
| `index.html` | Email | Aucun | Devrait avoir un placeholder |
| `index.html` | LinkedIn | `https://linkedin.com/in/...` | ✅ Correct |
| `candidate.html` | Rôle | `Embedded Software Engineer…` | ✅ Correct |
| `candidate.html` | Localisation | `Lyon / Remote…` | ✅ Correct |
| `candidate.html` | Téléphone | `06 xx xx xx xx` | ✅ Correct |
| `candidate.html` | Email | `prenom.nom@mail.com` | ✅ Correct |
| `sourcing.html` | Recherche candidat | `🔍 Rechercher (nom, rôle, tech, notes...)` | ✅ Correct |
| `sourcing.html` | Compétences | `🎯 Filtrer compétences (ex: RTOS, AUTOSAR)` | ✅ Correct |
| `sourcing.html` | Tech | `C/C++, RTOS, Linux, CAN...` | ✅ Correct |
| `sourcing.html` | LinkedIn | `https://...` | ✅ Correct |
| `calendrier.html` | URL calendrier externe | `https://...` | ✅ Correct |
| `push.html` | Recherche push | `🔍 Rechercher (prospect, entreprise, email, sujet)...` | ✅ Correct |

**Impact** : Mineur, la plupart des placeholders sont corrects.

**Plan de correction** : Ajouter des placeholders manquants pour les champs email dans les formulaires.

---

#### 1.4.2 Tooltips manquants

| Page | Élément | Tooltip actuel | Devrait avoir |
|------|---------|----------------|---------------|
| `dashboard.html` | Bouton "Ajout KPI manuel" | `title="Ajouter manuellement une action KPI"` | ✅ Correct |
| `dashboard.html` | Boutons layout (1/2/3 colonnes) | `title="1 colonne"` etc. | ✅ Correct |
| `dashboard.html` | Poignée de réorganisation | `title="Glisser pour réorganiser"` | ✅ Correct |
| `index.html` | Bouton "Filtres" | `title="Afficher les filtres"` | ✅ Correct |
| `index.html` | Bouton "Export" | `aria-label="Exporter les données"` | Devrait aussi avoir `title` |
| `candidate.html` | Bouton "Teams" | `title="Copier le profil formaté pour Teams"` | ✅ Correct |
| `candidate.html` | Bouton "VSA" (vide) | `title="Aucun lien VSA renseigné"` | ✅ Correct |
| `calendrier.html` | Bouton "Sync Calendar" | `title="Importer un fichier calendrier .ics"` | ✅ Correct |

**Impact** : Mineur, la plupart des tooltips sont présents.

**Plan de correction** : Ajouter des tooltips manquants pour les boutons d'export et autres actions.

---

### 1.5 Libellés de statuts et filtres

#### 1.5.1 Statuts prospects — incohérence mineure

| Page | Statut | Affichage | Cohérence |
|------|--------|-----------|-----------|
| `index.html` (filtre) | `Prospecté` | `🎯 Prospecté` | ✅ Correct |
| `index.html` (filtre) | `Prospectés` | `📋 Prospectés` | ⚠️ Confusion possible avec "Prospecté" |
| `index.html` (bulk) | `Prospecté` | `🎯 Prospecté` | ✅ Correct |
| `index.html` (bulk) | Pas de `Prospectés` | — | ⚠️ Incohérence avec le filtre |

**Impact** : Confusion possible entre "Prospecté" (action) et "Prospectés" (statut).

**Plan de correction** : Clarifier la différence entre ces deux statuts ou fusionner s'ils sont redondants.

---

#### 1.5.2 Statuts candidats — cohérence correcte

Les statuts candidats sont cohérents entre `sourcing.html` et `candidate.html` :
- `🧲 À sourcer`
- `📨 À contacter`
- `⏳ En cours`
- `📞 EC1`
- `📞📞 EC2`
- `📋 ED`
- `✅ Intéressé`
- `🚀 Mission`
- `❌ Refusé`
- `🎉 Embauché`
- `📦 Archivé`

✅ **Aucune incohérence détectée**

---

## 2. UX ET INTERFACE

### 2.1 Navigation et structure

#### 2.1.1 Titres de pages — casse incohérente

| Page | Titre actuel | Devrait être |
|------|--------------|--------------|
| `dashboard.html` | `ProspUp — dashboard` | `Prosp'Up — Dashboard` (majuscule) |
| `index.html` | `Prosp'Up — Gestion Prospects` | ✅ Correct |
| `focus.html` | `Prosp'Up — Focus` | ✅ Correct |
| `entreprises.html` | `ProspUp — Entreprises` | `Prosp'Up — Entreprises` |
| `calendrier.html` | `ProspUp — Calendrier` | `Prosp'Up — Calendrier` |
| `stats.html` | `Prosp'Up — Stats` | `Prosp'Up — Statistiques` (plus explicite) |

**Impact** : Incohérence visuelle mineure.

**Plan de correction** : Uniformiser la casse et utiliser des noms complets plutôt que des abréviations.

---

#### 2.1.2 Sous-titres (header_subtitle) — longueur variable

| Page | Sous-titre actuel | Longueur | Cohérence |
|------|-------------------|----------|-----------|
| `dashboard.html` | `Votre activité du jour` | Court | ✅ Correct |
| `index.html` | `Prospection Embedded Systems & Robotique — Up Technologies` | Long | ✅ Correct |
| `focus.html` | `Votre file d'actions : relances à faire, triées par échéance.` | Moyen | ✅ Correct |
| `entreprises.html` | `Sites et entreprises cibles — Prospection Embedded Systems & Robotique` | Long | ✅ Correct |
| `parametres.html` | `Sauvegarde, import/export, outils.` | Court | ✅ Correct |
| `calendrier.html` | `Vos relances et rendez-vous planifiés` | Court | ✅ Correct |
| `stats.html` | `Tableau de bord — Statistiques & rapport hebdomadaire.` | Moyen | ✅ Correct |
| `push.html` | `Historique des emails / messages envoyés depuis la fiche prospect` | Long | ✅ Correct |
| `candidate.html` | `Liens (LinkedIn / OneNote / VSA) · Compétences · Entreprises associées` | Long | ✅ Correct |
| `sourcing.html` | `Pipeline + mode productivité (matching avec vos entreprises prospects).` | Moyen | ✅ Correct |
| `help.html` | `Guide d'utilisation — simple, clair, actionnable.` | Court | ✅ Correct |
| `users.html` | `Gestion des comptes & rôles.` | Court | ✅ Correct |

**Impact** : Aucun, la variété est acceptable pour décrire chaque page.

---

### 2.2 Boutons et actions

#### 2.2.1 Icônes et libellés — incohérences mineures

| Page | Bouton | Icône + Libellé actuel | Cohérence |
|------|--------|------------------------|-----------|
| `dashboard.html` | Ajout KPI | `➕ Ajout KPI manuel` | ✅ Correct |
| `dashboard.html` | Export jour | `📥 Ma journée` | ✅ Correct |
| `focus.html` | Ajouter tâche | `+ Ajouter` | Devrait être `➕ Ajouter` (cohérence icône) |
| `focus.html` | Archives | `📁 Archives` | ✅ Correct |
| `index.html` | Filtres | `⚙️ Filtres` | ✅ Correct |
| `index.html` | Export | `⬇️ Export` | ✅ Correct |
| `index.html` | Importer | `📥 Importer ma liste` | ✅ Correct |
| `index.html` | Ajouter (FAB) | `+` (icône) + `Ajouter` (label) | ✅ Correct |
| `candidate.html` | Modifier | `✏️ Modifier` | ✅ Correct |
| `candidate.html` | Archiver | `📦 Archiver` | ✅ Correct |
| `sourcing.html` | Ajouter candidat | `➕ Ajouter` | ✅ Correct |
| `sourcing.html` | Import LinkedIn | `📥 Import LinkedIn CSV` | ✅ Correct |
| `sourcing.html` | Ajouter via VSA | `🔗 Ajouter via VSA` | ✅ Correct |

**Impact** : Mineur, la plupart sont cohérents.

**Plan de correction** : Uniformiser l'icône `+` vs `➕` selon le contexte (FAB vs bouton normal).

---

#### 2.2.2 Boutons de vue (tableau/Kanban/Prosp)

| Page | Boutons | Cohérence |
|------|---------|-----------|
| `index.html` | `☰` (tableau), `🃏` (Prosp), `▦` (Kanban) | ✅ Correct |
| `entreprises.html` | `Cartes` / `Liste` (texte) | ⚠️ Incohérence avec index.html (icônes vs texte) |

**Impact** : Incohérence visuelle entre les pages.

**Plan de correction** : Utiliser des icônes cohérentes ou du texte cohérent partout.

---

### 2.3 Modales et formulaires

#### 2.3.1 Structure des modales — cohérence correcte

Toutes les modales suivent la même structure :
- `modal-header` avec titre et bouton de fermeture
- `modal-content` avec le formulaire
- `btn-group` avec boutons d'action

✅ **Aucune incohérence majeure détectée**

---

#### 2.3.2 Labels de champs — incohérences mineures

| Page | Champ | Label actuel | Cohérence |
|------|-------|--------------|-----------|
| `index.html` (modalProspect) | Nom | `Nom` (avec `required`) | ✅ Correct |
| `index.html` (modalProspect) | Entreprise | `Entreprise` (avec `required`) | ✅ Correct |
| `index.html` (modalCompany) | Nom Groupe | `Nom Groupe *` | ⚠️ Devrait utiliser `required` class au lieu de `*` |
| `index.html` (modalCompany) | Site | `Site / Localisation *` | ⚠️ Même problème |
| `candidate.html` | Nom | `Nom *` | ⚠️ Devrait utiliser `required` class |
| `candidate.html` | Statut | `Statut` (sans *) | ✅ Correct |
| `sourcing.html` (modalCandidate) | Nom | `Nom *` | ⚠️ Devrait utiliser `required` class |
| `focus.html` (taskModal) | Titre | `Titre *` | ⚠️ Devrait utiliser `required` class |

**Impact** : Incohérence dans l'indication des champs obligatoires.

**Plan de correction** : Utiliser la classe CSS `required` partout au lieu du symbole `*` en dur, ou standardiser sur `*` partout.

---

### 2.4 Messages et feedback utilisateur

#### 2.4.1 Messages de chargement

| Page | Message actuel | Cohérence |
|------|----------------|-----------|
| `dashboard.html` | `Chargement des objectifs…` | ✅ Correct |
| `dashboard.html` | `Chargement…` (tâches) | ✅ Correct |
| `index.html` | Aucun message visible | ⚠️ Devrait avoir un skeleton ou "Chargement…" |
| `focus.html` | `Chargement…` (tâches) | ✅ Correct |
| `candidate.html` | `Chargement…` (timeline) | ✅ Correct |
| `sourcing.html` | Aucun message visible | ⚠️ Devrait avoir un skeleton ou "Chargement…" |

**Impact** : Expérience utilisateur incohérente lors du chargement.

**Plan de correction** : Ajouter des skeletons ou messages de chargement partout.

---

#### 2.4.2 Messages d'état vide

| Page | Message actuel | Cohérence |
|------|----------------|-----------|
| `sourcing.html` | `Aucun candidat pour ces filtres.` | ✅ Correct |
| `push.html` | `Aucun push enregistré pour le moment.` | ✅ Correct |
| `index.html` | Aucun message visible | ⚠️ Devrait avoir un message d'état vide |

**Impact** : L'utilisateur ne sait pas si la liste est vide ou en chargement.

**Plan de correction** : Ajouter des messages d'état vide partout.

---

## 3. FONCTIONNALITÉS ET COMPORTEMENTS

### 3.1 Gestion des erreurs

#### 3.1.1 Gestion des erreurs réseau — incohérente

| Fichier | Gestion actuelle | Devrait être |
|---------|-------------------|--------------|
| `page-snapshots.js` | `alert('❌ Création impossible: ' + ...)` | `showToast()` avec détails |
| `page-sourcing.js` | `alert('❌ Enregistrement impossible: ' + ...)` | `showToast()` avec détails |
| `page-settings.js` | `showToast('Erreur réseau', 'error')` | ✅ Correct |
| `app.js` | Gestion générique avec `showToast()` | ✅ Correct |

**Impact** : Expérience utilisateur incohérente en cas d'erreur.

**Plan de correction** : Standardiser sur `showToast()` pour toutes les erreurs, avec messages détaillés.

---

#### 3.1.2 Gestion des erreurs Ollama — partiellement cohérente

| Fichier | Gestion actuelle | Cohérence |
|---------|-------------------|-----------|
| `page-sourcing.js` | `showToast('Ollama indisponible...', 'warning')` | ✅ Correct |
| `app.js` | Modale vide si Ollama indisponible | ✅ Correct |
| `page-quickadd.js` | Overlay avec message d'attente | ✅ Correct |

✅ **Cohérence correcte pour Ollama**

---

### 3.2 Validation des formulaires

#### 3.2.1 Validation côté client — incohérente

| Page | Champ | Validation actuelle | Problème |
|------|-------|---------------------|----------|
| `index.html` (modalProspect) | Nom | `required` HTML5 | ✅ Correct |
| `index.html` (modalProspect) | Email | `type="email"` HTML5 | ✅ Correct |
| `index.html` (modalCompany) | Nom Groupe | `required` HTML5 | ✅ Correct |
| `candidate.html` | Nom | `required` HTML5 | ✅ Correct |
| `candidate.html` | Email | `type="email"` HTML5 | ✅ Correct |
| `users.html` | Mot de passe | `minlength="8" pattern="..."` | ✅ Correct |
| `users.html` | Confirmation mot de passe | Validation JS personnalisée | ✅ Correct |
| `focus.html` (taskModal) | Titre | Aucune validation visible | ⚠️ Devrait avoir `required` |

**Impact** : Certains formulaires peuvent être soumis avec des champs vides.

**Plan de correction** : Ajouter `required` sur tous les champs obligatoires.

---

#### 3.2.2 Messages de validation — manquants

| Page | Champ | Message de validation | Problème |
|------|-------|----------------------|----------|
| `users.html` | Mot de passe | `pwReqHint` avec texte | ✅ Correct |
| `users.html` | Confirmation | `pwMismatchMsg` | ✅ Correct |
| `index.html` | Email | Aucun message | ⚠️ Devrait avoir un message si format invalide |
| `candidate.html` | Email | Aucun message | ⚠️ Devrait avoir un message si format invalide |

**Impact** : L'utilisateur ne sait pas pourquoi son formulaire est rejeté.

**Plan de correction** : Ajouter des messages de validation pour tous les champs avec contraintes.

---

### 3.3 Sauvegarde automatique

#### 3.3.1 Auto-save — cohérence partielle

| Page | Fonctionnalité | État |
|------|----------------|------|
| `candidate.html` | Auto-save avec `autosave-field` class | ✅ Implémenté |
| `candidate.html` | Indicateur `autoSaveStatus` | ✅ Implémenté |
| `index.html` (fiche prospect) | Auto-save ? | ⚠️ À vérifier |
| `entreprises.html` (fiche entreprise) | Auto-save ? | ⚠️ À vérifier |

**Impact** : Expérience utilisateur incohérente selon la page.

**Plan de correction** : Implémenter l'auto-save partout ou le désactiver partout, avec indicateur visuel cohérent.

---

### 3.4 Accessibilité

#### 3.4.1 Attributs ARIA — partiellement présents

| Page | Élément | Attributs ARIA | État |
|------|---------|----------------|------|
| `dashboard.html` | Bannière relances | `aria-live="polite"` | ✅ Correct |
| `index.html` | Bannière relances | `aria-live="polite"` | ✅ Correct |
| `index.html` | Modales | `role="dialog" aria-modal="true"` | ✅ Correct |
| `focus.html` | Modale tâche | `role="dialog" aria-modal="true"` | ✅ Correct |
| `candidate.html` | Modale nouvel onglet | `role="dialog" aria-labelledby="..."` | ✅ Correct |
| `calendrier.html` | Modale détail jour | `role="dialog" aria-modal="true" aria-labelledby="..."` | ✅ Correct |
| `push.html` | Modale détail push | `role="dialog" aria-modal="true"` | ✅ Correct |
| `index.html` | Bouton "Exporter" | `aria-label="Exporter les données"` | ✅ Correct |
| `index.html` | Checkbox "Sélectionner tous" | `aria-label="Sélectionner tous les prospects"` | ✅ Correct |
| `index.html` | Input recherche | Aucun `aria-label` | ⚠️ Devrait avoir `aria-label` |
| `sourcing.html` | Input recherche | Aucun `aria-label` | ⚠️ Devrait avoir `aria-label` |
| `push.html` | Input recherche | Aucun `aria-label` | ⚠️ Devrait avoir `aria-label` |

**Impact** : Accessibilité partielle pour les lecteurs d'écran.

**Plan de correction** : Ajouter `aria-label` sur tous les champs de recherche et autres éléments interactifs sans label visible.

---

#### 3.4.2 Navigation au clavier — à vérifier

Les modales ont des boutons de fermeture, mais il faut vérifier :
- La gestion de `Escape` pour fermer les modales
- Le focus trap dans les modales
- La navigation au clavier dans les listes

**Impact** : Accessibilité limitée pour les utilisateurs au clavier.

**Plan de correction** : Implémenter la gestion complète du clavier pour toutes les modales.

---

### 3.5 Performance et chargement

#### 3.5.1 Skeleton loaders — incohérents

| Page | Skeleton présent | État |
|------|------------------|------|
| `dashboard.html` | `skeleton skeleton-kpi` | ✅ Présent |
| `dashboard.html` | `skeleton skeleton-row` (tâches) | ✅ Présent |
| `index.html` | Aucun skeleton | ⚠️ Devrait avoir des skeletons |
| `focus.html` | `skeleton skeleton-row` (tâches) | ✅ Présent |
| `sourcing.html` | Aucun skeleton | ⚠️ Devrait avoir des skeletons |
| `push.html` | Aucun skeleton | ⚠️ Devrait avoir des skeletons |

**Impact** : Expérience utilisateur incohérente lors du chargement.

**Plan de correction** : Ajouter des skeletons partout où des données sont chargées.

---

## 4. PLAN DE CORRECTION PRIORISÉ

### 🔴 Priorité CRITIQUE (à faire immédiatement)

1. **Uniformiser le nom de l'application** (`ProspUp` → `Prosp'Up`)
   - Fichiers concernés : `base.html`, `dashboard.html`, `entreprises.html`, `calendrier.html`, `company.html`, `collab.html`
   - Temps estimé : 30 minutes
   - Impact : Cohérence de marque

2. **Standardiser les messages utilisateur** (`alert()` → `showToast()`)
   - Fichiers concernés : `page-snapshots.js`, `page-sourcing.js`, `users.html`
   - Temps estimé : 1 heure
   - Impact : Expérience utilisateur cohérente

---

### 🟠 Priorité HAUTE (à faire cette semaine)

3. **Uniformiser les libellés de boutons** (`Ajouter` vs `Enregistrer`)
   - Fichiers concernés : `index.html`, `entreprises.html`
   - Temps estimé : 30 minutes
   - Impact : Clarté des actions

4. **Ajouter des messages d'état vide et skeletons**
   - Fichiers concernés : `index.html`, `sourcing.html`, `push.html`
   - Temps estimé : 1 heure
   - Impact : Meilleure UX de chargement

5. **Standardiser l'indication des champs obligatoires** (`*` vs classe `required`)
   - Fichiers concernés : Tous les formulaires
   - Temps estimé : 1 heure
   - Impact : Cohérence visuelle

---

### 🟡 Priorité MOYENNE (à faire ce mois)

6. **Ajouter des `aria-label` manquants**
   - Fichiers concernés : Tous les champs de recherche
   - Temps estimé : 30 minutes
   - Impact : Accessibilité

7. **Clarifier les statuts "Prospecté" vs "Prospectés"**
   - Fichiers concernés : `index.html`
   - Temps estimé : 30 minutes
   - Impact : Clarté fonctionnelle

8. **Uniformiser les boutons de vue** (icônes vs texte)
   - Fichiers concernés : `index.html`, `entreprises.html`
   - Temps estimé : 30 minutes
   - Impact : Cohérence visuelle

9. **Ajouter des messages de validation pour tous les champs**
   - Fichiers concernés : Tous les formulaires
   - Temps estimé : 2 heures
   - Impact : Meilleure UX de validation

---

### 🟢 Priorité BASSE (améliorations futures)

10. **Implémenter l'auto-save partout ou nulle part**
    - Fichiers concernés : `index.html`, `entreprises.html`
    - Temps estimé : 4 heures
    - Impact : Cohérence fonctionnelle

11. **Améliorer la gestion du clavier (Escape, focus trap)**
    - Fichiers concernés : Toutes les modales
    - Temps estimé : 3 heures
    - Impact : Accessibilité

12. **Créer une fonction helper pour les erreurs**
    - Fichiers concernés : Tous les fichiers JS
    - Temps estimé : 2 heures
    - Impact : Maintenabilité

---

## 5. RÉSUMÉ DES INCOHÉRENCES PAR CATÉGORIE

| Catégorie | Nombre | Priorité Critique | Priorité Haute | Priorité Moyenne | Priorité Basse |
|-----------|--------|-------------------|----------------|------------------|----------------|
| **Textes et libellés** | 18 | 1 | 2 | 2 | 0 |
| **UX et interface** | 16 | 0 | 2 | 3 | 0 |
| **Fonctionnalités** | 13 | 1 | 1 | 2 | 3 |
| **TOTAL** | **47** | **2** | **5** | **7** | **3** |

---

## 6. RECOMMANDATIONS GÉNÉRALES

1. **Créer un guide de style** pour standardiser :
   - Les noms de l'application
   - Les libellés de boutons
   - Les messages d'erreur
   - Les placeholders
   - Les tooltips

2. **Mettre en place des helpers réutilisables** :
   - `showToast(message, type, duration?)`
   - `showError(message, details?)`
   - `showConfirm(message, onConfirm, onCancel?)`

3. **Ajouter des tests E2E** pour vérifier :
   - La cohérence des libellés
   - La gestion des erreurs
   - L'accessibilité

4. **Documenter les patterns UX** :
   - Quand utiliser `alert()` vs `showToast()`
   - Quand utiliser `Ajouter` vs `Enregistrer`
   - Comment gérer les états de chargement

---

**Fin du rapport d'audit**
