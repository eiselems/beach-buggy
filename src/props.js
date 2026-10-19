// Things on the beach: palm trees, rocks, dune grass, driftwood,
// a lifeguard tower, jump ramps and umbrellas. Solid things get physics colliders.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getHeight, shoreZ } from './terrain.js';
import { mulberry32 } from './noise.js';

const rnd = mulberry32(4242);
const range = (a, b) => a + (b - a) * rnd();
export const SPAWN = { x: 0, z: shoreZ(0) - 25 };
const nearSpawn = (x, z, r) => Math.hypot(x - SPAWN.x, z - SPAWN.z) < r;

// Wind sway shared by plants
export const wind = { value: 0 };
function addWind(material, strength, heightScale) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 seed = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        #else
          vec2 seed = vec2(0.0);
        #endif
        float bend = pow(max(position.y, 0.0) / ${heightScale.toFixed(2)}, 2.0) * ${strength.toFixed(3)};
        float gust = sin(uWindTime * 1.7 + seed.x * 0.15 + seed.y * 0.1) + 0.5 * sin(uWindTime * 3.1 + seed.y * 0.3 + position.x);
        transformed.x += gust * bend;
        transformed.z += gust * bend * 0.6;`
      );
  };
}

// ---------------------------------------------------------------------------
const woodMat = () => new THREE.MeshStandardMaterial({ color: 0x8a7560, roughness: 0.9 });

function placeDriftwood(scene, world) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9c8b78, roughness: 0.95 });
  for (let i = 0; i < 14; i++) {
    const x = range(-450, 450);
    const z = shoreZ(x) - range(12, 30);
    if (nearSpawn(x, z, 20)) continue;
    const len = range(2, 5), r = range(0.12, 0.25);
    const g = new THREE.CylinderGeometry(r * 0.7, r, len, 10, 6);
    const pp = g.attributes.position;
    for (let k = 0; k < pp.count; k++) {
      const y = pp.getY(k);
      pp.setX(k, pp.getX(k) + Math.sin(y * 1.3 + i) * 0.12);
    }
    g.computeVertexNormals();
    const log = new THREE.Mesh(g, mat);
    const yaw = rnd() * Math.PI;
    log.rotation.set(0, yaw, Math.PI / 2);
    log.position.set(x, getHeight(x, z) + r * 0.6, z);
    log.castShadow = log.receiveShadow = true;
    scene.add(log);
    smashables.push({ obj: log, radius: len / 2, home: log.position.clone(), homeRot: log.rotation.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), flying: 0 });
  }
}

function placeLifeguardTower(scene, world, x) {
  const z = shoreZ(x) - 32;
  const y = getHeight(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.7 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x2f7fc1, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8342c, roughness: 0.6 });
  const wood = woodMat();
  const add = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0) => {
    const mm = new THREE.Mesh(geo, mat);
    mm.position.set(px, py, pz);
    mm.rotation.set(rx, ry, rz);
    mm.castShadow = mm.receiveShadow = true;
    g.add(mm);
    return mm;
  };
  const deckY = 2.7;
  for (const [lx, lz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) {
    add(new THREE.BoxGeometry(0.2, deckY + 0.5, 0.2), wood, lx, (deckY - 0.5) / 2, lz);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.12, deckY / 2, 0.12).setTranslation(x + lx, y + deckY / 2, z + lz));
  }
  add(new THREE.BoxGeometry(4.2, 0.15, 4.6), wood, 0, deckY, 0.2);
  world.createCollider(RAPIER.ColliderDesc.cuboid(2.1, 0.1, 2.3).setTranslation(x, y + deckY, z + 0.2));
  // cabin
  add(new THREE.BoxGeometry(3.0, 2.0, 2.6), white, 0, deckY + 1.08, -0.3);
  add(new THREE.BoxGeometry(3.04, 0.35, 2.64), blue, 0, deckY + 0.35, -0.3);
  const win = new THREE.MeshStandardMaterial({ color: 0x1a2a33, roughness: 0.1, metalness: 0.4 });
  add(new THREE.BoxGeometry(2.4, 0.8, 0.05), win, 0, deckY + 1.4, 1.0);
  const roof = add(new THREE.ConeGeometry(2.6, 1.0, 4), red, 0, deckY + 2.55, -0.3, 0, Math.PI / 4, 0);
  roof.scale.set(1, 1, 0.95);
  // red cross sign
  add(new THREE.BoxGeometry(0.7, 0.2, 0.06), red, 0, deckY + 1.6, 1.04);
  add(new THREE.BoxGeometry(0.2, 0.7, 0.06), red, 0, deckY + 1.6, 1.04);
  // railing
  for (const lx of [-2, 2]) add(new THREE.BoxGeometry(0.08, 0.08, 4.4), white, lx, deckY + 0.9, 0.2);
  add(new THREE.BoxGeometry(4.0, 0.08, 0.08), white, 0, deckY + 0.9, 2.45);
  for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.06, 0.9, 0.06), white, -2 + i * 0.5, deckY + 0.45, 2.45);
  // ramp down to the sand
  const ramp = add(new THREE.BoxGeometry(1.2, 0.1, 5.2), wood, 0, deckY / 2, -4.3, -0.55, 0, 0);
  for (let i = 0; i < 12; i++) add(new THREE.BoxGeometry(1.2, 0.05, 0.08), wood, 0, 0.2 + i * 0.21, -6.4 + i * 0.36, -0.55);
  void ramp;
  // flag
  add(new THREE.CylinderGeometry(0.04, 0.04, 3, 8), white, 1.4, deckY + 3.2, -1.3);
  const flag = add(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: 0xd8342c, side: THREE.DoubleSide }), 1.85, deckY + 4.4, -1.3);
  void flag;
  g.rotation.y = Math.PI; // face the sea
  g.updateMatrixWorld(true);
  scene.add(g);
}

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    const v = 120 + rnd() * 50;
    ctx.fillStyle = `rgb(${v + 20},${v},${v - 30})`;
    ctx.fillRect(0, i * 32, 256, 32);
    ctx.fillStyle = 'rgba(40,25,10,0.6)';
    ctx.fillRect(0, i * 32 + 30, 256, 2);
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(60,40,20,${0.1 + rnd() * 0.15})`;
      ctx.fillRect(rnd() * 256, i * 32 + rnd() * 30, 20 + rnd() * 60, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A wooden jump ramp. `yaw` is the direction you drive to jump.
const rampGeometries = new Map();
let rampMaterial = null;
function rampGeometry(length, height, width) {
  const key = `${length},${height},${width}`;
  if (rampGeometries.has(key)) return rampGeometries.get(key);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.quadraticCurveTo(length, height * 0.6, length, height);
  shape.quadraticCurveTo(length * 0.45, height * 0.35, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 12 });
  // the shape is drawn in X/Y and extruded along Z; centre it and point it along +Z
  geo.translate(-length / 2, 0, -width / 2);
  geo.rotateY(-Math.PI / 2);
  const uvs = geo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 0.3, uvs.getY(i) * 0.3);
  const flat = new Float32Array(geo.toNonIndexed().attributes.position.array);
  const entry = { geo, flat, order: Uint32Array.from({ length: flat.length / 3 }, (_, i) => i) };
  rampGeometries.set(key, entry);
  return entry;
}

