// The Biome Lab's little world: a square of tiles with a lake in the middle and biome regions around it,
// soft wiggly borders between biomes, and props / decorations scattered the way the game scatters them.
import { BASE } from '../galaxy-demo/js/ids.js';
import { makeNoise } from '../galaxy-demo/js/noise.js';
import { mulberry32, hash32 } from '../galaxy-demo/js/rng.js';
import { canvas } from './assets.js';

export const SUB = 4;                    // border detail: the biome map is computed at 4 x 4 samples per tile
export const PROP_SPOT = 1.5;            // one prop spot per 1.5 x 1.5 tiles (the game: one per 12 x 12 art px)
export const DECOR_SPOT = 1;             // one decoration spot per tile
const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));
const rnd = (a, b, c, d) => hash32(a, b, c, d) / 4294967296;

// ---------- tiles ----------

// p: { seed, size, lake (0..0.8 of the world's half-width), beach (tiles), regions, warp (0..1), biomes: [names] }
export function generateTiles(p) {
  const N = p.size, tiles = new Uint8Array(N * N);
  const noise = makeNoise(p.seed);
  const r = mulberry32(hash32(p.seed, 5));
  const c = N / 2, lakeR = p.lake * N * 0.5, shallow = Math.max(1.5, lakeR * 0.35);
  const list = p.biomes.length ? [...p.biomes] : ['GRASS'];
  for (let i = list.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
  const seeds = [];
  const K = Math.max(1, p.regions), a0 = r() * Math.PI * 2;
  for (let i = 0; i < K; i++) {
    const ang = a0 + (i + (r() - 0.5) * 0.6) * Math.PI * 2 / K;
    const rad = lakeR + (N * 0.62 - lakeR) * (0.3 + 0.55 * r());
    seeds.push({ x: c + Math.cos(ang) * rad, y: c + Math.sin(ang) * rad, id: ID[list[i % list.length]] });
  }
  const warp = N * 0.14 * p.warp;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (lakeR > 0) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) + noise.fbm(x * 0.05, y * 0.05, 1.3, 3) * lakeR * 0.45;
      if (d < lakeR - shallow) { tiles[i] = ID.DEEP; continue; }
      if (d < lakeR) { tiles[i] = ID.SHALLOW; continue; }
      if (d < lakeR + p.beach) { tiles[i] = ID.BEACH; continue; }
    }
    const wx = x + noise.fbm(x * 0.025, y * 0.025, 7.7, 3) * warp;
    const wy = y + noise.fbm(x * 0.025, y * 0.025, 11.1, 3) * warp;
    let best = 1e9, id = seeds[0].id;
    for (const s of seeds) {
      const dd = (wx - s.x) ** 2 + (wy - s.y) ** 2;
      if (dd < best) { best = dd; id = s.id; }
    }
    tiles[i] = id;
  }
  return tiles;
}

// ---------- the fine biome map (wiggly borders) and one soft mask per biome ----------

export function makeWorld(tiles, N, seed) {
  const M = N * SUB;
  return { tiles, N, M, seed, fine: new Uint8Array(M * M), noise: makeNoise(seed + 99), masks: {}, present: [] };
}

// recompute the fine map inside a tile rectangle (all of it by default); wiggle = how far borders wander, in tiles
export function refine(w, wiggle, x0 = 0, y0 = 0, x1 = w.N, y1 = w.N) {
  const { N, M, tiles, fine, noise } = w;
  const s0x = Math.max(0, Math.floor((x0 - 2) * SUB)), s1x = Math.min(M, Math.ceil((x1 + 2) * SUB));
  const s0y = Math.max(0, Math.floor((y0 - 2) * SUB)), s1y = Math.min(M, Math.ceil((y1 + 2) * SUB));
  for (let sy = s0y; sy < s1y; sy++) for (let sx = s0x; sx < s1x; sx++) {
    const tx = (sx + 0.5) / SUB, ty = (sy + 0.5) / SUB;
    let x = tx, y = ty;
    if (wiggle > 0) {
      x += noise.fbm(tx * 0.45, ty * 0.45, 3.7, 2) * wiggle * 1.6;
      y += noise.fbm(tx * 0.45, ty * 0.45, 9.1, 2) * wiggle * 1.6;
    }
    const ix = Math.min(N - 1, Math.max(0, Math.floor(x))), iy = Math.min(N - 1, Math.max(0, Math.floor(y)));
    fine[sy * M + sx] = tiles[iy * N + ix];
  }
}

