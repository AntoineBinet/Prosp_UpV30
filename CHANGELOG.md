# Changelog

Historique des versions significatives. Incrément dans [app.py:38](app.py).

## [30.11] — 2026-04-24 · Push popup · refonte DA v30 + IA streaming live

Refonte complète de la popup « Pousser » apparue en 30.10 : design v30 soigné (sections, avatar, skeletons animés, badge de canal, actions IA typées) et **IA en streaming** — les tokens s'affichent en direct dans le textarea au fur et à mesure qu'ils arrivent, avec une barre de progression temps réel (temps écoulé en secondes, nombre de caractères). Plus jamais la sensation « ça charge dans le vide ».

### Changements visuels
- **Sections numérotées** avec labels typographiques (Destinataire / Contexte / Message) + icônes.
- **Carte destinataire** : avatar coloré (initiales) + nom + fonction · entreprise · site · email mono + badge canal (Email/LinkedIn) à droite.
- **Selects harmonisés** : flèche chevron SVG custom, hauteur cohérente 36 px, padding aligné.
- **Skeletons animés** (shimmer) pendant les chargements : plus de « Chargement… » texte brut.
- **Boutons IA typés accent** (pill `.v30pm-ai-btn`) au lieu de boutons ghost transparents.
- **Barre de progression IA** (`.v30pm-ai-progress`) avec pulse point accent + message + stats mono (s / caractères) visibles uniquement pendant la génération.
- **Textarea message** avec `min-height: 140px` et auto-scroll pendant le streaming.
- **Bouton Envoyer** élargi (130 px min, 36 px height, bold).

### Changements techniques
- **`static/css/v30/push-modal.css`** (nouveau, 241 lignes) — stylesheet dédié chargé globalement via `base.html` (après `company-picker.css`).
- **`static/js/v30/push-modal.js`** (mise à jour, 781 lignes) :
  - `ensureModal()` réécrit : structure sections + skeleton destinataire + progress IA
  - `initials()`, `renderProspectSkeleton()`, `renderSelectLoading()`, `restoreSelect()` — nouveaux helpers
  - `renderProspectInfo()` — avatar (initiales) + métadonnées enrichies + badge canal
  - `loadPushCategories/loadBestCandidates/loadUsers` — utilisent `renderSelectLoading` au lieu de `<option>Chargement…</option>` plat
  - `generateAI()` **entièrement réécrit** : appel direct SSE `/api/ollama/generate-stream` avec `ReadableStream.getReader()` et `TextDecoder`. Parse les événements `start/token/end/error` et concatène les tokens dans le textarea. Auto-scroll vers le bas à chaque token. Tick de 300 ms pour rafraîchir les stats même si les tokens s'espacent. Abort via `AbortController` après 120 s (solo) ou 180 s (3 variantes). Fallback vers `window.callOllama(stream:false)` si `ReadableStream` indisponible.
  - `open()` — appelle les skeletons immédiatement, plus d'état texte « Chargement du prospect… ».

### Aucun changement backend
Le streaming utilise l'endpoint `/api/ollama/generate-stream` existant depuis v28 (réponse SSE avec events `{type, text, message, done}`).

## [30.10] — 2026-04-24 · Push depuis fiche prospect · popup v30 avec logique v29

Le bouton « Pousser » de la fiche prospect v30 redirigeait bêtement vers `/v30/push?ids=<id>` — ce qui ne faisait rien d'utile puisque la page Push n'a pas d'UX de ciblage par prospect. Cette version introduit une popup v30 dédiée qui reprend exactement la mécanique v29 de `app.js:openPushSelectModal/confirmPushSend` : sélection de catégorie push, 2 candidats (filtrés par catégorie via `/api/prospect/<id>/best-candidates`), 2 consultants (`/api/users/for-push`), message personnalisé (avec bouton « IA » + bouton « 3 variantes » — Ollama), puis envoi qui copie l'email, ouvre le template `.msg` Outlook si une catégorie est choisie, télécharge les dossiers de compétences des candidats sélectionnés, et log dans `/api/push-logs/add`. Sur le canal LinkedIn : copie du message (custom IA ou template LinkedIn) et ouverture du profil dans un nouvel onglet.

### Changements
- **`static/js/v30/push-modal.js`** (nouveau, 593 lignes) — module global exposé sur `window.V30PushModal.open(prospectId, channel)`. IIFE strict, la modale est créée dynamiquement au premier appel. Les selects se chargent en parallèle. Le rechargement des candidats se déclenche au changement de catégorie. L'événement `v30-push-sent` est dispatché sur `document` après un envoi réussi pour que la page hôte puisse rafraîchir sa timeline.
- **`templates/v30/base.html`** — chargement global de `push-modal.js` en `defer` (entre `company-picker.js` et `opt-in.js`).
- **`static/js/v30/prospect_detail_ui.js`** :
  - Bouton « Pousser » du header : `window.V30PushModal.open(FP.ID, 'email')` au lieu de la redirection `/v30/push?ids=...`.
  - Menu « More » : nouvelle entrée « Push LinkedIn » si le prospect a un `linkedin` (`window.V30PushModal.open(FP.ID, 'linkedin')`).
- **`static/js/v30/prospects.js`** — action `push` de la barre bulk : si un seul prospect est sélectionné, ouvre la popup ; sinon, toast d'avertissement.
- **`static/css/v30/push.css`** — bloc `.v30-pm-prospect` (récap du prospect dans la modale).

### Aucun changement backend
Tous les endpoints consommés existaient déjà et étaient utilisés par le flux v29 : `/api/prospect/<id>/timeline`, `/api/push-categories`, `/api/prospect/<id>/best-candidates`, `/api/users/for-push`, `/api/settings`, `/api/push-categories/<id>/files`, `/api/pushs/open`, `/api/candidates/<id>`, `/api/candidates/<id>/dossier-competence`, `/api/push-logs/add`, `/api/ollama/generate-stream`.

## [30.9] — 2026-04-24 · Push · Restauration mécanique v29 sous habillage v30

La page `/v30/push` affichait un wizard « Nouvelle campagne » en 3 étapes (Cible / Message / Envoi) qui se cassait au premier clic avec la toast « Impossible de rafraîchir l'audience » (erreur sur `POST /api/push-campaigns/<id>/recipients-preview`). Le wizard imposait un modèle mental de campagne (table `push_campaigns`) étranger au flux réel des utilisateurs : catégories de compétences → templates `.msg` Outlook → matching prospects par mots-clés, qui fonctionnait très bien en v29. Cette version restaure intégralement la mécanique v29 dans l'UI v30.

### Nouvelle UX (identique à la v29, design v30)
- **Deux onglets** : « Catégories » (par défaut) + « Historique ». Le wizard et la table `push_campaigns` ne sont plus exposés.
- **Barre d'actions** : « Templates texte » (modale d'édition) · « Scanner pushs/ » (détection des dossiers) · « Nouvelle catégorie ».
- **Grille de catégories** : chaque carte expose le nom de la catégorie, un badge « auto » pour les catégories auto-détectées, un badge Candidats (0/1/2 sélectionnés) et un badge Templates (nombre de fichiers `.msg`). Tooltip au survol avec la description métier.
- **Détail catégorie (modale)** : description, mots-clés, deux slots de candidats par défaut (bouton Auto pour suggérer les 2 meilleurs via `/api/push-categories/<id>/match-candidates`, édition manuelle via select, effacement), liste des templates `.msg` (upload, remplacement, téléchargement, suppression), boutons Prospects / Modifier / Supprimer en pied.
- **Prospects suggérés (modale)** : liste des prospects scorés par `/api/push-categories/<id>/match-prospects`, avec pills de mots-clés matchés, fonction, entreprise, et boutons Fiche / Email.
- **Historique** : recherche plein-texte + filtre par canal (email/LinkedIn/autre) + rafraîchissement, table responsive avec actions Voir (modale détail) et Supprimer.
- **Templates texte (modale dédiée)** : liste à gauche, éditeur à droite (nom, sujet, corps email, corps LinkedIn, « par défaut »). CRUD via `/api/templates/save` et `/api/templates/delete`.
- **Catégories built-in** auto-créées au premier chargement si absentes : `Simulation_Modélisation`, `Electrotechnique_Energie`, `Surete_Fonctionnement_SdF` (avec leurs mots-clés canoniques).

