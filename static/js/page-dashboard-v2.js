// Dashboard V2 — Bento Grid Redesign
// Scoped to [data-page="dashboard_v2"]

// ─── Constants ───
var DV2_STATUS_ORDER = ["Pas d'actions", "Appele", "A rappeler", "Messagerie", "Rendez-vous", "Prospecte", "Pas interesse"];
var DV2_STATUS_COLORS = {
  "Pas d'actions": '#64748b', 'Appele': '#f59e0b', 'Messagerie': '#3b82f6',
  'A rappeler': '#ef4444', 'Rendez-vous': '#22c55e', 'Pas interesse': '#94a3b8',
  'Prospecte': '#8b5cf6'
};
var DV2_KPI_COLORS = {
  contacts: '#f59e0b', notes: '#3b82f6', push: '#8b5cf6', rdv: '#22c55e'
};
var _dv2_weekChart = null;
var _dv2_mainData = null;
var _dv2_chartInstances = {};
var _dv2_weekOffset = 0; // 0 = current week, -1 = last week, etc.

// ─── Helpers ───
function dv2_esc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s);
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function dv2_dayName(iso) {
  var days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  var d = new Date(iso + 'T00:00:00');
  return days[d.getDay()];
}

function dv2_dayNameFull(iso) {
  var days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  var d = new Date(iso + 'T00:00:00');
  return days[d.getDay()];
}

function dv2_trendBadge(current, previous) {
  if (!previous || previous === 0) return '';
  var diff = current - previous;
  var pct = Math.round((diff / previous) * 100);
  if (diff > 0) return '<span class="dv2-trend-badge up">+' + pct + '%</span>';
  if (diff < 0) return '<span class="dv2-trend-badge down">' + pct + '%</span>';
  return '<span class="dv2-trend-badge flat">=</span>';
}

function dv2_relativeDate(isoDate) {
  if (!isoDate) return { text: '', cls: 'later' };
  var today = new Date(); today.setHours(0,0,0,0);
  var target = new Date(isoDate + 'T00:00:00');
  var diff = Math.round((target - today) / 86400000);
  if (diff === 0) return { text: "Aujourd'hui", cls: 'today' };
  if (diff === 1) return { text: 'Demain', cls: 'tomorrow' };
  if (diff > 1 && diff <= 7) return { text: dv2_dayNameFull(isoDate), cls: 'later' };
  var parts = isoDate.split('-');
  return { text: parts[2] + '/' + parts[1], cls: 'later' };
}

