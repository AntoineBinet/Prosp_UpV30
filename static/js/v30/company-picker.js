/* ProspUp v30 — Company picker (autocomplete réutilisable)
 *
 * API publique :
 *   window.CompanyPicker.attachToInput(input, { onSelect, currentId, currentGroupe, currentSite })
 *     → transforme un <input> en autocomplete ; onSelect(company) appelé à chaque choix.
 *   window.CompanyPicker.openFloating(anchorEl, { onSelect, currentId })
 *     → ouvre un picker flottant ancré (prospect detail, édition en place).
 *   window.CompanyPicker.refresh()
 *     → invalide le cache des entreprises (après création hors picker).
 *
 * Chaque occurrence du picker affiche la liste filtrée des entreprises de l'utilisateur
 * et termine TOUJOURS par un bouton « Ajouter une entreprise ». Il n'est jamais possible
 * de saisir une entreprise sans choisir un élément existant ou passer par la modale
 * de création (qui appelle /api/companies/create).
 */
(function () {
  'use strict';

  var STATE = { list: null, pending: null };

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else if (type === 'error') alert(msg);
  }

  function fetchJSON(url, opts) {
    return fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }, opts || {})).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadCompanies(force) {
    if (!force && STATE.list) return Promise.resolve(STATE.list);
    if (STATE.pending) return STATE.pending;
    STATE.pending = fetchJSON('/api/companies/list')
      .then(function (res) {
        STATE.list = (res && res.companies) || [];
        STATE.pending = null;
        return STATE.list;
      })
      .catch(function (err) {
        STATE.pending = null;
        throw err;
      });
    return STATE.pending;
  }

  function filterCompanies(list, query) {
    var q = normalize(query);
    if (!q) return list.slice(0, 50);
    return list.filter(function (c) {
      return normalize(c.groupe).indexOf(q) >= 0 || normalize(c.site).indexOf(q) >= 0;
    }).slice(0, 50);
  }

  // ─── Modale « Ajouter une entreprise » ──────────────────────
  function openCreateModal(prefillGroupe, prefillSite) {
    return new Promise(function (resolve, reject) {
      var bd = document.createElement('div');
      bd.className = 'v30-cp-createbd';
      bd.innerHTML =
        '<div class="v30-cp-createbox" role="dialog" aria-modal="true" aria-label="Ajouter une entreprise">' +
          '<div class="v30-cp-createbox__head">' +
            '<h3 class="v30-cp-createbox__title">Ajouter une entreprise</h3>' +
            '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-cp-close aria-label="Fermer">×</button>' +
          '</div>' +
          '<div class="v30-cp-createbox__body">' +
            '<div class="v30-field">' +
              '<label for="v30-cp-new-groupe">Nom de l\'entreprise <span style="color:var(--danger);">*</span></label>' +
              '<input id="v30-cp-new-groupe" class="input" autocomplete="off" required>' +
            '</div>' +
            '<div class="v30-field">' +
              '<label for="v30-cp-new-site">Site / ville</label>' +
              '<input id="v30-cp-new-site" class="input" autocomplete="off" placeholder="Ex. Paris">' +
            '</div>' +
            '<p class="muted" style="font-size:11.5px;margin:4px 0 0;">Une entreprise est identifiée par son nom et son site. Si ce couple existe déjà, elle sera réutilisée.</p>' +
          '</div>' +
          '<div class="v30-cp-createbox__foot">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-cp-close>Annuler</button>' +
            '<button type="button" class="btn btn-primary btn-sm" data-cp-create>Créer</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(bd);
      var gEl = bd.querySelector('#v30-cp-new-groupe');
      var sEl = bd.querySelector('#v30-cp-new-site');
      if (gEl) gEl.value = prefillGroupe || '';
      if (sEl) sEl.value = prefillSite || '';
      setTimeout(function () { if (gEl) gEl.focus(); }, 20);

      var _done = false;
      function close(val, err) {
        if (_done) return;
        _done = true;
        bd.remove();
        document.removeEventListener('keydown', onKey);
        if (err) reject(err);
        else resolve(val); // val = company or null (cancel)
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      }
      function submit() {
        var groupe = gEl ? gEl.value.trim() : '';
        var site   = sEl ? sEl.value.trim() : '';
        if (!groupe) { toast("Nom d'entreprise requis", 'warning'); if (gEl) gEl.focus(); return; }
        var btn = bd.querySelector('[data-cp-create]');
        if (btn) btn.disabled = true;
        fetch('/api/companies/create', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ groupe: groupe, site: site })
        }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
          .then(function (o) {
            if (!o.body || !o.body.ok) throw new Error((o.body && o.body.error) || 'Création impossible');
            var co = { id: Number(o.body.id), groupe: groupe, site: site };
            // Invalide le cache pour que le prochain picker voie la nouvelle entreprise
            STATE.list = null;
            close(co);
          })
          .catch(function (err) {
            if (btn) btn.disabled = false;
            toast('Erreur : ' + err.message, 'error');
          });
      }
      bd.addEventListener('click', function (e) {
        if (e.target === bd) close(null);
        if (e.target.closest('[data-cp-close]')) close(null);
        if (e.target.closest('[data-cp-create]')) submit();
      });
      document.addEventListener('keydown', onKey);
    });
  }

  // ─── Panneau de résultats (partagé input & flottant) ────────
  function buildPanel(opts) {
    // opts: { onPick(company), onAddAnyway(query), renderFooterAdd: bool }
    var panel = document.createElement('div');
    panel.className = 'v30-cp-panel';
    panel.innerHTML =
      '<div class="v30-cp-list" data-cp-list></div>' +
      '<button type="button" class="v30-cp-add" data-cp-add>' +
        '<span class="v30-cp-add__icon">+</span>' +
        '<span class="v30-cp-add__text">Ajouter une entreprise…</span>' +
      '</button>';
    var listEl = panel.querySelector('[data-cp-list]');
    var addEl  = panel.querySelector('[data-cp-add]');
    var _activeIdx = -1;
    var _results = [];
    var _query = '';

    function render(query) {
      _query = query || '';
      return loadCompanies().then(function (all) {
        _results = filterCompanies(all || [], _query);
        if (!_results.length) {
          listEl.innerHTML = '<div class="v30-cp-empty">' +
            (_query ? 'Aucune entreprise trouvée pour « ' + esc(_query) + ' »' : 'Aucune entreprise.') +
            '</div>';
        } else {
          listEl.innerHTML = _results.map(function (c, i) {
            return '<button type="button" class="v30-cp-item" data-cp-idx="' + i + '" tabindex="-1">' +
              '<span class="v30-cp-item__groupe">' + esc(c.groupe) + '</span>' +
              (c.site ? ' <span class="v30-cp-item__site">· ' + esc(c.site) + '</span>' : '') +
            '</button>';
          }).join('');
        }
        _activeIdx = _results.length ? 0 : -1;
        highlight();
        // Met à jour le libellé du bouton ajouter
        if (addEl) {
          var label = _query
            ? 'Ajouter une entreprise « ' + _query + ' »'
            : 'Ajouter une entreprise…';
          var txt = addEl.querySelector('.v30-cp-add__text');
          if (txt) txt.textContent = label;
        }
      }).catch(function (err) {
        listEl.innerHTML = '<div class="v30-cp-empty">Erreur : ' + esc(err.message) + '</div>';
      });
    }

    function highlight() {
      listEl.querySelectorAll('.v30-cp-item').forEach(function (el, i) {
        el.classList.toggle('is-active', i === _activeIdx);
      });
    }

    function move(delta) {
      if (!_results.length) return;
      _activeIdx = (_activeIdx + delta + _results.length) % _results.length;
      highlight();
      var el = listEl.querySelector('[data-cp-idx="' + _activeIdx + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }

    function pickCurrent() {
      if (_activeIdx >= 0 && _results[_activeIdx]) {
        var co = _results[_activeIdx];
        if (typeof opts.onPick === 'function') opts.onPick(co);
        return true;
      }
      return false;
    }

    listEl.addEventListener('mousedown', function (e) {
      // mousedown pour prévenir le blur de l'input avant click
      var btn = e.target.closest('[data-cp-idx]');
      if (!btn) return;
      e.preventDefault();
      var i = Number(btn.dataset.cpIdx);
      if (isNaN(i) || !_results[i]) return;
      if (typeof opts.onPick === 'function') opts.onPick(_results[i]);
    });
    listEl.addEventListener('mousemove', function (e) {
      var btn = e.target.closest('[data-cp-idx]');
      if (!btn) return;
      var i = Number(btn.dataset.cpIdx);
      if (!isNaN(i) && i !== _activeIdx) {
        _activeIdx = i;
        highlight();
      }
    });
    addEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
    addEl.addEventListener('click', function (e) {
      e.preventDefault();
      var q = _query;
      openCreateModal(q, '').then(function (co) {
        if (!co) return;
        if (typeof opts.onPick === 'function') opts.onPick(co);
      });
    });

    return {
      el: panel,
      render: render,
      move: move,
      pickCurrent: pickCurrent,
      getResults: function () { return _results.slice(); }
    };
  }

  // ─── Attach autocomplete à un <input> ──────────────────────
  function attachToInput(input, opts) {
    opts = opts || {};
    if (!input) return;
    // Évite les doubles attach
    if (input._cpAttached) return input._cpAttached;

    // État local : sel = sélection validée courante ; last = dernière sélection valide (pour restore sur Esc/blur)
    var sel = null;
    var last = null;
    if (opts.currentId && opts.currentGroupe) {
      sel = { id: Number(opts.currentId), groupe: opts.currentGroupe || '', site: opts.currentSite || '' };
      last = sel;
      input.value = sel.groupe + (sel.site ? ' · ' + sel.site : '');
    }

    // Wrapper pour positionner le panneau
    var wrap = document.createElement('div');
    wrap.className = 'v30-cp-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('v30-cp-input');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    // Hidden input pour company_id (facilite la soumission par form)
    var hidden = null;
    if (opts.hiddenName) {
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = opts.hiddenName;
      wrap.appendChild(hidden);
      if (sel) hidden.value = String(sel.id);
    }

    var panel = buildPanel({
      onPick: function (co) {
        sel = { id: Number(co.id), groupe: co.groupe || '', site: co.site || '' };
        last = sel;
        input.value = sel.groupe + (sel.site ? ' · ' + sel.site : '');
        if (hidden) hidden.value = String(sel.id);
        close();
        if (typeof opts.onSelect === 'function') opts.onSelect(sel);
      }
    });
    wrap.appendChild(panel.el);

    function open() {
      if (panel.el.classList.contains('is-open')) return;
      panel.el.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      var q = input.value.trim();
      // Si la valeur affichée est celle sélectionnée (groupe · site), on part d'un query vide
      if (sel && input.value === (sel.groupe + (sel.site ? ' · ' + sel.site : ''))) q = '';
      panel.render(q);
    }
    function close() {
      panel.el.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      // Restauration : si pas de sélection validée mais qu'une ancienne existait, on la restaure.
      // Sinon, on vide (pas de saisie libre possible — l'utilisateur doit choisir ou ajouter).
      if (!sel && last) {
        sel = last;
        if (hidden) hidden.value = String(sel.id);
      }
      if (!sel) input.value = '';
      else input.value = sel.groupe + (sel.site ? ' · ' + sel.site : '');
    }

    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('input', function () {
      // L'utilisateur tape → on "oublie" la sélection précédente jusqu'à nouveau choix
      if (sel) {
        sel = null;
        if (hidden) hidden.value = '';
        if (typeof opts.onClear === 'function') opts.onClear();
      }
      panel.el.classList.add('is-open');
      panel.render(input.value.trim());
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(); panel.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); panel.move(-1); }
      else if (e.key === 'Enter') {
        if (panel.el.classList.contains('is-open')) {
          e.preventDefault();
          if (!panel.pickCurrent()) {
            // Rien à choisir → ouvre la modale de création avec la saisie courante
            openCreateModal(input.value.trim(), '').then(function (co) {
              if (!co) return;
              sel = { id: Number(co.id), groupe: co.groupe, site: co.site };
              input.value = sel.groupe + (sel.site ? ' · ' + sel.site : '');
              if (hidden) hidden.value = String(sel.id);
              close();
              if (typeof opts.onSelect === 'function') opts.onSelect(sel);
            });
          }
        }
      }
      else if (e.key === 'Escape') {
        if (panel.el.classList.contains('is-open')) { e.preventDefault(); close(); }
      }
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        if (document.activeElement && wrap.contains(document.activeElement)) return;
        close();
      }, 120);
    });

    var api = {
      input: input,
      getSelection: function () { return sel ? Object.assign({}, sel) : null; },
      setSelection: function (co) {
        if (!co) { sel = null; last = null; input.value = ''; if (hidden) hidden.value = ''; return; }
        sel = { id: Number(co.id), groupe: co.groupe || '', site: co.site || '' };
        last = sel;
        input.value = sel.groupe + (sel.site ? ' · ' + sel.site : '');
        if (hidden) hidden.value = String(sel.id);
      },
      clear: function () { sel = null; last = null; input.value = ''; if (hidden) hidden.value = ''; },
      close: close,
      refresh: function () { STATE.list = null; }
    };
    input._cpAttached = api;
    return api;
  }

  // ─── Picker flottant ancré (édition en place) ──────────────
  var _activeFloating = null;
  function closeFloating() {
    if (_activeFloating) {
      _activeFloating.el.remove();
      document.removeEventListener('click', _activeFloating.onOutside, true);
      document.removeEventListener('keydown', _activeFloating.onKey);
      _activeFloating = null;
    }
  }
  function openFloating(anchorEl, opts) {
    if (_activeFloating) { closeFloating(); return; }
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'v30-cp-floating';
    wrap.innerHTML =
      '<div class="v30-cp-floating__search">' +
        '<input type="text" class="v30-cp-floating__input" placeholder="Rechercher une entreprise…" autocomplete="off" spellcheck="false">' +
      '</div>';
    var input = wrap.querySelector('input');
    var panel = buildPanel({
      onPick: function (co) {
        closeFloating();
        if (typeof opts.onSelect === 'function') opts.onSelect(co);
      }
    });
    // Le panel est intégré dans le flottant (pas de wrap.v30-cp-wrap)
    panel.el.classList.add('is-open', 'v30-cp-panel--floating');
    wrap.appendChild(panel.el);

    // Position
    var rect = anchorEl.getBoundingClientRect();
    wrap.style.position = 'fixed';
    wrap.style.zIndex = '80';
    wrap.style.top = (rect.bottom + 6) + 'px';
    wrap.style.left = rect.left + 'px';
    wrap.style.minWidth = Math.max(280, rect.width) + 'px';

    document.body.appendChild(wrap);
    panel.render('');
    setTimeout(function () { input.focus(); }, 10);

    input.addEventListener('input', function () { panel.render(input.value.trim()); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); panel.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); panel.move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (!panel.pickCurrent()) {
          openCreateModal(input.value.trim(), '').then(function (co) {
            if (!co) return;
            closeFloating();
            if (typeof opts.onSelect === 'function') opts.onSelect(co);
          });
        }
      }
    });

    function onOutside(e) {
      if (!wrap.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
        closeFloating();
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') closeFloating();
    }
    setTimeout(function () {
      document.addEventListener('click', onOutside, true);
      document.addEventListener('keydown', onKey);
    }, 0);

    _activeFloating = { el: wrap, onOutside: onOutside, onKey: onKey };
  }

  window.CompanyPicker = {
    attachToInput: attachToInput,
    openFloating: openFloating,
    closeFloating: closeFloating,
    openCreateModal: openCreateModal,
    loadCompanies: loadCompanies,
    refresh: function () { STATE.list = null; }
  };
})();
