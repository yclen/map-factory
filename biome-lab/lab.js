// Biome Lab: a blue star with one single-biome planet per biome. Pick a planet, design its biome (ground texture and
// the items that grow on it: trees, rocks, shrubs, grass), and Save: the design goes to art/biomes/<GROUND>.json and
// is baked into galaxy-demo/biomes/, which the Galaxy demo loads. See galaxy-demo/js/biomes.js for the format.
import { SKIN } from '../galaxy-demo/js/skin.js?v=20261125004141';
import { BASE, BASE_NAME } from '../galaxy-demo/js/ids.js?v=20261125004141';
import { decorTables } from '../galaxy-demo/js/art.js?v=20261125004141';
import { skinKey, itemTable, ITEM_SLOTS } from '../galaxy-demo/js/biomes.js?v=20261125004141';
import { hash32 } from '../galaxy-demo/js/rng.js?v=20261125004141';
import { loadAll, canvas, buildItemAtlas, groundLayer, GROUND_TEX } from './assets.js?v=20261125004141';
import { createSystem } from './system.js?v=20261125004141';

const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));
const NO_DESIGN = new Set(['DEEP', 'SHALLOW', 'LAVA']);              // open liquid: nothing grows, the game draws it
const DESIGNABLE = BASE.filter(n => !NO_DESIGN.has(n));
const DEFAULT_PLANETS = ['GRASS', 'FOREST', 'JUNGLE', 'SWAMP', 'SAVANNA', 'DESERT', 'BEACH', 'TUNDRA', 'TAIGA', 'SNOW', 'MOUNTAIN', 'MESA'];

// which ground texture names suit which biome (the first one with art is the default); any texture can be picked
const GROUND_FOR = {
  GRASS: ['grass'], FOREST: ['forestfloor', 'grass'], JUNGLE: ['junglefloor', 'grass'], SWAMP: ['mud'],
  SAVANNA: ['drygrass', 'sand'], DESERT: ['sand'], DUNES: ['dunes', 'sand'], BEACH: ['beachsand', 'sand'],
  MESA: ['redsand', 'sand'], SALT: ['salt'], TUNDRA: ['tundra'], TAIGA: ['needles', 'forestfloor'],
  SNOW: ['snow'], ICE: ['ice', 'snow'], SEA_ICE: ['ice', 'snow'], ICE_CRACK: ['ice', 'snow'], MOUNTAIN: ['rock'], PEAK: ['snow', 'rock'],
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
const ITEM_IDEAS = {
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
  tuft: ['small tufts of wild grass', 'forest', 0.35], flowers: ['small clumps of wildflowers', 'forest', 0.35],
  bush: ['small round leafy shrubs', 'forest', 0.45], reeds: ['clumps of tall swamp reeds', 'forest', 0.5],
  cactus: ['small round desert cacti', 'savanna', 0.4], pebbles: ['small scattered grey pebbles', 'rocks', 0.3],
  rock: ['small grey rocks', 'rocks', 0.35], bones: ['bleached animal bones half buried', 'savanna', 0.35],
  shell: ['small sea shells', 'jungle', 0.25], driftwood: ['pieces of grey driftwood', 'jungle', 0.4],
};

// ---------- state ----------

const STORE = 'biomeLab.v3';
let S = { planets: DEFAULT_PLANETS, size: 128, hills: 0.4, drafts: {}, items: true, shadows: true, ruler: false };
try { S = { ...S, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { /* private window */ }
let saveTimer = 0;
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* blocked */ } }, 300); };

let A = null, sys = null;
let saved = {};                                          // biome -> its template in art/biomes/
let selected = 'FOREST';
const clone = o => JSON.parse(JSON.stringify(o));

