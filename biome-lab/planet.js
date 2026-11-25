// One planet, drawn exactly the way the Galaxy demo draws planets: the same WebGL renderer and terrain shader,
// maps built in background workers as a pyramid of 256 x 256 chunks, only the chunks on screen at the detail the
// zoom needs. The chunk and drawing code follows galaxy-demo/js/main.js (wantPage, pump, onPage, drawBody,
// setPage): keep the two in step when one changes.
import { Renderer } from '../galaxy-demo/js/renderer.js?v=20261124234308';
import { buildAtlas } from '../galaxy-demo/js/art.js?v=20261124234308';
import { SKIN } from '../galaxy-demo/js/skin.js?v=20261124234308';
import { RULES } from '../galaxy-demo/js/rules.js?v=20261124234308';
import { makeSampler } from '../galaxy-demo/js/terrain.js?v=20261124234308';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const PAGE = 256;
const ATMO = RULES.planetTypes.terran.atmo, DOT = RULES.planetTypes.terran.dot;

export function createPlanetView(canvas, overlay, hooks) {
  const R = new Renderer(canvas);
  const art = buildAtlas(SKIN);
  R.makeAtlas(art.data);
  R.water = [SKIN.base.DEEP.c, SKIN.base.SHALLOW.c];
  const og = overlay.getContext('2d');

  // ---------- the planet and its chunks ----------
  let desc = null, version = 0, prevVersion = -1, sampler = null;
  let again = false;                       // the planet changed again while its new map was being built
  const pages = new Map(), jobs = [];
  let frameNo = 0, buildMs = 0;
  const workers = [];
  const NW = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 3);
  for (let i = 0; i < NW; i++) {
    const w = new Worker(new URL('../galaxy-demo/js/mapworker.js?v=20261124234308', import.meta.url), { type: 'module' });
    w.busy = null;
    w.onmessage = e => { onPage(e.data); w.busy = null; pump(); };
    w.onerror = e => { console.error('map worker', e.message); w.busy = null; };
    workers.push(w);
  }
  const levels = () => {
    const W = desc.W, Lmax = Math.max(0, Math.ceil(Math.log2(W / PAGE))), N = [];
    for (let L = 0; L <= Lmax; L++) N.push(Math.ceil(W / 2 ** (Lmax - L)));
    return { W, Lmax, N };
  };
  let lv = null;
  const keyOf = (ver, L, px, py) => `${ver}/${L}/${px}/${py}`;
  function wantPage(L, px, py, pri) {
    const N = lv.N[L], key = keyOf(version, L, px, py);
    let p = pages.get(key);
    if (!p) {
      const x0 = px * PAGE, y0 = py * PAGE, sx = Math.min(PAGE, N - x0), sy = Math.min(PAGE, N - y0);
      p = { key, ver: version, L, px, py, N, x0, y0, sx, sy, W: sx, H: sy, uv: [x0 / N, y0 / N, sx / N, sy / N],
        ids: null, col: null, fld: null, ready: false, used: frameNo, pri, desc };
      pages.set(key, p); jobs.push(p);
    }
    p.used = frameNo; p.pri = pri;
    return p;
  }
  // the chunk to draw: this version's if built, else the same chunk of the version before (no flicker while
  // a change is being rebuilt)
  function pageFor(L, px, py, pri) {
    const p = wantPage(L, px, py, pri);
    if (p.ready) return p;
    const old = pages.get(keyOf(prevVersion, L, px, py));
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
    p.ids = R.makeIdTexture(p.sx, p.sy); p.col = R.makeColorTexture(p.sx, p.sy); p.fld = R.makeColorTexture(p.sx, p.sy, true);
    R.uploadBand(p.ids, p.col, p.sx, 0, p.sy, d.ids, d.col, p.fld, d.fld);
    R.mipmap(p.col, p.fld);
    p.ready = true;
    if (p.ver === version && p.L === 0) {
      // the new whole-planet map is in: the version before isn't needed any more
      for (const q of [...pages.values()]) if (q.ver !== version && q.ver !== prevVersion) freePage(q);
      if (again) { again = false; bump(); }
    }
  }
  function freePage(p) {
    if (p.ids) R.freeMap(p.ids, p.col, p.fld, p.sx, p.sy);
    pages.delete(p.key);
    const j = jobs.indexOf(p);
    if (j >= 0) jobs.splice(j, 1);
  }
  function evictPages() {
    if (frameNo % 10) return;
    for (let i = jobs.length - 1; i >= 0; i--) if (frameNo - jobs[i].used > 20) { pages.delete(jobs[i].key); jobs.splice(i, 1); }
    const budget = 160 * 1048576;
    let total = 0;
    const list = [];
    for (const p of pages.values()) if (p.ready) { total += p.sx * p.sy * 14.7; list.push(p); }
    if (total <= budget) return;
    list.sort((a, b) => a.used - b.used);
    for (const p of list) {
      if (frameNo - p.used < 30 || total <= budget) break;
      if (p.L === 0 && p.ver === version) continue;
      total -= p.sx * p.sy * 14.7;
      freePage(p);
    }
  }
  function bump() {
    prevVersion = version;
    version++;
    // anything older than the version still on screen can go
    for (const q of [...pages.values()]) if (q.ver < prevVersion) freePage(q);
  }

  // ---------- camera: (x, y) = the tile at the screen's centre, measured from the planet's centre ----------
  const cam = { x: 0, y: 0, logZ: 0, tz: 0, ax: 0, ay: 0, vx: 0, vy: 0 };
  let dpr = 1;
  const zoom = () => 2 ** cam.logZ;                         // device px per tile
  const minLogZ = () => Math.log2(Math.min(R.w, R.h) * 0.3 / desc.W);
  const maxLogZ = () => Math.log2(96 * dpr);
  function applyZoom(nlz, ax, ay) {
    const z0 = zoom();
    const wx = cam.x + (ax - R.w / 2) / z0, wy = cam.y + (ay - R.h / 2) / z0;
    cam.logZ = nlz;
    const z = zoom();
    cam.x = wx - (ax - R.w / 2) / z; cam.y = wy - (ay - R.h / 2) / z;
    clampCam();
  }
  function clampCam() { const h = desc.W / 2; cam.x = clamp(cam.x, -h, h); cam.y = clamp(cam.y, -h, h); }
  function fit() {
    cam.x = cam.y = 0;
    cam.tz = Math.log2(Math.min(R.w, R.h) * 0.86 / desc.W);
    cam.ax = R.w / 2; cam.ay = R.h / 2;
  }

  // render resolution: device pixels per CSS pixel, lowered automatically when frames are slow (as in the demo)
  let quality = 1;
  function resize() {
    const old = dpr;
    dpr = Math.max(0.75, Math.min(devicePixelRatio || 1, 2) * quality);
    if (old !== dpr && desc) { const k = Math.log2(dpr / old); cam.logZ += k; cam.tz += k; }   // same view, new pixels
    const r = canvas.getBoundingClientRect();
    R.resize(Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr)));
    overlay.width = R.w; overlay.height = R.h;
  }

  // ---------- drawing ----------
  const bp = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, R: 0, mode: 0, pix: 1, lx: 0, ly: 0, lz: 1, c1: DOT, c2: DOT, c3: DOT,
    fx: true, tpp: 0, atmo: ATMO, atmoH: 0.05, seed: 0, time: 0, alpha: 1, map: null, art: 0, lod: 0, page: [0, 0, 1, 1],
    detail: false, ringIn: 0, ringOut: 0, ringA: 0, ringGap: 0 };
  function setPage(p, D) {
    bp.page = p ? p.uv : [0, 0, 1, 1]; bp.detail = false; bp.map = p; bp.art = 0; bp.pix = 2 * dpr; bp.lod = 0;
    if (!p) return;
    const perPx = p.N / D;                                     // samples per device pixel
    if (p.L === lv.Lmax) { bp.art = clamp((1.15 - 8 * perPx) / 0.45, 0, 1); if (bp.art > 0) bp.pix = 1; }
    bp.lod = Math.log2(Math.max(1, perPx * bp.pix));
  }
  function drawPlanet(time) {
    const z = zoom(), W = desc.W;
    const cx = R.w / 2 - cam.x * z, cy = R.h / 2 - cam.y * z, Rd = W / 2 * z, D = 2 * Rd;
    const ext = 1.15;
    bp.x0 = Math.max(0, cx - Rd * ext - 2); bp.y0 = Math.max(0, cy - Rd * ext - 2);
    bp.x1 = Math.min(R.w, cx + Rd * ext + 2); bp.y1 = Math.min(R.h, cy + Rd * ext + 2);
    if (bp.x1 <= bp.x0 || bp.y1 <= bp.y0) return;
    bp.cx = cx; bp.cy = cy; bp.R = Rd; bp.tpp = W / D; bp.time = time; bp.seed = (desc.seed % 997) / 9.7;
    const base = pageFor(0, 0, 0, 4e6);
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
          p = pageFor(L, px, py, 2e6 - (Lt - L === 0 ? 5e4 : 0) - off);
        } else {
          p = pages.get(keyOf(version, L, px, py)) || pages.get(keyOf(prevVersion, L, px, py));
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
      setPage(base.ready ? base : null, D);
      R.body(bp);
    }
    for (let li = topDone ? Math.max(0, lists.length - 1) : 0; li < lists.length; li++) {
      const list = lists[li];
      for (let i = 0; i < list.length; i += 5) {
        const p = list[i];
        if (!p) continue;
        bp.x0 = Math.max(0, list[i + 1]); bp.y0 = Math.max(0, list[i + 2]); bp.x1 = Math.min(R.w, list[i + 3]); bp.y1 = Math.min(R.h, list[i + 4]);
        setPage(p, D);
        bp.detail = true;
        R.body(bp);
      }
    }
    bp.detail = false;
  }

  // ---------- the frame ----------
  let last = performance.now(), simT = 0;
  const perf = { frames: 0, t0: last, fps: 0, cpu: 0, cpuAcc: 0, ema: 16.7, slowFor: 0, fastFor: 0, quality: 1 };
  function frame(now) {
    requestAnimationFrame(frame);
    if (!desc) return;
    const dtMs = Math.min(100, now - last);
    const dt = dtMs / 1000;
    // adaptive quality, the demo's rule: slower than ~26 fps for 2 s drops the resolution a step, faster than
    // 50 fps for 8 s raises it again (a steady 30 fps is usually a browser cap, not overload)
    perf.ema += (dtMs - perf.ema) * 0.05;
    if (now > 4000 && !document.hidden) {
      if (perf.ema > 38) { perf.slowFor += dt; perf.fastFor = 0; } else if (perf.ema < 20) { perf.fastFor += dt; perf.slowFor = 0; } else { perf.slowFor = perf.fastFor = 0; }
      if (perf.slowFor > 2 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); resize(); perf.slowFor = 0; }
      if (perf.fastFor > 8 && quality < 1) { quality = Math.min(1, quality + 0.15); resize(); perf.fastFor = 0; }
    }
    perf.quality = quality;
    last = now; simT += dt; frameNo++;
    const c0 = performance.now();
    const target = clamp(cam.tz, minLogZ(), maxLogZ());
    cam.tz = target;
    if (Math.abs(target - cam.logZ) > 1e-5) applyZoom(cam.logZ + (target - cam.logZ) * (1 - Math.exp(-dt * 16)), cam.ax, cam.ay);
    if (!ptrs.size && (cam.vx || cam.vy)) {
      const z = zoom();
      cam.x -= cam.vx * dt / z; cam.y -= cam.vy * dt / z; clampCam();
      const k = Math.exp(-dt * 5); cam.vx *= k; cam.vy *= k;
      if (Math.abs(cam.vx) + Math.abs(cam.vy) < 2) cam.vx = cam.vy = 0;
    }
    R.begin();
    R.sky(Math.max(2, 3 * dpr), 0.9);
    drawPlanet(simT);
    evictPages();
    pump();
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.clearRect(0, 0, overlay.width, overlay.height);
    if (hooks.overlay) hooks.overlay(og, view);
    perf.cpuAcc += performance.now() - c0;
    perf.frames++;
    if (now - perf.t0 > 500) {
      perf.fps = perf.frames * 1000 / (now - perf.t0); perf.cpu = perf.cpuAcc / perf.frames;
      perf.frames = 0; perf.cpuAcc = 0; perf.t0 = now;
      if (hooks.perf) hooks.perf(perf, buildMs);
    }
  }
  requestAnimationFrame(frame);

  // ---------- input: drag to move, wheel / pinch to zoom; taps and paint strokes go to the lab ----------
  const ptrs = new Map();
  let drag = null, pinch = null;
  const devXY = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
  // tile position (0..W from the disk's top-left corner) under a device-pixel point
  const tileAt = (x, y) => { const z = zoom(); return { x: cam.x + (x - R.w / 2) / z + desc.W / 2, y: cam.y + (y - R.h / 2) / z + desc.W / 2 }; };
  canvas.addEventListener('pointerdown', e => {
    if (!desc) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = devXY(e);
    ptrs.set(e.pointerId, { x, y });
    cam.vx = cam.vy = 0;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
      return;
    }
    const paint = hooks.painting() && e.button === 0;
    drag = { x, y, moved: false, paint, t: performance.now() };
    if (paint) hooks.paint(tileAt(x, y), true);
  });
  canvas.addEventListener('pointermove', e => {
    if (!desc) return;
    const [x, y] = devXY(e);
    view.hover = tileAt(x, y);
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
      if (drag.paint) hooks.paint(tileAt(x, y), false);
      else if (drag.moved) {
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
    if (drag && !drag.moved && !drag.paint) { cam.vx = cam.vy = 0; const [x, y] = devXY(e); hooks.tap(tileAt(x, y)); }
    if (drag && drag.paint) hooks.paintEnd();
    if (drag && performance.now() - drag.t > 80) cam.vx = cam.vy = 0;   // held still before letting go: no glide
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { view.hover = null; if (hooks.hover) hooks.hover(null); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [x, y] = devXY(e);
    cam.ax = x; cam.ay = y;
    cam.tz = clamp(cam.tz - e.deltaY * 0.0022, minLogZ(), maxLogZ());
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- what the lab calls ----------
  const view = {
    R, hover: null,
    get desc() { return desc; },
    get zoom() { return zoom(); },
    get dpr() { return dpr; },
    // a new planet description (anything changed): rebuilt in the background, the old one shown until it's ready
    setPlanet(d, refit) {
      const first = !desc, resized = desc && desc.W !== d.W;
      desc = d; lv = levels(); sampler = null;
      if (first || resized) {
        for (const q of [...pages.values()]) freePage(q);
        prevVersion = -1; version++;
        if (first || refit) { fit(); cam.logZ = cam.tz; }
        return;
      }
      const building = [...pages.values()].some(p => p.ver === version && p.L === 0 && !p.ready);
      if (building) again = true; else bump();
    },
    // which ground type is under a tile position (worked out here, the same way the workers do)
    groundAt(t) {
      if (!desc) return -1;
      const u = t.x / desc.W * 2 - 1, v = t.y / desc.W * 2 - 1;
      if (u * u + v * v > 1) return -1;
      if (!sampler) sampler = makeSampler(desc);
      return sampler.classify(u, v);
    },
    // draw n frames back to back and wait for the GPU: ms per frame at the current view (for checking speed even
    // when the page is in a background tab, where the browser slows animation down)
    bench(n = 30) {
      const px = new Uint8Array(4), gl = R.gl;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { R.begin(); R.sky(Math.max(2, 3 * dpr), 0.9); drawPlanet(simT + i / 60); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { msPerFrame: +((performance.now() - t0) / n).toFixed(2), size: [R.w, R.h], pxPerTile: +(zoom() / dpr).toFixed(1) };
    },
    // jump the camera: tile (tx, ty) in the middle, at ppt CSS px per tile
    look(tx, ty, ppt) { cam.x = tx - desc.W / 2; cam.y = ty - desc.W / 2; cam.logZ = cam.tz = Math.log2(ppt * dpr); cam.vx = cam.vy = 0; },
    toScreen(tx, ty) { const z = zoom(); return [(tx - desc.W / 2 - cam.x) * z + R.w / 2, (ty - desc.W / 2 - cam.y) * z + R.h / 2]; },
    fit,
  };
  return view;
}
