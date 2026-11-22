/* Procedural, texture-painted cave renderer. No reference images or character assets. */
(function (root) {
  'use strict';
  const T = root.THREE;
  const P = root.RescuePlayer?.PHYSICS;
  if (!P) throw new Error('player.js must load before scene.js so collision and rendering share dimensions.');
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  // The floor door grows from a point and the overhead exit closes behind the
  // player on the same short beat. Both are presentation only; collision uses
  // the full physical radius immediately.
  const PORTAL_OPEN_SECONDS = .3, PORTAL_CLOSE_SECONDS = .3;
  const REC_CLOSED = '#ff4a3d', REC_HALO = '#ff8578', REC_OPEN = '#a9e8ff', REC_OPEN_HALO = '#d9f7ff';
  function random(seed) {
    let s = seed >>> 0;
    return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const color = hex => new T.Color(hex);
  const vec = a => new T.Vector3(a[0], a[1], a[2]);

  // An in-memory ink / flat-paint atlas: broad soft paint lobes, low-contrast
  // bedding planes and two thin fissures. Never photographic noise, never a
  // dense sticker collage that tiles into visible repetition.
  function paintAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const c = canvas.getContext('2d');
    const r = random(711204);
    const palettes = [
      { base: '#3e5867', light: '#527082', mid: '#374f5e', dark: '#2b414d', ink: '#182832' },
      { base: '#39505c', light: '#4b6774', mid: '#324854', dark: '#263b46', ink: '#16242c' },
      { base: '#4a646f', light: '#5d7c88', mid: '#405a66', dark: '#324a56', ink: '#1b2b33' },
      { base: '#42585d', light: '#547173', mid: '#394f57', dark: '#2d424b', ink: '#19272c' }
    ];
    const lobe = (ctx, x, y, w, h, fill, alpha) => {
      ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath();
      const n = 12, ph = r() * TAU;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, k = .7 + r() * .5;
        const px = x + Math.cos(a) * w * k, py = y + Math.sin(a) * h * k + Math.sin(a * 2 + ph) * h * .14;
        if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    };
    for (let tile = 0; tile < 16; tile++) {
      const pal = palettes[tile % 4], variant = Math.floor(tile / 4);
      const ox = tile % 4 * 256, oy = variant * 256;
      c.save(); c.translate(ox, oy);
      c.beginPath(); c.rect(0, 0, 256, 256); c.clip();
      c.fillStyle = pal.base; c.fillRect(0, 0, 256, 256);
      c.filter = 'blur(8px)';
      for (let j = 0; j < 9; j++) {
        const tone = [pal.light, pal.mid, pal.dark][(j + variant) % 3];
        lobe(c, 16 + r() * 224, 16 + r() * 224, 34 + r() * 84, 22 + r() * 52, tone, .18 + r() * .22);
      }
      c.filter = 'none';
      // Bedding planes: long, low-contrast, slightly wavy bands.
      for (let j = 0; j < 5; j++) {
        const y = 18 + j * 50 + r() * 20, h = 9 + r() * 24;
        c.globalAlpha = .11 + r() * .10; c.fillStyle = j % 2 ? pal.dark : pal.light;
        c.beginPath(); c.moveTo(0, y);
        for (let x = 0; x <= 256; x += 16) c.lineTo(x, y + Math.sin(x * .03 + j * 1.7 + variant) * 8);
        for (let x = 256; x >= 0; x -= 16) c.lineTo(x, y + h + Math.sin(x * .025 + j * 2.3) * 7);
        c.closePath(); c.fill(); c.globalAlpha = 1;
      }
      // One long tapered fissure and a short fork. Ink stays thin and quiet: a
      // tile repeats, so anything loud turns into a visible grid on the rock.
      {
        const fx = 40 + r() * 160, fy = 36 + r() * 90;
        c.strokeStyle = pal.ink; c.lineCap = 'round';
        c.globalAlpha = .26; c.lineWidth = 1.8; c.beginPath();
        c.moveTo(fx, fy - 34);
        c.bezierCurveTo(fx + 14, fy + 20, fx - 6, fy + 62, fx + 16, fy + 126);
        c.stroke();
        c.lineWidth = 1.1; c.globalAlpha = .20; c.beginPath();
        c.moveTo(fx + 10, fy + 34); c.lineTo(fx - 3, fy + 52); c.stroke();
        c.globalAlpha = 1;
      }
      // Sparse pale mineral patches, no speckle noise.
      for (let j = 0; j < 2; j++) lobe(c, 20 + r() * 216, 20 + r() * 216, 8 + r() * 16, 5 + r() * 9, '#7e979f', .08 + r() * .07);
      c.restore();
    }
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
  // Interior of the cut face. A grayscale mineral painting (washes, plates,
  // tapered bristle strokes, fissures, chipped slabs) is tinted in the shader
  // by the same two rock palettes as the walls. Four painted variants sit in
  // one atlas; every hole takes its own rotated, mirrored crop.
  // Interior of the cut face, painted as four seamless rim strips. The shader
  // samples this atlas by angle and radius, so every brush mark in the strip
  // lands on the exposed band instead of being cropped away. Strips are tinted
  // by the same two rock palettes as the walls.
  function cutPaintAtlas() {
    const W = 2048, H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H * 4;
    const g = canvas.getContext('2d');
    const rnd = random(528071);
    const grey = v => { const n = Math.round(clamp(v, 0, 1) * 255); return 'rgb(' + n + ',' + n + ',' + n + ')'; };
    const rgba = (v, a) => 'rgba(' + Math.round(clamp(v, 0, 1) * 255) + ',' + Math.round(clamp(v, 0, 1) * 255) + ',' + Math.round(clamp(v, 0, 1) * 255) + ',' + a + ')';
    const wrap = (x, fn) => { fn(x - W); fn(x); fn(x + W); };
    // Broad soft pigment wash. Duplicated at +-W so the strip wraps cleanly.
    const wash = (x, y, rx, ry, v, a) => wrap(x, xx => {
      g.save(); g.translate(xx, y); g.scale(rx, ry);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, rgba(v, a)); grad.addColorStop(.55, rgba(v, a * .78)); grad.addColorStop(1, rgba(v, 0));
      g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
    });
    // Angular mineral plate, elongated along the rim, with a loaded edge.
    const plate = (x, y, rx, ry, ang, v0, v1, a, edge) => {
      const pts = [], n = 5 + Math.floor(rnd() * 3), jag = .3;
      for (let i = 0; i < n; i++) {
        const aa = ang + i / n * TAU + (rnd() - .5) * .5;
        const k = 1 - jag * (rnd() - .3);
        pts.push([Math.cos(aa) * rx * k, Math.sin(aa) * ry * k]);
      }
      const ew = 3 + rnd() * 4;
      wrap(x, xx => {
        const grad = g.createLinearGradient(xx - rx, y - ry, xx + rx, y + ry);
        grad.addColorStop(0, rgba(v0, a)); grad.addColorStop(1, rgba(v1, a));
        g.fillStyle = grad; g.beginPath();
        for (let i = 0; i < n; i++) {
          const px = xx + pts[i][0], py = y + pts[i][1];
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath(); g.fill();
        if (edge) {
          g.strokeStyle = rgba(v0 - .16, edge); g.lineWidth = ew; g.lineCap = 'round';
          g.beginPath(); g.moveTo(xx + pts[0][0], y + pts[0][1]); g.lineTo(xx + pts[1][0], y + pts[1][1]); g.stroke();
        }
      });
    };
    // Broad tapered brush mark: soft loaded underbody, one body, one core.
    // Kept deliberately coarse; the band is only a hand's width on screen.
    const brush = (x, y, ang, len, width, v, a) => {
      const n = 24, pts = [], nrm = [], wid = [];
      let px = x, py = y, dir = ang;
      for (let i = 0; i <= n; i++) {
        if (i) { dir += (rnd() - .5) * .08; px += Math.cos(dir) * len / n; py += Math.sin(dir) * len / n; }
        pts.push([px, py]);
      }
      const phase = rnd() * TAU;
      for (let i = 0; i <= n; i++) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[Math.min(n, i + 1)];
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], d = Math.hypot(dx, dy) || 1;
        nrm.push([-dy / d, dx / d]);
        wid.push(width * Math.pow(Math.sin(Math.PI * i / n), .5)
          * (.9 + .14 * Math.sin(i * .42 + phase)));
      }
      const band = (dx, i0, i1, scale, value, alpha) => {
        g.beginPath();
        for (let i = i0; i <= i1; i++) {
          const w = wid[i] * scale * .5;
          i === i0 ? g.moveTo(dx + pts[i][0] + nrm[i][0] * w, pts[i][1] + nrm[i][1] * w)
                   : g.lineTo(dx + pts[i][0] + nrm[i][0] * w, pts[i][1] + nrm[i][1] * w);
        }
        for (let i = i1; i >= i0; i--) {
          const w = wid[i] * scale * .5;
          g.lineTo(dx + pts[i][0] - nrm[i][0] * w, pts[i][1] - nrm[i][1] * w);
        }
        g.closePath(); g.fillStyle = grey(value); g.globalAlpha = alpha; g.fill();
      };
      wrap(x, dx => {
        g.save(); g.filter = 'blur(12px)'; band(dx, 1, n - 1, 1.5, v, a * .32); g.restore();
        band(dx, 1, n - 1, 1, v, a * .72);
        band(dx, 4, n - 4, .18, v < .4 ? .03 : .95, a * .2);
      });
      g.globalAlpha = 1;
    };
    // One long fissure with a light chipped lip; no hairline sub-branches.
    const crack = (x, y, ang, len, width) => {
      const pts = [[0, 0]], n = 5 + Math.floor(rnd() * 3);
      let px = 0, py = 0, dir = ang;
      for (let i = 0; i < n; i++) {
        dir += (rnd() - .5) * 1.1;
        const step = len / n * (.75 + rnd() * .5);
        px += Math.cos(dir) * step; py += Math.sin(dir) * step; pts.push([px, py]);
      }
      wrap(x, xx => {
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = grey(.82); g.globalAlpha = .24; g.lineWidth = width * .9;
        g.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const sx = xx + pts[i][0] + 2, sy = y + pts[i][1] + 2;
          i ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
        }
        g.stroke();
        g.strokeStyle = grey(.03); g.globalAlpha = .6; g.lineWidth = width;
        g.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const sx = xx + pts[i][0], sy = y + pts[i][1];
          i ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
        }
        g.stroke(); g.globalAlpha = 1;
      });
    };
    // Freshly chipped slab: pale or ashen angular facet with one sharp shadow.
    const chip = (x, y, s, ang, v) => {
      const pts = [], n = 4 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const aa = ang + i / n * TAU + (rnd() - .5) * .35;
        pts.push([Math.cos(aa) * s * (.5 + rnd() * .7), Math.sin(aa) * s * (.35 + rnd() * .5)]);
      }
      const edgeW = 2.2 + rnd() * 2.2;
      wrap(x, xx => {
        g.fillStyle = grey(v); g.globalAlpha = .72;
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const px = xx + pts[i][0], py = y + pts[i][1];
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath(); g.fill();
        g.strokeStyle = grey(v > .5 ? .04 : .84); g.globalAlpha = v > .5 ? .42 : .28;
        g.lineWidth = edgeW; g.lineJoin = 'miter';
        g.beginPath(); g.moveTo(xx + pts[0][0], y + pts[0][1]); g.lineTo(xx + pts[1][0], y + pts[1][1]); g.stroke();
        g.globalAlpha = 1;
      });
    };
    // Long bedding seams: periodic over the full width, so they wrap invisibly.
    const strata = (y0, h, v, a, phase) => {
      g.globalAlpha = a; g.fillStyle = grey(v); g.beginPath();
      for (let x = 0; x <= W; x += 24) g.lineTo(x, y0 + Math.sin(x / W * TAU * 2 + phase) * 12);
      for (let x = W; x >= 0; x -= 24) g.lineTo(x, y0 + h + Math.sin(x / W * TAU * 2 + phase + 1.3) * 9);
      g.closePath(); g.fill(); g.globalAlpha = 1;
    };
    for (let t = 0; t < 4; t++) {
      g.save(); g.translate(0, t * H);
      const bias = (rnd() - .5) * .32;
      g.fillStyle = grey(.48); g.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) wash(rnd() * W, H * (.12 + rnd() * .76), 460 + rnd() * 360, 150 + rnd() * 150,
        i % 2 ? .62 + rnd() * .07 : .27 + rnd() * .09, .5);
      for (let i = 0; i < 1; i++) strata(H * (.2 + rnd() * .5), 70 + rnd() * 90, i ? .32 : .62, .14, rnd() * TAU);
      for (let i = 0; i < 6; i++) {
        const dark = rnd() < .32, light = !dark && rnd() < .5;
        const v0 = dark ? .27 + rnd() * .10 : light ? .57 + rnd() * .08 : .40 + rnd() * .08;
        plate(rnd() * W, H * (.08 + rnd() * .84), 320 + rnd() * 300, 90 + rnd() * 120,
          bias + (rnd() - .5) * .32, v0, v0 + (rnd() < .5 ? .09 : -.09), .58, rnd() < .5 ? .26 : 0);
      }
      for (let i = 0; i < 5; i++) {
        const light = rnd() < .30;
        brush(rnd() * W, H * (.04 + rnd() * .92), bias + (rnd() - .5) * (rnd() < .75 ? .36 : .7),
          520 + rnd() * 420, 62 + rnd() * 60,
          light ? .66 + rnd() * .09 : .10 + rnd() * .10, light ? .34 : .42);
      }
      for (let i = 0; i < 1; i++) crack(rnd() * W, rnd() * H, Math.PI / 2 + (rnd() - .5) * .8, 320 + rnd() * 140, 3 + rnd() * 2);
      for (let i = 0; i < 1; i++) crack(rnd() * W, rnd() * H, bias + (rnd() - .5) * .3, 620 + rnd() * 280, 3 + rnd() * 2);
      for (let i = 0; i < 3; i++) chip(rnd() * W, rnd() * H, 64 + rnd() * 56, rnd() * TAU, rnd() < .6 ? .76 + rnd() * .10 : .12 + rnd() * .06);
      g.restore();
    }
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.NoColorSpace;
    texture.wrapS = T.RepeatWrapping;
    texture.wrapT = T.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.magFilter = T.LinearFilter;
    return texture;
  }
  function glowTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const c = canvas.getContext('2d');
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(160,233,255,.65)'); g.addColorStop(.16, 'rgba(116,212,249,.36)');
    g.addColorStop(.42, 'rgba(88,190,241,.10)'); g.addColorStop(1, 'rgba(66,151,219,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    return new T.CanvasTexture(canvas);
  }
  function mergedGeometry(parts) {
    let p = [], n = [], uv = [], colors = [], strata = [], strataNormals = [];
    for (const part of parts) {
      const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
      p.push(...g.attributes.position.array);
      n.push(...g.attributes.normal.array);
      uv.push(...g.attributes.uv.array);
      strata.push(...g.attributes.strata.array);
      strataNormals.push(...g.attributes.strataNormal.array);
      const count = g.attributes.position.count;
      for (let i = 0; i < count; i++) colors.push(part.shade, part.shade, part.shade);
      g.dispose(); if (g !== part.geometry) part.geometry.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(p, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(n, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    out.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    out.setAttribute('strata', new T.Float32BufferAttribute(strata, 3));
    out.setAttribute('strataNormal', new T.Float32BufferAttribute(strataNormals, 3));
    out.computeBoundingSphere(); return out;
  }
  function stoneGeometry(position, scale, rotation, r, tile, seg = [18, 12]) {
    const g = new T.SphereGeometry(1, seg[0], seg[1]);
    const p = g.attributes.position, uv = g.attributes.uv;
    const phase = r() * TAU, blockiness = (scale[1] < .9 ? .34 : .52) + r() * .18;
    const localCoords = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const round = q => Math.sign(q) * Math.pow(Math.abs(q), blockiness);
      const ripple = 1 + .065 * Math.sin(x * 5 + y * 3 + phase) + .04 * Math.cos(z * 7 - y * 4 + phase);
      const lx = round(x) * ripple + .10 * y * z, ly = round(y) * ripple + .055 * x, lz = round(z) * ripple;
      p.setXYZ(i, lx * scale[0], ly * scale[1], lz * scale[2]);
      localCoords.push(lx, ly, lz);
      uv.setXY(i, (tile % 4 + .015 + uv.getX(i) * .97) / 4, (Math.floor(tile / 4) + .015 + uv.getY(i) * .97) / 4);
    }
    g.computeVertexNormals();
    g.setAttribute('strata', new T.Float32BufferAttribute(localCoords, 3));
    g.setAttribute('strataNormal', new T.Float32BufferAttribute(g.attributes.normal.array.slice(), 3));
    g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]);
    g.translate(...position); return g;
  }

  // Deterministic build-time field. Only ever evaluated on the CPU, never in a shader.
  function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123; return s - Math.floor(s); }
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
    const a = hash3(xi, yi, zi), b = hash3(xi + 1, yi, zi), c = hash3(xi, yi + 1, zi), d = hash3(xi + 1, yi + 1, zi);
    const e = hash3(xi, yi, zi + 1), f = hash3(xi + 1, yi, zi + 1), g = hash3(xi, yi + 1, zi + 1), h = hash3(xi + 1, yi + 1, zi + 1);
    const l1 = a + (b - a) * u, l2 = c + (d - c) * u, l3 = e + (f - e) * u, l4 = g + (h - g) * u;
    const m1 = l1 + (l2 - l1) * v, m2 = l3 + (l4 - l3) * v;
    return m1 + (m2 - m1) * w;
  }
  function fbm(x, y, z, oct = 3) {
    let sum = 0, amp = .5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, z * f); norm += amp; f *= 2.07; amp *= .5; }
    return sum / norm;
  }

  // One continuous grotto: a vertical-walled chamber that closes into a vault.
  // Radii are driven by a few broad lobes plus a carved console bay, so the
  // silhouette never breaks into the regular crystal facets of stacked boulders.
  const HALL = { rx: 15.0, rz: 13.2, height: 10.6, bayX: 11.8, bayZ: -2.4 };
  function hallRibs(rnd) {
    const ribs = [];
    for (let i = 0; i < 6; i++) ribs.push({ a: rnd() * TAU, w: .13 + rnd() * .16, amp: .035 + rnd() * .07, y0: -.3, y1: .82 + rnd() * .16 });
    // A carved bay behind the control installation: consoles sit inside rock, not on air.
    ribs.push({ a: -0.16, w: .40, amp: -.19, y0: -.3, y1: .60, alcove: true });
    ribs.push({ a: .86, w: .30, amp: .10, y0: -.3, y1: .86 });
    ribs.push({ a: 2.66, w: .26, amp: .09, y0: -.3, y1: .9 });
    return ribs;
  }
  function wallForm(a, yf, ribs) {
    let s = 1 + .05 * Math.sin(a * 2 + .8) + .034 * Math.sin(a * 3 - 1.7) + .018 * Math.sin(a * 5 + 2.2);
    let alcove = 0;
    for (const rib of ribs) {
      let d = a - rib.a; d = Math.atan2(Math.sin(d), Math.cos(d));
      const env = smooth((yf - rib.y0) / .18) * (1 - smooth((yf - rib.y1) / .22));
      const g = Math.exp(-(d * d) / (2 * rib.w * rib.w)) * env;
      s += rib.amp * g;
      if (rib.alcove) alcove = Math.max(alcove, g);
    }
    return { s, alcove };
  }
  function hallPoint(a, phi, ribs) {
    const sn = Math.sin(phi);
    const yBase = sn < 0 ? sn * HALL.height * 1.15 : HALL.height * Math.pow(sn, 1.06);
    const spread = Math.pow(Math.max(1e-4, Math.cos(phi)), .58);
    const form = wallForm(a, clamp(yBase / HALL.height, 0, 1), ribs);
    const bx = Math.cos(a) * HALL.rx, bz = Math.sin(a) * HALL.rz;
    const damp = 1 - .78 * form.alcove;
    const n1 = fbm(bx * .082, yBase * .11, bz * .082, 3) - .5;
    const n2 = fbm(bx * .29, yBase * .32, bz * .29, 2) - .5;
    const rad = form.s * spread * (1 + (n1 * .30 + n2 * .085) * damp);
    let x = bx * rad, z = bz * rad, y = yBase;
    const bay = form.alcove * (1 - smooth((yBase - 6.0) / 2.6));
    if (bay > .002 && x < HALL.bayX) x += (HALL.bayX - x) * Math.min(1, bay * 1.15);
    y += (fbm(x * .15, 4.3, z * .15, 2) - .5) * 1.3 * Math.pow(Math.max(0, sn), 4);
    return [x, y, z];
  }
  function floorHeightAt(x, z, u) {
    const dip = fbm(x * .19, 5.3, z * .19, 3) - .5;
    let h = dip * .19 * (.3 + .7 * smooth((u - .28) / .5));
    const talus = smooth((u - .72) / .28);
    h += Math.pow(talus, 1.6) * (1.0 + .5 * (fbm(x * .3, 9.1, z * .3, 2) - .5));
    // A low stone shelf the console and rack are bedded into.
    const ex = (x - 9.3) / 3.1, ez = (z - HALL.bayZ) / 4.6, eq = Math.hypot(ex, ez);
    if (eq < 1) h += .25 * Math.pow(1 - eq * eq, 1.5) * (.8 + .4 * fbm(x * .5, 12.7, z * .5, 2));
    return h;
  }
  // Winding check averaged over many triangles: a single fan sliver at the
  // centre of a radial grid is too degenerate to decide orientation.
  function ensureFacing(g, cx, cy, cz, inward) {
    const p = g.attributes.position, idx = g.index.array;
    const score = () => {
      let sum = 0;
      const step = Math.max(3, Math.floor(idx.length / 3 / 300) * 3);
      for (let t = 0; t < idx.length - 2; t += step) {
        const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
        const ax = p.getX(i0), ay = p.getY(i0), az = p.getZ(i0);
        const e1x = p.getX(i1) - ax, e1y = p.getY(i1) - ay, e1z = p.getZ(i1) - az;
        const e2x = p.getX(i2) - ax, e2y = p.getY(i2) - ay, e2z = p.getZ(i2) - az;
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const mx = (ax + p.getX(i1) + p.getX(i2)) / 3 - cx, my = (ay + p.getY(i1) + p.getY(i2)) / 3 - cy, mz = (az + p.getZ(i1) + p.getZ(i2)) / 3 - cz;
        const nl = Math.hypot(nx, ny, nz) || 1, ml = Math.hypot(mx, my, mz) || 1;
        sum += (nx * mx + ny * my + nz * mz) / (nl * ml);
      }
      return sum;
    };
    const s = score(); if (!s) return;
    // s > 0 means the average normal points away from the reference point.
    if (inward ? s > 0 : s < 0) {
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.index.needsUpdate = true;
    }
  }
  // One shared world-space paint field for every rock part so the atlas never
  // changes scale where a boulder meets the floor. `scale` is kept for callers
  // that still pass a density hint, but the field is deliberately uniform.
  const PAINT_FIELD = .3;
  function tagGeometry(g, tile, scale, shade) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const st = [], sn = [];
    for (let i = 0; i < p.count; i++) {
      st.push(p.getX(i) * PAINT_FIELD, p.getY(i) * PAINT_FIELD, p.getZ(i) * PAINT_FIELD);
      sn.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    g.setAttribute('strata', new T.Float32BufferAttribute(st, 3));
    g.setAttribute('strataNormal', new T.Float32BufferAttribute(sn, 3));
    const cu = (tile % 4) / 4, cv = Math.floor(tile / 4) / 4;
    if (uv) {
      let um = Infinity, uM = -Infinity, vm = Infinity, vM = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        if (u < um) um = u; if (u > uM) uM = u; if (v < vm) vm = v; if (v > vM) vM = v;
      }
      const du = Math.max(1e-3, uM - um), dv = Math.max(1e-3, vM - vm);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, cu + .01 + (uv.getX(i) - um) / du * .23, cv + .01 + (uv.getY(i) - vm) / dv * .23);
    } else {
      const flat = [];
      for (let i = 0; i < p.count; i++) flat.push(cu + .125, cv + .125);
      g.setAttribute('uv', new T.Float32BufferAttribute(flat, 2));
    }
    return { geometry: g, shade };
  }
  function hallShellGeometry(ribs) {
    const NA = 112, NP = 40, phi0 = -0.14, phi1 = 1.555;
    const pos = [];
    for (let j = 0; j < NP; j++) {
      const phi = phi0 + (phi1 - phi0) * Math.pow(j / (NP - 1), .9);
      for (let i = 0; i < NA; i++) {
        const p = hallPoint(i / NA * TAU, phi, ribs);
        pos.push(p[0], p[1], p[2]);
      }
    }
    const apex = pos.length / 3;
    pos.push(0, HALL.height * 1.015, 0);
    const idx = [];
    for (let j = 0; j < NP - 1; j++) for (let i = 0; i < NA; i++) {
      const i2 = (i + 1) % NA, a = j * NA + i, b = j * NA + i2, c = (j + 1) * NA + i, d = (j + 1) * NA + i2;
      idx.push(a, c, b, b, c, d);
    }
    // The apex fan must follow the same inward winding as the body rings. Mixed
    // winding survives the whole-mesh average check and leaves a hole overhead.
    for (let i = 0; i < NA; i++) idx.push((NP - 1) * NA + i, (NP - 1) * NA + (i + 1) % NA, apex);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    ensureFacing(g, 0, HALL.height * .45, 0, true);
    g.computeVertexNormals();
    return g;
  }
  function hallFloorGeometry(ribs) {
    const NA = 96, NR = 22, rim = [];
    for (let i = 0; i < NA; i++) rim.push(hallPoint(i / NA * TAU, .04, ribs));
    const pos = [0, floorHeightAt(0, 0, 0), 0];
    for (let k = 1; k < NR; k++) {
      const u = Math.pow(k / (NR - 1), 1.32);
      for (let i = 0; i < NA; i++) {
        const x = rim[i][0] * u * 1.045, z = rim[i][2] * u * 1.045;
        pos.push(x, floorHeightAt(x, z, u), z);
      }
    }
    const idx = [];
    // Centre fan faces up like the rest of the floor. Reversed winding here is
    // culled from every standing view and reads as a black hole underfoot.
    for (let i = 0; i < NA; i++) idx.push(0, 1 + (i + 1) % NA, 1 + i);
    for (let k = 1; k < NR - 1; k++) for (let i = 0; i < NA; i++) {
      const i2 = (i + 1) % NA, a = 1 + (k - 1) * NA + i, b = 1 + (k - 1) * NA + i2, c = 1 + k * NA + i, d = 1 + k * NA + i2;
      idx.push(a, b, c, b, d, c);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    ensureFacing(g, 0, 40, 0, true);
    g.computeVertexNormals();
    return g;
  }
  function spikeGeometry(rnd, radius, length) {
    const RAD = 9, ROWS = 12;
    const phase = rnd() * TAU, leanX = (rnd() - .5) * .2, leanZ = (rnd() - .5) * .2;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= ROWS; j++) {
      const t = j / ROWS, taper = Math.pow(1 - t, .72) * (1 - .55 * Math.pow(t, 6));
      const wob = Math.sin(t * 3.2 + phase) * .05 * length;
      for (let i = 0; i < RAD; i++) {
        const a = i / RAD * TAU;
        const rr = Math.max(.014, radius * taper * (1 + .20 * Math.sin(a * 3 + t * 2.2 + phase)) * (1 + .16 * Math.sin(t * 7 + phase) + .08 * Math.sin(t * 13.3 + a)));
        pos.push(Math.cos(a) * rr + leanX * length * t * t + wob, -length * t, Math.sin(a) * rr + leanZ * length * t * t);
        uv.push(i / RAD, t);
      }
    }
    const top = pos.length / 3; pos.push(leanX * length * .1 + 0.14 * Math.sin(phase), .18, 0); uv.push(.5, .5);
    const tip = pos.length / 3; pos.push(leanX * length, -length, leanZ * length); uv.push(.5, 1);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < RAD; i++) {
      const i2 = (i + 1) % RAD, a = j * RAD + i, b = j * RAD + i2, c = (j + 1) * RAD + i, d = (j + 1) * RAD + i2;
      idx.push(a, b, c, b, d, c);
    }
    for (let i = 0; i < RAD; i++) {
      idx.push(top, (i + 1) % RAD, i);
      idx.push(tip, ROWS * RAD + i, ROWS * RAD + (i + 1) % RAD);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    ensureFacing(g, 0, -length * .45, 0, false);
    g.computeVertexNormals();
    return g;
  }
  const rockVertex = `
    attribute vec3 strata; attribute vec3 strataNormal;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vShade;
    varying vec3 vStrata; varying vec3 vStrataNormal;
    void main(){
      vStrata=strata; vStrataNormal=strataNormal;
      vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vShade=color;
      vec4 world=modelMatrix*vec4(position,1.0); vP=world.xyz;
      gl_Position=projectionMatrix*viewMatrix*world;
    }`;
  const rockFragment = `
    uniform sampler2D atlas; uniform vec3 fogColor; uniform vec3 flamePosition;
    uniform vec3 portalPosition; uniform float portalPower; uniform float rockKind;
    uniform vec3 waveCenters[5]; uniform float waveRadii[5]; uniform float wavePowers[5];
    uniform float singleFront; uniform float singlePower;
    uniform vec4 aoOval; uniform float aoStrength; uniform vec4 hallGlow;
    varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vShade;
    varying vec3 vStrata; varying vec3 vStrataNormal;
    void main(){
      vec3 n=normalize(vN);
      // Three cel bands plus a slow field wobble: flat paint, never a gradient ramp.
      float light=dot(n,normalize(vec3(-.42,.76,.50)));
      float tone=light>.44?1.03:(light>.10?.71:(light>-.22?.41:.19));
      // Surfaces facing the floor (vault, stalactite undersides) sit deeper in
      // shadow than the walls the room light actually reaches.
      tone*=1.0-.18*smoothstep(.12,.85,-n.y);
      tone*=1.0+.045*sin(vP.x*1.9+vP.y*1.3+vP.z*1.6);
      vec3 weights=pow(abs(normalize(vStrataNormal)),vec3(4.0));
      weights/=max(.001,weights.x+weights.y+weights.z);
      // The atlas tile repeats on a mirrored ~5 m field: broad paint stays broad,
      // but the wall no longer stretches a single 30 m smear across the frame.
      vec3 field=vStrata*.606+.5;
      vec3 coord=clamp(1.0-abs(fract(field)*2.0-1.0),.02,.98);
      vec2 tile=floor(vUv*4.0);
      vec3 paint=texture2D(atlas,(tile+coord.zy)*.25).rgb*weights.x;
      paint+=texture2D(atlas,(tile+coord.xz)*.25).rgb*weights.y;
      paint+=texture2D(atlas,(tile+coord.xy)*.25).rgb*weights.z;
      // Folded mineral lenses and thin bedding seams: large paint events only.
      float lens=sin(vP.x*1.05+vP.z*.82+vP.y*.94)*sin(vP.y*1.27-vP.x*.71+.9);
      paint*=1.0+lens*.10;
      float seamPhase=fract(vP.y*.62+.20*sin(vP.x*.52+vP.z*.44));
      float seam=1.0-smoothstep(.0,.032,min(seamPhase,1.0-seamPhase));
      float faceSeam=mix(.45,1.0,1.0-smoothstep(.22,.72,abs(n.y)));
      paint*=1.0-.30*seam*faceSeam;
      paint=mix(paint,paint*1.16,smoothstep(.62,.9,seamPhase)*.45*(1.0-smoothstep(.3,.8,abs(n.y))));
      // Unique broken fissures in world space: the atlas repeats, these do not.
      float f1=abs(sin(vP.x*.37+vP.z*.29+vP.y*.15)+.36*sin(vP.z*1.1-vP.y*.63+.4));
      float fiss=1.0-smoothstep(.010,.040,f1);
      float gate=smoothstep(.30,.62,fract(vP.z*.115+vP.x*.061+vP.y*.083));
      gate*=smoothstep(.34,.66,fract(vP.x*.83+vP.z*.57+vP.y*.41));
      paint=mix(paint,paint*.45,fiss*gate*.62*(1.0-smoothstep(.35,.85,abs(n.y))));
      float luminance=dot(paint,vec3(.2126,.7152,.0722));
      paint=mix(paint,vec3(1.05,.87,.72)*luminance,rockKind);
      vec3 base=paint*max(vShade,vec3(.001))*tone;
      // Baked contact: soft occlusion in the console bay and along the chamber rim
      // keeps the floor attachments and the wall base visually seated.
      vec2 q=(vP.xz-aoOval.xy)/max(aoOval.zw,vec2(.001));
      float contact=1.0-smoothstep(.20,1.10,length(q));
      float rim=smoothstep(.66,1.02,length(vP.xz/vec2(14.6,12.8)));
      float lowMask=1.0-smoothstep(.10,2.9,vP.y);
      base*=1.0-aoStrength*lowMask*(contact*.60+rim*.34);
      // A restrained warm bounce off the console so the rock reads as lit by the room.
      vec3 gl=hallGlow.xyz-vP;
      float glow=hallGlow.w*exp(-dot(gl,gl)*.085)*max(0.0,dot(-n,normalize(gl*.6+vec3(0.0,.8,0.0))));
      base+=vec3(.11,.082,.05)*glow;
      float blue=max(0.0,1.0-length(vP-flamePosition)/7.0);
      base+=vec3(.005,.032,.056)*blue*blue;
      float portal=max(0.0,1.0-length(vP-portalPosition)/5.0)*portalPower;
      base+=vec3(.018,.055,.043)*portal;
      float wave=0.0;
      for(int i=0;i<5;i++) {
        float d=abs(length(vP-waveCenters[i])-waveRadii[i]);
        wave+=exp(-d*d*6.0)*wavePowers[i];
      }
      float sd=abs(vP.z-singleFront);
      wave+=exp(-sd*sd*5.0)*singlePower;
      base+=vec3(.018,.11,.14)*min(wave,1.0);
      float fog=smoothstep(20.0,53.0,length(cameraPosition-vP));
      gl_FragColor=vec4(mix(base,fogColor,fog*.82),1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  // Geological fields are sampled in three dimensions, never UV-wrapped or displaced.
  // Both shells keep their exact analytic radius; only their exposed cut is coloured.
  const cavityVertex = `
    varying vec3 vP; varying vec3 vN;
    void main(){vec4 p=modelMatrix*vec4(position,1.0);vP=p.xyz;
      vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*p;}`;
  const cavityFragment = `
    uniform float rockKind; uniform float geologySeed; uniform vec3 strataAxis;
    uniform float strataWidth; uniform float strataStyle;
    uniform vec3 flamePosition; uniform float mainRadius;
    uniform vec3 repairCenter; uniform float repairRadius; uniform float shellRole;
    uniform vec3 waveCenters[5]; uniform float waveRadii[5]; uniform float wavePowers[5];
    uniform float singleFront; uniform float singlePower;
    varying vec3 vP; varying vec3 vN;
    void main(){
      vec3 mainCenter=vec3(0.0,mainRadius,0.0);
      if(shellRole<.5 && repairRadius>0.0 && distance(vP,repairCenter)<repairRadius-.008)discard;
      if(shellRole>.5 && distance(vP,mainCenter)<mainRadius-.008)discard;
      // The entry is an actual raised disk. Never paint a second black hole on the floor.
      vec3 a=normalize(strataAxis),b=normalize(cross(a,vec3(.17,.93,.31))),c=cross(a,b);
      vec3 p=(vP-mainCenter)*(5.2/mainRadius);float u=dot(p,a),v=dot(p,b),w=dot(p,c),s=geologySeed;
      float fold=.24*sin(v*.72+s)+.13*sin(w*1.15-v*.3+s*.7);
      if(strataStyle>1.5)fold+=.48*sin(v*.45+w*.41+s);
      float layer=(u+fold)/strataWidth+s;
      float band=fract(layer),edge=min(band,1.0-band);
      float mask=smoothstep(.006,.017,edge);
      vec3 cool=vec3(.095,.148,.181),warm=vec3(.157,.165,.148);
      vec3 paint=mix(cool,warm,rockKind);
      float grade=mod(floor(layer),5.0);
      paint*=grade<1.0?.80:(grade<2.0?1.18:(grade<4.0?1.0:.91));
      // Broad flat mineral lenses are intersections of folded 3D fields.
      float lens=sin(u*.8+w*.64+s)*sin(v*.61-w*.3+s*.3);
      if(lens>.48)paint=mix(paint,mix(vec3(.14,.22,.25),vec3(.22,.25,.23),rockKind),.42);
      if(lens<-.61)paint*=.85;
      vec3 ink=mix(vec3(.036,.070,.084),vec3(.065,.087,.086),rockKind);
      paint=mix(ink,paint,mask*.82+.18);
      // Blue seams are localized minerals in warm grey bedrock, not a global tint.
      float seam=abs(sin(u*.79+w*.55+.25*sin(v*1.3)+s));
      float vein=1.0-smoothstep(.022,.062,seam);
      if(rockKind>.5)paint=mix(paint,vec3(.080,.235,.315),vein*.85);
      else paint=mix(paint,vec3(.31,.40,.43),vein*.24);
      // Finite tapered cracks and their fork, in a second geological plane.
      float fissure=abs(v+.18*sin(u*3.1+s)+.09*sin(w*4.0)-floor(v/2.7+.5)*2.7);
      float ends=smoothstep(.2,.8,sin(u*.95+s)*cos(w*.63));
      float crack=(1.0-smoothstep(.009,.025,fissure))*ends;
      float fork=abs(v+.46*(u-floor(u/3.7+.5)*3.7)+.06*sin(w*5.0)-floor(v/2.7+.5)*2.7);
      crack=max(crack,(1.0-smoothstep(.008,.019,fork))*ends*step(.66,sin(u*1.9+s)));
      paint=mix(paint,ink,crack*.86);
      vec3 n=-normalize(vN);
      vec3 lamp=mainCenter+vec3(-.32,.12,.30)*mainRadius-vP;
      float light=max(0.0,dot(n,normalize(lamp)))/(1.0+dot(lamp,lamp)*.045);
      float tone=.27+light*1.4;
      // Height-dependent bounce and a grazing-angle falloff reveal the continuous
      // bowl and vault, rather than a uniformly lit wallpaper in front of the eye.
      float bounce=1.0-smoothstep(.0,mainRadius*1.65,vP.y);
      tone+=bounce*.30;
      tone*=.62+.38*pow(max(0.0,dot(n,normalize(cameraPosition-vP))),.65);
      if(shellRole>.5)tone*=.68+.32*smoothstep(-1.5,1.0,vP.y);
      if(shellRole<.5 && repairRadius>0.0){float rim=abs(distance(vP,repairCenter)-repairRadius);paint=mix(ink,paint,smoothstep(.012,.058,rim));}
      vec3 base=paint*tone;
      float blue=max(0.0,1.0-distance(vP,flamePosition)/8.0);
      base+=vec3(.002,.012,.022)*blue*blue;
      float wave=0.0;for(int i=0;i<5;i++){float d=abs(distance(vP,waveCenters[i])-waveRadii[i]);wave+=exp(-d*d*6.0)*wavePowers[i];}
      float d=abs(vP.z-singleFront);wave+=exp(-d*d*5.0)*singlePower;
      base+=vec3(.014,.066,.083)*min(1.0,wave);
      gl_FragColor=vec4(base,1.0);
      #include <colorspace_fragment>
    }`;
  const outlineVertex = `
    varying float vDistance;
    void main(){
      vec4 p=modelMatrix*vec4(position+normal*.032,1.0);
      vDistance=length(cameraPosition-p.xyz);
      gl_Position=projectionMatrix*viewMatrix*p;
    }`;
  const outlineFragment = `
    uniform vec3 ink; uniform vec3 fogColor; varying float vDistance;
    void main(){gl_FragColor=vec4(mix(ink,fogColor,smoothstep(20.0,53.0,vDistance)*.82),1.0);
      #include <colorspace_fragment>
    }`;
  // The void stays pure black. Around it is the exposed rock cut, painted like
  // the hand-brushed cave walls: only two rock families (olive-grey and
  // blue-grey), with the mineral pattern fully reseeded per hole.
  const cutVertex = `
    varying vec2 vP;
    void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
  const cutFragment = `
    uniform float cutSeed; uniform float cutKind; uniform float cutStyle;
    uniform sampler2D cutPaint;
    varying vec2 vP;
    float ch(vec2 p){
      p=fract(p*vec2(.3183099,.3678794)+cutSeed*.0001+vec2(.1,.2));
      p=fract(p*(p+1.0));
      return fract(p.x*p.y*43758.5453+cutSeed*.173);
    }
    float cn(vec2 p){
      vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(ch(i),ch(i+vec2(1.0,0.0)),f.x),
                 mix(ch(i+vec2(0.0,1.0)),ch(i+vec2(1.0,1.0)),f.x),f.y);
    }
    float cf(vec2 p){
      float v=0.0,a=.56;
      v+=a*cn(p); p=p*2.03+vec2(13.7,7.9); a*=.52;
      v+=a*cn(p); p=p*2.07+vec2(4.9,11.3); a*=.50;
      v+=a*cn(p);
      return v;
    }
    float cang(float ang,float centre){
      return atan(sin(ang-centre),cos(ang-centre));
    }
    void main(){
      float seed=cutSeed;
      vec2 sd=vec2(seed*1.73,seed*.91);
      vec2 p=vP;
      float r=length(p),ang=atan(p.y,p.x);
      float k=clamp(cutKind,0.0,1.0);
      float mode=mod(cutStyle,4.0);

      // A per-hole asymmetric footprint: a first-harmonic lobe plus chipped
      // notches means the exposed band is wide on one side and skeletal on the
      // other, so two holes never read as the same turned ring.
      float sizeVar=1.42-.05*ch(vec2(seed*.71,1.31));
      float lobe=.110*cos(ang-seed*2.3)+.040*cos(2.0*ang+seed*1.1);
      float wob=.050*sin(ang*2.0+seed*.37)+.030*sin(ang*3.0-seed*.91)
               +.018*sin(ang*5.0+seed*1.31)+.012*sin(ang*8.0-seed*.47);
      float notch=exp(-pow(cang(ang,seed*1.9+.6)/.07,2.0))*.110
                 +exp(-pow(cang(ang,seed*3.1+2.4)/.045,2.0))*.065
                 +exp(-pow(cang(ang,seed*4.3+1.7)/.11,2.0))*.055*(.5+.5*cn(vec2(seed*2.2,seed*.59)))
                 +exp(-pow(cang(ang,seed*5.3+2.1)/.035,2.0))*.030
                 +exp(-pow(cang(ang,seed*6.1+.4)/.028,2.0))*.022;
      float outer=sizeVar+lobe+wob-notch+(mode-1.5)*.018;
      outer=max(outer,1.33);
      float lip=1.0+.006*sin(ang*3.0+seed*.83)+.012*(cn(vec2(ang*4.5+seed,seed*.37))-.5);
      // The inner lip is broken by the same chisel that cut the hole: bumps
      // survive in places, get bitten away in others.
      float lipBite=.55+.45*cn(vec2(ang*5.2+seed*2.6,seed*.53));
      lipBite*=1.0-.55*exp(-pow(cang(ang,seed*3.7+1.4)/.060,2.0));
      lip+=(exp(-pow(cang(ang,seed*2.1+1.1)/.080,2.0))*.050
          +exp(-pow(cang(ang,seed*1.7+2.2)/.055,2.0))*.030)*lipBite;
      lip+=exp(-pow(cang(ang,seed*2.9+2.9)/.045,2.0))*.016*(.5+.5*cn(vec2(seed*3.1,seed*.47)));
      lip=min(lip,1.07);

      // Two rock families only, keyed to the live cave wall: cool blue-grey
      // bedrock and warm olive-grey strata. No third colour scheme, no metal.
      vec3 ink =mix(vec3(.0130,.0230,.0270),vec3(.0240,.0240,.0140),k);
      vec3 deep=mix(vec3(.0350,.0520,.0600),vec3(.0500,.0480,.0320),k);
      vec3 base=mix(vec3(.0850,.1150,.1260),vec3(.1000,.0970,.0680),k);
      vec3 mid =mix(vec3(.1150,.1500,.1620),vec3(.1250,.1210,.0860),k);
      vec3 lit =mix(vec3(.1600,.2000,.2120),vec3(.1550,.1500,.1100),k);
      vec3 pale=mix(vec3(.1900,.2350,.2500),vec3(.1800,.1740,.1280),k);
      float tint=ch(vec2(seed*1.37,4.17));

      // Painted mineral map, unwrapped around the rim: u runs once around the
      // hole, v runs lip to outer edge. Each hole picks one of four painted
      // strips and its own angular offset / direction, so the whole painted band
      // is used and the same seed keeps the preview identical to the opened hole.
      float su=ang/6.2831853+seed*.2183;
      if(ch(vec2(seed*.27,9.3))>.5)su=seed*.2183-ang/6.2831853;
      float sv=clamp((r-lip)/max(outer-lip,1e-3),0.0,1.0);
      vec2 uv=vec2(su,.75-mode*.25+sv*.25);
      float pv=texture2D(cutPaint,uv).r;
      vec3 col=mix(ink,deep,smoothstep(0.0,.18,pv));
      col=mix(col,base,smoothstep(.18,.46,pv));
      col=mix(col,mid,smoothstep(.46,.66,pv));
      col=mix(col,lit,smoothstep(.66,.85,pv));
      col=mix(col,pale,smoothstep(.85,.98,pv));
      col*=mix(vec3(.95,1.02,1.05),vec3(1.04,1.01,.97),tint);

      // The same painted value doubles as a shallow height field: loaded plates
      // and brush bodies bevel against cracks and scratches. No specular term.
      vec2 q=p+(vec2(cn(p*.62+sd*1.9),cn(p*.62+sd+vec2(5.7,9.2)))-.5)*.55;
      vec2 qx=dFdx(p),qy=dFdy(p);
      float jdet=qx.x*qy.y-qx.y*qy.x; jdet=sign(jdet)*max(abs(jdet),1e-6);
      vec2 hg=vec2(dFdx(pv),dFdy(pv));
      vec2 grad=mat2(qy.y,-qy.x,-qx.y,qx.x)*hg/jdet;
      grad=clamp(grad,-12.0,12.0);
      vec3 nb=normalize(vec3(-grad*.035,1.0));
      float relief=.5+.5*dot(nb,normalize(vec3(-.48,.62,.62)));
      col*=.93+.105*relief;

      // Soft dome shading and a settled outer edge keep the cut face inside the
      // floor instead of reading as a pasted disk. A weak cross-light breaks the
      // single radial gradient so the rim is not an even turned tube.
      vec2 ldir=normalize(vec2(-.52,.85));
      vec2 n=p/max(r,.0001);
      float dome=.5+.5*dot(n,ldir);
      float cross=.5+.5*dot(n,vec2(cos(seed*2.6+1.1),sin(seed*2.6+1.1)));
      col*=.95+.07*dome+.035*cross;
      col*=mix(1.0,.90,smoothstep(outer-.16,outer,r));

      // The void pulls the last few centimetres of rock into shadow; that depth
      // is what reads as a cut, not a bright bevel.
      col*=mix(.76,1.0,smoothstep(0.0,.13,r-lip));
      float seam=1.0-smoothstep(.0,.011,r-lip);
      col=mix(col,ink,seam*.78);
      float outline=1.0-smoothstep(.0,.0090,outer-r);
      outline*=.45+.55*cn(q*1.7+sd*2.3);
      col=mix(col,ink,outline*.52);

      float aa=fwidth(r)*1.2+.0015;
      float core=smoothstep(lip-aa,lip+aa,r)*(1.0-smoothstep(outer-aa,outer+aa,r));
      float halo=(1.0-smoothstep(outer+.01,outer+.16,r))*step(lip,r)*.13;
      float alpha=max(core,halo);
      if(alpha<.012)discard;
      col=mix(col,deep*.62,(1.0-core)*.55);
      gl_FragColor=vec4(col,alpha);
      #include <colorspace_fragment>
    }`;
  function cutSeedOf(point) {
    // 0.5 m cells keep the preview pattern stable while the aim moves, and the
    // opened hole inherits exactly the pattern that was previewed.
    let h = 2166136261;
    for (const v of point || []) h = Math.imul(h ^ Math.round((Number(v) || 0) * 2), 16777619);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296 * 1000;
  }

  class CaveScene {
    constructor(canvas) {
      if (!T || !T.WebGLRenderer) throw new Error('Three.js is required before scene.js.');
      this.canvas = canvas; this.frames = 0; this.disposed = false; this.visualTime = 0;
      this.lastError = 0; this.lastLeg = ''; this.landTime = -10; this.lastState = 'menu';
      this.lastJumps = null; this.exitCloseAt = -Infinity;
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.65));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.NoToneMapping;
      this.renderer.setClearColor('#142a37', 1);
      this.scene = new T.Scene(); this.scene.background = color('#142a37');
      this.scene.fog = new T.Fog('#142a37', 21, 58);
      this.camera = new T.PerspectiveCamera(60, 1, P.cameraNear, 640);
      this.baseEye = new T.Vector3(0, P.eyeHeight, 0);
      this.caveCenter = new T.Vector3(0, P.radius, 0); this.sphereRadius = P.radius;
      this.camera.position.copy(this.baseEye);
      this.room = new T.Group(); this.scene.add(this.room);
      this.atlas = paintAtlas(); this.cutPaint = cutPaintAtlas(); this.glowMap = glowTexture();
      this.rockUniforms = {
        atlas: { value: this.atlas }, fogColor: { value: color('#142a37') }, rockKind: { value: 0 },
        flamePosition: { value: new T.Vector3(5, 3, -9) }, portalPosition: { value: new T.Vector3(0, 2, 0) }, portalPower: { value: 0 },
        waveCenters: { value: Array.from({ length: 5 }, () => new T.Vector3()) },
        waveRadii: { value: [0, 0, 0, 0, 0] }, wavePowers: { value: [0, 0, 0, 0, 0] },
        singleFront: { value: -1000 }, singlePower: { value: 0 },
        geologySeed: { value: 0 }, strataAxis: { value: new T.Vector3(0, 1, 0) },
        strataWidth: { value: 1 }, strataStyle: { value: 0 },
        mainRadius: { value: P.radius },
        aoOval: { value: new T.Vector4(9.3, HALL.bayZ, 3.6, 5.0) },
        aoStrength: { value: 1 },
        hallGlow: { value: new T.Vector4(8.5, 2.7, -4.1, .55) },
        entryCenter: { value: new T.Vector3() }, entryRadius: { value: 0 },
        repairCenter: { value: new T.Vector3() }, repairRadius: { value: 0 }, shellRole: { value: 0 }
      };
      this.cavityMaterial = new T.ShaderMaterial({ uniforms: this.rockUniforms, vertexShader: cavityVertex, fragmentShader: cavityFragment, side: T.BackSide });
      this.repairMaterial = new T.ShaderMaterial({ uniforms: { ...this.rockUniforms, shellRole: { value: 1 } }, vertexShader: cavityVertex, fragmentShader: cavityFragment, side: T.BackSide });
      this.rockMaterial = new T.ShaderMaterial({ uniforms: this.rockUniforms, vertexShader: rockVertex, fragmentShader: rockFragment, vertexColors: true });
      this.outlineMaterial = new T.ShaderMaterial({ uniforms: { ink: { value: color('#142934') }, fogColor: { value: color('#142a37') } }, vertexShader: outlineVertex, fragmentShader: outlineFragment, side: T.BackSide });
      this.makeRoom(417);
      this.makeFlame(); this.makeTarget(); this.makePortal(); this.makeDust(); this.makeWaves(); this.makeFiller();
      this.makeMenuScene(); this.cloneStartEquipment();
      // The menu is only a DOM overlay on the actual starting chamber. This
      // grounded, collision-safe pose is also handed to the Player on a new run.
      this.menuEye.set(1.8, P.eyeHeight, -6.7);
      this.menuLook.set(9.3, 2.35, -4.9);
      this.menuCamera = this.camera;
      this._targetMarker = new T.Vector3(0, 3.5, -3);
      this._goalMarker = new T.Vector3(5, 3, -9);
      this._menu = true;
      // Pause is an optical pull-back on the same camera; the map overlay then
      // fades in over this frozen frame. Nothing about the player pose moves.
      this.pauseActive = false; this.pauseBlend = 0;
      this._onResize = () => this.resize(); root.addEventListener('resize', this._onResize);
      this.resize();
      // Paint immediately, including on the menu: no engine tick or user input needed.
      this.update({ state: 'menu', pos: [16000, 0, 0], time: 0, stage: 'single', jumps: 0 }, 0, { menu: true });
    }

    karstGeometry(seed) {
      const rnd = random(seed);
      const ribs = hallRibs(rnd);
      const shell = tagGeometry(hallShellGeometry(ribs), 1, 1 / 15.5, .84);
      const floor = tagGeometry(hallFloorGeometry(ribs), 9, 1 / 15.5, .82);
      const detail = [];
      // Stalactites: a few long formations, many small ones, nothing directly over
      // the console bay where it would break the menu composition.
      for (let i = 0; i < 30; i++) {
        const a = rnd() * TAU, phi = .40 + rnd() * .76;
        const p = hallPoint(a, phi, ribs);
        const dx = p[0] - 8.9, dz = p[2] - HALL.bayZ;
        if (dx * dx + dz * dz < 30) continue;
        const big = i < 5;
        const radius = big ? .55 + rnd() * .38 : .16 + rnd() * .26;
        const length = big ? 2.3 + rnd() * 1.5 : .6 + rnd() * 1.8;
        const g = spikeGeometry(rnd, radius, length);
        g.rotateY(rnd() * TAU);
        g.translate(p[0], p[1] + .22, p[2]);
        const spike = tagGeometry(g, rnd() < .5 ? 5 : 13, PAINT_FIELD, .56 + rnd() * .1); spike.outline = false; detail.push(spike);
      }
      // Two full-height columns stand at the chamber rim, well outside the walk.
      for (const [idx, a] of [[0, -1.52], [1, 2.42]]) {
        const p = hallPoint(a, .62 + idx * .05, ribs);
        const g = spikeGeometry(random(seed + 37 + idx * 13), .55 + idx * .12, p[1] + .9);
        g.translate(p[0] * .97, p[1] + .25, p[2] * .97);
        const column = tagGeometry(g, 6 + idx * 4, PAINT_FIELD, .70); column.outline = false; detail.push(column);
      }
      // Fallen boulders bedded into the talus at the wall base.
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU + .3, phi = .05 + rnd() * .07;
        const p = hallPoint(a, phi, ribs);
        const s = .7 + rnd() * 1.3;
        const g = stoneGeometry([p[0] * .93, floorHeightAt(p[0] * .93, p[2] * .93, .95) + s * .12, p[2] * .93],
          [s, s * (.55 + rnd() * .35), s * (.8 + rnd() * .4)], [rnd() * .3, rnd() * TAU, rnd() * .3], rnd, Math.floor(rnd() * 16), [20, 13]);
        detail.push(tagGeometry(g, 8 + Math.floor(rnd() * 8), PAINT_FIELD, .76 + rnd() * .12));
      }
      // Loose scree. Small, low, sparse: service for the space, not noise.
      for (let i = 0; i < 16; i++) {
        const a = rnd() * TAU, u = .55 + rnd() * .38;
        const p = hallPoint(a, .05, ribs);
        const x = p[0] * u, z = p[2] * u, s = .10 + rnd() * .19;
        const g = stoneGeometry([x, floorHeightAt(x, z, u) + s * .25, z], [s, s * .62, s * .9], [0, rnd() * TAU, 0], rnd, Math.floor(rnd() * 16), [8, 6]);
        const scree = tagGeometry(g, 4 + Math.floor(rnd() * 12), PAINT_FIELD, .92 + rnd() * .16);
        // The 3.2 cm inverted hull is wider than these pebbles: outlining them
        // fills the whole stone with ink and reads as a hole in the floor.
        scree.outline = false; detail.push(scree);
      }
      // Sunk pebbles give the open floor a readable scale without clutter.
      for (let i = 0; i < 10; i++) {
        const a = rnd() * TAU, u = .28 + rnd() * .50;
        const p = hallPoint(a, .05, ribs);
        const x = p[0] * u, z = p[2] * u, sc = .07 + rnd() * .13;
        const g = stoneGeometry([x, floorHeightAt(x, z, u) + sc * .22, z], [sc, sc * .55, sc * .85], [0, rnd() * TAU, 0], rnd, 12, [8, 6]);
        const sunk = tagGeometry(g, 8 + Math.floor(rnd() * 4), PAINT_FIELD, .86 + rnd() * .1);
        sunk.outline = false; detail.push(sunk);
      }
      // Detail carries the ink hull; the shell relies on cel contour bands only.
      const outline = mergedGeometry(detail.filter(part => part.outline !== false).map(part => ({ geometry: part.geometry.clone(), shade: part.shade })));
      return { merged: mergedGeometry([shell, floor, ...detail]), outline };
    }

    makeRoom(seed, kind = 'karst') {
      const old = new Set(); this.room.traverse(o => { if (o.geometry) old.add(o.geometry); });
      this.room.clear(); old.forEach(g => g.dispose());
      this.roomKind = kind; this.roomSeed = seed; this.sphere = null;
      if (kind === 'karst') {
        const hall = this.karstGeometry(417);
        this.room.add(new T.Mesh(hall.merged, this.rockMaterial), new T.Mesh(hall.outline, this.outlineMaterial));
      } else {
        // The position attribute is never changed and the mesh is never stretched.
        this.sphere = new T.Mesh(new T.SphereGeometry(P.radius, 144, 96), this.cavityMaterial);
        this.sphere.name = 'strict-spherical-cavity'; this.sphere.position.copy(this.caveCenter);
        this.room.add(this.sphere);
        const r = random(seed), style = seed % 5;
        this.rockUniforms.geologySeed.value = r() * 30;
        const axes = [[.15,1,.12],[.8,.35,.42],[-.45,.7,.61],[.92,.08,-.4],[.3,-.45,.84]];
        this.rockUniforms.strataAxis.value.fromArray(axes[style]).normalize();
        this.rockUniforms.strataWidth.value = .7 + r() * 1.35;
        this.rockUniforms.strataStyle.value = style;
      }
      if (this.startEquipment) this.startEquipment.visible = kind === 'karst';
    }

    cloneStartEquipment() {
      this.startEquipment = new T.Group(); this.startEquipment.name = 'start-wall-equipment';
      // Every equipment/cable vertex stays right of x=5; the walking area stays clear.
      this.startEquipment.position.set(8.7, 0, -6.2); this.startEquipment.rotation.y = -Math.PI / 2; this.scene.add(this.startEquipment);
      for (const object of this.menuGroup.children) {
        if (['menu-rock', 'menu-underfloor'].includes(object.name)) continue;
        // Omit only the long menu-foreground cable loop, which would cross the path.
        if (object.geometry?.type === 'TubeGeometry') {
          object.geometry.computeBoundingBox();
          if (object.geometry.boundingBox.max.z > 2.4) continue;
        }
        this.startEquipment.add(object.clone(true));
      }
      this.startEquipment.updateMatrixWorld(true);
      this.scene.add(new T.HemisphereLight('#93b0b8', '#1e2d36', .58));
      const key = new T.DirectionalLight('#9db6c7', .72); key.position.set(-3, 7, 5); this.scene.add(key);
      for (const lamp of this.menuLights) {
        const clone = lamp.light.clone(); clone.position.applyMatrix4(this.startEquipment.matrixWorld);
        if (clone.isSpotLight) { clone.target = lamp.light.target.clone(); clone.target.position.applyMatrix4(this.startEquipment.matrixWorld); this.scene.add(clone.target); }
        clone.castShadow = lamp.light.castShadow; this.scene.add(clone); lamp.gameLight = clone;
      }
    }

    // Build the equipment asset group. The assembly scene is never presented:
    // menu and gameplay both render its installation in the real starting cave.
    makeMenuScene() {
      const scene = this.menuScene = new T.Scene();
      scene.background = color('#172b38'); scene.fog = new T.Fog('#172b38', 12, 30);
      this.menuGroup = new T.Group(); this.menuGroup.name = 'menu-control-station'; scene.add(this.menuGroup);
      this.menuCamera = new T.PerspectiveCamera(47, 1, .08, 65);
      this.menuEye = new T.Vector3(-2.8, 1.42, 8.8);
      this.menuLook = new T.Vector3(.15, 2.15, -2.1);
      this.menuCamera.position.copy(this.menuEye); this.menuCamera.lookAt(this.menuLook);
      this.menuScreens = []; this.menuLights = []; this.menuIndicators = []; this.menuNeedles = [];
      this.menuScreenFrame = -1;
      const bands = this.menuGradient = new T.DataTexture(new Uint8Array([65, 142, 218, 255]), 4, 1, T.RedFormat);
      bands.minFilter = bands.magFilter = T.NearestFilter; bands.needsUpdate = true;
      const ink = new T.LineBasicMaterial({ color: '#0f1d24' });
      // A faint worn-plastic grain keeps every housing from reading as a clean
      // CG primitive. It multiplies the toon colour, so it stays in palette.
      const wearCanvas = document.createElement('canvas'); wearCanvas.width = wearCanvas.height = 256;
      const wctx = wearCanvas.getContext('2d');
      wctx.fillStyle = '#f3f1e8'; wctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1100; i++) {
        const x = (i * 97 + 41) % 256, y = (i * 173 + 67) % 256, r = .4 + (i * 13 % 17) / 12;
        wctx.fillStyle = `rgba(44,58,62,${.018 + (i % 7) * .006})`;
        wctx.beginPath(); wctx.arc(x, y, r, 0, TAU); wctx.fill();
      }
      wctx.lineWidth = .6;
      for (let i = 0; i < 22; i++) {
        const x = (i * 131 + 19) % 256, y = (i * 71 + 31) % 256;
        wctx.strokeStyle = `rgba(52,64,66,${.035 + (i % 4) * .012})`;
        wctx.beginPath(); wctx.moveTo(x, y); wctx.lineTo(x + 12 + i % 31, y + (i % 5) - 2); wctx.stroke();
      }
      const wear = new T.CanvasTexture(wearCanvas);
      wear.wrapS = wear.wrapT = T.RepeatWrapping; wear.colorSpace = T.SRGBColorSpace; wear.anisotropy = 4;
      const mat = (hex, extra = {}) => new T.MeshToonMaterial({ color: hex, gradientMap: bands, ...extra });
      const steel = mat('#586d73', { map: wear }), edge = mat('#2b3d45'), pale = mat('#8c9a97');
      const dark = mat('#20313a', { map: wear }), black = mat('#101c22'), cableMat = mat('#14232b');
      const blue = mat('#3d5863', { map: wear }), brass = mat('#9f8f74');
      const housing = mat('#6d7f82', { map: wear }), housingDark = mat('#465b62', { map: wear });
      const bezel = mat('#1b292f'), keyMat = mat('#768783'), slate = mat('#485f6a', { map: wear });
      // Wobbly, slightly uneven ink strokes. Segment midpoints are displaced by a
      // continuous noise field, so shared corners stay joined and nothing gaps.
      const sketch = (geometry, amp = .011) => {
        const source = new T.EdgesGeometry(geometry, 30), pos = source.attributes.position;
        const wobble = (x, y, z) => {
          const a = Math.sin(x * 23.1 + y * 17.7 + z * 31.3), b = Math.sin(x * 9.7 - y * 27.3 + z * 13.9);
          return [x + (a * .65 + b * .35) * amp, y + (b * .7 - a * .3) * amp, z + (a * .4 + b * .6) * amp];
        };
        const points = [];
        for (let i = 0; i < pos.count; i += 2) {
          const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
          const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
          let last = wobble(ax, ay, az);
          for (let s = 1; s <= 3; s++) {
            const t = s / 3, next = wobble(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
            points.push(...last, ...next); last = next;
          }
        }
        source.dispose();
        const line = new T.BufferGeometry();
        line.setAttribute('position', new T.Float32BufferAttribute(points, 3));
        return new T.LineSegments(line, ink);
      };
      const add = (parent, geometry, material, p, outlined = true) => {
        const mesh = new T.Mesh(geometry, material); mesh.position.set(...p);
        mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
        if (outlined) mesh.add(sketch(geometry));
        return mesh;
      };
      const box = (parent, p, s, material = steel, outlined = true) => add(parent, new T.BoxGeometry(...s), material, p, outlined);
      const bevel = (parent, p, s, material = steel, radius = .055) => {
        const [w, h, d] = s, shape = new T.Shape();
        shape.moveTo(-w / 2 + radius, -h / 2); shape.lineTo(w / 2 - radius, -h / 2);
        shape.lineTo(w / 2, -h / 2 + radius); shape.lineTo(w / 2, h / 2 - radius);
        shape.lineTo(w / 2 - radius, h / 2); shape.lineTo(-w / 2 + radius, h / 2);
        shape.lineTo(-w / 2, h / 2 - radius); shape.lineTo(-w / 2, -h / 2 + radius); shape.closePath();
        const g = new T.ExtrudeGeometry(shape, { depth: d - radius * 2, bevelEnabled: true, bevelThickness: radius, bevelSize: radius, bevelSegments: 1, steps: 1 });
        g.translate(0, 0, -d / 2 + radius); return add(parent, g, material, p);
      };
      const cylinder = (parent, p, r, depth, material = dark) => {
        const m = add(parent, new T.CylinderGeometry(r, r, depth, 12), material, p);
        m.rotation.x = Math.PI / 2; return m;
      };
      const wire = (parent, points, radius = .025, material = cableMat) => {
        const curve = new T.CatmullRomCurve3(points.map(vec));
        return add(parent, new T.TubeGeometry(curve, 32, radius, 6, false), material, [0, 0, 0], false);
      };
      const label = (parent, text, p, w = .56, h = .14, bg = '#80999c', fg = '#263e4b') => {
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = fg; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 128, 34);
        const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
        return add(parent, new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture }), p, false);
      };
      const led = (parent, p, hex = '#8ad7ba', size = .033) => {
        cylinder(parent, [p[0], p[1], p[2] - .01], size * 1.55, .025, black);
        const m = add(parent, new T.SphereGeometry(size, 8, 6), new T.MeshBasicMaterial({ color: hex }), p, false);
        m.userData.baseColor = m.material.color.clone(); this.menuIndicators.push(m); return m;
      };
      const screen = (parent, p, w, h, kind) => {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320;
        const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
        // No bloom or additive glow: these are old phosphor panes under cave light.
        const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
        // Slightly bulged glass, sunk behind a heavy mask so the bezel casts a real lip.
        const geometry = new T.PlaneGeometry(w, h, 10, 8), pos = geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const nx = pos.getX(i) / (w / 2), ny = pos.getY(i) / (h / 2);
          pos.setZ(i, .026 * (1 - nx * nx) * (1 - ny * ny));
        }
        const mesh = add(parent, geometry, material, p, false);
        mesh.name = 'menu-screen-' + kind;
        const bar = Math.min(.075, .03 + w * .024), lip = .016;
        const frame = (sx, sy, dx, dy) => box(parent, [p[0] + dx, p[1] + dy, p[2] + .012], [sx, sy, .07], bezel, false);
        frame(w + bar * 2, bar, 0, (h + bar) / 2); frame(w + bar * 2, bar, 0, -(h + bar) / 2);
        frame(bar, h, -(w + bar) / 2, 0); frame(bar, h, (w + bar) / 2, 0);
        cylinder(parent, [p[0] - w / 2 + bar * .5, p[1] - h / 2 + bar * .5, p[2] + lip], .012, .012, edge);
        this.menuScreens.push({ canvas, texture, mesh, kind }); return mesh;
      };
      // The same spacious karst chamber is used for the playable opening.
      const rock = new T.Mesh(this.karstGeometry(417).merged, mat('#9ab1bf', { map: this.atlas, vertexColors: true }));
      rock.name = 'menu-rock'; rock.receiveShadow = true; this.menuGroup.add(rock);
      const underfloor = box(this.menuGroup, [0, -.12, 0], [34, .18, 32], dark, false);
      underfloor.name = 'menu-underfloor'; underfloor.receiveShadow = true;

      const desk = new T.Group(); desk.name = 'console-desk'; desk.position.set(2.15, 0, -.12); desk.rotation.y = .15; this.menuGroup.add(desk);
      // Near-rectangular solid rock steps, never a metal-legged table.
      bevel(desk, [0, .47, -.08], [5.08, .94, 1.76], slate, .13).name = 'stone-step-base';
      bevel(desk, [0, 1.18, 0], [5.28, .39, 1.97], slate, .075).name = 'menu-table';
      bevel(desk, [-.12, .15, .58], [5.48, .30, 1.09], slate, .07).name = 'stone-step-foot';
      wire(desk, [[-2.1,1.0,1.00],[-1.5,1.04,1.00],[-.8,1.01,1.00],[-.44,1.10,1.00]], .014);
      wire(desk, [[.5,.88,.82],[.67,.59,.82],[.56,.28,.82]], .017);
      wire(desk, [[-2.2,1.39,.42],[-1.7,1.41,.66],[-1.1,1.39,.55],[-.9,1.4,.15]], .018);
      wire(desk, [[-1.9,1.385,-.15],[-2.4,1.39,.05],[-2.6,1.37,.55]], .023);
      const rubbleMat = mat('#40555f', { map: wear, flatShading: true });
      const rubble = (parent, p, s, turn, squash = .62) => {
        const rock = add(parent, new T.DodecahedronGeometry(s, 0), rubbleMat, p);
        rock.scale.set(1.15, squash, .9); rock.rotation.set(.13, turn, .09);
        return rock;
      };
      rubble(desk, [-2.92, .34, .38], .55, .45, .7);
      rubble(desk, [2.82, .24, .82], .34, 1.7, .58);
      rubble(desk, [2.98, .18, -.34], .26, 2.6, .5);
      rubble(this.menuGroup, [5.35, .30, -2.52], .48, 1.15, .64);
      // Primary CRT: a squat, tired field monitor. Deep tapered shell, thick
      // dark mask, near-square phosphor pane and a chunky analogue control lip.
      const primary = new T.Group(); primary.name = 'main-crt'; primary.position.set(.05, 2.56, -.24); primary.rotation.y = -.03; desk.add(primary);
      bevel(primary, [0, -.02, -.24], [2.56, 1.92, .82], housing, .12);
      bevel(primary, [0, -.03, -.56], [1.94, 1.52, .46], housingDark, .11);
      bevel(primary, [0, 0, .17], [2.62, 1.96, .10], housing, .095);
      bevel(primary, [0, .04, .255], [2.24, 1.62, .07], bezel, .07);
      screen(primary, [0, .06, .296], 1.94, 1.36, 'main');
      bevel(primary, [0, -.83, .245], [2.12, .27, .10], housingDark, .055);
      // Chunky analogue controls, not a row of capacitive icons.
      cylinder(primary, [.72, -.83, .305], .088, .05, bezel);
      cylinder(primary, [.52, -.83, .305], .062, .045, keyMat);
      for (const x of [.30, .39]) {
        cylinder(primary, [x, -.845, .305], .035, .02, edge);
        box(primary, [x, -.805, .312], [.03, .075, .03], brass, false).rotation.x = -.32;
      }
      led(primary, [-.78, -.825, .31], '#b7a477', .025);
      label(primary, 'DD-01 / FIELD SCOPE', [-.28, -.827, .312], .82, .09, '#5c6f70', '#d9d8c8');
      // Carry handle: the one silhouette cue that says field monitor rather than TV.
      for (const x of [-.62, .62]) bevel(primary, [x, 1.01, -.12], [.20, .16, .26], housingDark, .04);
      bevel(primary, [0, 1.07, -.12], [1.42, .11, .18], housing, .045);
      box(primary, [0, -1.04, -.12], [.44, .24, .46], edge);
      bevel(primary, [0, -1.145, .02], [1.15, .10, .66], steel, .05);
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) box(primary, [side * 1.325, -.30 + i * .16, -.08], [.018, .09, .34], dark, false);
      for (const x of [-1.09, 1.09]) for (const y of [-.70, .70]) cylinder(primary, [x, y, .255], .018, .014, edge);
      // Secondary terminal at a different depth and angle, not a row of flat icons.
      const secondary = new T.Group(); secondary.name = 'secondary-crt'; secondary.position.set(1.87, 2.02, -.40); secondary.rotation.y = -.26; desk.add(secondary);
      bevel(secondary, [0, -.03, -.18], [1.02, 1.00, .74], housingDark, .07);
      bevel(secondary, [0, .02, .16], [1.04, 1.02, .08], housing, .06);
      bevel(secondary, [0, .07, .225], [.84, .74, .05], bezel, .045);
      screen(secondary, [0, .07, .256], .70, .58, 'scope');
      cylinder(secondary, [.30, -.39, .27], .065, .06, bezel); led(secondary, [-.29, -.38, .276], '#8fa88d', .022);
      bevel(secondary, [0, -.56, -.02], [1.10, .12, .82], steel, .04);
      label(secondary, 'OSC / 02', [.20, -.40, .278], .34, .07, '#596b6b', '#d0d3c6');
      // Open laptop low and closer to the viewer; keyboard keys are actual geometry.
      const laptop = new T.Group(); laptop.name = 'field-laptop'; laptop.position.set(-1.36, 1.41, .70); laptop.rotation.y = .14; desk.add(laptop);
      bevel(laptop, [0, 0, 0], [1.38, .085, .79], housingDark, .03);
      const lid = new T.Group(); lid.position.set(0, .39, -.28); lid.rotation.x = -.17; laptop.add(lid);
      bevel(lid, [0, 0, 0], [1.39, .86, .105], housing, .04);
      screen(lid, [0, .02, .067], 1.20, .65, 'link');
      for (const x of [-.63, .63]) for (const y of [-.37, .37]) box(lid, [x, y, .02], [.11, .11, .10], edge, false);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 10; col++) box(laptop, [-.54 + col * .119, .054, -.16 + row * .105], [.09, .018, .073], row ? keyMat : edge, false);
      box(laptop, [0, .052, .28], [.39, .009, .135], steel, false);
      label(lid, 'LINK / 07', [.42, -.365, .061], .34, .062, '#667775', '#d4d3c5');
      // A separate keyboard and trackball on the console, with labels along its lip.
      bevel(desk, [.36, 1.405, .66], [1.65, .055, .43], dark, .025);
      for (let row = 0; row < 3; row++) for (let col = 0; col < 13; col++) box(desk, [-.36 + col * .118, 1.443, .51 + row * .12], [.085, .018, .075], steel, false);
      bevel(desk, [1.56, 1.43, .66], [.35, .08, .37], edge, .03);
      const ball = add(desk, new T.SphereGeometry(.095, 12, 8), pale, [1.56, 1.49, .66]); ball.scale.y = .5;
      label(desk, 'OBSERVATION / 07', [-1.3, 1.125, .801], 1.03, .11);
      label(desk, 'STANDBY', [1.5, 1.125, .801], .64, .11);

      const rack = new T.Group(); rack.name = 'instrument-rack'; rack.position.set(5.6, 0, -1.63); rack.rotation.y = -.10; this.menuGroup.add(rack);
      bevel(rack, [0, 2.14, 0], [1.71, 4.28, 1.15], housingDark, .085);
      box(rack, [0, 2.14, .595], [1.47, 4.03, .08], black);
      for (const x of [-.83, .83]) box(rack, [x, 2.12, .66], [.10, 4.19, .16], steel);
      box(rack, [0, .13, .09], [1.95, .19, 1.4], edge);
      const gauge = (parent, x, y, z, radius = .225) => {
        cylinder(parent, [x, y, z], radius * 1.19, .08, dark);
        cylinder(parent, [x, y, z + .055], radius, .015, pale);
        for (let i = 0; i < 9; i++) {
          const a = -.78 * Math.PI + i / 8 * Math.PI * 1.56;
          const m = box(parent, [x + Math.sin(a) * radius * .79, y + Math.cos(a) * radius * .79, z + .069], [.017, .045, .008], dark, false); m.rotation.z = -a;
        }
        const pivot = new T.Group(); pivot.position.set(x, y, z + .084); parent.add(pivot);
        box(pivot, [0, radius * .29, 0], [.017, radius * .66, .012], dark, false);
        cylinder(parent, [x, y, z + .092], .035, .018, edge); this.menuNeedles.push(pivot);
      };
      for (let unit = 0; unit < 4; unit++) {
        const y = 3.65 - unit * .88;
        bevel(rack, [0, y, .68], [1.43, .80, .14], unit % 2 ? steel : blue, .022).name = 'menu-rack-panel';
        for (const x of [-.63, .63]) for (const dy of [-.30, .30]) cylinder(rack, [x, y + dy, .768], .022, .015, dark);
        if (unit === 0 || unit === 2) {
          gauge(rack, -.28, y + .05, .79, .21);
          for (let i = 0; i < 3; i++) { cylinder(rack, [.30, y + .23 - i * .20, .80], .062, .075, dark); led(rack, [.49, y + .23 - i * .20, .806], i === 1 ? '#b39362' : '#789482', .02); }
        } else if (unit === 1) {
          bevel(rack, [-.16, y + .04, .78], [.82, .48, .04], black, .02);
          screen(rack, [-.16, y + .04, .807], .73, .39, 'rack');
          cylinder(rack, [.47, y + .13, .81], .084, .09, dark); cylinder(rack, [.47, y - .14, .81], .06, .09, dark);
        } else {
          for (let i = 0; i < 8; i++) box(rack, [-.15, y + .23 - i * .067, .763], [.76, .024, .017], black, false);
          cylinder(rack, [.47, y, .81], .09, .09, brass);
        }
      }
      label(rack, 'FIELD / 04', [0, 4.055, .755], .86, .125);
      // Small wall-mounted junction panel and uninterrupted cable runs to the floor.
      bevel(this.menuGroup, [3.65, 3.77, -2.75], [1.05, .66, .28], edge);
      label(this.menuGroup, 'AUX / 12V', [3.65, 3.90, -2.596], .72, .1);
      for (let i = 0; i < 3; i++) cylinder(this.menuGroup, [3.36 + i * .28, 3.66, -2.56], .07, .08, steel);
      for (let i = 0; i < 3; i++) {
        const x = .38 + i * .13;
        wire(this.menuGroup, [[x, 3.76, -2.58], [x - .19, 3.08, -2.53], [x + .11, 2.03, -2.41], [x - .04, .25, -2.30], [x + .8, .06, -.8], [2.6 + i * .13, .03, 1.68], [4.5, .06, 1.8], [4.9, .12, -.85]], .028);
      }
      wire(this.menuGroup, [[3.5, 3.58, -2.55], [3.49, 3.0, -2.52], [4.23, 2.52, -2.4], [5.15, 2.56, -2.2]], .037);
      wire(this.menuGroup, [[1.0, 1.27, .65], [1.05, .71, 1.03], [.50, .03, 1.73], [-.12, .035, 3.06], [1.65, .035, 4.36], [3.80, .035, 4.1], [5.5, .09, 2.8]], .035);
      wire(this.menuGroup, [[6.1, 4.7, -2.57], [5.0, 4.86, -2.8], [3.7, 4.7, -2.6], [1.8, 4.72, -2.7], [.5, 3.77, -2.59]], .038);
      // Restrained practical lights. Toon surfaces receive real distance/normal lighting.
      scene.add(new T.HemisphereLight('#93b0b8', '#1e2d36', .58));
      const key = new T.DirectionalLight('#9db6c7', .72); key.position.set(-3, 7, 5); scene.add(key);
      const light = (hex, power, distance, p) => {
        const l = new T.PointLight(hex, power, distance, 2); l.position.set(...p); scene.add(l);
        this.menuLights.push({ light: l, base: power }); return l;
      };
      light('#a8c3c0', 6.1, 7.6, [1.80, 2.62, .70]);
      light('#7f9fab', 2.5, 4.8, [4.75, 2.82, -.49]);
      light('#728b98', 2.2, 6.0, [2.02, 2.55, -2.07]);
      const spill = new T.SpotLight('#b4cec7', 7.8, 6.6, 1.12, .58, 2);
      spill.position.set(1.8, 2.62, .66); spill.target.position.set(2.0, 1.1, 1.0);
      spill.castShadow = true; spill.shadow.mapSize.set(1024, 1024); spill.shadow.bias = -.0002; spill.shadow.normalBias = .035;
      scene.add(spill, spill.target); this.menuLights.push({ light: spill, base: 7.8 });
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.updateMenuScene(0);
    }

    updateMenuScene(t) {
      for (let i = 0; i < this.menuLights.length; i++) {
        const lamp = this.menuLights[i]; lamp.light.intensity = lamp.base * (1 + .035 * Math.sin(t * .72 + i * 1.7));
        if (lamp.gameLight) lamp.gameLight.intensity = lamp.light.intensity;
      }
      for (let i = 0; i < this.menuIndicators.length; i++) {
        const led = this.menuIndicators[i]; led.material.color.copy(led.userData.baseColor).multiplyScalar(.85 + .1 * Math.sin(t * .65 + i * 2.4));
      }
      this.menuNeedles.forEach((n, i) => { n.rotation.z = -.52 + i * .67 + Math.sin(t * .35 + i) * .028; });
      const frame = Math.floor(t * 6); if (frame === this.menuScreenFrame) return; this.menuScreenFrame = frame;
      for (const s of this.menuScreens) {
        const c = s.canvas.getContext('2d');
        const W = 512, H = 320, scope = s.kind === 'scope' || s.kind === 'rack', rack = s.kind === 'rack';
        const paper = rack ? '#798883' : scope ? '#96a29c' : '#aeb5a9';
        const header = rack ? '#293a3f' : '#33474b';
        const line = rack ? '#465a57' : '#31464a';
        const light = rack ? '#95a299' : '#ccd0c1';
        // A wide dark mask makes the phosphor read as a recessed old tube, not a flat panel.
        c.fillStyle = '#121d22'; c.fillRect(0, 0, W, H);
        const x = 22, y = 18, w = W - 44, h = H - 36, r = 9;
        const rounded = () => {
          c.beginPath();
          c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
          c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
          c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
        };
        rounded(); c.save(); c.clip();
        const grad = c.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, paper); grad.addColorStop(1, rack ? '#657571' : scope ? '#7f8e88' : '#929e96');
        c.fillStyle = grad; c.fillRect(x, y, w, h);
        // Age spots, dust and edge vignette. Fixed by index, so they never flicker.
        for (let i = 0; i < 110; i++) {
          const px = x + (i * 97 + 13) % w, py = y + (i * 53 + 29) % h, rr = .4 + (i * 7 % 9) * .28;
          c.fillStyle = `rgba(43,59,61,${.014 + (i % 5) * .006})`;
          c.beginPath(); c.arc(px, py, rr, 0, TAU); c.fill();
        }
        const vig = c.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 340);
        vig.addColorStop(0, 'rgba(240,240,225,0)'); vig.addColorStop(1, 'rgba(24,36,38,.30)');
        c.fillStyle = vig; c.fillRect(x, y, w, h);
        c.strokeStyle = 'rgba(55,76,79,.18)'; c.lineWidth = 1;
        for (let gx = 32; gx < W; gx += 32) { c.beginPath(); c.moveTo(gx + .5, y + 32); c.lineTo(gx + .5, y + h); c.stroke(); }
        for (let gy = 48; gy < y + h; gy += 32) { c.beginPath(); c.moveTo(x, gy + .5); c.lineTo(x + w, gy + .5); c.stroke(); }
        c.fillStyle = header; c.fillRect(x, y, w, 30);
        c.fillStyle = light; c.font = '13px "Courier New", monospace';
        c.fillText(rack ? 'OSC / UNIT 02' : scope ? 'OSC / 02    SIGNAL LOCK' : s.kind === 'link' ? 'REMOTE LINK / ONLINE' : 'DD-01 / SUBSURFACE OBSERVATORY', x + 9, y + 21);
        c.fillStyle = rack ? '#7e8b80' : '#9aa89d'; c.font = '10px "Courier New", monospace';
        c.fillText(rack ? 'STANDBY' : 'CH 07', W - 82, y + 21);
        // Traces are drawn twice: a soft graphite shadow and a wavering ink line.
        c.lineCap = 'round'; c.lineJoin = 'round';
        const traceTop = y + 56, traceGap = scope ? 66 : 62;
        for (let trace = 0; trace < (scope ? 2 : 3); trace++) {
          for (const pass of [{ colour: '#5d6d68', width: 5.5, alpha: .2, off: .9 }, { colour: line, width: 2.1, alpha: .92, off: 0 }]) {
            c.strokeStyle = pass.colour; c.globalAlpha = pass.alpha; c.lineWidth = pass.width;
            c.beginPath();
            for (let px = 26; px < (scope ? 488 : 343); px += 4) {
              const wobble = Math.sin(px * .031 + t * .12 + trace * 1.9) * 7
                + Math.sin(px * .093 + trace) * 2.6 + Math.sin(px * .211 + t * .05) * .8;
              const drift = trace === 2 ? Math.sin(px * .012 + t * .04) * 8 : 0;
              const py = traceTop + trace * traceGap + wobble + drift + pass.off;
              if (px === 26) c.moveTo(px, py); else c.lineTo(px, py);
            }
            c.stroke();
          }
        }
        c.globalAlpha = 1;
        if (!scope) {
          const px = 354, py = 54;
          c.strokeStyle = 'rgba(48,68,71,.55)'; c.lineWidth = 1;
          c.strokeRect(px, py, 122, 208);
          c.fillStyle = '#41575a'; c.font = '11px "Courier New", monospace'; c.fillText('DEPTH', px + 12, py + 24);
          c.font = 'bold 25px "Courier New", monospace'; c.fillText('16.00', px + 8, py + 55);
          c.font = '10px "Courier New", monospace'; c.fillText('KM / STANDBY', px + 9, py + 73);
          for (let i = 0; i < 7; i++) { c.fillStyle = `rgba(49,70,73,${.5 - i * .035})`; c.fillRect(px + 11, py + 94 + i * 10, 28 + (i * 29 % 60), 3); }
          c.strokeStyle = 'rgba(48,68,71,.32)'; c.beginPath(); c.moveTo(px + 12, py + 182); c.lineTo(px + 105, py + 182); c.stroke();
        }
        c.fillStyle = 'rgba(52,72,74,.75)'; c.font = '10px "Courier New", monospace';
        c.fillText('RECEIVER ACTIVE', x + 10, y + h - 14); c.fillText('CH 07 / SYNC', W - 120, y + h - 14);
        // Glass sheen and a crawling scan that is barely brighter than the paper.
        c.globalAlpha = .055; c.fillStyle = '#eef1e5';
        c.beginPath(); c.moveTo(x, y + 62); c.lineTo(x + 200, y); c.lineTo(x + 300, y); c.lineTo(x, y + 176); c.closePath(); c.fill();
        c.globalAlpha = 1;
        c.fillStyle = 'rgba(238,240,224,.028)'; c.fillRect(x, y + 31 + (t * 7) % (h - 32), w, 9);
        c.restore();
        rounded(); c.strokeStyle = 'rgba(13,22,25,.8)'; c.lineWidth = 2; c.stroke();
        s.texture.needsUpdate = true;
      }
    }

    makeFlame() {
      // Keep the public flame handle; the signal is water-like light, not fire.
      this.flame = new T.Group(); this.flame.name = 'dongdong-signal'; this.scene.add(this.flame);
      this.flameUniforms = { time: { value: 0 }, opacity: { value: 0 } };
      const material = new T.ShaderMaterial({
        uniforms: this.flameUniforms,
        vertexShader: `varying vec3 vNormal; varying vec3 vView; varying vec3 vPosition;
          void main(){vPosition=position; vNormal=normalize(normalMatrix*normal);
            vec4 p=modelViewMatrix*vec4(position,1.0); vView=-p.xyz;
            gl_Position=projectionMatrix*p;}`,
        fragmentShader: `uniform float time; uniform float opacity;
          varying vec3 vNormal; varying vec3 vView; varying vec3 vPosition;
          void main(){float facing=max(0.0,dot(normalize(vNormal),normalize(vView)));
            float flow=sin(vPosition.y*6.0-time*1.3+sin(vPosition.x*5.0+time*.8));
            float milk=smoothstep(.25,.97,facing)+.025*flow;
            vec3 c=mix(vec3(.12,.52,.76),vec3(.76,.94,.98),clamp(milk,0.0,1.0));
            float a=smoothstep(0.0,.58,facing)*(.74+.2*facing)*opacity;
            gl_FragColor=vec4(c,a);
            #include <colorspace_fragment>
          }`, transparent: true, depthTest: false, depthWrite: false
      });
      const geometry = new T.SphereGeometry(1, 48, 32);
      this.signalRest = geometry.attributes.position.array.slice();
      this.signalBody = new T.Mesh(geometry, material);
      this.signalBody.name = 'rounded-water-body'; this.signalBody.renderOrder = 21; this.flame.add(this.signalBody);
      this.signalBounds = new T.Box3();
      this.deformSignal(0);
      // A bounded, procedural soft fringe. Only this halo faces the camera, not the body.
      this.flameGlow = new T.Mesh(new T.PlaneGeometry(1.65, 1.9), new T.ShaderMaterial({
        uniforms: this.flameUniforms,
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform float opacity; varying vec2 vUv;
          void main(){float r=length((vUv-.5)*2.0);
            float a=exp(-r*r*4.8)*(1.0-smoothstep(.55,1.0,r))*.22*opacity;
            gl_FragColor=vec4(.18,.61,.86,a);
            #include <colorspace_fragment>
          }`, transparent: true, blending: T.AdditiveBlending, depthTest: false, depthWrite: false
      }));
      this.flameGlow.renderOrder = 20; this.flame.add(this.flameGlow);
      this.embers = [];
      const dropletGeometry = new T.SphereGeometry(1, 20, 16);
      for (let i = 0; i < 5; i++) {
        const dropletMaterial = material.clone();
        dropletMaterial.uniforms.time = this.flameUniforms.time;
        const m = new T.Mesh(dropletGeometry, dropletMaterial);
        m.name = 'rising-droplet-' + i; m.renderOrder = 22;
        m.userData.phase = 0; m.userData.opacity = 0;
        this.flame.add(m); this.embers.push(m);
      }
    }

    deformSignal(t) {
      // Metres, on the CPU: stats and frustum bounds include the actual deformation.
      // y=+/-.6 at both poles; the displacement is bounded by .018*(1-y*y),
      // which cannot exceed the .6 pole height. No sharp taper and no distance scale.
      const g = this.signalBody.geometry, p = g.attributes.position, rest = this.signalRest;
      for (let i = 0; i < p.count; i++) {
        const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
        const waist = Math.max(0, 1 - y * y), roundness = 1 - .12 * y;
        const flow = 1 + .025 * Math.sin(t * 1.7 + y * 3 + z * 2);
        p.setXYZ(i, x * .42 * roundness * flow + .025 * Math.sin(t * 1.4 + y * 4) * waist,
          y * .6 + .018 * Math.sin(t * 1.7 + x * 5) * waist,
          z * .38 * roundness / flow + .02 * Math.cos(t * 1.2 + y * 3) * waist);
      }
      p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    }

    updateSignal(e, basis, t) {
      const goal = this.localDelta([0, 0, 0], basis).add(this.baseEye);
      const remaining = Number(e.remaining);
      // Match the HUD's engine distance; local walking still changes physical projection.
      this.signalDistance = Number.isFinite(remaining) ? remaining : basis.origin.length();
      this.signalDetailBlend = this._menu ? 0 : smooth((500 - this.signalDistance) / 100);
      this.flame.visible = !this._menu && this.signalDetailBlend > 0;
      this.flameUniforms.time.value = t; this.flameUniforms.opacity.value = this.signalDetailBlend;
      this.flame.position.copy(goal); this.flame.position.y += Math.sin(t * 1.3) * .025;
      this.flame.scale.setScalar(1); this.flame.quaternion.identity();
      this.flameGlow.quaternion.copy(this.camera.quaternion);
      if (this.flame.visible) this.deformSignal(t);
      for (let i = 0; i < this.embers.length; i++) {
        const phase = (t / 2.8 + i / this.embers.length) % 1;
        const m = this.embers[i], emergence = smooth(phase / .18);
        const opacity = emergence * (1 - smooth((phase - .32) / .68)) * .7 * this.signalDetailBlend;
        const radius = (.065 + .024 * Math.sin(i * 2.4) ** 2) * (.6 + .4 * emergence) * (1 - .35 * phase);
        m.position.set(Math.sin(i * 2.4 + phase * 2) * (.12 + phase * .15), .38 + phase * 1.22,
          Math.cos(i * 2.4 + phase * 1.5) * .12);
        m.scale.set(radius, radius * 1.08, radius);
        m.material.uniforms.opacity.value = opacity;
        m.userData.phase = phase; m.userData.opacity = opacity;
        m.visible = this.flame.visible && opacity > .001;
      }
      // Through-rock perception is retained, but now its location and angular size are real.
      this.rockUniforms.flamePosition.value.copy(goal);
      this._goalMarker.copy(this.flame.position);
    }

    makeTarget() {
      this.target = new T.Group(); this.scene.add(this.target);
      this.targetMat = new T.MeshBasicMaterial({ color: REC_CLOSED, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false });
      const dot = new T.Mesh(new T.SphereGeometry(.09, 16, 12), this.targetMat); this.target.add(dot);
      this.targetRing = new T.Mesh(new T.RingGeometry(.16, .21, 64), this.targetMat); this.target.add(this.targetRing);
      this.targetOuterMat = new T.MeshBasicMaterial({ color: REC_HALO, transparent: true, opacity: .62, depthTest: false, depthWrite: false, fog: false });
      this.targetOuter = new T.Mesh(new T.RingGeometry(.30, .34, 64), this.targetOuterMat); this.target.add(this.targetOuter);
      // The recommendation reticle is the only pre-open marker. The actual
      // hole appears when the player opens it; there is no ghost door.
      this.target.traverse(o => { o.renderOrder = 28; });
    }

    cutMaterial(depthTest) {
      return new T.ShaderMaterial({
        uniforms: { cutSeed: { value: 0 }, cutKind: { value: 0 }, cutStyle: { value: 0 }, cutPaint: { value: this.cutPaint } },
        vertexShader: cutVertex, fragmentShader: cutFragment, extensions: { derivatives: true },
        transparent: true, depthTest, depthWrite: false, side: T.DoubleSide
      });
    }

    applyCut(mesh, seed, kind) {
      const u = mesh.material.uniforms;
      u.cutSeed.value = seed;
      u.cutKind.value = kind;
      u.cutStyle.value = Math.floor(seed * .6180339887) % 4;
    }

    makePortal() {
      const black = new T.MeshBasicMaterial({ color: '#000000', fog: false, toneMapped: false, opacity: 1, transparent: false, side: T.DoubleSide });
      this.portal = new T.Group(); this.portal.name = 'ground-entry'; this.scene.add(this.portal);
      this.portalInterior = new T.Mesh(new T.CircleGeometry(1, 128), black);
      this.portal.rotation.x = -Math.PI / 2; this.portal.add(this.portalInterior); this.portal.visible = false;
      // The cut face is a sibling, not a portal child: the black disk keeps its
      // exact one-mesh construction while the exposed rock gets its own depth.
      this.portalCut = new T.Mesh(new T.PlaneGeometry(4.2, 4.2), this.cutMaterial(true));
      this.portalCut.rotation.x = -Math.PI / 2; this.portalCut.visible = false; this.scene.add(this.portalCut);
      this.exitPortal = new T.Mesh(new T.CircleGeometry(1, 128), black);
      this.exitPortal.name = 'ceiling-exit'; this.exitPortal.rotation.x = Math.PI / 2;
      this.exitPortal.position.set(0, P.exitHeight, 0); this.exitPortal.scale.setScalar(P.portalRadius); this.scene.add(this.exitPortal);
      this.exitCut = new T.Mesh(new T.PlaneGeometry(4.2, 4.2), this.cutMaterial(true));
      this.exitCut.rotation.x = Math.PI / 2; this.exitCut.position.set(0, P.exitHeight - .0015, 0);
      this.exitCut.visible = false; this.scene.add(this.exitCut);
      this.repairShell = new T.Mesh(new T.SphereGeometry(P.repairRadius, 96, 64), this.repairMaterial);
      this.repairShell.name = 'local-repair-cavity'; this.repairShell.visible = false; this.scene.add(this.repairShell);
    }

    makeDust() {
      const r = random(8302), positions = [];
      // Motes drift inside the actual chamber volume, not through its wall.
      for (let i = 0; i < 92; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * 10.5;
        positions.push(Math.cos(a) * d, .35 + r() * 5.4, Math.sin(a) * d);
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      this.dust = new T.Points(g, new T.PointsMaterial({ color: '#9dbcc6', size: .026, transparent: true, opacity: .3, depthWrite: false, sizeAttenuation: true }));
      this.scene.add(this.dust);
    }

    makeWaves() {
      // Analytic field samples on a local sheet: distance to the actual spherical front.
      // Nothing here advances or approximates the simulation's hit/deadline decisions.
      const material = new T.ShaderMaterial({
        uniforms: this.rockUniforms,
        vertexShader: `varying vec3 vP; void main(){vec4 p=modelMatrix*vec4(position,1.0);vP=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
        fragmentShader: `uniform vec3 waveCenters[5]; uniform float waveRadii[5]; uniform float wavePowers[5];
          uniform float singleFront; uniform float singlePower; uniform vec3 entryCenter; uniform float entryRadius; varying vec3 vP;
          void main(){if(entryRadius>0.0 && distance(vP.xz,entryCenter.xz)<entryRadius)discard;float a=0.0;
            for(int i=0;i<5;i++){float d=abs(length(vP-waveCenters[i])-waveRadii[i]);a+=exp(-d*d*9.0)*wavePowers[i];}
            float d=abs(vP.z-singleFront);a+=exp(-d*d*7.0)*singlePower;
            gl_FragColor=vec4(.22,.52,.62,min(.19,a*.13));
          }`, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending
      });
      this.waveSheet = new T.Mesh(new T.PlaneGeometry(28, 40, 1, 1), material);
      this.waveSheet.rotation.x = -Math.PI / 2; this.waveSheet.position.set(0, .12, -9); this.scene.add(this.waveSheet);
    }

    makeFiller() {
      this.filler = new T.Group(); this.scene.add(this.filler);
      const g = stoneGeometry([0, 0, 0], [.23, .27, .2], [0, 0, 0], random(80), 0);
      const bag = new T.Mesh(g, new T.MeshBasicMaterial({ color: '#738992' })); this.filler.add(bag);
      const band = new T.Mesh(new T.CylinderGeometry(.242, .235, .065, 12), new T.MeshBasicMaterial({ color: '#bd7d73' }));
      this.filler.add(band); this.fillerBand = band;
      const knot = new T.Mesh(new T.DodecahedronGeometry(.11), band.material); knot.position.y = .31; knot.scale.set(1.2, .7, .75); this.filler.add(knot);
      this.filler.visible = false;
    }

    basis(engine) {
      const origin = vec(engine.pos || [16000, 0, 0]);
      // Local -Z is the goal bearing, never the recommendation or the player's gaze.
      const direction = origin.clone().negate();
      if (direction.lengthSq() < .001) direction.set(-1, 0, 0); direction.normalize();
      let right = new T.Vector3(direction.z, 0, -direction.x);
      if (right.lengthSq() < .001) right.set(0, 0, 1); right.normalize();
      const up = direction.clone().cross(right).normalize();
      return { origin, direction, right, up };
    }
    localDelta(point, basis) {
      const d = vec(point).sub(basis.origin);
      return new T.Vector3(d.dot(basis.right), d.dot(basis.up), -d.dot(basis.direction));
    }

    setPause(active) { this.pauseActive = !!active; }

    update(engine, dt, { menu = false } = {}) {
      if (this.disposed) return;
      const e = engine || {}, state = e.state || 'menu';
      this._menu = menu || state === 'menu';
      dt = Number.isFinite(dt) ? clamp(dt, 0, .1) : 0;
      this.visualTime += dt; const t = this.visualTime, simTime = Number(e.time) || 0;
      const stage = e.stage || e.mode || 'single', player = e.localPlayer;
      const blueRock = !this._menu && (e.requiredFiller ? e.requiredFiller === 'blue' : stage === 'five');
      this.rockUniforms.rockKind.value = blueRock ? 1 : 0;
      if (e.target && e.target.point) {
        this._holeSeed = cutSeedOf(e.target.point);
        this._holeKind = this.rockUniforms.rockKind.value;
      }
      const basis = this.basis(e);
      // Until land confirms passage, a blocked low exit keeps the player on the
      // source side. Never replace a wide source room around an unmoved camera.
      const kind = e.mode !== 'five' && stage !== 'five' && !(Number(e.jumps) || 0) ? 'karst' : 'sphere';
      const jumps = Number(e.jumps) || 0;
      if (this._menu) { this.lastJumps = jumps; this.exitCloseAt = -Infinity; }
      else if (this.lastJumps === null) this.lastJumps = jumps;
      else if (jumps !== this.lastJumps) {
        const crossedAt = Number(e.leftAt);
        const crossedNow = jumps > this.lastJumps && Number.isFinite(crossedAt) && crossedAt <= simTime;
        this.exitCloseAt = crossedNow && kind === 'sphere' ? crossedAt + PORTAL_CLOSE_SECONDS : -Infinity;
        this.lastJumps = jumps;
      }
      const leg = `${kind}:${stage}:${Number(e.jumps) || 0}:${(e.pos || []).map(v => Math.round(v * 13)).join(',')}`;
      if (leg !== this.lastLeg) {
        let seed = 417 + (Number(e.jumps) || 0) * 917;
        for (const p of e.pos || []) seed = (Math.imul(seed, 31) + Math.round(p * 13)) >>> 0;
        // Keep the same rock/equipment objects when the menu overlay closes.
        if (kind !== 'karst' || this.roomKind !== 'karst') this.makeRoom(seed, kind);
        this.landTime = t; this.lastLeg = leg;
      }
      const yaw = Number(player ? player.yaw : e.yaw) || 0;
      const pitch = clamp(Number(player ? player.pitch : e.pitch) || 0, -1.4, 1.4);
      const viewDirection = new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const feet = player && player.position ? vec(player.position) : new T.Vector3();
      this.camera.position.copy(this._menu ? this.menuEye : player && player.eye ? vec(player.eye) : feet.clone().add(this.baseEye));
      // Menu and player use one camera, one lens, one scene and the same start pose.
      this.camera.lookAt(this._menu ? this.menuLook : this.camera.position.clone().add(viewDirection));
      this.camera.fov = 74;
      const pauseTarget = !this._menu && this.pauseActive ? 1 : 0;
      this.pauseBlend += (pauseTarget - this.pauseBlend) * (1 - Math.exp(-7 * Math.max(dt, 1 / 120)));
      if (this.pauseBlend < 1e-4) this.pauseBlend = 0; else if (this.pauseBlend > .9999) this.pauseBlend = 1;
      if (this.pauseBlend > 0) {
        const ease = smooth(this.pauseBlend);
        const forward = this.camera.getWorldDirection(new T.Vector3());
        this.camera.position.addScaledVector(forward, -.35 * ease);
        this.camera.position.y += .18 * ease;
        this.camera.fov = 74 + 14 * ease;
      }
      this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
      if (state !== this.lastState) {
        if (state === 'throwing' || (state === 'packed' && this.lastState !== 'throwing')) this.throwTime = simTime;
        if (state === 'low' || (state === 'falling' && this.lastState !== 'low')) {
          this.lowStart = simTime;
          const floor = player?.floorHeight ? player.floorHeight(feet.x, feet.z) : 0;
          this.rockUniforms.repairCenter.value.set(feet.x, floor - P.repairRadius * .45, feet.z);
        }
        // Physics/input can process low + repair between two rendered frames.
        if (state === 'falling') this.repairStart = t;
        this.lastState = state;
      }
      this.startEquipment.visible = this.roomKind === 'karst';
      for (const lamp of this.menuLights) lamp.gameLight.visible = this.startEquipment.visible;

      this.updateSignal(e, basis, t);

      const hasRec = !!(e.rec && e.rec.point);
      this.target.visible = false;
      if (hasRec) {
        const delta = this.localDelta(e.rec.point, basis), distance = delta.length();
        const p = delta.add(this.baseEye);
        // A waypoint inside the eye would wrap the camera in its rings; keep the
        // marker on physically readable recommendations only.
        this.target.visible = !this._menu && distance > 2 && ['wait', 'ready', 'forming'].includes(state);
        // The marker lives at the real route point. A mild far-range scale keeps
        // the waypoint legible without turning it back into a near-camera decal.
        const markerScale = Math.min(2.5, Math.max(1, Math.sqrt(distance / 8)));
        this.target.position.copy(p); this.target.quaternion.copy(this.camera.quaternion);
        this.target.scale.setScalar(markerScale);
        this.targetRing.scale.setScalar(1 + Math.sin(t * 2.8) * .07);
        const recommendationOpen = simTime >= Number(e.rec.go) && simTime < Number(e.rec.nextB) && simTime < Number(e.aDeadline);
        this.targetMat.color.set(recommendationOpen ? REC_OPEN : REC_CLOSED);
        this.targetOuterMat.color.set(recommendationOpen ? REC_OPEN_HALO : REC_HALO);
        this._targetMarker.copy(p).add(new T.Vector3(0, -.43, 0));
      }
      const portalStates = ['forming', 'portal', 'throwing', 'packed', 'jumping', 'low', 'falling'];
      // Isolated scene previews use the same placement implementation, not a
      // second set of hand-tuned dimensions that can drift from collision.
      let entry = player?.portal;
      if (!player) {
        const previewPlayer = new root.RescuePlayer.Player();
        previewPlayer.reset({ cavity: this.roomKind === 'sphere' });
        previewPlayer.position = feet.toArray(); previewPlayer.yaw = yaw;
        entry = previewPlayer.placePortal();
      }
      this.portal.visible = !this._menu && portalStates.includes(state) && !!entry;
      if (entry) this.portal.position.set(entry.x, entry.y, entry.z);
      const formation = state === 'forming' ? smooth((simTime - (Number(e.openedAt) || 0)) / PORTAL_OPEN_SECONDS) : 1;
      this.portal.scale.setScalar(Math.max(.001, formation) * (entry?.radius || P.portalRadius));
      this.portalCut.position.copy(this.portal.position); this.portalCut.position.y += .0015;
      this.portalCut.scale.setScalar(this.portal.scale.x);
      this.portalCut.visible = this.portal.visible && this.portal.scale.x > .003;
      this.applyCut(this.portalCut, Number.isFinite(this._holeSeed) ? this._holeSeed : cutSeedOf(entry ? [entry.x, entry.y, entry.z] : e.pos), Number.isFinite(this._holeKind) ? this._holeKind : this.rockUniforms.rockKind.value);
      this.rockUniforms.entryCenter.value.copy(this.portal.position);
      this.rockUniforms.entryRadius.value = this.portal.visible ? this.portal.scale.x : 0;
      this.rockUniforms.portalPower.value = 0;
      // On the far side the hole you came through stays overhead for 0.3 s and
      // closes to a point. It is not a permanent ceiling decoration.
      const exitLife = this.roomKind === 'sphere' && !this._menu ? clamp((this.exitCloseAt - simTime) / PORTAL_CLOSE_SECONDS, 0, 1) : 0;
      this.exitPortal.visible = exitLife > 0;
      this.exitPortal.scale.setScalar(Math.max(.001, smooth(exitLife)) * P.portalRadius);
      this.exitPortal.position.set(0, P.exitHeight, 0);
      this.exitCut.scale.setScalar(this.exitPortal.scale.x);
      this.exitCut.visible = this.exitPortal.visible;
      this.applyCut(this.exitCut, Number.isFinite(this._holeSeed) ? this._holeSeed : cutSeedOf(e.pos), Number.isFinite(this._holeKind) ? this._holeKind : this.rockUniforms.rockKind.value);
      // The blocked entry stays visible on the source side until repair completes.
      // There is no below-floor fake disk and no camera forced through solid rock.
      this.repairShell.visible = !this._menu && this.roomKind === 'sphere' && state === 'falling';
      const cut = this.repairShell.visible ? smooth((t - (this.repairStart ?? t)) / .18) : 0;
      this.repairShell.position.copy(this.rockUniforms.repairCenter.value);
      this.repairShell.scale.setScalar(Math.max(.001, cut));
      this.rockUniforms.repairRadius.value = P.repairRadius * cut;
      this.filler.visible = ['throwing', 'packed', 'jumping'].includes(state) && !this._menu && stage !== 'silent' && stage !== 'training';
      if (this.filler.visible) {
        const progress = clamp((simTime - (this.throwTime ?? simTime)) / .2, 0, 1);
        const hand = this.camera.position.clone().add(new T.Vector3(Math.cos(yaw) * .38, -.55, Math.sin(yaw) * .38)).addScaledVector(viewDirection, .48);
        this.filler.position.copy(hand).lerp(this.portal.position.clone().add(new T.Vector3(0, -.34, 0)), progress);
        this.filler.rotation.set(progress * 2, yaw + progress, -.4);
        const fillerType = e.fillerType || e.requiredFiller || (stage === 'five' ? 'blue' : 'red');
        this.fillerBand.material.color.set(fillerType === 'blue' ? '#81b4cb' : '#bd7d73');
      }
      this.dust.visible = this.roomKind === 'karst' && !this.portal.visible;
      this.dust.position.y = Math.sin(t * .18) * .14;
      this.updateWaves(e, basis);
      this.scene.updateMatrixWorld(true);
      this.menuScene.visible = false;
      if (this.startEquipment.visible) this.updateMenuScene(t);
      this.renderer.render(this.scene, this.camera);
      this.frames++;
    }

    updateWaves(e, basis) {
      const u = this.rockUniforms, time = Number(e.time) || 0;
      u.wavePowers.value.fill(0); u.singlePower.value = 0;
      const world = e.scanWorld || (e.stage === 'five' ? e.world : null);
      this.waveSheet.visible = !this._menu && !!world && this.roomKind === 'karst';
      if (this._menu || e.stage === 'silent' || e.stage === 'training') return;
      if (world && Array.isArray(world.bells)) {
        const speed = Number(world.speed) || 10, period = Number(world.period) || 10;
        for (let i = 0; i < Math.min(5, world.bells.length); i++) {
          const bell = world.bells[i], relative = this.localDelta(bell.p, basis);
          const distance = relative.length(), phase = Number(bell.phase) || 0;
          // Select the closest real wave at A. Bells with activeAt have no
          // emissions before their restart; the phase stays the periodic grid.
          const first = Number.isFinite(bell.activeAt) ? Math.ceil((bell.activeAt - phase - 1e-7) / period) : -Infinity;
          const last = Math.floor((time - phase + 1e-7) / period);
          const n = Math.max(Math.round((time - phase - distance / speed) / period), first);
          const radius = (time - phase - n * period) * speed;
          u.waveCenters.value[i].copy(relative).add(this.caveCenter);
          u.waveRadii.value[i] = Math.max(0, radius);
          u.wavePowers.value[i] = n <= last && radius >= 0 && Math.abs(radius - distance) < 34 ? .7 : 0;
        }
      }
      // No timer-driven planar stand-in. Single and five-bell rendering both
      // sample the same fixed spherical sources used by actual detection.
    }

    project(point, visible) {
      const p = point.clone().project(this.camera), rect = this.canvas.getBoundingClientRect();
      const inFront = point.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new T.Vector3())) > 0;
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2,
        visible: !!visible && inFront && p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1.08 && Math.abs(p.y) < 1.08 };
    }
    getMarkers() {
      // HUD-only bearing proxy: preserve the camera-relative direction, not entity depth.
      // This remains projectable at 16 km, and still leaves the screen on a real turn.
      const bearing = this._goalMarker.clone().sub(this.camera.position);
      if (bearing.length() > 80) bearing.setLength(80);
      const hudGoal = this.camera.position.clone().add(bearing);
      const goal = this.project(hudGoal, !this._menu);
      // Keep the caption outside the projected 1.65 m halo at close range.
      const forward = this._goalMarker.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new T.Vector3()));
      const focal = this.canvas.getBoundingClientRect().height / (2 * Math.tan(this.camera.fov * Math.PI / 360));
      goal.captionOffsetX = Math.max(14, .85 * focal / Math.max(.1, forward) + 8);
      return { target: this.project(this._targetMarker, this.target.visible), goal };
    }
    getStartPose() {
      const direction = this.menuLook.clone().sub(this.menuEye).normalize();
      return { position: [this.menuEye.x, this.menuEye.y - P.eyeHeight, this.menuEye.z],
        yaw: Math.atan2(direction.x, -direction.z), pitch: Math.asin(direction.y) };
    }
    resize() {
      if (this.disposed) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width || this.canvas.clientWidth || root.innerWidth || 1);
      const h = Math.max(1, rect.height || this.canvas.clientHeight || root.innerHeight || 1);
      this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.65));
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
      // Principal point matches the HUD's crosshair at 50% / 46%.
      this.camera.setViewOffset(w, h, 0, h * .04, w, h); this.camera.updateProjectionMatrix();
      // No menu-specific FOV: hiding the menu cannot cause a lens jump.
    }
    stats() {
      if (!this.disposed) {
        const err = this.renderer.getContext().getError(); if (err) this.lastError = err;
      }
      const camera = this._menu ? this.menuCamera : this.camera;
      this.signalBody.updateWorldMatrix(true, false);
      this.signalBounds.copy(this.signalBody.geometry.boundingBox).applyMatrix4(this.signalBody.matrixWorld);
      const bodySize = this.signalBounds.getSize(new T.Vector3());
      return { drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, glError: this.lastError, frames: this.frames,
        activeScene: 'game-cave', sharedStartScene: true, flameVisible: this.flame.visible,
        targetSignal: { distance: this.signalDistance, viewDistance: this.flame.position.distanceTo(this.camera.position),
          detailBlend: this.signalDetailBlend, bodyHeightM: bodySize.y, bodySizeM: bodySize.toArray(),
          bodyBoundsM: { min: this.signalBounds.min.toArray(), max: this.signalBounds.max.toArray() },
          position: this.flame.position.toArray(), scale: this.flame.scale.toArray(), cameraFar: this.camera.far,
          particleCount: this.embers.filter(m => this.flame.visible && m.visible).length, particleCapacity: this.embers.length,
          particles: this.embers.map(m => ({ phase: m.userData.phase, opacity: m.userData.opacity, position: m.position.toArray(), radiusM: m.scale.x })),
          marker: this.getMarkers().goal },
        camera: { position: camera.position.toArray(), direction: camera.getWorldDirection(new T.Vector3()).toArray(), fov: camera.fov },
        baseEye: this.baseEye.toArray(), roomKind: this.roomKind, sphereRadius: this.sphere ? this.sphereRadius : null,
        sphereCenter: this.caveCenter.toArray(), geology: { seed: this.roomSeed, style: this.rockUniforms.strataStyle.value, axis: this.rockUniforms.strataAxis.value.toArray(), width: this.rockUniforms.strataWidth.value, kind: this.rockUniforms.rockKind.value },
        equipmentVisible: this.startEquipment.visible,
        portal: { visible: this.portal.visible, geometry: this.portalInterior.geometry.type, color: this.portalInterior.material.color.getHexString(), fog: this.portalInterior.material.fog, opacity: this.portalInterior.material.opacity, position: this.portal.position.toArray(), scale: this.portal.scale.toArray(), normal: new T.Vector3(0, 0, 1).applyQuaternion(this.portal.quaternion).toArray() },
        exit: { visible: this.exitPortal.visible, position: this.exitPortal.position.toArray(), scale: this.exitPortal.scale.toArray(), closeAt: this.exitCloseAt, normal: new T.Vector3(0, 0, 1).applyQuaternion(this.exitPortal.quaternion).toArray() },
        cut: {
          portal: { visible: this.portalCut.visible, seed: this.portalCut.material.uniforms.cutSeed.value, style: this.portalCut.material.uniforms.cutStyle.value, kind: this.portalCut.material.uniforms.cutKind.value, plane: this.portalCut.geometry.type },
          exit: { visible: this.exitCut.visible, seed: this.exitCut.material.uniforms.cutSeed.value, style: this.exitCut.material.uniforms.cutStyle.value, kind: this.exitCut.material.uniforms.cutKind.value, plane: this.exitCut.geometry.type }
        },
        repair: { visible: this.repairShell.visible, radius: this.rockUniforms.repairRadius.value, center: this.repairShell.position.toArray() },
        waveOrigin: this.caveCenter.toArray(),
        menu: { visible: this._menu, sharedCamera: this.menuCamera === this.camera, startPose: this.getStartPose(), screens: this.menuScreens.length, screenFrame: this.menuScreenFrame,
          lights: this.menuLights.map(l => l.light.intensity), lookAt: this.menuLook.toArray(),
          equipment: ['main-crt', 'secondary-crt', 'field-laptop', 'instrument-rack', 'console-desk'] } };
    }
    dispose() {
      if (this.disposed) return; this.disposed = true;
      root.removeEventListener('resize', this._onResize);
      const geometries = new Set(), materials = new Set(), textures = new Set([this.atlas, this.cutPaint, this.glowMap]);
      for (const scene of [this.scene, this.menuScene]) scene.traverse(o => {
        if (o.geometry) geometries.add(o.geometry);
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          materials.add(m); if (m.map) textures.add(m.map); if (m.gradientMap) textures.add(m.gradientMap);
        });
        if (o.isLight && o.shadow) o.shadow.dispose();
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
      this.renderer.dispose();
    }
  }
  root.CaveScene = CaveScene;
})(window);