### Aucune migration backend
Toutes les routes consommées existaient déjà dans `app.py` : `/api/push-categories*`, `/api/push-categories/<id>/files` & `upload-template` & `delete-template`, `/api/push-categories/<id>/match-candidates` & `match-prospects` & `set-candidates`, `/api/templates*`, `/api/push-logs*`, `/api/candidates`. Le wizard cassé s'appuyait sur `/api/push-campaigns*` (toujours en base, non supprimé — peut être nettoyé ultérieurement, aucun front ne l'utilise).

### Changements
- **`templates/v30/push.html`** (272 lignes, réécrit) — topbar + 2 panneaux (Catégories / Historique) + 4 modales (détail catégorie, prospects suggérés, détail push, templates manager). Toutes les modales utilisent le pattern `v30-modal-bd` / `v30-modal--xl` (`components.css`), `role="dialog"`, `aria-modal`, `aria-labelledby`, et fermeture via `data-v30-modal-close` / Escape / clic fond.
- **`static/js/v30/push.js`** (1016 lignes, réécrit) — IIFE en mode strict, port de la logique `page-push.js` sur des sélecteurs `data-v30-*`. Gestion locale des modales (`openModal`/`closeModal` avec classe `is-open` pour la transition), délégation d'événements par modale pour les slots candidats et la liste de fichiers, fallback robuste aux helpers globaux (`window.escapeHtml`, `window.showToast`, `window.icon`). Les catégories built-in sont créées via chaîne de `Promise` pour respecter l'ordre.
- **`static/css/v30/push.css`** (réécrit) — nouveaux tokens de styles : `.v30-cat-grid`, `.v30-cat-card` (avec `:hover` tooltip via `.v30-cat-tooltip`), `.v30-cat-badge[.has|.none|.loading]`, `.v30-kw-pill[.matched]`, `.v30-cand-slot`, `.v30-cat-file`, `.v30-sg-prospect`, `.v30-pd-info` / `.v30-pd-block`, `.v30-tpl-item[.is-active]`. Table historique stylée via sélecteurs `[data-v30-push-panel="historique"] table/thead/tbody`. L'ancien CSS du wizard + campagnes est supprimé.

### Notes de compatibilité
- La route `/v30/push` n'a pas changé (même URL, même gabarit Jinja). Seuls le contenu du `<div>` interne, le JS et le CSS sont réécrits.
- Les tables `push_campaigns` et `push_variants` restent présentes en base mais ne sont plus peuplées par le front v30 ; elles pourront être dépréciées au profit de `push_logs` dans une version ultérieure.
- La route legacy `/push` (templates v29) reste pleinement fonctionnelle pour l'escape-hatch `?force_v29=1`.

## [30.8] — 2026-04-24 · Fiche prospect · Entreprise éditable + autocomplete global

La fiche prospect affiche désormais l'entreprise dans la sidebar « Détails » (cliquable pour changer) et dans la carte latérale « Entreprise » (bouton « Changer »). Partout où une entreprise est saisie (fiche prospect, modale « Nouveau prospect »), un picker uniforme remplace les champs libres : liste filtrée des entreprises existantes + bouton « Ajouter une entreprise » en bas qui ouvre une mini-modale de création. Il n'est plus possible d'enregistrer un prospect avec un nom d'entreprise qui n'existe pas en base — l'utilisateur doit soit choisir une entrée, soit explicitement créer une nouvelle fiche entreprise.

