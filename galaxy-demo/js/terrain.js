// Planet surface generation. Pure function of (planet descriptor, RULES): the same planet always gets the
// same map. A planet is a flat disk of tiles, like Home in Factory Conquest: (u, v) runs -1..1 across it,
// the centre is warmest and the rim coldest. Noise is sampled at the disk position, not per tile, so a
// low-res map (for far views) and the full map (for close-ups) show the same continents.
import { T, O, BASE, RESOURCES, WATER } from './ids.js?v=20261125193712';
import { RULES } from './rules.js?v=20261125193712';
import { makeNoise } from './noise.js?v=20261125193712';
import { hash32, mulberry32, makeName, pickWeighted, tileHash } from './rng.js?v=20261125193712';

const TAU = Math.PI * 2;
const nameToId = list => new Set(list.map(n => T[n]));
const SETTLE_GROUND = nameToId(RULES.settlements.ground);
const BUILD_GROUND = nameToId([...RULES.settlements.ground, 'SWAMP', 'MESA', 'SALT', 'DUNES', 'SNOW']);   // where houses stand
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
  // Border fuzz: mid-scale noise (about 64 and 16 tiles across) added to the climate the biome choice reads, so
  // biomes meet in ragged edges with little islands of each other, not smooth contour lines. desc.fuzz scales it
  // (0 = off; the Biome Builder's border look, saved for the game). Like detail(), each octave is left out on maps
  // too coarse to show it (ctl.tps = tiles per sample, set per chunk by generatePage), so far views don't speckle.
  // fuzz.m / fuzz.t: the nudge to moisture and temperature
  const ctl = { tps: 1 };
  const tileF = desc.W / 2;                                 // tiles per disk unit
  const fzK = desc.fuzz ?? 1, fzA = tileF / 64, fzB = tileF / 16;
  const rF = mulberry32(hash32(desc.seed, 5)), oF = [0, 1, 2].map(() => (rF() - 0.5) * 200);   // own stream: other offsets stay
  let zTps = -1, zA = 0, zB = 0;
  function fuzz(x, y) {
    if (ctl.tps !== zTps) { zTps = ctl.tps; zA = clamp01((64 / zTps - 3) / 3) * fzK; zB = clamp01((16 / zTps - 3) / 3) * fzK; }
    const a = zA > 0 ? N.simplex3(x * fzA + oF[0], y * fzA + oF[1], oF[2]) * zA : 0;
    const b = zB > 0 ? N.simplex3(x * fzB + oF[1], y * fzB + oF[2], oF[0]) * zB : 0;
    fuzz.m = a * 0.035 + b * 0.015;
    fuzz.t = b * 0.025 - a * 0.03;
  }
  fuzz.m = 0; fuzz.t = 0;
  // ground id at disk position (x, y) (each -1..1; z is just a fixed slice of the 3D noise); e = elev(x, y, z)
  // when the caller already has it
  function classify(x, y, z = 0, e = elev(x, y, z)) {
    fuzz(x, y);
    const m = N.fbm(x * 2.2 + oM[0], y * 2.2 + oM[1], z * 2.2 + oM[2], 2) * 0.5 + 0.5 + fuzz.m;
    const n = N.simplex3(x * 9 + oN[0], y * 9 + oN[1], z * 9 + oN[2]) * 0.5 + 0.5;
    // latitude: 0 along the equator (the line across the middle of the disk), about 1 at the north and south
    // poles (top and bottom). Only latitude makes things cold, so ice forms caps at the poles and the east and
    // west edges of the world are ordinary terrain
    const lat = Math.abs(y) * ICE_K;
    switch (type) {
      case 'terran': case 'ocean': {
        const sea = tr.sea;
        let temp = 1.05 - lat * lat * 1.12 - Math.max(0, e - sea) * 1.1 + (n - 0.5) * 0.18 + (desc.heat - 1) * 0.6 + fuzz.t;
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
        let temp = 0.85 - lat * lat * 0.75 - Math.max(0, e - tr.sea) * 0.8 + (n - 0.5) * 0.2 + fuzz.t;
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
  // the patch threshold: where the old rule put it, then raised so patches cover RULES.oreAmount of the ground
  // they used to (fewer patches, and the ones left a little smaller)
  const thr = fbmAbove(fbmShareAbove(0.62 - presence * 0.9) * (RULES.oreAmount ?? 1));
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
  const setTps = tps => { ctl.tps = tps; };
  if (desc.lab) return { ...labSampler(desc, N, r, detail, sea, ctl), setTps };
  return { classify, deposit, elev, detail, sea, setTps };
}

// The Biome Builder's planets (biome-builder/). desc.lab is one of:
//   { mono: ground id, lake, hills }        one biome all round an ocean in the middle
//   { slices: [ground ids], lake, hills, warp }   the mix planet: an ocean in the middle and the land cut like a pizza,
//                                           one slice per biome, clockwise from the top, meeting in wavy lines
//   { lake, beach (tiles), regions, warp, hills, biomes: [ground ids], paint: null or Uint8Array(W * W) of ground ids
//     (255 = not painted) }                 the older lab planet: a lake, biome regions around it, tiles painted by hand
// lake = the ocean's radius as a share of the disk's (0 = no ocean); hills 0..1; warp 0..1.5
function labSampler(desc, N, r, detail, sea, ctl) {
  const L = desc.lab, W = desc.W;
  if (L.mono !== undefined || L.slices) {
    const lake = L.lake || 0, hills = L.hills || 0, K = L.slices ? L.slices.length : 1, warp = (L.warp ?? 1) * 0.2;
    // border fuzz, as on real planets: the slice borders pushed about by noise ~64 and ~16 tiles across, by up to
    // ~28 and ~7 tiles (times desc.fuzz), so they meet the way biomes do in the game
    const fzK = desc.fuzz ?? 1, tileF = W / 2, fzA = tileF / 64, fzB = tileF / 16;
    let zTps = -1, zA = 0, zB = 0;
    const fuzzAngle = (x, y) => {
      if (ctl.tps !== zTps) { zTps = ctl.tps; zA = clamp01((64 / zTps - 3) / 3) * fzK; zB = clamp01((16 / zTps - 3) / 3) * fzK; }
      if (!zA && !zB) return 0;
      const d = (zA ? N.simplex3(x * fzA + 2.7, y * fzA - 6.1, 3.3) * zA * 28 : 0) + (zB ? N.simplex3(x * fzB - 4.4, y * fzB + 1.9, 9.2) * zB * 7 : 0);
      return d / (Math.max(0.08, Math.hypot(x, y)) * tileF);     // tiles along the border -> an angle
    };
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
      const a = Math.atan2(x, -y) + N.fbm(x * 4 + 5.3, y * 4 - 2.9, 8.1, 4) * warp + fuzzAngle(x, y);
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
// The spread of 2-octave fBm values, sampled once (the same for every seed): the share of points at or above x, and
// the value that share p of points reach. For setting how much ground ore deposits cover
let FBM_SORTED = null;
function fbmSorted() {
  if (!FBM_SORTED) {
    const N = makeNoise(97), r = mulberry32(11), a = new Float32Array(40000);
    for (let i = 0; i < a.length; i++) a[i] = N.fbm(r() * 300, r() * 300, r() * 300, 2);
    FBM_SORTED = a.sort();
  }
  return FBM_SORTED;
}
function fbmShareAbove(x) {
  const a = fbmSorted();
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return (a.length - lo) / a.length;
}
function fbmAbove(p) {
  const a = fbmSorted();
  return a[Math.min(a.length - 1, Math.max(0, Math.floor((1 - p) * a.length)))];
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
  const tile = 2 / desc.W;                                // one tile, in disk units
  const weights = Object.fromEntries(S.levelWeights.map((w, i) => [i, w]));
  sampler.setTps(1);                                      // classify as at full detail, so every chunk agrees
  for (let tries = 0; out.length < n && tries < n * 120; tries++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 0.9;
    const u = Math.cos(a) * d, v = Math.sin(a) * d;
    if (!SETTLE_GROUND.has(sampler.classify(u, v))) continue;
    // Home's capital is a Megalopolis, so the demo shows every kind of building
    const level = desc.home && out.length === 0 ? S.levels.length - 1 : +pickWeighted(r, weights);
    let ok = true;                                        // the towns' edges at least 6 tiles apart
    for (const s of out) if (Math.hypot(s.u - u, s.v - v) < (S.radius[level] + s.radius + 6) * tile) { ok = false; break; }
    if (!ok) continue;
    out.push({ u, v, level, name: makeName(r), radius: S.radius[level], levelName: S.levels[level] });
  }
  return out;
}

// ---------- towns and the roads between them (plan: art/towns.md) ----------
// Worked out once per planet, at full detail (buildWorld), so every chunk and every zoom level agrees:
// 1. a road network: neighbouring settlements that can reach each other over land are joined by a road that
//    follows the land (a path search on a coarse grid that avoids water, mountains and other towns, with some noise
//    so it wanders), smoothed and given a gentle meander. Its quality is the poorer end's: a track between villages,
//    a highway between megacities
// 2. each settlement's own streets: an arm out to each road that leaves it, a few more arms of its own that wander
//    off into the country, and from City up a grid of cross streets
// 3. lots of buildings (2 x 2 tiles): the newest tier the level allows in the middle, older tiers in rings outside.
//    In villages and towns houses line the streets
// Tiles keep a building overlay (HUT..TOWER: the far view's colour, night lights, no trees) and byte 2 says what's
// there: TOWN_FLAG on all of it, + ROAD_FLAG on a road, + IN_TOWN inside a settlement, or CLEAR_FLAG beside a road's
// diagonal step or round a house (kept clear of trees, drawn as ground); low bits = tier 0-5 (roads: 0 track,
// 1 gravel, 2 cobbles, 3 asphalt, 4-5 asphalt with lines). The shader draws roads as smooth strips joining a point in
// each road tile (BODY_FS roadAt): where the curve crosses that tile, to a quarter tile, x in the overlay id
// (HUT + 0..3) and y in bits 3-4 of the shader's byte 3. A tile entry is [overlay, flags, y quarter]
export const TOWN_FLAG = 128, ROAD_FLAG = 64, CLEAR_FLAG = 32, IN_TOWN = 16;
const TOWN_OV = [O.HUT, O.HUT, O.HOUSE, O.BLOCK, O.TOWER, O.TOWER];
const mod = (a, n) => ((a % n) + n) % n;
const BUCKET = 64;                                        // tiles per side of the buckets chunks look things up in
// smooth value noise from tile hashes (roads' wandering)
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => (tileHash(a + s * 7919, b - s * 104729) & 65535) / 65535;
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// what a road pays per step on each ground (Infinity: never; it goes round)
const ROAD_COST = new Float32Array(BASE.length).fill(1);
for (const [n, c] of Object.entries({ DEEP: Infinity, SHALLOW: Infinity, LAVA: Infinity, SEA_ICE: Infinity,
  MOUNTAIN: 5, PEAK: 10, CANYON: 4, MESA: 2.5, SNOW: 2.5, ICE: 3, ICE_CRACK: 4, SWAMP: 2.5, JUNGLE: 1.6, DUNES: 2,
  FOREST: 1.3, TAIGA: 1.3, OBSIDIAN: 2, CRATER: 2 })) ROAD_COST[T[n]] = c;

// a polyline (tile coords, a tile's centre at +0.5) as a run of tiles, each touching the last side or corner on,
// with where the line crosses each, to a quarter tile: [tx, ty, x quarter, y quarter]. An elbow (side, side) between
// two corner neighbours is cut to a corner step, which draws smoother
const quarter = f => Math.max(0, Math.min(3, Math.floor(f * 4)));
function rasterize(pts) {
  const out = [];
  const push = (px, py) => {
    const tx = Math.floor(px), ty = Math.floor(py), l = out[out.length - 1];
    if (l && l[0] === tx && l[1] === ty) { l[2] += px; l[3] += py; l[4]++; return; }
    if (l && Math.max(Math.abs(l[0] - tx), Math.abs(l[1] - ty)) > 1) {
      let x = l[0], y = l[1];
      while (x !== tx || y !== ty) { x += Math.sign(tx - x); y += Math.sign(ty - y); out.push([x, y, x + 0.5, y + 0.5, 1]); }
      return;
    }
    out.push([tx, ty, px, py, 1]);
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 4));
    for (let k = i ? 1 : 0; k <= n; k++) push(ax + (bx - ax) * k / n, ay + (by - ay) * k / n);
  }
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = res[res.length - 1], c = out[i + 1];
    if (a && c && Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1) continue;
    const [tx, ty, sx, sy, n] = out[i];
    res.push([tx, ty, quarter(sx / n - tx), quarter(sy / n - ty)]);
  }
  return res;
}
// Chaikin corner cutting: a smooth curve through a path's points, keeping its ends
function chaikin(p, n) {
  for (let k = 0; k < n; k++) {
    const q = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
// points every `step` tiles along a polyline
function resample(p, step) {
  const out = [p[0]];
  let carry = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1], L = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= L) { out.push([ax + (bx - ax) * t / L, ay + (by - ay) * t / L]); t += step; }
    carry = L - (t - step);
  }
  out.push(p[p.length - 1]);
  return out;
}

