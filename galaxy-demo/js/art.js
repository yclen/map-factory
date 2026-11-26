// Placeholder pixel art, drawn from the skin's colours and patterns into one 256x512 atlas: 8x8 tiles on top,
// 16x24 big props (trees, boulders) below.
// Runs on the main thread (for the GPU) and in the map worker (for each tile's average colour).
// Hand-drawn art can replace any slot later without touching the generator.
import { BASE, OVER, ATLAS_COLS, SLOT_OVER, SLOT_WALKER, SLOT_PIN, SLOT_FLOOR, SLOT_DECO, SLOT_ORE, RESOURCES, PROP_W, PROP_H, PROP_Y0, PROP_COLS } from './ids.js?v=20261125193712';
import { mulberry32, hash32 } from './rng.js?v=20261125193712';

export const ATLAS_W = 256, ATLAS_H = 512;

export function buildAtlas(skin) {
  const data = new Uint8ClampedArray(ATLAS_W * ATLAS_H * 4);
  const put = (slot, x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x > 7 || y > 7) return;
    const px = (slot % ATLAS_COLS) * 8 + x, py = Math.floor(slot / ATLAS_COLS) * 8 + y;
    const i = (py * ATLAS_W + px) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a;
  };
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const fill = (slot, c, r, jit = 0.05) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) put(slot, x, y, shade(c, 1 + (r() - 0.5) * jit * 2));
  };

  // ---------- ground tiles ----------
  BASE.forEach((name, id) => {
    const s = skin.base[name];
    for (let v = 0; v < 4; v++) {
      const slot = id * 4 + v, r = mulberry32(hash32(id, v, 31));
      const c = s.c, c2 = s.c2 || s.c, c3 = s.c3 || c2;
      fill(slot, c, r, s.style === 'water' ? 0.02 : 0.05);
      switch (s.style) {
        case 'water': {
          for (let k = 0; k < 2; k++) {
            const y = 1 + Math.floor(r() * 6), x = Math.floor(r() * 5);
            for (let i = 0; i < 3; i++) put(slot, x + i, y, c2);
          }
          break;
        }
        case 'speckle':
          for (let k = 0; k < 10; k++) put(slot, (r() * 8) | 0, (r() * 8) | 0, r() < 0.25 ? c3 : c2);
          break;
        case 'grass':
          for (let k = 0; k < 6; k++) { const x = (r() * 8) | 0, y = 1 + ((r() * 7) | 0); put(slot, x, y, c2); put(slot, x, y - 1, c2); }
          if (r() < 0.4) put(slot, (r() * 8) | 0, (r() * 8) | 0, c3);
          break;
        case 'trees': {
          const n = 2 + ((r() * 2) | 0);
          for (let k = 0; k < n; k++) {
            const cx = 1 + ((r() * 6) | 0), cy = 1 + ((r() * 5) | 0);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) + Math.abs(dy) < 2) put(slot, cx + dx, cy + dy, c2);
            put(slot, cx - 1, cy - 1, c3); put(slot, cx, cy + 2, shade(c2, 0.6));
          }
          break;
        }
        case 'pines': {
          for (let k = 0; k < 2; k++) {
            const cx = 1 + ((r() * 6) | 0), cy = 1 + ((r() * 3) | 0);
            put(slot, cx, cy, c2); put(slot, cx - 1, cy + 1, c2); put(slot, cx, cy + 1, c3); put(slot, cx + 1, cy + 1, c2);
            put(slot, cx - 1, cy + 2, c2); put(slot, cx, cy + 2, c2); put(slot, cx + 1, cy + 2, c2); put(slot, cx, cy + 3, [70, 50, 40]);
          }
          break;
        }
        case 'swamp':
          for (let k = 0; k < 3; k++) { const x = (r() * 6) | 0, y = (r() * 7) | 0; put(slot, x, y, c2); put(slot, x + 1, y, c2); put(slot, x + 2, y, c2); }
          for (let k = 0; k < 3; k++) put(slot, (r() * 8) | 0, (r() * 8) | 0, c3);
          break;
        case 'dunes': {
          const o = (r() * 8) | 0;
          for (let x = 0; x < 8; x++) { put(slot, x, (x + o) % 8, c2); put(slot, x, (x + o + 4) % 8, shade(c, 1.06)); }
          break;
        }
        case 'cracks': {
          let x = (r() * 8) | 0, y = 0;
          while (y < 8) { put(slot, x, y, c2); y++; x += r() < 0.33 ? -1 : r() < 0.5 ? 1 : 0; }
          if (s.c3) put(slot, (r() * 8) | 0, (r() * 8) | 0, c3);
          break;
        }
        case 'rock':
          for (let k = 0; k < 3; k++) {
            const x = (r() * 6) | 0, y = (r() * 6) | 0;
            put(slot, x, y, c3); put(slot, x + 1, y, c3); put(slot, x, y + 1, c2); put(slot, x + 1, y + 1, c2); put(slot, x + 2, y + 1, c2);
          }
          break;
        case 'snow':
          for (let k = 0; k < 6; k++) put(slot, (r() * 8) | 0, (r() * 8) | 0, c2);
          if (r() < 0.5) put(slot, (r() * 8) | 0, (r() * 8) | 0, [255, 255, 255]);
          break;
        case 'peak':
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (y < 3 + (((x * 7 + v * 3) % 3))) put(slot, x, y, c2);
          for (let k = 0; k < 4; k++) put(slot, (r() * 8) | 0, 4 + ((r() * 4) | 0), shade(c, 0.8));
          break;
        case 'lava':
          fill(slot, c2, r, 0.06);
          for (let k = 0; k < 2; k++) {
            let x = (r() * 8) | 0;
            for (let y = 0; y < 8; y++) { put(slot, x, y, c); if (r() < 0.3) put(slot, x + 1, y, c3); x += r() < 0.3 ? 1 : r() < 0.4 ? -1 : 0; x = (x + 8) % 8; }
          }
          break;
        case 'crater':
          for (let a = 0; a < 16; a++) {
            const x = Math.round(3.5 + Math.cos(a / 16 * 6.283) * 2.6), y = Math.round(3.5 + Math.sin(a / 16 * 6.283) * 2.6);
            put(slot, x, y, a < 8 ? c2 : shade(c, 0.78));
          }
          break;
      }
    }
  });

  // ---------- overlays: deposits and buildings (transparent background) ----------
  OVER.forEach((name, id) => {
    if (id === 0) return;
    const s = skin.over[name];
    for (let v = 0; v < 4; v++) {
      const slot = SLOT_OVER + id * 4 + v, r = mulberry32(hash32(id, v, 57));
      const c = s.c, c2 = s.c2 || s.c;
      const dark = shade(c, 0.55);
      switch (s.style) {
        case 'ore': case 'boulder': {
          const n = s.style === 'ore' ? 3 : 2;
          for (let k = 0; k < n; k++) {
            const x = 1 + ((r() * 5) | 0), y = 1 + ((r() * 5) | 0);
            put(slot, x, y, c); put(slot, x + 1, y, c); put(slot, x, y + 1, dark); put(slot, x + 1, y + 1, s.style === 'ore' ? c2 : dark);
            if (r() < 0.5) put(slot, x + 2, y + 1, dark);
          }
          break;
        }
        case 'puddle':
          for (let y = 2; y < 6; y++) for (let x = 1; x < 7; x++) if ((x - 3.5) ** 2 / 9 + (y - 3.5) ** 2 / 3 < 1) put(slot, x, y, c);
          put(slot, 3, 3, c2); put(slot, 4, 3, c2);
          break;
        case 'crystal':
          for (let k = 0; k < 2; k++) {
            const x = 1 + ((r() * 5) | 0), y = 2 + ((r() * 3) | 0);
            put(slot, x, y, c); put(slot, x, y + 1, c); put(slot, x, y + 2, c2); put(slot, x + 1, y + 1, c2); put(slot, x + 1, y + 2, c2);
          }
          break;
        case 'hut':
          put(slot, 3, 2, c); put(slot, 2, 3, c); put(slot, 3, 3, c); put(slot, 4, 3, c);
          for (let x = 2; x < 5; x++) for (let y = 4; y < 6; y++) put(slot, x, y, c2);
          put(slot, 3, 5, [40, 28, 20]);
          break;
        case 'house': {
          const ox = (r() * 2) | 0;
          for (let x = 1; x < 7; x++) put(slot, x + ox - 1, 2, c);
          for (let x = 0; x < 8; x++) put(slot, x + ox - 1, 3, c);
          for (let y = 4; y < 7; y++) for (let x = 1; x < 7; x++) put(slot, x + ox - 1, y, c2);
          put(slot, 2 + ox, 5, [255, 220, 130]); put(slot, 4 + ox, 5, [80, 56, 40]); put(slot, 4 + ox, 6, [80, 56, 40]);
          break;
        }
        case 'block':
          for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) put(slot, x, y, (y % 2 === 0 && x % 2 === 1 && r() < 0.8) ? c2 : c);
          for (let x = 1; x < 7; x++) put(slot, x, 7, shade(c, 0.6));
          break;
        case 'tower':
          for (let y = 0; y < 8; y++) for (let x = 2; x < 6; x++) put(slot, x, y, ((y + v) % 2 === 0 && (x === 3 || x === 4) && r() < 0.85) ? c2 : c);
          put(slot, 3, 0, [255, 90, 80]);
          for (let y = 2; y < 8; y++) put(slot, 6, y, shade(c, 0.6));
          break;
      }
    }
  });

  // ---------- forest floor: what's under the scattered trees (dark ground, leaf litter) ----------
  for (const name of skin.floor || []) {
    const id = BASE.indexOf(name), s = skin.base[name], c = shade(s.c, 0.78), c2 = shade(s.c2 || s.c, 0.8), c3 = s.c3 || s.c;
    for (let v = 0; v < 4; v++) {
      const slot = SLOT_FLOOR + id * 4 + v, r = mulberry32(hash32(id, v, 71));
      fill(slot, c, r, 0.06);
      for (let k = 0; k < 9; k++) put(slot, (r() * 8) | 0, (r() * 8) | 0, r() < 0.3 ? shade(c3, 0.8) : c2);
    }
  }

  // ---------- scattered decorations: 8x8, transparent, standing on the bottom rows ----------
  Object.values(skin.decor || {}).forEach((d, k) => {
    for (let v = 0; v < 4; v++) {
      const slot = SLOT_DECO + k * 4 + v, r = mulberry32(hash32(k, v, 93));
      const c = d.c, c2 = d.c2 || d.c, c3 = d.c3 || d.c;
      const P = (x, y, col) => put(slot, x, y, col);
      // a shaded blob: light from the top left, dark at the bottom right
      const blob = (cx, cy, rad, rough = 0) => {
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, rr = rad + (rough ? (r() - 0.5) * rough : 0);
          if (dx * dx + dy * dy > rr * rr) continue;
          const lit = -(dx + dy) / (rad * 1.4);
          P(x, y, lit > 0.35 ? c3 : lit < -0.3 ? c2 : r() < 0.18 ? c2 : c);
        }
      };
      const trunk = [96, 70, 50];
      switch (d.style) {
        case 'tuft':
          for (let i = 0; i < 4; i++) {
            const x = 2 + i + ((r() * 2) | 0) - 1, h = 2 + ((r() * 3) | 0);
            for (let y = 7 - h; y < 8; y++) P(x, y, y === 7 - h ? c2 : c);
          }
          break;
        case 'flowers': {
          const petals = [c, c2, c3];
          for (let i = 0; i < 3; i++) {
            const x = 1 + ((r() * 6) | 0), y = 2 + ((r() * 5) | 0);
            P(x, y + 1, [80, 140, 60]); P(x, y, petals[(v + i) % 3]);
          }
          break;
        }
        case 'bush': blob(4, 5.2, 1.9 + v * 0.35, 0.6); break;
        case 'round':
          P(4, 7, trunk); P(3, 7, shade(trunk, 0.7));
          blob(4, 3.6, 3.0 + (v & 1) * 0.4, 0.8);
          break;
        case 'jungle':
          P(4, 7, trunk);
          blob(4, 3.5, 3.5, 1.4);
          for (let i = 0; i < 3; i++) P(1 + ((r() * 6) | 0), 1 + ((r() * 4) | 0), c3);
          break;
        case 'pine': {
          const tiers = v & 1 ? [0, 1, 1, 2, 2, 3, 3] : [0, 0, 1, 1, 2, 2, 3];
          for (let y = 0; y < 7; y++) for (let x = 4 - tiers[y]; x <= 4 + tiers[y]; x++) P(x, y, x < 4 ? c : x > 4 ? c2 : c);
          const snowy = d.c3[0] > 200;                                        // snow on the branch tips
          P(3, 2, c3); P(2, 4, c3); P(1, 6, snowy ? c3 : c); if (snowy) { P(4, 0, c3); P(5, 4, c3); }
          P(4, 7, trunk);
          break;
        }
        case 'acacia':
          for (let x = 0; x < 8; x++) P(x, 2, x < 4 ? c : c2);
          for (let x = 1; x < 7; x++) { P(x, 1, x < 4 ? c3 : c); P(x, 3, c2); }
          P(4, 4, trunk); P(3, 5, trunk); P(4, 5, trunk); P(4, 6, trunk); P(4, 7, trunk); P(5, 4, trunk);
          break;
        case 'dead':
          for (let y = 2; y < 8; y++) P(4, y, y > 5 ? c2 : c);
          P(3, 3, c); P(2, 2, c); P(5, 4, c); P(6, 3, c); P(6, 2, c2); P(3, 1, c2);
          break;
        case 'reeds':
          for (let i = 0; i < 3; i++) {
            const x = 2 + i * 2 - (v & 1), h = 4 + ((r() * 3) | 0);
            for (let y = 8 - h; y < 8; y++) P(x, y, c);
            P(x, 8 - h, c2); P(x, 9 - h, c2);
          }
          break;
        case 'cactus':
          for (let y = 1; y < 8; y++) { P(3, y, c3); P(4, y, c); }
          P(1, 3, c3); P(1, 4, c3); P(2, 4, c);
          if (v & 1) { P(6, 2, c); P(6, 3, c); P(5, 3, c2); } else { P(6, 4, c); P(6, 5, c); P(5, 5, c2); }
          break;
        case 'bones':
          P(2, 5, c); P(3, 4, c); P(4, 4, c); P(5, 5, c); P(3, 6, c2); P(5, 6, c2);
          if (v & 1) { P(1, 6, c); P(6, 6, c); }
          break;
        case 'shell':
          P(3, 6, c); P(4, 6, c); P(3, 5, c2); P(4, 5, c); if (v & 1) P(5, 6, c2);
          break;
        case 'drift':
          for (let x = 1; x < 7; x++) { P(x, 6, c); P(x, 5, x > 2 && x < 6 ? c3 : c); }
          P(0, 5, c2); P(7, 6, c2);
          break;
        case 'pebbles':
          for (let i = 0; i < 3; i++) { const x = 1 + ((r() * 6) | 0), y = 3 + ((r() * 4) | 0); P(x, y, c); P(x, y + 1, c2); }
          break;
        case 'rock': case 'snowrock': {
          const w = 2 + (v >> 1), h = 1.6 + (v & 1) * 0.6;
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            const dx = (x + 0.5 - 4) / w, dy = (y + 0.5 - (7.5 - h)) / h;
            if (dx * dx + dy * dy > 1 || y > 7) continue;
            const top = dy < -0.35;
            P(x, y, d.style === 'snowrock' && top ? c3 : dx + dy < -0.6 ? c3 : dx + dy > 0.5 ? c2 : c);
          }
          break;
        }
        case 'ice':
          for (let y = 3; y < 8; y++) for (let x = 2 + (y > 5 ? 0 : 1); x < 6 + (y > 4 ? 1 : 0); x++) P(x, y, x - y < -1 ? c2 : c);
          P(3, 3, c3); P(4, 4, c3);
          break;
        case 'spire': {
          const top = 1 + (v & 1) * 2;
          for (let y = top; y < 8; y++) { P(3, y, c); P(4, y, c2); }
          P(3, top, c3); P(4, top, c3); if (v > 1) { P(5, 6, c2); P(5, 7, c2); P(5, 5, c3); }
          break;
        }
      }
    }
  });

  // ---------- deposits by richness (the new terrain look): sparse at a patch's edge, packed in its middle ----------
  for (const name of RESOURCES) {
    const id = OVER.indexOf(name), s = skin.over[name], c = s.c, c2 = s.c2 || s.c, c3 = s.c3 || c, c4 = s.c4;
    for (let L = 0; L < 4; L++) for (let v = 0; v < 4; v++) {
      const slot = SLOT_ORE + id * 16 + L * 4 + v, r = mulberry32(hash32(id, L * 4 + v, 113));
      const P = (x, y, col) => put(slot, x, y, col);
      // a lump of ore: lit corner top left, shadowed bottom and right edges
      const lump = (x, y, w, h) => {
        const patina = c4 && r() < 0.5;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
          const edge = dy === h - 1 || dx === w - 1;
          P(x + dx, y + dy, dx + dy === 0 ? c3 : edge ? c2 : patina && r() < 0.4 ? c4 : c);
        }
      };
      switch (s.style) {
        case 'ore': {
          const n = [2, 3, 5, 7][L];
          for (let k = 0; k < n; k++) lump((r() * 6) | 0, (r() * 6) | 0, 2 + (r() < 0.3 ? 1 : 0), 2);
          if (L === 3) lump(2 + ((r() * 3) | 0), 2 + ((r() * 3) | 0), 3, 3);
          break;
        }
        case 'boulder': {
          const n = [1, 2, 3, 4][L];
          for (let k = 0; k < n; k++) {
            const w = 2 + (r() < 0.5 ? 1 : 0), x = (r() * (8 - w)) | 0, y = 1 + ((r() * 5) | 0);
            lump(x, y, w, 2); if (w === 3) P(x + 1, y - 1, c3);
          }
          break;
        }
        case 'puddle': {
          const rx = [1.6, 2.3, 3.0, 3.6][L], ry = rx * 0.6, cx = 3.5 + (r() - 0.5), cy = 4 + (r() - 0.5);
          for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
            if (d > 1) continue;
            P(x, y, d > 0.6 && dx + dy < 0 ? c2 : c);
          }
          P(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.3), c3);
          break;
        }
        case 'crystal': {
          const n = [1, 2, 3, 4][L];
          for (let k = 0; k < n; k++) {
            const x = (r() * 6) | 0, y = 1 + ((r() * 4) | 0), h = 2 + ((r() * 2) | 0);
            P(x, y, c3);
            for (let dy = 1; dy <= h; dy++) { P(x, y + dy, c3); P(x + 1, y + dy, c); }
            P(x, y + h + 1, c2); P(x + 1, y + h + 1, c2);
          }
          break;
        }
      }
    }
  }

  // ---------- big props (the new terrain look): trees and boulders, 16x24 art px, standing on row 22 ----------
  // Alpha 255 = the prop itself, alpha 96 = its shadow on the ground (cast down and to the right), 0 = nothing.
  // Everything is lit from the top left: each leaf cluster, tier or rock facet gets its own light and dark side
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  Object.values(skin.props || {}).forEach((d, k) => {
    for (let v = 0; v < 4; v++) {
      const idx = k * 4 + v, r = mulberry32(hash32(k, v, 151));
      const buf = new Array(PROP_W * PROP_H).fill(null);
      const P = (x, y, col) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < PROP_W && y < PROP_H) buf[y * PROP_W + x] = col; };
      const has = (x, y) => x >= 0 && y >= 0 && x < PROP_W && y < PROP_H && buf[y * PROP_W + x] !== null;
      const alt = v === 3 && d.alt;                    // the last variant can wear other colours (autumn leaves)
      const c = alt ? d.alt.c : d.c, c2 = (alt ? d.alt.c2 : d.c2) || c, c3 = (alt ? d.alt.c3 : d.c3) || c;
      const pal = [shade(c2, 0.62), c2, c, c3, mix3(c3, [255, 250, 215], 0.35)];
      const tone = lit => pal[lit > 0.62 ? 4 : lit > 0.22 ? 3 : lit > -0.18 ? 2 : lit > -0.55 ? 1 : 0];
      const bark = d.bark || [104, 76, 54], barkD = shade(bark, 0.62), barkL = mix3(bark, [255, 240, 220], 0.22);
      const s = [0.88, 1, 0.94, 1.06][v];
      // a leafy canopy from overlapping round clusters, back to front; each cluster is lit on its top left, and
      // the whole crown darkens toward its underside
      const canopy = (blobs, top, bot, rough = 0.3) => {
        for (const b of blobs) {
          const ry = b.r * (b.sy || 1);
          for (let y = Math.floor(b.y - ry - 1); y <= b.y + ry + 1; y++) for (let x = Math.floor(b.x - b.r - 1); x <= b.x + b.r + 1; x++) {
            const dx = (x + 0.5 - b.x) / b.r, dy = (y + 0.5 - b.y) / ry;
            if (dx * dx + dy * dy > 1 + (r() - 0.5) * rough) continue;
            const under = (y + 0.5 - top) / Math.max(1, bot - top);
            P(x, y, tone(-(dx * 0.62 + dy * 0.78) * 0.85 + 0.22 - under * 0.6 + (r() - 0.5) * 0.42));
          }
        }
      };
      // clusters around a centre: one in the middle and n in a ring, sorted so the lower (nearer) ones overlap
      const ring = (cx, cy, R, n = 6, sy = 1) => {
        const b = [{ x: cx, y: cy, r: R * 0.6, sy }];
        for (let i = 0; i < n; i++) {
          const a = i / n * 6.283 + r() * 0.7;
          b.push({ x: cx + Math.cos(a) * R * 0.5, y: cy + Math.sin(a) * R * 0.44 * sy, r: R * (0.48 + r() * 0.16), sy });
        }
        return b.sort((p, q) => p.y - q.y);
      };
      const trunk = (x, y0, y1, w = 2) => {
        for (let y = y0; y <= y1; y++) for (let i = 0; i < w; i++) P(x + i, y, i === 0 ? barkL : i === w - 1 ? barkD : bark);
        P(x - 1, y1, barkD); P(x + w, y1, barkD);                                      // roots
      };
      const line = (x0, y0, x1, y1, col) => {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let i = 0; i <= n; i++) P(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, col);
      };
      const lowest = x => { for (let y = PROP_H - 1; y >= 0; y--) if (has(x, y)) return y; return -1; };
      let shadow = [4, 2];
      switch (d.style) {
        case 'oak': {                                  // broad round crown of leaf clusters on a short trunk
          const R = 6.7 * s, cy = 17.6 - R * 0.95;
          trunk(7, Math.floor(cy + R * 0.4), 22);
          canopy(ring(8, cy, R, 6), cy - R, cy + R);
          break;
        }
        case 'birch': {                                // tall white trunk with dark marks, a light narrow crown
          trunk(7, 6, 22);
          for (let y = 9; y < 22; y++) if (r() < 0.3) P(7 + (r() < 0.5 ? 0 : 1), y, [52, 48, 46]);
          const b = [];
          for (let i = 0; i < 6; i++) b.push({ x: 8 + (r() - 0.5) * 4, y: 4 + i * 2 * s, r: (3.1 + r() * 0.9) * s });
          canopy(b.sort((p, q) => p.y - q.y), 1, 16);
          break;
        }
        case 'pine': {                                 // a cone of drooping tiers, light on the left, dark below each tier
          const narrow = d.narrow ? 0.72 : 1, top = Math.round(1 + (1.06 - s) * 8), bot = 19, tiers = 4 + (v & 1);
          trunk(7, bot - 1, 22);
          for (let t = 0; t < tiers; t++) {
            const y0 = top + (bot - top) * t / tiers * 0.86, y1 = top + (bot - top) * (t + 1) / tiers + 1;
            const w1 = (1.3 + (t + 1) / tiers * 5.4) * s * narrow;
            for (let y = Math.floor(y0); y <= y1; y++) {
              const f = (y + 0.5 - y0) / (y1 - y0), hw = 0.6 + f * w1;
              for (let x = 0; x < PROP_W; x++) {
                const nx = (x + 0.5 - 8) / hw;
                if (Math.abs(nx) > 1) continue;
                const lit = -nx * 0.75 + (0.45 - f) * 1.1 + (r() - 0.5) * 0.4;
                P(x, y, d.snow && f < 0.4 && lit > 0.05 ? (lit > 0.5 ? d.snow : mix3(d.snow, pal[2], 0.3)) : tone(lit));
              }
            }
            // the tier's tips droop one pixel past its bottom edge
            const hwB = 0.6 + w1;
            P(8 - hwB, y1 + 1, pal[1]); P(8 + hwB - 1, y1 + 1, pal[0]);
          }
          break;
        }
        case 'palm': {                                 // a leaning, ringed trunk under a crown of drooping fronds
          const lean = (v & 1 ? 1 : -1) * (1.2 + r() * 1.6), topY = 6 + (v >> 1);
          for (let y = 22; y >= topY; y--) {
            const f = (22 - y) / (22 - topY), x = 7.5 + lean * f * f;
            P(x, y, (y & 1) ? bark : barkL); P(x + 1, y, barkD);
          }
          const cx = 8.5 + lean, cy = topY;
          for (let i = 0; i < 8; i++) {
            const a = -Math.PI / 2 + (i - 3.5) * 0.5 + (r() - 0.5) * 0.25, L = (6.4 + r() * 1.8) * s;
            for (let t = 0; t <= L; t += 0.35) {
              const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t * 0.55 + t * t * 0.085;
              if (t > 0.8 && t < L - 1) { P(x, y + 1, tone(-0.3 - t / L * 0.4)); P(x, y - 1, tone(0.75 - t / L * 0.6)); }
              P(x, y, tone(0.5 - t / L * 0.9 - Math.cos(a) * 0.25));
            }
          }
          P(cx - 1, cy, [120, 84, 46]); P(cx, cy + 1, [100, 70, 40]);                    // coconuts
          shadow = [3, 2];
          break;
        }
        case 'jungle': {                               // a huge dark crown with hanging vines, on buttress roots
          trunk(6, 13, 22, 3);
          P(4, 22, barkD); P(5, 21, bark); P(10, 22, barkD); P(9, 21, barkD);
          const R = 6.8 * s, cy = 17.4 - R * 0.95;
          canopy(ring(8, cy, R, 7), cy - R, cy + R, 0.45);
          for (let i = 0; i < 4; i++) {
            const x = 2 + ((r() * 12) | 0), y0 = lowest(x), L = 2 + ((r() * 4) | 0);
            if (y0 < 0 || y0 > 17) continue;
            for (let y = y0 + 1; y <= y0 + L; y++) P(x, y, (y & 1) ? pal[1] : pal[2]);
          }
          break;
        }
        case 'willow': {                               // a dome with long strands hanging almost to the ground
          trunk(7, 12, 22);
          const R = 5.6 * s;
          canopy(ring(8, 8, R, 6), 8 - R, 8 + R);
          for (let x = 1; x < 15; x++) {
            if (r() < 0.3 || x === 7 || x === 8) continue;
            const y0 = lowest(x);
            if (y0 < 0) continue;
            const L = 3 + r() * 5;
            for (let y = y0 + 1; y < y0 + L; y++) P(x, y, tone((x < 8 ? 0.25 : -0.15) - (y - y0) / L * 0.6));
          }
          break;
        }
        case 'acacia': {                               // forked trunk under a flat, wide umbrella crown
          line(8, 22, 8, 15, bark); line(9, 22, 9, 16, barkD);
          line(8, 15, 4, 9, bark); line(9, 16, 12, 9, barkD); line(8, 13, 8, 9, barkL);
          canopy(ring(8, 7, 7.2 * s, 7, 0.42), 4, 10, 0.4);
          shadow = [3, 2];
          break;
        }
        case 'dead': {                                 // bare, forking branches
          trunk(7, 12, 22);
          const branch = (x, y, a, L, depth) => {
            const x1 = x + Math.cos(a) * L, y1 = y + Math.sin(a) * L;
            line(x, y, x1, y1, depth === 1 ? bark : depth === 2 ? barkL : barkD);
            if (depth < 3) { branch(x1, y1, a - 0.45 - r() * 0.35, L * 0.62, depth + 1); branch(x1, y1, a + 0.45 + r() * 0.35, L * 0.62, depth + 1); }
          };
          branch(8, 12, -Math.PI / 2 + (r() - 0.5) * 0.5, 4.5 * s, 1);
          branch(8, 15, -Math.PI / 2 - 0.9 - r() * 0.3, 4 * s, 2);
          shadow = [3, 1];
          break;
        }
        case 'saguaro': {                              // a tall ribbed cactus with arms
          const top = 5 + ((r() * 4) | 0);
          const col = (x0, y0, y1) => {
            for (let y = y0; y <= y1; y++) { P(x0, y, pal[3]); P(x0 + 1, y, (y & 1) ? pal[2] : pal[3]); P(x0 + 2, y, pal[1]); }
            P(x0 + 1, y0 - 1, pal[3]);
          };
          col(7, top, 22);
          const ay = 12 + ((r() * 4) | 0), ah = 3 + ((r() * 3) | 0);
          for (let x = 5; x < 7; x++) { P(x, ay, pal[2]); P(x, ay + 1, pal[1]); }
          col(3, ay - ah, ay + 1);
          if (v & 1) {
            const by = 14 + ((r() * 3) | 0), bh = 2 + ((r() * 3) | 0);
            for (let x = 10; x < 12; x++) { P(x, by, pal[2]); P(x, by + 1, pal[1]); }
            col(11, by - bh, by + 1);
          }
          shadow = [3, 1];
          break;
        }
        case 'boulder': {                              // a chiselled rock: a flat top and a ring of facets around it
          const cx = 8 + (r() - 0.5), rx = (5 + r() * 1.8) * s * (d.size || 1), ry = rx * (d.tall ? 1.2 : 0.84);
          const moss = Array.from({ length: 96 }, () => r());                        // moss grows in 2 x 2 clumps
          const cy = 22.5 - ry;
          const lump = [0, 1, 2, 3, 4, 5, 6, 7].map(() => 0.84 + r() * 0.28);       // radius per 45 degrees
          const sect = 5 + ((r() * 3) | 0), rot = r() * 6.283;
          const L = [-0.485, -0.573, 0.661];
          const crack = r() < 0.6 ? cx - rx * 0.3 + r() * rx * 0.6 : -99;
          for (let y = 0; y < PROP_H; y++) for (let x = 0; x < PROP_W; x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            const a = Math.atan2(dy, dx), fa = ((a / 6.283) + 1) % 1 * 8, i0 = Math.floor(fa) % 8;
            const R = lump[i0] + (lump[(i0 + 1) % 8] - lump[i0]) * (fa - Math.floor(fa)), dd = Math.hypot(dx, dy) / R;
            if (dd > 1) continue;
            let lit, top = dd < 0.45 && dy < 0.25;
            if (top) lit = 0.45;
            else {
              const fr = ((a - rot) / 6.283 + 2) % 1 * sect, fi = Math.floor(fr), fc = rot + (fi + 0.5) / sect * 6.283;
              const n = [Math.cos(fc) * 0.8, Math.sin(fc) * 0.8, 0.6];
              lit = ((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) - 0.38) * 2.1;
              const px = Math.hypot(dx * rx, dy * ry);                                 // a dark crease where facets meet
              if ((fr - fi) * 6.283 / sect * px < 0.75 && px > 1.5) lit -= 0.55;
              if (dd < 0.55) lit += 0.25;                                               // the rim of the top face
            }
            if (dd > 0.86 && dy > 0.2) lit -= 0.5;                                      // contact with the ground
            if (dd > 0.84 && dx + dy > 0) lit -= 0.4;                                    // a dark outline on the shadow side
            if (Math.abs(x + 0.5 - crack - (y - cy) * 0.4) < 0.5 && dy > -0.5 && dy < 0.7) lit -= 0.8;
            lit += (r() - 0.5) * 0.3;
            let col = tone(lit);
            if (d.snow && (top || (lit > 0.1 && dy < 0))) col = lit > 0.5 ? d.snow : mix3(d.snow, [170, 190, 214], 0.45);
            else if (d.moss && (top || dy < -0.1) && moss[(y >> 1) * 8 + (x >> 1)] < 0.55) col = lit > 0.2 ? d.moss : shade(d.moss, 0.75);
            P(x, y, col);
          }
          shadow = [2, 1];
          break;
        }
        case 'columns': {                              // a cluster of basalt columns, each with a lit top
          const n = 3 + (v & 1), cols = [];
          for (let i = 0; i < n; i++) cols.push({ x: 2 + i * 3 + ((r() * 2) | 0) - (n > 3 ? 1 : 0), h: 5 + ((r() * 10) | 0), y: 21 + ((r() * 2) | 0) });
          cols.sort((p, q) => p.y - q.y);
          for (const cl of cols) {
            const top = cl.y - cl.h;
            for (let y = top; y <= cl.y; y++) {
              const t = y < top + 2;
              P(cl.x, y, t ? pal[4] : pal[3]); P(cl.x + 1, y, t ? pal[3] : pal[2]); P(cl.x + 2, y, t ? pal[2] : pal[1]);
            }
          }
          shadow = [2, 1];
          break;
        }
      }
      // write it out, with the shadow wherever the prop's outline shifted down and right falls on bare ground
      for (let y = 0; y < PROP_H; y++) for (let x = 0; x < PROP_W; x++) {
        const px = (idx % PROP_COLS) * PROP_W + x, py = PROP_Y0 + Math.floor(idx / PROP_COLS) * PROP_H + y;
        const i = (py * ATLAS_W + px) * 4, col = buf[y * PROP_W + x];
        if (col) { data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; data[i + 3] = 255; }
        else if (has(x - shadow[0], y - shadow[1])) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 96; }
      }
    }
  });

  // ---------- sprites: a little walking person (2 frames) and settlement pins ----------
  const skinTone = [236, 196, 160], shirt = [70, 150, 230], legs = [50, 50, 70];
  for (let f = 0; f < 2; f++) {
    const slot = SLOT_WALKER + f;
    put(slot, 3, 1, skinTone); put(slot, 4, 1, skinTone);
    for (let y = 2; y < 5; y++) { put(slot, 3, y, shirt); put(slot, 4, y, shirt); }
    put(slot, f ? 2 : 5, 3, skinTone);
    put(slot, f ? 3 : 2, 5, legs); put(slot, f ? 3 : 2, 6, legs);
    put(slot, f ? 5 : 4, 5, legs); put(slot, f ? 5 : 4, 6, legs);
  }
  skin.pins.forEach((c, lvl) => {
    const slot = SLOT_PIN + lvl, edge = [20, 20, 28];
    const roof = [[3, 0], [4, 0], [2, 1], [3, 1], [4, 1], [5, 1], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2]];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const inRoof = roof.some(p => p[0] === x && p[1] === y), inBody = x >= 1 && x <= 6 && y >= 3 && y <= 7;
      const near = (dx, dy) => roof.some(p => p[0] === x + dx && p[1] === y + dy) || (x + dx >= 1 && x + dx <= 6 && y + dy >= 3 && y + dy <= 7);
      if (inRoof) put(slot, x, y, shade(c, 0.75));
      else if (inBody) put(slot, x, y, (x === 3 || x === 4) && y >= 5 ? edge : c);
      else if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) put(slot, x, y, edge, 200);
    }
  });

  // ---------- average colour of every tile, for the far-away colour map ----------
  const avg = slot => {
    const px = (slot % ATLAS_COLS) * 8, py = Math.floor(slot / ATLAS_COLS) * 8;
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const i = ((py + y) * ATLAS_W + px + x) * 4, al = data[i + 3] / 255;
      r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al;
    }
    return a > 0 ? [r / a, g / a, b / a, a / 64] : [0, 0, 0, 0];
  };
  const baseAvg = new Float32Array(BASE.length * 4 * 3), baseEmis = new Float32Array(BASE.length);
  BASE.forEach((n, id) => {
    baseEmis[id] = skin.base[n].emis || 0;
    for (let v = 0; v < 4; v++) baseAvg.set(avg(id * 4 + v).slice(0, 3), (id * 4 + v) * 3);
  });
  const overAvg = new Float32Array(OVER.length * 4), overEmis = new Float32Array(OVER.length);
  OVER.forEach((n, id) => {
    if (!id) return;
    overEmis[id] = skin.over[n].emis || 0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let v = 0; v < 4; v++) { const q = avg(SLOT_OVER + id * 4 + v); r += q[0]; g += q[1]; b += q[2]; a += q[3]; }
    overAvg.set([r / 4, g / 4, b / 4, Math.min(1, a / 4 * 1.6)], id * 4);
  });
  // soil stain under each deposit type [r, g, b, strength], for the colour map (and the shader)
  const overStain = new Float32Array(OVER.length * 4);
  OVER.forEach((n, id) => { const st = id && skin.over[n].stain; if (st) overStain.set(st, id * 4); });
  return { data, baseAvg, baseEmis, overAvg, overEmis, overStain };
}