function dv2_sparklineSVG(values, color, w, h) {
  w = w || 60; h = h || 22;
  if (!values || !values.length) return '';
  var max = Math.max(1, Math.max.apply(null, values));
  var pts = values.map(function(v, i) {
    var x = values.length > 1 ? (i / (values.length - 1)) * w : w / 2;
    var y = h - ((v / max) * (h - 4)) - 2;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  var lastPt = pts[pts.length - 1].split(',');
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<polyline class="dv2-sparkline-line" points="' + pts.join(' ') + '" stroke="' + color + '"/>' +
    '<circle class="dv2-sparkline-dot" cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" fill="' + color + '"/>' +
    '</svg>';
}

function dv2_emojiForRatio(r) {
  var x = Math.max(0, Math.min(1, Number(r) || 0));
  if (x >= 1)   return window.icon ? window.icon('trophy',    {size:16}) : '';
  if (x >= 0.8) return window.icon ? window.icon('zap',       {size:16}) : '';
  if (x >= 0.6) return window.icon ? window.icon('star',      {size:16}) : '';
  if (x >= 0.4) return window.icon ? window.icon('check',     {size:16}) : '';
  if (x >= 0.2) return window.icon ? window.icon('target',    {size:16}) : '';
  return window.icon ? window.icon('alertTri', {size:16}) : '';
}

// ─── Week navigation helpers ───

function dv2_weekMonday(offset) {
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  var day = d.getDay();
  var diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + offset * 7);
  return d;
}

function dv2_isoWeek(offset) {
  var monday = dv2_weekMonday(offset);
  var d = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
  var dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0');
}

function dv2_weekLabel(offset) {
  var monday = dv2_weekMonday(offset);
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  var fmt = { day: 'numeric', month: 'short' };
  return monday.toLocaleDateString('fr-FR', fmt) + ' \u2013 ' + sunday.toLocaleDateString('fr-FR', fmt);
}

function dv2_updateWeekNav() {
  var prevBtn = document.getElementById('dv2WeekPrev');
  var nextBtn = document.getElementById('dv2WeekNext');
  var todayBtn = document.getElementById('dv2WeekToday');
  var label = document.getElementById('dv2WeekLabel');
  if (prevBtn) prevBtn.disabled = (_dv2_weekOffset <= -52);
  if (nextBtn) nextBtn.disabled = (_dv2_weekOffset >= 0);
  if (todayBtn) todayBtn.style.display = _dv2_weekOffset < 0 ? 'inline-flex' : 'none';
  if (label) label.textContent = _dv2_weekOffset === 0 ? 'Cette semaine' : dv2_weekLabel(_dv2_weekOffset);
}

async function dv2_reloadPerformance(weekISO) {
  var chipsEl = document.getElementById('dv2KpiChips');
  if (chipsEl) chipsEl.innerHTML = '<div class="dv2-skel-chip"></div><div class="dv2-skel-chip"></div><div class="dv2-skel-chip"></div><div class="dv2-skel-chip"></div>';
  var chartEl = document.getElementById('dv2WeekChart');
  if (chartEl) chartEl.innerHTML = '<div class="dv2-skel-chart"></div>';
  try {
    var data = await dv2_fetchMain(weekISO);
    _dv2_mainData = data;
    dv2_renderPerformance(data);
    dv2_renderActivity(data.feed || { notes: [], push: [], rdv: [] }, (data.week && data.week.days) || []);
  } catch(e) {
    console.warn('[DashV2] week reload error:', e.message);
    if (typeof showToast === 'function') showToast('Erreur de chargement', 'error');
  }
}

window.dv2_navWeek = function(delta) {
  if (delta === 0) {
    _dv2_weekOffset = 0;
  } else {
    var next = _dv2_weekOffset + delta;
    if (next > 0 || next < -52) return;
    _dv2_weekOffset = next;
  }
  dv2_updateWeekNav();
  var weekISO = _dv2_weekOffset < 0 ? dv2_isoWeek(_dv2_weekOffset) : null;
  dv2_reloadPerformance(weekISO);
};

// ─── Fetchers ───
async function dv2_fetchMain(weekISO) {
  var url = '/api/dashboard';
  if (weekISO) url += '?week=' + encodeURIComponent(weekISO);
  var res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error');
  return json.data;
}

async function dv2_fetchTasks() {
  var res = await fetch('/api/tasks?status=pending');
  var json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error');
  return json.tasks || [];
}

async function dv2_fetchPriorities() {
  var controller = new AbortController();
  var tid = setTimeout(function() { controller.abort(); }, 8000);
  try {
    var res = await fetch('/api/dashboard/adaptive', { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error');
    return json.data;
  } catch(e) {
    clearTimeout(tid);
    throw e;
  }
}

// ─── Renderers ───

function dv2_renderHero(data) {
  var h = new Date().getHours();
  var greeting = h < 12 ? 'Bonjour' : h < 18 ? 'Bon apres-midi' : 'Bonsoir';
  var userName = (window.AppAuth && AppAuth.user) ? (AppAuth.user.display_name || AppAuth.user.username || '') : '';
  var el = document.getElementById('dv2Greeting');
  if (el) el.textContent = greeting + (userName ? ', ' + userName : '') + ' !';

  var dateEl = document.getElementById('dv2Date');
  if (dateEl) {
    var now = new Date();
    var opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('fr-FR', opts);
  }
}

function dv2_renderPerformance(data) {
  var t = data.today;
  var w = data.week;
  var pw = data.prev_week;
  var days = (w && w.days) || [];
  var isPast = !!data.is_past_week;

  // Contacts = appels tracés (call_logs), fallback sur max(relances, notes)
  var todayContacts = t.calls > 0 ? t.calls : Math.max(t.relances || 0, t.notes || 0);
  var weekContacts = w.calls > 0 ? w.calls : Math.max(w.relances || 0, w.notes || 0);
  var prevContacts = Math.max(pw.relances || 0, pw.notes || 0);

  // Badge
  var totalWeek = weekContacts + (w.push_total || 0);
  var badge = document.getElementById('dv2PerfBadge');
  if (badge) badge.textContent = isPast ? dv2_weekLabel(_dv2_weekOffset) : totalWeek + ' actions cette semaine';

  // KPI Chips — pour une semaine passée, affiche le total semaine comme valeur principale
  var chips = [
    { key: 'contacts', icon: '\uD83D\uDCDE', label: 'Contacts',
      value: isPast ? weekContacts : todayContacts,
      weekVal: weekContacts, prevVal: prevContacts, color: DV2_KPI_COLORS.contacts,
      sub: isPast ? weekContacts + ' cette semaine' : (t.calls || 0) + ' appels trac\u00e9s' },
    { key: 'notes', icon: '\uD83D\uDCDD', label: 'Notes',
      value: isPast ? w.notes : t.notes,
      weekVal: w.notes, prevVal: pw.notes, color: DV2_KPI_COLORS.notes,
      sub: w.notes + ' cette semaine' },
    { key: 'push', icon: '\uD83D\uDCE4', label: 'Push',
      value: isPast ? w.push_total : t.push_total,
      weekVal: w.push_total, prevVal: pw.push_total, color: DV2_KPI_COLORS.push,
      sub: (w.push_email || 0) + ' emails + ' + (w.push_linkedin || 0) + ' linkedin' },
    { key: 'rdv', icon: '\uD83E\uDD1D', label: 'RDV',
      value: isPast ? (w.rdv_total || 0) : data.pipeline.rdv,
      weekVal: isPast ? (w.rdv_total || 0) : data.pipeline.rdv, prevVal: 0,
      color: DV2_KPI_COLORS.rdv,
      sub: isPast ? 'RDV pris cette semaine' : 'sur ' + (data.pipeline.total || 0) + ' prospects' }
  ];

  // Overdue chip (5th, alert style) — uniquement pour la semaine courante
  if (!isPast && data.pipeline.overdue > 0) {
    chips.push({
      key: 'overdue', icon: window.icon ? window.icon('alertTri', {size:14}) : '', label: 'En retard', value: data.pipeline.overdue,
      weekVal: data.pipeline.overdue, prevVal: 0, color: '#ef4444',
      sub: (data.pipeline.due_today || 0) + ' a faire aujourd\'hui',
      alert: true
    });
  }

  var chipsEl = document.getElementById('dv2KpiChips');
  if (chipsEl) {
    chipsEl.innerHTML = chips.map(function(c) {
      var sparkVals = days.map(function(d) {
        if (c.key === 'contacts') return d.calls > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0);
        if (c.key === 'notes') return d.notes || 0;
        if (c.key === 'push') return d.push || 0;
        return 0;
      });
      var sparkHtml = c.key !== 'overdue' ? '<div class="dv2-sparkline">' + dv2_sparklineSVG(sparkVals, c.color, 60, 22) + '</div>' : '';
      var trend = dv2_trendBadge(c.weekVal, c.prevVal);

      return '<div class="dv2-kpi-chip' + (c.alert ? ' dv2-kpi-chip--alert' : '') + '" style="--dv2-chip-color:' + c.color + '">' +
        '<div class="dv2-kpi-chip-info">' +
          '<div class="dv2-kpi-chip-value">' + c.value + '</div>' +
          '<div class="dv2-kpi-chip-label">' + c.icon + ' ' + c.label + ' ' + trend + '</div>' +
          '<div class="dv2-kpi-chip-sub">' + (c.sub || '') + '</div>' +
        '</div>' +
        sparkHtml +
      '</div>';
    }).join('');
  }

  // Week Chart (Chart.js)
  dv2_renderWeekChart(days, w);
}

function dv2_renderWeekChart(days, week) {
  var container = document.getElementById('dv2WeekChart');
  if (!container || !days.length) {
    if (container) container.innerHTML = '<div class="dv2-empty">Aucune donnee cette semaine</div>';
    return;
  }

  container.innerHTML = '<canvas id="dv2WeekCanvas"></canvas>';
  var canvas = document.getElementById('dv2WeekCanvas');
  if (!canvas || typeof Chart === 'undefined') return;

  var ctx = canvas.getContext('2d');
  var labels = days.map(function(d) { return dv2_dayName(d.date); });
  var isToday = days.map(function(d) { return d.date === week.end; });

  if (_dv2_weekChart) { _dv2_weekChart.destroy(); _dv2_weekChart = null; }

  _dv2_weekChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Contacts',
          data: days.map(function(d) { return d.calls > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0); }),
          backgroundColor: 'rgba(245, 158, 11, 0.7)',
          borderRadius: 4,
          borderSkipped: false,
          stack: 'stack0',
        },
        {
          label: 'Push',
          data: days.map(function(d) { return d.push || 0; }),
          backgroundColor: 'rgba(139, 92, 246, 0.7)',
          borderRadius: 4,
          borderSkipped: false,
          stack: 'stack0',
        },
        {
          label: 'Total',
          data: days.map(function(d) { return (d.calls > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0)) + (d.push || 0); }),
          type: 'line',
          borderColor: 'rgba(var(--color-primary-rgb, 243,111,33), 0.8)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#f36f21',
          fill: false,
          tension: 0.3,
          order: 0,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            borderRadius: 4,
            useBorderRadius: true,
            font: { size: 10, weight: '600' },
            padding: 12,
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim() || '#6b7280'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.8)',
          titleFont: { size: 11 },
          bodyFont: { size: 11 },
          padding: 8,
          cornerRadius: 8,
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 3,
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: {
            font: { size: 10, weight: '600' },
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim() || '#6b7280'
          }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: {
            color: 'rgba(100,116,139,0.08)',
          },
          ticks: {
            font: { size: 10 },
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim() || '#6b7280',
            stepSize: 1
          }
        }
      },
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      }
    }
  });
}

// ─── Action Center (Tabs: Overdue / Tasks / RDV) ───

