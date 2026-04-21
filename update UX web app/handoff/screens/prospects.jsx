/* global React, Shell, Icon */
// Prospects — Table view + bulk bar + views switcher
function ScreenProspects() {
  const [view, setView] = React.useState('table');
  return (
    <Shell active="prospects" crumbs={["Prosp'Up", 'Prospects']} noPadding>
      <div style={{ padding: '0 24px' }}>
        {/* Sticky page topbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>Prospects <span style={{ color: 'var(--text-3)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>1 247</span></h1>
          <div className="segmented">
            <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><Icon name="table" size={13} /> Table</button>
            <button className={view === 'kanban' ? 'active' : ''} onClick={() => setView('kanban')}><Icon name="kanban" size={13} /> Kanban</button>
            <button className={view === 'split' ? 'active' : ''} onClick={() => setView('split')}><Icon name="split" size={13} /> Split</button>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm"><Icon name="filter" size={13} /> Filtres <span className="badge" style={{ marginLeft: 4, height: 16, padding: '0 5px' }}>2</span></button>
          <button className="btn btn-ghost btn-sm"><Icon name="cog" size={13} /> Colonnes</button>
          <button className="btn btn-sm"><Icon name="plus" size={13} /> Ajouter</button>
        </div>

        {/* Saved views pills */}
        <div style={{ display: 'flex', gap: 6, padding: '12px 0', alignItems: 'center', overflowX: 'auto' }}>
          <ViewPill active>Tous <span className="mono num" style={{ opacity: 0.5 }}>1 247</span></ViewPill>
          <ViewPill>Mes prospects <span className="mono num" style={{ opacity: 0.5 }}>318</span></ViewPill>
          <ViewPill>À relancer <span className="mono num" style={{ opacity: 0.5 }}>42</span></ViewPill>
          <ViewPill>Hot 🔥 <span className="mono num" style={{ opacity: 0.5 }}>15</span></ViewPill>
          <ViewPill>Paris <span className="mono num" style={{ opacity: 0.5 }}>286</span></ViewPill>
          <button className="btn btn-ghost btn-sm"><Icon name="plus" size={12} /> Vue</button>
          <div style={{ flex: 1 }} />
          <div style={{ position: 'relative', width: 240 }}>
            <input className="input" placeholder="Rechercher…" style={{ paddingLeft: 28 }} />
            <span style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }}><Icon name="search" size={14} /></span>
          </div>
        </div>

        {view === 'table' && <ProspectsTable />}
        {view === 'kanban' && <ProspectsKanban />}
        {view === 'split' && <ProspectsSplit />}
      </div>

      {/* Bulk bar */}
      <div style={{
        position: 'absolute', bottom: 24, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <div style={{
          pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--text)', color: 'var(--bg)',
          padding: '8px 12px', borderRadius: 12,
          boxShadow: 'var(--shadow-pop)', fontSize: 12.5, fontWeight: 500,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', background: 'color-mix(in oklch, var(--bg) 15%, transparent)', borderRadius: 6 }}>
            <Icon name="check" size={12} /> 3 sélectionnés
          </span>
          <span style={{ width: 1, height: 16, background: 'color-mix(in oklch, var(--bg) 20%, transparent)' }} />
          <BulkBtn icon="send">Pousser</BulkBtn>
          <BulkBtn icon="sparkles">Email IA</BulkBtn>
          <BulkBtn icon="phone">Tel IA</BulkBtn>
          <BulkBtn icon="tag">Tag</BulkBtn>
          <BulkBtn icon="users">Assigner</BulkBtn>
          <span style={{ width: 1, height: 16, background: 'color-mix(in oklch, var(--bg) 20%, transparent)' }} />
          <BulkBtn icon="x">Effacer</BulkBtn>
        </div>
      </div>
    </Shell>
  );
}

function ViewPill({ active, children }) {
  return (
    <button style={{
      background: active ? 'var(--surface)' : 'transparent',
      border: `1px solid ${active ? 'var(--border-strong)' : 'transparent'}`,
      padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: active ? 500 : 400,
      color: active ? 'var(--text)' : 'var(--text-2)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer',
    }}>{children}</button>
  );
}
function BulkBtn({ icon, children }) {
  return <button style={{
    background: 'transparent', border: 0, color: 'var(--bg)', opacity: 0.9,
    fontSize: 12.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
  }}><Icon name={icon} size={13} />{children}</button>;
}

// dispo: 'now' (joignable maintenant), 'soon' (tranche proche), 'off' (hors plage), null (pas de mobile)
const PROSPECTS_DATA = [
  { sel: true,  n: 'Marie Dubois',    f: 'CTO',              co: 'Capgemini',        s: 'status-meeting',  sl: 'RDV', p: 5, last: 'Il y a 2h',  next: '21/04 · 14h', tel: '+33 6 12 34 56 78', dispo: 'now',  tags: ['tech', 'ile-de-france'] },
  { sel: false, n: 'Thomas Martin',   f: 'Head of Digital',  co: 'Sopra Steria',     s: 'status-contact',  sl: 'Contacté', p: 4, last: 'Hier',      next: '23/04',      tel: '+33 6 45 22 11 09', dispo: 'soon', tags: ['data', '+2'] },
  { sel: true,  n: 'Julie Bernard',   f: 'Directrice RH',    co: 'Atos',             s: 'status-proposal', sl: 'Propale', p: 4, last: 'Il y a 3j', next: '25/04',      tel: '+33 6 88 47 02 15', dispo: 'now',  tags: ['rh'] },
  { sel: false, n: 'Alex Petit',      f: 'VP Engineering',   co: 'Orange Business',  s: 'status-new',      sl: 'Nouveau', p: 3, last: '—',         next: '—',          tel: null,                 dispo: null,   tags: ['tech', 'telecom'] },
  { sel: true,  n: 'Isabelle Renard', f: 'Directrice SI',    co: 'Thales Group',     s: 'status-contact',  sl: 'Contacté', p: 5, last: 'Il y a 5j', next: '22/04',      tel: '+33 6 71 90 33 42', dispo: 'off',  tags: ['defense', '+1'] },
  { sel: false, n: 'Kévin Lefèvre',   f: 'Eng. Manager',     co: 'Airbus Defence',   s: 'status-meeting',  sl: 'RDV', p: 4, last: 'Il y a 1j', next: '26/04 · 10h', tel: '+33 7 12 88 44 19', dispo: 'now',  tags: ['aero'] },
  { sel: false, n: 'Laure Giraud',    f: 'CTO',              co: 'Safran',           s: 'status-new',      sl: 'Nouveau', p: 3, last: '—',         next: '—',          tel: '+33 6 03 59 27 81', dispo: 'soon', tags: ['aero', 'embarqué'] },
  { sel: false, n: 'Mohamed Ben',     f: 'Chef de projet',   co: 'Dassault Syst.',   s: 'status-contact',  sl: 'Contacté', p: 2, last: 'Il y a 7j', next: '28/04',      tel: null,                 dispo: null,   tags: ['tech'] },
  { sel: false, n: 'Chloé Marchand',  f: 'Responsable pôle', co: 'EDF DTEAM',        s: 'status-lost',     sl: 'Perdu', p: 2, last: 'Il y a 45j',next: '—',          tel: '+33 6 22 41 08 53', dispo: 'off',  tags: ['énergie'] },
  { sel: false, n: 'Paul Moreau',     f: 'Dir. opérations',  co: 'BNP Paribas',      s: 'status-won',      sl: 'Gagné', p: 5, last: 'Hier',      next: '—',          tel: '+33 6 58 77 03 91', dispo: 'now',  tags: ['banque', '+3'] },
];

function TelCell({ tel, dispo }) {
  if (!tel) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  const map = {
    now:  { c: 'var(--success)',                     t: 'Joignable maintenant' },
    soon: { c: 'oklch(0.74 0.15 75)',                t: 'Plage proche (±1h)' },
    off:  { c: 'var(--text-muted)',                  t: 'Hors plage' },
  };
  const d = map[dispo] || { c: 'var(--text-muted)', t: '' };
  return (
    <a href={`tel:${tel.replace(/\s/g, '')}`} title={d.t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', color: 'var(--text-2)' }}>
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
        <Icon name="phone" size={10} />
        {dispo && <span aria-hidden style={{ position: 'absolute', right: -1, bottom: -1, width: 7, height: 7, borderRadius: 4, background: d.c, border: '1.5px solid var(--surface)', boxShadow: dispo === 'now' ? `0 0 0 2px ${d.c}22` : 'none' }} />}
      </span>
      <span className="mono" style={{ fontSize: 11.5 }}>{tel}</span>
    </a>
  );
}

function ProspectsTable() {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 4 }}>
      <div style={{ maxHeight: 560, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 32, paddingLeft: 14 }}><input type="checkbox" /></th>
              <th style={{ width: 240 }}>Nom</th>
              <th>Entreprise</th>
              <th>Statut</th>
              <th>Pertinence</th>
              <th>Mobile</th>
              <th>Dernière action</th>
              <th>Prochain RDV</th>
              <th>Tags</th>
              <th style={{ width: 96 }}></th>
            </tr>
          </thead>
          <tbody>
            {PROSPECTS_DATA.map((p, i) => (
              <tr key={i} className={p.sel ? 'selected' : ''}>
                <td style={{ paddingLeft: 14 }}><input type="checkbox" defaultChecked={p.sel} /></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="avatar">{p.n.split(' ').map(x => x[0]).join('')}</div>
                    <div>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{p.n}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.f}</div>
                    </div>
                  </div>
                </td>
                <td>{p.co}</td>
                <td><span className={`status ${p.s}`}>{p.sl}</span></td>
                <td><Pertinence n={p.p} /></td>
                <td><TelCell tel={p.tel} dispo={p.dispo} /></td>
                <td style={{ color: 'var(--text-2)' }}>{p.last}</td>
                <td style={{ color: 'var(--text-2)' }} className="num mono">{p.next}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {p.tags.map((t, j) => <span key={j} className="badge">{t}</span>)}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    {p.tel && <button className="btn btn-ghost btn-sm btn-icon" title={`Appeler ${p.tel}`}><Icon name="phone" size={12} /></button>}
                    <button className="btn btn-ghost btn-sm btn-icon" title="Pousser"><Icon name="send" size={12} /></button>
                    <button className="btn btn-ghost btn-sm btn-icon"><Icon name="dot3" size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface)', fontSize: 11.5, color: 'var(--text-3)' }}>
        <span>1–10 sur 1 247</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-sm btn-icon"><Icon name="chevL" size={12} /></button>
          <button className="btn btn-ghost btn-sm btn-icon"><Icon name="chevR" size={12} /></button>
        </div>
      </div>
    </div>
  );
}

