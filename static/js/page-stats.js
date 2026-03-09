// Stats page with Chart.js charts (v8)

// Async Chart.js loader with multiple CDN fallback
async function _loadChartJsFallback() {
    const urls = [
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.7/chart.umd.min.js',
        'https://unpkg.com/chart.js@4.4.7/dist/chart.umd.min.js'
    ];
    for (const url of urls) {
        if (typeof Chart !== 'undefined') return;
        try {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = url;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
            if (typeof Chart !== 'undefined') return;
        } catch (e) { /* try next */ }
    }
}

function safeStr(v) { return (v === null || v === undefined) ? '' : String(v); }

function statCard(title, value, sub='', cssClass='') {
    const div = document.createElement('div');
    div.className = 'stat-card' + (cssClass ? ' ' + cssClass : '');
    div.innerHTML = `
      <div class="stat-title">${escapeHtml(title)}</div>
      <div class="stat-value">${escapeHtml(String(value ?? '—'))}</div>
      ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
    `;
    return div;
}

// Chart instances (for destroy on refresh)
let _chartStatus = null;
let _chartPertinence = null;
let _chartActivity = null;
let _chartTopCompanies = null;

const STATUS_COLORS = {
    "Pas d'actions": '#64748b',
    'Appelé': '#f59e0b',
    'Messagerie': '#3b82f6',
    'À rappeler': '#ef4444',
    'Rendez-vous': '#22c55e',
    'Pas intéressé': '#94a3b8'
};
const STATUS_ORDER = ["Pas d'actions", "Appelé", "Messagerie", "À rappeler", "Rendez-vous", "Pas intéressé"];

const PERT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#32b8c6'];
const PERT_LABELS = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];

function getChartDefaults() {
    // Detect dark mode
    const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const textColor = isDark ? '#e2e8f0' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    return { textColor, gridColor, isDark };
}

function renderStatusChart(prospects) {
    const ctx = document.getElementById('chartStatus');
    if (!ctx || typeof Chart === 'undefined') return;
    if (_chartStatus) _chartStatus.destroy();

    const counts = {};
    STATUS_ORDER.forEach(s => counts[s] = 0);
    prospects.forEach(p => {
        const s = STATUS_ORDER.includes(p.statut) ? p.statut : "Pas d'actions";
        counts[s]++;
    });

    const { textColor } = getChartDefaults();

    _chartStatus = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: STATUS_ORDER,
            datasets: [{
                data: STATUS_ORDER.map(s => counts[s]),
                backgroundColor: STATUS_ORDER.map(s => STATUS_COLORS[s]),
                borderWidth: 2,
                borderColor: getChartDefaults().isDark ? '#1e293b' : '#ffffff',
                hoverBorderWidth: 3,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { size: 11 }, padding: 12, usePointStyle: true, pointStyleWidth: 10 }
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
                            return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderPertinenceChart(prospects) {
    const ctx = document.getElementById('chartPertinence');
    if (!ctx) return;
    if (_chartPertinence) _chartPertinence.destroy();

    const counts = [0, 0, 0, 0, 0]; // index 0 = 1 star, index 4 = 5 stars
    prospects.forEach(p => {
        const v = parseInt(p.pertinence, 10);
        if (v >= 1 && v <= 5) counts[v - 1]++;
    });

    const { textColor } = getChartDefaults();

    _chartPertinence = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: PERT_LABELS,
            datasets: [{
                data: counts,
                backgroundColor: PERT_COLORS,
                borderWidth: 2,
                borderColor: getChartDefaults().isDark ? '#1e293b' : '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { size: 11 }, padding: 12, usePointStyle: true, pointStyleWidth: 10 }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0;
                            return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderActivityChart(pushLogs) {
    const ctx = document.getElementById('chartActivity');
    if (!ctx) return;
    if (_chartActivity) _chartActivity.destroy();

    // Group push logs by week (last 4 weeks)
    const now = new Date();
    const weeks = [];
    for (let i = 3; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * 7);
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weeks.push({
            label: `S${getISOWeek(weekStart)}`,
            from: weekStart.toISOString().slice(0, 10),
            to: weekEnd.toISOString().slice(0, 10),
            emails: 0,
            linkedin: 0
        });
    }

    (pushLogs || []).forEach(log => {
        const d = (log.sentAt || '').slice(0, 10);
        if (!d) return;
        weeks.forEach(w => {
            if (d >= w.from && d <= w.to) {
                const ch = (log.channel || 'email').toLowerCase();
                if (ch === 'linkedin') w.linkedin++;
                else w.emails++;
            }
        });
    });

    const { textColor, gridColor } = getChartDefaults();

    _chartActivity = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: weeks.map(w => w.label),
            datasets: [
                {
                    label: 'Emails',
                    data: weeks.map(w => w.emails),
                    backgroundColor: 'rgba(59,130,246,0.7)',
                    borderRadius: 6,
                    borderSkipped: false
                },
                {
                    label: 'LinkedIn',
                    data: weeks.map(w => w.linkedin),
                    backgroundColor: 'rgba(50,184,198,0.7)',
                    borderRadius: 6,
                    borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { size: 11 }, padding: 12, usePointStyle: true, pointStyleWidth: 10 }
                }
            },
            scales: {
                x: {
                    ticks: { color: textColor, font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: textColor, font: { size: 11 }, stepSize: 1 },
                    grid: { color: gridColor }
                }
            }
        }
    });
}