function dv2_renderActions(overdueList, tasks, rdvList) {
  // Update tab counts
  var tabOv = document.getElementById('dv2TabOverdue');
  var tabTk = document.getElementById('dv2TabTasks');
  var tabRv = document.getElementById('dv2TabRdv');
  if (tabOv) tabOv.textContent = (overdueList || []).length;
  if (tabTk) tabTk.textContent = (tasks || []).length;
  if (tabRv) tabRv.textContent = (rdvList || []).length;

  // Render overdue pane
  var ovEl = document.getElementById('dv2PaneOverdue');
  if (ovEl) {
    if (!overdueList || !overdueList.length) {
      ovEl.innerHTML = '<div class="dv2-empty">Aucune relance en retard !</div>';
    } else {
      ovEl.innerHTML = overdueList.slice(0, 5).map(function(p) {
        var daysLate = Math.floor((Date.now() - new Date(p.nextFollowUp + 'T00:00:00').getTime()) / 86400000);
        var urg = daysLate >= 7 ? 'critical' : (daysLate >= 3 ? 'warning' : 'mild');
        return '<div class="dv2-action-row ' + urg + '">' +
          '<div class="dv2-action-name">' + dv2_esc(p.name) + '</div>' +
          '<span class="dv2-action-days">-' + daysLate + 'j</span>' +
          '<a href="/?open=' + p.id + '" class="dv2-action-btn">Ouvrir</a>' +
        '</div>';
      }).join('') +
      (overdueList.length > 5 ? '<div class="dv2-more-link"><a href="/focus">+ ' + (overdueList.length - 5) + ' autres &rarr; Focus</a></div>' : '');
    }
  }

  // Render tasks pane
  var tkEl = document.getElementById('dv2PaneTasks');
  if (tkEl) {
    if (!tasks || !tasks.length) {
      tkEl.innerHTML = '<div class="dv2-empty">Aucune tache en cours.<br><a href="/focus">Creer une tache</a></div>';
    } else {
      tkEl.innerHTML = tasks.slice(0, 5).map(function(t) {
        var dueCls = '';
        var dueText = '';
        if (t.due_date) {
          var parts = t.due_date.split('-');
          dueText = parts[2] + '/' + parts[1];
          if (t.due_date < new Date().toISOString().slice(0, 10)) dueCls = ' overdue';
        }
        return '<div class="dv2-action-row" data-task-id="' + t.id + '">' +
          '<button class="dv2-task-check" onclick="dv2_toggleTask(' + t.id + ', this)" title="Valider">' + (window.icon ? window.icon('check', {size:13}) : '') + '</button>' +
          '<div class="dv2-task-info">' +
            '<div class="dv2-task-title">' + dv2_esc(t.title) + '</div>' +
            (t.comment ? '<div class="dv2-task-comment">' + dv2_esc(t.comment.slice(0, 60)) + '</div>' : '') +
          '</div>' +
          (dueText ? '<span class="dv2-task-due' + dueCls + '">' + dueText + '</span>' : '') +
        '</div>';
      }).join('') +
      (tasks.length > 5 ? '<div class="dv2-more-link"><a href="/focus">+ ' + (tasks.length - 5) + ' autres &rarr;</a></div>' : '');
    }
  }

  // Render RDV pane
  var rvEl = document.getElementById('dv2PaneRdv');
  if (rvEl) {
    if (!rdvList || !rdvList.length) {
      rvEl.innerHTML = '<div class="dv2-empty">Aucun RDV planifie.</div>';
    } else {
      rvEl.innerHTML = rdvList.slice(0, 5).map(function(p) {
        var dateStr = (p.rdvDate || '').slice(0, 10);
        var rel = dv2_relativeDate(dateStr);
        var timeStr = (p.rdvDate || '').slice(11, 16);
        var isTd = rel.cls === 'today';
        return '<div class="dv2-action-row' + (isTd ? ' rdv-today' : '') + '">' +
          '<div class="dv2-action-name">' + dv2_esc(p.name) + '</div>' +
          (timeStr ? '<span class="dv2-action-meta">' + timeStr + '</span>' : '') +
          '<span class="dv2-relative-date ' + rel.cls + '">' + rel.text + '</span>' +
          '<a href="/?open=' + p.id + '" class="dv2-action-btn">Ouvrir</a>' +
        '</div>';
      }).join('');
    }
  }
}

function dv2_switchTab(tabName) {
  var tabs = document.querySelectorAll('.dv2-tab');
  var panes = document.querySelectorAll('.dv2-tab-pane');
  var indicator = document.getElementById('dv2TabIndicator');

  var idx = 0;
  tabs.forEach(function(t, i) {
    var isActive = t.getAttribute('data-tab') === tabName;
    t.classList.toggle('active', isActive);
    if (isActive) idx = i;
  });
  panes.forEach(function(p) {
    p.classList.toggle('active', p.getAttribute('data-pane') === tabName);
  });
  if (indicator) indicator.setAttribute('data-pos', String(idx));
  if (typeof window.haptic === 'function') window.haptic(10);
}
window.dv2_switchTab = dv2_switchTab;

async function dv2_toggleTask(taskId, btn) {
  try {
    btn.disabled = true;
    btn.innerHTML = '&#x23F3;';
    var res = await fetch('/api/tasks/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskId, status: 'done' })
    });
    var json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Erreur');
    var row = btn.closest('.dv2-action-row');
    if (row) {
      row.style.transition = 'opacity .3s, transform .3s';
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
    }
    if (typeof showToast === 'function') showToast('Tache validee', 'success');
    setTimeout(async function() {
      try {
        var tasks = await dv2_fetchTasks();
        var tkEl = document.getElementById('dv2TabTasks');
        if (tkEl) tkEl.textContent = tasks.length;
        dv2_renderActions(_dv2_mainData ? _dv2_mainData.overdue_list : [], tasks, _dv2_mainData ? _dv2_mainData.upcoming_rdv : []);
        dv2_switchTab('tasks');
      } catch(e) {}
    }, 350);
  } catch(e) {
    btn.disabled = false;
    btn.innerHTML = window.icon ? window.icon('check', {size:13}) : '';
    if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || 'Inconnue'), 'error');
  }
}
window.dv2_toggleTask = dv2_toggleTask;

// ─── Pipeline Funnel ───

function dv2_renderPipeline(pipeline) {
  var funnel = document.getElementById('dv2Funnel');
  var legend = document.getElementById('dv2PipelineLegend');
  var stats = document.getElementById('dv2PipelineStats');

  if (!pipeline || !pipeline.total) {
    if (funnel) funnel.innerHTML = '<div class="dv2-empty">Aucun prospect.</div>';
    return;
  }

  var total = pipeline.total || 1;
  var convRate = Math.round((pipeline.rdv / total) * 100);

  if (stats) {
    stats.innerHTML = '<span>Total: <strong>' + total + '</strong></span>' +
      '<span>Conversion RDV: <strong>' + convRate + '%</strong></span>' +
      (pipeline.overdue > 0 ? '<span style="color:#ef4444;">En retard: <strong>' + pipeline.overdue + '</strong></span>' : '');
  }

  var statusOrder = ["Pas d'actions", "Appele", "A rappeler", "Messagerie", "Rendez-vous", "Prospecte", "Pas interesse"];
  // Map accented keys from API to our unaccented constants
  var statuts = pipeline.statuts || {};

  if (funnel) {
    funnel.innerHTML = statusOrder.map(function(s) {
      // Try exact match first, then try accented variants
      var n = statuts[s] || 0;
      if (!n) {
        // Try common accented variants
        var variants = {
          'Appele': ['Appelé', 'Appele'],
          'A rappeler': ['À rappeler', 'A rappeler'],
          'Prospecte': ['Prospecté', 'Prospecte'],
          'Pas interesse': ['Pas intéressé', 'Pas interesse']
        };
        if (variants[s]) {
          for (var vi = 0; vi < variants[s].length; vi++) {
            if (statuts[variants[s][vi]]) { n = statuts[variants[s][vi]]; break; }
          }
        }
      }
      var pct = (n / total) * 100;
      if (pct < 1 && n > 0) pct = 1;
      if (n === 0) return '';
      var color = DV2_STATUS_COLORS[s] || '#64748b';
      return '<div class="dv2-funnel-seg" style="width:' + pct + '%;background:' + color + '">' +
        '<div class="dv2-tooltip">' + s + ': ' + n + ' (' + Math.round(pct) + '%)</div>' +
      '</div>';
    }).join('');
  }

  if (legend) {
    legend.innerHTML = statusOrder.map(function(s) {
      var n = statuts[s] || 0;
      if (!n) {
        var variants = {
          'Appele': ['Appelé'], 'A rappeler': ['À rappeler'],
          'Prospecte': ['Prospecté'], 'Pas interesse': ['Pas intéressé']
        };
        if (variants[s]) {
          for (var vi = 0; vi < variants[s].length; vi++) {
            if (statuts[variants[s][vi]]) { n = statuts[variants[s][vi]]; break; }
          }
        }
      }
      if (!n) return '';
      var color = DV2_STATUS_COLORS[s] || '#64748b';
      return '<div class="dv2-pipeline-legend-item">' +
        '<span class="dv2-pipeline-dot" style="background:' + color + '"></span>' +
        '<span>' + s + '</span> <strong>' + n + '</strong>' +
      '</div>';
    }).join('');
  }
}

