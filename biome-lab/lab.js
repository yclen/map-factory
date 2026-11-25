// Biome Lab: a small sandbox world for designing biomes with the AI art.
// Defaults come from the game (galaxy-demo/js/skin.js, art/props/props.json); the lab stores only what you
// change, in this browser, and Export turns your changes into lines for skin.js / props.json.
import { SKIN } from '../galaxy-demo/js/skin.js';
import { BASE, BASE_NAME } from '../galaxy-demo/js/ids.js';
import { loadAll, tilesPerPx, canvas } from './assets.js';
import { generateTiles, makeWorld, refine, buildMasks, scatter, draw, biomeAt } from './world.js';

const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));
const WATER = ['DEEP', 'SHALLOW'];
const LAND = BASE.filter(n => !['DEEP', 'SHALLOW', 'BEACH', 'LAVA', 'SEA_ICE', 'ICE_CRACK'].includes(n));
const DEFAULT_BIOMES = ['GRASS', 'FOREST', 'TAIGA', 'SNOW', 'SAVANNA', 'DESERT', 'JUNGLE'];

// which ground texture names suit which biome (first one that has art wins); any texture can be picked by hand
const GROUND_FOR = {
  GRASS: ['grass'], FOREST: ['forestfloor', 'grass'], JUNGLE: ['junglefloor', 'grass'], SWAMP: ['mud'],
  SAVANNA: ['drygrass', 'sand'], DESERT: ['sand'], DUNES: ['dunes', 'sand'], BEACH: ['beachsand', 'sand'],
  MESA: ['redsand', 'sand'], SALT: ['salt'], TUNDRA: ['tundra'], TAIGA: ['needles', 'forestfloor'],
  SNOW: ['snow'], ICE: ['ice', 'snow'], MOUNTAIN: ['rock'], PEAK: ['snow', 'rock'], SHALLOW: ['shallows'],
  DEEP: ['water'], ASH: ['ash'], OBSIDIAN: ['obsidian'], BASALT: ['basalt'], SULFUR: ['sulfur'],
  REGOLITH: ['regolith'], HIGHLAND: ['rock'], CRATER: ['regolith'], RUST: ['rust'], CANYON: ['redsand'],
};
// suggested prompts for art that doesn't exist yet: [subject, biome theme, size]
const GROUND_IDEAS = {
  grass: ['short green meadow grass with a little clover', 'forest'],
  forestfloor: ['forest floor of brown leaf litter, moss and small twigs on dark soil', 'forest'],
  junglefloor: ['dark damp jungle floor of wet fallen leaves, roots and moss', 'jungle'],
  mud: ['dark wet swamp mud with moss, a faint wet sheen and a few reeds lying flat', 'forest'],
  drygrass: ['dry golden savanna grass, short and trampled, with dusty soil showing between', 'savanna'],
  sand: ['fine pale golden desert sand with soft, shallow wind ripples', 'savanna'],
  dunes: ['rippled orange-gold dune sand with long parallel wind ripples', 'savanna'],
  beachsand: ['damp pale beach sand with tiny shell fragments', 'jungle'],
  redsand: ['red-orange desert sand and gravel', 'rocks'],
  salt: ['a white salt flat crust cracked into irregular plates', 'rocks'],
  tundra: ['tundra of low grey-green moss, lichen and small stones', 'taiga'],
  needles: ['pine forest floor of brown needles and a few cones on dark soil', 'taiga'],
  snow: ['fresh packed snow with faint wind-carved ridges', 'taiga'],
  ice: ['smooth blue-white glacier ice with faint cracks and trapped bubbles', 'taiga'],
  rock: ['bare grey mountain rock with cracks and loose gravel', 'rocks'],
  water: ['deep clear lake water seen from above, dark blue with gentle ripples', null],
  shallows: ['shallow clear lake water over pale sand, turquoise, with gentle ripples', null],
  ash: ['grey volcanic ash with small dark cinders', 'rocks'], obsidian: ['glossy black obsidian ground with sharp cracks', 'rocks'],
  basalt: ['dark grey basalt ground with small pits', 'rocks'], sulfur: ['yellow sulfur crust with pale cracks', 'rocks'],
  regolith: ['grey moon dust with small pebbles and tiny craters', 'rocks'], rust: ['rust-red iron-rich dust and gravel', 'rocks'],
};
const PROP_IDEAS = {
  oak: ['broadleaf oak trees with a rounded leafy crown and a short brown trunk', 'forest'],
  oak2: ['oak trees, one in autumn orange', 'forest'], birch: ['slender white-barked birch trees', 'forest'],
  blossom: ['cherry blossom trees with soft pink flowering crowns', 'forest'],
  willow: ['weeping willow trees with long drooping branches', 'forest'],
  deadtree: ['dead leafless trees with bare grey twisted branches', null],
  saguaro: ['tall saguaro cacti with upturned arms', 'savanna'], palm: ['coconut palm trees', 'jungle'],
  jungle: ['tall jungle trees with dense dark crowns', 'jungle'], acacia: ['flat-topped acacia trees', 'savanna'],
  pine: ['tall pine trees', 'taiga'], fir: ['narrow fir trees', 'taiga'], snowpine: ['pine trees with snow on the branches', 'taiga'],
  boulder: ['grey granite boulders', 'rocks', 0.6], mossy: ['grey boulders with patches of green moss', 'rocks', 0.6],
  sandrock: ['sandstone boulders', 'rocks', 0.6], redrock: ['red sandstone boulders', 'rocks', 0.6],
  snowrock: ['grey boulders with snow on top', 'rocks', 0.6], darkrock: ['dark volcanic basalt boulders', 'rocks', 0.6],
  sulfrock: ['yellow sulfur-crusted rocks', 'rocks', 0.6], iceblock: ['chunky blocks of blue glacier ice', 'rocks', 0.7],
  columns: ['clusters of dark hexagonal basalt columns', 'rocks', 0.8],
};

