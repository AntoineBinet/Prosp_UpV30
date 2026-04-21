// ─────────────────────────────────────────────────────────────
// ProspUp Mobile 2026 — Design tokens (Flutter / Dart)
// À placer dans lib/theme/design_tokens.dart
// ─────────────────────────────────────────────────────────────

import 'package:flutter/material.dart';

/// Marque
class PUBrand {
  static const accent       = Color(0xFFFF6B35);
  static const accentLight  = Color(0xFFFF8C42);
  static const accentSoft   = Color(0x1FFF6B35); // alpha 12%
  static const accentDim    = Color(0x99FF6B35); // alpha 60%

  static const gradient = LinearGradient(
    begin: Alignment.topLeft,
    end:   Alignment.bottomRight,
    colors: [accent, accentLight],
  );
}

/// Thème sombre (défaut)
class PUDark {
  static const bg       = Color(0xFF000000);
  static const bg2      = Color(0xFF0A0A0D);
  static const bg3      = Color(0xFF121217);
  static const bg4      = Color(0xFF1C1C22);

  static const text     = Color(0xFFF5F5F7);
  static const text2    = Color(0x99EBEBF5); // 60%
  static const text3    = Color(0x59EBEBF5); // 35%
  static const text4    = Color(0x2EEBEBF5); // 18%

  static const border   = Color(0x0FFFFFFF); // 6%
  static const border2  = Color(0x1AFFFFFF); // 10%
  static const divider  = Color(0x66545458); // 40%

  static const glass    = Color(0xB81C1C22); // 72%
}

/// Thème clair (warm off-white)
class PULight {
  static const bg       = Color(0xFFF6F5F2);
  static const bg2      = Color(0xFFFAF9F6);
  static const bg3      = Color(0xFFFFFFFF);
  static const bg4      = Color(0xFFF0EFEB);

  static const text     = Color(0xFF1A1916);
  static const text2    = Color(0xA63C3C43); // 65%
  static const text3    = Color(0x593C3C43); // 35%
  static const text4    = Color(0x2E3C3C43); // 18%

  static const border   = Color(0x0F000000);
  static const border2  = Color(0x1A000000);
  static const divider  = Color(0x1A3C3C43);

  static const glass    = Color(0xB8FFFFFF);
}

/// Couleurs de statut prospect (identiques dark/light)
enum PUStatus { appele, rdv, prospecte, messagerie, rappeler, pasInteresse, neutre }

class PUStatusColor {
  final Color fg, bg, dot;
  final String label;
  const PUStatusColor({required this.fg, required this.bg, required this.dot, required this.label});

  static const appele       = PUStatusColor(fg: Color(0xFF60A5FA), bg: Color(0x263B82F6), dot: Color(0xFF3B82F6), label: 'Appelé');
  static const rdv          = PUStatusColor(fg: Color(0xFF4ADE80), bg: Color(0x2622C55E), dot: Color(0xFF22C55E), label: 'RDV');
  static const prospecte    = PUStatusColor(fg: Color(0xFFC084FC), bg: Color(0x26A855F7), dot: Color(0xFFA855F7), label: 'Prospecté');
  static const messagerie   = PUStatusColor(fg: Color(0xFFFBBF24), bg: Color(0x26F59E0B), dot: Color(0xFFF59E0B), label: 'Messagerie');
  static const rappeler     = PUStatusColor(fg: Color(0xFFFB923C), bg: Color(0x26F97316), dot: Color(0xFFF97316), label: 'À rappeler');
  static const pasInteresse = PUStatusColor(fg: Color(0xFFF87171), bg: Color(0x26EF4444), dot: Color(0xFFEF4444), label: 'Pas intéressé');
  static const neutre       = PUStatusColor(fg: Color(0xFF94A3B8), bg: Color(0x2664748B), dot: Color(0xFF64748B), label: '—');

  static PUStatusColor of(PUStatus s) => switch (s) {
    PUStatus.appele       => appele,
    PUStatus.rdv          => rdv,
    PUStatus.prospecte    => prospecte,
    PUStatus.messagerie   => messagerie,
    PUStatus.rappeler     => rappeler,
    PUStatus.pasInteresse => pasInteresse,
    PUStatus.neutre       => neutre,
  };
}

/// Sémantique
class PUSemantic {
  static const success = Color(0xFF4ADE80);
  static const warning = Color(0xFFFBBF24);
  static const danger  = Color(0xFFF87171);
  static const info    = Color(0xFF60A5FA);
}

/// Rayons
class PURadius {
  static const double sm   = 8;
  static const double md   = 12;
  static const double lg   = 18;
  static const double xl   = 24;
  static const double xxl  = 28;
  static const double pill = 999;
}

/// Espacement (cohérent avec 4pt grid iOS)
class PUSpacing {
  static const double screenX = 16;
  static const double cardPad = 14;
  static const double section = 22;
  static const double row     = 6;
}

/// Typographie — SF Pro
class PUType {
  static const String family = '-apple-system'; // mappé sur "SF Pro Display/Text"

  static const largeTitle = TextStyle(fontSize: 34, fontWeight: FontWeight.w700, letterSpacing: -0.8, height: 1.1);
  static const title1     = TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.8);
  static const title2     = TextStyle(fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: -0.5);
  static const headline   = TextStyle(fontSize: 17, fontWeight: FontWeight.w600, letterSpacing: -0.3);
  static const body       = TextStyle(fontSize: 15, fontWeight: FontWeight.w400, letterSpacing: -0.2);
  static const callout    = TextStyle(fontSize: 14, fontWeight: FontWeight.w500, letterSpacing: -0.2);
  static const subhead    = TextStyle(fontSize: 13, fontWeight: FontWeight.w500, letterSpacing: -0.1);
  static const footnote   = TextStyle(fontSize: 12, fontWeight: FontWeight.w500);
  static const caption    = TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.3);  // UPPERCASE côté widget
  static const caption2   = TextStyle(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.4);
}

/// Device repère (iPhone 17 Pro)
class PUDevice {
  static const double width        = 402;
  static const double height       = 874;
  static const double safeTop      = 54;
  static const double safeBottom   = 34;
  static const double tabbarHeight = 64;
  static const double tabbarInsetB = 16;
  static const double tabbarInsetX = 12;
}

/// Helpers décorations utilisés partout
class PUDecos {
  static BoxDecoration card({required bool dark}) => BoxDecoration(
    color: dark ? PUDark.bg3 : PULight.bg3,
    borderRadius: BorderRadius.circular(PURadius.lg),
    border: Border.all(color: dark ? PUDark.border : PULight.border, width: 0.5),
  );

  static BoxDecoration accentRail({required bool dark}) => BoxDecoration(
    gradient: PUBrand.gradient,
    borderRadius: BorderRadius.circular(PURadius.lg),
    boxShadow: [
      BoxShadow(
        color: PUBrand.accent.withOpacity(0.35),
        blurRadius: 24, offset: const Offset(0, 10),
      ),
    ],
  );
}
