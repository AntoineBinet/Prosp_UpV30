# Changelog

Historique des versions significatives. Incrément dans [app.py:38](app.py).

## [32.55] — 2026-05-12 · Rapports email quotidien & hebdomadaire

- **Rapports email programmés** : deux nouveaux mails envoyés
  automatiquement par le scheduler interne. Templates calqués sur le
  modèle HTML fourni (en-tête orange, KPI 2×2, alerte relances,
  priorités du jour pour le quotidien — funnel, top comptes, heatmap
  pour l'hebdomadaire). Email-safe : tables HTML, styles inline,
  largeur 600 px, fallback Georgia pour l'italique Instrument Serif.
- **Quotidien** : par défaut lundi → vendredi à 17:00. Résume la veille
  (appels, RDV, taux de transfo, push) avec deltas vs J-1 et moyenne 7 j,
  alerte relances en retard nominatives, top 3 priorités du jour
  (prospects avec `nextFollowUp = today`).
- **Hebdomadaire** : par défaut lundi 07:00. Funnel Prospects → Contactés
  → Qualifiés → RDV, deltas S-1 et N-1 sur 4 KPI, top 5 comptes (push +
  RDV), heatmap 5 jours × matin/après-midi, note auto.
- **Réglages** (Paramètres → onglet « Notifications » → carte « Rapports
  email », ancre `#email-reports`) : destinataires multiples, jour(s) et
  heure réglables (par 5 minutes), SMTP host/port/user/password/from,
  STARTTLS ou SSL direct. Boutons « Aperçu HTML », « Envoyer maintenant »
  et « Tester l'envoi SMTP ».
- **Sécurité** : le mot de passe SMTP n'est jamais renvoyé en clair
  ([routes/settings.py](routes/settings.py)) — l'API expose le marqueur
  `__set__` et préserve la valeur stockée si l'UI ne la modifie pas.
- **Scheduler** : APScheduler exécute `_dispatch_email_reports` chaque
  minute ; un verrou évite les chevauchements, un anti-doublon par date
  (`email_last_daily_sent`, `email_last_weekly_sent`) protège contre les
  envois multiples si l'app redémarre pendant la fenêtre.
- **Endpoints** : `GET /api/email-reports/preview?kind=daily|weekly`,
  `POST /api/email-reports/send`, `POST /api/email-reports/test`.
- **Toile d'araignée** : nouvelle action « Rapports email » sur la page
  Paramètres.

## [32.54] — 2026-05-12 · Dashboard · Aperçu rapide en remplacement des panneaux vides

- **Dashboard** : les panneaux « Besoins ouverts » et « Derniers candidats vus
  en EC » sont désormais **masqués** quand ils n'ont pas de contenu. Plus
  d'état vide qui prend la moitié de la rangée pour rien.
- **Aperçu rapide** (nouveau widget) : affiché en remplacement des panneaux
  cachés. Montre 4 mini-stats — Prospects actifs (pipeline), RDV pris
  (semaine), Push (semaine, avec delta vs sem-1), Conversion RDV (% du
  pipeline). Lien vers `/v30/stats`.
- **Layout** : si un seul panneau est vide → l'Aperçu rapide prend sa
  colonne. Si les deux sont vides → l'Aperçu rapide prend toute la largeur
  (grille 4 colonnes).
- **Toile d'araignée** : nouvelle action « Aperçu rapide — fallback stats si
  panneaux vides » ajoutée à la page Dashboard
  ([routes/pages.py](routes/pages.py)).

## [32.48] — 2026-05-11 · Sidebar · Réorganisation Admin → Paramètres

- **Sidebar simplifiée** : la section « Admin » disparaît entièrement de la
  sidebar (sur toutes les pages, mobile + desktop). Les pages Utilisateurs,
  Snapshots, Journal et DC Generator deviennent des cartes déployables dans
  `/v30/parametres`.
- **Métiers IA** rejoint la section « Outils » de la sidebar (auparavant dans
  Admin) — utilisable par tous, plus seulement par les admins.
- **DC Generator** sort de Outils et rejoint la section « Anciens outils /
  essais » dans Paramètres (carte déployable avec lien vers `/v30/dc`).
- **Paramètres** : nouvelles cartes embarquées
  (`templates/v30/parametres.html`) — Utilisateurs (table + modale création
  /édition + onglet Historique), Journal d'activité (filtres + pagination),
  DC Generator (raccourci). Les scripts `users.js` et `activity.js` sont
  chargés sur la page Paramètres pour piloter ces cartes.
- **Nouvel onglet Admin** dans la tab-bar Paramètres (regroupe Sauvegardes,
  Utilisateurs, Journal). Onglet « Anciens outils / essais » pour DC
  Generator. Les cartes peuvent porter plusieurs `data-tab` (espace-séparé).
- **Auto-ouverture** : `/v30/parametres?card=<id>` (users, activity, backup,
  dc…) déplie automatiquement la carte ciblée — utilisé par la palette de
  commandes et les redirections.
- **Palette (Cmd+K)** mise à jour : Utilisateurs/Snapshots/Journal/DC pointent
  vers `/v30/parametres?card=...`.
- **Toile d'araignée** (`routes/pages.py → _build_sitemap_data`) recâblée :
  Métiers IA passe en `cat=outils`, DC Generator en `cat=autres`, et les
  liens admin pointent vers Paramètres.
- **Help** (`templates/v30/help.html`) : liens admin redirigés vers
  Paramètres.

## [32.47] — 2026-05-11 · Login · Constellation rebasculée sur le style 32.43

- Retour au style « centré + masqué » de la 32.43 (canvas
  `clamp(340px, 46vw, 600px)` centré via `top/left: 50%` +
  `transform: translate(-50%, -50%)`, mask radial qui fade les bords,
  opacity 0.62). La version « pleine surface » (32.44 → fix 32.46) a été
  rejetée à l'usage : trop chargée derrière le titre, moins lisible.
- `.mq-editorial` repasse sur `position: relative; min-width: 0;` sans
  `flex` ni `align-self: stretch` (le canvas n'a plus besoin que le
  parent stretch pour avoir une dimension).
- Mobile (≤ 900 px) : retour à `opacity: 0.55; width/height: 88vw`.
- `prefers-reduced-motion` : retour à `opacity: 0.45`.

## [32.46] — 2026-05-11 · Login · Constellation rendue (canvas replaced-element)

- **Constellation à nouveau visible** sur `/login` et `/v30/login`. Régression
  introduite en 32.44 (passage à `inset: -24px`) : `<canvas>` est un *replaced
  element* avec des dimensions intrinsèques de 300×150 px qui ne sont pas
  écrasées par `inset` seul. Le canvas restait donc à 300×150 px en haut à
  gauche de la section éditoriale, et le script
  `login-constellation.js` dessinait ses points dans cette petite zone — ils
  étaient quasi invisibles. Fix : remplacement de `inset: -24px` par
  `top/left: -24px` + `width/height: calc(100% + 48px)`, qui force
  explicitement la taille rendue.

## [32.45] — 2026-05-11 · Dashboard · Détail gamification + RDV aujourd'hui

- **« RDV aujourd'hui » corrigé** : l'onglet du centre d'action utilisait
  `data.feed.rdv` qui est event-based (transitions `rdv_taken` ce jour).
  Résultat : un prospect avec `rdvDate=today` mais déjà au statut
  Rendez-vous n'apparaissait pas. Bascule sur `data.today_appointments`
  (filtré par `rdvDate == today`) pour refléter ce que l'utilisateur
  attend — *les meetings programmés aujourd'hui*.
- **Détail gamification (info button discret)** : nouvelle icône (i) à côté
  du titre « Objectifs ». Ouvre une modale qui liste les *sources
  comptabilisées* pour chaque objectif (jour + semaine) :
  event `rdv_taken` (avec nom du prospect + date du RDV), push log
  (email / LinkedIn, sujet, destinataire), `candidate_contacted` /
  `candidate_solid` / `linkedin_inmail`, et `manual_kpi` (correction
  manuelle, valeur, description). Permet d'expliquer pourquoi un
  compteur vaut 1 et de diagnostiquer les sur-comptages éventuels
  (transition de statut involontaire, ajustement manuel oublié…).
- **Backend** : `/api/dashboard` retourne désormais `goals.breakdown`
  (daily + weekly) avec les rows sources de chaque objectif.

## [32.44] — 2026-05-11 · Login · Constellation pleine, hairlines retirées, PWA up

- **Constellation pleine surface** : alignement final sur marienour.work
  (`.hero-cloud { inset: 0 }`). Le canvas remplit désormais tout le bloc
  éditorial (`inset: -24px` pour mordre légèrement au-delà), à `opacity: 1`,
  sans `mask-image` radial. Les nœuds et le spotlight orange restent nets
  jusqu'aux bords. La section éditoriale passe en `align-self: stretch` +
  flex-column centré, pour que la cell de la grille soit pleine hauteur.
- **Plus de fines barres grises empilées** : suppression du
  `border-bottom: 1px solid var(--hair-warm)` sur `.mq-top` (la marquise
  garde la sienne, qui sépare déjà l'en-tête du corps). Élimine la
  « barre grise » perçue sous le bandeau défilant.
- **Icônes PWA refaites** : `static/favicon.ico`, `static/icon-192.png`
  et `static/icon-512.png` sont régénérés à partir de la même source
  SVG que la marque Up Technologies (orange #EF8827, « up » blanc
  italique). Plus de « P » violet hérité — la tab du navigateur et
  l'icône installable matchent enfin la refonte 2026.

## [32.43] — 2026-05-11 · Login · Constellation refondue + nettoyage visuel

- **Constellation alignée sur marienour.work** : port direct du `PointCloud`
  React du portfolio Up Technologies vers le `login-constellation.js` vanilla.
  Apporte 3 classes de points (60 % petits, 30 % moyens, 10 % hubs avec
  halo orange), 4 plus proches voisins au lieu de 3, épaisseurs de ligne
  proportionnelles à la distance + à la taille des nœuds, et un rendu en
  deux passes (encre pour les liens de base, spotlight orange à la souris).
  Les paramètres clés sont calqués sur l'original (`density=2.2`,
  `LINK_D=185`, `MOUSE_R=180`, `baseAlpha=0.28`).
- **Marquise sans « barre grise »** : le fond `--cream-2` du bandeau
  défilant créait une bande grise qui paraissait déborder sous le contenu.
  Le bandeau est maintenant `--cream` (même teinte que la topbar et le
  corps), les fades latéraux suivent. Seules les fines hairlines
  `--hair-warm` (1 px) séparent encore les zones.
- **Footer recentré sur Antoine Binet** : suppression de la mention
  « SSO Up Technologies » sous le formulaire (le pied de carte affiche
  désormais uniquement le lien « Demander un accès » aligné à droite),
  et bascule du copyright vers « © 2026 Antoine Binet · Up-Technologies
  · France ».

## [32.42] — 2026-05-11 · Login · Constellation nette + page sans scroll

Polissage de la refonte 32.41 :

- **Constellation plus nette** : le canvas mesurait la bbox de son parent
  (`.mq-editorial`) alors qu'il était re-dimensionné par un `clamp()` CSS,
  d'où un backing-store qui ne matchait pas la taille rendue → nœuds flous
  sur les viewports où parent < clamp. Bascule sur
  `canvas.getBoundingClientRect()` (la taille réellement rendue) et
  `ResizeObserver.observe(canvas)` au lieu du parent.
- **Plus de scroll sur /login et /v30/login** (desktop ≥ 900 px) :
  `html, body { overflow: hidden }`, `.mq { height: 100dvh; overflow: hidden }`.
  Les valeurs typo et padding ont été réduites pour que tout le contenu
  tienne dans 100 dvh sans clip :
  - `--topbar-h` 48 → 44 px, `--marquise-h` 60 → 52 px, `--form-w` 560 → 520 px.
  - `.mq-title` `clamp(40, 7vw, 78)` → `clamp(30, 5vw, 58)`, line-height
    0.98 → 1.0.
  - `.mq-sub` 20 → 16 px, margin-top 32 → 20 px, max-width 520 → 480.
  - `.mq-eyebrow` 11 → 10.5 px, margin-bottom 18 → 12.
  - `.mq-card` padding 40 44 → 28 32, `.mq-form gap` 26 → 18,
    `.mq-submit` height 48 → 44.
  - `.mq-body` padding `clamp(36, 6vw, 72)` → `clamp(16, 3vh, 36)` (vh pour
    suivre la hauteur disponible).
  - `.mq-foot` padding-bottom 20 → 10.
- **Mobile (< 900 px) conserve le scroll naturel** : `html, body { overflow:
  auto; height: auto }` + `.mq { height: auto; min-height: 100vh }` réactivé
  dans la media query, pour garder la version 1-colonne empilée.
- **Constellation re-dimensionnée** : `width/height` clamp 420-760 → 340-600,
  recalée sur la nouvelle taille de la colonne éditorial.

## [32.41] — 2026-05-11 · Login · Constellation animée derrière l'éditorial

Ajoute une animation discrète de **constellation** (canvas) derrière le titre
de `/login` et `/v30/login`, inspirée du fond hero du site
[Up Technologies — Refonte 2026](https://marienour.work/site-entreprise/) :

- **Canvas plein-rendu vanille** : `static/js/v30/login-constellation.js`.
  Nœuds drift-and-wrap avec micro-wobble sinusoïdal, ~30 à 70 particules selon
  la taille du conteneur. Chaque nœud est relié à ses 3 plus proches voisins
  par des liens hairline (alpha proportionnel à la distance).
- **Surbrillance accent** au passage du curseur : nœuds et liens proches de la
  souris virent à l'orange `rgba(239,136,39,...)` — exactement la signature du
  hero d'Up Technologies. Tracking via `mousemove` window + fallback tactile.
- **Halo circulaire fade** : masque `radial-gradient` (`-webkit-mask-image` +
  `mask-image`), 30 % opaque au centre, 0 % à 78 % du rayon. Ne déborde pas
  sur la colonne formulaire — reste un fond design derrière le H1.
- **Couleurs alignées** sur la palette login (encre `rgba(17,32,42,…)` pour
  les nœuds inactifs, accent orange UP Technologies pour le hover).
- **Sobre par défaut** : `pointer-events: none`, `aria-hidden`, `z-index: 1`
  sous le texte (qui passe en `z-index: 2`). `prefers-reduced-motion: reduce`
  → dessine une frame statique puis stoppe le RAF.
- **Pause sur onglet caché** via `visibilitychange` ; `ResizeObserver` pour
  re-build proprement les particules quand la fenêtre change.

## [32.40] — 2026-05-11 · Dashboard · Fix compteurs RDV + accès rapide besoins/EC

Trois corrections sur `/v30/dashboard` :

- **KPI « RDV sem. » du hero** : affichait 0 alors qu'on avait 3 RDV
  programmés cette semaine. Le compteur utilisait `rdv_taken_week`
  (events `rdv_taken`), qui ne reflète pas les RDV *programmés* avec un
  `rdvDate` cette semaine. Ajout d'un nouveau compteur
  `week.rdv_scheduled` calculé sur `prospects.rdvDate ∈ [monday;sunday]`
  et utilisé pour le KPI hero. `week.rdv_total` reste réservé à la
  gamification et au breakdown Performance (« X pris »).
- **Sous-titre « X RDV aujourd'hui »** : utilisait `pipeline.due_today`
  (= prospects dont `nextFollowUp` est aujourd'hui), ce qui pouvait
  inclure des relances non-RDV. Bascule sur `week.rdv_today` (count des
  `rdvDate` qui tombent aujourd'hui).
- **Bug gamification « Prendre 1 RDV Prosp 1/1 »** : la query SQL de
  `rdv_taken_today` / `rdv_taken_week` faisait un UNION avec un fallback
  sur les prospects `statut='Rendez-vous'` ET `lastContact` dans la
  période. Conséquence : tout edit/sync touchant un prospect déjà en
  Rendez-vous (qui met à jour `lastContact`) incrémentait l'objectif.
  Fallback supprimé — on ne compte plus que les events `rdv_taken`
  explicites (créés par `upsert_all` à la transition vers Rendez-vous ou
  au changement de `rdvDate`).

Ajout d'une nouvelle section **Quick access** en haut du dashboard,
juste sous le hero, avant Performance/Objectifs :

- **Besoins ouverts** (carte gauche) — top 5 besoins `statut='ouvert'`
  ou `'en_cours'`, triés par statut puis priority/updated_at. Affiche
  intitulé, client/entreprise, localisation, date de besoin, nombre de
  candidats associés, badge statut. Compteur total dans le header.
  Clic → fiche besoin `/v30/besoins/<id>`. Empty state : CTA « Créer un
  besoin ».
- **Derniers candidats vus en EC** (carte droite) — top 5 candidats avec
  `entretien_date` renseigné, triés par date EC desc puis updatedAt.
  Affiche nom, rôle/seniority/localisation, date EC relative, lieu.
  Clic → fiche candidat `/v30/candidat/<id>`. Empty state : CTA « Voir
  le sourcing ».

Layout responsive : grille 2 colonnes en desktop (`v30-bento-quick`,
≥ 1100 px), 1 colonne en dessous. Cards alignées sur le design system
v30 existant (`.card-flush`, `.card-header`, `.avatar`, badges).

API : extension de `GET /api/dashboard` avec deux nouveaux blocs dans
le payload :
- `besoins` : `{open_total, inprogress_total, items[]}` (max 5 items).
- `recent_ec` : `Candidate[]` (max 5), champs `id, name, role, location,
  tech, seniority, status, entretien_date, entretien_lieu`.

Aucune migration DB. Aucun nouvel endpoint dédié (tout passe par
`/api/dashboard` pour économiser un round-trip au chargement).

Toile : 4 nouvelles actions sur le nœud « Dashboard » (`besoins-quick`,
`ec-quick`, `besoin-open-link`, `candidat-ec-link`) — voir
`routes/pages.py:_build_sitemap_data()`.

## [32.39] — 2026-05-11 · Besoin · Export PDF complet (fiche + candidats)

Nouvel export PDF de la fiche besoin (A4, mise en page ProspUp v30) :

- **Bouton « Export PDF »** dans le header de la fiche besoin, à côté
  des exports/imports Excel existants.
- **En-tête** : eyebrow, intitulé en gros (Helvetica-Bold 20pt), méta
  (client · contact · localisation), chip statut coloré à droite,
  trait horizontal accent.
- **Bloc infos générales** : grille 2 colonnes label/valeur (Client,
  Contact, Localisation, Profil recherché, Date appel, Date besoin,
  Durée mission, Lié au prospect).
- **Bloc Mission** : Descriptif, Compétences requises, Connaissances
  attendues, Expérience, Commentaires (sections affichées seulement si
  renseignées).
- **Bloc Candidats positionnés** : pour chaque candidat,
  numéro `#NN`, nom en gras, méta (rôle / séniorité / lieu / diplôme),
  contact (Tél., Email, Profil), chip statut coloré (Disponible vert,
  Messagerie bleu, Pas contacté gris, Non disponible rouge), bande
  verticale colorée à gauche selon le statut, grille 3×3 des champs
  de tracking (Dispo, Appel, DT, RDV1, RDV2, RT, Envoi DT, Propal,
  RT client), bloc Commentaires sur fond bleu clair si rempli.
- **Bloc Préparation RT** en fin de document si renseigné.
- **Header / footer** sur chaque page : bandeau accent en haut, eyebrow
  « PROSP'UP · TRAITEMENT BESOIN », date de génération + numéro de page.
- Route : `GET /api/besoins/<id>/export.pdf` → `fiche_besoin_<intitule>.pdf`.

## [32.38] — 2026-05-11 · Besoin · Réordonnancement des candidats positionnés

Sur la fiche besoin (`/v30/besoins/<id>`), la liste des candidats
positionnés peut maintenant être réordonnée :

- **Tri automatique par dispo** : nouveau bouton « Trier par dispo »
  dans le header de la section. Ordre obtenu : `Dispo` (vert) en haut →
  `Messagerie` (bleu) → `Pas contacté` → `Non dispo` (rouge) en bas.
  Toast de confirmation, tri stable au sein d'un même statut.
- **Drag & drop manuel** : nouvelle poignée à six points à gauche de
  chaque carte (`v30-cand-card__handle`). Indicateur d'insertion bleu
  au survol (`is-drop-before` / `is-drop-after`). Fonctionne en desktop
  (HTML5 drag) et mobile (touchstart + elementFromPoint).
- L'ordre est persisté via le `PUT /api/besoins/<id>` existant
  (auto-save 1,2 s après modification).

## [32.37] — 2026-05-11 · Login · Refonte « Marquise » (ticker animé + éditorial)

Refonte complète de `/login` (et de son preview `/v30/login`) selon le
handoff design `ProspUp_Design_System` (piste « Marquise ») :

- **Layout 2 colonnes** (cible 1400 × 880) : phrase éditoriale serif
  italique à gauche, formulaire flottant 560 px à droite. En dessous de
  900 px, bascule en une seule colonne (texte au-dessus du formulaire).
- **Marquise / ticker animé** en haut, juste sous la topbar : 60 px de
  haut, défilement horizontal `translateX(0 → -50%)` en boucle 60 s.
  Liste dupliquée × 4 pour garantir un loop seamless. Fades latéraux
  120 px sur les deux bords pour masquer la coupure.
- **4 tones** (rdv violet, callback ambre, call teal, voicemail mauve)
  alignés sur les `--status-*` existants. Pastille 5 × 5 px par item,
  point médian U+00B7 dans l'heure (signature « marquise »).
- **Endpoint `GET /api/tick`** créé (accessible avant auth,
  `Cache-Control: no-store`, `X-Robots-Tag: noindex`) : retourne un jeu
  d'exemples **strictement statique et anonymisé** — pas de nom, pas
  d'ID, pas de société. Aucune donnée réelle ne fuite pré-login. Le
  client vérifie en plus que les clés JSON ne contiennent pas
  `name|email|phone|company|user|...` avant d'afficher.
- **H1 éditorial** 78 px Instrument Serif italique sur 3 lignes
  (« Le pipeline / d'une journée / d'équipe, en mouvement. »), avec
  **soulignement SVG manuscrit** sous *mouvement* dessiné à T+300 ms
  (stroke-dasharray draw-in 1300 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`).
- **Champs InkField** : hairline crème → wipe accent indigo 2 px de
  gauche à droite (600 ms) au focus. Valeurs en Instrument Serif italique
  22 px (texte) ou JetBrains Mono 18 px `letter-spacing: 0.18em` (mots
  de passe). Caret accent visible au focus.
- **Bouton submit** plein crème inversé (fond ink-950, texte cream),
  sans border-radius, badge `↵` à droite. Spinner mono au loading.
- **Fond papier** : `--cream` `oklch(0.985 0.006 80)` avec overlay
  grain SVG turbulence (`feTurbulence`, sépia, mix-blend-mode multiply,
  opacité 0.40) + filets verticaux subtils tous les 80 px. Désactivés
  sur < 600 px pour les perfs.
- **Topbar 48 px** : logo P serif italique + horloge live (FR, dayOfWeek
  + date + HH:MM, refresh 30 s) + pulse dot indigo + flag
  « FLUX AGRÉGÉ · ANONYMISÉ · RGPD ».
- **Tokens** : ajout de `--cream`, `--cream-2`, `--hair-warm`,
  `--hair-warm-2` dans `static/css/v30/tokens.css` (utilisables pour
  d'autres pages éditoriales à venir).
- **A11y** : labels visibles, focus visibles, contraste ≥ AA, ordre
  Tab natif (identifiant → mot de passe → bouton). Tous les éléments
  décoratifs (grain, filets, pulse, marquise) `aria-hidden`.
  `prefers-reduced-motion` : marquise figée, soulignement statique,
  wipe immédiat, pas de pulse — formulaire toujours utilisable.
- **Graceful degradation** : `<noscript>` fallback dans la marquise
  (4 items statiques), formulaire en POST classique, soumission OK
  sans JS via la même route `/api/auth/login`.

Aucune migration DB. Le formulaire continue d'appeler `/api/auth/login`
et redirige vers `/v30/dashboard` (ou `/parametres?change_password=1`
si `must_change_password`).

## [32.36] — 2026-05-09 · Toile d'araignée · Refonte split + style minimaliste

La toile (`/v30/sitemap`) abandonne la vue radiale plein écran pour un
layout 2 colonnes calqué sur un design de référence minimaliste fourni :

- **Layout 2 colonnes** : toile interactive (~70%) à gauche + panneau
  détail (~30%) à droite. L'index central a été testé puis retiré.
- **Style minimaliste** : cercles à fill blanc avec contour catégorie,
  lignes droites fines (stroke 0.8 / opacity 0.45 inactif, 1.4 / 0.9
  actif), labels uniquement sur la branche active. Plus aucun halo,
  drop-shadow, pulse ou flottement — exactement le rendu de la réf.
- **Hub** : grand cercle blanc à contour foncé, label « Dashboard »
  centré dedans (font 11px, weight 600).
- **3 modes** : « Tout » (toile entière, pannable/zoomable),
  « 2° » (sélectionné + voisins jusqu'à 2 sauts, défaut),
  « Voisins » (sélectionné + voisins directs).
- **Détail enrichi** : titre en serif italique (Instrument Serif), chips
  Catégorie / Tier T0-T2 / Kind, JS Handler, Endpoints, Backend, Statut,
  Voisins cliquables, bouton Ouvrir + raccourci ⌘O.
- **Topbar simplifiée** : breadcrumb « Toile · ProspUp / [nœud] »,
  recherche centrale (F), compteur nœuds/liens, bouton aide.
- **Raccourcis** : F/`/` (recherche), R (recentrer), +/− (zoom),
  ⌘O (ouvrir), Échap (ferme search/help).

Aucune modification de la structure de données (`_build_sitemap_data`
inchangée, 199 nœuds + 198 liens, statuts injectés depuis
`data/sitemap_status.json`). Pas d'impact backend.

## [32.35] — 2026-05-09 · Calendrier & Stats · Sam/dim/JF non travaillés

L'utilisateur ne travaille pas le weekend ni les jours fériés. ProspUp en
tient compte sans masquer les éventuels RDV exceptionnels :

- **Calendrier** (`/v30/calendrier`, vues mois/semaine/jour) : les cases
  samedi, dimanche et JF sont **grisées** (background atténué, libellé en
  `text-muted`) avec le **nom du jour férié** affiché en badge dans la
  cellule + tooltip natif. Les RDV restent cliquables comme les autres
  jours — la grille n'est pas amputée.
- **Dashboard** (`/v30/dashboard`) : la **série active** (streak), le
  compteur "jours actifs cette semaine" et le **meilleur jour** ignorent
  désormais sam/dim/JF. Un dimanche sans activité ne casse plus le streak.
- **Source des JF** : package Python `holidays` (offline, métropole France),
  ajouté à `requirements.txt`. Cache process par année.
- **Nouvelle route** : `GET /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD`
  (cf. [routes/calendar.py](routes/calendar.py)).
- **Helper unique** : [services/working_days.py](services/working_days.py)
  expose `is_working_day(date)`, `count_working_days(start, end)`,
  `get_holidays(start, end)`, `holiday_name(date)`.
- **API `/api/dashboard`** : ajoute `is_working_day` et `holiday_name` à
  chaque entrée `week.days[]`, plus un bloc `working_days` racine
  (`today_is_working_day`, `today_holiday_name`, `week_total`,
  `week_elapsed`).

## [32.34] — 2026-05-09 · Stats · 4 nouveaux graphiques alignés design system

La page **Stats** (`/v30/stats`) gagne 4 nouvelles visualisations qui complètent
la migration depuis l'UI legacy en utilisant le design system v30 (tokens
OKLCH, gradients accentués, typographie serif/mono) au lieu des charts
Chart.js bruts hérités de la v29 :

- **Funnel · Conversion** : barres horizontales par étape (À contacter →
  Appelé → À rappeler → Messagerie → Rendez-vous), badges de drop‑off entre
  paliers et taux de conversion global dans le head de carte.
- **Compétences demandées** : top 10 tags / compétences extraits des
  prospects, barres dégradées en accent.
- **Portefeuille — 12 dernières semaines** : courbe Chart.js ton accent avec
  badge tendance (delta absolu + %) dans le head de carte.
- **Heatmap · Activité 8 semaines** : grille 7 jours × 8 semaines, intensité
  en quartiles sur appels + notes + push (style GitHub, légende calme→intense).

Backend (`/api/stats/charts`) étendu avec `topTags`, `dailyActivity` (56 j) et
`portfolioPerWeek` (12 semaines).

## [32.33] — 2026-05-07 · Carte · Fix bouton « Géocoder en masse »

Sur la page **Carte** (`/v30/carte`), le bouton **Géocoder en masse** ouvrait
bien la modale dans le DOM (`hidden=false`), mais celle-ci restait invisible
et non interactive : la CSS de `.v30-modal-bd` impose `opacity: 0;
pointer-events: none` jusqu'à ce que la classe `.is-open` soit ajoutée.

`openBulkModal()` / `closeBulkModal()` dans `static/js/v30/carte.js`
appliquent désormais le pattern standard v30 (cf. `entreprises.js`,
`dashboard.js`, `push.js`) : `hidden=false` → reflow → `add('is-open')`
à l'ouverture, et `remove('is-open')` → `setTimeout 160 ms` → `hidden=true`
à la fermeture pour respecter la transition.

## [32.32] — 2026-05-07 · Besoins · Statut « Messagerie » sur les candidats positionnés

Sur la fiche traitement d'un besoin, dans le bloc **Candidats positionnés**,
les cartes de candidats peuvent désormais cycler sur 4 statuts au lieu de 3 :

- **Pas contacté** (gris, défaut)
- **Messagerie** (bleu) — nouveau : le candidat a été contacté mais n'a pas
  encore répondu (message vocal, email sans réponse, LinkedIn DM en attente…).
- **Disponible** (vert)
- **Non disponible** (rouge)

Le statut se persiste comme avant dans `candidats_json` (clé `cand_status`,
valeur `'msg'` pour le nouveau statut), ne modifie pas l'export Excel et est
purement informatif. Légende et CSS (`besoins.css`) mis à jour pour la
nouvelle couleur (`--info`).

## [32.31] — 2026-05-07 · Besoins · Téléphone + lien profil VSA/LinkedIn

Sur la fiche traitement d'un besoin, dans le bloc **Candidats positionnés**,
les cartes de candidats **non liés à une fiche** affichent désormais :

- **Téléphone** : nouveau champ avec bouton « Appeler » (lien `tel:`) qui
  apparaît dès qu'un numéro est saisi. Pratique pour appeler directement
  un candidat sourcé sans avoir à créer sa fiche.
- **Lien profil** : le placeholder précise que l'on peut coller un lien
  **VSA ou LinkedIn** (pas seulement LinkedIn). Le bouton « Ouvrir » reste
  inchangé.

Les deux champs sont persistés dans `candidats_json` (clés `phone` et
`profile_url`) et masqués automatiquement quand la ligne est liée à une
fiche candidat (les coordonnées sont alors disponibles via la fiche).

## [32.30] — 2026-05-07 · Fiche besoin : section « Préparation avant la RT »

### Ajout — bloc de notes libres en bas de la fiche besoin

- Nouvelle section **« Préparation avant la RT »** affichée tout en bas de
  la fiche besoin (sous « Candidats positionnés ») : grande zone de texte
  modifiable, persistée comme les autres champs (auto-save + Ctrl+S).
  Pratique pour préparer la RT (revue technique) — points à aborder,
  contexte client, questions à poser…
- Schéma DB : nouvelle colonne `besoins.preparation_rt TEXT` (CREATE TABLE
  + migration auto-appliquée au démarrage via `_v30_apply_migrations`, sur
  la DB principale et chaque DB per-user).
- `routes/besoins.py` : champ ajouté à `_payload_clean` (allowed) et
  inséré dans le `INSERT` de `api_create_besoin`.
- `templates/v30/besoin_detail.html` + `static/js/v30/besoin_detail.js` :
  textarea `[data-v30-besoin-field="preparation_rt"]`, alimenté via
  `hydrate()` et collecté dans `collectPayload()`.
- `static/css/v30/besoins.css` : `.v30-besoin-prep-rt { min-height:220px;
  resize:vertical }`.

## [32.29] — 2026-05-07 · Carte géographique des prospects et entreprises

### Nouvelle page `/v30/carte`

Page Outils dédiée à la cartographie des entités commerciales :

- **Carte Leaflet + tuiles OpenStreetMap** (gratuit, pas de clé API).
- **Deux couches togglables** : Entreprises (pin bleu) et Prospects (pin coloré
  selon pertinence P1→P5). Les deux clusters sont gérés séparément
  (`Leaflet.markercluster`) pour éviter le mélange visuel.
- **Heatmap densité** activable (`Leaflet.heat`) — gradient bleu/vert/orange/
  rouge/violet selon la concentration. Chaque prospect pondéré par sa
  pertinence.
- **Filtres dynamiques** : recherche full-text (nom/ville/fonction/entreprise/
  industrie/tags), statut prospect, pertinence min., tag contient. Tous
  appliqués côté client pour réactivité instantanée.
- **Popups riches** : type d'entité, nom, sous-titre (industrie/fonction +
  ville), adresse, pills statut/pertinence, boutons Fiche/Email/Appel/OSM.
- **Bouton « Ma position »** : géolocalisation navigateur, marqueur bleu +
  cercle de précision.
- **Auto-fit initial** sur l'ensemble des marqueurs visibles.

### Geocoding via Nominatim (OSM)

- Helper backend `_geocode()` avec User-Agent personnalisé et **throttle global
  1 req/s** (lock + sleep) conforme à la fair-use policy OSM.
- Les coordonnées sont **mises en cache en base** (`latitude`, `longitude`,
  `geocoded_at`) — aucune requête Nominatim si l'entité est déjà géocodée.
- **Géocodage en masse** : modale dédiée (`POST` non, **GET SSE** pour passer
  à travers les buffers), barre de progression, log temps réel par entité,
  résumé final (ok / ignorés / erreurs). Limite ajustable (50/100/200/500/1000),
  cible (entreprises / prospects / les deux).

### Schéma DB

Nouvelles colonnes (migration auto via `_v30_apply_migrations`) :

- `companies.latitude` (REAL), `companies.longitude` (REAL),
  `companies.geocoded_at` (TEXT)
- `prospects.address`, `prospects.city`, `prospects.country` (TEXT) — pour
  les prospects ayant une adresse différente de leur entreprise rattachée
- `prospects.latitude`, `prospects.longitude`, `prospects.geocoded_at`

Lorsqu'un prospect n'a pas d'adresse propre, le geocoder utilise
automatiquement celle de son entreprise (LEFT JOIN).

### Routes API

- `GET    /api/map/markers`        — JSON entreprises + prospects géocodés
- `GET    /api/map/stats`          — compteurs (geocodés / avec adresse / total)
- `POST   /api/map/geocode`        — géocode une entité unique (JSON)
- `GET    /api/map/geocode/bulk`   — SSE stream de geocoding en masse

### Sidebar

Nouvelle entrée **Carte** sous Outils (entre Push et Transcription), nouvelle
icône `map` dans le macro `_partials/v30/icon.html`.

### CSP

`style-src` et `img-src` étendus pour autoriser `cdn.jsdelivr.net` (Leaflet
CSS) et `*.tile.openstreetmap.org` (tuiles OSM). `script-src` jsdelivr était
déjà ouvert. Aucune dépendance Python ajoutée — seulement la stdlib
(`urllib.request`).

### Fichiers ajoutés

- `routes/map.py` (~360 lignes : blueprint + helper Nominatim throttlé)
- `templates/v30/carte.html`
- `static/js/v30/carte.js` (~360 lignes)
- `static/css/v30/carte.css`

### Fichiers modifiés

- `app.py` : `_v30_apply_migrations` (colonnes geo), import + register
  `map_bp`, CSP étendue
- `config.py` : `APP_VERSION = "32.29"`
- `templates/_partials/v30/sidebar.html` : entrée Carte sous Outils
- `templates/_partials/v30/icon.html` : icône `map`

## [32.28] — 2026-05-07 · Stats / Tableau de bord : refonte UX v30

### Refonte page Stats — alignement design system v30

La page `/v30/stats` (panel **Tableau de bord**) est refondue pour s'aligner
sur le design system v30 (page-header, kpi--hero serif, bento, performance
card avec sparklines, chips colorés). Le panel **Rapport** reste inchangé.

#### Nouveau layout
- **Page header v30** : eyebrow « Performance » · titre serif italique
  « Stats » · sous-titre dynamique (« X RDV · Y appels · taux Z% · période »).
- **Toolbar unifiée** : navigation mensuelle + Aujourd'hui + Plage… +
  segmented 7j/30j/90j/Tout + boutons Export JSON/CSV (déplacés de la barre
  séparée vers la toolbar).
- **Hero** : 4 grosses tuiles `kpi--hero` serif italique avec accent
  coloré à gauche (RDV vert · Conversion accent · Appels orange · Push
  bleu) et **sparkline** intégrée en bas-droite de chaque tuile.
- **Performance card** (12 dernières semaines) : 4 chips KPI avec
  sparklines miniatures, chart Chart.js stacked (Appels + Notes + Push),
  3 insights (Meilleure semaine, Semaines actives, Conversion), breakdown
  bars horizontales par type d'action.
- **8 KPI secondaires** : Prospects total, Entreprises, À rappeler,
  Relances en retard (alert), Notes d'appel, Dûs aujourd'hui, **Activité
  ⌀/jour (NEW)**, **Pertinence ⌀ (NEW)**.
- **Bento Pipeline + Urgence** :
  - **Pipeline · Statuts** : barres horizontales colorées par statut
    (palette RDV vert / Appelé bleu / À rappeler orange / etc.).
  - **Urgence · Prochaines actions (NEW)** : 4 buckets (En retard /
    Aujourd'hui / Cette semaine / Plus tard) avec dot couleur + barre
    de progression.
- **Bento Top entreprises + Top consultants pushés (NEW)** :
  - Table « Entreprises chaudes » conservée, restylée (header bg, hover row).
  - Liste « Top consultants pushés » : rang serif + nom + barre + count.
- **Charts secondaires** : RDV / 6 derniers mois (line) + Pertinence
  (doughnut). Les anciens 10 charts redondants sont supprimés.

#### Données nouvelles consommées
- `topPushedConsultants` (déjà exposé par `/api/stats/charts`, jusqu'ici
  inutilisé côté front).
- `urgencyDistribution` (idem — exposé mais non rendu auparavant).
- Calcul **Activité ⌀ / jour** = (calls + push + notes) / nb jours période.
- Calcul **Pertinence ⌀** = moyenne pondérée de `pertinenceDistribution`.
- Calcul **Taux conversion** = RDV / Prospects total (avec sparkline mensuelle).

#### Fichiers modifiés
- `templates/v30/stats.html` : refonte complète du panel **Tableau de
  bord**. Le panel **Rapport** est intact.
- `static/css/v30/stats.css` : refonte complète (hero serif italique,
  bento bento-2, pipeline/urgency rows, toplist, kpi-alert, modal v30).
- `static/js/v30/stats.js` : refonte complète. Fetch parallèle de
  `/api/stats` + `/api/stats/charts` + `/api/stats/data`. Render synchrone
  sans Chart.js (KPI, pipeline, urgence, toplist) puis Chart.js asynchrone
  (perf chart, RDV chart, pertinence chart). Fonctions legacy `repLoad*`
  supprimées (le panel Rapport est piloté par `rapport.js`).

## [32.27] — 2026-05-07 · Page Candidats : badge "DC disponible" dans toutes les vues

### Visibilité du Dossier de Compétences

- Page Candidats : un badge **DC** apparaît désormais sur chaque candidat dans
  les trois vues (Pipeline kanban, Grille cartes, Liste tableau). Vert plein
  avec libellé "DC" quand un dossier de compétences existe ; gris pointillé
  quand aucun DC n'est encore rattaché. Le badge est cliquable et ouvre la
  fiche candidat sur l'ancre `#dc`.
- Vue Liste : nouvelle colonne **DC** (64 px desktop, 48 px sous 600 px) entre
  *Compétences* et *Contact*.
- Backend `/api/candidates` : le flag `has_dc` prend maintenant en compte
  trois sources : champ legacy `dossier_competence_pdf`, fichiers PDF dans
  `data/dossiers_candidats/{uid}/{cid}/` **et** entrées dans la table
  `dc_generations` (DC produits via le générateur). Les DC générés via le
  générateur sont désormais détectés correctement.

### Fichiers modifiés

- `routes/candidates.py` : helper `_candidate_has_dc()` + une seule requête
  batch sur `dc_generations` par appel API (pas de N+1).
- `static/js/v30/sourcing.js` : helper `renderDcBadge()` + insertion dans
  `renderCard`, `renderGrid`, `renderList` (header + ligne).
- `static/css/v30/sourcing.css` : classes `.v30-sc-dc`, `.v30-sc-dc--ok`,
  `.v30-sc-dc--no` et largeur de la colonne `--dc`.

## [32.26] — 2026-05-07 · Fiche candidat : fix bouton Éditer (toutes sections)

### Fix — modales d'édition invisibles sur la fiche candidat

- Les boutons « Éditer » des sections **Informations / Entretien / Évaluation /
  Références / Avis perso** ainsi que la modale « Enrichir via DC » ouvraient
  bien la modale (`hidden` retiré), mais celle-ci restait invisible et non
  cliquable. Cause : le composant `.v30-modal-bd` a `opacity: 0;
  pointer-events: none` par défaut et requiert la classe `.is-open` pour
  passer à `opacity: 1; pointer-events: auto`. Le code ne basculait que
  l'attribut `hidden`, comme le faisait déjà la quasi-totalité des autres
  modales v30 — bug introduit en 32.x avec l'ajout de l'édition de fiche.
- `static/js/v30/candidate_detail.js` : `openSectionModal` /
  `openDcEnrichModal` ajoutent désormais `is-open` (via
  `requestAnimationFrame` pour préserver la transition CSS) ;
  `closeSectionModal` / `closeDcEnrichModal` retirent la classe puis
  rebasculent `hidden` après 160 ms (durée de la transition).

## [32.25] — 2026-05-06 · Multi-user : fix HTTP 500 sur création prospect/entreprise + fix modale stats

### Fix critique — création entité avec DB partagée

- `POST /api/companies/create` et `POST /api/prospects/create` retournaient
  **HTTP 500 (UNIQUE constraint failed: companies.id / prospects.id)** dès
  qu'un nouvel utilisateur (sans per-user DB peuplée) créait sa première
  entité. Cause : la requête `SELECT MAX(id) WHERE owner_id=?` calcule le
  prochain ID dans le scope de l'utilisateur uniquement, mais `id` est un
  PRIMARY KEY global de la table — sur la DB principale partagée, l'INSERT
  collisionnait avec les IDs d'autres utilisateurs.
- 3 occurrences corrigées : la requête utilise maintenant `MAX(id)` global
  (sans filtre `owner_id`), ce qui garantit l'unicité dans tous les modes
  (per-user DB ou DB partagée).

### Fix UI — modale Stats range visible au chargement

- `static/css/v30/stats.css` : la classe `.stats-range-modal` forçait
  `display: flex` sans condition, masquant le `hidden` HTML attribute. La
  modale "Plage personnalisée" apparaissait donc au chargement de la page
  Stats. Ajout d'une règle `.stats-range-modal[hidden] { display: none; }`.

## [32.24] — 2026-05-05 · Page Candidats : fix HTTP 500 + refonte UX

### Fix critique — bulk-update statut

- `POST /api/candidates/bulk-update` retournait systématiquement **HTTP 500**
  (Internal Server Error) à chaque modification de statut depuis la page
  Candidats — drag & drop kanban et action bulk inclus. Cause : un appel à
  une fonction inexistante `_get_user_db()` (renommée `_user_db_path()` lors
  d'une refonte antérieure). L'erreur cassait le changement de statut sur la
  page Candidats.
- L'endpoint utilise maintenant le helper standard `_conn()` (per-user DB
  automatique) et synchronise `is_archived` avec le nouveau statut, comme le
  fait déjà `/api/candidates/status`. Les goal events sont également loggés
  pour chaque candidat impacté.

### Page Candidats — refonte UX

- **Pastille de statut cliquable** sur chaque carte (Pipeline et Grille). Un
  clic ouvre un popover avec la liste des 5 statuts (EC1, OKSI, Top Profils,
  RT, En mission) — utile sur mobile et en vue Grille où le drag & drop
  n'existe pas.
- **Menu kebab (⋯)** sur chaque carte : ouvrir la fiche, changer de statut,
  ajouter à la sélection, supprimer.
- **Empty state actionnable** : les colonnes vides du kanban affichent un
  bouton « Ajouter dans <statut> » qui pré-remplit le statut dans la modale
  d'ajout. Bouton « + » discret sur l'en-tête de chaque colonne pour ajouter
  un candidat directement dans cette colonne.
- **Accent couleur par statut** : barre verticale colorée à gauche de chaque
  carte selon son statut, hover et focus harmonisés sur la même couleur.
- **Icônes de contact** (mail / téléphone / LinkedIn) en bas de carte —
  cliquables sans ouvrir la fiche, parfait pour passer un appel ou écrire un
  mail rapide.
- **Tout sélectionner** ajouté à la barre bulk — sélectionne tous les
  candidats actuellement filtrés.
- **Raccourcis clavier** : `/` focus la recherche, `Échap` efface la
  sélection.
- Vue Grille refondue : même apparence que les cartes Pipeline (cohérence
  visuelle), avec pastille de statut et icônes de contact.

## [32.23] — 2026-05-05 · Lignes d'activité cliquables (fiche prospect)

Sur la fiche prospect, les lignes de l'aperçu **Activité** (et de la timeline
complète) deviennent des raccourcis directs vers le détail correspondant :

- **Compte-rendu IA / CR** → ouvre directement la **vue présentation** du CR
  (modale lecture seule introduite en 32.22), plus besoin de déplier la ligne.
- **Push / Push email / Push LinkedIn** → bascule sur l'onglet **Push** et met
  en surbrillance la ligne correspondante (scroll auto + halo accent 2 s).
- **Notes**, **changements de statut**, **fichiers**, **événements IA**, etc.
  conservent le comportement *expand/collapse* existant.

Implémentation : interception du click dans `bindEventClicks()` avant la
bascule expand. Les pushs sont identifiés par leur `id` via le nouvel attribut
`data-push-id` ajouté dans `renderPushList()`.

## [32.22] — 2026-05-05 · Vue présentation lecture seule pour les comptes-rendus

### Fiche prospect — onglet CR

- Cliquer sur un compte-rendu ouvre désormais une **vue présentation** en
  lecture seule, mise en forme avec sections distinctes (Synthèse, Prochaine
  action, Infos clés, Tâches, Documents, Notes brutes repliables, Grille de
  qualification). Plus de saisie directe par mégarde.
- Bouton **Modifier** dans le footer de la vue présentation pour ouvrir la
  modale d'édition existante (le flux d'édition n'est pas modifié).
- Les sections vides ne s'affichent pas — la vue est compacte si le CR est
  léger, riche s'il est rempli.
- Tâches : statut visuel (cochée / à faire), priorité colorée, échéance.

### Fichiers modifiés

- [templates/v30/prospect_detail.html](templates/v30/prospect_detail.html) —
  nouvelle modale `data-v30-fp-modal="cr-view"`.
- [static/js/v30/prospect_detail_ui.js](static/js/v30/prospect_detail_ui.js) —
  `openCRViewModal()` + `renderCRView()`, redirection du clic carte CR vers la
  vue, handler du bouton Modifier.
- [static/css/v30/prospect_detail.css](static/css/v30/prospect_detail.css) —
  bloc `.v30-cr-view__*`.

## [32.21] — 2026-05-05 · Refonte UX candidats positionnés (Traitement Besoin)

### Cartes dépliables au lieu d'un tableau plat

L'ancienne table 11 colonnes (`candidat`, `commentaires`, `dispo`, `appel`,
`dt`, `rdv1`, `rdv2`, `note`, `envoi_dt`, `rt`, fiche) avait des cellules
trop étroites pour prendre des notes utiles. Chaque candidat est maintenant
une **carte dépliable** (`v30-cand-card`) avec :

- **Header compact toujours visible** : pastille de statut, nom du candidat,
  preview (Dispo / RDV / Rôle), boutons VSA + fiche + lier + supprimer.
- **Body déroulant** au clic (ou via bouton chevron) : 2 textareas larges
  pour `Origine / Commentaires` et `Note interne`, plus une grille de
  tracking 4 colonnes (Dispo, Appel, DT, RDV1, RDV2, Envoi DT, RT) et
  un bandeau d'infos issues de la fiche liée (rôle, lieu, séniorité, tech).

### Code couleur de disponibilité

Nouveau champ libre `cand_status` par ligne (3 valeurs cycliques au clic
sur la pastille) :

- `''` (par défaut) → **Pas contacté** · gris ;
- `dispo` → **Disponible** · vert ;
- `nope` → **Non disponible** · rouge.

Le bandeau coloré gauche de la carte reflète le statut. Légende affichée
en haut de la section.

### Lien VSA

Backend (`routes/besoins.py`) : nouvelle helper `_enrich_candidats(uid,
candidats)` qui JOIN la table `candidates` pour ramener `vsa_url`, `role`,
`location`, `linkedin`, `tech`, `seniority`, `email`, `phone` sous la clé
`_ref` (lecture seule, strippée avant persistance). Si la fiche liée a un
`vsa_url`, le bouton **VSA** apparaît dans la carte (header + body).

### Compatibilité

- Le JSON candidats sur disque reste compatible : seules les clés
  `cand_status` (nouveau) et `_ref` (transient, strippé serveur côté PUT)
  sont ajoutées. L'export Excel ignore les nouveautés et reste identique.
- Aucune migration SQL nécessaire — `cand_status` vit dans le JSON, pas
  dans une colonne dédiée.

## [32.20] — 2026-05-05 · Titres éditables sur notes manuelles et fichiers (fiche prospect)

### Notes manuelles

- Le formulaire **+ Note** (Activité) accueille un champ **Titre (optionnel)**
  avant le contenu. Vide → titre par défaut « Note ».
- Le titre s'affiche dans la timeline et reste éditable depuis la modale
  d'édition d'une note (clic sur la note → édition inline).
- Backend `/api/prospect/timeline/update` accepte désormais `title` en plus
  de `content` pour les events DB (`source = "event"`).

### Fichiers / pièces jointes

- Nouvelle colonne `prospect_attachments.title` (migration auto). Si vide,
  fallback sur `original_name` comme avant.
- Le panneau d'expansion d'une pièce jointe affiche un input **Titre**
  (placeholder = nom de fichier original). Le nom de fichier réel reste
  visible juste en dessous, en grisé.
- Sauvegarde sur blur via `PATCH /api/prospect/attachments/<id>` (clé
  `title`).

## [32.18.1] — 2026-05-04 · Bulk edit étendu + valeurs par défaut à l'import

### « Modifier en masse » : 6 nouveaux champs

La modale **Prospects > sélection > Modifier** ne permettait que de changer
`Statut`, `Pertinence` ou `Fonction`. Ajout de :

- **Entreprise** — autocomplete avec `CompanyPicker` (recherche dans la
  liste existante + création à la volée via la modale standard).
- **Téléphone**, **Email**, **LinkedIn** — input texte (vide autorisé pour
  effacer le champ).
- **Notes** — textarea multilignes.
- **Date de relance** — input `type="date"`.

Le backend `/api/prospects/bulk-edit` acceptait déjà ces champs depuis
v31.3+ (whitelist `ALLOWED_FIELDS`), seule l'UI manquait. Pour l'entreprise,
la sélection envoie `company_id` (entier validé côté backend contre les
entreprises de l'utilisateur).

### Import : « Compléter les champs manquants pour tous les prospects »

Nouvelle section dépliable dans l'étape de mapping de l'import (Excel /
CSV / Collage texte / Collage IA). Permet de saisir une fois des
**valeurs par défaut** appliquées à tous les prospects importés :

- Entreprise (autocomplete CompanyPicker)
- Fonction
- Statut (liste `STATUS_OPTIONS`)
- Pertinence (1-5)
- Tags (séparés par virgules — fusionnés sans doublon avec les tags de la ligne)

Les défauts **n'écrasent jamais** une valeur déjà présente dans la ligne
importée. Cas d'usage typique : copier-coller une liste LinkedIn (noms +
URLs) et appliquer la même entreprise / le même statut / les mêmes tags
à tout le batch.

### Fichiers touchés

- `templates/v30/prospects.html` : 6 nouvelles options dans le `<select>`
  bulk edit, nouvelle section `<details>` « Compléter les champs manquants ».
- `static/js/v30/prospects.js` : `renderBulkEditValueInput` gère
  `company_id`/`notes`/`nextFollowUp` ; `applyBulkEdit` lit la sélection
  picker ; nouvelles fonctions `setupImportDefaults` / `readImportDefaults` /
  `applyImportDefaults` ; reset des défauts dans `resetImportModal`.

## [32.18.0] — 2026-05-04 · Section Traitement Besoin (CRUD + export Excel)

Nouvelle section **« Besoins »** dans la sidebar (sous Outils, après Transcription).
Permet de gérer des fiches « traitement besoin » client : header (client,
contact, localisation, dates, durée), description (descriptif, compétences,
connaissances, expérience, profil), suivi candidats, et **export Excel**
strictement au format du modèle `sample/03 traitement besoin.xlsx`
(2 feuilles « recto » paysage et « recto verso » portrait, fusions/bordures/
largeurs/hauteurs identiques, print area, marges).

### Pages

- `GET /v30/besoins` — liste filtrable par statut
- `GET /v30/besoins/<id>` — fiche détail éditable

### API

- `POST /api/besoins` — créer (préfill auto si `prospect_id` fourni)
- `GET  /api/besoins?statut=&prospect_id=` — lister
- `GET  /api/besoins/<id>` — détail
- `PUT  /api/besoins/<id>` — mettre à jour
- `DELETE /api/besoins/<id>` — soft delete
- `GET  /api/besoins/<id>/export.xlsx?format=recto|verso|both` — export Excel

### Création depuis une fiche prospect

Nouveau bouton **« Nouveau besoin »** dans le header de la fiche prospect
(`/v30/prospect/<id>`) à côté de « Résumer ». Crée immédiatement un besoin
pré-rempli (client = entreprise, contact = nom prospect, localisation = ville/pays
de l'entreprise) et redirige vers la fiche détail. Liaison `prospect_id`
nullable, pas bloquante.

### Schéma DB

Nouvelle table `besoins` (multi-tenant via `owner_id`, soft delete via `deleted_at`).
Migration ajoutée à `_v30_schema_sql` : propagée aux DB principales et aux
DB user-spécifiques au prochain démarrage.

### Fichiers ajoutés

- `routes/besoins.py` (~500 lignes : blueprint + export Excel)
- `templates/v30/besoins.html`, `templates/v30/besoin_detail.html`
- `static/js/v30/besoins.js`, `static/js/v30/besoin_detail.js`
- `static/css/v30/besoins.css`

### Fichiers modifiés

- `app.py` : table `besoins` dans `init_db` + `_v30_schema_sql`,
  enregistrement du blueprint, `APP_VERSION = "32.18.0"`
- `templates/_partials/v30/sidebar.html` : entrée Besoins sous Outils
- `templates/v30/prospect_detail.html` : bouton « Nouveau besoin »
- `static/js/v30/prospect_detail_ui.js` : binding du bouton

## [32.17.1] — 2026-05-04 · Fix import en masse de prospects (sans entreprise / sans en-têtes)

L'import en masse de prospects depuis l'onglet **« Collage texte »** échouait
avec « 0 ajouté(s), N erreur(s) » quand la liste collée ne contenait que des
noms + URLs LinkedIn (cas d'usage le plus fréquent : copier-coller depuis
LinkedIn Sales Navigator ou un export sans en-têtes).

### Causes

1. **Backend** : `POST /api/prospects/create` laissait `company_id=0` quand
   aucune entreprise n'était fournie, ce qui violait la contrainte
   `FOREIGN KEY(company_id) REFERENCES companies(id)` (FK enforcée par
   `PRAGMA foreign_keys = ON` dans `_conn()`). Toutes les insertions sans
   entreprise échouaient avec `IntegrityError: FOREIGN KEY constraint failed`.
2. **Frontend** : `parseDelimitedText()` consommait systématiquement la
   première ligne collée comme en-têtes. Quand l'utilisateur collait
   directement des données (sans ligne d'en-têtes), le premier prospect
   était perdu.

### Correctifs

- **Backend** ([app.py:12700-12780](app.py)) : `api_prospect_create` désactive
  temporairement les FK (`PRAGMA foreign_keys = OFF`) quand `company_id=0`,
  comme le fait déjà `replace_all()` pour les imports en masse. Transaction
  manuelle (`conn.commit()` / `conn.rollback()`) avec `try/finally` qui
  réactive les FK et ferme la connexion proprement.
- **Frontend** ([static/js/v30/prospects.js:2000](static/js/v30/prospects.js)) :
  `parseDelimitedText()` détecte les collages sans en-têtes (aucune cellule
  ne matche un nom de champ connu ET au moins une cellule ressemble à de la
  donnée — URL, email, téléphone). Dans ce cas, des en-têtes synthétiques
  (`Colonne 1`, `Colonne 2`, …) sont générés et toutes les lignes sont
  conservées comme données. Le mapping est ensuite deviné par `guessField()`
  via les valeurs réelles de chaque colonne (fallback déjà présent).
- **UI** : message d'instruction de la modale d'import mis à jour pour
  préciser que les en-têtes sont optionnels.

## [32.17.0] — 2026-04-30 · Import résumé PDF (Summary AI) sur la page Transcription

Nouveau bouton **« Importer résumé PDF »** dans le header de
`/v30/transcription`, à côté de « Enregistrer » et « Importer un fichier ».
Permet d'importer un PDF de compte-rendu déjà mis au propre par un service
externe (Summary AI, Otter, Notion AI…) et d'en déduire automatiquement les
champs CRM candidat OU prospect.

### Flux

1. L'utilisateur uploade un PDF + titre dans la nouvelle modale.
2. Backend extrait le texte (`pdfminer` puis fallback `pypdf`).
3. Le texte est utilisé à la fois comme `transcript_text` et comme
   `narrative_markdown` — pas de Whisper ni de diarisation, on saute
   directement à la 3ᵉ passe d'extraction CRM (`_extract_crm_from_markdown`).
4. La transcription est insérée avec `status='done'`, marquée
   `analysis._source = 'pdf_summary'` pour distinction UI.
5. L'utilisateur arrive sur la page détail standard, où les boutons
   « Créer fiche candidat » et « Créer fiche prospect » apparaissent
   selon que `candidate_info` ou `prospect_info` est rempli — flux
   parfaitement identique à celui d'un upload audio classique.

### Fichiers touchés

- `routes/transcription.py` : nouveau endpoint
  `POST /api/transcription/upload-summary-pdf` (~120 lignes).
- `templates/v30/transcription.html` : bouton header + modale upload PDF.
- `static/js/v30/transcription.js` : handlers modale +
  badge « 📄 Résumé PDF » dans la liste.
- `static/js/v30/transcription_detail.js` : masque le widget audio
  pour les imports PDF (pas d'audio source).
- `static/css/v30/transcription.css` : style du badge `is-source-pdf`.

### Vérification du flux candidat / prospect existant

Les boutons **« + Créer fiche candidat »** et **« + Créer fiche prospect »**
de la page `/v30/transcription/<id>` (déjà en place depuis v32.11)
fonctionnent sans modification : ils lisent `analysis.candidate_info` /
`analysis.prospect_info` qui sont désormais remplis aussi pour les imports
PDF.

## [32.16.2] — 2026-04-30 · Unification du bouton IA (liste + focus split panel) sur le flux table comparative

Avant cette version, le bouton « Enrichir via IA » (icône diamant dans la
colonne actions de la liste prospects ET dans le focus split panel) ouvrait
une **ancienne modale simplifiée** (`prospects.js:openAiModal`) avec :
- prompt non contextualisé (pas de valeurs actuelles, pas de tags suggérés)
- réponse IA brute affichée en texte, sans table comparative
- apply qui écrasait silencieusement les valeurs sans choix utilisateur

Désormais, le bouton ouvre directement la fiche détail
(`/v30/prospect/<id>?ia=scrap`) dans un nouvel onglet, avec
auto-déclenchement de la modale d'enrichissement complète (table comparative
avant / après / fusion / saisie manuelle, tags suggérés, contexte collable,
streaming SSE) — même principe que le bouton IA de Mode Prosp ajouté en
v32.16.

### Code supprimé (~110 lignes)

- `static/js/v30/prospects.js` : `AI_CTX`, `buildAiPrompt`, `extractJsonMaybe`,
  `openAiModal`, `runAi`, `applyAi` (et leurs handlers d'événement)
- `templates/v30/prospects.html` : modale `data-v30-pp-modal="ai"` complète
  avec ses sélecteurs `data-v30-ai-*`

### Code conservé

- Le bouton lui-même (`data-v30-ai="<id>"`) reste tel quel dans le HTML/JS
  pour préserver le visuel et la position dans les actions de chaque ligne.
- Le handler `bindAi()` est réduit à un simple `window.open(...)` vers la
  fiche détail.

## [32.16.1] — 2026-04-30 · 4ᵉ option « Saisie manuelle » dans la table comparative IA

Ajout d'une 4ᵉ ligne d'action **« Saisie manuelle »** sur chaque champ du
tableau comparatif d'enrichissement IA. L'utilisateur peut désormais saisir
sa propre valeur si ni le « avant », ni le « après », ni la fusion ne
conviennent — utile pour corriger une suggestion IA partielle ou ajouter
manuellement une donnée que l'IA n'a pas trouvée.

### Comportement

- **Input pré-rempli** intelligemment :
  - **text** (fonction, email, tel, linkedin) : valeur après si non-vide,
    sinon valeur avant
  - **tags** : la fusion (union avant + après), en CSV
  - **notes** : la fusion (notes existantes + complément + accroches)
- **Auto-sélection du radio** : dès que l'utilisateur tape dans l'input, le
  radio « Saisie manuelle » est coché automatiquement (handler global sur
  `input` event ciblant `[data-manual-input]`).
- **Parsing CSV pour les tags** avec dédup case-insensitive en préservant
  l'ordre saisi (`"A, a, B" → ["A", "B"]`).
- **Apply** : `computeRowFinal(row, "manual", manualValue)` traite la valeur
  selon le type de champ. Pour un texte multiligne (notes), c'est un
  remplacement complet ; pour les tags, le CSV devient un tableau
  `JSON.stringify`-é.

### CSS

- `.v30-fp-ai-cmp__manual-wrap` : marge top + indentation 22px pour aligner
  l'input sous les radios.
- `.v30-fp-ai-cmp__manual-input` : input/textarea full-width dans la colonne
  actions, focus accent. `textarea` minimum 60px de haut, redimensionnable
  verticalement.

### Tests

- 8 tests unitaires `computeRowFinal(action="manual")` couvrant les 3 types
  de champs (text, tags, notes) avec valeurs identiques au before, valeurs
  vides, dédup case-insensitive sur tags.

## [32.16] — 2026-04-30 · Table comparative avant/après pour l'enrichissement IA + bouton Mode Prosp

Suite immédiate à v32.15 : remplace le diff binaire (« coche pour appliquer »)
par une **table comparative complète avant/après** avec choix d'action par
champ, et ajoute la suggestion de **tags** par l'IA (clé pour le matching
prospect ↔ candidat). Bouton d'enrichissement ajouté sur les cards de
Mode Prosp.

### Table avant / après

- **Tous les champs enrichissables** affichés (fonction, email, téléphone,
  LinkedIn, tags, notes), même quand l'IA ne propose aucun changement (ligne
  marquée « identique » et actions désactivées).
- **3 actions par ligne** :
  - **Garder avant** — pas de changement
  - **Garder après** — remplacer par la suggestion IA
  - **Fusionner** — disponible uniquement pour `tags` (union case-insensitive)
    et `notes` (append du complément + bloc accroches en remplaçant tout bloc
    « Accroches IA : » existant)
- **Sélection par défaut** intelligente :
  - Identique → `before` (la ligne est grisée)
  - Avant vide + après non-vide → `after`
  - Avant non-vide + après vide → `before` (pas de suggestion)
  - Différent + mergeable → `merge`
  - Différent + non-mergeable → `after`
- **Aperçu de la fusion** affiché en plus des colonnes Avant/Après pour les
  champs mergeables — l'utilisateur voit le résultat exact avant d'appliquer.

### Tags suggérés par l'IA

- Nouveau champ `tags_suggeres` dans le schéma JSON ([static/js/v30/prospect_detail_ui.js](static/js/v30/prospect_detail_ui.js))
- Prompt explicite à l'IA pour générer 5-10 tags courts et réutilisables
  couvrant compétences techniques, technologies, méthodologies, secteurs et
  types de mission. La consigne précise que **plus de tags pertinents = mieux**
  pour le matching candidat.
- Fusion par **union case-insensitive** : `["Java", "python"]` ∪
  `["Python", "Java"]` = `["Java", "python"]` (premier rencontré gagne pour la
  casse).
- `validateScrapJson` accepte aussi la clé legacy `tags` en fallback.

### Fix latent : champ `tags` autorisé dans `bulk-edit`

- `ALLOWED_FIELDS` et `ALLOW_EMPTY` de `/api/prospects/bulk-edit`
  ([app.py:15081](app.py)) incluent désormais `tags`. L'inline tag-add de
  `prospect_detail_ui.js:160` (qui appelait `FP.saveField('tags', ...)`)
  appelait silencieusement un endpoint qui rejetait le champ — maintenant
  fonctionnel.

### Bouton IA sur Mode Prosp

- Bouton **« IA »** ajouté dans la barre de quick-actions de chaque card
  ([static/js/v30/mode_prosp.js:213](static/js/v30/mode_prosp.js)).
- Clic → ouvre `/v30/prospect/<id>?ia=scrap` dans un nouvel onglet, ce qui
  préserve la session Mode Prosp en cours.
- Nouveau handler `autoOpenIaFromUrl()` dans
  [prospect_detail_ui.js](static/js/v30/prospect_detail_ui.js) qui détecte
  `?ia=scrap|before|after` et ouvre la modale correspondante automatiquement,
  puis nettoie le param via `history.replaceState` pour qu'un rechargement ne
  redéclenche pas la modale.
- Style cohérent avec les autres quick-buttons (TEL/MAIL/IN), accent au survol.

### CSS

- Nouvelles classes `.v30-fp-ai-cmp__*` dans
  [static/css/v30/prospect_detail.css](static/css/v30/prospect_detail.css) :
  grille 3 colonnes (Champ | Valeurs | Action), header sticky, ligne grisée
  pour identique, pills numériques (« 5 → 8 tags »), tags affichés en chips
  avec teinte accent pour les nouveaux. Layout responsive (colonne unique
  sous 720px).

## [32.15] — 2026-04-30 · Refonte enrichissement IA des fiches prospect

Suite à un audit complet du flux **Scraping enrichissement** (onglet IA d'une
fiche prospect), refonte de bout en bout pour corriger les bugs identifiés et
améliorer la qualité des suggestions.

### Bugs corrigés

- **Double-row `notes` + `accroches` qui s'écrasaient mutuellement**
  ([static/js/v30/prospect_detail_ui.js](static/js/v30/prospect_detail_ui.js))
  Quand l'IA renvoyait à la fois `notes` (remplacement) ET `accroches` (append),
  deux lignes du diff visaient le champ `notes` ; appliquées séquentiellement,
  la seconde écrasait la première en repartant de la valeur d'origine. Désormais
  un **seul row `notes`** est généré, fusionnant le complément et les accroches.
- **Accroches dupliquées en cas de relance** : nouveau marqueur `Accroches IA :`
  + regex `ACCROCHES_RE` qui supprime tout bloc existant avant ré-injection.
- **Tavily recevait le prompt complet** (instructions JSON incluses) → résultats
  bruités. Nouveau paramètre `search_query` séparé : query courte focalisée
  (`"Prénom NOM Entreprise Site LinkedIn contact"`) côté frontend, propagée par
  `_call_ai_web` / `_stream_tavily_ollama_sse` ([app.py:195](app.py),
  [routes/ai.py:40](routes/ai.py)).

### Améliorations qualité

- **Prompt contextualisé** : `buildScrapPrompt` injecte désormais les valeurs
  actuelles de la fiche (nom, entreprise, site, fonction, email, tel, LinkedIn,
  notes tronquées, tags). L'IA est explicitement priée de ne proposer un
  changement que sur les champs vides ou clairement obsolètes — limite le bruit.
- **Schéma JSON refondu** : `entreprise` retiré (FK non éditable directement),
  `notes` renommé en `notes_complement` avec sémantique d'**ajout**, jamais de
  remplacement. Compat ascendante : `notes` accepté en fallback dans
  `validateScrapJson`.
- **Streaming SSE** : la modale bascule sur `/api/ollama/generate-stream` avec
  affichage progressif des tokens dans une zone dédiée (`v30-fp-scrap-stream`).
  Fallback automatique sur `/api/ollama/generate` si SSE indisponible.

### Nouvelle fonctionnalité

- **Textarea « Contexte collé »** dans la modale Scraping enrichissement
  ([templates/v30/prospect_detail.html:325](templates/v30/prospect_detail.html))
  permet de coller du contenu externe (extrait de profil LinkedIn, email reçu,
  article…) que Tavily ne peut pas atteindre pour des raisons RGPD. Le contenu
  collé est injecté dans le prompt comme **source prioritaire**. Limité à 8000
  caractères pour rester dans la fenêtre de contexte.

### Robustesse & traçabilité

- **Reporting per-field** dans `applyScrap` : succès / échecs comptabilisés
  séparément, toast détaillé indiquant quels champs ont été appliqués vs
  échoués — plus de partial-update silencieux.
- **`/api/ia-enrichment-log` désormais appelé** depuis `applyScrap`, créant un
  event `ia_enrichment` dans la timeline avec la liste des champs modifiés.
  La timeline est rechargée automatiquement.
- **Validation de schéma** : `validateScrapJson` détecte les clés inconnues,
  vérifie que `accroches` est bien un tableau, et restitue un warning utilisateur
  via toast. Les clés inconnues sont ignorées sans bloquer l'enrichissement.
- **Persistance du prompt utilisateur** : si l'utilisateur édite le prompt
  par défaut, sa version personnalisée est sauvegardée en `sessionStorage`
  (`prospup_scrap_prompt_template_v1`) et restaurée à la prochaine ouverture.
  Bouton « Réinitialiser » pour revenir au prompt généré.

### Notes implémentation

- LinkedIn auto-fetch non implémenté (impossible : `window.open()` ouvre l'URL
  mais same-origin policy empêche de lire le DOM ; un scraping serveur déclenche
  la détection anti-bot LinkedIn et viole les ToS). La textarea de paste est
  l'approche standard des CRM B2B sérieux.

## [32.13.1] — 2026-04-29 · Audit étendu (participants/actions) + badge liste + focus prospect robuste

Suite à un audit visuel complet (preview navigateur sur les 2 transcriptions
existantes, mobile + desktop, tous les boutons) qui a révélé des incohérences
non couvertes par v32.13 :

- **Bug `participants[].guessed_name = "Arthur Voineau"`** alors que le
  candidat est Alex Drouet. La v32.13 ne corrigeait que `candidate_info`
  mais pas `participants`/`action_items`. Audit étendu pour couvrir ces
  champs aussi (règles 4 et 5 dans `audit_crm_consistency`), plus une
  règle 6 qui détecte la divergence candidate_info vs participants.
- **Bug statut mission `proposee` sans accent** affiché « à creuser »
  par le `<select>` HTML (option `proposée` avec accent → mismatch).
  Correction des données existantes en DB.
- **Bug audit trop strict** : un participant « Antoine Binet » était
  signalé absent alors que « Antoine » apparaissait dans le transcript.
  Nouveau matcher `_name_present(full_name)` qui accepte si AU MOINS
  UN MOT (≥4 chars) du nom apparaît dans le haystack — limite les faux
  positifs sur diarisation partielle.
- **Bug focus prospect non visible après loadProspects re-render**
  ([static/js/v30/prospects.js:2674](static/js/v30/prospects.js))
  La classe `is-focused` était ajoutée à un `<tr>` qui se faisait
  ensuite remplacer par le re-render async. Solution : `MutationObserver`
  qui ré-applique la classe pendant la fenêtre de visibilité (4 s),
  plus retry tick toutes les 200 ms.
- **Badge cohérence sur les cards de liste**
  ([routes/transcription.py:393](routes/transcription.py),
  [static/js/v30/transcription.js:86](static/js/v30/transcription.js))
  L'endpoint `/api/transcription` retourne maintenant `consistency` par
  item, et la card affiche un pill « ✓ cohérent » (vert) ou
  « ⚠ N à vérifier » (orange) avec tooltip listant les warnings.
  Permet à l'utilisateur de repérer en un coup d'œil les transcriptions
  problématiques sans ouvrir chaque fiche.
- **Correction profonde des données #1 et #2** :
  - #1 : `participants[2]` Arthur Voineau → Alex Drouet, `action_items[0]`
    assignee aussi corrigé, statuts mission `proposee` → `proposée` avec
    accent, accents restaurés sur tous les champs candidate_info.
  - #2 : accents restaurés (« Ingénieur logiciel », « Développement
    aéronautique », « équipe », « Après », « période d'essai »).

**Vérification visuelle E2E complète** validée :
- Liste : badge cohérence visible sur chaque card (✓ vert / ⚠ orange).
- Détail #1 : badge ✓ cohérent (Pauline n'apparaissant pas dans transcript
  est légitimement signalée — diarisation faible).
- Détail #2 : badge ✓ cohérent.
- Préflight : boutons HF (Accepter community-1, Re-vérifier) + 4 lignes
  de check fonctionnels.
- Mobile (375×812) : section CRM en colonne unique, bandeau audit lisible,
  pas d'overflow horizontal, bottom nav OK.
- /v30/prospects?focus=3 : ligne Claire D'Agostino highlightée pulse
  violette, scroll automatique, URL nettoyée.
- Save/Reset : transitions état OK (modifications non enregistrées →
  ✓ Enregistré → ✓ Champs vidés).
- Force exclusion backend : PUT structured-fields avec
  `meeting_type=entretien_candidat + prospect_info` non-null →
  prospect_info forcé à null en DB.

**Aucune erreur JS console**, **aucune erreur Python**, build statique OK.

## [32.13] — 2026-04-29 · Hardening cohérence transcription (sanitization + audit + exclusion stricte)

Suite à l'incohérence détectée sur la fiche Alex Drouet (champs CRM Arthur
Voineau pollués par un test) et sur la fiche « 42 Boulevard des Belges »
(prospect_info confondu avec l'employeur cible du candidat), durcissement
du pipeline d'extraction CRM pour éviter ces problèmes à l'avenir.

- **Prompt Ollama renforcé** ([services/transcription.py:484](services/transcription.py))
  Règles non négociables ajoutées en tête du prompt d'extraction :
  - **N'invente rien** — null si l'info manque, jamais "" ou "null" en string.
  - **Distinction stricte candidate / prospect** : exemple en dur dans
    le prompt montrant l'erreur classique « employeur cible pris pour
    un prospect commercial » et la correction attendue
    (passage en `opportunites_missions[].client`).
  - **Pas de markdown dans les valeurs** : strip des `**gras**`.
- **Sanitization automatique du JSON IA**
  ([services/transcription.py:622](services/transcription.py))
  Nouvelles fonctions `_clean_str(v)` et `_sanitize_dict(d)` appliquées
  à toute sortie d'`_extract_crm_from_markdown` : conversion `""` /
  `"null"` / `"none"` / `"-"` → `None`, strip des `**markdown**`,
  élimination des sous-objets entièrement vides dans les listes.
  Fix le cas connu de llama3.2:3b qui renvoie des chaînes "null"
  stringifiées au lieu de la valeur null JSON.
- **Force exclusivité candidate XOR prospect**
  ([services/transcription.py:692](services/transcription.py),
  [routes/transcription.py:719](routes/transcription.py))
  Si `meeting_type=entretien_candidat` et `prospect_info` non-null →
  l'entreprise du « prospect » est automatiquement reclassée dans
  `opportunites_missions` puis `prospect_info` est forcé à `null`.
  Idem pour `rdv_commercial` → `candidate_info=null`. Appliqué à 2
  endroits : (a) à la sortie d'extract-crm (b) à chaque PUT
  structured-fields, pour bloquer même les saisies UI incohérentes.
- **Audit cohérence automatique**
  ([services/transcription.py:710](services/transcription.py))
  Nouvelle fonction `audit_crm_consistency(analysis, transcript, title,
  narrative_md)` exposée par `/api/transcription/<id>` dans `item.consistency
  = {ok, warnings: [str]}`. Détecte 3 catégories d'incohérence :
  1. Exclusion candidate XOR prospect violée selon meeting_type.
  2. Nom/prénom du candidat absent du transcript ET du titre ET du
     narrative (probable artefact de test ou copier/coller périmé).
  3. Entreprise prospect absente partout.
- **UI : badge cohérence + bandeau warnings**
  ([templates/v30/transcription_detail.html:97](templates/v30/transcription_detail.html),
  [static/css/v30/transcription.css:511](static/css/v30/transcription.css),
  [static/js/v30/transcription_detail.js:646](static/js/v30/transcription_detail.js))
  - Pill « ✓ cohérent » (vert) si `consistency.ok=true`.
  - Pill « ⚠ N point(s) à vérifier » (orange) sinon, avec bandeau
    détaillé listant chaque warning sous le header de la section CRM.
- **Bouton « Réinitialiser CRM »**
  ([templates/v30/transcription_detail.html:228](templates/v30/transcription_detail.html),
  [static/js/v30/transcription_detail.js:973](static/js/v30/transcription_detail.js))
  Permet de vider tous les champs CRM en un clic (avec confirm), pour
  repartir d'une feuille blanche après une mauvaise extraction. Le
  narrative_markdown et le transcript ne sont PAS touchés — l'utilisateur
  peut ensuite cliquer « ✦ Ré-extraire CRM » pour repeupler proprement.
- **Correction manuelle des fiches #1 et #2**
  - #1 (Alex Drouet) : `prospect_info` Alstom (incohérent — c'est
    l'employeur cible du candidat) déplacé en `opportunites_missions`,
    `candidate_info` complété (Drouet, Alex, ingénieur méthodes &
    industrialisation, 4 ans, mobilité Lyon, prétentions 45 k€,
    compétences clés). `_candidate_id` (pointait vers la fiche test
    soft-deletée #89) retiré.
  - #2 (42 Boulevard des Belges) : `meeting_type=entretien_candidat`,
    `prospect_info=null`, `candidate_info` partiellement rempli (titre
    « Ingénieur logiciel / Manager consultants », domaine, mobilité,
    compétences C++/Simulation/Gestion de projet, motif recherche
    après Whatside). Note `_inconsistency_note` indiquant que le nom
    et prénom n'ont pas été captés par Whisper en début d'enregistrement
    et sont à compléter manuellement.

**Vérification visuelle E2E** validée via preview navigateur :
- /v30/transcription/1 → badge « ✓ cohérent » vert, candidat hydraté
  Drouet/Alex, volet prospect masqué, mission Alstom dans opportunités.
- /v30/transcription/2 → badge « ✓ cohérent » vert, titre rempli,
  nom/prénom vides à éditer.
- Test forcé avec un nom inventé (« Zzzephyr Quintilien ») → badge
  « ⚠ 2 point(s) à vérifier » orange, bandeau d'audit listant les
  2 warnings explicites. Aucune erreur JS console.

**Aucune régression** sur les autres pages (dashboard, prospects,
candidats) — modifs ciblées sur transcription/.

## [32.12] — 2026-04-29 · Finitions Transcription CRM (idempotence, 3ᵉ passe Ollama, validation, focus prospect)

Stabilisation de la feature « Transcription → Fiche CRM » introduite en v32.11.
8 finitions orthogonales : 1 endpoint en plus (`extract-crm`), 1 fonction
`_extract_crm_from_markdown`, idempotence des 2 boutons « Créer fiche »,
validation stricte côté backend, et 3 améliorations UX (boutons HF du
préflight, warning beforeunload, scroll-to-row sur `?focus=<id>`).

- **T1 — Idempotence des boutons « Créer fiche candidat / prospect »**
  ([routes/transcription.py:763](routes/transcription.py),
  [static/js/v30/transcription_detail.js:901](static/js/v30/transcription_detail.js))
  Si `analysis._candidate_id` (resp. `_prospect_id`) existe ET pointe vers
  une fiche non-archivée appartenant au user, l'endpoint UPDATE plutôt que
  d'insérer un doublon. Réponse JSON : `{"action": "created"|"updated"}`.
  Param body `force_new=true` pour forcer un doublon volontaire. Côté JS :
  confirm dialog si fiche existe (« Mettre à jour la fiche existante #X
  ou créer un doublon ? »), libellé du bouton adaptatif (« ↺ Mettre à
  jour fiche #X » vs « ＋ Créer fiche candidat »).
- **T2 — Pré-flight HF : boutons d'action**
  ([static/js/v30/transcription.js:265](static/js/v30/transcription.js))
  Quand `data.huggingface.missing_repos` est non vide, le préflight
  affiche pour chaque repo un bouton `↗ Accepter <repo> sur HuggingFace`
  qui ouvre `https://huggingface.co/<repo>` dans un nouvel onglet, plus
  un bouton `↻ Re-vérifier` qui re-déclenche `runPreflight()`.
- **T3 — `/v30/prospects?focus=<id>` scroll-to-row + highlight**
  ([static/js/v30/prospects.js:2604](static/js/v30/prospects.js),
  [static/css/v30/prospects.css:893](static/css/v30/prospects.css))
  Le redirect renvoyé par `create-prospect` est désormais exploité côté
  liste : la ligne (ou la carte kanban) ciblée par `?focus=<id>` est
  scrollée au centre et reçoit un highlight `is-focused` (animation pulse
  2.4 s). Retry 30× / 200 ms tant que le DOM n'est pas peuplé. URL
  nettoyée par `history.replaceState` pour éviter de re-trigger sur F5.
- **T4 — 3ᵉ passe Ollama : extraction CRM JSON structurée**
  ([services/transcription.py:478](services/transcription.py))
  Nouvelle fonction `_extract_crm_from_markdown(narrative_md, transcript,
  config)` qui prend le CR markdown produit par les 2 passes existantes
  et lance un appel Ollama supplémentaire avec un prompt JSON strict pour
  remplir `meeting_type`, `candidate_info`, `prospect_info`,
  `opportunites_missions`, `suivi`. Tolérante : JSON invalide → squelette
  vide retourné, jamais d'exception remontée. Appelée à la fin de
  `_call_ollama_for_analysis` (passes courte ET longue).
- **T5 — Bouton « ✦ Ré-extraire CRM » sur fiche détail**
  ([templates/v30/transcription_detail.html:30](templates/v30/transcription_detail.html),
  [routes/transcription.py:766](routes/transcription.py))
  Nouvel endpoint `POST /api/transcription/<id>/extract-crm` qui réutilise
  `_extract_crm_from_markdown` sur le `narrative_markdown` existant SANS
  regénérer le CR. Mise à jour seule des champs CRM. Bouton dans la barre
  d'actions, visible si un narrative_markdown existe et statut != processing.
  Confirm si édition non sauvegardée en cours.
- **T6 — Beforeunload warning sur édition non sauvegardée**
  ([static/js/v30/transcription_detail.js:806](static/js/v30/transcription_detail.js))
  Listener `beforeunload` activé dès que `_crmEdited === true`, retiré
  après save réussi. Empêche les pertes accidentelles de saisie sur F5
  ou navigation sortante.
- **T7 — Validation backend des structured-fields**
  ([routes/transcription.py:686](routes/transcription.py))
  Nouvelle fonction `_validate_structured_payload` appelée avant le merge :
  vérifie `meeting_type ∈ {entretien_candidat, rdv_commercial, reunion_interne, autre, null}`,
  `candidate_info` et `prospect_info` sont dict ou null, `suivi.up_tech`
  et `suivi.autre_partie` sont des arrays de dict, `quality_score ∈ [0, 100]`.
  Retourne 400 avec message clair si invalide.
- **T8 — Nettoyage des données de test**
  Soft-delete de la fiche candidat #89 (Arthur Voineau, artefact de tests
  v32.11) et désactivation du user `claude_test` créé pour les tests
  automatisés de cette release.

**Limites connues** :
- Le modèle Ollama par défaut `llama3.2:3b` est faible en extraction
  structurée — il génère parfois `"null"` (string) au lieu de `null`,
  ou met les noms entiers dans `nom`. Recommandation forte : passer à
  `qwen2.5:7b` ou `llama3.1:8b` (Paramètres > IA > Modèle Ollama).
- Le repo `pyannote/speaker-diarization-community-1` doit être accepté
  manuellement sur HuggingFace pour activer la diarisation — le bouton
  T2 ouvre la page directement.

## [32.11] — 2026-04-29 · Section CRM éditable + création fiche candidat/prospect

L'analyse de réunion ne se contente plus de produire un CR narratif : elle
extrait des **champs structurés métier** (candidat, prospect, suivi) éditables
et exportables vers une fiche candidat ou prospect ProspUp existante.

- **Schéma JSON enrichi** ([services/transcription.py:309](services/transcription.py))
  — l'IA produit en plus des champs habituels :
  `meeting_type` (entretien_candidat | rdv_commercial | reunion_interne | autre),
  `candidate_info` (nom, prénom, titre, années_exp, mobilité, dispo,
  rémunérations, langues, compétences clés, fonctions recherchées,
  motif recherche, 3 évaluations note+commentaire, permis, véhicule,
  email/tel/linkedin),
  `prospect_info` (entreprise, contact, fonction, besoin, urgence, budget,
  stack, pain_points, ville),
  `opportunites_missions` (array de missions discutées avec score_match),
  `suivi` (actions Up Tech + autre partie + date relance + canal).
- **Section UI dédiée** ([templates/v30/transcription_detail.html:90](templates/v30/transcription_detail.html))
  — bloc « Fiche CRM extraite » sous le CR narratif, avec volets candidat /
  prospect (visibles selon `meeting_type`), grille éditable, évaluations
  3 colonnes, listes missions/actions ajoutables/supprimables, footer avec
  boutons « Enregistrer », « Créer fiche candidat », « Créer fiche prospect ».
  Indicateur de sauvegarde en temps réel (modifié / enregistrement / ✓ enregistré).
- **3 nouveaux endpoints** ([routes/transcription.py:677](routes/transcription.py)) :
  - `PUT /api/transcription/<id>/structured-fields` — sauvegarde partielle
    des champs CRM édités (merge propre, sans toucher narrative_markdown).
  - `POST /api/transcription/<id>/create-candidate` — crée une ligne
    `candidates` avec les champs (nom, prénom, titre, mobilité, dispo,
    salaires, langues, compétences, 3 évals, permis, véhicule), retourne
    `candidate_id` + `redirect=/v30/candidat/<id>`.
  - `POST /api/transcription/<id>/create-prospect` — crée prospect + company
    si nouvelle (lookup case-insensitive sur `groupe`).
  Marqueurs `_candidate_id` / `_prospect_id` stockés dans l'analyse pour
  afficher un lien d'idempotence (« Fiche candidat #89 déjà créée »).
- **Tests E2E validés** sur fiche #1 (Alex Drouet) :
  hydratation des 50+ champs depuis JSON enrichi, édition d'un champ,
  PUT structured-fields → ✓ Enregistré, POST create-candidate → fiche
  candidat #89 créée et redirigée correctement, lien idempotent affiché
  au retour. Aucune erreur JS console.

**Fix CSS associé** : `.v30-tx-crm__panel { display: flex }` overridait
l'attribut `[hidden]` natif (le volet prospect restait visible avec
`display: flex` malgré `hidden=true`). Ajout de
`.v30-tx-crm__panel[hidden] { display: none }`.

## [32.10] — 2026-04-29 · Diagnostic pyannote community-1 + tests E2E

Validation E2E complète du pipeline transcription après les fix v32.8/9.
Diagnostic d'un bug de diarisation jamais résolu : pyannote.audio 4.x
charge en cascade un 3ᵉ repo gated `pyannote/speaker-diarization-community-1`
absent du pré-flight et du message d'erreur.

- **Pré-flight HF** ([routes/transcription.py:219](routes/transcription.py))
  vérifie désormais les **3 repos** requis par pyannote.audio 4.x :
  `speaker-diarization-3.1`, `segmentation-3.0` et
  `speaker-diarization-community-1`. Renvoie `missing_repos: [...]` quand
  un repo n'est pas accepté côté compte HF.
- **Message d'erreur diarisation** ([services/transcription.py:730](services/transcription.py))
  détecte spécifiquement `community-1` / `gated repo` AVANT le 401/403
  générique et pointe l'URL exact à débloquer.
- **UI pré-flight** ([static/js/v30/transcription.js:295](static/js/v30/transcription.js))
  : `Repos à débloquer : speaker-diarization-community-1` quand seul ce
  3ᵉ repo manque, au lieu d'un message d'erreur HTTP brut.
- Tests E2E validés (Playwright + dev local) : pré-flight,
  copy-paste IA externe (3 formats : JSON pur, JSON dans fences,
  markdown brut), bascule Claude→Ollama 2 passes (7 chunks sur
  transcript 50 875 chars).

**Action user requise** pour activer la diarisation : aller sur
<https://huggingface.co/pyannote/speaker-diarization-community-1> et
cliquer **« Agree and access repository »** (en plus des 2 repos déjà
acceptés). Le pré-flight l'indique maintenant clairement.

## [32.9] — 2026-04-29 · Workflow copy-paste IA externe + Ollama 2 passes

3 voies d'analyse désormais disponibles, sans imposer le paiement de
crédits API : **Claude API** (si crédits), **Ollama local** (qualité
améliorée par chunking 2 passes), ou **copy-paste depuis claude.ai /
ChatGPT / Gemini** (si pas de crédits API mais forfait web).

- **Workflow IA externe (copy-paste).** Nouveau bouton « Analyser via
  IA externe » sur la fiche détail. Modal 3 étapes :
  1. Bouton « Copier dans le presse-papier » récupère via
     `GET /api/transcription/<id>/external-prompt` le système prompt
     complet + le transcript prêt à coller. Le user va sur
     **claude.ai** (lien direct), **chatgpt.com** ou **gemini.google.com**
     en mode chat normal et colle.
  2. Liens directs vers les 3 IA web + sélecteur de provider/modèle.
  3. Textarea où coller la réponse JSON. Le bouton « Appliquer »
     `POST /api/transcription/<id>/external-analysis` parse de
     manière tolérante : JSON brut, JSON dans ` ```json ... ``` `,
     ou markdown pur (auto-emballé dans `narrative_markdown`).
  L'analyse stockée a `_provider="external"` et `_model_used="claude.ai
  (Sonnet 4.6)"` (ou autre source). Cas d'usage type : forfait Claude
  Max 5× sans crédits API → on profite du forfait web pour avoir un
  CR Sonnet/Opus de qualité, sans rien payer en plus.
- **Badge violet « ✦ Collé »** sur le CR pour indiquer que l'analyse
  vient d'un copy-paste externe (distinct de l'orange « Ollama
  fallback »).
- **Ollama 2 passes pour les longs transcripts.** Si le transcript
  fait >12 000 caractères (≈3000 tokens), l'analyse Ollama est
  désormais en 2 passes : chunking en morceaux de ~9000 caractères
  → un mini-CR factuel par chunk → synthèse finale narrative.
  Beaucoup plus fiable que demander direct un CR de 25 sections à un
  petit modèle 3-8B (qui hallucinait massivement avec l'ancien
  prompt). Recommandation UI : passer à `qwen2.5:7b` ou `llama3.1:8b`
  plutôt que `llama3.2:3b` pour des CR de qualité acceptable.

## [32.8] — 2026-04-29 · Pre-flight check + fix HF login + désactivation fallback Ollama

Refonte du flux de lancement pour que la transcription soit prévisible :
- on vérifie AVANT l'upload que les dépendances critiques marchent,
- on bloque proprement si Claude est KO au lieu de fallback sur Ollama 3B
  qui produit des CR truffés d'hallucinations,
- on corrige le 401 pyannote en forçant le login HuggingFace Hub.

- **Pre-flight `GET /api/transcription/preflight`.** Nouveau endpoint
  qui teste en parallèle Claude (vrai appel `messages` 10 tokens →
  détecte crédits épuisés), HuggingFace (HEAD `config.yaml` sur les
  2 modèles pyannote), et GPU (`torch.cuda.is_available` + nom + VRAM).
  Retourne `{ok, claude, huggingface, gpu, fallback_ollama_active,
  warnings}`. Coût quasi nul (~0,00001 € côté Claude).
- **UI modal upload.** Bloc preflight visible dès l'ouverture du modal
  (statut détaillé par dépendance, codes couleur ✓/⚠/✗). Au clic
  « Lancer la transcription » : re-preflight, upload uniquement si
  `ok=True`. Si Claude KO → 2 boutons d'action « Recharger crédits »
  (lien `console.anthropic.com/billing`) et « Ouvrir Paramètres IA ».
- **Fix HuggingFace 401 sur pyannote.** pyannote 4.x utilise
  `huggingface_hub` qui regarde EN PRIORITÉ le token cache disque
  (`~/.cache/huggingface/token`) avant le `token=` passé à
  `from_pretrained` — ce qui causait des 401 même avec un token
  valide en config (cas du user qui a un autre token cache via
  `huggingface-cli login`). Fix : `huggingface_hub.login(token=...)`
  programmatique + 3 env vars (`HF_TOKEN`, `HUGGING_FACE_HUB_TOKEN`,
  `HUGGINGFACE_HUB_TOKEN`) forcés AVANT le chargement du pipeline.
- **Fallback Ollama transcription DÉSACTIVÉ par défaut.** Avec
  `llama3.2:3B` (Ollama par défaut), l'analyse de transcripts longs
  (1h+, ~10k tokens) hallucine massivement : noms inventés
  (« Fouman »), étapes fictives (QCM jamais discutés), structure
  incohérente. Mieux vaut une erreur claire pointant vers la recharge
  de crédits qu'un faux CR. Nouvelle clé `transcription_fallback_ollama`
  (séparée de `fallback_enabled` pour Tavily). Toggle UI dans
  Paramètres > IA avec warning explicite : « ⚠ Active uniquement si
  tu as un gros modèle (qwen2.5:32b+, llama3.3:70b) ».
- **Test « Tester Claude » refondu.** Faisait avant un GET `/v1/models`
  qui ne consommait pas de tokens donc ne révélait PAS les crédits
  épuisés. Désormais POST `/v1/messages` `max_tokens=10` → détecte
  vraiment l'état de la facturation. Message d'erreur explicite si
  crédits insuffisants.

## [32.7] — 2026-04-29 · Diagnostic HuggingFace + bloc résultat de test détaillé

Le 401 sur pyannote pouvait avoir 3 causes différentes (token expiré, conditions
non acceptées, token fine-grained sans scope) sans qu'on puisse les distinguer.
Ajout d'un test diagnostic dédié + UI pour afficher le résultat complet.

- **Backend.** `routes/ai.py:/api/ai/test` accepte maintenant
  `test_target=huggingface`. Test en 2 étapes :
  1. `GET https://huggingface.co/api/whoami-v2` avec le token → vérifie
     validité globale + récupère `username` et `token_type` (Classic/Fine-grained).
  2. `HEAD https://huggingface.co/<model>/resolve/main/config.yaml` pour
     `pyannote/speaker-diarization-3.1` ET `pyannote/segmentation-3.0` →
     teste l'accès RÉEL au repo gated (download d'un petit fichier).
  Distingue clairement les codes : 401 (token rejeté), 403 (conditions
  non acceptées) et succès. Message d'erreur ciblé pour chaque cas
  (« token fine-grained sans scope », « va sur huggingface.co/X et clique Agree »).
- **UI Paramètres.** Bouton **« Tester HF »** à côté du champ token. Hint
  ré-écrit pour expliquer la différence Classic Read / Fine-grained et
  rappeler les 2 modèles à accepter.
- **Bloc résultat.** Nouvelle zone `v30-params__test-output` sous les
  boutons d'action qui affiche le résultat complet en multi-ligne
  (police mono, max 240 px scrollable). Couleur verte si succès, rouge
  si erreur. Le toast et le statut inline restent en 1 ligne pour rester
  compacts ; le détail est dans le bloc.

## [32.6] — 2026-04-29 · Fallback Ollama + détection crédits Claude

Quand l'API Anthropic est indisponible (crédits épuisés, clé invalide,
panne réseau), l'analyse bascule automatiquement sur Ollama pour ne
pas perdre l'utilisateur. UI explicite pour signaler le mode fallback
et orienter vers la recharge de crédits.

