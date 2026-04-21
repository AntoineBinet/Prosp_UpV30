// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

function ScreenSettings({ dark = true, onTab, active = 'dashboard', onToggleTheme }) {
  const t = theme(dark ? 'dark' : 'light');

  return (
    <Device dark={dark}>
      <LargeHeader dark={dark} title="Réglages"
        leading={<div style={{ color: T.accent, fontSize: 15, fontWeight: 500 }}>← Retour</div>} />

      <Scroll dark={dark}>
        {/* Profile */}
        <div style={{ margin: '0 16px', padding: 16, borderRadius: 20, background: t.bg3, border: `0.5px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 28,
            background: `linear-gradient(135deg, ${T.accent}, #FF8C42)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 20, letterSpacing: -0.5,
          }}>AM</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: t.text, letterSpacing: -0.3 }}>Antoine Marchand</div>
            <div style={{ fontSize: 12, color: t.text2, marginTop: 1 }}>antoine@up-technologies.fr</div>
            <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: T.accentSoft, color: T.accent, fontSize: 10, fontWeight: 700, letterSpacing: 0.4 }}>
              UP TECHNOLOGIES · NIV 14
            </div>
          </div>
          <svg width="10" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke={t.text3} strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
        </div>

        <SectionTitle dark={dark} title="Apparence" />
        <Group dark={dark}>
          <SettingRow dark={dark} icon="theme" label="Thème" value={dark ? 'Sombre' : 'Clair'} onClick={onToggleTheme} />
          <SettingRow dark={dark} icon="color" label="Couleur d'accent" swatch={T.accent} value="Orange" />
          <SettingRow dark={dark} icon="text" label="Taille du texte" value="Par défaut" last />
        </Group>

        <SectionTitle dark={dark} title="Mode Prosp" />
        <Group dark={dark}>
          <ToggleRow dark={dark} icon="bolt" label="Vibrations tactiles" on />
          <ToggleRow dark={dark} icon="auto" label="Auto-appel après 3s" on={false} />
          <ToggleRow dark={dark} icon="rec" label="Enregistrement appels" on />
          <SettingRow dark={dark} icon="filter" label="Filtres par défaut" value="5★ · Aero FR" last />
        </Group>

        <SectionTitle dark={dark} title="Intégrations" />
        <Group dark={dark}>
          <SettingRow dark={dark} icon="linkedin" label="LinkedIn Sales" value="Connecté" connected />
          <SettingRow dark={dark} icon="cal" label="Google Calendar" value="Connecté" connected />
          <SettingRow dark={dark} icon="phone" label="Aircall" value="Non connecté" />
          <SettingRow dark={dark} icon="zap" label="n8n Workflows" value="3 actifs" last />
        </Group>

        <SectionTitle dark={dark} title="Compte" />
        <Group dark={dark}>
          <SettingRow dark={dark} icon="lock" label="Sécurité & Face ID" />
          <SettingRow dark={dark} icon="bell" label="Notifications" />
          <SettingRow dark={dark} icon="help" label="Aide & support" />
          <SettingRow dark={dark} icon="out" label="Déconnexion" danger last />
        </Group>

        <div style={{ textAlign: 'center', padding: '16px 0 30px', fontSize: 11, color: t.text3, letterSpacing: 0.4 }}>
          ProspUp v29.8 · build 2026.04
        </div>
      </Scroll>

      <TabBar dark={dark} active={active} onTab={onTab} />
    </Device>
  );
}

function Group({ dark, children }) {
  const t = theme(dark ? 'dark' : 'light');
  return (
    <div style={{ margin: '0 16px', borderRadius: 16, background: t.bg3, border: `0.5px solid ${t.border}`, overflow: 'hidden' }}>
      {children}
    </div>
  );
}

