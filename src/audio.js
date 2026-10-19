// All sounds are synthesized live with the Web Audio API: engine, waves, wind, horn.

function noiseBuffer(ctx, seconds, brown = false) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = white;
  }
  return buf;
}

function loopNoise(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return src;
}

// gear ratios as speed (m/s) at which each gear reaches the rev limiter
const GEARS = [9, 16, 23, 30, 36];
const IDLE = 900, REDLINE = 6800;

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.gear = 1;
    this.rpm = IDLE;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // --- engine: a few oscillators through distortion and a filter
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 3;
    shaper.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.oscs = [
      { type: 'sawtooth', mult: 1, gain: 0.35 },
      { type: 'square', mult: 0.5, gain: 0.3 },
      { type: 'sawtooth', mult: 2.01, gain: 0.12 },
      { type: 'triangle', mult: 0.25, gain: 0.4 },
    ].map((o) => {
      const osc = ctx.createOscillator();
      osc.type = o.type;
      const g = ctx.createGain();
      g.gain.value = o.gain;
      osc.connect(g);
      g.connect(shaper);
      osc.start();
      return { osc, mult: o.mult };
    });
    // rumble: noise modulated by the firing pulses
    const rumble = loopNoise(ctx, noiseBuffer(ctx, 2));
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'bandpass';
    this.rumbleFilter.Q.value = 1.5;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.0;
    rumble.connect(this.rumbleFilter);
    this.rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.engineGain);

    // --- ocean waves
    const surf = loopNoise(ctx, noiseBuffer(ctx, 6, true));
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'lowpass';
    this.surfFilter.frequency.value = 700;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    surf.connect(this.surfFilter);
    this.surfFilter.connect(this.surfGain);
    this.surfGain.connect(this.master);
    const hiss = loopNoise(ctx, noiseBuffer(ctx, 4));
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'highpass';
    this.hissFilter.frequency.value = 2500;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(this.hissFilter);
    this.hissFilter.connect(this.hissGain);
    this.hissGain.connect(this.master);

    // --- wind rushing past, and sand/tire noise
    const windSrc = loopNoise(ctx, noiseBuffer(ctx, 4));
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    const sandSrc = loopNoise(ctx, noiseBuffer(ctx, 3));
    this.sandFilter = ctx.createBiquadFilter();
    this.sandFilter.type = 'bandpass';
    this.sandFilter.frequency.value = 1800;
    this.sandFilter.Q.value = 0.8;
    this.sandGain = ctx.createGain();
    this.sandGain.gain.value = 0;
    sandSrc.connect(this.sandFilter);
    this.sandFilter.connect(this.sandGain);
    this.sandGain.connect(this.master);
    const splashSrc = loopNoise(ctx, noiseBuffer(ctx, 3));
    this.splashFilter = ctx.createBiquadFilter();
    this.splashFilter.type = 'lowpass';
    this.splashFilter.frequency.value = 1400;
    this.splashGain = ctx.createGain();
    this.splashGain.gain.value = 0;
    splashSrc.connect(this.splashFilter);
    this.splashFilter.connect(this.splashGain);
    this.splashGain.connect(this.master);

    // --- horn
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      o.connect(lp);
      lp.connect(this.hornGain);
      o.start();
    }
    this.hornGain.connect(this.master);

    // --- boost: a roaring jet of noise
    const jet = loopNoise(ctx, noiseBuffer(ctx, 3));
    this.boostFilter = ctx.createBiquadFilter();
    this.boostFilter.type = 'bandpass';
    this.boostFilter.frequency.value = 500;
    this.boostFilter.Q.value = 0.7;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    jet.connect(this.boostFilter);
    this.boostFilter.connect(this.boostGain);
    const jetLow = loopNoise(ctx, noiseBuffer(ctx, 3, true));
    const jetLowGain = ctx.createGain();
    jetLowGain.gain.value = 1.5;
    jetLow.connect(jetLowGain);
    jetLowGain.connect(this.boostGain);
    this.boostGain.connect(this.master);
  }

  // a thud when the buggy lands from a jump
  thump(strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, strength * 0.08), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  // a little chime when you pick up boost
  pickup(big) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = big ? [660, 880, 1320] : [990];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.06);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.35);
      o.connect(g);
      g.connect(this.master);
      o.start(t + i * 0.06);
      o.stop(t + i * 0.06 + 0.4);
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // speed m/s, throttle 0..1, slip amount, shoreDistance meters, water depth, horn bool
  update(dt, { speed, throttle, slip, airborne, shoreDistance, water, horn, time, boost = 0 }) {
    const s = Math.abs(speed);
    // simple automatic gearbox
    const top = GEARS[this.gear - 1];
    const low = this.gear > 1 ? GEARS[this.gear - 2] : 0;
    if (s > top * 0.93 && this.gear < GEARS.length) this.gear++;
    else if (this.gear > 1 && s < low * 0.7) this.gear--;
    const ratio = Math.min(1.05, s / GEARS[this.gear - 1]);
    let target = IDLE + ratio * (REDLINE - IDLE);
    // wheels spinning in sand / in the air rev the engine higher
    if ((airborne || slip > 2) && throttle > 0.1) target = Math.max(target, IDLE + throttle * (REDLINE - IDLE) * 0.85);
    if (s < 1 && throttle > 0.1) target = IDLE + throttle * 3200;
    this.rpm += (target - this.rpm) * Math.min(1, dt * 7);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const firing = (this.rpm / 60) * 2; // 4-cylinder: two firings per revolution
    for (const o of this.oscs) o.osc.frequency.setTargetAtTime(firing * o.mult, t, 0.02);
    this.engineFilter.frequency.setTargetAtTime(300 + throttle * 1400 + this.rpm * 0.25, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.12 + throttle * 0.16 + (this.rpm / REDLINE) * 0.08, t, 0.05);
    this.rumbleFilter.frequency.setTargetAtTime(firing * 2, t, 0.05);
    this.rumbleGain.gain.setTargetAtTime(0.4 + throttle * 0.6, t, 0.05);

    // waves breaking: loudness swells in and out
    const near = 1 / (1 + Math.max(0, shoreDistance) / 35);
    const swell = 0.55 + 0.45 * Math.sin(time * 0.45) * Math.sin(time * 0.17 + 1);
    this.surfGain.gain.setTargetAtTime(0.5 * near * swell + 0.04, t, 0.2);
    this.hissGain.gain.setTargetAtTime(0.05 * near * swell * swell, t, 0.2);
    this.windGain.gain.setTargetAtTime(Math.min(0.35, s * s * 0.0004), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + s * 25, t, 0.1);
    this.sandGain.gain.setTargetAtTime(airborne ? 0 : Math.min(0.12, s * 0.004 + slip * 0.01), t, 0.05);
    this.splashGain.gain.setTargetAtTime(water > 0.05 ? Math.min(0.5, s * 0.04) : 0, t, 0.08);
    this.hornGain.gain.setTargetAtTime(horn ? 0.12 : 0, t, 0.02);
    this.boostGain.gain.setTargetAtTime(boost * 0.32, t, boost > 0 ? 0.03 : 0.12);
    this.boostFilter.frequency.setTargetAtTime(380 + s * 14, t, 0.1);
  }
}