function Pertinence({ n }) {
  return <div style={{ display: 'inline-flex', gap: 2 }}>{[1,2,3,4,5].map(i =>
    <span key={i} style={{ width: 4, height: 10 + i * 1.3, background: i <= n ? 'var(--accent)' : 'var(--surface-3)', borderRadius: 1 }} />)}</div>;
}

function ProspectsKanban() {
  const cols = [
    { t: 'Prospecter', c: 420, col: 'var(--info)',    items: [ { n: 'Alex Petit', co: 'Orange Business', t: 'tech' }, { n: 'Laure Giraud', co: 'Safran', t: 'aero' }, { n: 'Hadrien L.', co: 'Naval Group', t: 'defense' }] },
    { t: 'Contacté',   c: 186, col: 'var(--accent)',  items: [ { n: 'Thomas Martin', co: 'Sopra Steria', t: 'data' }, { n: 'Isabelle Renard', co: 'Thales', t: 'defense' }, { n: 'Mohamed Ben', co: 'Dassault', t: 'tech' }] },
    { t: 'RDV',        c: 54,  col: 'oklch(0.50 0.15 280)', items: [ { n: 'Marie Dubois', co: 'Capgemini', t: 'tech' }, { n: 'Kévin Lefèvre', co: 'Airbus', t: 'aero' }] },
    { t: 'Proposition',c: 18,  col: 'oklch(0.50 0.14 75)',  items: [ { n: 'Julie Bernard', co: 'Atos', t: 'rh' }] },
    { t: 'Gagné',      c: 7,   col: 'var(--success)', items: [ { n: 'Paul Moreau', co: 'BNP', t: 'banque' }] },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 12, marginTop: 8 }}>
      {cols.map((c, i) => (
        <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 2px' }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: c.col }} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{c.t}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.c}</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm btn-icon"><Icon name="plus" size={12}/></button>
          </div>
          {c.items.map((it, j) => (
            <div key={j} className="card" style={{ padding: 10, borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{it.n}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>{it.co}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8, alignItems: 'center' }}>
                <span className="badge">{it.t}</span>
                <div style={{ flex: 1 }} />
                <div className="avatar" style={{ width: 20, height: 20, fontSize: 9 }}>AB</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ProspectsSplit() {
  const [sel, setSel] = React.useState(0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 0, marginTop: 8, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', minHeight: 540 }}>
      <div style={{ borderRight: '1px solid var(--border)', background: 'var(--surface)', overflow: 'auto', maxHeight: 540 }}>
        {PROSPECTS_DATA.map((p, i) => (
          <div key={i} onClick={() => setSel(i)} style={{
            padding: '10px 12px', borderBottom: '1px solid var(--border)',
            background: i === sel ? 'var(--surface-2)' : 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div className="avatar">{p.n.split(' ').map(x => x[0]).join('')}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500 }} className="truncate">{p.n}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }} className="truncate">{p.co}</div>
            </div>
            <span className={`status ${p.s}`} style={{ fontSize: 10, padding: '1px 6px' }}>{p.sl}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 20, overflow: 'auto', maxHeight: 540 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
          <div className="avatar avatar-lg">{PROSPECTS_DATA[sel].n.split(' ').map(x => x[0]).join('')}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{PROSPECTS_DATA[sel].n}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{PROSPECTS_DATA[sel].f} · {PROSPECTS_DATA[sel].co}</div>
          </div>
          <button className="btn btn-accent btn-sm"><Icon name="send" size={12} /> Pousser</button>
          <button className="btn btn-sm"><Icon name="phone" size={12} /> Appeler</button>
        </div>
        <div className="tabs" style={{ marginTop: 14 }}>
          <button className="active">Aperçu</button>
          <button>Timeline <span className="tab-count">24</span></button>
          <button>Push <span className="tab-count">6</span></button>
          <button>Fichiers</button>
        </div>
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 240px', gap: 16 }}>
          <div>
            <div className="label">Notes</div>
            <div className="card" style={{ padding: 12, fontSize: 12.5, color: 'var(--text-2)' }}>
              A participé au meetup IA Défense. Budget Q2 confirmé. Mentionne une RFP à venir sur l'embarqué sécurisé.
            </div>
            <div className="label" style={{ marginTop: 14 }}>Activité récente</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['Email ouvert 3×','Tel passé il y a 2h','Statut → RDV','Note ajoutée','Tag ajouté : défense'].map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }} />
                  {e} <span className="mono" style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{i+1}j</span>
                </div>
              ))}
            </div>
          </div>
          <div className="stack gap-2">
            <div className="card" style={{ padding: 12 }}>
              <div className="label">Détails</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', display: 'grid', gap: 6 }}>
                <div>📧 marie.dubois@cap.com</div>
                <div>☎ +33 6 12 34 56 78</div>
                <div>🔗 linkedin.com/in/md</div>
                <div>📍 Paris</div>
              </div>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div className="label">Tags</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {PROSPECTS_DATA[sel].tags.map((t, i) => <span key={i} className="badge badge-accent">{t}</span>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ScreenProspects = ScreenProspects;
