// Tire tracks in the sand, sand dust, roost and water splashes.
import * as THREE from 'three';
import { getHeight, getNormal } from './terrain.js';
import { swashAt } from './ocean.js';

// Tread imprint: dark rut edges and cross bars from the knobs/paddles
function createTreadTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#6a6a6a');
  grad.addColorStop(0.12, '#9a9a9a');
  grad.addColorStop(0.5, '#d8d8d8');
  grad.addColorStop(0.88, '#9a9a9a');
  grad.addColorStop(1, '#6a6a6a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(40,40,40,0.55)';
  for (let y = 0; y < 64; y += 16) ctx.fillRect(6, y, 52, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
export class TireTracks {
  constructor(scene, wheelCount = 4, maxSegments = 2400) {
    this.max = maxSegments;
    this.wheels = Array.from({ length: wheelCount }, () => ({ has: false, x: 0, z: 0, v: 0, l: new THREE.Vector3(), r: new THREE.Vector3(), next: 0 }));
    const quads = wheelCount * maxSegments;
    this.positions = new Float32Array(quads * 4 * 3);
    this.normals = new Float32Array(quads * 4 * 3);
    this.colors = new Float32Array(quads * 4 * 4);
    this.uvs = new Float32Array(quads * 4 * 2);
    this.birth = new Float32Array(quads).fill(-1e9);
    this.washable = new Uint8Array(quads);
    const index = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setAttribute('color', this.colAttr);
    this.uvAttr = new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('uv', this.uvAttr);
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: createTreadTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.fadeTimer = 0;
    this.time = 0;
    this.n = new THREE.Vector3();
  }

  // Called each frame per wheel with its contact point and the buggy's right-hand direction
  add(i, contact, p, right, width) {
    const w = this.wheels[i];
    const ground = getHeight(p.x, p.z);
    // no tracks in the air, on rocks or ramps, or in deep water
    if (!contact || Math.abs(p.y - ground) > 0.2 || ground < -0.6) {
      w.has = false;
      return;
    }
    const y = ground + 0.02;
    const half = width * 0.5;
    if (!w.has) {
      w.l.set(p.x + right.x * half, y, p.z + right.z * half);
      w.r.set(p.x - right.x * half, y, p.z - right.z * half);
      w.x = p.x;
      w.z = p.z;
      w.has = true;
      return;
    }
    if (Math.hypot(p.x - w.x, p.z - w.z) < 0.3) return;

    const q = i * this.max + w.next;
    w.next = (w.next + 1) % this.max;
    const L = new THREE.Vector3(p.x + right.x * half, y, p.z + right.z * half);
    const R = new THREE.Vector3(p.x - right.x * half, y, p.z - right.z * half);
    const verts = [w.l, w.r, L, R];
    const v0 = w.v;
    w.v += Math.hypot(p.x - w.x, p.z - w.z) / 0.5;
    const uv = [0, v0, 1, v0, 0, w.v, 1, w.v];
    this.uvs.set(uv, q * 8);
    this.uvAttr.needsUpdate = true;
    getNormal(p.x, p.z, this.n);
    for (let k = 0; k < 4; k++) {
      const o = (q * 4 + k) * 3;
      this.positions[o] = verts[k].x;
      this.positions[o + 1] = verts[k].y;
      this.positions[o + 2] = verts[k].z;
      this.normals[o] = this.n.x;
      this.normals[o + 1] = this.n.y;
      this.normals[o + 2] = this.n.z;
    }
    this.birth[q] = this.time;
    this.washable[q] = ground < 0.5 ? 1 : 0;
    this.setColor(q, 1);
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    w.l.copy(L);
    w.r.copy(R);
    w.x = p.x;
    w.z = p.z;
  }

  setColor(q, strength) {
    for (let k = 0; k < 4; k++) {
      const o = (q * 4 + k) * 4;
      this.colors[o] = 0.4;
      this.colors[o + 1] = 0.32;
      this.colors[o + 2] = 0.23;
      this.colors[o + 3] = 0.7 * strength;
    }
  }

  update(dt) {
    this.time += dt;
    this.fadeTimer += dt;
    if (this.fadeTimer < 0.5) return;
    this.fadeTimer = 0;
    // tracks slowly fade; near the water the waves wash them away much faster
    for (let q = 0; q < this.birth.length; q++) {
      const age = this.time - this.birth[q];
      if (age > 1e8) continue;
      const life = this.washable[q] ? 25 : 240;
      const s = Math.max(0, 1 - age / life);
      this.setColor(q, s);
      if (s === 0) this.birth[q] = -1e9;
    }
    this.colAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
const particleVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uScale / -mvPosition.z;
    vAlpha = aAlpha;
    vColor = aColor;
    #include <fog_vertex>
  }
`;
const particleFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uLight;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r = dot(c, c);
    if (r > 1.0) discard;
    float a = vAlpha * (1.0 - r) * (1.0 - r);
    // a fake "lit from above" shading on each puff
    float shade = 0.8 + 0.25 * (-c.y);
    gl_FragColor = vec4(vColor * uLight * shade, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class Particles {
  constructor(scene, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.startAlpha = new Float32Array(max);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aColor', this.colorAttr);
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 }, uLight: { value: 1.6 } }]),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.material = material;
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, { size = 0.5, grow = 1, life = 1.5, alpha = 0.4, color = [0.8, 0.7, 0.55], gravity = 0.5, drag = 1.5 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = life;
    this.age[i] = 0;
    this.alpha[i] = alpha;
    this.startAlpha[i] = alpha;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.color[i * 3] = color[0];
    this.color[i * 3 + 1] = color[1];
    this.color[i * 3 + 2] = color[2];
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - 9.81 * this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // stop at the ground
      const g = getHeight(this.pos[i * 3], this.pos[i * 3 + 2]) + 0.05;
      if (this.pos[i * 3 + 1] < g) {
        this.pos[i * 3 + 1] = g;
        this.vel[i * 3 + 1] = 0;
      }
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.startAlpha[i] * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  setViewport(heightPx, fov) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }
}

// ---------------------------------------------------------------------------
// Decide which particles each wheel kicks up
const tmpF = new THREE.Vector3();
export function emitWheelEffects(particles, vehicle, forward, dt, time) {
  const st = vehicle.state;
  const speed = Math.abs(vehicle.speed);
  const vel = vehicle.body.linvel();
  for (let i = 0; i < 4; i++) {
    if (!st.contact[i]) continue;
    const p = st.contactPoint[i];
    const ground = getHeight(p.x, p.z);
    if (Math.abs(p.y - ground) > 0.25) continue; // on a rock or ramp
    const water = swashAt(p.x, time) - ground;
    const rear = i >= 2;
    if (water > 0.03) {
      // splashes
      const rate = Math.min(speed, 20) * (rear ? 5 : 3) * dt * Math.min(1, water * 4);
      for (let k = 0; k < rate * 2; k++) {
        tmpF.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        particles.emit(
          p.x, ground + water, p.z,
          vel.x * 0.5 + tmpF.x * 3, 1.5 + Math.random() * 3 + speed * 0.12, vel.z * 0.5 + tmpF.z * 3,
          { size: 0.03 + Math.random() * 0.06, grow: 0.12, life: 0.45 + Math.random() * 0.45, alpha: 0.7, color: [1.4, 1.45, 1.5], gravity: 1, drag: 0.6 }
        );
      }
      continue;
    }
    const dry = ground > 0.6;
    const slip = st.slip[i];
    // fine dust clouds
    let rate = (speed * 0.5 + slip * 2.5) * dt * (dry ? 1 : 0.35);
    if (Math.random() < rate - Math.floor(rate)) rate += 1;
    for (let k = 0; k < Math.floor(rate); k++) {
      particles.emit(
        p.x + (Math.random() - 0.5) * 0.3, p.y + 0.1, p.z + (Math.random() - 0.5) * 0.3,
        vel.x * 0.3 + (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 1.2, vel.z * 0.3 + (Math.random() - 0.5) * 1.5,
        { size: 0.5 + Math.random() * 0.5, grow: 1.8, life: 1.6 + Math.random() * 1.5, alpha: dry ? 0.22 : 0.12, color: [0.86, 0.76, 0.6], gravity: -0.02, drag: 1.2 }
      );
    }
    // paddle tires throw a rooster tail of sand when spinning
    if (rear && slip > 1.5) {
      const n = Math.min(6, slip * 0.8);
      for (let k = 0; k < n; k++) {
        particles.emit(
          p.x, p.y + 0.15, p.z,
          -forward.x * (3 + Math.random() * 4) + vel.x * 0.4 + (Math.random() - 0.5), 2 + Math.random() * 3, -forward.z * (3 + Math.random() * 4) + vel.z * 0.4 + (Math.random() - 0.5),
          { size: 0.08 + Math.random() * 0.1, grow: 0.15, life: 0.7 + Math.random() * 0.4, alpha: 0.9, color: dry ? [0.82, 0.71, 0.54] : [0.5, 0.43, 0.34], gravity: 1, drag: 0.4 }
        );
      }
    }
  }
}
