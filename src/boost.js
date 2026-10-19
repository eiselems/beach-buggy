// Rocket League style boost: a meter that fills up from pads on the ground and
// pushes the buggy forward (even in the air) while you hold the boost button.
import * as THREE from 'three';

export const BOOST = {
  start: 33,          // meter at the start (0-100)
  use: 33.3,          // per second while boosting
  accel: 14,          // m/s² of extra push
  maxSpeed: 46,       // m/s (~165 km/h): boost can take you past the engine's top speed
  small: { amount: 12, respawn: 4, radius: 2.4 },
  big: { amount: 100, respawn: 10, radius: 3.2 },
};

// ---------------------------------------------------------------------------
// Pads
function padMaterials() {
  const glow = (color, intensity) => new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
  return {
    base: new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.55, metalness: 0.6 }),
    ring: glow(0xff8a1e, 3),
    ringOff: glow(0x552a10, 0.6),
    orb: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.7, 0.4) }),
    beam: new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          float fade = pow(1.0 - vUv.y, 2.0);
          float bands = 0.65 + 0.35 * sin(vUv.y * 30.0 - uTime * 6.0);
          gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * fade * bands * 0.7, 1.0);
        }`,
    }),
  };
}

export class BoostSystem {
  constructor(scene, getHeight) {
    this.scene = scene;
    this.getHeight = getHeight;
    this.amount = BOOST.start;
    this.active = false;
    this.tiles = new Map(); // tile key -> pads
    this.mat = padMaterials();
    this.geo = {
      smallBase: new THREE.CylinderGeometry(1.3, 1.5, 0.12, 24),
      smallRing: new THREE.TorusGeometry(1.0, 0.09, 8, 32).rotateX(Math.PI / 2),
      bigBase: new THREE.CylinderGeometry(2.2, 2.6, 0.35, 32),
      bigRing: new THREE.TorusGeometry(1.8, 0.14, 8, 40).rotateX(Math.PI / 2),
      orb: new THREE.IcosahedronGeometry(0.55, 2),
      beam: new THREE.CylinderGeometry(1.2, 1.6, 9, 24, 1, true).translate(0, 4.5, 0),
    };
    this.time = 0;
    this.pickups = [];  // recent pickups, for the HUD/sound
  }

  // pads: Float32Array of [x, y, z, big] from the world worker
  addTile(key, pads) {
    const list = [];
    for (let i = 0; i < pads.length; i += 4) {
      const big = pads[i + 3] > 0.5;
      const g = new THREE.Group();
      g.position.set(pads[i], pads[i + 1], pads[i + 2]);
      const base = new THREE.Mesh(big ? this.geo.bigBase : this.geo.smallBase, this.mat.base);
      base.receiveShadow = true;
      const ring = new THREE.Mesh(big ? this.geo.bigRing : this.geo.smallRing, this.mat.ring);
      ring.position.y = big ? 0.2 : 0.08;
      g.add(base, ring);
      let orb = null, beam = null;
      if (big) {
        orb = new THREE.Mesh(this.geo.orb, this.mat.orb);
        orb.position.y = 1.4;
        beam = new THREE.Mesh(this.geo.beam, this.mat.beam);
        g.add(orb, beam);
      }
      this.scene.add(g);
      list.push({ group: g, ring, orb, beam, big, cfg: big ? BOOST.big : BOOST.small, wait: 0 });
    }
    this.tiles.set(key, list);
  }

  removeTile(key) {
    for (const p of this.tiles.get(key) || []) this.scene.remove(p.group);
    this.tiles.delete(key);
  }

  // Called every frame. Returns how hard the boost is pushing (0 or 1).
  update(dt, wantBoost, carPos) {
    this.time += dt;
    this.mat.beam.uniforms.uTime.value = this.time;
    for (const list of this.tiles.values()) {
      for (const p of list) {
        if (p.wait > 0) {
          p.wait -= dt;
          if (p.wait <= 0) this.setLit(p, true);
          continue;
        }
        if (p.orb) {
          p.orb.position.y = 1.4 + Math.sin(this.time * 2 + p.group.position.x) * 0.15;
          p.orb.rotation.y += dt * 1.5;
        }
        const g = p.group.position;
        if (Math.abs(carPos.y - g.y) < 3 && Math.hypot(carPos.x - g.x, carPos.z - g.z) < p.cfg.radius && this.amount < 100) {
          this.amount = Math.min(100, this.amount + p.cfg.amount);
          p.wait = p.cfg.respawn;
          this.setLit(p, false);
          this.pickups.push(p.big);
        }
      }
    }
    this.active = wantBoost && this.amount > 0;
    if (this.active) this.amount = Math.max(0, this.amount - BOOST.use * dt);
    return this.active ? 1 : 0;
  }

  setLit(p, on) {
    p.ring.material = on ? this.mat.ring : this.mat.ringOff;
    if (p.orb) p.orb.visible = on;
    if (p.beam) p.beam.visible = on;
  }
}

// ---------------------------------------------------------------------------
// Exhaust flames on the buggy's pipes
const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const flameFragment = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    // along: 1 at the pipe, 0 at the tip
    float along = 1.0 - vUv.y;
    float flick = 0.75 + 0.25 * hash(vec2(floor(uTime * 40.0), vUv.x * 3.0));
    float core = pow(along, 1.5);
    vec3 hot = vec3(1.0, 0.95, 0.8) * 6.0;
    vec3 mid = vec3(1.0, 0.45, 0.08) * 4.0;
    vec3 cool = vec3(0.6, 0.15, 0.6) * 1.5;
    vec3 col = mix(cool, mix(mid, hot, smoothstep(0.7, 1.0, along)), smoothstep(0.0, 0.6, along));
    float a = core * flick * uPower;
    gl_FragColor = vec4(col * a, 1.0);
  }
`;

export class ExhaustFlames {
  // pipes: positions (in the buggy's frame) of the pipe ends
  constructor(parent, pipes) {
    this.uniforms = { uTime: { value: 0 }, uPower: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // a cone pointing backwards (-Z), base at the pipe
    const geo = new THREE.ConeGeometry(0.11, 1, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    this.flames = pipes.map((p) => {
      const outer = new THREE.Mesh(geo, mat);
      outer.position.copy(p);
      outer.rotation.x = -0.35; // pipes point a little upwards
      const inner = new THREE.Mesh(geo, mat);
      inner.scale.set(0.55, 0.55, 0.6);
      outer.add(inner);
      outer.visible = false;
      parent.add(outer);
      return outer;
    });
    this.light = new THREE.PointLight(0xff7a26, 0, 8, 2);
    this.light.position.copy(pipes[0]).add(new THREE.Vector3(0, 0.2, -0.6));
    parent.add(this.light);
    this.power = 0;
  }

  update(dt, boosting, time) {
    this.power += ((boosting ? 1 : 0) - this.power) * Math.min(1, dt * (boosting ? 18 : 10));
    this.uniforms.uTime.value = time;
    this.uniforms.uPower.value = this.power;
    const len = 0.6 + 1.6 * this.power * (0.85 + 0.15 * Math.sin(time * 60));
    for (const f of this.flames) {
      f.visible = this.power > 0.02;
      f.scale.set(0.8 + this.power * 0.6, 0.8 + this.power * 0.6, len);
    }
    this.light.intensity = this.power * 30 * (0.8 + 0.2 * Math.random());
  }
}
