/* global React, Shell, Icon */
// Fiche Prospect — detailed record view
function ScreenProspectDetail() {
  return (
    <Shell active="prospects" crumbs={["Prosp'Up", 'Prospects', 'Marie Dubois']} noPadding>
      <div style={{ padding: '16px 24px 32px' }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, alignItems: 'center', padding: '16px 20px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14 }}>
          <div className="avatar avatar-lg" style={{ width: 56, height: 56, fontSize: 18 }}>MD</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Marie Dubois</h1>
              <span className="status status-meeting">RDV aujourd'hui</span>
              <span className="badge badge-accent">⭐ Hot</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>CTO chez <b style={{ color: 'var(--text-2)' }}>Capgemini</b> · Paris · <span className="mono">Dernière activité il y a 2h</span></div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
              <span className="badge"><Icon name="mail" size={11} /> marie.dubois@cap.com</span>
              <span className="badge"><Icon name="phone" size={11} /> +33 6 12 34 56 78</span>
              <span className="badge"><Icon name="link" size={11} /> linkedin.com/in/md</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-accent"><Icon name="send" size={13} /> Pousser</button>
            <button className="btn"><Icon name="phone" size={13} /> Appeler</button>
            <button className="btn"><Icon name="calendar" size={13} /> Planifier</button>
            <button className="btn btn-ghost btn-icon"><Icon name="dot3" size={14} /></button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginTop: 16 }}>
          {/* Main */}
          <div>
            <div className="tabs" style={{ marginBottom: 14 }}>
              <button className="active">Aperçu</button>
              <button>Timeline <span className="tab-count">24</span></button>
              <button>Push <span className="tab-count">6</span></button>
              <button>Fichiers <span className="tab-count">3</span></button>
              <button>IA <span className="tab-count">4</span></button>
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row-sb" style={{ marginBottom: 8 }}>
                <div className="card-title">Notes rapides</div>
                <button className="btn btn-ghost btn-sm">Éditer</button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                Rencontrée au meetup IA Défense. Budget Q2 confirmé.
                Mentionne une <b style={{ color: 'var(--text)' }}>RFP à venir sur l'embarqué sécurisé</b> — bien caler le DC Thomas Richter sur ce sujet.
                Préfère un échange le matin.
              </div>
            </div>

            <div className="card card-flush">
              <div className="card-header">
                <div className="card-title">Activité</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm">Tous</button>
                  <button className="btn btn-ghost btn-sm">Push</button>
                  <button className="btn btn-ghost btn-sm">Notes</button>
                </div>
              </div>
              <div style={{ padding: '4px 16px 12px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 28, top: 12, bottom: 12, width: 1, background: 'var(--border)' }} />
                {[
                  { t: 'aujourd\'hui · 12:02', c: 'var(--accent)', title: 'Email envoyé', body: '« Suivi RFP embarqué — Safran 2026 »' },
                  { t: 'aujourd\'hui · 11:45', c: 'oklch(0.50 0.15 280)', title: 'RDV confirmé', body: 'Visio Teams lundi 14h avec Marie + Paul Leblanc (CTO)' },
                  { t: 'hier · 09:20',         c: 'var(--success)',    title: 'Statut → RDV',   body: 'Déplacé de "Contacté" vers "RDV"' },
                  { t: 'il y a 3j',             c: 'var(--text-3)',    title: 'Note ajoutée',   body: 'Budget Q2 confirmé côté DSI' },
                  { t: 'il y a 5j',             c: 'var(--accent)',    title: 'Email ouvert',   body: '« Opportunité Prosp\'Up × Capgemini » — 3 ouvertures' },
                  { t: 'il y a 8j',             c: 'var(--text-3)',    title: 'Import Excel',   body: 'Prospect importé depuis prospection_Q2.xlsx' },
                ].map((e, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 12px 1fr', gap: 10, padding: '10px 0', alignItems: 'start' }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', paddingTop: 2 }}>{e.t}</span>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: e.c, marginTop: 4, marginLeft: 1, border: '2px solid var(--surface)' }} />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{e.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{e.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Aside */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="label">Détails</div>
              <AsideRow label="Statut"><span className="status status-meeting">RDV</span></AsideRow>
              <AsideRow label="Pertinence"><Pert5 n={5} /></AsideRow>
              <AsideRow label="Source">LinkedIn Sales Nav</AsideRow>
              <AsideRow label="Owner"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span className="avatar" style={{ width: 18, height: 18, fontSize: 9 }}>AB</span>Antoine B.</span></AsideRow>
              <AsideRow label="Créé le">02/01/2026</AsideRow>
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div className="row-sb" style={{ marginBottom: 8 }}>
                <div className="label" style={{ margin: 0 }}>Candidats recommandés</div>
                <button className="btn btn-ghost btn-sm"><Icon name="sparkles" size={12}/></button>
              </div>
              {[
                { n: 'Thomas Richter', r: 'C++ / ARM', m: 94 },
                { n: 'Sarah Koenig',   r: 'Embedded Linux', m: 87 },
                { n: 'Yassine B.',     r: 'DevSecOps', m: 79 },
              ].map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 0 }}>
                  <div className="avatar">{c.n.split(' ').map(x => x[0]).join('')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }} className="truncate">{c.n}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.r}</div>
                  </div>
                  <span className="badge badge-success num">{c.m}%</span>
                </div>
              ))}
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div className="label">Tags</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {['tech', 'defense', 'embarqué', 'paris', 'hot', 'rfp-2026'].map((t, i) => <span key={i} className="badge badge-accent">{t}</span>)}
                <span className="badge"><Icon name="plus" size={10}/></span>
              </div>
            </div>

            <div className="card" style={{ padding: 14 }}>
              <div className="label">Entreprise</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>CG</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Capgemini</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Conseil · 340k employés</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
                <span>12 prospects</span><span>3 opportunités</span><span className="mono">€420k</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
function AsideRow({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', alignItems: 'center', padding: '5px 0', fontSize: 12, borderTop: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{children}</span>
    </div>
  );
}
function Pert5({ n }) {
  return <span style={{ display: 'inline-flex', gap: 2 }}>{[1,2,3,4,5].map(i => <span key={i} style={{ width: 4, height: 10, background: i <= n ? 'var(--accent)' : 'var(--surface-3)', borderRadius: 1 }} />)}</span>;
}
window.ScreenProspectDetail = ScreenProspectDetail;