function renderTopCompaniesChart(prospects, companies) {
    const ctx = document.getElementById('chartTopCompanies');
    if (!ctx) return;
    if (_chartTopCompanies) _chartTopCompanies.destroy();

    // Count prospects per company
    const countMap = {};
    prospects.forEach(p => {
        const cid = p.company_id;
        if (!countMap[cid]) countMap[cid] = 0;
        countMap[cid]++;
    });

    // Top 10
    const sorted = Object.entries(countMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const labels = sorted.map(([cid]) => {
        const c = companies.find(x => x.id === parseInt(cid, 10));
        return c ? (c.groupe + (c.site ? ' (' + c.site + ')' : '')) : ('ID ' + cid);
    });
    const values = sorted.map(([, count]) => count);

    const { textColor, gridColor } = getChartDefaults();

    _chartTopCompanies = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Prospects',
                data: values,
                backgroundColor: 'rgba(50,184,198,0.65)',
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: { color: textColor, font: { size: 11 }, stepSize: 1 },
                    grid: { color: gridColor }
                },
                y: {
                    ticks: { color: textColor, font: { size: 11 } },
                    grid: { display: false }
                }
            }
        }
    });
}

function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}


async function loadStats() {
    const modeEl = document.getElementById('statsRangeMode');
    const mode = String(modeEl?.value || '30');
    const weekEl = document.getElementById('statsWeek');
    const monthEl = document.getElementById('statsMonth');
    const label = document.getElementById('statsRangeLabel');
    const cards = document.getElementById('statsCards');
    const tbody = document.getElementById('hotCompaniesBody');

    if (cards) cards.innerHTML = '';
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Chargement…</td></tr>';

    const buildQuery = () => {
        if (/^\d+$/.test(mode)) return `days=${encodeURIComponent(mode)}`;
        if (mode === 'all') return `range=all`;
        if (mode === 'week') {
            const v = String(weekEl?.value || '').trim();
            if (!v) return `days=30`;
            const [yStr, wStr] = v.split('-W');
            const y = parseInt(yStr, 10), w = parseInt(wStr, 10);
            if (!y || !w) return `days=30`;
            const { start, end } = isoWeekToDateRange(y, w);
            return `start=${start}&end=${end}`;
        }
        if (mode === 'month') {
            const v = String(monthEl?.value || '').trim();
            if (!v) return `days=30`;
            const [yStr, mStr] = v.split('-');
            const y = parseInt(yStr, 10), m = parseInt(mStr, 10);
            if (!y || !m) return `days=30`;
            const { start, end } = monthToDateRange(y, m);
            return `start=${start}&end=${end}`;
        }
        return `days=30`;
    };

    // Load stats API + full data for charts (parallel)
    const [statsRes, dataRes, pushRes] = await Promise.all([
        fetch(`/api/stats?${buildQuery()}`),
        fetch('/api/data'),
        fetch('/api/push-logs')
    ]);

    if (!statsRes.ok) throw new Error('HTTP ' + statsRes.status);
    const s = await statsRes.json();

    let allData = { companies: [], prospects: [] };
    let pushLogs = [];
    try { allData = await dataRes.json(); } catch (e) {}
    try { pushLogs = await pushRes.json(); } catch (e) {}

    const from = s?.range?.from || '';
    const to = s?.range?.to || '';
    if (label) {
        label.textContent = (s?.range?.mode === 'all') ? 'Période: All time' :
            ((from && to) ? `Période: ${from} → ${to}` : '');
    }

    // KPI Cards
    if (cards) {
        cards.appendChild(statCard('Prospects', s.totals?.prospects ?? 0));
        cards.appendChild(statCard('Entreprises', s.totals?.companies ?? 0));
        const sub = (s?.range?.mode === 'all') ? 'All time' : ((from && to) ? `${from} → ${to}` : '');
        cards.appendChild(statCard('Push envoyés', s.activity?.pushes ?? 0, sub));
        cards.appendChild(statCard("Notes d'appel", s.activity?.callNotes ?? 0, sub));
        cards.appendChild(statCard('Relances en retard', s.followups?.late ?? 0, '', (s.followups?.late > 0) ? 'stat-card-alert' : ''));
        cards.appendChild(statCard("Relances aujourd'hui", s.followups?.dueToday ?? 0));
        cards.appendChild(statCard('RDV', s.statusCounts?.Rendezvous ?? 0, '', 'stat-card-success'));
        cards.appendChild(statCard('À rappeler', s.statusCounts?.A_rappeler ?? 0));
    }

    // Charts
    const prospects = Array.isArray(allData?.prospects) ? allData.prospects : [];
    const companies = Array.isArray(allData?.companies) ? allData.companies : [];

    // Charts rendered by loadCharts() which uses /api/stats/charts
    // (old render* functions removed — they had wrong canvas IDs)

    // Hot companies table
    if (tbody) {
        const list = Array.isArray(s.hotCompanies) ? s.hotCompanies : [];
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 35px; color: var(--color-text-secondary);">Aucune donnée</td></tr>';
            return;
        }
        tbody.innerHTML = '';
        list.forEach(h => {
            const cName = `${safeStr(h.groupe)}${h.site ? ' (' + safeStr(h.site) + ')' : ''}`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td data-label="Entreprise"><span class="table-cell-clamp" title="${escapeHtml(cName)}">${escapeHtml(cName)}</span></td>
              <td data-label="Score"><span class="badge">${escapeHtml(String(h.score ?? 0))}</span></td>
              <td data-label="Prospects">${escapeHtml(String(h.prospectCount ?? 0))}</td>
              <td data-label="RDV">${escapeHtml(String(h.rdvCount ?? 0))}</td>
              <td data-label="Relances en retard">${escapeHtml(String(h.lateFollowups ?? 0))}</td>
              <td data-label="Actions">
                <div class="table-actions-inline">
                  <a class="mini-action" href="/?company=${h.company_id}" title="Voir prospects">👥</a>
                  <a class="mini-action" href="/entreprises?openCompany=${h.company_id}" title="Ouvrir entreprise">🏢</a>
                </div>
              </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

// ====== Charts (Chart.js) ======

const _chartInstances = {};

function destroyChart(id) {
    if (_chartInstances[id]) {
        _chartInstances[id].destroy();
        delete _chartInstances[id];
    }
}

function isDarkMode() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function chartColors() {
    const dark = isDarkMode();
    return {
        text: dark ? '#e2e8f0' : '#334155',
        grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        bg: dark ? '#1e293b' : '#ffffff',
    };
}

async function loadCharts() {
    // Wait for Chart.js to be available (CDN may be slow)
    if (typeof Chart === 'undefined') {
        await _loadChartJsFallback();
    }
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not available after retries');
        // Show friendly message in chart containers
        ['chartStatus','chartPertinence','chartPush','chartRdv','chartCompanies'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:180px;color:var(--color-text-secondary);font-size:13px;text-align:center;">
                    📊 Charts indisponibles<br><small>Vérifiez votre connexion internet<br>pour charger Chart.js</small></div>`;
            }
        });
        return;
    }

    try {
        const res = await fetch('/api/stats/charts');
        if (!res.ok) return;
        const d = await res.json();
        if (!d.ok) return;

        const colors = chartColors();
        const defaults = Chart.defaults;
        defaults.color = colors.text;
        defaults.borderColor = colors.grid;

        // 1) Status Distribution (Doughnut)
        {
            destroyChart('chartStatus');
            const labels = Object.keys(d.statusDistribution || {});
            const values = Object.values(d.statusDistribution || {});
            const palette = ['#64748b', '#f59e0b', '#3b82f6', '#ef4444', '#22c55e', '#94a3b8', '#8b5cf6', '#ec4899'];
            const ctx = document.getElementById('chartStatus');
            if (ctx) {
                _chartInstances['chartStatus'] = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels,
                        datasets: [{ data: values, backgroundColor: palette.slice(0, labels.length), borderWidth: 0 }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { position: 'bottom', labels: { padding: 14, font: { size: 12 } } }
                        }
                    }
                });
            }
        }

        // 2) Pertinence Distribution (Polar Area)
        {
            destroyChart('chartPertinence');
            const pert = d.pertinenceDistribution || {};
            const labels = ['⭐', '⭐⭐', '⭐⭐⭐', '⭐⭐⭐⭐', '⭐⭐⭐⭐⭐'];
            const values = ['1','2','3','4','5'].map(k => pert[k] || 0);
            const palette = ['#94a3b8', '#f59e0b', '#eab308', '#f97316', '#ef4444'];
            const ctx = document.getElementById('chartPertinence');
            if (ctx) {
                _chartInstances['chartPertinence'] = new Chart(ctx, {
                    type: 'polarArea',
                    data: {
                        labels,
                        datasets: [{ data: values, backgroundColor: palette.map(c => c + 'cc'), borderWidth: 0 }]
                    },
                    options: {
                        responsive: true,
                        scales: { r: { ticks: { display: false }, grid: { color: colors.grid } } },
                        plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } } }
                    }
                });
            }
        }

        // 3) Push per Week (Bar)
        {
            destroyChart('chartPush');
            const items = d.pushPerWeek || [];
            const ctx = document.getElementById('chartPush');
            if (ctx) {
                _chartInstances['chartPush'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: items.map(i => i.label),
                        datasets: [{
                            label: 'Push envoyés',
                            data: items.map(i => i.count),
                            backgroundColor: '#32b8c6cc',
                            borderRadius: 6,
                            borderSkipped: false,
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            x: { grid: { display: false } },
                            y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        // 4) RDV per Month (Line)
        {
            destroyChart('chartRdv');
            const items = d.rdvPerMonth || [];
            const ctx = document.getElementById('chartRdv');
            if (ctx) {
                _chartInstances['chartRdv'] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: items.map(i => i.label),
                        datasets: [{
                            label: 'RDV',
                            data: items.map(i => i.count),
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(34,197,94,0.15)',
                            fill: true,
                            tension: 0.35,
                            pointRadius: 5,
                            pointBackgroundColor: '#22c55e',
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            x: { grid: { display: false } },
                            y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        // 5) Top Companies (Horizontal Bar)
        {
            destroyChart('chartCompanies');
            const items = d.topCompanies || [];
            const ctx = document.getElementById('chartCompanies');
            if (ctx) {
                _chartInstances['chartCompanies'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: items.map(i => i.name),
                        datasets: [{
                            label: 'Prospects',
                            data: items.map(i => i.count),
                            backgroundColor: ['#6366f1cc', '#8b5cf6cc', '#a78bfacc', '#c4b5fdcc', '#3b82f6cc', '#60a5facc', '#93c5fdcc', '#bfdbfecc'],
                            borderRadius: 6,
                            borderSkipped: false,
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        scales: {
                            x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } },
                            y: { grid: { display: false } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

    } catch (err) {
        console.error('Charts load error:', err);
    }

    // ═══ Additional Charts (v16.5) ═══
    try {
        // Funnel chart - conversion rates by status
        {
            destroyChart('chartFunnel');
            const ctx = document.getElementById('chartFunnel');
            if (ctx && d && d.statusDistribution) {
                const statusOrder = ["Pas d'actions", "Appelé", "À rappeler", "Messagerie", "Rendez-vous", "Rencontré", "Pas intéressé"];
                const statusCounts = {};
                (d.statusDistribution || []).forEach(s => { statusCounts[s.label] = s.count; });
                const funnelData = statusOrder.map(s => statusCounts[s] || 0);
                const funnelColors = ['#64748b', '#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e', '#10b981', '#ef4444'];
                
                _chartInstances['chartFunnel'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: statusOrder,
                        datasets: [{
                            data: funnelData,
                            backgroundColor: funnelColors.map(c => c + 'cc'),
                            borderRadius: 8,
                            borderSkipped: false,
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                            y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        // Portfolio evolution (total prospects over time)
        {
            destroyChart('chartPortfolio');
            const ctx = document.getElementById('chartPortfolio');
            if (ctx && data && data.prospects) {
                // Build weekly counts over last 12 weeks
                const now = new Date();
                const weeks = [];
                const labels = [];
                for (let w = 11; w >= 0; w--) {
                    const weekEnd = new Date(now);
                    weekEnd.setDate(now.getDate() - w * 7);
                    const weekStart = new Date(weekEnd);
                    weekStart.setDate(weekEnd.getDate() - 6);
                    const dateStr = weekEnd.toISOString().split('T')[0];
                    const count = data.prospects.filter(p => {
                        const lc = p.lastContact || '';
                        return lc && lc <= dateStr;
                    }).length;
                    weeks.push(count || data.prospects.length);
                    labels.push('S-' + w);
                }
                
                _chartInstances['chartPortfolio'] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Prospects actifs',
                            data: weeks,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99,102,241,0.12)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 4,
                            pointBackgroundColor: '#6366f1',
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            x: { grid: { display: false } },
                            y: { beginAtZero: false, grid: { color: colors.grid } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }

        // Top tags/competences chart
        {
            destroyChart('chartTags');
            const ctx = document.getElementById('chartTags');
            if (ctx && data && data.prospects) {
                const tagCounts = {};
                data.prospects.forEach(p => {
                    const tags = p.tags || [];
                    tags.forEach(t => {
                        const key = t.trim();
                        if (key) tagCounts[key] = (tagCounts[key] || 0) + 1;
                    });
                });
                const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
                const tagColors = ['#f36f21', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1', '#ef4444', '#64748b', '#10b981', '#a855f7', '#f97316', '#06b6d4', '#84cc16'];
                
                _chartInstances['chartTags'] = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: sorted.map(s => s[0]),
                        datasets: [{
                            data: sorted.map(s => s[1]),
                            backgroundColor: tagColors.map(c => c + 'cc'),
                            borderRadius: 6,
                            borderSkipped: false,
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        scales: {
                            x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: colors.grid } },
                            y: { grid: { display: false }, ticks: { font: { size: 11 } } }
                        },
                        plugins: { legend: { display: false } }
                    }
                });
            }
        }
    } catch (err) {
        console.error('Extra charts error:', err);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('stats');
    } catch(e) {}

    document.getElementById('btnStatsReload')?.addEventListener('click', () => { loadStats(); loadCharts(); });
    const modeEl = document.getElementById('statsRangeMode');
    const weekEl = document.getElementById('statsWeek');
    const monthEl = document.getElementById('statsMonth');

    function refreshRangeUI() {
        const mode = String(modeEl?.value || '30');
        if (weekEl) weekEl.style.display = (mode === 'week') ? '' : 'none';
        if (monthEl) monthEl.style.display = (mode === 'month') ? '' : 'none';
    }

    modeEl?.addEventListener('change', () => { refreshRangeUI(); loadStats(); loadCharts(); });
    weekEl?.addEventListener('change', () => { loadStats(); loadCharts(); });
    monthEl?.addEventListener('change', () => { loadStats(); loadCharts(); });
    refreshRangeUI();

    try {
        await loadStats();
        await loadCharts();
    } catch(err) {
        console.error(err);
    }
});

// ---- date helpers ----

function pad2(n) { return String(n).padStart(2, '0'); }

function isoWeekToDateRange(year, week) {
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay() || 7;
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setDate(jan4.getDate() - (day - 1));
    const start = new Date(mondayWeek1);
    start.setDate(mondayWeek1.getDate() + (week - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: dateToISO(start), end: dateToISO(end) };
}

function monthToDateRange(year, month1to12) {
    const start = new Date(year, month1to12 - 1, 1);
    const end = new Date(year, month1to12, 0);
    return { start: dateToISO(start), end: dateToISO(end) };
}

function dateToISO(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ════════════════════════════════════════════════════════════════
// Weekly Excel Export + Thursday morning alert (v22.1)
// ════════════════════════════════════════════════════════════════

/** Get current ISO week string like "2026-W10" */
function _currentISOWeek() {
    const d = new Date();
    // ISO week calculation
    const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const jan4 = new Date(tmp.getFullYear(), 0, 4);
    const week = 1 + Math.round(((tmp - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
    return `${tmp.getFullYear()}-W${pad2(week)}`;
}

/** Trigger download of the weekly export XLSX */
function downloadWeeklyExport() {
    const weekStr = _currentISOWeek();
    const url = `/api/stats/export_weekly_xlsx?week=${weekStr}`;
    // Use a hidden link to trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Mark as exported in localStorage
    localStorage.setItem('prospup_lastExportWeek', weekStr);
    if (typeof showToast === 'function') showToast('Téléchargement en cours…', 'success');

    // Hide alert if visible
    const alert = document.getElementById('weeklyExportAlert');
    if (alert) alert.style.display = 'none';
}

/** Check if Thursday alert should be shown */
function _checkThursdayExportAlert() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 4=Thu
    const hour = now.getHours();

    // Show alert from Thursday 8am onwards until export is done
    if (dayOfWeek < 4 || (dayOfWeek === 4 && hour < 8)) return;

    const currentWeek = _currentISOWeek();
    const lastExport = localStorage.getItem('prospup_lastExportWeek') || '';

    if (lastExport === currentWeek) return; // Already exported this week

    const alertEl = document.getElementById('weeklyExportAlert');
    if (alertEl) alertEl.style.display = '';
}

// Bind export buttons on DOMContentLoaded
(function() {
    // Wait a tick to ensure DOM is ready (this file loads after DOMContentLoaded handler above)
    setTimeout(() => {
        document.getElementById('btnExportWeekly')?.addEventListener('click', downloadWeeklyExport);
        document.getElementById('btnExportFromAlert')?.addEventListener('click', downloadWeeklyExport);
        document.getElementById('btnDismissExportAlert')?.addEventListener('click', () => {
            const el = document.getElementById('weeklyExportAlert');
            if (el) el.style.display = 'none';
        });
        _checkThursdayExportAlert();
    }, 50);
})();