// ---------- settings: defaults + what you changed ----------

const STORE = 'biomeLab.v1';
const WORLD_DEFAULT = { seed: 7, size: 128, lake: 0.3, beach: 2, regions: 9, warp: 0.6, wiggle: 0.8, soft: 0.6,
  biomes: DEFAULT_BIOMES };
const VIEW_DEFAULT = { shadow: 0.38, shadowLen: 0.6, mirror: true, props: true, decor: true, grid: false, focus: false,
  ruler: false };
let over = { world: {}, view: {}, biomes: {}, kinds: {} };
let painted = null;                      // the tile map, once you've painted on it
try {
  const s = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (s) { over = { ...over, ...s.over }; if (s.painted) painted = s.painted; }
} catch { /* private window */ }
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ over, painted: painted && painted.n === world.N ? painted : null }));
    } catch { /* full or blocked */ }
  }, 300);
}

let A = null;                            // loaded art
const worldP = () => ({ ...WORLD_DEFAULT, ...over.world });
const viewP = () => ({ ...VIEW_DEFAULT, ...over.view });

function latestTexture(names) {
  for (const n of names || []) {
    const t = Object.values(A.textures).filter(t => t.name === n).sort((a, b) => b.v - a.v)[0];
    if (t) return t.file;
  }
  return 'pixel';
}
const count = list => list.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
function biomeDefault(name) {
  const pf = SKIN.propsFor[name] || [0, []], df = SKIN.decorFor[name] || [0, []];
  return { ground: latestTexture(GROUND_FOR[name]), texTiles: 8, bright: 1, sat: 1, hue: 0,
    density: pf[0], cluster: 0, clump: 8, jitter: 0.8, size: 1, sizeVar: 0.12, kinds: count(pf[1]),
    decor: df[0], decorKinds: count(df[1]), decorSize: 1 };
}
const biomeP = name => ({ ...biomeDefault(name), ...(over.biomes[name] || {}) });
function kindDefault(kind) {
  const m = A.manifest.kinds[kind];
  const versions = sheetsOf(kind);
  const sheet = m && A.sheets[m.sheet] ? m.sheet : versions.length ? versions[versions.length - 1].file : 'pixel';
  return { sheet, pick: m && m.sheet === sheet && m.pick ? m.pick : [0, 1, 2, 3], size: (m && m.size) || 1 };
}
const kindP = kind => ({ ...kindDefault(kind), ...(over.kinds[kind] || {}) });
const sheetsOf = kind => Object.values(A.sheets).filter(s => s.kind === kind).sort((a, b) => a.v - b.v);

// setOver('world' | 'view', key, value) or setOver('biomes' | 'kinds', name, field, value)
function setOver(group, key, field, value) {
  if (group === 'world' || group === 'view') over[group][key] = field;
  else (over[group][key] ||= {})[field] = value;
  save();
}

// ---------- world state ----------

let world = null, scene = { props: [], decor: [] }, fitNext = false;
let dirty = 0;                            // 4 tiles, 3 border detail, 2 masks, 1 scatter, 0.5 redraw
const needs = level => { dirty = Math.max(dirty, level); requestAnimationFrame(frame); };

function rebuild(level) {
  const p = worldP();
  if (level >= 4) {
    const tiles = painted && painted.n === p.size ? decodeTiles(painted.t, p.size) : generateTiles(p);
    world = makeWorld(tiles, p.size, p.seed);
  }
  if (level >= 3) refine(world, p.wiggle);
  if (level >= 2) buildMasks(world, p.soft);
  if (level >= 1) {
    spriteCache.clear();
    const sets = {};
    scene = scatter(world, id => (sets[id] ||= biomeP(BASE[id])), pickProp, pickDecor, viewP().mirror);
  }
  if (fitNext) { fitNext = false; fit(); }
}

const encodeTiles = t => btoa(Array.from(t, v => String.fromCharCode(v)).join(''));
const decodeTiles = (s, n) => { const b = atob(s), t = new Uint8Array(n * n); for (let i = 0; i < t.length; i++) t[i] = b.charCodeAt(i) || 0; return t; };

// ---------- sprites and ground patterns ----------

