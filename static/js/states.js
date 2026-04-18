/**
 * Prosp'Up — Helpers pour les états empty / loading / error
 * -----------------------------------------------------------
 * Tous injectent du HTML qui peut contenir des <i data-icon> — les
 * helpers appellent renderIcons() automatiquement après injection.
 *
 * Dépend de :
 *   - static/css/states.css
 *   - static/js/icons.js
 */

/**
 * Rend un état "liste vide".
 * @param {Element} el
 * @param {object} opts
 * @param {string} [opts.icon='users']   - nom d'icône (voir icons.js)
 * @param {string} opts.title
 * @param {string} opts.desc
 * @param {Array}  [opts.actions]        - [{id, label, variant, onClick}]
 */
function renderEmpty(el, opts) {
  if (!el) return;
  const iconName = opts.icon || 'users';
  const actions = opts.actions || [];

  el.innerHTML =
    '<div class="state">' +
      '<div class="state-illus"><i data-icon="' + iconName + '" data-size="56"></i></div>' +
      '<h3 class="state-title">' + escapeHtml(opts.title) + '</h3>' +
      '<p class="state-desc">' + escapeHtml(opts.desc) + '</p>' +
      (actions.length
        ? '<div class="state-actions">' +
            actions.map(function (a) {
              return '<button class="btn ' + (a.variant || 'btn-secondary') + '" ' +
                     'data-action="' + a.id + '">' + escapeHtml(a.label) + '</button>';
            }).join('') +
          '</div>'
        : '') +
    '</div>';

  if (window.renderIcons) renderIcons(el);
  actions.forEach(function (a) {
    if (!a.onClick) return;
    const btn = el.querySelector('[data-action="' + a.id + '"]');
    if (btn) btn.addEventListener('click', a.onClick);
  });
}

/**
 * Rend un état "chargement" avec skeleton.
 * @param {Element} el
 * @param {object} [opts]
 * @param {number} [opts.rows=5]  - nombre de lignes skeleton
 * @param {string} [opts.variant='rows']  - 'rows' | 'cards'
 */
function renderLoading(el, opts) {
  if (!el) return;
  opts = opts || {};
  const rows = opts.rows || 5;
  const variant = opts.variant || 'rows';
  const cls = variant === 'cards' ? 'skeleton-card' : 'skeleton-row';

  let items = '';
  for (let i = 0; i < rows; i++) {
    items += '<div class="skeleton ' + cls + '"></div>';
  }
  el.innerHTML = '<div style="padding:16px">' + items + '</div>';
}

/**
 * Rend un état "erreur" avec CTA de récupération.
 * @param {Element} el
 * @param {object} opts
 * @param {string} [opts.title='Une erreur est survenue']
 * @param {string} [opts.desc]
 * @param {string} [opts.trace]
 * @param {Function} [opts.onRetry]
 */
function renderError(el, opts) {
  if (!el) return;
  opts = opts || {};
  const title = opts.title || 'Une erreur est survenue';
  const desc = opts.desc || 'Le serveur est temporairement indisponible.';

  el.innerHTML =
    '<div class="state state-error">' +
      '<div class="state-illus"><i data-icon="alertTri" data-size="56"></i></div>' +
      '<h3 class="state-title">' + escapeHtml(title) + '</h3>' +
      '<p class="state-desc">' + escapeHtml(desc) + '</p>' +
      '<div class="state-actions">' +
        '<button class="btn btn-primary" data-retry>Réessayer</button>' +
      '</div>' +
      (opts.trace
        ? '<p class="state-error-trace">trace: ' + escapeHtml(opts.trace) + '</p>'
        : '') +
    '</div>';

  if (window.renderIcons) renderIcons(el);
  if (opts.onRetry) {
    const btn = el.querySelector('[data-retry]');
    if (btn) btn.addEventListener('click', opts.onRetry);
  }
}

// ── Utilitaires internes ─────────────────────────────────────
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Expose globalement
window.renderEmpty = renderEmpty;
window.renderLoading = renderLoading;
window.renderError = renderError;
