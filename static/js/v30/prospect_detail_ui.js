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

  // ── c) Après RDV — compte-rendu ─────────────────────────────
  function openAfterModal() {
    var p = FP.STATE.prospect || {};
    IA_CTX.afterJson = null;
    var m = openFPModal('after');
    if (!m) return;
    var nameEl = m.querySelector('[data-v30-fp-ai-name2]');
    if (nameEl) nameEl.textContent = p.name || '—';
    var ta = m.querySelector('[data-v30-fp-after-notes]');
    if (ta) ta.value = '';
    var rawWrap = m.querySelector('[data-v30-fp-after-raw-wrap]');
    if (rawWrap) rawWrap.hidden = true;
    var applyWrap = m.querySelector('[data-v30-fp-after-apply-wrap]');
    if (applyWrap) applyWrap.hidden = true;
    var applyBtn = m.querySelector('[data-v30-fp-after-apply-btn]');
    if (applyBtn) applyBtn.hidden = true;
    var run = m.querySelector('[data-v30-fp-after-run]');
    if (run) { run.disabled = false; run.textContent = 'Analyser'; }
  }
  function runAfter() {
    var m = getFPModal('after');
    if (!m) return;
    var ta = m.querySelector('[data-v30-fp-after-notes]');
    var notes = (ta && ta.value ? ta.value : '').trim();
    if (!notes) { toast('Saisis des notes de RDV', 'warning'); if (ta) ta.focus(); return; }
    var run = m.querySelector('[data-v30-fp-after-run]');
    var rawWrap = m.querySelector('[data-v30-fp-after-raw-wrap]');
    var rawEl = m.querySelector('[data-v30-fp-after-raw]');
    var applyWrap = m.querySelector('[data-v30-fp-after-apply-wrap]');
    var applyHost = m.querySelector('[data-v30-fp-after-apply]');
    var applyBtn = m.querySelector('[data-v30-fp-after-apply-btn]');
    var prompt = "Analyse ces notes de RDV et retourne un JSON STRICT (aucun texte autour, pas de markdown) :" +
      '\n{"resume": "", "prochaines_etapes": ["", ""], "niveau_interet": "faible|moyen|fort", "actions_immediates": ["", ""], "tags_suggeres": ["", ""]}' +
      "\nRemplis chaque clé avec le contenu pertinent. Pour niveau_interet, mets un seul mot : faible, moyen ou fort." +
      "\nNotes : " + notes;
    if (run) { run.disabled = true; run.textContent = 'Analyse en cours…'; }
    if (rawWrap) rawWrap.hidden = true;
    if (applyWrap) applyWrap.hidden = true;
    if (applyBtn) applyBtn.hidden = true;

    FP.fetchPostJSON('/api/ollama/generate', { prompt: prompt, timeout: 120 })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'IA indisponible');
        var text = res.text || '';
        var json = extractJsonMaybe(text);
        if (rawEl) rawEl.textContent = text;
        if (rawWrap) rawWrap.hidden = false;
        if (!json) {
          IA_CTX.afterJson = null;
          toast('Réponse IA non JSON — consulte le texte brut', 'warning');
          return;
        }
        IA_CTX.afterJson = json;
        renderAfterApply(applyHost, json, notes);
        if (applyWrap) applyWrap.hidden = false;
        if (applyBtn) applyBtn.hidden = false;
        toast('Analyse terminée', 'success');
      })
      .catch(function (err) { toast('Erreur IA : ' + (err.message || err), 'error'); })
      .then(function () {
        if (run) { run.disabled = false; run.textContent = 'Relancer'; }
      });
  }
  function renderAfterApply(host, json, notes) {
    if (!host) return;
    host.innerHTML = '';
    var rows = [];

    var resume = (json.resume || '').toString().trim();
    var actionsImm = Array.isArray(json.actions_immediates) ? json.actions_immediates.filter(Boolean) : [];
    var etapes = Array.isArray(json.prochaines_etapes) ? json.prochaines_etapes.filter(Boolean) : [];
    var tags = Array.isArray(json.tags_suggeres) ? json.tags_suggeres.filter(Boolean) : [];
    var niveau = (json.niveau_interet || '').toString();

    // 1. Ajouter résumé + actions comme événement timeline
    if (resume || actionsImm.length || etapes.length) {
      var parts = [];
      if (resume) parts.push(resume);
      if (actionsImm.length) parts.push('\nActions immédiates :\n' + actionsImm.map(function (a) { return '• ' + a; }).join('\n'));
      if (etapes.length) parts.push('\nProchaines étapes :\n' + etapes.map(function (a) { return '• ' + a; }).join('\n'));
      if (niveau) parts.push('\nNiveau d\'intérêt : ' + niveau);
      rows.push({
        kind: 'event',
        label: 'Ajouter compte-rendu à la timeline',
        preview: parts.join('\n'),
        payload: { title: 'Compte-rendu RDV', content: parts.join('\n') }
      });
    }
    // 2. Ajouter tags
    if (tags.length) {
      rows.push({
        kind: 'tags',
        label: 'Ajouter tags : ' + tags.join(', '),
        preview: tags.join(', '),
        payload: { tags: tags }
      });
    }
    // 3. Sauvegarde brut des notes → note prospect.notes (merge)
    if (notes && notes.length) {
      var p = FP.STATE.prospect || {};
      var curNotes = (p.notes == null ? '' : String(p.notes)).trim();
      var datePrefix = new Date().toLocaleDateString('fr-FR');
      var newNotes = curNotes
        ? (curNotes + '\n\n[Notes RDV ' + datePrefix + ']\n' + notes)
        : ('[Notes RDV ' + datePrefix + ']\n' + notes);
      rows.push({
        kind: 'notes',
        label: 'Ajouter mes notes au champ Notes',
        preview: notes,
        payload: { value: newNotes }
      });
    }
    if (!rows.length) {
      host.innerHTML = '<div class="empty" style="padding:12px;font-size:12px;">Rien à appliquer.</div>';
      return;
    }
    rows.forEach(function (r, idx) {
      var row = document.createElement('label');
      row.className = 'v30-fp-ai-diff__row';
      var checked = 'checked';
      row.innerHTML =
        '<input type="checkbox" ' + checked + ' data-ia-after-idx="' + idx + '">' +
        '<span class="v30-fp-ai-diff__label">' + FP.esc(r.kind) + '</span>' +
        '<span class="v30-fp-ai-diff__values">' +
          '<span class="v30-fp-ai-diff__new"><b>' + FP.esc(r.label) + '</b></span>' +
          '<span class="muted" style="font-size:11.5px;white-space:pre-wrap;">' + FP.esc(r.preview.slice(0, 300)) + (r.preview.length > 300 ? '…' : '') + '</span>' +
        '</span>';
      host.appendChild(row);
    });
    host._rows = rows;
  }
  function applyAfter() {
    var m = getFPModal('after');
    if (!m) return;
    var host = m.querySelector('[data-v30-fp-after-apply]');
    var applyBtn = m.querySelector('[data-v30-fp-after-apply-btn]');
    if (!host || !host._rows) return;
    var selected = [];
    host.querySelectorAll('input[type="checkbox"][data-ia-after-idx]').forEach(function (cb) {
      if (cb.checked) {
        var idx = Number(cb.dataset.iaAfterIdx);
        if (host._rows[idx]) selected.push(host._rows[idx]);
      }
    });
    if (!selected.length) { toast('Aucune action sélectionnée', 'warning'); return; }
    if (applyBtn) applyBtn.disabled = true;
    var chain = Promise.resolve();
    selected.forEach(function (r) {
      if (r.kind === 'event') {
        chain = chain.then(function () {
          return FP.fetchPostJSON('/api/prospect/events/add', {
            prospect_id: FP.ID,
            title: r.payload.title,
            content: r.payload.content
          });
        });
      } else if (r.kind === 'tags') {
        chain = chain.then(function () {
          return FP.fetchPostJSON('/api/prospects/bulk-status-tags', {
            ids: [FP.ID],
            add_tags: r.payload.tags
          });
        });
      } else if (r.kind === 'notes') {
        chain = chain.then(function () {
          return FP.saveField('notes', r.payload.value).then(function () {
            if (FP.STATE.prospect) FP.STATE.prospect.notes = r.payload.value;
          });
        });
      }
    });
    chain.then(function () {
      toast('Compte-rendu appliqué', 'success');
      var kinds = selected.map(function (r) { return r.kind; });
      return logIaRun('after', 'Appliqué : ' + kinds.join(', '));
    }).then(function () {
      // Rafraîchir timeline + aside (logIaRun a déjà appelé loadTimeline,
      // mais on réassure ici pour les apply qui n'ont rien loggué).
      return FP.loadTimeline();
    }).then(function () {
      flashSaved();
      closeFPModal(m);
    }).catch(function (err) {
      toast('Erreur application : ' + (err.message || err), 'error');
    }).then(function () {
      if (applyBtn) applyBtn.disabled = false;
    });
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

    // Scrap handlers
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-v30-fp-scrap-run]')) runScrap();
      if (e.target.closest('[data-v30-fp-scrap-apply]')) applyScrap();
      if (e.target.closest('[data-v30-fp-scrap-copy]')) copyScrap();
      if (e.target.closest('[data-v30-fp-before-run]')) runBefore();
      if (e.target.closest('[data-v30-fp-after-run]')) runAfter();
      if (e.target.closest('[data-v30-fp-after-apply-btn]')) applyAfter();
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
