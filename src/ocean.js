// The ocean: rolling Gerstner waves, sky reflections, sun glitter,
// see-through shallow water and foam where waves break on the beach.
import * as THREE from 'three';
import { TERRAIN } from './terrain.js';
import { createWaterNormalTexture, createFoamTexture } from './textures.js';

// Each wave: direction (x, z), wavelength in meters, height in meters
const WAVES = [
  { dir: [0.15, -1], length: 62, amp: 0.42 },
  { dir: [-0.35, -1], length: 37, amp: 0.24 },
  { dir: [0.6, -0.8], length: 19, amp: 0.11 },
  { dir: [-0.7, -0.65], length: 11, amp: 0.06 },
  { dir: [0.1, -1], length: 6.5, amp: 0.035 },
];

// Water level rises and falls a little along the beach (swash)
export function swashAt(x, t) {
  return 0.16 * Math.sin(t * 0.45 + x * 0.01) + 0.07 * Math.sin(t * 1.1 + x * 0.023 + 1.0);
}

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform sampler2D uHeight;
  uniform float uTerrainSize;
  uniform float uHeightRes;
  uniform vec4 uWaves[${WAVES.length}];   // dir.xy, k, amplitude
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;

  float terrainH(vec2 xz) {
    vec2 uv = ((xz + uTerrainSize * 0.5) / uTerrainSize * (uHeightRes - 1.0) + 0.5) / uHeightRes;
    return texture2D(uHeight, uv).r;
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vec2 xz = p.xz;
    float ground = terrainH(xz);
    float depth = max(-ground, 0.0);
    // waves get smaller as the water gets shallow
    float att = smoothstep(0.0, 6.0, depth) * 0.85 + 0.15 * smoothstep(0.0, 1.5, depth);

    vec3 offset = vec3(0.0);
    vec3 n = vec3(0.0, 1.0, 0.0);
    float crest = 0.0;
    float total = 0.0;
    for (int i = 0; i < ${WAVES.length}; i++) {
      vec2 d = uWaves[i].xy;
      float k = uWaves[i].z;
      float a = uWaves[i].w * att;
      float w = sqrt(9.81 * k);
      float f = k * dot(d, xz) - w * uTime;
      float chop = 1.6;
      offset.xz += d * (chop * a * cos(f));
      offset.y += a * sin(f);
      n.xz -= d * (k * a * cos(f));
      n.y -= chop * k * a * sin(f);
      crest += a * sin(f);
      total += uWaves[i].w;
    }
    // swash: water creeps up and down the beach
    offset.y += 0.16 * sin(uTime * 0.45 + xz.x * 0.01) + 0.07 * sin(uTime * 1.1 + xz.x * 0.023 + 1.0);

    p += offset;
    vWorldPos = p;
    vNormal = normalize(n);
    vCrest = crest / total;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform sampler2D uHeight;
  uniform sampler2D uNormalTex;
  uniform sampler2D uFoamTex;
  uniform samplerCube uEnv;
  uniform float uTerrainSize;
  uniform float uHeightRes;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uLight;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;

  float terrainH(vec2 xz) {
    vec2 uv = ((xz + uTerrainSize * 0.5) / uTerrainSize * (uHeightRes - 1.0) + 0.5) / uHeightRes;
    return texture2D(uHeight, uv).r;
  }

  void main() {
    float ground = terrainH(vWorldPos.xz);
    float depth = vWorldPos.y - ground;
    float still = -ground; // depth at calm water level

    vec3 toCam = cameraPosition - vWorldPos;
    float dist = length(toCam);
    vec3 V = toCam / dist;

    // small ripples from scrolling normal maps
    vec2 p = vWorldPos.xz;
    vec3 n1 = texture2D(uNormalTex, p * 0.031 + vec2(0.0, uTime * 0.025)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormalTex, p * 0.083 + vec2(uTime * 0.018, uTime * 0.04)).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(uNormalTex, p * 0.0093 + vec2(-uTime * 0.006, uTime * 0.01)).xyz * 2.0 - 1.0;
    vec2 detail = n1.xy + n2.xy * 0.6 + n3.xy * 0.9;
    float strength = mix(0.32, 0.07, smoothstep(20.0, 700.0, dist));
    vec3 N = normalize(vec3(vNormal.x + detail.x * strength, vNormal.y, vNormal.z + detail.y * strength));

    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = textureCube(uEnv, R).rgb;

    // sun glitter
    float sd = max(dot(R, uSunDir), 0.0);
    vec3 spec = uSunColor * (pow(sd, 1200.0) * 40.0 + pow(sd, 160.0) * 1.2);

    // colour of the water itself: turquoise when shallow, dark blue when deep
    float depthMix = 1.0 - exp(-max(depth, 0.0) * 0.22);
    vec3 body = mix(uShallow, uDeep, depthMix);
    float sunUp = clamp(uSunDir.y * 2.0, 0.2, 1.0);
    // light shining through the wave crests
    float sss = smoothstep(0.1, 0.9, vCrest) * pow(1.0 - NdV, 2.0) * max(dot(-V.xz, uSunDir.xz), 0.0);
    body += uShallow * sss * 0.8;
    body *= uLight * (0.55 + 0.45 * max(dot(N, uSunDir), 0.0)) * sunUp;

    vec3 col = mix(body, sky, fresnel) + spec;

    // foam
    float fa = texture2D(uFoamTex, p * 0.11 + vec2(0.0, uTime * 0.03)).r;
    float fb = texture2D(uFoamTex, p * 0.043 - vec2(uTime * 0.012, uTime * 0.02)).r;
    float ft = fa * fb * 2.2;
    // a thin line of foam right at the water's edge, plus lacy left-over foam in the swash
    float shore = 1.0 - smoothstep(0.0, 0.1, depth);
    float fl = texture2D(uFoamTex, p * 0.37 + vec2(uTime * 0.02, 0.0)).r * texture2D(uFoamTex, p * 0.15 - vec2(0.0, uTime * 0.03)).r * 2.0;
    float lace = smoothstep(0.55, 0.8, fl) * (1.0 - smoothstep(0.04, 0.3, depth)) * 0.75;
    // breaking waves: thin lines of foam rolling in towards the beach, streaked along the shore
    float streak = texture2D(uFoamTex, p * vec2(0.035, 0.22) + vec2(uTime * 0.01, 0.0)).r;
    float wave = sin(still * 2.2 + uTime * 1.25 + streak * 1.5 + p.x * 0.012);
    float bandMask = smoothstep(0.15, 0.5, still) * (1.0 - smoothstep(1.2, 2.2, still));
    float bands = smoothstep(0.82, 1.0, wave) * bandMask * smoothstep(0.25, 0.6, streak);
    float whitecaps = smoothstep(0.92, 1.0, vCrest) * 0.35 * smoothstep(0.5, 0.8, fb);
    float foamAmount = clamp(shore + bands + whitecaps, 0.0, 1.0);
    float foam = max(foamAmount * smoothstep(0.35, 0.7, ft + shore * 0.3 + bands * 0.3), lace);
    vec3 foamColor = vec3(0.95) * uLight * (0.6 + 0.4 * max(dot(vNormal, uSunDir), 0.0)) * sunUp;
    col = mix(col, foamColor, foam);

    // shallow water is see-through
    float alpha = 0.28 + 0.72 * smoothstep(0.0, 3.2, depth);
    alpha = max(alpha, fresnel);
    alpha = max(alpha, foam);
    alpha *= smoothstep(0.0, 0.05, depth);

    gl_FragColor = vec4(min(col, vec3(40.0)), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// A grid that is fine near the beach and gets coarser towards the horizon
function createOceanGeometry(segments = 420, inner = 1100, outer = 5000) {
  const map = (t) => Math.sign(t) * (Math.abs(t) * inner + Math.pow(Math.abs(t), 4) * (outer - inner));
  const r = segments + 1;
  const pos = new Float32Array(r * r * 3);
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const k = (j * r + i) * 3;
      pos[k] = map((i / segments) * 2 - 1);
      pos[k + 1] = 0;
      pos[k + 2] = map((j / segments) * 2 - 1);
    }
  }
  const idx = new Uint32Array(segments * segments * 6);
  let p = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * r + i, b = a + 1, c = a + r, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 1.5);
  return geo;
}