// ─── Activity Stream (Heatmap + Feed) ───

function dv2_renderActivity(feed, weekDays) {
  // Update card title to reflect period
  var actTitle = document.querySelector('#dv2Activity .dv2-card-title');
  if (actTitle) actTitle.textContent = _dv2_weekOffset < 0 ? 'Activit\u00e9 de la semaine' : 'Activit\u00e9 du jour';
  // Mini-barres verticales au lieu de blocs heatmap
  var heatEl = document.getElementById('dv2Heatmap');
  if (heatEl && weekDays && weekDays.length) {
    var maxAct = Math.max(1, Math.max.apply(null, weekDays.map(function(d) {
      var c = d.calls > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0);
      return c + (d.push || 0) + (d.rdv || 0);
    })));

    // Resume semaine
    var weekTotalContacts = 0, weekTotalPush = 0, weekTotalRdv = 0;
    weekDays.forEach(function(d) {
      weekTotalContacts += d.calls > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0);
      weekTotalPush += (d.push || 0);
      weekTotalRdv += (d.rdv || 0);
    });
    var weekTotal = weekTotalContacts + weekTotalPush + weekTotalRdv;

    heatEl.innerHTML =
      '<div class="dv2-activity-bars">' +
        weekDays.map(function(d) {
          var contacts = d.calls > 0 ? d.calls : Math.max(d.relances || 0, d.notes || 0);
          var push = d.push || 0;
          var rdv = d.rdv || 0;
          var total = contacts + push + rdv;
          var pctContacts = maxAct > 0 ? ((contacts / maxAct) * 100) : 0;
          var pctPush = maxAct > 0 ? ((push / maxAct) * 100) : 0;
          var pctRdv = maxAct > 0 ? ((rdv / maxAct) * 100) : 0;
          var isToday = d.date === weekDays[weekDays.length - 1].date;
          var tooltip = dv2_dayName(d.date) + ': ' + contacts + ' contacts, ' + push + ' push' + (rdv ? ', ' + rdv + ' RDV' : '');
          return '<div class="dv2-bar-col' + (isToday ? ' today' : '') + '">' +
            '<div class="dv2-bar-stack" title="' + tooltip + '">' +
              '<div class="dv2-bar-seg contacts" style="height:' + pctContacts.toFixed(0) + '%"></div>' +
              '<div class="dv2-bar-seg push" style="height:' + pctPush.toFixed(0) + '%"></div>' +
              (rdv ? '<div class="dv2-bar-seg rdv" style="height:' + pctRdv.toFixed(0) + '%"></div>' : '') +
            '</div>' +
            '<span class="dv2-bar-label">' + dv2_dayName(d.date) + '</span>' +
            '<span class="dv2-bar-total">' + total + '</span>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<div class="dv2-activity-summary">' +
        '<strong>' + weekTotal + '</strong> actions cette semaine : ' +
        '<span style="color:#f59e0b">' + weekTotalContacts + ' contacts</span>' +
        ' + <span style="color:#8b5cf6">' + weekTotalPush + ' push</span>' +
        (weekTotalRdv ? ' + <span style="color:#22c55e">' + weekTotalRdv + ' RDV</span>' : '') +
      '</div>' +
      '<div class="dv2-activity-legend">' +
        '<span><span class="dv2-legend-dot" style="background:#f59e0b"></span> Contacts</span>' +
        '<span><span class="dv2-legend-dot" style="background:#8b5cf6"></span> Push</span>' +
        '<span><span class="dv2-legend-dot" style="background:#22c55e"></span> RDV</span>' +
      '</div>';
  }

  // Feed enrichi
  var feedEl = document.getElementById('dv2Feed');
  if (!feedEl) return;

  var items = [];
  (feed.notes || []).forEach(function(n) {
    items.push({
      time: (n.date || '').slice(11, 16) || '--',
      icon: '\uD83D\uDCDD',
      cls: 'note',
      text: '<strong>' + dv2_esc(n.prospect_name) + '</strong>',
      detail: dv2_esc((n.content || '').slice(0, 100)),
      sort: n.date || '',
      prospectId: n.prospect_id
    });
  });
  (feed.push || []).forEach(function(p) {
    var ch = p.channel === 'email' ? (window.icon ? window.icon('mail', {size:14}) : '') : (p.channel === 'linkedin' ? (window.icon ? window.icon('linkedin', {size:14}) : '') : (window.icon ? window.icon('send', {size:14}) : ''));
    var label = p.channel === 'email' ? 'Email' : (p.channel === 'linkedin' ? 'LinkedIn' : 'Push');
    items.push({
      time: (p.createdAt || '').slice(11, 16) || '--',
      icon: ch,
      cls: 'push',
      text: '<span class="dv2-feed-type">' + label + '</span> ' + dv2_esc(p.subject || p.to_email || ''),
      detail: '',
      sort: p.createdAt || '',
      prospectId: p.prospect_id
    });
  });
  (feed.rdv || []).forEach(function(r) {
    var rdvFmt = '';
    if (r.rdvDate) {
      var rdvTrimmed = r.rdvDate.trim();
      var rdvDatePart = rdvTrimmed.split('T')[0].split(' ')[0];
      var rdvTimePart = rdvTrimmed.indexOf('T') > -1 ? rdvTrimmed.split('T')[1] : (rdvTrimmed.indexOf(' ') > -1 ? rdvTrimmed.split(' ')[1] : '');
      var dm = rdvDatePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dm) rdvFmt = dm[3] + '/' + dm[2] + (rdvTimePart ? ' ' + rdvTimePart.slice(0, 5) : '');
    }
    items.push({
      time: (r.createdAt || '').slice(11, 16) || '--',
      icon: '\uD83D\uDCC5',
      cls: 'rdv',
      text: '<span class="dv2-feed-type" style="color:#22c55e">RDV</span> <strong>' + dv2_esc(r.prospect_name) + '</strong>' +
            (r.company_name ? ' <span style="opacity:0.7">— ' + dv2_esc(r.company_name) + '</span>' : ''),
      detail: rdvFmt ? 'Le ' + rdvFmt : '',
      sort: r.createdAt || '',
      prospectId: r.prospect_id
    });
  });

  items.sort(function(a, b) { return b.sort.localeCompare(a.sort); });

  if (!items.length) {
    var emptyMsg = _dv2_weekOffset < 0 ? 'Aucune activit\u00e9 cette semaine-l\u00e0' : 'Aucune activit\u00e9 aujourd\'hui';
    feedEl.innerHTML = '<div class="dv2-empty-activity">' +
      '<div class="dv2-empty-activity-icon">\uD83D\uDE80</div>' +
      '<div class="dv2-empty-activity-text">' + emptyMsg + '</div>' +
      (_dv2_weekOffset === 0 ? '<div class="dv2-empty-activity-cta"><a href="/" class="dv2-action-btn">Prospects</a> <a href="/focus" class="dv2-action-btn">Focus</a></div>' : '') +
    '</div>';
    return;
  }

  feedEl.innerHTML = items.slice(0, 8).map(function(it) {
    return '<div class="dv2-feed-item ' + it.cls + '">' +
      '<span class="dv2-feed-time">' + it.time + '</span>' +
      '<span class="dv2-feed-icon">' + it.icon + '</span>' +
      '<div class="dv2-feed-text">' + it.text +
        (it.detail ? '<div class="dv2-feed-detail">' + it.detail + '</div>' : '') +
      '</div>' +
      (it.prospectId ? '<a href="/?open=' + it.prospectId + '" class="dv2-feed-link" title="Ouvrir">\u2192</a>' : '') +
    '</div>';
  }).join('') +
  (items.length > 8 ? '<div class="dv2-more-link"><a href="/">Voir toute l\'activite \u2192</a></div>' : '');
}

