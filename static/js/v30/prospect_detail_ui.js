/* ProspUp v30 — Fiche prospect : UI events + init */
(function () {
  'use strict';
  var FP = window.ProspFP;
  var R = window.ProspFPRender;
  if (!FP || !R) return;

  var STATUTS = [
    "Pas d'actions",
    "Appelé",
    "À rappeler",
    "Rendez-vous",
    "Prospecté",
    "Messagerie",
    "Pas intéressé"
  ];

  // ─── Flash "saved" ──────────────────────────────────────────
  function flashSaved() {
    var el = document.querySelector('[data-v30-saved-check]');
    if (!el) return;
    el.classList.add('is-visible');
    setTimeout(function () { el.classList.remove('is-visible'); }, 1200);
  }

  // ─── Floating picker (partagé statut + more menu) ────────────
  var _activePicker = null;

  function closePicker() {
    if (_activePicker) {
      _activePicker.remove();
      _activePicker = null;
    }
  }

  function buildPicker(items, anchorEl) {
    var picker = document.createElement('div');
    picker.className = 'v30-fp-picker';
    picker.setAttribute('role', 'menu');

    items.forEach(function (item) {
      if (item.sep) {
        var sep = document.createElement('div');
        sep.className = 'v30-fp-picker__sep';
        picker.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v30-fp-picker__item' +
        (item.active ? ' is-active' : '') +
        (item.danger ? ' danger' : '');
      btn.setAttribute('role', 'menuitem');
      btn.innerHTML = item.html || FP.esc(item.label || '');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        closePicker();
        if (item.action) item.action();
      });
      picker.appendChild(btn);
    });

    // Position under the anchor
    var rect = anchorEl.getBoundingClientRect();
    picker.style.top = (rect.bottom + 4) + 'px';
    // Align right edge for "more" button, left edge for statut
    if (anchorEl.dataset.v30Action === 'more') {
      picker.style.right = (window.innerWidth - rect.right) + 'px';
    } else {
      picker.style.left = rect.left + 'px';
    }

    document.body.appendChild(picker);
    _activePicker = picker;

    // Close on outside click
    setTimeout(function () {
      document.addEventListener('click', closePicker, { once: true, capture: true });
    }, 0);

    return picker;
  }

  // ─── Inline edit (click → contenteditable → Enter/Esc) ─────
  function bindInlineEdit() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-v30-edit]');
      if (!el) return;
      if (el.getAttribute('contenteditable') === 'true') return;
      var original = el.textContent;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      function commit(save) {
        el.removeAttribute('contenteditable');
        var newVal = el.textContent.trim();
        if (!save || newVal === original.trim()) {
          el.textContent = original;
          return;
        }
        var field = el.dataset.v30Edit;
        FP.saveField(field, newVal).then(function () {
          if (FP.STATE.prospect) FP.STATE.prospect[field] = newVal;
          flashSaved();
          R.header(FP.STATE.prospect);
          R.aside(FP.STATE.prospect);
        }).catch(function (err) {
          el.textContent = original;
          alert('Échec de sauvegarde : ' + err.message);
        });
      }

      function onKey(ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          el.blur();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          el.textContent = original;
          el.blur();
        }
      }
      function onBlur() {
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('blur', onBlur);
        commit(true);
      }
      el.addEventListener('keydown', onKey);
      el.addEventListener('blur', onBlur);
    });
  }

  // ─── Tag add (bouton "+ Tag") ────────────────────────────────
  function bindTagAdd() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-add-tag]');
      if (!btn) return;
      var host = document.querySelector('[data-field="aside-tags"]');
      if (!host) return;
      if (host.querySelector('input')) return; // already open
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Nouveau tag…';
      input.style.cssText = 'font-size:12px;padding:2px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-1);outline:none;width:120px;';
      host.appendChild(input);
      input.focus();
      function commit() {
        var val = input.value.trim();
        input.remove();
        if (!val) return;
        var p = FP.STATE.prospect || {};
        var existing = FP.parseTags(p.tags);
        if (existing.indexOf(val) !== -1) return;
        var updated = existing.concat([val]);
        FP.saveField('tags', JSON.stringify(updated)).then(function () {
          if (FP.STATE.prospect) FP.STATE.prospect.tags = JSON.stringify(updated);
          R.aside(FP.STATE.prospect);
          flashSaved();
        }).catch(function (err) {
          if (typeof window.showToast === 'function') window.showToast('Erreur : ' + (err.message || err), 'error');
        });
      }
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { input.remove(); }
      });
      input.addEventListener('blur', commit);
    });
  }

  // ─── Company picker (édition en place) ──────────────────────
  function bindCompanyEdit() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-edit-company]');
      if (!btn) return;
      e.stopPropagation();
      if (!window.CompanyPicker) return;
      var p = FP.STATE.prospect || {};
      window.CompanyPicker.openFloating(btn, {
        currentId: p.company_id,
        onSelect: function (co) {
          FP.saveField('company_id', co.id).then(function () {
            if (FP.STATE.prospect) {
              FP.STATE.prospect.company_id = co.id;
              FP.STATE.prospect.company_groupe = co.groupe;
              FP.STATE.prospect.company_site = co.site;
            }
            flashSaved();
            R.header(FP.STATE.prospect);
            R.aside(FP.STATE.prospect);
            if (typeof window.showToast === 'function') {
              window.showToast('Entreprise mise à jour', 'success', 1800);
            }
          }).catch(function (err) {
            alert('Échec : ' + (err.message || err));
          });
        }
      });
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.hasAttribute && e.target.hasAttribute('data-v30-edit-company')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  // ─── Date prompt (modal léger pour rdvDate / nextFollowUp) ────
  function promptForDate(opts) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'v30-fp-date-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      var defaultVal = opts.currentValue || '';
      if (!defaultVal) {
        var d = new Date();
        if (opts.type === 'datetime-local') {
          d.setHours(10, 0, 0, 0);
          defaultVal = d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0') + 'T' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0');
        } else {
          defaultVal = d.toISOString().slice(0, 10);
        }
      }
      overlay.innerHTML =
        '<div class="v30-fp-date-modal__card">' +
          '<div class="v30-fp-date-modal__title">' + FP.esc(opts.title || 'Choisir une date') + '</div>' +
          (opts.subtitle ? '<div class="v30-fp-date-modal__sub">' + FP.esc(opts.subtitle) + '</div>' : '') +
          '<input type="' + opts.type + '" class="v30-fp-date-modal__input" value="' + FP.esc(defaultVal) + '">' +
          '<div class="v30-fp-date-modal__actions">' +
            (opts.allowSkip !== false ? '<button type="button" class="btn btn-ghost btn-sm" data-skip>Passer</button>' : '') +
            (opts.allowClear ? '<button type="button" class="btn btn-ghost btn-sm" data-clear>Effacer</button>' : '') +
            '<button type="button" class="btn btn-ghost btn-sm" data-cancel>Annuler</button>' +
            '<button type="button" class="btn btn-accent btn-sm" data-ok>Confirmer</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var input = overlay.querySelector('input');
      setTimeout(function () { try { input.focus(); } catch (_) {} }, 50);

      function close(result) {
        overlay.remove();
        document.removeEventListener('keydown', onEsc);
        resolve(result);
      }
      function onEsc(ev) { if (ev.key === 'Escape') close({ status: 'cancel' }); }
      document.addEventListener('keydown', onEsc);
      overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close({ status: 'cancel' }); });
      var btnOk = overlay.querySelector('[data-ok]');
      var btnCancel = overlay.querySelector('[data-cancel]');
      var btnSkip = overlay.querySelector('[data-skip]');
      var btnClear = overlay.querySelector('[data-clear]');
      btnOk.addEventListener('click', function () { close({ status: 'ok', value: input.value }); });
      btnCancel.addEventListener('click', function () { close({ status: 'cancel' }); });
      if (btnSkip) btnSkip.addEventListener('click', function () { close({ status: 'skip' }); });
      if (btnClear) btnClear.addEventListener('click', function () { close({ status: 'ok', value: '' }); });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); close({ status: 'ok', value: input.value }); }
      });
    });
  }

  function applyFields(fields) {
    return FP.fetchPostJSON('/api/prospects/bulk-edit', { ids: [FP.ID], fields: fields })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Erreur');
        if (FP.STATE.prospect) {
          Object.keys(fields).forEach(function (k) { FP.STATE.prospect[k] = fields[k]; });
        }
        return res;
      });
  }

  // ─── Statut picker ───────────────────────────────────────────
  function bindStatusEdit() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-statut-btn]');
      if (!btn) return;
      e.stopPropagation();
      if (_activePicker) { closePicker(); return; }

      var current = (FP.STATE.prospect && FP.STATE.prospect.statut) || '';
      var items = STATUTS.map(function (s) {
        return {
          active: s === current,
          html: '<span class="status ' + FP.statusClass(s) + '">' + FP.esc(s) + '</span>',
          action: function () { applyStatutChange(s); }
        };
      });
      buildPicker(items, btn);
    });

    // Keyboard support (Enter/Space on the statut button)
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.v30StatutBtn !== undefined) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  function applyStatutChange(newStatut) {
    var p = FP.STATE.prospect || {};
    var promise;
    if (newStatut === 'Rendez-vous') {
      promise = promptForDate({
        title: 'Date du rendez-vous',
        subtitle: "Choisis la date et l'heure du RDV avec ce prospect.",
        type: 'datetime-local',
        currentValue: (p.rdvDate || '').slice(0, 16)
      }).then(function (r) {
        if (r.status === 'cancel') return null;
        var fields = { statut: newStatut };
        if (r.status === 'ok') fields.rdvDate = r.value || '';
        return applyFields(fields);
      });
    } else if (newStatut === 'À rappeler') {
      promise = promptForDate({
        title: 'Date de relance',
        subtitle: 'Choisis quand rappeler ce prospect.',
        type: 'date',
        currentValue: p.nextFollowUp || ''
      }).then(function (r) {
        if (r.status === 'cancel') return null;
        var fields = { statut: newStatut };
        if (r.status === 'ok') fields.nextFollowUp = r.value || '';
        return applyFields(fields);
      });
    } else {
      promise = applyFields({ statut: newStatut });
    }
    promise.then(function (res) {
      if (!res) return;
      flashSaved();
      R.header(FP.STATE.prospect);
      R.aside(FP.STATE.prospect);
      if (typeof FP.loadTimeline === 'function') FP.loadTimeline();
    }).catch(function (err) {
      alert('Échec : ' + (err && err.message ? err.message : err));
    });
  }

  // ─── Édition Prochain RDV (rdvDate) ──────────────────────────
  function bindRdvEdit() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-v30-edit-rdv]');
      if (!el) return;
      e.stopPropagation();
      var p = FP.STATE.prospect || {};
      promptForDate({
        title: 'Prochain RDV',
        subtitle: 'Choisis la date et l\'heure du prochain rendez-vous (laisse vide pour effacer).',
        type: 'datetime-local',
        currentValue: (p.rdvDate || '').slice(0, 16),
        allowSkip: false,
        allowClear: !!p.rdvDate
      }).then(function (r) {
        if (r.status !== 'ok') return;
        applyFields({ rdvDate: r.value || '' }).then(function () {
          flashSaved();
          R.aside(FP.STATE.prospect);
          if (typeof FP.loadTimeline === 'function') FP.loadTimeline();
        }).catch(function (err) {
          alert('Échec : ' + (err && err.message ? err.message : err));
        });
      });
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.hasAttribute && e.target.hasAttribute('data-v30-edit-rdv')) {
        e.preventDefault();
        e.target.click();
      }
    });
  }

  // ─── More menu ───────────────────────────────────────────────
  function openMoreMenu(anchorEl) {
    if (_activePicker) { closePicker(); return; }
    var p = FP.STATE.prospect || {};
    var items = [];

    if (p.linkedin) {
      items.push({
        label: 'Voir sur LinkedIn',
        action: function () { window.open(p.linkedin, '_blank', 'noopener'); }
      });
      items.push({
        label: 'Push LinkedIn',
        action: function () {
          if (window.V30PushModal && typeof window.V30PushModal.open === 'function') {
            window.V30PushModal.open(FP.ID, 'linkedin');
          }
        }
      });
    }
    if (p.company_id) {
      items.push({
        label: "Ouvrir l'entreprise",
        action: function () { window.location.href = '/v30/entreprises#' + p.company_id; }
      });
    }
    if (items.length) items.push({ sep: true });

    items.push({
      label: 'Supprimer le prospect',
      danger: true,
      action: function () {
        var pname = (FP.STATE.prospect && FP.STATE.prospect.name) || 'ce prospect';
        var cancelled = false;
        if (typeof window.showToast === 'function') {
          window.showToast('Suppression de ' + pname + '… (annulable pendant 10s)', 'warning', 10000, {
            action: {
              label: 'Annuler',
              onClick: function () {
                cancelled = true;
                if (typeof window.showToast === 'function') {
                  window.showToast('Suppression annulée', 'info', 2000);
                }
              }
            },
            onExpire: function () {
              if (cancelled) return;
              FP.fetchPostJSON('/api/prospects/delete', { id: FP.ID })
                .then(function () { window.location.href = '/v30/prospects'; })
                .catch(function (err) {
                  if (typeof window.showToast === 'function') {
                    window.showToast('Erreur : ' + err.message, 'error', 4000);
                  } else { alert('Erreur : ' + err.message); }
                });
            }
          });
        } else {
          if (!confirm('Supprimer définitivement ' + pname + ' ?')) return;
          FP.fetchPostJSON('/api/prospects/delete', { id: FP.ID })
            .then(function () { window.location.href = '/v30/prospects'; })
            .catch(function (err) { alert('Erreur : ' + err.message); });
        }
      }
    });

    buildPicker(items, anchorEl);
  }

  // ─── Tabs ───────────────────────────────────────────────────
  function bindTabs() {
    var tabs = document.querySelector('[data-v30-fp-tabs]');
    if (!tabs) return;
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      var key = btn.dataset.tab;
      tabs.querySelectorAll('button[data-tab]').forEach(function (b) {
        var active = (b === btn);
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('[data-v30-fp-panel]').forEach(function (p) {
        p.hidden = (p.dataset.v30FpPanel !== key);
      });
      if (key === 'grille') loadGrilleTab();
      if (key === 'cr') loadCRTab();
    });
  }

  // ─── Filtre activité (Tous / Push / Notes) ──────────────────
  function bindActivityFilter() {
    var host = document.querySelector('[data-v30-fp-filter]');
    if (!host) return;
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      host.querySelectorAll('button[data-filter]').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      R.events(btn.dataset.filter, '[data-v30-fp-events]', 6);
    });
  }

  // ─── Éditer notes rapides ────────────────────────────────────
  function bindEditNotes() {
    document.addEventListener('click', function (e) {
      if (!e.target.closest('[data-v30-edit-notes]')) return;
      var notesEl = document.querySelector('[data-v30-edit="notes"]');
      if (!notesEl) return;
      notesEl.click();
      notesEl.focus();
    });
  }

  // ─── Ajouter une note dans la timeline ──────────────────────
  function bindAddNote() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-add-note]')) {
        var form = document.querySelector('[data-v30-note-form]');
        if (!form) return;
        form.style.display = 'block';
        var ta = form.querySelector('[data-v30-note-text]');
        if (ta) ta.focus();
        return;
      }
      if (e.target.closest('[data-v30-note-cancel]')) {
        var form = document.querySelector('[data-v30-note-form]');
        if (form) {
          form.style.display = 'none';
          var ta = form.querySelector('[data-v30-note-text]');
          if (ta) ta.value = '';
        }
        return;
      }
      if (e.target.closest('[data-v30-note-save]')) {
        var form = document.querySelector('[data-v30-note-form]');
        if (!form) return;
        var ta = form.querySelector('[data-v30-note-text]');
        var text = ta ? ta.value.trim() : '';
        if (!text) { if (ta) ta.focus(); return; }
        var saveBtn = form.querySelector('[data-v30-note-save]');
        if (saveBtn) saveBtn.disabled = true;
        FP.fetchPostJSON('/api/prospect/events/add', {
          prospect_id: FP.ID,
          title: 'Note',
          content: text
        }).then(function (res) {
          if (!res || !res.ok) throw new Error('Échec');
          form.style.display = 'none';
          if (ta) ta.value = '';
          return FP.loadTimeline();
        }).then(function () {
          flashSaved();
        }).catch(function (err) {
          alert('Erreur lors de l\'ajout de la note : ' + (err.message || ''));
        }).finally(function () {
          if (saveBtn) saveBtn.disabled = false;
        });
      }
    });
  }

  // ─── Drawer IA ──────────────────────────────────────────────
  function openDrawer(title, bodyHtml) {
    var bd = document.querySelector('[data-v30-drawer-backdrop]');
    var dr = document.querySelector('[data-v30-drawer]');
    if (!dr) return;
    var t = dr.querySelector('[data-field="title"]');
    if (t) t.textContent = title || 'Analyse IA';
    var body = dr.querySelector('[data-field="body"]');
    if (body) body.innerHTML = bodyHtml || '<div class="empty">Aucun contenu.</div>';
    dr.classList.add('is-open');
    dr.setAttribute('aria-hidden', 'false');
    if (bd) bd.classList.add('is-visible');
  }
  function closeDrawer() {
    var bd = document.querySelector('[data-v30-drawer-backdrop]');
    var dr = document.querySelector('[data-v30-drawer]');
    if (dr) {
      dr.classList.remove('is-open');
      dr.setAttribute('aria-hidden', 'true');
    }
    if (bd) bd.classList.remove('is-visible');
  }

  // ─── Picker IA — rendu + journalisation ─────────────────────
  var IA_ICON_SVG = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l2 2 5-5"/><circle cx="12" cy="12" r="9"/></svg>',
    chev:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    badge:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>'
  };

  function lastIaEvent(kind) {
    var type = 'ia_' + kind;
    var events = (FP.STATE && FP.STATE.events) || [];
    for (var i = 0; i < events.length; i++) {
      if (events[i] && events[i].type === type) return events[i];
    }
    return null;
  }

  function renderIaPickerBody() {
    var items = [
      { action: 'data-v30-ia-scrap',  kind: 'scrap',  icon: IA_ICON_SVG.search, title: 'Scraping enrichissement', desc: 'Recherche IA + Tavily pour compléter fonction, email, téléphone, LinkedIn et notes.' },
      { action: 'data-v30-ia-before', kind: 'before', icon: IA_ICON_SVG.report, title: 'Avant RDV — fiche prépa',   desc: 'Générer un PDF de préparation à partir des données du prospect.' },
      { action: 'data-v30-ia-after',  kind: 'after',  icon: IA_ICON_SVG.check,  title: 'Après RDV — compte-rendu',  desc: 'Transformer des notes libres en résumé + actions + tags.' }
    ];
    var html = '<div class="v30-ia-picker">' +
      '<p class="v30-ia-picker__intro">Choisis le type d\'analyse à lancer sur ce prospect :</p>';
    items.forEach(function (it) {
      var ev = lastIaEvent(it.kind);
      var doneCls = ev ? ' is-done' : '';
      var badge = '';
      if (ev) {
        var when = FP.relativeTime(ev.date);
        var label = it.kind === 'before' ? 'PDF enregistré' : 'Fait';
        badge = '<span class="v30-ia-picker__badge" title="' + FP.esc(label + ' · ' + when) + '">' +
          IA_ICON_SVG.badge +
          '<span>' + FP.esc(when) + '</span>' +
        '</span>';
      }
      html += '<button type="button" class="v30-ia-picker__item' + doneCls + '" ' + it.action + '>' +
        '<span class="v30-ia-picker__icon">' + it.icon + '</span>' +
        '<span class="v30-ia-picker__text">' +
          '<span class="v30-ia-picker__title">' + it.title + '</span>' +
          '<span class="v30-ia-picker__desc">' + it.desc + '</span>' +
        '</span>' +
        badge +
        '<span class="v30-ia-picker__chev">' + IA_ICON_SVG.chev + '</span>' +
      '</button>';
    });
    html += '</div>';
    return html;
  }

  function logIaRun(kind, summary, meta) {
    if (!FP.ID) return Promise.resolve();
    return FP.fetchPostJSON('/api/prospect/' + encodeURIComponent(FP.ID) + '/ia-log', {
      kind: kind, summary: summary || '', meta: meta || null
    }).then(function () {
      return FP.loadTimeline ? FP.loadTimeline() : null;
    }).catch(function () { /* silencieux : badge sera maj au prochain refresh */ });
  }

  function bindDrawer() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-drawer-close]')) closeDrawer();
      if (e.target.matches('[data-v30-drawer-backdrop]')) closeDrawer();
      if (e.target.closest('[data-v30-ia-run]')) {
        closeDrawer();
        openDrawer('Analyses IA', renderIaPickerBody());
        return;
      }
      if (e.target.closest('[data-v30-ia-scrap]')) { closeDrawer(); openScrapModal(); }
      if (e.target.closest('[data-v30-ia-before]')) { closeDrawer(); openBeforeModal(); }
      if (e.target.closest('[data-v30-ia-after]')) { closeDrawer(); openAfterModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });
  }

  // ─── IA : modales (scrap / before / after) ──────────────────
  var IA_CTX = { scrapJson: null, scrapText: '', afterJson: null };

  function getFPModal(name) {
    return document.querySelector('[data-v30-fp-modal="' + name + '"]');
  }
  function openFPModal(name) {
    var m = getFPModal(name);
    if (!m) return null;
    m.hidden = false;
    void m.offsetWidth;
    m.classList.add('is-open');
    return m;
  }
  function closeFPModal(m) {
    if (!m) return;
    m.classList.remove('is-open');
    setTimeout(function () { m.hidden = true; }, 160);
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else if (type === 'error') alert(msg);
  }
  function extractJsonMaybe(text) {
    if (!text) return null;
    // Essai : bloc ```json … ```
    var m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
    // Fallback : premier objet JSON "équilibré" (accolades)
    var start = text.indexOf('{');
    if (start === -1) return null;
    var depth = 0;
    for (var i = start; i < text.length; i++) {
      var c = text[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
        }
      }
    }
    return null;
  }
  function getCompanyName(p) {
    if (!p) return '';
    return (p.company_groupe || p.companyName || p.company || '').toString().trim();
  }

  // ── a) Scraping enrichissement ──────────────────────────────
  function buildScrapPrompt(p) {
    var coName = getCompanyName(p);
    var nom = (p && p.name) || '—';
    return "Enrichis les infos du prospect " + nom + (coName ? ' chez ' + coName : '') +
      " : poste actuel, email/tel pro si trouvés, LinkedIn, contexte sectoriel et 2-3 accroches pertinentes pour un RDV." +
      "\nRends la réponse en JSON STRICT (aucun texte autour, pas de markdown) :" +
      '\n{"fonction": "", "entreprise": "", "tel": "", "email": "", "linkedin": "", "notes": "", "accroches": ["", "", ""]}' +
      "\nSi une info est inconnue, laisse la valeur vide. Ne fabrique rien.";
  }
  function openScrapModal() {
    var p = FP.STATE.prospect || {};
    IA_CTX.scrapJson = null;
    IA_CTX.scrapText = '';
    var m = openFPModal('scrap');
    if (!m) return;
    var nameEl = m.querySelector('[data-v30-fp-ai-name]');
    if (nameEl) nameEl.textContent = p.name || '—';
    var pr = m.querySelector('[data-v30-fp-scrap-prompt]');
    if (pr) pr.value = buildScrapPrompt(p);
    var web = m.querySelector('[data-v30-fp-scrap-web]');
    if (web) web.checked = false;
    var rawWrap = m.querySelector('[data-v30-fp-scrap-raw-wrap]');
    if (rawWrap) rawWrap.hidden = true;
    var diffWrap = m.querySelector('[data-v30-fp-scrap-diff-wrap]');
    if (diffWrap) diffWrap.hidden = true;
    var apply = m.querySelector('[data-v30-fp-scrap-apply]');
    if (apply) apply.hidden = true;
    var copy = m.querySelector('[data-v30-fp-scrap-copy]');
    if (copy) copy.hidden = true;
    var run = m.querySelector('[data-v30-fp-scrap-run]');
    if (run) { run.disabled = false; run.textContent = "Lancer l'analyse"; }
  }
  function runScrap() {
    var m = getFPModal('scrap');
    if (!m) return;
    var prompt = (m.querySelector('[data-v30-fp-scrap-prompt]') || {}).value || '';
    var web = !!(m.querySelector('[data-v30-fp-scrap-web]') || {}).checked;
    var run = m.querySelector('[data-v30-fp-scrap-run]');
    var rawWrap = m.querySelector('[data-v30-fp-scrap-raw-wrap]');
    var rawEl = m.querySelector('[data-v30-fp-scrap-raw]');
    var diffWrap = m.querySelector('[data-v30-fp-scrap-diff-wrap]');
    var diffEl = m.querySelector('[data-v30-fp-scrap-diff]');
    var apply = m.querySelector('[data-v30-fp-scrap-apply]');
    var copy = m.querySelector('[data-v30-fp-scrap-copy]');
    if (!prompt.trim()) { toast('Prompt vide', 'warning'); return; }
    if (run) { run.disabled = true; run.textContent = 'Analyse en cours…'; }
    if (apply) apply.hidden = true;
    if (diffWrap) diffWrap.hidden = true;
    if (rawWrap) rawWrap.hidden = true;
    if (copy) copy.hidden = true;

    FP.fetchPostJSON('/api/ollama/generate', { prompt: prompt, web_search: web, timeout: 180 })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'IA indisponible');
        IA_CTX.scrapText = res.text || '';
        IA_CTX.scrapJson = extractJsonMaybe(IA_CTX.scrapText);
        if (rawEl) rawEl.textContent = IA_CTX.scrapText;
        if (IA_CTX.scrapJson) {
          renderScrapDiff(diffEl, IA_CTX.scrapJson);
          if (diffWrap) diffWrap.hidden = false;
          if (apply) apply.hidden = false;
          toast('Analyse terminée — relis et applique', 'success');
        } else {
          if (rawWrap) rawWrap.hidden = false;
          if (copy) copy.hidden = false;
          toast('Réponse IA non JSON — consulte le texte brut', 'warning');
        }
      })
      .catch(function (err) { toast('Erreur IA : ' + (err.message || err), 'error'); })
      .then(function () {
        if (run) { run.disabled = false; run.textContent = "Relancer l'analyse"; }
      });
  }
  // Mapping clé JSON → champ prospect côté backend
  var SCRAP_FIELD_MAP = {
    fonction: 'fonction',
    tel: 'telephone',
    telephone: 'telephone',
    email: 'email',
    linkedin: 'linkedin',
    notes: 'notes'
  };
  function renderScrapDiff(host, json) {
    if (!host) return;
    host.innerHTML = '';
    var p = FP.STATE.prospect || {};
    var rows = [];
    Object.keys(SCRAP_FIELD_MAP).forEach(function (key) {
      var field = SCRAP_FIELD_MAP[key];
      if (!(key in json)) return;
      var nv = json[key];
      if (nv == null) return;
      nv = String(nv).trim();
      if (!nv) return;
      var cur = (p[field] == null ? '' : String(p[field])).trim();
      if (cur === nv) return;
      rows.push({ field: field, label: key, oldVal: cur, newVal: nv });
    });
    // Accroches → suggestion à concaténer aux notes
    var accroches = Array.isArray(json.accroches) ? json.accroches.filter(Boolean) : [];
    if (accroches.length) {
      var accText = accroches.map(function (a) { return '• ' + a; }).join('\n');
      var curNotes = (p.notes == null ? '' : String(p.notes)).trim();
      var newNotes = curNotes ? (curNotes + '\n\nAccroches IA :\n' + accText) : ('Accroches IA :\n' + accText);
      rows.push({ field: 'notes', label: 'accroches → notes', oldVal: curNotes, newVal: newNotes, isMerge: true });
    }
    if (!rows.length) {
      host.innerHTML = '<div class="empty" style="padding:12px;font-size:12px;">Rien à appliquer — l\'IA n\'a pas suggéré de valeur différente.</div>';
      return;
    }
    rows.forEach(function (r, idx) {
      var row = document.createElement('label');
      row.className = 'v30-fp-ai-diff__row';
      row.innerHTML =
        '<input type="checkbox" checked data-ia-diff-idx="' + idx + '">' +
        '<span class="v30-fp-ai-diff__label">' + FP.esc(r.label) + '</span>' +
        '<span class="v30-fp-ai-diff__values">' +
          (r.oldVal ? '<span class="v30-fp-ai-diff__old">' + FP.esc(r.oldVal) + '</span>' : '') +
          '<span class="v30-fp-ai-diff__new">' + FP.esc(r.newVal) + '</span>' +
        '</span>';
      host.appendChild(row);
    });
    host._rows = rows;
  }
  function applyScrap() {
    var m = getFPModal('scrap');
    if (!m) return;
    var host = m.querySelector('[data-v30-fp-scrap-diff]');
    var apply = m.querySelector('[data-v30-fp-scrap-apply]');
    if (!host || !host._rows) { toast('Rien à appliquer', 'warning'); return; }
    var selected = [];
    host.querySelectorAll('input[type="checkbox"][data-ia-diff-idx]').forEach(function (cb) {
      if (cb.checked) {
        var idx = Number(cb.dataset.iaDiffIdx);
        if (host._rows[idx]) selected.push(host._rows[idx]);
      }
    });
    if (!selected.length) { toast('Aucun champ sélectionné', 'warning'); return; }
    if (apply) apply.disabled = true;
    var chain = Promise.resolve();
    selected.forEach(function (r) {
      chain = chain.then(function () {
        return FP.saveField(r.field, r.newVal).then(function () {
          if (FP.STATE.prospect) FP.STATE.prospect[r.field] = r.newVal;
        });
      });
    });
    chain.then(function () {
      toast('Prospect enrichi', 'success');
      // Mettre à jour l'UI
      if (window.ProspFPRender && FP.STATE.prospect) {
        R.header(FP.STATE.prospect);
        R.aside(FP.STATE.prospect);
      }
      flashSaved();
      closeFPModal(m);
      var fields = selected.map(function (r) { return r.label || r.field; });
      logIaRun('scrap', fields.length ? ('Champs appliqués : ' + fields.join(', ')) : '');
    }).catch(function (err) {
      toast('Erreur application : ' + (err.message || err), 'error');
    }).then(function () {
      if (apply) apply.disabled = false;
    });
  }
  function copyScrap() {
    var txt = IA_CTX.scrapText || '';
    if (!txt) return;
    try {
      navigator.clipboard.writeText(txt).then(function () {
        toast('Texte copié', 'success');
      }, function () {
        // fallback
        var ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('Texte copié', 'success'); }
        catch (_) { toast('Copie impossible', 'error'); }
        document.body.removeChild(ta);
      });
    } catch (_) {}
  }

  // ── b) Avant RDV — fiche prépa ─────────────────────────────
  function openBeforeModal() {
    var p = FP.STATE.prospect || {};
    var m = openFPModal('before');
    if (!m) return;
    var setRecap = function (sel, val) {
      var el = m.querySelector('[data-field="' + sel + '"]');
      if (el) el.textContent = val || '—';
    };
    setRecap('recap-name', p.name || '—');
    setRecap('recap-company', getCompanyName(p) || '—');
    setRecap('recap-statut', p.statut || '—');
    setRecap('recap-rdv', FP.shortDate(p.rdvDate || p.nextFollowUp));
    var prog = m.querySelector('[data-v30-fp-before-progress]');
    if (prog) prog.hidden = true;
    var bar = m.querySelector('[data-v30-fp-before-bar]');
    if (bar) bar.style.width = '0%';
    var log = m.querySelector('[data-v30-fp-before-log]');
    if (log) log.textContent = '';
    var run = m.querySelector('[data-v30-fp-before-run]');
    if (run) { run.disabled = false; run.textContent = 'Générer et télécharger le PDF'; }
  }
  function runBefore() {
    var m = getFPModal('before');
    if (!m) return;
    var run = m.querySelector('[data-v30-fp-before-run]');
    var prog = m.querySelector('[data-v30-fp-before-progress]');
    var bar = m.querySelector('[data-v30-fp-before-bar]');
    var log = m.querySelector('[data-v30-fp-before-log]');
    if (run) { run.disabled = true; run.textContent = 'Analyse en cours…'; }
    if (prog) prog.hidden = false;
    if (bar) bar.style.width = '2%';
    if (log) log.textContent = '';

    var tokens = 0;
    var ended = false;
    var url = '/api/prospect/' + encodeURIComponent(FP.ID) + '/infos-rdv-stream';

    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'text/event-stream' } })
      .then(function (resp) {
        if (!resp.ok || !resp.body) throw new Error('Stream indisponible (HTTP ' + resp.status + ')');
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        function read() {
          return reader.read().then(function (chunk) {
            if (chunk.done) {
              if (!ended) {
                if (log) log.textContent += '\n[Fin du flux]\n';
              }
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            var parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            parts.forEach(function (p) {
              var line = p.trim();
              if (!line.startsWith('data:')) return;
              var raw = line.replace(/^data:\s*/, '');
              if (!raw) return;
              var evt;
              try { evt = JSON.parse(raw); } catch (_) { return; }
              if (evt.type === 'token') {
                tokens += 1;
                if (bar) bar.style.width = Math.min(90, 10 + tokens * 0.5) + '%';
                if (log && evt.content) {
                  log.textContent += evt.content;
                  log.scrollTop = log.scrollHeight;
                }
              } else if (evt.type === 'status' || evt.type === 'start') {
                if (log && evt.message) log.textContent += '\n[' + evt.message + ']\n';
              } else if (evt.type === 'done') {
                ended = true;
                if (bar) bar.style.width = '100%';
                if (log) log.textContent += '\n\n[Analyse terminée — téléchargement du PDF…]';
                // Télécharge le PDF en blob — le serveur le persiste et logue
                // l'événement IA. On refresh ensuite la timeline pour le badge.
                downloadRdvPdf().then(function () {
                  toast('Fiche de prépa générée et enregistrée', 'success');
                  if (FP.loadTimeline) FP.loadTimeline();
                }).catch(function (err) {
                  toast('Erreur téléchargement : ' + (err && err.message || err), 'error');
                });
                if (run) { run.disabled = false; run.textContent = 'Regénérer le PDF'; }
              } else if (evt.type === 'error') {
                ended = true;
                toast('Erreur IA — voir le texte brut', 'error');
                if (run) { run.disabled = false; run.textContent = 'Réessayer'; }
              }
            });
            return read();
          });
        }
        return read();
      })
      .catch(function (err) {
        toast('Erreur génération : ' + (err.message || err), 'error');
        if (run) { run.disabled = false; run.textContent = 'Réessayer'; }
      });
  }

  // Télécharge le PDF de fiche prépa via blob (le serveur l'enregistre).
  function downloadRdvPdf() {
    var url = '/api/prospect/' + encodeURIComponent(FP.ID) + '/download-rdv-pdf';
    return fetch(url, { credentials: 'same-origin' }).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var disp = resp.headers.get('Content-Disposition') || '';
      var match = /filename="?([^"]+)"?/.exec(disp);
      var filename = match ? match[1] : 'fiche_rdv.pdf';
      return resp.blob().then(function (blob) {
        var href = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = href; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
      });
    });
  }

  // ── c) Compte-rendu de réunion (création + édition) ─────────
  // opts: { meetingId: int|null }  → si meetingId, mode édition (charge le CR existant)
  function openAfterModal(opts) {
    opts = opts || {};
    var p = FP.STATE.prospect || {};
    IA_CTX.afterJson = null;
    IA_CTX.editingMeetingId = opts.meetingId ? Number(opts.meetingId) : null;

    var m = openFPModal('after');
    if (!m) return;
    var inner = m.querySelector('.v30-modal');
    if (inner) inner.dataset.v30CrMeetingId = IA_CTX.editingMeetingId ? String(IA_CTX.editingMeetingId) : '';

    var titleEl = m.querySelector('[data-v30-fp-after-modal-title]');
    if (titleEl) titleEl.textContent = IA_CTX.editingMeetingId ? 'Compte-rendu — édition' : 'Nouveau compte-rendu';
    var deleteBtn = m.querySelector('[data-v30-cr-delete]');
    if (deleteBtn) deleteBtn.hidden = !IA_CTX.editingMeetingId;
    var nameEl = m.querySelector('[data-v30-fp-ai-name2]');
    if (nameEl) nameEl.textContent = p.name || '—';

    var ta = m.querySelector('[data-v30-fp-after-notes]');
    if (ta) ta.value = '';
    var inputWrap = m.querySelector('[data-v30-fp-after-input]');
    if (inputWrap) inputWrap.hidden = false;
    var progressWrap = m.querySelector('[data-v30-fp-after-progress]');
    if (progressWrap) progressWrap.hidden = true;
    var run = m.querySelector('[data-v30-fp-after-run]');
    if (run) { run.disabled = false; run.textContent = 'Analyser avec IA'; }

    var s1 = m.querySelector('[data-v30-fp-after-s1]');
    var s2 = m.querySelector('[data-v30-fp-after-s2]');
    var s1btns = m.querySelector('[data-v30-fp-after-s1-btns]');
    var s2btns = m.querySelector('[data-v30-fp-after-s2-btns]');

    if (IA_CTX.editingMeetingId) {
      // Mode édition : passe direct à s2 et charge le CR
      if (s1) s1.hidden = true;
      if (s2) s2.hidden = false;
      if (s1btns) s1btns.hidden = true;
      if (s2btns) s2btns.hidden = false;
      var formHost = m.querySelector('[data-v30-fp-after-form]');
      if (formHost) formHost.innerHTML = '<div class="empty" style="padding:16px;">Chargement du CR…</div>';
      FP.fetchJSON('/api/meetings/' + IA_CTX.editingMeetingId).then(function (res) {
        if (!res || !res.ok || !res.meeting) throw new Error('CR introuvable');
        showAfterForm(m, null, res.meeting);
      }).catch(function (err) {
        if (formHost) formHost.innerHTML = '<div class="empty" style="color:var(--red);padding:16px;">Erreur : ' + FP.esc(err.message || err) + '</div>';
      });
    } else {
      // Mode création : s1 visible (saisie ou skip vers s2 vide)
      if (s1) s1.hidden = false;
      if (s2) s2.hidden = true;
      if (s1btns) s1btns.hidden = false;
      if (s2btns) s2btns.hidden = true;
    }
  }

  function skipAfterToManual() {
    var m = getFPModal('after');
    if (!m) return;
    showAfterForm(m, null, null);
  }
  function runAfter() {
    var m = getFPModal('after');
    if (!m) return;
    var ta = m.querySelector('[data-v30-fp-after-notes]');
    var notes = (ta && ta.value ? ta.value : '').trim();
    if (!notes) { toast('Saisis des notes de RDV', 'warning'); if (ta) ta.focus(); return; }

    var run = m.querySelector('[data-v30-fp-after-run]');
    var inputWrap = m.querySelector('[data-v30-fp-after-input]');
    var progressWrap = m.querySelector('[data-v30-fp-after-progress]');
    var bar = m.querySelector('[data-v30-fp-after-bar]');
    var statusEl = m.querySelector('[data-v30-fp-after-status]');
    var countEl = m.querySelector('[data-v30-fp-after-count]');
    var streamEl = m.querySelector('[data-v30-fp-after-stream]');

    if (run) { run.disabled = true; run.textContent = 'Analyse en cours…'; }
    if (inputWrap) inputWrap.hidden = true;
    if (progressWrap) progressWrap.hidden = false;
    if (bar) bar.style.width = '0%';
    if (statusEl) statusEl.textContent = 'Chargement de la grille de qualification…';
    if (countEl) countEl.textContent = '';
    if (streamEl) streamEl.textContent = '';

    var p = FP.STATE.prospect || {};
    var companyInfo = (p.company_groupe || '') + (p.company_site ? ' (' + p.company_site + ')' : '');

    fetch('/api/rdv-checklist/themes', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(themesData) {
        var themes = (themesData && themesData.themes) ? themesData.themes : [];
        // Construire le template JSON avec commentaires question pour guider l'extraction
        var themeEntries = themes.map(function(t) {
          return '"' + t.key + '": null  /* ' + t.question + ' */';
        }).join(',\n    ');

        // Prompt : extracteur strict, anti-hallucination, avec exemples concrets
        var prompt =
          'Tu es un EXTRACTEUR DE DONNÉES. Ton unique rôle est de copier ou reformuler les informations PRÉSENTES dans le texte.\n' +
          'INTERDICTION ABSOLUE : inventer, déduire, supposer, compléter avec tes connaissances.\n' +
          'Si une information n\'est pas dans le texte → null. En cas de doute → null.\n\n' +
          'CONTEXTE PROSPECT : ' + (p.name || '?') + (companyInfo ? ' @ ' + companyInfo : '') + '\n\n' +
          'COMPTE-RENDU :\n' +
          '"""\n' + notes + '\n"""\n\n' +
          'Retourne UNIQUEMENT ce JSON valide (aucun texte avant ou après, pas de markdown) :\n' +
          '{\n' +
          '  "checklist_responses": {\n    ' + themeEntries + '\n  },\n' +
          '  "resume": null,\n' +
          '  "next_action": null,\n' +
          '  "next_follow_up": null,\n' +
          '  "statut": null,\n' +
          '  "tags_suggeres": [],\n' +
          '  "notes_enrichies": null\n' +
          '}\n\n' +
          'RÈGLES STRICTES :\n' +
          '1. Chaque valeur doit être DIRECTEMENT tirée du texte ci-dessus, mot pour mot ou reformulé fidèlement\n' +
          '2. null = information ABSENTE du texte (pas une supposition)\n' +
          '3. resume = résumé factuel du compte-rendu (participants, sujets, décisions, prochaines étapes)\n' +
          '4. next_action = prochaine étape EXPLICITEMENT mentionnée dans le texte (ou null)\n' +
          '5. next_follow_up = date YYYY-MM-DD si explicitement mentionnée (ou null)\n' +
          '6. statut = UN des statuts suivants si clairement indiqué : Appelé, À rappeler, Rendez-vous, Messagerie, Pas intéressé (ou null)\n' +
          '7. JSON valide, pas de commentaires dans le JSON final\n\n' +
          'EXEMPLES CORRECTS vs INCORRECTS :\n' +
          '✓ "besoin_identifie": "Pas de besoin immédiat, priorité à faire performer l\'équipe en place"  ← dans le texte\n' +
          '✓ "taille_equipe": null  ← non mentionné → null\n' +
          '✓ "next_action": "Envoyer invitation de relance courant octobre"  ← dans le texte\n' +
          '✗ "taille_equipe": "50 personnes environ"  ← INVENTION → INTERDIT\n' +
          '✗ "process_achat": "validation hiérarchique"  ← non dit → INTERDIT';

        if (statusEl) statusEl.textContent = 'Analyse IA en cours…';
        if (bar) { bar.style.transition = 'none'; bar.style.width = '5%'; }

        return fetch('/api/ollama/generate-stream', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt, timeout: 180, temperature: 0 })
        });
      })
      .then(function(response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var sseBuffer = '';
        var accumulated = '';
        var tokenCount = 0;
        var finalText = null;

        // Barre de progression simulée (on ne connaît pas la longueur totale)
        var barProgress = 5;
        var barTick = setInterval(function() {
          if (barProgress < 90) {
            barProgress += Math.random() * 3;
            if (bar) { bar.style.transition = 'width .4s ease'; bar.style.width = Math.min(barProgress, 90) + '%'; }
          }
        }, 400);

        function readChunk() {
          return reader.read().then(function(result) {
            if (result.done) {
              clearInterval(barTick);
              return finalText !== null ? finalText : accumulated;
            }
            sseBuffer += decoder.decode(result.value, { stream: true });
            var lines = sseBuffer.split('\n');
            sseBuffer = lines.pop();

            lines.forEach(function(line) {
              if (!line.startsWith('data: ')) return;
              try {
                var ev = JSON.parse(line.slice(6));
                if (ev.type === 'start') {
                  if (statusEl) statusEl.textContent = ev.message || 'Génération en cours…';
                } else if (ev.type === 'token') {
                  if (ev.done) {
                    finalText = ev.text || '';
                  } else {
                    accumulated += ev.text || '';
                    tokenCount++;
                    if (countEl) countEl.textContent = tokenCount + ' tokens';
                    // Afficher les 3 dernières lignes non vides du JSON
                    if (streamEl) {
                      var lines2 = accumulated.split('\n').filter(function(l) { return l.trim(); });
                      streamEl.textContent = lines2.slice(-4).join('\n');
                      streamEl.scrollTop = streamEl.scrollHeight;
                    }
                  }
                } else if (ev.type === 'end') {
                  if (statusEl) statusEl.textContent = 'Analyse terminée — traitement du JSON…';
                  if (bar) { bar.style.transition = 'width .3s ease'; bar.style.width = '100%'; }
                } else if (ev.type === 'error') {
                  throw new Error(ev.message || 'Erreur IA');
                }
              } catch (e) {
                if (e.message && e.message !== 'Unexpected end of JSON input') {
                  clearInterval(barTick);
                  throw e;
                }
              }
            });
            return readChunk();
          });
        }

        return readChunk().then(function(fullText) {
          clearInterval(barTick);
          var text = fullText || accumulated;
          var json = extractJsonMaybe(text);
          if (!json) {
            if (statusEl) statusEl.textContent = 'Réponse non JSON — réessayez';
            toast('Réponse IA non JSON. Vérifiez le modèle Ollama.', 'warning', 6000);
            if (progressWrap) progressWrap.hidden = true;
            if (inputWrap) inputWrap.hidden = false;
            return;
          }
          IA_CTX.afterJson = json;
          showAfterForm(m, json);
          toast('Analyse terminée — vérifiez et complétez les champs', 'success', 4000);
        });
      })
      .catch(function(err) {
        toast('Erreur IA : ' + (err.message || err), 'error');
        if (progressWrap) progressWrap.hidden = true;
        if (inputWrap) inputWrap.hidden = false;
      })
      .then(function() {
        if (run) { run.disabled = false; run.textContent = 'Relancer'; }
      });
  }
  // Rendu du formulaire CR (étape 2). Trois sources possibles, dans cet ordre :
  //   1. existing : meeting persisté en base (mode édition)
  //   2. json     : sortie IA d'un parsing fraîchement effectué
  //   3. ni l'un ni l'autre → formulaire vide (saisie manuelle)
  function showAfterForm(m, json, existing) {
    if (!m) return;
    var s1 = m.querySelector('[data-v30-fp-after-s1]');
    var s2 = m.querySelector('[data-v30-fp-after-s2]');
    var s1btns = m.querySelector('[data-v30-fp-after-s1-btns]');
    var s2btns = m.querySelector('[data-v30-fp-after-s2-btns]');
    var formHost = m.querySelector('[data-v30-fp-after-form]');
    if (!formHost) return;

    formHost.innerHTML = '<div class="empty" style="padding:16px;">Chargement de la grille…</div>';
    if (s1) s1.hidden = true;
    if (s2) s2.hidden = false;
    if (s1btns) s1btns.hidden = true;
    if (s2btns) s2btns.hidden = false;

    var rawTranscriptFromS1 = '';
    var ta = m.querySelector('[data-v30-fp-after-notes]');
    if (ta && ta.value) rawTranscriptFromS1 = ta.value;

    var valOrEmpty = function (v) {
      if (v == null) return '';
      var s = String(v).trim();
      return (s.toLowerCase() === 'null') ? '' : s;
    };

    // Préchargement valeurs ; existing prime sur json
    var src = {};
    if (existing) {
      // Forme attendue de la grille en base : {key: {reponse, checked}} OU {key: "valeur"}
      var checklistFromExisting = {};
      if (existing.checklist_data && typeof existing.checklist_data === 'object') {
        Object.keys(existing.checklist_data).forEach(function (k) {
          var v = existing.checklist_data[k];
          if (v == null) return;
          if (typeof v === 'object') checklistFromExisting[k] = v.reponse || '';
          else checklistFromExisting[k] = String(v);
        });
      }
      src = {
        title: existing.title || '',
        date: existing.date || '',
        summary: existing.summary || '',
        next_action: existing.next_action || '',
        statut: '',
        tags: Array.isArray(existing.tags) ? existing.tags.join(', ') : (existing.tags || ''),
        notes: existing.notes || '',
        raw_transcript: existing.raw_transcript || '',
        documents: existing.documents || '',
        checklist: checklistFromExisting,
        action_items: Array.isArray(existing.action_items) ? existing.action_items : []
      };
    } else if (json) {
      var checklistFromJson = {};
      if (json.checklist_responses && typeof json.checklist_responses === 'object') {
        Object.keys(json.checklist_responses).forEach(function (k) {
          checklistFromJson[k] = valOrEmpty(json.checklist_responses[k]);
        });
      }
      var tagsArr = Array.isArray(json.tags_suggeres) ? json.tags_suggeres.filter(Boolean) : [];
      src = {
        title: '',
        date: '',
        summary: valOrEmpty(json.resume || json.summary),
        next_action: valOrEmpty(json.next_action),
        statut: valOrEmpty(json.statut),
        tags: tagsArr.join(', '),
        notes: valOrEmpty(json.notes_enrichies),
        raw_transcript: rawTranscriptFromS1,
        documents: '',
        checklist: checklistFromJson,
        action_items: []
      };
    } else {
      src = {
        title: '', date: '', summary: '', next_action: '', statut: '',
        tags: '', notes: '', raw_transcript: rawTranscriptFromS1, documents: '',
        checklist: {}, action_items: []
      };
    }

    if (!src.date) src.date = new Date().toISOString().slice(0, 10);
    if (!src.title) {
      var p = FP.STATE.prospect || {};
      var dStr = '';
      try { dStr = new Date(src.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
      catch (_) { dStr = src.date; }
      src.title = 'CR ' + dStr + (p.name ? ' — ' + p.name : '');
    }

    fetch('/api/rdv-checklist/themes', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (td) {
        var themes = (td && td.themes) ? td.themes : [];
        var html = '';

        // ── Identité du CR : titre + date ──
        html += '<div class="v30-grille-section-title">Compte-rendu</div>';
        html += '<div class="v30-cr-row">';
        html += '<div class="v30-grille-item v30-cr-row__title">' +
          '<label class="v30-grille-label">Titre</label>' +
          '<input type="text" class="v30-grille-select" data-after-field="title" value="' + FP.esc(src.title) + '" placeholder="CR du 28/04/26 — Stanislas H."></div>';
        html += '<div class="v30-grille-item v30-cr-row__date">' +
          '<label class="v30-grille-label">Date</label>' +
          '<input type="date" class="v30-grille-select" data-after-field="date" value="' + FP.esc(src.date) + '"></div>';
        html += '</div>';

        // ── Synthèse ──
        html += '<div class="v30-grille-section-title">Synthèse</div>';
        html += '<div class="v30-grille-item">' +
          '<label class="v30-grille-label">Résumé de la réunion</label>' +
          '<textarea class="v30-grille-textarea" data-after-field="summary" rows="4" placeholder="3-5 lignes : participants, sujets, décisions, prochaines étapes…">' +
          FP.esc(src.summary) + '</textarea></div>';
        html += '<div class="v30-grille-item">' +
          '<label class="v30-grille-label">Prochaine action</label>' +
          '<textarea class="v30-grille-textarea" data-after-field="next_action" rows="2" placeholder="Ex : Envoyer 2 profils C++ embarqué d\'ici vendredi">' +
          FP.esc(src.next_action) + '</textarea></div>';

        var statutOptions = ['Appelé', 'À rappeler', 'Rendez-vous', 'Messagerie', 'Pas intéressé'];
        html += '<div class="v30-cr-row">';
        html += '<div class="v30-grille-item v30-cr-row__half"><label class="v30-grille-label">Nouveau statut prospect</label>' +
          '<select class="v30-grille-select" data-after-field="statut">' +
          '<option value="">— inchangé —</option>' +
          statutOptions.map(function (s) {
            return '<option value="' + FP.esc(s) + '"' + (src.statut === s ? ' selected' : '') + '>' + FP.esc(s) + '</option>';
          }).join('') + '</select></div>';
        html += '<div class="v30-grille-item v30-cr-row__half"><label class="v30-grille-label">Tags (séparés par virgules)</label>' +
          '<input type="text" class="v30-grille-select" data-after-field="tags" value="' + FP.esc(src.tags) + '" placeholder="tag1, tag2"></div>';
        html += '</div>';

        html += '<div class="v30-grille-item">' +
          '<label class="v30-grille-label">Infos clés à mémoriser</label>' +
          '<textarea class="v30-grille-textarea" data-after-field="notes" rows="2" placeholder="Taille équipe, techno, budget, process achat…">' +
          FP.esc(src.notes) + '</textarea></div>';

        // ── Notes brutes / transcription ──
        html += '<div class="v30-grille-section-title">Notes brutes / transcription</div>';
        html += '<div class="v30-grille-item">' +
          '<label class="v30-grille-label">Texte original (utilisé pour relancer l\'IA, optionnel)</label>' +
          '<textarea class="v30-grille-textarea" data-after-field="raw_transcript" rows="5" placeholder="Colle ici tes notes brutes ou la transcription complète de la réunion.">' +
          FP.esc(src.raw_transcript) + '</textarea></div>';

        // ── Tâches à faire ──
        html += '<div class="v30-grille-section-title">Tâches à faire après réunion</div>';
        html += '<div class="v30-cr-tasks" data-v30-cr-tasks>';
        if (src.action_items.length) {
          src.action_items.forEach(function (ai) { html += renderCRTaskRow(ai); });
        } else {
          html += renderCRTaskRow(null);
        }
        html += '</div>';
        html += '<button type="button" class="btn btn-ghost btn-sm" data-v30-cr-task-add style="margin-top:6px;">+ Ajouter une tâche</button>';

        // ── Documents / pièces jointes ──
        html += '<div class="v30-grille-section-title">Documents / pièces jointes</div>';
        html += '<div class="v30-grille-item">' +
          '<label class="v30-grille-label">Liens, références, noms de fichiers (un par ligne)</label>' +
          '<textarea class="v30-grille-textarea" data-after-field="documents" rows="3" placeholder="Devis_v2.pdf&#10;https://drive.google.com/...&#10;Présentation projet — sharepoint">' +
          FP.esc(src.documents) + '</textarea></div>';

        // ── Grille de qualif ──
        html += '<div class="v30-grille-section-title">Grille de qualification (' + themes.length + ' questions)</div>';
        themes.forEach(function (t) {
          var val = src.checklist[t.key] || '';
          html += '<div class="v30-grille-item">' +
            '<label class="v30-grille-label">' + FP.esc(t.question) + '</label>' +
            '<textarea class="v30-grille-textarea" data-grille-key="' + FP.esc(t.key) + '" rows="2" placeholder="—">' +
            FP.esc(val) + '</textarea></div>';
        });

        formHost.innerHTML = html;
      })
      .catch(function (err) {
        if (formHost) formHost.innerHTML = '<div class="empty" style="color:var(--red);padding:16px;">Erreur chargement grille : ' + FP.esc(err.message) + '</div>';
      });
  }

  function renderCRTaskRow(ai) {
    ai = ai || {};
    var taskTxt = FP.esc(ai.task || '');
    var dueDate = FP.esc(ai.due_date || '');
    var prio = ai.priority || '';
    var done = ai.status === 'done';
    var prioOpts = ['', 'haute', 'moyenne', 'basse'].map(function (p) {
      return '<option value="' + FP.esc(p) + '"' + (prio === p ? ' selected' : '') + '>' + (p ? FP.esc(p) : '— priorité —') + '</option>';
    }).join('');
    return '<div class="v30-cr-task" data-v30-cr-task>' +
      '<input type="checkbox" class="v30-cr-task__check" data-cr-task-done' + (done ? ' checked' : '') + ' aria-label="Tâche terminée">' +
      '<input type="text" class="v30-grille-select v30-cr-task__txt" data-cr-task-text value="' + taskTxt + '" placeholder="Action concrète à mener">' +
      '<input type="date" class="v30-grille-select v30-cr-task__date" data-cr-task-due value="' + dueDate + '">' +
      '<select class="v30-grille-select v30-cr-task__prio" data-cr-task-prio>' + prioOpts + '</select>' +
      '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-v30-cr-task-rm aria-label="Retirer">×</button>' +
      '</div>';
  }

  function saveAfterForm() {
    var m = getFPModal('after');
    if (!m) return;
    var formHost = m.querySelector('[data-v30-fp-after-form]');
    if (!formHost) return;
    var saveBtn = m.querySelector('[data-v30-fp-after-save]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Enregistrement…'; }

    var getVal = function (sel) { var el = formHost.querySelector(sel); return el ? (el.value || '').trim() : ''; };
    var title = getVal('input[data-after-field="title"]');
    var date = getVal('input[data-after-field="date"]');
    var summary = getVal('textarea[data-after-field="summary"]');
    var nextAction = getVal('textarea[data-after-field="next_action"]');
    var statut = getVal('select[data-after-field="statut"]');
    var tagsRaw = getVal('input[data-after-field="tags"]');
    var notesField = getVal('textarea[data-after-field="notes"]');
    var rawTranscript = getVal('textarea[data-after-field="raw_transcript"]');
    var documents = getVal('textarea[data-after-field="documents"]');
    var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];

    if (!title) { toast('Le titre du CR est requis', 'warning'); if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer'; } return; }
    if (!date) { toast('La date du CR est requise', 'warning'); if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer'; } return; }

    // Grille (snapshot dans le CR + agrège dans la grille globale plus bas)
    var checklistData = {};
    formHost.querySelectorAll('textarea[data-grille-key]').forEach(function (ta) {
      var key = ta.dataset.grilleKey;
      var val = (ta.value || '').trim();
      checklistData[key] = { reponse: val, checked: val !== '' };
    });

    // Tâches dynamiques
    var actionItems = [];
    formHost.querySelectorAll('[data-v30-cr-task]').forEach(function (row) {
      var taskTxt = (row.querySelector('[data-cr-task-text]') || {}).value || '';
      taskTxt = taskTxt.trim();
      if (!taskTxt) return;
      actionItems.push({
        task: taskTxt,
        due_date: ((row.querySelector('[data-cr-task-due]') || {}).value || '').trim() || null,
        priority: ((row.querySelector('[data-cr-task-prio]') || {}).value || '').trim() || null,
        status: (row.querySelector('[data-cr-task-done]') || {}).checked ? 'done' : 'pending'
      });
    });

    var payload = {
      prospect_id: FP.ID,
      title: title,
      date: date,
      checklist_data: checklistData,
      notes: notesField,
      summary: summary,
      next_action: nextAction,
      tags: tags,
      raw_transcript: rawTranscript,
      documents: documents,
      action_items: actionItems
    };

    var meetingId = IA_CTX.editingMeetingId;
    var chain;
    if (meetingId) {
      chain = fetch('/api/meetings/' + meetingId, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    } else {
      chain = FP.fetchPostJSON('/api/meetings', payload);
    }

    chain = chain.then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Échec enregistrement CR');

      // Propage la grille de qualif vers le formulaire global du prospect
      // (vue cumulative : on ne perd rien des autres réunions)
      var hasChecklist = Object.keys(checklistData).some(function (k) { return checklistData[k].reponse; });
      if (!hasChecklist) return null;
      return fetch('/api/rdv-checklist?prospect_id=' + FP.ID, { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (existing) {
          var data = (existing && existing.data) ? existing.data : {};
          Object.keys(checklistData).forEach(function (key) {
            if (checklistData[key].reponse) data[key] = checklistData[key];
          });
          return FP.fetchPostJSON('/api/rdv-checklist', { prospect_id: FP.ID, data: data });
        });
    });

    if (statut) {
      chain = chain.then(function () {
        return FP.fetchPostJSON('/api/prospects/bulk-edit', { ids: [FP.ID], field: 'statut', value: statut })
          .then(function () { if (FP.STATE.prospect) FP.STATE.prospect.statut = statut; });
      });
    }
    if (tags.length) {
      chain = chain.then(function () {
        return FP.fetchPostJSON('/api/prospects/bulk-status-tags', { ids: [FP.ID], add_tags: tags });
      });
    }

    chain
      .then(function () { return logIaRun('after', meetingId ? 'CR mis à jour' : 'CR enregistré'); })
      .then(function () { return FP.loadTimeline(); })
      .then(function () {
        if (window.ProspFPRender) window.ProspFPRender.all(FP.STATE);
        flashSaved();
        closeFPModal(m);
        toast(meetingId ? 'Compte-rendu mis à jour' : 'Compte-rendu enregistré', 'success');
        loadCRTab();
      })
      .catch(function (err) { toast('Erreur : ' + (err.message || err), 'error'); })
      .then(function () {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer'; }
      });
  }

  // ── d-bis) Onglet "CR" — listing des comptes-rendus ──────────
  function shortDateFR(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }); }
    catch (_) { return iso; }
  }

  function loadCRTab() {
    var host = document.querySelector('[data-v30-cr-list]');
    var counter = document.querySelector('[data-field="count-cr"]');
    if (!host) return;
    host.innerHTML = '<div class="empty" style="padding:16px;">Chargement…</div>';
    FP.fetchJSON('/api/meetings?prospect_id=' + FP.ID).then(function (res) {
      var meetings = (res && res.meetings) || [];
      if (counter) counter.textContent = meetings.length || '—';
      if (!meetings.length) {
        host.innerHTML = '<div class="empty" style="padding:16px;">Aucun compte-rendu pour ce prospect. Cliquez « Nouveau CR » pour en créer un.</div>';
        return;
      }
      host.innerHTML = '<div class="v30-cr-list">' + meetings.map(function (m) {
        var dateStr = shortDateFR(m.date);
        var preview = (m.summary || m.notes || m.raw_transcript || '').replace(/\s+/g, ' ').trim();
        if (preview.length > 220) preview = preview.slice(0, 217) + '…';
        var pendingBadge = m.action_pending > 0
          ? '<span class="v30-cr-card__pending" title="Tâches en attente">' + m.action_pending + ' à faire</span>'
          : '';
        var taskBadge = m.action_count > 0
          ? '<span class="v30-cr-card__count">' + m.action_count + ' tâche' + (m.action_count > 1 ? 's' : '') + '</span>'
          : '';
        var tagsHtml = (m.tags && m.tags.length)
          ? '<div class="v30-cr-card__tags">' + m.tags.slice(0, 6).map(function (t) {
              return '<span class="v30-cr-card__tag">' + FP.esc(t) + '</span>';
            }).join('') + '</div>'
          : '';
        return '<button type="button" class="v30-cr-card" data-v30-cr-card="' + m.id + '">' +
          '<div class="v30-cr-card__head">' +
            '<strong class="v30-cr-card__date">CR du ' + FP.esc(dateStr) + '</strong>' +
            taskBadge + pendingBadge +
          '</div>' +
          '<div class="v30-cr-card__title">' + FP.esc(m.title || ('CR ' + dateStr)) + '</div>' +
          (preview ? '<p class="v30-cr-card__excerpt">' + FP.esc(preview) + '</p>' : '') +
          tagsHtml +
        '</button>';
      }).join('') + '</div>';
    }).catch(function (err) {
      host.innerHTML = '<div class="empty" style="color:var(--red);padding:16px;">Erreur : ' + FP.esc(err.message || err) + '</div>';
      if (counter) counter.textContent = '—';
    });
  }

  function deleteCR(meetingId) {
    if (!meetingId) return;
    if (!confirm('Supprimer définitivement ce compte-rendu et ses tâches ?')) return;
    fetch('/api/meetings/' + meetingId, { method: 'DELETE', credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Échec suppression');
        toast('Compte-rendu supprimé', 'success');
        var m = getFPModal('after');
        if (m && m.classList.contains('is-open')) closeFPModal(m);
        loadCRTab();
      })
      .catch(function (err) { toast('Erreur : ' + (err.message || err), 'error'); });
  }

  // ── d) Grille de qualification (onglet) ──────────────────────
  function loadGrilleTab() {
    var content = document.querySelector('[data-v30-grille-content]');
    if (!content) return;
    content.innerHTML = '<div class="empty" style="padding:16px;">Chargement…</div>';

    Promise.all([
      fetch('/api/rdv-checklist/themes', { credentials: 'include' }).then(function(r) { return r.json(); }),
      fetch('/api/rdv-checklist?prospect_id=' + FP.ID, { credentials: 'include' }).then(function(r) { return r.json(); })
    ]).then(function(results) {
      var themes = (results[0] && results[0].themes) ? results[0].themes : [];
      var data = (results[1] && results[1].data) ? results[1].data : {};
      var html = themes.map(function(t) {
        var val = (data[t.key] && data[t.key].reponse) ? data[t.key].reponse : '';
        return '<div class="v30-grille-item">' +
          '<label class="v30-grille-label" for="grille_' + FP.esc(t.key) + '">' + FP.esc(t.question) + '</label>' +
          '<textarea id="grille_' + FP.esc(t.key) + '" class="v30-grille-textarea" data-grille-key="' + FP.esc(t.key) + '" rows="2" placeholder="—">' +
          FP.esc(val) + '</textarea></div>';
      }).join('');
      content.innerHTML = html || '<div class="empty" style="padding:16px;">Aucune question disponible.</div>';
    }).catch(function(err) {
      content.innerHTML = '<div class="empty" style="color:var(--red);padding:16px;">Erreur : ' + FP.esc(err.message) + '</div>';
    });
  }

  function saveGrille() {
    var content = document.querySelector('[data-v30-grille-content]');
    if (!content) return;
    var btn = document.querySelector('[data-v30-grille-save]');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    var data = {};
    content.querySelectorAll('textarea[data-grille-key]').forEach(function(ta) {
      var key = ta.dataset.grilleKey;
      data[key] = { reponse: ta.value.trim(), checked: ta.value.trim() !== '' };
    });

    FP.fetchPostJSON('/api/rdv-checklist', { prospect_id: FP.ID, data: data })
      .then(function() { toast('Grille enregistrée', 'success'); flashSaved(); })
      .catch(function(err) { toast('Erreur : ' + (err.message || err), 'error'); })
      .then(function() { if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; } });
  }

  function bindFPModals() {
    // Close handlers (click close / backdrop / Escape)
    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-v30-fp-modal-close]');
      if (close) {
        var m = close.closest('[data-v30-fp-modal]');
        if (m) closeFPModal(m);
        return;
      }
      var bd = e.target.closest('.v30-modal-bd[data-v30-fp-modal]');
      if (bd && e.target === bd) closeFPModal(bd);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.v30-modal-bd.is-open[data-v30-fp-modal]').forEach(function (m) {
        closeFPModal(m);
      });
    });

    // Scrap + IA handlers
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-fp-scrap-run]')) runScrap();
      if (e.target.closest('[data-v30-fp-scrap-apply]')) applyScrap();
      if (e.target.closest('[data-v30-fp-scrap-copy]')) copyScrap();
      if (e.target.closest('[data-v30-fp-before-run]')) runBefore();
      if (e.target.closest('[data-v30-fp-after-run]')) runAfter();
      if (e.target.closest('[data-v30-fp-after-save]')) saveAfterForm();
      if (e.target.closest('[data-v30-fp-after-back]')) {
        var m = getFPModal('after');
        if (m) {
          var s1 = m.querySelector('[data-v30-fp-after-s1]');
          var s2 = m.querySelector('[data-v30-fp-after-s2]');
          var s1b = m.querySelector('[data-v30-fp-after-s1-btns]');
          var s2b = m.querySelector('[data-v30-fp-after-s2-btns]');
          if (s1) s1.hidden = false; if (s2) s2.hidden = true;
          if (s1b) s1b.hidden = false; if (s2b) s2b.hidden = true;
        }
      }
      // Grille tab buttons
      if (e.target.closest('[data-v30-grille-save]')) saveGrille();
      if (e.target.closest('[data-v30-after-rdv-btn]')) openAfterModal();

      // CR tab + modale CR
      if (e.target.closest('[data-v30-cr-new]')) openAfterModal();
      if (e.target.closest('[data-v30-fp-after-skip]')) skipAfterToManual();
      var crCard = e.target.closest('[data-v30-cr-card]');
      if (crCard) {
        var mid = Number(crCard.dataset.v30CrCard || 0);
        if (mid) openAfterModal({ meetingId: mid });
      }
      if (e.target.closest('[data-v30-cr-delete]')) {
        var mInner = getFPModal('after');
        var inner = mInner && mInner.querySelector('.v30-modal');
        var mid2 = inner && inner.dataset.v30CrMeetingId ? Number(inner.dataset.v30CrMeetingId) : 0;
        if (mid2) deleteCR(mid2);
      }
      if (e.target.closest('[data-v30-cr-task-add]')) {
        var modalA = getFPModal('after');
        var host = modalA && modalA.querySelector('[data-v30-cr-tasks]');
        if (host) host.insertAdjacentHTML('beforeend', renderCRTaskRow(null));
      }
      var rmBtn = e.target.closest('[data-v30-cr-task-rm]');
      if (rmBtn) {
        var row = rmBtn.closest('[data-v30-cr-task]');
        if (row) row.remove();
      }
    });
  }

  // ─── Actions header (push / schedule / appeler / more) ──────
  function bindHeaderActions() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v30-action]');
      if (!btn) return;
      var act = btn.dataset.v30Action;
      if (act === 'push') {
        // Popup v30 (logique v29) — chargé globalement via base.html
        if (window.V30PushModal && typeof window.V30PushModal.open === 'function') {
          window.V30PushModal.open(FP.ID, 'email');
        } else {
          // Fallback de secours si le module n'est pas chargé
          window.location.href = '/v30/push?ids=' + FP.ID;
        }
      } else if (act === 'schedule') {
        var p = FP.STATE.prospect || {};
        var params = new URLSearchParams();
        params.set('prospect', FP.ID);
        if (p.name) params.set('prospect_name', p.name);
        window.location.href = '/v30/calendrier?' + params.toString();
      } else if (act === 'more') {
        e.stopPropagation();
        openMoreMenu(btn);
      }
    });

    // Log-call sur le bouton "Appeler" (a[data-field="tel-link"])
    document.addEventListener('click', function (e) {
      var link = e.target.closest('[data-field="tel-link"]');
      if (!link) return;
      FP.fetchPostJSON('/api/prospect/log-call', { prospect_id: FP.ID })
        .then(function (res) {
          if (!res || !res.ok) return;
          var now = res.lastContact || new Date().toISOString();
          if (FP.STATE.prospect) {
            FP.STATE.prospect.lastContact = now;
            R.aside(FP.STATE.prospect);
          }
        })
        .catch(function () {});
    });
  }

  // ─── Init ───────────────────────────────────────────────────
  function init() {
    bindInlineEdit();
    bindTagAdd();
    bindCompanyEdit();
    bindStatusEdit();
    bindRdvEdit();
    bindTabs();
    bindActivityFilter();
    bindEditNotes();
    bindAddNote();
    bindDrawer();
    bindFPModals();
    bindHeaderActions();
    FP.loadTimeline();
    // Compteur de l'onglet CR — appel léger en arrière-plan
    if (typeof loadCRTab === 'function') loadCRTab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
