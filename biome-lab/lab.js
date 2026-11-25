// Biome Lab: a small Earth-like planet for designing biomes with the AI art, drawn by the game's own renderer.
// Defaults come from the game (galaxy-demo/js/skin.js, art/props/props.json); the lab stores only what you
// change, in this browser, and Export turns your changes into lines for skin.js / props.json.
import { SKIN } from '../galaxy-demo/js/skin.js?v=20261124234308';
import { BASE, BASE_NAME } from '../galaxy-demo/js/ids.js?v=20261124234308';
import { decorTables } from '../galaxy-demo/js/art.js?v=20261124234308';
import { loadAll, canvas, buildHdAtlas, groundLayer, GROUND_TEX } from './assets.js?v=20261124234308';
import { createPlanetView } from './planet.js?v=20261124234308';

const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));
const LAND = BASE.filter(n => !['DEEP', 'SHALLOW', 'BEACH', 'LAVA', 'SEA_ICE', 'ICE_CRACK'].includes(n));
const DEFAULT_BIOMES = ['GRASS', 'FOREST', 'TAIGA', 'SNOW', 'SAVANNA', 'DESERT', 'JUNGLE'];
const WATER = new Set(['DEEP', 'SHALLOW']);

// which ground texture names suit which biome (first one that has art wins); any texture can be picked by hand.
// Water keeps the game's own animated water
const GROUND_FOR = {
  GRASS: ['grass'], FOREST: ['forestfloor', 'grass'], JUNGLE: ['junglefloor', 'grass'], SWAMP: ['mud'],
  SAVANNA: ['drygrass', 'sand'], DESERT: ['sand'], DUNES: ['dunes', 'sand'], BEACH: ['beachsand', 'sand'],
  MESA: ['redsand', 'sand'], SALT: ['salt'], TUNDRA: ['tundra'], TAIGA: ['needles', 'forestfloor'],
  SNOW: ['snow'], ICE: ['ice', 'snow'], MOUNTAIN: ['rock'], PEAK: ['snow', 'rock'],
  ASH: ['ash'], OBSIDIAN: ['obsidian'], BASALT: ['basalt'], SULFUR: ['sulfur'],
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

const STORE = 'biomeLab.v2';
const WORLD_DEFAULT = { seed: 7, size: 192, lake: 0.3, beach: 2, regions: 9, warp: 0.6, hills: 0.4, biomes: DEFAULT_BIOMES };
const VIEW_DEFAULT = { props: true, decor: true, ruler: false };
let over = { world: {}, view: {}, biomes: {}, kinds: {} };
let painted = null;                      // { n: planet size, t: base64 of the paint map }
try {
  const s = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (s) { over = { ...over, ...s.over }; if (s.painted) painted = s.painted; }
} catch { /* private window */ }
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (paint) painted = { n: worldP().size, t: btoa(Array.from(paint, v => String.fromCharCode(v)).join('')) };
      localStorage.setItem(STORE, JSON.stringify({ over, painted }));
    } catch { /* full or blocked */ }
  }, 400);
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
  return { ground: WATER.has(name) ? 'pixel' : latestTexture(GROUND_FOR[name]), texTiles: 8, bright: 1, sat: 1, hue: 0,
    density: pf[0], cluster: 0, clump: 10, kinds: count(pf[1]), decor: df[0], decorKinds: count(df[1]) };
}
const biomeP = name => ({ ...biomeDefault(name), ...(over.biomes[name] || {}) });
const sheetsOf = kind => Object.values(A.sheets).filter(s => s.kind === kind).sort((a, b) => a.v - b.v);
function kindDefault(kind) {
  const m = A.manifest.kinds[kind];
  const versions = sheetsOf(kind);
  const sheet = m && A.sheets[m.sheet] ? m.sheet : versions.length ? versions[versions.length - 1].file : 'pixel';
  return { sheet, pick: m && m.sheet === sheet && m.pick ? m.pick : [0, 1, 2, 3], size: Math.min(1, (m && m.size) || 1) };
}
const kindP = kind => ({ ...kindDefault(kind), ...(over.kinds[kind] || {}) });

// setOver('world' | 'view', key, value) or setOver('biomes' | 'kinds', name, field, value)
function setOver(group, key, field, value) {
  if (group === 'world' || group === 'view') over[group][key] = field;
  else (over[group][key] ||= {})[field] = value;
  save();
}

