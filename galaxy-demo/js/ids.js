// Semantic IDs shared by the generator (worker) and the renderer (main thread).
// The generator only ever outputs these meanings, never colours: a skin (skin.js) decides how each one looks.

// ground types (one per tile)
export const BASE = [
  'DEEP', 'SHALLOW', 'BEACH', 'GRASS', 'FOREST', 'JUNGLE', 'SWAMP', 'SAVANNA', 'DESERT', 'DUNES',
  'MESA', 'SALT', 'TUNDRA', 'TAIGA', 'SNOW', 'ICE', 'SEA_ICE', 'ICE_CRACK', 'MOUNTAIN', 'PEAK',
  'LAVA', 'OBSIDIAN', 'ASH', 'SULFUR', 'BASALT', 'REGOLITH', 'HIGHLAND', 'CRATER', 'RUST', 'CANYON',
];
export const T = Object.fromEntries(BASE.map((n, i) => [n, i]));

export const BASE_NAME = {
  DEEP: 'Deep ocean', SHALLOW: 'Shallows', BEACH: 'Beach', GRASS: 'Grassland', FOREST: 'Forest', JUNGLE: 'Jungle',
  SWAMP: 'Swamp', SAVANNA: 'Savanna', DESERT: 'Desert', DUNES: 'Dunes', MESA: 'Mesa', SALT: 'Salt flats',
  TUNDRA: 'Tundra', TAIGA: 'Pine forest', SNOW: 'Snowfield', ICE: 'Ice sheet', SEA_ICE: 'Frozen sea',
  ICE_CRACK: 'Ice ridges', MOUNTAIN: 'Mountains', PEAK: 'Snowy peaks', LAVA: 'Lava sea', OBSIDIAN: 'Obsidian plains',
  ASH: 'Ash wastes', SULFUR: 'Sulfur flats', BASALT: 'Basalt plains', REGOLITH: 'Regolith', HIGHLAND: 'Highlands',
  CRATER: 'Crater rim', RUST: 'Rust plains', CANYON: 'Canyon',
};

// things sitting on a tile: resource deposits and settlement buildings (0 = nothing)
export const OVER = ['NONE', 'STONE', 'IRON', 'COPPER', 'COAL', 'OIL', 'URANIUM', 'SULFUR', 'CRYSTAL', 'ICE',
  'HUT', 'HOUSE', 'BLOCK', 'TOWER'];
export const O = Object.fromEntries(OVER.map((n, i) => [n, i]));
export const RESOURCES = ['STONE', 'IRON', 'COPPER', 'COAL', 'OIL', 'URANIUM', 'SULFUR', 'CRYSTAL', 'ICE'];
export const RESOURCE_NAME = { STONE: 'Stone', IRON: 'Iron', COPPER: 'Copper', COAL: 'Coal', OIL: 'Oil',
  URANIUM: 'Uranium', SULFUR: 'Sulfur', CRYSTAL: 'Crystal', ICE: 'Water ice' };

export const WATER = new Set([T.DEEP, T.SHALLOW, T.LAVA]);

// atlas layout: 8x8 art tiles in a 32-column grid
export const ATLAS_COLS = 32;
export const SLOT_BASE = 0;        // base tile i, variant v  -> slot i*4+v
export const SLOT_OVER = 256;      // overlay o, variant v    -> slot 256+o*4+v
export const SLOT_WALKER = 448;    // two walking frames
export const SLOT_PIN = 456;       // settlement pins, one per level
