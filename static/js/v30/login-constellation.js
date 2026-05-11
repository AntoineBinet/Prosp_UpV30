/* =============================================================
   /login & /v30/login — Constellation behind editorial text
   Port direct du PointCloud de marienour.work (SiteEntreprise) :
   - densité moyenne via density factor
   - 3 classes de points (small/medium/large) → variété visuelle
   - liens limités aux 4 plus proches voisins par point
   - épaisseur de ligne variable selon la distance (proche = épais)
   - opacité plus marquée au repos, spotlight orange au hover
   - halo orange doux autour des hubs (sizeClass 2)
   - rendu en deux passes (liens encre puis spotlight orange)
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
  var points = [];
  var mouse = { x: -9999, y: -9999, active: false };
  var raf = 0;

  var DENSITY = 2.2;
  var LINK_D = 185;
  var LINK_D2 = LINK_D * LINK_D;
  var NEIGHBORS = 4;
  var MOUSE_R = 180;
  var BASE_ALPHA = 0.28;
  var INK = 'rgba(17,32,42,';
  var ACCENT = 'rgba(239,136,39,';

  function sizeFromParent() {
    var rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function rebuild() {
    var count = Math.floor((W * H) / 18000 * DENSITY);
    if (count < 18) count = 18;
    if (count > 110) count = 110;
    points = new Array(count);
    for (var i = 0; i < count; i++) {
      var roll = Math.random();
      var r, sizeClass;
      if (roll < 0.60) {
        r = 1.3 + Math.random() * 0.7;
        sizeClass = 0;
      } else if (roll < 0.90) {
        r = 2.0 + Math.random() * 1.0;
        sizeClass = 1;
      } else {
        r = 3.0 + Math.random() * 1.6;
        sizeClass = 2;
      }
      points[i] = {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.20,
        vy: (Math.random() - 0.5) * 0.20,
        r: r,
        sizeClass: sizeClass,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        ampX: 2 + Math.random() * 4,
        ampY: 2 + Math.random() * 4,
        freqX: 0.0003 + Math.random() * 0.0005,
        freqY: 0.0003 + Math.random() * 0.0005,
        ox: 0,
        oy: 0
      };
    }
  }

  function resize() {
    sizeFromParent();
    rebuild();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    var now = performance.now();
    ctx.clearRect(0, 0, W, H);

    var i, j, p, b;

    // 1) drift + micro-wobble + reflet sur les bords
    for (i = 0; i < points.length; i++) {
      p = points[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      if (p.x < 0) p.x = 0; else if (p.x > W) p.x = W;
      if (p.y < 0) p.y = 0; else if (p.y > H) p.y = H;

      var fx = Math.sin(now * p.freqX + p.phaseX) * p.ampX;
      var fy = Math.cos(now * p.freqY + p.phaseY) * p.ampY;

      var targetOx = fx;
      var targetOy = fy;

      if (mouse.active) {
        var px = p.x + fx, py = p.y + fy;
        var dx = px - mouse.x, dy = py - mouse.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < MOUSE_R && d > 0.001) {
          var rf = (1 - d / MOUSE_R) * 0.7;
          targetOx = fx + (dx / d) * rf * 22;
          targetOy = fy + (dy / d) * rf * 22;
        }
      }

      p.ox = p.ox * 0.86 + targetOx * 0.14;
      p.oy = p.oy * 0.86 + targetOy * 0.14;
    }

    // 2) Liens : pour chaque point, on garde les N plus proches voisins en deçà de LINK_D
    var drawn = {};
    for (i = 0; i < points.length; i++) {
      p = points[i];
      var ax = p.x + p.ox, ay = p.y + p.oy;
      var cands = [];
      for (j = 0; j < points.length; j++) {
        if (j === i) continue;
        b = points[j];
        var bx = b.x + b.ox, by = b.y + b.oy;
        var ddx = ax - bx, ddy = ay - by;
        var d2 = ddx * ddx + ddy * ddy;
        if (d2 < LINK_D2) cands.push({ j: j, d2: d2 });
      }
      cands.sort(function (u, v) { return u.d2 - v.d2; });
      var take = cands.length < NEIGHBORS ? cands.length : NEIGHBORS;
      for (var k = 0; k < take; k++) {
        var c = cands[k];
        var key = i < c.j ? i + '-' + c.j : c.j + '-' + i;
        if (drawn[key]) continue;
        drawn[key] = 1;
        b = points[c.j];
        var lbx = b.x + b.ox, lby = b.y + b.oy;
        var ld = Math.sqrt(c.d2);
        var t = 1 - ld / LINK_D;
        var sizeBoost = (p.sizeClass + b.sizeClass) * 0.18;
        ctx.strokeStyle = INK + (t * BASE_ALPHA).toFixed(3) + ')';
        ctx.lineWidth = 0.6 + t * 1.2 + sizeBoost;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(lbx, lby);
        ctx.stroke();
      }
    }

    // 3) Spotlight orange autour de la souris
    if (mouse.active) {
      var mouseR2 = MOUSE_R * MOUSE_R * 1.4;
      for (i = 0; i < points.length; i++) {
        p = points[i];
        var sax = p.x + p.ox, say = p.y + p.oy;
        var mdx = sax - mouse.x, mdy = say - mouse.y;
        if (mdx * mdx + mdy * mdy > mouseR2) continue;
        for (j = i + 1; j < points.length; j++) {
          b = points[j];
          var sbx = b.x + b.ox, sby = b.y + b.oy;
          var sdx = sax - sbx, sdy = say - sby;
          var sd2 = sdx * sdx + sdy * sdy;
          if (sd2 < LINK_D2) {
            var sd = Math.sqrt(sd2);
            var st = 1 - sd / LINK_D;
            var md = Math.sqrt(mdx * mdx + mdy * mdy);
            var mt = Math.max(0, 1 - md / MOUSE_R);
            var sBoost = (p.sizeClass + b.sizeClass) * 0.25;
            ctx.strokeStyle = ACCENT + (st * mt * 0.85).toFixed(3) + ')';
            ctx.lineWidth = 1.0 + st * 1.4 + sBoost;
            ctx.beginPath();
            ctx.moveTo(sax, say);
            ctx.lineTo(sbx, sby);
            ctx.stroke();
          }
        }
      }
    }

    // 4) Points + halo doux pour les hubs (sizeClass 2)
    for (i = 0; i < points.length; i++) {
      p = points[i];
      var nx = p.x + p.ox, ny = p.y + p.oy;
      var fill, halo = null;
      if (mouse.active) {
        var ndx = nx - mouse.x, ndy = ny - mouse.y;
        var nmd = Math.sqrt(ndx * ndx + ndy * ndy);
        var nmt = Math.max(0, 1 - nmd / MOUSE_R);
        if (nmt > 0.05) {
          fill = ACCENT + (0.65 + nmt * 0.35).toFixed(3) + ')';
          if (p.sizeClass === 2) halo = ACCENT + (0.18 + nmt * 0.2).toFixed(3) + ')';
        } else {
          fill = INK + '0.46)';
          if (p.sizeClass === 2) halo = ACCENT + '0.14)';
        }
      } else {
        fill = INK + '0.42)';
        if (p.sizeClass === 2) halo = ACCENT + '0.12)';
      }
      if (halo) {
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(nx, ny, p.r * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(nx, ny, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function onMove(e) {
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.active = true;
  }
  function onLeave() {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  }
  function onTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    var rect = canvas.getBoundingClientRect();
    mouse.x = e.touches[0].clientX - rect.left;
    mouse.y = e.touches[0].clientY - rect.top;
    mouse.active = true;
  }
  function onTouchEnd() { onLeave(); }

  function start() {
    resize();
    if (reduce) {
      requestAnimationFrame(function () { frame(); cancelAnimationFrame(raf); });
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { resize(); });
    ro.observe(canvas);
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
      raf = requestAnimationFrame(frame);
    }
  });

  start();
})();