// ---------- feeding the game's renderer ----------

let planet = null, paint = null, avg = {};

// the planet description the map workers build from (galaxy-demo/js/terrain.js, labSampler)
function makeDesc() {
  const p = worldP();
  return { id: 'lab', seed: p.seed, type: 'lab', r: 1, W: p.size, heat: 1, settle: 0, home: false, avg,
    lab: { lake: p.lake, beach: p.beach, regions: p.regions, warp: p.warp, hills: p.hills,
      biomes: p.biomes.map(n => ID[n]), paint } };
}
function rebuildPlanet(refit) { planet.setPlanet(makeDesc(), refit); presentSoon(); }

// a biome's props as the game stores them: 4 slots, so shares are rounded to quarters
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

// per ground type: prop / decoration density and kinds, clumping (art.js decorTables, the shader's u_biome table)
let hd = null, gt = null;                // the last prop atlas and ground textures (their uniforms are re-set below)
function applyTables() {
  const v = viewP(), propsFor = {}, decorFor = {};
  for (const n of BASE) {
    const b = biomeP(n);
    propsFor[n] = [v.props ? b.density : 0, toFour(b.kinds)];
    decorFor[n] = [v.decor ? b.decor : 0, toFour(b.decorKinds)];
  }
  const t = decorTables({ ...SKIN, propsFor, decorFor });
  BASE.forEach((n, id) => {
    const b = biomeP(n);
    t.B[id * 4 + 3] = b.cluster > 0 ? Math.round(b.clump) + Math.min(0.99, b.cluster) : 0;
  });
  planet.R.setDecor(t);                  // (this also clears the prop-atlas and ground-texture tables)
  reapplyUniforms();
}
function reapplyUniforms() {
  const R = planet.R, gl = R.gl, { p, u } = R.progBody;
  gl.useProgram(p);
  if (hd) gl.uniform4iv(u['u_hdK[0]'], hd.hdK);
  if (gt) { gl.uniform4iv(u['u_gtexK[0]'], gt.K); gl.uniform4fv(u['u_gtexS[0]'], gt.S); }
}
// the high-resolution prop atlas from each kind's chosen sheet and cells
function applyHd() {
  const names = Object.keys(SKIN.props), list = [], hdK = new Int32Array(32).fill(-1);
  for (const name of names) {
    const ks = kindP(name), sh = ks.sheet !== 'pixel' && A.sheets[ks.sheet];
    if (!sh) continue;
    const cells = ks.pick.map(i => sh.cells[i]).filter(Boolean);
    if (!cells.length) continue;
    list.push({ name, size: ks.size, sprites: [0, 1, 2, 3].map(v => cells[v % cells.length]) });
  }
  const at = buildHdAtlas(list);
  for (const [name, cell] of Object.entries(at.index)) { const k = names.indexOf(name); if (k >= 0 && k < 32) hdK[k] = cell; }
  planet.R.setHdProps(at.canvas, at.meta, hdK);
  hd = { hdK };
}
// ground textures: one texture-array layer per distinct (texture, colour adjustment) in use
function applyGround() {
  const layers = [], keys = {}, K = new Int32Array(32).fill(-1), S = new Float32Array(32).fill(8);
  avg = {};
  BASE.forEach((n, id) => {
    const b = biomeP(n), tex = !WATER.has(n) && b.ground !== 'pixel' && A.textures[b.ground];
    if (!tex) return;
    const key = [b.ground, b.bright, b.sat, b.hue].join('|');
    if (!(key in keys)) { keys[key] = layers.length; layers.push(groundLayer(tex.img, b.bright, b.sat, b.hue)); }
    K[id] = keys[key]; S[id] = b.texTiles;
    avg[id] = layers[keys[key]].avg;
  });
  planet.R.setGroundTextures(layers.map(l => l.canvas), GROUND_TEX, K, S);
  gt = { K, S };
}

// ---------- painting ----------

