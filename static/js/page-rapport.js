// Rapport Hebdomadaire (v7)

const STATUS_COLORS_R = {
    "Pas d'actions": '#64748b',
    'Appelé': '#f59e0b',
    'Messagerie': '#3b82f6',
    'À rappeler': '#ef4444',
    'Rendez-vous': '#22c55e',
    'Pas intéressé': '#94a3b8'
};

let _rapportData = null;

function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function loadRapport() {
    const weekEl = document.getElementById('rapportWeek');
    const week = weekEl?.value || '';
    const content = document.getElementById('rapportContent');
    
    content.innerHTML = '<div class="muted" style="text-align:center;padding:40px;">⏳ Chargement…</div>';

    try {
        const url = week ? `/api/rapport-hebdo?week=${encodeURIComponent(week)}` : '/api/rapport-hebdo';
        const res = await fetch(url);
        const json = await res.json();
        if (!json.ok) throw new Error('API error');
        _rapportData = json.data;
        renderRapport(_rapportData);
    } catch (e) {
        content.innerHTML = '<div class="muted" style="text-align:center;padding:40px;">❌ Erreur de chargement</div>';
        console.error(e);
    }
}

function renderRapport(d) {
    const kpi = d.kpi;
    const el = document.getElementById('rapportContent');

    const kpis = [
        { value: kpi.contacts, label: 'Contacts', color: '#f59e0b' },
        { value: kpi.notes, label: "Notes d'appel", color: '#3b82f6' },
        { value: kpi.push_total, label: 'Push envoyés', color: '#8b5cf6' },
        { value: kpi.push_email, label: '✉️ Email', color: '#6366f1' },
        { value: kpi.push_linkedin, label: '💼 LinkedIn', color: '#0077b5' },
        { value: kpi.rdv, label: 'RDV obtenus', color: '#22c55e' },
        { value: kpi.overdue, label: 'Relances retard', color: '#ef4444' },
        { value: kpi.conversion_pct + '%', label: 'Conversion', color: '#32b8c6' },
        { value: kpi.companies_touched, label: 'Entreprises', color: '#f97316' },
        { value: kpi.total_prospects, label: 'Total prospects', color: '#64748b' },
    ];

    let html = `<div style="font-size:18px;font-weight:800;margin-bottom:12px;">📋 ${escHtml(d.week_label)}</div>`;

    // KPI Grid
    html += '<div class="rapport-kpi-grid">';
    kpis.forEach(k => {
        html += `<div class="rapport-kpi" style="--kpi-color:${k.color}">
            <div class="rapport-kpi-value">${k.value}</div>
            <div class="rapport-kpi-label">${escHtml(k.label)}</div>
        </div>`;
    });
    html += '</div>';

    // Pipeline distribution
    html += '<div class="rapport-section">';
    html += '<div class="rapport-section-title">📊 Répartition pipeline</div>';
    const total = kpi.total_prospects || 1;
    html += '<div class="rapport-stat-bar">';
    const statusOrder = ["Pas d'actions", "Appelé", "Messagerie", "À rappeler", "Rendez-vous", "Pas intéressé"];
    statusOrder.forEach(s => {
        const count = d.statuts[s] || 0;
        const pct = (count / total * 100).toFixed(1);
        const color = STATUS_COLORS_R[s] || '#64748b';
        if (count > 0) {
            html += `<div class="rapport-stat-segment" style="width:${pct}%;background:${color}" title="${s}: ${count} (${pct}%)"></div>`;
        }
    });
    html += '</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;">';
    statusOrder.forEach(s => {
        const count = d.statuts[s] || 0;
        const color = STATUS_COLORS_R[s] || '#64748b';
        html += `<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:2px;background:${color};display:inline-block;"></span>${escHtml(s)}: <strong>${count}</strong></span>`;
    });
    html += '</div></div>';

    // Companies touched
    if (d.touched_companies && d.touched_companies.length) {
        html += '<div class="rapport-section">';
        html += `<div class="rapport-section-title">🏢 Entreprises actives cette semaine (${d.touched_companies.length})</div>`;
        html += '<div class="rapport-company-tags">';
        d.touched_companies.forEach(c => {
            html += `<span class="rapport-company-tag">${escHtml(c)}</span>`;
        });
        html += '</div></div>';
    }

    // Notes detail
    if (d.notes_detail && d.notes_detail.length) {
        html += '<div class="rapport-section">';
        html += `<div class="rapport-section-title">📝 Notes d'appel (${d.notes_detail.length})</div>`;
        html += '<table class="rapport-table"><thead><tr><th>Date</th><th>Prospect</th><th>Statut</th><th>Contenu</th></tr></thead><tbody>';
        d.notes_detail.forEach(n => {
            html += `<tr>
                <td style="white-space:nowrap">${escHtml(n.date?.slice(0,10) || '')}</td>
                <td><strong>${escHtml(n.name)}</strong></td>
                <td><span class="status-badge status-${(n.statut||'').replace(/[^a-zA-Z]/g,'').toLowerCase()}">${escHtml(n.statut)}</span></td>
                <td style="color:var(--color-text-secondary)">${escHtml(n.content)}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
    }

    // Push detail
    if (d.push_detail && d.push_detail.length) {
        html += '<div class="rapport-section">';
        html += `<div class="rapport-section-title">📤 Push envoyés (${d.push_detail.length})</div>`;
        const byChannel = {};
        d.push_detail.forEach(p => {
            const ch = p.channel || 'autre';
            byChannel[ch] = (byChannel[ch] || 0) + 1;
        });
        html += '<div style="display:flex;gap:14px;font-size:12px;margin-bottom:8px;">';
        Object.entries(byChannel).forEach(([ch, count]) => {
            const icon = ch === 'email' ? '✉️' : (ch === 'linkedin' ? '💼' : '📤');
            html += `<span>${icon} ${escHtml(ch)}: <strong>${count}</strong></span>`;
        });
        html += '</div>';

        // Group by date
        const byDate = {};
        d.push_detail.forEach(p => {
            const dt = p.date || 'N/A';
            byDate[dt] = (byDate[dt] || 0) + 1;
        });
        html += '<div style="font-size:11px;color:var(--color-text-secondary);">';
        Object.entries(byDate).sort().forEach(([dt, cnt]) => {
            html += `<span style="margin-right:12px;">${dt}: <strong>${cnt}</strong> push</span>`;
        });
        html += '</div></div>';
    }

    el.innerHTML = html;
}

function generateMarkdown() {
    if (!_rapportData) return '';
    const d = _rapportData;
    const kpi = d.kpi;
    
    let md = `# 📋 Rapport Hebdomadaire — Up Technologies\n`;
    md += `## ${d.week_label}\n\n`;

    md += `### 📊 KPIs\n\n`;
    md += `| Indicateur | Valeur |\n|---|---|\n`;
    md += `| Contacts | ${kpi.contacts} |\n`;
    md += `| Notes d'appel | ${kpi.notes} |\n`;
    md += `| Push envoyés | ${kpi.push_total} (✉️ ${kpi.push_email} / 💼 ${kpi.push_linkedin}) |\n`;
    md += `| RDV | ${kpi.rdv} |\n`;
    md += `| Relances en retard | ${kpi.overdue} |\n`;
    md += `| Taux de conversion | ${kpi.conversion_pct}% |\n`;
    md += `| Entreprises actives | ${kpi.companies_touched} |\n`;
    md += `| Total prospects | ${kpi.total_prospects} |\n\n`;

    md += `### 📊 Pipeline\n\n`;
    const statusOrder = ["Pas d'actions", "Appelé", "Messagerie", "À rappeler", "Rendez-vous", "Pas intéressé"];
    statusOrder.forEach(s => {
        const count = d.statuts[s] || 0;
        md += `- **${s}**: ${count}\n`;
    });
    md += `\n`;

    if (d.touched_companies && d.touched_companies.length) {
        md += `### 🏢 Entreprises actives (${d.touched_companies.length})\n\n`;
        const safeCompanies = d.touched_companies.map(c => (c != null ? String(c) : '').replace(/\r\n|\r|\n/g, ' ').trim());
        md += safeCompanies.join(', ') + '\n\n';
    }

    function mdCell(val) {
        const s = (val != null ? String(val) : '').replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, ' ').trim();
        return s.slice(0, 80);
    }
    if (d.notes_detail && d.notes_detail.length) {
        md += `### 📝 Notes d'appel (${d.notes_detail.length})\n\n`;
        md += `| Date | Prospect | Statut | Résumé |\n|---|---|---|---|\n`;
        d.notes_detail.forEach(n => {
            md += `| ${mdCell(n.date?.slice(0, 10))} | ${mdCell(n.name)} | ${mdCell(n.statut)} | ${mdCell(n.content)} |\n`;
        });
        md += `\n`;
    }

    if (d.push_detail && d.push_detail.length) {
        md += `### 📤 Push (${d.push_detail.length})\n\n`;
        const byChannel = {};
        d.push_detail.forEach(p => { byChannel[p.channel || 'autre'] = (byChannel[p.channel || 'autre'] || 0) + 1; });
        Object.entries(byChannel).forEach(([ch, count]) => {
            md += `- **${ch}**: ${count}\n`;
        });
        md += `\n`;
    }

    md += `---\n*Généré le ${new Date().toLocaleDateString('fr-FR')} — Up Technologies CRM*\n`;
    return md;
}

async function copyMarkdown() {
    const md = generateMarkdown();
    if (!md) { alert('Générez d\'abord un rapport.'); return; }
    try {
        await navigator.clipboard.writeText(md);
        alert('✅ Markdown copié dans le presse-papier !\nCollez-le dans OneNote, Notion, ou un email.');
    } catch (e) {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('✅ Markdown copié !');
    }
}

function toggleMdPreview() {
    const pre = document.getElementById('rapportMdPreview');
    if (pre.style.display === 'none' || !pre.style.display) {
        pre.textContent = generateMarkdown();
        pre.style.display = 'block';
    } else {
        pre.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Set default week to current
    const now = new Date();
    const weekEl = document.getElementById('rapportWeek');
    if (weekEl) {
        const y = now.getFullYear();
        // Get ISO week number
        const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
        weekEl.value = `${y}-W${String(weekNo).padStart(2, '0')}`;
    }

    document.getElementById('rapportLoad')?.addEventListener('click', loadRapport);
    document.getElementById('rapportCopyMd')?.addEventListener('click', copyMarkdown);
    document.getElementById('rapportPrint')?.addEventListener('click', () => window.print());
    document.getElementById('rapportToggleMd')?.addEventListener('click', toggleMdPreview);

    // Auto-load current week
    await loadRapport();
});
