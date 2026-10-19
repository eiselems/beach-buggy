// Second pass for public/models/buggy.glb (run after prepare-buggy.mjs):
// small pieces of the black cartoon outline around the tires were left on the body, so they floated
// in place while the wheels spun and steered. Move every outline piece that sits within 5 cm of a
// wheel into that wheel.
// usage (with the same tools as prepare-buggy.mjs): node fix-wheel-outlines.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [input, output] = process.argv.slice(2);
const MARGIN = 0.05; // meters outside the tire
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const nodes = doc.getRoot().listNodes();
const wheels = nodes
  .filter((n) => n.getName().startsWith('wheel_'))
  .map((n) => ({ node: n, c: n.getTranslation(), r: n.getExtras().radius, hw: n.getExtras().width / 2 }));
const body = nodes.find((n) => n.getName() === 'body').getMesh();
const buffer = doc.getRoot().listBuffers()[0];

// groups of triangles connected by shared vertex positions
function components(P, I) {
  const parent = Int32Array.from({ length: P.getCount() }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const seen = new Map();
  for (let v = 0; v < P.getCount(); v++) {
    const k = P.getElement(v, []).map((x) => Math.round(x * 1e4)).join(',');
    if (seen.has(k)) parent[find(v)] = find(seen.get(k)); else seen.set(k, v);
  }
  for (let t = 0; t < I.getCount(); t += 3) {
    const a = find(I.getScalar(t));
    parent[find(I.getScalar(t + 1))] = a;
    parent[find(I.getScalar(t + 2))] = a;
  }
  const groups = new Map();
  for (let t = 0; t < I.getCount(); t += 3) {
    const r = find(I.getScalar(t));
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

// how far the piece reaches outside the wheel's cylinder (meters)
function reach(P, I, tris, w) {
  let m = -Infinity;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = P.getElement(I.getScalar(t + k), []);
    m = Math.max(m, Math.abs(v[0] - w.c[0]) - w.hw, Math.hypot(v[1] - w.c[1], v[2] - w.c[2]) - w.r);
  }
  return m;
}

// copy some triangles of a primitive into a new one, shifted by -origin
function subset(prim, tris, origin) {
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), I = prim.getIndices();
  const remap = new Map(), order = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = I.getScalar(t + k);
    if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
  }
  const pos = new Float32Array(order.length * 3), nrm = new Float32Array(order.length * 3);
  order.forEach((v, i) => {
    const p = P.getElement(v, []);
    for (let j = 0; j < 3; j++) pos[i * 3 + j] = p[j] - origin[j];
    if (N) nrm.set(N.getElement(v, []), i * 3);
  });
  const idx = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) idx[i * 3 + k] = remap.get(I.getScalar(t + k)); });
  const out = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
    .setMaterial(prim.getMaterial());
  if (N) out.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer));
  return out;
}

for (const prim of body.listPrimitives()) {
  if (prim.getMaterial()?.getName() !== 'MTA_Negro') continue;
  const P = prim.getAttribute('POSITION'), I = prim.getIndices();
  const keep = [];
  const moved = new Map(wheels.map((w) => [w, []]));
  for (const tris of components(P, I)) {
    const w = wheels.find((w) => reach(P, I, tris, w) < MARGIN);
    (w ? moved.get(w) : keep).push(...tris);
  }
  let count = 0;
  for (const [w, tris] of moved) {
    if (!tris.length) continue;
    count += tris.length;
    const target = w.node.getMesh().listPrimitives().find((p) => p.getMaterial() === prim.getMaterial());
    w.node.getMesh().addPrimitive(subset(prim, tris, w.c));
    console.log(w.node.getName(), '+', tris.length, 'outline triangles', target ? '' : '(new primitive)');
  }
  if (count) {
    body.addPrimitive(subset(prim, keep, [0, 0, 0]));
    body.removePrimitive(prim);
  }
}
await doc.transform(prune());
await io.write(output, doc);
console.log('written', output);
