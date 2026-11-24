// Placeholder pixel art, drawn from the skin's colours and patterns into one 256x128 atlas of 8x8 tiles.
// Runs on the main thread (for the GPU) and in the map worker (for each tile's average colour).
// Hand-drawn art can replace any slot later without touching the generator.
import { BASE, OVER, ATLAS_COLS, SLOT_OVER, SLOT_WALKER, SLOT_PIN, SLOT_FLOOR, SLOT_DECO } from './ids.js?v=20261124123321';
import { mulberry32, hash32 } from './rng.js?v=20261124123321';

export const ATLAS_W = 256, ATLAS_H = 128;

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
  return { data, baseAvg, baseEmis, overAvg, overEmis };
}

// what the shader needs to scatter decorations, per ground type: D = share of spots with something, K = 4 atlas
// slots to pick from (-1 = none; +4096 = sways in the wind), F = 1 where trees stand on plain forest floor
export function decorTables(skin) {
  const kinds = Object.keys(skin.decor || {});
  const D = new Float32Array(32), K = new Int32Array(128).fill(-1), F = new Int32Array(32);
  BASE.forEach((name, id) => {
    const t = (skin.decorFor || {})[name];
    if (t) {
      D[id] = t[0];
      t[1].forEach((k, i) => { const ki = kinds.indexOf(k); if (ki >= 0) K[id * 4 + i] = SLOT_DECO + ki * 4 + (skin.decor[k].sway ? 4096 : 0); });
    }
    if ((skin.floor || []).includes(name)) F[id] = 1;
  });
  return { D, K, F };
}
