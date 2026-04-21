/* global React, Shell, Icon */
function ScreenStats() {
  const [tab, setTab] = React.useState('dashboard');
  return (
    <Shell active="stats" crumbs={["Prosp'Up", 'Stats & Rapport']}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Stats & Rapport</h1>
        <div className="segmented">
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}>Tableau de bord</button>
          <button className={tab === 'rapport' ? 'active' : ''} onClick={() => setTab('rapport')}>Rapport</button>
        </div>
        <div style={{ flex: 1 }} />
        <div className="segmented">
          <button>7j</button><button className="active">30j</button><button>90j</button><button>Tout</button>
        </div>
        <button className="btn btn-sm"><Icon name="arrowD" size={13}/> Exporter</button>
      </div>

      {tab === 'dashboard' ? <StatsDashboard /> : <Rapport />}
    </Shell>
  );
}

function StatsDashboard() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <StatCard label="Push envoyés" value="1 247" delta="+18%" />
      <StatCard label="Taux ouverture" value="42%" delta="+4pt" />
      <StatCard label="Taux réponse" value="11%" delta="+2pt" />
      <StatCard label="RDV obtenus" value="38" delta="+12" />

      <div className="card" style={{ gridColumn: 'span 2', minHeight: 220 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>RDV par semaine</div>
        <BarChart values={[3, 5, 4, 6, 8, 7, 9, 8, 11, 9, 10, 12]} />
      </div>
      <div className="card" style={{ gridColumn: 'span 2', minHeight: 220 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Push / semaine par canal</div>
        <StackedBars values={[[22,8],[34,10],[18,14],[42,12],[28,16],[36,18],[40,20],[33,22],[45,18],[38,24],[42,22],[48,28]]} />
      </div>

      <div className="card" style={{ gridColumn: 'span 2', minHeight: 220 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Funnel conversion</div>
        <Funnel data={[
          { l: 'Prospects contactés', n: 1247 },
          { l: 'Ouverts', n: 523 },
          { l: 'Répondus', n: 137 },
          { l: 'RDV pris', n: 38 },
          { l: 'Gagnés', n: 12 },
        ]} />
      </div>
      <div className="card" style={{ gridColumn: 'span 2', minHeight: 220 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Top entreprises (CA prévu)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {[
            ['Thales Group', 560, 'var(--accent)'],
            ['Capgemini',    420, 'var(--accent)'],
            ['Orange Bus.',  240, 'var(--accent)'],
            ['Safran',       210, 'var(--accent)'],
            ['Sopra Steria', 180, 'var(--accent)'],
          ].map(([n, v], i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 60px', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <span>{n}</span>
              <div style={{ height: 14, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(v/560)*100}%`, background: 'var(--accent)' }}/>
              </div>
              <span className="mono num" style={{ textAlign: 'right' }}>€{v}k</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, delta }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 0.06, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 2 }}>{delta} vs période préc.</div>
    </div>
  );
}

function BarChart({ values }) {
  const max = Math.max(...values);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, paddingTop: 8 }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ width: '80%', height: `${(v/max)*100}%`, background: i === values.length-1 ? 'var(--accent)' : 'var(--surface-3)', borderRadius: '3px 3px 0 0' }}/>
          <span style={{ fontSize: 10, color: 'var(--text-3)' }} className="mono">S{i+5}</span>
        </div>
      ))}
    </div>
  );
}

function StackedBars({ values }) {
  const max = Math.max(...values.map(([a,b]) => a + b));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, paddingTop: 8 }}>
        {values.map(([a, b], i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
            <div style={{ width: '78%', height: `${((a+b)/max)*100}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '3px 3px 0 0', overflow: 'hidden' }}>
              <div style={{ flex: a, background: 'var(--accent)' }}/>
              <div style={{ flex: b, background: 'oklch(0.70 0.10 258)' }}/>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: 2 }}/>Email</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'oklch(0.70 0.10 258)', borderRadius: 2 }}/>LinkedIn</span>
      </div>
    </div>
  );
}

function Funnel({ data }) {
  const max = data[0].n;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {data.map((d, i) => {
        const pct = (d.n / max) * 100;
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ color: 'var(--text-2)' }}>{d.l}</span>
            <div style={{ height: 24, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: `oklch(${0.85 - i*0.07} ${0.08 + i*0.02} 258)` }}/>
              <span style={{ position: 'absolute', left: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 11.5, fontWeight: 500, color: i < 2 ? 'var(--text-2)' : 'white' }}>{pct.toFixed(1)}%</span>
            </div>
            <span className="mono num" style={{ textAlign: 'right', fontWeight: 500 }}>{d.n.toLocaleString('fr-FR')}</span>
          </div>
        );
      })}
    </div>
  );
}

function Rapport() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
      <div className="card" style={{ padding: 24, minHeight: 600 }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: 0.08, textTransform: 'uppercase', marginBottom: 6 }}>Rapport hebdomadaire · S17 · 15 → 21 avril 2026</div>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 400, margin: '0 0 6px', letterSpacing: -0.5 }}>Une semaine solide sur la défense.</h2>
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>Antoine Binet · Généré automatiquement, éditable</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, margin: '16px 0 20px' }}>
          <Mini label="Push" v="47" />
          <Mini label="Taux réponse" v="14%" />
          <Mini label="RDV obtenus" v="8" />
        </div>

        <RapSection title="Faits marquants">
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            <li>Ouverture sérieuse côté <b>Thales Group</b> — RFP embarqué sécurisé confirmée pour Q3.</li>
            <li>8 RDV pris cette semaine, dont 3 CTO (+60% vs S16).</li>
            <li>Campagne « Embarqué Q2 » : 29% de réponse — meilleure perf trimestrielle.</li>
          </ul>
        </RapSection>

        <RapSection title="Risques">
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            <li><b>4 relances en retard</b> de plus de 10 jours à traiter d'ici mercredi.</li>
            <li>Pipeline "Proposition" faible (n=18) — risque sur CA M+2.</li>
          </ul>
        </RapSection>

        <RapSection title="Plan S18">
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            <li>Lancer campagne « Cloud Architectes Paris » (62 cibles, programmée 25/04).</li>
            <li>Prépa RDV Thales + Airbus avec DC dédiés Thomas Richter & Sarah Koenig.</li>
            <li>Clean-up pipeline, archiver prospects inactifs &gt;60j.</li>
          </ul>
        </RapSection>
      </div>
      <div className="stack gap-3">
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>Actions</div>
          <button className="btn w-full" style={{ justifyContent: 'flex-start' }}><Icon name="arrowD" size={13}/> Télécharger PDF</button>
          <button className="btn w-full" style={{ justifyContent: 'flex-start', marginTop: 6 }}><Icon name="send" size={13}/> Envoyer par mail</button>
          <button className="btn w-full" style={{ justifyContent: 'flex-start', marginTop: 6 }}><Icon name="sparkles" size={13}/> Régénérer</button>
        </div>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>Sections</div>
          {['Faits marquants','Risques','Plan S18','KPI détaillés','Équipe'].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0', fontSize: 12.5, color: 'var(--text-2)' }}>
              <Icon name="check" size={12} /> {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Mini({ label, v }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28 }}>{v}</div>
    </div>
  );
}
function RapSection({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ fontSize: 11.5, color: 'var(--text-3)', letterSpacing: 0.08, textTransform: 'uppercase', margin: '0 0 8px', fontWeight: 500 }}>{title}</h3>
      {children}
    </div>
  );
}

window.ScreenStats = ScreenStats;
