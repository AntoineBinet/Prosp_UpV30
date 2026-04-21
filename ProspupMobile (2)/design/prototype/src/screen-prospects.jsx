// ─────────────────────────────────────────────────────────────
// Prospects list — segmented filter chips + swipeable cards
// ─────────────────────────────────────────────────────────────

function StarRating({ n, dark }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <span style={{ display: 'inline-flex', gap: 1 }}>
      {[1,2,3,4,5].map(i => (
        <svg key={i} width="10" height="10" viewBox="0 0 12 12">
          <path d="M6 1l1.5 3.2 3.5.4-2.6 2.4.7 3.5L6 8.9l-3.1 1.6.7-3.5L1 4.6l3.5-.4L6 1z"
            fill={i <= n ? T.accent : t.text4} />
        </svg>
      ))}
    </span>
  );
}

function ProspectCard({ dark, p, onClick }) {
  const t = theme(dark ? 'dark' : 'light');
  const s = T.status[p.status];
  return (
    <button onClick={onClick} style={{
      width: '100%', textAlign: 'left', border: 'none',
      background: t.bg3, borderRadius: 18,
      padding: 0, cursor: 'pointer',
      boxShadow: '0 1px 0 rgba(255,255,255,0.02)',
      border0: `0.5px solid ${t.border}`,
      fontFamily: font, color: t.text, position: 'relative',
      overflow: 'hidden', display: 'flex',
    }}>
      {/* status accent rail */}
      <div style={{ width: 4, background: s.dot, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.first} {p.last}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
            background: s.bg, color: s.fg,
          }}>{STATUS_META[p.status].label}</span>
        </div>
        <div style={{ fontSize: 12.5, color: t.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 6 }}>
          {p.company} · {p.role}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <StarRating n={p.pertinence} dark={dark} />
          {p.followupDue && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              background: 'rgba(239,68,68,0.15)', color: '#F87171', letterSpacing: 0.3 }}>RELANCE</span>
          )}
          {p.rdv && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              background: 'rgba(34,197,94,0.15)', color: '#4ADE80', letterSpacing: 0.3 }}>📅 {p.rdv}</span>
          )}
          {p.phone && (
            <span style={{ color: t.text3, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke="currentColor" strokeWidth="2"/></svg>
            </span>
          )}
          {p.email && (
            <span style={{ color: t.text3 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.8"/></svg>
            </span>
          )}
          {p.linkedin && (
            <span style={{ color: '#0A66C2' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h4v4H4zM4 10h4v10H4zM10 10h4v2c.7-1.5 2.5-2.4 4-2.4 3 0 5 2 5 5V20h-4v-4.4c0-1.7-.6-2.6-2-2.6s-2 1-2 2.6V20h-4V10z"/></svg>
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: 14, color: t.text4 }}>
        <svg width="10" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
      </div>
    </button>
  );
}

const CHIPS = [
  { id: 'all', label: 'Tous', count: 142 },
  { id: 'urgent', label: '⚡ Urgent', count: 6 },
  { id: 'rdv', label: 'RDV', count: 9 },
  { id: 'appele', label: 'Appelé', count: 34 },
  { id: 'prospecte', label: 'Prospecté', count: 58 },
  { id: 'rappeler', label: 'À rappeler', count: 12 },
];

function ScreenProspects({ dark = true, onTab, onOpen, active = 'prospects' }) {
  const t = theme(dark ? 'dark' : 'light');
  const [chip, setChip] = React.useState('all');

  return (
    <Device dark={dark}>
      <LargeHeader dark={dark} title="Prospects" subtitle="142 actifs · 58 archivés"
        trailing={
          <>
            <IconBtn dark={dark}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </IconBtn>
            <IconBtn dark={dark}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </IconBtn>
          </>
        } />

      {/* Search */}
      <div style={{ padding: '0 16px 10px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          height: 40, padding: '0 14px', borderRadius: 14,
          background: t.bg4, color: t.text3, fontSize: 15,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          <span>Rechercher un prospect, entreprise…</span>
          <div style={{ flex: 1 }} />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 8l3-4h8l3 4M4 8h16l-2 11a2 2 0 01-2 2H8a2 2 0 01-2-2L4 8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>
        </div>
      </div>

      {/* Filter chips — horizontal scroll */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {CHIPS.map(c => {
          const on = chip === c.id;
          return (
            <button key={c.id} onClick={() => setChip(c.id)} style={{
              flexShrink: 0, padding: '7px 14px', borderRadius: 999,
              border: `0.5px solid ${on ? 'rgba(255,107,53,0.3)' : t.border2}`,
              background: on ? T.accentSoft : t.bg3,
              color: on ? T.accent : t.text,
              fontSize: 13, fontWeight: on ? 600 : 500, cursor: 'pointer',
              fontFamily: font, display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              {c.label}
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                background: on ? 'rgba(255,107,53,0.2)' : t.bg4,
                color: on ? T.accent : t.text2, fontVariantNumeric: 'tabular-nums',
              }}>{c.count}</span>
            </button>
          );
        })}
      </div>

      <Scroll dark={dark}>
        {/* Live Activity banner pour Mode Prosp */}
        <div style={{ margin: '0 16px 10px', padding: '10px 12px', borderRadius: 14,
          background: dark ? 'rgba(255,107,53,0.08)' : 'rgba(255,107,53,0.06)',
          border: `0.5px solid rgba(255,107,53,0.18)`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="#fff"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: t.text, fontWeight: 600 }}>Mode Prosp en cours — 17/42</div>
            <div style={{ fontSize: 11, color: t.text2 }}>Reprendre avec les filtres actifs</div>
          </div>
          <svg width="10" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke={T.accent} strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 16px' }}>
          {PROSPECTS.map(p => <ProspectCard key={p.id} dark={dark} p={p} onClick={() => onOpen && onOpen(p)} />)}
        </div>

        <div style={{ textAlign: 'center', padding: '20px 0', color: t.text3, fontSize: 12 }}>
          — Fin de la liste · 142 prospects —
        </div>
      </Scroll>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

Object.assign(window, { ScreenProspects, ProspectCard, StarRating });
