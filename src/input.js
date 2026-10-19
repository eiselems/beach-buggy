// Keyboard and gamepad controls
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since the last frame
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padButtons = [];
    this.touch = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: 0 };
    if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) this.createTouchControls();
  }

  // On-screen controls for phones and tablets: drag on the left to steer, buttons on the right
  createTouchControls() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="t-steer"><div id="t-knob"></div></div>
      <div id="t-pedals">
        <button id="t-brake">BRAKE</button>
        <button id="t-boost">BOOST</button>
        <button id="t-gas">GAS</button>
      </div>
      <div id="t-small">
        <button id="t-hand">DRIFT</button>
        <button id="t-cam">CAM</button>
        <button id="t-reset">RESET</button>
      </div>`;
    document.body.appendChild(root);
    const steerPad = root.querySelector('#t-steer');
    const knob = root.querySelector('#t-knob');
    let steerId = null, startX = 0;
    steerPad.addEventListener('pointerdown', (e) => {
      steerId = e.pointerId;
      startX = e.clientX;
      steerPad.setPointerCapture(e.pointerId);
    });
    steerPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== steerId) return;
      const dx = Math.max(-60, Math.min(60, e.clientX - startX));
      knob.style.transform = `translateX(${dx}px)`;
      this.touch.steer = -dx / 60;
    });
    const endSteer = (e) => {
      if (e.pointerId !== steerId) return;
      steerId = null;
      knob.style.transform = '';
      this.touch.steer = 0;
    };
    steerPad.addEventListener('pointerup', endSteer);
    steerPad.addEventListener('pointercancel', endSteer);

    const hold = (id, key) => {
      const el = root.querySelector(id);
      const on = (e) => { e.preventDefault(); this.touch[key] = key === 'handbrake' ? true : 1; el.classList.add('down'); };
      const off = () => { this.touch[key] = key === 'handbrake' ? false : 0; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    hold('#t-gas', 'throttle');
    hold('#t-brake', 'brake');
    hold('#t-hand', 'handbrake');
    hold('#t-boost', 'boost');
    root.querySelector('#t-cam').addEventListener('pointerdown', () => this.pressed.add('KeyC'));
    root.querySelector('#t-reset').addEventListener('pointerdown', () => this.pressed.add('KeyR'));
  }

  // Returns the driving input for this frame
  read() {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    let handbrake = k.has('Space');
    let horn = k.has('KeyH');
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0;
    // touch controls
    const t = this.touch;
    throttle = Math.max(throttle, t.throttle);
    brake = Math.max(brake, t.brake);
    if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
    handbrake = handbrake || t.handbrake;
    boost = Math.max(boost, t.boost);
    const actions = {
      reset: this.pressed.has('KeyR'),
      camera: this.pressed.has('KeyC'),
      mute: this.pressed.has('KeyM'),
    };

    // Gamepad: right trigger = gas, left trigger = brake/reverse, left stick = steer,
    // B = boost (like Rocket League), A/X = handbrake, Y = reset, RB = camera, LB = horn
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
      const stick = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0;
      steer = Math.abs(stick) > Math.abs(steer) ? -Math.sign(stick) * Math.pow(Math.abs(stick), 1.4) : steer;
      throttle = Math.max(throttle, b(7));
      brake = Math.max(brake, b(6));
      handbrake = handbrake || b(0) > 0.5 || b(2) > 0.5;
      boost = Math.max(boost, b(1) > 0.5 ? 1 : 0);
      horn = horn || b(4) > 0.5;
      const was = this.padButtons;
      const now = pad.buttons.map((x) => x.pressed);
      if (now[3] && !was[3]) actions.reset = true;
      if (now[5] && !was[5]) actions.camera = true;
      this.padButtons = now;
      break;
    }
    this.pressed.clear();
    return { throttle, brake, steer, handbrake, horn, boost, ...actions };
  }
}
