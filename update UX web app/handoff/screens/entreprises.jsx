/* global React, Shell, Icon */
// Entreprises
function ScreenEntreprises() {
  const rows = [
    { n: 'Capgemini',        sec: 'Conseil',          emp: '340k',  p: 12, o: 3, last: 'Aujourd\'hui', rev: '€420k' },
    { n: 'Sopra Steria',     sec: 'SSII',             emp: '52k',   p: 8,  o: 2, last: 'Hier',         rev: '€180k' },
    { n: 'Atos',             sec: 'IT services',      emp: '107k',  p: 14, o: 1, last: 'Il y a 2j',    rev: '€75k'  },
    { n: 'Orange Business',  sec: 'Télécom',          emp: '28k',   p: 6,  o: 2, last: 'Il y a 3j',    rev: '€240k' },
    { n: 'Thales Group',     sec: 'Défense',          emp: '81k',   p: 22, o: 4, last: 'Il y a 1j',    rev: '€560k' },
    { n: 'Airbus Defence',   sec: 'Aéronautique',     emp: '34k',   p: 9,  o: 1, last: 'Il y a 5j',    rev: '€140k' },
    { n: 'Safran',           sec: 'Aéronautique',     emp: '92k',   p: 11, o: 2, last: 'Il y a 4j',    rev: '€210k' },
    { n: 'BNP Paribas',      sec: 'Banque',           emp: '190k',  p: 4,  o: 1, last: 'Hier',         rev: '€60k'  },
    { n: 'Renault Digital',  sec: 'Automobile',       emp: '3.2k',  p: 5,  o: 0, last: 'Il y a 12j',   rev: '—'     },
    { n: 'EDF DTEAM',        sec: 'Énergie',          emp: '450',   p: 3,  o: 1, last: 'Il y a 45j',   rev: '€40k'  },
  ];
  return (
    <Shell active="entreprises" crumbs={["Prosp'Up", 'Entreprises']} noPadding>
      <div style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>Entreprises <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>342</span></h1>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm"><Icon name="filter" size={13}/> Filtres</button>
          <button className="btn btn-sm"><Icon name="plus" size={13}/> Ajouter</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '16px 0' }}>
          <Kpi label="Total entreprises" value="342" />
          <Kpi label="Pipés" value="47" delta="+6" />
          <Kpi label="CA prévisionnel" value="€1.1M" delta="+€180k" />
          <Kpi label="Secteurs" value="14" />
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 14 }}>Entreprise</th>
                <th>Secteur</th>
                <th>Effectif</th>
                <th>Prospects</th>
                <th>Opportunités</th>
                <th>Dernier contact</th>
                <th style={{ textAlign: 'right', paddingRight: 14 }}>CA prévu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ paddingLeft: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{r.n.slice(0,2).toUpperCase()}</div>
                      <span style={{ fontWeight: 500 }}>{r.n}</span>
                    </div>
                  </td>
                  <td><span className="badge">{r.sec}</span></td>
                  <td className="num">{r.emp}</td>
                  <td className="num"><span style={{ color: 'var(--accent)', fontWeight: 500 }}>{r.p}</span></td>
                  <td className="num">{r.o || '—'}</td>
                  <td style={{ color: 'var(--text-2)' }}>{r.last}</td>
                  <td className="mono num" style={{ textAlign: 'right', paddingRight: 14, fontWeight: 500 }}>{r.rev}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
function Kpi({ label, value, delta }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 0.06, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      {delta && <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 2 }}>{delta} vs sem-1</div>}
    </div>
  );
}
window.ScreenEntreprises = ScreenEntreprises;
