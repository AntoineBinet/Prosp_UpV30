# Plan de test — v31.9 + v32.0

Branche : `claude/interactive-timeline-jHz6v`

Coche `[x]` quand testé OK. En cas de bug, remplis la section **Bug** sous l'item (étapes précises + comportement observé + comportement attendu).

---

## 0. Préparation

- [ ] Pull la branche, redémarrer l'app via Paramètres → "Mettre à jour et redémarrer"
- [ ] Vérifier que l'app revient en ligne (badge version `32.0` dans Paramètres > À propos)

**Bug :**
> _(rien à signaler / décrire ici)_

---

## 1. Vérification dépendances Python

### 1.1 Modale check-deps
- [ ] Paramètres → Mise à jour du serveur → bouton **« Vérifier dépendances »** ouvre la modale
- [ ] Le bandeau affiche `X OK / Y à MAJ / Z manquantes` + version Python
- [ ] Toutes les dépendances de `requirements.txt` sont listées avec leur version

**Bug :**
>

### 1.2 État pymupdf + Pillow
- [ ] `pymupdf` apparaît avec statut **✓ OK** (sinon, c'est qu'il n'a pas été installé au redémarrage)
- [ ] `Pillow` apparaît avec statut **✓ OK**

**Bug :**
>

### 1.3 Bouton "Installer ce qui manque"
- [ ] Si une dép manque/est trop ancienne, le bouton apparaît
- [ ] Clic → confirmation → log pip s'affiche → re-scan auto
- [ ] Après installation, statut passe à **✓ OK**

**Bug :**
>

---

## 2. Timeline interactive (v31.9)

### 2.1 Clic pour déplier
- [ ] Sur une fiche prospect avec de l'historique, cliquer sur n'importe quel événement le déplie inline
- [ ] Re-cliquer le replie
- [ ] L'expand affiche les bons détails selon le type (push, note, CR, etc.)

**Bug :**
>

### 2.2 Édition de note inline
- [ ] Sur une note ou note d'appel : clic → expand → textarea pré-remplie avec le contenu
- [ ] Modifier + Enregistrer → la note est mise à jour, toast "Note enregistrée"
- [ ] Annuler → la modif est annulée
- [ ] Supprimer → confirmation → la note disparaît

**Bug :**
>

### 2.3 CR dans la timeline
- [ ] Les CR de réunion apparaissent dans la timeline (pas seulement dans l'onglet CR)
- [ ] Badge "X en attente" visible si tâches non cochées
- [ ] Clic → expand affiche synthèse + prochaine action en encadré
- [ ] Bouton "Ouvrir le CR" → ouvre la modale CR existante avec le bon meeting

**Bug :**
>

### 2.4 Filtres
- [ ] Filtres "Tous / Push / Notes / CR / Fichiers" fonctionnent dans la section Activité
- [ ] Le compteur d'événements est cohérent

**Bug :**
>

### 2.5 Aside "Prochaine action"
- [ ] Si le dernier CR a une `next_action`, elle apparaît dans la colonne droite (encadré accent)
- [ ] Bandeau "X tâches en attente" cliquable → bascule sur l'onglet CR

**Bug :**
>

---

## 3. Pièces jointes — basique (v31.9)

### 3.1 Upload simple
- [ ] Bouton "Fichier" dans la barre Activité ouvre la zone de drop
- [ ] Sélection d'un PDF → bouton "Envoyer" actif → upload réussi → toast
- [ ] Le fichier apparaît immédiatement dans la timeline

**Bug :**
>

### 3.2 Aperçu PDF
- [ ] Clic sur l'événement fichier → expand → bouton "Aperçu"
- [ ] La modale plein écran s'ouvre avec le PDF dans un iframe
- [ ] Échap ou clic sur le fond ferme la modale
- [ ] Bouton Télécharger fonctionne

**Bug :**
>

### 3.3 Aperçu image
- [ ] Upload d'une image (JPG/PNG) → aperçu = image affichée dans la modale
- [ ] Image bien centrée, pas déformée

**Bug :**
>

### 3.4 Téléchargement direct (autres formats)
- [ ] Upload d'un .docx ou .xlsx → aperçu = écran "Aperçu non disponible" + bouton Télécharger

**Bug :**
>

### 3.5 Suppression
- [ ] Bouton "Supprimer" dans l'expand → confirmation → fichier disparaît de la timeline
- [ ] Le fichier est bien supprimé du disque (à vérifier dans `data/user_<id>/attachments/prospect_<id>/`)

**Bug :**
>

---

## 4. Pièces jointes — avancées (v32.0)

### 4.1 Miniatures PDF
- [ ] Upload d'un PDF → la timeline affiche une **vignette de la 1ère page** (pas l'icône générique)
- [ ] Clic sur la vignette → ouvre directement l'aperçu PDF
- [ ] Hover → légère animation (zoom 1.04x)

**Bug :**
>

### 4.2 Miniatures images
- [ ] Upload d'une image → la timeline affiche un mini-aperçu de l'image elle-même

**Bug :**
>

### 4.3 Tags sur fichiers
- [ ] Expand un fichier → champ "+ tag" en bout de ligne Tags
- [ ] Taper un tag + Enter → le tag apparaît en pill, sauvegardé
- [ ] Cliquer le `×` d'un tag → le tag disparaît, sauvegardé
- [ ] Les tags apparaissent aussi en badge sur le titre de l'événement (vue compacte)

**Bug :**
>

### 4.4 Description inline
- [ ] Modifier le champ "Description" dans l'expand
- [ ] Cliquer ailleurs (blur) → sauvegarde silencieuse
- [ ] Recharger la page → la description est bien persistée

**Bug :**
>

### 4.5 Drag-drop global
- [ ] Glisser un fichier depuis l'explorateur **n'importe où sur la fiche prospect**
- [ ] Un overlay plein écran flouté apparaît avec "Déposer pour joindre au prospect"
- [ ] Lâcher → upload + ajout dans la timeline + toast
- [ ] Fonctionne avec plusieurs fichiers en même temps

**Bug :**
>

### 4.6 Recherche full-text
- [ ] Barre "Rechercher dans la timeline" filtre en temps réel
- [ ] Recherche dans : titres, contenus de note, synthèse CR, prochaine action, nom de fichier, tags
- [ ] Si PDF text indexé : recherche dans le contenu du PDF aussi
- [ ] Compteur "X / Y" à droite de la barre

**Bug :**
>

### 4.7 Picker fichiers dans modale CR
- [ ] Ouvrir un CR (nouveau ou existant) → étape 2 (formulaire)
- [ ] Section "Pièces jointes — cocher pour rattacher au CR"
- [ ] La liste affiche tous les fichiers du prospect avec checkbox
- [ ] Si CR existant : les fichiers déjà liés sont pré-cochés
- [ ] Cocher/décocher + Enregistrer → liaison persistée (rouvrir le CR le confirme)

**Bug :**
>

---

## 5. IA & rappels (v32.0)

### 5.1 Bouton "Résumer"
- [ ] Bouton "Résumer" dans le header de la fiche
- [ ] Clic → bandeau bleu apparaît avec "Génération en cours…"
- [ ] Après quelques secondes : 5 lignes synthétisant le prospect (rôle, statut, échanges, accroches, prochaine action)
- [ ] Bouton ↻ → régénère un nouveau résumé
- [ ] Bouton × → masque le bandeau
- [ ] Re-cliquer "Résumer" → renvoie le résumé en cache instantanément

**Bug :**
>

### 5.2 Rappel RDV J-2 (notif PWA)
- [ ] Avoir une fiche prospect avec un `nextFollowUp` dans les prochaines 48h
- [ ] Activer les notifications navigateur (Paramètres > Notifications)
- [ ] Ouvrir une fiche prospect → après ~3s, notification système "RDV à venir : …"
- [ ] Une seule notif par jour (pas de spam)
- [ ] Clic sur la notif → focus + redirection /v30/dashboard

**Bug :**
>

---

## 6. Multi-user (sécurité)

- [ ] Avec un compte A : uploader un fichier sur un prospect
- [ ] Se connecter en compte B (admin différent ou editor)
- [ ] Le fichier ne doit PAS être visible / téléchargeable / listable
- [ ] L'API `/api/prospect/attachments?prospect_id=…` retourne 403 ou liste vide

**Bug :**
>

---

## 7. Régressions à surveiller

### 7.1 Onglet CR existant
- [ ] L'onglet CR fonctionne comme avant (liste, création, édition via le modal complet)
- [ ] La grille de qualif n'a pas été cassée
- [ ] Les action items se créent/éditent/cochent correctement

**Bug :**
>

### 7.2 Push, appels, notes (existant)
- [ ] Bouton Pousser fonctionne (popup v30 push)
- [ ] Bouton Appeler fonctionne, log un événement appel
- [ ] Bouton "+ Note" dans Activité ajoute une note

**Bug :**
>

### 7.3 Mobile
- [ ] La fiche est correctement rendue sur mobile (largeur < 900px)
- [ ] Les filtres + bouton Fichier ne débordent pas
- [ ] L'upload fonctionne (pas de drag-drop sur mobile mais clic OK)
- [ ] La modale d'aperçu est utilisable

**Bug :**
>

---

## 8. Performance / robustesse

- [ ] Charger une fiche avec ~50+ événements : pas de lag perceptible
- [ ] Upload d'un PDF de 10 Mo : pas d'erreur, miniature générée
- [ ] Upload d'un fichier > 50 Mo : message d'erreur clair, pas de crash
- [ ] Upload d'un fichier .exe ou autre extension non autorisée : refusé proprement
- [ ] Si pymupdf manquant : upload PDF marche quand même (sans miniature, sans extraction)

**Bug :**
>

---

## Notes générales / observations transversales

> _(idées d'amélioration, comportements bizarres mais pas bloquants, priorités à revoir, etc.)_

>

>

>