// a tiny binary heap of [priority, value]
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(p, v) { a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; }
      }
      return top[1];
    },
  };
}

// The road network: which settlements are joined, and the winding path of each road (tile coords, centre to centre)
function roadNetwork(sets, desc, sampler, land) {
  const W = desc.W, C = Math.max(4, Math.round(W / 256)), G = Math.ceil(W / C), seed = desc.seed | 0;
  const cost = new Float32Array(G * G).fill(-1), town = new Int16Array(G * G), used = new Uint8Array(G * G);
  const pos = sets.map(s => [(s.u * 0.5 + 0.5) * W, (s.v * 0.5 + 0.5) * W]);
  // cells in or near a settlement (roads go round other towns, not through them)
  sets.forEach((s, i) => {
    const r = (s.radius + 4) / C, cx = pos[i][0] / C, cy = pos[i][1] / C;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if (x >= 0 && y >= 0 && x < G && y < G && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) town[y * G + x] = i + 1;
  });
  const cellCost = i => {
    if (cost[i] >= 0) return cost[i];
    const x = i % G, y = (i / G) | 0, u = ((x + 0.5) * C) / W * 2 - 1, v = ((y + 0.5) * C) / W * 2 - 1;
    let c = u * u + v * v > 0.95 ? Infinity : ROAD_COST[sampler.classify(u, v)];
    c *= 0.35 + 1.3 * vnoise(x / 3, y / 3, seed);         // some ground is easier than other: roads wander
    return (cost[i] = c);
  };
  // which pairs to join: the relative neighbourhood graph (a and b, unless some c is nearer to both), not too far
  const maxD = W * 0.42, edges = [];
  for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) {
    const d = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
    if (d > maxD) continue;
    let ok = true;
    for (let c = 0; c < sets.length && ok; c++) if (c !== a && c !== b &&
      Math.max(Math.hypot(pos[a][0] - pos[c][0], pos[a][1] - pos[c][1]), Math.hypot(pos[b][0] - pos[c][0], pos[b][1] - pos[c][1])) < d) ok = false;
    if (ok) edges.push([d, a, b]);
  }
  edges.sort((p, q) => p[0] - q[0]);
  const roads = [];
  const g = new Float32Array(G * G), from = new Int32Array(G * G);
  for (const [d, a, b] of edges) {
    // A* over the cells from a's centre to b's, 8 ways; roads already built are cheaper, so later ones join them
    const cell = p => Math.min(G - 1, Math.floor(p[1] / C)) * G + Math.min(G - 1, Math.floor(p[0] / C));
    const s0 = cell(pos[a]), s1 = cell(pos[b]), tx = s1 % G, ty = (s1 / G) | 0;
    g.fill(Infinity); from.fill(-1);
    const open = heap(), h = i => Math.hypot(i % G - tx, ((i / G) | 0) - ty) * 0.9;
    g[s0] = 0; open.push(h(s0), s0);
    let found = false, n = 0;
    const limit = (d / C) * 3;                            // give up on a detour over 3x the straight distance
    while (open.size && n++ < 80000) {
      const i = open.pop();
      if (i === s1) { found = true; break; }
      const x = i % G, y = (i / G) | 0;
      if (g[i] > limit * 1.6) break;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const j = ny * G + nx;
        let c = cellCost(j);
        if (c === Infinity) continue;
        if (dx && dy && (cellCost(y * G + nx) === Infinity || cellCost(ny * G + x) === Infinity)) continue;   // no squeezing past water
        if (town[j] && town[j] !== a + 1 && town[j] !== b + 1) c += 6;
        if (used[j]) c *= 0.45;
        const ng = g[i] + c * (dx && dy ? Math.SQRT2 : 1);
        if (ng < g[j]) { g[j] = ng; from[j] = i; open.push(ng + h(j), j); }
      }
    }
    if (!found) continue;                                 // no way over land: no road
    const cells = [];
    for (let i = s1; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    for (const i of cells) used[i] = 1;
    // smooth it, then let it meander a little (never into water, and straight where it meets a town)
    let pts = [pos[a], ...cells.slice(1, -1).map(i => [(i % G + 0.5) * C, (((i / G) | 0) + 0.5) * C]), pos[b]];
    pts = resample(chaikin(pts, 3), 1);
    const L = pts.length, amp = Math.min(C * 0.6, 9), es = seed + a * 131 + b * 977;
    const ra = sets[a].radius + 3, rb = sets[b].radius + 3;
    pts = pts.map((p, k) => {
      const q = pts[Math.min(L - 1, k + 1)], o = pts[Math.max(0, k - 1)], tx2 = q[0] - o[0], ty2 = q[1] - o[1], tl = Math.hypot(tx2, ty2) || 1;
      const ends = Math.min(1, Math.max(0, (Math.min(Math.hypot(p[0] - pos[a][0], p[1] - pos[a][1]) - ra,
        Math.hypot(p[0] - pos[b][0], p[1] - pos[b][1]) - rb)) / 12));
      const off = ((vnoise(k / 36, 0.5, es) - 0.5) * 2.4 + (vnoise(k / 11, 7.5, es) - 0.5) * 0.9) * amp * ends;
      const m = [p[0] - ty2 / tl * off, p[1] + tx2 / tl * off];
      return off && land(Math.floor(m[0]), Math.floor(m[1])) ? m : p;
    });
    roads.push({ a, b, tier: Math.min(sets[a].level, sets[b].level), pts });
  }
  return roads;
}

