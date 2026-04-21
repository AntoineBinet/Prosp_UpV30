# ProspUp v30 — Refonte UX/UI
## Spec technique & fonctionnelle pour Claude Code

**Version** : 1.0 — Avril 2026
**Portée** : refonte ambitieuse desktop, nouveau design system, 10 écrans prioritaires
**Base de code** : `AntoineBinet/Prosp_UpV25` (Flask + Jinja2 + Vanilla JS)
**Contrainte** : rétrocompatibilité mobile non cassée. Les contrats API et la DB restent identiques.

---

## 1. Direction de design

### 1.1 Principes
1. **Dense mais respirant** — inspiré de Linear/Attio : beaucoup d'info par écran, hiérarchie par typographie et micro-contrastes, pas par bulles colorées.
2. **Type-forward** — la typographie porte la hiérarchie. Titres éditoriaux (Instrument Serif) sur les grands nombres du dashboard ; UI en Inter 12.5–13px, weight 400–600.
3. **Action hover-revealed** — les actions secondaires (edit, archive, dupliquer, pousser) n'apparaissent qu'au survol de la ligne/carte pour alléger l'écran au repos.
4. **Bordures > ombres** — 1px borders comme séparateurs. Les ombres sont réservées aux popovers.
5. **Feedback systématique** — toutes les actions produisent : optimistic update → confirm state (checkmark inline 1.2s) → toast uniquement en cas d'erreur ou d'action bulk.
6. **Keyboard-first** — tout est accessible au clavier. Command palette `⌘K` partout.
7. **Originalité** : ce design est propre à ProspUp (palette, composants, patterns). Ne cloner aucune UI existante de marques concurrentes.

### 1.2 Tokens — voir `design-system/tokens.css`
- Typo : **Inter** (UI) + **Instrument Serif** (grands chiffres éditoriaux)
- Accent indigo calme `oklch(0.58 0.17 258)`
- Signal : success (155), warn (75), danger (25) — tous lightness 0.58–0.74
- Dark mode par attribut `data-theme="dark"` sur `<html>`, persisté en localStorage

### 1.3 Composants — voir `design-system/components.css`
`.btn` (primary/accent/ghost/danger) · `.input` · `.select` · `.card` · `.badge` · `.status` (pills pipeline) · `.avatar` · `.table` · `.segmented` · `.tabs` · `.kbd` · `.skel`

---

## 2. Navigation globale

### 2.1 Structure
**Topbar fixe 48px** contenant :
- **Left** : logo (20px) + nom `Prosp'Up` / breadcrumb contextuel (ex. `Entreprises › Capgemini`).
- **Center** : champ de recherche `⌘K` (pas un vrai input — un bouton qui ouvre la palette).
- **Right** : Créer (`+` → menu prospect/entreprise/candidat, raccourci `C`), notifications, avatar → user menu.

**Sidebar 232px** (collapsible à 56px via `[` ou bouton pin) :
- Section **Navigate** : Dashboard, Focus, Calendrier, Push, Stats, Rapport
- Section **Records** : Prospects, Entreprises, Candidats
- Section **Workspace** : badges de compteurs à droite (relances du jour, candidats actifs, etc.)
- Pin d'un record (ex. "Capgemini") en bas → favoris
- Footer : sélecteur de workspace (si multi-user) + paramètres

