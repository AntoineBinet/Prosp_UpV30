/* ProspUp v30 — Status picker
 * Badge de statut cliquable + menu animé, réutilisable dans tous les
 * tableaux de prospects (Prospects, Entreprises, Focus, …).
 *
 * API publique :
 *   V30StatusPicker.badge(statut, opts) -> string HTML
 *     opts = { id, rdvDate, style, interactive }
 *   V30StatusPicker.statusClass(statut) -> string (classe .status-*)
 *   V30StatusPicker.STATUS_OPTIONS     -> string[]
 *
 * Quand l'utilisateur change un statut depuis le menu, le composant :
 *   1. met à jour le badge immédiatement (optimiste, animation pulse) ;
 *   2. persiste via POST /api/prospects/bulk-edit ;
 *   3. émet `v30:statut-changed` sur `document`
 *      (detail : { id, statut, prevStatut }) pour que la page synchronise
 *      son état local sans avoir à re-render le tableau.
 */
(function (global) {
  'use strict';

  // Funnel de prospection ProspUp — ordre canonique.
  var STATUS_OPTIONS = [
    "Pas d'actions", 'Appelé', 'À rappeler', 'Rendez-vous',
    'Prospecté', 'Messagerie', 'Pas intéressé'
  ];

  // Libellé -> classe CSS .status-* (inclut les alias legacy).
  var STATUS_CLASS = {
    "Pas d'actions": 'status-idle',
    'Prospecté':     'status-prosp',
    'Appelé':        'status-called',
    'Contacté':      'status-called',
    'Messagerie':    'status-voicemail',
    'À rappeler':    'status-callback',
    'Rendez-vous':   'status-rdv',
    'Pas intéressé': 'status-cold',
    'Proposition':   'status-rdv',
    'Gagné':         'status-prosp'
  };
  var ALL_STATUS_CLASSES = ['status-idle', 'status-prosp', 'status-called',
    'status-voicemail', 'status-callback', 'status-rdv', 'status-cold'];

  function statusClass(statut) { return STATUS_CLASS[statut] || ''; }

  function esc(s) {
    var d = document.createElement('span');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // Libellé court pour une date de RDV (auj. / demain / 12 mars …).
  function rdvDateLabel(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var now = new Date();
      var a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var diff = Math.round((b.getTime() - a.getTime()) / 86400000);
      if (diff === 0) return 'auj.';
      if (diff === 1) return 'demain';
      if (diff === -1) return 'hier';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).replace('.', '');
    } catch (_) { return ''; }
  }

  var CARET_SVG = '<svg class="v30-statpick__caret" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var HEAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><circle cx="12" cy="12" r="9"/>' +
    '<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/></svg>';

  // ─── Rendu d'un badge ───────────────────────────────────────
  function badge(statut, opts) {
    opts = opts || {};
    statut = statut || '';
    var cls = statusClass(statut);
    var clsAttr = cls ? ' ' + cls : '';
    var styleAttr = opts.style ? ' style="' + esc(opts.style) + '"' : '';
    var display = statut || '—';
    if (statut === 'Rendez-vous' && opts.rdvDate) {
      var dl = rdvDateLabel(opts.rdvDate);
      if (dl) display = statut + ' · ' + dl;
    }
    var interactive = opts.interactive !== false && opts.id != null && !!statut;
    if (!interactive) {
      return '<span class="status' + clsAttr + '"' + styleAttr + '>' + esc(display) + '</span>';
    }
    return '<button type="button" class="status v30-statpick' + clsAttr + '"' +
      ' data-v30-statpick data-statut-id="' + esc(String(opts.id)) + '"' +
      ' data-statut="' + esc(statut) + '"' +
      ' aria-haspopup="true" aria-expanded="false"' +
      ' title="Changer le statut"' +
      ' aria-label="Statut : ' + esc(statut) + '. Cliquer pour changer."' +
      styleAttr + '>' +
      '<span class="v30-statpick__label">' + esc(display) + '</span>' +
      CARET_SVG +
    '</button>';
  }

  // ─── Menu ───────────────────────────────────────────────────
  var openState = null;

  function buildMenu(current) {
    var opts = STATUS_OPTIONS.slice();
    if (current && opts.indexOf(current) < 0) opts.unshift(current);
    var menu = document.createElement('div');
    menu.className = 'v30-statmenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Changer le statut');
    var html = '<div class="v30-statmenu__head">' + HEAD_SVG + '<span>Statut</span></div>';
    html += opts.map(function (s, i) {
      var cls = statusClass(s);
      var isCur = (s === current);
      return '<button type="button" role="menuitemradio" tabindex="-1"' +
        ' aria-checked="' + (isCur ? 'true' : 'false') + '"' +
        ' class="v30-statmenu__opt' + (isCur ? ' is-current' : '') + '"' +
        ' data-statut="' + esc(s) + '" style="--i:' + i + '">' +
        '<span class="status' + (cls ? ' ' + cls : '') + '">' + esc(s) + '</span>' +
        '<span class="v30-statmenu__opt-sp"></span>' +
        '<span class="v30-statmenu__check">' + CHECK_SVG + '</span>' +
      '</button>';
    }).join('');
    menu.innerHTML = html;
    return menu;
  }

  function positionMenu(menu, anchor) {
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var M = 8;    // marge minimale au bord de l'écran
    var GAP = 7;  // espace entre le badge et le menu

    var below = r.bottom + GAP;
    var above = r.top - GAP - mh;
    var placeAbove = (below + mh > vh - M) && (above >= M);
    var top = placeAbove ? above : below;
    if (top < M) top = M;
    if (top + mh > vh - M) top = Math.max(M, vh - M - mh);

    var left = r.left;
    var alignRight = false;
    if (left + mw > vw - M) { left = r.right - mw; alignRight = true; }
    if (left < M) left = M;
    if (left + mw > vw - M) left = Math.max(M, vw - M - mw);

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.style.setProperty('--v30-statmenu-origin',
      (placeAbove ? 'bottom' : 'top') + ' ' + (alignRight ? 'right' : 'left'));
  }

  function openMenu(badgeEl) {
    closeMenu(true);
    var id = Number(badgeEl.dataset.statutId);
    var current = badgeEl.dataset.statut || '';
    var scrim = document.createElement('div');
    scrim.className = 'v30-statmenu-scrim';
    var menu = buildMenu(current);
    document.body.appendChild(scrim);
    document.body.appendChild(menu);
    positionMenu(menu, badgeEl);
    badgeEl.setAttribute('aria-expanded', 'true');
    openState = { badge: badgeEl, menu: menu, scrim: scrim, id: id };

    requestAnimationFrame(function () {
      if (openState && openState.menu === menu) menu.classList.add('is-open');
    });

    scrim.addEventListener('click', function () { closeMenu(); });
    menu.addEventListener('click', onMenuClick);
    menu.addEventListener('keydown', onMenuKeydown);
    document.addEventListener('keydown', onDocKeydown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    var focusTarget = menu.querySelector('.v30-statmenu__opt.is-current')
      || menu.querySelector('.v30-statmenu__opt');
    if (focusTarget) {
      try { focusTarget.focus({ preventScroll: true }); }
      catch (_) { focusTarget.focus(); }
    }
  }

  function closeMenu(instant) {
    var st = openState;
    if (!st) return;
    openState = null;
    if (st.badge) st.badge.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onDocKeydown, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    var menu = st.menu, scrim = st.scrim;
    var cleanup = function () {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
    };
    if (instant || !menu) { cleanup(); return; }
    menu.classList.remove('is-open');
    menu.classList.add('is-closing');
    var done = false;
    var finish = function () { if (done) return; done = true; cleanup(); };
    menu.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 240);
  }

  function onViewportChange() { closeMenu(true); }

  function onDocKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    var b = openState && openState.badge;
    closeMenu();
    if (b) { try { b.focus(); } catch (_) {} }
  }

  function onMenuKeydown(e) {
    if (!openState) return;
    var opts = Array.prototype.slice.call(
      openState.menu.querySelectorAll('.v30-statmenu__opt'));
    if (!opts.length) return;
    var idx = opts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      opts[(idx + 1 + opts.length) % opts.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      opts[(idx - 1 + opts.length) % opts.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault(); opts[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault(); opts[opts.length - 1].focus();
    }
  }

  function onMenuClick(e) {
    var opt = e.target.closest('.v30-statmenu__opt');
    if (!opt || !openState) return;
    var newStatut = opt.dataset.statut || '';
    var badgeEl = openState.badge;
    var id = openState.id;
    var prev = badgeEl ? (badgeEl.dataset.statut || '') : '';
    closeMenu();
    if (!newStatut || newStatut === prev) return;
    applyStatus(badgeEl, id, newStatut, prev);
  }

  // ─── Persistance ────────────────────────────────────────────
  function toast(msg, type) {
    if (typeof global.showToast === 'function') global.showToast(msg, type);
  }

  function dispatchChange(id, statut, prevStatut) {
    document.dispatchEvent(new CustomEvent('v30:statut-changed', {
      detail: { id: id, statut: statut, prevStatut: prevStatut }
    }));
  }

  function paintBadge(el, statut) {
    if (!el) return;
    ALL_STATUS_CLASSES.forEach(function (c) { el.classList.remove(c); });
    var cls = statusClass(statut);
    if (cls) el.classList.add(cls);
    el.dataset.statut = statut;
    el.setAttribute('aria-label', 'Statut : ' + statut + '. Cliquer pour changer.');
    var label = el.querySelector('.v30-statpick__label');
    if (label) label.textContent = statut;
    el.classList.remove('is-justchanged');
    void el.offsetWidth;  // force un reflow pour rejouer l'animation
    el.classList.add('is-justchanged');
  }

  function bulkEdit(id, statut) {
    return fetch('/api/prospects/bulk-edit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id], field: 'statut', value: statut })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (!res || !res.ok || (res.updated | 0) < 1) {
        throw new Error((res && res.error) || 'Mise à jour refusée');
      }
      return res;
    });
  }

  function applyStatus(badgeEl, id, newStatut, prevStatut) {
    if (!id) { toast('Prospect introuvable', 'error'); return; }
    paintBadge(badgeEl, newStatut);  // optimiste
    if (badgeEl) { try { badgeEl.focus({ preventScroll: true }); } catch (_) {} }
    bulkEdit(id, newStatut)
      .then(function () {
        dispatchChange(id, newStatut, prevStatut);
        toast('Statut : ' + newStatut, 'success');
        if (typeof global.pushUndo === 'function') {
          global.pushUndo('Statut → ' + newStatut, function () {
            bulkEdit(id, prevStatut)
              .then(function () {
                var b = document.querySelector(
                  '[data-v30-statpick][data-statut-id="' + id + '"]');
                if (b) paintBadge(b, prevStatut);
                dispatchChange(id, prevStatut, newStatut);
                toast('Statut restauré', 'info');
              })
              .catch(function () { toast('Erreur restauration', 'error'); });
          });
        }
      })
      .catch(function (err) {
        paintBadge(badgeEl, prevStatut);  // rollback visuel
        toast('Erreur : ' + (err && err.message || err), 'error');
      });
  }

  // ─── Délégation globale du clic ─────────────────────────────
  document.addEventListener('click', function (e) {
    var badgeEl = e.target.closest('[data-v30-statpick]');
    if (!badgeEl) return;
    e.preventDefault();
    openMenu(badgeEl);
  });

  global.V30StatusPicker = {
    STATUS_OPTIONS: STATUS_OPTIONS,
    statusClass: statusClass,
    badge: badge,
    open: openMenu,
    close: closeMenu
  };
})(window);