// returns the ramp mesh and a function that makes its physics collider
function makeRamp(x, z, yaw, length = 7, height = 1.5, width = 4) {
  rampMaterial ||= new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 });
  const { geo, flat, order } = rampGeometry(length, height, width);
  const ramp = new THREE.Mesh(geo, rampMaterial);
  // sit it on the lowest point of the sand under it
  let y = Infinity;
  for (const [dx, dz] of [[0, -3], [0, 3], [-2, 0], [2, 0], [0, 0]]) {
    const c = Math.cos(yaw), s2 = Math.sin(yaw);
    y = Math.min(y, getHeight(x + dx * c + dz * s2, z - dx * s2 + dz * c));
  }
  y -= 0.05;
  ramp.position.set(x, y, z);
  ramp.rotation.y = yaw;
  ramp.castShadow = ramp.receiveShadow = true;
  const q = new THREE.Quaternion().setFromEuler(ramp.rotation);
  const collider = () => RAPIER.ColliderDesc.trimesh(flat, order).setTranslation(x, y, z).setRotation(q).setFriction(0.8);
  return { mesh: ramp, collider };
}

function stripeTexture(colors) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const ctx = c.getContext('2d');
  colors.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect((i * 256) / colors.length, 0, 256 / colors.length + 1, 16);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function placeUmbrellas(scene, world) {
  const palettes = [
    ['#e8412c', '#ffffff', '#e8412c', '#ffffff', '#e8412c', '#ffffff', '#e8412c', '#ffffff'],
    ['#1e88e5', '#ffeb3b', '#1e88e5', '#ffeb3b', '#1e88e5', '#ffeb3b', '#1e88e5', '#ffeb3b'],
    ['#43a047', '#ffffff', '#43a047', '#ffffff', '#43a047', '#ffffff', '#43a047', '#ffffff'],
    ['#ff9800', '#9c27b0', '#ff9800', '#9c27b0', '#ff9800', '#9c27b0', '#ff9800', '#9c27b0'],
  ];
  const towelColors = [0xf06292, 0x4fc3f7, 0xffd54f, 0x81c784];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.6, roughness: 0.3 });
  const spots = [[-60, 20], [-48, 22], [70, 26], [150, 19], [-210, 24], [300, 22]];
  spots.forEach(([x, u], i) => {
    const z = shoreZ(x) - u;
    const y = getHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.set(range(-0.12, 0.12), rnd() * 6, range(-0.12, 0.12));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 8), poleMat);
    pole.position.y = 1.1;
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(1.25, 0.45, 16, 1, true),
      new THREE.MeshStandardMaterial({ map: stripeTexture(palettes[i % palettes.length]), side: THREE.DoubleSide, roughness: 0.8 })
    );
    canopy.position.y = 2.2;
    const towel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 1.8),
      new THREE.MeshStandardMaterial({ color: towelColors[i % towelColors.length], roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 })
    );
    towel.rotation.x = -Math.PI / 2;
    towel.position.set(0.9, 0.04, 0.4);
    for (const mm of [pole, canopy]) mm.castShadow = true;
    towel.receiveShadow = true;
    g.add(pole, canopy, towel);
    scene.add(g);
    smashables.push({ obj: g, radius: 1.3, home: g.position.clone(), homeRot: g.rotation.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), flying: 0 });
  });
}

