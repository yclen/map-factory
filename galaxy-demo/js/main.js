// Galaxy demo: a 1,000-star spiral galaxy you can zoom through continuously, down to the tiles of a planet.
// World positions are JS doubles in galaxy units; the camera is subtracted before anything reaches the GPU.
import { RULES } from './rules.js?v=20261125141207';
import { SKIN } from './skin.js?v=20261125141207';
import { generateGalaxy, galaxyPoint, heatWord, surfaceSize } from './galaxy.js?v=20261125141207';
import { itemTable } from './biomes.js?v=20261125141207';
import { buildAtlas, decorTables } from './art.js?v=20261125141207';
import { Renderer } from './renderer.js?v=20261125141207';
import { Labels } from './labels.js?v=20261125141207';
import { mulberry32, hash32 } from './rng.js?v=20261125141207';
import { BASE, BASE_NAME, OVER, RESOURCES, RESOURCE_NAME, SLOT_WALKER, SLOT_PIN, WATER } from './ids.js?v=20261125141207';
import { makeRocket, stepRocket, predictPath, orbitAround, conicPath } from './rocket.js?v=20261125141207';

const TAU = Math.PI * 2;
let SU = 1e-6;                  // galaxy units per Home radius: set by the distance ladder (applyScale)
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const SEED = (+params.get('seed') | 0) || RULES.galaxy.seed;

// ---------- setup ----------
// A browser can keep an old copy of index.html for a few minutes after a release while version.txt hands it the
// new code. If the page is missing anything this code needs, reload once to fetch the current page.
{
  const NEEDED = ['gl', 'labels', 'crumbs', 'perf', 'info', 'tip', 'bar', 'help', 'fatal', 'scale', 'rocketHud', 'touch',
    'btnHome', 'btnGalaxy', 'btnStress', 'btnPerf', 'btnHelp', 'btnScale', 'btnRocket', 'btnTerrain'];
  let tried = false;
  try { tried = sessionStorage.getItem('galaxyDemo.reloadForPage') === '1'; } catch (e) { /* no storage */ }
  if (NEEDED.some(id => !document.getElementById(id))) {
    if (!tried) {
      try { sessionStorage.setItem('galaxyDemo.reloadForPage', '1'); } catch (e) { /* no storage */ }
      location.reload();
    }
    throw new Error('This page is an older copy than the code; reloading to get the current one.');
  }
  try { sessionStorage.removeItem('galaxyDemo.reloadForPage'); } catch (e) { /* no storage */ }
}
const glCanvas = $('gl'), lblCanvas = $('labels');
let R;
try { R = new Renderer(glCanvas); }
catch (e) { $('fatal').hidden = false; $('fatal').textContent = 'This demo needs WebGL2. ' + e.message; throw e; }
glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); $('fatal').hidden = false; $('fatal').textContent = 'Graphics were reset. Reloading…'; setTimeout(() => location.reload(), 800); });
const labels = new Labels(lblCanvas);

const G = generateGalaxy(SEED);
for (const s of G.stars) { s.kind = 'star'; s._x = s.x; s._y = s.y; s.uid = 'star' + s.idx; }
const HOME = G.sun.planets.find(p => p.home);

// ---------- the distance ladder (rules.js scale, adjustable live in the Scale panel) ----------
// Home radius -> Home-Moon distance -> Home-Sun distance -> Sun to nearest star. Each rung is measured in the
// one below, so a change stretches everything above it. Galaxy units stay fixed, so the top rung sets how big
// solar systems are next to the gaps between stars.
const LADDER_KEYS = ['homeTiles', 'moonDistance', 'sunDistance', 'starDistance'];
const BASE_MOON = 6, BASE_SUN = RULES.scale.homeOrbit / BASE_MOON;   // the yardsticks generation used
const SCALE = {};
for (const k of LADDER_KEYS) SCALE[k] = RULES.scale[k];
try { Object.assign(SCALE, JSON.parse(localStorage.getItem('galaxyDemo.scale') || '{}')); } catch (e) { /* no storage */ }
// a shared link carries its own ladder (?ladder=homeTiles,moon,sun,star), which wins over this browser's settings
if (params.has('ladder')) {
  const v = params.get('ladder').split(',').map(Number);
  LADDER_KEYS.forEach((k, i) => { if (v[i] > 0) SCALE[k] = v[i]; });
  // adopt them as this browser's settings and tidy the address bar, so later slider moves stick on reload
  try { localStorage.setItem('galaxyDemo.scale', JSON.stringify(SCALE)); } catch (e) { /* no storage */ }
  const u = new URL(location.href); u.searchParams.delete('ladder'); history.replaceState(null, '', u);
}
const SUN_GAP = (() => {          // the Sun's nearest neighbour, in galaxy units
  let d = Infinity;
  for (const s of G.stars) if (s !== G.sun) d = Math.min(d, Math.hypot(s.x - G.sun.x, s.y - G.sun.y));
  return d;
})();
function applyScale() {
  const f1 = SCALE.moonDistance / BASE_MOON, f2 = SCALE.sunDistance / BASE_SUN;
  for (const st of G.stars) {
    let outer = st.r * 4;
    for (const p of st.planets) {
      p.orbit = p.orbit0 * f1 * f2;
      let reach = p.r;
      for (const m of p.moons) {
        m.orbit = Math.max(m.orbit0 * f1, p.r * (p.rings ? p.rings.outer + 0.2 : 1.25) + m.r * 1.5);
        reach = Math.max(reach, m.orbit + m.r);
      }
      outer = Math.max(outer, p.orbit + reach);
    }
    st.outer = outer;
  }
  SU = SUN_GAP / (SCALE.starDistance * SCALE.moonDistance * SCALE.sunDistance);
}
function applyHomeTiles() {
  for (const b of G.bodies) if (b.surface) b.surface = surfaceSize(b.r, SCALE.homeTiles);
}
applyHomeTiles();
applyScale();
const art = buildAtlas(SKIN);
R.makeAtlas(art.data);
R.water = [SKIN.base.DEEP.c, SKIN.base.SHALLOW.c];
R.setDecor(decorTables(SKIN));
// high-resolution props drawn from AI-generated sheets (tools/gen_props.py, tools/pack_props.py) replace the
// pixel-art props of the same kind once loaded; anything missing just keeps its pixel art
(async () => {
  const v = new URL(import.meta.url).search;            // this release's stamp, so a new atlas isn't served stale
  const meta = await (await fetch('props/props_hd.json' + v)).json();
  const img = new Image();
  img.src = 'props/props_hd.png' + v;
  await img.decode();
  const kinds = Object.keys(SKIN.props), hdK = new Int32Array(32).fill(-1);
  for (const [name, cell] of Object.entries(meta.kinds)) { const k = kinds.indexOf(name); if (k >= 0 && k < 32) hdK[k] = cell; }
  R.setHdProps(img, meta, hdK);
})().catch(e => console.warn('high-resolution props not loaded:', e));
// Biome designs from the Biome Builder (biome-builder/, saved into biomes/): each ground type's texture and the items that
// grow on it (trees, rocks, shrubs, grass), drawn as pictures. Without them the shader draws its own props, as before
let groundAvg = null;                                    // per ground id, its texture's average colour (far views)
(async () => {
  const v = new URL(import.meta.url).search;
  const res = await fetch('biomes/biomes.json' + v);
  if (!res.ok) return;
  const bake = await res.json();
  const load = async src => { const img = new Image(); img.src = src + v; await img.decode(); return img; };
  const [atlas, ...grounds] = await Promise.all([load('biomes/' + bake.atlas.file),
    ...bake.grounds.map(g => load('biomes/' + g.file))]);
  const K = new Int32Array(32).fill(-1), S = new Float32Array(32).fill(8), Rl = new Float32Array(32);
  bake.grounds.forEach((g, i) => { for (const id of g.ids) { K[id] = i; S[id] = g.scale; Rl[id] = g.relief || 0; } });
  R.setGroundTextures(grounds, bake.groundSize, K, S, Rl);
  if (bake.shadow) R.shadow = { ...R.shadow, ...bake.shadow };
  R.setItems(atlas, bake.atlas, itemTable(bake.templates, bake.cells));
  propMax = bake.propMax || 1;
  groundAvg = bake.avg;
  for (const p of [...pages.values()]) freePage(p);   // rebuild maps with the textures' colours for far views
  jobs.length = 0;
})().catch(e => console.warn('biome designs not loaded:', e));
// the new terrain look (hillshading, water, organic borders, colour variation) can be switched off to compare
let terrainFx = true;
try { terrainFx = localStorage.getItem('galaxyDemo.terrainFx') !== '0'; } catch (e) { /* no storage */ }
const tDust = performance.now();
const DUST_N = 256;
const dustTex = R.makeGlowTexture(buildDust(), DUST_N);
const dustMs = performance.now() - tDust;

function buildDust() {
  const N = DUST_N, acc = new Float32Array(N * N * 3), Rg = RULES.galaxy.radius, span = 2.2 * Rg;
  const r = mulberry32(hash32(SEED, 55));
  const cols = { bulge: [1.0, 0.8, 0.55], arms: [0.55, 0.66, 1.0], disk: [0.7, 0.66, 0.78] };
  for (let i = 0; i < 60000; i++) {
    const u = r(), comp = u < 0.24 ? 'bulge' : u < 0.84 ? 'arms' : 'disk';
    const [x, y] = galaxyPoint(r, comp);
    const fx = (x / span + 0.5) * N - 0.5, fy = (y / span + 0.5) * N - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    if (ix < 0 || iy < 0 || ix >= N - 1 || iy >= N - 1) continue;
    const c = cols[comp], w = comp === 'bulge' ? 1.6 : 1;
    const add = (px, py, k) => { const j = (py * N + px) * 3; acc[j] += c[0] * k * w; acc[j + 1] += c[1] * k * w; acc[j + 2] += c[2] * k * w; };
    add(ix, iy, (1 - ax) * (1 - ay)); add(ix + 1, iy, ax * (1 - ay)); add(ix, iy + 1, (1 - ax) * ay); add(ix + 1, iy + 1, ax * ay);
  }
  const tmp = new Float32Array(acc.length);
  const blur = (src, dst, dx, dy, rad) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = clamp(x + dx * k, 0, N - 1), yy = clamp(y + dy * k, 0, N - 1);
        s += src[(yy * N + xx) * 3 + ch];
      }
      dst[(y * N + x) * 3 + ch] = s / (2 * rad + 1);
    }
  };
  blur(acc, tmp, 1, 0, 2); blur(tmp, acc, 0, 1, 2);
  blur(acc, tmp, 1, 0, 1); blur(tmp, acc, 0, 1, 1);
  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = 255 * (1 - Math.exp(-acc[i * 3 + ch] * 0.3));
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------- sizing and render quality ----------
let cw = 0, ch = 0, scale = 1, labelDpr = 1, quality = 1;
const coarse = matchMedia('(pointer: coarse)').matches;
function resize() {
  cw = innerWidth; ch = innerHeight;
  const dpr = devicePixelRatio || 1;
  labelDpr = Math.min(dpr, 2);
  scale = Math.max(0.75, Math.min(dpr, coarse ? 1.75 : 2) * quality);
  glCanvas.style.width = lblCanvas.style.width = cw + 'px';
  glCanvas.style.height = lblCanvas.style.height = ch + 'px';
  R.resize(Math.round(cw * scale), Math.round(ch * scale));
  lblCanvas.width = Math.round(cw * labelDpr); lblCanvas.height = Math.round(ch * labelDpr);
}
addEventListener('resize', resize);
resize();

