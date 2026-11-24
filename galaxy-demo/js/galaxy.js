// Galaxy and solar-system generation: pure functions of (seed, RULES). Runs once at load, in milliseconds.
// Seed tree: galaxy seed -> star seed -> planet seed -> moon seed. Planet surfaces are generated later,
// on demand, from the planet seed (terrain.js).
import { RULES } from './rules.js?v=20261124014027';
import { hash32, mulberry32, range, irange, gauss, pickWeighted, makeName, roman } from './rng.js?v=20261124014027';

const TAU = Math.PI * 2;

// one random point of the galaxy's star density, for a given component. Also used to paint the dust.
export function galaxyPoint(r, comp) {
  const G = RULES.galaxy, R = G.radius;
  if (comp === 'bulge') {
    const rr = Math.abs(gauss(r)) * G.bulgeRadius * 0.55, a = r() * TAU;
    return [Math.cos(a) * rr, Math.sin(a) * rr * 0.82];
  }
  if (comp === 'arms') {
    const arm = Math.floor(r() * G.arms);
    const r0 = G.bulgeRadius * 0.6;
    let rr;
    do { rr = r0 + (-Math.log(1 - r() * 0.999)) * R * 0.3; } while (rr > R);
    const theta = (arm / G.arms) * TAU + G.armTurns * TAU * Math.log(rr / r0) / Math.log(R / r0);
    const spread = G.armSpread * rr;
    const off = gauss(r) * spread, along = gauss(r) * spread * 0.6;
    // the arm's tangent direction for a log spiral, roughly perpendicular to the radius
    const cx = Math.cos(theta), cy = Math.sin(theta);
    return [cx * (rr + off) - cy * along, cy * (rr + off) + cx * along];
  }
  const rr = Math.sqrt(r()) * R * 0.95, a = r() * TAU;
  return [Math.cos(a) * rr, Math.sin(a) * rr];
}

function pickComponent(r) {
  const s = RULES.galaxy.share, u = r();
  return u < s.bulge ? 'bulge' : u < s.bulge + s.arms ? 'arms' : 'disk';
}

export function heatAt(starType, orbit) {
  const S = RULES.stars[starType];
  return Math.pow(S.luminosity, 0.25) * Math.sqrt(RULES.scale.homeOrbit / orbit);
}
export function zoneFor(heat) { return RULES.zones.find(z => heat > z.above); }
export function heatWord(heat) {
  return heat > 1.75 ? 'Scorching' : heat > 1.25 ? 'Hot' : heat > 0.8 ? 'Temperate' : heat > 0.55 ? 'Cold' : 'Frozen';
}
// a planet's surface is a square map with the disk inscribed: W tiles across, relative to Home
export function surfaceSize(r, homeTiles = RULES.scale.homeTiles) {
  const W = Math.max(96, Math.min(16384, Math.round(r * homeTiles / 32) * 32));
  return { W, H: W };
}
function orbitPeriod(orbit, mass) {
  const S = RULES.scale;
  return S.yearAtHome * Math.pow(orbit / S.homeOrbit, 1.5) / Math.sqrt(mass);
}

let nextId = 0;
function makeBody(o) {
  const P = RULES.planetTypes[o.type];
  const b = {
    uid: nextId++, id: o.id, name: o.name, kind: o.kind, type: o.type, typeName: P.name,
    star: o.star, parent: o.parent, r: o.r, orbit: o.orbit, orbit0: o.orbit, period: o.period, phase: o.phase,
    spin: o.spin, spinOffset: o.spinOffset, seed: o.seed, heat: o.heat, moons: [], home: !!o.home,
    giant: !!P.giant, surface: P.giant ? null : surfaceSize(o.r), settle: 0, rings: null, palette: null,
    atmo: P.atmo || null, dot: P.dot || null, _f: -1, _x: 0, _y: 0,
  };
  return b;
}

function settleCount(r, type, home) {
  const S = RULES.settlements;
  if (home) return S.homeCount;
  const c = S.civChance[type] || 0;
  return r() < c ? irange(r, S.count[0], S.count[1]) : 0;
}

