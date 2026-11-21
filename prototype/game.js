'use strict';
/*
 * Map Factory — playable prototype of the core loop (design v3).
 *
 *   houses -> people capacity -> people regrow -> spend people to claim land
 *   -> deposits inside CONNECTED territory produce -> resources build houses
 *
 * Territory is either connected to your capital (touching it by land, or linked
 * by rail stations / ports) or cut off. Cut-off land produces nothing and its
 * houses don't count. Expedition outposts must be connected before supplies run out.
 *
 * Everything you might want to tune is in CFG below.
 * Add ?seed=123 to the URL to replay a specific map.
 */

// ======================================================================
// CONFIG — all tuning numbers live here
// ======================================================================
const CFG = {
  // The world is a disk floating in space, ringed by an ice wall.
  mapW: 1000, mapH: 1000,
  continentScale: 115,         // bigger = bigger continents (noise feature size, in tiles)
  climateScale: 150,           // bigger = larger desert regions
  iceWall: { min: 2.5, extra: 4 },  // wall thickness in tiles: min + up to extra (wobbles around the rim)
  waterFraction: 0.5,          // share of the disk (inside the wall) that is ocean
  mountainShare: 0.13,         // top X% of land by height becomes mountains
  desertShare: 0.24,           // driest X% of land becomes desert

  startPeople: 100, startHouses: 10, startRadius: 8,
  startResources: { wood: 30, stone: 30, iron: 0 },
  expeditionKit: { wood: 20, stone: 20 },   // supplies an expedition carries from its home country (if it has them)
  // what a link moves per second between two of your countries
  linkRates: { rail: { people: 3, cargo: 4 }, sea: { people: 2, cargo: 3 } },

  // people regrowth:  growth/sec = rate * P * (1 - P/C) + base
  growthRate: 0.06, growthBase: 0.3,

  // people spent per tile claimed, by biome
  tileCost: { grass: 0.5, desert: 1.5, mountain: 2.5 },
  // how fast a push claims land: "work" per second; a tile takes (cost / grass cost) work
  pushWorkPerSec: budget => 4 + 3 * Math.sqrt(budget),

  prodPerTile: { forest: 0.06, stone: 0.06, iron: 0.06 },   // per owned, connected deposit tile, per second

  // unlock = how many people your whole empire must reach (at its peak) before you can build it
  buildings: {
    // the housing ladder: each level is built by upgrading the one below it in place (`from`).
    // Clicking a lower level pays only the steps in between; clicking clear land pays the whole ladder.
    house:   { key: '1', name: 'House',      cap: 10, unlock: 0,    cost: { wood: 10, stone: 10 },
               desc: 'Holds 10 people in the country you build it in.' },
    house2:  { key: '2', name: 'Apartment',  cap: 30, unlock: 300,  cost: { wood: 20, iron: 10 }, from: 'house',
               desc: 'Click one of your houses to upgrade it: holds 30 people. Needs iron, which is never near the start.' },
    house3:  { key: '3', name: 'City block', cap: 80, unlock: 1000, cost: { wood: 40, stone: 40, iron: 30 }, from: 'house2',
               use: 3, capPowered: 50,
               desc: 'Click an apartment to upgrade it: holds 80 people, but uses 3 MW. Without power it holds only 30.' },
    station: { key: '4', name: 'Station', cap: 0,  unlock: 150, cost: { wood: 15, stone: 10 },
               desc: 'Lays its own rail to your nearest station. Trains carry people and cargo between your countries.' },
    port:    { key: '5', name: 'Port',    cap: 0,  unlock: 200, cost: { wood: 20, stone: 10 },
               desc: 'On the coast. Opens a sea route to your nearest port. Ships carry people and cargo.' },
    // energy: every country has its own power budget (supply from plants, demand from machines)
    burner:  { key: '6', name: 'Wood burner', cap: 0, unlock: 400, cost: { wood: 10, stone: 20 }, gen: 8,
               desc: 'Burns wood for 8 MW of power, up to 0.25 wood/s. It only burns what your country needs.' },
    rig:     { key: '7', name: 'Mining rig',  cap: 0, unlock: 500, cost: { wood: 20, stone: 10, iron: 10 }, use: 4,
               from: ['cabin', 'camp'],
               desc: 'Click a logger\'s cabin or miner\'s camp to upgrade it: 3x the output and frees its workers, but runs on 4 MW. No power, no output.' },
    solar:   { key: '8', name: 'Solar panel', cap: 0, unlock: 700, cost: { stone: 10, iron: 5 }, gen: 1.5,
               desc: '1.5 MW, free, forever. Each panel takes a tile you can\'t use for anything else. Cover land with them.' },
    // collectors: a deposit only produces once something works it. Early on that's people.
    cabin:   { key: '9', name: "Logger's cabin", cap: 0, unlock: 0, cost: { wood: 5, stone: 10 }, workers: 5, on: ['forest'],
               desc: 'Build it on a forest so it produces wood. Employs 5 of the country\'s people, who can\'t be sent anywhere.' },
    camp:    { key: '0', name: "Miner's camp",   cap: 0, unlock: 0, cost: { wood: 15, stone: 5 }, workers: 5, on: ['stone', 'iron'],
               desc: 'Build it on stone or iron so it produces. Employs 5 of the country\'s people, who can\'t be sent anywhere.' },
  },
  power: { burnerWood: 0.25, rigMult: 3 },   // wood/s a burner eats at full output; output multiplier of a powered rig

  // rail: a new station links itself to the nearest station by the cheapest land route
  trackCostPerTile: { wood: 0.25, stone: 0.25 },
  trackWeight: { grass: 1, desert: 1.5, mountain: 3 },   // track through mountains costs 3x
  railMaxLength: 120,          // max weighted track length for one link
  seaMaxLength: 500,           // max sea route length (tiles)
  trainSpeed: 12, shipSpeed: 9,

  expeditionSpeed: 18,         // tiles per second
  outpostRadius: 3,            // land claimed on arrival
  outpostSupply: 45,           // seconds to connect an outpost before its settlers starve

  // the moon: a smaller world orbiting the disk (visual only, for now)
  // orbit 30 = half the real Earth–Moon distance (the real Moon is ~60 Earth radii away)
  moon: {
    radius: 130, orbit: 30, period: 240,   // radius in tiles; orbit = x disk radius; period in seconds
    plainsShare: 0.42,                     // share of the moon covered by dark basalt plains (the rest is highlands)
    craters: 340,                          // how many craters to scatter (most land on the highlands)
  },
  // the sun: the disk circles it once a "year". The game stays centred on the disk, so normally
  // the sun appears to circle you; lock onto the sun to see your world going around it instead.
  sun: {
    radius: 12,                            // x disk radius (the real Sun is ~109x Earth; scaled down to fit)
    distance: 24,                          // x the Earth-Moon distance (real: ~390x)
    year: 720,                             // seconds per orbit
  },
  // Vulcan: a lava world orbiting the sun, inside your world's orbit
  vulcan: {
    size: 0.7,                             // x your world's radius
    orbit: 0.45,                           // x your world's distance from the sun
    year: 217,                             // seconds per orbit (closer to the sun = faster)
    spin: 90,                              // seconds per turn on its own axis
    lavaShare: 0.2,                        // share of the surface that is open lava sea
  },
  // the outer planets (size = x your world's radius, orbit = x your world's distance from the sun,
  // spin = seconds per turn). Years follow Kepler's law: farther out = slower.
  planets: {
    aries:    { size: 0.53, orbit: 1.5, spin: 120 },   // the red planet
    zeus:     { size: 5.0,  orbit: 3.2, spin: 40 },    // banded gas giant with 3 moons
    poseidon: { size: 3.8,  orbit: 5.0, spin: 50 },    // blue ringed gas giant with 2 moons
    seedWorld: { orbit: 7.5 },                          // the far planet, generated from the map seed
  },

  tickHz: 20,
  zoomMin: 0.0001, zoomMax: 40, startZoom: 14,
  detailZoom: 10,              // >= this: full sprites
  cityZoom: 5,                 // <  this: map view (city icons + deposit markers)
};

// ======================================================================
// small helpers
// ======================================================================
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

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
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtNum(n) { return n >= 1000 ? Math.floor(n).toLocaleString() : String(Math.floor(n)); }
function addCost(a, b) {
  const o = { ...a };
  if (b) for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v;
  return o;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(v, key) {
    const a = this.k, b = this.v;
    let i = a.length; a.push(key); b.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [b[p], b[i]] = [b[i], b[p]]; i = p;
    }
  }
  pop() {
    const a = this.k, b = this.v, top = b[0];
    const lk = a.pop(), lv = b.pop();
    if (a.length) {
      a[0] = lk; b[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [b[m], b[i]] = [b[i], b[m]]; i = m;
      }
    }
    return top;
  }
}

// ======================================================================
// sprites (same item models as the concept art)
// ======================================================================
const SHAPES = {
  person: `<circle cx="0" cy="-4.5" r="3" fill="#f2c14e" stroke="#5a4310" stroke-width="0.8"/>
    <path d="M-4.5 5 C-4.5 0 -2.5 -0.8 0 -0.8 C2.5 -0.8 4.5 0 4.5 5 Z" fill="#f2c14e" stroke="#5a4310" stroke-width="0.8"/>`,
  house: `<rect x="-7" y="-6" width="18" height="16" fill="#000" opacity="0.22"/>
    <rect x="-9" y="-8" width="18" height="8" fill="#de6d4c"/><rect x="-9" y="0" width="18" height="8" fill="#b04a31"/>
    <rect x="-9" y="-8" width="18" height="16" fill="none" stroke="#6b2b1b" stroke-width="1"/>
    <line x1="-9" y1="0" x2="9" y2="0" stroke="#7d3220" stroke-width="1.2"/><rect x="3" y="-6.5" width="3.2" height="4" fill="#4e3a33"/>`,
  house2: `<rect x="-9" y="-8" width="24" height="20" fill="#000" opacity="0.22"/>
    <rect x="-12" y="-10" width="24" height="10" fill="#7099c4"/><rect x="-12" y="0" width="24" height="10" fill="#4d6f96"/>
    <rect x="-12" y="-10" width="24" height="20" fill="none" stroke="#2c4260" stroke-width="1"/>
    <line x1="-12" y1="0" x2="12" y2="0" stroke="#2c4260" stroke-width="1.2"/>
    <rect x="-8" y="-8" width="3" height="4" fill="#3a3f4a"/><rect x="5" y="-8" width="3" height="4" fill="#3a3f4a"/>`,
  house3: `<rect x="-10" y="-9" width="26" height="25" fill="#000" opacity="0.25"/>
    <rect x="-13" y="-13" width="26" height="26" rx="1.5" fill="#5f6b7d" stroke="#2b323d" stroke-width="1"/>
    <rect x="-11" y="-11" width="10" height="10" fill="#8fa3b8"/><rect x="1" y="-11" width="10" height="10" fill="#7c8fa4"/>
    <rect x="-11" y="1" width="10" height="10" fill="#7c8fa4"/><rect x="1" y="1" width="10" height="10" fill="#8fa3b8"/>
    <path d="M-9 -8 H-3 M-9 -4 H-3 M3 -8 H9 M3 -4 H9 M-9 4 H-3 M-9 8 H-3 M3 4 H9 M3 8 H9" stroke="#f2d98a" stroke-width="1.3"/>`,
  burner: `<rect x="-9" y="-7" width="22" height="20" fill="#000" opacity="0.22"/>
    <rect x="-11" y="-6" width="20" height="16" rx="1.5" fill="#8a5a44" stroke="#4a2a1e" stroke-width="1"/>
    <rect x="3" y="-13" width="5" height="9" fill="#6b4535" stroke="#4a2a1e" stroke-width="0.9"/>
    <path d="M-6 6 C-7 2 -4 0 -3 -2 C-2 1 0 1 0 -1 C2 2 2 5 0 6 Z" fill="#ffb238" stroke="#d9531e" stroke-width="0.9"/>
    <circle cx="5.5" cy="-14" r="2.2" fill="#c8c8c8" opacity="0.7"/>`,
  rig: `<rect x="-8" y="-8" width="22" height="22" fill="#000" opacity="0.2"/>
    <path d="M-9 11 L0 -12 L9 11" fill="none" stroke="#e0a93a" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M-5.5 2 H5.5 M-3 -5 H3" stroke="#e0a93a" stroke-width="1.6"/>
    <rect x="-11" y="9" width="22" height="4" rx="1" fill="#59616b" stroke="#2b3038" stroke-width="0.8"/>
    <path d="M0 -12 V9" stroke="#3d434a" stroke-width="1.6"/><circle cx="0" cy="-12" r="2" fill="#f2c14e" stroke="#5a4310" stroke-width="0.8"/>`,
  solar: `<rect x="-10" y="-8" width="24" height="22" fill="#000" opacity="0.18"/>
    <rect x="-12" y="-11" width="24" height="22" rx="1" fill="#1d3e78" stroke="#c9d3df" stroke-width="1.2"/>
    <path d="M-4 -11 V11 M4 -11 V11 M-12 -3.7 H12 M-12 3.7 H12" stroke="#6f93cf" stroke-width="1"/>
    <path d="M-11 -10 L-6 -10 L-10 -6 Z" fill="#9fc0f0" opacity="0.7"/>`,
  cabin: `<rect x="-9" y="-5" width="22" height="18" fill="#000" opacity="0.22"/>
    <path d="M-12 -1 L0 -11 L12 -1 Z" fill="#7a4a2a" stroke="#3e2414" stroke-width="1" stroke-linejoin="round"/>
    <rect x="-10" y="-1" width="20" height="12" fill="#a0683e" stroke="#3e2414" stroke-width="1"/>
    <path d="M-10 3 H10 M-10 7 H10" stroke="#6e4426" stroke-width="0.9"/><rect x="-3" y="3" width="6" height="8" fill="#3e2414"/>
    <path d="M7 -14 L11 -6 M11 -14 L7 -6" stroke="#cfd5db" stroke-width="1.6"/>`,
  camp: `<rect x="-9" y="-6" width="22" height="19" fill="#000" opacity="0.22"/>
    <path d="M-12 11 L-3 -9 L6 11 Z" fill="#c9a66b" stroke="#5a4310" stroke-width="1" stroke-linejoin="round"/>
    <path d="M-3 -9 V11" stroke="#5a4310" stroke-width="0.9"/><path d="M-6 11 L-3 3 L0 11 Z" fill="#4a3a28"/>
    <path d="M5 -10 L12 -3 M8 -12 L4 -6 L10 -8" stroke="#8d969e" stroke-width="2" stroke-linecap="round"/>
    <path d="M6 -8 L13 1" stroke="#7a4a2a" stroke-width="1.6" stroke-linecap="round"/>`,
  bolt: `<path d="M2 -11 L-7 2 H-1 L-3 11 L7 -3 H1 Z" fill="#f2c14e" stroke="#5a4310" stroke-width="0.9" stroke-linejoin="round"/>`,
  station: `<rect x="-10" y="-8" width="24" height="20" fill="#000" opacity="0.22"/>
    <rect x="-12" y="-10" width="24" height="20" rx="2" fill="#a3aab1" stroke="#4c535b" stroke-width="1"/>
    <path d="M-9 -2 V6 M-4 -2 V6 M1 -2 V6 M6 -2 V6" stroke="#6b5240" stroke-width="1.6"/>
    <path d="M-12 0 H12 M-12 4 H12" stroke="#3d434a" stroke-width="1.4"/>
    <rect x="-7" y="-10" width="14" height="6" fill="#c4553a" stroke="#6b2b1b" stroke-width="0.8"/>`,
  port: `<rect x="-12" y="-12" width="24" height="24" rx="2" fill="#4a86ab"/><rect x="-12" y="-12" width="24" height="7" fill="#dccf93"/>
    <rect x="-4" y="-7" width="8" height="18" fill="#a67c52" stroke="#6b4a2b" stroke-width="0.9"/>
    <path d="M-4 -2 H4 M-4 3 H4 M-4 8 H4" stroke="#6b4a2b" stroke-width="0.8"/>
    <circle cx="-5.5" cy="10" r="1.4" fill="#5a3d22"/><circle cx="5.5" cy="10" r="1.4" fill="#5a3d22"/>`,
  tree: `<ellipse cx="1.5" cy="3" rx="7" ry="4" fill="#000" opacity="0.18"/><circle r="7" fill="#3d6b32"/>
    <circle cx="-2" cy="-2" r="4.2" fill="#558a3f"/><circle cx="-3" cy="-3" r="1.6" fill="#72a855"/>`,
  rock: `<ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 3 L-6 -4 L-1 -7 L5 -5 L8 1 L5 5 L-4 6 Z" fill="#8e959c" stroke="#5f666d" stroke-width="1"/>
    <path d="M-6 -4 L-1 -7 L5 -5 L1 -1 L-4 0 Z" fill="#bcc2c8"/>`,
  ore: `<ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 2 L-5 -5 L1 -7 L6 -4 L8 2 L4 6 L-4 5 Z" fill="#7a5040" stroke="#45291f" stroke-width="1"/>
    <path d="M-5 -5 L1 -7 L6 -4 L2 0 L-4 -1 Z" fill="#a96d52"/>
    <circle cx="-3" cy="2" r="1.1" fill="#d6e1ea"/><circle cx="3" cy="-2.5" r="0.9" fill="#d6e1ea"/>`,
  boat: `<path d="M-12 0 H12 L8 7 H-8 Z" fill="#a67c52" stroke="#5a3d22" stroke-width="1"/>
    <path d="M0 -12 V0" stroke="#5a3d22" stroke-width="1.5"/><path d="M1 -11 L10 -3 H1 Z" fill="#f4f1e6" stroke="#8d969e" stroke-width="0.6"/>`,
};
const SVG = {}, SPR = {};
for (const [name, inner] of Object.entries(SHAPES)) {
  SVG[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 30 30" width="64" height="64">${inner}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SVG[name]);
  SPR[name] = img;
}
const DEP_SPRITE = { forest: 'tree', stone: 'rock', iron: 'ore' };
const DEP_RES = { forest: 'wood', stone: 'stone', iron: 'iron' };
const DEP_COLOR = { forest: '#3f7a35', stone: '#a7adb3', iron: '#a8654a' };
const BLD_CODE = { house: 1, house2: 2, station: 3, port: 4, house3: 5, burner: 6, rig: 7, solar: 8, cabin: 9, camp: 10 };
const BLD_COLOR = { house: '#cf5c3e', house2: '#5d84b0', house3: '#7c8fa4', station: '#8f979f', port: '#a67c52',
  burner: '#8a5a44', rig: '#e0a93a', solar: '#1d3e78', cabin: '#a0683e', camp: '#c9a66b' };
// housing ladder helpers
const LEVEL = { house: 1, house2: 2, house3: 3 };
const buildingAt = i => (building[i] ? game.buildings.find(b => b.i === i) : null);
// the steps from `have` (or clear land) up to `type`, or null if `have` isn't below `type` on its ladder
function ladderSteps(type, have) {
  const steps = [];
  for (let t = type; t;) {
    if (t === have) return steps;
    steps.unshift(t);
    const f = CFG.buildings[t].from;
    if (Array.isArray(f)) return f.includes(have) ? steps : null;   // a branching ladder: only as an upgrade
    t = f;
  }
  return have ? null : steps;
}
const RES_ICON = { wood: 'tree', stone: 'rock', iron: 'ore' };

// ======================================================================
// world state
// ======================================================================
const OCEAN = 0, GRASS = 1, DESERT = 2, MOUNTAIN = 3, ICE = 4, VOID = 5;
const BIOME_NAME = ['Ocean', 'Grassland', 'Desert', 'Mountains', 'Ice wall', 'Space'];
const BIOME_KEY = [null, 'grass', 'desert', 'mountain', null, null];

const params = new URLSearchParams(location.search);
const SEED = params.has('seed') ? (parseInt(params.get('seed'), 10) || 1) : ((Math.random() * 1e6) | 0);
const W = CFG.mapW, H = CFG.mapH, N = W * H;
const rng = mulberry32(SEED);
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1]];
const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

const elev = new Float32Array(N), moist = new Float32Array(N), detail = new Float32Array(N);
const oceanDist = new Uint8Array(N);
const iceT = new Float32Array(N);          // 0 = inner face of the ice wall, 1 = outer edge
const biome = new Uint8Array(N);
const isLand = i => biome[i] >= GRASS && biome[i] <= MOUNTAIN;
const DISK = { cx: W / 2, cy: H / 2, R: Math.min(W, H) / 2 - 2 };   // outer edge of the ice wall
const landmass = new Int32Array(N).fill(-1);
const owner = new Uint8Array(N);
const depositOf = new Int16Array(N).fill(-1);
const building = new Uint8Array(N);
const deposits = [];
let seaLevel = 0, mtnLevel = 0, maxElev = 1;
let spawn = { x: 0, y: 0 };
let capitalTile = 0;

const game = {
  countries: [],          // every country you have founded (merged ones stay, marked not alive)
  active: 0,              // the country the HUD is showing
  population: 0, peakPop: 0, unlocked: new Set(),
  time: 0, landTiles: 0, ownedCount: 0,
  ownedDep: { forest: 0, stone: 0, iron: 0 },
  buildings: [], stations: [], ports: [], links: [],
  pushes: [], expeditions: [], outposts: [], floats: [],
  sendPct: 25, tool: null, netDirty: true,
  selection: [],   // tiles of selected buildings (box-select with left-drag)
};
const frontier = new Set();   // unowned land tiles touching our territory

// ======================================================================
// map generation
// ======================================================================
function generateTerrain() {
  const s = SEED, { cx, cy, R } = DISK;
  const inside = new Uint8Array(N);   // 1 = inside the ice wall (land or ocean)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    detail[i] = fbm(x / 5, y / 5, s + 33, 3);
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r > R) { biome[i] = VOID; continue; }
    // ice wall thickness wobbles around the rim (noise sampled on a circle, so it wraps seamlessly)
    const ang = Math.atan2(dy, dx);
    const wall = CFG.iceWall.min + fbm(Math.cos(ang) * 7 + 50, Math.sin(ang) * 7 + 50, s + 61, 3) * CFG.iceWall.extra;
    if (r > R - wall) { biome[i] = ICE; iceT[i] = (r - (R - wall)) / wall; continue; }
    inside[i] = 1;
    const wx = x + (fbm(x / 45, y / 45, s + 5, 3) - 0.5) * 36;
    const wy = y + (fbm(x / 45, y / 45, s + 9, 3) - 0.5) * 36;
    // two scales: big continents + smaller blobs that break off as islands
    const cs = CFG.continentScale;
    let e = fbm(wx / cs, wy / cs, s, 5) * 0.7 + fbm(wx / 32, wy / 32, s + 51, 4) * 0.3;
    // land thins out toward the wall, so the rim is mostly a ring of sea (with some coasts reaching the ice)
    const edge = clamp((R - wall - r) / (R * 0.07), 0, 1);
    e = e * (0.7 + 0.3 * edge) - (1 - edge) * 0.09;
    elev[i] = e;
    moist[i] = fbm(x / CFG.climateScale, y / CFG.climateScale, s + 77, 4);
  }
  const sample = [];
  for (let guard = 0; sample.length < 30000 && guard < 400000; guard++) {
    const i = (rng() * N) | 0;
    if (inside[i]) sample.push(elev[i]);
  }
  sample.sort((a, b) => a - b);
  seaLevel = sample[Math.floor(sample.length * CFG.waterFraction)];

  const landE = [], landM = [];
  for (let i = 0; i < N; i++) if (inside[i] && elev[i] > seaLevel) { landE.push(elev[i]); landM.push(moist[i]); }
  landE.sort((a, b) => a - b); landM.sort((a, b) => a - b);
  mtnLevel = landE[Math.floor(landE.length * (1 - CFG.mountainShare))];
  maxElev = landE[landE.length - 1];
  const dryLevel = landM[Math.floor(landM.length * CFG.desertShare)];

  for (let i = 0; i < N; i++) {
    if (!inside[i]) continue;
    if (elev[i] <= seaLevel) biome[i] = OCEAN;
    else if (elev[i] >= mtnLevel) biome[i] = MOUNTAIN;
    else if (moist[i] <= dryLevel) biome[i] = DESERT;
    else biome[i] = GRASS;
    if (isLand(i)) game.landTiles++;
  }

  // distance from land (or the ice wall), for ocean shading
  oceanDist.fill(255);
  const q = [];
  for (let i = 0; i < N; i++) if (biome[i] !== OCEAN && biome[i] !== VOID) { oceanDist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i / W) | 0, d = oceanDist[i];
    if (d >= 20) continue;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (oceanDist[n] > d + 1) { oceanDist[n] = d + 1; q.push(n); }
    }
  }

  // landmass ids (rail can only link stations on the same landmass)
  let lm = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!isLand(s0) || landmass[s0] >= 0) continue;
    const stack = [s0]; landmass[s0] = lm;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const n = idx(nx, ny);
        if (isLand(n) && landmass[n] < 0) { landmass[n] = lm; stack.push(n); }
      }
    }
    lm++;
  }
}