const sheetsOf = kind => Object.values(A.sheets).filter(s => s.kind === kind).sort((a, b) => a.v - b.v);
function latestTexture(names) {
  for (const n of names || []) {
    const t = Object.values(A.textures).filter(t => t.name === n).sort((a, b) => b.v - a.v)[0];
    if (t) return t.file;
  }
  return null;
}
// an item's starting skin: props.json's choice, else its newest sheet, else pixel art. Small items only use a sheet
// made for them (an AI oak sheet would make the tiny decorative oak a full tree)
function defaultSkin(kind, layer) {
  if (layer === 'small' && SKIN.props[kind]) return { sheet: null, pick: [0, 1, 2, 3] };
  const m = A.manifest.kinds[kind], v = sheetsOf(kind);
  if (m && A.sheets[m.sheet]) return { sheet: m.sheet, pick: m.pick || [0, 1, 2, 3] };
  if (v.length) return { sheet: v[v.length - 1].file, pick: [0, 1, 2, 3] };
  return { sheet: null, pick: [0, 1, 2, 3] };
}
function newItem(kind, layer, density) {
  const skin = defaultSkin(kind, layer), m = A.manifest.kinds[kind];
  const size = layer === 'big' ? (m && m.size) || 1 : skin.sheet ? (ITEM_IDEAS[kind] || [])[2] || 0.4 : 1;
  return { kind, layer, density: +density.toFixed(4), size, sizeVar: 0.1, clump: 0, clumpSize: 10, skin };
}
const hasArt = (kind, layer) => sheetsOf(kind).length > 0 || !!(layer === 'big' ? A.pixel.props[kind] : A.pixel.decor[kind] || A.pixel.props[kind]);
// the game's current look for a biome (skin.js propsFor / decorFor), as a template
function defaultTemplate(name) {
  const items = [];
  const add = (table, layer) => {
    const [d, list] = table[name] || [0, []];
    const n = {};
    for (const k of list) n[k] = (n[k] || 0) + 1;
    for (const [k, c] of Object.entries(n)) if (hasArt(k, layer)) items.push(newItem(k, layer, d * c / 4));
  };
  add(SKIN.propsFor, 'big');
  add(SKIN.decorFor, 'small');
  return { biome: name, ground: { texture: latestTexture(GROUND_FOR[name]), scale: 8, bright: 1, sat: 1, hue: 0 }, items };
}
const effective = name => S.drafts[name] || saved[name] || defaultTemplate(name);
const statusOf = name => S.drafts[name] ? 'unsaved' : saved[name] ? 'saved' : 'default';
const STATUS_TEXT = { unsaved: 'unsaved changes', saved: 'saved', default: 'game default' };
function edit(name, fn, rebuild = 'items') {
  const t = clone(effective(name));
  fn(t);
  S.drafts[name] = t;
  persist();
  apply(rebuild);
}

// ---------- pictures for items ----------

function spritesOf(item) {
  const sh = item.skin && item.skin.sheet && A.sheets[item.skin.sheet];
  if (sh) {
    const cells = (item.skin.pick || [0, 1, 2, 3]).map(i => sh.cells[i]).filter(Boolean);
    if (cells.length) return [0, 1, 2, 3].map(v => cells[v % cells.length]);
  }
  return (item.layer === 'small' ? A.pixel.decor[item.kind] || A.pixel.props[item.kind] : A.pixel.props[item.kind]) || null;
}
// the item atlas for some templates: every distinct skin once
function atlasFor(templates) {
  const skins = new Map();
  for (const t of templates) for (const it of t.items) {
    const key = skinKey(it);
    if (skins.has(key)) continue;
    const sprites = spritesOf(it);
    if (sprites) skins.set(key, { key, sprites });
  }
  return buildItemAtlas([...skins.values()]);
}
// ground-texture layers: one per distinct (texture, colour adjustment, scale)
function groundsFor(templates) {
  const layers = [], keys = {}, avg = {};
  for (const t of templates) {
    const g = t.ground, tex = g.texture && A.textures[g.texture];
    if (!tex) continue;
    const key = [g.texture, g.bright, g.sat, g.hue, g.scale].join('|');
    if (!(key in keys)) { keys[key] = layers.length; layers.push({ ...groundLayer(tex.img, g.bright, g.sat, g.hue), ids: [], scale: g.scale }); }
    const L = layers[keys[key]];
    L.ids.push(ID[t.biome]);
    avg[ID[t.biome]] = L.avg.map(Math.round);
  }
  return { layers, avg };
}
const maxSize = templates => Math.max(1, ...templates.flatMap(t => t.items.map(it => (it.size || 1) * (1 + (it.sizeVar || 0)))));

// ---------- feeding the renderer ----------