function addGiantLooks(b, r, opts = {}) {
  const P = RULES.planetTypes[b.type];
  const names = RULES.gasPaletteFor[b.type];
  b.palette = RULES.gasPalettes[opts.palette || names[Math.floor(r() * names.length)]];
  if (opts.rings !== undefined ? opts.rings : r() < P.rings) {
    b.rings = { inner: 1.3 + r() * 0.15, outer: 1.85 + r() * 0.35, gap: 0.55 + r() * 0.2 };
  }
  b.dot = b.palette[0];
}

function genMoons(planet, r, star, count, defs) {
  const S = RULES.stars[star.type], M = RULES.moons;
  let orbit = planet.r * (planet.giant ? 2.3 : 3.2) + (planet.rings ? planet.r * planet.rings.outer * 0.35 : 0);
  for (let j = 0; j < count; j++) {
    const def = defs ? defs[j] : null;
    const type = def ? def.type : pickWeighted(r, planet.heat > 1.25 ? M.hot : M.cold);
    const size = def ? def.size : Math.min(range(r, M.size[0], M.size[1]), planet.r * 0.45);
    const mo = def ? planet.r * def.orbit : orbit;
    const seed = hash32(planet.seed, j + 1, 7);
    const mr = mulberry32(seed);
    const m = makeBody({
      id: `${planet.id}.${j}`, name: def ? def.name : `${planet.name} ${String.fromCharCode(97 + j)}`,
      kind: 'moon', type: RULES.planetTypes[type] ? type : 'barren', star, parent: planet, r: size, orbit: mo,
      period: (def && def.retro ? -1 : 1) * 40 * Math.pow(mo / planet.r / 3, 1.5) * (planet.giant ? 1 : 1.6),
      phase: mr() * TAU, spin: 1e9, spinOffset: mr() * TAU, seed, heat: planet.heat,
    });
    planet.moons.push(m);
    orbit += planet.r * (0.9 + r() * 0.9) + size * 2;
  }
}

function genSystem(star, galaxyRand) {
  const S = RULES.stars[star.type];
  const r = mulberry32(star.seed);
  star.planets = [];
  if (star.isSun) return genSun(star, galaxyRand);
  const n = irange(r, S.planets[0], S.planets[1]);
  let a = S.firstOrbit * range(r, 0.85, 1.2);
  let prevGiant = false;
  for (let i = 0; i < n; i++) {
    const heat = heatAt(star.type, a);
    let type;
    if (heat < RULES.giantHeat && r() < S.giants) type = heat < RULES.iceGiantHeat && r() < 0.6 ? 'icegiant' : 'gas';
    else type = pickWeighted(r, zoneFor(heat).types);
    const P = RULES.planetTypes[type];
    if (P.giant && !prevGiant && i > 0) a *= 1.15;              // giants clear a wider lane
    const seed = hash32(star.seed, i + 1);
    const pr = mulberry32(seed);
    const b = makeBody({
      id: `${star.idx}.${i}`, name: `${star.name} ${roman(i)}`, kind: 'planet', type, star, parent: star,
      r: range(pr, P.size[0], P.size[1]), orbit: a, period: orbitPeriod(a, S.mass), phase: pr() * TAU,
      spin: P.giant ? range(pr, 30, 60) : range(pr, 70, 220), spinOffset: pr() * TAU, seed, heat,
    });
    if (b.giant) addGiantLooks(b, pr);
    b.settle = settleCount(pr, type, false);
    let moons;
    if (b.giant) {
      const range2 = RULES.moons[type];
      moons = irange(pr, range2[0], range2[1]) + (star.type === 'blue' ? 1 : 0);
    } else {
      const u = pr();
      moons = u < RULES.moons.rocky.two ? 2 : u < RULES.moons.rocky.two + RULES.moons.rocky.one ? 1 : 0;
    }
    genMoons(b, pr, star, moons);
    star.planets.push(b);
    prevGiant = b.giant;
    a *= range(r, S.spacing[0], S.spacing[1]) * (b.giant ? 1.12 : 1);
  }
}

