// Background worker: builds pieces of the endless world so the game never stutters.
//  - 'leaf':  a patch of the visible ground (positions, normals, colours) at some level of detail
//  - 'phys':  a patch of heights for the physics engine
//  - 'props': where palms, rocks, grass, ramps and boost pads go in a 256 m map tile
import { terrainFunction, surfaceAt, shoreZ, headlandAt } from './heightfield.js';
import { createNoise2D, mulberry32, fbm } from './noise.js';

self.onmessage = (e) => {
  const job = e.data;
  let result, transfer;
  if (job.type === 'leaf') [result, transfer] = buildLeaf(job);
  else if (job.type === 'phys') [result, transfer] = buildPhys(job);
  else [result, transfer] = buildProps(job);
  self.postMessage({ id: job.id, ...result }, transfer);
};

// ---------------------------------------------------------------------------
function buildLeaf({ x0, z0, size, cells }) {
  const n = cells + 1;
  const step = size / cells;
  // heights with a one-cell border, so normals at the edges match the neighbours
  const g = n + 2;
  const hs = new Float32Array(g * g);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) hs[j * g + i] = terrainFunction(x0 + (i - 1) * step, z0 + (j - 1) * step);
  }
  const verts = n * n + 4 * n; // grid + skirt
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const surface = new Float32Array(verts * 2);
  const uv = new Float32Array(verts * 2);
  const s = [0, 0, 0, 0, 0];
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = x0 + i * step, z = z0 + j * step;
      const h = hs[(j + 1) * g + i + 1];
      minY = Math.min(minY, h);
      maxY = Math.max(maxY, h);
      position[k * 3] = i * step;
      position[k * 3 + 1] = h;
      position[k * 3 + 2] = j * step;
      let nx = hs[(j + 1) * g + i] - hs[(j + 1) * g + i + 2];
      let ny = 2 * step;
      let nz = hs[j * g + i + 1] - hs[(j + 2) * g + i + 1];
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      normal[k * 3] = nx;
      normal[k * 3 + 1] = ny;
      normal[k * 3 + 2] = nz;
      surfaceAt(x, z, h, ny, s);
      color[k * 3] = s[0];
      color[k * 3 + 1] = s[1];
      color[k * 3 + 2] = s[2];
      surface[k * 2] = s[3];
      surface[k * 2 + 1] = s[4];
      // texture coordinates repeat every 4 m; keep the numbers small far from the origin
      uv[k * 2] = (x % 4096) * 0.25;
      uv[k * 2 + 1] = (z % 4096) * 0.25;
    }
  }
  // skirts: a strip hanging down from each edge hides tiny gaps between patches of different detail
  const drop = step * 0.6 + 0.5;
  const edges = [
    (t) => t,                   // z = 0 edge
    (t) => (n - 1) * n + t,     // z = max
    (t) => t * n,               // x = 0
    (t) => t * n + n - 1,       // x = max
  ];
  edges.forEach((edge, e) => {
    for (let t = 0; t < n; t++) {
      const src = edge(t), dst = n * n + e * n + t;
      position.copyWithin(dst * 3, src * 3, src * 3 + 3);
      position[dst * 3 + 1] -= drop;
      normal.copyWithin(dst * 3, src * 3, src * 3 + 3);
      color.copyWithin(dst * 3, src * 3, src * 3 + 3);
      surface.copyWithin(dst * 2, src * 2, src * 2 + 2);
      uv.copyWithin(dst * 2, src * 2, src * 2 + 2);
    }
  });
  return [
    { position, normal, color, surface, uv, minY: minY - drop, maxY },
    [position.buffer, normal.buffer, color.buffer, surface.buffer, uv.buffer],
  ];
}

// ---------------------------------------------------------------------------
function buildPhys({ x0, z0, size, cells }) {
  const n = cells + 1;
  const step = size / cells;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) heights[j * n + i] = terrainFunction(x0 + i * step, z0 + j * step);
  }
  return [{ heights }, [heights.buffer]];
}

// ---------------------------------------------------------------------------
const noise = createNoise2D(99);
const normalY = (x, z) => {
  const e = 2;
  const dx = terrainFunction(x - e, z) - terrainFunction(x + e, z);
  const dz = terrainFunction(x, z - e) - terrainFunction(x, z + e);
  return (2 * e) / Math.hypot(dx, 2 * e, dz);
};

