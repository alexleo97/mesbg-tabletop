// Seamless textures for the battle mat and terrain, generated in the browser once at startup.
// They're original (procedural noise), so there are no licensing questions and nothing to download.

export const MATERIALS = ['grass', 'plains', 'forest', 'mud', 'rock', 'stone', 'snow', 'sand', 'water'] as const;
export type Material = (typeof MATERIALS)[number];

type RGB = [number, number, number];

interface Recipe {
  /** Colour ramp from dark to light, sampled by the noise value. */
  ramp: RGB[];
  /** Lattice cells across the tile per octave; higher is finer grain. */
  scale: number;
  octaves: number;
  /** Extra speckle (grass blades, gravel) mixed on top, 0..1. */
  speckle: number;
  /** Optional cobble or flagstone grid, in cells per tile. */
  cobbles?: number;
  /** Stretches the noise horizontally for ripples and grain. */
  stretch?: number;
}

const RECIPES: Record<Material, Recipe> = {
  grass: { ramp: [[58, 80, 36], [72, 98, 44], [90, 114, 52], [108, 128, 62]], scale: 5, octaves: 6, speckle: 0.18 },
  plains: { ramp: [[112, 110, 60], [132, 126, 72], [152, 142, 86], [170, 158, 102]], scale: 5, octaves: 6, speckle: 0.18 },
  forest: { ramp: [[38, 40, 22], [52, 54, 30], [68, 64, 36], [84, 74, 42]], scale: 7, octaves: 5, speckle: 0.3 },
  mud: { ramp: [[56, 42, 30], [80, 62, 44], [104, 84, 60], [128, 106, 80]], scale: 5, octaves: 5, speckle: 0.2 },
  rock: { ramp: [[64, 62, 60], [96, 94, 90], [128, 124, 118], [158, 154, 146]], scale: 4, octaves: 6, speckle: 0.25 },
  stone: { ramp: [[78, 74, 68], [106, 100, 92], [134, 128, 118], [160, 154, 142]], scale: 5, octaves: 4, speckle: 0.15, cobbles: 6 },
  snow: { ramp: [[196, 204, 214], [212, 219, 226], [228, 233, 238], [242, 245, 248]], scale: 4, octaves: 5, speckle: 0.06 },
  sand: { ramp: [[150, 124, 82], [176, 150, 104], [198, 174, 128], [218, 198, 152]], scale: 6, octaves: 4, speckle: 0.25, stretch: 2.5 },
  water: { ramp: [[24, 52, 74], [34, 72, 98], [48, 96, 124], [84, 132, 156]], scale: 4, octaves: 4, speckle: 0, stretch: 3 },
};

// Deterministic hash so textures look the same for everyone.
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise that wraps every `period` cells, so the tile repeats without seams. */
function periodicNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function sampleRamp(ramp: RGB[], t: number): RGB {
  const v = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.floor(v);
  const f = v - i;
  return [0, 1, 2].map(k => ramp[i][k] + (ramp[i + 1][k] - ramp[i][k]) * f) as RGB;
}

function render(material: Material, size: number): string {
  const r = RECIPES[material];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(size, size);
  const seed = MATERIALS.indexOf(material) + 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      let amp = 0.5;
      let total = 0;
      for (let o = 0; o < r.octaves; o++) {
        const period = r.scale * 2 ** o;
        const fx = (x / size) * period;
        const fy = (y / size) * period * (r.stretch ?? 1);
        n += periodicNoise(fx, fy, period, seed + o) * amp;
        total += amp;
        amp *= 0.5;
      }
      n /= total;
      if (r.speckle) n += (hash(x, y, seed * 31) - 0.5) * r.speckle * 0.5;
      if (r.cobbles) {
        // Mortar lines between offset flagstones.
        const cell = size / r.cobbles;
        const row = Math.floor(y / cell);
        const cx = (x + (row % 2 ? cell / 2 : 0)) % cell;
        const cy = y % cell;
        const edge = Math.min(cx, cell - cx, cy, cell - cy);
        if (edge < 1.6) n *= 0.55;
        else n += (hash(Math.floor((x + (row % 2 ? cell / 2 : 0)) / cell), row, seed) - 0.5) * 0.25;
      }
      const [cr, cg, cb] = sampleRamp(r.ramp, (n - 0.2) / 0.6);
      const i = (y * size + x) * 4;
      img.data[i] = cr;
      img.data[i + 1] = cg;
      img.data[i + 2] = cb;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

let cache: Record<Material, string> | null = null;

/** Data URLs for every material, generated on first call (a few hundred ms total). */
export function textures(): Record<Material, string> {
  if (!cache) {
    cache = {} as Record<Material, string>;
    for (const m of MATERIALS) cache[m] = render(m, 256);
  }
  return cache;
}

/** How many inches one texture tile covers on the board. */
export const TILE_INCHES = 6;
