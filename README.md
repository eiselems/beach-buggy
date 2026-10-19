# Beach Buggy 🏖️

Drive a dune buggy around a tropical beach. Built with [three.js](https://threejs.org) (3D graphics)
and [Rapier](https://rapier.rs) (physics). The terrain, ocean, effects and sounds are made in code;
the buggy, palm trees, grass, sand, rocks and sky lighting use free 3D assets (see Credits).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173 (make sure hardware/GPU acceleration is on in your browser).
The server also listens on your network, so you can play on a phone or tablet on the same Wi-Fi
(it shows on-screen touch controls).

Phones and tablets automatically use a lighter graphics mode. You can force one with
`?quality=low` or `?quality=high` at the end of the address. The game also lowers or raises its
rendering resolution by itself to keep the frame rate smooth (shown in the top-left corner).

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Gas |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space | Handbrake (drift!) |
| C | Change camera (chase, far, helmet, TV) |
| R | Reset the buggy (if you flip it) |
| H | Horn |
| M | Mute |
| Mouse drag | Look around |

Gamepads work too: triggers for gas/brake, left stick to steer.

## Things to try changing

| What | Where |
| --- | --- |
| Engine power, top speed, grip, suspension | `TUNING` in `src/vehicle.js` |
| Time of day (try `elevation: 4` for a sunset) | `SUN` in `src/environment.js` |
| Shape of the beach, dunes and hills | `terrainFunction` in `src/terrain.js` |
| Wave size and direction | `WAVES` in `src/ocean.js` |
| Where ramps, towers and umbrellas go | `createProps` in `src/props.js` |

The page reloads by itself when you save a file.

## How it works

- `src/terrain.js`: the island's height comes from a math function plus noise. The same grid is used for
  the 3D mesh, the physics collider and the water depth map.
- `src/ocean.js`: a custom shader with Gerstner waves, sky reflections, sun glitter,
  see-through shallow water and foam where the water is shallow.
- `src/vehicle.js`: a Rapier ray-cast vehicle. Each wheel is a spring that shoots a ray at the ground.
  Wet sand grips better than soft dry sand, and water slows you down.
- `src/buggy.js`: loads the buggy model and spins/steers its wheels from the physics.
  `tools/prepare-buggy.mjs` is the script that split the downloaded model's wheels into separate parts,
  and `tools/fix-wheel-outlines.mjs` moved the leftover bits of the tires' black outline onto the wheels.
- `src/assets.js`: loads the sand, rock and sky files from `public/assets`.
- `src/effects.js`: tire tracks (waves wash them away near the water), dust, sand roost and splashes.
- `src/audio.js`: engine, waves, wind and horn, all synthesized with the Web Audio API.

## Credits

- Buggy: ["Buggy War Beach"](https://sketchfab.com/3d-models/buggy-war-beach-72063c7c59834894a4f4c95f2b93474e)
  by MoraAzul, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) (wheels split into separate parts, textures compressed)
- Palm trees: ["Coconut Palm"](https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3) by evolveduk, CC-BY 4.0
- Dune grass: ["Dry grass"](https://sketchfab.com/3d-models/dry-grass-d1484537470441b999d37077aeb9b47a) by Pixel-bit, CC-BY 4.0
- Sand and rock textures, rock models and the beach HDR sky: [Poly Haven](https://polyhaven.com), CC0
- Water normal map: from the [three.js](https://github.com/mrdoob/three.js) examples (MIT)
