// Dashboard page (v8)

function _trendIcon(current, previous) {
    if (!previous || previous === 0) return '';
    if (current > previous) return `<span class="dash-trend up">▲ ${current - previous}</span>`;
    if (current < previous) return `<span class="dash-trend down">▼ ${previous - current}</span>`;
    return `<span class="dash-trend flat">═</span>`;
}

function _dayName(iso) {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const d = new Date(iso + 'T00:00:00');
    return days[d.getDay()];
}

async function loadDashboard() {
    try {
        const res = await fetch('/api/dashboard');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Error');
        renderDashboard(json.data);
    } catch (e) {
        console.error('Dashboard error:', e);
        if (window.showErrorState) {
            window.showErrorState('dashKpiRow', 'Impossible de charger le dashboard.', loadDashboard);
        } else {
            document.getElementById('dashKpiRow').innerHTML =
                '<div class="card"><div class="muted">Impossible de charger le dashboard.</div></div>';
        }
    }
}

function renderDashboard(d) {
    // Carte bienvenue si aucun prospect (nouveau collaborateur)
    const totalProspects = (d.pipeline && d.pipeline.total) || 0;
    const main = document.querySelector('main.content');
    let welcomeEl = document.getElementById('dashWelcomeCard');
    if (totalProspects === 0 && main) {
        if (!welcomeEl) {
            welcomeEl = document.createElement('div');
            welcomeEl.id = 'dashWelcomeCard';
            welcomeEl.className = 'card dash-welcome-card';
            welcomeEl.innerHTML = `
                <div class="dash-welcome-inner">
                    <div class="dash-welcome-icon">👋</div>
                    <h3 class="dash-welcome-title">Bienvenue sur Prosp'Up</h3>
                    <p class="dash-welcome-text">Pour retrouver facilement votre liste de prospection, importez votre fichier Excel ou CSV. Vous pourrez ensuite relancer vos contacts et suivre vos RDV au même endroit.</p>
                    <div class="dash-welcome-actions">
                        <a href="/?openImport=1" class="btn btn-primary" style="padding:12px 24px;font-size:15px;text-decoration:none;">📥 Importer ma liste</a>
                        <a href="/help" class="btn btn-secondary" style="padding:10px 18px;text-decoration:none;">Guide d'utilisation</a>
                    </div>
                </div>
            `;
            main.insertBefore(welcomeEl, main.firstChild);
        }
    } else if (welcomeEl) {
        welcomeEl.remove();
    }

    renderRelanceAlertBanner(d.pipeline);
    renderFirstGlance(d);
    renderKpiCards(d);
    renderWeekChart(d.week);
    renderGoals(d.goals, d.week, d.today);
    renderOverdue(d.overdue_list, d.pipeline);
    renderFeed(d.feed, d.today);
    renderUpcomingRdv(d.upcoming_rdv || []);
    renderPipeline(d.pipeline);
    renderPushAnalytics();
    
    // Appliquer les préférences d'affichage APRÈS le rendu de tous les widgets
    if (typeof window.applyDashboardDisplayPrefs === 'function') {
        window.applyDashboardDisplayPrefs();
    }
    // Réorganiser l'ordre après application des préférences
    applyDashboardWidgetOrder();
    
    // Note: Le drag & drop sera initialisé UNE SEULE FOIS dans le DOMContentLoaded
    // après le chargement complet pour éviter les conflits de timing
}

// Applique les préférences d'affichage des cartes du dashboard
function applyDashboardDisplayPrefs() {
    if (typeof window.getDisplayPref !== 'function') {
        // Si getDisplayPref n'est pas disponible, afficher tous les widgets par défaut
        var container = document.getElementById('dashWidgetsContainer');
        if (container) {
            container.querySelectorAll('.dash-widget').forEach(function (w) {
                w.style.display = '';
            });
        }
        return;
    }
    var map = [
        { pref: 'display_kpi_row', ids: ['dashKpiRow', 'dashKpiActionsRow'] },
        { pref: 'display_first_glance', ids: ['dashFirstGlance'] },
        { pref: 'display_goals', ids: ['dashGoalsCard'] },
        { pref: 'display_dash_activity', ids: ['dashFeedCard'] },
        { pref: 'display_dash_week', ids: ['dashWeekChartCard'] },
        { pref: 'display_dash_overdue', ids: ['dashOverdueCard'] },
        { pref: 'display_dash_rdv', ids: ['dashRdvCard'] },
        { pref: 'display_dash_tasks', ids: ['dashTasksCard'] },
        { pref: 'display_dash_priorities', ids: ['dashPrioritiesCard'] },
        { pref: 'display_dash_push_analytics', ids: ['dashPushAnalyticsCard'] },
        { pref: 'display_dash_pipeline', ids: ['dashPipelineCard'] }
    ];
    map.forEach(function (item) {
        // Par défaut, afficher si la préférence n'existe pas (true par défaut)
        var on = window.getDisplayPref(item.pref);
        if (on === undefined || on === null) on = true; // Par défaut visible
        item.ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                var wrapper = el.closest('.dash-widget');
                var target = wrapper || el;
                if (target) {
                    // Utiliser data-display-pref pour marquer que c'est une préférence, pas un masquage adaptatif
                    target.setAttribute('data-display-pref', on ? '1' : '0');
                    target.style.display = on ? '' : 'none';
                }
            }
        });
    });
}
window.applyDashboardDisplayPrefs = applyDashboardDisplayPrefs;

// ═══ Widgets réorganisables (v25+) — ordre sauvegardé par utilisateur ─══
var DASH_WIDGET_ORDER_KEY = 'dashboard_widget_order';
var DASH_WIDGET_COLUMNS_KEY = 'dashboard_widget_columns';
var DASH_WIDGET_IDS = ['dashFirstGlance', 'dashGoalsCard', 'dashFeedCard', 'dashTasksCard', 'dashWeekChartCard', 'dashOverdueCard', 'dashRdvCard', 'dashPipelineCard', 'dashPrioritiesCard', 'dashPushAnalyticsCard'];

