# 00 · Système global

## Principes
- **Dark-first**, OLED `#000000`. Variante claire warm off-white `#F6F5F2`.
- **Un seul accent** : orange ProspUp `#FF6B35` (+ `#FF8C42` en gradient). Pas d'autres couleurs de marque.
- **Calme avant tout** : beaucoup d'espace, pas de bordure dure, pas de gradient de fond sauf hero.
- **Liquid glass** réservé à 3 usages : tab bar, barre de recherche flottante, modales.

## Grille & safe areas (iPhone 17 Pro — 402 × 874)
| Zone | Valeur |
|---|---|
| Status bar | 54 pt |
| Home indicator | 34 pt |
| Padding horizontal écran | 16 pt |
| Padding carte | 14 pt |
| Gap entre sections | 22 pt |
| Gap entre cartes | 6–10 pt |
| Tab bar flottante | 64 pt, bottom 16, inset 12 |
| Dynamic Island | top 11, w 126 (collapsed) / 220 (expanded), h 37 |

## Radius
- 8 (chips, pills status)
- 12 (inputs, small cards)
- 18 (cards standard, boutons primaires)
- 24 (hero card XP)
- 28 (card Mode Prosp)
- 999 (tab bar, filter chips, boutons ronds)

## Typographie (SF Pro)
| Role | Size | Weight | Letter-spacing | Usage |
|---|---|---|---|---|
| Large title | 34 | 700 | -0.8 | `h1` des écrans |
| Title 1 | 28 | 700 | -0.8 | KPI, XP badge |
| Title 2 | 22 | 700 | -0.5 | nom prospect en fiche |
| Headline | 17 | 600 | -0.3 | nom société, profil |
| Body | 15 | 400 | -0.2 | description |
| Callout | 14 | 500 | -0.2 | cell label |
| Subhead | 13 | 500 | -0.1 | meta lignes |
| Footnote | 12 | 500 | — | subtitle, helper |
| Caption | 11 | 600 | +0.3 UPPERCASE | section titles |
| Caption2 | 10 | 700 | +0.4 UPPERCASE | badges |

## Ombres
- **Card standard** : aucune (bordure 0.5px à la place).
- **Card hero / modale** : `0 30px 60px rgba(0,0,0,.5)` (dark) / `0 30px 60px rgba(0,0,0,.12)` (light).
- **Bouton primaire** : `0 10px 24px rgba(255,107,53,.35)` + inset highlight 18%.

## Icônes
- SF Symbols (ou équivalent Phosphor/Lucide "thin") à 22 pt.
- Stroke 1.8 pour outlines, 2.0 pour gras.
- Jamais d'icône décorative (pas d'emoji dans l'UI, sauf Activity feed).

## Vibrations (iOS Haptics)
- `selection` — tap chip, toggle
- `impact.light` — swipe Mode Prosp
- `impact.medium` — décrocher, décision
- `notification.success` — RDV pris / objectif atteint

## États vides
- Illustration SVG monochrome accent.
- Titre body 15/600, sub body 13/400 text2.
- Bouton primaire centré.
