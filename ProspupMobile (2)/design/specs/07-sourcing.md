# 07 · Sourcing IA

**Référence code** : `design/prototype/src/screen-sourcing.jsx`
**Screenshot** : `design/screenshots/07-sourcing.png`

## Layout
1. **Large header** "Sourcing IA" + sub "Matching pour {client} · {mission}"
   - Trailing : IconBtn settings (paramètres de matching)
2. **AI brief card** (mx 16, padding 14, radius 18)
   - Background : gradient `accentSoft → transparent`, border accent 20%
   - Row : square 28 accent avec icône sparkles + "Brief analysé par IA" 13/600
   - Texte descriptif 13 text2 avec mots-clés en bold et TJM accent
   - Row pills : "24 CV ANALYSÉS" succès + "il y a 3 min" neutre
3. **Section heading** "Top candidats" + "Par match %" accent
4. **Candidate cards** (gap 8, mx 16, padding 14, radius 18, bg3)
   - **MatchRing 48×48** à gauche : anneau coloré selon score (≥90 vert, ≥80 jaune, sinon orange), score central 13/700
   - Body :
     - Row 1 : nom 15/600 + "% MATCH" aligné droite couleur match
     - Row 2 : "Role · City" 12.5 text2
     - Row 3 : skills chips (max 4), radius 6, bg4 border border
     - Row 4 : `TJM€/j` · `N ans xp` · availability (vert si Immédiate)

## Interactions
- Tap card → profil candidat complet (hors scope v1, lien ici)
- Swipe right → matcher avec prospect
- Tap "24 CV ANALYSÉS" → timeline IA
