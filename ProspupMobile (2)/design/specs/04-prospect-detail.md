# 04 · Fiche prospect (détail)

**Référence code** : `design/prototype/src/screen-detail.jsx`
**Screenshot** : `design/screenshots/04-prospect-detail.png`

## Layout — bottom sheet plein écran
1. **Scrim** noir 40% au-dessus de la vue précédente
2. **Sheet** : bottom=0, top=60, radius 24 24 0 0, bg bg2, shadow `0 -10px 40px rgba(0,0,0,.35)`
3. **Grabber** : 40×5, radius 3, bg text4, centré top 8
4. **Header** (padding 8/20/16)
   - Avatar 56×56 radius 18 — gradient de la couleur du statut, initiales blanches 20/700, shadow matching
   - Nom 22/700 + role+société 13 text2
   - StarRating à droite
5. **Status pills row** (gap 6, flex-wrap)
   - Pill statut (ex : "RDV")
   - "Relance due" si applicable
   - "📅 Jeudi 14h" si RDV fixé
   - lastContact caption (bg4)
6. **Action grid 4 cols** (gap 8, mx 16)
   - "Appeler" = primary (accent, shadow pop)
   - "Email", "LinkedIn", "IA" = secondaires (bg3, border)
   - Chaque : icône 16 en haut, label 11/600 en bas
7. **Scroll zone** avec 4 cartes :
   - **Coordonnées** : téléphone (mono, bouton appel rond), email (mono), LinkedIn
   - **Notes** : trailing "Éditer" accent ; corps 14/400 line-height 1.5
   - **Compétences** : tags radius 999, bg4 border border2
   - **Historique** : timeline 4 événements — icône dans carré 28, titre 13.5, date caption text3

## Interactions
- Drag down → ferme (animation spring)
- Scroll au-delà du header → header se shrink (nom passe 22→17, avatar 56→36)
- Tap téléphone → compose l'appel
- Tap "Éditer" sur Notes → inline editable