// ─── Goals Ring ───

function dv2_fireConfetti(containerEl, intensity) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  containerEl.classList.remove('active');
  void containerEl.offsetWidth;
  containerEl.classList.add('active');
  var colors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#22c55e', '#ef4444', '#eab308'];
  var n = Math.max(10, Math.min(60, intensity || 24));
  for (var i = 0; i < n; i++) {
    var piece = document.createElement('div');
    piece.className = 'dv2-confetti-piece';
    piece.style.left = (Math.random() * 100) + '%';
    piece.style.animationDelay = (Math.random() * 0.35) + 's';
    piece.style.animationDuration = (0.9 + Math.random() * 0.7) + 's';
    piece.style.width = (6 + Math.floor(Math.random() * 6)) + 'px';
    piece.style.height = (6 + Math.floor(Math.random() * 6)) + 'px';
    piece.style.setProperty('--confetti-color', colors[i % colors.length]);
    piece.style.background = colors[i % colors.length];
    containerEl.appendChild(piece);
  }
  setTimeout(function() {
    try { containerEl.classList.remove('active'); containerEl.innerHTML = ''; } catch(e) {}
  }, 1800);
}

function dv2_renderGoals(goals, week, today) {
  var ringsEl = document.getElementById('dv2GoalsRings');
  var itemsEl = document.getElementById('dv2GoalsItems');
  var confetti = document.getElementById('dv2Confetti');

  if (!goals || !goals.daily || !goals.weekly) {
    if (ringsEl) ringsEl.innerHTML = '<div class="dv2-empty">Objectifs indisponibles.</div>';
    return;
  }

  var daily = goals.daily;
  var weekly = goals.weekly;
  var dayRatio = daily.xp_total ? (daily.xp_current / daily.xp_total) : 0;
  var wkRatio = weekly.xp_total ? (weekly.xp_current / weekly.xp_total) : 0;

  // Check level-up
  var wkXp = Number(weekly.xp_current || 0);
  var wkLevel = Math.floor(wkXp / 100) + 1;
  var weekStart = (week && week.start) ? week.start : '';
  var prevLevelKey = 'dv2_goals_level_' + weekStart;
  var prevLevel = parseInt(localStorage.getItem(prevLevelKey) || '0', 10) || 0;
  if (wkLevel > prevLevel) {
    localStorage.setItem(prevLevelKey, String(wkLevel));
    dv2_fireConfetti(confetti, 34);
    if (typeof showToast === 'function') showToast('Level up ! Niveau ' + wkLevel, 'success');
  }

  // SVG rings
  var r1 = 52, r2 = 40;
  var c1 = 2 * Math.PI * r1;
  var c2 = 2 * Math.PI * r2;
  var off1 = c1 * (1 - Math.min(1, wkRatio));
  var off2 = c2 * (1 - Math.min(1, dayRatio));

  if (ringsEl) {
    ringsEl.innerHTML =
      '<div class="dv2-rings-svg-wrap">' +
        '<svg viewBox="0 0 120 120">' +
          '<circle class="dv2-ring-track" cx="60" cy="60" r="' + r1 + '"/>' +
          '<circle class="dv2-ring-fill" cx="60" cy="60" r="' + r1 + '" stroke="' + DV2_KPI_COLORS.relances + '" ' +
            'stroke-dasharray="' + c1.toFixed(1) + '" ' +
            'style="--dv2-circumference:' + c1.toFixed(1) + ';--dv2-offset:' + off1.toFixed(1) + ';stroke-dashoffset:' + off1.toFixed(1) + '"/>' +
          '<circle class="dv2-ring-track" cx="60" cy="60" r="' + r2 + '"/>' +
          '<circle class="dv2-ring-fill" cx="60" cy="60" r="' + r2 + '" stroke="' + DV2_KPI_COLORS.notes + '" ' +
            'stroke-dasharray="' + c2.toFixed(1) + '" ' +
            'style="--dv2-circumference:' + c2.toFixed(1) + ';--dv2-offset:' + off2.toFixed(1) + ';stroke-dashoffset:' + off2.toFixed(1) + '"/>' +
        '</svg>' +
        '<div class="dv2-rings-center">' +
          '<div class="dv2-rings-xp">' + Math.round(wkXp) + '</div>' +
          '<div class="dv2-rings-level">Lv ' + wkLevel + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dv2-rings-legend">' +
        '<div class="dv2-ring-legend-item">' +
          '<span class="dv2-ring-legend-dot" style="background:' + DV2_KPI_COLORS.relances + '"></span>' +
          '<span class="dv2-ring-legend-label">Semaine</span>' +
          '<span class="dv2-ring-legend-value">' + Math.round(wkRatio * 100) + '%</span>' +
        '</div>' +
        '<div class="dv2-ring-legend-item">' +
          '<span class="dv2-ring-legend-dot" style="background:' + DV2_KPI_COLORS.notes + '"></span>' +
          '<span class="dv2-ring-legend-label">Jour</span>' +
          '<span class="dv2-ring-legend-value">' + Math.round(dayRatio * 100) + '%</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);margin-top:4px;">' +
          Math.round(daily.xp_current || 0) + '/' + Math.round(daily.xp_total || 0) + ' XP jour &middot; ' +
          Math.round(weekly.xp_current || 0) + '/' + Math.round(weekly.xp_total || 0) + ' XP semaine' +
        '</div>' +
      '</div>';
  }

  // Goal items with progress bars (grouped by scope)
  if (itemsEl) {
    var todayIso = (today && today.date) ? today.date : new Date().toISOString().slice(0, 10);
    var html = '';

    ['daily', 'weekly'].forEach(function(scope) {
      var obj = goals[scope];
      if (!obj || !obj.items) return;
      var keys = Object.keys(obj.items).filter(function(k) { return Number(obj.items[k].target || 0) > 0; });
      if (!keys.length) return;

      var scopeTitle = scope === 'daily' ? 'Objectifs du jour' : 'Objectifs de la semaine';
      var scopeXp = Math.round(obj.xp_current || 0) + '/' + Math.round(obj.xp_total || 0) + ' XP';
      html += '<div class="dv2-goals-scope-title">' + scopeTitle + ' <span class="dv2-goals-scope-xp">' + scopeXp + '</span></div>';

      keys.forEach(function(k) {
        var it = obj.items[k];
        var done = !!it.done;
        var ratio = Math.max(0, Math.min(1, Number(it.ratio) || 0));
        var stKey = 'dv2_goal_done_' + scope + '_' + k + '_' + (scope === 'daily' ? todayIso : weekStart);
        var wasDone = localStorage.getItem(stKey) === '1';
        if (done && !wasDone) {
          localStorage.setItem(stKey, '1');
          dv2_fireConfetti(confetti, 26);
          if (typeof showToast === 'function') showToast('Objectif atteint : ' + (it.label || k), 'success');
        }
        var emoji = dv2_emojiForRatio(ratio);
        var barColor = ratio >= 1 ? '#22c55e' : ratio >= 0.6 ? '#f59e0b' : ratio >= 0.3 ? '#f97316' : '#ef4444';

        html += '<div class="dv2-goal-row' + (done ? ' done' : '') + '">' +
          '<span class="dv2-goal-emoji">' + emoji + '</span>' +
          '<div class="dv2-goal-content">' +
            '<div class="dv2-goal-top">' +
              '<span class="dv2-goal-label">' + dv2_esc(it.label || k) + '</span>' +
              '<span class="dv2-goal-count"><strong>' + (it.count || 0) + '</strong>/' + (it.target || 0) + '</span>' +
            '</div>' +
            '<div class="dv2-goal-bar-wrap">' +
              '<div class="dv2-goal-bar-fill" style="width:' + Math.round(ratio * 100) + '%;background:' + barColor + '"></div>' +
            '</div>' +
            '<div class="dv2-goal-meta">+' + Math.round(it.xp_earned || 0) + ' / ' + Math.round(it.xp || 0) + ' XP</div>' +
          '</div>' +
        '</div>';
      });
    });

    itemsEl.innerHTML = html || '<div class="dv2-empty">Aucun objectif configure.</div>';
  }
}