function getDashboardWidgetOrder() {
    try {
        var raw = localStorage.getItem(DASH_WIDGET_ORDER_KEY);
        if (raw) {
            var order = JSON.parse(raw);
            if (Array.isArray(order) && order.length) return order;
        }
    } catch (e) {}
    return DASH_WIDGET_IDS.slice();
}

function saveDashboardWidgetOrder() {
    var container = document.getElementById('dashWidgetsContainer');
    if (!container) return;
    var order = [];
    // Sauvegarder TOUS les widgets dans l'ordre, même ceux masqués par les préférences
    // Cela permet de préserver l'ordre même si un widget est temporairement masqué
    container.querySelectorAll('.dash-widget').forEach(function (w) {
        var id = w.getAttribute('data-widget-id');
        if (id) {
            // Vérifier si le widget est masqué uniquement par les préférences (pas par l'adaptatif)
            var isHiddenByPref = w.getAttribute('data-display-pref') === '0';
            // Inclure dans l'ordre même si masqué par préférence (mais pas si complètement absent du DOM)
            order.push(id);
        }
    });
    try { localStorage.setItem(DASH_WIDGET_ORDER_KEY, JSON.stringify(order)); } catch (e) {}
    // Ne pas afficher de toast à chaque drag & drop pour éviter le spam
    // if (window.showToast) window.showToast('Ordre des widgets enregistré.', 'success', 2000);
}

function getDashboardColumns() {
    try {
        var cols = parseInt(localStorage.getItem(DASH_WIDGET_COLUMNS_KEY) || '2', 10);
        return Math.max(1, Math.min(3, cols));
    } catch (e) {
        return 2;
    }
}

function setDashboardColumns(cols) {
    var container = document.getElementById('dashWidgetsContainer');
    if (!container) return;
    cols = Math.max(1, Math.min(3, parseInt(cols, 10) || 2));
    try { localStorage.setItem(DASH_WIDGET_COLUMNS_KEY, String(cols)); } catch (e) {}
    container.style.gridTemplateColumns = cols === 1 ? '1fr' : (cols === 2 ? '1fr 1fr' : '1fr 1fr 1fr');
    
    // Mettre à jour l'état visuel des boutons
    var controls = document.getElementById('dashWidgetsControls');
    if (controls) {
        controls.querySelectorAll('.dash-layout-btn').forEach(function (btn, idx) {
            var btnCols = idx + 1;
            if (btnCols === cols) {
                btn.style.background = 'var(--color-primary)';
                btn.style.color = 'white';
                btn.style.borderColor = 'var(--color-primary)';
            } else {
                btn.style.background = 'var(--color-background)';
                btn.style.color = 'var(--color-text)';
                btn.style.borderColor = 'var(--color-border)';
            }
        });
    }
    
    if (window.showToast) window.showToast('Layout mis à jour : ' + cols + ' colonne' + (cols > 1 ? 's' : ''), 'success', 2000);
    // Feedback haptique si disponible
    if (typeof window.haptic === 'function') window.haptic(15);
}

function applyDashboardColumns() {
    var container = document.getElementById('dashWidgetsContainer');
    if (!container) return;
    var cols = getDashboardColumns();
    container.style.gridTemplateColumns = cols === 1 ? '1fr' : (cols === 2 ? '1fr 1fr' : '1fr 1fr 1fr');
    
    // Mettre à jour l'état visuel des boutons
    var controls = document.getElementById('dashWidgetsControls');
    if (controls) {
        controls.querySelectorAll('.dash-layout-btn').forEach(function (btn, idx) {
            var btnCols = idx + 1;
            if (btnCols === cols) {
                btn.style.background = 'var(--color-primary)';
                btn.style.color = 'white';
                btn.style.borderColor = 'var(--color-primary)';
            } else {
                btn.style.background = 'var(--color-background)';
                btn.style.color = 'var(--color-text)';
                btn.style.borderColor = 'var(--color-border)';
            }
        });
    }
}

function applyDashboardWidgetOrder() {
    var container = document.getElementById('dashWidgetsContainer');
    if (!container) return;
    var order = getDashboardWidgetOrder();
    var byId = {};
    // Collecter tous les widgets présents dans le DOM
    container.querySelectorAll('.dash-widget').forEach(function (w) {
        var id = w.getAttribute('data-widget-id');
        if (id) byId[id] = w;
    });
    // Réorganiser selon l'ordre sauvegardé
    order.forEach(function (id) {
        if (byId[id]) {
            container.appendChild(byId[id]);
            delete byId[id]; // Marquer comme traité
        }
    });
    // Ajouter les widgets qui ne sont pas dans l'ordre sauvegardé (nouveaux widgets) à la fin
    Object.keys(byId).forEach(function (id) {
        if (byId[id]) container.appendChild(byId[id]);
    });
}

// ═══ Système de glisser-déposer amélioré et modulaire ═══
var _dashboardDragDropInitialized = false;
var _dashboardDraggedWidget = null;