const spriteCache = new Map();
function propSprites(kind) {
  if (spriteCache.has(kind)) return spriteCache.get(kind);
  const ks = kindP(kind);
  let list = null;
  const sh = ks.sheet !== 'pixel' && A.sheets[ks.sheet];
  if (sh) list = ks.pick.map(i => sh.cells[i]).filter(Boolean);
  if (!list || !list.length) list = A.pixel.props[kind] || null;
  const out = list && list.map(s => ({ sprite: s, tpp: tilesPerPx(s, ks.size) }));
  spriteCache.set(kind, out);
  return out;
}
function pickWeighted(table, r) {
  let total = 0;
  for (const k in table) total += table[k];
  if (total <= 0) return null;
  let x = r * total;
  for (const k in table) { x -= table[k]; if (x < 0) return k; }
  return null;
}
function pickProp(id, r1, r2) {
  const kind = pickWeighted(biomeP(BASE[id]).kinds, r1);
  const list = kind && propSprites(kind);
  return list ? list[Math.floor(r2 * list.length)] : null;
}
function pickDecor(id, r1, r2) {
  const kind = pickWeighted(biomeP(BASE[id]).decorKinds, r1);
  const list = kind && A.pixel.decor[kind];
  if (!list) return null;
  const s = list[Math.floor(r2 * list.length)];
  return { sprite: s, tpp: tilesPerPx(s, 1) };
}

const patternCache = new Map();
function pattern(id) {
  const name = BASE[id], b = biomeP(name);
  const tex = b.ground !== 'pixel' && A.textures[b.ground];
  const key = [name, tex ? b.ground : 'pixel', b.texTiles, b.bright, b.sat, b.hue].join('|');
  if (patternCache.has(key)) return patternCache.get(key);
  const src = tex ? tex.img : A.pixel.ground[name];
  let img = src;
  if (b.bright !== 1 || b.sat !== 1 || b.hue !== 0) {
    img = canvas(src.width, src.height);
    const g = img.getContext('2d');
    g.filter = `brightness(${b.bright}) saturate(${b.sat}) hue-rotate(${b.hue}deg)`;
    g.drawImage(src, 0, 0);
  }
  const p = { img, tiles: tex ? b.texTiles : 8 };
  patternCache.set(key, p);
  return p;
}

// ---------- canvas, view and input ----------

const cv = document.getElementById('map');
const ctx = cv.getContext('2d');
const layer = canvas(1, 1), shadowLayer = canvas(1, 1);
const view = { ox: 0, oy: 0, z: 4 };
let dpr = 1, hover = null;

function resize() {
  dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) {
    const cx = view.ox + cv.width / 2 / view.z, cy = view.oy + cv.height / 2 / view.z;
    cv.width = layer.width = shadowLayer.width = w;
    cv.height = layer.height = shadowLayer.height = h;
    if (world) { view.ox = cx - w / 2 / view.z; view.oy = cy - h / 2 / view.z; }
    needs(0.5);
  }
}
function fit() {
  const N = world.N;
  view.z = Math.min(cv.width, cv.height) / N * 0.96;
  view.ox = N / 2 - cv.width / 2 / view.z;
  view.oy = N / 2 - cv.height / 2 / view.z;
  needs(0.5);
}
const toWorld = (e) => {
  const r = cv.getBoundingClientRect();
  return { x: view.ox + (e.clientX - r.left) * dpr / view.z, y: view.oy + (e.clientY - r.top) * dpr / view.z };
};
function zoomAt(px, py, f) {
  const z = Math.min(160 * dpr, Math.max(0.8 * dpr, view.z * f));
  const wx = view.ox + px / view.z, wy = view.oy + py / view.z;
  view.z = z;
  view.ox = wx - px / z;
  view.oy = wy - py / z;
  needs(0.5);
}

