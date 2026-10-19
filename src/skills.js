// Forza-style skill chain: drifts, jumps, high speed and smashing things earn points.
// Skills done one after another raise the multiplier; crashing or stopping banks the chain.
export class Skills {
  constructor(hud) {
    this.hud = hud; // { chain, chainScore, chainMult, feed, total }
    this.total = 0;
    this.chain = 0;
    this.mult = 1;
    this.idle = 0;
    this.air = 0;
    this.drift = 0;
    this.driftPts = 0;
    this.driftQuiet = 0;
    this.speedPts = 0;
    this.lastSpeed = 0;
  }

  award(name, points) {
    points = Math.round(points);
    if (points <= 0) return;
    this.chain += points * this.mult;
    this.mult = Math.min(10, this.mult + 0.5);
    this.idle = 0;
    const el = document.createElement('div');
    el.className = 'skill';
    el.innerHTML = `<b>${name}</b> <span>+${points.toLocaleString()}</span>`;
    this.hud.feed.prepend(el);
    setTimeout(() => el.classList.add('out'), 1800);
    setTimeout(() => el.remove(), 2400);
    while (this.hud.feed.children.length > 4) this.hud.feed.lastChild.remove();
  }

  bank() {
    if (this.chain > 0) {
      this.total += this.chain;
      this.hud.total.textContent = this.total.toLocaleString();
    }
    this.chain = 0;
    this.mult = 1;
  }

  // v: the vehicle; dt seconds
  update(dt, v, { smashed = 0, crashed = false } = {}) {
    const kmh = Math.abs(v.speed) * 3.6;
    const st = v.state;

    // air time
    if (st.airborne) this.air += dt;
    else {
      if (this.air > 0.6) this.award(this.air > 2 ? 'BIG AIR' : 'AIR', this.air * 220);
      this.air = 0;
    }

    // drift: sliding sideways at speed
    const slip = Math.abs(v.slipAngle || 0);
    if (!st.airborne && slip > 0.3 && kmh > 30) {
      this.drift += dt;
      this.driftPts += slip * kmh * dt * 6;
      this.driftQuiet = 0;
    } else if (this.drift > 0) {
      this.driftQuiet += dt;
      if (this.driftQuiet > 0.5) {
        if (this.drift > 0.7) this.award(this.drift > 2.5 ? 'GREAT DRIFT' : 'DRIFT', this.driftPts);
        this.drift = 0;
        this.driftPts = 0;
      }
    }

    // speed
    if (kmh > 130 && !st.airborne) {
      this.speedPts += (kmh - 120) * dt * 3;
      if (this.speedPts > 150) {
        this.award(kmh > 155 ? 'SUPERSONIC' : 'SPEED', this.speedPts);
        this.speedPts = 0;
      }
    }

    for (let i = 0; i < smashed; i++) this.award('SMASH', 150);

    // the chain ends if you crash (sudden stop) or do nothing for a while
    if (crashed && this.chain > 0) {
      this.award('', 0);
      this.chain = Math.round(this.chain * 0.5); // a crash loses half the chain
      this.bank();
    }
    this.idle += dt;
    if (this.idle > 4 && this.drift === 0 && this.air === 0) this.bank();

    this.lastSpeed = kmh;
    const on = this.chain > 0;
    this.hud.chain.classList.toggle('on', on);
    if (on) {
      this.hud.chainScore.textContent = Math.round(this.chain).toLocaleString();
      this.hud.chainMult.textContent = 'x' + this.mult.toFixed(1);
      this.hud.chainBar.style.transform = `scaleX(${Math.max(0, 1 - this.idle / 4)})`;
    }
  }
}