- **Backend.** `services/transcription.py:run_analysis_with_fallback()`
  centralise la logique : tente Claude → si échec et `fallback_enabled`,
  bascule sur Ollama avec un prompt simplifié markdown-only
  (`_OLLAMA_ANALYSIS_PROMPT`). Stocke `_provider`, `_model_used` et
  `_fallback_reason` dans `analysis_json`. Détection des erreurs de
  type "credit balance too low" / "billing" / "quota" pour message UX
  spécifique. Routes `/process` et `/reanalyze` utilisent ce helper.
- **UI fiche détail.** Banner d'erreur enrichi avec 2 actions :
  - **« Aller dans Paramètres IA »** → `/v30/parametres#ai`
  - **« Recharger crédits Claude »** (visible seulement si l'erreur
    contient "credit"/"billing"/"insufficient") →
    `console.anthropic.com/settings/billing` en nouvel onglet
- **Badge provider.** Quand l'analyse a basculé sur Ollama, badge
  visible sous le titre du CR : « ✦ Ollama (fallback) · Crédits Claude
  épuisés ». Permet à l'utilisateur de savoir que la qualité est
  moindre et qu'il peut relancer après recharge.
- **Lien dans Paramètres.** Section IA enrichie d'une note explicite
  sur la séparation des facturations Claude.ai / API Anthropic, avec
  lien direct vers `console.anthropic.com/settings/billing`.

