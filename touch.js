(function (root) {
  'use strict';

  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

  class TouchControls {
    constructor({ getEngine, getPlayer, canInput, look, settle, stepDistance, fast, focusGame }) {
      this.getEngine = getEngine;
      this.getPlayer = getPlayer;
      this.canInput = canInput;
      this.look = look;
      this.settle = settle || (() => {});
      this.stepDistance = stepDistance;
      this.fast = fast;
      this.focusGame = focusGame;
      this.active = false;
      this.stickPointer = null;
      this.stickRect = null;
      this.lookPointer = null;
      this.lookAt = null;
      this.holdStop = null;
      this.el = {};
      for (const id of [
        'touchLayer', 'touchLook', 'touchStick', 'touchKnob', 'touchRed', 'touchBlue',
        'touchNear', 'touchFar', 'touchDistance', 'touchFiller', 'touchFast', 'touchRepair',
        'touchFill', 'touchJump', 'touchOpen', 'touchSignal', 'touchMeta'
      ]) this.el[id] = document.getElementById(id);
      if (!this.el.touchLayer) return;
      this.bindStick();
      this.bindLook();
      this.bindActions();
    }

    get ready() {
      return this.active && this.canInput();
    }

    setActive(active) {
      this.active = Boolean(active);
      this.el.touchLayer.hidden = !this.active;
      if (!this.active) {
        this.releaseStick();
        this.releaseLook();
        this.setFast(false);
        this.stopHold();
      }
    }

    bindStick() {
      const zone = this.el.touchStick, knob = this.el.touchKnob;
      const end = event => {
        if (event && event.pointerId !== this.stickPointer) return;
        this.releaseStick();
      };
      zone.addEventListener('pointerdown', event => {
        if (!this.ready || this.stickPointer !== null) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        this.stickPointer = event.pointerId;
        this.stickRect = zone.getBoundingClientRect();
        zone.classList.add('engaged');
        try { zone.setPointerCapture(event.pointerId); } catch {}
        this.moveStick(event);
      });
      zone.addEventListener('pointermove', event => {
        if (event.pointerId !== this.stickPointer) return;
        event.preventDefault();
        this.moveStick(event);
      });
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
      zone.addEventListener('lostpointercapture', end);
    }

    moveStick(event) {
      const rect = this.stickRect;
      if (!rect) return;
      const limit = rect.width * .29;
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(dx, dy);
      if (length > limit) {
        dx *= limit / length;
        dy *= limit / length;
      }
      this.el.touchKnob.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
      let x = dx / limit, y = -dy / limit;
      const magnitude = Math.hypot(x, y);
      if (magnitude < .12) {
        x = y = 0;
      } else {
        const scaled = (Math.min(1, magnitude) - .12) / .88;
        x = x / magnitude * scaled;
        y = y / magnitude * scaled;
      }
      this.getPlayer().setStick(x, y);
    }

    releaseStick() {
      if (this.stickPointer !== null) {
        try { this.el.touchStick.releasePointerCapture(this.stickPointer); } catch {}
      }
      this.stickPointer = null;
      this.stickRect = null;
      this.el.touchStick.classList.remove('engaged');
      this.el.touchKnob.style.transform = '';
      this.getPlayer()?.setStick(0, 0);
    }

    bindLook() {
      const zone = this.el.touchLook;
      zone.addEventListener('pointerdown', event => {
        if (!this.ready || this.lookPointer !== null) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        this.lookPointer = event.pointerId;
        this.lookAt = { x: event.clientX, y: event.clientY };
        zone.classList.add('engaged');
        try { zone.setPointerCapture(event.pointerId); } catch {}
      });
      zone.addEventListener('pointermove', event => {
        if (event.pointerId !== this.lookPointer || !this.lookAt) return;
        event.preventDefault();
        if (!this.ready) { this.releaseLook(); return; }
        const dx = event.clientX - this.lookAt.x;
        const dy = event.clientY - this.lookAt.y;
        this.lookAt = { x: event.clientX, y: event.clientY };
        this.getPlayer().look(dx * .0042, -dy * .0042);
        this.look();
      });
      const end = event => {
        if (event && event.pointerId !== this.lookPointer) return;
        const hadLook = this.lookPointer !== null;
        this.releaseLook();
        if (hadLook) this.settle();
      };
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
      zone.addEventListener('lostpointercapture', end);
    }

    releaseLook() {
      if (this.lookPointer !== null) {
        try { this.el.touchLook.releasePointerCapture(this.lookPointer); } catch {}
      }
      this.lookPointer = null;
      this.lookAt = null;
      this.el.touchLook.classList.remove('engaged');
    }

    bindActions() {
      this.tap(this.el.touchOpen, () => this.getEngine().open());
      this.tap(this.el.touchJump, () => {
        const player = this.getPlayer();
        player.setKey('Space', true);
        player.setKey('Space', false);
      });
      this.tap(this.el.touchFill, () => this.getEngine().fill());
      this.tap(this.el.touchRepair, () => this.getEngine().repair());
      this.tap(this.el.touchRed, () => this.getEngine().selectFiller('red'));
      this.tap(this.el.touchBlue, () => this.getEngine().selectFiller('blue'));
      this.hold(this.el.touchNear, () => this.stepDistance(-2));
      this.hold(this.el.touchFar, () => this.stepDistance(2));
      const fast = this.el.touchFast;
      fast.addEventListener('pointerdown', event => {
        if (!this.ready) return;
        event.preventDefault();
        event.stopPropagation();
        fast.classList.add('pressed');
        this.setFast(true);
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
        fast.addEventListener(type, () => {
          fast.classList.remove('pressed');
          this.setFast(false);
        });
      }
      window.addEventListener('blur', () => this.setFast(false));
    }

    tap(element, action) {
      element.addEventListener('pointerdown', event => {
        if (!this.ready) return;
        event.preventDefault();
        event.stopPropagation();
        element.classList.add('pressed');
        setTimeout(() => element.classList.remove('pressed'), 140);
        this.focusGame();
        action();
      });
      element.addEventListener('click', event => {
        if (event.detail !== 0 || !this.ready) return;
        this.focusGame();
        action();
      });
    }

    hold(element, action) {
      const stop = () => {
        clearTimeout(element._holdDelay);
        clearInterval(element._holdRepeat);
        element._holdDelay = element._holdRepeat = 0;
        element.classList.remove('pressed');
        if (this.holdStop === stop) this.holdStop = null;
      };
      element.addEventListener('pointerdown', event => {
        if (!this.ready) return;
        event.preventDefault();
        event.stopPropagation();
        stop();
        element.classList.add('pressed');
        this.focusGame();
        action();
        element._holdDelay = setTimeout(() => {
          element._holdRepeat = setInterval(action, 90);
        }, 320);
        this.holdStop = stop;
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) element.addEventListener(type, stop);
    }

    stopHold() {
      if (this.holdStop) this.holdStop();
    }

    setFast(on) {
      if (on && !this.ready) return;
      this.fast(on);
    }

    update(engine, info) {
      if (!this.el.touchLayer) return;
      this.el.touchLayer.classList.toggle('idle', !this.ready);
      const state = engine.state;
      const active = ['ready', 'forming', 'portal', 'throwing', 'packed', 'jumping', 'falling', 'low'].includes(state);
      const bagLocked = engine.paused || engine.assists.autoSwitch ||
        !['wait', 'ready', 'forming', 'portal', 'packed', 'low'].includes(state);
      this.el.touchRed.disabled = this.el.touchBlue.disabled = bagLocked;
      this.el.touchRed.classList.toggle('selected', engine.fillerType === 'red');
      this.el.touchBlue.classList.toggle('selected', engine.fillerType === 'blue');
      this.el.touchOpen.classList.toggle('ready', Boolean(info.openReady));
      this.el.touchFill.classList.toggle('armed', state === 'portal' && !engine.noScan);
      this.el.touchJump.classList.toggle('armed', state === 'portal' || state === 'packed');
      this.el.touchRepair.classList.toggle('alarm', state === 'low');
      this.el.touchFast.hidden = !info.fastAvailable;
      this.el.touchLayer.classList.toggle('danger', Boolean(info.danger));
      if (this.el.touchDistance.textContent !== info.distance) this.el.touchDistance.textContent = info.distance;
      if (this.el.touchFiller.textContent !== info.filler) this.el.touchFiller.textContent = info.filler;
      if (this.el.touchSignal.textContent !== info.signal) this.el.touchSignal.textContent = info.signal;
      if (this.el.touchMeta.textContent !== info.meta) this.el.touchMeta.textContent = info.meta;
    }
  }

  root.RescueTouch = { TouchControls };
}(typeof window !== 'undefined' ? window : globalThis));
