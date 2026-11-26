// Biome Builder: a blue star's solar system. The innermost planet mixes every biome, in slices like a pizza round an
// ocean; further out, one planet per biome, each round an ocean of its own, the hot biomes nearest the star and the
// cold ones furthest out. Pick a biome, design it (ground texture and the items that grow on it: trees, rocks,
// shrubs, grass), and Save: the design goes to art/biomes/<GROUND>.json and
// is baked into galaxy-demo/biomes/, which the Galaxy demo loads. See galaxy-demo/js/biomes.js for the format.
import { SKIN } from '../galaxy-demo/js/skin.js?v=20261125190144';
import { BASE, BASE_NAME } from '../galaxy-demo/js/ids.js?v=20261125190144';
import { decorTables } from '../galaxy-demo/js/art.js?v=20261125190144';
import { skinKey, itemTable, ITEM_SLOTS, SHADOW, RELIEF, BLEND, BORDER, STYLES, VARIETY, blendOf, blendTable, straggleTable } from '../galaxy-demo/js/biomes.js?v=20261125190144';
import { hash32 } from '../galaxy-demo/js/rng.js?v=20261125190144';
import { loadAll, loadHd, canvas, buildItemAtlas, groundLayer, GROUND_TEX, spriteStats, tilesPerPx } from './assets.js?v=20261125190144';
import { splash } from './splash.js?v=20261125190144';
import { createSystem } from './system.js?v=20261125190144';

const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));
const NO_DESIGN = new Set(['DEEP', 'SHALLOW', 'LAVA']);              // open liquid: nothing grows, the game draws it
// every designable biome, hottest first: the order the planets go out from the star (like the Galaxy demo's climate
// zones) and the order of the mix planet's slices
const HEAT_ORDER = ['OBSIDIAN', 'ASH', 'SULFUR', 'BASALT', 'CANYON', 'DUNES', 'DESERT', 'MESA', 'SALT', 'RUST', 'SAVANNA',
  'JUNGLE', 'BEACH', 'SWAMP', 'GRASS', 'FOREST', 'HIGHLAND', 'MOUNTAIN', 'CRATER', 'REGOLITH', 'TAIGA', 'TUNDRA', 'PEAK',
  'SNOW', 'ICE_CRACK', 'SEA_ICE', 'ICE'];
