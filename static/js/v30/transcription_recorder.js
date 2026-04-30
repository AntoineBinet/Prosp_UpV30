/* ProspUp v32.14 — Recorder audio pour la page Transcription
   ─────────────────────────────────────────────────────────────────────
   - MediaRecorder API → blob audio (preférence webm/opus)
   - AudioContext + AnalyserNode → visualizer temps réel (32 barres)
   - Web SpeechRecognition (browser) → aperçu transcript en direct (optionnel)
   - 2 phases : capture → review (titre + participants + options)
   - Upload via FormData vers /api/transcription/upload (réutilise la pipeline)
*/
(function () {
  'use strict';

  // Le recorder ne s'instancie que sur la page liste Transcription
  if (!document.querySelector('[data-v30-tx]')) return;

  // ─── Helpers ────────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function esc(s) { var t = document.createElement('span'); t.textContent = s == null ? '' : String(s); return t.innerHTML; }
  function fmtBytes(n) {
    if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB']; var i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function fmtTimer(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return h ? (pad(h) + ':' + pad(m) + ':' + pad(sec)) : (pad(m) + ':' + pad(sec));
  }
  function showToast(msg, type) {
    if (window.showToast) window.showToast(msg, type || 'info');
    else if (type === 'error') alert(msg);
  }

  // ─── State ──────────────────────────────────────────────────────────
  var state = {
    phase: 'idle',           // idle | recording | paused | review | submitting
    mediaRecorder: null,
    stream: null,
    audioCtx: null,
    analyser: null,
    rafId: null,
    chunks: [],
    blob: null,
    blobUrl: null,
    mimeType: '',
    extension: 'webm',
    startedAt: 0,
    elapsedBeforePause: 0,
    timerId: null,
    speech: null,
    speechEnabled: true,
    speechSupported: ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window),
    liveFinalText: '',
  };

  // ─── DOM refs (résolus au mount) ────────────────────────────────────
  var dom = {};
  function resolveDom() {
    dom.modal      = $('[data-v30-rec-modal]');
    if (!dom.modal) return false;
    dom.openBtn    = $('[data-v30-rec-new]');
    dom.closeBtns  = $$('[data-v30-rec-close]');
    dom.rec        = $('[data-v30-rec]', dom.modal);
    dom.review     = $('[data-v30-rec-review]', dom.modal);
    dom.toggle     = $('[data-v30-rec-toggle]', dom.modal);
    dom.timer      = $('[data-v30-rec-time]', dom.modal);
    dom.viz        = $('[data-v30-rec-viz]', dom.modal);
    dom.live       = $('[data-v30-rec-live]', dom.modal);
    dom.liveStt    = $('[data-v30-rec-live-stt]', dom.modal);
    dom.hint       = $('[data-v30-rec-hint]', dom.modal);
    dom.error      = $('[data-v30-rec-error]', dom.modal);
    dom.btnPause   = $('[data-v30-rec-pause]', dom.modal);
    dom.btnResume  = $('[data-v30-rec-resume]', dom.modal);
    dom.btnFinish  = $('[data-v30-rec-finish]', dom.modal);
    dom.btnDiscard = $('[data-v30-rec-discard]', dom.modal);
    dom.btnRestart = $('[data-v30-rec-restart]', dom.modal);
    dom.btnSubmit  = $('[data-v30-rec-submit]', dom.modal);
    dom.playback   = $('[data-v30-rec-playback]', dom.modal);
    dom.playbackInfo = $('[data-v30-rec-playback-info]', dom.modal);
    dom.titleInput = $('#v30-rec-title-input', dom.modal);
    dom.partsList  = $('[data-v30-rec-participants]', dom.modal);
    dom.partsAdd   = $('[data-v30-rec-add-participant]', dom.modal);
    dom.autoAnalyze = $('[data-v30-rec-auto-analyze]', dom.modal);
    dom.progress   = $('[data-v30-rec-progress]', dom.modal);
    dom.progressFill = $('[data-v30-rec-progress-fill]', dom.modal);
    dom.progressLabel = $('[data-v30-rec-progress-label]', dom.modal);
    return true;
  }

  // ─── Visualizer (32 barres) ─────────────────────────────────────────
  var BAR_COUNT = 32;
  function buildBars() {
    if (!dom.viz) return;
    if (dom.viz.children.length === BAR_COUNT) return;
    dom.viz.innerHTML = '';
    for (var i = 0; i < BAR_COUNT; i++) {
      var b = document.createElement('span');
      b.className = 'v30-rec__bar';
      dom.viz.appendChild(b);
    }
  }
  function tickViz() {
    if (!state.analyser || !dom.viz) return;
    var bufLen = state.analyser.frequencyBinCount;
    var data = new Uint8Array(bufLen);
    state.analyser.getByteFrequencyData(data);
    // Down-sample fréquences → 32 barres en regroupant les bins
    var bars = dom.viz.children;
    var step = Math.floor(bufLen / BAR_COUNT) || 1;
    for (var i = 0; i < BAR_COUNT; i++) {
      var sum = 0;
      for (var k = 0; k < step; k++) { sum += data[i * step + k] || 0; }
      var amp = sum / step / 255;            // 0..1
      var h = 4 + amp * 48;                  // 4 → 52 px
      var bar = bars[i];
      if (bar) bar.style.height = h.toFixed(1) + 'px';
    }
    state.rafId = requestAnimationFrame(tickViz);
  }
  function stopViz() {
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
    // Reset bars à 4px pour l'effet « calme »
    if (dom.viz) {
      Array.prototype.forEach.call(dom.viz.children, function (b) { b.style.height = '4px'; });
    }
  }

  // ─── Speech Recognition (live preview) ──────────────────────────────
  function startSpeechRecognition() {
    if (!state.speechSupported || !state.speechEnabled) {
      if (dom.live) {
        dom.live.dataset[state.speechSupported ? 'disabled' : 'unsupported'] = '1';
      }
      return;
    }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      var rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = (navigator.language || 'fr-FR');
      state.liveFinalText = '';
      rec.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) state.liveFinalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (dom.live) {
          dom.live.innerHTML =
            '<span class="v30-rec__live-final">' + esc(state.liveFinalText) + '</span>'
            + (interim ? '<span class="v30-rec__live-interim"> ' + esc(interim) + '</span>' : '');
          dom.live.scrollTop = dom.live.scrollHeight;
        }
      };
      rec.onerror = function (e) {
        // 'no-speech' / 'aborted' / 'not-allowed' — on log mais on continue l'enregistrement
        // (l'audio est ce qui compte vraiment).
        console.warn('[recorder] speech error', e.error);
      };
      rec.onend = function () {
        // Auto-restart pendant l'enregistrement (le STT s'arrête tout seul après silence)
        if (state.phase === 'recording') {
          try { rec.start(); } catch (_) {}
        }
      };
      rec.start();
      state.speech = rec;
    } catch (e) {
      console.warn('[recorder] SR start failed', e);
    }
  }
  function stopSpeechRecognition() {
    if (state.speech) {
      try { state.speech.onend = null; state.speech.stop(); } catch (_) {}
      state.speech = null;
    }
  }

  // ─── MediaRecorder lifecycle ────────────────────────────────────────
  function pickMime() {
    var preferred = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',                  // Safari iOS — sera traité comme m4a
    ];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < preferred.length; i++) {
      if (MediaRecorder.isTypeSupported(preferred[i])) return preferred[i];
    }
    return '';
  }
  function extFromMime(m) {
    if (!m) return 'webm';
    if (/webm/i.test(m)) return 'webm';
    if (/ogg/i.test(m))  return 'ogg';
    if (/mp4/i.test(m))  return 'm4a';
    if (/mpeg/i.test(m)) return 'mp3';
    return 'webm';
  }

  function setError(msg) {
    if (!dom.error) return;
    if (!msg) {
      dom.error.hidden = true;
      dom.error.innerHTML = '';
      return;
    }
    dom.error.hidden = false;
    dom.error.innerHTML = msg;
  }

  function setPhase(phase) {
    state.phase = phase;
    if (dom.rec) dom.rec.dataset.v30RecState = phase;
    var titleEl = $('[data-v30-rec-modal-title]');
    if (titleEl) {
      titleEl.textContent =
        phase === 'recording' ? 'Enregistrement en cours…'
        : phase === 'paused'   ? 'Enregistrement en pause'
        : phase === 'review'   ? 'Vérifier l’enregistrement'
        : phase === 'submitting' ? 'Envoi en cours…'
        : 'Enregistrer une réunion';
    }
  }

  function updateButtons() {
    var p = state.phase;
    var hide = function (el) { if (el) el.hidden = true; };
    var show = function (el) { if (el) el.hidden = false; };
    [dom.btnPause, dom.btnResume, dom.btnFinish, dom.btnDiscard, dom.btnSubmit, dom.btnRestart].forEach(hide);

    if (p === 'idle') {
      // Seul le micro géant est actif
      if (dom.toggle) dom.toggle.setAttribute('aria-label', "Démarrer l'enregistrement");
      if (dom.hint) dom.hint.style.display = '';
    } else if (p === 'recording') {
      show(dom.btnPause); show(dom.btnFinish); show(dom.btnDiscard);
      if (dom.toggle) dom.toggle.setAttribute('aria-label', "Terminer l'enregistrement");
      if (dom.hint) dom.hint.style.display = 'none';
    } else if (p === 'paused') {
      show(dom.btnResume); show(dom.btnFinish); show(dom.btnDiscard);
      if (dom.hint) dom.hint.style.display = 'none';
    } else if (p === 'review') {
      show(dom.btnSubmit); show(dom.btnRestart);
      if (dom.hint) dom.hint.style.display = 'none';
    } else if (p === 'submitting') {
      show(dom.btnSubmit);
      if (dom.btnSubmit) dom.btnSubmit.disabled = true;
    }
  }

  function startTimer() {
    state.startedAt = Date.now();
    state.timerId = setInterval(function () {
      var elapsed = state.elapsedBeforePause + (Date.now() - state.startedAt);
      if (dom.timer) dom.timer.textContent = fmtTimer(elapsed);
    }, 250);
  }
  function pauseTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    state.elapsedBeforePause += Date.now() - state.startedAt;
  }
  function resetTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
    state.startedAt = 0;
    state.elapsedBeforePause = 0;
    if (dom.timer) dom.timer.textContent = '00:00';
  }

  function totalElapsed() {
    return state.elapsedBeforePause + (state.startedAt ? (Date.now() - state.startedAt) : 0);
  }

  async function startRecording() {
    setError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('<strong>Micro inaccessible</strong>Ce navigateur ne supporte pas l\'enregistrement audio.');
      return;
    }
    if (!window.MediaRecorder) {
      setError('<strong>Micro inaccessible</strong>MediaRecorder non supporté par ce navigateur.');
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      var msg = '<strong>Permission micro refusée</strong>';
      if (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError')) {
        msg += 'Autorise le micro dans la barre d\'URL puis réessaie.';
      } else if (e && e.name === 'NotFoundError') {
        msg = '<strong>Aucun micro détecté</strong>Branche un micro et réessaie.';
      } else {
        msg += (e && e.message) || 'Impossible d\'accéder au micro.';
      }
      setError(msg);
      return;
    }
    state.mimeType = pickMime();
    state.extension = extFromMime(state.mimeType);
    state.chunks = [];
    state.liveFinalText = '';
    if (dom.live) {
      dom.live.innerHTML = '';
      delete dom.live.dataset.disabled;
      delete dom.live.dataset.unsupported;
    }
    state.speechEnabled = !!(dom.liveStt && dom.liveStt.checked);

    try {
      state.mediaRecorder = new MediaRecorder(
        state.stream,
        state.mimeType ? { mimeType: state.mimeType } : undefined,
      );
    } catch (e) {
      setError('<strong>Format non supporté</strong>' + esc(e.message));
      cleanupStream();
      return;
    }
    state.mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    state.mediaRecorder.onstop = function () {
      finalizeRecording();
    };
    state.mediaRecorder.onerror = function (e) {
      console.error('[recorder] mediaRecorder error', e);
      setError('<strong>Erreur d\'enregistrement</strong>' + esc(String(e && e.error || e)));
    };
    // Audio analyser for visualizer
    try {
      state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = state.audioCtx.createMediaStreamSource(state.stream);
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 128;
      state.analyser.smoothingTimeConstant = 0.55;
      src.connect(state.analyser);
    } catch (e) {
      console.warn('[recorder] audioCtx KO', e);
    }

    state.elapsedBeforePause = 0;
    state.mediaRecorder.start(250);     // chunks toutes 250 ms
    setPhase('recording');
    updateButtons();
    startTimer();
    tickViz();
    startSpeechRecognition();
  }

  function pauseRecording() {
    if (!state.mediaRecorder || state.mediaRecorder.state !== 'recording') return;
    try { state.mediaRecorder.pause(); } catch (_) {}
    setPhase('paused');
    updateButtons();
    pauseTimer();
    stopSpeechRecognition();
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
  }

  function resumeRecording() {
    if (!state.mediaRecorder || state.mediaRecorder.state !== 'paused') return;
    try { state.mediaRecorder.resume(); } catch (_) {}
    setPhase('recording');
    updateButtons();
    startTimer();
    tickViz();
    startSpeechRecognition();
  }

  function stopRecording() {
    if (!state.mediaRecorder) return;
    var s = state.mediaRecorder.state;
    if (s === 'inactive') return;
    try { state.mediaRecorder.stop(); } catch (_) {}
    pauseTimer();
    stopSpeechRecognition();
    stopViz();
  }

  function finalizeRecording() {
    var totalMs = totalElapsed();
    var blob = new Blob(state.chunks, { type: state.mimeType || 'audio/webm' });
    state.blob = blob;
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = URL.createObjectURL(blob);

    cleanupStream();

    if (blob.size === 0) {
      setError('<strong>Enregistrement vide</strong>Réessaie — vérifie que le micro capte du son.');
      resetToIdle();
      return;
    }
    if (totalMs < 800) {
      setError('<strong>Enregistrement trop court</strong>Maintiens l\'enregistrement au moins 1 seconde.');
      resetToIdle();
      return;
    }

    // Phase Review
    setPhase('review');
    if (dom.rec)    dom.rec.hidden    = true;
    if (dom.review) dom.review.hidden = false;
    if (dom.playback) {
      dom.playback.src = state.blobUrl;
      dom.playback.load();
    }
    if (dom.playbackInfo) {
      dom.playbackInfo.textContent = fmtTimer(totalMs) + ' · ' + fmtBytes(blob.size);
    }
    if (dom.titleInput) {
      // Auto-titre par défaut
      if (!dom.titleInput.value) {
        var d = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var defTitle = 'Réunion ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear()
                      + ' ' + pad(d.getHours()) + 'h' + pad(d.getMinutes());
        dom.titleInput.value = defTitle;
      }
      setTimeout(function () { dom.titleInput.focus(); dom.titleInput.select(); }, 50);
    }
    ensureOneParticipant();
    refreshSubmitState();
    updateButtons();
  }

  function cleanupStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
      state.stream = null;
    }
    if (state.audioCtx) {
      try { state.audioCtx.close(); } catch (_) {}
      state.audioCtx = null;
      state.analyser = null;
    }
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
  }

  function discardRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      try { state.mediaRecorder.onstop = null; state.mediaRecorder.stop(); } catch (_) {}
    }
    stopSpeechRecognition();
    stopViz();
    cleanupStream();
    state.chunks = [];
    state.blob = null;
    if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; }
    resetToIdle();
  }

  function resetToIdle() {
    setPhase('idle');
    resetTimer();
    if (dom.live) dom.live.innerHTML = '';
    state.liveFinalText = '';
    if (dom.review) dom.review.hidden = true;
    if (dom.rec)    dom.rec.hidden    = false;
    if (dom.playback) { dom.playback.pause(); dom.playback.removeAttribute('src'); dom.playback.load(); }
    updateButtons();
    setError('');
  }

  // ─── Participants editor ────────────────────────────────────────────
  function makeParticipantRow(name, role) {
    var row = document.createElement('div');
    row.className = 'v30-rec__participant-row';
    row.innerHTML =
      '<input type="text" data-rec-name placeholder="Prénom Nom" maxlength="80">' +
      '<input type="text" data-rec-role placeholder="Rôle (ex. commercial)" maxlength="80">' +
      '<button type="button" class="btn btn-ghost btn-icon v30-rec__participant-rm" aria-label="Retirer">×</button>';
    row.querySelector('[data-rec-name]').value = name || '';
    row.querySelector('[data-rec-role]').value = role || '';
    row.querySelector('.v30-rec__participant-rm').addEventListener('click', function () {
      row.remove();
      ensureOneParticipant();
    });
    return row;
  }
  function addParticipant(name, role) {
    if (!dom.partsList) return;
    dom.partsList.appendChild(makeParticipantRow(name || '', role || ''));
  }
  function ensureOneParticipant() {
    if (!dom.partsList) return;
    if (dom.partsList.children.length === 0) addParticipant('', '');
  }
  function readParticipants() {
    if (!dom.partsList) return [];
    var out = [];
    Array.prototype.forEach.call(dom.partsList.children, function (row) {
      var nm = (row.querySelector('[data-rec-name]') || {}).value || '';
      var rl = (row.querySelector('[data-rec-role]') || {}).value || '';
      nm = nm.trim().slice(0, 80);
      rl = rl.trim().slice(0, 80);
      if (nm) out.push({ name: nm, role: rl });
    });
    return out;
  }

  function refreshSubmitState() {
    var ok = state.blob && dom.titleInput && dom.titleInput.value.trim();
    if (dom.btnSubmit) dom.btnSubmit.disabled = !ok || state.phase === 'submitting';
  }

  // ─── Modal open/close ───────────────────────────────────────────────
  function openModal() {
    if (!dom.modal) return;
    dom.modal.hidden = false;
    void dom.modal.offsetWidth;
    dom.modal.classList.add('is-open');
    buildBars();
    resetToIdle();
    setError('');
    if (!state.speechSupported && dom.live) {
      dom.live.dataset.unsupported = '1';
    }
  }
  function closeModal() {
    if (!dom.modal) return;
    dom.modal.classList.remove('is-open');
    setTimeout(function () { dom.modal.hidden = true; }, 180);
    discardRecording();
    if (dom.partsList) dom.partsList.innerHTML = '';
    if (dom.titleInput) dom.titleInput.value = '';
  }

  // ─── Submit (upload to backend) ─────────────────────────────────────
  function submit() {
    if (!state.blob) {
      showToast('Aucun enregistrement à envoyer', 'warn');
      return;
    }
    var title = (dom.titleInput && dom.titleInput.value.trim()) || '';
    if (!title) {
      showToast('Donne un titre à la réunion', 'warn');
      if (dom.titleInput) dom.titleInput.focus();
      return;
    }
    var participants = readParticipants();
    var autoAnalyze = !!(dom.autoAnalyze && dom.autoAnalyze.checked);

    var fd = new FormData();
    var fname = 'recording_' + Date.now() + '.' + state.extension;
    var file = new File([state.blob], fname, { type: state.blob.type || 'audio/webm' });
    fd.append('audio', file);
    fd.append('title', title);
    fd.append('source', 'recorder');
    fd.append('auto_analyze', autoAnalyze ? 'true' : 'false');
    if (participants.length) fd.append('participants', JSON.stringify(participants));

    setPhase('submitting');
    if (dom.btnSubmit) { dom.btnSubmit.disabled = true; }
    if (dom.progress) dom.progress.hidden = false;
    if (dom.progressFill) dom.progressFill.style.width = '0%';
    if (dom.progressLabel) dom.progressLabel.textContent = 'Envoi…';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcription/upload', true);
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        var pct = Math.round(e.loaded / e.total * 100);
        if (dom.progressFill) dom.progressFill.style.width = pct + '%';
        if (dom.progressLabel) dom.progressLabel.textContent = 'Envoi ' + pct + '%…';
      }
    };
    xhr.onload = function () {
      var ok = xhr.status >= 200 && xhr.status < 300;
      var data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch (_) {}
      if (!ok || !data.ok) {
        setPhase('review');
        if (dom.btnSubmit) dom.btnSubmit.disabled = false;
        if (dom.progress) dom.progress.hidden = true;
        var msg = (data && data.error) || ('HTTP ' + xhr.status);
        showToast('Envoi échoué : ' + msg, 'error');
        return;
      }
      showToast('Enregistrement envoyé · transcription en cours', 'success');
      // Redirige vers la fiche détail (le polling y prend le relais)
      window.location.href = '/v30/transcription/' + data.id;
    };
    xhr.onerror = function () {
      setPhase('review');
      if (dom.btnSubmit) dom.btnSubmit.disabled = false;
      if (dom.progress) dom.progress.hidden = true;
      showToast('Erreur réseau pendant l\'envoi', 'error');
    };
    xhr.send(fd);
  }

  // ─── Wiring ─────────────────────────────────────────────────────────
  function bind() {
    if (dom.openBtn) dom.openBtn.addEventListener('click', openModal);
    dom.closeBtns.forEach(function (b) { b.addEventListener('click', closeModal); });

    // Click outside (backdrop) to close — uniquement si pas en train d'enregistrer
    if (dom.modal) {
      dom.modal.addEventListener('click', function (e) {
        if (e.target === dom.modal && state.phase !== 'recording' && state.phase !== 'submitting') {
          closeModal();
        }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dom.modal && !dom.modal.hidden
          && state.phase !== 'recording' && state.phase !== 'submitting') {
        closeModal();
      }
    });

    if (dom.toggle) dom.toggle.addEventListener('click', function () {
      if (state.phase === 'idle') startRecording();
      else if (state.phase === 'recording' || state.phase === 'paused') stopRecording();
    });
    if (dom.btnPause)  dom.btnPause.addEventListener('click', pauseRecording);
    if (dom.btnResume) dom.btnResume.addEventListener('click', resumeRecording);
    if (dom.btnFinish) dom.btnFinish.addEventListener('click', stopRecording);
    if (dom.btnDiscard) dom.btnDiscard.addEventListener('click', function () {
      if (state.phase === 'recording' || state.phase === 'paused') {
        if (!confirm('Annuler cet enregistrement ? L\'audio sera perdu.')) return;
      }
      discardRecording();
    });
    if (dom.btnRestart) dom.btnRestart.addEventListener('click', function () {
      if (!confirm('Refaire l\'enregistrement ? L\'audio actuel sera supprimé.')) return;
      discardRecording();
    });
    if (dom.btnSubmit) dom.btnSubmit.addEventListener('click', submit);

    if (dom.partsAdd) dom.partsAdd.addEventListener('click', function () { addParticipant('', ''); });
    if (dom.titleInput) dom.titleInput.addEventListener('input', refreshSubmitState);

    if (dom.liveStt) dom.liveStt.addEventListener('change', function () {
      state.speechEnabled = dom.liveStt.checked;
      if (state.phase === 'recording') {
        if (state.speechEnabled) startSpeechRecognition();
        else { stopSpeechRecognition(); if (dom.live) dom.live.dataset.disabled = '1'; }
      } else if (dom.live) {
        if (state.speechEnabled) delete dom.live.dataset.disabled;
        else dom.live.dataset.disabled = '1';
      }
    });

    // Avant unload pendant un enregistrement → confirm
    window.addEventListener('beforeunload', function (e) {
      if (state.phase === 'recording' || state.phase === 'paused' || state.phase === 'submitting') {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────
  function init() {
    if (!resolveDom()) return;
    bind();
    buildBars();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
