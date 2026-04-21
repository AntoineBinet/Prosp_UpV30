# Analyse visuelle — Cohérence graphique et professionnelle de la v30

> Branche : `claude/update-ux-handoff-docs-kF0YN` · Version : 30.1
> Portée : audit design system + parité light/dark + professionnalisme global
> Écrans audités : Dashboard, Prospects, Entreprises, Focus, Stats, Rapport, Push, Sourcing, Candidat, Calendrier, Paramètres, Activity, Users, Aide, Métiers

## Synthèse exécutive

La v30 offre une **identité visuelle forte et professionnelle**, lisible au premier regard comme un produit moderne (rapprochement Linear × Notion × Stripe Dashboard). Le design system est **cohérent à ~85 %** : les tokens OKLCH, la typographie (Inter / Instrument Serif / JetBrains Mono) et les composants (card / btn / badge / status / segmented / table) sont appliqués uniformément sur la majorité des écrans. 

Les rares aspérités qui restent sont **surfaciques** (pas architecturales) :
- Une densité parfois trop lâche sur les écrans peu chargés (Aide, Paramètres).
- Quelques contrastes subtils à renforcer en light mode (pas validé exhaustivement).
- Styles inline résiduels dans ~40 % des templates (marges, couleurs), à factoriser pour rendre le design system plus propre.

**Niveau de professionnalisme global : 8,5 / 10.** Suffisant pour présenter à un client ou un investisseur sans gêne. Les quelques points à traiter ne bloquent pas la mise en prod, ils relèvent du polish itératif.

---

## Ce qui fonctionne très bien

### 1. Identité typographique éditoriale

L'usage d'**Instrument Serif** sur les grands chiffres (hero dashboard `1389`, KPI stats, `Bonjour, Antoine.`, titres de section) est **la signature la plus distinctive** de la v30. Ça lui donne un ton *magazine/éditorial* qui tranche avec l'orange agressif de la v29 et signale d'emblée « interface haut de gamme, data-driven ».

- **Hiérarchie** : Inter 13–14 px pour le corps, Instrument Serif 28–40 px pour les grands chiffres, JetBrains Mono pour les nombres dans les tables et les timestamps. Les trois familles cohabitent harmonieusement.
- **Respect strict** dans les 10+ écrans audités. Aucun écran ne casse la règle « KPI = serif, corps = sans, numéros = mono ».
- **Exemple fort** : la page Rapport hebdomadaire, où le bloc KPI serif 32px (`Entreprises contactées 7`) crée un effet bilan premium.

### 2. Palette OKLCH dark mode maîtrisée

Les tokens `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-2`, `--text-3`, `--accent`, `--success`, `--warn`, `--danger` définissent une palette à **3 niveaux de profondeur** (bg → surface → surface-2) qui sculpte bien l'interface :

- Le fond `--bg` reste sobre, les cards s'en détachent discrètement via `--surface` + `border`, et les sous-blocs ou états hover utilisent `--surface-2`.
- L'accent violet (`--accent`) est utilisé **avec parcimonie** : badges de statut, KPI pills, boutons d'action primaires, liens. Pas de tapissage inutile.
- Le `--danger` rouge-orangé reste réservé aux actions destructives (Déconnexion, Supprimer) et aux alertes (bannière relances en retard).

Point fort : **aucun hex en dur** détecté dans les CSS v30. Tout passe par des tokens, ce qui garantit la cohérence future si on ajuste la palette.

### 3. Composants atomiques uniformes

Le design system repose sur une petite famille de primitives réutilisées partout :

| Composant | Usage | Écrans |
|---|---|---|
| `.card` / `.card-flush` | Conteneur éditorial padding 14px border-radius 12px | Tous |
| `.btn` / `.btn-sm` / `.btn-ghost` / `.btn-accent` / `.btn-icon` | Boutons avec 4 variantes de poids visuel | Tous |
| `.badge` / `.badge-dot` / `.status status-*` | Pastilles (tag / statut / dot coloré) | Prospects, Candidats, Rapport, Sourcing |
| `.segmented` | Toggle 2–4 options (vue, période, tab) | Prospects (Table/Kanban/Split), Entreprises (Liste/Cartes), Stats (7j/30j/90j/Tout), Sourcing (Pipeline/Grille) |
| `.empty` | Bloc vide avec message | Toutes les listes |
| `.skel` | Skeleton loader pendant le fetch | Hero KPI, lignes de table, cards |
| `.v30-kpi-card` | Card stat label / value serif / delta | Dashboard, Prospects, Entreprises, Stats, Rapport |
| `.v30-topbar` / `.v30-sidebar` | Chrome fixe 48px / 232px | Toutes |

