// Calendar page (v9)

let _calEvents = [];
let _calDate = new Date();
let _calView = 'month';

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

function _isoDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

async function loadCalendar() {
    const grid = document.getElementById('calGrid');
    if (grid) grid.innerHTML = '<div class="muted" style="text-align:center;padding:40px;">Chargement du calendrier…</div>';
    try {
        const res = await fetch('/api/calendar_events');
        const json = await res.json();
        _calEvents = json.events || [];
        try {
            const setRes = await fetch('/api/settings');
            const setJson = await setRes.json();
            const extUrl = setJson.settings && setJson.settings.calendar_external_ics_url;
            if (extUrl && extUrl.trim()) {
                const extRes = await fetch('/api/calendar_events_external?url=' + encodeURIComponent(extUrl.trim()));
                const extJson = await extRes.json();
                if (extJson.ok && Array.isArray(extJson.events))
                    _calEvents = _calEvents.concat(extJson.events);
            }
        } catch (e) { console.warn('External calendar:', e); }
        renderCalendar();
    } catch(e) {
        console.error('Calendar error:', e);
        document.getElementById('calGrid').innerHTML = '<div class="card muted" style="padding:20px">Erreur de chargement</div>';
    }
}

function renderCalendar() {
    if (_calView === 'month') renderMonth();
    else renderWeek();
}