// one settlement's streets and lots, into the planet's tile map; returns its buildings
function townLayout(s, si, desc, land, build, tiles, arms) {
  const W = desc.W, L = s.level, R = s.radius, TW = RULES.towns;
  const cx = Math.floor((s.u * 0.5 + 0.5) * W), cy = Math.floor((s.v * 0.5 + 0.5) * W);
  const r = mulberry32(hash32(desc.seed, si, 91));
  const streets = new Set(), bld = [];
  const solid = k => { const t = tiles.get(k); return !!t && !(t[1] & CLEAR_FLAG); };   // a road or lot already there
  // the newest tier at distance d (0 middle, 1 edge): the whole middle at the top tier, falling off outward
  const ring = d => Math.max(0, Math.min(L, Math.round(L * (1 - Math.min(d, 1) ** 2))));
  const street = (tx, ty, t, qx = 1, qy = 1) => {
    if (!land(tx, ty)) return false;
    const k = tx + ty * W;
    streets.add(k);
    if (!solid(k)) tiles.set(k, [O.HUT + qx, TOWN_FLAG | ROAD_FLAG | IN_TOWN | t, qy]);
    return true;
  };
  // arms: one out to each road that leaves this town (straight to where the road starts), then a few of its own,
  // wandering off into the country and petering out (villages 1-3 arms in all, megalopolises 4-6)
  const want = [1, 2, 3, 3, 4, 4][L] + Math.floor(r() * 3);
  const angles = arms.map(p => Math.atan2(p[1] - cy - 0.5, p[0] - cx - 0.5));
  for (const p of arms) for (const [tx, ty, qx, qy] of rasterize([[cx + 0.5, cy + 0.5], p])) {
    const d = Math.hypot(tx - cx, ty - cy) / R;
    street(tx, ty, ring(d), qx, qy);
  }
  for (let tries = 0; angles.length < want && tries < 30; tries++) {
    const ang = r() * TAU;
    if (angles.some(b => Math.abs(mod(ang - b + Math.PI, TAU) - Math.PI) < 0.95)) continue;
    angles.push(ang);
    const len = R * TW.roads[L] * (0.6 + 0.5 * r()), sd = (r() * 1e6) | 0, pts = [[cx + 0.5, cy + 0.5]];
    let a = ang, x = cx + 0.5, y = cy + 0.5;
    for (let k = 1; k <= len; k++) {
      if (k * 1 > R * 0.5) a += (vnoise(k / 9, 0.5, sd) - 0.5) * 0.16;   // straight in town, wandering outside
      x += Math.cos(a); y += Math.sin(a); pts.push([x, y]);
    }
    for (const [tx, ty, qx, qy] of rasterize(pts)) {
      const d = Math.hypot(tx - cx, ty - cy) / R;
      if (!street(tx, ty, d <= 1 ? ring(d) : Math.max(0, L - 2), qx, qy)) break;   // a track ends at the water
    }
  }
  // from City up: a grid of cross streets, set off by a random amount so not every city is centred on a crossing
  const B = TW.block[L], P = B ? B * 2 + 1 : 5, gx = (r() * P) | 0, gy = (r() * P) | 0;
  if (B) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (Math.hypot(dx, dy) > R + 0.5 || (mod(dx - gx, P) && mod(dy - gy, P))) continue;
    street(cx + dx, cy + dy, ring(Math.hypot(dx, dy) / R));
  }
  // lots: those whose corner sits at an odd step from the grid, inside the (slightly ragged) edge, clear of streets.
  // Without a grid (villages, towns), houses keep to the streets: a lot away from one is seldom built on
  const fill = TW.fill[L], near = (tx, ty, n) => {
    for (let y = ty - n; y <= ty + 1 + n; y++) for (let x = tx - n; x <= tx + 1 + n; x++) if (streets.has(x + y * W)) return true;
    return false;
  };
  for (let dy = -R - 2; dy <= R + 1; dy++) for (let dx = -R - 2; dx <= R + 1; dx++) {
    const mx = mod(dx - gx, P), my = mod(dy - gy, P);
    if (!(mx & 1) || !(my & 1)) continue;
    const d = Math.hypot(dx + 1, dy + 1) / R;
    const edge = 1 + (r() - 0.5) * 0.3, pick = r(), tj = r(), vj = r(), sj = r(), jx = r(), jy = r();
    if (d > edge) continue;
    const tx = cx + dx, ty = cy + dy, ks = [tx + ty * W, tx + 1 + ty * W, tx + (ty + 1) * W, tx + 1 + (ty + 1) * W];
    if (ks.some(k => streets.has(k) || solid(k))) continue;
    if (!build(tx, ty) || !build(tx + 1, ty) || !build(tx, ty + 1) || !build(tx + 1, ty + 1)) continue;
    const tier = Math.max(0, Math.min(L, Math.round(L * (1 - Math.min(d, 1) ** 2) + (tj - 0.5) * 1.3)));
    // towers stand a little apart (TW.gap): the lots between them, and any empty lot downtown, are paved plazas
    let p = fill * (d < 0.55 ? 1 : 1 - (d - 0.55) * 1.1) * (1 - TW.gap[tier]);
    if (!B && !near(tx, ty, 1)) p *= 0.2;
    const built = pick <= p;
    if (!built && !(tier >= 3 && d < 0.6)) continue;
    for (const k of ks) tiles.set(k, [built ? TOWN_OV[tier] : O.BLOCK, TOWN_FLAG | IN_TOWN | tier]);
    if (!built) continue;
    const old = tier <= 1;                                // cottages and houses stand a little out of line
    const fx = Math.round((tx + 1) * 8 + (old ? (jx - 0.5) * 5 : 0)), fy = Math.round((ty + 2) * 8 - 2 - (old ? jy * 2.5 : 0));
    bld.push([fx, fy, tier * 4 + ((vj * 4) | 0), TW.size[tier] * (0.94 + sj * 0.12), tileHash(tx, ty)]);
    // a yard round it, clear of trees (a tree in front would stand over the house): 1 tile each side, 2 in front
    for (let y = ty - 1; y <= ty + 3; y++) for (let x = tx - 1; x <= tx + 2; x++) {
      const k = x + y * W;
      if (!tiles.has(k) && land(x, y)) tiles.set(k, [O.HUT, TOWN_FLAG | CLEAR_FLAG]);
    }
  }
  // downtown (apartments up) is paved all over: the odd tiles a slanting street cut off a lot become plaza too
  if (L >= 3) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const t = ring(Math.hypot(dx, dy) / R), k = cx + dx + (cy + dy) * W;
    if (t >= 3 && !solid(k) && build(cx + dx, cy + dy)) tiles.set(k, [O.BLOCK, TOWN_FLAG | IN_TOWN | t]);
  }
  return bld;
}

