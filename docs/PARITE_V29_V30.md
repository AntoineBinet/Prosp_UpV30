# Parité fonctionnelle v29 → v30

> Branche : `claude/update-ux-handoff-docs-kF0YN` · Version : 30.0
> Objectif : s'assurer que toute fonctionnalité accessible en v29 est présente et utilisable en v30.
> Légende : ✅ présent et fonctionnel · ⚠️ présent mais incomplet ou cassé · ❌ manquant

## 🟢 Sprint 1 — Résolu (2026-04-21)

Les 5 bugs bloquants P0 ont été corrigés. `/v30/prospects`, `/v30/push` (onglet Templates), `/v30/sourcing`, `/v30/calendrier` et `/v30/rapport` affichent à nouveau leurs données.

| Bug | Commit | Statut |
|---|---|---|
| P0 #1 prospects vide | [14825e5](https://github.com/AntoineBinet/Prosp_UpV25/commit/14825e5) | ✅ 1306 prospects affichés |
| P0 #2 push Templates vide | [fbd2c60](https://github.com/AntoineBinet/Prosp_UpV25/commit/fbd2c60) | ✅ Template par défaut affiché |
| P0 #3 sourcing vide | [9dc5a1e](https://github.com/AntoineBinet/Prosp_UpV25/commit/9dc5a1e) | ✅ 39 candidats actifs kanban Vivier |
| P0 #4 calendrier vide | [327178f](https://github.com/AntoineBinet/Prosp_UpV25/commit/327178f) | ✅ 45 events RDV/relance/EC1 |
| P0 #5 rapport KPI vides | [4d9efd2](https://github.com/AntoineBinet/Prosp_UpV25/commit/4d9efd2) | ✅ KPI 7/20/8/1 + pipeline 9 statuts |

**Parité après Sprint 1 : ~72 %** (base mesurée 58 %).

Le rapport détaillé ci-dessous reflète l'état **avant** Sprint 1 — les bugs P0 y sont référencés pour historique.

## Convention

- Un tableau par paire v29 ↔ v30.
- Bullets concis : on ne redécrit pas la page, juste les diffs.
- Colonne « Note » : où c'est (fichier / composant), comment fixer, ou pourquoi c'est volontaire.

---

