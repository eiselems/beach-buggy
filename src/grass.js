// Dense grass blades near the camera on the grassy hills (the far-away hills use the ground texture).
// The area around the camera is split into 16 m squares; each square gets its tufts once,
// and all visible tufts are drawn with one instanced mesh.
import * as THREE from 'three';
import { getHeight } from './terrain.js';
import { shoreZ, trackAt } from './heightfield.js';
import { mulberry32 } from './noise.js';

const CELL = 16;

// one tuft: a few thin, bent blades, darker at the root
function tuftGeometry() {
  const pos = [], col = [];
  const rnd = mulberry32(7);
  for (let b = 0; b < 12; b++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.3;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.18 + rnd() * 0.3, w = 0.018 + rnd() * 0.012;
    const lean = (rnd() - 0.3) * 0.25, dir = rnd() * Math.PI;
    const dx = Math.cos(dir) * w, dz = Math.sin(dir) * w;
    const tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
    pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, tx, h, tz);
    col.push(0.35, 0.4, 0.2, 0.35, 0.4, 0.2, 1.0, 1.0, 0.75);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

export class GrassField {
  constructor(scene, quality, wind) {
    this.radius = quality.grassBladeDistance;
    this.max = quality.grassBlades;
    this.cells = new Map();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
    material.color.setRGB(0.62, 0.68, 0.36);
    // sway in the wind (tips only)
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 seed = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          float sway = sin(uWind * 2.1 + seed.x * 0.3 + seed.y * 0.2) * 0.12 + sin(uWind * 3.7 + seed.y) * 0.04;
          transformed.x += sway * position.y;
          transformed.z += sway * 0.6 * position.y;`
        );
    };
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, this.max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.center = new THREE.Vector2(1e9, 1e9);
  }

  // where and how much grass grows: on the grassy hills inland, never on the track or steep slopes
  density(x, z) {
    const u = shoreZ(x) - z;
    if (u < 170) return 0;
    const e = 1.5;
    const sx = getHeight(x + e, z) - getHeight(x - e, z), sz = getHeight(x, z + e) - getHeight(x, z - e);
    const slope = Math.hypot(sx, sz) / (2 * e);
    if (slope > 0.55) return 0;
    return Math.min(1, (u - 170) / 120) * (1 - trackAt(x, z, 1)) * (1 - slope * 1.5);
  }

  buildCell(i, j) {
    const rnd = mulberry32((i * 92821) ^ (j * 68917) ^ 0x2f6b);
    const list = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < 360; k++) {
      const x = (i + rnd()) * CELL, z = (j + rnd()) * CELL;
      const d = this.density(x, z);
      if (rnd() > d) continue;
      const sc = 0.8 + rnd() * 0.9;
      m.compose(p.set(x, getHeight(x, z) - 0.03, z), q.setFromAxisAngle(Y, rnd() * Math.PI * 2), s.set(sc, sc * (0.7 + rnd() * 0.6), sc));
      list.push(m.clone());
    }
    return list;
  }

  update(cameraPosition) {
    const ci = Math.floor(cameraPosition.x / CELL), cj = Math.floor(cameraPosition.z / CELL);
    if (ci === this.center.x && cj === this.center.y) return;
    this.center.set(ci, cj);
    const r = Math.ceil(this.radius / CELL);
    const keep = new Set();
    let n = 0;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
        const key = i + ',' + j;
        keep.add(key);
        if (!this.cells.has(key)) this.cells.set(key, this.buildCell(i, j));
        for (const mat of this.cells.get(key)) {
          if (n >= this.max) break;
          this.mesh.setMatrixAt(n++, mat);
        }
      }
    }
    for (const key of this.cells.keys()) if (!keep.has(key)) this.cells.delete(key);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
