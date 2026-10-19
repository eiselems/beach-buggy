// Prepares the Sketchfab buggy for the game:
//  - bakes all node transforms into the geometry (world space)
//  - splits the four tires (merged with the dashboard, and in the outline mesh) into separate wheels
//  - converts centimeters to meters, origin centred between the wheels at ground level
//  - compresses textures to WebP
// usage (from a folder with the tools installed):
//   npm i @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions gl-matrix sharp
//   node prepare-buggy.mjs downloaded.glb ../public/models/buggy.glb
import { NodeIO, Document } from '@gltf-transform/core';
import { textureCompress, prune, dedup, weld } from '@gltf-transform/functions';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { vec3, mat3, mat4 } from 'gl-matrix';

const [input, output] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(input);

// ---- 1. collect every primitive in world space
const parts = []; // { name, material, pos, nrm, uv, tan, idx }
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  const nm = mat3.normalFromMat4(mat3.create(), m);
  for (const prim of mesh.listPrimitives()) {
    const a = (n) => prim.getAttribute(n);
    const P = a('POSITION'), N = a('NORMAL'), U = a('TEXCOORD_0'), T = a('TANGENT');
    const count = P.getCount();
    const pos = new Float32Array(count * 3), nrm = N ? new Float32Array(count * 3) : null;
    const uv = U ? new Float32Array(count * 2) : null, tan = T ? new Float32Array(count * 4) : null;
    const v = [0, 0, 0], v4 = [0, 0, 0, 0], v2 = [0, 0];
    for (let i = 0; i < count; i++) {
      P.getElement(i, v);
      pos.set(vec3.transformMat4([], v, m), i * 3);
      if (N) { N.getElement(i, v); nrm.set(vec3.normalize([], vec3.transformMat3([], v, nm)), i * 3); }
      if (U) { U.getElement(i, v2); uv.set(v2, i * 2); }
      if (T) {
        T.getElement(i, v4);
        const t = vec3.normalize([], vec3.transformMat3([], [v4[0], v4[1], v4[2]], mat3.fromMat4([], m)));
        tan.set([t[0], t[1], t[2], v4[3]], i * 4);
      }
    }
    const I = prim.getIndices();
    const idx = new Uint32Array(I ? I.getCount() : count);
    for (let i = 0; i < idx.length; i++) idx[i] = I ? I.getScalar(i) : i;
    parts.push({ name: mesh.getName(), material: prim.getMaterial(), pos, nrm, uv, tan, idx });
  }
}

// ---- 2. find the four wheels from the tire mesh (low triangles far from the centre line)
const tires = parts.find((p) => p.name.startsWith('MDL_Neumatico'));
const groups = { FL: [], FR: [], RL: [], RR: [] };
const centroid = (p, t) => {
  const c = [0, 0, 0];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) c[j] += p.pos[p.idx[t + k] * 3 + j] / 3;
  return c;
};
for (let t = 0; t < tires.idx.length; t += 3) {
  const c = centroid(tires, t);
  if (c[1] > 100) continue;
  const side = c[0] > 40 ? 'L' : c[0] < -95 ? 'R' : null; // facing +Z, left is +X
  const end = c[2] > 30 ? 'F' : c[2] < -30 ? 'R' : null;
  if (side && end) groups[end + side].push(t);
}
const wheels = {};
for (const [name, tris] of Object.entries(groups)) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
    const val = tires.pos[tires.idx[t + k] * 3 + j];
    min[j] = Math.min(min[j], val);
    max[j] = Math.max(max[j], val);
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  wheels[name] = { center, radius: Math.max(max[1] - min[1], max[2] - min[2]) / 2, halfWidth: (max[0] - min[0]) / 2 };
}
console.log('wheels (cm):', JSON.stringify(wheels, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)));

// Which triangles belong to which wheel (for any mesh)
function wheelOf(c) {
  for (const [name, w] of Object.entries(wheels)) {
    const dx = Math.abs(c[0] - w.center[0]);
    const r = Math.hypot(c[1] - w.center[1], c[2] - w.center[2]);
    if (dx < w.halfWidth + 3 && r < w.radius + 1.5) return name;
  }
  return null;
}

// ---- 3. build the output document
const ground = Math.min(...Object.values(wheels).map((w) => w.center[1] - w.radius));
const mid = [
  Object.values(wheels).reduce((s, w) => s + w.center[0], 0) / 4,
  ground,
  Object.values(wheels).reduce((s, w) => s + w.center[2], 0) / 4,
];
const S = 0.01; // cm -> m