// ---------- time and positions ----------
let frameNo = 0, simT = 0;
function place(b) {
  // stars don't move; rockets are placed by their flight sim (they have no orbit to work out)
  if (b.kind === 'star' || b.kind === 'rocket' || b._f === frameNo) return;
  const par = b.parent;
  place(par);
  const a = b.phase + simT * TAU / b.period;
  b._x = par._x + Math.cos(a) * b.orbit * SU;
  b._y = par._y + Math.sin(a) * b.orbit * SU;
  b._f = frameNo;
}

// ---------- camera ----------
// focus = the body the camera rides along with; ox/oy = offset from it (gu); logZ = log2(css px per gu)
const cam = { focus: null, ox: 0, oy: 0, logZ: 0, tz: 0, ax: 0, ay: 0, fly: null, vx: 0, vy: 0 };
const minDim = () => Math.min(cw, ch);
const zoom = () => 2 ** cam.logZ;
function centerWorld() {
  const f = cam.focus;
  if (f) place(f);
  return [(f ? f._x : 0) + cam.ox, (f ? f._y : 0) + cam.oy];
}
const minLogZ = () => Math.log2(minDim() / (2.5 * RULES.galaxy.radius));
function maxLogZ(f) {
  const big = Math.max(cw, ch);
  if (!f) return Math.log2(1e7);
  if (f.kind === 'rocket') return maxLogZ(HOME);
  if (f.kind === 'star') return Math.log2(1.4 * big / (f.r * SU));
  if (f.giant) return Math.log2(1.5 * big / (f.r * SU));
  return Math.log2(56 / (2 * f.r * SU / f.surface.W));     // a tile 56 px wide at most
}
const bodyRpx = (b, z = zoom()) => b.r * SU * z;

function refocus(b) {
  const [cx, cy] = centerWorld();
  cam.focus = b;
  if (b) { place(b); cam.ox = cx - b._x; cam.oy = cy - b._y; } else { cam.ox = cx; cam.oy = cy; }
}
function isAncestor(a, b) { for (let p = b; p; p = p.parent) if (p === a) return true; return false; }

function applyZoom(nz, ax, ay) {
  nz = clamp(nz, minLogZ(), maxLogZ(cam.focus));
  const z0 = zoom(), z1 = 2 ** nz;
  const dx = ax - cw / 2, dy = ay - ch / 2;
  cam.ox += dx / z0 - dx / z1; cam.oy += dy / z0 - dy / z1;
  cam.logZ = nz;
}
function panBy(dx, dy) { const z = zoom(); cam.ox -= dx / z; cam.oy -= dy / z; }
// zooming in toward something grabs it, so the camera rides along with that planet or star
function autoFocus(x, y) {
  const b = pickAt(x, y);
  if (!b || b === cam.focus || isAncestor(b, cam.focus)) return;
  // only grab it once it's big enough that updateFocus won't let go again straight away
  const z = zoom();
  const span = b.kind === 'star' ? b.outer * SU * z : b.orbit * SU * z;
  if (span >= (b.kind === 'star' ? 8 : 30)) refocus(b);
}
// zooming or panning away from the focus hands the camera back to its parent (planet -> star -> galaxy)
function updateFocus() {
  const f = cam.focus;
  if (!f || cam.fly || f.kind === 'rocket') return;
  const z = zoom(), [cx, cy] = centerWorld();
  place(f);
  const away = Math.hypot((f._x - cx) * z, (f._y - cy) * z) - bodyRpx(f) * (f.rings ? f.rings.outer : 1);
  let out = away > Math.max(cw, ch) * 0.9;                    // the body has left the screen
  if (f.kind === 'moon') out = out || f.orbit * SU * z < 22;
  else if (f.kind === 'planet') out = out || f.orbit * SU * z < 26;
  else out = out || f.outer * SU * z < 6;
  if (out) refocus(f.parent || null);
}

// van Wijk & Nuij smooth zoom-and-pan path (the same maths as d3.interpolateZoom)
function interpolateZoom(p0, p1) {
  const rho = Math.SQRT2, rho2 = 2, rho4 = 4;
  const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1, dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  let f, S;
  if (d2 < 1e-24) {
    S = Math.log(w1 / w0) / rho;
    f = t => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    // -asinh(b) = log(sqrt(b^2 + 1) - b), but stays accurate for the huge b of a planet-to-galaxy flight
    const r0 = -Math.asinh(b0), r1 = -Math.asinh(b1);
    S = (r1 - r0) / rho;
    f = t => {
      const s = t * S, c0 = Math.cosh(r0);
      const u = w0 / (rho2 * d1) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [ux0 + u * dx, uy0 + u * dy, w0 * c0 / Math.cosh(rho * s + r0)];
    };
  }
  f.duration = Math.abs(S) * 1000;
  return f;
}
function fitWidth(b) {
  const k = cw / minDim();
  if (!b) return 2.3 * RULES.galaxy.radius * k;
  if (b.kind === 'star') return b.outer * SU * 2.3 * k;
  if (b.kind === 'rocket') return 260 * tileSu() * SU * k;      // about 260 tiles across
  let reach = b.r * (b.rings ? b.rings.outer : 1) / 0.42;
  for (const m of b.moons) reach = Math.max(reach, (m.orbit + m.r) * 1.15);
  if (b.moons.length === 0) reach = b.r / 0.42;
  return reach * 2 * SU * k;
}
// width: how much to show when it arrives (world units across); defaults to the body and its moons
function flyTo(b, width) {
  cam.vx = cam.vy = 0;
  refocus(b);
  const w0 = cw / zoom(), w1 = width || fitWidth(b);
  const f = interpolateZoom([cam.ox, cam.oy, w0], [0, 0, w1]);
  cam.fly = { f, end: [0, 0, w1], t0: performance.now(), dur: clamp(f.duration * 0.42, 700, 3200) };
  if (b && b.kind !== 'rocket') select(b);
}
function stepFly(now) {
  const F = cam.fly;
  if (!F) return;
  const t = clamp((now - F.t0) / F.dur, 0, 1), e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  let [x, y, w] = F.f(e);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0)) { [x, y, w] = F.end; cam.fly = null; }   // never leave the camera broken
  cam.ox = x; cam.oy = y; cam.logZ = cam.tz = Math.log2(cw / w);
  if (t >= 1) cam.fly = null;
}

// ---------- planet maps: a pyramid of chunks, built by background workers, kept within a memory budget ----------
// Level 0 is the whole disk at up to 256 samples across, always loaded for anything drawn as a sphere. Each level
// up doubles the detail and is split into 256 x 256 chunks; the top level has one sample per tile. Only the chunks
// on screen, at the detail the zoom needs, get built; chunks nobody looks at fall out of the cache.
const PAGE = 256;
const pages = new Map();          // key -> chunk
const jobs = [];                  // chunks waiting for a worker
let jobSeq = 0, mapsMs = 0, mapsBuilt = 0;
const workers = [];
const NW = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3);
for (let i = 0; i < NW; i++) {
  const w = new Worker(new URL('./mapworker.js?v=20261125141207', import.meta.url), { type: 'module' });
  w.busy = null;
  w.onmessage = e => { onPage(e.data); w.busy = null; pump(); };
  w.onerror = e => { console.error('map worker', e.message); w.busy = null; };
  workers.push(w);
}
const bodyByUid = new Map(G.bodies.map(b => [b.uid, b]));
function descOf(b) {
  return { id: b.uid, seed: b.seed, type: b.type, r: b.r, W: b.surface.W, heat: b.heat, settle: b.settle, home: b.home, avg: groundAvg };
}
// the detail levels of a body's map: samples across at each level, top level = tiles across
function levelsOf(b) {
  const W = b.surface.W;
  if (!b.lv || b.lv.W !== W) {
    const Lmax = Math.max(0, Math.ceil(Math.log2(W / PAGE)));
    const N = [];
    for (let L = 0; L <= Lmax; L++) N.push(Math.ceil(W / 2 ** (Lmax - L)));
    b.lv = { W, Lmax, N };
  }
  return b.lv;
}
function wantPage(b, L, px, py, pri) {
  const N = levelsOf(b).N[L], key = `${b.uid}/${N}/${L}/${px}/${py}`;
  let p = pages.get(key);
  if (!p) {
    const x0 = px * PAGE, y0 = py * PAGE, sx = Math.min(PAGE, N - x0), sy = Math.min(PAGE, N - y0);
    p = { key, b, L, px, py, N, x0, y0, sx, sy, W: sx, H: sy, uv: [x0 / N, y0 / N, sx / N, sy / N],
      ids: null, col: null, fld: null, cpu: null, ready: false, used: frameNo, pri, bytes: 0 };
    pages.set(key, p); jobs.push(p);
  }
  p.used = frameNo; p.pri = pri;
  return p;
}
function pump() {
  for (const w of workers) {
    if (w.busy || !jobs.length) continue;
    let bi = -1, best = -Infinity;
    for (let i = 0; i < jobs.length; i++) {
      const score = jobs[i].pri - (frameNo - jobs[i].used) * 1e4;
      if (score > best) { best = score; bi = i; }
    }
    const p = jobs.splice(bi, 1)[0];
    w.busy = p;
    w.postMessage({ job: ++jobSeq, key: p.key, desc: descOf(p.b), N: p.N, x0: p.x0, y0: p.y0, sx: p.sx, sy: p.sy, L: p.L });
  }
}
function onPage(d) {
  mapsMs += d.ms; mapsBuilt++;
  const p = pages.get(d.key);
  if (!p) return;                                           // dropped while it was being built
  const b = p.b;
  p.ids = R.makeIdTexture(p.sx, p.sy); p.col = R.makeColorTexture(p.sx, p.sy); p.fld = R.makeColorTexture(p.sx, p.sy, true);
  R.uploadBand(p.ids, p.col, p.sx, 0, p.sy, d.ids, d.col, p.fld, d.fld);
  R.mipmap(p.col, p.fld);
  if (d.props) { p.props = R.makePropBuffer(d.props); p.small = R.makePropBuffer(d.small); }   // item spots
  p.ready = true;
  if (p.L === 0 || p.L === levelsOf(b).Lmax) p.cpu = d.ids;         // for hover info and placing walkers
  p.bytes = p.sx * p.sy * (4 + 8 * 1.34) + (p.cpu ? p.sx * p.sy * 4 : 0) + (p.props ? p.props.bytes + p.small.bytes : 0);
  if (p.L === 0) { b.counts = d.counts; b.settlements = d.settlements; b.base = p; if (b === cam.focus) walkersDirty = true; }
}
function freePage(p) {
  if (p.ids) R.freeMap(p.ids, p.col, p.fld, p.sx, p.sy);
  if (p.props) { R.freePropBuffer(p.props); R.freePropBuffer(p.small); }
  pages.delete(p.key);
  if (p.b.base === p) p.b.base = null;
}
// keep chunks within a memory budget, oldest first; level-0 maps are tiny, so up to 200 of them stay
function evictPages() {
  if (frameNo % 10) return;
  // chunks requested while zooming past, and not wanted since, are dropped before a worker spends time on them
  for (let i = jobs.length - 1; i >= 0; i--) if (frameNo - jobs[i].used > 20) { pages.delete(jobs[i].key); jobs.splice(i, 1); }
  const budget = (coarse ? 48 : 160) * 1048576;
  let total = 0, l0 = 0;
  const list = [];
  for (const p of pages.values()) if (p.ready) { total += p.bytes; if (p.L === 0) l0++; list.push(p); }
  if (total <= budget && l0 <= 200) return;
  list.sort((a, b) => a.used - b.used);
  for (const p of list) {
    if (frameNo - p.used < 30) break;                         // everything after this is in use
    if (p.L === 0 ? l0 <= 200 : total <= budget) continue;
    total -= p.bytes; if (p.L === 0) l0--;
    freePage(p);
  }
}
// the tile under a disk position (u, v in -1..1): from a full-detail chunk if loaded, else the level-0 map
function tileAt(b, u, v) {
  const lv = levelsOf(b), W = lv.W;
  const tx = clamp(Math.floor((u * 0.5 + 0.5) * W), 0, W - 1), ty = clamp(Math.floor((v * 0.5 + 0.5) * W), 0, W - 1);
  const top = pages.get(`${b.uid}/${lv.N[lv.Lmax]}/${lv.Lmax}/${Math.floor(tx / PAGE)}/${Math.floor(ty / PAGE)}`);
  if (top && top.cpu) { const i = ((ty - top.y0) * top.sx + (tx - top.x0)) * 4; return { tx, ty, base: top.cpu[i], ov: top.cpu[i + 1], exact: true }; }
  const p = b.base;
  if (!p || !p.cpu) return null;
  const N = p.N, x = clamp(Math.floor((u * 0.5 + 0.5) * N), 0, N - 1), y = clamp(Math.floor((v * 0.5 + 0.5) * N), 0, N - 1);
  const i = (y * p.sx + x) * 4;
  return { tx, ty, base: p.cpu[i], ov: p.cpu[i + 1], exact: false };
}