const DESIGNABLE = [...HEAT_ORDER, ...BASE.filter(n => !NO_DESIGN.has(n) && !HEAT_ORDER.includes(n))];
const DEFAULT_PLANETS = ['DESERT', 'MESA', 'SAVANNA', 'JUNGLE', 'BEACH', 'SWAMP', 'GRASS', 'FOREST', 'MOUNTAIN', 'TAIGA', 'TUNDRA', 'SNOW'];
// trees start big and sparse: TREE_SIZE (1 = a 2 x 3 tile box) and the game's tree density times TREE_DENSITY
const TREES = new Set(['oak', 'oak2', 'birch', 'blossom', 'willow', 'deadtree', 'saguaro', 'palm', 'jungle', 'acacia', 'pine', 'fir', 'snowpine']);
const TREE_SIZE = 3.5, TREE_DENSITY = 0.08;
// the big items' own sharp atlas: texels per art px to try, sharpest first, within 4096 x 4096 (safe on phones too)
const BIG_ATLAS = { scales: [24, 20, 16, 12], maxSide: 4096 };
const MIX = 'MIX';
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);   // opened by the desktop launcher (saving works)                                       // the mix planet's name (every other planet is named by its biome)
const SIZES = [512, 1024, 2048, 4096];

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
  mud: ['dark wet swamp mud with moss, a faint wet sheen and a few reeds lying flat', 'swamp'],
  drygrass: ['dry golden savanna grass, short and trampled, with dusty soil showing between', 'savanna'],
  sand: ['fine pale golden desert sand with soft, shallow wind ripples', 'savanna'],
  dunes: ['rippled orange-gold dune sand with long parallel wind ripples', 'desert'],
  beachsand: ['damp pale beach sand with tiny shell fragments', 'jungle'],
  redsand: ['red-orange desert sand and gravel', 'desert'],
  salt: ['a white salt flat crust cracked into irregular plates', 'desert'],
  tundra: ['tundra of low grey-green moss, lichen and small stones', 'taiga'],
  needles: ['pine forest floor of brown needles and a few cones on dark soil', 'taiga'],
  snow: ['fresh packed snow with faint wind-carved ridges', 'taiga'],
  ice: ['smooth blue-white glacier ice with faint cracks and trapped bubbles', 'ice'],
  rock: ['bare grey mountain rock with cracks and loose gravel', 'rocks'],
  ash: ['grey volcanic ash with small dark cinders', 'volcanic'], obsidian: ['glossy black obsidian ground with sharp cracks', 'volcanic'],
  basalt: ['dark grey basalt ground with small pits', 'volcanic'], sulfur: ['yellow sulfur crust with pale cracks', 'volcanic'],
  regolith: ['grey moon dust with small pebbles and tiny craters', 'volcanic'], rust: ['rust-red iron-rich dust and gravel', 'volcanic'],
};
const ITEM_IDEAS = {
  oak: ['broadleaf oak trees with a rounded leafy crown and a short brown trunk', 'forest'],
  oak2: ['oak trees, one in autumn orange', 'forest'], birch: ['slender white-barked birch trees', 'forest'],
  blossom: ['cherry blossom trees with soft pink flowering crowns', 'forest'],
  willow: ['weeping willow trees with long drooping branches', 'swamp'],
  deadtree: ['dead leafless trees with bare grey twisted branches', 'swamp'],
  saguaro: ['tall saguaro cacti with upturned arms', 'desert'], palm: ['coconut palm trees', 'jungle'],
  jungle: ['tall jungle trees with dense dark crowns', 'jungle'], acacia: ['flat-topped acacia trees', 'savanna'],
  pine: ['tall pine trees', 'taiga'], fir: ['narrow fir trees', 'taiga'], snowpine: ['pine trees with snow on the branches', 'taiga'],
  boulder: ['grey granite boulders', 'rocks', 0.6], mossy: ['grey boulders with patches of green moss', 'rocks', 0.6],
  sandrock: ['sandstone boulders', 'rocks', 0.6], redrock: ['red sandstone boulders', 'desert', 0.6],
  snowrock: ['grey boulders with snow on top', 'rocks', 0.6], darkrock: ['dark volcanic basalt boulders', 'volcanic', 0.6],
  sulfrock: ['yellow sulfur-crusted rocks', 'volcanic', 0.6], iceblock: ['chunky blocks of blue glacier ice', 'ice', 0.7],
  columns: ['clusters of dark hexagonal basalt columns', 'volcanic', 0.8],
  // small items (the full prompts used are in art/wishlist.json); the number is their starting size
  tuft: ['tufts of wild meadow grass', 'forest', 0.35], flowers: ['small clumps of wildflowers', 'forest', 0.35],
  bush: ['small round leafy shrubs', 'forest', 0.45], reeds: ['clumps of tall swamp reeds and cattails', 'swamp', 0.5],
  cactus: ['small desert cacti', 'desert', 0.4], pebbles: ['small groups of smooth grey pebbles', 'rocks', 0.3],
  rock: ['small grey stones', 'rocks', 0.35], bones: ['sun-bleached animal bones', 'desert', 0.35],
  shell: ['sea shells and starfish', 'jungle', 0.25], driftwood: ['pieces of grey driftwood', 'jungle', 0.4],
  rocksand: ['small sandstone stones', 'desert', 0.35], rockred: ['small rust-red sandstone stones', 'desert', 0.35],
  pebblesr: ['small groups of rust-red pebbles', 'desert', 0.3], rocksnow: ['small stones with a cap of snow', 'ice', 0.35],
  icechunk: ['small broken chunks of glacier ice', 'ice', 0.35], pebblesd: ['small groups of black volcanic pebbles', 'volcanic', 0.3],
  spire: ['small jagged volcanic rock spikes', 'volcanic', 0.45], 'deadtree-small': ['small dead leafless shrubs', 'volcanic', 0.45],
  'sulfrock-small': ['small stones crusted with sulfur', 'volcanic', 0.35],
};

// ---------- state ----------

const STORE = 'biomeBuilder.v1';
// size: planet width in tiles (the mix planet is twice that); ocean: the ocean's share of a planet's radius;
// spread: orbit distances, 1 = the Galaxy demo's rules for a blue giant
// pair: [biome, biome] while the mix planet shows just those two (to tune their border); blendOff: hard borders (to compare)
let S = { planets: DEFAULT_PLANETS, size: 1024, ocean: 0.35, spread: 0.25, hills: 0.4, drafts: {}, items: true, shadows: true, ruler: false,
  pair: null, blendOff: false };
try {
  const old = localStorage.getItem(STORE) ? null : JSON.parse(localStorage.getItem('biomeLab.v3') || 'null');
  if (old) S.drafts = old.drafts || {};                  // unsaved designs from when this was the Biome Lab
  S = { ...S, ...JSON.parse(localStorage.getItem(STORE) || '{}') };
} catch { /* private window */ }
let saveTimer = 0;
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* blocked */ } }, 300); };

let A = null, sys = null;
let saved = {};                                          // biome -> its template in art/biomes/
let savedLook = { ...SHADOW, ...BORDER };               // the item shadows and border fuzz in art/biomes/index.json
const look = () => S.look || savedLook;                  // the shadows and fuzz shown: unsaved changes, else the saved ones
const fuzzOf = () => look().fuzz ?? BORDER.fuzz;
const borderLook = () => ({ fuzz: fuzzOf(), wet: look().wet ?? BORDER.wet, wetW: look().wetW ?? BORDER.wetW });
const reliefOf = g => g.relief ?? RELIEF;
let selected = 'FOREST';
const clone = o => JSON.parse(JSON.stringify(o));