// Spawn on open grassland near the middle of the disk: search the central 35% of the
// radius first, and only widen the search if nothing good is found there.
function chooseSpawn() {
  let best = null, bestScore = -1;
  for (const frac of [0.35, 0.55, 0.8]) {
    for (let t = 0; t < 4000; t++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * DISK.R * frac;
      const x = Math.round(DISK.cx + Math.cos(a) * r), y = Math.round(DISK.cy + Math.sin(a) * r);
      if (x < 14 || y < 14 || x >= W - 14 || y >= H - 14 || biome[idx(x, y)] !== GRASS) continue;
      let grass = 0, tot = 0;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        if (dx * dx + dy * dy > 144) continue;
        tot++; if (biome[idx(x + dx, y + dy)] === GRASS) grass++;
      }
      // mostly "how much grass around", with a small nudge toward the exact centre
      const score = grass / tot - (r / DISK.R) * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    if (bestScore > 0.85) break;
  }
  return best;
}

function growBlob(sx, sy, n, ok) {
  let start = -1;
  for (let r = 0; r < 6 && start < 0; r++)          // nudge to a valid start tile
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r && start < 0; dx++) {
      if (inb(sx + dx, sy + dy) && ok(idx(sx + dx, sy + dy))) start = idx(sx + dx, sy + dy);
    }
  if (start < 0) return null;
  const tiles = [start], inSet = new Set([start]), front = [start];
  let guard = n * 60;
  while (tiles.length < n && front.length && guard-- > 0) {
    const k = (rng() * front.length) | 0, t = front[k];
    const [dx, dy] = DIRS4[(rng() * 4) | 0];
    const nx = (t % W) + dx, ny = ((t / W) | 0) + dy;
    if (inb(nx, ny)) {
      const ni = idx(nx, ny);
      if (!inSet.has(ni) && ok(ni)) { inSet.add(ni); tiles.push(ni); front.push(ni); continue; }
    }
    if (rng() < 0.2) front.splice(k, 1);
  }
  return tiles;
}

function addDeposit(type, tiles) {
  if (!tiles || tiles.length < 4) return;
  const id = deposits.length;
  let sx = 0, sy = 0;
  for (const t of tiles) { depositOf[t] = id; sx += t % W; sy += (t / W) | 0; }
  deposits.push({ type, tiles, cx: sx / tiles.length, cy: sy / tiles.length });
}

function generateWorld() {
  generateTerrain();
  spawn = chooseSpawn();
  const d2 = i => ((i % W) - spawn.x) ** 2 + (((i / W) | 0) - spawn.y) ** 2;
  const R = CFG.startRadius;

  // starting town: the closest grass tiles to the spawn point
  const near = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const i = idx(spawn.x + dx, spawn.y + dy);
    if (biome[i] === GRASS) near.push({ i, d: dx * dx + dy * dy + hash2(dx, dy, SEED) * 0.5 });
  }
  near.sort((a, b) => a.d - b.d);
  const townTiles = near.slice(0, CFG.startHouses).map(o => o.i);
  const reserved = new Set(townTiles);
  capitalTile = townTiles[0];

  // guaranteed starting forest + stone, fully inside the start circle
  const okStart = i => biome[i] === GRASS && depositOf[i] < 0 && !reserved.has(i) && d2(i) <= (R - 1) ** 2;
  const startDeps = [deposits.length];
  addDeposit('forest', growBlob(spawn.x - 5, spawn.y - 1, 18, okStart));
  startDeps.push(deposits.length);
  addDeposit('stone', growBlob(spawn.x + 5, spawn.y + 2, 12, okStart));

  // scattered deposits; iron only in mountains/desert and never near the start
  const specs = [
    { type: 'forest', ok: b => b === GRASS, count: game.landTiles / 650, min: 14, max: 34, minDist: R + 4 },
    { type: 'stone', ok: b => b === GRASS || b === MOUNTAIN, count: game.landTiles / 1700, min: 8, max: 16, minDist: R + 4 },
    { type: 'iron', ok: b => b === MOUNTAIN || b === DESERT, count: game.landTiles / 1400, min: 8, max: 16, minDist: 40 },
  ];
  for (const sp of specs) {
    let made = 0, tries = 0;
    while (made < sp.count && tries++ < sp.count * 30) {
      const i = (rng() * N) | 0;
      if (!sp.ok(biome[i]) || depositOf[i] >= 0 || d2(i) < sp.minDist ** 2) continue;
      const size = sp.min + ((rng() * (sp.max - sp.min)) | 0);
      const ok = j => sp.ok(biome[j]) && depositOf[j] < 0 && d2(j) > (R + 3) ** 2;
      const before = deposits.length;
      addDeposit(sp.type, growBlob(i % W, (i / W) | 0, size, ok));
      if (deposits.length > before) made++;
    }
  }

  // your home country: claim the start circle, place the start town
  const home = newCountry({ res: { ...CFG.startResources } });
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue;
    const x = spawn.x + dx, y = spawn.y + dy;
    if (inb(x, y) && biome[idx(x, y)] !== OCEAN) claim(idx(x, y), home.id);
  }
  for (const i of townTiles) placeBuilding(i, 'house');
  for (const id of startDeps) {
    const d = deposits[id];
    if (!d) continue;
    const t = d.tiles.reduce((a, b) => (d2(a) <= d2(b) ? a : b));
    if (owner[t]) placeBuilding(t, d.type === 'forest' ? 'cabin' : 'camp');
  }
  recomputeNetwork();
  home.people = Math.min(CFG.startPeople, home.cap);
  game.population = game.peakPop = home.people;
}

// ======================================================================
// territory layers
// ======================================================================
// Two 1-px-per-tile layers: a flat tint for every owned tile, and the border
// pixels. Far out, both are drawn (chunky pixel border, like openfront). Close
// up, only the tint is drawn and the border is stroked as thin lines instead.
// Your countries are blue; a brand-new colony still waiting for houses is orange.
function makeLayer() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // x0..y1: bounding box of pixels changed since the last upload (only that part is re-uploaded)
  return { c, g, img: g.createImageData(W, H), dirty: true, x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
}
function markDirty(L, x, y) {
  if (!L.dirty) { L.dirty = true; L.x0 = L.x1 = x; L.y0 = L.y1 = y; return; }
  if (x < L.x0) L.x0 = x; if (x > L.x1) L.x1 = x;
  if (y < L.y0) L.y0 = y; if (y > L.y1) L.y1 = y;
}
function flushLayer(L) {
  if (!L.dirty) return;
  L.g.putImageData(L.img, 0, 0, L.x0, L.y0, L.x1 - L.x0 + 1, L.y1 - L.y0 + 1);
  L.dirty = false;
}
const fillLayer = makeLayer(), borderLayer = makeLayer();
const PIXEL_BORDER_BELOW = 6;   // zoom where the border switches from pixels to lines
const COL = {
  fill: [47, 125, 225, 72], border: [28, 98, 214, 230],
  cutFill: [255, 159, 67, 64], cutBorder: [232, 128, 40, 235],
};

function paintTerr(i) {
  const o = i * 4, f = fillLayer.img.data, b = borderLayer.img.data;
  const x = i % W, y = (i / W) | 0;
  markDirty(fillLayer, x, y); markDirty(borderLayer, x, y);
  if (!owner[i]) { f[o + 3] = 0; b[o + 3] = 0; return; }
  let border = false;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inb(nx, ny) || !owner[idx(nx, ny)]) { border = true; break; }
  }
  const cut = isCutOff(i);
  const fc = cut ? COL.cutFill : COL.fill, bc = cut ? COL.cutBorder : COL.border;
  f[o] = fc[0]; f[o + 1] = fc[1]; f[o + 2] = fc[2]; f[o + 3] = fc[3];
  if (border) { b[o] = bc[0]; b[o + 1] = bc[1]; b[o + 2] = bc[2]; b[o + 3] = bc[3]; } else b[o + 3] = 0;
}

function claim(i, cid) {
  if (owner[i] || !isLand(i)) return false;
  owner[i] = 1;
  countryOf[i] = cid;
  game.ownedCount++;
  frontier.delete(i);
  paintTerr(i);
  const x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inb(nx, ny)) continue;
    const n = idx(nx, ny);
    if (owner[n]) paintTerr(n);
    else if (isLand(n)) frontier.add(n);
  }
  game.netDirty = true;
  return true;
}

const tileCost = i => CFG.tileCost[BIOME_KEY[biome[i]]];

// ======================================================================
// ======================================================================
// countries: every separate piece of your territory is a country with its own
// name, people and resources. Links move people and cargo between them; when two
// of your countries' borders touch, they merge into one.
// ======================================================================
const comp = new Int32Array(N).fill(-1);        // territory piece id per owned tile
const countryOf = new Int16Array(N).fill(-1);   // which of your countries owns each tile
const NAME_FORMS = ['the Kingdom of {}', 'the {} Republic', 'the Free State of {}', 'the Union of {}',
  'the {} Dominion', 'the Federation of {}', 'the Duchy of {}', 'the {} Commonwealth'];
function countryName(id) {
  const r = mulberry32(Math.floor(hash2(SEED, id + 1, 4242) * 4294967296));
  const short = makeName(r);
  return { short, full: NAME_FORMS[(r() * NAME_FORMS.length) | 0].replace('{}', short) };
}
const newPower = () => ({ burners: 0, solar: 0, need: 0, capPow: 0, workers: 0,
  rigDep: { forest: 0, stone: 0, iron: 0 }, colDep: { forest: 0, stone: 0, iron: 0 } });
// people not working a collector: only they can be sent on pushes and expeditions
const freePeople = c => Math.max(0, c.people - c.pw.workers);
function newCountry({ people = 0, res = {}, supply = 0 } = {}) {
  const id = game.countries.length;
  const c = { id, ...countryName(id), people, cap: 0, growth: 0, supply,
    res: { wood: 0, stone: 0, iron: 0, ...res }, rates: { wood: 0, stone: 0, iron: 0 },
    ownedDep: { forest: 0, stone: 0, iron: 0 }, tiles: 0, lx: 0, ly: 0, alive: true, mergedInto: -1,
    capBase: 0, capPow: 0, sat: 1, pw: newPower(), mw: { gen: 0, max: 0, need: 0, burn: 0 } };
  game.countries.push(c);
  return c;
}
function liveCountry(id) {                       // follows merges to the country that exists now
  let c = game.countries[id];
  while (c && !c.alive && c.mergedInto >= 0) c = game.countries[c.mergedInto];
  return c && c.alive ? c : null;
}
const countryAt = i => (owner[i] ? liveCountry(countryOf[i]) : null);
const activeCountry = () => liveCountry(game.active) || liveCountry(0) || game.countries.find(c => c.alive);
const isCutOff = i => { const c = countryAt(i); return !!c && c.supply > 0; };   // a new colony still waiting for houses

function mergeCountry(from, into) {
  into.people += from.people;
  for (const r in from.res) into.res[r] += from.res[r];
  into.supply = into.supply > 0 && from.supply > 0 ? Math.max(into.supply, from.supply) : 0;
  from.alive = false; from.mergedInto = into.id; from.people = 0;
  if (game.active === from.id) game.active = into.id;
  toast(`${from.short} has merged into ${into.full}`);
}

function recomputeNetwork() {
  // 1) find the separate pieces of territory
  comp.fill(-1);
  let nc = 0;
  const stack = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (!owner[s0] || comp[s0] >= 0) continue;
    comp[s0] = nc; stack.push(s0);
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const n = idx(nx, ny);
        if (owner[n] && comp[n] < 0) { comp[n] = nc; stack.push(n); }
      }
    }
    nc++;
  }
  // 2) each piece is one country: whichever owns most of it. Countries that now share a piece merge.
  const tally = Array.from({ length: nc }, () => new Map());
  for (let i = 0; i < N; i++) {
    if (!owner[i]) continue;
    const c = liveCountry(countryOf[i]), k = c ? c.id : -1, m = tally[comp[i]];
    m.set(k, (m.get(k) || 0) + 1);
  }
  const pieceCountry = new Int32Array(nc);
  for (let pc = 0; pc < nc; pc++) {
    let best = -1, bestN = -1;
    for (const [k, n] of tally[pc]) if (k >= 0 && (n > bestN || (k === 0 && n === bestN))) { best = k; bestN = n; }
    if (best < 0) best = newCountry().id;
    for (const [k] of tally[pc]) if (k >= 0 && k !== best && game.countries[k].alive) mergeCountry(game.countries[k], game.countries[best]);
    pieceCountry[pc] = best;
  }
  // 3) relabel tiles and recount every country
  for (const c of game.countries) { c.capBase = 0; c.tiles = 0; c.sx = 0; c.sy = 0; c.ownedDep = { forest: 0, stone: 0, iron: 0 }; c.pw = newPower(); }
  for (let i = 0; i < N; i++) {
    if (!owner[i]) continue;
    const c = game.countries[pieceCountry[comp[i]]];
    countryOf[i] = c.id; c.tiles++; c.sx += i % W; c.sy += (i / W) | 0;
  }
  for (const c of game.countries) if (c.tiles) { c.lx = c.sx / c.tiles + 0.5; c.ly = c.sy / c.tiles + 0.5; }
  // bounding box per country (for flying the camera to it)
  for (const c of game.countries) c.box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N; i++) {
    if (!owner[i]) continue;
    const b = game.countries[countryOf[i]].box, x = i % W, y = (i / W) | 0;
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  for (const b of game.buildings) {
    const def = CFG.buildings[b.type], c = game.countries[countryOf[b.i]];
    if (def.cap) { c.capBase += def.cap - (def.capPowered || 0); c.pw.capPow += def.capPowered || 0; }
    if (def.use) c.pw.need += def.use;
    if (b.type === 'burner') c.pw.burners++;
    if (b.type === 'solar') c.pw.solar++;
    if (def.workers) c.pw.workers += def.workers;
    if (b.type === 'rig' || def.on) {
      const d = deposits[depositOf[b.i]], into = b.type === 'rig' ? c.pw.rigDep : c.pw.colDep;
      for (const t of d.tiles) if (owner[t] && countryOf[t] === c.id) into[d.type]++;
    }
  }
  for (const c of game.countries) c.cap = c.capBase + c.pw.capPow * c.sat;
  for (const d of deposits) for (const t of d.tiles) if (owner[t]) game.countries[countryOf[t]].ownedDep[d.type]++;
  for (let i = 0; i < N; i++) if (owner[i]) paintTerr(i);
  game.netDirty = false;
  clustersDirty = true;
}

// a link between two of your countries moves people toward the emptier one, and evens out their stockpiles
function linkTransfer(L, A, B, dt) {
  const rate = CFG.linkRates[L.kind];
  const full = c => (c.cap > 0 ? c.people / c.cap : c.people > 0 ? 9 : 1);   // a colony with no houses counts as overfull
  const fa = full(A), fb = full(B);
  if (Math.abs(fa - fb) > 0.05) {
    const [src, dst] = fa > fb ? [A, B] : [B, A];
    const move = Math.min(rate.people * dt, Math.max(0, dst.cap - dst.people), src.people * 0.5);
    if (move > 0) { src.people -= move; dst.people += move; }
  }
  for (const r of ['wood', 'stone', 'iron']) {
    const d = A.res[r] - B.res[r];
    if (Math.abs(d) < 2) continue;
    const amt = Math.min(rate.cargo * dt, Math.abs(d) / 2);
    if (d > 0) { A.res[r] -= amt; B.res[r] += amt; } else { B.res[r] -= amt; A.res[r] += amt; }
  }
}

// which of your countries is closest to a spot (measured to its border)
function nearestCountryTo(tx, ty) {
  let best = -1, bd = Infinity;
  for (const i of frontier) {
    const d = (i % W - tx) ** 2 + (((i / W) | 0) - ty) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) {
    const x = best % W, y = (best / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && owner[idx(nx, ny)]) { const c = countryAt(idx(nx, ny)); if (c) return { country: c, tile: best }; }
    }
  }
  return { country: activeCountry(), tile: best >= 0 ? best : idx(spawn.x, spawn.y) };
}

// ---------- unlocks: your empire's peak population opens up new buildings ----------
const isUnlocked = type => game.peakPop >= (CFG.buildings[type].unlock || 0);
function checkUnlocks(quiet = false) {
  for (const [type, b] of Object.entries(CFG.buildings)) {
    if (game.unlocked.has(type) || !isUnlocked(type)) continue;
    game.unlocked.add(type);
    if (!quiet) toast(`Unlocked: ${b.name}! Your empire reached ${b.unlock} people. Press E to see it.`);
  }
  refreshBuildBar();
  if (menuOpen) renderBuildMenu();
}

// ---------- route finding ----------
const gScore = new Float32Array(N), cameFrom = new Int32Array(N);
const seen = new Int32Array(N), closed = new Int32Array(N);
let stampN = 0;

// cheapest land route from a new station to the nearest existing one (A*, 8 directions)
function railPath(start, targets) {
  const st = ++stampN;
  const tset = new Set(targets);
  const tx = targets.map(t => t % W), ty = targets.map(t => (t / W) | 0);
  const h = i => {
    const x = i % W, y = (i / W) | 0;
    let m = Infinity;
    for (let k = 0; k < tx.length; k++) {
      const dx = Math.abs(x - tx[k]), dy = Math.abs(y - ty[k]);
      const d = Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
      if (d < m) m = d;
    }
    return m;
  };
  const heap = new MinHeap();
  seen[start] = st; gScore[start] = 0; cameFrom[start] = -1;
  heap.push(start, h(start));
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === st) continue;
    closed[cur] = st;
    if (cur !== start && tset.has(cur)) {
      const path = [];
      for (let p = cur; p !== -1; p = cameFrom[p]) path.push(p);
      return { path: path.reverse(), to: cur, weighted: gScore[cur] };
    }
    const g = gScore[cur];
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy, diag] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (!isLand(n) || closed[n] === st) continue;
      if (diag && (!isLand(idx(x + dx, y)) || !isLand(idx(x, y + dy)))) continue;
      const ng = g + CFG.trackWeight[BIOME_KEY[biome[n]]] * (diag ? 1.414 : 1);
      if (ng > CFG.railMaxLength) continue;
      if (seen[n] !== st || ng < gScore[n]) { seen[n] = st; gScore[n] = ng; cameFrom[n] = cur; heap.push(n, ng + h(n)); }
    }
  }
  return null;
}

// shortest sea route from a new port to the nearest existing port (BFS over ocean)
function seaPath(port, targets) {
  const st = ++stampN;
  const oceanNeighbors = t => {
    const out = [], x = t % W, y = (t / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && biome[idx(nx, ny)] === OCEAN) out.push(idx(nx, ny));
    }
    return out;
  };
  const goal = new Map();
  for (const t of targets) for (const n of oceanNeighbors(t)) goal.set(n, t);
  const q = [];
  for (const n of oceanNeighbors(port)) { seen[n] = st; cameFrom[n] = -1; gScore[n] = 1; q.push(n); }
  for (let hd = 0; hd < q.length; hd++) {
    const cur = q[hd];
    if (goal.has(cur)) {
      const path = [];
      for (let p = cur; p !== -1; p = cameFrom[p]) path.push(p);
      return { path: [port, ...path.reverse(), goal.get(cur)], to: goal.get(cur) };
    }
    if (gScore[cur] > CFG.seaMaxLength) continue;
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy, diag] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (biome[n] !== OCEAN || seen[n] === st) continue;
      if (diag && biome[idx(x + dx, y)] !== OCEAN && biome[idx(x, y + dy)] !== OCEAN) continue;
      seen[n] = st; cameFrom[n] = cur; gScore[n] = gScore[cur] + 1; q.push(n);
    }
  }
  return null;
}

// what placing a station/port at tile i would link to (cached while hovering)
let planCache = { key: null, val: null };
function linkPlan(i, type) {
  const key = `${type}:${i}:${game.stations.length}:${game.ports.length}`;
  if (planCache.key === key) return planCache.val;
  let val;
  if (type === 'station') {
    const others = game.stations.filter(t => t !== i && landmass[t] === landmass[i]);
    if (!game.stations.length) val = { note: 'First station: it links up when you build a second one' };
    else if (!others.length) val = { note: 'No other station on this landmass. Use ports to cross water.' };
    else {
      const r = railPath(i, others);
      if (!r) val = { note: `No station within ${CFG.railMaxLength} tiles of track. It will be built unlinked.` };
      else {
        const tc = {};
        for (const [k, v] of Object.entries(CFG.trackCostPerTile)) tc[k] = Math.ceil(v * r.weighted);
        val = { path: r.path, to: r.to, tiles: r.path.length, extra: tc };
      }
    }
  } else {
    const others = game.ports.filter(t => t !== i);
    if (!others.length) val = { note: 'First port: it links up when you build a second one' };
    else {
      const r = seaPath(i, others);
      val = r ? { path: r.path, to: r.to, tiles: r.path.length, extra: null } : { note: 'No sea route to your other ports' };
    }
  }
  planCache = { key, val };
  return val;
}