function initDashboardWidgetDragDrop() {
    var container = document.getElementById('dashWidgetsContainer');
    if (!container) {
        console.warn('[Dashboard] dashWidgetsContainer non trouvé');
        return;
    }
    
    // Nettoyer les anciens event listeners si déjà initialisé
    // Le clonage retire tous les event listeners précédents
    if (_dashboardDragDropInitialized) {
        container.querySelectorAll('.dash-widget-handle').forEach(function (handle) {
            var newHandle = handle.cloneNode(true);
            handle.parentNode.replaceChild(newHandle, handle);
        });
        container.querySelectorAll('.dash-widget').forEach(function (w) {
            var newWidget = w.cloneNode(true);
            w.parentNode.replaceChild(newWidget, w);
        });
    }
    
    _dashboardDraggedWidget = null;
    
    // Attacher les événements sur les handles (poignées de drag)
    container.querySelectorAll('.dash-widget-handle').forEach(function (handle) {
        // S'assurer que draggable est activé
        handle.setAttribute('draggable', 'true');
        
        handle.addEventListener('dragstart', function (e) {
            var w = handle.closest('.dash-widget');
            if (!w) {
                console.warn('[Dashboard] Widget parent non trouvé pour handle');
                return;
            }
            _dashboardDraggedWidget = w;
            e.dataTransfer.setData('text/plain', w.getAttribute('data-widget-id') || '');
            e.dataTransfer.effectAllowed = 'move';
            w.classList.add('dash-widget-dragging');
            // Feedback haptique si disponible
            if (typeof window.haptic === 'function') window.haptic(10);
        });
        
        handle.addEventListener('dragend', function (e) {
            if (_dashboardDraggedWidget) {
                _dashboardDraggedWidget.classList.remove('dash-widget-dragging');
                _dashboardDraggedWidget = null;
            }
            container.querySelectorAll('.dash-widget').forEach(function (w) { 
                w.classList.remove('dash-widget-drag-over'); 
            });
        });
    });

    // Attacher les événements sur les widgets (zones de drop)
    container.querySelectorAll('.dash-widget').forEach(function (w) {
        w.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            if (_dashboardDraggedWidget && _dashboardDraggedWidget !== w) {
                w.classList.add('dash-widget-drag-over');
            }
        });
        
        w.addEventListener('dragleave', function (e) {
            // Ne retirer la classe que si on quitte vraiment le widget
            var rect = w.getBoundingClientRect();
            var x = e.clientX;
            var y = e.clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                w.classList.remove('dash-widget-drag-over');
            }
        });
        
        w.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            w.classList.remove('dash-widget-drag-over');
            if (!_dashboardDraggedWidget || _dashboardDraggedWidget === w) return;
            
            // Calculer la position d'insertion (avant ou après selon la position de la souris)
            var rect = w.getBoundingClientRect();
            var y = e.clientY;
            var midY = rect.top + rect.height / 2;
            
            if (y < midY) {
                // Insérer avant
                container.insertBefore(_dashboardDraggedWidget, w);
            } else {
                // Insérer après
                var next = w.nextElementSibling;
                container.insertBefore(_dashboardDraggedWidget, next);
            }
            
            saveDashboardWidgetOrder();
            // Feedback haptique si disponible
            if (typeof window.haptic === 'function') window.haptic(20);
        });
    });
    
    _dashboardDragDropInitialized = true;
    console.log('[Dashboard] Drag & drop initialisé');
}

// Note: L'application de l'ordre et des colonnes est maintenant gérée dans le DOMContentLoaded
// pour éviter les conflits de timing avec le chargement des données

// Exposer les fonctions globalement pour les boutons de contrôle
window.setDashboardColumns = setDashboardColumns;
window.getDashboardColumns = getDashboardColumns;

// ═══ Bannière alerte relances (P1) ═══
function renderRelanceAlertBanner(pipeline) {
    const container = document.getElementById('relanceAlertBanner');
    if (!container) return;
    if (typeof window.getDisplayPref === 'function' && !window.getDisplayPref('display_relance_banner')) {
        container.style.display = 'none';
        return;
    }
    const overdue = (pipeline && pipeline.overdue) || 0;
    const dueToday = (pipeline && pipeline.due_today) || 0;
    if (overdue === 0 && dueToday === 0) {
        container.style.display = 'none';
        return;
    }
    if (sessionStorage.getItem('relanceAlertDismissed')) {
        var dismissed = parseInt(sessionStorage.getItem('relanceAlertDismissed'), 10);
        if (Date.now() - dismissed < 3600000) container.style.display = 'none';
    }
    const textEl = document.getElementById('relanceAlertBannerText');
    if (textEl) {
        var parts = [];
        if (overdue > 0) parts.push(overdue + ' relance' + (overdue > 1 ? 's' : '') + ' en retard');
        if (dueToday > 0) parts.push(dueToday + ' à faire aujourd\'hui');
        textEl.textContent = '⚠️ ' + parts.join(' · ');
    }
    container.style.display = 'flex';
}

// ═══ Premier coup d'œil (P3) ═══
function renderFirstGlance(d) {
    const container = document.getElementById('dashFirstGlance');
    const itemsEl = document.getElementById('dashFirstGlanceItems');
    if (!container || !itemsEl) return;
    const pipeline = d.pipeline || {};
    const overdue = pipeline.overdue || 0;
    const dueToday = pipeline.due_today || 0;
    const upcomingRdv = d.upcoming_rdv || [];
    const rdvThisWeek = upcomingRdv.length;
    const items = [];
    if (overdue > 0) {
        items.push({ label: overdue + ' relance' + (overdue > 1 ? 's' : '') + ' en retard', href: '/focus', icon: '⚠️' });
    }
    if (dueToday > 0) {
        items.push({ label: dueToday + ' à faire aujourd\'hui', href: '/focus', icon: '📌' });
    }
    if (rdvThisWeek > 0) {
        items.push({ label: rdvThisWeek + ' RDV à venir', href: '/calendrier', icon: '🤝' });
    }
    itemsEl.innerHTML = items.map(function (it) {
        return '<a class="dash-first-glance-item" href="' + (it.href || '#') + '">' +
            '<span class="dash-first-glance-icon">' + (it.icon || '•') + '</span>' +
            '<span class="dash-first-glance-label">' + (it.label || '') + '</span>' +
            '</a>';
    }).join('');
}

