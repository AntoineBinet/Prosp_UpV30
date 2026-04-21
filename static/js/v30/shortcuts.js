/* ProspUp v30 — Keyboard shortcuts (SPEC §2.3)
   - ⌘K / Ctrl+K / "/" : palette (déjà géré par palette.js pour ⌘K)
   - G + {D,P,E,S,F,U,T} : goto
   - C : ouvre palette sur section Actions rapides (menu Créer)
   - ⇧T : bascule thème
   - ⌘B / [ : focus mode / toggle sidebar
   - ? : ouvre modal aide
   - Escape : ferme modals ouverts
*/
(function () {
  'use strict';

  var GOTO = {
    d: '/v30/dashboard',
    p: '/v30/prospects',
    e: '/v30/entreprises',
    s: '/v30/sourcing',
    f: '/v30/focus',
    u: '/v30/push',
    t: '/v30/stats'
  };

  var state = { gotoArmed: false, gotoTimer: null };

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    // Palette input
    if (el.closest && el.closest('[data-v30-palette]')) return true;
    return false;
  }

  function showGotoHint() {
    var el = document.querySelector('[data-v30-goto-hint]');
    if (el) el.classList.add('is-visible');
  }
  function hideGotoHint() {
    var el = document.querySelector('[data-v30-goto-hint]');
    if (el) el.classList.remove('is-visible');
  }

  function armGoto() {
    state.gotoArmed = true;
    showGotoHint();
    clearTimeout(state.gotoTimer);
    state.gotoTimer = setTimeout(function () {
      state.gotoArmed = false;
      hideGotoHint();
    }, 1500);
  }

  function cancelGoto() {
    state.gotoArmed = false;
    hideGotoHint();
    clearTimeout(state.gotoTimer);
  }

  function toggleSidebar() {
    var shell = document.querySelector('.v30-app-shell');
    if (shell) shell.classList.toggle('is-focus');
  }

  function toggleTheme() {
    var cur = document.documentElement.dataset.theme || 'dark';
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (_) {}
  }

  // ─── Help modal ──────────────────────────────────────────
  function openHelp() {
    var bd = document.querySelector('[data-v30-help-backdrop]');
    var m = document.querySelector('[data-v30-help]');
    if (!m) return;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('is-open');
    if (bd) bd.classList.add('is-visible');
  }
  function closeHelp() {
    var bd = document.querySelector('[data-v30-help-backdrop]');
    var m = document.querySelector('[data-v30-help]');
    if (!m) return;
    m.classList.remove('is-open');
    if (bd) bd.classList.remove('is-visible');
    setTimeout(function () { m.hidden = true; }, 200);
  }

  function bindHelpModal() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-help-close]')) closeHelp();
      if (e.target.matches('[data-v30-help-backdrop]')) closeHelp();
    });
  }

  // ─── Global key handler ──────────────────────────────────
  function onKeyDown(e) {
    // Ne pas intercepter si on tape dans un champ
    if (isTypingTarget(e.target)) {
      // Exception : Escape ferme les modals même dans un input
      if (e.key === 'Escape') {
        closeHelp();
      }
      return;
    }

    // ⌘B : focus mode
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Ignorer les autres combinaisons avec modifier (sauf Shift pour T)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Escape ferme tous les modals ouverts
    if (e.key === 'Escape') {
      closeHelp();
      cancelGoto();
      return;
    }

    // "/" ouvre la palette
    if (e.key === '/') {
      e.preventDefault();
      if (window.ProspPalette) window.ProspPalette.open();
      return;
    }

    // "?" ouvre l'aide
    if (e.key === '?') {
      e.preventDefault();
      openHelp();
      return;
    }

    // "[" toggle sidebar
    if (e.key === '[') {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // Shift+T bascule thème
    if (e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      toggleTheme();
      return;
    }

    // "C" ouvre la palette (menu Créer en haut)
    if (e.key === 'c' || e.key === 'C') {
      if (!state.gotoArmed) {
        e.preventDefault();
        if (window.ProspPalette) window.ProspPalette.open();
        return;
      }
    }

    // Goto chain
    if (state.gotoArmed) {
      var k = (e.key || '').toLowerCase();
      if (GOTO[k]) {
        e.preventDefault();
        cancelGoto();
        window.location.href = GOTO[k];
        return;
      }
      // Toute autre touche annule
      cancelGoto();
      return;
    }

    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      armGoto();
      return;
    }
  }

  function init() {
    bindHelpModal();
    document.addEventListener('keydown', onKeyDown);
    // Restore focus mode depuis localStorage
    try {
      if (localStorage.getItem('v30_focus_mode') === '1') {
        var shell = document.querySelector('.v30-app-shell');
        if (shell) shell.classList.add('is-focus');
      }
    } catch (_) {}
    // Persist focus mode à chaque toggle
    var shell = document.querySelector('.v30-app-shell');
    if (shell) {
      var obs = new MutationObserver(function () {
        try {
          localStorage.setItem('v30_focus_mode', shell.classList.contains('is-focus') ? '1' : '0');
        } catch (_) {}
      });
      obs.observe(shell, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