### Changements
- **`static/js/v30/company-picker.js`** (nouveau) — composant réutilisable exposé sur `window.CompanyPicker` : `attachToInput(input, opts)` pour les formulaires, `openFloating(anchor, opts)` pour l'édition en place, `openCreateModal(groupe, site)` pour la création. Cache des entreprises partagé entre instances + invalidation automatique après création.
- **`static/css/v30/company-picker.css`** (nouveau) — styles du panneau déroulant, du bouton sticky « Ajouter » et de la modale de création.
- **`templates/v30/base.html`** — inclusion globale du CSS et du JS du picker.
- **`templates/v30/prospect_detail.html`** — nouvelle ligne « Entreprise » dans la sidebar (cliquable, `data-v30-edit-company`) + bouton « Changer » dans la carte Entreprise + état vide « Aucune entreprise associée ».
- **`static/js/v30/prospect_detail_render.js`** — rendu de la ligne Entreprise dans l'aside et de la carte toujours visible (affichage conditionnel du lien vs état vide).
- **`static/js/v30/prospect_detail_ui.js`** — `bindCompanyEdit()` ancre le picker flottant sur le déclencheur, appelle `saveField('company_id', …)`, met à jour l'état local puis re-rend header + aside.
- **`templates/v30/prospects.html`** — modale « Nouveau prospect » : le champ Entreprise devient obligatoire et occupe toute la largeur, le champ « Site / ville » (redondant avec le picker) est retiré, le `<datalist>` est supprimé.
- **`static/js/v30/prospects.js`** — `mountAddCompanyPicker()` attache le picker au champ entreprise de la modale, le handler de sauvegarde refuse la création si aucune entreprise n'est sélectionnée, le payload envoie `company_id` (et `company_groupe`/`company_site` en doublon pour compat).
- **`app.py`** :
  - Nouveau `GET /api/companies/list` : liste allégée `{id, groupe, site}` filtrée par `owner_id` (pour alimenter l'autocomplete).
  - `POST /api/prospects/bulk-edit` accepte maintenant le champ `company_id` ; validation stricte (entreprise doit exister et appartenir à l'utilisateur) avant `UPDATE`. Retourne `{company: {id, groupe, site}}` pour que le front mette à jour l'UI sans re-fetch.
  - `GET /api/prospect/timeline` : la requête rejoint désormais `companies` (LEFT JOIN) pour inclure `company_groupe` et `company_site` dans la réponse (auparavant manquants, ce qui masquait la carte Entreprise sur les fiches peuplées).

## [30.7] — 2026-04-23 · Prospects v30 · Regroupement des statuts dans le kanban

La colonne « Prospecté » du kanban regroupait à tort « Pas intéressé », « Gagné », « Perdu », « Proposition » (142 items) alors que le statut canonique « Prospecté » n'en comptait que 8 (mismatch avec l'onglet de filtre). La colonne « Contacté » incluait « Messagerie » qui est plutôt un statut d'attente.

### Nouveau regroupement
- **À traiter** : `Pas d'actions`, `Messagerie`, (vide) — tout ce qui n'a pas encore reçu d'action effective.
- **Contacté** : `Appelé`, `Contacté`, `Pas intéressé` — la prise de contact a eu lieu (positive ou négative).
- **À rappeler** : `À rappeler` — inchangé.
- **RDV** : `Rendez-vous` — inchangé.
- **Prospecté** : `Prospecté` uniquement — section post-RDV à part entière.

Conséquence : le compte de la colonne kanban « Prospecté » = compte de l'onglet « Prospecté » = KPI « PROSPECTÉS ». Idem pour RDV. Les statuts legacy `Gagné`/`Perdu`/`Proposition` (présents uniquement dans `templates/v30/preview.html`, pas dans les dropdowns réels) ne sont plus mappés — s'ils existaient en base ils tomberaient dans « À traiter » (fallback) mais `STATUS_OPTIONS` ne les expose pas.

### Changements
- **`static/js/v30/prospects.js:374`** — `KANBAN_COLS` : `Pas intéressé` déplacé de Prospecté → Contacté, `Messagerie` déplacé de Contacté → À traiter, `Gagné`/`Perdu`/`Proposition` retirés.

## [30.6] — 2026-04-23 · Prospects v30 · Comptes RDV / Prospecté cohérents (KPI, tabs, kanban)

Sur `/v30/prospects`, les comptes affichés dans les trois zones (cartes KPI en haut, onglets de filtres, colonnes du kanban) divergeaient. Exemple observé : KPI « RDV 25 », tab « RDV 19 », colonne kanban « RDV 0 ». Idem pour « Prospecté ». Deux bugs corrigés.

### Changements
- **`static/js/v30/prospects.js:646`** — `updateKpis()` comptait un RDV si `p.rdvDate` était renseigné, même quand le statut n'était plus « Rendez-vous ». On aligne désormais sur la définition utilisée par le filtre tab, le backend et la v29 : uniquement `statut === 'Rendez-vous'`.
- **`static/js/v30/prospects.js:393`** — `renderKanban()` itérait sur `STATE.prospects` (page courante paginée à 50), donc les colonnes affichaient des comptes faux dès qu'un filtre ou une vue sauvegardée renvoyait > 50 résultats. On itère maintenant sur `STATE.filteredAll` (liste filtrée+triée complète, déjà calculée pour Mode Prosp). Le kanban reflète donc tout le set filtré, pas seulement la page courante.

## [30.5] — 2026-04-22 · Paramètres v30 · Mon compte + À propos remontés au-dessus de Mise à jour

Sur `/v30/parametres`, les cartes « Mon compte » et « À propos » sont désormais rendues **avant** la section admin « Mise à jour du serveur ». La carte wide « Mise à jour » est placée en dernier (elle occupe une ligne entière), ce qui permet aux cartes utilisateur courantes de rester accessibles en haut de la grille.

### Changements
- **`templates/v30/parametres.html`** : réordonnancement DOM + suppression des `style="order:100;"` devenus inutiles.

## [30.4] — 2026-04-22 · Fil d'Ariane cliquable

Les éléments parents du fil d'Ariane (`Prosp'Up`, `Prospects`, `Candidats`…) sont désormais cliquables sur les fiches détail, pour revenir en arrière en un clic.

### Changements
- **`templates/_partials/v30/topbar.html`** : le composant `crumbs` accepte désormais soit une chaîne (comportement actuel, non cliquable), soit un dict `{label, href}` (rendu en `<a>` cliquable). Le dernier item reste toujours non cliquable (page courante).
- **`app.py`** : fiches prospect (`/v30/prospect/<id>`) et candidat (`/v30/candidat/<id>`) passent maintenant `Prosp'Up → /v30/dashboard` et `Prospects → /v30/prospects` / `Candidats → /v30/sourcing` comme dicts.
- **`static/css/v30/chrome.css`** : style `.v30-crumbs__item--link` (hover = souligné + surface-2, focus visible).

## [30.3] — 2026-04-22 · Persistance des filtres prospects v30

Depuis que la fiche prospect est une page plein écran (et non plus une popup), revenir sur `/v30/prospects` remettait tous les filtres à zéro. Correction : la recherche, les pills (vues built-in + vues sauvegardées), les filtres avancés (statuts, pertinence min, tags, dates de relance, téléphonables, entreprise) et le tri sont désormais persistés dans `localStorage` (clé `v30.prospects.filters`).

### Changements
- **`static/js/v30/prospects.js`** : ajout de `loadPersistedFilters` / `savePersistedFilters` / `restorePersistedFilters` / `syncUiFromState`. Sauvegarde automatique sur apply/reset des filtres, sur frappe dans la recherche, sur clic de pill (built-in ou saved view) et sur changement de tri. Restauration au chargement avec synchronisation de l'input de recherche et de la pill active. Le param URL `?company=ID` reste prioritaire sur la valeur persistée.

## [30.2] — 2026-04-22 · Vérification visuelle MAJ + affichage du dossier cible

**Note** : le numéro `APP_VERSION` redescend volontairement de 30.7 à 30.2 pour servir de **marqueur visuel** dans la sidebar v30. Après que tu auras lancé la mise à jour depuis la v29 (une dernière fois), la sidebar affichera « v30.2 » — preuve que le nouveau dossier a bien été tiré. Le code embarque toutes les phases 1 à 5 + le bouton de MAJ v30 natif (30.3 à 30.7 cumulés).

### Vérification du dossier cible
- `templates/v30/parametres.html` : affichage du chemin `APP_DIR` (dossier où tourne `app.py`) directement dans la section Mise à jour, avec une note « Vérifie que c'est bien le nouveau dossier v30 avant de lancer la mise à jour ».
- `app.py:page_v30_parametres` : passe `app_dir=str(APP_DIR)` au template.
- `routes/deploy.py:api_deploy_pull` : au début du SSE, log deux lignes explicites :
  - `Dossier cible : <chemin absolu>`
  - `Remote origin : <URL git>`
  Ces lignes apparaissent en haut de la zone de logs pendant le pull.

## [30.7] — 2026-04-22 · Mise à jour serveur native en v30 (admin)

Fin de la dernière raison de quitter la v30 : le bouton « Mettre à jour et redémarrer » (Paramètres > Mise à jour du serveur) fonctionne désormais directement dans `/v30/parametres`, sans détour par la v29.

### Changements
- **`templates/v30/parametres.html`** : la carte hub « Mise à jour du serveur » est remplacée par une section inline complète (pleine largeur) visible uniquement pour les admins. Contient 3 boutons (Mettre à jour / Rollback / Redémarrer), un indicateur de statut, une zone de logs et un `<details>` « Problème ? Utiliser la v29 » avec lien `?force_v29=1` (le fallback reste accessible tant que la procédure n'a pas été complètement éprouvée).
- **`static/js/v30/parametres.js`** (nouveau, ~160 l) : câble les 3 boutons sur les endpoints existants `/api/deploy/pull` (SSE streaming avec logs temps réel), `/api/deploy/rollback` et `/api/deploy/restart`. Redémarrage suivi d'un reload auto après 12 s.
- **`static/css/v30/parametres.css`** : pattern `.v30-params__card--wide` réutilisable + styles dédiés `.v30-deploy__*` (actions, results, log pre, fallback details).

### Backend
- **Aucune modification** — les endpoints `/api/deploy/*` existent déjà (blueprint `routes/deploy.py`).

## [30.6] — 2026-04-22 · Consolidation détails + liens v30 (phase 5)

Phase finale du cycle v30 : la plupart des pages de détail (Prospect detail, Candidate detail, Users, Snapshots, Activity, Métiers) étaient déjà 100 % câblées en v30 depuis 30.1. Cette phase consolide les redirections restantes pour que l'expérience reste en v30 partout où c'est possible.

### Redirections v30 natives
- `prospect_detail_ui.js` : bouton Pousser → `/v30/push?ids=<id>`, bouton Planifier → `/v30/calendrier`. Le bouton « Plus » bascule explicitement en v29 (`?force_v29=1`) pour l'édition avancée.
- `candidate_detail.js` : bouton DC → `/v30/dc?candidate=<id>`, bouton Pousser → `/v30/push?candidate=<id>`, bouton « Plus » → v29 avec `?force_v29=1`.
- `prospects.js` : bulk « Pousser » → `/v30/push?ids=<ids>` (au lieu de `/push`).
- `rapport.js` + `stats.js` : fallback export PDF → `/rapport?force_v29=1` (le flux Markdown→PDF complet reste côté v29 pour l'instant).

### Pages « hub » restant par design
Les pages admin-lourdes ou peu utilisées restent en v30 uniquement comme hubs qui renvoient vers les parcours complets v29 — c'est un choix architectural documenté, pas une régression :
- **Duplicates** (`/v30/duplicates`) — merge wizard complexe, reste sur `/duplicates` legacy.
- **Collab** (`/v30/collab`) — partage entreprises/prospects, reste sur `/collab` legacy.
- **DC Generator** (`/v30/dc`) — génération DOCX candidat, reste sur `/dc_generator` legacy.
- **Paramètres** (`/v30/parametres`) — hub 7 cartes → `/parametres#section` legacy (IA config, objectifs, snapshots, notifications, déploiement, mot de passe, à propos).

### État final v30 (après phases 1 à 5)
Fonctionnel en v30 natif : **Dashboard, Prospects (+ Mode Prosp), Entreprises, Sourcing/Candidats, Focus, Calendrier, Push (campagnes + templates), Stats (KPI), Rapport, Prospect detail, Candidate detail, Users, Snapshots, Activity, Métiers**. Reste en v29 (hub v30) : merge doublons, collab avancée, DC generator, paramètres admin, graphiques Chart.js détaillés.

## [30.5] — 2026-04-22 · Focus + Calendrier + Push templates (phase 4)

Pages de flux quotidien : actions rapides câblées sans remplacer les parties déjà fonctionnelles. Stats et Rapport étaient déjà OK (à 95 % et 100 %).

### Focus (`/v30/focus`)
- **Actions rapides par ligne** : boutons « +1j », « +7j » (repousser la relance) et « ✓ » (marquer fait / effacer la relance) → `POST /api/prospects/bulk-update` avec `nextFollowUp` calculé ou `null`.
- La liste est rechargée automatiquement après chaque action.

### Calendrier (`/v30/calendrier`)
- Le bouton « +N autres » devient cliquable et ouvre un popup ancré au jour avec la liste complète des événements (RDV / relances / EC1). Fermeture par clic extérieur, bouton × ou Échap.
- CSS popup ajouté dans `static/css/v30/calendar.css`.

### Push — Templates (`/v30/push` onglet Templates)
- **Nouveau template** : carte « + » ouvre une modale complète (nom, objet email, corps email, message LinkedIn, défaut par défaut) → `POST /api/templates/save`.
- **Modifier un template** : clic sur une carte existante pré-remplit la modale en mode édition avec bouton « Supprimer » → `POST /api/templates/delete`.
- Variables documentées dans la modale : `{prenom}`, `{nom}`, `{entreprise}`, `{fonction}`.
- Le wizard de campagne (déjà câblé en 30.1) est inchangé.

### Stats (`/v30/stats`)
- Liens vers Chart.js détaillés pointent désormais vers `/stats?force_v29=1` (la v29 reste source de vérité pour les graphiques — portage prévu en phase 6 ou plus tard).

### Rapport (`/v30/rapport`)
- Inchangé (déjà complet : KPI, notes autosave, copier Markdown, export PDF).

## [30.4] — 2026-04-22 · Entreprises + Sourcing en v30 (phase 3)

### Entreprises (`/v30/entreprises`)
- **Ajouter** : modale complète (groupe, site, phone, website, linkedin, industry, tags, notes) → nouveau `POST /api/companies/create` (manquait).
- **Filtres** : panel (en pipeline / avec prospects / sans prospects / tags contient) avec badge compteur.
- **Sélection multi** : checkboxes par ligne + « tout sélectionner ».
- **Bulk bar** : **Fusionner** (exactement 2 sélectionnées) → dialog preview keep/source + swap → `POST /api/companies/merge`. **Supprimer** N entreprises → `POST /api/companies/delete` en boucle.
- **Export XLSX** : `GET /api/export/xlsx`.
- **Clic entreprise** : redirige sur `/v30/prospects?company=<id>` (nouveau filtre par company_id dans `prospects.js`).

### Sourcing (`/v30/sourcing`)
- **Recherche** : barre dans la topbar (nom/rôle/localisation/skills), debounce 150 ms.
- **Ajouter** : modale complète (nom, rôle, séniorité, localisation, email, tel, LinkedIn, statut, skills, source, notes) → `POST /api/candidates/save`. Pour l'import PDF/IA/Lusha, renvoi vers v29.
- **Filtres** : panel (statut multi, skills contient, localisation contient) avec badge compteur.
- **Sélection multi** : checkbox par card (pipeline + grid).
- **Bulk bar** : changer statut → `POST /api/candidates/bulk-update`, supprimer → `POST /api/candidates/delete` en boucle.

### Backend
- Ajout : `POST /api/companies/create` — crée une entreprise avec dedupe strict par groupe+site+owner (retourne `deduped: true` si déjà existante).

### Prospects
- Nouveau filtre `companyId` (depuis `?company=<id>` dans l'URL) → permet d'ouvrir la liste prospects filtrée par entreprise depuis `/v30/entreprises`.

## [30.3] — 2026-04-22 · Mode Prosp porté en v30 (phase 2)

Le deck 3D de prospection existe désormais en v30. Copie quasi-conforme de la logique v29 — le code métier (navigation, animations 3D, date picker, timeline, swipe, clavier) est **réutilisé tel quel** depuis `static/js/mode-prosp-tab.js`. Les APIs et le CSS `mode-prosp.css` sont réutilisés à 100 %.

### Pages
- **Nouveau** : `templates/v30/mode_prosp.html` — layout plein écran (pas de sidebar/topbar), charge `tokens.css` v30 + `mode-prosp.css` legacy.
- **Nouveau** : route `GET /v30/mode-prosp` (app.py:4647) — rend le template v30, conserve le backend `/api/mode-prosp/start|data|save`.

### JS
- **Nouveau** : `static/js/v30/mode_prosp.js` — copie conforme de `static/js/mode-prosp-tab.js` (596 l). Aucune dépendance globale (haptic défini localement, pas de `callOllama`/`showToast`). Tous les sélecteurs DOM v29 sont conservés car le template est identique.

### Intégration v30
- **Palette (⌘K)** : l'entrée « Lancer Mode Prosp » passe d'un `href` direct vers une action intelligente qui POST `/api/mode-prosp/start` avec les prospects sélectionnés sur `/v30/prospects` (via `window.ProspV30.STATE.selected`), ou tous les prospects non archivés sinon, puis ouvre `/v30/mode-prosp?t=TOKEN` dans un nouvel onglet.
- **Bouton Prospects** : nouveau bouton « Mode Prosp » dans la topbar de `/v30/prospects`, même logique (sélection → `mode-prosp/start` → nouvel onglet).
- **Help** : mention mise à jour avec la nouvelle URL `/v30/mode-prosp`.

## [30.2] — 2026-04-22 · v30 fonctionnelle : Dashboard + Prospects (phase 1)

La v30 n'est plus une coquille vide pour ces deux pages. Roadmap page-par-page documentée dans `.claude/plans/`.

### Dashboard v30
- **KPI manuel** : modale native v30 (type/date/ajustement/description) → `POST /api/manual-kpi`. Fin du renvoi vers `/dashboard#kpi-manual` de la v29.
- **Export jour** : téléchargement JSON direct depuis la v30 (`GET /api/export/day`). Fin du renvoi `/dashboard#export`.

### Prospects v30
- **Ajouter** : modale complète (nom, fonction, entreprise/site, tel, email, LinkedIn, pertinence, statut, tags, notes) → `POST /api/prospects/create`.
- **Filtres** : panel v30 (statuts multi, pertinence ≥, tags contient, fenêtre relance, appelables uniquement) avec badge compteur sur le bouton. Filtrage in-memory côté client.
- **Colonnes** : popover qui active/désactive chaque colonne de la table (select, nom et actions sont fixes). Persisté `localStorage.v30.prospects.cols`.
- **Bulk bar étendue** : en plus de Tag/Push, ajout de Statut, Pertinence, Relance (date ou effacer), Archiver (nouveau `POST /api/prospects/bulk-archive`), Supprimer (soft delete avec undo 10 s).
- **Export XLSX** : bouton direct → `GET /api/export/xlsx`.
- **Import Excel** : modale 3 étapes (fichier → mapping auto → progression). Chargement à la demande de `xlsx.min.js`, auto-mapping des entêtes, POST ligne par ligne à `/api/prospects/create`. Pour l'import avancé (CSV, collage, IA, Lusha), renvoi vers la v29 pour l'instant.
- **Scrapping IA par ligne** : bouton étoile sur chaque ligne → modale avec prompt éditable, toggle recherche web Tavily → `POST /api/ollama/generate`. La réponse JSON est parsée puis appliquée via les APIs bulk.

### Design system
- Nouveau pattern `.v30-modal-bd` / `.v30-modal` / `.v30-field` / `.v30-chip` / `.v30-chiprow` / `.v30-colgrid` / `.v30-progress` dans `static/css/v30/components.css` + `prospects.css`. Réutilisable par les futures phases (Mode Prosp, Entreprises, Sourcing…).

### Backend (addition minimale)
- `POST /api/prospects/bulk-archive` : archive/désarchive N prospects d'un coup (`{ids, archive: bool}`).

## [30.1] — 2026-04-21 · Bascule v30 par défaut + parité v29 complétée

### v30 devient l'interface par défaut

- **Serveur** : `/login` redirige vers `/v30/dashboard` (au lieu de `/dashboard`).
- **Login client** : `login.html` pose `window.location.href = '/v30/dashboard'` après login, sauf si `localStorage.prospup_ui_mode === 'v29'`.
- **Redirect auto legacy → v30** : `static/js/v30/opt-in.js` ajoute un `autoRedirectToV30()` qui détecte les routes legacy et redirige vers l'équivalent v30, sauf si :
  - `localStorage.prospup_ui_mode === 'v29'` (opt-out explicite), ou
  - URL contient `?force_v29=1` (escape hatch).
- **Nouveau mapping** legacy → v30 : 18 routes gérées (`/` → `/v30/prospects`, `/dashboard` → `/v30/dashboard`, etc.). Pas de mapping = stay legacy.
- **v29 reste 100 % accessible** via le bouton `v29` dans la sidebar v30, ou via `/parametres?force_v29=1`.

### Templates v29 déplacés dans `templates/legacy/`

- 22 templates déplacés via `git mv` (historique préservé) : `activity.html`, `base.html`, `calendrier.html`, `candidate.html`, `collab.html`, `company.html`, `dashboard_v2.html`, `dc_generator.html`, `duplicates.html`, `entreprises.html`, `focus.html`, `help.html`, `index.html`, `metiers.html`, `mode_prosp.html`, `parametres.html`, `push.html`, `rapport.html`, `snapshots.html`, `sourcing.html`, `stats.html`, `users.html`.
- `app.py` : tous les `render_template("xxx.html")` → `render_template("legacy/xxx.html")`.
- Les 20 templates qui étendent `base.html` sont mis à jour vers `{% extends "legacy/base.html" %}`.
- **Pas touché** : `templates/v30/`, `templates/_partials/`.

### Sprint 2 — P1 complétés (rattrapage manques v29)

- **Sidebar v30 élargie** : 2 nouvelles sections (Outils : Collaboration, Doublons, DC Generator ; Admin role-aware : Utilisateurs, Snapshots, Journal, Métiers IA).
- **Prospects** : 4 KPI cards (Total / Appelables / RDV / Prospectés) + colonnes Email / Push / Voir (table 12 colonnes).
- **Fiche candidat** : bloc Informations avec 10 champs (Statut / Rôle / Localisation / Expérience / Secteur / Source / Tech / Téléphone / Email / LinkedIn).
- **Activity** : colonnes Entité (avec lien fiche) + Détails (parse JSON).
- **Stats** : 8 KPI (Prospects / Entreprises / Appels / Push / RDV / À rappeler / Relances retard / Notes d'appel) + table Entreprises chaudes avec score.
- **Dashboard** : boutons `+ KPI manuel` et `Export` qui redirigent vers la modale legacy (`/dashboard#kpi-manual`).

### Sprint 3 — P2 polish

- **Topbar v30** : menu avatar cliquable (Paramètres / Aide / Déconnexion).
- **/v30/prospects** : bannière relances en retard (dismissible via sessionStorage).
- **/v30/entreprises** : toggle Liste / Cartes avec grille de cartes dense (logo / 3 stats / tags / dernier contact).
- **/v30/focus** : bloc Tâches CRUD (ajouter / fait / supprimer en double-clic) branché sur `/api/tasks`.
- **/v30/rapport** + **/v30/stats tab Rapport** : picker de semaine ISO libre (`<input type="week">`) en plus des pills En cours / Précédente.

### Sprint 1 — P0 fix fetch

- **prospects.js** : `/api/data` au lieu de `/api/search?q=` vide — liste tous les prospects.
- **push.js** : accepte array direct de `/api/templates`.
- **sourcing.js** : accepte array direct de `/api/candidates`.
- **calendar.js** : lit `res.events` au lieu de `res.prospects`.
- **rapport.js** : lit `res.data.kpi` (singulier) avec mapping clés correctes.

### APP_VERSION

- `30.0` → `30.1`.

---

## [30.0] — 2026-04-21

### Release v30 complète

Bump `APP_VERSION` de `30.0-beta` à `30.0`. Toutes les pages legacy majeures
migrent vers v30 (sidebar, palette, shortcuts, opt-in à jour). Les migrations
DB sont additives et backupées automatiquement.

### Tests Playwright additionnels

- `tests/e2e/v30-routes.spec.js` : smoke test sur les 18 routes `/v30/*` (200 + shell).
- `tests/e2e/v30-rapport.spec.js` : ouverture tab Rapport + autosave + export PDF.
- `tests/e2e/v30-table-nav.spec.js` : J/K/X sur lignes injectées.

Total : 13 specs v30 (dashboard, prospects, fiche, palette, shortcuts, routes,
rapport, table-nav, push-campaigns à venir).

---

## [30.0-beta] — 2026-04-21

### Filet : Service Worker + tests v30

- **SW v30.0-beta-shell** : ajout des 12 CSS et 15 JS de `/static/{css,js}/v30/`
  au pre-cache (`SHELL`), bump `CACHE` pour forcer le re-cache au prochain load.
- **5 specs Playwright v30** (`tests/e2e/v30-*.spec.js`) :
  - `v30-dashboard` : chrome v30, titre, hydratation
  - `v30-prospects` : chrome, segmented switch, ligne ou empty state
  - `v30-prospect-detail` : header hydraté + 4 tabs
  - `v30-palette` : ⌘K / Ctrl+K / recherche / Escape
  - `v30-shortcuts` : G+P, G+D, ?, [ (focus toggle)

### Migrations DB additives (avec backup automatique)

- **`scripts/v30_backup.py`** : `backup_all_databases(reason)` copie
  `data/prospects.db` + `data/auth.db` + `data/user_<id>/prospects.db` dans
  `data/backups/v30_migration/<timestamp>/` avec `manifest.json`. CLI :
  `python -m scripts.v30_backup`. Doc : [docs/ROLLBACK_V30.md](docs/ROLLBACK_V30.md).
- **`_migrate_v30_all()` au démarrage** : si une des nouvelles tables manque,
  backup puis apply sur DB principale + chaque DB per-user :
  - `push_campaigns` (id, owner_id, name, category_id, template_id,
    filters_json, scheduled_at, sent_at, stats_json, created_at, updated_at)
    + index `owner_id`.
  - `candidate_skills` (candidate_id + name UNIQUE, category, level 1-5).
  - `candidate_availability` (candidate_id + week_iso UNIQUE, status).
  - `saved_views` : ajout `owner_id`, `filters_json`, `columns_json`,
    `is_shared` (backfill `filters_json` depuis `state` si présent).
  - `push_logs.campaign_id` (+ index) pour tracking des envois par campagne.

### Push campaigns (SPEC §5.2)

- Endpoints :
  - `GET /api/push-campaigns` → liste user
  - `POST /api/push-campaigns` → crée brouillon
  - `PUT /api/push-campaigns/<id>` → maj name / filters / category_id /
    template_id / scheduled_at
  - `POST /api/push-campaigns/<id>/recipients-preview` → retourne prospects
    matchant `filters_json` (statut, pertinence_min, tags, a_relancer, limit)
  - `POST /api/push-campaigns/<id>/send` → crée un `push_log` par destinataire
    avec `campaign_id` + maj `sent_at` / `stats_json`
  - `DELETE /api/push-campaigns/<id>`
- Front :
  - `/v30/push` : grille des campagnes + modal wizard 3 étapes (Cible →
    Message → Envoi) branché sur les endpoints.
  - Création en brouillon à l'ouverture, audience live, envoi depuis le wizard.

### Saved views (Prospects)

- Pills `Tous` / `Mes prospects` / `À relancer` / `Hot` cliquables : filtre
  client-side dans `loadProspects` (pas de changement d'API).
- Bouton `+ Vue` : POST `/api/views/save` avec `{ q, filter }` puis rafraîchit
  la liste dynamique.
- Ajout `DELETE /api/views/<id>` (REST miroir de `/api/views/delete`).
- Chips dynamiques avec bouton `×` pour supprimer une vue sauvegardée.

### Candidate skills + availability (Option B, SPEC §3.8)

- Endpoints :
  - `GET /api/candidates/<cid>/skills` (backfill depuis `candidates.tech` au
    1er appel si aucune skill)
  - `POST /api/candidates/<cid>/skills` (upsert name+category+level)
  - `DELETE /api/candidates/<cid>/skills/<sid>`
  - `GET /api/candidates/<cid>/availability`
  - `POST /api/candidates/<cid>/availability` (week_iso + status
    libre|busy|placed)
- Front `/v30/candidat/<cid>` :
  - Skills groupés par catégorie, clic sur une barre change le level (1-5),
    bouton `+ Ajouter` (prompt) + `×` au hover pour supprimer.
  - Grille 8 semaines ISO : clic cycle `libre → busy → placed → libre`.

### APP_VERSION

- `30.0-alpha` → `30.0-beta`.

### Navigation clavier tables J/K/X/E/Enter (Phase 5, SPEC §2.3)

- `static/js/v30/table_nav.js` : écoute `keydown` global (skip si input focus),
  active une ligne `[data-id].is-active` dans tout conteneur `[data-v30-table-nav]`.
- `J` / `K` : ligne suivante / précédente avec `scrollIntoView` (`nearest`).
- `X` : toggle checkbox de la ligne active + dispatch `change`.
- `E` : focus sur la zone inline éditable de la ligne (fallback : ouvre la fiche).
- `Enter` : déclenche `[data-v30-open]` (= clic sur le lien de nom).
- Branché sur `/v30/prospects` et `/v30/entreprises` via `data-v30-table-nav` sur le `<tbody>`.
- CSS `.v30-pp-table tr.is-active` : inset 3px accent + background teinté.
- Modal d'aide : retire le "(futurs)" sur la section Tables, ajoute la ligne
  « Ouvrir la fiche ↵ ».

### Rapport WYSIWYG dans /v30/stats (Phase 4, SPEC §3.9)

- Onglet **Rapport** de `/v30/stats` : document éditorial centré (max 820px)
  avec zones `contenteditable` : titre, auteur, résumé, notes.
- Sections auto-injectées depuis `/api/rapport-hebdo` :
  KPI semaine, Top entreprises (10), Top pushés (10), Évolution push (sparkline
  HTML pur, barres CSS).
- Autosave `contenteditable` vers `localStorage` clé `prospup_rapport_<YYYY-Wnn>`
  (debounce 350 ms), hint « Sauvegardé hh:mm » pendant 2.5 s.
- Toolbar : toggle `semaine en cours` / `semaine précédente`, rafraîchir,
  **Copier Markdown** (clipboard), **Exporter PDF**.
- Nouvel endpoint `POST /api/rapport/export-pdf` : reçoit `{ week, html, markdown }`,
  parse le markdown (#/##, bullets, italic) et génère un PDF ReportLab A4
  (titres Navy, accent violet, Helvetica). Retourne le fichier en attachment.
- Fallback : si l'export échoue, redirige vers `/rapport?export=pdf&week=...` legacy.
- Chargement **lazy** : le rapport n'est hydraté qu'au premier clic sur l'onglet
  (ou si l'URL contient `#rapport`).

### Migration des pages legacy restantes vers v30 (Phase 3)

10 nouvelles routes v30 couvrant toutes les pages legacy :

- **`/v30/rapport`** : rapport hebdomadaire éditorial (KPI + activité + pipeline
  + notes libres WYSIWYG autosave localStorage).
- **`/v30/users`** (admin) : grille de cartes user + modale CRUD branchée sur
  `/api/users(/save|/delete)`.
- **`/v30/parametres`** : hub 8 cartes (opt-out v29, config IA, objectifs,
  sauvegardes, notifications, mise à jour serveur, mon compte, à propos) avec
  liens vers `/parametres#<section>` legacy.
- **`/v30/snapshots`** (admin) : liste avec filename/date/taille, boutons
  create/restore/delete branchés sur `/api/snapshots`.
- **`/v30/activity`** (admin) : table filtrable (utilisateur + action)
  paginée sur `/api/activity`.
- **`/v30/collab`** : hub 3 cartes vers `/collab#share-company`, `#my-shared`,
  `#shared-with-me`.
- **`/v30/duplicates`** : hub 3 cartes vers `/duplicates#companies|prospects|ignored`.
- **`/v30/metiers`** (admin) : liste + add/delete des `custom_metiers`.
- **`/v30/help`** : 8 cartes vers `/help#<ancre>` + astuces + bouton raccourcis.
- **`/v30/dc`** + `/v30/dc/<cid>` : hub générateur DC avec liens directs.

### Navigation v30 enrichie

- **Sidebar** : lien Rapport → `/v30/rapport` (au lieu de `/rapport` legacy),
  bouton Paramètres → `/v30/parametres`, ajout bouton Aide dans le footer.
- **Palette ⌘K** : 9 nouvelles entrées (Rapport, Paramètres, Utilisateurs,
  Snapshots, Activité, Collaboration, Doublons, Métiers IA, Aide).
- **Raccourcis** : ajout `G+R` (rapport), `G+A` (agenda/calendrier), `G+H` (aide).
- **Opt-out v30 → v29** : mapping complet des 10 nouvelles routes vers leur
  équivalent legacy dans `opt-in.js`.

### SW v30.0-beta-shell-2

Pre-cache mis à jour avec 7 nouveaux CSS (rapport, users, parametres, activity,
snapshots, help, metiers) et 5 nouveaux JS (rapport, users, activity, snapshots,
metiers). Bump `CACHE` pour forcer re-cache.

---

## [30.0-alpha] — 2026-04-21

### UI v30 — étape 3 (Dashboard branché + Prospects + Fiche prospect + Entreprises)

- **Focus v30** — preview sur `/v30/focus` :
  - Hero éditorial Instrument Serif 40 px (« Focus du jour. ») + date en français + sous-titre dynamique (nb relances en retard, nb RDV aujourd'hui).
  - 3 colonnes : « En retard » (`overdue_list`), « Aujourd'hui » (`feed.rdv`), « À venir » (`upcoming_rdv`).
  - Réutilise le style `.v30-ac__row` du Dashboard pour la cohérence visuelle.
  - Clic ligne → `/v30/prospect/<id>`.

- **Calendrier v30** — preview sur `/v30/calendrier` :
  - Grille mois 7×6 (lundi-dimanche) avec navigation `<` / `>` / `Aujourd'hui`.
  - Cellule du jour en pastille accent, cellules hors mois courant grisées.
  - Events hydratés via `GET /api/calendar_events` (prospects.rdvDate / nextFollowUp + candidate EC1).
  - 3 types visuels avec barre colorée à gauche : RDV (violet) · Relance (warn) · EC1 (success).
  - Limite 3 events par cellule avec overflow « +N autres ».
  - Sidebar v30 : `Focus` et `Calendrier` pointent maintenant vers `/v30/focus` et `/v30/calendrier`. Palette ⌘K + raccourci `G+F` alignés.

- **Opt-in/out v29 ↔ v30** (client-only, SPEC §5.3) :
  - Sidebar v30 : nouveau bouton `v29` dans le footer qui bascule vers la page legacy équivalente avec mapping intelligent (`/v30/prospects` → `/`, `/v30/prospect/42` → `/?prospect=42`, etc.).
  - base.html legacy : charge `static/js/v30/opt-in.js` qui affiche une bannière flottante discrète « Nouvelle interface v30 disponible → Essayer » (auto-hide 15 s, dismissible, persisté en localStorage).
  - Choix utilisateur stocké dans `localStorage.prospup_ui_mode` (`v29` | `v30`). Aucun backend modifié.

- **Raccourcis clavier globaux v30** (SPEC §2.3) :
  - Command palette : `⌘K` / `Ctrl+K` / `/`.
  - Navigation chainée `G + {D,P,E,S,F,U,T}` (Dashboard / Prospects / Entreprises / Sourcing / Focus / pUsh / sTats) avec hint flottant 1.5 s.
  - `C` ouvre la palette (section Actions rapides), `⇧T` bascule le thème, `[` toggle la sidebar, `⌘B` active le focus mode (sidebar cachée, persisté localStorage), `?` ouvre le modal aide.
  - Modal d'aide complet listant tous les raccourcis + placeholders pour les raccourcis de tableau (J/K/X/E, à brancher quand les tables v30 implémenteront la navigation clavier).
  - Ignore proprement les saisies dans input/textarea/contenteditable et dans la palette elle-même.

- **Fiche candidat v30** — preview sur `/v30/candidat/<cid>` :
  - Header : avatar + nom éditable inline + badge status + chips (LinkedIn, Source) + actions Générer DC / Pousser / More.
  - Main col : card Compétences (parsée depuis `candidates.tech` ou `skills`, barres 1-5 à niveau par défaut 3 faute de schéma dédié) + card Disponibilités 8 semaines (dérivée du champ `status` — Placé = toutes "placed", En entretien = 2 premières busy puis libre, sinon toutes libre).
  - Aside col : Campagnes match (placeholder, requiert `push_campaigns`) + Missions passées (via `/api/candidates/<id>/experiences`) + Notes éditables inline.
  - Ownership vérifié server-side (`owner_id + deleted_at`) avec redirection `/v30/sourcing` si inaccessible.
  - Inline-edit via `PUT /api/candidates/<id>` (fallback `POST /api/candidates/<id>/update`).
  - Note : niveaux de compétences 1-5 réels, dispo éditable et matching par campagne nécessitent des migrations DB (documentées en SPEC §3.8 et §5.2).

- **Command palette ⌘K v30** — disponible globalement sur toutes les pages v30 (SPEC §2.2) :
  - Ouverture via `⌘K` / `Ctrl+K` ou clic sur le bouton `data-v30-cmdk` de la topbar.
  - Fuzzy search sur `/api/search` (prospects + entreprises + candidats) avec debounce 180 ms.
  - 4 sections : Actions rapides (Créer / Nouvelle campagne / Mode Prosp / Basculer thème), résultats Prospects / Entreprises / Candidats (avec avatar + statut pill), « Aller à… » (toutes les pages v30 et legacy).
  - Navigation clavier ↑↓ + Enter (`⌘+Enter` = nouvel onglet), Esc pour fermer.
  - Injectée via `_partials/v30/palette.html` dans `base_v30.html` ; CSS `palette.css` + JS `palette.js`.

- **Stats v30** — preview sur `/v30/stats` :
  - Topbar : titre + segmented Tableau de bord / Rapport + period filter (7j / 30j / 90j / Tout) + lien « Graphiques détaillés » (ouvre `/stats` legacy pour les 8 charts Chart.js).
  - 4 KPI (Push envoyés · Taux ouverture · Taux réponse · RDV obtenus) hydratés via `GET /api/stats?days=N` (fallback `/api/dashboard` si le endpoint ne retourne pas la structure attendue).
  - Bloc Top entreprises (nb prospects) agrégé client-side depuis `/api/data`.
  - Tab Rapport : lien vers l'éditeur rapport legacy `/rapport` en attendant fusion complète (SPEC §3.9).

- **Sourcing v30** — preview sur `/v30/sourcing` :
  - Topbar : titre + compteur + segmented Pipeline / Grille + Ajouter.
  - Match banner (placeholder fermable).
  - Vue Pipeline : kanban 5 statuts (Vivier / Qualifié / Proposé / En entretien / Placé) avec mapping défensif sur la colonne `candidates.status`. Cartes compactes : avatar + nom + rôle + 3 skills + localisation.
  - Vue Grille : cartes `minmax(280px, 1fr)` avec bouton « Voir fiche ».
  - Clic sur carte → `/v30/candidat/<id>` (fiche candidat v30 à faire dans un commit ultérieur).
  - Branché sur `GET /api/candidates`.

- **Sidebar v30 câblée aux routes v30** : Dashboard · Prospects · Entreprises · Candidats · Push · Stats pointent maintenant vers `/v30/*`. Focus / Calendrier / Rapport restent legacy en attendant leur migration.

- **Push v30** — preview sur `/v30/push` :
  - Topbar : titre + segmented Campagnes/Templates/Historique + bouton accent « Nouvelle campagne ».
  - Panel **Campagnes** : empty state expliquant que la table `push_campaigns` (SPEC §5.2) est à créer + wizard preview 3 étapes (Cible / Message / Envoi) **non interactif**. Migration DB proposée dans un futur commit avec validation utilisateur (HANDOFF §5 interdit toute migration sans accord explicite).
  - Panel **Templates** : grid 3 colonnes, cartes avec nom + tags + preview body mono + stats (Utilisé / Ouverture). Lazy-load via `GET /api/templates`.
  - Panel **Historique** : timeline groupée par jour (jusqu'à 10 derniers jours, 40 lignes/jour). Push logs récupérés via `/api/data` + jointure client-side prospect → company. Statut `envoyé`/`ouvert`/`répondu` dérivé de `openedAt`/`repliedAt`. Canal mail/linkedin badge.
  - Bouton « Nouvelle campagne » → redirige vers la page Push legacy en attendant la migration DB.
- **Entreprises v30** — preview sur `/v30/entreprises` :
  - Topbar : titre + compteur + recherche inline + Filtres + Ajouter.
  - 4 KPI (Total entreprises · En pipeline · Total prospects · Actives 30j) en Instrument Serif.
  - Table 8 colonnes : Entreprise (logo 28×28 + nom), Site, Prospects (accent), RDV/Propale, Gagnés, Dernier contact, Tags (2+extra), lien clic → `/v30/entreprise/<id>` (la fiche entreprise v30 viendra après).
  - Branchée sur `GET /api/data` (réutilise le style prospects.css) ; agrégation par `company_id` côté client (total / piped / won / max lastContact).
  - Recherche fuzzy client-side (groupe + site + tags), debounce 150 ms.
  - Note : le schéma `companies` n'a pas `secteur`/`effectif`/`CA` du JSX de référence — la colonne JSX "CA prévu" a été remplacée par un comptage `Gagnés`. Ajout éventuel en migration DB plus tard si demandé.

- **Fiche prospect v30** — preview sur `/v30/prospect/<id>` :
  - Header : avatar 56 px, nom éditable inline, pill statut, chips email/tél/LinkedIn, actions Pousser / Appeler / Planifier.
  - Layout 2 cols : main (tabs Aperçu / Timeline / Push / IA) + aside (Détails, Tags, Entreprise).
  - **Edit-in-place** sur Nom, Notes, Fonction, Email, Téléphone via `POST /api/prospects/bulk-edit` (ids=[pid], field, value). Enter pour sauver, Esc pour annuler, checkmark vert 1.2 s.
  - Timeline Activité branchée sur `/api/prospect/timeline?id=X` (push / RDV / notes / status change, dots colorés par type).
  - Tab Push : liste des pushs avec badge channel.
  - **Drawer IA** (480 px) avec backdrop + Esc pour fermer ; placeholder pour Scraping / Avant-RDV / Après-RDV (branchement complet dans un commit ultérieur).
  - Route Flask : ownership vérifié via `owner_id + deleted_at`, redirection vers `/v30/prospects` si inaccessible.
  - `prospects.js` : redirection clic ligne/carte désormais vers `/v30/prospect/<id>` (plus vers la fiche legacy).
  - 3 fichiers JS chargés defer : `prospect_detail.js` (helpers + fetch), `prospect_detail_render.js` (rendu), `prospect_detail_ui.js` (events + drawer). Architecture modulaire pour éviter les gros fichiers.

### UI v30 — étape 3 (branchement Dashboard + écran Prospects)

- **Dashboard v3 branché** sur les vraies données via `static/js/v30/dashboard.js` :
  `/api/dashboard` pour hero KPIs, goals, feed activité ; `/api/dashboard/pipeline-stages`
  pour pipeline + priorités IA ; `/api/tasks?status=pending` pour l'action center
  "À faire". Plus aucune donnée mockée (sauf streak, faute de table dédiée).
  `page_v30_dashboard()` passe désormais `display_name`, `user_initials` et les
  compteurs sidebar réels.
- **Prospects v30** — preview sur `/v30/prospects` :
  - 3 vues switchables : Table (densité 32px, 10 colonnes incluant Mobile avec
    pastille de disponibilité, Pertinence en 5 barres), Kanban (5 statuts,
    cartes compactes), Split (320px liste + panel détail).
  - Bulk bar flottante (fond `var(--text)`) apparaissant dès une sélection :
    Pousser · Email IA · Tel IA · Tag · Assigner · Effacer.
  - Recherche fuzzy inline branchée sur `GET /api/search` (debounce 200 ms).
  - Pagination offset-based (50/page).
  - Sélection multi-lignes (checkbox + cocher tout).
  - Bulk tags branché sur `POST /api/prospects/bulk-status-tags` ; push bulk
    redirige vers `/push?ids=…` faute d'endpoint bulk-push.
  - Clic sur une ligne → redirection vers la fiche legacy `/?prospect=id`
    (la fiche v30 viendra dans un commit ultérieur).
- Nouveau fichier JS chargé defer, aucun framework. Nouveau CSS
  `static/css/v30/prospects.css`. `APP_VERSION` bumpée 29.9 → 30.0-alpha.

## [29.9] — 2026-04-21

### UI v30 — étape 3 (écrans 1 & 2)

- **Login v30** (`templates/v30/login.html`, route `/v30/login`) : split 60/40 (formulaire + colonne éditoriale avec citation + 3 stats). Formulaire fonctionnel (POST `/api/auth/login`, redirection `/dashboard` ou `/parametres?change_password=1`). `/v30/login` ajouté à la liste des routes publiques dans `before_request`.
- **Dashboard v3** (`templates/v30/dashboard.html`, route `/v30/dashboard`, CSS `static/css/v30/dashboard.css`) : hero éditorial + 4 KPI Instrument Serif + streak card ; bento 2:2:1 (Action center avec tabs À faire/RDV/En retard · Pipeline 5 étages · Objectifs avec ring SVG) ; bento 1:1 (Priorités IA · Timeline activité). Données mockées reprises du JSX de référence — branchement SQL dans un futur commit.
- Tabs Action center : switch client-side vanilla (aucun framework ajouté).

## [29.8] — 2026-04-21

### UI v30 — étape 1 & 2 (design system + navigation)

- Design system v30 intégré dans `static/css/v30/` (tokens OKLCH light + dark, 286 lignes `components.css`, chrome topbar/sidebar). Non destructif : le v29 reste intact.
- Partials Jinja v30 : `templates/_partials/v30/icon.html` (macro SVG reproduisant le dict `Icon` de `_chrome.jsx`), `topbar.html`, `sidebar.html`, `theme_toggle.html`.
- `templates/v30/base.html` : squelette autonome avec Google Fonts (Inter · Instrument Serif · JetBrains Mono), init thème inline, `data-theme="dark"` par défaut, persistance localStorage.
- Route preview isolée `GET /v30/preview` (template `templates/v30/preview.html`) pour valider visuellement le chrome et une sélection de composants avant migration écran par écran.
- `CHECKLIST.md` ajouté à la racine pour suivre la migration v30 étape par étape (SPEC.md § Page-by-page).

## [29.7] — 2026-04-18

### Nettoyage
- Suppression de 13 docs obsolètes dans `docs/` (plans non implémentés, audits historiques, rapports ponctuels).
- Suppression du duplicata `Template_DC/` (la vraie template vit dans `sample/template_dc.docx`).
- Suppression de fichiers accidentels (`nul`, logs root non gitignored).
- `node_modules/` retiré du git tracking (559 fichiers ~14 MB, ajouté à `.gitignore`).

### .gitignore
- Ajout : `node_modules/`, `.supervisor_pid`, `snapshots/`, `backups/`, `*.log`, `Thumbs.db`, `.claude/settings.local.json`.
- Réorganisation par section (Python, Node, Secrets, DB, Runtime, Logs, Outputs, Misc).

### Docs
- `README.md` réécrit (version 29.6, structure à jour, commandes, liens valides).
- `CLAUDE.md` réécrit — tailles de fichiers actualisées, sections simplifiées, liens vers les nouveaux docs workflow.
- Nouveaux : `.claude/WORKFLOW.md` (règles non-négociables) + `.claude/CHEATSHEET.md` (patterns récurrents).
- Nouveau : `CHANGELOG.md` (ce fichier).

## [29.5] — 2026-04 (non taggé)

- Stats : ajout `topPushedConsultants` (top 6 consultants pushés, historique complet).
- Stats : ajout `urgencyDistribution` (Priorités IA — répartition overdue/today/week/later).

## [29.4] — avril 2026

- Bouton « Ajouter » disponible dans tous les onglets candidats (PR #211).
- Fix dropdown téléphone décalé (suppression classe animation après `animationend`, PR #210).

## [29.x] — mars-avril 2026

- Mode Prosp v6 : redesign deck 3D premium (b15e222, d95df8b).
- Sourcing : onglet LinkedIn avec statuts exclusifs (f751d67).
- Support CV/LinkedIn dans l'assistant d'ajout candidat (1b323e0).
- Sessions Mode Prosp persistées en DB (bcef4fd).
- Push : grille 3 colonnes au lieu de liste verticale (71dc33d).

## Historique plus ancien

Voir `git log --oneline`. Versions antérieures (21.x à 28.x) documentaient les grands chantiers :
- v21.0 : restructuration racine, multi-user owner_id strict.
- v23.5 : soft delete (colonne `deleted_at`).
- v25.1 : sécurisation users + JWT mobile.
- v27.x : cohérence UI.
- v28.0 : IA Ollama + Tavily unifiée.