const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const scene = doc.createScene('buggy');
const rootNode = doc.createNode('buggy');
scene.addChild(rootNode);
const matMap = new Map();
const copyMaterial = (m) => {
  if (!m) return null;
  if (matMap.has(m)) return matMap.get(m);
  const n = doc.createMaterial(m.getName())
    .setBaseColorFactor(m.getBaseColorFactor())
    .setMetallicFactor(m.getMetallicFactor())
    .setRoughnessFactor(m.getRoughnessFactor())
    .setAlphaMode(m.getAlphaMode())
    .setDoubleSided(m.getDoubleSided())
    .setEmissiveFactor(m.getEmissiveFactor());
  const tex = (t) => {
    if (!t) return null;
    return doc.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType());
  };
  const texCache = new Map();
  const cached = (t) => { if (!t) return null; if (!texCache.has(t)) texCache.set(t, tex(t)); return texCache.get(t); };
  if (m.getBaseColorTexture()) n.setBaseColorTexture(cached(m.getBaseColorTexture()));
  if (m.getNormalTexture()) n.setNormalTexture(cached(m.getNormalTexture())).setNormalScale(m.getNormalScale());
  if (m.getOcclusionTexture()) n.setOcclusionTexture(cached(m.getOcclusionTexture()));
  if (m.getMetallicRoughnessTexture()) n.setMetallicRoughnessTexture(cached(m.getMetallicRoughnessTexture()));
  matMap.set(m, n);
  return n;
};

// make a primitive from a subset of triangles, positioned relative to `origin` (cm)
function makePrim(p, tris, origin) {
  const remap = new Map();
  const order = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = p.idx[t + k];
    if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
  }
  const n = order.length;
  const pos = new Float32Array(n * 3);
  order.forEach((v, i) => { for (let j = 0; j < 3; j++) pos[i * 3 + j] = (p.pos[v * 3 + j] - origin[j]) * S; });
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer));
  if (p.nrm) {
    const a = new Float32Array(n * 3);
    order.forEach((v, i) => a.set(p.nrm.subarray(v * 3, v * 3 + 3), i * 3));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(a).setBuffer(buffer));
  }
  if (p.uv) {
    const a = new Float32Array(n * 2);
    order.forEach((v, i) => a.set(p.uv.subarray(v * 2, v * 2 + 2), i * 2));
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(a).setBuffer(buffer));
  }
  if (p.tan) {
    const a = new Float32Array(n * 4);
    order.forEach((v, i) => a.set(p.tan.subarray(v * 4, v * 4 + 4), i * 4));
    prim.setAttribute('TANGENT', doc.createAccessor().setType('VEC4').setArray(a).setBuffer(buffer));
  }
  const idx = new Uint32Array(tris.length * 3);
  tris.forEach((t, i) => { for (let k = 0; k < 3; k++) idx[i * 3 + k] = remap.get(p.idx[t + k]); });
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  prim.setMaterial(copyMaterial(p.material));
  return prim;
}

const bodyMesh = doc.createMesh('body');
const wheelMeshes = Object.fromEntries(Object.keys(wheels).map((k) => [k, doc.createMesh('wheel_' + k)]));
for (const p of parts) {
  const bodyTris = [];
  const wheelTris = { FL: [], FR: [], RL: [], RR: [] };
  const splittable = p.name.startsWith('MDL_Neumatico') || p.name.startsWith('OutLine');
  for (let t = 0; t < p.idx.length; t += 3) {
    const w = splittable ? wheelOf(centroid(p, t)) : null;
    (w ? wheelTris[w] : bodyTris).push(t);
  }
  if (bodyTris.length) bodyMesh.addPrimitive(makePrim(p, bodyTris, mid));
  for (const [w, tris] of Object.entries(wheelTris)) {
    if (tris.length) wheelMeshes[w].addPrimitive(makePrim(p, tris, wheels[w].center));
  }
}
rootNode.addChild(doc.createNode('body').setMesh(bodyMesh));
for (const [w, mesh] of Object.entries(wheelMeshes)) {
  const c = wheels[w].center;
  rootNode.addChild(
    doc.createNode('wheel_' + w)
      .setMesh(mesh)
      .setTranslation([(c[0] - mid[0]) * S, (c[1] - mid[1]) * S, (c[2] - mid[2]) * S])
      .setExtras({ radius: wheels[w].radius * S, width: wheels[w].halfWidth * 2 * S })
  );
}

await doc.transform(
  weld(),
  dedup(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 })
);
await io.write(output, doc);
console.log('written', output);