// ---------- per-frame buffers ----------
let spr = new Float32Array(8 * 4096), sprN = 0;
function pushSprite(x, y, size, kind, r, g, b, a) {
  if ((sprN + 1) * 8 > spr.length) { const n = new Float32Array(spr.length * 2); n.set(spr); spr = n; }
  const o = sprN * 8;
  spr[o] = x; spr[o + 1] = y; spr[o + 2] = size; spr[o + 3] = kind;
  spr[o + 4] = r; spr[o + 5] = g; spr[o + 6] = b; spr[o + 7] = a;
  sprN++;
}
const picks = [];            // { b, x, y, r } pooled
let pickN = 0;
function addPick(b, x, y, r) {
  let p = picks[pickN];
  if (!p) p = picks[pickN] = {};
  p.b = b; p.x = x; p.y = y; p.r = r; pickN++;
}
function pickAt(x, y) {
  let best = null, bestR = Infinity;
  for (let i = 0; i < pickN; i++) {
    const p = picks[i], slop = p.r < 8 ? 9 : 3, dist = Math.hypot(x - p.x, y - p.y);
    if (dist > p.r + slop) continue;
    // inside a disc: the smallest disc wins (a moon over its planet); near misses: the closest wins
    const score = dist <= p.r ? p.r : 1e4 + dist;
    if (score < bestR) { best = p.b; bestR = score; }
  }
  return best;
}
const drawList = [];          // bodies big enough to draw as spheres this frame
let drawN = 0;
function addDraw(b, x, y, Rp) {
  let d = drawList[drawN];
  if (!d) d = drawList[drawN] = {};
  d.b = b; d.x = x; d.y = y; d.R = Rp; drawN++;
}
const bp = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, R: 0, mode: 0, pix: 1, lon: 0, lat: 0, lx: 0, ly: 0, lz: 1, flat: 0,
  map: null, art: 0, lod: 0, c1: [0, 0, 0], c2: [0, 0, 0], c3: [0, 0, 0], seed: 0, time: 0, ringIn: 0, ringOut: 0,
  ringA: 0, ringGap: 0, atmo: [0, 0, 0, 0], night: SKIN.night, alpha: 1 };
const NO_ATMO = [0, 0, 0, 0], WHITE = [255, 255, 255], FULL_PAGE = [0, 0, 1, 1];
const starDark = c => [c[0] * 0.78, c[1] * 0.62, c[2] * 0.55];
const STAR_GLOW = { red: 2.2, yellow: 3, blue: 4.4 };

// ---------- sprites on a planet's disk: settlement pins and walkers (stress test) ----------
const pinLayer = R.makeOnDiskLayer(), walkLayer = R.makeOnDiskLayer();
let pinBuf = new Float32Array(4 * 64);
let walkBuf = new Float32Array(0), walkN = 0, walkersDirty = true, walkFor = null;
const STRESS = [0, 1000, 5000, 20000, 50000];
let stressIdx = 0;
function buildWalkers(b) {
  walkersDirty = false; walkFor = b; walkN = 0;
  const n = STRESS[stressIdx];
  if (!n || !b || !b.surface) return;
  if (walkBuf.length < n * 4) walkBuf = new Float32Array(n * 4);
  const r = mulberry32(hash32(b.seed, n));
  const W = b.surface.W, tile = 2 / W, sets = b.settlements || [];
  for (let tries = 0; walkN < n && tries < n * 6; tries++) {
    let u, v;
    if (sets.length && r() < 0.75) {
      const s = sets[(r() * sets.length) | 0], rad = (s.radius + 3) * tile * Math.sqrt(r()), a = r() * TAU;
      u = s.u + Math.cos(a) * rad; v = s.v + Math.sin(a) * rad;
    } else { const a = r() * TAU, d = Math.sqrt(r()) * 0.97; u = Math.cos(a) * d; v = Math.sin(a) * d; }
    if (u * u + v * v > 0.95) continue;
    const t = tileAt(b, u, v);
    if (t && WATER.has(t.base)) continue;
    const o = walkN * 4;
    walkBuf[o] = u; walkBuf[o + 1] = v; walkBuf[o + 2] = SLOT_WALKER; walkBuf[o + 3] = r();
    walkN++;
  }
  walkUploaded = false;
}
let walkUploaded = false;

// ---------- the frame ----------
let lastNow = performance.now(), lastCpu = 0;
const parts = new Float64Array(5), partsAvg = new Float64Array(5);   // stars+systems, GPU calls, spheres, labels, ui
const perf = { frames: 0, acc: 0, max: 0, fps: 0, avg: 0, worst: 0, cpu: 0, cpuAcc: 0, t0: performance.now(), ema: 16.7, slowFor: 0, fastFor: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastNow); lastNow = now;
  const dt = dtMs / 1000;
  const c0 = performance.now();
  frameNo++; simT += dt;
  stepRockets(dt);

  // camera
  stepFly(now);
  if (!cam.fly) {
    const target = clamp(cam.tz, minLogZ(), maxLogZ(cam.focus));
    cam.tz = target;
    if (Math.abs(target - cam.logZ) > 1e-5) applyZoom(cam.logZ + (target - cam.logZ) * (1 - Math.exp(-dt * 16)), cam.ax, cam.ay);
    if (!ptrs.size && (cam.vx || cam.vy)) {
      panBy(cam.vx * dt, cam.vy * dt);
      const k = Math.exp(-dt * 5); cam.vx *= k; cam.vy *= k;
      if (Math.abs(cam.vx) + Math.abs(cam.vy) < 2) cam.vx = cam.vy = 0;
    }
  }
  updateFocus();

  render(now, dt);
  evictPages();
  pump();

  // timing, adaptive quality
  lastCpu = performance.now() - c0;
  perf.frames++; perf.acc += dtMs; perf.max = Math.max(perf.max, dtMs); perf.cpuAcc += lastCpu;
  if (now - perf.t0 > 1000) {
    perf.fps = perf.frames * 1000 / (now - perf.t0); perf.avg = perf.acc / perf.frames; perf.worst = perf.max;
    perf.cpu = perf.cpuAcc / perf.frames;
    for (let i = 0; i < 5; i++) { partsAvg[i] = parts[i] / perf.frames; parts[i] = 0; }
    perf.frames = 0; perf.acc = 0; perf.max = 0; perf.cpuAcc = 0; perf.t0 = now;
    updatePerf();
  }
  perf.ema += (dtMs - perf.ema) * 0.05;
  if (autoQuality && now > 4000 && !document.hidden) {
    // (a steady 30 fps is usually a browser cap - background tab, low-power mode - not overload)
    if (perf.ema > 38) { perf.slowFor += dt; perf.fastFor = 0; } else if (perf.ema < 20) { perf.fastFor += dt; perf.slowFor = 0; } else { perf.slowFor = perf.fastFor = 0; }
    if (perf.slowFor > 2 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); resize(); perf.slowFor = 0; }
    if (perf.fastFor > 8 && quality < 1) { quality = Math.min(1, quality + 0.15); resize(); perf.fastFor = 0; }
  }
  const tu = performance.now();
  if (frameNo % 15 === 0) updateUI();
  if (frameNo % 5 === 0) { updateRocketHud(); updateTouch(); }
  parts[4] += performance.now() - tu;
}

let bodiesDrawn = 0;
function render(now, dt) {
  const s = scale, z = zoom(), md = minDim();
  const [cx, cy] = centerWorld();
  const toX = x => (x - cx) * z + cw / 2, toY = y => (y - cy) * z + ch / 2;
  R.begin();
  sprN = 0; pickN = 0; drawN = 0;
  labels.begin();
  R.sky(Math.max(2, 3 * s), 0.9);

  // the galaxy's glow, fading out as individual stars take over
  const gA = 1 - smooth(1.5, 12, z);
  if (gA > 0) {
    const e = RULES.galaxy.radius * 1.1;
    R.texRect(dustTex, toX(-e) * s, toY(-e) * s, toX(e) * s, toY(e) * s, gA * 0.95);
  }

  const lz = Math.log2(z);
  let tm = performance.now();
  const hov = hover && !ptrs.size ? pickAt(hover.x, hover.y) : null;   // (picks from the last frame)
  for (const st of G.stars) {
    const sx = toX(st.x), sy = toY(st.y);
    const outerPx = st.outer * SU * z, margin = Math.max(40, outerPx);
    if (sx < -margin || sy < -margin || sx > cw + margin || sy > ch + margin) continue;
    const Rp = st.r * SU * z;
    // from afar a whole system is one point of light. Coming closer (near -> 1) it becomes a big bright
    // star with light spikes; once its orbits open up (sys -> 1) it settles into a halo round the star's disk
    const near = smooth(0.05, 3, outerPx), sys = smooth(6, 30, outerPx);
    const point = STAR_GLOW[st.type] * (1 + 0.22 * clamp(lz + 1.5, 0, 7));
    const c = st.color;
    if (near < 0.98) pushSprite(sx * s, sy * s, point * s, 0, c[0] / 255, c[1] / 255, c[2] / 255, 1 - near);
    if (near > 0.02) {
      const big = point * 5 * (1 - sys) + Math.max(point * 1.5, Rp * 5) * sys;
      pushSprite(sx * s, sy * s, big * s, 3, c[0] / 255, c[1] / 255, c[2] / 255, near * (1 - 0.55 * sys));
    }
    const glow = point * (1 + 1.5 * near) * (1 - sys) + Math.max(point, Rp * 4.2) * sys;
    addPick(st, sx, sy, Math.max(Rp, 5));
    const pri = (st.isSun ? 2000 : 0) + (st === selected ? 1500 : 0) + (st.type === 'blue' ? 40 : st.type === 'yellow' ? 25 : 10);
    // star names stay hidden (just dots) unless the star is hovered or selected, or its system is open
    const sa = st === hov || st === selected ? 1 : sys;
    labels.add(st.uid, st.name, sx, sy, Math.max(glow * 0.35, point * 1.6 * near * (1 - sys), Rp * 1.15) + 3, pri, sa, st.isSun ? 'home' : 'star');
    if (Rp > 1.4) addDraw(st, sx, sy, Rp);
    if (outerPx > 3) drawSystem(st, sx, sy, z, md, s);
  }
  let t2 = performance.now(); parts[0] += t2 - tm; tm = t2;
  // orbit rings, planet dots and star glows go down first; spheres go on top
  R.sprites(spr, sprN, 1.2 * s);
  t2 = performance.now(); parts[1] += t2 - tm; tm = t2;
  bodiesDrawn = 0;
  for (let i = 0; i < drawN; i++) drawBody(drawList[i], s, md, now);
  drawOnPlanet(s, md);
  t2 = performance.now(); parts[2] += t2 - tm; tm = t2;
  labels.end(now, dt, labelDpr, cw, ch);
  drawRocketLayer(labels.g);
  parts[3] += performance.now() - tm;
}

