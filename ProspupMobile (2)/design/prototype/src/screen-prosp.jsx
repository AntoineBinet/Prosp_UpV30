// ─────────────────────────────────────────────────────────────
// Mode Prosp — swipeable card stack (Tinder-like) with countdown ring
// ─────────────────────────────────────────────────────────────

function ScreenProsp({ dark = true, onTab, active = 'prosp' }) {
  const t = theme(dark ? 'dark' : 'light');
  const [idx, setIdx] = React.useState(0);
  const [decision, setDecision] = React.useState(null);
  const queue = PROSPECTS.slice(idx, idx + 3);
  const current = queue[0];
  const done = idx, total = 42;

  const decide = (kind) => {
    setDecision(kind);
    setTimeout(() => { setDecision(null); setIdx(i => Math.min(i + 1, PROSPECTS.length - 1)); }, 280);
  };

  if (!current) return null;
  const s = T.status[current.status];

  return (
    <Device dark={dark} fill={dark ? '#050505' : '#F6F5F2'}>
      {/* Ambient orange glow */}
      <div aria-hidden style={{
        position: 'absolute', top: 100, left: '10%', right: '10%', height: 400,
        background: 'radial-gradient(ellipse at center, rgba(255,107,53,0.2), transparent 70%)',
        filter: 'blur(30px)', pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 14px' }}>
        <IconBtn dark={dark}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </IconBtn>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: t.text3, letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 600 }}>Mode Prosp</div>
          <div style={{ fontSize: 15, color: t.text, fontWeight: 600, letterSpacing: -0.2 }}>Filtre : Aerospace FR · 5★</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 999, background: T.accentSoft, color: T.accent,
          fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: T.accent, boxShadow: `0 0 8px ${T.accent}` }} />
          {done + 1} / {total}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ margin: '0 16px 18px', height: 3, borderRadius: 2, background: t.bg4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${((done+1)/total)*100}%`, background: `linear-gradient(90deg, ${T.accent}, #FF8C42)`, transition: 'width .35s' }} />
      </div>

      {/* Card stack */}
      <div style={{ flex: 1, position: 'relative', padding: '0 20px', zIndex: 1 }}>
        {queue.slice().reverse().map((p, i) => {
          const depth = queue.length - 1 - i; // 0 = front
          const isFront = depth === 0;
          const swing = decision && isFront
            ? (decision === 'skip' ? -24 : decision === 'call' ? 24 : 0)
            : 0;
          const opacity = decision && isFront ? 0 : 1;
          return (
            <ProspCard key={p.id + '-' + idx + '-' + depth} dark={dark} p={p}
              depth={depth}
              style={{
                transform: `translateY(${depth*8}px) scale(${1 - depth*0.04}) rotate(${swing}deg) translateX(${swing * 8}px)`,
                opacity,
                transition: 'transform .28s cubic-bezier(.32,1.08,.62,1), opacity .28s',
                zIndex: 10 - depth,
              }} />
          );
        })}
      </div>

      {/* Action bar */}
      <div style={{ padding: '16px 20px 96px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
        <ActionCircle dark={dark} kind="skip"    onClick={() => decide('skip')} />
        <ActionCircle dark={dark} kind="note"    onClick={() => decide('note')} />
        <ActionCircle dark={dark} kind="call"    onClick={() => decide('call')} big />
        <ActionCircle dark={dark} kind="mail"    onClick={() => decide('mail')} />
        <ActionCircle dark={dark} kind="star"    onClick={() => decide('star')} />
      </div>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

function ProspCard({ dark, p, depth, style }) {
  const t = theme(dark ? 'dark' : 'light');
  const s = T.status[p.status];
  return (
    <div style={{
      position: 'absolute', left: 20, right: 20, top: 0,
      height: 420, borderRadius: 28, overflow: 'hidden',
      background: dark
        ? `linear-gradient(160deg, ${t.bg3}, ${t.bg2})`
        : 'linear-gradient(160deg, #FFFFFF, #FAF9F6)',
      border: `0.5px solid ${t.border2}`,
      boxShadow: depth === 0
        ? (dark ? '0 30px 60px rgba(0,0,0,0.5)' : '0 30px 60px rgba(0,0,0,0.12)')
        : 'none',
      padding: 22, display: 'flex', flexDirection: 'column',
      fontFamily: font, color: t.text,
      ...style,
    }}>
      {/* Big avatar monogram */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: `linear-gradient(135deg, ${s.dot}, ${s.fg})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 22, letterSpacing: -0.5,
          boxShadow: `0 10px 24px ${s.dot}55`,
        }}>{p.first[0]}{p.last[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1 }}>
            {p.first}<br/>{p.last}
          </div>
        </div>
        <StarRating n={p.pertinence} dark={dark} />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: t.text3, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 600 }}>Entreprise</div>
        <div style={{ fontSize: 17, color: t.text, fontWeight: 600, letterSpacing: -0.3, marginTop: 2 }}>{p.company}</div>
        <div style={{ fontSize: 13, color: t.text2, marginTop: 1 }}>{p.role}</div>
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {p.tags.map(tg => (
          <span key={tg} style={{
            padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: t.bg4, color: t.text2, border: `0.5px solid ${t.border}`,
          }}>{tg}</span>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      {/* Phone, like a desk-phone callout */}
      <div style={{
        marginTop: 14, padding: '14px 16px', borderRadius: 18,
        background: dark ? 'rgba(255,107,53,0.1)' : 'rgba(255,107,53,0.08)',
        border: `0.5px solid rgba(255,107,53,0.2)`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>Ligne directe</div>
          <div style={{ fontFamily: fontMono, fontSize: 16, fontWeight: 600, color: t.text, letterSpacing: -0.2, marginTop: 2 }}>{p.phone}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: s.bg, color: s.fg }}>{STATUS_META[p.status].label}</span>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: t.text3, textAlign: 'center', letterSpacing: 0.2 }}>
        ← Suivant · Décrocher → · ↑ Voir fiche
      </div>
    </div>
  );
}

function ActionCircle({ dark, kind, onClick, big }) {
  const t = theme(dark ? 'dark' : 'light');
  const size = big ? 64 : 48;
  const config = {
    skip: { bg: t.bg3, color: t.text2, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg> },
    note: { bg: t.bg3, color: t.text2, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 3h10l4 4v14a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.8"/><path d="M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> },
    call: { bg: T.accent, color: '#fff', icon: <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg> },
    mail: { bg: t.bg3, color: t.text2, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.8"/></svg> },
    star: { bg: t.bg3, color: '#FBBF24', icon: <svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-7z" fill="currentColor"/></svg> },
  }[kind];
  return (
    <button onClick={onClick} style={{
      width: size, height: size, borderRadius: size/2,
      background: config.bg, color: config.color,
      border: kind === 'call' ? 'none' : `0.5px solid ${t.border2}`,
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: kind === 'call' ? '0 10px 24px rgba(255,107,53,0.4)' : '0 2px 6px rgba(0,0,0,0.1)',
    }}>{config.icon}</button>
  );
}

Object.assign(window, { ScreenProsp });
