// Biome templates: how each ground type looks and what grows on it. Designed in the Biome Lab (biome-lab/), saved
// as art/biomes/<GROUND>.json, and baked for the game into galaxy-demo/biomes/ (biomes.json, items.webp, ground
// textures). A template:
//   { biome: 'FOREST',
//     ground: { texture: 'grass_v1.png' or null (tile art), scale (tiles per copy), bright, sat, hue },
//     items: [ { kind: 'oak', layer: 'big' | 'small', density (share of spots), size (1 = a 2 x 3 tile box),
//                sizeVar (0..1 random size spread), clump (0..1), clumpSize (tiles), skin: { sheet, pick } } ] }
// Big items stand on one spot per 1.5 x 1.5 tiles, small items on one spot per tile; up to ITEM_SLOTS per layer.
import { BASE } from './ids.js?v=20261125004141';

export const ITEM_SLOTS = 8;
export const LAYERS = ['big', 'small'];
const ID = Object.fromEntries(BASE.map((n, i) => [n, i]));

// which atlas picture an item uses: its AI sheet and picked cells, or the game's pixel art for its kind and layer
export function skinKey(item) {
  const s = item.skin || {};
  return s.sheet ? `${s.sheet}#${(s.pick || [0, 1, 2, 3]).join(',')}` : `pixel:${item.layer}:${item.kind}`;
}

// The table the prop shader reads (RGBA float, ITEM_SLOTS * 2 wide, one row per ground type and layer):
// texel (slot, row) = (density, first atlas cell, size, sizeVar); texel (ITEM_SLOTS + slot, row) = (clump, clumpSize, 0, 0).
// row = ground id * 2 + layer (0 big, 1 small). cellOf = { skin key: atlas cell of its first variant }
export function itemTable(templates, cellOf) {
  const W = ITEM_SLOTS * 2, H = 64, t = new Float32Array(W * H * 4);
  for (const tpl of Object.values(templates)) {
    const id = ID[tpl.biome];
    if (id === undefined) continue;
    LAYERS.forEach((layer, L) => {
      const row = id * 2 + L;
      tpl.items.filter(it => it.layer === layer).slice(0, ITEM_SLOTS).forEach((it, j) => {
        const cell = cellOf[skinKey(it)];
        if (cell === undefined || !(it.density > 0)) return;
        t.set([it.density, cell, it.size || 1, it.sizeVar || 0], (row * W + j) * 4);
        t.set([it.clump || 0, Math.max(1, it.clumpSize || 10), 0, 0], (row * W + ITEM_SLOTS + j) * 4);
      });
    });
  }
  return { data: t, width: W, height: H };
}
