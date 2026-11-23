/*
 * Map Conquest: a territory-conquest game on the Map Factory disk world and its solar system.
 * You and the AI nations share one pool of troops each; click land to attack it. Troops cross
 * your border on foot, cross water by boat, and cross space by rocket from a launch pad.
 * Every landable body (the disk, the Moon, the planets, the giants' moons) is its own tile map.
 */
'use strict';

// ======================================================================
// CONFIG: all tuning numbers live here
// ======================================================================
const CFG = {
  // the home disk (same generator and numbers as Map Factory)
  diskSize: 1000, continentScale: 115, climateScale: 150,
  iceWall: { min: 2.5, extra: 4 }, waterFraction: 0.5, mountainShare: 0.13, desertShare: 0.24,

  bots: 22, botSpacing: 60, spawnTiles: 120,
  peace: 60,                    // seconds before AI nations start attacking other nations

  // --- Troops, gold and combat follow OpenFront's published rules (10 ticks a second) ---
  startTroops: 25000,
  ai: { start: 18750, cap: 0.75, growth: 0.95 },   // AI nations compared with you: starting troops, troop cap, growth
  // troop cap = 2 x (tiles^0.6 x 1000 + 50,000) + 250,000 per city
  capTilePow: 0.6, capTileMul: 1000, capBase: 50000, capPerCity: 250000,
  // troops added per tick = (10 + troops^0.73 / 4) x (1 - troops / cap): fastest at about 42% full
  growBase: 10, growPow: 0.73, growDiv: 4,
  goldPerTick: 100, portGoldPerTick: 25,       // ports pay a flat bonus until trade ships exist

  // per terrain [space, water, plain, rough, peak]:
  // mag = troops an attack loses on the tile, tileCost = how slow it is to take, prio = how late it is taken
  mag: [0, 0, 80, 100, 120], tileCost: [0, 0, 16.5, 20, 25], prio: [0, 0, 1, 1.5, 2],
  fortRadius: 30, fortMag: 5, fortSlow: 3,     // a fort makes its owner's land in range cost 5x the troops and take 3x as long
  pocketMax: 1500,                             // enemy land cut off by an attack falls at once if it is this many tiles or fewer
  aimBias: 0.4,                                // your attacks reach land near where you clicked sooner: ticks of delay per tile of distance
  conquerBelow: 100,                           // a nation pushed under this many tiles falls to its attacker, gold and all

  // cost: the first one; double: each one you own doubles it; step: each one adds the base again; max: the ceiling
  buildings: {
    city: { key: '1', name: 'City', cost: 125000, double: true, max: 1000000, desc: 'Raises your troop cap by 250,000.' },
    port: { key: '2', name: 'Port', cost: 125000, double: true, max: 1000000, desc: 'Must touch water. Earns 250 gold a second.' },
    fort: { key: '3', name: 'Fort', cost: 50000, step: true, max: 250000, desc: 'Attackers lose 5x the troops and move 3x slower on your land within 30 tiles. Destroyed when captured.' },
    pad:  { key: '4', name: 'Launch pad', cost: 300000, max: 300000, desc: 'Launches rocket expeditions to other worlds in range. Click land on another world to launch.' },
    silo: { key: '5', name: 'Missile silo', cost: 250000, max: 250000, desc: 'Launches atom and hydrogen bombs at targets on the same world.' },
    sam:  { key: '6', name: 'Air defense', cost: 300000, step: true, max: 900000, desc: 'Shoots at enemy bombs aimed within 70 tiles of it. Reloads for 7.5 seconds after each shot.' },
    rig:  { key: '7', name: 'Mining rig', cost: 150000, step: true, max: 900000, desc: 'Strips the land within 9 tiles to bare rock and pays gold for the ore in it: nothing for grassland, some for rough ground, most for mountains. Far richer off the disk. Mined rock no longer counts toward your troop cap.' },
  },

  // bombs: a blast razes all land within `inner` tiles and about half of it out to `outer`; razed land is free again,
  // its buildings are gone, and its owner loses the same share of troops. samHit = chance air defense stops it.
  nuke: { speed: 30, cooldown: 7.5, samRange: 70, samCooldown: 7.5 },
  nukes: {
    atom:  { key: '8', name: 'Atom bomb', cost: 150000, inner: 10, outer: 22, samHit: 0.9, desc: 'Fired from a missile silo. Razes land and buildings about 22 tiles around the target.' },
    hydro: { key: '9', name: 'Hydrogen bomb', cost: 1000000, inner: 45, outer: 60, samHit: 0.75, desc: 'Fired from a missile silo. Razes land and buildings about 60 tiles around the target.' },
  },

  // Mining rig: gold per tick = gold x (ore in reach) x the world's richness. Ore per tile by terrain
  // [space, water, plain, rough, peak]. Tiles already mined by another rig pay nothing.
  rig: { radius: 9, gold: 0.2, ore: [0, 0, 0, 0.4, 1], richSpace: 3,
    rich: { 'the Disk': 1, 'the Moon': 2, 'Vulcan': 4, 'Aries': 2.5, 'the Seed World': 3 } },

  boatSpeed: 10, maxBoats: 3,    // tiles per second; boats at sea per nation
  // Rocket range in AU = range + rangePerOrbit x (the pad's distance from the Sun in AU): the weaker the Sun's pull,
  // the further a rocket flies, so each world further out is a stepping stone to the next.
  // Flight seconds = timeBase + timeK x sqrt(distance in tiles).
  rocket: { cost: 30000, cooldown: 25, range: 1.6, rangePerOrbit: 2.2, timeBase: 8, timeK: 0.08 },

  winShare: 0.7,                 // share of all land in the system
  tickHz: 10, botThink: 1.5,
  scanTiles: 100000,             // tiles of border scanning per tick (the whole system takes about 3 seconds)

  // the solar system, as defined in Map Factory (distances in tiles)
  space: {
    au: 360000, year: 720, sunR: 6000,
    moon: { r: 130, orbit: 15000, period: 240 },
    vulcan: { r: 350, orbit: 0.45, year: 217 },
    aries: { r: 265, orbit: 1.5 },
    zeus: { r: 2500, orbit: 3.2 },
    poseidon: { r: 1900, orbit: 5.0 },
    seedWorld: { r: 420, orbit: 7.5 },
  },
  zoomMin: 0.00008, zoomMax: 24,
};