// ======================================================================
// buildings
// ======================================================================
function isCoastal(i) {
  const x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (inb(nx, ny) && biome[idx(nx, ny)] === OCEAN) return true;
  }
  return false;
}
function canBuild(i, type) {
  if (!isLand(i)) return biome[i] === OCEAN ? "Can't build on water" : biome[i] === ICE ? "Can't build on the ice wall" : "That's outer space";
  if (!owner[i]) return 'Must be inside your territory';
  const def = CFG.buildings[type];
  if (type === 'rig') {
    if (depositOf[i] < 0) return 'Mining rigs go on a resource deposit';
    const have = building[i] ? buildingAt(i).type : null;
    if (have === 'rig') return 'Already a mining rig';
    if (!have) return "Upgrade a logger's cabin or miner's camp: click the one on this deposit";
  } else if (def.on) {
    if (depositOf[i] < 0 || !def.on.includes(deposits[depositOf[i]].type)) return `${def.name}s go on ${def.on.join(' or ')}`;
    if (deposits[depositOf[i]].tiles.some(t => building[t])) return 'Something already works this deposit';
  } else if (depositOf[i] >= 0) return "Can't build on a resource deposit";
  if (building[i]) {
    const have = buildingAt(i).type;
    if (!ladderSteps(type, have)) {
      if (LEVEL[have] && LEVEL[type]) return LEVEL[have] >= LEVEL[type] ? `Already ${/^[AEIOU]/.test(CFG.buildings[have].name) ? 'an' : 'a'} ${CFG.buildings[have].name}` : 'Something is already built here';
      return 'Something is already built here';
    }
  }
  if (type === 'port' && !isCoastal(i)) return 'Ports must be on the coast';
  return null;
}
function planFor(i, type) {
  return (type === 'station' || type === 'port') && !canBuild(i, type) ? linkPlan(i, type) : null;
}
// cost to put `type` on tile i: the ladder steps from whatever is there now, plus any track
function totalCost(type, plan, i = -1) {
  const have = i >= 0 && building[i] ? buildingAt(i).type : null;
  let cost = {};
  for (const t of ladderSteps(type, have) || [type]) cost = addCost(cost, CFG.buildings[t].cost);
  return addCost(cost, plan && plan.extra);
}
function missingFor(cost, C = activeCountry()) {
  for (const [r, n] of Object.entries(cost)) if (!C || C.res[r] < n) return r;
  return null;
}
const empireCap = () => game.countries.reduce((a, c) => a + (c.alive ? c.cap : 0), 0);
function placeBuilding(i, type) {
  const old = buildingAt(i);
  if (old) { old.type = type; building[i] = BLD_CODE[type]; clustersDirty = true; return; }   // upgrade in place
  building[i] = BLD_CODE[type];
  game.buildings.push({ i, type });
  if (type === 'station') game.stations.push(i);
  if (type === 'port') game.ports.push(i);
}
function tryBuild(i, type) {
  if (!isUnlocked(type)) return toast(`${CFG.buildings[type].name} unlocks when your empire reaches ${CFG.buildings[type].unlock} people`);
  const why = canBuild(i, type);
  if (why) return toast(why);
  const C = countryAt(i);                       // every building is paid for by the country it's built in
  const plan = planFor(i, type);
  const cost = totalCost(type, plan, i);
  const miss = missingFor(cost, C);
  if (miss) return toast(`${C.short} doesn't have enough ${miss}`);
  for (const [r, n] of Object.entries(cost)) C.res[r] -= n;
  const before = empireCap();
  placeBuilding(i, type);
  if (plan && plan.path) {
    game.links.push({ kind: type === 'station' ? 'rail' : 'sea', a: i, b: plan.to, path: plan.path, t: 0, dir: 1 });
    floatText(i % W + 0.5, (i / W) | 0, type === 'station' ? `Rail link: ${plan.tiles} tiles` : `Sea route: ${plan.tiles} tiles`, '#7bd389');
  }
  recomputeNetwork();
  const gained = empireCap() - before;
  if (gained > 0) floatText(i % W + 0.5, ((i / W) | 0) - 1, `+${gained} capacity in ${C.short}`, '#7bd389');
}

// ======================================================================
// pushes (left-click) and expeditions (right-click)
// ======================================================================
let pushId = 0;
// people per click come from the country that will do the work
const sendFrom = C => Math.floor((C ? freePeople(C) : 0) * game.sendPct / 100);

function startPush(tx, ty) {
  const b = biome[idx(tx, ty)];
  if (b === OCEAN) return toast("Can't expand into water. Right-click to send a boat expedition.");
  if (b === ICE || b === VOID) return toast('Nothing to claim there: that is the edge of the world.');
  if (!frontier.size) return toast('Nowhere left to expand');
  const { country: src } = nearestCountryTo(tx, ty);
  const n = sendFrom(src);
  if (n < 1) return toast(`${src.short} doesn't have enough people. Wait for them to regrow.`);
  src.people -= n;
  game.pushes.push({ id: pushId++, country: src.id, tx, ty, budget: n, start: n, work: 0, mx: null, my: null, lx: null, ly: null });
}

function stepPush(p, dt) {
  const owner0 = liveCountry(p.country);           // follow merges
  if (!owner0) { p.done = true; return; }
  const cid = p.country = owner0.id;
  p.work += CFG.pushWorkPerSec(p.budget) * dt;
  const grassCost = CFG.tileCost.grass;
  if (p.work < 1) return;
  // The front: this country's frontier tiles within a band of the closest one to the target.
  // Inside the band, pick randomly (preferring tiles already hugged by territory),
  // so the border advances as a wide, slightly ragged front instead of a spike.
  let minD = Infinity;
  const mine = [];
  for (const i of frontier) {
    const x = i % W, y = (i / W) | 0;
    let on = 0, ours = false;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (owner[n]) { on++; const c = liveCountry(countryOf[n]); if (c && c.id === cid) ours = true; }
    }
    if (!ours) continue;
    const d = Math.hypot(x - p.tx, y - p.ty);
    mine.push({ i, d, on });
    if (d < minD) minD = d;
  }
  const band = 4 + Math.sqrt(p.start) * 1.3;
  const cands = [];
  for (const m of mine) if (m.d <= minD + band) cands.push({ i: m.i, s: (m.d - minD) / band * 1.2 - m.on * 0.45 + rng() });
  cands.sort((a, b) => a.s - b.s);
  for (const c of cands) {
    if (owner[c.i]) continue;
    const cost = tileCost(c.i), work = cost / grassCost;
    if (cost > p.budget) continue;
    if (work > p.work) break;
    p.work -= work; p.budget -= cost;
    claim(c.i, cid);
    // marker follows the part of the front closest to the target
    const cx = c.i % W + 0.5, cy = ((c.i / W) | 0) + 0.5;
    if (p.lx == null || Math.hypot(cx - p.tx, cy - p.ty) < Math.hypot(p.lx - p.tx, p.ly - p.ty) + 1.5) { p.lx = cx; p.ly = cy; }
    if (p.work < 1) break;
  }
  const cheapest = cands.length ? Math.min(...cands.slice(0, 40).map(c => tileCost(c.i))) : Infinity;
  if (!cands.length || p.budget < cheapest || p.budget < grassCost) p.done = true;
}

function launchExpedition(tx, ty) {
  const t = idx(tx, ty);
  if (!isLand(t)) return toast('Pick a land tile for the expedition');
  if (owner[t]) return toast('That land is already yours. Left-click to expand instead.');
  const { country: src, tile } = nearestCountryTo(tx, ty);
  const n = sendFrom(src);
  if (n < 2) return toast(`${src.short} doesn't have enough people for an expedition`);
  src.people -= n;
  const kit = {};                                  // supplies to get the colony started, if home can spare them
  for (const [r, k] of Object.entries(CFG.expeditionKit)) { kit[r] = Math.min(k, Math.floor(src.res[r])); src.res[r] -= kit[r]; }
  game.expeditions.push({ x: tile % W + 0.5, y: ((tile / W) | 0) + 0.5, tx: tx + 0.5, ty: ty + 0.5, n, kit, from: src.id });
}

function stepExpedition(e, dt) {
  const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
  const step = CFG.expeditionSpeed * dt;
  if (d <= step) { e.x = e.tx; e.y = e.ty; e.done = true; arrive(e); return; }
  e.x += dx / d * step; e.y += dy / d * step;
}

// an expedition that lands on free land founds a new country (a colony) with its own people and stockpile
function arrive(e) {
  const cx = Math.floor(e.tx), cy = Math.floor(e.ty);
  const there = countryAt(idx(cx, cy));
  if (there) {                                     // your territory got there first: they just join that country
    there.people += e.n;
    for (const r in e.kit) there.res[r] += e.kit[r];
    floatText(e.tx, e.ty, `${e.n} joined ${there.short}`, '#f2c14e');
    return;
  }
  const col = newCountry({ people: e.n, res: e.kit, supply: CFG.outpostSupply });
  const r = CFG.outpostRadius;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r + 1) continue;
    const x = cx + dx, y = cy + dy;
    if (inb(x, y)) claim(idx(x, y), col.id);
  }
  recomputeNetwork();
  const live = liveCountry(col.id);
  if (live !== col) { toast(`The settlers joined ${live.full}`); return; }
  game.outposts.push({ x: e.tx, y: e.ty, country: col.id });
  const kitTxt = Object.entries(e.kit).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
  toast(`Founded ${col.full}! It has its own stockpile (${kitTxt}). Build houses there within ${CFG.outpostSupply}s, or link it home, before the settlers starve.`);
}

function stepOutpost(o) {
  const c = liveCountry(o.country);
  if (!c || c.supply <= 0) o.done = true;         // housed, merged, or the supplies ran out
}

// ======================================================================
// select + copy/paste (left-drag a box over houses, press C to paste at the cursor)
// ======================================================================
const COPYABLE = { house: true, house2: true, house3: true, solar: true, burner: true };   // collectors and rigs belong to one deposit   // stations/ports aren't copied (they'd all try to link)
let blueprint = null;                              // { items: [{dx, dy, type}] } relative to the selection's centre

function finishSelection(ax, ay, bx, by) {
  const [x0, y0] = toWorld(Math.min(ax, bx), Math.min(ay, by));
  const [x1, y1] = toWorld(Math.max(ax, bx), Math.max(ay, by));
  const inBox = b => {
    const x = b.i % W + 0.5, y = ((b.i / W) | 0) + 0.5;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const sel = game.buildings.filter(b => inBox(b) && COPYABLE[b.type]);
  if (!sel.length) { clearSelection(); return toast('No houses in that box'); }
  setTool(null);
  game.selection = sel.map(b => b.i);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const b of sel) {
    const x = b.i % W, y = (b.i / W) | 0;
    mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y);
  }
  const cx = Math.floor((mnx + mxx) / 2), cy = Math.floor((mny + mxy) / 2);
  blueprint = { items: sel.map(b => ({ dx: b.i % W - cx, dy: ((b.i / W) | 0) - cy, type: b.type })) };
  const skipped = game.buildings.filter(b => inBox(b) && !COPYABLE[b.type]).length;
  toast(`Selected ${sel.length} house${sel.length > 1 ? 's' : ''}${skipped ? ` (${skipped} station/port skipped)` : ''}. Move the mouse and press C to paste.`);
}

function clearSelection() { game.selection = []; blueprint = null; }

function pastePlan(tx, ty) {
  const tiles = [];
  let cost = {}, fit = 0;
  for (const it of blueprint.items) {
    const x = tx + it.dx, y = ty + it.dy;
    const ok = inb(x, y) && !canBuild(idx(x, y), it.type);
    tiles.push({ x, y, type: it.type, ok });
    if (ok) { fit++; cost = addCost(cost, totalCost(it.type, null, idx(x, y))); }
  }
  return { tiles, cost, fit };
}

function pasteAt(tx, ty) {
  if (!blueprint) return toast('Select some houses first: hold left click and drag a box over them');
  const plan = pastePlan(tx, ty);
  const before = empireCap();
  let placed = 0, short = null;
  for (const o of plan.tiles) {
    if (!o.ok) continue;
    const C = countryAt(idx(o.x, o.y)), c = totalCost(o.type, null, idx(o.x, o.y)), miss = missingFor(c, C);
    if (miss) { short = miss; break; }
    for (const [r, n] of Object.entries(c)) C.res[r] -= n;
    placeBuilding(idx(o.x, o.y), o.type);
    placed++;
  }
  if (placed) recomputeNetwork();
  const blocked = plan.tiles.length - plan.fit;
  let msg = placed ? `Pasted ${placed} of ${plan.tiles.length}` : 'Nothing pasted';
  if (blocked) msg += ` · ${blocked} blocked (needs your own clear land)`;
  if (short) msg += ` · ran out of ${short}`;
  toast(msg);
  if (placed) {
    const gained = empireCap() - before;
    floatText(tx + 0.5, ty - 1, `+${gained} capacity`, '#7bd389');
  }
}

// ======================================================================
// simulation tick
// ======================================================================
let netTimer = 0;
function tick(dt) {
  game.time += dt;
  netTimer += dt;
  if (game.netDirty && netTimer > 0.25) { recomputeNetwork(); netTimer = 0; }

  // every country produces into its own stockpile and regrows its own people
  let pop = 0;
  for (const c of game.countries) {
    if (!c.alive) continue;
    // power: solar first (free), burners fill the rest and burn wood for it; short power slows every user evenly
    const P = c.pw, B = CFG.buildings, solar = P.solar * B.solar.gen, burnMax = P.burners * B.burner.gen;
    let fromBurn = Math.min(Math.max(0, P.need - solar), burnMax);
    let burn = burnMax ? fromBurn / B.burner.gen * CFG.power.burnerWood : 0;   // wood per second
    if (burn * dt > c.res.wood) { const k = burn ? c.res.wood / (burn * dt) : 0; burn *= k; fromBurn *= k; }
    c.res.wood -= burn * dt;
    c.sat = P.need > 0 ? Math.min(1, (solar + Math.min(fromBurn, P.need)) / P.need) : 1;
    c.mw = { gen: Math.min(P.need, solar + fromBurn), max: solar + burnMax, need: P.need, burn };
    c.cap = c.capBase + P.capPow * c.sat;
    c.staff = P.workers > 0 ? Math.min(1, c.people / P.workers) : 1;   // too few people: collectors slow down
    for (const t of ['forest', 'stone', 'iron']) {
      const r = DEP_RES[t];
      const prod = (P.colDep[t] * c.staff + P.rigDep[t] * CFG.power.rigMult * c.sat) * CFG.prodPerTile[t];
      c.res[r] += prod * dt;
      c.rates[r] = prod - (r === 'wood' ? burn : 0);
    }
    if (c.cap > 0 && c.people < c.cap) {
      c.growth = CFG.growthRate * c.people * (1 - c.people / c.cap) + CFG.growthBase;
      c.people = Math.min(c.cap, c.people + c.growth * dt);
    } else c.growth = 0;
    // a new colony: settled once it can house everyone; if supplies run out first, the extra settlers starve
    if (c.supply > 0) {
      c.supply -= dt;
      if (c.people <= c.cap + 0.01) {
        c.supply = 0; game.netDirty = true;
        floatText(c.lx, c.ly - 2, `${c.short} is settled!`, '#7bd389');
      } else if (c.supply <= 0) {
        const lost = Math.floor(c.people - c.cap);
        c.people = c.cap; c.supply = 0; game.netDirty = true;
        floatText(c.lx, c.ly, `${lost} settlers starved in ${c.short}`, '#ff7a6b');
      }
    }
    pop += c.people;
  }
  game.population = pop;
  if (pop > game.peakPop + 0.5) { game.peakPop = pop; checkUnlocks(); }

  for (const p of game.pushes) stepPush(p, dt);
  for (const p of game.pushes) if (p.done && p.budget > 0) { const c = liveCountry(p.country); if (c) c.people += p.budget; }
  game.pushes = game.pushes.filter(p => !p.done);
  for (const e of game.expeditions) stepExpedition(e, dt);
  game.expeditions = game.expeditions.filter(e => !e.done);
  for (const o of game.outposts) stepOutpost(o);
  game.outposts = game.outposts.filter(o => !o.done);
  for (const L of game.links) {
    const speed = L.kind === 'rail' ? CFG.trainSpeed : CFG.shipSpeed;
    L.t += speed * dt * L.dir;
    const end = L.path.length - 1;
    if (L.t >= end) { L.t = end; L.dir = -1; }
    if (L.t <= 0) { L.t = 0; L.dir = 1; }
    const A = countryAt(L.a), B = countryAt(L.b);
    if (A && B && A !== B) linkTransfer(L, A, B, dt);
  }
  for (const f of game.floats) f.t += dt;
  game.floats = game.floats.filter(f => f.t < 2.4);
}

function floatText(x, y, text, color) { game.floats.push({ x, y, text, color, t: 0 }); }

// ======================================================================
// terrain image
// ======================================================================
const terrainCanvas = document.createElement('canvas');
function paintTerrain() {
  terrainCanvas.width = W; terrainCanvas.height = H;
  const g = terrainCanvas.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  const SHALLOW = [96, 152, 192], DEEP = [55, 108, 158];
  const GR_LO = [166, 199, 122], GR_HI = [182, 194, 132], HILL = [212, 192, 148];
  const DS_A = [231, 210, 152], DS_B = [212, 186, 124];
  const MT_LO = [150, 146, 136], MT_HI = [240, 240, 236];
  const FOREST_A = [78, 126, 60], FOREST_B = [98, 146, 72], STONE = [168, 172, 176], IRON = [156, 98, 74];
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    let c;
    const b = biome[i];
    if (b === VOID) { d[i * 4 + 3] = 0; continue; }   // transparent: space shows through
    if (b === OCEAN) {
      c = mix(SHALLOW, DEEP, clamp(oceanDist[i] / 16, 0, 1));
    } else if (b === GRASS) {
      const h = clamp((elev[i] - seaLevel) / (mtnLevel - seaLevel), 0, 1);
      c = mix(GR_LO, GR_HI, h);
      if (detail[i] > 0.58 && h > 0.3) c = mix(c, HILL, clamp((detail[i] - 0.58) * 3.5, 0, 0.75));
    } else if (b === DESERT) {
      c = mix(DS_A, DS_B, clamp((detail[i] - 0.3) * 1.6, 0, 1));
    } else if (b === ICE) {
      // bright cliff top on the inside, colder blue toward the drop into space, with cracks
      c = mix([248, 251, 253], [150, 178, 206], clamp(iceT[i] * 0.9 + (detail[i] - 0.5) * 0.4, 0, 1));
      if (detail[i] > 0.62) c = mix(c, [190, 212, 232], 0.7);
    } else {
      const h = clamp((elev[i] - mtnLevel) / (maxElev - mtnLevel + 1e-6), 0, 1);
      c = mix(MT_LO, MT_HI, clamp(h * 1.2 + (detail[i] - 0.5) * 0.5, 0, 1));
    }
    const dep = depositOf[i];
    if (dep >= 0) {
      const t = deposits[dep].type;
      if (t === 'forest') c = hash2(x, y, SEED + 1) > 0.5 ? FOREST_A : FOREST_B;
      else if (t === 'stone') c = mix(STONE, [120, 124, 128], hash2(x, y, SEED + 2) * 0.5);
      else c = mix(IRON, [110, 66, 50], hash2(x, y, SEED + 3) * 0.5);
    }
    const j = (hash2(x, y, SEED + 9) - 0.5) * (b === OCEAN ? 4 : 10);
    const o = i * 4;
    d[o] = c[0] + j; d[o + 1] = c[1] + j; d[o + 2] = c[2] + j; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ======================================================================
// camera + rendering
// ======================================================================
const canvas = $('game');
const ctx = canvas.getContext('2d');
let cw = 0, ch = 0, dpr = 1;
// follow: null, or 'moon' to lock the camera onto the moon (its reference frame);
// offX/offY = where you're looking, in the moon's own coordinates; rot = camera rotation (radians)
const cam = { x: 0, y: 0, zoom: CFG.startZoom, follow: null, offX: 0, offY: 0, rot: 0, cos: 1, sin: 0, a0: 0 };
function setCamRot(r) { cam.rot = r; cam.cos = Math.cos(r); cam.sin = Math.sin(r); }
let savedView = null;

function resize() {
  dpr = window.devicePixelRatio || 1;
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
}
// world <-> screen, including camera rotation (only non-zero while locked onto the moon)
const toScreen = (wx, wy) => {
  const dx = (wx - cam.x) * cam.zoom, dy = (wy - cam.y) * cam.zoom;
  return [dx * cam.cos - dy * cam.sin + cw / 2, dx * cam.sin + dy * cam.cos + ch / 2];
};
const toWorld = (sx, sy) => {
  const dx = sx - cw / 2, dy = sy - ch / 2;
  return [(dx * cam.cos + dy * cam.sin) / cam.zoom + cam.x, (-dx * cam.sin + dy * cam.cos) / cam.zoom + cam.y];
};
// draw a 1-px-per-tile world image (terrain, territory) with the camera's pan, zoom and rotation
function drawWorldImage(img) {
  const z = cam.zoom;
  ctx.save();
  ctx.translate(cw / 2, ch / 2); ctx.rotate(cam.rot);
  ctx.drawImage(img, -cam.x * z, -cam.y * z, W * z, H * z);
  ctx.restore();
}
const tileCenter = i => [i % W + 0.5, ((i / W) | 0) + 0.5];
const fitZoom = () => Math.min(cw / W, (ch - 200) / H) * 0.96;

let clusters = [], clustersDirty = true;
function computeClusters() {
  const B = 9, map = new Map();
  for (const b of game.buildings) {
    if (!CFG.buildings[b.type].cap) continue;
    const x = b.i % W, y = (b.i / W) | 0, k = ((x / B) | 0) + ',' + ((y / B) | 0);
    let c = map.get(k);
    if (!c) map.set(k, c = { x: 0, y: 0, n: 0, top: 'house', cut: 0 });
    c.x += x + 0.5; c.y += y + 0.5; c.n++;
    if (LEVEL[b.type] > LEVEL[c.top]) c.top = b.type;
    if (isCutOff(b.i)) c.cut++;
  }
  clusters = [...map.values()].map(c => ({ x: c.x / c.n, y: c.y / c.n, n: c.n, top: c.top, cut: c.cut > 0 }));
  clustersDirty = false;
}

function pill(x, y, text, { bg = 'rgba(20,26,37,0.9)', fg = '#eef2f8', border = null, dot = null, size = 12, bold = 700 } = {}) {
  ctx.font = `${bold} ${size}px 'Segoe UI', Inter, Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + (dot ? 30 : 20), h = size + 10;
  const left = x - w / 2, top = y - h / 2;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke(); }
  if (dot) { ctx.beginPath(); ctx.arc(left + 12, y, 4, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill(); }
  ctx.fillStyle = fg; ctx.textBaseline = 'middle';
  ctx.fillText(text, left + (dot ? 21 : 10), y + 0.5);
  return w;
}

// ---------- outer space ----------
const STAR_TILE = 1024;
const starCanvas = document.createElement('canvas');
let starPattern = null;
function makeStars() {
  const S = STAR_TILE;
  starCanvas.width = starCanvas.height = S;
  const g = starCanvas.getContext('2d');
  g.fillStyle = '#04050b'; g.fillRect(0, 0, S, S);
  const r = mulberry32(SEED + 999);
  // faint nebulae (each drawn 9 times so the tile repeats seamlessly)
  const tints = ['96,64,170', '40,96,180', '150,56,128', '30,120,150'];
  for (let k = 0; k < 6; k++) {
    const x = r() * S, y = r() * S, rad = 140 + r() * 260, tint = tints[k % tints.length], a = 0.07 + r() * 0.08;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(${tint},${a})`); gr.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  // stars: mostly tiny and dim, a few bright ones with a halo
  for (let k = 0; k < 1300; k++) {
    const x = (r() * S) | 0, y = (r() * S) | 0, b = r();
    const warm = r() < 0.15;
    g.fillStyle = warm ? `rgba(255,226,190,${0.3 + b * 0.7})` : `rgba(215,228,255,${0.2 + b * 0.8})`;
    const sz = b > 0.96 ? 2 : 1;
    g.fillRect(x, y, sz, sz);
    if (b > 0.985) {
      const gr = g.createRadialGradient(x + 1, y + 1, 0, x + 1, y + 1, 6);
      gr.addColorStop(0, 'rgba(220,232,255,0.45)'); gr.addColorStop(1, 'rgba(220,232,255,0)');
      g.fillStyle = gr; g.fillRect(x - 6, y - 6, 14, 14);
    }
  }
  starPattern = ctx.createPattern(starCanvas, 'repeat');
}

