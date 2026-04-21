# ProspUp Mobile 2026 — Kit Design

> Dossier à déposer à la racine du repo `Prosp_UpV25` (ou dans `docs/design/`) pour que **Claude Code** ait toutes les références visuelles sous la main.

## 📦 Contenu

```
design/
├── README.md                     ← ce fichier
├── PROMPT_CLAUDE_CODE.md         ← prompt principal à coller dans Claude Code
│
├── tokens/
│   ├── tokens.json               ← source de vérité (couleurs, radius, type)
│   ├── design_tokens.dart        ← version Dart prête à copier dans lib/theme/
│   └── design_tokens.css         ← version CSS si besoin pour mobile.css
│
├── specs/
│   ├── 00-system.md              ← règles globales (thème, typo, espacement)
│   ├── 01-login.md
│   ├── 02-dashboard.md
│   ├── 03-prospects.md
│   ├── 04-prospect-detail.md
│   ├── 05-mode-prosp.md
│   ├── 06-companies.md
│   ├── 07-sourcing.md
│   ├── 08-stats.md
│   └── 09-settings.md
│
├── screenshots/                  ← rendus PNG des 12 écrans
│   └── *.png
│
└── prototype/                    ← prototype interactif (ouvrir l'HTML)
    ├── ProspUp Mobile 2026.html  ← entrée — ouvre dans un navigateur
    ├── design-canvas.jsx
    ├── ios-frame.jsx
    └── src/*.jsx
```

## 🚀 Comment utiliser avec Claude Code

1. Copie **tout** le dossier `design/` à la racine du repo.
2. Ouvre `design/prototype/ProspUp Mobile 2026.html` dans un navigateur → tu as le zoom/pan/focus sur chaque écran.
3. Dans Claude Code, lance :
   ```
   Lis design/PROMPT_CLAUDE_CODE.md et design/specs/*.md, 
   puis implémente les écrans un par un en suivant design/tokens/design_tokens.dart.
   ```
4. Pour chaque écran, Claude peut charger :
   - La **spec** correspondante (`design/specs/0X-xxx.md`)
   - Le **code JSX de référence** (`design/prototype/src/screen-xxx.jsx`) — même si c'est du React, la structure visuelle + les valeurs pixel-précises sont directement transposables en Flutter.
   - Le **screenshot** (`design/screenshots/0X-xxx.png`) comme preuve visuelle.

## 🎨 Système

- **Dark-first**, OLED `#000000`, warm off-white `#F6F5F2` en alternative
- **Accent unique** : orange ProspUp `#FF6B35` → gradient `#FF6B35 → #FF8C42`
- **Typographie** : SF Pro Display (titres) + SF Pro Text (UI)
- **Radius** : 8 / 12 / 18 / 24 / 999
- **Glass** : `backdrop-filter: blur(24px) saturate(180%)` sur tab bar + modales

## ✅ Conformité écran

Tous les écrans sont dimensionnés pour **iPhone 17 Pro** (402 × 874 pt) avec safe areas préservées :
- Status bar : 54 pt
- Home indicator : 34 pt
- Tab bar flottante : 64 pt (bottom 16, gauche/droite 12)