let mode = 'select', brush = 'FOREST', brushSize = 3;
const pointers = new Map();
let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => {
  if (!world) return;
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    drag = null;
    return;
  }
  const paint = mode === 'paint' && e.button === 0;
  drag = { x: e.clientX, y: e.clientY, moved: false, paint, last: toWorld(e) };
  if (paint) paintAt(drag.last);
});
cv.addEventListener('pointermove', e => {
  if (!world) return;
  hover = toWorld(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), r = cv.getBoundingClientRect();
    zoomAt(((a.x + b.x) / 2 - r.left) * dpr, ((a.y + b.y) / 2 - r.top) * dpr, d / pinch.d);
    pinch.d = d;
  } else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.paint) {
      // fill in the stroke between mouse positions, so fast drags leave no gaps
      const p = toWorld(e), a = drag.last, d = Math.hypot(p.x - a.x, p.y - a.y);
      const steps = Math.max(1, Math.ceil(d / Math.max(0.5, brushSize / 3)));
      for (let i = 1; i <= steps; i++) paintAt({ x: a.x + (p.x - a.x) * i / steps, y: a.y + (p.y - a.y) * i / steps });
      drag.last = p;
    }
    else if (drag.moved) {
      view.ox -= dx * dpr / view.z;
      view.oy -= dy * dpr / view.z;
      drag.x = e.clientX; drag.y = e.clientY;
    }
  }
  status();
  needs(0.5);
});
const up = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && !drag.moved && !drag.paint && mode === 'select') {
    const p = toWorld(e), id = biomeAt(world, p.x, p.y);
    if (id >= 0) { selected = BASE[id]; showTab('biome'); }
  }
  if (drag && drag.paint) save();
  drag = null;
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
cv.addEventListener('pointerleave', () => { hover = null; status(); needs(0.5); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomAt((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
cv.addEventListener('contextmenu', e => e.preventDefault());

let paintBox = null;
function paintAt(p) {
  const N = world.N, rad = brushSize / 2, id = ID[brush];
  let changed = false;
  for (let y = Math.floor(p.y - rad); y <= Math.ceil(p.y + rad); y++) for (let x = Math.floor(p.x - rad); x <= Math.ceil(p.x + rad); x++) {
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    if ((x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2 > rad * rad + 0.25) continue;
    if (world.tiles[y * N + x] !== id) { world.tiles[y * N + x] = id; changed = true; }
  }
  if (!changed) return;
  const b = [Math.floor(p.x - rad - 1), Math.floor(p.y - rad - 1), Math.ceil(p.x + rad + 1), Math.ceil(p.y + rad + 1)];
  paintBox = paintBox ? [Math.min(paintBox[0], b[0]), Math.min(paintBox[1], b[1]), Math.max(paintBox[2], b[2]), Math.max(paintBox[3], b[3])] : b;
  painted = { n: N, t: encodeTiles(world.tiles) };
  needs(2);
}

function frame() {
  if (!dirty || !world) return;
  const level = dirty;
  dirty = 0;
  if (paintBox && level < 3) { refine(world, worldP().wiggle, ...paintBox); }
  paintBox = null;
  if (level >= 1) rebuild(level);
  const v = viewP();
  draw(ctx, layer, shadowLayer, world, view, scene, pattern, {
    props: v.props, decor: v.decor, grid: v.grid, shadow: v.shadow, shadowLen: v.shadowLen,
    focus: v.focus && tab === 'biome' ? ID[selected] : null,
  });
  drawOverlay(v);
  if (level >= 2 && tab === 'biome') renderBiomeList();
}

function drawOverlay(v) {
  if (!hover) return;
  const z = view.z, X = x => (x - view.ox) * z, Y = y => (y - view.oy) * z;
  ctx.save();
  ctx.lineWidth = Math.max(1, dpr);
  if (mode === 'paint') {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(X(hover.x), Y(hover.y), brushSize / 2 * z, 0, Math.PI * 2);
    ctx.stroke();
  } else if (v.ruler) {
    // footprint of a 3 x 3 machine and a 1 x 1 belt next to it, to judge how big things look
    const tx = Math.floor(hover.x) - 1, ty = Math.floor(hover.y) - 1;
    ctx.fillStyle = 'rgba(242, 193, 78, 0.28)';
    ctx.strokeStyle = 'rgba(242, 193, 78, 0.95)';
    ctx.fillRect(X(tx), Y(ty), 3 * z, 3 * z);
    ctx.strokeRect(X(tx), Y(ty), 3 * z, 3 * z);
    ctx.fillRect(X(tx + 3.2), Y(ty + 2), z, z);
    ctx.strokeRect(X(tx + 3.2), Y(ty + 2), z, z);
    if (z > 14) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
      ctx.fillText('3×3 machine', X(tx), Y(ty) - 4 * dpr);
    }
  }
  ctx.restore();
}

function status() {
  const el = document.getElementById('status');
  if (!hover || !world) { el.textContent = ''; return; }
  const id = biomeAt(world, hover.x, hover.y);
  const px = Math.round(view.z / dpr * 10) / 10;
  el.textContent = id < 0 ? '' : `${BASE_NAME[BASE[id]]} · tile ${Math.floor(hover.x)}, ${Math.floor(hover.y)} · ${px} px per tile`;
}

// ---------- the side panel ----------

const panel = document.getElementById('panel');
let tab = 'world', selected = 'FOREST';
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const swatch = name => h('span', { class: 'sw', style: `background:${rgb(SKIN.base[name].c)}` });

// a labelled slider; changed = whether it differs from the default (shows a dot and a reset on double-click)
function slider(label, value, min, max, step, onInput, opts = {}) {
  const fmt = opts.fmt || (v => (+v).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0));
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { out.textContent = fmt(inp.value); row.classList.add('changed'); onInput(+inp.value); });
  const row = h('label', { class: 'slider' + (opts.changed ? ' changed' : ''), title: opts.tip || '' },
    h('span', { class: 'lab' }, label), inp, out);
  if (opts.onReset) row.addEventListener('dblclick', e => { e.preventDefault(); opts.onReset(); });
  return row;
}
const toggle = (label, on, onChange) => {
  const inp = h('input', { type: 'checkbox', checked: on });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'check' }, inp, label);
};

