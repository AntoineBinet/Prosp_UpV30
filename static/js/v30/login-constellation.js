/* =============================================================
   /login & /v30/login — Constellation behind editorial text
   Light, autonomous canvas animation : drifting nodes + links,
   orange highlight when the cursor approaches. Inspired by the
   Up Technologies refonte 2026 hero background, but masked to a
   soft circular halo so it sits delicately behind the title.
   ============================================================= */
(function () {
  'use strict';

  var canvas = document.querySelector('.mq-constellation');
  if (!canvas) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;
  var particles = [];
  var mouse = { x: 0, y: 0, active: false };
  var raf = 0;
  var t0 = performance.now();

  var INK = 'rgba(17, 32, 42, ';
  var ACCENT = 'rgba(239, 136, 39, ';
  var MAX_DIST = 130;
  var MAX_DIST2 = MAX_DIST * MAX_DIST;
  var MAX_LINKS = 3;
  var HOVER = 140;

  function sizeFromParent() {
    var host = canvas.parentElement || canvas;
    var rect = host.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function rebuild() {
    var area = W * H;
    var count = Math.max(26, Math.min(72, Math.round(area / 13000)));
    particles = new Array(count);
    for (var i = 0; i < count; i++) {
      var big = Math.random() < 0.18 ? 2 : 1;
      particles[i] = {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: big === 2 ? 1.9 + Math.random() * 0.7 : 0.9 + Math.random() * 0.8,
        sz: big,
        ph: Math.random() * Math.PI * 2,
        ox: 0,
        oy: 0
      };
    }
  }

  function resize() {
    sizeFromParent();
    rebuild();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);

    var i, j, p, q;

    // 1. drift + micro wobble
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -12) p.x = W + 12;
      else if (p.x > W + 12) p.x = -12;
      if (p.y < -12) p.y = H + 12;
      else if (p.y > H + 12) p.y = -12;
      p.ox = Math.cos(t * 0.45 + p.ph) * 3.5;
      p.oy = Math.sin(t * 0.55 + p.ph) * 3.5;
    }

    // 2. links to K nearest neighbours
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      var ax = p.x + p.ox, ay = p.y + p.oy;
      var cands = [];
      for (j = 0; j < particles.length; j++) {
        if (j === i) continue;
        q = particles[j];
        var bx = q.x + q.ox, by = q.y + q.oy;
        var dx = ax - bx, dy = ay - by;
        var d2 = dx * dx + dy * dy;
        if (d2 < MAX_DIST2) cands.push({ d2: d2, bx: bx, by: by });
      }
      cands.sort(function (a, b) { return a.d2 - b.d2; });
      var limit = Math.min(MAX_LINKS, cands.length);
      for (var k = 0; k < limit; k++) {
        var c = cands[k];
        var f = 1 - Math.sqrt(c.d2) / MAX_DIST;
        var color = INK, alpha = f * 0.22;
        if (mouse.active) {
          var mx = (ax + c.bx) * 0.5 - mouse.x;
          var my = (ay + c.by) * 0.5 - mouse.y;
          var md = Math.sqrt(mx * mx + my * my);
          var h = Math.max(0, 1 - md / HOVER);
          if (h > 0.05) {
            color = ACCENT;
            alpha = f * 0.78 * h;
          }
        }
        ctx.strokeStyle = color + alpha.toFixed(3) + ')';
        ctx.lineWidth = 0.55 + f * 0.7;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(c.bx, c.by);
        ctx.stroke();
      }
    }

    // 3. nodes (with optional halo on size-class 2)
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      var x = p.x + p.ox, y = p.y + p.oy;
      var nodeColor = INK + '0.46)';
      var haloColor = null;
      if (p.sz === 2) haloColor = ACCENT + '0.14)';
      if (mouse.active) {
        var ddx = x - mouse.x, ddy = y - mouse.y;
        var dd = Math.sqrt(ddx * ddx + ddy * ddy);
        var hh = Math.max(0, 1 - dd / HOVER);
        if (hh > 0.05) {
          nodeColor = ACCENT + (0.55 + hh * 0.4).toFixed(3) + ')';
          haloColor = p.sz === 2
            ? ACCENT + (0.18 + hh * 0.22).toFixed(3) + ')'
            : ACCENT + (hh * 0.18).toFixed(3) + ')';
        }
      }
      if (haloColor) {
        ctx.fillStyle = haloColor;
        ctx.beginPath();
        ctx.arc(x, y, p.r * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = nodeColor;
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onMove(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  }
  function onLeave() { mouse.active = false; }
  function onTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.touches[0].clientX - rect.left;
    mouse.y = e.touches[0].clientY - rect.top;
    mouse.active = true;
  }
  function onTouchEnd() { mouse.active = false; }

  function start() {
    resize();
    if (reduce) {
      // Static frame only — draw once and stop.
      requestAnimationFrame(function (n) { frame(n); cancelAnimationFrame(raf); });
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  var ro;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(function () { resize(); });
    ro.observe(canvas.parentElement || canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('mouseout', function (e) { if (!e.relatedTarget) onLeave(); });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else if (!reduce) {
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    }
  });

  start();
})();
