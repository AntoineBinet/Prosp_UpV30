/* ProspUp v30 — Rattrapage de push : bouton flottant « Suivant ».
   Apparait sur une fiche prospect UNIQUEMENT si on y est arrive via le
   tirage aleatoire de l'objectif « push » du jour (URL ?push=rattrapage).
   Un clic tire un autre prospect eligible au hasard, sans jamais
   reproposer ceux deja vus pendant la session de rattrapage. */
(function () {
  'use strict';

  var fp = document.querySelector('[data-v30-fp]');
  if (!fp) return;

  // Garde stricte : pas de bouton hors d'une arrivee « rattrapage de push ».
  var params = new URLSearchParams(window.location.search);
  if (params.get('push') !== 'rattrapage') return;

  if (document.querySelector('.v30-pr-fab')) return;

  var CURRENT_PID = Number(fp.dataset.prospectId || 0);
  if (!CURRENT_PID) return;

  var SEEN_KEY = 'prospup:pushRattrapageSeen';
  var FLASH_KEY = 'prospup:pushRattrapageFlash';

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function getSeen() {
    try {
      var arr = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]');
      return Array.isArray(arr)
        ? arr.filter(function (n) { return typeof n === 'number' && n > 0; })
        : [];
    } catch (e) { return []; }
  }
  function setSeen(arr) {
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(arr)); } catch (e) { /* quota / prive */ }
  }

  // Toast relaye depuis la page precedente : un toast ne survit pas a une
  // navigation, on le stocke avant de naviguer puis on l'affiche ici.
  try {
    var flash = sessionStorage.getItem(FLASH_KEY);
    if (flash) { sessionStorage.removeItem(FLASH_KEY); toast(flash, 'info'); }
  } catch (e) { /* ignore */ }

  // Le prospect courant est toujours « vu » (refresh / URL ouverte a la main).
  var seen = getSeen();
  if (seen.indexOf(CURRENT_PID) === -1) { seen.push(CURRENT_PID); setSeen(seen); }

  function go(pid) {
    window.location.href = '/v30/prospect/' + pid + '?push=rattrapage';
  }

  function fetchIds(excludeList) {
    var url = '/api/prospects/quick-filter?preset=push_ready'
      + '&exclude=' + encodeURIComponent(excludeList.join(','));
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  var btn;
  var busy = false;

  function release() {
    busy = false;
    if (btn) { btn.classList.remove('is-loading'); btn.disabled = false; }
  }

  function pickNext() {
    if (busy) return;
    busy = true;
    btn.classList.add('is-loading');
    btn.disabled = true;

    // Toujours exclure la fiche courante, meme si sessionStorage est indispo.
    var current = getSeen();
    if (current.indexOf(CURRENT_PID) === -1) current.push(CURRENT_PID);
    fetchIds(current).then(function (res) {
      if (res && res.ok && res.ids && res.ids.length) {
        var next = res.ids[0];
        current.push(next);
        setSeen(current);
        go(next);
        return;
      }
      // Plus aucun prospect en excluant tous les vus : tour complet.
      if (current.length > 1) {
        // On reboucle pour un nouveau tour, en excluant juste la fiche courante.
        return fetchIds([CURRENT_PID]).then(function (r2) {
          if (r2 && r2.ok && r2.ids && r2.ids.length) {
            var nid = r2.ids[0];
            setSeen([CURRENT_PID, nid]);
            try {
              sessionStorage.setItem(FLASH_KEY, 'Tu as parcouru tous les prospects éligibles — nouveau tour.');
            } catch (e) { /* ignore */ }
            go(nid);
          } else {
            toast('C\'est le seul prospect éligible au push pour le moment.', 'info');
            release();
          }
        });
      }
      toast('C\'est le seul prospect éligible au push pour le moment.', 'info');
      release();
    }).catch(function () {
      toast('Erreur lors du tirage aléatoire', 'error');
      release();
    });
  }

  // Logo « aleatoire » : un de a cinq points.
  var DICE = '<svg class="v30-pr-fab__icon" viewBox="0 0 24 24" width="18" height="18" '
    + 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="3" y="3" width="18" height="18" rx="4"/>'
    + '<circle cx="8.5" cy="8.5" r="1.45" fill="currentColor" stroke="none"/>'
    + '<circle cx="15.5" cy="8.5" r="1.45" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none"/>'
    + '<circle cx="8.5" cy="15.5" r="1.45" fill="currentColor" stroke="none"/>'
    + '<circle cx="15.5" cy="15.5" r="1.45" fill="currentColor" stroke="none"/>'
    + '</svg>';

  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'v30-pr-fab';
  btn.setAttribute('aria-label', 'Proposer un autre prospect a pousser, tire au hasard');
  btn.setAttribute('title', 'Tirer un autre prospect au hasard');
  btn.innerHTML = DICE + '<span class="v30-pr-fab__label">Suivant</span>';
  btn.addEventListener('click', pickNext);

  document.body.appendChild(btn);
})();
