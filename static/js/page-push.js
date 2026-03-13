// Suivi des push

let __pushLogs = [];
let __pushFiltered = [];
let __pushDetail = null;

function pushChannelLabel(ch) {
    const s = (ch || '').trim().toLowerCase();
    if (s === 'linkedin') return '🔗 LinkedIn';
    if (s === 'other') return '📨 Autre';
    return '✉️ Email';
}

async function reloadPushLogs() {
    try {
        const res = await fetch('/api/push-logs');
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText || 'Erreur de chargement'}`);
        }
        const data = await res.json();
        __pushLogs = Array.isArray(data) ? data : [];
        applyPushFilters();
    } catch (err) {
        console.error('Erreur chargement push logs:', err);
        __pushLogs = [];
        applyPushFilters();
        if (window.showToast) {
            showToast(`❌ Impossible de charger l'historique des push: ${err.message}`, 'error');
        } else {
            throw err; // Re-throw si showToast n'est pas disponible
        }
    }
}

function applyPushFilters() {
    const q = (document.getElementById('pushSearch')?.value || '').trim().toLowerCase();
    const ch = (document.getElementById('pushChannelFilter')?.value || '').trim().toLowerCase();

    __pushFiltered = __pushLogs.filter(l => {
        const hay = (
            `${safeStr(l.prospect_name)} ${safeStr(l.company_groupe)} ${safeStr(l.company_site)} ${safeStr(l.prospect_email)} ${safeStr(l.to_email)} ${safeStr(l.subject)} ${safeStr(l.channel)}`
        ).toLowerCase();
        const okQ = !q || hay.includes(q);
        const okC = !ch || safeStr(l.channel).toLowerCase() === ch;
        return okQ && okC;
    });

    renderPushTable();
}

