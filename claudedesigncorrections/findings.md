Rfrence canonique staticcssv30tokens.css staticcssv30components.css Primtre audit tous les CSS staticcssv30.css du repo AntoineBinetProspUpV30main Date audit statique des feuilles de styles. Une vrification visuelle au runtime est recommande en complment. --- TITLE Audit de cohrence visuelle ProspUp v30 desktop

- chelle ink --ink-0 --ink-1000 12 paliers, OKLCH cool 258
- Smantique --surface, --surface-2, --surface-3, --border, --border-strong, --text, --text-2, --text-3, --text-muted
- Accent --accent, --accent-hover, --accent-soft, --accent-fg
- Signal --success --warn --danger --info leurs -soft
- Radius --r-xs 4 --r-sm 6 --r-md 8 --r-lg 10 --r-xl 14 --r-2xl 20
- Spacing --s-1 4 --s-20 80
- Shadow --shadow-1, --shadow-2, --shadow-3, --shadow-pop
- Type --font-sans Inter, --font-serif Instrument Serif, --font-mono JetBrains Mono
- Motion --ease, --ease-smooth, --dur-1 120ms --dur-2 180ms --dur-3 260ms

TITLE Audit de cohrence visuelle ProspUp v30 desktop - 1. Carte du systme rappel rapide - Tokens disponibles tokens.css...
Boutons .btn, .btn-primary, .btn-accent, .btn-ghost, .btn-danger, inputs .input .v30-input doublon, cards, badges, status pills, segmented, tabs, modal .v30-modal-bd .v30-modal, avatars, table.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 1. Carte du systme rappel rapide - Composants components.css...
Localisation components.css - .input .select .textarea height 30px, border-radius var--r-md 8px, background var--surface - .v30-input .v30-select .v30-textarea padding 8px 10px height 36px, border-radius 10px hardcod, pas de token, background var--surface-2 Consquence deux looks dinput coexistent dans la mme app. dashboard.css consomme .input push-modal.css r-override ces .v30-input en 44px radius 16px encore un autre format. Ce que a veut dire concrtement trois hauteurs dinput 30, 36, 44 et trois radius 8, 10, 16 pour le mme rle.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-1 Incohrences structurelles corriger dabord - F-01. Doublon de systme dinputs...
Localisation components.css lignes 150-180 - Systme 1 gnrique CRM .status-new, .status-contact, .status-meeting, .status-proposal, .status-won, .status-lost - Systme 2 ProspUp rel .status-idle, .status-prosp, .status-called, .status-voicemail, .status-callback, .status-rdv, .status-cold Le systme 1 ne correspond aucun statut mtier rel de ProspUp.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-1 Incohrences structurelles corriger dabord - F-02. Doublon de status pills...
Page Classe h1 size h1 family padding --------------- Prospects prospects.css .v30-pp-topbar 28px serif italic 16px 0 Calendar calendar.css .v30-cal-topbar 22px serif italic margin-bottom 14px Paramtres parametres.css .v30-paramstopbar 30px sans .serif span 6px 0 10px Push page .v30-push-topbar confirmer Consquence 4 hauteurs de titre diffrentes pour 4 pages, et h1.serif est neutralis par un override global dans components.css qui dit les h1 utilisent Inter, pas le serif mais les 3 topbars listes ci-dessus utilisent quand mme le serif italic.
---
TABLE Localisation un patch BUG 28 dans components.css traite simultanment .v30-paramstopbar, .v30-push-topbar, .v30-cal-topbar. Or chacune est dfinie dans son propre CSS de page

TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-1 Incohrences structurelles corriger dabord - F-03. Trois topbars de page r-implmentes indpendamment...
Localisation - Dashboard .v30-hero-kpivalue serif 36px, var--font-serif via token - Prospects .v30-pp-kpis .v30-kpi-cardvalue Instrument Serif, Georgia, serif en dur, 28px - Entreprises .v30-ent-kpis .serif 28px utilitaire .serif partag - Card prospect .v30-ent-cardstat-v Instrument Serif, Georgia, serif en dur, 22px Consquence 4 tailles de KPI 36 28 28 22, font-family hardcode 2 endroits, contournant --font-serif.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-1 Incohrences structurelles corriger dabord - F-04. Systme de KPI dupliqu 3 fois...
Localisation push-modal.css - Inputs 44px, radius 16px - Combobox radius 16px sur le bouton, 18px sur le panel - Cards radius 14px puis 16px dans le polish v30.30.16 Aucune de ces valeurs ne vient de --r-. Cest la modale plus spciale de lapp visuellement dtonante par rapport au reste.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-1 Incohrences structurelles corriger dabord - F-05. Modale push rinvente toute sa structure...
Fichier Valeur trouve Devrait tre --------- prospects.css ent-card border-radius 12px --r-lg 10 ou --r-xl 14 prospects.css kpi card border-radius 12px idem prospects.css table-wrap border-radius 10px var--r-lg prospects.css kanban col border-radius 10px var--r-lg prospects.css split border-radius 10px var--r-lg prospects.css chiprow border-radius 999px OK pill prospects.css bulk inner border-radius 12px --r-xl push-modal.css 16px, 18px, 14px --r-xl 14 max parametres.css border-radius 14px --r-xl quivalent mais en dur modeprosp.css avatar border-radius 14px hardcod calendar.css border-radius 10px, 5px, 4px, 2px tokens dashboard.css border-radius 10px, 8px, 4px, 3px, 2px tokens Total 10 fichiers avec radius hardcods.
---
TABLE Liste non exhaustive grepe TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-2 Drives de tokens - F-06. Border-radius hardcods au lieu des tokens...
Fichier Valeur Note --------- prospects.css rgba0,0,0,0.08 kcard hover shadow ne suit pas les --shadow- prospects.css rgba0,0,0,.22 tags-tip idem prospects.css rgba0,0,0,.28 tel-drop idem prospects.css kcol drop-target var--accent, 7c5cff fallback hex faux laccent est OKLCH 258 5478C9, pas un violet 7c5cff parametres.css var--warn, f59e0b fallback hex potentiellement faux parametres.css var--success, 22c55e idem parametres.css 64748b en dur version dot aucune raison calendar.css oklch0.40 0.18 270 Teams, oklch0.45 0.18 220 Outlook, fff brand colors externes acceptable mais isoler modeprosp.css rgba0,0,0,0.15 avatar border bypass tokens Hirarchie casse sur dark mode, plusieurs de ces hardcodes ne sinversent pas correctement.
---
TABLE Hirarchie casse sur dark mode, plusieurs de ces hardcodes ne sinversent pas correctement. TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-2 Drives de tokens - F-07. Couleurs hardcodes...
- prospects.css kcard box-shadow 0 2px 8px rgba0,0,0,0.08 au lieu de --shadow-1--shadow-2 - prospects.css tags-tip 0 4px 18px rgba0,0,0,.22 au lieu de --shadow-3 - prospects.css tel-drop 0 4px 16px rgba0,0,0,.28 au lieu de --shadow-3 - prospects.css mobile card 0 1px 0 rgba0,0,0,0.04 au lieu de --shadow-1 - parametres.css snapshots pas de shadow cohrent - calendar.css popup 0 12px 28px -10px rgba0,0,0,.24 au lieu de --shadow-3 - calendar.css views.is-active 0 1px 3px rgba0,0,0,.14 au lieu de --shadow-1 - modeprosp.css utilise correctement var--shadow-1, var--shadow-2, var--shadow-pop modle de rfrence - push-modal.css combo panel 0 20px 50px -14px ... au lieu de --shadow-pop
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-2 Drives de tokens - F-08. Shadows ad-hoc...
- prospects.css transition ... .15s ent-card, .12s table row, .4s var--ease breakdown-fill devrait tre --dur-1--dur-2--dur-3 - calendar.css transition ... 0.12s x4 - modeprosp.css utilise correctement var--dur-1 la plupart du temps - push-modal.css utilise var--dur-1
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-2 Drives de tokens - F-09. Durations easings hardcods...
Plusieurs fichiers utilisent font-family Instrument Serif, Georgia, serif au lieu de var--font-serif - prospects.css 3 occurrences ent-card stat, pp-kpis, ent-kpis ne sont pas concernes car utilisent .serif - parametres.css 1 occurrence .v30-paramstitle .serif Sur dautres pages, var--font-serif est utilis correctement incohrence interne.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-2 Drives de tokens - F-10. Police serif rfrence en dur...
Fichier Classe Surface Border Radius Shadow ------------------ prospects.css .v30-pp-tags-tip var--surface --border-strong 8px rgba ad-hoc prospects.css .v30-pp-tel-drop var--surface --border-strong 8px rgba ad-hoc modeprosp.css .mp-phone-choice var--surface --border --r-lg --shadow-pop calendar.css .v30-calpopup var--surface --border --r-md rgba ad-hoc push-modal.css .v30pm-combopanel var--surface accent-tinted 18px rgba ad-hoc x3 Aucune classe .popover ou .menu dans components.css. Chaque page la rinvente.
---
TABLE Aucune classe .popover ou .menu dans components.css. Chaque page la rinvente. TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-3 Patterns rinvents anti-DRY - F-11. Dropdowns popovers 5 implmentations diffrentes...
- .btn-accent components 28px, accent solid - .v30pm-ai-btn push-modal 28px, pill 999px, accent-soft, accent border - .v30pm-candcardregen push-modal 26px, pill, presque identique au prcdent - .mp-quick-btn modeprosp 28px, surface neutre border, hover-tinted accent Quatre variations pour bouton daction secondaire teint accent. Devrait tre 1 ou 2 max.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-3 Patterns rinvents anti-DRY - F-12. Boutons 4 styles accent action diffrents...
Page Pattern ------ Prospects .v30-pp-topbar flex h1 serif 28 Calendar .v30-cal-topbar flex h1 serif 22 month label serif 18 Paramtres .v30-paramstopbar .v30-paramseyebrow .v30-paramstitle 30 .v30-paramssub Mode Prosp .mp-header height 48 Dashboard hero .v30-hero grid .v30-heroeyebrow serif italic 28 Consquence aucun pattern partag .page-header .page-eyebrow .page-title. Chaque page redfinit padding, border-bottom, hauteur de titre.
---
TABLE Consquence aucun pattern partag .page-header .page-eyebrow .page-title. Chaque page redfinit padding, border-bottom, hauteur de titre. TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-3 Patterns rinvents anti-DRY - F-13. Topbarheader de page 4 implmentations...
Source Taille Radius Font ------------ components.css .avatar 24px 50 10.5px components.css .avatar-md 32px 50 12px components.css .avatar-lg 44px 50 14px push-modal.css .v30pm-recipientavatar 40px puis 44px override v30.30.16 50 1415px modeprosp.css .mp-avatar 52px 14px square rounded 17px prospects.css .v30-ent-cardlogo 36px 8px 12px Le pattern v30 mlange round et square-rounded sans rgle claire.
---
TABLE Le pattern v30 mlange round et square-rounded sans rgle claire. TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-3 Patterns rinvents anti-DRY - F-14. Avatars 5 tailles, 5 implmentations...
- components.css .skel keyframe skel-pulse, gradient horizontal - push-modal.css .v30pm-skel keyframe v30pmShimmer quasi identique mais avec son propre nom
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-3 Patterns rinvents anti-DRY - F-15. Skeleton loading 2 implmentations...
Conventions trouves - .v30- la majorit - .v30-pp- prospects - .v30-cal- calendar - .v30-params BEM block element - .v30pm- push-modal sans tiret - .mp- mode prosp pas de prfixe v30 Cinq conventions de prfixe coexistent.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-4 Dtails nettoyer - F-16. Prfixes incohrents...
components.css contient css h1.serif, h1 .serif font-family var--font-sans font-style normal ... Mais parametres.css utilise .v30-paramstitle .serif sur un span enfant avec une intention serif italic. Le slecteur h1 .serif casse cette intention si le .serif est direct enfant dun h1.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-4 Dtails nettoyer - F-17. Override h1.serif self-contradictoire...
- prospects.css 1100, 900, 700, 600 - dashboard.css 1100, 900, 720 - parametres.css 1100, 720 - calendar.css 900, 520 - modeprosp.css 900, 768, 600, 420 - push-modal.css 960, 600 Aucun breakpoint canonique. Recommandation 3 valeurs maximum ex. 720 900 1100.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-4 Dtails nettoyer - F-18. Conventions de breakpoints...
tokens.css dfinit --scrollbar- et un styling sur bodydata-v30. Mais - dashboard.css, prospects.css, push-modal.css redfinissent leurs propres scrollbars -webkit-scrollbar width 6px sur des conteneurs scrollables internes bypass total du token.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-4 Dtails nettoyer - F-19. Custom scrollbar partiellement dploy...
- components.css outline 2px solid var--accent outline-offset 1px sur .btnfocus-visible - Inputs .inputfocus box-shadow 0 0 0 3px ... - Inputs .v30-inputfocus box-shadow 0 0 0 3px ... - push-modal.css combo outline 2px solid ... outline-offset 2px - modeprosp.css arrow pas de focus-visible explicite - parametres.css aucun focus-visible Mlange ring vs outline offset 1 vs 2 pas de focus-visible sur certains contrles.
---
TITLE Audit de cohrence visuelle ProspUp v30 desktop - 2. Findings par svrit - SEV-4 Dtails nettoyer - F-20. tats focus visibles incohrents...
Catgorie Occurrences Severity --------- Doublons de composants input, status, modal, button accent 5 SEV-1 Border-radius hardcods 30 SEV-2 Couleursshadow hardcodes 15 SEV-2 Polices rfrences sans token 3-5 SEV-2 Patterns rinvents popover, header, KPI, avatar 4 patterns 3-5 variantes SEV-3 Prfixes CSS incohrents 5 conventions SEV-4 Breakpoints 6 valeurs distinctes SEV-4
---
TABLE --- TITLE Audit de cohrence visuelle ProspUp v30 desktop - 3. Rcapitulatif chiffr...
1. modeprosp.css utilise correctement var--shadow-, var--dur-1, var--r-md, var--r-lg, var--font-serif. Quelques radius hardcods avatar 14px mais cohrents. 2. components.css la base est saine, cest laccumulation de doublons qui pose problme. 3. tokens.css propre, bien organis. Aucun changement requis TITLE Audit de cohrence visuelle ProspUp v30 desktop - 4. Pages les plus saines utiliser comme modle...
1. push-modal.css rinvente entirement son langage visuel radius 141618, height 44, shadow rgba ad-hoc. Dtonne en moodaal. 2. prospects.css la page la plus utilise, avec le plus de hardcodes 10 rgba, 6 radius en dur. 3. calendar.css beaucoup de couleurs OKLCH ad-hoc pour les types dvnement, sans tokens ddis TITLE Audit de cohrence visuelle ProspUp v30 desktop - 5. Pages les plus risque
