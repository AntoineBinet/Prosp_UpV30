/* ProspUp v30 — Push : fetch templates + historique, rendu, tabs */
(function () {
  'use strict';

  var STATE = { templates: [], pushLogs: [], prospects: {} };

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function parseTags(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    try { return JSON.parse(raw) || []; }
    catch (_) { return String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ─── Tabs ────────────────────────────────────────────────
  function bindTabs() {
    var host = document.querySelector('[data-v30-push-tabs]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      host.querySelectorAll('button[data-tab]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-push-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30PushPanel !== key);
      });
      // Lazy-load selon tab
      if (key === 'templates' && STATE.templates.length === 0) loadTemplates();
      if (key === 'historique' && STATE.pushLogs.length === 0) loadHistory();
    });
  }

  // ─── Templates ───────────────────────────────────────────
  function renderTemplates() {
    var host = document.querySelector('[data-v30-tpl-grid]');
    if (!host) return;
    if (!STATE.templates.length) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px;">Aucun template pour le moment.</div>' + newTplCard();
      return;
    }
    host.innerHTML = STATE.templates.map(function (t) {
      var tags = parseTags(t.tags);
      var used = t.used_count != null ? t.used_count : (t.uses != null ? t.uses : 0);
      var open = t.open_rate != null ? t.open_rate : null;
      var body = (t.body || t.content || t.template || '').slice(0, 180);
      var tagsHtml = tags.slice(0, 3).map(function (x) { return '<span class="badge">' + esc(x) + '</span>'; }).join(' ');
      return '<div class="card v30-tpl-card">' +
        '<div class="row-sb">' +
          '<div style="font-size:13px;font-weight:600;">' + esc(t.name || t.title || 'Template') + '</div>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Plus">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>' +
          '</button>' +
        '</div>' +
        (tagsHtml ? '<div style="display:flex;gap:4px;flex-wrap:wrap;">' + tagsHtml + '</div>' : '') +
        '<div class="v30-tpl-card__body">' + esc(body) + (body.length >= 180 ? '…' : '') + '</div>' +
        '<div class="v30-tpl-card__meta">' +
          '<span>Utilisé <b style="color:var(--text);" class="num">' + used + '×</b></span>' +
          (open != null ? '<span>Ouverture <b style="color:var(--success);" class="num">' + open + '%</b></span>' : '') +
        '</div>' +
      '</div>';
    }).join('') + newTplCard();
  }
  function newTplCard() {
    return '<div class="card v30-tpl-card v30-tpl-card__new" data-v30-new-template role="button" tabindex="0">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
      '<span style="font-size:12px;">Nouveau template</span>' +
    '</div>';
  }

  function loadTemplates() {
    return fetchJSON('/api/templates').then(function (res) {
      STATE.templates = (res && (res.templates || res.items || res.data || [])) || [];
      if (!Array.isArray(STATE.templates) && typeof STATE.templates === 'object') {
        // Certains endpoints retournent un dict
        STATE.templates = Object.keys(STATE.templates).map(function (k) {
          var v = STATE.templates[k]; v.name = v.name || k; return v;
        });
      }
      renderTemplates();
    }).catch(function (err) {
      console.error('[v30 push] /api/templates failed:', err);
      var host = document.querySelector('[data-v30-tpl-grid]');
      if (host) host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:40px;">Erreur de chargement des templates.</div>' + newTplCard();
    });
  }

  // ─── Historique (push_logs) ──────────────────────────────
  function fmtDayHeader(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var today = new Date(); today.setHours(0,0,0,0);
      var dCopy = new Date(d.getTime()); dCopy.setHours(0,0,0,0);
      var diffJ = Math.round((today.getTime() - dCopy.getTime()) / 86400000);
      var label = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][d.getDay()] +
        ' · ' + d.getDate() + ' ' +
        ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'][d.getMonth()];
      if (diffJ === 0) return "Aujourd'hui · " + label.split(' · ')[1];
      if (diffJ === 1) return "Hier · " + label.split(' · ')[1];
      return label;
    } catch (_) { return iso; }
  }
  function timeHHmm(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (_) { return ''; }
  }

  function renderHistory() {
    var host = document.querySelector('[data-v30-hist]');
    if (!host) return;
    if (!STATE.pushLogs.length) {
      host.innerHTML = '<div class="empty" style="padding:40px;">Aucun push envoyé pour le moment.</div>';
      return;
    }
    // Groupe par jour (date ISO YYYY-MM-DD)
    var sorted = STATE.pushLogs.slice().sort(function (a, b) {
      return String(b.sentAt || b.createdAt || '').localeCompare(String(a.sentAt || a.createdAt || ''));
    });
    var groups = {};
    sorted.forEach(function (pl) {
      var iso = (pl.sentAt || pl.createdAt || '').slice(0, 10);
      if (!iso) return;
      if (!groups[iso]) groups[iso] = [];
      groups[iso].push(pl);
    });
    var isoDays = Object.keys(groups).sort().reverse().slice(0, 10); // 10 derniers jours
    var STATE_CLS = { 'envoyé': 'badge', 'ouvert': 'badge-info', 'répondu': 'badge-success' };

    host.innerHTML = isoDays.map(function (iso) {
      var items = groups[iso];
      return '<div class="v30-hist-day">' + esc(fmtDayHeader(iso)) + '</div>' +
        items.slice(0, 40).map(function (pl) {
          var p = STATE.prospects[pl.prospect_id] || {};
          var name = p.name || '—';
          var co = p.company_groupe || '';
          var chan = (pl.channel || '').toLowerCase();
          var chanLabel = chan === 'linkedin' ? 'linkedin' : 'mail';
          var state = pl.openedAt ? (pl.repliedAt ? 'répondu' : 'ouvert') : 'envoyé';
          var stateCls = STATE_CLS[state] || 'badge';
          return '<div class="v30-hist-row">' +
            '<span class="v30-hist-row__time mono">' + esc(timeHHmm(pl.sentAt || pl.createdAt)) + '</span>' +
            '<span class="avatar">' + esc(initials(name)) + '</span>' +
            '<div>' +
              '<div class="v30-hist-row__name">' + esc(name) +
                (co ? ' <span class="muted">· ' + esc(co) + '</span>' : '') +
              '</div>' +
              '<div class="v30-hist-row__subject truncate">' + esc(pl.subject || '—') + '</div>' +
            '</div>' +
            '<span class="badge" style="text-transform:lowercase;">' + esc(chanLabel) + '</span>' +
            '<span class="badge ' + stateCls + '">' + esc(state) + '</span>' +
          '</div>';
        }).join('');
    }).join('');
  }

  function loadHistory() {
    return fetchJSON('/api/data').then(function (res) {
      var pushLogs = (res && res.pushLogs) || [];
      if (pushLogs.length === 0) {
        // fallback : certains endpoints retournent push_logs inline au niveau prospect
        (res.prospects || []).forEach(function (p) {
          (p.pushLogs || []).forEach(function (pl) {
            pl.prospect_id = pl.prospect_id || p.id;
            pushLogs.push(pl);
          });
        });
      }
      STATE.pushLogs = pushLogs;
      // Build prospect lookup
      STATE.prospects = {};
      ((res && res.companies) || []).forEach(function (c) {
        /* seeds uniquement company lookup */
      });
      var companyById = {};
      ((res && res.companies) || []).forEach(function (c) { companyById[c.id] = c; });
      ((res && res.prospects) || []).forEach(function (p) {
        var co = companyById[p.company_id];
        STATE.prospects[p.id] = { name: p.name, company_groupe: co ? co.groupe : '' };
      });
      renderHistory();
    }).catch(function (err) {
      console.error('[v30 push] /api/data failed:', err);
      var host = document.querySelector('[data-v30-hist]');
      if (host) host.innerHTML = '<div class="empty" style="padding:40px;">Erreur de chargement.</div>';
    });
  }

  // ─── Nouvelle campagne ───────────────────────────────────
  function bindNewCampaign() {
    var btn = document.querySelector('[data-v30-new-campaign]');
    if (btn) btn.addEventListener('click', function () {
      // Redirige vers la page Push legacy pour le flux de création actuel
      window.location.href = '/push';
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindTabs();
    bindNewCampaign();
    // Premier panel actif = Campagnes : on charge en lazy via tab switch.
    // Précharge quand même l'historique pour que le badge Templates se peuple rapidement sur clic
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
