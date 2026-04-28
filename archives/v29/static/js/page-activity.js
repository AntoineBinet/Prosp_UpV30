// ═══════════════════════════════════════════════════════════════
// Journal d'activité — page-activity.js (v27.10)
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var _page = 1;
    var _filterUser = '';
    var _filterAction = '';

    var ACTION_CFG = {
        create:    { label: 'Cr\u00e9ation',     color: '#22c55e' },
        update:    { label: 'Modification',       color: '#3b82f6' },
        delete:    { label: 'Suppression',        color: '#ef4444' },
        login:     { label: 'Connexion',          color: '#94a3b8' },
        logout:    { label: 'D\u00e9connexion',   color: '#64748b' },
        send_push: { label: 'Push / Email',       color: '#f97316' }
    };

    var ACTION_LABELS = {};
    Object.keys(ACTION_CFG).forEach(function (k) { ACTION_LABELS[k] = ACTION_CFG[k].label; });

    // ── Helpers ──────────────────────────────────────────────────
    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _fmtDate(dt) {
        if (!dt) return '';
        var d = new Date(dt.replace(' ', 'T'));
        if (isNaN(d.getTime())) return _esc(dt);
        return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            + '&nbsp;' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }

    function _badge(action) {
        var cfg = ACTION_CFG[action] || { label: _esc(action), color: '#94a3b8' };
        return '<span style="background:' + cfg.color + '22;color:' + cfg.color
            + ';border:1px solid ' + cfg.color + '44;border-radius:4px;'
            + 'padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;">'
            + cfg.label + '</span>';
    }

    function _entityCell(row) {
        if (!row.entity_type) return '<span class="muted">\u2014</span>';
        var html = '<span style="opacity:.7;font-size:11px;">' + _esc(row.entity_type) + '</span>';
        if (row.entity_label) html += ' <strong>' + _esc(row.entity_label) + '</strong>';
        if (row.entity_id)    html += ' <span class="muted" style="font-size:11px;">#' + _esc(row.entity_id) + '</span>';
        return html;
    }

    function _detailsCell(row) {
        if (!row.details) return '<span class="muted">\u2014</span>';
        try {
            var d = JSON.parse(row.details);
            var parts = [];
            Object.keys(d).forEach(function (k) { parts.push(_esc(k) + ': ' + _esc(d[k])); });
            return '<span class="muted" style="font-size:11px;">' + parts.join(', ') + '</span>';
        } catch (e) {
            return '<span class="muted" style="font-size:11px;">' + _esc(row.details) + '</span>';
        }
    }

    // ── Load ─────────────────────────────────────────────────────
    function load() {
        var loading   = document.getElementById('actLoading');
        var container = document.getElementById('actTableContainer');
        var empty     = document.getElementById('actEmpty');

        if (loading)   loading.style.display   = '';
        if (container) container.style.display = 'none';
        if (empty)     empty.style.display     = 'none';

        var params = new URLSearchParams({ page: _page });
        if (_filterUser)   params.set('user_id', _filterUser);
        if (_filterAction) params.set('action',  _filterAction);

        fetch('/api/activity?' + params.toString(), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (loading) loading.style.display = 'none';
                if (!d.ok) {
                    if (empty) { empty.textContent = 'Erreur : ' + (d.error || 'inconnue'); empty.style.display = ''; }
                    return;
                }

                _populateUserDropdown(d.users || []);
                _populateActionDropdown(d.actions || []);

                if (!d.logs || !d.logs.length) {
                    if (empty) empty.style.display = '';
                    return;
                }

                if (container) container.style.display = '';

                var tbody = document.getElementById('actTableBody');
                if (!tbody) return;
                tbody.innerHTML = '';
                d.logs.forEach(function (row) {
                    var tr = document.createElement('tr');
                    tr.innerHTML =
                        '<td style="white-space:nowrap;font-size:12px;">' + _fmtDate(row.created_at) + '</td>'
                        + '<td><strong>' + _esc(row.username || '') + '</strong></td>'
                        + '<td>' + _badge(row.action) + '</td>'
                        + '<td>' + _entityCell(row) + '</td>'
                        + '<td>' + _detailsCell(row) + '</td>';
                    tbody.appendChild(tr);
                });

                var pag = document.getElementById('actPagination');
                if (pag) pag.innerHTML = _buildPagination(d.page, d.pages, d.total);
            })
            .catch(function () {
                if (loading) loading.style.display = 'none';
                if (empty) { empty.textContent = 'Erreur de chargement.'; empty.style.display = ''; }
            });
    }

    // ── Dropdowns ────────────────────────────────────────────────
    function _populateUserDropdown(users) {
        var sel = document.getElementById('actFilterUser');
        if (!sel) return;
        var prev = _filterUser || sel.value;
        sel.innerHTML = '<option value="">Tous les utilisateurs</option>';
        users.forEach(function (u) {
            var opt = document.createElement('option');
            opt.value = u.user_id;
            opt.textContent = u.username || u.user_id;
            if (String(u.user_id) === String(prev)) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    function _populateActionDropdown(actions) {
        var sel = document.getElementById('actFilterAction');
        if (!sel) return;
        var prev = _filterAction || sel.value;
        sel.innerHTML = '<option value="">Toutes les actions</option>';
        actions.forEach(function (a) {
            var opt = document.createElement('option');
            opt.value = a;
            opt.textContent = ACTION_LABELS[a] || a;
            if (a === prev) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    // ── Pagination ───────────────────────────────────────────────
    function _buildPagination(page, pages, total) {
        var info = '<span class="muted" style="font-size:12px;">'
            + total + ' entr\u00e9e' + (total !== 1 ? 's' : '') + '</span>';
        if (pages <= 1) {
            return '<div style="display:flex;justify-content:flex-end;margin-top:12px;">' + info + '</div>';
        }
        var btns = '';
        btns += '<button class="btn btn-secondary btn-sm" onclick="actGoPage(' + (page - 1) + ')" '
            + (page <= 1 ? 'disabled' : '') + '>\u2039</button>';
        var start = Math.max(1, page - 2);
        var end   = Math.min(pages, page + 2);
        for (var i = start; i <= end; i++) {
            btns += '<button class="btn ' + (i === page ? 'btn-primary' : 'btn-secondary') + ' btn-sm"'
                + ' onclick="actGoPage(' + i + ')">' + i + '</button>';
        }
        btns += '<button class="btn btn-secondary btn-sm" onclick="actGoPage(' + (page + 1) + ')" '
            + (page >= pages ? 'disabled' : '') + '>\u203a</button>';
        return '<div style="display:flex;align-items:center;justify-content:space-between;'
            + 'gap:8px;margin-top:12px;flex-wrap:wrap;">'
            + info
            + '<div style="display:flex;gap:4px;">' + btns + '</div>'
            + '</div>';
    }

    // ── Public ───────────────────────────────────────────────────
    window.actGoPage = function (p) {
        _page = Math.max(1, p);
        load();
    };

    // ── Init ─────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        var selUser   = document.getElementById('actFilterUser');
        var selAction = document.getElementById('actFilterAction');
        var btnRefresh = document.getElementById('actBtnRefresh');

        if (selUser) {
            selUser.addEventListener('change', function () {
                _filterUser = this.value;
                _page = 1;
                load();
            });
        }
        if (selAction) {
            selAction.addEventListener('change', function () {
                _filterAction = this.value;
                _page = 1;
                load();
            });
        }
        if (btnRefresh) {
            btnRefresh.addEventListener('click', function () {
                _page = 1;
                load();
            });
        }

        load();
    });
})();