// Everything about a planet's settlements, worked out once: where they are, the roads, and every town tile and
// building, bucketed by BUCKET-tile squares for the chunks to look up
function buildWorld(desc, sampler) {
  const W = desc.W, settlements = placeSettlements(desc, sampler);
  const memo = new Map();
  const ground = (tx, ty) => {                            // a tile's ground (-1 off the map)
    if (tx < 0 || ty < 0 || tx >= W || ty >= W) return -1;
    const k = tx + ty * W;
    let g = memo.get(k);
    if (g === undefined) {
      const u = (tx + 0.5) / W * 2 - 1, v = (ty + 0.5) / W * 2 - 1;
      g = u * u + v * v < 0.98 ? sampler.classify(u, v) : -1;
      memo.set(k, g);
    }
    return g;
  };
  const land = (tx, ty) => { const g = ground(tx, ty); return g >= 0 && ROAD_COST[g] < Infinity; };   // a road can go here
  const build = (tx, ty) => BUILD_GROUND.has(ground(tx, ty));                                       // a house can stand here
  const tiles = new Map(), bld = [];
  const roads = settlements.length > 1 ? roadNetwork(settlements, desc, sampler, land) : [];
  // where each road leaves its towns: its first point past the town's edge; the town runs a straight arm out to it
  const arms = settlements.map(() => []);
  for (const rd of roads) {
    const cut = (s, pts) => {
      const cx = (s.u * 0.5 + 0.5) * W, cy = (s.v * 0.5 + 0.5) * W, R = s.radius * 0.85 + 1;
      let i = 0;
      while (i < pts.length - 1 && Math.hypot(pts[i][0] - cx, pts[i][1] - cy) < R) i++;
      return i;
    };
    const i0 = cut(settlements[rd.a], rd.pts), i1 = rd.pts.length - 1 - cut(settlements[rd.b], [...rd.pts].reverse());
    if (i1 <= i0) { rd.pts = []; continue; }
    arms[rd.a].push(rd.pts[i0]); arms[rd.b].push(rd.pts[i1]);
    rd.pts = rd.pts.slice(i0, i1 + 1);
  }
  settlements.forEach((s, i) => bld.push(...townLayout(s, i, desc, land, build, tiles, arms[i])));
  // the roads between towns, where nothing else is
  for (const rd of roads) if (rd.pts.length > 1) for (const [tx, ty, qx, qy] of rasterize(rd.pts)) {
    const k = tx + ty * W;
    const t = tiles.get(k);
    if ((!t || (t[1] & CLEAR_FLAG)) && land(tx, ty)) tiles.set(k, [O.HUT + qx, TOWN_FLAG | ROAD_FLAG | rd.tier, qy]);
  }
  // beside each diagonal step of a road, the two tiles it cuts across stay clear of trees
  const isRoad = k => { const t = tiles.get(k); return !!t && (t[1] & ROAD_FLAG) !== 0; };
  for (const [k, t] of [...tiles]) {
    if (!(t[1] & ROAD_FLAG)) continue;
    const x = k % W, y = (k / W) | 0;
    for (const [dx, dy] of [[1, 1], [-1, 1]]) {
      const kd = x + dx + (y + dy) * W, ka = x + dx + y * W, kb = x + (y + dy) * W;
      if (!isRoad(kd) || isRoad(ka) || isRoad(kb)) continue;
      for (const kc of [ka, kb]) if (!tiles.has(kc)) tiles.set(kc, [O.HUT, TOWN_FLAG | CLEAR_FLAG]);
    }
  }
  const bucket = (x, y) => Math.floor(x / BUCKET) + Math.floor(y / BUCKET) * 4096;
  const tileB = new Map(), bldB = new Map();
  for (const [k, t] of tiles) {
    const b = bucket(k % W, (k / W) | 0);
    let l = tileB.get(b); if (!l) tileB.set(b, l = []);
    l.push(k, t[0], t[1], t[2] || 0);
  }
  for (const o of bld) {
    const b = bucket(o[0] >> 3, o[1] >> 3);
    let l = bldB.get(b); if (!l) bldB.set(b, l = []);
    l.push(o);
  }
  return { settlements, tiles, tileB, bldB, roads: roads.length };
}
// the buckets a square of tiles [x0, x1) x [y0, y1) touches
function* bucketsOf(map, x0, y0, x1, y1) {
  for (let by = Math.floor(y0 / BUCKET); by <= Math.floor((y1 - 1) / BUCKET); by++)
    for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor((x1 - 1) / BUCKET); bx++) {
      const l = map.get(bx + by * 4096);
      if (l) yield l;
    }
}
// one chunk's buildings as instances for the renderer's town layer: per building 4 x uint32 = the top-left of its
// 16 x 24 art px box (foot at (8, 23) in it), atlas cell + size * 256 << 16, a hash; front to back
function townSpots(world, x0, y0, sx, sy) {
  const out = [];
  for (const l of bucketsOf(world.bldB, x0, y0, x0 + sx, y0 + sy)) for (const [fx, fy, cell, size, h] of l) {
    const tx = fx >> 3, ty = fy >> 3;
    if (tx < x0 || ty < y0 || tx >= x0 + sx || ty >= y0 + sy) continue;
    out.push([fx - 8, fy - 23, cell | (Math.round(size * 256) << 16), h]);
  }
  out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const u32 = new Uint32Array(out.length * 4);
  out.forEach((o, i) => u32.set(o, i * 4));
  return u32;
}