function drawSpace(z) {
  // stars drift slowly as you pan (parallax), so they feel far away.
  // Locked onto the moon, they hold still: you're standing in the moon's frame,
  // so only your own panning around it moves them.
  const S = STAR_TILE;
  const px = cam.follow ? cam.offX : cam.x, py = cam.follow ? cam.offY : cam.y;
  const ox = (((-px * z * 0.1) % S) + S) % S, oy = (((-py * z * 0.1) % S) + S) % S;
  ctx.save(); ctx.translate(ox, oy);
  ctx.fillStyle = starPattern; ctx.fillRect(-ox, -oy, cw, ch);
  ctx.restore();
  // a soft atmospheric glow hugging the rim of the disk
  const [dx, dy] = toScreen(DISK.cx, DISK.cy), R = DISK.R * z;
  const gr = ctx.createRadialGradient(dx, dy, R * 0.97, dx, dy, R * 1.1);
  gr.addColorStop(0, 'rgba(170,210,255,0.42)'); gr.addColorStop(0.35, 'rgba(120,170,255,0.14)'); gr.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(dx, dy, R * 1.1, 0, Math.PI * 2); ctx.fill();
}

// ---------- the moon ----------
const MOON = {
  r: CFG.moon.radius, size: CFG.moon.radius * 2 + 6,
  orbitR: DISK.R * CFG.moon.orbit, period: CFG.moon.period,
  phase: hash2(SEED, 7, 77) * Math.PI * 2,
};
const moonCanvas = document.createElement('canvas');
// per-pixel moon biome (0 = basalt plains, 1 = highlands, 255 = off the moon), for hover info
const moonBiome = new Uint8Array(MOON.size * MOON.size);
const MOON_BIOME_NAME = ['Basalt plains', 'Highlands'];

