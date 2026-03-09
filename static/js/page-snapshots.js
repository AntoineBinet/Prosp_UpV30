// Snapshots page (v5)

function bytesToHuman(n) {
    const num = Number(n || 0);
    if (num < 1024) return `${num} B`;
    const kb = num / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
}

async function listSnapshots() {
    const tbody = document.getElementById('snapshotsBody');
    const summary = document.getElementById('snapshotsSummary');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Chargement…</td></tr>';

    const res = await fetch('/api/snapshots');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const list = Array.isArray(json) ? json : (Array.isArray(json?.items) ? json.items : []);

    if (summary) summary.textContent = `Snapshots: ${list.length}`;

    if (!tbody) return;
    tbody.innerHTML = '';

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucun snapshot</td></tr>';
        return;
    }

    list.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><code>${escapeHtml(s.filename || '')}</code></td>
          <td>${escapeHtml(bytesToHuman(s.size || 0))}</td>
          <td>${escapeHtml(s.mtime || '')}</td>
          <td style="text-align:right; display:flex; gap:8px; justify-content:flex-end;">
            <button class="mini-action" onclick="restoreSnapshot('${escapeHtml(s.filename)}')">♻️ Restaurer</button>
            <button class="mini-action danger" onclick="deleteSnapshot('${escapeHtml(s.filename)}')">🗑️ Supprimer</button>
          </td>
        `;
        tbody.appendChild(tr);
    });
}

async function createSnapshot() {
    const label = (document.getElementById('snapshotLabel')?.value || '').trim();
    const res = await fetch('/api/snapshots/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
    });
    if (!res.ok) {
        const t = await res.text().catch(()=> '');
        alert('❌ Création impossible: ' + (t || ('HTTP ' + res.status)));
        return;
    }
    alert('✅ Snapshot créé.');
    document.getElementById('snapshotLabel').value = '';
    await listSnapshots();
}

async function restoreSnapshot(filename) {
    if (!filename) return;
    if (!confirm(`⚠️ Restaurer ce snapshot ?\n\n${filename}\n\nUne sauvegarde before_restore sera créée.`)) return;

    const res = await fetch('/api/snapshots/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
    });
    if (!res.ok) {
        const t = await res.text().catch(()=> '');
        alert('❌ Restauration impossible: ' + (t || ('HTTP ' + res.status)));
        return;
    }
    alert('✅ Snapshot restauré. Rechargement…');
    window.location.href = '/';
}

async function deleteSnapshot(filename) {
    if (!filename) return;
    if (!confirm(`⚠️ Supprimer ce snapshot ?\n\n${filename}`)) return;

    const res = await fetch('/api/snapshots/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
    });
    if (!res.ok) {
        const t = await res.text().catch(()=> '');
        alert('❌ Suppression impossible: ' + (t || ('HTTP ' + res.status)));
        return;
    }
    await listSnapshots();
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('snapshots');
    } catch(e) {}

    document.getElementById('btnCreateSnapshot')?.addEventListener('click', createSnapshot);
    document.getElementById('btnReloadSnapshots')?.addEventListener('click', listSnapshots);

    try {
        await listSnapshots();
    } catch(err) {
        console.error(err);
        alert("❌ Impossible de charger les snapshots. Vérifiez que le serveur Python est lancé (app.py).");
    }
});
