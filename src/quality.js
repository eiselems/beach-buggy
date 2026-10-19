// Graphics quality. Phones and tablets get "low" automatically; force one with ?quality=low or ?quality=high
const param = new URLSearchParams(location.search).get('quality');
const isMobile =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (window.matchMedia('(pointer: coarse)').matches && Math.max(screen.width, screen.height) < 1400);

const PRESETS = {
  high: {
    name: 'high',
    postProcessing: true,  // MSAA + bloom via the effect composer
    maxPixelRatio: 1.5,
    shadowMapSize: 4096,
    shadowRange: 70,
    terrainCells: 64,      // squares per side of each ground patch
    terrainMinPatch: 128,  // size of the most detailed patches (m)
    terrainSplit: 1.3,     // bigger = detailed ground reaches further
    viewDistance: 7000,    // how far the ground is drawn (m)
    propDistance: 1400,    // palms and rocks (m)
    oceanSegments: 420,
    sandDetail: true,      // extra texture layers that hide repetition
    grassDistance: 220,
    particles: 4000,
  },
  low: {
    name: 'low',
    postProcessing: false, // draw straight to the screen with the GPU's own anti-aliasing
    maxPixelRatio: 1.25,
    shadowMapSize: 1024,
    shadowRange: 40,
    terrainCells: 32,
    terrainMinPatch: 128,
    terrainSplit: 1.2,
    viewDistance: 4000,
    propDistance: 700,
    oceanSegments: 200,
    sandDetail: false,
    grassDistance: 130,
    particles: 1500,
  },
};

export const QUALITY = PRESETS[param] || (isMobile ? PRESETS.low : PRESETS.high);