function genSun(star, galaxyRand) {
  const SUN = RULES.sun, S = RULES.stars.yellow;
  SUN.planets.forEach((def, i) => {
    const seed = hash32(star.seed, i + 1);
    const pr = mulberry32(seed);
    let type = def.type, name = def.name, size = def.size;
    if (def.procedural) {
      type = pickWeighted(pr, SUN.farPlanetTypes);
      name = makeName(galaxyRand);
      const P = RULES.planetTypes[type];
      size = range(pr, P.size[0], P.size[1]);
    }
    const P = RULES.planetTypes[type];
    const heat = heatAt('yellow', def.orbit);
    const b = makeBody({
      id: `${star.idx}.${i}`, name, kind: 'planet', type, star, parent: star, r: size, orbit: def.orbit,
      period: orbitPeriod(def.orbit, S.mass), phase: pr() * TAU,
      spin: P.giant ? range(pr, 30, 60) : range(pr, 90, 200), spinOffset: pr() * TAU, seed, heat, home: def.home,
    });
    if (b.giant) addGiantLooks(b, pr, { palette: def.palette, rings: def.procedural ? undefined : !!def.rings });
    b.settle = settleCount(pr, type, def.home);
    if (def.moons) genMoons(b, pr, star, def.moons.length, def.moons);
    else if (def.procedural) genMoons(b, pr, star, b.giant ? irange(pr, 1, 3) : (pr() < 0.4 ? 1 : 0));
    star.planets.push(b);
  });
}

export function generateGalaxy(seed) {
  const t0 = performance.now();
  nextId = 0;
  const G = RULES.galaxy;
  const r = mulberry32(hash32(seed, RULES.version, 1));
  const cell = G.minSpacing, grid = new Map(), stars = [];
  const key = (x, y) => (Math.floor(x / cell) + 1000) * 4096 + Math.floor(y / cell) + 1000;
  const fits = (x, y) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get((cx + dx + 1000) * 4096 + cy + dy + 1000);
      if (list) for (const s of list) if ((s.x - x) ** 2 + (s.y - y) ** 2 < cell * cell) return false;
    }
    return true;
  };
  for (let tries = 0; stars.length < G.stars && tries < G.stars * 80; tries++) {
    const comp = pickComponent(r);
    const [x, y] = galaxyPoint(r, comp);
    if (x * x + y * y > G.radius * G.radius || !fits(x, y)) continue;
    const chance = {};
    for (const t in RULES.stars) chance[t] = RULES.stars[t].chance[comp];
    const s = { idx: stars.length, x, y, comp, type: pickWeighted(r, chance), name: '', seed: 0, planets: null, outer: 0, isSun: false };
    stars.push(s);
    const k = key(x, y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  // the Sun: the star nearest to a point in an arm, sunRadius of the way out
  const sr = G.sunRadius * G.radius, r0 = G.bulgeRadius * 0.6;
  const st = G.armTurns * TAU * Math.log(sr / r0) / Math.log(G.radius / r0) + TAU / G.arms;
  const tx = Math.cos(st) * sr, ty = Math.sin(st) * sr;
  let sun = stars[0], best = Infinity;
  for (const s of stars) { const d = (s.x - tx) ** 2 + (s.y - ty) ** 2; if (d < best) { best = d; sun = s; } }
  sun.isSun = true; sun.type = 'yellow'; sun.name = RULES.sun.name;
  // names and seeds
  const used = new Set([sun.name]);
  for (const s of stars) {
    s.seed = hash32(seed, s.idx, RULES.version, 101);
    if (s.isSun) continue;
    let n;
    do n = makeName(r); while (used.has(n));
    used.add(n); s.name = n;
  }
  // systems
  const counts = { red: 0, yellow: 0, blue: 0, planets: 0, moons: 0, settled: 0 };
  for (const s of stars) {
    const S = RULES.stars[s.type];
    s.r = S.radius; s.color = S.color; s.mass = S.mass;
    genSystem(s, r);
    let outer = s.r * 4;
    for (const p of s.planets) {
      let reach = 0;
      for (const m of p.moons) reach = Math.max(reach, m.orbit + m.r);
      outer = Math.max(outer, p.orbit + Math.max(reach, p.r));
      counts.planets++; counts.moons += p.moons.length;
      if (p.settle) counts.settled++;
    }
    s.outer = outer;
    counts[s.type]++;
  }
  const bodies = [];
  for (const s of stars) for (const p of s.planets) { bodies.push(p); for (const m of p.moons) bodies.push(m); }
  return { seed, stars, sun, bodies, counts, ms: performance.now() - t0 };
}
