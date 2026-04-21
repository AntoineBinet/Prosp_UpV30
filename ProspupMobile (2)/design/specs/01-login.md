# 01 · Login

**Référence code** : `design/prototype/src/screen-login.jsx`
**Screenshot** : `design/screenshots/01-login.png`

## Layout (top → bottom)
1. **Status bar** (54pt)
2. **Ambient orange glow** : deux radial-gradients flous derrière
   - Top : centre x, y 80, width 140%, h 380, gradient `rgba(255,107,53,.28)` → transparent, blur 20
   - Bottom-right : 400×400, gradient `rgba(255,140,66,.15)`, blur 40
3. **Brand lock-up** (marge top 60)
   - Carré 44×44, radius 12, gradient accent, shadow `0 8px 24px rgba(255,107,53,.35)`, lettre "P" blanche 20/800
   - À droite : "ProspUp" 20/700 + caption "UP TECHNOLOGIES"
4. **Headline** (marge top 48)
   - "Bon retour," + "Antoine." (accent) — titre 32/700 letter-spacing -0.8, line-height 1.1
   - Sub 15/400 text2 sur 2 lignes
5. **Form** (gap 10)
   - 2 inputs, chacun : hauteur 56, radius 16, bg3, border 0.5px border
   - Structure interne : icône 18 (text3) · label caption UPPERCASE text3 · valeur body/500 text
6. **Forgot** : à droite, body/500 accent
7. **Spacer flex** — pousse le bouton en bas
8. **Primary button** : w 100%, h 54, radius 18, bg accent, shadow pop + inset highlight, label 16/600
9. **Face ID hint** : row centré, icône + "Face ID disponible" 13/400 text2
10. **Version footer** : caption text3 "v29.8 · prospup.work"

## Comportements
- Tap input → focus underline accent (optionnel), pas de border qui change de couleur agressive
- Face ID auto-trigger au foreground si activé dans Réglages
- Erreur : shake 4px + toast top (pas de banner inline permanent)
