/* global React */
// ============================================================
// ProspUp v30 — shared chrome
// Topbar + sidebar + command palette hint. Used inside design
// canvas artboards so each screen shows the same global shell.
// ============================================================

const Icon = ({ name, size = 14 }) => {
  const s = size;
  const sw = 1.6;
  const common = {
    width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round'
  };
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    users: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5S15.5 16.4 15.5 20"/><circle cx="17" cy="9" r="3"/><path d="M15 14.3A5 5 0 0 1 21.5 19"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>,
    building: <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/><path d="M10 21v-4h4v4"/></>,
    send: <><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></>,
    chart: <><path d="M3 3v18h18"/><path d="M7 14l3-4 4 2 5-7"/></>,
    report: <><rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    focus: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
    chevR: <><path d="m9 6 6 6-6 6"/></>,
    chevD: <><path d="m6 9 6 6 6-6"/></>,
    chevL: <><path d="m15 6-6 6 6 6"/></>,
    check: <><path d="m5 12 5 5 9-11"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></>,
    phone: <><path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></>,
    link: <><path d="M10 14a5 5 0 0 1 0-7l3-3a5 5 0 0 1 7 7l-2 2"/><path d="M14 10a5 5 0 0 1 0 7l-3 3a5 5 0 0 1-7-7l2-2"/></>,
    star: <><path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></>,
    filter: <><path d="M3 5h18M6 12h12M10 19h4"/></>,
    cog: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4.9a7 7 0 0 0-1.7-1L14 3h-4l-.8 2.5a7 7 0 0 0-1.7 1l-2.4-.9-2 3.4L5 11c0 .3-.1.7-.1 1s0 .7.1 1l-2 1.5 2 3.4 2.4-.9a7 7 0 0 0 1.7 1l.9 2.5h4l.8-2.5a7 7 0 0 0 1.7-1l2.4.9 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></>,
    command: <><path d="M18 6a3 3 0 1 0-3 3h3z"/><path d="M6 18a3 3 0 1 0 3-3H6z"/><path d="M18 18a3 3 0 1 1-3-3h3z"/><path d="M6 6a3 3 0 1 1 3 3H6z"/></>,
    drag: <><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></>,
    dot3: <><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>,
    arrowR: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrowU: <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    arrowD: <><path d="M12 5v14M6 13l6 6 6-6"/></>,
    flame: <><path d="M12 2s5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 0 1 2 0 4 2-1 3-3 3-10z"/></>,
    zap: <><path d="m13 2-9 13h7l-1 7 9-13h-7z"/></>,
    sparkles: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"/></>,
    kanban: <><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/></>,
    split: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M10 4v16"/></>,
    moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></>,
    bookmark: <><path d="M6 3h12v18l-6-4-6 4z"/></>,
    tag: <><path d="M20 12 12 4H4v8l8 8z"/><circle cx="8" cy="8" r="1.2"/></>,
    x: <><path d="M6 6l12 12M18 6 6 18"/></>,
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 5l-3 7v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3-7z"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    bulb: <><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.6c1 .9 1 2 1 3.4h6c0-1.4 0-2.5 1-3.4A7 7 0 0 0 12 2z"/></>,
  };
  return <svg {...common}>{paths[name] || null}</svg>;
};

// ─── Topbar ─────────────────────────────────────────────────
function Topbar({ crumbs = ["Prosp'Up"] }) {
  return (
    <header style={{
      height: 48, display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 12px', borderBottom: '1px solid var(--border)',
      background: 'var(--surface)', position: 'relative', zIndex: 10,
    }}>
      {/* Logo + crumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 232 - 12 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'var(--text)', color: 'var(--bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 500, letterSpacing: -0.5,
        }}>P</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: 'var(--text-muted)' }}><Icon name="chevR" size={12} /></span>}
              <span style={{ color: i === crumbs.length - 1 ? 'var(--text)' : 'var(--text-3)', fontWeight: i === crumbs.length - 1 ? 500 : 400 }}>{c}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Command K */}
      <button className="btn btn-ghost" style={{
        width: 360, justifyContent: 'space-between', gap: 8, height: 30,
        color: 'var(--text-3)', background: 'var(--surface-2)', borderColor: 'transparent',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name="search" size={14} />
          <span>Rechercher ou sauter vers…</span>
        </span>
        <span style={{ display: 'inline-flex', gap: 2 }}>
          <span className="kbd">⌘</span><span className="kbd">K</span>
        </span>
      </button>

      <div style={{ flex: 1 }} />

      {/* Right actions */}
      <button className="btn"><Icon name="plus" size={14} /> Créer <span className="kbd" style={{ marginLeft: 4 }}>C</span></button>
      <button className="btn btn-ghost btn-icon" title="Notifications"><Icon name="bell" size={14} /></button>
      <div className="avatar" style={{ marginLeft: 4 }}>AB</div>
    </header>
  );
}

// ─── Theme toggle ───────────────────────────────────────────
function ThemeToggle() {
  const read = () => (typeof document !== 'undefined' ? document.documentElement.dataset.theme : 'dark') || 'dark';
  const [theme, setTheme] = React.useState(read());
  React.useEffect(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('theme') : null;
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved;
      setTheme(saved);
    }
  }, []);
  const toggle = (e) => {
    e.stopPropagation();
    const next = read() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch(_) {}
    setTheme(next);
  };
  return (
    <button onClick={toggle} className="btn btn-ghost btn-sm btn-icon" title={theme === 'dark' ? 'Passer en clair' : 'Passer en sombre'}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14}/>
    </button>
  );
}