// P7: Export "Ma journée"
async function exportDayRecap() {
    try {
        const res = await fetch('/api/export/day');
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        const recap = json.recap || {};
        const dateStr = recap.date || new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(recap, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "Prosp'Up_ma_journee_" + dateStr + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
        if (typeof showToast === 'function') showToast('📥 Récap du jour téléchargé', 'success');
    } catch (e) {
        if (typeof showToast === 'function') showToast(e.message || 'Erreur export', 'error');
    }
}
window.exportDayRecap = exportDayRecap;

// ═══ KPI Cards ═══
function renderKpiCards(d) {
    const t = d.today;
    const w = d.week;
    const pw = d.prev_week;

    const cards = [
        {
            icon: '📞', label: "Contacts aujourd'hui", value: t.contacts,
            sub: `${w.contacts} cette semaine`,
            trend: _trendIcon(w.contacts, pw.contacts),
            color: '#f59e0b',
        },
        {
            icon: '📝', label: "Notes d'appel", value: t.notes,
            sub: `${w.notes} cette semaine`,
            trend: _trendIcon(w.notes, pw.notes),
            color: '#3b82f6',
        },
        {
            icon: '📤', label: 'Push envoyés', value: t.push_total,
            sub: `${w.push_total} cette semaine (✉️${w.push_email} · in${w.push_linkedin})`,
            trend: _trendIcon(w.push_total, pw.push_total),
            color: '#8b5cf6',
        },
        {
            icon: '🤝', label: 'RDV en cours', value: d.pipeline.rdv,
            sub: `sur ${d.pipeline.total} prospects`,
            trend: '',
            color: '#22c55e',
        },
        {
            icon: '⚠️', label: 'Relances en retard', value: d.pipeline.overdue,
            sub: `${d.pipeline.due_today} à faire aujourd'hui`,
            trend: '',
            color: d.pipeline.overdue > 0 ? '#ef4444' : '#64748b',
            alert: d.pipeline.overdue > 0,
        },
    ];

    const row = document.getElementById('dashKpiRow');
    row.innerHTML = cards.map(c => `
        <div class="dash-kpi${c.alert ? ' dash-kpi-alert' : ''}" style="--kpi-color: ${c.color}">
            <div class="dash-kpi-icon">${c.icon}</div>
            <div class="dash-kpi-value">${c.value}</div>
            <div class="dash-kpi-label">${c.label}</div>
            <div class="dash-kpi-sub">${c.sub} ${c.trend}</div>
        </div>
    `).join('');
}

// ═══ Week sparkline (CSS bars) ═══
function renderWeekChart(w) {
    const container = document.getElementById('dashWeekChart');
    const summary = document.getElementById('dashWeekSummary');
    if (!container) return;

    const days = w.days || [];
    if (!days.length) {
        container.innerHTML = '<div class="muted">Aucune donnée cette semaine</div>';
        return;
    }

    const totals = days.map(d => (d.contacts || 0) + (d.notes || 0) + (d.push || 0));
    const maxTotal = Math.max(1, ...totals);

    container.innerHTML = `
        <div class="dash-bars">
            ${days.map(d => {
                const c = d.contacts || 0;
                const n = d.notes || 0;
                const p = d.push || 0;
                const total = c + n + p;
                const barH = total ? Math.round((total / maxTotal) * 100) : 0;
                const isToday = d.date === w.end;
                // Segment heights must sum to 100% (within the filled bar)
                let pc = total ? Math.round((c / total) * 100) : 0;
                let pn = total ? Math.round((n / total) * 100) : 0;
                let pp = total ? Math.round((p / total) * 100) : 0;
                if (c > 0) pc = Math.max(2, pc);
                if (n > 0) pn = Math.max(2, pn);
                if (p > 0) pp = Math.max(2, pp);
                let sum = pc + pn + pp;
                if (total > 0 && sum !== 100) {
                    // Adjust the largest segment to compensate
                    const arr = [
                        { k: 'c', v: pc },
                        { k: 'n', v: pn },
                        { k: 'p', v: pp },
                    ];
                    arr.sort((a,b) => b.v - a.v);
                    arr[0].v += (100 - sum);
                    // Write back
                    for (const x of arr) {
                        if (x.k === 'c') pc = Math.max(0, x.v);
                        if (x.k === 'n') pn = Math.max(0, x.v);
                        if (x.k === 'p') pp = Math.max(0, x.v);
                    }
                }
                return `
                    <div class="dash-bar-col${isToday ? ' today' : ''}" title="${d.date}\n📞 ${c} contacts\n📝 ${n} notes\n📤 ${p} push">
                        <div class="dash-bar-stack">
                          <div class="dash-bar-fill" style="height:${barH}%;">
                            <div class="dash-bar-seg contacts" style="height:${pc}%"></div>
                            <div class="dash-bar-seg notes" style="height:${pn}%"></div>
                            <div class="dash-bar-seg push" style="height:${pp}%"></div>
                          </div>
                        </div>
                        <div class="dash-bar-label">${_dayName(d.date)}</div>
                        <div class="dash-bar-total">${total}</div>
                    </div>`;
            }).join('')}
        </div>
        <div class="dash-legend">
            <span class="dash-legend-item"><span class="dash-legend-dot contacts"></span> Contacts</span>
            <span class="dash-legend-item"><span class="dash-legend-dot notes"></span> Notes</span>
            <span class="dash-legend-item"><span class="dash-legend-dot push"></span> Push</span>
        </div>
    `;

    const totalW = days.reduce((s, d) => s + d.contacts + d.notes + d.push, 0);
    if (summary) summary.textContent = `Total semaine : ${totalW} actions · ${days.length} jours travaillés`;
}

// ═══ Goals / Gamification ═══
function _emojiForRatio(r) {
    const x = Math.max(0, Math.min(1, Number(r) || 0));
    if (x >= 1) return '🏆';
    if (x >= 0.8) return '🔥';
    if (x >= 0.6) return '🤩';
    if (x >= 0.4) return '😎';
    if (x >= 0.2) return '🙂';
    return '🥶';
}

function _formatXp(x) {
    const n = Math.round(Number(x) || 0);
    return n.toString();
}

function _weekKey(weekStartIso) {
    return (weekStartIso || '').slice(0, 10) || 'week';
}

function _fireConfetti(containerEl, intensity = 24) {
    if (!containerEl) return;
    containerEl.innerHTML = '';
    containerEl.classList.remove('active');
    // reflow
    void containerEl.offsetWidth;
    containerEl.classList.add('active');

    const colors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#22c55e', '#ef4444', '#eab308'];
    const n = Math.max(10, Math.min(60, intensity));
    for (let i = 0; i < n; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        const left = Math.random() * 100;
        const delay = Math.random() * 0.35;
        const dur = 0.9 + Math.random() * 0.7;
        const rot = Math.floor(Math.random() * 360);
        const size = 6 + Math.floor(Math.random() * 6);
        piece.style.left = left + '%';
        piece.style.animationDelay = delay + 's';
        piece.style.animationDuration = dur + 's';
        piece.style.transform = `rotate(${rot}deg)`;
        piece.style.width = size + 'px';
        piece.style.height = Math.max(6, Math.floor(size * (0.7 + Math.random() * 0.8))) + 'px';
        piece.style.setProperty('--confetti-color', colors[i % colors.length]);
        containerEl.appendChild(piece);
    }

    setTimeout(() => {
        try { containerEl.classList.remove('active'); } catch(e) {}
        try { containerEl.innerHTML = ''; } catch(e) {}
    }, 1800);
}

function _maybeToast(msg) {
    try {
        if (typeof showToast === 'function') showToast(msg, 'success');
    } catch (e) {}
}

function renderGoals(goalsPayload, week, todayObj) {
    const card = document.getElementById('dashGoalsCard');
    if (!card) {
        console.warn('[Dashboard] dashGoalsCard non trouvé dans le DOM');
        return;
    }
    
    // Vérifier que le widget parent existe et est visible selon les préférences
    const widget = card.closest('.dash-widget');
    if (widget) {
        // Si le widget est masqué par les préférences, ne pas le rendre (mais ne pas le supprimer)
        const isHiddenByPref = widget.getAttribute('data-display-pref') === '0';
        if (isHiddenByPref) {
            // Le widget est masqué intentionnellement par l'utilisateur, ne rien faire
            return;
        }
    }
    
    const body = card.querySelector('.dash-goals-body');
    const confetti = document.getElementById('dashGoalsConfetti') || card.querySelector('.dash-confetti-layer');

    if (!goalsPayload || !goalsPayload.daily || !goalsPayload.weekly) {
        if (body) body.innerHTML = '<div class="muted">Objectifs indisponibles.</div>';
        return;
    }

    const todayIso = (todayObj && todayObj.date) ? todayObj.date : new Date().toISOString().slice(0, 10);
    const weekStart = (week && week.start) ? week.start : todayIso;
    const wkKey = _weekKey(weekStart);

    const daily = goalsPayload.daily;
    const weekly = goalsPayload.weekly;

    const wkRatio = weekly.xp_total ? (weekly.xp_current / weekly.xp_total) : 0;
    const dayRatio = daily.xp_total ? (daily.xp_current / daily.xp_total) : 0;

    const wkEmoji = _emojiForRatio(wkRatio);
    const dayEmoji = _emojiForRatio(dayRatio);

    const wkXp = Number(weekly.xp_current || 0);
    const wkLevel = Math.floor(wkXp / 100) + 1;
    const prevLevelKey = `goals_level_${wkKey}`;
    const prevLevel = parseInt(localStorage.getItem(prevLevelKey) || '0', 10) || 0;
    if (wkLevel > prevLevel) {
        localStorage.setItem(prevLevelKey, String(wkLevel));
        _fireConfetti(confetti, 34);
        _maybeToast(`⬆️ Level up ! Niveau ${wkLevel}`);
    }

    function renderScope(scopeKey, scopeObj, periodKey, title, subtitleEmoji) {
        const items = scopeObj.items || {};
        const keys = Object.keys(items).filter(k => (items[k] && Number(items[k].target || 0)) > 0);
        const doneCount = keys.filter(k => items[k].done).length;
        const scopeRatio = scopeObj.xp_total ? (scopeObj.xp_current / scopeObj.xp_total) : 0;
        const emoji = subtitleEmoji || _emojiForRatio(scopeRatio);
        const goalsText = keys.length ? `${doneCount}/${keys.length} objectifs` : 'Aucun objectif';

        const rows = keys.map(k => {
            const it = items[k];
            const ratio = Math.max(0, Math.min(1, Number(it.ratio) || 0));
            const done = !!it.done;
            const stKey = `goal_done_${scopeKey}_${k}_${periodKey}`;
            const wasDone = localStorage.getItem(stKey) === '1';
            if (done && !wasDone) {
                localStorage.setItem(stKey, '1');
                _fireConfetti(confetti, 26);
                _maybeToast(`🏆 Objectif atteint : ${it.label}`);
            }

            return `
              <div class="dash-goal-item${done ? ' done' : ''}" data-goal="${scopeKey}:${k}">
                <div class="dash-goal-emoji" title="Progression">${_emojiForRatio(ratio)}</div>
                <div class="dash-goal-main">
                  <div class="dash-goal-top">
                    <div class="dash-goal-label">${escapeHtml(it.label || k)}</div>
                    <div class="dash-goal-count"><strong>${it.count}</strong><span class="muted">/${it.target}</span></div>
                  </div>
                  <div class="dash-goal-bar">
                    <div class="dash-goal-bar-fill" style="width:${Math.round(ratio * 100)}%"></div>
                  </div>
                  <div class="dash-goal-meta muted">+${_formatXp(it.xp_earned)} XP / +${_formatXp(it.xp)} XP</div>
                </div>
              </div>
            `;
        }).join('');

        return `
          <div class="dash-goals-scope">
            <div class="dash-goals-scope-head">
              <div>
                <div class="dash-goals-scope-title">${title}</div>
                <div class="dash-goals-scope-sub muted">${emoji} ${goalsText} · ${_formatXp(scopeObj.xp_current)}/${_formatXp(scopeObj.xp_total)} XP</div>
              </div>
              <div class="dash-goals-scope-badge">${emoji}</div>
            </div>
            <div class="dash-goals-list">${rows || '<div class="muted">Aucun objectif configuré.</div>'}</div>
          </div>
        `;
    }

    const html = `
      <div class="dash-goals-level">
        <div class="dash-goals-level-emoji">${wkEmoji}</div>
        <div class="dash-goals-level-main">
          <div class="dash-goals-level-top">
            <div class="dash-goals-level-title">Niveau semaine <span class="dash-goals-level-pill">Lv ${wkLevel}</span></div>
            <div class="dash-goals-level-xp"><strong>${_formatXp(weekly.xp_current)}</strong><span class="muted">/${_formatXp(weekly.xp_total)} XP</span></div>
          </div>
          <div class="dash-level-bar">
            <div class="dash-level-bar-fill" style="width:${Math.round(wkRatio * 100)}%"></div>
          </div>
          <div class="dash-level-sub muted">${dayEmoji} Boost du jour : ${_formatXp(daily.xp_current)}/${_formatXp(daily.xp_total)} XP</div>
        </div>
      </div>
      ${renderScope('daily', daily, todayIso, 'Objectifs quotidiens', dayEmoji)}
      ${renderScope('weekly', weekly, wkKey, 'Objectifs hebdo', wkEmoji)}
    `;

    if (body) body.innerHTML = html;
}

// ═══ Overdue relances ═══
function renderOverdue(list, pipeline) {
    const el = document.getElementById('dashOverdue');
    if (!el) return;

    if (!list || !list.length) {
        el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">✅ Aucune relance en retard !</div>';
        return;
    }

    el.innerHTML = list.map(p => {
        const daysLate = Math.floor((Date.now() - new Date(p.nextFollowUp + 'T00:00:00').getTime()) / 86400000);
        const urgency = daysLate >= 7 ? 'critical' : (daysLate >= 3 ? 'warning' : 'mild');
        return `
            <div class="dash-overdue-row ${urgency}">
                <div class="dash-overdue-info">
                    <strong>${escapeHtml(p.name)}</strong>
                    <span class="muted">${escapeHtml(p.statut)}</span>
                </div>
                <div class="dash-overdue-meta">
                    <span class="dash-overdue-date">${p.nextFollowUp}</span>
                    <span class="dash-overdue-days">-${daysLate}j</span>
                </div>
                <a href="/?open=${p.id}" class="btn btn-secondary btn-sm" style="text-decoration:none;">Ouvrir</a>
            </div>`;
    }).join('');

    if (list.length < pipeline.overdue) {
        el.innerHTML += `<div class="muted" style="text-align:center;padding:8px;">
            … et ${pipeline.overdue - list.length} autre${pipeline.overdue - list.length > 1 ? 's' : ''} · 
            <a href="/focus" style="color:var(--color-primary);">Voir tout dans Focus</a>
        </div>`;
    }
}

// ═══ Activity feed ═══
function renderFeed(feed, today) {
    const el = document.getElementById('dashFeed');
    if (!el) return;

    const items = [];

    (feed.notes || []).forEach(n => {
        items.push({
            time: (n.date || '').slice(11, 16) || '—',
            icon: '📝',
            text: `Note pour <strong>${escapeHtml(n.prospect_name)}</strong>`,
            detail: escapeHtml((n.content || '').slice(0, 100)),
            sort: n.date || '',
        });
    });

    (feed.push || []).forEach(p => {
        const channel = p.channel === 'email' ? '✉️' : (p.channel === 'linkedin' ? '💼' : '📤');
        items.push({
            time: (p.createdAt || '').slice(11, 16) || '—',
            icon: channel,
            text: `Push ${p.channel || ''} envoyé`,
            detail: escapeHtml(p.subject || p.to_email || ''),
            sort: p.createdAt || '',
        });
    });

    items.sort((a, b) => b.sort.localeCompare(a.sort));

    if (!items.length) {
        el.innerHTML = `<div class="muted" style="padding:16px;text-align:center;">
            Aucune activité aujourd'hui.<br>
            <span style="font-size:20px;margin-top:8px;display:inline-block;">🚀</span><br>
            <em>C'est le moment de passer des appels !</em>
        </div>`;
        return;
    }

    el.innerHTML = items.map(it => `
        <div class="dash-feed-item">
            <span class="dash-feed-time">${it.time}</span>
            <span class="dash-feed-icon">${it.icon}</span>
            <div class="dash-feed-content">
                <div>${it.text}</div>
                ${it.detail ? `<div class="muted" style="font-size:11px;">${it.detail}</div>` : ''}
            </div>
        </div>
    `).join('');
}

// ═══ Upcoming RDV ═══
function renderUpcomingRdv(list) {
    const el = document.getElementById('dashUpcomingRdv');
    if (!el) return;

    if (!list || !list.length) {
        el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Aucun RDV planifié.<br><em>Définissez une date RDV dans la fiche prospect.</em></div>';
        return;
    }

    el.innerHTML = list.map(p => {
        const dt = (p.rdvDate || '').replace('T', ' ').slice(0, 16);
        const isToday = (p.rdvDate || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
        return `
            <div class="dash-feed-item" style="${isToday ? 'background:rgba(34,197,94,.08);border-radius:6px;padding:8px;' : ''}">
                <span class="dash-feed-icon">🤝</span>
                <div class="dash-feed-content">
                    <div><strong>${escapeHtml(p.name)}</strong>${isToday ? ' <span style="color:#22c55e;font-weight:700;font-size:10px;">AUJOURD\'HUI</span>' : ''}</div>
                    <div class="muted" style="font-size:11px;">📅 ${dt}</div>
                </div>
                <a href="/?open=${p.id}" class="btn btn-secondary btn-sm" style="text-decoration:none;font-size:11px;">Ouvrir</a>
            </div>`;
    }).join('');
}

// ═══ Pipeline snapshot ═══
function renderPipeline(pipeline) {
    const el = document.getElementById('dashPipeline');
    if (!el) return;

    const statusOrder = ["Pas d'actions", "Appelé", "À rappeler", "Messagerie", "Rendez-vous", "Prospecté", "Pas intéressé"];
    const statusColors = {
        "Pas d'actions": '#64748b', 'Appelé': '#f59e0b', 'Messagerie': '#3b82f6',
        'À rappeler': '#ef4444', 'Rendez-vous': '#22c55e', 'Pas intéressé': '#94a3b8'
    };

    const total = pipeline.total || 1;

    el.innerHTML = `
        <div class="dash-pipeline-bar">
            ${statusOrder.map(s => {
                const n = pipeline.statuts[s] || 0;
                const pct = (n / total) * 100;
                if (pct < 1) return '';
                return `<div class="dash-pipeline-seg" style="width:${pct}%;background:${statusColors[s] || '#64748b'}" title="${s}: ${n}"></div>`;
            }).join('')}
        </div>
        <div class="dash-pipeline-legend">
            ${statusOrder.map(s => {
                const n = pipeline.statuts[s] || 0;
                if (!n) return '';
                return `<div class="dash-pipeline-item">
                    <span class="dash-pipeline-dot" style="background:${statusColors[s]}"></span>
                    <span>${s}</span>
                    <strong>${n}</strong>
                </div>`;
            }).join('')}
        </div>
        <div class="muted" style="margin-top:8px;font-size:11px;">
            Taux de conversion → RDV : <strong>${total ? Math.round((pipeline.rdv / total) * 100) : 0}%</strong>
        </div>
    `;
}

// ═══ Dashboard Tasks (3 most recent pending) ═══
async function loadDashTasks() {
    const el = document.getElementById('dashTasks');
    if (!el) return;
    try {
        const res = await fetch('/api/tasks?status=pending');
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        renderDashTasks(json.tasks || []);
    } catch (e) {
        el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Impossible de charger les t\u00e2ches.</div>';
    }
}

function renderDashTasks(tasks) {
    const el = document.getElementById('dashTasks');
    if (!el) return;

    if (!tasks.length) {
        el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Aucune t\u00e2che en cours.<br><a href="/focus" style="color:var(--color-primary);">Cr\u00e9er une t\u00e2che dans Focus</a></div>';
        return;
    }

    // Show only 3 most recent
    const shown = tasks.slice(0, 3);
    const remaining = tasks.length - shown.length;

    el.innerHTML = shown.map(function (t) {
        const dueBadge = t.due_date
            ? '<span class="dash-task-due' + (_isTaskOverdue(t.due_date) ? ' overdue' : '') + '">' + _formatTaskDate(t.due_date) + '</span>'
            : '';
        return '<div class="dash-task-row" data-task-id="' + t.id + '">' +
            '<button class="dash-task-check" onclick="dashToggleTask(' + t.id + ', this)" title="Valider la t\u00e2che">&#9744;</button>' +
            '<div class="dash-task-info">' +
                '<div class="dash-task-title">' + escapeHtml(t.title) + '</div>' +
                (t.comment ? '<div class="dash-task-comment muted">' + escapeHtml(t.comment.slice(0, 80)) + '</div>' : '') +
            '</div>' +
            dueBadge +
        '</div>';
    }).join('') +
    (remaining > 0
        ? '<div class="muted" style="text-align:center;padding:8px;font-size:11px;">+ ' + remaining + ' autre' + (remaining > 1 ? 's' : '') + ' \u00b7 <a href="/focus" style="color:var(--color-primary);">Voir tout dans Focus</a></div>'
        : '');
}

function _isTaskOverdue(dateStr) {
    if (!dateStr) return false;
    return dateStr < new Date().toISOString().slice(0, 10);
}

function _formatTaskDate(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return parts[2] + '/' + parts[1];
}

async function dashToggleTask(taskId, btn) {
    try {
        btn.disabled = true;
        btn.innerHTML = '\u23F3';
        const res = await fetch('/api/tasks/done', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: taskId, status: 'done' })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Erreur');
        // Animate out
        var row = btn.closest('.dash-task-row');
        if (row) {
            row.style.transition = 'opacity .3s, transform .3s';
            row.style.opacity = '0';
            row.style.transform = 'translateX(20px)';
        }
        if (typeof showToast === 'function') showToast('T\u00e2che valid\u00e9e \u2705', 'success');
        // Reload tasks after animation
        setTimeout(function () { loadDashTasks(); }, 350);
    } catch (e) {
        btn.disabled = false;
        btn.innerHTML = '\u2610';
        if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || 'Inconnue'), 'error');
    }
}
window.dashToggleTask = dashToggleTask;