// One chunk ("page") of a planet's map. The disk's square is sampled on an N x N grid (N = the full tile count
// at the finest detail level, fewer at coarser levels); this builds the sx x sy block starting at (x0, y0).
// Every sample reads the same noise, so coarse and fine levels show the same continents. Samples outside the
// disk copy the ground just inside the rim (clean edges) and aren't counted.
// Returns tile ids (4 bytes each: ground, overlay, deposit richness 0..255, cliff mask 0/255), the colour map (RGBA: average tile colour + glow),
// counts per id, and the planet's settlement list.
const settleMemo = new Map();
// street colours by tier (as the shader's townGround draws them): dirt track, gravel, cobbles, asphalt
const ROAD_COL = [[132, 112, 84], [140, 122, 94], [128, 122, 114], [84, 86, 90]];
export function generatePage(desc, art, N, x0, y0, sx, sy) {
  const t0 = performance.now();
  const sampler = makeSampler(desc);
  const ids = new Uint8Array(sx * sy * 4);
  // elevation (and shading relief) on the chunk plus a 1-sample border, so slopes at the edges match the neighbours
  const GW = sx + 2, GH = sy + 2, tps = desc.W / N;
  sampler.setTps(tps);
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
  // tile (x, y) of the chunk (-1 .. sx, -1 .. sy: one tile past each edge too) -> ground, overlay, richness into out[i..]
  function tile(x, y, out, i) {
    const u = ((x0 + x + 0.5) / N) * 2 - 1, v = ((y0 + y + 0.5) / N) * 2 - 1;
    if (Math.hypot(u, v) > 1) {
      if (!rim) {                         // the ground just inside the rim, all the way round (only if needed)
        RIM = Math.min(4096, N * 2); rim = new Uint8Array(RIM);
        for (let k = 0; k < RIM; k++) { const a = (k + 0.5) / RIM * TAU; rim[k] = sampler.classify(Math.cos(a) * 0.995, Math.sin(a) * 0.995); }
      }
      out[i] = rim[Math.floor(((Math.atan2(v, u) + TAU) % TAU) / TAU * RIM) % RIM]; out[i + 1] = 0;
      return;
    }
    const base = sampler.classify(u, v, 0, E[(y + 1) * GW + x + 1]);
    out[i] = base;
    const ov = sampler.deposit(u, v, 0, base);
    out[i + 1] = ov; out[i + 2] = ov ? Math.round(sampler.deposit.rich * 255) : 0;
  }
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) tile(x, y, ids, (y * sx + x) * 4);
  // settlements, their towns and the roads between them (worked out once per planet, at full detail): paint them
  const key = desc.id + '/' + desc.W;
  let memo = settleMemo.get(key);
  if (!memo) {
    memo = buildWorld(desc, sampler);
    sampler.setTps(tps);
    settleMemo.set(key, memo);
    if (settleMemo.size > 40) settleMemo.clear();
  }
  const settlements = memo.settlements, kN = N / desc.W;
  const roadY = N === desc.W ? new Uint8Array(sx * sy) : null;   // each road tile's y quarter (for the shader)
  for (const l of bucketsOf(memo.tileB, Math.floor(x0 / kN), Math.floor(y0 / kN), Math.ceil((x0 + sx) / kN), Math.ceil((y0 + sy) / kN))) {
    for (let j = 0; j < l.length; j += 4) {
      const k = l[j], f = l[j + 2];
      if (kN < 1 && (f & CLEAR_FLAG)) continue;
      const x = Math.floor((k % desc.W) * kN) - x0, y = Math.floor(Math.floor(k / desc.W) * kN) - y0;
      if (x < 0 || y < 0 || x >= sx || y >= sy) continue;
      const i = (y * sx + x) * 4;
      if (WATER.has(ids[i])) continue;
      if (ids[i + 1] >= O.HUT && (ids[i + 2] & TOWN_FLAG) && !(ids[i + 2] & (ROAD_FLAG | CLEAR_FLAG)) && (f & ROAD_FLAG)) continue;   // coarse: lots win
      ids[i + 1] = l[j + 1]; ids[i + 2] = f;
      if (roadY) roadY[y * sx + x] = l[j + 3];
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
    const tf = ids[t * 4 + 2];
    if (ov >= O.HUT && (tf & ROAD_FLAG)) {
      // a road: its colour, fading out on maps too coarse to show a road one tile wide
      const c = ROAD_COL[Math.min(3, tf & 15)], k = 0.85 * Math.min(1, ((tf & IN_TOWN) ? 4 : 2.5) / tps);
      r += (c[0] - r) * k; g += (c[1] - g) * k; b += (c[2] - b) * k;
    } else if (ov >= O.HUT && (tf & CLEAR_FLAG)) {
      // beside a road: plain ground
    } else if (ov) {
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
  const props = N === desc.W ? propSpots(ids, N, x0, y0, sx, sy, BIG, desc.straggle) : null;
  const small = N === desc.W ? propSpots(ids, N, x0, y0, sx, sy, SMALL, desc.straggle) : null;
  const town = N === desc.W ? townSpots(memo, x0, y0, sx, sy) : null;
  // What the shader reads (idsA): the ids again with a one-tile border taken from the neighbouring chunks, so borders
  // blend across chunk edges without a seam, and byte 3 = cliff (128) + tiles from the nearest water (0-7)
  const AW = sx + 2, AH = sy + 2, idsA = new Uint8Array(AW * AH * 4);
  for (let y = 0; y < sy; y++) idsA.set(ids.subarray(y * sx * 4, (y + 1) * sx * 4), ((y + 1) * AW + 1) * 4);
  for (let y = -1; y <= sy; y++) for (let x = -1; x <= sx; x++) {
    const a = ((y + 1) * AW + x + 1) * 4;
    if (y >= 0 && y < sy && x >= 0 && x < sx) { idsA[a + 3] = ids[(y * sx + x) * 4 + 3] ? 128 : 0; continue; }
    tile(x, y, idsA, a);
    if (N === desc.W && !WATER.has(idsA[a])) {             // a neighbouring chunk's town or road tile (roads join up)
      const t = memo.tiles.get(x0 + x + (y0 + y) * desc.W);
      if (t) { idsA[a + 1] = t[0]; idsA[a + 2] = t[1]; }
    }
    const g = (y + 1) * GW + x + 1, base = idsA[a], ov = idsA[a + 1];
    idsA[a + 3] = !WATER.has(base) && base !== T.SEA_ICE && !(ov >= O.HUT) && (CLIFF_GROUND.has(base) || Vr[g] > 0.42) ? 128 : 0;
  }
  if (N === desc.W && SEA_TYPES.has(desc.type)) shoreDistance(idsA, AW, AH, (x, y) => {
    // a tile WET_R past the border: water if it's under the sea and classifies as water (elevation first, it's cheaper)
    const u = ((x0 + x + 0.5) / N) * 2 - 1, v = ((y0 + y + 0.5) / N) * 2 - 1;
    if (u * u + v * v > 1) return false;
    const e = sampler.elev(u, v);
    return e < sampler.sea && WATER.has(sampler.classify(u, v, 0, e));
  });
  else for (let i = 3; i < idsA.length; i += 4) idsA[i] |= 7;
  // bit 64 of byte 3: a road on this tile or next to it (the shader only looks for roads there)
  if (N === desc.W) for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const a = (y * AW + x) * 4;
    if (idsA[a + 1] < O.HUT || (idsA[a + 2] & (TOWN_FLAG | ROAD_FLAG)) !== (TOWN_FLAG | ROAD_FLAG)) continue;
    const inside = x >= 1 && y >= 1 && x <= sx && y <= sy;
    const qy = inside ? roadY[(y - 1) * sx + x - 1] : (memo.tiles.get(x0 + x - 1 + (y0 + y - 1) * desc.W) || [])[2] || 0;
    idsA[a + 3] = (idsA[a + 3] & ~24) | (qy << 3);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < AW && ny < AH) idsA[(ny * AW + nx) * 4 + 3] |= 64;
    }
  }
  return { ids, idsA, col, fld, counts, settlements, props, small, town, ms: performance.now() - t0 };
}