// ---------------------------------------------------------------------------
// Smashables: light things (umbrellas) that fly away when you hit them, and come back later
const smashables = [];
let postParts = null;
function updateSmashables(dt, carPos, carVel) {
  const speed = Math.hypot(carVel.x, carVel.z);
  let hits = 0;
  for (const s of smashables) {
    const o = s.obj;
    if (s.flying > 0) {
      s.flying += dt;
      s.vel.y -= 9.81 * dt;
      o.position.addScaledVector(s.vel, dt);
      o.rotation.x += s.spin.x * dt;
      o.rotation.z += s.spin.z * dt;
      const ground = getHeight(o.position.x, o.position.z);
      if (o.position.y < ground) {
        o.position.y = ground;
        s.vel.multiplyScalar(0.3);
        s.vel.y = Math.abs(s.vel.y) * 0.3;
        s.spin.multiplyScalar(0.5);
      }
      // put it back once the player is gone
      if (s.flying > 30 && o.position.distanceTo(carPos) > 80) {
        o.position.copy(s.home);
        o.rotation.copy(s.homeRot);
        s.flying = 0;
      }
    } else if (speed > 1.5 && Math.hypot(o.position.x - carPos.x, o.position.z - carPos.z) < s.radius + 1.0) {
      s.flying = 0.001;
      s.vel.set(carVel.x * 1.1 + (Math.random() - 0.5) * 3, 3 + speed * 0.25, carVel.z * 1.1 + (Math.random() - 0.5) * 3);
      s.spin.set((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12);
      hits++;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// The endless world is cut into 256 m tiles. A worker decides what grows in each tile;
// here we turn that into instanced meshes, and add physics colliders only near the buggy.
const TILE = 256;
const COLLIDE_IN = 300, COLLIDE_OUT = 420;

export class PropSystem {
  constructor(scene, world, pool, assets, quality, boost) {
    this.scene = scene;
    this.world = world;
    this.pool = pool;
    this.assets = assets;
    this.quality = quality;
    this.boost = boost;
    this.tiles = new Map();
    this.frame = 0;

    for (const part of [...assets.palm, ...assets.palmFar]) {
      const m = part.material;
      if ((m.alphaTest > 0 || m.transparent) && !m.userData.windy) {
        // the fronds sway in the wind and get smooth cut-out edges
        m.alphaToCoverage = !quality.postProcessing; // needs MSAA, which the AO pass does not use
        m.side = THREE.DoubleSide;
        addWind(m, 0.18, 6);
        m.userData.windy = true;
      }
    }
    // dune grass: light it like the ground beneath it, so thin cards never turn dark
    const grass = assets.grass[0];
    const nrm = grass.geometry.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    grass.material.color.setRGB(1.0, 0.9, 0.7);
    grass.material.metalness = 0; // the model ships as 'metal', which glows white against the sun
    grass.material.transparent = false; // cut-out instead of blending: no sorting needed
    grass.material.depthWrite = true;
    grass.material.alphaTest = 0.35;
    grass.material.alphaToCoverage = !quality.postProcessing;
    grass.material.side = THREE.DoubleSide;
    addWind(grass.material, 0.12, 0.8);

    // hand-placed things around the start
    placeDriftwood(scene, world);
    placeLifeguardTower(scene, world, 95);
    placeLifeguardTower(scene, world, -330);
    for (const [x, u, yaw, l, h, w] of [[-70, 12, Math.PI / 2], [230, 14, -Math.PI / 2, 9, 1.6, 5], [40, 60, Math.PI, 6, 1.2, 4]]) {
      const r = makeRamp(x, shoreZ(x) - u, yaw, l, h, w);
      scene.add(r.mesh);
      world.createCollider(r.collider());
    }
    placeUmbrellas(scene, world);
  }

  // one of everything, so the GPU compiles all shaders during loading instead of mid-drive
  warmupGroup() {
    const g = new THREE.Group();
    const m = [new THREE.Matrix4()];
    const add = (list) => list.forEach((o) => g.add(o));
    add(this.instanced(this.assets.palm, m, null, true));
    add(this.instanced(this.assets.palmFar, m, null, true));
    add(this.instanced(this.assets.grass, m, [new THREE.Color(1, 1, 1)], false));
    this.assets.rocks.forEach((r) => add(this.instanced([r], m, null, true)));
    g.add(makeSpeedTrap());
    g.add(makeRamp(0, 0, 0).mesh);
    return g;
  }

  instanced(parts, matrices, colors, castShadow) {
    return parts.map(({ geometry, material }) => {
      const im = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((m, i) => {
        im.setMatrixAt(i, m);
        if (colors) im.setColorAt(i, colors[i]);
      });
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      return im;
    });
  }

  build(t, d) {
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const Y = new THREE.Vector3(0, 1, 0);
    // palms: a detailed and a simple version, swapped by distance
    t.palmMatrices = [];
    for (let i = 0; i < d.palms.length; i += 6) {
      const [x, y, z, yaw, sc, sy] = d.palms.subarray(i, i + 6);
      t.palmMatrices.push(new THREE.Matrix4().compose(p.set(x, y, z), q.setFromAxisAngle(Y, yaw), s.set(sc, sy, sc)));
    }
    if (t.palmMatrices.length) {
      t.palmNear = this.instanced(this.assets.palm, t.palmMatrices, null, true);
      t.palmFar = this.instanced(this.assets.palmFar, t.palmMatrices, null, true);
    }
    // rocks, one instanced mesh per rock model
    t.rockItems = [];
    const byVariant = [[], [], []];
    for (let i = 0; i < d.rocks.length; i += 9) {
      const [x, y, z, rx, ry, rz, size, sy, v] = d.rocks.subarray(i, i + 9);
      const m = new THREE.Matrix4().compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(size, size * sy, size));
      byVariant[v].push(m);
      t.rockItems.push({ v, pos: p.clone(), q: q.clone(), scale: s.clone() });
    }
    t.rocks = byVariant.flatMap((list, v) => (list.length ? this.instanced([this.assets.rocks[v]], list, null, true) : []));
    // ramps
    t.ramps = [];
    for (let i = 0; i < d.ramps.length; i += 6) {
      const [x, z, yaw, l, h, w] = d.ramps.subarray(i, i + 6);
      t.ramps.push(makeRamp(x, z, yaw, l, h, w));
    }
    for (const r of t.ramps) this.scene.add(r.mesh);
    for (const m of t.rocks) this.scene.add(m);
    t.grassData = d.grass;
    t.grass = null;
    t.colliders = null;
    if (this.boost) this.boost.addTile(t.key, d.pads);
    // track marker posts: white with an orange reflector
    if (d.posts.length) {
      postParts ||= [
        { geometry: new THREE.BoxGeometry(0.14, 1.1, 0.14).translate(0, 0.55, 0), material: new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.6 }) },
        { geometry: new THREE.BoxGeometry(0.16, 0.16, 0.16).translate(0, 0.95, 0), material: new THREE.MeshStandardMaterial({ color: 0x331100, emissive: 0xff7a1a, emissiveIntensity: 2.5 }) },
      ];
      const ms = [];
      for (let i = 0; i < d.posts.length; i += 3) ms.push(new THREE.Matrix4().makeTranslation(d.posts[i], d.posts[i + 1] - 0.1, d.posts[i + 2]));
      t.posts = this.instanced(postParts, ms, null, true);
      for (const m of t.posts) this.scene.add(m);
    }
    t.lighthouses = [];
    for (let i = 0; i < d.lighthouses.length; i += 3) {
      const lh = makeLighthouse();
      lh.position.set(d.lighthouses[i], d.lighthouses[i + 1] - 0.5, d.lighthouses[i + 2]);
      this.scene.add(lh);
      t.lighthouses.push(lh);
    }
    t.traps = [];
    for (let i = 0; i < d.traps.length; i += 4) {
      const [x, y, z, yaw] = d.traps.subarray(i, i + 4);
      const mesh = makeSpeedTrap();
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      this.scene.add(mesh);
      t.traps.push({ mesh, x, z, dir: { x: Math.sin(yaw), z: Math.cos(yaw) }, side: null, best: 0 });
    }
  }

  makeGrass(t) {
    const d = t.grassData;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const matrices = [], colors = [];
    for (let i = 0; i < d.length; i += 9) {
      matrices.push(new THREE.Matrix4().compose(p.set(d[i], d[i + 1], d[i + 2]), q.setFromAxisAngle(Y, d[i + 3]), s.set(d[i + 4], d[i + 5], d[i + 4])));
      colors.push(new THREE.Color(d[i + 6], d[i + 7], d[i + 8]));
    }
    t.grass = matrices.length ? this.instanced(this.assets.grass, matrices, colors, false)[0] : null;
    if (t.grass) this.scene.add(t.grass);
  }

  addColliders(t) {
    t.colliders = [];
    const add = (desc) => desc && t.colliders.push(this.world.createCollider(desc));
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const m of t.palmMatrices) {
      m.decompose(p, q, s);
      add(RAPIER.ColliderDesc.cylinder(1.5, 0.35 * s.x).setTranslation(p.x, p.y + 1.4, p.z).setFriction(0.6));
    }
    for (const r of t.rockItems) add(rockCollider(this.assets.rocks[r.v].geometry, r.pos, r.q, r.scale));
    for (const r of t.ramps) add(r.collider());
    for (const lh of t.lighthouses) add(RAPIER.ColliderDesc.cylinder(9, 2.6).setTranslation(lh.position.x, lh.position.y + 9, lh.position.z));
  }

  removeColliders(t) {
    for (const c of t.colliders) this.world.removeCollider(c, false);
    t.colliders = null;
  }

  unload(t) {
    const all = [...(t.palmNear || []), ...(t.palmFar || []), ...(t.rocks || []), ...(t.posts || []), t.grass].filter(Boolean);
    for (const m of all) {
      this.scene.remove(m);
      m.dispose();
    }
    for (const r of t.ramps || []) this.scene.remove(r.mesh);
    for (const tr of t.traps || []) this.scene.remove(tr.mesh);
    for (const lh of t.lighthouses || []) this.scene.remove(lh);
    if (t.colliders) this.removeColliders(t);
    if (this.boost) this.boost.removeTile(t.key);
  }

  update(time, camera, focus, dt = 0, carVel = null) {
    wind.value = time;
    this.smashed = carVel ? updateSmashables(dt, focus, carVel) : 0;
    for (const t of this.tiles.values()) for (const lh of t.lighthouses || []) lh.userData.beam.rotation.y = time * 0.8;
    // speed traps: which side of each gate line is the buggy on? Crossing it inside the gate triggers it
    this.trapHits = [];
    if (carVel) {
      for (const t of this.tiles.values()) {
        for (const tr of t.traps || []) {
          const dx = focus.x - tr.x, dz = focus.z - tr.z;
          const along = dx * tr.dir.x + dz * tr.dir.z;
          const across = Math.abs(dx * tr.dir.z - dz * tr.dir.x);
          const side = along > 0;
          if (tr.side !== null && side !== tr.side && across < 9) {
            const kmh = Math.hypot(carVel.x, carVel.z) * 3.6;
            const best = kmh > tr.best;
            tr.best = Math.max(tr.best, kmh);
            this.trapHits.push({ kmh, best });
          }
          tr.side = across < 40 ? side : null;
        }
      }
    }
    this.frame++;
    const Q = this.quality;
    const reach = Q.propDistance + TILE;
    // ask for nearby tiles
    if (this.frame % 10 === 0) {
      for (let i = Math.floor((focus.x - reach) / TILE); i <= Math.floor((focus.x + reach) / TILE); i++) {
        for (let j = Math.floor((focus.z - reach) / TILE); j <= Math.floor((focus.z + reach) / TILE); j++) {
          const key = i + ',' + j;
          if (this.tiles.has(key)) continue;
          const dist = Math.hypot((i + 0.5) * TILE - focus.x, (j + 0.5) * TILE - focus.z);
          if (dist > reach) continue;
          const t = { key, i, j, ready: false };
          this.tiles.set(key, t);
          this.pool
            .run({ type: 'props', tx: i, tz: j, size: TILE, spawn: SPAWN }, dist * 1.2 + 30, () => this.tiles.get(key) === t)
            .then((d) => {
              if (this.tiles.get(key) !== t) return;
              this.build(t, d);
              t.ready = true;
            })
            .catch(() => this.tiles.get(key) === t && this.tiles.delete(key));
        }
      }
    }
    // show, hide, add colliders and grass by distance
    for (const [key, t] of this.tiles) {
      const cx = (t.i + 0.5) * TILE, cz = (t.j + 0.5) * TILE;
      const dist = Math.hypot(cx - focus.x, cz - focus.z);
      if (dist > reach + TILE) {
        if (t.ready) this.unload(t);
        this.tiles.delete(key);
        continue;
      }
      if (!t.ready) continue;
      const camDist = Math.max(0, Math.hypot(cx - camera.position.x, cz - camera.position.z) - TILE * 0.7);
      if (t.palmNear) {
        const near = camDist < Q.palmDetail;
        const visible = camDist < Q.propDistance;
        swap(this.scene, t.palmNear, near && visible);
        swap(this.scene, t.palmFar, !near && visible);
      }
      const grassWanted = camDist < Q.grassDistance;
      if (grassWanted && t.grassData.length && !t.grass) this.makeGrass(t);
      else if (!grassWanted && t.grass) {
        this.scene.remove(t.grass);
        t.grass.dispose();
        t.grass = null;
      }
      if (!t.colliders && dist < COLLIDE_IN) this.addColliders(t);
      else if (t.colliders && dist > COLLIDE_OUT) this.removeColliders(t);
    }
  }
}