const sheetsOf = kind => Object.values(A.sheets).filter(s => s.kind === kind).sort((a, b) => a.v - b.v);
// which sheets an item uses: its own name, except small items named like a big one (the small 'deadtree' is a dead
// shrub, not a full tree), whose sheets are '<kind>-small'
const sheetKind = (kind, layer) => layer === 'small' && SKIN.props[kind] ? kind + '-small' : kind;
function latestTexture(names) {
  for (const n of names || []) {
    const t = Object.values(A.textures).filter(t => t.name === n).sort((a, b) => b.v - a.v)[0];
    if (t) return t.file;
  }
  return null;
}
// an item's starting skin: props.json's choice (big items), else its newest sheet, else pixel art
function defaultSkin(kind, layer) {
  const sk = sheetKind(kind, layer), m = A.manifest.kinds[sk], v = sheetsOf(sk);
  if (m && A.sheets[m.sheet]) return { sheet: m.sheet, pick: m.pick || [0, 1, 2, 3] };
  if (v.length) return { sheet: v[v.length - 1].file, pick: [0, 1, 2, 3] };
  return { sheet: null, pick: [0, 1, 2, 3] };
}
function newItem(kind, layer, density) {
  const skin = defaultSkin(kind, layer), m = A.manifest.kinds[kind], tree = layer === 'big' && TREES.has(kind);
  const size = tree ? TREE_SIZE : layer === 'big' ? (m && m.size) || 1 : skin.sheet ? (ITEM_IDEAS[sheetKind(kind, layer)] || [])[2] || 0.4 : 1;
  if (tree) density *= TREE_DENSITY;
  return { kind, layer, density: +density.toFixed(4), size, sizeVar: 0.1, clump: 0, clumpSize: 10, skin };
}
const hasArt = (kind, layer) => sheetsOf(sheetKind(kind, layer)).length > 0 || !!(layer === 'big' ? A.pixel.props[kind] : A.pixel.decor[kind] || A.pixel.props[kind]);
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
  return { biome: name, ground: { texture: latestTexture(GROUND_FOR[name]), scale: 8, bright: 1, sat: 1, hue: 0, relief: RELIEF }, items };
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