let mode = 'look', brush = 'FOREST', brushSize = 4, last = null;
function dab(t) {
  const W = worldP().size, rad = brushSize / 2, id = ID[brush];
  if (!paint) paint = new Uint8Array(W * W).fill(255);
  for (let y = Math.floor(t.y - rad); y <= Math.ceil(t.y + rad); y++) for (let x = Math.floor(t.x - rad); x <= Math.ceil(t.x + rad); x++) {
    if (x < 0 || y < 0 || x >= W || y >= W) continue;
    if ((x + 0.5 - t.x) ** 2 + (y + 0.5 - t.y) ** 2 > rad * rad + 0.25) continue;
    paint[y * W + x] = id;
  }
}
function paintStroke(t, start) {
  if (start || !last) dab(t);
  else {
    const d = Math.hypot(t.x - last.x, t.y - last.y), steps = Math.max(1, Math.ceil(d / Math.max(0.5, brushSize / 3)));
    for (let i = 1; i <= steps; i++) dab({ x: last.x + (t.x - last.x) * i / steps, y: last.y + (t.y - last.y) * i / steps });
  }
  last = t;
  rebuildPlanet();
}

// ---------- overlay and status ----------

let hover = null, fps = '';
function drawOverlay(g, view) {
  if (!hover) return;
  const z = view.zoom, dpr = view.dpr;
  g.lineWidth = Math.max(1, dpr);
  if (mode === 'paint') {
    const [x, y] = view.toScreen(hover.x, hover.y);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(x, y, brushSize / 2 * z, 0, Math.PI * 2); g.stroke();
  } else if (viewP().ruler) {
    // the footprint of a 3 x 3 machine and a 1 x 1 belt, to judge how big trees and rocks look
    const tx = Math.floor(hover.x) - 1, ty = Math.floor(hover.y) - 1;
    const [x, y] = view.toScreen(tx, ty), [bx, by] = view.toScreen(tx + 3.2, ty + 2);
    g.fillStyle = 'rgba(242, 193, 78, 0.28)'; g.strokeStyle = 'rgba(242, 193, 78, 0.95)';
    g.fillRect(x, y, 3 * z, 3 * z); g.strokeRect(x, y, 3 * z, 3 * z);
    g.fillRect(bx, by, z, z); g.strokeRect(bx, by, z, z);
    if (z > 14 * dpr) {
      g.fillStyle = '#fff'; g.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
      g.fillText('3×3 machine', x, y - 4 * dpr);
    }
  }
}
function status() {
  const el = document.getElementById('status');
  const id = hover ? planet.groundAt(hover) : -1;
  const z = planet.zoom / planet.dpr;
  el.textContent = (id >= 0 ? `${BASE_NAME[BASE[id]]} · tile ${Math.floor(hover.x)}, ${Math.floor(hover.y)} · ` : '') +
    `${z >= 1 ? Math.round(z) : z.toFixed(2)} px per tile · ${fps}`;
}

// biomes on the planet: sampled on a coarse grid after each change
let present = [];
let presentTimer = 0;
function presentSoon() {
  clearTimeout(presentTimer);
  presentTimer = setTimeout(() => {
    const seen = new Set(), W = worldP().size, n = 72;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const id = planet.groundAt({ x: (x + 0.5) / n * W, y: (y + 0.5) / n * W });
      if (id >= 0) seen.add(id);
    }
    present = [...seen].sort((a, b) => a - b).map(id => BASE[id]);
    if (tab === 'biome' || tab === 'art') renderPanel();
  }, 250);
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

// a labelled slider; changed = differs from the default (a dot; double-click resets it)
function slider(label, value, min, max, step, onInput, opts = {}) {
  const fmt = opts.fmt || (v => (+v).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0));
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  const row = h('label', { class: 'slider' + (opts.changed ? ' changed' : ''), title: opts.tip || '' },
    h('span', { class: 'lab' }, label), inp, out);
  inp.addEventListener('input', () => { out.textContent = fmt(inp.value); row.classList.add('changed'); onInput(+inp.value); });
  if (opts.after) inp.addEventListener('change', opts.after);
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
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function renderPanel() {
  if (!A) return;
  const st = panel.scrollTop;
  panel.replaceChildren(tab === 'world' ? worldPanel() : tab === 'biome' ? biomePanel() : catalogPanel());
  panel.scrollTop = st;
}

