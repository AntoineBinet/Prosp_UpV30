// ─────────────────────────────────────────────────────────────
// ProspUp Mobile 2026 — Design tokens
// Calme, premium, minimal. Orange accent. iOS 26 liquid glass.
// ─────────────────────────────────────────────────────────────

const T = {
  // Accents
  accent: '#FF6B35',          // orange principal (héritage ProspUp)
  accentSoft: 'rgba(255,107,53,0.12)',
  accentDim: 'rgba(255,107,53,0.6)',

  // Status colors (conservés du CSS existant pour cohérence data)
  status: {
    appele:        { fg: '#60A5FA', bg: 'rgba(59,130,246,0.15)',  dot: '#3B82F6' },
    rdv:           { fg: '#4ADE80', bg: 'rgba(34,197,94,0.15)',   dot: '#22C55E' },
    prospecte:     { fg: '#C084FC', bg: 'rgba(168,85,247,0.15)',  dot: '#A855F7' },
    messagerie:    { fg: '#FBBF24', bg: 'rgba(245,158,11,0.15)',  dot: '#F59E0B' },
    rappeler:      { fg: '#FB923C', bg: 'rgba(249,115,22,0.15)',  dot: '#F97316' },
    pasInteresse:  { fg: '#F87171', bg: 'rgba(239,68,68,0.15)',   dot: '#EF4444' },
    neutre:        { fg: '#94A3B8', bg: 'rgba(148,163,184,0.15)', dot: '#64748B' },
  },
};

// Dark theme tokens — OLED, warm-toned blacks
const dark = {
  bg:         '#000000',          // OLED true black
  bg2:        '#0A0A0D',          // surface 1
  bg3:        '#121217',          // surface 2 (cards)
  bg4:        '#1C1C22',          // surface 3 (inputs)
  text:       '#F5F5F7',
  text2:      'rgba(235,235,245,0.6)',
  text3:      'rgba(235,235,245,0.35)',
  text4:      'rgba(235,235,245,0.18)',
  border:     'rgba(255,255,255,0.06)',
  border2:    'rgba(255,255,255,0.10)',
  divider:    'rgba(84,84,88,0.4)',
  // liquid glass
  glass:      'rgba(28,28,34,0.72)',
  glassBorder:'rgba(255,255,255,0.08)',
  glassShine: 'inset 0.5px 0.5px 0 rgba(255,255,255,0.08), inset -0.5px -0.5px 0 rgba(255,255,255,0.03)',
};

// Light theme tokens — warm off-white (Apple Mail / Notes 2026)
const light = {
  bg:         '#F6F5F2',          // warm off-white
  bg2:        '#FAF9F6',
  bg3:        '#FFFFFF',
  bg4:        '#F0EFEB',
  text:       '#1A1916',
  text2:      'rgba(60,60,67,0.65)',
  text3:      'rgba(60,60,67,0.35)',
  text4:      'rgba(60,60,67,0.18)',
  border:     'rgba(0,0,0,0.06)',
  border2:    'rgba(0,0,0,0.10)',
  divider:    'rgba(60,60,67,0.10)',
  glass:      'rgba(255,255,255,0.72)',
  glassBorder:'rgba(0,0,0,0.06)',
  glassShine: 'inset 0.5px 0.5px 0 rgba(255,255,255,0.9), inset -0.5px -0.5px 0 rgba(0,0,0,0.03)',
};

const theme = (mode) => mode === 'dark' ? dark : light;

// Type scale — SF Pro metrics
const font = '-apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';
const fontMono = 'ui-monospace, "SF Mono", Menlo, monospace';

// Radii
const R = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 };

Object.assign(window, { T, theme, font, fontMono, R });
