// The endless ground: built around the player while you drive.
//  - The visible ground is a quadtree of patches: small detailed ones nearby, big coarse ones far away.
//  - The physics ground is a ring of 128 m tiles around the buggy.
// The shape itself lives in heightfield.js; the slow work happens in web workers (worldWorker.js).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { terrainFunction, shoreZ } from './heightfield.js';
import { createSandDetailTexture } from './textures.js';

export { shoreZ, terrainFunction };

// ---------------------------------------------------------------------------
// A few workers that build the world in the background, nearest pieces first
export class WorkerPool {
  constructor(count) {
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const { resolve } = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        this.idle.push(w);
        resolve(e.data);
        this.pump();
      };
      this.idle.push(w);
    }
  }

  // priority: lower runs sooner. stillWanted(): checked right before the job starts
  run(job, priority = 0, stillWanted = () => true) {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, priority, stillWanted, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.idle.length && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].priority < this.queue[best].priority) best = i;
      const task = this.queue.splice(best, 1)[0];
      if (!task.stillWanted()) {
        task.reject(new Error('cancelled'));
        continue;
      }
      const w = this.idle.pop();
      const id = this.nextId++;
      this.pending.set(id, task);
      w.postMessage({ ...task.job, id });
    }
  }

  get busy() {
    return this.queue.length + this.pending.size;
  }
}

// ---------------------------------------------------------------------------
// Physics ground: 128 m tiles with a point every 2 m, kept around the buggy
const PHYS = { size: 128, cells: 64, keep: 260, drop: 420 };
const physTiles = new Map(); // "i,j" -> { heights, collider, pending, i, j }
const PN = PHYS.cells + 1, PSTEP = PHYS.size / PHYS.cells;
let physIndices = null;

function physIndexBuffer() {
  if (physIndices) return physIndices;
  physIndices = new Uint32Array(PHYS.cells * PHYS.cells * 6);
  let p = 0;
  for (let j = 0; j < PHYS.cells; j++) {
    for (let i = 0; i < PHYS.cells; i++) {
      const a = j * PN + i, b = a + 1, c = a + PN, d = c + 1;
      physIndices.set([a, c, b, b, c, d], p);
      p += 6;
    }
  }
  return physIndices;
}

