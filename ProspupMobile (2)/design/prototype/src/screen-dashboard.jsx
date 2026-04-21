// ─────────────────────────────────────────────────────────────
// Dashboard — XP ring, objectives, today activity
// ─────────────────────────────────────────────────────────────

function RingXP({ dark, value, max, level }) {
  const t = theme(dark ? 'dark' : 'light');
  const size = 148, stroke = 10, r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const pct = value / max;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} stroke={t.bg4} strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="url(#xpGrad)" strokeWidth={stroke}
          strokeLinecap="round" fill="none"
          strokeDasharray={`${C*pct} ${C}`} />
        <defs>
          <linearGradient id="xpGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#FF6B35" />
            <stop offset="100%" stopColor="#FFB088" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 11, color: t.text3, letterSpacing: 1, fontWeight: 600 }}>NIVEAU</div>
        <div style={{ fontSize: 40, fontWeight: 700, color: t.text, letterSpacing: -1, lineHeight: 1 }}>{level}</div>
        <div style={{ fontSize: 11, color: t.text2, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{value} / {max} XP</div>
      </div>
    </div>
  );
}

function ObjBar({ dark, obj }) {
  const t = theme(dark ? 'dark' : 'light');
  const pct = Math.min(1, obj.done / obj.target);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, color: t.text, fontWeight: 500 }}>{obj.label}</span>
        <span style={{ fontSize: 13, color: t.text2, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
          <span style={{ color: t.text, fontWeight: 600 }}>{obj.done}</span>
          <span style={{ opacity: .5 }}> / {obj.target}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: t.bg4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct*100}%`, background: obj.color, borderRadius: 3, transition: 'width .5s' }} />
      </div>
    </div>
  );
}

function ScreenDashboard({ dark = true, onTab, active = 'dashboard' }) {
  const t = theme(dark ? 'dark' : 'light');
  const totalDone = OBJECTIVES.reduce((s,o) => s + o.done, 0);
  const totalTarget = OBJECTIVES.reduce((s,o) => s + o.target, 0);
  const pct = Math.round(totalDone/totalTarget*100);

  return (
    <Device dark={dark} island={{ label: 'Rappel — Léa Bernard · 17h00', accent: T.accent }}>
      <Scroll dark={dark}>
        <LargeHeader dark={dark} title="Bonjour,"
          subtitle={<span>Mardi 21 avril · <span style={{ color: T.accent, fontWeight: 600 }}>Série de {XP.streak} jours 🔥</span></span>}
          trailing={
            <>
              <IconBtn dark={dark}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </IconBtn>
              <IconBtn dark={dark}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 1112 0v5l2 3H4l2-3V8zM9 19a3 3 0 006 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </IconBtn>
            </>
          } />

        {/* XP hero card */}
        <div style={{ margin: '8px 16px 0' }}>
          <div style={{
            borderRadius: 24, padding: 20, position: 'relative', overflow: 'hidden',
            background: dark
              ? 'linear-gradient(135deg, #1a1410 0%, #0f0e0c 100%)'
              : 'linear-gradient(135deg, #FFF6F0 0%, #FDECE1 100%)',
            border: `0.5px solid ${dark ? 'rgba(255,107,53,0.18)' : 'rgba(255,107,53,0.12)'}`,
            display: 'flex', alignItems: 'center', gap: 20,
          }}>
            <RingXP dark={dark} value={XP.current} max={XP.next} level={XP.level} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>Aujourd'hui</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: t.text, letterSpacing: -0.8, marginTop: 2 }}>
                +{XP.todayXp} <span style={{ fontSize: 14, color: T.accent, fontWeight: 600 }}>XP</span>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: t.text2, lineHeight: 1.45 }}>
                Plus que <b style={{ color: t.text }}>{XP.next - XP.current} XP</b> pour le niveau {XP.level + 1}.
              </div>
              <div style={{
                marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 999,
                background: T.accentSoft, color: T.accent,
                fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: T.accent, boxShadow: `0 0 6px ${T.accent}` }} />
                Objectif du jour {pct}%
              </div>
            </div>
          </div>
        </div>

        {/* Objectifs */}
        <SectionTitle dark={dark} title="Objectifs de la semaine" trailing={`${totalDone}/${totalTarget}`} />
        <div style={{ margin: '0 16px', padding: 16, borderRadius: 20, background: t.bg3, border: `0.5px solid ${t.border}` }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {OBJECTIVES.map(o => <ObjBar key={o.id} dark={dark} obj={o} />)}
          </div>
        </div>

        {/* Quick actions */}
        <SectionTitle dark={dark} title="Actions rapides" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px' }}>
          <QuickAction dark={dark} accent icon="bolt" title="Mode Prosp" sub="Reprendre — 17/42" />
          <QuickAction dark={dark} icon="phone" title="Focus" sub="6 relances dues" />
          <QuickAction dark={dark} icon="sparkles" title="Scrapping IA" sub="Enrichir fiche" />
          <QuickAction dark={dark} icon="plus" title="Ajouter" sub="Prospect · Société" />
        </div>

        {/* Activité */}
        <SectionTitle dark={dark} title="Activité du jour" trailing="Tout voir" trailingAccent />
        <div style={{ margin: '0 16px 20px', padding: 4, borderRadius: 20, background: t.bg3, border: `0.5px solid ${t.border}` }}>
          {ACTIVITY.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderBottom: i < ACTIVITY.length - 1 ? `0.5px solid ${t.divider}` : 'none',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: t.bg4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16,
              }}>{a.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: t.text, fontWeight: 500, letterSpacing: -0.1 }}>{a.text}</div>
                <div style={{ fontSize: 12, color: t.text2, marginTop: 1 }}>{a.sub}</div>
              </div>
              <div style={{ fontSize: 12, color: t.text3, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{a.when}</div>
            </div>
          ))}
        </div>
      </Scroll>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

function SectionTitle({ dark, title, trailing, trailingAccent }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '22px 20px 10px' }}>
      <div style={{ fontSize: 13, color: t.text2, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{title}</div>
      {trailing && <div style={{ fontSize: 13, color: trailingAccent ? T.accent : t.text3, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{trailing}</div>}
    </div>
  );
}

function QuickAction({ dark, icon, title, sub, accent }) {
  const t = theme(dark ? 'dark' : 'light');
  const ic = accent ? '#fff' : T.accent;
  return (
    <button style={{
      border: 'none', textAlign: 'left',
      padding: 14, borderRadius: 18,
      background: accent ? `linear-gradient(135deg, ${T.accent}, #FF8C42)` : t.bg3,
      boxShadow: accent ? '0 8px 20px rgba(255,107,53,0.3)' : 'none',
      border0: `0.5px solid ${t.border}`,
      cursor: 'pointer', color: accent ? '#fff' : t.text,
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
      fontFamily: font,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10,
        background: accent ? 'rgba(255,255,255,0.2)' : T.accentSoft,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: ic,
      }}>
        {icon === 'bolt' && <svg width="16" height="16" viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/></svg>}
        {icon === 'phone' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>}
        {icon === 'sparkles' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill="currentColor"/></svg>}
        {icon === 'plus' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>{title}</div>
        <div style={{ fontSize: 11, opacity: accent ? 0.85 : 0.55, marginTop: 2 }}>{sub}</div>
      </div>
    </button>
  );
}

Object.assign(window, { ScreenDashboard });