// ─── AI Priorities ───

function dv2_renderPriorities(data) {
  var listEl = document.getElementById('dv2PrioritiesList');
  var insightEl = document.getElementById('dv2Insight');
  var pillEl = document.getElementById('dv2InsightPill');
  var pillText = document.getElementById('dv2InsightText');

  if (!data || !data.priorities || !data.priorities.length) {
    if (listEl) listEl.innerHTML = '<div class="dv2-empty">Aucune priorite generee.</div>';
    return;
  }

  if (listEl) {
    listEl.innerHTML = data.priorities.slice(0, 3).map(function(p, idx) {
      return '<div class="dv2-priority-pill">' +
        '<span class="dv2-priority-num">' + (idx + 1) + '</span>' +
        '<span>' + dv2_esc(p) + '</span>' +
      '</div>';
    }).join('');
  }

  if (data.insight) {
    if (insightEl) {
      insightEl.textContent = data.insight;
      insightEl.style.display = 'block';
    }
    if (pillEl && pillText) {
      pillText.textContent = data.insight;
      pillEl.style.display = 'flex';
    }
  }
}

async function dv2_refreshPriorities() {
  var listEl = document.getElementById('dv2PrioritiesList');
  if (listEl) listEl.innerHTML = '<div class="dv2-loading">Analyse en cours...</div>';
  try {
    var data = await dv2_fetchPriorities();
    dv2_renderPriorities(data);
  } catch(e) {
    if (listEl) listEl.innerHTML = '<div class="dv2-empty">Priorites IA indisponibles.</div>';
  }
}
window.dv2_refreshPriorities = dv2_refreshPriorities;

// ─── Manual KPI Modal ───

function dv2_openManualKpiModal() {
  var modal = document.getElementById('manualKpiModal');
  if (!modal) return;
  var today = new Date().toISOString().split('T')[0];
  var dateInput = document.getElementById('manualKpiDate');
  if (dateInput) dateInput.value = today;
  var countInput = document.getElementById('manualKpiCount');
  if (countInput) countInput.value = '1';
  var descInput = document.getElementById('manualKpiDesc');
  if (descInput) descInput.value = '';
  modal.style.display = 'flex';

  // Charger les stats de la semaine pour contexte
  var summaryEl = document.getElementById('manualKpiWeekSummary');
  var statsEl = document.getElementById('manualKpiWeekStats');
  if (summaryEl && statsEl && window._dv2LastGoals) {
    var goals = window._dv2LastGoals;
    var daily = (goals.daily || {}).items || {};
    var weekly = (goals.weekly || {}).items || {};
    var chips = [];
    if (daily.rdv) chips.push('<span style="color:#22c55e">' + (window.icon ? window.icon('calendar', {size:13}) : '') + ' RDV aujourd\'hui : <strong>' + daily.rdv.count + '</strong></span>');
    if (weekly.rdv) chips.push('<span style="color:#22c55e">' + (window.icon ? window.icon('calendar', {size:13}) : '') + ' RDV semaine : <strong>' + weekly.rdv.count + '</strong></span>');
    if (daily.push) chips.push('<span style="color:#8b5cf6">' + (window.icon ? window.icon('send', {size:13}) : '') + ' Push aujourd\'hui : <strong>' + daily.push.count + '</strong></span>');
    if (weekly.push) chips.push('<span style="color:#8b5cf6">' + (window.icon ? window.icon('send', {size:13}) : '') + ' Push semaine : <strong>' + weekly.push.count + '</strong></span>');
    if (chips.length) {
      statsEl.innerHTML = chips.join('');
      summaryEl.style.display = '';
    }
  }
}
window.dv2_openManualKpiModal = dv2_openManualKpiModal;

function dv2_closeManualKpiModal() {
  var modal = document.getElementById('manualKpiModal');
  if (modal) modal.style.display = 'none';
}
window.dv2_closeManualKpiModal = dv2_closeManualKpiModal;

async function dv2_saveManualKpi() {
  var type = (document.getElementById('manualKpiType') || {}).value || 'note';
  var date = (document.getElementById('manualKpiDate') || {}).value || new Date().toISOString().split('T')[0];
  var count = parseInt((document.getElementById('manualKpiCount') || {}).value || '1', 10);
  var desc = (document.getElementById('manualKpiDesc') || {}).value || '';
  try {
    var res = await fetch('/api/manual-kpi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, date: date, count: count, description: desc })
    });
    var data = await res.json();
    if (data.ok) {
      if (typeof showToast === 'function') showToast('KPI enregistre', 'success');
      dv2_closeManualKpiModal();
      dv2_boot();
    } else {
      if (typeof showToast === 'function') showToast('Erreur: ' + (data.error || 'Inconnu'), 'error');
    }
  } catch(e) {
    if (typeof showToast === 'function') showToast('Erreur: ' + (e.message || 'Inconnue'), 'error');
  }
}
window.dv2_saveManualKpi = dv2_saveManualKpi;

