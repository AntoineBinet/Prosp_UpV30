/* ProspUp v30 — Phone picker (choix numéro multi-tel)
 * ---------------------------------------------------------------
 * Exposé en global : window.v30PhonePicker(rawTel, { prospectId })
 *
 * Usage — depuis n'importe quelle page v30 qui charge ce fichier :
 *   if (window.v30PhonePicker) {
 *     window.v30PhonePicker(p.telephone, { prospectId: p.id });
 *   }
 *
 * Si un seul numéro est détecté : ouvre `tel:` directement.
 * Si plusieurs : affiche une petite modale avec un bouton par numéro.
 * Loggue l'appel via /api/prospect/log-call dès qu'un numéro est choisi.
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.v30PhonePicker) return;

  // --- Extraction des numéros (reprend la logique de app.js legacy) ---
  function extractPhoneNumbers(raw) {
    if (!raw) return [];
    var matches = String(raw).match(/\+?\d[\d\s().-]{6,}\d/g);
    if (!matches) return [];
    var cleaned = matches.map(function (s) {
      return s.trim().replace(/\s+/g, ' ');
    });
    // dédoublonnage
    var seen = {};
    var out = [];
    cleaned.forEach(function (s) {
      if (!seen[s]) { seen[s] = 1; out.push(s); }
    });
    return out;
  }
  function normalizeTelForLink(phone) {
    var p = String(phone || '').trim();
    var plus = p.charAt(0) === '+';
    p = p.replace(/[^\d]/g, '');
    return plus ? ('+' + p) : p;
  }

  function logCall(prospectId) {
    if (!prospectId) return;
    try {
      fetch('/api/prospect/log-call', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ prospect_id: Number(prospectId) })
      }).catch(function () {});
    } catch (_) {}
  }

  // --- DOM helpers ---
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }

  function ensureModal() {
    var existing = document.getElementById('v30-phone-picker');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'v30-phone-picker';
    wrap.className = 'v30-modal-bd';
    wrap.setAttribute('data-v30-pp-modal', 'phone-picker');
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="v30-modal" role="dialog" aria-modal="true" aria-labelledby="v30-phone-picker-title">' +
        '<div class="v30-modal__head">' +
          '<h2 class="v30-modal__title" id="v30-phone-picker-title">Choisir un numéro</h2>' +
          '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-v30-pp-close aria-label="Fermer">×</button>' +
        '</div>' +
        '<div class="v30-modal__body">' +
          '<p class="muted" style="margin:0 0 8px;font-size:12.5px;">Plusieurs numéros sont disponibles pour ce prospect.</p>' +
          '<div class="v30-phone-picker__list" data-v30-pp-list></div>' +
        '</div>' +
        '<div class="v30-modal__foot">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-pp-close>Annuler</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    // close handlers
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { close(wrap); return; }
      if (e.target.closest('[data-v30-pp-close]')) { close(wrap); }
    });
    return wrap;
  }

  function open(wrap) {
    wrap.hidden = false;
    // Force reflow to allow CSS transition
    void wrap.offsetWidth;
    wrap.classList.add('is-open');
    // Escape handler
    var onKey = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(wrap); }
    };
    document.addEventListener('keydown', onKey);
    wrap.__v30PpKey = onKey;
  }
  function close(wrap) {
    wrap.classList.remove('is-open');
    if (wrap.__v30PpKey) {
      document.removeEventListener('keydown', wrap.__v30PpKey);
      wrap.__v30PpKey = null;
    }
    setTimeout(function () { wrap.hidden = true; }, 180);
  }

  // --- Public API ---
  window.v30PhonePicker = function (rawTel, opts) {
    opts = opts || {};
    var prospectId = opts.prospectId || null;
    var phones = extractPhoneNumbers(rawTel);

    // Fallback : rien trouvé → on tente direct
    if (phones.length === 0) {
      if (rawTel) window.location.href = 'tel:' + normalizeTelForLink(rawTel);
      return;
    }
    if (phones.length === 1) {
      logCall(prospectId);
      window.location.href = 'tel:' + normalizeTelForLink(phones[0]);
      return;
    }

    var wrap = ensureModal();
    var list = wrap.querySelector('[data-v30-pp-list]');
    list.innerHTML = '';
    phones.forEach(function (p, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary v30-phone-picker__btn';
      btn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M22 17v3a2 2 0 0 1-2 2 19 19 0 0 1-17-17 2 2 0 0 1 2-2h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2z"/></svg>' +
        '<span>' + esc(p) + '</span>';
      btn.addEventListener('click', function () {
        close(wrap);
        logCall(prospectId);
        // léger delay pour laisser la modale se fermer avant la nav tel:
        setTimeout(function () {
          window.location.href = 'tel:' + normalizeTelForLink(p);
        }, 60);
      });
      list.appendChild(btn);
      if (idx === 0) {
        requestAnimationFrame(function () { try { btn.focus(); } catch (_) {} });
      }
    });
    open(wrap);
  };

  // --- Helper : intercepte les clics sur <a href="tel:..."> avec data-v30-tel-multi ---
  // Les pages peuvent taguer leurs liens avec `data-v30-tel-multi="<raw_tel>"`
  // et `data-v30-tel-pid="<prospect_id>"` pour déclencher le picker.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-v30-tel-multi]');
    if (!a) return;
    var raw = a.getAttribute('data-v30-tel-multi') || '';
    var pid = a.getAttribute('data-v30-tel-pid') || null;
    var phones = extractPhoneNumbers(raw);
    if (phones.length <= 1) return; // laisser le href tel: standard faire son boulot
    e.preventDefault();
    e.stopPropagation();
    window.v30PhonePicker(raw, { prospectId: pid });
  }, true);
})();
