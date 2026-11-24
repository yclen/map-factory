// Planet surface generation. Pure function of (planet descriptor, RULES): the same planet always gets the
// same map. A planet is a flat disk of tiles, like Home in Factory Conquest: (u, v) runs -1..1 across it,
// the centre is warmest and the rim coldest. Noise is sampled at the disk position, not per tile, so a
// low-res map (for far views) and the full map (for close-ups) show the same continents.
import { T, O, BASE, RESOURCES, WATER } from './ids.js?v=20261124014027';
import { RULES } from './rules.js?v=20261124014027';
import { makeNoise } from './noise.js?v=20261124014027';
import { hash32, mulberry32, makeName, pickWeighted, tileHash } from './rng.js?v=20261124014027';

const TAU = Math.PI * 2;
const nameToId = list => new Set(list.map(n => T[n]));
const SETTLE_GROUND = nameToId(RULES.settlements.ground);
// scaled so the ice starts about RULES.ice.cap of the radius in from each pole (the climate turns icy near lat 0.92)
const ICE_K = 0.92 / (1 - RULES.ice.cap);
const RES_GROUND = {};
for (const res of RESOURCES) {
  const g = RULES.resourceGround[res];
  RES_GROUND[res] = g === 'land' ? null : nameToId(g);
}

export function makeSampler(desc) {
  const P = RULES.planetTypes[desc.type], tr = P.terrain || {};
  const N = makeNoise(desc.seed >>> 0);
  const r = mulberry32(hash32(desc.seed, 3));
  const o = () => (r() - 0.5) * 200;
  const oE = [o(), o(), o()], oM = [o(), o(), o()], oN = [o(), o(), o()], oW = [o(), o(), o()];
  const type = desc.type;
  // bigger planets get more, smaller continents' worth of detail per radian
  const fC = 1.4 + desc.r * 0.6;
  const craterF = 5 + desc.r * 6;
  const octE = desc.W >= 512 ? 5 : desc.W >= 256 ? 4 : 3;

  // ground id at disk position (x, y) (each -1..1; z is just a fixed slice of the 3D noise)
  function classify(x, y, z = 0) {
    const wx = N.simplex3(x * 2 + oW[0], y * 2 + oW[1], z * 2 + oW[2]) * 0.18;
    let e = N.fbm((x + wx) * fC + oE[0], (y + wx) * fC + oE[1], (z - wx) * fC + oE[2], octE) * 0.5 + 0.5;
    const m = N.fbm(x * 2.2 + oM[0], y * 2.2 + oM[1], z * 2.2 + oM[2], 2) * 0.5 + 0.5;
    const n = N.simplex3(x * 9 + oN[0], y * 9 + oN[1], z * 9 + oN[2]) * 0.5 + 0.5;
    // latitude: 0 along the equator (the line across the middle of the disk), about 1 at the north and south
    // poles (top and bottom). Only latitude makes things cold, so ice forms caps at the poles and the east and
    // west edges of the world are ordinary terrain
    const lat = Math.abs(y) * ICE_K;
    switch (type) {
      case 'terran': case 'ocean': {
        const sea = tr.sea;
        let temp = 1.05 - lat * lat * 1.12 - Math.max(0, e - sea) * 1.1 + (n - 0.5) * 0.18 + (desc.heat - 1) * 0.6;
        if (e < sea) {
          if (temp < 0.08) return T.SEA_ICE;
          return e < sea - 0.07 ? T.DEEP : T.SHALLOW;
        }
        if (e > sea + 0.36) return T.PEAK;
        if (e > sea + 0.27) return temp < 0.25 ? T.PEAK : T.MOUNTAIN;
        if (temp < 0.1) return T.SNOW;
        if (e < sea + 0.018) return temp < 0.3 ? T.TUNDRA : T.BEACH;
        if (temp < 0.32) return m > 0.5 ? T.TAIGA : T.TUNDRA;
        if (temp < 0.68) return m < 0.36 ? T.SAVANNA : m < 0.55 ? T.GRASS : T.FOREST;
        return m < 0.34 ? (n > 0.6 ? T.DUNES : T.DESERT) : m < 0.5 ? T.SAVANNA : m < 0.68 ? T.JUNGLE : T.SWAMP;
      }
      case 'desert': {
        if (lat > 0.92 - n * 0.05) return T.SNOW;
        if (e < tr.sea) return m > 0.55 ? T.SHALLOW : T.SALT;
        if (e < tr.sea + 0.02 && m > 0.55) return T.SAVANNA;
        if (e > 0.74) return T.MOUNTAIN;
        if (e > 0.64) return T.MESA;
        if (m > 0.78) return T.SAVANNA;
        return n > 0.58 ? T.DUNES : T.DESERT;
      }
      case 'rust': {
        if (lat > 0.88 - n * 0.06) return T.ICE;
        const canyon = N.ridged(x * 3 + oM[0], y * 3 + oM[1], z * 3 + oM[2], 3);
        if (canyon > 0.93 && e < 0.62) return T.CANYON;
        const f1 = N.worley(x * craterF, y * craterF, z * craterF), rad = 0.18 + (N.lastCell % 97) / 97 * 0.22;
        if ((N.lastCell & 7) < 3 && Math.abs(f1 - rad) < 0.045) return T.CRATER;
        if (e > 0.72) return T.HIGHLAND;
        if (m > 0.62) return T.BASALT;
        return T.RUST;
      }
      case 'lava': case 'volcanic': {
        const lava = tr.lava;
        if (type === 'volcanic') {
          if (e < lava) return T.LAVA;
          if (e > 0.72) return T.MOUNTAIN;
          return m > 0.6 ? T.ASH : T.SULFUR;
        }
        if (e < lava) return T.LAVA;
        if (e < lava + 0.04) return T.OBSIDIAN;
        if (e > 0.76) return T.MOUNTAIN;
        if (m > 0.66) return T.SULFUR;
        if (m < 0.38) return T.ASH;
        return n > 0.55 ? T.BASALT : T.OBSIDIAN;
      }
      case 'tundra': {
        let temp = 0.85 - lat * lat * 0.75 - Math.max(0, e - tr.sea) * 0.8 + (n - 0.5) * 0.2;
        if (e < tr.sea) return temp < 0.45 ? T.SEA_ICE : T.SHALLOW;
        if (e > tr.sea + 0.4) return T.PEAK;
        if (e > tr.sea + 0.3) return T.MOUNTAIN;
        if (temp < 0.22) return T.SNOW;
        return m > 0.55 ? T.TAIGA : T.TUNDRA;
      }
      case 'ice': {
        const ridge = N.ridged(x * 4 + oM[0], y * 4 + oM[1], z * 4 + oM[2], 2);
        if (ridge > 0.94) return T.ICE_CRACK;
        if (e < 0.34) return T.SEA_ICE;
        if (e > 0.76) return T.REGOLITH;
        return m > 0.5 ? T.SNOW : T.ICE;
      }
      default: {     // barren
        const f1 = N.worley(x * craterF, y * craterF, z * craterF), rad = 0.16 + (N.lastCell % 89) / 89 * 0.26;
        if ((N.lastCell & 3) !== 0 && Math.abs(f1 - rad) < 0.05) return T.CRATER;
        if (e < 0.36) return T.BASALT;
        if (e > 0.62) return T.HIGHLAND;
        return T.REGOLITH;
      }
    }
  }

  // resource deposits: round patches, like ore fields. A cheap "is there a patch here" field first;
  // only inside patches, a cellular lookup decides which resource the patch holds (by abundance).
  const res = Object.entries(P.resources || {});
  let total = 0;
  for (const [, a] of res) total += a;
  const resFreq = (desc.W / 2) / RULES.resourceBlob;      // tiles per disk unit / deposit size
  const presence = Math.min(0.5, total * 0.17);            // rough share of land inside a patch
  const thr = 0.62 - presence * 0.9;
  const oR = [o(), o(), o()];
  function deposit(x, y, z, base) {
    if (!res.length || base === T.DEEP || base === T.LAVA) return 0;
    const v = N.fbm(x * resFreq + oR[0], y * resFreq + oR[1], z * resFreq + oR[2], 2);
    if (v < thr) return 0;
    N.worley(x * resFreq * 0.5 + oR[1], y * resFreq * 0.5 + oR[2], z * resFreq * 0.5 + oR[0]);
    let pick = ((N.lastCell >>> 8) % 10000) / 10000 * total;
    for (const [name, a] of res) {
      pick -= a;
      if (pick <= 0) {
        const g = RES_GROUND[name];
        if (g ? !g.has(base) : WATER.has(base)) return 0;
        return O[name];
      }
    }
    return 0;
  }
  return { classify, deposit };
}

