// The shape of the (endless) world, as pure math so it can run in web workers.
// The sea is towards +Z, the land towards -Z. Water level is y = 0.
// The coastline runs forever along X; inland the dunes turn into hills and mountains.
import { createNoise2D, fbm, smoothstep, lerp } from './noise.js';

const nA = createNoise2D(11);
const nB = createNoise2D(23);
const nC = createNoise2D(37);
const nD = createNoise2D(51);
const nE = createNoise2D(73);

// The coastline is a sum of waves, from huge bays to small wiggles: [height, frequency, phase].
// The ocean shader uses the same numbers to know how deep the water is.
export const SHORE_WAVES = [
  [150, 0.00061, 0.4],
  [70, 0.0017, 2.2],
  [38, 0.0045, 0.6],
  [16, 0.012, 1.3],
  [5, 0.033, 2.1],
];
// Rocky headlands poke out every few kilometres: [weight, frequency, phase]
export const HEAD_WAVES = [
  [0.6, 0.0019, 4.1],
  [0.4, 0.0051, 0.7],
];
export const HEAD_RANGE = [0.45, 0.8];

export function shoreZ(x) {
  let s = 0;
  for (const [a, f, p] of SHORE_WAVES) s += a * Math.sin(x * f + p);
  return s;
}

// 0..1: how much of a rocky headland there is at this x
// the raw headland wave (before smoothstep): lighthouses go where it peaks
export function headlandWave(x) {
  let s = 0;
  for (const [a, f, p] of HEAD_WAVES) s += a * Math.sin(x * f + p);
  return s;
}

export function headlandAt(x) {
  let s = 0;
  for (const [a, f, p] of HEAD_WAVES) s += a * Math.sin(x * f + p);
  return smoothstep(HEAD_RANGE[0], HEAD_RANGE[1], s);
}

// Sea floor `d` meters out from the waterline: gentle slope with a sandbar where waves break
export function seaFloor(d) {
  let h = -0.034 * d - 0.00011 * d * d;
  h += 0.55 * Math.exp(-(((d - 48) / 13) ** 2));
  return Math.max(h, -45);
}

// Beach rising up from the water, `u` meters inland
export function beachRise(u) {
  return 2.6 * (1 - Math.exp(-u / 70)) + 0.01 * u;
}

// The coastal dirt track: winds along behind the beach, through the dunes
export function trackU(x) {
  return 150 + 45 * Math.sin(x * 0.0031 + 1) + 20 * Math.sin(x * 0.011 + 0.4);
}
// 1 on the track, fading to 0 at its edges (`wide` adds the graded shoulders)
export function trackAt(x, z, wide = 0) {
  if (headlandAt(x) > 0.3) return 0; // the track goes round the rocky headlands... by stopping there
  const off = Math.abs(shoreZ(x) - z - trackU(x));
  return 1 - smoothstep(4 + wide, 7 + wide * 2.5, off);
}

// The height of the ground at any point. Change this to reshape the world!
export function terrainFunction(x, z) {
  const d = z - shoreZ(x); // distance out to sea (negative = on land)
  const u = -d;            // distance inland
  let h;
  if (d > 0) {
    h = seaFloor(d);
  } else {
    h = beachRise(u);
    // sand dunes behind the beach; some stretches of coast have much bigger dunes
    const duneAmp = 0.55 + 0.9 * smoothstep(-0.4, 0.6, nE(x * 0.0007, 3.7));
    const duneMask = smoothstep(55, 125, u) * (1 - 0.5 * smoothstep(260, 340, u));
    if (duneMask > 0) {
      // rounded crests (a plain abs() makes knife-edge ridges that launch the buggy into the air)
      const n = nA(x * 0.006, u * 0.011);
      const ridge = 1.2 - Math.sqrt(n * n + 0.06);
      h += duneMask * duneAmp * (ridge * ridge * 7 + fbm(nB, x * 0.012, z * 0.012, 3) * 2.5);
    }
    // grassy hills further inland
    const hills = smoothstep(220, 480, u);
    if (hills > 0) h += hills * (18 + 14 * fbm(nC, x * 0.004, z * 0.004, 4));
    h += smoothstep(480, 760, u) * 55;
    // mountain ranges far inland, with valleys you can drive through
    const mtn = smoothstep(650, 1500, u);
    if (mtn > 0) {
      const r = 1 - Math.abs(fbm(nD, x * 0.0011, z * 0.0011, 4));
      h += mtn * (150 * r * r * r + 30 * fbm(nB, x * 0.003, z * 0.003, 3));
    }
    // the track is graded flat through the dunes, with sloped shoulders
    const track = trackAt(x, z, 8);
    if (track > 0) h = lerp(h, beachRise(u) + 0.3 * smoothstep(220, 480, u) * 18, track);
    // small bumps you feel while driving
    h += 0.07 * nC(x * 0.06, z * 0.06) * smoothstep(-2, 8, u);
  }
  // rocky headlands
  const head = headlandAt(x) * smoothstep(300, 60, d);
  if (head > 0) {
    const cliff = 26 + 12 * fbm(nB, x * 0.01, z * 0.01, 4) + 3 * fbm(nA, x * 0.05, z * 0.05, 3);
    h = lerp(h, Math.max(h, cliff), head);
  }
  return h;
}