// Tiles from the nearest water (deep or shallow) for every tile of an id map with its border (idsA: AW x AH, byte 3's
// low bits; 0 on water, 7 = 7 or more), for wet ground along shores. Looks WET_R tiles past the map's border too
// (waterAt(x, y), chunk tile coordinates), so the wet band runs on across chunk edges. Chamfer distance (3 / 4)
const WET_R = 7, SEA_TYPES = new Set(['terran', 'ocean', 'tundra', 'desert', 'lab']);
function shoreDistance(idsA, AW, AH, waterAt) {
  const R = WET_R, GW = AW + 2 * R, GH = AH + 2 * R, BIG = 255, D = new Uint8Array(GW * GH).fill(BIG);
  let any = false;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const ax = x - R, ay = y - R;
    const w = ax >= 0 && ay >= 0 && ax < AW && ay < AH ? WATER.has(idsA[(ay * AW + ax) * 4]) : waterAt(ax - 1, ay - 1);
    if (w) { D[y * GW + x] = 0; any = true; }
  }
  if (any) {
    const at = (x, y) => x < 0 || y < 0 || x >= GW || y >= GH ? BIG : D[y * GW + x];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      D[i] = Math.min(D[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
    for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
      const i = y * GW + x;
      D[i] = Math.min(D[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const a = (y * AW + x) * 4 + 3;
    idsA[a] = (idsA[a] & 128) | Math.min(7, Math.round(D[(y + R) * GW + x + R] / 3));
  }
}

// Items (trees, boulders, shrubs, grass) stand on spots. Big items: one spot per 12 x 12 cell of art pixels (8 art px
// per tile); small items: one per 8 x 8 cell. Each spot is nudged inside its cell by a hash, with the foot at art px
// (8, 22) of the sprite's 16 x 24 box. A spot belongs to the chunk its foot is in. Whether something grows there, and
// what, is decided when drawing (from the biome tables), so densities and kinds change without rebuilding maps.
// Per spot: box corner (art px x, y), ground id, the spot's hash. Sorted top to bottom, so drawing in order puts
// nearer items in front. The big grid uses the same hash as the old in-shader props.
// straggle (biomes.js straggleTable, or null): per ground id, how far its items wander into neighbouring ground, in
// tiles. A spot looks at a random tile up to that far away (from its own hash); if that tile's ground straggles at
// least that far, the spot grows that ground's items, so forests thin out into the grass instead of stopping at a
// line. Only tiles inside the chunk are looked at
const BIG = { cell: 12, salt: [0x2b9f, 0x6d31] }, SMALL = { cell: 8, salt: [0x51ed, 0x2701] };
function propSpots(ids, N, x0, y0, sx, sy, grid, straggle) {
  const out = [], PG = grid.cell, SM = straggle ? Math.max(...straggle) : 0;
  const cxA = Math.floor((x0 * 8 - 8 - PG + 1) / PG), cxB = Math.floor(((x0 + sx) * 8 - 8) / PG);
  const cyA = Math.floor((y0 * 8 - 22 - PG + 1) / PG), cyB = Math.floor(((y0 + sy) * 8 - 22) / PG);
  for (let cy = cyA; cy <= cyB; cy++) for (let cx = cxA; cx <= cxB; cx++) {
    const h = tileHash(cx ^ grid.salt[0], cy ^ grid.salt[1]);
    const ax = cx * PG + (h & 15) % PG, ay = cy * PG + ((h >>> 4) & 15) % PG;
    const fx = (ax + 8) >> 3, fy = (ay + 22) >> 3;
    if (fx < x0 || fy < y0 || fx >= x0 + sx || fy >= y0 + sy) continue;
    const u = (fx + 0.5) / N * 2 - 1, v = (fy + 0.5) / N * 2 - 1;
    if (u * u + v * v > 1) continue;                              // outside the disk
    const i = ((fy - y0) * sx + (fx - x0)) * 4;
    let g = ids[i];
    if (ids[i + 1] || WATER.has(g)) continue;                     // deposits and buildings keep their tile clear
    if (SM > 0) {
      const h2 = tileHash(cx ^ 0x3d1f, cy ^ 0x7a45);
      const dx = Math.round(((h2 & 1023) / 1023 * 2 - 1) * SM), dy = Math.round((((h2 >>> 10) & 1023) / 1023 * 2 - 1) * SM);
      const tx = fx + dx, ty = fy + dy;
      if ((dx || dy) && tx >= x0 && ty >= y0 && tx < x0 + sx && ty < y0 + sy) {
        const g2 = ids[((ty - y0) * sx + (tx - x0)) * 4];
        if (g2 !== g && !WATER.has(g2) && straggle[g2] >= Math.max(Math.abs(dx), Math.abs(dy))) g = g2;
      }
    }
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
