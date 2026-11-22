(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RescuePlayer = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const R = 1.4;
  const EYE = 1.65;
  const BODY_RADIUS = 0.22;
  const HEAD = EYE + 0.2;
  const PORTAL_RADIUS = 0.6;
  const EXIT_CEILING_CLEARANCE = 0.12;
  const EXIT_HEIGHT = R + Math.sqrt(R * R - PORTAL_RADIUS * PORTAL_RADIUS) - EXIT_CEILING_CLEARANCE;
  const EXIT_HEAD_CLEARANCE = 0.08;
  const WALK_RADIUS = Math.sqrt(R * R - (HEAD / 2) ** 2) - BODY_RADIUS;
  const EPS = 1e-9;
  const PHYSICS = Object.freeze({
    eyeHeight: EYE,
    speed: 4.5,
    gravity: 20,
    jumpSpeed: 4.2,
    radius: R,
    bodyRadius: BODY_RADIUS,
    headHeight: HEAD,
    walkableRadius: WALK_RADIUS,
    maxStep: 1 / 120,
    portalRadius: PORTAL_RADIUS,
    portalDistance: 0.75,
    portalLift: 0.09,
    portalCenterRadius: 0.3,
    exitCeilingClearance: EXIT_CEILING_CLEARANCE,
    exitHeight: EXIT_HEIGHT,
    exitHeadClearance: EXIT_HEAD_CLEARANCE,
    exitFeetHeight: EXIT_HEIGHT - HEAD - EXIT_HEAD_CLEARANCE,
    cameraNear: 0.05,
    repairRadius: 1.2,
    portalApproachMargin: 0.12,
    startBounds: Object.freeze({ x: 10, z: 9 }),
    equipment: Object.freeze({ minX: 5, maxX: 10, minZ: -6, maxZ: 2 })
  });

  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  function keyCode(code) {
    if (typeof code !== 'string') return null;
    if (/^Key[WASD]$/.test(code) || code === 'Space') return code;
    if (/^[wasd]$/i.test(code)) return 'Key' + code.toUpperCase();
    return code === ' ' ? 'Space' : null;
  }

  class Player {
    constructor() {
      this.reset();
    }

    reset({ cavity = false, fromExit = false } = {}) {
      this.cavity = Boolean(cavity);
      const arriving = this.cavity && fromExit;
      this.position = [0, arriving ? PHYSICS.exitFeetHeight : 0, 0];
      this.velocity = [0, arriving ? -0.8 : 0, 0];
      this.yaw = 0;
      this.pitch = 0;
      this.grounded = !arriving;
      this.portal = null;
      this._keys = new Set();
      this._stick = { x: 0, y: 0 };
      this._jumpQueued = false;
      this._jumped = false;
      this._portalConsumed = false;
      return this;
    }

    get eye() {
      return [this.position[0], this.position[1] + EYE, this.position[2]];
    }

    get walkableRadius() {
      return WALK_RADIUS;
    }

    floorHeight(x, z) {
      return this.cavity ? R - Math.sqrt(Math.max(0, R * R - x * x - z * z)) : 0;
    }

    // A head-sized horizontal safety disk, not a cylindrical room wall.
    ceilingHeight(x, z) {
      if (!this.cavity) return Infinity;
      const radial = Math.hypot(x, z) + BODY_RADIUS;
      return R + Math.sqrt(Math.max(0, R * R - radial * radial));
    }

    look(dx, dy) {
      if (Number.isFinite(dx)) {
        const turn = Math.PI * 2;
        this.yaw = ((this.yaw + dx + Math.PI) % turn + turn) % turn - Math.PI;
      }
      if (Number.isFinite(dy)) this.pitch = clamp(this.pitch + dy, -1.4, 1.4);
    }

    setKey(code, down) {
      code = keyCode(code);
      if (!code) return;
      if (down) {
        if (code === 'Space' && !this._keys.has(code)) this._jumpQueued = true;
        this._keys.add(code);
      } else {
        this._keys.delete(code);
      }
    }

    setStick(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      this._stick.x = clamp(x, -1, 1);
      this._stick.y = clamp(y, -1, 1);
    }

    clearInput() {
      this._keys.clear();
      this._stick.x = 0;
      this._stick.y = 0;
      this._jumpQueued = false;
    }

    _boundXZ(x, z, inset = 0) {
      if (this.cavity) {
        const limit = WALK_RADIUS - inset;
        const distance = Math.hypot(x, z);
        if (distance > limit) return [x * limit / distance, z * limit / distance];
      } else {
        const baseX = PHYSICS.startBounds.x - BODY_RADIUS;
        const baseZ = PHYSICS.startBounds.z - BODY_RADIUS;
        // Homothetic erosion guarantees a whole circular rim fits. Merely
        // subtracting inset from each ellipse axis is not conservative.
        const scale = 1 - inset / Math.min(baseX, baseZ);
        const rx = baseX * scale;
        const rz = baseZ * scale;
        const distance = Math.hypot(x / rx, z / rz);
        if (distance > 1) return [x / distance, z / distance];
      }
      return [x, z];
    }

    _equipmentBounds(padding) {
      const box = PHYSICS.equipment;
      return {
        minX: box.minX - padding, maxX: box.maxX + padding,
        minZ: box.minZ - padding, maxZ: box.maxZ + padding
      };
    }

    _insideEquipment(x, z, padding) {
      if (this.cavity) return false;
      const b = this._equipmentBounds(padding);
      return x > b.minX + EPS && x < b.maxX - EPS &&
        z > b.minZ + EPS && z < b.maxZ - EPS;
    }

    _slideEquipment(fromX, fromZ, x, z) {
      if (this.cavity) return [x, z];
      const b = this._equipmentBounds(BODY_RADIUS);
      const rx = PHYSICS.startBounds.x - BODY_RADIUS;
      const rz = PHYSICS.startBounds.z - BODY_RADIUS;
      // Resolve each axis against BOTH constraints. Projecting an ellipse
      // first, then pushing out of a cabinet, can leave the ellipse at corners.
      const limitX = rx * Math.sqrt(Math.max(0, 1 - (fromZ / rz) ** 2));
      x = clamp(x, -limitX, limitX);
      if (fromZ > b.minZ && fromZ < b.maxZ) {
        if (fromX <= b.minX && x > b.minX) x = b.minX;
        else if (fromX >= b.maxX && x < b.maxX) x = b.maxX;
      }
      const limitZ = rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
      z = clamp(z, -limitZ, limitZ);
      if (x > b.minX && x < b.maxX) {
        if (fromZ <= b.minZ && z > b.minZ) z = b.minZ;
        else if (fromZ >= b.maxZ && z < b.maxZ) z = b.maxZ;
      }
      return [x, z];
    }

    _clearApproach(x, z) {
      if (this.cavity) return true;
      const b = this._equipmentBounds(BODY_RADIUS);
      const start = [this.position[0], this.position[2]];
      const end = [x, z];
      let near = 0, far = 1;
      for (let axis = 0; axis < 2; axis++) {
        const low = axis === 0 ? b.minX : b.minZ;
        const high = axis === 0 ? b.maxX : b.maxZ;
        const d = end[axis] - start[axis];
        if (Math.abs(d) < EPS) {
          if (start[axis] <= low || start[axis] >= high) return true;
        } else {
          const t1 = (low - start[axis]) / d;
          const t2 = (high - start[axis]) / d;
          near = Math.max(near, Math.min(t1, t2));
          far = Math.min(far, Math.max(t1, t2));
        }
      }
      return far <= near + EPS;
    }

    portalHeight(x, z) {
      // The outermost rim, not the centre, sets the horizontal plane height.
      return this.floorHeight(Math.hypot(x, z) + PHYSICS.portalRadius, 0) + PHYSICS.portalLift;
    }

    placePortal() {
      if (this.cavity) {
        let x = this.position[0] + Math.sin(this.yaw) * PHYSICS.portalDistance;
        let z = this.position[2] - Math.cos(this.yaw) * PHYSICS.portalDistance;
        const radial = Math.hypot(x, z);
        if (radial > PHYSICS.portalCenterRadius) {
          x *= PHYSICS.portalCenterRadius / radial;
          z *= PHYSICS.portalCenterRadius / radial;
        }
        this.portal = { x, y: this.portalHeight(x, z), z, radius: PHYSICS.portalRadius };
        this._portalConsumed = false;
        return this.portal;
      }
      const inset = PHYSICS.portalRadius + PHYSICS.portalApproachMargin;
      // In the large starting room prefer a forward portal outside the feet.
      // At a wall/cabinet rotate or move inward without clipping the rim.
      for (const distance of [PHYSICS.portalDistance, 1.4, 2, 2.8]) {
        for (let i = 0; i < 33; i++) {
          const offset = i === 0 ? 0 : Math.ceil(i / 2) * Math.PI / 16 * (i % 2 ? 1 : -1);
          const angle = this.yaw + offset;
          const [x, z] = this._boundXZ(
            this.position[0] + Math.sin(angle) * distance,
            this.position[2] - Math.cos(angle) * distance,
            inset
          );
          if (Math.hypot(x - this.position[0], z - this.position[2]) < PHYSICS.portalRadius + 0.025) continue;
          if (this._insideEquipment(x, z, inset + BODY_RADIUS) || !this._clearApproach(x, z)) continue;
          this.portal = { x, y: this.portalHeight(x, z), z, radius: PHYSICS.portalRadius };
          this._portalConsumed = false;
          return this.portal;
        }
      }
      // Only reachable if callers have externally put the player outside the
      // supported room. Do not replace an existing valid portal with bad data.
      return null;
    }

    _intent(h, options) {
      let forward = Number(this._keys.has('KeyW')) - Number(this._keys.has('KeyS')) + this._stick.y;
      let right = Number(this._keys.has('KeyD')) - Number(this._keys.has('KeyA')) + this._stick.x;
      const length = Math.hypot(forward, right);
      let jump = this._jumpQueued;
      this._jumpQueued = false;
      if (length > 1) {
        forward /= length;
        right /= length;
      }
      if (length > 1e-4) {
        return {
          x: (Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) * PHYSICS.speed,
          z: (-Math.cos(this.yaw) * forward + Math.sin(this.yaw) * right) * PHYSICS.speed,
          jump
        };
      }
      if (options.autoJump && options.portalActive && this.portal && !this._portalConsumed) {
        const dx = this.portal.x - this.position[0];
        const dz = this.portal.z - this.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance > 0.015) {
          const speed = Math.min(PHYSICS.speed, distance / h);
          return { x: dx / distance * speed, z: dz / distance * speed, jump };
        }
        jump = jump || (options.canEnter && this.grounded);
      }
      return { x: 0, z: 0, jump };
    }

    _substep(h, options) {
      const intent = this._intent(h, options);
      if (intent.jump && this.grounded) {
        this.velocity[1] = PHYSICS.jumpSpeed;
        this.grounded = false;
        this._jumped = true;
      }
      const [oldX, oldY, oldZ] = this.position;
      const oldVY = this.velocity[1];
      const targetX = oldX + intent.x * h;
      const targetZ = oldZ + intent.z * h;
      let [x, z] = this.cavity ? this._boundXZ(targetX, targetZ) :
        this._slideEquipment(oldX, oldZ, targetX, targetZ);
      let y = oldY + oldVY * h - PHYSICS.gravity * h * h / 2;
      let vy = oldVY - PHYSICS.gravity * h;
      let ceilingHit = false;
      if (this.cavity && !this.grounded) {
        // Resolve vertical ascent at the OLD XZ first. Then constrain horizontal
        // motion to the head disk at the resulting height, rather than shoving
        // an arriving player down through the curved ceiling on a sideways step.
        const ceiling = this.ceilingHeight(oldX, oldZ) - HEAD;
        if (y > ceiling) {
          y = ceiling;
          vy = Math.min(0, vy);
          ceilingHit = true;
        }
        const headOffset = Math.max(0, y + HEAD - R);
        const limit = Math.max(0, Math.sqrt(Math.max(0, R * R - headOffset * headOffset)) - BODY_RADIUS);
        const radial = Math.hypot(x, z);
        if (radial > limit) {
          x *= limit / radial;
          z *= limit / radial;
        }
      }
      this.velocity[0] = (x - oldX) / h;
      this.velocity[2] = (z - oldZ) / h;
      const floor = this.floorHeight(x, z);
      if (this.grounded) {
        this.position[0] = x;
        this.position[1] = floor;
        this.position[2] = z;
        this.velocity[1] = 0;
        return false;
      }

      const p = this.portal;
      const armed = p && options.portalActive && options.canEnter && this._jumped && !this._portalConsumed;
      if (armed && !ceilingHit) {
        // Solve the descending ballistic plane contact, not a frame-end
        // proximity test. Interpolate XZ at that same time before floor contact.
        const discriminant = oldVY * oldVY + 2 * PHYSICS.gravity * (oldY - p.y);
        if (discriminant >= 0) {
          const time = (oldVY + Math.sqrt(discriminant)) / PHYSICS.gravity;
          if (time >= -EPS && time <= h + EPS && oldVY - PHYSICS.gravity * time < -EPS) {
            const fraction = clamp(time / h, 0, 1);
            const crossX = oldX + (x - oldX) * fraction;
            const crossZ = oldZ + (z - oldZ) * fraction;
            if ((crossX - p.x) ** 2 + (crossZ - p.z) ** 2 < p.radius ** 2 - EPS) {
              this.position[0] = crossX;
              this.position[1] = p.y;
              this.position[2] = crossZ;
              this.velocity[1] = oldVY - PHYSICS.gravity * Math.max(0, time);
              this._portalConsumed = true;
              return true;
            }
          }
        }
      }

      // The entire elevated portal is above the spherical floor. No under-floor
      // exception is needed: walking and unrelated falls always retain solid rock.
      if (y <= floor) {
        y = floor;
        vy = 0;
        this.grounded = true;
        this._jumped = false;
      }
      this.position[0] = x;
      this.position[1] = y;
      this.position[2] = z;
      this.velocity[1] = vy;
      return false;
    }

    step(dt, { enabled = true, portalActive = false, canEnter = false, autoJump = false } = {}) {
      if (!enabled || !Number.isFinite(dt) || dt <= 0) return { entered: false };
      const count = Math.ceil(dt / PHYSICS.maxStep);
      const h = dt / count;
      const options = { portalActive, canEnter, autoJump };
      for (let i = 0; i < count; i++) {
        if (this._substep(h, options)) return { entered: true };
      }
      return { entered: false };
    }
  }

  return { Player, PHYSICS };
}));
