// P5: Notifications navigateur — rappel relances 1x/jour à une heure configurable
(function () {
    'use strict';

    var STORAGE_KEY = 'prospup_notifications';
    var LAST_SENT_KEY = 'prospup_notification_last_sent';
    var _intervalId = null;

    function getPrefs() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { enabled: false, hour: 9 };
            var o = JSON.parse(raw);
            return {
                enabled: !!o.enabled,
                hour: typeof o.hour === 'number' ? Math.max(0, Math.min(23, o.hour)) : 9
            };
        } catch (e) {
            return { enabled: false, hour: 9 };
        }
    }

    function setPrefs(prefs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                enabled: !!prefs.enabled,
                hour: typeof prefs.hour === 'number' ? Math.max(0, Math.min(23, prefs.hour)) : 9
            }));
        } catch (e) {}
    }

    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function shouldFire() {
        var prefs = getPrefs();
        if (!prefs.enabled || !('Notification' in window)) return false;
        if (Notification.permission !== 'granted') return false;
        var now = new Date();
        if (now.getHours() !== prefs.hour) return false;
        var last = localStorage.getItem(LAST_SENT_KEY);
        if (last === todayKey()) return false;
        return true;
    }

    function sendDailyNotification() {
        if (!shouldFire()) return;
        fetch('/api/dashboard', { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (json) {
                var d = (json && json.data) || {};
                var pipeline = d.pipeline || {};
                var overdue = pipeline.overdue || 0;
                var dueToday = pipeline.due_today || 0;
                if (overdue === 0 && dueToday === 0) return;
                var body = (overdue > 0 ? overdue + ' relance(s) en retard' : '') +
                    (overdue > 0 && dueToday > 0 ? ' · ' : '') +
                    (dueToday > 0 ? dueToday + ' à faire aujourd\'hui' : '');
                var n = new Notification('ProspUp — Relances', {
                    body: body,
                    icon: '/static/icon-192.png',
                    tag: 'prospup-daily'
                });
                n.onclick = function () {
                    window.focus();
                    if (n.close) n.close();
                };
                localStorage.setItem(LAST_SENT_KEY, todayKey());
            })
            .catch(function () {});
    }

    function startScheduler() {
        if (_intervalId) clearInterval(_intervalId);
        _intervalId = null;
        var prefs = getPrefs();
        if (!prefs.enabled || !('Notification' in window)) return;
        sendDailyNotification();
        _intervalId = setInterval(sendDailyNotification, 60000);
    }

    function requestPermission(callback) {
        if (!('Notification' in window)) {
            if (callback) callback('unsupported');
            return;
        }
        if (Notification.permission === 'granted') {
            if (callback) callback('granted');
            return;
        }
        if (Notification.permission === 'denied') {
            if (callback) callback('denied');
            return;
        }
        Notification.requestPermission().then(function (p) {
            if (callback) callback(p);
        });
    }

    window.ProspUpNotifications = {
        getPrefs: getPrefs,
        setPrefs: function (prefs) {
            setPrefs(prefs);
            startScheduler();
        },
        requestPermission: requestPermission,
        startScheduler: startScheduler
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { startScheduler(); });
    } else {
        startScheduler();
    }
})();