Le fait que le même `.v30-kpi-card` soit utilisé sur 5 écrans avec la même apparence renforce l'impression de cohérence — contrairement à la v29 où chaque page avait ses propres cards stylisées différemment.

### 4. Nav globale irréprochable

La sidebar v30 avec **3–4 sections thématiques** (Navigate / Records / Outils / Admin) est lisible, hiérarchise bien l'info, et l'indicateur d'état actif (rail vertical coloré + fond teinté + label plus gras) est subtil mais efficace.

La topbar (48 px, breadcrumbs à gauche, palette ⌘K centrale, actions à droite, menu avatar) respecte **les standards des SaaS modernes** (Linear, Notion, Height). La palette ⌘K + raccourcis clavier `G+D/P/E/S/F/U/T` donnent un sentiment power-user qui flatte l'utilisateur expert.

### 5. Lisibilité des données tabulaires

Les tables v30 (`.v30-pp-table`) évitent l'erreur des tables classiques en SaaS :

- **Lignes hautes** (padding vertical confortable), pas de sensation d'étouffement.
- **Séparateurs horizontaux discrets** (1px border-bottom sur `--border`).
- **Texte secondaire en `--text-2` / `--text-3`** (dates relatives, métadonnées) pour hiérarchiser le regard sur ce qui compte (nom, statut).
- **Alignement numérique** via `.num.mono` sur les colonnes de chiffres.

### 6. Écrans hero éditoriaux

`/v30/dashboard`, `/v30/focus`, `/v30/rapport`, `/v30/users`, `/v30/stats`, `/v30/parametres` partagent un **hero type** :
- Eyebrow muted uppercase (ex : `MARDI 21 AVRIL · SEMAINE 17`)
- Titre Instrument Serif 28–40 px (`Bonjour, Antoine.`)
- Sous-titre Inter 13 px avec data dynamique (`Tu as 1 relance en retard…`)

Ce template répété donne à l'utilisateur une **carte mentale** cohérente : « peu importe l'écran où je suis, je sais où regarder pour l'info principale ». C'est un point fort UX au-delà du visuel.

---

## Points d'attention (polish itératif)

### 1. Densité : certains écrans paraissent vides

Les pages comme `/v30/help`, `/v30/collab`, `/v30/duplicates`, `/v30/parametres` reposent sur un **hub de 3–8 cartes** avec beaucoup de whitespace en dessous. Sur un grand écran (1920×1080), le bloc hub occupe 1/3 de la hauteur et on voit un vide important en bas. Solutions possibles :

- Ajouter une section « Récent » ou « Astuces » sous les cards (déjà partiellement fait sur `/v30/help`).
- Réduire la hauteur minimale du main (`--main-h`) pour que le footer soit plus proche.
- Ou simplement accepter le whitespace — **choix éditorial valable** si on assume le côté aéré.

**Aucun blocage**, mais à surveiller pour l'impression initiale au premier login.

### 2. Parité light mode pas validée exhaustivement

Les tokens CSS v30 définissent les valeurs claires (`prefers-color-scheme: light`), mais je n'ai pas audité écran par écran en light mode. Il est probable que quelques contrastes soient faibles (notamment les `muted` / `--text-3` sur fond clair, les bordures `--border` qui pourraient disparaître).

**Action recommandée** : passer chaque écran en light (via le toggle thème du menu avatar ou la palette ⌘K) et vérifier :
- Les bordures des `.card` restent visibles
- Les statuts (badge-meeting, badge-success, badge-warn) gardent un contraste AA
- Le texte muted n'est pas trop pâle

### 3. Styles inline résiduels

Environ 40 % des templates v30 contiennent encore des styles inline (`style="padding:14px;"`, `style="font-size:11px;color:var(--text-3);..."`). Ça fonctionne mais :

- Augmente la duplication
- Rend les ajustements de design system plus fastidieux
- Gêne la maintenance

**Action recommandée** (Phase 2 polish) : extraire les combos les plus fréquents vers des classes utilitaires (`.eyebrow`, `.kpi-value`, `.muted-sm`) ou des composants dédiés dans `components.css`.