// what the shader needs for the new terrain look. Per ground type: B = (share of spots with a small decoration,
// 1 where trees stand on plain forest floor, share of spots with a big prop, unused), K = 4 small-decoration atlas
// slots to pick from (-1 = none), PK = 4 big props to pick from (prop index of variant 0, -1 = none).
// Per overlay: S = soil stain (r, g, b 0..1, strength), X = (glint, pulse)
export function decorTables(skin) {
  const kinds = Object.keys(skin.decor || {}), props = Object.keys(skin.props || {});
  const B = new Float32Array(128), K = new Int32Array(128).fill(-1), PK = new Int32Array(128).fill(-1);
  const S = new Float32Array(64), X = new Float32Array(32);
  OVER.forEach((n, id) => {
    const o = id && skin.over[n];
    if (!o) return;
    if (o.stain) S.set([o.stain[0] / 255, o.stain[1] / 255, o.stain[2] / 255, o.stain[3]], id * 4);
    X[id * 2] = o.glint || 0; X[id * 2 + 1] = o.pulse || 0;
  });
  BASE.forEach((name, id) => {
    const t = (skin.decorFor || {})[name];
    if (t) {
      B[id * 4] = t[0];
      t[1].forEach((k, i) => { const ki = kinds.indexOf(k); if (ki >= 0) K[id * 4 + i] = SLOT_DECO + ki * 4; });
    }
    const pt = (skin.propsFor || {})[name];
    if (pt) {
      B[id * 4 + 2] = pt[0];
      pt[1].forEach((k, i) => { const ki = props.indexOf(k); if (ki >= 0) PK[id * 4 + i] = ki * 4; });
    }
    if ((skin.floor || []).includes(name)) B[id * 4 + 1] = 1;
  });
  return { B, K, PK, S, X };
}
