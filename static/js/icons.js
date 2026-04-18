/**
 * Prosp'Up — Système d'icônes SVG unifié
 * -----------------------------------------------------------
 * Priorité d'affichage pour chaque <i data-icon="X"> :
 *   1. Fichier  /icons/X.svg  (dossier icons/ à la racine — déposez vos SVG là)
 *   2. Tracé inline ICON_PATHS  (intégré — fonctionne sans fichier)
 *   3. Emoji EMOJI_FALLBACK  (secours absolu)
 *
 * Usage HTML :
 *   <i data-icon="phone"></i>
 *   <i data-icon="users" data-size="20"></i>
 *   <button aria-label="Appeler"><i data-icon="phone"></i></button>
 *
 * Usage JS :
 *   el.innerHTML = icon('phone', { size: 16 });
 *   renderIcons();           // balaie tout le document
 *   renderIcons(container);  // balaie un sous-arbre
 *
 * Pour ajouter une icône personnalisée :
 *   Déposez  icons/<nom>.svg  à la racine du projet.
 *   Voir  icons/NOMMAGE.txt  pour la liste complète des noms.
 */

// ── 1. Tracés SVG intégrés (fallback si pas de fichier) ───────────
var ICON_PATHS = {
  // Navigation
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  users:     '<circle cx="9" cy="7" r="4"/><path d="M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="7" r="3"/><path d="M22 21c0-2.7-2.2-5-5-5"/>',
  building:  '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>',
  target:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  calendar:  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  collab:    '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M21 21v-2a4 4 0 0 0-3-3.9"/>',
  chart:     '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-6"/>',
  send:      '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  file:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 14h6M9 18h4"/>',
  archive:   '<rect x="2" y="3" width="20" height="5"/><path d="M4 8v13h16V8M10 12h4"/>',
  settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  home:      '<path d="M3 10l9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"/>',

  // Actions
  phone:     '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail:      '<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
  clock:     '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  plus:      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check:     '<polyline points="20 6 9 17 4 12"/>',
  checkCircle:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  x:         '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  xCircle:   '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  search:    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  filter:    '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload:    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  edit:      '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash:     '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy:      '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  more:      '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  moreH:     '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chevronL:  '<polyline points="15 18 9 12 15 6"/>',
  chevronR:  '<polyline points="9 18 15 12 9 6"/>',
  chevronD:  '<polyline points="6 9 12 15 18 9"/>',
  chevronU:  '<polyline points="18 15 12 9 6 15"/>',
  external:  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  link:      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',

  // Statuts / Feedback
  alert:     '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  alertTri:  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  info:      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  star:      '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  bell:      '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  flag:      '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',

  // Social / liens
  linkedin:  '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  note:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',

  // Modes d'affichage
  list:      '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  grid:      '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  cards:     '<rect x="3" y="6" width="18" height="12" rx="2"/>',
};

// ── 2. Emojis de secours (affichés si aucun SVG disponible) ───────
var EMOJI_FALLBACK = {
  dashboard:   '📊', users:      '👥', building:  '📍',
  target:      '🎯', search:     '🧲', calendar:  '📅',
  chart:       '📈', file:       '📋', settings:  '⚙️',
  send:        '📤', archive:    '📁', more:      '⋮',
  download:    '💾', alertTri:   '❓', collab:    '👥',
  plus:        '➕', edit:       '✏️', trash:     '🗑️',
  check:       '✔',  checkCircle:'✅', x:         '✕',
  xCircle:     '✕',  clock:      '🔄', filter:    '⚙️',
  upload:      '📥', phone:      '📞', mail:      '📧',
  linkedin:    '🔗', note:       '📝', copy:      '📋',
  external:    '🧭', link:       '🔗', chevronL:  '←',
  chevronR:    '→',  chevronD:   '▾',  chevronU:  '▴',
  moreH:       '···', list:      '☰',  grid:      '▦',
  cards:       '🃏', alert:      '⚠️', info:      '👁',
  star:        '⭐', bell:       '🔔', flag:      '🚩',
  home:        '🏠',
};

// ── 3. Cache de disponibilité fichiers (évite les re-requêtes) ────
// true  = fichier présent  |  false = absent  |  undefined = inconnu
var _svgFileCache = {};

