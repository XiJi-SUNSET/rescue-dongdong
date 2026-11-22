/* Frozen pause map. Pure renderer: every mark comes from an engine.pauseSnapshot(). */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ORBIT = { azimuth: .72, elevation: .6, minElevation: .16, maxElevation: 1.32 };
  const COLOURS = ['#dff4ff', '#b9e4f2', '#9ecfe4', '#c9e9f0', '#aed9e6'];
  const distanceText = metres => {
    const n = Number(metres);
    return Number.isFinite(n) ? (n >= 1000 ? (n / 1000).toFixed(1) + ' km' : Math.round(n) + ' m') : '—';
  };
  const shortDistance = metres => {
    const n = Number(metres);
    if (!Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1000) return +(n / 1000).toFixed(a % 1000 ? 1 : 0) + ' km';
    return Math.round(n) + ' m';
  };
  const niceStep = value => {
    const safe = Math.max(1e-9, Number(value) || 1), power = 10 ** Math.floor(Math.log10(safe)), n = safe / power;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * power;
  };
  // Strata "coastlines": every harmonic vanishes at angle 0, so the labelled
  // distances stay exact on the +X route axis while the ground reads as terrain.
  const strataWave = {
    start: a => .06 * Math.sin(a) + .05 * Math.sin(3 * a) - .03 * Math.sin(5 * a) + .016 * Math.sin(9 * a) + .022 * (Math.cos(4 * a) - 1) + .012 * (Math.cos(7 * a) - 1),
    blue: a => .065 * Math.sin(a) + .03 * Math.sin(2 * a) + .058 * Math.sin(3 * a) + .03 * Math.sin(7 * a) - .016 * Math.sin(11 * a) + .026 * (Math.cos(5 * a) - 1) + .015 * (Math.cos(9 * a) - 1),
    inner: a => .06 * Math.sin(a) - .028 * Math.sin(2 * a) + .06 * Math.sin(3 * a) - .033 * Math.sin(5 * a) + .02 * Math.sin(13 * a) + .024 * (Math.cos(4 * a) - 1) + .014 * (Math.cos(9 * a) - 1)
  };

  function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  function unit3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  class PauseMapView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.w = 0; this.h = 0; this.dpr = 1;
      this.snapshot = null; this.focus = null; this.painting = false;
      this.mode = 'plane'; this.range = 'local'; this.lastStats = {};
      this.sprites = null;
      this.view = { zoom: 1, panX: 0, panY: 0 };
      this.orbit = { azimuth: ORBIT.azimuth, elevation: ORBIT.elevation };
      this.drag = null;
      this.pointers = new Map();
      this.pinch = null;
      this.tap = null;
      this.lastTap = null;
      this.bindInput();
    }

    limits() {
      return this.mode === 'scatter'
        ? { min: .5, max: 4, baseX: this.w * .535, baseY: this.h * .515 }
        : { min: .006, max: 6, baseX: this.w * .5, baseY: this.h * .5 };
    }

    gridStep(scale) { return niceStep(56 / scale); }
    scaleStep(scale) { return niceStep(110 / scale); }

    resetOrbit() {
      this.orbit.azimuth = ORBIT.azimuth; this.orbit.elevation = ORBIT.elevation;
    }

    setRange(range, redraw = true) {
      const next = range === 'field' ? 'field' : 'local';
      if (next === this.range) return false;
      this.range = next;
      this.view.zoom = 1; this.view.panX = 0; this.view.panY = 0;
      this.resetOrbit();
      if (redraw && this.snapshot) this.draw(this.snapshot, this.focus);
      return true;
    }

    resetView() {
      this.view.zoom = 1; this.view.panX = 0; this.view.panY = 0;
      this.resetOrbit();
      if (this.snapshot) this.draw(this.snapshot, this.focus);
    }

    resetInput() {
      this.drag = null;
      this.pointers.clear();
      this.pinch = null;
      this.tap = null;
      this.lastTap = null;
    }

    zoomAt(x, y, factor) {
      const lim = this.limits(), zoom = clamp(this.view.zoom * factor, lim.min, lim.max);
      const ratio = zoom / this.view.zoom;
      if (Math.abs(ratio - 1) < 1e-9) return;
      // The scatter view is an orbit rig: zoom about its own centre and never
      // translate, otherwise dragging reads as a pan instead of a turn.
      if (this.mode !== 'scatter') {
        this.view.panX += (x - (lim.baseX + this.view.panX)) * (1 - ratio);
        this.view.panY += (y - (lim.baseY + this.view.panY)) * (1 - ratio);
      }
      this.view.zoom = zoom;
      if (this.snapshot) this.draw(this.snapshot, this.focus);
    }

    bindInput() {
      const canvas = this.canvas, host = canvas.closest('.pause-map');
      const local = event => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: (event.clientX - rect.left) * (this.w / Math.max(1, rect.width)),
          y: (event.clientY - rect.top) * (this.h / Math.max(1, rect.height))
        };
      };
      const pinchPoints = () => {
        const points = [...this.pointers.values()], a = points[0], b = points[1];
        return {
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          distance: Math.hypot(a.x - b.x, a.y - b.y)
        };
      };
      const endDrag = event => {
        const id = event?.pointerId;
        if (id !== undefined) this.pointers.delete(id);
        if (this.pinch && this.pointers.size < 2) this.pinch = null;
        if (!this.drag || (event && id !== this.drag.id)) return;
        const tap = this.tap;
        this.drag = null;
        if (host) host.classList.remove('dragging');
        // touch-action:none suppresses the browser's dblclick, so a two-tap
        // reset has to be recognised from the pointer stream itself.
        if (tap && event && event.pointerType === 'touch' && id === tap.id &&
          !tap.moved && performance.now() - tap.time < 320) {
          const now = performance.now();
          if (this.lastTap && now - this.lastTap.time < 360 &&
            Math.hypot(tap.x - this.lastTap.x, tap.y - this.lastTap.y) < 34) {
            this.lastTap = null;
            this.resetView();
          } else {
            this.lastTap = { x: tap.x, y: tap.y, time: now };
          }
        }
        if (event?.pointerType !== 'touch') { this.tap = null; this.lastTap = null; }
      };
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !this.snapshot) return;
        event.preventDefault();
        const p = local(event);
        this.pointers.set(event.pointerId, p);
        try { canvas.setPointerCapture(event.pointerId); } catch {}
        if (this.pointers.size === 2) {
          const centre = pinchPoints();
          this.pinch = { ...centre };
          this.drag = null;
          this.tap = null;
          if (host) host.classList.remove('dragging');
          return;
        }
        if (this.pointers.size > 2) return;
        this.drag = {
          id: event.pointerId, x: p.x, y: p.y,
          panX: this.view.panX, panY: this.view.panY,
          azimuth: this.orbit.azimuth, elevation: this.orbit.elevation
        };
        this.tap = { id: event.pointerId, x: p.x, y: p.y, time: performance.now(), moved: false };
        if (host) host.classList.add('dragging');
      });
      root.addEventListener('pointermove', event => {
        if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, local(event));
        if (this.pinch) {
          if (this.pointers.size < 2) { this.pinch = null; return; }
          const next = pinchPoints();
          if (this.pinch.distance > 1 && next.distance > 0) {
            this.zoomAt(next.x, next.y, next.distance / this.pinch.distance);
          }
          this.pinch = next;
          return;
        }
        if (!this.drag || event.pointerId !== this.drag.id) return;
        const p = local(event);
        if (this.tap && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) > 8) this.tap.moved = true;
        if (this.mode === 'scatter') {
          this.orbit.azimuth = this.drag.azimuth + (p.x - this.drag.x) * .0062;
          this.orbit.elevation = clamp(
            this.drag.elevation - (p.y - this.drag.y) * .0048,
            ORBIT.minElevation, ORBIT.maxElevation
          );
        } else {
          this.view.panX = clamp(this.drag.panX + p.x - this.drag.x, -this.w * 4, this.w * 4);
          this.view.panY = clamp(this.drag.panY + p.y - this.drag.y, -this.h * 4, this.h * 4);
        }
        if (this.snapshot) this.draw(this.snapshot, this.focus);
      });
      root.addEventListener('pointerup', endDrag);
      root.addEventListener('pointercancel', endDrag);
      canvas.addEventListener('wheel', event => {
        if (!this.snapshot || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
        event.preventDefault(); event.stopPropagation();
        const p = local(event);
        this.zoomAt(p.x, p.y, Math.exp(-event.deltaY * .0015));
      }, { passive: false });
      canvas.addEventListener('dblclick', event => {
        event.preventDefault();
        this.resetView();
      });
    }

    makeSprites() {
      if (this.sprites || typeof document === 'undefined') return this.sprites;
      const sprite = rgb => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d'), g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, `rgba(${rgb},1)`);
        g.addColorStop(.34, `rgba(${rgb},.95)`);
        g.addColorStop(.62, `rgba(${rgb},.48)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
        return canvas;
      };
      this.sprites = { wave: sprite('192,231,246'), hole: sprite('245,253,255'), warm: sprite('255,166,142') };
      return this.sprites;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      // clientWidth/Height ignore the entry scale transform; rect does not.
      const w = Math.max(320, Math.round(this.canvas.clientWidth || rect.width || root.innerWidth || 1440));
      const h = Math.max(240, Math.round(this.canvas.clientHeight || rect.height || root.innerHeight || 900));
      const dpr = clamp(root.devicePixelRatio || 1, 1, 2);
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      if (this.snapshot && !this.painting) this.draw(this.snapshot, this.focus);
    }

    draw(snapshot, focus) {
      if (!snapshot) return;
      this.snapshot = snapshot; this.focus = focus || null;
      this.painting = true;
      this.resize();
      this.painting = false;
      const ctx = this.ctx, W = this.w, H = this.h;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (snapshot.stage === 'five' && Array.isArray(snapshot.shells)) {
        this.mode = 'scatter';
        if (this.range === 'field') this.drawFieldScatter(snapshot, focus, W, H);
        else this.drawScatter(snapshot, focus, W, H);
        return;
      }
      this.mode = 'plane';
      this.lastStats = {
        mode: this.mode, waves: (snapshot.waves || []).length,
        fieldWaves: (snapshot.fieldWaves || []).length,
        holes: (snapshot.holes || []).length,
        geology: snapshot.geology ? snapshot.geology.current : null
      };

      const centre = snapshot.centre || [0, 0, 0];
      const planeY = Number(snapshot.planeY) || 0;
      const radius = Math.max(24, Number(snapshot.radius) || 80);
      const scale = Math.min(W, H) * .42 / radius * this.view.zoom;
      const cx = W * .5 + this.view.panX, cy = H * .5 + this.view.panY;
      const sx = x => cx + (x - centre[0]) * scale;
      const sy = z => cy + (z - centre[2]) * scale;

      this.paintBackdrop(ctx, W, H, radius, scale, cx, cy);
      this.paintGeology(ctx, snapshot, sx, sy, scale, W, H);
      this.paintGrid(ctx, W, H, scale, centre, cx, cy);
      this.paintRoute(ctx, snapshot, sx, sy);
      this.paintWaves(ctx, snapshot, planeY, sx, sy, scale, W, H);
      this.paintHoles(ctx, snapshot, planeY, sx, sy, scale, W, H);
      const targets = this.paintTargets(ctx, snapshot, sx, sy, W, H, cx, cy);
      this.paintFocus(ctx, focus, planeY, sx, sy);
      this.paintScale(ctx, W, H, scale);
      this.paintScanState(ctx, snapshot, W, H);
      this.lastStats = {
        ...this.lastStats, holeCount: (snapshot.holes || []).length,
        view: { zoom: +this.view.zoom.toFixed(4), panX: +this.view.panX.toFixed(2), panY: +this.view.panY.toFixed(2), scale: +scale.toFixed(5) },
        grid: this.lastGrid, scaleBar: this.lastScaleBar, strata: this.lastGeology || null,
        goal: targets.goal, rec: targets.rec
      };
    }

    drawScatter(snapshot, focus, W, H) {
      const started = root.performance?.now?.() ?? Date.now();
      // Orbit only: a pan left over from the plane map must never leak in.
      this.view.panX = 0; this.view.panY = 0;
      const ctx = this.ctx, centre = snapshot.centre || [0, 0, 0];
      const survey = Math.max(40, Number(snapshot.radius) || 80);
      const planeY = Number.isFinite(snapshot.planeY) ? snapshot.planeY : centre[1] || 0;
      const yaw = Number(focus && focus.yaw) || 0;
      // Orbiting survey camera. It never turns with the player or aim, only
      // with the drag gesture, so opening the map keeps the same world axes.
      const azimuth = this.orbit.azimuth;
      const elevation = clamp(this.orbit.elevation, ORBIT.minElevation, ORBIT.maxElevation);
      const fov = 42 * Math.PI / 180, dist = survey * 2.05;
      const cosE = Math.cos(elevation), sinE = Math.sin(elevation);
      const cam = [
        centre[0] + Math.sin(azimuth) * cosE * dist,
        centre[1] + sinE * dist,
        centre[2] + Math.cos(azimuth) * cosE * dist
      ];
      const view = unit3([centre[0] - cam[0], centre[1] - cam[1], centre[2] - cam[2]]);
      const screenRight = unit3(cross3(view, [0, 1, 0])), screenUp = cross3(screenRight, view);
      const focal = (H * .5) / Math.tan(fov / 2) * this.view.zoom;
      const cx = W * .535, cy = H * .515;
      const project = point => {
        const rx = point[0] - cam[0], ry = point[1] - cam[1], rz = point[2] - cam[2];
        const z = rx * view[0] + ry * view[1] + rz * view[2];
        if (z <= .6) return null;
        const inv = focal / z;
        return [cx + (rx * screenRight[0] + ry * screenRight[1] + rz * screenRight[2]) * inv,
          cy - (rx * screenUp[0] + ry * screenUp[1] + rz * screenUp[2]) * inv, z];
      };

      ctx.fillStyle = '#020609'; ctx.fillRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * .62);
      bg.addColorStop(0, 'rgba(24,55,71,.22)');
      bg.addColorStop(.56, 'rgba(6,20,29,.12)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      this.paintScatterGround(ctx, project, centre, planeY, survey);
      this.paintScatterSources(ctx, snapshot.scan, project, centre, survey, W, H);

      const holes = snapshot.holes || [], shells = snapshot.shells || [];
      const plans = [];
      for (const shell of shells) {
        const r = Number(shell.radius), source = shell.source || [0, 0, 0];
        if (!(r > 0)) continue;
        const d = Number.isFinite(shell.distance) ? shell.distance : distance(source, centre);
        let cosA = -1, whole = false;
        if (d < 1e-6) {
          if (r > survey + 1e-6) continue;
          whole = true;
        } else if (d < survey && r <= survey - d) whole = true;
        else {
          cosA = (r * r + d * d - survey * survey) / (2 * r * d);
          if (!(cosA < 1) || cosA < -1) continue;
        }
        const area = whole ? 4 * Math.PI * r * r : 2 * Math.PI * r * r * (1 - cosA);
        if (area < 16) continue;
        const n = d < 1e-6 ? [0, 1, 0] : unit3([centre[0] - source[0], centre[1] - source[1], centre[2] - source[2]]);
        const helper = Math.abs(n[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
        const u = unit3(cross3(n, helper)), v = cross3(n, u);
        plans.push({
          source, radius: r, distance: d, bell: Number(shell.bell) || 0, cycle: Number(shell.cycle) || 0,
          cosA, whole, n, u, v,
          count: Math.round(clamp(area / 2.6, 320, 9000))
        });
      }
      // The shells are the atmosphere of this map, so spend real pixels on
      // them: a phone-sized canvas keeps ~9k grains, a desktop ~30k.
      const requested = plans.reduce((n, plan) => n + plan.count, 0);
      const budget = Math.round(clamp(W * H / 42, 9000, 32000));
      const density = requested > budget ? budget / requested : 1;
      // The front nearest the player is the readable one: the newest shell is
      // often already outside the survey bubble. Every bell therefore keeps
      // the crossing closest to you, with a faint trace of the rest.
      // Show the next incoming front per bell, not merely the nearest shell:
      // a front that has just passed is not what you need to dodge. If no
      // front is still outside the player, fall back to the nearest one.
      const bellFront = new Map();
      for (const plan of plans) {
        plan.danger = holes.some(hole => Math.abs(plan.radius - distance(plan.source, hole.point)) <= (hole.radius || snapshot.holeRadius || 1.4) + .08);
        const prev = bellFront.get(plan.bell);
        const incoming = plan.radius <= plan.distance + 1e-6;
        if (!prev) { bellFront.set(plan.bell, plan); continue; }
        const prevIncoming = prev.radius <= prev.distance + 1e-6;
        if (incoming && !prevIncoming) bellFront.set(plan.bell, plan);
        else if (incoming && prevIncoming && plan.radius > prev.radius) bellFront.set(plan.bell, plan);
        else if (!incoming && !prevIncoming && Math.abs(plan.radius - plan.distance) < Math.abs(prev.radius - prev.distance)) bellFront.set(plan.bell, plan);
      }
      for (const plan of plans) plan.main = bellFront.get(plan.bell) === plan;
      const sprites = this.makeSprites();
      const buckets = new Map();
      let wavePoints = 0, minDepth = Infinity, maxDepth = 0;
      for (const plan of plans) {
        const count = Math.max(140, Math.round(plan.count * density));
        const rand = seeded(((plan.bell + 1) * 73856093) ^ ((plan.cycle + 100000) * 19349663) ^ Math.round(snapshot.time * 997));
        const source = plan.source, r = plan.radius;
        for (let i = 0; i < count; i++) {
          const cosT = plan.cosA + (1 - plan.cosA) * rand(), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), phi = TAU * rand();
          const cp = Math.cos(phi), sp = Math.sin(phi);
          const dx = plan.n[0] * cosT + (plan.u[0] * cp + plan.v[0] * sp) * sinT;
          const dy = plan.n[1] * cosT + (plan.u[1] * cp + plan.v[1] * sp) * sinT;
          const dz = plan.n[2] * cosT + (plan.u[2] * cp + plan.v[2] * sp) * sinT;
          const px = source[0] + dx * r, py = source[1] + dy * r, pz = source[2] + dz * r;
          const ox = px - centre[0], oy = py - centre[1], oz = pz - centre[2];
          if (ox * ox + oy * oy + oz * oz > (survey + .8) ** 2) continue;
          const q = project([px, py, pz]);
          if (!q || q[0] < -12 || q[0] > W + 12 || q[1] < -12 || q[1] > H + 12) continue;
          const t = clamp((q[2] - (dist - survey)) / (survey * 2), 0, 1);
          const nx = (px - source[0]) / r, ny = (py - source[1]) / r, nz = (pz - source[2]) / r;
          const grazing = Math.pow(clamp(1 - Math.abs(nx * view[0] + ny * view[1] + nz * view[2]), 0, 1), 2);
          // The volume stipple is texture, not the message. Keep it dim so the
          // five plane arcs stay the thing you read; shells already beyond the
          // survey bubble must not sparkle like a starfield.
          let size = (1.1 + rand() * 1.45) * (1.14 - .2 * t) * (1 + grazing * .85);
          if (plan.main && rand() > .985) size += 2;
          size = clamp(size * (plan.main ? 1.08 : .86), .9, plan.main ? 4.6 : 3);
          const alpha = clamp((.12 + .25 * Math.pow(1 - t, 1.25) + .34 * grazing * (.55 + .45 * (1 - t))) * (plan.main ? 1 : .6), .06, .52);
          const ai = Math.round(alpha * 20), si = Math.round(size * 2), key = ai * 100 + si;
          let bucket = buckets.get(key);
          if (!bucket) { bucket = { alpha: ai / 20, size: si / 2, points: [] }; buckets.set(key, bucket); }
          bucket.points.push(q[0], q[1]);
          wavePoints++; minDepth = Math.min(minDepth, q[2]); maxDepth = Math.max(maxDepth, q[2]);
        }
      }
      if (sprites) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const bucket of buckets.values()) {
          ctx.globalAlpha = bucket.alpha;
          const size = bucket.size;
          for (let i = 0; i < bucket.points.length; i += 2) ctx.drawImage(sprites.wave, bucket.points[i] - size / 2, bucket.points[i + 1] - size / 2, size, size);
        }
        ctx.restore();
      }
      const shellStats = this.paintScatterShells(ctx, plans, project, centre, survey, planeY, W, H);

      const holeMarks = [];
      for (const hole of holes) {
        const q = project(hole.point);
        if (!q || q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) continue;
        const [x, y, z] = q, isB = hole.kind === 'B', isA = hole.kind === 'A';
        const danger = shells.some(shell => Math.abs(shell.radius - distance(shell.source, hole.point)) <= (hole.radius || snapshot.holeRadius || 1.4) + .08);
        const glow = (isB ? 28 : 23) + clamp((dist + survey - z) / (survey * 2), 0, 1) * 8;
        if (sprites) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = danger ? .28 : .2;
          ctx.drawImage(sprites.warm, x - glow * .7, y - glow * .7, glow * 1.4, glow * 1.4);
          ctx.globalAlpha = .42;
          ctx.drawImage(sprites.hole, x - glow / 2, y - glow / 2, glow, glow);
          ctx.restore();
        }
        const core = isB ? 3.4 : isA ? 2.8 : 2.4;
        ctx.save();
        ctx.fillStyle = '#fff'; ctx.shadowColor = danger ? 'rgba(255,189,169,.95)' : 'rgba(221,248,255,.9)'; ctx.shadowBlur = 7;
        ctx.beginPath(); ctx.arc(x, y, core, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(226,245,251,.78)'; ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.fillText(isB ? 'B' : isA ? 'A' : '旧', x + 7, y - 6);
        ctx.restore();
        holeMarks.push({ kind: hole.kind, x, y, depth: z, core, danger });
      }

      const targetAt = point => {
        const q = project(point);
        if (q) {
          const onScreen = q[0] >= 18 && q[0] <= W - 18 && q[1] >= 18 && q[1] <= H - 18;
          return { x: q[0], y: q[1], onScreen };
        }
        const dx = point[0] - cam[0], dy = point[1] - cam[1], dz = point[2] - cam[2];
        const rx = dx * screenRight[0] + dy * screenRight[1] + dz * screenRight[2];
        const ry = dx * screenUp[0] + dy * screenUp[1] + dz * screenUp[2];
        const len = Math.hypot(rx, ry) || 1;
        return { x: cx + rx / len * 1e5, y: cy - ry / len * 1e5, onScreen: false };
      };
      let goalMark = null, recMark = null;
      if (snapshot.goal && Array.isArray(snapshot.goal.point)) {
        const goal = snapshot.goal, at = targetAt(goal.point);
        if (at.onScreen) this.paintGoal(ctx, at.x, at.y, goal.distance, false, 0, W);
        else {
          const edge = this.edgePoint(W, H, cx, cy, at.x, at.y, 34);
          this.paintGoal(ctx, edge.x, edge.y, goal.distance, true, edge.angle, W);
          at.x = edge.x; at.y = edge.y;
        }
        goalMark = { point: goal.point.slice(), distance: +Number(goal.distance).toFixed(1), x: +at.x.toFixed(2), y: +at.y.toFixed(2), onScreen: at.onScreen, edge: !at.onScreen };
      }
      if (snapshot.rec && Array.isArray(snapshot.rec.point)) {
        const rec = snapshot.rec, at = targetAt(rec.point);
        if (at.onScreen) this.paintRecommendation(ctx, at.x, at.y, rec, false, 0, W);
        else {
          const edge = this.edgePoint(W, H, cx, cy, at.x, at.y, 34);
          this.paintRecommendation(ctx, edge.x, edge.y, rec, true, edge.angle, W);
          at.x = edge.x; at.y = edge.y;
        }
        recMark = { point: rec.point.slice(), distance: +Number(rec.distance).toFixed(1), go: rec.go, nextB: rec.nextB, x: +at.x.toFixed(2), y: +at.y.toFixed(2), onScreen: at.onScreen, edge: !at.onScreen };
      }

      const player = project(centre), ahead = project([centre[0] + Math.sin(yaw) * 12, centre[1], centre[2] - Math.cos(yaw) * 12]);
      if (player) {
        ctx.save();
        ctx.strokeStyle = 'rgba(235,250,255,.62)'; ctx.fillStyle = 'rgba(235,250,255,.9)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(player[0], player[1], 4.4, 0, TAU); ctx.stroke();
        if (ahead) { ctx.beginPath(); ctx.moveTo(player[0], player[1]); ctx.lineTo(ahead[0], ahead[1]); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(player[0], player[1], 1.3, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(201,230,240,.55)'; ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.fillText('你', player[0] + 7, player[1] + 14);
        ctx.restore();
      }
      this.paintScatterBellRail(ctx, shellStats.fronts, snapshot.scan, W, H);

      this.lastStats = {
        mode: 'scatter', surveyRadius: survey, shells: shells.length, sampledShells: plans.length,
        wavePoints, targetPoints: Math.round(requested * density), holes: holeMarks, holeCount: holes.length,
        view: { zoom: +this.view.zoom.toFixed(4), panX: +this.view.panX.toFixed(2), panY: +this.view.panY.toFixed(2), focal: +focal.toFixed(2) },
        goal: goalMark, rec: recMark,
        fronts: [...bellFront.values()].map(plan => ({
          bell: plan.bell + 1, radius: +plan.radius.toFixed(1),
          gap: plan.front ? +plan.front.gap.toFixed(1) : null,
          onPlane: !!(plan.front && plan.front.onPlane),
          main: true, danger: plan.danger
        })),
        shellsDrawn: shellStats.meshes, planeRings: shellStats.arcs, dangerShells: shellStats.danger,
        depth: { min: Number.isFinite(minDepth) ? +minDepth.toFixed(2) : null, max: +maxDepth.toFixed(2) },
        camera: {
          position: cam.map(v => +v.toFixed(2)), distance: +dist.toFixed(2),
          fov: +(fov * 180 / Math.PI).toFixed(1), yaw: +yaw.toFixed(4),
          azimuth: +azimuth.toFixed(4), elevation: +elevation.toFixed(4),
          fixed: true, orbit: 'drag'
        },
        drawMs: +((root.performance?.now?.() ?? Date.now()) - started).toFixed(1)
      };
    }

    fieldProfile(snapshot) {
      const centre = snapshot.centre || [0, 0, 0];
      const field = snapshot.field && Array.isArray(snapshot.field.point) ? snapshot.field : null;
      const fieldPoint = field ? field.point.slice() : [0, 0, 0];
      const claimed = Number(field && field.radius) || Number(snapshot.fieldRadius) || 15000;
      const fieldRadius = Math.max(600, claimed);
      const planeY = Number.isFinite(snapshot.planeY) ? snapshot.planeY : centre[1] || 0;
      const waves = snapshot.fieldWaves && snapshot.fieldWaves.length ? snapshot.fieldWaves : (snapshot.waves || []);
      const bells = snapshot.scan && Array.isArray(snapshot.scan.bells) ? snapshot.scan.bells : [];
      const shells = snapshot.shells || [];
      const holes = snapshot.holes || [];
      const playerR = Math.hypot(centre[0] - fieldPoint[0], centre[2] - fieldPoint[2]);
      let extent = Math.max(520, playerR + 220);
      for (const wave of waves) {
        if (!Array.isArray(wave.source)) continue;
        extent = Math.max(extent, Math.hypot(wave.source[0] - fieldPoint[0], wave.source[2] - fieldPoint[2]) + (Number(wave.radius) || 0));
      }
      for (const shell of shells) {
        if (!Array.isArray(shell.source)) continue;
        extent = Math.max(extent, Math.hypot(shell.source[0] - fieldPoint[0], shell.source[2] - fieldPoint[2]) + (Number(shell.radius) || 0));
      }
      for (const bell of bells) {
        if (!bell || !Array.isArray(bell.p)) continue;
        extent = Math.max(extent, Math.hypot(bell.p[0] - fieldPoint[0], bell.p[2] - fieldPoint[2]) + 180);
      }
      for (const hole of holes) {
        if (!Array.isArray(hole.point)) continue;
        extent = Math.max(extent, Math.hypot(hole.point[0] - fieldPoint[0], hole.point[2] - fieldPoint[2]) + 80);
      }
      if (snapshot.rec && Array.isArray(snapshot.rec.point)) {
        extent = Math.max(extent, Math.hypot(snapshot.rec.point[0] - fieldPoint[0], snapshot.rec.point[2] - fieldPoint[2]) + 120);
      }
      const frameRadius = clamp(extent * 1.04, 600, fieldRadius);
      return {
        centre, fieldPoint, fieldRadius, frameRadius, planeY, waves, bells, holes, playerR,
        scan: snapshot.scan || null, time: Number(snapshot.time) || 0,
        bands: snapshot.geology && Array.isArray(snapshot.geology.bands) ? snapshot.geology.bands : []
      };
    }

    // The full view still needs a readable "next front" per bell. fieldWaves
    // carries every real cycle inside the sensing field, so the nearest
    // still-outside sphere is derived by its true 3D gap to the player.
    fieldFronts(profile, snapshot) {
      const holes = snapshot.holes || [];
      const plans = [];
      for (const wave of profile.waves) {
        const source = wave.source, radius = Number(wave.radius);
        if (!Array.isArray(source) || !(radius > 0)) continue;
        const toPlayer = distance(source, profile.centre);
        const gap = toPlayer - radius;
        const danger = holes.some(hole => Array.isArray(hole.point) && Math.abs(radius - distance(source, hole.point)) <= (hole.radius || snapshot.holeRadius || 1.4) + .08);
        plans.push({
          source, radius, bell: Number(wave.bell) || 0, cycle: Number(wave.cycle) || 0,
          distance: toPlayer, gap, danger, front: { gap }
        });
      }
      const mains = new Map();
      for (const plan of plans) {
        const prev = mains.get(plan.bell);
        if (!prev) { mains.set(plan.bell, plan); continue; }
        const incoming = plan.gap >= 0, prevIncoming = prev.gap >= 0;
        if (incoming && !prevIncoming) mains.set(plan.bell, plan);
        else if (incoming && prevIncoming && plan.gap < prev.gap) mains.set(plan.bell, plan);
        else if (!incoming && !prevIncoming && plan.gap > prev.gap) mains.set(plan.bell, plan);
      }
      for (const plan of mains.values()) { plan.main = true; plan.front = { gap: plan.gap }; }
      return { plans, mains: [...mains.values()].sort((a, b) => a.bell - b.bell) };
    }

    drawFieldScatter(snapshot, focus, W, H) {
      const started = root.performance?.now?.() ?? Date.now();
      this.view.panX = 0; this.view.panY = 0;
      const ctx = this.ctx, profile = this.fieldProfile(snapshot);
      const centre = profile.centre, fieldPoint = profile.fieldPoint, planeY = profile.planeY;
      const yaw = Number(focus && focus.yaw) || 0;
      const azimuth = this.orbit.azimuth;
      const elevation = clamp(this.orbit.elevation, ORBIT.minElevation, ORBIT.maxElevation);
      const fov = 42 * Math.PI / 180;
      const baseFocal = (H * .5) / Math.tan(fov / 2);
      // Fit the near rim of the ground disc, not merely its pivot: at a low
      // orbit the near rim is what would otherwise run off the screen.
      const fitPx = Math.max(120, Math.min(H * .42, W * .42));
      const cosE = Math.cos(elevation), sinE = Math.sin(elevation);
      const dist = profile.frameRadius * (cosE + baseFocal / fitPx);
      const focal = baseFocal * this.view.zoom;
      const pivot = [fieldPoint[0], planeY, fieldPoint[2]];
      const cam = [
        pivot[0] + Math.sin(azimuth) * cosE * dist,
        pivot[1] + sinE * dist,
        pivot[2] + Math.cos(azimuth) * cosE * dist
      ];
      const view = unit3([pivot[0] - cam[0], pivot[1] - cam[1], pivot[2] - cam[2]]);
      const screenRight = unit3(cross3(view, [0, 1, 0])), screenUp = cross3(screenRight, view);
      const cx = W * .535, cy = H * .515;
      const project = point => {
        const rx = point[0] - cam[0], ry = point[1] - cam[1], rz = point[2] - cam[2];
        const z = rx * view[0] + ry * view[1] + rz * view[2];
        if (z <= .6) return null;
        const inv = focal / z;
        return [cx + (rx * screenRight[0] + ry * screenRight[1] + rz * screenRight[2]) * inv,
          cy - (rx * screenUp[0] + ry * screenUp[1] + rz * screenUp[2]) * inv, z];
      };
      const scale = focal / dist;

      ctx.fillStyle = '#020609'; ctx.fillRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * .66);
      bg.addColorStop(0, 'rgba(24,55,71,.2)');
      bg.addColorStop(.56, 'rgba(6,20,29,.1)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      const fronts = this.fieldFronts(profile, snapshot);
      this.paintFieldGround(ctx, profile, project, W, H);
      const shellStats = this.paintFieldShells(ctx, fronts.mains, profile, project, cam, W, H);
      const waveStats = this.paintFieldWaves(ctx, profile, fronts, project, scale);
      this.paintFieldSources(ctx, profile, project, W, H);
      this.paintFieldRoute(ctx, snapshot, project);
      const holeMarks = this.paintFieldHoles(ctx, snapshot, fronts.plans, project, W, H);

      const targetAt = point => {
        const q = project(point);
        if (q) {
          const onScreen = q[0] >= 18 && q[0] <= W - 18 && q[1] >= 18 && q[1] <= H - 18;
          return { x: q[0], y: q[1], onScreen };
        }
        const dx = point[0] - cam[0], dy = point[1] - cam[1], dz = point[2] - cam[2];
        const rx = dx * screenRight[0] + dy * screenRight[1] + dz * screenRight[2];
        const ry = dx * screenUp[0] + dy * screenUp[1] + dz * screenUp[2];
        const len = Math.hypot(rx, ry) || 1;
        return { x: cx + rx / len * 1e5, y: cy - ry / len * 1e5, onScreen: false };
      };
      let goalMark = null, recMark = null;
      if (snapshot.goal && Array.isArray(snapshot.goal.point)) {
        const goal = snapshot.goal, at = targetAt(goal.point);
        if (at.onScreen) this.paintGoal(ctx, at.x, at.y, goal.distance, false, 0, W);
        else {
          const edge = this.edgePoint(W, H, cx, cy, at.x, at.y, 34);
          this.paintGoal(ctx, edge.x, edge.y, goal.distance, true, edge.angle, W);
          at.x = edge.x; at.y = edge.y;
        }
        goalMark = { point: goal.point.slice(), distance: +Number(goal.distance).toFixed(1), x: +at.x.toFixed(2), y: +at.y.toFixed(2), onScreen: at.onScreen, edge: !at.onScreen };
      }
      if (snapshot.rec && Array.isArray(snapshot.rec.point)) {
        const rec = snapshot.rec, at = targetAt(rec.point);
        if (at.onScreen) this.paintRecommendation(ctx, at.x, at.y, rec, false, 0, W);
        else {
          const edge = this.edgePoint(W, H, cx, cy, at.x, at.y, 34);
          this.paintRecommendation(ctx, edge.x, edge.y, rec, true, edge.angle, W);
          at.x = edge.x; at.y = edge.y;
        }
        recMark = { point: rec.point.slice(), distance: +Number(rec.distance).toFixed(1), go: rec.go, nextB: rec.nextB, x: +at.x.toFixed(2), y: +at.y.toFixed(2), onScreen: at.onScreen, edge: !at.onScreen };
      }

      this.paintFieldPlayer(ctx, profile, focus, project, W, H);
      this.paintScatterBellRail(ctx, fronts.mains, snapshot.scan, W, H);
      this.paintScale(ctx, W, H, scale);

      this.lastStats = {
        mode: 'scatter', range: 'field',
        surveyRadius: Math.max(40, Number(snapshot.radius) || 190),
        frameRadius: +profile.frameRadius.toFixed(1), fieldRadius: profile.fieldRadius,
        fieldWaves: profile.waves.length, drawnWaves: waveStats.drawn, waveSample: waveStats.sample,
        shells: (snapshot.shells || []).length, sampledShells: fronts.mains.length,
        wavePoints: shellStats.points, targetPoints: shellStats.requested,
        centre: centre.slice(), fieldPoint: fieldPoint.slice(),
        holes: holeMarks, holeCount: (snapshot.holes || []).length,
        goal: goalMark, rec: recMark,
        fronts: fronts.mains.map(plan => ({
          bell: plan.bell + 1, radius: +plan.radius.toFixed(1), gap: +plan.gap.toFixed(1),
          distance: +plan.distance.toFixed(1), source: plan.source.slice(),
          main: true, danger: plan.danger
        })),
        shellsDrawn: fronts.mains.length, dangerShells: fronts.mains.filter(plan => plan.danger).length,
        depth: shellStats.depth,
        view: { zoom: +this.view.zoom.toFixed(4), panX: 0, panY: 0, focal: +focal.toFixed(2), scale: +scale.toFixed(6) },
        scaleBar: this.lastScaleBar,
        camera: {
          position: cam.map(v => +v.toFixed(2)), pivot: pivot.map(v => +v.toFixed(2)),
          distance: +dist.toFixed(2), fov: +(fov * 180 / Math.PI).toFixed(1), yaw: +yaw.toFixed(4),
          azimuth: +azimuth.toFixed(4), elevation: +elevation.toFixed(4),
          fixed: true, orbit: 'drag', range: 'field'
        },
        drawMs: +((root.performance?.now?.() ?? Date.now()) - started).toFixed(1)
      };
    }

    paintFieldGround(ctx, profile, project, W, H) {
      const { fieldPoint, fieldRadius, frameRadius, planeY } = profile;
      const at = (r, a) => project([fieldPoint[0] + Math.cos(a) * r, planeY, fieldPoint[2] + Math.sin(a) * r]);
      const trace = (r, steps) => {
        ctx.beginPath();
        let open = false;
        for (let i = 0; i <= steps; i++) {
          const q = at(r, i / steps * TAU);
          if (q) {
            if (open) ctx.lineTo(q[0], q[1]);
            else { ctx.moveTo(q[0], q[1]); open = true; }
          } else open = false;
        }
      };
      ctx.save();
      // A camera inside the 15 km field would cut the full disc into an
      // open polyline, and closePath fills that as a wedge across the view.
      // Fill only a plate that comfortably covers the framed field instead.
      const fillRadius = Math.min(fieldRadius, Math.max(frameRadius * 2.4, 900));
      trace(fillRadius, 192);
      ctx.closePath();
      ctx.fillStyle = 'rgba(9,24,33,.68)'; ctx.fill();
      if (fillRadius === fieldRadius && fieldRadius <= frameRadius * 1.015) {
        ctx.strokeStyle = 'rgba(138,192,210,.24)'; ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 8]); ctx.stroke(); ctx.setLineDash([]);
      }
      // Finite, evenly-spaced grid rings: enough to read scale without the
      // dense 100 m wave sequence turning into moire.
      const step = niceStep(frameRadius / 3.2);
      ctx.strokeStyle = 'rgba(130,190,210,.07)'; ctx.lineWidth = 1;
      for (let r = step; r <= frameRadius * 1.04; r += step) { trace(r, 144); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(130,190,210,.035)';
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU;
        const near = at(frameRadius * .1, a), far = at(frameRadius, a);
        if (near && far) { ctx.moveTo(near[0], near[1]); ctx.lineTo(far[0], far[1]); }
      }
      ctx.stroke();
      // Route axis: the player always starts on +X and the goal is the origin.
      const start = project([fieldPoint[0], planeY, fieldPoint[2]]);
      const axis = project([fieldPoint[0] + frameRadius * .96, planeY, fieldPoint[2]]);
      if (start && axis) {
        ctx.strokeStyle = 'rgba(220,242,250,.1)'; ctx.setLineDash([2, 8]);
        ctx.beginPath(); ctx.moveTo(start[0], start[1]); ctx.lineTo(axis[0], axis[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(205,235,245,.3)'; ctx.font = '8px ui-monospace, Consolas, monospace';
        ctx.fillText('路线 / +X', axis[0] + 6, axis[1] - 5);
      }
      // Strata only enter the frame late, when the wave field has grown.
      const bands = profile.bands || [];
      for (const band of bands) {
        const r = Number(band.from);
        if (!(r > 0) || r > frameRadius * 1.02) continue;
        ctx.strokeStyle = band.filler === 'blue' ? 'rgba(105,164,186,.16)' : 'rgba(184,104,80,.16)';
        ctx.lineWidth = 1; ctx.setLineDash([4, 10]); trace(r, 160); ctx.stroke(); ctx.setLineDash([]);
      }
      const origin = project([fieldPoint[0], planeY, fieldPoint[2]]);
      if (origin) {
        ctx.strokeStyle = 'rgba(193,235,247,.34)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(origin[0] - 5, origin[1]); ctx.lineTo(origin[0] + 5, origin[1]);
        ctx.moveTo(origin[0], origin[1] - 5); ctx.lineTo(origin[0], origin[1] + 5); ctx.stroke();
      }
      ctx.restore();
    }

    paintFieldSources(ctx, profile, project, W, H) {
      const bells = profile.bells;
      if (!bells.length) return;
      const anchors = [];
      bells.forEach((bell, i) => {
        if (!bell || !Array.isArray(bell.p)) return;
        const q = project(bell.p), ground = project([bell.p[0], profile.planeY, bell.p[2]]);
        if (!q) return;
        anchors.push({ i, q, ground });
      });
      if (!anchors.length) return;
      const centroid = project([profile.fieldPoint[0], profile.planeY, profile.fieldPoint[2]]) || [W * .535, H * .515];
      const boxes = [];
      ctx.save();
      for (const entry of anchors) {
        const { q, ground } = entry;
        if (ground) {
          ctx.strokeStyle = 'rgba(190,228,240,.16)'; ctx.setLineDash([1, 4]);
          ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(ground[0], ground[1]); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = 'rgba(230,249,255,.86)';
        ctx.beginPath(); ctx.arc(q[0], q[1], 2.1, 0, TAU); ctx.fill();
        let dx = q[0] - centroid[0], dy = q[1] - centroid[1], len = Math.hypot(dx, dy);
        if (len < .01) { const a = -Math.PI / 2 + entry.i * TAU / anchors.length; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
        dx /= len; dy /= len;
        let tx = q[0] + dx * 24, ty = q[1] + dy * 24;
        for (let guard = 0; guard < 8; guard++) {
          if (boxes.every(box => Math.abs(tx - box.x) > 24 || Math.abs(ty - box.y) > 21)) break;
          tx += dx * 13; ty += dy * 13;
        }
        tx = clamp(tx, 24, W - 50); ty = clamp(ty, 54, H - 52);
        boxes.push({ x: tx, y: ty });
        ctx.strokeStyle = 'rgba(207,242,252,.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = 'rgba(4,14,20,.9)'; ctx.strokeStyle = 'rgba(207,242,252,.7)';
        ctx.fillRect(tx - 8, ty - 8, 16, 16); ctx.strokeRect(tx - 7.5, ty - 7.5, 15, 15);
        ctx.fillStyle = 'rgba(233,250,255,.96)'; ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.fillText(String(entry.i + 1), tx, ty + 3); ctx.textAlign = 'start';
      }
      ctx.restore();
    }

    paintFieldShells(ctx, mains, profile, project, cam, W, H) {
      if (!mains.length) return { points: 0, requested: 0, depth: { min: null, max: 0 } };
      const sprites = this.makeSprites();
      const budget = Math.round(clamp(W * H / 46, 8000, 26000));
      const requested = mains.length * 4800;
      const density = requested > budget ? budget / requested : 1;
      const buckets = new Map();
      let points = 0, minDepth = Infinity, maxDepth = 0;
      for (const plan of mains) {
        const source = plan.source, r = plan.radius;
        const count = Math.max(700, Math.round(4800 * density));
        const rand = seeded(((plan.bell + 1) * 73856093) ^ ((plan.cycle + 100000) * 19349663) ^ Math.round(profile.time * 997));
        for (let i = 0; i < count; i++) {
          const cosT = -1 + 2 * rand(), sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT)), phi = TAU * rand();
          const px = source[0] + r * sinT * Math.cos(phi);
          const py = source[1] + r * cosT;
          const pz = source[2] + r * sinT * Math.sin(phi);
          const q = project([px, py, pz]);
          if (!q || q[0] < -12 || q[0] > W + 12 || q[1] < -12 || q[1] > H + 12) continue;
          const t = clamp((q[2] - (cam[2] - profile.frameRadius)) / (profile.frameRadius * 2), 0, 1);
          const nx = (px - source[0]) / r, ny = (py - source[1]) / r, nz = (pz - source[2]) / r;
          const grazing = Math.pow(clamp(1 - Math.abs(nx * Math.cos(this.orbit.azimuth) + nz * Math.sin(this.orbit.azimuth)), 0, 1), 2);
          let size = (1 + rand() * 1.35) * (1.12 - .16 * t) * (1 + grazing * .55);
          size = clamp(size * (plan.main ? 1.05 : .8), .8, 2.7);
          const alpha = clamp((.045 + .075 * Math.pow(1 - t, 1.2) + .1 * grazing * (.55 + .45 * (1 - t))) * (plan.danger ? 1.55 : 1), .025, .24);
          const ai = Math.round(alpha * 20), si = Math.round(size * 2), key = ai * 100 + si;
          let bucket = buckets.get(key);
          if (!bucket) { bucket = { alpha: ai / 20, size: si / 2, points: [] }; buckets.set(key, bucket); }
          bucket.points.push(q[0], q[1]);
          points++; minDepth = Math.min(minDepth, q[2]); maxDepth = Math.max(maxDepth, q[2]);
        }
      }
      if (sprites) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (const bucket of buckets.values()) {
          ctx.globalAlpha = bucket.alpha;
          const size = bucket.size;
          for (let i = 0; i < bucket.points.length; i += 2) ctx.drawImage(sprites.wave, bucket.points[i] - size / 2, bucket.points[i + 1] - size / 2, size, size);
        }
        ctx.restore();
      }
      // One camera-facing meridian per live shell: the stipple supplies volume,
      // this single ring tells you it is a sphere rather than a disk.
      for (const plan of mains) {
        let dx = cam[0] - plan.source[0], dz = cam[2] - plan.source[2];
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        ctx.save();
        ctx.setLineDash([2, 6]); ctx.lineWidth = plan.danger ? 1.3 : .9;
        ctx.strokeStyle = plan.danger ? 'rgba(255,166,142,.36)' : 'rgba(199,235,248,.11)';
        ctx.beginPath();
        let open = false;
        for (let i = 0; i <= 150; i++) {
          const a = i / 150 * TAU;
          const q = project([
            plan.source[0] + plan.radius * Math.cos(a) * dx,
            plan.source[1] + plan.radius * Math.sin(a),
            plan.source[2] + plan.radius * Math.cos(a) * dz
          ]);
          if (q) {
            if (open) ctx.lineTo(q[0], q[1]);
            else { ctx.moveTo(q[0], q[1]); open = true; }
          } else open = false;
        }
        ctx.stroke(); ctx.restore();
      }
      return { points, requested: Math.round(requested * density), depth: { min: Number.isFinite(minDepth) ? +minDepth.toFixed(2) : null, max: +maxDepth.toFixed(2) } };
    }

    paintFieldWaves(ctx, profile, fronts, project, scale) {
      const mains = new Set(fronts.mains);
      const spacing = (profile.scan?.speed || 10) * (profile.scan?.period || 10) * scale;
      const sample = Math.max(1, Math.ceil(9 / Math.max(.01, spacing)));
      const normal = COLOURS.map(() => []);
      const mainPaths = [], pastPaths = [], dangerPaths = [];
      let drawn = 0;
      for (const plan of fronts.plans) {
        const important = mains.has(plan) || plan.danger;
        if (!important && sample > 1 && ((plan.cycle % sample) + sample) % sample !== 0) continue;
        const dy = profile.planeY - plan.source[1], rho2 = plan.radius * plan.radius - dy * dy;
        if (!(rho2 > 0)) continue;
        const rho = Math.sqrt(rho2);
        const steps = clamp(Math.ceil(TAU * Math.max(20, rho * scale) / 7), 24, 460);
        const poly = [];
        for (let i = 0; i <= steps; i++) {
          const a = i / steps * TAU;
          const q = project([plan.source[0] + Math.cos(a) * rho, profile.planeY, plan.source[2] + Math.sin(a) * rho]);
          if (q && q[0] > -24 && q[0] < this.w + 24 && q[1] > -24 && q[1] < this.h + 24) poly.push(q[0], q[1]);
          else { if (poly.length > 3) poly.push(NaN); }
        }
        if (poly.length < 4) continue;
        if (plan.danger) dangerPaths.push({ plan, poly });
        else if (mains.has(plan)) (plan.gap >= 0 ? mainPaths : pastPaths).push({ plan, poly });
        else normal[plan.bell % COLOURS.length].push(poly);
        drawn++;
      }
      const strokePolys = (list, close) => {
        ctx.beginPath();
        for (const poly of list) {
          let open = false;
          for (let i = 0; i < poly.length; i += 2) {
            if (!Number.isFinite(poly[i]) || !Number.isFinite(poly[i + 1])) { open = false; continue; }
            if (open) ctx.lineTo(poly[i], poly[i + 1]);
            else { ctx.moveTo(poly[i], poly[i + 1]); open = true; }
          }
          if (close) ctx.closePath();
        }
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 1;
      normal.forEach((list, i) => {
        if (!list.length) return;
        ctx.strokeStyle = COLOURS[i]; ctx.globalAlpha = sample > 2 ? .09 : .15;
        strokePolys(list, false);
      });
      ctx.globalAlpha = .3; ctx.strokeStyle = 'rgba(190,230,244,.55)'; ctx.lineWidth = 1.1;
      strokePolys(pastPaths, false);
      if (mainPaths.length) {
        ctx.globalAlpha = .62; ctx.strokeStyle = 'rgba(210,243,252,.9)'; ctx.lineWidth = 1.35;
        ctx.shadowColor = 'rgba(164,226,246,.65)'; ctx.shadowBlur = 6;
        for (const entry of mainPaths) {
          ctx.beginPath();
          let open = false;
          for (let i = 0; i < entry.poly.length; i += 2) {
            if (!Number.isFinite(entry.poly[i])) { open = false; continue; }
            if (open) ctx.lineTo(entry.poly[i], entry.poly[i + 1]);
            else { ctx.moveTo(entry.poly[i], entry.poly[i + 1]); open = true; }
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
      for (const entry of dangerPaths) {
        ctx.globalAlpha = .16; ctx.strokeStyle = 'rgba(255,148,128,.8)'; ctx.lineWidth = 8;
        strokePolys([entry.poly], false);
        ctx.globalAlpha = .95; ctx.strokeStyle = 'rgba(255,180,163,.98)'; ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,154,133,.7)'; ctx.shadowBlur = 7;
        strokePolys([entry.poly], false); ctx.shadowBlur = 0;
      }
      ctx.restore();
      return { drawn, sample, main: mainPaths.length, danger: dangerPaths.length };
    }

    paintFieldRoute(ctx, snapshot, project) {
      const holes = (snapshot.holes || []).slice().sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0));
      if (holes.length < 2) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(201,226,236,.16)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
      ctx.beginPath();
      let open = false;
      for (const hole of holes) {
        const q = project(hole.point);
        if (!q) { open = false; continue; }
        if (open) ctx.lineTo(q[0], q[1]);
        else { ctx.moveTo(q[0], q[1]); open = true; }
      }
      ctx.stroke(); ctx.restore();
    }

    paintFieldHoles(ctx, snapshot, plans, project, W, H) {
      const sprites = this.makeSprites(), marks = [];
      const holes = snapshot.holes || [];
      for (const hole of holes) {
        const q = project(hole.point);
        if (!q || q[0] < -20 || q[0] > W + 20 || q[1] < -20 || q[1] > H + 20) continue;
        const [x, y, z] = q, isB = hole.kind === 'B', isA = hole.kind === 'A';
        const danger = plans.some(plan => Math.abs(plan.radius - distance(plan.source, hole.point)) <= (hole.radius || snapshot.holeRadius || 1.4) + .08);
        const glow = (isB ? 24 : 16) + clamp((1 - z / Math.max(1, z + 9000)) * 6, 0, 6);
        if (sprites) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = danger ? .26 : isB ? .18 : .1;
          if (isB || danger) ctx.drawImage(sprites.warm, x - glow * .7, y - glow * .7, glow * 1.4, glow * 1.4);
          ctx.globalAlpha = isB ? .36 : .2;
          ctx.drawImage(sprites.hole, x - glow / 2, y - glow / 2, glow, glow);
          ctx.restore();
        }
        const core = isB ? 3.1 : isA ? 2.3 : 1.5;
        ctx.save();
        ctx.fillStyle = isB ? '#fff' : isA ? 'rgba(236,246,250,.72)' : 'rgba(198,218,226,.42)';
        ctx.shadowColor = danger ? 'rgba(255,189,169,.95)' : isB ? 'rgba(221,248,255,.8)' : 'transparent';
        ctx.shadowBlur = isB || danger ? 6 : 0;
        ctx.beginPath(); ctx.arc(x, y, core, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
        if (isB) {
          ctx.fillStyle = 'rgba(226,245,251,.82)'; ctx.font = '8px ui-monospace, Consolas, monospace';
          ctx.fillText('B', x + 6, y - 5);
        }
        ctx.restore();
        marks.push({ kind: hole.kind, x: +x.toFixed(2), y: +y.toFixed(2), depth: +z.toFixed(2), core, danger });
      }
      return marks;
    }

    paintFieldPlayer(ctx, profile, focus, project, W, H) {
      const centre = profile.centre, planeY = profile.planeY;
      const player = project(centre), ahead = project([centre[0] + Math.sin(Number(focus && focus.yaw) || 0) * 20, centre[1], centre[2] - Math.cos(Number(focus && focus.yaw) || 0) * 20]);
      const bubble = [];
      for (let i = 0; i < 72; i++) {
        const a = i / 72 * TAU, q = project([centre[0] + Math.cos(a) * 190, planeY, centre[2] + Math.sin(a) * 190]);
        if (q) bubble.push(q);
      }
      ctx.save();
      if (bubble.length > 8) {
        ctx.strokeStyle = 'rgba(164,226,246,.24)'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
        ctx.beginPath();
        bubble.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (player) {
        ctx.strokeStyle = 'rgba(235,250,255,.66)'; ctx.fillStyle = 'rgba(235,250,255,.94)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(player[0], player[1], 4.4, 0, TAU); ctx.stroke();
        if (ahead) { ctx.beginPath(); ctx.moveTo(player[0], player[1]); ctx.lineTo(ahead[0], ahead[1]); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(player[0], player[1], 1.3, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(201,230,240,.72)'; ctx.font = '9px ui-monospace, Consolas, monospace';
        ctx.fillText('你 · 局部 190 m', player[0] + 7, player[1] + 15);
      }
      ctx.restore();
    }

    paintScatterSources(ctx, scan, project, centre, survey, W, H) {
      const bells = scan && Array.isArray(scan.bells) ? scan.bells : [];
      if (!bells.length) return;
      ctx.save();
      ctx.font = '9px ui-monospace, Consolas, monospace';
      bells.forEach((bell, i) => {
        if (!bell || !Array.isArray(bell.p)) return;
        const dx = bell.p[0] - centre[0], dy = bell.p[1] - centre[1], dz = bell.p[2] - centre[2];
        const len = Math.hypot(dx, dy, dz);
        if (!(len > 1e-6)) return;
        const edge = project([centre[0] + dx / len * survey, centre[1] + dy / len * survey, centre[2] + dz / len * survey]);
        const origin = project([centre[0], centre[1], centre[2]]);
        if (!edge || !origin || edge[0] < 10 || edge[0] > W - 10 || edge[1] < 30 || edge[1] > H - 30) return;
        ctx.strokeStyle = 'rgba(174,218,232,.16)'; ctx.lineWidth = 1; ctx.setLineDash([2, 7]);
        ctx.beginPath(); ctx.moveTo(origin[0], origin[1]); ctx.lineTo(edge[0], edge[1]); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(196,235,248,.42)';
        ctx.beginPath(); ctx.arc(edge[0], edge[1], 2.6, 0, TAU); ctx.stroke();
        // Numbered bearing ticks, kept out of the contact cluster and clear of
        // the paper panel. Round = source; square tags = wave crests.
        const tag = project([centre[0] + dx / len * survey * .74, centre[1] + dy / len * survey * .74, centre[2] + dz / len * survey * .74]);
        if (!tag) return;
        const tx = clamp(tag[0] + 6, 12, W - 30), ty = clamp(tag[1] - 5, tx < 510 ? 274 : 34, H - 60);
        ctx.strokeStyle = 'rgba(196,235,248,.34)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(tx, ty, 5.6, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(196,235,248,.78)'; ctx.font = '8px ui-monospace, Consolas, monospace';
        ctx.textAlign = 'center'; ctx.fillText(String(i + 1), tx, ty + 3); ctx.textAlign = 'start';
      });
      ctx.restore();
    }

    paintScatterGround(ctx, project, centre, planeY, survey) {
      const loop = (radius, alpha, dash) => {
        const steps = 128;
        ctx.save();
        ctx.strokeStyle = `rgba(130,190,210,${alpha})`;
        ctx.lineWidth = 1;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath();
        let open = false;
        for (let i = 0; i <= steps; i++) {
          const a = i / steps * TAU;
          const q = project([centre[0] + Math.cos(a) * radius, planeY, centre[2] + Math.sin(a) * radius]);
          if (q) {
            if (open) ctx.lineTo(q[0], q[1]);
            else { ctx.moveTo(q[0], q[1]); open = true; }
          } else open = false;
        }
        ctx.stroke(); ctx.restore();
      };
      loop(survey, .22, null);
      loop(survey * .5, .055, [2, 9]);
      ctx.save();
      ctx.strokeStyle = 'rgba(130,190,210,.04)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU;
        const q = project([centre[0] + Math.cos(a) * survey, planeY, centre[2] + Math.sin(a) * survey]);
        const p = project([centre[0], planeY, centre[2]]);
        if (q && p) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      }
      ctx.stroke();
      // Small origin tick only: a full vertical datum reads as a stray ray.
      const origin = project([centre[0], planeY, centre[2]]);
      if (origin) {
        ctx.strokeStyle = 'rgba(176,224,238,.3)'; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(origin[0] - 4, origin[1]); ctx.lineTo(origin[0] + 4, origin[1]); ctx.stroke();
      }
      ctx.restore();
    }

    paintScatterShells(ctx, plans, project, centre, survey, planeY, W, H) {
      let danger = 0;
      const fronts = plans.filter(plan => plan.main || plan.danger);
      for (const plan of fronts) {
        plan.front = this.scatterFrontAt(plan, centre, planeY);
        plan.danger = plan.danger || false;
      }
      const drawn = fronts.filter(plan => plan.front).sort((a, b) => b.front.gap - a.front.gap);
      // A 3D cap rim is only drawn for the shell that crosses an unsealed
      // hole: that is the one surface the player must see as a real sphere.
      for (const plan of fronts) if (plan.danger) {
        danger++;
        this.paintScatterShell(ctx, plan, project, centre, survey);
      }
      // The five next fronts, sectioned at the player's own altitude. At this
      // scale each sphere is locally flat, so the altitude section is the
      // honest picture: one crest wall per bell, with the dashed remainder
      // marking how far the same sphere continues past your survey bubble.
      const mains = drawn.filter(plan => plan.main);
      const focus = mains.reduce((best, plan) => !best || plan.front.gap < best.front.gap ? plan : best, null);
      for (const plan of drawn) this.paintScatterWaveArc(ctx, plan, project, centre, survey, planeY);
      for (const plan of drawn) this.paintScatterContact(ctx, plan, project, centre, planeY);
      this.paintScatterFrontTags(ctx, drawn, project, centre, survey, planeY, W, H);
      return { meshes: danger, arcs: drawn.filter(plan => plan.front.onPlane).length, danger, fronts: drawn, focus: focus && focus.bell + 1 };
    }

    scatterFrontAt(plan, centre, planeY) {
      const dy = planeY - plan.source[1], rho2 = plan.radius * plan.radius - dy * dy;
      if (!(rho2 > 0)) return null;
      const rho = Math.sqrt(rho2);
      const dx = centre[0] - plan.source[0], dz = centre[2] - plan.source[2], D = Math.hypot(dx, dz);
      const a0 = D < 1e-6 ? 0 : Math.atan2(dz, dx);
      return { rho, D, a0, gap: D - rho, onPlane: false };
    }

    paintScatterWaveArc(ctx, plan, project, centre, survey, planeY) {
      const front = plan.front;
      if (!front) return false;
      const { rho, D, a0 } = front;
      const dx = centre[0] - plan.source[0], dz = centre[2] - plan.source[2];
      let from = 0, to = TAU;
      if (D > 1e-6) {
        if (rho > survey + D) return false;
        const cosA = (rho * rho + D * D - survey * survey) / (2 * rho * D);
        if (cosA >= 1) return false;
        if (cosA > -1) {
          const half = Math.acos(clamp(cosA, -1, 1));
          from = a0 - half; to = a0 + half;
        }
      } else if (rho > survey) return false;
      const span = to - from;
      const at = (a, y) => project([plan.source[0] + Math.cos(a) * rho, y, plan.source[2] + Math.sin(a) * rho]);
      const color = plan.danger ? '255,150,126' : '185,231,246';
      ctx.save();
      ctx.lineCap = 'round';
      // The crest continues past the 190 m survey bubble: a dashed extension
      // keeps it one sphere instead of a beam that stops in mid-air.
      const steps = clamp(Math.ceil(rho * span / 4), 40, 300);
      ctx.setLineDash([3, 9]);
      ctx.strokeStyle = `rgba(${color},${plan.danger ? .22 : .1})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let open = false;
      for (let i = 0; i <= steps; i++) {
        const q = at(from + span * i / steps, planeY);
        if (q) {
          if (open) ctx.lineTo(q[0], q[1]);
          else { ctx.moveTo(q[0], q[1]); open = true; }
        } else open = false;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Solid local crest: an 84 m section you can actually aim against.
      // At R ~ 1.4 km the sphere is locally flat, so this section is the
      // honest read of a wall sweeping through your altitude.
      const half = Math.min(span * .5, 42 / Math.max(1, rho));
      const n = 18, base = [];
      for (let i = 0; i <= n; i++) {
        const b = at(a0 - half + half * 2 * i / n, planeY);
        if (!b) { base.length = 0; break; }
        base.push(b);
      }
      if (base.length) {
        // Uniform crest, not a comet: the whole 84 m section is equally lit,
        // and the dashed extension carries it on past the survey bubble.
        ctx.strokeStyle = `rgba(${color},${plan.danger ? .1 : .07})`;
        ctx.lineWidth = plan.danger ? 12 : 9;
        ctx.beginPath();
        base.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
        ctx.stroke();
        ctx.strokeStyle = `rgba(${color},${plan.danger ? .98 : .88})`;
        ctx.lineWidth = plan.danger ? 2.9 : 2.4;
        ctx.beginPath();
        base.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
        ctx.stroke();
      }
      ctx.restore();
      front.onPlane = true;
      return true;
    }

    paintScatterContact(ctx, plan, project, centre, planeY) {
      const front = plan.front;
      if (!front || !front.onPlane) return;
      const { rho, a0 } = front;
      const passed = front.gap < 0;
      const color = plan.danger ? '255,178,154' : '231,250,255';
      const at = project([plan.source[0] + Math.cos(a0) * rho, planeY, plan.source[2] + Math.sin(a0) * rho]);
      const me = project([centre[0], planeY, centre[2]]);
      if (!at) return;
      ctx.save();
      // A contact bead, not a second line: the crest stays one clean wall and
      // the bead marks the exact closest approach to you.
      ctx.fillStyle = `rgba(${color},${passed ? .5 : .95})`;
      ctx.shadowColor = `rgba(${color},.8)`; ctx.shadowBlur = passed ? 2 : 7;
      ctx.beginPath(); ctx.arc(at[0], at[1], passed ? 1.6 : plan.danger ? 3 : 2.4, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      if (me) {
        ctx.setLineDash([1, 5]);
        ctx.strokeStyle = `rgba(${color},${passed ? .08 : .18})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(me[0], me[1]); ctx.lineTo(at[0], at[1]); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    paintScatterShell(ctx, plan, project, centre, survey) {
      const r = plan.radius, source = plan.source;
      const A = Math.acos(clamp(plan.cosA, -1, 1));
      if (!(A > 0)) return;
      const alpha = plan.danger ? .6 : .34;
      const color = plan.danger ? '255,166,142' : '199,235,248';
      const ringAt = (polar, steps) => {
        const cp = Math.cos(polar), sp = Math.sin(polar);
        const points = [];
        for (let i = 0; i < steps; i++) {
          const a = i / steps * TAU;
          const q = project([
            source[0] + r * (plan.n[0] * cp + (plan.u[0] * Math.cos(a) + plan.v[0] * Math.sin(a)) * sp),
            source[1] + r * (plan.n[1] * cp + (plan.u[1] * Math.cos(a) + plan.v[1] * Math.sin(a)) * sp),
            source[2] + r * (plan.n[2] * cp + (plan.u[2] * Math.cos(a) + plan.v[2] * Math.sin(a)) * sp)
          ]);
          if (!q) return null;
          points.push(q);
        }
        return points;
      };
      ctx.save();
      // A single exact cap outline plus one contour. At survey scale a full
      // lat/long globe collapses into a bundle of straight lines.
      const edge = ringAt(A, 128);
      if (edge) {
        ctx.beginPath();
        for (let i = 0; i < edge.length; i++) i ? ctx.lineTo(edge[i][0], edge[i][1]) : ctx.moveTo(edge[i][0], edge[i][1]);
        ctx.closePath();
        ctx.fillStyle = `rgba(${color},${plan.danger ? .1 : .04})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${color},${alpha})`;
        ctx.lineWidth = plan.danger ? 1.8 : 1.15;
        ctx.stroke();
      }
      for (const f of [.6]) {
        const ring = ringAt(A * f, 96);
        if (!ring) continue;
        ctx.beginPath();
        for (let i = 0; i < ring.length; i++) i ? ctx.lineTo(ring[i][0], ring[i][1]) : ctx.moveTo(ring[i][0], ring[i][1]);
        ctx.closePath();
        ctx.strokeStyle = `rgba(${color},${plan.danger ? .24 : .1})`;
        ctx.lineWidth = .8;
        ctx.stroke();
      }
      ctx.restore();
    }

    paintScatterFrontTags(ctx, fronts, project, centre, survey, planeY, W, H) {
      if (!fronts.length) return;
      const boxes = [];
      const list = [...fronts].sort((a, b) => a.bell - b.bell);
      list.forEach((plan, idx) => {
        const front = plan.front;
        if (!front || !front.onPlane) return;
        const at = project([plan.source[0] + Math.cos(front.a0) * front.rho, planeY, plan.source[2] + Math.sin(front.a0) * front.rho]);
        if (!at || at[0] < 34 || at[0] > W - 74 || at[1] < 54 || at[1] > H - 46) return;
        const ahead = project([plan.source[0] + Math.cos(front.a0 + .01) * front.rho, planeY, plan.source[2] + Math.sin(front.a0 + .01) * front.rho]);
        let tx = 1, ty = 0;
        if (ahead) {
          tx = ahead[0] - at[0]; ty = ahead[1] - at[1];
          const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
        }
        let nx = -ty, ny = tx;
        if (ny > 0) { nx = -nx; ny = -ny; }
        // Fan the five labels along the crest; overlapping fronts are common
        // when several bells share a bearing, so the leader lines keep the
        // anchor honest while the boxes stay readable.
        const slot = (idx - (list.length - 1) / 2) * 42 * this.view.zoom;
        let x = at[0] + tx * slot + nx * 18, y = at[1] + ty * slot + ny * 18;
        for (let guard = 0; guard < 6; guard++) {
          if (boxes.every(box => Math.abs(x - box.x) > 42 || Math.abs(y - box.y) > 21)) break;
          y -= 23;
        }
        x = clamp(x, 26, W - 80); y = clamp(y, 50, H - 46);
        boxes.push({ x, y });
        ctx.save();
        ctx.strokeStyle = plan.danger ? 'rgba(255,178,154,.34)' : 'rgba(207,242,252,.24)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + 8.5, y + 8.5); ctx.lineTo(at[0], at[1]); ctx.stroke();
        ctx.fillStyle = plan.danger ? 'rgba(36,12,9,.9)' : 'rgba(4,14,20,.86)';
        ctx.strokeStyle = plan.danger ? 'rgba(255,178,154,.92)' : 'rgba(207,242,252,.7)';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, 17, 17); ctx.strokeRect(x + .5, y + .5, 16, 16);
        ctx.fillStyle = plan.danger ? '#ffb296' : 'rgba(233,250,255,.96)';
        ctx.font = '9px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText(String(plan.bell + 1), x + 8.5, y + 11.5);
        ctx.textAlign = 'start';
        // The number answers which bell; the gap answers how urgent.
        ctx.font = '8px ui-monospace, Consolas, monospace';
        ctx.fillStyle = plan.danger ? 'rgba(255,178,154,.85)' : 'rgba(198,234,245,.72)';
        const gap = Math.round(Math.abs(front.gap));
        ctx.fillText((front.gap < 0 ? '已过 ' : '') + gap + ' m', x + 21, y + 11.5);
        ctx.restore();
      });
    }

    paintScatterBellRail(ctx, fronts, scan, W, H) {
      if (W < 980 || H < 560) return;
      const rows = fronts.filter(plan => plan.main && plan.front).sort((a, b) => a.bell - b.bell);
      if (!rows.length) return;
      const speed = Number(scan?.speed) || 10, period = Number(scan?.period) || 10;
      const w = 286, x = W - 24 - w, y = 244;
      const h = 30 + rows.length * 20 + 8;
      ctx.save();
      ctx.fillStyle = 'rgba(4,14,20,.72)'; ctx.strokeStyle = 'rgba(176,222,238,.24)'; ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
      ctx.strokeStyle = 'rgba(176,222,238,.18)';
      ctx.beginPath(); ctx.moveTo(x + 10, y + 24); ctx.lineTo(x + w - 10, y + 24); ctx.stroke();
      ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.fillStyle = 'rgba(200,235,245,.82)'; ctx.fillText('五钟 · 下一道波前', x + 10, y + 16);
      ctx.fillStyle = 'rgba(157,196,208,.66)'; ctx.textAlign = 'right'; ctx.fillText('距离 / ETA', x + w - 10, y + 16); ctx.textAlign = 'start';
      rows.forEach((plan, i) => {
        const ry = y + 38 + i * 20;
        const gap = plan.front.gap;
        const eta = gap >= 0 ? gap / speed : Math.max(0, period + gap / speed);
        ctx.fillStyle = 'rgba(167,210,222,.66)'; ctx.fillText('钟' + (plan.bell + 1), x + 10, ry);
        ctx.fillStyle = plan.danger ? '#ffb296' : 'rgba(223,246,253,.92)';
        ctx.textAlign = 'right'; ctx.fillText(Math.round(Math.abs(gap)) + ' m', x + 208, ry);
        ctx.fillStyle = plan.danger ? '#ffb296' : 'rgba(188,226,236,.82)';
        ctx.fillText(eta.toFixed(1) + ' s', x + w - 10, ry);
        ctx.textAlign = 'start';
        if (i < rows.length - 1) {
          ctx.strokeStyle = 'rgba(176,222,238,.08)';
          ctx.beginPath(); ctx.moveTo(x + 10, ry + 7); ctx.lineTo(x + w - 10, ry + 7); ctx.stroke();
        }
      });
      ctx.restore();
    }

    paintBackdrop(ctx, W, H, radius, scale, cx, cy) {
      const bg = ctx.createRadialGradient(W * .5, H * .46, 0, W * .5, H * .46, Math.max(W, H) * .7);
      bg.addColorStop(0, '#0d2434');
      bg.addColorStop(.6, '#091a28');
      bg.addColorStop(1, '#06121c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // Outer survey ring marks the exact frozen view radius.
      ctx.strokeStyle = 'rgba(148,196,214,.16)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, radius * scale, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(148,196,214,.06)';
      ctx.beginPath(); ctx.arc(cx, cy, radius * scale * .5, 0, TAU); ctx.stroke();
    }

    paintGeology(ctx, snapshot, sx, sy, scale, W, H) {
      const geology = snapshot.geology;
      if (!geology || !Array.isArray(geology.bands)) return;
      const gx = sx(0), gy = sy(0);
      const bands = geology.bands.slice().sort((a, b) => b.to - a.to);
      if (!bands.length) return;
      const outerBand = bands[0], blueBand = bands[1], innerBand = bands[2];
      // Sample the wobbled ring finely enough that the largest chord stays
      // under a pixel or two, whatever the zoom.
      const ring = (radius, wave) => {
        const rp = Number(radius) * scale;
        if (!(rp > .5) || !Number.isFinite(rp)) return null;
        const n = clamp(Math.ceil(TAU * Math.sqrt(rp) * .75), 72, 1800);
        const pts = new Array(n);
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU, r = Number(radius) * (1 + wave(a)) * scale;
          pts[i] = [gx + Math.cos(a) * r, gy + Math.sin(a) * r];
        }
        return pts;
      };
      const trace = pts => {
        for (let i = 0; i < pts.length; i++) {
          if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]);
        }
        ctx.closePath();
      };
      const startPts = ring(outerBand.to, strataWave.start);
      const bluePts = blueBand ? ring(blueBand.to, strataWave.blue) : null;
      const innerPts = innerBand ? ring(innerBand.to, strataWave.inner) : null;
      const fillBand = (outside, inside, style) => {
        if (!outside) return;
        ctx.beginPath(); trace(outside); if (inside) trace(inside);
        ctx.fillStyle = style;
        ctx.fill(inside ? 'evenodd' : 'nonzero');
      };
      // At gameplay zoom the 16 km route edge crosses the screen as an almost
      // straight cut; treat it as "still inside 纹白岩" instead of a cliff. It
      // only returns as a coastline once its arc is genuinely visible.
      const onScreen = pts => !!pts && pts.some(p => p[0] > -80 && p[0] < W + 80 && p[1] > -80 && p[1] < H + 80);
      const startCoast = onScreen(startPts) && outerBand.to * scale <= Math.max(W, H) * 24;
      const centre = snapshot.centre || [0, 0, 0];
      const insideRoute = Math.hypot(centre[0], centre[2]) <= outerBand.to * 1.02;
      if (!startCoast && insideRoute) {
        ctx.fillStyle = 'rgba(137,63,44,.38)';
        ctx.fillRect(0, 0, W, H);
        fillBand(bluePts, innerPts, 'rgba(42,84,102,.44)');
        fillBand(innerPts, null, 'rgba(146,68,48,.46)');
      } else {
        // 纹白岩 / 金刚岩 / 纹白岩, painted as separate rings so the tints stay clean.
        fillBand(startCoast ? startPts : null, bluePts, 'rgba(137,63,44,.38)');
        fillBand(bluePts, innerPts, 'rgba(42,84,102,.44)');
        fillBand(innerPts, null, 'rgba(146,68,48,.46)');
      }
      // Soft lithology mottles: same rock, slightly different mineral mix.
      const blob = (x, y, rad, stretch, angle, rgb, alpha) => {
        if (!(rad > .8) || x < -rad * 2 || x > W + rad * 2 || y < -rad * 2 || y > H + rad * 2) return;
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        grad.addColorStop(0, 'rgba(' + rgb + ',' + alpha + ')');
        grad.addColorStop(.62, 'rgba(' + rgb + ',' + (alpha * .5).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(rad * stretch, rad);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.restore();
      };
      const redMix = ['172,104,70', '124,76,56', '96,60,46', '146,96,60'];
      const blueMix = ['84,130,142', '58,100,116', '74,110,96', '110,146,152'];
      let blobs = 0;
      const mottle = (band, count, palette, seed) => {
        if (!band) return;
        const width = Math.max(1e-6, band.to - band.from);
        const lo = band.from + width * .2, hi = band.to - width * .2;
        if (!(hi > lo)) return;
        const rand = seeded(seed);
        for (let i = 0; i < count; i++) {
          const a = rand() * TAU, r = lo + (hi - lo) * rand();
          const rad = width * (.032 + rand() * .075) * scale;
          if (rad < 1.2 || rad > Math.max(W, H) * .9) continue;
          const rgb = palette[(rand() * palette.length) | 0];
          blob(gx + Math.cos(a) * r * scale, gy + Math.sin(a) * r * scale, rad,
            .55 + rand() * .95, rand() * TAU, rgb, .06 + rand() * .065);
          blobs++;
        }
      };
      mottle(outerBand, 34, redMix, 0x5a17c3);
      mottle(blueBand, 26, blueMix, 0x2c9e41);
      mottle(innerBand, 20, redMix, 0x71d05f);
      // Dashed contact + short survey teeth on the inner side.
      const contact = pts => {
        if (!pts || pts.length < 16) return;
        ctx.beginPath(); trace(pts);
        ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(240,228,210,.25)'; ctx.lineWidth = 1.1; ctx.stroke();
        ctx.setLineDash([]);
        const perimeter = TAU * Math.hypot(pts[0][0] - gx, pts[0][1] - gy);
        const step = Math.max(1, Math.round(46 * pts.length / Math.max(60, perimeter)));
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += step) {
          const p = pts[i], prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
          let tx = next[0] - prev[0], ty = next[1] - prev[1];
          const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
          let nx = -ty, ny = tx;
          if (nx * (gx - p[0]) + ny * (gy - p[1]) < 0) { nx = -nx; ny = -ny; }
          ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + nx * 4.2, p[1] + ny * 4.2);
        }
        ctx.strokeStyle = 'rgba(240,228,210,.13)'; ctx.lineWidth = 1; ctx.stroke();
      };
      if (startCoast) contact(startPts); contact(bluePts); contact(innerPts);
      const boundary = (metres, wave, label, angle) => {
        const radius = Number(metres) * (1 + wave(angle)) * scale;
        if (!(radius > 24)) return;
        if (radius < 95) return;
        const x = gx + Math.cos(angle) * radius, y = gy + Math.sin(angle) * radius;
        if (x < 84 || x > W - 84 || y < 90 || y > H - 110) return;
        ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
        const width = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(8,10,10,.58)'; ctx.fillRect(x - width / 2 - 5, y - 10, width + 10, 15);
        ctx.fillStyle = 'rgba(241,229,208,.82)'; ctx.fillText(label, x, y + 1);
        ctx.textAlign = 'left';
      };
      if (blueBand) boundary(blueBand.to, strataWave.blue, '金刚岩边界 · ' + shortDistance(blueBand.to), -.35);
      if (innerBand) boundary(innerBand.to, strataWave.inner, '纹白岩边界 · ' + shortDistance(innerBand.to), -.82);
      const spread = wave => {
        let m = 0;
        for (let i = 0; i < 64; i++) m = Math.max(m, Math.abs(wave(i / 64 * TAU)));
        return +m.toFixed(3);
      };
      this.lastGeology = {
        style: 'terrain', blobs,
        boundaries: [
          { id: 'start', radius: outerBand.to, atRoute: +(1 + strataWave.start(0)).toFixed(4), spread: spread(strataWave.start) },
          blueBand && { id: 'blue', radius: blueBand.to, atRoute: +(1 + strataWave.blue(0)).toFixed(4), spread: spread(strataWave.blue) },
          innerBand && { id: 'inner', radius: innerBand.to, atRoute: +(1 + strataWave.inner(0)).toFixed(4), spread: spread(strataWave.inner) }
        ].filter(Boolean)
      };
    }

    paintGrid(ctx, W, H, scale, centre, cx, cy) {
      const minor = this.gridStep(scale), major = minor * 5;
      const left = centre[0] - W * .5 / scale, right = centre[0] + W * .5 / scale;
      const top = centre[2] - H * .5 / scale, bottom = centre[2] + H * .5 / scale;
      const labelEvery = Math.max(1, Math.ceil(150 / (major * scale)));
      this.lastGrid = { minor, major, pixels: +(minor * scale).toFixed(1), labelEvery };
      ctx.lineWidth = 1;
      ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center';
      for (let i = Math.ceil(left / minor), end = Math.floor(right / minor); i <= end; i++) {
        const x = i * minor, px = cx + (x - centre[0]) * scale;
        const isMajor = i % 5 === 0;
        ctx.strokeStyle = isMajor ? 'rgba(137,188,207,.16)' : 'rgba(137,188,207,.06)';
        ctx.beginPath(); ctx.moveTo(Math.round(px) + .5, 0); ctx.lineTo(Math.round(px) + .5, H); ctx.stroke();
        if (isMajor && ((i / 5) % labelEvery + labelEvery) % labelEvery === 0) {
          ctx.fillStyle = 'rgba(220,242,250,.34)'; ctx.fillText(shortDistance(x), px, 15);
        }
      }
      ctx.textAlign = 'left';
      for (let i = Math.ceil(top / minor), end = Math.floor(bottom / minor); i <= end; i++) {
        const z = i * minor, py = cy + (z - centre[2]) * scale;
        const isMajor = i % 5 === 0;
        ctx.strokeStyle = isMajor ? 'rgba(137,188,207,.16)' : 'rgba(137,188,207,.06)';
        ctx.beginPath(); ctx.moveTo(0, Math.round(py) + .5); ctx.lineTo(W, Math.round(py) + .5); ctx.stroke();
        if (isMajor && ((i / 5) % labelEvery + labelEvery) % labelEvery === 0) {
          ctx.fillStyle = 'rgba(220,242,250,.31)'; ctx.fillText(shortDistance(z), 8, py - 5);
        }
      }
      ctx.fillStyle = 'rgba(220,242,250,.34)';
      ctx.fillText('+X / 路线', W - 76, cy - 8);
    }

    paintRoute(ctx, snapshot, sx, sy) {
      const holes = (snapshot.holes || []).slice().sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0));
      if (holes.length < 2) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(201,226,236,.20)'; ctx.lineWidth = 1; ctx.setLineDash([3, 7]);
      ctx.beginPath();
      holes.forEach((hole, i) => { const x = sx(hole.point[0]), y = sy(hole.point[2]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.restore();
    }

    paintWaves(ctx, snapshot, planeY, sx, sy, scale, W, H) {
      const waves = snapshot.fieldWaves?.length ? snapshot.fieldWaves : snapshot.waves || [];
      if (!waves.length) return;
      const field = snapshot.fieldWaves?.length ? snapshot.field : null;
      const clip = field && Number.isFinite(field.radius) && field.radius > 0 && Array.isArray(field.point);
      const fieldX = clip ? sx(field.point[0]) : 0, fieldY = clip ? sy(field.point[2]) : 0;
      const fieldR = clip ? field.radius * scale : 0;
      const holes = snapshot.holes || [];
      const spacing = (snapshot.scan?.speed || 10) * (snapshot.scan?.period || 20) * scale;
      // Across the full route the fronts are only a few pixels apart. Draw a
      // representative real cycle instead of turning the sheet into moiré.
      const sample = Math.max(1, Math.ceil(13 / Math.max(.01, spacing)));
      const corners = [[0, 0], [W, 0], [0, H], [W, H]];
      const playerX = sx(snapshot.centre[0]), playerY = sy(snapshot.centre[2]);
      let drawn = 0;
      if (clip) {
        // Fronts exist only inside the sensing field. Clip the whole wave pass
        // so no arc leaks beyond the 15 km disc, wherever the camera is.
        ctx.save();
        ctx.beginPath(); ctx.arc(fieldX, fieldY, Math.max(.5, fieldR), 0, TAU); ctx.clip();
      }
      for (let i = 0; i < waves.length; i++) {
        const wave = waves[i];
        const dy = planeY - wave.source[1];
        const r2 = wave.radius * wave.radius - dy * dy;
        if (r2 <= 0) continue;
        const rho = Math.sqrt(r2) * scale;
        if (rho < .7) continue;
        const x = sx(wave.source[0]), y = sy(wave.source[2]);
        if (sample > 1 && ((wave.cycle % sample) + sample) % sample !== 0 && Math.abs(rho - Math.hypot(x - playerX, y - playerY)) > 24) continue;
        // Screen-space ring culling: keep circles whose annulus actually
        // crosses the viewport. A source may be far off-screen while its
        // real front still cuts the visible slice.
        const nearX = clamp(x, 0, W), nearY = clamp(y, 0, H);
        const nearest = Math.hypot(x - nearX, y - nearY);
        const farthest = Math.max(...corners.map(([px, py]) => Math.hypot(x - px, y - py)));
        if (rho < nearest - 1 || rho > farthest + 1) continue;
        const dangerous = holes.some(hole => Math.abs(wave.radius - distance(wave.source, hole.point)) <= (hole.radius || snapshot.holeRadius || 1.4) + .08);
        const colour = dangerous ? '#ffb4a3' : COLOURS[(wave.bell || 0) % COLOURS.length];
        const faint = wave.radius > (snapshot.radius || 80) * 1.7;
        const density = clamp(spacing / 5, .18, 1);
        const alpha = (dangerous ? .96 : faint ? .42 : .82) * (faint ? density : 1);
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, rho, 0, TAU);
        ctx.strokeStyle = dangerous ? 'rgba(255,148,128,.22)' : 'rgba(206,238,250,.12)';
        ctx.lineWidth = dangerous ? 9 : faint ? 4 : 7; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, rho, 0, TAU);
        ctx.strokeStyle = colour;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = dangerous ? 1.9 : faint ? 1 : 1.25; ctx.stroke();
        ctx.restore();
        drawn++;
      }
      if (clip) ctx.restore();
      this.lastStats.drawnWaves = drawn;
      this.lastStats.waveSample = sample;
      this.lastStats.fieldClip = clip ? { x: +fieldX.toFixed(1), y: +fieldY.toFixed(1), r: +fieldR.toFixed(1) } : null;
    }

    paintHoles(ctx, snapshot, planeY, sx, sy, scale, W, H) {
      const holes = (snapshot.holes || []).slice();
      const order = { old: 0, A: 1, B: 2 };
      holes.sort((a, b) => (order[a.kind] || 0) - (order[b.kind] || 0));
      for (const hole of holes) {
        const x = sx(hole.point[0]), y = sy(hole.point[2]);
        if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
        const dy = hole.point[1] - planeY;
        const onPlane = Math.abs(dy) <= (hole.radius || 1.4);
        const label = hole.kind === 'B' ? 'B 新洞' : hole.kind === 'A' ? 'A 来路' : '旧洞';
        const distanceFromCentre = Math.hypot(hole.point[0] - snapshot.centre[0], hole.point[2] - snapshot.centre[2]);
        if (!onPlane) {
          ctx.save();
          ctx.strokeStyle = 'rgba(180,206,217,.52)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + 5, y - 5); ctx.stroke();
          ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.strokeStyle = 'rgba(180,206,217,.25)'; ctx.stroke();
          ctx.fillStyle = 'rgba(196,219,228,.72)'; ctx.font = '9px ui-monospace, Consolas, monospace';
          ctx.fillText(label + ' Δh' + (dy >= 0 ? '+' : '') + dy.toFixed(1) + 'm', x + 13, y - 4);
          ctx.restore();
          continue;
        }
        const pr = Math.max(3, Math.sqrt((hole.radius || 1.4) ** 2 - dy * dy) * scale);
        const isB = hole.kind === 'B', isA = hole.kind === 'A';
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU);
        ctx.fillStyle = isB ? 'rgba(111,194,214,.22)' : isA ? 'rgba(230,220,198,.15)' : 'rgba(164,188,201,.10)';
        ctx.fill();
        if (isB) { ctx.shadowColor = 'rgba(143,222,240,.85)'; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.arc(x, y, pr, 0, TAU);
        ctx.strokeStyle = isB ? '#9fe1f0' : isA ? '#ede2cb' : 'rgba(178,200,211,.72)';
        ctx.lineWidth = isB ? 2 : 1.3;
        if (hole.kind === 'old') ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU);
        ctx.fillStyle = isB ? '#d9f8ff' : isA ? '#f4ecdc' : 'rgba(178,200,211,.7)'; ctx.fill();
        ctx.fillStyle = isB ? 'rgba(206,244,251,.96)' : 'rgba(224,238,244,.82)';
        ctx.font = (isB ? '600 ' : '') + '10px ui-monospace, Consolas, monospace';
        ctx.fillText(label, x + pr + 8, y - pr * .2);
        ctx.fillStyle = 'rgba(178,203,214,.55)';
        ctx.fillText(distanceFromCentre.toFixed(0) + 'm', x + pr + 8, y - pr * .2 + 13);
        ctx.restore();
      }
    }

    paintTargets(ctx, snapshot, sx, sy, W, H, cx, cy) {
      const out = { goal: null, rec: null };
      let goalLabel = null;
      const labelBox = (x, y, text, dir) => {
        ctx.save(); ctx.font = '10px ui-monospace, Consolas, monospace';
        const w = ctx.measureText(text).width;
        ctx.restore();
        const left = dir < 0 ? x + dir - w : x + dir;
        return { left, right: left + w, top: y - 13, bottom: y + 12 };
      };
      const goal = snapshot.goal;
      if (goal && Array.isArray(goal.point)) {
        const x = sx(goal.point[0]), y = sy(goal.point[2]);
        let drawX = x, drawY = y;
        const inside = x >= 18 && x <= W - 18 && y >= 18 && y <= H - 18;
        if (inside) this.paintGoal(ctx, x, y, goal.distance, false, 0, W);
        else { const edge = this.edgePoint(W, H, cx, cy, x, y, 34); this.paintGoal(ctx, edge.x, edge.y, goal.distance, true, edge.angle, W); drawX = edge.x; drawY = edge.y; }
        const goalDir = !inside && drawX > W * .5 ? -11 : 11;
        goalLabel = labelBox(drawX, drawY, inside ? '冬冬 · 终点' : '冬冬 · 目标', goalDir);
        out.goal = { point: goal.point.slice(), distance: +Number(goal.distance).toFixed(1), x: +drawX.toFixed(2), y: +drawY.toFixed(2), onScreen: inside, edge: !inside };
      }
      const rec = snapshot.rec;
      if (rec && Array.isArray(rec.point)) {
        const x = sx(rec.point[0]), y = sy(rec.point[2]);
        let drawX = x, drawY = y;
        const inside = x >= 18 && x <= W - 18 && y >= 18 && y <= H - 18;
        let labelDy = 0;
        if (goalLabel) {
          const recDir = !inside && drawX > W * .5 ? -14 : 14;
          const box = labelBox(drawX, drawY, '推荐落点', recDir);
          const hits = box.left < goalLabel.right + 24 && box.right > goalLabel.left - 24 &&
            box.top < goalLabel.bottom + 6 && box.bottom > goalLabel.top - 6;
          if (hits) labelDy = goalLabel.bottom + 4 - box.top;
        }
        if (inside) this.paintRecommendation(ctx, x, y, rec, false, 0, W, labelDy);
        else { const edge = this.edgePoint(W, H, cx, cy, x, y, 34); this.paintRecommendation(ctx, edge.x, edge.y, rec, true, edge.angle, W, labelDy); drawX = edge.x; drawY = edge.y; }
        out.rec = { point: rec.point.slice(), distance: +Number(rec.distance).toFixed(1), go: rec.go, nextB: rec.nextB, x: +drawX.toFixed(2), y: +drawY.toFixed(2), onScreen: inside, edge: !inside, labelDy: +labelDy.toFixed(2) };
      }
      return out;
    }

    edgePoint(W, H, cx, cy, x, y, margin) {
      const dx = x - cx, dy = y - cy;
      if (Math.hypot(dx, dy) < 1e-6) return { x: W * .5, y: H - margin, angle: Math.PI / 2 };
      let t = Infinity;
      if (dx > 0) t = Math.min(t, (W - margin - cx) / dx);
      else if (dx < 0) t = Math.min(t, (margin - cx) / dx);
      if (dy > 0) t = Math.min(t, (H - margin - cy) / dy);
      else if (dy < 0) t = Math.min(t, (margin - cy) / dy);
      t = Math.max(0, t);
      return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
    }

    paintGoal(ctx, x, y, distance, edge, angle, W) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(240,220,160,.86)'; ctx.fillStyle = 'rgba(240,220,160,.18)';
      ctx.lineWidth = 1.2; ctx.shadowColor = 'rgba(240,220,160,.55)'; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(248,234,190,.96)';
      ctx.beginPath(); ctx.arc(0, 0, 1.7, 0, TAU); ctx.fill();
      if (edge) {
        const ax = Math.cos(angle) * 14, ay = Math.sin(angle) * 14;
        const nx = -Math.sin(angle) * 4, ny = Math.cos(angle) * 4;
        ctx.strokeStyle = 'rgba(240,220,160,.8)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(angle) * 6 + nx, ay - Math.sin(angle) * 6 + ny); ctx.lineTo(ax - Math.cos(angle) * 6 - nx, ay - Math.sin(angle) * 6 - ny); ctx.closePath(); ctx.stroke();
      }
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textAlign = edge && x > W * .5 ? 'right' : 'left';
      const dir = ctx.textAlign === 'right' ? -11 : 11;
      ctx.fillStyle = 'rgba(240,220,160,.94)';
      ctx.fillText(edge ? '冬冬 · 目标' : '冬冬 · 终点', dir, -3);
      ctx.fillStyle = 'rgba(240,220,160,.62)';
      ctx.fillText(distanceText(distance), dir, 9);
      ctx.restore();
    }

    paintRecommendation(ctx, x, y, rec, edge, angle, W, labelDy = 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(255,232,202,.82)'; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath();
      for (const [dx, dy] of [[-15, 0], [15, 0], [0, -15], [0, 15]]) { ctx.moveTo(dx * .62, dy * .62); ctx.lineTo(dx, dy); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,232,202,.96)';
      ctx.beginPath(); ctx.arc(0, 0, 1.9, 0, TAU); ctx.fill();
      if (edge) {
        const ax = Math.cos(angle) * 15, ay = Math.sin(angle) * 15;
        ctx.strokeStyle = 'rgba(255,232,202,.78)';
        ctx.beginPath(); ctx.moveTo(ax * .72, ay * .72); ctx.lineTo(ax, ay); ctx.stroke();
      }
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textAlign = edge && x > W * .5 ? 'right' : 'left';
      const dir = ctx.textAlign === 'right' ? -14 : 14;
      ctx.fillStyle = 'rgba(255,232,202,.94)';
      ctx.fillText('推荐落点', dir, -3 + labelDy);
      ctx.fillStyle = 'rgba(255,232,202,.62)';
      ctx.fillText(distanceText(rec.distance), dir, 9 + labelDy);
      ctx.restore();
    }

    paintFocus(ctx, focus, planeY, sx, sy) {
      if (!focus || !Array.isArray(focus.position)) return;
      const x = sx(focus.position[0]), y = sy(focus.position[2]);
      const yaw = Number(focus.yaw) || 0;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = 'rgba(239,250,255,.9)'; ctx.fillStyle = 'rgba(239,250,255,.92)';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(yaw) * 17, -Math.cos(yaw) * 17); ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(224,242,249,.65)'; ctx.font = '9px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(focus.airborne ? '你 · 空中' : '你', -10, 24);
      ctx.restore();
    }

    paintScale(ctx, W, H, scale) {
      const metres = this.scaleStep(scale);
      const length = metres * scale;
      const x = W - 42 - length, y = H - 38;
      this.lastScaleBar = { metres, pixels: +length.toFixed(1) };
      ctx.save();
      ctx.strokeStyle = 'rgba(220,242,250,.66)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.moveTo(x + length, y - 4); ctx.lineTo(x + length, y + 4); ctx.stroke();
      ctx.fillStyle = 'rgba(220,242,250,.66)'; ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.fillText(shortDistance(metres), x + length + 10, y + 3);
      ctx.restore();
    }

    paintScanState(ctx, snapshot, W, H) {
      ctx.save();
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = snapshot.scan ? 'rgba(176,220,235,.66)' : 'rgba(255,206,158,.78)';
      const text = snapshot.scan
        ? '波速 ' + snapshot.scan.speed.toFixed(0) + ' m/s · 周期 ' + snapshot.scan.period.toFixed(0) + ' s'
        : snapshot.fieldPreview
          ? '安全区 / 感知场待命 · ' + (snapshot.field.radius >= 1000 ? (snapshot.field.radius / 1000).toFixed(1) + ' km' : Math.round(snapshot.field.radius) + ' m')
          : '安全区 / 本段无扫描';
      ctx.fillText(text, W - 42, 38);
      ctx.restore();
    }
  }

  const api = { PauseMapView };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RescuePauseMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