function buildProps({ tx, tz, size, spawn }) {
  const rnd = mulberry32((tx * 73856093) ^ (tz * 19349663) ^ 0x5bd1e995);
  const range = (a, b) => a + (b - a) * rnd();
  const x0 = tx * size, z0 = tz * size;
  const inTile = (x, z) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
  const nearSpawn = (x, z, r) => Math.hypot(x - spawn.x, z - spawn.z) < r;
  // does this tile touch the beach strip at all?
  let minU = Infinity, maxU = -Infinity;
  for (let k = 0; k <= 8; k++) {
    const x = x0 + (size * k) / 8;
    const s = shoreZ(x);
    minU = Math.min(minU, s - (z0 + size));
    maxU = Math.max(maxU, s - z0);
  }

  // palm trees: groves along the beach, a few scattered inland
  const palms = [];
  if (maxU > 20 && minU < 900) {
    for (let t = 0; t < 90 && palms.length < 60; t++) {
      const x = range(x0, x0 + size), z = range(z0, z0 + size);
      const u = shoreZ(x) - z;
      if (u < 30 || u > 900) continue;
      const cluster = noise(x * 0.012, z * 0.012);
      const need = u < 150 ? 0.15 : u < 260 ? 0.4 : 0.62;
      if (cluster < need) continue;
      if (nearSpawn(x, z, 18)) continue;
      if (normalY(x, z) < 0.9) continue;
      let ok = true;
      for (let p = 0; p < palms.length; p += 6) if (Math.hypot(palms[p] - x, palms[p + 2] - z) < 7) ok = false;
      if (!ok) continue;
      // near the beach, lean towards the sea like real beach palms
      const yaw = Math.PI / 2 + range(-0.9, 0.9) + (u > 120 ? range(0, Math.PI * 2) : 0);
      const sc = range(0.9, 1.35);
      palms.push(x, terrainFunction(x, z) - 0.15, z, yaw, sc, sc * range(0.9, 1.15));
    }
  }

  // rocks: piles on the headlands, some along the waterline and in the dunes/mountains
  const rocks = [];
  for (let t = 0; t < 40; t++) {
    const x = range(x0, x0 + size), z = range(z0, z0 + size);
    const d = z - shoreZ(x);
    const head = headlandAt(x);
    let scale = 0;
    if (head > 0.2 && d > -60 && d < 60 && rnd() < head) scale = range(0.8, 3.2);
    else if (d > -6 && d < 22 && rnd() < 0.12 && noise(x * 0.02, 3) > 0.25) scale = range(0.4, 1.4);
    else if (d < -90 && d > -1600 && rnd() < 0.08) scale = range(0.5, d < -600 ? 3.5 : 2.2);
    if (!scale || nearSpawn(x, z, 25)) continue;
    const size2 = scale * 2;
    rocks.push(x, terrainFunction(x, z) - size2 * 0.12, z, range(-0.2, 0.2), range(0, Math.PI * 2), range(-0.2, 0.2), size2, range(0.7, 1.1), Math.floor(rnd() * 3));
  }

  // dune grass, in patches
  const grass = [];
  if (maxU > 30 && minU < 800) {
    let tries = 0;
    while (grass.length < 1400 * 9 && tries++ < 260) {
      const x = range(x0, x0 + size), z = range(z0, z0 + size);
      const u = shoreZ(x) - z;
      if (u < 40 || u > 800) continue;
      const patch = fbm(noise, x * 0.03, z * 0.03, 2) - (u > 330 ? 0.25 : 0);
      if (patch < 0.05) continue;
      if (nearSpawn(x, z, 10)) continue;
      if (normalY(x, z) < 0.88) continue;
      const group = 2 + Math.floor(rnd() * 5);
      for (let c = 0; c < group; c++) {
        const cx = x + range(-3, 3), cz = z + range(-3, 3);
        const sc = range(1.4, 2.4) * (0.75 + patch);
        grass.push(cx, terrainFunction(cx, cz) - 0.04, cz, rnd() * Math.PI * 2, sc, sc * range(0.8, 1.3), range(0.85, 1.1), range(0.85, 1.05), range(0.75, 1.0));
      }
    }
  }

  // jump ramps on the beach, driving along the coast
  const ramps = [];
  if (rnd() < 0.45) {
    const x = range(x0 + 20, x0 + size - 20);
    const z = shoreZ(x) - range(14, 70);
    if (inTile(x, z) && !nearSpawn(x, z, 60) && normalY(x, z) > 0.97 && headlandAt(x) < 0.1) {
      const big = rnd() < 0.4;
      ramps.push(x, z, rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2, big ? 9 : 7, big ? 2.2 : 1.5, big ? 5 : 4);
    }
  }

  // boost pads (Rocket League style): small ones dotted along the beach, big ones less often
  const pads = [];
  for (let k = 0; k < 4; k++) {
    const x = x0 + (k + 0.5) * (size / 4) + range(-12, 12);
    const z = shoreZ(x) - range(18, 45);
    if (!inTile(x, z) || headlandAt(x) > 0.3) continue;
    pads.push(x, terrainFunction(x, z), z, 0);
  }
  if (rnd() < 0.6) {
    const x = range(x0, x0 + size);
    const z = shoreZ(x) - range(20, 240);
    if (inTile(x, z) && normalY(x, z) > 0.93 && headlandAt(x) < 0.3) pads.push(x, terrainFunction(x, z), z, 1);
  }
  // a big pad in front of each ramp
  for (let r = 0; r < ramps.length; r += 6) {
    const yaw = ramps[r + 2];
    const x = ramps[r] - Math.sin(yaw) * 30, z = ramps[r + 1] - Math.cos(yaw) * 30;
    pads.push(x, terrainFunction(x, z), z, 1);
  }

  const out = {
    palms: new Float32Array(palms),
    rocks: new Float32Array(rocks),
    grass: new Float32Array(grass),
    ramps: new Float32Array(ramps),
    pads: new Float32Array(pads),
  };
  return [out, Object.values(out).map((a) => a.buffer)];
}
