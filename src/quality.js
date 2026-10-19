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
    terrainStep: 1,        // 1 = every grid point, 2 = every other one
    oceanSegments: 420,
    sandDetail: true,      // extra texture layers that hide repetition
    palms: 150,
    palmDistance: Infinity,
    rocks: 120,
    grass: 7000,
    particles: 4000,
  },
  low: {
    name: 'low',
    postProcessing: false, // draw straight to the screen with the GPU's own anti-aliasing
    maxPixelRatio: 1.25,
    shadowMapSize: 1024,
    shadowRange: 40,
    terrainStep: 2,
    oceanSegments: 200,
    sandDetail: false,
    palms: 90,
    palmDistance: 400,
    rocks: 60,
    grass: 2500,
    particles: 1500,
  },
};

export const QUALITY = PRESETS[param] || (isMobile ? PRESETS.low : PRESETS.high);