// --- World tab ---
function worldPanel() {
  const p = worldP();
  const ch = key => over.world[key] !== undefined && over.world[key] !== WORLD_DEFAULT[key];
  // building the planet takes a moment, so sliders apply when let go
  const W = key => val => { setOver('world', key, val); };
  const go = () => rebuildPlanet();
  const S = (label, key, min, max, step, tip) => slider(label, p[key], min, max, step, W(key), { changed: ch(key), after: go, tip });
  const seedIn = h('input', { type: 'number', value: p.seed, class: 'num' });
  seedIn.addEventListener('change', () => { setOver('world', 'seed', +seedIn.value | 0); go(); });
  const clearPaint = () => { paint = null; painted = null; save(); };
  return h('div', {},
    h('h3', {}, 'Planet'),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Seed'), seedIn,
      h('button', { onclick: () => { setOver('world', 'seed', (Math.random() * 1e6) | 0); clearPaint(); go(); renderPanel(); } }, 'New planet')),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Size'),
      ...[128, 192, 256, 384, 512].map(n => h('button', { class: p.size === n ? 'on' : '', onclick: () => {
        if (n === p.size) return;
        setOver('world', 'size', n); clearPaint(); rebuildPlanet(true); renderPanel();
      } }, `${n}`)),
      h('span', { class: 'hint' }, 'tiles across')),
    S('Lake size', 'lake', 0, 0.8, 0.01, 'radius of the lake, as a share of the planet\'s'),
    S('Beach', 'beach', 0, 6, 0.5, 'width of the sand ring around the lake, in tiles'),
    S('Regions', 'regions', 1, 24, 1, 'how many biome patches around the lake'),
    S('Region warp', 'warp', 0, 1.5, 0.05, 'how irregular the patch shapes are'),
    S('Hills', 'hills', 0, 1, 0.01, 'how hilly the land is (hill shading, and cliffs on mountains)'),
    h('h4', {}, 'Biomes on this planet'),
    h('div', { class: 'biomes' }, LAND.map(n => toggle(h('span', {}, swatch(n), BASE_NAME[n]), p.biomes.includes(n), on => {
      const set = new Set(worldP().biomes);
      on ? set.add(n) : set.delete(n);
      setOver('world', 'biomes', LAND.filter(x => set.has(x))); go();
    }))),
    paint ? h('div', { class: 'row' }, h('span', { class: 'hint' }, 'You have painted on this planet.'),
      h('button', { class: 'small', onclick: () => { clearPaint(); go(); renderPanel(); } }, 'clear painting')) : null,
    h('h3', {}, 'Settings'),
    h('div', { class: 'row' },
      h('button', { onclick: openExport }, 'Export changes…'),
      h('button', { onclick: () => {
        if (!confirm('Forget every change made in the lab and go back to the game\'s settings?')) return;
        over = { world: {}, view: {}, biomes: {}, kinds: {} }; clearPaint();
        applyAll(); rebuildPlanet(true); renderPanel(); syncToolbar();
      } }, 'Reset everything')),
    h('p', { class: 'hint' }, 'Your changes are kept in this browser. Defaults come from the game (skin.js and props.json), so anything you haven\'t changed follows the game.'),
  );
}

// --- Biome tab ---
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
function kindSprite(kind) {
  const ks = kindP(kind), sh = ks.sheet !== 'pixel' && A.sheets[ks.sheet];
  return (sh && sh.cells[ks.pick[0]]) || (A.pixel.props[kind] || [])[0];
}