## [32.5] — 2026-04-29 · CR narratif Genspark-style + diagnostic diarisation

Refonte de l'analyse Claude pour produire un compte-rendu **narratif et
détaillé** comparable à Genspark / Otter Pilot, et diagnostic des erreurs
de diarisation pyannote.

- **Prompt Claude refondu.** Demande désormais un CR markdown structuré :
  titre contextuel + synthèse longue (4-8 phrases) + 10-25 sections H2
  thématiques en prose narrative (présentation candidat, parcours, missions
  discutées, rémunération, prochaines étapes, etc.). Garde les chiffres /
  noms / lieux EXACTS du transcript, n'invente jamais. `max_tokens` porté
  de 4096 à 16000, transcript max 200k → 300k chars. Champ
  `narrative_markdown` ajouté au JSON de réponse en plus des champs
  structurés (action_items, decisions, etc.) qui restent disponibles
  pour les blocs synthétiques.
- **UI fiche détail.** Nouveau bloc « Compte-rendu » en haut (style
  article, typographie sérif Instrument Serif, max-width 900px), rendu
  par un parser markdown inline (~80 lignes, échappement HTML pour
  sécurité). Bouton « Copier le CR » qui copie le markdown brut. Les
  blocs synthétiques (Résumé, Tâches, Décisions…) restent en dessous
  pour un coup d'œil rapide.
