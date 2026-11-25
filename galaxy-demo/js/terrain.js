// Planet surface generation. Pure function of (planet descriptor, RULES): the same planet always gets the
// same map. A planet is a flat disk of tiles, like Home in Factory Conquest: (u, v) runs -1..1 across it,
// the centre is warmest and the rim coldest. Noise is sampled at the disk position, not per tile, so a
// low-res map (for far views) and the full map (for close-ups) show the same continents.
import { T, O, BASE, RESOURCES, WATER } from './ids.js?v=20261125143831';
import { RULES } from './rules.js?v=20261125143831';
import { makeNoise } from './noise.js?v=20261125143831';
import { hash32, mulberry32, makeName, pickWeighted, tileHash } from './rng.js?v=20261125143831';

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
  const P = RULES.planetTypes[desc.type] || {}, tr = P.terrain || {};
  const N = makeNoise(desc.seed >>> 0);
  const r = mulberry32(hash32(desc.seed, 3));
  const o = () => (r() - 0.5) * 200;
  const oE = [o(), o(), o()], oM = [o(), o(), o()], oN = [o(), o(), o()], oW = [o(), o(), o()];
  const type = desc.type;
  // bigger planets get more, smaller continents' worth of detail per radian
  const fC = 1.4 + desc.r * 0.6;
  const craterF = 5 + desc.r * 6;
  const octE = desc.W >= 512 ? 5 : desc.W >= 256 ? 4 : 3;

  // elevation at disk position (x, y), roughly 0..1
  function elev(x, y, z = 0) {
    const wx = N.simplex3(x * 2 + oW[0], y * 2 + oW[1], z * 2 + oW[2]) * 0.18;
    return N.fbm((x + wx) * fC + oE[0], (y + wx) * fC + oE[1], (z - wx) * fC + oE[2], octE) * 0.5 + 0.5;
  }
  // the level liquid sits at on this planet type (for water depth; types without seas get a nominal level)
  const sea = tr.sea ?? tr.lava ?? (type === 'ice' ? 0.34 : 0.36);
  // ground id at disk position (x, y) (each -1..1; z is just a fixed slice of the 3D noise); e = elev(x, y, z)
  // when the caller already has it
  function classify(x, y, z = 0, e = elev(x, y, z)) {
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
  // deposit.rich = how far inside the patch this spot is (0 at the edge, 1 in the rich middle)
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
    deposit.rich = clamp01((v - thr) / 0.25);
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
  // small-scale relief, used only for shading (never for what a tile is), and a slow colour variation. `tps` =
  // tiles per sample: bumps smaller than a few samples are left out, so coarse maps don't turn them into speckle.
  // Writes detail.rel and detail.vari (no allocation: this runs for every sample)
  const tileF = desc.W / 2;                                 // tiles per disk unit
  const oD = [o(), o(), o()];
  // the elevation noise already carries bumps down to ~60 tiles across on the biggest planets: one finer octave
  // (24 tiles) is enough on top
  // High ground also gets sharp ridgelines (ridged noise, ~70 tiles between crests), so mountain ranges show crests
  // and valleys instead of soft bumps
  let kTps = -1, k1 = 0, k3 = 0, kR = 0;
  const f1 = tileF / 24, f3 = tileF / 48, fR = tileF / 140;
  function detail(x, y, e, tps) {
    if (tps !== kTps) { kTps = tps; k1 = clamp01((24 / tps - 3) / 3) * 0.008; k3 = clamp01((48 / tps - 2) / 2) * 0.8; kR = clamp01((70 / tps - 3) / 3) * 0.1; }
    const rough = e < sea ? 0.35 : 0.6 + (e - sea) * 6;    // mountains are rugged, plains gentle, sea floors smooth
    detail.rel = k1 > 0 ? N.simplex3(x * f1 + oD[0], y * f1 + oD[1], oD[2]) * k1 * rough : 0;
    const mtn = clamp01((e - sea - 0.08) / 0.14);
    if (mtn > 0 && kR > 0) detail.rel += (N.ridged(x * fR + oD[1], y * fR + oD[0], oD[2] + 7, 2) - 0.6) * kR * mtn;
    detail.vari = k3 > 0 ? N.simplex3(x * f3 + oD[2], y * f3 + oD[0], oD[1]) * k3 : 0;
  }
  if (desc.lab) return labSampler(desc, N, r, detail, sea);
  return { classify, deposit, elev, detail, sea };
}

