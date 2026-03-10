(function(){
  async function initGoalsSettings(){
    const btnSave = document.getElementById('btnSaveGoals');
    const btnReset = document.getElementById('btnResetGoals');
    const statusEl = document.getElementById('goalsSaveStatus');
    const hasUI = !!(btnSave && btnReset);
    if (!hasUI) return;

    const setStatus = (txt) => { if (statusEl) statusEl.textContent = txt || ''; };

    const safeInt = (v) => {
      const n = parseInt(String(v || '0'), 10);
      return Number.isFinite(n) ? n : 0;
    };

    const fields = {
      daily: {
        rdv: { t: 'goal_daily_rdv_target', xp: 'goal_daily_rdv_xp', label: 'Prendre 1 RDV Prosp' },
        push: { t: 'goal_daily_push_target', xp: 'goal_daily_push_xp', label: '3 push' },
        sourcing_contacted: { t: 'goal_daily_sourcing_contacted_target', xp: 'goal_daily_sourcing_contacted_xp', label: 'Sourcing : contacter 3 candidats qualifiés' },
      },
      weekly: {
        rdv: { t: 'goal_weekly_rdv_target', xp: 'goal_weekly_rdv_xp', label: 'Prendre 5 RDV Prosp' },
        push: { t: 'goal_weekly_push_target', xp: 'goal_weekly_push_xp', label: '15 push' },
        sourcing_contacted: { t: 'goal_weekly_sourcing_contacted_target', xp: 'goal_weekly_sourcing_contacted_xp', label: 'Sourcing : contacter 15 candidats qualifiés' },
        sourcing_solid: { t: 'goal_weekly_sourcing_solid_target', xp: 'goal_weekly_sourcing_solid_xp', label: 'Sourcing : 3 profils solides (EC1+)' },
      }
    };

    async function loadConfig(){
      try {
        const res = await fetch('/api/dashboard');
        const j = await res.json();
        const cfg = j && j.ok && j.data && j.data.goals && j.data.goals.config ? j.data.goals.config : null;
        if (!cfg) return;

        for (const scope of ['daily','weekly']) {
          for (const key of Object.keys(fields[scope])) {
            const meta = fields[scope][key];
            const obj = (cfg[scope] && cfg[scope][key]) ? cfg[scope][key] : {};
            const tEl = document.getElementById(meta.t);
            const xpEl = document.getElementById(meta.xp);
            if (tEl) tEl.value = safeInt(obj.target);
            if (xpEl) xpEl.value = safeInt(obj.xp);
          }
        }
      } catch (e) {
        console.warn('Goals settings load error:', e);
      }
    }

    function buildConfigFromUI(){
      const cfg = { daily: {}, weekly: {}, meta: { push_channels: 'any', xp_scale: 'linear' } };

      for (const scope of ['daily','weekly']) {
        for (const key of Object.keys(fields[scope])) {
          const meta = fields[scope][key];
          const tEl = document.getElementById(meta.t);
          const xpEl = document.getElementById(meta.xp);
          cfg[scope][key] = {
            label: meta.label,
            target: safeInt(tEl ? tEl.value : 0),
            xp: safeInt(xpEl ? xpEl.value : 0),
          };
        }
      }
      return cfg;
    }

    async function saveConfig(cfg){
      setStatus('Enregistrement…');
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { goals_config: JSON.stringify(cfg) } })
        });
        const j = await res.json();
        if (j && j.ok) {
          setStatus('✅ Enregistré');
          if (typeof showToast === 'function') showToast('✅ Objectifs sauvegardés', 'success');
        } else {
          setStatus('❌ Erreur');
          if (typeof showToast === 'function') showToast('❌ Erreur sauvegarde', 'error');
        }
      } catch (e) {
        setStatus('❌ Erreur réseau');
      }
      setTimeout(() => setStatus(''), 3000);
    }

    async function resetToDefault(){
      if (!confirm('Restaurer les objectifs par défaut ?')) return;
      setStatus('Restauration…');
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { goals_config: '' } })
        });
        const j = await res.json();
        if (j && j.ok) {
          if (typeof showToast === 'function') showToast('✅ Objectifs restaurés', 'success');
          await loadConfig();
          setStatus('✅ Par défaut');
        } else {
          setStatus('❌ Erreur');
        }
      } catch (e) {
        setStatus('❌ Erreur réseau');
      }
      setTimeout(() => setStatus(''), 3000);
    }

    btnSave.addEventListener('click', async () => {
      await saveConfig(buildConfigFromUI());
    });
    btnReset.addEventListener('click', resetToDefault);

    await loadConfig();
  }

  function displayPrefToBool(val) {
    if (val === undefined || val === null) return true;
    const s = String(val).toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }

  function syncDisplayPrefsToStorage(settings) {
    document.querySelectorAll('.display-pref-checkbox').forEach(function (el) {
      const k = el.id;
      if (!k) return;
      const v = settings && settings[k];
      try {
        localStorage.setItem(k, displayPrefToBool(v) ? '1' : '0');
      } catch (e) {}
    });
  }

  async function initDisplayPrefs() {
    const checkboxes = document.querySelectorAll('.display-pref-checkbox');
    if (!checkboxes.length) return;

    try {
      const res = await fetch('/api/settings');
      const j = await res.json();
      const s = (j && j.ok && j.settings) ? j.settings : {};
      checkboxes.forEach(function (el) {
        const k = el.id;
        if (k) el.checked = displayPrefToBool(s[k]);
      });
      syncDisplayPrefsToStorage(s);
    } catch (e) {
      checkboxes.forEach(function (el) {
        const k = el.id;
        if (k) {
          try { el.checked = displayPrefToBool(localStorage.getItem(k)); } catch (e2) {}
        }
      });
    }

    function saveDisplayPref(key, on) {
      const val = on ? '1' : '0';
      try { localStorage.setItem(key, val); } catch (e) {}
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [key]: val } })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok && typeof showToast === 'function') showToast('Préférence enregistrée', 'success', 2000);
      }).catch(function () {});
      if (typeof window.applyDisplayPrefs === 'function') window.applyDisplayPrefs();
      if (typeof window.applyDashboardDisplayPrefs === 'function') window.applyDashboardDisplayPrefs();
    }

    checkboxes.forEach(function (el) {
      const k = el.id;
      if (k) el.addEventListener('change', function () { saveDisplayPref(k, el.checked); });
    });
  }

  function initNotificationsSettings() {
    var api = window.Prosp'UpNotifications;
    if (!api) return;
    var enabledEl = document.getElementById('notifEnabled');
    var hourEl = document.getElementById('notifHour');
    var btnSave = document.getElementById('btnNotifSave');
    var statusEl = document.getElementById('notifStatus');
    if (!enabledEl || !hourEl || !btnSave) return;

    var prefs = api.getPrefs();
    enabledEl.checked = prefs.enabled;
    hourEl.value = String(prefs.hour);

    btnSave.addEventListener('click', function () {
      var enabled = enabledEl.checked;
      var hour = parseInt(hourEl.value, 10);
      if (Number.isNaN(hour)) hour = 9;
      if (enabled) {
        api.requestPermission(function (perm) {
          if (perm === 'denied') {
            if (statusEl) statusEl.textContent = 'Autorisation refusée. Autorisez les notifications dans les paramètres du navigateur.';
            if (typeof showToast === 'function') showToast('Notifications refusées par le navigateur', 'warning');
            return;
          }
          if (perm === 'unsupported') {
            if (statusEl) statusEl.textContent = 'Notifications non supportées par ce navigateur.';
            return;
          }
          api.setPrefs({ enabled: true, hour: hour });
          if (statusEl) statusEl.textContent = '✅ Rappels activés (à ' + hour + 'h).';
          if (typeof showToast === 'function') showToast('Rappels enregistrés', 'success');
        });
      } else {
        api.setPrefs({ enabled: false, hour: hour });
        if (statusEl) statusEl.textContent = 'Rappels désactivés.';
        if (typeof showToast === 'function') showToast('Rappels désactivés', 'info');
      }
      setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 3000);
    });
  }

  async function run(){
    const fn = window.bootstrap || window.appBootstrap;
    if (typeof fn !== 'function') {
      console.error('[ProspectionApp] bootstrap() introuvable. Vérifiez que /static/js/app.js est bien chargé (Ctrl+F5).');
      return;
    }
    await fn('settings');
    await initGoalsSettings();
    await initDisplayPrefs();
    initNotificationsSettings();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

// ═══════════════════════════════════════════════════════════════
// LinkedIn InMail Template Settings (v16.5)
// ═══════════════════════════════════════════════════════════════
const DEFAULT_LINKEDIN_TEMPLATE = `Bonjour {civilite} {nom},

Je me permets de vous contacter concernant {entreprise}.

Belle journée,`;

async function loadLinkedinTemplate() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        const tpl = data?.settings?.linkedin_inmail_template || '';
        const textarea = document.getElementById('linkedinInmailTemplate');
        if (textarea) textarea.value = tpl || DEFAULT_LINKEDIN_TEMPLATE;
    } catch(e) {}
}

async function saveLinkedinTemplate() {
    const textarea = document.getElementById('linkedinInmailTemplate');
    const status = document.getElementById('linkedinTemplateStatus');
    if (!textarea) return;
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: { linkedin_inmail_template: textarea.value } })
        });
        const data = await res.json();
        if (data.ok) {
            if (status) status.textContent = '✅ Template sauvegardé';
            if (typeof showToast === 'function') showToast('✅ Template LinkedIn sauvegardé', 'success');
        } else {
            if (status) status.textContent = '❌ Erreur';
        }
    } catch(e) {
        if (status) status.textContent = '❌ Erreur réseau';
    }
    setTimeout(() => { if (status) status.textContent = ''; }, 3000);
}

function resetLinkedinTemplate() {
    const textarea = document.getElementById('linkedinInmailTemplate');
    if (textarea) textarea.value = DEFAULT_LINKEDIN_TEMPLATE;
}

// Auto-load on page init
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadLinkedinTemplate, 500);
});