- **Export `.txt` enrichi.** Le fichier exporté contient maintenant le
  CR markdown complet en tête, suivi du transcript brut en annexe.
- **Diagnostic diarisation.** Quand pyannote crash silencieusement,
  l'erreur est désormais classifiée et exposée dans `error_message`
  avec un message actionable :
  - 401/403 → token HF rejeté → instructions d'acceptation des conditions
  - OOM → VRAM saturée → suggestion de basculer sur Whisper turbo / medium
  - 404 / gated → conditions pyannote non acceptées → liens directs
  - autre → message d'erreur brut

## [32.4] — 2026-04-29 · Réparation torch CUDA en arrière-plan

Quand `pip install -r requirements.txt` a installé `torch+cpu` au lieu de
`torch+cu121` (cas fréquent : l'index PyPI gagne sur `--extra-index-url`),
on ne peut plus utiliser le GPU pour la transcription. Ajout d'une
réparation chirurgicale lançable depuis l'app.

- **Backend.** Nouveaux endpoints admin :
  `POST /api/deploy/install-torch-cuda` (démarre un thread daemon qui
  exécute `pip install --upgrade --force-reinstall --index-url
  https://download.pytorch.org/whl/<tag> torch torchaudio`) et
  `GET /api/deploy/install-torch-cuda/status` (état + log + détection
  runtime de `torch.version.cuda` / `torch.cuda.is_available()`).
  L'install tourne en background, le user peut fermer la page —
  le job continue côté serveur. Log capé à 1500 lignes.
- **UI.** Nouvelle section « État GPU (torch + CUDA) » dans
  Paramètres > Configuration IA : badge `✓ CUDA actif` /
  `⚠ Build CPU` selon le runtime, sélecteur de version cible
  (cu118 / cu121 / cu124), bouton « Forcer install CUDA », log live
  rafraîchi toutes les 2,5 s tant que l'install tourne. Une fois
  terminée, redémarrage manuel via « Mettre à jour et redémarrer »
  pour recharger torch.

## [32.3] — 2026-04-29 · Push « sans consultant » + placeholder `[genre]`

Nouvelle option **« Pas de candidat requis »** sur les catégories de push :
permet d'envoyer un email simple (relance, présentation, confirmation RDV)
sans candidat ni dossier de compétence en pièce jointe.

- **Schéma DB.** Colonne `push_categories.no_candidates INTEGER DEFAULT 0`
  ajoutée (CREATE TABLE + migration `_migrate_user_db_schema` pour les DBs
  existantes).
- **Backend `_apply_salutation`** ([app.py:9049](app.py)) accepte
  désormais `[titre]`, `[genre]` et `[civilite]` comme placeholders
  interchangeables pour le genre, et `[Nom]`, `[nom]`, `[prenom]` pour le
  nom du prospect (insensible à la casse).
- **Backend `/api/push/generate`.** Quand la catégorie est
  `no_candidates=1`, ignore les `candidate_id1/2` envoyés par le client,
  ne charge aucune fiche candidat, n'attache aucun DC PDF. Le template
  est personnalisé sur la salutation uniquement, le destinataire reste
  l'email du prospect.
- **Backend `/api/push-categories/save`.** Le payload accepte
  `no_candidates` (booléen) ; bascule à `true` vide automatiquement les
  slots `candidate1_id` / `candidate2_id`.
- **UI Push (Catégories).** Case à cocher « Pas de candidat requis » dans
  l'éditeur de catégorie. Carte catégorie avec badge « Sans candidat »
  vert. Modale détail masque la section « Candidats par défaut » et
  affiche un message d'info à la place.
- **UI Modale push (fiche prospect).** Quand la catégorie sélectionnée
  est en mode « sans consultant », masque les comboboxes de candidats et
  affiche un hint vert ; saute la passe IA `best-candidates`.

## [32.2] — 2026-04-29 · Transcription de réunions (Whisper + Claude)

Nouvel outil **Transcription** dans la sidebar (`/v30/transcription`) : upload
d'un fichier audio post-réunion, transcription locale par Whisper sur GPU,
diarisation des orateurs via pyannote, puis analyse structurée par Claude
(résumé, sujets, décisions, tâches, prochaines étapes, sentiment, citations).

- **Pipeline.** `services/transcription.py` orchestre faster-whisper
  (`large-v3` par défaut, GPU CUDA) → pyannote 3.1 (diarisation, token HF
  requis) → fusion des segments par orateur → Anthropic Messages API
  (`claude-haiku-4-5` par défaut). Lock global pour éviter la concurrence
  VRAM. Worker en thread daemon, polling côté UI.
- **Schéma DB.** Nouvelle table `transcriptions` : audio_path, status
  (pending/processing/done/error), progress %, stage, transcript_text,
  segments_json (par orateur), speakers_json, analysis_json (résumé +
  tâches + décisions). Soft delete via `deleted_at`.
- **Backend.** Blueprint `routes/transcription.py` avec : `POST
  /api/transcription/upload`, `GET /api/transcription`, `GET
  /api/transcription/<id>`, `POST /api/transcription/<id>/retry`, `DELETE
  /api/transcription/<id>`, `GET /api/transcription/<id>/audio` (stream),
  `GET /api/transcription/<id>/export.txt`. Pages v30 :
  `/v30/transcription` (liste) et `/v30/transcription/<id>` (détail).
- **UI.** Liste de cartes avec badge statut + barre de progression mini,
  modal upload avec drag & drop (mp3, wav, m4a, ogg, mp4, webm, flac, aac
  jusqu'à 500 MB). Page détail : lecteur audio, transcript par orateur
  (couleurs distinctes), 7 blocs d'analyse (résumé, participants, sujets,
  décisions, tâches avec priorités, prochaines étapes, sentiment +
  qualité, citations clés), copy-to-clipboard, export `.txt`.
- **Config IA.** Paramètres > IA étendu : clé Anthropic, modèle Claude,
  modèle Whisper, device/compute, toggle diarisation, token HuggingFace.
  Fichier `data/ai_config.json` (gitignored). Test connexion Claude
  (`/api/ai/test` avec `test_target=anthropic`).
- **Reprise crash.** Au démarrage, les jobs en `processing`/`pending`
  orphelins (suite à crash/restart serveur) sont marqués en erreur ;
  l'utilisateur peut les relancer depuis la fiche détail.
- **Dépendances.** `faster-whisper`, `pyannote.audio`, `torch`,
  `torchaudio` ajoutés à `requirements.txt` avec
  `--extra-index-url https://download.pytorch.org/whl/cu121` pour
  récupérer les wheels GPU. Téléchargement initial ~3 GB. Mapping
  pip→module ajouté dans `routes/deploy.py:check-deps`.
- **Install longue durée.** Le `pip install` du flux SSE de mise à jour
  est désormais **streamé ligne par ligne** (heartbeat toutes les 25 s)
  pour survivre aux timeouts proxy (Cloudflare Tunnel) et donner du
  feedback pendant les ~10-15 min de la 1re installation. Timeout
  porté de 120 s à 1200 s. Manuel `/api/deploy/install-deps` : timeout
  porté à 1200 s également, message UI mis à jour.
- **Privacy.** L'audio brut reste 100% local. Seul le transcript texte
  (anonymisable) part chez Anthropic pour l'analyse.

## [32.1] — 2026-04-29 · Fiche candidat enrichie · DC + Notes & suivi

Amélioration de la fiche candidat (`/v30/candidat/<id>`) pour rapprocher
son expérience de celle de la fiche prospect.

- **Carte « Dossier de compétences ».** Nouvelle section qui affiche le
  statut du DC (chargé / absent), le nom du fichier PDF, et propose des
  actions inline : **Voir** (ouvre le PDF), **Renommer**, **Remplacer**
  (upload PDF), **Supprimer**, ainsi que **Générer** (lien vers
  `/v30/dc/<id>`) et **Charger** (upload direct depuis la fiche). Tous
  les flux passent par les routes existantes
  `/api/candidates/<id>/dc-status`, `/api/candidates/upload-dc`,
  `/api/candidates/<id>/dc-rename`, `/api/candidates/<id>/dc-delete` et
  `/api/candidates/<id>/dossier-competence`.
- **Carte « Notes & suivi ».** Timeline chronologique des événements du
  candidat (`candidate_events` : notes, contacts, pushes, changements de
  statut). Bouton **+ Note** pour ajouter rapidement une note d'après
  RDV (titre + contenu) qui apparaît immédiatement dans le fil. Utilise
  les routes existantes `GET /api/candidate/timeline` et
  `POST /api/candidate/events/add`.
- **Aucun changement de schéma DB** — toutes les routes back existaient
  déjà ; on les expose simplement dans l'UI.

## [31.8] — 2026-04-28 · CR de réunion sur fiche prospect

Reconstruction de l'expérience « Après réunion » qui existait en v29.
Les CR sont maintenant **persistés**, **historisés** et **éditables** sur
chaque fiche prospect. Un nouvel onglet « CR » liste l'historique des
comptes-rendus avec leurs tâches associées.

- **Schéma DB.** Nouvelles colonnes sur `meetings` (migration légère via
  `_add_col`) : `summary` (résumé synthèse), `raw_transcript` (notes
  brutes), `next_action`, `tags` (JSON), `documents` (texte
  multi-lignes pour liens / refs).
- **Backend.** Routes `GET /api/meetings/<id>` (détail + action items),
  `PUT /api/meetings/<id>` (édition complète, remplace les action items
  fournis), `DELETE /api/meetings/<id>` (cascade), `PUT/DELETE
  /api/meeting-action-items/<id>`. La route `POST /api/meetings`
  accepte désormais `summary`, `raw_transcript`, `next_action`, `tags`,
  `documents`, `date` et un tableau `action_items[]` créés en même
  temps que le CR. `GET /api/meetings?prospect_id=X` renvoie aussi
  `action_count` / `action_pending` pour les badges de l'onglet CR.
- **Onglet « CR ».** Nouvel onglet sur `templates/v30/prospect_detail.html`
  entre « Grille RDV » et « IA », avec un compteur `(n)`. Chaque CR
  s'affiche en card cliquable (date + titre + extrait synthèse + tags +
  badge tâches en attente). Bouton « + Nouveau CR » en haut à droite.
