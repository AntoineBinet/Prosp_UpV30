/* global React, Icon */
function ScreenLogin() {
  return (
    <div style={{ height: '100%', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ padding: '48px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--text)', color: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-serif)', fontSize: 18 }}>P</div>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>Prosp'Up</span>
        </div>

        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 44, fontWeight: 400, margin: 0, letterSpacing: -0.5, lineHeight: 1.1 }}>Bon retour.</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-3)', marginTop: 8, marginBottom: 28 }}>Connectez-vous pour retrouver votre pipeline, vos campagnes et vos candidats.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div className="label">Email</div>
              <input className="input" style={{ height: 38 }} defaultValue="antoine.binet@prospup.com" />
            </div>
            <div>
              <div className="row-sb">
                <div className="label">Mot de passe</div>
                <a style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Oublié ?</a>
              </div>
              <input className="input" style={{ height: 38 }} type="password" defaultValue="••••••••••" />
            </div>
            <button className="btn btn-accent btn-lg" style={{ height: 40, marginTop: 6 }}>Se connecter</button>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>v30.0 · MAJ auto</div>
      </div>

      <div style={{ background: 'var(--ink-950)', color: 'white', padding: 56, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 8px, rgba(255,255,255,0.02) 8px 9px)', pointerEvents: 'none' }}/>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>Refonte v30</div>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 36, lineHeight: 1.15, letterSpacing: -0.3, fontStyle: 'italic', color: 'rgba(255,255,255,0.95)' }}>
            « Trois fois moins de clics pour envoyer un push, trois fois plus de RDV. »
          </div>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 16, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>JM</div>
            Julien M. · Consultant sourcing · depuis 2024
          </div>
        </div>
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          {[['+38%','RDV obtenus'],['−42%','Clics par push'],['7j','Série moyenne']].map(([v,l], i) => (
            <div key={i}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'white' }}>{v}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScreenPalette() {
  return (
    <div style={{ height: '100%', width: '100%', background: 'oklch(0 0 0 / 0.45)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 80 }}>
      <div style={{ width: 640, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={16}/>
          <input className="input" style={{ border: 0, height: 'auto', padding: 0, fontSize: 15 }} defaultValue="capgemini" />
          <span className="kbd">Esc</span>
        </div>
        <div style={{ maxHeight: 440, overflow: 'auto' }}>
          <PaletteSection title="Actions rapides">
            <PalRow icon="plus"      label="Créer un prospect" k="P" />
            <PalRow icon="send"      label="Nouvelle campagne" k="N" />
            <PalRow icon="sparkles"  label="Lancer Mode Prosp" k="M" />
            <PalRow icon="moon"      label="Basculer thème" k="T" />
          </PaletteSection>
          <PaletteSection title="Prospects · 3 résultats">
            <PalRow avatar="MD" label="Marie Dubois" sub="CTO · Capgemini" trailing={<span className="status status-meeting">RDV</span>} active />
            <PalRow avatar="SP" label="Sophie Pelletier" sub="DSI · Capgemini" trailing={<span className="status status-contact">Contacté</span>} />
            <PalRow avatar="RM" label="Rachid Mahfoudi" sub="Lead Data · Capgemini" trailing={<span className="status status-new">Nouveau</span>} />
          </PaletteSection>
          <PaletteSection title="Entreprises · 1 résultat">
            <PalRow avatar="CG" label="Capgemini" sub="Conseil · 340k employés · 12 prospects" />
          </PaletteSection>
          <PaletteSection title="Aller à…">
            <PalRow icon="home"     label="Dashboard"   sub="Vue d'ensemble" />
            <PalRow icon="users"    label="Prospects"   sub="Tous les contacts" />
            <PalRow icon="building" label="Entreprises" sub="Comptes" />
          </PaletteSection>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)', background: 'var(--surface-2)' }}>
          <span><span className="kbd">↑</span><span className="kbd">↓</span> Naviguer</span>
          <span><span className="kbd">↵</span> Ouvrir</span>
          <span><span className="kbd">⌘</span><span className="kbd">↵</span> Ouvrir en côté</span>
          <div style={{ flex: 1 }}/>
          <span>Propulsé par <b>ProspUp AI</b></span>
        </div>
      </div>
    </div>
  );
}

function PaletteSection({ title, children }) {
  return (
    <div>
      <div style={{ padding: '10px 14px 4px', fontSize: 10.5, letterSpacing: 0.08, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</div>
      {children}
    </div>
  );
}
function PalRow({ icon, avatar, label, sub, k, trailing, active }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}>
      {icon && <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={14}/></div>}
      {avatar && <div className="avatar" style={{ width: 26, height: 26 }}>{avatar}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }} className="truncate">{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }} className="truncate">{sub}</div>}
      </div>
      {trailing}
      {k && <span className="kbd">{k}</span>}
    </div>
  );
}

window.ScreenLogin = ScreenLogin;
window.ScreenPalette = ScreenPalette;