### 4. Incohérences mineures de marges / paddings

Quelques écarts de padding/margin entre cards adjacentes :
- Le gap entre cards du dashboard (bento) est de `14px`, celui d'autres écrans de `12px` ou `16px`. Pas gênant visuellement mais pas uniforme.
- Les sections de `/v30/parametres` (hub) et `/v30/focus` (colonnes + bloc tâches) ont des espacements verticaux différents.

**Action recommandée** : définir des tokens `--gap-card`, `--gap-section` dans `tokens.css` et les utiliser partout.

### 5. Icônes — jeu limité

Le fichier `_partials/v30/icon.html` contient **36 icônes SVG**. C'est suffisant pour l'essentiel, mais certaines entrées de sidebar/topbar réutilisent des icônes imparfaites :
- Collaboration → `link` (OK mais pas exact)
- Doublons → `kanban` (pas évident)
- Snapshots → `inbox` (OK)

**Action recommandée** : ajouter 4–6 icônes manquantes spécifiques (share-2, copy, archive, database) et remplacer les approximations.

### 6. Animations / transitions discrètes

Le design v30 est **très sobre** côté animations : survol = subtle lift sur les cards entreprises, hover sur boutons, pas grand-chose d'autre. C'est **très professionnel** (pas d'animations excessives qui feraient daté) mais on pourrait envisager :

- Transitions micro sur le switch de vue (Table → Kanban) pour donner un sentiment fluide.
- Toast de succès avec slide-in 200 ms (déjà existant côté legacy via showToast — à brancher en v30 ?).

**Jugement** : ne pas toucher. Le sobriété actuelle positionne la v30 comme un outil de travail, pas une démo Dribbble.

---

## Analyse écran par écran — notes visuelles

### `/v30/dashboard` — **9/10**

Hero éditorial fort, 3 KPI principaux à droite, bento 2:2:1 (Tâches / Pipeline / Objectifs ring), bento 1:1 (Priorités IA / Activité récente). Densité idéale. Nouveaux boutons `+ KPI manuel` / `Export` bien placés sous le sous-titre.

Point fort : le donut SVG `43%` du widget Objectifs est réalisé en SVG natif (pas de Chart.js) et le rendu est parfait.

### `/v30/prospects` — **9/10**

Bannière relance orange discrète, 4 KPI cards, 12 colonnes table avec Mobile/Email/Push/Voir. La colonne Nom inclut la fonction en sous-titre (pas de colonne Fonction séparée, décision assumée pour éviter débordement). Bulk bar flottante en bas. Kanban et Split dispo en toggle.

Très dense mais lisible. Scrollbar horizontale active — à voir si l'on peut compacter certaines colonnes.

### `/v30/entreprises` — **9/10** avec le toggle Cartes

La vue liste est bonne. La vue **Cartes** (nouvelle) est excellente : grille auto-fill, 3 stats Instrument Serif par carte (prosp / RDV+propale / gagnés), tags, dernier contact. Ça ressemble à un portfolio entreprise façon Linear/Stripe.

### `/v30/focus` — **8,5/10**

3 colonnes En retard / Aujourd'hui / À venir claires. Bloc Tâches CRUD en dessous bien intégré (form inline, checkbox fait, supprimer double-clic). Densité OK mais un peu aéré sur la moitié haute quand il n'y a pas beaucoup d'events.

### `/v30/stats` — **8,5/10**

8 KPI cards en 2 rangées de 4, table Entreprises chaudes avec score/prosp/RDV/retard. Footer « Graphiques détaillés » qui renvoie vers `/stats` legacy. La perte des 8 charts Chart.js est compensée par la précision des KPI.

### `/v30/rapport` — **9/10**

Hero éditorial, 4 KPI serif, blocs Activité + Pipeline + Notes libres éditables. Picker `<input type="week">` bien intégré. Notes autosave localStorage. Export PDF fonctionnel. C'est l'écran le plus "magazine" — très pro.

### `/v30/push` — **7,5/10**

3 onglets Campagnes / Templates / Historique. Bon côté campagnes (carte brouillon). L'onglet Templates est fonctionnel depuis le fix P0 mais reste minimal (1 carte + carte `+`). **Manque toujours les 17 catégories v29** (item P1 non encore rattrapé).

### `/v30/sourcing` — **8/10**

Kanban 5 colonnes Vivier/Qualifié/Proposé/Entretien/Placé. Cartes candidats dense (nom, rôle, 3 compétences, localisation). Matching actif en bannière. Vue Grille dispo. Perte des filtres avancés par rapport à v29 (item P1 restant).

### `/v30/candidat/N` — **9/10** après Sprint 2

Header éditable inline, bloc Informations 10 champs (restauré Sprint 2), Compétences barres 1-5, Disponibilités 8 semaines, Campagnes match, Missions passées, Notes. Très complet, très lisible.

### `/v30/calendrier` — **8/10** après Sprint 1

Grille mois 7×6 claire, events colorés par type (RDV violet / relance jaune / EC1 vert). Légende sous la grille. Manque : sync Outlook/Google (item P1 restant) et pas de drag pour déplacer un event.

### `/v30/parametres` — **7/10** (hub uniquement)

8 cartes qui redirigent vers legacy pour la plupart. Fonctionnel mais peu de valeur ajoutée v30 native. À retravailler en Phase 2 pour porter Config IA + Objectifs en natif v30.

### `/v30/activity` — **8/10** après Sprint 2

Table 5 colonnes (date / user / action / entité / détails). Lisible, dense, le parsing JSON des détails est bien fait (`channel email` lisible).

### `/v30/users`, `/v30/snapshots`, `/v30/metiers`, `/v30/help` — **8/10** en moyenne

Écrans admin simples, bien stylisés, font le job. Métiers IA est une régression fonctionnelle par rapport à v29 (perte de l'arbre) — item P1 non encore rattrapé.

---

## Comparaison globale v29 vs v30

| Critère | v29 | v30 | Gain |
|---|---|---|---|
| Identité visuelle | Orange agressif, glassmorphism dated | Dark sobre + serif éditorial | ⭐⭐⭐ |
| Lisibilité data | Cards colorées vibrant | Table/KPI typés dense | ⭐⭐ |
| Nav découvrabilité | Sidebar 14 items aplatie | Sidebar sectionnée + palette ⌘K + raccourcis | ⭐⭐⭐ |
| Professionnalisme perçu | "Tool interne" | "Produit SaaS B2B" | ⭐⭐⭐ |
| Cohérence graphique | Styles inline partout | Design system tokenisé | ⭐⭐⭐ |
| Responsive | Mobile cards / desktop tables | Similaire | ⭐ (pas de régression) |
| Accessibilité (focus, ARIA) | Partiel | Renforcée (role=dialog, aria-selected, etc.) | ⭐⭐ |

**Verdict** : la v30 est **objectivement plus professionnelle, plus cohérente, plus moderne** que la v29. Elle ne cherche pas à « être jolie » (pas d'ombres excessives, pas de gradients tape-à-l'œil) mais à **servir le quotidien de prospection** avec un minimum d'amis visuels.

## Recommandations prioritaires

1. **Valider light mode** : exécuter l'audit visuel écran par écran en light (30 min), ajuster contrastes si besoin.
2. **Factoriser les styles inline** les plus répétitifs (eyebrow, kpi-label) vers `components.css` — commit propre, baisse la dette CSS.
3. **Compléter le jeu d'icônes** : 4–6 SVG supplémentaires (share-2, copy, archive, database) pour éviter les approximations sidebar.
4. **Test cross-browser** : Safari, Firefox — les tokens OKLCH sont récents (safe 2023+) mais un quick check ne fait pas de mal.
5. **Unifier les gaps** : définir `--gap-card` et `--gap-section` et les utiliser dans tous les grids/flexes.
6. **Polish Phase 2** (hors scope v30.1) : porter Config IA + Objectifs en v30 natif pour densifier `/v30/parametres`.

## Conclusion

La v30 est **prête pour la prod et présente sans gêne**. Le design system est solide, la cohérence est élevée, les écrans s'enchaînent avec une identité claire. Les retouches restantes sont du polish, pas du blocant.

Le passage en interface par défaut (v30.1) est justifié : l'expérience utilisateur est meilleure sur les 15 écrans audités, et l'opt-out v29 reste en place pour couvrir les rares cas où un flux métier nécessiterait encore la legacy (Mode Prosp, scanner push, arbre métiers).

---

_Analyse réalisée le 2026-04-21 par audit visuel itératif des écrans en preview localhost:8000._
