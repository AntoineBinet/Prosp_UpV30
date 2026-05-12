/* ============================================================
   ProspUp v30 — Adaptation des raccourcis clavier par plateforme
   Sur Mac on garde le symbole ⌘. Partout ailleurs (Windows / Linux)
   on remplace ⌘ par "Ctrl" dans tous les <kbd> et .kbd, et on
   ajuste les aria-label / title qui mentionnent "Commande".
   Les handlers JS écoutent déjà metaKey || ctrlKey, donc seule
   la couche visuelle est concernée.
   ============================================================ */
(function () {
  'use strict';

  var nav = (typeof navigator !== 'undefined') ? navigator : null;
  if (!nav) return;
  var platform = (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '';
  var ua = nav.userAgent || '';
  var isMac = /Mac|iPhone|iPad|iPod/i.test(platform) || /Macintosh/i.test(ua);
  if (isMac) return;

  var CMD = '⌘';
  var REPLACEMENT = 'Ctrl';

  function rewriteKbd(el) {
    if (!el || el.dataset.kbdPlatform === '1') return;
    var txt = el.textContent;
    if (txt && txt.indexOf(CMD) !== -1) {
      // ⌘K → Ctrl+K (collé), ⌘ seul dans un nœud → Ctrl
      var next = txt.replace(/⌘\s*([A-Za-z0-9↵])/g, REPLACEMENT + '+$1');
      next = next.split(CMD).join(REPLACEMENT);
      el.textContent = next;
      el.classList.add('kbd--ctrl');
    }
    el.dataset.kbdPlatform = '1';
  }

  function rewriteAttribute(el, attr) {
    var v = el.getAttribute(attr);
    if (!v) return;
    var next = v;
    if (next.indexOf(CMD) !== -1) next = next.split(CMD).join(REPLACEMENT);
    if (/Commande \+ /i.test(next)) next = next.replace(/Commande \+ /gi, 'Ctrl + ');
    if (/\bCmd\+/i.test(next)) next = next.replace(/\bCmd\+/gi, 'Ctrl+');
    if (next !== v) el.setAttribute(attr, next);
  }

  function rewriteRoot(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll('kbd, .kbd');
    for (var i = 0; i < nodes.length; i++) rewriteKbd(nodes[i]);
    var labelled = root.querySelectorAll('[aria-label], [title]');
    for (var j = 0; j < labelled.length; j++) {
      rewriteAttribute(labelled[j], 'aria-label');
      rewriteAttribute(labelled[j], 'title');
    }
  }

  function init() {
    rewriteRoot(document.body || document.documentElement);
    if (typeof MutationObserver === 'function') {
      var mo = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          for (var k = 0; k < m.addedNodes.length; k++) {
            var node = m.addedNodes[k];
            if (node.nodeType !== 1) continue;
            if (node.matches && node.matches('kbd, .kbd')) rewriteKbd(node);
            rewriteRoot(node);
          }
        }
      });
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
