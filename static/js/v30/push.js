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
      // /api/templates renvoie un array direct. Fallback defensif sur
      // res.templates / res.items / res.data au cas ou, puis dict.
      if (Array.isArray(res)) {
        STATE.templates = res;
      } else if (res && typeof res === 'object') {
        STATE.templates = res.templates || res.items || res.data || [];
        if (!Array.isArray(STATE.templates) && typeof STATE.templates === 'object') {
          STATE.templates = Object.keys(STATE.templates).map(function (k) {
            var v = STATE.templates[k]; v.name = v.name || k; return v;
          });
        }
      } else {
        STATE.templates = [];
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
      return '<div class="v30-camp-card" data-campaign-id="' + c.id + '" data-camp-open="' + c.id + '" role="button" tabindex="0" style="cursor:pointer;">' +
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
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.campDelete;
        if (!confirm('Supprimer cette campagne ?')) return;
        fetch('/api/push-campaigns/' + id, { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(loadCampaigns);
      });
    });
    // BUG 8 : rendre les cartes cliquables → ouvre les détails inline
    host.querySelectorAll('[data-camp-open]').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-camp-delete]')) return;
        var id = card.dataset.campOpen;
        openCampaignDetail(id);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });
  }

  function openCampaignDetail(id) {
    var c = (STATE.campaigns || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    var existing = document.querySelector('[data-v30-camp-detail]');
    if (existing) existing.remove();
    var stats = c.stats || {};
    var sent = c.sent_at ? true : false;
    var bd = document.createElement('div');
    bd.setAttribute('data-v30-camp-detail', '');
    bd.setAttribute('role', 'dialog');
    bd.setAttribute('aria-modal', 'true');
    bd.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';
    bd.innerHTML =
      '<div style="max-width:560px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">' +
          '<div><div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;">Campagne</div>' +
          '<h2 style="margin:4px 0 0;font-size:18px;">' + esc(c.name || '—') + '</h2></div>' +
          '<button type="button" class="btn btn-ghost btn-icon" data-camp-detail-close aria-label="Fermer">×</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
          '<span class="v30-camp-card__badge' + (sent ? ' is-sent' : '') + '">' + (sent ? 'Envoyée' : 'Brouillon') + '</span>' +
        '</div>' +
        '<div style="font-size:13px;line-height:1.7;color:var(--text-2);">' +
          '<div>Créée le <b>' + esc(fmtDate(c.created_at)) + '</b></div>' +
          (c.sent_at ? '<div>Envoyée le <b>' + esc(fmtDate(c.sent_at)) + '</b></div>' : '') +
          '<div>Audience : <b>' + (stats.recipients != null ? stats.recipients : '—') + '</b></div>' +
          (stats.sent != null ? '<div>Envoyés : <b>' + stats.sent + '</b></div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
          (sent ? '' : '<button type="button" class="btn btn-danger btn-sm" data-camp-detail-delete="' + c.id + '">Supprimer</button>') +
          '<button type="button" class="btn" data-camp-detail-close>Fermer</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', function (e) {
      if (e.target === bd || e.target.closest('[data-camp-detail-close]')) bd.remove();
      var del = e.target.closest('[data-camp-detail-delete]');
      if (del) {
        if (!confirm('Supprimer cette campagne ?')) return;
        fetch('/api/push-campaigns/' + del.dataset.campDetailDelete, { method: 'DELETE', credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function () { bd.remove(); loadCampaigns(); });
      }
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { bd.remove(); document.removeEventListener('keydown', esc); }
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

  // ─── Template CRUD ───────────────────────────────────────
  function getTplModal() { return document.querySelector('[data-v30-pp-modal="tpl-edit"]'); }
  function openTplModal(t) {
    var m = getTplModal();
    if (!m) return;
    var mode = m.querySelector('[data-v30-tpl-mode]');
    var del = m.querySelector('[data-v30-tpl-delete]');
    var val = function (id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; };
    if (t) {
      if (mode) mode.textContent = 'Modifier le template';
      val('v30-tpl-name', t.name);
      val('v30-tpl-subject', t.subject);
      val('v30-tpl-body', t.body);
      val('v30-tpl-li', t.linkedin_body || t.linkedinBody);
      (m.querySelector('[data-v30-tpl-default]') || {}).checked = !!t.is_default;
      if (del) del.hidden = false;
      m.dataset.tid = t.id;
    } else {
      if (mode) mode.textContent = 'Nouveau template';
      ['v30-tpl-name','v30-tpl-subject','v30-tpl-body','v30-tpl-li'].forEach(function (id) { val(id, ''); });
      (m.querySelector('[data-v30-tpl-default]') || {}).checked = false;
      if (del) del.hidden = true;
      delete m.dataset.tid;
    }
    m.hidden = false; void m.offsetWidth; m.classList.add('is-open');
    var f = document.getElementById('v30-tpl-name');
    if (f) try { f.focus(); } catch (_) {}
  }
  function closeTplModal() {
    var m = getTplModal();
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { m.hidden = true; }, 160);
  }
  function saveTpl() {
    var m = getTplModal();
    var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var name = val('v30-tpl-name');
    if (!name) { if (window.showToast) window.showToast('Nom requis', 'warning'); return; }
    var payload = {
      name: name,
      subject: val('v30-tpl-subject'),
      body: val('v30-tpl-body'),
      linkedin_body: val('v30-tpl-li'),
      is_default: (m.querySelector('[data-v30-tpl-default]') || {}).checked ? 1 : 0
    };
    if (m.dataset.tid) payload.id = Number(m.dataset.tid);
    var btn = m.querySelector('[data-v30-tpl-save]');
    if (btn) btn.disabled = true;
    fetch('/api/templates/save', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        if (window.showToast) window.showToast('Template enregistré', 'success');
        closeTplModal();
        loadTemplates();
      })
      .catch(function (e) { if (window.showToast) window.showToast('Erreur : ' + e.message, 'error'); })
      .then(function () { if (btn) btn.disabled = false; });
  }
  function deleteTpl() {
    var m = getTplModal();
    if (!m.dataset.tid) return;
    if (!confirm('Supprimer ce template ?')) return;
    fetch('/api/templates/delete', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Number(m.dataset.tid) })
    }).then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        if (window.showToast) window.showToast('Template supprimé', 'success');
        closeTplModal();
        loadTemplates();
      })
      .catch(function (e) { if (window.showToast) window.showToast('Erreur : ' + e.message, 'error'); });
  }
  function bindTemplates() {
    document.addEventListener('click', function (e) {
      var newT = e.target.closest('[data-v30-new-template]');
      if (newT) { e.preventDefault(); openTplModal(null); return; }
      var card = e.target.closest('.v30-tpl-card');
      if (card && !card.classList.contains('v30-tpl-card__new')) {
        // Vérifie qu'on a cliqué dans la card (pas sur bouton externe)
        var titleEl = card.querySelector('[style*="font-weight:600"]') || card.firstElementChild;
        var idx = Array.prototype.indexOf.call(card.parentElement.children, card);
        if (idx >= 0 && STATE.templates[idx]) {
          e.preventDefault();
          openTplModal(STATE.templates[idx]);
        }
      }
      var close = e.target.closest('[data-v30-modal-close]');
      if (close && close.closest('[data-v30-pp-modal="tpl-edit"]')) { closeTplModal(); return; }
      var bd = e.target.closest('.v30-modal-bd[data-v30-pp-modal="tpl-edit"]');
      if (bd && e.target === bd) closeTplModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var m = getTplModal();
      if (m && !m.hidden) closeTplModal();
    });
    var saveBtn = document.querySelector('[data-v30-tpl-save]');
    if (saveBtn) saveBtn.addEventListener('click', saveTpl);
    var delBtn = document.querySelector('[data-v30-tpl-delete]');
    if (delBtn) delBtn.addEventListener('click', deleteTpl);
  }

  // ─── Init ────────────────────────────────────────────────
  function init() {
    bindTabs();
    bindWizard();
    bindTemplates();
    loadCampaigns();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