// ═══ Dashboard adaptatif et Assistant virtuel ═══
async function loadAdaptiveDashboard() {
    try {
        const res = await fetch('/api/dashboard/adaptive');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Error');
        renderAdaptiveDashboard(json.data);
    } catch (e) {
        console.error('Adaptive dashboard error:', e);
        // Fallback: afficher les widgets par défaut
    }
}

function renderAdaptiveDashboard(adaptiveData) {
    // Afficher les priorités du jour
    renderPriorities(adaptiveData.priorities || []);
    
    // NE PAS masquer/afficher les widgets selon les recommandations adaptatives
    // Les préférences d'affichage utilisateur ont la priorité
    // L'adaptatif ne doit que suggérer, pas forcer l'affichage/masquage
    
    // Afficher l'insight si disponible
    if (adaptiveData.insight) {
        const prioritiesEl = document.getElementById('dashPriorities');
        if (prioritiesEl && !prioritiesEl.querySelector('.dash-priorities-insight')) {
            const insightEl = document.createElement('div');
            insightEl.className = 'dash-priorities-insight muted';
            insightEl.style.cssText = 'font-size:11px;margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border);';
            insightEl.textContent = '💡 ' + adaptiveData.insight;
            prioritiesEl.appendChild(insightEl);
        }
    }
}

