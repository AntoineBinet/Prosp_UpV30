// Focus page (v5)

let __focusItems = [];

function fmtCompany(c) {
    if (!c) return '—';
    const g = (c.groupe || '').trim();
    const s = (c.site || '').trim();
    if (g && s) return `${g} (${s})`;
    return g || s || '—';
}

function dayLabel(iso) {
    const t = todayISO();
    const tomorrow = addDaysISO(t, 1);
    const weekEnd = addDaysISO(t, 7);
    if (!iso) return '—';
    if (iso < t) return '⛔ En retard';
    if (iso === t) return '📌 Aujourd’hui';
    if (iso === tomorrow) return '🕘 Demain';
    if (iso <= weekEnd) return '📅 Cette semaine';
    return '🗓️ Plus tard';
}

function groupKey(iso) {
    const t = todayISO();
    const tomorrow = addDaysISO(t, 1);
    const weekEnd = addDaysISO(t, 7);
    if (!iso) return 'none';
    if (iso < t) return 'late';
    if (iso === t) return 'today';
    if (iso === tomorrow) return 'tomorrow';
    if (iso <= weekEnd) return 'week';
    return 'later';
}

function applyFocusFilter(items) {
    const f = (document.getElementById('focusFilter')?.value || 'all').toLowerCase();
    if (f === 'all') return items;
    return items.filter(it => groupKey(it.nextFollowUp) === f);
}

async function reloadFocus() {
    const summary = document.getElementById('focusSummary');
    const container = document.getElementById('focusContainer');
    if (!container) return;

    container.innerHTML = '<div class="card"><div class="muted">Chargement…</div></div>';

    const res = await fetch('/api/focus_queue');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    __focusItems = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : []);

    const items = applyFocusFilter(__focusItems);

    // stats
    const t = todayISO();
    const late = __focusItems.filter(x => x.nextFollowUp && x.nextFollowUp < t).length;
    const dueToday = __focusItems.filter(x => x.nextFollowUp && x.nextFollowUp === t).length;
    if (summary) summary.textContent = `Total: ${__focusItems.length} · En retard: ${late} · À faire aujourd’hui: ${dueToday}`;

    renderFocus(items);
}

function renderFocus(items) {
    const container = document.getElementById('focusContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0) {
        container.innerHTML = '<div class="card"><div class="muted">Aucune relance pour ce filtre.</div></div>';
        return;
    }

    const sections = [
        { key:'late', title:'⛔ En retard' },
        { key:'today', title:'📌 Aujourd’hui' },
        { key:'tomorrow', title:'🕘 Demain' },
        { key:'week', title:'📅 Cette semaine' },
        { key:'later', title:'🗓️ Plus tard' },
    ];

    sections.forEach(sec => {
        const group = items.filter(it => groupKey(it.nextFollowUp) === sec.key);
        if (group.length === 0) return;

        const card = document.createElement('div');
        card.className = 'card';
        card.style.marginTop = '12px';

        const rows = group.map(it => {
            const label = dayLabel(it.nextFollowUp);
            const prio = Number(it.priority || 0);
            const prioBadge = prio >= 3 ? '<span class="badge badge-danger">P3</span>' : (prio === 2 ? '<span class="badge badge-warning">P2</span>' : (prio === 1 ? '<span class="badge">P1</span>' : '<span class="badge">P0</span>'));
            // The email icon copies the email address to the clipboard instead of opening the mail client.
            const emailBtn = it.email ? `<a class="mini-action" href="javascript:void(0)" onclick="copyEmailToClipboard('${escapeHtml(it.email).replace(/'/g,"\\'")}')" title="Copier l'email">✉️</a>` : '';
            const telBtn = it.telephone ? `<a class="mini-action" href="tel:${escapeHtml(it.telephone)}" title="Appeler">📞</a>` : '';

            return `
              <tr class="focus-row">
                <td class="focus-cell focus-cell-date" data-label="Échéance" style="width: 190px;">
                  <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <span class="badge">${escapeHtml(label)}</span>
                    <span class="muted focus-date-value">${escapeHtml(it.nextFollowUp || '')}</span>
                  </div>
                </td>
                <td class="focus-cell focus-cell-prio" data-label="Prio" style="width:70px;">${prioBadge}</td>
                <td class="focus-cell focus-cell-prospect" data-label="Prospect">
                  <div class="focus-name">${escapeHtml(it.name || '')}</div>
                  <div class="muted focus-fonction">${escapeHtml(it.fonction || '')}</div>
                </td>
                <td class="focus-cell focus-cell-company" data-label="Entreprise">${escapeHtml(it.company_groupe || '')}${it.company_site ? `<div class="muted">${escapeHtml(it.company_site)}</div>` : ''}</td>
                <td class="focus-cell focus-cell-actions" data-label="Actions" style="text-align:right; white-space:nowrap;">
                  ${telBtn}
                  ${emailBtn}
                  <a class="mini-action" href="/?open=${it.id}" title="Ouvrir fiche">👁️</a>
                  <button class="mini-action" onclick="focusBump(${it.id}, 2)" title="Décaler +2j">+2j</button>
                  <button class="mini-action" onclick="focusDone(${it.id})" title="Marquer fait">✅</button>
                </td>
              </tr>
            `;
        }).join('');

        card.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom: 10px;">
            <div style="font-weight:800;">${escapeHtml(sec.title)} <span class="muted">(${group.length})</span></div>
          </div>
          <div class="table-wrapper focus-table-wrapper">
            <table class="focus-table">
              <thead>
                <tr>
                  <th>Échéance</th>
                  <th>Prio</th>
                  <th>Prospect</th>
                  <th>Entreprise</th>
                  <th style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
        container.appendChild(card);
    });
}

