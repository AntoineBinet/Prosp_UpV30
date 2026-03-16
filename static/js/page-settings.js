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
    var api = window.ProspUpNotifications;
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

// ════════════════════════════════════════════════════════════════
// Vérification système
// ════════════════════════════════════════════════════════════════
async function runSystemVerify() {
    const btn = document.getElementById('btnSystemVerify');
    const resultsEl = document.getElementById('systemVerifyResults');
    if (!btn || !resultsEl) return;
    
    // Désactiver le bouton pendant la vérification
    btn.disabled = true;
    btn.textContent = '⏳ Vérification en cours...';
    resultsEl.style.display = 'none';
    
    try {
        const res = await fetch('/api/system/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        
        if (!res.ok) {
            resultsEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur: ${data.error || 'Erreur inconnue'}</div>`;
            resultsEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = '🔍 Lancer la vérification';
            return;
        }
        
        // Afficher les résultats
        const checks = data.checks || {};
        const checkLabels = {
            git: 'Git (repo, branche, pull)',
            ollama: 'Ollama (répond + génération)',
            flask: 'Flask (serveur web)',
            api_ollama: 'API Ollama via Flask',
            scripts: 'Scripts Python',
            env: 'Variables d\'environnement',
        };
        
        let html = '<div style="display:grid;gap:12px;">';
        html += '<h4 style="margin:0 0 12px 0;font-size:15px;font-weight:600;">Résultats de la vérification</h4>';
        
        let allOk = true;
        for (const [key, label] of Object.entries(checkLabels)) {
            const check = checks[key] || { ok: false, message: 'Non vérifié' };
            const icon = check.ok ? '✅' : '❌';
            const color = check.ok ? '#22c55e' : '#ef4444';
            allOk = allOk && check.ok;
            
            html += `<div style="display:flex;align-items:start;gap:10px;padding:10px;border-radius:8px;background:var(--color-surface);border:1px solid ${check.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'};">`;
            html += `<span style="font-size:18px;">${icon}</span>`;
            html += `<div style="flex:1;">`;
            html += `<div style="font-weight:600;margin-bottom:4px;color:${color};">${label}</div>`;
            html += `<div style="font-size:12px;color:var(--color-text-secondary);">${check.message || 'OK'}</div>`;
            html += `</div></div>`;
        }
        
        // Résumé global
        html += '<div style="margin-top:12px;padding:12px;border-radius:8px;background:' + (allOk ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)') + ';border:1px solid ' + (allOk ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)') + ';">';
        html += '<div style="font-weight:600;color:' + (allOk ? '#22c55e' : '#ef4444') + ';">';
        html += allOk ? '✅ Tous les systèmes fonctionnent correctement' : '❌ Certains systèmes nécessitent une attention';
        html += '</div>';
        if (data.exit_code !== undefined) {
            html += `<div style="font-size:12px;color:var(--color-text-secondary);margin-top:4px;">Code de sortie: ${data.exit_code}</div>`;
        }
        html += '</div>';
        
        // Afficher stdout/stderr si disponible et non vide
        if (data.stdout && data.stdout.trim()) {
            html += '<details style="margin-top:12px;"><summary style="cursor:pointer;font-size:12px;color:var(--color-text-secondary);">📋 Sortie standard</summary>';
            html += `<pre style="margin-top:8px;padding:8px;background:var(--color-surface);border-radius:6px;font-size:11px;overflow-x:auto;max-height:200px;overflow-y:auto;">${escapeHtml(data.stdout)}</pre>`;
            html += '</details>';
        }
        if (data.stderr && data.stderr.trim()) {
            html += '<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:12px;color:var(--color-text-secondary);">⚠️ Erreurs</summary>';
            html += `<pre style="margin-top:8px;padding:8px;background:rgba(239,68,68,.1);border-radius:6px;font-size:11px;overflow-x:auto;max-height:200px;overflow-y:auto;color:#ef4444;">${escapeHtml(data.stderr)}</pre>`;
            html += '</details>';
        }
        
        html += '</div>';
        resultsEl.innerHTML = html;
        resultsEl.style.display = 'block';
        
        // Toast de confirmation
        if (typeof showToast === 'function') {
            showToast(allOk ? '✅ Vérification terminée — tout fonctionne' : '⚠️ Vérification terminée — voir les détails', allOk ? 'success' : 'warning');
        }
    } catch (e) {
        resultsEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur réseau: ${e.message}</div>`;
        resultsEl.style.display = 'block';
        if (typeof showToast === 'function') {
            showToast('Erreur lors de la vérification', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Lancer la vérification';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

window.runSystemVerify = runSystemVerify;

// ════════════════════════════════════════════════════════════════
// Afficher les logs serveur
// ════════════════════════════════════════════════════════════════
async function showSystemLogs() {
    const btn = document.getElementById('btnSystemLogs');
    const resultsEl = document.getElementById('systemVerifyResults');
    if (!btn || !resultsEl) return;
    
    btn.disabled = true;
    btn.textContent = '⏳ Chargement...';
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--color-text-secondary);">⏳ Chargement des logs...</div>';
    
    try {
        const lines = 100; // Nombre de lignes à afficher
        const res = await fetch(`/api/system/logs?lines=${lines}`, {
            method: 'GET',
        });
        const data = await res.json();
        
        if (!res.ok) {
            resultsEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur: ${data.error || 'Erreur inconnue'}</div>`;
            btn.disabled = false;
            btn.textContent = '📋 Voir les logs serveur';
            return;
        }
        
        let html = '<div style="display:grid;gap:12px;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        html += '<h4 style="margin:0;font-size:15px;font-weight:600;">📋 Logs serveur (dernières ' + data.lines.length + ' lignes)</h4>';
        html += '<div style="font-size:12px;color:var(--color-text-secondary);">Total: ' + data.total_lines + ' lignes • Taille: ' + Math.round(data.file_size / 1024) + ' KB</div>';
        html += '</div>';
        html += '<div style="max-height:500px;overflow-y:auto;padding:12px;background:#1e293b;border-radius:8px;font-family:monospace;font-size:11px;line-height:1.5;">';
        
        // Afficher les lignes (les plus récentes en bas)
        data.lines.forEach(line => {
            const trimmed = (line || '').trim();
            if (!trimmed) return;
            
            let color = '#cbd5e1'; // Couleur par défaut
            if (trimmed.includes('ERROR') || trimmed.includes('CRITICAL')) {
                color = '#ef4444';
            } else if (trimmed.includes('WARNING') || trimmed.includes('WARN')) {
                color = '#f59e0b';
            } else if (trimmed.includes('INFO')) {
                color = '#3b82f6';
            }
            
            html += `<div style="color:${color};margin-bottom:2px;">${escapeHtml(trimmed)}</div>`;
        });
        
        html += '</div>';
        html += '<div style="font-size:11px;color:var(--color-text-secondary);margin-top:8px;">💡 Les logs sont mis à jour en temps réel. Rechargez pour voir les dernières entrées.</div>';
        html += '</div>';
        
        resultsEl.innerHTML = html;
        
        if (typeof showToast === 'function') {
            showToast('✅ Logs chargés', 'success');
        }
    } catch (e) {
        resultsEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur réseau: ${e.message}</div>`;
        if (typeof showToast === 'function') {
            showToast('Erreur lors du chargement des logs', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = '📋 Voir les logs serveur';
    }
}

// ════════════════════════════════════════════════════════════════
// Vérifier le déploiement
// ════════════════════════════════════════════════════════════════
async function checkDeployment() {
    const btn = document.getElementById('btnCheckDeployment');
    const resultsEl = document.getElementById('systemVerifyResults');
    if (!btn || !resultsEl) return;
    
    btn.disabled = true;
    btn.textContent = '⏳ Vérification...';
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--color-text-secondary);">⏳ Vérification du déploiement...</div>';
    
    try {
        const res = await fetch('/api/system/check-deployment', {
            method: 'GET',
        });
        const data = await res.json();
        
        if (!res.ok) {
            resultsEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur: ${data.error || 'Erreur inconnue'}</div>`;
            btn.disabled = false;
            btn.textContent = '🔎 Vérifier le déploiement';
            return;
        }
        
        let html = '<div style="display:grid;gap:12px;">';
        html += '<h4 style="margin:0 0 12px 0;font-size:15px;font-weight:600;">🔎 État du déploiement</h4>';
        
        const checks = [
            { key: 'verify_script_exists', label: 'Script de vérification (verify_all.py)', icon: '🐍' },
            { key: 'html_section_exists', label: 'Section HTML (parametres.html)', icon: '📄' },
            { key: 'js_function_exists', label: 'Fonction JavaScript (page-settings.js)', icon: '⚙️' },
        ];
        
        let allOk = true;
        for (const check of checks) {
            const ok = data[check.key] || false;
            allOk = allOk && ok;
            const icon = ok ? '✅' : '❌';
            const color = ok ? '#22c55e' : '#ef4444';
            
            html += `<div style="display:flex;align-items:start;gap:10px;padding:10px;border-radius:8px;background:var(--color-surface);border:1px solid ${ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'};">`;
            html += `<span style="font-size:18px;">${icon}</span>`;
            html += `<div style="flex:1;">`;
            html += `<div style="font-weight:600;margin-bottom:4px;color:${color};">${check.icon} ${check.label}</div>`;
            html += `<div style="font-size:12px;color:var(--color-text-secondary);">${ok ? 'Présent' : 'Manquant'}</div>`;
            html += `</div></div>`;
        }
        
        // Version en ligne et dernier commit (pour confirmer la mise à jour appliquée)
        if (data.version || data.commit_hash || data.branch) {
            html += '<div style="padding:10px;border-radius:8px;background:var(--color-surface);border:1px solid var(--color-border);">';
            html += '<div style="font-weight:600;margin-bottom:4px;">Version en ligne</div>';
            html += '<div style="font-size:12px;color:var(--color-text-secondary);">';
            html += 'v' + (data.version || '?') + ' · ' + (data.branch || 'main') + ' · ' + (data.commit_hash !== 'unknown' ? data.commit_hash : '?');
            if (data.last_commit && data.last_commit !== 'unknown') {
                html += '<br><span style="font-family:monospace;">' + escapeHtml(data.last_commit) + '</span>';
            }
            html += '</div></div>';
        } else if (data.last_commit && data.last_commit !== 'unknown') {
            html += '<div style="padding:10px;border-radius:8px;background:var(--color-surface);border:1px solid var(--color-border);">';
            html += '<div style="font-weight:600;margin-bottom:4px;">Dernier commit Git</div>';
            html += '<div style="font-size:12px;color:var(--color-text-secondary);font-family:monospace;">' + escapeHtml(data.last_commit) + '</div>';
            html += '</div>';
        }
        
        // Résumé - amélioration : ne pas signaler d'erreur si git fetch montre "Déjà à jour"
        // Vérifier si on peut comparer avec origin/main pour éviter les faux positifs
        const isUpToDate = allOk && data.all_deployed;
        html += '<div style="margin-top:12px;padding:12px;border-radius:8px;background:' + (isUpToDate ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)') + ';border:1px solid ' + (isUpToDate ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)') + ';">';
        html += '<div style="font-weight:600;color:' + (isUpToDate ? '#22c55e' : '#ef4444') + ';">';
        html += isUpToDate ? '✅ Code déployé correctement' : '❌ Code non déployé ou incomplet';
        html += '</div>';
        if (!isUpToDate) {
            html += '<div style="font-size:12px;color:var(--color-text-secondary);margin-top:6px;">';
            html += 'Si le bouton "Mettre à jour" indique "Déjà à jour", cette erreur peut être un faux positif. ';
            html += 'Vérifiez que les fichiers sont bien présents sur le serveur.';
            html += '</div>';
        }
        html += '</div>';
        
        html += '</div>';
        resultsEl.innerHTML = html;
        
        if (typeof showToast === 'function') {
            showToast((allOk && data.all_deployed) ? '✅ Code déployé' : '⚠️ Code non déployé', (allOk && data.all_deployed) ? 'success' : 'warning');
        }
    } catch (e) {
        resultsEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur réseau: ${e.message}</div>`;
        if (typeof showToast === 'function') {
            showToast('Erreur lors de la vérification', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = '🔎 Vérifier le déploiement';
    }
}

window.showSystemLogs = showSystemLogs;
window.checkDeployment = checkDeployment;

// ════════════════════════════════════════════════════════════════
// Redémarrer le serveur
// ════════════════════════════════════════════════════════════════
async function restartServer() {
    const btn = document.getElementById('btnRestartServer');
    const statusEl = document.getElementById('restartServerStatus');
    if (!btn || !statusEl) return;
    
    // Demander confirmation
    if (!confirm('⚠️ Êtes-vous sûr de vouloir redémarrer le serveur ?\n\nL\'application sera temporairement indisponible pendant quelques secondes.')) {
        return;
    }
    
    btn.disabled = true;
    btn.textContent = '⏳ Redémarrage en cours...';
    statusEl.style.display = 'block';
    statusEl.style.background = 'var(--color-surface-2)';
    statusEl.style.border = '1px solid var(--color-border)';
    statusEl.innerHTML = '<div style="color:var(--color-text-secondary);">⏳ Redémarrage du serveur en cours... Veuillez patienter.</div>';
    
    try {
        const res = await fetch('/api/deploy/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        
        if (!res.ok) {
            statusEl.style.background = 'rgba(239,68,68,.08)';
            statusEl.style.border = '1px solid rgba(239,68,68,.3)';
            statusEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur: ${data.error || 'Erreur inconnue'}</div>`;
            btn.disabled = false;
            btn.textContent = '🔄 Redémarrer le serveur';
            if (typeof showToast === 'function') {
                showToast('Erreur lors du redémarrage', 'error');
            }
            return;
        }
        
        // Afficher le message de succès
        statusEl.style.background = 'rgba(34,197,94,.08)';
        statusEl.style.border = '1px solid rgba(34,197,94,.3)';
        statusEl.innerHTML = '<div style="color:#22c55e;font-weight:600;">✅ Redémarrage programmé</div><div style="margin-top:8px;font-size:12px;color:var(--color-text-secondary);">Le serveur va redémarrer dans 5 secondes. La page va se recharger automatiquement...</div>';
        
        if (typeof showToast === 'function') {
            showToast('Redémarrage programmé — rechargement dans 5 secondes', 'success');
        }
        
        // Recharger la page après 6 secondes pour laisser le temps au serveur de redémarrer
        setTimeout(() => {
            window.location.reload();
        }, 6000);
        
    } catch (e) {
        statusEl.style.background = 'rgba(239,68,68,.08)';
        statusEl.style.border = '1px solid rgba(239,68,68,.3)';
        statusEl.innerHTML = `<div style="color:#ef4444;font-weight:600;">❌ Erreur réseau: ${e.message}</div>`;
        btn.disabled = false;
        btn.textContent = '🔄 Redémarrer le serveur';
        if (typeof showToast === 'function') {
            showToast('Erreur réseau lors du redémarrage', 'error');
        }
    }
}

window.restartServer = restartServer;

// ════════════════════════════════════════════════════════════════
// Déclencher le pull et redémarrage (flux SSE en direct)
// ════════════════════════════════════════════════════════════════
async function triggerDeployPull() {
    const btn = document.getElementById('btnDeployPull');
    const statusEl = document.getElementById('deployPullStatus');
    const resultsEl = document.getElementById('deployPullResults');
    const logEl = document.getElementById('deployPullLog');
    const summaryEl = document.getElementById('deployPullSummary');
    if (!btn || !resultsEl) return;
    const hasLogPre = !!logEl;
    
    if (!confirm('Êtes-vous sûr de vouloir mettre à jour le serveur ?\n\n1. Récupération des modifications depuis Git (origin/main)\n2. Redémarrage automatique du serveur\n\nLe site sera indisponible environ 10-15 secondes.')) {
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Mise à jour en cours...';
    if (statusEl) statusEl.textContent = '';
    resultsEl.style.display = 'block';
    if (hasLogPre && logEl) {
        logEl.textContent = '';
        logEl.style.display = 'block';
    }
    if (summaryEl) summaryEl.innerHTML = '';
    if (!hasLogPre) {
        resultsEl.innerHTML = '<pre id="deployPullLog" style="margin:0;font-size:12px;font-family:monospace;white-space:pre-wrap;word-break:break-all;"></pre><div id="deployPullSummary" style="margin-top:10px;"></div>';
    }
    const logPre = document.getElementById('deployPullLog');
    const summaryDiv = document.getElementById('deployPullSummary');
    
    function appendLog(line) {
        if (logPre) {
            logPre.textContent += line + '\n';
            logPre.scrollTop = logPre.scrollHeight;
        }
    }
    
    let finalData = null;
    try {
        const res = await fetch('/api/deploy/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        if (!res.ok || !res.body) {
            const errText = await res.text();
            let errObj = {};
            try { errObj = JSON.parse(errText); } catch (_) {}
            finalData = { step: 'error', error: errObj.error || errText || 'Erreur ' + res.status };
            appendLog('Erreur HTTP ' + res.status + ': ' + (finalData.error || ''));
        } else {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';
                for (const part of parts) {
                    const line = part.trim();
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.step === 'log' && data.line) {
                            appendLog(data.line);
                        } else if (data.step === 'fetch' && data.message) {
                            appendLog(data.message);
                        } else if (data.step === 'pull' && data.message) {
                            appendLog(data.message);
                        } else if (data.step === 'error') {
                            appendLog('Erreur: ' + (data.error || ''));
                            finalData = data;
                            break;
                        } else if (data.step === 'done') {
                            finalData = data;
                        }
                    } catch (_) {}
                }
                if (finalData && (finalData.step === 'error' || finalData.step === 'done')) break;
            }
            if (buffer.trim()) {
                const line = buffer.trim();
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.step === 'done') finalData = data;
                        if (data.step === 'error') finalData = data;
                    } catch (_) {}
                }
            }
        }
        
        if (finalData && finalData.step === 'error') {
            if (summaryDiv) summaryDiv.innerHTML = '<div style="color:#ef4444;font-weight:600;">Erreur: ' + (typeof escapeHtml === 'function' ? escapeHtml(finalData.error) : finalData.error) + '</div>';
            if (statusEl) { statusEl.textContent = 'Échec'; statusEl.style.color = '#ef4444'; }
            btn.disabled = false;
            btn.textContent = 'Mettre à jour et redémarrer';
            if (typeof showToast === 'function') showToast('Erreur lors de la mise à jour', 'error');
            return;
        }
        
        if (finalData && finalData.step === 'done') {
            if (finalData.updated && finalData.restarting) {
                if (summaryDiv) summaryDiv.innerHTML = '<div style="padding:10px;border-radius:8px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:#22c55e;font-weight:600;">Mise à jour appliquée. Redémarrage dans ' + (finalData.restart_delay_s || 10) + ' s… Rechargement automatique de la page.</div>';
                if (statusEl) { statusEl.textContent = 'Redémarrage…'; statusEl.style.color = '#22c55e'; }
                if (typeof showToast === 'function') showToast('Mise à jour appliquée, redémarrage en cours', 'success');
                setTimeout(function() { window.location.reload(); }, 12000);
            } else if (finalData.updated) {
                if (summaryDiv) summaryDiv.innerHTML = '<div style="color:#22c55e;font-weight:600;">Mise à jour appliquée.</div>';
                if (statusEl) { statusEl.textContent = 'OK'; statusEl.style.color = '#22c55e'; }
                btn.disabled = false;
                btn.textContent = 'Mettre à jour et redémarrer';
            } else {
                if (summaryDiv) summaryDiv.innerHTML = '<div style="color:#64748b;">Déjà à jour. ' + (finalData.local_hash ? 'Commit: ' + finalData.local_hash : '') + '</div>';
                if (statusEl) { statusEl.textContent = 'Déjà à jour'; statusEl.style.color = '#64748b'; }
                btn.disabled = false;
                btn.textContent = 'Mettre à jour et redémarrer';
                if (typeof showToast === 'function') showToast('Serveur déjà à jour', 'info');
            }
        } else {
            if (summaryDiv) summaryDiv.innerHTML = '<div style="color:#ef4444;">Réponse inattendue.</div>';
            btn.disabled = false;
            btn.textContent = 'Mettre à jour et redémarrer';
        }
    } catch (e) {
        appendLog('Erreur réseau: ' + e.message);
        if (summaryDiv) summaryDiv.innerHTML = '<div style="color:#ef4444;font-weight:600;">Erreur réseau: ' + (typeof escapeHtml === 'function' ? escapeHtml(e.message) : e.message) + '</div>';
        btn.disabled = false;
        btn.textContent = 'Mettre à jour et redémarrer';
        if (statusEl) { statusEl.textContent = 'Erreur'; statusEl.style.color = '#ef4444'; }
        if (typeof showToast === 'function') showToast('Erreur réseau', 'error');
    }
}

window.triggerDeployPull = triggerDeployPull;