function renderMonth() {
    const year = _calDate.getFullYear();
    const month = _calDate.getMonth();
    document.getElementById('calTitle').textContent = `${MONTHS_FR[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // Monday-based: 0=Mon, 6=Sun
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const today = _isoDate(new Date());
    const grid = document.getElementById('calGrid');

    let html = '<div class="cal-header-row">';
    DAYS_FR.forEach(d => { html += `<div class="cal-header-cell">${d}</div>`; });
    html += '</div><div class="cal-body">';

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
        html += '<div class="cal-cell empty"></div>';
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const isToday = iso === today;
        const isPast = iso < today;
        const dayEvents = _calEvents.filter(e => e.date === iso);
        const rdvEvents = dayEvents.filter(e => e.type === 'rdv');
        const relanceEvents = dayEvents.filter(e => e.type === 'relance');
        const ec1Events = dayEvents.filter(e => e.type === 'ec1');
        const ec2Events = dayEvents.filter(e => e.type === 'ec2');
        const overdueRelances = relanceEvents.filter(e => isPast);

        let cellClass = 'cal-cell';
        if (isToday) cellClass += ' today';
        if (dayEvents.length) cellClass += ' has-events cal-cell-clickable';

        html += `<div class="${cellClass}" data-date="${iso}" data-events-count="${dayEvents.length}" title="${dayEvents.length ? 'Cliquer pour voir les détails du jour' : ''}">`;
        html += `<div class="cal-day-num${isToday ? ' today' : ''}">${day}</div>`;

        // Show up to 3 events, then "+N more" (cliquable pour ouvrir détail jour)
        const allEvents = [...rdvEvents, ...relanceEvents, ...ec1Events, ...ec2Events].slice(0, 3);
        allEvents.forEach(ev => {
            const isOverdue = ev.type === 'relance' && isPast;
            const isExternal = ev.type === 'external';
            let cls = 'cal-ev-rdv';
            let icon = window.icon ? window.icon('handshake', {size:12}) : '';
            if (ev.type === 'ec1') {
                cls = 'cal-ev-ec1';
                icon = window.icon ? window.icon('phone', {size:12}) : '';
            } else if (ev.type === 'ec2') {
                cls = 'cal-ev-ec2';
                icon = (window.icon ? window.icon('phone', {size:12}) : '') + (window.icon ? window.icon('phone', {size:12}) : '');
            } else if (isExternal) {
                cls = 'cal-ev-external';
                icon = window.icon ? window.icon('calendar', {size:12}) : '';
            } else if (isOverdue) {
                cls = 'cal-ev-overdue';
                icon = window.icon ? window.icon('alertTri', {size:12}) : '';
            } else if (ev.type === 'relance') {
                cls = 'cal-ev-relance';
                icon = window.icon ? window.icon('refreshCw', {size:12}) : '';
            }
            const time = ev.time ? `<span class="cal-ev-time">${ev.time}</span>` : '';
            const href = ev.url ? ev.url : `/?open=${ev.id}`;
            html += `<a href="${escapeHtml(href)}" class="cal-event ${cls}" title="${ev.name} — ${ev.company}">${icon} ${time}${escapeHtml(ev.name.split(' ')[0])}</a>`;
        });
        if (dayEvents.length > 3) {
            html += `<button type="button" class="cal-ev-more cal-ev-more-btn" data-date="${iso}" title="Voir tous les événements de ce jour">+${dayEvents.length - 3} autre${dayEvents.length - 3 > 1 ? 's' : ''}</button>`;
        }
        html += '</div>';
    }

    // Fill remaining cells
    const totalCells = startDow + lastDay.getDate();
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < remaining; i++) {
        html += '<div class="cal-cell empty"></div>';
    }

    html += '</div>';
    grid.innerHTML = html;
    _attachCalDayDetailListeners();
}

function _getCalDayEvents(iso) {
    return _calEvents.filter(e => e.date === iso);
}

function _openCalDayDetail(iso) {
    const events = _getCalDayEvents(iso);
    if (!events.length) return;
    const d = iso.split('-');
    const dayLabel = `${parseInt(d[2], 10)} ${MONTHS_FR[parseInt(d[1], 10) - 1]} ${d[0]}`;
    const modal = document.getElementById('calDayDetailModal');
    if (!modal) return;
    const listEl = document.getElementById('calDayDetailList');
    const titleEl = document.getElementById('calDayDetailTitle');
    if (titleEl) titleEl.textContent = 'Détails — ' + dayLabel;
    if (listEl) {
        listEl.innerHTML = events.map(ev => {
            const isPast = iso < _isoDate(new Date());
            const isOverdue = ev.type === 'relance' && isPast;
            let typeLabel = 'RDV';
            let icon = window.icon ? window.icon('handshake', {size:14}) : '';
            if (ev.type === 'ec1') {
                typeLabel = 'EC1';
                icon = window.icon ? window.icon('phone', {size:14}) : '';
            } else if (ev.type === 'ec2') {
                typeLabel = 'EC2';
                icon = (window.icon ? window.icon('phone', {size:14}) : '') + (window.icon ? window.icon('phone', {size:14}) : '');
            } else if (isOverdue) {
                typeLabel = 'Relance (en retard)';
                icon = window.icon ? window.icon('alertTri', {size:14}) : '';
            } else if (ev.type === 'relance') {
                typeLabel = 'Relance';
                icon = window.icon ? window.icon('refreshCw', {size:14}) : '';
            }
            const href = ev.url || (ev.id ? `/?open=${ev.id}` : '#');
            const time = ev.time ? ev.time + ' — ' : '';
            return `<div class="cal-day-detail-item">
                <a href="${escapeHtml(href)}" class="cal-day-detail-link">${icon} ${time}<strong>${escapeHtml(ev.name)}</strong> — ${escapeHtml(ev.company || '')}</a>
                <span class="cal-day-detail-type">${typeLabel}</span>
            </div>`;
        }).join('');
    }
    modal.style.display = 'flex';
}

function _closeCalDayDetail() {
    const modal = document.getElementById('calDayDetailModal');
    if (modal) modal.style.display = 'none';
}
window._closeCalDayDetail = _closeCalDayDetail;

function _attachCalDayDetailListeners() {
    const grid = document.getElementById('calGrid');
    if (!grid) return;
    grid.addEventListener('click', function (e) {
        const moreBtn = e.target.closest('.cal-ev-more-btn');
        if (moreBtn) {
            e.preventDefault();
            e.stopPropagation();
            const iso = moreBtn.getAttribute('data-date');
            if (iso) _openCalDayDetail(iso);
            return;
        }
        const cell = e.target.closest('.cal-cell-clickable');
        if (cell && !e.target.closest('a.cal-event')) {
            const iso = cell.getAttribute('data-date');
            if (iso) _openCalDayDetail(iso);
        }
    });
}

function _initCalDayDetailModal() {
    const modal = document.getElementById('calDayDetailModal');
    if (!modal) return;
    modal.addEventListener('click', function (e) {
        if (e.target === modal) _closeCalDayDetail();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.style.display === 'flex') _closeCalDayDetail();
    });
}

function renderWeek() {
    const today = _isoDate(new Date());
    const d = new Date(_calDate);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // Monday-based
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    document.getElementById('calTitle').textContent = 
        `Semaine du ${monday.getDate()} ${MONTHS_FR[monday.getMonth()]} au ${sunday.getDate()} ${MONTHS_FR[sunday.getMonth()]} ${sunday.getFullYear()}`;

    const grid = document.getElementById('calGrid');
    let html = '<div class="cal-week-view">';

    for (let i = 0; i < 7; i++) {
        const dd = new Date(monday);
        dd.setDate(monday.getDate() + i);
        const iso = _isoDate(dd);
        const isToday = iso === today;
        const isPast = iso < today;
        const dayEvents = _calEvents.filter(e => e.date === iso);

        html += `<div class="cal-week-day${isToday ? ' today' : ''}">`;
        html += `<div class="cal-week-header">${DAYS_FR[i]} <strong>${dd.getDate()}</strong></div>`;

        if (!dayEvents.length) {
            html += '<div class="cal-week-empty muted">—</div>';
        } else {
            dayEvents.forEach(ev => {
                const isOverdue = ev.type === 'relance' && isPast;
                let cls = 'cal-ev-rdv';
                let icon = window.icon ? window.icon('handshake', {size:12}) : '';
                if (ev.type === 'ec1') {
                    cls = 'cal-ev-ec1';
                    icon = window.icon ? window.icon('phone', {size:12}) : '';
                } else if (ev.type === 'ec2') {
                    cls = 'cal-ev-ec2';
                    icon = (window.icon ? window.icon('phone', {size:12}) : '') + (window.icon ? window.icon('phone', {size:12}) : '');
                } else if (isOverdue) {
                    cls = 'cal-ev-overdue';
                    icon = window.icon ? window.icon('alertTri', {size:12}) : '';
                } else if (ev.type === 'relance') {
                    cls = 'cal-ev-relance';
                    icon = window.icon ? window.icon('refreshCw', {size:12}) : '';
                }
                const time = ev.time ? `<span class="cal-ev-time">${ev.time}</span>` : '';
                const href = ev.url ? ev.url : `/?open=${ev.id}`;
                html += `<a href="${escapeHtml(href)}" class="cal-event ${cls}" style="display:block;margin-bottom:4px;" title="${ev.name} — ${ev.company}">
                    ${icon} ${time}<strong>${escapeHtml(ev.name)}</strong>
                    <span class="muted" style="font-size:10px;display:block;">${escapeHtml(ev.company)}</span>
                </a>`;
            });
        }
        html += '</div>';
    }

    html += '</div>';
    grid.innerHTML = html;
}

function navCalendar(dir) {
    if (_calView === 'month') {
        _calDate.setMonth(_calDate.getMonth() + dir);
    } else {
        _calDate.setDate(_calDate.getDate() + dir * 7);
    }
    renderCalendar();
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const fn = window.bootstrap || window.appBootstrap;
        if (typeof fn === 'function') await fn('calendar');
    } catch(e) {}

    _initCalDayDetailModal();
    document.getElementById('calPrev')?.addEventListener('click', () => navCalendar(-1));
    document.getElementById('calNext')?.addEventListener('click', () => navCalendar(1));
    document.getElementById('calToday')?.addEventListener('click', () => { _calDate = new Date(); renderCalendar(); });
    document.getElementById('calView')?.addEventListener('change', (e) => { _calView = e.target.value; renderCalendar(); });

    try {
        const setRes = await fetch('/api/settings');
        const setJson = await setRes.json();
        const urlInput = document.getElementById('calExternalIcsUrl');
        if (urlInput && setJson.settings && setJson.settings.calendar_external_ics_url)
            urlInput.value = setJson.settings.calendar_external_ics_url;
    } catch (e) {}
    document.getElementById('calSaveExternalUrl')?.addEventListener('click', async () => {
        const urlInput = document.getElementById('calExternalIcsUrl');
        const url = urlInput && urlInput.value ? urlInput.value.trim() : '';
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: { calendar_external_ics_url: url } })
            });
            const j = await res.json();
            if (j.ok) {
                if (typeof showToast === 'function') showToast('URL enregistrée. Rechargement du calendrier.', 'success');
                await loadCalendar();
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Erreur enregistrement', 'error');
        }
    });

    await loadCalendar();
    setInterval(loadCalendar, 3600000);
});

// ═══════════════════════════════════════════════════════════════
// ICS Calendar Import (v16.5)
// ═══════════════════════════════════════════════════════════════
let _importedEvents = [];

function importICSFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const events = parseICS(e.target.result);
            _importedEvents = events;
            showToast(`${events.length} événement(s) importé(s)`, 'success');
            renderCalendar();
        } catch(err) {
            showToast('Erreur de parsing ICS: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function parseICS(text) {
    const events = [];
    const blocks = text.split('BEGIN:VEVENT');
    
    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0];
        const event = {};
        
        // Parse SUMMARY
        const summaryMatch = block.match(/SUMMARY[^:]*:(.*?)(?:\r?\n(?!\s))/s);
        if (summaryMatch) event.summary = summaryMatch[1].replace(/\r?\n\s/g, '').trim();
        
        // Parse DTSTART
        const startMatch = block.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
        if (startMatch) {
            const [, y, m, d, h, min] = startMatch;
            event.start = `${y}-${m}-${d}`;
            if (h) event.startTime = `${h}:${min || '00'}`;
        }
        
        // Parse DTEND
        const endMatch = block.match(/DTEND[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
        if (endMatch) {
            const [, y, m, d, h, min] = endMatch;
            event.end = `${y}-${m}-${d}`;
            if (h) event.endTime = `${h}:${min || '00'}`;
        }
        
        // Parse LOCATION
        const locMatch = block.match(/LOCATION[^:]*:(.*?)(?:\r?\n(?!\s))/s);
        if (locMatch) event.location = locMatch[1].replace(/\r?\n\s/g, '').trim();
        
        // Parse DESCRIPTION
        const descMatch = block.match(/DESCRIPTION[^:]*:(.*?)(?:\r?\n(?!\s))/s);
        if (descMatch) event.description = descMatch[1].replace(/\\n/g, '\n').replace(/\r?\n\s/g, '').trim();
        
        if (event.start && event.summary) events.push(event);
    }
    
    return events;
}

// Patch renderCalendar to include imported events
const _origRenderCalendar = typeof renderCalendar === 'function' ? renderCalendar : null;

// Override the grid rendering to inject imported events
const _origGridInnerHTMLSetter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
// We'll hook into the calendar rendering by checking for imported events after each render
const _calObserver = new MutationObserver(function() {
    if (_importedEvents.length === 0) return;
    const grid = document.getElementById('calGrid');
    if (!grid) return;
    
    _importedEvents.forEach(function(ev) {
        // Find the cell for this date
        const cells = grid.querySelectorAll('.cal-day');
        cells.forEach(function(cell) {
            const dateAttr = cell.getAttribute('data-date');
            if (dateAttr === ev.start) {
                // Add imported event badge
                if (!cell.querySelector('.ics-event-' + ev.summary.replace(/\s/g, '_').substring(0, 20))) {
                    const badge = document.createElement('div');
                    badge.className = 'cal-event ics-event ics-event-' + ev.summary.replace(/\s/g, '_').substring(0, 20);
                    badge.style.cssText = 'background:#6366f1;color:#fff;font-size:10px;padding:2px 6px;border-radius:6px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;max-width:100%;';
                    badge.textContent = (ev.startTime ? ev.startTime + ' ' : '') + ev.summary;
                    badge.title = ev.summary + (ev.location ? '\n' + ev.location : '') + (ev.description ? '\n' + ev.description : '');
                    cell.appendChild(badge);
                }
            }
        });
    });
});

// Start observing the calendar grid
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        const grid = document.getElementById('calGrid');
        if (grid) _calObserver.observe(grid, { childList: true, subtree: true });
    }, 500);
});