// ─── Sidebar ────────────────────────────────────────────────
function Sidebar({ active = 'dashboard' }) {
  const navItems = [
    { id: 'dashboard', icon: 'home',     label: 'Dashboard' },
    { id: 'focus',     icon: 'focus',    label: 'Focus',     count: 12 },
    { id: 'calendar',  icon: 'calendar', label: 'Calendrier' },
    { id: 'push',      icon: 'send',     label: 'Push' },
    { id: 'stats',     icon: 'chart',    label: 'Stats' },
    { id: 'rapport',   icon: 'report',   label: 'Rapport' },
  ];
  const records = [
    { id: 'prospects',   icon: 'users',    label: 'Prospects',   count: 1247 },
    { id: 'entreprises', icon: 'building', label: 'Entreprises', count: 342  },
    { id: 'candidats',   icon: 'user',     label: 'Candidats',   count: 89   },
  ];
  const pinned = [
    { id: 'cap', label: 'Capgemini',    sub: '12 prospects' },
    { id: 'sfr', label: 'SFR Business', sub: '4 prospects'  },
  ];

  return (
    <aside style={{
      width: 232, flexShrink: 0,
      borderRight: '1px solid var(--border)',
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column',
      padding: '12px 8px', gap: 2,
    }}>
      <SidebarSection title="Navigate">
        {navItems.map(it => <SidebarItem key={it.id} {...it} active={active === it.id} />)}
      </SidebarSection>
      <SidebarSection title="Records">
        {records.map(it => <SidebarItem key={it.id} {...it} active={active === it.id} />)}
      </SidebarSection>
      <SidebarSection title="Épinglés">
        {pinned.map(p => (
          <div key={p.id} className="sb-item" style={sbItemStyle(false)}>
            <Icon name="bookmark" size={13} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }} className="truncate">{p.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }} className="truncate">{p.sub}</div>
            </div>
          </div>
        ))}
      </SidebarSection>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 4, padding: '8px 4px', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-ghost btn-sm btn-icon" title="Paramètres"><Icon name="cog" size={14}/></button>
        <ThemeToggle />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>v30.0</span>
      </div>
    </aside>
  );
}
function SidebarSection({ title, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 10.5, fontWeight: 500, color: 'var(--text-muted)',
        letterSpacing: 0.08, textTransform: 'uppercase',
        padding: '8px 10px 4px',
      }}>{title}</div>
      {children}
    </div>
  );
}
function sbItemStyle(active) {
  return {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px', borderRadius: 6,
    cursor: 'pointer',
    color: active ? 'var(--text)' : 'var(--text-2)',
    background: active ? 'var(--surface-2)' : 'transparent',
    fontSize: 13, fontWeight: active ? 500 : 400,
    position: 'relative',
  };
}
function SidebarItem({ icon, label, count, active }) {
  return (
    <div style={sbItemStyle(active)}>
      {active && <span style={{ position: 'absolute', left: -8, top: 6, bottom: 6, width: 2, background: 'var(--text)', borderRadius: 2 }} />}
      <Icon name={icon} size={14} />
      <span style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span style={{ fontSize: 11, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
          {count.toLocaleString('fr-FR')}
        </span>
      )}
    </div>
  );
}

// ─── Layout shell ───────────────────────────────────────────
function Shell({ crumbs, active, children, noPadding }) {
  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)' }}>
      <Topbar crumbs={crumbs} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar active={active} />
        <main style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
          <div style={{ padding: noPadding ? 0 : '20px 24px', maxWidth: 1440, margin: '0 auto' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Topbar, Sidebar, Shell });
