Destinataire Claude Code Opus 4.7 1M. Mission harmoniser le CSS de lapp v30 desktop sur le systme de tokens existant, sans rgression visuelle. Repo AntoineBinetProspUpV30main. Scope staticcssv30 uniquement sauf renommages de classes voir Phase 8. Rfrence canonique staticcssv30tokens.css staticcssv30components.css. Audit source auditfindings.md codes F-01 F-20 cits chaque phase. --- TITLE Plan de rectification visuelle ProspUp v30 desktop

1. Une branche par phase chorev30-designphase-N-slug. Une seule phase par PR.
2. Phases squentielles. La Phase 0 bloque tout. Ne lance pas N1 avant que N soit merg.
3. Avant toute suppression de classe CSS bash grep -rnE classname templates staticjs staticcss grep -v nodemodules Si la classe est utilise hors staticcssv30, fournis un alias cf. 0.4 ne renomme pas en cassant.
4. Avant tout commit lance les tests de non-rgression visuelle 9.
5. Aprs chaque phase excute les checks Definition of Done du 10 pertinents pour la phase

TITLE Plan de rectification visuelle ProspUp v30 desktop - 0. Comment excuter ce plan - Mode opratoire...
Toute valeur visuelle couleur, radius, spacing, shadow, font, duration, easing, line-height doit passer par un token CSS custom property -- dfini dans tokens.css. Si la valeur nexiste pas, ajoute le token dans tokens.css dabord, puis utilise-le. Jamais de hexrgbapx en dur dans une feuille de page. Exceptions tolres et seulement celles-ci - border-radius 999px intention pill claire. - border-radius 50 cercle parfait, ex. avatars. - 1px border width, hairlines. - Couleurs de marques externes documentes Teams, Outlook dans calendar.css isoler dans un bloc root --brand-teams --brand-outlook plutt que en dur inline

TITLE Plan de rectification visuelle ProspUp v30 desktop - 0. Comment excuter ce plan - Rgle dor...
- Ne touche pas staticcssv30tokens.css autrement quen ajoutant des tokens. Ne renomme jamais un token existant dautres CSS sy appuient.
- Ne supprime pas components.css. Tu peux y supprimer du contenu obsolte, mais le fichier reste le hub.
- Ne renomme aucune classe utilise dans des templates Jinja ou du JS sans alias rtro-compat 0.4.
- Ne change pas les classes utilitaires .serif, .muted, .flex, etc. existantes dans components.css elles sont consommes partout.
- Ne touche pas au mobile staticcssmobile-2026 ou similaire cest un autre design system.
- Le dark mode doit rester correct. Chaque token ajout doit avoir son quivalent dark dans le bloc data-themedark ou similaire de tokens.css

TITLE Plan de rectification visuelle ProspUp v30 desktop - 0. Comment excuter ce plan - Garde-fous...
Quand tu remplaces un nom de classe, garde le vieux comme alias dans le mme fichier, marqu deprecated css DEPRECATED alias rtro-compat. supprimer dans 2 sprints. .v30pm-input tous les styles de .v30-push-input Ou plus simplement, en slecteur group css .v30-push-input, .v30pm-input deprecated ...