function ringVisible(x, y, r) {
  const nx = clamp(x, 0, cw), ny = clamp(y, 0, ch), dmin = Math.hypot(x - nx, y - ny);
  const fx = x < cw / 2 ? cw : 0, fy = y < ch / 2 ? ch : 0, dmax = Math.hypot(x - fx, y - fy);
  return r >= dmin - 2 && r <= dmax + 2;
}

function drawSystem(st, ssx, ssy, z, md, s) {
  const cxw = st.x - (ssx - cw / 2) / z, cyw = st.y - (ssy - ch / 2) / z;
  const oc = st.type === 'blue' ? [0.55, 0.65, 1] : st.type === 'red' ? [1, 0.55, 0.45] : [1, 0.85, 0.55];
  for (const p of st.planets) {
    const op = p.orbit * SU * z;
    const a = smooth(8, 24, op);                 // planets appear with their orbits, not before
    if (a <= 0) continue;
    place(p);
    const ringA = a * 0.2 * smooth(10, 40, op) * (1 - smooth(3e4, 1.2e5, op));
    if (ringA > 0.01 && ringVisible(ssx, ssy, op)) pushSprite(ssx * s, ssy * s, op * s, 2, oc[0], oc[1], oc[2], ringA * (p === selected ? 2.5 : 1));
    const psx = (p._x - cxw) * z + cw / 2, psy = (p._y - cyw) * z + ch / 2;
    const Rp = p.r * SU * z, ext = Math.max(Rp * (p.rings ? p.rings.outer : 1.1), 4);
    let moonReach = 0;
    for (const m of p.moons) moonReach = Math.max(moonReach, m.orbit * SU * z);
    if (psx < -ext - moonReach || psy < -ext - moonReach || psx > cw + ext + moonReach || psy > ch + ext + moonReach) continue;
    p._seen = frameNo; p._want = Rp;
    if (Rp < 2.2) {
      const c = p.dot;
      pushSprite(psx * s, psy * s, Math.max(1.5, Rp) * s, 1, c[0] / 255, c[1] / 255, c[2] / 255, a);
    } else addDraw(p, psx, psy, Rp);
    addPick(p, psx, psy, Math.max(Rp, 3));
    const la = smooth(30, 70, op) * (1 - smooth(0.25, 0.4, Rp / md));
    labels.add(p.uid, p.name, psx, psy, ext + 4, 300 + (p.home ? 400 : 0) + (p === selected ? 1500 : 0) + p.r * 5, la, p.home ? 'home' : 'normal');
    for (const m of p.moons) {
      const mo = m.orbit * SU * z, am = a * smooth(4, 14, mo);
      if (am <= 0) continue;
      place(m);
      const mra = am * 0.14 * (1 - smooth(3e4, 1.2e5, mo));
      if (mra > 0.01 && ringVisible(psx, psy, mo)) pushSprite(psx * s, psy * s, mo * s, 2, 0.8, 0.85, 1, mra * (m === selected ? 2.5 : 1));
      const msx = (m._x - cxw) * z + cw / 2, msy = (m._y - cyw) * z + ch / 2, Rm = m.r * SU * z;
      if (msx < -Rm - 20 || msy < -Rm - 20 || msx > cw + Rm + 20 || msy > ch + Rm + 20) continue;
      m._seen = frameNo; m._want = Rm;
      if (Rm < 2.2) {
        const c = m.dot;
        pushSprite(msx * s, msy * s, Math.max(1, Rm) * s, 1, c[0] / 255, c[1] / 255, c[2] / 255, am);
      } else addDraw(m, msx, msy, Rm);
      addPick(m, msx, msy, Math.max(Rm, 2.5));
      const lm = smooth(30, 70, mo) * (1 - smooth(0.25, 0.4, Rm / md));
      labels.add(m.uid, m.name, msx, msy, Math.max(Rm, 3) + 3, 150 + (m === selected ? 1500 : 0), lm, 'small');
    }
  }
}

function drawBody(d, s, md, now) {
  const b = d.b, Rd = d.R * s, cx = d.x * s, cy = d.y * s;
  const star = b.kind === 'star';
  const ext = star ? 3.4 : b.rings ? b.rings.outer + 0.05 : b.atmo ? 1.15 : 1.03;
  const x0 = Math.max(0, cx - Rd * ext - 2), y0 = Math.max(0, cy - Rd * ext - 2);
  const x1 = Math.min(R.w, cx + Rd * ext + 2), y1 = Math.min(R.h, cy + Rd * ext + 2);
  if (x1 <= x0 || y1 <= y0) return;
  bodiesDrawn++;
  bp.x0 = x0; bp.y0 = y0; bp.x1 = x1; bp.y1 = y1; bp.cx = cx; bp.cy = cy; bp.R = Rd;
  bp.time = simT; bp.seed = (b.seed % 997) / 9.7; bp.alpha = 1; bp.map = null; bp.art = 0; bp.lod = 0;
  bp.page = FULL_PAGE; bp.detail = false;
  bp.ringIn = 0; bp.ringOut = 0; bp.ringA = 0; bp.ringGap = 0; bp.atmo = NO_ATMO; bp.fx = false;
  if (star) {
    bp.mode = 2; bp.pix = Math.max(2, Math.min(5, d.R / 120)) * s;
    bp.c1 = b.color; bp.c2 = starDark(b.color); bp.c3 = WHITE;
    bp.lx = 0; bp.ly = 0; bp.lz = 1;
    R.body(bp);
    return;
  }
  b._seen = frameNo;
  // light comes from this body's star (used for the shadow a giant casts on its rings)
  const st = b.star, z = zoom(), [wcx, wcy] = centerWorld();
  const lx = (st.x - wcx) * z + cw / 2 - d.x, ly = (st.y - wcy) * z + ch / 2 - d.y, ll = Math.hypot(lx, ly) || 1;
  bp.lx = lx / ll; bp.ly = -ly / ll; bp.lz = 0;
  if (b.giant) {
    bp.mode = 1; bp.pix = Math.max(2, Math.min(5, d.R / 120)) * s;
    bp.c1 = b.palette[0]; bp.c2 = b.palette[1]; bp.c3 = b.palette[2];
    if (b.rings) { bp.ringIn = b.rings.inner; bp.ringOut = b.rings.outer; bp.ringA = 0.75; bp.ringGap = b.rings.gap; }
    R.body(bp);
    return;
  }
  bp.mode = 0; bp.c1 = b.dot; bp.c2 = b.dot; bp.c3 = b.dot;
  bp.fx = terrainFx; bp.tpp = b.surface.W / (2 * Rd);      // tiles per device pixel
  if (b.atmo) bp.atmo = b.atmo;
  bp.atmoH = b === HOME ? RK.atmosphere / HOME.r : 0.05;
  const lv = levelsOf(b), D = 2 * Rd, focus = b === cam.focus ? 1e6 : 0;
  // the whole-planet base (also draws the rim and atmosphere), then sharper chunks on top at the level this
  // zoom needs (a level is enough once it has ~0.4 samples per device pixel: far-view pixels are drawn in 2-3 px
  // blocks), with the two levels below standing in while those load
  const base = wantPage(b, 0, 0, 0, 4e6 + focus + d.R);
  const Lt = Math.min(lv.Lmax, Math.max(0, Math.ceil(Math.log2(D * 0.4 / lv.N[0]))));
  const levels = [];                                         // per level: visible chunks (null = not built yet)
  let topDone = true;
  const sx0 = cx - Rd, sy0 = cy - Rd;
  for (let L = Math.max(1, Lt - 2); L <= Lt && Lt >= 1; L++) {
    const N = lv.N[L], k = D / N, list = [];                   // k = device px per sample at this level
    const pxA = Math.max(0, Math.floor(-sx0 / k / PAGE)), pxB = Math.min(Math.ceil(N / PAGE) - 1, Math.floor((R.w - sx0) / k / PAGE));
    const pyA = Math.max(0, Math.floor(-sy0 / k / PAGE)), pyB = Math.min(Math.ceil(N / PAGE) - 1, Math.floor((R.h - sy0) / k / PAGE));
    for (let py = pyA; py <= pyB; py++) for (let px = pxA; px <= pxB; px++) {
      // neighbouring chunks share edges computed the same way, so there's never a hairline gap between them
      const rx0 = sx0 + px * PAGE * k, ry0 = sy0 + py * PAGE * k, rx1 = sx0 + (px + 1) * PAGE * k, ry1 = sy0 + (py + 1) * PAGE * k;
      const nx = clamp(cx, rx0, rx1) - cx, ny = clamp(cy, ry0, ry1) - cy;
      if (nx * nx + ny * ny > Rd * Rd) continue;                // a corner chunk entirely outside the disk
      let p = pages.get(`${b.uid}/${N}/${L}/${px}/${py}`);
      if (L >= Lt - 1) {                                       // request the target level and the one below
        const off = Math.hypot((rx0 + rx1) / 2 - R.w / 2, (ry0 + ry1) / 2 - R.h / 2);
        p = wantPage(b, L, px, py, 2e6 + focus - (Lt - L === 0 ? 5e4 : 0) - off);
      } else if (p) p.used = frameNo;
      const ok = !!(p && p.ready);
      if (L === Lt && !ok) topDone = false;
      list.push(ok ? p : null, rx0, ry0, rx1, ry1);
    }
    levels.push(list);
  }
  // once the sharpest level covers the view, the layers under it would be painted over: skip them. The base
  // is still needed where the view shows the rim or space around the planet
  const inside = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < Rd * Rd * 0.98;
  const screenInDisk = inside(0, 0) && inside(R.w, 0) && inside(0, R.h) && inside(R.w, R.h);
  if (!(Lt >= 1 && topDone && screenInDisk)) {
    setPage(bp, base.ready ? base : null, lv, D, s);
    R.body(bp);
  }
  for (let li = topDone ? Math.max(0, levels.length - 1) : 0; li < levels.length; li++) {
    const list = levels[li];
    for (let i = 0; i < list.length; i += 5) {
      const p = list[i];
      if (!p) continue;
      bp.x0 = Math.max(0, list[i + 1]); bp.y0 = Math.max(0, list[i + 2]); bp.x1 = Math.min(R.w, list[i + 3]); bp.y1 = Math.min(R.h, list[i + 4]);
      setPage(bp, p, lv, D, s);
      bp.detail = true;
      R.body(bp);
    }
  }
  bp.detail = false;
  if (terrainFx) drawPropsOn(b, cx, cy, Rd, focus);
}
// Big props (trees, boulders) as pictures, from the full-detail chunks, once tiles are big enough for the tile art (the
// same point where the shader switches to it, fading in alongside). Chunks a little below and beside the view count
// too: a tall prop standing there reaches up into it
const PROP_REACH = [1.5, 3];     // how far a size-1 prop reaches from its foot, sideways and up, in tiles
let propMax = 1;                 // the largest item size in the biome designs
function drawPropsOn(b, cx, cy, Rd, focus) {
  const lv = levelsOf(b), L = lv.Lmax, N = lv.N[L], D = 2 * Rd;
  const alpha = clamp((1.15 - 8 * N / D) / 0.45, 0, 1);
  if (alpha <= 0 || !R.items) return;
  const k = D / N, sx0 = cx - Rd, sy0 = cy - Rd, C = Math.ceil(N / PAGE);
  const [sx, sy] = R.shadowReach();                        // shadows of items just off screen reach into it
  const mx = (PROP_REACH[0] + sx) * propMax * k, my = PROP_REACH[1] * propMax * k, ms = sy * propMax * k;
  const pxA = Math.max(0, Math.floor((-mx - sx0) / k / PAGE)), pxB = Math.min(C - 1, Math.floor((R.w + mx - sx0) / k / PAGE));
  const pyA = Math.max(0, Math.floor((-ms - sy0) / k / PAGE)), pyB = Math.min(C - 1, Math.floor((R.h + my - sy0) / k / PAGE));
  const items = [];
  for (let py = pyA; py <= pyB; py++) for (let px = pxA; px <= pxB; px++) {
    const rx0 = sx0 + px * PAGE * k, ry0 = sy0 + py * PAGE * k, rx1 = rx0 + PAGE * k, ry1 = ry0 + PAGE * k;
    const nx = clamp(cx, rx0, rx1) - cx, ny = clamp(cy, ry0, ry1) - cy;
    if (nx * nx + ny * ny > Rd * Rd) continue;
    const p = wantPage(b, L, px, py, 2e6 + focus - Math.hypot((rx0 + rx1) / 2 - R.w / 2, (ry0 + ry1) / 2 - R.h / 2));
    if (p.ready && p.props) items.push({ big: p.props, small: p.small, fld: p.fld, chunk: [p.x0, p.y0, p.sx, p.sy] });
  }
  R.drawProps(items, { cx, cy, R: Rd, W8: N * 8, tpp: b.surface.W / D, alpha });
}
// point the body shader at one chunk: its textures, where it sits, and how to filter it at this zoom
function setPage(q, p, lv, D, s) {
  q.page = p ? p.uv : FULL_PAGE; q.detail = false; q.map = p; q.art = 0; q.pix = 2 * s; q.lod = 0;
  if (!p) return;
  const perPx = p.N / D;                                      // samples per device pixel
  if (p.L === lv.Lmax) { q.art = clamp((1.15 - 8 * perPx) / 0.45, 0, 1); if (q.art > 0) q.pix = 1; }
  q.lod = Math.log2(Math.max(1, perPx * q.pix));
}