// The moon is generated from the same seed as the disk, so a seed always gives the same pair.
// It's built as a height map (biomes + mountains + crater bowls and rims) and then lit from
// the upper left, so ridges, crater walls and rims get real light and shadow.
function paintMoon() {
  const S = MOON.size, c0 = S / 2, R = MOON.r;
  moonCanvas.width = moonCanvas.height = S;
  const g = moonCanvas.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const rnd = mulberry32(SEED + 4242), s = SEED + 300;
  const N2 = S * S;
  const hgt = new Float32Array(N2), high = new Float32Array(N2), bio = new Float32Array(N2);
  const inside = i => moonBiome[i] !== 255;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // 1) biome field. Real maria are lava that filled giant round impact basins, so the plains
  //    collect in a few big basins with ragged edges, plus some looser patches.
  const basins = [];
  for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.75;
    basins.push({ x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: R * (0.18 + rnd() * 0.28) });
  }
  const vals = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) { moonBiome[i] = 255; continue; }
    moonBiome[i] = 0;
    const wx = x + (fbm(x / 40, y / 40, s + 7, 3) - 0.5) * 34;
    const wy = y + (fbm(x / 40, y / 40, s + 8, 3) - 0.5) * 34;
    let basin = 0;
    for (const bs of basins) basin = Math.max(basin, 1 - Math.hypot(wx - bs.x, wy - bs.y) / bs.r);
    bio[i] = fbm(wx / 62, wy / 62, s + 2, 4) * 0.55 - clamp(basin, 0, 1) * 0.45;
    vals.push(bio[i]);
  }
  vals.sort((a, b) => a - b);
  const level = vals[Math.floor(vals.length * CFG.moon.plainsShare)];

  // 2) height: rugged ridges + hills on the highlands, nearly flat plains with faint wrinkles
  for (let i = 0; i < N2; i++) {
    if (!inside(i)) continue;
    const x = i % S, y = (i / S) | 0;
    const h = smooth(level - 0.025, level + 0.035, bio[i]);       // crisp: for colour and biome
    const hh = smooth(level - 0.08, level + 0.16, bio[i]);        // gentle: for height, so basin edges are soft slopes
    high[i] = h;
    moonBiome[i] = h > 0.5 ? 1 : 0;
    const ridge = 1 - Math.abs(2 * fbm(x / 15, y / 15, s + 5, 4) - 1);
    const hills = fbm(x / 7, y / 7, s + 6, 3);
    const wrinkles = 1 - Math.abs(2 * fbm(x / 22, y / 22, s + 9, 3) - 1);
    hgt[i] = hh * (0.05 + 0.1 * ridge * ridge + 0.08 * hills) + (1 - hh) * (0.035 * wrinkles * wrinkles + 0.01 * hills);
  }

  // 3) craters: dense on the old highlands, sparse on the younger plains
  const craters = [];
  for (let tries = 0; craters.length < CFG.moon.craters && tries < CFG.moon.craters * 20; tries++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.97;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist;
    let cr = 1.2 + Math.pow(rnd(), 5) * 28;
    if (moonBiome[(cy | 0) * S + (cx | 0)] === 0) {          // plains are young: few craters, all small
      if (rnd() > 0.18) continue;
      cr = Math.min(cr, 5);
    }
    craters.push({ x: cx, y: cy, r: cr });
  }
  for (const c of craters) {
    const depth = 0.035 + 0.009 * c.r, ext = Math.ceil(c.r * 1.4);
    for (let y = Math.max(0, (c.y | 0) - ext); y <= Math.min(S - 1, (c.y | 0) + ext); y++)
      for (let x = Math.max(0, (c.x | 0) - ext); x <= Math.min(S - 1, (c.x | 0) + ext); x++) {
        const i = y * S + x;
        if (!inside(i)) continue;
        const dd = Math.hypot(x - c.x, y - c.y) / c.r;
        if (dd < 1) {
          hgt[i] = hgt[i] * dd - depth * (1 - dd * dd);                                     // bowl (flattens terrain inside)
          if (c.r > 11 && dd < 0.22) hgt[i] += depth * 0.55 * (1 - dd / 0.22);            // central peak in big craters
        } else if (dd < 1.38) hgt[i] += depth * 0.4 * Math.max(0, 1 - Math.abs(dd - 1.1) / 0.28); // raised rim
      }
  }
  // a few young craters throw bright rays across the surface
  const young = craters.filter(c => c.r > 7).sort(() => rnd() - 0.5).slice(0, 3);

  // 4) light it and colour it
  const PLAINS = [104, 103, 104], HIGH = [198, 196, 191];
  for (let i = 0; i < N2; i++) {
    const o = i * 4;
    if (!inside(i)) { d[o + 3] = 0; continue; }
    const x = i % S, y = (i / S) | 0;
    // slope measured over 2 px for smoother, softer light from the upper left
    const a = (x > 1 && y > 1 && inside(i - 2 * S - 2)) ? hgt[i - 2 * S - 2] : hgt[i];
    const b = (x < S - 2 && y < S - 2 && inside(i + 2 * S + 2)) ? hgt[i + 2 * S + 2] : hgt[i];
    const shade = clamp(1 + (a - b) * 2.3, 0.64, 1.3);
    let col = mix(PLAINS, HIGH, high[i]);
    const fine = fbm(x / 4, y / 4, s + 1, 2);
    col = mix(col, [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9], fine * 0.45);
    col = [col[0] * shade, col[1] * shade, col[2] * shade];
    for (let k = 0; k < young.length; k++) {
      const c = young[k], dx = x - c.x, dy = y - c.y, dist = Math.hypot(dx, dy);
      if (dist < c.r * 1.15 || dist > c.r * 8) continue;
      const ang = Math.atan2(dy, dx);
      const n = vnoise(Math.cos(ang) * 5 + k * 13, Math.sin(ang) * 5, s + 40 + k);   // seamless around the circle
      const streak = Math.pow(clamp((n - 0.55) * 2.6, 0, 1), 2) * (1 - dist / (c.r * 8));
      col = mix(col, [228, 227, 224], streak * 0.6);
    }
    const dist = Math.hypot(x + 0.5 - c0, y + 0.5 - c0);
    col = mix(col, [0, 0, 0], 0.25 * Math.pow(dist / R, 4));   // darker toward the edge
    const j = (hash2(x, y, s + 3) - 0.5) * 7;
    d[o] = clamp(col[0] + j, 0, 255); d[o + 1] = clamp(col[1] + j, 0, 255); d[o + 2] = clamp(col[2] + j, 0, 255); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ---------- the sun ----------
const SUN = {
  r: DISK.R * CFG.sun.radius, dist: MOON.orbitR * CFG.sun.distance, year: CFG.sun.year,
  phase: hash2(SEED, 9, 99) * Math.PI * 2,
};
const sunCanvas = document.createElement('canvas');

function paintSun() {
  const S = 256, c0 = S / 2, R = S / 2 - 2;
  sunCanvas.width = sunCanvas.height = S;
  const g = sunCanvas.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const rnd = mulberry32(SEED + 777), s = SEED + 900;
  const spots = [];
  for (let k = 0; k < 5; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.7;
    spots.push({ x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: 2 + rnd() * 5 });
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4, dist = Math.hypot(x + 0.5 - c0, y + 0.5 - c0);
    if (dist > R) { d[o + 3] = 0; continue; }
    const t = dist / R, limb = Math.sqrt(1 - t * t);              // bright centre, deep orange edge
    let col = mix([255, 140, 40], [255, 247, 220], Math.pow(limb, 0.55));
    const k = 0.9 + (fbm(x / 3, y / 3, s, 3) - 0.5) * 0.32;     // granulation: boiling surface cells
    col = [col[0] * k, col[1] * k, col[2] * k];
    for (const sp of spots) {                                    // sunspots
      const dd = Math.hypot(x - sp.x, y - sp.y) / sp.r;
      if (dd < 1) col = mix(col, [110, 45, 18], 0.8 * (1 - dd * dd));
      else if (dd < 1.7) col = mix(col, [205, 110, 40], 0.35 * (1 - (dd - 1) / 0.7));
    }
    d[o] = clamp(col[0], 0, 255); d[o + 1] = clamp(col[1], 0, 255); d[o + 2] = clamp(col[2], 0, 255); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// The world is centred on the disk, so the sun sits opposite the disk's position on its orbit.
function sunPos() {
  const a = SUN.phase + (game.time / SUN.year) * Math.PI * 2;
  return [DISK.cx - Math.cos(a) * SUN.dist, DISK.cy - Math.sin(a) * SUN.dist, a];
}
function overSun(wx, wy) {
  const [sx, sy] = sunPos();
  return Math.hypot(wx - sx, wy - sy) < Math.max(SUN.r, 24 / cam.zoom);
}

// ---------- Vulcan: a lava hellscape between the sun and your world ----------
const VULCAN = {
  r: DISK.R * CFG.vulcan.size, tex: 2,      // tex: tiles per texture pixel (keeps generation fast)
  orbit: SUN.dist * CFG.vulcan.orbit, year: CFG.vulcan.year, spinPeriod: CFG.vulcan.spin,
  phase: hash2(SEED, 11, 111) * Math.PI * 2,
};
VULCAN.texR = VULCAN.r / VULCAN.tex;
VULCAN.size = Math.ceil(VULCAN.texR * 2) + 6;
const vulcanCanvas = document.createElement('canvas');
const vulcanGlow = document.createElement('canvas');     // lava light, drawn on top so it glows on the night side
const vulcanBiome = new Uint8Array(VULCAN.size * VULCAN.size);
const VB = { LAVA: 0, OBSIDIAN: 1, ASH: 2, SULFUR: 3, METAL: 4, VOLCANO: 5 };
const VULCAN_BIOME_NAME = ['Lava sea', 'Obsidian plains', 'Ash wastes', 'Sulfur flats', 'Heavy-metal ridges', 'Volcano'];

function paintVulcan() {
  const S = VULCAN.size, c0 = S / 2, R = VULCAN.texR, N2 = S * S;
  vulcanCanvas.width = vulcanCanvas.height = S;
  vulcanGlow.width = vulcanGlow.height = S;
  const g = vulcanCanvas.getContext('2d'), gg = vulcanGlow.getContext('2d');
  const img = g.createImageData(S, S), d = img.data, gimg = gg.createImageData(S, S), gd = gimg.data;
  const rnd = mulberry32(SEED + 5151), s = SEED + 1300;

  // volcanoes: big cones scattered across the surface
  const volc = [];
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.85;
    volc.push({ x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: R * (0.06 + rnd() * 0.09) });
  }

  // 1) height (warped noise + volcano cones) and distance to the nearest volcano
  const hgt = new Float32Array(N2), near = new Float32Array(N2).fill(99), nearAng = new Float32Array(N2), nearK = new Uint8Array(N2);
  const vals = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) { vulcanBiome[i] = 255; continue; }
    vulcanBiome[i] = 0;
    const wx = x + (fbm(x / 30, y / 30, s + 1, 3) - 0.5) * 24, wy = y + (fbm(x / 30, y / 30, s + 2, 3) - 0.5) * 24;
    let h = fbm(wx / 45, wy / 45, s, 5), cone = 0;
    for (let k = 0; k < volc.length; k++) {
      const v = volc[k], dx = x - v.x, dy = y - v.y, dd = Math.hypot(dx, dy) / v.r;
      if (dd < near[i]) { near[i] = dd; nearAng[i] = Math.atan2(dy, dx); nearK[i] = k; }
      if (dd < 2.2) cone = Math.max(cone, Math.pow(1 - dd / 2.2, 1.6));
    }
    h += cone * 0.45;
    hgt[i] = h;
    vals.push(h);
  }
  vals.sort((a, b) => a - b);
  const lavaLevel = vals[Math.floor(vals.length * CFG.vulcan.lavaShare)];
  const H = i => (vulcanBiome[i] === 255 ? null : hgt[i]);

  // 2) biomes, colour, and the glow layer
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4;
    if (vulcanBiome[i] === 255) { d[o + 3] = 0; gd[o + 3] = 0; continue; }
    const h = hgt[i], nd = near[i];
    const ridge = 1 - Math.abs(2 * fbm(x / 12, y / 12, s + 5, 4) - 1);
    const sulf = fbm(x / 22, y / 22, s + 6, 3), ash = fbm(x / 40, y / 40, s + 7, 3);
    const fine = fbm(x / 3, y / 3, s + 3, 2);
    let b;
    if (nd < 0.2) b = VB.VOLCANO;                                   // caldera
    else if (h < lavaLevel) b = VB.LAVA;
    else if (nd < 1.1) b = VB.VOLCANO;                              // volcano slopes
    else if (sulf > 0.7 || (nd < 2.4 && sulf > 0.57)) b = VB.SULFUR;
    else if (ridge > 0.86 && h > lavaLevel + 0.06) b = VB.METAL;
    else if (ash > 0.5) b = VB.ASH;
    else b = VB.OBSIDIAN;
    vulcanBiome[i] = b;

    // baked relief, lit from the upper left
    const ha = (x > 0 && y > 0 && H(i - S - 1) !== null) ? hgt[i - S - 1] : h;
    const hb = (x < S - 1 && y < S - 1 && H(i + S + 1) !== null) ? hgt[i + S + 1] : h;
    const shade = clamp(1 + (ha - hb) * 5, 0.55, 1.45);
    const lit = c => [c[0] * shade, c[1] * shade, c[2] * shade];

    let col, glow = 0;
    if (b === VB.LAVA) {
      const plate = fbm(x / 10, y / 10, s + 8, 3);
      const crack = Math.abs(fbm(x / 7, y / 7, s + 9, 3) - 0.5) < 0.03;
      const molten = clamp((lavaLevel - h) * 12, 0, 1);              // deeper = more open melt
      if (crack) { col = [255, 196, 84]; glow = 1; }                 // glowing crack between plates
      else if (plate > 0.47 - molten * 0.3) { col = mix([46, 22, 18], [76, 34, 24], fine * 0.6); glow = 0.05; }   // cooled crust plate
      else { col = mix([248, 118, 30], [196, 50, 16], plate); glow = 0.72; }                                    // open melt
    } else if (b === VB.VOLCANO) {
      if (nd < 0.2) { col = [255, 192, 72]; glow = 1; }             // glowing caldera
      else {
        col = lit(mix([48, 38, 36], [72, 56, 50], fine * 0.7));
        if (nd < 0.3) col = lit([92, 70, 60]);                       // crater rim
        // lava flows: meander as they run downhill, and get thinner further from the crater
        const wob = (fbm(x / 9, y / 9, s + 21, 2) - 0.5) * 1.4 * nd;
        const ang = nearAng[i] + wob;
        const flow = vnoise(Math.cos(ang) * 9 + nearK[i] * 17, Math.sin(ang) * 9, s + 20);
        const thr = 0.72 + nd * 0.14;
        if (flow > thr && nd < 1.0) {
          const t = clamp((flow - thr) * 9, 0, 1);
          col = mix(col, [245, 108, 28], t); glow = t * (1 - nd * 0.7);
        }
      }
    } else if (b === VB.SULFUR) {
      const sv = fbm(x / 9, y / 9, s + 15, 3);
      col = sv > 0.5 ? mix([230, 206, 70], [242, 232, 150], (sv - 0.5) * 2) : mix([206, 150, 46], [230, 206, 70], sv * 2);
      if (nd < 2.4) col = mix(col, [172, 192, 72], clamp((2.4 - nd) * 0.2, 0, 0.4));   // greener near the vents
      if (hash2(x, y, s + 11) > 0.985) col = [252, 248, 214];                            // crystals
      col = lit(col);
    } else if (b === VB.METAL) {
      col = mix([132, 68, 44], [80, 58, 52], fine * 0.7);
      if (hash2(x, y, s + 12) > 0.93) col = [214, 216, 226];                             // heavy-metal glints
      col = lit(col);
    } else if (b === VB.ASH) {
      col = lit(mix([124, 116, 110], [98, 92, 88], fine * 0.7));
    } else {
      col = mix([34, 30, 36], [50, 44, 52], fine * 0.7);
      if (Math.abs(fbm(x / 18, y / 18, s + 13, 3) - 0.5) < 0.012) { col = [235, 90, 30]; glow = 0.8; }   // glowing fissure
      else {
        col = lit(col);
        if (shade > 1.25 && hash2(x, y, s + 14) > 0.8) col = mix(col, [150, 150, 172], 0.5);            // glassy glints
      }
    }
    const t = Math.hypot(x + 0.5 - c0, y + 0.5 - c0) / R;
    const limb = 1 - 0.25 * Math.pow(t, 4);
    d[o] = clamp(col[0] * limb, 0, 255); d[o + 1] = clamp(col[1] * limb, 0, 255); d[o + 2] = clamp(col[2] * limb, 0, 255); d[o + 3] = 255;
    if (glow > 0.05) { gd[o] = 255; gd[o + 1] = 110 + 70 * glow; gd[o + 2] = 30; gd[o + 3] = clamp(glow * 200, 0, 255); }
    else gd[o + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  gg.putImageData(gimg, 0, 0);
}

// Vulcan orbits the sun; it also spins on its own axis
function vulcanPos() {
  const [sx, sy] = sunPos();
  const b = VULCAN.phase + (game.time / VULCAN.year) * Math.PI * 2;
  return [sx + Math.cos(b) * VULCAN.orbit, sy + Math.sin(b) * VULCAN.orbit, (game.time / VULCAN.spinPeriod) * Math.PI * 2];
}
function overVulcan(wx, wy) {
  const [vx, vy] = vulcanPos();
  return Math.hypot(wx - vx, wy - vy) < Math.max(VULCAN.r, 24 / cam.zoom);
}
function vulcanBiomeAt(wx, wy) {
  const [vx, vy, spin] = vulcanPos();
  const dx = wx - vx, dy = wy - vy, c = Math.cos(-spin), sn = Math.sin(-spin);
  const lx = Math.floor((dx * c - dy * sn) / VULCAN.tex + VULCAN.size / 2);
  const ly = Math.floor((dx * sn + dy * c) / VULCAN.tex + VULCAN.size / 2);
  if (lx < 0 || ly < 0 || lx >= VULCAN.size || ly >= VULCAN.size) return null;
  const b = vulcanBiome[ly * VULCAN.size + lx];
  return b === 255 ? null : VULCAN_BIOME_NAME[b];
}

function drawVulcan(z) {
  const [vx, vy, spin] = vulcanPos();
  const [sx, sy] = toScreen(vx, vy), rr = VULCAN.r * z;
  // its orbit around the sun (faint red dashed ring) when zoomed far out
  if (z < 0.01) {
    const [cx, cy] = toScreen(...sunPos().slice(0, 2));
    ctx.setLineDash([4, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,120,80,0.22)';
    ctx.beginPath(); ctx.arc(cx, cy, VULCAN.orbit * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const haloR = Math.max(rr * 1.2, 18);
  if (sx + haloR < 0 || sy + haloR < 0 || sx - haloR > cw || sy - haloR > ch) return;
  // hot, hazy atmosphere glow
  const gl = ctx.createRadialGradient(sx, sy, Math.max(rr * 0.95, 2), sx, sy, haloR);
  gl.addColorStop(0, 'rgba(255,110,50,0.38)'); gl.addColorStop(1, 'rgba(255,110,50,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, haloR, 0, Math.PI * 2); ctx.fill();
  if (rr < 5) {
    ctx.fillStyle = '#d9653a'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(rr, 3.5), 0, Math.PI * 2); ctx.fill();
    pill(sx, sy + 22, 'Vulcan', { fg: '#ffb08a', size: 12 });
    return;
  }
  const scale = VULCAN.tex * z, half = VULCAN.size / 2 * scale;
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
  ctx.imageSmoothingEnabled = scale < 1.5;
  ctx.drawImage(vulcanCanvas, -half, -half, half * 2, half * 2);
  ctx.restore();
  // day/night from the sun's direction
  const [ssx, ssy] = toScreen(...sunPos().slice(0, 2));
  let ldx = ssx - sx, ldy = ssy - sy;
  const ll = Math.hypot(ldx, ldy) || 1; ldx /= ll; ldy /= ll;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.clip();
  const lg = ctx.createLinearGradient(sx + ldx * rr, sy + ldy * rr, sx - ldx * rr * 1.4, sy - ldy * rr * 1.4);
  lg.addColorStop(0, 'rgba(0,0,12,0)'); lg.addColorStop(0.45, 'rgba(0,0,12,0.15)'); lg.addColorStop(0.75, 'rgba(0,0,12,0.6)'); lg.addColorStop(1, 'rgba(0,0,12,0.88)');
  ctx.fillStyle = lg; ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  ctx.restore();
  // lava light on top, so the lava still glows on the night side
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85;
  ctx.imageSmoothingEnabled = scale < 1.5;
  ctx.drawImage(vulcanGlow, -half, -half, half * 2, half * 2);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  if (rr < 160) pill(sx, sy + rr + 22, 'Vulcan', { fg: '#ffb08a', size: 12 });
}

// your world can be clicked to lock on when it's small on screen, or while you're locked onto
// the moon or the sun (up close, clicks on your land still push your border)
const WORLD_LOCK_ZOOM = 0.15;
function worldLockable() { return !!cam.follow || cam.zoom < WORLD_LOCK_ZOOM; }
function overWorld(wx, wy) {
  return Math.hypot(wx - DISK.cx, wy - DISK.cy) < Math.max(DISK.R, 24 / cam.zoom);
}

function drawSun(z) {
  const [wx, wy] = sunPos();
  const [sx, sy] = toScreen(wx, wy), rr = SUN.r * z;
  // your world's orbit around the sun (faint dashed ring), when zoomed far enough out to matter
  if (z < 0.03) {
    ctx.setLineDash([4, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,205,130,0.22)';
    ctx.beginPath(); ctx.arc(sx, sy, SUN.dist * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const glowR = Math.max(rr * 3.2, 28);
  if (sx + glowR < 0 || sy + glowR < 0 || sx - glowR > cw || sy - glowR > ch) return;
  // corona glow (additive, so it brightens the stars behind it)
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const gl = ctx.createRadialGradient(sx, sy, Math.max(rr * 0.9, 2), sx, sy, glowR);
  gl.addColorStop(0, 'rgba(255,190,90,0.6)'); gl.addColorStop(0.3, 'rgba(255,150,60,0.2)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, glowR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (rr < 4) {
    ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(game.time / 200);   // slow spin
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sunCanvas, -rr * 128 / 126, -rr * 128 / 126, rr * 256 / 126, rr * 256 / 126);
    ctx.restore();
  }
  if (rr < 160) pill(sx, sy + Math.max(rr, 4) + 24, 'The Sun', { fg: '#ffe2a8', size: 12 });
}

// which moon biome is under a world point (null if none)
function moonBiomeAt(wx, wy) {
  const [mx, my, a] = moonPos();
  const dx = wx - mx, dy = wy - my, c = Math.cos(-a), sn = Math.sin(-a);
  const lx = Math.floor(dx * c - dy * sn + MOON.size / 2), ly = Math.floor(dx * sn + dy * c + MOON.size / 2);
  if (lx < 0 || ly < 0 || lx >= MOON.size || ly >= MOON.size) return null;
  const b = moonBiome[ly * MOON.size + lx];
  return b === 255 ? null : MOON_BIOME_NAME[b];
}

function moonPos() {
  const a = MOON.phase + (game.time / MOON.period) * Math.PI * 2;
  return [DISK.cx + Math.cos(a) * MOON.orbitR, DISK.cy + Math.sin(a) * MOON.orbitR, a];
}

function drawMoon(z) {
  if (MOON.orbitR * z < 6) return;   // from far out it would just sit on top of your world
  const [mx, my, a] = moonPos();
  const [sx, sy] = toScreen(mx, my), rr = MOON.r * z;
  // faint orbit line when zoomed out
  if (z < 1.6) {
    const [cx, cy] = toScreen(DISK.cx, DISK.cy);
    ctx.setLineDash([3, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(200,215,255,0.2)';
    ctx.beginPath(); ctx.arc(cx, cy, MOON.orbitR * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (sx + rr * 1.2 < 0 || sy + rr * 1.2 < 0 || sx - rr * 1.2 > cw || sy - rr * 1.2 > ch) return;
  if (rr < 5) {
    // so far out the moon is just a speck: draw a small glowing dot so it can still be found
    const gd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12);
    gd.addColorStop(0, 'rgba(225,230,240,0.5)'); gd.addColorStop(1, 'rgba(225,230,240,0)');
    ctx.fillStyle = gd; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9ccd4'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(rr, 3.5), 0, Math.PI * 2); ctx.fill();
    if (z > 0.006) pill(sx, sy + 22, 'The Moon', { fg: '#dfe4ee', size: 12 });
    return;
  }
  // soft glow
  const gl = ctx.createRadialGradient(sx, sy, rr * 0.95, sx, sy, rr * 1.18);
  gl.addColorStop(0, 'rgba(225,230,240,0.28)'); gl.addColorStop(1, 'rgba(225,230,240,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, rr * 1.18, 0, Math.PI * 2); ctx.fill();
  // body: tidally locked, so it turns as it orbits and the same face always points at the disk
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(a + cam.rot);   // while locked on, cam.rot cancels the spin exactly
  ctx.imageSmoothingEnabled = z < 1.5;
  ctx.drawImage(moonCanvas, -MOON.size / 2 * z, -MOON.size / 2 * z, MOON.size * z, MOON.size * z);
  ctx.restore();
  // sunlight comes from the actual sun, so the day/night shadow swings round as the moon orbits (phases)
  const [ssx, ssy] = toScreen(...sunPos().slice(0, 2));
  let ldx = ssx - sx, ldy = ssy - sy;
  const ll = Math.hypot(ldx, ldy) || 1; ldx /= ll; ldy /= ll;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.clip();
  const lg = ctx.createLinearGradient(sx + ldx * rr, sy + ldy * rr, sx - ldx * rr * 1.4, sy - ldy * rr * 1.4);
  lg.addColorStop(0, 'rgba(0,0,12,0)'); lg.addColorStop(0.45, 'rgba(0,0,12,0.12)'); lg.addColorStop(0.75, 'rgba(0,0,12,0.5)'); lg.addColorStop(1, 'rgba(0,0,12,0.82)');
  ctx.fillStyle = lg; ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  if (z < 2.5) pill(sx, sy + Math.max(rr, 4) + 18, 'The Moon', { fg: '#dfe4ee', size: 12 });
}

// when the disk is only a few pixels wide, label it so you can find home
function drawDiskLabel(z) {
  if (z > 0.15) return;
  const [dx, dy] = toScreen(DISK.cx, DISK.cy);
  if (DISK.R * z < 3) { ctx.fillStyle = '#6fa3d6'; ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2); ctx.fill(); }
  pill(dx, dy + Math.max(DISK.R * z, 4) + 18, 'Your world', { fg: '#cfe0ff', size: 12 });
}

function overMoon(wx, wy) {
  const [mx, my] = moonPos();
  // at least ~24 px to aim at, so the tiny dot is still easy to click from far out
  return Math.hypot(wx - mx, wy - my) < Math.max(MOON.r, 24 / cam.zoom);
}

// ======================================================================
// the wider solar system: Aries, Zeus, Poseidon and their moons.
// Every body here shares one recipe: an orbit around a parent, a spin, a seeded texture,
// sunlight from the real sun, an optional glow layer (lava), optional rings, hover + lock-on.
// ======================================================================
const BODY = {};
const kepler = orbit => SUN.year * Math.pow(orbit, 1.5);
function makeBody(def) {
  const b = { label: '#e8ecf4', ring: '200,215,255', dot: '#c9ccd4', halo: '220,225,235', ...def };
  b.texR = b.r / b.tex;
  b.size = Math.ceil(b.texR * 2) + 6;
  b.phase = hash2(SEED, b.seedOff, 7) * Math.PI * 2;
  if (b.rings) {                                         // fine ringlets: varying density, with clear gaps
    const rr = mulberry32(SEED + b.seedOff * 31), R = b.rings, n = 46, step = (R.outer - R.inner) / n;
    b.ringlets = [];
    for (let k = 0; k < n; k++) {
      const a1 = R.inner + k * step, a2 = a1 + step * 0.92, mid = (a1 + a2) / 2;
      if (R.gaps.some(([g1, g2]) => mid > g1 && mid < g2)) continue;
      const edge = Math.min(mid - R.inner, R.outer - mid) / (R.outer - R.inner);   // fade at the inner and outer edges
      b.ringlets.push([a1, a2, (0.12 + rr() * 0.38) * Math.min(1, edge * 6), 170 + rr() * 50]);
    }
  }
  BODY[b.id] = b;
  return b;
}
// position = parent position + orbit; spin = own rotation (tidally locked moons turn with their orbit)
function genericPos(b) {
  const [px, py] = b.parent === 'sun' ? sunPos() : genericPos(BODY[b.parent]);
  const a = b.phase + (game.time / b.period) * Math.PI * 2;
  const spin = b.spin === 'locked' ? a : (game.time / b.spin) * Math.PI * 2;
  return [px + Math.cos(a) * b.orbit, py + Math.sin(a) * b.orbit, spin];
}
function genericBiomeAt(b, wx, wy) {
  const [bx, by, spin] = genericPos(b);
  const dx = wx - bx, dy = wy - by, c = Math.cos(-spin), sn = Math.sin(-spin);
  const lx = Math.floor((dx * c - dy * sn) / b.tex + b.size / 2), ly = Math.floor((dx * sn + dy * c) / b.tex + b.size / 2);
  if (lx < 0 || ly < 0 || lx >= b.size || ly >= b.size) return null;
  const v = b.biome[ly * b.size + lx];
  return v === 255 ? null : b.biomes[v];
}

// shared texture painter: calls fn(x, y, u, v, out, i) per pixel; out = [r, g, b, biome, glow]
function paintBody(b, fn, limbK = 0.25) {
  const S = b.size, c0 = S / 2, R = b.texR;
  b.canvas = document.createElement('canvas'); b.canvas.width = b.canvas.height = S;
  const g = b.canvas.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  b.biome = new Uint8Array(S * S).fill(255);
  let gimg = null;
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4, t = Math.hypot(x + 0.5 - c0, y + 0.5 - c0) / R;
    if (t > 1) { d[o + 3] = 0; continue; }
    out[3] = 0; out[4] = 0;
    fn(x, y, (x + 0.5 - c0) / R, (y + 0.5 - c0) / R, out, i);
    const limb = 1 - limbK * Math.pow(t, 4);
    d[o] = clamp(out[0] * limb, 0, 255); d[o + 1] = clamp(out[1] * limb, 0, 255); d[o + 2] = clamp(out[2] * limb, 0, 255); d[o + 3] = 255;
    b.biome[i] = out[3];
    if (out[4] > 0.05) {
      if (!gimg) gimg = new ImageData(S, S);
      gimg.data[o] = 255; gimg.data[o + 1] = 110 + 70 * out[4]; gimg.data[o + 2] = 30; gimg.data[o + 3] = clamp(out[4] * 210, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
  if (gimg) {
    b.glow = document.createElement('canvas'); b.glow.width = b.glow.height = S;
    b.glow.getContext('2d').putImageData(gimg, 0, 0);
  }
}

// ---------- Aries: the red planet ----------
function paintAries(b) {
  const S = b.size, c0 = S / 2, R = b.texR, rnd = mulberry32(SEED + 6161), s = SEED + 1600;
  // one giant shield volcano and a few smaller ones
  const vol = [{ x: c0 + (rnd() - 0.5) * R * 0.9, y: c0 + (rnd() - 0.5) * R * 0.5, r: R * 0.17 }];
  for (let k = 0; k < 3; k++) vol.push({ x: c0 + (rnd() - 0.5) * R * 1.1, y: c0 + (rnd() - 0.5) * R * 0.9, r: R * (0.05 + rnd() * 0.04) });
  // a huge canyon rift
  const ca = (rnd() - 0.5) * 0.6, dir = [Math.cos(ca), Math.sin(ca)], perp = [-dir[1], dir[0]];
  const p0 = [c0 + (rnd() - 0.5) * R * 0.3, c0 + (rnd() - 0.2) * R * 0.35], half = R * 0.6, cw0 = R * 0.045;
  const hgt = new Float32Array(S * S), zone = new Uint8Array(S * S);   // zone: 1 canyon, 2 volcano, 3 caldera
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) continue;
    let h = fbm(x / 26, y / 26, s, 5) * 0.55;
    for (const v of vol) {
      const dd = Math.hypot(x - v.x, y - v.y) / v.r;
      if (dd < 1.6) {
        h += 0.7 * Math.pow(1 - dd / 1.6, 1.4) * (v.r / (R * 0.17));
        if (dd < 1.05) zone[i] = 2;
        if (dd < 0.14) { zone[i] = 3; h -= 0.12; }
      }
    }
    const qx = x - p0[0], qy = y - p0[1], along = qx * dir[0] + qy * dir[1];
    const across = qx * perp[0] + qy * perp[1] + (fbm(along / 14, 3.3, s + 4, 2) - 0.5) * R * 0.08;
    if (Math.abs(along) < half) {
      const w = cw0 * (1 - Math.pow(along / half, 2) * 0.7);
      if (Math.abs(across) < w) { h -= 0.28 * (1 - Math.abs(across) / w); zone[i] = 1; }
    }
    hgt[i] = h;
  }
  for (let k = 0; k < 70; k++) {                       // craters
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.95;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist, cr = 1.5 + Math.pow(rnd(), 4) * 14, dep = 0.03 + 0.008 * cr;
    for (let y = Math.max(0, (cy - cr * 1.4) | 0); y <= Math.min(S - 1, (cy + cr * 1.4) | 0); y++)
      for (let x = Math.max(0, (cx - cr * 1.4) | 0); x <= Math.min(S - 1, (cx + cr * 1.4) | 0); x++) {
        const i = y * S + x;
        if (zone[i] >= 2) continue;
        const dd = Math.hypot(x - cx, y - cy) / cr;
        if (dd < 1) hgt[i] -= dep * (1 - dd * dd);
        else if (dd < 1.35) hgt[i] += dep * 0.4 * (1 - Math.abs(dd - 1.1) / 0.25);
      }
  }
  paintBody(b, (x, y, u, v, out, i) => {
    const h = hgt[i], z = zone[i];
    const ha = (x > 1 && y > 1) ? hgt[i - 2 * S - 2] : h, hb = (x < S - 2 && y < S - 2) ? hgt[i + 2 * S + 2] : h;
    const shade = clamp(1 + (ha - hb) * 2.8, 0.6, 1.4);
    const fine = fbm(x / 4, y / 4, s + 9, 2), dark = fbm(x / 48, y / 48, s + 2, 4);
    const cap = Math.abs(v) > 0.83 + (fbm(x / 10, y / 10, s + 3, 2) - 0.5) * 0.14;
    let col, bio;
    if (cap) { col = mix([244, 240, 236], [222, 200, 186], fine * 0.6); bio = 2; }
    else if (z === 3) { col = [96, 54, 42]; bio = 4; }
    else if (z === 2) { col = mix([186, 104, 70], [160, 88, 60], fine); bio = 4; }
    else if (z === 1) { col = mix([126, 64, 46], [96, 50, 38], fine); bio = 3; }
    else if (dark > 0.6) { col = mix([108, 62, 46], [86, 50, 40], fine); bio = 1; }
    else if (h > 0.33) { col = mix([214, 140, 94], [196, 122, 80], fine); bio = 5; }
    else { col = mix([202, 110, 66], [176, 90, 56], fine); bio = 0; }
    if (!cap) col = [col[0] * shade, col[1] * shade, col[2] * shade];
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}

// ---------- gas giants: banded clouds, a great storm, white ovals ----------
const ZEUS_STYLE = {
  palette: [[238, 226, 200], [210, 176, 132], [182, 116, 74], [228, 208, 170], [166, 98, 64], [240, 232, 214], [196, 150, 106], [150, 90, 62]],
  bands: 15, turb: 1.0, storm: { u: 0.25, v: 0.32, rx: 0.22, ry: 0.11, col: [196, 84, 56] }, ovals: [240, 236, 226],
};
const POSEIDON_STYLE = {
  palette: [[44, 86, 176], [72, 132, 212], [58, 150, 172], [146, 196, 226], [32, 60, 140], [90, 160, 220]],
  bands: 11, turb: 0.7, storm: { u: -0.3, v: -0.25, rx: 0.17, ry: 0.1, col: [22, 34, 92] }, ovals: [226, 240, 250],
};
function paintGasGiant(b, st) {
  const s = SEED + 1700 + b.seedOff * 13, rnd = mulberry32(s);
  const order = Array.from({ length: st.bands }, () => st.palette[(rnd() * st.palette.length) | 0]);
  const ovals = Array.from({ length: 6 }, () => ({ u: rnd() * 1.6 - 0.8, v: rnd() * 1.6 - 0.8, r: 0.025 + rnd() * 0.03 }));
  const nb = st.bands, wrap = k => ((k % nb) + nb) % nb;
  paintBody(b, (x, y, u, v, out) => {
    const warp = (fbm(x / 40, y / 10, s, 4) - 0.5) * st.turb + (fbm(x / 90, y / 25, s + 1, 3) - 0.5) * st.turb * 0.7;
    const bt = (v * 0.5 + 0.5) * nb + warp * 0.9;
    const i0 = Math.floor(bt), f = bt - i0, sm = f * f * (3 - 2 * f);
    let col = mix(order[wrap(i0)], order[wrap(i0 + 1)], sm);
    const streak = 0.92 + fbm(x / 7, y / 1.8, s + 3, 3) * 0.16;
    col = [col[0] * streak, col[1] * streak, col[2] * streak];
    let bio = 0;
    const sd = Math.hypot((u - st.storm.u) / st.storm.rx, (v - st.storm.v) / st.storm.ry);
    if (sd < 1.15) {
      const swirl = fbm(x / 6 + sd * 3, y / 6, s + 5, 3);
      if (sd < 1) { col = mix(col, st.storm.col, (1 - sd * sd) * 0.85 * (0.8 + swirl * 0.4)); bio = 1; }
      else col = mix(col, st.ovals, Math.max(0, 1 - Math.abs(sd - 1.07) / 0.08) * 0.35);
    }
    for (const ov of ovals) {
      const od = Math.hypot((u - ov.u) / ov.r, (v - ov.v) / (ov.r * 0.6));
      if (od < 1) col = mix(col, st.ovals, (1 - od) * 0.7);
    }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  }, 0.45);
}

// ---------- moons of Zeus ----------
function paintHephaestus(b) {            // sulfur-yellow volcanic moon (like Io)
  const S = b.size, c0 = S / 2, R = b.texR, s = SEED + 1800, rnd = mulberry32(s);
  const vents = Array.from({ length: 14 }, () => {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.9;
    return { x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: 2 + rnd() * 6, hot: rnd() < 0.4 };
  });
  paintBody(b, (x, y, u, v, out) => {
    const m = fbm(x / 18, y / 18, s, 4), f = fbm(x / 5, y / 5, s + 1, 2);
    let col = m > 0.55 ? mix([226, 206, 96], [242, 236, 206], (m - 0.55) * 3) : mix([206, 136, 60], [226, 206, 96], m / 0.55);
    col = mix(col, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85], f * 0.4);
    let bio = 0, glow = 0;
    for (const vt of vents) {
      const dd = Math.hypot(x - vt.x, y - vt.y) / vt.r;
      if (dd < 1) { col = mix([34, 26, 22], [70, 40, 30], dd); bio = 1; if (vt.hot && dd < 0.45) { col = [255, 150, 50]; glow = 1; } }
      else if (dd < 2.4) col = mix(col, [176, 64, 40], 0.45 * (1 - (dd - 1) / 1.4));   // red ring of fresh sulfur
    }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio; out[4] = glow;
  }, 0.3);
}
function paintAthena(b) {                // bright ice crisscrossed with brown cracks (like Europa)
  const s = SEED + 1810;
  paintBody(b, (x, y, u, v, out) => {
    let col = mix([238, 232, 220], [214, 200, 180], fbm(x / 30, y / 30, s, 4));
    if (fbm(x / 22, y / 22, s + 1, 3) > 0.64) col = mix(col, [176, 140, 110], 0.55);   // jumbled "chaos" terrain
    const c1 = Math.abs(fbm(x / 25, y / 25, s + 2, 3) - 0.5) < 0.012, c2 = Math.abs(fbm(x / 12, y / 12, s + 3, 3) - 0.5) < 0.01;
    let bio = 0;
    if (c1 || c2) { col = mix(col, [146, 92, 62], c1 ? 0.85 : 0.6); bio = 1; }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}
function paintHermes(b) {                // dark ancient crust peppered with bright craters (like Callisto)
  const S = b.size, c0 = S / 2, R = b.texR, s = SEED + 1820, rnd = mulberry32(s);
  const bright = new Float32Array(S * S);
  for (let k = 0; k < 320; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R, cr = 1 + Math.pow(rnd(), 3) * 7;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist;
    for (let y = Math.max(0, (cy - cr * 2) | 0); y <= Math.min(S - 1, (cy + cr * 2) | 0); y++)
      for (let x = Math.max(0, (cx - cr * 2) | 0); x <= Math.min(S - 1, (cx + cr * 2) | 0); x++) {
        const dd = Math.hypot(x - cx, y - cy) / cr;
        if (dd < 2) bright[y * S + x] = Math.max(bright[y * S + x], dd < 1 ? 0.9 : (2 - dd) * 0.45);
      }
  }
  const bx = c0 + (rnd() - 0.5) * R, by = c0 + (rnd() - 0.5) * R, br = R * 0.25;   // a giant ringed impact basin
  paintBody(b, (x, y, u, v, out, i) => {
    let col = mix([74, 68, 62], [98, 90, 82], fbm(x / 20, y / 20, s, 4));
    const bd = Math.hypot(x - bx, y - by) / br;
    if (bd < 2.2) col = mix(col, [140, 132, 122], (0.5 + 0.5 * Math.cos(bd * Math.PI * 5)) * 0.35 * (1 - bd / 2.2));
    col = mix(col, [212, 206, 196], bright[i]);
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bright[i] > 0.3 ? 1 : 0;
  });
}

// ---------- moons of Poseidon ----------
function paintTriton(b) {                // pinkish nitrogen ice, cantaloupe terrain, dark geyser streaks
  const s = SEED + 1830;
  paintBody(b, (x, y, u, v, out) => {
    let col = mix([222, 196, 186], [196, 166, 156], fbm(x / 24, y / 24, s, 4));
    let bio = 0;
    if (Math.abs(fbm(x / 7, y / 7, s + 1, 3) - 0.5) < 0.04) col = mix(col, [166, 138, 132], 0.6);   // cantaloupe ridges
    if (v > 0.35 + (fbm(x / 14, y / 14, s + 2, 2) - 0.5) * 0.3) {                              // bright polar cap
      col = mix(col, [240, 230, 224], 0.7); bio = 2;
      if (fbm(x / 3, y / 16, s + 3, 3) > 0.66) { col = mix(col, [96, 76, 74], 0.75); bio = 1; }    // geyser streaks
    }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}
function paintAmphitrite(b) {            // blue-white ice plates over a frozen ocean
  const s = SEED + 1840;
  paintBody(b, (x, y, u, v, out) => {
    let col = mix([210, 228, 242], [180, 206, 228], fbm(x / 26, y / 26, s, 4));
    if (fbm(x / 40, y / 40, s + 1, 3) > 0.6) col = mix(col, [160, 194, 226], 0.5);                 // refrozen smooth areas
    let bio = 0;
    if (Math.abs(fbm(x / 14, y / 14, s + 2, 3) - 0.5) < 0.018) { col = [70, 112, 150]; bio = 1; }   // cracks between plates
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}

// ---------- the bodies themselves ----------
{
  const P = CFG.planets;
  makeBody({ id: 'aries', name: 'Aries', parent: 'sun', r: DISK.R * P.aries.size, tex: 2,
    orbit: SUN.dist * P.aries.orbit, period: kepler(P.aries.orbit), spin: P.aries.spin, seedOff: 21,
    halo: '232,120,80', dot: '#d0704a', label: '#ffb595', ring: '230,130,90', key: 'r', frame: 'rotating',
    biomes: ['Rust plains', 'Dark basalt', 'Polar ice', 'Canyon', 'Volcano', 'Cratered highlands'],
    blurb: 'the red planet', paint: paintAries });
  makeBody({ id: 'zeus', name: 'Zeus', parent: 'sun', r: DISK.R * P.zeus.size, tex: 12,
    orbit: SUN.dist * P.zeus.orbit, period: kepler(P.zeus.orbit), spin: P.zeus.spin, seedOff: 31,
    halo: '235,200,150', dot: '#d9b98c', label: '#f3d9b0', ring: '235,200,150', key: 'z', frame: 'translate',
    biomes: ['Cloud bands', 'Great Red Storm'], blurb: 'gas giant', paint: b => paintGasGiant(b, ZEUS_STYLE) });
  makeBody({ id: 'poseidon', name: 'Poseidon', parent: 'sun', r: DISK.R * P.poseidon.size, tex: 9,
    orbit: SUN.dist * P.poseidon.orbit, period: kepler(P.poseidon.orbit), spin: P.poseidon.spin, seedOff: 32,
    halo: '110,160,240', dot: '#4f86d6', label: '#a9c8ff', ring: '120,170,240', key: 'p', frame: 'translate',
    rings: { inner: 1.3, outer: 2.05, gaps: [[1.55, 1.6], [1.83, 1.87]] },
    biomes: ['Cloud bands', 'Dark Storm'], blurb: 'ringed gas giant', paint: b => paintGasGiant(b, POSEIDON_STYLE) });
  const Rz = BODY.zeus.r, Rp = BODY.poseidon.r;
  makeBody({ id: 'hephaestus', name: 'Hephaestus', parent: 'zeus', r: 140, tex: 1, orbit: Rz * 2.4, period: 70, spin: 'locked', seedOff: 41,
    halo: '240,210,110', dot: '#e0c25a', label: '#f5dd8a', ring: '240,210,120', frame: 'rotating',
    biomes: ['Sulfur plains', 'Volcanic vent'], blurb: 'volcanic moon of Zeus', paint: paintHephaestus });
  makeBody({ id: 'athena', name: 'Athena', parent: 'zeus', r: 120, tex: 1, orbit: Rz * 3.4, period: 120, spin: 'locked', seedOff: 42,
    halo: '230,225,215', dot: '#e4dccd', label: '#efe8dc', ring: '230,225,215', frame: 'rotating',
    biomes: ['Ice sheet', 'Cracked ridges'], blurb: 'icy moon of Zeus', paint: paintAthena });
  makeBody({ id: 'hermes', name: 'Hermes', parent: 'zeus', r: 190, tex: 1, orbit: Rz * 5, period: 200, spin: 'locked', seedOff: 43,
    halo: '200,195,190', dot: '#8d8680', label: '#d6d0c8', ring: '200,195,190', frame: 'rotating',
    biomes: ['Dark crust', 'Bright craters'], blurb: 'ancient cratered moon of Zeus', paint: paintHermes });
  makeBody({ id: 'amphitrite', name: 'Amphitrite', parent: 'poseidon', r: 90, tex: 1, orbit: Rp * 2.6, period: 80, spin: 'locked', seedOff: 51,
    halo: '200,225,245', dot: '#c8e0f0', label: '#d8ecfa', ring: '200,225,245', frame: 'rotating',
    biomes: ['Ice plates', 'Frozen cracks'], blurb: 'frozen-ocean moon of Poseidon', paint: paintAmphitrite });
  makeBody({ id: 'triton', name: 'Triton', parent: 'poseidon', r: 120, tex: 1, orbit: Rp * 3.8, period: -150, spin: 'locked', seedOff: 52,
    halo: '230,200,195', dot: '#dcbcb4', label: '#f0d6d0', ring: '230,200,195', frame: 'rotating',
    biomes: ['Nitrogen ice', 'Geyser streaks', 'Polar cap'], blurb: 'moon of Poseidon that orbits backwards', paint: paintTriton });
  // locking onto a gas giant zooms out to show its whole family of moons
  for (const gid of ['zeus', 'poseidon']) {
    const kids = Object.values(BODY).filter(m => m.parent === gid);
    const reach = Math.max(...kids.map(m => m.orbit + m.r)) * 1.1;
    BODY[gid].followZoom = () => Math.min(cw, ch - 200) / (2 * reach);
  }
}

// ======================================================================
// the seed world: a whole planet (and its moons) generated from the map seed.
// planetRecipe(seed) turns a number into a list of traits; the painters turn traits into a surface.
// Same seed -> same recipe -> same planet, every time.
// ======================================================================
function hsl(h, sat, l) {                                // hue 0-360, sat/l 0-1 -> [r, g, b]
  h = (((h % 360) + 360) % 360) / 360;
  const f = n => { const k = (n + h * 12) % 12, a = sat * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
const rgbStr = c => `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
function hueName(h) {
  h = ((h % 360) + 360) % 360;
  return h < 20 ? 'crimson' : h < 45 ? 'amber' : h < 70 ? 'golden' : h < 100 ? 'olive' : h < 150 ? 'jade'
    : h < 190 ? 'teal' : h < 235 ? 'azure' : h < 275 ? 'indigo' : h < 320 ? 'violet' : 'rose';
}
const SYLLABLES = ['ka', 've', 'lor', 'zan', 'tor', 'mi', 'rah', 'eth', 'os', 'qua', 'dri', 'sel', 'nor', 'vy', 'tha', 'ix', 'um', 'pe', 'gor', 'lia', 'ser', 'an', 'kel', 'oth', 'yr', 'bel'];
function makeName(r) {
  let w = '';
  const n = 2 + (r() < 0.35 ? 1 : 0);
  for (let k = 0; k < n; k++) w += SYLLABLES[(r() * SYLLABLES.length) | 0];
  w += ['', '', 'on', 'ar', 'is', 'us', 'a', 'ia'][(r() * 8) | 0];
  return w[0].toUpperCase() + w.slice(1);
}
const LIQUIDS = {
  water:   { name: 'Ocean',       plural: 'oceans',      deep: [24, 60, 128], shallow: [52, 118, 176], glow: 0 },
  lava:    { name: 'Lava sea',    plural: 'lava seas',   deep: [170, 40, 12], shallow: [250, 130, 34], glow: 0.8 },
  methane: { name: 'Methane sea', plural: 'methane seas', deep: [52, 36, 26], shallow: [104, 74, 46],  glow: 0 },
  acid:    { name: 'Acid lake',   plural: 'acid lakes',  deep: [92, 122, 22], shallow: [170, 196, 52], glow: 0 },
};
const MINOR_TYPES = {
  icy:      'icy moon',
  volcanic: 'volcanic moon',
  hazy:     'hazy moon wrapped in thick smog',
  cratered: 'ancient cratered moon',
  frost:    'frosty moon with dark streaks',
};

// THE RULES: every trait below is rolled from the seed, in a fixed order.
function planetRecipe(seed) {
  // scramble the seed thoroughly first, so neighbouring seeds (1, 2, 3...) give unrelated planets
  const r = mulberry32(Math.floor(hash2(seed, 1234, 5678) * 4294967296) ^ Math.floor(hash2(seed, 91, 3) * 4294967296));
  for (let k = 0; k < 4; k++) r();
  const pick = a => a[(r() * a.length) | 0], range = (a, b) => a + r() * (b - a), chance = q => r() < q;
  const P = { seed, name: makeName(r), kind: chance(0.5) ? 'gas' : 'rocky' };
  if (P.kind === 'gas') {
    P.size = range(3, 7);                                       // x your world's radius
    P.hue = range(0, 360); P.sat = range(0.3, 0.7);
    P.bands = 8 + ((r() * 11) | 0); P.turb = range(0.5, 1.3);
    P.palette = Array.from({ length: 6 }, () => hsl(P.hue + range(-28, 28), P.sat * range(0.6, 1.1), range(0.3, 0.85)));
    P.storm = chance(0.7) ? { u: range(-0.5, 0.5), v: range(-0.5, 0.5), rx: range(0.1, 0.25), ry: range(0.06, 0.12),
      col: hsl(P.hue + range(-40, 40), P.sat, chance(0.5) ? 0.25 : 0.72) } : null;
    P.rings = chance(0.45) ? { inner: 1.3, outer: range(1.7, 2.3), gaps: [[range(1.48, 1.6), 0]] } : null;
    if (P.rings) P.rings.gaps[0][1] = P.rings.gaps[0][0] + 0.05;
    P.moons = 1 + ((r() * 4) | 0);
    P.summary = `gas giant: ${hueName(P.hue)} bands${P.storm ? ', a great storm' : ''}${P.rings ? ', rings' : ''}`;
  } else {
    P.size = range(0.35, 1.4);
    P.atmo = pick(['none', 'thin', 'thin', 'thick']);
    P.atmoHue = range(0, 360);
    P.liquid = pick(['none', 'water', 'water', 'lava', 'methane', 'acid']);
    P.liquidLevel = range(0.2, 0.65);                           // share of the surface under liquid
    P.groundHue = range(0, 360); P.groundSat = range(0.12, 0.5);
    P.rough = range(0.2, 1);                                    // how jagged the mountains are
    P.ice = P.liquid !== 'lava' && chance(0.5) ? range(0.08, 0.3) : 0;
    P.craters = P.atmo === 'none' ? 160 : P.atmo === 'thin' ? 50 : 8;   // air burns up meteors
    P.clouds = P.atmo === 'thick' ? range(0.35, 0.7) : 0;
    P.moons = (r() * 3) | 0;
    const bits = [P.atmo === 'none' ? 'no air' : `${P.atmo} ${hueName(P.atmoHue)} atmosphere`];
    if (P.liquid !== 'none') bits.push(LIQUIDS[P.liquid].plural);
    if (P.ice) bits.push('ice caps');
    if (P.rough > 0.7) bits.push('jagged mountains');
    P.summary = `rocky world: ${bits.join(', ')}`;
  }
  P.moonDefs = Array.from({ length: P.moons }, () => ({
    name: makeName(r), type: pick(Object.keys(MINOR_TYPES)), r: range(60, 160), hue: range(0, 360), retro: chance(0.15),
  }));
  return P;
}

// ---------- painters for generated bodies ----------
function gasStyle(P) {
  return { palette: P.palette, bands: P.bands, turb: P.turb,
    storm: P.storm || { u: 9, v: 9, rx: 0.01, ry: 0.01, col: [0, 0, 0] }, ovals: hsl(P.hue, P.sat * 0.3, 0.9) };
}

function paintRocky(b, P) {
  const S = b.size, c0 = S / 2, R = b.texR, s = P.seed + 3000, rnd = mulberry32(s);
  const sc = R * 0.35, hgt = new Float32Array(S * S), vals = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) continue;
    const wx = x + (fbm(x / sc, y / sc, s + 1, 3) - 0.5) * R * 0.25, wy = y + (fbm(x / sc, y / sc, s + 3, 3) - 0.5) * R * 0.25;
    let e = fbm(wx / sc, wy / sc, s, 5);
    const ridge = 1 - Math.abs(2 * fbm(x / (sc * 0.45), y / (sc * 0.45), s + 2, 4) - 1);
    e += ridge * ridge * 0.35 * P.rough;
    hgt[y * S + x] = e; vals.push(e);
  }
  vals.sort((a, b2) => a - b2);
  const sea = P.liquid !== 'none' ? vals[Math.floor(vals.length * P.liquidLevel)] : -1;
  const bottom = Math.max(sea, vals[0]), top = vals[vals.length - 1];
  for (let k = 0; k < P.craters; k++) {                 // craters, on dry land only
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.95;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist, cr = 1 + Math.pow(rnd(), 4) * R * 0.08, dep = 0.03 + 0.006 * cr;
    for (let y = Math.max(0, (cy - cr * 1.4) | 0); y <= Math.min(S - 1, (cy + cr * 1.4) | 0); y++)
      for (let x = Math.max(0, (cx - cr * 1.4) | 0); x <= Math.min(S - 1, (cx + cr * 1.4) | 0); x++) {
        const i = y * S + x;
        if (hgt[i] <= sea) continue;
        const dd = Math.hypot(x - cx, y - cy) / cr;
        if (dd < 1) hgt[i] -= dep * (1 - dd * dd);
        else if (dd < 1.35) hgt[i] += dep * 0.4 * (1 - Math.abs(dd - 1.1) / 0.25);
      }
  }
  const low = hsl(P.groundHue, P.groundSat, 0.38), high = hsl(P.groundHue + 20, P.groundSat * 0.7, 0.56), peak = hsl(P.groundHue, P.groundSat * 0.3, 0.82);
  const atmoCol = hsl(P.atmoHue, 0.45, 0.65), cloudCol = mix([242, 244, 248], atmoCol, 0.2);
  const L = LIQUIDS[P.liquid];
  paintBody(b, (x, y, u, v, out, i) => {
    const e = hgt[i], fine = fbm(x / 3, y / 3, s + 9, 2);
    let col, bio, glow = 0;
    if (e < sea) {
      const dep = clamp((sea - e) * 8, 0, 1);
      col = mix(L.shallow, L.deep, dep); bio = 0; glow = L.glow * (0.5 + dep * 0.5);
    } else {
      const t = clamp((e - bottom) / (top - bottom + 1e-6), 0, 1);
      col = t < 0.6 ? mix(low, high, t / 0.6) : mix(high, peak, (t - 0.6) / 0.4);
      bio = t < 0.35 ? 1 : t < 0.7 ? 2 : 3;
      const ha = (x > 1 && y > 1) ? hgt[i - 2 * S - 2] : e, hb = (x < S - 2 && y < S - 2) ? hgt[i + 2 * S + 2] : e;
      const shade = clamp(1 + (ha - hb) * 4, 0.6, 1.4);
      col = mix(col, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85], fine * 0.4);
      col = [col[0] * shade, col[1] * shade, col[2] * shade];
    }
    if (P.ice && Math.abs(v) > 1 - P.ice + (fbm(x / 10, y / 10, s + 5, 2) - 0.5) * 0.12) { col = mix(col, [240, 244, 248], 0.85); bio = 4; glow = 0; }
    if (P.clouds) {                                      // wispy cloud streaks (stretched sideways, like weather bands)
      const c = fbm(x / (R * 0.12) + fbm(x / sc, y / sc, s + 7, 2) * 3, y / (R * 0.05), s + 6, 4);
      const th = 1 - P.clouds * 0.8;
      if (c > th) col = mix(col, cloudCol, clamp((c - th) * 4, 0, 0.85));
    }
    if (P.atmo === 'thick') col = mix(col, atmoCol, 0.18);
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio; out[4] = glow;
  }, P.atmo === 'thick' ? 0.15 : 0.3);
  b.biomes = [L ? L.name : 'Basin', 'Lowlands', 'Highlands', P.rough > 0.6 ? 'Mountains' : 'Uplands', 'Ice cap'];
}

function paintMinor(b, M) {
  const S = b.size, c0 = S / 2, R = b.texR, s = M.seed, rnd = mulberry32(s);
  const put = (out, c, bio = 0, glow = 0) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = bio; out[4] = glow; };
  if (M.type === 'icy') {                                // cracked ice (Europa-like)
    const a = hsl(M.hue, 0.15, 0.88), a2 = hsl(M.hue, 0.2, 0.74), crack = hsl(M.hue + 180, 0.35, 0.4);
    b.biomes = ['Ice sheet', 'Cracks'];
    paintBody(b, (x, y, u, v, out) => {
      const col = mix(a, a2, fbm(x / 26, y / 26, s, 4));
      const cr = Math.abs(fbm(x / 20, y / 20, s + 1, 3) - 0.5) < 0.013 || Math.abs(fbm(x / 10, y / 10, s + 2, 3) - 0.5) < 0.01;
      put(out, cr ? mix(col, crack, 0.75) : col, cr ? 1 : 0);
    });
  } else if (M.type === 'volcanic') {                    // sulfur and glowing vents (Io-like)
    const b1 = hsl(45 + (M.hue % 30) - 15, 0.6, 0.62), b2 = hsl(22 + (M.hue % 20), 0.6, 0.5), frost = hsl(50, 0.4, 0.88);
    const vents = Array.from({ length: 10 }, () => { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * R * 0.9; return { x: c0 + Math.cos(a) * d, y: c0 + Math.sin(a) * d, r: 2 + rnd() * 5, hot: rnd() < 0.45 }; });
    b.biomes = ['Sulfur plains', 'Volcanic vent'];
    paintBody(b, (x, y, u, v, out) => {
      const m = fbm(x / 18, y / 18, s, 4);
      let col = m > 0.55 ? mix(b1, frost, (m - 0.55) * 3) : mix(b2, b1, m / 0.55), bio = 0, glow = 0;
      for (const vt of vents) {
        const dd = Math.hypot(x - vt.x, y - vt.y) / vt.r;
        if (dd < 1) { col = mix([34, 26, 22], [70, 40, 30], dd); bio = 1; if (vt.hot && dd < 0.45) { col = [255, 150, 50]; glow = 1; } }
        else if (dd < 2.3) col = mix(col, [176, 64, 40], 0.4 * (1 - (dd - 1) / 1.3));
      }
      put(out, col, bio, glow);
    }, 0.3);
  } else if (M.type === 'hazy') {                        // a smooth ball of thick smog (Titan-like)
    const a = hsl(M.hue, 0.55, 0.5), a2 = hsl(M.hue + 15, 0.5, 0.62);
    b.biomes = ['Thick haze'];
    b.halo = rgbStr(hsl(M.hue, 0.6, 0.6)); b.haloA = 0.55; b.haloR = 1.35;
    paintBody(b, (x, y, u, v, out) => put(out, mix(a, a2, fbm(x / 40, y / 12, s, 3))), 0.05);
  } else if (M.type === 'cratered') {                    // dark, ancient, bright craters (Callisto-like)
    const dark = hsl(M.hue, 0.12, 0.28), dark2 = hsl(M.hue, 0.1, 0.36), light = hsl(M.hue, 0.1, 0.8);
    const bright = new Float32Array(S * S);
    for (let k = 0; k < 220; k++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * R, cr = 1 + Math.pow(rnd(), 3) * 6, cx = c0 + Math.cos(a) * d, cy = c0 + Math.sin(a) * d;
      for (let y = Math.max(0, (cy - cr * 2) | 0); y <= Math.min(S - 1, (cy + cr * 2) | 0); y++)
        for (let x = Math.max(0, (cx - cr * 2) | 0); x <= Math.min(S - 1, (cx + cr * 2) | 0); x++) {
          const dd = Math.hypot(x - cx, y - cy) / cr;
          if (dd < 2) bright[y * S + x] = Math.max(bright[y * S + x], dd < 1 ? 0.85 : (2 - dd) * 0.42);
        }
    }
    b.biomes = ['Dark crust', 'Bright craters'];
    paintBody(b, (x, y, u, v, out, i) => put(out, mix(mix(dark, dark2, fbm(x / 20, y / 20, s, 4)), light, bright[i]), bright[i] > 0.3 ? 1 : 0));
  } else {                                               // frost: streaks and a polar cap (Triton-like)
    const a = hsl(M.hue, 0.3, 0.8), a2 = hsl(M.hue, 0.3, 0.66), streak = hsl(M.hue, 0.2, 0.3);
    b.biomes = ['Frost plains', 'Dark streaks', 'Polar cap'];
    paintBody(b, (x, y, u, v, out) => {
      let col = mix(a, a2, fbm(x / 24, y / 24, s, 4)), bio = 0;
      if (Math.abs(fbm(x / 7, y / 7, s + 1, 3) - 0.5) < 0.04) col = mix(col, a2, 0.7);
      if (v > 0.3 + (fbm(x / 14, y / 14, s + 2, 2) - 0.5) * 0.3) {
        col = mix(col, [240, 236, 232], 0.65); bio = 2;
        if (fbm(x / 3, y / 16, s + 3, 3) > 0.66) { col = mix(col, streak, 0.75); bio = 1; }
      }
      put(out, col, bio);
    });
  }
}

// ---------- build the seed world and its moons ----------
const SEED_PLANET = planetRecipe(SEED);
const GEN_MOON_IDS = [];
{
  const P = SEED_PLANET, orbit = CFG.planets.seedWorld.orbit, R = DISK.R * P.size;
  const look = P.kind === 'gas'
    ? { halo: rgbStr(P.palette[0]), dot: `rgb(${rgbStr(P.palette[1])})`, label: `rgb(${rgbStr(hsl(P.hue, 0.5, 0.82))})` }
    : { halo: rgbStr(P.atmo === 'none' ? [200, 200, 210] : hsl(P.atmoHue, 0.5, 0.7)),
        haloA: P.atmo === 'none' ? 0.12 : P.atmo === 'thin' ? 0.3 : 0.55, haloR: P.atmo === 'thick' ? 1.3 : 1.15,
        dot: `rgb(${rgbStr(hsl(P.groundHue, P.groundSat, 0.5))})`, label: `rgb(${rgbStr(hsl(P.groundHue, 0.5, 0.82))})` };
  const world = makeBody({ id: 'seedworld', name: P.name, parent: 'sun', r: R, tex: Math.max(1, Math.ceil(R / 230)),
    orbit: SUN.dist * orbit, period: kepler(orbit), spin: P.kind === 'gas' ? 45 : 100, seedOff: 61,
    key: 'g', frame: P.kind === 'gas' ? 'translate' : 'rotating', rings: P.rings || undefined, ...look,
    ring: look.halo, recipe: P, blurb: `${P.summary} · generated from seed ${SEED}`,
    biomes: P.kind === 'gas' ? ['Cloud bands', 'Great storm'] : [],
    paint: b => (P.kind === 'gas' ? paintGasGiant(b, gasStyle(P)) : paintRocky(b, P)) });
  const first = P.kind === 'gas' ? Math.max(2.3, (P.rings ? P.rings.outer : 0) + 0.5) : 3;
  P.moonDefs.forEach((M, k) => {
    const id = 'seedmoon' + k;
    makeBody({ id, name: M.name, parent: 'seedworld', r: M.r, tex: 1,
      orbit: R * (first + k * (P.kind === 'gas' ? 1.1 : 1.8)) + M.r * 2, period: (60 + k * 55) * (M.retro ? -1 : 1), spin: 'locked',
      seedOff: 70 + k, frame: 'rotating', halo: rgbStr(hsl(M.hue, 0.25, 0.8)), dot: `rgb(${rgbStr(hsl(M.hue, 0.25, 0.7))})`,
      label: `rgb(${rgbStr(hsl(M.hue, 0.35, 0.86))})`, ring: rgbStr(hsl(M.hue, 0.25, 0.8)),
      blurb: `${MINOR_TYPES[M.type]} of ${P.name}${M.retro ? ', orbits backwards' : ''}`, biomes: [],
      paint: b => paintMinor(b, { ...M, seed: P.seed + 4000 + k * 97 }) });
    GEN_MOON_IDS.push(id);
  });
  if (GEN_MOON_IDS.length) {
    const reach = Math.max(...GEN_MOON_IDS.map(id => BODY[id].orbit + BODY[id].r)) * 1.1;
    world.followZoom = () => Math.min(cw, ch - 200) / (2 * reach);
  }
}
const DRAW_ORDER = ['aries', 'zeus', 'hephaestus', 'athena', 'hermes', 'poseidon', 'amphitrite', 'triton', 'seedworld', ...GEN_MOON_IDS];

function drawBodyGeneric(b, z) {
  const [x, y, spin] = genericPos(b);
  const [sx, sy] = toScreen(x, y), rr = b.r * z;
  const isMoon = b.parent !== 'sun';
  const orbitPx = b.orbit * z;
  if (isMoon && orbitPx < 12) return;                   // too close to its planet to tell apart from here
  // orbit ring around the parent
  if (orbitPx > 14 && orbitPx < 60000 && (isMoon || z < 0.01)) {
    const [px, py] = isMoon ? genericPos(BODY[b.parent]) : sunPos();
    const [cx, cy] = toScreen(px, py);
    ctx.setLineDash([3, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${b.ring},0.2)`;
    ctx.beginPath(); ctx.arc(cx, cy, orbitPx, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const extent = Math.max(rr * (b.rings ? b.rings.outer + 0.05 : 1.2), 20);
  if (sx + extent < 0 || sy + extent < 0 || sx - extent > cw || sy - extent > ch) return;
  const showLabel = !isMoon || orbitPx > 40;
  // rings (seen from above, so they're full circles around the planet), with the planet's shadow across them
  if (b.rings && rr >= 2) {
    for (const [a1, a2, al, tint] of b.ringlets) {
      ctx.beginPath(); ctx.arc(sx, sy, rr * a2, 0, Math.PI * 2); ctx.arc(sx, sy, rr * a1, 0, Math.PI * 2, true);
      ctx.fillStyle = `rgba(${tint | 0},${(tint + 18) | 0},${(tint + 34) | 0},${al})`; ctx.fill();
    }
    const [ssx0, ssy0] = toScreen(...sunPos().slice(0, 2));
    const away = Math.atan2(sy - ssy0, sx - ssx0);
    ctx.save();
    ctx.beginPath(); ctx.arc(sx, sy, rr * b.rings.outer, 0, Math.PI * 2); ctx.arc(sx, sy, rr * 0.98, 0, Math.PI * 2, true); ctx.clip();
    ctx.translate(sx, sy); ctx.rotate(away);
    ctx.fillStyle = 'rgba(2,4,14,0.72)'; ctx.fillRect(0, -rr, rr * (b.rings.outer + 0.1), rr * 2);
    ctx.restore();
  }
  // atmosphere / glow halo
  const haloR = Math.max(rr * (b.haloR || 1.15), 16);
  const gl = ctx.createRadialGradient(sx, sy, Math.max(rr * 0.95, 1), sx, sy, haloR);
  gl.addColorStop(0, `rgba(${b.halo},${b.haloA ?? 0.32})`); gl.addColorStop(1, `rgba(${b.halo},0)`);
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, haloR, 0, Math.PI * 2); ctx.fill();
  if (rr < 4) {
    ctx.fillStyle = b.dot; ctx.beginPath(); ctx.arc(sx, sy, Math.max(rr, 3.2), 0, Math.PI * 2); ctx.fill();
    if (showLabel) pill(sx, sy + 20, b.name, { fg: b.label, size: 12 });
    return;
  }
  const scale = b.tex * z, half = b.size / 2 * scale;
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
  ctx.imageSmoothingEnabled = scale < 1.5;
  ctx.drawImage(b.canvas, -half, -half, half * 2, half * 2);
  ctx.restore();
  // sunlight from the real sun: day side and night side
  const [ssx, ssy] = toScreen(...sunPos().slice(0, 2));
  let ldx = ssx - sx, ldy = ssy - sy;
  const ll = Math.hypot(ldx, ldy) || 1; ldx /= ll; ldy /= ll;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.clip();
  const lg = ctx.createLinearGradient(sx + ldx * rr, sy + ldy * rr, sx - ldx * rr * 1.4, sy - ldy * rr * 1.4);
  lg.addColorStop(0, 'rgba(0,0,12,0)'); lg.addColorStop(0.45, 'rgba(0,0,12,0.14)'); lg.addColorStop(0.75, 'rgba(0,0,12,0.55)'); lg.addColorStop(1, 'rgba(0,0,12,0.85)');
  ctx.fillStyle = lg; ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  ctx.restore();
  if (b.glow) {                                          // hot spots keep glowing on the night side
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85;
    ctx.imageSmoothingEnabled = scale < 1.5;
    ctx.drawImage(b.glow, -half, -half, half * 2, half * 2);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = true;
  if (showLabel && rr < 160) pill(sx, sy + rr * (b.rings ? b.rings.outer : 1) + 22, b.name, { fg: b.label, size: 12 });
}
function drawOuterBodies(z) { for (const id of DRAW_ORDER) drawBodyGeneric(BODY[id], z); }

// ======================================================================
// everything you can lock onto, in hit-test order (small moons first, the sun last)
// ======================================================================
const LOCKABLE = [
  { id: 'moon', name: 'the Moon', short: 'Moon', key: 'l', frame: 'rotating', r: () => MOON.r, pos: moonPos,
    visible: z => MOON.orbitR * z >= 12,
    info: (wx, wy) => { const mb = moonBiomeAt(wx, wy); return `The Moon${mb ? ' · ' + mb : ''} · orbits your world every ${Math.round(MOON.period / 60)} min`; } },
  ...['hephaestus', 'athena', 'hermes', 'amphitrite', 'triton', ...GEN_MOON_IDS, 'aries', 'zeus', 'poseidon', 'seedworld'].map(id => {
    const b = BODY[id];
    return { id, name: b.name, short: b.name, key: b.key, frame: b.frame, r: () => b.r, pos: () => genericPos(b), zoom: b.followZoom,
      visible: z => b.parent === 'sun' || b.orbit * z >= 12,
      info: (wx, wy) => { const bio = genericBiomeAt(b, wx, wy); return `${b.name}${bio ? ' · ' + bio : ''} · ${b.blurb}`; } };
  }),
  { id: 'vulcan', name: 'Vulcan', short: 'Vulcan', key: 'v', frame: 'rotating', r: () => VULCAN.r, pos: vulcanPos,
    info: (wx, wy) => { const vb = vulcanBiomeAt(wx, wy); return `Vulcan${vb ? ' · ' + vb : ''} · lava world, circles the Sun every ${(VULCAN.year / 60).toFixed(1)} min`; } },
  { id: 'sun', name: 'the Sun', short: 'Sun', key: 'u', frame: 'translate', r: () => SUN.r, pos: sunPos,
    zoom: () => Math.min(cw, ch - 200) / (2 * (SUN.dist + DISK.R * 6)) * 0.95,
    info: () => `The Sun · your world circles it every ${Math.round(SUN.year / 60)} min` },
];
const LOCK = Object.fromEntries(LOCKABLE.map(e => [e.id, e]));

function bodyUnder(wx, wy) {
  for (const e of LOCKABLE) {
    if (e.visible && !e.visible(cam.zoom)) continue;
    const [x, y] = e.pos();
    if (Math.hypot(wx - x, wy - y) < Math.max(e.r(), 24 / cam.zoom)) return e;
  }
  return null;
}

// hovering any body (or your world from far out): gold ring + hint, so you know a click will lock on
function drawLockHover(z) {
  if (!mouse.in || mouse.dragged || game.tool) return;
  const [wx, wy] = toWorld(mouse.x, mouse.y);
  const e = bodyUnder(wx, wy);
  let tx, ty, br;
  if (e) { if (cam.follow === e.id) return; [tx, ty] = e.pos(); br = e.r(); }
  else if (worldLockable() && overWorld(wx, wy)) { tx = DISK.cx; ty = DISK.cy; br = DISK.R; }
  else return;
  const [sx, sy] = toScreen(tx, ty);
  const r = Math.max(br * z, 10) + 7;
  ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#f2c14e';
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  pill(sx, sy - r - 16, 'Click to lock on', { fg: '#f2c14e', border: '#f2c14e', size: 12 });
  canvas.style.cursor = 'pointer';
}

function drawSprite(name, wx, wy, sizePx, alpha = 1) {
  const img = SPR[name];
  if (!img.complete) return;
  const [sx, sy] = toScreen(wx, wy);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, sx - sizePx / 2, sy - sizePx / 2, sizePx, sizePx);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function tracePath(path) {
  ctx.beginPath();
  path.forEach((t, k) => {
    const [sx, sy] = toScreen(...tileCenter(t));
    if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
}

function strokeRoute(path, kind, z, ghost = false) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ghost) {
    tracePath(path);
    ctx.setLineDash([6, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#7bd389'; ctx.stroke(); ctx.setLineDash([]);
  } else if (kind === 'rail') {
    if (z >= PIXEL_BORDER_BELOW) {
      tracePath(path);   // sleepers
      ctx.lineCap = 'butt';
      ctx.setLineDash([Math.max(1.5, z * 0.13), Math.max(3, z * 0.3)]);
      ctx.lineWidth = Math.max(4, z * 0.6); ctx.strokeStyle = '#6b4f3a'; ctx.stroke();
      ctx.setLineDash([]);
      tracePath(path);   // rail
      ctx.lineWidth = Math.max(1.5, z * 0.16); ctx.strokeStyle = '#59616a'; ctx.stroke();
    } else {
      tracePath(path);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#3d2e24'; ctx.stroke();
    }
  } else {
    tracePath(path);
    ctx.setLineDash([5, 7]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
}

function vehiclePos(L) {
  const k = Math.min(Math.floor(L.t), L.path.length - 2), f = L.t - k;
  const [ax, ay] = tileCenter(L.path[k]), [bx, by] = tileCenter(L.path[k + 1]);
  return [lerp(ax, bx, f), lerp(ay, by, f), Math.atan2(by - ay, bx - ax)];
}

function drawVehicles(z) {
  for (const L of game.links) {
    const [wx, wy, ang] = vehiclePos(L);
    const [sx, sy] = toScreen(wx, wy);
    if (L.kind === 'sea') {
      const s = Math.max(18, z * 1.6);
      if (SPR.boat.complete) ctx.drawImage(SPR.boat, sx - s / 2, sy - s / 2, s, s);
      continue;
    }
    const len = Math.max(9, z * 1.0), wid = Math.max(5, z * 0.5);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang + (L.dir < 0 ? Math.PI : 0));
    ctx.fillStyle = '#2f3540'; ctx.fillRect(-len * 1.15, -wid / 2, len * 0.95, wid);       // wagon
    ctx.fillStyle = '#b8432f'; ctx.fillRect(-len * 0.1, -wid / 2, len * 0.95, wid);         // engine
    ctx.fillStyle = '#f2c14e'; ctx.fillRect(len * 0.65, -wid * 0.25, len * 0.15, wid * 0.5); // headlight
    ctx.restore();
  }
}

function render() {
  const z = cam.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSpace(z);
  canvas.style.cursor = '';
  drawSun(z);
  drawVulcan(z);
  drawOuterBodies(z);
  drawMoon(z);
  drawLockHover(z);

  // terrain + territory (1 px per tile, scaled up crisp)
  // crisp pixels up close; smooth scaling when zoomed far out (less shimmer)
  ctx.imageSmoothingEnabled = z < 1.5;
  drawWorldImage(terrainCanvas);
  flushLayer(fillLayer); flushLayer(borderLayer);
  drawWorldImage(fillLayer.c);
  if (z < PIXEL_BORDER_BELOW) drawWorldImage(borderLayer.c);
  ctx.imageSmoothingEnabled = true;

  // visible tile range (check all four screen corners, since the camera can be rotated)
  const corners = [toWorld(0, 0), toWorld(cw, 0), toWorld(0, ch), toWorld(cw, ch)];
  const wx0 = Math.min(...corners.map(c => c[0])), wx1 = Math.max(...corners.map(c => c[0]));
  const wy0 = Math.min(...corners.map(c => c[1])), wy1 = Math.max(...corners.map(c => c[1]));
  const x0 = clamp(Math.floor(wx0) - 1, 0, W - 1), x1 = clamp(Math.ceil(wx1) + 1, 0, W - 1);
  const y0 = clamp(Math.floor(wy0) - 1, 0, H - 1), y1 = clamp(Math.ceil(wy1) + 1, 0, H - 1);

  // close up: border as crisp lines along tile edges that face unowned land/water
  if (z >= PIXEL_BORDER_BELOW) {
    const paths = { blue: new Path2D(), orange: new Path2D() };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      if (!owner[i]) continue;
      const p = isCutOff(i) ? paths.orange : paths.blue;
      const [sx, sy] = toScreen(x, y);
      if (x === 0 || !owner[i - 1]) { p.moveTo(sx, sy); p.lineTo(sx, sy + z); }
      if (x === W - 1 || !owner[i + 1]) { p.moveTo(sx + z, sy); p.lineTo(sx + z, sy + z); }
      if (y === 0 || !owner[i - W]) { p.moveTo(sx, sy); p.lineTo(sx + z, sy); }
      if (y === H - 1 || !owner[i + W]) { p.moveTo(sx, sy + z); p.lineTo(sx + z, sy + z); }
    }
    ctx.lineCap = 'square';
    ctx.lineWidth = Math.min(4, 1.5 + z * 0.12);
    ctx.strokeStyle = '#1c62d6'; ctx.stroke(paths.blue);
    ctx.strokeStyle = '#e8802a'; ctx.stroke(paths.orange);
    ctx.lineCap = 'butt';
  }

  // rail lines and sea routes
  for (const L of game.links) if (L.kind === 'sea') strokeRoute(L.path, 'sea', z);
  for (const L of game.links) if (L.kind === 'rail') strokeRoute(L.path, 'rail', z);

  if (z >= CFG.detailZoom) {
    // detail view: every deposit tile and building as a sprite
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), dep = depositOf[i];
      if (dep >= 0) {
        const t = deposits[dep].type;
        const jx = (hash2(x, y, 11) - 0.5) * 0.3, jy = (hash2(x, y, 12) - 0.5) * 0.3;
        drawSprite(DEP_SPRITE[t], x + 0.5 + jx, y + 0.5 + jy, z * (t === 'forest' ? 2.3 : 1.9));
      }
    }
    for (const b of game.buildings) {
      const x = b.i % W, y = (b.i / W) | 0;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      drawSprite(b.type, x + 0.5, y + 0.5, z * (b.type === 'house' ? 1.45 : b.type === 'house3' || b.type === 'solar' ? 1.15 : 1.25));
    }
  } else if (z >= CFG.cityZoom) {
    // middle view: buildings as solid squares
    for (const b of game.buildings) {
      const [sx, sy] = toScreen(b.i % W, (b.i / W) | 0);
      ctx.fillStyle = BLD_COLOR[b.type];
      ctx.fillRect(sx + z * 0.12, sy + z * 0.12, z * 0.76, z * 0.76);
    }
  } else {
    // map view: city icons, station/port icons, deposit markers
    if (clustersDirty) computeClusters();
    for (const d of deposits) {
      if (d.type === 'forest') continue;   // forests already show as dark green patches
      if (z < 1.6 && d.type === 'stone') continue;   // very far out: only iron, to avoid clutter
      if (z < 0.9) continue;                         // whole-disk view: no markers at all
      const [sx, sy] = toScreen(d.cx + 0.5, d.cy + 0.5);
      if (sx < -10 || sy < -10 || sx > cw + 10 || sy > ch + 10) continue;
      ctx.beginPath(); ctx.arc(sx, sy, d.type === 'iron' ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = DEP_COLOR[d.type]; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
    }
    for (const b of game.buildings) {
      if (b.type !== 'station' && b.type !== 'port') continue;
      const [sx, sy] = toScreen(...tileCenter(b.i));
      ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(20,26,37,0.85)'; ctx.fill();
      if (SPR[b.type].complete) ctx.drawImage(SPR[b.type], sx - 8, sy - 8, 16, 16);
    }
    for (const c of clusters) {
      if (z < 0.15) break;   // from orbit distance the whole disk is only a few pixels: no icons
      const [sx, sy] = toScreen(c.x, c.y);
      ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,26,37,0.85)'; ctx.fill();
      ctx.strokeStyle = c.cut ? '#e8802a' : { house: '#de6d4c', house2: '#7099c4', house3: '#c9d3df' }[c.top]; ctx.lineWidth = 2; ctx.stroke();
      if (SPR[c.top].complete) ctx.drawImage(SPR[c.top], sx - 9, sy - 9, 18, 18);
      if (c.n > 1) {
        ctx.font = "700 10px 'Segoe UI', Arial, sans-serif"; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,26,37,0.9)';
        ctx.strokeText(c.n, sx + 9, sy + 9); ctx.fillStyle = '#fff'; ctx.fillText(c.n, sx + 9, sy + 9);
      }
    }
  }

  drawVehicles(z);
  drawBuildPreview(z);
  drawSelection(z);
  drawDiskLabel(z);

  drawCountryLabels(z);

  // new colonies: supply countdown ring
  for (const o of game.outposts) {
    const c = liveCountry(o.country);
    if (!c) continue;
    const [sx, sy] = toScreen(o.x, o.y);
    const r = Math.max(26, CFG.outpostRadius * z * 1.6);
    const frac = clamp(c.supply / CFG.outpostSupply, 0, 1);
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = '#ff9f43'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt';
    pill(sx, sy - r - 30, `New colony: ${c.short} · ${Math.floor(c.people)} settlers · housing for ${c.cap}`, { dot: '#ff7a6b' });
    pill(sx, sy - r - 8, `Supplies ${Math.ceil(c.supply)}s · build houses here or link it home`, { dot: '#ff9f43', size: 11 });
  }

  // pushes: gold number at the advancing edge
  for (const p of game.pushes) {
    if (p.lx == null) { const [a, b] = nearestFrontier(p.tx, p.ty); p.lx = a; p.ly = b; }
    if (p.mx == null) { p.mx = p.lx; p.my = p.ly; }
    p.mx += (p.lx - p.mx) * 0.15; p.my += (p.ly - p.my) * 0.15;
    const [sx, sy] = toScreen(p.mx, p.my);
    const label = `${Math.ceil(p.budget)}`;
    const w = pill(sx, sy, label, { fg: '#f2c14e', border: '#f2c14e', size: 13, bold: 800, dot: '#141a25' });
    if (SPR.person.complete) ctx.drawImage(SPR.person, sx - w / 2 + 3, sy - 9, 18, 18);
  }

  // expeditions
  for (const e of game.expeditions) {
    const [sx, sy] = toScreen(e.x, e.y), [tx, ty] = toScreen(e.tx, e.ty);
    ctx.setLineDash([2, 9]); ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#f2c14e';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = 'butt';
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, Math.PI * 2); ctx.stroke();
    const overWater = biome[idx(Math.floor(e.x), Math.floor(e.y))] === OCEAN;
    ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#141a25'; ctx.fill(); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2.5; ctx.stroke();
    if (SPR.person.complete) ctx.drawImage(overWater ? SPR.boat : SPR.person, sx - 13, sy - 13, 26, 26);
    const eta = Math.hypot(e.tx - e.x, e.ty - e.y) / CFG.expeditionSpeed;
    pill(sx, sy + 30, `${overWater ? 'Boat' : 'Expedition'} · ${e.n} people · ${eta.toFixed(0)}s`, { dot: '#f2c14e', size: 11 });
  }

  // floating texts
  for (const f of game.floats) {
    const [sx, sy] = toScreen(f.x, f.y);
    ctx.globalAlpha = clamp(1.7 - f.t / 1.4, 0, 1);
    pill(sx, sy - 18 - f.t * 22, f.text, { fg: f.color, size: 12 });
    ctx.globalAlpha = 1;
  }
}

function drawSelection(z) {
  // selected houses: gold outline
  if (game.selection.length) {
    const s = Math.max(z, 3);
    ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2;
    for (const i of game.selection) {
      const [sx, sy] = toScreen(i % W, (i / W) | 0);
      ctx.strokeRect(sx - 1, sy - 1, s + 2, s + 2);
    }
  }
  // paste preview following the cursor
  if (blueprint && mouse.in && !mouse.dragged && !game.tool) {
    const t = hoverTile();
    if (t) {
      for (const o of pastePlan(t.x, t.y).tiles) {
        if (!inb(o.x, o.y)) continue;
        const [sx, sy] = toScreen(o.x, o.y);
        ctx.fillStyle = o.ok ? 'rgba(123,211,137,0.32)' : 'rgba(255,122,107,0.32)';
        ctx.fillRect(sx, sy, z, z);
        if (z >= CFG.cityZoom) drawSprite(o.type, o.x + 0.5, o.y + 0.5, z * (o.type === 'house' ? 1.45 : 1.25), 0.55);
      }
    }
  }
  // the box being dragged
  if (mouse.selecting) {
    const x = Math.min(mouse.sx, mouse.x), y = Math.min(mouse.sy, mouse.y);
    const w = Math.abs(mouse.x - mouse.sx), h = Math.abs(mouse.y - mouse.sy);
    ctx.fillStyle = 'rgba(242,193,78,0.12)'; ctx.fillRect(x, y, w, h);
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
  }
}

// country names written across their territory when you're zoomed out (hidden up close, where you see the details)
function drawCountryLabels(z) {
  if (z >= CFG.detailZoom || z < 0.15) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of game.countries) {
    if (!c.alive || !c.tiles) continue;
    const span = Math.sqrt(c.tiles) * z;           // rough on-screen size of the country
    if (span < 18) continue;
    const [sx, sy0] = toScreen(c.lx, c.ly);
    const size = clamp(span * 0.16, 11, 26);
    const sy = sy0 + (z < CFG.cityZoom ? 14 + size * 0.6 : 0);   // sit just below the city icon when zoomed out
    const text = (span > 140 ? c.full : c.short).toUpperCase();
    ctx.font = `800 ${size}px 'Segoe UI', Inter, Arial, sans-serif`;
    ctx.letterSpacing = `${Math.round(size * 0.12)}px`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,14,24,0.75)'; ctx.strokeText(text, sx, sy);
    ctx.fillStyle = c.id === game.active ? '#ffffff' : 'rgba(214,228,255,0.88)'; ctx.fillText(text, sx, sy);
  }
  ctx.restore();
}

function nearestFrontier(tx, ty) {
  let best = null, bd = Infinity;
  for (const i of frontier) {
    const d = (i % W - tx) ** 2 + (((i / W) | 0) - ty) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best == null ? [tx, ty] : [best % W + 0.5, ((best / W) | 0) + 0.5];
}

// ======================================================================
// input
// ======================================================================
// left-drag = select box · right/middle-drag = pan · plain clicks = actions
const mouse = { x: 0, y: 0, down: -1, sx: 0, sy: 0, dragged: false, selecting: false, camX: 0, camY: 0, in: false };

function hoverTile() {
  const [wx, wy] = toWorld(mouse.x, mouse.y);
  const x = Math.floor(wx), y = Math.floor(wy);
  return inb(x, y) ? { x, y, i: idx(x, y) } : null;
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true;
  mouse.down = e.button; mouse.sx = e.clientX; mouse.sy = e.clientY; cam.anim = null;
  mouse.dragged = false; mouse.selecting = false; mouse.camX = cam.x; mouse.camY = cam.y;
  mouse.offX = cam.offX; mouse.offY = cam.offY;
  if (e.button === 1) e.preventDefault();   // no browser autoscroll on middle-drag
});
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (mouse.down < 0) return;
  const dx = e.clientX - mouse.sx, dy = e.clientY - mouse.sy;
  if (!mouse.dragged && Math.hypot(dx, dy) > 5) {
    mouse.dragged = true;
    if (mouse.down === 0) mouse.selecting = true;
    else canvas.classList.add('dragging');
  }
  if (mouse.dragged && !mouse.selecting) {
    if (cam.follow) { cam.offX = mouse.offX - dx / cam.zoom; cam.offY = mouse.offY - dy / cam.zoom; }
    else { cam.x = mouse.camX - dx / cam.zoom; cam.y = mouse.camY - dy / cam.zoom; clampCam(); }
  }
});
window.addEventListener('mouseup', e => {
  const wasDrag = mouse.dragged, wasSel = mouse.selecting, btn = mouse.down;
  mouse.down = -1; mouse.dragged = false; mouse.selecting = false; canvas.classList.remove('dragging');
  if (btn < 0) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (wasSel) { finishSelection(mouse.sx, mouse.sy, e.clientX, e.clientY); return; }
  if (wasDrag || e.target !== canvas) return;
  // a plain click on any body (or your world from far out) locks onto it
  if (btn === 0 && !game.tool) {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const body = bodyUnder(wx, wy);
    if (body && cam.follow !== body.id) { followBody(body.id); return; }
    if (!body && worldLockable() && overWorld(wx, wy)) { lockWorld(); return; }
  }
  const t = hoverTile();
  if (!t) return;
  if (btn === 0) {
    if (game.tool) tryBuild(t.i, game.tool);
    else if (blueprint) clearSelection();          // with a selection, a click just deselects
    else if (owner[t.i]) {                         // clicking inside one of your countries selects it
      const c = countryAt(t.i);
      if (c && cam.zoom < CFG.cityZoom) flyToCountry(c);
      else if (c && c.id !== game.active) { game.active = c.id; toast(`Viewing ${c.full}`); }
    } else startPush(t.x, t.y);
  } else if (btn === 2) {
    if (game.tool) setTool(null);
    else if (blueprint) clearSelection();
    else launchExpedition(t.x, t.y);
  }
});
canvas.addEventListener('mouseenter', () => { mouse.in = true; });
canvas.addEventListener('mouseleave', () => { mouse.in = false; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.anim = null;
  const [bx, by] = toWorld(e.clientX, e.clientY);
  cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0022), CFG.zoomMin, CFG.zoomMax);
  const [ax, ay] = toWorld(e.clientX, e.clientY);
  nudgeCam(bx - ax, by - ay);
}, { passive: false });

// double-click a body to lock onto it; double-click empty space to let go
canvas.addEventListener('dblclick', e => {
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  const body = bodyUnder(wx, wy);
  if (body) followBody(body.id);
  else if (worldLockable() && overWorld(wx, wy)) lockWorld();
  else if (cam.follow) { stopFollow(); toast('Let go'); }
});

const keys = new Set();
window.addEventListener('keydown', e => {
  keys.add(e.key.toLowerCase());
  const k = e.key.toLowerCase();
  for (const [type, b] of Object.entries(CFG.buildings)) if (k === b.key) setTool(game.tool === type ? null : type);
  if (k === 'escape') { setTool(null); clearSelection(); stopFollow(); if (menuOpen) toggleBuildMenu(false); }
  if (k === 'e' && !e.repeat) toggleBuildMenu();
  if (k === 'c' && !e.repeat) {
    const t = mouse.in ? hoverTile() : null;
    if (t) pasteAt(t.x, t.y);
  }
  if (k === '[' || k === ']') {
    const opts = [10, 25, 50, 100];
    const j = clamp(opts.indexOf(game.sendPct) + (k === ']' ? 1 : -1), 0, opts.length - 1);
    setPct(opts[j]);
  }
  if (k === 'm') toggleMapView();
  // lock-on keys: L Moon, V Vulcan, R Aries, Z Zeus, P Poseidon, U Sun (press again to let go)
  if (!e.repeat) for (const en of LOCKABLE) {
    if (en.key !== k) continue;
    if (cam.follow === en.id) { stopFollow(); toast(`Let go of ${en.name}`); } else followBody(en.id);
  }
  if (k === 'h') { stopFollow(); cam.anim = null; cam.x = spawn.x + 0.5; cam.y = spawn.y + 0.5; }
  if (k === 'tab') {
    e.preventDefault();
    const alive = game.countries.filter(c => c.alive && c.tiles);
    const j = alive.indexOf(activeCountry());
    flyToCountry(alive[(j + (e.shiftKey ? alive.length - 1 : 1)) % alive.length]);
  }
  if ('wasd'.includes(k) || k.startsWith('arrow')) cam.anim = null;
  if (k === 'n') { location.search = ''; }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

function clampCam() {
  // you can pan out as far as the edge of the solar system
  const reach = SUN.dist + BODY.seedworld.orbit + BODY.seedworld.r * 6;
  cam.x = clamp(cam.x, DISK.cx - reach, DISK.cx + reach);
  cam.y = clamp(cam.y, DISK.cy - reach, DISK.cy + reach);
}
// M cycles: your view -> whole disk -> moon's orbit -> whole solar system -> back to your view
let mapStage = 0;
const orbitZoom = () => clamp(Math.min(cw, ch - 200) / (2 * (MOON.orbitR + MOON.r)) * 0.96, CFG.zoomMin, CFG.zoomMax);
const systemZoom = () => clamp(Math.min(cw, ch - 200) / (2 * (BODY.seedworld.orbit + BODY.seedworld.r * 2.5)) * 0.96, CFG.zoomMin, CFG.zoomMax);
function toggleMapView() {
  stopFollow();
  if (mapStage === 0) {
    savedView = { ...cam }; mapStage = 1;
    cam.zoom = fitZoom(); cam.x = DISK.cx; cam.y = DISK.cy + 36 / cam.zoom;
  } else if (mapStage === 1) {
    mapStage = 2;
    cam.zoom = orbitZoom(); cam.x = DISK.cx; cam.y = DISK.cy + 36 / cam.zoom;
  } else if (mapStage === 2) {
    followBody('sun', { zoom: systemZoom(), quiet: true, keepView: true });   // the whole system, centred on the sun
    mapStage = 3;
  } else {
    if (savedView) Object.assign(cam, savedView);
    savedView = null; mapStage = 0;
  }
}
function panKeys(dt) {
  const s = 600 / cam.zoom * dt;
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= s;
  if (keys.has('arrowright') || keys.has('d')) dx += s;
  if (keys.has('arrowup') || keys.has('w')) dy -= s;
  if (keys.has('arrowdown') || keys.has('s')) dy += s;
  if (dx || dy) nudgeScreen(dx, dy);
}

// ---------- camera follow (lock onto a body) ----------
// Locking onto a body puts the camera in that body's reference frame. For moons and rocky
// planets the camera moves AND turns with it, so the body holds perfectly still on screen (a
// tidally locked moon's planet then hangs in one spot in its sky). For the sun and the gas
// giants the camera just rides along, so you can watch things orbit around them.
function followBody(id, { zoom, quiet, keepView } = {}) {
  const e = LOCK[id];
  cam.follow = id;
  setCamRot(0);
  cam.a0 = e.frame === 'rotating' ? e.pos()[2] : 0;     // the body's spin angle at the moment you lock on
  cam.zoom = clamp(zoom || (e.zoom ? e.zoom() : Math.min(cw, ch - 200) / (e.r() * 2.4)), CFG.zoomMin, CFG.zoomMax);
  cam.offX = 0; cam.offY = 30 / cam.zoom;              // nudge it up a little, clear of the bottom panels
  if (!keepView) { savedView = null; mapStage = 0; }
  applyFollow();
  if (!quiet) toast(`Locked onto ${e.name}. Press ${e.key ? e.key.toUpperCase() + ' or ' : ''}Esc to let go.`);
}
const followMoon = () => followBody('moon');
const followVulcan = () => followBody('vulcan');
const followSun = () => followBody('sun');

// lock onto your world: back to the normal frame (the game is centred on your world), showing the whole disk
function lockWorld() {
  stopFollow();
  setCamRot(0);
  cam.zoom = fitZoom(); cam.x = DISK.cx; cam.y = DISK.cy + 36 / cam.zoom;
  savedView = null; mapStage = 1;
  toast('Locked onto your world.');
}
// select a country and fly the camera to fit it
function flyToCountry(c) {
  if (!c) return;
  game.active = c.id;
  stopFollow();
  const [x0, y0, x1, y1] = c.box;
  const z = clamp(Math.min(cw / (x1 - x0 + 16), (ch - 230) / (y1 - y0 + 16)), 1.2, 24);
  cam.anim = { x0: cam.x, y0: cam.y, z0: cam.zoom, x1: (x0 + x1) / 2 + 0.5, y1: (y0 + y1) / 2 + 0.5, z1: z, t: 0 };
  toast(`${c.full} · ${fmtNum(c.people)} people · ${c.tiles} tiles`);
}
function stepCamAnim(dt) {
  const a = cam.anim;
  if (!a) return;
  a.t = Math.min(1, a.t + dt / 0.7);
  const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;   // ease in-out
  cam.x = a.x0 + (a.x1 - a.x0) * e; cam.y = a.y0 + (a.y1 - a.y0) * e;
  cam.zoom = a.z0 * Math.pow(a.z1 / a.z0, e);
  if (a.t >= 1) cam.anim = null;
}
function stopFollow() {
  if (!cam.follow) return;
  cam.follow = null;
  setCamRot(0);
}
// move the view by a WORLD-space delta (e.g. zoom-toward-cursor).
// While locked on, offsets live in the moon's frame, so turn the delta into that frame first.
function nudgeCam(dx, dy) {
  if (cam.follow) {
    cam.offX += dx * cam.cos - dy * cam.sin;
    cam.offY += dx * cam.sin + dy * cam.cos;
  } else { cam.x += dx; cam.y += dy; clampCam(); }
}
// move the view by a SCREEN-direction delta (keys), in tiles
function nudgeScreen(dx, dy) {
  if (cam.follow) { cam.offX += dx; cam.offY += dy; }
  else { cam.x += dx; cam.y += dy; clampCam(); }
}
function applyFollow() {
  const e = cam.follow && LOCK[cam.follow];
  if (!e) return;
  const [mx, my, a] = e.pos();
  if (e.frame !== 'rotating') { setCamRot(0); cam.x = mx + cam.offX; cam.y = my + cam.offY; return; }
  const spin = a - cam.a0;
  setCamRot(-spin);
  // the offset is fixed to the moon's surface, so it turns with the moon
  const c = Math.cos(spin), s = Math.sin(spin);
  cam.x = mx + cam.offX * c - cam.offY * s;
  cam.y = my + cam.offX * s + cam.offY * c;
}

// ======================================================================
// HUD
// ======================================================================
function iconFill() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = SVG[el.dataset.icon]; });
}
function buildMenu() {
  const wrap = $('build');
  wrap.innerHTML = '';
  // in unlock order, so the bar grows to the right as your empire grows
  for (const [type, b] of Object.entries(CFG.buildings).sort((a, b) => (a[1].unlock || 0) - (b[1].unlock || 0))) {
    const el = document.createElement('div');
    el.className = 'bbtn'; el.dataset.type = type;
    const cost = Object.entries(b.cost).map(([r, n]) =>
      `<span data-r="${r}" data-n="${n}">${SVG[RES_ICON[r]]}${n}</span>`).join('');
    el.innerHTML = `<div class="key">${b.key}</div><div class="tile">${SVG[type]}</div>
      <div class="name">${b.name}</div><div class="cost">${cost}</div>`;
    el.addEventListener('click', () => setTool(game.tool === type ? null : type));
    wrap.appendChild(el);
  }
  document.querySelector('#topbar .res.country').addEventListener('click', () => flyToCountry(activeCountry()));
  const pw = $('pct-buttons');
  for (const p of [10, 25, 50, 100]) {
    const el = document.createElement('div');
    el.className = 'pbtn'; el.textContent = p + '%'; el.dataset.p = p;
    el.addEventListener('click', () => setPct(p));
    pw.appendChild(el);
  }
  setPct(game.sendPct);
}
function setTool(t) {
  if (t && !isUnlocked(t)) return toast(`${CFG.buildings[t].name} unlocks when your empire reaches ${CFG.buildings[t].unlock} people`);
  game.tool = t;
  document.querySelectorAll('.bbtn').forEach(el => el.classList.toggle('sel', el.dataset.type === t));
  canvas.classList.toggle('building', !!t);
}
// the bottom bar only shows what you've unlocked
function refreshBuildBar() {
  document.querySelectorAll('.bbtn').forEach(el => { el.style.display = isUnlocked(el.dataset.type) ? '' : 'none'; });
}

// ---------- the build menu (E): everything, with what's still locked ----------
let menuOpen = false;
function toggleBuildMenu(force) {
  menuOpen = force === undefined ? !menuOpen : force;
  $('buildmenu').classList.toggle('show', menuOpen);
  if (menuOpen) renderBuildMenu();
}
function renderBuildMenu() {
  const C = activeCountry();
  $('bm-sub').textContent = `Your empire: ${fmtNum(game.population)} people (peak ${fmtNum(game.peakPop)}) · building in ${C ? C.short : '-'}`;
  const grid = $('bm-grid');
  grid.innerHTML = '';
  const list = Object.entries(CFG.buildings).sort((a, b) => (a[1].unlock || 0) - (b[1].unlock || 0));
  for (const [type, b] of list) {
    const open = isUnlocked(type);
    const el = document.createElement('div');
    el.className = 'bm-card' + (open ? '' : ' locked') + (game.tool === type ? ' sel' : '');
    const cost = Object.entries(b.cost).map(([r, n]) =>
      `<span class="${C && C.res[r] < n ? 'no' : ''}">${SVG[RES_ICON[r]]}${n}</span>`).join('');
    el.innerHTML = `<div class="tile">${SVG[type]}</div>
      <div class="bm-body"><div class="bm-name">${b.name}${open ? ` <span class="bm-key">${b.key}</span>` : ''}</div>
      <div class="bm-desc">${b.desc || ''}</div>
      <div class="bm-foot"><div class="cost">${cost}</div>
      <div class="bm-status">${open ? (b.cap ? `+${b.cap} capacity` : b.gen ? `+${b.gen} MW` : b.workers ? `${b.workers} workers` : 'Unlocked') : `🔒 unlocks at ${b.unlock} people`}</div></div></div>`;
    if (open) el.addEventListener('click', () => { setTool(type); toggleBuildMenu(false); });
    grid.appendChild(el);
  }
}

function setPct(p) {
  game.sendPct = p;
  document.querySelectorAll('.pbtn').forEach(el => el.classList.toggle('on', +el.dataset.p === p));
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function updateHud() {
  const C = activeCountry();
  const alive = game.countries.filter(c => c.alive).length;
  $('val-country').textContent = C.full;
  $('country-count').textContent = alive > 1 ? `${game.countries.filter(c => c.alive).indexOf(C) + 1} of ${alive}` : '';
  for (const r of ['wood', 'stone', 'iron']) {
    $('val-' + r).textContent = fmtNum(C.res[r]);
    const rate = C.rates[r];
    const el = $('rate-' + r);
    el.textContent = `${rate < 0 ? '' : '+'}${rate.toFixed(1)}/s`;
    el.classList.toggle('zero', rate === 0);
    el.classList.toggle('neg', rate < 0);
  }
  const M = C.mw, short = M.need > 0 && C.sat < 0.999;
  $('val-power').textContent = M.need || M.max ? `${fmtNum(M.need)} / ${fmtNum(M.max)} MW` : '-';
  $('val-power').classList.toggle('short', short);
  $('rate-power').textContent = short ? `${Math.round(C.sat * 100)}% POWERED` : M.need ? 'OK' : '';
  $('rate-power').classList.toggle('neg', short);
  $('val-terr').textContent = (game.ownedCount / game.landTiles * 100).toFixed(1) + '%';
  $('val-time').textContent = fmtTime(game.time);
  $('val-view').textContent = cam.follow ? (mapStage === 3 ? 'Solar system' : LOCK[cam.follow].short)
    : cam.zoom < orbitZoom() * 0.6 ? 'Solar' : cam.zoom >= CFG.detailZoom ? 'Detail' : cam.zoom >= CFG.cityZoom ? 'Region'
    : cam.zoom > fitZoom() * 0.8 ? 'Map' : 'Orbit';
  $('people-lbl').textContent = alive > 1 ? `PEOPLE · EMPIRE ${fmtNum(game.population)}` : 'PEOPLE';
  $('val-people').textContent = `${fmtNum(C.people)} / ${fmtNum(C.cap)}`;
  $('people-fill').style.width = (C.cap ? clamp(C.people / C.cap, 0, 1) * 100 : 0) + '%';
  $('people-rate').textContent = C.growth > 0 ? `+${C.growth.toFixed(1)} / sec` : (C.people >= C.cap - 0.5 ? 'Full' : '');
  $('send-n').textContent = `= ${sendFrom(C)} people`;
  $('bar-note').textContent = C.pw.workers
    ? `${fmtNum(Math.min(C.people, C.pw.workers))} at work${C.staff < 0.999 ? ` (need ${C.pw.workers})` : ''} · regrows fastest at half full`
    : 'regrows fastest at half full';
  $('bar-note').classList.toggle('neg', C.staff < 0.999);
  document.querySelectorAll('.bbtn .cost span').forEach(el => {
    el.classList.toggle('no', C.res[el.dataset.r] < +el.dataset.n);
  });
  updateHover();
}

function updateHover() {
  const tip = $('tooltip');
  if (mouse.in) {
    const [wx, wy] = toWorld(mouse.x, mouse.y);
    const body = bodyUnder(wx, wy);
    if (body) {
      $('hover-info').textContent = body.info(wx, wy) + (cam.follow === body.id ? '' : ' · click to lock on');
      tip.style.display = 'none';
      return;
    }
    if (worldLockable() && overWorld(wx, wy)) {
      $('hover-info').textContent = 'Your world · click to lock on';
      tip.style.display = 'none';
      return;
    }
  }
  const t = mouse.in ? hoverTile() : null;
  if (!t) { $('hover-info').innerHTML = '&nbsp;'; tip.style.display = 'none'; return; }
  const b = biome[t.i];
  let info = BIOME_NAME[b];
  if (b === ICE) info += ' · the edge of the world';
  if (isLand(t.i)) {
    info += ` · ${tileCost(t.i)} people/tile`;
    if (depositOf[t.i] >= 0) info += ` · ${deposits[depositOf[t.i]].type}`;
    if (building[t.i]) info += ` · ${CFG.buildings[buildingAt(t.i).type].name}`;
    else if (depositOf[t.i] >= 0 && !deposits[depositOf[t.i]].tiles.some(k => building[k]))
      info += ` · nobody works it yet: build a ${deposits[depositOf[t.i]].type === 'forest' ? "logger's cabin" : "miner's camp"}`;
    if (owner[t.i]) { const c = countryAt(t.i); if (c) info += ` · ${c.full}${c.supply > 0 ? ' (new colony)' : ''}`; }
  }
  $('hover-info').textContent = info;

  const placeTip = (html, bad) => {
    tip.innerHTML = html;
    tip.classList.toggle('bad', bad);
    tip.style.display = 'block';
    tip.style.left = Math.min(mouse.x + 18, cw - 290) + 'px';
    tip.style.top = Math.min(mouse.y + 18, ch - 120) + 'px';
  };

  if (!game.tool && blueprint) {
    const plan = pastePlan(t.x, t.y), n = blueprint.items.length;
    const costTxt = Object.entries(plan.cost).map(([r, v]) => `${v} ${r}`).join(' · ') || 'nothing';
    const miss = missingFor(plan.cost, countryAt(t.i) || activeCountry());
    placeTip(`<div class="t">Paste ${n} house${n > 1 ? 's' : ''}: press C</div>
      <div class="${plan.fit === n ? 'g' : 'r'}">${plan.fit} of ${n} fit here</div>
      <div class="d">Cost: ${costTxt}</div>
      ${miss ? `<div class="r">Not enough ${miss} for all of them</div>` : ''}
      <div class="d">Click or Esc to clear the selection</div>`, plan.fit === 0 || !!miss);
    return;
  }

  if (!game.tool) { tip.style.display = 'none'; return; }
  const type = game.tool, bdef = CFG.buildings[type];
  const why = canBuild(t.i, type);
  const plan = planFor(t.i, type);
  const cost = totalCost(type, plan, t.i);
  const TC = countryAt(t.i);
  const miss = missingFor(cost, TC || activeCountry());
  const costTxt = Object.entries(cost).map(([r, n]) => `${n} ${r}`).join(' · ');
  const have = !why && building[t.i] ? buildingAt(t.i).type : null;
  let html = `<div class="t">${have ? `Upgrade ${CFG.buildings[have].name} → ${bdef.name}` : `Place ${bdef.name}`}</div>`;
  if (bdef.cap) {
    html += `<div class="g">+${bdef.cap - (have ? CFG.buildings[have].cap : 0)} people capacity${TC ? ' in ' + TC.short : ''}</div>`;
    if (!have && bdef.from) html += `<div class="d">Cheaper: click a ${CFG.buildings[bdef.from].name} to upgrade it</div>`;
    if (bdef.use) html += `<div class="d">Uses ${bdef.use} MW; without power it holds ${bdef.cap - bdef.capPowered}</div>`;
  } else if (plan) {
    if (plan.path) {
      html += type === 'station'
        ? `<div class="g">Rail link: ${plan.tiles} tiles of track to your nearest station</div>`
        : `<div class="g">Sea route: ${plan.tiles} tiles to your nearest port</div>`;
    } else html += `<div class="d">${plan.note}</div>`;
  } else if (bdef.gen) {
    html += `<div class="g">+${bdef.gen} MW power${TC ? ' for ' + TC.short : ''}</div>`;
    if (type === 'burner') html += `<div class="d">Burns up to ${CFG.power.burnerWood} wood/s, only as much as is needed</div>`;
  } else if (type === 'rig' || bdef.on) {
    if (depositOf[t.i] >= 0) {
      const d = deposits[depositOf[t.i]], n = d.tiles.filter(k => owner[k] && countryOf[k] === countryOf[t.i]).length;
      const mult = type === 'rig' ? CFG.power.rigMult : 1;
      html += `<div class="g">${(n * mult * CFG.prodPerTile[d.type]).toFixed(1)} ${DEP_RES[d.type]}/s from this deposit (${n} tiles)</div>`;
    } else html += `<div class="d">Must go on ${type === 'rig' ? 'a resource deposit' : bdef.on.join(' or ')}</div>`;
    html += type === 'rig' ? `<div class="d">Uses ${bdef.use} MW and frees the workers; no power, no output</div>`
      : `<div class="d">Employs ${bdef.workers} people</div>`;
  } else if (type === 'port') html += `<div class="d">Must be on the coast. Links to your other ports by sea.</div>`;
  else html += `<div class="d">Links to your nearest station by rail.</div>`;
  html += `<div class="d">Cost: ${costTxt}${plan && plan.extra ? ' (incl. track)' : ''}${TC ? ', paid by ' + TC.short : ''}</div>`;
  if (why) html += `<div class="r">${why}</div>`;
  else if (miss) html += `<div class="r">Not enough ${miss}</div>`;
  tip.innerHTML = html;
  tip.classList.toggle('bad', !!(why || miss));
  tip.style.display = 'block';
  tip.style.left = Math.min(mouse.x + 18, cw - 290) + 'px';
  tip.style.top = Math.min(mouse.y + 18, ch - 120) + 'px';
}

function drawBuildPreview(z) {
  if (!game.tool || !mouse.in) return;
  const t = hoverTile();
  if (!t) return;
  const type = game.tool;
  const plan = planFor(t.i, type);
  const ok = !canBuild(t.i, type) && !missingFor(totalCost(type, plan, t.i), countryAt(t.i) || activeCountry());
  if (plan && plan.path) strokeRoute(plan.path, type === 'station' ? 'rail' : 'sea', z, true);
  const [sx, sy] = toScreen(t.x, t.y);
  ctx.fillStyle = ok ? 'rgba(123,211,137,0.3)' : 'rgba(255,122,107,0.3)';
  ctx.fillRect(sx, sy, z, z);
  ctx.strokeStyle = ok ? '#7bd389' : '#ff7a6b'; ctx.lineWidth = 2;
  ctx.strokeRect(sx, sy, z, z);
  if (z >= CFG.cityZoom) drawSprite(type, t.x + 0.5, t.y + 0.5, z * 1.3, 0.6);
}

// ======================================================================
// main loop
// ======================================================================
function init() {
  resize();
  window.addEventListener('resize', resize);
  // let the "Generating world" screen paint before the heavy work starts
  setTimeout(start, 40);
}

function start() {
  const t0 = performance.now();
  generateWorld();
  paintTerrain();
  paintMoon();
  paintSun();
  paintVulcan();
  for (const b of Object.values(BODY)) b.paint(b);
  makeStars();
  iconFill();
  buildMenu();
  checkUnlocks(true);
  cam.x = spawn.x + 0.5; cam.y = spawn.y + 0.5;
  window.__game.genMs = Math.round(performance.now() - t0);
  const ld = $('loading');
  if (ld) ld.remove();
  toast(`Map seed ${SEED} · this seed's far planet: ${SEED_PLANET.name}, a ${SEED_PLANET.kind === 'gas' ? 'gas giant' : 'rocky world'} (press G to visit)`);

  const step = 1 / CFG.tickHz;
  let last = performance.now(), acc = 0, hudT = 0;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= step) { tick(step); acc -= step; }
    panKeys(dt);
    stepCamAnim(dt);
    applyFollow();
    render();
    hudT += dt;
    if (hudT > 0.1) { updateHud(); hudT = 0; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// handy for debugging/testing in the browser console
window.__game = { game, cam, CFG, SEED, tick, updateHud, liveCountry, countryAt, activeCountry, nearestCountryTo, countryOf, isUnlocked, toggleBuildMenu, startPush, SEED_PLANET, planetRecipe, BODY, LOCK, followBody, genericPos, genericBiomeAt, moonPos, sunPos, vulcanPos, followVulcan, vulcanBiomeAt, vulcanBiome, followSun, followMoon, lockWorld, moonBiomeAt, moonBiome, applyFollow, toWorld, toScreen, tryBuild, launchExpedition, recomputeNetwork, idx, biome, owner, landmass, isCutOff, isCoastal, OCEAN, depositOf, deposits, canBuild };
init();