TITLE Plan de rectification visuelle ProspUp v30 desktop - 0. Comment excuter ce plan - 0.4 Patterns dalias de rtro-compatibilit...
- Titre v30-designphase-N rsum court ex. v30-designphase-2 Pattern .page-header unifi.
- Description liste des findings rsolus F-XX, screenshots avantaprs des pages touches light dark, commande de check qui passe 10.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - 0. Comment excuter ce plan - 0.5 Conventions de PR...
Objectif crer toute linfrastructure de tokens et de patterns pour que les phases 1-8 puissent juste consommer

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 0 Prparation jour BLOQUANT...
Ajoute ces blocs dans root light sans rien supprimer ni renommer css Phase 0 tokens dextension --- Radius combler le palier 12px trs utilis --- --r-card 12px cards ent-card, kpi-card, plein de blocs --- Shadows variantes pour popovers dropdowns --- --shadow-popover 0 4px 16px oklch0 0 0 0.18 --shadow-dropdown 0 12px 28px -10px oklch0 0 0 0.24 --- Page header valeurs canoniques --- --page-header-py var--s-4 padding vertical --page-eyebrow-size 11px --page-title-size 28px --page-title-family var--font-serif --page-title-style italic --page-title-weight 400 --page-title-tracking -0.4px --page-sub-size 13px --- KPI taille canonique variante compacte --- --kpi-value-size 32px --kpi-value-size-sm 22px --kpi-value-size-hero 36px dashboard hero uniquement --kpi-label-size 11px --- Inputs DEUX hauteurs maximum --- --input-h 32px dfaut, partout --input-h-lg 40px modales, formulaires importants --input-radius var--r-md 8px align sur --btn --input-radius-lg var--r-lg 10px pour la variante lg --- Avatar --- --avatar-size-sm 24px --avatar-size 32px canonique --avatar-size-md 36px --avatar-size-lg 44px --avatar-size-xl 52px mode-prosp hero uniquement --avatar-radius 50 --avatar-radius-square var--r-md logos dentreprises --- Brand colors externes calendrier --- --brand-teams oklch0.40 0.18 270 --brand-outlook oklch0.45 0.18 220 Et dans le bloc dark slecteur identique celui qui dfinit les autres tokens dark css --shadow-popover 0 4px 16px oklch0 0 0 0.45 --shadow-dropdown 0 12px 28px -10px oklch0 0 0 0.55 Tous les autres tokens ajouts sont des dimensions non-couleur pas besoin de version dark.

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 0 Prparation jour BLOQUANT - 0.1 tendre tokens.css...
Nouveau fichier vide. Il hbergera les patterns extraits des feuilles de page .page-header, .kpi, .popover, etc. Phases 2, 3, 4, 7. En-tte du fichier css ProspUp v30 patterns.css Patterns transverses page-header, kpi, popover, etc.. Toujours import APRS components.css.

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 0 Prparation jour BLOQUANT - 0.2 Crer staticcssv30patterns.css...
Dans le head du template templatesv30base.html ou quivalent, insrer la balise link aprs celle de components.css html link relstylesheet href urlforstatic, filenamecssv30tokens.css link relstylesheet href urlforstatic, filenamecssv30components.css link relstylesheet href urlforstatic, filenamecssv30patterns.css !-- ... feuilles de pages ensuite ... --

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 0 Prparation jour BLOQUANT - 0.3 Importer dans base.html...
- tokens.css tous les nouveaux tokens prsents, light dark.
- patterns.css cr et vide juste len-tte.
- patterns.css charg dans base.html aprs components.css.
- git diff ne montre aucune suppression, juste des ajouts.
- Lapp charge sans erreur. Aucun changement visuel attendu ce stade.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 0 Prparation jour BLOQUANT - 0.4 Definition of Done Phase 0...
Findings rsolus F-01 inputs, F-02 status pills, F-12 boutons accent, F-15 skeleton

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 1 Dsambiguser les composants doublonns 1-2 jours...
Dcision .v30-input .v30-select .v30-textarea deviennent canoniques height 32px, accord avec --input-h. .input .select .textarea deviennent des alias dans components.css. Dans components.css, remplacer les deux blocs .input et .v30-input par le bloc unique css .v30-input, .v30-select, .v30-textarea, .input, .select, .textarea alias rtro-compat width 100 height var--input-h padding 0 10px background var--surface-2 border 1px solid var--border border-radius var--input-radius color var--text font-family inherit font-size 13px transition border-color var--dur-1 var--ease, background var--dur-1 var--ease, box-shadow var--dur-1 var--ease .v30-textarea, .textarea height auto padding 8px 10px min-height 80px resize vertical .v30-inputfocus-visible, .v30-selectfocus-visible, .v30-textareafocus-visible, .inputfocus-visible, .selectfocus-visible, .textareafocus-visible outline none border-color var--accent box-shadow 0 0 0 3px color-mixin oklch, var--accent 25, transparent Variante haute pour modales et gros formulaires .v30-input--lg, .v30-select--lg, .v30-textarea--lg height var--input-h-lg border-radius var--input-radius-lg padding 0 12px font-size 14px Action - Aucune migration de templates HTML ncessaire les alias couvrent. - Dans push-modal.css, supprimer les overrides .v30pm-input height 44px border-radius 16px et migrer vers .v30-push-input.v30-input--lg ou simplement ajouter la classe .v30-input--lg llment en HTML

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 1 Dsambiguser les composants doublonns 1-2 jours - 1.1 Inputs un seul systme...
Dcision seul le systme ProspUp rel reste. Dans components.css, supprimer css .status-new, .status-contact, .status-meeting, .status-proposal, .status-won, .status-lost Garder .status-idle, .status-prosp, .status-called, .status-voicemail, .status-callback, .status-rdv, .status-cold. Avant suppression bash grep -rnE status-newcontactmeetingproposalwonlost templates staticjs Si occurrences trouves ce serait surprenant, les remapper sur les vrais statuts ProspUp avant de supprimer les classes. Sinon, supprimer net

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 1 Dsambiguser les composants doublonns 1-2 jours - 1.2 Status pills retirer le systme gnrique...
Ajouter dans components.css, juste aprs .btn-accent css .btn-accent-soft background color-mixin oklch, var--accent 10, transparent border 1px solid color-mixin oklch, var--accent 28, var--border color var--accent .btn-accent-softhover background color-mixin oklch, var--accent 18, transparent border-color color-mixin oklch, var--accent 45, transparent .btn-accent-softactive background color-mixin oklch, var--accent 24, transparent .btn-pill border-radius 999px Migrations - push-modal.css .v30pm-ai-btn et .v30pm-candcardregen en HTML, remplacer la classe par classbtn btn-sm btn-accent-soft btn-pill. Supprimer les dfinitions CSS correspondantes dans push-modal.css. - modeprosp.css .mp-quick-btn reste intention diffrente neutre hover accent, mais rcrire pour quil consomme uniquement des tokens cf. Phase 6

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 1 Dsambiguser les composants doublonns 1-2 jours - 1.3 Boutons accent secondaires un seul .btn-accent-soft...
Dans push-modal.css, supprimer .v30pm-skel et keyframes v30pmShimmer. Migrer en HTML classv30pm-skel classskel

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 1 Dsambiguser les composants doublonns 1-2 jours - 1.4 Skeleton une seule classe...
- grep -rn .input staticcssv30 grep -v components.css grep -v tokens.css ne montre plus que des slecteurs composs pas de redfinition isole. - grep -rn v30pm-skel . retourne 0. - grep -rn v30pm-ai-btnv30pm-candcardregen . retourne 0. - grep -rn status-newstatus-contactstatus-meetingstatus-proposalstatus-wonstatus-lost . retourne 0. - Visuellement la modale push a des inputs 40px au lieu de 44, les boutons Regnrer AI gardent leur look pill accent-soft.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 1 Dsambiguser les composants doublonns 1-2 jours - 1.5 DoD Phase 1...
Findings rsolus F-03 4 topbars, F-13 4 headers, F-17 override h1.serif contradictoire

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour...
css Page header .page-header display flex align-items flex-end justify-content space-between gap var--s-4 padding var--page-header-py 0 border-bottom 1px solid var--border margin-bottom var--s-4 flex-wrap wrap .page-headergroup min-width 0 flex 1 1 220px .page-eyebrow font-size var--page-eyebrow-size color var--text-3 letter-spacing 0.08em text-transform uppercase margin 0 0 var--s-1 font-weight 500 .page-title font-family var--page-title-family font-style var--page-title-style font-weight var--page-title-weight font-size var--page-title-size line-height 1.1 letter-spacing var--page-title-tracking margin 0 color var--text .page-titlecount font-family var--font-sans font-style normal font-weight 500 font-size 16px color var--text-3 font-variant-numeric tabular-nums margin-left var--s-2 .page-sub font-size var--page-sub-size color var--text-3 margin var--s-1 0 0 .page-headeractions display flex align-items center gap var--s-2 flex-wrap wrap flex-shrink 0 media max-width 600px .page-header padding var--s-3 0 .page-title font-size 22px

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.1 Dfinir dans patterns.css...
Pour chaque page liste, en HTML remplacer la structure existante par le pattern. En CSS supprimer les classes spcifiques de la feuille de page

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.2 Migrer chaque page HTML CSS...
HTML remplacer le bloc div classv30-pp-topbardiv par html div classpage-header div classpage-headergroup h1 classpage-titleProspectsspan classpage-titlecount count spanh1 div div classpage-headeractions !-- boutons existants -- div div CSS supprimer .v30-pp-topbar, .v30-pp-topbar h1, et toute rgle qui descend de .v30-pp-topbar

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.2 Migrer chaque page HTML CSS - templatesv30prospects.html staticcssv30prospects.css...
Idem .v30-cal-topbar .page-header. Le label de mois .v30-cal-month-label reste un sous-lment spcifique mais doit aller dans .page-headergroup ct du titre. CSS supprimer .v30-cal-topbar et .v30-cal-topbar h1

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.2 Migrer chaque page HTML CSS - templatesv30calendar.html staticcssv30calendar.css...
Migrer html div classpage-header div classpage-headergroup p classpage-eyebrow eyebrow p h1 classpage-title title h1 p classpage-sub sub p div div classpage-headeractionsdiv div CSS supprimer .v30-paramstopbar, .v30-paramstitle, .v30-paramseyebrow, .v30-paramssub

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.2 Migrer chaque page HTML CSS - templatesv30parametres.html staticcssv30parametres.css...
Le .v30-hero est plus riche KPI droite. Garder le hero spcial mais eyebrow title passent au pattern. html section classv30-hero div classpage-headergroup p classpage-eyebrowp h1 classpage-titleh1 div div classv30-herokpidiv section CSS dashboard.css supprimer .v30-heroeyebrow et la dfinition de h1 spcifique au hero. Garder la grille .v30-hero layout et .v30-herokpi la card

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.2 Migrer chaque page HTML CSS - templatesv30dashboard.html...
Dans components.css, supprimer - Le patch BUG 28 qui groupait .v30-paramstopbar, .v30-push-topbar, .v30-cal-topbar devient inutile. - Loverride h1.serif, h1 .serif font-family var--font-sans il contredisait lusage et na plus de raison dtre le .page-title est explicite serif

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.3 Suppressions complmentaires...
- grep -rn v30-pp-topbarv30-cal-topbarv30-paramstopbar . retourne 0 sauf alias ventuels. - Toutes les pages listes affichent le .page-title avec la mme taille 28px desktop, 22px 600px. - Loverride h1.serif font-family var--font-sans est supprim de components.css. - Light dark le titre serif italic est correctement teint var--text.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 2 Pattern .page-header unifi 1 jour - 2.4 DoD Phase 2...
Findings rsolus F-04 4 KPI, F-10 police serif hardcode

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 3 Pattern .kpi unifi jour...
css KPI .kpi padding var--s-3 var--s-4 border 1px solid var--border background var--surface-2 border-radius var--r-card display flex flex-direction column gap var--s-1 .kpilabel font-size var--kpi-label-size color var--text-3 text-transform uppercase letter-spacing 0.06em font-weight 500 .kpivalue font-family var--font-serif font-size var--kpi-value-size line-height 1 color var--text font-variant-numeric tabular-nums font-weight 400 .kpidelta font-size 11.5px color var--success margin-top 2px font-variant-numeric tabular-nums .kpidelta.is-neg color var--danger .kpi--sm .kpivalue font-size var--kpi-value-size-sm .kpi--hero .kpivalue font-size var--kpi-value-size-hero .kpi-grid display grid grid-template-columns repeat4, minmax0, 1fr gap var--s-3 media max-width 900px .kpi-grid grid-template-columns repeat2, minmax0, 1fr media max-width 600px .kpi-grid grid-template-columns 1fr

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 3 Pattern .kpi unifi jour - 3.1 Dfinir dans patterns.css...
Page Avant Aprs --------- Prospects KPI haut de table .v30-pp-kpis .v30-kpi-card .kpi-grid .kpi Entreprises KPI bandeau .v30-ent-kpis .card .kpi-grid .kpi Card entreprise sub-stats .v30-ent-cardstat .kpi.kpi--sm sans border, voir variante Dashboard hero KPI .v30-hero-kpivalue .kpi.kpi--hero Si la sub-stat de carte doit tre sans borderbackground, ajouter une variante .kpi--bare css .kpi--bare padding 0 border 0 background transparent CSS supprimer des feuilles de page - .v30-pp-kpis, .v30-pp-kpis .v30-kpi-card, .v30-pp-kpis .v30-kpi-cardvalue, .v30-pp-kpis .v30-kpi-cardlabel - .v30-ent-kpis, .v30-ent-cardstat, .v30-ent-cardstat-v, .v30-ent-cardstat-l TABLE Si la sub-stat de carte doit tre sans borderbackground, ajouter une variante .kpi--bare css .kpi--bare padding 0 border 0 background transparent

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 3 Pattern .kpi unifi jour - 3.2 Migrations HTMLCSS...
bash grep -rln Instrument Serif staticcssv30 Pour chaque match, remplacer diff - font-family Instrument Serif, Georgia, serif font-family var--font-serif

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 3 Pattern .kpi unifi jour - 3.3 Recherche remplacement de la police serif hardcode...
- grep -rn Instrument Serif staticcssv30 grep -v tokens.css retourne 0. - Les 4 emplacements de KPI utilisent .kpi avec variantes pour hero sm bare. - Aucune page ne redfinit font-family Instrument Serif. - La taille des KPI est cohrente 36 hero, 32 dfaut, 22 sm.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 3 Pattern .kpi unifi jour - 3.4 DoD Phase 3...
Findings rsolus F-11 5 popovers, F-08 partiel shadows ad-hoc dans les popovers

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 4 Pattern .popover unifi jour...
css Popover menu .popover position absolute z-index 100 background var--surface border 1px solid var--border border-radius var--r-lg box-shadow var--shadow-dropdown padding 4px min-width 180px display flex flex-direction column gap 1px .popover--inline tooltips contenu libre, pas de liste padding 8px 10px display block .popover--reveal animation scale opacity, dclenche par .is-open opacity 0 transform scale0.97 transform-origin top center transition opacity var--dur-1 var--ease, transform var--dur-1 var--ease pointer-events none .popover--reveal.is-open opacity 1 transform scale1 pointer-events auto .popoveritem display flex align-items center gap 8px padding 8px 10px background transparent border 0 color var--text font inherit font-size 12.5px text-align left text-decoration none border-radius var--r-sm cursor pointer transition background var--dur-1 var--ease .popoveritemhover background var--surface-2 .popoveritemfocus-visible outline 2px solid var--accent outline-offset -2px .popoveritem.is-accent color var--accent .popoveritem.is-danger color var--danger .popoversep height 1px background var--border margin 4px 0 .popoverheader padding 6px 10px font-size 11px text-transform uppercase letter-spacing 0.06em color var--text-3

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 4 Pattern .popover unifi jour - 4.1 Dfinir dans patterns.css...
1. modeprosp.css .mp-phone-choice en HTML, ajouter classpopover. Supprimer la dfinition CSS dj trs proche. 2. prospects.css .v30-pp-tags-tip classpopover popover--inline. Supprimer la dfinition CSS. 3. prospects.css .v30-pp-tel-drop classpopover. Items .v30-pp-tel-dropitem popoveritem. Supprimer la dfinition CSS. 4. calendar.css .v30-calpopup classpopover. Le contenu interne liste devents reste spcifique au calendar cest OK, pas tout na besoin dtre pattern. 5. push-modal.css .v30pm-combopanel classpopover popover--reveal le toggle JS doit ajouterretirer .is-open. Supprimer toutes les rgles .v30pm-combopanel qui dupliquent .popover

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 4 Pattern .popover unifi jour - 4.2 Migrations du plus simple au plus complexe...
- Les 5 implmentations de popover ont migr. - Plus aucune box-shadow ad-hoc dans les popovers tous consomment --shadow-dropdown. - Lanimation .is-open du push fonctionne identique avant.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 4 Pattern .popover unifi jour - 4.3 DoD Phase 4...
Findings rsolus F-05 modale dtonne, F-06 partiel radius push. Pralable Phases 1, 2, 4 merges la modale push consomme leurs patterns

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 5 Modale push alignement 1 jour...
Avant Aprs ------ height 44px utiliser .v30-input--lg 40px en HTML, supprimer la rgle border-radius 16px input var--input-radius-lg 10px dj gr par .v30-input--lg border-radius 18px combo panel var--r-lg 10px gr par .popover border-radius 14px puis 16px candcard var--r-xl 14px border-radius 16px recipient var--r-xl 14px TABLE Dans staticcssv30push-modal.css

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 5 Modale push alignement 1 jour - 5.1 Inputs et radius...
- Combo panel triple shadow supprimer la rgle, hrite de .popover qui a --shadow-dropdown. - Halo accent box-shadow 0 0 0 4px color-mix... supprimer. Aucun quivalent ailleurs dans lapp. - Modale elle-mme .v30-modal-bd .v30-modal utiliser var--shadow-pop

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 5 Modale push alignement 1 jour - 5.2 Shadows...
Lanimation scale0.97 scale1 du panel passe par .popover--reveal Phase 4. Le panel modale lui-mme garde son enter-transition existante si elle utilise --dur-2 sinon migrer vers --dur-2

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 5 Modale push alignement 1 jour - 5.3 Animation...
- grep -nE border-radius16-9px staticcssv30push-modal.css retourne 0. - grep -nE height44px staticcssv30push-modal.css retourne 0. - Visuellement screenshots avantaprs la modale a la mme densit que les autres modales de lapp.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 5 Modale push alignement 1 jour - 5.4 DoD Phase 5...
Dcision tout .v30-page-element avec tirets. Renommages - .v30pm- .v30-push- sed dans CSS templates JS - .mp- .v30-mp- Procdure 1. grep -rn v30pm- . liste tous les fichiers. 2. Pour chaque fichier, faire un sed -i sv30pm-v30-push-g. 3. Garder dans push-modal.css un bloc dalias deprecated css Aliases deprecated supprimer aprs 2 sprints classv30pm- hint dev 4. Idem pour mp-

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 8 Conventions jour RISK - 8.1 Prfixes...
css .avatar width var--avatar-size height var--avatar-size border-radius var--avatar-radius background var--surface-3 color var--text display inline-flex align-items center justify-content center font-size 12px font-weight 600 font-variant-numeric tabular-nums flex-shrink 0 overflow hidden user-select none .avatar img width 100 height 100 object-fit cover .avatar--sm width var--avatar-size-sm height var--avatar-size-sm font-size 10.5px .avatar--md width var--avatar-size-md height var--avatar-size-md font-size 13px .avatar--lg width var--avatar-size-lg height var--avatar-size-lg font-size 15px .avatar--xl width var--avatar-size-xl height var--avatar-size-xl font-size 17px .avatar--square border-radius var--avatar-radius-square .avatar--logo border-radius var--r-md background var--surface-2 Anciennes classes en alias pendant 2 sprints .avatar-md width var--avatar-size-md height var--avatar-size-md font-size 13px .avatar-lg width var--avatar-size-lg height var--avatar-size-lg font-size 15px

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 7 Avatars jour - 7.1 tendre .avatar dans components.css...
bash grep -nE border-radius0-9px staticcssv30.css grep -v tokens.css grep -v 999px Valeur trouve Remplacer par ------ 2px, 3px, 4px var--r-xs 5px, 6px, 7px var--r-sm 8px var--r-md 9px, 10px, 11px var--r-lg 12px var--r-card 13px, 14px, 15px var--r-xl 16px, 17px, 18px, 19px, 20px var--r-2xl ou --r-xl si visuellement moins agressif 999px, 9999px garder tel quel intention pill 50 garder tel quel cercle TABLE Mapping

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique - 6.1 Border-radius hardcods...
Source Avant Aprs --------- modeprosp.css .mp-avatar 52px square classmp-avatar classavatar avatar--xl avatar--square push-modal.css .v30pm-recipientavatar classv30pm-recipientavatar classavatar avatar--lg prospects.css .v30-ent-cardlogo 36px logo classv30-ent-cardlogo classavatar avatar--md avatar--logo CSS supprimer these 3 classes spcifiques ou les garder comme alias deprecated si utilises dans du JS TABLE CSS supprimer these 3 classes spcifiques ou les garder comme alias deprecated si utilises dans du JS

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 7 Avatars jour - 7.2 Migrations HTML...
Ordre Phase Effort Bloque ------------ 1 0 Prparation j tout 2 1 Doublons composants 1-2 j 5 3 2 Page header 1 j 4 3 KPI j 5 4 Popovers j 5 6 5 Modale push 1 j 7 6 Nettoyage tokens 1-2 j 8 idalement 8 7 Avatars j 9 8 Conventions j Total 7-9 jours-dveloppeur, talable sur 3-4 semaines mi-temps. --- TABLE Total 7-9 jours-dveloppeur, talable sur 3-4 semaines mi-temps.