- **Modale CR refondue.** Étape 1 : zone de saisie texte libre +
  boutons « Saisir manuellement » (skip IA) ou « Analyser avec IA »
  (parsing existant). Étape 2 : formulaire complet avec **titre**,
  **date** (auto = aujourd'hui), résumé, prochaine action, statut, tags,
  notes enrichies, transcription brute, **tâches dynamiques** (add /
  remove / cocher fait), **documents / liens**, et grille de qualif.
  En mode édition (clic sur une card), la modale se charge directement
  en étape 2 avec les données du CR. Bouton « Supprimer ce CR »
  (rouge) visible uniquement en édition.
- **Persistance.** À l'enregistrement, le CR est créé via
  `POST /api/meetings` (ou `PUT` en édition) avec snapshot complet de
  la grille du moment. La grille globale `rdv_checklists` est ensuite
  mise à jour de manière non-destructive (les anciennes valeurs des
  autres CR sont préservées). Les action items sont créés en cascade.
- **CSS.** Ajout des styles `.v30-cr-list`, `.v30-cr-card`,
  `.v30-cr-task`, `.v30-cr-row` dans `static/css/v30/prospect_detail.css`,
  cohérents avec le design system v30 (palette, radius, transitions).
  Responsive ≤ 700 px : tâches en colonne unique.
- **Compat.** Le bouton « Remplir avec IA » de l'onglet « Grille RDV »
  ouvre désormais la même modale CR (chaque action remplie crée un CR
  daté en plus de mettre à jour la grille globale).

## [31.7] — 2026-04-28 · dépréciation v29

L'UI v29 (legacy) est retirée. Le code est conservé dans `archives/v29/`
au cas où une régression v30 demanderait d'auditer l'ancienne
implémentation.

- **20 routes Flask legacy → redirects 302** vers leur équivalent
  `/v30/...` : `/`, `/dashboard`, `/sourcing`, `/candidat?id=X`,
  `/entreprises`, `/push`, `/stats`, `/calendrier`, `/rapport`,
  `/focus`, `/duplicates`, `/snapshots`, `/activity`, `/help`,
  `/aide`, `/metiers`, `/users`, `/parametres`, `/collab`,
  `/dc-generator(?candidate=X)?`, `/candidates/<id>/dc-generator`,
  `/prospects/mode-prosp`. Bookmarks, partages externes et
  raccourcis PWA continuent de fonctionner.
- **Toute autre URL legacy → 404** (sans fallback).
- `templates/legacy/` (22 fichiers, ~7 300 lignes) déplacé vers
  `archives/v29/templates/legacy/`.
- `static/js/app.js` (15 300 lignes) + `static/js/page-*.js`
  (18 fichiers) + `static/js/v30/opt-in.js` déplacés vers
  `archives/v29/static/js/`. Voir `archives/v29/README.md`.
- `templates/_partials/v30/sidebar.html` : bouton « v29 » retiré.
- `templates/v30/base.html` : ne charge plus `opt-in.js`.
- `templates/v30/help.html` : retire le callout sur l'escape hatch
  (`?force_v29=1`, carte « Revenir à l'ancienne interface »).
- `static/manifest.json` : `start_url` et shortcuts pointent sur
  `/v30/...`.
- `static/sw.js` : précache nettoyé (plus de `style.css`, `mobile.css`,
  `app.js`, `page-*.js`). `CACHE` bumpé à `prospup-v31.7-shell-1`
  pour invalider l'ancien Service Worker.
- Nouveau helper `static/js/v30/ollama.js` : remplace l'ancien
  `callOllama` global de `app.js` (utilisé par `/v30/rapport`,
  `/v30/stats`). Mode non-streaming uniquement, signature préservée.
- `static/js/v30/dashboard.js` : lien « Configurer objectifs »
  cible `/v30/parametres#goals`.
- `CLAUDE.md` : architecture mise à jour (suppression des sections
  liées à v29, ajout du dossier `archives/v29/`).

## [31.6] — 2026-04-28 · finalisation v30 (DC + Calendrier)

Deux gros déblocages pour rendre v30 autonome face à v29.

- **DC Generator — historique persistant.** Nouvelle table `dc_generations` avec
  un INSERT à chaque génération réussie. Trois routes API :
  `GET /api/dc/history`, `GET /api/dc/<id>/download`, `DELETE /api/dc/<id>`.
  Côté UI, ajout des onglets « Générateur | Historique » sur `/v30/dc`,
  avec téléchargement et suppression. La sidebar « Récents » et le panneau
  plein affichent désormais les DC issus de la base, plus uniquement la
  session courante.
- **Calendrier — création/édition/suppression de RDV.** Nouvelle table
  `calendar_events` pour les RDV ad-hoc créés depuis l'UI v30. Trois routes
  API (`POST/PUT/DELETE /api/calendar_events[/<id>]`). Le `GET` existant
  agrège ces événements en plus des sources actuelles, en exposant
  `prospect_id` / `candidate_id` séparés. Bouton « Nouveau RDV » en topbar,
  double-clic sur une cellule jour pour créer un RDV pré-rempli, modale
  avec date / heure / durée / lieu / notes / statut + autocomplete prospect
  via `/api/search`. Bouton « Modifier » dans le popup d'événement pour
  les RDV custom.
- `static/js/v30/candidate_detail.js` : corrige la redirection du bouton
  « Générer DC » (`/v30/dc?candidate=X` → `/v30/dc/<X>` qui est la route
  réelle).

## [31.5] — 2026-04-28 · date du RDV dans le badge « Rendez-vous »

Visuel direct depuis le tableau des prospects sans avoir à ouvrir la fiche.

- `static/js/v30/prospects.js` : nouveau helper `rdvDateLabel(iso)` (format compact : « auj. », « demain », « hier », sinon « 15 mai »).
- Nouveau helper `renderStatusBadge(p, extraStyle)` mutualisé entre table et split view : ajoute « · {date} » au libellé quand `statut === 'Rendez-vous'` et qu'une `rdvDate` est présente.
- Appliqué sur les vues Table, Split (liste) et Split (détail). Le Kanban groupe déjà par statut, donc inchangé.

## [31.4] — 2026-04-27 · auto-refresh des données

Plus besoin de F5 pour voir un push apparaître ou pour rafraîchir un dashboard laissé ouvert dans un onglet en arrière-plan.

### Optimistic UI sur la fiche prospect

- `prospect_detail.js` écoute désormais `v30-push-sent` (déjà dispatché par `push-modal.js` mais sans listener jusque là).
- À l'envoi d'un push, l'événement est inséré localement dans `STATE.events` et la timeline + les badges (Timeline/Push) se mettent à jour instantanément, sans attendre le re-fetch.
- Re-fetch automatique 1.5 s après pour récupérer la version serveur enrichie (template, candidats, consultants).

### Refresh quand l'onglet redevient actif

Listeners `visibilitychange` + `focus` ajoutés sur les pages v30 suivantes (throttle 5 s pour éviter le spam) :
- **Fiche prospect** : `loadTimeline()`
- **Prospects** : `loadProspects()`
- **Dashboard** : `hydrate()`
- **Focus** : `load()` + `loadTasks()` + `loadRelances()`
- **Calendrier** : `loadAll()`
- **Push** : `reloadPushLogs()`

Pattern repris de `mode_prosp.js` (déjà éprouvé). Pas de polling actif → coût réseau nul tant que l'onglet reste actif sans interaction.

## [31.0] — 2026-04-25 · v31 · audit exhaustif desktop + mobile + corrections transverses

Passage en v31 après un cycle complet de tests fonctionnels et visuels (simulation d'utilisateur sur 7 jours + balayage exhaustif desktop/mobile). Plusieurs bugs structurels (multi-user DB, labels pipeline, URLs cassées) corrigés.

### Fixes multi-user (per-user DB)

Nouvelles user-DB (`data/user_<id>/prospects.db`) créées incomplètes par `_init_user_db` → migrations manquantes appliquées automatiquement désormais :
- **candidates** : ajout de toutes les colonnes v27-v28 (`prenom`, `titre`, `annees_experience`, `domaine_principal`, `description_push`, `disponibilite`, `mobilite`, `permis_conduire`, `vehicule`, `permis_travail`, `fonctions_recherchees`, `motif_recherche`, `avancement_recherches`, `remuneration_actuelle`, `pretentions_salariales`, `propal_a`, `eval_*`, `langues`, `references_candidat`, `avis_perso`, `dossier_path`, `dossier_generated_at`).
- **push_categories** : `candidate1_id`, `candidate2_id` (v27.3).
- **push_logs** : `sent_at_hour`, `sent_at_day_of_week`, `variant_id`, `opened_at`, `clicked_at`, `replied_at`, `tracking_pixel_id`, `campaign_id`.
- **Tables créées si manquantes** : `mode_prosp_sessions`, `candidate_skills`, `candidate_availability`, `duplicate_ignores`, `embeddings_cache`.
- `_init_user_db` appelle désormais `_migrate_user_db_schema` à la création pour garantir un schéma complet.

### Fixes Python 3.13

- `conn.lastrowid` → `cur = conn.execute(...); cur.lastrowid` dans `api_candidate_experiences_post`, `api_candidate_educations_post`, `api_candidate_certifications_post` (Python 3.13 requiert un Cursor pour `lastrowid`).

### Fixes endpoints

- **`GET /api/push-logs`** : le `LEFT JOIN users` cassait l'endpoint sur per-user DB (table `users` inexistante). Refacto : requête sans JOIN, enrichissement `consultant1/2_name` via `_auth_conn()`.
- **`GET /api/stats` hot_companies** : filtrait pas les soft-deleted → affichait des entreprises fusionnées dans le tableau "Entreprises chaudes". Ajout `AND (c.deleted_at IS NULL OR c.deleted_at='')`.
- **`GET /api/rapport-hebdo`** : KPI `calls` manquait → "APPELS PASSÉS" toujours à 0 dans le rapport. Ajout de `calls_count` via `call_logs` + adaptation front (`stats.js` lit maintenant `kpi.calls` avec fallback sur `kpi.notes`).
- **`GET /api/search`** : prospects matchés sans lire `tags` ni nom d'entreprise associée. Ajout des clauses WHERE correspondantes.

### Fixes UI v30

- **Pipeline dashboard labels** (`dashboard.js:renderPipeline`) : mapping cassé — `rdv`→"Contacté", `besoin`→"RDV", `reunion_tech`→"Proposition". Corrigé : `appel`→"À prospecter", `rdv`→"RDV", `besoin`→"Besoin", `reunion_tech`→"Réunion tech", `contrat`→"Gagné".
- **Modale "Nouvel utilisateur"** : inputs blancs en dark mode (CSS `.v30-input/.v30-select/.v30-textarea` manquants dans `components.css`) + bouton "Supprimer" visible en création (`[hidden]` surchargé par `display: inline-flex` du `.btn`). Styles globaux ajoutés + règle `.btn[hidden] { display: none !important; }`.
- **Cartes candidat Sourcing** : "titre" affiché "—" car le JS lisait `c.role || c.seniority` alors que l'API renvoie `c.titre`. Fallback étendu.
- **DC Generator URL** : `/dc_generator` partout dans les templates v30 → route Flask est `/dc-generator` (tiret). Corrigé dans `dc.html` et `opt-in.js`.

### Mobile — Prospects en cartes

- `prospects.css @media (max-width: 700px)` : le tableau 10 colonnes → scroll horizontal sur mobile, illisible. Transformation en cartes empilées (avatar + nom + statut / entreprise / tags / actions). Colonnes Pertinence / Push / Dernière action / Relance masquées sur mobile.

### Page 404 — redesign v30

`404.html` refait avec le design system v30 : fond `--bg`, carte surface avec border-radius 18px, titre `404` en Instrument Serif italic, boutons `btn`/`btn-accent`/`btn-danger`. Remplace l'ancien style gradient indigo/orange/rouge par une palette épurée cohérente avec le reste de l'app.

### Tests réalisés

7 jours de simulation d'usage par utilisateur de test isolé (DB séparée `data/user_<id>/`) + balayage desktop et mobile (Pixel 5 viewport) de : Dashboard, Prospects (cartes + Kanban + Split + Archives + bulk ops), détail prospect (timeline, notes, log-call, Pousser, Planifier, menu kebab), Entreprises (fusion + déplacement), Candidats (Pipeline + détail + skills + experiences), Push (catégories + matching auto IA + templates + historique + filtres canal), Stats (KPI + ranges), Rapport hebdo (KPI + Exporter PDF + Générer IA), Focus (tâches + relances), Calendrier, Mode Prosp (navigation cartes), Collaboration, Doublons (scan + fusion), DC Generator, Aide, Paramètres. IA Ollama enrichissement validée (15s response time).

---

## [30.17] — 2026-04-24 · Push popup · auto-sélection Top IA + suppression section Message

Tout le contenu du push vient déjà du template `.msg` Outlook. La section « Message » de la popup était redondante et générait de la confusion : on a `Générer avec l'IA`, `3 variantes`, progress bar streaming… pour finalement rien qui n'ait d'impact sur l'email réel (le .msg écrase le texte). Suppression complète. Par ailleurs, le preview « Top IA » dans le label des combobox pouvait laisser croire à une sélection réelle sans action associée.

### Changements
- **Section Message supprimée** de la modale. Avec elle, retrait de ~200 lignes de JS : `buildAIPrompt()`, `generateAI()` (streaming SSE), `showAIProgress()`, `updateAIProgressMsg()`, `updateAIStats()`, `hideAIProgress()`, `setAIButtonsDisabled()`. Retrait des sélecteurs DOM `[data-v30pm-message]`, `[data-v30pm-progress*]`, `[data-v30pm-ai]`.
- **Auto-sélection des 2 meilleurs Top IA** : après la passe `best-candidates`, si l'utilisateur n'a pas déjà choisi, les 2 meilleurs candidats **avec DC** sont automatiquement placés dans les slots 1 et 2 (fallback sur les meilleurs même sans DC si aucun avec DC). `renderCombos()` + `renderCandCards()` sont rappelés pour matérialiser la sélection dans l'UI.
- **Auto-génération des descriptions** : nouvelle `autoGenerateSelectedDescriptions()` — appelée juste après l'auto-sélection. Pour chaque candidat sélectionné qui a un DC mais aucune `description_push` en cache, déclenche en arrière-plan `regenerateCandDesc()` (qui appelle `/api/candidates/<id>/generate-description`). Non-bloquant : les 2 cartes description affichent « Analyse du DC en cours… » pendant que l'IA mouline.
- **Preview « Top IA » retiré** du label des combobox (remplacé par la vraie sélection). À la place, quand un candidat sélectionné faisait partie des suggestions IA, un petit badge `🤖 IA` s'affiche à gauche de son nom.
- **`send()`** : le `body` du push log concatène désormais les présentations par candidat (format `— Nom Candidat —\n<description>\n\n— …`) pour la traçabilité, au lieu d'un `customMessage` éditable disparu.
- **Open()** : retrait du reset du textarea message + `hideAIProgress()` (code mort).

### Aucun changement backend

## [30.16] — 2026-04-24 · Push popup · modale large 920 px + polish v30 + strip HTML description

Dernier pass de finition sur la popup push. La modale était trop étroite (680 px) pour contenir confortablement les 2 combobox + 2 cartes description côte à côte, forçant un scroll vertical à chaque ouverture. Et les descriptions IA arrivaient avec des balises HTML brutes (`<b>Nom</b>`, `<br>`) affichées littéralement dans les textarea → illisible.

### Changements
- **Modale élargie à 920 px** (au lieu de 680 px). `max-height: 92vh` + `body max-height: calc(92vh - 140px)` pour éviter le débordement sur petit écran. Responsive 94 vw en dessous de 960 px.
- **Padding body** 14 × 18 → **16 × 22 px** pour plus de respiration.
- **Strip HTML des descriptions IA** : nouvelle fonction `stripHtml()` qui convertit `<br>` / `</p>` en sauts de ligne, retire les autres balises et décode les entités HTML. Appliquée dans `cachedDesc()` (chargement initial) et à la réception de `/api/candidates/<id>/generate-description` (régénération). Le format HTML complet reste stocké en base pour compatibilité Outlook ; seule l'édition dans le textarea est propre.
- **Selects, inputs et textarea harmonisés** : tous à `height: 44 px` (au lieu de 36) avec `border-radius: 16 px` — match avec les combobox.
- **Cartes description** : padding 10 × 12 → **12 × 14 px**, border-radius 14 → **16 px**, `gap: 8px`.
- **Eyebrow « CANDIDAT 1/2 »** : transformé en pill accent (fond teinté + border accent 25 %) au lieu du simple texte gris, cohérent avec les badges v30.
- **Textarea description** : `min-height: 90 px`, `line-height: 1.55`, `padding: 10 × 12 px` → lecture confortable.
- **Bouton Régénérer** : `font-weight: 600`, hauteur 28 px, padding 12 px.
- **Avatar destinataire** : 40 → **44 px** avec font 15 px pour matcher la nouvelle hauteur des champs.
- **Grille candidats** : gap 10 → **14 px**.

### Aucun changement backend
Purement CSS + strip HTML côté front.

## [30.15] — 2026-04-24 · Push popup · IA déclenchée d'office + hints visibles immédiatement

Toutes les fonctionnalités introduites en 30.10-30.14 étaient codées mais **invisibles au premier coup d'œil** parce que l'IA n'était déclenchée que si une catégorie était pré-sélectionnée, ce qui n'est jamais le cas sur un prospect neuf. Résultat : modale vide en apparence, pas de pill %, pas de carte description — l'impression que rien n'a changé. Cette version rend le travail visible dès l'ouverture.

### Changements
- **`open()`** : `loadAISuggestions()` appelée **inconditionnellement** (même sans catégorie sélectionnée). L'endpoint `/api/prospect/<id>/best-candidates` sait scorer sur les tags/notes/fonction du prospect sans catégorie, on utilise donc cette info directement.
- **Hint « Top IA »** dans le label des boutons combobox : tant qu'aucun candidat n'est sélectionné, le bouton affiche `[🤖 TOP IA] <Nom du meilleur> <87%>` pour montrer immédiatement le travail de l'IA. Slot 1 affiche le premier meilleur, slot 2 le deuxième.
- **Carte description empty-state** : avant toute sélection, une carte en pointillé accent s'affiche sous les combobox avec le texte « 🤖 **Présentation IA par candidat** — Sélectionne un candidat ci-dessus pour afficher sa présentation courte. Si un dossier de compétences est disponible, un bouton *Générer IA* analyse le PDF et produit automatiquement 3-4 lignes prêtes à coller dans le mail. ». Cela explique le comportement à venir sans qu'il faille cliquer.
- **Textarea même sans DC** : pour les candidats sans dossier de compétences, on affiche quand même le textarea (éditable manuellement) avec l'empty-message en amont (auparavant on n'affichait que le message).
- **Styles** : `.v30pm-candcard--hint` (carte en pointillé accent), `.v30pm-combo__hint` (pill « TOP IA » dans le label), `.v30pm-combo__pct--label` (variante compacte du pill %).

### Aucun changement backend
Tout était déjà branché. La fix est purement orchestration frontend : déclencher l'IA plus tôt et remplir l'UI à vide.

## [30.14] — 2026-04-24 · Push popup · arrondi dropdown + score % + description IA par candidat

Trois améliorations suite au retour utilisateur sur la popup push :

### 1. Dropdown plus arrondi et plus visible
- `.v30pm-combo__btn` : `border-radius` 12 → **16 px**, hauteur 40 → **44 px**, padding 12 → 14 px, hover avec background légèrement teinté.
- `.v30pm-combo__panel` : `border-radius` 12 → **18 px**, ombre renforcée (`0 20px 50px -14px rgba(0,0,0,.35)` + halo accent 8%), border accent 25% (au lieu de border-strong).
- `.v30pm-combo__opt` : `border-radius` 8 → **12 px**, padding 9 × 12 px (au lieu de 8 × 10).
- `.v30pm-combo.is-open .v30pm-combo__btn` : halo focus `4 px accent 14%` (plus marqué).

### 2. Pourcentage de pertinence IA sur chaque suggestion
- `STATE.aiSuggestions` stocke désormais `[{id, pct}]` au lieu d'`[id]` (utilise `relevance_pct` retourné par `/api/prospect/<id>/best-candidates`).
- Chaque option du groupe « Suggérés par l'IA » affiche une **pill accent avec le %** (ex. `87 %`) via la classe `.v30pm-combo__pct`.
- `buildComboPanelHTML::row()` accepte maintenant un paramètre `pct` et rend la pill si `> 0`.

### 3. Description IA par candidat (restauration du flow v29)
Sous les 2 combobox, affichage de **cartes description** (`.v30pm-candcard`) qui apparaissent dès qu'un candidat est sélectionné :
- **En-tête** : « Candidat 1 » (eyebrow) + nom · rôle + bouton « Générer IA » ou « Régénérer ».
- **Textarea** pré-remplie avec `candidate.description_push` existant (analyse précédente) ou vide.
- **Auto-save** sur `blur` → `POST /api/candidates/<id>/save-description`.
- **Bouton Régénérer** → `POST /api/candidates/<id>/generate-description` (endpoint v29 existant qui analyse le PDF DC via Ollama). Statut inline (« Analyse du DC… » → « Description IA générée ✓ »).
- **Candidats sans DC** : carte en pointillé avec message « Ce candidat n'a pas de dossier de compétences — impossible de générer automatiquement. » (pas de bouton Régénérer).
- Cache local `STATE.candDescCache` pour ne pas perdre les éditions entre re-render.

### Changements
- **`static/css/v30/push-modal.css`** : arrondi combobox + ombre panel + `.v30pm-combo__pct` (pill accent %) + `.v30pm-candcard*` (cartes description avec textarea, bouton régénérer, statut, état sans DC).
- **`static/js/v30/push-modal.js`** :
  - `buildComboPanelHTML::row()` signature `(c, slot, extraCls, pct)` + rendu pill %.
  - `loadAISuggestions()` stocke `{id, pct}` (lit `relevance_pct`).
  - HTML modale : ajout de `<div class="v30pm-candcards" data-v30pm-candcards>` sous la grille combobox.
  - Nouveaux helpers : `cachedDesc()`, `setCachedDesc()`, `renderCandCards()`, `setDescStatus()`, `regenerateCandDesc()`, `saveCandDesc()`.
  - `selectCandidate()` appelle `renderCandCards()`.
  - `bindModalEvents()` : nouveau handler click pour `[data-v30pm-regen]`, nouveau listener `blur` (en capture) pour auto-save des textarea.
  - `open()` reset `STATE.candDescCache = {}` + vide le conteneur `[data-v30pm-candcards]`.

### Aucun changement backend
Les endpoints `/api/candidates/<id>/generate-description` et `/api/candidates/<id>/save-description` existent en v29 et v30 sans modification. Le champ `relevance_pct` est déjà retourné par `/api/prospect/<id>/best-candidates`.

## [30.13] — 2026-04-24 · Push popup · custom combobox + optgroups DC + IA 2 passes

Refonte de la section Contexte de la popup push :
- **Bloc Consultants supprimé** de l'UI (il n'y avait qu'Antoine dans `/api/users/for-push` → inutile comme dropdown). Le `current_user_id` est chargé silencieusement et envoyé comme `consultant1_id` à `/api/push-logs/add`.
- **Combobox custom** (remplace `<select>` natifs) : bouton déclencheur stylisé 40 px avec le nom + rôle + pill DC du candidat sélectionné, panel déroulant avec ombrage portée et optgroups.
- **Optgroups** : « Suggérés par l'IA » (inséré après la 2ᵉ passe serveur) en tête, puis « ✓ DC présent » (candidats avec dossier de compétences), puis « Sans DC ». Chaque candidat affiche son nom + rôle + pill DC (icône check verte / croix grise).
- **Chargement en 2 passes** :
  1. Immédiat : `/api/candidates` → tous les candidats avec flag `has_dc`, groupés DC+/DC− dans le combobox.
  2. Différé (ou au changement de catégorie) : `/api/prospect/<id>/best-candidates?push_category_id=X` → scoring serveur par tags/notes/catégorie. Les 5 meilleurs sont insérés en tête comme « Suggérés par l'IA ».
- **Barre IA contextuelle** au-dessus des candidats avec le message « L'IA analyse <Prospect> pour la catégorie « <X> »… » + chrono mono. Masquée après 2,4 s.
- **État vide initial** : les 2 combobox affichent « — Choisir un candidat — » (plus de pré-sélection automatique des `category_default_candidates`, l'utilisateur choisit explicitement).
- Clic hors du combobox, clic sur une option ou Escape ferment le panel.

### Changements
- **`static/js/v30/push-modal.js`** :
  - `ensureModal()` : bloc Consultants retiré, bloc Candidats remplacé par 2 `.v30pm-combo`, barre IA ajoutée en amont.
  - Nouveaux helpers : `findCandidate()`, `renderComboLabel()`, `buildComboPanelHTML()`, `renderCombos()`, `openCombo()`, `closeCombos()`, `selectCandidate()`, `showIABar()/hideIABar()`.
  - `loadBestCandidates()` + `reloadBestCandidates()` + `loadUsers()` **remplacés** par `loadAllCandidates()`, `loadAISuggestions(catId)`, `loadCurrentUser()`.
  - `selectedValuesMulti()` : lit `STATE.selectedCand[1|2]` + `STATE.currentUserId` au lieu du DOM.
  - `bindModalEvents()` : gère les clics combobox (button + option), ferme sur clic extérieur + Escape, déclenche `loadAISuggestions()` au changement de catégorie.
- **`static/css/v30/push-modal.css`** :
  - `.v30pm-ia-bar` + `.v30pm-ia-bar__msg/stats` (barre contextuelle avec pulse)
  - `.v30pm-combo`, `.v30pm-combo__btn` (40 px, radius 12 px, focus ring accent)
  - `.v30pm-combo__panel` (dropdown avec shadow portée)
  - `.v30pm-combo__group`/`__group-label` (optgroups avec séparateurs)
  - `.v30pm-combo__opt[.is-ai]` (option avec fond légèrement teinté pour les suggérés IA)
  - `.v30pm-combo__dc[.--ok/.--ko]` (pill vert/gris pour DC présent/absent)

## [30.12] — 2026-04-24 · Push popup · fix URL endpoint prospect timeline

Bug critique introduit en 30.10 : la popup appelait `/api/prospect/<id>/timeline` (URL path) alors que l'endpoint réel est `/api/prospect/timeline?id=<id>` (query param). Résultat : le `fetch` renvoyait 404, le `.then` ne s'exécutait jamais, rien ne se chargeait (prospect, catégories, candidats, consultants, templates) — la popup restait bloquée sur les skeletons.

### Changements
- **`static/js/v30/push-modal.js::getProspectInfo`** — URL corrigée en `/api/prospect/timeline?id=<pid>`. L'endpoint renvoie `{ok, prospect: {...+company_groupe, company_site joined}, events}`. Je synthétise un objet `company` à partir des champs aplatis (`company_id`, `company_groupe`, `company_site`) pour garder la compatibilité avec le reste du module (`buildAIPrompt`, `renderProspectInfo`, `send()`).

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
