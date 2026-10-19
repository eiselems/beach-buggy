// The island: a curved sandy bay between two rocky headlands.
// The sea is towards +Z, the land towards -Z. Water level is y = 0.
import * as THREE from 'three';
import { createNoise2D, fbm, smoothstep, lerp } from './noise.js';
import { createSandDetailTexture } from './textures.js';

export const TERRAIN = {
  size: 1600, // meters
  res: 640,   // grid cells per side (2.5 m per cell)
  // the area you are allowed to drive in
  play: { minX: -600, maxX: 600, minZ: -540, maxZ: 300 },
};

const nA = createNoise2D(11);
const nB = createNoise2D(23);
const nC = createNoise2D(37);

// Where the waterline is for a given x (makes the bay curvy)
export function shoreZ(x) {
  return 38 * Math.sin(x * 0.0045 + 0.6) + 16 * Math.sin(x * 0.012 + 1.3) + 5 * Math.sin(x * 0.033 + 2.1);
}

// The height of the ground at any point. Change this to reshape the world!
export function terrainFunction(x, z) {
  const d = z - shoreZ(x); // distance out to sea (negative = on land)
  const u = -d;            // distance inland
  let h;
  if (d > 0) {
    // sea floor: gentle slope getting deeper, with a sandbar where waves break
    h = -0.034 * d - 0.00011 * d * d;
    h += 0.55 * Math.exp(-(((d - 48) / 13) ** 2));
    h = Math.max(h, -45);
  } else {
    // beach rising up from the water
    h = 2.6 * (1 - Math.exp(-u / 70)) + 0.01 * u;
    // sand dunes behind the beach
    const duneMask = smoothstep(55, 125, u) * (1 - 0.5 * smoothstep(260, 340, u));
    const ridge = 1 - Math.abs(nA(x * 0.006, u * 0.011));
    h += duneMask * (ridge * ridge * 8 + fbm(nB, x * 0.012, z * 0.012, 3) * 2.5);
    // grassy hills and mountains further inland
    h += smoothstep(220, 480, u) * (18 + 14 * fbm(nC, x * 0.004, z * 0.004, 4));
    h += smoothstep(480, 760, u) * 55;
    // small bumps you feel while driving
    h += 0.12 * nC(x * 0.15, z * 0.15) * smoothstep(-2, 8, u);
  }
  // rocky headlands at both ends of the bay
  const head = smoothstep(470, 700, Math.abs(x)) * smoothstep(300, 60, d);
  if (head > 0) {
    const cliff = 26 + 12 * fbm(nB, x * 0.01, z * 0.01, 4) + 3 * fbm(nA, x * 0.05, z * 0.05, 3);
    h = lerp(h, Math.max(h, cliff), head);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Sample the function on a grid once; everything else uses this grid.
const N = TERRAIN.res, S = TERRAIN.size, STEP = S / N, HALF = S / 2;
export const heights = new Float32Array((N + 1) * (N + 1));
for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    heights[j * (N + 1) + i] = terrainFunction(-HALF + i * STEP, -HALF + j * STEP);
  }
}