function renderPriorities(priorities) {
    const el = document.getElementById('dashPriorities');
    if (!el) return;
    
    if (!priorities || !priorities.length) {
        el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Aucune priorité générée.</div>';
        return;
    }
    
    el.innerHTML = priorities.map((p, idx) => `
        <div class="dash-priority-item" style="padding:10px 12px;margin-bottom:8px;background:var(--color-surface);border-radius:6px;border-left:3px solid var(--color-primary);">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:16px;">${idx === 0 ? '🔴' : idx === 1 ? '🟡' : '🟢'}</span>
                <span style="font-size:13px;font-weight:500;">${escapeHtml(p)}</span>
            </div>
        </div>
    `).join('');
}

// ═══ Analytics Mailing (v26.6) ═══
async function renderPushAnalytics() {
    const el = document.getElementById('dashPushAnalytics');
    if (!el) return;
    
    try {
        const res = await fetch('/api/push/analytics');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error');
        
        const analytics = data;
        let html = '<div style="padding:12px;">';
        
        // Meilleurs créneaux horaires
        if (analytics.hour_stats && analytics.hour_stats.length > 0) {
            html += '<div style="margin-bottom:16px;">';
            html += '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--color-text-secondary);">⏰ Meilleures heures</div>';
            analytics.hour_stats.slice(0, 3).forEach(stat => {
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;">`;
                html += `<span>${String(stat.hour).padStart(2, '0')}h</span>`;
                html += `<span style="font-weight:600;color:var(--color-primary);">${stat.open_rate.toFixed(1)}%</span>`;
                html += `</div>`;
            });
            html += '</div>';
        }
        
        // Meilleurs jours
        if (analytics.day_stats && analytics.day_stats.length > 0) {
            html += '<div style="margin-bottom:16px;">';
            html += '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--color-text-secondary);">📅 Meilleurs jours</div>';
            analytics.day_stats.slice(0, 3).forEach(stat => {
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px;">`;
                html += `<span>${stat.day_name}</span>`;
                html += `<span style="font-weight:600;color:var(--color-primary);">${stat.open_rate.toFixed(1)}%</span>`;
                html += `</div>`;
            });
            html += '</div>';
        }
        
        // Performance variantes A/B
        if (analytics.variant_stats && analytics.variant_stats.length > 0) {
            html += '<div style="margin-bottom:16px;">';
            html += '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:var(--color-text-secondary);">🧪 Variantes A/B</div>';
            analytics.variant_stats.forEach(stat => {
                html += `<div style="padding:8px;background:var(--color-surface);border-radius:6px;margin-bottom:6px;">`;
                html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">`;
                html += `<span style="font-weight:600;">Variante ${stat.variant_id}</span>`;
                html += `<span style="font-size:11px;color:var(--color-text-secondary);">${stat.total} envois</span>`;
                html += `</div>`;
                html += `<div style="display:flex;gap:12px;font-size:11px;">`;
                html += `<span>Ouverture: <strong>${stat.open_rate.toFixed(1)}%</strong></span>`;
                html += `<span>Clics: <strong>${stat.click_rate.toFixed(1)}%</strong></span>`;
                html += `</div>`;
                html += `</div>`;
            });
            html += '</div>';
        }
        
        if (!analytics.hour_stats?.length && !analytics.day_stats?.length && !analytics.variant_stats?.length) {
            html += '<div class="muted" style="text-align:center;padding:20px;">Pas encore de données d\'analytics disponibles.</div>';
        }
        
        html += '</div>';
        el.innerHTML = html;
    } catch (e) {
        console.error('Push analytics error:', e);
        el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Erreur de chargement des analytics.</div>';
    }
}

