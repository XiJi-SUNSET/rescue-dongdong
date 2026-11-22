/* Victory fireworks: flat paper-cut sparks with one heavy ink line, matching the
   pause map's cartoon boards. No glow, no gradients; every burst is drawn as an
   outlined petal ring plus a small four-point star. */
(() => {
  const TAU = Math.PI * 2;
  const INK = '#17120c';
  const PAPER = '#fbf2df';
  const LIFE = 1.9;
  const DURATION = 4.8;
  const BURSTS = [
    { at: .12, x: .20, y: .29, color: '#c4562f', petals: 11, spin: .55, size: 1.00 },
    { at: .78, x: .81, y: .24, color: '#eec466', petals: 9, spin: -.62, size: .86 },
    { at: 1.46, x: .13, y: .72, color: '#7cb0c3', petals: 10, spin: .48, size: .80 },
    { at: 2.06, x: .87, y: .69, color: '#c4562f', petals: 12, spin: -.40, size: .94 },
    { at: 2.66, x: .50, y: .12, color: '#eec466', petals: 9, spin: .70, size: .78 }
  ];
  const MOBILE = [
    { x: .19, y: .13 }, { x: .81, y: .15 }, { x: .16, y: .85 },
    { x: .82, y: .83 }, { x: .50, y: .08 }
  ];
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  class RescueFireworks {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.active = false;
      this.mode = null;
      this.startAt = 0;
      this.elapsed = 0;
      this.frames = 0;
      this.raf = 0;
      this.w = 1; this.h = 1; this.dpr = 1;
      this.tick = this.tick.bind(this);
    }

    resize() {
      const w = Math.max(1, this.canvas.clientWidth || 0);
      const h = Math.max(1, this.canvas.clientHeight || 0);
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      if (w === this.w && h === this.h && dpr === this.dpr) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.lineCap = 'round';
      if (this.mode === 'live') this.paint(this.elapsed, false);
      else if (this.mode === 'static') this.paint(0, true);
    }

    start() {
      this.stop();
      this.resize();
      if (this.w < 3 || this.h < 3) return;
      this.frames = 0; this.elapsed = 0;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        this.mode = 'static';
        this.paint(0, true);
        return;
      }
      this.mode = 'live';
      this.active = true;
      this.startAt = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.active = false; this.mode = null; this.elapsed = 0;
      this.ctx.clearRect(0, 0, this.w, this.h);
    }

    tick(now) {
      if (!this.active) return;
      this.elapsed = (now - this.startAt) / 1000;
      this.frames += 1;
      this.paint(this.elapsed, false);
      if (this.elapsed >= DURATION) {
        this.active = false; this.raf = 0; this.mode = null;
        this.ctx.clearRect(0, 0, this.w, this.h);
        return;
      }
      this.raf = requestAnimationFrame(this.tick);
    }

    paint(t, frozen) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      if (!this.w || !this.h) return;
      const mobile = this.w < 720;
      const base = Math.min(this.w, this.h);
      BURSTS.forEach((burst, i) => {
        const local = frozen ? LIFE * .48 : t - burst.at;
        if (local < 0 || local >= LIFE) return;
        this.burst(burst, mobile ? MOBILE[i] : burst, local, base, mobile);
      });
    }

    burst(spec, pos, local, base, mobile) {
      const ctx = this.ctx;
      const p = local / LIFE;
      const grow = easeOut(Math.min(1, p / .78));
      const fade = p < .62 ? 1 : Math.max(0, 1 - Math.pow((p - .62) / .38, 1.15));
      const radius = Math.max(mobile ? 34 : 58, Math.min(118, base * (mobile ? .16 : .115))) * spec.size;
      const cx = pos.x * this.w, cy = pos.y * this.h;
      const sag = radius * .18 * p * p;
      ctx.save();
      ctx.globalAlpha = fade;

      // One small comic pop ring around the core, gone before the petals open.
      if (p < .3) {
        const ring = radius * (.12 + .3 * easeOut(p / .3));
        ctx.beginPath(); ctx.arc(cx, cy, ring, 0, TAU);
        ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, ring, 0, TAU);
        ctx.strokeStyle = PAPER; ctx.lineWidth = 1.4; ctx.stroke();
      }

      for (let i = 0; i < spec.petals; i++) {
        const angle = -Math.PI / 2 + i / spec.petals * TAU + spec.spin * p;
        const len = radius * (i % 2 ? .92 : 1.08) * grow;
        const width = Math.max(5, radius * .09) * (.6 + .4 * Math.min(1, p / .18));
        this.petal(cx, cy, angle, len, width, sag, spec.color);
      }

      // Paper core star: the flat "pop" at the middle.
      const core = Math.max(0, 1 - p * .9);
      if (core > .02) this.star(cx, cy, radius * .16 * (1 + .2 * (1 - core)), PAPER, INK, 2.4, 8);

      // Four chunky twinkles riding the front of the burst.
      for (let i = 0; i < 4; i++) {
        const angle = -Math.PI / 2 + i * TAU / 4 + .4 + spec.spin * p * .6;
        const dist = radius * .8 * grow;
        this.star(
          cx + Math.cos(angle) * dist,
          cy + Math.sin(angle) * dist + sag * .7,
          Math.max(4.4, radius * .085) * (1 - p * .3),
          i % 2 ? PAPER : spec.color, INK, 1.8, 4
        );
      }
      ctx.restore();
    }

    petal(cx, cy, angle, len, width, sag, color) {
      const ctx = this.ctx;
      const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
      const tipR = Math.max(3.2, width * 1.05);
      const reach = Math.max(tipR + 2, len - tipR);
      const tipX = cx + dx * reach, tipY = cy + dy * reach + sag * (reach / Math.max(1, len));
      const mx = cx + dx * reach * .5, my = cy + dy * reach * .5 + sag * .5;
      // Plump rounded petal: two bulged sides joined by a round outer cap.
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(mx - nx * width, my - ny * width, tipX - nx * tipR, tipY - ny * tipR);
      ctx.arc(tipX, tipY, tipR, angle - Math.PI / 2, angle + Math.PI / 2);
      ctx.quadraticCurveTo(mx + nx * width, my + ny * width, cx, cy);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + dx * reach * .18, cy + dy * reach * .18 + sag * .08);
      ctx.quadraticCurveTo(mx + nx * width * .32, my + ny * width * .32 + sag * .3, tipX + dx * tipR * .15, tipY + dy * tipR * .15);
      ctx.strokeStyle = 'rgba(255,248,233,.55)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.stroke();
    }

    star(x, y, r, fill, stroke, lw, points) {
      if (r < .6) return;
      const ctx = this.ctx;
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const a = -Math.PI / 2 + i * TAU / points;
        const rr = i % 2 ? r * .38 : r;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
    }
  }

  window.RescueFireworks = RescueFireworks;
})();
