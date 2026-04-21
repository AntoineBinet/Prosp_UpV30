/* global React, Shell, Icon */
// Dashboard v3 — hero + bento + insights
function ScreenDashboard() {
  return (
    <Shell active="dashboard" crumbs={["Prosp'Up", 'Dashboard']}>
      {/* Hero */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'end', padding: '8px 0 24px' }}>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', letterSpacing: 0.08, textTransform: 'uppercase', marginBottom: 8 }}>Lundi 21 avril · Semaine 17</div>
          <h1 style={{ fontSize: 28, fontWeight: 500, margin: 0, letterSpacing: -0.4 }}>Bonjour, Antoine.</h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '4px 0 0' }}>Tu as <b style={{ color: 'var(--text)' }}>4 relances</b> en retard et <b style={{ color: 'var(--text)' }}>3 RDV</b> aujourd'hui.</p>
        </div>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <HeroKpi label="RDV sem." value="8" delta="+2" serif />
          <HeroKpi label="Push" value="47" delta="+12" serif />
          <HeroKpi label="Contacts" value="124" delta="−3" neg serif />
          <div className="card" style={{ padding: 14, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--warn-soft)', color: 'oklch(0.55 0.16 65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="flame" size={16} /></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Série active</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>7 jours · <span style={{ color: 'var(--accent)' }}>+240 XP</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bento row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 16, marginBottom: 16 }}>
        <ActionCenter />
        <PipelineCard />
        <GoalsCard />
      </div>

      {/* Bento row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <PrioritiesCard />
        <ActivityCard />
      </div>
    </Shell>
  );
}

function HeroKpi({ label, value, delta, neg, serif }) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 0.06, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: serif ? 'var(--font-serif)' : 'inherit', fontSize: 36, lineHeight: 1, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: neg ? 'var(--danger)' : 'var(--success)', marginTop: 4 }}>{delta} vs sem-1</div>
    </div>
  );
}

function ActionCenter() {
  const [tab, setTab] = React.useState('todo');
  const data = {
    todo: [
      { name: 'Marie Dubois',    co: 'Capgemini',        time: 'Aujourd\'hui · 14h',  pill: 'status-meeting', pillLabel: 'RDV préparer' },
      { name: 'Thomas Martin',   co: 'Sopra Steria',     time: 'Il y a 3 jours',       pill: 'status-contact', pillLabel: 'Relance' },
      { name: 'Julie Bernard',   co: 'Atos',             time: 'Demain',               pill: 'status-proposal', pillLabel: 'Propale' },
      { name: 'Alex Petit',      co: 'Orange Business',  time: 'Vendredi',             pill: 'status-new',     pillLabel: 'Qualifier' },
    ],
    rdv: [
      { name: 'Marie Dubois',    co: 'Capgemini',        time: '14:00 · Téams',        pill: 'status-meeting', pillLabel: 'Dans 2h' },
      { name: 'Sophie Leroy',    co: 'Thales',           time: '16:30 · Bureaux',      pill: 'status-meeting', pillLabel: 'Dans 4h' },
      { name: 'Paul Moreau',     co: 'BNP Paribas',      time: '18:00 · Call',         pill: 'status-meeting', pillLabel: 'Ce soir' },
    ],
    late: [
      { name: 'Eric Durand',     co: 'AXA Tech',         time: 'Retard 12j',           pill: 'status-lost',    pillLabel: 'À sauver' },
      { name: 'Claire Girard',   co: 'Renault Digital',  time: 'Retard 8j',            pill: 'status-contact', pillLabel: 'Relance' },
    ],
  };
  const items = data[tab];
  return (
    <div className="card card-flush">
      <div className="tabs" style={{ padding: '0 16px' }}>
        <button className={tab === 'todo' ? 'active' : ''} onClick={() => setTab('todo')}>À faire <span className="tab-count">12</span></button>
        <button className={tab === 'rdv'  ? 'active' : ''} onClick={() => setTab('rdv')}>RDV aujourd'hui <span className="tab-count">3</span></button>
        <button className={tab === 'late' ? 'active' : ''} onClick={() => setTab('late')}>En retard <span className="tab-count">4</span></button>
      </div>
      <div>
        {items.map((it, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '24px 1fr auto auto',
            alignItems: 'center', gap: 10, padding: '10px 16px',
            borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 0,
          }}>
            <div className="avatar">{it.name.split(' ').map(s => s[0]).join('')}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }} className="truncate">{it.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }} className="truncate">{it.co} · {it.time}</div>
            </div>
            <span className={`status ${it.pill}`}>{it.pillLabel}</span>
            <button className="btn btn-ghost btn-sm btn-icon"><Icon name="arrowR" size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineCard() {
  const stages = [
    { name: 'Prospecter', n: 420, color: 'var(--info-soft)', fg: 'var(--info)' },
    { name: 'Contacté',   n: 186, color: 'var(--accent-soft)', fg: 'var(--accent)' },
    { name: 'RDV',        n: 54,  color: 'oklch(0.92 0.05 280)', fg: 'oklch(0.50 0.15 280)' },
    { name: 'Proposition',n: 18,  color: 'var(--warn-soft)',  fg: 'oklch(0.50 0.14 75)' },
    { name: 'Gagné',      n: 7,   color: 'var(--success-soft)', fg: 'var(--success)' },
  ];
  const max = Math.max(...stages.map(s => s.n));
  return (
    <div className="card">
      <div className="row-sb" style={{ marginBottom: 14 }}>
        <div className="card-title">Pipeline</div>
        <span className="muted" style={{ fontSize: 12 }}>685 prospects actifs</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stages.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ color: 'var(--text-2)' }}>{s.name}</span>
            <div style={{ height: 22, background: 'var(--surface-2)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${(s.n / max) * 100}%`, background: s.color }} />
              <span style={{ position: 'absolute', left: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 11.5, fontWeight: 500, color: s.fg }}>{s.n}</span>
            </div>
            <span className="mono num" style={{ fontSize: 11.5, color: 'var(--text-3)', minWidth: 50, textAlign: 'right' }}>{Math.round((s.n / max) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalsCard() {
  const pct = 73;
  const r = 44;
  const C = 2 * Math.PI * r;
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="row-sb" style={{ marginBottom: 8 }}>
        <div className="card-title">Objectifs</div>
        <button className="btn btn-ghost btn-sm btn-icon"><Icon name="cog" size={13} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 0' }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="10"
            strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)}
            transform="rotate(-90 60 60)" />
          <text x="60" y="64" textAnchor="middle" fontFamily="var(--font-serif)" fontSize="30" fill="var(--text)">{pct}%</text>
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        <GoalRow label="Push" val="8" max="10" />
        <GoalRow label="RDV"  val="3" max="4"  />
        <GoalRow label="Contacts" val="22" max="30" />
      </div>
    </div>
  );
}
function GoalRow({ label, val, max }) {
  const pct = (val / max) * 100;
  return (
    <div>
      <div className="row-sb" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>
        <span>{label}</span>
        <span className="mono num"><b style={{ color: 'var(--text)' }}>{val}</b>/{max}</span>
      </div>
      <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
    </div>
  );
}

function PrioritiesCard() {
  const items = [
    { name: 'Isabelle Renard', co: 'Thales Group',      reason: "Ouvert l'email 3× sans répondre — relance idéale maintenant.", urg: 'haut' },
    { name: 'Kévin Lefèvre',   co: 'Airbus Defence',    reason: 'RDV prévu vendredi, aucune prépa envoyée.',                    urg: 'haut' },
    { name: 'Laure Giraud',    co: 'Safran',            reason: 'Embauche active côté C++ embarqué — match parfait.',           urg: 'moyen' },
    { name: 'Mohamed Ben',     co: 'Dassault Systemes', reason: 'Changement de poste récent détecté sur LinkedIn.',             urg: 'moyen' },
    { name: 'Chloé Marchand',  co: 'EDF DTEAM',         reason: 'Dernier contact > 45j, scoring en baisse.',                    urg: 'bas' },
  ];
  const pillClass = (u) => u === 'haut' ? 'badge-danger' : u === 'moyen' ? 'badge-warn' : 'badge-info';
  return (
    <div className="card card-flush">
      <div className="card-header">
        <div className="card-title"><Icon name="sparkles" size={14} /> Priorités IA</div>
        <button className="btn btn-ghost btn-sm"><Icon name="clock" size={13} /> Rafraîchir</button>
      </div>
      <div>
        {items.map((it, i) => (
          <div key={i} style={{ padding: '10px 16px', display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10, borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 0, alignItems: 'start' }}>
            <div className="avatar">{it.name.split(' ').map(s => s[0]).join('')}</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{it.name} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {it.co}</span></div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>{it.reason}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className={`badge ${pillClass(it.urg)}`}>{it.urg}</span>
              <button className="btn btn-sm">Ouvrir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityCard() {
  const events = [
    { t: '14:02', tag: 'push',  text: 'Campagne « Embarqué Q2 » envoyée à 18 prospects.' },
    { t: '13:45', tag: 'rdv',   text: 'RDV Marie Dubois (Capgemini) déplacé au 23/04.' },
    { t: '11:20', tag: 'note',  text: 'Note ajoutée sur Thomas Martin — "Attente budget Q3".' },
    { t: '10:08', tag: 'status',text: 'Julie Bernard passée de Contacté → Proposition.' },
    { t: '09:30', tag: 'push',  text: 'Alex Petit a ouvert l\'email « Opportunité Safran ».' },
    { t: '09:12', tag: 'note',  text: '6 prospects importés depuis fichier_prospection.xlsx.' },
  ];
  const tagColor = { push: 'var(--accent)', rdv: 'oklch(0.50 0.15 280)', note: 'var(--text-3)', status: 'var(--success)' };
  return (
    <div className="card card-flush">
      <div className="card-header">
        <div className="card-title">Activité récente</div>
        <button className="btn btn-ghost btn-sm">Tout voir</button>
      </div>
      <div style={{ position: 'relative', padding: '8px 16px' }}>
        <div style={{ position: 'absolute', left: 28, top: 16, bottom: 16, width: 1, background: 'var(--border)' }} />
        {events.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 12px 1fr', gap: 8, padding: '8px 0', alignItems: 'start', position: 'relative' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', paddingTop: 1 }}>{e.t}</span>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: tagColor[e.tag], marginTop: 5, marginLeft: 2, border: '2px solid var(--surface)' }} />
            <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.ScreenDashboard = ScreenDashboard;