### 2.2 Command palette `⌘K`
Overlay plein écran, largeur 640px, centré.
- **Recherche unifiée** : prospects / entreprises / candidats / pages / actions
- **Sections** (avec icônes à gauche) :
  - Actions rapides (`Créer prospect`, `Créer entreprise`, `Basculer thème`, `Lancer Mode Prosp`…)
  - Aller à… (toutes les pages de l'app)
  - Résultats (fuzzy search sur la DB)
- Raccourcis affichés à droite : `↵`, `⌘↵` (ouvre dans nouvel onglet logique), `⌘C` (copier nom)
- Navigation ↑↓, `Esc` pour fermer

### 2.3 Raccourcis globaux
| Touche | Action |
|--------|--------|
| `⌘K` ou `/` | Command palette |
| `G` puis `D` | Goto Dashboard |
| `G` puis `P` | Goto Prospects |
| `G` puis `E` | Goto Entreprises |
| `G` puis `F` | Goto Focus |
| `G` puis `S` | Goto Sourcing |
| `C` | Créer (menu) |
| `[` | Toggle sidebar |
| `?` | Afficher raccourcis |
| `⌘B` | Focus mode (cacher sidebar) |
| `J / K` | Nav ligne suivante/précédente (tables) |
| `X` | Sélectionner ligne (table) |
| `E` | Éditer ligne sélectionnée |

---

## 3. Page-by-page

### 3.1 Login
**Objectif** : enlever le style glass sombre actuel, recentrer sur un login pro à un seul champ par ligne.
- **Layout** : split 60/40. Gauche = formulaire centré vertical. Droite = fond neutre avec bloc éditorial (citation + stats clients) ou image placeholder neutre (rayure monospace si aucune asset).
- **Form** : label au-dessus, input 36px, bouton accent full-width, lien "mot de passe oublié" discret en dessous.
- **Version** : badge en bas `v30.0 · MAJ auto`.

### 3.2 Dashboard v3
**Gamification gardée et valorisée** : métriques XP en hero + ring de progression objectifs.

**Structure (3 rows)** :
1. **Hero (row 1)** — bandeau 160px
   - Gauche : salut `Bonjour, Antoine.` (Inter 28px 500) + sous-titre date (13px muted)
   - Milieu : grands chiffres Instrument Serif — *4 KPI principaux* (RDV sem, Push, Contacts, RDV pipés) avec delta vs sem-1 en petit en dessous
   - Droite : **Streak card** compacte — flamme `7 jours` + XP `+240 pts aujourd'hui` + bouton `+ KPI manuel`
2. **Row 2 — Bento 3 colonnes (ratio 2:2:1)**
   - **Action center (col 1)** : tabs `À faire (12) · RDV aujourd'hui (3) · En retard (4)`. Liste dense avec avatar, nom prospect, entreprise, date/statut, action rapide (→) au hover. Cliquer une ligne ouvre fiche en peek (side panel).
   - **Pipeline (col 2)** : funnel horizontal 5 étapes (Prospecter → Contacté → RDV → Proposition → Gagné). Chaque segment = barre avec nombre + €. Cliquer filtre vers Prospects.
   - **Objectifs (col 3)** : 3 rings concentriques SVG (jour/semaine/mois). Au centre du ring principal : `73%` en Instrument Serif 36px. Sous le ring : liste `Push · 8/10`, `RDV · 3/4`, `Contacts · 22/30`.
3. **Row 3 — Insights (bento 2 colonnes)**
   - **Priorités IA** : top 5 prospects à pousser aujourd'hui (nom + raison 1 phrase générée + chip urgence + bouton `Ouvrir`)
   - **Activité récente** : feed timeline verticale (event · prospect · il y a X · user) — 30 derniers events

**Suppressions vs v2** :
- Heatmap (doublon avec feed)
- Bannière relance (intégrée dans Action Center)
- "Top pushés" (déplacé dans Stats)
- Section "Statistiques" 4 charts (déplacée dans Stats)

**Micro-interactions** :
- Au chargement : numbers animent de 0 → valeur sur 600ms ease-out
- Hover ring objectif : tooltip avec breakdown
- Clic segment pipeline : transition vers /prospects?status=X
- Streak : shake horizontal si échec du jour

---

### 3.3 Prospects (table principale)
**3 vues switchables via segmented control** en haut :
`Table · Kanban · Split`

#### Topbar de page (sticky, 56px, sous topbar globale)
- Left : titre `Prospects` + compteur `1 247` muted
- Center : barre de filtres pills : `Tous (1247) · Mes prospects (318) · À relancer (42) · Hot (15)`. Un `+` pour créer une vue custom sauvegardée.
- Right : `🔍` input inline fuzzy · `Filtres ▾` (popover) · `Colonnes ⚙` · `+ Ajouter ▾` (menu : manuel, import Excel, depuis entreprise)

#### Bulk bar
Apparaît en bas quand ≥1 ligne sélectionnée — barre flottante 48px centrée, 680px, blur backdrop, actions : `Pousser · Email IA · Tel IA · Tag · Assigner · Archiver · Supprimer` + compteur `12 sélectionnés` + `✕`.

#### Vue Table
- **Densité** : 32px de ligne (dense default), toggle confort 40px.
- **Colonnes par défaut** (8, pas 13) : `☐ · Nom · Entreprise · Statut · Pertinence · Dernière action · Prochain RDV · Tags` — autres disponibles via `Colonnes ⚙`.
- **Colonne Nom** : avatar 24px + nom 13px semibold + fonction 11.5px muted en dessous (2 lignes).
- **Statut** : `.status` pill.
- **Pertinence** : 5 barres (style bars/wifi), ★★★☆☆.
- **Tags** : overflow avec `+2`.
- **Actions au hover** sur la ligne : row-end, icônes ghost 14px : `👁 ouvrir` · `✉ pousser` · `📞 appeler` · `⋯ plus`.
- **Header sortable** : flèche sort, `⌘` pour multi-sort. Resizable columns.
- **Navigation clavier** : J/K ligne, X select, E édit inline, Enter ouvre fiche.

#### Vue Kanban
- 5 colonnes = statuts pipeline. Chaque colonne : header avec nom + count + `+` inline pour créer.
- Cartes 240px : nom + entreprise + tag + échéance + avatar owner en bas à droite. Drag & drop entre colonnes.
- Scroll horizontal si >5 statuts.

#### Vue Split
- 40/60 : liste compacte à gauche (pas d'avatar, juste nom/entreprise/pill statut à droite), fiche preview à droite.
- Clic ligne = charge fiche à droite sans navigation (URL update avec query).
- Fiche droite = version "peek" de la fiche prospect (voir 3.4).

---

### 3.4 Fiche Prospect
**Layout** : 2 colonnes `1fr 360px` sur desktop >1200px, sinon 1 colonne.

**Header de fiche (sticky top)** :
- Avatar 44px + nom 22px 500 (éditable inline) + fonction 13px muted
- Ligne meta : entreprise (lien) · email · tél · LinkedIn (chips cliquables avec icône)
- Actions à droite : `✉ Pousser` (primary) · `📞 Appeler` · `📅 Planifier` · `⋯`
- Status pill + pertinence + dernière activité (il y a X)

**Colonne gauche (main)** — tabs :
- **Aperçu** (défaut) : sections "Notes rapides" (markdown inline, 2 lignes visibles), "Activité" (timeline verticale des events — push, RDV, note, changement de statut)
- **Timeline** : événements complets avec filtres
- **Push** : historique des pushs envoyés à ce prospect (cartes compactes)
- **Fichiers** : pièces jointes, dossier compétence
- **IA** : historique des analyses IA (scrapping, compte-rendu RDV, prépa)

**Colonne droite (aside, sticky)** — cards compactes empilées :
- **Détails** : tous les champs éditables en place (click-to-edit)
- **Candidats recommandés** (3 max) : matching selon compétences push
- **Entreprise** : card résumée avec opportunités en cours
- **Tags** + système d'ajout inline
- **Danger zone** collapsed : archiver, supprimer

**Micro-interactions** :
- Tous les champs edit-in-place (click → input → Enter save, Esc cancel)
- Save inline : checkmark vert 1.2s à côté du champ
- Actions IA : ouvrir un panneau de droite (drawer 480px) plutôt qu'une modale centrée

---

### 3.5 Entreprises
Identique en pattern à Prospects mais :
- Colonnes par défaut : `Nom · Secteur · Effectif · Prospects (lien count) · Opportunités · Dernier contact`
- Pas de Kanban (pipeline non pertinent) — juste Table + Split
- Fiche entreprise : logo (square 44px) + nom + site web, onglets `Aperçu · Prospects (12) · Opportunités (3) · Événements · Notes`

---

### 3.6 Push (refonte complète du flux)
**Problème actuel** : tabs Catégories/Historique mal hiérarchisés. Flux "créer un push" peu clair.

**Nouvelle structure à 3 sections via segmented** :
`Campagnes · Templates · Historique`

#### Campagnes (nouveau concept)
- Liste des campagnes actives : nom, catégorie, nb destinataires, sent/opened/replied, date. Card horizontale 80px.
- Bouton `+ Nouvelle campagne` → wizard 3 étapes :
  1. **Cible** : sélection catégorie + filtres + preview liste prospects
  2. **Message** : choix template (dropdown) OU composer + variables + preview par prospect
  3. **Envoi** : scheduler immédiat/programmé + checklist ("Email valide", "Pas de doublon", "Consentement")

#### Templates (ex "Catégories + Templates texte")
- Grille 3 colonnes de cartes : nom, preview 3 lignes, tags de matching, stats (`used 47 times · avg open 34%`)
- Clic ouvre éditeur 2-pane (liste à gauche, éditeur à droite — variables, sujet, body, body LinkedIn)
- Bouton `+ Nouveau template`

#### Historique
- Timeline verticale groupée par jour : chaque entrée = prospect + sujet + canal + status icon. Hover reveal `voir le message`.
- Filtres : canal, période, campagne, prospect

---

### 3.7 Sourcing / Candidats
**Problème actuel** : matching confus, pas de pipeline visuel.

**Nouvelle vue : Pipeline de sourcing** (kanban par défaut)
- 5 colonnes : `Vivier · Qualifié · Proposé · En entretien · Placé`
- Cartes candidats : avatar + nom + métier principal + tags compétences top-3 + star rating + badge "correspond à X push(s)"

**Vue alternative Grille** : grille de cartes 280×200 avec photo, nom, métier, 3 skills, CTA `Voir fiche`, filtres puissants (métier, dispo, TJM, compétences multi-select)

**Barre de matching en haut** : quand on vient d'un push/catégorie, un bandeau sticky `Correspondants pour « Logiciel Embarqué »` avec count et filtres pertinence auto-appliqués.

---

### 3.8 Fiche Candidat
Pattern similaire fiche prospect mais avec sections spécifiques :
- **Compétences** : tags par catégorie, niveau (1–5 bars) éditable
- **Dossier compétence** : bouton "Générer DC" (ouvre dc_generator) avec preview PDF
- **Disponibilité** : calendrier inline 8 semaines avec statut dispo/busy/placé
- **Historique placements** : timeline des missions passées
- **Push correspondants** : liste des campagnes où ce candidat est matché + stats de réponse

---

### 3.9 Stats / Rapport
**Fusionner Stats et Rapport en 1 page** avec 2 tabs :
- **Tableau de bord** : grille 4×2 de charts (pipeline, RDV evo, push/semaine, top entreprises, taux conversion, activité par user, sourcing funnel, revenus prévisionnels)
- **Rapport** : éditeur WYSIWYG de rapport hebdomadaire avec sections générées automatiquement depuis les charts + zone de commentaire + export PDF

**Filtres globaux page** : période (7j/30j/90j/custom), utilisateur (si admin), catégorie push.

---

### 3.10 Navigation mobile (non refaite mais notes)
Conserver bottom nav 5 items + hamburger sidebar. Command palette désactivée sur <900px. Adapter topbar nouvelle à mobile : hamburger + logo + `⌘K` devient loupe.

---

## 4. États, feedback, accessibilité

### 4.1 Toasts
- Position : top-right, 320px, stack vertical, max 3 visibles.
- Types : info (ink), success, warn, danger. Auto-dismiss 3.5s (6s pour danger). Close manuel.
- Pour actions bulk : toast avec progression `12/30 prospects poussés…` puis checkmark.

### 4.2 Loading states
- Pour listes : skeleton ligne (32px) avec shimmer, 8 lignes visibles. Pas de spinner plein écran.
- Pour boutons : spinner 14px inline + label "Envoi…" (pas de remplacement complet du label).
- Pour charts : pulse du container.

### 4.3 Empty states
Pattern cohérent : icône ghost 40px (line only) + titre 14px 600 + sous-titre 13px muted + bouton action primaire.

Ex Prospects : `Aucun prospect pour ces filtres` + `Effacer les filtres` + `Ajouter un prospect`.

### 4.4 Erreurs
- Champ : border danger + message 11px danger sous le champ.
- API fail : toast danger + `Réessayer` inline.
- 404/500 : page dédiée avec bouton retour + status serveur.

### 4.5 Accessibilité
- Focus visible : `outline: 2px solid var(--accent); offset: 1px`.
- Tous les icônes avec `aria-label`.
- Modals : trap focus, Esc ferme, role="dialog" aria-modal="true".
- Contraste : tout >4.5:1. Text-muted limité aux labels et helpers, pas au contenu.

---

## 5. Migration technique (guide Claude Code)

### 5.1 Ordre recommandé
1. **Injecter le design system** : créer `static/css/v30/tokens.css` + `v30/components.css`. Importer AVANT `style.css` dans `base.html`. Activation par flag `?v30=1` en query ou `localStorage.prospup_v30`.
2. **Topbar + sidebar v30** : créer `static/js/sidebar-v30.js`. Render dans `<header>` et `<aside>` existants. Conserver `data-page` pour active state.
3. **Command palette** : nouveau composant `static/js/palette.js`. API : `window.Palette.open()`. Source de données : endpoint nouveau `GET /api/search?q=X` (fuzzy sur prospects+entreprises+candidats).
4. **Dashboard v3** : nouveau template `dashboard_v3.html`, route `/dashboard?v=3`. Réutilise endpoints v2.
5. **Prospects v30** : refactor `templates/index.html` progressivement. Introduire `data-view="table|kanban|split"` et JS qui bascule.
6. **Fiche prospect** : intégrer dans `index.html` (actuellement modale) OU créer route `/prospects/<id>` dédiée pour partage URL.
7. **Push refactor** : nouveau flux `campagnes.html`. Migrer templates existants dans `Templates`. Historique converti en timeline.
8. **Sourcing kanban** : refactor `sourcing.html`.
9. **Stats fusion** : merger `stats.html` + `rapport.html`.
10. **QA + accessibilité + responsive final**.

### 5.2 Compatibilité
- **Pas de framework** : tout en vanilla JS + Web Components légers si besoin (palette). Aucune dépendance npm nouvelle.
- **Chart.js conservé** pour Stats.
- **Endpoints API** : inchangés. Ajouter seulement `/api/search` pour la palette et `/api/views/save` pour vues custom prospects.
- **DB** : ajouter table `saved_views (id, owner_id, page, name, filters_json, columns_json, is_shared)` et table `push_campaigns (id, owner_id, name, category_id, template_id, filters_json, scheduled_at, sent_at, stats_json)`.
- **PWA / Service Worker** : mettre à jour cache manifest avec nouveaux assets.

### 5.3 Flags et rollout
- Flag `V30_UI` côté serveur (en session + localStorage). Bouton dans Paramètres > Affichage pour basculer V29 / V30.
- Période de transition : 2 semaines, feedback via toast `Vous utilisez la nouvelle interface. [Donner un avis] [Revenir à l'ancienne]`.

---

## 6. Checklist livrables Claude Code

- [ ] `static/css/v30/tokens.css` + `v30/components.css` intégrés
- [ ] Topbar + sidebar v30 fonctionnels, role-aware
- [ ] Command palette `⌘K` avec recherche unifiée
- [ ] Raccourcis clavier globaux + modal `?`
- [ ] Dashboard v3 : hero, bento, rings, priorités IA
- [ ] Prospects : 3 vues + bulk bar + colonnes configurables
- [ ] Fiche prospect : edit-in-place + tabs + drawer IA
- [ ] Entreprises : table + fiche dédiée
- [ ] Push : Campagnes/Templates/Historique + wizard 3 étapes
- [ ] Sourcing : kanban + grille + matching par push
- [ ] Fiche candidat : compétences + DC + dispo
- [ ] Stats + Rapport fusionnés
- [ ] Dark/light parité visuelle
- [ ] Toasts, skeletons, empty states cohérents
- [ ] Tests Playwright adaptés (14 specs)
- [ ] Flag V30 + Paramètres > Affichage toggle
