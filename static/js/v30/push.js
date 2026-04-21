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

  // ─── Campagnes (liste) ───────────────────────────────────
  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) +
             ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    } catch (_) { return iso; }
  }

  function renderCampaigns() {
    var host = document.querySelector('[data-v30-camp-grid]');
    if (!host) return;
    if (!STATE.campaigns || STATE.campaigns.length === 0) {
      host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:28px;">' +
        'Aucune campagne. Clique sur <b>Nouvelle campagne</b> pour commencer.</div>';
      return;
    }
    host.innerHTML = STATE.campaigns.map(function (c) {
      var sent = c.sent_at ? true : false;
      var stats = c.stats || {};
      var recipients = stats.recipients != null ? stats.recipients : '—';
      return '<div class="v30-camp-card" data-campaign-id="' + c.id + '">' +
        '<div class="row-sb"><div class="v30-camp-card__name">' + esc(c.name) + '</div>' +
          '<span class="v30-camp-card__badge' + (sent ? ' is-sent' : '') + '">' +
          (sent ? 'Envoyée' : 'Brouillon') + '</span></div>' +
        '<div class="v30-camp-card__meta">' +
          '<span>Créée ' + esc(fmtDate(c.created_at)) + '</span>' +
          (c.sent_at ? '<span>· envoyée ' + esc(fmtDate(c.sent_at)) + '</span>' : '') +
        '</div>' +
        '<div class="v30-camp-card__stats">' +
          '<span>Audience : <b>' + recipients + '</b></span>' +
          (stats.sent != null ? '<span>Envoyés : <b>' + stats.sent + '</b></span>' : '') +
        '</div>' +
        (sent ? '' : '<div class="v30-camp-card__actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-camp-delete="' + c.id + '">Supprimer</button>' +
        '</div>') +
      '</div>';
    }).join('');
    // Binder delete
    host.querySelectorAll('[data-camp-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.campDelete;
        if (!confirm('Supprimer cette campagne ?')) return;
        fetch('/api/push-campaigns/' + id, { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(loadCampaigns);
      });
    });
  }

  function loadCampaigns() {
    return fetchJSON('/api/push-campaigns').then(function (rows) {
      STATE.campaigns = Array.isArray(rows) ? rows : [];
      renderCampaigns();
    }).catch(function (err) {
      console.error('[v30 push] /api/push-campaigns failed:', err);
      var host = document.querySelector('[data-v30-camp-grid]');
      if (host) host.innerHTML = '<div class="empty" style="grid-column:1/-1;padding:28px;">Erreur.</div>';
    });
  }

  // ─── Wizard (3 étapes) ───────────────────────────────────
  var WIZ = { step: 1, campaign: null };

  function wizEl(sel) { return document.querySelector(sel); }
  function wizShowStep(n) {
    WIZ.step = n;
    document.querySelectorAll('[data-wiz-panel]').forEach(function (p) {
      p.hidden = (parseInt(p.dataset.wizPanel, 10) !== n);
    });
    document.querySelectorAll('[data-wiz-step]').forEach(function (s) {
      s.classList.toggle('is-active', parseInt(s.dataset.wizStep, 10) === n);
    });
    wizEl('[data-v30-wiz-title]').textContent = 'Étape ' + n + ' · ' +
      (n === 1 ? 'Cible' : n === 2 ? 'Message' : 'Envoi');
    wizEl('[data-v30-wiz-prev]').hidden = (n === 1);
    wizEl('[data-v30-wiz-next]').hidden = (n === 3);
    wizEl('[data-v30-wiz-send]').hidden = (n !== 3);
    if (n === 2) wizLoadCats();
    if (n === 3) wizFillReview();
  }
  function wizFilters() {
    var tagsRaw = wizEl('[data-wiz-tags]').value || '';
    var tags = tagsRaw.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    return {
      statut: wizEl('[data-wiz-statut]').value || null,
      pertinence_min: wizEl('[data-wiz-perti]').value || null,
      tags: tags.length ? tags : null
    };
  }
  function wizRefreshAudience() {
    if (!WIZ.campaign) return;
    var filters = wizFilters();
    // Patch la campagne côté serveur
    fetch('/api/push-campaigns/' + WIZ.campaign.id, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: filters, name: wizEl('[data-wiz-name]').value || WIZ.campaign.name })
    }).then(function (r) { return r.json(); })
      .then(function (res) { if (res.ok) WIZ.campaign = res.campaign; })
      .then(function () {
        return fetch('/api/push-campaigns/' + WIZ.campaign.id + '/recipients-preview', {
          method: 'POST', credentials: 'same-origin'
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        wizEl('[data-wiz-audience] .v30-wiz-audience__count').textContent = res.count != null ? res.count : '—';
      });
  }
  function wizLoadCats() {
    var sel = wizEl('[data-wiz-cat]');
    if (!sel || sel.options.length > 1) return;
    fetchJSON('/api/push-categories').then(function (res) {
      var cats = (res && (res.categories || res.items)) || res || [];
      cats.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name || c.title || ('Catégorie ' + c.id);
        sel.appendChild(opt);
      });
    }).catch(function () {});
  }
  function wizFillReview() {
    wizEl('[data-wiz-review-name]').textContent = wizEl('[data-wiz-name]').value || WIZ.campaign.name || '—';
    wizEl('[data-wiz-review-audience]').textContent =
      wizEl('[data-wiz-audience] .v30-wiz-audience__count').textContent + ' prospects';
    wizEl('[data-wiz-review-cat]').textContent = wizEl('[data-wiz-cat]').selectedOptions[0]?.textContent || '—';
    wizEl('[data-wiz-review-tpl]').textContent = wizEl('[data-wiz-tpl]').selectedOptions[0]?.textContent || 'Aucun';
  }
  function wizOpen() {
    wizEl('[data-v30-wiz-backdrop]').hidden = false;
    wizEl('[data-v30-wiz]').hidden = false;
    // Reset form
    wizEl('[data-wiz-name]').value = '';
    wizEl('[data-wiz-statut]').value = '';
    wizEl('[data-wiz-perti]').value = '';
    wizEl('[data-wiz-tags]').value = '';
    wizEl('[data-wiz-when]').value = '';
    // Crée un brouillon
    fetch('/api/push-campaigns', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nouvelle campagne' })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) { WIZ.campaign = res.campaign; wizShowStep(1); wizRefreshAudience(); }
      });
  }
  function wizClose(reload) {
    wizEl('[data-v30-wiz-backdrop]').hidden = true;
    wizEl('[data-v30-wiz]').hidden = true;
    WIZ.campaign = null;
    if (reload) loadCampaigns();
  }
  function wizSend() {
    if (!WIZ.campaign) return;
    fetch('/api/push-campaigns/' + WIZ.campaign.id + '/send', {
      method: 'POST', credentials: 'same-origin'
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.ok) {
          if (window.showToast) window.showToast('Campagne envoyée (' + res.sent + ' destinataires)', 'success');
          wizClose(true);
        }
      });
  }
  function bindWizard() {
    var btn = document.querySelector('[data-v30-new-campaign]');
    if (btn) btn.addEventListener('click', wizOpen);
    document.querySelectorAll('[data-v30-wiz-close]').forEach(function (b) {
      b.addEventListener('click', function () { wizClose(false); });
    });
    var next = wizEl('[data-v30-wiz-next]');
    var prev = wizEl('[data-v30-wiz-prev]');
    var send = wizEl('[data-v30-wiz-send]');
    if (next) next.addEventListener('click', function () { wizShowStep(Math.min(3, WIZ.step + 1)); });
    if (prev) prev.addEventListener('click', function () { wizShowStep(Math.max(1, WIZ.step - 1)); });
    if (send) send.addEventListener('click', wizSend);
    // Refresh audience quand un filtre change
    ['[data-wiz-statut]', '[data-wiz-perti]', '[data-wiz-tags]', '[data-wiz-name]'].forEach(function (sel) {
      var el = wizEl(sel);
      if (el) el.addEventListener('change', wizRefreshAudience);
      if (el && el.tagName !== 'SELECT') el.addEventListener('blur', wizRefreshAudience);
    });
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindTabs();
    bindWizard();
    loadCampaigns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