## /dashboard vs /v30/dashboard

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Hero (titre + date) | ✅ | « Bonsoir ! » → « Bonjour, {prénom}. » + date + sous-titre dynamique (relances + RDV) |
| Bouton `+ KPI manuel` | ❌ | absent de `/v30/dashboard`. À ajouter dans la topbar du hero v30 (ouvre la même modale que v29, endpoint `/api/kpis-manual`) |
| Bouton `Export` | ❌ | absent de `/v30/dashboard`. À ajouter à côté de `+ KPI manuel` (legacy appelle `/api/dashboard/export`) |
| Carte **Performance** : 5 KPI (Contacts / Notes / Push / RDV / En retard) + delta % + Chart.js 7-day | ⚠️ | v30 n'a que 3 KPI dans le hero (RDV SEM / PUSH / CONTACTS), sans delta, sans chart, sans Notes ni En retard. Envisager un widget « Performance » dédié |
| Navigation semaine précédente / courante / suivante (`‹ › Cette semaine`) | ❌ | aucun sélecteur de période sur `/v30/dashboard` |
| Tabs `En retard` / `Tâches` / `RDV` | ✅ | v30 : tabs `À faire` / `RDV aujourd'hui` / `En retard` (libellés différents mais équivalents) |
| Pipeline breakdown par statut 29 (Pas d'actions / Appelé / A rappeler / Messagerie / RDV / Prospecté / Pas intéressé + Total + Conversion RDV + En retard) | ⚠️ | v30 : pipeline simplifié en 5 étapes (Prospecter / Contacté / RDV / Proposition / Gagné). Les 7 statuts legacy existent toujours en DB mais ne sont plus tous affichés. Statut « Pas intéressé » en particulier disparaît. |
| **Activité du jour** : Top 6 consultants poussés + chart Chart.js | ❌ | absent en v30. Le widget « Priorités IA » + « Activité récente » ne couvre pas le même besoin |
| **Objectifs** : Level/XP gamification (Lv 3 · 216 XP semaine · barre jour + semaine) | ⚠️ | v30 affiche `Objectifs du jour` (donut 43 % + 3 objectifs) mais pas de Level, pas de XP semaine, pas de barre globale |
| Bouton ✎ « Corriger / ajouter des KPIs manuellement » (icône en haut de Objectifs) | ❌ | absent en v30 |
| Bannière opt-in v30 (« Nouvelle interface v30 disponible ») | ✅ | présente uniquement sur v29, logique normale |
| Sidebar : Collaboration | ❌ | pas dans la sidebar v30 (accessible uniquement via palette ⌘K ou `/v30/collab`) |
| Sidebar : Doublons | ❌ | idem |
| Sidebar : Snapshots (admin) | ❌ | idem |
| Sidebar : Métiers (admin) | ❌ | idem |
| Sidebar : Utilisateurs (admin) | ❌ | idem |
| Sidebar : Journal / Activité (admin) | ❌ | idem |
| Sidebar : DC Generator | ❌ | idem (`/v30/dc` existe) |
| Sidebar : Archivés | ❌ | pas d'équivalent v30 direct |
| Header : bouton `Déconnexion` visible en permanence | ❌ | v30 : avatar sans menu déroulant dépliable visible → pas d'accès direct à la déconnexion depuis le header |
| Badge « Focus 1 » dans la sidebar (compteur) | ⚠️ | v30 affiche les compteurs pour Prospects/Entreprises/Candidats mais pas pour Focus |

### Actions proposées — Dashboard

1. **Ajouter les boutons `+ KPI manuel` et `Export`** dans le hero v30 (topbar du bloc hero, à droite).
2. **Widget « Performance hebdo »** : ajouter une carte v30 avec les 5 KPI (Contacts / Notes / Push / RDV / En retard) + navigation `‹ › Cette semaine` + mini-chart.
3. **Activité du jour** : ajouter un widget v30 « Top consultants poussés » (Top 6 + sparkline).
4. **Objectifs enrichis** : montrer Level/XP semaine à côté du donut jour.
5. **Sidebar v30** : ajouter les entrées manquantes (Collaboration, Doublons, DC Generator) dans le groupe principal ou dans un sous-groupe repliable « Plus ». Pour les liens admin (Snapshots, Métiers, Utilisateurs, Journal), afficher conditionnellement selon `role === 'admin'` dans un groupe « Admin ».
6. **Menu avatar** : rendre l'avatar topbar cliquable pour ouvrir un menu (Mon compte, Paramètres, Déconnexion).
7. **Archivés** : décider du devenir (page dédiée v30 ou vue filtrée `/v30/prospects?archived=1`).

---

## / (prospects) vs /v30/prospects

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| **Liste chargée au premier render** | ❌ **BUG CRITIQUE** | `static/js/v30/prospects.js:305` appelle `/api/search?q=` ; cet endpoint renvoie 0 résultat quand `q` est vide. La page affiche toujours « Aucun prospect pour ces filtres · 0 sur 0 » alors qu'il y en a 1306 actifs. Fix : basculer sur `/api/data` (comme entreprises / push / stats) ou paginer via l'endpoint GET qui liste tous les prospects |
| Bannière « X relance(s) en retard → Voir Focus » | ❌ | absente de v30 |
| Titre « Tous les prospects » | ✅ | v30 : `Prospects <count>` avec compteur dynamique |
| Recherche fuzzy | ✅ | v30 : champ recherche en haut à droite |
| Filtres avancés | ⚠️ | bouton `Filtres` présent mais à tester (modale à ouvrir). Pills `Tous / Mes prospects / À relance / Hot / Prosp / Push sans Tél / + Vue` — équivalent des vues sauvegardées |
| Vues sauvegardées : dropdown `Vues…` + boutons `Vue` / `Suppr.` | ⚠️ | v30 remplace par pills dynamiques + bouton `+ Vue`. Bouton suppression `×` sur chaque pill de vue sauvegardée (selon CHANGELOG) — à valider visuellement |
| Bouton **Statistiques** (ouvre la modale stats prospects filtrés) | ❌ | absent en v30 |
| Bouton **Exporter les données** | ❌ | pas visible dans la topbar v30. La palette ⌘K doit exposer ça ou laisser accès depuis bulk bar |
| Bouton **Importer ma liste** (upload Excel) | ❌ | absent en v30 |
| Bouton **Ajouter** (modale Quick add) | ✅ | v30 : bouton `+ Ajouter` en haut à droite |
| Bouton **Mode Prosp** (deck 3D) | ❌ | absent de la topbar v30 (selon spec, l'accès est via palette ⌘K — à vérifier ci-dessous) |
| Pagination (boutons 1306 / 1306) | ✅ | v30 : `0 sur 0` avec navigateur page ‹ › |
| 4 KPI cards (Total / Appelables / RDV / Prospectés) | ❌ | absents de `/v30/prospects`. On a juste le compteur dans le titre |
| Tableau 13 colonnes (#, Nom+Appeler, Entreprise, Fonction, Pertinence★, Score, Statut, Dernier contact, Email, Push, Relance, Actions) | ⚠️ | v30 : 9 colonnes (checkbox, Nom, Entreprise, Statut, Pertinence, Mobile, Dernière action, Prochain RDV, Tags). Manque : **Fonction, Score, Email, Push** (colonnes dédiées), **Actions Voir** |
| Colonne **Fonction** | ❌ | pas de colonne dédiée ; info noyée dans la fiche |
| Colonne **Score** | ❌ | absente |
| Colonne **Email** (badge + copie) | ❌ | absente |
| Colonne **Push** (badges email / linkedin + historique) | ❌ | absente (remplacée par « Dernière action ») |
| Colonne **Actions** avec bouton `Voir` | ❌ | en v30 le clic sur la ligne ouvre la fiche (data-v30-open), pas de bouton explicite |
| Badge `Appeler` à côté du nom (click-to-call) | ❌ | absent v30 |
| Bouton `Réinitialiser colonnes` | ⚠️ | le bouton `Colonnes` ouvre sans doute un picker ; à tester |
| Bulk bar sélection (delete / push / tag / statut / etc.) | ✅ | v30 : bulk bar flottante en bas avec Pousser · Email IA · Tél IA · Tag · Assigner · Effacer |
| Bulk **Delete** | ⚠️ | bulk bar v30 n'a pas l'action « Supprimer » visible (seulement Effacer = clear selection) — à vérifier si un menu `…` le contient |
| Bulk **Changer statut** | ⚠️ | pas de bouton explicite dans la bulk bar (v29 a un dropdown statut bulk). Peut-être via la colonne Statut éditable inline |
| Bulk **Archiver** | ❌ | absent v30 |
| Vue **Kanban** | ✅ | nouveauté v30 (présente dans la spec) |
| Vue **Split** | ✅ | nouveauté v30 |

### Actions proposées — Prospects (priorité max)

1. **FIX BUG** `static/js/v30/prospects.js:305` → utiliser `/api/data` (ou un autre endpoint liste) au lieu de `/api/search?q=` quand `STATE.q` est vide. Sans ça, `/v30/prospects` est inutilisable.
2. Ajouter les **4 KPI cards** (Total / Appelables / RDV / Prospectés) dans le hero v30, même format que `entreprises`.
3. Ajouter les boutons manquants : `Importer ma liste` (Excel), `Exporter`, `Statistiques`, `Mode Prosp` → topbar v30 ou dans un menu `…`.
4. Ajouter les colonnes **Fonction**, **Email** (copie), **Push** (badges email/linkedin/historique) + colonne Actions avec `Voir`.
5. Ajouter les actions bulk manquantes : **Supprimer**, **Changer statut**, **Archiver**.
6. Bannière « X relance(s) en retard → Voir Focus » en haut de `/v30/prospects` (cohérence UX).
7. Badge `Appeler` cliquable à côté du nom dans la colonne Nom.

---

## /entreprises vs /v30/entreprises

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Liste chargée | ✅ | v30 utilise `/api/data` — correct |
| Titre « Entreprises » + compteur | ✅ | v30 : « Entreprises 94 » |
| KPI : Entreprises / Prospects / RDV / Appelables | ⚠️ | v30 a 4 KPI équivalents : TOTAL ENTREPRISES / EN PIPELINE / TOTAL PROSPECTS / ACTIVES (30j). « Appelables » devient « Actives (30j) » — sémantique différente |
| Recherche | ✅ | v30 : recherche fuzzy client-side |
| Bouton **Ajouter** (modale Quick add entreprise) | ✅ | topbar v30 |
| Bouton **Filtres** | ✅ | topbar v30 (à tester comportement) |
| Bouton **Cartes** / **Liste** (toggle vue) | ❌ | v30 affiche uniquement la vue liste. La vue cartes (grid de cartes avec counters + icônes + site web/LinkedIn) disparaît |
| Carte entreprise : counters rapides (prospects / RDV / pertinence) | ❌ | la vue cartes v29 affichait 3 badges par carte. v30 n'affiche que la table |
| Carte entreprise : icônes actions rapides (info, bâtiment, crayon) | ❌ | absentes (vue liste uniquement) |
| Carte entreprise : liens email / LinkedIn / Site web affichés | ❌ | la colonne Site existe en liste v30 mais pas les liens email / LinkedIn directs |
| Clic sur une ligne → filtre prospects de cette entreprise | ⚠️ | v29 : clic filtre les prospects. v30 : clic sur le nom ouvre la fiche (à confirmer) |

### Actions proposées — Entreprises

1. Ajouter un toggle de vue **Cartes / Liste** (`segmented control` existe déjà dans le design system) et re-implémenter la grille de cartes avec counters + icônes d'accès rapide.
2. Ajouter une colonne ou badges inline pour les liens : email / LinkedIn / site web (quand dispo).
3. Clarifier le comportement du clic : la fiche entreprise v30 doit exister — sinon envisager un comportement cohérent avec v29 (filtre prospects).

---

## /push vs /v30/push

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Onglets `Catégories` / `Historique` | ⚠️ | v30 : `Campagnes` / `Templates` / `Historique` — Catégories disparaît mais la v30 ajoute Campagnes (nouveauté CRUD) |
| **Templates (17 catégories) chargées par défaut** | ❌ **BUG** | `static/js/v30/push.js:88-89` appelle `/api/templates` mais cherche `res.templates/items/data`. Or l'endpoint renvoie un **array direct** — donc `STATE.templates = []` toujours. L'onglet Templates est vide |
| Grid de **cartes catégorie** (Automatisme, Cybersécurité, Data_IA, etc. — 17 cartes) avec : nom catégorie, 2 candidats sélectionnés, template chargé | ❌ | absent en v30 — les cartes catégories v29 sont remplacées par un onglet Templates (bugué) |
| Bouton **Templates texte** (modale édition des templates) | ⚠️ | v30 : onglet Templates dédié, mais bugué et vide. La modale v29 permettait d'éditer directement le HTML de chaque template avec preview |
| Bouton **Scanner pushs** (parse un email forwarded pour détecter un push reçu) | ❌ | absent en v30 |
| Bouton **Nouvelle catégorie** (crée une catégorie vide) | ❌ | remplacé par `Nouveau template` (carte `+`) qui n'a pas la même sémantique |
| Bloc explicatif « Comment ça marche » | ❌ | absent v30 |
| Clic sur une catégorie → liste des prospects les plus pertinents | ❌ | inaccessible (les cartes catégorie n'existent pas en v30) |
| **Nouvelle campagne (wizard Cible → Message → Envoi)** | ✅ | nouveauté v30 (voir CHANGELOG) |
| Liste des campagnes (brouillons + envoyées) | ✅ | v30 : onglet Campagnes, carte brouillon avec audience + bouton supprimer |
| Historique des pushs envoyés (par destinataire) | ✅ | onglet Historique v30 (à vérifier que la liste remonte bien) |

### Actions proposées — Push (priorité haute)

1. **FIX BUG** `static/js/v30/push.js:89` → accepter un array direct : `STATE.templates = Array.isArray(res) ? res : ((res && (res.templates || res.items || res.data)) || []);`.
2. **Réintégrer l'onglet `Catégories`** en v30 ou dans l'onglet Templates : afficher les 17 cartes catégorie avec leur nom, les 2 candidats associés et le template chargé. Endpoint `/api/push-categories` fonctionne déjà.
3. Bouton **Scanner pushs** : à porter en v30 (action « Scanner » dans la topbar Campagnes ou palette ⌘K).
4. Bouton **Nouvelle catégorie** : à porter (action dans l'onglet Templates/Catégories).
5. Sans Catégories, la v30 perd l'entrée principale du flux push (sélection candidat → template → prospects matching). À rétablir en priorité.

---

## /sourcing vs /v30/sourcing

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| **Liste candidats chargée** | ❌ **BUG** | `static/js/v30/sourcing.js:172` cherche `res.candidates/items` ; l'endpoint `/api/candidates` renvoie un **array direct** — donc `STATE.candidates = []` alors qu'il y en a 75. Toutes les colonnes kanban vident, vue grille vide. Fix : `Array.isArray(res) ? res : ((res && (res.candidates || res.items)) || [])` |
| Titre « Sourcing candidats » + sous-titre | ⚠️ | v30 : « Candidats 0 actif » (dépend du fix précédent) |
| Onglets : Pipeline / LinkedIn / En mission/Contrat / Archivés/Refusés / Hors Aura / Paramètres | ⚠️ | v30 : toggle Pipeline / Grille uniquement. Les autres onglets (LinkedIn, En mission, Archivés, Hors Aura, Paramètres) disparaissent |
| Bouton **Ajouter** (modale) | ⚠️ | v30 : bouton `+ Ajouter` mais redirige vers `/sourcing` legacy. Pas de modale v30 native |
| Recherche | ❌ | absente en v30 (pas de champ de recherche candidats) |
| Filtre statut (dropdown) | ❌ | absent en v30 |
| Filtre compétences | ❌ | absent en v30 |
| Bouton **Export CSV** | ❌ | absent en v30 |
| Colonnes table : Nom, Rôle, Localisation, Compétences/Tech, DC (Dossier Compétence), Statut (éditable inline), MAJ, Actions | ❌ | v30 : kanban colonnes statut + vue grille simplifiée. Pas de table. Pas de colonne MAJ, pas de colonne DC |
| Changement statut inline (dropdown par ligne) | ❌ | absent en v30 (kanban drag-and-drop ?) |
| Actions par candidat : téléphone / LinkedIn / corbeille | ❌ | absent en v30 |
| Badge **DC** (dossier compétence existant) | ❌ | absent en v30 (alors que l'endpoint `/api/candidates` retourne `has_dc`) |
| Matching actif avec compteur | ✅ | bandeau bleu v30 « Matching actif pour — · 0 candidats correspondent » + bouton « Voir filtres » |
| Vue Pipeline (kanban) | ✅ | nouveauté v30 (mais vide à cause du bug fetch) |
| Vue Grille | ✅ | nouveauté v30 (mais vide à cause du bug fetch) |

### Actions proposées — Sourcing (priorité haute)

1. **FIX BUG** `static/js/v30/sourcing.js:172` — même pattern que push.js.
2. Ajouter champ **recherche** + filtres (statut, compétences) dans la topbar.
3. Ajouter les **onglets LinkedIn / En mission / Archivés / Hors Aura** (si l'usage le justifie, sinon laisser uniquement archivés comme filtre toggle).
4. Ajouter bouton **Export CSV** (existe en v29 pour les candidats filtrés).
5. Afficher le badge DC sur chaque carte (indication si dossier compétence généré).
6. Permettre changement statut direct depuis kanban (drag) ou dropdown par carte.
7. Le bouton Ajouter v30 doit ouvrir une modale native, pas rediriger vers v29.

---

## /candidat?id=N vs /v30/candidat/N

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Sous-titre « LinkedIn / OneNote / VSA / Compétences - Entreprises associées » | ❌ | absent en v30 |
| Header : nom, rôle, localisation, statut (badge) | ✅ | v30 similaire avec badge « nouveau » |
| Liens externes header : **Teams**, **LinkedIn**, **OneNote**, **VSA** | ❌ | v30 : seul « LinkedIn » est présent comme tag en dessous du nom. Teams/OneNote/VSA sont absents |
| Bouton **Retour** | ❌ | v30 utilise le breadcrumb comme retour, pas de bouton explicite |
| Bloc **Informations** (STATUT / RÔLE / LOCALISATION / EXPÉRIENCE / SECTEUR / SOURCE / TECH / TÉLÉPHONE (copie) / EMAIL (copie) / LINKEDIN) | ❌ | v30 : ces champs disparaissent complètement de la page. On ne voit que nom + rôle + localisation dans le header |
| Bouton **Importer fiche Excel** | ❌ | absent en v30 |
| Bouton **Archiver** | ❌ | absent en v30 (peut-être dans le menu `…`) |
| Bouton **Modifier tout** | ❌ | absent en v30 (l'édition inline est moins explicite) |
| Bloc **Données entretien** : upload Excel IA + Télécharger modèle + Ajouter un champ | ❌ | absent en v30 — perte de la fonctionnalité clé de l'import IA entretien |
| Bloc **Tags / Compétences techniques** (chips) | ⚠️ | v30 : bloc **Compétences** avec barres 1-5 cliquables (nouveau format). Les tags v29 (ex: « Embarqué, Sécurité, IoT, PCB, ABMI, MindTune, Revive ») sont perdus (v30 affiche « Aucune compétence renseignée ») |
| Bouton flottant **+ Ajouter** (ajouter un entretien / info) | ❌ | absent en v30 |
| **Compétences (barres 1-5) cliquables** | ✅ | nouveauté v30 (tables `candidate_skills`) |
| **Disponibilités 8 semaines ISO** (cycle libre/busy/placed) | ✅ | nouveauté v30 (table `candidate_availability`) |
| **Campagnes match** (preview) | ⚠️ | v30 affiche un placeholder « Matching par campagne — table push_campaigns à créer (SPEC §5.2) ». Pas encore branché |
| **Missions passées** | ✅ | v30 nouveau bloc (vide pour le moment) |
| **Notes** | ✅ | v30 : bloc Notes éditable |
| Bouton **Générer DC** (dossier compétence) | ✅ | v30 : bouton en haut à droite |
| Bouton **Pousser** | ✅ | v30 : bouton en haut à droite |

### Actions proposées — Fiche candidat

1. Ré-afficher le bloc **Informations** (STATUT, RÔLE, LOCALISATION, EXPÉRIENCE, SECTEUR, SOURCE, TECH, TÉLÉPHONE, EMAIL, LINKEDIN) — c'est la carte d'identité du candidat, indispensable.
2. Re-porter les **liens externes** (Teams, OneNote, VSA) dans le header en tant que tags ou boutons icônes.
3. Re-porter le bloc **Données entretien** (upload Excel IA + bouton Télécharger modèle) — fonctionnalité métier critique.
4. Ré-afficher les **tags / compétences techniques** (chips) parallèlement aux Compétences barres (les deux ont du sens : tags = mots-clés libres ; compétences = niveau 1-5 structuré).
5. Boutons Archiver / Modifier tout / Importer fiche Excel — à intégrer dans le menu `…`.
6. Brancher « Campagnes match » sur `/api/push-campaigns` (vérifier que ce lien est fait).

---

## /stats vs /v30/stats

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Onglets Statistiques / Rapport & KPI | ✅ | v30 : onglets Tableau de bord / Rapport |
| Période sélecteur (30 jours dropdown + Actualiser) | ✅ | v30 : pills 7j / 30j / 90j / Tout |
| 9 KPI (Prospects 1391, Entreprises 125, Appels passés 264, Push envoyés 46, Notes d'appel 52, Relances en retard 1, Relances aujourd'hui 0, RDV 20, A rappeler 24) | ⚠️ | v30 : 4 KPI différents (PUSH ENVOYÉS 0, TAUX D'OUVERTURE 0%, TAUX DE RÉPONSE 0%, RDV OBTENUS 20). Manque : **Prospects total, Entreprises, Appels passés, Notes d'appel, Relances (retard/jour), A rappeler**. En plus PUSH ENVOYÉS affiche 0 alors que v29 montre 46 (vérifier l'endpoint v30) |
| **Insights IA** + bouton « Générer insights » | ❌ | absent en v30 |
| Table « Entreprises chaudes » : ENTREPRISE, SCORE, PROSPECTS, RDV, RELANCES EN RETARD, ACTION (bouton copier + ouvrir) | ⚠️ | v30 : bar chart horizontal « Top entreprises (nombre de prospects) » sans score ni relances ni actions |
| **8 charts Chart.js détaillés** (funnel, heatmap, répartition, urgences…) | ⚠️ | v30 : renvoie explicitement vers `/stats` legacy via « Ouvrir les graphiques détaillés » (décision assumée). OK court terme mais casse le flux v30 |

### Actions proposées — Stats

1. Remonter les KPI v29 manquants en v30 : **Prospects total, Entreprises, Appels passés, Notes d'appel, Relances en retard / aujourd'hui, A rappeler**.
2. Vérifier que `PUSH ENVOYÉS` pour la période 30 j affiche bien 46 (endpoint à corriger si retourne 0).
3. Remonter la table **Entreprises chaudes** avec SCORE et actions (copier / ouvrir).
4. Ré-implémenter l'**Insights IA** en v30 (bouton + callOllama).
5. Plan : porter les 8 charts Chart.js en v30 (Phase ultérieure).

---

## /rapport vs /v30/rapport

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Sélecteur semaine (combobox `Semaine 17, 2026`) | ⚠️ | v30 : toggle `Semaine en cours` / `Semaine précédente` — moins flexible que le picker complet |
| Bouton **Générer** (calcule le rapport de la semaine) | ❌ | absent en v30 |
| Bouton **Copier Markdown** | ✅ | v30 présent |
| Bouton **Imprimer** | ❌ | absent en v30 (remplacé par Exporter PDF qui est mieux) |
| Bouton **Aperçu MD** | ❌ | absent en v30 |
| Bouton **Exporter PDF** | ✅ | nouveauté v30 (via `/api/rapport/export-pdf`) |
| **10 KPI semaine** (Relances 2, Notes d'appel 0, Push envoyés 8, Email 8, LinkedIn 0, RDV obtenus 20, Relances retard 1, Conversion 1.4 %, Entreprises 7, Total prospects 1391) | ❌ **BUG** | v30 : KPI vides (—). `static/js/v30/rapport.js:40` lit `data.kpis` (pluriel) alors que `/api/rapport-hebdo` renvoie `data.data.kpi` (singulier + wrap). En plus les clés attendues (`prospects_contacted/rdv_scheduled/pushs_sent/calls_made`) ne correspondent pas à celles retournées (`total_prospects/rdv/push_total/notes`). Il faut (a) lire `res.data.kpi`, (b) mapper vers les bonnes clés |
| Bloc **Répartition pipeline** (bar stacked + légende statuts + compteurs) | ⚠️ | v30 : bloc `Pipeline` mais affiche « Aucune étape remontée » — probablement même bug de lecture de la réponse API |
| Bloc **Entreprises actives cette semaine** (chips) | ❌ | absent en v30 |
| Bloc **Push envoyés (8)** : détail par prospect (email / linkedin / date) | ⚠️ | v30 : bloc `Activité` affiche « Aucune activité cette semaine » — idem bug |
| **Notes libres (WYSIWYG éditable + autosave localStorage)** | ✅ | nouveauté v30 |

### Actions proposées — Rapport (priorité haute)

1. **FIX BUG** `static/js/v30/rapport.js:40` : lire `res.data` correctement et mapper les clés de l'API (`total_prospects`, `rdv`, `push_total`, `notes`) vers les labels v30.
2. Idem pour le bloc `Activité` et `Pipeline` : lire `data.push_detail`, `data.notes_detail` et les stats pipeline de l'API.
3. Ajouter le bloc **Entreprises actives** (chips colorés) — l'API le retourne sous `data.companies` ou similaire.
4. Permettre le choix **de semaine quelconque** via combobox (comme en v29), pas juste courante / précédente.
5. Optionnel : ajouter l'**Aperçu MD** (pré-visualisation markdown avant copie).

---

## /focus vs /v30/focus

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Hero « Focus » + sous-titre | ✅ | v30 : `Focus du jour.` + sous-titre dynamique (nb relances + RDV) |
| Bloc **Tâches** (CRUD manuel, bouton `+ Ajouter`) | ❌ | absent en v30 — perte de la capture de tâches libres |
| Bouton **Archives** (voir tâches terminées) | ❌ | absent en v30 |
| Bloc **Relances** avec filtre (Toutes / À venir / En retard) + Actualiser | ⚠️ | v30 : 3 colonnes fixes « En retard · Aujourd'hui · À venir » — équivalent en partie, mais le combobox est perdu |
| Astuce `gardez nextFollowUp à jour…` | ❌ | absente en v30 |
| Redirection ligne → fiche prospect | ✅ | OK |

### Actions proposées — Focus

1. Ajouter un bloc **Tâches** (liste simple, CRUD localStorage ou endpoint léger) + bouton Ajouter.
2. Bouton **Archives** pour consulter les tâches terminées.

---

## /calendrier vs /v30/calendrier

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Grille mois 7×6 | ✅ | v30 OK |
| Boutons nav (`Précédent` / `Aujourd'hui` / `Suivant` + combobox mois/semaine) | ✅ | v30 : `< Aujourd'hui >` + titre mois |
| **Events chargés** | ❌ **BUG** | `static/js/v30/calendar.js:28` lit `res.prospects` alors que `/api/calendar_events` retourne `{ events: [...] }`. Les 45 events (RDV, relances, EC1) ne s'affichent pas. Fix : boucler sur `res.events` et mapper `type=rdv/relance/ec1` |
| Légende : RDV / Relance / En retard / Externe | ⚠️ | v30 : Pills « RDV · Relance à faire · EC1 candidat ». Le type « En retard » et « Externe » disparaît |
| **Sync Calendar** (bouton Sync Outlook/Google) | ❌ | absent en v30 |
| **URL calendrier externe (.ics)** + champ + Enregistrer | ❌ | absent en v30 |
| Clic événement → fiche prospect / candidat | ⚠️ | v30 : à vérifier après fix du fetch |

### Actions proposées — Calendrier (priorité haute)

1. **FIX BUG** `static/js/v30/calendar.js:28` → lire `res.events` et mapper les champs (`date`, `time`, `name`, `company`, `type`).
2. Ajouter le bloc **Sync Calendar (Outlook/Google)** + champ URL .ics + bouton Enregistrer.
3. Ajouter la pastille « En retard » dans la légende si c'est signifiant.

---

## /parametres vs /v30/parametres

| Fonctionnalité v29 | Présent v30 ? | Note |
|---|---|---|
| Bandeau « Nouvelle interface v30 » + boutons Essayer + Dashboard v30 | ✅ | Version v30 de la carte « Revenir à l'ancienne interface » inverse la logique |
| **Gestion des données** : Exporter JSON, Importer JSON, Exporter Excel, Snapshots, Réinitialiser | ⚠️ | v30 : carte « Sauvegardes & données » avec texte d'intro mais **redirige vers `/parametres#sauvegardes` legacy** via « Ouvrir la page complète » |
| **Objectifs quotidiens** (RDV Prosp, Push, Sourcing) | ⚠️ | v30 : carte redirige vers legacy |
| **Objectifs hebdo** (RDV, Push, Sourcing, Profils solides) | ⚠️ | idem |
| **Config IA** (Ollama URL, modèle, timeout, Tavily API) | ⚠️ | v30 : carte redirige vers legacy |
| **Mise à jour serveur** (bouton Pull + SSE logs + Rollback) | ⚠️ | v30 : carte Admin redirige |
| **Mon compte** (change password, email, avatar) | ⚠️ | v30 : carte redirige |
| **Notifications navigateur** (toggle PWA push) | ⚠️ | v30 : carte redirige |
| **À propos** (version, commit, release notes) | ⚠️ | v30 : carte redirige |

### Actions proposées — Paramètres

La stratégie « hub 8 cartes → redirect vers legacy pour le détail » est acceptable court terme. Pour la Phase 2 v30 native :

1. Porter au moins **Config IA** et **Objectifs** en pages v30 natives (actions quotidiennes).
2. Les autres (Mise à jour serveur, Snapshots, Mon compte) peuvent rester en legacy pour simplifier.

---

## Écrans priorité basse — synthèse

### /users vs /v30/users

| v29 | v30 | Note |
|---|---|---|
| Liste cartes user + bouton Modifier + Nouvel utilisateur | ✅ | v30 : carte avec badge Administrateur + dernière connexion + Nouvel utilisateur. Équivalent fonctionnel OK |

### /snapshots vs /v30/snapshots

| v29 | v30 | Note |
|---|---|---|
| Label de création + Créer + Actualiser | ⚠️ | v30 : juste bouton `+ Créer un snapshot` — pas de champ label ni Actualiser (sauf rechargement) |
| Table fichier / taille / date / Actions | ✅ | v30 OK |
| Badge Manuel / Auto | ⚠️ | v30 ajoute le badge, v29 ne le distingue pas visuellement (seulement via le préfixe fichier) |

### /activity vs /v30/activity

| v29 | v30 | Note |
|---|---|---|
| Filtres `Tous les utilisateurs` + `Toutes les actions` + Actualiser | ⚠️ | v30 : 2 filtres non labellés visibles |
| Table 5 colonnes (Date/Heure, Utilisateur, Action, **Entité**, **Détails**) | ❌ | v30 : 3 colonnes seulement (Date, Utilisateur, Action). Les colonnes **Entité** et **Détails** disparaissent — perte de visibilité sur quelle ligne a été modifiée |
| Compteur total | ✅ | v30 : « 1 606 événements » |

**Action** : ajouter les colonnes **Entité** et **Détails** à la table `/v30/activity`.

### /metiers vs /v30/metiers

| v29 | v30 | Note |
|---|---|---|
| 4 compteurs (Catégories, Spécialités, Compétences, Secteurs) | ❌ | absents v30 |
| Arbre repliable par catégorie (Ingénierie Logicielle, Électronique, Système, Life Science + Nouveaux tags à classifier) | ❌ | v30 : table plate — perte de la hiérarchie |
| Boutons `Tout déplier` / `Tout replier` / Ajouter | ⚠️ | v30 : juste bouton `+ Ajouter` |
| Recherche métier/compétence/outil | ❌ | absente v30 |
| Filtres Catégorie/Compétence/Secteur/Certification | ❌ | absents v30 |

**Action** : `/v30/metiers` est une régression forte. Soit on revient à l'arbre v29 (plus complexe à porter), soit on garde la table simple mais on ajoute **recherche + filtres + compteurs**.

### /collab vs /v30/collab

| v29 | v30 | Note |
|---|---|---|
| Bouton Ajouter collaborateur + Actualiser | ⚠️ | v30 : hub 3 cartes (Partager une entreprise, Mes partages, Partagés avec moi). Les actions redirigent vers legacy |
| Listes : Collaborateurs, Entreprises partagées avec moi, Prospects des entreprises partagées | ⚠️ | v30 : hub 3 cartes avec description et lien vers legacy. Équivalent court-terme, à porter pleinement en Phase 2 |

### /duplicates vs /v30/duplicates

| v29 | v30 | Note |
|---|---|---|
| Seuil slider + Scanner + Détection compteurs | ⚠️ | v30 : hub 3 cartes (Doublons entreprises / Doublons prospects / Paires ignorées) avec bouton `Lancer l'analyse` |
| Listing détaillé par groupe avec Garder / Fusionner / Exclure | ⚠️ | v30 redirige vers legacy pour l'action réelle (hub uniquement) |

### /dc-generator vs /v30/dc

| v29 | v30 | Note |
|---|---|---|
| Formulaire complet : template actif, upload CV (DOCX/PDF), titre poste, années, bouton Générer + bloc « Comment ça marche » | ⚠️ | v30 (`/v30/dc`) : hub avec lien « Ouvrir le générateur legacy » — pas de UI v30 native pour la génération |

### /help vs /v30/help

| v29 | v30 | Note |
|---|---|---|
| Page help | ✅ | v30 : hub 8 cartes (Démarrage, Dashboard, Prospects, Push & Campagnes, Sourcing, IA & Scraping, Raccourcis clavier, Manuel complet) + Astuces + dialog `Raccourcis clavier`. Meilleure UX que v29 |

### /archives (v29) vs pas d'équivalent v30

| v29 | v30 | Note |
|---|---|---|
| Liste des prospects archivés | ❌ | Pas d'équivalent v30. Soit porter, soit ajouter un filtre `?archived=1` sur `/v30/prospects` |

### Mode Prosp (accès palette)

| v29 | v30 | Note |
|---|---|---|
| `/prospects/mode-prosp` accessible depuis le bouton `Mode Prosp` sur `/` | ✅ | v30 : pas de v30 Mode Prosp, mais la palette ⌘K → `Lancer Mode Prosp` redirige vers `/prospects/mode-prosp` legacy (endpoint 200). OK |

---

# Synthèse et priorités de fix

## 🚨 Bugs bloquants (P0) — fetch cassés

Ces bugs rendent la page v30 **inutilisable** (liste vide ou KPI — alors que la DB est pleine) :

1. **`/v30/prospects` — `static/js/v30/prospects.js:305`** : `/api/search?q=` renvoie 0 sans query → liste vide. Fix : utiliser `/api/data` et filtrer côté client avec `STATE.q`.
2. **`/v30/push` (onglet Templates) — `static/js/v30/push.js:89`** : lit `res.templates/items/data`, alors que `/api/templates` renvoie un **array direct**. Fix : `Array.isArray(res) ? res : ...`.
3. **`/v30/sourcing` — `static/js/v30/sourcing.js:172`** : même pattern, `/api/candidates` est un array direct → `STATE.candidates = []`. Même fix.
4. **`/v30/rapport` — `static/js/v30/rapport.js:40`** : lit `data.kpis` (pluriel), l'API retourne `data.data.kpi` (singulier, wrap `data`). Clés aussi mal mappées (`prospects_contacted` vs `total_prospects`). Fix : lire `res.data.kpi` et mapper.
5. **`/v30/calendrier` — `static/js/v30/calendar.js:28`** : lit `res.prospects`, l'API retourne `res.events`. Fix : boucler sur `res.events`.

**Priorité absolue** : ces 5 fix conditionnent l'utilisabilité de la v30 (5 écrans sur 8 en priorité haute).

## 🟠 Fonctionnalités manquantes significatives (P1)

Écarts fonctionnels qui **dégradent la valeur métier** :

6. **Dashboard** : widget Performance (5 KPI + chart), widget Activité du jour (Top consultants), boutons `+ KPI manuel` et `Export`.
7. **Prospects** : 4 KPI cards (Total / Appelables / RDV / Prospectés), boutons Import Excel, Export, Statistiques, Mode Prosp, 4 colonnes (Fonction, Email, Push, Actions), actions bulk manquantes (Delete, Changer statut, Archiver).
8. **Push** : page Catégories (17 catégories avec candidats associés + template), bouton Scanner pushs.
9. **Sourcing** : recherche, filtres, Export CSV, badge DC, onglets secondaires.
10. **Fiche candidat** : bloc Informations complet (STATUT, TEL, EMAIL, SECTEUR, SOURCE, TECH, LINKEDIN), bloc Données entretien (import Excel IA + modèle), tags libres, boutons Archiver/Modifier tout.
11. **Stats** : 5 KPI supplémentaires (Prospects total, Entreprises, Appels, Notes d'appel, A rappeler, Relances), Insights IA + Générer, table Entreprises chaudes.
12. **Sidebar v30** : liens Collaboration, Doublons, DC Generator, Archivés + groupe Admin (Snapshots, Métiers, Utilisateurs, Journal).
13. **Activité** : colonnes Entité et Détails.
14. **Métiers** : arbre replié + filtres + compteurs (sinon régression forte).
15. **Calendrier** : sync Outlook/Google + URL .ics.

## 🟢 Polish (P2)

16. Menu avatar (accès direct Déconnexion).
17. Bannière « X relances en retard » sur `/v30/prospects`.
18. Entreprises : vue Cartes + counters + icônes d'action rapides.
19. Rapport : picker de semaine quelconque (pas juste courante / précédente), Aperçu MD.
20. Focus : bloc Tâches libres avec CRUD.
21. Parametres : porter nativement Config IA + Objectifs en v30.

## Ordre recommandé de correction

### Sprint 1 — Débloquer la v30 (P0 uniquement)

Petits commits (1 fix = 1 commit), rapides à produire :

1. `fix(v30): prospects - utiliser /api/data au lieu de /api/search q vide`
2. `fix(v30): push - accepter array direct de /api/templates`
3. `fix(v30): sourcing - accepter array direct de /api/candidates`
4. `fix(v30): calendar - lire res.events au lieu de res.prospects`
5. `fix(v30): rapport - lire res.data.kpi + mapper les clés correctes`

Après ce sprint, v30 devient réellement utilisable. Tests Playwright v30 à relancer.

### Sprint 2 — Combler les manques (P1)

- KPI + colonnes manquantes (Prospects, Entreprises)
- Sidebar v30 élargie (Admin links, Collab, Doublons, DC, Archives)
- Fiche candidat : bloc Informations + Données entretien
- Push : page Catégories
- Stats : KPI complémentaires + Entreprises chaudes + Insights IA
- Activité : colonnes Entité/Détails

### Sprint 3 — Polish (P2)

- Menu avatar
- Bannière relances
- Entreprises cartes
- Rapport picker semaine
- Focus tâches
- Parametres natifs

## Récapitulatif écrans (parité globale)

| Écran v30 | Parité v29 | Bugs P0 | Actions P1 |
|---|---|---|---|
| Dashboard | 60 % | — | 3 (Performance, Activité, KPI/Export) |
| Prospects | 40 % | 1 ⛔ | 4 |
| Entreprises | 75 % | — | 2 |
| Push | 55 % | 1 ⛔ | 2 |
| Sourcing | 30 % | 1 ⛔ | 5 |
| Candidat (fiche) | 45 % | — | 4 |
| Stats | 55 % | — | 3 |
| Rapport | 50 % | 1 ⛔ | 1 |
| Focus | 80 % | — | 1 |
| Calendrier | 30 % | 1 ⛔ | 1 |
| Parametres | 70 % | — | 0 (Phase 2) |
| Users / Snapshots / Help | 95 % | — | 0 |
| Activity / Metiers | 50 % | — | 2 |
| Collab / Duplicates / DC | 50 % | — | 0 (hub+legacy acceptable) |
| Mode Prosp | 100 % via palette | — | 0 |

**Parité moyenne estimée : 58 %** (pondération par importance).

Après Sprint 1 (fix P0), parité passe à **~72 %** sans nouvelle feature.
Après Sprint 2 (P1 complétés), parité passe à **~92 %**.

---

_Rapport généré le 2026-04-21 sur la branche `claude/update-ux-handoff-docs-kF0YN`._