// ---------------------------------------------------------------------------
// What the ground looks like: colour (linear RGB), wetness and how sandy it is.
const srgb = (r, g, b) => [r, g, b].map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
const DRY = srgb(0.87, 0.77, 0.6);
const DRY_WARM = srgb(0.84, 0.7, 0.52);
const UNDERWATER = srgb(0.66, 0.62, 0.5);
const GRASS = srgb(0.4, 0.45, 0.22);
const SCRUB = srgb(0.52, 0.5, 0.33);
const ROCK = srgb(0.47, 0.43, 0.39);
const ROCK_DARK = srgb(0.32, 0.3, 0.28);
const DIRT = srgb(0.6, 0.48, 0.34);
const DIRT_DARK = srgb(0.42, 0.33, 0.24);
const mixInto = (c, t, k) => {
  c[0] += (t[0] - c[0]) * k;
  c[1] += (t[1] - c[1]) * k;
  c[2] += (t[2] - c[2]) * k;
};

// out: [r, g, b, wet, sandy, rocky]; ny = the y part of the ground normal
export function surfaceAt(x, z, h, ny, out) {
  const u = shoreZ(x) - z;
  const slope = 1 - ny;
  const c = [DRY[0], DRY[1], DRY[2]];
  mixInto(c, DRY_WARM, smoothstep(-0.4, 0.6, fbm(nB, x * 0.015, z * 0.015, 3)));
  mixInto(c, UNDERWATER, smoothstep(0, -3, h));
  let sandy = 1;
  let rocky = 0;
  const veg = smoothstep(160, 300, u) * smoothstep(0.35, 0.1, slope);
  if (veg > 0) {
    const vegNoise = smoothstep(-0.3, 0.4, fbm(nA, x * 0.01, z * 0.01, 3));
    mixInto(c, SCRUB, veg * 0.8);
    mixInto(c, GRASS, veg * vegNoise * 0.8);
    sandy -= veg * 0.9;
  }
  const rockiness = Math.max(
    smoothstep(0.28, 0.5, slope) * smoothstep(20, 60, u),
    headlandAt(x) * smoothstep(1.5, 5, h) * smoothstep(0.08, 0.25, slope),
    smoothstep(0.2, 0.45, slope) * smoothstep(700, 1100, u)
  );
  if (rockiness > 0) {
    mixInto(c, ROCK, rockiness);
    mixInto(c, ROCK_DARK, rockiness * smoothstep(0.4, 0.8, slope) * 0.7);
    sandy -= rockiness;
    rocky = rockiness;
  }
  // packed dirt on the track, with darker wheel ruts
  const track = trackAt(x, z);
  if (track > 0) {
    const off = Math.abs(shoreZ(x) - z - trackU(x));
    const rut = Math.exp(-(((off - 1.6) / 0.6) ** 2)) * 0.5;
    mixInto(c, DIRT, track * 0.85);
    mixInto(c, DIRT_DARK, track * rut);
  }
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
  out[3] = 1 - smoothstep(0.1, 0.9, h);
  out[4] = Math.max(0, sandy);
  out[5] = Math.min(1, rocky);
  return out;
}
