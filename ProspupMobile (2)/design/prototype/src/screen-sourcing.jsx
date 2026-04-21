// ─────────────────────────────────────────────────────────────
// Sourcing IA — candidate matching ranked list
// ─────────────────────────────────────────────────────────────

function ScreenSourcing({ dark = true, onTab, active = 'prosp' }) {
  const t = theme(dark ? 'dark' : 'light');

  return (
    <Device dark={dark}>
      <LargeHeader dark={dark} title="Sourcing IA" subtitle="Matching pour Dassault · R&D Robotique"
        trailing={
          <IconBtn dark={dark}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </IconBtn>
        } />

      {/* AI brief card */}
      <div style={{ margin: '0 16px 14px', padding: 14, borderRadius: 18,
        background: `linear-gradient(135deg, ${T.accentSoft}, transparent)`,
        border: `0.5px solid rgba(255,107,53,0.2)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill="#fff"/></svg>
          </div>
          <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>Brief analysé par IA</div>
        </div>
        <div style={{ fontSize: 13, color: t.text2, lineHeight: 1.5 }}>
          <b style={{ color: t.text }}>Ingénieur Embarqué</b> · C++, ROS2, Linux · 5+ ans · Paris/remote · <b style={{ color: T.accent }}>TJM 600-750€</b>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'rgba(34,197,94,0.15)', color: '#4ADE80', fontWeight: 700, letterSpacing: 0.3 }}>24 CV ANALYSÉS</span>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: t.bg4, color: t.text2, fontWeight: 600 }}>il y a 3 min</span>
        </div>
      </div>

      <div style={{ padding: '0 20px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 12, color: t.text2, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>Top candidats</div>
        <div style={{ fontSize: 12, color: T.accent, fontWeight: 500 }}>Par match %</div>
      </div>

      <Scroll dark={dark}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px' }}>
          {CANDIDATES.map(c => <CandidateCard key={c.id} dark={dark} c={c} />)}
        </div>
        <div style={{ padding: 20, textAlign: 'center', color: t.text3, fontSize: 12 }}>5 sur 24 affichés · voir tout</div>
      </Scroll>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

function CandidateCard({ dark, c }) {
  const t = theme(dark ? 'dark' : 'light');
  const matchColor = c.match >= 90 ? '#4ADE80' : c.match >= 80 ? '#FBBF24' : '#FB923C';
  return (
    <div style={{
      padding: 14, borderRadius: 18, background: t.bg3,
      border: `0.5px solid ${t.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <MatchRing score={c.match} color={matchColor} dark={dark} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text, letterSpacing: -0.2, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
            <span style={{ fontSize: 11, fontWeight: 700, color: matchColor, letterSpacing: 0.3 }}>{c.match}% MATCH</span>
          </div>
          <div style={{ fontSize: 12.5, color: t.text2, marginTop: 1 }}>{c.role} · {c.city}</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {c.skills.slice(0, 4).map(s => (
              <span key={s} style={{
                padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                background: t.bg4, color: t.text, border: `0.5px solid ${t.border}`,
              }}>{s}</span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: t.text2 }}>
            <span><b style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>{c.tjm}€</b>/j</span>
            <span><b style={{ color: t.text }}>{c.exp} ans</b> xp</span>
            <span style={{ color: c.avail === 'Immédiate' ? '#4ADE80' : t.text2 }}>{c.avail}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchRing({ score, color, dark }) {
  const t = theme(dark ? 'dark' : 'light');
  const s = 48, stroke = 4, r = (s - stroke) / 2;
  const C = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: s, height: s, flexShrink: 0 }}>
      <svg width={s} height={s} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={s/2} cy={s/2} r={r} stroke={t.bg4} strokeWidth={stroke} fill="none"/>
        <circle cx={s/2} cy={s/2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={`${C*score/100} ${C}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: t.text, fontVariantNumeric: 'tabular-nums' }}>
        {score}
      </div>
    </div>
  );
}

Object.assign(window, { ScreenSourcing });