function biomePanel() {
  const name = selected, b = biomeP(name), d = biomeDefault(name), o = over.biomes[name] || {};
  const ch = key => o[key] !== undefined && JSON.stringify(o[key]) !== JSON.stringify(d[key]);
  // what each setting feeds: the shader's tables (instant) or the ground textures
  const apply = key => (['ground', 'texTiles', 'bright', 'sat', 'hue'].includes(key) ? () => { applyGround(); applyTables(); rebuildPlanet(); } : applyTables);
  const reset = key => () => { delete o[key]; save(); apply(key)(); renderPanel(); };
  const S = (label, key, min, max, step, tip, live = true) => {
    const set = val => { setOver('biomes', name, key, val); if (live) apply(key)(); };
    return slider(label, b[key], min, max, step, set, { changed: ch(key), onReset: reset(key), after: live ? null : apply(key),
      tip: (tip ? tip + ' ' : '') + '(double-click to reset)' });
  };

  const chips = h('div', { class: 'chips' }, present.filter(n => !WATER.has(n)).map(n => h('button', {
    class: 'chip' + (n === selected ? ' on' : '') + (over.biomes[n] ? ' changed' : ''), onclick: () => { selected = n; renderPanel(); },
  }, swatch(n), BASE_NAME[n])));

  // ground skins
  const tex = Object.values(A.textures).sort((a, b) => a.file.localeCompare(b.file));
  const groundChip = (file, label, img) => {
    const c = canvas(96, 96), g = c.getContext('2d');
    if (img) { const k = 96 / img.width * (file === 'pixel' ? 2 : 1); g.setTransform(k, 0, 0, k, 0, 0); g.fillStyle = g.createPattern(img, 'repeat'); g.fillRect(0, 0, img.width, img.height); }
    c.className = 'thumb';
    return h('button', { class: 'skin' + (b.ground === file ? ' on' : ''), title: file,
      onclick: () => { setOver('biomes', name, 'ground', file); apply('ground')(); renderPanel(); } }, c, h('span', {}, label));
  };

  // props
  const slots = toFour(b.kinds);
  const kindRows = Object.entries(b.kinds).map(([kind, wgt]) => {
    const ks = kindP(kind), versions = sheetsOf(kind);
    const sel = h('select', {}, h('option', { value: 'pixel' }, 'pixel art'),
      ...versions.map(s => h('option', { value: s.file }, s.file.replace('.png', ''))));
    sel.value = ks.sheet;
    sel.addEventListener('change', () => { setOver('kinds', kind, 'sheet', sel.value); setOver('kinds', kind, 'pick', [0, 1, 2, 3]); applyHd(); renderPanel(); });
    const setW = x => { const k = { ...biomeP(name).kinds }; if (x > 0) k[kind] = x; else delete k[kind]; setOver('biomes', name, 'kinds', k); applyTables(); };
    const sheet = A.sheets[ks.sheet];
    const cells = sheet ? h('div', { class: 'cells' }, sheet.cells.map((s, i) => {
      const on = ks.pick.includes(i);
      return h('button', { class: 'cell' + (on ? ' on' : ''), title: `cell ${i + 1}`, onclick: () => {
        const pick = on ? ks.pick.filter(x => x !== i) : [...ks.pick, i].sort();
        if (!pick.length) return;
        setOver('kinds', kind, 'pick', pick); applyHd(); renderPanel();
      } }, thumb(s, 40, groundBg(name)));
    })) : h('p', { class: 'hint' }, 'No AI art yet: drawn in pixel art. The Art tab has the command to make it.');
    const n = slots.filter(k => k === kind).length;
    return h('div', { class: 'kind' },
      h('div', { class: 'kindhead' }, thumb(kindSprite(kind), 44, groundBg(name)),
        h('div', { class: 'kindmain' }, h('div', {}, h('b', {}, kind), h('span', { class: 'hint' }, `  ${n} of 4 slots`)), sel)),
      slider('Share', wgt, 0, 4, 1, setW, { after: renderPanel, tip: 'how often this kind grows here compared with the others (the game has 4 slots per biome)' }),
      slider('Size', ks.size, 0.3, 1, 0.01, x => { setOver('kinds', kind, 'size', x); }, { after: applyHd,
        changed: over.kinds[kind] && over.kinds[kind].size !== undefined, tip: 'size of this kind everywhere it grows (props.json "size"); 1 fills the game\'s 2 x 3 tile prop space' }),
      cells);
  });
  const add = h('select', {}, h('option', { value: '' }, '+ add a prop kind…'),
    ...Object.keys(SKIN.props).filter(k => !b.kinds[k]).map(k => h('option', { value: k }, k + (sheetsOf(k).length ? '' : ' (pixel art)'))));
  add.addEventListener('change', () => { if (!add.value) return; setOver('biomes', name, 'kinds', { ...b.kinds, [add.value]: 1 }); applyTables(); renderPanel(); });

  return h('div', {},
    h('h3', {}, 'Biomes on the planet'), chips,
    h('p', { class: 'hint' }, 'Click the planet to pick the biome under the cursor.'),
    h('h2', {}, swatch(name), BASE_NAME[name],
      over.biomes[name] ? h('button', { class: 'small', onclick: () => { delete over.biomes[name]; save(); applyGround(); applyTables(); rebuildPlanet(); renderPanel(); } }, 'reset biome') : null),
    h('h3', {}, 'Ground'),
    h('div', { class: 'skins' }, groundChip('pixel', 'pixel art', A.pixel.ground[name]),
      ...tex.map(t => groundChip(t.file, t.file.replace('.png', ''), t.img))),
    !tex.length ? h('p', { class: 'hint' }, 'No ground textures yet. The Art tab lists commands to make them.') : null,
    b.ground !== 'pixel' ? h('div', {},
      S('Texture scale', 'texTiles', 2, 24, 0.5, 'how many tiles one copy of the texture covers', false),
      S('Brightness', 'bright', 0.5, 1.5, 0.01, '', false),
      S('Saturation', 'sat', 0, 2, 0.01, '', false),
      S('Hue shift', 'hue', -60, 60, 1, '', false)) : null,
    h('h3', {}, 'Props (trees, rocks)'),
    S('Density', 'density', 0, 1, 0.005, 'share of prop spots (one per 1.5 x 1.5 tiles) that get a prop: skin.js propsFor'),
    S('Clumping', 'cluster', 0, 0.99, 0.01, '0 = spread evenly, 1 = gathered into groves with clearings between'),
    S('Clump size', 'clump', 2, 40, 1, 'how big the groves and clearings are, in tiles'),
    h('div', { class: 'kinds' }, kindRows), add,
    h('h3', {}, 'Small decorations'),
    S('Density', 'decor', 0, 0.8, 0.005, 'share of spots with a grass tuft, pebble, flower... (skin.js decorFor)'),
    h('p', { class: 'hint' }, 'Decorations: ' + Object.keys(b.decorKinds).join(', ') + ' (pixel art for now).'),
  );
}

