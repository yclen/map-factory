// Seeded 3D noise: simplex (Gustavson), fractal sums, ridged noise and cellular (Worley) noise.
// 3D is used everywhere so planet maps can be sampled on a sphere: no seam at the date line, no pinched poles.
import { mulberry32 } from './rng.js?v=20261125135241';

const GRAD = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const F3 = 1 / 3, G3 = 1 / 6;

export function makeNoise(seed) {
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = mulberry32(seed);
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const cellSeed = (seed * 2654435761) | 0;

  function simplex3(xin, yin, zin) {
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }

  // fractal sum, roughly -1..1
  function fbm(x, y, z, oct) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * simplex3(x * f, y * f, z * f);
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
  }
  // ridged: sharp creases where the noise crosses zero, 0..1 (1 = on the ridge)
  function ridged(x, y, z, oct) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * (1 - Math.abs(simplex3(x * f, y * f, z * f)));
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return sum / norm;
  }
  // cellular: distance to the nearest of a jittered point per cell; lastCell holds that point's hash
  let lastCell = 0;
  function worley(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9, bh = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      let h = Math.imul(cx, 0x8da6b343) ^ Math.imul(cy, 0xd8163841) ^ Math.imul(cz, 0xcb1ab31f) ^ cellSeed;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
      const px = cx + 0.1 + ((h & 1023) / 1023) * 0.8 - x;
      const py = cy + 0.1 + (((h >>> 10) & 1023) / 1023) * 0.8 - y;
      const pz = cz + 0.1 + (((h >>> 20) & 1023) / 1023) * 0.8 - z;
      const d = px * px + py * py + pz * pz;
      if (d < best) { best = d; bh = h >>> 0; }
    }
    lastCell = bh;
    return Math.sqrt(best);
  }
  return { simplex3, fbm, ridged, worley, get lastCell() { return lastCell; } };
}
