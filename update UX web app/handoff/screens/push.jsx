/* global React, Shell, Icon */
// Push — Campagnes, Templates, Historique
function ScreenPush() {
  const [tab, setTab] = React.useState('campagnes');
  return (
    <Shell active="push" crumbs={["Prosp'Up", 'Push']}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Push</h1>
        <div className="segmented">
          <button className={tab === 'campagnes' ? 'active' : ''} onClick={() => setTab('campagnes')}>Campagnes</button>
          <button className={tab === 'templates' ? 'active' : ''} onClick={() => setTab('templates')}>Templates</button>
          <button className={tab === 'historique' ? 'active' : ''} onClick={() => setTab('historique')}>Historique</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-accent"><Icon name="plus" size={13} /> Nouvelle campagne</button>
      </div>

      {tab === 'campagnes' && <CampagnesList />}
      {tab === 'templates' && <TemplatesGrid />}
      {tab === 'historique' && <HistoriqueList />}
    </Shell>
  );
}

function CampagnesList() {
  const rows = [
    { n: 'Embarqué Q2 2026',        cat: 'Tech · C++/ARM',     to: 48, sent: 48, open: 62, reply: 14, d: 'Envoyée · 18/04', state: 'En cours', pct: 29 },
    { n: 'Directeurs RH - Grands comptes', cat: 'RH',          to: 120, sent: 86, open: 34, reply: 6,  d: 'Envoi progressif', state: 'Actif', pct: 72 },
    { n: 'Cloud Architectes Paris', cat: 'Tech · AWS/GCP',     to: 62, sent: 0,  open: 0, reply: 0,   d: 'Programmée · 25/04', state: 'Brouillon', pct: 0 },
    { n: 'DSI banque & assurance',   cat: 'Finance',           to: 34, sent: 34, open: 28, reply: 11, d: 'Envoyée · 12/04', state: 'Terminée', pct: 100 },
  ];
  const stateBadge = { 'En cours': 'badge-accent', 'Actif': 'badge-success', 'Brouillon': 'badge-warn', 'Terminée': 'badge' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((c, i) => (
        <div key={i} className="card" style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.n}</div>
              <span className={`badge ${stateBadge[c.state]}`}>{c.state}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{c.cat}</span>
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 10, fontSize: 12 }}>
              <Stat label="Cible" val={c.to} />
              <Stat label="Envoyés" val={c.sent} />
              <Stat label="Ouvert" val={`${c.open}%`} color="var(--info)" />
              <Stat label="Répondu" val={`${c.reply}%`} color="var(--success)" />
              <span style={{ color: 'var(--text-3)', fontSize: 11.5, alignSelf: 'end' }}>{c.d}</span>
            </div>
            <div style={{ height: 3, background: 'var(--surface-2)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${c.pct}%`, background: 'var(--accent)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm">Voir</button>
            <button className="btn btn-ghost btn-sm btn-icon"><Icon name="dot3" size={13}/></button>
          </div>
        </div>
      ))}

      {/* Wizard preview card */}
      <div className="card" style={{ padding: 20, marginTop: 16, border: '1px dashed var(--border-strong)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: 0.06, textTransform: 'uppercase', marginBottom: 10 }}>Assistant nouvelle campagne (aperçu)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { i: 1, t: 'Cible', d: 'Catégorie + filtres · preview 48 prospects', active: true },
            { i: 2, t: 'Message', d: 'Template ou composer avec variables', active: false },
            { i: 3, t: 'Envoi', d: 'Immédiat / programmé · checklist', active: false },
          ].map(s => (
            <div key={s.i} className="card" style={{ padding: 14, borderColor: s.active ? 'var(--accent)' : 'var(--border)', background: s.active ? 'var(--accent-soft)' : 'var(--surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 20, height: 20, borderRadius: 10, background: s.active ? 'var(--accent)' : 'var(--surface-2)', color: s.active ? 'var(--accent-fg)' : 'var(--text-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{s.i}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.t}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Stat({ label, val, color }) {
  return <span><span style={{ color: 'var(--text-3)' }}>{label} </span><b style={{ color: color || 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{val}</b></span>;
}

function TemplatesGrid() {
  const tpls = [
    { n: 'Intro embarqué',      tags: ['tech','C++'],     used: 47, open: 34, body: 'Bonjour {{prenom}}, nous accompagnons {{entreprise}} sur l\'embarqué sécurisé…' },
    { n: 'RFP suivi T+7',       tags: ['relance'],         used: 132, open: 52, body: '{{prenom}}, je reviens vers vous suite à notre échange du {{date}}…' },
    { n: 'Opportunité RH',      tags: ['rh'],              used: 28, open: 29, body: 'Bonjour {{prenom}}, nous avons 3 profils qui pourraient intéresser {{entreprise}}…' },
    { n: 'Prépa RDV',           tags: ['rdv'],             used: 19, open: 81, body: 'Bonjour {{prenom}}, voici les éléments en prép. de notre RDV du {{date}}…' },
    { n: 'Remerciements RDV',   tags: ['rdv','suivi'],     used: 54, open: 66, body: 'Bonjour {{prenom}}, merci pour notre échange — synthèse ci-dessous…' },
    { n: 'Break-up friendly',   tags: ['relance'],         used: 8,  open: 41, body: '{{prenom}}, je laisse le sujet de côté sauf retour de votre part…' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {tpls.map((t, i) => (
        <div key={i} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row-sb">
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.n}</div>
            <button className="btn btn-ghost btn-sm btn-icon"><Icon name="dot3" size={13}/></button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {t.tags.map((x, j) => <span key={j} className="badge">{x}</span>)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.4, minHeight: 46, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>
            {t.body}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
            <span>Utilisé <b style={{ color: 'var(--text)' }} className="num">{t.used}×</b></span>
            <span>Ouverture <b style={{ color: 'var(--success)' }} className="num">{t.open}%</b></span>
          </div>
        </div>
      ))}
      <div className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, borderStyle: 'dashed', color: 'var(--text-3)', cursor: 'pointer', minHeight: 160 }}>
        <Icon name="plus" size={20} />
        <span style={{ fontSize: 12 }}>Nouveau template</span>
      </div>
    </div>
  );
}

function HistoriqueList() {
  const days = [
    { d: "Aujourd'hui · 21 avril",
      items: [
        { t: '14:02', n: 'Marie Dubois',   co: 'Capgemini',     ch: 'mail',   state: 'ouvert' },
        { t: '13:45', n: 'Thomas Martin',  co: 'Sopra Steria',  ch: 'mail',   state: 'envoyé' },
        { t: '11:02', n: 'Alex Petit',     co: 'Orange',        ch: 'linkedin', state: 'répondu' },
        { t: '09:30', n: 'Isabelle Renard',co: 'Thales',        ch: 'mail',   state: 'ouvert' },
      ] },
    { d: 'Hier · 20 avril',
      items: [
        { t: '17:10', n: 'Julie Bernard',  co: 'Atos',          ch: 'mail',   state: 'ouvert' },
        { t: '14:22', n: 'Kévin Lefèvre',  co: 'Airbus',        ch: 'linkedin', state: 'envoyé' },
        { t: '10:05', n: 'Laure Giraud',   co: 'Safran',        ch: 'mail',   state: 'envoyé' },
      ] },
  ];
  const stateCls = { 'envoyé': 'badge', 'ouvert': 'badge-info', 'répondu': 'badge-success' };
  return (
    <div className="card card-flush">
      {days.map((d, i) => (
        <div key={i}>
          <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-3)', letterSpacing: 0.08, textTransform: 'uppercase', background: 'var(--surface-2)', borderTop: i ? '1px solid var(--border)' : 0, borderBottom: '1px solid var(--border)' }}>{d.d}</div>
          {d.items.map((it, j) => (
            <div key={j} style={{ display: 'grid', gridTemplateColumns: '60px 28px 1fr auto auto', gap: 10, alignItems: 'center', padding: '8px 16px', borderBottom: j < d.items.length - 1 ? '1px solid var(--border)' : 0 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{it.t}</span>
              <div className="avatar">{it.n.split(' ').map(x => x[0]).join('')}</div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{it.n} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {it.co}</span></div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>« Opportunité Prosp'Up × {it.co} »</div>
              </div>
              <span className="badge" style={{ textTransform: 'lowercase' }}>{it.ch === 'mail' ? '✉ mail' : 'in linkedin'}</span>
              <span className={`badge ${stateCls[it.state]}`}>{it.state}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
window.ScreenPush = ScreenPush;