async function dv2_exportDayRecap() {
  try {
    var res = await fetch('/api/export/day');
    var json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Erreur');
    var recap = json.recap || {};
    var dateStr = recap.date || new Date().toISOString().slice(0, 10);
    var blob = new Blob([JSON.stringify(recap, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = "ProspUp_recap_" + dateStr + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    if (typeof showToast === 'function') showToast('Recap du jour telecharge', 'success');
  } catch(e) {
    if (typeof showToast === 'function') showToast(e.message || 'Erreur export', 'error');
  }
}
window.dv2_exportDayRecap = dv2_exportDayRecap;

// ─── Statistics Charts ───

function dv2_destroyChart(id) {
  if (_dv2_chartInstances[id]) {
    _dv2_chartInstances[id].destroy();
    delete _dv2_chartInstances[id];
  }
}

function dv2_isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function dv2_chartColors() {
  var dark = dv2_isDarkMode();
  return {
    text: dark ? '#e2e8f0' : '#334155',
    textSec: dark ? '#94a3b8' : '#6b7280',
    grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    surface: dark ? 'rgba(30,41,59,0.5)' : 'rgba(241,243,245,0.5)'
  };
}

async function dv2_fetchCharts() {
  try {
    var res = await fetch('/api/stats/charts');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var json = await res.json();
    return json;
  } catch(e) {
    console.warn('[DashV2] charts fetch error:', e.message);
    return null;
  }
}

function dv2_renderStats(chartsData) {
  if (!chartsData || typeof Chart === 'undefined') return;
  var cc = dv2_chartColors();
  var statusColors = ['#64748b', '#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#8b5cf6', '#94a3b8', '#06b6d4'];
  var companyColors = ['#f36f21', '#3b82f6', '#22c55e', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

  // === Transform API format to Chart.js format ===

  // 1. Pipeline Doughnut — API returns {"statut": count} object
  if (chartsData.statusDistribution && typeof chartsData.statusDistribution === 'object') {
    var sdRaw = chartsData.statusDistribution;
    var sdLabels, sdData;
    if (Array.isArray(sdRaw)) {
      // If already array format
      sdLabels = sdRaw.map(function(x) { return x.label || x.name || ''; });
      sdData = sdRaw.map(function(x) { return x.count || x.value || 0; });
    } else {
      // Object format: {"Prospect": 5, "RDV": 3}
      sdLabels = Object.keys(sdRaw);
      sdData = Object.values(sdRaw);
    }
    var canvas1 = document.getElementById('dv2ChartPipeline');
    if (canvas1 && sdLabels.length > 0) {
      dv2_destroyChart('pipeline');
      _dv2_chartInstances['pipeline'] = new Chart(canvas1.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: sdLabels,
          datasets: [{
            data: sdData,
            backgroundColor: statusColors.slice(0, sdLabels.length),
            borderWidth: 0,
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '60%',
          plugins: {
            legend: {
              position: 'right',
              labels: { font: { size: 11 }, color: cc.text, boxWidth: 10, padding: 8, borderRadius: 3, useBorderRadius: true }
            },
            tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8 }
          }
        }
      });
    }
  }

  // 2. RDV per Month (Line) — API returns [{label: "Apr 2026", count: 7}]
  if (chartsData.rdvPerMonth && Array.isArray(chartsData.rdvPerMonth)) {
    var rdvArr = chartsData.rdvPerMonth;
    var rdvLabels = rdvArr.map(function(x) { return x.label || ''; });
    var rdvData = rdvArr.map(function(x) { return x.count || 0; });
    var canvas2 = document.getElementById('dv2ChartRdv');
    if (canvas2 && rdvLabels.length > 0) {
      dv2_destroyChart('rdv');
      _dv2_chartInstances['rdv'] = new Chart(canvas2.getContext('2d'), {
        type: 'line',
        data: {
          labels: rdvLabels,
          datasets: [{
            label: 'RDV',
            data: rdvData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#22c55e',
            pointHoverRadius: 6,
            borderWidth: 2.5
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8 }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 }, color: cc.textSec } },
            y: { beginAtZero: true, grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.textSec, stepSize: 1 } }
          }
        }
      });
    }
  }

  // 3. Push per Week (Bar) — API returns [{label: "S15", count: 42}]
  if (chartsData.pushPerWeek && Array.isArray(chartsData.pushPerWeek)) {
    var pwArr = chartsData.pushPerWeek;
    var pwLabels = pwArr.map(function(x) { return x.label || ''; });
    var pwData = pwArr.map(function(x) { return x.count || 0; });
    var canvas3 = document.getElementById('dv2ChartPush');
    if (canvas3 && pwLabels.length > 0) {
      dv2_destroyChart('push');
      _dv2_chartInstances['push'] = new Chart(canvas3.getContext('2d'), {
        type: 'bar',
        data: {
          labels: pwLabels,
          datasets: [{
            label: 'Push',
            data: pwData,
            backgroundColor: 'rgba(139, 92, 246, 0.7)',
            borderRadius: 4,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8 }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 }, color: cc.textSec, maxRotation: 45 } },
            y: { beginAtZero: true, grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.textSec } }
          },
          animation: { duration: 800, easing: 'easeOutQuart' }
        }
      });
    }
  }

  // 5. Top Pushed Consultants (Horizontal Bar) — in Activity card
  if (chartsData.topPushedConsultants && Array.isArray(chartsData.topPushedConsultants)) {
    var tpArr = chartsData.topPushedConsultants;
    var subEl = document.getElementById('dv2TopPushedSub');
    var canvasTP = document.getElementById('dv2ChartTopPushed');
    if (canvasTP) {
      dv2_destroyChart('topPushed');
      if (!tpArr.length) {
        var wrap = canvasTP.parentElement;
        if (wrap) wrap.innerHTML = '<div class="dv2-activity-chart-empty">Aucun push envoye pour le moment</div>';
        if (subEl) subEl.textContent = '';
      } else {
        var tpLabels = tpArr.map(function(x) { return x.name || 'Candidat'; });
        var tpData = tpArr.map(function(x) { return x.count || 0; });
        var tpColors = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe', '#f5f3ff'];
        if (subEl) subEl.textContent = 'Top ' + tpArr.length;
        _dv2_chartInstances['topPushed'] = new Chart(canvasTP.getContext('2d'), {
          type: 'bar',
          data: {
            labels: tpLabels,
            datasets: [{
              label: 'Push envoyes',
              data: tpData,
              backgroundColor: tpColors.slice(0, tpLabels.length),
              borderRadius: 4,
              borderSkipped: false
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(0,0,0,0.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8,
                callbacks: {
                  label: function(ctx) { return ctx.parsed.x + ' push envoye' + (ctx.parsed.x > 1 ? 's' : ''); }
                }
              }
            },
            scales: {
              x: { beginAtZero: true, grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.textSec, stepSize: 1 } },
              y: { grid: { display: false }, ticks: { font: { size: 10 }, color: cc.text } }
            },
            animation: { duration: 700, easing: 'easeOutQuart' }
          }
        });
      }
    }
  }

  // 6. Urgency Distribution (Vertical Bar) — in Priorités IA card
  if (chartsData.urgencyDistribution && Array.isArray(chartsData.urgencyDistribution)) {
    var uArr = chartsData.urgencyDistribution;
    var uSubEl = document.getElementById('dv2UrgencySub');
    var canvasU = document.getElementById('dv2ChartUrgency');
    if (canvasU) {
      dv2_destroyChart('urgency');
      var uTotal = uArr.reduce(function(s, x) { return s + (x.count || 0); }, 0);
      if (!uTotal) {
        var wrapU = canvasU.parentElement;
        if (wrapU) wrapU.innerHTML = '<div class="dv2-activity-chart-empty">Aucune prochaine action planifiee</div>';
        if (uSubEl) uSubEl.textContent = '';
      } else {
        var uLabels = uArr.map(function(x) { return x.label || ''; });
        var uData = uArr.map(function(x) { return x.count || 0; });
        var uColors = ['#ef4444', '#f59e0b', '#3b82f6', '#94a3b8'];
        if (uSubEl) uSubEl.textContent = uTotal + ' prospects a suivre';
        _dv2_chartInstances['urgency'] = new Chart(canvasU.getContext('2d'), {
          type: 'bar',
          data: {
            labels: uLabels,
            datasets: [{
              label: 'Prospects',
              data: uData,
              backgroundColor: uColors,
              borderRadius: 6,
              borderSkipped: false
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(0,0,0,0.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8,
                callbacks: {
                  label: function(ctx) { return ctx.parsed.y + ' prospect' + (ctx.parsed.y > 1 ? 's' : ''); }
                }
              }
            },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 }, color: cc.text } },
              y: { beginAtZero: true, grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.textSec, stepSize: 1 } }
            },
            animation: { duration: 700, easing: 'easeOutQuart' }
          }
        });
      }
    }
  }

  // 4. Top Companies (Horizontal Bar) — API returns [{name: "Company", count: 12}]
  if (chartsData.topCompanies && Array.isArray(chartsData.topCompanies)) {
    var tcArr = chartsData.topCompanies;
    var tcLabels = tcArr.map(function(x) { return x.name || x.label || ''; });
    var tcData = tcArr.map(function(x) { return x.count || 0; });
    var canvas4 = document.getElementById('dv2ChartCompanies');
    if (canvas4 && tcLabels.length > 0) {
      dv2_destroyChart('companies');
      _dv2_chartInstances['companies'] = new Chart(canvas4.getContext('2d'), {
        type: 'bar',
        data: {
          labels: tcLabels,
          datasets: [{
            label: 'Prospects',
            data: tcData,
            backgroundColor: companyColors.slice(0, tcLabels.length),
            borderRadius: 4,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: 'rgba(0,0,0,0.85)', titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, cornerRadius: 8 }
          },
          scales: {
            x: { beginAtZero: true, grid: { color: cc.grid }, ticks: { font: { size: 10 }, color: cc.textSec } },
            y: { grid: { display: false }, ticks: { font: { size: 10 }, color: cc.text } }
          },
          animation: { duration: 800, easing: 'easeOutQuart' }
        }
      });
    }
  }
}