function drawOnPlanet(s, md) {
  const f = cam.focus;
  if (!f || !f.surface) return;
  let d = null;
  for (let i = 0; i < drawN; i++) if (drawList[i].b === f) { d = drawList[i]; break; }
  if (!d) return;
  const Rp = d.R, W = f.surface.W, tilePx = 2 * Rp / W;
  const q = { cx: d.x * s, cy: d.y * s, R: Rp * s, size: 0, time: simT, walk: 0, alpha: 1 };
  // walkers (stress test): world-sized, so they vanish when tiles get too small to see
  if (walkersDirty || walkFor !== f) buildWalkers(f);
  const wa = smooth(1.2, 3.5, tilePx);
  if (walkN && wa > 0) {
    q.size = Math.max(2, tilePx * 0.9) * s; q.walk = 1.5 * 2 / W; q.alpha = wa;
    R.onDisk(walkLayer, walkBuf, walkN, !walkUploaded, q); walkUploaded = true;
  }
  // settlement pins: shown while settlements are too small to see, then they fade into the real buildings
  const sets = f.settlements;
  if (!sets || !sets.length) return;
  const cityPx = 3 * tilePx;
  const pa = smooth(40, 110, Rp) * (1 - smooth(10, 22, cityPx));
  if (pa > 0.01) {
    if (pinBuf.length < sets.length * 4) pinBuf = new Float32Array(sets.length * 4);
    sets.forEach((st, i) => { pinBuf[i * 4] = st.u; pinBuf[i * 4 + 1] = st.v; pinBuf[i * 4 + 2] = SLOT_PIN + st.level; pinBuf[i * 4 + 3] = 0; });
    q.size = 11 * s; q.walk = 0; q.alpha = pa;
    R.onDisk(pinLayer, pinBuf, sets.length, true, q);
  }
  const la = smooth(150, 300, Rp);
  if (la > 0.01) for (const st of sets) {
    labels.add(f.uid + '/' + st.name, `${st.name} · ${st.levelName}`, d.x + st.u * Rp, d.y + st.v * Rp,
      pa > 0.3 ? 8 : Math.max(6, st.radius * tilePx * 0.8), 100 + st.level * 15, la, 'small');
  }
}

// ---------- input ----------
const ptrs = new Map();
let pinch = null, drag = null, lastTap = null, hover = null;
const pinchState = () => {
  const [a, b] = [...ptrs.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
glCanvas.addEventListener('pointerdown', e => {
  try { glCanvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cam.fly = null; cam.vx = cam.vy = 0;
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, vx: 0, vy: 0, lt: performance.now() };
  else if (ptrs.size === 2) { pinch = pinchState(); if (drag) drag.moved = true; }
});
glCanvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) { hover = { x: e.clientX, y: e.clientY }; return; }
  ptrs.get(e.pointerId).x = e.clientX; ptrs.get(e.pointerId).y = e.clientY;
  if (ptrs.size === 2 && pinch) {
    const p = pinchState(), dl = Math.log2(p.d / pinch.d);
    panBy(p.x - pinch.x, p.y - pinch.y);
    if (dl > 0) autoFocus(p.x, p.y);
    applyZoom(cam.logZ + dl, p.x, p.y); cam.tz = cam.logZ;
    pinch = p;
  } else if (drag && ptrs.size === 1) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = performance.now(), dtt = Math.max(1, t - drag.lt) / 1000;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    if (drag.moved) panBy(dx, dy);
    drag.vx = drag.vx * 0.6 + (dx / dtt) * 0.4; drag.vy = drag.vy * 0.6 + (dy / dtt) * 0.4;
    drag.x = e.clientX; drag.y = e.clientY; drag.lt = t;
  }
  hover = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
});
const endPtr = e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (drag && ptrs.size === 0) {
    const t = performance.now();
    if (!drag.moved && t - drag.t < 450 && e.type === 'pointerup') tap(e.clientX, e.clientY, e.pointerType);
    else if (drag.moved && t - drag.lt < 80) { cam.vx = clamp(drag.vx, -4000, 4000); cam.vy = clamp(drag.vy, -4000, 4000); }
    drag = null;
  } else if (ptrs.size === 1) {
    const [p] = [...ptrs.values()];
    drag = { x: p.x, y: p.y, sx: p.x, sy: p.y, t: 0, moved: true, vx: 0, vy: 0, lt: performance.now() };
  }
};
glCanvas.addEventListener('pointerup', endPtr);
// right-drag pans like left-drag: never show the browser's "save image" menu over the map
glCanvas.addEventListener('contextmenu', e => e.preventDefault());
glCanvas.addEventListener('pointercancel', endPtr);
glCanvas.addEventListener('pointerleave', () => { hover = null; });
function tap(x, y) {
  const t = performance.now();
  if (lastTap && t - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 26) {
    lastTap = null;
    const b = pickAt(x, y);
    if (b) flyTo(b);
    else { cam.tz += 1.5; cam.ax = x; cam.ay = y; autoFocus(x, y); }
    return;
  }
  lastTap = { t, x, y };
  const rk = rocketAt(x, y);
  if (rk) { takeControl(rk === 'pad' ? padRocket : rk); return; }
  select(pickAt(x, y));
}
glCanvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.fly = null;
  const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dz = -e.deltaY * px * (e.ctrlKey ? 0.016 : 0.0035);
  cam.tz = clamp(cam.tz + clamp(dz, -1.5, 1.5), minLogZ(), maxLogZ(cam.focus) + 1);
  cam.ax = e.clientX; cam.ay = e.clientY;
  if (dz > 0) autoFocus(e.clientX, e.clientY);
}, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === '+' || k === '=') { cam.tz += 1; cam.ax = cw / 2; cam.ay = ch / 2; }
  else if (k === '-' || k === '_') { cam.tz -= 1; cam.ax = cw / 2; cam.ay = ch / 2; }
  else if (k === 'h') flyTo(HOME);
  else if (k === 'g') flyTo(null);
  else if (k === 'p') togglePerf();
  else if (k === 's') cycleStress();
  else if (k === 'escape') select(null);
  else if (k === ' ') { e.preventDefault(); toggleEngine(); }
  else if (k === 'r') backToRocket();
  else if (k === 'tab') { e.preventDefault(); switchRocket(); }
  else if (k === 'f') toggleFollow();
  else if (k === 't') toggleTerrain();
  if ('qead'.includes(k) && k.length === 1) held.add(k);
});
const held = new Set();
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());

// ---------- UI ----------
let selected = null;
function select(b) { selected = b; if (b && b.surface) wantPage(b, 0, 0, 0, 4e6); updateUI(true); }
const perfEl = $('perf'), infoEl = $('info'), tipEl = $('tip'), crumbsEl = $('crumbs'), barEl = $('bar');
let perfOn = !coarse || params.has('perf'), autoQuality = true;
perfEl.hidden = !perfOn;
function toggleTerrain() {
  terrainFx = !terrainFx;
  try { localStorage.setItem('galaxyDemo.terrainFx', terrainFx ? '1' : '0'); } catch (e) { /* no storage */ }
  showTerrainBtn();
}
function showTerrainBtn() { $('btnTerrain').textContent = terrainFx ? 'Terrain: new' : 'Terrain: old'; $('btnTerrain').classList.toggle('on', terrainFx); }
function togglePerf() { perfOn = !perfOn; perfEl.hidden = !perfOn; $('btnPerf').classList.toggle('on', perfOn); }
function cycleStress() {
  stressIdx = (stressIdx + 1) % STRESS.length; walkersDirty = true;
  $('btnStress').textContent = STRESS[stressIdx] ? `Walkers: ${STRESS[stressIdx] / 1000}k` : 'Walkers: off';
  $('btnStress').classList.toggle('on', stressIdx > 0);
}
$('btnHome').onclick = () => flyTo(HOME);
$('btnGalaxy').onclick = () => flyTo(null);
$('btnStress').onclick = cycleStress;
$('btnPerf').onclick = togglePerf;
$('btnTerrain').onclick = toggleTerrain;
showTerrainBtn();
$('btnPerf').classList.toggle('on', perfOn);
$('btnHelp').onclick = () => { $('help').hidden = !$('help').hidden; };
$('help').onclick = () => { $('help').hidden = true; };

