// Loading art for the Biome Lab: the raw AI sheets (cut into sprites here in the browser, the same way
// tools/pack_props.py does it), the AI ground textures (made seamless here), and the game's pixel-art fallbacks.
import { SKIN } from '../galaxy-demo/js/skin.js';
import { BASE, ATLAS_COLS, SLOT_FLOOR, SLOT_DECO, PROP_W, PROP_H, PROP_Y0, PROP_COLS } from '../galaxy-demo/js/ids.js';
import { buildAtlas, ATLAS_W, ATLAS_H } from '../galaxy-demo/js/art.js';
import { mulberry32, hash32 } from '../galaxy-demo/js/rng.js';

const ART = '../art/';
const SHEET_SCALE = 0.6;        // sheets are cut at 60% of their size: plenty for the lab's closest zoom
const TEX = 512;                // ground textures are made seamless at 512 x 512

export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

// file names in a folder: the local server's directory listing, else biome-lab/catalog.json (for GitHub Pages)
let catalog = null;
async function listPngs(folder, key) {
  try {
    const r = await fetch(ART + folder, { cache: 'no-store' });
    const t = r.ok ? await r.text() : '';
    if (t.includes('Directory listing')) {
      return [...t.matchAll(/href="([^"?/]+\.png)"/gi)].map(m => decodeURIComponent(m[1]));
    }
  } catch { /* fall through */ }
  if (!catalog) {
    try { catalog = await (await fetch('catalog.json', { cache: 'no-store' })).json(); } catch { catalog = {}; }
  }
  return catalog[key] || [];
}

const parseName = f => { const m = /^(.+?)_v(\d+)\.png$/i.exec(f); return m ? { name: m[1], v: +m[2] } : null; };

// ---------- prop sheets ----------

// magenta background -> transparent, pink fringes pulled back to neutral (same maths as pack_props.py cut_out)
function keyOut(img) {
  const w = Math.round(img.width * SHEET_SCALE), h = Math.round(img.height * SHEET_SCALE);
  const c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h), d = id.data;
  let transparent = false;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) { transparent = true; break; }
  if (!transparent) {
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const m = Math.min(R, B) - G;
      d[i + 3] = Math.max(0, Math.min(1, 1 - (m - 20) / 100)) * 255;
      if (m > 0) { d[i] = R - m; d[i + 2] = B - m; }
    }
  }
  return { id, w, h };
}

// one grid cell -> a sprite: cropped to what's drawn, with its foot (middle of whatever touches the bottom)
function cutCell(sheet, x0c, y0c, x1c, y1c) {
  const { id, w } = sheet, d = id.data;
  const cw = x1c - x0c, ch = y1c - y0c;
  const rowN = new Int32Array(ch), colN = new Int32Array(cw);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (d[((y0c + y) * w + x0c + x) * 4 + 3] > 128) { rowN[y]++; colN[x]++; }
  }
  let y0 = -1, y1 = -1, x0 = -1, x1 = -1;
  for (let y = 0; y < ch; y++) if (rowN[y] >= 2) { if (y0 < 0) y0 = y; y1 = y + 1; }
  for (let x = 0; x < cw; x++) if (colN[x] >= 2) { if (x0 < 0) x0 = x; x1 = x + 1; }
  if (y0 < 0 || x0 < 0) return null;
  const sw = x1 - x0, sh = y1 - y0;
  const out = canvas(sw, sh), g = out.getContext('2d');
  const part = new ImageData(sw, sh);
  for (let y = 0; y < sh; y++) {
    const src = ((y0c + y0 + y) * w + x0c + x0) * 4;
    part.data.set(d.subarray(src, src + sw * 4), y * sw * 4);
  }
  g.putImageData(part, 0, 0);
  // foot: the middle of the solid pixels in the bottom few rows
  const band = Math.max(2, Math.floor(sh / 30));
  let fx0 = -1, fx1 = -1;
  for (let x = 0; x < sw; x++) {
    for (let y = sh - band; y < sh; y++) {
      if (part.data[(y * sw + x) * 4 + 3] > 128) { if (fx0 < 0) fx0 = x; fx1 = x + 1; break; }
    }
  }
  const footX = fx0 >= 0 ? (fx0 + fx1) / 2 : sw / 2;
  return finishSprite(out, footX, false);
}

// a sprite record: image + soft-shadow silhouette + its size in tiles at size 1 (the game's fit into 2 x 3 tiles)
function finishSprite(img, footX, pixel) {
  const w = img.width, h = img.height;
  const sil = canvas(w, h), g = sil.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  return { img, sil, w, h, footX, footY: h, pixel };
}

// tiles per sprite pixel at prop size `size`, matching pack_props.py: fits 15.5 x 22.5 art px around the foot
export function tilesPerPx(s, size) {
  if (s.pixel) return size / 64;          // pixel art is upscaled 8x: 1 sprite px = 1/8 art px = 1/64 tile
  const half = Math.max(s.footX, s.w - s.footX);
  return Math.min(15.5 * size / (2 * half), 22.5 * size / s.h) / 8;
}

// ---------- ground textures ----------

