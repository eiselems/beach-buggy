// A round minimap in the corner (like Forza's): sea, beach, the dirt track, boost pads,
// speed traps and lighthouses. It turns with the buggy, so "up" is always where you're heading.
import { shoreZ, trackU, headlandAt } from './heightfield.js';

export class Minimap {
  constructor(el, props, boost) {
    this.canvas = el;
    this.ctx = el.getContext('2d');
    this.props = props;
    this.boost = boost;
    this.timer = 0;
    this.scale = 0.28; // pixels per meter
  }

  update(dt, pos, heading) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    const ctx = this.ctx, W = this.canvas.width, R = W / 2, s = this.scale;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    // land
    ctx.fillStyle = '#c9b48a';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(R, R);
    const reach = R / s + 40;
    // turn the world so the buggy's heading points up (forward = (sin h, cos h), left = (cos h, -sin h))
    const sh = Math.sin(heading), ch = Math.cos(heading);
    const toMap = (x, z) => {
      const dx = x - pos.x, dz = z - pos.z;
      return [-(dx * ch - dz * sh) * s, -(dx * sh + dz * ch) * s];
    };

    // sea: polygon from the coastline out towards +Z
    ctx.fillStyle = '#3f8fb5';
    ctx.beginPath();
    let first = true;
    for (let x = pos.x - reach; x <= pos.x + reach; x += 8) {
      const [mx, mz] = toMap(x, shoreZ(x));
      if (first) ctx.moveTo(mx, mz);
      else ctx.lineTo(mx, mz);
      first = false;
    }
    ctx.lineTo(...toMap(pos.x + reach, pos.z + reach * 3));
    ctx.lineTo(...toMap(pos.x - reach, pos.z + reach * 3));
    ctx.fill();
    // inland hills get greener
    ctx.fillStyle = 'rgba(110, 130, 70, 0.55)';
    ctx.beginPath();
    first = true;
    for (let x = pos.x - reach; x <= pos.x + reach; x += 8) {
      const [mx, mz] = toMap(x, shoreZ(x) - 240);
      if (first) ctx.moveTo(mx, mz);
      else ctx.lineTo(mx, mz);
      first = false;
    }
    ctx.lineTo(...toMap(pos.x + reach, pos.z - reach * 3));
    ctx.lineTo(...toMap(pos.x - reach, pos.z - reach * 3));
    ctx.fill();
    // the track
    ctx.strokeStyle = '#7a5a3a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    first = true;
    for (let x = pos.x - reach; x <= pos.x + reach; x += 8) {
      const [mx, mz] = toMap(x, shoreZ(x) - trackU(x));
      if (headlandAt(x) > 0.3 || first) ctx.moveTo(mx, mz);
      else ctx.lineTo(mx, mz);
      first = false;
    }
    ctx.stroke();

    // markers
    const dot = (x, z, r, color) => {
      const [mx, mz] = toMap(x, z);
      if (mx * mx + mz * mz > R * R) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, mz, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const list of this.boost.tiles.values()) {
      for (const p of list) if (p.wait <= 0) dot(p.group.position.x, p.group.position.z, p.big ? 3.5 : 2, '#ff8a1e');
    }
    for (const t of this.props.tiles.values()) {
      for (const tr of t.traps || []) dot(tr.x, tr.z, 5, '#e8412c');
      for (const lh of t.lighthouses || []) dot(lh.position.x, lh.position.z, 5, '#ffffff');
    }
    ctx.restore();

    // the buggy: an arrow in the middle, pointing up
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(R, R - 8);
    ctx.lineTo(R + 6, R + 6);
    ctx.lineTo(R, R + 3);
    ctx.lineTo(R - 6, R + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
