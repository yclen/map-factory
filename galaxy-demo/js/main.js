// Galaxy demo: a 1,000-star spiral galaxy you can zoom through continuously, down to the tiles of a planet.
// World positions are JS doubles in galaxy units; the camera is subtracted before anything reaches the GPU.
import { RULES } from './rules.js';
import { SKIN } from './skin.js';
import { generateGalaxy, galaxyPoint, heatWord, surfaceSize } from './galaxy.js';
import { buildAtlas } from './art.js';
import { Renderer } from './renderer.js';
import { Labels } from './labels.js';
import { mulberry32, hash32 } from './rng.js';
import { BASE, BASE_NAME, OVER, RESOURCES, RESOURCE_NAME, SLOT_WALKER, SLOT_PIN, WATER } from './ids.js';

const TAU = Math.PI * 2;
let SU = 1e-6;                  // galaxy units per Home radius: set by the distance ladder (applyScale)
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const SEED = (+params.get('seed') | 0) || RULES.galaxy.seed;

// ---------- setup ----------
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
  if (b.kind === 'star' || b._f === frameNo) return;
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
  if (!f || cam.fly) return;
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
  let reach = b.r * (b.rings ? b.rings.outer : 1) / 0.42;
  for (const m of b.moons) reach = Math.max(reach, (m.orbit + m.r) * 1.15);
  if (b.moons.length === 0) reach = b.r / 0.42;
  return reach * 2 * SU * k;
}
function flyTo(b) {
  cam.vx = cam.vy = 0;
  refocus(b);
  const w0 = cw / zoom(), w1 = fitWidth(b);
  const f = interpolateZoom([cam.ox, cam.oy, w0], [0, 0, w1]);
  cam.fly = { f, end: [0, 0, w1], t0: performance.now(), dur: clamp(f.duration * 0.42, 700, 3200) };
  if (b) select(b);
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

// ---------- maps: requested from background workers, kept in a small cache ----------
const maps = new Map();          // body uid -> { low, full }
const jobs = [];
let jobSeq = 0, mapsMs = 0, mapsBuilt = 0;
const workers = [];
const NW = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3);
for (let i = 0; i < NW; i++) {
  const w = new Worker(new URL('./mapworker.js', import.meta.url), { type: 'module' });
  w.busy = null;
  w.onmessage = e => { onMapBand(e.data); w.busy = null; pump(); };
  w.onerror = e => { console.error('map worker', e.message); w.busy = null; };
  workers.push(w);
}
const bodyByUid = new Map(G.bodies.map(b => [b.uid, b]));
function descOf(b) {
  return { id: b.uid, seed: b.seed, type: b.type, r: b.r, W: b.surface.W, heat: b.heat, settle: b.settle, home: b.home };
}
function wantMap(b, level) {
  let m = maps.get(b.uid);
  if (!m) { m = { low: null, full: null }; maps.set(b.uid, m); }
  m.used = frameNo;
  if (m[level]) { m[level].used = frameNo; return; }
  const { W, H } = b.surface;
  const lw = level === 'low' ? Math.min(128, W) : W, lh = lw / 2;
  const bands = level === 'low' ? 1 : Math.ceil(lh / 64);
  m[level] = { W: lw, H: lh, ids: null, col: null, done: 0, bands, ready: false, counts: new Uint32Array(64),
    cpu: level === 'full' ? new Uint8Array(lw * lh * 2) : null, used: frameNo };
  for (let k = 0; k < bands; k++) {
    jobs.push({ job: ++jobSeq, b, level, W: lw, H: lh, y0: k * 64 * (level === 'full' ? 1 : 0), y1: level === 'full' ? Math.min(lh, (k + 1) * 64) : lh });
  }
  pump();
}
function pump() {
  for (const w of workers) {
    if (w.busy || !jobs.length) continue;
    let bi = -1, best = -Infinity;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i], b = j.b;
      const score = (j.level === 'low' ? 1e6 : 0) + (b === cam.focus ? 5e5 : 0) + (b._want || 0) - (frameNo - (b._seen || 0)) * 10;
      if (score > best) { best = score; bi = i; }
    }
    const j = jobs.splice(bi, 1)[0];
    w.busy = j;
    w.postMessage({ job: j.job, desc: descOf(j.b), W: j.W, H: j.H, level: j.level, y0: j.y0, y1: j.y1 });
  }
}
function onMapBand(d) {
  const b = bodyByUid.get(d.id), m = maps.get(d.id);
  mapsMs += d.ms; mapsBuilt++;
  if (!m || !m[d.level]) return;                            // evicted while building
  const L = m[d.level];
  if (L.W !== d.W) return;                                   // built for an older map size
  if (!L.ids) { L.ids = R.makeIdTexture(L.W, L.H); L.col = R.makeColorTexture(L.W, L.H); }
  R.uploadBand(L.ids, L.col, L.W, d.y0, d.y1 - d.y0, d.ids, d.col);
  if (L.cpu) L.cpu.set(d.ids, d.y0 * L.W * 2);
  for (let i = 0; i < 64; i++) L.counts[i] += d.counts[i];
  if (!b.settlements) b.settlements = d.settlements;
  if (++L.done === L.bands) {
    R.mipmap(L.col); L.ready = true;
    if (d.level === 'full' || !b.counts) b.counts = L.counts;
    if (d.level === 'full') { b.cpu = L.cpu; if (b === cam.focus) walkersDirty = true; }
  }
}
function evictMaps() {
  if (frameNo % 30) return;
  const full = [], low = [];
  for (const [uid, m] of maps) {
    if (m.full && m.full.ready) full.push([uid, m]);
    if (m.low && m.low.ready) low.push([uid, m]);
  }
  const drop = (list, level, keep) => {
    if (list.length <= keep) return;
    list.sort((a, b) => a[1][level].used - b[1][level].used);
    for (let i = 0; i < list.length - keep; i++) {
      const [uid, m] = list[i], L = m[level];
      if (frameNo - L.used < 20) continue;
      R.freeMap(L.ids, L.col, L.W, L.H);
      m[level] = null;
      if (level === 'full') { const b = bodyByUid.get(uid); b.cpu = null; }
    }
  };
  drop(full, 'full', 8); drop(low, 'low', 160);
  // forget queued work for bodies nobody has looked at for a while
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (frameNo - (j.b._seen || 0) > 240 && j.b !== selected) {
      const m = maps.get(j.b.uid);
      if (m && m[j.level] && !m[j.level].ready) m[j.level] = null;
      jobs.splice(i, 1);
    }
  }
}
function mapFor(b) {
  const m = maps.get(b.uid);
  if (!m) return null;
  if (m.full && m.full.ready) return m.full;
  if (m.low && m.low.ready) return m.low;
  return null;
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
const NO_ATMO = [0, 0, 0, 0], WHITE = [255, 255, 255];
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
  const W = b.surface.W, tile = 2 / W, cpu = b.cpu, sets = b.settlements || [];
  for (let tries = 0; walkN < n && tries < n * 6; tries++) {
    let u, v;
    if (sets.length && r() < 0.75) {
      const s = sets[(r() * sets.length) | 0], rad = (s.radius + 3) * tile * Math.sqrt(r()), a = r() * TAU;
      u = s.u + Math.cos(a) * rad; v = s.v + Math.sin(a) * rad;
    } else { const a = r() * TAU, d = Math.sqrt(r()) * 0.97; u = Math.cos(a) * d; v = Math.sin(a) * d; }
    if (u * u + v * v > 0.95) continue;
    if (cpu) {
      const tx = clamp(Math.floor((u * 0.5 + 0.5) * W), 0, W - 1), ty = clamp(Math.floor((v * 0.5 + 0.5) * W), 0, W - 1);
      if (WATER.has(cpu[(ty * W + tx) * 2])) continue;
    }
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
  evictMaps();
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
  bp.ringIn = 0; bp.ringOut = 0; bp.ringA = 0; bp.ringGap = 0; bp.atmo = NO_ATMO;
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
  if (b.atmo) bp.atmo = b.atmo;
  wantMap(b, 'low');
  if (d.R > 40 || b === cam.focus) wantMap(b, 'full');
  const map = mapFor(b);
  bp.pix = 2 * s;
  if (map) {
    bp.map = map;
    const texPerPx = map.W / (2 * Rd);                // tiles per device pixel
    if (map.cpu) {
      bp.art = clamp((1.15 - 8 * texPerPx) / 0.45, 0, 1);
      if (bp.art > 0) bp.pix = 1;
    }
    bp.lod = Math.log2(Math.max(1, texPerPx * bp.pix));
  }
  R.body(bp);
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
});