// ======================================================================
// helpers
// ======================================================================
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const TAU = Math.PI * 2;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 131); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = n => { const k = (n + h * 12) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const css = (c, a) => (a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return n.toLocaleString();
}
const fmtTime = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function quant(list, q) {
  const a = Float32Array.from(list).sort();
  return a.length ? a[clamp(Math.floor(a.length * q), 0, a.length - 1)] : 0;
}
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const SEED = params.has('seed') ? (parseInt(params.get('seed'), 10) || 1) : ((Math.random() * 1e6) | 0);
const rng = mulberry32(SEED ^ 0x9e3779b9);
const pick = list => list[(rng() * list.length) | 0];

// ======================================================================
// icons: one 24 x 24 outline each, used on the map (canvas) and in the HUD (inline SVG)
// ======================================================================
const ICON_D = {
  city: 'M3 21V11h5v10zM9.5 21V4h5v17zM16 21V8h5v13zM11 6.5h2v2h-2zM11 10.5h2v2h-2zM11 14.5h2v2h-2z',
  port: 'M12 2a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 0 1 0-5.2zm0 1.7a.9.9 0 1 0 0 1.8a.9.9 0 0 0 0-1.8zM11 7h2v2h3.5v2H13v8.8c2.6-.4 4.6-2.4 5-5l-1.8.2l2.8-3.5l2 4l-1.3-.3c-.5 4-3.8 6.8-7.7 6.800s-7.200-2.800-7.700-6.800L3 15.500l2-4l2.800 3.500L6 14.800c.4 2.600 2.400 4.600 5 5V11H7.500V9H11z',
  fort: 'M12 2l8 3v6.5c0 4.800-3.300 8.900-8 10.500c-4.700-1.600-8-5.700-8-10.500V5zM12 5.200v13.800c2.900-1.300 5-4.200 5-7.500V7.100z',
  pad: 'M12 1.5c2.800 2.300 4 5.500 4 8.500v6H8v-6c0-3 1.200-6.200 4-8.500zm0 5.500a1.800 1.800 0 1 0 0 3.600a1.800 1.800 0 0 0 0-3.600zM8 12.500L4.500 16v4L8 18zM16 12.500l3.500 3.500v4L16 18zM10 17.500h4l-2 5z',
  silo: 'M12 2c1.900 1.700 2.800 3.800 2.800 6.200V16H9.200V8.200C9.200 5.800 10.100 3.700 12 2zM6.500 12.500h1.700V16H6.500zM15.800 12.500h1.700V16h-1.700zM4 17.500h16V22H4z',
  sam: 'M3 20h18v2H3zM11 15.500h2V20h-2zM5 9h14a7 7 0 0 1-14 0zM11.300 4.500h1.400V9h-1.400zM12 2a1.600 1.600 0 1 1 0 3.200a1.600 1.600 0 0 1 0-3.200z',
  atom: 'M12 2c4.700 0 8.500 2.500 8.500 5.600c0 2-1.900 3.400-4.500 3.400h-1.500l.9 7h3.100v3h-13v-3h3.100l.9-7H8c-2.600 0-4.500-1.400-4.500-3.400C3.500 4.500 7.300 2 12 2z',
  sail: 'M11 2v11H4zM13 5l7 8h-7z',
  hull: 'M2 15h20l-3.500 6h-13z',
  rocket: 'M12 1.500c2.800 2.300 4 5.500 4 8.500v6H8v-6c0-3 1.200-6.200 4-8.500zM8 12.500L4.500 16v4L8 18zM16 12.500l3.500 3.500v4L16 18z',
  missile: 'M12 1c2 2 2.800 4.500 2.800 7v9l2.200 3v2H7v-2l2.200-3V8c0-2.500.8-5 2.800-7z',
  rig: 'M12 1.500l1.600 3h-3.200zM10 5.500h4l4.200 14.500h-2.400l-.9-3.200H9.100L8.200 20H5.800zM10.700 8.500l-.8 2.800h4.200l-.8-2.800zM9.500 13.300l-.6 2h6.200l-.6-2zM3 20.500h18V22.500H3z',
  sword: 'M19 2h3v3L10.500 16.500l1.500 1.500l-1.500 1.500l-2-2L5 21H3v-2l3.500-3.500l-2-2L6 12l1.500 1.500z',
};
ICON_D.boat = ICON_D.sail + ICON_D.hull;
ICON_D.hydro = (() => {   // a twelve-point burst with a hollow core
  let d = '';
  for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12 - Math.PI / 2, r = k % 2 ? 6 : 11; d += (k ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (12 + Math.sin(a) * r).toFixed(2); }
  return d + 'zM12 9.200a2.800 2.800 0 1 0 0 5.600a2.800 2.800 0 0 0 0-5.600z';
})();
const ICON = {};
for (const k in ICON_D) ICON[k] = new Path2D(ICON_D[k]);
const svgIcon = (name, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="currentColor" fill-rule="evenodd" d="${ICON_D[name]}"/></svg>`;

// ======================================================================
// terrain
// ======================================================================
const VOID = 0, WATER = 1, PLAIN = 2, ROUGH = 3, PEAK = 4, WALL = 5;
const isLandT = t => t >= PLAIN && t <= PEAK;

// The home disk: continents inside an ice wall. Same recipe as Map Factory's generateTerrain.
function genDisk() {
  const S = CFG.diskSize, N = S * S, s = SEED, cx = S / 2, cy = S / 2, R = S / 2 - 2;
  const terr = new Uint8Array(N), rgb = new Uint8ClampedArray(N * 4);
  const elev = new Float32Array(N), moist = new Float32Array(N);
  const cs = CFG.continentScale;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r > R) continue;
    let wall = CFG.iceWall.min + CFG.iceWall.extra * 0.5;
    if (r > R * 0.9) {
      const ang = Math.atan2(dy, dx);
      wall = CFG.iceWall.min + fbm(Math.cos(ang) * 7 + 50, Math.sin(ang) * 7 + 50, s + 61, 3) * CFG.iceWall.extra;
    }
    if (r > R - wall) { terr[i] = WALL; continue; }
    terr[i] = 255;
    const wx = x + (fbm(x / 45, y / 45, s + 5, 3) - 0.5) * 36;
    const wy = y + (fbm(x / 45, y / 45, s + 9, 3) - 0.5) * 36;
    let e = fbm(wx / cs, wy / cs, s, 5) * 0.7 + fbm(wx / 32, wy / 32, s + 51, 4) * 0.3;
    const edge = clamp((R - wall - r) / (R * 0.07), 0, 1);
    e = e * (0.7 + 0.3 * edge) - (1 - edge) * 0.09;
    elev[i] = e;
    moist[i] = fbm(x / CFG.climateScale, y / CFG.climateScale, s + 77, 4);
  }
  const es = [];
  for (let i = 0; i < N; i += 7) if (terr[i] === 255) es.push(elev[i]);
  const sea = quant(es, CFG.waterFraction);
  const le = [], lm = [];
  let maxE = 0;
  for (let i = 0; i < N; i += 3) if (terr[i] === 255 && elev[i] > sea) { le.push(elev[i]); lm.push(moist[i]); if (elev[i] > maxE) maxE = elev[i]; }
  const mtn = quant(le, 1 - CFG.mountainShare), dry = quant(lm, CFG.desertShare);
  for (let i = 0; i < N; i++) {
    const t = terr[i], k = i * 4;
    if (t === VOID) continue;
    const tex = vnoise((i % S) / 3, ((i / S) | 0) / 3, s + 33);
    let c;
    if (t === WALL) c = mix([214, 230, 242], [238, 246, 252], tex);
    else if (elev[i] <= sea) { terr[i] = WATER; c = mix([96, 152, 192], [55, 108, 158], clamp((sea - elev[i]) / 0.1, 0, 1)); }
    else if (elev[i] >= mtn) { terr[i] = PEAK; c = mix([126, 122, 116], [240, 240, 244], clamp((elev[i] - mtn) / Math.max(0.001, maxE - mtn), 0, 1)); }
    else if (moist[i] <= dry) { terr[i] = ROUGH; c = mix([224, 202, 142], [202, 174, 114], tex); }
    else { terr[i] = PLAIN; c = mix([122, 170, 90], [94, 142, 74], tex); }
    rgb[k] = c[0]; rgb[k + 1] = c[1]; rgb[k + 2] = c[2]; rgb[k + 3] = 255;
  }
  return { S, R, terr, rgb, names: ['Space', 'Ocean', 'Grassland', 'Desert', 'Mountains', 'Ice wall'], tint: [110, 160, 140] };
}

// A round body seen face-on. o: { R, seed, scale, waterShare, roughShare, roughHigh, peakShare, pal, craters, names }
function genBody(o) {
  const R = o.R, S = 2 * R + 4, N = S * S, c0 = S / 2, s = o.seed;
  const terr = new Uint8Array(N), rgb = new Uint8ClampedArray(N * 4);
  const elev = new Float32Array(N), fld = new Float32Array(N);
  const es = [], fs = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) continue;
    terr[i] = 255;
    const wx = x + (fbm(x / 25, y / 25, s + 5, 2) - 0.5) * 16, wy = y + (fbm(x / 25, y / 25, s + 9, 2) - 0.5) * 16;   // warped, so coasts wander
    elev[i] = fbm(wx / o.scale, wy / o.scale, s, 5);
    fld[i] = fbm(x / (o.scale * 1.2), y / (o.scale * 1.2), s + 77, 3);
    if ((x + y * 3) % 5 === 0) { es.push(elev[i]); fs.push(fld[i]); }
  }
  const ws = o.waterShare || 0;
  const wl = ws ? quant(es, ws) : -1, pk = quant(es, 1 - o.peakShare);
  const rl = o.roughHigh ? quant(es, ws + (1 - ws - o.peakShare) * (1 - o.roughShare)) : 0;
  const fl = o.roughHigh ? 0 : quant(fs, o.roughShare);
  const P = o.pal;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, k = i * 4;
    if (terr[i] !== 255) continue;
    const e = elev[i], tex = vnoise(x / 3, y / 3, s + 9);
    let c;
    if (e < wl) { terr[i] = WATER; c = mix(P.water[0], P.water[1], clamp((wl - e) / 0.1, 0, 1)); }
    else if (e >= pk) { terr[i] = PEAK; c = mix(P.peak[0], P.peak[1], tex); }
    else if (o.roughHigh ? e > rl : fld[i] < fl) { terr[i] = ROUGH; c = mix(P.rough[0], P.rough[1], tex); }
    else { terr[i] = PLAIN; c = mix(P.plain[0], P.plain[1], tex); }
    const limb = 1 - 0.32 * Math.pow(Math.hypot(x + 0.5 - c0, y + 0.5 - c0) / R, 6);   // darker toward the rim, so it reads as a ball
    rgb[k] = c[0] * limb; rgb[k + 1] = c[1] * limb; rgb[k + 2] = c[2] * limb; rgb[k + 3] = 255;
  }
  const r2 = mulberry32(s + 5);
  for (let n = 0; n < (o.craters || 0); n++) {
    const a = r2() * TAU, d = Math.sqrt(r2()) * (R - 6), cr = 2 + r2() * r2() * 7;
    const cx = c0 + Math.cos(a) * d, cy = c0 + Math.sin(a) * d;
    for (let y = Math.floor(cy - cr); y <= cy + cr; y++) for (let x = Math.floor(cx - cr); x <= cx + cr; x++) {
      const q = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / cr, i = y * S + x;
      if (q > 1 || !isLandT(terr[i])) continue;
      const f = q > 0.72 ? 1.16 : 0.84, k = i * 4;
      rgb[k] *= f; rgb[k + 1] *= f; rgb[k + 2] *= f;
    }
  }
  return { S, R, terr, rgb, names: o.names, tint: P.plain[0] };
}

// ======================================================================
// the solar system
// ======================================================================
const bodies = [];   // everything in space, parents before children
const worlds = [];   // the landable ones (each has a tile map)
let HOME = null, SUN = null, totalLand = 0;

function addBody(b) {
  b.ix = bodies.length; b.x = 0; b.y = 0;
  if (b.phase == null) b.phase = rng() * TAU;
  bodies.push(b);
  return b;
}
function addWorld(b, map) {
  const w = Object.assign(map, { ix: worlds.length, body: b, name: b.name, N: map.S * map.S });
  w.owner = new Uint16Array(w.N);          // 0 = nobody, else player id
  w.blds = new Map();                      // tile -> building
  w.forts = []; w.sams = [];
  w.mined = new Uint8Array(w.N);         // 1 = stripped by a mining rig
  w.rich = CFG.rig.rich[b.name] || CFG.rig.richSpace;
  w.land = 0; w.owned = 0;
  for (let i = 0; i < w.N; i++) if (isLandT(w.terr[i])) w.land++;
  totalLand += w.land;
  w.terrCanvas = document.createElement('canvas');
  w.terrCanvas.width = w.terrCanvas.height = w.S;
  w.terrCanvas.getContext('2d').putImageData(new ImageData(w.rgb, w.S, w.S), 0, 0);
  w.rgb = null;
  w.ownCanvas = document.createElement('canvas');
  w.ownCanvas.width = w.ownCanvas.height = w.S;
  w.ownCtx = w.ownCanvas.getContext('2d');
  w.own = w.ownCtx.createImageData(w.S, w.S);
  w.d0x = w.S; w.d0y = w.S; w.d1x = -1; w.d1y = -1;   // dirty rectangle of the ownership overlay
  b.world = w; b.r = w.R; b.tint = w.tint;
  worlds.push(w);
  return w;
}

function buildSystem() {
  const sp = CFG.space, AU = sp.au, kepler = a => sp.year * Math.pow(a, 1.5);
  SUN = addBody({ name: 'the Sun', kind: 'sun', r: sp.sunR, parent: null });
  HOME = addBody({ name: 'the Disk', kind: 'world', parent: SUN, orbit: AU, period: sp.year });
  addWorld(HOME, genDisk());

  const grey = (a, b) => [[a, a, a + 6], [b, b, b + 6]];
  const moonMap = (R, seed, pal, names) => genBody({ R, seed, scale: 40, roughShare: 0.58, roughHigh: true, peakShare: 0.06, craters: R * 2.3, pal, names });
  const rocky = { plain: grey(98, 82), rough: grey(176, 150), peak: grey(216, 198) };

  const moon = addBody({ name: 'the Moon', kind: 'world', parent: HOME, orbit: sp.moon.orbit, period: sp.moon.period });
  addWorld(moon, moonMap(sp.moon.r, SEED + 1000, rocky, ['Space', '', 'Basalt plains', 'Highlands', 'Crater rims']));

  const vulcan = addBody({ name: 'Vulcan', kind: 'world', parent: SUN, orbit: AU * sp.vulcan.orbit, period: sp.vulcan.year });
  addWorld(vulcan, genBody({ R: sp.vulcan.r, seed: SEED + 2000, scale: 70, waterShare: 0.2, roughShare: 0.35, peakShare: 0.1,
    pal: { water: [[255, 176, 64], [208, 66, 18]], plain: [[60, 42, 46], [42, 30, 34]], rough: [[112, 98, 94], [88, 76, 74]], peak: [[150, 112, 82], [198, 152, 92]] },
    names: ['Space', 'Lava sea', 'Obsidian plains', 'Ash wastes', 'Heavy-metal ridges'] }));

  const aries = addBody({ name: 'Aries', kind: 'world', parent: SUN, orbit: AU * sp.aries.orbit, period: kepler(sp.aries.orbit) });
  addWorld(aries, genBody({ R: sp.aries.r, seed: SEED + 3000, scale: 60, roughShare: 0.3, peakShare: 0.08, craters: 70,
    pal: { plain: [[198, 106, 68], [178, 90, 58]], rough: [[152, 72, 50], [130, 60, 44]], peak: [[226, 172, 132], [240, 216, 192]] },
    names: ['Space', '', 'Rust plains', 'Canyon lands', 'Highlands'] }));

  const zeus = addBody({ name: 'Zeus', kind: 'giant', r: sp.zeus.r, parent: SUN, orbit: AU * sp.zeus.orbit, period: kepler(sp.zeus.orbit),
    bands: [[214, 178, 132], [176, 126, 86], [232, 206, 168], [158, 104, 74]] });
  const zm = [
    ['Aegis', 90, 5500, 160, { plain: [[200, 214, 226], [178, 194, 212]], rough: [[152, 172, 198], [132, 152, 182]], peak: [[240, 246, 252], [222, 232, 244]] }, ['Space', '', 'Ice plains', 'Blue ridges', 'Frost peaks']],
    ['Kratos', 70, 8000, 280, { plain: [[214, 190, 96], [192, 166, 78]], rough: [[176, 122, 62], [150, 100, 52]], peak: [[240, 226, 160], [226, 206, 130]] }, ['Space', '', 'Sulfur flats', 'Burnt hills', 'Yellow peaks']],
    ['Metis', 55, 11000, 450, rocky, ['Space', '', 'Dust plains', 'Highlands', 'Crater rims']],
  ];
  zm.forEach(([name, R, orbit, period, pal, names], k) => addWorld(addBody({ name, kind: 'world', parent: zeus, orbit, period }), moonMap(R, SEED + 4000 + k * 100, pal, names)));

  const pos = addBody({ name: 'Poseidon', kind: 'giant', r: sp.poseidon.r, parent: SUN, orbit: AU * sp.poseidon.orbit, period: kepler(sp.poseidon.orbit), ring: true,
    bands: [[86, 132, 214], [64, 104, 190], [120, 166, 230], [58, 92, 170]] });
  const pm = [
    ['Nereus', 85, 4500, 200, { plain: [[150, 196, 214], [128, 176, 198]], rough: [[96, 140, 176], [80, 120, 158]], peak: [[226, 242, 248], [204, 228, 240]] }, ['Space', '', 'Ice plains', 'Blue ridges', 'Frost peaks']],
    ['Pelagia', 60, 7000, 380, { plain: grey(74, 60), rough: grey(118, 100), peak: grey(168, 150) }, ['Space', '', 'Dark plains', 'Highlands', 'Crater rims']],
  ];
  pm.forEach(([name, R, orbit, period, pal, names], k) => addWorld(addBody({ name, kind: 'world', parent: pos, orbit, period }), moonMap(R, SEED + 5000 + k * 100, pal, names)));

  // the seed world: its look comes from the map seed
  const h = rng(), sat = 0.35 + rng() * 0.3;
  const seedW = addBody({ name: 'the Seed World', kind: 'world', parent: SUN, orbit: AU * sp.seedWorld.orbit, period: kepler(sp.seedWorld.orbit) });
  addWorld(seedW, genBody({ R: sp.seedWorld.r, seed: SEED + 6000, scale: 85, waterShare: 0.35 + rng() * 0.2, roughShare: 0.3, peakShare: 0.1,
    pal: { water: [hsl(h + 0.5, 0.5, 0.56), hsl(h + 0.5, 0.55, 0.36)], plain: [hsl(h, sat, 0.56), hsl(h, sat, 0.46)],
      rough: [hsl(h + 0.12, sat * 0.8, 0.66), hsl(h + 0.12, sat * 0.8, 0.54)], peak: [hsl(h, 0.08, 0.5), hsl(h, 0.08, 0.92)] },
    names: ['Space', 'Sea', 'Lowlands', 'Barrens', 'Mountains'] }));
}

function updatePositions(t) {
  for (const b of bodies) {
    if (!b.parent) { b.x = 0; b.y = 0; continue; }
    const a = b.phase + (t / b.period) * TAU;
    b.x = b.parent.x + Math.cos(a) * b.orbit; b.y = b.parent.y + Math.sin(a) * b.orbit;
  }
}
const bodyDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sunOrbit = b => (b.parent === SUN ? b.orbit : b.parent.orbit) / CFG.space.au;   // a moon counts as its planet
const rangeOf = b => (CFG.rocket.range + CFG.rocket.rangePerOrbit * sunOrbit(b)) * CFG.space.au;
const inRange = (a, b) => bodyDist(a, b) <= rangeOf(a);

// ======================================================================
// players and territory
// ======================================================================
const players = [null];   // players[id]; id 1 is you
const ME = 1;
const game = { time: 0, tickN: 0, gen: 0, pings: [], nukes: [], blasts: [], tracers: [], phase: 'spawn', paused: false, over: null, tool: null, attacks: [], boats: [], rockets: [], nextId: 1, scanIx: 0, scan: null, botSeaAt: 0 };

const NAME_A = ['Vel', 'Kor', 'Ash', 'Bel', 'Dra', 'Eth', 'Gor', 'Hal', 'Ix', 'Jor', 'Kes', 'Lum', 'Mor', 'Nar', 'Oth', 'Pyr', 'Quen', 'Ros', 'Syl', 'Tar', 'Ul', 'Var', 'Wyn', 'Zan'];
const NAME_B = ['mora', 'eth', 'ania', 'os', 'ara', 'una', 'ethus', 'or', 'ia', 'andor', 'ix', 'ovar', 'ael', 'ume', 'ath'];
const NAME_F = ['the Kingdom of %', 'the % Republic', 'the Free State of %', 'the Union of %', 'the % Empire', 'the Duchy of %', 'the % League'];
function makeName() { return pick(NAME_F).replace('%', pick(NAME_A) + pick(NAME_B)); }

function addPlayer(human) {
  const id = players.length;
  const p = { id, human, alive: true, name: human ? 'Your nation' : makeName(),
    color: human ? [250, 208, 64] : hsl(id * 0.618 + 0.05, 0.5 + (id % 3) * 0.1, 0.48 + (id % 2) * 0.1),
    troops: human ? CFG.startTroops : CFG.ai.start, gold: 0, goldRate: 0, troopRate: 0, tiles: 0, mined: 0, rigGold: 0,
    wt: worlds.map(() => 0), bb: worlds.map(() => null), nb: worlds.map(() => null),
    cnt: { city: 0, port: 0, fort: 0, pad: 0, silo: 0, sam: 0, rig: 0 }, nextThink: 2 + rng() * 3 };
  p.edge = p.color.map(v => Math.max(0, v - 32));   // border colour: the same colour, a step darker
  players.push(p);
  return p;
}
const capOf = p => (2 * (Math.pow(Math.max(0, p.tiles - p.mined), CFG.capTilePow) * CFG.capTileMul + CFG.capBase) + CFG.capPerCity * p.cnt.city) * (p.human ? 1 : CFG.ai.cap);
function costOf(p, type) {
  const b = CFG.buildings[type], n = p.cnt[type];
  return Math.min(b.max, b.double ? b.cost * Math.pow(2, n) : b.step ? b.cost * (n + 1) : b.cost);
}

// is tile i (owned by pid) inside one of pid's fort circles?
function defended(w, i, pid) {
  const S = w.S, x = i % S, y = (i / S) | 0, r2 = CFG.fortRadius * CFG.fortRadius;
  for (const f of w.forts) if (f.pid === pid && (f.x - x) ** 2 + (f.y - y) ** 2 <= r2) return true;
  return false;
}
// Territory is a see-through wash of the nation's colour with a solid, slightly darker line on its border tiles.
// Land covered by a fort is a shade darker, and its border is a checkerboard.
function paintTile(w, i) {
  const o = w.owner[i], d = w.own.data, k = i * 4, S = w.S;
  if (!o) d[k + 3] = 0;
  else {
    const p = players[o], ow = w.owner, x = i % S, y = (i / S) | 0;
    const def = w.forts.length > 0 && defended(w, i, o);
    if (ow[i - 1] !== o || ow[i + 1] !== o || ow[i - S] !== o || ow[i + S] !== o) {
      const c = p.edge, f = def && ((x + y) & 1) ? 0.7 : 1;
      d[k] = c[0] * f; d[k + 1] = c[1] * f; d[k + 2] = c[2] * f; d[k + 3] = 255;
    } else {
      const c = p.color, f = def ? 0.85 : 1;
      d[k] = c[0] * f; d[k + 1] = c[1] * f; d[k + 2] = c[2] * f; d[k + 3] = 150;
    }
  }
  const x = i % S, y = (i / S) | 0;
  if (x < w.d0x) w.d0x = x; if (x > w.d1x) w.d1x = x; if (y < w.d0y) w.d0y = y; if (y > w.d1y) w.d1y = y;
}
function repaintAround(w, b) {
  const S = w.S, R = CFG.fortRadius;
  for (let y = Math.max(1, b.y - R); y <= Math.min(S - 2, b.y + R); y++)
    for (let x = Math.max(1, b.x - R); x <= Math.min(S - 2, b.x + R); x++) if (w.owner[y * S + x]) paintTile(w, y * S + x);
}

function setOwner(w, i, pid) {
  const old = w.owner[i];
  if (old === pid) return;
  const S = w.S, p = players[pid];
  w.owner[i] = pid;
  if (old) { const q = players[old]; q.tiles--; q.wt[w.ix]--; } else w.owned++;
  p.tiles++; p.wt[w.ix]++;
  if (w.mined[i]) { if (old) players[old].mined--; p.mined++; }
  const x = i % S, y = (i / S) | 0, bb = p.bb[w.ix];
  if (!bb) p.bb[w.ix] = [x, y, x, y];
  else { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
  const b = w.blds.get(i);
  if (b) {
    if (b.pid === ME && pid !== ME) toast(`${p.name} captured your ${CFG.buildings[b.type].name.toLowerCase()} on ${w.name}`);
    players[b.pid].cnt[b.type]--;
    if (b.type === 'fort') { w.blds.delete(i); w.forts.splice(w.forts.indexOf(b), 1); repaintAround(w, b); }
    else { if (b.yield) { players[b.pid].rigGold -= b.yield; p.rigGold += b.yield; } b.pid = pid; p.cnt[b.type]++; }
  }
  paintTile(w, i); paintTile(w, i - 1); paintTile(w, i + 1); paintTile(w, i - S); paintTile(w, i + S);
  if (old && players[old].tiles === 0) eliminate(old, pid);
}

function eliminate(pid, by) {
  const p = players[pid];
  if (!p.alive) return;
  p.alive = false; p.troops = 0;
  for (const a of game.attacks) if (a.pid === pid) a.done = true;
  game.boats = game.boats.filter(b => b.pid !== pid);
  game.rockets = game.rockets.filter(r => r.pid !== pid);
  if (pid === ME) endGame('lose', 'Your nation has fallen', `${players[by].name} took your last land.`);
  else if (by === ME) toast(`You conquered ${p.name}`);
}

// a starting patch: the free land nearest (x, y), spreading outward
function spawnBlob(pid, w, x, y) {
  const S = w.S, start = y * S + x, q = [start], seen = new Set(q);
  for (let h = 0; h < q.length && h < CFG.spawnTiles; h++) {
    const i = q[h];
    setOwner(w, i, pid);
    for (const n of [i - 1, i + 1, i - S, i + S]) if (!seen.has(n) && isLandT(w.terr[n]) && !w.owner[n]) { seen.add(n); q.push(n); }
  }
}

// ======================================================================
// attacks: troops pushing a border outward, tile by tile
// ======================================================================
const adjacentTo = (w, i, pid) => { const o = w.owner, S = w.S; return o[i - 1] === pid || o[i + 1] === pid || o[i - S] === pid || o[i + S] === pid; };

// Giant empires fight worse: a smooth penalty that sets in around 300,000 tiles.
const bigMalus = (tiles, depth) => 1 - depth / (1 + Math.exp(-2.5 * (Math.log(Math.max(1, tiles)) - Math.log(300000))));
// What taking tile i costs an attack of `troops` with a front `border` tiles long:
// loss = attacker troops lost, dloss = defender troops lost, frac = share of this tick's budget it uses up.
const LOGIC = { loss: 0, dloss: 0, frac: 0 };
function attackLogic(w, i, pid, target, troops, border) {
  const t = w.terr[i];
  let mag = CFG.mag[t], cost = CFG.tileCost[t];
  if (!target) {   // free land: cheap, and fast for a big army
    LOGIC.loss = mag / 5; LOGIC.dloss = 0;
    LOGIC.frac = clamp(2000 * cost / troops, 5, 100) / (border * 2);
    return LOGIC;
  }
  const def = players[target], att = players[pid];
  if (w.forts.length && defended(w, i, target)) { mag *= CFG.fortMag; cost *= CFG.fortSlow; }
  const AL = bigMalus(att.tiles, 0.7), DL = bigMalus(def.tiles, 0.3), AS = bigMalus(att.tiles, 0.73);
  const dloss = def.troops / Math.max(1, def.tiles), R = def.troops / troops;   // R: how outnumbered the attack is
  LOGIC.dloss = dloss;
  LOGIC.loss = mag * clamp(R, 0.6, 2) * (0.463 * AL * DL + 0.0039 * dloss);
  LOGIC.frac = clamp(R, 0.82, 7.5) * clamp(R / 20, 1, 50) / 8.55 * cost * AS * DL / border;
  return LOGIC;
}

// An attack keeps its candidate tiles in a min-heap: the lowest priority number is taken next.
function heapPush(a, pr, t) {
  const P = a.hp, T = a.ht;
  let k = P.length;
  P.push(pr); T.push(t);
  while (k > 0) { const m = (k - 1) >> 1; if (P[m] <= pr) break; P[k] = P[m]; T[k] = T[m]; k = m; }
  P[k] = pr; T[k] = t;
}
function heapPop(a) {
  const P = a.hp, T = a.ht, top = T[0], lp = P.pop(), lt = T.pop(), n = P.length;
  if (n) {
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && P[c + 1] < P[c]) c++;
      if (P[c] >= lp) break;
      P[k] = P[c]; T[k] = T[c]; k = c;
    }
    P[k] = lp; T[k] = lt;
  }
  return top;
}
// Tile n joins the attack's front if it belongs to the target. Tiles already hemmed in by the attacker go first,
// rough ground goes later, and older candidates go before newer ones: that is what keeps a front smooth.
function pushFront(a, n) {
  const w = a.w, own = w.owner;
  if (own[n] !== a.target || !isLandT(w.terr[n])) return;
  const S = w.S, pid = a.pid;
  const mine = (own[n - 1] === pid) + (own[n + 1] === pid) + (own[n - S] === pid) + (own[n + S] === pid);
  a.set.add(n);
  const far = a.aim == null ? 0 : CFG.aimBias * Math.hypot((n % S) - a.ax, ((n / S) | 0) - a.ay);
  heapPush(a, (((rng() * 7) | 0) + 10) * (1 - 0.5 * mine + CFG.prio[w.terr[n]] / 2) + game.tickN + far, n);
}
function scanFront(a) {
  const w = a.w, S = w.S, own = w.owner, pid = a.pid, bb = players[pid].bb[w.ix];
  if (!bb) return;
  for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0], i = y * S + x; x <= bb[2]; x++, i++) {
    if (own[i] !== pid) continue;
    if (own[i - 1] === pid && own[i + 1] === pid && own[i - S] === pid && own[i + S] === pid) continue;   // interior
    pushFront(a, i - 1); pushFront(a, i + 1); pushFront(a, i - S); pushFront(a, i + S);
  }
}
// point an attack at tile i: its front is re-sorted so land near i falls first
function aimAttack(a, i, resort) {
  a.aim = i; a.ax = i % a.w.S; a.ay = (i / a.w.S) | 0;
  if (resort) { a.hp.length = 0; a.ht.length = 0; a.set.clear(); scanFront(a); }
}
// send troops (already taken out of the player's pool) against `target` (0 = free land) on world w
function launchAttack(pid, w, target, troops, seeds) {
  let a = game.attacks.find(q => !q.done && q.pid === pid && q.w === w && q.target === target);
  if (a) a.troops += troops;
  else {
    a = { id: game.nextId++, pid, w, target, troops, hp: [], ht: [], set: new Set(), done: false };
    game.attacks.push(a);
    if (!seeds) scanFront(a);
  }
  if (seeds) for (const n of seeds) pushFront(a, n);
  return a;
}
function stepAttack(a) {
  const w = a.w, S = w.S, own = w.owner, pid = a.pid, target = a.target;
  if (!a.ht.length) {
    a.set.clear(); scanFront(a);
    if (!a.ht.length) { players[pid].troops += a.troops; a.done = true; return; }   // nothing left to take: troops come home
  }
  const border = Math.max(1, a.set.size + ((rng() * 5) | 0));
  let budget = 1;
  while (budget > 0 && a.ht.length) {
    if (a.troops < 1) { a.done = true; return; }   // spent
    const i = heapPop(a);
    a.set.delete(i);
    if (own[i] !== target || !adjacentTo(w, i, pid)) continue;
    pushFront(a, i - 1); pushFront(a, i + 1); pushFront(a, i - S); pushFront(a, i + S);
    const L = attackLogic(w, i, pid, target, a.troops, border);
    budget -= L.frac; a.troops -= L.loss;
    if (target) players[target].troops = Math.max(0, players[target].troops - L.dloss);
    setOwner(w, i, pid);
    if (target && players[target].alive && players[target].tiles < CFG.conquerBelow) conquerPlayer(pid, target);
    if (a.done) return;
  }
  if (a.troops < 1) a.done = true;
}
// a nation too small to go on falls to whoever was attacking it: land, buildings and gold
function conquerPlayer(pid, target) {
  const t = players[target];
  players[pid].gold += t.gold; t.gold = 0;
  for (const w of worlds) {
    const bb = t.bb[w.ix];
    if (!bb || !t.wt[w.ix]) continue;
    for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0]; x <= bb[2]; x++) if (w.owner[y * w.S + x] === target) setOwner(w, y * w.S + x, pid);
  }
}

// Pockets: enemy land an attack has cut off, so that nothing but the attacker touches it (no coast, no free land,
// no third nation), falls to the attacker at no cost. Every pocket has tiles on the attack's front, so the search
// starts there and gives up on anything bigger than pocketMax tiles (the enemy's main body).
function pocketCheck(a) {
  const w = a.w, S = w.S, own = w.owner, pid = a.pid, target = a.target;
  if (!players[target].alive) return;
  if (!w.cmark) w.cmark = new Uint32Array(w.N);
  if (!w.queue) { w.prev = new Int32Array(w.N); w.queue = new Int32Array(w.N); }
  const mark = w.cmark, Q = w.queue, base = game.gen, LIMIT = CFG.pocketMax;
  let misses = 0;
  for (const i0 of a.set) {
    if (own[i0] !== target || mark[i0] > base) continue;
    if (misses >= 30) break;
    const g = ++game.gen;
    let head = 0, tail = 0, closed = true;
    Q[tail++] = i0; mark[i0] = g;
    while (head < tail && closed) {
      const c = Q[head++];
      for (let k = 0; k < 4; k++) {
        const n = c + (k === 0 ? -1 : k === 1 ? 1 : k === 2 ? -S : S), q = own[n];
        if (q === target) {
          if (mark[n] === g) continue;
          if (mark[n] > base || tail >= LIMIT) { closed = false; break; }   // joins land already found open, or too big
          mark[n] = g; Q[tail++] = n;
        } else if (q !== pid) { closed = false; break; }
      }
    }
    if (!closed) { misses++; continue; }
    for (let k = 0; k < tail; k++) setOwner(w, Q[k], pid);
    if (!players[target].alive) return;
  }
}

// troops arriving by boat or rocket on tile i
function landing(pid, w, i, troops) {
  const p = players[pid];
  if (!p.alive) return;
  const o = w.owner[i];
  if (o === pid) { p.troops += troops; return; }
  const L = attackLogic(w, i, pid, o, troops, 1), loss = L.loss;
  if (troops <= loss) { if (pid === ME) toast('The landing party was wiped out'); return; }
  if (o) players[o].troops = Math.max(0, players[o].troops - L.dloss);
  setOwner(w, i, pid);
  const S = w.S;
  aimAttack(launchAttack(pid, w, o, troops - loss, [i - 1, i + 1, i - S, i + S]), i, false);
}

// ---------- sea routes ----------
function bfsBuffers(w) {
  if (!w.queue) { w.prev = new Int32Array(w.N); w.queue = new Int32Array(w.N); }
  w.prev.fill(-1);
}
// does the region of same-owner land around tile i touch pid's territory?
function regionTouches(w, i, pid) {
  const S = w.S, own = w.owner, terr = w.terr, o = own[i];
  bfsBuffers(w);
  const prev = w.prev, Q = w.queue;
  let head = 0, tail = 0;
  Q[tail++] = i; prev[i] = i;
  while (head < tail) {
    const c = Q[head++];
    for (let k = 0; k < 4; k++) {
      const n = c + (k === 0 ? -1 : k === 1 ? 1 : k === 2 ? -S : S);
      if (own[n] === pid) return true;
      if (prev[n] < 0 && own[n] === o && isLandT(terr[n])) { prev[n] = c; Q[tail++] = n; }
    }
  }
  return false;
}
// a water path from pid's coast to the shore nearest `dest`; null if there is none
function seaRoute(w, pid, dest) {
  const S = w.S, own = w.owner, terr = w.terr, step = [-1, 1, -S, S];
  let shore = -1, water = -1;
  const seen = new Set([dest]), q = [dest];
  for (let h = 0; h < q.length && h < 6000 && shore < 0; h++) {
    for (const d of step) {
      const n = q[h] + d;
      if (terr[n] === WATER) { shore = q[h]; water = n; break; }
      if (isLandT(terr[n]) && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  if (shore < 0) return null;
  bfsBuffers(w);
  const prev = w.prev, Q = w.queue;
  let head = 0, tail = 0;
  Q[tail++] = water; prev[water] = water;
  while (head < tail) {
    const c = Q[head++];
    for (let k = 0; k < 4; k++) {
      const n = c + step[k];
      if (terr[n] === WATER) { if (prev[n] < 0) { prev[n] = c; Q[tail++] = n; } }
      else if (own[n] === pid) {
        const path = [n];
        for (let t = c; ; t = prev[t]) { path.push(t); if (t === water) break; }
        path.push(shore);
        return path;
      }
    }
  }
  return null;
}
function sendBoat(pid, w, path, troops) {
  players[pid].troops -= troops;
  game.boats.push({ pid, w, path, pos: 0, troops });
}

// ---------- rockets ----------
// the closest ready launch pad of pid's that can reach world w; or { why } if none can
function findPad(pid, w) {
  const p = players[pid], AU = CFG.space.au;
  let best = null, bestD = Infinity, refuel = 0, far = null, stone = null;
  for (const src of worlds) {
    if (src === w || !p.wt[src.ix]) continue;
    const reach = inRange(src.body, w.body), d = bodyDist(src.body, w.body);
    let pads = 0;
    for (const b of src.blds.values()) {
      if (b.type !== 'pad' || b.pid !== pid) continue;
      pads++;
      if (!reach) { if (!far || d < far.d) far = { src, d }; continue; }
      if (b.ready > game.time) { refuel = refuel ? Math.min(refuel, b.ready - game.time) : b.ready - game.time; continue; }
      if (d < bestD) { bestD = d; best = { pad: b, src }; }
    }
    if (reach && !pads && !stone) stone = src;   // you hold land in range, but there is no pad on it
  }
  if (best) return best;
  if (refuel) return { kind: 'refuel', why: `Your launch pad in range is refuelling (${Math.ceil(refuel)}s)` };
  if (stone) {
    let silo = false;
    for (const b of stone.blds.values()) if (b.type === 'silo' && b.pid === pid) silo = true;
    const lead = far ? `Your launch pad on ${far.src.name} is too far from ${w.name}. Build another launch pad (key 4) on ${stone.name}, which is in range`
      : `You have no launch pad. Build one (key 4) on ${stone.name} to reach ${w.name}`;
    return { kind: 'stone', stone, why: lead + (silo ? '. Your missile silo there only fires bombs' : '') };
  }
  if (far) return { kind: 'far', why: `${w.name} is ${(far.d / AU).toFixed(1)} AU from your launch pad on ${far.src.name}, which reaches ${(rangeOf(far.src.body) / AU).toFixed(1)} AU. Build a pad on a world further out, or wait for the planets to move closer` };
  return { kind: 'none', why: 'You have no launch pad. Build one (key 4) to reach other worlds' };
}
function launchRocket(pid, found, w, i, troops) {
  const p = players[pid], R = CFG.rocket;
  p.troops -= troops; p.gold -= R.cost;
  found.pad.ready = game.time + R.cooldown;
  const T = R.timeBase + R.timeK * Math.sqrt(bodyDist(found.src.body, w.body));
  game.rockets.push({ pid, src: found.src, from: found.pad.i, w, i, troops, t0: game.time, t1: game.time + T });
}
function rocketPos(r) {
  const s = clamp((game.time - r.t0) / (r.t1 - r.t0), 0, 1), e = s * s * (3 - 2 * s);
  const a = tilePos(r.src, r.from), b = tilePos(r.w, r.i);
  return [lerp(a[0], b[0], e), lerp(a[1], b[1], e)];
}
const tilePos = (w, i) => [w.body.x - w.S / 2 + (i % w.S) + 0.5, w.body.y - w.S / 2 + ((i / w.S) | 0) + 0.5];

// ---------- bombs and air defense ----------
function removeBuilding(w, b) {
  w.blds.delete(b.i);
  players[b.pid].cnt[b.type]--;
  if (b.yield) players[b.pid].rigGold -= b.yield;
  if (b.type === 'fort') { w.forts.splice(w.forts.indexOf(b), 1); repaintAround(w, b); }
  if (b.type === 'sam') w.sams.splice(w.sams.indexOf(b), 1);
}
// returns an error message, or null if the bomb is on its way
function launchNuke(pid, type, w, i) {
  const p = players[pid], N = CFG.nukes[type], S = w.S, tx = i % S, ty = (i / S) | 0;
  let best = null, bd = Infinity, any = false;
  for (const b of w.blds.values()) {
    if (b.type !== 'silo' || b.pid !== pid) continue;
    any = true;
    const d = (b.x - tx) ** 2 + (b.y - ty) ** 2;
    if (b.ready <= game.time && d < bd) { bd = d; best = b; }
  }
  if (!best) return any ? 'Your missile silos here are reloading' : p.cnt.silo ? `You have no missile silo on ${w.name}` : 'Build a missile silo first';
  if (p.gold < N.cost) return `${N.name} costs ${fmt(N.cost)} gold`;
  p.gold -= N.cost;
  best.ready = game.time + CFG.nuke.cooldown;
  game.nukes.push({ id: game.nextId++, pid, type, w, from: best.i, to: i, t0: game.time, t1: game.time + Math.max(1.5, Math.sqrt(bd) / CFG.nuke.speed), tried: new Set() });
  if (pid !== ME && w.owner[i] === ME) toast(`${p.name} launched ${type === 'atom' ? 'an atom bomb' : 'a hydrogen bomb'} at you`);
  return null;
}
function nukeTile(n) {   // where the bomb is now, in tile coordinates
  const S = n.w.S, k = clamp((game.time - n.t0) / (n.t1 - n.t0), 0, 1);
  return [lerp(n.from % S, n.to % S, k) + 0.5, lerp((n.from / S) | 0, (n.to / S) | 0, k) + 0.5];
}
function explode(n) {
  const w = n.w, S = w.S, N = CFG.nukes[n.type], cx = n.to % S, cy = (n.to / S) | 0, lost = new Map();
  for (let y = Math.max(1, cy - N.outer); y <= Math.min(S - 2, cy + N.outer); y++) for (let x = Math.max(1, cx - N.outer); x <= Math.min(S - 2, cx + N.outer); x++) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2, i = y * S + x, o = w.owner[i];
    if (!o || d2 > N.outer * N.outer || (d2 > N.inner * N.inner && hash2(x, y, n.id) < 0.5)) continue;
    lost.set(o, (lost.get(o) || 0) + 1);
    const q = players[o];
    q.tiles--; q.wt[w.ix]--; w.owned--; w.owner[i] = 0;
    if (w.mined[i]) q.mined--;
    const b = w.blds.get(i);
    if (b) { if (b.pid === ME) toast(`Your ${CFG.buildings[b.type].name.toLowerCase()} on ${w.name} was destroyed by a bomb`); removeBuilding(w, b); }
    paintTile(w, i); paintTile(w, i - 1); paintTile(w, i + 1); paintTile(w, i - S); paintTile(w, i + S);
  }
  for (const [o, cnt] of lost) {
    const q = players[o];
    q.troops *= 1 - cnt / (q.tiles + cnt);
    if (q.tiles === 0) eliminate(o, n.pid);
  }
  game.boats = game.boats.filter(b => { if (b.w !== w) return true; const t = b.path[Math.min(b.path.length - 1, b.pos | 0)]; return ((t % S) - cx) ** 2 + (((t / S) | 0) - cy) ** 2 > N.outer * N.outer; });
  // a scorch mark that stays on the ground
  const g = w.terrCanvas.getContext('2d'), gr = g.createRadialGradient(cx, cy, 0, cx, cy, N.outer);
  gr.addColorStop(0, 'rgba(18,14,12,0.6)'); gr.addColorStop(0.6, 'rgba(24,18,14,0.38)'); gr.addColorStop(1, 'rgba(24,18,14,0)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, N.outer, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over';
  game.blasts.push({ w, x: cx + 0.5, y: cy + 0.5, r: N.outer, t0: game.time, dur: n.type === 'atom' ? 1.4 : 2.2 });
}
function stepNukes() {
  const R2 = CFG.nuke.samRange * CFG.nuke.samRange;
  for (const n of game.nukes) {
    const w = n.w, S = w.S, tx = n.to % S, ty = (n.to / S) | 0;
    if (w.sams.length) {
      const [px, py] = nukeTile(n);
      for (const b of w.sams) {
        if (b.pid === n.pid || b.ready > game.time || n.tried.has(b)) continue;
        if ((b.x - tx) ** 2 + (b.y - ty) ** 2 > R2 || (b.x - px) ** 2 + (b.y - py) ** 2 > R2) continue;
        b.ready = game.time + CFG.nuke.samCooldown; n.tried.add(b);
        game.tracers.push({ w, x0: b.x + 0.5, y0: b.y + 0.5, x1: px, y1: py, t0: game.time });
        if (rng() < CFG.nukes[n.type].samHit) {
          n.done = true;
          game.blasts.push({ w, x: px, y: py, r: 5, t0: game.time, dur: 0.6 });
          if (n.pid === ME) toast(`Air defense shot down your ${CFG.nukes[n.type].name.toLowerCase()}`);
          else if (b.pid === ME) toast(`Your air defense shot down ${n.type === 'atom' ? 'an atom bomb' : 'a hydrogen bomb'}`);
          break;
        }
      }
    }
    if (!n.done && game.time >= n.t1) { n.done = true; explode(n); }
  }
  if (game.nukes.some(n => n.done)) game.nukes = game.nukes.filter(n => !n.done);
  if (game.blasts.length && game.time > game.blasts[0].t0 + game.blasts[0].dur) game.blasts = game.blasts.filter(b => game.time < b.t0 + b.dur);
  if (game.tracers.length && game.time > game.tracers[0].t0 + 0.4) game.tracers = game.tracers.filter(t => game.time < t.t0 + 0.4);
}

// ---------- one click does it all: border attack, boat, or rocket ----------
// returns an error message, or null if the order went out
function order(pid, w, i, frac) {
  const p = players[pid], o = w.owner[i];
  if (o === pid || !isLandT(w.terr[i])) return null;
  const troops = Math.floor(p.troops * frac);
  if (troops < 100) return 'Not enough troops';
  if (p.wt[w.ix] > 0) {
    if (regionTouches(w, i, pid)) { p.troops -= troops; const a = launchAttack(pid, w, o, troops); if (pid === ME) aimAttack(a, i, true); return null; }
    const path = seaRoute(w, pid, i);
    if (path) {
      if (game.boats.filter(b => b.pid === pid).length >= CFG.maxBoats) return `Only ${CFG.maxBoats} boats can be at sea at once`;
      sendBoat(pid, w, path, troops);
      return null;
    }
  }
  const found = findPad(pid, w);
  if (!found.pad) return p.wt[w.ix] > 0 ? "Your troops can't reach that land by border or by sea" : found.why;
  if (p.gold < CFG.rocket.cost) return `A rocket launch costs ${CFG.rocket.cost} gold`;
  launchRocket(pid, found, w, i, troops);
  return null;
}

// ---------- mining rigs ----------
// gold per tick a rig on tile i would earn: the ore in unmined land within reach
function rigYield(w, i) {
  const S = w.S, R = CFG.rig.radius, cx = i % S, cy = (i / S) | 0;
  let ore = 0;
  for (let y = Math.max(1, cy - R); y <= Math.min(S - 2, cy + R); y++) for (let x = Math.max(1, cx - R); x <= Math.min(S - 2, cx + R); x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 > R * R || w.mined[y * S + x]) continue;
    ore += CFG.rig.ore[w.terr[y * S + x]] || 0;
  }
  return ore * CFG.rig.gold * w.rich;
}
// strip the land around rig b to bare rock (it becomes mountain, whoever owns it); returns the rig's gold per tick
function stripLand(w, b) {
  const S = w.S, R = CFG.rig.radius, pay = rigYield(w, b.i);
  const x0 = Math.max(1, b.x - R), y0 = Math.max(1, b.y - R), x1 = Math.min(S - 2, b.x + R), y1 = Math.min(S - 2, b.y + R);
  const g = w.terrCanvas.getContext('2d'), img = g.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1), d = img.data;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * S + x, r2 = (x - b.x) ** 2 + (y - b.y) ** 2;
    if (r2 > R * R || !isLandT(w.terr[i]) || w.mined[i]) continue;
    w.mined[i] = 1; w.terr[i] = PEAK;
    if (w.owner[i]) players[w.owner[i]].mined++;
    const k = ((y - y0) * (x1 - x0 + 1) + (x - x0)) * 4, pit = 1 - 0.35 * (1 - Math.sqrt(r2) / R);   // darker toward the pit
    const c = mix([104, 96, 90], [142, 132, 120], vnoise(x / 1.7, y / 1.7, 71));
    const band = ((Math.sqrt(r2) | 0) % 3 === 0) ? 0.86 : 1;                                         // terraces
    d[k] = c[0] * pit * band; d[k + 1] = c[1] * pit * band; d[k + 2] = c[2] * pit * band; d[k + 3] = 255;
  }
  g.putImageData(img, x0, y0);
  return pay;
}

// ---------- buildings ----------
function place(pid, type, w, i) {
  const p = players[pid], S = w.S;
  if (w.owner[i] !== pid) return 'Build on your own land';
  if (w.blds.has(i)) return 'Something is already built there';
  if (type === 'port' && w.terr[i - 1] !== WATER && w.terr[i + 1] !== WATER && w.terr[i - S] !== WATER && w.terr[i + S] !== WATER) return 'A port must touch water';
  if (type === 'rig' && rigYield(w, i) <= 0) return 'No ore in reach here: build on rough ground or mountains';
  const cost = costOf(p, type);
  if (p.gold < cost) return `Needs ${fmt(cost)} gold`;
  p.gold -= cost;
  const b = { type, pid, i, x: i % S, y: (i / S) | 0, ready: 0 };
  w.blds.set(i, b);
  if (type === 'fort') { w.forts.push(b); repaintAround(w, b); }
  if (type === 'sam') w.sams.push(b);
  if (type === 'rig') { b.yield = stripLand(w, b); p.rigGold += b.yield; }
  p.cnt[type]++;
  return null;
}

// ======================================================================
// what each nation can see from its borders (refreshed every couple of seconds, one world at a time)
// ======================================================================
// The scan is spread over many ticks (scanStep), so a full disk never stalls a frame.
// Per-nation tallies sit in typed arrays while scanning and become p.nb[world] objects at the end.
function newScan(w) {
  const P = players.length;
  return { w, y: 1, salt: (game.time * 1000 + w.ix * 7919) | 0,
    n: new Int32Array(P), sx: new Float64Array(P), sy: new Float64Array(P),
    anyH: new Uint32Array(P).fill(0xffffffff), any: new Int32Array(P).fill(-1),
    coastH: new Uint32Array(P).fill(0xffffffff), coast: new Int32Array(P).fill(-1),
    neutral: new Uint8Array(P), last: new Int32Array(P), enemies: new Array(P).fill(null) };
}
function scanRows(sc, y0, y1) {
  const w = sc.w, S = w.S, own = w.owner, terr = w.terr, salt = sc.salt;
  const { n: cnt, sx, sy, anyH, any, coastH, coast, neutral, last, enemies } = sc;
  for (let y = y0; y < y1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x, o = own[i];
    if (!o) continue;
    cnt[o]++; sx[o] += x; sy[o] += y;
    const h = Math.imul(i ^ salt, 0x9E3779B1) >>> 0;       // a random-looking number per tile: the lowest one is the sample
    if (h < anyH[o]) { anyH[o] = h; any[o] = i; }
    const a = own[i - 1], b = own[i + 1], c = own[i - S], d = own[i + S];
    if (a === o && b === o && c === o && d === o) continue;   // interior
    let isCoast = false;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? a : k === 1 ? b : k === 2 ? c : d;
      if (q === o) continue;
      if (q) { if (q !== last[o]) { last[o] = q; (enemies[o] || (enemies[o] = new Set())).add(q); } continue; }
      const t = terr[i + (k === 0 ? -1 : k === 1 ? 1 : k === 2 ? -S : S)];
      if (t === WATER) isCoast = true;
      else if (t >= PLAIN && t <= PEAK) neutral[o] = 1;
    }
    if (isCoast && h < coastH[o]) { coastH[o] = h; coast[o] = i; }
  }
}
const NO_ENEMIES = new Set();
function scanCommit(sc) {
  for (let k = 1; k < players.length; k++) {
    players[k].nb[sc.w.ix] = players[k].alive && k < sc.n.length && sc.n[k]
      ? { n: sc.n[k], sx: sc.sx[k], sy: sc.sy[k], any: sc.any[k], coast: sc.coast[k], neutral: !!sc.neutral[k], enemies: sc.enemies[k] || NO_ENEMIES } : null;
  }
}
function scanWorld(w) {
  const sc = newScan(w);
  if (w.owned) scanRows(sc, 1, w.S - 1);
  scanCommit(sc);
}
function scanStep(budget) {
  while (budget > 0) {
    let sc = game.scan;
    if (!sc) {
      const w = worlds[game.scanIx];
      game.scanIx = (game.scanIx + 1) % worlds.length;
      sc = game.scan = newScan(w);
      if (!w.owned) sc.y = w.S;
    }
    const S = sc.w.S, rows = Math.min(S - 1 - sc.y, Math.max(1, Math.ceil(budget / S)));
    if (rows > 0) { scanRows(sc, sc.y, sc.y + rows); sc.y += rows; }
    budget -= Math.max(rows, 4) * S;
    if (sc.y >= S - 1) { scanCommit(sc); game.scan = null; }
  }
}

// ======================================================================
// AI nations
// ======================================================================
function randomLand(w, pid, wantFree) {
  for (let t = 0; t < 30; t++) {
    const i = (rng() * w.N) | 0;
    if (!isLandT(w.terr[i]) || w.owner[i] === pid) continue;
    if (wantFree && t < 20 && w.owner[i]) continue;
    return i;
  }
  return -1;
}
function botBuild(p, mine) {
  if (!mine.length) return;
  const w = pick(mine), nb = p.nb[w.ix];
  const has = type => { for (const b of w.blds.values()) if (b.type === type && b.pid === p.id) return true; return false; };
  // in order of importance: [type, wanted?, tile, save up for it?]
  const wants = [
    // one pad once big enough, then one on every other world it holds (each is a stepping stone further out)
    ['pad', !has('pad') && (p.cnt.pad ? nb.n > 300 : p.tiles > 8000), nb.any, p.cnt.city >= 1],
    ['city', p.cnt.city < 2, nb.any, false],
    ['silo', p.cnt.silo < 1 && p.tiles > 10000 && nb.enemies.size > 0, nb.any, true],
    ['sam', p.cnt.sam < Math.min(3, p.tiles / 15000) && !has('sam'), nb.any, false],
    ['city', p.cnt.city < Math.min(8, 1 + p.tiles / 4000), nb.any, false],
    ['rig', p.cnt.rig < Math.min(10, 1 + p.tiles / 8000) && rigYield(w, nb.any) >= 12, nb.any, false],
    ['port', p.cnt.port < 2 && nb.coast >= 0, nb.coast, false],
    ['fort', p.cnt.fort < 3 && nb.enemies.size > 0 && rng() < 0.08, nb.any, false],
  ];
  for (const [type, wanted, tile, save] of wants) {
    if (!wanted) continue;
    if (p.gold >= costOf(p, type)) { place(p.id, type, w, tile); return; }
    if (save) return;
  }
}
// bomb the strongest neighbour: one of its buildings if it has any on this world, else its land
function botNuke(p, mine) {
  if (game.time < CFG.peace * 2) return false;
  const type = p.gold >= CFG.nukes.hydro.cost * 1.2 ? 'hydro' : p.gold >= CFG.nukes.atom.cost * 1.5 ? 'atom' : null;
  if (!type) return false;
  for (const w of mine) {
    const nb = p.nb[w.ix];
    let e = 0;
    for (const q of nb.enemies) if (players[q].alive && (!e || players[q].troops > players[e].troops)) e = q;
    if (!e) continue;
    const marks = [];
    for (const b of w.blds.values()) if (b.pid === e && b.type !== 'fort') marks.push(b.i);
    const en = players[e].nb[w.ix], i = marks.length ? pick(marks) : en ? en.any : -1;
    if (i >= 0 && launchNuke(p.id, type, w, i) === null) return true;
  }
  return false;
}
function botRocket(p) {
  if (p.gold < CFG.rocket.cost) return false;
  const options = worlds.filter(w => findPad(p.id, w).pad && w.owned < w.land * 0.98);
  if (!options.length) return false;
  const fresh = options.filter(w => !p.wt[w.ix]);
  const w = pick(fresh.length ? fresh : options), i = randomLand(w, p.id, true);
  if (i < 0) return false;
  launchRocket(p.id, findPad(p.id, w), w, i, Math.floor(p.troops * 0.2));
  return true;
}
function botThink(p) {
  const mine = worlds.filter(w => p.nb[w.ix] && p.nb[w.ix].n);
  botBuild(p, mine);
  const full = p.troops / capOf(p);
  if (full < 0.42 || !mine.length) return;
  if (p.cnt.pad && rng() < 0.35 && botRocket(p)) return;
  if (p.cnt.silo && rng() < 0.3) botNuke(p, mine);
  const free = mine.filter(w => p.nb[w.ix].neutral), foes = [];
  for (const w of mine) for (const e of p.nb[w.ix].enemies) if (players[e].alive) foes.push([e, w]);
  if (free.length && (!foes.length || rng() < 0.8)) {
    const t = Math.floor(p.troops * 0.25);
    p.troops -= t; launchAttack(p.id, pick(free), 0, t);
    return;
  }
  if (foes.length && game.time > CFG.peace && rng() < 0.7) {
    foes.sort((a, b) => players[a[0]].troops - players[b[0]].troops);
    const [e, w] = foes[0];
    if (players[e].troops < p.troops * 1.3 || full > 0.85) {
      const t = Math.floor(p.troops * 0.35);
      p.troops -= t; launchAttack(p.id, w, e, t);
    }
    return;
  }
  // boxed in or out of free land next door: look across the water
  const coastal = mine.filter(w => p.nb[w.ix].coast >= 0);
  if (coastal.length && game.time >= game.botSeaAt && game.boats.filter(b => b.pid === p.id).length < 2) {
    game.botSeaAt = game.time + 1.5;
    const w = pick(coastal), i = randomLand(w, p.id, true);
    const path = i >= 0 ? seaRoute(w, p.id, i) : null;
    if (path) sendBoat(p.id, w, path, Math.floor(p.troops * 0.2));
  }
}

// ======================================================================
// simulation tick
// ======================================================================
function tick(dt) {
  game.time += dt; game.tickN++;
  updatePositions(game.time);
  for (let k = 1; k < players.length; k++) {
    const p = players[k];
    if (!p.alive) continue;
    const cap = capOf(p);
    const add = (CFG.growBase + Math.pow(p.troops, CFG.growPow) / CFG.growDiv) * (1 - p.troops / cap) * (p.human ? 1 : CFG.ai.growth);
    p.troops = Math.max(0, Math.min(p.troops + add, Math.max(cap, p.troops)));   // over the cap (lost land): shrinks back
    p.troopRate = add * CFG.tickHz;
    const gold = CFG.goldPerTick + CFG.portGoldPerTick * p.cnt.port + p.rigGold;
    p.gold += gold; p.goldRate = gold * CFG.tickHz;
  }
  for (const a of game.attacks) {
    if (a.done) continue;
    stepAttack(a);
    if (a.target && (a.done || (game.tickN + a.id) % 20 === 0)) pocketCheck(a);
  }
  if (game.attacks.some(a => a.done)) game.attacks = game.attacks.filter(a => !a.done);

  for (const b of game.boats) {
    b.pos += CFG.boatSpeed * dt;
    if (b.pos >= b.path.length - 1) { b.done = true; landing(b.pid, b.w, b.path[b.path.length - 1], b.troops); }
  }
  if (game.boats.some(b => b.done)) game.boats = game.boats.filter(b => !b.done);
  for (const r of game.rockets) if (game.time >= r.t1) { r.done = true; landing(r.pid, r.w, r.i, r.troops); if (r.pid === ME) toast(`Your rocket landed on ${r.w.name}`); }
  if (game.rockets.some(r => r.done)) game.rockets = game.rockets.filter(r => !r.done);
  stepNukes();

  scanStep(CFG.scanTiles);
  for (let k = 2; k < players.length; k++) {
    const p = players[k];
    if (p.alive && game.time >= p.nextThink) { p.nextThink = game.time + CFG.botThink * (0.7 + rng() * 0.6); botThink(p); }
  }
  for (let k = 1; k < players.length && !game.over; k++) {
    const p = players[k];
    if (p.alive && p.tiles >= totalLand * CFG.winShare) {
      if (k === ME) endGame('win', 'The system is yours', `You hold ${Math.round(p.tiles / totalLand * 100)}% of all land, from the disk to the far planets.`);
      else endGame('lose', 'The system has a new ruler', `${p.name} holds ${Math.round(CFG.winShare * 100)}% of all land.`);
    }
  }
}

function endGame(kind, title, sub) {
  if (game.over) return;
  game.over = kind;
  $('ov-title').textContent = title; $('ov-sub').textContent = sub;
  $('overlay').style.display = 'grid';
}

// ======================================================================
// camera and drawing
// ======================================================================
const canvas = $('game'), ctx = canvas.getContext('2d');
let cw = 0, ch = 0, dpr = 1, ox = 0, oy = 0;
const cam = { body: null, x: 0, y: 0, zoom: 1 };   // x, y: offset from the body you are locked onto
const mouse = { x: 0, y: 0, down: false, drag: false, sx: 0, sy: 0 };
const keys = new Set();
const TOUCH = window.matchMedia('(pointer: coarse)').matches;   // a phone or tablet: fingers, no keyboard
const stars = Array.from({ length: 320 }, () => [Math.random(), Math.random(), Math.random()]);

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);   // phones report 3: not worth 2.25x the pixels
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
}
const SX = wx => (wx - ox) * cam.zoom + cw / 2;
const SY = wy => (wy - oy) * cam.zoom + ch / 2;
const fitZoom = r => Math.min(cw, ch) * 0.44 / r;
function lockOn(b, zoom) { cam.body = b; cam.x = 0; cam.y = 0; cam.zoom = clamp(zoom || fitZoom(b.r), CFG.zoomMin, CFG.zoomMax); }
// M: step outward. A world -> its local system (a planet and its moons) -> the whole solar system
function zoomOutLevel() {
  const b = cam.body, hub = b.parent && b.parent !== SUN ? b.parent : b;
  const kids = bodies.filter(q => q.parent === hub);
  const local = kids.length ? fitZoom(Math.max(...kids.map(q => q.orbit)) * 1.15) : 0;
  if (local && cam.zoom > local * 1.5) lockOn(hub, local);
  else if (cam.body !== SUN) lockOn(SUN, fitZoom(CFG.space.au * CFG.space.seedWorld.orbit * 1.08));
  else lockOn(HOME);
}

// what is under a screen point: { body } for a far-off body, or { w, i } for a tile
function pickAt(px, py) {
  const wx = (px - cw / 2) / cam.zoom + ox, wy = (py - ch / 2) / cam.zoom + oy;
  for (const b of bodies) {
    const rr = b.r * cam.zoom;
    if (rr < 40 && Math.hypot(SX(b.x) - px, SY(b.y) - py) < Math.max(rr, TOUCH ? 26 : 14)) return { body: b };
  }
  for (const w of worlds) {
    const lx = Math.floor(wx - w.body.x + w.S / 2), ly = Math.floor(wy - w.body.y + w.S / 2);
    if (lx < 1 || ly < 1 || lx >= w.S - 1 || ly >= w.S - 1) continue;
    const i = ly * w.S + lx;
    if (w.terr[i] !== VOID) return { w, i };
  }
  return null;
}

function drawMap(img, S, left, top, z) {
  const x0 = Math.max(0, Math.floor(-left / z)), y0 = Math.max(0, Math.floor(-top / z));
  const x1 = Math.min(S, Math.ceil((cw - left) / z)), y1 = Math.min(S, Math.ceil((ch - top) / z));
  if (x1 <= x0 || y1 <= y0) return;
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, left + x0 * z, top + y0 * z, (x1 - x0) * z, (y1 - y0) * z);
}
function label(text, x, y, size, color) {
  ctx.font = `600 ${size}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 5); ctx.strokeStyle = 'rgba(4,6,12,0.85)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y); ctx.fillStyle = color || '#fff'; ctx.fillText(text, x, y);
}
function rrect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// an icon `size` pixels across, centred on (x, y); outline = a dark edge so it reads on any ground
function icon(name, x, y, size, fill, rot, outline, flip) {
  ctx.save(); ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale((flip ? -1 : 1) * size / 24, size / 24); ctx.translate(-12, -12);
  if (outline) { ctx.lineJoin = 'round'; ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(8,12,22,0.9)'; ctx.stroke(ICON[name]); }
  ctx.fillStyle = fill; ctx.fill(ICON[name], 'evenodd');
  ctx.restore();
}
// ---------- building art ----------
// Each building is a little illustrated token: a disc in its owner's colour with the building standing on it.
// The art is drawn once per (building, colour) into a small canvas on a 24 x 24 grid, then stamped on the map.
const STONE = '#aab3bf', STEEL = '#48525f', SLAB = '#6b7686', WHITE = '#f4f6f9', RED = '#e0483e', GOLD = '#ffd65a', INK = '#141a26';
const ART = {
  city(g, k) {
    k.box(3.5, 19, 17, 1.6, SLAB);
    k.box(4.5, 10, 5, 9.3, '#c8d2de'); k.box(14.5, 8, 5, 11.3, '#b4c0cf'); k.box(9, 4.2, 6, 15.1, WHITE);
    k.box(11.75, 1.8, 0.5, 2.4, INK, 0);
    for (const y of [6, 9, 12, 15]) { k.box(10.1, y, 1.3, 1.6, GOLD, 0); k.box(12.6, y, 1.3, 1.6, GOLD, 0); }
    for (const y of [12, 15]) { k.box(5.6, y, 1, 1.3, GOLD, 0); k.box(7.4, y, 1, 1.3, GOLD, 0); }
    for (const y of [10, 13, 16]) { k.box(15.6, y, 1, 1.3, GOLD, 0); k.box(17.4, y, 1, 1.3, GOLD, 0); }
  },
  port(g, k) {   // a lighthouse on its rock
    k.shape([[4.5, 20.5], [7, 16.8], [17, 16.8], [19.5, 20.5]], '#7d8794');
    k.shape([[9, 17], [10, 7], [14, 7], [15, 17]], WHITE);
    k.shape([[9.75, 9.8], [14.25, 9.8], [14.5, 12.4], [9.5, 12.4]], RED, 0); k.shape([[9.25, 14.8], [14.75, 14.8], [15, 17], [9, 17]], RED, 0);
    k.shape([[9, 17], [10, 7], [14, 7], [15, 17]], 'rgba(0,0,0,0)');
    k.box(8.8, 6, 6.4, 1.2, '#39424f'); k.box(10.2, 3.5, 3.6, 2.5, '#ffe37a'); k.shape([[9.5, 3.6], [12, 1.4], [14.5, 3.6]], RED);
    g.lineWidth = 0.8; g.strokeStyle = '#d8ecff';
    for (const x of [6.5, 12, 17.5]) { g.beginPath(); g.arc(x, 21.6, 1.6, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
  },
  fort(g, k) {
    k.box(6.5, 10, 11, 9.6, STONE);
    for (const x of [6, 10.5, 15]) k.box(x, 7.4, 3, 3.1, '#bcc5d0');
    k.shape([[10.5, 19.6], [10.5, 15.6], [12, 14], [13.5, 15.6], [13.5, 19.6]], '#3a2f2a');
    k.box(8, 12.4, 0.9, 2.3, INK, 0); k.box(15.1, 12.4, 0.9, 2.3, INK, 0);
    k.box(11.75, 1.6, 0.5, 6, INK, 0); k.shape([[12.25, 1.8], [17, 3.1], [12.25, 4.6]], k.own);
  },
  pad(g, k) {
    k.box(4, 18, 16, 2.3, SLAB);
    k.box(5.5, 6, 2, 12, STEEL); k.box(7.5, 8.2, 2.4, 0.7, STEEL, 0); k.box(7.5, 12.2, 2.4, 0.7, STEEL, 0);
    k.shape([[9.8, 13], [7.7, 17.9], [9.8, 16.6]], RED); k.shape([[14.2, 13], [16.3, 17.9], [14.2, 16.6]], RED);
    k.box(10.8, 16, 2.4, 1.5, '#39424f');
    k.shape([[12, 2.6], [14.2, 6.6], [14.2, 16], [9.8, 16], [9.8, 6.6]], WHITE); k.shape([[12, 2.6], [14.2, 6.6], [9.8, 6.6]], RED);
    k.dot(12, 9.6, 1.05, k.own, 0.7);
  },
  silo(g, k) {
    const oct = []; for (let n = 0; n < 8; n++) oct.push([12 + Math.cos(n * Math.PI / 4 + Math.PI / 8) * 8, 13.6 + Math.sin(n * Math.PI / 4 + Math.PI / 8) * 8]);
    k.shape(oct, '#8d97a5'); k.dot(12, 13.6, 5.7, '#f2c14e');
    g.strokeStyle = INK; g.lineWidth = 1.5;
    for (let n = 0; n < 8; n++) { const a = n * Math.PI / 4; g.beginPath(); g.moveTo(12 + Math.cos(a) * 4.5, 13.6 + Math.sin(a) * 4.5); g.lineTo(12 + Math.cos(a + 0.25) * 5.6, 13.6 + Math.sin(a + 0.25) * 5.6); g.stroke(); }
    k.dot(12, 13.6, 4.3, '#1a1f2b');
    k.shape([[12, 5.8], [14.4, 10.6], [14.4, 14.6], [9.6, 14.6], [9.6, 10.6]], WHITE); k.shape([[12, 5.8], [13.5, 8.8], [10.5, 8.8]], RED);
  },
  sam(g, k) {
    k.box(6, 15.6, 12, 4, '#5e6b5a'); k.dot(12, 15, 3.1, '#748270');
    g.save(); g.translate(12.5, 14.5); g.rotate(-0.6);
    k.box(-2, -10, 1.8, 10, WHITE); k.box(0.3, -10, 1.8, 10, WHITE); k.box(-2, -10, 1.8, 1.9, RED); k.box(0.3, -10, 1.8, 1.9, RED);
    g.restore();
    k.box(6.2, 10, 0.6, 5.6, INK, 0); k.dot(6.5, 9.6, 2.3, '#c8d2de');
  },
  rig(g, k) {
    k.box(4.5, 19.3, 13.5, 1.5, SLAB);
    k.shape([[14.2, 19.4], [16.8, 15.2], [19.8, 19.4]], '#8a7a66'); k.dot(16.6, 17.5, 0.75, GOLD, 0); k.dot(17.9, 18.7, 0.6, GOLD, 0); k.dot(15.6, 18.7, 0.5, GOLD, 0);
    k.box(10.7, 7, 0.6, 12.3, INK, 0);
    k.shape([[5.5, 19.4], [9.8, 4.6], [12.2, 4.6], [16.5, 19.4], [14.5, 19.4], [11.5, 7.8], [10.5, 7.8], [7.5, 19.4]], '#c97b3f');
    k.box(8.6, 10.6, 4.8, 1, '#c97b3f'); k.box(7.4, 14.8, 7.2, 1, '#c97b3f');
    k.box(9.2, 3.2, 3.6, 1.6, '#39424f');
  },
};
const SPRITES = new Map();
function sprite(type, color) {
  const key = type + color.join();
  let c = SPRITES.get(key);
  if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  g.scale(4, 4); g.lineJoin = 'round'; g.lineCap = 'round';
  const k = {
    own: css(color), dark: css(mix(color, [10, 14, 24], 0.45)), lite: css(mix(color, [255, 255, 255], 0.5)),
    shape(pts, fill, lw) {
      g.beginPath(); pts.forEach((q, n) => (n ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      g.fillStyle = fill; g.fill();
      if (lw !== 0) { g.lineWidth = lw || 0.85; g.strokeStyle = INK; g.stroke(); }
    },
    box(x, y, w, h, fill, lw) { k.shape([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill, lw); },
    dot(x, y, r, fill, lw) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = fill; g.fill(); if (lw !== 0) { g.lineWidth = lw || 0.85; g.strokeStyle = INK; g.stroke(); } },
  };
  // the token: a soft shadow, then a disc in the owner's colour, lit from above
  g.beginPath(); g.ellipse(12, 15, 10.8, 8.6, 0, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.38)'; g.fill();
  k.dot(12, 13.4, 10.2, k.own, 1.1);
  g.lineWidth = 0.9;
  g.strokeStyle = k.lite; g.beginPath(); g.arc(12, 13.4, 8.8, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
  g.strokeStyle = k.dark; g.beginPath(); g.arc(12, 13.4, 8.8, Math.PI * 0.12, Math.PI * 0.88); g.stroke();
  ART[type](g, k);
  SPRITES.set(key, c);
  return c;
}
// small moving touches on top of the art (only drawn when the token is big enough to see them)
function animate(type, x, y, size, seed) {
  const u = size / 24, X = q => x + (q - 12) * u, Y = q => y + (q - 12) * u, t = performance.now() / 1000 + seed;
  if (type === 'port') {             // the lamp turns
    const a = 0.3 + 0.35 * Math.sin(t * 2.6), g = ctx.createRadialGradient(X(12), Y(4.8), 0, X(12), Y(4.8), 5 * u);
    g.addColorStop(0, `rgba(255,240,150,${a + 0.3})`); g.addColorStop(1, 'rgba(255,240,150,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X(12), Y(4.8), 5 * u, 0, TAU); ctx.fill();
  } else if (type === 'pad') {       // a warning light on the gantry
    if ((t * 1.4) % 1 < 0.5) { ctx.fillStyle = '#ff5a48'; ctx.beginPath(); ctx.arc(X(6.5), Y(5.2), 0.95 * u, 0, TAU); ctx.fill(); }
  } else if (type === 'sam') {       // the radar sweeps
    ctx.strokeStyle = '#3ad07a'; ctx.lineWidth = Math.max(1, 0.5 * u);
    ctx.beginPath(); ctx.moveTo(X(6.5), Y(9.6)); ctx.lineTo(X(6.5) + Math.cos(t * 3) * 2.1 * u, Y(9.6) + Math.sin(t * 3) * 2.1 * u); ctx.stroke();
  } else if (type === 'rig') {       // smoke from the derrick
    for (let n = 0; n < 3; n++) {
      const ph = (t * 0.45 + n / 3) % 1;
      ctx.fillStyle = `rgba(215,220,228,${(1 - ph) * 0.6})`;
      ctx.beginPath(); ctx.arc(X(11 + ph * 3.5), Y(2.6 - ph * 5.5), (0.8 + ph * 1.7) * u, 0, TAU); ctx.fill();
    }
  } else if (type === 'city') {      // one window flickers
    if ((t * 0.7) % 1 < 0.5) { ctx.fillStyle = '#2a3140'; ctx.fillRect(X(12.6), Y(9), 1.3 * u, 1.6 * u); }
  }
}
// stamp a building token; r = half its width on screen
function badge(type, x, y, r, color, alpha, seed) {
  const size = r * 2;
  ctx.globalAlpha = alpha || 1;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sprite(type, color), x - r, y - r * 1.12, size, size);
  if (size >= 22 && !alpha) animate(type, x, y - r * 0.12, size, seed || 0);
  ctx.globalAlpha = 1;
}
// a small dark tag with a number on it (troops on an attack front)
function pill(text, x, y, fg, border, iconName) {
  ctx.font = "700 12px 'Segoe UI', Arial, sans-serif";
  const tw = ctx.measureText(text).width, w = tw + (iconName ? 30 : 14), h = 20;
  rrect(x - w / 2, y - h / 2, w, h, 10); ctx.fillStyle = 'rgba(10,14,24,0.9)'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = border; ctx.stroke();
  if (iconName) icon(iconName, x - w / 2 + 12, y, 13, fg);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = fg; ctx.fillText(text, x - w / 2 + (iconName ? 22 : 7), y + 0.5);
}

function draw() {
  const z = cam.zoom;
  ox = cam.body.x + cam.x; oy = cam.body.y + cam.y;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#04050b'; ctx.fillRect(0, 0, cw, ch);
  for (const s of stars) { ctx.fillStyle = `rgba(255,255,255,${0.25 + s[2] * 0.6})`; ctx.fillRect(s[0] * cw, s[1] * ch, s[2] > 0.85 ? 2 : 1, s[2] > 0.85 ? 2 : 1); }

  // orbits
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(150,170,210,0.2)';
  for (const b of bodies) {
    if (!b.parent) continue;
    const r = b.orbit * z;
    if (r < 24 || r > 30000) continue;
    ctx.beginPath(); ctx.arc(SX(b.parent.x), SY(b.parent.y), r, 0, TAU); ctx.stroke();
  }
  // rocket range of the body you are on, once you own a pad
  if (players[ME].cnt.pad && cam.body.world && players[ME].wt[cam.body.world.ix]) {
    const r = rangeOf(cam.body) * z;
    if (r > 60 && r < 30000) { ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(242,193,78,0.45)'; ctx.beginPath(); ctx.arc(SX(cam.body.x), SY(cam.body.y), r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  }

  for (const b of bodies) {
    const x = SX(b.x), y = SY(b.y), rr = b.r * z;
    if (x + rr < -80 || y + rr < -80 || x - rr > cw + 80 || y - rr > ch + 80) continue;
    if (b.kind === 'sun') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rr * 2.4, 10));
      g.addColorStop(0, '#fffbe0'); g.addColorStop(0.4, '#ffd65a'); g.addColorStop(0.45, 'rgba(255,170,50,0.5)'); g.addColorStop(1, 'rgba(255,140,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, Math.max(rr * 2.4, 10), 0, TAU); ctx.fill();
    } else if (b.kind === 'giant') {
      const r = Math.max(rr, 3);
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
      const n = 9;
      for (let k = 0; k < n; k++) { ctx.fillStyle = css(b.bands[k % b.bands.length]); ctx.fillRect(x - r, y - r + (k * 2 * r) / n, 2 * r, (2 * r) / n + 1); }
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,10,0.5)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
      if (b.ring && r > 4) { ctx.strokeStyle = 'rgba(190,210,240,0.55)'; ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath(); ctx.ellipse(x, y, r * 1.7, r * 0.45, -0.3, 0, TAU); ctx.stroke(); }
    } else {
      const w = b.world;
      if (rr < 2.5) { ctx.fillStyle = css(b.tint); ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill(); }
      else {
        if (w.d1x >= 0) { w.ownCtx.putImageData(w.own, 0, 0, w.d0x, w.d0y, w.d1x - w.d0x + 1, w.d1y - w.d0y + 1); w.d0x = w.S; w.d0y = w.S; w.d1x = -1; w.d1y = -1; }
        ctx.imageSmoothingEnabled = z < 1;
        const left = SX(b.x - w.S / 2), top = SY(b.y - w.S / 2);
        drawMap(w.terrCanvas, w.S, left, top, z);
        drawMap(w.ownCanvas, w.S, left, top, z);
      }
      // a ring in your colour around worlds you hold land on, when they are small
      if (rr < 40 && players[ME].wt[w.ix]) { ctx.strokeStyle = css(players[ME].color); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, Math.max(rr, 2.5) + 4, 0, TAU); ctx.stroke(); }
    }
    if (rr < 60 && (b.kind !== 'world' || rr > 1 || !b.parent || b.parent === SUN || b.parent.r * z > 12)) label(b.name, x, y + Math.max(rr, 3) + 12, 11, '#c9d3e6');
  }

  // buildings, nation names
  for (const w of worlds) {
    const b = w.body, rr = b.r * z;
    if (rr < 60) continue;
    const left = SX(b.x - w.S / 2), top = SY(b.y - w.S / 2);
    if (left > cw || top > ch || left + w.S * z < 0 || top + w.S * z < 0) continue;
    if (z > 0.5) {
      const r = clamp(z * 2.6, 10, 20);
      for (const d of w.blds.values()) {
        const x = left + (d.x + 0.5) * z, y = top + (d.y + 0.5) * z;
        if (x < -20 || y < -20 || x > cw + 20 || y > ch + 20) continue;
        badge(d.type, x, y, r, players[d.pid].color, 0, d.i % 17);
        if ((d.type === 'silo' || d.type === 'sam') && d.ready > game.time) { ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - (d.ready - game.time) / CFG.nuke.cooldown)); ctx.stroke(); }
        if (d.type === 'pad' && d.ready > game.time) { ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - (d.ready - game.time) / CFG.rocket.cooldown)); ctx.stroke(); }
      }
    }
    for (let k = 1; k < players.length; k++) {
      const p = players[k], nb = p.nb[w.ix];
      if (!p.alive || !nb || nb.n < 30) continue;
      const fs = clamp(Math.sqrt(nb.n) * z * 0.16, 0, 22);
      if (fs < 9) continue;
      const x = left + (nb.sx / nb.n + 0.5) * z, y = top + (nb.sy / nb.n + 0.5) * z;
      label(p.name, x, y, fs, k === ME ? '#ffe9a0' : '#fff');
      label(fmt(p.troops), x, y + fs * 1.05, fs * 0.8, '#dfe6f5');
    }
  }

  const T2S = (w, tx, ty) => [SX(w.body.x - w.S / 2 + tx), SY(w.body.y - w.S / 2 + ty)];
  const shown = w => w.body.r * z >= 60;
  const ring = (x, y, r, col, dash) => { ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); };

  // what the selected tool would do at the cursor
  if (game.tool && hover && hover.w) {
    const w = hover.w, S = w.S, [x, y] = T2S(w, (hover.i % S) + 0.5, ((hover.i / S) | 0) + 0.5), N = CFG.nukes[game.tool];
    if (N) {
      for (const b of w.sams) if (b.pid !== ME) { const [bx, by] = T2S(w, b.x + 0.5, b.y + 0.5); ring(bx, by, CFG.nuke.samRange * z, 'rgba(120,190,255,0.7)', [5, 6]); }
      ring(x, y, N.outer * z, 'rgba(255,170,60,0.9)'); ring(x, y, N.inner * z, 'rgba(255,80,60,0.95)');
      icon(game.tool, x, y, 22, '#fff', 0, true);
    } else {
      const ok = w.owner[hover.i] === ME && !w.blds.has(hover.i);
      if (game.tool === 'fort') ring(x, y, CFG.fortRadius * z, 'rgba(255,255,255,0.5)');
      if (game.tool === 'sam') ring(x, y, CFG.nuke.samRange * z, 'rgba(120,190,255,0.7)', [5, 6]);
      if (game.tool === 'rig') { ring(x, y, CFG.rig.radius * z, 'rgba(242,193,78,0.8)'); label(`+${fmt(rigYield(w, hover.i) * CFG.tickHz)} gold/s`, x, y - CFG.rig.radius * z - 10, 12, '#ffe9a0'); }
      const gr = clamp(z * 2.6, 13, 20);
      badge(game.tool, x, y, gr, players[ME].color, 0.85); ring(x, y, gr + 2, ok ? 'rgba(127,209,138,0.95)' : 'rgba(217,119,106,0.95)');
    }
  }

  // boats: a little sailing ship in its nation's colour
  for (const b of game.boats) {
    const w = b.w;
    if (!shown(w)) continue;
    const k = Math.min(b.path.length - 2, Math.floor(b.pos)), f = b.pos - k, a = b.path[k], c = b.path[k + 1];
    const [x, y] = T2S(w, lerp(a % w.S, c % w.S, f) + 0.5, lerp((a / w.S) | 0, (c / w.S) | 0, f) + 0.5);
    const size = clamp(z * 4, 16, 26), flip = (b.path[b.path.length - 1] % w.S) < (b.path[0] % w.S);
    const bob = Math.sin(game.time * 3 + b.troops) * 1.2;
    icon('boat', x, y + bob, size, '#000', 0, true, flip);
    icon('sail', x, y + bob, size, '#f4f1e6', 0, false, flip);
    icon('hull', x, y + bob, size, css(players[b.pid].color), 0, false, flip);
    if (z > 1.2 || b.pid === ME) label(fmt(b.troops), x, y - size / 2 - 7, 10, '#fff');
  }
  // rockets
  for (const r of game.rockets) {
    const [wx, wy] = rocketPos(r), x = SX(wx), y = SY(wy), t = tilePos(r.w, r.i), tx = SX(t[0]), ty = SY(t[1]);
    const ang = Math.atan2(ty - y, tx - x);
    if (r.pid === ME) { ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(242,193,78,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]); }
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const fl = 9 + Math.random() * 6;
    ctx.fillStyle = '#ff9a3c'; ctx.beginPath(); ctx.moveTo(-6, -3.5); ctx.lineTo(-6 - fl, 0); ctx.lineTo(-6, 3.5); ctx.fill();
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.moveTo(-6, -1.8); ctx.lineTo(-6 - fl * 0.5, 0); ctx.lineTo(-6, 1.8); ctx.fill();
    ctx.restore();
    icon('rocket', x, y, 20, css(players[r.pid].color), ang + Math.PI / 2, true);
    if (r.pid === ME) label(`${fmt(r.troops)} · ${Math.ceil(r.t1 - game.time)}s`, x, y - 16, 10, '#fff');
  }
  // bombs in flight: they arc over the map; ones you fired or that are aimed at you show where they will land
  for (const n of game.nukes) {
    const w = n.w, S = w.S, N = CFG.nukes[n.type];
    if (!shown(w)) continue;
    const k = clamp((game.time - n.t0) / (n.t1 - n.t0), 0, 1);
    const [x0, y0] = T2S(w, (n.from % S) + 0.5, ((n.from / S) | 0) + 0.5), [x1, y1] = T2S(w, (n.to % S) + 0.5, ((n.to / S) | 0) + 0.5);
    const arc = Math.hypot(x1 - x0, y1 - y0) * 0.18, at = q => [lerp(x0, x1, q), lerp(y0, y1, q) - Math.sin(Math.PI * q) * arc];
    if (n.pid === ME || w.owner[n.to] === ME) { ring(x1, y1, N.outer * z, 'rgba(255,90,60,0.85)', [6, 6]); ring(x1, y1, N.inner * z, 'rgba(255,90,60,0.5)'); }
    ctx.strokeStyle = 'rgba(255,225,190,0.55)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let q = Math.max(0, k - 0.2); q <= k; q += 0.02) { const [px, py] = at(q); if (q === Math.max(0, k - 0.2)) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
    ctx.stroke();
    const [x, y] = at(k), [xa, ya] = at(Math.min(1, k + 0.01)), [xb, yb] = at(Math.max(0, k - 0.01));
    icon('missile', x, y, n.type === 'hydro' ? 24 : 17, n.type === 'hydro' ? '#ffd65a' : '#f2f2f2', Math.atan2(ya - yb, xa - xb) + Math.PI / 2, true);
  }
  for (const t of game.tracers) {
    if (!shown(t.w)) continue;
    const [x0, y0] = T2S(t.w, t.x0, t.y0), [x1, y1] = T2S(t.w, t.x1, t.y1);
    ctx.strokeStyle = `rgba(150,210,255,${1 - (game.time - t.t0) / 0.4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  for (const b of game.blasts) {
    const k = (game.time - b.t0) / b.dur;
    if (k >= 1 || k < 0 || !shown(b.w)) continue;
    const [x, y] = T2S(b.w, b.x, b.y), R = Math.max(4, b.r * z * (0.35 + 0.65 * k)), g = ctx.createRadialGradient(x, y, 0, x, y, R), a = 1 - k;
    g.addColorStop(0, `rgba(255,255,235,${a})`); g.addColorStop(0.35, `rgba(255,190,80,${a * 0.85})`); g.addColorStop(0.75, `rgba(230,80,30,${a * 0.5})`); g.addColorStop(1, 'rgba(120,30,10,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ring(x, y, R, `rgba(255,240,210,${a * 0.8})`);
  }
  // a ripple where you just sent troops
  if (game.pings.length) {
    const now = performance.now();
    game.pings = game.pings.filter(q => now - q.t0 < 900);
    for (const q of game.pings) {
      const k = (now - q.t0) / 900, [x, y] = T2S(q.w, (q.i % q.w.S) + 0.5, ((q.i / q.w.S) | 0) + 0.5);
      ring(x, y, 6 + k * 22, `rgba(255,233,160,${1 - k})`);
      ctx.globalAlpha = 1 - k; label(q.text, x, y - 14 - k * 16, 12, '#ffe9a0'); ctx.globalAlpha = 1;
    }
  }
  // troops left in each attack you are part of, on its front: yours in white, attacks on you in red
  for (const a of game.attacks) {
    if (!a.lab || !shown(a.w)) continue;
    a.lx = a.lx == null ? a.lab[0] : lerp(a.lx, a.lab[0], 0.1); a.ly = a.ly == null ? a.lab[1] : lerp(a.ly, a.lab[1], 0.1);
    const [x, y] = T2S(a.w, a.lx + 0.5, a.ly + 0.5);
    pill(fmt(a.troops), x, y, a.pid === ME ? '#fff' : '#ff9d8c', css(players[a.pid].color), 'sword');
  }
  if (game.paused && !game.over) label('PAUSED', cw / 2, 96, 22, '#f2c14e');
}

// ======================================================================
// HUD
// ======================================================================
let hover = null, toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600 + msg.length * 35);
}
const TOOLS = Object.assign({}, CFG.buildings, CFG.nukes);
function buildBar() {
  $('build').innerHTML = Object.entries(TOOLS).map(([type, b]) =>
    `<button class="bbtn${CFG.nukes[type] ? ' weapon' : ''}" data-type="${type}" title="${b.desc}"><div class="ic">${CFG.nukes[type] ? svgIcon(type, 26) : `<img src="${sprite(type, players[ME].color).toDataURL()}" width="38" height="38" alt="">`}</div><div class="nm"><span class="key">${b.key} </span>${b.name}</div><div class="cs"></div></button>`).join('');
  for (const el of document.querySelectorAll('.bbtn')) el.onclick = () => setTool(game.tool === el.dataset.type ? null : el.dataset.type);
}
// where each attack's number sits: the front tile nearest the spot you clicked (or the middle of the front)
function updateAttackLabels() {
  for (const a of game.attacks) {
    if ((a.pid !== ME && a.target !== ME) || !a.set.size) { a.lab = null; continue; }
    const S = a.w.S, stepN = Math.ceil(a.set.size / 300), pts = [];
    let n = 0, sx = 0, sy = 0;
    for (const i of a.set) { if (n++ % stepN) continue; const x = i % S, y = (i / S) | 0; pts.push(x, y); sx += x; sy += y; }
    const rx = a.aim != null && a.pid === ME ? a.aim % S : sx / (pts.length / 2), ry = a.aim != null && a.pid === ME ? (a.aim / S) | 0 : sy / (pts.length / 2);
    let best = Infinity;
    for (let k = 0; k < pts.length; k += 2) { const d = (pts[k] - rx) ** 2 + (pts[k + 1] - ry) ** 2; if (d < best) { best = d; a.lab = [pts[k], pts[k + 1]]; } }
  }
}
function setTool(type) {
  game.tool = type;
  for (const el of document.querySelectorAll('.bbtn')) el.classList.toggle('sel', el.dataset.type === type);
}
function updateHud() {
  const p = players[ME], cap = capOf(p), pct = +$('send-pct').value;
  $('val-troops').textContent = `${fmt(p.troops)} / ${fmt(cap)}`;
  $('troop-fill').style.width = clamp(p.troops / cap * 100, 0, 100) + '%';
  $('val-gold').textContent = fmt(p.gold);
  $('rate-gold').textContent = `+${fmt(p.goldRate)}/s`;
  $('rate-troops').textContent = `${p.troopRate >= 0 ? '+' : '-'}${fmt(Math.abs(Math.round(p.troopRate)))}/s`;
  $('val-land').textContent = (p.tiles / totalLand * 100).toFixed(1) + '%';
  $('val-time').textContent = fmtTime(game.time);
  $('val-view').textContent = cam.body.name.replace(/^the /, '');
  $('send-n').textContent = `${pct}% · ${fmt(p.troops * pct / 100)} troops`;
  for (const el of document.querySelectorAll('.bbtn')) {
    const c = CFG.nukes[el.dataset.type] ? CFG.nukes[el.dataset.type].cost : costOf(p, el.dataset.type);
    el.querySelector('.cs').textContent = fmt(c) + ' gold';
    el.classList.toggle('poor', p.gold < c);
  }
  // worlds
  $('world-list').innerHTML = worlds.map(w => {
    const mine = p.wt[w.ix];
    let note;
    if (mine) note = `<span class="ok">${(mine / w.land * 100).toFixed(mine / w.land < 0.1 ? 1 : 0)}%</span>`;
    else if (!p.cnt.pad) note = '';
    else {
      const f = findPad(ME, w);
      note = f.pad ? '<span class="ok">in range</span>' : f.kind === 'refuel' ? '<span class="no">refuel</span>'
        : f.kind === 'stone' ? `<span class="no">pad on ${f.stone.name.replace(/^the /, '')}</span>` : '<span class="no">too far</span>';
    }
    return `<div class="row${cam.body === w.body ? ' cur' : ''}" data-ix="${w.body.ix}"><span class="dot" style="background:${css(w.tint)}"></span><span class="n">${w.name.replace(/^the /, '')}</span><span class="d">${note}</span></div>`;
  }).join('') + `<div class="row${cam.body === SUN ? ' cur' : ''}" data-ix="-1"><span class="dot" style="background:#ffd65a"></span><span class="n">Solar system</span></div>`;
  // nations
  const live = players.slice(1).filter(q => q.alive).sort((a, b) => b.tiles - a.tiles);
  const top = live.slice(0, 8);
  if (!top.includes(p) && p.alive) top.push(p);
  $('leader-list').innerHTML = top.map(q =>
    `<div class="row${q === p ? ' me' : ''}"><span class="dot" style="background:${css(q.color)}"></span><span class="n">${live.indexOf(q) + 1}. ${q.name}</span><span class="d">${(q.tiles / totalLand * 100).toFixed(1)}% · ${fmt(q.troops)}</span></div>`).join('')
    + `<div class="row"><span class="n d">${live.length} nations left</span></div>`;
  // orders
  const rows = [];
  for (const a of game.attacks) if (a.pid === ME) rows.push(`${svgIcon('sword', 13)} ${a.target ? players[a.target].name : 'Free land'} · ${fmt(a.troops)}`);
  for (const b of game.boats) if (b.pid === ME) rows.push(`${svgIcon('boat', 13)} ${fmt(b.troops)} at sea`);
  for (const r of game.rockets) if (r.pid === ME) rows.push(`${svgIcon('rocket', 13)} ${fmt(r.troops)} → ${r.w.name.replace(/^the /, '')} · ${Math.ceil(r.t1 - game.time)}s`);
  for (const n of game.nukes) if (n.pid === ME) rows.push(`${svgIcon(n.type, 13)} ${CFG.nukes[n.type].name} · ${Math.max(0, Math.ceil(n.t1 - game.time))}s`);
  $('orders').style.display = rows.length ? 'block' : 'none';
  // under the worlds panel, or under the phone button row while that panel is closed
  const above = $('worlds').offsetHeight ? $('worlds') : $('mbar');
  $('orders').style.top = (above.getBoundingClientRect().bottom + 8) + 'px';
  $('pause-btn').textContent = game.paused ? 'Resume' : 'Pause';
  $('order-list').innerHTML = rows.map(r => `<div class="row"><span class="n">${r}</span></div>`).join('');
}
function updateHover() {
  hover = pickAt(mouse.x, mouse.y);
  let text = '&nbsp;';
  if (hover && hover.body) text = `<b>${hover.body.name}</b> · click to fly there`;
  else if (hover) {
    const w = hover.w, o = w.owner[hover.i], b = w.blds.get(hover.i);
    text = `${w.name.replace(/^the /, '')} · ${w.mined[hover.i] ? 'Mined rock' : w.names[w.terr[hover.i]]}`;
    if (o) text += ` · <b>${players[o].name}</b> (${fmt(players[o].troops)} troops)`;
    else if (isLandT(w.terr[hover.i])) text += ' · free land';
    if (b) text += ` · ${CFG.buildings[b.type].name}` + (b.type === 'rig' ? ` (+${fmt(b.yield * CFG.tickHz)} gold/s)` : '');
  }
  $('hover-info').innerHTML = text;
}

// ======================================================================
// input
// ======================================================================
function click(px, py) {
  const hit = pickAt(px, py);
  if (!hit) return;
  if (hit.body) { lockOn(hit.body); return; }
  const { w, i } = hit;
  if (game.phase === 'spawn') {
    if (w.body !== HOME || !isLandT(w.terr[i])) { toast('Pick a spot on land, on the disk'); return; }
    if (w.owner[i]) { toast('That land is taken'); return; }
    spawnBlob(ME, w, i % w.S, (i / w.S) | 0);
    for (const q of worlds) scanWorld(q);
    game.phase = 'play';
    $('banner').style.display = 'none';
    return;
  }
  if (game.over) return;
  if (game.tool) {
    const err = CFG.nukes[game.tool] ? launchNuke(ME, game.tool, w, i) : place(ME, game.tool, w, i);
    if (err) toast(err); else setTool(null);
    return;
  }
  if (!isLandT(w.terr[i]) || w.owner[i] === ME) return;
  const before = players[ME].troops, err = order(ME, w, i, +$('send-pct').value / 100);
  if (err) toast(err);
  else game.pings.push({ w, i, text: '+' + fmt(before - players[ME].troops), t0: performance.now() });
}
// zoom to z1 keeping the screen point (px, py) still
function zoomAt(px, py, z1) {
  const z0 = cam.zoom; z1 = clamp(z1, CFG.zoomMin, CFG.zoomMax);
  const dx = px - cw / 2, dy = py - ch / 2;
  cam.x += dx / z0 - dx / z1; cam.y += dy / z0 - dy / z1; cam.zoom = z1;
}
function togglePause() {
  if (game.phase === 'play' && !game.over) game.paused = !game.paused;
  $('pause-btn').textContent = game.paused ? 'Resume' : 'Pause';
}
// phones: one panel open at a time (worlds or nations), opened from the button row
function showPanel(name) {
  const open = document.body.dataset.panel === name ? '' : name;
  document.body.dataset.panel = open;
  for (const el of document.querySelectorAll('#mbar [data-panel]')) el.classList.toggle('on', el.dataset.panel === open);
}
function bindInput() {
  // pointer events cover the mouse, a pen and fingers: one pointer drags the map, two pinch-zoom it,
  // and a press that barely moves is a click (a tap on a phone)
  const ptrs = new Map();   // active pointers by id: their last position
  let pressTimer = 0;       // a finger held still: put the tool down (iPhones send no contextmenu for a long press)
  const midDist = () => { const [a, b] = [...ptrs.values()]; return [(a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(a.x - b.x, a.y - b.y)]; };
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(pressTimer);
    if (ptrs.size === 1) {
      mouse.down = true; mouse.drag = false; mouse.t0 = performance.now(); mouse.sx = e.clientX; mouse.sy = e.clientY; mouse.btn = e.button;
      if (e.pointerType !== 'mouse') pressTimer = setTimeout(() => { if (mouse.down && !mouse.drag && ptrs.size === 1) { mouse.drag = true; if (game.tool) { setTool(null); toast('Put down'); } } }, 550);
    } else mouse.drag = true;   // a second finger: a pinch, never a tap
    mouse.x = e.clientX; mouse.y = e.clientY;
  });
  window.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (p && ptrs.size >= 2) {
      const [mx0, my0, d0] = midDist();
      p.x = e.clientX; p.y = e.clientY;
      const [mx1, my1, d1] = midDist();
      if (d0 > 0) zoomAt(mx1, my1, cam.zoom * d1 / d0);
      cam.x -= (mx1 - mx0) / cam.zoom; cam.y -= (my1 - my0) / cam.zoom;
    } else if (p) {
      if (!mouse.drag && Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > (performance.now() - mouse.t0 < 250 ? 14 : 6)) mouse.drag = true;
      if (mouse.drag) { cam.x -= (e.clientX - p.x) / cam.zoom; cam.y -= (e.clientY - p.y) / cam.zoom; }
      p.x = e.clientX; p.y = e.clientY;
    }
    if (e.pointerType === 'mouse' || p) { mouse.x = e.clientX; mouse.y = e.clientY; }
  });
  const release = (e, cancelled) => {
    if (!ptrs.delete(e.pointerId)) return;
    clearTimeout(pressTimer);
    if (!ptrs.size) {
      if (!cancelled && !mouse.drag && mouse.btn === 0) click(e.clientX, e.clientY);
      mouse.down = false;
    }
  };
  window.addEventListener('pointerup', e => release(e, false));
  window.addEventListener('pointercancel', e => release(e, true));
  // right-click, or a long press on a phone: put the tool down (and don't let the press count as a tap)
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); mouse.drag = true; setTool(null); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, cam.zoom * Math.pow(1.0018, -e.deltaY));
  }, { passive: false });
  // the phone button row stands in for the keys
  $('mbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.panel) showPanel(b.dataset.panel);
    else if (b.dataset.act === 'home') lockOn(HOME);
    else if (b.dataset.act === 'out') zoomOutLevel();
    else if (b.dataset.act === 'pause') togglePause();
  });
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    const type = Object.keys(TOOLS).find(t => TOOLS[t].key === k);
    if (type) setTool(game.tool === type ? null : type);
    else if (k === 'escape') setTool(null);
    else if (k === 'h') lockOn(HOME);
    else if (k === 'm') zoomOutLevel();
    else if (k === ' ') { togglePause(); e.preventDefault(); }
    else if (k === '[' || k === ']') { const s = $('send-pct'); s.value = clamp(+s.value + (k === ']' ? 10 : -10), 5, 100); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('resize', resize);
  $('world-list').addEventListener('pointerdown', e => {   // pointerdown: the list is redrawn too often for click to land
    const row = e.target.closest('.row');
    if (!row) return;
    if (row.dataset.ix === '-1') lockOn(SUN, fitZoom(CFG.space.au * CFG.space.seedWorld.orbit * 1.08)); else lockOn(bodies[+row.dataset.ix]);
    if (document.body.dataset.panel) showPanel(document.body.dataset.panel);   // phones: close the panel to see where you went
  });
  $('send-pct').addEventListener('change', e => e.target.blur());
  $('ov-btn').onclick = () => { location.href = location.pathname; };
}

// ======================================================================
// start
// ======================================================================
function init() {
  buildSystem();
  updatePositions(0);
  addPlayer(true);
  const w = HOME.world, spots = [];
  for (let n = 0, tries = 0; n < CFG.bots && tries < 20000; tries++) {
    const i = (rng() * w.N) | 0, x = i % w.S, y = (i / w.S) | 0;
    if (w.terr[i] !== PLAIN || spots.some(s => (s[0] - x) ** 2 + (s[1] - y) ** 2 < CFG.botSpacing ** 2)) continue;
    spots.push([x, y]); n++;
    spawnBlob(addPlayer(false).id, w, x, y);
  }
  for (const q of worlds) scanWorld(q);
  resize();
  lockOn(HOME);
  buildBar(); bindInput();
  $('my-swatch').style.background = css(players[ME].color);
  $('val-name').textContent = players[ME].name;
  $('val-goal').textContent = Math.round(CFG.winShare * 100) + '%';
  $('banner').textContent = `${TOUCH ? 'Tap' : 'Click'} any free land on the disk to found your nation`;
  if (TOUCH) $('help').innerHTML = `<div class="help-row"><b>Tap</b> land to attack it: over your border, by boat, or by rocket (needs a launch pad) · <b>Drag</b> to pan · <b>Pinch</b> to zoom · tap a building or bomb, then tap where it goes · <b>Long-press</b> to put it down</div><div class="hover" id="hover-info">&nbsp;</div>`;
  $('banner').style.display = 'block';
  $('loading').style.display = 'none';

  let last = performance.now(), acc = 0, hudAt = 0;
  const step = 1 / CFG.tickHz;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const pan = 520 / cam.zoom * dt;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) cam.x += pan;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= pan;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += pan;
    if (game.phase === 'play' && !game.paused && !game.over) {
      acc += dt;
      for (let n = 0; acc >= step && n < 4; n++) { tick(step); acc -= step; }
      if (acc > step * 4) acc = 0;
    }
    draw();
    if (now >= hudAt) { hudAt = now + 250; updateHud(); updateHover(); updateAttackLabels(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
window.game = game; window.players = players; window.worlds = worlds;   // for the console
setTimeout(init, 30);
