// ─────────────────────────────────────────────────────────────
// iPhone shell — frame, status bar, dynamic island (glass), home indicator,
// liquid glass bottom tab bar with sliding indicator.
// ─────────────────────────────────────────────────────────────

// Dimensions iPhone 17 Pro (402 x 874) — base iOS 26
const DEVICE_W = 402;
const DEVICE_H = 874;

// ── Status bar ────────────────────────────────────────────────
function StatusBar({ dark, time = '9:41' }) {
  const c = dark ? '#fff' : '#000';
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '18px 32px 0', height: 54, boxSizing: 'border-box',
      pointerEvents: 'none',
    }}>
      <span style={{ fontFamily: font, fontWeight: 600, fontSize: 16, color: c, letterSpacing: -0.2 }}>{time}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* signal */}
        <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx=".6" fill={c}/><rect x="4.5" y="4.5" width="3" height="6.5" rx=".6" fill={c}/><rect x="9" y="2" width="3" height="9" rx=".6" fill={c}/><rect x="13.5" y="-.5" width="3" height="11.5" rx=".6" fill={c}/></svg>
        {/* wifi */}
        <svg width="15" height="11" viewBox="0 0 15 11"><path d="M7.5 3C9.6 3 11.5 3.8 13 5.2l1-1C12.3 2.7 10 1.5 7.5 1.5S2.7 2.7 1 4.2l1 1C3.5 3.8 5.4 3 7.5 3z" fill={c}/><path d="M7.5 6c1.3 0 2.4.5 3.3 1.3l1-1C10.7 5.2 9.2 4.5 7.5 4.5S4.3 5.2 3.2 6.3l1 1C5.1 6.5 6.2 6 7.5 6z" fill={c}/><circle cx="7.5" cy="9.5" r="1.3" fill={c}/></svg>
        {/* battery */}
        <svg width="25" height="12" viewBox="0 0 25 12"><rect x=".5" y=".5" width="21" height="11" rx="3" stroke={c} strokeOpacity=".4" fill="none"/><rect x="2" y="2" width="18" height="8" rx="1.5" fill={c}/><path d="M23 4v4c.7-.2 1.2-.9 1.2-2S23.7 4.2 23 4z" fill={c} opacity=".4"/></svg>
      </div>
    </div>
  );
}

// ── Dynamic Island (static, glossy) ───────────────────────────
function DynamicIsland({ expanded, label, accent, dark }) {
  const bg = '#000';
  return (
    <div style={{
      position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)',
      height: 37, background: bg, borderRadius: 24,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 40, overflow: 'hidden',
      width: expanded ? 220 : 126,
      transition: 'width .3s cubic-bezier(.32,1.08,.62,1)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      color: '#fff', fontFamily: font, fontSize: 12, fontWeight: 600,
      gap: 8, padding: expanded ? '0 14px' : 0,
    }}>
      {expanded && (
        <>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: accent || '#FF6B35', boxShadow: `0 0 8px ${accent || '#FF6B35'}` }} />
          <span style={{ flex: 1, textAlign: 'left', opacity: .9, whiteSpace: 'nowrap' }}>{label}</span>
          <span style={{ fontSize: 11, opacity: .5, fontVariantNumeric: 'tabular-nums' }}>LIVE</span>
        </>
      )}
    </div>
  );
}

// ── Home indicator ────────────────────────────────────────────
function HomeIndicator({ dark }) {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60,
      height: 34, display: 'flex', justifyContent: 'center', alignItems: 'flex-end',
      paddingBottom: 9, pointerEvents: 'none',
    }}>
      <div style={{ width: 134, height: 5, borderRadius: 100, background: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.25)' }} />
    </div>
  );
}

// ── iOS device frame ──────────────────────────────────────────
function Device({ children, dark = true, island = null, fill }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{
      width: DEVICE_W, height: DEVICE_H, borderRadius: 52,
      position: 'relative', overflow: 'hidden',
      background: fill || t.bg,
      boxShadow: dark
        ? '0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)'
        : '0 40px 80px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
      fontFamily: font, WebkitFontSmoothing: 'antialiased',
      color: t.text,
    }}>
      <StatusBar dark={dark} />
      <DynamicIsland dark={dark} expanded={!!island} label={island?.label} accent={island?.accent} />
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', paddingTop: 54 }}>
        {children}
      </div>
      <HomeIndicator dark={dark} />
    </div>
  );
}

// ── Glass pill (reusable) ─────────────────────────────────────
function Glass({ children, dark, style = {}, radius = 999, padding }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{
      position: 'relative', borderRadius: radius, overflow: 'hidden',
      padding, display: 'inline-flex', alignItems: 'center',
      ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0, borderRadius: radius,
        background: t.glass,
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        boxShadow: t.glassShine,
        border: `0.5px solid ${t.glassBorder}`,
      }} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', width: '100%' }}>
        {children}
      </div>
    </div>
  );
}

