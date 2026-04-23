/* ProspUp v30 — Doublons : détection, fusion par champ, exclusion */
(function () {
  'use strict';

  var STATE = {
    prospectGroups: [],
    companyGroups: [],
    excludedPros: new Map(),   // Map<groupIdx, Set<id>>
    excludedComps: new Map(),
    // Merge modal state
    mergeKeepId: null,
    mergeMergeId: null,
    mergeNextIds: []
  };

  var MERGE_FIELD_LABELS = {
    name: 'Nom',
    company_id: 'Entreprise',
    fonction: 'Fonction',
    telephone: 'Téléphone',
    email: 'Email',
    linkedin: 'LinkedIn',
    pertinence: 'Pertinence',
    statut: 'Statut',
    lastContact: 'Dernier contact',
    nextFollowUp: 'Prochaine relance',
    priority: 'Priorité',
    notes: 'Notes',
    callNotes: 'Notes d\'appel',
    pushEmailSentAt: 'Push email envoyé le',
    tags: 'Tags',
    template_id: 'Catégorie push'
  };

  // ─── Helpers ─────────────────────────────────────────────────
  function $(s, root) { return (root || document).querySelector(s); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function safeStr(v) {
    if (v == null) return '';
    return String(v);
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
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
  function fetchPost(url, body) {
    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  // ─── Modal helpers ───────────────────────────────────────────
  function getModal(name) { return document.querySelector('[data-v30-pp-modal="' + name + '"]'); }
  function openModal(m) {
    if (!m) return;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('is-open');
  }
  function closeModal(m) {
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { m.hidden = true; }, 160);
  }
  function bindModalDismiss() {
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-v30-modal-close]');
      if (close) {
        var m = close.closest('[data-v30-pp-modal]');
        if (m) closeModal(m);
        return;
      }
      var bd = e.target.closest('.v30-modal-bd');
      if (bd && e.target === bd && bd.dataset.v30PpModal) closeModal(bd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.v30-modal-bd.is-open[data-v30-pp-modal]').forEach(closeModal);
    });
  }

  // ─── Type label (email/linkedin/telephone > fuzzy) ───────────
  function getTypeLabel(g) {
    if (g.type === 'email') return { label: 'Email identique', priority: 0 };
    if (g.type === 'linkedin') return { label: 'LinkedIn identique', priority: 0 };
    if (g.type === 'telephone') return { label: 'Téléphone identique', priority: 0 };
    if (g.type === 'name_company') {
      var pct = g.score != null ? Math.round(g.score * 100) + ' %' : '';
      return { label: 'Nom similaire · ' + pct, priority: 1 };
    }
    return { label: g.type || '', priority: 2 };
  }

  // ─── Prospect/Company lines ─────────────────────────────────
  function prospectLine(p) {
    var title = safeStr(p.name).trim() || ('Prospect #' + p.id);
    var parts = [];
    if (p.company) parts.push(p.company);
    if (p.email) parts.push(p.email);
    if (p.telephone) parts.push(p.telephone);
    if (p.linkedin) parts.push('LinkedIn');
    var sub = parts.filter(Boolean).join(' · ');
    return '<div class="v30-dup__row-title">' + esc(title) + '</div>' +
           '<div class="v30-dup__row-sub">' + esc(sub) + '</div>';
  }

  function companyLine(c) {
    var title = (safeStr(c.groupe) + (c.site ? ' — ' + safeStr(c.site) : '')).trim() || ('Entreprise #' + c.id);
    var tags = Array.isArray(c.tags) ? c.tags : [];
    try {
      if (typeof c.tags === 'string') tags = JSON.parse(c.tags || '[]');
    } catch (_) { tags = []; }
    var tagsHtml = tags.length
      ? '<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">' +
        tags.map(function (t) { return '<span class="badge">' + esc(String(t)) + '</span>'; }).join('') +
        '</div>'
      : '';
    var notes = safeStr(c.notes).trim();
    var notesHtml = notes
      ? '<div class="v30-dup__row-sub" style="margin-top:6px;white-space:pre-wrap;">' +
        esc(notes.slice(0, 160)) + (notes.length > 160 ? '…' : '') +
        '</div>'
      : '';
    return '<div class="v30-dup__row-title">' + esc(title) + '</div>' +
           tagsHtml + notesHtml;
  }

  // ─── Summary ────────────────────────────────────────────────
  function updateSummary() {
    var sum = document.querySelector('[data-v30-dup-summary]');
    var cntPros = document.querySelector('[data-v30-dup-pros-count]');
    var cntComp = document.querySelector('[data-v30-dup-comp-count]');

    var prosCount = STATE.prospectGroups.filter(function (g, i) {
      var ex = STATE.excludedPros.get(i) || new Set();
      return (g.items || []).filter(function (p) { return !ex.has(p.id); }).length >= 2;
    }).length;
    var compCount = STATE.companyGroups.filter(function (g, i) {
      var ex = STATE.excludedComps.get(i) || new Set();
      return (g.items || []).filter(function (c) { return !ex.has(c.id); }).length >= 2;
    }).length;

    if (sum) sum.textContent = 'Prospects : ' + prosCount + ' groupe' + (prosCount > 1 ? 's' : '') +
                               ' · Entreprises : ' + compCount + ' groupe' + (compCount > 1 ? 's' : '');
    if (cntPros) cntPros.textContent = String(prosCount);
    if (cntComp) cntComp.textContent = String(compCount);
  }

  // ─── Render prospect groups ─────────────────────────────────
  function renderProspectGroups() {
    var host = document.querySelector('[data-v30-dup-prospects]');
    if (!host) return;

    var sorted = STATE.prospectGroups
      .map(function (g, origIdx) { return { g: g, origIdx: origIdx }; })
      .sort(function (a, b) { return getTypeLabel(a.g).priority - getTypeLabel(b.g).priority; });

    var html = '';
    var visible = 0;
    sorted.forEach(function (entry) {
      var g = entry.g;
      var idx = entry.origIdx;
      var excluded = STATE.excludedPros.get(idx) || new Set();
      var items = (Array.isArray(g.items) ? g.items : []).filter(function (p) { return !excluded.has(p.id); });
      if (items.length < 2) return;
      visible++;

      var typeLabel = getTypeLabel(g).label;
      var rows = items.map(function (p, i) {
        var radioChecked = i === 0 ? ' checked' : '';
        var mergeCb = i === 0
          ? ''
          : '<label class="v30-dup__merge-check"><input type="checkbox" name="dup_merge_' + idx + '" value="' + p.id + '"> Inclure</label>';
        return '<tr>' +
          '<td style="width:120px;">' +
            '<label class="v30-dup__keep-radio">' +
              '<input type="radio" name="dup_keep_' + idx + '" value="' + p.id + '"' + radioChecked + '> Garder' +
            '</label>' +
          '</td>' +
          '<td>' + prospectLine(p) + '</td>' +
          '<td style="width:90px;">' + mergeCb + '</td>' +
          '<td style="text-align:right;" class="v30-dup__row-id">#' + p.id + '</td>' +
          '<td><div class="v30-dup__row-actions">' +
            '<button type="button" class="btn btn-sm js-dup-merge-pros" data-group-idx="' + idx + '" data-merge-id="' + p.id + '">Fusionner →</button>' +
            '<button type="button" class="btn btn-sm js-dup-exclude-pros" data-group-idx="' + idx + '" data-prospect-id="' + p.id + '">Exclure</button>' +
            '<a class="btn btn-sm" href="/v30/prospects?open=' + p.id + '">Voir</a>' +
          '</div></td>' +
        '</tr>';
      }).join('');

      html += '<div class="v30-dup__group" data-group-idx="' + idx + '">' +
        '<div class="v30-dup__group-head">' +
          '<h3 class="v30-dup__group-title">Groupe #' + (idx + 1) + ' · ' + items.length + ' prospects</h3>' +
          '<div class="v30-dup__group-meta">' +
            '<span class="badge">' + esc(typeLabel) + '</span>' +
            (g.key ? ' <code>' + esc(g.key) + '</code>' : '') +
          '</div>' +
        '</div>' +
        '<div class="v30-dup__table-wrap">' +
          '<table class="v30-dup__table">' +
            '<thead><tr><th>Garder</th><th>Prospect</th><th>Fusionner</th><th style="text-align:right;">ID</th><th style="text-align:right;">Actions</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="v30-dup__group-actions">' +
          '<button type="button" class="btn btn-primary btn-sm js-dup-merge-selected-pros" data-group-idx="' + idx + '">Fusionner la sélection</button>' +
        '</div>' +
      '</div>';
    });

    host.innerHTML = visible === 0
      ? '<div class="v30-dup__empty">Aucun doublon prospect détecté.</div>'
      : html;
    updateSummary();
  }

  // ─── Render company groups ──────────────────────────────────
  function renderCompanyGroups() {
    var host = document.querySelector('[data-v30-dup-companies]');
    if (!host) return;

    var html = '';
    var visible = 0;
    STATE.companyGroups.forEach(function (g, idx) {
      var excluded = STATE.excludedComps.get(idx) || new Set();
      var items = (Array.isArray(g.items) ? g.items : []).filter(function (c) { return !excluded.has(c.id); });
      if (items.length < 2) return;
      visible++;

      var rows = items.map(function (c, i) {
        var radioChecked = i === 0 ? ' checked' : '';
        return '<tr>' +
          '<td style="width:120px;">' +
            '<label class="v30-dup__keep-radio">' +
              '<input type="radio" name="dup_keep_company_' + idx + '" value="' + c.id + '"' + radioChecked + '> Garder' +
            '</label>' +
          '</td>' +
          '<td>' + companyLine(c) + '</td>' +
          '<td style="text-align:right;" class="v30-dup__row-id">#' + c.id + '</td>' +
          '<td><div class="v30-dup__row-actions">' +
            '<button type="button" class="btn btn-sm js-dup-merge-comp" data-group-idx="' + idx + '" data-merge-id="' + c.id + '">Fusionner →</button>' +
            '<button type="button" class="btn btn-sm js-dup-exclude-comp" data-group-idx="' + idx + '" data-company-id="' + c.id + '">Exclure</button>' +
            '<a class="btn btn-sm" href="/v30/entreprises?openCompany=' + c.id + '">Voir</a>' +
          '</div></td>' +
        '</tr>';
      }).join('');

      html += '<div class="v30-dup__group" data-company-group-idx="' + idx + '">' +
        '<div class="v30-dup__group-head">' +
          '<h3 class="v30-dup__group-title">Groupe #' + (idx + 1) + ' · ' + items.length + ' entreprises</h3>' +
          '<div class="v30-dup__group-meta">' +
            (g.key ? '<code>' + esc(g.key) + '</code>' : '') +
          '</div>' +
        '</div>' +
        '<div class="v30-dup__table-wrap">' +
          '<table class="v30-dup__table">' +
            '<thead><tr><th>Garder</th><th>Entreprise</th><th style="text-align:right;">ID</th><th style="text-align:right;">Actions</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
    });

    host.innerHTML = visible === 0
      ? '<div class="v30-dup__empty">Aucun doublon entreprise détecté.</div>'
      : html;
    updateSummary();
  }

  // ─── Load duplicates ────────────────────────────────────────
  function loadDuplicates() {
    var minScore = parseFloat(($('[data-v30-dup-score]') || {}).value || '0.85');
    var prosHost = document.querySelector('[data-v30-dup-prospects]');
    var compHost = document.querySelector('[data-v30-dup-companies]');
    if (prosHost) prosHost.innerHTML = '<div class="v30-dup__empty">Chargement…</div>';
    if (compHost) compHost.innerHTML = '<div class="v30-dup__empty">Chargement…</div>';

    return fetchJSON('/api/duplicates?min_score=' + encodeURIComponent(minScore))
      .then(function (json) {
        STATE.prospectGroups = Array.isArray(json && json.prospect_groups) ? json.prospect_groups : [];
        STATE.companyGroups = Array.isArray(json && json.company_groups) ? json.company_groups : [];
        STATE.excludedPros.clear();
        STATE.excludedComps.clear();
        renderProspectGroups();
        renderCompanyGroups();
      })
      .catch(function (e) {
        console.error('[v30 duplicates]', e);
        toast('Impossible de charger les doublons. Vérifiez que le serveur est lancé.', 'error');
        if (prosHost) prosHost.innerHTML = '<div class="v30-dup__empty" style="color:var(--danger);">Erreur : ' + esc(e.message) + '</div>';
        if (compHost) compHost.innerHTML = '';
      });
  }

  // ─── Exclude prospect ───────────────────────────────────────
  function excludeProspect(groupIdx, prospectId) {
    if (!STATE.excludedPros.has(groupIdx)) STATE.excludedPros.set(groupIdx, new Set());
    STATE.excludedPros.get(groupIdx).add(prospectId);
    renderProspectGroups();

    // Persister : marquer comme "pas un doublon" avec tous les autres du groupe
    var group = STATE.prospectGroups[groupIdx];
    if (!group) return;
    var others = (group.items || []).map(function (p) { return p.id; }).filter(function (id) { return id !== prospectId; });
    others.forEach(function (otherId) {
      fetchPost('/api/duplicates/ignore', { id_a: prospectId, id_b: otherId })
        .catch(function () { /* silencieux — exclusion locale effectuée */ });
    });
  }

  function excludeCompany(groupIdx, companyId) {
    if (!STATE.excludedComps.has(groupIdx)) STATE.excludedComps.set(groupIdx, new Set());
    STATE.excludedComps.get(groupIdx).add(companyId);
    renderCompanyGroups();
  }

  // ─── Merge actions (prospects) ──────────────────────────────
  function mergeProspectIntoSelected(groupIdx, mergeId) {
    var card = document.querySelector('[data-group-idx="' + groupIdx + '"]');
    if (!card) return;
    var radio = card.querySelector('input[name="dup_keep_' + groupIdx + '"]:checked');
    if (!radio) return;
    var keepId = parseInt(radio.value, 10);
    if (keepId === mergeId) {
      toast('Choisissez une autre fiche à garder.', 'warning');
      return;
    }
    openMergeModal(keepId, mergeId);
  }

  function mergeSelectedInGroup(groupIdx) {
    var card = document.querySelector('[data-group-idx="' + groupIdx + '"]');
    if (!card) return;
    var radio = card.querySelector('input[name="dup_keep_' + groupIdx + '"]:checked');
    if (!radio) return;
    var keepId = parseInt(radio.value, 10);
    var checked = card.querySelectorAll('input[name="dup_merge_' + groupIdx + '"]:checked');
    var mergeIds = Array.prototype.map.call(checked, function (cb) { return parseInt(cb.value, 10); })
                        .filter(function (id) { return id !== keepId; });
    if (mergeIds.length === 0) {
      toast('Sélectionnez au moins une fiche à fusionner (cochez « Inclure »).', 'warning');
      return;
    }
    openMergeModal(keepId, mergeIds[0], mergeIds.slice(1));
  }

  // ─── Merge actions (companies) ──────────────────────────────
  function mergeCompanyIntoSelected(groupIdx, mergeId) {
    var card = document.querySelector('[data-company-group-idx="' + groupIdx + '"]');
    if (!card) return;
    var radio = card.querySelector('input[name="dup_keep_company_' + groupIdx + '"]:checked');
    if (!radio) return;
    var keepId = parseInt(radio.value, 10);
    if (keepId === mergeId) {
      toast('Choisissez une autre entreprise à garder.', 'warning');
      return;
    }
    mergeCompany(keepId, mergeId);
  }

  function mergeCompany(keepId, mergeId) {
    if (!confirm('Fusionner l\'entreprise #' + mergeId + ' dans #' + keepId + ' ?\n\nLes prospects seront rattachés à l\'entreprise gardée.')) return;
    fetchPost('/api/companies/merge', { keep_id: keepId, merge_id: mergeId })
      .then(function () {
        toast('Entreprises fusionnées.', 'success');
        return loadDuplicates();
      })
      .catch(function (e) {
        toast('Fusion impossible : ' + (e.message || 'erreur'), 'error');
      });
  }

  // ─── Merge modal (choice per field) ─────────────────────────
  function formatMergeValue(field, value, companies) {
    if (value === null || value === undefined || value === '') return '—';
    if (field === 'company_id' && companies && companies.length) {
      var c = companies.find(function (x) { return String(x.id) === String(value); });
      if (c) return (c.groupe || '') + (c.site ? ' — ' + c.site : '');
    }
    if (field === 'tags') {
      try {
        var arr = typeof value === 'string' ? JSON.parse(value || '[]') : value;
        return Array.isArray(arr) ? arr.join(', ') : String(value);
      } catch (_) { return String(value); }
    }
    if (field === 'callNotes') {
      try {
        var arr2 = typeof value === 'string' ? JSON.parse(value || '[]') : value;
        return Array.isArray(arr2) ? arr2.length + ' entrée(s)' : String(value);
      } catch (_) { return String(value); }
    }
    return String(value);
  }

  function openMergeModal(keepId, mergeId, nextMergeIds) {
    STATE.mergeKeepId = keepId;
    STATE.mergeMergeId = mergeId;
    STATE.mergeNextIds = Array.isArray(nextMergeIds) ? nextMergeIds : [];

    var modal = getModal('dup-merge');
    var body = document.querySelector('[data-v30-dup-merge-body]');
    var keepIdEl = document.querySelector('[data-v30-dup-keep-id]');
    var mergeIdEl = document.querySelector('[data-v30-dup-merge-id]');
    if (keepIdEl) keepIdEl.textContent = keepId;
    if (mergeIdEl) mergeIdEl.textContent = mergeId;
    if (body) body.innerHTML = '<div class="muted">Chargement…</div>';
    openModal(modal);

    fetchJSON('/api/duplicates/merge-preview?keep_id=' + keepId + '&merge_id=' + mergeId)
      .then(function (data) {
        if (!data.ok || !data.keep || !data.merge) throw new Error('Données invalides');
        var keep = data.keep;
        var merge = data.merge;
        var companies = data.companies || [];
        var fields = data.mergeable_fields || [];
        var appendFields = data.append_fields || [];

        var rows = fields.map(function (field) {
          var label = MERGE_FIELD_LABELS[field] || field;
          var valA = formatMergeValue(field, keep[field], companies);
          var valB = formatMergeValue(field, merge[field], companies);
          var canBoth = appendFields.indexOf(field) >= 0;
          var name = 'merge_choice_' + field;
          var opts = canBoth
            ? '<label><input type="radio" name="' + name + '" value="keep" checked> A (gardée)</label>' +
              '<label><input type="radio" name="' + name + '" value="merge"> B (fusionnée)</label>' +
              '<label><input type="radio" name="' + name + '" value="both"> Fusionner (A+B)</label>'
            : '<label><input type="radio" name="' + name + '" value="keep" checked> A (gardée)</label>' +
              '<label><input type="radio" name="' + name + '" value="merge"> B (fusionnée)</label>';
          return '<tr>' +
            '<td><strong>' + esc(label) + '</strong></td>' +
            '<td class="v30-dup__merge-val">' + esc(valA) + '</td>' +
            '<td class="v30-dup__merge-val">' + esc(valB) + '</td>' +
            '<td><div class="v30-dup__merge-choice">' + opts + '</div></td>' +
          '</tr>';
        }).join('');

        if (body) body.innerHTML =
          '<div style="max-height:60vh;overflow:auto;">' +
            '<table class="v30-dup__merge-table">' +
              '<thead><tr><th>Champ</th><th>Fiche A (gardée)</th><th>Fiche B (fusionnée)</th><th>Garder</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>';

        // Réinstaller le handler de confirmation (propre à cette paire)
        var btn = document.querySelector('[data-v30-dup-merge-confirm]');
        if (btn) {
          btn.onclick = function () {
            var choices = {};
            fields.forEach(function (field) {
              var radio = document.querySelector('input[name="merge_choice_' + field + '"]:checked');
              if (radio) choices[field] = radio.value;
            });
            btn.disabled = true;
            fetchPost('/api/duplicates/merge', { keep_id: keepId, merge_id: mergeId, choices: choices })
              .then(function () {
                var remaining = STATE.mergeNextIds.slice();
                closeModal(modal);
                if (remaining.length > 0) {
                  openMergeModal(keepId, remaining[0], remaining.slice(1));
                  toast('Fiche fusionnée. Choix pour la suivante…', 'success');
                } else {
                  toast('Prospects fusionnés.', 'success');
                  loadDuplicates();
                }
              })
              .catch(function (e) {
                toast('Fusion impossible : ' + (e.message || 'erreur'), 'error');
              })
              .then(function () { btn.disabled = false; });
          };
        }
      })
      .catch(function (e) {
        if (body) body.innerHTML = '<div class="v30-dup__empty" style="color:var(--danger);">Erreur : ' + esc(e.message) + '</div>';
      });
  }

  // ─── Bindings ───────────────────────────────────────────────
  function bind() {
    bindModalDismiss();

    var scanBtn = document.querySelector('[data-v30-dup-scan]');
    if (scanBtn) scanBtn.addEventListener('click', loadDuplicates);

    var scoreSel = document.querySelector('[data-v30-dup-score]');
    if (scoreSel) scoreSel.addEventListener('change', loadDuplicates);

    document.addEventListener('click', function (e) {
      var mergeProsBtn = e.target.closest('.js-dup-merge-pros');
      if (mergeProsBtn) {
        mergeProsBtn.blur();
        mergeProsIntoSelectedClick(mergeProsBtn);
        return;
      }
      var excludeProsBtn = e.target.closest('.js-dup-exclude-pros');
      if (excludeProsBtn) {
        excludeProsBtn.blur();
        excludeProspect(
          parseInt(excludeProsBtn.dataset.groupIdx, 10),
          parseInt(excludeProsBtn.dataset.prospectId, 10)
        );
        return;
      }
      var mergeSelBtn = e.target.closest('.js-dup-merge-selected-pros');
      if (mergeSelBtn) {
        mergeSelectedInGroup(parseInt(mergeSelBtn.dataset.groupIdx, 10));
        return;
      }
      var mergeCompBtn = e.target.closest('.js-dup-merge-comp');
      if (mergeCompBtn) {
        mergeCompanyIntoSelected(
          parseInt(mergeCompBtn.dataset.groupIdx, 10),
          parseInt(mergeCompBtn.dataset.mergeId, 10)
        );
        return;
      }
      var excludeCompBtn = e.target.closest('.js-dup-exclude-comp');
      if (excludeCompBtn) {
        excludeCompany(
          parseInt(excludeCompBtn.dataset.groupIdx, 10),
          parseInt(excludeCompBtn.dataset.companyId, 10)
        );
        return;
      }
    });
  }

  function mergeProsIntoSelectedClick(btn) {
    mergeProspectIntoSelected(
      parseInt(btn.dataset.groupIdx, 10),
      parseInt(btn.dataset.mergeId, 10)
    );
  }

  function init() {
    bind();
    loadDuplicates();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
