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
    jobs: [],
    crmJobs: [],
    crmMeta: {},
    hasRealSource: false,
    activeSources: []
  };
  var ARTICLES_LIMIT = 9;
  var CRM_LIMIT = 20;

  // ─── DOM ──────────────────────────────────────────────────
  var $region = document.querySelector('[data-v30-region]');
  var $refresh = document.querySelector('[data-v30-actus-refresh]');
  var $pinDefault = document.querySelector('[data-v30-actus-pin-default]');
  var $status = document.querySelector('[data-v30-actus-status]');
  var $articles = document.querySelector('[data-v30-articles]');
  var $articlesEmpty = document.querySelector('[data-v30-articles-empty]');
  var $jobs = document.querySelector('[data-v30-jobs]');
  var $jobsEmpty = document.querySelector('[data-v30-jobs-empty]');
  var $crmJobs = document.querySelector('[data-v30-crm-jobs]');
  var $crmEmpty = document.querySelector('[data-v30-crm-empty]');
  var $crmCount = document.querySelector('[data-v30-crm-count]');
  var $crmSub = document.querySelector('[data-v30-crm-sub]');
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

  // Factory : construit le HTML d'une seule carte d'offre.
  // `opts.crmBadge` = true pour afficher le tag entreprise CRM matchée.
  function jobCardHTML(j, opts) {
    opts = opts || {};
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
    // Tag entreprise CRM (cliquable vers la fiche entreprise)
    var crmTag = '';
    if (opts.crmBadge && j.matched_company) {
      var mc = j.matched_company;
      var label = mc.groupe + (mc.site ? ' · ' + mc.site : '');
      var pCount = mc.prospects_count
        ? ' (' + mc.prospects_count + ' prospect' + (mc.prospects_count > 1 ? 's' : '') + ')'
        : '';
      crmTag = '<span class="actus-job__crm-tag" title="Entreprise présente dans votre CRM">'
             + '★ <a href="/v30/entreprises#company-' + esc(String(mc.id)) + '">'
             + esc(label) + '</a>' + esc(pCount)
             + '</span>';
    }
    return ''
      + '<article class="actus-job" data-job-id="' + esc(String(j.id)) + '">'
      +   '<div class="actus-job__main">'
      +     '<h3 class="actus-job__title">' + titleHTML + '</h3>'
      +     '<div class="actus-job__meta">' + meta.join(' · ') + ' · <span class="actus-card__date">' + esc(fmtRelativeDate(j.posted_at || j.fetched_at)) + '</span></div>'
      +     (crmTag ? '<div class="actus-job__tags">' + crmTag + '</div>' : '')
      +     (j.description ? '<p class="actus-job__desc">' + esc(j.description) + '</p>' : '')
      +     (tags ? '<div class="actus-job__tags">' + tags + '</div>' : '')
      +   '</div>'
      +   '<div class="actus-job__side">'
      +     pill
      +     '<button type="button" class="' + favClass + '" data-v30-fav="' + esc(String(j.id)) + '" aria-label="Sauvegarder cette offre">' + favLabel + '</button>'
      +   '</div>'
      + '</article>';
  }

  function renderJobs() {
    if (!STATE.jobs.length) {
      $jobs.innerHTML = '';
      $jobsEmpty.hidden = false;
      if (STATE.view === 'favoris') {
        $jobsEmpty.innerHTML = 'Aucun favori. Marquez des offres avec ★ pour les retrouver ici.';
      } else if (!STATE.hasRealSource) {
        // Aucune source utilisateur configurée → CTA explicite vers Paramètres.
        $jobsEmpty.innerHTML = ''
          + '<div style="display:flex;flex-direction:column;gap:10px;align-items:center;">'
          +   '<div><strong>Aucune source d\'annonces configurée.</strong></div>'
          +   '<div class="muted">Pour afficher des offres réelles, configurez Adzuna (gratuit, 1 000 appels/mois) ou Jobfly.</div>'
          +   '<a class="btn btn-accent" href="/v30/parametres?card=actus-sources">'
          +     '⚙ Configurer dans Paramètres'
          +   '</a>'
          + '</div>';
      } else {
        $jobsEmpty.innerHTML = 'Aucune offre pour ces filtres. Élargissez la région ou retirez un filtre contrat.';
      }
      return;
    }
    $jobsEmpty.hidden = true;
    $jobs.innerHTML = STATE.jobs.map(function (j) { return jobCardHTML(j); }).join('');
  }

  function renderCrmJobs() {
    if (!$crmJobs) return;
    var items = STATE.crmJobs || [];
    var meta = STATE.crmMeta || {};
    // Badge counter
    if ($crmCount) {
      if (items.length) {
        $crmCount.hidden = false;
        $crmCount.textContent = items.length + ' offre' + (items.length > 1 ? 's' : '')
          + ' · ' + (meta.companies_count || 0) + ' entreprise' + ((meta.companies_count || 0) > 1 ? 's' : '');
      } else {
        $crmCount.hidden = true;
      }
    }
    // Subtitle context
    if ($crmSub) {
      if (meta.total_companies != null && meta.total_companies > 0) {
        $crmSub.textContent = 'Cross-référence sur ' + meta.total_companies
          + ' entreprise' + (meta.total_companies > 1 ? 's' : '') + ' de votre CRM.';
      }
    }
    if (!items.length) {
      $crmJobs.innerHTML = '';
      if ($crmEmpty) {
        $crmEmpty.hidden = false;
        if (!meta.total_companies) {
          $crmEmpty.innerHTML = 'Aucune entreprise dans votre CRM. '
            + '<a href="/v30/entreprises">Ajoutez-en</a> pour activer le matching.';
        } else if (!STATE.hasRealSource) {
          $crmEmpty.innerHTML = ''
            + '<div style="display:flex;flex-direction:column;gap:8px;align-items:center;">'
            +   '<div>Aucune annonce dans le cache pour vos <strong>' + meta.total_companies
            +   ' entreprise' + (meta.total_companies > 1 ? 's' : '') + '</strong>.</div>'
            +   '<div class="muted">Configurez Adzuna ou Jobfly pour alimenter le cache avec des offres réelles.</div>'
            +   '<a class="btn btn-accent btn-sm" href="/v30/parametres?card=actus-sources">'
            +     '⚙ Configurer dans Paramètres'
            +   '</a>'
            + '</div>';
        } else {
          $crmEmpty.innerHTML = 'Aucune annonce trouvée pour les ' + meta.total_companies
            + ' entreprise' + (meta.total_companies > 1 ? 's' : '')
            + ' de votre CRM dans le cache actuel. Élargissez la région ou attendez le prochain refresh.';
        }
      }
      return;
    }
    if ($crmEmpty) $crmEmpty.hidden = true;
    $crmJobs.innerHTML = items.map(function (j) { return jobCardHTML(j, { crmBadge: true }); }).join('');
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

  function loadCrmJobs() {
    if (!$crmJobs) return Promise.resolve();
    var url = '/api/actus/jobs/crm?region=' + encodeURIComponent(STATE.region)
            + '&limit=' + CRM_LIMIT;
    return fetchJSON(url).then(function (r) {
      STATE.crmJobs = r.items || [];
      STATE.crmMeta = {
        companies_count: r.companies_count || 0,
        matched_count: r.matched_count || 0,
        total_companies: r.total_companies || 0
      };
      renderCrmJobs();
    }).catch(function (e) {
      STATE.crmJobs = [];
      STATE.crmMeta = {};
      renderCrmJobs();
      // Erreur silencieuse pour ne pas couvrir l'erreur principale de loadJobs.
      console.warn('actus crm jobs:', e.message);
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
      STATE.hasRealSource = !!r.has_real_source;
      STATE.activeSources = r.active_sources || [];

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
        Promise.all([loadArticles(), loadCrmJobs(), loadJobs(), loadStatus()]).then(function () {
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
      // Met à jour le state local dans les deux sections (un job peut
      // figurer à la fois dans Toutes les offres et dans CRM).
      var jAll = STATE.jobs.find(function (x) { return String(x.id) === String(jobId); });
      if (jAll) jAll.is_favori = !!r.on;
      var jCrm = STATE.crmJobs.find(function (x) { return String(x.id) === String(jobId); });
      if (jCrm) jCrm.is_favori = !!r.on;
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
        loadCrmJobs();
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
    // Délégation pour les boutons favoris (les jobs sont re-rendus à chaque load).
    // On bind sur les deux sections : toutes les offres ET CRM.
    [$jobs, $crmJobs].forEach(function (container) {
      if (!container) return;
      container.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-v30-fav]');
        if (!btn) return;
        e.preventDefault();
        var jobId = btn.getAttribute('data-v30-fav');
        toggleFavori(jobId, btn);
      });
    });
  }

  // ─── Boot ─────────────────────────────────────────────────
  function init() {
    bind();
    // loadStatus en premier : il peut modifier STATE.region en fonction de
    // la config serveur (si aucun choix utilisateur n'est en localStorage).
    loadStatus().then(function () {
      return Promise.all([loadArticles(), loadCrmJobs(), loadJobs()]);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