// a speed camera gate: two posts and a sign across the top
let trapParts = null;
function makeSpeedTrap() {
  if (!trapParts) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff6a2b';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#fff';
    ctx.font = 'italic 900 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SPEED TRAP', 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    trapParts = {
      post: new THREE.CylinderGeometry(0.18, 0.22, 6, 10),
      sign: new THREE.BoxGeometry(14, 1.6, 0.2),
      postMat: new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.4 }),
      signMat: new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6 }),
    };
  }
  const g = new THREE.Group();
  for (const sx of [-7, 7]) {
    const p = new THREE.Mesh(trapParts.post, trapParts.postMat);
    p.position.set(sx, 3, 0);
    p.castShadow = true;
    g.add(p);
  }
  const sign = new THREE.Mesh(trapParts.sign, trapParts.signMat);
  sign.position.y = 6;
  sign.castShadow = true;
  g.add(sign);
  return g;
}

// a striped lighthouse with a lamp and two slowly turning light beams
let lighthouseParts = null;
function makeLighthouse() {
  if (!lighthouseParts) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 128;
    const ctx = c.getContext('2d');
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#c8202a' : '#f4f1ea';
      ctx.fillRect(0, i * 32, 16, 32);
    }
    const stripes = new THREE.CanvasTexture(c);
    stripes.colorSpace = THREE.SRGBColorSpace;
    lighthouseParts = {
      tower: new THREE.CylinderGeometry(1.7, 2.6, 18, 24).translate(0, 9, 0),
      towerMat: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.55 }),
      base: new THREE.CylinderGeometry(3.6, 4.0, 1.5, 24).translate(0, 0.75, 0),
      stone: new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.9 }),
      gallery: new THREE.CylinderGeometry(2.4, 2.4, 0.3, 24).translate(0, 18.15, 0),
      dark: new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.5, metalness: 0.5 }),
      lamp: new THREE.CylinderGeometry(1.2, 1.2, 2.2, 16).translate(0, 19.4, 0),
      lampMat: new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe08a, emissiveIntensity: 4, roughness: 0.2 }),
      roof: new THREE.ConeGeometry(1.7, 1.6, 16).translate(0, 21.3, 0),
      roofMat: new THREE.MeshStandardMaterial({ color: 0xa8161f, roughness: 0.5 }),
      beam: new THREE.ConeGeometry(4, 60, 24, 1, true).translate(0, -30, 0).rotateZ(Math.PI / 2),
      beamMat: new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; void main(){ float a = pow(vUv.y, 3.0) * 0.35; gl_FragColor = vec4(vec3(1.0, 0.93, 0.7) * a, 1.0); }`,
      }),
    };
  }
  const P = lighthouseParts;
  const g = new THREE.Group();
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(P.base, P.stone);
  add(P.tower, P.towerMat);
  add(P.gallery, P.dark);
  add(P.lamp, P.lampMat).castShadow = false;
  add(P.roof, P.roofMat);
  const beam = new THREE.Group();
  beam.position.y = 19.4;
  for (const r of [0, Math.PI]) {
    const b = new THREE.Mesh(P.beam, P.beamMat);
    b.rotation.y = r;
    b.castShadow = false;
    beam.add(b);
  }
  g.add(beam);
  g.userData.beam = beam;
  return g;
}

function swap(scene, meshes, on) {
  for (const m of meshes) {
    if (on && !m.parent) scene.add(m);
    else if (!on && m.parent) scene.remove(m);
  }
}

// a convex collider shaped like the rock (about 200 of its points)
function rockCollider(geo, pos, q, scl) {
  const verts = geo.attributes.position.array;
  const stride = Math.max(1, Math.floor(verts.length / 3 / 200));
  const pts = [];
  const tmp = new THREE.Vector3();
  for (let k = 0; k < verts.length / 3; k += stride) {
    // a bit smaller than the visible rock, so you never hit thin air
    tmp.set(verts[k * 3] * 0.85, verts[k * 3 + 1] * 0.85, verts[k * 3 + 2] * 0.85).multiply(scl).applyQuaternion(q);
    pts.push(tmp.x, tmp.y, tmp.z);
  }
  const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
  return desc && desc.setTranslation(pos.x, pos.y, pos.z).setFriction(0.7);
}