// Note: Les fonctions de l'assistant virtuel sont maintenant dans app.js pour être disponibles sur toutes les pages

// Note: L'envoi avec Enter est géré directement dans le HTML via onkeypress

// ═══ Afficher le bouton assistant sur toutes les pages ═══
function initAssistantButton() {
    const fab = document.getElementById('dashAssistantFab');
    if (fab) {
        // Afficher le bouton si l'utilisateur est connecté (pas sur login)
        const isLoginPage = window.location.pathname === '/login' || document.body.getAttribute('data-page') === 'login';
        if (!isLoginPage) {
            fab.style.display = 'flex';
        }
    }
}

// ═══ Fonction de réinitialisation des widgets (pour debug/correction) ═══
function resetDashboardWidgets() {
    var container = document.getElementById('dashWidgetsContainer');
    if (!container) return;
    
    // Réafficher tous les widgets
    container.querySelectorAll('.dash-widget').forEach(function (w) {
        w.style.display = '';
        w.removeAttribute('data-display-pref');
    });
    
    // Réappliquer les préférences
    if (typeof window.applyDashboardDisplayPrefs === 'function') {
        window.applyDashboardDisplayPrefs();
    }
    
    // Réorganiser selon l'ordre par défaut
    try {
        localStorage.removeItem(DASH_WIDGET_ORDER_KEY);
    } catch (e) {}
    applyDashboardWidgetOrder();
    
    // Réinitialiser le drag & drop
    initDashboardWidgetDragDrop();
    
    if (typeof showToast === 'function') {
        showToast('✅ Widgets réinitialisés', 'success');
    }
}
window.resetDashboardWidgets = resetDashboardWidgets;