TITLE Plan de rectification visuelle ProspUp v30 desktop - 11. Ordre dexcution rcapitulatif...
Dcision 3 valeurs canoniques. Documenter dans tokens.css commentaire css Breakpoints canoniques CSS ne supporte pas vars en media --bp-sm 600px mobile portrait --bp-md 900px tablet --bp-lg 1100px desktop troit Trouv Remplacer par ------ 420, 520 600 700, 720, 768 au cas par cas often 600, sometimes 900 960 900 1100 1100 TABLE Migration mcanique

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 8 Conventions jour RISK - 8.2 Breakpoints...
Patches prcis prospects.css diff - var--accent, 7c5cff var--accent le fallback hex est faux laccent rel est OKLCH 258, 5478C9 bleu, pas violet parametres.css diff - var--warn, f59e0b var--warn - var--success, 22c55e var--success - color 64748b color var--text-muted ou var--ink-500 modeprosp.css diff - border 1px solid rgba0,0,0,0.15 border 1px solid var--border calendar.css couleurs de marques isoler dans tokens.css dj fait Phase 0 puis diff - background oklch0.40 0.18 270 Teams background var--brand-teams - background oklch0.45 0.18 220 Outlook background var--brand-outlook

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique - 6.3 Couleurs hardcodes et fallbacks faux...
- grep -nE border-radius0-9px staticcssv30.css grep -v tokens.css grep -v 999px 0 lignes. - grep -nE rgba0,0,0 staticcssv30.css grep -v tokens.css 0 lignes en contexte box-shadow ou border. - grep -nE var--accentwarnsuccessinfodanger, staticcssv30 0 lignes plus de fallback hex faux. - grep -rn Instrument Serif staticcssv30 grep -v tokens.css 0 lignes. - Dark mode tester dashboard, prospects, calendar, push toutes les ombres et bordures sinversent correctement.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique - 6.6 DoD Phase 6...
tokens.css dfinit --scrollbar- sur bodydata-v30. Supprimer les redfinitions locales -webkit-scrollbar width 6px dans dashboard.css, prospects.css, push-modal.css elles bypassent le token

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique - 6.5 Scrollbars custom...
bash grep -nE transition0.06-910-920-9s staticcssv30.css grep -v tokens.css Mapping - 0.14s var--dur-1 120ms - 0.15s 0.20s var--dur-2 180ms - 0.20s var--dur-3 260ms Et tout linear ease non document var--ease ou var--ease-smooth

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique - 6.4 Durations easings...
- grep -rn .v30pm-.mp- staticcssv30 grep -v deprecated 0. - Les breakpoints utiliss dans staticcssv30.css sont dans 600, 900, 1100 50px prs. - Tous les contrles interactifs ont un focus-visible visible test au clavier.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 8 Conventions jour RISK - 8.4 DoD Phase 8...
Standardiser dans patterns.css css .focus-ring outline 2px solid var--accent outline-offset 2px .focus-ring--inset outline-offset -2px Et appliquer les valeurs pas la classe tous les focus-visible dans components.css - .btnfocus-visible outline 2px accent, offset 2px - .v30-inputfocus-visible dj gr Phase 1 ring box-shadow - .popoveritemfocus-visible outline 2px accent, offset -2px inset Couvrir aussi les contrles oublis .tab, .segmented button, .checkbox, .toggle

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 8 Conventions jour RISK - 8.3 Focus states...
Pattern visuel Token ------- ------ ----- bash grep -nE box-shadowrgba0,0,0 staticcssv30.css grep -v tokens.css ------ 1 layer subtle 8px blur var--shadow-1 2 layers card hover var--shadow-2 Modal popover volumineux var--shadow-pop Popover 16px blur, mid var--shadow-popover Dropdown 28px blur, lift haut var--shadow-dropdown TABLE Mapping

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique - 6.2 Shadows hardcodes...
Findings rsolus F-06 radius, F-07 couleurs hardcodes, F-08 shadows ad-hoc, F-09 durations. Cette phase est mcanique mais nombreuse fais-la en plusieurs sous-PRs si besoin 6a6b6c6d

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 6 Nettoyage tokens 1-2 jours, mcanique...
Le projet est cohrent quand toutes ces commandes retournent ce qui est attendu bash Aucun radius hardcod en dehors des exceptions grep -nE border-radius0-9px staticcssv30.css grep -v tokens.css grep -vE 999px50 1px 0 lignes Aucune police serif hardcode grep -rn Instrument Serif staticcssv30 grep -v tokens.css 0 lignes Aucune ombre rgba ad-hoc dans box-shadow grep -nE box-shadowrgba0,0,0 staticcssv30.css grep -v tokens.css 0 lignes Aucun fallback hex faux dans var grep -rnE var--accentwarnsuccessinfodanger, staticcssv30 0 lignes Aucun doublon dinput grep -rn .v30pm-input.v30-input staticcssv30 wc -l 1 ligne max la dfinition canonique Aucune topbar de page custom grep -rnE v30-ppcalparams-?topbar staticcssv30 0 lignes Aucun status pill gnrique grep -rnE .status-newcontactmeetingproposalwonlost staticcssv30 templates 0 lignes Et visuellement - Modale push aligne sur le reste radius 14px, input height 40px. - Toutes les pages ont un .page-title 28px serif italic desktop. - Tous les KPI utilisent .kpi ou variante documente. - Tous les dropdownsmenus utilisent .popover. - Dark mode correct sur les 11 pages listes au 9.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - 10. Definition of Done projet complet...
Findings rsolus F-14 5 tailles, 5 implmentations

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 7 Avatars jour...
Avant chaque PR de phase, capture screenshots Pages couvrir - dashboard - prospects vues table kanban split - calendar vue mois vue semaine - entreprises - parametres - users - aide - mode-prosp - sourcing - push - stats Modales couvrir - Push envoi candidatures - Ajout prospect - Import CSV - Candidature dtail - Date picker Pour chaque - Light dark - Desktop 1440900 tablet 9001280 mobile 390844 Workflow bash Avant la PR mkdir -p testsvisual-baselinebefore playwright screenshot --lightdark --pages... Aprs le merge propos mkdir -p testsvisual-baselineafter diff -- before after
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - 9. Tests de non-rgression visuelle...
- Une classe est utilise dans des templates Jinja que je ne peux pas modifier fournis un alias CSS cf. 0.4 plutt que renommer.
- Je ne sais pas quel token utiliser pour une valeur spcifique privilgie le token le plus proche par le bas sous-estime sur-estime. Si vraiment hors palette, ajoute un nouveau token dans tokens.css avec un nom explicite.
- Le dark mode casse aprs ma modification vrifier que tous les nouveaux tokens ont une variante dans le bloc dark, et quaucun rgba0,0,0, nest rest en dur.
- Une modification visuelle est ambigu prfre ne pas changer et laisser un commentaire TODO design review . Ne jamais deviner une intention.
- Le grep DoD ne passe pas for 1-2 lignes cest OK si elles sont justifies commentaire explicite. Documente lexception dans la PR.
--- Fin du plan. Rfrer au fichier auditfindings.md pour la justification de chaque finding F-XX

TITLE Plan de rectification visuelle ProspUp v30 desktop - 12. Si tu es bloqu...
Findings rsolus F-16 prfixes, F-18 breakpoints, F-20 focus. faire en dernier cest le plus risqu renommage de classes potentiellement consommes par le JS

TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 8 Conventions jour RISK...
- Les avatars de lapp utilisent 4 tailles canoniques 24, 32, 36, 44, 52 smdefaultmdlgxl. - grep -rn v30pm-recipientavatarmp-avatarv30-ent-cardlogo . 0 sauf alias.
---
TITLE Plan de rectification visuelle ProspUp v30 desktop - Phase 7 Avatars jour - 7.3 DoD Phase 7
