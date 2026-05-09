/* ============================================================
   ProspUp v30 — Bug Reporter
   Raccourci Ctrl+Shift+B → gèle la page, détoure tous les éléments
   cliquables en pointillés rouges. Cliquer un élément ouvre une
   modale qui POST /api/bug-reports. Le bug remonte automatiquement
   sur la toile d'araignée (/v30/sitemap → branche en rouge).
   ============================================================ */
(function () {
  'use strict';

  // Évite double-init si le script est inclus deux fois
  if (window.__BUG_REPORTER_LOADED__) return;
  window.__BUG_REPORTER_LOADED__ = true;

  const STATE = {
    active: false,
    selectedTarget: null,
    selectedSnapshot: null,
  };

  // ─── Sélecteur des éléments « cliquables » à détourer ────
  const CLICKABLE_SEL = [
    'button', 'a[href]', '[role="button"]', '[onclick]',
    'input[type="button"]', 'input[type="submit"]', 'input[type="checkbox"]',
    'input[type="radio"]', 'select', 'summary',
    '[data-action]', '[data-toggle]', '[contenteditable="true"]',
    'label[for]',
  ].join(',');

  // ─── Génère un sélecteur CSS court mais unique pour un élément ───
  function shortSelector(el) {
    if (!el || !(el instanceof Element)) return '';
    if (el.id) return '#' + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 4) {
      let part = cur.nodeName.toLowerCase();
      if (cur.classList && cur.classList.length) {
        const cls = [...cur.classList]
          .filter(c => !c.startsWith('is-') && !c.startsWith('br-'))
          .slice(0, 2)
          .join('.');
        if (cls) part += '.' + cls;
      }
      const dataAction = cur.getAttribute && cur.getAttribute('data-action');
      if (dataAction) part += '[data-action="' + dataAction + '"]';
      parts.unshift(part);
      cur = cur.parentElement;
      if (cur && cur.id) { parts.unshift('#' + cur.id); break; }
    }
    return parts.join(' > ');
  }

  // ─── Récupère le label le plus parlant pour un élément ───
  function elementLabel(el) {
    if (!el) return '';
    const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (txt && txt.length <= 80) return txt;
    if (txt) return txt.slice(0, 78) + '…';
    return (el.getAttribute('aria-label')
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || el.getAttribute('alt')
      || el.getAttribute('name')
      || el.getAttribute('href')
      || el.tagName.toLowerCase()).trim();
  }

  // ─── Détourage : ajoute la classe sur tous les éléments visibles ───
  function paintTargets() {
    const elements = document.querySelectorAll(CLICKABLE_SEL);
    let painted = 0;
    elements.forEach(el => {
      // Skip si déjà dans une modale du bug-reporter ou cachée
      if (el.closest('.br-overlay') || el.closest('.br-modal')) return;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) return;
      el.classList.add('br-target');
      painted++;
    });
    return painted;
  }

  function clearTargets() {
    document.querySelectorAll('.br-target').forEach(el => el.classList.remove('br-target'));
  }

  // ─── Création de l'overlay ────────────────────────────────
  function createOverlay() {
    const ov = document.createElement('div');
    ov.className = 'br-overlay';
    ov.innerHTML = `
      <div class="br-overlay__banner">
        <span class="br-overlay__dot"></span>
        <strong>Mode signalement actif</strong>
        <span class="br-overlay__hint">Cliquez un élément pour le marquer comme problématique · <kbd>Esc</kbd> pour quitter</span>
        <button type="button" class="br-overlay__close" aria-label="Quitter">✕</button>
      </div>
    `;
    document.body.appendChild(ov);
    ov.querySelector('.br-overlay__close').addEventListener('click', deactivate);
    return ov;
  }

  // ─── Création de la modale de signalement ─────────────────
  function openModal(target) {
    STATE.selectedTarget = target;
    STATE.selectedSnapshot = {
      label: elementLabel(target),
      selector: shortSelector(target),
      url: window.location.pathname + window.location.search,
      tag: target.tagName.toLowerCase(),
      href: target.getAttribute('href') || '',
    };
    target.classList.add('br-target--selected');

    const modal = document.createElement('div');
    modal.className = 'br-modal';
    modal.innerHTML = `
      <div class="br-modal__backdrop"></div>
      <div class="br-modal__panel" role="dialog" aria-modal="true" aria-labelledby="br-modal-title">
        <header class="br-modal__head">
          <h2 id="br-modal-title">Signaler un problème</h2>
          <button type="button" class="br-modal__close" aria-label="Fermer">✕</button>
        </header>
        <div class="br-modal__body">
          <div class="br-modal__field">
            <label>Élément concerné</label>
            <div class="br-modal__readonly">
              <strong class="br-elem-label"></strong>
              <span class="br-elem-meta mono"></span>
            </div>
          </div>
          <div class="br-modal__field">
            <label for="br-desc">Description du problème <span class="br-optional">(optionnel)</span></label>
            <textarea id="br-desc" rows="3" placeholder="Que doit-il se passer ? Que se passe-t-il à la place ?"></textarea>
          </div>
          <div class="br-modal__field br-modal__match" hidden>
            <label>Branche de la toile</label>
            <div class="br-modal__readonly br-match-info"></div>
          </div>
        </div>
        <footer class="br-modal__foot">
          <button type="button" class="br-btn br-btn--ghost" data-cancel>Annuler</button>
          <button type="button" class="br-btn br-btn--primary" data-apply>Appliquer</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.br-elem-label').textContent = STATE.selectedSnapshot.label || '(sans libellé)';
    const meta = `<${STATE.selectedSnapshot.tag}> · ${STATE.selectedSnapshot.selector}`;
    modal.querySelector('.br-elem-meta').textContent = meta;

    // Bind close/cancel/apply
    const close = () => {
      target.classList.remove('br-target--selected');
      modal.remove();
      STATE.selectedTarget = null;
      STATE.selectedSnapshot = null;
    };
    modal.querySelector('.br-modal__close').addEventListener('click', close);
    modal.querySelector('[data-cancel]').addEventListener('click', close);
    modal.querySelector('.br-modal__backdrop').addEventListener('click', close);

    modal.querySelector('[data-apply]').addEventListener('click', async () => {
      const desc = modal.querySelector('#br-desc').value.trim();
      const applyBtn = modal.querySelector('[data-apply]');
      applyBtn.disabled = true;
      applyBtn.textContent = 'Envoi…';
      try {
        const r = await fetch('/api/bug-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: STATE.selectedSnapshot.url,
            selector: STATE.selectedSnapshot.selector,
            label: STATE.selectedSnapshot.label,
            description: desc,
          }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));

        let toastMsg = `Signalement enregistré (#${j.id}).`;
        if (j.action_id) toastMsg += ` Branche : ${j.action_id}`;
        else if (j.page_id) toastMsg += ` Page : ${j.page_id} (action non identifiée)`;
        showToast(toastMsg, 'success');
        close();
        deactivate();
      } catch (e) {
        showToast('Erreur : ' + (e.message || 'envoi impossible'), 'error');
        applyBtn.disabled = false;
        applyBtn.textContent = 'Appliquer';
      }
    });

    setTimeout(() => modal.querySelector('#br-desc').focus(), 50);
  }

  // ─── Toast simple (autonome, pour ne pas dépendre du toast global) ───
  function showToast(msg, type = 'info') {
    if (window.showToast && typeof window.showToast === 'function') {
      try { window.showToast(msg, type, 4500); return; } catch (_) {}
    }
    let host = document.querySelector('.br-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'br-toast-host';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'br-toast br-toast--' + type;
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('br-toast--leave'); }, 3500);
    setTimeout(() => t.remove(), 4500);
  }

  // ─── Click handler en mode actif (capture phase pour intercepter avant) ─
  function onCaptureClick(e) {
    if (!STATE.active) return;
    if (e.target.closest('.br-overlay') || e.target.closest('.br-modal') || e.target.closest('.br-toast-host')) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Cherche le plus proche élément cliquable détouré
    const target = e.target.closest('.br-target') || e.target.closest(CLICKABLE_SEL) || e.target;
    if (target) openModal(target);
  }

  // ─── Activation / désactivation ───────────────────────────
  function activate() {
    if (STATE.active) return;
    STATE.active = true;
    document.documentElement.classList.add('br-mode-active');
    const painted = paintTargets();
    createOverlay();
    document.addEventListener('click', onCaptureClick, true);
    document.addEventListener('mousedown', onCaptureClick, true);
    showToast(`Mode signalement activé — ${painted} éléments détourés. Cliquez sur un bouton à signaler.`, 'info');
  }

  function deactivate() {
    if (!STATE.active) return;
    STATE.active = false;
    document.documentElement.classList.remove('br-mode-active');
    clearTargets();
    document.querySelectorAll('.br-overlay, .br-modal').forEach(n => n.remove());
    document.removeEventListener('click', onCaptureClick, true);
    document.removeEventListener('mousedown', onCaptureClick, true);
  }

  function toggle() {
    if (STATE.active) deactivate(); else activate();
  }

  // ─── Raccourci global Ctrl+Shift+B ────────────────────────
  document.addEventListener('keydown', function (e) {
    // Ctrl+Shift+B (ou Cmd+Shift+B sur Mac)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      toggle();
      return;
    }
    if (STATE.active && e.key === 'Escape') {
      e.preventDefault();
      deactivate();
    }
  }, true);

  // Repaint si le DOM change beaucoup pendant le mode actif (modale, dropdown…)
  let repaintTO = null;
  const observer = new MutationObserver(() => {
    if (!STATE.active) return;
    clearTimeout(repaintTO);
    repaintTO = setTimeout(() => {
      if (STATE.active) paintTargets();
    }, 200);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // API publique (pour debug ou intégration future)
  window.bugReporter = {
    activate, deactivate, toggle,
    isActive: () => STATE.active,
  };
})();