// ═══ Boot ═══
document.addEventListener('DOMContentLoaded', async () => {
    // Initialiser le bouton assistant
    initAssistantButton();
    
    // Appliquer les colonnes et l'ordre AVANT le chargement des données
    applyDashboardColumns();
    applyDashboardWidgetOrder();
    
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('dashboard');
    } catch(e) {}

    // Charger les données et appliquer les préférences après
    await Promise.all([loadDashboard(), loadDashTasks(), loadAdaptiveDashboard()]);
    
    // Appliquer les préférences d'affichage une dernière fois après tout le chargement
    // et initialiser le drag & drop une seule fois à la fin
    setTimeout(function() {
        if (typeof window.applyDashboardDisplayPrefs === 'function') {
            window.applyDashboardDisplayPrefs();
        }
        // Réorganiser l'ordre après application des préférences
        applyDashboardWidgetOrder();
        // Initialiser le drag & drop UNE SEULE FOIS à la fin (après que tout soit stable)
        initDashboardWidgetDragDrop();
    }, 350);
});

// Exposer la fonction globalement
window.sendAssistantMessage = sendAssistantMessage;

// ═══════════════════════════════════════════════════════════════
// Manual KPI Entry (v16.5)
// ═══════════════════════════════════════════════════════════════
function openManualKpiModal() {
    const modal = document.getElementById('manualKpiModal');
    if (!modal) return;
    // Set default date to today
    const dateInput = document.getElementById('manualKpiDate');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
    const countInput = document.getElementById('manualKpiCount');
    if (countInput) countInput.value = '1';
    const descInput = document.getElementById('manualKpiDesc');
    if (descInput) descInput.value = '';
    modal.style.display = 'flex';
}

function closeManualKpiModal() {
    const modal = document.getElementById('manualKpiModal');
    if (modal) modal.style.display = 'none';
}

async function saveManualKpi() {
    const type = document.getElementById('manualKpiType')?.value || 'note';
    const date = document.getElementById('manualKpiDate')?.value || new Date().toISOString().split('T')[0];
    const count = parseInt(document.getElementById('manualKpiCount')?.value || '1', 10);
    const desc = document.getElementById('manualKpiDesc')?.value || '';

    try {
        const res = await fetch('/api/manual-kpi', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, date, count, description: desc })
        });
        const data = await res.json();
        if (data.ok) {
            showToast('✅ KPI enregistré avec succès', 'success');
            closeManualKpiModal();
            // Reload dashboard
            await loadDashboard();
        } else {
            showToast('❌ Erreur: ' + (data.error || 'Inconnu'), 'error');
        }
    } catch (e) {
        showToast('❌ Erreur réseau', 'error');
    }
}
