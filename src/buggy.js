// The buggy: "Buggy War Beach" by MoraAzul (Sketchfab, CC-BY 4.0).
// public/models/buggy.glb was prepared from the original download so that the four wheels
// are separate nodes (wheel_FL, wheel_FR, wheel_RL, wheel_RR) we can spin and steer.
// Forward is +Z, up is +Y, left is +X. The model's origin is on the ground between the wheels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BUGGY_CREDIT = {
  title: 'Buggy War Beach',
  author: 'MoraAzul',
  url: 'https://sketchfab.com/3d-models/buggy-war-beach-72063c7c59834894a4f4c95f2b93474e',
  license: 'CC-BY 4.0',
};

// How high the physics body's centre sits above the model's origin (meters)
export const RIDE_HEIGHT = 0.8;

export async function loadBuggy(url = 'models/buggy.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const outline = new THREE.MeshBasicMaterial({ color: 0x050505 });
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // the bare-metal body is a near-perfect mirror out of the box; make it a bit more satin
      const m = o.material;
      if (m.name === 'MTA_Negro') {
        // the black cartoon outline: should be flat black, not a glossy surface that catches the sun
        o.material = outline;
        o.castShadow = false;
      } else if (m.name === 'MTA_NeumaticosyTablero') {
        // tires, rims and dashboard: the rims are mirror chrome in the texture, which reflects the sky
        // through the bolt holes and looks like holes. Make them painted metal and the rubber matte.
        m.metalness = 0.35;
        m.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor = max(roughnessFactor, 0.5);'
          );
        };
      } else if (m.metalness > 0.5 && m.roughness < 0.6) m.roughness = 0.85;
    }
  });

  // the wheels, as found in the model
  const wheels = ['FL', 'FR', 'RL', 'RR'].map((name) => {
    const node = model.getObjectByName('wheel_' + name);
    node.rotation.order = 'YXZ'; // steer first, then roll
    return {
      name,
      node,
      front: name[0] === 'F',
      x: node.position.x,
      y: node.position.y, // wheel centre height above the ground
      z: node.position.z,
      radius: node.userData.radius,
      width: node.userData.width,
    };
  });

  const body = model.getObjectByName('body');
  const bodyBox = new THREE.Box3().setFromObject(body);

  // The physics body's origin is RIDE_HEIGHT above the model origin
  const root = new THREE.Group();
  root.name = 'buggy';
  model.position.y = -RIDE_HEIGHT;
  // the body leans in corners and pitches when braking/accelerating (on top of the physics)
  const lean = new THREE.Group();
  lean.add(model);
  root.add(lean);
  // the wheels don't lean with the body: move them to their own group (same place, no lean)
  const wheelBase = new THREE.Group();
  wheelBase.position.y = -RIDE_HEIGHT;
  root.add(wheelBase);
  for (const w of wheels) wheelBase.add(w.node);

  // Called every frame with the physics state of each wheel
  function update({ suspension, rotation, steering }) {
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      // the wheel hangs `suspension` meters below its mounting point
      w.node.position.y = w.connY + RIDE_HEIGHT - suspension[i];
      w.node.rotation.y = steering[i];
      w.node.rotation.x = rotation[i];
    }
  }

  // lateral / forward acceleration in g
  const leanState = { roll: 0, pitch: 0 };
  function setLean(latG, longG, dt) {
    const k = Math.min(1, dt * 6);
    leanState.roll += (Math.max(-1.5, Math.min(1.5, latG)) * 0.1 - leanState.roll) * k;
    leanState.pitch += (Math.max(-1.5, Math.min(1.5, longG)) * -0.05 - leanState.pitch) * k;
    lean.rotation.set(leanState.pitch, 0, leanState.roll);
  }

  return { root, wheels, bodyBox, update, setLean, setHelmetCam() {} };
}