// hd: the full-size sprites, once they've loaded (big items' atlas)
function spritesOf(item, hd = false) {
  const sh = item.skin && item.skin.sheet && A.sheets[item.skin.sheet];
  if (sh) {
    const all = hd && sh.hd ? sh.hd : sh.cells;
    const cells = (item.skin.pick || [0, 1, 2, 3]).map(i => all[i]).filter(Boolean);
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
// the big items' own atlas, sharper (trees are drawn several times bigger than anything else), from the full-size
// sheets once they've loaded
function bigAtlasFor(templates) {
  const skins = new Map();
  for (const t of templates) for (const it of t.items) {
    const key = skinKey(it);
    if (it.layer !== 'big' || skins.has(key)) continue;
    const sprites = spritesOf(it, true);
    if (sprites) skins.set(key, { key, sprites });
  }
  return buildItemAtlas([...skins.values()], BIG_ATLAS);
}
const bigKeys = templates => [...new Set(templates.flatMap(t => t.items.filter(it => it.layer === 'big').map(skinKey)))].join(';');
// ground-texture layers: one per distinct (texture, colour adjustment, scale)
function groundsFor(templates) {
  const layers = [], keys = {}, avg = {};
  for (const t of templates) {
    const g = t.ground, tex = g.texture && A.textures[g.texture];
    if (!tex) continue;
    const key = [g.texture, g.bright, g.sat, g.hue, g.scale, reliefOf(g)].join('|');
    if (!(key in keys)) { keys[key] = layers.length; layers.push({ ...groundLayer(tex.img, g.bright, g.sat, g.hue), ids: [], scale: g.scale, relief: reliefOf(g) }); }
    const L = layers[keys[key]];
    L.ids.push(ID[t.biome]);
    avg[ID[t.biome]] = L.avg.map(Math.round);
  }
  return { layers, avg };
}
// the colour a biome shows from far away, where items aren't drawn: its ground's colour mixed with its items' colours,
// by how much of the ground they cover (a dense forest reads green, a desert with a few rocks stays sandy).
// Only for textured grounds; pixel-art grounds already have their own far colours
const SPOT_AREA = { big: 2.25, small: 1 };            // tiles per spot: big items one per 1.5 x 1.5 tiles, small one per tile
function farAvgs(templates, groundAvg) {
  const out = {};
  for (const t of templates) {
    const id = ID[t.biome], ga = groundAvg[id];
    if (!ga) continue;
    let cover = 0;
    const col = [0, 0, 0];
    for (const it of t.items) {
      const sprites = spritesOf(it);
      if (!sprites || !it.density) continue;
      let area = 0;
      const c = [0, 0, 0];
      for (const s of sprites) {
        const st = spriteStats(s), k = tilesPerPx(s, it.size || 1), a = s.w * s.h * k * k * st.fill;
        area += a / sprites.length;
        for (let i = 0; i < 3; i++) c[i] += st.avg[i] * a;
      }
      if (!area) continue;
      const cv = it.density * area / SPOT_AREA[it.layer];
      cover += cv;
      for (let i = 0; i < 3; i++) col[i] += c[i] / (area * sprites.length) * cv;
    }
    const k = 1 - Math.exp(-cover);                    // overlapping items: covered share, never quite all of it
    out[id] = ga.map((g, i) => Math.round(cover ? g + (col[i] / cover - g) * k : g));
  }
  return out;
}
const maxSize = templates => Math.max(1, ...templates.flatMap(t => t.items.map(it => (it.size || 1) * (1 + (it.sizeVar || 0)))));

// ---------- feeding the renderer ----------

let atlasKey = '', bigKey = '', groundKey = '', liveAvg = {}, groundAvg = {}, cells = {}, bigCells = {}, hdLoaded = 0;
function apply(what = 'items') {
  const templates = DESIGNABLE.map(effective);
  if (what === 'all' || what === 'skins' || what === 'items') {
    const keys = [...new Set(templates.flatMap(t => t.items.map(skinKey)))].join(';');
    let atlas = null;
    if (keys !== atlasKey || what !== 'items') { atlas = atlasFor(templates); atlasKey = keys; cells = atlas.cells; }
    const bk = bigKeys(templates) + '|' + hdLoaded;
    if (bk !== bigKey || what !== 'items') {
      const big = bigAtlasFor(templates);
      bigKey = bk; bigCells = big.cells;
      sys.R.setBigItems(big.canvas, big.meta);
    }
    sys.R.setItems(atlas && atlas.canvas, atlas && atlas.meta, itemTable(Object.fromEntries(templates.map(t => [t.biome, t])), cells, bigCells));
    sys.propMax = maxSize(templates);
  }
  if (what === 'all' || what === 'ground' || what === 'blend') sys.R.setBlend(blendTable(Object.fromEntries(templates.map(t => [t.biome, t]))));
  if (what === 'all' || what === 'ground') {
    const gk = JSON.stringify(templates.map(t => ({ ...t.ground, blend: null, variety: null })));   // the blend table, not new textures
    if (gk !== groundKey) {
      groundKey = gk;
      const { layers, avg } = groundsFor(templates);
      const K = new Int32Array(32).fill(-1), Sc = new Float32Array(32).fill(8);
      const Rl = new Float32Array(32);
      layers.forEach((l, i) => { for (const id of l.ids) { K[id] = i; Sc[id] = l.scale; Rl[id] = l.relief; } });
      sys.R.setGroundTextures(layers.map(l => l.canvas), GROUND_TEX, K, Sc, Rl);
      groundAvg = avg;
    }
  }
  liveAvg = farAvgs(templates, groundAvg);
  showPlanets();
}
const shownBiomes = () => DESIGNABLE.filter(n => S.planets.includes(n));
const pairOn = () => !!(S.pair && S.pair.length === 2 && S.pair.every(n => DESIGNABLE.includes(n)));
// the mix planet's slices, clockwise from the top: during a pair test the two biomes three times over (six borders)
const mixSlices = () => pairOn() ? [...S.pair, ...S.pair, ...S.pair] : shownBiomes();
// a spot on dry land: halfway across the ring of land round the ocean, at angle a (clockwise from the top)
const landAt = a => { const r = (S.ocean + 1) / 2; return [Math.sin(a) * r, -Math.cos(a) * r]; };
// where a biome's slice is on the mix planet: [u, v] across its disk
function sliceSpot(name) {
  const list = mixSlices(), i = list.indexOf(name);
  return i < 0 ? null : landAt((i + 0.5) / list.length * Math.PI * 2);
}
function showPlanets() {
  const list = shownBiomes(), mix = mixSlices(), avg = {};
  for (const n of mix) if (liveAvg[ID[n]]) avg[ID[n]] = liveAvg[ID[n]];
  const colour = n => liveAvg[ID[n]] || SKIN.base[n].c;
  const base = { type: 'lab', r: 1, heat: 1, settle: 0, home: false };
  const planets = [];
  if (mix.length) {
    const W = Math.min(4096, S.size * 2), dot = [0, 1, 2].map(i => Math.round(mix.reduce((t, n) => t + colour(n)[i], 0) / mix.length));
    // the border fuzz and item straggle shape its borders the way they shape the game's
    planets.push({ name: MIX, label: pairOn() ? `Pair test: ${BASE_NAME[S.pair[0]]} and ${BASE_NAME[S.pair[1]]}` : 'Mix planet', badge: '', W, dot,
      land: pairOn() ? landAt(0) : landAt(Math.PI / mix.length),
      desc: { ...base, id: 'builder-mix', seed: 4242, W, avg: Object.keys(avg).length ? avg : null, fuzz: fuzzOf(),
        straggle: straggleTable(Object.fromEntries(mix.map(n => [n, effective(n)]))),
        lab: { slices: mix.map(n => ID[n]), lake: S.ocean, hills: S.hills } } });
  }
  for (const n of list) {
    const id = ID[n];
    planets.push({ name: n, label: BASE_NAME[n], badge: statusOf(n) === 'unsaved' ? 'unsaved' : '', W: S.size,
      dot: colour(n), land: landAt(0),
      desc: { ...base, id: 'builder-' + n, seed: hash32(id, 4242) % 100000, W: S.size,
        avg: liveAvg[id] ? { [id]: liveAvg[id] } : null, lab: { mono: id, lake: S.ocean, hills: S.hills } } });
  }
  sys.setPlanets(planets, { su: S.size / 2, spread: S.spread });
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
    const big = bigAtlasFor(templates);
    const files = { 'items.webp': atlas.canvas.toDataURL('image/webp', 0.92), 'items_big.webp': big.canvas.toDataURL('image/webp', 0.9) };
    grounds.layers.forEach((l, i) => { files[`ground_${i}.webp`] = l.canvas.toDataURL('image/webp', 0.92); });
    const json = {
      version: 1, saved: Object.keys(after).sort(),
      templates: Object.fromEntries(templates.map(t => [t.biome, t])), cells: atlas.cells,
      atlas: { file: 'items.webp', ...atlas.meta }, groundSize: GROUND_TEX,
      bigAtlas: { file: 'items_big.webp', ...big.meta }, bigCells: big.cells,
      grounds: grounds.layers.map((l, i) => ({ file: `ground_${i}.webp`, ids: l.ids, scale: l.scale, relief: l.relief })), avg: farAvgs(templates, grounds.avg),
      shadow: look(), border: borderLook(),
      propMax: maxSize(templates),
    };
    const res = await fetch('/api/biome-builder/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ biome: name || '', template: template || null, look: look(), bake: { json, files } }) });
    const out = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
    if (!out || !out.ok) throw new Error(out ? out.error : 'no save server');
    if (name) { if (template) saved[name] = template; else delete saved[name]; delete S.drafts[name]; }
    savedLook = { ...look() }; delete S.look;            // the shadows went out with this save too
    persist();
    saveMsg = !name ? 'The Galaxy demo now uses the saved designs and the newest art.'
      : template ? `Saved to ${out.template}. The Galaxy demo uses it now.` : `${BASE_NAME[name]} uses the game's defaults again.`;
  } catch (e) {
    saveMsg = /no save server|Failed to fetch/.test(e.message)
      ? (LOCAL ? 'The save program has stopped. Double-click the Biome Builder icon on your desktop to start it again, then press Save.'
        : 'Saving works in the desktop version: double-click the Biome Builder icon on your desktop (it opens the Builder with saving switched on). Your changes here stay in this browser.')
      : 'Could not save: ' + e.message;
  }
  saving = false;
  apply('items');
  renderPanel();
}

// ---------- overlay and status ----------

let hover = null, fps = '', hdNote = '';
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
  const where = hover ? `${hover.planet.label}${hover.planet.name === MIX ? ' · ' + BASE_NAME[BASE[sys.groundAt(hover)]] : ''} · ` : '';
  el.textContent = (hover ? `${where}tile ${Math.floor(hover.x)}, ${Math.floor(hover.y)} · ` : '') +
    `${z >= 1 ? Math.round(z) : z.toFixed(2)} px per tile · ${fps}` + (hdNote ? ' · ' + hdNote : '');
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
function shadowSlider(label, key, min, max, step, tip) {
  return slider(label, look()[key] ?? SHADOW[key], min, max, step, v => { S.look = { ...look(), [key]: v }; sys.R.shadow = { ...S.look }; },
    { tip, after: () => { persist(); renderPanel(); } });
}
// a border-look slider that answers at once while dragging (the wet shore is drawn by the shader, nothing rebuilds)
function wetSlider(label, key, min, max, step, tip) {
  return slider(label, borderLook()[key], min, max, step, v => { sys.R.wet = key === 'wet' ? [v, borderLook().wetW] : [borderLook().wet, v]; },
    { tip, after: v => { S.look = { ...look(), [key]: v }; persist(); syncToolbar(); renderPanel(); } });
}
function systemPanel() {
  const shown = new Set(S.planets);
  const nSaved = Object.keys(saved).length;
  const relayout = () => { persist(); showPlanets(); };
  return h('div', {},
    h('h3', {}, 'Planets'),
    h('p', { class: 'hint' }, 'The mix planet circles closest to the star, with a slice of every biome ticked below. Then one planet per biome, hottest nearest the star. Click a planet (or a name) to fly there and design it; on the mix planet, click a slice.'),
    h('div', { class: 'row' }, h('button', { onclick: () => sys.frame(MIX) }, 'Fly to the mix planet')),
    h('div', { class: 'biomes' }, DESIGNABLE.map(n => h('div', { class: 'planetrow' },
      toggle(swatch(n), shown.has(n), on => {
        S.planets = DESIGNABLE.filter(x => x === n ? on : shown.has(x)); persist(); showPlanets(); renderPanel();
      }),
      h('button', { class: 'linkish', onclick: () => { if (!shown.has(n)) { S.planets = DESIGNABLE.filter(x => x === n || shown.has(x)); persist(); showPlanets(); } select(n, true); } }, BASE_NAME[n]),
      statusOf(n) !== 'default' ? pill(n) : null))),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Size'),
      ...SIZES.map(n => h('button', { class: S.size === n ? 'on' : '', onclick: () => { S.size = n; persist(); showPlanets(); renderPanel(); } }, `${n}`)),
      h('span', { class: 'hint' }, 'tiles')),
    h('p', { class: 'hint' }, `Each biome planet is ${S.size} tiles across; the mix planet ${Math.min(4096, S.size * 2)}.`),
    slider('Ocean', S.ocean, 0, 0.7, 0.01, x => { S.ocean = x; }, { after: relayout, tip: 'the ocean in the middle of every planet, as a share of its radius (0 = none)' }),
    slider('Hills', S.hills, 0, 1, 0.01, x => { S.hills = x; }, { after: relayout, tip: 'hill shading on every planet' }),
    slider('Orbits', S.spread, 0.1, 1, 0.01, x => { S.spread = x; }, { after: relayout, tip: "how far apart the orbits are: 1 = the Galaxy demo's rules for a blue giant" }),
    h('div', { class: 'row' }, h('button', { onclick: () => sys.overview() }, 'Show the whole system')),
    h('h3', {}, 'Shadows', S.look ? h('span', { class: 'pill unsaved' }, 'unsaved') : null),
    h('p', { class: 'hint' }, 'Every item casts its outline flat along the ground from its base, like Factorio, and darkens the ground right under it. Shared by all biomes; the game gets them with the next Save or Update the game.'),
    shadowSlider('Length', 'len', 0, 2.5, 0.05, 'shadow length per unit of an item\'s height'),
    shadowSlider('Angle', 'angle', 0, 80, 1, 'degrees below the horizontal, falling to the right'),
    shadowSlider('Darkness', 'dark', 0, 0.9, 0.01, 'how dark the cast shadows are'),
    shadowSlider('Contact', 'contact', 0, 1, 0.01, 'the soft dark patch on the ground right under each item, so it sits on the ground'),
    S.look ? h('div', { class: 'row' }, h('button', { onclick: () => { delete S.look; persist(); syncToolbar(); showPlanets(); renderPanel(); } }, 'Back to the saved shadows and fuzz')) : null,
    h('h3', {}, 'Borders', ['fuzz', 'wet', 'wetW'].some(k => borderLook()[k] !== (savedLook[k] ?? BORDER[k])) ? h('span', { class: 'pill unsaved' }, 'unsaved') : null),
    h('p', { class: 'hint' }, 'Where two biomes meet, their ground textures blend into each other. Each biome\'s own border settings (width, creep, softness, style…) are in its Biome tab. Fuzz is shared by every planet: it shapes where borders run when the map is made, so they wander in ragged lines with little islands, the way it will in the game.'),
    slider('Fuzz', fuzzOf(), 0, 2, 0.05, () => {}, { tip: 'how ragged biome borders are where the map is made (0 = smooth lines). Rebuilds the mix planet',
      after: v => { S.look = { ...look(), fuzz: v }; persist(); showPlanets(); renderPanel(); } }),
    toggle('Blend the borders (untick to see the old hard edges)', !S.blendOff, on => { S.blendOff = !on; persist(); syncToolbar(); }),
    h('p', { class: 'hint' }, 'Wet shore: the ground along every shore is darker and deeper in colour, as if the waves just washed over it.'),
    wetSlider('Wet shore', 'wet', 0, 1, 0.05, 'how dark and glossy the ground is at the waterline (0 = dry)'),
    wetSlider('Wet width', 'wetW', 0.5, 6, 0.25, 'how far inland the wet ground reaches, in tiles'),
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
  const sprites = spritesOf(it), versions = sheetsOf(sheetKind(it.kind, it.layer));
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
    h('div', { class: 'chips' }, shownBiomes().map(n => h('button', {
      class: 'chip' + (n === name ? ' on' : ''), onclick: () => select(n, true) }, swatch(n), BASE_NAME[n], statusOf(n) === 'unsaved' ? ' •' : ''))),
    h('h2', {}, swatch(name), BASE_NAME[name], pill(name)),
    h('div', { class: 'row savebar' },
      h('button', { class: 'primary', disabled: saving || st !== 'unsaved', onclick: () => save(name, clone(effective(name))) }, 'Save'),
      h('button', { disabled: st !== 'unsaved', onclick: () => { delete S.drafts[name]; persist(); apply('all'); renderPanel(); } }, saved[name] ? 'Revert to saved' : 'Discard changes'),
      h('button', { disabled: saving || st === 'default', onclick: () => { if (confirm(`Delete the saved design for ${BASE_NAME[name]} and go back to the game's defaults?`)) { delete S.drafts[name]; save(name, null); } } }, 'Use game defaults'),
      h('button', { onclick: () => sys.visit(name) }, 'Fly to'),
      sliceSpot(name) ? h('button', { title: 'its slice on the mix planet', onclick: () => sys.visit(MIX, ...sliceSpot(name)) }, 'On the mix planet') : null),
    saveMsg ? h('p', { class: 'note' }, saveMsg) : null,
    h('h3', {}, 'Ground'),
    h('div', { class: 'skins' }, groundChip(null, 'pixel art', A.pixel.ground[name]),
      ...tex.map(x => groundChip(x.file, x.file.replace('.png', ''), x.img))),
    !tex.length ? h('p', { class: 'hint' }, 'No ground textures yet. The Art tab lists commands to make them.') : null,
    g.texture ? h('div', {},
      G('Texture scale', 'scale', 2, 24, 0.5, 'how many tiles one copy of the texture covers'),
      G('Brightness', 'bright', 0.5, 1.5, 0.01), G('Saturation', 'sat', 0, 2, 0.01), G('Hue shift', 'hue', -60, 60, 1),
      slider('Variety', g.variety ?? VARIETY, 0, 1, 0.05, () => {}, { tip: 'hides the repeat: shifted copies of the texture mixed across the ground (0 = it simply repeats)',
        after: v => { edit(name, x => { x.ground.variety = v; }, 'blend'); renderPanel(); } }),
      slider('Relief', reliefOf(g), 0, 2, 0.05, () => {}, { tip: 'light parts of the texture stand up as bumps, dark parts sink, lit by the sun (0 = flat)',
        after: v => { edit(name, x => { x.ground.relief = v; }, 'ground'); renderPanel(); } })) : null,
    bordersBlock(name, t),
    layerBlock('big', 'Big items', 'Trees, boulders and other large things, one spot per 1.5 x 1.5 tiles.'),
    layerBlock('small', 'Small items', 'Shrubs, grass tufts, flowers, pebbles: one spot per tile, drawn under the big items.'),
  );
}

// the Borders block of a biome's tab: how its ground meets its neighbours (biomes.js BLEND), and the pair test
function bordersBlock(name, t) {
  const b = blendOf(t.ground);
  const set = (key, v) => edit(name, x => { x.ground.blend = { ...blendOf(x.ground), [key]: v }; }, key === 'straggle' ? 'items' : 'blend');
  // while dragging: the shader's table only, so the planet answers at once (straggle rebuilds the map, so it waits)
  const live = (key, v) => {
    const all = Object.fromEntries(DESIGNABLE.map(n => [n, effective(n)]));
    all[name] = { ...all[name], ground: { ...all[name].ground, blend: { ...b, [key]: v } } };
    sys.R.setBlend(blendTable(all));
  };
  const B = (label, key, min, max, step, tip) => slider(label, b[key], min, max, step, v => { if (key !== 'straggle') live(key, v); },
    { tip, after: v => { set(key, v); if (key === 'straggle') showPlanets(); renderPanel(); } });
  const others = DESIGNABLE.filter(n => n !== name);
  const pairSel = h('select', {}, h('option', { value: '' }, 'test against…'), ...others.map(n => h('option', { value: n }, BASE_NAME[n])));
  pairSel.value = pairOn() && S.pair[0] === name ? S.pair[1] : '';
  pairSel.addEventListener('change', () => {
    S.pair = pairSel.value ? [name, pairSel.value] : null;
    persist(); showPlanets(); renderPanel();
    if (S.pair) sys.visit(MIX, ...landAt(0));
  });
  const LABEL = { soft: 'Soft', pixel: 'Pixel', dither: 'Dither' };
  return h('div', {},
    h('h3', {}, 'Borders'),
    h('p', { class: 'hint' }, t.ground.texture
      ? 'How this ground meets its neighbours. Where two textured grounds meet, the wider width and the stronger creep win; softness and raggedness are shared between the two.'
      : 'Only grounds drawn with a texture blend into their neighbours: pick a texture above. Item straggle works either way.'),
    B('Width', 'width', 0, 1, 0.05, 'how wide the band where the two grounds mix is, in tiles (0 = a hard edge)'),
    B('Creep', 'creep', -1, 1, 0.05, 'how far this ground pushes into its neighbours (the higher one wins the border)'),
    B('Softness', 'soft', 0.02, 0.5, 0.01, 'low: crisp, the bumps of each texture poke through the other; high: a smooth fade'),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Style'),
      ...STYLES.map(st => h('button', { class: b.style === st ? 'on' : '', title: {
        soft: 'mixed by the textures\' bumps: sand settles between stones, grass tufts poke over dirt',
        pixel: 'whole art pixels, a ragged pixel-art edge', dither: 'stippled, like old pixel art' }[st],
        onclick: () => { set('style', st); renderPanel(); } }, LABEL[st]))),
    B('Ragged', 'ragged', 0, 1, 0.05, 'how much noise breaks up the border line'),
    B('Rim', 'rim', -1, 1, 0.05, 'the border band darkened (left) or lightened (right) on this ground\'s side'),
    B('Bump height', 'height', -2, 2, 0.05, 'how much the light parts of the texture stand up over the neighbour (below 0: its dark parts do)'),
    B('Item straggle', 'straggle', 0, 12, 0.5, 'how far this biome\'s trees, rocks and grass wander into its neighbours, in tiles. Rebuilds the mix planet'),
    h('div', { class: 'row' }, h('span', { class: 'lab' }, 'Pair test'), pairSel,
      pairOn() ? h('button', { onclick: () => { S.pair = null; persist(); showPlanets(); renderPanel(); } }, 'End the pair test') : null),
    h('p', { class: 'hint' }, pairOn()
      ? `The mix planet shows only ${BASE_NAME[S.pair[0]]} and ${BASE_NAME[S.pair[1]]}, three slices each: six borders to look at.`
      : 'Turns the mix planet into just this biome and another, so you can tune the border between them.'),
    JSON.stringify(b) !== JSON.stringify(BLEND) ? h('div', { class: 'row' }, h('button', { onclick: () => {
      edit(name, x => { delete x.ground.blend; }, 'ground'); renderPanel(); } }, 'Default borders')) : null);
}