// ── Helpers internes ──────────────────────────────────────────────
function _inlineSVG(name, size, cls) {
  var path = ICON_PATHS[name];
  if (!path) return '';
  return '<svg class="icon ' + (cls || '') + '" width="' + size + '" height="' + size + '"' +
         ' viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
         ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' +
         ' aria-hidden="true">' + path + '</svg>';
}

function _emojiSpan(name) {
  var e = EMOJI_FALLBACK[name];
  return e ? '<span class="icon-emoji" aria-hidden="true">' + e + '</span>' : '';
}

function _fileSVGImg(name, size) {
  return '<img src="/icons/' + name + '.svg" class="icon icon-file" width="' + size +
         '" height="' + size + '" aria-hidden="true"' +
         ' style="display:inline;vertical-align:middle;opacity:.9">';
}

// ── 4. Rendu d'une icône (string) ─────────────────────────────────
/**
 * Rend une icône sous forme de string SVG inline (ou emoji en dernier recours).
 * N'effectue PAS de probe réseau — toujours synchrone.
 * Pour les icônes avec fichier, préférez renderIcons() qui upgrades en arrière-plan.
 */
function icon(name, opts) {
  var size = (opts && opts.size) || 16;
  var cls  = (opts && opts.cls)  || '';
  if (_svgFileCache[name] === true) return _fileSVGImg(name, size);
  if (ICON_PATHS[name])             return _inlineSVG(name, size, cls);
  return _emojiSpan(name);
}

// ── 5. renderIcons() — remplace <i data-icon> dans un sous-arbre ──
/**
 * Balaie root et remplace chaque <i data-icon="X"> par son rendu.
 * Affiche immédiatement le SVG inline (ou emoji), puis probe en
 * arrière-plan si un fichier /icons/X.svg existe ; si oui, upgrade.
 * @param {Element|Document} root
 */
function renderIcons(root) {
  root = root || document;
  root.querySelectorAll('i[data-icon]').forEach(function (el) {
    var name = el.dataset.icon;
    var size = parseInt(el.dataset.size, 10) || 16;
    var cls  = el.dataset.cls || '';

    // Rendu immédiat (synchrone) ─────────────────────────────────
    var immediate;
    if (_svgFileCache[name] === true) {
      // Fichier connu présent
      immediate = _fileSVGImg(name, size);
    } else if (ICON_PATHS[name]) {
      // SVG inline disponible
      immediate = _inlineSVG(name, size, cls);
    } else {
      // Secours emoji
      immediate = _emojiSpan(name);
    }

    // Insérer un placeholder récupérable pour l'upgrade async
    var placeholder = document.createElement('span');
    placeholder.className = 'icon-placeholder';
    placeholder.setAttribute('data-icon-name', name);
    placeholder.setAttribute('data-icon-size', size);
    placeholder.innerHTML = immediate;
    el.replaceWith(placeholder);

    // Probe fichier en arrière-plan (sauf si déjà connu) ─────────
    if (_svgFileCache[name] === undefined && ICON_PATHS[name]) {
      // Fichier inconnu ET on a déjà un inline → probe silencieuse
      _probeFile(name);
    } else if (_svgFileCache[name] === undefined && !ICON_PATHS[name]) {
      // Pas d'inline → probe obligatoire pour tenter le fichier
      _probeFileAndUpgrade(name, size);
    }
  });
}

// Probe silencieuse — met à jour le cache, n'upgrade pas le DOM actuel
// (les prochains appels à renderIcons utiliseront le cache)
function _probeFile(name) {
  var img = new Image();
  img.onload  = function () { _svgFileCache[name] = true; };
  img.onerror = function () { _svgFileCache[name] = false; };
  img.src = '/icons/' + name + '.svg?' + Date.now();
}

// Probe + upgrade DOM : utilisé quand aucun inline n'est disponible
function _probeFileAndUpgrade(name, size) {
  var img = new Image();
  img.onload = function () {
    _svgFileCache[name] = true;
    // Remplacer tous les placeholders de cette icône dans la page
    document.querySelectorAll('.icon-placeholder[data-icon-name="' + name + '"]')
      .forEach(function (ph) {
        var s = parseInt(ph.dataset.iconSize, 10) || size;
        ph.innerHTML = _fileSVGImg(name, s);
      });
  };
  img.onerror = function () { _svgFileCache[name] = false; };
  img.src = '/icons/' + name + '.svg?' + Date.now();
}

// ── 6. Auto-run & exposition globale ─────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { renderIcons(); });
} else {
  renderIcons();
}

window.icon        = icon;
window.renderIcons = renderIcons;