async function focusBump(prospectId, days) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;
    const base = (p.nextFollowUp && String(p.nextFollowUp).trim()) ? p.nextFollowUp : todayISO();
    p.nextFollowUp = addDaysISO(base, Number(days || 1));
    try {
        await saveToServerAsync();
        await reloadFocus();
    } catch(e) {
        console.error(e);
        alert("❌ Impossible de sauvegarder.");
    }
}

async function focusDone(prospectId) {
    const p = data.prospects.find(x => x.id === prospectId);
    if (!p) return;

    const note = (prompt("Note de contact (optionnel)\n(ex: appel, msg, résumé, next step)") || '').trim();
    const nextAction = (prompt("Next action (optionnel)\n(ex: relancer, envoyer CV, planifier RT)") || '').trim();

    const today = todayISO();
    const defaultNext = addDaysISO(today, 7);
    const nf = (prompt(`Prochaine relance (YYYY-MM-DD)\nLaissez vide pour aucune.\nPar défaut: ${defaultNext}`, defaultNext) || '').trim();

    try {
        const res = await fetch('/api/prospect/mark_done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: Number(prospectId),
                note,
                nextAction,
                nextFollowUp: nf || null
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || 'Erreur');

        // update local
        p.lastContact = today;
        p.nextFollowUp = nf || '';
        p.nextAction = nextAction || p.nextAction || '';

        // Auto-copy CR for Teams (v22.1)
        if (typeof copyForTeams === 'function') {
            const prefix = typeof getTeamsPrefix === 'function' ? getTeamsPrefix() : '???';
            const company = (typeof data !== 'undefined' && data.companies) ? data.companies.find(c => c.id === p.company_id) : null;
            const companyName = company ? (company.groupe || '') : '';
            const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            let crText = `[${prefix}] CR — ${companyName}${companyName && p.name ? ' / ' : ''}${p.name || ''}\nDate : ${dateStr}`;
            if (note) crText += `\nRésumé : ${note}`;
            if (nextAction) crText += `\nNext : ${nextAction}`;
            if (nf) crText += `\nRelance : ${nf}`;
            copyForTeams(crText, 'CR copié');
        }

        await saveToServerAsync();
        await reloadFocus();
    } catch (e) {
        console.error(e);
        alert("❌ Impossible de marquer fait.");
    }
}

