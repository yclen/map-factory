// Deterministic randomness.
// hash32 mixes any list of integers into one 32-bit number: a stateless "endless table", so any star,
// planet or tile can be generated on its own, in any order. mulberry32 is a small sequential generator
// used only inside one node of the seed tree.

export function hash32(a, b = 0, c = 0, d = 0) {
  let h = 0x9e3779b9;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (c | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (d | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r, a, b) => a + (b - a) * r();
export const irange = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export function gauss(r) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// pick a key from { key: weight }
export function pickWeighted(r, table) {
  let total = 0;
  for (const k in table) total += table[k];
  let x = r() * total;
  for (const k in table) { x -= table[k]; if (x <= 0) return k; }
  return Object.keys(table)[0];
}

// same tile-variant hash the shader uses (keep the two in sync)
export function tileHash(x, y) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h >>> 0;
}

// names, from the same syllables Factory Conquest uses
const SYLLABLES = ['ka', 've', 'lor', 'zan', 'tor', 'mi', 'rah', 'eth', 'os', 'qua', 'dri', 'sel', 'nor', 'vy', 'tha',
  'ix', 'um', 'pe', 'gor', 'lia', 'ser', 'an', 'kel', 'oth', 'yr', 'bel'];
export function makeName(r) {
  let w = '';
  const n = 2 + (r() < 0.35 ? 1 : 0);
  for (let k = 0; k < n; k++) w += SYLLABLES[(r() * SYLLABLES.length) | 0];
  w += ['', '', 'on', 'ar', 'is', 'us', 'a', 'ia'][(r() * 8) | 0];
  return w[0].toUpperCase() + w.slice(1);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI',
  'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV'];
export const roman = n => ROMAN[n] || String(n + 1);