// where the settlements go: decided from the planet seed alone, so every map resolution agrees
export function placeSettlements(desc, sampler) {
  const n = desc.settle | 0;
  if (!n) return [];
  const S = RULES.settlements;
  const r = mulberry32(hash32(desc.seed, 77));
  const out = [];
  const minSep = (2 / desc.W) * 14;                       // 14 tiles, in disk units
  const weights = Object.fromEntries(S.levelWeights.map((w, i) => [i, w]));
  for (let tries = 0; out.length < n && tries < n * 120; tries++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 0.9;
    const u = Math.cos(a) * d, v = Math.sin(a) * d;
    if (!SETTLE_GROUND.has(sampler.classify(u, v))) continue;
    let ok = true;
    for (const s of out) if (Math.hypot(s.u - u, s.v - v) < minSep) { ok = false; break; }
    if (!ok) continue;
    const level = desc.home && out.length === 0 ? 4 : +pickWeighted(r, weights);
    out.push({ u, v, level, name: makeName(r), radius: S.radius[level], levelName: S.levels[level] });
  }
  return out;
}

// One chunk ("page") of a planet's map. The disk's square is sampled on an N x N grid (N = the full tile count
// at the finest detail level, fewer at coarser levels); this builds the sx x sy block starting at (x0, y0).
// Every sample reads the same noise, so coarse and fine levels show the same continents. Samples outside the
// disk copy the ground just inside the rim (clean edges) and aren't counted.
// Returns tile ids (2 bytes each: ground, overlay), the colour map (RGBA: average tile colour + glow),
// counts per id, and the planet's settlement list.
const settleMemo = new Map();
export function generatePage(desc, art, N, x0, y0, sx, sy) {
  const t0 = performance.now();
  const sampler = makeSampler(desc);
  const ids = new Uint8Array(sx * sy * 2);
  let rim = null, RIM = 0;
  for (let y = 0; y < sy; y++) {
    const v = ((y0 + y + 0.5) / N) * 2 - 1;
    for (let x = 0; x < sx; x++) {
      const u = ((x0 + x + 0.5) / N) * 2 - 1, d = Math.hypot(u, v);
      const i = (y * sx + x) * 2;
      if (d > 1) {
        if (!rim) {                       // the ground just inside the rim, all the way round (only if needed)
          RIM = Math.min(4096, N * 2); rim = new Uint8Array(RIM);
          for (let k = 0; k < RIM; k++) { const a = (k + 0.5) / RIM * TAU; rim[k] = sampler.classify(Math.cos(a) * 0.995, Math.sin(a) * 0.995); }
        }
        ids[i] = rim[Math.floor(((Math.atan2(v, u) + TAU) % TAU) / TAU * RIM) % RIM]; ids[i + 1] = 0;
        continue;
      }
      const base = sampler.classify(u, v);
      ids[i] = base;
      ids[i + 1] = sampler.deposit(u, v, 0, base);
    }
  }
  // settlements (worked out once per planet): paint buildings in a disc around each centre, denser in the middle
  const key = desc.id + '/' + desc.W;
  let settlements = settleMemo.get(key);
  if (!settlements) { settlements = placeSettlements(desc, sampler); settleMemo.set(key, settlements); if (settleMemo.size > 400) settleMemo.clear(); }
  for (const s of settlements) {
    const rt = s.radius * N / desc.W;                     // radius in this level's samples
    const cx = (s.u * 0.5 + 0.5) * N, cy = (s.v * 0.5 + 0.5) * N;
    if (cx + rt + 1 < x0 || cx - rt - 1 > x0 + sx || cy + rt + 1 < y0 || cy - rt - 1 > y0 + sy) continue;
    for (let ty = Math.max(y0, Math.floor(cy - rt) - 1); ty <= Math.min(y0 + sy - 1, cy + rt + 1); ty++) {
      for (let tx = Math.max(x0, Math.floor(cx - rt) - 1); tx <= Math.min(x0 + sx - 1, cx + rt + 1); tx++) {
        const d = Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) / Math.max(rt, 0.5);
        const center = tx === Math.floor(cx) && ty === Math.floor(cy);
        if (d > 1 && !center) continue;
        const i = ((ty - y0) * sx + (tx - x0)) * 2;
        if (WATER.has(ids[i]) && !center) continue;
        const h = (tileHash(tx, ty) % 1000) / 1000;
        if (!center && h > 1 - 0.55 * d) continue;
        ids[i + 1] = d < 0.3 && s.level >= 3 ? O.TOWER : d < 0.55 && s.level >= 2 ? O.BLOCK : s.level >= 1 ? O.HOUSE : O.HUT;
        if (WATER.has(ids[i])) ids[i] = T.BEACH;
      }
    }
  }
  // counts (inside the disk only) and colour map
  const counts = new Uint32Array(64);
  const col = new Uint8Array(sx * sy * 4);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const t = y * sx + x, base = ids[t * 2], ov = ids[t * 2 + 1];
    const u = ((x0 + x + 0.5) / N) * 2 - 1, v = ((y0 + y + 0.5) / N) * 2 - 1;
    if (u * u + v * v <= 1) { counts[base]++; if (ov) counts[32 + ov]++; }
    const vv = tileHash(x0 + x, y0 + y) & 3, bi = (base * 4 + vv) * 3;
    let r = art.baseAvg[bi], g = art.baseAvg[bi + 1], b = art.baseAvg[bi + 2], e = art.baseEmis[base];
    if (ov) {
      const a = art.overAvg[ov * 4 + 3];
      r += (art.overAvg[ov * 4] - r) * a; g += (art.overAvg[ov * 4 + 1] - g) * a; b += (art.overAvg[ov * 4 + 2] - b) * a;
      e = Math.max(e, art.overEmis[ov]);
    }
    col[t * 4] = r; col[t * 4 + 1] = g; col[t * 4 + 2] = b; col[t * 4 + 3] = e * 255;
  }
  return { ids, col, counts, settlements, ms: performance.now() - t0 };
}

// the whole W x W map in one go (used by tests and tools)
export function generateMap(desc, W, H, art) { return generatePage(desc, art, W, 0, 0, W, W); }
