# 09 · Réglages

**Référence code** : `design/prototype/src/screen-settings.jsx`
**Screenshot** : `design/screenshots/09-settings.png`

## Layout
1. **Large header** "Réglages" avec leading "← Retour" accent
2. **Profile card** (mx 16, padding 16, radius 20, bg3, border)
   - Avatar rond 56 gradient accent, initiales blanches 20/700
   - Nom 17/600 + email 12 text2
   - Badge caption accent "UP TECHNOLOGIES · NIV 14"
   - Chevron droite
3. **Sections groupées** (style iOS — titre caption UPPERCASE text2, groupe radius 16 bg3 border)
   - **Apparence** : Thème · Couleur d'accent (swatch) · Taille texte
   - **Mode Prosp** : Vibrations (toggle) · Auto-appel 3s (toggle) · Enregistrement (toggle) · Filtres par défaut
   - **Intégrations** : LinkedIn Sales (connecté vert) · Google Cal (connecté) · Aircall · n8n
   - **Compte** : Sécurité & Face ID · Notifications · Aide · Déconnexion (danger)
4. **Footer** : caption text3 "ProspUp v29.8 · build 2026.04"

## SettingRow
- Padding 13/14, border-bottom divider (sauf dernier)
- Icône dans carré 28×28 radius 8, bg accentSoft (danger = bg rouge 12%)
- Label 14.5/500 · valeur 13/500 text2 (ou vert avec dot si connecté)
- Chevron 8×12 text4

## ToggleRow
- Switch iOS 46×28 radius 14
- ON = accent, OFF = bg4
- Thumb 24 blanc shadow, transition 200ms