// one alpha mask canvas per biome present, blurred by `soft` tiles so neighbouring biomes blend
export function buildMasks(w, soft) {
  const { M, fine } = w;
  const present = [...new Set(fine)].sort((a, b) => a - b);
  const masks = {};
  for (const id of present) {
    const img = new ImageData(M, M), d = img.data;
    for (let i = 0; i < fine.length; i++) if (fine[i] === id) { const k = i * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = 255; }
    const sharp = canvas(M, M);
    sharp.getContext('2d').putImageData(img, 0, 0);
    if (soft <= 0) { masks[id] = sharp; continue; }
    const c = canvas(M, M), g = c.getContext('2d');
    g.filter = `blur(${soft * SUB}px)`;
    g.drawImage(sharp, 0, 0);
    masks[id] = c;
  }
  w.masks = masks;
  w.present = present;
}

export const biomeAt = (w, x, y) => {
  const sx = Math.floor(x * SUB), sy = Math.floor(y * SUB);
  if (sx < 0 || sy < 0 || sx >= w.M || sy >= w.M) return -1;
  return w.fine[sy * w.M + sx];
};

// ---------- scattering props and decorations ----------

// settingsFor(id) -> biome settings; pickProp(id, kindRand, cellRand) -> { sprite, tpp } | null (same for decor)
export function scatter(w, settingsFor, pickProp, pickDecor, mirror) {
  const { N, seed, noise } = w;
  const props = [], decor = [];
  const n = Math.ceil(N / PROP_SPOT);
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const id0 = biomeAt(w, (gx + 0.5) * PROP_SPOT, (gy + 0.5) * PROP_SPOT);
    if (id0 < 0) continue;
    const b0 = settingsFor(id0);
    const jit = b0 ? b0.jitter : 0.8;
    const x = (gx + 0.5 + (rnd(gx, gy, seed, 2) - 0.5) * jit) * PROP_SPOT;
    const y = (gy + 0.5 + (rnd(gx, gy, seed, 3) - 0.5) * jit) * PROP_SPOT;
    const id = biomeAt(w, x, y);
    const b = id >= 0 && settingsFor(id);
    if (!b || !b.density) continue;
    const cl = noise.fbm(x / b.clump, y / b.clump, 21.3, 2) * 1.6;
    const p = b.density * Math.max(0, 1 + b.cluster * 2.2 * cl);
    if (rnd(gx, gy, seed, 1) >= p) continue;
    const pick = pickProp(id, rnd(gx, gy, seed, 4), rnd(gx, gy, seed, 5));
    if (!pick) continue;
    const size = b.size * (1 + (rnd(gx, gy, seed, 6) * 2 - 1) * b.sizeVar);
    props.push({ x, y, s: pick.sprite, k: pick.tpp * size, flip: mirror && rnd(gx, gy, seed, 7) < 0.5 ? -1 : 1 });
  }
  props.sort((a, b) => a.y - b.y);
  const m = Math.ceil(N / DECOR_SPOT);
  for (let gy = 0; gy < m; gy++) for (let gx = 0; gx < m; gx++) {
    const x = (gx + 0.15 + rnd(gx, gy, seed, 12) * 0.7) * DECOR_SPOT;
    const y = (gy + 0.15 + rnd(gx, gy, seed, 13) * 0.7) * DECOR_SPOT;
    const id = biomeAt(w, x, y);
    const b = id >= 0 && settingsFor(id);
    if (!b || !b.decor) continue;
    if (rnd(gx, gy, seed, 11) >= b.decor) continue;
    const pick = pickDecor(id, rnd(gx, gy, seed, 14), rnd(gx, gy, seed, 15));
    if (!pick) continue;
    decor.push({ x, y, s: pick.sprite, k: pick.tpp * b.decorSize, flip: rnd(gx, gy, seed, 16) < 0.5 ? -1 : 1 });
  }
  return { props, decor };
}

