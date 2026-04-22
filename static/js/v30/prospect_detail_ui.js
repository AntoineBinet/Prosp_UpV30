/* ProspUp v30 — Fiche prospect : UI events + init */
(function () {
  'use strict';
  var FP = window.ProspFP;
  var R = window.ProspFPRender;
  if (!FP || !R) return;

  var STATUTS = [
    "Pas d'actions",
    "Appelé",
    "À rappeler",
    "Rendez-vous",
    "Prospecté",
    "Messagerie",
    "Pas intéressé"
  ];

  // ─── Flash "saved" ──────────────────────────────────────────
  function flashSaved() {
    var el = document.querySelector('[data-v30-saved-check]');
    if (!el) return;
    el.classList.add('is-visible');
    setTimeout(function () { el.classList.remove('is-visible'); }, 1200);
  }

  // ─── Floating picker (partagé statut + more menu) ────────────
  var _activePicker = null;

  function closePicker() {
    if (_activePicker) {
      _activePicker.remove();
      _activePicker = null;
    }
  }

  function buildPicker(items, anchorEl) {
    var picker = document.createElement('div');
    picker.className = 'v30-fp-picker';
    picker.setAttribute('role', 'menu');

    items.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement('div');
        sep.className = 'v30-fp-picker__sep';
        picker.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v30-fp-picker__item' +
        (item.active ? ' is-active' : '') +
        (item.danger ? ' danger' : '');
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = item.html || FP.esc(item.label || '');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closePicker();
        if (item.action) item.action();
      });
      picker.appendChild(btn);
    });

    // Position under the anchor
    var rect = anchorEl.getBoundingClientRect();
    picker.style.top = (rect.bottom + 4) + 'px';
    // Align right edge for "more" button, left edge for statut
    if (anchorEl.dataset.v30Action === 'more') {
      picker.style.right = (window.innerWidth - rect.right) + 'px';
    } else {
      picker.style.left = rect.left + 'px';
    }

    document.body.appendChild(picker);
    _activePicker = picker;

    // Close on outside click
    setTimeout(function () {
      document.addEventListener('click', closePicker, { once: true, capture: true });
    }, 0);

    return picker;
  }

  // ─── Inline edit (click → contenteditable → Enter/Esc) ─────
  function bindInlineEdit() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-v30-edit]');
      if (!el) return;
      if (el.getAttribute('contenteditable') === 'true') return;
      var original = el.textContent;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      function commit(save) {
        el.removeAttribute('contenteditable');
        var newVal = el.textContent.trim();
        if (!save || newVal === original.trim()) {
          el.textContent = original;
          return;
        }
        var field = el.dataset.v30Edit;
        FP.saveField(field, newVal).then(function () {
          if (FP.STATE.prospect) FP.STATE.prospect[field] = newVal;
          flashSaved();
          R.header(FP.STATE.prospect);
          R.aside(FP.STATE.prospect);
        }).catch(function (err) {
          el.textContent = original;
          alert('Échec de sauvegarde : ' + err.message);
        });
      }

      function onKey(ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          el.blur();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          el.textContent = original;
          el.blur();
        }
      }
      function onBlur() {
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('blur', onBlur);
        commit(true);
      }
      el.addEventListener('keydown', onKey);
      el.addEventListener('blur', onBlur);
    });
  }

  // ─── Statut picker ───────────────────────────────────────────
  function bindStatusEdit() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-statut-btn]');
      if (!btn) return;
      e.stopPropagation();
      if (_activePicker) { closePicker(); return; }

      var current = (FP.STATE.prospect && FP.STATE.prospect.statut) || '';
      var items = STATUTS.map(function (s) {
        return {
          active: s === current,
          html: '<span class="status ' + FP.statusClass(s) + '">' + FP.esc(s) + '</span>',
          action: function () {
            FP.saveField('statut', s).then(function () {
              if (FP.STATE.prospect) FP.STATE.prospect.statut = s;
              flashSaved();
              R.header(FP.STATE.prospect);
              R.aside(FP.STATE.prospect);
            }).catch(function (err) {
              alert('Échec : ' + err.message);
            });
          }
        };
      });
      buildPicker(items, btn);
    });

    // Keyboard support (Enter/Space on the statut button)
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.v30StatutBtn !== undefined) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  // ─── More menu ───────────────────────────────────────────────
  function openMoreMenu(anchorEl) {
    if (_activePicker) { closePicker(); return; }
    var p = FP.STATE.prospect || {};
    var items = [];

    if (p.linkedin) {
      items.push({
        label: 'Voir sur LinkedIn',
        action: function () { window.open(p.linkedin, '_blank', 'noopener'); }
      });
    }
    if (p.company_id) {
      items.push({
        label: "Ouvrir l'entreprise",
        action: function () { window.location.href = '/entreprises#' + p.company_id; }
      });
    }
    if (items.length) items.push({ sep: true });

    items.push({
      label: 'Supprimer le prospect',
      danger: true,
      action: function () {
        if (!confirm('Supprimer définitivement ce prospect ?')) return;
        FP.fetchPostJSON('/api/prospects/delete', { id: FP.ID })
          .then(function () { window.location.href = '/v30/prospects'; })
          .catch(function (err) { alert('Erreur : ' + err.message); });
      }
    });

    buildPicker(items, anchorEl);
  }

  // ─── Tabs ───────────────────────────────────────────────────
  function bindTabs() {
    var tabs = document.querySelector('[data-v30-fp-tabs]');
    if (!tabs) return;
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      tabs.querySelectorAll('button[data-tab]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-fp-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30FpPanel !== key);
      });
    });
  }

  // ─── Filtre activité (Tous / Push / Notes) ──────────────────
  function bindActivityFilter() {
    var host = document.querySelector('[data-v30-fp-filter]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      host.querySelectorAll('button[data-filter]').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      R.events(btn.dataset.filter, '[data-v30-fp-events]', 6);
    });
  }

  // ─── Drawer IA ──────────────────────────────────────────────
  function openDrawer(title, bodyHtml) {
    var bd = document.querySelector('[data-v30-drawer-backdrop]');
    var dr = document.querySelector('[data-v30-drawer]');
    if (!dr) return;
    var t = dr.querySelector('[data-field="title"]');
    if (t) t.textContent = title || 'Analyse IA';
    var body = dr.querySelector('[data-field="body"]');
    if (body) body.innerHTML = bodyHtml || '<div class="empty">Aucun contenu.</div>';
    dr.classList.add('is-open');
    dr.setAttribute('aria-hidden', 'false');
    if (bd) bd.classList.add('is-visible');
  }
  function closeDrawer() {
    var bd = document.querySelector('[data-v30-drawer-backdrop]');
    var dr = document.querySelector('[data-v30-drawer]');
    if (dr) {
      dr.classList.remove('is-open');
      dr.setAttribute('aria-hidden', 'true');
    }
    if (bd) bd.classList.remove('is-visible');
  }
  function bindDrawer() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-drawer-close]')) closeDrawer();
      if (e.target.matches('[data-v30-drawer-backdrop]')) closeDrawer();
      if (e.target.closest('[data-v30-ia-run]')) {
        var body = '<div class="stack gap-3">' +
          '<p class="muted" style="font-size:12.5px;">Sélectionne un type d\'analyse :</p>' +
          '<button type="button" class="btn">' + 'Scraping enrichissement' + '</button>' +
          '<button type="button" class="btn">Avant RDV — fiche prépa</button>' +
          '<button type="button" class="btn">Après RDV — compte-rendu</button>' +
          '<p class="muted" style="font-size:11.5px;">Les analyses IA existantes restent accessibles via la fiche legacy en attendant le branchement complet côté v30.</p>' +
        '</div>';
        openDrawer('Analyse IA', body);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  // ─── Actions header (push / schedule / appeler / more) ──────
  function bindHeaderActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-action]');
      if (!btn) return;
      var act = btn.dataset.v30Action;
      if (act === 'push') {
        window.location.href = '/v30/push?ids=' + FP.ID;
      } else if (act === 'schedule') {
        window.location.href = '/v30/calendrier';
      } else if (act === 'more') {
        e.stopPropagation();
        openMoreMenu(btn);
      }
    });

    // Log-call sur le bouton "Appeler" (a[data-field="tel-link"])
    document.addEventListener('click', function (e) {
      var link = e.target.closest('[data-field="tel-link"]');
      if (!link) return;
      FP.fetchPostJSON('/api/prospect/log-call', { prospect_id: FP.ID })
        .then(function (res) {
          if (!res || !res.ok) return;
          var now = res.lastContact || new Date().toISOString();
          if (FP.STATE.prospect) {
            FP.STATE.prospect.lastContact = now;
            R.aside(FP.STATE.prospect);
          }
        })
        .catch(function () {});
    });
  }

  // ─── Init ───────────────────────────────────────────────────
  function init() {
    bindInlineEdit();
    bindStatusEdit();
    bindTabs();
    bindActivityFilter();
    bindDrawer();
    bindHeaderActions();
    FP.loadTimeline();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
