# 05 · Mode Prosp (swipe cards)

**Référence code** : `design/prototype/src/screen-prosp.jsx`
**Screenshot** : `design/screenshots/05-mode-prosp.png`

## Principe
Interface type "Tinder" : stack de 3 cartes visibles, la carte de devant se swipe ou se décide via les boutons en bas. Le but = maximiser le rythme d'appels tout en gardant le contexte.

## Layout
1. **Ambient glow** accent derrière la stack (radial, blur 30)
2. **Top bar** (padding 8/16/14)
   - IconBtn glass ← retour
   - Caption "MODE PROSP" + "Filtre : Aerospace FR · 5★" 15/600
   - Pill live accent : dot glow + "17 / 42" tabular-nums
3. **Progress bar** 3pt, gradient accent, width = (done+1)/total
4. **Card stack** (3 cartes superposées)
   - Chaque carte : abs, left 20, right 20, top 0, h 420, radius 28
   - Background : gradient 160° bg3→bg2 (dark) / white→bg (light)
   - Stack : depth 0 = front, depth 1 = +8px/scale .96, depth 2 = +16px/scale .92
   - Shadow : `0 30px 60px rgba(0,0,0,.5)` uniquement sur la front
5. **Card content**
   - Row 1 : avatar 64 gradient statut · nom sur 2 lignes 22/700 · StarRating
   - Block 2 : "ENTREPRISE" caption / nom société 17/600 / role 13 text2
   - Tags row (skills) : pills bg4
   - Spacer
   - **Phone callout** : bg `rgba(255,107,53,.10)`, border accent 20%, padding 14/16, radius 18
     - Square 40 accent avec icône phone
     - "LIGNE DIRECTE" caption + numéro 16 mono/600
     - Pill statut à droite
   - Helper caption centré : "← Suivant · Décrocher → · ↑ Voir fiche"
6. **Action bar** (5 boutons ronds entre les cartes et la tab bar)
   - skip (48) — X, bg3
   - note (48) — document, bg3
   - **call (64)** — phone, bg accent, shadow pop (CTA principal)
   - mail (48) — enveloppe, bg3
   - star (48) — étoile jaune

## Animations
- Swipe/décision : card front tilt ±24° + translate ±192px + fade, 280ms ease-out cubic
- Suivantes remontent (depth 1→0) avec même easing

## Gestes
- Drag horizontal → tilt en temps réel
- Drag vertical up > 80px → ouvre Fiche
- Double tap → "+ pertinence"
