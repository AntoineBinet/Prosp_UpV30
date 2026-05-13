/* ProspUp v30 — Actus (news marché du travail + offres d'emploi). */
(function () {
  'use strict';

  // ─── Helpers ──────────────────────────────────────────────
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s == null ? '' : String(s));
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function toast(msg, type, duration) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info', duration);
  }
  function fetchJSON(url, opts) {
    var o = opts || {};
    o.credentials = o.credentials || 'same-origin';
    o.headers = Object.assign({ 'Accept': 'application/json' }, o.headers || {});
    return fetch(url, o).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function postJSON(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }
  function fmtRelativeDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var diff = (Date.now() - d.getTime()) / 1000;
      if (isNaN(diff)) return '—';
      if (diff < 60) return 'à l\'instant';
      if (diff < 3600) return Math.floor(diff / 60) + ' min';
      if (diff < 86400) return Math.floor(diff / 3600) + ' h';
      if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' j';
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return iso; }
  }
  function debounce(fn, wait) {
    var tid = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(tid);
      tid = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  // ─── STATE ────────────────────────────────────────────────
  // Région : choix utilisateur (localStorage) > config serveur > fallback 'ara'
  // La config serveur est résolue au boot via /api/actus/config.
  var STATE = {
    region: localStorage.getItem('v30.actus.region') || 'ara',
    defaultRegion: 'ara',
    q: '',
    contracts: new Set(),
    sort: 'date',
    view: 'all', // 'all' | 'favoris'
    articles: [],
    jobs: []
  };
  var ARTICLES_LIMIT = 9;

  // ─── DOM ──────────────────────────────────────────────────
  var $region = document.querySelector('[data-v30-region]');
  var $refresh = document.querySelector('[data-v30-actus-refresh]');
  var $pinDefault = document.querySelector('[data-v30-actus-pin-default]');
  var $status = document.querySelector('[data-v30-actus-status]');
  var $articles = document.querySelector('[data-v30-articles]');
  var $articlesEmpty = document.querySelector('[data-v30-articles-empty]');
  var $jobs = document.querySelector('[data-v30-jobs]');
  var $jobsEmpty = document.querySelector('[data-v30-jobs-empty]');
  var $search = document.querySelector('[data-v30-jobs-search]');
  var $contractPills = Array.from(document.querySelectorAll('[data-v30-contract]'));
  var $sortBtns = Array.from(document.querySelectorAll('[data-v30-sort]'));
  var $viewBtns = Array.from(document.querySelectorAll('[data-v30-view]'));

  // ─── Rendu : articles ─────────────────────────────────────
  function renderArticles() {
    if (!STATE.articles.length) {
      $articles.innerHTML = '';
      $articlesEmpty.hidden = false;
      return;
    }
    $articlesEmpty.hidden = true;
    var html = STATE.articles.map(function (a) {
      var tags = (a.tags || []).slice(0, 3).map(function (t) {
        return '<span class="actus-tag">' + esc(t) + '</span>';
      }).join('');
      var regionLabel = a.region_hint && a.region_hint !== 'national'
        ? '<span class="actus-tag actus-tag--region">' + esc(a.region_hint.toUpperCase()) + '</span>'
        : '';
      // Image : src distant si présent, sinon placeholder typographique
      // (loading=lazy + error handler qui swap vers le placeholder pour
      // gérer les liens hotlink-protégés / 404).
      var img;
      if (a.image_url) {
        img = '<img class="actus-card__image" src="' + esc(a.image_url) + '"'
            + ' alt="" loading="lazy" referrerpolicy="no-referrer"'
            + ' onerror="this.outerHTML=&quot;<div class=\\&quot;actus-card__image-placeholder\\&quot;>'
            + esc(a.source).replace(/"/g, '\\&quot;') + '</div>&quot;">';
      } else {
        img = '<div class="actus-card__image-placeholder">' + esc(a.source) + '</div>';
      }
      return ''
        + '<a class="actus-card" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">'
        +   img
        +   '<div class="actus-card__body">'
        +     '<div class="actus-card__meta">'
        +       '<span class="actus-card__source">' + esc(a.source) + '</span>'
        +       '<span class="actus-card__date">' + esc(fmtRelativeDate(a.published_at || a.fetched_at)) + '</span>'
        +     '</div>'
        +     '<h3 class="actus-card__title">' + esc(a.title) + '</h3>'
        +     (a.summary ? '<p class="actus-card__summary">' + esc(a.summary) + '</p>' : '')
        +     '<div class="actus-card__tags">' + regionLabel + tags + '</div>'
        +   '</div>'
        + '</a>';
    }).join('');
    $articles.innerHTML = html;
  }

  // ─── Rendu : jobs ─────────────────────────────────────────
  function pillClass(contract) {
    var c = (contract || '').toLowerCase();
    if (c === 'cdi') return 'actus-pill--cdi';
    if (c === 'cdd') return 'actus-pill--cdd';
    if (c === 'stage') return 'actus-pill--stage';
    if (c === 'alternance') return 'actus-pill--alternance';
    if (c === 'freelance') return 'actus-pill--freelance';
    return '';
  }

  function renderJobs() {
    if (!STATE.jobs.length) {
      $jobs.innerHTML = '';
      $jobsEmpty.hidden = false;
      $jobsEmpty.textContent = STATE.view === 'favoris'
        ? 'Aucun favori. Marquez des offres avec ★ pour les retrouver ici.'
        : 'Aucune offre pour ces filtres. Élargissez la région ou retirez un filtre contrat.';
      return;
    }
    $jobsEmpty.hidden = true;
    var html = STATE.jobs.map(function (j) {
      var tags = (j.tags || []).slice(0, 3).map(function (t) {
        return '<span class="actus-tag">' + esc(t) + '</span>';
      }).join('');
      var meta = [];
      if (j.company) meta.push('<strong>' + esc(j.company) + '</strong>');
      if (j.location) meta.push(esc(j.location));
      if (j.salary) meta.push(esc(j.salary));
      if (j.source) meta.push('<span class="muted">via ' + esc(j.source) + '</span>');
      var titleHTML = j.url && j.url !== '#'
        ? '<a href="' + esc(j.url) + '" target="_blank" rel="noopener noreferrer">' + esc(j.title) + '</a>'
        : esc(j.title);
      var pill = j.contract_type
        ? '<span class="actus-pill ' + pillClass(j.contract_type) + '">' + esc(j.contract_type) + '</span>'
        : '';
      var favClass = j.is_favori ? 'actus-job__fav is-on' : 'actus-job__fav';
      var favLabel = j.is_favori ? '★ Favori' : '☆ Sauver';
      return ''
        + '<article class="actus-job" data-job-id="' + esc(String(j.id)) + '">'
        +   '<div class="actus-job__main">'
        +     '<h3 class="actus-job__title">' + titleHTML + '</h3>'
        +     '<div class="actus-job__meta">' + meta.join(' · ') + ' · <span class="actus-card__date">' + esc(fmtRelativeDate(j.posted_at || j.fetched_at)) + '</span></div>'
        +     (j.description ? '<p class="actus-job__desc">' + esc(j.description) + '</p>' : '')
        +     (tags ? '<div class="actus-job__tags">' + tags + '</div>' : '')
        +   '</div>'
        +   '<div class="actus-job__side">'
        +     pill
        +     '<button type="button" class="' + favClass + '" data-v30-fav="' + esc(String(j.id)) + '" aria-label="Sauvegarder cette offre">' + favLabel + '</button>'
        +   '</div>'
        + '</article>';
    }).join('');
    $jobs.innerHTML = html;
  }

  // ─── Status bar ───────────────────────────────────────────
  function updateStatus(msg, loading) {
    if (!$status) return;
    $status.textContent = msg;
    $status.classList.toggle('is-loading', !!loading);
  }

  // ─── API calls ────────────────────────────────────────────
  function loadArticles() {
    var url = '/api/actus/articles?region=' + encodeURIComponent(STATE.region)
            + '&limit=' + ARTICLES_LIMIT;
    return fetchJSON(url).then(function (r) {
      STATE.articles = r.items || [];
      renderArticles();
    }).catch(function (e) {
      toast('Impossible de charger les actus : ' + e.message, 'error');
    });
  }

  function loadJobs() {
    if (STATE.view === 'favoris') {
      return fetchJSON('/api/actus/favoris').then(function (r) {
        STATE.jobs = r.items || [];
        // Filtrage local supplémentaire pour les favoris (q + contracts)
        if (STATE.q) {
          var ql = STATE.q.toLowerCase();
          STATE.jobs = STATE.jobs.filter(function (j) {
            return (j.title || '').toLowerCase().indexOf(ql) !== -1
              || (j.company || '').toLowerCase().indexOf(ql) !== -1;
          });
        }
        if (STATE.contracts.size) {
          STATE.jobs = STATE.jobs.filter(function (j) {
            return STATE.contracts.has((j.contract_type || '').toUpperCase());
          });
        }
        renderJobs();
      }).catch(function (e) {
        toast('Impossible de charger les favoris : ' + e.message, 'error');
      });
    }
    var params = new URLSearchParams({
      region: STATE.region,
      q: STATE.q,
      sort: STATE.sort,
      limit: '80'
    });
    if (STATE.contracts.size) params.set('contract', Array.from(STATE.contracts).join(','));
    return fetchJSON('/api/actus/jobs?' + params.toString()).then(function (r) {
      STATE.jobs = r.items || [];
      renderJobs();
    }).catch(function (e) {
      toast('Impossible de charger les offres : ' + e.message, 'error');
    });
  }

  function loadStatus() {
    return fetchJSON('/api/actus/status').then(function (r) {
      // La région effective : si pas de choix utilisateur en localStorage,
      // on adopte la région par défaut servie par le backend.
      var userPick = localStorage.getItem('v30.actus.region');
      STATE.defaultRegion = r.default_region || 'ara';
      if (!userPick) STATE.region = STATE.defaultRegion;

      // Peupler le select région à partir des données serveur
      if (Array.isArray(r.regions) && $region) {
        var current = STATE.region;
        $region.innerHTML = r.regions.map(function (reg) {
          var sel = reg.id === current ? ' selected' : '';
          return '<option value="' + esc(reg.id) + '"' + sel + '>' + esc(reg.label) + '</option>';
        }).join('');
      }
      var bits = [];
      bits.push(r.articles_count + ' article' + (r.articles_count > 1 ? 's' : ''));
      bits.push(r.jobs_count + ' offre' + (r.jobs_count > 1 ? 's' : ''));
      if (r.articles_last_refresh) bits.push('dernière mise à jour : ' + fmtRelativeDate(r.articles_last_refresh));
      if (r.default_region) {
        var lbl = (r.regions || []).find(function (x) { return x.id === r.default_region; });
        bits.push('défaut : ' + (lbl ? lbl.label : r.default_region));
      }
      updateStatus(bits.join(' · '), false);
    }).catch(function () {
      updateStatus('Cache indisponible', false);
    });
  }

  function pinRegionAsDefault() {
    if (!$pinDefault) return;
    var region = STATE.region;
    $pinDefault.disabled = true;
    postJSON('/api/actus/config', { default_region: region }).then(function (r) {
      STATE.defaultRegion = r.default_region;
      toast('Région par défaut : ' + region, 'success');
      loadStatus();
    }).catch(function (e) {
      toast('Impossible de définir la région par défaut : ' + e.message, 'error');
    }).finally(function () {
      $pinDefault.disabled = false;
    });
  }

  function refresh() {
    updateStatus('Actualisation en cours…', true);
    return postJSON('/api/actus/refresh', { force: true }).then(function () {
      // Le refresh est asynchrone côté serveur. On reload après un délai
      // raisonnable pour laisser le temps aux flux RSS de répondre.
      setTimeout(function () {
        Promise.all([loadArticles(), loadJobs(), loadStatus()]).then(function () {
          toast('Actus mises à jour', 'success');
        });
      }, 3500);
    }).catch(function (e) {
      updateStatus('Erreur : ' + e.message, false);
      toast('Refresh impossible : ' + e.message, 'error');
    });
  }

  // ─── Favori toggle ────────────────────────────────────────
  function toggleFavori(jobId, btn) {
    return postJSON('/api/actus/favoris', { job_id: Number(jobId) }).then(function (r) {
      btn.classList.toggle('is-on', !!r.on);
      btn.textContent = r.on ? '★ Favori' : '☆ Sauver';
      // Met à jour le state local
      var j = STATE.jobs.find(function (x) { return String(x.id) === String(jobId); });
      if (j) j.is_favori = !!r.on;
      if (!r.on && STATE.view === 'favoris') {
        // Vue favoris : retirer la carte
        var card = btn.closest('.actus-job');
        if (card) card.remove();
      }
    }).catch(function (e) {
      toast('Favori : ' + e.message, 'error');
    });
  }

  // ─── Wiring events ────────────────────────────────────────
  function bind() {
    if ($region) {
      $region.value = STATE.region;
      $region.addEventListener('change', function () {
        STATE.region = $region.value;
        localStorage.setItem('v30.actus.region', STATE.region);
        loadArticles();
        loadJobs();
      });
    }
    if ($refresh) {
      $refresh.addEventListener('click', refresh);
    }
    if ($pinDefault) {
      $pinDefault.addEventListener('click', pinRegionAsDefault);
    }
    if ($search) {
      $search.addEventListener('input', debounce(function () {
        STATE.q = $search.value.trim();
        loadJobs();
      }, 250));
    }
    $contractPills.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-v30-contract');
        if (STATE.contracts.has(v)) {
          STATE.contracts.delete(v);
          btn.classList.remove('is-active');
        } else {
          STATE.contracts.add(v);
          btn.classList.add('is-active');
        }
        loadJobs();
      });
    });
    $sortBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        $sortBtns.forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        STATE.sort = btn.getAttribute('data-v30-sort') || 'date';
        loadJobs();
      });
    });
    $viewBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        $viewBtns.forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        STATE.view = btn.getAttribute('data-v30-view') || 'all';
        loadJobs();
      });
    });
    // Délégation pour les boutons favoris (les jobs sont re-rendus à chaque load)
    if ($jobs) {
      $jobs.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-v30-fav]');
        if (!btn) return;
        e.preventDefault();
        var jobId = btn.getAttribute('data-v30-fav');
        toggleFavori(jobId, btn);
      });
    }
  }

  // ─── Boot ─────────────────────────────────────────────────
  function init() {
    bind();
    // loadStatus en premier : il peut modifier STATE.region en fonction de
    // la config serveur (si aucun choix utilisateur n'est en localStorage).
    loadStatus().then(function () {
      return Promise.all([loadArticles(), loadJobs()]);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
