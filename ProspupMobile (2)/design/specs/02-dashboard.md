# 02 · Dashboard

**Référence code** : `design/prototype/src/screen-dashboard.jsx`
**Screenshot** : `design/screenshots/02-dashboard.png`

## Layout
1. **Dynamic Island expanded** (simulation Live Activity)
   - w 220, h 37, radius 24, bg noir pur
   - Contenu : dot accent glow + label "Rappel — Léa Bernard · 17h00" + "LIVE" à droite
2. **Large header** "Bonjour," + sub "Mardi 21 avril · Série de N jours 🔥"
   - Trailing : 2 IconBtn ronds 36 glass (loupe + cloche)
3. **Hero XP card** (mt 8, mx 16, radius 24, padding 20)
   - Background : gradient `#1a1410 → #0f0e0c` (dark) / `#FFF6F0 → #FDECE1` (light)
   - Border 0.5px `rgba(255,107,53,0.18)`
   - **Left** : RingXP 148×148
     - stroke 10, r (148-10)/2, rotate -90°
     - arc = dasharray `C*pct` où pct = XP.current/XP.next
     - gradient stroke `#FF6B35 → #FFB088`
     - Au centre : "NIVEAU" caption text3 / nombre 40/700 / "2340 / 3000 XP" 11 tabular-nums
   - **Right** : 
     - "AUJOURD'HUI" caption
     - "+180 XP" 28/700 + badge accent "Objectif du jour 73%"
4. **Section "Objectifs de la semaine"** avec pill total à droite
5. **Objectives card** : radius 20, 4 ObjBar
   - Chaque ObjBar : row label/done/target + progress bar 6pt rounded
   - Couleurs fixes par objectif (bleu, jaune, vert, violet)
6. **Section "Actions rapides"**
7. **Grid 2×2 QuickAction** :
   - Carte 1 (accent=true) : gradient orange, shadow pop, titre "Mode Prosp"
   - 3 autres : bg3, icône dans carré 32 fond accentSoft
8. **Section "Activité du jour"** + "Tout voir" accent
9. **Timeline activity** : 5 rows avec icône emoji dans carré bg4

## Tab bar
- Active = `dashboard` (pill accentSoft slide vers l'onglet actif)

## Tweaks à implémenter
- Toggle dark/light
- Hero card : 3 variantes (actuelle / compact / illustré)
