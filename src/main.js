import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { N8AOPass } from 'n8ao';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Replaces any NaN/Infinity pixel before the bloom pass. Without this, one broken pixel
// gets blurred over the whole screen by the bloom and the frame flashes black.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bvec4 bad = equal(floatBitsToUint(c) & 0x7f800000u, uvec4(0x7f800000u));
      if (any(bad)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = min(c, vec4(500.0));
    }`,
};

import { WorkerPool, TerrainLOD, PhysicsTerrain, createSandMaterial, getHeight, shoreZ } from './terrain.js';
import { createEnvironment } from './environment.js';

// Final touch after tone mapping: a little extra colour and contrast, a soft vignette,
// and a radial blur at the screen edges when you go really fast (speed sensation).
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uBlur;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float edge = smoothstep(0.15, 0.75, length(d * vec2(1.6, 1.0)));
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uBlur > 0.001) {
        vec3 acc = c;
        for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, vUv - d * float(i) * 0.012 * uBlur * edge).rgb;
        c = acc / 8.0;
      }
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);                 // saturation
      c = (c - 0.5) * 1.05 + 0.5;                // contrast
      c *= 1.0 - 0.28 * edge * edge;             // vignette
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
import { loadAssets } from './assets.js';
import { QUALITY } from './quality.js';
import { createOcean } from './ocean.js';
import { loadBuggy, BUGGY_CREDIT } from './buggy.js';
import { Vehicle } from './vehicle.js';
import { PropSystem, SPAWN } from './props.js';
import { BoostSystem, ExhaustFlames } from './boost.js';
import { Skills } from './skills.js';
import { TireTracks, Particles, emitWheelEffects } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function step(label, fn) {
  $('loading-text').textContent = label;
  await nextFrame();
  return fn();
}

async function main() {
  await step('Starting physics…', () => RAPIER.init());

  // --- renderer
  // with post-processing the composer does the anti-aliasing; without it, the GPU's built-in MSAA
  // (almost free on phone GPUs) does
  const renderer = new THREE.WebGLRenderer({ antialias: !QUALITY.postProcessing, powerPreference: 'high-performance' });
  const maxPixelRatio = Math.min(window.devicePixelRatio, QUALITY.maxPixelRatio);
  let pixelRatio = QUALITY.postProcessing ? maxPixelRatio : Math.min(1, maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.15, 12000);

  $('loading-text').textContent = 'Loading sand, rocks and sky… 0%';
  const assets = await loadAssets(renderer, (f) => ($('loading-text').textContent = `Loading sand, rocks and sky… ${Math.round(f * 100)}%`));

  const env = await step('Painting the sky…', () => createEnvironment(renderer, scene, assets.hdr, QUALITY));

  const ocean = await step('Filling the ocean…', () =>
    createOcean({ envMap: env.envCube, sunDir: env.sunDir, sunColor: env.sunColor, normalTexture: assets.waterNormals, segments: QUALITY.oceanSegments })
  );
  scene.add(ocean);

  // --- the endless world: built around the player by background workers
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  const pool = new WorkerPool(Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
  const terrain = new TerrainLOD(scene, createSandMaterial(assets.sand, QUALITY.sandDetail), pool, QUALITY);
  const physTerrain = new PhysicsTerrain(world, pool);
  const boost = new BoostSystem(scene, getHeight);
  const props = new PropSystem(scene, world, pool, assets, QUALITY, boost);

  const spawnPoint = new THREE.Vector3(SPAWN.x, getHeight(SPAWN.x, SPAWN.z) + 2, SPAWN.z);
  camera.position.copy(spawnPoint).add(new THREE.Vector3(0, 3, -8));
  // build the world around the start before the player sees it
  for (let i = 0; ; i++) {
    terrain.update(spawnPoint, true);
    physTerrain.update([spawnPoint]);
    props.update(0, camera, spawnPoint);
    const done = terrain.progress() >= 1 && physTerrain.readyAt([spawnPoint]) && pool.busy === 0;
    $('loading-text').textContent = `Building the island… ${Math.round(terrain.progress() * 100)}%`;
    if (done && i > 20) break;
    await new Promise((r) => setTimeout(r, 30));
  }

  const buggy = await step('Fueling up the buggy…', () => loadBuggy());
  scene.add(buggy.root);
  const start = { x: SPAWN.x, z: SPAWN.z, yaw: Math.PI / 2 };
  const vehicle = new Vehicle(world, start.x, start.z, start.yaw, buggy);
  // twin exhaust pipes at the back (positions measured on the model)
  const flames = new ExhaustFlames(buggy.root, [new THREE.Vector3(-0.08, 0.35, -1.85), new THREE.Vector3(-0.24, 0.35, -1.85)]);

  const tracks = new TireTracks(scene);
  const particles = new Particles(scene, QUALITY.particles);
  const audio = new GameAudio();
  const input = new Input();
  const rig = new CameraRig(camera, renderer.domElement, { world, RAPIER, body: vehicle.body });

  // --- post-processing (high quality only): anti-aliasing (MSAA), a soft glow on bright highlights
  let composer = null, bloom = null, finish = null;
  if (QUALITY.postProcessing) {
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    // ambient occlusion: soft contact shadows where things meet the sand (under the buggy, rocks, palms)
    const useAO = new URLSearchParams(location.search).get('ao') !== '0';
    const ao = new N8AOPass(scene, camera, window.innerWidth, window.innerHeight);
    ao.configuration.aoRadius = 1.6;
    ao.configuration.distanceFalloff = 0.6;
    ao.configuration.intensity = 2.2;
    ao.configuration.halfRes = true;
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode('Medium');
    composer.addPass(useAO ? ao : new RenderPass(scene, camera));
    composer.addPass(new ShaderPass(SanitizeShader));
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.12, 0.3, 7.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    finish = new ShaderPass(FinishShader);
    composer.addPass(finish);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h);
    if (composer) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    }
    particles.setViewport(h * renderer.getPixelRatio(), camera.fov);
  }

  // Dynamic resolution: if the frame rate drops, render fewer pixels; if there's headroom, more.
  let perfFrames = 0, perfTime = 0, perfCooldown = 3;
  function adaptResolution(dt) {
    perfFrames++;
    perfTime += dt;
    if (perfTime < 1) return;
    const fps = perfFrames / perfTime;
    $('fps').textContent = `${Math.round(fps)} fps · ${QUALITY.name} · ${Math.round(pixelRatio * 100)}% res`;
    perfFrames = 0;
    perfTime = 0;
    if (perfCooldown > 0) return void perfCooldown--; // skip the first seconds (shader warm-up)
    let next = pixelRatio;
    if (fps < 45) next = Math.max(0.5, pixelRatio * 0.85);
    else if (fps > 57) next = Math.min(maxPixelRatio, pixelRatio + 0.05);
    if (Math.abs(next - pixelRatio) > 0.01) {
      pixelRatio = next;
      resize();
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // Compile shaders up front so the first frames do not stutter
  await step('Warming up…', () => renderer.compile(scene, camera));

  // --- HUD
  const hud = { speed: $('speed'), gear: $('gear'), toast: $('toast'), needle: $('needle'), boost: $('boost'), boostNum: $('boost-num'), speedlines: $('speedlines') };
  let toastTimer = 0;
  const skills = new Skills({ chain: $('chain'), chainScore: $('chain-score'), chainMult: $('chain-mult'), chainBar: $('chain-bar'), feed: $('feed'), total: $('total') });
  let lastKmh = 0, wasAirborne = false, fallSpeed = 0;
  function toast(text) {
    hud.toast.textContent = text;
    hud.toast.classList.add('show');
    toastTimer = 2.2;
  }

  $('credits').innerHTML = `Buggy: <a href="${BUGGY_CREDIT.url}" target="_blank">${BUGGY_CREDIT.title}</a> by ${BUGGY_CREDIT.author} (${BUGGY_CREDIT.license}) · Palms: <a href="https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3" target="_blank">Coconut Palm</a> by evolveduk · Grass: <a href="https://sketchfab.com/3d-models/dry-grass-d1484537470441b999d37077aeb9b47a" target="_blank">Dry grass</a> by Pixel-bit (CC-BY 4.0) · Sand, rocks &amp; sky: <a href="https://polyhaven.com" target="_blank">Poly Haven</a> (CC0)`;
  $('loading').classList.add('hidden');
  $('start').classList.remove('hidden');
  let running = false;
  const begin = () => {
    if (running) return;
    running = true;
    audio.start();
    $('start').classList.add('hidden');
    $('hud').classList.remove('hidden');
  };
  $('start').addEventListener('click', begin);
  if (new URLSearchParams(location.search).has('autostart')) begin();
  window.addEventListener('keydown', (e) => {
    if (!running && (e.code === 'Enter' || e.code === 'Space')) begin();
  });

  // --- main loop
  const timer = new THREE.Timer();
  const DT = world.timestep;
  let acc = 0;
  let time = 0;
  let upsideDownTime = 0;
  let deepTime = 0;
  let boostPower = 0;
  const ahead = new THREE.Vector3();
  const prevPos = new THREE.Vector3(), curPos = new THREE.Vector3();
  const prevRot = new THREE.Quaternion(), curRot = new THREE.Quaternion();
  const right = new THREE.Vector3(), forward = new THREE.Vector3();
  const copyBody = (p, q) => {
    const t = vehicle.body.translation(), r = vehicle.body.rotation();
    p.set(t.x, t.y, t.z);
    q.set(r.x, r.y, r.z, r.w);
  };
  copyBody(curPos, curRot);
  prevPos.copy(curPos);
  prevRot.copy(curRot);

  // let the buggy settle on its suspension before the player sees it
  for (let i = 0; i < 120; i++) {
    vehicle.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: 0 });
    world.step();
  }
  copyBody(curPos, curRot);
  prevPos.copy(curPos);
  prevRot.copy(curRot);

  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    time += dt;
    const controls = running ? input.read() : { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: 0 };

    // keep solid ground under the buggy and where it is heading
    const bp = vehicle.body.translation(), bv = vehicle.body.linvel();
    ahead.set(bp.x + bv.x * 2.5, bp.y, bp.z + bv.z * 2.5);
    physTerrain.update([bp, ahead]);

    boostPower = boost.update(dt, controls.boost > 0.5, bp);
    controls.boost = boostPower;
    while (boost.pickups.length) {
      const big = boost.pickups.pop();
      audio.pickup(big);
      hud.boost.classList.remove('flash');
      void hud.boost.offsetWidth;
      hud.boost.classList.add('flash');
      if (big) toast('Full boost!');
    }

    if (controls.reset) {
      vehicle.reset();
      toast('Reset!');
    }
    if (controls.camera) toast(rig.next());
    if (controls.mute) toast(audio.toggleMute() ? 'Sound off' : 'Sound on');

    // fixed-step physics for stable driving
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 10) {
      copyBody(prevPos, prevRot);
      vehicle.step(DT, controls);
      world.step();
      acc -= DT;
      steps++;
    }
    copyBody(curPos, curRot);
    const alpha = acc / DT;
    buggy.root.position.lerpVectors(prevPos, curPos, alpha);
    buggy.root.quaternion.slerpQuaternions(prevRot, curRot, alpha);
    buggy.update(vehicle.state, time, Math.abs(vehicle.speed));
    buggy.setHelmetCam(rig.mode === 2);

    // effects
    right.set(1, 0, 0).applyQuaternion(buggy.root.quaternion);
    forward.set(0, 0, 1).applyQuaternion(buggy.root.quaternion);
    for (let i = 0; i < 4; i++) tracks.add(i, vehicle.state.contact[i], vehicle.state.contactPoint[i], right, vehicle.wheels[i].width * 0.9);
    tracks.update(dt);
    emitWheelEffects(particles, vehicle, forward, dt, time);
    particles.update(dt);

    flames.update(dt, boostPower > 0, time);
    if (boostPower > 0 && Math.random() < dt * 60) {
      // smoke puffs out of the pipes
      const p = flames.flames[0].getWorldPosition(ahead);
      particles.emit(p.x, p.y, p.z, -forward.x * 4 + (Math.random() - 0.5), 0.6, -forward.z * 4 + (Math.random() - 0.5),
        { size: 0.25, grow: 1.4, life: 0.9, alpha: 0.18, color: [0.55, 0.5, 0.48], gravity: -0.05, drag: 2 });
    }

    // too deep in the sea: put the buggy back on the beach
    deepTime = vehicle.state.inWater > 1.1 ? deepTime + dt : 0;
    if (deepTime > 0.6) {
      const x = bp.x;
      vehicle.place(x, shoreZ(x) - 22, Math.atan2(bv.x, bv.z) > 0 ? Math.PI / 2 : -Math.PI / 2);
      toast('Too deep! Back to the beach');
      deepTime = 0;
    }

    // landings and crashes
    if (vehicle.state.airborne) fallSpeed = -bv.y;
    else if (wasAirborne && fallSpeed > 3) audio.thump(fallSpeed);
    wasAirborne = vehicle.state.airborne;
    const kmhNow = Math.abs(vehicle.speed) * 3.6;
    const crashed = lastKmh - kmhNow > 25 * dt * 60 * 0.2 && lastKmh > 40 && controls.brake < 0.1 && !controls.handbrake;
    lastKmh = kmhNow;

    // flipped over? offer a reset
    upsideDownTime = vehicle.state.upsideDown && Math.abs(vehicle.speed) < 2 ? upsideDownTime + dt : 0;
    if (upsideDownTime > 2) {
      toast('Upside down! Press R to flip back');
      upsideDownTime = -3;
    }

    const lv = vehicle.body.linvel();
    rig.update(dt, buggy.root.position, buggy.root.quaternion, lv, Math.abs(vehicle.speed), boostPower, vehicle.state.airborne);
    env.update(buggy.root.position);
    ocean.update(time, camera.position);
    terrain.update(camera.position);
    props.update(time, camera, buggy.root.position, dt, lv);

    for (const hit of props.trapHits) {
      skills.award('SPEED TRAP', hit.kmh * 6);
      toast(`📸 Speed trap: ${Math.round(hit.kmh)} km/h${hit.best ? ' — new best!' : ''}`);
    }
    skills.update(dt, vehicle, { smashed: props.smashed, crashed: crashed || controls.reset });
    const slip = vehicle.state.slip.reduce((a, b) => a + b, 0) / 4;
    audio.update(dt, {
      speed: vehicle.speed,
      throttle: Math.max(controls.throttle, controls.brake * (vehicle.speed < 1 ? 1 : 0)),
      slip,
      airborne: vehicle.state.airborne,
      shoreDistance: Math.abs(camera.position.z - shoreZ(camera.position.x)),
      water: vehicle.state.inWater,
      horn: controls.horn,
      time,
      boost: boostPower,
    });

    // HUD
    const kmh = Math.abs(vehicle.speed) * 3.6;
    hud.speed.textContent = Math.round(kmh);
    hud.gear.textContent = vehicle.speed < -0.5 ? 'R' : audio.gear;
    hud.boostNum.textContent = Math.floor(boost.amount);
    hud.boost.style.setProperty('--b', (boost.amount / 100).toFixed(3));
    hud.boost.classList.toggle('on', boostPower > 0);
    hud.speedlines.classList.toggle('on', boostPower > 0 && kmh > 60);
    hud.needle.style.transform = `rotate(${-120 + Math.min(audio.rpm / 7000, 1) * 240}deg)`;
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) hud.toast.classList.remove('show');
    }

    if (finish) {
      const fast = Math.max(boostPower, Math.min(1, Math.max(0, (Math.abs(vehicle.speed) - 30) / 15)));
      finish.uniforms.uBlur.value += (fast - finish.uniforms.uBlur.value) * Math.min(1, dt * 4);
    }
    if (composer) composer.render();
    else renderer.render(scene, camera);
    adaptResolution(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // handy for experimenting in the browser console
  window.game = { scene, camera, renderer, composer, bloom, vehicle, buggy, rig, world, tracks, RAPIER, QUALITY, terrain, physTerrain, props, boost, pool, input, getPixelRatio: () => pixelRatio };
}

main().catch((err) => {
  console.error(err);
  $('loading-text').textContent = 'Something went wrong: ' + err.message;
});