// ---------- UI ----------
let selected = null;
function select(b) { selected = b; if (b && b.surface) wantMap(b, 'low'); updateUI(true); }
const perfEl = $('perf'), infoEl = $('info'), tipEl = $('tip'), crumbsEl = $('crumbs');
let perfOn = !coarse || params.has('perf'), autoQuality = true;
perfEl.hidden = !perfOn;
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
$('btnPerf').classList.toggle('on', perfOn);
$('btnHelp').onclick = () => { $('help').hidden = !$('help').hidden; };
$('help').onclick = () => { $('help').hidden = true; };

function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
function updatePerf() {
  if (!perfOn) return;
  let full = 0, low = 0;
  for (const m of maps.values()) { if (m.full && m.full.ready) full++; if (m.low && m.low.ready) low++; }
  const heap = performance.memory ? ` · heap ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : '';
  const zText = zoom() >= 1 ? `${fmt(Math.round(zoom()))} px/gu` : `1 px = ${(1 / zoom()).toFixed(1)} gu`;
  perfEl.innerHTML =
    `<b>${perf.fps.toFixed(0)} fps</b> · frame ${perf.avg.toFixed(1)} ms (worst ${perf.worst.toFixed(0)}) · JS ${perf.cpu.toFixed(2)} ms<br>` +
    `  └ stars ${partsAvg[0].toFixed(2)} · gpu ${partsAvg[1].toFixed(2)} · spheres ${partsAvg[2].toFixed(2)} · labels ${partsAvg[3].toFixed(2)} · ui ${partsAvg[4].toFixed(2)}<br>` +
    `draw calls ${R.draws} · sprites ${fmt(sprN)} · spheres ${bodiesDrawn}${walkN && cam.focus === walkFor ? ` · walkers ${fmt(walkN)}` : ''}<br>` +
    `maps ${full} full / ${low} far · queued ${jobs.length} · built ${mapsBuilt} (${mapsBuilt ? (mapsMs / mapsBuilt).toFixed(0) : 0} ms avg, ${NW} workers)<br>` +
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
  if (hover && !ptrs.size) {
    const b = pickAt(hover.x, hover.y);
    let txt = b ? `<b>${b.name}</b> · ${b.kind === 'star' ? RULES.stars[b.type].name : b.typeName}` : '';
    if (b && b.kind === 'star') txt = '';          // a hovered star shows its name label instead
    const f = cam.focus;
    if (f && f.surface && f.cpu) {
      const d = drawList.slice(0, drawN).find(x => x.b === f);
      if (d) {
        const u = (hover.x - d.x) / d.R, v = (hover.y - d.y) / d.R;
        if (u * u + v * v <= 1) {
          const W = f.surface.W;
          const tx = clamp(Math.floor((u * 0.5 + 0.5) * W), 0, W - 1), ty = clamp(Math.floor((v * 0.5 + 0.5) * W), 0, W - 1);
          const i = (ty * W + tx) * 2, base = f.cpu[i], ov = f.cpu[i + 1];
          txt = `<b>${f.name}</b> · ${BASE_NAME[BASE[base]]}${ov ? ' · ' + (RESOURCE_NAME[OVER[ov]] ? RESOURCE_NAME[OVER[ov]] + ' deposit' : 'buildings') : ''} <span class="dim">tile ${tx}, ${ty}</span>`;
        }
      }
    }
    tipEl.hidden = !txt;
    if (txt) { tipEl.innerHTML = txt; tipEl.style.left = (hover.x + 14) + 'px'; tipEl.style.top = (hover.y + 16) + 'px'; }
  } else tipEl.hidden = true;
  // info panel
  infoEl.hidden = coarse && !selected;
  if (frameNo % 30 === 0 || force) infoEl.innerHTML = infoHTML(selected);
  const fly = infoEl.querySelector('[data-fly]');
  if (fly && !fly.onclick) fly.onclick = () => flyTo(selected);
  const close = infoEl.querySelector('[data-close]');
  if (close && !close.onclick) close.onclick = () => select(null);
}
function infoHTML(b) {
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
const KNOBS = [
  { key: 'homeTiles', label: 'Home size', min: 96, max: 1024, log: false, step: 32, text: v => `${v} tiles across` },
  { key: 'moonDistance', label: 'Home → Moon', min: 1.5, max: 120, log: true, text: v => `${nice(v)} Home radii` },
  { key: 'sunDistance', label: 'Home → Sun', min: 2, max: 800, log: true, text: v => `${nice(v)} Moon distances` },
  { key: 'starDistance', label: 'Sun → nearest star', min: 1e3, max: 1e7, log: true, text: v => `${nice(v)} Sun distances` },
];
function nice(v) {
  if (v >= 1000) { const p = 10 ** (Math.floor(Math.log10(v)) - 1); return (Math.round(v / p) * p).toLocaleString('en-US'); }
  return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}
const toSlider = (k, v) => k.log ? Math.round(1000 * Math.log(v / k.min) / Math.log(k.max / k.min)) : v;
const fromSlider = (k, t) => k.log ? +nice(k.min * (k.max / k.min) ** (t / 1000)).replace(/,/g, '') : +t;
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
  for (const m of maps.values()) for (const level of ['low', 'full']) {
    const L = m[level];
    if (L && L.ids) R.freeMap(L.ids, L.col, L.W, L.H);
  }
  maps.clear(); jobs.length = 0;
  for (const b of G.bodies) { b.settlements = null; b.counts = null; b.cpu = null; }
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

// ---------- start: on Home, then let the player zoom out ----------
cam.focus = HOME;
place(HOME);
cam.logZ = cam.tz = Math.log2(0.32 * minDim() / (HOME.r * SU));   // Home about two-thirds of the screen across
select(coarse ? null : HOME);      // on phones the info card waits for a tap, so it doesn't cover the planet
updateUI(true);
requestAnimationFrame(frame);
window.__demo = { G, cam, maps, flyTo, R, centerWorld, zoom };