// The Biome Builder's planets (biome-builder/). desc.lab is one of:
//   { mono: ground id, lake, hills }        one biome all round an ocean in the middle
//   { slices: [ground ids], lake, hills, warp }   the mix planet: an ocean in the middle and the land cut like a pizza,
//                                           one slice per biome, clockwise from the top, meeting in wavy lines
//   { lake, beach (tiles), regions, warp, hills, biomes: [ground ids], paint: null or Uint8Array(W * W) of ground ids
//     (255 = not painted) }                 the older lab planet: a lake, biome regions around it, tiles painted by hand
// lake = the ocean's radius as a share of the disk's (0 = no ocean); hills 0..1; warp 0..1.5
function labSampler(desc, N, r, detail, sea) {
  const L = desc.lab, W = desc.W;
  if (L.mono !== undefined || L.slices) {
    const lake = L.lake || 0, hills = L.hills || 0, K = L.slices ? L.slices.length : 1, warp = (L.warp ?? 1) * 0.2;
    const shoreD = (x, y) => Math.hypot(x, y) + N.fbm(x * 3 + 3.1, y * 3 - 1.7, 1.3, 4) * 0.1;   // a wobbly coast
    const hill = (x, y) => (N.fbm(x * 3 + 11, y * 3 + 7, 5.5, 4) * 0.5 + 0.5) * hills * 0.16;
    // the sea bed drops away from the shore; the land rises gently from it into hills
    function elev(x, y) {
      if (lake <= 0) return sea + 0.02 + hill(x, y);
      const d = shoreD(x, y) - lake;
      if (d < 0) return sea - 0.004 - Math.min(1, -d / 0.12) * 0.09;
      return sea + 0.004 + Math.min(1, d / 0.1) * (0.016 + hill(x, y));
    }
    function classify(x, y, z = 0, e = elev(x, y)) {
      if (e < sea) return e < sea - 0.03 ? T.DEEP : T.SHALLOW;
      if (K === 1) return L.slices ? L.slices[0] : L.mono;
      // the angle clockwise from the top (y runs down), pushed about by noise so neighbouring slices meet in wavy lines
      const a = Math.atan2(x, -y) + N.fbm(x * 4 + 5.3, y * 4 - 2.9, 8.1, 4) * warp;
      return L.slices[Math.floor(((a / TAU) % 1 + 1) % 1 * K) % K];
    }
    return { classify, deposit: () => 0, elev, detail, sea };
  }
  const list = L.biomes.length ? L.biomes.slice() : [T.GRASS];
  for (let i = list.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = list[i]; list[i] = list[j]; list[j] = t; }
  const K = Math.max(1, L.regions), a0 = r() * TAU, seeds = [];
  for (let i = 0; i < K; i++) {
    const ang = a0 + (i + (r() - 0.5) * 0.6) * TAU / K, rad = L.lake + (1.05 - L.lake) * (0.3 + 0.55 * r());
    seeds.push(Math.cos(ang) * rad, Math.sin(ang) * rad, list[i % list.length]);
  }
  const beachU = L.beach * 2 / W, lake = Math.max(L.lake, 1e-4);
  const lakeD = (x, y) => Math.hypot(x, y) + N.fbm(x * 4 + 3.1, y * 4 - 1.7, 1.3, 3) * lake * 0.45;
  // the lake bed drops away from the shore; the land rises gently from it into hills
  function elev(x, y) {
    const d = lakeD(x, y);
    if (L.lake > 0 && d < L.lake) return sea - 0.004 - (L.lake - d) / lake * 0.09;
    const hill = (N.fbm(x * 3 + 11, y * 3 + 7, 5.5, 4) * 0.5 + 0.5) * L.hills * 0.16;
    return sea + 0.004 + Math.min(1, (d - L.lake) / 0.15) * (0.01 + hill);
  }
  function classify(x, y, z = 0, e = elev(x, y)) {
    if (L.paint) {
      const tx = Math.min(W - 1, Math.max(0, Math.floor((x * 0.5 + 0.5) * W)));
      const ty = Math.min(W - 1, Math.max(0, Math.floor((y * 0.5 + 0.5) * W)));
      const p = L.paint[ty * W + tx];
      if (p !== 255) return p;
    }
    if (e < sea) return e < sea - 0.03 ? T.DEEP : T.SHALLOW;
    if (L.lake > 0 && lakeD(x, y) < L.lake + beachU) return T.BEACH;
    const w = L.warp * 0.28;
    const wx = x + N.fbm(x * 2.4 + 3, y * 2.4, 7.7, 3) * w, wy = y + N.fbm(x * 2.4, y * 2.4 + 3, 11.1, 3) * w;
    let best = 1e9, id = seeds[2];
    for (let i = 0; i < seeds.length; i += 3) {
      const dd = (wx - seeds[i]) ** 2 + (wy - seeds[i + 1]) ** 2;
      if (dd < best) { best = dd; id = seeds[i + 2]; }
    }
    return id;
  }
  return { classify, deposit: () => 0, elev, detail, sea };
}
// ground where cliffs always may form (elsewhere only in scattered bands)
const CLIFF_GROUND = new Set([T.MOUNTAIN, T.PEAK, T.MESA, T.HIGHLAND, T.CANYON]);
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
// slopes are stored squeezed into a byte: t = slope * SLOPE_K (elevation per tile), byte = 0.5 + 0.5 * t / (1 + |t|)
export const SLOPE_K = 60;

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
// Returns tile ids (4 bytes each: ground, overlay, deposit richness 0..255, cliff mask 0/255), the colour map (RGBA: average tile colour + glow),
// counts per id, and the planet's settlement list.
const settleMemo = new Map();
export function generatePage(desc, art, N, x0, y0, sx, sy) {
  const t0 = performance.now();
  const sampler = makeSampler(desc);
  const ids = new Uint8Array(sx * sy * 4);
  // elevation (and shading relief) on the chunk plus a 1-sample border, so slopes at the edges match the neighbours
  const GW = sx + 2, GH = sy + 2, tps = desc.W / N;
  const E = new Float32Array(GW * GH), Hs = new Float32Array(GW * GH), Vr = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    const v = ((y0 + gy - 1 + 0.5) / N) * 2 - 1;
    for (let gx = 0; gx < GW; gx++) {
      const u = ((x0 + gx - 1 + 0.5) / N) * 2 - 1, g = gy * GW + gx;
      const e = sampler.elev(u, v);
      sampler.detail(u, v, e, tps);
      E[g] = e; Hs[g] = e + sampler.detail.rel; Vr[g] = sampler.detail.vari;
    }
  }
  let rim = null, RIM = 0;
  for (let y = 0; y < sy; y++) {
    const v = ((y0 + y + 0.5) / N) * 2 - 1;
    for (let x = 0; x < sx; x++) {
      const u = ((x0 + x + 0.5) / N) * 2 - 1, d = Math.hypot(u, v);
      const i = (y * sx + x) * 4;
      if (d > 1) {
        if (!rim) {                       // the ground just inside the rim, all the way round (only if needed)
          RIM = Math.min(4096, N * 2); rim = new Uint8Array(RIM);
          for (let k = 0; k < RIM; k++) { const a = (k + 0.5) / RIM * TAU; rim[k] = sampler.classify(Math.cos(a) * 0.995, Math.sin(a) * 0.995); }
        }
        ids[i] = rim[Math.floor(((Math.atan2(v, u) + TAU) % TAU) / TAU * RIM) % RIM]; ids[i + 1] = 0;
        continue;
      }
      const base = sampler.classify(u, v, 0, E[(y + 1) * GW + x + 1]);
      ids[i] = base;
      const ov = sampler.deposit(u, v, 0, base);
      ids[i + 1] = ov; ids[i + 2] = ov ? Math.round(sampler.deposit.rich * 255) : 0;
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
        const i = ((ty - y0) * sx + (tx - x0)) * 4;
        if (WATER.has(ids[i]) && !center) continue;
        const h = (tileHash(tx, ty) % 1000) / 1000;
        if (!center && h > 1 - 0.55 * d) continue;
        ids[i + 2] = 0;
        ids[i + 1] = d < 0.3 && s.level >= 3 ? O.TOWER : d < 0.55 && s.level >= 2 ? O.BLOCK : s.level >= 1 ? O.HOUSE : O.HUT;
        if (WATER.has(ids[i])) ids[i] = T.BEACH;
      }
    }
  }
  // counts (inside the disk only) and colour map
  const counts = new Uint32Array(64);
  const col = new Uint8Array(sx * sy * 4);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const t = y * sx + x, base = ids[t * 4], ov = ids[t * 4 + 1], rich = ids[t * 4 + 2] / 255;
    const u = ((x0 + x + 0.5) / N) * 2 - 1, v = ((y0 + y + 0.5) / N) * 2 - 1;
    if (u * u + v * v <= 1) { counts[base]++; if (ov) counts[32 + ov]++; }
    const vv = tileHash(x0 + x, y0 + y) & 3, bi = (base * 4 + vv) * 3;
    let r = art.baseAvg[bi], g = art.baseAvg[bi + 1], b = art.baseAvg[bi + 2], e = art.baseEmis[base];
    const avg = desc.avg && desc.avg[base];             // a ground drawn with a texture (Biome Builder): its own average
    if (avg) { r = avg[0]; g = avg[1]; b = avg[2]; }
    if (ov && art.overStain[ov * 4 + 3] > 0) {
      const k = art.overStain[ov * 4 + 3] * (0.35 + 0.65 * rich);
      r += (art.overStain[ov * 4] - r) * k; g += (art.overStain[ov * 4 + 1] - g) * k; b += (art.overStain[ov * 4 + 2] - b) * k;
    }
    if (ov) {
      const a = art.overAvg[ov * 4 + 3] * (art.overStain[ov * 4 + 3] > 0 ? 0.4 + 0.6 * rich : 1);
      r += (art.overAvg[ov * 4] - r) * a; g += (art.overAvg[ov * 4 + 1] - g) * a; b += (art.overAvg[ov * 4 + 2] - b) * a;
      e = Math.max(e, art.overEmis[ov]);
    }
    col[t * 4] = r; col[t * 4 + 1] = g; col[t * 4 + 2] = b; col[t * 4 + 3] = e * 255;
  }
  // field map for the terrain shading (RGBA, filtered smoothly on the GPU):
  // R, G = east-west and north-south slope (per tile, squeezed into -1..1 by t / (1 + |t|)); B = height relative to
  // the sea, 0.5 at the shore: below it only under open water (frozen seas and salt flats count as shore), 600 per
  // unit of depth; above it the land's relief, 300 per unit (cliffs step along its contours); A = a slow colour
  // variation (lusher or drier patches inside one biome).
  // Cliff mask (ids byte 3): cliffs on mountainous ground, and in scattered bands where the colour variation runs high,
  // never on water, lava or settlements
  const fld = new Uint8Array(sx * sy * 4), sq = s => { const t = s * SLOPE_K; return 127.5 + 127.5 * t / (1 + Math.abs(t)); }, inv = 1 / (2 * tps);
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const t = y * sx + x, g = (y + 1) * GW + x + 1, base = ids[t * 4];
    const dx = (Hs[g + 1] - Hs[g - 1]) * inv, dy = (Hs[g + GW] - Hs[g - GW]) * inv;
    let rel = E[g] - sampler.sea;
    if (rel < 0 && base !== T.DEEP && base !== T.SHALLOW) rel = 0;
    if (rel > 0 && (base === T.DEEP || base === T.SHALLOW)) rel = -0.001;
    fld[t * 4] = sq(dx); fld[t * 4 + 1] = sq(dy);
    const land = Math.max(0, Hs[g] - sampler.sea);
    // (rounded away from the 127.5 shore line: plain truncation stored dry shore-level ground such as frozen seas
    // as 127, a hair under the sea, and the far view painted it as open water)
    fld[t * 4 + 2] = rel < 0 ? Math.max(0, Math.min(127, Math.floor(127.5 + rel * 600))) : Math.min(255, Math.ceil(127.5 + land * 300));
    const ov = ids[t * 4 + 1];
    ids[t * 4 + 3] = rel >= 0 && !WATER.has(base) && base !== T.SEA_ICE && !(ov >= O.HUT) && (CLIFF_GROUND.has(base) || Vr[g] > 0.42) ? 255 : 0;
    fld[t * 4 + 3] = Math.max(0, Math.min(255, 127.5 + Vr[g] * 127.5));
  }
  // full detail (one sample per tile): every spot where an item could stand, for the renderer to draw as pictures
  const props = N === desc.W ? propSpots(ids, N, x0, y0, sx, sy, BIG) : null;
  const small = N === desc.W ? propSpots(ids, N, x0, y0, sx, sy, SMALL) : null;
  return { ids, col, fld, counts, settlements, props, small, ms: performance.now() - t0 };
}