// ---------- drawing ----------

// view: { ox, oy, z }: world tile (ox, oy) sits at the canvas's top-left, z = device px per tile
// pattern(id) -> { img, tiles } (a repeating image covering `tiles` x `tiles` tiles)
export function draw(ctx, layer, shadowLayer, w, view, scene, pattern, opt) {
  const W = ctx.canvas.width, H = ctx.canvas.height, { ox, oy, z } = view;
  const g = layer.getContext('2d');
  const X = wx => (wx - ox) * z, Y = wy => (wy - oy) * z;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = '#0d1016';
  ctx.fillRect(0, 0, W, H);
  const wx0 = Math.max(0, X(0)), wy0 = Math.max(0, Y(0)), wx1 = Math.min(W, X(w.N)), wy1 = Math.min(H, Y(w.N));
  if (wx1 <= wx0 || wy1 <= wy0) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);

  // ground: each biome's texture cut out by its soft mask, added together so the blends sum to 100%
  ctx.globalCompositeOperation = 'lighter';
  for (const id of w.present) {
    const pt = pattern(id);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    const pat = g.createPattern(pt.img, 'repeat');
    const k = z * pt.tiles / pt.img.width;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, X(0), Y(0)]));
    g.fillStyle = pat;
    g.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingEnabled = true;
    g.drawImage(w.masks[id], X(0), Y(0), w.N * z, w.N * z);
    ctx.drawImage(layer, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';

  const pad = 4 * z;
  const visible = (it) => {
    const sx = X(it.x), sy = Y(it.y);
    return sx > -pad && sx < W + pad && sy > -pad && sy < H + pad * 1.5;
  };
  const sprite = (c, it, img) => {
    const k = z * it.k;
    c.setTransform(it.flip, 0, 0, 1, X(it.x), Y(it.y));
    c.drawImage(img, -it.s.footX * k, -it.s.footY * k, it.s.w * k, it.s.h * k);
  };

  if (opt.decor) for (const it of scene.decor) if (visible(it)) sprite(ctx, it, it.s.img);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (opt.props) {
    // shadows: every silhouette projected down-right onto one layer, then laid down once, soft and see-through
    if (opt.shadow > 0) {
      const sg = shadowLayer.getContext('2d');
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, W, H);
      const sx = 0.75 * opt.shadowLen, sy = 0.42 * opt.shadowLen;
      for (const it of scene.props) {
        if (!visible(it)) continue;
        const k = z * it.k;
        sg.setTransform(it.flip * k, 0, -sx * k, -sy * k, X(it.x), Y(it.y));
        sg.drawImage(it.s.sil, -it.s.footX, -it.s.footY);
      }
      ctx.globalAlpha = opt.shadow;
      ctx.filter = `blur(${Math.max(0.5, z * 0.08).toFixed(1)}px)`;
      ctx.drawImage(shadowLayer, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    }
    for (const it of scene.props) if (visible(it)) sprite(ctx, it, it.s.img);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // dim everything but one biome
  if (opt.focus != null && w.masks[opt.focus]) {
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8, 10, 16, 0.62)';
    g.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(w.masks[opt.focus], X(0), Y(0), w.N * z, w.N * z);
    ctx.drawImage(layer, 0, 0);
  }

  if (opt.grid && z >= 10) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const tx0 = Math.max(0, Math.floor(ox)), tx1 = Math.min(w.N, Math.ceil(ox + W / z));
    const ty0 = Math.max(0, Math.floor(oy)), ty1 = Math.min(w.N, Math.ceil(oy + H / z));
    for (let t = tx0; t <= tx1; t++) { const x = Math.round(X(t)) + 0.5; ctx.moveTo(x, wy0); ctx.lineTo(x, wy1); }
    for (let t = ty0; t <= ty1; t++) { const y = Math.round(Y(t)) + 0.5; ctx.moveTo(wx0, y); ctx.lineTo(wx1, y); }
    ctx.stroke();
  }
}
