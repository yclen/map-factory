// Biome templates: how each ground type looks and what grows on it. Designed in the Biome Builder (biome-builder/), saved
// as art/biomes/<GROUND>.json, and baked for the game into galaxy-demo/biomes/ (biomes.json, items.webp, ground
// textures). A template:
//   { biome: 'FOREST',
//     ground: { texture: 'grass_v1.png' or null (tile art), scale (tiles per copy), bright, sat, hue,
//               relief (0 = flat .. 2; missing = RELIEF) },
//     items: [ { kind: 'oak', layer: 'big' | 'small', density (share of spots), size (1 = a 2 x 3 tile box),
//                sizeVar (0..1 random size spread), clump (0..1), clumpSize (tiles), skin: { sheet, pick } } ] }
// Big items stand on one spot per 1.5 x 1.5 tiles, small items on one spot per tile; up to ITEM_SLOTS per layer.
import { BASE } from './ids.js?v=20261125163154';

export const ITEM_SLOTS = 8;
// the look shared by every biome: item shadows (renderer.js this.shadow) and the ground relief a template without one gets
export const SHADOW = { len: 1.1, angle: 12, dark: 0.45, contact: 0.55 };
export const RELIEF = 0.8;
export const LAYERS = ['big', 'small'];
const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));

// How a ground meets its neighbours (template ground.blend; anything missing takes these). Only grounds drawn with a
// texture blend; water and tile-art grounds keep their edges. The shader (BODY_FS groundBlend) reads them per ground id:
//   width    how wide the band where two grounds mix is, in tiles (0 = a hard edge .. 1)
//   creep    how far this ground pushes into its neighbours (-1 .. 1; the higher one wins the border)
//   soft     how soft the mixing is (0.02 = crisp, its bumps poking through .. 0.5 = a smooth fade)
//   style    'soft' (mixed by the textures' bumps), 'pixel' (whole art pixels, a ragged pixel-art edge), 'dither' (stippled)
//   ragged   how much noise breaks up the border line (0 .. 1)
//   rim      the border band darkened (< 0) or lightened (> 0) on this ground's side (-1 .. 1)
//   height   how much the texture's light parts stand up over the neighbour (0 = flat; < 0: its dark parts do)
//   straggle how far this ground's items (trees, rocks, grass) wander into its neighbours, in tiles (0 .. 12)
export const BLEND = { width: 0.7, creep: 0, soft: 0.12, style: 'soft', ragged: 0.5, rim: 0, height: 1, straggle: 0 };
export const STYLES = ['soft', 'pixel', 'dither'];
// the border look shared by every planet, saved with the shadows: fuzz = how ragged biome borders are where the map is
// made (0 = smooth contour lines .. 2; terrain.js makeSampler); wet = how dark and glossy the ground is at the
// waterline (0 = dry .. 1), wetW = how far inland the wet ground reaches (tiles)
export const BORDER = { fuzz: 1, wet: 0.6, wetW: 2.5 };
// a ground texture's variety (template ground.variety): 0 = it simply repeats .. 1 = shifted copies mixed so the
// repeat doesn't show (BODY_FS groundTex)
export const VARIETY = 1;
export const blendOf = ground => ({ ...BLEND, ...((ground && ground.blend) || {}) });

// The blend table the terrain shader reads (RGBA float, 32 x 2, one column per ground id): texel (id, 0) = (width,
// creep, soft, style), texel (id, 1) = (ragged, rim, height, variety). Ground ids without a template get the defaults
export function blendTable(templates) {
  const t = new Float32Array(32 * 2 * 4), byId = {};
  for (const tpl of Object.values(templates || {})) if (ID[tpl.biome] !== undefined) byId[ID[tpl.biome]] = tpl;
  for (let id = 0; id < 32; id++) {
    const g = byId[id] && byId[id].ground, b = blendOf(g);
    t.set([b.width, b.creep, b.soft, Math.max(0, STYLES.indexOf(b.style))], id * 4);
    t.set([b.ragged, b.rim, b.height, (g && g.variety) ?? VARIETY], (32 + id) * 4);
  }
  return t;
}
// per ground id, how far its items straggle into neighbours (tiles), or null when none do (terrain.js propSpots)
export function straggleTable(templates) {
  const s = new Array(32).fill(0);
  for (const tpl of Object.values(templates || {})) if (ID[tpl.biome] !== undefined) s[ID[tpl.biome]] = +blendOf(tpl.ground).straggle || 0;
  return s.some(x => x > 0) ? s : null;
}

// which atlas picture an item uses: its AI sheet and picked cells, or the game's pixel art for its kind and layer
export function skinKey(item) {
  const s = item.skin || {};
  return s.sheet ? `${s.sheet}#${(s.pick || [0, 1, 2, 3]).join(',')}` : `pixel:${item.layer}:${item.kind}`;
}

// The table the prop shader reads (RGBA float, ITEM_SLOTS * 2 wide, one row per ground type and layer):
// texel (slot, row) = (density, first atlas cell, size, sizeVar); texel (ITEM_SLOTS + slot, row) = (clump, clumpSize, 0, 0).
// row = ground id * 2 + layer (0 big, 1 small). cellOf = { skin key: atlas cell of its first variant }; bigCellOf, if
// given, the same for the big items' own atlas (renderer.js setBigItems), which the big rows then point into
export function itemTable(templates, cellOf, bigCellOf) {
  const W = ITEM_SLOTS * 2, H = 64, t = new Float32Array(W * H * 4);
  for (const tpl of Object.values(templates)) {
    const id = ID[tpl.biome];
    if (id === undefined) continue;
    LAYERS.forEach((layer, L) => {
      const row = id * 2 + L;
      tpl.items.filter(it => it.layer === layer).slice(0, ITEM_SLOTS).forEach((it, j) => {
        const cell = (layer === 'big' && bigCellOf ? bigCellOf : cellOf)[skinKey(it)];
        if (cell === undefined || !(it.density > 0)) return;
        t.set([it.density, cell, it.size || 1, it.sizeVar || 0], (row * W + j) * 4);
        t.set([it.clump || 0, Math.max(1, it.clumpSize || 10), 0, 0], (row * W + ITEM_SLOTS + j) * 4);
      });
    });
  }
  return { data: t, width: W, height: H };
}