// --- Art tab ---
function catalogPanel() {
  const kinds = [...new Set(Object.values(A.sheets).map(s => s.kind))].sort();
  const usedBy = kind => LAND.concat(['BEACH']).filter(n => biomeP(n).kinds[kind]).map(n => BASE_NAME[n]);
  const propCards = kinds.map(kind => {
    const ks = kindP(kind);
    return h('div', { class: 'card' }, h('div', { class: 'cardhead' }, h('b', {}, kind), h('span', { class: 'hint' }, usedBy(kind).join(', ') || 'not used')),
      sheetsOf(kind).map(s => h('div', { class: 'sheetrow' + (s.file === ks.sheet ? ' on' : '') },
        h('button', { class: 'small', onclick: () => { setOver('kinds', kind, 'sheet', s.file); setOver('kinds', kind, 'pick', [0, 1, 2, 3]); applyHd(); renderPanel(); } },
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
    for (const [x, y] of [[0, 0], [80, 0], [0, 80], [80, 80]]) g.drawImage(t.img, x, y, 80, 80);
    c.className = 'thumb';
    const users = Object.keys(SKIN.base).filter(n => !WATER.has(n) && biomeP(n).ground === t.file).map(n => BASE_NAME[n]);
    return h('div', { class: 'tex' }, c, h('b', {}, t.file.replace('.png', '')), h('span', { class: 'hint' }, users.join(', ') || 'not used'),
      h('button', { class: 'small', onclick: () => { setOver('biomes', selected, 'ground', t.file); applyGround(); applyTables(); rebuildPlanet(); renderPanel(); } }, `use on ${BASE_NAME[selected]}`));
  });

  // what the planet still draws in pixel art
  const needKinds = new Map(), needGround = new Map();
  for (const n of present) {
    if (WATER.has(n)) continue;
    for (const k of Object.keys(biomeP(n).kinds)) if (!sheetsOf(k).length) needKinds.set(k, [...(needKinds.get(k) || []), BASE_NAME[n]]);
    if (biomeP(n).ground === 'pixel') { const g = (GROUND_FOR[n] || [])[0]; if (g) needGround.set(g, [...(needGround.get(g) || []), BASE_NAME[n]]); }
  }
  const cmd = text => h('div', { class: 'cmd' }, h('code', {}, text), h('button', { class: 'small', onclick: e => { navigator.clipboard.writeText(text); e.target.textContent = 'copied'; } }, 'copy'));
  const propCmd = k => { const [s, bio, size] = PROP_IDEAS[k] || [k, null]; return `python tools/gen_props.py ${k} "${s}"` + (bio ? ` --biome ${bio}` : '') + (size ? ` --size ${size}` : ''); };
  const groundCmd = g => { const [s, bio] = GROUND_IDEAS[g] || [g, null]; return `python tools/gen_ground.py ${g} "${s}"` + (bio ? ` --biome ${bio}` : ''); };

  return h('div', {},
    h('h3', {}, 'Still needed for this planet'),
    !needKinds.size && !needGround.size ? h('p', { class: 'hint' }, 'Everything on this planet has AI art.') : null,
    [...needGround].map(([g, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `ground: ${g}`), ' for ', who.join(', ')), cmd(groundCmd(g)))),
    [...needKinds].map(([k, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `prop: ${k}`), ' for ', who.join(', ')), cmd(propCmd(k)))),
    h('p', { class: 'hint' }, 'Run these in PowerShell from the project folder. New images show up here after a reload (no packing needed for the lab).'),
    h('h3', {}, `Ground textures (${tex.length})`),
    h('p', { class: 'hint' }, 'Each shown as 2 × 2 copies, so seams would show.'),
    h('div', { class: 'texgrid' }, texCards),
    h('h3', {}, `Prop sheets (${Object.keys(A.sheets).length})`),
    h('p', { class: 'hint' }, 'Faded cells are not picked. Pick cells in the Biome tab.'),
    propCards,
  );
}

// ---------- export ----------

function openExport() {
  const pf = [], df = [], lines = [];
  for (const [n, o] of Object.entries(over.biomes)) {
    const b = biomeP(n);
    if ('density' in o || 'kinds' in o) pf.push(`    ${(n + ':').padEnd(10)}[${+b.density.toFixed(3)}, [${toFour(b.kinds).map(k => `'${k}'`).join(', ')}]],`);
    if ('decor' in o || 'decorKinds' in o) df.push(`    ${(n + ':').padEnd(10)}[${+b.decor.toFixed(3)}, [${toFour(b.decorKinds).map(k => `'${k}'`).join(', ')}]],`);
  }
  lines.push('// skin.js: replace these lines in propsFor', ...(pf.length ? pf : ['//   (no changes)']));
  lines.push('', '// skin.js: replace these lines in decorFor', ...(df.length ? df : ['//   (no changes)']));
  const kinds = {};
  for (const k of Object.keys(over.kinds)) { const ks = kindP(k); kinds[k] = { sheet: ks.sheet, pick: ks.pick, size: ks.size }; }
  lines.push('', '// art/props/props.json: kinds whose sheet, cells or size you changed', JSON.stringify(kinds, null, 2));
  lines.push('', '// everything the lab changed (ground textures, clumping, ...), to hand to Claude', JSON.stringify(over, null, 1));
  document.getElementById('exportText').value = lines.join('\n');
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
  if (k === 'props' || k === 'decor') applyTables();
}));
document.getElementById('fit').addEventListener('click', () => planet.fit());
const brushSel = document.getElementById('brush');
brushSel.append(...['DEEP', 'SHALLOW', 'BEACH', ...LAND].map(n => h('option', { value: n }, BASE_NAME[n])));
brushSel.value = brush;
brushSel.addEventListener('change', () => { brush = brushSel.value; });
document.getElementById('brushSize').addEventListener('input', e => { brushSize = +e.target.value; });