// Items (trees, boulders, shrubs, grass) stand on spots. Big items: one spot per 12 x 12 cell of art pixels (8 art px
// per tile); small items: one per 8 x 8 cell. Each spot is nudged inside its cell by a hash, with the foot at art px
// (8, 22) of the sprite's 16 x 24 box. A spot belongs to the chunk its foot is in. Whether something grows there, and
// what, is decided when drawing (from the biome tables), so densities and kinds change without rebuilding maps.
// Per spot: box corner (art px x, y), ground id, the spot's hash. Sorted top to bottom, so drawing in order puts
// nearer items in front. The big grid uses the same hash as the old in-shader props.
const BIG = { cell: 12, salt: [0x2b9f, 0x6d31] }, SMALL = { cell: 8, salt: [0x51ed, 0x2701] };
function propSpots(ids, N, x0, y0, sx, sy, grid) {
  const out = [], PG = grid.cell;
  const cxA = Math.floor((x0 * 8 - 8 - PG + 1) / PG), cxB = Math.floor(((x0 + sx) * 8 - 8) / PG);
  const cyA = Math.floor((y0 * 8 - 22 - PG + 1) / PG), cyB = Math.floor(((y0 + sy) * 8 - 22) / PG);
  for (let cy = cyA; cy <= cyB; cy++) for (let cx = cxA; cx <= cxB; cx++) {
    const h = tileHash(cx ^ grid.salt[0], cy ^ grid.salt[1]);
    const ax = cx * PG + (h & 15) % PG, ay = cy * PG + ((h >>> 4) & 15) % PG;
    const fx = (ax + 8) >> 3, fy = (ay + 22) >> 3;
    if (fx < x0 || fy < y0 || fx >= x0 + sx || fy >= y0 + sy) continue;
    const u = (fx + 0.5) / N * 2 - 1, v = (fy + 0.5) / N * 2 - 1;
    if (u * u + v * v > 1) continue;                              // outside the disk
    const i = ((fy - y0) * sx + (fx - x0)) * 4, g = ids[i];
    if (ids[i + 1] || WATER.has(g)) continue;                     // deposits and buildings keep their tile clear
    out.push(ax, ay, g, h);
  }
  const n = out.length / 4, order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => out[a * 4 + 1] - out[b * 4 + 1] || out[a * 4] - out[b * 4]);
  const u32 = new Uint32Array(n * 4);
  order.forEach((j, i) => { u32[i * 4] = out[j * 4]; u32[i * 4 + 1] = out[j * 4 + 1]; u32[i * 4 + 2] = out[j * 4 + 2]; u32[i * 4 + 3] = out[j * 4 + 3]; });
  return u32;
}

// the whole W x W map in one go (used by tests and tools)
export function generateMap(desc, W, H, art) { return generatePage(desc, art, W, 0, 0, W, W); }
