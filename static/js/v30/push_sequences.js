/* ProspUp v30 — Séquences push (Phase 4 productivité).

   Suggestions guidées : aucun envoi auto. L'utilisateur exécute chaque
   étape en 1 clic (ouvre push modal / tel: / LinkedIn / marque comme fait).

   Expose window.V30PushSequences.{mountFocusSection, openEnrollModal}.
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

  var CHANNEL_META = {
    email:    { label: 'Email',    icon: 'M', cls: 'pseq-channel--email' },
    call:     { label: 'Appel',    icon: 'C', cls: 'pseq-channel--call' },
    linkedin: { label: 'LinkedIn', icon: 'L', cls: 'pseq-channel--linkedin' },
    wait:     { label: 'Attendre', icon: '·', cls: 'pseq-channel--wait' }
  };
  function channelMeta(c) { return CHANNEL_META[c] || CHANNEL_META.email; }

  var CONDITION_LABEL = {
    always: 'Toujours',
    if_not_opened: 'Si non-ouvert',
    if_not_replied: 'Si pas de réponse'
  };

  // ─── 1) Section Focus : étapes dues ──────────────────────
  function mountFocusSection() {
    var section = document.querySelector('[data-v30-focus-pseq]');
    var list = section && section.querySelector('[data-v30-focus-pseq-list]');
    var countEl = section && section.querySelector('[data-field="pseq-count"]');
    if (!section || !list) return;

    function executeStep(prospect, step) {
      var ch = step.channel;
      if (ch === 'email') {
        if (window.V30PushModal && typeof window.V30PushModal.open === 'function') {
          window.V30PushModal.open(prospect.id, 'email');
        } else if (prospect.email) {
          window.location.href = 'mailto:' + encodeURIComponent(prospect.email);
        } else {
          toast("Pas d'email — étape à traiter manuellement", 'warning');
        }
      } else if (ch === 'linkedin') {
        if (prospect.linkedin) {
          window.open(prospect.linkedin, '_blank', 'noopener');
        } else if (window.V30PushModal && typeof window.V30PushModal.open === 'function') {
          window.V30PushModal.open(prospect.id, 'linkedin');
        } else {
          toast('Pas de LinkedIn — étape à traiter manuellement', 'warning');
        }
      } else if (ch === 'call') {
        if (prospect.telephone) {
          window.location.href = 'tel:' + String(prospect.telephone).replace(/\s+/g, '');
        } else {
          toast('Pas de téléphone — étape à traiter manuellement', 'warning');
        }
      } else {
        // wait : simple marquage
      }
    }

    function render(items, autoPaused) {
      if (countEl) countEl.textContent = items.length;
      if (autoPaused && autoPaused > 0) {
        toast(autoPaused + ' séquence(s) auto-pausée(s) (réponse reçue)', 'info');
      }
      if (items.length === 0) {
        list.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">' +
          'Aucune étape de séquence due aujourd\'hui. Démarrez une séquence depuis une fiche prospect.</div>';
        return;
      }
      list.innerHTML = items.map(function (it) {
        var step = it.step;
        var p = it.prospect;
        var cm = channelMeta(step.channel);
        var dueLabel = it.due_since_days === 0
          ? "aujourd'hui"
          : ('depuis ' + it.due_since_days + 'j');
        var cond = CONDITION_LABEL[step.condition] || '';
        return '<div class="pseq-due-row" data-eid="' + it.enrollment_id + '" data-step="' + it.step_index + '">' +
          '<span class="pseq-channel ' + cm.cls + '" title="' + esc(cm.label) + '">' + esc(cm.icon) + '</span>' +
          '<a class="pseq-due-row__main" href="/v30/prospect/' + p.id + '">' +
            '<div class="pseq-due-row__name">' + esc(p.name || '—') +
              ' <span class="muted" style="font-weight:normal;font-size:11px;">' +
                esc(p.company_name ? '· ' + p.company_name : '') +
              '</span>' +
            '</div>' +
            '<div class="pseq-due-row__hint">' + esc(step.hint || cm.label) + '</div>' +
            '<div class="pseq-due-row__meta muted">' +
              esc(it.sequence_name) + ' · étape ' + (it.step_index + 1) +
              ' · ' + esc(cond) + ' · dû ' + esc(dueLabel) +
            '</div>' +
          '</a>' +
          '<div class="pseq-due-row__actions">' +
            '<button type="button" class="btn btn-sm" data-pseq-execute title="Exécuter l\'étape">' +
              esc(cm.label) +
            '</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-pseq-complete ' +
              'title="Marquer fait sans exécuter">✓</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-pseq-pause ' +
              'title="Pauser la séquence pour ce prospect">⏸</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function load() {
      fetchJSON('/api/push/sequences/due').then(function (res) {
        render((res && res.ok && res.items) || [], res && res.auto_paused);
      }).catch(function () {
        list.innerHTML = '<div class="empty" style="padding:20px;font-size:12px;">Erreur de chargement.</div>';
      });
    }

    list.addEventListener('click', function (e) {
      var row = e.target.closest('[data-eid]');
      if (!row) return;
      var eid = Number(row.dataset.eid);
      var stepIdx = Number(row.dataset.step);
      if (!eid && eid !== 0) return;

      // Trouver l'item dans le DOM via cache simple : on relit via fetchJSON
      var execBtn = e.target.closest('[data-pseq-execute]');
      var completeBtn = e.target.closest('[data-pseq-complete]');
      var pauseBtn = e.target.closest('[data-pseq-pause]');

      if (execBtn || completeBtn) {
        // Récupère l'item depuis l'API (idempotent)
        fetchJSON('/api/push/sequences/due').then(function (res) {
          var items = (res && res.ok && res.items) || [];
          var it = items.find(function (x) {
            return x.enrollment_id === eid && x.step_index === stepIdx;
          });
          if (!it) {
            toast('Étape introuvable (peut-être déjà faite)', 'warning');
            load();
            return;
          }
          if (execBtn) executeStep(it.prospect, it.step);
          // Dans tous les cas, marque complete
          postJSON('/api/push/sequences/enrollments/' + eid + '/complete-step',
                   { step_index: stepIdx })
            .then(function (r) {
              if (r && r.ok) {
                toast(r.all_done ? 'Séquence terminée' : 'Étape marquée fait', 'success');
                load();
              } else {
                toast((r && r.error) || 'Erreur', 'error');
              }
            }).catch(function () { toast('Erreur réseau', 'error'); });
        }).catch(function () { toast('Erreur', 'error'); });
        return;
      }

      if (pauseBtn) {
        var reason = prompt('Raison de la pause (optionnelle) :') || '';
        postJSON('/api/push/sequences/enrollments/' + eid + '/pause', { reason: reason })
          .then(function (r) {
            if (r && r.ok) {
              toast('Séquence pausée', 'info');
              load();
            } else {
              toast('Erreur', 'error');
            }
          });
        return;
      }
    });

    load();
  }

  // ─── 2) Modal d'enroll depuis fiche prospect ─────────────
  function openEnrollModal(prospectId) {
    if (!prospectId) return;
    var modal = document.querySelector('[data-v30-pseq-enroll-modal]');
    if (!modal) return;

    var listEl = modal.querySelector('[data-v30-pseq-list]');
    if (listEl) listEl.innerHTML = '<div class="empty" style="padding:14px;">Chargement…</div>';

    function show() {
      modal.hidden = false;
      void modal.offsetWidth;
      modal.classList.add('is-open');
    }
    function hide() {
      modal.classList.remove('is-open');
      setTimeout(function () { modal.hidden = true; }, 160);
    }

    Promise.all([
      fetchJSON('/api/push/sequences'),
      fetchJSON('/api/push/sequences/enrollments?status=active')
    ]).then(function (r) {
      var sequences = (r[0] && r[0].sequences) || [];
      var activeEnrollments = (r[1] && r[1].enrollments) || [];
      var activeIds = new Set(
        activeEnrollments
          .filter(function (e) { return e.prospect_id === Number(prospectId); })
          .map(function (e) { return e.sequence_id; })
      );

      if (!sequences.length) {
        listEl.innerHTML = '<div class="empty" style="padding:14px;">Aucune séquence configurée.</div>';
        return;
      }

      listEl.innerHTML = sequences.map(function (s) {
        var enrolled = activeIds.has(s.id);
        var stepsTxt = (s.steps || []).map(function (st) {
          var cm = channelMeta(st.channel);
          return 'J+' + st.day_offset + ' ' + cm.label;
        }).join(' · ');
        return '<div class="pseq-list-row" data-sid="' + s.id + '">' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="pseq-list-row__name">' + esc(s.name) +
              (s.is_default ? ' <span class="muted" style="font-size:10px;">(défaut)</span>' : '') +
            '</div>' +
            '<div class="pseq-list-row__desc muted">' + esc(s.description || '') + '</div>' +
            '<div class="pseq-list-row__steps muted">' + esc(stepsTxt) + '</div>' +
          '</div>' +
          (enrolled
            ? '<span class="muted" style="font-size:11px;">Déjà actif</span>'
            : '<button type="button" class="btn btn-accent btn-sm" data-pseq-enroll-btn="' + s.id + '">' +
                'Démarrer' +
              '</button>') +
        '</div>';
      }).join('');
    }).catch(function () {
      listEl.innerHTML = '<div class="empty" style="padding:14px;">Erreur de chargement.</div>';
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) { hide(); return; }
      if (e.target.closest('[data-v30-modal-close]')) { hide(); return; }
      var enrollBtn = e.target.closest('[data-pseq-enroll-btn]');
      if (enrollBtn) {
        var sid = Number(enrollBtn.dataset.pseqEnrollBtn);
        enrollBtn.disabled = true;
        postJSON('/api/push/sequences/' + sid + '/enroll', { prospect_id: prospectId })
          .then(function (r) {
            if (r && r.ok) {
              toast('Séquence démarrée', 'success');
              hide();
            } else {
              toast((r && r.error) || 'Erreur', 'error');
              enrollBtn.disabled = false;
            }
          })
          .catch(function () { toast('Erreur réseau', 'error'); enrollBtn.disabled = false; });
      }
    }, { once: false });

    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape' && !modal.hidden) { hide(); document.removeEventListener('keydown', onEsc); }
    });

    show();
  }

  // ─── 3) Bouton "Démarrer séquence" sur fiche prospect ────
  function mountProspectButton() {
    var fp = document.querySelector('[data-v30-fp][data-prospect-id]');
    if (!fp) return;
    var pid = Number(fp.dataset.prospectId);
    if (!pid) return;

    var actions = fp.querySelector('.v30-fp-header__actions');
    if (!actions) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost';
    btn.setAttribute('data-v30-pseq-enroll-trigger', '');
    btn.title = 'Démarrer une séquence push cadencée';
    btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v6H4z"/><path d="M4 14h16v6H4z"/><path d="M8 10v4"/><path d="M16 10v4"/></svg> Séquence';
    btn.addEventListener('click', function () { openEnrollModal(pid); });
    actions.appendChild(btn);
  }

  // ─── API publique ────────────────────────────────────────
  window.V30PushSequences = {
    mountFocusSection: mountFocusSection,
    openEnrollModal: openEnrollModal
  };

  function autoMount() {
    if (document.querySelector('[data-v30-focus-pseq]')) mountFocusSection();
    if (document.querySelector('[data-v30-fp][data-prospect-id]')) mountProspectButton();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }
})();
