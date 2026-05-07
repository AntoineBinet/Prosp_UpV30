/* ProspUp v30 — Gestionnaire d'undo global
 * API : window.pushUndo(label, callback, opts)
 *   label    : texte court décrivant l'action (ex : "Statut → Appelé")
 *   callback : function() appelée pour annuler
 *   opts     : { silent: bool } — si true, pas de toast (appelant gère lui-même)
 * Ctrl+Z (hors champ texte) exécute le dernier callback enregistré.
 */
(function () {
  'use strict';

  var _stack = [];
  var MAX = 20;

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  window.pushUndo = function (label, callback, opts) {
    opts = opts || {};
    var entry = { label: label, callback: callback };
    _stack.push(entry);
    if (_stack.length > MAX) _stack.shift();

    if (!opts.silent && typeof window.showToast === 'function') {
      var _entry = entry;
      window.showToast(label, 'success', 5000, {
        action: {
          label: 'Annuler',
          onClick: function () {
            var idx = _stack.indexOf(_entry);
            if (idx !== -1) _stack.splice(idx, 1);
            try { _entry.callback(); } catch (e) { /* silent */ }
            if (typeof window.showToast === 'function') window.showToast('Annulé', 'info', 2000);
          }
        }
      });
    }
  };

  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (e.shiftKey) return;
    if (isTypingTarget(e.target)) return;
    if (!_stack.length) return;
    e.preventDefault();
    var action = _stack.pop();
    try { action.callback(); } catch (err) { /* silent */ }
    if (typeof window.showToast === 'function') window.showToast('Annulé : ' + action.label, 'info', 2000);
  });
})();