// ─── Tunnel de Vente — Pipeline Gamification (v29.0) ───

var DV2_JOURNEY_STAGES = [
  { key: 'appel',        label: 'Appel Prosp',      icon: 'phone',     color: '#64748b' },
  { key: 'rdv',          label: 'RDV Prosp',         icon: 'handshake', color: '#f59e0b' },
  { key: 'besoin',       label: 'Besoin Qualifié',   icon: 'bulb',      color: '#3b82f6' },
  { key: 'reunion_tech', label: 'Réunion Technique', icon: 'settings',  color: '#8b5cf6' },
  { key: 'contrat',      label: 'Contrat Signé',     icon: 'trophy',    color: '#22c55e' },
];

async function dv2_loadJourney() {
  try {
    var res = await fetch('/api/dashboard/pipeline-stages', { credentials: 'include' });
    var data = await res.json();
    if (!data.ok) return;
    dv2_renderJourneyFunnel(data);
    dv2_renderJourneyProspects(data.priority_prospects || []);
  } catch(e) {
    console.warn('[DashV2] tunnel de vente skipped:', e.message);
    var funnel = document.getElementById('dv2JourneyStages');
    if (funnel) funnel.innerHTML = '<div class="dv2-empty">Données indisponibles.</div>';
  }
}

function dv2_renderJourneyFunnel(data) {
  var stagesEl = document.getElementById('dv2JourneyStages');
  var badgeEl = document.getElementById('dv2JourneyBadge');
  if (!stagesEl) return;

  var total = data.total || 0;
  var stages = data.stages || {};

  if (badgeEl) badgeEl.textContent = total + ' prospect' + (total !== 1 ? 's' : '');

  if (!total) {
    stagesEl.innerHTML = '<div class="dv2-journey-empty"><span class="dv2-journey-empty-icon">' + (window.icon ? window.icon('mail', {size:24}) : '') + '</span>Aucun prospect.</div>';
    return;
  }

  stagesEl.innerHTML = DV2_JOURNEY_STAGES.map(function(s, i) {
    var n = stages[s.key] || 0;
    var pct = total ? Math.round((n / total) * 100) : 0;
    return '<div class="dv2-journey-stage" style="animation-delay:' + (i * 80) + 'ms">' +
      '<div class="dv2-journey-stage-icon">' + (window.icon ? window.icon(s.icon, {size:18}) : s.icon) + '</div>' +
      '<div class="dv2-journey-stage-info">' +
        '<div class="dv2-journey-stage-label">' + dv2_esc(s.label) + '</div>' +
        '<div class="dv2-journey-stage-bar">' +
          '<div class="dv2-journey-stage-fill" style="background:' + s.color + ';width:0" data-pct="' + pct + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="dv2-journey-stage-count' + (n === 0 ? ' zero' : '') + '">' + n + '</div>' +
    '</div>';
  }).join('');

  // Animer les barres après rendu
  setTimeout(function() {
    stagesEl.querySelectorAll('.dv2-journey-stage-fill').forEach(function(fill) {
      fill.style.width = fill.getAttribute('data-pct') + '%';
    });
  }, 80);
}

function dv2_renderJourneyProspects(prospects) {
  var el = document.getElementById('dv2JourneyProspects');
  if (!el) return;

  if (!prospects || !prospects.length) {
    el.innerHTML = '<div class="dv2-journey-empty">' +
      '<span class="dv2-journey-empty-icon">' + (window.icon ? window.icon('target', {size:24}) : '') + '</span>' +
      'Aucun prospect en attente de progression.<br>' +
      '<span style="font-size:11px;opacity:.7;">Ajoutez des réunions pour faire avancer vos prospects !</span>' +
    '</div>';
    return;
  }

  var STAGE_CLASSES = { besoin: 's-besoin', reunion_tech: 's-reunion_tech' };
  var STAGE_LABELS  = { besoin: (window.icon ? window.icon('bulb', {size:12}) : '') + ' Besoin', reunion_tech: (window.icon ? window.icon('settings', {size:12}) : '') + ' Réunion Tech' };

  el.innerHTML = prospects.map(function(p, i) {
    var stageClass = STAGE_CLASSES[p.stage] || '';
    var stageLabel = STAGE_LABELS[p.stage] || p.stage;

    // Jours depuis dernier contact
    var daysHtml = '';
    if (p.lastContact) {
      var diffMs = Date.now() - new Date(p.lastContact).getTime();
      var diffDays = Math.floor(diffMs / 86400000);
      if (diffDays >= 0) {
        var cls = diffDays >= 14 ? 'urgent' : '';
        daysHtml = '<div class="dv2-journey-days ' + cls + '">' +
          (diffDays === 0 ? "Aujourd'hui" : diffDays + 'j sans contact') +
        '</div>';
      }
    }

    return '<div class="dv2-journey-prospect-row" style="animation-delay:' + (i * 60) + 'ms" ' +
      'onclick="window.location.href=\'/?open=' + p.id + '\'" title="Voir la fiche de ' + dv2_esc(p.name) + '">' +
      '<div class="dv2-journey-prospect-info">' +
        '<div class="dv2-journey-prospect-name">' + dv2_esc(p.name) + '</div>' +
        (p.company ? '<div class="dv2-journey-prospect-company">' + dv2_esc(p.company) + '</div>' : '') +
      '</div>' +
      '<div class="dv2-journey-prospect-meta">' +
        '<span class="dv2-journey-stage-badge ' + stageClass + '">' + stageLabel + '</span>' +
        daysHtml +
      '</div>' +
    '</div>';
  }).join('');
}

window.dv2_loadJourney = dv2_loadJourney;

// ─── Boot ───

async function dv2_boot() {
  try {
    var results = await Promise.all([dv2_fetchMain(), dv2_fetchTasks()]);
    var mainData = results[0];
    var tasks = results[1];
    _dv2_mainData = mainData;

    dv2_renderHero(mainData);
    dv2_renderPerformance(mainData);
    dv2_renderActions(mainData.overdue_list || [], tasks, mainData.upcoming_rdv || []);
    dv2_renderPipeline(mainData.pipeline);
    dv2_renderActivity(mainData.feed || { notes: [], push: [], rdv: [] }, (mainData.week && mainData.week.days) || []);
    window._dv2LastGoals = mainData.goals;
    dv2_renderGoals(mainData.goals, mainData.week, mainData.today);
  } catch(e) {
    console.warn('[DashV2] boot error:', e.message);
    if (typeof showToast === 'function') showToast('Erreur de chargement du dashboard', 'error');
  }

  // Non-blocking: AI priorities
  dv2_fetchPriorities()
    .then(function(data) { dv2_renderPriorities(data); })
    .catch(function(e) {
      console.warn('[DashV2] priorities skipped:', e.message);
      var el = document.getElementById('dv2PrioritiesList');
      if (el) el.innerHTML = '<div class="dv2-empty">Priorites IA indisponibles.</div>';
    });

  // Non-blocking: Statistics charts
  dv2_fetchCharts()
    .then(function(data) { if (data) dv2_renderStats(data); })
    .catch(function(e) { console.warn('[DashV2] charts skipped:', e.message); });

  // Non-blocking: Tunnel de vente (gamification pipeline)
  dv2_loadJourney().catch(function(e) { console.warn('[DashV2] journey skipped:', e.message); });
}

document.addEventListener('DOMContentLoaded', async function() {
  if (document.body.dataset.page !== 'dashboard') return;

  // Initialiser AppAuth (badge utilisateur, auth, read-only) via bootstrap
  try {
    var fn = window.bootstrap || window.appBootstrap;
    if (typeof fn === 'function') await fn('dashboard');
  } catch(e) {}

  // Init assistant button if available
  var fab = document.getElementById('dashAssistantFab');
  if (fab) fab.style.display = 'flex';

  dv2_boot();
});