export function createOcean({ heightTexture, heightRes, envMap, sunDir, sunColor, normalTexture, segments = 420 }) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uHeight: { value: null },
      uNormalTex: { value: null },
      uFoamTex: { value: null },
      uEnv: { value: null },
      uTerrainSize: { value: TERRAIN.size },
      uHeightRes: { value: heightRes },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(0.004, 0.035, 0.06) },
      uShallow: { value: new THREE.Color(0.03, 0.3, 0.3) },
      uLight: { value: 1.0 },
      uWaves: { value: [] },
    },
  ]);
  // textures must not be cloned by UniformsUtils.merge, so assign afterwards
  uniforms.uHeight.value = heightTexture;
  uniforms.uNormalTex.value = normalTexture || createWaterNormalTexture();
  uniforms.uFoamTex.value = createFoamTexture();
  uniforms.uEnv.value = envMap;
  uniforms.uSunDir.value.copy(sunDir);
  uniforms.uSunColor.value.copy(sunColor);
  uniforms.uWaves.value = WAVES.map((w) => {
    const d = new THREE.Vector2(w.dir[0], w.dir[1]).normalize();
    return new THREE.Vector4(d.x, d.y, (2 * Math.PI) / w.length, w.amp);
  });

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
  });
  const mesh = new THREE.Mesh(createOceanGeometry(segments), material);
  mesh.position.set(0, 0, 300);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.update = (t) => {
    uniforms.uTime.value = t;
  };
  return mesh;
}
