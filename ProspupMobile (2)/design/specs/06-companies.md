# 06 · Sociétés

**Référence code** : `design/prototype/src/screen-companies.jsx`
**Screenshot** : `design/screenshots/06-companies.png`

## Layout
1. **Large header** "Sociétés" + sub "68 actives · 7 secteurs" + IconBtn search/add
2. **Segmented control** (mx 16, padding 3, radius 12, bg4, flex row)
   - 3 boutons : Toutes / Favoris / Récentes
   - Actif : bg bg3, text default, shadow 0 1px 3px rgba(0,0,0,.1)
   - Inactif : transparent, text2
3. **Company cards** (gap 10, mx 16)
   - Row : square 48×48 radius 12 avec logo 2 lettres blanches (color = accent société), shadow matching
   - Body : nom 15/600 · sector·city 12 text2 · mini-stats row (prospects / deals)
   - Trailing : caption "ACTIVITÉ" + "il y a 2j" 11 text2

## Mini-stats
- Format : `12 prospects` · `3 deals`
- Nombre 13/700 tabular-nums, label 11 text3
- Si deals > 0 → nombre en accent

## Couleurs sociétés
- Stockées avec la société (heritage brand). Ex Dassault `#005386`, Thales `#004B87`, Airbus `#00205B`…
- Si absente → fallback teinte neutre `#64748B`
