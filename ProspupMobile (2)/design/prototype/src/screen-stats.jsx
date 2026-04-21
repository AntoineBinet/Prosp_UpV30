// ─────────────────────────────────────────────────────────────
// Stats — KPIs, chart, leaderboard
// ─────────────────────────────────────────────────────────────

const CHART_DATA = [
  { day: 'L', calls: 14, rdv: 2 },
  { day: 'M', calls: 22, rdv: 3 },
  { day: 'M', calls: 18, rdv: 1 },
  { day: 'J', calls: 28, rdv: 4 },
  { day: 'V', calls: 25, rdv: 3 },
  { day: 'S', calls: 5,  rdv: 0 },
  { day: 'D', calls: 0,  rdv: 0 },
];

function ScreenStats({ dark = true, onTab, active = 'stats' }) {
  const t = theme(dark ? 'dark' : 'light');

  return (
    <Device dark={dark}>
      <LargeHeader dark={dark} title="Stats"
        subtitle="Semaine 17 · du 14 au 20 avril"
        trailing={
          <Glass dark={dark} radius={10} padding="6px 10px" style={{ fontSize: 12, color: t.text, fontWeight: 500 }}>
            Semaine
            <svg width="10" height="6" viewBox="0 0 10 6" style={{ marginLeft: 6 }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"/></svg>
          </Glass>
        } />

      <Scroll dark={dark}>
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px' }}>
          <Kpi dark={dark} label="Appels" value="112" delta="+23%" up />
          <Kpi dark={dark} label="RDV pris" value="13" delta="+18%" up />
          <Kpi dark={dark} label="Taux décro." value="41%" delta="-4%" />
          <Kpi dark={dark} label="Pipeline" value="€84k" delta="+12%" up accent />
        </div>

        <SectionTitle dark={dark} title="Activité · 7 jours" trailing="Comparer" trailingAccent />
        <div style={{ margin: '0 16px', padding: 18, borderRadius: 20, background: t.bg3, border: `0.5px solid ${t.border}` }}>
          <Chart data={CHART_DATA} dark={dark} />
          <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 11 }}>
            <Legend color={T.accent} label="Appels" />
            <Legend color="#4ADE80" label="RDV pris" />
          </div>
        </div>

        <SectionTitle dark={dark} title="Classement équipe" trailing="#2 sur 8" trailingAccent />
        <div style={{ margin: '0 16px 20px', borderRadius: 20, background: t.bg3, border: `0.5px solid ${t.border}`, overflow: 'hidden' }}>
          {[
            { rank: 1, name: 'Julien M.',   xp: 3820, me: false },
            { rank: 2, name: 'Antoine (toi)', xp: 2340, me: true },
            { rank: 3, name: 'Paul R.',     xp: 2180, me: false },
            { rank: 4, name: 'Sofia L.',    xp: 1920, me: false },
          ].map((r, i) => (
            <div key={r.rank} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              background: r.me ? T.accentSoft : 'transparent',
              borderBottom: i < 3 ? `0.5px solid ${t.divider}` : 'none',
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 8,
                background: r.rank === 1 ? 'linear-gradient(135deg,#FBBF24,#F59E0B)' : r.me ? T.accent : t.bg4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                color: r.rank === 1 ? '#000' : r.me ? '#fff' : t.text2,
              }}>{r.rank}</div>
              <div style={{ flex: 1, fontSize: 14, color: t.text, fontWeight: r.me ? 600 : 500, letterSpacing: -0.2 }}>{r.name}</div>
              <div style={{ fontSize: 13, color: r.me ? T.accent : t.text, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.xp.toLocaleString('fr-FR')} XP</div>
            </div>
          ))}
        </div>
      </Scroll>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

function Kpi({ dark, label, value, delta, up, accent }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{
      padding: 16, borderRadius: 18,
      background: accent
        ? (dark ? 'linear-gradient(135deg, rgba(255,107,53,0.15), rgba(255,107,53,0.04))' : 'linear-gradient(135deg, rgba(255,107,53,0.08), rgba(255,107,53,0.02))')
        : t.bg3,
      border: `0.5px solid ${accent ? 'rgba(255,107,53,0.2)' : t.border}`,
    }}>
      <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent ? T.accent : t.text, letterSpacing: -0.8, marginTop: 4, lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 11, color: up ? '#4ADE80' : '#F87171', fontWeight: 600 }}>
        {up ? '↗' : '↘'} {delta} <span style={{ color: t.text3, fontWeight: 500 }}>vs S-1</span>
      </div>
    </div>
  );
}

function Chart({ data, dark }) {
  const t = theme(dark ? 'dark' : 'light');
  const W = 300, H = 140, pad = 8;
  const max = Math.max(...data.map(d => d.calls));
  const bw = (W - pad*2) / data.length;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 24}`} style={{ display: 'block' }}>
      {/* grid */}
      {[0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={pad} x2={W-pad} y1={H - H*f} y2={H - H*f} stroke={t.divider} strokeDasharray="2 3" strokeWidth="0.5"/>
      ))}
      {data.map((d, i) => {
        const x = pad + i * bw + bw/2;
        const hCalls = (d.calls / max) * H * 0.9;
        const hRdv = (d.rdv / 5) * H * 0.9;
        return (
          <g key={i}>
            <rect x={x - 10} y={H - hCalls} width="7" height={hCalls} rx="3" fill={T.accent}/>
            <rect x={x + 3} y={H - hRdv} width="7" height={hRdv} rx="3" fill="#4ADE80"/>
            <text x={x} y={H + 16} textAnchor="middle" fontSize="10" fill={t.text2} fontFamily={font} fontWeight="500">{d.day}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend({ color, label }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'currentColor', opacity: 0.8 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

Object.assign(window, { ScreenStats });
