# Prompt Claude Code — Refonte Mobile ProspUp 2026

> **À coller tel quel dans Claude Code, à la racine du repo `prospup`.**
> Contexte : tu vas implémenter une refonte UI mobile inspirée d'iOS 26 (Liquid Glass) sur l'app Flutter ProspUp existante (hybride web/mobile). La charte orange historique (#FF6B35 + dérivés) est **conservée**, c'est la grammaire visuelle qui évolue : dark-first OLED, typographie SF, dynamic island, tab bar translucide, cards minimales, plus de gamification XP.
>
> Un prototype visuel de référence a été produit : **`ProspUp Mobile 2026.html`** + dossier `src/*.jsx` (React). Il contient les 9 écrans clés (Login, Dashboard, Prospects, Fiche prospect, Mode Prosp, Sociétés, Sourcing IA, Stats, Réglages) en versions dark et claire. Traite-le comme une **spec visuelle de référence** : récupère couleurs, espacements, hiérarchies, comportements. Ne copie pas le React — tu vas produire du Flutter/Dart.

---

## 0 · Étape préalable : auto-onboarding

1. Lis dans cet ordre pour te faire une carte mentale du repo :
   - `CLAUDE.md` si présent, sinon `README.md`
   - `pubspec.yaml` (versions Flutter, plugins utilisés)
   - `lib/main.dart`
   - `lib/app.dart` ou équivalent (routing, MaterialApp/CupertinoApp)
   - `lib/core/theme/` (ou chemin équivalent pour thème)
   - Un écran existant représentatif : `lib/features/prospects/` (ou nom équivalent). Si l'arbo diffère, cherche via `grep -r "Prospect" lib/`.
2. **Ne lance aucune modification avant d'avoir renvoyé en réponse** : une arbo commentée du projet + la liste des fichiers que tu comptes créer/modifier + les incertitudes que tu as. Attends validation.

---

## 1 · Objectifs de la refonte

### Ce qui change
- **Thème dark-first** (OLED `#000000`) + thème clair warm off-white (`#F6F5F2`). L'utilisateur peut basculer via Réglages. Par défaut : dark.
- **Typographie** : SF Pro (iOS) / Roboto Flex (Android) via `google_fonts` ou assets locaux. Tailles : large title 34pt / title 22pt / body 15pt / caption 12pt. Letter-spacing négatif sur les gros titres (-0.8 à -0.2).
- **Navigation** : bottom tab bar flottante en **liquid glass** (BackdropFilter + blur + saturate), avec pill d'indicateur qui glisse à l'active change. 5 onglets : Dashboard · Prospects · **Prosp** (primary, icône éclair) · Sociétés · Stats.
- **Gamification XP** : niveau, barre de progression, streak quotidien, +XP par action (appel = 10, RDV pris = 50, nouveau prospect = 5, etc.). Stocké côté backend si API existe, sinon local pour la V1.
- **Dynamic Island** simulée sur iOS (utiliser `flutter_dynamic_island` ou un widget custom positionné) pour les rappels en cours (ex : "Rappel Léa Bernard · 17h00").
- **Cartes prospect** minimalistes : rail de couleur à gauche selon le statut, chips métadata, pas de grosses bordures.
- **Mode Prosp** : stack de cartes façon Tinder (swipe gauche = suivant, droite = appeler, haut = fiche). Utiliser `flutter_card_swiper` ou équivalent, sinon GestureDetector + AnimatedPositioned maison.

### Ce qui ne change pas
- Toute la logique métier (providers/blocs, API, models, repositories).
- Les noms de statuts (`appele`, `rdv`, `prospecte`, `messagerie`, `rappeler`, `pasInteresse`).
- La charte orange `#FF6B35` reste l'accent unique.
- Le schéma de routing.

---

## 2 · Design tokens à créer

Crée `lib/core/theme/prospup_tokens.dart` qui expose :

```dart
class ProspUpTokens {
  // Accent (inchangé)
  static const accent       = Color(0xFFFF6B35);
  static const accentSoft   = Color(0x1FFF6B35); // 12% alpha
  static const accentGrad   = LinearGradient(colors: [Color(0xFFFF6B35), Color(0xFFFF8C42)]);

  // Status colors
  static const statusAppele       = Color(0xFF3B82F6);
  static const statusRdv          = Color(0xFF22C55E);
  static const statusProspecte    = Color(0xFFA855F7);
  static const statusMessagerie   = Color(0xFFF59E0B);
  static const statusRappeler     = Color(0xFFF97316);
  static const statusPasInteresse = Color(0xFFEF4444);

  // Rayons
  static const rSm = 8.0, rMd = 12.0, rLg = 18.0, rXl = 24.0, rPill = 999.0;
}
```

Puis `lib/core/theme/prospup_theme.dart` avec deux `ThemeData` (dark/light) qui reprennent les palettes du proto :

| Token      | Dark                  | Light                |
|------------|-----------------------|----------------------|
| `bg`       | `#000000`             | `#F6F5F2`            |
| `bg2`      | `#0A0A0D`             | `#FAF9F6`            |
| `bg3`      | `#121217` (cards)     | `#FFFFFF` (cards)    |
| `bg4`      | `#1C1C22` (inputs)    | `#F0EFEB`            |
| `text`     | `#F5F5F7`             | `#1A1916`            |
| `text2`    | 60% opacity           | 65% opacity          |
| `divider`  | `rgba(84,84,88,0.4)`  | `rgba(60,60,67,0.1)` |

Expose-les via `Theme.of(context).extension<ProspUpColors>()` (extension `ThemeExtension`) pour que chaque écran puisse les lire sans dépendre du mode.

---

## 3 · Composants partagés à créer

À placer dans `lib/core/ui/`.

1. **`GlassContainer`** : widget `ClipRRect` + `BackdropFilter(blur=24, saturate via ImageFilter)` + overlay translucide + border 0.5px. Paramètres : `radius`, `child`, `tint` (auto selon theme).
2. **`ProspUpTabBar`** : bottom bar flottante (16px du bas, marge 12px latérale), 64px de haut, glass, 5 onglets avec pill orange qui glisse (`AnimatedPositioned`). Icônes SVG inline (lucide-like) — déjà dessinées dans `src/shell.jsx` → `TabIcon`.
3. **`LargeHeader`** : titre 34pt + sous-titre optionnel + slots leading/trailing. Padding `8px 20px 12px`.
4. **`StatusPill`** : pill avec dot + label, prend un `ProspectStatus` enum, utilise les couleurs ci-dessus avec fond à 15% opacity.
5. **`PertinenceStars`** : 5 étoiles SVG, remplies selon `n/5` avec `accent`.
6. **`ProspectCard`** : rail de statut 4px à gauche, nom+société+rôle, chips (RELANCE, RDV, téléphone/mail/linkedin). Cf. `src/screen-prospects.jsx` > `ProspectCard`.
7. **`XPRing`** : ring de progression avec dégradé orange, niveau au centre. Utiliser `CustomPainter`.
8. **`GlassIconBtn`** : bouton circulaire 36px glass pour les top-bars.

Pour chaque composant : écris un golden test minimal (`flutter_test` + `golden_toolkit`) si l'infra existe déjà dans le repo, sinon skip.

---

## 4 · Écrans à refondre

Ordre de priorité. Pour chacun : conserve les providers/blocs/states existants, remplace **uniquement** le widget tree. Si l'écran lit des données qui n'existent pas dans le model (ex : `xp`, `streak`), ajoute-les au model avec valeur par défaut (0 / null) et TODO pour le back.

| # | Écran                | Fichier probable                              | Référence visuelle                 |
|---|----------------------|-----------------------------------------------|-------------------------------------|
| 1 | Login                | `lib/features/auth/login_screen.dart`         | `src/screen-login.jsx`              |
| 2 | Dashboard            | `lib/features/dashboard/dashboard_screen.dart`| `src/screen-dashboard.jsx`          |
| 3 | Liste Prospects      | `lib/features/prospects/prospects_screen.dart`| `src/screen-prospects.jsx`          |
| 4 | Fiche Prospect       | `lib/features/prospects/prospect_detail.dart` | `src/screen-detail.jsx`             |
| 5 | Mode Prosp           | `lib/features/prosp/prosp_mode.dart`          | `src/screen-prosp.jsx`              |
| 6 | Sociétés             | `lib/features/companies/companies_screen.dart`| `src/screen-companies.jsx`          |
| 7 | Sourcing IA          | `lib/features/sourcing/sourcing_screen.dart`  | `src/screen-sourcing.jsx`           |
| 8 | Stats                | `lib/features/stats/stats_screen.dart`        | `src/screen-stats.jsx`              |
| 9 | Réglages             | `lib/features/settings/settings_screen.dart`  | `src/screen-settings.jsx`           |

**Comportements clés à ne pas oublier** :
- Mode Prosp : décompte `n/total` en haut, barre de progression, appel auto si option "Auto-appel après 3s" activée dans réglages.
- Fiche prospect : s'ouvre en bottom sheet modal (`showModalBottomSheet` avec `isScrollControlled: true`, barre de drag en haut).
- Dashboard : tap sur la carte XP ouvre un détail XP (à prévoir mais hors V1).
- Dynamic Island : n'afficher que si un rappel est dans les 30 min.

---

## 5 · Contraintes techniques

- **Flutter stable ≥ 3.24** (vérifie `pubspec.yaml`, mets à jour si < 3.19).
- **Packages à ajouter** si pas déjà présents :
  - `google_fonts` (SF Pro fallback → Inter si absent côté licence)
  - `flutter_svg` (icônes)
  - `shared_preferences` pour persister `themeMode` et `xp` en local
- **Accessibilité** : `Semantics` sur tab bar, `MergeSemantics` sur cards prospect, contrast ratio minimum 4.5:1 pour le texte secondaire.
- **Performance** : `ListView.builder` partout, pas de `Column+SingleChildScrollView` sur des listes >20 items. `const` constructors maximisés.
- **Tests** : au minimum widget test par écran qui vérifie qu'il build sans throw en dark + light.

---

## 6 · Méthode de travail attendue

Travaille **par PR mentales** (un commit logique à la fois) :

1. Setup tokens + thème + extension
2. Shell (tab bar, headers, glass)
3. Login
4. Dashboard
5. Prospects list + card
6. Prospect detail (bottom sheet)
7. Mode Prosp
8. Sociétés
9. Sourcing
10. Stats
11. Settings + toggle theme

Après chaque étape : `flutter analyze` doit être clean, `flutter test` passe, et **tu me renvoies un résumé de 5-10 lignes + un diff bref** (liste fichiers touchés) avant de passer à la suivante. Pas de gros dump.

---

## 7 · Ce que je te fournis

- `ProspUp Mobile 2026.html` — le canvas visuel global (ouvre-le dans le navigateur pour comprendre l'intention)
- `src/tokens.jsx`, `src/shell.jsx`, `src/data.jsx` — tokens + composants transverses
- `src/screen-*.jsx` — 1 fichier par écran, tous auto-contenus
- `src/screen-prosp.jsx` — **lis celui-ci en premier**, c'est l'expérience signature et la plus spécifique

## 8 · Première réponse attendue

1. Arbo commentée du repo
2. Liste des fichiers que tu vas créer / modifier (avec chemins)
3. Les 3-5 incertitudes principales (modèles de données, routing, packages manquants)
4. **STOP** — attends validation avant d'écrire du Dart.

Go.