function settingIcon(name, color) {
  const c = color;
  switch (name) {
    case 'theme': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.8"/><path d="M12 3v18" stroke={c} strokeWidth="1.8"/><path d="M12 3a9 9 0 010 18z" fill={c}/></svg>;
    case 'color': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" fill={c}/></svg>;
    case 'text': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M8 6v13M16 10v9M12 10h8" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
    case 'bolt': return <svg width="16" height="16" viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill={c}/></svg>;
    case 'auto': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 12a9 9 0 11-3-6.7M21 3v5h-5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
    case 'rec':  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill={c}/><circle cx="12" cy="12" r="8" stroke={c} strokeWidth="1.6"/></svg>;
    case 'filter': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z" stroke={c} strokeWidth="1.8" strokeLinejoin="round"/></svg>;
    case 'linkedin': return <svg width="16" height="16" viewBox="0 0 24 24" fill={c}><path d="M4 4h4v4H4zM4 10h4v10H4zM10 10h4v2c.7-1.5 2.5-2.4 4-2.4 3 0 5 2 5 5V20h-4v-4.4c0-1.7-.6-2.6-2-2.6s-2 1-2 2.6V20h-4V10z"/></svg>;
    case 'cal':  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke={c} strokeWidth="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
    case 'phone': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 4l3-1 2 5-2 1c1 2.5 3 4.5 5.5 5.5l1-2 5 2-1 3c-8 0-14-6-14-14z" stroke={c} strokeWidth="1.8"/></svg>;
    case 'zap':  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 4l-2 7h4l-2 9 9-11h-5l2-5H7z" stroke={c} strokeWidth="1.6" strokeLinejoin="round"/></svg>;
    case 'lock': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="10" width="16" height="11" rx="2" stroke={c} strokeWidth="1.8"/><path d="M8 10V7a4 4 0 018 0v3" stroke={c} strokeWidth="1.8"/></svg>;
    case 'bell': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 1112 0v5l2 3H4l2-3V8zM9 19a3 3 0 006 0" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
    case 'help': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.8"/><path d="M9 9a3 3 0 116 0c0 2-3 2-3 4M12 17v.5" stroke={c} strokeWidth="1.8" strokeLinecap="round"/></svg>;
    case 'out':  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4M16 8l4 4-4 4M10 12h10" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  }
}

function SettingRow({ dark, icon, label, value, onClick, last, danger, connected, swatch }) {
  const t = theme(dark ? 'dark' : 'light');
  const color = danger ? '#F87171' : t.text;
  return (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
      padding: '13px 14px', border: 'none', background: 'transparent',
      borderBottom: last ? 'none' : `0.5px solid ${t.divider}`,
      cursor: 'pointer', fontFamily: font, textAlign: 'left',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: danger ? 'rgba(239,68,68,0.12)' : T.accentSoft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: danger ? '#F87171' : T.accent, flexShrink: 0,
      }}>{settingIcon(icon, 'currentColor')}</div>
      <span style={{ flex: 1, fontSize: 14.5, color, fontWeight: 500, letterSpacing: -0.2 }}>{label}</span>
      {swatch && <span style={{ width: 16, height: 16, borderRadius: 4, background: swatch, border: `0.5px solid ${t.border2}` }}/>}
      {value && (
        <span style={{ fontSize: 13, color: connected ? '#4ADE80' : t.text2, fontWeight: 500 }}>
          {connected && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 3, background: '#4ADE80', marginRight: 6, verticalAlign: 'middle' }}/>}
          {value}
        </span>
      )}
      <svg width="8" height="12" viewBox="0 0 8 12"><path d="M1 1l6 5-6 5" stroke={t.text4} strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg>
    </button>
  );
}

function ToggleRow({ dark, icon, label, on: initialOn }) {
  const t = theme(dark ? 'dark' : 'light');
  const [on, setOn] = React.useState(initialOn);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px',
      borderBottom: `0.5px solid ${t.divider}`,
    }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: T.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.accent, flexShrink: 0 }}>
        {settingIcon(icon, 'currentColor')}
      </div>
      <span style={{ flex: 1, fontSize: 14.5, color: t.text, fontWeight: 500, letterSpacing: -0.2 }}>{label}</span>
      <button onClick={() => setOn(!on)} style={{
        width: 46, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer',
        background: on ? T.accent : t.bg4,
        position: 'relative', transition: 'background .2s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 20 : 2,
          width: 24, height: 24, borderRadius: 12, background: '#fff',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          transition: 'left .2s',
        }} />
      </button>
    </div>
  );
}

Object.assign(window, { ScreenSettings });