// ── Bottom tab bar w/ sliding pill indicator ──────────────────
const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'prospects', label: 'Prospects', icon: 'people' },
  { id: 'prosp',     label: 'Prosp',     icon: 'bolt', primary: true },
  { id: 'entreprises', label: 'Sociétés', icon: 'building' },
  { id: 'stats',     label: 'Stats',     icon: 'chart' },
];

function TabIcon({ name, color, size = 22 }) {
  const s = size;
  const stroke = color;
  switch (name) {
    case 'home':
      return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M4 11.5L12 5l8 6.5V19a2 2 0 01-2 2h-3v-6h-6v6H6a2 2 0 01-2-2v-7.5z" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round"/></svg>;
    case 'people':
      return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" stroke={stroke} strokeWidth="1.8"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={stroke} strokeWidth="1.8" strokeLinecap="round"/><circle cx="17" cy="7" r="2.8" stroke={stroke} strokeWidth="1.6"/><path d="M15 14c3.3 0 6 2.2 6 5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round"/></svg>;
    case 'bolt':
      return <svg width={s+2} height={s+2} viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill={stroke}/></svg>;
    case 'building':
      return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke={stroke} strokeWidth="1.8"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" stroke={stroke} strokeWidth="1.8" strokeLinecap="round"/></svg>;
    case 'chart':
      return <svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16" stroke={stroke} strokeWidth="1.8" strokeLinecap="round"/><rect x="7"  y="12" width="2.8" height="5" rx="1" fill={stroke}/><rect x="12" y="8"  width="2.8" height="9" rx="1" fill={stroke}/><rect x="17" y="4"  width="2.8" height="13" rx="1" fill={stroke}/></svg>;
  }
  return null;
}

function TabBar({ active = 'dashboard', dark = true, onTab }) {
  const t = theme(dark ? 'dark' : 'light');
  const idx = TABS.findIndex(x => x.id === active);
  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 12, right: 12, zIndex: 50,
      height: 64,
    }}>
      <Glass dark={dark} radius={28} style={{
        height: '100%', width: '100%', padding: 4,
        boxShadow: dark
          ? '0 10px 30px rgba(0,0,0,0.45)'
          : '0 10px 30px rgba(0,0,0,0.08)',
      }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
          {/* sliding indicator pill */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            width: `${100 / TABS.length}%`,
            left: `${(idx * 100) / TABS.length}%`,
            transition: 'left .35s cubic-bezier(.32,1.08,.62,1)',
            padding: 6,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: 20,
              background: T.accentSoft,
              boxShadow: 'inset 0 0 0 0.5px ' + 'rgba(255,107,53,0.22)',
            }} />
          </div>
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            const color = isActive ? T.accent : t.text2;
            return (
              <button key={tab.id} onClick={() => onTab && onTab(tab.id)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  border: 'none', background: 'transparent',
                  cursor: 'pointer', padding: 0, color,
                  fontFamily: font, fontSize: 10, fontWeight: 600, letterSpacing: 0.1,
                  position: 'relative', zIndex: 1,
                }}>
                <TabIcon name={tab.icon} color={color} size={tab.primary ? 24 : 22} />
                <span style={{ opacity: isActive ? 1 : 0.8 }}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </Glass>
    </div>
  );
}

// ── Large title header ────────────────────────────────────────
function LargeHeader({ title, subtitle, dark, leading, trailing }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{ padding: '8px 20px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, minHeight: 36 }}>
        <div>{leading}</div>
        <div style={{ display: 'flex', gap: 8 }}>{trailing}</div>
      </div>
      <h1 style={{
        margin: 0, fontSize: 34, fontWeight: 700, letterSpacing: -0.8,
        color: t.text, lineHeight: 1.1,
      }}>{title}</h1>
      {subtitle && <div style={{
        marginTop: 4, fontSize: 14, color: t.text2, fontWeight: 400, letterSpacing: -0.1,
      }}>{subtitle}</div>}
    </div>
  );
}

// ── Scroll area (content below header, above tab bar) ─────────
function Scroll({ children, dark, hasTabBar = true, pad = true }) {
  return (
    <div style={{
      flex: 1, overflow: 'auto',
      paddingBottom: hasTabBar ? 96 : 34,
      paddingLeft: pad ? 0 : 0, paddingRight: pad ? 0 : 0,
      WebkitOverflowScrolling: 'touch',
    }}>{children}</div>
  );
}

// ── Glass circular icon button ────────────────────────────────
function IconBtn({ children, dark, size = 36, onClick }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: size / 2,
      background: t.glass, border: `0.5px solid ${t.glassBorder}`,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: t.text, cursor: 'pointer', padding: 0,
    }}>{children}</button>
  );
}

Object.assign(window, {
  DEVICE_W, DEVICE_H, Device, TabBar, TABS,
  LargeHeader, Scroll, Glass, IconBtn, StatusBar, DynamicIsland, HomeIndicator,
  TabIcon,
});
