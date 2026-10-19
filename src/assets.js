// Loads the downloaded textures, models and the HDR sky light (from Poly Haven, CC0).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const BASE = 'assets/';

// Average colour of a texture (in linear space), so the shader can use it as pure detail
function averageColor(image) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.drawImage(image, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += Math.pow(d[i + k] / 255, 2.2);
  return new THREE.Vector3(sum[0] / 256, sum[1] / 256, sum[2] / 256);
}

export async function loadAssets(renderer, onProgress = () => {}) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const hdrLoader = new HDRLoader(manager);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const tex = (file, color = false) =>
    texLoader.loadAsync(BASE + 'textures/' + file).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(16, maxAniso);
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    });

  const [
    dryD, dryN, dryR, altD, altN, wetD, wetN, waterN, rockD, rockN, grassD, grassN,
    rock09, rock07, boulder, hdr, palm, palmFar, grass,
  ] = await Promise.all([
    tex('aerial_beach_01_diffuse.jpg', true),
    tex('aerial_beach_01_nor_gl.jpg'),
    tex('aerial_beach_01_rough.jpg'),
    tex('dense_sand_diffuse.jpg', true),
    tex('dense_sand_nor_gl.jpg'),
    tex('damp_beach_sand_diffuse.jpg', true),
    tex('damp_beach_sand_nor_gl.jpg'),
    tex('waternormals.jpg'),
    tex('rock_face_diff.jpg', true),
    tex('rock_face_nor_gl.jpg'),
    tex('aerial_grass_rock_diff.jpg', true),
    tex('aerial_grass_rock_nor_gl.jpg'),
    gltfLoader.loadAsync(BASE + 'models/rock_09.glb'),
    gltfLoader.loadAsync(BASE + 'models/rock_07.glb'),
    gltfLoader.loadAsync(BASE + 'models/boulder_05.glb'),
    hdrLoader.loadAsync(BASE + 'hdri/beach_1k.hdr'),
    gltfLoader.loadAsync('models/palm.glb'),
    gltfLoader.loadAsync('models/palm_far.glb'),
    gltfLoader.loadAsync('models/grass.glb'),
  ]);

  hdr.mapping = THREE.EquirectangularReflectionMapping;

  // Each rock file holds one mesh: pull out its geometry and material
  const rockFrom = (gltf) => {
    let found = null;
    gltf.scene.traverse((o) => {
      if (o.isMesh && !found) found = o;
    });
    found.updateWorldMatrix(true, false);
    const geometry = found.geometry.clone().applyMatrix4(found.matrixWorld);
    // centre it and scale it to about 1 m across
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.scale(1 / Math.max(size.x, size.z), 1 / Math.max(size.x, size.z), 1 / Math.max(size.x, size.z));
    return { geometry, material: found.material };
  };

  // Every mesh in a model, with its position baked into the geometry (ready for instancing)
  const partsFrom = (gltf) => {
    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.isMesh) parts.push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: o.material });
    });
    return parts;
  };

  const palmParts = partsFrom(palm);
  // the far-away palm is a simplified copy of the same model; it shares the textures
  const palmFarParts = partsFrom(palmFar).map((p, i) => ({ geometry: p.geometry, material: palmParts[i].material }));

  return {
    palm: palmParts,
    palmFar: palmFarParts,
    grass: partsFrom(grass),
    sand: {
      dryD, dryN, dryR, altD, altN, wetD, wetN,
      dryAvg: averageColor(dryD.image),
      altAvg: averageColor(altD.image),
      wetAvg: averageColor(wetD.image),
      rockD, rockN, grassD, grassN,
      rockAvg: averageColor(rockD.image),
      grassAvg: averageColor(grassD.image),
    },
    waterNormals: waterN,
    rocks: [rockFrom(rock09), rockFrom(rock07), rockFrom(boulder)],
    hdr,
  };
}