// --- Art tab ---
function artPanel() {
  const kinds = [...new Set(Object.values(A.sheets).map(s => s.kind))].sort();
  const usedBy = kind => DESIGNABLE.filter(n => effective(n).items.some(it => sheetKind(it.kind, it.layer) === kind && it.skin.sheet)).map(n => BASE_NAME[n]);
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
  for (const n of shownBiomes()) {
    const t = effective(n);
    for (const it of t.items) if (!it.skin.sheet) { const k = sheetKind(it.kind, it.layer) + (it.layer === 'small' ? ' --small' : ''); needItems.set(k, [...(needItems.get(k) || []), BASE_NAME[n]]); }
    if (!t.ground.texture) { const g = (GROUND_FOR[n] || [])[0]; if (g) needGround.set(g, [...(needGround.get(g) || []), BASE_NAME[n]]); }
  }
  const cmd = text => h('div', { class: 'cmd' }, h('code', {}, text), h('button', { class: 'small', onclick: e => { navigator.clipboard.writeText(text); e.target.textContent = 'copied'; } }, 'copy'));
  const itemCmd = key => {
    const [k, small] = key.split(' '), [s, bio, size] = ITEM_IDEAS[k] || [k, null];
    return `python tools/gen_props.py ${k} "${s}"` + (bio ? ` --biome ${bio}` : '') + (small ? ' --small' : size ? ` --size ${Math.min(1, size)}` : '');
  };
  const groundCmd = g => { const [s, bio] = GROUND_IDEAS[g] || [g, null]; return `python tools/gen_ground.py ${g} "${s}"` + (bio ? ` --biome ${bio}` : ''); };
  return h('div', {},
    h('h3', {}, 'Still needed for these planets'),
    !needItems.size && !needGround.size ? h('p', { class: 'hint' }, 'Everything on these planets has AI art.') : null,
    [...needGround].map(([g, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `ground: ${g}`), ' for ', who.join(', ')), cmd(groundCmd(g)))),
    [...needItems].map(([k, who]) => h('div', { class: 'need' }, h('span', {}, h('b', {}, `item: ${k.split(' ')[0]}`), ' for ', who.join(', ')), cmd(itemCmd(k)))),
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
  sys.R.shadow = { ...look() };
  sys.R.blendOn = !S.blendOff;
  sys.R.wet = [borderLook().wet, borderLook().wetW];
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { S[b.dataset.view] = !S[b.dataset.view]; persist(); syncToolbar(); }));
document.getElementById('fit').addEventListener('click', () => sys.overview());