// ---------- start ----------

function applyAll() { applyHd(); applyGround(); applyTables(); }

async function start() {
  const bar = document.getElementById('loading');
  planet = createPlanetView(document.getElementById('gl'), document.getElementById('overlay'), {
    painting: () => mode === 'paint',
    paint: paintStroke,
    paintEnd: () => { last = null; save(); renderPanel(); },
    tap: t => { const id = planet.groundAt(t); if (id >= 0) { selected = BASE[id]; showTab('biome'); } },
    hover: t => { hover = t; status(); },
    overlay: drawOverlay,
    perf: (p) => { fps = `${Math.round(p.fps)} fps` + (p.quality < 1 ? ` · ${Math.round(p.quality * 100)}% resolution` : ''); status(); },
  });
  window.biomeLab = { planet };          // for poking at from the browser console, e.g. biomeLab.planet.bench()
  A = await loadAll((n, total, label) => { bar.textContent = `Loading art ${n} / ${total}: ${label}`; });
  bar.remove();
  const W = worldP().size;
  if (painted && painted.n === W) {
    try { const s = atob(painted.t); paint = new Uint8Array(W * W); for (let i = 0; i < paint.length; i++) paint[i] = s.charCodeAt(i); } catch { paint = null; }
  }
  applyAll();
  rebuildPlanet(true);
  syncToolbar();
  renderPanel();
}
start().catch(e => { document.getElementById('loading').textContent = 'Could not start: ' + e.message; console.error(e); });