// Ground height at any (x, z), smoothly interpolated
export function getHeight(x, z) {
  const fx = Math.min(N - 1e-4, Math.max(0, (x + HALF) / STEP));
  const fz = Math.min(N - 1e-4, Math.max(0, (z + HALF) / STEP));
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const r = N + 1;
  const a = heights[j * r + i], b = heights[j * r + i + 1];
  const c = heights[(j + 1) * r + i], d = heights[(j + 1) * r + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

export function getNormal(x, z, target = new THREE.Vector3()) {
  const e = STEP;
  const hl = getHeight(x - e, z), hr = getHeight(x + e, z);
  const hd = getHeight(x, z - e), hu = getHeight(x, z + e);
  return target.set(hl - hr, 2 * e, hd - hu).normalize();
}

// ---------------------------------------------------------------------------
// Visual mesh
export function createTerrainMesh(sand, quality) {
  const r = N + 1;
  // on low quality, use every other grid point for the visible mesh (physics keeps full detail)
  const step = quality.terrainStep;
  const M = Math.floor(N / step), rr = M + 1;
  const positions = new Float32Array(rr * rr * 3);
  const normals = new Float32Array(rr * rr * 3);
  const uvs = new Float32Array(rr * rr * 2);
  const colors = new Float32Array(rr * rr * 3);
  const surface = new Float32Array(rr * rr * 2); // x: wetness, y: how "sandy" it is

  const c = new THREE.Color();
  const dry = new THREE.Color().setRGB(0.87, 0.77, 0.6, THREE.SRGBColorSpace);
  const dryWarm = new THREE.Color().setRGB(0.84, 0.7, 0.52, THREE.SRGBColorSpace);
  const underwater = new THREE.Color().setRGB(0.66, 0.62, 0.5, THREE.SRGBColorSpace);
  const grass = new THREE.Color().setRGB(0.4, 0.45, 0.22, THREE.SRGBColorSpace);
  const scrub = new THREE.Color().setRGB(0.52, 0.5, 0.33, THREE.SRGBColorSpace);
  const rock = new THREE.Color().setRGB(0.47, 0.43, 0.39, THREE.SRGBColorSpace);
  const rockDark = new THREE.Color().setRGB(0.32, 0.3, 0.28, THREE.SRGBColorSpace);
  const n = new THREE.Vector3();

  for (let J = 0; J <= M; J++) {
    for (let I = 0; I <= M; I++) {
      const i = I * step, j = J * step;
      const k = J * rr + I; // index in the mesh
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      const h = heights[j * r + i];
      positions[k * 3] = x;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z;

      const hl = heights[j * r + Math.max(0, i - 1)], hr = heights[j * r + Math.min(N, i + 1)];
      const hd = heights[Math.max(0, j - 1) * r + i], hu = heights[Math.min(N, j + 1) * r + i];
      n.set(hl - hr, 2 * STEP, hd - hu).normalize();
      normals[k * 3] = n.x;
      normals[k * 3 + 1] = n.y;
      normals[k * 3 + 2] = n.z;

      uvs[k * 2] = x * 0.25;
      uvs[k * 2 + 1] = z * 0.25;

      const u = shoreZ(x) - z; // distance inland
      const slope = 1 - n.y;
      // base sand colour with large patches of variation
      c.copy(dry).lerp(dryWarm, smoothstep(-0.4, 0.6, fbm(nB, x * 0.015, z * 0.015, 3)));
      c.lerp(underwater, smoothstep(0, -3, h));
      let sandy = 1;
      // vegetation inland
      const veg = smoothstep(160, 300, u) * smoothstep(0.35, 0.1, slope);
      const vegNoise = smoothstep(-0.3, 0.4, fbm(nA, x * 0.01, z * 0.01, 3));
      if (veg > 0) {
        c.lerp(scrub, veg * 0.8);
        c.lerp(grass, veg * vegNoise * 0.8);
        sandy -= veg * 0.9;
      }
      // rocks on steep slopes and headlands
      const rockiness = Math.max(
        smoothstep(0.28, 0.5, slope) * smoothstep(20, 60, u + Math.abs(x) * 0.2),
        smoothstep(480, 640, Math.abs(x)) * smoothstep(1.5, 5, h) * smoothstep(0.08, 0.25, slope)
      );
      if (rockiness > 0) {
        c.lerp(rock, rockiness);
        c.lerp(rockDark, rockiness * smoothstep(0.4, 0.8, slope) * 0.7);
        sandy -= rockiness;
      }
      colors[k * 3] = c.r;
      colors[k * 3 + 1] = c.g;
      colors[k * 3 + 2] = c.b;

      // wet sand near the water line
      surface[k * 2] = 1 - smoothstep(0.1, 0.9, h);
      surface[k * 2 + 1] = Math.max(0, sandy);
    }
  }

  const indices = new Uint32Array(M * M * 6);
  let p = 0;
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const a = j * rr + i, b = a + 1, cc = a + rr, d = cc + 1;
      indices.set([a, cc, b, b, cc, d], p);
      p += 6;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('surface', new THREE.BufferAttribute(surface, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();

  const material = createSandMaterial(sand, quality.sandDetail);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Triangle data for the physics engine (only the drivable part, to save memory)
export function createPhysicsMeshData() {
  const margin = 80;
  const i0 = Math.max(0, Math.floor((TERRAIN.play.minX - margin + HALF) / STEP));
  const i1 = Math.min(N, Math.ceil((TERRAIN.play.maxX + margin + HALF) / STEP));
  const j0 = Math.max(0, Math.floor((TERRAIN.play.minZ - margin + HALF) / STEP));
  const j1 = Math.min(N, Math.ceil((TERRAIN.play.maxZ + margin + HALF) / STEP));
  const w = i1 - i0 + 1, hgt = j1 - j0 + 1;
  const vertices = new Float32Array(w * hgt * 3);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = (j - j0) * w + (i - i0);
      vertices[k * 3] = -HALF + i * STEP;
      vertices[k * 3 + 1] = heights[j * (N + 1) + i];
      vertices[k * 3 + 2] = -HALF + j * STEP;
    }
  }
  const indices = new Uint32Array((w - 1) * (hgt - 1) * 6);
  let p = 0;
  for (let j = 0; j < hgt - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      indices[p++] = a; indices[p++] = c; indices[p++] = b;
      indices[p++] = b; indices[p++] = c; indices[p++] = d;
    }
  }
  return { vertices, indices };
}

// Height map texture for the water shader (so it knows how deep the water is)
export function createHeightTexture(size = 1024) {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[y * size + x] = getHeight(-HALF + (x / (size - 1)) * S, -HALF + (y / (size - 1)) * S);
    }
  }
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(half, size, size, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Sand made from photo-scanned textures. Each texture is sampled twice at different
// sizes and angles and blended with large, slow noise so you can't see it repeat.
function createSandMaterial(sand, detail) {
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
