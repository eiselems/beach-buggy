// Things on the beach: palm trees, rocks, dune grass, driftwood,
// a lifeguard tower, jump ramps and umbrellas. Solid things get physics colliders.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { getHeight, getNormal, shoreZ, TERRAIN } from './terrain.js';
import { createNoise2D, mulberry32, fbm } from './noise.js';

const rnd = mulberry32(4242);
const range = (a, b) => a + (b - a) * rnd();
const noise = createNoise2D(99);
const SPAWN = { x: 0, z: shoreZ(0) - 25 };
const nearSpawn = (x, z, r) => Math.hypot(x - SPAWN.x, z - SPAWN.z) < r;
const inland = (x, z) => shoreZ(x) - z;

// Wind sway shared by plants
const wind = { value: 0 };
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
// Instanced objects are split into square map tiles. The GPU then only draws tiles that are
// on screen (and close enough), instead of every palm/rock/grass patch in the world every frame.
const chunks = []; // { meshes, center, maxDist }
function addChunked(scene, parts, items, { cell, castShadow = true, maxDist = Infinity }) {
  const cells = new Map();
  for (const it of items) {
    const key = Math.floor(it.matrix.elements[12] / cell) + ',' + Math.floor(it.matrix.elements[14] / cell);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(it);
  }
  for (const list of cells.values()) {
    const center = new THREE.Vector3();
    for (const it of list) center.add(new THREE.Vector3().setFromMatrixPosition(it.matrix));
    center.divideScalar(list.length);
    const meshes = parts.map(({ geometry, material }) => {
      const im = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.matrix);
        if (it.color) im.setColorAt(i, it.color);
      });
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere(); // makes frustum culling work per tile
      scene.add(im);
      return im;
    });
    chunks.push({ meshes, center, maxDist });
  }
}

// ---------------------------------------------------------------------------
// Palm trees: "Coconut Palm" by evolveduk (Sketchfab, CC-BY). The model leans towards -X.
function placePalms(scene, world, parts, count, maxDist) {
  for (const part of parts) {
    // the fronds sway in the wind and get smooth cut-out edges
    if (part.material.alphaTest > 0 || part.material.transparent) {
      part.material.alphaToCoverage = true;
      part.material.side = THREE.DoubleSide;
      addWind(part.material, 0.18, 6);
    }
  }

  const spots = [];
  let tries = 0;
  while (spots.length < count && tries++ < 20000) {
    const x = range(-560, 560);
    const u = range(30, 260);
    const z = shoreZ(x) - u;
    if (nearSpawn(x, z, 18)) continue;
    const cluster = noise(x * 0.012, z * 0.012);
    if (cluster < 0.15 + (u > 150 ? 0.25 : 0)) continue;
    if (getNormal(x, z).y < 0.9) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 7)) continue;
    spots.push({ x, z });
  }

  const items = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach((sp) => {
    // near the beach, lean towards the sea like real beach palms (+PI/2 turns the model's lean to +Z)
    const yaw = Math.PI / 2 + range(-0.9, 0.9) + (inland(sp.x, sp.z) > 120 ? range(0, Math.PI * 2) : 0);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const sc = range(0.9, 1.35);
    s.set(sc, sc * range(0.9, 1.15), sc);
    p.set(sp.x, getHeight(sp.x, sp.z) - 0.15, sp.z);
    items.push({ matrix: new THREE.Matrix4().compose(p, q, s) });
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.35 * sc).setTranslation(sp.x, p.y + 1.4, sp.z).setFriction(0.6));
  });
  addChunked(scene, parts, items, { cell: 120, maxDist });
}

// ---------------------------------------------------------------------------
// Rocks
function placeRocks(scene, world, rocks, count) {
  // photo-scanned rocks (Poly Haven), each about 1 m across with its base at y = 0
  const variants = rocks.map((r) => r.geometry);
  const spots = [];
  // clusters near the headlands, along the waterline and among dunes
  for (let i = 0; i < count; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    let x, z, scale;
    const kind = rnd();
    if (kind < 0.55) {
      x = side * range(420, 560);
      z = shoreZ(x) + range(-40, 60);
      scale = range(0.8, 3.2);
    } else if (kind < 0.8) {
      x = range(-400, 400);
      z = shoreZ(x) + range(-4, 25);
      scale = range(0.4, 1.4);
      if (noise(x * 0.02, 3) < 0.25) continue;
    } else {
      x = range(-500, 500);
      z = shoreZ(x) - range(90, 300);
      scale = range(0.5, 2.2);
    }
    if (nearSpawn(x, z, 25)) continue;
    spots.push({ x, z, scale, v: Math.floor(rnd() * variants.length) });
  }
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  variants.forEach((geo, vi) => {
    const mine = spots.filter((s) => s.v === vi);
    const items = [];
    const verts = geo.attributes.position.array;
    const stride = Math.max(1, Math.floor(verts.length / 3 / 200));
    mine.forEach((sp) => {
      e.set(range(-0.2, 0.2), range(0, Math.PI * 2), range(-0.2, 0.2));
      q.setFromEuler(e);
      const size = sp.scale * 2;
      const pos = new THREE.Vector3(sp.x, getHeight(sp.x, sp.z) - size * 0.12, sp.z);
      const scl = new THREE.Vector3(size, size * range(0.7, 1.1), size);
      items.push({ matrix: new THREE.Matrix4().compose(pos, q, scl) });
      // collider shaped like the rock (about 200 of its points)
      const pts = [];
      const tmp = new THREE.Vector3();
      for (let k = 0; k < verts.length / 3; k += stride) {
        tmp.set(verts[k * 3], verts[k * 3 + 1], verts[k * 3 + 2]).multiply(scl).applyQuaternion(q);
        pts.push(tmp.x, tmp.y, tmp.z);
      }
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) world.createCollider(desc.setTranslation(pos.x, pos.y, pos.z).setFriction(0.7));
    });
    addChunked(scene, [rocks[vi]], items, { cell: 150 });
  });
}