function showTab(t) {
  tab = t;
  panel.scrollTop = 0;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  renderPanel();
  needs(0.5);
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

function renderPanel() {
  const st = panel.scrollTop;
  panel.replaceChildren(tab === 'world' ? worldPanel() : tab === 'biome' ? biomePanel() : catalogPanel());
  panel.scrollTop = st;
}

// --- World tab ---
function worldPanel() {
  const p = worldP(), v = viewP();
  const W = (key, level) => val => { setOver('world', key, val); if (key !== 'wiggle' && key !== 'soft') painted = null; needs(level); };
  const ch = key => over.world[key] !== undefined && over.world[key] !== WORLD_DEFAULT[key];
  const seedIn = h('input', { type: 'number', value: p.seed, class: 'num' });
  seedIn.addEventListener('change', () => { W('seed', 4)(+seedIn.value | 0); renderPanel(); });
  return h('div', {},
    h('h3', {}, 'World'),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Seed'), seedIn,
      h('button', { onclick: () => { W('seed', 4)((Math.random() * 1e6) | 0); renderPanel(); } }, 'New world')),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Size'),
      ...[64, 96, 128, 192].map(n => h('button', { class: p.size === n ? 'on' : '', onclick: () => { W('size', 4)(n); fitNext = true; renderPanel(); } }, `${n}`)),
      h('span', { class: 'hint' }, 'tiles across')),
    slider('Lake size', p.lake, 0, 0.8, 0.01, W('lake', 4), { changed: ch('lake') }),
    slider('Beach', p.beach, 0, 6, 0.5, W('beach', 4), { changed: ch('beach'), tip: 'width of the sand ring around the lake, in tiles' }),
    slider('Regions', p.regions, 1, 24, 1, W('regions', 4), { changed: ch('regions'), tip: 'how many biome patches around the lake' }),
    slider('Region warp', p.warp, 0, 1.5, 0.05, W('warp', 4), { changed: ch('warp'), tip: 'how irregular the patch shapes are' }),
    slider('Border wiggle', p.wiggle, 0, 2, 0.05, W('wiggle', 3), { changed: ch('wiggle'), tip: 'how far borders wander from the tile grid, in tiles' }),
    slider('Border blend', p.soft, 0, 3, 0.05, W('soft', 2), { changed: ch('soft'), tip: 'how wide the soft blend between neighbouring biomes is, in tiles' }),
    h('h4', {}, 'Biomes in this world'),
    h('div', { class: 'biomes' }, LAND.map(n => toggle(h('span', {}, swatch(n), BASE_NAME[n]), p.biomes.includes(n), on => {
      const set = new Set(worldP().biomes);
      on ? set.add(n) : set.delete(n);
      W('biomes', 4)(LAND.filter(x => set.has(x)));
    }))),
    painted ? h('p', { class: 'hint' }, 'You have painted on this world. Changing the settings above starts a fresh one.') : null,
    h('h3', {}, 'Light and look'),
    slider('Shadow strength', v.shadow, 0, 0.8, 0.01, x => { setOver('view', 'shadow', x); needs(0.5); }),
    slider('Shadow length', v.shadowLen, 0, 1.6, 0.05, x => { setOver('view', 'shadowLen', x); needs(0.5); }),
    toggle('Mirror half the props at random', v.mirror, x => { setOver('view', 'mirror', x); needs(1); }),
    h('h3', {}, 'Settings'),
    h('div', { class: 'row' },
      h('button', { onclick: openExport }, 'Export changes…'),
      h('button', { onclick: () => { if (confirm('Forget every change made in the lab and go back to the game\'s settings?')) { over = { world: {}, view: {}, biomes: {}, kinds: {} }; painted = null; save(); patternCache.clear(); needs(4); renderPanel(); syncToolbar(); } } }, 'Reset everything')),
    h('p', { class: 'hint' }, 'Your changes are kept in this browser. Defaults come from the game (skin.js and props.json), so anything you haven\'t changed follows the game.'),
  );
}

// --- Biome tab ---
let biomeListEl = null;
function renderBiomeList() {
  if (!biomeListEl) return;
  const present = world ? world.present.map(id => BASE[id]) : [];
  biomeListEl.replaceChildren(...present.map(n => h('button', {
    class: 'chip' + (n === selected ? ' on' : '') + (over.biomes[n] ? ' changed' : ''), onclick: () => { selected = n; renderPanel(); needs(0.5); },
  }, swatch(n), BASE_NAME[n])));
}

function thumb(sprite, size = 56, bg = '#556b3a') {
  const c = canvas(size * 2, size * 2), g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  if (sprite) {
    const k = Math.min(c.width * 0.9 / sprite.w, c.height * 0.92 / sprite.h);
    g.imageSmoothingEnabled = !sprite.pixel;
    g.drawImage(sprite.img, (c.width - sprite.w * k) / 2, c.height * 0.96 - sprite.h * k, sprite.w * k, sprite.h * k);
  }
  c.className = 'thumb';
  c.style.width = c.style.height = size + 'px';
  return c;
}
const groundBg = name => rgb(SKIN.base[name] ? SKIN.base[name].c : [90, 110, 60]);