// ═══════════════════════════════════════════════════════════════
// To-Do List (v19)
// ═══════════════════════════════════════════════════════════════

let __todoShowArchived = false;
let __allTasks = []; // (v22.1) Keep reference for Teams copy

async function loadTasks() {
    const status = __todoShowArchived ? 'done' : 'pending';
    const listEl = document.getElementById('todoList');
    const archEl = document.getElementById('todoArchivedList');
    if (!listEl) return;

    try {
        const res = await fetch(`/api/tasks?status=${status}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        const tasks = json.tasks || [];
        __allTasks = tasks;

        if (__todoShowArchived) {
            listEl.style.display = 'none';
            archEl.style.display = '';
            renderTasks(tasks, archEl, true);
        } else {
            listEl.style.display = '';
            archEl.style.display = 'none';
            renderTasks(tasks, listEl, false);
        }
    } catch (e) {
        console.error('Tasks load error:', e);
        listEl.innerHTML = '<div class="muted" style="padding:8px;text-align:center;">Erreur de chargement des tâches.</div>';
    }
}

function _taskDueBadge(dueDate) {
    if (!dueDate) return '';
    const today = todayISO();
    let cls = 'todo-due-badge';
    if (dueDate < today) cls += ' overdue';
    else if (dueDate === today) cls += ' today';
    return `<span class="${cls}">📅 ${dueDate}</span>`;
}

function _taskLinkedNames(linked) {
    if (!linked) return '';
    const parts = [];
    const pIds = linked.prospects || [];
    const cIds = linked.candidates || [];
    if (pIds.length && typeof data !== 'undefined' && data.prospects) {
        for (const pid of pIds) {
            const p = data.prospects.find(x => x.id === pid);
            if (p) parts.push(`<span class="todo-linked prospect" title="Prospect">👤 ${escapeHtml(p.name)}</span>`);
        }
    }
    if (cIds.length && typeof data !== 'undefined' && data.candidates) {
        for (const cid of cIds) {
            const c = data.candidates.find(x => x.id === cid);
            if (c) parts.push(`<span class="todo-linked candidate" title="Candidat">🎓 ${escapeHtml(c.name)}</span>`);
        }
    }
    return parts.join(' ');
}

function renderTasks(tasks, container, archived) {
    if (!container) return;
    if (!tasks.length) {
        container.innerHTML = `<div class="muted" style="padding:12px;text-align:center;">${archived ? 'Aucune tâche archivée.' : 'Aucune tâche en cours. Cliquez sur "+ Ajouter" pour commencer.'}</div>`;
        return;
    }

    container.innerHTML = tasks.map(t => {
        const linkedHtml = _taskLinkedNames(t.linked_ids);
        const dueHtml = _taskDueBadge(t.due_date);
        const commentPreview = t.comment ? `<div class="todo-comment muted">${escapeHtml(t.comment.length > 120 ? t.comment.slice(0, 120) + '…' : t.comment)}</div>` : '';

        return `
            <div class="todo-item${archived ? ' done' : ''}" data-task-id="${t.id}">
                <div class="todo-check">
                    <input type="checkbox" ${archived ? 'checked' : ''} onchange="toggleTaskDone(${t.id}, this.checked)" title="${archived ? 'Réactiver' : 'Marquer terminée'}">
                </div>
                <div class="todo-body">
                    <div class="todo-title-row">
                        <span class="todo-title">${escapeHtml(t.title)}</span>
                        ${dueHtml}
                    </div>
                    ${commentPreview}
                    ${linkedHtml ? `<div class="todo-linked-row">${linkedHtml}</div>` : ''}
                </div>
                <div class="todo-actions">
                    <button class="mini-action" onclick="copyTaskForTeams(${t.id})" title="Copier pour Teams">📋</button>
                    <button class="mini-action" onclick="openTaskModal(${t.id})" title="Modifier">✏️</button>
                    <button class="mini-action" onclick="deleteTask(${t.id})" title="Supprimer">🗑️</button>
                </div>
            </div>`;
    }).join('');
}

// Teams copy helper (v22.1)
function copyTaskForTeams(taskId) {
    const task = __allTasks.find(t => t.id === taskId);
    if (!task) return;
    const prefix = typeof getTeamsPrefix === 'function' ? getTeamsPrefix() : '???';
    let text = `[${prefix}] ${task.title}`;
    if (task.due_date) {
        const d = new Date(task.due_date + 'T00:00:00');
        text += ` — échéance ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
    }
    if (task.comment) text += `\n${task.comment.length > 200 ? task.comment.slice(0, 200) + '…' : task.comment}`;
    if (typeof copyForTeams === 'function') copyForTeams(text, 'Tâche copiée');
}

async function openTaskModal(taskId) {
    const modal = document.getElementById('taskModal');
    if (!modal) return;

    // Lazy-load candidates if not yet loaded
    if (typeof data !== 'undefined' && (!data.candidates || !data.candidates.length)) {
        try {
            const res = await fetch('/api/candidates');
            if (res.ok) {
                const arr = await res.json();
                data.candidates = Array.isArray(arr) ? arr : [];
            }
        } catch (e) { console.warn('Could not load candidates', e); }
    }

    document.getElementById('taskEditId').value = taskId || '';
    document.getElementById('taskTitleInput').value = '';
    document.getElementById('taskCommentInput').value = '';
    document.getElementById('taskDueDateInput').value = '';
    document.getElementById('taskModalTitle').textContent = taskId ? 'Modifier la tâche' : 'Nouvelle tâche';

    // Reset search filters
    const psSearch = document.getElementById('taskProspectsSearch');
    const csSearch = document.getElementById('taskCandidatesSearch');
    if (psSearch) psSearch.value = '';
    if (csSearch) csSearch.value = '';

    // Populate prospect select
    const pSelect = document.getElementById('taskProspectsSelect');
    if (pSelect && typeof data !== 'undefined' && data.prospects) {
        pSelect.innerHTML = data.prospects
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
            .join('');
    }

    // Populate candidate select
    const cSelect = document.getElementById('taskCandidatesSelect');
    if (cSelect && typeof data !== 'undefined' && data.candidates) {
        cSelect.innerHTML = data.candidates
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
            .join('');
    }

    if (taskId) {
        // Fetch task data to pre-fill
        fetch(`/api/tasks?status=all`)
            .then(r => r.json())
            .then(json => {
                const t = (json.tasks || []).find(x => x.id === taskId);
                if (!t) return;
                document.getElementById('taskTitleInput').value = t.title || '';
                document.getElementById('taskCommentInput').value = t.comment || '';
                document.getElementById('taskDueDateInput').value = t.due_date || '';
                const linked = t.linked_ids || {};
                if (pSelect && linked.prospects) {
                    for (const opt of pSelect.options) {
                        opt.selected = linked.prospects.includes(Number(opt.value));
                    }
                }
                if (cSelect && linked.candidates) {
                    for (const opt of cSelect.options) {
                        opt.selected = linked.candidates.includes(Number(opt.value));
                    }
                }
            })
            .catch(() => {});
    }

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('taskTitleInput')?.focus(), 100);
}

