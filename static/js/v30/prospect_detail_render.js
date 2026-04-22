/* ProspUp v30 — Fiche prospect : rendu */
(function () {
  'use strict';
  var FP = window.ProspFP;
  if (!FP) return;

  function splitPhonesDetail(tel) {
    if (!tel) return [];
    var m = String(tel).match(/\+?\d[\d\s().-]{6,}\d/g);
    if (!m) return [];
    var seen = {};
    return m.map(function (s) { return s.trim().replace(/\s+/g, ' '); })
      .filter(function (s) { if (seen[s]) return false; seen[s] = true; return true; });
  }
  function normTelDetail(ph) {
    var plus = String(ph).charAt(0) === '+';
    var r = String(ph).replace(/[^\d]/g, '');
    return plus ? '+' + r : r;
  }

  function renderHeader(p) {
    var h = FP.$('[data-v30-fp-header]');
    if (!h || !p) return;
    var av = h.querySelector('[data-field="initials"]');
    if (av) av.textContent = FP.initials(p.name);
    var name = h.querySelector('[data-field="name"]');
    if (name) name.textContent = p.name || '—';
    var pill = h.querySelector('[data-field="statut-pill"]');
    if (pill) {
      pill.innerHTML = p.statut
        ? '<span class="status ' + FP.statusClass(p.statut) + '">' + FP.esc(p.statut) + '</span>'
        : '';
    }
    var meta = h.querySelector('[data-field="meta"]');
    if (meta) {
      var parts = [];
      if (p.fonction) parts.push(FP.esc(p.fonction));
      if (p.company_groupe) parts.push('chez <b>' + FP.esc(p.company_groupe) + '</b>');
      if (p.company_site) parts.push(FP.esc(p.company_site));
      if (p.lastContact) parts.push('<span class="mono">Dernière activité ' + FP.esc(FP.relativeTime(p.lastContact)) + '</span>');
      meta.innerHTML = parts.join(' · ') || '—';
    }
    var chips = h.querySelector('[data-field="chips"]');
    if (chips) {
      var c = '';
      if (p.email)     c += '<span class="badge">' + FP.esc(p.email) + '</span> ';
      if (p.telephone) c += '<span class="badge mono">' + FP.esc(p.telephone) + '</span> ';
      if (p.linkedin)  c += '<a class="badge" href="' + FP.esc(p.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>';
      chips.innerHTML = c || '<span class="muted" style="font-size:11.5px;">Aucun contact.</span>';
    }
    var telBtn = h.querySelector('[data-field="tel-link"]');
    if (telBtn) {
      if (p.telephone) {
        telBtn.hidden = false;
        var fpPhones = splitPhonesDetail(p.telephone);
        function logFpCall() {
          fetch('/api/prospect/log-call', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prospect_id: p.id })
          }).then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              if (!d || !d.ok || !d.lastContact) return;
              p.lastContact = d.lastContact;
              var aside = FP.$('[data-field="aside-last"]');
              if (aside) aside.textContent = FP.relativeTime(d.lastContact);
            }).catch(function () {});
        }
        if (fpPhones.length > 1) {
          telBtn.href = '#';
          telBtn.onclick = function (ev) {
            ev.preventDefault();
            var existing = document.querySelector('[data-v30-fp-tel-pick]');
            if (existing) { existing.remove(); return; }
            var pick = document.createElement('div');
            pick.setAttribute('data-v30-fp-tel-pick', '');
            pick.className = 'v30-pp-tel-drop';
            pick.style.cssText = 'position:fixed;z-index:200;min-width:180px;';
            var rect = telBtn.getBoundingClientRect();
            pick.style.top = (rect.bottom + 4) + 'px';
            pick.style.left = rect.left + 'px';
            fpPhones.forEach(function (ph) {
              var a = document.createElement('a');
              a.className = 'v30-pp-tel-opt';
              a.href = 'tel:' + normTelDetail(ph);
              a.textContent = ph;
              a.addEventListener('click', function () { logFpCall(); pick.remove(); });
              pick.appendChild(a);
            });
            document.body.appendChild(pick);
            setTimeout(function () {
              function closeP(ev2) {
                if (!pick.contains(ev2.target) && ev2.target !== telBtn) {
                  pick.remove();
                  document.removeEventListener('click', closeP);
                }
              }
              document.addEventListener('click', closeP);
            }, 10);
          };
        } else {
          telBtn.href = 'tel:' + (fpPhones.length ? normTelDetail(fpPhones[0]) : String(p.telephone).replace(/\s/g, ''));
          telBtn.onclick = logFpCall;
        }
      } else { telBtn.hidden = true; }
    }
    document.title = (p.name || 'Fiche') + " — Prosp'Up v30";
  }

  function renderAside(p) {
    if (!p) return;
    var set = function (sel, value) {
      var el = FP.$(sel);
      if (el) el.textContent = value || '—';
    };
    set('[data-field="aside-fonction"]', p.fonction);
    set('[data-field="aside-email"]',    p.email);
    set('[data-field="aside-tel"]',      p.telephone);
    set('[data-field="aside-next-rdv"]', FP.shortDate(p.nextFollowUp || p.rdvDate));
    set('[data-field="aside-last"]',     FP.relativeTime(p.lastContact));

    var statutEl = FP.$('[data-field="aside-statut"]');
    if (statutEl) {
      statutEl.innerHTML = p.statut
        ? '<span class="status ' + FP.statusClass(p.statut) + '">' + FP.esc(p.statut) + '</span>'
        : '—';
    }

    var pertEl = FP.$('[data-field="aside-pertinence"]');
    if (pertEl) {
      var n = Math.max(0, Math.min(5, Number(p.pertinence) || 0));
      var h = '';
      for (var i = 1; i <= 5; i++) {
        h += '<span style="display:inline-block;width:4px;height:10px;border-radius:1px;background:' +
             (i <= n ? 'var(--accent)' : 'var(--surface-3)') + ';margin-right:2px;"></span>';
      }
      pertEl.innerHTML = h;
    }

    var liEl = FP.$('[data-field="aside-linkedin"]');
    if (liEl) {
      liEl.innerHTML = p.linkedin
        ? '<a href="' + FP.esc(p.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>'
        : '—';
    }

    var tagsHost = FP.$('[data-field="aside-tags"]');
    if (tagsHost) {
      var tags = FP.parseTags(p.tags);
      tagsHost.innerHTML = tags.length
        ? tags.map(function (t) { return '<span class="badge badge-accent">' + FP.esc(t) + '</span>'; }).join(' ')
        : '<span class="muted" style="font-size:11.5px;">Aucun tag.</span>';
    }

    var notesEl = FP.$('[data-field="notes"]');
    if (notesEl) notesEl.textContent = p.notes || '';

    var coHost = FP.$('[data-field="aside-company"]');
    if (coHost) {
      if (p.company_groupe) {
        coHost.hidden = false;
        var ini = coHost.querySelector('[data-field="company-initials"]');
        if (ini) ini.textContent = FP.initials(p.company_groupe);
        var nm  = coHost.querySelector('[data-field="company-name"]');
        if (nm) nm.textContent = p.company_groupe;
        var sub = coHost.querySelector('[data-field="company-sub"]');
        if (sub) sub.textContent = p.company_site || '—';
        var link = coHost.querySelector('[data-field="company-link"]');
        if (link && p.company_id) link.href = '/entreprises#' + p.company_id;
      } else {
        coHost.hidden = true;
      }
    }
  }

  // ─── Timeline events ──────────────────────────────────────
  var DOT_COLOR = {
    push:         'var(--accent)',
    push_email:   'var(--accent)',
    push_linkedin:'var(--accent)',
    rdv_taken:    'oklch(0.50 0.15 280)',
    reunion_tech: 'oklch(0.50 0.15 280)',
    contrat_signe:'var(--success)',
    call_note:    'oklch(0.55 0.15 220)',
    note:         'var(--text-3)',
    status_change:'var(--success)',
    event:        'var(--text-3)'
  };

  function evIsPush(e)  { return (e.type || '').startsWith('push'); }
  function evIsNote(e)  { return (e.type || '') === 'call_note' || (e.type || '') === 'note'; }

  function renderEvents(filter, hostSel, limit) {
    var host = FP.$(hostSel);
    if (!host) return;
    var events = FP.STATE.events || [];
    if (filter === 'push') events = events.filter(evIsPush);
    else if (filter === 'note') events = events.filter(evIsNote);
    if (events.length === 0) {
      host.innerHTML = '<div class="empty">Aucun événement.</div>';
      return;
    }
    if (limit) events = events.slice(0, limit);
    host.innerHTML = events.map(function (e) {
      var color = DOT_COLOR[e.type] || 'var(--text-3)';
      var when = FP.relativeTime(e.date);
      var title = e.title || (e.type || 'Événement');
      var body = e.content || '';
      return '<div class="v30-fp-ev">' +
        '<span class="v30-fp-ev__time mono">' + FP.esc(when) + '</span>' +
        '<span class="v30-fp-ev__dot" style="background:' + color + ';"></span>' +
        '<div>' +
          '<div class="v30-fp-ev__title">' + FP.esc(title) + '</div>' +
          (body ? '<div class="v30-fp-ev__body">' + FP.esc(body) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderPushList() {
    var host = FP.$('[data-v30-fp-push-list]');
    if (!host) return;
    var pushes = FP.STATE.pushLogs || [];
    if (pushes.length === 0) {
      host.innerHTML = '<div class="empty">Aucun push envoyé.</div>';
      return;
    }
    host.innerHTML = pushes.map(function (p) {
      var meta = p.meta || {};
      var chan = meta.channel || (p.type === 'push_linkedin' ? 'linkedin' : 'email');
      return '<div style="display:grid;grid-template-columns:80px 1fr auto;gap:10px;padding:8px 0;border-top:1px solid var(--border);align-items:start;">' +
        '<span class="mono" style="font-size:11px;color:var(--text-3);padding-top:2px;">' + FP.esc(FP.relativeTime(p.date)) + '</span>' +
        '<div>' +
          '<div style="font-size:12.5px;font-weight:500;">' + FP.esc(p.title || '—') + '</div>' +
          (p.content ? '<div style="font-size:12px;color:var(--text-2);">' + FP.esc(p.content) + '</div>' : '') +
        '</div>' +
        '<span class="badge badge-accent">' + FP.esc(chan) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderCounts() {
    var timelineCount = FP.$('[data-field="count-timeline"]');
    if (timelineCount) timelineCount.textContent = FP.STATE.events.length;
    var pushCount = FP.$('[data-field="count-push"]');
    if (pushCount) pushCount.textContent = FP.STATE.pushLogs.length;
  }

  function renderAll() {
    var p = FP.STATE.prospect;
    renderHeader(p);
    renderAside(p);
    renderEvents('all', '[data-v30-fp-events]', 6);
    renderEvents('all', '[data-v30-fp-events-full]');
    renderPushList();
    renderCounts();
  }

  window.ProspFPRender = {
    all: renderAll,
    header: renderHeader,
    aside: renderAside,
    events: renderEvents,
    pushList: renderPushList
  };
})();