// Ground height at any (x, z). Near the buggy this matches the physics triangles exactly.
export function getHeight(x, z) {
  const i = Math.floor(x / PHYS.size), j = Math.floor(z / PHYS.size);
  const t = physTiles.get(i + ',' + j);
  if (!t || !t.heights) return terrainFunction(x, z);
  const fx = (x - i * PHYS.size) / PSTEP, fz = (z - j * PHYS.size) / PSTEP;
  const ci = Math.min(PHYS.cells - 1, Math.floor(fx)), cj = Math.min(PHYS.cells - 1, Math.floor(fz));
  const tx = fx - ci, tz = fz - cj;
  const h = t.heights;
  const a = h[cj * PN + ci], b = h[cj * PN + ci + 1], c = h[(cj + 1) * PN + ci], d = h[(cj + 1) * PN + ci + 1];
  // same two triangles per cell as the physics mesh: (a, c, b) and (b, c, d)
  if (tx + tz < 1) return a + (b - a) * tx + (c - a) * tz;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

export function getNormal(x, z, target = new THREE.Vector3()) {
  const e = 1;
  return target.set(getHeight(x - e, z) - getHeight(x + e, z), 2 * e, getHeight(x, z - e) - getHeight(x, z + e)).normalize();
}

export class PhysicsTerrain {
  constructor(world, pool) {
    this.world = world;
    this.pool = pool;
  }

  wanted(i, j, points) {
    const cx = (i + 0.5) * PHYS.size, cz = (j + 0.5) * PHYS.size;
    let best = Infinity;
    for (const p of points) best = Math.min(best, Math.hypot(cx - p.x, cz - p.z));
    return best;
  }

  // points: places that need solid ground (the buggy now, and where it will be soon)
  update(points) {
    const r = PHYS.keep + PHYS.size;
    for (const p of points) {
      for (let i = Math.floor((p.x - r) / PHYS.size); i <= Math.floor((p.x + r) / PHYS.size); i++) {
        for (let j = Math.floor((p.z - r) / PHYS.size); j <= Math.floor((p.z + r) / PHYS.size); j++) {
          const key = i + ',' + j;
          if (physTiles.has(key)) continue;
          const dist = this.wanted(i, j, points);
          if (dist > PHYS.keep) continue;
          const tile = { i, j, heights: null, collider: null, pending: true };
          physTiles.set(key, tile);
          this.pool
            .run({ type: 'phys', x0: i * PHYS.size, z0: j * PHYS.size, size: PHYS.size, cells: PHYS.cells }, dist - 1e5, () => physTiles.get(key) === tile)
            .then((res) => {
              tile.pending = false;
              tile.heights = res.heights;
            })
            .catch(() => {});
        }
      }
    }
    for (const [key, t] of physTiles) {
      const dist = this.wanted(t.i, t.j, points);
      if (dist > PHYS.drop) {
        if (t.collider) this.world.removeCollider(t.collider, false);
        physTiles.delete(key);
      } else if (t.heights && !t.collider && dist <= PHYS.keep + 60) {
        this.addCollider(t);
      }
    }
  }

  addCollider(t) {
    const v = new Float32Array(PN * PN * 3);
    for (let j = 0; j < PN; j++) {
      for (let i = 0; i < PN; i++) {
        const k = j * PN + i;
        v[k * 3] = i * PSTEP;
        v[k * 3 + 1] = t.heights[k];
        v[k * 3 + 2] = j * PSTEP;
      }
    }
    const desc = RAPIER.ColliderDesc.trimesh(v, physIndexBuffer(), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setTranslation(t.i * PHYS.size, 0, t.j * PHYS.size)
      .setFriction(0.8);
    t.collider = this.world.createCollider(desc);
  }

  // true when every tile near these points has its collider
  readyAt(points) {
    for (const p of points) {
      for (const [dx, dz] of [[0, 0], [-40, 0], [40, 0], [0, -40], [0, 40]]) {
        const t = physTiles.get(Math.floor((p.x + dx) / PHYS.size) + ',' + Math.floor((p.z + dz) / PHYS.size));
        if (!t || !t.collider) return false;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Visible ground: a quadtree of patches, each a grid of `cells` x `cells` squares
const ROOT = 4096;
const indexCache = new Map();
function leafIndex(cells) {
  if (indexCache.has(cells)) return indexCache.get(cells);
  const n = cells + 1;
  const idx = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const edges = [(t) => t, (t) => (n - 1) * n + t, (t) => t * n, (t) => t * n + n - 1];
  edges.forEach((edge, e) => {
    for (let t = 0; t < cells; t++) {
      const a = edge(t), b = edge(t + 1), c = n * n + e * n + t, d = c + 1;
      // both windings, so the skirt shows from either side
      idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  });
  const attr = new THREE.BufferAttribute(new Uint32Array(idx), 1);
  indexCache.set(cells, attr);
  return attr;
}

export class TerrainLOD {
  constructor(scene, material, pool, quality) {
    this.scene = scene;
    this.material = material;
    this.pool = pool;
    this.cells = quality.terrainCells;      // squares per patch side
    this.minSize = quality.terrainMinPatch; // smallest patch (m)
    this.split = quality.terrainSplit;      // bigger = more detail further away
    this.viewDist = quality.viewDistance;
    this.leaves = new Map(); // key -> { x0, z0, size, mesh, pending, lastUsed }
    this.shown = new Set();
    this.desired = new Map();
    this.frame = 0;
    this.lastFocus = new THREE.Vector3(1e9, 0, 0);
  }

  key(x0, z0, size) {
    return size + ':' + x0 + ',' + z0;
  }

  computeDesired(f) {
    const out = new Map();
    const visit = (x0, z0, size) => {
      const dx = Math.max(0, Math.abs(f.x - (x0 + size / 2)) - size / 2);
      const dz = Math.max(0, Math.abs(f.z - (z0 + size / 2)) - size / 2);
      const dist = Math.hypot(dx, dz, Math.max(0, f.y - 60) * 0.5);
      if (dist > this.viewDist) return;
      if (size > this.minSize && dist < size * this.split) {
        const h = size / 2;
        visit(x0, z0, h);
        visit(x0 + h, z0, h);
        visit(x0, z0 + h, h);
        visit(x0 + h, z0 + h, h);
      } else {
        out.set(this.key(x0, z0, size), { x0, z0, size, dist });
      }
    };
    const r = this.viewDist;
    for (let i = Math.floor((f.x - r) / ROOT); i <= Math.floor((f.x + r) / ROOT); i++) {
      for (let j = Math.floor((f.z - r) / ROOT); j <= Math.floor((f.z + r) / ROOT); j++) visit(i * ROOT, j * ROOT, ROOT);
    }
    return out;
  }

  request(key, d) {
    let leaf = this.leaves.get(key);
    if (!leaf) {
      leaf = { ...d, mesh: null, pending: false };
      this.leaves.set(key, leaf);
    }
    leaf.lastUsed = this.frame;
    if (leaf.mesh || leaf.pending) return leaf;
    leaf.pending = true;
    this.pool
      .run({ type: 'leaf', x0: d.x0, z0: d.z0, size: d.size, cells: this.cells }, d.dist, () => this.desired.has(key))
      .then((res) => {
        leaf.pending = false;
        leaf.mesh = this.buildMesh(leaf, res);
      })
      .catch(() => (leaf.pending = false));
    return leaf;
  }

  buildMesh(leaf, res) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(res.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(res.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(res.color, 3));
    geo.setAttribute('surface', new THREE.BufferAttribute(res.surface, 2));
    geo.setAttribute('uv', new THREE.BufferAttribute(res.uv, 2));
    geo.setIndex(leafIndex(this.cells));
    const s = leaf.size;
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(s / 2, (res.minY + res.maxY) / 2, s / 2),
      Math.hypot(s * 0.7072, (res.maxY - res.minY) / 2)
    );
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(leaf.x0, 0, leaf.z0);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  contains(a, b) {
    return b.x0 >= a.x0 && b.z0 >= a.z0 && b.x0 + b.size <= a.x0 + a.size && b.z0 + b.size <= a.z0 + a.size;
  }

  update(focus, force = false) {
    this.frame++;
    if (!force && this.frame % 6 !== 0 && focus.distanceToSquared(this.lastFocus) < 64) return;
    this.lastFocus.copy(focus);
    this.desired = this.computeDesired(focus);
    for (const [key, d] of this.desired) this.request(key, d);

    // Swap patches without leaving holes: an old patch stays until everything that replaces it is ready
    const desiredList = [...this.desired.entries()];
    const ready = (k) => !!this.leaves.get(k)?.mesh;
    const removable = new Map();
    for (const key of this.shown) {
      if (this.desired.has(key)) continue;
      const old = this.leaves.get(key);
      let ok = true;
      for (const [dk, d] of desiredList) {
        if ((this.contains(d, old) || this.contains(old, d)) && !ready(dk)) {
          ok = false;
          break;
        }
      }
      removable.set(key, ok);
    }
    for (const [dk, d] of desiredList) {
      if (this.shown.has(dk) || !ready(dk)) continue;
      let blocked = false;
      for (const [ok, can] of removable) {
        const old = this.leaves.get(ok);
        if (!can && (this.contains(d, old) || this.contains(old, d))) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      this.scene.add(this.leaves.get(dk).mesh);
      this.shown.add(dk);
    }
    for (const [key, can] of removable) {
      if (!can) continue;
      this.scene.remove(this.leaves.get(key).mesh);
      this.shown.delete(key);
    }

    // forget patches we haven't needed for a while
    if (this.leaves.size > this.desired.size + 160) {
      const spare = [...this.leaves.entries()]
        .filter(([k, l]) => !this.shown.has(k) && !this.desired.has(k) && !l.pending)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [k, l] of spare.slice(0, this.leaves.size - this.desired.size - 120)) {
        l.mesh?.geometry.dispose();
        this.leaves.delete(k);
      }
    }
  }

  // fraction of the wanted patches that are on screen
  progress() {
    let n = 0;
    for (const k of this.desired.keys()) if (this.shown.has(k)) n++;
    return this.desired.size ? n / this.desired.size : 0;
  }
}

// ---------------------------------------------------------------------------
// Sand made from photo-scanned textures. Each texture is sampled twice at different
// sizes and angles and blended with large, slow noise so you can't see it repeat.
export function createSandMaterial(sand, detail) {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: createSandDetailTexture(), // only used for large-scale noise below
    normalMap: sand.dryN,           // enables the tangent-space normal code path
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.95,
    metalness: 0,
  });
  const uniforms = {
    tDryD: { value: sand.dryD }, tDryR: { value: sand.dryR },
    tAltD: { value: sand.altD }, tAltN: { value: sand.altN },
    tWetD: { value: sand.wetD }, tWetN: { value: sand.wetN },
    uDryAvg: { value: sand.dryAvg }, uAltAvg: { value: sand.altAvg }, uWetAvg: { value: sand.wetAvg },
  };
  // the extra texture layers that hide tiling are skipped on low quality
  if (detail) material.defines = { SAND_DETAIL: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 surface;\nvarying vec2 vSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = surface;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vSurface;
        uniform sampler2D tDryD, tDryR, tAltD, tAltN, tWetD, tWetN;
        uniform vec3 uDryAvg, uAltAvg, uWetAvg;
        const mat2 ROT = mat2(0.788, -0.616, 0.616, 0.788); // ~38 degrees
        `
      )
      .replace(
        '#include <map_fragment>',
        `
        float wet = vSurface.x;
        float sandy = vSurface.y;
        vec2 uvA = vMapUv;                       // 4 m tiles
        vec2 uvB = ROT * (vMapUv * 0.43) + 0.17; // bigger, rotated copy
        vec2 uvC = vMapUv * 1.3 + 0.61;
        float macro = texture2D( map, vMapUv * 0.02 ).g;
        float macro2 = texture2D( map, vMapUv * 0.0071 + 0.5 ).g;
        float abMix = smoothstep( 0.3, 0.7, macro2 );
        float altMix = smoothstep( 0.4, 0.7, macro ) * 0.7;
        float camDist = length( vViewPosition );

        vec3 det = texture2D( tDryD, uvA ).rgb / uDryAvg;
        #ifdef SAND_DETAIL
          det = mix( det, texture2D( tDryD, uvB ).rgb / uDryAvg, abMix );
          det = mix( det, texture2D( tAltD, uvC ).rgb / uAltAvg, altMix );
        #endif
        det = mix( det, texture2D( tWetD, uvC ).rgb / uWetAvg, wet );
        // calm the detail down in the distance where it would just shimmer
        det = mix( det, vec3( 1.0 ), smoothstep( 60.0, 400.0, camDist ) * 0.6 );
        diffuseColor.rgb *= mix( vec3( 1.0 ), det, 0.25 + 0.75 * sandy );
        diffuseColor.rgb *= 0.9 + 0.2 * macro; // big soft patches
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.56, 0.53, 0.5 ), wet * sandy );
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix( 0.75 + 0.25 * texture2D( tDryR, uvA ).g, 0.3, wet * sandy );`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        vec3 mapN = texture2D( normalMap, uvA ).xyz * 2.0 - 1.0;
        #ifdef SAND_DETAIL
          vec3 nB = texture2D( normalMap, uvB ).xyz * 2.0 - 1.0;
          nB.xy = transpose( ROT ) * nB.xy;
          mapN = mix( mapN, nB, abMix );
          mapN = mix( mapN, texture2D( tAltN, uvC ).xyz * 2.0 - 1.0, altMix );
        #endif
        mapN = mix( mapN, texture2D( tWetN, uvC ).xyz * 2.0 - 1.0, wet );
        mapN.xy *= normalScale * ( 0.3 + 0.7 * sandy ) * ( 1.0 - 0.6 * smoothstep( 40.0, 300.0, camDist ) );
        normal = normalize( tbn * mapN );
        `
      );
  };
  return material;
}
