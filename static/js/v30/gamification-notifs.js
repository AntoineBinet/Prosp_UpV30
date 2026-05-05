/* gamification-notifs.js — Notifications objectifs quotidiens dans la cloche (10h–20h)
   Injecte des alertes d'urgence escaladante dans window._v30NotifExtra.
   Les actions au clic reproduisent le comportement des boutons du panneau Objectifs.
*/
(function () {
  'use strict';

  var SHOW_FROM = 10;          // heure de début (incluse)
  var HIDE_AT   = 20;          // heure de fin (exclue, notifs supprimées)
  var POLL_MS   = 5 * 60 * 1000;
  var TICK_MS   = 60 * 1000;   // re-rendu urgence chaque minute sans re-fetch

  var SVG_WARN  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  var SVG_CLOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  var GOAL_META = {
    push:               { noun: 'push',             cta: 'Faire un push →' },
    rdv:                { noun: 'RDV prosp',         cta: 'Lancer Mode Prosp →' },
    sourcing_contacted: { noun: 'contact sourcing',  cta: 'Aller au sourcing →' }
  };

  var _lastGoals  = null;
  var _extraSlots = {};  // key → objet dans window._v30NotifExtra

  // ------------------------------------------------------------------
  // Helpers temps

  function nowHour() { return new Date().getHours(); }

  function inWindow() {
    var hr = nowHour();
    return hr >= SHOW_FROM && hr < HIDE_AT;
  }

  // 0 = info (10-11h)  1 = mild (12-14h)  2 = warn (15-17h)  3 = critical (18-19h)
  function urgencyLevel() {
    var hr = nowHour();
    if (hr < 12) return 0;
    if (hr < 15) return 1;
    if (hr < 18) return 2;
    return 3;
  }

  // ------------------------------------------------------------------
  // Construction HTML

  function buildLabel(key, behind, lvl) {
    var meta = GOAL_META[key] || { noun: key };
    var noun = meta.noun;
    var plural = behind > 1 ? 's' : '';
    switch (lvl) {
      case 0: return behind + ' ' + noun + ' à faire aujourd\'hui';
      case 1: return behind + ' ' + noun + ' restant' + plural + ' — objectif du jour';
      case 2: return 'Objectif en retard · ' + behind + ' ' + noun + ' à rattraper';
      default: return 'Attention, ' + behind + ' ' + noun + ' en retard pour objectif quotidien';
    }
  }

  function buildSub(lvl) {
    switch (lvl) {
      case 0: return 'Tu peux encore t\'avancer';
      case 1: return 'N\'oublie pas ton objectif quotidien';
      case 2: return 'Il reste quelques heures pour rattraper';
      default: return 'Fin de journée proche — agis maintenant !';
    }
  }

  function buildHtml(key, behind, lvl) {
    var meta = GOAL_META[key] || { cta: 'Agir →' };
    var isWarn = lvl >= 2;
    var iconHtml  = isWarn ? SVG_WARN : SVG_CLOCK;
    var iconClass = isWarn ? 'v30-notif-item__icon--warn' : 'v30-notif-item__icon--info';
    return (
      '<div class="v30-notif-item" data-gamif-key="' + key + '" style="cursor:pointer">' +
        '<div class="v30-notif-item__icon ' + iconClass + '">' + iconHtml + '</div>' +
        '<div class="v30-notif-item__body">' +
          '<div class="v30-notif-item__label">' + buildLabel(key, behind, lvl) + '</div>' +
          '<div class="v30-notif-item__sub">' + buildSub(lvl) + '</div>' +
          '<div class="v30-notif-item__cta">' +
            '<button class="btn btn-sm" data-gamif-action="' + key + '">' + meta.cta + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ------------------------------------------------------------------
  // Actions (identiques aux handlers du panneau Objectifs dans dashboard.js)

  function doAction(key) {
    if (key === 'push') {
      fetch('/api/prospects/quick-filter?preset=push_ready', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok || !res.ids || !res.ids.length) {
            if (typeof showToast === 'function') showToast('Aucun prospect éligible au push (email dispo, pas de tél, push non envoyé)', 'info');
            return;
          }
          window.location.href = '/v30/prospect/' + res.ids[0];
        })
        .catch(function () {
          if (typeof showToast === 'function') showToast('Erreur lors du filtrage', 'error');
        });

    } else if (key === 'rdv') {
      fetch('/api/prospects/quick-filter?preset=rdv_ready', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || !res.ok || !res.ids || !res.ids.length) {
            if (typeof showToast === 'function') showToast('Aucun prospect éligible (Messagerie/Pas d\'actions/À rappeler avec téléphone)', 'info');
            return;
          }
          return fetch('/api/mode-prosp/start', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: res.ids })
          }).then(function (r) { return r.json(); }).then(function (r) {
            if (!r || !r.ok || !r.token) throw new Error((r && r.error) || 'Token manquant');
            window.open('/v30/mode-prosp?t=' + encodeURIComponent(r.token), '_blank');
          });
        })
        .catch(function (e) {
          if (typeof showToast === 'function') showToast('Erreur Mode Prosp : ' + (e && e.message), 'error');
        });

    } else if (key === 'sourcing_contacted') {
      window.open('https://www.linkedin.com/talent/contract-chooser/?trk=nav_account_sub_nav_cap', '_blank');
      window.location.href = '/v30/sourcing#inmails';
    }
  }

  // Délégation de clic — item entier ou bouton CTA
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-gamif-action]');
    if (btn) {
      doAction(btn.dataset.gamifAction);
      return;
    }
    var item = e.target.closest('[data-gamif-key]');
    if (item) {
      doAction(item.dataset.gamifKey);
    }
  });

  // ------------------------------------------------------------------
  // Rendu dans _v30NotifExtra

  function renderExtras() {
    if (!inWindow()) {
      // Hors plage horaire → purger toutes les notifs gamif
      var arr = window._v30NotifExtra;
      if (arr && Object.keys(_extraSlots).length) {
        Object.keys(_extraSlots).forEach(function (k) {
          var idx = arr.indexOf(_extraSlots[k]);
          if (idx !== -1) arr.splice(idx, 1);
        });
        _extraSlots = {};
        document.dispatchEvent(new CustomEvent('v30:notif:refresh'));
      }
      return;
    }

    var daily = _lastGoals && _lastGoals.daily && _lastGoals.daily.items;
    if (!daily) return;

    window._v30NotifExtra = window._v30NotifExtra || [];
    var arr = window._v30NotifExtra;
    var lvl = urgencyLevel();
    var changed = false;

    Object.keys(GOAL_META).forEach(function (key) {
      var item = daily[key];
      if (!item || Number(item.target || 0) <= 0) return;

      var behind = Math.max(0, Number(item.target || 0) - Number(item.count || 0));

      if (behind <= 0) {
        if (_extraSlots[key]) {
          var idx = arr.indexOf(_extraSlots[key]);
          if (idx !== -1) arr.splice(idx, 1);
          delete _extraSlots[key];
          changed = true;
        }
        return;
      }

      var html = buildHtml(key, behind, lvl);
      if (!_extraSlots[key]) {
        var slot = { html: html };
        arr.push(slot);
        _extraSlots[key] = slot;
        changed = true;
      } else if (_extraSlots[key].html !== html) {
        _extraSlots[key].html = html;
        changed = true;
      }
    });

    if (changed) {
      document.dispatchEvent(new CustomEvent('v30:notif:refresh'));
    }
  }

  // ------------------------------------------------------------------
  // Fetch + poll

  function fetchGoals() {
    fetch('/api/dashboard', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        _lastGoals = (res && res.data && res.data.goals) || null;
        renderExtras();
      })
      .catch(function () {});
  }

  fetchGoals();
  setInterval(fetchGoals, POLL_MS);
  setInterval(renderExtras, TICK_MS);
})();
