// ─────────────────────────────────────────────────────────────
// Login screen — minimal, premium, dark first
// ─────────────────────────────────────────────────────────────

function ScreenLogin({ dark = true }) {
  const t = theme(dark ? 'dark' : 'light');
  const [user, setUser] = React.useState('antoine');
  const [pwd, setPwd] = React.useState('••••••••');

  return (
    <Device dark={dark}>
      {/* Ambient gradient orb background */}
      <div aria-hidden style={{
        position: 'absolute', top: 80, left: '-20%', width: '140%', height: 380,
        background: 'radial-gradient(ellipse at center, rgba(255,107,53,0.28) 0%, rgba(255,107,53,0) 60%)',
        filter: 'blur(20px)', pointerEvents: 'none', zIndex: 1,
      }} />
      <div aria-hidden style={{
        position: 'absolute', bottom: 120, right: '-30%', width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,140,66,0.15) 0%, rgba(255,140,66,0) 70%)',
        filter: 'blur(40px)', pointerEvents: 'none', zIndex: 1,
      }} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 28px 28px', position: 'relative', zIndex: 2 }}>
        {/* Brand mark — simple lock-up */}
        <div style={{ marginTop: 60, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: `linear-gradient(135deg, ${T.accent}, #FF8C42)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(255,107,53,0.35)',
            color: '#fff', fontWeight: 800, fontSize: 20, letterSpacing: -0.5,
          }}>P</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.text, letterSpacing: -0.3 }}>ProspUp</div>
            <div style={{ fontSize: 11, color: t.text3, letterSpacing: 0.5, textTransform: 'uppercase' }}>Up Technologies</div>
          </div>
        </div>

        <div style={{ marginTop: 48 }}>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: -0.8, color: t.text, lineHeight: 1.1 }}>
            Bon retour,<br/>
            <span style={{ color: T.accent }}>Antoine.</span>
          </h1>
          <div style={{ marginTop: 10, fontSize: 15, color: t.text2, lineHeight: 1.4, letterSpacing: -0.1 }}>
            Reprends ta session Mode Prosp<br/>là où tu l'avais laissée.
          </div>
        </div>

        {/* Form */}
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <LoginField dark={dark} label="Identifiant" value={user} onChange={setUser} icon="user" />
          <LoginField dark={dark} label="Mot de passe" value={pwd} onChange={setPwd} icon="lock" type="password" />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
            <span style={{ fontSize: 13, color: T.accent, fontWeight: 500 }}>Mot de passe oublié ?</span>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <button style={{
          width: '100%', height: 54, borderRadius: 18, border: 'none',
          background: T.accent, color: '#fff',
          fontFamily: font, fontSize: 16, fontWeight: 600, letterSpacing: -0.2,
          boxShadow: '0 10px 24px rgba(255,107,53,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
          cursor: 'pointer', marginTop: 24,
        }}>Se connecter</button>

        {/* Face ID hint */}
        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: t.text2, fontSize: 13,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2" stroke={t.text2} strokeWidth="1.8" strokeLinecap="round"/>
            <circle cx="9" cy="10.5" r=".8" fill={t.text2}/>
            <circle cx="15" cy="10.5" r=".8" fill={t.text2}/>
            <path d="M12 10v4h-1M10 16c1 .8 3 .8 4 0" stroke={t.text2} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
          </svg>
          Face ID disponible
        </div>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 11, color: t.text3, letterSpacing: 0.4 }}>
          v29.8 · prospup.work
        </div>
      </div>
    </Device>
  );
}

function LoginField({ dark, label, value, onChange, icon, type = 'text' }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 12,
      height: 56, padding: '0 16px',
      background: t.bg3, borderRadius: 16,
      border: `0.5px solid ${t.border}`,
    }}>
      <span style={{ color: t.text3 }}>
        {icon === 'user' ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: t.text3, letterSpacing: 0.3, textTransform: 'uppercase', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 16, color: t.text, fontWeight: 500, letterSpacing: -0.2, marginTop: 1 }}>
          {type === 'password' ? value : value}
        </div>
      </div>
    </label>
  );
}

Object.assign(window, { ScreenLogin });