function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
function updatePerf() {
  if (!perfOn) return;
  let full = 0, low = 0;
  for (const p of pages.values()) if (p.ready) { if (p.L === 0) low++; else full++; }
  const heap = performance.memory ? ` · heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '';
  const zText = zoom() >= 1 ? `${fmt(Math.round(zoom()))} px/gu` : `1 px = ${(1 / zoom()).toFixed(1)} gu`;
  perfEl.innerHTML =
    `<b>${perf.fps.toFixed(0)} fps</b> · frame ${perf.avg.toFixed(1)} ms (worst ${perf.worst.toFixed(0)}) · JS ${perf.cpu.toFixed(2)} ms<br>` +
    `  └ stars ${partsAvg[0].toFixed(2)} · gpu ${partsAvg[1].toFixed(2)} · spheres ${partsAvg[2].toFixed(2)} · labels ${partsAvg[3].toFixed(2)} · ui ${partsAvg[4].toFixed(2)}<br>` +
    `draw calls ${R.draws} · sprites ${fmt(sprN)} · spheres ${bodiesDrawn}${walkN && cam.focus === walkFor ? ` · walkers ${fmt(walkN)}` : ''}<br>` +
    `map chunks ${full} + ${low} whole-planet · queued ${jobs.length} · built ${mapsBuilt} (${mapsBuilt ? (mapsMs / mapsBuilt).toFixed(0) : 0} ms avg, ${NW} workers)<br>` +
    `GPU textures ~${(R.texBytes / 1048576).toFixed(1)} MB${heap}<br>` +
    `render ${R.w}×${R.h} (×${scale.toFixed(2)})${quality < 1 ? ' auto-reduced' : ''} · zoom ${zText}<br>` +
    `galaxy built in ${G.ms.toFixed(0)} ms + glow ${dustMs.toFixed(0)} ms · seed ${SEED}`;
}
function chain(b) { const out = []; for (let p = b; p; p = p.parent) out.unshift(p); return out; }
function updateUI(force) {
  // breadcrumb of where the camera is
  const parts = chain(cam.focus);
  const key = parts.map(p => p.uid).join('>');
  if (force || crumbsEl.dataset.key !== key) {
    crumbsEl.dataset.key = key;
    crumbsEl.innerHTML = '';
    const add = (label, b) => { const a = document.createElement('button'); a.textContent = label; a.onclick = () => flyTo(b); crumbsEl.appendChild(a); };
    add('Galaxy', null);
    for (const p of parts) add(p.name, p);
  }
  // hover tooltip (mouse only)
  hoverRocket = hover && !ptrs.size ? rocketAt(hover.x, hover.y) : null;
  glCanvas.style.cursor = hoverRocket ? 'pointer' : '';
  if (hoverRocket) {
    const rk = hoverRocket === 'pad' ? padRocket : hoverRocket;
    const what = hoverRocket === 'pad'
      ? `<b>Launch pad</b> · ${rk.state === 'ready' ? `${rk.name} ready` : `building ${rk.name} (${Math.floor(rk.built * 100)}%)`}`
      : `<b>${rk.name}</b> · ${rk.state === 'landed' ? (rk.on === 1 ? 'landed on the Moon' : 'landed') : 'flying'}`;
    tipEl.hidden = false; tipEl.innerHTML = `${what} <span class="dim">· click to ${rk === active ? 'follow' : 'take control'}</span>`;
    tipEl.style.left = (hover.x + 14) + 'px'; tipEl.style.top = (hover.y + 16) + 'px';
  } else if (hover && !ptrs.size) {
    const b = pickAt(hover.x, hover.y);
    let txt = b ? `<b>${b.name}</b> · ${b.kind === 'star' ? RULES.stars[b.type].name : b.typeName}` : '';
    if (b && b.kind === 'star') txt = '';          // a hovered star shows its name label instead
    const f = cam.focus;
    if (f && f.surface) {
      const d = drawList.slice(0, drawN).find(x => x.b === f);
      if (d) {
        const u = (hover.x - d.x) / d.R, v = (hover.y - d.y) / d.R;
        const t = u * u + v * v <= 1 ? tileAt(f, u, v) : null;
        if (t) txt = `<b>${f.name}</b> · ${BASE_NAME[BASE[t.base]]}${t.ov ? ' · ' + (RESOURCE_NAME[OVER[t.ov]] ? RESOURCE_NAME[OVER[t.ov]] + ' deposit' : 'buildings') : ''} <span class="dim">tile ${t.tx}, ${t.ty}</span>`;
      }
    }
    tipEl.hidden = !txt;
    if (txt) { tipEl.innerHTML = txt; tipEl.style.left = (hover.x + 14) + 'px'; tipEl.style.top = (hover.y + 16) + 'px'; }
  } else tipEl.hidden = true;
  // info panel
  // on phones the info card waits for a tap, and gives way to the rocket controls while you're flying
  infoEl.hidden = (coarse && !selected) || (!touchEl.hidden && innerWidth <= 640);
  if (frameNo % 30 === 0 || force) {
    // only rebuild when the text changed: replacing the buttons in the middle of a tap swallowed the tap
    const html = infoHTML(selected);
    if (html !== infoEl._html) { infoEl._html = html; infoEl.innerHTML = html; }
    // keep the card above the bottom bar, however many rows the bar wraps to on a phone
    const above = Math.round(innerHeight - barEl.getBoundingClientRect().top + 10);
    if (above !== infoEl._above) { infoEl._above = above; document.documentElement.style.setProperty('--above-bar', above + 'px'); }
  }
}
// the card's buttons, handled on the card itself so they work even if its contents were just rebuilt
infoEl.addEventListener('click', e => {
  if (e.target.closest('[data-fly]')) flyTo(selected);
  else if (e.target.closest('[data-close]')) select(null);
});
function infoHTML(b) {
  if (b && b.kind === 'rocket') b = null;                // rockets have their own readout
  if (!b) {
    const c = G.counts;
    return `<div class="t">The Galaxy</div><div class="s">${G.stars.length} stars · seed ${SEED}</div>
      <div class="row"><span class="dot" style="background:#ff7052"></span>${c.red} red dwarfs</div>
      <div class="row"><span class="dot" style="background:#ffde8c"></span>${c.yellow} yellow stars</div>
      <div class="row"><span class="dot" style="background:#96baff"></span>${c.blue} blue giants</div>
      <div class="row">${fmt(c.planets)} planets · ${fmt(c.moons)} moons · ${c.settled} settled worlds</div>
      <div class="hint">Tap a star to select it, double-tap to fly there. Pinch or scroll to zoom.</div>`;
  }
  if (b.kind === 'star') {
    const S = RULES.stars[b.type];
    const giants = b.planets.filter(p => p.giant).length, moons = b.planets.reduce((n, p) => n + p.moons.length, 0);
    const settled = b.planets.filter(p => p.settle).length;
    return `<div class="t">${b.name}<button class="x" data-close>×</button></div><div class="s">${S.name}${b.isSun ? ' · your star' : ''}</div>
      <div class="row">${b.planets.length} planets (${giants} giants) · ${moons} moons</div>
      ${settled ? `<div class="row">${settled} settled world${settled > 1 ? 's' : ''}</div>` : ''}
      <div class="chips">${b.planets.map(p => `<span title="${p.typeName}" style="background:rgb(${p.dot.map(Math.round).join(',')})"></span>`).join('')}</div>
      <button class="go" data-fly>Fly here</button>`;
  }
  const where = b.kind === 'moon' ? `moon of ${b.parent.name}` : `orbits ${b.star.name}`;
  let res = '';
  if (b.surface) {
    if (b.counts) {
      const c = b.counts;
      let land = 0;
      for (let i = 0; i < 32; i++) if (!WATER.has(i)) land += c[i];
      const tot = b.surface ? c.slice(0, 32).reduce((a, x) => a + x, 0) : 1;
      const rs = RESOURCES.map(n => [n, c[32 + OVER.indexOf(n)]]).filter(x => x[1] > 0).sort((a, b2) => b2[1] - a[1]);
      const maxv = rs.length ? rs[0][1] : 1;
      res = `<div class="row">${(land / tot * 100).toFixed(0)}% land${(b.settlements && b.settlements.length) ? ` · ${b.settlements.length} settlements` : ''}</div>` +
        (rs.length ? `<div class="res">${rs.map(([n, v]) => `<div><span>${RESOURCE_NAME[n]}</span><i style="width:${Math.max(6, v / maxv * 100)}%"></i><em>${(v / Math.max(1, land) * 100).toFixed(1)}%</em></div>`).join('')}</div>` : '<div class="row dim">No deposits</div>');
    } else res = '<div class="row dim">Surveying the surface…</div>';
  }
  return `<div class="t">${b.name}<button class="x" data-close>×</button></div>
    <div class="s">${b.typeName} · ${where}${b.home ? ' · <b class="home">your home world</b>' : ''}</div>
    <div class="row">${heatWord(b.heat)} · ${b.surface ? `${b.surface.W} tiles across` : 'no solid surface'}${b.moons.length ? ` · ${b.moons.length} moon${b.moons.length > 1 ? 's' : ''}` : ''}${b.rings ? ' · rings' : ''}</div>
    ${res}<button class="go" data-fly>Fly here</button>`;
}

// ---------- Scale panel: live knobs for the distance ladder ----------
// each slider runs from default / spread to default * spread, so the rules.js default sits in the middle
const KNOBS = [
  { key: 'homeTiles', label: 'Home size', spread: 2, text: v => `${v} tiles across` },
  { key: 'moonDistance', label: 'Home → Moon', spread: 8, text: v => `${nice(v)} Home radii` },
  { key: 'sunDistance', label: 'Home → Sun', spread: 8, text: v => `${nice(v)} Moon distances` },
  { key: 'starDistance', label: 'Sun → nearest star', spread: 100, text: v => `${nice(v)} Sun distances` },
];
for (const k of KNOBS) { k.log = true; k.min = RULES.scale[k.key] / k.spread; k.max = RULES.scale[k.key] * k.spread; }
function nice(v) {
  if (v >= 1000) { const p = 10 ** (Math.floor(Math.log10(v)) - 1); return (Math.round(v / p) * p).toLocaleString('en-US'); }
  return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}
const toSlider = (k, v) => k.log ? Math.round(1000 * Math.log(v / k.min) / Math.log(k.max / k.min)) : v;
const fromSlider = (k, t) => {
  const v = k.min * (k.max / k.min) ** (t / 1000);
  return k.key === 'homeTiles' ? Math.round(v / 32) * 32 : +nice(v).replace(/,/g, '');
};
function saveScale() { try { localStorage.setItem('galaxyDemo.scale', JSON.stringify(SCALE)); } catch (e) { /* no storage */ } }
// re-scale while keeping the focused body the same size on screen (orbits and gaps change around it)
// keepSize: keep the focused body the same size on screen, so orbits visibly move around it. The star-gap
// slider doesn't (it would cancel out): the zoom stays put and the whole system grows or shrinks instead.
function rescale(keepSize = true) {
  const oldSU = SU;
  applyScale();
  if (cam.focus) {
    const k = SU / oldSU;
    cam.ox *= k; cam.oy *= k;
    if (keepSize) { cam.logZ -= Math.log2(k); cam.tz = cam.logZ; }
  }
  cam.fly = null;
}
const ladderText = () => LADDER_KEYS.map(k => SCALE[k]).join(',');
// copy to the clipboard, and also show the text in the panel (selected) in case the browser blocks the clipboard
function copyText(text, btn, done) {
  const out = scaleEl.querySelector('[data-out]');
  out.hidden = false; out.value = text; out.focus(); out.select();
  const say = msg => { const t = btn.dataset.label || (btn.dataset.label = btn.textContent); btn.textContent = msg; setTimeout(() => { btn.textContent = t; }, 1800); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => say(done), () => say('Select & copy below'));
  else say('Select & copy below');
}
function resizeMaps() {
  applyHomeTiles();
  for (const p of [...pages.values()]) freePage(p);
  jobs.length = 0;
  for (const b of G.bodies) { b.settlements = null; b.counts = null; b.base = null; b.lv = null; }
  walkersDirty = true;
  updateUI(true);
}
const scaleEl = $('scale');
function buildScalePanel() {
  scaleEl.innerHTML = '<div class="t">Scale<button class="x" data-close>×</button></div>' +
    '<div class="s">Each distance is measured in the one above it.</div>' +
    KNOBS.map(k => `<label><span>${k.label}</span><b data-v="${k.key}"></b>
      <input type="range" data-k="${k.key}" min="${k.log ? 0 : k.min}" max="${k.log ? 1000 : k.max}" step="${k.log ? 1 : k.step}"></label>`).join('') +
    '<div class="row2"><button data-link>Copy link</button><button data-rules>Copy for rules.js</button></div>' +
    '<textarea data-out readonly rows="3" hidden></textarea>' +
    '<button class="go" data-reset>Reset to defaults</button>' +
    '<div class="hint">Saved automatically in this browser. <b>Copy link</b> shares these distances with anyone. ' +
    'To make them everyone&rsquo;s default, use <b>Copy for rules.js</b> and paste it to Claude.</div>';
  const sync = () => KNOBS.forEach(k => {
    scaleEl.querySelector(`[data-k="${k.key}"]`).value = toSlider(k, SCALE[k.key]);
    scaleEl.querySelector(`[data-v="${k.key}"]`).textContent = k.text(SCALE[k.key]);
  });
  KNOBS.forEach(k => {
    const input = scaleEl.querySelector(`[data-k="${k.key}"]`);
    input.addEventListener('input', () => {
      SCALE[k.key] = fromSlider(k, input.value);
      scaleEl.querySelector(`[data-v="${k.key}"]`).textContent = k.text(SCALE[k.key]);
      if (k.key !== 'homeTiles') rescale(k.key !== 'starDistance');
    });
    input.addEventListener('change', () => { if (k.key === 'homeTiles') { rescale(); resizeMaps(); } saveScale(); });
  });
  scaleEl.querySelector('[data-link]').onclick = e => {
    const u = new URL(location.href); u.searchParams.set('ladder', ladderText());
    copyText(u.toString(), e.currentTarget, 'Link copied');
  };
  scaleEl.querySelector('[data-rules]').onclick = e => {
    const txt = `scale: { homeTiles: ${SCALE.homeTiles}, moonDistance: ${SCALE.moonDistance}, sunDistance: ${SCALE.sunDistance}, starDistance: ${SCALE.starDistance} }`;
    copyText(txt, e.currentTarget, 'Copied');
  };
  scaleEl.querySelector('[data-reset]').onclick = () => {
    const tilesChanged = SCALE.homeTiles !== RULES.scale.homeTiles;
    for (const k of LADDER_KEYS) SCALE[k] = RULES.scale[k];
    rescale(); if (tilesChanged) resizeMaps();
    saveScale(); sync();
  };
  scaleEl.querySelector('[data-close]').onclick = () => toggleScale(false);
  sync();
}
function toggleScale(on = scaleEl.hidden) {
  scaleEl.hidden = !on;
  $('btnScale').classList.toggle('on', on);
  if (on) buildScalePanel();
}
$('btnScale').onclick = () => toggleScale();

// ---------- rocket demo: a launch pad at Home's North Pole ----------
// Physics lives in rocket.js, in system units relative to Home's centre (North Pole = (0, -R)).
const RK = RULES.rocket, MOON = HOME.moons[0];
const tileSu = () => 2 * HOME.r / HOME.surface.W;
const rockets = [];
let rocketSeq = 0, padRocket = null, active = null, follow = false, rocketMode = false;
const envBodies = [{ x: 0, y: 0, r: 1, gm: 0, vx: 0, vy: 0 }, { x: 0, y: 0, r: 1, gm: 0, vx: 0, vy: 0 }];
const rocketEnv = {
  len: 0,
  bodiesAt(t) {                     // Home (at the origin) and the Moon (where it is at time t)
    const H = envBodies[0]; H.r = HOME.r; H.gm = RK.gravity * HOME.r * HOME.r;
    const M = envBodies[1], w = TAU / MOON.period, a = MOON.phase + t * w;
    M.x = Math.cos(a) * MOON.orbit; M.y = Math.sin(a) * MOON.orbit;
    M.vx = -Math.sin(a) * MOON.orbit * w; M.vy = Math.cos(a) * MOON.orbit * w;
    M.r = MOON.r; M.gm = RK.gravity * MOON.r * MOON.r * (MOON.r / HOME.r);
    return envBodies;
  },
};
function newPadRocket(ready) {
  const rk = makeRocket(++rocketSeq);
  rk.parent = HOME; rk.on = 0; rk.offX = 0; rk.offY = -(HOME.r + RK.length * tileSu() / 2);
  if (ready) { rk.state = 'ready'; rk.built = 1; }
  rockets.push(rk); padRocket = rk;
  return rk;
}
newPadRocket(true);
active = padRocket;
function stepRockets(dt) {
  place(HOME);
  rocketEnv.len = RK.length * tileSu();
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  const input = { turn: (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0), throttle: (held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0) };
  for (let i = 0; i < n; i++) {
    const t = simT - dt + (i + 1) * h;
    for (const rk of rockets) stepRocket(rk, h, t, rocketEnv, rk === active ? input : null);
  }
  // the pad rocket lifted off: start building the next one, and ride along with the launch
  if (padRocket.state === 'flying' || padRocket.state === 'crashed') {
    const launched = padRocket;
    newPadRocket(false);
    if (launched === active) { follow = true; rocketMode = true; if (cam.focus !== launched) { cam.fly = null; refocus(launched); } }
  }
  // wreckage clears after a couple of seconds
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rk = rockets[i];
    if (rk.state === 'crashed' && rk.crashT > 2.2) {
      rockets.splice(i, 1);
      if (active === rk) {
        // the rocket you were flying is gone: glide back to Home and put the rocket controls away
        active = rockets.find(r => r.state === 'flying') || padRocket;
        rocketMode = false; follow = false;
        $('btnRocket').classList.remove('on');
        if (cam.focus === rk) flyTo(HOME, HOME.r / 0.4 * 2 * SU * (cw / minDim()));   // Home filling most of the view
      } else if (cam.focus === rk) refocus(HOME);
    }
  }
  for (const rk of rockets) { rk._x = HOME._x + rk.x * SU; rk._y = HOME._y + rk.y * SU; rk._f = frameNo; rk.r = rocketEnv.len / 2; }
}
function toggleEngine() {
  if (!active || active.state === 'building' || active.state === 'crashed') return;
  if (!active.engine && active.fuel <= 0) return;
  active.engine = !active.engine;
  rocketMode = true;
}
function switchRocket() {
  const list = rockets.filter(r => r.state !== 'building' && r.state !== 'crashed');
  if (!list.length) return;
  active = list[(list.indexOf(active) + 1) % list.length];
  rocketMode = true;
  if (follow) { cam.fly = null; refocus(active); }
}
function backToRocket() {
  if (!active || active.state === 'crashed') active = rockets.find(r => r.state === 'flying') || padRocket;
  rocketMode = true; follow = true;
  $('btnRocket').classList.add('on');
  flyTo(active);
}
function toggleFollow() {
  follow = !follow;
  cam.fly = null;
  if (follow && active) refocus(active); else if (cam.focus && cam.focus.kind === 'rocket') refocus(HOME);
}
$('btnRocket').onclick = () => {
  rocketMode = !rocketMode;
  $('btnRocket').classList.toggle('on', rocketMode);
  if (rocketMode) { active = rockets.find(r => r === active && r.state !== 'crashed') || padRocket; follow = true; flyTo(active); }
};

// pixel-art sprites for the pad, the tower and the rocket (drawn on the overlay canvas, crisp)
function pixelSprite(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), put = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  paint(put, g);
  return c;
}
const SPR_ROCKET = pixelSprite(8, 20, put => {
  for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) {
    const body = x >= 2 && x <= 5 && y >= 3 && y <= 16, nose = y < 3 && x >= 3 - (y > 0 ? 1 : 0) && x <= 4 + (y > 0 ? 1 : 0) && (y > 0 || (x === 3 || x === 4));
    const fin = y >= 13 && y <= 17 && (x === 1 || x === 6) || (y >= 15 && y <= 17 && (x === 0 || x === 7));
    const nozzle = y >= 17 && x >= 3 && x <= 4;
    if (nose) put(x, y, '#d8483a');
    else if (body) put(x, y, x === 2 ? '#c9ced8' : x === 5 ? '#9aa1ad' : (y === 7 || y === 8) && (x === 3 || x === 4) ? '#5bb6e8' : y === 11 ? '#d8483a' : '#eef1f5');
    else if (fin) put(x, y, '#b33a30');
    else if (nozzle) put(x, y, '#4a4f58');
  }
});
const SPR_PAD = pixelSprite(18, 6, put => {
  for (let y = 0; y < 6; y++) for (let x = 0; x < 18; x++) {
    if (y === 0) put(x, y, (x >> 1) % 2 ? '#f2c14e' : '#2a2a2e');
    else put(x, y, y === 5 ? '#55585f' : (x + y) % 5 === 0 ? '#80848c' : '#9a9ea6');
  }
});
const SPR_TOWER = pixelSprite(4, 22, put => {
  for (let y = 0; y < 22; y++) for (let x = 0; x < 4; x++) {
    if (x === 0 || x === 3) put(x, y, '#c0392b');
    else if ((y + x) % 4 === 0) put(x, y, '#e05a48');
    if (y === 0) put(x, y, '#ffd34a');
  }
});
const pathBuf = new Float32Array(4000), simBuf = new Float32Array(4000);
let pathN = 0;
const padHit = { x0: 0, y0: 0, x1: 0, y1: 0 }, rocketHits = [];   // screen areas from the last frame, for hover and click
let hoverRocket = null;
// what's under a screen point: a rocket you can fly, the launch pad, or nothing
function rocketAt(x, y) {
  for (const h of rocketHits) if (Math.hypot(x - h.x, y - h.y) <= h.r) return h.rk === padRocket ? 'pad' : h.rk;
  if (x >= padHit.x0 && x <= padHit.x1 && y >= padHit.y0 && y <= padHit.y1) return 'pad';
  return null;
}
function takeControl(rk) {
  active = rk; rocketMode = true; follow = true;
  $('btnRocket').classList.add('on');
  if (cam.focus !== rk) { cam.fly = null; refocus(rk); }
}

// Drawing a path that's mostly off screen is costly (the browser still lays out every dash along the whole
// length), and zoomed in a coarse path also cuts corners. So: skip what's off screen, and add detail where
// the path is visible, aiming for a point every ~8 px.
const VIEW_PAD = 40;
const onView = (x0, y0, x1, y1, pad) => Math.max(x0, x1) > -pad && Math.min(x0, x1) < cw + pad && Math.max(y0, y1) > -pad && Math.min(y0, y1) < ch + pad;
function strokeConic(g, c, hx, hy, k) {
  const pt = (nu, out) => {
    const rr = c.p / (1 + c.e * Math.cos(nu)), a = c.w + nu;
    out[0] = hx + (c.hx + Math.cos(a) * rr) * k; out[1] = hy + (c.hy + Math.sin(a) * rr) * k; out[2] = rr;
  };
  const A = [0, 0, 0], B = [0, 0, 0], P = [0, 0, 0], STEPS = 240;
  const dnu = (c.nuEnd - c.nu0) / STEPS;
  let pen = false;
  pt(c.nu0, A);
  for (let i = 1; i <= STEPS; i++) {
    const nb = c.nu0 + dnu * i;
    pt(nb, B);
    // how far the curve can bow away from the straight chord between two samples
    const bow = Math.max(A[2], B[2]) * k * dnu * dnu / 8 + 2;
    if (onView(A[0], A[1], B[0], B[1], VIEW_PAD + bow)) {
      if (!pen) { g.moveTo(A[0], A[1]); pen = true; }
      const m = Math.min(4000, Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 8)));
      for (let j = 1; j <= m; j++) {
        pt(nb - dnu + dnu * j / m, P);
        if (P[2] < c.rMin) return;                               // reaches the ground
        g.lineTo(P[0], P[1]);
      }
    } else pen = false;
    A[0] = B[0]; A[1] = B[1]; A[2] = B[2];
  }
}
function strokeClipped(g, buf, n, hx, hy, k, sx, sy) {
  let ax = sx, ay = sy, pen = false;
  for (let i = 0; i < n; i++) {
    const bx = hx + buf[i * 2] * k, by = hy + buf[i * 2 + 1] * k;
    if (onView(ax, ay, bx, by, VIEW_PAD)) { if (!pen) { g.moveTo(ax, ay); pen = true; } g.lineTo(bx, by); }
    else pen = false;
    ax = bx; ay = by;
  }
}

function drawRocketLayer(g) {
  if (!rockets.length) return;
  const z = zoom(), [wcx, wcy] = centerWorld();
  place(HOME);
  const hx = (HOME._x - wcx) * z + cw / 2, hy = (HOME._y - wcy) * z + ch / 2, k = SU * z;   // css px per su
  const R0 = HOME.r * k, tile = tileSu() * k;
  if (Math.hypot(hx - cw / 2, hy - ch / 2) - R0 > Math.max(cw, ch) * 3 && !(cam.focus && cam.focus.kind === 'rocket')) return;
  g.save();
  g.imageSmoothingEnabled = false;
  // launch pad and tower at the North Pole (only once they're big enough to see)
  const px = hx, py = hy - R0;
  if (tile * 9 > 5) {
    g.drawImage(SPR_PAD, px - 4.5 * tile, py, 9 * tile, 3 * tile);
    g.drawImage(SPR_TOWER, px + 2.2 * tile, py - 11 * tile, 2 * tile, 11 * tile);
  }
  padHit.x0 = px - Math.max(14, 5 * tile); padHit.x1 = px + Math.max(14, 5 * tile);
  padHit.y0 = py - Math.max(22, 12 * tile); padHit.y1 = py + Math.max(6, 3 * tile);
  if (hoverRocket === 'pad') {
    g.strokeStyle = 'rgba(242,193,78,0.85)'; g.lineWidth = 1.5;
    g.strokeRect(padHit.x0, padHit.y0, padHit.x1 - padHit.x0, padHit.y1 - padHit.y0);
  }
  // where the rocket you're flying will coast: one exact orbit around Home (steady, cheap). Near the Moon its
  // pull matters, so there the path is simulated instead, for at most about one lap
  if (active && active.state === 'flying') {
    const home = rocketEnv.bodiesAt(simT)[0];
    const c = conicPath(active, home, pathBuf, 240);
    let n = c.n, apo = c.apo, peri = c.peri;
    if (!c.closed || c.apoR > MOON.orbit * 0.35) {
      if (frameNo % 10 === 0 || !pathN) pathN = predictPath(active, simT, rocketEnv, simBuf, 900, 0.5);
      pathBuf.set(simBuf.subarray(0, pathN * 2)); n = pathN;
      peri = null; apo = c.closed && c.apo ? apo : null;
    } else pathN = 0;
    if (n > 1) {
      g.strokeStyle = 'rgba(120,220,255,0.75)'; g.lineWidth = 1.5; g.setLineDash([6, 5]);
      g.beginPath();
      if (pathN) strokeClipped(g, pathBuf, n, hx, hy, k, hx + active.x * k, hy + active.y * k);
      else strokeConic(g, c, hx, hy, k);
      g.stroke(); g.setLineDash([]);
      const mark = (pt, label, col) => {
        const x = hx + pt.x * k, y = hy + pt.y * k;
        g.fillStyle = col; g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill();
        g.font = '600 11px "Segoe UI", system-ui, sans-serif';
        g.fillText(`${label} · ${fmt(Math.round(pt.alt / tileSu()))} tiles`, x + 7, y - 6);
      };
      if (apo) mark(apo, 'Highest', '#ffd36e');
      if (peri) mark(peri, 'Lowest', '#8fe3ff');
    }
  } else pathN = 0;
  rocketHits.length = 0;
  // rockets
  for (const rk of rockets) {
    const x = hx + rk.x * k, y = hy + rk.y * k;
    if (x < -200 || y < -200 || x > cw + 200 || y > ch + 200) continue;
    const hgt = Math.max(30, RK.length * tile), wid = hgt * 0.4;
    if (rk.state !== 'crashed' && rk.state !== 'building') rocketHits.push({ rk, x, y, r: Math.max(12, hgt / 2) });
    if (rk.state === 'crashed') {
      const t = rk.crashT, a = Math.max(0, 1 - t / 2.2);
      for (let j = 0; j < 3; j++) {
        g.fillStyle = `rgba(${255},${150 - j * 40},${40},${a * (0.7 - j * 0.2)})`;
        g.beginPath(); g.arc(x, y, (6 + t * 26) * (1 - j * 0.25), 0, TAU); g.fill();
      }
      continue;
    }
    g.save();
    g.translate(x, y); g.rotate(rk.angle);
    const thrusting = rk.engine && rk.fuel > 0 && rk.throttle > 0 && rk.state !== 'building';
    if (thrusting) {                                         // flickering flame out of the nozzle
      const fl = hgt * (0.3 + 0.6 * rk.throttle) * (0.85 + Math.random() * 0.3);
      g.fillStyle = 'rgba(255,140,40,0.85)';
      g.beginPath(); g.moveTo(-wid * 0.22, hgt / 2); g.lineTo(wid * 0.22, hgt / 2); g.lineTo(0, hgt / 2 + fl); g.fill();
      g.fillStyle = 'rgba(255,240,170,0.95)';
      g.beginPath(); g.moveTo(-wid * 0.12, hgt / 2); g.lineTo(wid * 0.12, hgt / 2); g.lineTo(0, hgt / 2 + fl * 0.55); g.fill();
    }
    if (rk.state === 'building') {                           // rising out of its scaffolding, bottom first
      const shown = Math.max(0.02, rk.built);
      g.globalAlpha = 0.55;
      g.drawImage(SPR_ROCKET, 0, 20 * (1 - shown), 8, 20 * shown, -wid / 2, hgt / 2 - hgt * shown, wid, hgt * shown);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(242,193,78,0.7)'; g.lineWidth = 1;
      g.strokeRect(-wid / 2 - 2, -hgt / 2, wid + 4, hgt);
    } else g.drawImage(SPR_ROCKET, -wid / 2, -hgt / 2, wid, hgt);
    if (rk === hoverRocket) { g.strokeStyle = 'rgba(242,193,78,0.85)'; g.lineWidth = 1; g.strokeRect(-wid / 2 - 4, -hgt / 2 - 4, wid + 8, hgt + 8); }
    g.restore();
    if (rk.state === 'building' && tile * 9 > 5) {
      g.font = '600 11px "Segoe UI", system-ui, sans-serif'; g.fillStyle = '#ffe6a6';
      g.fillText(`Building ${Math.floor(rk.built * 100)}%`, x + wid, y);
    }
  }
  g.restore();
}

// the readout: fuel, throttle, height, speed, orbit
const hudEl = $('rocketHud');

// on-screen controls for touch screens: throttle bar on the left; engine, turn and camera buttons on the right
const touchEl = $('touch'), touchUI = coarse || navigator.maxTouchPoints > 0;
const engineBtn = touchEl.querySelector('.engine'), thrEl = touchEl.querySelector('.thr'), thrFill = thrEl.querySelector('.fill');
touchEl.addEventListener('contextmenu', e => e.preventDefault());
touchEl.querySelectorAll('[data-hold]').forEach(b => {             // hold to turn
  const k = b.dataset.hold;
  const off = () => { held.delete(k); b.classList.remove('down'); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } held.add(k); b.classList.add('down'); });
  b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
});
const TAPS = { engine: toggleEngine, back: backToRocket, next: switchRocket, follow: toggleFollow };
touchEl.querySelectorAll('[data-tap]').forEach(b => b.addEventListener('click', () => { TAPS[b.dataset.tap](); updateTouch(); updateRocketHud(); }));
const setThrottle = e => {                                         // drag up and down the bar
  const r = thrEl.getBoundingClientRect();
  if (active) active.throttle = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
  updateTouch();
};
thrEl.addEventListener('pointerdown', e => { e.preventDefault(); try { thrEl.setPointerCapture(e.pointerId); } catch (err) { /* gone */ } setThrottle(e); });
thrEl.addEventListener('pointermove', e => { if (thrEl.hasPointerCapture && thrEl.hasPointerCapture(e.pointerId)) setThrottle(e); });
function updateTouch() {
  const show = touchUI && rocketMode;
  touchEl.hidden = !show;
  document.body.classList.toggle('touchfly', show);              // other panels make room for the controls
  if (!show || !active) return;
  // sit just above the bottom bar, however many rows it wraps to
  document.documentElement.style.setProperty('--above-bar', (innerHeight - $('bar').getBoundingClientRect().top + 10) + 'px');
  const burning = active.engine && active.fuel > 0;
  engineBtn.classList.toggle('on', burning);
  engineBtn.textContent = active.state === 'building' ? 'Building…' : active.engine ? (active.fuel > 0 ? 'Engine ON' : 'No fuel') : 'Engine';
  thrFill.style.height = (active.throttle * 100).toFixed(0) + '%';
  thrEl.querySelector('span').textContent = `Throttle ${Math.round(active.throttle * 100)}%`;
  touchEl.querySelector('[data-tap="follow"]').classList.toggle('on', follow);
}

function updateRocketHud() {
  const show = rocketMode;
  hudEl.hidden = !show;
  if (!show || !active) return;
  const rk = active, home = rocketEnv.bodiesAt(simT)[0], tl = tileSu();
  const alt = Math.max(0, Math.hypot(rk.x, rk.y) - HOME.r - rocketEnv.len / 2), spd = Math.hypot(rk.vx, rk.vy);
  const status = { building: 'Being built', ready: 'On the pad', flying: alt < RK.atmosphere ? 'Flying · in the atmosphere (drag)' : 'Flying · in space (no drag)',
    landed: rk.on === 1 ? 'Landed on the Moon' : 'Landed', crashed: 'Crashed' }[rk.state];
  let orbit = '';
  if (rk.state === 'flying') {
    const o = orbitAround(rk, home);
    orbit = o.escaping ? 'Escaping Home’s pull' :
      o.peri > RK.atmosphere ? `In orbit · lowest ${fmt(Math.round(o.peri / tl))} · highest ${fmt(Math.round(o.apo / tl))} tiles` :
      `Highest point ${fmt(Math.round(o.apo / tl))} tiles · not in orbit yet`;
  }
  const pad = padRocket.state === 'ready' ? 'ready' : `building ${Math.floor(padRocket.built * 100)}%`;
  const bar = (v, col) => `<i><b style="width:${(v * 100).toFixed(1)}%;background:${col}"></b></i>`;
  hudEl.innerHTML = `<div class="t">${rk.name}<span class="st">${status}</span></div>
    <div class="g"><span>Fuel</span>${bar(rk.fuel / RK.fuel, rk.fuel / RK.fuel < 0.2 ? '#e0604e' : '#f2c14e')}<em>${Math.round(rk.fuel / RK.fuel * 100)}%</em></div>
    <div class="g"><span>Throttle</span>${bar(rk.throttle, '#7fd6ff')}<em>${Math.round(rk.throttle * 100)}%</em></div>
    <div class="row">Engine <b class="${rk.engine && rk.fuel > 0 ? 'on' : ''}">${rk.engine ? (rk.fuel > 0 ? 'ON' : 'OUT OF FUEL') : 'off'}</b> · height ${fmt(Math.round(alt / tl))} tiles · speed ${fmt(Math.round(spd / tl))} tiles/s</div>
    ${orbit ? `<div class="row">${orbit}</div>` : ''}
    <div class="row dim">Next rocket: ${pad}${rockets.filter(r => r.state === 'flying').length > 1 ? ` · ${rockets.filter(r => r.state === 'flying').length} in flight` : ''}</div>
    ${touchUI ? '' : `<div class="keys">Space engine · Q/E throttle · A/D turn · R back to rocket · Tab switch · F follow ${follow ? '(on)' : '(off)'}</div>`}`;
}

// ---------- start: on Home, then let the player zoom out ----------
cam.focus = HOME;
place(HOME);
cam.logZ = cam.tz = Math.log2(0.32 * minDim() / (HOME.r * SU));   // Home about two-thirds of the screen across
select(coarse ? null : HOME);      // on phones the info card waits for a tap, so it doesn't cover the planet
updateUI(true);
requestAnimationFrame(frame);
window.__demo = { G, cam, pages, flyTo, R, centerWorld, zoom, levelsOf, rockets, get active() { return active; }, padHit, get SU() { return SU; }, get scale() { return scale; } };