function biomePanel() {
  const name = selected, b = biomeP(name), d = biomeDefault(name), o = over.biomes[name] || {};
  const B = (key, level) => val => { setOver('biomes', name, key, val); needs(level); };
  const ch = key => o[key] !== undefined && JSON.stringify(o[key]) !== JSON.stringify(d[key]);
  const reset = key => () => { delete o[key]; save(); needs(1); renderPanel(); };
  const S = (label, key, min, max, step, level, tip) =>
    slider(label, b[key], min, max, step, B(key, level), { changed: ch(key), onReset: reset(key), tip: (tip || '') + ' (double-click to reset)' });

  biomeListEl = h('div', { class: 'chips' });
  renderBiomeList();

  // ground skins
  const tex = Object.values(A.textures).sort((a, b) => a.file.localeCompare(b.file));
  const groundChip = (file, label, img) => {
    const on = b.ground === file;
    const c = canvas(96, 96), g = c.getContext('2d');
    if (img) { g.fillStyle = g.createPattern(img, 'repeat'); g.setTransform(96 / img.width * (file === 'pixel' ? 2 : 1), 0, 0, 96 / img.width * (file === 'pixel' ? 2 : 1), 0, 0); g.fillRect(0, 0, img.width, img.height); }
    c.className = 'thumb';
    return h('button', { class: 'skin' + (on ? ' on' : ''), title: file, onclick: () => { B('ground', 0.5)(file); renderPanel(); } }, c, h('span', {}, label));
  };

  // props
  const kindRows = Object.entries(b.kinds).map(([kind, wgt]) => {
    const ks = kindP(kind), versions = sheetsOf(kind), sp = propSprites(kind);
    const sel = h('select', {}, h('option', { value: 'pixel' }, 'pixel art'),
      ...versions.map(s => h('option', { value: s.file, selected: s.file === ks.sheet }, s.file.replace('.png', ''))));
    sel.value = ks.sheet;
    sel.addEventListener('change', () => { setOver('kinds', kind, 'sheet', sel.value); setOver('kinds', kind, 'pick', [0, 1, 2, 3]); needs(1); renderPanel(); });
    const setW = x => { const k = { ...biomeP(name).kinds }; if (x > 0) k[kind] = x; else delete k[kind]; setOver('biomes', name, 'kinds', k); needs(1); };
    const sheet = A.sheets[ks.sheet];
    const cells = sheet ? h('div', { class: 'cells' }, sheet.cells.map((s, i) => {
      const on = ks.pick.includes(i);
      const t = thumb(s, 40, groundBg(name));
      return h('button', { class: 'cell' + (on ? ' on' : ''), title: `cell ${i + 1}`, onclick: () => {
        const pick = on ? ks.pick.filter(x => x !== i) : [...ks.pick, i].sort();
        if (!pick.length) return;
        setOver('kinds', kind, 'pick', pick); needs(1); renderPanel();
      } }, t);
    })) : h('p', { class: 'hint' }, versions.length ? '' : 'No AI art yet: drawn in pixel art. See the Art tab for the command to make it.');
    return h('div', { class: 'kind' },
      h('div', { class: 'kindhead' }, thumb(sp && sp[0] && sp[0].sprite, 44, groundBg(name)),
        h('div', { class: 'kindmain' }, h('b', {}, kind), sel)),
      slider('Share', wgt, 0, 8, 1, setW, { tip: 'how often this kind is picked compared with the others in this biome' }),
      slider('Kind size', ks.size, 0.3, 2, 0.05, x => { setOver('kinds', kind, 'size', x); needs(1); },
        { changed: over.kinds[kind] && over.kinds[kind].size !== undefined, tip: 'size of this kind everywhere it grows (props.json "size")' }),
      cells);
  });
  const add = h('select', {}, h('option', { value: '' }, '+ add a prop kind…'),
    ...Object.keys(SKIN.props).filter(k => !b.kinds[k]).map(k => h('option', { value: k }, k + (sheetsOf(k).length ? '' : ' (pixel art)'))));
  add.addEventListener('change', () => { if (!add.value) return; setOver('biomes', name, 'kinds', { ...b.kinds, [add.value]: 1 }); needs(1); renderPanel(); });

  return h('div', {},
    h('h3', {}, 'Biomes in view'), biomeListEl,
    h('p', { class: 'hint' }, 'Click the map to pick the biome under the cursor.'),
    toggle('Dim the other biomes', viewP().focus, x => { setOver('view', 'focus', x); syncToolbar(); needs(0.5); }),
    h('h2', {}, swatch(name), BASE_NAME[name], over.biomes[name] ? h('button', { class: 'small', onclick: () => { delete over.biomes[name]; save(); needs(1); renderPanel(); } }, 'reset biome') : null),
    h('h3', {}, 'Ground'),
    h('div', { class: 'skins' }, groundChip('pixel', 'pixel art', A.pixel.ground[name]),
      ...tex.map(t => groundChip(t.file, t.file.replace('.png', ''), t.img))),
    !tex.length ? h('p', { class: 'hint' }, 'No ground textures yet. The Art tab lists commands to make them.') : null,
    b.ground !== 'pixel' ? S('Texture scale', 'texTiles', 2, 24, 0.5, 0.5, 'how many tiles one copy of the texture covers') : null,
    S('Brightness', 'bright', 0.5, 1.5, 0.01, 0.5),
    S('Saturation', 'sat', 0, 2, 0.01, 0.5),
    S('Hue shift', 'hue', -60, 60, 1, 0.5),
    h('h3', {}, 'Props (trees, rocks)'),
    S('Density', 'density', 0, 1, 0.005, 1, 'share of prop spots (one per 1.5 x 1.5 tiles) that get a prop: skin.js propsFor'),
    S('Clumping', 'cluster', 0, 1, 0.01, 1, '0 = spread evenly, 1 = gathered into groves with gaps between'),
    S('Clump size', 'clump', 2, 30, 0.5, 1, 'how big the groves and gaps are, in tiles'),
    S('Spacing jitter', 'jitter', 0, 1, 0.01, 1, '0 = neat grid, 1 = fully random positions'),
    S('Size', 'size', 0.3, 3, 0.01, 1, 'apparent size of every prop in this biome'),
    S('Size variation', 'sizeVar', 0, 0.6, 0.01, 1, 'random size difference between props'),
    h('div', { class: 'kinds' }, kindRows), add,
    h('h3', {}, 'Small decorations'),
    S('Density', 'decor', 0, 0.8, 0.005, 1, 'share of tiles with a grass tuft, pebble, flower... (skin.js decorFor)'),
    S('Size', 'decorSize', 0.3, 3, 0.01, 1),
    h('p', { class: 'hint' }, 'Decorations: ' + Object.keys(b.decorKinds).join(', ') + ' (pixel art for now).'),
  );
}