// ---------------------------------------------------------------------------
// Dune grass: "Dry grass" by Pixel-bit (Sketchfab, CC-BY). Each instance is a patch of 7 clumps.
function placeGrass(scene, parts, count) {
  const { geometry, material } = parts[0];
  // foliage trick: light the grass like the ground beneath it, so thin cards never turn dark
  const nrm = geometry.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  material.color.setRGB(1.15, 1.05, 0.85);
  // cut-out instead of blending, so thousands of patches don't need sorting
  material.transparent = false;
  material.depthWrite = true;
  material.alphaTest = 0.35;
  material.alphaToCoverage = true;
  material.side = THREE.DoubleSide;
  addWind(material, 0.12, 0.8);

  const items = [];
  const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0, tries = 0;
  while (n < count && tries++ < 200000) {
    const x = range(-600, 600);
    const u = range(40, 330);
    const z = shoreZ(x) - u;
    const patch = fbm(noise, x * 0.03, z * 0.03, 2);
    if (patch < 0.05) continue;
    if (getNormal(x, z).y < 0.88) continue;
    if (nearSpawn(x, z, 10)) continue;
    // patches grow in groups
    const group = 2 + Math.floor(rnd() * 5);
    for (let c = 0; c < group && n < count; c++) {
      const cx = x + range(-3, 3), cz = z + range(-3, 3);
      p.set(cx, getHeight(cx, cz) - 0.04, cz);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      const sc = range(1.4, 2.4) * (0.75 + patch);
      s.set(sc, sc * range(0.8, 1.3), sc);
      items.push({
        matrix: new THREE.Matrix4().compose(p, q, s),
        color: new THREE.Color(range(0.85, 1.1), range(0.85, 1.05), range(0.75, 1.0)),
      });
      n++;
    }
  }
  // grass is tiny far away, so tiles beyond ~220 m are skipped entirely
  addChunked(scene, [{ geometry, material }], items, { cell: 60, castShadow: false, maxDist: 220 });
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
    world.createCollider(
      RAPIER.ColliderDesc.capsule(len / 2 - r, r)
        .setTranslation(x, log.position.y, z)
        .setRotation(new THREE.Quaternion().setFromEuler(log.rotation))
    );
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
function placeRamp(scene, world, x, z, yaw, length = 7, height = 1.5, width = 4) {
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
  const mat = new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 });
  const ramp = new THREE.Mesh(geo, mat);
  const y = Math.min(getHeight(x, z - 3), getHeight(x, z + 3), getHeight(x - 2, z), getHeight(x + 2, z)) - 0.05;
  ramp.position.set(x, y, z);
  ramp.rotation.y = yaw;
  ramp.castShadow = ramp.receiveShadow = true;
  scene.add(ramp);
  const q = new THREE.Quaternion().setFromEuler(ramp.rotation);
  const flat = new Float32Array((geo.index ? geo.toNonIndexed() : geo).attributes.position.array);
  const order = Uint32Array.from({ length: flat.length / 3 }, (_, i) => i);
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(flat, order)
      .setTranslation(x, y, z)
      .setRotation(q)
      .setFriction(0.8)
  );
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
    world.createCollider(RAPIER.ColliderDesc.cylinder(1.2, 0.08).setTranslation(x, y + 1.2, z));
  });
}

// ---------------------------------------------------------------------------
export function createProps(scene, world, assets, quality) {
  placePalms(scene, world, assets.palm, quality.palms, quality.palmDistance);
  placeRocks(scene, world, assets.rocks, quality.rocks);
  placeGrass(scene, assets.grass, quality.grass);
  placeDriftwood(scene, world);
  placeLifeguardTower(scene, world, 95);
  placeLifeguardTower(scene, world, -330);
  placeRamp(scene, world, -70, shoreZ(-70) - 12, Math.PI / 2);
  placeRamp(scene, world, 230, shoreZ(230) - 14, -Math.PI / 2, 9, 2.2, 5);
  placeRamp(scene, world, 40, shoreZ(40) - 60, Math.PI, 6, 1.2, 4);
  placeUmbrellas(scene, world);

  // invisible walls at the edge of the world
  const P = TERRAIN.play;
  const walls = [
    [(P.minX + P.maxX) / 2, P.minZ, (P.maxX - P.minX) / 2, 2],
    [(P.minX + P.maxX) / 2, P.maxZ, (P.maxX - P.minX) / 2, 2],
    [P.minX, (P.minZ + P.maxZ) / 2, 2, (P.maxZ - P.minZ) / 2],
    [P.maxX, (P.minZ + P.maxZ) / 2, 2, (P.maxZ - P.minZ) / 2],
  ];
  for (const [x, z, hx, hz] of walls) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 200, hz).setTranslation(x, 0, z));
  }

  return {
    spawn: SPAWN,
    update(t, cameraPosition) {
      wind.value = t;
      for (const c of chunks) {
        if (c.maxDist === Infinity) continue;
        const visible = c.center.distanceTo(cameraPosition) < c.maxDist;
        for (const im of c.meshes) im.visible = visible;
      }
    },
  };
}