// ---------- start ----------

async function start() {
  splash.step('Waking the blue star', 0.02);
  sys = createSystem(document.getElementById('gl'), document.getElementById('overlay'), {
    tap: hit => {
      const far = hit.planet.W * sys.zoom < Math.min(innerWidth, innerHeight) * 0.6 * sys.dpr;
      if (hit.planet.name !== MIX) return select(hit.planet.name, far);
      if (far) return sys.frame(MIX);                    // the mix planet: first show all of it, then pick a slice
      const n = BASE[sys.groundAt(hit)];
      if (DESIGNABLE.includes(n)) select(n, false);
    },
    hover: t => { hover = t; status(); },
    focusPlanet: () => sys && sys.planets.find(p => p.name === selected),
    overlay: drawOverlay,
    perf: p => { fps = `${Math.round(p.fps)} fps` + (p.quality < 1 ? ` · ${Math.round(p.quality * 100)}% resolution` : ''); status(); },
  });
  window.biomeBuilder = { sys };                // for poking at from the browser console, e.g. biomeBuilder.sys.bench()
  A = await loadAll((n, total, label) => splash.art(n, total, label));
  splash.step('Reading the saved biomes', 0.91);
  try {
    const idx = await (await fetch('../art/biomes/index.json', { cache: 'no-store' })).json();
    if (idx.look) savedLook = { ...SHADOW, ...BORDER, ...idx.look };
    await Promise.all((idx.saved || []).map(async n => { saved[n] = await (await fetch(`../art/biomes/${n}.json`, { cache: 'no-store' })).json(); }));
  } catch { /* nothing saved yet */ }
  splash.step('Building the planets', 0.95);
  await new Promise(r => setTimeout(r, 30));      // let that line show before the busy part (a timer: frames pause in hidden tabs)
  sys.R.setDecor(decorTables(SKIN));
  syncToolbar();
  apply('all');
  renderPanel();
  splash.done();
  // tell the save program this page is still open (it stops by itself a while after the last one closes)
  if (LOCAL) setInterval(() => fetch('/api/biome-builder/ping', { cache: 'no-store' }).catch(() => {}), 60000);
  // then the big items' full-size sheets, in the background: their atlas sharpens once they're in
  hdNote = 'Sharpening trees…'; status();
  hdLoaded = await loadHd(A, (n, total) => { hdNote = `Sharpening trees ${n} / ${total}`; status(); });
  hdNote = ''; status();
  if (hdLoaded) apply('skins');
}
start().catch(e => { splash.fail('Could not start: ' + e.message); console.error(e); });