// --- Art catalog tab ---
function catalogPanel() {
  const kinds = [...new Set(Object.values(A.sheets).map(s => s.kind))].sort();
  const usedBy = kind => LAND.concat(['BEACH']).filter(n => biomeP(n).kinds[kind]).map(n => BASE_NAME[n]);
  const propCards = kinds.map(kind => {
    const ks = kindP(kind);
    return h('div', { class: 'card' }, h('div', { class: 'cardhead' }, h('b', {}, kind), h('span', { class: 'hint' }, usedBy(kind).join(', ') || 'not used')),
      sheetsOf(kind).map(s => h('div', { class: 'sheetrow' + (s.file === ks.sheet ? ' on' : '') },
        h('button', { class: 'small', onclick: () => { setOver('kinds', kind, 'sheet', s.file); setOver('kinds', kind, 'pick', [0, 1, 2, 3]); needs(1); renderPanel(); } },
          s.file === ks.sheet ? 'in use' : 'use'),
        h('span', { class: 'ver' }, 'v' + s.v),
        s.cells.map((c, i) => {
          const t = thumb(c, 34, '#6b7a4a');
          if (s.file === ks.sheet && !ks.pick.includes(i)) t.classList.add('off');
          return t;
        }))));
  });
  const tex = Object.values(A.textures).sort((a, b) => a.file.localeCompare(b.file));
  const texCards = tex.map(t => {
    const c = canvas(160, 160), g = c.getContext('2d');
    g.drawImage(t.img, 0, 0, 80, 80); g.drawImage(t.img, 80, 0, 80, 80); g.drawImage(t.img, 0, 80, 80, 80); g.drawImage(t.img, 80, 80, 80, 80);
    c.className = 'thumb';
    const users = Object.keys(SKIN.base).filter(n => biomeP(n).ground === t.file).map(n => BASE_NAME[n]);
    return h('div', { class: 'tex' }, c, h('b', {}, t.file.replace('.png', '')), h('span', { class: 'hint' }, users.join(', ') || 'not used'),
      h('button', { class: 'small', onclick: () => { setOver('biomes', selected, 'ground', t.file); needs(0.5); renderPanel(); } }, `use on ${BASE_NAME[selected]}`));
  });

  // what's still missing for the biomes in this world
  const inWorld = world ? world.present.map(id => BASE[id]) : [];
  const needKinds = new Map();
  for (const n of inWorld) for (const k of Object.keys(biomeP(n).kinds)) if (!sheetsOf(k).length) needKinds.set(k, [...(needKinds.get(k) || []), BASE_NAME[n]]);
  const needGround = new Map();
  for (const n of inWorld) if (biomeP(n).ground === 'pixel') {
    const g = (GROUND_FOR[n] || [])[0];
    if (g) needGround.set(g, [...(needGround.get(g) || []), BASE_NAME[n]]);
  }
  const cmd = text => h('div', { class: 'cmd' }, h('code', {}, text), h('button', { class: 'small', onclick: e => { navigator.clipboard.writeText(text); e.target.textContent = 'copied'; } }, 'copy'));
  const propCmd = k => { const [s, bio, size] = PROP_IDEAS[k] || [k, null]; return `python tools/gen_props.py ${k} "${s}"` + (bio ? ` --biome ${bio}` : '') + (size ? ` --size ${size}` : ''); };
  const groundCmd = g => { const [s, bio] = GROUND_IDEAS[g] || [g, null]; return `python tools/gen_ground.py ${g} "${s}"` + (bio ? ` --biome ${bio}` : ''); };

  return h('div', {},
    h('h3', {}, 'Still needed for this world'),
    !needKinds.size && !needGround.size ? h('p', { class: 'hint' }, 'Everything in this world has AI art.') : null,
    [...needGround].map(([g, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `ground: ${g}`), ' for ', who.join(', ')), cmd(groundCmd(g)))),
    [...needKinds].map(([k, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `prop: ${k}`), ' for ', who.join(', ')), cmd(propCmd(k)))),
    h('p', { class: 'hint' }, 'Run these in PowerShell from the project folder. New images show up here after a reload (props don\'t need packing for the lab).'),
    h('h3', {}, `Ground textures (${tex.length})`),
    h('p', { class: 'hint' }, 'Each shown as 2 × 2 copies, so seams would show.'),
    h('div', { class: 'texgrid' }, texCards),
    h('h3', {}, `Prop sheets (${Object.keys(A.sheets).length})`),
    h('p', { class: 'hint' }, 'Faded cells are not picked. Pick cells in the Biome tab.'),
    propCards,
  );
}

