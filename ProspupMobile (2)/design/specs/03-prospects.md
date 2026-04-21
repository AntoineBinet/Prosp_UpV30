# 03 · Prospects (liste)

**Référence code** : `design/prototype/src/screen-prospects.jsx`
**Screenshot** : `design/screenshots/03-prospects.png`

## Layout
1. **Large header** "Prospects" + sub "142 actifs · 58 archivés"
   - Trailing : IconBtn filtre + IconBtn "+"
2. **Search pill** (mx 16, h 40, radius 14, bg4)
   - Icône loupe + placeholder text3 + icône funnel à droite
3. **Filter chips** row horizontal scrollable
   - 6 chips : Tous(142) / Urgent(6) / RDV(9) / Appelé(34) / Prospecté(58) / À rappeler(12)
   - Chip actif : border accent 30%, bg accentSoft, texte accent, compteur bg accent 20%
   - Chip inactif : border border2, bg3, texte default
4. **Live Activity banner** (si Mode Prosp en cours)
   - mx 16, padding 10/12, radius 14, bg accentSoft 8%, border accent 18%
   - Square 28 accent + "Mode Prosp en cours — 17/42" + chevron
5. **Prospect cards** (gap 6, mx 16)
   - Chaque carte = row avec **rail couleur 4pt** à gauche (color = statut)
   - Body interne :
     - Row 1 : nom 15/600 ellipsis + pill statut 10/700 UPPERCASE
     - Row 2 : "Société · Rôle" 12.5 text2 ellipsis
     - Row 3 : StarRating 5 étoiles (4 remplies accent) + badges RELANCE/RDV si applicable + icons phone/mail/in
   - Chevron right text4 à droite
6. **Footer** : "— Fin de la liste · 142 prospects —"

## Interactions
- Tap card → ouvre Fiche (bottom sheet plein écran)
- Long press → action menu (appeler, email, supprimer)
- Swipe left → quick actions (archiver, statut)
- Pull-to-refresh → spinner accent

## État urgent (follow-up dû)
- Ajouter badge rouge "RELANCE" dans la row 3
- Rail left = rouge `#F87171`