let atlasKey = '', groundKey = '', liveAvg = {}, cells = {};
function apply(what = 'items') {
  const templates = DESIGNABLE.map(effective);
  if (what === 'all' || what === 'skins' || what === 'items') {
    const keys = [...new Set(templates.flatMap(t => t.items.map(skinKey)))].join(';');
    let atlas = null;
    if (keys !== atlasKey || what !== 'items') { atlas = atlasFor(templates); atlasKey = keys; cells = atlas.cells; }
    sys.R.setItems(atlas && atlas.canvas, atlas && atlas.meta, itemTable(Object.fromEntries(templates.map(t => [t.biome, t])), cells));
    sys.propMax = maxSize(templates);
  }
  if (what === 'all' || what === 'ground') {
    const gk = JSON.stringify(templates.map(t => t.ground));
    if (gk !== groundKey) {
      groundKey = gk;
      const { layers, avg } = groundsFor(templates);
      const K = new Int32Array(32).fill(-1), Sc = new Float32Array(32).fill(8);
      layers.forEach((l, i) => { for (const id of l.ids) { K[id] = i; Sc[id] = l.scale; } });
      sys.R.setGroundTextures(layers.map(l => l.canvas), GROUND_TEX, K, Sc);
      liveAvg = avg;
    }
  }
  showPlanets();
}
function showPlanets() {
  sys.setPlanets(S.planets.filter(n => DESIGNABLE.includes(n)).map(n => {
    const id = ID[n];
    return { name: n, label: BASE_NAME[n], badge: statusOf(n) === 'unsaved' ? 'unsaved' : '', W: S.size,
      dot: liveAvg[id] || SKIN.base[n].c,
      desc: { id: 'lab-' + n, seed: hash32(id, 4242) % 100000, type: 'lab', r: 1, W: S.size, heat: 1, settle: 0, home: false,
        avg: liveAvg[id] ? { [id]: liveAvg[id] } : null, lab: { mono: id, hills: S.hills } } };
  }));
}

// ---------- saving ----------

