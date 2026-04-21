# 08 · Stats

**Référence code** : `design/prototype/src/screen-stats.jsx`
**Screenshot** : `design/screenshots/08-stats.png`

## Layout
1. **Large header** "Stats" + sub "Semaine 17 · du 14 au 20 avril"
   - Trailing : Glass pill "Semaine ▾" (sélecteur période)
2. **KPI grid 2×2** (gap 10, mx 16)
   - Chaque Kpi : padding 16, radius 18, bg3, border border
   - Kpi "Pipeline" en mode `accent=true` : gradient `accentSoft → presque rien`, border accent 20%, valeur en accent
   - Structure : caption label / valeur 28/700 / delta (green up = ↗, red down = ↘) + "vs S-1"
3. **Section "Activité · 7 jours"** + "Comparer" accent
4. **Chart card** (mx 16, padding 18, radius 20, bg3)
   - SVG barres : 7 jours L/M/M/J/V/S/D
   - Pour chaque jour : barre appels (7pt, accent) + barre RDV (7pt, vert) côte à côte
   - Grid horizontale à 25/50/75/100% (dashed divider)
   - Labels 10 text2 centrés sous chaque jour
   - Legend en bas : dot accent "Appels" · dot vert "RDV pris"
5. **Section "Classement équipe"** + "#2 sur 8" accent
6. **Leaderboard** (radius 20, bg3, overflow hidden)
   - 4 rows
   - Row = square 26 (gold gradient si #1, accent si "me", bg4 sinon) + nom + XP aligné droite
   - Ma row : bg accentSoft, nom 600, XP accent