function closeTaskModal() {
    const modal = document.getElementById('taskModal');
    if (modal) modal.style.display = 'none';
}

/** Filter <option> inside a <select> based on a search input value */
function _filterSelectOptions(searchInputId, selectId) {
    const q = (document.getElementById(searchInputId)?.value || '').toLowerCase().trim();
    const sel = document.getElementById(selectId);
    if (!sel) return;
    for (const opt of sel.options) {
        const text = (opt.textContent || '').toLowerCase();
        // Keep selected options always visible so user sees their picks
        opt.style.display = (!q || text.includes(q) || opt.selected) ? '' : 'none';
    }
}

async function saveTask() {
    const title = (document.getElementById('taskTitleInput')?.value || '').trim();
    if (!title) {
        showToast('Le titre est obligatoire.', 'error');
        return;
    }
    const comment = (document.getElementById('taskCommentInput')?.value || '').trim();
    const due_date = document.getElementById('taskDueDateInput')?.value || '';
    const editId = document.getElementById('taskEditId')?.value;

    const pSelect = document.getElementById('taskProspectsSelect');
    const cSelect = document.getElementById('taskCandidatesSelect');
    const prospects = pSelect ? Array.from(pSelect.selectedOptions).map(o => Number(o.value)) : [];
    const candidates = cSelect ? Array.from(cSelect.selectedOptions).map(o => Number(o.value)) : [];

    const payload = {
        title,
        comment,
        due_date: due_date || null,
        linked_ids: { prospects, candidates },
    };
    if (editId) payload.id = Number(editId);

    try {
        const res = await fetch('/api/tasks/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        showToast(editId ? 'Tâche modifiée.' : 'Tâche créée.', 'success');
        closeTaskModal();
        await loadTasks();
    } catch (e) {
        console.error(e);
        showToast('Erreur lors de la sauvegarde.', 'error');
    }
}

async function toggleTaskDone(taskId, checked) {
    try {
        const res = await fetch('/api/tasks/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: taskId, status: checked ? 'done' : 'pending' }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        showToast(checked ? 'Tâche archivée.' : 'Tâche réactivée.', 'success');
        await loadTasks();
    } catch (e) {
        console.error(e);
        showToast('Erreur.', 'error');
    }
}

async function deleteTask(taskId) {
    if (!confirm('Supprimer cette tâche ?')) return;
    try {
        const res = await fetch('/api/tasks/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: taskId }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        showToast('Tâche supprimée.', 'success');
        await loadTasks();
    } catch (e) {
        console.error(e);
        showToast('Erreur.', 'error');
    }
}

function toggleArchivedView() {
    __todoShowArchived = !__todoShowArchived;
    const btn = document.getElementById('btnShowArchived');
    if (btn) btn.textContent = __todoShowArchived ? '← Tâches en cours' : '📁 Archives';
    loadTasks();
}

// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('focus');
    } catch(e) {}

    document.getElementById('btnFocusReload')?.addEventListener('click', reloadFocus);
    document.getElementById('focusFilter')?.addEventListener('change', reloadFocus);
    document.getElementById('btnAddTask')?.addEventListener('click', () => openTaskModal());
    document.getElementById('btnShowArchived')?.addEventListener('click', toggleArchivedView);

    // Search filters for task modal selects
    document.getElementById('taskProspectsSearch')?.addEventListener('input', () => _filterSelectOptions('taskProspectsSearch', 'taskProspectsSelect'));
    document.getElementById('taskCandidatesSearch')?.addEventListener('input', () => _filterSelectOptions('taskCandidatesSearch', 'taskCandidatesSelect'));

    try {
        await loadTasks();
    } catch(e) { console.error('Tasks init error:', e); }

    try {
        await reloadFocus();
    } catch(err) {
        console.error(err);
        alert("❌ Impossible de charger Focus. Vérifiez que le serveur Python est lancé (app.py).");
    }

    // ── Thursday export alert ──
    _checkThursdayAlertFocus();
});

/** Show an alert on Focus page from Thursday 8am if weekly export hasn't been done */
function _checkThursdayAlertFocus() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 4=Thu
    const hour = now.getHours();
    if (dayOfWeek < 4 || (dayOfWeek === 4 && hour < 8)) return;

    // Calculate current ISO week
    const tmp = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const jan4 = new Date(tmp.getFullYear(), 0, 4);
    const week = 1 + Math.round(((tmp - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
    const currentWeek = `${tmp.getFullYear()}-W${String(week).padStart(2, '0')}`;

    const lastExport = localStorage.getItem('prospup_lastExportWeek') || '';
    if (lastExport === currentWeek) return;

    const alertEl = document.getElementById('weeklyExportAlertFocus');
    if (alertEl) alertEl.style.display = '';
}
