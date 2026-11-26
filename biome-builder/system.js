// The Biome Builder's solar system: a blue star with the mix planet on the inside and one planet per biome further out,
// laid out by the Galaxy demo's rules for a blue giant's system (rules.js stars.blue), and drawn exactly the way the Galaxy demo draws planets (the same WebGL renderer and shaders, maps built in background workers as a
// pyramid of 256 x 256 chunks, items drawn as pictures). The chunk and drawing code follows galaxy-demo/js/main.js
// (wantPage, pump, onPage, drawBody, setPage, drawPropsOn): keep them in step when one changes.
// World coordinates are tiles, with the star at (0, 0).
import { Renderer } from '../galaxy-demo/js/renderer.js?v=20261125190144';
import { buildAtlas } from '../galaxy-demo/js/art.js?v=20261125190144';
import { SKIN } from '../galaxy-demo/js/skin.js?v=20261125190144';
import { RULES } from '../galaxy-demo/js/rules.js?v=20261125190144';
import { hash32, mulberry32, range } from '../galaxy-demo/js/rng.js?v=20261125190144';
import { makeSampler } from '../galaxy-demo/js/terrain.js?v=20261125190144';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const PAGE = 256;
const ATMO = RULES.planetTypes.terran.atmo;
const BLUE = RULES.stars.blue;
const STAR = { r: 70, color: BLUE.color };               // r (tiles) is set by setPlanets
const GOLDEN = Math.PI * (3 - Math.sqrt(5));             // each planet this far round from the last: they never line up
const PROP_REACH = [1.5, 3];                             // how far a size-1 item reaches from its foot, in tiles