// ---------- export ----------

function toFour(kinds) {
  const entries = Object.entries(kinds).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return [];
  const raw = entries.map(([k, w]) => ({ k, x: w / total * 4 }));
  raw.forEach(r => { r.n = Math.floor(r.x); });
  let left = 4 - raw.reduce((s, r) => s + r.n, 0);
  raw.slice().sort((a, b) => (b.x - b.n) - (a.x - a.n)).forEach(r => { if (left > 0) { r.n++; left--; } });
  return raw.flatMap(r => Array(r.n).fill(r.k));
}
function openExport() {
  const lines = [];
  const pf = [], df = [];
  for (const [n, o] of Object.entries(over.biomes)) {
    const b = biomeP(n);
    if ('density' in o || 'kinds' in o) pf.push(`    ${(n + ':').padEnd(10)}[${+b.density.toFixed(3)}, [${toFour(b.kinds).map(k => `'${k}'`).join(', ')}]],`);
    if ('decor' in o || 'decorKinds' in o) df.push(`    ${(n + ':').padEnd(10)}[${+b.decor.toFixed(3)}, [${toFour(b.decorKinds).map(k => `'${k}'`).join(', ')}]],`);
  }
  lines.push('// skin.js: replace these lines in propsFor (a biome has 4 slots, so shares are rounded to quarters)', ...(pf.length ? pf : ['//   (no changes)']));
  lines.push('', '// skin.js: replace these lines in decorFor', ...(df.length ? df : ['//   (no changes)']));
  const kinds = {};
  for (const k of Object.keys(over.kinds)) { const ks = kindP(k); kinds[k] = { sheet: ks.sheet, pick: ks.pick, size: ks.size }; }
  lines.push('', '// art/props/props.json: kinds whose sheet, cells or size you changed', JSON.stringify(kinds, null, 2));
  lines.push('', '// everything the lab changed (ground textures, clumping, sizes, ...), to hand to Claude', JSON.stringify(over, null, 1));
  const ta = document.getElementById('exportText');
  ta.value = lines.join('\n');
  document.getElementById('export').showModal();
}
document.getElementById('exportCopy').addEventListener('click', e => { navigator.clipboard.writeText(document.getElementById('exportText').value); e.target.textContent = 'Copied'; });
document.getElementById('exportClose').addEventListener('click', () => { document.getElementById('export').close(); document.getElementById('exportCopy').textContent = 'Copy all'; });

// ---------- toolbar ----------

function syncToolbar() {
  const v = viewP();
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', !!v[b.dataset.view]));
  document.getElementById('brushOpts').hidden = mode !== 'paint';
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; syncToolbar(); }));
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.view;
  setOver('view', k, !viewP()[k]);
  syncToolbar();
  if (tab === 'biome' && k === 'focus') renderPanel();
  needs(0.5);
}));
document.getElementById('fit').addEventListener('click', () => fit());
const brushSel = document.getElementById('brush');
brushSel.append(...['DEEP', 'SHALLOW', 'BEACH', ...LAND].map(n => h('option', { value: n, selected: n === brush }, BASE_NAME[n])));
brushSel.addEventListener('change', () => { brush = brushSel.value; });
document.getElementById('brushSize').addEventListener('input', e => { brushSize = +e.target.value; });

// ---------- start ----------

async function start() {
  const bar = document.getElementById('loading');
  A = await loadAll((n, total, label) => { bar.textContent = `Loading art ${n} / ${total}: ${label}`; });
  bar.remove();
  resize();
  rebuild(4);
  fit();
  syncToolbar();
  renderPanel();
  new ResizeObserver(resize).observe(cv);
}
start().catch(e => { document.getElementById('loading').textContent = 'Could not start: ' + e.message; console.error(e); });
