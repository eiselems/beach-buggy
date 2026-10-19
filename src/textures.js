// All textures are generated in code, so the game needs no image files.
import * as THREE from 'three';
import { createTileableNoise, mulberry32 } from './noise.js';

function dataTexture(data, size, colorSpace = THREE.NoColorSpace) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Turn a wrapping height field into a tangent-space normal map
function heightToNormalMap(height, size, strength) {
  const data = new Uint8Array(size * size * 4);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

// Wind ripples + sand grains
export function createSandNormalTexture(size = 512) {
  const warpA = createTileableNoise(3, 4);
  const warpB = createTileableNoise(5, 12);
  const grain = createTileableNoise(9, 128);
  const rnd = mulberry32(77);
  const RIPPLES = 16;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const warp = 0.9 * warpA(u * 4, v * 4) + 0.25 * warpB(u * 12, v * 12);
      const phase = (v + warp * 0.18) * RIPPLES + warp * 2.0;
      const s = Math.sin(phase * Math.PI * 2);
      // asymmetric ripple profile: gentle windward side, sharper lee side
      const ripple = Math.pow((s + 1) * 0.5, 1.6);
      height[y * size + x] = ripple * 0.9 + grain(u * 128, v * 128) * 0.25 + rnd() * 0.12;
    }
  }
  return dataTexture(heightToNormalMap(height, size, 2.2), size);
}

// R: fine speckle, G: medium blotches (used as a second, larger tiling layer)
export function createSandDetailTexture(size = 512) {
  const fine = createTileableNoise(13, 96);
  const mid = createTileableNoise(17, 16);
  const big = createTileableNoise(19, 4);
  const rnd = mulberry32(5);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const speck = 0.78 + 0.22 * fine(u * 96, v * 96) + (rnd() - 0.5) * 0.18;
      const dark = rnd() < 0.015 ? 0.55 : 1.0; // occasional darker grains / shell bits
      const light = rnd() < 0.01 ? 1.25 : 1.0;
      const blot = 0.65 * mid(u * 16, v * 16) + 0.35 * big(u * 4, v * 4);
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, speck * dark * light * 220);
      data[i + 1] = blot * 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size);
}

// Small choppy waves for the ocean surface
export function createWaterNormalTexture(size = 512) {
  const layers = [
    [createTileableNoise(31, 8), 8, 1.0],
    [createTileableNoise(37, 16), 16, 0.5],
    [createTileableNoise(41, 32), 32, 0.25],
    [createTileableNoise(43, 64), 64, 0.12],
  ];
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let h = 0;
      for (const [n, f, a] of layers) {
        // ridged noise gives sharper wave crests
        h += (1 - Math.abs(n(u * f, v * f) * 2 - 1)) * a;
      }
      height[y * size + x] = h;
    }
  }
  return dataTexture(heightToNormalMap(height, size, 3.0), size);
}

// Foam pattern: bubbly cells
export function createFoamTexture(size = 256) {
  const a = createTileableNoise(51, 24);
  const b = createTileableNoise(53, 48);
  const c = createTileableNoise(59, 8);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const cells = Math.abs(a(u * 24, v * 24) - 0.5) * 2;
      const bubbles = Math.abs(b(u * 48, v * 48) - 0.5) * 2;
      let f = (1 - cells) * 0.6 + (1 - bubbles) * 0.4;
      f = f * (0.5 + c(u * 8, v * 8));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, f * 255);
      data[i + 3] = 255;
    }
  }
  return dataTexture(data, size);
}
