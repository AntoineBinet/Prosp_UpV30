// ─────────────────────────────────────────────────────────────
// Prospect detail — bottom-sheet style, full height
// ─────────────────────────────────────────────────────────────

function ScreenDetail({ dark = true, p }) {
  const t = theme(dark ? 'dark' : 'light');
  p = p || PROSPECTS[0];
  const s = T.status[p.status];

  return (
    <Device dark={dark}>
      {/* scrim */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1 }} />

      {/* Sheet */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, top: 60, zIndex: 2,
        background: t.bg2, borderRadius: '24px 24px 0 0',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 -10px 40px rgba(0,0,0,0.35)',
      }}>
        <div style={{ padding: '8px 0', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 5, borderRadius: 3, background: t.text4 }} />
        </div>

        {/* Header */}
        <div style={{ padding: '8px 20px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 18,
              background: `linear-gradient(135deg, ${s.dot}, ${s.fg})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 20, letterSpacing: -0.5,
              boxShadow: `0 8px 20px ${s.dot}55`,
            }}>{p.first[0]}{p.last[0]}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: t.text }}>
                {p.first} {p.last}
              </div>
              <div style={{ fontSize: 13, color: t.text2, marginTop: 2 }}>
                {p.role} · {p.company}
              </div>
            </div>
            <StarRating n={p.pertinence} dark={dark} />
          </div>

          {/* Status + meta pills */}
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
              background: s.bg, color: s.fg, textTransform: 'uppercase', letterSpacing: 0.4 }}>{STATUS_META[p.status].label}</span>
            {p.followupDue && <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.15)', color: '#F87171' }}>Relance due</span>}
            {p.rdv && <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: 'rgba(34,197,94,0.15)', color: '#4ADE80' }}>📅 {p.rdv}</span>}
            <span style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 8, background: t.bg4, color: t.text2 }}>{p.lastContact}</span>
          </div>
        </div>

        {/* Primary actions row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '0 16px 14px' }}>
          <DetailAction dark={dark} icon="phone" label="Appeler" primary />
          <DetailAction dark={dark} icon="mail" label="Email" />
          <DetailAction dark={dark} icon="in" label="LinkedIn" />
          <DetailAction dark={dark} icon="spark" label="IA" />
        </div>

        {/* Scroll content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 16px 40px' }}>
          {/* Coordonnées card */}
          <Card dark={dark} title="Coordonnées">
            <Row dark={dark} label="Téléphone" value={p.phone} mono action="call" />
            <Row dark={dark} label="Email" value={p.email} mono />
            <Row dark={dark} label="LinkedIn" value={p.linkedin ? 'Profil lié' : '—'} accent={p.linkedin} />
          </Card>

          {/* Notes */}
          <Card dark={dark} title="Notes" trailing={<span style={{ color: T.accent, fontSize: 12, fontWeight: 500 }}>Éditer</span>}>
            <div style={{ padding: '4px 0', fontSize: 14, color: t.text, lineHeight: 1.5, letterSpacing: -0.1 }}>
              {p.notes || '—'}
            </div>
          </Card>

          {/* Tags / compétences */}
          <Card dark={dark} title="Compétences" trailing={<span style={{ color: T.accent, fontSize: 12, fontWeight: 500 }}>+ Ajouter</span>}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {p.tags.map(tg => (
                <span key={tg} style={{
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  background: t.bg4, color: t.text,
                  border: `0.5px solid ${t.border2}`,
                }}>{tg}</span>
              ))}
            </div>
          </Card>

          {/* Timeline */}
          <Card dark={dark} title="Historique">
            {[
              { when: 'Aujourd\'hui 10:12', icon: '✉️', text: 'Email envoyé — Prise de contact ESN', tone: '#FBBF24' },
              { when: 'Hier 14:30',          icon: '📞', text: 'Appel 12 min — intérêt confirmé', tone: '#4ADE80' },
              { when: '18 avril',            icon: '⭐', text: 'Pertinence mise à 5/5', tone: T.accent },
              { when: '15 avril',            icon: '➕', text: 'Ajouté via import Excel', tone: '#94A3B8' },
            ].map((e, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: i < 3 ? `0.5px solid ${t.divider}` : 'none' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: t.bg4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>{e.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: t.text, fontWeight: 500 }}>{e.text}</div>
                  <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{e.when}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </Device>
  );
}

function DetailAction({ dark, icon, label, primary }) {
  const t = theme(dark ? 'dark' : 'light');
  const bg = primary ? T.accent : t.bg3;
  const col = primary ? '#fff' : t.text;
  return (
    <button style={{
      border: 'none', cursor: 'pointer', fontFamily: font,
      padding: '12px 0', borderRadius: 14, background: bg, color: col,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      boxShadow: primary ? '0 6px 16px rgba(255,107,53,0.35)' : 'none',
      border0: primary ? 'none' : `0.5px solid ${t.border}`,
    }}>
      <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon === 'phone' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>}
        {icon === 'mail' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.8"/></svg>}
        {icon === 'in' && <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h4v4H4zM4 10h4v10H4zM10 10h4v2c.7-1.5 2.5-2.4 4-2.4 3 0 5 2 5 5V20h-4v-4.4c0-1.7-.6-2.6-2-2.6s-2 1-2 2.6V20h-4V10z"/></svg>}
        {icon === 'spark' && <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" fill="currentColor"/></svg>}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: -0.1 }}>{label}</span>
    </button>
  );
}

function Card({ dark, title, trailing, children }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 6px 8px' }}>
        <div style={{ fontSize: 12, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{title}</div>
        {trailing}
      </div>
      <div style={{ padding: '4px 14px', borderRadius: 18, background: t.bg3, border: `0.5px solid ${t.border}` }}>
        {children}
      </div>
    </div>
  );
}

function Row({ dark, label, value, mono, accent, action }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: `0.5px solid ${t.divider}`, gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: t.text3, letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, color: accent ? T.accent : t.text, fontFamily: mono ? fontMono : font, fontWeight: 500, marginTop: 1 }}>{value}</div>
      </div>
      {action === 'call' && (
        <button style={{ border: 'none', background: T.accentSoft, color: T.accent, width: 36, height: 36, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
        </button>
      )}
    </div>
  );
}

Object.assign(window, { ScreenDetail });
