/* ProspUp v30 — Update popup (admin) : accessible depuis le badge
   de version de la sidebar sur toutes les pages v30. */
(function () {
  'use strict';

  function $(s, root) { return (root || document).querySelector(s); }
  function esc(s) {
    var t = document.createElement('span');
    t.textContent = s == null ? '' : String(s);
    return t.innerHTML;
  }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  var modal, backdrop;
  var _aboutLoaded = false;

  function getEls() {
    modal = $('[data-v30-upd]');
    backdrop = $('[data-v30-upd-backdrop]');
    return !!modal;
  }

  function openModal() {
    if (!getEls()) return;
    modal.hidden = false;
    if (backdrop) backdrop.hidden = false;
    // Force reflow before adding class for transition
    void modal.offsetWidth;
    modal.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-visible');
    loadRemote();
    if (!_aboutLoaded) {
      loadAbout();
      _aboutLoaded = true;
    }
    document.addEventListener('keydown', onKey);
  }
  function closeModal() {
    if (!modal) return;
    modal.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-visible');
    setTimeout(function () {
      if (modal && !modal.classList.contains('is-open')) modal.hidden = true;
      if (backdrop && !backdrop.classList.contains('is-visible')) backdrop.hidden = true;
    }, 220);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') closeModal();
  }

  // ─── Status / log helpers ──────────────────────────────────
  function setStatus(text, color) {
    var el = $('[data-v30-upd-status]');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || 'var(--text-3)';
  }
  function appendLog(line) {
    var pre = $('[data-v30-upd-log]');
    if (!pre) return;
    pre.textContent += line + '\n';
    pre.scrollTop = pre.scrollHeight;
  }
  function resetLog() {
    var pre = $('[data-v30-upd-log]');
    var sum = $('[data-v30-upd-summary]');
    var box = $('[data-v30-upd-results]');
    if (pre) pre.textContent = '';
    if (sum) sum.innerHTML = '';
    if (box) box.hidden = false;
  }
  function setSummary(html) {
    var sum = $('[data-v30-upd-summary]');
    if (sum) sum.innerHTML = html;
  }
  function lockButtons(locked) {
    ['[data-v30-upd-pull]', '[data-v30-upd-rollback]', '[data-v30-upd-restart]']
      .forEach(function (sel) { var b = $(sel); if (b) b.disabled = locked; });
  }

  // ─── Remote / app_dir ──────────────────────────────────────
  async function loadRemote() {
    var remoteEl = $('[data-v30-upd-remote]');
    var dirEl = $('[data-v30-upd-appdir]');
    try {
      var res = await fetch('/api/deploy/remote', { credentials: 'same-origin' });
      var data = await res.json();
      if (data && data.ok) {
        if (remoteEl) { remoteEl.textContent = data.url || '—'; remoteEl.title = data.url || ''; }
        if (dirEl) dirEl.textContent = data.app_dir || '—';
      } else if (remoteEl) {
        remoteEl.textContent = 'erreur : ' + ((data && data.error) || 'inconnue');
      }
    } catch (e) {
      if (remoteEl) remoteEl.textContent = 'erreur : ' + e.message;
    }
  }
  async function changeRemote() {
    var span = $('[data-v30-upd-remote]');
    var current = span ? span.textContent : '';
    var next = prompt(
      'Nouvelle URL du remote Git (origin).\nExemple : https://github.com/AntoineBinet/Prosp_UpV30.git',
      current && current.indexOf('http') === 0 ? current : 'https://github.com/AntoineBinet/Prosp_UpV30.git'
    );
    if (!next) return;
    next = next.trim();
    if (!/^https:\/\/github\.com\/|^git@github\.com:/.test(next)) {
      alert('URL non autorisée. Elle doit commencer par https://github.com/ ou git@github.com:');
      return;
    }
    try {
      var res = await fetch('/api/deploy/set-remote', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: next })
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      toast('Remote mis à jour : ' + data.url, 'success');
      loadRemote();
    } catch (e) {
      toast('Erreur : ' + e.message, 'error');
    }
  }

  // ─── About (version / commit / branch / date) ──────────────
  async function loadAbout() {
    try {
      var res = await fetch('/api/app-version', { credentials: 'same-origin' });
      var j = await res.json();
      if (!j) return;
      var v = $('[data-v30-upd-version]');
      if (v) v.textContent = j.version || '—';
      var c = $('[data-v30-upd-commit]');
      if (c) c.textContent = j.commit_hash || '—';
      var br = $('[data-v30-upd-branch]');
      if (br) br.textContent = j.branch || '—';
      var d = $('[data-v30-upd-date]');
      if (d) d.textContent = j.commit_date || '—';
    } catch (e) { /* silencieux */ }
  }

  // ─── Pull + restart (SSE streaming) ────────────────────────
  async function doPull() {
    if (!confirm('Mettre à jour le serveur ?\n\n1. Récupération des modifications depuis Git (origin/main)\n2. Snapshot automatique de la base\n3. Redémarrage en ~10 s\n\nLe site sera indisponible environ 10-15 secondes.')) return;
    var btn = $('[data-v30-upd-pull]');
    var originalLabel = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Mise à jour en cours…';
    lockButtons(true);
    setStatus('Pull en cours…', 'var(--text-2)');
    resetLog();
    var finalData = null;
    try {
      var res = await fetch('/api/deploy/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok || !res.body) {
        var errText = await res.text();
        var errObj = {};
        try { errObj = JSON.parse(errText); } catch (_) {}
        finalData = { step: 'error', error: errObj.error || errText || 'HTTP ' + res.status };
        appendLog('Erreur HTTP ' + res.status + ' : ' + (finalData.error || ''));
      } else {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (var i = 0; i < parts.length; i++) {
            var line = parts[i].trim();
            if (!line.startsWith('data: ')) continue;
            try {
              var data = JSON.parse(line.slice(6));
              if (data.step === 'log' && data.line) appendLog(data.line);
              else if (data.step === 'fetch' && data.message) appendLog(data.message);
              else if (data.step === 'pull' && data.message) appendLog(data.message);
              else if (data.step === 'error') { appendLog('Erreur : ' + (data.error || '')); finalData = data; break; }
              else if (data.step === 'done') finalData = data;
            } catch (_) {}
          }
          if (finalData && (finalData.step === 'error' || finalData.step === 'done')) break;
        }
        if (buffer.trim()) {
          var last = buffer.trim();
          if (last.startsWith('data: ')) {
            try {
              var d = JSON.parse(last.slice(6));
              if (d.step === 'done' || d.step === 'error') finalData = d;
            } catch (_) {}
          }
        }
      }

      if (finalData && finalData.step === 'error') {
        setSummary('<div style="color:var(--danger);font-weight:600;">Erreur : ' + esc(finalData.error) + '</div>');
        setStatus('Échec', 'var(--danger)');
        toast('Erreur lors de la mise à jour', 'error');
        if (btn) btn.innerHTML = originalLabel;
        lockButtons(false);
        return;
      }

      if (finalData && finalData.step === 'done') {
        if (finalData.updated && finalData.restarting) {
          var delay = finalData.restart_delay_s || 10;
          setSummary('<div style="padding:10px;border-radius:var(--r-sm);background:color-mix(in oklab, var(--success) 12%, transparent);border:1px solid color-mix(in oklab, var(--success) 40%, transparent);color:var(--success);font-weight:500;">Mise à jour appliquée. Redémarrage dans ' + delay + ' s… Rechargement automatique.</div>');
          setStatus('Redémarrage…', 'var(--success)');
          toast('Mise à jour appliquée, redémarrage en cours', 'success');
          setTimeout(function () { window.location.reload(); }, 12000);
          return;
        }
        if (finalData.updated) {
          setSummary('<div style="color:var(--success);font-weight:500;">Mise à jour appliquée.</div>');
          setStatus('OK', 'var(--success)');
        } else {
          setSummary('<div class="muted">Déjà à jour. ' + (finalData.local_hash ? 'Commit : <code class="mono">' + esc(finalData.local_hash) + '</code>' : '') + '</div>');
          setStatus('Déjà à jour', 'var(--text-3)');
          toast('Serveur déjà à jour', 'info');
        }
      } else {
        setSummary('<div style="color:var(--danger);">Réponse inattendue.</div>');
      }
    } catch (e) {
      appendLog('Erreur réseau : ' + e.message);
      setSummary('<div style="color:var(--danger);font-weight:500;">Erreur réseau : ' + esc(e.message) + '</div>');
      setStatus('Erreur', 'var(--danger)');
      toast('Erreur réseau', 'error');
    }
    if (btn) btn.innerHTML = originalLabel;
    lockButtons(false);
  }

  // ─── Rollback ──────────────────────────────────────────────
  async function doRollback() {
    if (!confirm('Rollback vers le commit précédent ?\n\nLa base actuelle sera conservée (pas de rollback DB automatique).')) return;
    var btn = $('[data-v30-upd-rollback]');
    var original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Rollback…';
    lockButtons(true);
    resetLog();
    appendLog('Rollback en cours…');
    setStatus('Rollback…', 'var(--text-2)');
    try {
      var res = await fetch('/api/deploy/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      appendLog('Rollback OK → commit ' + (data.commit || '—'));
      setSummary('<div style="color:var(--success);font-weight:500;">Rollback appliqué. Rechargement dans 12 s…</div>');
      setStatus('Redémarrage…', 'var(--success)');
      toast('Rollback appliqué', 'success');
      setTimeout(function () { window.location.reload(); }, 12000);
    } catch (e) {
      appendLog('Erreur : ' + e.message);
      setSummary('<div style="color:var(--danger);">Erreur : ' + esc(e.message) + '</div>');
      setStatus('Échec', 'var(--danger)');
      toast('Rollback : ' + e.message, 'error');
      if (btn) btn.innerHTML = original;
      lockButtons(false);
    }
  }

  // ─── Restart simple ────────────────────────────────────────
  async function doRestart() {
    if (!confirm('Redémarrer le serveur (sans pull) ?\n\nLe site sera indisponible environ 10 s.')) return;
    var btn = $('[data-v30-upd-restart]');
    var original = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Redémarrage…';
    lockButtons(true);
    setStatus('Redémarrage…', 'var(--text-2)');
    try {
      var res = await fetch('/api/deploy/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'HTTP ' + res.status);
      toast('Redémarrage programmé, rechargement auto dans 12 s', 'info');
      setTimeout(function () { window.location.reload(); }, 12000);
    } catch (e) {
      setStatus('Échec', 'var(--danger)');
      toast('Redémarrage : ' + e.message, 'error');
      if (btn) btn.innerHTML = original;
      lockButtons(false);
    }
  }

  // ─── Bind ──────────────────────────────────────────────────
  function bind() {
    // Open triggers (badge sidebar)
    document.addEventListener('click', function (e) {
      var trg = e.target.closest && e.target.closest('[data-v30-upd-open]');
      if (trg) { e.preventDefault(); openModal(); }
    });

    if (!getEls()) return; // non-admin : partial absent

    var closeBtn = $('[data-v30-upd-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    var pull = $('[data-v30-upd-pull]');
    if (pull) pull.addEventListener('click', doPull);
    var roll = $('[data-v30-upd-rollback]');
    if (roll) roll.addEventListener('click', doRollback);
    var rest = $('[data-v30-upd-restart]');
    if (rest) rest.addEventListener('click', doRestart);
    var chg = $('[data-v30-upd-remote-change]');
    if (chg) chg.addEventListener('click', changeRemote);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
