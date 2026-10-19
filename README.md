# Beach Buggy 🏖️

Drive a dune buggy along an endless tropical coastline: beaches, dunes, grassy hills and mountains,
generated while you drive. Boost like in Rocket League, drift, jump and string skills together like
in Forza Horizon. Built with [three.js](https://threejs.org) (3D graphics)
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
| Shift | Boost (drive over the glowing orange pads to refill it) |
| C | Change camera (chase, far, helmet, TV) |
| R | Reset the buggy (if you flip it) |
| H | Horn |
| M | Mute |
| Mouse drag | Look around |

Gamepads work too: triggers for gas/brake, left stick to steer, B to boost.

**Skills:** drifting, big air, high speed, smashing umbrellas and driftwood, and driving through
SPEED TRAP gates earn points. Chain them quickly for a bigger multiplier; crashing loses half the chain.

## Things to try changing

| What | Where |
| --- | --- |
| Engine power, top speed, grip, suspension | `TUNING` in `src/vehicle.js` |
| Time of day (try `elevation: 4` for a sunset) | `SUN` in `src/environment.js` |
| Shape of the world (coastline, dunes, hills, mountains) | `terrainFunction` in `src/heightfield.js` |
| Boost strength, pads | `BOOST` in `src/boost.js` |
| What grows where, ramps, pads, speed traps | `buildProps` in `src/worldWorker.js` |
| Wave size and direction | `WAVES` in `src/ocean.js` |
| Hand-placed towers, umbrellas and ramps near the start | `PropSystem` in `src/props.js` |

The page reloads by itself when you save a file.

## How it works

- `src/heightfield.js`: the world's height is a math function (waves for the coastline, noise for dunes
  and mountains), so any spot can be built on demand.
- `src/worldWorker.js` + `src/terrain.js`: background workers build ground patches around the player
  (detailed nearby, coarse far away), physics tiles under the buggy, and decide where palms, rocks,
  grass, ramps, boost pads and speed traps go.
- `src/ocean.js`: a custom shader with Gerstner waves, sky reflections, sun glitter,
  see-through shallow water and foam where the water is shallow.
- `src/vehicle.js`: a Rapier ray-cast vehicle. Each wheel is a spring that shoots a ray at the ground.
  Wet sand grips better than soft dry sand, and water slows you down.
- `src/buggy.js`: loads the buggy model and spins/steers its wheels from the physics.
  `tools/prepare-buggy.mjs` is the script that split the downloaded model's wheels into separate parts,
  and `tools/fix-wheel-outlines.mjs` moved the leftover bits of the tires' black outline onto the wheels.
- `src/assets.js`: loads the sand, rock and sky files from `public/assets`.
- `src/boost.js`: boost meter, pads and exhaust flames. `src/skills.js`: the skill chain.
- `src/effects.js`: tire tracks (waves wash them away near the water), dust, sand roost and splashes.
- `src/audio.js`: a recorded engine loop pitched with the revs, plus waves, wind, sand, boost and horn synthesized with the Web Audio API.

## Credits

- Buggy: ["Buggy War Beach"](https://sketchfab.com/3d-models/buggy-war-beach-72063c7c59834894a4f4c95f2b93474e)
  by MoraAzul, [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) (wheels split into separate parts, textures compressed)
- Palm trees: ["Coconut Palm"](https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3) by evolveduk, CC-BY 4.0
- Dune grass: ["Dry grass"](https://sketchfab.com/3d-models/dry-grass-d1484537470441b999d37077aeb9b47a) by Pixel-bit, CC-BY 4.0
- Sand, rock and grass textures, rock models and the beach HDR sky: [Poly Haven](https://polyhaven.com), CC0
- Engine sound: ["racing car engine sound loops"](https://opengameart.org/content/racing-car-engine-sound-loops) by domasx2, CC0
- Ambient occlusion: [N8AO](https://github.com/N8python/n8ao) (MIT)
- Water normal map: from the [three.js](https://github.com/mrdoob/three.js) examples (MIT)