// square crop -> TEX x TEX, then made seamless: blend with a copy shifted by half, first across x, then across y
function makeSeamless(img) {
  const s = Math.min(img.width, img.height);
  const c = canvas(TEX, TEX), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, TEX, TEX);
  let src = g.getImageData(0, 0, TEX, TEX).data;
  const H = TEX / 2, band = TEX * 0.22;
  const weight = p => {             // 1 at the edges (use the shifted copy), 0 in the middle (keep the original)
    const e = Math.min(p, TEX - 1 - p);
    const t = Math.max(0, Math.min(1, 1 - e / band));
    return t * t * (3 - 2 * t);
  };
  for (const axis of [0, 1]) {
    const dst = new Uint8ClampedArray(src.length);
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      const w = weight(axis ? y : x);
      const sx = axis ? x : (x + H) % TEX, sy = axis ? (y + H) % TEX : y;
      const i = (y * TEX + x) * 4, j = (sy * TEX + sx) * 4;
      for (let k = 0; k < 3; k++) dst[i + k] = src[i + k] * (1 - w) + src[j + k] * w;
      dst[i + 3] = 255;
    }
    src = dst;
  }
  g.putImageData(new ImageData(src, TEX, TEX), 0, 0);
  return c;
}

// ---------- the game's pixel art (fallback for everything without AI art yet) ----------

function pixelArt() {
  const { data } = buildAtlas(SKIN);
  const atlas = canvas(ATLAS_W, ATLAS_H);
  atlas.getContext('2d').putImageData(new ImageData(data, ATLAS_W, ATLAS_H), 0, 0);
  const up = (sx, sy, w, h, k) => {
    const c = canvas(w * k, h * k), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(atlas, sx, sy, w, h, 0, 0, w * k, h * k);
    return c;
  };
  // big props: kind k variant v at index k*4+v; drawn 8x bigger so they stay crisp, foot at (8, 23) art px
  const props = {};
  Object.keys(SKIN.props).forEach((name, k) => {
    props[name] = [0, 1, 2, 3].map(v => {
      const i = k * 4 + v;
      const s = finishSprite(up((i % PROP_COLS) * PROP_W, PROP_Y0 + Math.floor(i / PROP_COLS) * PROP_H, PROP_W, PROP_H, 8),
        8 * 8, true);
      s.footY = 23 * 8;               // the art's foot is one art px above its bottom
      return s;
    });
  });
  // small decorations: 8x8 slots
  const decor = {};
  Object.keys(SKIN.decor).forEach((name, k) => {
    decor[name] = [0, 1, 2, 3].map(v => {
      const slot = SLOT_DECO + k * 4 + v;
      const s = finishSprite(up((slot % ATLAS_COLS) * 8, Math.floor(slot / ATLAS_COLS) * 8, 8, 8, 8), 32, true);
      s.footY = 60;
      return s;
    });
  });
  // ground: 8 x 8 tiles of random variants -> one 256 px pattern (8 tiles)
  const ground = {};
  BASE.forEach((name, id) => {
    const small = canvas(64, 64), g = small.getContext('2d');
    g.imageSmoothingEnabled = false;
    const r = mulberry32(hash32(id, 77));
    const base = (SKIN.floor || []).includes(name) ? SLOT_FLOOR + id * 4 : id * 4;
    for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
      const slot = base + ((r() * 4) | 0);
      g.drawImage(atlas, (slot % ATLAS_COLS) * 8, Math.floor(slot / ATLAS_COLS) * 8, 8, 8, tx * 8, ty * 8, 8, 8);
    }
    const big = canvas(256, 256), bg = big.getContext('2d');
    bg.imageSmoothingEnabled = false;
    bg.drawImage(small, 0, 0, 256, 256);
    ground[name] = big;
  });
  return { props, decor, ground };
}

// ---------- everything ----------

export async function loadAll(progress) {
  const pixel = pixelArt();
  let manifest = { kinds: {} };
  try { manifest = await (await fetch(ART + 'props/props.json', { cache: 'no-store' })).json(); } catch { /* none */ }

  const propFiles = (await listPngs('props/raw/', 'props')).map(f => ({ file: f, ...parseName(f) })).filter(f => f.name);
  const groundFiles = (await listPngs('ground/raw/', 'ground')).map(f => ({ file: f, ...parseName(f) })).filter(f => f.name);
  const total = propFiles.length + groundFiles.length;
  let done = 0;
  const tick = label => progress && progress(++done, total, label);

  // sheets[file] = { kind, v, grid, cells: [sprite|null] }
  const sheets = {};
  await Promise.all(propFiles.map(async f => {
    try {
      const img = await loadImage(ART + 'props/raw/' + encodeURIComponent(f.file));
      const m = manifest.kinds[f.name];
      const grid = (m && m.sheet === f.file && m.grid) || [3, 2];
      const keyed = keyOut(img);
      const cells = [];
      for (let r = 0; r < grid[1]; r++) for (let c = 0; c < grid[0]; c++) {
        cells.push(cutCell(keyed, Math.floor(c * keyed.w / grid[0]), Math.floor(r * keyed.h / grid[1]),
          Math.floor((c + 1) * keyed.w / grid[0]), Math.floor((r + 1) * keyed.h / grid[1])));
      }
      sheets[f.file] = { file: f.file, kind: f.name, v: f.v, grid, cells };
    } catch (e) { console.warn('could not load sheet', f.file, e); }
    tick(f.file);
  }));

  // textures[file] = { name, v, img (seamless 512 canvas), raw (original image) }
  const textures = {};
  await Promise.all(groundFiles.map(async f => {
    try {
      const img = await loadImage(ART + 'ground/raw/' + encodeURIComponent(f.file));
      textures[f.file] = { file: f.file, name: f.name, v: f.v, img: makeSeamless(img), raw: img };
    } catch (e) { console.warn('could not load texture', f.file, e); }
    tick(f.file);
  }));

  return { manifest, sheets, textures, pixel };
}
