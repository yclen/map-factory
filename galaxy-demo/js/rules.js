// ======================================================================
// GENERATION RULES
// Every star, planet, moon, tile, deposit and settlement in the demo comes from these numbers
// plus one seed. Change a number, reload, and the galaxy follows the new rules.
// Same seed + same rules = the same galaxy, every time.
// Distances: gu = galaxy units, su = system units (roughly one Earth-sized planet radius).
// ======================================================================

export const RULES = {
  version: 1,              // bump when rules change in a way that should reshuffle worlds

  galaxy: {
    seed: 20261123,        // default seed (override with ?seed=123 in the URL)
    stars: 1000,
    radius: 1000,          // gu
    arms: 4,               // spiral arms
    armTurns: 0.8,         // how far each arm winds around the centre, in full turns
    armSpread: 0.1,        // arm thickness, as a share of the distance from the centre
    bulgeRadius: 150,      // gu, the dense old core
    minSpacing: 14,        // gu, no two stars closer than this
    share: { bulge: 0.15, arms: 0.65, disk: 0.20 },   // where stars are born
    sunRadius: 0.58,       // the Sun sits in an arm, this share of the way out
  },

  // THE DISTANCE LADDER: each rung is measured in the rung below it, so changing one rung stretches
  // everything above it. Real-world values in [brackets]. The demo's Scale panel changes these live.
  scale: {
    homeTiles: 4096,       // Home is this many tiles across; every planet's map is sized relative to Home
    moonDistance: 17,      // Home to the Moon, in Home radii; every moon orbit scales with it          [~60]
    sunDistance: 28,       // Home to the Sun, in Home-Moon distances; every planet orbit scales with it [~390]
    starDistance: 1000,    // the Sun to its nearest star, in Home-Sun distances; spreads the stars out  [~270,000]
    // generation's own yardsticks (climate and orbit periods are worked out at these; change the ladder instead)
    homeOrbit: 60,         // su (Home radii): a planet this far from a yellow star is "temperate" (heat 1.0)
    yearAtHome: 480,       // seconds for one orbit at homeOrbit around a yellow star
  },

  // three kinds of star. chance = how likely a star born in that part of the galaxy is this type
  // (blue stars are young, so they cluster in the arms; red dwarfs are everywhere, especially the old core)
  stars: {
    red: {
      name: 'Red dwarf', color: [255, 112, 82], radius: 3.2, mass: 0.4, luminosity: 0.08,
      chance: { bulge: 0.66, arms: 0.42, disk: 0.60 },
      planets: [1, 3],             // a couple of small rocky worlds
      firstOrbit: 9, spacing: [1.45, 1.85],
      giants: 0,                   // never gas giants
    },
    yellow: {
      name: 'Yellow star', color: [255, 222, 140], radius: 6, mass: 1, luminosity: 1,
      chance: { bulge: 0.32, arms: 0.40, disk: 0.34 },
      planets: [5, 10],            // about 8 on average
      firstOrbit: 24, spacing: [1.35, 1.7],
      giants: 0.55,                // chance that a planet past the frost line is a giant
    },
    blue: {
      name: 'Blue giant', color: [150, 186, 255], radius: 13, mass: 8, luminosity: 30,
      chance: { bulge: 0.02, arms: 0.18, disk: 0.06 },
      planets: [16, 24],           // huge systems, about 20 planets
      firstOrbit: 70, spacing: [1.13, 1.22],
      giants: 0.6,
    },
  },

  // heat = how much starlight a planet gets, 1.0 = like Home. heat = luminosity^0.25 * sqrt(homeOrbit / orbit)
  zones: [
    { name: 'scorched', above: 1.75, types: { lava: 6, barren: 3 } },
    { name: 'hot', above: 1.25, types: { desert: 4, rust: 3, barren: 3, lava: 1 } },
    { name: 'temperate', above: 0.8, types: { terran: 5, ocean: 2, desert: 2, rust: 1, tundra: 1, barren: 1 } },
    { name: 'cold', above: 0.55, types: { tundra: 4, barren: 3, rust: 2, ice: 2 } },
    { name: 'frozen', above: -1, types: { ice: 5, barren: 3, tundra: 1 } },
  ],
  giantHeat: 0.78,         // giants only form where heat is below this (past the frost line)
  iceGiantHeat: 0.42,      // ...and are ice giants (not gas giants) 60% of the time below this

  moons: {
    gas: [1, 5], icegiant: [1, 3],           // moons per giant (blue-star giants get one more)
    rocky: { one: 0.3, two: 0.06 },          // chance a rocky planet has 1 or 2 moons
    size: [0.2, 0.45],                       // su
    hot: { barren: 3, lava: 1, volcanic: 1 },
    cold: { barren: 3, ice: 4, volcanic: 0.6 },
  },

  // planet types. size in su; tiles = surface map width per su of radius; resources = abundance 0..1
  planetTypes: {
    terran: { name: 'Terran world', size: [0.8, 1.4], atmo: [120, 170, 255, 0.55], dot: [70, 130, 190],
      terrain: { sea: 0.52 },
      resources: { STONE: 0.5, IRON: 0.45, COPPER: 0.35, COAL: 0.4, OIL: 0.25, URANIUM: 0.08 } },
    ocean: { name: 'Ocean world', size: [0.8, 1.5], atmo: [110, 160, 255, 0.6], dot: [50, 100, 190],
      terrain: { sea: 0.66 },
      resources: { STONE: 0.35, IRON: 0.3, COPPER: 0.3, OIL: 0.45, COAL: 0.2, URANIUM: 0.06 } },
    desert: { name: 'Desert world', size: [0.6, 1.3], atmo: [240, 200, 150, 0.3], dot: [214, 178, 112],
      terrain: { sea: 0.14 },
      resources: { STONE: 0.5, IRON: 0.4, COPPER: 0.5, OIL: 0.45, URANIUM: 0.12 } },
    rust: { name: 'Rust world', size: [0.45, 1.0], atmo: [240, 160, 120, 0.2], dot: [190, 96, 64],
      terrain: {},
      resources: { IRON: 0.6, STONE: 0.35, COPPER: 0.2, URANIUM: 0.08, ICE: 0.3 } },
    lava: { name: 'Lava world', size: [0.5, 1.2], atmo: [255, 130, 60, 0.25], dot: [200, 70, 30],
      terrain: { lava: 0.3 },
      resources: { IRON: 0.45, SULFUR: 0.55, URANIUM: 0.15, COPPER: 0.25 } },
    volcanic: { name: 'Sulfur moon', size: [0.25, 0.45], dot: [222, 196, 80],
      terrain: { lava: 0.08 },
      resources: { SULFUR: 0.7, IRON: 0.25 } },
    tundra: { name: 'Tundra world', size: [0.6, 1.3], atmo: [190, 210, 255, 0.35], dot: [150, 170, 160],
      terrain: { sea: 0.35 },
      resources: { COAL: 0.4, IRON: 0.35, OIL: 0.3, STONE: 0.35, COPPER: 0.2 } },
    ice: { name: 'Ice world', size: [0.3, 1.1], atmo: [200, 225, 255, 0.15], dot: [200, 222, 240],
      terrain: {},
      resources: { CRYSTAL: 0.35, ICE: 0.4, URANIUM: 0.06, IRON: 0.15 } },
    barren: { name: 'Barren world', size: [0.25, 0.9], dot: [140, 132, 124],
      terrain: {},
      resources: { IRON: 0.35, STONE: 0.45, COPPER: 0.2, URANIUM: 0.08, ICE: 0.15 } },
    gas: { name: 'Gas giant', giant: true, size: [3.4, 5.8], rings: 0.35 },
    icegiant: { name: 'Ice giant', giant: true, size: [2.4, 3.4], rings: 0.25 },
  },
  // polar ice: cold comes only from latitude (how far north or south, i.e. towards the top or bottom of the disk),
  // so worlds get ice caps at the poles and ordinary terrain at the east and west edges. cap = roughly how deep
  // each cap reaches in from its pole, as a share of the radius (noise and mountains make the edges ragged)
  ice: { cap: 0.16 },
  resourceBlob: 22,        // typical deposit size, in tiles

  // which ground a resource can sit on ('land' = anything that isn't water or lava)
  resourceGround: {
    STONE: 'land', IRON: 'land', COPPER: 'land', URANIUM: 'land',
    COAL: ['GRASS', 'FOREST', 'TAIGA', 'TUNDRA', 'SAVANNA', 'SWAMP', 'JUNGLE', 'HIGHLAND'],
    OIL: ['DESERT', 'DUNES', 'SWAMP', 'SHALLOW', 'TUNDRA', 'SALT', 'SEA_ICE', 'SAVANNA'],
    SULFUR: ['ASH', 'OBSIDIAN', 'SULFUR', 'BASALT'],
    CRYSTAL: ['ICE', 'ICE_CRACK', 'SNOW', 'REGOLITH'],
    ICE: ['ICE', 'SNOW', 'REGOLITH', 'HIGHLAND', 'CRATER', 'RUST', 'SEA_ICE'],
  },

  gasPalettes: {
    tan: [[222, 190, 142], [176, 126, 84], [244, 226, 196]],
    blue: [[92, 140, 222], [50, 88, 168], [176, 206, 244]],
    rust: [[206, 120, 80], [140, 70, 50], [236, 190, 150]],
    teal: [[96, 180, 170], [50, 120, 120], [190, 230, 220]],
    violet: [[150, 120, 200], [90, 70, 140], [210, 196, 236]],
    cream: [[236, 222, 190], [196, 176, 140], [252, 244, 226]],
    cyan: [[140, 214, 230], [80, 160, 200], [210, 240, 248]],
    sea: [[70, 120, 200], [40, 80, 160], [150, 190, 240]],
  },
  gasPaletteFor: { gas: ['tan', 'tan', 'rust', 'teal', 'violet', 'cream'], icegiant: ['cyan', 'sea', 'teal'] },

  settlements: {
    // chance that a world of this type hosts a civilisation, and how many settlements it builds
    civChance: { terran: 0.35, ocean: 0.25, desert: 0.15, tundra: 0.12 },
    count: [3, 14],
    homeCount: 28,
    levels: ['Village', 'Town', 'City', 'Metropolis', 'Megacity', 'Megalopolis'],
    levelWeights: [40, 28, 16, 9, 5, 2],
    radius: [1, 2, 3, 4, 6, 8],            // tiles
    ground: ['GRASS', 'SAVANNA', 'FOREST', 'BEACH', 'TAIGA', 'TUNDRA', 'DESERT', 'JUNGLE'],
  },

  // the Sun's system uses the names from Factory Conquest; the outermost planet comes from the seed
  sun: {
    name: 'Sun',
    planets: [
      { name: 'Vulcan', type: 'lava', orbit: 27, size: 0.7 },
      { name: 'Home', type: 'terran', orbit: 60, size: 1.0, home: true,
        moons: [{ name: 'the Moon', type: 'barren', size: 0.27, orbit: 6 }] },
      { name: 'Aries', type: 'rust', orbit: 90, size: 0.53 },
      { name: 'Zeus', type: 'gas', orbit: 192, size: 5.0, palette: 'tan',
        moons: [{ name: 'Hephaestus', type: 'volcanic', size: 0.3, orbit: 2.4 },
                { name: 'Athena', type: 'ice', size: 0.26, orbit: 3.4 },
                { name: 'Hermes', type: 'barren', size: 0.38, orbit: 5 }] },
      { name: 'Poseidon', type: 'gas', orbit: 300, size: 3.8, palette: 'blue', rings: true,
        moons: [{ name: 'Amphitrite', type: 'ice', size: 0.2, orbit: 2.6 },
                { name: 'Triton', type: 'ice', size: 0.26, orbit: 3.8, retro: true }] },
      { procedural: true, orbit: 450 },
    ],
    farPlanetTypes: { ice: 3, barren: 2, tundra: 2, icegiant: 2, ocean: 1 },
  },
};