let saving = false, saveMsg = '';
async function save(name, template) {
  if (saving) return;
  saving = true; saveMsg = 'Saving…'; renderPanel();
  try {
    const after = { ...saved };
    if (name) { if (template) after[name] = template; else delete after[name]; }
    const templates = DESIGNABLE.map(n => after[n] || defaultTemplate(n));
    const atlas = atlasFor(templates), grounds = groundsFor(templates);
    const files = { 'items.webp': atlas.canvas.toDataURL('image/webp', 0.92) };
    grounds.layers.forEach((l, i) => { files[`ground_${i}.webp`] = l.canvas.toDataURL('image/webp', 0.92); });
    const json = {
      version: 1, saved: Object.keys(after).sort(),
      templates: Object.fromEntries(templates.map(t => [t.biome, t])), cells: atlas.cells,
      atlas: { file: 'items.webp', ...atlas.meta }, groundSize: GROUND_TEX,
      grounds: grounds.layers.map((l, i) => ({ file: `ground_${i}.webp`, ids: l.ids, scale: l.scale })), avg: grounds.avg,
      propMax: maxSize(templates),
    };
    const res = await fetch('/api/biome-lab/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ biome: name || '', template: template || null, bake: { json, files } }) });
    const out = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
    if (!out || !out.ok) throw new Error(out ? out.error : 'no save server');
    if (name) { if (template) saved[name] = template; else delete saved[name]; delete S.drafts[name]; }
    persist();
    saveMsg = !name ? 'The Galaxy demo now uses the saved designs and the newest art.'
      : template ? `Saved to ${out.template}. The Galaxy demo uses it now.` : `${BASE_NAME[name]} uses the game's defaults again.`;
  } catch (e) {
    saveMsg = /no save server|Failed to fetch/.test(e.message)
      ? 'Saving needs the local lab server: run  python tools/lab_server.py  and open http://localhost:8170/biome-lab/. Your changes are kept in this browser meanwhile.'
      : 'Could not save: ' + e.message;
  }
  saving = false;
  apply('items');
  renderPanel();
}

// ---------- overlay and status ----------

let hover = null, fps = '';
function drawOverlay(g, view) {
  if (!hover || !S.ruler) return;
  // the footprint of a 3 x 3 machine and a 1 x 1 belt, to judge how big items look
  const z = view.zoom, dpr = view.dpr, pl = hover.planet;
  const tx = Math.floor(hover.x) - 1, ty = Math.floor(hover.y) - 1;
  const [x, y] = view.toScreen(pl.x - pl.W / 2 + tx, pl.y - pl.W / 2 + ty), [bx, by] = view.toScreen(pl.x - pl.W / 2 + tx + 3.2, pl.y - pl.W / 2 + ty + 2);
  g.lineWidth = Math.max(1, dpr);
  g.fillStyle = 'rgba(242, 193, 78, 0.28)'; g.strokeStyle = 'rgba(242, 193, 78, 0.95)';
  g.fillRect(x, y, 3 * z, 3 * z); g.strokeRect(x, y, 3 * z, 3 * z);
  g.fillRect(bx, by, z, z); g.strokeRect(bx, by, z, z);
  if (z > 14 * dpr) { g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`; g.fillText('3×3 machine', x, y - 4 * dpr); }
}
function status() {
  const el = document.getElementById('status');
  const z = sys.zoom / sys.dpr;
  el.textContent = (hover ? `${BASE_NAME[hover.planet.name]} planet · tile ${Math.floor(hover.x)}, ${Math.floor(hover.y)} · ` : '') +
    `${z >= 1 ? Math.round(z) : z.toFixed(2)} px per tile · ${fps}`;
}

// ---------- the side panel ----------

const panel = document.getElementById('panel');
let tab = 'system';
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
const pill = name => { const st = statusOf(name); return h('span', { class: 'pill ' + st }, STATUS_TEXT[st]); };

function slider(label, value, min, max, step, onInput, opts = {}) {
  const fmt = opts.fmt || (v => (+v).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0));
  const out = h('span', { class: 'val' }, fmt(value));
  const inp = h('input', { type: 'range', min, max, step, value });
  const row = h('label', { class: 'slider', title: opts.tip || '' }, h('span', { class: 'lab' }, label), inp, out);
  inp.addEventListener('input', () => { out.textContent = fmt(inp.value); onInput(+inp.value); });
  if (opts.after) inp.addEventListener('change', () => opts.after(+inp.value));
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
  panel.replaceChildren(tab === 'system' ? systemPanel() : tab === 'biome' ? biomePanel() : artPanel());
  panel.scrollTop = st;
}
function select(name, fly) {
  selected = name;
  if (fly) sys.visit(name);
  showTab('biome');
}

// --- System tab ---
function systemPanel() {
  const shown = new Set(S.planets);
  const nSaved = Object.keys(saved).length;
  return h('div', {},
    h('h3', {}, 'Biome planets'),
    h('p', { class: 'hint' }, 'One planet per biome, all of it that biome. Click a planet (or a name below) to fly there and design it.'),
    h('div', { class: 'biomes' }, DESIGNABLE.map(n => h('div', { class: 'planetrow' },
      toggle(swatch(n), shown.has(n), on => {
        S.planets = DESIGNABLE.filter(x => x === n ? on : shown.has(x)); persist(); showPlanets(); renderPanel();
      }),
      h('button', { class: 'linkish', onclick: () => { if (!shown.has(n)) { S.planets = DESIGNABLE.filter(x => x === n || shown.has(x)); persist(); showPlanets(); } select(n, true); } }, BASE_NAME[n]),
      statusOf(n) !== 'default' ? pill(n) : null))),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Size'),
      ...[64, 128, 192, 256].map(n => h('button', { class: S.size === n ? 'on' : '', onclick: () => { S.size = n; persist(); showPlanets(); renderPanel(); } }, `${n}`)),
      h('span', { class: 'hint' }, 'tiles across')),
    slider('Hills', S.hills, 0, 1, 0.01, x => { S.hills = x; }, { after: () => { persist(); showPlanets(); }, tip: 'hill shading on every planet' }),
    h('div', { class: 'row' }, h('button', { onclick: () => sys.overview() }, 'Show the whole system')),
    h('h3', {}, 'Saving'),
    h('div', { class: 'row' }, h('button', { disabled: saving, onclick: () => save(null, null),
      title: 'rebuild what the Galaxy demo loads from the saved designs, with the newest art (designs stay as they are)' }, 'Update the game')),
    h('p', { class: 'hint' }, `${nSaved} biome${nSaved === 1 ? '' : 's'} saved in art/biomes/. Save (in the Biome tab) writes a biome's design there and updates what the Galaxy demo uses (galaxy-demo/biomes/). Biomes you haven't saved keep the game's current look.`),
    saveMsg ? h('p', { class: 'note' }, saveMsg) : null,
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
const groundBg = name => rgb(liveAvg[ID[name]] || SKIN.base[name].c);

function itemCard(name, it, index) {
  const set = (field, v) => edit(name, t => { t.items[index][field] = v; });
  const sprites = spritesOf(it), versions = sheetsOf(it.kind);
  const sel = h('select', {}, h('option', { value: '' }, 'pixel art'),
    ...versions.map(s => h('option', { value: s.file }, s.file.replace('.png', ''))));
  sel.value = it.skin.sheet || '';
  sel.addEventListener('change', () => { edit(name, t => { t.items[index].skin = { sheet: sel.value || null, pick: [0, 1, 2, 3] }; }, 'skins'); renderPanel(); });
  const sheet = it.skin.sheet && A.sheets[it.skin.sheet];
  const cellRow = sheet ? h('div', { class: 'cells' }, sheet.cells.map((s, i) => {
    const on = it.skin.pick.includes(i);
    return h('button', { class: 'cell' + (on ? ' on' : ''), title: `variation ${i + 1}`, onclick: () => {
      const pick = on ? it.skin.pick.filter(x => x !== i) : [...it.skin.pick, i].sort();
      if (!pick.length) return;
      edit(name, t => { t.items[index].skin.pick = pick; }, 'skins'); renderPanel();
    } }, thumb(s, 36, groundBg(name)));
  })) : null;
  const skinText = sheet ? `${it.skin.sheet.replace('.png', '')} · ${it.skin.pick.length} of ${sheet.cells.length} variations` : 'pixel art (no AI art yet)';
  return h('div', { class: 'kind' },
    h('div', { class: 'kindhead' }, thumb(sprites && sprites[0], 44, groundBg(name)),
      h('div', { class: 'kindmain' }, h('b', {}, it.kind), h('span', { class: 'hint' }, skinText)),
      h('button', { class: 'small', title: 'remove this item', onclick: () => { edit(name, t => { t.items.splice(index, 1); }); renderPanel(); } }, '×')),
    slider('Density', it.density, 0, 1, 0.005, v => set('density', v), { after: renderPanel, tip: 'share of spots that get this item' }),
    slider('Size', it.size, 0.1, 20, 0.05, v => set('size', v), { after: renderPanel, tip: '1 = 2 x 3 tiles; up to 20x' }),
    slider('Size spread', it.sizeVar, 0, 0.8, 0.01, v => set('sizeVar', v), { after: renderPanel, tip: 'random size difference between them' }),
    slider('Clumping', it.clump, 0, 0.99, 0.01, v => set('clump', v), { after: renderPanel, tip: '0 = spread evenly, 1 = in clusters with gaps between' }),
    it.clump > 0 ? slider('Clump size', it.clumpSize, 2, 40, 1, v => set('clumpSize', v), { after: renderPanel, tip: 'how big the clusters are, in tiles' }) : null,
    h('details', {}, h('summary', {}, 'Skins'), sel, cellRow));
}

function biomePanel() {
  const name = selected, t = effective(name), st = statusOf(name);
  const g = t.ground;
  const tex = Object.values(A.textures).sort((a, b) => a.file.localeCompare(b.file));
  const groundChip = (file, label, img) => {
    const c = canvas(96, 96), gg = c.getContext('2d');
    if (img) { const k = 96 / img.width * (file ? 1 : 2); gg.setTransform(k, 0, 0, k, 0, 0); gg.fillStyle = gg.createPattern(img, 'repeat'); gg.fillRect(0, 0, img.width, img.height); }
    c.className = 'thumb';
    return h('button', { class: 'skin' + ((g.texture || null) === file ? ' on' : ''), title: file || 'pixel art',
      onclick: () => { edit(name, x => { x.ground.texture = file; }, 'ground'); renderPanel(); } }, c, h('span', {}, label));
  };
  const G = (label, key, min, max, step, tip) => slider(label, g[key], min, max, step, () => {}, { tip,
    after: v => { edit(name, x => { x.ground[key] = v; }, 'ground'); renderPanel(); } });

  const layerBlock = (layer, title, hint) => {
    const list = t.items.map((it, i) => [it, i]).filter(([it]) => it.layer === layer);
    const total = list.reduce((s, [it]) => s + it.density, 0);
    const kinds = [...new Set([...(layer === 'big' ? Object.keys(SKIN.props) : Object.keys(SKIN.decor)), ...Object.values(A.sheets).map(s => s.kind)])]
      .filter(k => hasArt(k, layer)).sort();
    const add = h('select', {}, h('option', { value: '' }, `+ add a ${layer} item…`),
      ...kinds.map(k => h('option', { value: k }, k + (defaultSkin(k, layer).sheet ? '' : ' (pixel art)'))));
    add.disabled = list.length >= ITEM_SLOTS;
    add.addEventListener('change', () => { if (!add.value) return; edit(name, x => { x.items.push(newItem(add.value, layer, 0.1)); }, 'skins'); renderPanel(); });
    return h('div', {},
      h('h3', {}, title),
      h('p', { class: 'hint' }, hint + ` Together they fill ${Math.round(total * 100)}% of spots` + (total > 1 ? ' (over 100%: they crowd each other out)' : '') + '.'),
      h('div', { class: 'kinds' }, list.map(([it, i]) => itemCard(name, it, i))),
      add);
  };

  return h('div', {},
    h('div', { class: 'chips' }, S.planets.filter(n => DESIGNABLE.includes(n)).map(n => h('button', {
      class: 'chip' + (n === name ? ' on' : ''), onclick: () => select(n, true) }, swatch(n), BASE_NAME[n], statusOf(n) === 'unsaved' ? ' •' : ''))),
    h('h2', {}, swatch(name), BASE_NAME[name], pill(name)),
    h('div', { class: 'row savebar' },
      h('button', { class: 'primary', disabled: saving || st !== 'unsaved', onclick: () => save(name, clone(effective(name))) }, 'Save'),
      h('button', { disabled: st !== 'unsaved', onclick: () => { delete S.drafts[name]; persist(); apply('all'); renderPanel(); } }, saved[name] ? 'Revert to saved' : 'Discard changes'),
      h('button', { disabled: saving || st === 'default', onclick: () => { if (confirm(`Delete the saved design for ${BASE_NAME[name]} and go back to the game's defaults?`)) { delete S.drafts[name]; save(name, null); } } }, 'Use game defaults'),
      h('button', { onclick: () => sys.visit(name) }, 'Fly to')),
    saveMsg ? h('p', { class: 'note' }, saveMsg) : null,
    h('h3', {}, 'Ground'),
    h('div', { class: 'skins' }, groundChip(null, 'pixel art', A.pixel.ground[name]),
      ...tex.map(x => groundChip(x.file, x.file.replace('.png', ''), x.img))),
    !tex.length ? h('p', { class: 'hint' }, 'No ground textures yet. The Art tab lists commands to make them.') : null,
    g.texture ? h('div', {},
      G('Texture scale', 'scale', 2, 24, 0.5, 'how many tiles one copy of the texture covers'),
      G('Brightness', 'bright', 0.5, 1.5, 0.01), G('Saturation', 'sat', 0, 2, 0.01), G('Hue shift', 'hue', -60, 60, 1)) : null,
    layerBlock('big', 'Big items', 'Trees, boulders and other large things, one spot per 1.5 x 1.5 tiles.'),
    layerBlock('small', 'Small items', 'Shrubs, grass tufts, flowers, pebbles: one spot per tile, drawn under the big items.'),
  );
}

// --- Art tab ---
function artPanel() {
  const kinds = [...new Set(Object.values(A.sheets).map(s => s.kind))].sort();
  const usedBy = kind => DESIGNABLE.filter(n => effective(n).items.some(it => it.kind === kind && it.skin.sheet)).map(n => BASE_NAME[n]);
  const sheetCards = kinds.map(kind => h('div', { class: 'card' },
    h('div', { class: 'cardhead' }, h('b', {}, kind), h('span', { class: 'hint' }, usedBy(kind).join(', ') || 'not used')),
    sheetsOf(kind).map(s => h('div', { class: 'sheetrow' }, h('span', { class: 'ver' }, 'v' + s.v), s.cells.map(c => thumb(c, 34, '#6b7a4a'))))));
  const tex = Object.values(A.textures).sort((a, b) => a.file.localeCompare(b.file));
  const texCards = tex.map(x => {
    const c = canvas(160, 160), g = c.getContext('2d');
    for (const [px, py] of [[0, 0], [80, 0], [0, 80], [80, 80]]) g.drawImage(x.img, px, py, 80, 80);
    c.className = 'thumb';
    const users = DESIGNABLE.filter(n => effective(n).ground.texture === x.file).map(n => BASE_NAME[n]);
    return h('div', { class: 'tex' }, c, h('b', {}, x.file.replace('.png', '')), h('span', { class: 'hint' }, users.join(', ') || 'not used'));
  });
  // what the shown planets still draw in pixel art
  const needItems = new Map(), needGround = new Map();
  for (const n of S.planets.filter(x => DESIGNABLE.includes(x))) {
    const t = effective(n);
    for (const it of t.items) if (!it.skin.sheet) needItems.set(it.kind, [...(needItems.get(it.kind) || []), BASE_NAME[n]]);
    if (!t.ground.texture) { const g = (GROUND_FOR[n] || [])[0]; if (g) needGround.set(g, [...(needGround.get(g) || []), BASE_NAME[n]]); }
  }
  const cmd = text => h('div', { class: 'cmd' }, h('code', {}, text), h('button', { class: 'small', onclick: e => { navigator.clipboard.writeText(text); e.target.textContent = 'copied'; } }, 'copy'));
  const itemCmd = k => { const [s, bio, size] = ITEM_IDEAS[k] || [k, null]; return `python tools/gen_props.py ${k} "${s}"` + (bio ? ` --biome ${bio}` : '') + (size ? ` --size ${Math.min(1, size)}` : ''); };
  const groundCmd = g => { const [s, bio] = GROUND_IDEAS[g] || [g, null]; return `python tools/gen_ground.py ${g} "${s}"` + (bio ? ` --biome ${bio}` : ''); };
  return h('div', {},
    h('h3', {}, 'Still needed for these planets'),
    !needItems.size && !needGround.size ? h('p', { class: 'hint' }, 'Everything on these planets has AI art.') : null,
    [...needGround].map(([g, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `ground: ${g}`), ' for ', who.join(', ')), cmd(groundCmd(g)))),
    [...needItems].map(([k, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `item: ${k}`), ' for ', who.join(', ')), cmd(itemCmd(k)))),
    h('p', { class: 'hint' }, 'Run these in PowerShell from the project folder. New pictures show up after a reload.'),
    h('h3', {}, `Ground textures (${tex.length})`),
    h('p', { class: 'hint' }, 'Each shown as 2 × 2 copies, so seams would show.'),
    h('div', { class: 'texgrid' }, texCards),
    h('h3', {}, `Item sheets (${Object.keys(A.sheets).length})`),
    sheetCards,
  );
}

// ---------- toolbar ----------

function syncToolbar() {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', !!S[b.dataset.view]));
  sys.items = S.items; sys.shadows = S.shadows;
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { S[b.dataset.view] = !S[b.dataset.view]; persist(); syncToolbar(); }));
document.getElementById('fit').addEventListener('click', () => sys.overview());

