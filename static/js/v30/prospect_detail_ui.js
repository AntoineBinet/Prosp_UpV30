/* ProspUp v30 — Fiche prospect : UI events + init */
(function () {
  'use strict';
  var FP = window.ProspFP;
  var R = window.ProspFPRender;
  if (!FP || !R) return;

  // ─── Flash "saved" ──────────────────────────────────────────
  function flashSaved() {
    var el = document.querySelector('[data-v30-saved-check]');
    if (!el) return;
    el.classList.add('is-visible');
    setTimeout(function () { el.classList.remove('is-visible'); }, 1200);
  }

  // ─── Inline edit (click → contenteditable → Enter save / Esc cancel) ──
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
          // Rafraîchit header + aside pour cohérence (ex: changement nom)
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

  // ─── Actions header (push / schedule / more) ────────────────
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
        // Menu minimaliste : fallback vers la fiche legacy (édition avancée)
        window.location.href = '/?prospect=' + FP.ID + '&force_v29=1';
      }
    });
  }

  // ─── Init ───────────────────────────────────────────────────
  function init() {
    bindInlineEdit();
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
