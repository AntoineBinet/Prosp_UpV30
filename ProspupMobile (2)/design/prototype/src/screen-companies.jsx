// ─────────────────────────────────────────────────────────────
// Companies list
// ─────────────────────────────────────────────────────────────

function ScreenCompanies({ dark = true, onTab, active = 'entreprises' }) {
  const t = theme(dark ? 'dark' : 'light');

  return (
    <Device dark={dark}>
      <LargeHeader dark={dark} title="Sociétés" subtitle="68 actives · 7 secteurs"
        trailing={
          <>
            <IconBtn dark={dark}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </IconBtn>
            <IconBtn dark={dark}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </IconBtn>
          </>
        } />

      {/* Segmented */}
      <div style={{ margin: '0 16px 14px', padding: 3, borderRadius: 12, background: t.bg4, display: 'flex' }}>
        {['Toutes', 'Favoris', 'Récentes'].map((x, i) => (
          <button key={x} style={{
            flex: 1, height: 32, border: 'none', cursor: 'pointer', fontFamily: font,
            borderRadius: 9, background: i === 0 ? t.bg3 : 'transparent',
            color: i === 0 ? t.text : t.text2, fontWeight: i === 0 ? 600 : 500, fontSize: 13,
            boxShadow: i === 0 ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}>{x}</button>
        ))}
      </div>

      <Scroll dark={dark}>
        <div style={{ display: 'grid', gap: 10, padding: '0 16px' }}>
          {COMPANIES.map(c => <CompanyRow key={c.id} dark={dark} c={c} />)}
        </div>
        <div style={{ padding: 20, textAlign: 'center', color: t.text3, fontSize: 12 }}>— Fin —</div>
      </Scroll>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

function CompanyRow({ dark, c }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 12, borderRadius: 16, background: t.bg3,
      border: `0.5px solid ${t.border}`,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
        background: c.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: 0.5,
        boxShadow: `0 4px 12px ${c.accent}55`,
      }}>{c.logo}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text, letterSpacing: -0.2 }}>{c.name}</div>
        <div style={{ fontSize: 12, color: t.text2, marginTop: 1 }}>
          {c.sector} · {c.city}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <MiniStat dark={dark} v={c.prospects} l="prospects" />
          <MiniStat dark={dark} v={c.activeDeals} l="deals" highlight={c.activeDeals > 0} />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 10, color: t.text3, letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 600 }}>Activité</div>
        <div style={{ fontSize: 11, color: t.text2, marginTop: 2 }}>{c.lastTouch}</div>
      </div>
    </div>
  );
}

function MiniStat({ dark, v, l, highlight }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: highlight ? T.accent : t.text, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      <span style={{ fontSize: 11, color: t.text3 }}>{l}</span>
    </div>
  );
}

Object.assign(window, { ScreenCompanies });