export function createSystem(canvas, overlay, hooks) {
  const R = new Renderer(canvas);
  const art = buildAtlas(SKIN);
  R.makeAtlas(art.data);
  R.water = [SKIN.base.DEEP.c, SKIN.base.SHALLOW.c];
  const og = overlay.getContext('2d');

  // ---------- planets and their map chunks ----------
  let planets = [];                                      // { name, x, y, W, orbit, desc, version, prevVersion, again, sampler }
  const pages = new Map(), jobs = [];
  let frameNo = 0, buildMs = 0;
  const workers = [];
  const NW = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3);
  for (let i = 0; i < NW; i++) {
    const w = new Worker(new URL('../galaxy-demo/js/mapworker.js?v=20261125190144', import.meta.url), { type: 'module' });
    w.busy = null;
    w.onmessage = e => { onPage(e.data); w.busy = null; pump(); };
    w.onerror = e => { console.error('map worker', e.message); w.busy = null; };
    workers.push(w);
  }
  const levelsOf = pl => {
    if (!pl.lv || pl.lv.W !== pl.W) {
      const W = pl.W, Lmax = Math.max(0, Math.ceil(Math.log2(W / PAGE))), N = [];
      for (let L = 0; L <= Lmax; L++) N.push(Math.ceil(W / 2 ** (Lmax - L)));
      pl.lv = { W, Lmax, N };
    }
    return pl.lv;
  };
  const keyOf = (pl, ver, L, px, py) => `${pl.name}/${ver}/${L}/${px}/${py}`;
  function wantPage(pl, L, px, py, pri) {
    const N = levelsOf(pl).N[L], key = keyOf(pl, pl.version, L, px, py);
    let p = pages.get(key);
    if (!p) {
      const x0 = px * PAGE, y0 = py * PAGE, sx = Math.min(PAGE, N - x0), sy = Math.min(PAGE, N - y0);
      p = { key, pl, ver: pl.version, L, px, py, N, x0, y0, sx, sy, W: sx, H: sy, uv: [x0 / N, y0 / N, sx / N, sy / N],
        ids: null, col: null, fld: null, ready: false, used: frameNo, pri, desc: pl.desc };
      pages.set(key, p); jobs.push(p);
    }
    p.used = frameNo; p.pri = pri;
    return p;
  }
  // this version's chunk if built, else the same chunk of the version before (no flicker while a change rebuilds)
  function pageFor(pl, L, px, py, pri) {
    const p = wantPage(pl, L, px, py, pri);
    if (p.ready) return p;
    const old = pages.get(keyOf(pl, pl.prevVersion, L, px, py));
    if (old && old.ready) { old.used = frameNo; return old; }
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
      w.postMessage({ job: 0, key: p.key, desc: p.desc, N: p.N, x0: p.x0, y0: p.y0, sx: p.sx, sy: p.sy, L: p.L });
    }
  }
  function onPage(d) {
    buildMs = d.ms;
    const p = pages.get(d.key);
    if (!p) return;
    p.ids = R.makeIdTexture(p.sx + 2, p.sy + 2); p.col = R.makeColorTexture(p.sx, p.sy); p.fld = R.makeColorTexture(p.sx, p.sy, true);
    R.uploadBand(p.ids, p.col, p.sx, 0, p.sy, d.idsA, d.col, p.fld, d.fld);
    R.mipmap(p.col, p.fld);
    if (d.props) { p.big = R.makePropBuffer(d.props); p.small = R.makePropBuffer(d.small); }
    p.ready = true;
    const pl = p.pl;
    if (p.ver === pl.version && p.L === 0) {
      for (const q of [...pages.values()]) if (q.pl === pl && q.ver !== pl.version && q.ver !== pl.prevVersion) freePage(q);
      if (pl.again) { pl.again = false; bump(pl); }
    }
  }
  function freePage(p) {
    if (p.ids) R.freeMap(p.ids, p.col, p.fld, p.sx, p.sy);
    if (p.big) { R.freePropBuffer(p.big); R.freePropBuffer(p.small); }
    pages.delete(p.key);
    const j = jobs.indexOf(p);
    if (j >= 0) jobs.splice(j, 1);
  }
  const pageBytes = p => p.sx * p.sy * 14.7 + (p.big ? p.big.bytes + p.small.bytes : 0);
  function evictPages() {
    if (frameNo % 10) return;
    for (let i = jobs.length - 1; i >= 0; i--) if (frameNo - jobs[i].used > 20) { pages.delete(jobs[i].key); jobs.splice(i, 1); }
    const budget = 200 * 1048576;
    let total = 0;
    const list = [];
    for (const p of pages.values()) if (p.ready) { total += pageBytes(p); list.push(p); }
    if (total <= budget) return;
    list.sort((a, b) => a.used - b.used);
    for (const p of list) {
      if (frameNo - p.used < 30 || total <= budget) break;
      if (p.L === 0 && p.ver === p.pl.version) continue;
      total -= pageBytes(p);
      freePage(p);
    }
  }
  function bump(pl) {
    pl.prevVersion = pl.version;
    pl.version++;
    for (const q of [...pages.values()]) if (q.pl === pl && q.ver < pl.prevVersion) freePage(q);
  }

  // ---------- camera: (x, y) = the world point (tiles) at the screen's centre; z = device px per tile ----------
  const cam = { x: 0, y: 0, logZ: 0, tz: 0, ax: 0, ay: 0, vx: 0, vy: 0, fly: null };
  let dpr = 1, quality = 1, extent = 600;
  const zoom = () => 2 ** cam.logZ;
  const minLogZ = () => Math.log2(Math.min(R.w, R.h) * 0.4 / extent);
  const maxLogZ = () => Math.log2(96 * dpr);
  function applyZoom(nlz, ax, ay) {
    const z0 = zoom();
    const wx = cam.x + (ax - R.w / 2) / z0, wy = cam.y + (ay - R.h / 2) / z0;
    cam.logZ = nlz;
    const z = zoom();
    cam.x = wx - (ax - R.w / 2) / z; cam.y = wy - (ay - R.h / 2) / z;
    clampCam();
  }
  function clampCam() { cam.x = clamp(cam.x, -extent, extent); cam.y = clamp(cam.y, -extent, extent); }
  // a smooth flight to (x, y) at zoom logZ
  function flyTo(x, y, logZ, ms) {
    const to = [x, y, clamp(logZ, minLogZ(), maxLogZ())];
    ms = ms || clamp(700 + Math.abs(to[2] - cam.logZ) * 110, 900, 2200);   // longer for a big change of zoom
    cam.fly = { t0: performance.now(), ms, from: [cam.x, cam.y, cam.logZ], to };
    cam.vx = cam.vy = 0;
  }
  function stepFly(now) {
    const f = cam.fly;
    if (!f) return;
    const t = clamp((now - f.t0) / f.ms, 0, 1), e = t * t * (3 - 2 * t);
    cam.x = f.from[0] + (f.to[0] - f.from[0]) * e; cam.y = f.from[1] + (f.to[1] - f.from[1]) * e;
    cam.logZ = f.from[2] + (f.to[2] - f.from[2]) * e;
    cam.tz = cam.logZ; cam.ax = R.w / 2; cam.ay = R.h / 2;
    if (t >= 1) cam.fly = null;
  }
  function overview() { flyTo(0, 0, minLogZ() + 0.15); }
  function resize() {
    const old = dpr;
    dpr = Math.max(0.75, Math.min(devicePixelRatio || 1, 2) * quality);
    if (old !== dpr) { const k = Math.log2(dpr / old); cam.logZ += k; cam.tz += k; }
    const r = canvas.getBoundingClientRect();
    R.resize(Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr)));
    overlay.width = R.w; overlay.height = R.h;
  }
  const toScreen = (x, y) => { const z = zoom(); return [(x - cam.x) * z + R.w / 2, (y - cam.y) * z + R.h / 2]; };
  const toWorld = (sx, sy) => { const z = zoom(); return [cam.x + (sx - R.w / 2) / z, cam.y + (sy - R.h / 2) / z]; };
  const planetAt = (wx, wy) => planets.find(pl => Math.hypot(wx - pl.x, wy - pl.y) <= pl.W / 2) || null;

  // ---------- drawing ----------
  const bp = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, R: 0, mode: 0, pix: 1, lx: 0, ly: 0, lz: 1, c1: [0, 0, 0], c2: [0, 0, 0], c3: [0, 0, 0],
    fx: true, tpp: 0, atmo: ATMO, atmoH: 0.05, seed: 0, time: 0, alpha: 1, map: null, art: 0, lod: 0, page: [0, 0, 1, 1],
    detail: false, ringIn: 0, ringOut: 0, ringA: 0, ringGap: 0 };
  const rect = (cx, cy, Rd, ext) => {
    bp.x0 = Math.max(0, cx - Rd * ext - 2); bp.y0 = Math.max(0, cy - Rd * ext - 2);
    bp.x1 = Math.min(R.w, cx + Rd * ext + 2); bp.y1 = Math.min(R.h, cy + Rd * ext + 2);
    return bp.x1 > bp.x0 && bp.y1 > bp.y0;
  };
  function drawStar(time) {
    const [cx, cy] = toScreen(0, 0), Rd = STAR.r * zoom();
    if (!rect(cx, cy, Rd, 3.4)) return;
    Object.assign(bp, { cx, cy, R: Rd, mode: 2, pix: Math.max(2, Math.min(5, Rd / 120)) * dpr, map: null, art: 0, lod: 0,
      page: [0, 0, 1, 1], detail: false, c1: STAR.color, c2: [STAR.color[0] * 0.6, STAR.color[1] * 0.68, STAR.color[2] * 0.8],
      c3: [255, 255, 255], seed: 3.7, time, alpha: 1, lx: 0, ly: 0, lz: 1, atmo: [0, 0, 0, 0] });
    R.body(bp);
  }
  function setPage(pl, p, D) {
    bp.page = p ? p.uv : [0, 0, 1, 1]; bp.detail = false; bp.map = p; bp.art = 0; bp.pix = 2 * dpr; bp.lod = 0;
    if (!p) return;
    const perPx = p.N / D;
    if (p.L === levelsOf(pl).Lmax) { bp.art = clamp((1.15 - 8 * perPx) / 0.45, 0, 1); if (bp.art > 0) bp.pix = 1; }
    bp.lod = Math.log2(Math.max(1, perPx * bp.pix));
  }
  function drawPlanet(pl, time) {
    const z = zoom(), W = pl.W, lv = levelsOf(pl);
    const [cx, cy] = toScreen(pl.x, pl.y), Rd = W / 2 * z, D = 2 * Rd;
    if (!rect(cx, cy, Rd, 1.15)) return;
    // light from the star
    const ll = Math.hypot(pl.x, pl.y) || 1;
    Object.assign(bp, { cx, cy, R: Rd, mode: 0, tpp: W / D, time, seed: (pl.desc.seed % 997) / 9.7, alpha: 1,
      c1: pl.dot, c2: pl.dot, c3: pl.dot, atmo: ATMO, atmoH: 0.05, fx: true, lx: -pl.x / ll, ly: pl.y / ll, lz: 0 });
    const focus = pl === hooks.focusPlanet() ? 1e6 : 0;
    const base = pageFor(pl, 0, 0, 0, 4e6 + focus + Rd);
    const Lt = Math.min(lv.Lmax, Math.max(0, Math.ceil(Math.log2(D * 0.4 / lv.N[0]))));
    const lists = [];
    let topDone = true;
    const sx0 = cx - Rd, sy0 = cy - Rd;
    for (let L = Math.max(1, Lt - 2); L <= Lt && Lt >= 1; L++) {
      const N = lv.N[L], k = D / N, list = [];
      const pxA = Math.max(0, Math.floor(-sx0 / k / PAGE)), pxB = Math.min(Math.ceil(N / PAGE) - 1, Math.floor((R.w - sx0) / k / PAGE));
      const pyA = Math.max(0, Math.floor(-sy0 / k / PAGE)), pyB = Math.min(Math.ceil(N / PAGE) - 1, Math.floor((R.h - sy0) / k / PAGE));
      for (let py = pyA; py <= pyB; py++) for (let px = pxA; px <= pxB; px++) {
        const rx0 = sx0 + px * PAGE * k, ry0 = sy0 + py * PAGE * k, rx1 = sx0 + (px + 1) * PAGE * k, ry1 = sy0 + (py + 1) * PAGE * k;
        const nx = clamp(cx, rx0, rx1) - cx, ny = clamp(cy, ry0, ry1) - cy;
        if (nx * nx + ny * ny > Rd * Rd) continue;
        let p = null;
        if (L >= Lt - 1) {
          const off = Math.hypot((rx0 + rx1) / 2 - R.w / 2, (ry0 + ry1) / 2 - R.h / 2);
          p = pageFor(pl, L, px, py, 2e6 + focus - (Lt - L === 0 ? 5e4 : 0) - off);
        } else {
          p = pages.get(keyOf(pl, pl.version, L, px, py)) || pages.get(keyOf(pl, pl.prevVersion, L, px, py));
          if (p) p.used = frameNo;
        }
        const ok = !!(p && p.ready);
        if (L === Lt && !ok) topDone = false;
        list.push(ok ? p : null, rx0, ry0, rx1, ry1);
      }
      lists.push(list);
    }
    const inside = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < Rd * Rd * 0.98;
    const screenInDisk = inside(0, 0) && inside(R.w, 0) && inside(0, R.h) && inside(R.w, R.h);
    if (!(Lt >= 1 && topDone && screenInDisk)) {
      setPage(pl, base.ready ? base : null, D);
      R.body(bp);
    }
    for (let li = topDone ? Math.max(0, lists.length - 1) : 0; li < lists.length; li++) {
      const list = lists[li];
      for (let i = 0; i < list.length; i += 5) {
        const p = list[i];
        if (!p) continue;
        bp.x0 = Math.max(0, list[i + 1]); bp.y0 = Math.max(0, list[i + 2]); bp.x1 = Math.min(R.w, list[i + 3]); bp.y1 = Math.min(R.h, list[i + 4]);
        setPage(pl, p, D);
        bp.detail = true;
        R.body(bp);
      }
    }
    bp.detail = false;
    drawItems(pl, cx, cy, Rd, focus);
  }
  // items (trees, rocks, shrubs, grass) as pictures, as in the demo's drawPropsOn
  function drawItems(pl, cx, cy, Rd, focus) {
    const lv = levelsOf(pl), L = lv.Lmax, N = lv.N[L], D = 2 * Rd;
    const alpha = clamp((1.15 - 8 * N / D) / 0.45, 0, 1);
    if (alpha <= 0 || !view.items) return;
    const k = D / N, sx0 = cx - Rd, sy0 = cy - Rd, C = Math.ceil(N / PAGE);
    const [sx, sy] = R.shadowReach();                      // shadows of items just off screen reach into it
    const mx = (PROP_REACH[0] + sx) * view.propMax * k, my = PROP_REACH[1] * view.propMax * k, ms = sy * view.propMax * k;
    const pxA = Math.max(0, Math.floor((-mx - sx0) / k / PAGE)), pxB = Math.min(C - 1, Math.floor((R.w + mx - sx0) / k / PAGE));
    const pyA = Math.max(0, Math.floor((-ms - sy0) / k / PAGE)), pyB = Math.min(C - 1, Math.floor((R.h + my - sy0) / k / PAGE));
    const items = [];
    for (let py = pyA; py <= pyB; py++) for (let px = pxA; px <= pxB; px++) {
      const rx0 = sx0 + px * PAGE * k, ry0 = sy0 + py * PAGE * k, rx1 = rx0 + PAGE * k, ry1 = ry0 + PAGE * k;
      const nx = clamp(cx, rx0, rx1) - cx, ny = clamp(cy, ry0, ry1) - cy;
      if (nx * nx + ny * ny > Rd * Rd) continue;
      const p = pageFor(pl, L, px, py, 2e6 + focus - Math.hypot((rx0 + rx1) / 2 - R.w / 2, (ry0 + ry1) / 2 - R.h / 2));
      if (p.ready && p.big) items.push({ big: p.big, small: p.small, fld: p.fld, chunk: [p.x0, p.y0, p.sx, p.sy] });
    }
    R.drawProps(items, { cx, cy, R: Rd, W8: N * 8, tpp: pl.W / D, alpha, shadows: view.shadows });
  }
  function drawLabels() {
    const z = zoom();
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.clearRect(0, 0, overlay.width, overlay.height);
    // the orbits, faintly, while the system is in view
    const ringA = clamp(1.6 - Math.log2(z * extent / Math.min(R.w, R.h)), 0, 1) * 0.22;
    if (ringA > 0.01 && planets.length) {
      const [cx, cy] = toScreen(0, 0);
      og.strokeStyle = `rgba(160, 190, 255, ${ringA})`; og.lineWidth = dpr;
      for (const pl of planets) { og.beginPath(); og.arc(cx, cy, pl.orbit * z, 0, Math.PI * 2); og.stroke(); }
    }
    for (const pl of planets) {
      const Rp = pl.W / 2 * z;
      const a = clamp((260 * dpr - Rp) / (120 * dpr), 0, 1);       // names fade out once a planet fills the view
      if (a <= 0.02) continue;
      const [x, y] = toScreen(pl.x, pl.y + pl.W / 2);
      og.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`;
      og.textAlign = 'center';
      og.fillStyle = `rgba(230, 236, 246, ${a})`;
      og.fillText(pl.label, x, y + 16 * dpr);
      if (pl.badge) { og.fillStyle = `rgba(242, 193, 78, ${a})`; og.fillText(pl.badge, x, y + 31 * dpr); }
    }
    if (hooks.overlay) hooks.overlay(og, view);
  }

  // ---------- the frame ----------
  let last = performance.now(), simT = 0;
  const perf = { frames: 0, t0: last, fps: 0, ema: 16.7, slowFor: 0, fastFor: 0, quality: 1 };
  function frame(now) {
    requestAnimationFrame(frame);
    if (!planets.length) return;
    const dtMs = Math.min(100, now - last), dt = dtMs / 1000;
    last = now; simT += dt; frameNo++;
    perf.ema += (dtMs - perf.ema) * 0.05;
    if (now > 4000 && !document.hidden) {
      if (perf.ema > 38) { perf.slowFor += dt; perf.fastFor = 0; } else if (perf.ema < 20) { perf.fastFor += dt; perf.slowFor = 0; } else { perf.slowFor = perf.fastFor = 0; }
      if (perf.slowFor > 2 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); resize(); perf.slowFor = 0; }
      if (perf.fastFor > 8 && quality < 1) { quality = Math.min(1, quality + 0.15); resize(); perf.fastFor = 0; }
    }
    perf.quality = quality;
    stepFly(now);
    if (!cam.fly) {
      const target = clamp(cam.tz, minLogZ(), maxLogZ());
      cam.tz = target;
      if (Math.abs(target - cam.logZ) > 1e-5) applyZoom(cam.logZ + (target - cam.logZ) * (1 - Math.exp(-dt * 16)), cam.ax, cam.ay);
      if (!ptrs.size && (cam.vx || cam.vy)) {
        const z = zoom();
        cam.x -= cam.vx * dt / z; cam.y -= cam.vy * dt / z; clampCam();
        const k = Math.exp(-dt * 5); cam.vx *= k; cam.vy *= k;
        if (Math.abs(cam.vx) + Math.abs(cam.vy) < 2) cam.vx = cam.vy = 0;
      }
    }
    render(simT);
    evictPages();
    pump();
    drawLabels();
    perf.frames++;
    if (now - perf.t0 > 500) {
      perf.fps = perf.frames * 1000 / (now - perf.t0);
      perf.frames = 0; perf.t0 = now;
      if (hooks.perf) hooks.perf(perf, buildMs);
    }
  }
  function render(time) {
    R.begin();
    R.sky(Math.max(2, 3 * dpr), 0.9);
    drawStar(time);
    for (const pl of planets) drawPlanet(pl, time);
  }
  requestAnimationFrame(frame);

  // ---------- input: drag to move, wheel / pinch to zoom, click a planet ----------
  const ptrs = new Map();
  let drag = null, pinch = null;
  const devXY = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
  // what's under a device-pixel point: the planet, and the tile on it (0..W from its top-left corner)
  function pick(x, y) {
    const [wx, wy] = toWorld(x, y), pl = planetAt(wx, wy);
    return pl ? { planet: pl, x: wx - pl.x + pl.W / 2, y: wy - pl.y + pl.W / 2 } : null;
  }
  canvas.addEventListener('pointerdown', e => {
    if (!planets.length) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = devXY(e);
    ptrs.set(e.pointerId, { x, y });
    cam.vx = cam.vy = 0; cam.fly = null;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
      return;
    }
    drag = { x, y, moved: false, t: performance.now() };
  });
  canvas.addEventListener('pointermove', e => {
    if (!planets.length) return;
    const [x, y] = devXY(e);
    view.hover = pick(x, y);
    if (hooks.hover) hooks.hover(view.hover);
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x, y });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.ax = (a.x + b.x) / 2; cam.ay = (a.y + b.y) / 2;
      cam.tz += Math.log2(d / pinch.d); applyZoom(cam.tz, cam.ax, cam.ay);
      pinch.d = d;
    } else if (drag) {
      const dx = x - drag.x, dy = y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4 * dpr) drag.moved = true;
      if (drag.moved) {
        const z = zoom(), t = performance.now(), dtm = Math.max(1, t - drag.t) / 1000;
        cam.x -= dx / z; cam.y -= dy / z; clampCam();
        cam.vx = dx / dtm * 0.5 + cam.vx * 0.5; cam.vy = dy / dtm * 0.5 + cam.vy * 0.5;
        drag.x = x; drag.y = y; drag.t = t;
      }
    }
  });
  const end = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && !drag.moved) { cam.vx = cam.vy = 0; const [x, y] = devXY(e); const hit = pick(x, y); if (hit) hooks.tap(hit); }
    if (drag && performance.now() - drag.t > 80) cam.vx = cam.vy = 0;
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { view.hover = null; if (hooks.hover) hooks.hover(null); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = devXY(e);
    cam.fly = null; cam.ax = x; cam.ay = y;
    cam.tz = clamp(cam.tz - e.deltaY * 0.0022, minLogZ(), maxLogZ());
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- what the Builder calls ----------
  const view = {
    R, hover: null, items: true, shadows: true,
    propMax: 1,                          // the largest item size in use: how far beyond the view to look for items
    get planets() { return planets; },
    get zoom() { return zoom(); },
    get dpr() { return dpr; },
    // The planets to show, innermost first: [{ name, label, badge, W, desc, dot, land: [u, v] }] (land = a spot on
    // dry land, -1..1 across the disk, for visit). Planets already shown keep their maps unless their description
    // changed (then they rebuild in the background, the old map shown until the new one is ready).
    // Layout: a blue giant's system from the Galaxy demo's rules (rules.js stars.blue): the first orbit at firstOrbit
    // system units and each one 1.13-1.22x the one before, in units of su tiles (about a planet's radius). spread
    // shrinks the distances and the star (1 = the rules' own distances); planets keep their size.
    setPlanets(list, { su = 512, spread = 0.25 } = {}) {
      const first = !planets.length;
      const old = new Map(planets.map(p => [p.name, p]));
      const rnd = mulberry32(hash32(20261125, 7));
      STAR.r = BLUE.radius * spread * su;
      let orbit = 0, prevW = 0;
      planets = list.map((p, i) => {
        const gap = (prevW + p.W) / 2 + su;              // never closer than a planet radius between neighbours' edges
        orbit = i === 0 ? Math.max(BLUE.firstOrbit * spread * su, STAR.r + p.W / 2 + su * 2)
          : Math.max(orbit * range(rnd, BLUE.spacing[0], BLUE.spacing[1]), orbit + gap);
        prevW = p.W;
        const a = -Math.PI / 2 + i * GOLDEN;
        let pl = old.get(p.name);
        const changed = !pl || pl.W !== p.W || JSON.stringify(pl.desc) !== JSON.stringify(p.desc);
        if (!pl) pl = { name: p.name, version: 0, prevVersion: -1, again: false };
        else old.delete(p.name);
        Object.assign(pl, { label: p.label, badge: p.badge, dot: p.dot, land: p.land || [0, 0], orbit,
          x: Math.cos(a) * orbit, y: Math.sin(a) * orbit });
        if (changed) {
          const resized = pl.W !== p.W;
          pl.W = p.W; pl.desc = p.desc; pl.sampler = null;
          if (resized) { for (const q of [...pages.values()]) if (q.pl === pl) freePage(q); pl.prevVersion = -1; pl.version++; }
          else if ([...pages.values()].some(q => q.pl === pl && q.ver === pl.version && q.L === 0 && !q.ready)) pl.again = true;
          else bump(pl);
        }
        return pl;
      });
      for (const pl of old.values()) for (const q of [...pages.values()]) if (q.pl === pl) freePage(q);
      extent = orbit + prevW;
      if (first) { cam.logZ = cam.tz = minLogZ() + 0.15; }
    },
    groundAt(hit) {
      const pl = hit.planet;
      if (!pl.sampler) pl.sampler = makeSampler(pl.desc);
      return pl.sampler.classify(hit.x / pl.W * 2 - 1, hit.y / pl.W * 2 - 1);
    },
    // fly to a planet, close enough to see its items: to (u, v) on it (-1..1 across the disk), else its dry land
    visit(name, u, v) {
      const pl = planets.find(p => p.name === name);
      if (!pl) return;
      if (u === undefined) [u, v] = pl.land;
      flyTo(pl.x + u * pl.W / 2, pl.y + v * pl.W / 2, Math.log2(Math.max(Math.min(R.w, R.h) * 0.9 / pl.W, 14 * dpr)));
    },
    // fly out until the whole planet shows
    frame(name) {
      const pl = planets.find(p => p.name === name);
      if (pl) flyTo(pl.x, pl.y, Math.log2(Math.min(R.w, R.h) * 0.8 / pl.W));
    },
    overview,
    // the planet nearest the middle of the screen, if one fills a good part of it
    centred() {
      let best = null, bd = Infinity;
      for (const pl of planets) { const d = Math.hypot(pl.x - cam.x, pl.y - cam.y); if (d < bd) { bd = d; best = pl; } }
      return best && bd < best.W && best.W * zoom() > Math.min(R.w, R.h) * 0.3 ? best : null;
    },
    toScreen,
    // draw n frames back to back and wait for the GPU: ms per frame at the current view
    bench(n = 30) {
      const px = new Uint8Array(4), gl = R.gl;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) render(simT + i / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { msPerFrame: +((performance.now() - t0) / n).toFixed(2), size: [R.w, R.h], pxPerTile: +(zoom() / dpr).toFixed(1) };
    },
    // jump the camera: world point (x, y) in the middle, at ppt CSS px per tile
    look(x, y, ppt) { cam.fly = null; cam.x = x; cam.y = y; cam.logZ = cam.tz = Math.log2(ppt * dpr); cam.vx = cam.vy = 0; },
  };
  return view;
}