function renderPushTable() {
    const tbody = document.getElementById('pushTableBody');
    const empty = document.getElementById('pushEmptyState');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (__pushFiltered.length === 0) {
        if (empty) empty.style.display = 'block';
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucun résultat</td></tr>';
        return;
    }
    if (empty) empty.style.display = 'none';

    __pushFiltered.forEach(l => {
        const company = typeof formatPushCompany === 'function' 
            ? formatPushCompany(l.company_groupe, l.company_site)
            : ((l.company_groupe || l.company_site) ? `${safeStr(l.company_groupe)} (${safeStr(l.company_site || '-')})` : '—');
        const dateFormatted = typeof formatPushDate === 'function'
            ? formatPushDate(l.sentAt || l.createdAt)
            : (l.sentAt || l.createdAt || '');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Date">${escapeHtml(dateFormatted)}</td>
            <td data-label="Prospect"><span class="table-cell-clamp" title="${escapeHtml(l.prospect_name || '')}">${escapeHtml(l.prospect_name || '')}</span></td>
            <td data-label="Entreprise"><span class="table-cell-clamp" title="${escapeHtml(company)}">${escapeHtml(company)}</span></td>
            <td data-label="Email"><span class="table-cell-clamp" title="${escapeHtml(l.to_email || l.prospect_email || '')}">${escapeHtml(l.to_email || l.prospect_email || '')}</span></td>
            <td data-label="Sujet"><span class="table-cell-clamp" title="${escapeHtml(safeStr(l.subject))}">${escapeHtml(safeStr(l.subject) || '—')}</span></td>
            <td data-label="Canal">${escapeHtml(pushChannelLabel(l.channel))}</td>
            <td data-label="Actions">
                <div class="table-actions-inline">
                    <button class="mini-action" onclick="openPushDetail(${l.id})">👁️</button>
                    <button class="mini-action danger" onclick="deletePushLog(${l.id})">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openPushDetail(id) {
    const l = __pushLogs.find(x => x.id === id);
    if (!l) return;
    __pushDetail = l;

    const modal = document.getElementById('modalPushDetail');
    const body = document.getElementById('pushDetailBody');
    if (!modal || !body) return;

    const company = typeof formatPushCompany === 'function'
        ? formatPushCompany(l.company_groupe, l.company_site)
        : ((l.company_groupe || l.company_site) ? `${safeStr(l.company_groupe)} (${safeStr(l.company_site || '-')})` : '—');
    const dateFormatted = typeof formatPushDate === 'function'
        ? formatPushDate(l.sentAt || l.createdAt)
        : (l.sentAt || l.createdAt || '');

    body.innerHTML = `
        <div class="detail-info" style="margin-bottom: 10px;">
            <div><strong>Date:</strong> ${escapeHtml(dateFormatted)}</div>
            <div><strong>Prospect:</strong> ${escapeHtml(l.prospect_name || '')}</div>
            <div><strong>Entreprise:</strong> ${escapeHtml(company)}</div>
            <div><strong>Email:</strong> ${escapeHtml(l.to_email || l.prospect_email || '')}</div>
            <div><strong>Canal:</strong> ${escapeHtml(pushChannelLabel(l.channel))}</div>
            <div><strong>Template:</strong> ${escapeHtml(l.template_name || '—')}</div>
        </div>
        <div style="margin-top: 12px;">
            <div style="font-weight:700; margin-bottom: 6px;">Sujet</div>
            <div class="card" style="padding: 12px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface-2);">${escapeHtml(l.subject || '—')}</div>
        </div>
        <div style="margin-top: 12px;">
            <div style="font-weight:700; margin-bottom: 6px;">Contenu</div>
            <pre style="white-space: pre-wrap; border: 1px solid var(--color-border); border-radius: 12px; padding: 12px; background: var(--color-surface-2); max-height: 360px; overflow:auto;">${escapeHtml(l.body || '')}</pre>
        </div>
    `;

    if (window.openModal) {
        window.openModal(modal);
    } else {
        modal.classList.add('active');
    }
}

function closePushDetail() {
    const modal = document.getElementById('modalPushDetail');
    if (modal) {
        if (window.closeModal) {
            window.closeModal(modal);
        } else {
            modal.classList.remove('active');
        }
    }
    __pushDetail = null;
}

async function deletePushLog(id) {
    const l = __pushLogs.find(x => x.id === id);
    const label = l ? `${safeStr(l.prospect_name)} — ${safeStr(l.sentAt || l.createdAt)}` : `ID ${id}`;
    if (!confirm(`⚠️ Supprimer ce push ?\n\n${label}`)) return;

    try {
        const res = await fetch('/api/push-logs/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            try {
                const data = await res.json();
                errorMsg = data.error || errorMsg;
            } catch (e) {
                errorMsg = res.statusText || errorMsg;
            }
            if (window.showToast) {
                showToast(`❌ Impossible de supprimer: ${errorMsg}`, 'error');
            } else {
                alert(`❌ Impossible de supprimer: ${errorMsg}`);
            }
            return; // Retourner early si échec, ne pas appeler reloadPushLogs()
        }
        // Recharger seulement si la suppression a réussi
        await reloadPushLogs();
    } catch (err) {
        console.error('Erreur suppression push log:', err);
        if (window.showToast) {
            showToast(`❌ Erreur lors de la suppression: ${err.message}`, 'error');
        } else {
            alert(`❌ Erreur lors de la suppression: ${err.message}`);
        }
    }
}

function exportPushCSV() {
    const rows = __pushFiltered.map(l => ({
        date: typeof formatPushDate === 'function' ? formatPushDate(l.sentAt || l.createdAt) : (l.sentAt || l.createdAt || ''),
        prospect: l.prospect_name || '',
        entreprise: typeof formatPushCompany === 'function' ? formatPushCompany(l.company_groupe, l.company_site) : `${safeStr(l.company_groupe)} (${safeStr(l.company_site || '-')})`,
        email: l.to_email || l.prospect_email || '',
        sujet: l.subject || '',
        canal: l.channel || 'email',
    }));

    const headers = ['date', 'prospect', 'entreprise', 'email', 'sujet', 'canal'];
    const csv = [headers.join(',')].concat(
        rows.map(r => headers.map(h => {
            const v = (safeStr(r[h]) || '').replace(/\r\n|\r|\n/g, ' ');
            const escaped = v.replace(/"/g, '""');
            return `"${escaped}"`;
        }).join(','))
    ).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `push_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
}

document.addEventListener('DOMContentLoaded', async () => {
    // On charge d'abord l'app (pour avoir escapeHtml, etc.) et les données prospects (pas obligatoire, mais cohérent)
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('push');
    } catch (e) {}

    const q = document.getElementById('pushSearch');
    const f = document.getElementById('pushChannelFilter');
    q && q.addEventListener('input', applyPushFilters);
    f && f.addEventListener('change', applyPushFilters);

    try {
        await reloadPushLogs();
    } catch (err) {
        console.error(err);
        alert("❌ Impossible de charger l'historique des push. Vérifiez que le serveur Python est lancé (app.py).");
    }
});
