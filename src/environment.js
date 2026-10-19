// Sky, sun, lighting and reflections
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const SUN = {
  elevation: 24, // degrees above the horizon (try 4 for a sunset!)
  azimuth: -35,  // degrees around
};

export function createEnvironment(renderer, scene, hdr, quality) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN.elevation),
    THREE.MathUtils.degToRad(SUN.azimuth)
  );

  const sky = new Sky();
  // the sun disc is extremely bright; clamp it so it can't overflow the HDR buffers (would break the bloom)
  // Also guard against NaN: right at the horizon the cloud layer divides by ~0, and a single
  // NaN pixel gets smeared over the whole screen by the bloom pass (a full-screen flash).
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('direction.xz / ( direction.y * elevation )', 'direction.xz / max( direction.y * elevation, 0.002 )')
    .replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      // bit test instead of isnan(): compilers are allowed to optimize isnan() away
      `if ( any( equal( floatBitsToUint( texColor ) & 0x7f800000u, uvec3( 0x7f800000u ) ) ) ) texColor = vec3( 0.5, 0.6, 0.7 );
      gl_FragColor = vec4( min( texColor, vec3( 25.0 ) ), 1.0 );`
    );
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Render the sky alone into a cube map (for water reflections)
  // and a pre-filtered environment map (for shiny paint and chrome).
  const skyScene = new THREE.Scene();
  const skyClone = new Sky();
  skyClone.scale.setScalar(1000);
  skyClone.material = sky.material;
  skyScene.add(skyClone);

  const cubeTarget = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCamera = new THREE.CubeCamera(1, 5000, cubeTarget);
  cubeCamera.update(renderer, skyScene);

  const pmrem = new THREE.PMREMGenerator(renderer);
  // Image-based lighting from a real photographed beach sky (Poly Haven, CC0):
  // gives the paint, chrome and rocks realistic reflections and soft fill light.
  const envRT = hdr ? pmrem.fromEquirectangular(hdr) : pmrem.fromScene(skyScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = hdr ? 0.55 : 0.12;
  pmrem.dispose();

  // Sunlight: warm, with soft shadows that follow the buggy
  const sunColor = new THREE.Color().setRGB(1.0, 0.92, 0.8);
  const sun = new THREE.DirectionalLight(sunColor, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const sc = sun.shadow.camera;
  sc.left = -quality.shadowRange;
  sc.right = quality.shadowRange;
  sc.top = quality.shadowRange;
  sc.bottom = -quality.shadowRange;
  sc.near = 1;
  sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0xd8c09a, hdr ? 0.15 : 0.6);
  scene.add(hemi);

  // Haze in the distance that matches the sky near the horizon
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.62, 0.74, 0.86), 0.00042);

  const followTarget = new THREE.Vector3();
  function update(focus) {
    // move the shadow camera with the player, snapped to shadow-map texels to avoid shimmering
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    followTarget.set(
      Math.round(focus.x / texel) * texel,
      focus.y,
      Math.round(focus.z / texel) * texel
    );
    sun.target.position.copy(followTarget);
    sun.position.copy(followTarget).addScaledVector(sunDir, 300);
  }

  return { sky, sun, sunDir, sunColor, envCube: cubeTarget.texture, update };
}
