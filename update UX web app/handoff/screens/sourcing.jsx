/* global React, Shell, Icon */
function ScreenSourcing() {
  const cols = [
    { t: 'Vivier',       c: 62, col: 'var(--info)',    items: [
      { n: 'Thomas Richter', r: 'C++ / ARM',       skills: ['C++','ARM','RTOS'], m: 94, d: 'Libre' },
      { n: 'Sarah Koenig',   r: 'Embedded Linux',  skills: ['Linux','Yocto','C'], m: 87, d: 'Libre' },
      { n: 'Farid A.',       r: 'DSP / Signal',    skills: ['Matlab','DSP'], m: 72, d: 'Libre' },
    ]},
    { t: 'Qualifié',     c: 18, col: 'var(--accent)',  items: [
      { n: 'Yassine B.',     r: 'DevSecOps',       skills: ['K8s','Vault','Terraform'], m: 79, d: 'Libre 15/05' },
      { n: 'Manon Leclerc',  r: 'Cloud Architect', skills: ['AWS','Terraform'], m: 84, d: 'Libre' },
    ]},
    { t: 'Proposé',      c: 9,  col: 'oklch(0.50 0.15 280)', items: [
      { n: 'Khaled R.',      r: 'Data Engineer',    skills: ['Spark','Snowflake'], m: 91, d: 'Chez Capgemini' },
    ]},
    { t: 'En entretien', c: 4,  col: 'oklch(0.50 0.14 75)',  items: [
      { n: 'Claire D.',      r: 'Tech Lead Java',   skills: ['Java','Kafka'], m: 88, d: 'Thales 22/04' },
    ]},
    { t: 'Placé',        c: 12, col: 'var(--success)', items: [
      { n: 'Pierre G.',      r: 'CTO Fractional',   skills: ['AWS','Leadership'], m: 96, d: 'BNP' },
    ]},
  ];
  return (
    <Shell active="candidats" crumbs={["Prosp'Up", 'Candidats']}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Candidats</h1>
        <span style={{ color: 'var(--text-3)' }}>· 89 actifs</span>
        <div style={{ flex: 1 }} />
        <div className="segmented">
          <button className="active"><Icon name="kanban" size={13}/> Pipeline</button>
          <button><Icon name="table" size={13}/> Grille</button>
        </div>
        <button className="btn btn-sm"><Icon name="plus" size={13}/> Ajouter</button>
      </div>

      {/* Match banner */}
      <div style={{ padding: '10px 14px', background: 'var(--accent-soft)', border: '1px solid color-mix(in oklch, var(--accent) 25%, transparent)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, fontSize: 12.5 }}>
        <Icon name="sparkles" size={14} />
        <span>Matching actif pour <b>« Embarqué Q2 · C++/ARM »</b> — 14 candidats correspondent</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm">Voir filtres</button>
        <button className="btn btn-ghost btn-sm btn-icon"><Icon name="x" size={12}/></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 12 }}>
        {cols.map((c, i) => (
          <div key={i} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 2px' }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: c.col }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{c.t}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.c}</span>
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm btn-icon"><Icon name="plus" size={12}/></button>
            </div>
            {c.items.map((it, j) => (
              <div key={j} className="card" style={{ padding: 10, borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="avatar">{it.n.split(' ').map(x => x[0]).join('')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }} className="truncate">{it.n}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }} className="truncate">{it.r}</div>
                  </div>
                  <span className="badge badge-success num" style={{ fontSize: 10 }}>{it.m}%</span>
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 8 }}>
                  {it.skills.map((s, k) => <span key={k} className="badge" style={{ fontSize: 10, height: 18 }}>{s}</span>)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="clock" size={11}/> {it.d}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Shell>
  );
}

// Fiche candidat
function ScreenCandidat() {
  const weeks = Array.from({ length: 8 }, (_, i) => i);
  const statuses = ['libre','libre','libre','libre','busy','busy','libre','libre'];
  const colFor = { libre: 'var(--success-soft)', busy: 'var(--warn-soft)', placed: 'var(--accent-soft)' };
  const textFor = { libre: 'Libre', busy: 'Mission', placed: 'Placé' };
  return (
    <Shell active="candidats" crumbs={["Prosp'Up", 'Candidats', 'Thomas Richter']} noPadding>
      <div style={{ padding: '16px 24px' }}>
        <div className="card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center', padding: 16 }}>
          <div className="avatar avatar-lg" style={{ width: 56, height: 56, fontSize: 18 }}>TR</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Thomas Richter</h1>
              <span className="badge badge-success">Libre</span>
              <span className="badge badge-accent">Match 94% · Embarqué Q2</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>Ingénieur Embarqué Senior · Paris · 12 ans d'exp · TJM 680€</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-accent"><Icon name="report" size={13}/> Générer DC</button>
            <button className="btn"><Icon name="send" size={13}/> Pousser</button>
            <button className="btn btn-ghost btn-icon"><Icon name="dot3" size={14}/></button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginTop: 16 }}>
          <div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>Compétences</div>
              {[
                { cat: 'Langages',    items: [['C++', 5], ['C', 5], ['Python', 4], ['Rust', 3]] },
                { cat: 'Systèmes',    items: [['ARM Cortex', 5], ['FreeRTOS', 5], ['Embedded Linux', 4], ['Yocto', 3]] },
                { cat: 'Sécurité',    items: [['Cryptography', 4], ['Secure Boot', 4], ['TEE / TrustZone', 3]] },
                { cat: 'Outils',      items: [['GDB', 5], ['Git', 5], ['Jenkins', 4]] },
              ].map((g, i) => (
                <div key={i} style={{ marginTop: i ? 12 : 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 0.06, textTransform: 'uppercase', marginBottom: 6 }}>{g.cat}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {g.items.map(([name, lvl], j) => (
                      <div key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 12 }}>{name}</span>
                        <span style={{ display: 'inline-flex', gap: 1.5 }}>{[1,2,3,4,5].map(k => <span key={k} style={{ width: 3, height: 8, background: k <= lvl ? 'var(--accent)' : 'var(--surface-3)' }}/>)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="row-sb" style={{ marginBottom: 10 }}>
                <div className="card-title">Disponibilités · 8 prochaines semaines</div>
                <button className="btn btn-ghost btn-sm">Éditer</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
                {weeks.map(w => (
                  <div key={w} style={{ background: colFor[statuses[w]], padding: '10px 6px', borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>S{17+w}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>{textFor[statuses[w]]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="stack gap-3">
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Campagnes match</div>
              {[
                { n: 'Embarqué Q2 2026', m: 94, resp: '—' },
                { n: 'Cloud Architectes', m: 62, resp: 'hors scope' },
              ].map((c, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid var(--border)' : 0, padding: '8px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{c.n}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.resp}</div>
                  </div>
                  <span className="badge badge-success num">{c.m}%</span>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="card-title" style={{ marginBottom: 8 }}>Missions passées</div>
              {[
                { c: 'Capgemini', m: 'Sécurisation bootloader auto', d: '2024 — 2025' },
                { c: 'Airbus',    m: 'Développement FW navigation',   d: '2022 — 2024' },
                { c: 'Thales',    m: 'Architecture embarqué défense', d: '2019 — 2022' },
              ].map((m, i) => (
                <div key={i} style={{ borderTop: i ? '1px solid var(--border)' : 0, padding: '8px 0' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{m.c}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{m.m}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }} className="mono">{m.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

window.ScreenSourcing = ScreenSourcing;
window.ScreenCandidat = ScreenCandidat;