// ---------- start ----------

async function start() {
  const bar = document.getElementById('loading');
  sys = createSystem(document.getElementById('gl'), document.getElementById('overlay'), {
    tap: hit => select(hit.planet.name, hit.planet.W * sys.zoom < Math.min(innerWidth, innerHeight) * 0.6 * sys.dpr),
    hover: t => { hover = t; status(); },
    focusPlanet: () => sys && sys.planets.find(p => p.name === selected),
    overlay: drawOverlay,
    perf: p => { fps = `${Math.round(p.fps)} fps` + (p.quality < 1 ? ` · ${Math.round(p.quality * 100)}% resolution` : ''); status(); },
  });
  window.biomeLab = { sys };                // for poking at from the browser console, e.g. biomeLab.sys.bench()
  A = await loadAll((n, total, label) => { bar.textContent = `Loading art ${n} / ${total}: ${label}`; });
  try {
    const idx = await (await fetch('../art/biomes/index.json', { cache: 'no-store' })).json();
    await Promise.all((idx.saved || []).map(async n => { saved[n] = await (await fetch(`../art/biomes/${n}.json`, { cache: 'no-store' })).json(); }));
  } catch { /* nothing saved yet */ }
  bar.remove();
  sys.R.setDecor(decorTables(SKIN));
  syncToolbar();
  apply('all');
  renderPanel();
}
start().catch(e => { document.getElementById('loading').textContent = 'Could not start: ' + e.message; console.error(e); });
