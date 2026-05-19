/* ProspUp v30 — Next Action IA (Phase 2 productivité).
   Badge passif "Prochaine action recommandée" sur :
   - Fiche prospect (/v30/prospect/<id>) — carte en haut de l'Aperçu
   - Page Focus  (/v30/focus)            — section "Top 10 suggestions IA"

   Expose window.V30NextActionAI.{mountProspectCard, mountFocusSection}
*/
(function () {
  'use strict';

  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function fetchJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok && !(data && data.error)) throw new Error('HTTP ' + r.status);
        return data;
      });
    });
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }
  function fmtDateFR(iso) {
    if (!iso) return '—';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function timeAgo(iso) {
    if (!iso) return 'jamais';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var diff = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'à l\'instant';
    if (diff < 3600) return 'il y a ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'il y a ' + Math.floor(diff / 3600) + ' h';
    return 'il y a ' + Math.floor(diff / 86400) + ' j';
  }

  // ─── Action type → label + icon + couleur ─────────────────────
  var ACTION_TYPE_META = {
    'email':    { label: 'Email',     icon: 'M',  cls: 'na-type--email' },
    'call':     { label: 'Appel',     icon: 'C',  cls: 'na-type--call' },
    'linkedin': { label: 'LinkedIn',  icon: 'L',  cls: 'na-type--linkedin' },
    'rdv':      { label: 'RDV',       icon: 'R',  cls: 'na-type--rdv' },
    'wait':     { label: 'Attendre',  icon: '·',  cls: 'na-type--wait' },
    'other':    { label: 'Action',    icon: '?',  cls: 'na-type--other' }
  };

  function typeMeta(t) { return ACTION_TYPE_META[t] || ACTION_TYPE_META.other; }

  function confidenceColor(conf) {
    var c = Number(conf) || 0;
    if (c >= 75) return 'var(--success)';
    if (c >= 50) return 'var(--accent)';
    if (c >= 25) return 'var(--warning, #c47)';
    return 'var(--text-3)';
  }

  // ─── Appliquer une action selon son type ──────────────────────
  function applySuggestion(prospect, suggestion) {
    var type = (suggestion && suggestion.action_type) || 'other';
    if (type === 'email') {
      if (window.V30PushModal && typeof window.V30PushModal.open === 'function') {
        window.V30PushModal.open(prospect.id, 'email');
      } else if (prospect.email) {
        window.location.href = 'mailto:' + encodeURIComponent(prospect.email);
      } else {
        toast('Pas d\'email pour ce prospect', 'warning');
      }
    } else if (type === 'call') {
      if (prospect.telephone) {
        window.location.href = 'tel:' + prospect.telephone.replace(/\s+/g, '');
      } else {
        toast('Pas de téléphone pour ce prospect', 'warning');
      }
    } else if (type === 'linkedin') {
      if (prospect.linkedin) {
        window.open(prospect.linkedin, '_blank', 'noopener');
      } else {
        toast('Pas de LinkedIn pour ce prospect', 'warning');
      }
    } else if (type === 'rdv') {
      window.location.href = '/v30/calendrier?prospect_id=' + prospect.id;
    } else {
      // wait / other : pas d'action 1-clic, juste ouvrir la fiche prospect
      window.location.href = '/v30/prospect/' + prospect.id;
    }
  }

  // ─── Rendu d'une suggestion (HTML) ────────────────────────────
  function renderSuggestionBody(suggestion, stale) {
    var meta = typeMeta(suggestion.action_type);
    var when = suggestion.when ? fmtDateFR(suggestion.when) : 'quand vous voulez';
    var conf = Number(suggestion.confidence) || 0;
    var staleBadge = stale
      ? '<span class="v30-na-stale" title="Suggestion datée — actualisez-la">Périmé</span>'
      : '';
    return '' +
      '<div class="v30-na-row">' +
        '<span class="v30-na-type ' + meta.cls + '" title="' + esc(meta.label) + '">' +
          esc(meta.icon) +
        '</span>' +
        '<div class="v30-na-main">' +
          '<div class="v30-na-action">' + esc(suggestion.action) + ' ' + staleBadge + '</div>' +
          '<div class="v30-na-why muted">' + esc(suggestion.why || '') + '</div>' +
          '<div class="v30-na-meta muted">' +
            '<span title="Date suggérée">' + esc(when) + '</span>' +
            ' · ' +
            '<span title="Confiance IA" style="color:' + confidenceColor(conf) + ';">' +
              'confiance ' + conf + '%' +
            '</span>' +
            ' · <span title="Modèle">' + esc(suggestion.model || 'IA') + '</span>' +
            ' · <span>' + esc(timeAgo(suggestion.generated_at)) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ─── 1) Carte sur fiche prospect ──────────────────────────────
  function mountProspectCard(rootEl) {
    if (!rootEl) return;
    var pid = Number(rootEl.dataset.prospectId);
    if (!pid) return;

    // Cherche le panneau "Aperçu" et insère la carte en tête
    var apercu = rootEl.querySelector('[data-v30-fp-panel="apercu"]');
    if (!apercu) return;

    var card = document.createElement('div');
    card.className = 'card v30-fp-na-ai';
    card.setAttribute('data-v30-na-ai', '');
    card.style.marginTop = '12px';
    card.innerHTML = '' +
      '<div class="row-sb" style="margin-bottom:8px;">' +
        '<div class="card-title" style="display:flex;align-items:center;gap:6px;">' +
          '<span class="v30-na-sparkle" aria-hidden="true">✦</span>' +
          'Prochaine action recommandée' +
        '</div>' +
        '<div style="display:flex;gap:6px;">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-v30-na-refresh title="Rafraîchir avec l\'IA">' +
            'Actualiser' +
          '</button>' +
          '<button type="button" class="btn btn-accent btn-sm" data-v30-na-apply hidden title="Appliquer l\'action recommandée">' +
            'Appliquer' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div data-v30-na-body>' +
        '<div class="empty" style="font-size:12px;color:var(--text-3);">Chargement…</div>' +
      '</div>';

    apercu.insertBefore(card, apercu.firstChild);

    var bodyEl = card.querySelector('[data-v30-na-body]');
    var refreshBtn = card.querySelector('[data-v30-na-refresh]');
    var applyBtn = card.querySelector('[data-v30-na-apply]');
    var state = { prospect: { id: pid }, suggestion: null, stale: true };

    function hydrateProspectFromHeader() {
      try {
        var h = rootEl.querySelector('[data-v30-fp-header]');
        if (!h) return;
        var meta = h.querySelector('[data-field="meta"]');
        state.prospect.name = (h.querySelector('[data-field="name"]') || {}).textContent || '';
        var tel = h.querySelector('[data-field="tel-link"]');
        if (tel && tel.href && tel.href.indexOf('tel:') === 0) {
          state.prospect.telephone = tel.href.slice(4);
        }
      } catch (_) {}
    }

    function render() {
      hydrateProspectFromHeader();
      if (!state.suggestion) {
        bodyEl.innerHTML = '<div class="v30-na-empty">' +
          '<div>Aucune suggestion en cache pour ce prospect.</div>' +
          '<div class="muted" style="font-size:11px;margin-top:4px;">' +
            'Cliquez sur <b>Actualiser</b> pour générer une recommandation.' +
          '</div></div>';
        if (applyBtn) applyBtn.hidden = true;
        return;
      }
      bodyEl.innerHTML = renderSuggestionBody(state.suggestion, state.stale);
      if (applyBtn) {
        applyBtn.hidden = false;
        var meta = typeMeta(state.suggestion.action_type);
        applyBtn.textContent = 'Appliquer · ' + meta.label;
      }
    }

    function load() {
      fetchJSON('/api/ai/next-action/' + pid).then(function (res) {
        if (!res || !res.ok) {
          state.suggestion = null;
          state.stale = true;
        } else {
          state.suggestion = res.suggestion || null;
          state.stale = !!res.stale;
        }
        render();
      }).catch(function () {
        state.suggestion = null;
        state.stale = true;
        bodyEl.innerHTML = '<div class="v30-na-empty muted">Impossible de charger la suggestion.</div>';
      });
    }

    function refresh() {
      refreshBtn.disabled = true;
      var oldHTML = refreshBtn.innerHTML;
      refreshBtn.textContent = 'Génération…';
      postJSON('/api/ai/next-action/' + pid + '/refresh', {}).then(function (res) {
        if (!res || !res.ok) {
          toast('IA : ' + ((res && res.error) || 'échec'), 'error');
          return;
        }
        state.suggestion = res.suggestion;
        state.stale = false;
        render();
        toast('Suggestion IA mise à jour', 'success');
      }).catch(function () {
        toast('Erreur réseau IA', 'error');
      }).finally(function () {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = oldHTML;
      });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    if (applyBtn) applyBtn.addEventListener('click', function () {
      // Source 1 : window.ProspFP.STATE.prospect (déjà hydraté par prospect_detail.js)
      // Source 2 : fallback fetchJSON /api/prospect/timeline
      var fp = window.ProspFP;
      if (fp && fp.STATE && fp.STATE.prospect) {
        applySuggestion(Object.assign({ id: pid }, fp.STATE.prospect), state.suggestion);
        return;
      }
      fetchJSON('/api/prospect/timeline?id=' + pid).then(function (res) {
        var prospect = Object.assign({ id: pid }, (res && res.prospect) || {});
        applySuggestion(prospect, state.suggestion);
      }).catch(function () {
        applySuggestion({ id: pid }, state.suggestion);
      });
    });

    load();
  }

  // ─── 2) Section Focus ─────────────────────────────────────────
  function mountFocusSection() {
    var section = document.querySelector('[data-v30-focus-na-ai]');
    var list = section ? section.querySelector('[data-v30-focus-na-ai-list]') : null;
    if (!section || !list) return;

    var refreshBtn = section.querySelector('[data-v30-focus-na-ai-batch]');
    var countEl = section.querySelector('[data-field="na-count"]');

    function render(items) {
      if (countEl) countEl.textContent = items.length;
      if (items.length === 0) {
        list.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">' +
          'Aucune suggestion IA active. Ouvrez une fiche prospect et cliquez sur ' +
          '<b>Actualiser</b> pour en générer.</div>';
        return;
      }
      list.innerHTML = items.map(function (it) {
        var sug = it.suggestion;
        var meta = typeMeta(sug.action_type);
        var when = sug.when ? fmtDateFR(sug.when) : '—';
        var conf = Number(sug.confidence) || 0;
        var company = it.company_name || '';
        return '<div class="v30-na-list-row" data-pid="' + it.id + '">' +
          '<a class="v30-na-list-row__main" href="/v30/prospect/' + it.id + '">' +
            '<span class="v30-na-type ' + meta.cls + '">' + esc(meta.icon) + '</span>' +
            '<div class="v30-na-list-row__info">' +
              '<div class="v30-na-list-row__name">' + esc(it.name || '—') +
                ' <span class="muted" style="font-weight:normal;font-size:11px;">' +
                  esc(company ? (' · ' + company) : '') +
                '</span>' +
              '</div>' +
              '<div class="v30-na-list-row__action">' + esc(sug.action) + '</div>' +
              '<div class="v30-na-list-row__meta muted">' +
                esc(when) + ' · ' +
                '<span style="color:' + confidenceColor(conf) + ';">' + conf + '%</span>' +
              '</div>' +
            '</div>' +
          '</a>' +
          '<button type="button" class="btn btn-sm" data-v30-na-apply-row title="Appliquer">' +
            meta.label +
          '</button>' +
        '</div>';
      }).join('');
    }

    function load() {
      fetchJSON('/api/ai/next-action/today?limit=10').then(function (res) {
        render((res && res.ok && res.items) || []);
      }).catch(function () {
        list.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Erreur de chargement.</div>';
      });
    }

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-na-apply-row]');
      if (!btn) return;
      e.preventDefault();
      var row = btn.closest('[data-pid]');
      if (!row) return;
      var pid = Number(row.dataset.pid);
      Promise.all([
        fetchJSON('/api/ai/next-action/' + pid),
        fetchJSON('/api/prospect/timeline?id=' + pid)
      ]).then(function (r) {
        var sug = r[0] && r[0].suggestion;
        var p = (r[1] && r[1].prospect) || {};
        if (!sug) { toast('Suggestion introuvable', 'warning'); return; }
        applySuggestion(Object.assign({ id: pid }, p), sug);
      }).catch(function () { toast('Erreur', 'error'); });
    });

    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      refreshBtn.disabled = true;
      var oldHTML = refreshBtn.innerHTML;
      refreshBtn.textContent = 'Génération…';
      postJSON('/api/ai/next-action/refresh-batch', { limit: 10, force: false })
        .then(function (res) {
          if (!res || !res.ok) {
            toast('Échec : ' + ((res && res.error) || 'inconnu'), 'error');
            return;
          }
          var msg = res.refreshed + ' générée(s)';
          if (res.skipped) msg += ', ' + res.skipped + ' à jour';
          if (res.failed) msg += ', ' + res.failed + ' en échec';
          toast(msg, res.failed ? 'warning' : 'success');
          load();
        })
        .catch(function () { toast('Erreur réseau IA', 'error'); })
        .finally(function () {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = oldHTML;
        });
    });

    load();
  }

  // ─── API publique ────────────────────────────────────────────
  window.V30NextActionAI = {
    mountProspectCard: mountProspectCard,
    mountFocusSection: mountFocusSection,
    applySuggestion: applySuggestion
  };

  // Auto-mount sur les pages connues
  function autoMount() {
    var fp = document.querySelector('[data-v30-fp][data-prospect-id]');
    if (fp) mountProspectCard(fp);
    if (document.querySelector('[data-v30-focus-na-ai]')) mountFocusSection();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
