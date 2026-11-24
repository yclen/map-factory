'use strict';
/*
 * Factory Conquest — playable prototype of the core loop (design v3). (It was called Map Factory.)
 *
 *   land you own near a settlement -> people capacity -> people regrow -> spend people to claim land
 *   -> deposits inside your territory produce -> resources build settlements
 *
 * Every separate piece of your territory is a country with its own people,
 * stockpile and power. Expeditions found new countries; links move people and
 * cargo between them. Names grow with each country's size.
 *
 * Everything you might want to tune is in CFG below.
 * Add ?seed=123 to the URL to replay a specific map.
 */

// An error while the page loads or the world generates would otherwise leave "Generating world…" spinning
// forever with nothing said: put the error on the loading screen instead.
window.addEventListener('error', e => {
  const ld = document.getElementById('loading');
  if (ld) ld.innerHTML = `<div style="max-width:520px;text-align:center;line-height:1.5">The game couldn't start: ${String(e.message || e.error || 'unknown error').replace(/</g, '&lt;')}<br><span style="opacity:0.7;font-size:12px">Reload to try again. If it keeps happening, the details are in the browser console.</span></div>`;
});

// ======================================================================
// CONFIG — all tuning numbers live here
// ======================================================================
const CFG = {
  // The world is a disk floating in space, ringed by an ice wall.
  mapW: 1000, mapH: 1000,
  continentScale: 115,         // bigger = bigger continents (noise feature size, in tiles)
  climateScale: 150,           // bigger = larger desert regions
  iceWall: { min: 2.5, extra: 4 },  // wall thickness in tiles: min + up to extra (wobbles around the rim)
  // Polar ice: an ice continent at the north and south poles (the top and bottom of the disk). Land further than
  // `start` x the radius from the middle (north or south) is ice; its edge wanders by `wobble`, and a strait about
  // `strait` x the radius wide is sunk in front of each cap so the ice reads as its own continent.
  poles: { start: 0.83, wobble: 0.05, strait: 0.04 },
  waterFraction: 0.5,          // share of the disk (inside the wall) that is ocean
  mountainShare: 0.13,         // top X% of land by height becomes mountains
  desertShare: 0.24,           // driest X% of land becomes desert

  startPeople: 100, startRadius: 8,
  // Land still counts for each settlement's `reach` (how AI nations space out their settlements), but it houses nobody.
  landCap: { grass: 0.5, desert: 0.2, mountain: 0.1, ice: 0.05 },
  // Cities. Every person lives in a city: a country's people are the sum of its cities' people (each settlement
  // keeps its own count, b.pop). A city's level sets how many it houses. Villages and Towns need no power; from City
  // up, the housing past `unpowered` only fills with power: `perMW` people per MW, shared out evenly between the
  // country's cities. Losing power never downgrades a city: it just holds no more than a Town until power comes back.
  // Place a settlement on one of your cities (within `snap` tiles) or press Upgrade on its card to raise its level.
  // A new city must be at least `spacing` tiles from every other city. Each city protects the land in its `zone`:
  // while it has people, enemies can't claim that land, and pushing into it fights the city's people one for one
  // until none are left. Shelling alone never takes a city below `shellFloor` of its housing: only troops finish it.
  // Each city also stores goods: `store` x the per-city amounts in CFG.storage.
  // People above a country's housing die off slowly (`shrink` = share of the excess per second).
  settlement: { reach: 12, perMW: 12.5, shrink: 0.01, snap: 2, spacing: 10, unpowered: 300, shellFloor: 0.1,
                levels: [{ name: 'Village', housing: 120, zone: 5, store: 1 },
                         { name: 'Town', housing: 300, zone: 6, store: 2, cost: { wood: 100, stone: 100 } },
                         { name: 'City', housing: 700, zone: 8, store: 4, cost: { stone: 300, iron: 80 } },
                         { name: 'Metropolis', housing: 1600, zone: 10, store: 8, cost: { stone: 900, iron: 300 } },
                         { name: 'Megacity', housing: 4000, zone: 12, store: 16, cost: { stone: 2500, iron: 1000 } },
                         { name: 'Megalopolis', housing: 10000, zone: 14, store: 32, cost: { stone: 6000, iron: 2500 } }] },
  startResources: { wood: 50, stone: 50, iron: 0 },
  // An expedition takes the same share of its country's stockpile as of its people (the send %),
  // and at least this much if home has it: enough for a station with some track, or a cabin and a camp.
  expeditionKit: { wood: 40, stone: 40 },
  // what one train / ship carries per trip. Goods and people ride the vehicle, so long routes deliver slower and later.
  vehicles: { rail: { cargo: 30, people: 20 }, sea: { cargo: 40, people: 16 } },
  // Smart shipments: each country wants `base` of each resource in stock (or `keep` x its storage, if that's more);
  // an ice colony (polar ice, drills or a launch pad) wants `ice` on top. Trains and ships carry goods from countries
  // with more than they want to the ones down the line that are short (see loadAt).
  supply: { base: { wood: 100, stone: 100, iron: 30, uranium: 0 }, keep: 0.3, ice: { wood: 0, stone: 200, iron: 250, uranium: 0 },
           nuke: 40,   // uranium a country with a nuclear plant keeps in stock (on top of the rest), so ships bring it in
  // People too: every country wants a crew of `crew` free people (on top of its workers) to claim land and build
  // with, an ice colony `iceCrew` (ice is costly to claim and holds almost nobody). Trains and ships bring people
  // from countries with more than their crew to the ones short of theirs, hop by hop like goods. A crew never
  // dies off for lack of housing: only people above both housing and crew do.
             crew: 40, iceCrew: 100,
  // Demand. A build that fails for lack of goods asks the empire for them (`ask` = one build's worth per try, fading
  // with time constant `askTau` s); what a country spends on building it wants back (`used`, fading over `usedTau` s),
  // so a colony that is building a lot keeps getting stocked. For goods someone asks for (or is busy spending),
  // the others give down to their `floor` (base + their own asks, busy spending and rockets), not just their surplus.
             askTau: 150, usedTau: 90, busyMin: 40 },   // busy = spent at least busyMin of it lately (a building spree)
  // Freighters: every port has one. Every `every` s the idle ones look over the whole empire and sail straight to the
  // port of the country that needs goods most (asked-for goods count `urgent` x, nearer ports win), carrying up to
  // `cargo` goods of what this country can spare; shipments under `min` goods wait unless asked for. On the way back
  // they bring whatever home is short of.
  freight: { cargo: 50, every: 1.5, min: 10, urgent: 4 },

  // people regrowth:  growth/sec = rate * P * (1 - P/C) + base
  growthRate: 0.06, growthBase: 0.3,

  // people spent per tile claimed, by biome
  tileCost: { grass: 0.5, desert: 1.5, mountain: 2.5, ice: 2.5 },   // ice is as hard to claim as mountains
  // how fast a push claims land: "work" per second; a tile takes (cost / grass cost) work
  pushWorkPerSec: budget => 4 + 3 * Math.sqrt(budget),

  // Collectors harvest the deposit tiles within `collectorReach` of them (their own country's land only). A tile is
  // worked by its nearest collector, so two side by side share the same tiles: more of them on one deposit gives less each.
  collectorReach: 4,
  // Roads: settlements in the same country join up by themselves, each to its nearest neighbours within `roadMax`
  // tiles, along the grid with one or two right-angle turns, when such a route stays on that country's land.
  // Trucks drive them. For show only.
  roadMax: 34, roadLinks: 2, truckSpeed: 5,
  // Every resource can only be stockpiled so far, and cities hold the stock: a country stores `base` plus `city` x each
  // of its cities' `store` (Village 1, Town 2, City 4 ...), plus what a launch pad's depot holds. Wood and stone are
  // generous (enough for a long building spree); iron is tighter, because it is what war runs on.
  storage: { wood: { base: 100, city: 300 }, stone: { base: 100, city: 300 }, iron: { base: 30, city: 60 }, uranium: { base: 20, city: 20 } },
  // AI nations keep iron under the same rule: they mine the iron in their land, plus a small trickle so none is ever unarmed.
  iron: { aiStart: 30, aiTrickle: 0.15 },
  prodPerTile: { forest: 0.1, stone: 0.12, iron: 0.1, uranium: 0.02 },   // stone a bit richer: it's in almost everything   // per owned, connected deposit tile, per second

  // unlock = how many people your whole empire must reach (at its peak) before you can build it
  buildings: {
    // the one housing building: every person lives in one. See CFG.settlement for levels, power, zones and storage.
    settlement: { cat: 'Housing', name: 'Settlement', unlock: 0, cost: { wood: 40, stone: 40 }, people: 20,
               desc: 'A new village: 20 settlers move in and it houses 120. It stores goods, and while it has people, enemies cannot take the land within 5 tiles of it without fighting them. Place one on a city you already have to upgrade it: Town, City, Metropolis and beyond. From City up, the extra housing runs on power. Cities need 10 tiles between them.' },
    station: { cat: 'Transport', name: 'Station', cap: 0,  unlock: 0, cost: { wood: 15, stone: 10 },
               desc: 'Lays its own rail to your nearest station. Trains carry people and cargo between your countries.' },
    port:    { cat: 'Transport', name: 'Port',    cap: 0,  unlock: 0, cost: { wood: 20, stone: 10 },
               desc: 'On the coast. Opens a sea route to your nearest port. Ships carry people and cargo.' },
    // not a building on one tile: a span over the water, built in two clicks (see bridgePlan). The cost shown is
    // its first tile of water; every tile after that costs a little more (CFG.bridge).
    bridge:  { cat: 'Transport', name: 'Bridge', span: true, unlock: 0, cost: { stone: 8 },
               desc: 'Click your own coast, then the land across the water. Costs stone for every tile of water it crosses, and each tile costs more than the last, so long bridges get expensive fast. Joins the land on both ends into one country; trucks drive over it and rail follows it. A bridge to free land claims the tile it lands on.' },
    // vehicles: not buildings. Pick one, then click one of your stations (truck) or ports (boat): it rolls out
    // from there with settlers and a starter package, and you drive it to found a colony (see launchVehicle).
    truck:   { cat: 'Vehicles', name: 'Truck', vehicle: 'station', unlock: 0, cost: { wood: 20, stone: 10 },
               desc: 'Click one of your stations to roll one out with settlers and a starter package, then drive it to free land and settle. Build a station in the new colony and its rail follows the road the truck took.' },
    boat:    { cat: 'Vehicles', name: 'Boat', vehicle: 'port', unlock: 0, cost: { wood: 30 },
               desc: 'Click one of your ports to launch one with settlers and a starter package, then sail it to free land and settle. Build a port in the new colony and its shipping lane follows the way the boat sailed.' },
    // energy: every country has its own power budget (supply from plants, demand from machines)
    burner:  { cat: 'Energy', name: 'Wood burner', cap: 0, unlock: 200, cost: { wood: 10, stone: 20 }, gen: 8,
               desc: 'Burns wood for 8 MW of power, up to 0.25 wood/s. It only burns what your country needs.' },
    rig:     { cat: 'Resources', name: 'Mining rig',  cap: 0, unlock: 500, cost: { wood: 20, stone: 10, iron: 10 }, use: 4,
               from: ['cabin', 'camp'],
               desc: 'Click a logger\'s cabin or miner\'s camp to upgrade it: 3x the output and frees its workers, but runs on 4 MW. No power, no output.' },
    solar:   { cat: 'Energy', name: 'Solar panel', cap: 0, unlock: 700, cost: { stone: 10, iron: 5 }, gen: 1.5,
               desc: '1.5 MW, free, forever. Each panel takes a tile you can\'t use for anything else. Cover land with them.' },
    // a nuclear plant: huge power from a little uranium, but it needs the sea to cool it
    nuclear: { cat: 'Energy', name: 'Nuclear plant', cap: 0, unlock: 1500, cost: { stone: 400, iron: 250 }, gen: 150, coast: true,
               desc: 'Makes 150 MW from uranium, up to 0.05 uranium/s, only as much as your country needs. Must be on the coast: sea water cools it. Mine uranium with a miner\'s camp or rig on its rare dark deposits, and ships and trains bring it to the plant.' },
    // collectors: a deposit only produces once something works it. Early on that's people.
    cabin:   { cat: 'Resources', name: "Logger's cabin", cap: 0, unlock: 0, cost: { wood: 5, stone: 10 }, workers: 5, on: ['forest'],
               desc: 'Cuts the forest within 4 tiles of it. Employs 5 of the country\'s people, who can\'t be sent anywhere. Two close together share the same trees.' },
    camp:    { cat: 'Resources', name: "Miner's camp",   cap: 0, unlock: 0, cost: { wood: 15, stone: 5 }, workers: 5, on: ['stone', 'iron', 'uranium'],
               desc: 'Mines the stone, iron and uranium within 4 tiles of it. Employs 5 of the country\'s people, who can\'t be sent anywhere. Two close together share the same rock.' },
    // weapons
    mortar:  { cat: 'Military', name: 'Mortar', cap: 0, unlock: 300, cost: { wood: 20, stone: 20 }, weapon: 'shell',
               desc: 'Fires by itself at the weapons and defenses of any nation you are at war with, up to 22 tiles away, and at its cities when none are in range: each shell kills a few of the people defending it. Shells cost 5 iron and reload in under 3 seconds. Holds fire when the country is down to 20 iron.' },
    turret:  { cat: 'Military', name: 'Gun turret', cap: 0, unlock: 400, cost: { stone: 25, iron: 15 }, gun: true,
               desc: 'Guns down enemy soldiers pushing into your land within 9 tiles of it, by itself: 6 a second, for a little iron. Enough of them stop a wave dead.' },
    airdef:  { cat: 'Military', name: 'Air defense', cap: 0, unlock: 500, cost: { stone: 30, iron: 30 }, use: 2, defense: true,
               desc: 'Shoots down shells and missiles aimed at anything within 14 tiles of it. Each interception costs 8 iron, then it reloads for 3 seconds. Uses 2 MW; short on power, it reloads slower.' },
    silo:    { cat: 'Military', name: 'Missile silo', cap: 0, unlock: 600, cost: { stone: 30, iron: 20 }, use: 3, weapon: 'missile',
               desc: 'Press F, then click a target up to 110 tiles away. Each missile costs 10 wood and 60 iron and hits everything in a wide blast hard: a settlement it hits loses a fifth of its people and stops growing for a while. Uses 3 MW; short on power, it reloads slower.' },
    // space: ice drills turn polar ice into rocket fuel, launch pads store it (and, next, launch rockets)
    drill:   { cat: 'Space', name: 'Ice drill', cap: 0, unlock: 800, cost: { stone: 20, iron: 25 }, use: 6, fuel: 0.5,
               desc: 'Only on polar ice. Drills ice and splits it into rocket fuel: 0.5 fuel/s on full power, and it draws 6 MW. A pipe lays itself to your nearest launch pad in the same country; with no pad, it waits.' },
    pad:     { cat: 'Space', name: 'Launch pad', cap: 0, unlock: 800, cost: { stone: 80, iron: 60 }, store: { stone: 100, iron: 150 },
               desc: 'Has its own depot (100 stone, 150 iron). Builds a rocket at once, for 100 iron, whenever it has none and you have the iron. Then your ice drills in the same country pump fuel straight into the rocket, 0.5/s for each drill, so more drills fuel it faster. Click a pad to pause or resume it.' },
  },
  // Rockets: a launch pad with no rocket builds one at once for `iron`, as soon as the country has that much on top of
  // `ironReserve` (kept back so your mortars keep firing). Then the country's ice drills pump fuel straight into its `tank`:
  // drill.fuel a second each on full power, shared by the pads fuelling at once. With no rocket to fuel, the drills wait.
  // Space stations: a rocket in orbit can become one (Enter). It houses `cap` people per level and stores goods.
  // The pad that launched it then keeps it supplied: each rocket it builds and fuels flies up by itself (a `trip`
  // of so many seconds) with up to `people` settlers and `each` of wood, stone and iron, from what home can spare.
  // Expanding a station costs `expand` from its own stock and adds `cap` more room.
  station: { cap: 20, people: 10, each: 25, keep: 50, trip: 15, expand: { stone: 60, iron: 60 } },
  rocket: { iron: 100, ironReserve: 20, tank: 400,
    // Flight, in tiles and seconds. Gravity pulls toward the middle of the disk: mu / r^2 beyond the rim, and weaker
    // toward the middle inside it (as inside a solid ball). A circular orbit just above the air takes about 100 s.
    // The air: full thickness over the disk, thinning out over `atm` tiles past the rim (scale height `scaleH`), none beyond.
    // Drag = drag x air x speed^2 / mass. The rocket: `dry` mass empty plus `wet` mass of fuel when the tank is full;
    // the engine pushes with `thrust` and throws fuel out at `ve` (so a full tank is worth ve x ln(4) = 125 tiles/s of speed; a good gravity turn reaches orbit with about 13% to spare).
    // Space turns the engine on and off; E/Q (or W/S) set the throttle at `throttleRate` per second; A/D turn at `turn` radians a second.
    flight: { mu: 1.08e6, atm: 120, scaleH: 35, drag: 0.008, dry: 1, wet: 3, ve: 90, thrust: 24, turn: 1.8, throttleRate: 0.8, lost: 40 } },
  power: { burnerWood: 0.25, rigMult: 3, nukeUranium: 0.05 },   // uranium a nuclear plant burns a second at full output
  // AI nations. Their land costs the same to claim as anyone's; their cities defend the land in their zones (CFG.settlement).
  // Their cities count as fully powered. A nation that is nearly full upgrades one of its cities, up to `maxLevel`
  // (paying the upgrade's iron, the only goods it keeps); its first city starts as a Town.
  ai: { count: 7, minDist: 75, radius: [8, 14], tilesPerSettlement: 300, fill: [0.6, 0.9], growth: 0.5, maxLevel: 3, upgradeAt: 0.9,
        // v2: nations play the game. Every `think` seconds each one may build a weapon, found a settlement and claim land.
        think: 2, expandAt: 0.75, expandShare: 0.05, maxTiles: 5000, settleGain: 40,
        tilesPerMortar: 500, maxMortars: 4, tilesPerSilo: 1200, maxSilos: 3, tilesPerAirDef: 900, maxAirDefs: 2, tilesPerTurret: 500, maxTurrets: 3,
        // Their mortars fire at your buildings and expeditions in range; their silos only once they're at war with you.
        reloadMult: { shell: 1, missile: 1 },      // they pay for every shot in iron, as you do, so they reload as fast as you
        // Soldiers: a nation whose border touches yours may turn on you (`aggression` = chance per think). At war it sends
        // waves into your land, openfront-style: `raidShare` of its people every `raidEvery` seconds while it is at least
        // `attackAt` full. A wave advances like one of your own pushes (at `raidSpeed` x the pace); each of your tiles costs it
        // the land price plus more the more crowded your country is. A nation boxed in for `boxedThinks` thinks declares war too.
        attackAt: 0.6, raidShare: 0.25, raidEvery: 20, raidSpeed: 0.5, aggression: 0.04, boxedThinks: 8 },
  // weapons: range in tiles, reload in seconds, blast radius in tiles, flight speed (tiles a second across the ground),
  // the shortest flight in seconds, and how high the arc is (its top, as a share of the distance; see flight()).
  // A blast damages the buildings in it (`damage` hits each). It doesn't kill people on open land.
  // Settlements are never damaged or destroyed: a hit kills `kill` (a share) of the people living there, so each hit
  // takes fewer and a settlement never empties. It keeps its capacity, but stops regrowing for `underFire` seconds
  // after the last hit, so steady shelling bleeds it and it recovers once the shelling stops.
  // hp: hits any other building can take before it is destroyed. Damage repairs itself, one hit every `repairSec`.
  hp: { other: 2, repairSec: 15 },
  underFire: 25,
  // air defense: shoots down an incoming shell or missile whose target is within `range` of it, if loaded and paid for
  airDefense: { range: 14, reload: 3, cost: { iron: 8 } },
  // gun turret: kills soldiers of a push whose front is within `range`, `kills` a second, paying `iron` per soldier
  turret: { range: 9, kills: 6, iron: 0.15 },
  mortarReserve: 20,           // your mortars fire by themselves, but not below this much iron
  weapons: {
    shell:   { name: 'Mortar shell', range: 22, reload: 2.5, radius: 1.5, damage: 1, kill: 0.04, speed: 9, minDur: 1.4, arc: 0.6, cost: { iron: 5 } },
    missile: { name: 'Missile', range: 110, reload: 10, radius: 3, damage: 5, kill: 0.2, speed: 14, minDur: 3.5, arc: 0.35, cost: { wood: 10, iron: 60 } },
  },

  // rail: a new station links itself to the nearest station by the cheapest land route
  trackCostPerTile: { wood: 0.15, stone: 0.15 },
  trackWeight: { grass: 1, desert: 1.5, mountain: 3, ice: 3 },   // track through mountains or ice costs 3x
  railMaxLength: 120,          // max weighted track length for one link
  // Bridges: tile k of water a bridge crosses costs `stone` + `grow` x (k - 1) stone, so a bridge of L tiles costs
  // stone x L + grow x L(L-1)/2: 10 tiles = 125, 20 = 350, 30 = 675, 50 = 1625. At most `maxLen` tiles of water.
  bridge: { stone: 8, grow: 1, maxLen: 50 },
  seaMaxLength: 500,           // max sea route length (tiles)
  trainSpeed: 12, shipSpeed: 9,

  expeditionSpeed: 18,         // tiles per second (autopilot only: the playtest bot's expeditions)
  // Expeditions are vehicles you drive: a truck over land, a boat over water. One physics model for both:
  // thrust along the heading, drag from whatever is underneath. Top speed = accel / drag (tiles per second).
  drive: {
    truck: { accel: 26, turn: 2.8, drag: { grass: 2.4, desert: 3.4, mountain: 6.5, ice: 6.5 } },   // about 11 / 7.5 / 4 tiles a second
    boat: { accel: 9, turn: 1.6, drag: 0.9 },                                            // about 10, and it drifts
    supplies: 90,              // seconds of supplies on board
    minCrew: 10,               // a truck or boat takes the send-% of free people, but at least this many if there are
    starve: 1,                 // people lost per second once they run out
    landReach: 2,              // a boat can put settlers ashore on free land this close
  },
  outpostRadius: 5,            // land claimed on arrival
  routeReach: 40,              // a colony's first station or port joins its vehicle's route if it is within this many tiles of it

  // the moon: a smaller world orbiting the disk (visual only, for now)
  // orbit 30 = half the real Earth–Moon distance (the real Moon is ~60 Earth radii away)
  moon: {
    radius: 130, orbit: 30, period: 240,   // radius in tiles; orbit = x disk radius; period in seconds
    plainsShare: 0.42,                     // share of the moon covered by dark basalt plains (the rest is highlands)
    craters: 340,                          // how many craters to scatter (most land on the highlands)
  },
  // the sun: the disk circles it once a "year". The game stays centred on the disk, so normally
  // the sun appears to circle you; lock onto the sun to see your world going around it instead.
  sun: {
    radius: 12,                            // x disk radius (the real Sun is ~109x Earth; scaled down to fit)
    distance: 24,                          // x the Earth-Moon distance (real: ~390x)
    year: 720,                             // seconds per orbit
  },
  // Vulcan: a lava world orbiting the sun, inside your world's orbit
  vulcan: {
    size: 0.7,                             // x your world's radius
    orbit: 0.45,                           // x your world's distance from the sun
    year: 217,                             // seconds per orbit (closer to the sun = faster)
    spin: 90,                              // seconds per turn on its own axis
    lavaShare: 0.2,                        // share of the surface that is open lava sea
  },
  // the outer planets (size = x your world's radius, orbit = x your world's distance from the sun,
  // spin = seconds per turn). Years follow Kepler's law: farther out = slower.
  planets: {
    aries:    { size: 0.53, orbit: 1.5, spin: 120 },   // the red planet
    zeus:     { size: 5.0,  orbit: 3.2, spin: 40 },    // banded gas giant with 3 moons
    poseidon: { size: 3.8,  orbit: 5.0, spin: 50 },    // blue ringed gas giant with 2 moons
    seedWorld: { orbit: 7.5 },                          // the far planet, generated from the map seed
  },

  tickHz: 20,
  zoomMin: 0.0001, zoomMax: 160, startZoom: 14,   // all the way in: close enough to watch the workers swing
  detailZoom: 10,              // >= this: full sprites
  cityZoom: 5,                 // <  this: map view (city icons + deposit markers)
};

// ======================================================================
// small helpers
// ======================================================================
const $ = id => document.getElementById(id);
// a phone or tablet: fingers and on-screen buttons instead of a mouse and keys
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const say = (desk, touch) => TOUCH ? touch : desk;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 131); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
const NUM_FMT = new Intl.NumberFormat();             // made once: toLocaleString builds a new formatter every call
function fmtNum(n) { return n >= 1000 ? NUM_FMT.format(Math.floor(n)) : String(Math.floor(n)); }
function addCost(a, b) {
  const o = { ...a };
  if (b) for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v;
  return o;
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(v, key) {
    const a = this.k, b = this.v;
    let i = a.length; a.push(key); b.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [b[p], b[i]] = [b[i], b[p]]; i = p;
    }
  }
  pop() {
    const a = this.k, b = this.v, top = b[0];
    const lk = a.pop(), lv = b.pop();
    if (a.length) {
      a[0] = lk; b[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [b[m], b[i]] = [b[i], b[m]]; i = m;
      }
    }
    return top;
  }
}

// ======================================================================
// sprites (same item models as the concept art)
// ======================================================================
// little front-on buildings, reused to draw settlements at each level
const cot = (x, y, w, roof = '#c9553a', wall = '#e8d3a8') => {
  const h = w * 0.7;
  return `<rect x="${x - w / 2}" y="${y - h}" width="${w}" height="${h}" fill="${wall}" stroke="#6b4a2b" stroke-width="0.9"/>
    <path d="M${x - w / 2 - 1.5} ${y - h} L${x} ${y - h - w * 0.6} L${x + w / 2 + 1.5} ${y - h} Z" fill="${roof}" stroke="#6b2b1b" stroke-width="0.9" stroke-linejoin="round"/>`;
};
const blk = (x, w, h, fill) => {
  let win = '';
  for (let y = 9 - h + 3; y < 8; y += 3.5) win += `M${x - w / 2 + 1.5} ${y} H${x + w / 2 - 1.5} `;
  return `<rect x="${x - w / 2}" y="${10 - h}" width="${w}" height="${h}" fill="${fill}" stroke="#2b323d" stroke-width="0.9"/><path d="${win}" stroke="#f2d98a" stroke-width="1.1"/>`;
};
const SHADOW = '<ellipse cx="0" cy="10" rx="13" ry="3" fill="#000" opacity="0.2"/>';
const SETTLE_ART = [
  SHADOW + cot(0, 9, 13),
  SHADOW + cot(-7, 5, 8) + cot(7, 5, 8) + cot(0, 10, 10),
  SHADOW + cot(-9, 6, 8) + cot(9, 6, 8) + `<rect x="-4" y="-9" width="8" height="19" fill="#d9c7a0" stroke="#6b4a2b" stroke-width="0.9"/>
    <path d="M-5.5 -9 L0 -15 L5.5 -9 Z" fill="#4d6f96" stroke="#2c4260" stroke-width="0.9" stroke-linejoin="round"/>
    <path d="M-1.5 -5 H1.5 M-1.5 -1 H1.5" stroke="#6b4a2b" stroke-width="1.2"/>` + cot(-6, 11, 7) + cot(6, 11, 7),
  SHADOW + blk(-9, 6, 12, '#7c8fa4') + blk(9, 6, 15, '#8fa3b8') + blk(-3, 7, 20, '#5f6b7d') + blk(4, 6, 24, '#6f7d92') + cot(-11, 11, 5) + cot(11, 11, 5),
];
// Trees, boulders and ore, seen from above. Several variants of each, built from a few helpers,
// so a forest or a deposit can be drawn as many different pieces instead of one stamp per tile.
const ring = (n, R, r, fill, ox = 0, oy = 0, rot = 0) => Array.from({ length: n }, (_, k) => {
  const a = rot + k / n * Math.PI * 2;
  return `<circle cx="${(ox + Math.cos(a) * R).toFixed(1)}" cy="${(oy + Math.sin(a) * R).toFixed(1)}" r="${r}" fill="${fill}"/>`;
}).join('');
const star = (n, R, r, fill, rot = 0) => `<polygon fill="${fill}" points="${Array.from({ length: n * 2 }, (_, k) => {
  const a = rot + k / (n * 2) * Math.PI * 2, q = k % 2 ? r : R;
  return (Math.cos(a) * q).toFixed(1) + ',' + (Math.sin(a) * q).toFixed(1);
}).join(' ')}"/>`;
const TSHADOW = '<ellipse cx="2.5" cy="3.5" rx="10" ry="8" fill="#000" opacity="0.22"/>';
// a leafy canopy: a lobed dark base, then smaller, lighter clumps climbing towards the light (top left)
const broadleaf = (dark, mid, light, hi) => TSHADOW + ring(7, 6.2, 4.4, dark) + `<circle r="7" fill="${dark}"/>` +
  ring(6, 3.8, 3.6, mid, -0.8, -0.8, 0.4) + ring(4, 2.2, 2.6, light, -1.8, -1.8, 0.9) + ring(3, 1.2, 1.3, hi, -3, -3, 0.2);
// a faceted lump of rock: a base, a lit top, and three sides in different shades
const chunk = p => `<ellipse cx="1.5" cy="5.5" rx="10" ry="4.5" fill="#000" opacity="0.22"/>
  <path d="M-9 3 L-7 -4 L-2 -8 L5 -7 L9 -1 L8 5 L2 8 L-5 7 Z" fill="${p[0]}"/>
  <path d="M-7 -4 L-2 -8 L5 -7 L3 -2 L-3 -1 Z" fill="${p[1]}"/>
  <path d="M-9 3 L-7 -4 L-3 -1 L-4 4 Z" fill="${p[2]}"/>
  <path d="M3 -2 L5 -7 L9 -1 L8 5 L4 3 Z" fill="${p[3]}"/>
  <path d="M-3 -1 L3 -2 L4 3 L-4 4 Z" fill="${p[4]}"/>`;
const at = (x, y, s, inner) => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
const fleck = (x, y, s) => `<path d="M${x} ${y - s} L${x + s * 0.6} ${y} L${x} ${y + s} L${x - s * 0.6} ${y} Z" fill="#e3edf4"/>`;
const GREY = ['#7b8289', '#c2c8cd', '#9aa1a8', '#5f666d', '#878e95'], PALE = ['#8a8f8c', '#d2d5cf', '#a9ada8', '#6b706d', '#969a96'];
const RUST = ['#7a4a38', '#bd7b56', '#96604a', '#4f2f25', '#85523f'], DEEP = ['#6a3d33', '#a8654a', '#84503f', '#43261f', '#74463a'];
const SHAPES = {
  treeA: broadleaf('#2f5a2b', '#3f7a35', '#56963f', '#7bb85a'),
  treeB: broadleaf('#264d2f', '#33663a', '#447c44', '#5c9652'),
  treeD: broadleaf('#566f2a', '#718f33', '#90ad43', '#b6cc68'),
  treeC: TSHADOW + star(9, 11, 6, '#1c4030') + star(9, 8.2, 4.4, '#28573c', 0.35) + star(8, 5.4, 2.8, '#35704a', 0.7) + star(6, 2.8, 1.4, '#4d8f5f', 0.2),
  rockA: chunk(GREY),
  rockB: at(-4, 1, 0.62, chunk(PALE)) + at(5, -3, 0.5, chunk(GREY)) + at(4, 6, 0.4, chunk(GREY)),
  rockC: at(-5, -3, 0.36, chunk(GREY)) + at(4, -5, 0.3, chunk(PALE)) + at(0, 3, 0.46, chunk(PALE)) + at(8, 4, 0.28, chunk(GREY)) + at(-8, 5, 0.25, chunk(GREY)),
  oreA: chunk(RUST) + fleck(-2, -4.5, 1.7) + fleck(4.5, -1, 1.3) + fleck(-5.5, 2, 1.1),
  oreB: at(-4, 1, 0.62, chunk(DEEP)) + at(5, -3, 0.5, chunk(RUST)) + at(4, 6, 0.4, chunk(RUST)) + fleck(-5, -1, 1.3) + fleck(5, -4.5, 1.1) + fleck(4, 5.5, 0.9),
  oreC: at(-5, -3, 0.36, chunk(RUST)) + at(4, -5, 0.3, chunk(DEEP)) + at(0, 3, 0.46, chunk(RUST)) + at(8, 4, 0.28, chunk(DEEP)) + at(-8, 5, 0.25, chunk(RUST)) + fleck(0, 1.5, 1.1) + fleck(-5, -4, 0.8),
  settle1: SETTLE_ART[0], settle2: SETTLE_ART[1], settle3: SETTLE_ART[2], settle4: SETTLE_ART[3], settlement: SETTLE_ART[1],
  person: `<circle cx="0" cy="-4.5" r="3" fill="#f2c14e" stroke="#5a4310" stroke-width="0.8"/>
    <path d="M-4.5 5 C-4.5 0 -2.5 -0.8 0 -0.8 C2.5 -0.8 4.5 0 4.5 5 Z" fill="#f2c14e" stroke="#5a4310" stroke-width="0.8"/>`,
  // houses round a settlement, front-on like the settlements; several looks per kind (HOUSE_LOOKS)
  house: SHADOW + cot(0, 9, 13),
  houseB: SHADOW + cot(0, 9, 14, '#4d6f96', '#a0683e'),
  houseC: SHADOW + cot(-2, 9, 12, '#8a5a3c', '#d9c7a0'),
  houseD: SHADOW + cot(3, 9, 11, '#c98f2a') + '<circle cx="-8" cy="4" r="4" fill="#3f7a35"/>',
  house2: SHADOW + blk(0, 13, 12, '#e8d3a8') + `<path d="M-8 -2 L0 -9 L8 -2 Z" fill="#4d6f96"/>`,
  house2B: SHADOW + blk(-5, 9, 12, '#f0d9a8') + blk(5, 10, 12, '#e8b3a3') + `<path d="M-10 -2 L-5 -7 L0 -2 L5 -7 L10 -2 Z" fill="#8a5a3c"/>`,
  house2C: SHADOW + blk(0, 15, 12, '#e8d3a8') + `<rect x="-7.5" y="4" width="15" height="2" fill="#d64045"/><path d="M-9 -2 L0 -9 L9 -2 Z" fill="#c9553a"/>`,
  house3: SHADOW + blk(0, 15, 18, '#7c8fa4'),
  house3B: SHADOW + blk(-6, 8, 13, '#5f6b7d') + blk(4, 11, 22, '#a3b4c6'),
  house3C: SHADOW + blk(0, 16, 19, '#a0543c') + `<rect x="-8" y="-10" width="16" height="2" fill="#4f7a4a"/>`,
  burner: `<rect x="-9" y="-7" width="22" height="20" fill="#000" opacity="0.22"/>
    <rect x="-11" y="-6" width="20" height="16" rx="1.5" fill="#8a5a44" stroke="#4a2a1e" stroke-width="1"/>
    <rect x="3" y="-13" width="5" height="9" fill="#6b4535" stroke="#4a2a1e" stroke-width="0.9"/>
    <path d="M-6 6 C-7 2 -4 0 -3 -2 C-2 1 0 1 0 -1 C2 2 2 5 0 6 Z" fill="#ffb238" stroke="#d9531e" stroke-width="0.9"/>
    <circle cx="5.5" cy="-14" r="2.2" fill="#c8c8c8" opacity="0.7"/>`,
  rig: `<rect x="-8" y="-8" width="22" height="22" fill="#000" opacity="0.2"/>
    <path d="M-9 11 L0 -12 L9 11" fill="none" stroke="#e0a93a" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M-5.5 2 H5.5 M-3 -5 H3" stroke="#e0a93a" stroke-width="1.6"/>
    <rect x="-11" y="9" width="22" height="4" rx="1" fill="#59616b" stroke="#2b3038" stroke-width="0.8"/>
    <path d="M0 -12 V9" stroke="#3d434a" stroke-width="1.6"/><circle cx="0" cy="-12" r="2" fill="#f2c14e" stroke="#5a4310" stroke-width="0.8"/>`,
  solar: `<rect x="-10" y="-8" width="24" height="22" fill="#000" opacity="0.18"/>
    <rect x="-12" y="-11" width="24" height="22" rx="1" fill="#1d3e78" stroke="#c9d3df" stroke-width="1.2"/>
    <path d="M-4 -11 V11 M4 -11 V11 M-12 -3.7 H12 M-12 3.7 H12" stroke="#6f93cf" stroke-width="1"/>
    <path d="M-11 -10 L-6 -10 L-10 -6 Z" fill="#9fc0f0" opacity="0.7"/>`,
  cabin: `<rect x="-9" y="-5" width="22" height="18" fill="#000" opacity="0.22"/>
    <path d="M-12 -1 L0 -11 L12 -1 Z" fill="#7a4a2a" stroke="#3e2414" stroke-width="1" stroke-linejoin="round"/>
    <rect x="-10" y="-1" width="20" height="12" fill="#a0683e" stroke="#3e2414" stroke-width="1"/>
    <path d="M-10 3 H10 M-10 7 H10" stroke="#6e4426" stroke-width="0.9"/><rect x="-3" y="3" width="6" height="8" fill="#3e2414"/>
    <path d="M7 -14 L11 -6 M11 -14 L7 -6" stroke="#cfd5db" stroke-width="1.6"/>`,
  camp: `<rect x="-9" y="-6" width="22" height="19" fill="#000" opacity="0.22"/>
    <path d="M-12 11 L-3 -9 L6 11 Z" fill="#c9a66b" stroke="#5a4310" stroke-width="1" stroke-linejoin="round"/>
    <path d="M-3 -9 V11" stroke="#5a4310" stroke-width="0.9"/><path d="M-6 11 L-3 3 L0 11 Z" fill="#4a3a28"/>
    <path d="M5 -10 L12 -3 M8 -12 L4 -6 L10 -8" stroke="#8d969e" stroke-width="2" stroke-linecap="round"/>
    <path d="M6 -8 L13 1" stroke="#7a4a2a" stroke-width="1.6" stroke-linecap="round"/>`,
  silo: `<rect x="-11" y="-10" width="26" height="25" fill="#000" opacity="0.22"/>
    <rect x="-13" y="-13" width="26" height="26" rx="2" fill="#7d858f" stroke="#2b3038" stroke-width="1"/>
    <rect x="-11.5" y="-11.5" width="23" height="23" rx="1.5" fill="none" stroke="#f2c14e" stroke-width="1.6" stroke-dasharray="3 2.5"/>
    <rect x="-13" y="-4" width="5" height="8" fill="#5a626c" stroke="#2b3038" stroke-width="0.8"/><rect x="8" y="-4" width="5" height="8" fill="#5a626c" stroke="#2b3038" stroke-width="0.8"/>
    <circle r="8" fill="#22262c" stroke="#14171b" stroke-width="1.2"/><circle r="6.2" fill="none" stroke="#454c55" stroke-width="0.9"/>
    <path d="M-5.5 -5.5 L5.5 5.5 M5.5 -5.5 L-5.5 5.5" stroke="#b9c0c6" stroke-width="1.8"/>
    <circle r="4.2" fill="#e8ecef" stroke="#8d969e" stroke-width="0.8"/><circle r="2.5" fill="#f6f8f9"/><circle r="1.5" fill="#d64045"/>`,
  turret: `<ellipse cx="1.5" cy="3" rx="12" ry="10" fill="#000" opacity="0.2"/>` + ring(10, 9, 3, '#8f7a52') + ring(10, 9, 2.3, '#bfa674', -0.4, -0.5) +
    `<circle r="6.6" fill="#4a4034"/><circle r="4.6" fill="#55603a" stroke="#262b18" stroke-width="0.9"/>
    <g transform="rotate(-30)"><rect x="1" y="-2.6" width="12" height="1.8" rx="0.6" fill="#22262c"/><rect x="1" y="0.8" width="12" height="1.8" rx="0.6" fill="#22262c"/>
    <rect x="-3.4" y="-3.4" width="6.8" height="6.8" rx="1.4" fill="#6f7a4a" stroke="#262b18" stroke-width="0.8"/></g>`,
  airdef: `<rect x="-10" y="-9" width="24" height="23" fill="#000" opacity="0.22"/>
    <rect x="-12" y="-12" width="24" height="24" rx="3" fill="#5f6f78" stroke="#263238" stroke-width="1"/>
    <circle r="8.5" fill="#3d4a52" stroke="#1d262b" stroke-width="1"/>
    <g transform="rotate(-35)"><rect x="-6.5" y="-3.2" width="15" height="2.6" rx="1" fill="#dfe6ea" stroke="#59616b" stroke-width="0.6"/>
    <rect x="-6.5" y="0.6" width="15" height="2.6" rx="1" fill="#dfe6ea" stroke="#59616b" stroke-width="0.6"/>
    <path d="M8.5 -3.2 L11 -1.9 L8.5 -0.6 Z M8.5 0.6 L11 1.9 L8.5 3.2 Z" fill="#d64045"/>
    <rect x="-7.5" y="-4.2" width="5" height="8.4" rx="1" fill="#7c8a93" stroke="#263238" stroke-width="0.7"/></g>
    <path d="M-9.5 9.5 A13.5 13.5 0 0 1 -9.5 -9.5" fill="none" stroke="#7bd389" stroke-width="1.3" stroke-dasharray="2.5 2"/>`,
  mortar: `<ellipse cx="1.5" cy="3" rx="12" ry="10" fill="#000" opacity="0.2"/>` + ring(9, 8.6, 3.3, '#8f7a52') + ring(9, 8.6, 2.6, '#bfa674', -0.4, -0.5) +
    `<circle r="6.4" fill="#4a4034"/><circle r="4.2" fill="#6b6f74" stroke="#2b3038" stroke-width="0.9"/>
    <rect x="-2.2" y="-12" width="4.4" height="13" rx="1.6" fill="#3a4049" stroke="#1d2126" stroke-width="0.8" transform="rotate(38)"/>
    <circle cx="6.6" cy="-8.4" r="1.5" fill="#111417"/>`,
  // the same three defences split in two: a fixed base, and a top drawn pointing right that turns to aim (see DEFENCE_TOPS)
  turretBase: `<ellipse cx="1.5" cy="3" rx="12" ry="10" fill="#000" opacity="0.2"/>` + ring(10, 9, 3, '#8f7a52') + ring(10, 9, 2.3, '#bfa674', -0.4, -0.5) +
    `<circle r="6.6" fill="#4a4034"/>`,
  turretGun: `<rect x="1" y="-2.6" width="12" height="1.8" rx="0.6" fill="#22262c"/><rect x="1" y="0.8" width="12" height="1.8" rx="0.6" fill="#22262c"/>
    <rect x="-3.4" y="-3.4" width="6.8" height="6.8" rx="1.4" fill="#6f7a4a" stroke="#262b18" stroke-width="0.8"/>`,
  mortarBase: `<ellipse cx="1.5" cy="3" rx="12" ry="10" fill="#000" opacity="0.2"/>` + ring(9, 8.6, 3.3, '#8f7a52') + ring(9, 8.6, 2.6, '#bfa674', -0.4, -0.5) +
    `<circle r="6.4" fill="#4a4034"/><circle r="4.2" fill="#6b6f74" stroke="#2b3038" stroke-width="0.9"/>`,
  mortarTube: `<rect x="-1" y="-2.2" width="13" height="4.4" rx="1.6" fill="#3a4049" stroke="#1d2126" stroke-width="0.8"/><circle cx="10.7" r="1.5" fill="#111417"/>`,
  airdefBase: `<rect x="-10" y="-9" width="24" height="23" fill="#000" opacity="0.22"/>
    <rect x="-12" y="-12" width="24" height="24" rx="3" fill="#5f6f78" stroke="#263238" stroke-width="1"/>
    <circle r="8.5" fill="#3d4a52" stroke="#1d262b" stroke-width="1"/>`,
  airdefTop: `<rect x="-6.5" y="-3.2" width="15" height="2.6" rx="1" fill="#dfe6ea" stroke="#59616b" stroke-width="0.6"/>
    <rect x="-6.5" y="0.6" width="15" height="2.6" rx="1" fill="#dfe6ea" stroke="#59616b" stroke-width="0.6"/>
    <path d="M8.5 -3.2 L11 -1.9 L8.5 -0.6 Z M8.5 0.6 L11 1.9 L8.5 3.2 Z" fill="#d64045"/>
    <rect x="-7.5" y="-4.2" width="5" height="8.4" rx="1" fill="#7c8a93" stroke="#263238" stroke-width="0.7"/>`,
  truck:`<ellipse cx="0" cy="8" rx="12" ry="2.5" fill="#000" opacity="0.2"/>
    <rect x="-12" y="-6" width="15" height="11" rx="1" fill="#c9a66b" stroke="#5a4310" stroke-width="1"/>
    <path d="M-12 -2 H3" stroke="#a6844c" stroke-width="0.9"/>
    <path d="M3 -3 H8 L12 1 V5 H3 Z" fill="#2f7de1" stroke="#1c4f99" stroke-width="1" stroke-linejoin="round"/>
    <path d="M5 -1.5 H7.5 L9.8 1 H5 Z" fill="#cfe3ff"/>
    <circle cx="-7" cy="6" r="2.6" fill="#2b3038"/><circle cx="7" cy="6" r="2.6" fill="#2b3038"/>
    <circle cx="-7" cy="6" r="1" fill="#8d969e"/><circle cx="7" cy="6" r="1" fill="#8d969e"/>`,
  bolt: `<path d="M2 -11 L-7 2 H-1 L-3 11 L7 -3 H1 Z" fill="#f2c14e" stroke="#5a4310" stroke-width="0.9" stroke-linejoin="round"/>`,
  station: `<rect x="-10" y="-8" width="24" height="20" fill="#000" opacity="0.22"/>
    <rect x="-12" y="-10" width="24" height="20" rx="2" fill="#a3aab1" stroke="#4c535b" stroke-width="1"/>
    <path d="M-9 -2 V6 M-4 -2 V6 M1 -2 V6 M6 -2 V6" stroke="#6b5240" stroke-width="1.6"/>
    <path d="M-12 0 H12 M-12 4 H12" stroke="#3d434a" stroke-width="1.4"/>
    <rect x="-7" y="-10" width="14" height="6" fill="#c4553a" stroke="#6b2b1b" stroke-width="0.8"/>`,
  port: `<rect x="-12" y="-12" width="24" height="24" rx="2" fill="#4a86ab"/><rect x="-12" y="-12" width="24" height="7" fill="#dccf93"/>
    <rect x="-4" y="-7" width="8" height="18" fill="#a67c52" stroke="#6b4a2b" stroke-width="0.9"/>
    <path d="M-4 -2 H4 M-4 3 H4 M-4 8 H4" stroke="#6b4a2b" stroke-width="0.8"/>
    <circle cx="-5.5" cy="10" r="1.4" fill="#5a3d22"/><circle cx="5.5" cy="10" r="1.4" fill="#5a3d22"/>`,
  bridge: `<rect x="-13" y="2" width="26" height="11" rx="2" fill="#4a86ab"/>
    <path d="M-10 6 H10 M-7 10 H5" stroke="#8fc0dd" stroke-width="1" stroke-linecap="round"/>
    <path d="M-14 -4 H14 V1 H10 A5 5 0 0 0 0 1 A5 5 0 0 0 -10 1 H-14 Z" fill="#b3aa9b" stroke="#4f4a44" stroke-width="1" stroke-linejoin="round"/>
    <path d="M-14 -4 H14" stroke="#e2dccf" stroke-width="1.4"/>
    <path d="M-7 -4 V-1 M0 -4 V-1 M7 -4 V-1" stroke="#857d70" stroke-width="0.8"/>`,
  drill: `<rect x="-9" y="-8" width="22" height="22" fill="#000" opacity="0.2"/>
    <rect x="-11" y="2" width="22" height="10" rx="2" fill="#dfe8ef" stroke="#3d4a56" stroke-width="1"/>
    <circle cx="-5.5" cy="7" r="3" fill="#5fc4f0" stroke="#1d5a7a" stroke-width="0.8"/>
    <rect x="3" y="4.5" width="6" height="5" rx="1" fill="#f2c14e" stroke="#5a4310" stroke-width="0.7"/>
    <path d="M-6 2 L0 -12 L6 2" fill="none" stroke="#7a8794" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-3.5 -4 H3.5" stroke="#7a8794" stroke-width="1.4"/>
    <path d="M0 -12 V11" stroke="#2b3038" stroke-width="1.8"/><circle cx="0" cy="-12" r="1.8" fill="#5fc4f0" stroke="#1d5a7a" stroke-width="0.7"/>`,
  pad: `<rect x="-11" y="-10" width="26" height="25" fill="#000" opacity="0.22"/>
    <rect x="-13" y="-13" width="26" height="26" rx="2" fill="#b3b9be" stroke="#2b3038" stroke-width="1"/>
    <path d="M-13 -3 H-8 M-13 3 H-8" stroke="#6b737b" stroke-width="1.2"/>
    <circle cx="-1" r="8.5" fill="#8a9198" stroke="#f2c14e" stroke-width="2" stroke-dasharray="3 2"/>
    <circle cx="-1" r="5" fill="#2f353b" stroke="#14171b" stroke-width="0.8"/><circle cx="-1" r="2" fill="#5fc4f0"/>
    <rect x="8" y="-12" width="4" height="15" fill="#c94b3c" stroke="#5a1f18" stroke-width="0.8"/>
    <path d="M8 -8 H12 M8 -4 H12 M8 0 H12" stroke="#5a1f18" stroke-width="0.7"/>
    <rect x="6" y="7" width="6" height="5" rx="1" fill="#dfe8ef" stroke="#3d4a56" stroke-width="0.7"/>`,
  rocket: `<ellipse cx="1.5" cy="12.5" rx="6.5" ry="2" fill="#000" opacity="0.25"/>
    <path d="M-5 3 L-9.5 11 L-5 9.5 Z M5 3 L9.5 11 L5 9.5 Z" fill="#d64045" stroke="#5a1f18" stroke-width="0.8" stroke-linejoin="round"/>
    <path d="M0 -14 C4 -10 5 -4 5 4 L5 10 L-5 10 L-5 4 C-5 -4 -4 -10 0 -14 Z" fill="#eef2f5" stroke="#2b3038" stroke-width="1"/>
    <path d="M0 -14 C2.6 -11.5 3.6 -9 4.2 -7 L-4.2 -7 C-3.6 -9 -2.6 -11.5 0 -14 Z" fill="#d64045"/>
    <path d="M2.6 -6 V9" stroke="#c4ccd3" stroke-width="1.4"/>
    <circle cx="0" cy="-2" r="2" fill="#5fc4f0" stroke="#1d5a7a" stroke-width="0.8"/>
    <path d="M-3 10 L-2.2 13 L2.2 13 L3 10 Z" fill="#59616b" stroke="#2b3038" stroke-width="0.6"/>`,
  uranium: `<ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 2 L-5 -5 L1 -7 L6 -4 L8 2 L4 6 L-4 5 Z" fill="#3f4a38" stroke="#20281c" stroke-width="1"/>
    <path d="M-5 -5 L1 -7 L6 -4 L2 0 L-4 -1 Z" fill="#5b6b4c"/>
    <circle cx="-3" cy="2" r="1.4" fill="#9dff7a"/><circle cx="3" cy="-2.5" r="1.1" fill="#9dff7a"/><circle cx="4.5" cy="2.5" r="0.8" fill="#c8ffb0"/>`,
  nuclear: `<rect x="-12" y="-4" width="26" height="17" fill="#000" opacity="0.2"/>
    <path d="M2 11 C3.5 4 3.5 -2 1.5 -9 L10.5 -9 C8.5 -2 8.5 4 10 11 Z" fill="#d9dee3" stroke="#59636d" stroke-width="1"/>
    <path d="M1.8 -6 L10.2 -6" stroke="#aab3bc" stroke-width="1"/>
    <circle cx="4" cy="-12" r="2.6" fill="#f2f4f6" opacity="0.85"/><circle cx="8" cy="-13.5" r="2.1" fill="#f2f4f6" opacity="0.7"/>
    <rect x="-12" y="3" width="14" height="8" fill="#b8c0c8" stroke="#59636d" stroke-width="1"/>
    <path d="M-11 3 A6 6 0 0 1 1 3 Z" fill="#e7ebef" stroke="#59636d" stroke-width="1"/>
    <circle cx="-5" cy="7" r="1.6" fill="#9dff7a" stroke="#2f5a22" stroke-width="0.6"/>`,
  fuel: `<path d="M0 -11 C4 -5 8 -1 8 4 A8 8 0 0 1 -8 4 C-8 -1 -4 -5 0 -11 Z" fill="#5fc4f0" stroke="#1d5a7a" stroke-width="1.2"/>
    <path d="M-4.5 3 A4.5 4.5 0 0 0 0 7.5" stroke="#d8f3ff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  tree: `<ellipse cx="1.5" cy="3" rx="7" ry="4" fill="#000" opacity="0.18"/><circle r="7" fill="#3d6b32"/>
    <circle cx="-2" cy="-2" r="4.2" fill="#558a3f"/><circle cx="-3" cy="-3" r="1.6" fill="#72a855"/>`,
  rock: `<ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 3 L-6 -4 L-1 -7 L5 -5 L8 1 L5 5 L-4 6 Z" fill="#8e959c" stroke="#5f666d" stroke-width="1"/>
    <path d="M-6 -4 L-1 -7 L5 -5 L1 -1 L-4 0 Z" fill="#bcc2c8"/>`,
  ore: `<ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 2 L-5 -5 L1 -7 L6 -4 L8 2 L4 6 L-4 5 Z" fill="#7a5040" stroke="#45291f" stroke-width="1"/>
    <path d="M-5 -5 L1 -7 L6 -4 L2 0 L-4 -1 Z" fill="#a96d52"/>
    <circle cx="-3" cy="2" r="1.1" fill="#d6e1ea"/><circle cx="3" cy="-2.5" r="0.9" fill="#d6e1ea"/>`,
  boat: `<path d="M-12 0 H12 L8 7 H-8 Z" fill="#a67c52" stroke="#5a3d22" stroke-width="1"/>
    <path d="M0 -12 V0" stroke="#5a3d22" stroke-width="1.5"/><path d="M1 -11 L10 -3 H1 Z" fill="#f4f1e6" stroke="#8d969e" stroke-width="0.6"/>`,
  // trains, seen from above and facing right (drawn turned along the track)
  engine: `<rect x="-13" y="-5" width="26" height="10" fill="#b8432f" stroke="#5a1f18" stroke-width="1"/>
    <rect x="10" y="-2.5" width="2.5" height="5" fill="#f2c14e"/>`,
  wagon: `<rect x="-13" y="-5" width="26" height="10" fill="#2f3540" stroke="#14171b" stroke-width="1"/>`,
};
SHAPES.ship = SHAPES.boat;   // cargo boats on sea routes look like the expedition boat unless sprites/ship.png says otherwise
// SPR holds each sprite as an SVG image; RAS holds it drawn once into two small bitmaps (large and small).
// The map draws from RAS: stamping a bitmap is many times faster than drawing an SVG image, which the
// browser re-renders from its shapes on every draw, and a forest is thousands of draws a frame.
const SVG = {}, SPR = {}, RAS = {};
for (const [name, inner] of Object.entries(SHAPES)) {
  SVG[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -15 30 30" width="64" height="64">${inner}</svg>`;
  const img = new Image();
  img.onload = () => {
    if (PIXEL_ART.has(name)) return;   // a pixel-art PNG already took this sprite's place
    RAS[name] = [128, 40].map(px => {
      const c = document.createElement('canvas');
      c.width = c.height = px;
      c.getContext('2d').drawImage(img, 0, 0, px, px);
      return c;
    });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SVG[name]);
  SPR[name] = img;
}

// Pixel-art skins. Put a PNG named after any SHAPES key in prototype/sprites/ (sprites/boat.png,
// sprites/settle1.png, ...) and list the name in sprites/sprites.json: it replaces the drawn shape on the map
// and in the HUD. Anything not listed keeps its drawn shape. See sprites/README.md.
// A PNG's square fills the same square as the shape's 30-unit box, and its pixels stay hard-edged:
// scaled up by a whole number with smoothing off, so a 32x32 drawing never blurs.
const PIXEL_ART = new Set();   // sprite names now drawn from a PNG
function pixelCanvas(img, k) {
  const c = document.createElement('canvas');
  c.width = img.width * k; c.height = img.height * k;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function applyPixelSprite(name, img) {
  const big = pixelCanvas(img, Math.max(1, Math.floor(128 / img.width)));
  PIXEL_ART.add(name);
  RAS[name] = [big, pixelCanvas(img, 1)];
  const url = big.toDataURL();
  const spr = new Image(); spr.src = url; SPR[name] = spr;
  SVG[name] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${big.width} ${big.height}" width="64" height="64">` +
    `<image href="${url}" width="${big.width}" height="${big.height}" style="image-rendering:pixelated"/></svg>`;
}
function loadPixelSprites() {
  const stamp = Date.now();   // skip the browser cache, so a re-saved PNG shows on the next reload
  fetch('sprites/sprites.json?t=' + stamp)
    .then(r => r.ok ? r.json() : []).catch(() => [])
    .then(names => Promise.all(names.map(name => new Promise(done => {
      if (!SHAPES[name]) { console.warn(`sprites.json: "${name}" is not a sprite name`); return done(); }
      const img = new Image();
      img.onload = () => { applyPixelSprite(name, img); done(); };
      img.onerror = () => { console.warn(`sprites/${name}.png did not load; keeping the drawn ${name}`); done(); };
      img.src = `sprites/${name}.png?t=${stamp}`;
    }))))
    .then(() => {
      if (!PIXEL_ART.size) return;
      iconFill();
      try { renderBuildBar(); if (menuOpen) renderBuildMenu(); } catch (e) { /* the HUD isn't built yet; it will use the PNGs when it is */ }
    });
}
loadPixelSprites();
// Effect strips (sprites/blastS.png ...): one row of square frames, left to right, played once over the effect's
// life. Each is optional: without its PNG the effect is drawn by code as before. Drawn by tools/pixel_sprites.py.
//   blastS: a mortar shell hitting the ground · blastM: a missile · blastA: a shell shot down in the air · scorch: 1 frame
const FX = {};
for (const name of ['blastS', 'blastM', 'blastA', 'scorch']) {
  const img = new Image();
  img.onload = () => { FX[name] = { img, n: img.height, frames: Math.max(1, Math.round(img.width / img.height)) }; };
  img.src = `sprites/${name}.png?t=${Date.now()}`;
}
// frame `f` of a strip, `size` px square, with its anchor (cx, cy: 0..1 across the frame) on the screen point
function drawFx(fx, f, sx, sy, size, cy = 0.5, rot = 0, alpha = 1) {
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = size * dpr < fx.n;    // hard pixels when enlarged, smooth when shrunk
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (rot) { ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot); sx = 0; sy = 0; }
  ctx.drawImage(fx.img, f * fx.n, 0, fx.n, fx.n, sx - size / 2, sy - size * cy, size, size);
  if (rot) ctx.restore();
  if (alpha !== 1) ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = smooth;
}
const DEP_SPRITE = { forest: 'tree', stone: 'rock', iron: 'ore' };
const DEP_RES = { forest: 'wood', stone: 'stone', iron: 'iron', uranium: 'uranium' };
const DEP_TYPES = ['forest', 'stone', 'iron', 'uranium'];
const DEP_COLOR = { forest: '#3f7a35', stone: '#a7adb3', iron: '#a8654a', uranium: '#56664a' };
const BLD_CODE = { settlement: 1, station: 3, port: 4, burner: 6, rig: 7, solar: 8, cabin: 9, camp: 10, silo: 11, mortar: 12, airdef: 13, turret: 14, drill: 15, pad: 16, nuclear: 17 };
const BLD_COLOR = { settlement: '#de6d4c', station: '#8f979f', port: '#a67c52',
  burner: '#8a5a44', rig: '#e0a93a', solar: '#1d3e78', cabin: '#a0683e', camp: '#c9a66b', silo: '#6c7480', mortar: '#8f7a52', airdef: '#4f7f8c', turret: '#6f7a4a', drill: '#7fb8d8', pad: '#c9ced3', nuclear: '#cfd6dc' };
const buildingAt = i => (building[i] ? game.buildings.find(b => b.i === i) : null);
// the steps from `have` (or clear land) up to `type`, or null if `have` isn't below `type` on its ladder
function ladderSteps(type, have) {
  const steps = [];
  for (let t = type; t;) {
    if (t === have) return steps;
    steps.unshift(t);
    const f = CFG.buildings[t].from;
    if (Array.isArray(f)) return f.includes(have) ? steps : null;   // a branching ladder: only as an upgrade
    t = f;
  }
  return have ? null : steps;
}
const RES_ICON = { wood: 'tree', stone: 'rock', iron: 'ore', fuel: 'fuel', uranium: 'uranium' };

// ======================================================================
// world state
// ======================================================================
const OCEAN = 0, GRASS = 1, DESERT = 2, MOUNTAIN = 3, ICE = 4, WALL = 5, VOID = 6;   // ICE: the polar ice caps (land); WALL: the rim
const BIOME_NAME = ['Ocean', 'Grassland', 'Desert', 'Mountains', 'Ice', 'Ice wall', 'Space'];
const BIOME_KEY = [null, 'grass', 'desert', 'mountain', 'ice', null, null];

const params = new URLSearchParams(location.search);
// autosave lives in this browser (localStorage). Opening the game without ?seed= resumes it.
const SAVE_KEY = 'map-factory-save-v1';
const SAVE_V = 4;                               // v2: settlements replaced houses; v3: polar ice reshaped the map; v4: people live in cities
const SAVED = (() => { try { const v = JSON.parse(localStorage.getItem(SAVE_KEY)); return v && v.v === SAVE_V ? v : null; } catch (e) { return null; } })();
const SEED = params.has('seed') ? (parseInt(params.get('seed'), 10) || 1) : SAVED ? SAVED.seed : ((Math.random() * 1e6) | 0);
const RESUME = SAVED && SAVED.seed === SEED ? SAVED : null;
const W = CFG.mapW, H = CFG.mapH, N = W * H;
const rng = mulberry32(SEED);
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 1], [1, -1, 1], [-1, 1, 1], [-1, -1, 1]];
const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

const elev = new Float32Array(N), moist = new Float32Array(N), detail = new Float32Array(N);
const oceanDist = new Uint8Array(N);
const iceT = new Float32Array(N);          // 0 = inner face of the ice wall, 1 = outer edge
const biome = new Uint8Array(N);
const isLand = i => biome[i] >= GRASS && biome[i] <= ICE;
const DISK = { cx: W / 2, cy: H / 2, R: Math.min(W, H) / 2 - 2 };   // outer edge of the ice wall
const landmass = new Int32Array(N).fill(-1);
const owner = new Uint8Array(N);
const depositOf = new Int16Array(N).fill(-1);
const building = new Uint8Array(N);
const aiOf = new Uint8Array(N);              // which AI nation owns each tile (0 = none; else nation id + 1)
const bridgeAt = new Uint8Array(N);          // how many bridges run over each water tile (rail follows these)
const bridgeWide = new Uint8Array(N);        // bridge tiles and the water right beside them: where a truck can drive
const bridgeEnd = new Uint8Array(N);         // land tiles a bridge lands on (one of its two ends)
const onBridge = i => bridgeAt[i] > 0 && biome[i] === OCEAN;
const railable = i => isLand(i) || bridgeAt[i] > 0;
const deposits = [];
let seaLevel = 0, mtnLevel = 0, maxElev = 1;
let spawn = { x: 0, y: 0 };
let capitalTile = 0;

const game = {
  countries: [],          // every country you have founded (merged ones stay, marked not alive)
  active: 0,              // the country the HUD is showing
  population: 0, peakPop: 0, unlocked: new Set(),
  time: 0, landTiles: 0, ownedCount: 0,
  ownedDep: { forest: 0, stone: 0, iron: 0, uranium: 0 },
  buildings: [], stations: [], ports: [], links: [],
  freight: [],                     // freighters out from a port: { freight, kind: 'sea', home, dest, path, t, dir, cargo, to }
  pushes: [], expeditions: [], floats: [],
  routes: [],                      // the way each colony's truck or boat came: { kind, home, colony, path } (see routePlan)
  bridges: [],                     // { s, b, tiles, len }: from shore tile s over the water `tiles` to land tile b
  bridgeStart: null,               // with the bridge tool: the tile of your coast the first click picked
  sendPct: 25, tool: null, netDirty: true,
  nations: [],                     // AI nations
  hotbar: ['settlement', 'cabin', 'camp', null, null, null, null, null, null, null],   // the build bar: keys 1-9, 0
  barUsed: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0], useTick: 3,   // when each slot was last built from: what you build takes the least recently used slot
  seenTech: new Set(),    // unlocked buildings you've looked at in the E menu (the rest show NEW)
  missiles: [], blasts: [], scorch: [], tracers: [], smoke: [], aiming: false,
  raids: [],                       // waves of a nation's soldiers pushing into your land
  driving: null,                   // the expedition you're steering right now
  selection: [],   // tiles of selected buildings (box-select with left-drag)
  flights: [],     // rockets in the air or in orbit
  orbitals: [],    // space stations: { orbital, n, x, y, vx, vy, home, pad, people, level, res, runs, a }
  supplyRuns: [],  // supply rockets on their way up: { st, t, T, fx, fy, cargo }
  flying: null,    // the rocket you're flying right now
};
const frontier = new Set();   // unowned land tiles touching our territory

// ======================================================================
// map generation
// ======================================================================
function generateTerrain() {
  const s = SEED, { cx, cy, R } = DISK;
  const inside = new Uint8Array(N);   // 1 = inside the ice wall (land or ocean)
  const polar = new Uint8Array(N);    // 1 = inside a polar ice cap
  const P = CFG.poles, strait = R * P.strait;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    detail[i] = fbm(x / 5, y / 5, s + 33, 3);
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r > R) { biome[i] = VOID; continue; }
    // ice wall thickness wobbles around the rim (noise sampled on a circle, so it wraps seamlessly)
    const ang = Math.atan2(dy, dx);
    const wall = CFG.iceWall.min + fbm(Math.cos(ang) * 7 + 50, Math.sin(ang) * 7 + 50, s + 61, 3) * CFG.iceWall.extra;
    if (r > R - wall) { biome[i] = WALL; iceT[i] = (r - (R - wall)) / wall; continue; }
    inside[i] = 1;
    const wx = x + (fbm(x / 45, y / 45, s + 5, 3) - 0.5) * 36;
    const wy = y + (fbm(x / 45, y / 45, s + 9, 3) - 0.5) * 36;
    // two scales: big continents + smaller blobs that break off as islands
    const cs = CFG.continentScale;
    let e = fbm(wx / cs, wy / cs, s, 5) * 0.7 + fbm(wx / 32, wy / 32, s + 51, 4) * 0.3;
    // land thins out toward the wall, so the rim is mostly a ring of sea (with some coasts reaching the ice)
    const edge = clamp((R - wall - r) / (R * 0.07), 0, 1);
    e = e * (0.7 + 0.3 * edge) - (1 - edge) * 0.09;
    // polar caps: how far this tile lies inside its cap, in tiles (the cap line wanders along x)
    const line = R * (P.start + (fbm(x / 90, dy < 0 ? 3.5 : 9.5, s + 91, 3) - 0.5) * 2 * P.wobble);
    const pd = Math.abs(dy) - line + (fbm(x / 18, y / 18, s + 93, 3) - 0.5) * R * 0.05;
    if (pd > 0) polar[i] = 1;
    else if (pd > -strait) e -= 0.22 * (1 + pd / strait);   // sink the land in front of a cap into a strait
    elev[i] = e;
    moist[i] = fbm(x / CFG.climateScale, y / CFG.climateScale, s + 77, 4);
  }
  const sample = [];
  for (let guard = 0; sample.length < 30000 && guard < 400000; guard++) {
    const i = (rng() * N) | 0;
    if (inside[i] && !polar[i]) sample.push(elev[i]);
  }
  sample.sort((a, b) => a - b);
  seaLevel = sample[Math.floor(sample.length * CFG.waterFraction)];

  const landE = [], landM = [];
  for (let i = 0; i < N; i++) if (inside[i] && !polar[i] && elev[i] > seaLevel) { landE.push(elev[i]); landM.push(moist[i]); }
  landE.sort((a, b) => a - b); landM.sort((a, b) => a - b);
  mtnLevel = landE[Math.floor(landE.length * (1 - CFG.mountainShare))];
  maxElev = landE[landE.length - 1];
  const dryLevel = landM[Math.floor(landM.length * CFG.desertShare)];

  for (let i = 0; i < N; i++) {
    if (!inside[i]) continue;
    if (polar[i]) biome[i] = ICE;
    else if (elev[i] <= seaLevel) biome[i] = OCEAN;
    else if (elev[i] >= mtnLevel) biome[i] = MOUNTAIN;
    else if (moist[i] <= dryLevel) biome[i] = DESERT;
    else biome[i] = GRASS;
    if (isLand(i)) game.landTiles++;
  }

  // distance from land (or the ice wall), for ocean shading
  oceanDist.fill(255);
  const q = [];
  for (let i = 0; i < N; i++) if (biome[i] !== OCEAN && biome[i] !== VOID) { oceanDist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % W, y = (i / W) | 0, d = oceanDist[i];
    if (d >= 20) continue;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (oceanDist[n] > d + 1) { oceanDist[n] = d + 1; q.push(n); }
    }
  }

  // landmass ids (rail can only link stations on the same landmass)
  let lm = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!isLand(s0) || landmass[s0] >= 0) continue;
    const stack = [s0]; landmass[s0] = lm;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!inb(nx, ny)) continue;
        const n = idx(nx, ny);
        if (isLand(n) && landmass[n] < 0) { landmass[n] = lm; stack.push(n); }
      }
    }
    lm++;
  }
}

// Spawn on open grassland near the middle of the disk: search the central 35% of the
// radius first, and only widen the search if nothing good is found there.
function chooseSpawn() {
  let best = null, bestScore = -1;
  for (const frac of [0.35, 0.55, 0.8]) {
    for (let t = 0; t < 4000; t++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * DISK.R * frac;
      const x = Math.round(DISK.cx + Math.cos(a) * r), y = Math.round(DISK.cy + Math.sin(a) * r);
      if (x < 14 || y < 14 || x >= W - 14 || y >= H - 14 || biome[idx(x, y)] !== GRASS) continue;
      let grass = 0, tot = 0;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        if (dx * dx + dy * dy > 144) continue;
        tot++; if (biome[idx(x + dx, y + dy)] === GRASS) grass++;
      }
      // mostly "how much grass around", with a small nudge toward the exact centre
      const score = grass / tot - (r / DISK.R) * 0.05;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    if (bestScore > 0.85) break;
  }
  return best;
}

function growBlob(sx, sy, n, ok) {
  let start = -1;
  for (let r = 0; r < 6 && start < 0; r++)          // nudge to a valid start tile
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r && start < 0; dx++) {
      if (inb(sx + dx, sy + dy) && ok(idx(sx + dx, sy + dy))) start = idx(sx + dx, sy + dy);
    }
  if (start < 0) return null;
  const tiles = [start], inSet = new Set([start]), front = [start];
  let guard = n * 60;
  while (tiles.length < n && front.length && guard-- > 0) {
    const k = (rng() * front.length) | 0, t = front[k];
    const [dx, dy] = DIRS4[(rng() * 4) | 0];
    const nx = (t % W) + dx, ny = ((t / W) | 0) + dy;
    if (inb(nx, ny)) {
      const ni = idx(nx, ny);
      if (!inSet.has(ni) && ok(ni)) { inSet.add(ni); tiles.push(ni); front.push(ni); continue; }
    }
    if (rng() < 0.2) front.splice(k, 1);
  }
  return tiles;
}

function addDeposit(type, tiles) {
  if (!tiles || tiles.length < 4) return;
  const id = deposits.length;
  let sx = 0, sy = 0;
  for (const t of tiles) { depositOf[t] = id; sx += t % W; sy += (t / W) | 0; }
  deposits.push({ type, tiles, cx: sx / tiles.length, cy: sy / tiles.length });
}

function generateWorld() {
  generateTerrain();
  spawn = chooseSpawn();
  const d2 = i => ((i % W) - spawn.x) ** 2 + (((i / W) | 0) - spawn.y) ** 2;
  const R = CFG.startRadius;

  // your first settlement: the grass tile closest to the spawn point
  let capD = Infinity;
  capitalTile = idx(spawn.x, spawn.y);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const i = idx(spawn.x + dx, spawn.y + dy);
    if (biome[i] === GRASS && dx * dx + dy * dy < capD) { capD = dx * dx + dy * dy; capitalTile = i; }
  }
  const reserved = new Set([capitalTile]);

  // guaranteed starting forest + stone, fully inside the start circle
  const okStart = i => biome[i] === GRASS && depositOf[i] < 0 && !reserved.has(i) && d2(i) <= (R - 1) ** 2;
  const startDeps = [deposits.length];
  addDeposit('forest', growBlob(spawn.x - 5, spawn.y - 1, 18, okStart));
  startDeps.push(deposits.length);
  addDeposit('stone', growBlob(spawn.x + 5, spawn.y + 2, 12, okStart));

  // scattered deposits; iron only in mountains/desert and never near the start
  const specs = [
    { type: 'forest', ok: b => b === GRASS, count: game.landTiles / 650, min: 14, max: 34, minDist: R + 4 },
    { type: 'stone', ok: b => b === GRASS || b === MOUNTAIN, count: game.landTiles / 1700, min: 8, max: 16, minDist: R + 4 },
    { type: 'iron', ok: b => b === MOUNTAIN || b === DESERT, count: game.landTiles / 1400, min: 8, max: 16, minDist: 40 },
  ];
  for (const sp of specs) {
    let made = 0, tries = 0;
    while (made < sp.count && tries++ < sp.count * 30) {
      const i = (rng() * N) | 0;
      if (!sp.ok(biome[i]) || depositOf[i] >= 0 || d2(i) < sp.minDist ** 2) continue;
      const size = sp.min + ((rng() * (sp.max - sp.min)) | 0);
      const ok = j => sp.ok(biome[j]) && depositOf[j] < 0 && d2(j) > (R + 3) ** 2;
      const before = deposits.length;
      addDeposit(sp.type, growBlob(i % W, (i / W) | 0, size, ok));
      if (deposits.length > before) made++;
    }
  }

  // your home country: claim the start circle, place the first settlement
  const home = newCountry({ res: { ...CFG.startResources } });
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue;
    const x = spawn.x + dx, y = spawn.y + dy;
    if (inb(x, y) && biome[idx(x, y)] !== OCEAN) claim(idx(x, y), home.id);
  }
  placeBuilding(capitalTile, 'settlement');
  spawnNations();
  for (const id of startDeps) {
    const d = deposits[id];
    if (!d) continue;
    const mid = t => (t % W - d.cx) ** 2 + (((t / W) | 0) - d.cy) ** 2;   // the middle of the deposit, so its reach covers it
    const t = d.tiles.reduce((a, b) => (mid(a) <= mid(b) ? a : b));
    if (owner[t]) placeBuilding(t, d.type === 'forest' ? 'cabin' : 'camp');
  }
  // Uranium: a few small, dark deposits in mountains and desert, far from the start. Placed after everything else,
  // so adding it changed nothing else about a map (saves from before still fit).
  {
    const ok = b => b === MOUNTAIN || b === DESERT, count = Math.max(4, Math.round(game.landTiles / 60000));
    let made = 0, tries = 0;
    while (made < count && tries++ < count * 60) {
      const i = (rng() * N) | 0;
      if (!ok(biome[i]) || depositOf[i] >= 0 || building[i] || d2(i) < 70 ** 2) continue;
      const before = deposits.length;
      addDeposit('uranium', growBlob(i % W, (i / W) | 0, 5 + ((rng() * 5) | 0), j => ok(biome[j]) && depositOf[j] < 0 && !building[j]));
      if (deposits.length > before) made++;
    }
  }
  recomputeNetwork();
  home.people = Math.min(CFG.startPeople, home.cap);
  game.started = true;
  game.population = game.peakPop = home.people;
}

// ======================================================================
// territory layers
// ======================================================================
// Two 1-px-per-tile layers: a flat tint for every owned tile, and the border
// pixels. Far out, both are drawn (chunky pixel border, like openfront). Close
// up, only the tint is drawn and the border is stroked as thin lines instead.
// Your countries are blue (new colonies too); AI nations use their own colours.
function makeLayer() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // x0..y1: bounding box of pixels changed since the last upload (only that part is re-uploaded)
  return { c, g, img: g.createImageData(W, H), dirty: true, x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
}
function markDirty(L, x, y) {
  if (!L.dirty) { L.dirty = true; L.x0 = L.x1 = x; L.y0 = L.y1 = y; return; }
  if (x < L.x0) L.x0 = x; if (x > L.x1) L.x1 = x;
  if (y < L.y0) L.y0 = y; if (y > L.y1) L.y1 = y;
}
function flushLayer(L) {
  if (!L.dirty) return;
  L.g.putImageData(L.img, 0, 0, L.x0, L.y0, L.x1 - L.x0 + 1, L.y1 - L.y0 + 1);
  L.dirty = false;
}
const fillLayer = makeLayer(), borderLayer = makeLayer();
const PIXEL_BORDER_BELOW = 6;   // zoom where the border switches from pixels to lines
const COL = {
  fill: [47, 125, 225, 72], border: [28, 98, 214, 230],
};

function paintTerr(i) {
  landTouch(i);                                    // every change of hands repaints the tile: the land recompute only redoes these
  const o = i * 4, f = fillLayer.img.data, b = borderLayer.img.data;
  const x = i % W, y = (i / W) | 0;
  markDirty(fillLayer, x, y); markDirty(borderLayer, x, y);
  if (!owner[i]) {
    const a = aiOf[i];
    if (!a) { f[o + 3] = 0; b[o + 3] = 0; return; }
    const col = game.nations[a - 1].col;
    let edge = false;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny) || aiOf[idx(nx, ny)] !== a) { edge = true; break; }
    }
    f[o] = col[0]; f[o + 1] = col[1]; f[o + 2] = col[2]; f[o + 3] = 78;
    if (edge) { b[o] = col[0] * 0.75; b[o + 1] = col[1] * 0.75; b[o + 2] = col[2] * 0.75; b[o + 3] = 235; } else b[o + 3] = 0;
    return;
  }
  let border = false;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inb(nx, ny) || !owner[idx(nx, ny)]) { border = true; break; }
  }
  const fc = COL.fill, bc = COL.border;
  f[o] = fc[0]; f[o + 1] = fc[1]; f[o + 2] = fc[2]; f[o + 3] = fc[3];
  if (border) { b[o] = bc[0]; b[o + 1] = bc[1]; b[o + 2] = bc[2]; b[o + 3] = bc[3]; } else b[o + 3] = 0;
}

function claim(i, cid, conquer = false) {
  if (owner[i] || !isLand(i)) return false;
  const x = i % W, y = (i / W) | 0;
  if (aiOf[i]) {
    if (!conquer) return false;
    const n = game.nations[aiOf[i] - 1];
    n.tiles--; n.sx -= x; n.sy -= y;
    if (n.tiles) { n.lx = n.sx / n.tiles + 0.5; n.ly = n.sy / n.tiles + 0.5; }
    loseSettlement(i);                             // a city taken: its people are gone, and yours move in
    aiOf[i] = 0;                                   // their buildings on this tile are now yours
    provoke(n);
    game.bldDirty = true;
  }
  owner[i] = 1;
  countryOf[i] = cid;
  game.landDirty = true;                           // the settlement in reach of this tile now holds more
  game.ownedCount++;
  frontier.delete(i);
  paintTerr(i);
  if (game.started) noteClaim(i);
  addTileStats(game.countries[cid], i);
  if (depositOf[i] >= 0 || building[i]) game.bldDirty = true;   // a deposit's collector may now cover more tiles
  if (bridgeEnd[i]) game.netDirty = true;          // a bridge lands here: it may join this country to the one across
  const me = liveCountry(cid);
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (!inb(nx, ny)) continue;
    const n = idx(nx, ny);
    if (owner[n]) { paintTerr(n); if (liveCountry(countryOf[n]) !== me) game.netDirty = true; }   // touching another country: merge
    else { if (aiOf[n]) { paintTerr(n); const foe = game.nations[aiOf[n] - 1]; if (foe.warFront) foe.warFront.add(i); } if (isLand(n)) frontier.add(n); }
  }
  return true;
}

const tileCost = i => CFG.tileCost[BIOME_KEY[biome[i]]];
// per-country tile stats, kept up to date one tile at a time
function resetTileStats(c) {
  c.tiles = 0; c.sx = 0; c.sy = 0; c.box = [Infinity, Infinity, -Infinity, -Infinity];
  c.geo = { coast: 0, mtn: 0, desert: 0, port: 0, ice: 0 };
}
function addTileStats(c, i) {
  const x = i % W, y = (i / W) | 0, b = c.box;
  c.tiles++; c.sx += x; c.sy += y; c.lx = c.sx / c.tiles + 0.5; c.ly = c.sy / c.tiles + 0.5;
  if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  if (biome[i] === MOUNTAIN) c.geo.mtn++; else if (biome[i] === DESERT) c.geo.desert++; else if (biome[i] === ICE) c.geo.ice++;
  if (isCoastal(i)) c.geo.coast++;
}

// ======================================================================
// ======================================================================
// countries: every separate piece of your territory is a country with its own
// name, people and resources. Links move people and cargo between them; when two
// of your countries' borders touch, they merge into one.
// ======================================================================
const comp = new Int32Array(N).fill(-1);        // territory piece id per owned tile
const netStack = new Int32Array(N), netOwned = new Int32Array(N);   // scratch space for recomputeNetwork
const countryOf = new Int16Array(N).fill(-1);   // which of your countries owns each tile
function countryName(id) {
  const r = mulberry32(Math.floor(hash2(SEED, id + 1, 4242) * 4294967296));
  const short = makeName(r);
  return { short, full: `the Colony of ${short}` };
}
// A country's title grows with its housing (people capacity) and fits its land:
// the Colony of X -> X Harbor / X Hold / X Oasis / X Town -> the Republic of X -> the Federation of X -> the United States of X
const TITLE_TIERS = [
  { cap: 0 },
  { cap: 50, coast: ['{} Harbor', 'Port {}'], mtn: ['{} Hold', '{} Peaks'], desert: ['{} Oasis', '{} Sands'], land: ['{} Town', '{} Crossing', '{} Vale'] },
  { cap: 200, forms: ['the Free State of {}', 'the Republic of {}', 'the Kingdom of {}', 'the Duchy of {}'], coast: ['the Maritime Republic of {}'] },
  { cap: 1000, forms: ['the Federation of {}', 'the {} Commonwealth', 'the Dominion of {}', 'the Union of {}'] },
  { cap: 5000, forms: ['the United States of {}', 'the {} Empire', 'the Grand Union of {}'] },
];
function titleFor(c) {
  const T = TITLE_TIERS[c.tier], n = Math.max(1, c.tiles), g = c.geo;
  if (c.tier === 0) return `the Colony of ${c.short}`;
  const env = g.port || g.coast / n > 0.06 ? 'coast' : g.mtn / n > 0.4 ? 'mtn' : g.desert / n > 0.4 ? 'desert' : 'land';
  const opts = T.forms ? (env === 'coast' && T.coast ? [...T.forms, ...T.coast] : T.forms) : T[env];
  return opts[Math.floor(hash2(SEED, c.id * 7 + c.tier, 5151) * opts.length)].replace('{}', c.short);
}
function retitle(c, quiet) {
  const full = c.cap ?? c.capBase;                     // housing right now, powered part included
  let tier = c.tier;
  while (tier + 1 < TITLE_TIERS.length && full >= TITLE_TIERS[tier + 1].cap) tier++;
  const grew = tier > c.tier;
  c.tier = tier;                                       // a title never shrinks back
  const old = c.full;
  c.full = titleFor(c);
  if (grew && !quiet && old !== c.full) {
    toast(`${old} is now ${c.full}!`, { good: true, at: [c.lx, c.ly] });
    floatText(c.lx, c.ly - 3, `Now ${c.full}`, '#f2c14e');
  }
}
// ---------- AI nations (v1: static civilizations in their own colours) ----------
const NATION_COLORS = [[214, 64, 69], [156, 89, 209], [232, 140, 40], [38, 166, 154], [219, 90, 160], [150, 115, 70], [120, 170, 60], [200, 190, 60]];
const NATION_FORMS = ['the Empire of {}', 'the {} Horde', 'the Kingdom of {}', 'the {} Sultanate',
  'the Realm of {}', 'the {} Khanate', 'the Theocracy of {}', 'the {} Imperium'];
function nationName(k) {
  const r = mulberry32(Math.floor(hash2(SEED, k + 1, 9191) * 4294967296));
  const short = makeName(r);
  return { short, full: NATION_FORMS[(r() * NATION_FORMS.length) | 0].replace('{}', short) };
}
function spawnNations() {
  const r = mulberry32(Math.floor(hash2(SEED, 77, 31) * 4294967296));
  const A = CFG.ai, centers = [{ x: spawn.x, y: spawn.y }];
  let tries = 0;
  while (game.nations.length < A.count && tries++ < 5000) {
    const x = (r() * W) | 0, y = (r() * H) | 0, c = idx(x, y);
    if ((biome[c] !== GRASS && biome[c] !== DESERT) || owner[c] || aiOf[c]) continue;
    if (centers.some(q => (q.x - x) ** 2 + (q.y - y) ** 2 < A.minDist ** 2)) continue;
    const rad = A.radius[0] + r() * (A.radius[1] - A.radius[0]), R = Math.ceil(rad), lm = landmass[c];
    const tiles = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > rad * rad || !inb(x + dx, y + dy)) continue;
      const i = idx(x + dx, y + dy);
      if (isLand(i) && !owner[i] && !aiOf[i] && landmass[i] === lm) tiles.push(i);
    }
    if (tiles.length < 60) continue;
    const k = game.nations.length, col = NATION_COLORS[k % NATION_COLORS.length];
    game.nations.push({ id: k, ...nationName(k), col, hex: `rgb(${col.join(',')})`, people: 0, cap: 0, tiles: 0,
      lx: x + 0.5, ly: y + 0.5, alive: true, growth: 0 });
    for (const i of tiles) aiOf[i] = k + 1;
    // their settlements: one at the centre, more (spread as far apart as they'll go) in bigger nations
    const spots = tiles.filter(i => depositOf[i] < 0 && (biome[i] === GRASS || biome[i] === DESERT));
    const d2c = (i, px, py) => (i % W - px) ** 2 + (((i / W) | 0) - py) ** 2;
    const towns = [spots.reduce((a, b) => (d2c(a, x, y) <= d2c(b, x, y) ? a : b))];
    const want = clamp(Math.round(tiles.length / A.tilesPerSettlement), 1, 3);
    while (towns.length < want) {
      const far = i => Math.min(...towns.map(t => d2c(i, t % W, (t / W) | 0)));
      towns.push(spots.reduce((a, b) => (far(a) >= far(b) ? a : b)));
    }
    for (const i of towns) if (!building[i]) placeBuilding(i, 'settlement');
    if (buildingAt(towns[0])) buildingAt(towns[0]).up = 2;   // its capital starts as a Town
    // they start armed: a mortar and a missile silo by the first settlement
    for (const w of ['mortar', 'silo']) { const sp = aiSpot(game.nations[k], towns[0] % W, (towns[0] / W) | 0, 5, r); if (sp >= 0) placeBuilding(sp, w); }
    const seen = new Set();
    for (const i of tiles) {
      const d = depositOf[i];
      if (d < 0 || seen.has(d) || building[i]) continue;
      seen.add(d);
      placeBuilding(i, deposits[d].type === 'forest' ? 'cabin' : 'camp');
    }
    centers.push({ x, y });
  }
  scanNationTiles();
  buildFronts();
  recomputeBuildings();
  for (const n of game.nations) n.people = Math.round(n.cap * (A.fill[0] + r() * (A.fill[1] - A.fill[0])));
  for (let i = 0; i < N; i++) if (aiOf[i]) paintTerr(i);
}
function scanNationTiles() {
  for (const n of game.nations) { n.tiles = 0; n.sx = 0; n.sy = 0; }
  for (let i = 0; i < N; i++) {
    if (!aiOf[i]) continue;
    const n = game.nations[aiOf[i] - 1];
    n.tiles++; n.sx += i % W; n.sy += (i / W) | 0;
  }
}
function recomputeNations() {
  for (const n of game.nations) { n.cap = 0; n.ironCap = CFG.storage.iron.base; }
  for (const b of game.buildings) if (b.type === 'settlement' && aiOf[b.i]) {
    const n = game.nations[aiOf[b.i] - 1];
    n.cap += settlementCap(b); n.ironCap += CFG.storage.iron.city * levelDef(cityLevel(b)).store;
  }
  for (const n of game.nations) {
    if (n.tiles) { n.lx = n.sx / n.tiles + 0.5; n.ly = n.sy / n.tiles + 0.5; }
    n.people = Math.min(n.people, n.cap);          // lost land or settlements: the people who lived there are gone
    if (n.alive && !n.tiles) { n.alive = false; n.people = 0; toast(`You conquered ${n.full}!`, { good: true, at: [n.lx, n.ly] }); }
  }
}
const nationAt = i => (aiOf[i] ? game.nations[aiOf[i] - 1] : null);

// ---------- AI nations, v2: they claim land, found settlements, arm themselves and guard their borders ----------
const freeLand = i => isLand(i) && !owner[i] && !aiOf[i];
// each nation's front: the free land touching its border (entries are re-checked when used, so stale ones are harmless)
function buildFronts() {
  for (const n of game.nations) { n.front = new Set(); n.warFront = new Set(); }   // warFront: your tiles touching its border
  for (let i = 0; i < N; i++) {
    if (!aiOf[i]) continue;
    const x = i % W, y = (i / W) | 0, f = game.nations[aiOf[i] - 1].front;
    for (const [dx, dy] of DIRS4) {
      if (!inb(x + dx, y + dy)) continue;
      const nb = idx(x + dx, y + dy);
      if (freeLand(nb)) f.add(nb); else if (owner[nb]) game.nations[aiOf[i] - 1].warFront.add(nb);
    }
  }
}
function aiClaim(n, i) {
  const x = i % W, y = (i / W) | 0;
  aiOf[i] = n.id + 1; n.tiles++; n.sx += x; n.sy += y;
  n.front.delete(i);
  paintTerr(i);
  for (const [dx, dy] of DIRS4) {
    if (!inb(x + dx, y + dy)) continue;
    const nb = idx(x + dx, y + dy);
    if (aiOf[nb]) paintTerr(nb); else if (freeLand(nb)) n.front.add(nb); else if (owner[nb]) n.warFront.add(nb);
  }
  game.landDirty = true;
}
// a nation takes one of your tiles: the land, and anything built on it, is now theirs
function aiTake(n, i) {
  const x = i % W, y = (i / W) | 0, c = countryAt(i);
  loseSettlement(i);                               // a captured settlement's people are theirs now
  // Recounting every country means scanning the whole map, so only ask for it when this tile could have
  // been holding two parts of your land together (or was the country's last). Otherwise just subtract it.
  const own = (dx, dy) => inb(x + dx, y + dy) && owner[idx(x + dx, y + dy)] ? 1 : 0;
  const N4 = own(0, -1), E4 = own(1, 0), S4 = own(0, 1), W4 = own(-1, 0);
  let parts = N4 + E4 + S4 + W4;
  if (N4 && E4 && own(1, -1)) parts--;
  if (E4 && S4 && own(1, 1)) parts--;
  if (S4 && W4 && own(-1, 1)) parts--;
  if (W4 && N4 && own(-1, -1)) parts--;
  if (c) {
    c.tiles--; c.sx -= x; c.sy -= y;
    if (c.tiles) { c.lx = c.sx / c.tiles + 0.5; c.ly = c.sy / c.tiles + 0.5; }
    if (biome[i] === MOUNTAIN) c.geo.mtn--; else if (biome[i] === DESERT) c.geo.desert--; else if (biome[i] === ICE) c.geo.ice--;
    if (isCoastal(i)) c.geo.coast--;
  }
  if (!c || !c.tiles || parts > 1) game.netDirty = true;
  owner[i] = 0; countryOf[i] = -1; game.ownedCount--;
  aiOf[i] = n.id + 1; n.tiles++; n.sx += x; n.sy += y;
  n.warFront.delete(i);
  paintTerr(i);
  for (const [dx, dy] of DIRS4) {
    if (!inb(x + dx, y + dy)) continue;
    const nb = idx(x + dx, y + dy);
    if (owner[nb]) { paintTerr(nb); n.warFront.add(nb); frontier.add(i); }   // still next to your land: you can push back in
    else if (aiOf[nb]) paintTerr(nb);
    else if (freeLand(nb)) n.front.add(nb);
  }
  game.landDirty = game.bldDirty = true;           // your settlements here hold less now, or are theirs
}
// a clear tile of this nation's within `rad` of a point (or -1)
function aiSpot(n, px, py, rad, rnd = Math.random) {
  for (let k = 0; k < 40; k++) {
    const x = Math.round(px + (rnd() - 0.5) * 2 * rad), y = Math.round(py + (rnd() - 0.5) * 2 * rad);
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if (aiOf[i] === n.id + 1 && !building[i] && depositOf[i] < 0) return i;
  }
  return -1;
}
// attacking a nation (taking its land, shelling it) puts it at war with you: from then on its silos fire too
function provoke(n) {
  if (!n || n.hostile || !n.alive) return;
  n.hostile = true;
  if (game.started) toast(`${n.full} is now at war with you: its missile silos will fire on your buildings.`, { alert: true, at: [n.lx, n.ly] });
}
function aiThink(n) {
  if (!n.alive || !n.tiles) return;
  const A = CFG.ai, mine = game.buildings.filter(b => aiOf[b.i] === n.id + 1);
  const count = t => mine.reduce((a, b) => a + (b.type === t ? 1 : 0), 0);
  // 1) arm: more weapons as the nation grows, placed by one of its settlements
  const towns = mine.filter(b => b.type === 'settlement');
  const base = towns.length ? towns[(Math.random() * towns.length) | 0].i : idx(Math.floor(n.lx), Math.floor(n.ly));
  const want = count('mortar') < Math.min(A.maxMortars, 1 + Math.floor(n.tiles / A.tilesPerMortar)) ? 'mortar'
    : count('silo') < Math.min(A.maxSilos, 1 + Math.floor(n.tiles / A.tilesPerSilo)) ? 'silo'
    : count('turret') < Math.min(A.maxTurrets, Math.floor(n.tiles / A.tilesPerTurret)) ? 'turret'
    : count('airdef') < Math.min(A.maxAirDefs, Math.floor(n.tiles / A.tilesPerAirDef)) ? 'airdef' : null;
  const price = want ? CFG.buildings[want].cost.iron || 0 : 0;      // nations only keep iron, so that's the part they pay
  if (want && (n.iron || 0) >= price) { const sp = aiSpot(n, base % W, (base / W) | 0, 6); if (sp >= 0) { placeBuilding(sp, want); n.iron -= price; game.bldDirty = true; } }
  // mine: a camp on any iron in its land that nobody works yet
  for (const d of deposits) {
    if (d.type !== 'iron' || aiOf[d.tiles[0]] !== n.id + 1) continue;
    const t = d.tiles.find(q => aiOf[q] === n.id + 1 && !isHarvested(q) && !building[q]);
    if (t !== undefined) { placeBuilding(t, 'camp'); game.bldDirty = true; break; }
  }
  // grow up: a nearly full nation upgrades its smallest city (paying the iron part of the cost)
  if (n.people >= n.cap * A.upgradeAt && towns.length) {
    const low = towns.reduce((a, b) => (cityLevel(a) <= cityLevel(b) ? a : b)), step = upgradeStep(cityLevel(low));
    const iron = step ? step.cost.iron || 0 : 0;
    if (step && cityLevel(low) < A.maxLevel && (n.iron || 0) >= iron) { n.iron -= iron; low.up = cityLevel(low) + 1; low.bump = game.time; game.bldDirty = true; }
  }
  // 2) settle: a new settlement where a good patch of its land has none in reach
  const front = [...n.front];
  for (let k = 0; k < 6 && front.length; k++) {
    const f = front[(Math.random() * front.length) | 0], x = f % W, y = (f / W) | 0;
    let c = -1;
    for (const [dx, dy] of DIRS4) { const nb = idx(x + dx * 3, y + dy * 3); if (inb(x + dx * 3, y + dy * 3) && aiOf[nb] === n.id + 1) c = nb; }
    if (c < 0 || isServed(c) || building[c] || depositOf[c] >= 0 || crowdingCity(c)) continue;
    if (settlementGain(c).gain >= A.settleGain) { placeBuilding(c, 'settlement'); game.bldDirty = true; break; }
  }
  // 3) expand: spend people on the free land nearest its centre, like a slow, steady push
  if (n.people >= n.cap * A.expandAt && n.tiles < A.maxTiles && front.length) {
    let budget = n.people * A.expandShare, spent = 0;
    const cands = [];
    for (let k = 0; k < 50; k++) {
      const f = front[(Math.random() * front.length) | 0];
      if (!freeLand(f)) { n.front.delete(f); continue; }
      cands.push({ f, d: Math.hypot(f % W - n.lx, ((f / W) | 0) - n.ly) + Math.random() * 5 });
    }
    n.stuck = cands.length ? 0 : (n.stuck || 0) + 1;
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      const cost = tileCost(c.f);
      if (!freeLand(c.f) || cost > budget - spent) continue;
      spent += cost; aiClaim(n, c.f);
    }
    n.people -= spent;
  } else if (!front.length) n.stuck = (n.stuck || 0) + 1;
  // 4) war: boxed in with you next door, it declares war; at war, it pushes into your land
  if (!n.hostile && n.warFront.size && (n.stuck || 0) >= A.boxedThinks) {
    n.hostile = true;
    toast(`${n.full} has run out of room and declared war on you!`, { alert: true, at: [n.lx, n.ly] });
  }
  // a neighbour may simply turn on you once your borders touch
  if (!n.hostile && Math.random() < A.aggression && touchesYou(n)) {
    n.hostile = true;
    toast(`${n.full} has turned on you: its soldiers are massing at your border.`, { alert: true, at: [n.lx, n.ly] });
  }
  // at war: send a wave of soldiers into your land, aimed at your nearest settlement
  if (n.hostile && n.people >= n.cap * A.attackAt && game.time - (n.lastRaid ?? -99) >= A.raidEvery &&
      !game.raids.some(r => r.n === n.id) && touchesYou(n)) {
    let tgt = n.warFront.values().next().value, bd = Infinity;
    for (const b of game.buildings) {
      if (!owner[b.i]) continue;
      const d = tileDist(b.i, n.lx, n.ly) - (b.type === 'settlement' ? 15 : 0);
      if (d < bd) { bd = d; tgt = b.i; }
    }
    const budget = n.people * A.raidShare;
    n.people -= budget; n.lastRaid = game.time;
    game.raids.push({ n: n.id, budget, work: 0, tx: tgt % W + 0.5, ty: ((tgt / W) | 0) + 0.5, lx: null, ly: null });
    toast(`${n.full} sends ${Math.round(budget)} soldiers into your land! Push back to retake it.`, { alert: true, at: [tgt % W + 0.5, ((tgt / W) | 0) + 0.5] });
  }
}
// does this nation's border touch your land right now? (drops stale entries as it looks)
function touchesYou(n) {
  for (const f of n.warFront) {
    const x = f % W, y = (f / W) | 0;
    if (owner[f]) for (const [dx, dy] of DIRS4) if (inb(x + dx, y + dy) && aiOf[idx(x + dx, y + dy)] === n.id + 1) return true;
    n.warFront.delete(f);
  }
  return false;
}
// one wave of a nation's soldiers, advancing the way your own pushes do: it takes the tiles of yours nearest
// its target while it has soldiers left; what's left over goes home
function stepRaid(r, dt) {
  const n = game.nations[r.n], A = CFG.ai;
  if (!n.alive) { r.done = true; return; }
  r.work += CFG.pushWorkPerSec(r.budget) * A.raidSpeed * dt;
  if (r.work < 1) return;
  const cands = [];
  for (const f of n.warFront) {
    const x = f % W, y = (f / W) | 0;
    let touching = false;
    if (owner[f]) for (const [dx, dy] of DIRS4) if (inb(x + dx, y + dy) && aiOf[idx(x + dx, y + dy)] === n.id + 1) touching = true;
    if (!touching) { n.warFront.delete(f); continue; }
    cands.push({ f, cost: tileCost(f), d: Math.hypot(x - r.tx, y - r.ty) + Math.random() * 3 });
  }
  cands.sort((a, b) => a.d - b.d);
  if (r.lx == null && cands.length) { r.lx = cands[0].f % W + 0.5; r.ly = ((cands[0].f / W) | 0) + 0.5; }
  let cheapest = Infinity, guarded = 0;
  for (const c of cands) if (c.cost < cheapest) cheapest = c.cost;
  const cities = allCities(), fought = new Set(), atk = -(n.id + 1);
  for (const c of cands) {
    const g = guardAt(c.f, atk, cities);           // your city's people defend the land in its zone, one for one
    if (g) {
      guarded++;
      if (fought.has(g)) continue;
      fought.add(g);
      const fell = fightCity(g, Math.min(r.budget, r.work), true);
      r.work -= fell; r.budget -= fell;
      r.lx = c.f % W + 0.5; r.ly = ((c.f / W) | 0) + 0.5;
      if (r.work < 1 || r.budget < 0.5) break;
      continue;
    }
    if (c.cost > r.budget) continue;
    const work = c.cost / CFG.tileCost.grass;
    if (work > r.work) break;
    r.work -= work; r.budget -= c.cost;
    aiTake(n, c.f);
    r.lx = c.f % W + 0.5; r.ly = ((c.f / W) | 0) + 0.5;
    if (r.work < 1) break;
  }
  if (!cands.length || r.budget < 0.5 || (!guarded && r.budget < cheapest)) { r.done = true; n.people += Math.max(0, r.budget); }   // nowhere left to go, or too few to take a tile
}
// their weapons: mortars shoot at your expeditions and your weapons and defenses in range (never your settlements or
// economy); silos hit any of your buildings, once the nation is at war with you
function aiFire() {
  const A = CFG.ai;
  let yours = null;
  for (const b of game.buildings) {
    const k = aiOf[b.i], def = CFG.buildings[b.type];
    if (!k || !def.weapon || (b.ready || 0) > game.time) continue;
    const n = game.nations[k - 1], Wp = CFG.weapons[def.weapon];
    if (!n.alive || (def.weapon === 'missile' && !n.hostile)) continue;
    if ((n.iron || 0) < (Wp.cost.iron || 0)) continue;              // can't afford the shot: same price as yours
    const bx = b.i % W + 0.5, by = ((b.i / W) | 0) + 0.5;
    let tgt = null, bd = Wp.range;
    for (const e of game.expeditions) { const d = Math.hypot(e.x - bx, e.y - by); if (!e.done && d < bd) { bd = d; tgt = [e.x, e.y]; } }
    if (!tgt) {
      yours = yours || game.buildings.filter(q => owner[q.i]);
      const shell = def.weapon === 'shell';
      for (const q of yours) { const d = tileDist(q.i, bx, by); if (d < bd && (!shell || isMilitary(q))) { bd = d; tgt = tileCenter(q.i); } }
      if (!tgt && shell && n.hostile) {           // at war with no weapon of yours in range: it shells your cities' people
        let bc = Wp.range;
        for (const q of yours) { const d = tileDist(q.i, bx, by); if (q.type === 'settlement' && d < bc && (q.pop || 0) > shellFloor(q) + 1) { bc = d; tgt = tileCenter(q.i); } }
      }
    }
    if (!tgt) continue;
    launchShot(b, tgt[0], tgt[1], def.weapon, n);
    n.iron -= Wp.cost.iron || 0;
    b.rd = Wp.reload * A.reloadMult[def.weapon]; b.ready = game.time + b.rd;
    if (!n.hostile) {                              // opening fire on you is war: from now on your mortars fire back
      n.hostile = true;
      toast(`${n.full} opened fire on you: you are at war, and your mortars fire back. Keep out of its range, or knock its mortars out.`, { alert: true, at: [bx, by] });
    }
  }
}
// the people defending a nation's tile: those of the city whose zone covers it (0 if none: then it's just land)
const defenseAt = i => { const g = aiOf[i] ? guardAt(i, 1, allCities()) : null; return g ? g.pop : 0; };

const newPower = () => ({ burners: 0, solar: 0, nukes: 0, need: 0, capPow: 0, workers: 0, drills: 0, pads: 0, padList: [], cities: 0, cityStore: 0, depot: {},
  rigDep: { forest: 0, stone: 0, iron: 0, uranium: 0 }, colDep: { forest: 0, stone: 0, iron: 0, uranium: 0 } });
// people not working a collector: only they can be sent on pushes and expeditions
const freePeople = c => Math.max(0, c.people - c.pw.workers);
function newCountry({ people = 0, res = {} } = {}) {
  const id = game.countries.length;
  const c = { id, ...countryName(id), people, cap: 0, growth: 0, tier: 0, geo: { coast: 0, mtn: 0, desert: 0, port: 0, ice: 0 }, sx: 0, sy: 0,
    box: [Infinity, Infinity, -Infinity, -Infinity],
    res: { wood: 0, stone: 0, iron: 0, fuel: 0, uranium: 0, ...res }, rates: { wood: 0, stone: 0, iron: 0, fuel: 0, uranium: 0 },
    ownedDep: { forest: 0, stone: 0, iron: 0, uranium: 0 }, tiles: 0, lx: 0, ly: 0, alive: true, mergedInto: -1,
    capBase: 0, capPow: 0, sat: 1, pw: newPower(), mw: { gen: 0, max: 0, need: 0, burn: 0 } };
  game.countries.push(c);
  return c;
}
function liveCountry(id) {                       // follows merges to the country that exists now
  let c = game.countries[id];
  while (c && !c.alive && c.mergedInto >= 0) c = game.countries[c.mergedInto];
  return c && c.alive ? c : null;
}
const countryAt = i => (owner[i] ? liveCountry(countryOf[i]) : null);
const activeCountry = () => liveCountry(game.active) || liveCountry(0) || game.countries.find(c => c.alive);

function mergeCountry(from, into) {
  into.people += from.people;
  for (const r in from.res) into.res[r] += from.res[r];
  from.alive = false; from.mergedInto = into.id; from.people = 0;
  if (game.active === from.id) game.active = into.id;
  toast(`${from.short} has merged into ${into.full}`);
}

function recomputeNetwork() {
  // 1) find the separate pieces of territory
  // (runs whenever countries touch or split, so it's kept tight: one pass over the map to find the pieces,
  // which also lists every owned tile; the later passes only walk that list, in map order as before)
  comp.fill(-1);
  let nc = 0, sp = 0, m = 0;
  const stack = netStack, owned = netOwned;
  for (let s0 = 0; s0 < N; s0++) {
    if (!owner[s0] || comp[s0] >= 0) continue;
    comp[s0] = nc; stack[sp++] = s0;
    while (sp) {
      const i = stack[--sp], x = i % W;
      owned[m++] = i;
      let n;
      if (x > 0 && owner[n = i - 1] && comp[n] < 0) { comp[n] = nc; stack[sp++] = n; }
      if (x < W - 1 && owner[n = i + 1] && comp[n] < 0) { comp[n] = nc; stack[sp++] = n; }
      if (i >= W && owner[n = i - W] && comp[n] < 0) { comp[n] = nc; stack[sp++] = n; }
      if (i < N - W && owner[n = i + W] && comp[n] < 0) { comp[n] = nc; stack[sp++] = n; }
      if (bridgeEnd[i]) for (const n of bridgeEndsOf(i)) if (owner[n] && comp[n] < 0) { comp[n] = nc; stack[sp++] = n; }   // over a bridge
    }
    nc++;
  }
  const tiles = owned.subarray(0, m).sort();
  // 2) each piece is one country: whichever owns most of it. Countries that now share a piece merge.
  const tally = Array.from({ length: nc }, () => new Map()), live = new Map();
  for (let q = 0; q < m; q++) {
    const i = tiles[q], id = countryOf[i];
    let k = live.get(id);
    if (k === undefined) { const c = liveCountry(id); k = c ? c.id : -1; live.set(id, k); }
    const t = tally[comp[i]];
    t.set(k, (t.get(k) || 0) + 1);
  }
  const pieceCountry = new Int32Array(nc);
  for (let pc = 0; pc < nc; pc++) {
    let best = -1, bestN = -1;
    for (const [k, n] of tally[pc]) if (k >= 0 && (n > bestN || (k === 0 && n === bestN))) { best = k; bestN = n; }
    if (best < 0) best = newCountry().id;
    for (const [k] of tally[pc]) if (k >= 0 && k !== best && game.countries[k].alive) mergeCountry(game.countries[k], game.countries[best]);
    pieceCountry[pc] = best;
  }
  // 3) relabel tiles and recount every country
  for (const c of game.countries) resetTileStats(c);
  for (let q = 0; q < m; q++) {
    const i = tiles[q], c = game.countries[pieceCountry[comp[i]]];
    countryOf[i] = c.id;
    addTileStats(c, i);
  }
  landFull = true;                                 // tiles may have changed country: the land recompute starts over
  game.netDirty = false;
  if (game.started) for (const c of game.countries) {
    if (!c.alive || c.tiles) continue;               // every tile of it was taken
    c.alive = false; c.people = 0;
    toast(`${c.full} has fallen!`, { alert: true, at: isFinite(c.box[0]) ? [(c.box[0] + c.box[2]) / 2 + 0.5, (c.box[1] + c.box[3]) / 2 + 0.5] : null });
  }
  if (game.started && !game.over && !game.countries.some(c => c.alive)) {
    game.over = true; game.driving = null; game.aiming = false;
    toast(`Your last country has fallen. ${say('Press N', 'Tap New map in the Build menu')} to start a new map.`, { alert: true, sticky: true });
  }
  recomputeBuildings();
}

// everything that depends on buildings (housing, power, workers, collectors, titles, nation housing).
// Only loops the buildings and deposits, so it's cheap enough to run whenever something changes.
// ---------- roads: drawn between neighbouring settlements of the same country, with trucks on them ----------
let roads = [], roadsDirty = true, roadsAt = -9;
// A road runs along the grid: straight, a right-angle turn, straight again. Two turns (a Z) when the two
// settlements are well off each other's axes, one (an L) otherwise. It tries each shape and takes the first
// that stays on the country's own land the whole way.
function roadPath(ax, ay, bx, by, side) {
  const dx = bx - ax, dy = by - ay, mx = Math.round((ax + bx) / 2), my = Math.round((ay + by) / 2);
  const L1 = [[ax, ay], [bx, ay], [bx, by]], L2 = [[ax, ay], [ax, by], [bx, by]];
  const Z1 = [[ax, ay], [mx, ay], [mx, by], [bx, by]], Z2 = [[ax, ay], [ax, my], [bx, my], [bx, by]];
  const wide = Math.abs(dx) >= Math.abs(dy), diagonal = Math.min(Math.abs(dx), Math.abs(dy)) > 5;
  const order = diagonal ? (wide ? [Z1, Z2, L1, L2] : [Z2, Z1, L2, L1]) : (wide ? [L1, L2, Z1, Z2] : [L2, L1, Z2, Z1]);
  for (const pts of order) {
    let ok = true;
    for (let k = 0; k + 1 < pts.length && ok; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], n = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      for (let e = 0; e <= n && ok; e++) {
        const t = idx(x0 + Math.sign(x1 - x0) * e, y0 + Math.sign(y1 - y0) * e);
        if (sideOf(t) !== side || !isLand(t)) ok = false;
      }
    }
    if (ok) return pts.filter((q, k) => k === 0 || q[0] !== pts[k - 1][0] || q[1] !== pts[k - 1][1]);
  }
  return null;
}
function buildRoads() {
  const S = game.buildings.filter(b => b.type === 'settlement' && sideOf(b.i));
  const pos = S.map(b => [b.i % W, (b.i / W) | 0, sideOf(b.i)]);
  const seen = new Set();
  roads = [];
  S.forEach((b, k) => {
    const near = [];
    for (let j = 0; j < S.length; j++) {
      if (j === k || pos[j][2] !== pos[k][2]) continue;
      const d = Math.hypot(pos[j][0] - pos[k][0], pos[j][1] - pos[k][1]);
      if (d <= CFG.roadMax) near.push({ j, d });
    }
    near.sort((p, q) => p.d - q.d);
    let made = 0;
    for (const { j } of near) {
      if (made >= CFG.roadLinks) break;
      const key = k < j ? k + ':' + j : j + ':' + k;
      if (seen.has(key)) { made++; continue; }
      const pts = roadPath(pos[k][0], pos[k][1], pos[j][0], pos[j][1], pos[k][2]);
      if (!pts) continue;
      seen.add(key); made++;
      const at = [0];                              // distance along the road at each corner
      for (let q = 1; q < pts.length; q++) at.push(at[q - 1] + Math.abs(pts[q][0] - pts[q - 1][0]) + Math.abs(pts[q][1] - pts[q - 1][1]));
      roads.push({ pts, at, len: at[at.length - 1], mine: pos[k][2] > 0, ph: hash2(b.i % 9973, S[j].i % 9973, 81) });
    }
  });
  roadsDirty = false; roadsAt = game.time;
}
function drawRoads(z) {
  if (roadsDirty && Math.abs(game.time - roadsAt) > 1) buildRoads();   // at most once a second, however fast the border moves
  if (z < 1) return;
  const w = Math.max(1.3, z * 0.22);
  ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
  for (const pass of [0, 1]) {                    // a dark edge first, then the pale road on top
    ctx.beginPath();
    for (const r of roads) r.pts.forEach((q, k) => { const [sx, sy] = toScreen(q[0] + 0.5, q[1] + 0.5); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.strokeStyle = pass ? 'rgba(216,200,160,0.92)' : 'rgba(50,42,30,0.55)'; ctx.lineWidth = pass ? w : w + 1.6; ctx.stroke();
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  if (z < 1.8) return;
  for (const r of roads) {                        // trucks shuttling back and forth, turning at the corners
    if (r.len < 1) continue;
    const n = r.len > 22 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const u = (game.time * CFG.truckSpeed / r.len + r.ph + k / n) % 2, back = u >= 1, d = (back ? 2 - u : u) * r.len;
      let q = 1;
      while (q < r.at.length - 1 && r.at[q] < d) q++;
      const [x0, y0] = r.pts[q - 1], [x1, y1] = r.pts[q], f = (d - r.at[q - 1]) / Math.max(1e-6, r.at[q] - r.at[q - 1]);
      const [sx, sy] = toScreen(lerp(x0, x1, f) + 0.5, lerp(y0, y1, f) + 0.5);
      if (sx < -20 || sy < -20 || sx > cw + 20 || sy > ch + 20) continue;
      if (z >= CFG.detailZoom && RAS.truck) {
        const a = Math.atan2(y1 - y0, x1 - x0) + (back ? Math.PI : 0), size = z * 1.15;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(a); if (Math.cos(a) < -0.5) ctx.scale(1, -1);
        ctx.drawImage(RAS.truck[1], -size / 2, -size / 2, size, size); ctx.restore();
      } else {
        const p = Math.max(2, z * 0.42);
        ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fillRect(sx - p / 2 - 0.5, sy - p / 2 - 0.5, p + 1, p + 1);
        ctx.fillStyle = r.mine ? '#f2c14e' : '#ffffff'; ctx.fillRect(sx - p / 2, sy - p / 2, p, p);
      }
    }
  }
}

// ---------- rockets: each launch pad assembles one from iron, then fuels it ----------
const rocketState = b => !b.rocket ? 'none' : b.rocket.iron < CFG.rocket.iron ? 'building' : b.rocket.fuel < CFG.rocket.tank - 0.01 ? 'fuelling' : 'ready';
function stepRockets(c, dt) {
  const R = CFG.rocket;
  let ironUse = 0, fuelUse = 0;
  // the ice drills pump straight into the rockets being fuelled, as fast as their power lets them: more drills,
  // faster fuelling. Several rockets fuelling at once share it. No rocket to fuel: the drills wait.
  const fuelling = c.pw.padList.filter(b => !b.paused && b.rocket && b.rocket.iron >= R.iron && b.rocket.fuel < R.tank).length;
  const pumping = fuelling ? c.pw.drills * CFG.buildings.drill.fuel * (c.sat ?? 1) : 0;
  const perPad = fuelling ? pumping / fuelling : 0;
  for (const b of c.pw.padList) {
    b.useIron = 0; b.useFuel = 0;                  // what it's taking right now, for its card
    if (b.paused) continue;
    if (!b.rocket) {                               // no rocket: build one at once, as soon as the country can pay for it
      if (c.res.iron - R.iron < R.ironReserve) continue;
      c.res.iron -= R.iron; ironUse += R.iron;
      b.rocket = { iron: R.iron, fuel: 0 };
      floatText(b.i % W + 0.5, ((b.i / W) | 0) - 1.5, `Rocket built: -${R.iron} iron`, '#f2c14e');
    }
    const k = b.rocket;
    if (k.iron < R.iron) k.iron = R.iron;          // a half-built rocket from an older save: finish it
    if (k.fuel < R.tank) {                         // built: the drills fill it
      const take = Math.max(0, Math.min(perPad * dt, R.tank - k.fuel));
      k.fuel += take; fuelUse += take; b.useFuel = dt > 0 ? take / dt : 0;
      if (k.fuel >= R.tank - 1e-6) { k.fuel = R.tank; floatText(b.i % W + 0.5, ((b.i / W) | 0) - 1.5, b.supply ? 'Supply rocket ready' : 'Rocket ready', '#f2c14e'); }
    }
    if (b.supply && k.fuel >= R.tank - 1e-6) {     // supplying a station: up it goes, by itself
      const st = stationByN(b.supply);
      if (!st) b.supply = null; else launchSupply(b, c, st);
    }
  }
  c.rocketIron = ironUse;                         // (paid in one go, so it isn't a rate for the top bar)
  // the top bar's FUEL: what's in the rockets on the pads, out of what they hold, and how fast it's going in
  c.store.fuel = c.pw.pads * R.tank;
  c.res.fuel = c.pw.padList.reduce((a, b) => a + (b.rocket ? b.rocket.fuel : 0), 0);
  c.rates.fuel = dt > 0 ? fuelUse / dt : 0;
  c.fuelFlow = fuelUse > 0;                        // fuel moving in the pipes right now (the drills pound, the pipes flow)
}
// ---------- rocket flight: real thrust, mass, gravity and air ----------
// Launch from a ready pad. The rocket starts pointing straight out from the middle of the world, and lifts off
// once the engine pushes harder than gravity pulls. Coming back down inside the rim, falling, is a crash.
function launchRocket(b) {
  const x = b.i % W + 0.5, y = ((b.i / W) | 0) + 0.5;
  const f = { x, y, vx: 0, vy: 0, a: Math.atan2(y - DISK.cy, x - DISK.cx), fuel: b.rocket.fuel, throttle: 1, engine: false,
    landed: true, left: false, orbit: false, t: 0, trail: [[x, y]], n: ++rocketCount };
  f.pad = b.i; f.home = countryAt(b.i) ? countryAt(b.i).id : null;
  b.rocket = null;
  game.flights.push(f);
  takeRocket(f);
  toast(say('Rocket on the pad. Space: engine on / off · E / Q: throttle up / down · A / D: turn · Esc: let go',
    'Rocket on the pad. Engine on starts it, ▲ ▼ set the throttle, ◀ ▶ turn. Let go leaves it flying.'));
}
let rocketCount = 0;
// Space (or the Engine button): light the engine at the throttle setting, or cut it
function toggleEngine(f) {
  f.engine = !f.engine;
  if (f.engine && f.throttle < 0.05) f.throttle = 1;   // lit with the throttle closed: open it, or nothing happens
  if (f.engine && f.fuel <= 0) toast('No fuel left: the engine has nothing to burn');
}
function takeRocket(f) {
  stopFollow(); cam.anim = null;
  game.driving = null; game.flying = f;
  setTool(null); setAiming(false);
  if (cam.zoom > 6) cam.zoom = 6;
}
function gravityAt(x, y) {
  const F = CFG.rocket.flight, R = DISK.R, dx = x - DISK.cx, dy = y - DISK.cy, r = Math.max(1e-6, Math.hypot(dx, dy));
  const g = r >= R ? F.mu / (r * r) : F.mu * r / (R * R * R);
  return [-dx / r * g, -dy / r * g, r];
}
const airAt = r => { const F = CFG.rocket.flight; return r <= DISK.R ? 1 : r >= DISK.R + F.atm ? 0 : Math.exp(-(r - DISK.R) / F.scaleH); };
const rocketMass = f => CFG.rocket.flight.dry + CFG.rocket.flight.wet * f.fuel / CFG.rocket.tank;
// the shape of the path you're on (gravity alone): periapsis and apoapsis as distances from the middle
function orbitOf(x, y, vx, vy) {
  const mu = CFG.rocket.flight.mu, dx = x - DISK.cx, dy = y - DISK.cy, r = Math.hypot(dx, dy), v2 = vx * vx + vy * vy;
  const eps = v2 / 2 - mu / r, h = dx * vy - dy * vx, rv = dx * vx + dy * vy;
  const ex = ((v2 - mu / r) * dx - rv * vx) / mu, ey = ((v2 - mu / r) * dy - rv * vy) / mu, e = Math.hypot(ex, ey);
  const pe = h * h / mu / (1 + e);
  if (eps >= 0) return { escape: true, pe, e, ex, ey };
  const a = -mu / (2 * eps);
  return { escape: false, pe, ap: a * (1 + e), e, ex, ey, period: 2 * Math.PI * Math.sqrt(a * a * a / mu) };
}
function stepFlight(f, dt) {
  const F = CFG.rocket.flight, on = game.flying === f && !menuOpen;
  const key = (...ks) => on && ks.some(k => keys.has(k));
  if (key('shift')) f.throttle = 1;
  if (key('e', 'w', 'arrowup')) f.throttle = Math.min(1, f.throttle + F.throttleRate * dt);
  if (key('q', 's', 'arrowdown')) f.throttle = Math.max(0, f.throttle - F.throttleRate * dt);
  f.a += ((key('d', 'arrowright') ? 1 : 0) - (key('a', 'arrowleft') ? 1 : 0)) * F.turn * dt;
  const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n, tank = CFG.rocket.tank;
  for (let k = 0; k < n && !f.done; k++) {
    const m = rocketMass(f);
    let thrust = f.fuel > 0 && f.engine ? F.thrust * f.throttle : 0;
    const burn = thrust / F.ve / F.wet * tank * h;             // fuel thrown out: mass flow = thrust / exhaust speed
    if (burn > f.fuel) { thrust *= f.fuel / burn; f.fuel = 0; } else f.fuel -= burn;
    f.burning = thrust > 0;
    const [gx, gy, r] = gravityAt(f.x, f.y);
    if (f.landed) {                                            // on the pad until the engine out-pulls gravity
      if (thrust / m <= Math.hypot(gx, gy)) continue;
      f.landed = false;
    }
    let ax = gx + Math.cos(f.a) * thrust / m, ay = gy + Math.sin(f.a) * thrust / m;
    const v = Math.hypot(f.vx, f.vy), air = airAt(r);
    if (air > 0 && v > 0) { const d = F.drag * air * v / m; ax -= f.vx * d; ay -= f.vy * d; }
    f.vx += ax * h; f.vy += ay * h;                            // semi-implicit Euler: orbits stay closed
    f.x += f.vx * h; f.y += f.vy * h;
    f.t += h;
    const r2 = Math.hypot(f.x - DISK.cx, f.y - DISK.cy), vr = ((f.x - DISK.cx) * f.vx + (f.y - DISK.cy) * f.vy) / r2;
    if (r2 > DISK.R) f.left = true;
    if (r2 < DISK.R && f.t > 1.5 && vr < -2) return crashRocket(f);
    if (r2 > DISK.R * F.lost) { endFlight(f); toast('The rocket drifted off into deep space.'); return; }
  }
  if (f.landed) return;
  const last = f.trail[f.trail.length - 1];
  if (Math.hypot(f.x - last[0], f.y - last[1]) > 3) { f.trail.push([f.x, f.y]); if (f.trail.length > 1500) f.trail.shift(); }
  const o = orbitOf(f.x, f.y, f.vx, f.vy), r = Math.hypot(f.x - DISK.cx, f.y - DISK.cy), safe = DISK.R + F.atm;
  const inOrbit = !o.escape && r > safe && o.pe > safe;
  if (inOrbit && !f.orbit) {
    f.orbit = true;
    if (!f.everOrbit) { f.everOrbit = true; floatText(f.x, f.y - 6, 'IN ORBIT!', '#f2c14e'); toast(`Rocket ${f.n} is in orbit: ${Math.round(o.pe - DISK.R)} to ${Math.round(o.ap - DISK.R)} tiles above the rim, once round every ${Math.round(o.period)} s.`); }
  } else if (!inOrbit) f.orbit = false;
}
function crashRocket(f) {
  const i = idx(clamp(Math.floor(f.x), 0, W - 1), clamp(Math.floor(f.y), 0, H - 1));
  floatText(f.x, f.y, 'Rocket lost', '#ff7a6b');
  toast(`Rocket ${f.n} came back down ${biome[i] === OCEAN ? 'into the ocean' : 'on the land'} and was lost.`);
  game.blasts.push({ x: f.x, y: f.y, t: 0, R: 2.5, life: 1.1, big: false, seed: (f.x * 31 + f.y * 17) | 0 });   // a fireball where it came down
  endFlight(f);
}
function endFlight(f) {
  f.done = true;
  if (game.flying === f) game.flying = null;
}
// where a rocket is drawn: carried on between sim steps at its own speed, so it glides
const shownFlight = f => f.landed || f.done ? [f.x, f.y] : [f.x + f.vx * lead, f.y + f.vy * lead];
function flightStatus(f) {
  const F = CFG.rocket.flight, r = Math.hypot(f.x - DISK.cx, f.y - DISK.cy), o = orbitOf(f.x, f.y, f.vx, f.vy);
  if (f.landed) return 'On the pad';
  if (f.orbit) return 'In orbit';
  if (o.escape) return 'Escaping the world';
  if (r <= DISK.R) return 'Climbing over the disk';
  if (r < DISK.R + F.atm) return 'In the upper air';
  return o.pe < DISK.R ? 'Falling back' : 'Coasting';
}
// the path ahead (gravity and air, engine off) as a dotted line, until it lands, leaves, or comes round once
function predictPath(f) {
  const pts = [], h = 0.2;
  let x = f.x, y = f.y, vx = f.vx, vy = f.vy, ang = 0, prev = Math.atan2(y - DISK.cy, x - DISK.cx);
  const m = rocketMass(f), F = CFG.rocket.flight;
  for (let k = 0; k < 2500; k++) {
    const [gx, gy, r] = gravityAt(x, y), air = airAt(r), v = Math.hypot(vx, vy);
    let ax = gx, ay = gy;
    if (air > 0 && v > 0) { const d = F.drag * air * v / m; ax -= vx * d; ay -= vy * d; }
    vx += ax * h; vy += ay * h; x += vx * h; y += vy * h;
    if (k % 3 === 0) pts.push([x, y]);
    const a = Math.atan2(y - DISK.cy, x - DISK.cx);
    let da = a - prev; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    ang += da; prev = a;
    const r2 = Math.hypot(x - DISK.cx, y - DISK.cy);
    if (r2 < DISK.R && ((x - DISK.cx) * vx + (y - DISK.cy) * vy) < 0 && k > 5) return { pts, end: 'crash' };
    if (Math.abs(ang) > 2 * Math.PI) return { pts, end: 'loop' };
    if (r2 > DISK.R * 12) return { pts, end: 'away' };
  }
  return { pts, end: 'more' };
}
// the air: a thin blue halo round the rim, fading out where the air ends
function drawAtmosphere(z) {
  const F = CFG.rocket.flight, [sx, sy] = toScreen(DISK.cx, DISK.cy), R = DISK.R * z, A = (DISK.R + F.atm) * z;
  if (A - R < 3) return;
  const g = ctx.createRadialGradient(sx, sy, R, sx, sy, A);
  g.addColorStop(0, 'rgba(150,200,255,0.30)'); g.addColorStop(0.3, 'rgba(130,180,255,0.12)'); g.addColorStop(1, 'rgba(110,160,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, A, 0, Math.PI * 2); ctx.arc(sx, sy, R, 0, Math.PI * 2, true); ctx.fill('evenodd');
}
function drawFlights(z) {
  for (const f of game.flights) {
    if (f.done) continue;
    const mine = game.flying === f;
    if (f.trail.length > 1) {                       // where it has been
      ctx.beginPath();
      f.trail.forEach((q, k) => { const [sx, sy] = toScreen(q[0], q[1]); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      const [ex, ey] = toScreen(...shownFlight(f)); ctx.lineTo(ex, ey);
      ctx.strokeStyle = mine ? 'rgba(242,193,78,0.55)' : 'rgba(242,193,78,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (!f.landed && (mine || f.orbit)) {          // where it is going: a dotted line
      const P = predictPath(f);
      ctx.fillStyle = P.end === 'crash' ? 'rgba(255,122,107,0.85)' : mine ? 'rgba(200,230,255,0.85)' : 'rgba(200,230,255,0.35)';
      const dot = mine ? 2 : 1.4;
      for (let k = 0; k < P.pts.length; k += 2) { const [sx, sy] = toScreen(P.pts[k][0], P.pts[k][1]); ctx.fillRect(sx - dot / 2, sy - dot / 2, dot, dot); }
      if (P.end === 'crash' && P.pts.length) {      // an X where it would come down
        const [cx, cy] = toScreen(...P.pts[P.pts.length - 1]);
        ctx.strokeStyle = '#ff7a6b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke();
      }
      const o = orbitOf(f.x, f.y, f.vx, f.vy);
      if (mine && o.e > 0.02 && Math.hypot(f.x - DISK.cx, f.y - DISK.cy) > DISK.R) {   // mark the high and low points
        const ux = o.ex / o.e, uy = o.ey / o.e;
        const marks = [['Pe', o.pe, 1]];
        if (!o.escape) marks.push(['Ap', o.ap, -1]);
        for (const [lbl, d, sgn] of marks) {
          const [mx, my] = toScreen(DISK.cx + ux * d * sgn, DISK.cy + uy * d * sgn);
          if (mx < -40 || my < -40 || mx > cw + 40 || my > ch + 40) continue;
          ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.arc(mx, my, 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.font = "600 11px 'Segoe UI', Arial, sans-serif"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,6,12,0.85)';
          const txt = `${lbl} ${Math.round(d - DISK.R)}`;
          ctx.strokeText(txt, mx + 6, my); ctx.fillStyle = '#fff'; ctx.fillText(txt, mx + 6, my);
        }
      }
    }
    const [sx, sy] = toScreen(...shownFlight(f)), size = clamp(z * 2.4, 18, 64), rot = f.a + Math.PI / 2 + (cam.rot || 0);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot);
    if (f.burning) {                                // the exhaust: longer with more throttle, flickering
      const L = size * (0.35 + 0.7 * f.throttle) * (0.85 + 0.3 * Math.random());
      const g = ctx.createLinearGradient(0, size * 0.4, 0, size * 0.4 + L);
      g.addColorStop(0, 'rgba(255,240,180,0.95)'); g.addColorStop(0.4, 'rgba(255,150,50,0.8)'); g.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-size * 0.12, size * 0.4); ctx.lineTo(size * 0.12, size * 0.4); ctx.lineTo(0, size * 0.4 + L); ctx.closePath(); ctx.fill();
    }
    if (RAS.rocket) ctx.drawImage(RAS.rocket[size * dpr > 44 ? 0 : 1], -size / 2, -size / 2, size, size);
    ctx.restore();
    if (mine) { ctx.strokeStyle = 'rgba(242,193,78,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx, sy, size * 0.75, 0, Math.PI * 2); ctx.stroke(); }
  }
}
// ---------- space stations ----------
// A rocket in orbit becomes a station: it keeps that orbit, houses people and stores goods, and the pad that
// launched it keeps it supplied (see launchSupply).
let stationCount = 0;
const stationCap = st => CFG.station.cap * st.level;
const shownOrbit = st => [st.x + st.vx * lead, st.y + st.vy * lead];
function makeStation(f) {
  if (!f || !f.orbit) return toast('Get the rocket into a stable orbit first (periapsis above the air)');
  let home = liveCountry(f.home ?? -1), pad = f.pad != null ? buildingAt(f.pad) : null;
  if (!home) home = activeCountry();
  if (!pad || pad.type !== 'pad' || countryAt(pad.i) !== home) pad = game.buildings.find(b => b.type === 'pad' && countryAt(b.i) === home) || null;
  const st = { orbital: true, n: ++stationCount, x: f.x, y: f.y, vx: f.vx, vy: f.vy, home: home ? home.id : null, pad: pad ? pad.i : null,
    people: 0, level: 1, res: { wood: 0, stone: 0, iron: 0 }, runs: 0, a: 0 };
  game.orbitals.push(st);
  endFlight(f);
  if (pad) pad.supply = st.n;
  floatText(st.x, st.y - 6, `Station ${st.n}!`, '#f2c14e');
  toast(`Rocket ${f.n} is now Space Station ${st.n}.${pad ? ` ${home.short}'s launch pad will keep it supplied: every rocket it fuels flies up with people and goods.` : ' Build a launch pad to supply it.'}`);
  rideWith(st);
  inspect(st);
}
// a station just orbits: gravity only (it is above the air)
function stepOrbit(st, dt) {
  const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
  for (let k = 0; k < n; k++) {
    const [gx, gy] = gravityAt(st.x, st.y);
    st.vx += gx * h; st.vy += gy * h; st.x += st.vx * h; st.y += st.vy * h;
  }
  st.a += dt * 0.25;
}
const stationByN = n => game.orbitals.find(st => st.n === n);
// people and goods on their way up to a station
function incomingStation(st) {
  const inc = { people: 0, wood: 0, stone: 0, iron: 0 };
  for (const r of game.supplyRuns) if (r.st === st.n) for (const k in inc) inc[k] += r.cargo[k] || 0;
  return inc;
}
// a pad supplying a station sends its fuelled rocket up by itself, loaded with what home can spare
function launchSupply(b, c, st) {
  const S = CFG.station, inc = incomingStation(st), cargo = { people: 0, wood: 0, stone: 0, iron: 0 };
  cargo.people = Math.floor(Math.max(0, Math.min(S.people, c.people - crewOf(c), stationCap(st) - st.people - inc.people)));
  for (const r of ['wood', 'stone', 'iron']) cargo[r] = Math.floor(Math.max(0, Math.min(S.each, c.res[r] - S.keep)));
  if (!(cargo.people + cargo.wood + cargo.stone + cargo.iron)) return false;   // nothing to send yet: the rocket waits
  c.people -= cargo.people;
  for (const r of ['wood', 'stone', 'iron']) c.res[r] -= cargo[r];
  const [fx, fy] = tileCenter(b.i);
  game.supplyRuns.push({ st: st.n, t: 0, T: S.trip, fx, fy, cargo });
  b.rocket = null;                                 // the next one is built (and fuelled) for the next run
  floatText(fx, fy - 1.5, `Supply rocket to Station ${st.n}`, '#f2c14e');
  return true;
}
function stepSupplyRuns(dt) {
  for (const r of game.supplyRuns) {
    r.t += dt;
    if (r.t < r.T) continue;
    r.done = true;
    const st = stationByN(r.st);
    if (!st) continue;                             // its station is gone: lost
    st.people += r.cargo.people;
    for (const k of ['wood', 'stone', 'iron']) st.res[k] += r.cargo[k];
    st.runs++;
    floatText(st.x, st.y - 4, `+${listRes(r.cargo) || 'supplies'}`, '#7bd389');
  }
  if (game.supplyRuns.some(r => r.done)) game.supplyRuns = game.supplyRuns.filter(r => !r.done);
}
function expandStation(st) {
  const E = CFG.station.expand, miss = Object.keys(E).find(r => st.res[r] < E[r]);
  if (miss) return toast(`Station ${st.n} needs ${E[miss]} ${miss} in its stock to expand: supply rockets bring it`);
  for (const r in E) st.res[r] -= E[r];
  st.level++;
  floatText(st.x, st.y - 5, `Station ${st.n}: room for ${stationCap(st)}`, '#f2c14e');
}
// where a supply rocket is: from its pad up to the station, bowing out from the world on the way
function supplyPos(r) {
  const st = stationByN(r.st), u = clamp((r.t + lead) / r.T, 0, 1), e = u * u * (3 - 2 * u);
  const [tx, ty] = st ? shownOrbit(st) : [r.fx, r.fy];
  let x = lerp(r.fx, tx, e), y = lerp(r.fy, ty, e);
  const dx = x - DISK.cx, dy = y - DISK.cy, d = Math.hypot(dx, dy) || 1, bow = Math.sin(Math.PI * u) * 60;
  x += dx / d * bow; y += dy / d * bow;
  return [x, y];
}
function drawStations(z) {
  for (const r of game.supplyRuns) {               // supply rockets climbing to their station
    const [x, y] = supplyPos(r), r2 = { ...r, t: r.t + 0.05 }, [x2, y2] = supplyPos(r2);
    const [sx, sy] = toScreen(x, y), size = clamp(z * 1.8, 12, 40), rot = Math.atan2(y2 - y, x2 - x) + Math.PI / 2 + (cam.rot || 0);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot);
    const L = size * (0.6 + 0.2 * Math.random());
    const g = ctx.createLinearGradient(0, size * 0.4, 0, size * 0.4 + L);
    g.addColorStop(0, 'rgba(255,240,180,0.95)'); g.addColorStop(0.5, 'rgba(255,150,50,0.7)'); g.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-size * 0.1, size * 0.4); ctx.lineTo(size * 0.1, size * 0.4); ctx.lineTo(0, size * 0.4 + L); ctx.closePath(); ctx.fill();
    if (RAS.rocket) ctx.drawImage(RAS.rocket[size * dpr > 44 ? 0 : 1], -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  for (const st of game.orbitals) drawStation(st, z);
}
// how big a station is drawn (pixels across its ring): bigger as it grows
const stationSize = (st, z) => Math.max(z * 6, 16) * (1 + 0.1 * (st.level - 1));   // ~6 tiles across: zooms with the map
// A space station: solar wings on a long truss, and a spinning habitat ring of lit windows round a central hub.
// Its windows light up as people move in (one in so many per person), so a full station glows.
function drawStation(st, z) {
  const [sx, sy] = toScreen(...shownOrbit(st)), s = stationSize(st, z) / 2;   // s: the ring's radius
  if (sx < -s * 3 || sy < -s * 3 || sx > cw + s * 3 || sy > ch + s * 3) return;
  const fill = clamp(st.people / stationCap(st), 0, 1), lw = Math.max(1, s * 0.03);
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.35 + (cam.rot || 0));
  // the truss and its solar wings (they don't spin); each level adds a module on each side, pushing the wings out
  const out = s * 1.25 + (st.level - 1) * s * 0.34;  // where the wings start
  ctx.fillStyle = '#7d8896'; ctx.fillRect(-out - s * 1.0, -s * 0.05, (out + s * 1.0) * 2, s * 0.1);
  for (const side of [-1, 1]) for (const k of [0, 1]) {
    const x0 = side * (out + k * s * 0.5) - (side < 0 ? s * 0.46 : 0), w = s * 0.46, h = s * 0.62;
    ctx.fillStyle = '#1f4f8c'; ctx.fillRect(x0, -h, w, h * 2);
    ctx.strokeStyle = 'rgba(150,195,255,0.6)'; ctx.lineWidth = Math.max(0.6, lw * 0.5);
    ctx.beginPath();
    for (let q = 1; q < 3; q++) { ctx.moveTo(x0 + q * w / 3, -h); ctx.lineTo(x0 + q * w / 3, h); }
    for (let q = -2; q <= 2; q++) { ctx.moveTo(x0, q * h / 3); ctx.lineTo(x0 + w, q * h / 3); }
    ctx.stroke();
    ctx.strokeStyle = '#0e2442'; ctx.lineWidth = lw; ctx.strokeRect(x0, -h, w, h * 2);
  }
  // extra modules on the truss between the ring and the wings, one pair per level after the first, with windows
  for (let q = 1; q < st.level; q++) for (const side of [-1, 1]) {
    const cx = side * (s * 1.08 + q * s * 0.34), cy = 0;
    ctx.fillStyle = '#d5dbe3'; ctx.strokeStyle = '#4a5562'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.roundRect(cx - s * 0.14, cy - s * 0.12, s * 0.28, s * 0.24, s * 0.07); ctx.fill(); ctx.stroke();
    for (const wx of [-0.07, 0, 0.07]) {
      ctx.fillStyle = fill > (q - 1) / st.level ? '#ffd27a' : '#2a3442';
      ctx.fillRect(cx + wx * s - s * 0.02, cy - s * 0.03, s * 0.04, s * 0.06);
    }
  }
  // the habitat ring, spinning
  ctx.save(); ctx.rotate(st.a);
  for (let q = 0; q < 4; q++) {                    // spokes
    const a = q * Math.PI / 2;
    ctx.strokeStyle = '#8e99a6'; ctx.lineWidth = s * 0.07;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.22); ctx.lineTo(Math.cos(a) * s * 0.86, Math.sin(a) * s * 0.86); ctx.stroke();
  }
  ctx.lineWidth = s * 0.3; ctx.strokeStyle = '#3d4753';                 // the ring: a dark rim, then its hull
  ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = s * 0.24; ctx.strokeStyle = '#dfe4ea';
  ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = s * 0.05; ctx.strokeStyle = '#b9c2cc';                // a seam down the middle
  ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.stroke();
  const N = 24;                                    // windows all the way round: lit ones glow warm
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, lit = ((k * 0.618034) % 1) < fill;
    ctx.save(); ctx.rotate(a); ctx.translate(s, 0);
    if (lit) { ctx.shadowColor = 'rgba(255,200,90,0.9)'; ctx.shadowBlur = s * 0.12; }
    ctx.fillStyle = lit ? '#ffd27a' : '#253041';
    ctx.fillRect(-s * 0.05, -s * 0.045, s * 0.1, s * 0.09);
    ctx.restore();
  }
  ctx.restore();
  // the hub: a pressurised core with a ring of portholes and a docking port
  ctx.fillStyle = '#eef1f5'; ctx.strokeStyle = '#4a5562'; ctx.lineWidth = lw * 1.2;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, lit = fill > 0 && k < Math.ceil(fill * 6);
    ctx.fillStyle = lit ? '#ffd27a' : '#2a3442';
    ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.16, Math.sin(a) * s * 0.16, s * 0.04, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#9aa6b4'; ctx.fillRect(-s * 0.06, -s * 0.06, s * 0.12, s * 0.12);
  ctx.restore();
  if (s > 18) pill(sx, sy + s * 1.35 + 10, `Space Station ${st.n} · ${Math.floor(st.people)} / ${stationCap(st)} people`, { size: 11, dot: '#f2c14e' });
}
function cardStation(st, { row, bar, note, sep, button }) {
  const S = CFG.station, home = liveCountry(st.home ?? -1), pad = st.pad != null ? buildingAt(st.pad) : null, cap = stationCap(st);
  const o = orbitOf(st.x, st.y, st.vx, st.vy), inc = incomingStation(st);
  row('People', `${Math.floor(st.people)} / ${cap}`); bar(st.people / cap);
  if (inc.people) note(`+${inc.people} on the way up`, 'g');
  row('Stock', listRes(st.res, ['wood', 'stone', 'iron']) || 'empty');
  row('Level', `${st.level} · room for ${cap}`);
  const E = S.expand, can = Object.keys(E).every(r => st.res[r] >= E[r]);
  button(`Expand: +${S.cap} room for ${listRes(E, ['stone', 'iron'])}`, 'expand', can);
  if (!can) note('Paid from the station\'s own stock: supply rockets bring it up', 'd');
  sep();
  const supplier = pad && pad.type === 'pad' && pad.supply === st.n ? pad : game.buildings.find(b => b.type === 'pad' && b.supply === st.n && owner[b.i]);
  if (supplier) {
    const k = supplier.rocket, stt = rocketState(supplier);
    row('Supplied by', `${countryAt(supplier.i)?.short || '?'}'s launch pad`);
    row('Next supply rocket', supplier.paused ? 'Pad paused' : stt === 'none' ? 'Pad needs iron' : stt === 'ready' ? 'Loading' : `fuelling ${Math.floor((k ? k.fuel : 0) / CFG.rocket.tank * 100)}%`, supplier.paused || stt === 'none' ? 'r' : '');
    note(`Each brings up to ${S.people} people and ${S.each} wood, stone and iron`);
  } else note('No launch pad is supplying it: click a pad and pick "Supply" on its card', 'r');
  row('Supply runs', `${st.runs}`);
  sep();
  row('Orbit', o.escape ? 'escaping' : `${Math.round(o.pe - DISK.R)} to ${Math.round(o.ap - DISK.R)} above the rim`);
  if (!o.escape) row('Once round', secs(o.period));
  return [`Space Station ${st.n}`, 'rocket', home ? `Above ${home.full}` : 'In orbit'];
}

// the flight readout: shown while you fly
function flightHud() {
  let el = document.getElementById('flight-hud');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flight-hud';
    // a phone: a narrower panel tucked under the top bar, clear of the steering pad at the bottom
    const small = TOUCH || innerWidth < 700;
    el.style.cssText = (small ? 'position:fixed;right:8px;top:calc(var(--top-h, 56px) + 8px);width:172px;padding:7px 9px;font:600 11px "Segoe UI",Arial,sans-serif;line-height:1.45;'
      : 'position:fixed;right:14px;top:50%;transform:translateY(-50%);width:230px;padding:10px 12px;font:600 12px "Segoe UI",Arial,sans-serif;line-height:1.55;') +
      'background:rgba(14,18,26,0.9);border:1px solid rgba(255,255,255,0.14);border-radius:10px;color:#e8edf2;z-index:30;pointer-events:none;display:none';
    document.body.appendChild(el);
    // its button is rebuilt ten times a second, so catch the press itself rather than a click
    el.addEventListener('pointerdown', e => { if (e.target.dataset && e.target.dataset.act === 'station') { e.preventDefault(); makeStation(game.flying); } });
  }
  const f = game.flying;
  if (!f) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const F = CFG.rocket.flight, r = Math.hypot(f.x - DISK.cx, f.y - DISK.cy), o = orbitOf(f.x, f.y, f.vx, f.vy);
  const bar = (v, col) => `<div style="height:6px;background:rgba(255,255,255,0.12);border-radius:3px;margin:2px 0 6px"><div style="height:100%;width:${(clamp(v, 0, 1) * 100).toFixed(0)}%;background:${col};border-radius:3px"></div></div>`;
  const alt = d => `${Math.round(d - DISK.R)}`;
  const st = flightStatus(f), stCol = f.orbit ? '#7be08a' : st === 'Falling back' ? '#ff7a6b' : '#f2c14e';
  const air = airAt(r);
  el.innerHTML = `<div style="font-size:13px;letter-spacing:0.04em">ROCKET ${f.n} · <span style="color:${stCol}">${st.toUpperCase()}</span></div>
    <div style="margin-top:4px">ENGINE <b style="color:${f.engine ? (f.fuel > 0 ? '#ff9a3c' : '#ff7a6b') : '#97a3b6'}">${f.engine ? (f.fuel > 0 ? 'ON' : 'ON · NO FUEL') : 'OFF'}</b></div>
    <div style="opacity:0.7;margin-top:2px">THROTTLE ${Math.round(f.throttle * 100)}%${f.engine ? '' : ' (when on)'}</div>${bar(f.throttle, f.engine ? '#ff9a3c' : 'rgba(255,154,60,0.35)')}
    <div style="opacity:0.7">FUEL ${Math.round(f.fuel)} / ${CFG.rocket.tank}</div>${bar(f.fuel / CFG.rocket.tank, '#5fc4f0')}
    <div>Speed <b>${Math.hypot(f.vx, f.vy).toFixed(1)}</b> tiles/s</div>
    <div>Height <b>${r < DISK.R ? 'over the disk' : alt(r) + ' tiles'}</b>${air > 0.001 ? ` · air ${Math.round(air * 100)}%` : ' · no air'}</div>
    <div>Apoapsis <b>${o.escape ? 'none: escaping' : alt(o.ap)}</b></div>
    <div>Periapsis <b style="color:${o.pe > DISK.R + F.atm ? '#7be08a' : '#ff9a8a'}">${o.pe < DISK.R ? 'under the rim' : alt(o.pe)}</b></div>
    ${f.orbit ? `<button data-act="station" style="pointer-events:auto;margin-top:8px;width:100%;padding:6px;border:1px solid #f2c14e;border-radius:7px;background:rgba(242,193,78,0.15);color:#f2c14e;font:700 12px 'Segoe UI',Arial,sans-serif;cursor:pointer">${TOUCH ? 'Make it a space station' : 'Enter: make it a space station'}</button>` : ''}
    <div style="opacity:0.6;font-size:11px;margin-top:6px">Orbit = periapsis above ${F.atm} (out of the air)<br>${TOUCH ? 'Engine on / off · ▲ ▼ throttle · ◀ ▶ turn · Drive takes it back' : 'Space engine on / off · E / Q throttle up / down · A / D turn · Shift full throttle · Esc let go · X or click it to take it back'}</div>`;
}
function padClick(b) {
  if (rocketState(b) === 'ready' && !b.supply) launchRocket(b); else togglePad(b);
}
function togglePad(b) {
  b.paused = !b.paused;
  const st = rocketState(b);
  toast(b.paused ? 'Launch pad paused: it takes no more iron or fuel' : st === 'ready' ? 'Launch pad resumed: its rocket is ready' : 'Launch pad resumed: building and fuelling its rocket');
}
// the rocket on its pad (detail view): faint while it is being built, with a bar for its iron, then its fuel
function drawRockets(z, x0, y0, x1, y1) {
  for (const b of game.buildings) {
    if (b.type !== 'pad') continue;
    const x = b.i % W, y = (b.i / W) | 0;
    if (x < x0 - 2 || x > x1 + 2 || y < y0 - 3 || y > y1 + 2) continue;
    const R = CFG.rocket, st = rocketState(b);
    if (!b.rocket) {                               // waiting for the iron to build one
      if (z >= CFG.cityZoom && owner[b.i]) {
        const [sx, sy] = toScreen(x + 0.5, y + 1.45), txt = b.paused ? 'Paused' : `Needs ${R.iron} iron`;
        ctx.font = `700 ${Math.round(clamp(z * 0.42, 9, 13))}px 'Segoe UI', Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,6,12,0.85)'; ctx.strokeText(txt, sx, sy);
        ctx.fillStyle = b.paused ? '#c4cad2' : '#e8a77f'; ctx.fillText(txt, sx, sy);
      }
      continue;
    }
    drawSprite('rocket', x + 0.45, y + 0.2, z * 1.5, st === 'building' ? 0.25 + 0.6 * b.rocket.iron / R.iron : 1);
    if (st === 'ready' && !b.paused) continue;
    const [sx, sy] = toScreen(x + 0.5, y + 1.45), w = z * 1.4, h = Math.max(2.5, z * 0.14);
    const f = st === 'building' ? b.rocket.iron / R.iron : b.rocket.fuel / R.tank;
    ctx.fillStyle = 'rgba(20,26,37,0.85)'; ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, h + 2);
    ctx.fillStyle = b.paused ? '#8a9198' : st === 'building' ? '#bd7b56' : '#5fc4f0'; ctx.fillRect(sx - w / 2, sy, w * f, h);
    if (z >= CFG.cityZoom) {                       // say what the bar is: the rocket being built, or its fuel going in
      ctx.font = `700 ${Math.round(clamp(z * 0.42, 9, 13))}px 'Segoe UI', Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const txt = b.paused ? 'Paused' : `${st === 'building' ? 'Building' : 'Fuel'} ${Math.floor(f * 100)}%`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,6,12,0.85)'; ctx.strokeText(txt, sx, sy + h + 3);
      ctx.fillStyle = b.paused ? '#c4cad2' : st === 'building' ? '#e8a77f' : '#8fd8ff'; ctx.fillText(txt, sx, sy + h + 3);
    }
  }
}

// ---------- pipes: every ice drill pipes its fuel to the nearest launch pad in its country ----------
let pipes = [], pipesDirty = true;
function buildPipes() {
  pipes = [];
  const pads = game.buildings.filter(b => b.type === 'pad' && owner[b.i]);
  for (const d of game.buildings) {
    if (d.type !== 'drill' || !owner[d.i]) continue;
    const C = countryAt(d.i), dx = d.i % W, dy = (d.i / W) | 0;
    let best = null, bd = Infinity;
    for (const p of pads) {
      if (countryAt(p.i) !== C) continue;
      const q = Math.hypot(p.i % W - dx, ((p.i / W) | 0) - dy);
      if (q < bd) { bd = q; best = p; }
    }
    if (!best) continue;
    const px = best.i % W, py = (best.i / W) | 0;
    // along the grid like a road where it can stay on the country's own land, else a plain L across whatever is there
    const pts = roadPath(dx, dy, px, py, sideOf(d.i)) || [[dx, dy], [px, dy], [px, py]].filter((q, k, a) => k === 0 || q[0] !== a[k - 1][0] || q[1] !== a[k - 1][1]);
    const at = [0];
    for (let k = 1; k < pts.length; k++) at.push(at[k - 1] + Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]));
    pipes.push({ pts, at, len: at[at.length - 1], c: C, drill: d.i, pad: best.i });
  }
  pipesDirty = false;
}
const pipeOf = i => pipes.find(p => p.drill === i);
function drawPipes(z) {
  if (pipesDirty) buildPipes();
  if (!pipes.length || z < 0.6) return;
  const w = Math.max(1.4, z * 0.3);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {                    // a dark casing, then the steel pipe on top
    ctx.beginPath();
    for (const p of pipes) p.pts.forEach((q, k) => { const [sx, sy] = toScreen(q[0] + 0.5, q[1] + 0.5); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.strokeStyle = pass ? '#b9c6cf' : 'rgba(30,40,52,0.75)'; ctx.lineWidth = pass ? w : w + 2; ctx.stroke();
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
  if (z < 2) return;
  // fuel flowing from the drill to the pad: blue blobs riding the pipe while the drill is filling the tanks
  const gap = 2.5, speed = 3, r = Math.max(1.2, z * 0.13);
  ctx.fillStyle = '#7fd8ff';
  for (const p of pipes) {
    if (!p.c || !p.c.fuelFlow || p.len < 1) continue;
    for (let d = (game.time * speed) % gap; d < p.len; d += gap) {
      let q = 1;
      while (q < p.at.length - 1 && p.at[q] < d) q++;
      const [x0, y0] = p.pts[q - 1], [x1, y1] = p.pts[q], f = (d - p.at[q - 1]) / Math.max(1e-6, p.at[q] - p.at[q - 1]);
      const [sx, sy] = toScreen(lerp(x0, x1, f) + 0.5, lerp(y0, y1, f) + 0.5);
      if (sx < -10 || sy < -10 || sx > cw + 10 || sy > ch + 10) continue;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// ---------- settlements: the land holds the capacity, a settlement unlocks what's in its reach ----------
const servStamp = new Int32Array(N), servD = new Uint16Array(N), servBy = new Int32Array(N);
let servN = 0;
const sideOf = i => (owner[i] ? countryOf[i] + 1 : -aiOf[i]);        // whose land a tile is: +country, -nation, 0 nobody
const landCapAt = i => CFG.landCap[BIOME_KEY[biome[i]]] || 0;
const isServed = i => servStamp[i] === servN;
function eachInReach(i, fn, R = CFG.settlement.reach) {             // every tile within R (a settlement's reach, by default) of tile i
  const cx = i % W, cy = (i / W) | 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 <= R * R && inb(cx + dx, cy + dy)) fn(idx(cx + dx, cy + dy), d2);
  }
}
// Each owned land tile goes to the nearest settlement of the same country (or nation) within reach;
// a settlement's `base` is the capacity of the land it ends up with.
// the tiles within reach R of a tile, as offsets (made once per R): loops over these instead of a
// callback per tile, since recomputeLand runs a few times a second while borders move
const REACH_DISK = new Map();
function reachDisk(R) {
  let D = REACH_DISK.get(R);
  if (D) return D;
  const dx = [], dy = [], d2 = [];
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= R * R) { dx.push(x); dy.push(y); d2.push(x * x + y * y); }
  D = { dx: Int16Array.from(dx), dy: Int16Array.from(dy), d2: Int32Array.from(d2), n: dx.length };
  REACH_DISK.set(R, D);
  return D;
}
// Incremental: paintTerr notes every tile that changed hands (landTouch). recomputeLand then re-assigns only those
// tiles, plus the reach of any settlement that appeared, vanished or changed hands, and re-totals only the
// settlements within reach of that area (found through 32 x 32-tile chunks). The result is the same as a full
// pass, which still runs when countries merge or split (every tile's country can change then), when very many
// tiles changed at once, and every 20 s as a safety net. servBy holds the serving settlement's id (b.sid).
const landStamp = new Uint32Array(N), landTouched = [];
let landGen = 1, landFull = true, landFullAt = -1e9, landPrev = new Map(), settleSid = 0;
const LCH = 32, LCW = Math.ceil(W / LCH), landChunk = new Uint32Array(LCW * Math.ceil(H / LCH));
function landTouch(i) {
  if (landFull || landStamp[i] === landGen) return;
  landStamp[i] = landGen;
  if (landTouched.length < 40000) landTouched.push(i); else landFull = true;
}
function recomputeLand() {
  const S = [], { dx, dy, d2, n } = reachDisk(CFG.settlement.reach), R = CFG.settlement.reach;
  for (const b of game.buildings) if (b.type === 'settlement') { S.push(b); if (!b.sid) b.sid = ++settleSid; }
  if (landFull || game.time - landFullAt > 20 || game.time < landFullAt) {
    servN++;
    for (const b of S) {
      const side = sideOf(b.i), cx = b.i % W, cy = (b.i / W) | 0;
      b.base = 0; b.tiles = 0; b._n = -1;
      if (!side) continue;
      for (let j = 0; j < n; j++) {
        const x = cx + dx[j], y = cy + dy[j];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = y * W + x;
        if (sideOf(t) !== side || !isLand(t)) continue;
        if (servStamp[t] !== servN || d2[j] < servD[t]) { servStamp[t] = servN; servD[t] = d2[j]; servBy[t] = b.sid; }
      }
    }
    landTotals(S, n, dx, dy);
    landFullAt = game.time;
    roadsDirty = true;
  } else {
    const region = landTouched;                    // the touched tiles are already stamped with landGen
    const addDisk = i => {
      const cx = i % W, cy = (i / W) | 0;
      for (let j = 0; j < n; j++) {
        const x = cx + dx[j], y = cy + dy[j];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = y * W + x;
        if (landStamp[t] !== landGen) { landStamp[t] = landGen; region.push(t); }
      }
    };
    const now = new Set();
    for (const b of S) { now.add(b.sid); if (!landPrev.has(b.sid) || b._side !== sideOf(b.i)) addDisk(b.i); }
    for (const [sid, i] of landPrev) if (!now.has(sid)) addDisk(i);
    if (region.length) {
      for (const t of region) { servStamp[t] = 0; landChunk[(((t / W) | 0) / LCH | 0) * LCW + ((t % W) / LCH | 0)] = landGen; }
      const A = [];                                // settlements whose reach overlaps a changed chunk, in the usual order
      for (const b of S) {
        const cx = b.i % W, cy = (b.i / W) | 0;
        const c0 = Math.max(0, cx - R) / LCH | 0, c1 = Math.min(W - 1, cx + R) / LCH | 0, r0 = Math.max(0, cy - R) / LCH | 0, r1 = Math.min(H - 1, cy + R) / LCH | 0;
        let hit = false;
        for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1; c++) if (landChunk[r * LCW + c] === landGen) { hit = true; break; }
        if (hit) A.push(b);
      }
      for (const b of A) {
        const side = sideOf(b.i), cx = b.i % W, cy = (b.i / W) | 0;
        if (!side) continue;
        for (let j = 0; j < n; j++) {
          const x = cx + dx[j], y = cy + dy[j];
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const t = y * W + x;
          if (landStamp[t] !== landGen || sideOf(t) !== side || !isLand(t)) continue;
          if (servStamp[t] !== servN || d2[j] < servD[t]) { servStamp[t] = servN; servD[t] = d2[j]; servBy[t] = b.sid; }
        }
      }
      for (const b of A) { b.base = 0; b.tiles = 0; b._n = -1; }
      landTotals(A, n, dx, dy);
      roadsDirty = true;
    }
  }
  landPrev = new Map();
  for (const b of S) { landPrev.set(b.sid, b.i); b._side = sideOf(b.i); }
  landGen++; landTouched.length = 0; landFull = false;
  game.landDirty = false;
}
// the deposit tiles a country owns, by kind (counted when asked: a walk over every deposit tile on the map)
function ownedDepOf(c) {
  const out = { forest: 0, stone: 0, iron: 0, uranium: 0 };
  for (const d of deposits) for (const t of d.tiles) if (owner[t] && countryOf[t] === c.id) out[d.type]++;
  return out;
}
// add up the land each of these settlements serves
function landTotals(list, n, dx, dy) {
  for (const b of list) {
    const cx = b.i % W, cy = (b.i / W) | 0;
    if (!sideOf(b.i)) continue;
    for (let j = 0; j < n; j++) {
      const x = cx + dx[j], y = cy + dy[j];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const t = y * W + x;
      if (servStamp[t] === servN && servBy[t] === b.sid) { b.base += landCapAt(t); b.tiles++; }
    }
  }
}
// ---------- city levels ----------
// level 1 = Village ... level 6 = Megalopolis (CFG.settlement.levels). The level is the name.
const CITY_MAX = () => CFG.settlement.levels.length;
const cityLevel = b => clamp(b.up || 1, 1, CITY_MAX());
const levelDef = lvl => CFG.settlement.levels[clamp(lvl, 1, CITY_MAX()) - 1];
const settlementLevel = b => cityLevel(b) - 1;     // index into CFG.settlement.levels
const cityName = b => levelDef(cityLevel(b)).name;
const unpoweredHousing = lvl => Math.min(levelDef(lvl).housing, CFG.settlement.unpowered);
const poweredHousing = lvl => Math.max(0, levelDef(lvl).housing - CFG.settlement.unpowered);   // only fills with power
const zoneOf = b => levelDef(cityLevel(b)).zone;
// going from `lvl` to lvl + 1: { add: housing added, pow: how much of it runs on power, cost }, or null at the top
function upgradeStep(lvl) {
  if (lvl >= CITY_MAX()) return null;
  const a = levelDef(lvl), b = levelDef(lvl + 1);
  return { add: b.housing - a.housing, pow: poweredHousing(lvl + 1) - poweredHousing(lvl), cost: b.cost };
}
// how much of its powered housing a country can fill right now (0..1): its cities share the spare power evenly
const poweredShare = c => c && c.pw && c.pw.capPow > 0 ? clamp((c.powCap || 0) / c.pw.capPow, 0, 1) : 0;
// how many people a city houses right now: its unpowered housing, plus the part of the rest its country can power.
// An AI nation's cities count as fully powered.
function settlementCap(b) {
  const lvl = cityLevel(b);
  if (!owner[b.i]) return levelDef(lvl).housing;
  return unpoweredHousing(lvl) + poweredHousing(lvl) * poweredShare(countryAt(b.i));
}
// the people a city may not be shelled below (only troops finish it)
const shellFloor = b => CFG.settlement.shellFloor * settlementCap(b);
// one of your cities within `snap` tiles of tile i (the nearest), for the settlement tool to upgrade
function upgradeTargetAt(i) {
  if (i == null || i < 0) return null;
  const R = CFG.settlement.snap, x = i % W, y = (i / W) | 0;
  let best = null, bd = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (!inb(x + dx, y + dy)) continue;
    const j = idx(x + dx, y + dy);
    if (building[j] !== BLD_CODE.settlement || !owner[j]) continue;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = j; }
  }
  return best == null ? null : buildingAt(best);
}
// the nearest city (anyone's) closer to tile i than CFG.settlement.spacing, or null: no new city may go there
function crowdingCity(i) {
  const x = i % W, y = (i / W) | 0, R = CFG.settlement.spacing;
  let best = null, bd = R * R;
  for (const b of game.buildings) {
    if (b.type !== 'settlement' || b.i === i) continue;
    const d = (b.i % W - x) ** 2 + (((b.i / W) | 0) - y) ** 2;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
// raise a city one level: paid by its country (no settlers: its own people fill it)
function upgradeCity(b) {
  const c = countryAt(b.i);
  if (!c || b.type !== 'settlement') return;
  const lvl = cityLevel(b), step = upgradeStep(lvl), S = CFG.settlement;
  if (!step) return toast(`A ${levelDef(lvl).name} is as big as a city gets`);
  if (missingFor(step.cost, c)) return askFor(c, step.cost);   // the rest of the empire ships it in
  for (const [r, n] of Object.entries(step.cost)) c.res[r] -= n;
  noteSpend(c, step.cost);
  b.up = lvl + 1;
  b.bump = game.time;
  const [x, y] = tileCenter(b.i);
  ringBurst(x, y, zoneOf(b), '#f2c14e');
  for (let j = 0; j < 8; j++) {
    const a = j / 8 * Math.PI * 2;
    addSmoke(x, y + 0.3, 0, 0, false, { vx: Math.cos(a) * 0.9, vy: Math.sin(a) * 0.55, life: 0.9, size: 0.8, rise: 1.5 });
  }
  recomputeBuildings();
  const mw = step.pow / S.perMW;
  floatText(x, y - 2, `Now a ${cityName(b)}: +${fmtNum(step.add)} homes${mw > 0 ? `, ${fmtNum(step.pow)} of them on ${fmtNum(mw)} MW` : ''}`, '#f2c14e');
  if (mw > 0) {
    const spare = c.mw ? Math.max(0, c.mw.max - c.mw.need) : 0;
    if (spare < mw * 0.99) toast(`${c.short}'s cities need ${fmtNum(Math.ceil((c.pw.capPow - (c.powCap || 0)) / S.perMW))} MW more power to fill their new housing: build burners or solar there`);
  }
}
// ---------- people live in cities ----------
// Each settlement keeps its own people (b.pop). The country (or nation) total, who.people, is still what most of the
// game spends from and adds to; this keeps the two in step once a tick:
// - people spent or lost from the total come out of every city in proportion to its people;
// - people added to the total (growth, arrivals, troops coming home) move into the cities with room, except cities
//   under fire, which don't regrow;
// - a city holding more than it houses (its power dropped) sends the extra out: they wait in the total, move to a
//   city with room, or die off slowly like any people over the country's housing.
// Whatever hits one city on its own (shells, troops) comes off that city and the total together (hurtCity).
function syncCityPop() {
  const by = new Map();
  for (const b of game.buildings) {
    if (b.type !== 'settlement') continue;
    const w = countryAt(b.i) || nationAt(b.i);
    if (!w) continue;
    let L = by.get(w);
    if (!L) by.set(w, L = []);
    L.push(b);
  }
  for (const [w, L] of by) {
    let sum = 0;
    for (const b of L) { b.pop = Math.min(b.pop || 0, settlementCap(b)); sum += b.pop; }
    const d = w.people - sum;
    if (d < -1e-6) {
      const k = Math.max(0, w.people) / sum;
      for (const b of L) b.pop *= k;
    } else if (d > 1e-6) {
      let room = 0;
      for (const b of L) if (!underFire(b)) room += Math.max(0, settlementCap(b) - b.pop);
      if (room > 0) { const k = Math.min(1, d / room); for (const b of L) if (!underFire(b)) b.pop += Math.max(0, settlementCap(b) - b.pop) * k; }
    }
  }
}
// k people of this city die (shelled, or fighting troops): off the city and its country's total. Returns how many.
function hurtCity(b, k) {
  const w = countryAt(b.i) || nationAt(b.i);
  k = Math.min(k, b.pop || 0);
  if (k <= 0) return 0;
  b.pop -= k;
  if (w) w.people = Math.max(0, w.people - k);
  return k;
}
// a shell or missile hit kills `frac` of the people living there, but never takes the city below its shell floor
const shellCity = (b, frac) => hurtCity(b, Math.min((b.pop || 0) * frac, Math.max(0, (b.pop || 0) - shellFloor(b))));
// the city defending tile i against side `atk` (see sideOf): the nearest city of the tile's owner whose zone covers
// it and that still has people. Its land can't be claimed until they're gone.
function guardAt(i, atk, cities) {
  const side = sideOf(i);
  if (!side || side === atk) return null;
  const x = i % W, y = (i / W) | 0;
  let best = null, bd = Infinity;
  for (const b of cities) {
    if ((b.pop || 0) < 0.5 || sideOf(b.i) !== side) continue;
    const R = zoneOf(b) + 0.5, d = (b.i % W - x) ** 2 + (((b.i / W) | 0) - y) ** 2;
    if (d <= R * R && d < bd) { bd = d; best = b; }
  }
  return best;
}
const allCities = () => game.buildings.filter(b => b.type === 'settlement');
// troops at a city's zone fight its people one for one: up to k on each side fall. Returns how many fell.
// `mine` = the city is yours (so its losses show in red).
function fightCity(b, k, mine) {
  const fell = hurtCity(b, k);
  if (fell <= 0) return 0;
  b.hitAt = game.time;                             // a city being fought doesn't regrow
  if (game.time - (b.hitFx || -9) > 0.35) b.hitFx = game.time;
  b.acc = (b.acc || 0) + fell;
  if (b.pop < 0.5 || (b.acc >= 5 && game.time - (b.accAt ?? -9) >= 0.8)) {   // one number every so often, not a pile
    const [x, y] = tileCenter(b.i);
    floatText(x, y - 1.6, b.pop < 0.5 ? 'Defenders gone: the city can be taken' : `-${Math.round(b.acc)} defenders`, mine ? '#ff7a6b' : '#7bd389');
    b.acc = 0; b.accAt = game.time;
  }
  return fell;
}
// hits a building can take (settlements take none: a hit costs them people instead)
const hpOf = () => CFG.hp.other;
// a settlement hit in the last `underFire` seconds: it isn't regrowing
const underFire = b => b.type === 'settlement' && (b.hitAt ?? -Infinity) > game.time - CFG.underFire;
const fireLeft = b => Math.ceil(b.hitAt + CFG.underFire - game.time);
// buildings that fight: what mortars aim at
const isMilitary = b => { const d = CFG.buildings[b.type]; return !!(d.weapon || d.defense || d.gun); };
// what a new settlement on tile i would add: the land in reach that nothing serves yet (and how much is already taken)
function settlementGain(i) {
  const side = sideOf(i);
  let gain = 0, fresh = 0, shared = 0;
  if (side) eachInReach(i, t => {
    if (sideOf(t) !== side || !isLand(t)) return;
    if (isServed(t)) shared++; else { fresh++; gain += landCapAt(t); }
  });
  return { gain, fresh, shared };
}

// ---------- collectors: each works the deposit tiles within its reach ----------
const HARVESTS = { cabin: ['forest'], camp: ['stone', 'iron', 'uranium'], rig: ['forest', 'stone', 'iron', 'uranium'] };
const harvStamp = new Int32Array(N), harvD = new Uint16Array(N), harvBy = new Int32Array(N);
let harvN = 0;
const isHarvested = i => harvStamp[i] === harvN;
// can a collector of this type work tile t? `side` is whose land it stands on (see sideOf): yours or a nation's
const harvestable = (t, side, kinds) => depositOf[t] >= 0 && sideOf(t) === side && kinds.includes(deposits[depositOf[t]].type);
// Every deposit tile goes to the nearest collector that can work it. For your countries the counts land in the
// country's totals (people-run and rig-run separately) and on the collector itself (b.work, for the hover text).
// Nations mine the same way; all that matters for them is how many iron tiles they work.
function recomputeHarvest() {
  harvN++;
  const list = game.buildings.filter(b => HARVESTS[b.type] && sideOf(b.i)), { dx, dy, d2, n } = reachDisk(CFG.collectorReach);
  for (const q of game.nations) q.ironTiles = 0;
  for (let k = 0; k < list.length; k++) {
    const b = list[k], side = sideOf(b.i), kinds = HARVESTS[b.type], cx = b.i % W, cy = (b.i / W) | 0;
    b.work = { forest: 0, stone: 0, iron: 0, uranium: 0 };
    for (let j = 0; j < n; j++) {
      const x = cx + dx[j], y = cy + dy[j];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const t = y * W + x;
      if (!harvestable(t, side, kinds)) continue;
      if (harvStamp[t] !== harvN || d2[j] < harvD[t]) { harvStamp[t] = harvN; harvD[t] = d2[j]; harvBy[t] = k; }
    }
  }
  for (let k = 0; k < list.length; k++) {
    const b = list[k], cx = b.i % W, cy = (b.i / W) | 0;
    const mine = owner[b.i], pw = mine ? game.countries[countryOf[b.i]].pw : null, into = mine ? (b.type === 'rig' ? pw.rigDep : pw.colDep) : null;
    let d1 = 1e9, d2b = 1e9;
    b.spots = [];                                  // the two nearest tiles it works: where its workers stand (not saved)
    for (let j = 0; j < n; j++) {
      const x = cx + dx[j], y = cy + dy[j];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const t = y * W + x;
      if (harvStamp[t] !== harvN || harvBy[t] !== k || depositOf[t] < 0) continue;
      const kind = deposits[depositOf[t]].type;
      if (building[t]) { /* a building stands there (its own, or another): nowhere for a worker to stand */ }
      else if (d2[j] < d1) { d2b = d1; b.spots[1] = b.spots[0]; d1 = d2[j]; b.spots[0] = t; }
      else if (d2[j] < d2b) { d2b = d2[j]; b.spots[1] = t; }
      b.work[kind]++;
      if (mine) into[kind]++; else if (kind === 'iron') game.nations[aiOf[b.i] - 1].ironTiles++;
    }
  }
}
// what a new collector of this type on tile i would work: tiles nobody works yet, by kind, and tiles already taken
function harvestGain(i, type) {
  const side = sideOf(i), kinds = HARVESTS[type], fresh = { forest: 0, stone: 0, iron: 0, uranium: 0 };
  let shared = 0;
  if (side) eachInReach(i, t => {
    if (!harvestable(t, side, kinds)) return;
    if (isHarvested(t)) shared++; else fresh[deposits[depositOf[t]].type]++;
  }, CFG.collectorReach);
  return { fresh, shared };
}

function recomputeBuildings() {
  recomputeLand();
  for (const c of game.countries) { c.capBase = 0; c.ownedDep = { forest: 0, stone: 0, iron: 0, uranium: 0 }; c.pw = newPower(); c.geo.port = 0; }
  for (const b of game.buildings) {
    if (!owner[b.i]) continue;                    // an AI nation's building
    const def = CFG.buildings[b.type], c = game.countries[countryOf[b.i]];
    if (b.type === 'settlement') {               // housing that needs no power, and what its levels add on power
      const lvl = cityLevel(b);
      c.capBase += unpoweredHousing(lvl); c.pw.capPow += poweredHousing(lvl);
      c.pw.cities++; c.pw.cityStore += levelDef(lvl).store;
    }
    if (def.store) for (const r in def.store) c.pw.depot[r] = (c.pw.depot[r] || 0) + def.store[r];
    if (def.use) c.pw.need += def.use;
    if (b.type === 'burner') c.pw.burners++;
    if (b.type === 'solar') c.pw.solar++;
    if (b.type === 'nuclear') c.pw.nukes++;
    if (b.type === 'drill') c.pw.drills++;
    if (b.type === 'pad') { c.pw.pads++; c.pw.padList.push(b); }
    if (def.workers) c.pw.workers += def.workers;
    if (b.type === 'port') c.geo.port++;
  }
  recomputeHarvest();
  pipesDirty = true;
  for (const c of game.countries) { c.powCap = Math.min(c.powCap || 0, c.pw.capPow); c.cap = c.capBase + c.powCap; }
  for (const c of game.countries) if (c.alive && c.tiles) retitle(c, !game.started);
  // (c.ownedDep used to be counted here over every deposit tile on the map; nothing reads it, so ownedDepOf(c) does it on demand)
  recomputeNations();
  game.bldDirty = false;
}

// Links carry smart shipments. Every country has a wish list (supplyWish): what it wants in stock. A train or
// ship leaving a stop loads what the countries down the line are short of (needBeyond), out of what this country
// has above its own wish list. So goods flow from the best-supplied countries to the neediest, hop by hop, and a
// colony two links away gets fed through the one in between. Ice colonies (rocket country) wish for a lot of stone
// and iron, so the rest of the empire keeps them supplied. People move too: toward the country with more room.
const CARGO_RES = ['wood', 'stone', 'iron', 'uranium'];
const cargoSum = o => CARGO_RES.reduce((a, r) => a + (o[r] || 0), 0);   // goods in a load (not people)
function unloadAt(L, C) {
  if (L.cargo && C) {
    for (const r of CARGO_RES) C.res[r] = (C.res[r] || 0) + (L.cargo[r] || 0);
    C.people += L.cargo.people;
    const from = liveCountry(L.cargo.from ?? -1);
    if (isRocketCountry(C) && from && from !== C && !C.fed && L.cargo.wood + L.cargo.stone + L.cargo.iron > 0) {
      C.fed = true;                                // say so the first time an ice colony gets supplies
      toast(`Supplies are reaching ${C.full} from ${from.short}: your empire keeps its ice colonies stocked for drills, pads and rockets.`);
    }
  }
  L.cargo = null; L.to = -1;
}
const isRocketCountry = C => C.geo.ice > 0 || C.pw.drills > 0 || C.pw.pads > 0;
// how many people a country keeps on hand: its workers plus a crew to expand with (see CFG.supply)
const crewOf = C => C.pw.workers + (isRocketCountry(C) ? CFG.supply.iceCrew : CFG.supply.crew);
// what a country wants in stock: enough to keep building, a reserve once it's established, and for an
// ice colony the stone and iron for drills, a launch pad and rockets. Never more than it can store.
// On top of that: what it asked for and couldn't build, what it has been spending on buildings lately, and the iron
// its launch pads still need for the rockets they're assembling.
function supplyWish(C) {
  const S = CFG.supply, w = { people: crewOf(C) };
  for (const r of CARGO_RES) {
    const store = storeOf(C, r);
    w[r] = Math.min(store, Math.max(S.base[r], store * S.keep) + (isRocketCountry(C) ? S.ice[r] : 0) + (r === 'uranium' && C.pw.nukes ? S.nuke : 0) + demandOf(C, r));
  }
  return w;
}
const storeOf = (C, r) => C.store ? C.store[r] : CFG.storage[r].base;
const askOf = (C, r) => (C.ask ? C.ask[r] || 0 : 0);
const usedOf = (C, r) => (C.used ? C.used[r] || 0 : 0);
function padIronNeed(C) {
  let n = 0;
  for (const b of C.pw.padList || []) if (!b.paused) n += Math.max(0, CFG.rocket.iron - (b.rocket ? b.rocket.iron : 0));
  return n;
}
const demandOf = (C, r) => askOf(C, r) + usedOf(C, r) + (r === 'iron' ? padIronNeed(C) : 0);
// is a country pressing for this resource: it asked for it, or it's busy building with it?
const pressing = (C, r) => askOf(C, r) >= 1 || usedOf(C, r) >= CFG.supply.busyMin;
// the least a country keeps when another one is pressing for something: its base stock plus its own demand
const floorOf = (C, r) => Math.min(storeOf(C, r), CFG.supply.base[r] + demandOf(C, r));
// what a country can give away: above its wish list, or (to someone pressing for it) above its floor
const spareOf = (C, r, press) => Math.max(0, C.res[r] - (press ? floorOf(C, r) : supplyWish(C)[r]));
// spending on buildings: it wants that much back in stock, and it no longer needs what it had asked for
function noteSpend(C, cost) {
  if (!C.used) C.used = { wood: 0, stone: 0, iron: 0, uranium: 0 };
  if (!C.ask) C.ask = { wood: 0, stone: 0, iron: 0, uranium: 0 };
  for (const r of CARGO_RES) if (cost[r] > 0) { C.used[r] = Math.min(storeOf(C, r), (C.used[r] || 0) + cost[r]); C.ask[r] = Math.max(0, (C.ask[r] || 0) - cost[r]); }
}
// asks and busy spending fade away when nothing renews them
function stepDemand(dt) {
  const S = CFG.supply, ka = Math.exp(-dt / S.askTau), ku = Math.exp(-dt / S.usedTau);
  for (const C of game.countries) {
    if (!C.alive) continue;
    for (const r of CARGO_RES) {
      if (C.ask) C.ask[r] = (C.ask[r] || 0) * ka < 0.5 ? 0 : C.ask[r] * ka;
      if (C.used) C.used[r] = (C.used[r] || 0) * ku < 0.5 ? 0 : C.used[r] * ku;
    }
  }
}
// what the countries reached through `dst` (never back through `src`) still want, after counting what they
// hold above their own wish lists and what's already on its way to them
function needBeyond(src, dst) {
  const adj = new Map(), link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const L of game.links) {
    const A = countryAt(L.a), B = countryAt(L.b);
    if (A && B && A !== B) { link(A, B); link(B, A); }
  }
  const seen = new Set([src, dst]), q = [dst], need = { wood: 0, stone: 0, iron: 0, uranium: 0, people: 0 }, press = {};
  for (let h = 0; h < q.length; h++) {
    const C = q[h], w = supplyWish(C), inc = incomingTo(C);
    for (const r of CARGO_RES) { need[r] += w[r] - (C.res[r] || 0) - inc[r]; if (pressing(C, r)) press[r] = true; }
    need.people += w.people - C.people - inc.people;   // a country with more than its crew passes the rest on
    for (const n of adj.get(C) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  for (const r in need) need[r] = Math.max(0, need[r]);
  need.press = press;                              // goods someone down the line is pressing for
  return need;
}
function loadAt(L, src, dst) {
  L.cargo = null; L.to = -1;
  if (!src || !dst || src === dst) return;
  const V = CFG.vehicles[L.kind], cargo = { wood: 0, stone: 0, iron: 0, uranium: 0, people: 0, from: src.id };
  const wish = supplyWish(src), need = needBeyond(src, dst), want = {};
  let total = 0;
  for (const r of CARGO_RES) { want[r] = Math.min(need[r], spareOf(src, r, need.press[r])); total += want[r]; }
  const k = total > V.cargo ? V.cargo / total : 1; // a full load is split across what's wanted
  for (const r of CARGO_RES) { cargo[r] = Math.floor(want[r] * k); src.res[r] -= cargo[r]; }
  // people: first to the countries down the line short of their crew, out of what this one has above its own crew
  const spare = Math.max(0, src.people - wish.people);
  let ppl = Math.min(V.people, need.people, spare);
  // then, if there's room left on board, toward empty housing: from a fuller country to an emptier one next door
  const full = c => (c.cap > 0 ? c.people / c.cap : 0);   // people in a country with no settlement stay put
  if (full(src) > full(dst) + 0.05) ppl = Math.max(ppl, Math.min(V.people, Math.max(0, dst.cap - dst.people), spare * 0.5));
  cargo.people = Math.floor(ppl);
  src.people -= cargo.people;
  if (cargoSum(cargo) + cargo.people > 0) { L.cargo = cargo; L.to = dst.id; }
}
// goods (and people) on their way to a country right now, and from where (bySrc: country -> amount of goods)
function incomingTo(C) {
  const inc = { wood: 0, stone: 0, iron: 0, uranium: 0, people: 0, bySrc: new Map() };
  for (const list of [game.links, game.freight]) for (const L of list) {
    if (!L.cargo || liveCountry(L.to) !== C) continue;
    for (const r of ['wood', 'stone', 'iron', 'uranium', 'people']) inc[r] += L.cargo[r] || 0;
    const from = liveCountry(L.cargo.from ?? -1), goods = cargoSum(L.cargo);
    if (from && goods) inc.bySrc.set(from, (inc.bySrc.get(from) || 0) + goods);
  }
  return inc;
}

// ---------- freighters: any port ships to any other, wherever the need is ----------
// Each port has one freighter. An idle one looks over every country with a port, scores what it could bring each
// (goods that country is short of and this one can spare; asked-for goods count CFG.freight.urgent times; nearer
// is better) and sails straight there. It unloads, takes back whatever home is short of, and comes home to wait.
let freightTimer = 0;
const seaRoutes = new Map();                       // "a>b" -> sea path from port a to port b, or null (the sea never changes)
function freightPath(a, b) {
  const key = a + '>' + b;
  if (!seaRoutes.has(key)) { const r = seaPath(a, [b]); seaRoutes.set(key, r ? r.path : null); }
  return seaRoutes.get(key);
}
// what T is short of right now: its wish list less what it holds and what's on its way
function shortOf(T) {
  const w = supplyWish(T), inc = incomingTo(T), s = {};
  for (const r of CARGO_RES) s[r] = Math.max(0, w[r] - T.res[r] - inc[r]);
  return s;
}
// load a freighter at S for T: the goods T is pressing for first (sharing the hold between them), then the rest of
// T's shortfall in whatever room is left
function freightLoad(S, T, short) {
  const cargo = { wood: 0, stone: 0, iron: 0, uranium: 0, people: 0, from: S.id };
  let room = CFG.freight.cargo;
  for (const press of [true, false]) {
    const rs = CARGO_RES.filter(r => pressing(T, r) === press), want = {};
    let total = 0;
    for (const r of rs) { want[r] = Math.max(0, Math.min(short[r], spareOf(S, r, press))); total += want[r]; }
    const k = total > room ? room / total : 1;
    for (const r of rs) { cargo[r] = Math.floor(want[r] * k); room -= cargo[r]; }
  }
  for (const r of CARGO_RES) S.res[r] -= cargo[r];
  return cargoSum(cargo) > 0 ? cargo : null;
}
// how much an idle port in S could do for T, or 0 when it isn't worth a trip
function freightScore(S, T, short) {
  const F = CFG.freight;
  let goods = 0, score = 0, urgent = false;
  for (const r of CARGO_RES) {
    const press = pressing(T, r), g = Math.min(short[r], spareOf(S, r, press), F.cargo);
    goods += g; score += g * (press ? F.urgent : 1);
    if (press && g >= 1) urgent = true;
  }
  return goods >= F.min || urgent ? score : 0;
}
function dispatchFreight() {
  const out = new Set(game.freight.map(F => F.home)), byCountry = new Map(), sent = [];
  for (const p of game.ports) {
    const C = countryAt(p);
    if (C && building[p] === BLD_CODE.port) { if (!byCountry.has(C)) byCountry.set(C, []); byCountry.get(C).push(p); }
  }
  if (byCountry.size < 2) return sent;
  for (const [S, ports] of byCountry) for (const p of ports) {
    if (out.has(p)) continue;
    const px = p % W, py = (p / W) | 0, picks = [];
    for (const [T, tps] of byCountry) {
      if (T === S) continue;
      const short = shortOf(T), score = freightScore(S, T, short);
      if (score <= 0) continue;
      const near = tps.map(q => [q, Math.hypot(q % W - px, ((q / W) | 0) - py)]).sort((a, b) => a[1] - b[1]);
      picks.push({ T, short, ports: near, score: score / (near[0][1] + 40) });
    }
    picks.sort((a, b) => b.score - a.score);
    for (const pk of picks) {
      const dest = pk.ports.map(([q]) => q).find(q => freightPath(p, q));
      if (dest === undefined) continue;            // no water between them
      const cargo = freightLoad(S, pk.T, pk.short);
      if (!cargo) break;
      const F = { freight: true, kind: 'sea', home: p, dest, path: freightPath(p, dest), t: 0, dir: 1, cargo, to: pk.T.id };
      game.freight.push(F); out.add(p); sent.push(F);
      break;
    }
  }
  return sent;
}
function stepFreight(dt) {
  for (const F of game.freight) {
    F.t += CFG.shipSpeed * dt * F.dir;
    const end = F.path.length - 1;
    if (F.dir > 0 && F.t >= end) {                 // arrived: unload, take back what home is short of, turn round
      F.t = end; F.dir = -1;
      const T = building[F.dest] === BLD_CODE.port ? countryAt(F.dest) : null, home = countryAt(F.home);
      if (T && F.cargo) {
        const [x, y] = tileCenter(F.dest), from = liveCountry(F.cargo.from);
        floatText(x, y - 1, `+${listRes(F.cargo, CARGO_RES)}${from && from !== T ? ' from ' + from.short : ''}`, '#7bd389');
        unloadAt(F, T);
      }
      if (T && home && home !== T && !F.cargo) F.cargo = freightLoad(T, home, shortOf(home));
      if (F.cargo) F.to = (home || liveCountry(F.cargo.from) || { id: -1 }).id;   // cargo still aboard (port gone): it goes home
    } else if (F.dir < 0 && F.t <= 0) {            // home: unload whatever it carries and wait for the next job
      F.t = 0; F.done = true;
      const home = countryAt(F.home) || liveCountry(F.to);
      if (home && F.cargo) unloadAt(F, home);
    }
  }
  if (game.freight.some(F => F.done)) game.freight = game.freight.filter(F => !F.done);
}
// A build failed for lack of goods: ask the empire for them, send what can be sent now, and say what's coming.
function askFor(C, cost) {
  const short = Object.entries(cost).filter(([r, n]) => C.res[r] < n);
  const goods = short.filter(([r]) => CARGO_RES.includes(r));
  if (!goods.length) return toast(`${C.short} doesn't have enough ${short.length ? short[0][0] : 'resources'}`);
  if (!C.ask) C.ask = { wood: 0, stone: 0, iron: 0, uranium: 0 };
  for (const [r, n] of goods) C.ask[r] = Math.min(storeOf(C, r), C.ask[r] + n);
  dispatchFreight();
  const what = goods.map(([r, n]) => `${Math.ceil(n - C.res[r])} ${r}`).join(' and ');
  // what's on its way to C with any of those goods, and the soonest arrival
  const from = new Set();
  let soon = Infinity, any = false;
  for (const list of [game.links, game.freight]) for (const L of list) {
    if (!L.cargo || liveCountry(L.to) !== C || !goods.some(([r]) => L.cargo[r] >= 1)) continue;
    any = true;
    const f = liveCountry(L.cargo.from); if (f) from.add(f.short);
    const end = L.dir > 0 ? L.path.length - 1 : 0;
    soon = Math.min(soon, Math.abs(end - L.t) / (L.kind === 'rail' ? CFG.trainSpeed : CFG.shipSpeed));
  }
  const mine = game.ports.filter(p => countryAt(p) === C), linked = game.links.some(L => countryAt(L.a) === C || countryAt(L.b) === C);
  const others = game.ports.filter(p => { const o = countryAt(p); return o && o !== C; });
  if (any) return toast(`${C.short} is short ${what}. On its way${from.size ? ' from ' + [...from].join(', ') : ''}: first there in ${secs(soon)}`);
  if (!mine.length && !linked) return toast(`${C.short} is short ${what}. Build a port (or a station) there and the rest of your empire will ship it in.`);
  if (mine.length && !linked && !others.some(p => mine.some(q => freightPath(p, q))))
    return toast(`${C.short} is short ${what}. ${others.length ? 'No ship of yours can reach its port by sea' : 'Your other countries need a port too'} (or link it by rail).`);
  toast(`${C.short} is short ${what}. Asked your empire: nobody has it to spare yet${mine.length ? '' : ' (a port there lets any port ship it in)'}.`);
}

// which of your countries is closest to a spot (measured to its border)
function nearestCountryTo(tx, ty) {
  let best = -1, bd = Infinity;
  for (const i of frontier) {
    const d = (i % W - tx) ** 2 + (((i / W) | 0) - ty) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) {
    const x = best % W, y = (best / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && owner[idx(nx, ny)]) { const c = countryAt(idx(nx, ny)); if (c) return { country: c, tile: best }; }
    }
  }
  return { country: activeCountry(), tile: best >= 0 ? best : idx(spawn.x, spawn.y) };
}

// ---------- unlocks: your empire's peak population opens up new buildings ----------
const isUnlocked = type => game.peakPop >= (CFG.buildings[type].unlock || 0);
function checkUnlocks(quiet = false) {
  let changed = quiet;                             // quiet = the first check at start: always draw the bar
  for (const [type, b] of Object.entries(CFG.buildings)) {
    if (game.unlocked.has(type) || !isUnlocked(type)) continue;
    game.unlocked.add(type);
    addToBar(type);                                // new unlocks (and, on load, anything newly unlocked by an update) take a free slot
    changed = true;
    if (!quiet) toast(`Unlocked: ${b.name}! Your empire reached ${fmtNum(b.unlock)} people. ${say('Press E', 'Tap Build')} → ${tabOf(type).name} to build it.`, { good: true });
  }
  // this runs every time the population sets a new record (most ticks while it grows), so only
  // rebuild the bar when something was actually unlocked
  if (changed) { refreshBuildBar(); renderNewBadges(); if (techOpen) renderTechTree(); }
  // rebuild the open menu only when something unlocked: rebuilding it every new population record (most ticks)
  // swapped the cards out from under the pointer, so hover blinked and clicks were lost. The numbers on it
  // update in place (updateBuildMenu, with the HUD).
  if (menuOpen && changed) renderBuildMenu();
}

// ---------- route finding ----------
const gScore = new Float32Array(N), cameFrom = new Int32Array(N);
const seen = new Int32Array(N), closed = new Int32Array(N);
let stampN = 0;

// cheapest land route from a new station to the nearest existing one (A*, 8 directions)
function railPath(start, targets) {
  const st = ++stampN;
  const tset = new Set(targets);
  const tx = targets.map(t => t % W), ty = targets.map(t => (t / W) | 0);
  const h = i => {
    const x = i % W, y = (i / W) | 0;
    let m = Infinity;
    for (let k = 0; k < tx.length; k++) {
      const dx = Math.abs(x - tx[k]), dy = Math.abs(y - ty[k]);
      const d = Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
      if (d < m) m = d;
    }
    return m;
  };
  const heap = new MinHeap();
  seen[start] = st; gScore[start] = 0; cameFrom[start] = -1;
  heap.push(start, h(start));
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === st) continue;
    closed[cur] = st;
    if (cur !== start && tset.has(cur)) {
      const path = [];
      for (let p = cur; p !== -1; p = cameFrom[p]) path.push(p);
      return { path: path.reverse(), to: cur, weighted: gScore[cur] };
    }
    const g = gScore[cur];
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy, diag] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (!railable(n) || closed[n] === st) continue;      // land, or a bridge
      if (diag && (!railable(idx(x + dx, y)) || !railable(idx(x, y + dy))) && !(bridgeAt[n] && bridgeAt[cur])) continue;
      const ng = g + (CFG.trackWeight[BIOME_KEY[biome[n]]] || 1) * (diag ? 1.414 : 1);
      if (ng > CFG.railMaxLength) continue;
      if (seen[n] !== st || ng < gScore[n]) { seen[n] = st; gScore[n] = ng; cameFrom[n] = cur; heap.push(n, ng + h(n)); }
    }
  }
  return null;
}

// shortest sea route from a new port to the nearest existing port (BFS over ocean)
function seaPath(port, targets) {
  const st = ++stampN;
  const oceanNeighbors = t => {
    const out = [], x = t % W, y = (t / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (inb(nx, ny) && biome[idx(nx, ny)] === OCEAN) out.push(idx(nx, ny));
    }
    return out;
  };
  const goal = new Map();
  for (const t of targets) for (const n of oceanNeighbors(t)) goal.set(n, t);
  const q = [];
  for (const n of oceanNeighbors(port)) { seen[n] = st; cameFrom[n] = -1; gScore[n] = 1; q.push(n); }
  for (let hd = 0; hd < q.length; hd++) {
    const cur = q[hd];
    if (goal.has(cur)) {
      const path = [];
      for (let p = cur; p !== -1; p = cameFrom[p]) path.push(p);
      return { path: [port, ...path.reverse(), goal.get(cur)], to: goal.get(cur) };
    }
    if (gScore[cur] > CFG.seaMaxLength) continue;
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy, diag] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (biome[n] !== OCEAN || seen[n] === st) continue;
      if (diag && biome[idx(x + dx, y)] !== OCEAN && biome[idx(x, y + dy)] !== OCEAN) continue;
      seen[n] = st; cameFrom[n] = cur; gScore[n] = gScore[cur] + 1; q.push(n);
    }
  }
  return null;
}

// The shortest way from tile i to any tile of a route's path, over land (truck) or water (boat), within
// CFG.routeReach steps. A port starts from the water beside it. { path: the tiles after i, k: index reached } or null.
function legTo(i, route) {
  const boat = route.kind === 'boat', ok = t => (boat ? biome[t] === OCEAN : railable(t));
  const want = new Map();
  route.path.forEach((t, k) => want.set(t, k));    // a tile visited twice counts at its later index (shorter way home)
  const from = new Map(), dist = new Map(), q = [];
  const x0 = i % W, y0 = (i / W) | 0;
  const add = (n, p, d) => { from.set(n, p); dist.set(n, d); q.push(n); };
  if (boat) {
    for (const [dx, dy] of DIRS8) if (inb(x0 + dx, y0 + dy) && ok(idx(x0 + dx, y0 + dy))) add(idx(x0 + dx, y0 + dy), -1, 1);
  } else add(i, -1, 0);
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    if (want.has(cur)) {
      const path = [];
      for (let p = cur; p !== -1; p = from.get(p)) path.push(p);
      path.reverse();
      if (!boat) path.shift();                     // that's i itself
      return { path, k: want.get(cur) };
    }
    if (dist.get(cur) >= CFG.routeReach) continue;
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of DIRS8) {
      if (!inb(x + dx, y + dy)) continue;
      const n = idx(x + dx, y + dy);
      if (!from.has(n) && ok(n)) add(n, cur, dist.get(cur) + 1);
    }
  }
  return null;
}
// A colony's first station (port) follows the road (sea lane) its truck (boat) took from home, if that
// station (port) still stands: from tile i to the nearest point of the route, then along it back home.
function routePlan(i, type) {
  const kind = type === 'station' ? 'truck' : 'boat', C = countryAt(i);
  for (const r of game.routes) {
    if (r.kind !== kind || r.home === i || building[r.home] !== BLD_CODE[type] || liveCountry(r.colony) !== C) continue;
    const leg = legTo(i, r);
    if (!leg) continue;
    const path = [i];
    for (const t of [...leg.path, ...r.path.slice(0, leg.k).reverse(), r.home]) if (path[path.length - 1] !== t) path.push(t);
    let extra = null;
    if (type === 'station') {                      // track is paid by length, heavier through mountains and ice
      let weighted = 0;
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], b = path[k];
        weighted += Math.hypot(a % W - b % W, ((a / W) | 0) - ((b / W) | 0)) * (CFG.trackWeight[BIOME_KEY[biome[b]]] || 1);
      }
      extra = {};
      for (const [res, v] of Object.entries(CFG.trackCostPerTile)) extra[res] = Math.ceil(v * weighted);
    }
    const home = countryAt(r.home);
    return { path, to: r.home, tiles: path.length, extra, route: r, homeName: home ? home.short : 'home' };
  }
  return null;
}

// what placing a station/port at tile i would link to (cached while hovering)
let planCache = { key: null, val: null };
function linkPlan(i, type) {
  const key = `${type}:${i}:${game.stations.length}:${game.ports.length}:${game.routes.length}:${game.bridges.length}`;
  if (planCache.key === key) return planCache.val;
  let val = routePlan(i, type);                    // a colony's vehicle route comes first
  if (!val && type === 'station') {
    const others = game.stations.filter(t => t !== i && landGroup(t) === landGroup(i));   // bridges join landmasses
    if (!game.stations.length) val = { note: 'First station: it links up when you build a second one' };
    else if (!others.length) val = { note: 'No other station on this landmass. Use ports, or a bridge, to cross water.' };
    else {
      const r = railPath(i, others);
      if (!r) val = { note: `No station within ${CFG.railMaxLength} tiles of track. It will be built unlinked.` };
      else {
        const tc = {};
        for (const [k, v] of Object.entries(CFG.trackCostPerTile)) tc[k] = Math.ceil(v * r.weighted);
        val = { path: r.path, to: r.to, tiles: r.path.length, extra: tc };
      }
    }
  } else if (!val) {
    const others = game.ports.filter(t => t !== i);
    if (!others.length) val = { note: 'First port: it links up when you build a second one' };
    else {
      const r = seaPath(i, others);
      val = r ? { path: r.path, to: r.to, tiles: r.path.length, extra: null } : { note: 'No sea route to your other ports' };
    }
  }
  planCache = { key, val };
  return val;
}

// ======================================================================
// buildings
// ======================================================================
function isCoastal(i) {
  const x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (inb(nx, ny) && biome[idx(nx, ny)] === OCEAN) return true;
  }
  return false;
}
function canBuild(i, type) {
  if (!isLand(i)) return biome[i] === OCEAN ? "Can't build on water" : biome[i] === WALL ? "Can't build on the ice wall" : "That's outer space";
  if (!owner[i]) return 'Must be inside your territory';
  const want = CFG.buildings[type].vehicle;
  if (want) return building[i] === BLD_CODE[want] ? null
    : `Click one of your ${want}s: a ${CFG.buildings[type].name.toLowerCase()} rolls out from there`;
  if (type === 'drill' && biome[i] !== ICE) return 'Ice drills only work on ice: settle a polar ice cap first';
  if (type === 'settlement') {
    const near = crowdingCity(i);
    if (near) return `Too close to ${aiOf[near.i] ? nationAt(near.i).short + "'s" : 'your'} ${cityName(near).toLowerCase()}: cities need ${CFG.settlement.spacing} tiles between them`;
  }
  const def = CFG.buildings[type];
  if (type === 'rig') {
    const have = building[i] ? buildingAt(i).type : null;
    if (have === 'rig') return 'Already a mining rig';
    if (have !== 'cabin' && have !== 'camp') return "Upgrade a logger's cabin or miner's camp: click one";
  } else if (def.on) {
    // collectors go anywhere in your land: on the deposit or beside it. What matters is what's within reach.
    if (building[i]) return 'Something is already built here';
  } else if (depositOf[i] >= 0) return "Can't build on a resource deposit";
  if (building[i]) {
    const have = buildingAt(i).type;
    if (!ladderSteps(type, have)) return 'Something is already built here';
  }
  if (type === 'port' && !isCoastal(i)) return 'Ports must be on the coast';
  if (def.coast && !isCoastal(i)) return `${def.name}s must be on the coast: sea water cools them`;
  return null;
}
function planFor(i, type) {
  return (type === 'station' || type === 'port') && !canBuild(i, type) ? linkPlan(i, type) : null;
}
// cost to put `type` on tile i: the ladder steps from whatever is there now, plus any track
function totalCost(type, plan, i = -1) {
  if (CFG.buildings[type].vehicle) return { ...CFG.buildings[type].cost };
  const have = i >= 0 && building[i] ? buildingAt(i).type : null;
  let cost = {};
  for (const t of ladderSteps(type, have) || [type]) cost = addCost(cost, CFG.buildings[t].cost);
  return addCost(cost, plan && plan.extra);
}
function missingFor(cost, C = activeCountry()) {
  for (const [r, n] of Object.entries(cost)) if (!C || C.res[r] < n) return r;
  return null;
}
const empireCap = () => game.countries.reduce((a, c) => a + (c.alive ? c.cap : 0), 0);
function placeBuilding(i, type) {
  const old = buildingAt(i);
  if (old) { old.type = type; building[i] = BLD_CODE[type]; return; }   // upgrade in place
  building[i] = BLD_CODE[type];
  game.buildings.push({ i, type });
  if (type === 'station') game.stations.push(i);
  if (type === 'port') game.ports.push(i);
}
// a new station's rail or port's sea route, as planned by linkPlan
function layLink(i, type, plan) {
  game.links.push({ kind: type === 'station' ? 'rail' : 'sea', a: i, b: plan.to, path: plan.path, t: 0, dir: 1 });
  if (plan.route) game.routes.splice(game.routes.indexOf(plan.route), 1);   // the way home is laid now
  floatText(i % W + 0.5, (i / W) | 0, plan.route ? `${type === 'station' ? 'Rail along your truck\'s road' : 'Shipping lane along your boat\'s course'}: ${plan.tiles} tiles to ${plan.homeName}`
    : type === 'station' ? `Rail link: ${plan.tiles} tiles` : `Sea route: ${plan.tiles} tiles`, '#7bd389');
}
function tryBuild(i, type) {
  if (type === 'settlement') { const u = upgradeTargetAt(i); if (u) return upgradeCity(u); }
  if (!isUnlocked(type)) return toast(`${CFG.buildings[type].name} unlocks when your empire reaches ${CFG.buildings[type].unlock} people`);
  const why = canBuild(i, type);
  if (why) return toast(why);
  const C = countryAt(i);                       // every building is paid for by the country it's built in
  const plan = planFor(i, type);
  const cost = totalCost(type, plan, i);
  if (missingFor(cost, C)) return askFor(C, cost);   // the rest of the empire ships it in
  if (CFG.buildings[type].vehicle) return launchVehicle(i, type, C, cost);
  const settlers = CFG.buildings[type].people || 0;   // a settlement is founded by people, who move in from your other cities
  if (freePeople(C) < settlers) return toast(`${C.short} needs ${settlers} free people to found a settlement`);
  for (const [r, n] of Object.entries(cost)) C.res[r] -= n;
  noteSpend(C, cost);
  const before = empireCap();
  placeBuilding(i, type);
  if (settlers) {                                  // they leave their old homes and live here now
    const nb = buildingAt(i), from = allCities().filter(b => b !== nb && countryAt(b.i) === C);
    const had = from.reduce((a, b) => a + (b.pop || 0), 0);
    if (had > 0) for (const b of from) b.pop -= (b.pop || 0) * Math.min(1, settlers / had);
    nb.pop = settlers;
  }
  noteBuilt(type);
  popIn(i);
  if (plan && plan.path) layLink(i, type, plan);
  recomputeBuildings();
  const gained = empireCap() - before;
  if (gained >= 1) floatText(i % W + 0.5, ((i / W) | 0) - 1, `+${Math.round(gained)} capacity in ${C.short}`, '#7bd389');
}

// ---------- bridges: a stone span over the water, built with two clicks ----------
// Tile k of water costs stone + grow x (k - 1): every tile costs a little more than the last.
const bridgeCost = len => ({ stone: CFG.bridge.stone * len + CFG.bridge.grow * len * (len - 1) / 2 });
// The bridge from tile `a` aimed at tile `c`: along the straight line from a through c (and on past it), out over the
// first stretch of water to the first land beyond. Returns { s, b, tiles, len, cost, why }: s = the last land tile
// before the water, b = the land it reaches, tiles = the water it crosses (edge to edge, so nothing cuts a corner),
// len = its length in tiles of water. `why` says what's wrong when it can't be built.
function bridgePlan(a, c) {
  const B = CFG.bridge, ax = a % W, ay = (a / W) | 0, dx = c % W - ax, dy = ((c / W) | 0) - ay;
  if (!dx && !dy) return { why: 'Now click the land across the water' };
  const sx = Math.sign(dx), sy = Math.sign(dy), nx = Math.abs(dx), ny = Math.abs(dy);
  let x = ax, y = ay, ix = 0, iy = 0, s = a, b = -1;
  const tiles = [];
  for (let step = 0; step < 2 * W; step++) {
    if ((0.5 + ix) / nx < (0.5 + iy) / ny) { x += sx; ix++; } else { y += sy; iy++; }
    if (!inb(x, y)) break;
    const i = idx(x, y), bi = biome[i];
    if (bi === WALL || bi === VOID) return { s, tiles, why: 'That runs into the ice wall' };
    if (bi === OCEAN) { tiles.push(i); if (tiles.length > 2 * B.maxLen + 2) break; continue; }
    if (!tiles.length) { s = i; continue; }        // still crossing land toward the coast
    b = i; break;
  }
  if (!tiles.length) return { s, tiles, why: 'Aim across the water' };
  if (!owner[s]) return { s, tiles, why: 'Start the bridge on your own land' };
  if (b < 0) return { s, tiles, why: `More than ${B.maxLen} tiles of water that way` };
  const len = Math.max(1, Math.round(Math.hypot(b % W - s % W, ((b / W) | 0) - ((s / W) | 0))) - 1);
  const plan = { s, b, tiles, len, cost: bridgeCost(len) };
  if (len > B.maxLen) plan.why = `Too long: ${len} tiles of water (at most ${B.maxLen})`;
  else if (aiOf[b]) plan.why = `That shore belongs to ${nationAt(b).full}`;
  else if (tiles.every(t => bridgeAt[t])) plan.why = 'There is already a bridge here';
  return plan;
}
// the land tiles across the bridges that land on tile i
function bridgeEndsOf(i) {
  const out = [];
  for (const br of game.bridges) { if (br.s === i) out.push(br.b); else if (br.b === i) out.push(br.s); }
  return out;
}
// Landmasses joined by bridges count as one, so a station finds the stations across a bridge.
let landRoot = new Map();
const landGroup = i => { let k = landmass[i]; while (landRoot.has(k)) k = landRoot.get(k); return k; };
function addBridge(br) {
  game.bridges.push(br);
  bridgeEnd[br.s]++; bridgeEnd[br.b]++;
  for (const t of br.tiles) {
    bridgeAt[t]++;
    const x = t % W, y = (t / W) | 0;
    bridgeWide[t]++;
    for (const [dx, dy] of DIRS8) if (inb(x + dx, y + dy) && biome[idx(x + dx, y + dy)] === OCEAN) bridgeWide[idx(x + dx, y + dy)]++;
  }
  const A = landGroup(br.s), Bg = landGroup(br.b);
  if (A !== Bg) landRoot.set(A, Bg);
}
function clearBridges() {
  game.bridges = []; landRoot = new Map();
  bridgeAt.fill(0); bridgeWide.fill(0); bridgeEnd.fill(0);
}
// the bridge tool: the first click picks your coast, the second builds across to where you aimed
function bridgeClick(i) {
  const st = game.bridgeStart;
  if (st === i) { game.bridgeStart = null; return; }
  if (st == null) {
    if (!owner[i]) return toast('Start the bridge on your own land, at the coast');
    game.bridgeStart = i;
    return toast(say('Now click the land across the water. Right-click to start somewhere else.', 'Now tap the land across the water'));
  }
  const p = bridgePlan(st, i);
  if (p.why) return toast(p.why);
  const C = countryAt(p.s), miss = missingFor(p.cost, C);
  if (miss) return toast(`${C.short} doesn't have enough ${miss}: this bridge costs ${fmtNum(p.cost.stone)} stone`);
  for (const [r, n] of Object.entries(p.cost)) C.res[r] -= n;
  const br = { s: p.s, b: p.b, tiles: p.tiles, len: p.len };
  addBridge(br);
  noteBuilt('bridge');
  const free = !owner[p.b], other = countryAt(p.b);
  if (free) claim(p.b, C.id);                      // a bridge to free land claims the tile it lands on
  game.netDirty = true;                            // joins the land on both ends into one country
  game.bridgeStart = null;
  const [fx, fy] = tileCenter(p.b);
  floatText(fx, fy - 1, `Bridge: ${p.len} tiles${free ? ` · new land for ${C.short}` : other && other !== C ? ` · joins ${other.short}` : ''}`, '#7bd389');
  setTool(null);                                   // one bridge per pick: the tool doesn't stay on over the new bridge
  inspect(br);                                     // and its card opens
}

// ======================================================================
// pushes (left-click) and expeditions (vehicles launched from a station or port)
// ======================================================================
let pushId = 0;
// people per click come from the country that will do the work
const sendFrom = C => Math.floor((C ? freePeople(C) : 0) * game.sendPct / 100);

function startPush(tx, ty) {
  const b = biome[idx(tx, ty)];
  if (b === OCEAN) return toast(`Can't expand into water. Build a port, then launch a boat from it (build menu, Vehicles).`);
  if (b === WALL || b === VOID) return toast('Nothing to claim there: that is the edge of the world.');
  if (!frontier.size) return toast('Nowhere left to expand');
  const { country: src } = nearestCountryTo(tx, ty);
  const n = sendFrom(src);
  if (n < 1) return toast(`${src.short} doesn't have enough people. Wait for them to regrow.`);
  src.people -= n;
  game.pushes.push({ id: pushId++, country: src.id, tx, ty, budget: n, start: n, work: 0, mx: null, my: null, lx: null, ly: null });
}

function stepPush(p, dt) {
  const owner0 = liveCountry(p.country);           // follow merges
  if (!owner0) { p.done = true; return; }
  const cid = p.country = owner0.id;
  p.work += CFG.pushWorkPerSec(p.budget) * dt;
  const grassCost = CFG.tileCost.grass;
  if (p.work < 1) return;
  // The front: this country's frontier tiles within a band of the closest one to the target.
  // Inside the band, pick randomly (preferring tiles already hugged by territory),
  // so the border advances as a wide, slightly ragged front instead of a spike.
  let minD = Infinity;
  const mine = [];
  for (const i of frontier) {
    const x = i % W, y = (i / W) | 0;
    let on = 0, ours = false;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inb(nx, ny)) continue;
      const n = idx(nx, ny);
      if (owner[n]) { on++; const c = liveCountry(countryOf[n]); if (c && c.id === cid) ours = true; }
    }
    if (!ours) continue;
    const d = Math.hypot(x - p.tx, y - p.ty);
    mine.push({ i, d, on });
    if (d < minD) minD = d;
  }
  const band = 4 + Math.sqrt(p.start) * 1.3;
  const cands = [];
  for (const m of mine) if (m.d <= minD + band) cands.push({ i: m.i, s: (m.d - minD) / band * 1.2 - m.on * 0.45 + rng() });
  cands.sort((a, b) => a.s - b.s);
  const cities = allCities(), fought = new Set();
  let guarded = 0;
  for (const c of cands) {
    if (owner[c.i]) continue;
    // inside a city's zone: its people stand in the way, and fall one for one with your troops until none are left
    const g = guardAt(c.i, cid + 1, cities);
    if (g) {
      guarded++;
      if (fought.has(g)) continue;
      fought.add(g);
      const foe = nationAt(g.i);
      if (foe) provoke(foe);
      const fell = fightCity(g, Math.min(p.budget, p.work), false);
      p.work -= fell; p.budget -= fell;
      const cx = c.i % W + 0.5, cy = ((c.i / W) | 0) + 0.5;
      p.lx = cx; p.ly = cy;
      if (p.work < 1 || p.budget < 0.5) break;
      continue;
    }
    const cost = tileCost(c.i), work = cost / grassCost;
    if (cost > p.budget) continue;
    if (work > p.work) break;
    p.work -= work; p.budget -= cost;
    claim(c.i, cid, true);
    // marker follows the part of the front closest to the target
    const cx = c.i % W + 0.5, cy = ((c.i / W) | 0) + 0.5;
    if (p.lx == null || Math.hypot(cx - p.tx, cy - p.ty) < Math.hypot(p.lx - p.tx, p.ly - p.ty) + 1.5) { p.lx = cx; p.ly = cy; }
    if (p.work < 1) break;
  }
  const cheapest = cands.length ? Math.min(...cands.slice(0, 40).map(c => tileCost(c.i))) : Infinity;
  if (!cands.length || p.budget < 0.5 || (!guarded && p.budget < Math.max(cheapest, grassCost))) p.done = true;
}

// the tile just outside a country's border that's closest to a spot (falls back to its centre)
function borderTileOf(C, tx, ty) {
  let best = -1, bd = Infinity;
  for (const i of frontier) {
    const d = (i % W - tx) ** 2 + (((i / W) | 0) - ty) ** 2;
    if (d >= bd) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const n = idx(x + dx, y + dy);
      if (inb(x + dx, y + dy) && owner[n] && liveCountry(countryOf[n]) === C) { best = i; bd = d; break; }
    }
  }
  return best >= 0 ? best : idx(Math.floor(C.lx), Math.floor(C.ly));
}
const KIT_RES = ['wood', 'stone', 'iron'];      // what an expedition takes along (never uranium)
// Supplies to get a colony started: the send-% of each stockpile, but at least the basic kit if home has it.
// `paying` is what the launch itself costs: the kit is worked out from what's left once that's paid.
function kitFor(C, paying = {}) {
  const kit = {};
  for (const r of KIT_RES) {
    const have = Math.max(0, C.res[r] - (paying[r] || 0));
    kit[r] = Math.floor(Math.min(have, Math.max(CFG.expeditionKit[r] || 0, have * game.sendPct / 100)));
  }
  return kit;
}
function packKit(C) {
  const kit = kitFor(C);
  for (const r of KIT_RES) C.res[r] -= kit[r];
  return kit;
}
// A vehicle's crew: the send-% of the country's free people, but at least CFG.drive.minCrew when it has them,
// so a small country can still send a boat. 0 when fewer than 2 are free.
function crewFor(C) {
  const free = Math.floor(freePeople(C));
  return free < 2 ? 0 : Math.min(free, Math.max(sendFrom(C), CFG.drive.minCrew));
}
// Vehicles (build menu, Vehicles): a truck rolls out of one of your stations, a boat out of one of your ports,
// with the send-% of the country's free people and a starter package. You drive it (see driveStep); where it
// settles it founds a colony that remembers the way it came (game.routes), for that colony's first station or port.
function launchVehicle(i, type, C, cost) {
  const n = crewFor(C);
  if (n < 2) return toast(`${C.short} has no free people to crew a ${type}: its ${Math.floor(C.people)} people are working its cabins and camps or out on a push. Wait for it to grow.`);
  let sx = i % W + 0.5, sy = ((i / W) | 0) + 0.5, a = 0;
  if (type === 'boat') {                           // a boat starts on the water beside its port, facing out to sea
    let best = -1, bd = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = (i % W) + dx, y = ((i / W) | 0) + dy, d = dx * dx + dy * dy;
      if (d < bd && inb(x, y) && biome[idx(x, y)] === OCEAN) { bd = d; best = idx(x, y); }
    }
    if (best < 0) return toast('This port has no open water beside it');
    const bx = best % W + 0.5, by = ((best / W) | 0) + 0.5;
    a = Math.atan2(by - sy, bx - sx); sx = bx; sy = by;
  }
  for (const [r, k] of Object.entries(cost)) C.res[r] -= k;
  C.people -= n;
  const kit = packKit(C);
  const e = { x: sx, y: sy, tx: sx, ty: sy, n, kit, from: C.id, home: i, auto: false,
    kind: type, vx: 0, vy: 0, a, supplies: CFG.drive.supplies, trail: [[sx, sy]] };
  game.expeditions.push(e);
  noteBuilt(type);
  takeWheel(e);
  toast(`${type === 'boat' ? 'Boat' : 'Truck'} ready with ${n} people. ${say('Arrow keys or WASD to drive, Space to settle, Esc to let go', 'Steer with the arrows, and tap Settle when you like the spot')}.`);
}
// The playtest bot's expedition: an autopilot trip in a straight line from the border nearest the target.
function launchExpedition(tx, ty) {
  const t = idx(tx, ty);
  if (owner[t] || !isLand(t) || aiOf[t]) return;
  const src = activeCountry() || nearestCountryTo(tx, ty).country;
  const tile = borderTileOf(src, tx, ty);
  const n = sendFrom(src);
  if (n < 2) return;
  src.people -= n;
  game.expeditions.push({ x: tile % W + 0.5, y: ((tile / W) | 0) + 0.5, tx: tx + 0.5, ty: ty + 0.5, n, kit: packKit(src), from: src.id, auto: true });
}
function takeWheel(e) {
  stopFollow(); cam.anim = null;
  if (e) game.flying = null;
  game.driving = e;
  if (e) { setTool(null); setAiming(false); cam.zoom = Math.max(cam.zoom, 9); }
}
// X: hop into the next expedition that's waiting for a driver
function nextVehicle() {
  const list = [...game.expeditions.filter(e => !e.auto && !e.done), ...game.flights.filter(f => !f.done)];
  if (!list.length) return toast(`No vehicle or rocket is out. Pick a truck or boat in the build menu (${say('E', 'Build')}), then click one of your stations or ports.`);
  const next = list[(list.indexOf(game.flying || game.driving) + 1) % list.length];
  if (game.flights.includes(next)) takeRocket(next); else { game.flying = null; takeWheel(next); }
}
const canDriveOn = (e, x, y) => inb(Math.floor(x), Math.floor(y)) &&
  (e.kind === 'boat' ? biome[idx(Math.floor(x), Math.floor(y))] === OCEAN   // boats pass under bridges
    : isLand(idx(Math.floor(x), Math.floor(y))) || bridgeWide[idx(Math.floor(x), Math.floor(y))] > 0);

function stepExpedition(e, dt) {
  if (!e.auto) return driveStep(e, dt);
  const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
  const step = CFG.expeditionSpeed * dt;
  if (d <= step) { e.x = e.tx; e.y = e.ty; e.done = true; arrive(e); return; }
  e.x += dx / d * step; e.y += dy / d * step;
}
// One physics model for every vehicle: thrust along the heading, drag from what's underneath.
// A truck grips (no sideways slide) and crawls through desert and mountains; a boat drifts and turns wide.
function driveStep(e, dt) {
  const D = CFG.drive, V = D[e.kind], on = game.driving === e && !menuOpen;
  const key = (...ks) => on && ks.some(k => keys.has(k));
  const thr = key('arrowup', 'w') ? 1 : key('arrowdown', 's') ? -0.5 : 0;
  const turn = (key('arrowright', 'd') ? 1 : 0) - (key('arrowleft', 'a') ? 1 : 0);
  e.a += turn * V.turn * dt;
  const hx = Math.cos(e.a), hy = Math.sin(e.a);
  const under = idx(Math.floor(e.x), Math.floor(e.y));
  const drag = e.kind === 'boat' ? V.drag : biome[under] === OCEAN ? V.drag.grass : V.drag[BIOME_KEY[biome[under]]] || 3;   // a bridge drives like grass
  e.vx += (hx * thr * V.accel - e.vx * drag) * dt;
  e.vy += (hy * thr * V.accel - e.vy * drag) * dt;
  if (e.kind === 'truck') {                        // wheels: kill the sideways part of the motion quickly
    const f = e.vx * hx + e.vy * hy, k = Math.exp(-10 * dt);
    e.vx = f * hx + (e.vx - f * hx) * k; e.vy = f * hy + (e.vy - f * hy) * k;
  }
  const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
  if (canDriveOn(e, nx, e.y)) e.x = nx; else e.vx = 0;      // blocked (coast, ice wall): slide along it
  if (canDriveOn(e, e.x, ny)) e.y = ny; else e.vy = 0;
  const last = e.trail[e.trail.length - 1];
  if (Math.hypot(e.x - last[0], e.y - last[1]) > 1.5) e.trail.push([e.x, e.y]);   // kept whole: it becomes the colony's route home
  e.supplies -= dt;
  if (e.supplies < 0) {
    e.n -= D.starve * dt;
    if (e.n < 1) {
      e.done = true;
      if (game.driving === e) game.driving = null;
      toast('The expedition ran out of supplies and was lost.');
    }
  }
}
// where this expedition would settle right now: under a truck, or the nearest shore for a boat.
// { i, how: 'found' | 'join' } or null when there's nowhere (deep water, an AI nation's land)
function settleSite(e) {
  const cx = Math.floor(e.x), cy = Math.floor(e.y), R = e.kind === 'boat' ? CFG.drive.landReach : 0;
  let best = null, bd = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx, y = cy + dy;
    if (!inb(x, y)) continue;
    const i = idx(x, y);
    if (!isLand(i) || aiOf[i]) continue;
    const d = dx * dx + dy * dy + (owner[i] ? 100 : 0);        // free land first; your own land only if that's all there is
    if (d < bd) { bd = d; best = { i, how: owner[i] ? 'join' : 'found' }; }
  }
  return best;
}
function settleExpedition(e) {
  const site = settleSite(e);
  if (!site) {
    const here = idx(Math.floor(e.x), Math.floor(e.y));
    return toast(aiOf[here] ? `This is ${nationAt(here).full}. Drive on to free land.` : 'Bring the boat alongside free land first.');
  }
  e.tx = site.i % W + 0.5; e.ty = ((site.i / W) | 0) + 0.5;
  e.n = Math.floor(e.n);
  e.done = true;
  game.driving = null;
  arrive(e);
  const c = countryAt(site.i);
  if (c) game.active = c.id;
}

// an expedition that lands on free land founds a new country (a colony) with its own people and stockpile
function arrive(e) {
  const cx = Math.floor(e.tx), cy = Math.floor(e.ty);
  const there = countryAt(idx(cx, cy));
  if (there) {                                     // your territory got there first: they just join that country
    there.people += e.n;
    for (const r in e.kit) there.res[r] += e.kit[r];
    floatText(e.tx, e.ty, `${e.n} joined ${there.short}`, '#f2c14e');
    return;
  }
  const col = newCountry({ people: e.n, res: e.kit });
  if (e.home != null && e.trail) {                 // remember the way the vehicle came, as tiles from home outwards
    const path = [];
    for (const [x, y] of [...e.trail, [e.x, e.y]]) {
      const t = idx(Math.floor(x), Math.floor(y));
      if (path[path.length - 1] !== t) path.push(t);
    }
    game.routes.push({ kind: e.kind, home: e.home, colony: col.id, path });
  }
  const r = CFG.outpostRadius;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r + 1) continue;
    const x = cx + dx, y = cy + dy;
    if (inb(x, y)) claim(idx(x, y), col.id);
  }
  // the settlers found a settlement: on the landing spot, or the nearest clear tile if that's a deposit
  let site = -1, sd = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy, d = dx * dx + dy * dy;
    if (d >= sd || !inb(x, y)) continue;
    const t = idx(x, y);
    if (owner[t] && countryOf[t] === col.id && depositOf[t] < 0 && !building[t]) { site = t; sd = d; }
  }
  if (site >= 0) { placeBuilding(site, 'settlement'); popIn(site); }
  recomputeNetwork();
  // a boat's settlers build a port where they came ashore, free, and its shipping lane follows the boat home
  let port = -1;
  if (e.kind === 'boat') {
    let pd = Infinity;
    for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!inb(x, y) || canBuild(idx(x, y), 'port') || countryAt(idx(x, y)) !== liveCountry(col.id)) continue;
      const d = Math.hypot(x + 0.5 - e.x, y + 0.5 - e.y);
      if (d < pd) { pd = d; port = idx(x, y); }
    }
    if (port >= 0) {
      placeBuilding(port, 'port'); popIn(port);
      const plan = linkPlan(port, 'port');
      if (plan && plan.path) layLink(port, 'port', plan);
      recomputeBuildings();
    }
  }
  const live = liveCountry(col.id);
  if (live !== col) { toast(`The settlers joined ${live.full}`); return; }
  const kitTxt = Object.entries(e.kit).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
  const linked = port >= 0 && game.links.some(L => L.a === port);
  const via = port >= 0 ? (linked ? 'They built a port where they landed, and ships already sail your boat\'s course home with people and cargo.'
      : 'They built a port where they landed; it links up once you have another port it can reach.')
    : e.home == null ? 'Link it home to share people and cargo.'
    : e.kind === 'boat' ? 'Build a port here and its shipping lane follows your boat home.'
    : 'Build a station here and its rail follows your truck home.';
  toast(`Founded ${col.full}! Its settlement grows as you claim the land around it, with its own stockpile (${kitTxt}). ${via}`);
}


// ======================================================================
// select + copy/paste (left-drag a box over solar panels or burners, press C to paste at the cursor)
// ======================================================================
const COPYABLE = { solar: true, burner: true };   // collectors and rigs belong to one deposit   // stations/ports aren't copied (they'd all try to link)
let blueprint = null;                              // { items: [{dx, dy, type}] } relative to the selection's centre

function finishSelection(ax, ay, bx, by) {
  const [x0, y0] = toWorld(Math.min(ax, bx), Math.min(ay, by));
  const [x1, y1] = toWorld(Math.max(ax, bx), Math.max(ay, by));
  const inBox = b => {
    const x = b.i % W + 0.5, y = ((b.i / W) | 0) + 0.5;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  const sel = game.buildings.filter(b => inBox(b) && COPYABLE[b.type] && owner[b.i]);
  if (!sel.length) { clearSelection(); return toast('Nothing to copy in that box (solar panels and burners can be copied)'); }
  setTool(null);
  game.selection = sel.map(b => b.i);
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const b of sel) {
    const x = b.i % W, y = (b.i / W) | 0;
    mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y);
  }
  const cx = Math.floor((mnx + mxx) / 2), cy = Math.floor((mny + mxy) / 2);
  blueprint = { items: sel.map(b => ({ dx: b.i % W - cx, dy: ((b.i / W) | 0) - cy, type: b.type })) };
  const skipped = game.buildings.filter(b => inBox(b) && !COPYABLE[b.type]).length;
  toast(`Selected ${sel.length} building${sel.length > 1 ? 's' : ''}${skipped ? ` (${skipped} skipped)` : ''}. Move the mouse and press C to paste.`);
}

function clearSelection() { game.selection = []; blueprint = null; }

function pastePlan(tx, ty) {
  const tiles = [];
  let cost = {}, fit = 0;
  for (const it of blueprint.items) {
    const x = tx + it.dx, y = ty + it.dy;
    const ok = inb(x, y) && !canBuild(idx(x, y), it.type);
    tiles.push({ x, y, type: it.type, ok });
    if (ok) { fit++; cost = addCost(cost, totalCost(it.type, null, idx(x, y))); }
  }
  return { tiles, cost, fit };
}

function pasteAt(tx, ty) {
  if (!blueprint) return toast('Select some solar panels or burners first: hold left click and drag a box over them');
  const plan = pastePlan(tx, ty);
  const before = empireCap();
  let placed = 0, short = null;
  for (const o of plan.tiles) {
    if (!o.ok) continue;
    const C = countryAt(idx(o.x, o.y)), c = totalCost(o.type, null, idx(o.x, o.y)), miss = missingFor(c, C);
    if (miss) { short = miss; break; }
    for (const [r, n] of Object.entries(c)) C.res[r] -= n;
    placeBuilding(idx(o.x, o.y), o.type);
    placed++;
  }
  if (placed) recomputeBuildings();
  const blocked = plan.tiles.length - plan.fit;
  let msg = placed ? `Pasted ${placed} of ${plan.tiles.length}` : 'Nothing pasted';
  if (blocked) msg += ` · ${blocked} blocked (needs your own clear land)`;
  if (short) msg += ` · ran out of ${short}`;
  toast(msg);
  if (placed) {
    const gained = empireCap() - before;
    if (gained >= 1) floatText(tx + 0.5, ty - 1, `+${Math.round(gained)} capacity`, '#7bd389');
  }
}

// ======================================================================
// simulation tick
// ======================================================================
let netTimer = 0, landTimer = 0, aiTimer = 0, aiFireTimer = 0;
function tick(dt) {
  game.time += dt;
  netTimer += dt;
  landTimer += dt;
  if (game.netDirty && netTimer > 0.25) { recomputeNetwork(); netTimer = 0; landTimer = 0; }   // only when countries merge
  else if (game.bldDirty || (game.landDirty && landTimer > 0.3)) { recomputeBuildings(); landTimer = 0; }   // the border moved: settlements hold more (or less)

  // settlements under fire don't regrow: each side only grows on the share of its capacity that isn't being shelled
  for (const c of game.countries) c.fireCap = 0;
  for (const n of game.nations) n.fireCap = 0;
  for (const b of game.buildings) if (underFire(b)) { const who = countryAt(b.i) || nationAt(b.i); if (who) who.fireCap += settlementCap(b); }
  const growing = who => who.cap > 0 ? clamp(1 - who.fireCap / who.cap, 0, 1) : 1;

  // every country produces into its own stockpile and regrows its own people
  let pop = 0;
  for (const c of game.countries) {
    if (!c.alive) continue;
    // power: solar first (free), burners fill the rest and burn wood for it. Machines get power first (short of it,
    // they all slow down evenly); whatever is left over fills the cities' powered housing: `perMW` people per spare
    // MW, up to capPow (every level past the first, summed), shared evenly between the cities.
    // The cities draw only for the people living in that powered housing, so the wood burns as they fill up.
    const P = c.pw, B = CFG.buildings, S = CFG.settlement, solar = P.solar * B.solar.gen, burnMax = P.burners * B.burner.gen;
    // with no wood in stock, the burners can only burn what the loggers bring in
    const burnCan = c.res.wood > 1 ? burnMax : Math.min(burnMax, (c.prod?.wood || 0) / CFG.power.burnerWood * B.burner.gen);
    // nuclear plants come next (a little uranium goes a long way); with none in stock, only what the mines bring in
    const nukeMax = (P.nukes || 0) * B.nuclear.gen, U = CFG.power.nukeUranium;
    const nukeCan = (c.res.uranium || 0) > 0.05 ? nukeMax : Math.min(nukeMax, (c.prod?.uranium || 0) / U * B.nuclear.gen);
    const spare = Math.max(0, solar + nukeCan + burnCan - P.need);
    c.powCap = Math.min(P.capPow, spare * S.perMW);
    const cityMW = clamp(c.people - c.capBase, 0, c.powCap) / S.perMW;   // power the cities use right now
    let fromNuke = Math.min(Math.max(0, P.need + cityMW - solar), nukeCan);
    let burnU = nukeMax ? fromNuke / B.nuclear.gen * U : 0;   // uranium per second
    if (burnU * dt > (c.res.uranium || 0)) { const k = burnU ? (c.res.uranium || 0) / (burnU * dt) : 0; burnU *= k; fromNuke *= k; }
    c.res.uranium = Math.max(0, (c.res.uranium || 0) - burnU * dt);
    let fromBurn = Math.min(Math.max(0, P.need + cityMW - solar - fromNuke), burnMax);
    let burn = burnMax ? fromBurn / B.burner.gen * CFG.power.burnerWood : 0;   // wood per second
    if (burn * dt > c.res.wood) { const k = burn ? c.res.wood / (burn * dt) : 0; burn *= k; fromBurn *= k; }
    c.res.wood -= burn * dt;
    const made = solar + fromNuke + fromBurn;
    c.sat = P.need > 0 ? Math.min(1, made / P.need) : 1;
    c.mw = { gen: Math.min(P.need + cityMW, made), max: solar + burnMax + nukeMax, need: P.need + cityMW, burn, burnU, nuke: fromNuke,
             machines: P.need, city: Math.max(0, Math.min(cityMW, made - P.need)) };
    c.cap = c.capBase + c.powCap;
    if (c.tier + 1 < TITLE_TIERS.length && c.cap >= TITLE_TIERS[c.tier + 1].cap) retitle(c);
    c.store = {};                                  // how much of each resource this country can hold
    for (const r in CFG.storage) c.store[r] = CFG.storage[r].base + CFG.storage[r].city * P.cityStore + (P.depot[r] || 0);
    c.staff = P.workers > 0 ? Math.min(1, c.people / P.workers) : 1;   // too few people: collectors slow down
    for (const t of DEP_TYPES) {
      const r = DEP_RES[t];
      const prod = (P.colDep[t] * c.staff + P.rigDep[t] * CFG.power.rigMult * c.sat) * CFG.prodPerTile[t];
      c.res[r] = (c.res[r] || 0) + Math.max(0, Math.min(prod * dt, c.store[r] - (c.res[r] || 0)));   // it only piles up as far as the country can store it
      c.rates[r] = prod - (r === 'wood' ? burn : r === 'uranium' ? burnU : 0);
      (c.prod || (c.prod = {}))[r] = prod;
    }
    // fuel: ice drills make it as fast as their power allows and pipe it to the launch pads' tanks. No pad, nowhere to put it.
    stepRockets(c, dt);                            // builds the rockets, and the ice drills pump fuel into them
    if (c.cap > 0 && c.people < c.cap) {
      c.growth = (CFG.growthRate * c.people * (1 - c.people / c.cap) + CFG.growthBase) * growing(c);
      c.people = Math.min(c.cap, c.people + c.growth * dt);
    } else if (c.people > Math.max(c.cap, crewOf(c)) + 0.5) {   // more people than its housing (or crew) holds
      const keep = Math.max(c.cap, crewOf(c));
      c.growth = -(c.people - keep) * CFG.settlement.shrink - 0.05;
      c.people = Math.max(keep, c.people + c.growth * dt);
    } else c.growth = 0;
    pop += c.people;
  }
  for (const st of game.orbitals) pop += st.people;   // people living in space count too
  game.population = pop;
  if (pop > game.peakPop + 0.5) { game.peakPop = pop; checkUnlocks(); }

  for (const p of game.pushes) stepPush(p, dt);
  gunStep(dt);
  for (const r of game.raids) stepRaid(r, dt);
  game.raids = game.raids.filter(r => !r.done);
  for (const p of game.pushes) if (p.done && p.budget > 0) { const c = liveCountry(p.country); if (c) c.people += p.budget; }
  game.pushes = game.pushes.filter(p => !p.done);
  for (const e of game.expeditions) stepExpedition(e, dt);
  game.expeditions = game.expeditions.filter(e => !e.done);
  game.smoke = game.smoke || [];
  for (const m of game.missiles) {
    const t0 = m.t, big = m.w === 'missile', every = big ? 0.03 : 0.05;   // a puff of its trail every `every` seconds
    m.t += dt / m.dur;
    m.puff = (m.puff || 0) + dt;
    for (let n = 0; m.puff >= every && n < 30; n++) {
      m.puff -= every;
      const f = flight(m, Math.min(1, t0 + (m.t - t0) * (1 - m.puff / Math.max(dt, 1e-6))));
      addSmoke(f.x, f.y, f.s, f.H, big, { hot: big ? 1 : 0.4 });
    }
    if (m.t >= 1) { m.done = true; explode(m.x1, m.y1, m); continue; }
    // air defense gets its chance in the back half of the flight, once the shot is coming down near its target
    const f = flight(m, m.t);
    if (m.t > 0.45 && Math.hypot(f.x - m.x1, f.y - m.y1) <= CFG.airDefense.range * 1.5) tryIntercept(m);
  }
  for (const p of game.smoke) { p.t += dt / p.life; p.x += p.vx * dt; p.y += p.vy * dt; }
  game.smoke = game.smoke.filter(p => p.t < 1);
  for (const tr of game.tracers) tr.t += dt / 0.5;
  game.tracers = game.tracers.filter(tr => tr.t < 1);
  game.missiles = game.missiles.filter(m => !m.done);
  for (const b of game.blasts) b.t += dt / b.life;
  game.blasts = game.blasts.filter(b => b.t < 1);
  for (const sc of game.scorch) sc.t += dt / 45;
  game.scorch = game.scorch.filter(sc => sc.t < 1);
  aiTimer += dt; aiFireTimer += dt;
  if (aiFireTimer > 0.5) {
    aiFireTimer = 0; aiFire(); yourMortars();
    for (const b of game.buildings) if (b.dmg) b.dmg = Math.max(0, b.dmg - 0.5 / CFG.hp.repairSec);   // damage mends slowly
  }
  if (aiTimer > CFG.ai.think) { aiTimer = 0; for (const n of game.nations) aiThink(n); }
  // AI nations mine iron (the tiles their camps work, plus a trickle) into the same kind of capped store as yours
  for (const n of game.nations) {
    if (!n.alive) continue;
    const have = n.iron ?? CFG.iron.aiStart, cap = n.ironCap || CFG.storage.iron.base;
    n.ironRate = (n.ironTiles || 0) * CFG.prodPerTile.iron + CFG.iron.aiTrickle;
    n.iron = Math.max(have, Math.min(cap, have + n.ironRate * dt));
  }
  // AI nations regrow toward their capacity
  for (const n of game.nations) {
    if (!n.alive || n.people >= n.cap) { n.growth = 0; continue; }
    n.growth = (CFG.growthRate * n.people * (1 - n.people / n.cap) + CFG.growthBase) * CFG.ai.growth * growing(n);
    n.people = Math.min(n.cap, n.people + n.growth * dt);
  }
  syncCityPop();                                   // every city's own people, in step with the totals
  for (const L of game.links) {
    const speed = L.kind === 'rail' ? CFG.trainSpeed : CFG.shipSpeed;
    const A = countryAt(L.a), B = countryAt(L.b);
    if (L.out) {                                   // goods left waiting at a stop by the old sharing rule (older saves): hand them back
      for (const r of CARGO_RES) { if (A) A.res[r] += L.out.a[r] || 0; if (B) B.res[r] += L.out.b[r] || 0; }
      L.out = null;
    }
    if (L.cargo === undefined) loadAt(L, L.dir > 0 ? A : B, L.dir > 0 ? B : A);   // a new link loads at its first stop
    L.t += speed * dt * L.dir;
    const end = L.path.length - 1;
    if (L.t >= end) { L.t = end; L.dir = -1; unloadAt(L, B); loadAt(L, B, A); }
    else if (L.t <= 0) { L.t = 0; L.dir = 1; unloadAt(L, A); loadAt(L, A, B); }
  }
  stepDemand(dt);
  stepFreight(dt);
  freightTimer += dt;
  if (freightTimer >= CFG.freight.every) { freightTimer = 0; dispatchFreight(); }
  for (const f of game.flights) stepFlight(f, dt);
  for (const st of game.orbitals) stepOrbit(st, dt);
  stepSupplyRuns(dt);
  if (game.flights.some(f => f.done)) game.flights = game.flights.filter(f => !f.done);
  for (const f of game.floats) f.t += dt;
  game.floats = game.floats.filter(f => f.t < 2.4);
  stepPops(dt);
}

// ---------- saving ----------
let noSave = false;
// what a building remembers across a reload besides where it is: its tallies, and a launch pad's rocket and pause
const KEPT = ['shots', 'stops', 'killed', 'rocket', 'paused', 'supply', 'up', 'pop'];
function keptState(b) {
  let out = null;
  for (const k of KEPT) if (b[k]) (out || (out = {}))[k] = k === 'rocket' ? { iron: b.rocket.iron, fuel: b.rocket.fuel } : b[k];
  return out;
}
function saveGame() {
  if (noSave || !game.started) return;
  try {
    // territory as runs of one code per tile: 0 = nobody, +k = your country k-1, -k = AI nation k-1
    // (a tight loop over a million tiles: this is nearly all of the save's cost, so keep it lean)
    const runs = [], o = owner, co = countryOf, ai = aiOf;
    let prev = 0, count = 0;
    for (let i = 0; i < N; i++) {
      const v = o[i] ? co[i] + 1 : 0 - ai[i];
      if (v === prev) { count++; continue; }
      if (count) runs.push(prev, count);
      prev = v; count = 1;
    }
    runs.push(prev, count);
    // people and supplies still out on a push or expedition go back home in the save
    const back = game.countries.map(() => ({ people: 0, wood: 0, stone: 0, iron: 0, uranium: 0 }));
    for (const q of game.pushes) { const c = liveCountry(q.country); if (c) back[c.id].people += q.budget; }
    for (const e of game.expeditions) { const c = liveCountry(e.from); if (c) { back[c.id].people += e.n; for (const r in e.kit) back[c.id][r] += e.kit[r]; } }
    for (const F of game.freight) { const c = F.cargo && liveCountry(F.to); if (c) for (const r of CARGO_RES) back[c.id][r] += F.cargo[r] || 0; }   // freighters aren't saved: their goods land
    const data = {
      v: SAVE_V, lv: 1, seed: SEED, savedAt: Date.now(), time: game.time, active: game.active, peakPop: game.peakPop,
      sendPct: game.sendPct, unlocked: [...game.unlocked], hotbar: game.hotbar, barUsed: game.barUsed, useTick: game.useTick, seenTech: [...game.seenTech],
      countries: game.countries.map(c => ({ short: c.short, full: c.full, tier: c.tier, alive: c.alive, mergedInto: c.mergedInto,
        people: c.people + back[c.id].people, res: { wood: c.res.wood + back[c.id].wood, stone: c.res.stone + back[c.id].stone, iron: c.res.iron + back[c.id].iron, fuel: c.res.fuel || 0, uranium: (c.res.uranium || 0) + back[c.id].uranium } })),
      nations: game.nations.map(n => ({ people: n.people, alive: n.alive, hostile: !!n.hostile, iron: n.iron ?? CFG.iron.aiStart })),
      buildings: game.buildings.map(b => { const x = keptState(b); return x ? [b.i, b.type, b.ready || 0, x] : [b.i, b.type, b.ready || 0]; }),
      links: game.links.map(L => ({ kind: L.kind, a: L.a, b: L.b, path: L.path, t: L.t, dir: L.dir, cargo: L.cargo || null, to: L.to ?? -1, out: L.out || null })),
      routes: game.routes,
      bridges: game.bridges.map(br => [br.s, br.b, br.len, br.tiles]),
      rockets: game.buildings.filter(b => b.type === 'pad' && (b.rocket || b.paused)).map(b => [b.i, b.rocket ? b.rocket.iron : -1, b.rocket ? b.rocket.fuel : 0, b.paused ? 1 : 0]),
      flights: game.flights.filter(f => !f.done).map(f => [f.x, f.y, f.vx, f.vy, f.a, f.fuel, f.landed ? 1 : 0, f.everOrbit ? 1 : 0, f.n, f.throttle, f.pad ?? null, f.home ?? null]),
      orbitals: game.orbitals.map(st => [st.n, st.x, st.y, st.vx, st.vy, st.home, st.pad, st.people, st.level, st.res.wood, st.res.stone, st.res.iron, st.runs]),
      supplyRuns: game.supplyRuns.map(r => [r.st, r.t, r.T, r.fx, r.fy, r.cargo.people, r.cargo.wood, r.cargo.stone, r.cargo.iron]),
      runs, cam: { x: cam.x, y: cam.y, zoom: cam.zoom },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    game.savedAt = game.time;
  } catch (e) { console.warn('Autosave failed', e); }
}
// lay a save over the freshly generated (same seed, so same) world
function loadGame(sv) {
  // refuse a save that doesn't fit this version of the game (map size, building types), before touching anything
  const tiles = (sv.runs || []).reduce((a, v, k) => (k % 2 ? a + v : a), 0);
  if (tiles !== N || !Array.isArray(sv.countries) || !sv.countries.length || !Array.isArray(sv.links) ||
      !Array.isArray(sv.buildings) || sv.buildings.some(b => !CFG.buildings[b[1]])) throw new Error('save does not fit this version');
  owner.fill(0); countryOf.fill(-1); aiOf.fill(0); building.fill(0); frontier.clear();
  game.buildings = []; game.stations.length = 0; game.ports.length = 0; game.countries = []; game.ownedCount = 0;
  for (const sc of sv.countries) {
    const c = newCountry({ people: sc.people, res: sc.res });
    Object.assign(c, { short: sc.short, full: sc.full, tier: sc.tier, alive: sc.alive, mergedInto: sc.mergedInto });
  }
  game.nations.forEach((n, k) => { const sn = sv.nations[k]; if (sn) { n.people = sn.people; n.alive = sn.alive; n.hostile = !!sn.hostile; if (sn.iron != null) n.iron = sn.iron; } });
  let i = 0;
  for (let k = 0; k < sv.runs.length; k += 2) {
    const v = sv.runs[k], n = sv.runs[k + 1];
    for (let j = 0; j < n; j++, i++) {
      if (v > 0) { owner[i] = 1; countryOf[i] = v - 1; game.ownedCount++; } else if (v < 0) aiOf[i] = -v;
    }
  }
  for (const [bi, type, ready, kept] of sv.buildings) {
    placeBuilding(bi, type);
    const nb = game.buildings[game.buildings.length - 1];
    if (ready) nb.ready = ready;
    if (kept) for (const k of KEPT) if (kept[k] !== undefined) nb[k] = kept[k];
  }
  if (!sv.lv) {
    // a save from before city levels, when spare power quietly added housing to every settlement: a settlement in a
    // country with power gets level 2, so its powered homes don't vanish
    const powered = new Set();
    for (const b of game.buildings) if ((b.type === 'burner' || b.type === 'solar') && owner[b.i]) powered.add(countryOf[b.i]);
    for (const b of game.buildings) if (b.type === 'settlement' && owner[b.i] && powered.has(countryOf[b.i])) b.up = 2;
  }
  game.orbitals = (sv.orbitals || []).map(([n, x, y, vx, vy, home, pad, people, level, wood, stone, iron, runs]) =>
    ({ orbital: true, n, x, y, vx, vy, home, pad, people, level, res: { wood, stone, iron }, runs, a: 0 }));
  stationCount = Math.max(0, ...game.orbitals.map(st => st.n));
  game.supplyRuns = (sv.supplyRuns || []).map(([st, t, T, fx, fy, people, wood, stone, iron]) => ({ st, t, T, fx, fy, cargo: { people, wood, stone, iron } }));
  game.flights = (sv.flights || []).map(([x, y, vx, vy, a, fuel, landed, everOrbit, n, throttle, pad, home]) => ({ x, y, vx, vy, a, fuel, throttle: throttle ?? 1, engine: false, pad, home,
    landed: !!landed, left: Math.hypot(x - DISK.cx, y - DISK.cy) > DISK.R, orbit: false, everOrbit: !!everOrbit, t: 10, trail: [[x, y]], n: n || ++rocketCount }));
  rocketCount = Math.max(rocketCount, ...game.flights.map(f => f.n), 0);
  for (const [bi, iron, fuel, paused] of sv.rockets || []) {   // rockets being built or waiting on their pads
    const b = buildingAt(bi);
    if (!b || b.type !== 'pad') continue;
    if (iron >= 0) b.rocket = { iron, fuel };
    if (paused) b.paused = true;
  }
  game.links = sv.links;
  game.freight = [];
  game.routes = Array.isArray(sv.routes) ? sv.routes : [];
  clearBridges();
  for (const [s, b, len, tiles] of sv.bridges || []) addBridge({ s, b, len, tiles });
  for (let t = 0; t < N; t++) {
    if (!owner[t]) continue;
    const x = t % W, y = (t / W) | 0;
    for (const [dx, dy] of DIRS4) {
      if (!inb(x + dx, y + dy)) continue;
      const n = idx(x + dx, y + dy);
      if (!owner[n] && isLand(n)) frontier.add(n);
    }
  }
  Object.assign(game, { time: sv.time, active: sv.active, peakPop: sv.peakPop, sendPct: sv.sendPct, unlocked: new Set(sv.unlocked) });
  if (sv.hotbar) game.hotbar = sv.hotbar;
  if (sv.barUsed) { game.barUsed = sv.barUsed; game.useTick = sv.useTick || 0; }
  else { game.barUsed = game.hotbar.map((t, k) => (t ? 10 - k : 0)); game.useTick = 10; }   // a save from before: keep its order
  game.seenTech = new Set(sv.seenTech || sv.unlocked);   // from before NEW tags: nothing is new
  scanNationTiles();
  buildFronts();
  recomputeNetwork();
  fillLayer.img.data.fill(0); borderLayer.img.data.fill(0);
  for (let t = 0; t < N; t++) if (owner[t] || aiOf[t]) paintTerr(t);
  markDirty(fillLayer, 0, 0); markDirty(fillLayer, W - 1, H - 1); markDirty(borderLayer, 0, 0); markDirty(borderLayer, W - 1, H - 1);
  if (!game.countries.some(c => c.alive && c.tiles)) throw new Error('save has no living country');
  if (sv.cam) Object.assign(cam, sv.cam);
  game.savedAt = game.time;
}
function newGame() {
  noSave = true;                                   // don't let the unload autosave bring the old game back
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked: nothing to clear */ }
  location.search = '';
}

// ---------- weapons: mortars (short range, quick) and missile silos (long range, slow, powered) ----------
const weaponOf = b => CFG.weapons[CFG.buildings[b.type].weapon];
const weaponsOf = () => game.buildings.filter(b => owner[b.i] && CFG.buildings[b.type].weapon);
const silosOf = () => game.buildings.filter(b => owner[b.i] && b.type === 'silo');
const tileDist = (i, x, y) => Math.hypot(i % W - x, ((i / W) | 0) - y);
function setAiming(on) {
  if (on && !silosOf().length) return toast(isUnlocked('silo') ? 'Build a missile silo first: silos are the weapon you aim (mortars and turrets fire by themselves)' : `You aim missile silos, which unlock at ${CFG.buildings.silo.unlock} people. Mortars and turrets fire by themselves.`);
  game.aiming = on;
  if (on) { setTool(null); clearSelection(); toast(say('Aiming: click a target in range · F or Esc to stop', 'Aiming: tap a target in range, then tap it again to fire')); }
}
// which of your weapons would fire at a spot: the lightest one in range that's loaded
function pickWeapon(tx, ty) {
  const inR = silosOf().map(b => ({ b, Wp: weaponOf(b), d: tileDist(b.i, tx, ty) })).filter(o => o.d <= o.Wp.range)
    .sort((p, q) => p.Wp.range - q.Wp.range || p.d - q.d);
  return { inR, ready: inR.find(o => (o.b.ready || 0) <= game.time) };
}
// Air defense: a shot in the back half of its flight is knocked down by the other side's air defense, if one covers
// its target, is loaded and can pay. It bursts in the air and does nothing.
function tryIntercept(m) {
  const A = CFG.airDefense, byYou = m.ai < 0, tx = Math.floor(m.x1), ty = Math.floor(m.y1);
  for (const b of game.buildings) {
    if (b.type !== 'airdef' || (b.ready || 0) > game.time) continue;
    if (byYou ? !aiOf[b.i] : !owner[b.i]) continue;               // only the side being shot at defends
    if (tileDist(b.i, tx, ty) > A.range) continue;
    if (byYou) {
      const n = game.nations[aiOf[b.i] - 1];
      if ((n.iron || 0) < A.cost.iron) continue;
      n.iron -= A.cost.iron; b.rd = A.reload;
    } else {
      const C = countryAt(b.i);
      if (!C || C.res.iron < A.cost.iron) continue;
      C.res.iron -= A.cost.iron; b.rd = A.reload / Math.max(0.25, C.sat); b.stops = (b.stops || 0) + 1;
    }
    b.ready = game.time + b.rd;
    const f = flight(m, m.t), gx = f.x, gy = f.y;
    b.aim = [gx, gy]; b.fire = game.time;          // its launcher swings to face the shot
    const air = { s: f.s, H: f.H };                // how high up it was
    game.blasts.push({ x: gx, y: gy, t: 0, R: 0.4, life: 0.8, big: false, seed: (gx * 13 + gy * 7) | 0, air });
    game.tracers.push({ x0: b.i % W + 0.5, y0: ((b.i / W) | 0) + 0.5, x1: gx, y1: gy, air, t: 0 });
    floatText(gx, gy - 2.5, byYou ? 'Shot down' : 'Intercepted', byYou ? '#ff7a6b' : '#7bd389');
    m.done = true;
    return;
  }
}
// Your mortars pick their own targets: the nearest weapon or defense of a nation at war with you (never its
// settlements or economy: aim a missile for those). They hold fire below the iron reserve.
function yourMortars() {
  const Wp = CFG.weapons.shell;
  let theirs = null;
  for (const b of game.buildings) {
    if (b.type !== 'mortar' || !owner[b.i] || (b.ready || 0) > game.time) continue;
    const C = countryAt(b.i);
    if (!C || C.res.iron < Wp.cost.iron + CFG.mortarReserve) continue;
    theirs = theirs || game.buildings.filter(q => aiOf[q.i] && game.nations[aiOf[q.i] - 1].hostile && (isMilitary(q) || q.type === 'settlement'));
    const bx = b.i % W, by = (b.i / W) | 0;
    let tgt = null, best = Wp.range, city = null, bestC = Wp.range;
    for (const q of theirs) {
      const d = tileDist(q.i, bx, by);
      if (q.type === 'settlement') { if (d <= bestC && (q.pop || 0) > shellFloor(q) + 1) { bestC = d; city = q; } }
      else if (d <= best) { best = d; tgt = q; }
    }
    tgt = tgt || city;
    if (!tgt) continue;
    C.res.iron -= Wp.cost.iron;
    b.rd = Wp.reload; b.ready = game.time + b.rd; b.shots = (b.shots || 0) + 1;
    launchShot(b, ...tileCenter(tgt.i), 'shell');
  }
}
// Gun turrets: each one thins out an enemy push whose front is within its range, a few soldiers every tick,
// paying a little iron per soldier. Yours shoot nations' waves; theirs shoot your pushes.
function gunStep(dt) {
  const T = CFG.turret;
  for (const b of game.buildings) {
    if (b.type !== 'turret') continue;
    const bx = b.i % W + 0.5, by = ((b.i / W) | 0) + 0.5, mine = !!owner[b.i];
    if (!mine && !aiOf[b.i]) continue;
    const waves = mine ? game.raids : game.pushes;
    for (const w of waves) {
      if (w.done || w.lx == null || w.budget <= 0 || Math.hypot(w.lx - bx, w.ly - by) > T.range) continue;
      const kill = Math.min(w.budget, T.kills * dt), cost = kill * T.iron;
      if (mine) { const C = countryAt(b.i); if (!C || C.res.iron < cost) break; C.res.iron -= cost; b.killed = (b.killed || 0) + kill; }
      else { const n = game.nations[aiOf[b.i] - 1]; if (!n.alive || (n.iron || 0) < cost) break; n.iron -= cost; }
      w.budget -= kill;
      b.fire = game.time; b.aim = [w.lx, w.ly];
      b.acc = (b.acc || 0) + kill;
      if (b.acc >= 5) { floatText(w.lx, w.ly - 1.2, `-${Math.round(b.acc)}`, mine ? '#7bd389' : '#ff7a6b'); b.acc = 0; }
      break;                                       // one target at a time
    }
  }
}
function launchShot(b, x1, y1, w, nation = null) {
  const Wp = CFG.weapons[w], [x0, y0] = tileCenter(b.i);
  b.aim = [x1, y1]; b.fire = game.time;            // a mortar's tube swings to face it (drawDefence)
  game.missiles.push({ x0, y0, x1, y1, t: 0, dur: Math.max(Wp.minDur || 0.6, Math.hypot(x1 - x0, y1 - y0) / Wp.speed), w, ai: nation ? nation.id : -1 });
  // the launch kicks up smoke round the launcher: a big billow under a missile, a puff from a mortar's tube
  const big = w === 'missile', n = big ? 12 : 4, seed = (x0 * 31 + y0 * 17 + game.time * 7) | 0;
  for (let j = 0; j < n; j++) {
    const a = hash2(seed, j, 71) * Math.PI * 2, v = (big ? 0.9 : 0.5) * (0.4 + hash2(seed, j, 72));
    addSmoke(x0, y0, 0, 0, big, { vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, life: big ? 3 : 1.4, size: big ? 1.8 : 1, rise: big ? 4 : 6 });
  }
}
// Where a shot is `t` (0..1) of the way through its flight: the spot on the ground under it (x, y), how far up its arc
// it is (s: 0 on the ground, 1 at the top) and how high the top is (H, in tiles).
// A mortar shell is lobbed: steady across the ground, up and down a parabola. A missile climbs straight up out of its
// silo, slowly at first, turns over at the top, then dives onto its target, fastest at the end.
function flight(m, t) {
  const Wp = CFG.weapons[m.w], dist = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
  let p = t, s = 4 * t * (1 - t);
  if (m.w === 'missile') {
    const u = Math.pow(t, 1.5), v = 1 - u;          // a cubic curve: up from the silo, over, then steeply down
    p = 3 * v * u * u * 0.75 + 3 * v * v * u * 0.02 + u * u * u;
    s = 3 * v * u * (v + u) * 1.25 / 0.9375;
  }
  return { x: lerp(m.x0, m.x1, p), y: lerp(m.y0, m.y1, p), s, H: Math.max(m.w === 'missile' ? 6 : 3, dist * Wp.arc) };
}
// Smoke: puffs left in the air along a shot's flight, kicked up by a launch, and hanging over a blast.
// They sit where they were left (drifting by vx, vy tiles a second and rising `rise` px a second), grow and fade.
function addSmoke(x, y, s, H, big, o = {}) {
  if (game.smoke.length > 900) return;
  game.smoke.push({ x, y, s, H, big, t: 0, life: o.life || (big ? 2.2 : 0.9), size: o.size || 1, vx: o.vx || 0, vy: o.vy || 0,
    rise: o.rise || 3, hot: o.hot || 0, dark: o.dark || 0, seed: Math.random() * 6.283 });
}
function fireMissile(tx, ty) {
  const { inR, ready } = pickWeapon(tx, ty);
  if (!inR.length) return toast(`Out of range: missile silos reach ${CFG.weapons.missile.range} tiles`);
  if (!ready) return toast(`Reloading: ${Math.ceil(Math.min(...inR.map(o => o.b.ready)) - game.time)}s`);
  const s = ready.b, Wp = ready.Wp, C = countryAt(s.i), miss = missingFor(Wp.cost, C);
  if (miss) return toast(`${C.short} doesn't have enough ${miss} for a ${Wp.name.toLowerCase()}`);
  for (const [r, n] of Object.entries(Wp.cost)) C.res[r] -= n;
  // a powered weapon reloads slower when its country is short of power
  s.rd = Wp.reload / (CFG.buildings[s.type].use ? Math.max(0.25, C.sat) : 1);
  s.ready = game.time + s.rd; s.shots = (s.shots || 0) + 1;
  launchShot(s, tx + 0.5, ty + 0.5, CFG.buildings[s.type].weapon);
}
function removeBuilding(i) {
  const b = buildingAt(i);
  if (!b) return;
  building[i] = 0;
  game.buildings.splice(game.buildings.indexOf(b), 1);
  for (const arr of [game.stations, game.ports, game.selection]) { const k = arr.indexOf(i); if (k >= 0) arr.splice(k, 1); }
  game.links = game.links.filter(L => L.a !== i && L.b !== i);
}
const everyone = () => game.countries.reduce((a, c) => a + (c.alive ? c.people : 0), 0) + game.nations.reduce((a, n) => a + n.people, 0);
// A city that is captured loses whoever still lives there (taking its land meant fighting them all first): they come
// off its old owner's total, and it starts empty for its new owner, whose people move in as it has room.
function loseSettlement(i) {
  const b = buildingAt(i);
  if (!b || b.type !== 'settlement') return;
  hurtCity(b, b.pop || 0);
  b.pop = 0; b.up = cityLevel(b);                  // it keeps its level
}
function explode(x, y, m) {
  const Wp = CFG.weapons[m.w], R = Wp.radius, cx = Math.floor(x), cy = Math.floor(y), before = everyone();
  const foe = m.ai >= 0 ? game.nations[m.ai] : null;
  const hit = new Map();                           // nation or country -> tiles hit
  let wrecked = 0, damaged = 0;
  for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
    if (dx * dx + dy * dy > R * R + 0.5 || !inb(cx + dx, cy + dy)) continue;
    const i = idx(cx + dx, cy + dy);
    if (building[i]) {
      const b = buildingAt(i);
      if (b.type === 'settlement') {               // never damaged: the hit kills a share of the people living there
        shellCity(b, Wp.kill);
        b.hitAt = game.time;                       // and it stops regrowing for a while
        b.hitFx = game.time;
      } else {
        b.dmg = (b.dmg || 0) + Wp.damage;
        b.hitFx = game.time;                       // it shudders where it stands
        if (b.dmg >= hpOf(b)) { removeBuilding(i); wrecked++; } else damaged++;
      }
    }
    const who = nationAt(i) || countryAt(i);
    if (who) hit.set(who, (hit.get(who) || 0) + 1);
  }
  if (!foe) for (const who of hit.keys()) if (who.col) provoke(who);   // you shelled a nation: that's war
  let lost = 0;                                    // expeditions caught in the blast are gone
  for (const e of game.expeditions) {
    if (e.done || Math.hypot(e.x - x, e.y - y) > R + 0.8) continue;
    e.done = true; lost += Math.floor(e.n);
    if (game.driving === e) game.driving = null;
    toast(foe ? `Your expedition was destroyed by ${foe.full}!` : 'Your expedition was caught in the blast.', { alert: true, at: [e.x, e.y] });
  }
  recomputeBuildings();                            // lost settlements: nations lose the people who lived there
  const killed = Math.round(before - everyone()) + lost;
  const big = m.w === 'missile';
  game.blasts.push({ x, y, t: 0, R, life: big ? 2 : 1.2, big, seed: (x * 31 + y * 17) | 0, debris: true });
  game.scorch.push({ x, y, R, t: 0 });
  // dark smoke that hangs over the crater and climbs slowly after the fire is out
  for (let j = 0; j < (big ? 14 : 5); j++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * R * 0.7;
    addSmoke(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 0, 0, big,
      { life: (big ? 4.5 : 2.6) * (0.7 + Math.random() * 0.5), size: big ? 2.6 : 1.5, rise: big ? 9 : 6, dark: 1,
        vx: Math.cos(a) * 0.25, vy: Math.sin(a) * 0.15 });
  }
  const parts = [];
  if (killed) parts.push(`${killed} killed`);
  if (wrecked) parts.push(`${wrecked} building${wrecked === 1 ? '' : 's'} destroyed`);
  if (damaged) parts.push(`${damaged} damaged`);
  if (parts.length) floatText(x, y - R - 1.5, parts.join(' · '), '#ff7a6b');
}

function floatText(x, y, text, color) { game.floats.push({ x, y, text, color, t: 0 }); }

// ---------- little effects: buildings popping up, rings, freshly claimed land glowing ----------
// Drawing only: none of this is saved, and none of it changes the game.
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
// how big to draw a building right now: it pops up when built, bounces when its settlement grows, shudders when hit
function popScale(b) {
  let s = 1;
  if (b.born != null) { const t = (game.time - b.born) / 0.45; if (t >= 1) b.born = null; else s *= 0.15 + 0.85 * easeOutBack(Math.max(0, t)); }
  if (b.bump != null) { const t = (game.time - b.bump) / 0.6; if (t >= 1) b.bump = null; else s *= 1 + 0.22 * Math.sin(Math.max(0, t) * Math.PI) * (1 - t); }
  if (b.hitFx != null) { const t = (game.time - b.hitFx) / 0.4; if (t >= 1) b.hitFx = null; else s *= 1 + 0.1 * Math.sin(Math.max(0, t) * 38) * (1 - t); }
  return s;
}
// a ring that grows and fades where something happened (a building put down, a settlement growing up)
const burstFx = [];
function ringBurst(x, y, R, col) { if (burstFx.length < 60) burstFx.push({ x, y, R, col, t0: game.time }); }
function drawRingFx(z) {
  for (let j = burstFx.length - 1; j >= 0; j--) {
    const r = burstFx[j], t = (game.time - r.t0) / 0.6;
    if (t >= 1) { burstFx.splice(j, 1); continue; }
    if (t < 0) continue;
    const [sx, sy] = toScreen(r.x, r.y), e = 1 - (1 - t) ** 3;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = r.col; ctx.lineWidth = 1 + 3 * (1 - t);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, r.R * z) * (0.35 + 0.65 * e), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// the name of the city whose card is open over it, and the land it protects. From City up the name is coloured
// by how much of its powered housing has power: blue all of it, gold some, grey none.
function drawCityLevels(z) {
  const b = inspected;
  if (!b || b.type !== 'settlement' || !owner[b.i] || z < CFG.cityZoom * 0.5) return;
  reachRing(b.i, 'rgba(242,193,78,0.85)', z, [6, 6], zoneOf(b));
  const [sx, sy] = toScreen(b.i % W + 0.5, ((b.i / W) | 0) + 0.5);
  const f = poweredShare(countryAt(b.i)), pow = poweredHousing(cityLevel(b)) > 0;
  const col = !pow || f >= 0.995 ? '#8fd3ff' : f > 0.02 ? '#f2c14e' : '#8a93a3';
  pill(sx, sy - Math.max(18, z * 2.6), cityName(b), { fg: col, border: col, size: 11, bold: 800 });
}
// you built something: it pops up out of a puff of dust with a gold ring
function popIn(i) {
  const b = buildingAt(i);
  if (!b) return;
  b.born = game.time;
  const [x, y] = tileCenter(i);
  ringBurst(x, y, 1.8, '#f2c14e');
  for (let j = 0; j < 6; j++) {
    const a = j / 6 * Math.PI * 2 + Math.random() * 0.6;
    addSmoke(x, y + 0.3, 0, 0, false, { vx: Math.cos(a) * 0.7, vy: Math.sin(a) * 0.45, life: 0.8, size: 0.7, rise: 1.5 });
  }
}
// land you just claimed glows for a moment and fades into your colour: a ring buffer of (tile, time)
const CLAIM_FX = 8192, claimI = new Int32Array(CLAIM_FX), claimT = new Float64Array(CLAIM_FX);
let claimHead = 0, claimLen = 0;
function noteClaim(i) {
  claimI[claimHead] = i; claimT[claimHead] = game.time;
  claimHead = (claimHead + 1) % CLAIM_FX;
  if (claimLen < CLAIM_FX) claimLen++;
}
function drawClaimFlash(z, x0, y0, x1, y1) {
  const LIFE = 1.1, s = Math.max(z, 1.5);
  ctx.fillStyle = '#d8ecff';
  let k = 0;
  for (; k < claimLen; k++) {
    const j = (claimHead - 1 - k + CLAIM_FX) % CLAIM_FX, age = game.time - claimT[j];
    if (age > LIFE) break;                         // newest first: everything after this is older still
    const i = claimI[j], x = i % W, y = (i / W) | 0;
    if (x < x0 || x > x1 || y < y0 || y > y1 || age < 0) continue;
    const [sx, sy] = toScreen(x, y);
    ctx.globalAlpha = 0.75 * (1 - age / LIFE) ** 2;
    ctx.fillRect(sx, sy, s, s);
  }
  claimLen = k;                                    // forget the faded ones
  ctx.globalAlpha = 1;
}

// ---------- what each collector is doing ----------
// A cabin, camp or rig's own share of its country's output: the tiles it works times the yield, slowed by too few
// people (cabins, camps) or too little power (rigs). An AI nation's collectors just work.
function outputOf(b) {
  if (!HARVESTS[b.type] || !b.work) return null;
  const c = owner[b.i] ? game.countries[countryOf[b.i]] : null, out = {};
  const k = !c ? 1 : b.type === 'rig' ? CFG.power.rigMult * (c.sat ?? 1) : (c.staff ?? 1);
  for (const t of DEP_TYPES) if (b.work[t]) out[DEP_RES[t]] = b.work[t] * CFG.prodPerTile[t] * k;
  return out;
}
const isFull = (c, r) => !!(c && c.store && !(c.res[r] < c.store[r] - 0.01));   // no room left for any more of it
// how hard its crew is going, 0..1: 0 when there's nobody, no power, nothing to work, or nowhere left to put it
function effortOf(b) {
  if (!b.work || !(b.work.forest + b.work.stone + b.work.iron)) return 0;
  if (!owner[b.i]) return 1;
  const c = game.countries[countryOf[b.i]], out = outputOf(b);
  if (!Object.keys(out).some(r => !isFull(c, r))) return 0;     // storage full: they down tools
  return b.type === 'rig' ? (c.sat ?? 1) : (c.staff ?? 1);
}
// The hover card for a building: what it is and what it's doing right now. [html, bad]
function buildingCard(b) {
  const def = CFG.buildings[b.type], foe = nationAt(b.i), c = owner[b.i] ? game.countries[countryOf[b.i]] : null;
  const rows = [`<div class="t">${def.name}${foe ? ` · ${foe.full}` : ''}</div>`], line = (cls, s) => rows.push(`<div class="${cls}">${s}</div>`);
  let bad = false;
  const verb = { cabin: 'Chopping', camp: 'Mining', rig: 'Drilling' }[b.type];
  if (verb) {
    const tiles = DEP_TYPES.filter(k => b.work && b.work[k]).map(k => `${b.work[k]} ${k}`).join(', ');
    if (!tiles) { line('r', 'Nothing in reach to work'); bad = true; }
    else {
      line('d', `${verb} ${tiles} tile${tiles === '1 forest' || tiles === '1 stone' || tiles === '1 iron' ? '' : 's'}`);
      const out = outputOf(b);
      for (const r in out) {
        const full = isFull(c, r);
        line(full ? 'r' : 'g', full ? `${r}: storage full, nothing coming in` : `+${out[r].toFixed(2)} ${r} / sec`);
        if (full) bad = true;
      }
      if (c && b.type !== 'rig') {
        if (c.staff < 0.999) { line('r', `Short of people: working at ${Math.round(c.staff * 100)}%`); bad = true; }
        else line('d', `${def.workers} of ${c.short}'s people at work here`);
      }
      if (c && b.type === 'rig') {
        if (c.sat < 0.999) { line('r', `Short of power: running at ${Math.round(c.sat * 100)}%`); bad = true; }
        else line('d', `Fully powered · ${def.use} MW`);
      }
    }
  } else if (b.type === 'burner' && c && c.mw) {
    const per = c.pw.burners ? c.mw.burn / c.pw.burners : 0, load = per / CFG.power.burnerWood;
    if (per > 0.001) {
      line('g', `Burning ${per.toFixed(2)} wood / sec for ${(load * def.gen).toFixed(1)} MW`);
      line('d', `Running at ${Math.round(load * 100)}%`);
    } else if (c.res.wood < 1 && c.mw.need > c.mw.gen) { line('r', 'Out of wood: the fire is out'); bad = true; }
    else line('d', 'Idle: nothing needs its power right now');
  } else if (b.type === 'solar') line('g', `Making ${def.gen} MW from the sun, for free`);
  else if (def.desc) line('d', def.desc.split('. ')[0] + '.');
  return [rows.join(''), bad];
}
// "+2 wood" popping up over the tile a collector works, each time it has brought in a few more
const RES_COLOR = { wood: '#e0a96d', stone: '#d6dade', iron: '#ef9a6a' };
const pops = [], popAcc = new WeakMap();
function stepPops(dt) {
  for (const p of pops) p.t += dt;
  while (pops.length && pops[0].t > 1.6) pops.shift();
  for (const b of game.buildings) {
    if (!b.spots || !owner[b.i] || !HARVESTS[b.type]) continue;
    const c = game.countries[countryOf[b.i]], out = outputOf(b);
    let acc = popAcc.get(b);
    if (!acc) popAcc.set(b, acc = {});
    for (const r in out) {
      if (!c.store || isFull(c, r)) continue;         // full (or before the first tick): nothing is coming in
      const step = Math.max(1, Math.round(out[r] * 2.5));   // a pop every two or three seconds, whatever the rate
      acc[r] = (acc[r] || Math.random() * step) + out[r] * dt;   // start part-way, so neighbours don't pop together
      if (acc[r] >= step) {
        acc[r] -= step;
        const t = b.spots[0] ?? b.i;
        if (pops.length < 240) pops.push({ x: t % W + 0.5, y: ((t / W) | 0) + 0.1, text: `+${step} ${r}`, color: RES_COLOR[r], t: 0 });
      }
    }
  }
}
function drawPops(z) {
  if (z < CFG.cityZoom) return;
  ctx.font = `800 ${clamp(z * 0.2, 10, 22)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,18,26,0.85)';
  for (const p of pops) {
    const [sx, sy] = toScreen(p.x, p.y);
    if (sx < -40 || sy < -40 || sx > cw + 40 || sy > ch + 40) continue;
    const y = sy - p.t * z * 0.55 - 4;
    ctx.globalAlpha = clamp(Math.min(p.t * 8, (1.6 - p.t) * 2.5), 0, 1);
    ctx.strokeText(p.text, sx, y); ctx.fillStyle = p.color; ctx.fillText(p.text, sx, y);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'left';
}

// A worker out on the nearest tile a cabin or camp works: a lumberjack swinging an axe into a tree, a miner
// bringing a pickaxe down on rock. Slow wind-up, fast strike, chips flying off on the hit. Fewer people means a
// slower swing; nobody, or full storage, and the tool rests. A rig (powered) shakes its tile with dust instead.
const SWING = { cabin: 1.15, camp: 0.95 };
function drawWorkers(b, z) {
  const spots = b.spots;
  if (!spots || spots[0] === undefined) return;
  const effort = effortOf(b), bx = b.i % W, by = (b.i / W) | 0;
  if (b.type === 'rig') {                          // dust kicked up off the worked tiles
    if (effort <= 0) return;
    for (const t of spots) {
      if (t === undefined) continue;
      const [sx, sy] = toScreen(t % W + 0.5, ((t / W) | 0) + 0.7), u = z / 16;
      for (let k = 0; k < 4; k++) {
        const f = (game.time * 0.9 * effort + k / 4 + hash2(t, k, 76)) % 1, s = u * (1.5 + f * 3);
        ctx.fillStyle = `rgba(150,128,100,${0.55 * (1 - f)})`;
        ctx.fillRect(sx + (hash2(t, k, 77) - 0.5) * z * 0.6 + f * u * 3 - s / 2, sy - f * z * 0.4 - s / 2, s, s);
      }
    }
    return;
  }
  const u = Math.max(1, z / 14), cabin = b.type === 'cabin';
  spots.forEach((t, w) => {
    if (t === undefined || (w === 1 && (b.work.forest + b.work.stone + b.work.iron) < 4)) return;
    const tx = t % W, ty = (t / W) | 0, face = tx > bx || (tx === bx && ty > by) ? 1 : -1;   // face the tile, away from home
    const [fx, fy] = toScreen(tx + 0.5 - face * 0.1, ty + 0.8);                                    // feet: out at the tree or rock
    const iron = depositOf[t] >= 0 && deposits[depositOf[t]].type === 'iron';
    const period = SWING[b.type] / Math.max(0.35, effort), v = hash2(t, w, 78);
    const p = effort > 0 ? (game.time / period + v) % 1 : 0.9;
    // tool angle (0 = straight ahead, negative = raised back over the head)
    const a = p < 0.62 ? -0.3 - 2.0 * Math.sin(p / 0.62 * Math.PI / 2)           // wind up
      : p < 0.72 ? -2.3 + 3.2 * ((p - 0.62) / 0.1)                                // strike
      : 0.9 - 1.2 * ((p - 0.72) / 0.28);                                           // lift back off
    ctx.save();
    ctx.translate(Math.round(fx), Math.round(fy)); ctx.scale(face, 1);
    const R = (x, y, w2, h, c) => { ctx.fillStyle = c; ctx.fillRect(x * u, y * u, w2 * u, h * u); };
    R(-2.5, 0, 5, 1, 'rgba(0,0,0,0.25)');                                       // shadow
    R(-1.5, -3, 1, 3, '#3a3f4a'); R(0.5, -3, 1, 3, '#3a3f4a');                  // legs
    R(-1.5, -7, 3, 4, cabin ? '#b8433a' : '#3f6ea8');                           // shirt: lumberjack red, miner blue
    if (cabin) R(-1.5, -5, 3, 1, '#7a2a24');                                    // plaid stripe
    R(-1, -9, 2, 2, '#f0c08a');                                                 // head
    if (cabin) R(-1.2, -10, 2.4, 1, '#5a3a22'); else R(-1.5, -10, 3, 1.2, '#f2c14e');   // cap / hard hat
    // the tool, swung from the shoulder
    ctx.save(); ctx.translate(0.5 * u, -6.5 * u); ctx.rotate(a);
    R(0, -0.4, 6, 0.8, '#8a5a34');                                              // handle
    if (cabin) { R(5, -2, 1.6, 2.4, '#c9ced6'); R(5, -2, 1.6, 0.6, '#eef2f8'); }   // axe head
    else { R(5.2, -2.6, 0.9, 5.2, '#9aa3ad'); R(5.2, -2.6, 0.9, 0.8, '#d6dade'); } // pick head
    ctx.restore();
    // chips flying off the hit
    if (effort > 0 && p >= 0.72 && p < 0.95) {
      const q = (p - 0.72) / 0.23, ix = 6 * u, iy = -3 * u, cyc = Math.floor(game.time / period + v);
      for (let k = 0; k < 5; k++) {
        const h1 = hash2(cyc, k, 79 + w), h2 = hash2(k, cyc, 80 + w);
        const cx = ix + (h1 - 0.25) * 9 * u * q, cy = iy - (2 + h2 * 4) * u * q + 9 * u * q * q;
        const col = cabin ? (k % 2 ? '#d9a066' : '#8a5a3c') : iron && k < 2 ? '#ffd166' : k % 2 ? '#b8bdc2' : '#7d848c';
        ctx.globalAlpha = 1 - q * 0.6;
        R(cx / u - 0.5, cy / u - 0.5, k < 2 && !cabin && iron ? 0.8 : 1.1, k < 2 && !cabin && iron ? 0.8 : 1.1, col);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  });
}

// ======================================================================
// terrain image
// ======================================================================
const terrainCanvas = document.createElement('canvas');
function paintTerrain() {
  terrainCanvas.width = W; terrainCanvas.height = H;
  const g = terrainCanvas.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  const SHALLOW = [96, 152, 192], DEEP = [55, 108, 158];
  const GR_LO = [166, 199, 122], GR_HI = [182, 194, 132], HILL = [212, 192, 148];
  const DS_A = [231, 210, 152], DS_B = [212, 186, 124];
  const MT_LO = [150, 146, 136], MT_HI = [240, 240, 236];
  const FOREST_A = [78, 126, 60], FOREST_B = [98, 146, 72], STONE = [168, 172, 176], IRON = [156, 98, 74];
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i / W) | 0;
    let c;
    const b = biome[i];
    if (b === VOID) { d[i * 4 + 3] = 0; continue; }   // transparent: space shows through
    if (b === OCEAN) {
      c = mix(SHALLOW, DEEP, clamp(oceanDist[i] / 16, 0, 1));
    } else if (b === GRASS) {
      const h = clamp((elev[i] - seaLevel) / (mtnLevel - seaLevel), 0, 1);
      c = mix(GR_LO, GR_HI, h);
      if (detail[i] > 0.58 && h > 0.3) c = mix(c, HILL, clamp((detail[i] - 0.58) * 3.5, 0, 0.75));
    } else if (b === DESERT) {
      c = mix(DS_A, DS_B, clamp((detail[i] - 0.3) * 1.6, 0, 1));
    } else if (b === ICE) {
      // polar ice sheet: pale blue, a little brighter on higher ground, with darker crevasses
      c = mix([188, 212, 232], [234, 243, 250], clamp((elev[i] - seaLevel) * 2.2 + (detail[i] - 0.5) * 0.6, 0, 1));
      if (detail[i] > 0.6 && detail[i] < 0.63) c = mix(c, [140, 172, 204], 0.6);
    } else if (b === WALL) {
      // bright cliff top on the inside, colder blue toward the drop into space, with cracks
      c = mix([248, 251, 253], [150, 178, 206], clamp(iceT[i] * 0.9 + (detail[i] - 0.5) * 0.4, 0, 1));
      if (detail[i] > 0.62) c = mix(c, [190, 212, 232], 0.7);
    } else {
      const h = clamp((elev[i] - mtnLevel) / (maxElev - mtnLevel + 1e-6), 0, 1);
      c = mix(MT_LO, MT_HI, clamp(h * 1.2 + (detail[i] - 0.5) * 0.5, 0, 1));
    }
    const dep = depositOf[i];
    if (dep >= 0) {
      const t = deposits[dep].type;
      if (t === 'forest') c = hash2(x, y, SEED + 1) > 0.5 ? FOREST_A : FOREST_B;
      else if (t === 'stone') c = mix(STONE, [120, 124, 128], hash2(x, y, SEED + 2) * 0.5);
      else if (t === 'uranium') c = mix([78, 90, 66], [62, 84, 58], hash2(x, y, SEED + 4));   // dark and quiet: easy to miss
      else c = mix(IRON, [110, 66, 50], hash2(x, y, SEED + 3) * 0.5);
    }
    const j = (hash2(x, y, SEED + 9) - 0.5) * (b === OCEAN ? 4 : 10);
    const o = i * 4;
    d[o] = c[0] + j; d[o + 1] = c[1] + j; d[o + 2] = c[2] + j; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ======================================================================
// camera + rendering
// ======================================================================
const canvas = $('game');
const ctx = canvas.getContext('2d');
let cw = 0, ch = 0, dpr = 1;
// follow: null, or 'moon' to lock the camera onto the moon (its reference frame);
// offX/offY = where you're looking, in the moon's own coordinates; rot = camera rotation (radians)
const cam = { x: 0, y: 0, zoom: CFG.startZoom, follow: null, offX: 0, offY: 0, rot: 0, cos: 1, sin: 0, a0: 0 };
function setCamRot(r) { cam.rot = r; cam.cos = Math.cos(r); cam.sin = Math.sin(r); }
let savedView = null;

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);   // phones report 3: not worth 2.25x the pixels
  cw = window.innerWidth; ch = window.innerHeight;
  canvas.width = cw * dpr; canvas.height = ch * dpr;
}
// world <-> screen, including camera rotation (only non-zero while locked onto the moon)
const toScreen = (wx, wy) => {
  const dx = (wx - cam.x) * cam.zoom, dy = (wy - cam.y) * cam.zoom;
  return [dx * cam.cos - dy * cam.sin + cw / 2, dx * cam.sin + dy * cam.cos + ch / 2];
};
const toWorld = (sx, sy) => {
  const dx = sx - cw / 2, dy = sy - ch / 2;
  return [(dx * cam.cos + dy * cam.sin) / cam.zoom + cam.x, (-dx * cam.sin + dy * cam.cos) / cam.zoom + cam.y];
};
// draw a 1-px-per-tile world image (terrain, territory) with the camera's pan, zoom and rotation
function drawWorldImage(img) {
  const z = cam.zoom;
  ctx.save();
  ctx.translate(cw / 2, ch / 2); ctx.rotate(cam.rot);
  ctx.drawImage(img, -cam.x * z, -cam.y * z, W * z, H * z);
  ctx.restore();
}
const tileCenter = i => [i % W + 0.5, ((i / W) | 0) + 0.5];
const fitZoom = () => Math.min(cw / W, (ch - 200) / H) * 0.96;

function pill(x, y, text, { bg = 'rgba(20,26,37,0.9)', fg = '#eef2f8', border = null, dot = null, size = 12, bold = 700 } = {}) {
  ctx.font = `${bold} ${size}px 'Segoe UI', Inter, Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + (dot ? 30 : 20), h = size + 10;
  const left = x - w / 2, top = y - h / 2;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, h / 2);
  ctx.fillStyle = bg; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke(); }
  if (dot) { ctx.beginPath(); ctx.arc(left + 12, y, 4, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill(); }
  ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';   // left: other drawing may have centred it
  ctx.fillText(text, left + (dot ? 21 : 10), y + 0.5);
  return w;
}
// The one look for "this is the thing you're pointing at / have picked": a gold dashed circle, like the ring round
// your world from far out. A faint dark line under the dashes keeps it readable on bright ground; `march` slowly
// runs the dashes round (picked things), `alpha` fades it in and out.
function dashRing(sx, sy, r, color = '#f2c14e', { alpha = 1, width = 2, march = 0 } = {}) {
  if (alpha < 0.01 || r < 1) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.lineWidth = width + 2; ctx.strokeStyle = 'rgba(10,14,22,0.35)'; ctx.stroke();
  ctx.setLineDash([5, 4]); ctx.lineDashOffset = march ? -(performance.now() / 1000) * march : 0;
  ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
  ctx.restore();
}

// ---------- outer space ----------
const STAR_TILE = 1024;
const starCanvas = document.createElement('canvas');
let starPattern = null;
function makeStars() {
  const S = STAR_TILE;
  starCanvas.width = starCanvas.height = S;
  const g = starCanvas.getContext('2d');
  g.fillStyle = '#04050b'; g.fillRect(0, 0, S, S);
  const r = mulberry32(SEED + 999);
  // faint nebulae (each drawn 9 times so the tile repeats seamlessly)
  const tints = ['96,64,170', '40,96,180', '150,56,128', '30,120,150'];
  for (let k = 0; k < 6; k++) {
    const x = r() * S, y = r() * S, rad = 140 + r() * 260, tint = tints[k % tints.length], a = 0.07 + r() * 0.08;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgba(${tint},${a})`); gr.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  // stars: mostly tiny and dim, a few bright ones with a halo
  for (let k = 0; k < 1300; k++) {
    const x = (r() * S) | 0, y = (r() * S) | 0, b = r();
    const warm = r() < 0.15;
    g.fillStyle = warm ? `rgba(255,226,190,${0.3 + b * 0.7})` : `rgba(215,228,255,${0.2 + b * 0.8})`;
    const sz = b > 0.96 ? 2 : 1;
    g.fillRect(x, y, sz, sz);
    if (b > 0.985) {
      const gr = g.createRadialGradient(x + 1, y + 1, 0, x + 1, y + 1, 6);
      gr.addColorStop(0, 'rgba(220,232,255,0.45)'); gr.addColorStop(1, 'rgba(220,232,255,0)');
      g.fillStyle = gr; g.fillRect(x - 6, y - 6, 14, 14);
    }
  }
  starPattern = ctx.createPattern(starCanvas, 'repeat');
}

function drawSpace(z) {
  // stars drift slowly as you pan (parallax), so they feel far away.
  // Locked onto the moon, they hold still: you're standing in the moon's frame,
  // so only your own panning around it moves them.
  const S = STAR_TILE;
  const px = cam.follow ? cam.offX : cam.x, py = cam.follow ? cam.offY : cam.y;
  const ox = (((-px * z * 0.1) % S) + S) % S, oy = (((-py * z * 0.1) % S) + S) % S;
  ctx.save(); ctx.translate(ox, oy);
  ctx.fillStyle = starPattern; ctx.fillRect(-ox, -oy, cw, ch);
  ctx.restore();
  // a soft atmospheric glow hugging the rim of the disk
  const [dx, dy] = toScreen(DISK.cx, DISK.cy), R = DISK.R * z;
  const gr = ctx.createRadialGradient(dx, dy, R * 0.97, dx, dy, R * 1.1);
  gr.addColorStop(0, 'rgba(170,210,255,0.42)'); gr.addColorStop(0.35, 'rgba(120,170,255,0.14)'); gr.addColorStop(1, 'rgba(120,170,255,0)');
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(dx, dy, R * 1.1, 0, Math.PI * 2); ctx.fill();
}

// ---------- the moon ----------
const MOON = {
  r: CFG.moon.radius, size: CFG.moon.radius * 2 + 6,
  orbitR: DISK.R * CFG.moon.orbit, period: CFG.moon.period,
  phase: hash2(SEED, 7, 77) * Math.PI * 2,
};
const moonCanvas = document.createElement('canvas');
// per-pixel moon biome (0 = basalt plains, 1 = highlands, 255 = off the moon), for hover info
const moonBiome = new Uint8Array(MOON.size * MOON.size);
const MOON_BIOME_NAME = ['Basalt plains', 'Highlands'];

// The moon is generated from the same seed as the disk, so a seed always gives the same pair.
// It's built as a height map (biomes + mountains + crater bowls and rims) and then lit from
// the upper left, so ridges, crater walls and rims get real light and shadow.
function paintMoon() {
  const S = MOON.size, c0 = S / 2, R = MOON.r;
  moonCanvas.width = moonCanvas.height = S;
  const g = moonCanvas.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const rnd = mulberry32(SEED + 4242), s = SEED + 300;
  const N2 = S * S;
  const hgt = new Float32Array(N2), high = new Float32Array(N2), bio = new Float32Array(N2);
  const inside = i => moonBiome[i] !== 255;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // 1) biome field. Real maria are lava that filled giant round impact basins, so the plains
  //    collect in a few big basins with ragged edges, plus some looser patches.
  const basins = [];
  for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.75;
    basins.push({ x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: R * (0.18 + rnd() * 0.28) });
  }
  const vals = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) { moonBiome[i] = 255; continue; }
    moonBiome[i] = 0;
    const wx = x + (fbm(x / 40, y / 40, s + 7, 3) - 0.5) * 34;
    const wy = y + (fbm(x / 40, y / 40, s + 8, 3) - 0.5) * 34;
    let basin = 0;
    for (const bs of basins) basin = Math.max(basin, 1 - Math.hypot(wx - bs.x, wy - bs.y) / bs.r);
    bio[i] = fbm(wx / 62, wy / 62, s + 2, 4) * 0.55 - clamp(basin, 0, 1) * 0.45;
    vals.push(bio[i]);
  }
  vals.sort((a, b) => a - b);
  const level = vals[Math.floor(vals.length * CFG.moon.plainsShare)];

  // 2) height: rugged ridges + hills on the highlands, nearly flat plains with faint wrinkles
  for (let i = 0; i < N2; i++) {
    if (!inside(i)) continue;
    const x = i % S, y = (i / S) | 0;
    const h = smooth(level - 0.025, level + 0.035, bio[i]);       // crisp: for colour and biome
    const hh = smooth(level - 0.08, level + 0.16, bio[i]);        // gentle: for height, so basin edges are soft slopes
    high[i] = h;
    moonBiome[i] = h > 0.5 ? 1 : 0;
    const ridge = 1 - Math.abs(2 * fbm(x / 15, y / 15, s + 5, 4) - 1);
    const hills = fbm(x / 7, y / 7, s + 6, 3);
    const wrinkles = 1 - Math.abs(2 * fbm(x / 22, y / 22, s + 9, 3) - 1);
    hgt[i] = hh * (0.05 + 0.1 * ridge * ridge + 0.08 * hills) + (1 - hh) * (0.035 * wrinkles * wrinkles + 0.01 * hills);
  }

  // 3) craters: dense on the old highlands, sparse on the younger plains
  const craters = [];
  for (let tries = 0; craters.length < CFG.moon.craters && tries < CFG.moon.craters * 20; tries++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.97;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist;
    let cr = 1.2 + Math.pow(rnd(), 5) * 28;
    if (moonBiome[(cy | 0) * S + (cx | 0)] === 0) {          // plains are young: few craters, all small
      if (rnd() > 0.18) continue;
      cr = Math.min(cr, 5);
    }
    craters.push({ x: cx, y: cy, r: cr });
  }
  for (const c of craters) {
    const depth = 0.035 + 0.009 * c.r, ext = Math.ceil(c.r * 1.4);
    for (let y = Math.max(0, (c.y | 0) - ext); y <= Math.min(S - 1, (c.y | 0) + ext); y++)
      for (let x = Math.max(0, (c.x | 0) - ext); x <= Math.min(S - 1, (c.x | 0) + ext); x++) {
        const i = y * S + x;
        if (!inside(i)) continue;
        const dd = Math.hypot(x - c.x, y - c.y) / c.r;
        if (dd < 1) {
          hgt[i] = hgt[i] * dd - depth * (1 - dd * dd);                                     // bowl (flattens terrain inside)
          if (c.r > 11 && dd < 0.22) hgt[i] += depth * 0.55 * (1 - dd / 0.22);            // central peak in big craters
        } else if (dd < 1.38) hgt[i] += depth * 0.4 * Math.max(0, 1 - Math.abs(dd - 1.1) / 0.28); // raised rim
      }
  }
  // a few young craters throw bright rays across the surface
  const young = craters.filter(c => c.r > 7).sort(() => rnd() - 0.5).slice(0, 3);

  // 4) light it and colour it
  const PLAINS = [104, 103, 104], HIGH = [198, 196, 191];
  for (let i = 0; i < N2; i++) {
    const o = i * 4;
    if (!inside(i)) { d[o + 3] = 0; continue; }
    const x = i % S, y = (i / S) | 0;
    // slope measured over 2 px for smoother, softer light from the upper left
    const a = (x > 1 && y > 1 && inside(i - 2 * S - 2)) ? hgt[i - 2 * S - 2] : hgt[i];
    const b = (x < S - 2 && y < S - 2 && inside(i + 2 * S + 2)) ? hgt[i + 2 * S + 2] : hgt[i];
    const shade = clamp(1 + (a - b) * 2.3, 0.64, 1.3);
    let col = mix(PLAINS, HIGH, high[i]);
    const fine = fbm(x / 4, y / 4, s + 1, 2);
    col = mix(col, [col[0] * 0.9, col[1] * 0.9, col[2] * 0.9], fine * 0.45);
    col = [col[0] * shade, col[1] * shade, col[2] * shade];
    for (let k = 0; k < young.length; k++) {
      const c = young[k], dx = x - c.x, dy = y - c.y, dist = Math.hypot(dx, dy);
      if (dist < c.r * 1.15 || dist > c.r * 8) continue;
      const ang = Math.atan2(dy, dx);
      const n = vnoise(Math.cos(ang) * 5 + k * 13, Math.sin(ang) * 5, s + 40 + k);   // seamless around the circle
      const streak = Math.pow(clamp((n - 0.55) * 2.6, 0, 1), 2) * (1 - dist / (c.r * 8));
      col = mix(col, [228, 227, 224], streak * 0.6);
    }
    const dist = Math.hypot(x + 0.5 - c0, y + 0.5 - c0);
    col = mix(col, [0, 0, 0], 0.25 * Math.pow(dist / R, 4));   // darker toward the edge
    const j = (hash2(x, y, s + 3) - 0.5) * 7;
    d[o] = clamp(col[0] + j, 0, 255); d[o + 1] = clamp(col[1] + j, 0, 255); d[o + 2] = clamp(col[2] + j, 0, 255); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// ---------- the sun ----------
const SUN = {
  r: DISK.R * CFG.sun.radius, dist: MOON.orbitR * CFG.sun.distance, year: CFG.sun.year,
  phase: hash2(SEED, 9, 99) * Math.PI * 2,
};
const sunCanvas = document.createElement('canvas');

function paintSun() {
  const S = 256, c0 = S / 2, R = S / 2 - 2;
  sunCanvas.width = sunCanvas.height = S;
  const g = sunCanvas.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const rnd = mulberry32(SEED + 777), s = SEED + 900;
  const spots = [];
  for (let k = 0; k < 5; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.7;
    spots.push({ x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: 2 + rnd() * 5 });
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = (y * S + x) * 4, dist = Math.hypot(x + 0.5 - c0, y + 0.5 - c0);
    if (dist > R) { d[o + 3] = 0; continue; }
    const t = dist / R, limb = Math.sqrt(1 - t * t);              // bright centre, deep orange edge
    let col = mix([255, 140, 40], [255, 247, 220], Math.pow(limb, 0.55));
    const k = 0.9 + (fbm(x / 3, y / 3, s, 3) - 0.5) * 0.32;     // granulation: boiling surface cells
    col = [col[0] * k, col[1] * k, col[2] * k];
    for (const sp of spots) {                                    // sunspots
      const dd = Math.hypot(x - sp.x, y - sp.y) / sp.r;
      if (dd < 1) col = mix(col, [110, 45, 18], 0.8 * (1 - dd * dd));
      else if (dd < 1.7) col = mix(col, [205, 110, 40], 0.35 * (1 - (dd - 1) / 0.7));
    }
    d[o] = clamp(col[0], 0, 255); d[o + 1] = clamp(col[1], 0, 255); d[o + 2] = clamp(col[2], 0, 255); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// The world is centred on the disk, so the sun sits opposite the disk's position on its orbit.
function sunPos() {
  const a = SUN.phase + (game.time / SUN.year) * Math.PI * 2;
  return [DISK.cx - Math.cos(a) * SUN.dist, DISK.cy - Math.sin(a) * SUN.dist, a];
}
function overSun(wx, wy) {
  const [sx, sy] = sunPos();
  return Math.hypot(wx - sx, wy - sy) < Math.max(SUN.r, 24 / cam.zoom);
}

// ---------- Vulcan: a lava hellscape between the sun and your world ----------
const VULCAN = {
  r: DISK.R * CFG.vulcan.size, tex: 2,      // tex: tiles per texture pixel (keeps generation fast)
  orbit: SUN.dist * CFG.vulcan.orbit, year: CFG.vulcan.year, spinPeriod: CFG.vulcan.spin,
  phase: hash2(SEED, 11, 111) * Math.PI * 2,
};
VULCAN.texR = VULCAN.r / VULCAN.tex;
VULCAN.size = Math.ceil(VULCAN.texR * 2) + 6;
const vulcanCanvas = document.createElement('canvas');
const vulcanGlow = document.createElement('canvas');     // lava light, drawn on top so it glows on the night side
const vulcanBiome = new Uint8Array(VULCAN.size * VULCAN.size);
const VB = { LAVA: 0, OBSIDIAN: 1, ASH: 2, SULFUR: 3, METAL: 4, VOLCANO: 5 };
const VULCAN_BIOME_NAME = ['Lava sea', 'Obsidian plains', 'Ash wastes', 'Sulfur flats', 'Heavy-metal ridges', 'Volcano'];

function paintVulcan() {
  const S = VULCAN.size, c0 = S / 2, R = VULCAN.texR, N2 = S * S;
  vulcanCanvas.width = vulcanCanvas.height = S;
  vulcanGlow.width = vulcanGlow.height = S;
  const g = vulcanCanvas.getContext('2d'), gg = vulcanGlow.getContext('2d');
  const img = g.createImageData(S, S), d = img.data, gimg = gg.createImageData(S, S), gd = gimg.data;
  const rnd = mulberry32(SEED + 5151), s = SEED + 1300;

  // volcanoes: big cones scattered across the surface
  const volc = [];
  for (let k = 0; k < 9; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.85;
    volc.push({ x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: R * (0.06 + rnd() * 0.09) });
  }

  // 1) height (warped noise + volcano cones) and distance to the nearest volcano
  const hgt = new Float32Array(N2), near = new Float32Array(N2).fill(99), nearAng = new Float32Array(N2), nearK = new Uint8Array(N2);
  const vals = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) { vulcanBiome[i] = 255; continue; }
    vulcanBiome[i] = 0;
    const wx = x + (fbm(x / 30, y / 30, s + 1, 3) - 0.5) * 24, wy = y + (fbm(x / 30, y / 30, s + 2, 3) - 0.5) * 24;
    let h = fbm(wx / 45, wy / 45, s, 5), cone = 0;
    for (let k = 0; k < volc.length; k++) {
      const v = volc[k], dx = x - v.x, dy = y - v.y, dd = Math.hypot(dx, dy) / v.r;
      if (dd < near[i]) { near[i] = dd; nearAng[i] = Math.atan2(dy, dx); nearK[i] = k; }
      if (dd < 2.2) cone = Math.max(cone, Math.pow(1 - dd / 2.2, 1.6));
    }
    h += cone * 0.45;
    hgt[i] = h;
    vals.push(h);
  }
  vals.sort((a, b) => a - b);
  const lavaLevel = vals[Math.floor(vals.length * CFG.vulcan.lavaShare)];
  const H = i => (vulcanBiome[i] === 255 ? null : hgt[i]);

  // 2) biomes, colour, and the glow layer
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4;
    if (vulcanBiome[i] === 255) { d[o + 3] = 0; gd[o + 3] = 0; continue; }
    const h = hgt[i], nd = near[i];
    const ridge = 1 - Math.abs(2 * fbm(x / 12, y / 12, s + 5, 4) - 1);
    const sulf = fbm(x / 22, y / 22, s + 6, 3), ash = fbm(x / 40, y / 40, s + 7, 3);
    const fine = fbm(x / 3, y / 3, s + 3, 2);
    let b;
    if (nd < 0.2) b = VB.VOLCANO;                                   // caldera
    else if (h < lavaLevel) b = VB.LAVA;
    else if (nd < 1.1) b = VB.VOLCANO;                              // volcano slopes
    else if (sulf > 0.7 || (nd < 2.4 && sulf > 0.57)) b = VB.SULFUR;
    else if (ridge > 0.86 && h > lavaLevel + 0.06) b = VB.METAL;
    else if (ash > 0.5) b = VB.ASH;
    else b = VB.OBSIDIAN;
    vulcanBiome[i] = b;

    // baked relief, lit from the upper left
    const ha = (x > 0 && y > 0 && H(i - S - 1) !== null) ? hgt[i - S - 1] : h;
    const hb = (x < S - 1 && y < S - 1 && H(i + S + 1) !== null) ? hgt[i + S + 1] : h;
    const shade = clamp(1 + (ha - hb) * 5, 0.55, 1.45);
    const lit = c => [c[0] * shade, c[1] * shade, c[2] * shade];

    let col, glow = 0;
    if (b === VB.LAVA) {
      const plate = fbm(x / 10, y / 10, s + 8, 3);
      const crack = Math.abs(fbm(x / 7, y / 7, s + 9, 3) - 0.5) < 0.03;
      const molten = clamp((lavaLevel - h) * 12, 0, 1);              // deeper = more open melt
      if (crack) { col = [255, 196, 84]; glow = 1; }                 // glowing crack between plates
      else if (plate > 0.47 - molten * 0.3) { col = mix([46, 22, 18], [76, 34, 24], fine * 0.6); glow = 0.05; }   // cooled crust plate
      else { col = mix([248, 118, 30], [196, 50, 16], plate); glow = 0.72; }                                    // open melt
    } else if (b === VB.VOLCANO) {
      if (nd < 0.2) { col = [255, 192, 72]; glow = 1; }             // glowing caldera
      else {
        col = lit(mix([48, 38, 36], [72, 56, 50], fine * 0.7));
        if (nd < 0.3) col = lit([92, 70, 60]);                       // crater rim
        // lava flows: meander as they run downhill, and get thinner further from the crater
        const wob = (fbm(x / 9, y / 9, s + 21, 2) - 0.5) * 1.4 * nd;
        const ang = nearAng[i] + wob;
        const flow = vnoise(Math.cos(ang) * 9 + nearK[i] * 17, Math.sin(ang) * 9, s + 20);
        const thr = 0.72 + nd * 0.14;
        if (flow > thr && nd < 1.0) {
          const t = clamp((flow - thr) * 9, 0, 1);
          col = mix(col, [245, 108, 28], t); glow = t * (1 - nd * 0.7);
        }
      }
    } else if (b === VB.SULFUR) {
      const sv = fbm(x / 9, y / 9, s + 15, 3);
      col = sv > 0.5 ? mix([230, 206, 70], [242, 232, 150], (sv - 0.5) * 2) : mix([206, 150, 46], [230, 206, 70], sv * 2);
      if (nd < 2.4) col = mix(col, [172, 192, 72], clamp((2.4 - nd) * 0.2, 0, 0.4));   // greener near the vents
      if (hash2(x, y, s + 11) > 0.985) col = [252, 248, 214];                            // crystals
      col = lit(col);
    } else if (b === VB.METAL) {
      col = mix([132, 68, 44], [80, 58, 52], fine * 0.7);
      if (hash2(x, y, s + 12) > 0.93) col = [214, 216, 226];                             // heavy-metal glints
      col = lit(col);
    } else if (b === VB.ASH) {
      col = lit(mix([124, 116, 110], [98, 92, 88], fine * 0.7));
    } else {
      col = mix([34, 30, 36], [50, 44, 52], fine * 0.7);
      if (Math.abs(fbm(x / 18, y / 18, s + 13, 3) - 0.5) < 0.012) { col = [235, 90, 30]; glow = 0.8; }   // glowing fissure
      else {
        col = lit(col);
        if (shade > 1.25 && hash2(x, y, s + 14) > 0.8) col = mix(col, [150, 150, 172], 0.5);            // glassy glints
      }
    }
    const t = Math.hypot(x + 0.5 - c0, y + 0.5 - c0) / R;
    const limb = 1 - 0.25 * Math.pow(t, 4);
    d[o] = clamp(col[0] * limb, 0, 255); d[o + 1] = clamp(col[1] * limb, 0, 255); d[o + 2] = clamp(col[2] * limb, 0, 255); d[o + 3] = 255;
    if (glow > 0.05) { gd[o] = 255; gd[o + 1] = 110 + 70 * glow; gd[o + 2] = 30; gd[o + 3] = clamp(glow * 200, 0, 255); }
    else gd[o + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  gg.putImageData(gimg, 0, 0);
}

// Vulcan orbits the sun; it also spins on its own axis
function vulcanPos() {
  const [sx, sy] = sunPos();
  const b = VULCAN.phase + (game.time / VULCAN.year) * Math.PI * 2;
  return [sx + Math.cos(b) * VULCAN.orbit, sy + Math.sin(b) * VULCAN.orbit, (game.time / VULCAN.spinPeriod) * Math.PI * 2];
}
function overVulcan(wx, wy) {
  const [vx, vy] = vulcanPos();
  return Math.hypot(wx - vx, wy - vy) < Math.max(VULCAN.r, 24 / cam.zoom);
}
function vulcanBiomeAt(wx, wy) {
  const [vx, vy, spin] = vulcanPos();
  const dx = wx - vx, dy = wy - vy, c = Math.cos(-spin), sn = Math.sin(-spin);
  const lx = Math.floor((dx * c - dy * sn) / VULCAN.tex + VULCAN.size / 2);
  const ly = Math.floor((dx * sn + dy * c) / VULCAN.tex + VULCAN.size / 2);
  if (lx < 0 || ly < 0 || lx >= VULCAN.size || ly >= VULCAN.size) return null;
  const b = vulcanBiome[ly * VULCAN.size + lx];
  return b === 255 ? null : VULCAN_BIOME_NAME[b];
}

function drawVulcan(z) {
  const [vx, vy, spin] = vulcanPos();
  const [sx, sy] = toScreen(vx, vy), rr = VULCAN.r * z;
  // its orbit around the sun (faint red dashed ring) when zoomed far out
  if (z < 0.01) {
    const [cx, cy] = toScreen(...sunPos().slice(0, 2));
    ctx.setLineDash([4, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,120,80,0.22)';
    ctx.beginPath(); ctx.arc(cx, cy, VULCAN.orbit * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const haloR = Math.max(rr * 1.2, 18);
  if (sx + haloR < 0 || sy + haloR < 0 || sx - haloR > cw || sy - haloR > ch) return;
  // hot, hazy atmosphere glow
  const gl = ctx.createRadialGradient(sx, sy, Math.max(rr * 0.95, 2), sx, sy, haloR);
  gl.addColorStop(0, 'rgba(255,110,50,0.38)'); gl.addColorStop(1, 'rgba(255,110,50,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, haloR, 0, Math.PI * 2); ctx.fill();
  if (rr < 5) {
    ctx.fillStyle = '#d9653a'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(rr, 3.5), 0, Math.PI * 2); ctx.fill();
    pill(sx, sy + 22, 'Vulcan', { fg: '#ffb08a', size: 12 });
    return;
  }
  const scale = VULCAN.tex * z, half = VULCAN.size / 2 * scale;
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
  ctx.imageSmoothingEnabled = scale < 1.5;
  ctx.drawImage(vulcanCanvas, -half, -half, half * 2, half * 2);
  ctx.restore();
  // day/night from the sun's direction
  const [ssx, ssy] = toScreen(...sunPos().slice(0, 2));
  let ldx = ssx - sx, ldy = ssy - sy;
  const ll = Math.hypot(ldx, ldy) || 1; ldx /= ll; ldy /= ll;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.clip();
  const lg = ctx.createLinearGradient(sx + ldx * rr, sy + ldy * rr, sx - ldx * rr * 1.4, sy - ldy * rr * 1.4);
  lg.addColorStop(0, 'rgba(0,0,12,0)'); lg.addColorStop(0.45, 'rgba(0,0,12,0.15)'); lg.addColorStop(0.75, 'rgba(0,0,12,0.6)'); lg.addColorStop(1, 'rgba(0,0,12,0.88)');
  ctx.fillStyle = lg; ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  ctx.restore();
  // lava light on top, so the lava still glows on the night side
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85;
  ctx.imageSmoothingEnabled = scale < 1.5;
  ctx.drawImage(vulcanGlow, -half, -half, half * 2, half * 2);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  if (rr < 160) pill(sx, sy + rr + 22, 'Vulcan', { fg: '#ffb08a', size: 12 });
}

// your world can be clicked to lock on when it's small on screen, or while you're locked onto
// the moon or the sun (up close, clicks on your land still push your border)
const WORLD_LOCK_ZOOM = 0.15;
function worldLockable() { return !!cam.follow || cam.zoom < WORLD_LOCK_ZOOM; }
function overWorld(wx, wy) {
  return Math.hypot(wx - DISK.cx, wy - DISK.cy) < Math.max(DISK.R, 24 / cam.zoom);
}

function drawSun(z) {
  const [wx, wy] = sunPos();
  const [sx, sy] = toScreen(wx, wy), rr = SUN.r * z;
  // your world's orbit around the sun (faint dashed ring), when zoomed far enough out to matter
  if (z < 0.03) {
    ctx.setLineDash([4, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,205,130,0.22)';
    ctx.beginPath(); ctx.arc(sx, sy, SUN.dist * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const glowR = Math.max(rr * 3.2, 28);
  if (sx + glowR < 0 || sy + glowR < 0 || sx - glowR > cw || sy - glowR > ch) return;
  // corona glow (additive, so it brightens the stars behind it)
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const gl = ctx.createRadialGradient(sx, sy, Math.max(rr * 0.9, 2), sx, sy, glowR);
  gl.addColorStop(0, 'rgba(255,190,90,0.6)'); gl.addColorStop(0.3, 'rgba(255,150,60,0.2)'); gl.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, glowR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (rr < 4) {
    ctx.fillStyle = '#fff3d0'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(game.time / 200);   // slow spin
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sunCanvas, -rr * 128 / 126, -rr * 128 / 126, rr * 256 / 126, rr * 256 / 126);
    ctx.restore();
  }
  if (rr < 160) pill(sx, sy + Math.max(rr, 4) + 24, 'The Sun', { fg: '#ffe2a8', size: 12 });
}

// which moon biome is under a world point (null if none)
function moonBiomeAt(wx, wy) {
  const [mx, my, a] = moonPos();
  const dx = wx - mx, dy = wy - my, c = Math.cos(-a), sn = Math.sin(-a);
  const lx = Math.floor(dx * c - dy * sn + MOON.size / 2), ly = Math.floor(dx * sn + dy * c + MOON.size / 2);
  if (lx < 0 || ly < 0 || lx >= MOON.size || ly >= MOON.size) return null;
  const b = moonBiome[ly * MOON.size + lx];
  return b === 255 ? null : MOON_BIOME_NAME[b];
}

function moonPos() {
  const a = MOON.phase + (game.time / MOON.period) * Math.PI * 2;
  return [DISK.cx + Math.cos(a) * MOON.orbitR, DISK.cy + Math.sin(a) * MOON.orbitR, a];
}

function drawMoon(z) {
  if (MOON.orbitR * z < 6) return;   // from far out it would just sit on top of your world
  const [mx, my, a] = moonPos();
  const [sx, sy] = toScreen(mx, my), rr = MOON.r * z;
  // faint orbit line when zoomed out
  if (z < 1.6) {
    const [cx, cy] = toScreen(DISK.cx, DISK.cy);
    ctx.setLineDash([3, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(200,215,255,0.2)';
    ctx.beginPath(); ctx.arc(cx, cy, MOON.orbitR * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (sx + rr * 1.2 < 0 || sy + rr * 1.2 < 0 || sx - rr * 1.2 > cw || sy - rr * 1.2 > ch) return;
  if (rr < 5) {
    // so far out the moon is just a speck: draw a small glowing dot so it can still be found
    const gd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12);
    gd.addColorStop(0, 'rgba(225,230,240,0.5)'); gd.addColorStop(1, 'rgba(225,230,240,0)');
    ctx.fillStyle = gd; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9ccd4'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(rr, 3.5), 0, Math.PI * 2); ctx.fill();
    if (z > 0.006) pill(sx, sy + 22, 'The Moon', { fg: '#dfe4ee', size: 12 });
    return;
  }
  // soft glow
  const gl = ctx.createRadialGradient(sx, sy, rr * 0.95, sx, sy, rr * 1.18);
  gl.addColorStop(0, 'rgba(225,230,240,0.28)'); gl.addColorStop(1, 'rgba(225,230,240,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, rr * 1.18, 0, Math.PI * 2); ctx.fill();
  // body: tidally locked, so it turns as it orbits and the same face always points at the disk
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(a + cam.rot);   // while locked on, cam.rot cancels the spin exactly
  ctx.imageSmoothingEnabled = z < 1.5;
  ctx.drawImage(moonCanvas, -MOON.size / 2 * z, -MOON.size / 2 * z, MOON.size * z, MOON.size * z);
  ctx.restore();
  // sunlight comes from the actual sun, so the day/night shadow swings round as the moon orbits (phases)
  const [ssx, ssy] = toScreen(...sunPos().slice(0, 2));
  let ldx = ssx - sx, ldy = ssy - sy;
  const ll = Math.hypot(ldx, ldy) || 1; ldx /= ll; ldy /= ll;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.clip();
  const lg = ctx.createLinearGradient(sx + ldx * rr, sy + ldy * rr, sx - ldx * rr * 1.4, sy - ldy * rr * 1.4);
  lg.addColorStop(0, 'rgba(0,0,12,0)'); lg.addColorStop(0.45, 'rgba(0,0,12,0.12)'); lg.addColorStop(0.75, 'rgba(0,0,12,0.5)'); lg.addColorStop(1, 'rgba(0,0,12,0.82)');
  ctx.fillStyle = lg; ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  if (z < 2.5) pill(sx, sy + Math.max(rr, 4) + 18, 'The Moon', { fg: '#dfe4ee', size: 12 });
}

// when the disk is only a few pixels wide, label it so you can find home
function drawDiskLabel(z) {
  if (z > 0.15) return;
  const [dx, dy] = toScreen(DISK.cx, DISK.cy);
  if (DISK.R * z < 3) { ctx.fillStyle = '#6fa3d6'; ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2); ctx.fill(); }
  pill(dx, dy + Math.max(DISK.R * z, 4) + 28, 'Your world', { fg: '#cfe0ff', size: 12 });   // clear of the ring round it
}

function overMoon(wx, wy) {
  const [mx, my] = moonPos();
  // at least ~24 px to aim at, so the tiny dot is still easy to click from far out
  return Math.hypot(wx - mx, wy - my) < Math.max(MOON.r, 24 / cam.zoom);
}

// ======================================================================
// the wider solar system: Aries, Zeus, Poseidon and their moons.
// Every body here shares one recipe: an orbit around a parent, a spin, a seeded texture,
// sunlight from the real sun, an optional glow layer (lava), optional rings, hover + lock-on.
// ======================================================================
const BODY = {};
const kepler = orbit => SUN.year * Math.pow(orbit, 1.5);
function makeBody(def) {
  const b = { label: '#e8ecf4', ring: '200,215,255', dot: '#c9ccd4', halo: '220,225,235', ...def };
  b.texR = b.r / b.tex;
  b.size = Math.ceil(b.texR * 2) + 6;
  b.phase = hash2(SEED, b.seedOff, 7) * Math.PI * 2;
  if (b.rings) {                                         // fine ringlets: varying density, with clear gaps
    const rr = mulberry32(SEED + b.seedOff * 31), R = b.rings, n = 46, step = (R.outer - R.inner) / n;
    b.ringlets = [];
    for (let k = 0; k < n; k++) {
      const a1 = R.inner + k * step, a2 = a1 + step * 0.92, mid = (a1 + a2) / 2;
      if (R.gaps.some(([g1, g2]) => mid > g1 && mid < g2)) continue;
      const edge = Math.min(mid - R.inner, R.outer - mid) / (R.outer - R.inner);   // fade at the inner and outer edges
      b.ringlets.push([a1, a2, (0.12 + rr() * 0.38) * Math.min(1, edge * 6), 170 + rr() * 50]);
    }
  }
  BODY[b.id] = b;
  return b;
}
// position = parent position + orbit; spin = own rotation (tidally locked moons turn with their orbit)
function genericPos(b) {
  const [px, py] = b.parent === 'sun' ? sunPos() : genericPos(BODY[b.parent]);
  const a = b.phase + (game.time / b.period) * Math.PI * 2;
  const spin = b.spin === 'locked' ? a : (game.time / b.spin) * Math.PI * 2;
  return [px + Math.cos(a) * b.orbit, py + Math.sin(a) * b.orbit, spin];
}
function genericBiomeAt(b, wx, wy) {
  const [bx, by, spin] = genericPos(b);
  const dx = wx - bx, dy = wy - by, c = Math.cos(-spin), sn = Math.sin(-spin);
  const lx = Math.floor((dx * c - dy * sn) / b.tex + b.size / 2), ly = Math.floor((dx * sn + dy * c) / b.tex + b.size / 2);
  if (lx < 0 || ly < 0 || lx >= b.size || ly >= b.size) return null;
  const v = b.biome[ly * b.size + lx];
  return v === 255 ? null : b.biomes[v];
}

// shared texture painter: calls fn(x, y, u, v, out, i) per pixel; out = [r, g, b, biome, glow]
function paintBody(b, fn, limbK = 0.25) {
  const S = b.size, c0 = S / 2, R = b.texR;
  b.canvas = document.createElement('canvas'); b.canvas.width = b.canvas.height = S;
  const g = b.canvas.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  b.biome = new Uint8Array(S * S).fill(255);
  let gimg = null;
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, o = i * 4, t = Math.hypot(x + 0.5 - c0, y + 0.5 - c0) / R;
    if (t > 1) { d[o + 3] = 0; continue; }
    out[3] = 0; out[4] = 0;
    fn(x, y, (x + 0.5 - c0) / R, (y + 0.5 - c0) / R, out, i);
    const limb = 1 - limbK * Math.pow(t, 4);
    d[o] = clamp(out[0] * limb, 0, 255); d[o + 1] = clamp(out[1] * limb, 0, 255); d[o + 2] = clamp(out[2] * limb, 0, 255); d[o + 3] = 255;
    b.biome[i] = out[3];
    if (out[4] > 0.05) {
      if (!gimg) gimg = new ImageData(S, S);
      gimg.data[o] = 255; gimg.data[o + 1] = 110 + 70 * out[4]; gimg.data[o + 2] = 30; gimg.data[o + 3] = clamp(out[4] * 210, 0, 255);
    }
  }
  g.putImageData(img, 0, 0);
  if (gimg) {
    b.glow = document.createElement('canvas'); b.glow.width = b.glow.height = S;
    b.glow.getContext('2d').putImageData(gimg, 0, 0);
  }
}

// ---------- Aries: the red planet ----------
function paintAries(b) {
  const S = b.size, c0 = S / 2, R = b.texR, rnd = mulberry32(SEED + 6161), s = SEED + 1600;
  // one giant shield volcano and a few smaller ones
  const vol = [{ x: c0 + (rnd() - 0.5) * R * 0.9, y: c0 + (rnd() - 0.5) * R * 0.5, r: R * 0.17 }];
  for (let k = 0; k < 3; k++) vol.push({ x: c0 + (rnd() - 0.5) * R * 1.1, y: c0 + (rnd() - 0.5) * R * 0.9, r: R * (0.05 + rnd() * 0.04) });
  // a huge canyon rift
  const ca = (rnd() - 0.5) * 0.6, dir = [Math.cos(ca), Math.sin(ca)], perp = [-dir[1], dir[0]];
  const p0 = [c0 + (rnd() - 0.5) * R * 0.3, c0 + (rnd() - 0.2) * R * 0.35], half = R * 0.6, cw0 = R * 0.045;
  const hgt = new Float32Array(S * S), zone = new Uint8Array(S * S);   // zone: 1 canyon, 2 volcano, 3 caldera
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) continue;
    let h = fbm(x / 26, y / 26, s, 5) * 0.55;
    for (const v of vol) {
      const dd = Math.hypot(x - v.x, y - v.y) / v.r;
      if (dd < 1.6) {
        h += 0.7 * Math.pow(1 - dd / 1.6, 1.4) * (v.r / (R * 0.17));
        if (dd < 1.05) zone[i] = 2;
        if (dd < 0.14) { zone[i] = 3; h -= 0.12; }
      }
    }
    const qx = x - p0[0], qy = y - p0[1], along = qx * dir[0] + qy * dir[1];
    const across = qx * perp[0] + qy * perp[1] + (fbm(along / 14, 3.3, s + 4, 2) - 0.5) * R * 0.08;
    if (Math.abs(along) < half) {
      const w = cw0 * (1 - Math.pow(along / half, 2) * 0.7);
      if (Math.abs(across) < w) { h -= 0.28 * (1 - Math.abs(across) / w); zone[i] = 1; }
    }
    hgt[i] = h;
  }
  for (let k = 0; k < 70; k++) {                       // craters
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.95;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist, cr = 1.5 + Math.pow(rnd(), 4) * 14, dep = 0.03 + 0.008 * cr;
    for (let y = Math.max(0, (cy - cr * 1.4) | 0); y <= Math.min(S - 1, (cy + cr * 1.4) | 0); y++)
      for (let x = Math.max(0, (cx - cr * 1.4) | 0); x <= Math.min(S - 1, (cx + cr * 1.4) | 0); x++) {
        const i = y * S + x;
        if (zone[i] >= 2) continue;
        const dd = Math.hypot(x - cx, y - cy) / cr;
        if (dd < 1) hgt[i] -= dep * (1 - dd * dd);
        else if (dd < 1.35) hgt[i] += dep * 0.4 * (1 - Math.abs(dd - 1.1) / 0.25);
      }
  }
  paintBody(b, (x, y, u, v, out, i) => {
    const h = hgt[i], z = zone[i];
    const ha = (x > 1 && y > 1) ? hgt[i - 2 * S - 2] : h, hb = (x < S - 2 && y < S - 2) ? hgt[i + 2 * S + 2] : h;
    const shade = clamp(1 + (ha - hb) * 2.8, 0.6, 1.4);
    const fine = fbm(x / 4, y / 4, s + 9, 2), dark = fbm(x / 48, y / 48, s + 2, 4);
    const cap = Math.abs(v) > 0.83 + (fbm(x / 10, y / 10, s + 3, 2) - 0.5) * 0.14;
    let col, bio;
    if (cap) { col = mix([244, 240, 236], [222, 200, 186], fine * 0.6); bio = 2; }
    else if (z === 3) { col = [96, 54, 42]; bio = 4; }
    else if (z === 2) { col = mix([186, 104, 70], [160, 88, 60], fine); bio = 4; }
    else if (z === 1) { col = mix([126, 64, 46], [96, 50, 38], fine); bio = 3; }
    else if (dark > 0.6) { col = mix([108, 62, 46], [86, 50, 40], fine); bio = 1; }
    else if (h > 0.33) { col = mix([214, 140, 94], [196, 122, 80], fine); bio = 5; }
    else { col = mix([202, 110, 66], [176, 90, 56], fine); bio = 0; }
    if (!cap) col = [col[0] * shade, col[1] * shade, col[2] * shade];
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}

// ---------- gas giants: banded clouds, a great storm, white ovals ----------
const ZEUS_STYLE = {
  palette: [[238, 226, 200], [210, 176, 132], [182, 116, 74], [228, 208, 170], [166, 98, 64], [240, 232, 214], [196, 150, 106], [150, 90, 62]],
  bands: 15, turb: 1.0, storm: { u: 0.25, v: 0.32, rx: 0.22, ry: 0.11, col: [196, 84, 56] }, ovals: [240, 236, 226],
};
const POSEIDON_STYLE = {
  palette: [[44, 86, 176], [72, 132, 212], [58, 150, 172], [146, 196, 226], [32, 60, 140], [90, 160, 220]],
  bands: 11, turb: 0.7, storm: { u: -0.3, v: -0.25, rx: 0.17, ry: 0.1, col: [22, 34, 92] }, ovals: [226, 240, 250],
};
function paintGasGiant(b, st) {
  const s = SEED + 1700 + b.seedOff * 13, rnd = mulberry32(s);
  const order = Array.from({ length: st.bands }, () => st.palette[(rnd() * st.palette.length) | 0]);
  const ovals = Array.from({ length: 6 }, () => ({ u: rnd() * 1.6 - 0.8, v: rnd() * 1.6 - 0.8, r: 0.025 + rnd() * 0.03 }));
  const nb = st.bands, wrap = k => ((k % nb) + nb) % nb;
  paintBody(b, (x, y, u, v, out) => {
    const warp = (fbm(x / 40, y / 10, s, 4) - 0.5) * st.turb + (fbm(x / 90, y / 25, s + 1, 3) - 0.5) * st.turb * 0.7;
    const bt = (v * 0.5 + 0.5) * nb + warp * 0.9;
    const i0 = Math.floor(bt), f = bt - i0, sm = f * f * (3 - 2 * f);
    let col = mix(order[wrap(i0)], order[wrap(i0 + 1)], sm);
    const streak = 0.92 + fbm(x / 7, y / 1.8, s + 3, 3) * 0.16;
    col = [col[0] * streak, col[1] * streak, col[2] * streak];
    let bio = 0;
    const sd = Math.hypot((u - st.storm.u) / st.storm.rx, (v - st.storm.v) / st.storm.ry);
    if (sd < 1.15) {
      const swirl = fbm(x / 6 + sd * 3, y / 6, s + 5, 3);
      if (sd < 1) { col = mix(col, st.storm.col, (1 - sd * sd) * 0.85 * (0.8 + swirl * 0.4)); bio = 1; }
      else col = mix(col, st.ovals, Math.max(0, 1 - Math.abs(sd - 1.07) / 0.08) * 0.35);
    }
    for (const ov of ovals) {
      const od = Math.hypot((u - ov.u) / ov.r, (v - ov.v) / (ov.r * 0.6));
      if (od < 1) col = mix(col, st.ovals, (1 - od) * 0.7);
    }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  }, 0.45);
}

// ---------- moons of Zeus ----------
function paintHephaestus(b) {            // sulfur-yellow volcanic moon (like Io)
  const S = b.size, c0 = S / 2, R = b.texR, s = SEED + 1800, rnd = mulberry32(s);
  const vents = Array.from({ length: 14 }, () => {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.9;
    return { x: c0 + Math.cos(a) * dist, y: c0 + Math.sin(a) * dist, r: 2 + rnd() * 6, hot: rnd() < 0.4 };
  });
  paintBody(b, (x, y, u, v, out) => {
    const m = fbm(x / 18, y / 18, s, 4), f = fbm(x / 5, y / 5, s + 1, 2);
    let col = m > 0.55 ? mix([226, 206, 96], [242, 236, 206], (m - 0.55) * 3) : mix([206, 136, 60], [226, 206, 96], m / 0.55);
    col = mix(col, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85], f * 0.4);
    let bio = 0, glow = 0;
    for (const vt of vents) {
      const dd = Math.hypot(x - vt.x, y - vt.y) / vt.r;
      if (dd < 1) { col = mix([34, 26, 22], [70, 40, 30], dd); bio = 1; if (vt.hot && dd < 0.45) { col = [255, 150, 50]; glow = 1; } }
      else if (dd < 2.4) col = mix(col, [176, 64, 40], 0.45 * (1 - (dd - 1) / 1.4));   // red ring of fresh sulfur
    }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio; out[4] = glow;
  }, 0.3);
}
function paintAthena(b) {                // bright ice crisscrossed with brown cracks (like Europa)
  const s = SEED + 1810;
  paintBody(b, (x, y, u, v, out) => {
    let col = mix([238, 232, 220], [214, 200, 180], fbm(x / 30, y / 30, s, 4));
    if (fbm(x / 22, y / 22, s + 1, 3) > 0.64) col = mix(col, [176, 140, 110], 0.55);   // jumbled "chaos" terrain
    const c1 = Math.abs(fbm(x / 25, y / 25, s + 2, 3) - 0.5) < 0.012, c2 = Math.abs(fbm(x / 12, y / 12, s + 3, 3) - 0.5) < 0.01;
    let bio = 0;
    if (c1 || c2) { col = mix(col, [146, 92, 62], c1 ? 0.85 : 0.6); bio = 1; }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}
function paintHermes(b) {                // dark ancient crust peppered with bright craters (like Callisto)
  const S = b.size, c0 = S / 2, R = b.texR, s = SEED + 1820, rnd = mulberry32(s);
  const bright = new Float32Array(S * S);
  for (let k = 0; k < 320; k++) {
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R, cr = 1 + Math.pow(rnd(), 3) * 7;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist;
    for (let y = Math.max(0, (cy - cr * 2) | 0); y <= Math.min(S - 1, (cy + cr * 2) | 0); y++)
      for (let x = Math.max(0, (cx - cr * 2) | 0); x <= Math.min(S - 1, (cx + cr * 2) | 0); x++) {
        const dd = Math.hypot(x - cx, y - cy) / cr;
        if (dd < 2) bright[y * S + x] = Math.max(bright[y * S + x], dd < 1 ? 0.9 : (2 - dd) * 0.45);
      }
  }
  const bx = c0 + (rnd() - 0.5) * R, by = c0 + (rnd() - 0.5) * R, br = R * 0.25;   // a giant ringed impact basin
  paintBody(b, (x, y, u, v, out, i) => {
    let col = mix([74, 68, 62], [98, 90, 82], fbm(x / 20, y / 20, s, 4));
    const bd = Math.hypot(x - bx, y - by) / br;
    if (bd < 2.2) col = mix(col, [140, 132, 122], (0.5 + 0.5 * Math.cos(bd * Math.PI * 5)) * 0.35 * (1 - bd / 2.2));
    col = mix(col, [212, 206, 196], bright[i]);
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bright[i] > 0.3 ? 1 : 0;
  });
}

// ---------- moons of Poseidon ----------
function paintTriton(b) {                // pinkish nitrogen ice, cantaloupe terrain, dark geyser streaks
  const s = SEED + 1830;
  paintBody(b, (x, y, u, v, out) => {
    let col = mix([222, 196, 186], [196, 166, 156], fbm(x / 24, y / 24, s, 4));
    let bio = 0;
    if (Math.abs(fbm(x / 7, y / 7, s + 1, 3) - 0.5) < 0.04) col = mix(col, [166, 138, 132], 0.6);   // cantaloupe ridges
    if (v > 0.35 + (fbm(x / 14, y / 14, s + 2, 2) - 0.5) * 0.3) {                              // bright polar cap
      col = mix(col, [240, 230, 224], 0.7); bio = 2;
      if (fbm(x / 3, y / 16, s + 3, 3) > 0.66) { col = mix(col, [96, 76, 74], 0.75); bio = 1; }    // geyser streaks
    }
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}
function paintAmphitrite(b) {            // blue-white ice plates over a frozen ocean
  const s = SEED + 1840;
  paintBody(b, (x, y, u, v, out) => {
    let col = mix([210, 228, 242], [180, 206, 228], fbm(x / 26, y / 26, s, 4));
    if (fbm(x / 40, y / 40, s + 1, 3) > 0.6) col = mix(col, [160, 194, 226], 0.5);                 // refrozen smooth areas
    let bio = 0;
    if (Math.abs(fbm(x / 14, y / 14, s + 2, 3) - 0.5) < 0.018) { col = [70, 112, 150]; bio = 1; }   // cracks between plates
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio;
  });
}

// ---------- the bodies themselves ----------
{
  const P = CFG.planets;
  makeBody({ id: 'aries', name: 'Aries', parent: 'sun', r: DISK.R * P.aries.size, tex: 2,
    orbit: SUN.dist * P.aries.orbit, period: kepler(P.aries.orbit), spin: P.aries.spin, seedOff: 21,
    halo: '232,120,80', dot: '#d0704a', label: '#ffb595', ring: '230,130,90', key: 'r', frame: 'rotating',
    biomes: ['Rust plains', 'Dark basalt', 'Polar ice', 'Canyon', 'Volcano', 'Cratered highlands'],
    blurb: 'the red planet', paint: paintAries });
  makeBody({ id: 'zeus', name: 'Zeus', parent: 'sun', r: DISK.R * P.zeus.size, tex: 12,
    orbit: SUN.dist * P.zeus.orbit, period: kepler(P.zeus.orbit), spin: P.zeus.spin, seedOff: 31,
    halo: '235,200,150', dot: '#d9b98c', label: '#f3d9b0', ring: '235,200,150', key: 'z', frame: 'translate',
    biomes: ['Cloud bands', 'Great Red Storm'], blurb: 'gas giant', paint: b => paintGasGiant(b, ZEUS_STYLE) });
  makeBody({ id: 'poseidon', name: 'Poseidon', parent: 'sun', r: DISK.R * P.poseidon.size, tex: 9,
    orbit: SUN.dist * P.poseidon.orbit, period: kepler(P.poseidon.orbit), spin: P.poseidon.spin, seedOff: 32,
    halo: '110,160,240', dot: '#4f86d6', label: '#a9c8ff', ring: '120,170,240', key: 'p', frame: 'translate',
    rings: { inner: 1.3, outer: 2.05, gaps: [[1.55, 1.6], [1.83, 1.87]] },
    biomes: ['Cloud bands', 'Dark Storm'], blurb: 'ringed gas giant', paint: b => paintGasGiant(b, POSEIDON_STYLE) });
  const Rz = BODY.zeus.r, Rp = BODY.poseidon.r;
  makeBody({ id: 'hephaestus', name: 'Hephaestus', parent: 'zeus', r: 140, tex: 1, orbit: Rz * 2.4, period: 70, spin: 'locked', seedOff: 41,
    halo: '240,210,110', dot: '#e0c25a', label: '#f5dd8a', ring: '240,210,120', frame: 'rotating',
    biomes: ['Sulfur plains', 'Volcanic vent'], blurb: 'volcanic moon of Zeus', paint: paintHephaestus });
  makeBody({ id: 'athena', name: 'Athena', parent: 'zeus', r: 120, tex: 1, orbit: Rz * 3.4, period: 120, spin: 'locked', seedOff: 42,
    halo: '230,225,215', dot: '#e4dccd', label: '#efe8dc', ring: '230,225,215', frame: 'rotating',
    biomes: ['Ice sheet', 'Cracked ridges'], blurb: 'icy moon of Zeus', paint: paintAthena });
  makeBody({ id: 'hermes', name: 'Hermes', parent: 'zeus', r: 190, tex: 1, orbit: Rz * 5, period: 200, spin: 'locked', seedOff: 43,
    halo: '200,195,190', dot: '#8d8680', label: '#d6d0c8', ring: '200,195,190', frame: 'rotating',
    biomes: ['Dark crust', 'Bright craters'], blurb: 'ancient cratered moon of Zeus', paint: paintHermes });
  makeBody({ id: 'amphitrite', name: 'Amphitrite', parent: 'poseidon', r: 90, tex: 1, orbit: Rp * 2.6, period: 80, spin: 'locked', seedOff: 51,
    halo: '200,225,245', dot: '#c8e0f0', label: '#d8ecfa', ring: '200,225,245', frame: 'rotating',
    biomes: ['Ice plates', 'Frozen cracks'], blurb: 'frozen-ocean moon of Poseidon', paint: paintAmphitrite });
  makeBody({ id: 'triton', name: 'Triton', parent: 'poseidon', r: 120, tex: 1, orbit: Rp * 3.8, period: -150, spin: 'locked', seedOff: 52,
    halo: '230,200,195', dot: '#dcbcb4', label: '#f0d6d0', ring: '230,200,195', frame: 'rotating',
    biomes: ['Nitrogen ice', 'Geyser streaks', 'Polar cap'], blurb: 'moon of Poseidon that orbits backwards', paint: paintTriton });
  // locking onto a gas giant zooms out to show its whole family of moons
  for (const gid of ['zeus', 'poseidon']) {
    const kids = Object.values(BODY).filter(m => m.parent === gid);
    const reach = Math.max(...kids.map(m => m.orbit + m.r)) * 1.1;
    BODY[gid].followZoom = () => Math.min(cw, ch - 200) / (2 * reach);
  }
}

// ======================================================================
// the seed world: a whole planet (and its moons) generated from the map seed.
// planetRecipe(seed) turns a number into a list of traits; the painters turn traits into a surface.
// Same seed -> same recipe -> same planet, every time.
// ======================================================================
function hsl(h, sat, l) {                                // hue 0-360, sat/l 0-1 -> [r, g, b]
  h = (((h % 360) + 360) % 360) / 360;
  const f = n => { const k = (n + h * 12) % 12, a = sat * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return [f(0), f(8), f(4)];
}
const rgbStr = c => `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
function hueName(h) {
  h = ((h % 360) + 360) % 360;
  return h < 20 ? 'crimson' : h < 45 ? 'amber' : h < 70 ? 'golden' : h < 100 ? 'olive' : h < 150 ? 'jade'
    : h < 190 ? 'teal' : h < 235 ? 'azure' : h < 275 ? 'indigo' : h < 320 ? 'violet' : 'rose';
}
const SYLLABLES = ['ka', 've', 'lor', 'zan', 'tor', 'mi', 'rah', 'eth', 'os', 'qua', 'dri', 'sel', 'nor', 'vy', 'tha', 'ix', 'um', 'pe', 'gor', 'lia', 'ser', 'an', 'kel', 'oth', 'yr', 'bel'];
function makeName(r) {
  let w = '';
  const n = 2 + (r() < 0.35 ? 1 : 0);
  for (let k = 0; k < n; k++) w += SYLLABLES[(r() * SYLLABLES.length) | 0];
  w += ['', '', 'on', 'ar', 'is', 'us', 'a', 'ia'][(r() * 8) | 0];
  return w[0].toUpperCase() + w.slice(1);
}
const LIQUIDS = {
  water:   { name: 'Ocean',       plural: 'oceans',      deep: [24, 60, 128], shallow: [52, 118, 176], glow: 0 },
  lava:    { name: 'Lava sea',    plural: 'lava seas',   deep: [170, 40, 12], shallow: [250, 130, 34], glow: 0.8 },
  methane: { name: 'Methane sea', plural: 'methane seas', deep: [52, 36, 26], shallow: [104, 74, 46],  glow: 0 },
  acid:    { name: 'Acid lake',   plural: 'acid lakes',  deep: [92, 122, 22], shallow: [170, 196, 52], glow: 0 },
};
const MINOR_TYPES = {
  icy:      'icy moon',
  volcanic: 'volcanic moon',
  hazy:     'hazy moon wrapped in thick smog',
  cratered: 'ancient cratered moon',
  frost:    'frosty moon with dark streaks',
};

// THE RULES: every trait below is rolled from the seed, in a fixed order.
function planetRecipe(seed) {
  // scramble the seed thoroughly first, so neighbouring seeds (1, 2, 3...) give unrelated planets
  const r = mulberry32(Math.floor(hash2(seed, 1234, 5678) * 4294967296) ^ Math.floor(hash2(seed, 91, 3) * 4294967296));
  for (let k = 0; k < 4; k++) r();
  const pick = a => a[(r() * a.length) | 0], range = (a, b) => a + r() * (b - a), chance = q => r() < q;
  const P = { seed, name: makeName(r), kind: chance(0.5) ? 'gas' : 'rocky' };
  if (P.kind === 'gas') {
    P.size = range(3, 7);                                       // x your world's radius
    P.hue = range(0, 360); P.sat = range(0.3, 0.7);
    P.bands = 8 + ((r() * 11) | 0); P.turb = range(0.5, 1.3);
    P.palette = Array.from({ length: 6 }, () => hsl(P.hue + range(-28, 28), P.sat * range(0.6, 1.1), range(0.3, 0.85)));
    P.storm = chance(0.7) ? { u: range(-0.5, 0.5), v: range(-0.5, 0.5), rx: range(0.1, 0.25), ry: range(0.06, 0.12),
      col: hsl(P.hue + range(-40, 40), P.sat, chance(0.5) ? 0.25 : 0.72) } : null;
    P.rings = chance(0.45) ? { inner: 1.3, outer: range(1.7, 2.3), gaps: [[range(1.48, 1.6), 0]] } : null;
    if (P.rings) P.rings.gaps[0][1] = P.rings.gaps[0][0] + 0.05;
    P.moons = 1 + ((r() * 4) | 0);
    P.summary = `gas giant: ${hueName(P.hue)} bands${P.storm ? ', a great storm' : ''}${P.rings ? ', rings' : ''}`;
  } else {
    P.size = range(0.35, 1.4);
    P.atmo = pick(['none', 'thin', 'thin', 'thick']);
    P.atmoHue = range(0, 360);
    P.liquid = pick(['none', 'water', 'water', 'lava', 'methane', 'acid']);
    P.liquidLevel = range(0.2, 0.65);                           // share of the surface under liquid
    P.groundHue = range(0, 360); P.groundSat = range(0.12, 0.5);
    P.rough = range(0.2, 1);                                    // how jagged the mountains are
    P.ice = P.liquid !== 'lava' && chance(0.5) ? range(0.08, 0.3) : 0;
    P.craters = P.atmo === 'none' ? 160 : P.atmo === 'thin' ? 50 : 8;   // air burns up meteors
    P.clouds = P.atmo === 'thick' ? range(0.35, 0.7) : 0;
    P.moons = (r() * 3) | 0;
    const bits = [P.atmo === 'none' ? 'no air' : `${P.atmo} ${hueName(P.atmoHue)} atmosphere`];
    if (P.liquid !== 'none') bits.push(LIQUIDS[P.liquid].plural);
    if (P.ice) bits.push('ice caps');
    if (P.rough > 0.7) bits.push('jagged mountains');
    P.summary = `rocky world: ${bits.join(', ')}`;
  }
  P.moonDefs = Array.from({ length: P.moons }, () => ({
    name: makeName(r), type: pick(Object.keys(MINOR_TYPES)), r: range(60, 160), hue: range(0, 360), retro: chance(0.15),
  }));
  return P;
}

// ---------- painters for generated bodies ----------
function gasStyle(P) {
  return { palette: P.palette, bands: P.bands, turb: P.turb,
    storm: P.storm || { u: 9, v: 9, rx: 0.01, ry: 0.01, col: [0, 0, 0] }, ovals: hsl(P.hue, P.sat * 0.3, 0.9) };
}

function paintRocky(b, P) {
  const S = b.size, c0 = S / 2, R = b.texR, s = P.seed + 3000, rnd = mulberry32(s);
  const sc = R * 0.35, hgt = new Float32Array(S * S), vals = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (Math.hypot(x + 0.5 - c0, y + 0.5 - c0) > R) continue;
    const wx = x + (fbm(x / sc, y / sc, s + 1, 3) - 0.5) * R * 0.25, wy = y + (fbm(x / sc, y / sc, s + 3, 3) - 0.5) * R * 0.25;
    let e = fbm(wx / sc, wy / sc, s, 5);
    const ridge = 1 - Math.abs(2 * fbm(x / (sc * 0.45), y / (sc * 0.45), s + 2, 4) - 1);
    e += ridge * ridge * 0.35 * P.rough;
    hgt[y * S + x] = e; vals.push(e);
  }
  vals.sort((a, b2) => a - b2);
  const sea = P.liquid !== 'none' ? vals[Math.floor(vals.length * P.liquidLevel)] : -1;
  const bottom = Math.max(sea, vals[0]), top = vals[vals.length - 1];
  for (let k = 0; k < P.craters; k++) {                 // craters, on dry land only
    const a = rnd() * Math.PI * 2, dist = Math.sqrt(rnd()) * R * 0.95;
    const cx = c0 + Math.cos(a) * dist, cy = c0 + Math.sin(a) * dist, cr = 1 + Math.pow(rnd(), 4) * R * 0.08, dep = 0.03 + 0.006 * cr;
    for (let y = Math.max(0, (cy - cr * 1.4) | 0); y <= Math.min(S - 1, (cy + cr * 1.4) | 0); y++)
      for (let x = Math.max(0, (cx - cr * 1.4) | 0); x <= Math.min(S - 1, (cx + cr * 1.4) | 0); x++) {
        const i = y * S + x;
        if (hgt[i] <= sea) continue;
        const dd = Math.hypot(x - cx, y - cy) / cr;
        if (dd < 1) hgt[i] -= dep * (1 - dd * dd);
        else if (dd < 1.35) hgt[i] += dep * 0.4 * (1 - Math.abs(dd - 1.1) / 0.25);
      }
  }
  const low = hsl(P.groundHue, P.groundSat, 0.38), high = hsl(P.groundHue + 20, P.groundSat * 0.7, 0.56), peak = hsl(P.groundHue, P.groundSat * 0.3, 0.82);
  const atmoCol = hsl(P.atmoHue, 0.45, 0.65), cloudCol = mix([242, 244, 248], atmoCol, 0.2);
  const L = LIQUIDS[P.liquid];
  paintBody(b, (x, y, u, v, out, i) => {
    const e = hgt[i], fine = fbm(x / 3, y / 3, s + 9, 2);
    let col, bio, glow = 0;
    if (e < sea) {
      const dep = clamp((sea - e) * 8, 0, 1);
      col = mix(L.shallow, L.deep, dep); bio = 0; glow = L.glow * (0.5 + dep * 0.5);
    } else {
      const t = clamp((e - bottom) / (top - bottom + 1e-6), 0, 1);
      col = t < 0.6 ? mix(low, high, t / 0.6) : mix(high, peak, (t - 0.6) / 0.4);
      bio = t < 0.35 ? 1 : t < 0.7 ? 2 : 3;
      const ha = (x > 1 && y > 1) ? hgt[i - 2 * S - 2] : e, hb = (x < S - 2 && y < S - 2) ? hgt[i + 2 * S + 2] : e;
      const shade = clamp(1 + (ha - hb) * 4, 0.6, 1.4);
      col = mix(col, [col[0] * 0.85, col[1] * 0.85, col[2] * 0.85], fine * 0.4);
      col = [col[0] * shade, col[1] * shade, col[2] * shade];
    }
    if (P.ice && Math.abs(v) > 1 - P.ice + (fbm(x / 10, y / 10, s + 5, 2) - 0.5) * 0.12) { col = mix(col, [240, 244, 248], 0.85); bio = 4; glow = 0; }
    if (P.clouds) {                                      // wispy cloud streaks (stretched sideways, like weather bands)
      const c = fbm(x / (R * 0.12) + fbm(x / sc, y / sc, s + 7, 2) * 3, y / (R * 0.05), s + 6, 4);
      const th = 1 - P.clouds * 0.8;
      if (c > th) col = mix(col, cloudCol, clamp((c - th) * 4, 0, 0.85));
    }
    if (P.atmo === 'thick') col = mix(col, atmoCol, 0.18);
    out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; out[3] = bio; out[4] = glow;
  }, P.atmo === 'thick' ? 0.15 : 0.3);
  b.biomes = [L ? L.name : 'Basin', 'Lowlands', 'Highlands', P.rough > 0.6 ? 'Mountains' : 'Uplands', 'Ice cap'];
}

function paintMinor(b, M) {
  const S = b.size, c0 = S / 2, R = b.texR, s = M.seed, rnd = mulberry32(s);
  const put = (out, c, bio = 0, glow = 0) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = bio; out[4] = glow; };
  if (M.type === 'icy') {                                // cracked ice (Europa-like)
    const a = hsl(M.hue, 0.15, 0.88), a2 = hsl(M.hue, 0.2, 0.74), crack = hsl(M.hue + 180, 0.35, 0.4);
    b.biomes = ['Ice sheet', 'Cracks'];
    paintBody(b, (x, y, u, v, out) => {
      const col = mix(a, a2, fbm(x / 26, y / 26, s, 4));
      const cr = Math.abs(fbm(x / 20, y / 20, s + 1, 3) - 0.5) < 0.013 || Math.abs(fbm(x / 10, y / 10, s + 2, 3) - 0.5) < 0.01;
      put(out, cr ? mix(col, crack, 0.75) : col, cr ? 1 : 0);
    });
  } else if (M.type === 'volcanic') {                    // sulfur and glowing vents (Io-like)
    const b1 = hsl(45 + (M.hue % 30) - 15, 0.6, 0.62), b2 = hsl(22 + (M.hue % 20), 0.6, 0.5), frost = hsl(50, 0.4, 0.88);
    const vents = Array.from({ length: 10 }, () => { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * R * 0.9; return { x: c0 + Math.cos(a) * d, y: c0 + Math.sin(a) * d, r: 2 + rnd() * 5, hot: rnd() < 0.45 }; });
    b.biomes = ['Sulfur plains', 'Volcanic vent'];
    paintBody(b, (x, y, u, v, out) => {
      const m = fbm(x / 18, y / 18, s, 4);
      let col = m > 0.55 ? mix(b1, frost, (m - 0.55) * 3) : mix(b2, b1, m / 0.55), bio = 0, glow = 0;
      for (const vt of vents) {
        const dd = Math.hypot(x - vt.x, y - vt.y) / vt.r;
        if (dd < 1) { col = mix([34, 26, 22], [70, 40, 30], dd); bio = 1; if (vt.hot && dd < 0.45) { col = [255, 150, 50]; glow = 1; } }
        else if (dd < 2.3) col = mix(col, [176, 64, 40], 0.4 * (1 - (dd - 1) / 1.3));
      }
      put(out, col, bio, glow);
    }, 0.3);
  } else if (M.type === 'hazy') {                        // a smooth ball of thick smog (Titan-like)
    const a = hsl(M.hue, 0.55, 0.5), a2 = hsl(M.hue + 15, 0.5, 0.62);
    b.biomes = ['Thick haze'];
    b.halo = rgbStr(hsl(M.hue, 0.6, 0.6)); b.haloA = 0.55; b.haloR = 1.35;
    paintBody(b, (x, y, u, v, out) => put(out, mix(a, a2, fbm(x / 40, y / 12, s, 3))), 0.05);
  } else if (M.type === 'cratered') {                    // dark, ancient, bright craters (Callisto-like)
    const dark = hsl(M.hue, 0.12, 0.28), dark2 = hsl(M.hue, 0.1, 0.36), light = hsl(M.hue, 0.1, 0.8);
    const bright = new Float32Array(S * S);
    for (let k = 0; k < 220; k++) {
      const a = rnd() * 6.283, d = Math.sqrt(rnd()) * R, cr = 1 + Math.pow(rnd(), 3) * 6, cx = c0 + Math.cos(a) * d, cy = c0 + Math.sin(a) * d;
      for (let y = Math.max(0, (cy - cr * 2) | 0); y <= Math.min(S - 1, (cy + cr * 2) | 0); y++)
        for (let x = Math.max(0, (cx - cr * 2) | 0); x <= Math.min(S - 1, (cx + cr * 2) | 0); x++) {
          const dd = Math.hypot(x - cx, y - cy) / cr;
          if (dd < 2) bright[y * S + x] = Math.max(bright[y * S + x], dd < 1 ? 0.85 : (2 - dd) * 0.42);
        }
    }
    b.biomes = ['Dark crust', 'Bright craters'];
    paintBody(b, (x, y, u, v, out, i) => put(out, mix(mix(dark, dark2, fbm(x / 20, y / 20, s, 4)), light, bright[i]), bright[i] > 0.3 ? 1 : 0));
  } else {                                               // frost: streaks and a polar cap (Triton-like)
    const a = hsl(M.hue, 0.3, 0.8), a2 = hsl(M.hue, 0.3, 0.66), streak = hsl(M.hue, 0.2, 0.3);
    b.biomes = ['Frost plains', 'Dark streaks', 'Polar cap'];
    paintBody(b, (x, y, u, v, out) => {
      let col = mix(a, a2, fbm(x / 24, y / 24, s, 4)), bio = 0;
      if (Math.abs(fbm(x / 7, y / 7, s + 1, 3) - 0.5) < 0.04) col = mix(col, a2, 0.7);
      if (v > 0.3 + (fbm(x / 14, y / 14, s + 2, 2) - 0.5) * 0.3) {
        col = mix(col, [240, 236, 232], 0.65); bio = 2;
        if (fbm(x / 3, y / 16, s + 3, 3) > 0.66) { col = mix(col, streak, 0.75); bio = 1; }
      }
      put(out, col, bio);
    });
  }
}

// ---------- build the seed world and its moons ----------
const SEED_PLANET = planetRecipe(SEED);
const GEN_MOON_IDS = [];
{
  const P = SEED_PLANET, orbit = CFG.planets.seedWorld.orbit, R = DISK.R * P.size;
  const look = P.kind === 'gas'
    ? { halo: rgbStr(P.palette[0]), dot: `rgb(${rgbStr(P.palette[1])})`, label: `rgb(${rgbStr(hsl(P.hue, 0.5, 0.82))})` }
    : { halo: rgbStr(P.atmo === 'none' ? [200, 200, 210] : hsl(P.atmoHue, 0.5, 0.7)),
        haloA: P.atmo === 'none' ? 0.12 : P.atmo === 'thin' ? 0.3 : 0.55, haloR: P.atmo === 'thick' ? 1.3 : 1.15,
        dot: `rgb(${rgbStr(hsl(P.groundHue, P.groundSat, 0.5))})`, label: `rgb(${rgbStr(hsl(P.groundHue, 0.5, 0.82))})` };
  const world = makeBody({ id: 'seedworld', name: P.name, parent: 'sun', r: R, tex: Math.max(1, Math.ceil(R / 230)),
    orbit: SUN.dist * orbit, period: kepler(orbit), spin: P.kind === 'gas' ? 45 : 100, seedOff: 61,
    key: 'g', frame: P.kind === 'gas' ? 'translate' : 'rotating', rings: P.rings || undefined, ...look,
    ring: look.halo, recipe: P, blurb: `${P.summary} · generated from seed ${SEED}`,
    biomes: P.kind === 'gas' ? ['Cloud bands', 'Great storm'] : [],
    paint: b => (P.kind === 'gas' ? paintGasGiant(b, gasStyle(P)) : paintRocky(b, P)) });
  const first = P.kind === 'gas' ? Math.max(2.3, (P.rings ? P.rings.outer : 0) + 0.5) : 3;
  P.moonDefs.forEach((M, k) => {
    const id = 'seedmoon' + k;
    makeBody({ id, name: M.name, parent: 'seedworld', r: M.r, tex: 1,
      orbit: R * (first + k * (P.kind === 'gas' ? 1.1 : 1.8)) + M.r * 2, period: (60 + k * 55) * (M.retro ? -1 : 1), spin: 'locked',
      seedOff: 70 + k, frame: 'rotating', halo: rgbStr(hsl(M.hue, 0.25, 0.8)), dot: `rgb(${rgbStr(hsl(M.hue, 0.25, 0.7))})`,
      label: `rgb(${rgbStr(hsl(M.hue, 0.35, 0.86))})`, ring: rgbStr(hsl(M.hue, 0.25, 0.8)),
      blurb: `${MINOR_TYPES[M.type]} of ${P.name}${M.retro ? ', orbits backwards' : ''}`, biomes: [],
      paint: b => paintMinor(b, { ...M, seed: P.seed + 4000 + k * 97 }) });
    GEN_MOON_IDS.push(id);
  });
  if (GEN_MOON_IDS.length) {
    const reach = Math.max(...GEN_MOON_IDS.map(id => BODY[id].orbit + BODY[id].r)) * 1.1;
    world.followZoom = () => Math.min(cw, ch - 200) / (2 * reach);
  }
}
const DRAW_ORDER = ['aries', 'zeus', 'hephaestus', 'athena', 'hermes', 'poseidon', 'amphitrite', 'triton', 'seedworld', ...GEN_MOON_IDS];

function drawBodyGeneric(b, z) {
  const [x, y, spin] = genericPos(b);
  const [sx, sy] = toScreen(x, y), rr = b.r * z;
  const isMoon = b.parent !== 'sun';
  const orbitPx = b.orbit * z;
  if (isMoon && orbitPx < 12) return;                   // too close to its planet to tell apart from here
  // orbit ring around the parent
  if (orbitPx > 14 && orbitPx < 60000 && (isMoon || z < 0.01)) {
    const [px, py] = isMoon ? genericPos(BODY[b.parent]) : sunPos();
    const [cx, cy] = toScreen(px, py);
    ctx.setLineDash([3, 10]); ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${b.ring},0.2)`;
    ctx.beginPath(); ctx.arc(cx, cy, orbitPx, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  const extent = Math.max(rr * (b.rings ? b.rings.outer + 0.05 : 1.2), 20);
  if (sx + extent < 0 || sy + extent < 0 || sx - extent > cw || sy - extent > ch) return;
  const showLabel = !isMoon || orbitPx > 40;
  // rings (seen from above, so they're full circles around the planet), with the planet's shadow across them
  if (b.rings && rr >= 2) {
    for (const [a1, a2, al, tint] of b.ringlets) {
      ctx.beginPath(); ctx.arc(sx, sy, rr * a2, 0, Math.PI * 2); ctx.arc(sx, sy, rr * a1, 0, Math.PI * 2, true);
      ctx.fillStyle = `rgba(${tint | 0},${(tint + 18) | 0},${(tint + 34) | 0},${al})`; ctx.fill();
    }
    const [ssx0, ssy0] = toScreen(...sunPos().slice(0, 2));
    const away = Math.atan2(sy - ssy0, sx - ssx0);
    ctx.save();
    ctx.beginPath(); ctx.arc(sx, sy, rr * b.rings.outer, 0, Math.PI * 2); ctx.arc(sx, sy, rr * 0.98, 0, Math.PI * 2, true); ctx.clip();
    ctx.translate(sx, sy); ctx.rotate(away);
    ctx.fillStyle = 'rgba(2,4,14,0.72)'; ctx.fillRect(0, -rr, rr * (b.rings.outer + 0.1), rr * 2);
    ctx.restore();
  }
  // atmosphere / glow halo
  const haloR = Math.max(rr * (b.haloR || 1.15), 16);
  const gl = ctx.createRadialGradient(sx, sy, Math.max(rr * 0.95, 1), sx, sy, haloR);
  gl.addColorStop(0, `rgba(${b.halo},${b.haloA ?? 0.32})`); gl.addColorStop(1, `rgba(${b.halo},0)`);
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(sx, sy, haloR, 0, Math.PI * 2); ctx.fill();
  if (rr < 4) {
    ctx.fillStyle = b.dot; ctx.beginPath(); ctx.arc(sx, sy, Math.max(rr, 3.2), 0, Math.PI * 2); ctx.fill();
    if (showLabel) pill(sx, sy + 20, b.name, { fg: b.label, size: 12 });
    return;
  }
  const scale = b.tex * z, half = b.size / 2 * scale;
  ctx.save();
  ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
  ctx.imageSmoothingEnabled = scale < 1.5;
  ctx.drawImage(b.canvas, -half, -half, half * 2, half * 2);
  ctx.restore();
  // sunlight from the real sun: day side and night side
  const [ssx, ssy] = toScreen(...sunPos().slice(0, 2));
  let ldx = ssx - sx, ldy = ssy - sy;
  const ll = Math.hypot(ldx, ldy) || 1; ldx /= ll; ldy /= ll;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx, sy, rr, 0, Math.PI * 2); ctx.clip();
  const lg = ctx.createLinearGradient(sx + ldx * rr, sy + ldy * rr, sx - ldx * rr * 1.4, sy - ldy * rr * 1.4);
  lg.addColorStop(0, 'rgba(0,0,12,0)'); lg.addColorStop(0.45, 'rgba(0,0,12,0.14)'); lg.addColorStop(0.75, 'rgba(0,0,12,0.55)'); lg.addColorStop(1, 'rgba(0,0,12,0.85)');
  ctx.fillStyle = lg; ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
  ctx.restore();
  if (b.glow) {                                          // hot spots keep glowing on the night side
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(spin + cam.rot);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85;
    ctx.imageSmoothingEnabled = scale < 1.5;
    ctx.drawImage(b.glow, -half, -half, half * 2, half * 2);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = true;
  if (showLabel && rr < 160) pill(sx, sy + rr * (b.rings ? b.rings.outer : 1) + 22, b.name, { fg: b.label, size: 12 });
}
function drawOuterBodies(z) { for (const id of DRAW_ORDER) drawBodyGeneric(BODY[id], z); }

// ======================================================================
// everything you can lock onto, in hit-test order (small moons first, the sun last)
// ======================================================================
const LOCKABLE = [
  { id: 'moon', name: 'the Moon', short: 'Moon', key: 'l', frame: 'rotating', r: () => MOON.r, pos: moonPos,
    visible: z => MOON.orbitR * z >= 12,
    info: (wx, wy) => { const mb = moonBiomeAt(wx, wy); return `The Moon${mb ? ' · ' + mb : ''} · orbits your world every ${Math.round(MOON.period / 60)} min`; } },
  ...['hephaestus', 'athena', 'hermes', 'amphitrite', 'triton', ...GEN_MOON_IDS, 'aries', 'zeus', 'poseidon', 'seedworld'].map(id => {
    const b = BODY[id];
    return { id, name: b.name, short: b.name, key: b.key, frame: b.frame, r: () => b.r, pos: () => genericPos(b), zoom: b.followZoom,
      visible: z => b.parent === 'sun' || b.orbit * z >= 12,
      info: (wx, wy) => { const bio = genericBiomeAt(b, wx, wy); return `${b.name}${bio ? ' · ' + bio : ''} · ${b.blurb}`; } };
  }),
  { id: 'vulcan', name: 'Vulcan', short: 'Vulcan', key: 'v', frame: 'rotating', r: () => VULCAN.r, pos: vulcanPos,
    info: (wx, wy) => { const vb = vulcanBiomeAt(wx, wy); return `Vulcan${vb ? ' · ' + vb : ''} · lava world, circles the Sun every ${(VULCAN.year / 60).toFixed(1)} min`; } },
  { id: 'sun', name: 'the Sun', short: 'Sun', key: 'u', frame: 'translate', r: () => SUN.r, pos: sunPos,
    zoom: () => Math.min(cw, ch - 200) / (2 * (SUN.dist + DISK.R * 6)) * 0.95,
    info: () => `The Sun · your world circles it every ${Math.round(SUN.year / 60)} min` },
];
const LOCK = Object.fromEntries(LOCKABLE.map(e => [e.id, e]));

function bodyUnder(wx, wy) {
  for (const e of LOCKABLE) {
    if (e.visible && !e.visible(cam.zoom)) continue;
    const [x, y] = e.pos();
    if (Math.hypot(wx - x, wy - y) < Math.max(e.r(), 24 / cam.zoom)) return e;
  }
  return null;
}

// hovering any body (or your world from far out): gold ring + hint, so you know a click will lock on
function drawLockHover(z) {
  if (!mouse.in || mouse.dragged || game.tool) return;
  const [wx, wy] = toWorld(mouse.x, mouse.y);
  const e = bodyUnder(wx, wy);
  let tx, ty, br;
  if (e) { if (cam.follow === e.id) return; [tx, ty] = e.pos(); br = e.r(); }
  else if (worldLockable() && overWorld(wx, wy)) { tx = DISK.cx; ty = DISK.cy; br = DISK.R; }
  else return;
  const [sx, sy] = toScreen(tx, ty);
  const r = Math.max(br * z, 10) + 7;
  dashRing(sx, sy, r, '#f2c14e', { march: 6 });
  pill(sx, sy - r - 20, 'Click to lock on', { fg: '#f2c14e', border: '#f2c14e', size: 12 });
  canvas.style.cursor = 'pointer';
}

function drawSprite(name, wx, wy, sizePx, alpha = 1) {
  const ras = RAS[name];
  if (!ras) return;
  const img = sizePx * dpr <= 44 ? ras[1] : ras[0];
  const [sx, sy] = toScreen(wx, wy);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  const smooth = ctx.imageSmoothingEnabled;
  if (PIXEL_ART.has(name)) ctx.imageSmoothingEnabled = sizePx * dpr < img.width;   // pixel art: hard edges when enlarged
  ctx.drawImage(img, sx - sizePx / 2, sy - sizePx / 2, sizePx, sizePx);
  ctx.imageSmoothingEnabled = smooth;
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function tracePath(path) {
  ctx.beginPath();
  path.forEach((t, k) => {
    const [sx, sy] = toScreen(...tileCenter(t));
    if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
}

function strokeRoute(path, kind, z, ghost = false) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ghost) {
    tracePath(path);
    ctx.setLineDash([6, 6]); ctx.lineWidth = 3; ctx.strokeStyle = '#7bd389'; ctx.stroke(); ctx.setLineDash([]);
  } else if (kind === 'rail') {
    if (z >= PIXEL_BORDER_BELOW) {
      tracePath(path);   // sleepers
      ctx.lineCap = 'butt';
      ctx.setLineDash([Math.max(1.5, z * 0.13), Math.max(3, z * 0.3)]);
      ctx.lineWidth = Math.max(4, z * 0.6); ctx.strokeStyle = '#6b4f3a'; ctx.stroke();
      ctx.setLineDash([]);
      tracePath(path);   // rail
      ctx.lineWidth = Math.max(1.5, z * 0.16); ctx.strokeStyle = '#59616a'; ctx.stroke();
    } else {
      tracePath(path);
      ctx.lineWidth = 2.5; ctx.strokeStyle = '#3d2e24'; ctx.stroke();
    }
  } else {
    tracePath(path);
    ctx.setLineDash([5, 7]); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
}

// a stone bridge from shore to shore: piers, a shadow on the water, the deck with its joints. Rail runs on top.
function drawBridge(s, b, z, ghost = null) {
  const [ax, ay] = toScreen(...tileCenter(s)), [bx, by] = toScreen(...tileCenter(b));
  const seg = (ox = 0, oy = 0) => { ctx.beginPath(); ctx.moveTo(ax + ox, ay + oy); ctx.lineTo(bx + ox, by + oy); };
  ctx.lineCap = 'butt';
  if (ghost) {
    seg(); ctx.setLineDash([6, 6]); ctx.lineWidth = Math.max(3, z * 0.8); ctx.strokeStyle = ghost; ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  if (z < PIXEL_BORDER_BELOW) {                    // map view: a plain stone line
    seg(); ctx.lineWidth = Math.max(1.5, z * 0.9); ctx.strokeStyle = '#8b8376'; ctx.stroke();
    return;
  }
  const w = z * 0.8, len = Math.hypot(bx - ax, by - ay) / z;
  seg(z * 0.18, z * 0.3); ctx.lineWidth = w; ctx.strokeStyle = 'rgba(10,30,50,0.3)'; ctx.stroke();   // shadow
  ctx.fillStyle = '#4f4a44';
  for (let k = 1, n = Math.max(1, Math.round(len / 3)); k < n; k++) {   // piers every ~3 tiles
    const t = k / n, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    ctx.beginPath(); ctx.arc(px, py, w * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  seg(); ctx.lineWidth = w + Math.max(2, z * 0.14); ctx.strokeStyle = '#4f4a44'; ctx.stroke();      // edges
  seg(); ctx.lineWidth = w; ctx.strokeStyle = '#b3aa9b'; ctx.stroke();                                // deck
  seg(); ctx.setLineDash([Math.max(1, z * 0.06), Math.max(2, z * 0.42)]);                             // joints between the stones
  ctx.lineWidth = w * 0.9; ctx.strokeStyle = '#958c7e'; ctx.stroke(); ctx.setLineDash([]);
}
function drawBridges(z) { for (const br of game.bridges) drawBridge(br.s, br.b, z); }

function vehiclePos(L) {
  // between sim steps, carry it on along the route at its own speed (lead is 0 outside drawing)
  const t = clamp(L.t + (L.kind === 'rail' ? CFG.trainSpeed : CFG.shipSpeed) * L.dir * lead, 0, L.path.length - 1);
  const k = Math.min(Math.floor(t), L.path.length - 2), f = t - k;
  const [ax, ay] = tileCenter(L.path[k]), [bx, by] = tileCenter(L.path[k + 1]);
  return [lerp(ax, bx, f), lerp(ay, by, f), Math.atan2(by - ay, bx - ax)];
}

// a sprite at a screen point, turned to `ang` (sprites face right) or mirrored left-right
function drawTurnedSprite(name, sx, sy, size, ang = 0, mirror = false) {
  const ras = RAS[name];
  if (!ras) return;
  const img = size * dpr <= 44 ? ras[1] : ras[0], smooth = ctx.imageSmoothingEnabled;
  if (PIXEL_ART.has(name)) ctx.imageSmoothingEnabled = size * dpr < img.width;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang); if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.imageSmoothingEnabled = smooth;
}
// Defences whose top turns to face what they shoot at. The base stays put; the top (drawn pointing right) turns
// towards b.aim, which is set each time it fires, at `turn` radians a second, and kicks back `kick` of its size
// on a shot (a turret rattles for as long as it keeps firing). rest = where a new one points, as its icon shows.
const DEFENCE_TOPS = {
  turret: { base: 'turretBase', top: 'turretGun', rest: -Math.PI / 6, turn: 6, kick: 0.05, burst: true },
  mortar: { base: 'mortarBase', top: 'mortarTube', rest: -0.91, turn: 9, kick: 0.12 },
  airdef: { base: 'airdefBase', top: 'airdefTop', rest: -0.61, turn: 12, kick: 0.08 },
};
// the top's angle in the world, turned a little further towards its target since the last frame
// (picture-only state: it isn't saved, so a loaded game starts every top at rest)
function defenceAngle(b) {
  const P = DEFENCE_TOPS[b.type], t = game.time;
  if (b.topA == null) { b.topA = P.rest; b.topT = t; }
  const dt = clamp(t - b.topT, 0, 0.25);
  b.topT = t;
  if (b.aim) {
    const [cx, cy] = tileCenter(b.i), dx = b.aim[0] - cx, dy = b.aim[1] - cy;
    if (dx * dx + dy * dy > 0.01) {
      const want = Math.atan2(dy, dx), d = Math.atan2(Math.sin(want - b.topA), Math.cos(want - b.topA));
      b.topA += clamp(d, -P.turn * dt, P.turn * dt);
    }
  }
  return b.topA;
}
function drawDefence(b, z) {
  const P = DEFENCE_TOPS[b.type], [x, y] = tileCenter(b.i), size = z * 1.25, a = defenceAngle(b) + cam.rot;
  drawSprite(P.base, x, y, size);
  const since = game.time - (b.fire == null ? -9 : b.fire);
  let kick = 0;
  if (P.burst) { if (since < 0.15) kick = (game.time * 16) % 1 < 0.5 ? 1 : 0.35; }
  else if (since < 0.3) kick = (1 - since / 0.3) ** 2;
  const [sx, sy] = toScreen(x, y), back = kick * P.kick * size;
  drawTurnedSprite(P.top, sx - Math.cos(a) * back, sy - Math.sin(a) * back, size, a);
}
function cargoLabel(c) {
  const parts = [];
  for (const r of ['iron', 'stone', 'wood', 'people']) if (c[r] >= 1) parts.push(`${c[r]} ${r}`);
  return parts.slice(0, 2).join(' · ') + (parts.length > 2 ? ' …' : '');
}
const VEH_FAR = 2;                                // below this zoom trains and ships are a few pixels, not pictures
function drawVehicles(z) {
  if (z < VEH_FAR) return drawVehiclesFar();
  for (const L of game.links.concat(game.freight)) {
    const [wx, wy, ang] = vehiclePos(L);
    const [sx, sy] = toScreen(wx, wy);
    if (sx < -60 || sy < -60 || sx > cw + 60 || sy > ch + 60) continue;
    if (L.cargo) {                                 // loaded: a gold crate marker, and what it carries up close
      const off = Math.max(14, z * 1.2);
      if (z >= 2) pill(sx, sy - off - 6, cargoLabel(L.cargo), { size: 10, fg: '#f2c14e', dot: '#a67c52' });
      else { ctx.fillStyle = '#f2c14e'; ctx.fillRect(sx - 3, sy - off, 6, 6); }
    }
    const heading = ang + (L.dir < 0 ? Math.PI : 0);
    if (L.kind === 'sea') {                        // a cargo ship, facing the way it sails
      const s = Math.max(18, z * 1.6);
      drawTurnedSprite('ship', sx, sy, s, 0, Math.cos(heading) < 0);
      continue;
    }
    const len = Math.max(9, z * 1.0), S = len * 32 / 28;   // the train sprites' bodies are 28 of their 32 pixels long
    const hx = Math.cos(heading) * len * 0.5, hy = Math.sin(heading) * len * 0.5;
    drawTurnedSprite('wagon', sx - hx, sy - hy, S, heading);
    drawTurnedSprite('engine', sx + hx, sy + hy, S, heading);
  }
}
// Zoomed out: a ship is a little white-over-red hull, a train a short red-and-grey dash along its track, a gold
// dot above anything carrying goods. All of them go into a few shapes, filled once each.
function drawVehiclesFar() {
  const hullE = new Path2D(), deck = new Path2D(), hull = new Path2D(), crateE = new Path2D(), crate = new Path2D();
  const rail = new Path2D(), wagon = new Path2D(), engine = new Path2D();
  for (const L of game.links.concat(game.freight)) {
    const [wx, wy, ang] = vehiclePos(L);
    const [sx, sy] = toScreen(wx, wy);
    if (sx < -20 || sy < -20 || sx > cw + 20 || sy > ch + 20) continue;
    if (L.cargo) { crateE.rect(sx - 2.5, sy - 8.5, 5, 5); crate.rect(sx - 1.75, sy - 7.75, 3.5, 3.5); }
    if (L.kind === 'sea') {
      hullE.rect(sx - 4, sy - 2.5, 8, 5);
      deck.rect(sx - 3, sy - 1.5, 6, 1.5); hull.rect(sx - 3, sy, 6, 1.5);
      continue;
    }
    const heading = ang + (L.dir < 0 ? Math.PI : 0), ux = Math.cos(heading) * 4.5, uy = Math.sin(heading) * 4.5;
    rail.moveTo(sx - ux, sy - uy); rail.lineTo(sx + ux, sy + uy);
    wagon.moveTo(sx - ux * 0.85, sy - uy * 0.85); wagon.lineTo(sx - ux * 0.1, sy - uy * 0.1);
    engine.moveTo(sx + ux * 0.1, sy + uy * 0.1); engine.lineTo(sx + ux * 0.85, sy + uy * 0.85);
  }
  ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fill(hullE);
  ctx.fillStyle = '#e8ecef'; ctx.fill(deck);
  ctx.fillStyle = '#b8432f'; ctx.fill(hull);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 3.6; ctx.strokeStyle = 'rgba(20,26,37,0.9)'; ctx.stroke(rail);
  ctx.lineWidth = 2; ctx.strokeStyle = '#8d969e'; ctx.stroke(wagon);
  ctx.strokeStyle = '#d9654a'; ctx.stroke(engine);
  ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fill(crateE);
  ctx.fillStyle = '#f2c14e'; ctx.fill(crate);
}

function render() {
  const z = cam.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // a missile landing on screen shakes the picture for a moment (a mortar shell, just a little)
  let shake = 0;
  for (const b of game.blasts) {
    if (b.air || !b.debris || b.t >= 0.3) continue;
    const [sx, sy] = toScreen(b.x, b.y);
    if (sx > -150 && sy > -150 && sx < cw + 150 && sy < ch + 150) shake = Math.max(shake, (b.big ? 1.15 : 0.22) * (1 - b.t / 0.3) ** 2);
  }
  if (shake > 0) {
    const k = shake * clamp(2 + z * 0.2, 3, 9);
    ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, cw, ch);   // no stale strip at the edge the picture moved away from
    ctx.setTransform(dpr, 0, 0, dpr, (Math.random() - 0.5) * 2 * k * dpr, (Math.random() - 0.5) * 2 * k * dpr);
  }
  drawSpace(z);
  canvas.style.cursor = '';
  drawSun(z);
  drawVulcan(z);
  drawOuterBodies(z);
  drawMoon(z);
  drawLockHover(z);

  // terrain + territory (1 px per tile, scaled up crisp)
  // crisp pixels up close; smooth scaling when zoomed far out (less shimmer)
  ctx.imageSmoothingEnabled = z < 1.5;
  drawAtmosphere(z);
  drawWorldImage(terrainCanvas);
  flushLayer(fillLayer); flushLayer(borderLayer);
  drawWorldImage(fillLayer.c);
  if (z < PIXEL_BORDER_BELOW) drawWorldImage(borderLayer.c);
  ctx.imageSmoothingEnabled = true;

  // visible tile range (check all four screen corners, since the camera can be rotated)
  const corners = [toWorld(0, 0), toWorld(cw, 0), toWorld(0, ch), toWorld(cw, ch)];
  const wx0 = Math.min(...corners.map(c => c[0])), wx1 = Math.max(...corners.map(c => c[0]));
  const wy0 = Math.min(...corners.map(c => c[1])), wy1 = Math.max(...corners.map(c => c[1]));
  const x0 = clamp(Math.floor(wx0) - 1, 0, W - 1), x1 = clamp(Math.ceil(wx1) + 1, 0, W - 1);
  const y0 = clamp(Math.floor(wy0) - 1, 0, H - 1), y1 = clamp(Math.ceil(wy1) + 1, 0, H - 1);

  // close up: border as crisp lines along tile edges that face unowned land/water
  if (z >= PIXEL_BORDER_BELOW) {
    const paths = { blue: new Path2D() };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      if (!owner[i]) {
        const a = aiOf[i];
        if (!a) continue;
        const q = paths['n' + a] || (paths['n' + a] = new Path2D());
        const [sx, sy] = toScreen(x, y);
        if (x === 0 || aiOf[i - 1] !== a) { q.moveTo(sx, sy); q.lineTo(sx, sy + z); }
        if (x === W - 1 || aiOf[i + 1] !== a) { q.moveTo(sx + z, sy); q.lineTo(sx + z, sy + z); }
        if (y === 0 || aiOf[i - W] !== a) { q.moveTo(sx, sy); q.lineTo(sx + z, sy); }
        if (y === H - 1 || aiOf[i + W] !== a) { q.moveTo(sx, sy + z); q.lineTo(sx + z, sy + z); }
        continue;
      }
      const p = paths.blue;
      const [sx, sy] = toScreen(x, y);
      if (x === 0 || !owner[i - 1]) { p.moveTo(sx, sy); p.lineTo(sx, sy + z); }
      if (x === W - 1 || !owner[i + 1]) { p.moveTo(sx + z, sy); p.lineTo(sx + z, sy + z); }
      if (y === 0 || !owner[i - W]) { p.moveTo(sx, sy); p.lineTo(sx + z, sy); }
      if (y === H - 1 || !owner[i + W]) { p.moveTo(sx, sy + z); p.lineTo(sx + z, sy + z); }
    }
    ctx.lineCap = 'square';
    ctx.lineWidth = Math.min(4, 1.5 + z * 0.12);
    ctx.strokeStyle = '#1c62d6'; ctx.stroke(paths.blue);
    for (const key in paths) if (key[0] === 'n') { ctx.strokeStyle = game.nations[+key.slice(1) - 1].hex; ctx.stroke(paths[key]); }
    ctx.lineCap = 'butt';
  }
  drawClaimFlash(z, x0, y0, x1, y1);

  drawBridges(z);
  drawRoads(z);
  drawPipes(z);
  // rail lines (sea routes aren't drawn: the ships sailing them are enough)
  for (const L of game.links) if (L.kind === 'rail') strokeRoute(L.path, 'rail', z);

  if (z >= CFG.detailZoom) {
    // detail view: every deposit tile and building as a sprite
    drawDepositsDetail(x0, y0, x1, y1, z);
    for (const b of game.buildings) {
      const x = b.i % W, y = (b.i / W) | 0;
      if (b.type === 'settlement' && x >= x0 - 9 && x <= x1 + 9 && y >= y0 - 9 && y <= y1 + 9) drawSettlementDetail(b, z * popScale(b));
    }
    for (const b of game.buildings) {
      const x = b.i % W, y = (b.i / W) | 0;
      if (b.type === 'settlement' || b.type === 'nuclear' || x < x0 || x > x1 || y < y0 || y > y1) continue;
      const k = popScale(b);
      if (DEFENCE_TOPS[b.type]) { drawDefence(b, z * k); continue; }
      drawSprite(b.type, x + 0.5, y + 0.5 + (DRILL_ANIM[b.type] ? drillJolt(b, z) : 0), z * k * (b.type === 'solar' ? 1.15 : b.type === 'pad' ? 1.7 : 1.25));
    }
    for (const b of game.buildings) {               // workers out on the tiles, then smoke on top of everything
      const x = b.i % W, y = (b.i / W) | 0;
      if (x < x0 - 5 || x > x1 + 5 || y < y0 - 5 || y > y1 + 5) continue;
      if (HARVESTS[b.type]) drawWorkers(b, z);
    }
    for (const b of game.buildings) {
      const x = b.i % W, y = (b.i / W) | 0;
      if (x < x0 || x > x1 || y < y0 - 2 || y > y1) continue;
      if (b.type === 'burner') drawBurnerSmoke(b, z * 1.25);
      else if (DRILL_ANIM[b.type]) drawDrill(b, z);
    }
    for (const b of game.buildings) {               // nuclear plants last: big, and their steam goes over everything
      if (b.type !== 'nuclear') continue;
      const x = b.i % W, y = (b.i / W) | 0;
      if (x < x0 - 6 || x > x1 + 6 || y < y0 - 6 || y > y1 + 8) continue;
      drawNuclear(b, z, popScale(b));
    }
    drawRockets(z, x0, y0, x1, y1);
  } else {
    // middle view: buildings as solid squares; map view: station/port icons (deposits show as their own coloured
    // ground). Either way the settlements as clusters of house pixels. All from the cached far layer.
    drawFar(z);
  }

  drawRingFx(z);
  drawCityLevels(z);
  drawPops(z);
  drawVehicles(z);
  drawFlights(z);
  drawStations(z);
  drawBuildPreview(z);
  drawReachHover(z);
  drawRings(z);
  drawSettlementHover(z);
  drawMissiles(z);
  drawSelection(z);
  drawDiskLabel(z);

  drawCountryLabels(z);


  // pushes: gold number at the advancing edge
  for (const p of game.pushes) {
    if (p.lx == null) { const [a, b] = nearestFrontier(p.tx, p.ty); p.lx = a; p.ly = b; }
    if (p.mx == null) { p.mx = p.lx; p.my = p.ly; }
    p.mx += (p.lx - p.mx) * 0.15; p.my += (p.ly - p.my) * 0.15;
    const [sx, sy] = toScreen(p.mx, p.my);
    const label = `${Math.ceil(p.budget)}`;
    const w = pill(sx, sy, label, { fg: '#f2c14e', border: '#f2c14e', size: 13, bold: 800, dot: '#141a25' });
    if (SPR.person.complete) ctx.drawImage(SPR.person, sx - w / 2 + 3, sy - 9, 18, 18);
  }

  // a nation's soldiers pushing into your land: the number left, at the advancing edge
  for (const r of game.raids) {
    if (r.lx == null) continue;
    if (r.mx == null) { r.mx = r.lx; r.my = r.ly; }
    r.mx += (r.lx - r.mx) * 0.15; r.my += (r.ly - r.my) * 0.15;
    const [sx, sy] = toScreen(r.mx, r.my), n = game.nations[r.n];
    const w = pill(sx, sy, `${Math.ceil(r.budget)}`, { fg: '#fff', bg: 'rgba(60,16,16,0.92)', border: n.hex, size: 13, bold: 800, dot: n.hex });
    if (SPR.person.complete) ctx.drawImage(SPR.person, sx - w / 2 + 3, sy - 9, 18, 18);
  }

  // expeditions
  for (const e of game.expeditions) {
    if (!e.auto) { drawVehicle(e, z); continue; }
    const [sx, sy] = toScreen(...shownPos(e)), [tx, ty] = toScreen(e.tx, e.ty);
    ctx.setLineDash([2, 9]); ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#f2c14e';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = 'butt';
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, Math.PI * 2); ctx.stroke();
    const overWater = biome[idx(Math.floor(e.x), Math.floor(e.y))] === OCEAN;
    ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#141a25'; ctx.fill(); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2.5; ctx.stroke();
    const spr = overWater ? SPR.boat : SPR.truck;
    if (spr.complete) ctx.drawImage(spr, sx - 13, sy - 13, 26, 26);
    const eta = Math.hypot(e.tx - e.x, e.ty - e.y) / CFG.expeditionSpeed;
    pill(sx, sy + 30, `${e.n} people · ${eta.toFixed(0)}s`, { dot: '#f2c14e', size: 11 });
  }

  // floating texts
  for (const f of game.floats) {
    const [sx, sy] = toScreen(f.x, f.y);
    ctx.globalAlpha = clamp(1.7 - f.t / 1.4, 0, 1);
    const pop = f.t < 0.25 ? 0.55 + 0.45 * easeOutBack(f.t / 0.25) : 1;   // pops in with a little overshoot
    pill(sx, sy - 18 - f.t * 22, f.text, { fg: f.color, size: 12 * pop });
    ctx.globalAlpha = 1;
  }
}

// Forests and deposits up close. Each tile gets a patch of ground (forest floor, gravel, rust-stained earth)
// and one to three pieces picked by the tile's own hash: mixed trees with stands of conifers, boulders and
// rubble, ore chunks with bright flecks. Thick in the middle of a deposit, thinner and smaller at its edge.
const GROUND = { forest: 'rgba(32,62,30,0.36)', stone: 'rgba(118,122,126,0.38)', iron: 'rgba(120,66,44,0.42)', uranium: 'rgba(44,58,38,0.5)' };
const ROCKS = { stone: ['rockA', 'rockB', 'rockC'], iron: ['oreA', 'oreB', 'oreC'], uranium: ['rockA', 'rockB', 'rockC'] };
// Paint the deposits of tiles x0..x1, y0..y1 into context g: `s` = g pixels per tile, `devK` = device pixels per
// g pixel, map(wx, wy) = where a world point lands in g. Used straight onto the screen, and for the chunk cache.
function paintDeposits(g, x0, y0, x1, y1, s, devK, map) {
  const ground = { forest: new Path2D(), stone: new Path2D(), iron: new Path2D(), uranium: new Path2D() };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dep = depositOf[idx(x, y)];
    if (dep < 0) continue;
    const [sx, sy] = map(x + 0.5 + (hash2(x, y, 31) - 0.5) * 0.3, y + 0.5 + (hash2(x, y, 32) - 0.5) * 0.3);
    const r = s * (0.62 + hash2(x, y, 33) * 0.2), gp = ground[deposits[dep].type];
    gp.moveTo(sx + r, sy); gp.arc(sx, sy, r, 0, Math.PI * 2);
  }
  for (const t in ground) { g.fillStyle = GROUND[t]; g.fill(ground[t]); }
  const sprite = (name, wx, wy, size) => {         // as drawSprite, onto g
    const ras = RAS[name];
    if (!ras) return;
    const img = size * devK <= 44 ? ras[1] : ras[0], [sx, sy] = map(wx, wy), smooth = g.imageSmoothingEnabled;
    if (PIXEL_ART.has(name)) g.imageSmoothingEnabled = size * devK < img.width;
    g.drawImage(img, sx - size / 2, sy - size / 2, size, size);
    g.imageSmoothingEnabled = smooth;
  };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {     // row by row, so nearer rows overlap the ones behind
    const i = idx(x, y), dep = depositOf[i];
    if (dep < 0 || building[i]) continue;
    const t = deposits[dep].type;
    let same = 0;
    for (const [dx, dy] of DIRS4) if (inb(x + dx, y + dy) && depositOf[idx(x + dx, y + dy)] === dep) same++;
    const inner = same === 4, n = inner ? (t === 'forest' ? 2 : 2 + (hash2(x, y, 41) < 0.35 ? 1 : 0)) : 1;
    const pine = t === 'forest' && vnoise(x / 7, y / 7, 99) > 0.56;   // conifers come in stands
    for (let k = 0; k < n; k++) {
      const h1 = hash2(x + k * 17, y, 21), h2 = hash2(x, y + k * 17, 22), h3 = hash2(x + k * 5, y + k * 3, 23);
      const wx = x + 0.5 + (h1 - 0.5) * 0.85, wy = y + 0.5 + (h2 - 0.5) * 0.6 + (k - (n - 1) / 2) * 0.3;
      if (t === 'forest') {
        const name = pine ? (h3 < 0.78 ? 'treeC' : 'treeB') : h3 < 0.42 ? 'treeA' : h3 < 0.76 ? 'treeB' : h3 < 0.92 ? 'treeD' : 'treeC';
        sprite(name, wx, wy, s * (1.75 + h1 * 0.9) * (inner ? 1 : 0.78));
      } else {
        const big = inner && k === 0, name = ROCKS[t][big ? (h3 < 0.6 ? 0 : 1) : h3 < 0.3 ? 0 : h3 < 0.65 ? 1 : 2];
        sprite(name, wx, wy, s * (big ? 2.1 + h1 * 0.6 : 1.35 + h1 * 0.7));
        if (t === 'uranium') {                     // a few faint green flecks in the rock: the only hint it's there
          const [fx, fy] = map(wx + (h2 - 0.5) * 0.4, wy - 0.1), r = Math.max(0.8, s * 0.07);
          g.fillStyle = 'rgba(157,255,122,0.75)'; g.fillRect(fx - r, fy - r, r * 2, r * 2);
          if (h3 > 0.5) { const [ax, ay] = map(wx - 0.25, wy + 0.12); g.fillRect(ax - r * 0.7, ay - r * 0.7, r * 1.4, r * 1.4); }
        }
      }
    }
  }
}
// Up close the deposits are thousands of sprites a frame, so they're cached: each 8 x 8-tile chunk keeps an image
// of exactly its own square of the finished picture (everything within 2 tiles of it is drawn in the usual order,
// clipped to the square), so the chunks fit together into the same picture with no seams. Chunks sit on a
// device-pixel grid fixed to the world, and are redrawn only when the zoom settles at a new level, or when a
// building goes up or comes down on or near one. While zooming (or with the camera turned) it draws directly.
const DEP_CH = 8, depCache = new Map();
let depView = { z: 0, dpr: 0, at: 0 }, depMem = 0, depCount = 0;
function depSig(X0, Y0) {                         // what a chunk's picture depends on: deposits and buildings near it
  let h = 0; depCount = 0;
  for (let y = Math.max(0, Y0 - 3); y < Math.min(H, Y0 + DEP_CH + 3); y++) for (let x = Math.max(0, X0 - 3); x < Math.min(W, X0 + DEP_CH + 3); x++) {
    const i = y * W + x, d = depositOf[i];
    if (d >= 0) depCount++;
    h = (Math.imul(h, 31) + (d + 2) * 3 + (building[i] ? 1 : 0)) | 0;
  }
  return h;
}
// a chunk's cached picture if it's still good (null if it needs drawing)
function depCached(cx, cy, ver, now) {
  const key = cy * 4096 + cx, e = depCache.get(key);
  if (!e || e.ver !== ver) return null;
  if (now - e.at > 150) {                         // look for new or removed buildings around it a few times a second
    if (e.sig !== depSig(cx * DEP_CH, cy * DEP_CH)) return null;
    e.at = now;
  }
  depCache.delete(key); depCache.set(key, e);    // most recently used last
  return e;
}
function depChunk(cx, cy, s, ver) {
  const key = cy * 4096 + cx, X0 = cx * DEP_CH, Y0 = cy * DEP_CH, sig = depSig(X0, Y0);
  let e = depCache.get(key);
  if (e) { depMem -= e.mem; depCache.delete(key); }
  const X1 = Math.min(W, X0 + DEP_CH), Y1 = Math.min(H, Y0 + DEP_CH);
  const px0 = Math.round(X0 * s), py0 = Math.round(Y0 * s), w = Math.round(X1 * s) - px0, h = Math.round(Y1 * s) - py0;
  e = { sig, ver, px0, py0, c: null, mem: 0, at: performance.now() };
  if (depCount && w > 0 && h > 0) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    paintDeposits(c.getContext('2d'), Math.max(0, X0 - 2), Math.max(0, Y0 - 2), Math.min(W - 1, X1 + 1), Math.min(H - 1, Y1 + 1), s, 1,
      (wx, wy) => [wx * s - px0, wy * s - py0]);
    e.c = c; e.mem = w * h; depMem += e.mem;
  }
  depCache.set(key, e);
  for (const [k, old] of depCache) { if (depMem <= 12e6) break; depMem -= old.mem; depCache.delete(k); }   // keep it under ~48 MB
  return e;
}
function drawDepositsDetail(x0, y0, x1, y1, z) {
  const now = performance.now();
  if (z !== depView.z || dpr !== depView.dpr) { depView = { z, dpr, at: now }; depCache.clear(); depMem = 0; }
  if (cam.rot || now - depView.at < 200 || z * dpr > 64) { paintDeposits(ctx, x0, y0, x1, y1, z, dpr, toScreen); return; }
  const s = z * dpr, ver = Object.keys(RAS).length * 1000 + PIXEL_ART.size;   // (sprites that finish loading later redraw the chunks)
  const offX = Math.round((cam.x * z - cw / 2) * dpr), offY = Math.round((cam.y * z - ch / 2) * dpr);   // the screen's corner on that grid
  // Chunks that need drawing get a few milliseconds a frame. One that isn't ready yet is drawn directly, clipped to
  // its own square: since every chunk is exactly its square of the picture, cached and direct ones fit together.
  // Time left over goes to the ring of chunks just outside the view, so panning finds them ready.
  const t0 = performance.now(), cx0 = Math.floor(x0 / DEP_CH), cx1 = Math.floor(x1 / DEP_CH), cy0 = Math.floor(y0 / DEP_CH), cy1 = Math.floor(y1 / DEP_CH);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    let e = depCached(cx, cy, ver, t0);
    if (!e && performance.now() - t0 < 4) e = depChunk(cx, cy, s, ver);
    if (e) { if (e.c) ctx.drawImage(e.c, e.px0 - offX, e.py0 - offY); continue; }
    const X0 = cx * DEP_CH, Y0 = cy * DEP_CH, X1 = Math.min(W, X0 + DEP_CH), Y1 = Math.min(H, Y0 + DEP_CH), px0 = Math.round(X0 * s), py0 = Math.round(Y0 * s);
    ctx.save(); ctx.beginPath(); ctx.rect(px0 - offX, py0 - offY, Math.round(X1 * s) - px0, Math.round(Y1 * s) - py0); ctx.clip();
    paintDeposits(ctx, Math.max(0, X0 - 2), Math.max(0, Y0 - 2), Math.min(W - 1, X1 + 1), Math.min(H - 1, Y1 + 1), s, 1, (wx, wy) => [wx * s - offX, wy * s - offY]);
    ctx.restore();
  }
  ctx.restore();
  for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
    if (cy >= cy0 && cy <= cy1 && cx >= cx0 && cx <= cx1) continue;
    if (performance.now() - t0 >= 4) return;
    if (cx >= 0 && cy >= 0 && cx * DEP_CH < W && cy * DEP_CH < H && !depCached(cx, cy, ver, t0)) depChunk(cx, cy, s, ver);
  }
}

// The houses around a settlement are drawn, not built: more of them (and bigger ones) as it grows.
// Always the same spots for the same settlement, skipping water, deposits and real buildings.
function sprawlOf(b) {
  const lvl = settlementLevel(b), n = Math.min(lvl >= 4 ? 36 : 26, Math.floor(settlementCap(b) / 8));
  if (b._n === n && b._lvl === lvl) return b.sprawl;
  const side = sideOf(b.i), cx = b.i % W, cy = (b.i / W) | 0, out = [], used = new Set([b.i]);
  for (let k = 0; k < 90 && out.length < n; k++) {
    const a = hash2(b.i % 9973, k, 71) * Math.PI * 2, rad = 1.7 + hash2(b.i % 9973, k, 72) * (1.2 + Math.sqrt(k) * 0.55);
    const x = Math.round(cx + Math.cos(a) * rad), y = Math.round(cy + Math.sin(a) * rad);
    if (!inb(x, y)) continue;
    const t = idx(x, y);
    if (used.has(t) || !isLand(t) || sideOf(t) !== side || building[t] || depositOf[t] >= 0) continue;
    used.add(t);
    out.push({ x, y, type: lvl >= 3 && rad < (lvl >= 4 ? 4.6 : 3.2) ? 'house3' : lvl >= 2 && rad < 3.8 ? 'house2' : 'house', v: hash2(x, y, 73) });
  }
  out.sort((p, q) => p.y - q.y);
  b._n = n; b._lvl = lvl; b.sprawl = out;
  return out;
}
const OWN_HEX = '#2f7de1';
// The looks each kind of house comes in (sprites/house*.png), and where a look's chimney is (sprite pixels,
// 32x32) for its smoke. A house keeps its look: it's picked from its spot.
const HOUSE_LOOKS = { house: ['house', 'houseB', 'houseC', 'houseD'], house2: ['house2', 'house2B', 'house2C'], house3: ['house3', 'house3B', 'house3C'] };
const CHIMNEY = { house: [20, 10], houseC: [11, 11], house2: [20, 7] };
const lookOf = h => { const L = HOUSE_LOOKS[h.type]; return L[Math.min(L.length - 1, Math.floor((h.v || 0) * L.length))]; };
function drawSettlementDetail(b, z) {
  const x = b.i % W, y = (b.i / W) | 0, lvl = settlementLevel(b), size = z * 1.3, houses = sprawlOf(b);
  // front-on, so back rows first: the houses behind the centre, the centre, then the houses in front of it
  const house = h => { const look = lookOf(h); drawSprite(RAS[look] ? look : h.type, h.x + 0.5, h.y + 0.5, size); };
  for (const h of houses) if (h.y <= y) house(h);
  drawSprite('settle' + (Math.min(lvl, 3) + 1), x + 0.5, y + 0.3, z * (2.5 + lvl * 0.35));
  for (const h of houses) if (h.y > y) house(h);
  // chimney smoke: a few soft puffs rising and drifting off, each house on its own beat
  const px = Math.max(1.5, size / 32 * 1.6);
  for (const h of houses) {
    const c = CHIMNEY[lookOf(h)];
    if (!c || hash2(h.x, h.y, 74) > 0.6) continue;  // not every chimney is lit
    const [sx, sy] = toScreen(h.x + 0.5, h.y + 0.5), cx = sx + (c[0] / 32 - 0.5) * size, cy = sy + (c[1] / 32 - 0.5) * size;
    for (let k = 0; k < 3; k++) {
      const f = (game.time * 0.45 + h.v * 7 + k / 3) % 1, s = px * (1 + f * 1.6);
      ctx.fillStyle = `rgba(226,228,230,${0.75 * (1 - f)})`;
      ctx.fillRect(cx + Math.sin(f * 4 + h.v * 9) * px + f * size * 0.18 - s / 2, cy - f * size * 0.5 - s / 2, s, s);
    }
  }
}
// A wood burner's chimney puffs smoke while it burns: thick and steady at full load, a thin wisp when it's
// barely needed, nothing when it's idle or out of wood. Puffs rise, swell, darken to grey and drift off.
function drawBurnerSmoke(b, size) {
  let load = 1;                                    // an AI nation's burner just always runs
  if (owner[b.i]) {
    const c = game.countries[countryOf[b.i]], m = c && c.mw, cap = c && c.pw ? c.pw.burners * CFG.power.burnerWood : 0;
    load = m && cap ? Math.min(1, m.burn / cap) : 0;
  }
  if (load <= 0.01) return;
  const x = b.i % W, y = (b.i / W) | 0, v = hash2(x, y, 75);
  const [sx, sy] = toScreen(x + 0.5, y + 0.5);
  const cx = sx + (19.5 / 32 - 0.5) * size, cy = sy + (2 / 32 - 0.5) * size;   // the chimney's mouth on the sprite
  // Dirty wood smoke: sooty black out of the chimney, thinning to a brown-grey smear that hangs over the plant.
  // Each puff is a lump of a few squares, so it reads as billowing smoke, not a row of dots.
  const px = Math.max(2, size / 32 * 2.6), n = 5 + Math.round(load * 6), a0 = 0.7 + 0.25 * load;
  for (let k = 0; k < n; k++) {
    const f = (game.time * 0.36 + v * 5 + k / n) % 1, s = px * (1.1 + f * 3.8);
    const r = Math.round(28 + f * 92), g = Math.round(26 + f * 84), bl = Math.round(24 + f * 74);   // soot to dirty haze
    const a = a0 * Math.pow(1 - f, 0.6) * Math.min(1, f * 8);
    const wob = Math.sin(f * 5 + v * 11 + k) * px * 1.1;
    const x = cx + wob + f * f * size * 0.7, y = cy - f * size * 1.15;
    ctx.fillStyle = `rgba(${r},${g},${bl},${a})`;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    ctx.fillStyle = `rgba(${r},${g},${bl},${a * 0.7})`;           // the lumps that make it billow
    ctx.fillRect(x - s * 0.95, y - s * 0.1, s * 0.6, s * 0.6);
    ctx.fillRect(x + s * 0.3, y - s * 0.75, s * 0.55, s * 0.55);
  }
  if (load > 0.3) {                                // a working plant leaves a dirty smudge hanging over it
    ctx.fillStyle = `rgba(60,52,44,${0.12 * load})`;
    ctx.beginPath(); ctx.ellipse(cx + size * 0.45, cy - size * 1.05, size * 0.75, size * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  }
}
// ---------- the nuclear plant: a landmark, drawn by code in its own sprite pixels ----------
// Like a city, it stands on one tile but looks far bigger. On a concrete pad set back from the shore: two cooling
// towers, a turbine hall with big wall fans, the reactor dome and a striped vent stack. The plant's own tile holds
// the pump house, which pipes sea water in (blue) and warm water back out (orange). The harder it works, the more
// steam rolls off the towers, the faster the fans spin and the water runs, and the brighter the reactor's band
// glows. Idle, it stands still and quiet. Drawing only: none of this is saved, and none of it changes the game.
const NUKE = { W: 112, H: 90, ox: 56, oy: 80, px: 1.5 / 32 };   // body canvas, its ground centre in it, tiles per body pixel
let nukeBody = null;
function paintNukeBody() {
  const c = document.createElement('canvas'); c.width = NUKE.W; c.height = NUKE.H;
  const g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x) + NUKE.ox, Math.round(y) + NUKE.oy, Math.round(w), Math.round(h)); };
  const span = (l, r, y, col) => { l = Math.round(l); r = Math.round(r); if (r > l) R(l, y, r - l, 1, col); };
  // one scanline across a round shape: dark edges, lit on the left, shaded on the right
  const row = (cx, y, hw, cols) => {
    const l = Math.round(cx - hw), r = Math.round(cx + hw), w = r - l;
    if (w <= 0) return;
    R(l, y, w, 1, cols[3]);
    if (w <= 2) return;
    R(l + 1, y, w - 2, 1, cols[1]);
    R(l + 1, y, Math.max(1, Math.round((w - 2) * 0.28)), 1, cols[0]);
    const b = Math.max(1, Math.round((w - 2) * 0.3)); R(r - 1 - b, y, b, 1, cols[2]);
  };
  const oval = (cx, cy, rx, ry, col) => {
    for (let dy = -ry; dy <= ry; dy++) { const hw = rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)); span(cx - hw, cx + hw, cy + dy, col); }
  };
  const SHADOW = 'rgba(16,20,26,0.32)';
  // the concrete pad, seen at a slant: a lit back edge, a dark front edge, painted lines
  for (let y = -16; y <= 7; y++) { const hw = 44 + (y + 16) * 0.35; span(-hw, hw, y, y >= 5 ? '#454b52' : y === -16 ? '#a3aab1' : '#7c838a'); }
  for (let x = -40; x <= 36; x += 9) R(x, 2, 4, 1, '#c9a43a');
  // a cooling tower: a waisted shell, open legs at its foot, weathered bands and a dark mouth up top
  const tower = (cx, by, h, wb, wt, ww) => {
    const hwAt = t => t < 0.72 ? ww + (wb - ww) * ((0.72 - t) / 0.72) ** 2 : ww + (wt - ww) * ((t - 0.72) / 0.28) ** 2;
    oval(cx + 7, by, wb + 3, 3, SHADOW);
    for (let r = 0; r <= h; r++) row(cx, by - r, hwAt(r / h), ['#f1f3f5', '#d5dade', '#9ba4ad', '#59626b']);
    for (const t of [0.8, 0.86]) row(cx, by - Math.round(h * t), hwAt(t), ['#d3d8dd', '#b7bec5', '#868f98', '#59626b']);
    span(cx - wb, cx + wb, by - 2, '#3a4047'); span(cx - wb, cx + wb, by - 1, '#3a4047'); span(cx - wb, cx + wb, by, '#3a4047');
    for (let x = cx - wb + 2; x < cx + wb - 2; x += 4) R(x, by - 2, 2, 3, '#8a939c');
    oval(cx, by - h, wt, 2, '#59626b'); oval(cx, by - h, wt - 1.5, 1, '#262b31');
  };
  tower(-8, -6, 50, 15, 10, 9);                    // the back tower
  // the vent stack, red and white, behind the reactor
  R(42, -3, 8, 3, '#5f666d');
  for (let y = -66; y < -2; y++) { const red = Math.floor(-y / 6) % 2 === 0; R(44, y, 4, 1, red ? '#c8453a' : '#e9ecef'); R(47, y, 1, 1, red ? '#8e2c24' : '#a9b0b7'); }
  R(43, -68, 6, 2, '#3b424a');
  tower(-32, 2, 54, 16, 11, 10);                   // the front tower
  // the turbine hall: a long shed with a row of lit windows and two big fans in its wall
  oval(4, 5, 19, 2, SHADOW);
  R(-16, -11, 30, 16, '#3a4450'); R(-15, -10, 28, 15, '#7d8b9a'); R(-15, -10, 28, 2, '#97a5b3'); R(9, -10, 4, 15, '#64717f');
  for (let x = -13; x < 8; x += 4) R(x, -7, 2, 2, '#ffd977');
  R(-17, -13, 32, 3, '#4c5664'); R(-17, -13, 32, 1, '#6a7584');
  for (const fx of [-9, 1]) { oval(fx, 0, 4, 4, '#5a6573'); oval(fx, 0, 3, 3, '#1d232a'); }
  R(13, -6, 3, 3, '#59626b');                      // the steam line from the reactor
  // the reactor: a round building under a dome, a glowing band round it (lit in the animation), a door
  oval(34, 5, 17, 3, SHADOW);
  for (let y = 0; y <= 18; y++) row(28, 5 - y, 14, ['#eef1f4', '#c9cfd5', '#929ba4', '#545d66']);
  for (let dy = 1; dy <= 12; dy++) row(28, -13 - dy, 14 * Math.sqrt(Math.max(0, 1 - (dy / 12.5) ** 2)), ['#ffffff', '#e2e7eb', '#aab3bb', '#545d66']);
  R(15, -8, 27, 2, '#2c5b63');
  R(25, 0, 6, 5, '#353c44'); R(26, 1, 4, 4, '#4a525b');
  oval(28, -4, 1, 1, '#f2c14e');
  return c;
}
const nukeSea = new WeakMap();   // per plant: which way the open sea is, and the nearest water tile
function nukeSeaOf(b) {
  let s = nukeSea.get(b);
  if (s) return s;
  const x = b.i % W, y = (b.i / W) | 0;
  let vx = 0, vy = 0, best = 1e9, wx = x + 1, wy = y;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if ((!dx && !dy) || !inb(x + dx, y + dy) || biome[idx(x + dx, y + dy)] !== OCEAN) continue;
    const d = Math.hypot(dx, dy); vx += dx / (d * d); vy += dy / (d * d);
    if (d < best) { best = d; wx = x + dx; wy = y + dy; }
  }
  const L = Math.hypot(vx, vy);
  s = L ? { vx: vx / L, vy: vy / L, wx, wy } : { vx: 1, vy: 0, wx, wy };
  nukeSea.set(b, s);
  return s;
}
// how hard it's working, 0..1 (an AI nation's plant just always runs)
function nukeLoad(b) {
  if (!owner[b.i]) return 1;
  const c = game.countries[countryOf[b.i]];
  return c && c.mw && c.pw && c.pw.nukes ? clamp((c.mw.nuke || 0) / (c.pw.nukes * CFG.buildings.nuclear.gen), 0, 1) : 0;
}
// where it all goes on screen: the plant's tile (pump house), the sea's way, the mirror, body pixel size, and the
// body's ground centre, placed so the reactor's front sits a little inland of the pump house (further when the sea
// is up the screen, so the dome doesn't hide the pump house)
function nukeGeom(b, z) {
  const S = nukeSeaOf(b), x = b.i % W + 0.5, y = ((b.i / W) | 0) + 0.5;
  const [tx, ty] = toScreen(x, y), [ax, ay] = toScreen(x + S.vx, y + S.vy);
  const L = Math.hypot(ax - tx, ay - ty) || 1, dx = (ax - tx) / L, dy = (ay - ty) / L;
  const flip = dx < -0.2 ? -1 : 1, p = z * NUKE.px, gap = (0.7 + 0.9 * Math.max(0, -dy)) * z;
  return { S, tx, ty, dx, dy, flip, p, bx: tx - dx * gap - 38 * flip * p, by: ty - dy * gap - 4 * p };
}
// is screen point (x, y) on the plant as drawn?
function onNuke(b, z, x, y) {
  const G = nukeGeom(b, z), p = G.p;
  return Math.abs(x - G.bx) < 48 * p && y > G.by - 62 * p && y < G.by + 8 * p || Math.hypot(x - G.tx, y - G.ty) < Math.max(8, 8 * p);
}
function drawNuclear(b, z, k) {
  if (!nukeBody) nukeBody = paintNukeBody();
  const G = nukeGeom(b, z), { S, tx, ty, dx, dy, flip, bx, by } = G, p = G.p * k;
  const load = nukeLoad(b), t = game.time, v = hash2(b.i % 9973, 3, 91), on = load > 0.01;
  const [mx, my] = toScreen(S.wx + 0.5, S.wy + 0.5);   // the pipe mouth, out in the water
  const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const body = () => {
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = p < 1;
    ctx.save(); ctx.translate(bx, by); ctx.scale(p * flip, p);
    ctx.drawImage(nukeBody, -NUKE.ox, -NUKE.oy);
    ctx.imageSmoothingEnabled = smooth;
    // the reactor's band: a cold teal at rest, a bright pulsing glow at work
    if (on) {
      const a = (0.35 + 0.6 * load) * (0.75 + 0.25 * Math.sin(t * 2.6 + v * 6));
      ctx.fillStyle = `rgba(111,243,255,${0.16 * a})`;
      ctx.beginPath(); ctx.ellipse(28, -7, 19, 6, 0, 0, Math.PI * 2); ctx.fill();
      R(15, -8, 27, 2, `rgba(140,248,255,${a})`);
    }
    // the wall fans, spinning with the turbines
    const spin = t * (0.6 + 9 * load) + v * 6;
    for (const [fx, ph] of [[-9, 0], [1, 1.1]]) {
      for (let j = 0; j < 3; j++) {
        const a = (on ? spin : v * 6) + ph + j * Math.PI * 2 / 3;
        for (let s = 1; s <= 3; s++) R(fx + Math.cos(a) * s - 0.6, Math.sin(a) * s - 0.6, 1.2, 1.2, '#aab3bb');
      }
      R(fx - 0.5, -0.5, 1, 1, '#e2e7eb');
    }
    // warning lamps on the dome and the stack, blinking out of step
    for (const [lx, ly, ph] of [[28, -26, 0], [45.5, -69, 0.5]]) {
      if ((t * 0.9 + v + ph) % 1 < 0.5) {
        ctx.fillStyle = 'rgba(255,74,58,0.3)'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();
        R(lx - 1, ly - 1, 2, 2, '#ff4a3a');
      } else R(lx - 1, ly - 1, 2, 2, '#5a1a14');
    }
    ctx.restore();
  };
  // two pipes from the reactor to the pump house and on into the sea: cold water in, warm water out
  const pipes = () => {
    const sx = bx + 41 * flip * p, sy = by + 3 * p, pts = [[sx, sy], [tx, ty], [mx, my]];
    for (const [off, col, dir] of [[-1.6, '#7fd6ff', 1], [1.6, '#ffb36b', -1]]) {
      const nx = -dy * off * p, ny = dx * off * p;
      ctx.beginPath();
      pts.forEach(([px, py], j) => j ? ctx.lineTo(px + nx, py + ny) : ctx.moveTo(px + nx, py + ny));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2 * p; ctx.strokeStyle = '#2b3038'; ctx.stroke();
      ctx.lineWidth = 2 * p; ctx.strokeStyle = '#8d96a0'; ctx.stroke();
      if (on) {
        ctx.setLineDash([1.6 * p, 3.4 * p]); ctx.lineDashOffset = dir * t * 10 * p * (0.3 + load);
        ctx.lineWidth = 1.1 * p; ctx.strokeStyle = col; ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    }
  };
  // at the mouth: an intake grate, ripples rolling out, pale streaks of warm water drifting off to sea
  const water = () => {
    ctx.save(); ctx.translate(mx, my); ctx.scale(p, p);
    if (on) {
      for (let j = 0; j < 3; j++) {
        const f = (t * 0.5 + j / 3 + v) % 1, r = 3 + f * 12;
        ctx.strokeStyle = `rgba(210,238,255,${0.5 * (1 - f) * (0.4 + 0.6 * load)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      }
      for (let j = 0; j < 7; j++) {
        const f = (t * 0.3 + j / 7 + v * 3) % 1, d = 4 + f * 24, side = (hash2(j, 7, 92) - 0.5) * 12 * (0.3 + f), s = 1.5 + f * 2.5;
        R(dx * d - dy * side - s / 2, dy * d + dx * side - s * 0.3, s, s * 0.6, `rgba(190,240,255,${0.55 * (1 - f) * load})`);
      }
    }
    R(-3, -2, 6, 4, '#1d232a'); R(-2, -1, 1, 2, '#6b747d'); R(0, -1, 1, 2, '#6b747d'); R(2, -1, 1, 2, '#6b747d');
    ctx.restore();
  };
  const pump = () => {
    ctx.save(); ctx.translate(tx, ty); ctx.scale(p, p);
    R(-7, -6, 14, 10, '#2b3038'); R(-6, -5, 12, 8, '#b8c0c8'); R(-6, -5, 12, 2, '#d5dade');
    R(-7, -8, 14, 3, '#2f6fa8'); R(-7, -8, 14, 1, '#5b9bd0'); R(-2, -1, 4, 4, '#353c44');
    ctx.restore();
  };
  // steam off the towers: fat white billows that swell, grey and drift off downwind. A cloud hangs over a busy plant.
  const steam = () => {
    if (!on) return;
    ctx.save(); ctx.translate(bx, by); ctx.scale(p, p);
    const n = 5 + Math.round(load * 8), a0 = 0.45 + 0.45 * load;
    if (load > 0.4) {
      ctx.fillStyle = `rgba(232,236,240,${0.16 * load})`;
      ctx.beginPath(); ctx.ellipse(-6 * flip + 22, -96, 38, 11, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const [cx0, top, w0, sd] of [[-8, -56, 9, 1], [-32, -52, 10, 2]]) {
      const cx = cx0 * flip;
      for (let j = 0; j < n; j++) {
        const f = (t * 0.16 + v * 5 + sd * 0.37 + j / n) % 1, s = w0 * (1.1 + f * 2.2) * (0.6 + 0.4 * load);
        const px = cx + Math.sin(f * 4 + j * 1.7 + sd) * 2.5 + f * f * 34, py = top - 2 - f * 46;
        const a = a0 * Math.pow(1 - f, 0.9) * Math.min(1, f * 7), sh = Math.round(246 - f * 44);
        ctx.fillStyle = `rgba(${sh},${sh + 2},${sh + 6},${a})`;
        ctx.fillRect(px - s / 2, py - s / 2, s, s * 0.8);
        ctx.fillStyle = `rgba(${sh},${sh + 2},${sh + 6},${a * 0.75})`;
        ctx.fillRect(px - s * 0.95, py - s * 0.05, s * 0.6, s * 0.55);
        ctx.fillRect(px + s * 0.25, py - s * 0.7, s * 0.6, s * 0.55);
      }
    }
    for (let j = 0; j < 3; j++) {                  // the turbine hall's roof vents breathe a little too
      const f = (t * 0.4 + v * 2 + j / 3) % 1, s = 2 + f * 4;
      ctx.fillStyle = `rgba(240,242,245,${0.5 * (1 - f) * load})`;
      ctx.fillRect(4 * flip + Math.sin(f * 5 + j) - s / 2 + f * 6, -15 - f * 14 - s / 2, s, s);
    }
    ctx.restore();
  };
  if (dy < -0.3) { water(); pipes(); pump(); body(); }   // the sea behind the plant (up the screen): pipes first
  else { body(); water(); pipes(); pump(); }
  steam();
}
// Mining rigs and ice drills at work, drawn over their sprite in its own 32x32 pixels: a steel hammer block hauled
// up the derrick and dropped onto the drill string. Each blow jolts the machine, throws sparks and a ring of dust
// off the base and kicks chunks out onto the pile, while a diesel stack on the side puffs sooty exhaust and
// coughs a fat cloud on every stroke. The lamp up top blinks while it runs, and glows red when it has no power.
const DRILL_ANIM = {
  rig:   { top: 6, bot: 18, base: 24, lamp: [14, 2, 4, 3], on: '#ffe066', off: '#9a7414', stack: [4, 15, 9], period: 0.85 },
  drill: { top: 5, bot: 15, base: 19, lamp: [14, 1, 4, 3], on: '#8fe0ff', off: '#2a6f96', stack: [25, 9, 10], period: 1.0 },
};
const CHIP = { forest: ['#a0683e', '#d9a066'], stone: ['#9aa1a8', '#d6dade'], iron: ['#b4613d', '#ef9a6a'], ice: ['#d8eef8', '#ffffff'] };
function drillEffort(b) {
  if (b.type === 'rig') return effortOf(b);
  const c = owner[b.i] ? game.countries[countryOf[b.i]] : null;   // an ice drill runs while fuel flows to a pad
  return !c ? 1 : c.fuelFlow ? (c.sat ?? 1) : 0;
}
// where the hammer is in its stroke: 0..1 up the derrick, and how far past the blow we are (-1: not just after one)
function drillStroke(b) {
  const A = DRILL_ANIM[b.type], e = drillEffort(b);
  if (e <= 0) return { e, lift: 0, after: -1 };
  const q = (game.time / (A.period / Math.max(0.35, e)) + hash2(b.i % 9973, 5, 81)) % 1;
  const lift = q < 0.72 ? Math.sin(q / 0.72 * Math.PI / 2) : q < 0.8 ? 1 - (q - 0.72) / 0.08 : 0;   // haul up slow, drop fast
  return { e, lift, after: q >= 0.8 ? (q - 0.8) / 0.2 : -1 };
}
// the jolt when the hammer lands, in tiles (the sprite is drawn this far lower)
const drillJolt = b => { const s = DRILL_ANIM[b.type] && drillStroke(b); return s && s.after >= 0 && s.after < 0.12 ? 0.035 : 0; };   // about one sprite pixel
function drawDrill(b, z) {
  const A = DRILL_ANIM[b.type], x = b.i % W, y = (b.i / W) | 0, size = z * 1.25, p = size / 32, v = hash2(x, y, 82);
  const { e, lift, after } = drillStroke(b), [sx, sy] = toScreen(x + 0.5, y + 0.5);
  const kind = b.type === 'drill' ? 'ice' : b.work ? ['iron', 'stone', 'forest'].reduce((m, k) => b.work[k] > (b.work[m] || 0) ? k : m, 'iron') : 'stone';
  const [chipD, chipL] = CHIP[kind];
  ctx.save();
  ctx.translate(sx - size / 2, sy - size / 2 + drillJolt(b, z) * z); ctx.scale(p, p);   // now in sprite pixels
  const R = (x2, y2, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x2, y2, w, h); };
  // exhaust stack
  const [kx, ky, kh] = A.stack;
  R(kx - 0.5, ky - 0.5, 3, kh + 1, '#1c2028'); R(kx, ky, 2, kh, '#4a515c'); R(kx, ky, 1, kh, '#6b7480'); R(kx - 0.5, ky - 1, 3, 1.2, '#2b3038');
  // hammer block, riding the drill string
  const hy = A.bot - (A.bot - A.top) * lift;
  R(13, hy - 0.5, 6, 4, '#1c2028'); R(13.5, hy, 5, 3, '#8d96a0'); R(13.5, hy, 5, 1, '#c9ced6'); R(17.5, hy, 1, 3, '#5f6b7d');
  // lamp: blinking amber/blue while it works, red when it's stopped for want of power
  const [lx, ly, lw, lh] = A.lamp, c = owner[b.i] ? game.countries[countryOf[b.i]] : null;
  const noPower = c && (c.sat ?? 1) < 0.05, blink = Math.floor(game.time * 2.2 + v * 4) % 2 === 0;
  const lamp = noPower ? (blink ? '#ff5a4a' : '#7a1f18') : e > 0 && blink ? A.on : A.off;
  if (e > 0 && blink || noPower && blink) {
    ctx.fillStyle = noPower ? 'rgba(255,90,74,0.28)' : A.on + '44';
    ctx.beginPath(); ctx.arc(lx + lw / 2, ly + lh / 2, 4.5, 0, Math.PI * 2); ctx.fill();
  }
  R(lx, ly, lw, lh, lamp);
  if (after >= 0) {
    const cx = 16, cy = A.base, k = after;
    if (k < 0.3) {                                               // sparks off the blow
      ctx.globalAlpha = 1 - k / 0.3;
      for (let j = 0; j < 6; j++) {
        const a = -Math.PI * (0.1 + 0.8 * hash2(j, Math.floor(game.time * 3), 83)), r = 2 + k * 14;
        R(cx + Math.cos(a) * r - 0.5, cy - 1 + Math.sin(a) * r * 0.7 - 0.5, 1, 1, j % 2 ? '#ffd166' : '#fff4c2');
      }
    }
    ctx.globalAlpha = 1;
    for (let j = 0; j < 8; j++) {                                // a ring of dust rolling out along the ground
      const side = j % 2 ? 1 : -1, r = 3 + k * (10 + (j >> 1) * 2.5), s = 2 + k * 4;
      ctx.fillStyle = `rgba(150,128,100,${0.6 * (1 - k)})`;
      ctx.fillRect(cx + side * r - s / 2, cy + 1 - k * 3 - (j >> 1) * 0.8 - s / 2, s, s);
    }
    for (let j = 0; j < 3; j++) {                                // chunks hopping out onto the pile
      const tx = b.type === 'rig' ? 25.5 : j % 2 ? 29.5 : 2, ty = b.type === 'rig' ? 20.5 : A.base + 6;
      const sx2 = cx + (tx - cx) * k, sy2 = cy - 1 + (ty - cy + 1) * k - Math.sin(k * Math.PI) * (6 + j * 2);
      R(sx2 - 0.75 + j * 0.6, sy2 - 0.75, 1.5, 1.5, j === 1 ? chipL : chipD);
    }
  }
  ctx.restore();
  // exhaust: sooty diesel puffs, thicker with load, and a fat cough right after each blow
  if (e <= 0) return;
  const ox = sx - size / 2 + (kx + 1) * p, oy = sy - size / 2 + (ky - 1) * p, u = Math.max(1.5, p * 1.6), n = 4 + Math.round(e * 4);
  for (let k = 0; k < n; k++) {
    const f = (game.time * 0.5 + v * 3 + k / n) % 1, s = u * (1 + f * 3.4);
    const r = Math.round(30 + f * 85), g = Math.round(28 + f * 78), bl = Math.round(26 + f * 70);
    const a = (0.65 + 0.3 * e) * Math.pow(1 - f, 0.6) * Math.min(1, f * 8);
    const px2 = ox + Math.sin(f * 6 + v * 9 + k) * u + f * f * size * 0.5, py2 = oy - f * size * 0.9;
    ctx.fillStyle = `rgba(${r},${g},${bl},${a})`; ctx.fillRect(px2 - s / 2, py2 - s / 2, s, s);
    ctx.fillStyle = `rgba(${r},${g},${bl},${a * 0.65})`; ctx.fillRect(px2 - s * 0.9, py2 - s * 0.1, s * 0.55, s * 0.55);
  }
  if (after >= 0 && after < 0.7) {                               // the cough
    const k = after / 0.7, s = u * (2.2 + k * 4);
    ctx.fillStyle = `rgba(24,22,20,${0.75 * (1 - k)})`;
    ctx.fillRect(ox - s / 2 + k * u * 2, oy - k * size * 0.3 - s / 2, s, s);
    ctx.fillRect(ox - s * 0.9 + k * u * 2, oy - k * size * 0.3 - s * 0.1, s * 0.6, s * 0.6);
  }
}
// Zoomed out, a settlement is drawn as what it is: a cluster of little coloured blocks, one per house, in the same
// spots as its houses up close. Red roofs for houses, blue for apartments, pale grey for city blocks, and a bright
// block at the centre. A hamlet is a few specks; a city is a patch you can't miss. No icons to cover the map.
// roof and wall colour for each look, as its sprite
const PIXEL = {
  house: ['#d9694a', '#e8d3a8'], houseB: ['#6f97c4', '#a0683e'], houseC: ['#a8744e', '#d9c7a0'], houseD: ['#e0a93a', '#e8d3a8'],
  house2: ['#6f97c4', '#f0e2c0'], house2B: ['#a8744e', '#f0d9a8'], house2C: ['#d9694a', '#cfe3ff'],
  house3: ['#a3b4c6', '#5f6b7d'], house3B: ['#c2d0de', '#3f4857'], house3C: ['#679a5e', '#a0543c'],
};
// ---------- the far layer ----------
// Zoomed out, the towns are thousands of little houses, and building that picture every frame was most of a
// frame's work. So it's drawn into an off-screen picture a margin bigger than the screen, together with what else
// sits still out there (the middle view's building squares, the map's port, station and pad markers), and each
// frame only places that picture, moved and scaled to follow the camera. It's redrawn when the zoom settles at a
// new level, when the view slides past its margin, when the camera turns, or when a building comes or goes or a
// town grows. The settlements' own centre pixels (red while under fire) are drawn fresh on top every frame.
const FAR_MARK = 1.5;                             // below this zoom a port, station or pad is a few pixels, not an icon
const FARL = { c: null, z: 0, rot: 0, tier: -1, sig: 0, dpr: 0, cw: 0, ch: 0, M: 0, ax: 0, ay: 0, at: 0, miss: false,
  tsig: 0, tAt: -1e9, zSeen: 0, zAt: 0 };
// house pixel size, its dark edge, and a settlement's centre pixel at zoom z
const housePx = z => Math.max(z * 0.82, 1.7);
// the far layer's contents, into g in screen coordinates: everything up to m pixels past the screen's edges.
// Returns true if an icon wasn't loaded yet (so it's redrawn shortly).
function paintFar(g, z, m, tier) {
  const zc = z * cam.cos, zs = z * cam.sin, hw = cw / 2, hh = ch / 2, ox = cam.x - 0.5, oy = cam.y - 0.5;   // toScreen, inlined
  const off = (sx, sy, r) => sx < -m - r || sy < -m - r || sx > cw + m + r || sy > ch + m + r;
  let miss = false;
  if (tier === 2) {                                // middle view: buildings as solid squares, one shape per colour
    const sq = {};
    for (const b of game.buildings) {
      if (b.type === 'settlement') continue;
      const [sx, sy] = toScreen(b.i % W, (b.i / W) | 0);
      if (off(sx, sy, z)) continue;
      if (b.type === 'nuclear') { (sq.nuclear || (sq.nuclear = new Path2D())).rect(sx - z * 0.6, sy - z * 0.6, z * 2.2, z * 2.2); continue; }   // a landmark: bigger
      (sq[b.type] || (sq[b.type] = new Path2D())).rect(sx + z * 0.12, sy + z * 0.12, z * 0.76, z * 0.76);
    }
    for (const t in sq) { g.fillStyle = BLD_COLOR[t]; g.fill(sq[t]); }
  } else {                                         // map view: stations, ports and pads
    const edge = new Path2D(), core = {};
    for (const b of game.buildings) {
      if (b.type !== 'station' && b.type !== 'port' && b.type !== 'pad') continue;
      const [sx, sy] = toScreen(...tileCenter(b.i));
      if (off(sx, sy, 10)) continue;
      if (tier === 0) {                            // far out: a dark square with a dot of its colour
        edge.rect(sx - 3.5, sy - 3.5, 7, 7);
        (core[b.type] || (core[b.type] = new Path2D())).rect(sx - 2, sy - 2, 4, 4);
        continue;
      }
      g.beginPath(); g.arc(sx, sy, 8, 0, Math.PI * 2); g.fillStyle = 'rgba(20,26,37,0.85)'; g.fill();
      if (SPR[b.type].complete) g.drawImage(SPR[b.type], sx - 8, sy - 8, 16, 16); else miss = true;
    }
    g.fillStyle = 'rgba(20,26,37,0.9)'; g.fill(edge);
    for (const t in core) { g.fillStyle = BLD_COLOR[t]; g.fill(core[t]); }
  }
  if (z < 0.15) return miss;                       // from orbit the whole disk is only a few pixels
  // Every house goes into one shape per colour, filled once at the end: a handful of fills instead of
  // two rectangles and two colour changes per house.
  const px = housePx(z), edge = px >= 4 ? 1 : 0.5, edges = new Path2D(), fills = {};
  const fill = c => fills[c] || (fills[c] = new Path2D());
  for (const b of game.buildings) {
    if (b.type !== 'settlement') continue;
    const dx = b.i % W - ox, dy = ((b.i / W) | 0) - oy;
    if (off(dx * zc - dy * zs + hw, dx * zs + dy * zc + hh, 60)) continue;
    for (const h of sprawlOf(b)) {                 // a house: its roof on top, its wall below
      const ex = h.x - ox, ey = h.y - oy, sx = ex * zc - ey * zs + hw - px / 2, sy = ex * zs + ey * zc + hh - px / 2;
      const c = h.c || (h.c = PIXEL[lookOf(h)]), r = Math.round(px * 0.45);
      edges.rect(sx - edge, sy - edge, px + edge * 2, px + edge * 2);
      fill(c[0]).rect(sx, sy, px, r); fill(c[1]).rect(sx, sy + r, px, px - r);
    }
  }
  g.fillStyle = 'rgba(20,26,37,0.85)'; g.fill(edges);
  for (const c in fills) { g.fillStyle = c; g.fill(fills[c]); }
  return miss;
}
// what the far layer shows: which buildings stand where (checked every frame: a new building shows at once)...
function farSig() {
  let h = game.buildings.length;
  for (const b of game.buildings) h = (Math.imul(h, 31) + b.i * 13 + b.type.length * 7 + b.type.charCodeAt(0)) | 0;
  return h;
}
// ...and how big each town has grown (a few times a second)
function townSig() {
  let h = 0;
  for (const b of game.buildings) if (b.type === 'settlement') { sprawlOf(b); h = (Math.imul(h, 31) + b._n * 5 + b._lvl) | 0; }
  return h;
}
function drawFar(z) {
  const now = performance.now(), rot = cam.rot || 0, tier = z >= CFG.cityZoom ? 2 : z >= FAR_MARK ? 1 : 0;
  if (z !== FARL.zSeen) { FARL.zSeen = z; FARL.zAt = now; }
  if (now - FARL.tAt > 300) { FARL.tsig = townSig(); FARL.tAt = now; }
  const sig = (Math.imul(farSig(), 7) + FARL.tsig) | 0;
  let r = z / FARL.z, px = 0, py = 0;
  let ok = FARL.c && FARL.dpr === dpr && FARL.cw === cw && FARL.ch === ch && FARL.rot === rot && FARL.tier === tier
    && (FARL.sig === sig || now - FARL.at < 250)   // (with a lot being built, at most four redraws a second)
    && !(FARL.miss && now - FARL.at > 250)
    && !(r !== 1 && now - FARL.zAt > 120);         // the zoom has settled at a new level: redraw it sharp
  if (ok) {                                        // (mid-zoom the picture is stretched, until the zoom stops)
    [px, py] = toScreen(FARL.ax, FARL.ay);
    const w = FARL.c.width / dpr * r, h = FARL.c.height / dpr * r;
    ok = r > 0.4 && r < 2 && px <= 0.5 && py <= 0.5 && px + w >= cw - 0.5 && py + h >= ch - 0.5;
  }
  if (!ok) {
    const M = Math.round(Math.max(cw, ch) * 0.25), w = Math.ceil((cw + 2 * M) * dpr), h = Math.ceil((ch + 2 * M) * dpr);
    if (!FARL.c) FARL.c = document.createElement('canvas');
    const g = FARL.c.getContext('2d');
    if (FARL.c.width !== w || FARL.c.height !== h) { FARL.c.width = w; FARL.c.height = h; }
    else { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); }
    g.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
    FARL.miss = paintFar(g, z, M, tier);
    [FARL.ax, FARL.ay] = toWorld(-M, -M);
    Object.assign(FARL, { z, rot, tier, sig, dpr, cw, ch, M, at: now });
    r = 1; px = -M; py = -M;
  }
  const smooth = ctx.imageSmoothingEnabled;
  if (r === 1) { px = Math.round(px * dpr) / dpr; py = Math.round(py * dpr) / dpr; ctx.imageSmoothingEnabled = false; }   // pixel for pixel
  ctx.drawImage(FARL.c, px, py, FARL.c.width / dpr * r, FARL.c.height / dpr * r);
  ctx.imageSmoothingEnabled = smooth;
  drawTownCentres(z);
}
// each settlement's own centre pixel, on top of its houses: gold, or red while it's being shelled
function drawTownCentres(z) {
  if (z < 0.15) return;
  const px = housePx(z), edge = px >= 4 ? 1 : 0.5, s = px * 1.5;
  const cEdges = new Path2D(), cCalm = new Path2D(), cHit = new Path2D();
  const zc = z * cam.cos, zs = z * cam.sin, hw = cw / 2, hh = ch / 2, ox = cam.x - 0.5, oy = cam.y - 0.5;
  for (const b of game.buildings) {
    if (b.type !== 'settlement') continue;
    const dx = b.i % W - ox, dy = ((b.i / W) | 0) - oy, cx = dx * zc - dy * zs + hw, cy = dx * zs + dy * zc + hh;
    if (cx < -60 || cy < -60 || cx > cw + 60 || cy > ch + 60) continue;
    const sx = cx - s / 2, sy = cy - s / 2;
    cEdges.rect(sx - edge, sy - edge, s + edge * 2, s + edge * 2); (underFire(b) ? cHit : cCalm).rect(sx, sy, s, s);
  }
  ctx.fillStyle = 'rgba(20,26,37,0.85)'; ctx.fill(cEdges);
  ctx.fillStyle = '#f2d98a'; ctx.fill(cCalm);
  ctx.fillStyle = '#ff7a6b'; ctx.fill(cHit);
}
function reachRing(i, color, z, dash = [7, 6], R = CFG.settlement.reach) {
  const [sx, sy] = toScreen(...tileCenter(i));
  ctx.beginPath(); ctx.arc(sx, sy, (R + 0.5) * z, 0, Math.PI * 2);
  ctx.setLineDash(dash); ctx.lineWidth = 1.8; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
}
// Many overlapping range circles drawn as ONE shape: the area they cover together, filled once, and only the
// outer edge stroked (each circle's arcs that no other circle covers). circles = [[sx, sy, r], ...] on screen.
function unionRings(circles, { color, dash = [7, 6], width = 1.8, fill = null }) {
  const C = [];
  for (const c of circles) if (c[2] > 0 && !C.some(o => Math.abs(o[0] - c[0]) < 0.5 && Math.abs(o[1] - c[1]) < 0.5 && Math.abs(o[2] - c[2]) < 0.5)) C.push(c);
  if (!C.length) return;
  if (fill) {                                      // all arcs wound the same way: the nonzero rule fills the union once
    ctx.beginPath();
    for (const [x, y, r] of C) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
    ctx.fillStyle = fill; ctx.fill();
  }
  const TAU = Math.PI * 2;
  ctx.beginPath();
  C.forEach(([x, y, r], k) => {
    const cov = [];                                // the angles of this circle that lie inside another one
    for (let j = 0; j < C.length; j++) {
      if (j === k) continue;
      const [x2, y2, r2] = C[j], d = Math.hypot(x2 - x, y2 - y);
      if (d + r <= r2) return;                     // swallowed whole by a bigger circle: no edge of its own
      if (d >= r + r2 || d + r2 <= r) continue;    // apart, or the other one sits inside this one
      const mid = Math.atan2(y2 - y, x2 - x), half = Math.acos(clamp((r * r + d * d - r2 * r2) / (2 * r * d), -1, 1));
      let a = ((mid - half) % TAU + TAU) % TAU, b = a + 2 * half;
      if (b > TAU) { cov.push([a, TAU], [0, b - TAU]); } else cov.push([a, b]);
    }
    cov.sort((p, q) => p[0] - q[0]);
    let at = 0;
    const open = [];
    for (const [a, b] of cov) { if (a > at) open.push([at, a]); at = Math.max(at, b); }
    if (at < TAU) open.push([at, TAU]);
    // join the piece that ends at 2pi with the one that starts at 0, so a gap-free arc isn't split at the seam
    if (open.length > 1 && open[0][0] === 0 && open[open.length - 1][1] === TAU) { const last = open.pop(); open[0] = [last[0], TAU + open[0][1]]; }
    for (const [a, b] of open) if (b - a > 1e-3) { ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); ctx.arc(x, y, r, a, b); }
  });
  ctx.setLineDash(dash); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
}
const ringAt = (i, R, z) => { const [sx, sy] = toScreen(...tileCenter(i)); return [sx, sy, (R + 0.5) * z]; };
// placing a settlement: the land your cities protect, the village's own zone in green, or in red with the city it's
// too close to (and how far away from it it has to be)
function drawReachPreview(i, z) {
  unionRings(allCities().filter(b => owner[b.i]).map(b => ringAt(b.i, zoneOf(b), z)), { color: 'rgba(255,255,255,0.28)', dash: [3, 7] });
  const near = crowdingCity(i);
  if (near) reachRing(near.i, '#ff7a6b', z, [4, 5], CFG.settlement.spacing);
  reachRing(i, near ? '#ff7a6b' : '#7bd389', z, [7, 6], CFG.settlement.levels[0].zone);
}
// placing a collector: deposit tiles it would work in green, tiles another collector already works in grey
function drawHarvestPreview(i, type, z) {
  const cid = sideOf(i), kinds = HARVESTS[type], upgrade = type === 'rig';
  if (owner[i] && z >= 1.5) eachInReach(i, t => {
    if (!harvestable(t, cid, kinds)) return;
    const [sx, sy] = toScreen(t % W, (t / W) | 0);
    ctx.fillStyle = isHarvested(t) && !upgrade ? 'rgba(150,158,170,0.45)' : 'rgba(123,211,137,0.45)';
    ctx.fillRect(sx, sy, z + 0.5, z + 0.5);
  }, CFG.collectorReach);
  reachRing(i, '#7bd389', z, [5, 5], CFG.collectorReach);
}
// pointing at (or near) a settlement shows what it is and how many people live there; nothing is written on it otherwise
function drawSettlementHover(z) {
  if (!mouse.in || mouse.down >= 0 || pointingAtBody()) return;
  let best = null, bd = Math.max(20, z * 1.8);
  for (const b of game.buildings) {
    if (b.type !== 'settlement') continue;
    const [sx, sy] = toScreen(...tileCenter(b.i)), d = Math.hypot(sx - mouse.x, sy - mouse.y);
    if (d < bd) { bd = d; best = { b, sx, sy }; }
  }
  if (!best) return;
  const b = best.b, foe = nationAt(b.i), who = foe || countryAt(b.i), cap = settlementCap(b), pop = b.pop || 0;
  const r = ringGeom(b, z)[2] + 2;                 // just below the ring the pointer puts round it
  const pw = !foe && owner[b.i] && poweredHousing(cityLevel(b)) > 0 ? ` (${Math.round(poweredShare(who) * 100)}% powered)` : '';
  if (z >= CFG.cityZoom * 0.5 && b !== inspected) reachRing(b.i, foe ? foe.hex : 'rgba(242,193,78,0.7)', z, [5, 6], zoneOf(b));   // the land it protects
  pill(best.sx, best.sy + r + 16, `${cityName(b)}${pw} · ${fmtNum(pop)} / ${Math.round(cap)} people${underFire(b) ? ` · under attack, not growing (${fireLeft(b)}s)` : ''}`, { dot: foe ? foe.hex : OWN_HEX, size: 11 });
}
// ---------- pointing and picking: a ring glides to whatever you point at; clicking one of yours opens its card ----------
// Anything can be picked: a building, a truck or boat you drove out, a train or cargo ship on its route, a bridge.
const kindOf = o => !o ? null : o.orbital ? 'orbital' : o.type ? 'building' : o.throttle !== undefined ? 'flight' : o.supplies !== undefined ? 'exp' : o.path && o.dir !== undefined ? 'link' : o.tiles && o.s !== undefined ? 'bridge' : null;
const expSize = () => clamp(cam.zoom * 2.6, 26, 60);
// what's at a screen point: a vehicle first (they move over everything), then the building on the tile (zoomed in,
// or a station/port/pad icon from far out), then a bridge under the pointer, else the nearest settlement within reach
function pickAt(x, y) {
  const z = cam.zoom, [wx, wy] = toWorld(x, y), tx = Math.floor(wx), ty = Math.floor(wy);
  const near = (p, r) => { const [sx, sy] = toScreen(p[0], p[1]); return Math.hypot(sx - x, sy - y) < r; };
  for (const st of game.orbitals) if (near(shownOrbit(st), stationSize(st, z) * 0.6)) return st;
  for (const f of game.flights) if (!f.done && near(shownFlight(f), clamp(z * 2.4, 18, 64) * 0.6)) return f;
  for (const e of game.expeditions) if (!e.auto && !e.done && near(shownPos(e), expSize() * 0.55)) return e;
  if (z >= 1) for (const L of game.links.concat(game.freight)) if (near(vehiclePos(L), Math.max(10, z * 1.1))) return L;
  if (inb(tx, ty)) {
    const t = idx(tx, ty);
    if (building[t] && building[t] !== BLD_CODE.settlement) {
      const b = buildingAt(t);
      if (b && (z >= CFG.cityZoom || b.type === 'station' || b.type === 'port' || b.type === 'pad')) return b;
    }
  }
  // a nuclear plant: anywhere on it as drawn (its towers and dome stand inland of the tile it's on)
  if (z >= CFG.detailZoom) for (const b of game.buildings) if (b.type === 'nuclear' && onNuke(b, z, x, y)) return b;
  // a bridge: anywhere on its deck as drawn (a straight span from shore to shore), not only the stair of water
  // tiles it was traced through, which a diagonal deck only half covers
  if (z >= 0.5) for (const br of game.bridges) {
    const [ax, ay] = toScreen(...tileCenter(br.s)), [bx, by] = toScreen(...tileCenter(br.b));
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1, u = ((x - ax) * vx + (y - ay) * vy) / L2;
    if (u < 0.04 || u > 0.96) continue;            // the shores themselves are land, not the bridge
    if (Math.hypot(x - (ax + vx * u), y - (ay + vy * u)) < Math.max(8, z * 0.65)) return br;
  }
  let best = null, bd = Math.max(18, z * 1.6);
  for (const b of game.buildings) {
    if (b.type !== 'settlement') continue;
    const [sx, sy] = toScreen(...tileCenter(b.i)), d = Math.hypot(sx - x, sy - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
const buildingNear = (x, y) => { const o = pickAt(x, y); return kindOf(o) === 'building' ? o : null; };
// what the mouse is pointing at right now (nothing while you build, aim, paste, drag or drive)
const pointedAt = () => !mouse.in || mouse.dragged || mouse.down >= 0 || game.tool || game.aiming || blueprint || game.driving
  || pointingAtBody() ? null : pickAt(mouse.x, mouse.y);
// far out (your world is one small disk) or over a moon or planet, the pointer is about that body: nothing on the
// ground lights up as well, so only one ring and one label show at a time
const pointingAtBody = () => cam.zoom < WORLD_LOCK_ZOOM || !!bodyUnder(...toWorld(mouse.x, mouse.y));
// is it still there (and still yours)?
function stillThere(o) {
  switch (kindOf(o)) {
    case 'building': return building[o.i] && buildingAt(o.i) === o && owner[o.i];
    case 'exp': return game.expeditions.includes(o) && !o.done;
    case 'flight': return game.flights.includes(o) && !o.done;
    case 'orbital': return game.orbitals.includes(o);
    case 'link': return game.links.includes(o) || game.freight.includes(o);
    case 'bridge': return game.bridges.includes(o);
  }
  return false;
}
const mineOf = o => kindOf(o) !== 'building' || !!owner[o.i];   // vehicles, routes and bridges are always yours
let inspected = null;                              // whatever's card is open
const ringFx = { hover: { x: 0, y: 0, r: 0, a: 0, b: null }, sel: { x: 0, y: 0, r: 0, a: 0, b: null }, t: performance.now() };
// where something's ring sits (world) and how big it is (pixels)
function ringGeom(o, z) {
  switch (kindOf(o)) {
    case 'exp': { const [x, y] = shownPos(o); return [x, y, expSize() * 0.68]; }
    case 'flight': { const [x, y] = shownFlight(o); return [x, y, clamp(z * 2.4, 18, 64) * 0.8]; }
    case 'orbital': { const [x, y] = shownOrbit(o); return [x, y, stationSize(o, z) * 0.72]; }
    case 'link': { const [x, y] = vehiclePos(o); return [x, y, o.kind === 'sea' ? Math.max(14, z * 1.1) : Math.max(12, z * 1.3)]; }
    case 'bridge': {
      const [ax, ay] = tileCenter(o.s), [bx, by] = tileCenter(o.b);
      return [(ax + bx) / 2, (ay + by) / 2, Math.max(14, Math.hypot(bx - ax, by - ay) * z * 0.5 + z * 0.6)];
    }
  }
  const [cx, cy] = tileCenter(o.i);
  if (o.type === 'nuclear' && z >= CFG.detailZoom) { const G = nukeGeom(o, z); return [...toWorld(G.bx, G.by - 24 * G.p), 52 * G.p]; }
  if (o.type !== 'settlement') return [cx, cy, Math.max(0.8 * z, 12)];
  const lvl = settlementLevel(o);
  return [cx, cy - 0.15, z >= CFG.cityZoom ? Math.max((1.3 + lvl * 0.22) * z, 16) : 15 + lvl * 3];
}
// ease a ring toward its target: it slides from one thing to the next, follows a moving one, and fades in and out
function stepRing(R, o, dt, z) {
  const k = 1 - Math.exp(-dt * 18);
  if (o) {
    const [x, y, r] = ringGeom(o, z), [ax, ay] = toScreen(R.x, R.y), [bx, by] = toScreen(x, y);
    const fresh = !R.b || R.a < 0.05, moving = ['exp', 'link', 'flight', 'orbital'].includes(kindOf(o));
    if (fresh || Math.hypot(ax - bx, ay - by) > 260) { R.x = x; R.y = y; if (fresh) R.r = r * 0.7; }   // far away: just appear there
    else if (moving && R.b === o) { R.x = x; R.y = y; }   // stay on a moving vehicle
    else { R.x += (x - R.x) * k; R.y += (y - R.y) * k; }
    R.r += (r - R.r) * k; R.a += (1 - R.a) * k; R.b = o;
  } else { R.a -= R.a * k; R.r *= 1 + 0.4 * dt; if (R.a < 0.01) { R.a = 0; R.b = null; } }
}
// the gliding ring, drawn in the one dashed-circle look (dashRing): picked things a little bolder, with marching dashes
function drawRing(R, col, spin, sel) {
  if (R.a < 0.01) return;
  const [sx, sy] = toScreen(R.x, R.y);
  dashRing(sx, sy, R.r, `rgb(${col[0]},${col[1]},${col[2]})`, { alpha: R.a * (sel ? 1 : 0.9), width: sel ? 2.4 : 2, march: spin * 8 });
}
function drawRings(z) {
  const now = performance.now(), dt = Math.min(0.1, (now - ringFx.t) / 1000);
  ringFx.t = now;
  if (inspected && !stillThere(inspected)) inspect(null);
  const hb = pointedAt();
  stepRing(ringFx.sel, inspected, dt, z);
  stepRing(ringFx.hover, hb && hb !== inspected && hb !== game.flying ? hb : null, dt, z);
  drawRing(ringFx.sel, [242, 193, 78], 0.7, true);
  const foe = ringFx.hover.b && !mineOf(ringFx.hover.b);
  drawRing(ringFx.hover, foe ? [255, 122, 107] : [242, 193, 78], 0, false);
}
// open (or close, with null) a card
function inspect(o) {
  inspected = kindOf(o) === 'flight' ? null : o;   // a rocket has its own readout while you fly it
  updateInspect();
}
const secs = s => s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.ceil(s)}s`;
const listRes = (o, keys = ['wood', 'stone', 'iron', 'people']) => keys.filter(r => (o[r] || 0) >= 1).map(r => `${Math.floor(o[r])} ${r}`).join(' · ');
// The card: everything there is to know about the thing you clicked, refreshed ten times a second.
// Each builder fills `rows` and returns [title, icon, subtitle].
function updateInspect() {
  const el = $('inspect');
  if (!el) return;
  const o = inspected;
  if (!o || !stillThere(o)) { inspected = null; el.classList.remove('open'); return; }
  const rows = [];
  const row = (k, v, cls = '') => rows.push(`<div class="ir"><span>${k}</span><b class="${cls}">${v}</b></div>`);
  const bar = (f, cls = '') => rows.push(`<div class="ibar ${cls}"><i style="width:${(clamp(f, 0, 1) * 100).toFixed(1)}%"></i></div>`);
  const note = (s, cls = 'd') => rows.push(`<div class="in ${cls}">${s}</div>`);
  const sep = () => rows.push('<div class="isep"></div>');
  const button = (label, act, ok = true, n = '') => rows.push(`<button class="ibtn" data-act="${act}" data-n="${n}"${ok ? '' : ' disabled'}>${label}</button>`);
  const ui = { row, bar, note, sep, button };
  const kind = kindOf(o);
  const [title, icon, sub] = kind === 'orbital' ? cardStation(o, ui) : kind === 'exp' ? cardExpedition(o, ui) : kind === 'link' ? cardLink(o, ui) : kind === 'bridge' ? cardBridge(o, ui) : cardBuilding(o, ui);
  const key = `${kind}:${o.i ?? ''}:${icon}`;
  if (el.dataset.key !== key) {                    // something new (or a settlement that levelled up): redo the icon
    el.dataset.key = key;
    el.querySelector('.iicon').innerHTML = SVG[icon] || '';
  }
  el.querySelector('.it').textContent = title;
  el.querySelector('.isub').textContent = sub;
  const body = rows.join(''), ib = el.querySelector('.ibody');
  if (ib.dataset.html !== body) { ib.innerHTML = body; ib.dataset.html = body; }   // only touch the page when something changed
  el.classList.add('open');
}
// reloading weapons: ready, or how long until they are, with a bar
function reloadRows(b, { row, bar }) {
  const left = (b.ready || 0) - game.time;
  if (left > 0.05 && b.rd) { row('Status', `Reloading · ${left.toFixed(1)}s`, 'r'); bar(1 - left / b.rd, 'gold'); }
  else row('Status', 'Loaded', 'g');
}
// what upgrading this city would do: shown by the settlement tool over the city
function upgradeTip(b) {
  const c = countryAt(b.i), S = CFG.settlement, lvl = cityLevel(b), step = upgradeStep(lvl);
  if (!step) return [`<div class="t">${cityName(b)}</div><div class="d">As big as a city gets</div>`, true];
  const next = levelDef(lvl + 1), mw = step.pow / S.perMW;
  const miss = missingFor(step.cost, c), spare = c.mw ? Math.max(0, c.mw.max - c.mw.need) : 0;
  const unfilled = Math.max(0, (c.pw.capPow - (c.powCap || 0)) / S.perMW);   // MW its cities already lack
  let html = `<div class="t">Upgrade ${cityName(b)} to ${next.name}</div>`;
  html += step.pow ? `<div class="g">+${fmtNum(step.add)} homes: ${fmtNum(step.pow)} of them run on power and need ${fmtNum(mw)} MW</div>`
    : `<div class="g">+${fmtNum(step.add)} homes, no power needed</div>`;
  if (step.pow) html += spare - unfilled >= mw ? `<div class="g">${c.short} has the spare power: they fill up right away</div>`
    : `<div class="d">${c.short} has ${fmtNum(Math.max(0, spare - unfilled))} MW to spare for them: they only fill as far as the power reaches. Without power it still houses ${fmtNum(unpoweredHousing(lvl + 1))}.</div>`;
  html += `<div class="g">Stores ${next.store / levelDef(lvl).store}x as much and protects the land within ${next.zone} tiles</div>`;
  html += `<div class="d">Cost: ${listRes(step.cost, ['wood', 'stone', 'iron'])}, paid by ${c.short}</div>`;
  if (miss) html += `<div class="r">Not enough ${miss}: click to ask your other countries to ship it</div>`;
  return [html, !!miss];
}
function cardBuilding(b, ui) {
  const { row, bar, note, sep, button } = ui;
  const c = countryAt(b.i), def = CFG.buildings[b.type], S = CFG.settlement;
  if (b.type === 'settlement') {
    const lvl = cityLevel(b), D = levelDef(lvl), cap = settlementCap(b), pop = b.pop || 0, ST = CFG.storage;
    const unp = unpoweredHousing(lvl), maxPow = poweredHousing(lvl), powered = Math.max(0, cap - unp);
    const draw = Math.min(Math.max(0, pop - unp), powered) / S.perMW;   // what its people on power draw right now
    row('People', `${fmtNum(pop)} / ${Math.round(cap)}`);
    bar(cap > 0 ? pop / cap : 0);
    if (underFire(b)) row('Growth', `Under attack (${fireLeft(b)}s)`, 'r');
    else row('Growth', pop < cap - 0.5 ? (c.growth > 0.005 ? 'Growing' : 'Waiting for people') : 'Full', pop < cap - 0.5 && c.growth > 0.005 ? 'g' : '');
    sep();
    if (maxPow > 0) {
      row('Housing', `${fmtNum(D.housing)}`);
      row('Without power', `${fmtNum(unp)}`);
      row('On power', `+${Math.round(powered)} of ${fmtNum(maxPow)}`, powered > 0.5 ? 'g' : 'r');
      bar(powered / maxPow, 'power');
      row('Uses', `${draw.toFixed(1)} of ${fmtNum(maxPow / S.perMW)} MW`, draw > 0.05 ? 'u' : '');
      if (maxPow - powered > 0.5) {
        const mw = Math.max(0, (c.pw.capPow - (c.powCap || 0)) / S.perMW);
        note(`${c.short}'s cities are ${Math.round(poweredShare(c) * 100)}% powered: ${fmtNum(Math.ceil(mw))} MW more would fill them`, 'r');
      } else note('Fully powered', 'g');
    } else {
      row('Housing', `${fmtNum(D.housing)}`);
      note(`Needs no power. From City up, housing past ${fmtNum(S.unpowered)} runs on power`);
    }
    row('Stores', `${fmtNum(ST.wood.city * D.store)} wood, stone · ${fmtNum(ST.iron.city * D.store)} iron`);
    row('Protects', `Land within ${D.zone} tiles`);
    note('While it has people, enemies must fight them to take that land');
    {
      const step = upgradeStep(lvl);
      if (step) {
        const miss = missingFor(step.cost, c);
        button(`Upgrade to ${levelDef(lvl + 1).name}: ${listRes(step.cost, ['wood', 'stone', 'iron'])} · +${fmtNum(step.add)} homes${step.pow ? `, ${fmtNum(step.pow / S.perMW)} MW` : ''}`, 'upgrade', true);
        note(miss ? `Not enough ${miss}: upgrading asks your other countries to ship it` : say('Or press 1 (Settlement) and click the city', 'Or pick Settlement and tap the city twice'), miss ? 'r' : 'd');
      } else note('As big as a city gets', 'g');
    }
    return [D.name, 'settle' + (Math.min(lvl - 1, 3) + 1), c.full];
  }
  const M = c.mw || { gen: 0, max: 0, need: 0 }, ST = c.store || {};   // (no store yet before the first tick after a load)
  switch (b.type) {
    case 'cabin': case 'camp': case 'rig': {
      const tiles = DEP_TYPES.filter(k => b.work && b.work[k]);
      if (!tiles.length) note('Nothing in reach to work: build it next to a deposit', 'r');
      for (const k of tiles) row(`${k[0].toUpperCase() + k.slice(1)} tiles worked`, `${b.work[k]}`);
      const out = outputOf(b);
      for (const r in out) {
        const full = isFull(c, r);
        row('Makes', `+${out[r].toFixed(2)} ${r} / sec`, full ? 'r' : 'g');
        if (full) note(`${c.short}'s ${r} storage is full: nothing is coming in until it's used`, 'r');
      }
      if (b.type !== 'rig') {
        row('Uses', `${def.workers} workers`, c.staff < 0.999 ? 'r' : 'u');
        if (c.staff < 0.999) note(`${c.short} is short of people: working at ${Math.round(c.staff * 100)}%`, 'r');
      } else {
        row('Uses', `${def.use} MW`, c.sat < 0.999 ? 'r' : 'u');
        if (c.sat < 0.999) note(`Short of power: running at ${Math.round(c.sat * 100)}%`, 'r');
        note(`${CFG.power.rigMult}x a crew's output, no workers`);
      }
      row('Reach', `${CFG.collectorReach} tiles`);
      sep();
      row(`${c.short} stock`, tiles.map(k => DEP_RES[k]).filter((r, i, a) => a.indexOf(r) === i).map(r => `${fmtNum(c.res[r])} / ${fmtNum(ST[r] || 0)} ${r}`).join(' · ') || '-');
      break;
    }
    case 'burner': {
      const per = c.pw.burners ? M.burn / c.pw.burners : 0, load = per / CFG.power.burnerWood;
      row('Makes', `${(load * def.gen).toFixed(1)} of ${def.gen} MW`, 'p');
      bar(load, 'power');
      row('Uses', `${per.toFixed(2)} wood / sec`, per > 0.001 ? 'u' : 'd');
      if (per <= 0.001) note(c.res.wood < 1 && M.need > M.gen ? 'Out of wood: the fire is out' : 'Idle: nothing needs its power right now', c.res.wood < 1 && M.need > M.gen ? 'r' : 'd');
      sep();
      row(`${c.short} power`, `${fmtNum(M.need)} / ${fmtNum(M.max)} MW`);
      if (M.machines) row('· machines', `${fmtNum(M.machines)} MW`);
      if (M.city >= 0.05) row('· cities', `${fmtNum(M.city)} MW`);
      row(`${c.short} wood`, `${fmtNum(c.res.wood)} (${((c.rates || {}).wood || 0) >= 0 ? '+' : ''}${(c.rates.wood || 0).toFixed(2)} / sec)`, (c.rates.wood || 0) < 0 ? 'r' : '');
      break;
    }
    case 'nuclear': {
      const per = c.pw.nukes ? (M.burnU || 0) / c.pw.nukes : 0, load = per / CFG.power.nukeUranium;
      row('Makes', `${(load * def.gen).toFixed(1)} of ${def.gen} MW`, 'p');
      bar(load, 'power');
      row('Uses', `${per.toFixed(3)} uranium / sec`, per > 0.0001 ? 'u' : 'd');
      if (per <= 0.0001) note((c.res.uranium || 0) < 0.05 ? 'Out of uranium: mine some, or ship it in from a country that has it' : 'Idle: nothing needs its power right now', (c.res.uranium || 0) < 0.05 ? 'r' : 'd');
      sep();
      row(`${c.short} power`, `${fmtNum(M.need)} / ${fmtNum(M.max)} MW`);
      if (M.machines) row('· machines', `${fmtNum(M.machines)} MW`);
      if (M.city >= 0.05) row('· cities', `${fmtNum(M.city)} MW`);
      row(`${c.short} uranium`, `${fmtNum(c.res.uranium || 0)} (${((c.rates || {}).uranium || 0) >= 0 ? '+' : ''}${((c.rates || {}).uranium || 0).toFixed(3)} / sec)`, ((c.rates || {}).uranium || 0) < 0 ? 'r' : '');
      break;
    }
    case 'solar': {
      row('Makes', `${def.gen} MW`, 'p');
      row('Uses', 'Nothing', 'd');
      note('Free, from the sun: used before any burner');
      sep();
      row(`${c.short} power`, `${fmtNum(M.need)} / ${fmtNum(M.max)} MW`);
      row(`${c.short} panels`, `${c.pw.solar} · ${fmtNum(c.pw.solar * def.gen)} MW`);
      break;
    }
    case 'station': case 'port': {
      const links = game.links.filter(L => L.a === b.i || L.b === b.i), V = CFG.vehicles[b.type === 'station' ? 'rail' : 'sea'];
      if (!links.length) note(`No route yet: it links to your nearest ${b.type} when one is built ${b.type === 'station' ? `within ${CFG.railMaxLength} tiles of track` : 'across the water'}`, 'r');
      for (const L of links) {
        const other = countryAt(L.a === b.i ? L.b : L.a), here = L.a === b.i ? 0 : L.path.length - 1;
        const toHere = (L.dir > 0 ? L.path.length - 1 : 0) === here, eta = Math.abs((toHere ? here : (here ? 0 : L.path.length - 1)) - L.t) / (L.kind === 'rail' ? CFG.trainSpeed : CFG.shipSpeed);
        row(`Route to ${other ? other.short : '?'}`, `${L.path.length} tiles`);
        row(`· ${L.kind === 'rail' ? 'train' : 'ship'}`, toHere ? `arriving in ${secs(eta)}` : `leaving, there in ${secs(eta)}`);
        row('· carrying', L.cargo ? listRes(L.cargo) || 'nothing' : 'nothing', L.cargo && listRes(L.cargo) ? 'g' : 'd');
      }
      if (b.type === 'port') {                    // its own freighter, free to sail to any of your ports
        const F = game.freight.find(q => q.home === b.i), T = F && countryAt(F.dir > 0 ? F.dest : F.home);
        row('Freighter', !F ? (game.ports.length > 1 ? 'In port: sails wherever goods are needed' : 'In port: needs a second port to sail to')
          : `${F.dir > 0 ? 'out to' : 'coming home from'} ${F.dir > 0 ? (T ? T.short : '?') : (countryAt(F.dest) || { short: '?' }).short}, ${secs(Math.abs((F.dir > 0 ? F.path.length - 1 : 0) - F.t) / CFG.shipSpeed)}`, F ? 'g' : 'd');
        if (F && F.cargo) row('· carrying', listRes(F.cargo, CARGO_RES), 'g');
      }
      const asks = CARGO_RES.filter(r => pressing(c, r));
      if (asks.length) row(`${c.short} is asking for`, asks.map(r => askOf(c, r) >= 1 ? `${Math.ceil(askOf(c, r))} ${r}` : `${r} (building with it)`).join(', '), 'r');
      sep();
      row('Each trip', `${V.cargo} goods · ${V.people} people`);
      note(`${say('Click', 'Tap')} it with a ${b.type === 'station' ? 'truck' : 'boat'} picked in the build menu to send an expedition from here`);
      break;
    }
    case 'mortar': {
      const Wp = CFG.weapons.shell;
      reloadRows(b, ui);
      if (c.res.iron < Wp.cost.iron + CFG.mortarReserve) note(`Holding fire: ${c.short} keeps ${CFG.mortarReserve} iron back`, 'r');
      row('Uses', `${Wp.cost.iron} iron a shell · up to ${(Wp.cost.iron / Wp.reload).toFixed(1)} / sec`, 'u');
      row('Range', `${Wp.range} tiles`); row('Reload', `${Wp.reload}s`);
      row('Shells fired', `${b.shots || 0}`);
      note('Fires by itself at the weapons of nations at war with you');
      break;
    }
    case 'silo': {
      const Wp = CFG.weapons.missile;
      reloadRows(b, ui);
      row('Range', `${Wp.range} tiles`); row('Reload', `${Wp.reload}s${c.sat < 0.999 ? ` (slower: ${Math.round(c.sat * 100)}% power)` : ''}`, c.sat < 0.999 ? 'r' : '');
      row('Uses', `${def.use} MW · ${listRes(Wp.cost, ['wood', 'iron'])} a missile`, c.sat < 0.999 ? 'r' : 'u');
      row('Missiles fired', `${b.shots || 0}`);
      note(say('Press F, then click a target to fire', 'Tap Fire, then tap a target'));
      break;
    }
    case 'turret': {
      const T = CFG.turret, firing = b.fire != null && game.time - b.fire < 0.6;
      row('Status', firing ? 'Firing' : 'Watching', firing ? 'r' : 'g');
      row('Uses', `${firing ? (T.kills * T.iron).toFixed(2) : '0'} iron / sec${firing ? '' : ` (${(T.kills * T.iron).toFixed(2)} firing)`}`, 'u');
      row('Range', `${T.range} tiles`); row('Fire rate', `${T.kills} soldiers / sec`);
      row('Soldiers stopped', `${Math.floor(b.killed || 0)}`);
      break;
    }
    case 'airdef': {
      const A = CFG.airDefense;
      reloadRows(b, ui);
      row('Covers', `${A.range} tiles around it`); row('Reload', `${A.reload}s${c.sat < 0.999 ? ' (slower: short of power)' : ''}`, c.sat < 0.999 ? 'r' : '');
      row('Uses', `${def.use} MW · ${A.cost.iron} iron a shot stopped`, c.sat < 0.999 ? 'r' : 'u');
      row('Shots stopped', `${b.stops || 0}`);
      break;
    }
    case 'drill': {
      if (pipesDirty) buildPipes();
      const pp = pipeOf(b.i), rate = pp && c.fuelFlow ? def.fuel * c.sat : 0;
      row('Makes', `+${rate.toFixed(2)} fuel / sec`, rate > 0 ? 'g' : 'r');
      if (!pp) note(`Waiting: no launch pad in ${c.short} to pipe it to`, 'r');
      else if (!c.fuelFlow) note('Waiting: no rocket being fuelled right now (still being built, ready, or paused)', 'r');
      else note(`Pumping into the rocket on the pad, with ${c.pw.drills - 1 ? `${c.pw.drills - 1} other drill${c.pw.drills > 2 ? 's' : ''}` : 'no other drills'}`, 'g');
      row('Uses', `${def.use} MW`, c.sat < 0.999 ? 'r' : 'u');
      if (pp) row('Pipe to pad', `${Math.round(pp.len)} tile${Math.round(pp.len) === 1 ? '' : 's'}`);
      if (c.sat < 0.999) note(`Short of power: running at ${Math.round(c.sat * 100)}%`, 'r');
      break;
    }
    case 'pad': {
      const R = CFG.rocket, st = rocketState(b), k = b.rocket, drills = c.pw.drills, perDrill = CFG.buildings.drill.fuel;
      const fuel = k ? k.fuel : 0, on = !b.paused;
      row('Rocket', !on ? 'Paused' : { none: 'Waiting for iron', building: 'Fuelling', fuelling: 'Fuelling', ready: 'Fuelled: ready to launch' }[st], st === 'ready' ? 'g' : !on || st === 'none' ? 'r' : '');
      // the main thing: how full the rocket is, and how fast the drills are filling it
      row('Fuelled', `${Math.floor(fuel / R.tank * 100)}% · ${Math.floor(fuel)} / ${R.tank}`, st === 'ready' ? 'g' : 'p');
      bar(fuel / R.tank, st === 'ready' ? '' : 'power');
      if (st === 'fuelling' && on) {
        row('Fuelling at', `+${(b.useFuel || 0).toFixed(2)} fuel / sec`, b.useFuel > 0 ? 'g' : 'r');
        if (b.useFuel > 0) note(`${drills} ice drill${drills > 1 ? 's' : ''} pumping it full · full in ${secs((R.tank - fuel) / b.useFuel)}`, 'g');
        else note(drills ? `${c.short}'s ice drills have no power` : `No ice drills in ${c.short}: build some on polar ice to fuel it`, 'r');
      } else if (st === 'none') note(`Builds one at once when ${c.short} has ${R.iron + R.ironReserve} iron (${R.iron} for the rocket, ${R.ironReserve} kept back): it has ${fmtNum(c.res.iron)}`, 'r');
      else if (st === 'ready') note(b.supply ? 'Loading the supply rocket: it leaves once home has something to send' : `${say('Click', 'Tap')} the pad to launch`, 'g');
      row('Ice drills', `${drills} · up to ${(drills * perDrill).toFixed(1)} fuel / sec`, drills ? '' : 'r');
      note(`Each drill adds ${perDrill} fuel / sec on full power: more drills, faster fuelling`);
      sep();
      row('Each rocket', `${R.iron} iron, built at once`, 'u');
      const mineSt = game.orbitals.filter(q => q.home === c.id);
      if (b.supply && stationByN(b.supply)) {
        row('Supplying', `Space Station ${b.supply}`, 'g');
        note('Each fuelled rocket flies up by itself with people and goods');
        button('Stop: build rockets to fly myself', 'unsupply');
      } else for (const q of mineSt) button(`Supply Space Station ${q.n} with it`, 'supply', true, q.n);
      if (st !== 'ready') note(`${say('Click', 'Tap')} the pad to ${b.paused ? 'resume' : 'pause'} it`);
      break;
    }
    default: if (def.desc) note(def.desc.split('. ')[0] + '.');
  }
  if (b.dmg > 0.01) {
    sep();
    const hp = hpOf(b);
    row('Damage', `${(hp - b.dmg).toFixed(1)} / ${hp} hits left`, 'r');
    bar(1 - b.dmg / hp, 'bad');
    note(`Mends one hit every ${CFG.hp.repairSec}s`);
  }
  return [def.name, b.type, c.full];
}
function cardExpedition(e, { row, bar, note, sep }) {
  const home = liveCountry(e.from), mine = game.driving === e, speed = Math.hypot(e.vx || 0, e.vy || 0);
  row('Status', mine ? 'Driving' : 'Parked', mine ? 'g' : '');
  row('People', `${Math.floor(e.n)}`);
  row('Cargo', listRes(e.kit, ['wood', 'stone', 'iron']) || 'nothing');
  row('Supplies', e.supplies > 0 ? secs(e.supplies) : 'Out: losing a person a second', e.supplies > CFG.drive.supplies * 0.25 ? '' : 'r');
  bar(e.supplies / CFG.drive.supplies, e.supplies > CFG.drive.supplies * 0.25 ? 'gold' : 'bad');
  row('Speed', `${speed.toFixed(1)} tiles / sec`);
  sep();
  note(mine ? say('Space settles here · Esc lets go of the wheel', 'Tap Settle to found a colony here') : say('Press X to take the wheel', 'Tap Drive to take the wheel'));
  return [e.kind === 'boat' ? 'Boat' : 'Truck', e.kind === 'boat' ? 'boat' : 'truck', home ? `From ${home.short}` : 'Expedition'];
}
function cardFreighter(F, { row, note, sep }) {
  const home = countryAt(F.home), there = countryAt(F.dest), end = F.dir > 0 ? F.path.length - 1 : 0;
  row('Heading to', F.dir > 0 ? (there ? there.short : '?') : `${home ? home.short : '?'} (home)`);
  row('Arrives in', secs(Math.abs(end - F.t) / CFG.shipSpeed));
  row('Carrying', F.cargo ? listRes(F.cargo, CARGO_RES) || 'nothing' : 'nothing', F.cargo ? 'g' : 'd');
  const T = F.dir > 0 ? there : home;
  if (T) { const asks = CARGO_RES.filter(r => pressing(T, r)); if (asks.length) row(`${T.short} needs`, asks.join(', '), 'r'); }
  sep();
  row('Route', `${F.path.length} tiles`);
  row('Each trip', `up to ${CFG.freight.cargo} goods`);
  note('Sails from its port to whichever of your countries needs goods most, then brings home what home is short of');
  return ['Freighter', 'ship', `${home ? home.short : '?'} → ${there ? there.short : '?'}`];
}
function cardLink(L, ui) {
  if (L.freight) return cardFreighter(L, ui);
  const { row, note, sep } = ui;
  const A = countryAt(L.a), B = countryAt(L.b), to = L.dir > 0 ? B : A, end = L.dir > 0 ? L.path.length - 1 : 0;
  const speed = L.kind === 'rail' ? CFG.trainSpeed : CFG.shipSpeed, V = CFG.vehicles[L.kind];
  row('Heading to', to ? to.short : '?');
  row('Arrives in', secs(Math.abs(end - L.t) / speed));
  row('Carrying', L.cargo ? listRes(L.cargo) || 'nothing' : 'nothing', L.cargo && listRes(L.cargo) ? 'g' : 'd');
  sep();
  row('Route', `${L.path.length} tiles`);
  row('Speed', `${speed} tiles / sec`);
  row('Round trip', secs(2 * (L.path.length - 1) / speed));
  row('Each trip', `${V.cargo} goods · ${V.people} people`);
  note('Loads what the countries down the line are short of, people included');
  return [L.kind === 'rail' ? 'Train' : 'Cargo ship', L.kind === 'rail' ? 'engine' : 'ship', `${A ? A.short : '?'} ⇄ ${B ? B.short : '?'}`];
}
function cardBridge(br, { row, note }) {
  const n = br.len, on = new Set(br.tiles);
  const A = countryAt(br.s), Z = countryAt(br.b), rails = game.links.filter(L => L.kind === 'rail' && L.path.some(t => on.has(t))).length;
  row('Over the water', `${n} tiles`);
  row('Built for', `${fmtNum(bridgeCost(n).stone)} stone`);
  row('Joins', A && Z && A !== Z ? `${A.short} and ${Z.short}` : A ? `${A.short}, both shores` : '-');
  row('Rail lines on it', `${rails}`);
  note('Trucks drive over it; rail follows it');
  return ['Bridge', 'bridge', A ? A.full : 'Bridge'];
}

// pointing at a settlement (with nothing else selected) shows the land it reaches
function drawReachHover(z) {
  if (game.tool || game.aiming || blueprint || !mouse.in || pointingAtBody()) return;
  const t = hoverTile();
  if (t && building[t.i] === BLD_CODE.settlement) { /* drawSettlementHover rings its zone */ }
  else if (t && building[t.i] && HARVESTS[buildingAt(t.i).type]) reachRing(t.i, '#f2c14e', z, [5, 5], CFG.collectorReach);
  else if (t && building[t.i] === BLD_CODE.mortar) reachRing(t.i, aiOf[t.i] ? 'rgba(255,122,107,0.9)' : '#f2c14e', z, [4, 5], CFG.weapons.shell.range);
  else if (t && building[t.i] === BLD_CODE.turret) reachRing(t.i, aiOf[t.i] ? 'rgba(255,122,107,0.9)' : '#f2c14e', z, [4, 5], CFG.turret.range);
  else if (t && building[t.i] === BLD_CODE.airdef) reachRing(t.i, aiOf[t.i] ? 'rgba(120,200,255,0.9)' : '#f2c14e', z, [6, 5], CFG.airDefense.range);
}

// a vehicle you drive: the trail it has left, where it would settle, the vehicle itself, and its supplies
function drawVehicle(e, z) {
  const mine = game.driving === e, [sx, sy] = toScreen(...shownPos(e));
  if (e.trail.length > 1) {
    ctx.beginPath();
    e.trail.forEach((p, k) => { const [x, y] = toScreen(p[0], p[1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo(sx, sy);
    ctx.setLineDash([2, 8]); ctx.lineCap = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(242,193,78,0.75)'; ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = 'butt';
  }
  if (mine) {                                      // the land a settlement here would start with
    const site = settleSite(e);
    if (site) {
      const [cx, cy] = toScreen(...tileCenter(site.i)), ok = site.how === 'found';
      ctx.beginPath(); ctx.arc(cx, cy, (CFG.outpostRadius + 0.5) * z, 0, Math.PI * 2);
      ctx.fillStyle = ok ? 'rgba(123,211,137,0.14)' : 'rgba(47,125,225,0.14)'; ctx.fill();
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.8; ctx.strokeStyle = ok ? '#7bd389' : OWN_HEX; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  const size = clamp(z * 2.6, 26, 60), spr = e.kind === 'boat' ? SPR.boat : SPR.truck, left = Math.cos(e.a) < 0;
  ctx.save();
  ctx.translate(sx, sy);
  if (mine) dashRing(0, 0, size * 0.62, '#f2c14e', { width: 2.4, march: 6 });
  // a small arrow for the heading, then the vehicle (a truck turns with it; a boat just faces left or right)
  ctx.save(); ctx.rotate(e.a);
  ctx.beginPath(); ctx.moveTo(size * 0.82, 0); ctx.lineTo(size * 0.62, -size * 0.13); ctx.lineTo(size * 0.62, size * 0.13); ctx.closePath();
  ctx.fillStyle = '#f2c14e'; ctx.fill();
  ctx.restore();
  if (e.kind === 'truck') { ctx.rotate(e.a); if (left) ctx.scale(1, -1); } else if (left) ctx.scale(-1, 1);
  if (spr.complete) ctx.drawImage(spr, -size / 2, -size / 2, size, size);
  ctx.restore();
  // supplies bar and what's on board
  const S = clamp(e.supplies / CFG.drive.supplies, 0, 1), bw = 64, by = sy + size * 0.62 + 6;
  ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fillRect(sx - bw / 2 - 2, by - 2, bw + 4, 9);
  ctx.fillStyle = S > 0.25 ? '#f2c14e' : '#ff7a6b'; ctx.fillRect(sx - bw / 2, by, bw * S, 5);
  const load = Object.entries(e.kit).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(' · ');
  pill(sx, by + 20, e.supplies > 0 ? `${Math.floor(e.n)} people${load ? ' · ' + load : ''} · supplies ${Math.ceil(e.supplies)}s`
    : `${Math.floor(e.n)} people · out of supplies!`, { dot: e.supplies > 0 ? '#f2c14e' : '#ff7a6b', fg: e.supplies > 0 ? '#eef2f8' : '#ff7a6b', size: 11 });
  if (mine) pill(sx, by + 42, say('Arrows / WASD drive · Space settle here · Esc let go', 'Steer with the pad · Settle here · Park'), { size: 11, fg: '#aab4c4' });
  else pill(sx, by + 42, 'Parked · X to drive', { size: 11, fg: '#aab4c4' });
}

function drawSelection(z) {
  // buildings picked for copying: the same dashed ring round each
  if (game.selection.length) {
    const r = Math.max(z * 0.72, 5);
    for (const i of game.selection) { const [sx, sy] = toScreen(...tileCenter(i)); dashRing(sx, sy, r, '#f2c14e', { width: z < 8 ? 1.5 : 2, march: 6 }); }
  }
  // paste preview following the cursor
  if (blueprint && mouse.in && !mouse.dragged && !game.tool) {
    const t = hoverTile();
    if (t) {
      for (const o of pastePlan(t.x, t.y).tiles) {
        if (!inb(o.x, o.y)) continue;
        const [sx, sy] = toScreen(o.x, o.y);
        ctx.fillStyle = o.ok ? 'rgba(123,211,137,0.32)' : 'rgba(255,122,107,0.32)';
        ctx.fillRect(sx, sy, z, z);
        if (z >= CFG.cityZoom) drawSprite(o.type, o.x + 0.5, o.y + 0.5, z * 1.25, 0.55);
      }
    }
  }
  // the box being dragged
  if (mouse.selecting) {
    const x = Math.min(mouse.sx, mouse.x), y = Math.min(mouse.sy, mouse.y);
    const w = Math.abs(mouse.x - mouse.sx), h = Math.abs(mouse.y - mouse.sy);
    ctx.fillStyle = 'rgba(242,193,78,0.12)'; ctx.fillRect(x, y, w, h);
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
  }
}

// country names written across their territory when you're zoomed out (hidden up close, where you see the details)
// Outlined text, drawn once into a small image and reused while the words, size and colour stay the same.
// Outlined, letter-spaced text is one of the slowest things a canvas draws; stamping an image is cheap.
const TEXT_IMG = new Map();
function textImage(text, weight, size, spacing, lw, color) {
  size = Math.round(size * 2) / 2;                   // half-pixel steps, so zooming doesn't make a new image every frame
  const key = textKey(text, weight, size, spacing, lw, color);
  let im = TEXT_IMG.get(key);
  if (im) return im;
  if (TEXT_IMG.size > 400) TEXT_IMG.clear();        // the population numbers keep changing: forget old ones now and then
  const font = `${weight} ${size}px 'Segoe UI', Inter, Arial, sans-serif`;
  ctx.save(); ctx.font = font; ctx.letterSpacing = `${spacing}px`;
  const w = Math.ceil(ctx.measureText(text).width + spacing + lw * 2 + 4), h = Math.ceil(size * 1.5 + lw * 2);
  ctx.restore();
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.font = font; g.letterSpacing = `${spacing}px`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = lw; g.strokeStyle = 'rgba(10,14,24,0.75)'; g.strokeText(text, w / 2, h / 2);
  g.fillStyle = color; g.fillText(text, w / 2, h / 2);
  im = { c, w, h };
  TEXT_IMG.set(key, im);
  return im;
}
const POP_SHOWN = new WeakMap();                    // country/nation -> the population text on its label right now
const stampText = (im, x, y) => ctx.drawImage(im.c, x - im.w / 2, y - im.h / 2, im.w, im.h);

// A label's size follows the zoom, and a new image for every label at every step of a zoom was most of a zooming
// frame's work. So labels come in a ladder of sizes 10% apart, and each is drawn at the rung nearest its size,
// stretched or shrunk the last few percent: zooming reuses the same few images. (spacing: letter spacing per px of size)
// While the zoom is still moving, a label takes an image already made at a nearby rung if there is one (up to four
// rungs off): mid-zoom it makes no new images at all, only once the zoom has stopped somewhere new.
const textKey = (text, weight, size, spacing, lw, color) => `${text}|${weight}|${Math.round(size * 2) / 2}|${spacing}|${lw}|${color}|${dpr}`;
let labelZ = 0, labelZAt = 0;
function stampLabel(text, weight, size, spacing, lw, color, x, y) {
  const rung = Math.round(Math.log(size / 10) / Math.log(1.1));
  let q = 10 * 1.1 ** rung;
  if (performance.now() - labelZAt < 200) for (const d of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const qq = 10 * 1.1 ** (rung + d);
    if (TEXT_IMG.has(textKey(text, weight, qq, Math.round(qq * spacing), lw, color))) { q = qq; break; }
  }
  const im = textImage(text, weight, q, Math.round(q * spacing), lw, color), k = size / q;
  ctx.drawImage(im.c, x - im.w * k / 2, y - im.h * k / 2, im.w * k, im.h * k);
}
function drawCountryLabels(z) {
  if (z !== labelZ) { labelZ = z; labelZAt = performance.now(); }
  if (z < 0.15) return;
  const under = (who, people, sx, sy, size, color) => {   // the population, in smaller type under the name
    // the number changes nearly every tick: show a new one twice a second, so its image isn't redrawn 20 times a second
    const now = performance.now(), shown = POP_SHOWN.get(who);
    let txt = shown ? shown.txt : null;
    if (!shown || (now - shown.at > 500 && shown.n !== Math.floor(people))) {
      txt = `${fmtNum(people)} people`; POP_SHOWN.set(who, { txt, n: Math.floor(people), at: now });
    }
    const s2 = Math.max(10, size * 0.6);
    stampLabel(txt, 700, s2, 0, 3, color, sx, sy + size * 0.55 + s2 * 0.7);
  };
  for (const c of game.countries) {
    if (!c.alive || !c.tiles) continue;
    const span = Math.sqrt(c.tiles) * z;           // rough on-screen size of the country
    if (span < 18) continue;
    const [sx, sy0] = toScreen(c.lx, c.ly);
    const size = clamp(span * 0.16, 11, 26);
    const sy = sy0 + (z < CFG.detailZoom ? 14 + size * 0.6 : z * 3.2);   // sit below the settlement at the centre
    const text = (span > 140 ? c.full : c.short).toUpperCase();
    stampLabel(text, 800, size, 0.12, 4, c.id === game.active ? '#ffffff' : 'rgba(214,228,255,0.88)', sx, sy);
    under(c, c.people, sx, sy, size, '#f2c14e');
  }
  for (const n of game.nations) {
    if (!n.alive) continue;
    const span = Math.sqrt(n.tiles) * z;
    if (span < 18) continue;
    const [sx, sy0] = toScreen(n.lx, n.ly);
    const size = clamp(span * 0.14, 10, 22);
    const sy = sy0 + (z < CFG.cityZoom ? 14 + size * 0.6 : 0);
    const text = (span > 160 ? n.full : n.short).toUpperCase();
    const [r, g, b] = n.col;
    stampLabel(text, 800, size, 0.12, 4, `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`, sx, sy);
    under(n, n.people, sx, sy, size, 'rgba(255,255,255,0.85)');
  }
}

function nearestFrontier(tx, ty) {
  let best = null, bd = Infinity;
  for (const i of frontier) {
    const d = (i % W - tx) ** 2 + (((i / W) | 0) - ty) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best == null ? [tx, ty] : [best % W + 0.5, ((best / W) | 0) + 0.5];
}

// ======================================================================
// input
// ======================================================================
// left-drag = select box · right/middle-drag = pan · plain clicks = actions
const mouse = { x: 0, y: 0, down: -1, sx: 0, sy: 0, dragged: false, selecting: false, camX: 0, camY: 0, in: false };

function hoverTile() {
  const [wx, wy] = toWorld(mouse.x, mouse.y);
  const x = Math.floor(wx), y = Math.floor(wy);
  return inb(x, y) ? { x, y, i: idx(x, y) } : null;
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (performance.now() - lastTouch < 800) return;   // the browser's copy of a tap: the touch code has it
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true;
  mouse.down = e.button; mouse.sx = e.clientX; mouse.sy = e.clientY; cam.anim = null;
  mouse.dragged = false; mouse.selecting = false; mouse.camX = cam.x; mouse.camY = cam.y;
  mouse.offX = cam.offX; mouse.offY = cam.offY;
  if (e.button === 1) e.preventDefault();   // no browser autoscroll on middle-drag
});
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (mouse.down < 0) return;
  const dx = e.clientX - mouse.sx, dy = e.clientY - mouse.sy;
  if (!mouse.dragged && Math.hypot(dx, dy) > 5) {
    mouse.dragged = true;
    if (mouse.down === 0) mouse.selecting = true;
    else canvas.classList.add('dragging');
  }
  if (mouse.dragged && !mouse.selecting) {
    if (cam.follow) { cam.offX = mouse.offX - dx / cam.zoom; cam.offY = mouse.offY - dy / cam.zoom; }
    else { if (camRide && !game.flying) camRide = null; cam.x = mouse.camX - dx / cam.zoom; cam.y = mouse.camY - dy / cam.zoom; clampCam(); }
  }
});
window.addEventListener('mouseup', e => {
  const wasDrag = mouse.dragged, wasSel = mouse.selecting, btn = mouse.down;
  mouse.down = -1; mouse.dragged = false; mouse.selecting = false; canvas.classList.remove('dragging');
  if (btn < 0) return;
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (wasSel) { finishSelection(mouse.sx, mouse.sy, e.clientX, e.clientY); return; }
  if (wasDrag || e.target !== canvas) return;
  clickAt(btn, e.clientX, e.clientY);
});
// a click (or a tap: btn 0; a long press: btn 2) at a screen point
function clickAt(btn, x, y) {
  mouse.x = x; mouse.y = y;
  // a plain click on any body (or your world from far out) locks onto it
  if (btn === 0 && game.aiming) { const t = hoverTile(); if (t) fireMissile(t.x, t.y); return; }
  if (btn === 2 && game.aiming) { setAiming(false); return; }
  if (camRide && !game.flying && pickAt(x, y) !== camRide.o) camRide = null;   // a click anywhere else lets go of a station
  if (btn === 0 && !game.tool) {
    const fl = pickAt(x, y);
    if (kindOf(fl) === 'orbital') {
      if (camRide && camRide.o === fl) return;
      inspect(fl); rideWith(fl);
      toast(say(`Following Space Station ${fl.n}: click anywhere else, pan, or press Esc to let go`, `Following Space Station ${fl.n}: tap anywhere else or pan to let go`));
      return;
    }
    if (kindOf(fl) === 'flight') { if (game.flying !== fl) { takeRocket(fl); toast(`Flying rocket ${fl.n}. Space: engine on / off · E / Q: throttle · A / D: turn`); } return; }
    const [wx, wy] = toWorld(x, y);
    const body = bodyUnder(wx, wy);
    if (body && cam.follow !== body.id) { followBody(body.id); return; }
    if (!body && worldLockable() && overWorld(wx, wy)) { lockWorld(); return; }
  }
  const t = hoverTile();
  let pb = null;
  if (!t) return;
  if (game.over) return toast(`Your last country has fallen. ${say('Press N', 'Tap New map in the Build menu')} to start a new map.`);
  if (btn === 0) {
    if (game.tool === 'bridge') bridgeClick(t.i);
    else if (game.tool) tryBuild(t.i, game.tool);
    else if (blueprint) clearSelection();          // with a selection, a click just deselects
    else if ((pb = pickAt(x, y)) && mineOf(pb)) {   // anything of yours: open its card
      inspect(pb);
      if (kindOf(pb) === 'building') {             // a building: view its country too
        const c = countryAt(pb.i);
        if (pb.type === 'pad' && cam.zoom >= CFG.cityZoom) padClick(pb);
        if (c && cam.zoom < CFG.cityZoom) flyToCountry(c);
        else if (c) game.active = c.id;
      }
    }
    else if (owner[t.i]) {                         // clicking inside one of your countries selects it
      inspect(null);
      const c = countryAt(t.i);
      if (c && cam.zoom < CFG.cityZoom) flyToCountry(c);
      else if (c && c.id !== game.active) { game.active = c.id; toast(`Viewing ${c.full}`); }
    } else startPush(t.x, t.y);
  } else if (btn === 2) {
    if (game.tool === 'bridge' && game.bridgeStart != null) game.bridgeStart = null;   // pick another start
    else if (game.tool) setTool(null);
    else if (blueprint) clearSelection();
    else if (!owner[t.i]) toast('Expeditions now leave from a station or port: pick a truck or boat in the build menu (Vehicles), then click one.');
  }
}
canvas.addEventListener('mouseenter', () => { mouse.in = true; });
canvas.addEventListener('mouseleave', () => { mouse.in = false; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.anim = null;
  // the wheel sets where the zoom is going; stepZoom glides there over a few frames
  const from = zoomGoal && zoomGoal.last === cam.zoom ? zoomGoal.z : cam.zoom;
  zoomGoal = { z: clamp(from * Math.exp(-e.deltaY * 0.0022), CFG.zoomMin, CFG.zoomMax), sx: e.clientX, sy: e.clientY, last: cam.zoom };
}, { passive: false });
let zoomGoal = null;
function stepZoom(dt) {
  const g = zoomGoal;
  if (!g) return;
  if (g.last !== cam.zoom || cam.anim) { zoomGoal = null; return; }   // something else moved the zoom: it wins
  const [bx, by] = toWorld(g.sx, g.sy);
  const k = 1 - Math.exp(-dt * 16);                // about 90% of the way in 0.15 s
  const near = Math.abs(Math.log(g.z / cam.zoom)) < 0.002;
  cam.zoom = near ? g.z : cam.zoom * Math.pow(g.z / cam.zoom, k);
  const [ax, ay] = toWorld(g.sx, g.sy);
  nudgeCam(bx - ax, by - ay);
  if (near) zoomGoal = null; else g.last = cam.zoom;
}

// double-click a body to lock onto it; double-click empty space to let go
canvas.addEventListener('dblclick', e => {
  if (performance.now() - lastTouch < 800) return;
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  const body = bodyUnder(wx, wy);
  if (body) followBody(body.id);
  else if (worldLockable() && overWorld(wx, wy)) lockWorld();
  else if (cam.follow) { stopFollow(); toast('Let go'); }
});

const keys = new Set();
window.addEventListener('keydown', e => {
  // Ctrl / Alt / Cmd combinations belong to the browser (Ctrl+R reloads, Ctrl+C copies): never let them
  // paste a blueprint, aim a missile or lock onto a planet on the way
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  keys.add(e.key.toLowerCase());
  const k = e.key.toLowerCase();
  const slot = SLOT_KEYS.indexOf(k);
  if (slot >= 0 && !e.repeat) {
    if (menuOpen && menuHover) pinToBar(menuHover, slot);          // in the E menu: put the hovered building on that key
    else if (game.hotbar[slot]) setTool(game.tool === game.hotbar[slot] ? null : game.hotbar[slot]);
  }
  if (k === 'escape') cancelAll();
  if (k === ' ' && game.driving) { e.preventDefault(); if (!e.repeat) settleExpedition(game.driving); }
  if (k === 'x' && !e.repeat) nextVehicle();
  if (k.startsWith('arrow') && (game.driving || game.flying)) e.preventDefault();
  if (k === ' ' && game.flying) { e.preventDefault(); if (!e.repeat) toggleEngine(game.flying); }
  if (k === 'enter' && game.flying && !e.repeat) makeStation(game.flying);
  if (k === 'f' && !e.repeat) setAiming(!game.aiming);
  if (k === 'e' && !e.repeat && !game.flying) toggleBuildMenu();   // flying, E is throttle up
  if (k === 't' && !e.repeat) toggleTechTree();
  if (k === 'c' && !e.repeat) {
    const t = mouse.in ? hoverTile() : null;
    if (t) pasteAt(t.x, t.y);
  }
  if (k === '[' || k === ']') {
    const opts = [10, 25, 50, 100];
    const j = clamp(opts.indexOf(game.sendPct) + (k === ']' ? 1 : -1), 0, opts.length - 1);
    setPct(opts[j]);
  }
  if (k === 'm') toggleMapView();
  // lock-on keys: L Moon, V Vulcan, R Aries, Z Zeus, P Poseidon, U Sun (press again to let go)
  if (!e.repeat) for (const en of LOCKABLE) {
    if (en.key !== k) continue;
    if (cam.follow === en.id) { stopFollow(); toast(`Let go of ${en.name}`); } else followBody(en.id);
  }
  if (k === 'h') goHome();
  if (k === 'tab') { e.preventDefault(); nextCountry(e.shiftKey ? -1 : 1); }
  if ('wasd'.includes(k) || k.startsWith('arrow')) cam.anim = null;
  if (k === 'backspace' && !e.repeat) { e.preventDefault(); goToLastAlert(); }
  if (k === 'n' && !e.repeat) {
    keys.clear();                                  // the dialog swallows the key-up
    if (confirm('Start a new map? This deletes your saved game.')) newGame();
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
// a key held while the window loses focus never sends its key-up: forget held keys, or the camera
// (or the truck you drive) keeps going on its own when you come back
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

// Esc: let go of whatever you're doing
function cancelAll() {
  if (game.flying && !game.tool && !menuOpen && !game.aiming) {
    game.flying.engine = false; game.flying = null;
    toast('Let go of the rocket: engine off, it keeps flying. Press X to take it again.');
  }
  if (game.driving && !game.tool && !menuOpen && !game.aiming) { game.driving = null; toast(say('Parked. Press X to take the wheel again.', 'Parked. Tap Drive to take the wheel again.')); }
  setTool(null); clearSelection(); stopFollow(); setAiming(false); if (menuOpen) toggleBuildMenu(false); if (techOpen) toggleTechTree(false);
  inspect(null); camRide = null;
  if (logOpen) toggleLog(false);
}
// home: fly back to where you started; from a map or orbit view, come back down to the land too
function goHome() {
  game.driving = null; stopFollow(); camRide = null;
  if (mapStage) { savedView = null; mapStage = 0; }
  flyCam(spawn.x + 0.5, spawn.y + 0.5, cam.zoom < CFG.cityZoom ? CFG.startZoom * 0.7 : cam.zoom);
}
function nextCountry(dir) {
  const alive = game.countries.filter(c => c.alive && c.tiles);
  if (!alive.length) return;
  const j = alive.indexOf(activeCountry());
  flyToCountry(alive[(j + (dir < 0 ? alive.length - 1 : 1)) % alive.length]);
}

// ---------- touch: one finger pans, two pinch-zoom, a tap is a click, a long press a right-click ----------
// Building and firing take two taps: the first shows the preview (reach, cost, range), a second tap on
// the same spot builds or fires. Box select and copy-paste stay mouse-only.
let lastTouch = -1e9;
const fingers = new Map();                         // finger id -> its last position
const tch = { drag: false, long: false, sx: 0, sy: 0, timer: 0, pending: null, hints: 0 };
function fingerMid() { const [a, b] = [...fingers.values()]; return [(a.x + b.x) / 2, (a.y + b.y) / 2, Math.hypot(a.x - b.x, a.y - b.y)]; }
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  e.preventDefault(); lastTouch = performance.now();
  canvas.setPointerCapture(e.pointerId);
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cam.anim = null;
  clearTimeout(tch.timer);
  if (fingers.size === 1) {
    tch.drag = false; tch.long = false; tch.sx = e.clientX; tch.sy = e.clientY;
    tch.timer = setTimeout(() => {               // held still: a right-click (put the tool down)
      if (fingers.size !== 1 || tch.drag) return;
      tch.long = true; tch.pending = null;
      if (navigator.vibrate) navigator.vibrate(12);
      clickAt(2, tch.sx, tch.sy);
    }, 500);
  } else tch.drag = true;                          // a second finger: a pinch, never a tap
});
canvas.addEventListener('pointermove', e => {
  const f = e.pointerType !== 'mouse' && fingers.get(e.pointerId);
  if (!f) return;
  lastTouch = performance.now();
  if (fingers.size >= 2) {
    const [mx0, my0, d0] = fingerMid();
    f.x = e.clientX; f.y = e.clientY;
    const [mx1, my1, d1] = fingerMid();
    const [bx, by] = toWorld(mx1, my1);
    if (d0 > 0) cam.zoom = clamp(cam.zoom * d1 / d0, CFG.zoomMin, CFG.zoomMax);
    const [ax, ay] = toWorld(mx1, my1);
    nudgeCam(bx - ax, by - ay);
    nudgeScreen(-(mx1 - mx0) / cam.zoom, -(my1 - my0) / cam.zoom);
    return;
  }
  if (!tch.drag && Math.hypot(e.clientX - tch.sx, e.clientY - tch.sy) > 10) { tch.drag = true; clearTimeout(tch.timer); }
  if (tch.drag && !tch.long) { if (camRide && !game.flying && fingers.size < 2) camRide = null; nudgeScreen(-(e.clientX - f.x) / cam.zoom, -(e.clientY - f.y) / cam.zoom); }
  f.x = e.clientX; f.y = e.clientY;
});
function liftFinger(e, cancelled) {
  if (e.pointerType === 'mouse' || !fingers.delete(e.pointerId)) return;
  lastTouch = performance.now();
  clearTimeout(tch.timer);
  if (fingers.size || cancelled || tch.drag || tch.long) return;
  touchTap(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', e => liftFinger(e, false));
canvas.addEventListener('pointercancel', e => liftFinger(e, true));
function touchTap(x, y) {
  const [wx, wy] = toWorld(x, y), tx = Math.floor(wx), ty = Math.floor(wy);
  if ((game.tool || game.aiming) && inb(tx, ty)) {
    const p = tch.pending;
    if (!p || p.tool !== (game.tool || 'aim') || Math.hypot(tx - p.x, ty - p.y) > Math.max(1, 28 / cam.zoom)) {
      tch.pending = { x: tx, y: ty, tool: game.tool || 'aim' };
      mouse.x = x; mouse.y = y; mouse.in = true;    // the preview sits where you tapped
      if (tch.hints++ < 3) toast(game.aiming ? 'Tap again to fire here' : 'Tap again to build here · long-press to put it down');
      return;
    }
    [x, y] = toScreen(p.x + 0.5, p.y + 0.5);       // the second tap acts on the spot you previewed
    tch.pending = null;
    clickAt(0, x, y);
    mouse.in = !!(game.tool || game.aiming);
    return;
  }
  tch.pending = null;
  clickAt(0, x, y);
  mouse.in = !!(game.tool || game.aiming);
}

// on-screen buttons for touch screens: the keys, and a steering pad while you drive
function bindTouchButtons() {
  $('tbar').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'build') toggleBuildMenu();
    else if (act === 'fire') setAiming(!game.aiming);
    else if (act === 'next') nextCountry(1);
    else if (act === 'map') toggleMapView();
    else if (act === 'home') goHome();
    else if (act === 'drive') nextVehicle();
    else if (act === 'cancel') cancelAll();
    else if (act === 'log') toggleLog();
    else if (act === 'tech') toggleTechTree();
  });
  $('logbtn').addEventListener('click', () => toggleLog());
  $('buildbtn').addEventListener('click', () => toggleBuildMenu());
  $('techbtn').addEventListener('click', () => toggleTechTree());
  document.querySelector('#techtree .tt-x').addEventListener('click', () => toggleTechTree(false));
  for (const b of document.querySelectorAll('#dpad [data-key]')) {
    const k = b.dataset.key, up = () => { keys.delete(k); b.classList.remove('on'); };
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys.add(k); b.classList.add('on'); });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  }
  $('dp-settle').addEventListener('click', () => { if (game.flying) toggleEngine(game.flying); else if (game.driving) settleExpedition(game.driving); });
  $('dp-park').addEventListener('click', () => cancelAll());
  $('bm-new').addEventListener('click', () => { if (confirm('Start a new map? This deletes your saved game.')) newGame(); });
}
// which buttons make sense right now
let barH = { bottom: -1, top: -1 };
function updateTouchButtons() {
  // Runs 10 times a second. Read the bar heights first, while the layout is still clean, and only write
  // what changed: a write followed by a read (or any change to a style on <body>) makes the browser redo
  // the layout and styles of the whole page.
  const bottomH = $('bottom').offsetHeight, topH = $('topbar').offsetHeight;
  if (bottomH !== barH.bottom) { barH.bottom = bottomH; document.body.style.setProperty('--bottom-h', bottomH + 'px'); }
  if (topH !== barH.top) { barH.top = topH; document.body.style.setProperty('--top-h', topH + 'px'); }
  const show = (id, on) => { const el = document.querySelector(`#tbar [data-act="${id}"]`); if (el && el.hidden !== !on) el.hidden = !on; };
  const anyOut = game.expeditions.some(e => !e.auto && !e.done) || game.flights.some(f => !f.done);
  show('fire', game.aiming || silosOf().length > 0);
  show('drive', anyOut && !game.driving && !game.flying);
  show('cancel', !!(game.tool || game.aiming || blueprint || cam.follow || menuOpen));
  show('next', game.countries.filter(c => c.alive && c.tiles).length > 1);
  document.querySelector('#tbar [data-act="fire"]').classList.toggle('on', !!game.aiming);
  document.querySelector('#tbar [data-act="build"]').classList.toggle('on', menuOpen);
  $('dpad').classList.toggle('show', !!(game.driving || game.flying) && !menuOpen);
  const fly = !!game.flying, mid = fly ? [game.flying.engine ? 'Engine off' : 'Engine on', 'Let go'] : ['Settle', 'Park'];   // same pad, rocket words
  if ($('dp-settle').textContent !== mid[0]) { $('dp-settle').textContent = mid[0]; $('dp-park').textContent = mid[1]; }
  if (!game.driving && !game.flying) for (const k of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']) keys.delete(k);
}

function clampCam() {
  // you can pan out as far as the edge of the solar system
  const reach = SUN.dist + BODY.seedworld.orbit + BODY.seedworld.r * 6;
  cam.x = clamp(cam.x, DISK.cx - reach, DISK.cx + reach);
  cam.y = clamp(cam.y, DISK.cy - reach, DISK.cy + reach);
}
// M cycles: your view -> whole disk -> moon's orbit -> whole solar system -> back to your view
let mapStage = 0;
const orbitZoom = () => clamp(Math.min(cw, ch - 200) / (2 * (MOON.orbitR + MOON.r)) * 0.96, CFG.zoomMin, CFG.zoomMax);
const systemZoom = () => clamp(Math.min(cw, ch - 200) / (2 * (BODY.seedworld.orbit + BODY.seedworld.r * 2.5)) * 0.96, CFG.zoomMin, CFG.zoomMax);
function toggleMapView() {
  if (!game.flying) camRide = null;                // zooming out to the map lets go of a station
  game.driving = null;
  stopFollow();
  if (mapStage === 0) {
    savedView = { ...cam, anim: null }; mapStage = 1;
    const z = fitZoom(); flyCam(DISK.cx, DISK.cy + 36 / z, z);
  } else if (mapStage === 1) {
    mapStage = 2;
    const z = orbitZoom(); flyCam(DISK.cx, DISK.cy + 36 / z, z);
  } else if (mapStage === 2) {
    cam.anim = null;
    followBody('sun', { zoom: systemZoom(), quiet: true, keepView: true });   // the whole system, centred on the sun
    mapStage = 3;
  } else {
    if (savedView) {                               // glide back down to where you were
      const { x, y, zoom } = savedView;
      Object.assign(cam, savedView, { x: cam.x, y: cam.y, zoom: cam.zoom });
      flyCam(x, y, zoom);
    }
    savedView = null; mapStage = 0;
  }
}
// The camera can ride along with something moving (the rocket you fly, a space station you clicked): locked onto
// where it's drawn, so it holds still in the middle of the view the way a planet does when you lock onto it.
// `ox, oy` is the gap when the ride starts; it closes smoothly instead of jumping.
let camRide = null;
const rideOn = o => o === game.flying || (kindOf(o) === 'orbital' && game.orbitals.includes(o));
function rideWith(o) {
  const [x, y] = ridePos(o);
  camRide = { o, ox: cam.x - x, oy: cam.y - y };
}
const ridePos = o => kindOf(o) === 'orbital' ? shownOrbit(o) : shownFlight(o);
function panKeys(dt) {
  if (game.flying && !cam.follow && (!camRide || camRide.o !== game.flying)) rideWith(game.flying);
  if (camRide && !cam.follow) {
    if (!rideOn(camRide.o)) camRide = null;
    else {
      const k = Math.exp(-dt * 5), [x, y] = ridePos(camRide.o);
      camRide.ox *= k; camRide.oy *= k;
      cam.x = x + camRide.ox; cam.y = y + camRide.oy;
      if (game.flying) return;                     // flying: the keys fly
      if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].some(q => keys.has(q))) camRide = null;   // panning lets go
      else return;
    }
  }
  if (game.driving) {                              // at the wheel: the keys drive, and the camera rides along
    const e = game.driving, k = Math.min(1, dt * 7), [ex, ey] = shownPos(e);
    cam.x += (ex - cam.x) * k; cam.y += (ey - cam.y) * k;
    return;
  }
  const s = 600 / cam.zoom * dt;
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= s;
  if (keys.has('arrowright') || keys.has('d')) dx += s;
  if (keys.has('arrowup') || keys.has('w')) dy -= s;
  if (keys.has('arrowdown') || keys.has('s')) dy += s;
  if (dx || dy) nudgeScreen(dx, dy);
}

// ---------- camera follow (lock onto a body) ----------
// Locking onto a body puts the camera in that body's reference frame. For moons and rocky
// planets the camera moves AND turns with it, so the body holds perfectly still on screen (a
// tidally locked moon's planet then hangs in one spot in its sky). For the sun and the gas
// giants the camera just rides along, so you can watch things orbit around them.
function followBody(id, { zoom, quiet, keepView } = {}) {
  const e = LOCK[id];
  game.driving = null;
  cam.follow = id;
  setCamRot(0);
  cam.a0 = e.frame === 'rotating' ? e.pos()[2] : 0;     // the body's spin angle at the moment you lock on
  cam.zoom = clamp(zoom || (e.zoom ? e.zoom() : Math.min(cw, ch - 200) / (e.r() * 2.4)), CFG.zoomMin, CFG.zoomMax);
  cam.offX = 0; cam.offY = 30 / cam.zoom;              // nudge it up a little, clear of the bottom panels
  if (!keepView) { savedView = null; mapStage = 0; }
  applyFollow();
  if (!quiet) toast(TOUCH ? `Locked onto ${e.name}. Tap Cancel to let go.` : `Locked onto ${e.name}. Press ${e.key ? e.key.toUpperCase() + ' or ' : ''}Esc to let go.`);
}
const followMoon = () => followBody('moon');
const followVulcan = () => followBody('vulcan');
const followSun = () => followBody('sun');

// lock onto your world: back to the normal frame (the game is centred on your world), showing the whole disk
function lockWorld() {
  stopFollow();
  setCamRot(0);
  const z = fitZoom(); flyCam(DISK.cx, DISK.cy + 36 / z, z);
  savedView = null; mapStage = 1;
  toast('Locked onto your world.');
}
// select a country and fly the camera to fit it
function flyToCountry(c) {
  if (!c) return;
  game.active = c.id;
  game.driving = null;
  stopFollow();
  const [x0, y0, x1, y1] = c.box;
  const z = clamp(Math.min(cw / (x1 - x0 + 16), (ch - 230) / (y1 - y0 + 16)), 1.2, 24);
  flyCam((x0 + x1) / 2 + 0.5, (y0 + y1) / 2 + 0.5, z);
  toast(`${c.full} · ${fmtNum(c.people)} people · ${c.tiles} tiles`);
}
// glide the camera to a spot and zoom: eased in and out, longer for a bigger change of scale
function flyCam(x, y, z, dur) {
  zoomGoal = null;
  const zz = clamp(z, CFG.zoomMin, CFG.zoomMax);
  const d = Math.hypot(x - cam.x, y - cam.y), screens = d * Math.min(cam.zoom, zz) / Math.max(cw, ch);
  // far away: rise up mid-flight (zoom out until both ends fit), then come back down, instead of smearing the map past
  const hop = screens > 1.5 ? Math.log(Math.min(cam.zoom, zz) / clamp(Math.max(cw, ch) * 0.9 / d, CFG.zoomMin, CFG.zoomMax)) : 0;
  const span = Math.abs(Math.log(zz / cam.zoom)) + Math.min(screens, 3) + Math.max(0, hop);
  cam.anim = { x0: cam.x, y0: cam.y, z0: cam.zoom, x1: x, y1: y, z1: zz, t: 0, hop: Math.max(0, hop), dur: dur || clamp(0.45 + span * 0.12, 0.45, 1.3) };
}
function stepCamAnim(dt) {
  const a = cam.anim;
  if (!a) return;
  a.t = Math.min(1, a.t + dt / (a.dur || 0.7));
  const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;   // ease in-out
  cam.x = a.x0 + (a.x1 - a.x0) * e; cam.y = a.y0 + (a.y1 - a.y0) * e;
  cam.zoom = a.z0 * Math.pow(a.z1 / a.z0, e) * (a.hop ? Math.exp(-a.hop * Math.sin(Math.PI * e)) : 1);
  if (a.t >= 1) cam.anim = null;
}
function stopFollow() {
  if (!cam.follow) return;
  cam.follow = null;
  setCamRot(0);
}
// move the view by a WORLD-space delta (e.g. zoom-toward-cursor).
// While locked on, offsets live in the moon's frame, so turn the delta into that frame first.
function nudgeCam(dx, dy) {
  if (cam.follow) {
    cam.offX += dx * cam.cos - dy * cam.sin;
    cam.offY += dx * cam.sin + dy * cam.cos;
  } else { cam.x += dx; cam.y += dy; clampCam(); }
}
// move the view by a SCREEN-direction delta (keys), in tiles
function nudgeScreen(dx, dy) {
  if (cam.follow) { cam.offX += dx; cam.offY += dy; }
  else { cam.x += dx; cam.y += dy; clampCam(); }
}
function applyFollow() {
  const e = cam.follow && LOCK[cam.follow];
  if (!e) return;
  const [mx, my, a] = e.pos();
  if (e.frame !== 'rotating') { setCamRot(0); cam.x = mx + cam.offX; cam.y = my + cam.offY; return; }
  const spin = a - cam.a0;
  setCamRot(-spin);
  // the offset is fixed to the moon's surface, so it turns with the moon
  const c = Math.cos(spin), s = Math.sin(spin);
  cam.x = mx + cam.offX * c - cam.offY * s;
  cam.y = my + cam.offX * s + cam.offY * c;
}

// ======================================================================
// HUD
// ======================================================================
function iconFill() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = SVG[el.dataset.icon]; });
}
// The build bar is a hotbar: 10 slots on keys 1-9, 0. It fills itself with what you build: something new
// takes an empty slot, or the one you built from least recently (what's already on it keeps its key).
// In the E menu, hover any building and press a number to pin it to that key (right-click a bar button to clear it).
// On a phone the bar scrolls, so it shows the most recent first.
const SLOT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
// the E menu's tabs, each a few of the buildings' categories
const BUILD_TABS = [
  { id: 'settle', name: 'Settlement', cats: ['Housing', 'Transport'] },
  { id: 'mining', name: 'Mining', cats: ['Resources'] },
  { id: 'power', name: 'Power', cats: ['Energy'] },
  { id: 'weapons', name: 'Weapons', cats: ['Military'] },
  { id: 'vehicles', name: 'Vehicles', cats: ['Vehicles'] },
  { id: 'space', name: 'Space', cats: ['Space'] },
];
const tabOf = type => BUILD_TABS.find(t => t.cats.includes(CFG.buildings[type].cat)) || BUILD_TABS[0];
const tabTypes = tab => Object.keys(CFG.buildings).filter(t => tab.cats.includes(CFG.buildings[t].cat))
  .sort((a, b) => (CFG.buildings[a].unlock || 0) - (CFG.buildings[b].unlock || 0) || tab.cats.indexOf(CFG.buildings[a].cat) - tab.cats.indexOf(CFG.buildings[b].cat));
// NEW: unlocked by your population, and not looked at in the E menu yet (the starting buildings never are)
const isNewTech = type => isUnlocked(type) && (CFG.buildings[type].unlock || 0) > 0 && !game.seenTech.has(type);
const newCount = types => types.filter(isNewTech).length;
let menuHover = null;
// something was just built from `type`: it goes on the bar
function noteBuilt(type) {
  if (!CFG.buildings[type]) return;
  let k = game.hotbar.indexOf(type);
  if (k < 0) {
    k = game.hotbar.indexOf(null);
    if (k < 0) { k = 0; for (let j = 1; j < game.hotbar.length; j++) if (game.barUsed[j] < game.barUsed[k]) k = j; }
    game.hotbar[k] = type;
  }
  game.barUsed[k] = ++game.useTick;
  if (isNewTech(type)) { game.seenTech.add(type); renderNewBadges(); }
  renderBuildBar();
}
function renderBuildBar() {
  const wrap = $('build');
  wrap.innerHTML = '';
  const order = game.hotbar.map((t, k) => k);
  if (TOUCH) order.sort((a, b) => (game.barUsed[b] || 0) - (game.barUsed[a] || 0));
  order.forEach(k => {
    const type = game.hotbar[k];
    if (!type || !CFG.buildings[type] || !isUnlocked(type)) return;
    const b = CFG.buildings[type];
    const el = document.createElement('div');
    el.className = 'bbtn' + (game.tool === type ? ' sel' : ''); el.dataset.type = type;
    const cost = Object.entries(b.cost).map(([r, n]) =>
      `<span data-r="${r}" data-n="${n}">${SVG[RES_ICON[r]]}${n}</span>`).join('');
    el.innerHTML = `<div class="key">${SLOT_KEYS[k]}</div><div class="tile">${SVG[type]}</div>
      <div class="name">${b.name}</div><div class="cost">${cost}</div>`;
    el.title = 'Right-click to take it off the bar';
    el.addEventListener('click', () => setTool(game.tool === type ? null : type));
    el.addEventListener('contextmenu', e => { e.preventDefault(); game.hotbar[k] = null; renderBuildBar(); });
    wrap.appendChild(el);
  });
}
function pinToBar(type, k) {
  if (!isUnlocked(type)) return toast(`${CFG.buildings[type].name} isn't unlocked yet`);
  const old = game.hotbar.indexOf(type);
  if (old >= 0) { game.hotbar[old] = game.hotbar[k]; [game.barUsed[old], game.barUsed[k]] = [game.barUsed[k], game.barUsed[old]]; }   // swap places
  game.hotbar[k] = type;
  game.barUsed[k] = ++game.useTick;
  renderBuildBar();
  if (menuOpen) renderBuildMenu();
}
function addToBar(type) {                           // a new unlock takes the first empty slot
  if (game.hotbar.includes(type)) return;
  const k = game.hotbar.indexOf(null);
  if (k >= 0) { game.hotbar[k] = type; game.barUsed[k] = 0; }   // (used least: the first slot what you build takes)
}
function buildMenu() {
  renderBuildBar();
  document.querySelector('#topbar .res.country').addEventListener('click', () => flyToCountry(activeCountry()));
  document.querySelector('#inspect .ix').addEventListener('click', () => { if (camRide && camRide.o === inspected && !game.flying) camRide = null; inspect(null); });
  // buttons on a card (rebuilt as the numbers change, so catch the press itself)
  $('inspect').addEventListener('pointerdown', e => {
    const act = e.target.dataset && e.target.dataset.act, o = inspected;
    if (!act || e.target.disabled || !o) return;
    e.preventDefault();
    if (act === 'expand') expandStation(o);
    else if (act === 'upgrade' && o.type === 'settlement') upgradeCity(o);
    else if (act === 'supply') { o.supply = Number(e.target.dataset.n); toast(`This pad now keeps Space Station ${o.supply} supplied`); }
    else if (act === 'unsupply') { o.supply = null; toast('This pad builds rockets for you to fly again'); }
    updateInspect();
  });
  const pw = $('pct-buttons');
  for (const p of [10, 25, 50, 100]) {
    const el = document.createElement('div');
    el.className = 'pbtn'; el.textContent = p + '%'; el.dataset.p = p;
    el.addEventListener('click', () => setPct(p));
    pw.appendChild(el);
  }
  setPct(game.sendPct);
}
function setTool(t) {
  if (t && !isUnlocked(t)) return toast(`${CFG.buildings[t].name} unlocks when your empire reaches ${CFG.buildings[t].unlock} people`);
  game.tool = t;
  game.bridgeStart = null;
  if (t) game.aiming = false;
  tch.pending = null;
  document.querySelectorAll('.bbtn').forEach(el => el.classList.toggle('sel', el.dataset.type === t));
  canvas.classList.toggle('building', !!t);
}
// the bottom bar only shows what you've unlocked
function refreshBuildBar() { renderBuildBar(); }

// ---------- the build menu (E): tabs of buildings, with what's still locked and what's NEW ----------
let menuOpen = false, menuTab = 'settle';
function toggleBuildMenu(force) {
  const was = menuOpen;
  menuOpen = force === undefined ? !menuOpen : force;
  if (menuOpen && !was) {
    if (techOpen) toggleTechTree(false);
    const fresh = BUILD_TABS.find(t => newCount(tabTypes(t)));   // open on the tab with something new in it
    if (fresh) menuTab = fresh.id;
  }
  if (!menuOpen && was) markTabSeen();
  $('buildmenu').classList.toggle('show', menuOpen);
  if (menuOpen) renderBuildMenu();
}
// what's new on the tab you're leaving (or closing) has been seen
function markTabSeen() {
  const tab = BUILD_TABS.find(t => t.id === menuTab);
  if (!tab) return;
  for (const t of tabTypes(tab)) if (isUnlocked(t)) game.seenTech.add(t);
  renderNewBadges();
}
// the count of NEW buildings on the Build buttons
function renderNewBadges() {
  const n = newCount(Object.keys(CFG.buildings));
  for (const el of document.querySelectorAll('.newn')) el.textContent = !n ? '' : el.closest('#tbar') ? String(n) : `${n} new`;   // the phone's button row is tight
}
const bmSub = C => `Your empire: ${fmtNum(game.population)} people (peak ${fmtNum(game.peakPop)}) · building in ${C ? C.short : '-'}`;
const bmToGo = b => `🔒 at ${fmtNum(b.unlock)} people · ${fmtNum(Math.max(1, Math.ceil((b.unlock || 0) - game.peakPop)))} to go`;
// the open menu's live numbers, changed in place (no rebuild, so hover and clicks aren't disturbed)
function updateBuildMenu() {
  const C = activeCountry(), sub = $('bm-sub'), t = bmSub(C);
  if (sub.textContent !== t) sub.textContent = t;
  for (const el of document.querySelectorAll('#bm-grid .bm-card')) {
    const b = CFG.buildings[el.dataset.type];
    for (const c of el.querySelectorAll('.cost span[data-r]')) c.classList.toggle('no', !!C && C.res[c.dataset.r] < +c.dataset.n);
    if (el.classList.contains('locked')) { const st = el.querySelector('.bm-status'), tt = bmToGo(b); if (st.textContent !== tt) st.textContent = tt; }
  }
}
function renderBuildMenu() {
  const C = activeCountry();
  $('bm-sub').textContent = bmSub(C);
  const tabs = $('bm-tabs');
  tabs.innerHTML = '';
  for (const t of BUILD_TABS) {
    const n = newCount(tabTypes(t)), el = document.createElement('button');
    el.className = 'bm-tab' + (t.id === menuTab ? ' on' : '');
    el.innerHTML = `${t.name}${n ? ` <span class="bm-tabn">${n}</span>` : ''}`;
    el.addEventListener('click', () => {
      if (t.id === menuTab) return;
      markTabSeen(); menuTab = t.id; renderBuildMenu();
      $('buildmenu').scrollTop = 0;
    });
    tabs.appendChild(el);
  }
  const grid = $('bm-grid');
  grid.innerHTML = '';
  menuHover = null;
  const sub = document.createElement('div');
  sub.className = 'bm-catgrid';
  grid.appendChild(sub);
  for (const type of tabTypes(BUILD_TABS.find(t => t.id === menuTab) || BUILD_TABS[0])) {
    const b = CFG.buildings[type], open = isUnlocked(type), slot = game.hotbar.indexOf(type);
    const el = document.createElement('div');
    el.className = 'bm-card' + (open ? '' : ' locked') + (game.tool === type ? ' sel' : '') + (isNewTech(type) ? ' new' : '');
    el.dataset.type = type;
    const cost = Object.entries(b.cost).map(([r, n]) =>
      `<span data-r="${r}" data-n="${n}" class="${C && C.res[r] < n ? 'no' : ''}">${SVG[RES_ICON[r]]}${n}</span>`).join('');
    el.innerHTML = `<div class="tile">${SVG[type]}</div>
      <div class="bm-body"><div class="bm-name">${b.name}${isNewTech(type) ? ' <span class="tag-new">NEW</span>' : ''}${slot >= 0 ? ` <span class="bm-key" title="on your bar">${SLOT_KEYS[slot]}</span>` : ''}</div>
      <div class="bm-desc">${TOUCH ? (b.desc || '').replace('Press F, then click', 'Tap Fire, then tap') : b.desc || ''}</div>
      <div class="bm-foot"><div class="cost">${cost}</div>
      <div class="bm-status">${open ? (type === 'settlement' ? `houses ${CFG.settlement.levels[0].housing} · ${b.people} settlers` : b.gen ? `+${b.gen} MW` : b.workers ? `${b.workers} workers` : 'Unlocked') : bmToGo(b)}</div></div></div>`;
    if (open) el.addEventListener('click', () => { setTool(type); toggleBuildMenu(false); });
    el.addEventListener('mouseenter', () => { menuHover = type; });
    el.addEventListener('mouseleave', () => { if (menuHover === type) menuHover = null; });
    el.addEventListener('contextmenu', e => {         // right-click: on / off the bar
      e.preventDefault();
      if (slot >= 0) game.hotbar[slot] = null;
      else if (!open) return toast(`${b.name} isn't unlocked yet`);
      else if (game.hotbar.includes(null)) addToBar(type);
      else return toast('Your bar is full: hover a building and press 1–0 to replace a slot');
      renderBuildBar(); renderBuildMenu();
    });
    sub.appendChild(el);
  }
  const h = grid.querySelector('.bm-card:hover');   // still pointing at a card after a rebuild: it stays the hovered one
  if (h) menuHover = h.dataset.type;
}

// ---------- the tech tree (T): every building, by the population that unlocks it ----------
// Nothing to click to research: each tier opens by itself when your empire's peak population reaches it,
// and stays open if the population falls back. Tap a building for what it does.
let techOpen = false, techSel = null;
function toggleTechTree(force) {
  techOpen = force === undefined ? !techOpen : force;
  if (techOpen && menuOpen) toggleBuildMenu(false);
  $('techtree').classList.toggle('show', techOpen);
  for (const el of document.querySelectorAll('#tbar [data-act="tech"], #techbtn')) el.classList.toggle('on', techOpen);
  if (techOpen) { renderTechTree(); scrollTechToNext(); }
}
function scrollTechToNext() {
  const next = $('tt-list').querySelector('.tt-row.next'), box = $('techtree');
  if (next) box.scrollTop = Math.max(0, next.offsetTop - box.clientHeight / 2);
}
function renderTechTree() {
  const peak = game.peakPop, B = CFG.buildings;
  const tiers = [...new Set(Object.values(B).map(b => b.unlock || 0))].sort((a, b) => a - b);
  const total = Object.keys(B).length, have = Object.keys(B).filter(isUnlocked).length;
  $('tt-sub').textContent = `Peak population ${fmtNum(peak)} · ${have} of ${total} buildings unlocked`;
  const list = $('tt-list');
  list.innerHTML = '';
  tiers.forEach((u, j) => {
    const reached = peak >= u, prev = j ? tiers[j - 1] : 0, nextU = tiers[j + 1];
    const isNext = !reached && peak >= prev;
    // the rail down to the next tier fills as the population climbs toward it
    const fill = nextU === undefined ? 0 : peak >= nextU ? 100 : reached ? clamp((peak - u) / (nextU - u), 0, 1) * 100 : 0;
    const types = Object.keys(B).filter(t => (B[t].unlock || 0) === u);
    const row = document.createElement('div');
    row.className = 'tt-row' + (reached ? ' done' : isNext ? ' next' : '');
    row.innerHTML = `<div class="tt-rail"><div class="tt-dot"></div>${nextU === undefined ? '' : `<div class="tt-line"><i style="height:${fill}%"></i></div>`}</div>
      <div class="tt-main"><div class="tt-pop">${u ? `${fmtNum(u)} people` : 'Start'}
        <span class="tt-state">${reached ? '✓ Unlocked' : isNext ? `${fmtNum(Math.ceil(u - peak))} more people` : '🔒 Locked'}</span></div>
        ${isNext ? `<div class="tt-bar"><i style="width:${clamp((peak - prev) / (u - prev), 0, 1) * 100}%"></i></div>` : ''}
        <div class="tt-items"></div></div>`;
    const items = row.querySelector('.tt-items');
    for (const t of types) {
      const el = document.createElement('button');
      el.className = 'tt-item' + (isUnlocked(t) ? '' : ' locked') + (techSel === t ? ' on' : '');
      el.innerHTML = `<span class="tile">${SVG[t]}</span>${B[t].name}${isNewTech(t) ? ' <span class="tag-new">NEW</span>' : ''}`;
      el.addEventListener('click', () => { techSel = techSel === t ? null : t; renderTechTree(); });
      items.appendChild(el);
    }
    if (types.includes(techSel)) {
      const b = B[techSel], d = document.createElement('div');
      d.className = 'tt-detail';
      const cost = Object.entries(b.cost).map(([r, n]) => `<span>${SVG[RES_ICON[r]]}${n}</span>`).join('');
      d.innerHTML = `<div class="tt-dhead"><b>${b.name}</b><span class="tt-tab">${tabOf(techSel).name} tab</span></div>
        <div>${TOUCH ? (b.desc || '').replace('Press F, then click', 'Tap Fire, then tap') : b.desc || ''}</div>
        <div class="tt-dfoot"><div class="cost">${cost}</div>${isUnlocked(techSel) ? '<button class="tt-go">Build it</button>' : ''}</div>`;
      const go = d.querySelector('.tt-go');
      if (go) go.addEventListener('click', () => { const t = techSel; toggleTechTree(false); setTool(t); });
      row.querySelector('.tt-main').appendChild(d);
    }
    list.appendChild(row);
  });
}

function setPct(p) {
  game.sendPct = p;
  document.querySelectorAll('.pbtn').forEach(el => el.classList.toggle('on', +el.dataset.p === p));
}

let toastTimer = 0;
// Messages. A plain toast is a hint: one slot, the next hint replaces it. An alert (war, raids, a fallen
// country) or a good-news event stacks under it, stays for a while, goes into the event log, and when it
// says where it happened, a click on it (or Backspace) flies the camera there.
//   toast('Not enough wood')                                   a hint
//   toast('X sends 40 soldiers!', { alert: true, at: [x, y] })  an alert with a place
//   toast('You conquered X!', { good: true, at: [x, y] })       good news
const eventLog = [];                               // newest last: { msg, kind, at, time }
let logUnseen = 0, logOpen = false;
function toast(msg, opt) {
  const box = $('toast');
  if (!opt || !(opt.alert || opt.good)) {
    let el = box.querySelector('.tmsg.hint');
    if (!el) { el = document.createElement('div'); el.className = 'tmsg hint'; box.prepend(el); }
    el.textContent = msg;
    void el.offsetWidth; el.classList.add('show');   // (not on the next frame: in a paused tab that would come after the timer hid it)
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    return;
  }
  const kind = opt.alert ? 'alert' : 'good', at = opt.at || null;
  eventLog.push({ msg, kind, at, time: game.time });
  if (eventLog.length > 60) eventLog.shift();
  if (!logOpen) logUnseen++;
  renderLog();
  const el = document.createElement('div');
  el.className = `tmsg ${kind}`;
  el.textContent = msg;
  if (at) {
    const go = document.createElement('span');
    go.className = 'tgo'; go.textContent = TOUCH ? 'Go ›' : 'Go › ⌫';
    el.appendChild(go);
    el.addEventListener('click', () => { flyToSpot(at); el.classList.remove('show'); });
  }
  box.appendChild(el);
  void el.offsetWidth; el.classList.add('show');
  if (opt.sticky) el.classList.add('sticky');
  const alerts = box.querySelectorAll('.tmsg.alert:not(.sticky), .tmsg.good');
  for (let j = 0; j < alerts.length - 3; j++) alerts[j].remove();   // at most 3 stacked
  if (!opt.sticky) setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, kind === 'alert' ? 9000 : 6000);
}
// fly the camera to a spot on the disk, close enough to see what's happening there
function flyToSpot([x, y]) {
  game.driving = null; stopFollow(); camRide = null;
  if (mapStage) { savedView = null; mapStage = 0; }
  flyCam(x, y, Math.max(cam.zoom, CFG.cityZoom * 1.6));
}
function goToLastAlert() {
  for (let j = eventLog.length - 1; j >= 0; j--) if (eventLog[j].at && eventLog[j].kind === 'alert') return flyToSpot(eventLog[j].at);
  for (let j = eventLog.length - 1; j >= 0; j--) if (eventLog[j].at) return flyToSpot(eventLog[j].at);
  toast('Nothing has happened yet that you could fly to.');
}
// the event log: a button in the top bar with a count of new alerts, and a list that opens under it
function renderLog() {
  const list = $('loglist');
  if (!list) return;
  const hot = logUnseen > 0 && eventLog.slice(-logUnseen).some(e => e.kind === 'alert');
  for (const btn of [$('logbtn'), document.querySelector('#tbar [data-act="log"]')]) {
    if (!btn) continue;
    btn.querySelector('.logn').textContent = logUnseen ? String(logUnseen) : '';
    btn.classList.toggle('hot', hot);
  }
  if (!logOpen) return;
  list.innerHTML = '';
  if (!eventLog.length) { list.innerHTML = '<div class="lempty">Nothing yet. Wars, raids, conquests and lost countries show up here.</div>'; return; }
  for (let j = eventLog.length - 1; j >= 0; j--) {
    const e = eventLog[j], row = document.createElement('div');
    row.className = `lrow ${e.kind}${e.at ? ' go' : ''}`;
    row.innerHTML = `<span class="lt">${fmtTime(e.time)}</span><span class="lm"></span>${e.at ? '<span class="tgo">Go ›</span>' : ''}`;
    row.querySelector('.lm').textContent = e.msg;
    if (e.at) row.addEventListener('click', () => flyToSpot(e.at));
    list.appendChild(row);
  }
}
function toggleLog(on = !logOpen) {
  logOpen = on; logUnseen = 0;
  $('loglist').classList.toggle('show', on);
  renderLog();
}
// a bug shouldn't freeze the game without a word: say so once, keep running, and log the details
let errShown = false;
function reportError(err) {
  console.error(err);
  if (errShown) return;
  errShown = true;
  const el = document.createElement('div');
  el.id = 'errbar';
  el.textContent = `Something went wrong (${(err && err.message) || err}). The game keeps running; reload the page if it misbehaves. Click to hide.`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
}

// The resource numbers roll toward their new value instead of jumping, and the whole cell gives a little
// bump when a lump arrives (a shipment, a harvest) or flashes red when you spend.
const hudShown = {};
function shownRes(C, r) {
  const v = C.res[r] || 0, prev = hudShown['p' + r];
  if (hudShown['c' + r] !== C.id) { hudShown['c' + r] = C.id; hudShown[r] = v; hudShown['p' + r] = v; return v; }   // another country: no roll
  const d = v - prev, steady = Math.abs(C.rates[r] || 0) * 0.1;
  const cell = $('val-' + r) && $('val-' + r).closest('.res');
  if (cell && cell.animate) {
    if (d > Math.max(6, steady * 3 + 4)) cell.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.07)', filter: 'brightness(1.5)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    else if (d < -Math.max(3, steady * 3 + 2)) $('val-' + r).animate([{ color: '#ff7a6b' }, { color: '#eef2f8' }], { duration: 600, easing: 'ease-out' });
  }
  hudShown['p' + r] = v;
  let sh = hudShown[r] + (v - hudShown[r]) * 0.45;
  if (Math.abs(v - sh) < 1) sh = v;
  hudShown[r] = sh;
  return sh;
}
function updateHud() {
  const C = activeCountry();
  if (!C) return;                                  // game over: nothing left to show
  if (menuOpen) updateBuildMenu();
  const alive = game.countries.filter(c => c.alive).length;
  $('val-country').textContent = C.full;
  $('country-count').textContent = alive > 1 ? `${game.countries.filter(c => c.alive).indexOf(C) + 1} of ${alive}` : '';
  const inc = incomingTo(C);
  const fromTxt = [...inc.bySrc].map(([s, n]) => `${s.short} (${fmtNum(n)})`).join(', ');
  for (const r of ['wood', 'stone', 'iron']) {
    $('val-' + r).innerHTML = fmtNum(shownRes(C, r)) + (inc[r] >= 1 ? `<span class="incoming" title="On its way by ship or train${fromTxt ? ' from ' + fromTxt : ''}">+${fmtNum(inc[r])}</span>`
      : askOf(C, r) >= 1 ? `<span class="incoming" style="color:var(--bad)" title="${C.short} asked your empire for ${Math.ceil(askOf(C, r))} ${r}: ships and trains bring it as soon as a country can spare it">asked</span>` : '');
    {                                               // every store has a ceiling: show it, and how full it is
      $('val-' + r).style.whiteSpace = 'nowrap';
      const cap = C.store ? C.store[r] : CFG.storage[r].base, f = clamp(C.res[r] / cap, 0, 1);
      $('val-' + r).innerHTML += `<span style="font-size:12px;font-weight:600;opacity:0.65"> / ${cap >= 10000 ? (cap / 1000).toFixed(1) + 'k' : fmtNum(cap)}</span>
        <div title="Storage: grows with the people your settlements can house" style="height:4px;width:100%;min-width:70px;background:rgba(255,255,255,0.14);border-radius:2px;margin-top:3px">
        <div style="height:100%;width:${(f * 100).toFixed(0)}%;background:${f >= 0.999 ? '#f2c14e' : { wood: '#56963f', stone: '#9aa1a8', iron: '#bd7b56' }[r]};border-radius:2px"></div></div>`;
    }
    const rate = C.rates[r];
    const el = $('rate-' + r);
    el.textContent = `${rate < 0 ? '' : '+'}${rate.toFixed(1)}/s`;
    el.classList.toggle('zero', rate === 0);
    el.classList.toggle('neg', rate < 0);
  }
  {                                                 // fuel shows up once this country has a drill or a pad
    const show = !!(C.pw.pads || C.pw.drills || C.res.fuel > 0), cap = C.store ? C.store.fuel || 0 : 0;
    $('res-fuel').style.display = show ? '' : 'none';
    if (show) {
      const f = cap ? clamp(C.res.fuel / cap, 0, 1) : 0;
      $('val-fuel').style.whiteSpace = 'nowrap';
      $('val-fuel').innerHTML = `${fmtNum(C.res.fuel)}<span style="font-size:12px;font-weight:600;opacity:0.65"> / ${fmtNum(cap)}</span>
        <div title="Fuel in the rockets on your launch pads (each holds ${CFG.rocket.tank})" style="height:4px;width:100%;min-width:70px;background:rgba(255,255,255,0.14);border-radius:2px;margin-top:3px">
        <div style="height:100%;width:${(f * 100).toFixed(0)}%;background:${f >= 0.999 ? '#f2c14e' : '#5fc4f0'};border-radius:2px"></div></div>`;
      const el = $('rate-fuel'), rate = C.rates.fuel || 0;
      el.textContent = !C.pw.pads && C.pw.drills ? 'NO PAD' : `${rate < 0 ? '' : '+'}${rate.toFixed(2)}/s`;
      el.classList.toggle('zero', rate === 0 && !!C.pw.pads);
      el.classList.toggle('neg', !C.pw.pads && !!C.pw.drills);
    }
  }
  {                                                 // uranium shows up once this country has some, mines it, or runs a plant
    const u = C.res.uranium || 0, rate = (C.rates || {}).uranium || 0, show = u >= 0.05 || (C.prod && C.prod.uranium > 0) || C.pw.nukes > 0;
    $('res-uranium').style.display = show ? '' : 'none';
    if (show) {
      const cap = storeOf(C, 'uranium'), f = cap ? clamp(u / cap, 0, 1) : 0;
      $('val-uranium').style.whiteSpace = 'nowrap';
      $('val-uranium').innerHTML = `${u < 10 ? u.toFixed(1) : fmtNum(u)}<span style="font-size:12px;font-weight:600;opacity:0.65"> / ${fmtNum(cap)}</span>
        <div title="Uranium: mined from rare dark deposits, burned by nuclear plants" style="height:4px;width:100%;min-width:70px;background:rgba(255,255,255,0.14);border-radius:2px;margin-top:3px">
        <div style="height:100%;width:${(f * 100).toFixed(0)}%;background:${f >= 0.999 ? '#f2c14e' : '#9dff7a'};border-radius:2px"></div></div>`;
      const el = $('rate-uranium');
      el.textContent = `${rate < 0 ? '' : '+'}${rate.toFixed(2)}/s`;
      el.classList.toggle('zero', Math.abs(rate) < 0.005);
      el.classList.toggle('neg', rate < -0.005);
    }
  }
  flightHud();
  const M = C.mw, short = M.machines > 0 && C.sat < 0.999;
  const cityShort = C.pw.capPow > 0.5 && poweredShare(C) < 0.995;
  $('val-power').textContent = M.need || M.max ? `${fmtNum(M.need)} / ${fmtNum(M.max)} MW` : C.pw.capPow > 0.5 ? `0 / 0 MW` : '-';
  $('val-power').title = `Using ${fmtNum(M.need)} of the ${fmtNum(M.max)} MW ${C.short} can make (machines ${fmtNum(M.machines || 0)}, cities ${fmtNum(M.city || 0)})`;
  $('val-power').classList.toggle('short', short || cityShort);
  $('rate-power').textContent = short ? `${Math.round(C.sat * 100)}% POWERED` : C.pw.capPow > 0.5 ? `CITIES ${Math.round(poweredShare(C) * 100)}%` : M.need ? 'OK' : '';
  $('rate-power').classList.toggle('neg', short || cityShort);
  $('val-terr').textContent = (game.ownedCount / game.landTiles * 100).toFixed(1) + '%';
  $('val-time').textContent = fmtTime(game.time);
  $('save-note').textContent = game.savedAt != null && game.time - game.savedAt < 2.5 ? 'SAVED' : '';
  $('val-view').textContent = cam.follow ? (mapStage === 3 ? 'Solar system' : LOCK[cam.follow].short)
    : cam.zoom < orbitZoom() * 0.6 ? 'Solar' : cam.zoom >= CFG.detailZoom ? 'Detail' : cam.zoom >= CFG.cityZoom ? 'Region'
    : cam.zoom > fitZoom() * 0.8 ? 'Map' : 'Orbit';
  $('people-lbl').textContent = alive > 1 ? `PEOPLE · EMPIRE ${fmtNum(game.population)}` : 'PEOPLE';
  $('val-people').textContent = `${fmtNum(C.people)} / ${fmtNum(C.cap)}`;
  $('val-people').title = `${C.short}'s ${C.pw.cities} ${C.pw.cities === 1 ? 'city houses' : 'cities house'} ${fmtNum(C.capBase)} without power, plus ${fmtNum(C.powCap || 0)} of up to ${fmtNum(C.pw.capPow)} more on power (${CFG.settlement.perMW} people per spare MW). Keeps a crew of ${fmtNum(crewOf(C))}: trains and ships bring people when it's short.`;
  $('people-fill').style.width = (C.cap ? clamp(C.people / C.cap, 0, 1) * 100 : 0) + '%';
  $('people-rate').innerHTML = (inc.people >= 1 ? `<span class="incoming">+${fmtNum(inc.people)} arriving</span> ` : '') + (C.growth > 0 ? `+${C.growth.toFixed(1)} / sec` : C.growth < 0 ? `<span style="color:var(--bad)">Overcrowded: ${C.growth.toFixed(1)} / sec</span>` : (C.people > C.cap + 0.5 ? 'Crew on hand' : C.people >= C.cap - 0.5 ? 'Full' : '')) + (C.fireCap > 0 ? ` <span style="color:var(--bad)">Under fire</span>` : '');
  $('send-n').textContent = `= ${sendFrom(C)} people`;
  $('bar-note').textContent = C.pw.workers
    ? `${fmtNum(Math.min(C.people, C.pw.workers))} at work${C.staff < 0.999 ? ` (need ${C.pw.workers})` : ''} · regrows fastest at half full`
    : 'regrows fastest at half full';
  $('bar-note').classList.toggle('neg', C.staff < 0.999);
  document.querySelectorAll('.bbtn .cost span').forEach(el => {
    el.classList.toggle('no', C.res[el.dataset.r] < +el.dataset.n);
  });
  updateHover();
}

// the tooltip while the bridge tool is out: [html, bad]
function bridgeTip(t) {
  const B = CFG.bridge, st = game.bridgeStart, back = say('Right-click', 'Tap Cancel');
  if (st == null) {
    const ok = !!owner[t.i];
    return [`<div class="t">Bridge: ${say('click', 'tap')} your coast to start</div>
      <div class="${ok ? 'g' : 'r'}">${ok ? `Start here, then ${say('click', 'tap')} the land across the water` : 'Start on your own land'}</div>
      <div class="d">Stone for every tile of water, each tile ${B.grow} more than the last: 10 tiles cost ${bridgeCost(10).stone}, 20 cost ${bridgeCost(20).stone}, 30 cost ${bridgeCost(30).stone}. At most ${B.maxLen} tiles.</div>`, !ok];
  }
  const p = bridgePlan(st, t.i), C = p.s != null && owner[p.s] ? countryAt(p.s) : null;
  const miss = !p.why && C ? missingFor(p.cost, C) : null;
  let html = `<div class="t">Bridge${p.len ? `: ${p.len} tile${p.len > 1 ? 's' : ''} of water` : ''}</div>`;
  if (!p.why) {
    const there = countryAt(p.b);
    html += !there ? `<div class="g">Lands on free land and claims it for ${C.short}</div>`
      : there !== C ? `<div class="g">Joins ${there.short} and ${C.short} into one country</div>`
      : `<div class="g">A shortcut across the water within ${C.short}</div>`;
    html += `<div class="d">Trucks drive over it and rail follows it</div>`;
  }
  if (p.cost) html += `<div class="d">Cost: ${fmtNum(p.cost.stone)} stone${C ? `, paid by ${C.short} (has ${fmtNum(C.res.stone)})` : ''}</div>`;
  if (p.why) html += `<div class="r">${p.why}</div>`;
  else if (miss) html += `<div class="r">Not enough ${miss}</div>`;
  html += `<div class="d">${back} to start somewhere else</div>`;
  return [html, !!(p.why || miss)];
}

function updateHover() {
  const tip = $('tooltip');
  if (mouse.in) {
    const [wx, wy] = toWorld(mouse.x, mouse.y);
    const body = bodyUnder(wx, wy);
    if (body) {
      $('hover-info').textContent = body.info(wx, wy) + (cam.follow === body.id ? '' : ' · click to lock on');
      tip.style.display = 'none';
      return;
    }
    if (worldLockable() && overWorld(wx, wy)) {
      $('hover-info').textContent = 'Your world · click to lock on';
      tip.style.display = 'none';
      return;
    }
  }
  const t = mouse.in ? hoverTile() : null;
  if (!t) { $('hover-info').innerHTML = '&nbsp;'; tip.style.display = 'none'; return; }
  const b = biome[t.i];
  let info = BIOME_NAME[b];
  if (b === WALL) info += ' · the edge of the world';
  if (onBridge(t.i)) info += ' · bridge';
  if (isLand(t.i)) {
    const foe = nationAt(t.i);
    info += foe ? ` · ${foe.full} (AI) · ${fmtNum(foe.people)} people · ${Math.floor(foe.iron || 0)} / ${Math.round(foe.ironCap || 0)} iron · ${tileCost(t.i).toFixed(1)} people/tile to take${defenseAt(t.i) >= 0.5 ? ` · defended by ${fmtNum(defenseAt(t.i))} people of its city` : ''}`
      : ` · ${tileCost(t.i)} people/tile`;
    if (depositOf[t.i] >= 0) info += ` · ${deposits[depositOf[t.i]].type}`;
    if (building[t.i] === BLD_CODE.settlement) {
      const sb = buildingAt(t.i);
      info += ` · ${cityName(sb)} · ${fmtNum(sb.pop || 0)} / ${Math.round(settlementCap(sb))} people · protects land within ${zoneOf(sb)} tiles${underFire(sb) ? ` · under attack: not growing for ${fireLeft(sb)}s` : ''}`;
    } else if (building[t.i]) {
      const hb = buildingAt(t.i);
      info += ` · ${CFG.buildings[hb.type].name}`;
      if (HARVESTS[hb.type] && hb.work) info += ` · works ${DEP_TYPES.filter(k => hb.work[k]).map(k => `${hb.work[k]} ${k} tiles`).join(', ') || 'nothing in reach'}`;
      const hc = owner[t.i] ? countryAt(t.i) : null;
      if (hb.type === 'drill' && hc) {
        const pp = pipeOf(t.i);
        info += pp ? (hc.fuelFlow ? ` · pumping ${(CFG.buildings.drill.fuel * hc.sat).toFixed(2)} fuel/s into the rocket${hc.sat < 0.999 ? ` (${Math.round(hc.sat * 100)}% powered)` : ''}` : ' · waiting for a rocket to fuel') + ` · piped ${Math.round(pp.len)} tiles to a launch pad`
          : ' · no launch pad in this country: build one and the pipe lays itself';
      }
      if (hb.type === 'pad' && hc) {
        const R = CFG.rocket, st = rocketState(hb), k = hb.rocket;
        info += st === 'none' ? ` · waiting for iron: a rocket costs ${R.iron} (it keeps ${R.ironReserve} back)`
          : st === 'fuelling' || st === 'building' ? ` · fuelling: ${Math.floor(k.fuel / R.tank * 100)}% (${Math.floor(k.fuel)} / ${R.tank}) at ${(hb.useFuel || 0).toFixed(2)} fuel/s from ${hc.pw.drills} ice drill${hc.pw.drills === 1 ? '' : 's'}`
          : st === 'ready' ? ` · rocket ready: ${say('click', 'tap')} the pad to launch` : '';
        if (st !== 'ready') info += hb.paused ? ` · paused: ${say('click', 'tap')} to resume` : ` · ${say('click', 'tap')} to pause`;
      }
    }
    else if (depositOf[t.i] >= 0 && owner[t.i] && !isHarvested(t.i))
      info += ` · nobody works this tile: put a ${deposits[depositOf[t.i]].type === 'forest' ? "logger's cabin" : "miner's camp"} within ${CFG.collectorReach} tiles`;
    if (owner[t.i]) { const c = countryAt(t.i); if (c) info += ` · ${c.full}`; }
  }
  $('hover-info').textContent = info;

  // `ring` [x, y, r] (screen): sit the card beside that ring, not on top of it (the other side if there's no room)
  const placeTip = (html, bad, ring) => {
    tip.innerHTML = html;
    tip.classList.toggle('bad', bad);
    tip.style.display = 'block';
    if (ring) {
      const [rx, ry, rr] = ring, w = tip.offsetWidth, h = tip.offsetHeight;
      const left = rx + rr + 12 + w <= cw - 8 ? rx + rr + 12 : rx - rr - 12 - w;
      tip.style.left = clamp(left, 8, cw - w - 8) + 'px';
      tip.style.top = clamp(ry - h / 2, 8, ch - h - 8) + 'px';
      return;
    }
    tip.style.left = Math.min(mouse.x + 18, cw - 290) + 'px';
    tip.style.top = Math.min(mouse.y + 18, ch - 120) + 'px';
  };

  if (game.aiming) {
    const { inR, ready } = pickWeapon(t.x, t.y), o = ready || inR[0], foe = nationAt(t.i), mine = countryAt(t.i);
    const cost = o ? Object.entries(o.Wp.cost).map(([r, n]) => `${n} ${r}`).join(' · ') : '';
    placeTip(`<div class="t">${o ? 'Fire a ' + o.Wp.name.toLowerCase() : 'Fire'}: click</div>
      <div class="${ready ? 'g' : 'r'}">${ready ? `${Math.round(o.d)} tiles from your ${CFG.buildings[o.b.type].name.toLowerCase()}` : o ? `Reloading: ${Math.ceil(o.b.ready - game.time)}s` : `Out of range (silos reach ${CFG.weapons.missile.range} tiles)`}</div>
      ${foe ? `<div class="d">Target: ${foe.full} · ${fmtNum(foe.people)} people${foe.hostile ? '' : ' · not at war with you yet'}</div>` : mine ? `<div class="r">That's your own land!</div>` : ''}
      ${o ? `<div class="d">Cost: ${cost} · blast radius ${o.Wp.radius}</div>` : ''}
      <div class="d">F or Esc to stop aiming</div>`, !ready);
    return;
  }
  if (!game.tool && blueprint) {
    const plan = pastePlan(t.x, t.y), n = blueprint.items.length;
    const costTxt = Object.entries(plan.cost).map(([r, v]) => `${v} ${r}`).join(' · ') || 'nothing';
    const miss = missingFor(plan.cost, countryAt(t.i) || activeCountry());
    placeTip(`<div class="t">Paste ${n} building${n > 1 ? 's' : ''}: press C</div>
      <div class="${plan.fit === n ? 'g' : 'r'}">${plan.fit} of ${n} fit here</div>
      <div class="d">Cost: ${costTxt}</div>
      ${miss ? `<div class="r">Not enough ${miss} for all of them</div>` : ''}
      <div class="d">Click or Esc to clear the selection</div>`, plan.fit === 0 || !!miss);
    return;
  }

  if (!game.tool) {                                // pointing at a building: a card saying what it's up to
    const hb = building[t.i] && building[t.i] !== BLD_CODE.settlement && !mouse.dragged ? buildingAt(t.i) : null;
    if (hb && hb !== inspected && CFG.buildings[hb.type] && !pointingAtBody()) {
      const [html, bad] = buildingCard(hb), [gx, gy, gr] = ringGeom(hb, cam.zoom), [sx, sy] = toScreen(gx, gy);
      placeTip(html, bad, [sx, sy, gr + 3]);
      return;
    }
    tip.style.display = 'none'; return;
  }
  if (game.tool === 'bridge') { const [html, bad] = bridgeTip(t); placeTip(html, bad); return; }
  if (game.tool === 'settlement') { const u = upgradeTargetAt(t.i); if (u) { const [html, bad] = upgradeTip(u); placeTip(html, bad); return; } }
  const type = game.tool, bdef = CFG.buildings[type];
  const why = canBuild(t.i, type);
  const plan = planFor(t.i, type);
  const cost = totalCost(type, plan, t.i);
  const TC = countryAt(t.i);
  const miss = missingFor(cost, TC || activeCountry());
  const costTxt = Object.entries(cost).map(([r, n]) => `${n} ${r}`).join(' · ');
  const have = !why && building[t.i] ? buildingAt(t.i).type : null;
  let html = `<div class="t">${bdef.vehicle ? `Launch a ${bdef.name.toLowerCase()}` : have ? `Upgrade ${CFG.buildings[have].name} → ${bdef.name}` : `Place ${bdef.name}`}</div>`;
  if (bdef.vehicle) {
    const n = TC ? crewFor(TC) : 0, kit = TC ? kitFor(TC, cost) : {};
    const load = Object.entries(kit).filter(([, v]) => v > 0).map(([r, v]) => `${v} ${r}`).join(', ');
    html += `<div class="${n >= 2 ? 'g' : 'r'}">${n >= 2 ? `Carries ${n} people${load ? ', ' + load : ''}` : `No free people to crew it${TC ? ' in ' + TC.short : ''}`}</div>`;
    html += `<div class="d">Crew and cargo: your send % (${game.sendPct}%) of ${TC ? TC.short + "'s" : 'the'} free people and stock, at least ${CFG.drive.minCrew} people and ${CFG.expeditionKit.wood} wood and ${CFG.expeditionKit.stone} stone when it has them</div>`;
    html += `<div class="d">You drive it to free land and settle a colony there. The colony's first ${bdef.vehicle} links home along the way it came.</div>`;
  } else if (type === 'settlement') {
    const S = CFG.settlement, V = S.levels[0];
    html += `<div class="g">A village: ${bdef.people} settlers move in from your other cities, and it houses ${V.housing}${TC ? ' in ' + TC.short : ''}</div>`;
    html += `<div class="d">Stores ${fmtNum(CFG.storage.wood.city * V.store)} wood and stone, ${fmtNum(CFG.storage.iron.city * V.store)} iron. Protects the land within ${V.zone} tiles while it has people.</div>`;
    html += `<div class="d">Place a settlement on it later to upgrade it: Town, then City and up, where the extra housing runs on power.</div>`;
  } else if (plan) {
    if (plan.route) {
      html += type === 'station'
        ? `<div class="g">Rail along the road your truck took: ${plan.tiles} tiles of track to ${plan.homeName}</div>`
        : `<div class="g">Shipping lane along your boat's course: ${plan.tiles} tiles to ${plan.homeName}</div>`;
    } else if (plan.path) {
      html += type === 'station'
        ? `<div class="g">Rail link: ${plan.tiles} tiles of track to your nearest station</div>`
        : `<div class="g">Sea route: ${plan.tiles} tiles to your nearest port</div>`;
    } else html += `<div class="d">${plan.note}</div>`;
  } else if (bdef.gen) {
    html += `<div class="g">+${bdef.gen} MW power${TC ? ' for ' + TC.short : ''}</div>`;
    if (type === 'burner') html += `<div class="d">Burns up to ${CFG.power.burnerWood} wood/s, only as much as is needed</div>`;
    if (type === 'nuclear') html += `<div class="d">Burns up to ${CFG.power.nukeUranium} uranium/s, only as much as is needed${TC ? ` · ${TC.short} has ${fmtNum(TC.res.uranium || 0)} uranium` : ''}. Must be on the coast.</div>`;
  } else if (type === 'rig' || bdef.on) {
    const R = CFG.collectorReach, rate = w => DEP_TYPES.filter(k => w[k]).map(k => `${(w[k] * CFG.prodPerTile[k] * (type === 'rig' ? CFG.power.rigMult : 1)).toFixed(1)} ${DEP_RES[k]}/s`).join(' · ');
    if (type === 'rig') {
      const old = building[t.i] ? buildingAt(t.i) : null;
      if (old && old.work) html += `<div class="g">${rate(old.work) || 'nothing in reach'} from the ${old.work.forest + old.work.stone + old.work.iron} tiles it works</div>`;
      html += `<div class="d">Uses ${bdef.use} MW and frees the workers; no power, no output</div>`;
    } else {
      const g = owner[t.i] ? harvestGain(t.i, type) : { fresh: { forest: 0, stone: 0, iron: 0, uranium: 0 }, shared: 0 }, n = g.fresh.forest + g.fresh.stone + g.fresh.iron;
      html += `<div class="${n ? 'g' : 'r'}">${n ? `+${rate(g.fresh)} from ${n} tiles in reach` : `No ${bdef.on.join(' or ')} to work within ${R} tiles`}</div>`;
      if (g.shared) html += `<div class="d">${g.shared} more tiles here are already worked by another collector</div>`;
      html += `<div class="d">Works ${bdef.on.join(' and ')} within ${R} tiles · employs ${bdef.workers} people</div>`;
    }
  } else if (bdef.gun) {
    const T = CFG.turret;
    html += `<div class="g">Guns down enemy soldiers within ${T.range} tiles: ${T.kills} a second</div>`;
    html += `<div class="d">Fires by itself when a wave's front comes in range · ${T.iron} iron per soldier</div>`;
  } else if (bdef.defense) {
    const A = CFG.airDefense;
    html += `<div class="g">Covers everything within ${A.range} tiles</div>`;
    html += `<div class="d">Shoots down shells and missiles aimed there: ${A.cost.iron} iron each, then ${A.reload}s to reload · uses ${bdef.use} MW</div>`;
  } else if (bdef.weapon) {
    const Wp = CFG.weapons[bdef.weapon];
    html += `<div class="g">Reaches ${Wp.range} tiles · reloads in ${Wp.reload}s · blast radius ${Wp.radius}</div>`;
    html += `<div class="d">Each shot costs ${Object.entries(Wp.cost).map(([r, n]) => `${n} ${r}`).join(' and ')}${bdef.use ? ` · uses ${bdef.use} MW` : ''}. ${bdef.weapon === 'missile' ? say('Press F to aim.', 'Tap Fire to aim.') : 'Fires by itself at nations you are at war with.'}</div>`;
  } else if (type === 'drill') {
    html += `<div class="g">+${bdef.fuel} fuel/s on full power · uses ${bdef.use} MW</div>`;
    html += `<div class="d">${TC && TC.pw.pads ? 'Lays a pipe to your nearest launch pad by itself' : 'No launch pad in this country yet: the fuel needs one to go to'}</div>`;
  } else if (type === 'pad') {
    html += `<div class="g">Holds ${bdef.tank} rocket fuel and builds rockets</div>`;
    html += `<div class="d">Ice drills in this country pipe their fuel here by themselves. Each rocket takes ${CFG.rocket.iron} iron, then ${CFG.rocket.tank} fuel.</div>`;
  } else if (type === 'port') html += `<div class="d">Must be on the coast. Links to your other ports by sea.</div>`;
  else html += `<div class="d">Links to your nearest station by rail.</div>`;
  html += `<div class="d">Cost: ${costTxt}${bdef.people ? ` · ${bdef.people} people` : ''}${plan && plan.extra ? ' (incl. track)' : ''}${TC ? ', paid by ' + TC.short : ''}</div>`;
  if (why) html += `<div class="r">${why}</div>`;
  else if (miss) html += `<div class="r">Not enough ${miss}</div>`;
  else if (bdef.people && TC && freePeople(TC) < bdef.people) html += `<div class="r">Needs ${bdef.people} free people</div>`;
  tip.innerHTML = html;
  tip.classList.toggle('bad', !!(why || miss));
  tip.style.display = 'block';
  tip.style.left = Math.min(mouse.x + 18, cw - 290) + 'px';
  tip.style.top = Math.min(mouse.y + 18, ch - 120) + 'px';
}

const WEAPON_RING = { shell: 'rgba(255,170,70,0.9)', missile: 'rgba(255,122,107,0.85)' };
function drawMissiles(z) {
  // burnt ground where something landed, fading over time
  for (const sc of game.scorch) {
    const [sx, sy] = toScreen(sc.x, sc.y), r = Math.max(5, sc.R * z * 0.95);
    if (FX.scorch) {                               // a crater with soot streaks, each one turned its own way
      drawFx(FX.scorch, 0, sx, sy, r * 2.4, 0.5, hash2(Math.floor(sc.x * 7), Math.floor(sc.y * 7), 66) * 6.283, 0.9 * Math.min(1, (1 - sc.t) * 1.6));
      continue;
    }
    ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(22,18,16,${0.42 * (1 - sc.t)})`; ctx.fill();
  }
  // reload bars under every weapon that's reloading (yours and theirs)
  if (z >= CFG.cityZoom * 0.5) for (const b of game.buildings) {   // a city under attack: its people are its health
    if (b.type !== 'settlement' || !underFire(b)) continue;
    const [sx, sy] = toScreen(...tileCenter(b.i)), w = Math.max(30, z * 2.4), f = clamp((b.pop || 0) / Math.max(1, settlementCap(b)), 0, 1), up = Math.max(16, z * 2);
    ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fillRect(sx - w / 2 - 1, sy - up - 1, w + 2, 7);
    ctx.fillStyle = '#5a2320'; ctx.fillRect(sx - w / 2, sy - up, w, 5);
    ctx.fillStyle = f > 0.5 ? '#7bd389' : f > 0.2 ? '#f2c14e' : '#ff7a6b'; ctx.fillRect(sx - w / 2, sy - up, w * f, 5);
  }
  if (z >= CFG.cityZoom) for (const b of game.buildings) {      // how much more a damaged building can take
    if (!b.dmg || b.type === 'settlement') continue;
    const [sx, sy] = toScreen(...tileCenter(b.i)), w = Math.max(22, z * 1.6), f = clamp(1 - b.dmg / hpOf(b), 0, 1), up = b.type === 'settlement' ? z * 1.7 : z * 0.95;
    ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fillRect(sx - w / 2 - 1, sy - up - 1, w + 2, 6);
    ctx.fillStyle = '#7a2a25'; ctx.fillRect(sx - w / 2, sy - up, w, 4);
    ctx.fillStyle = f > 0.5 ? '#7bd389' : '#f2c14e'; ctx.fillRect(sx - w / 2, sy - up, w * f, 4);
  }
  if (z >= CFG.cityZoom) for (const b of game.buildings) {
    if (!(CFG.buildings[b.type].weapon || CFG.buildings[b.type].defense) || (b.ready || 0) <= game.time || !b.rd) continue;
    const [sx, sy] = toScreen(...tileCenter(b.i)), w = Math.max(20, z * 1.5), f = clamp(1 - (b.ready - game.time) / b.rd, 0, 1);
    ctx.fillStyle = 'rgba(20,26,37,0.9)'; ctx.fillRect(sx - w / 2 - 1, sy + z * 0.75 - 1, w + 2, 6);
    ctx.fillStyle = owner[b.i] ? '#7bd389' : '#ff7a6b'; ctx.fillRect(sx - w / 2, sy + z * 0.75, w * f, 4);
  }
  // how far up the screen something `s` of the way up an arc `H` tiles high is drawn (never flatter than 26 px)
  const liftPx = (s, H) => s * Math.max(26, H * z);
  const lifted = (x, y, air) => { const [sx, sy] = toScreen(x, y); return [sx, sy - (air ? liftPx(air.s, air.H) : 0)]; };
  for (const b of game.buildings) {                // a turret that's firing: flickering tracers and a muzzle flash
    if (b.type !== 'turret' || !b.aim || game.time - (b.fire || -9) > 0.12) continue;
    let [ax, ay] = toScreen(...tileCenter(b.i)), flash = Math.max(3, z * 0.35);
    const [bx, by] = toScreen(b.aim[0], b.aim[1]);
    if (z >= CFG.detailZoom && b.topA != null) {   // close up, the fire comes out of the barrels' ends, a smaller flash
      const a = b.topA + cam.rot;
      ax += Math.cos(a) * z * 0.52; ay += Math.sin(a) * z * 0.52; flash = Math.max(3, z * (0.12 + Math.random() * 0.1));
    }
    for (let j = 0; j < 3; j++) {
      const jx = (Math.random() - 0.5) * z * 1.6, jy = (Math.random() - 0.5) * z * 1.6, f0 = Math.random() * 0.6, f1 = f0 + 0.25;
      ctx.beginPath(); ctx.moveTo(lerp(ax, bx + jx, f0), lerp(ay, by + jy, f0)); ctx.lineTo(lerp(ax, bx + jx, f1), lerp(ay, by + jy, f1));
      ctx.strokeStyle = 'rgba(255,236,150,0.95)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(ax, ay, flash, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,220,120,0.9)'; ctx.fill();
  }
  for (const tr of game.tracers) {                 // an interceptor's streak up to where it met the shot
    const [ax, ay] = toScreen(tr.x0, tr.y0), [bx, by] = lifted(tr.x1, tr.y1, tr.air, z);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = `rgba(190,245,255,${0.9 * (1 - tr.t)})`; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${1 - tr.t})`; ctx.lineWidth = 1; ctx.stroke();
  }
  if (game.aiming) {
    // their air defense: shots aimed inside this area get knocked down (one shape for all of them)
    const ring = (b, R) => { const [sx, sy] = toScreen(...tileCenter(b.i)); return [sx, sy, R * z]; };
    unionRings(game.buildings.filter(b => b.type === 'airdef' && aiOf[b.i]).map(b => ring(b, CFG.airDefense.range)),
      { color: 'rgba(120,200,255,0.85)', dash: [3, 5], width: 2, fill: 'rgba(120,200,255,0.07)' });
    // your reach: every silo's range merged into one outline, one per weapon kind
    const byKind = {};
    for (const b of silosOf()) { const kind = CFG.buildings[b.type].weapon; (byKind[kind] = byKind[kind] || []).push(ring(b, CFG.weapons[kind].range)); }
    for (const kind in byKind) unionRings(byKind[kind], { color: WEAPON_RING[kind], dash: kind === 'shell' ? [4, 5] : [8, 6], width: 2, fill: 'rgba(255,122,107,0.05)' });
    const t = mouse.in ? hoverTile() : null;
    if (t) {
      const { inR, ready } = pickWeapon(t.x, t.y), o = ready || inR[0];
      const [sx, sy] = toScreen(t.x + 0.5, t.y + 0.5), r = Math.max(8, ((o ? o.Wp.radius : 1.5) + 0.5) * z);
      ctx.lineWidth = 2; ctx.strokeStyle = ready ? '#ff7a6b' : 'rgba(255,122,107,0.45)';
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - r - 6, sy); ctx.lineTo(sx + r + 6, sy); ctx.moveTo(sx, sy - r - 6); ctx.lineTo(sx, sy + r + 6); ctx.stroke();
    }
  }
  // smoke: the trails shots leave in the air (they stay where they were left), launch billows, smoke over craters
  const ks = clamp(z / 9, 0.75, 2.4);
  for (const p of game.smoke || []) {
    const age = p.t, [sx, sy0] = toScreen(p.x, p.y);
    const sy = sy0 - liftPx(p.s, p.H) - age * p.life * p.rise * ks;
    const r = (p.big ? 2.2 : 1.7) * p.size * ks * (1 + age * (p.big ? 2.6 : 2));
    if (sx < -r || sy < -r || sx > cw + r || sy > ch + r) continue;
    let c = p.dark ? [72, 67, 64] : p.big ? [230, 230, 228] : [170, 170, 168];
    const heat = p.hot && age < 0.2 ? (1 - age / 0.2) * p.hot : 0;       // fresh exhaust still glows
    if (heat) c = [lerp(c[0], 255, heat), lerp(c[1], 185, heat), lerp(c[2], 90, heat)];
    const a = (p.dark ? 0.6 : p.big ? 0.5 : 0.5) * Math.pow(1 - age, 1.3) * Math.min(1, age * 12 + 0.4);
    ctx.beginPath(); ctx.arc(sx + Math.sin(p.seed + age * 4) * ks * age * 3, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; ctx.fill();
  }
  for (const m of game.missiles) {
    const Wp = CFG.weapons[m.w], big = m.w === 'missile';
    const mt = Math.min(1, m.t + lead / m.dur);       // its flight carried on past the last sim step, so it glides
    const at = e => { const f = flight(m, e), [sx, sy] = toScreen(f.x, f.y); return [sx, sy - liftPx(f.s, f.H), sx, sy, f.s]; };
    const [hx, hy, gx, gy, s] = at(mt), [px, py] = at(Math.max(0, mt - 0.01)), [qx, qy] = at(Math.min(1, mt + 0.01));
    const ang = Math.atan2(qy - py, qx - px);
    const k = clamp(z / 9, 0.75, 2.4) * (big ? 1 : 0.8) * (1 + 0.4 * s);   // it looms larger high up, nearer the eye
    // where it will land: a ring that fills in as it comes down, flashing in the last moments
    const [tx, ty] = toScreen(m.x1, m.y1), rr = Math.max(7, Wp.radius * z), foe = m.ai >= 0;
    const blink = mt > 0.8 && Math.floor(game.time * 8) % 2 === 0;
    ctx.lineWidth = blink ? 2.5 : 1.5; ctx.strokeStyle = foe ? 'rgba(255,90,70,0.95)' : 'rgba(255,122,107,0.7)';
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(tx, ty, rr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(tx, ty, rr * mt, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,90,70,${0.08 + 0.17 * mt})`; ctx.fill();
    // its shadow on the ground under it: small and faint while it's high up
    ctx.beginPath(); ctx.ellipse(gx, gy, 5 * k * (1 - 0.5 * s), 2.5 * k * (1 - 0.5 * s), 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.32 * (1 - 0.55 * s)})`; ctx.fill();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ang); ctx.scale(k, k);
    if (big) {
      const boost = mt < 0.3 ? 1.6 - mt * 2 : 1;      // it burns hardest climbing out of the silo
      const fl = (7 + Math.random() * 6) * boost;     // the flame flickers
      ctx.beginPath(); ctx.arc(-9, 0, 5 * boost, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,170,60,0.3)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, -2.6); ctx.lineTo(-8 - fl, 0); ctx.lineTo(-8, 2.6); ctx.closePath(); ctx.fillStyle = '#ff9a3c'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, -1.4); ctx.lineTo(-8 - fl * 0.55, 0); ctx.lineTo(-8, 1.4); ctx.closePath(); ctx.fillStyle = '#fff3b0'; ctx.fill();
      ctx.fillStyle = '#59616b';                       // fins
      ctx.beginPath(); ctx.moveTo(-8, -2.4); ctx.lineTo(-10.5, -5.5); ctx.lineTo(-4.5, -2.4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, 2.4); ctx.lineTo(-10.5, 5.5); ctx.lineTo(-4.5, 2.4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eef1f3'; ctx.fillRect(-8, -2.4, 13, 4.8);
      ctx.fillStyle = m.ai >= 0 ? game.nations[m.ai].hex : '#2f7de1'; ctx.fillRect(-3, -2.4, 3, 4.8);   // a band in its owner's colour
      ctx.beginPath(); ctx.moveTo(5, -2.4); ctx.quadraticCurveTo(10.5, -1.6, 11.5, 0); ctx.quadraticCurveTo(10.5, 1.6, 5, 2.4); ctx.closePath(); ctx.fillStyle = '#d64045'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,36,44,0.7)'; ctx.lineWidth = 0.6; ctx.strokeRect(-8, -2.4, 13, 4.8);
    } else {                                         // a finned mortar bomb, nose first
      ctx.fillStyle = '#3a4048';
      ctx.beginPath(); ctx.moveTo(-3, -1); ctx.lineTo(-6.5, -2.8); ctx.lineTo(-6.5, 2.8); ctx.lineTo(-3, 1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.6, 0, 4, 2.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#2b3038'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(1.4, -0.9, 1.8, 0.8, 0, 0, Math.PI * 2); ctx.fillStyle = '#8d969e'; ctx.fill();
    }
    ctx.restore();
  }
  // explosions: a flash, a fireball, a shockwave ring, sparks, then smoke that hangs and rises
  for (const b of game.blasts) {
    const [sx, sy] = lifted(b.x, b.y, b.air, z), r0 = Math.max(b.big ? 16 : 9, (b.R + 1) * z);
    const fx = FX[b.air ? 'blastA' : b.big ? 'blastM' : 'blastS'];
    if (fx) {                                      // the pixel strip: flash, fireball, smoke, one frame per slice of its life
      const secs = b.t * b.life;
      if (!b.air) {
        if (secs < 0.5) {                          // the ground lit up round it
          const gl = r0 * (b.big ? 3.2 : 2.2), g = ctx.createRadialGradient(sx, sy, 0, sx, sy, gl);
          g.addColorStop(0, `rgba(255,200,110,${0.55 * (1 - secs / 0.5) ** 2})`); g.addColorStop(1, 'rgba(255,140,60,0)');
          ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sx, sy, gl, 0, Math.PI * 2); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }
        const te = Math.min(1, secs / (b.big ? 0.7 : 0.45));
        if (te < 1) {                              // a shockwave racing out over the ground
          const rw = r0 * (0.4 + (b.big ? 2.8 : 1.8) * (1 - (1 - te) ** 3));
          ctx.beginPath(); ctx.ellipse(sx, sy, rw, rw * 0.8, 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,245,225,${0.75 * (1 - te)})`; ctx.lineWidth = (b.big ? 5 : 3) * (1 - te) + 0.5; ctx.stroke();
        }
      }
      drawFx(fx, Math.min(fx.frames - 1, Math.floor(b.t * fx.frames)), sx, sy, r0 * (b.air ? 1.9 : 2.5), 0.56);
      if (b.debris) {                              // dirt, stones and embers thrown up and falling back
        const px = Math.max(2, Math.round(z * 0.14)) * (b.big ? 1.4 : 1);
        for (let j = 0; j < (b.big ? 18 : 9); j++) {
          const T = 0.45 + hash2(b.seed, j, 81) * 0.5;            // how long this bit is in the air
          if (secs > T) continue;
          const e = secs / T, a = hash2(b.seed, j, 82) * Math.PI * 2, d = r0 * (b.big ? 1.6 : 1.1) * (0.4 + hash2(b.seed, j, 83)) * e;
          const up = r0 * (b.big ? 1.5 : 1) * (0.5 + hash2(b.seed, j, 84)) * 4 * e * (1 - e);
          const ember = hash2(b.seed, j, 85) < 0.35;
          ctx.fillStyle = ember ? `rgba(255,${170 + j * 5},70,${1 - e * 0.6})` : j % 2 ? '#4a3a2c' : '#6b6359';
          ctx.fillRect(sx + Math.cos(a) * d - px / 2, sy + Math.sin(a) * d * 0.7 - up - px / 2, px, px);
        }
      }
      continue;
    }
    const tf = Math.min(1, b.t * 2.2), ease = 1 - (1 - tf) * (1 - tf);     // the fire is over in under half the blast's life
    for (let j = 0; j < (b.big ? 7 : 4); j++) {                           // smoke
      const a = hash2(b.seed, j, 61) * Math.PI * 2, d = hash2(b.seed, j, 62) * r0 * 0.6;
      const qx = sx + Math.cos(a) * d * (0.5 + b.t), qy = sy + Math.sin(a) * d * 0.6 - b.t * r0 * (0.5 + hash2(b.seed, j, 63) * 0.5);
      ctx.beginPath(); ctx.arc(qx, qy, r0 * (0.22 + b.t * 0.35), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${60 + j * 9},${58 + j * 9},${58 + j * 9},${0.5 * Math.pow(1 - b.t, 1.4)})`; ctx.fill();
    }
    if (tf < 1) {
      const fr = r0 * (0.35 + 0.75 * ease), g = ctx.createRadialGradient(sx, sy, 0, sx, sy, fr);
      g.addColorStop(0, `rgba(255,250,220,${1 - tf})`);
      g.addColorStop(0.35, `rgba(255,170,50,${0.9 * (1 - tf)})`);
      g.addColorStop(0.75, `rgba(215,70,25,${0.6 * (1 - tf)})`);
      g.addColorStop(1, 'rgba(90,20,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, fr, 0, Math.PI * 2); ctx.fill();
      ctx.lineCap = 'round';
      for (let j = 0; j < (b.big ? 14 : 7); j++) {                         // sparks flying outward
        const a = hash2(b.seed, j, 64) * Math.PI * 2, v = 0.7 + hash2(b.seed, j, 65) * 0.9;
        const d0 = r0 * ease * v * 0.9, d1 = r0 * ease * v * 1.25;
        ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * d0, sy + Math.sin(a) * d0 * 0.8); ctx.lineTo(sx + Math.cos(a) * d1, sy + Math.sin(a) * d1 * 0.8);
        ctx.strokeStyle = `rgba(255,${200 + j * 3},120,${1 - tf})`; ctx.lineWidth = b.big ? 2.2 : 1.5; ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.ellipse(sx, sy, r0 * (0.3 + 1.5 * ease), r0 * (0.3 + 1.5 * ease) * 0.8, 0, 0, Math.PI * 2);   // shockwave
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - tf)})`; ctx.lineWidth = (b.big ? 5 : 3) * (1 - tf) + 0.5; ctx.stroke();
    }
    if (b.t < 0.07) { ctx.beginPath(); ctx.arc(sx, sy, r0 * 1.3, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - b.t / 0.07)})`; ctx.fill(); }
  }
}

function drawBuildPreview(z) {
  if (!game.tool || !mouse.in) return;
  const t = hoverTile();
  if (!t) return;
  const type = game.tool;
  const box = (i, ok) => {
    const [sx, sy] = toScreen(i % W, (i / W) | 0);
    ctx.fillStyle = ok ? 'rgba(123,211,137,0.3)' : 'rgba(255,122,107,0.3)'; ctx.fillRect(sx, sy, z, z);
    ctx.strokeStyle = ok ? '#7bd389' : '#ff7a6b'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, z, z);
  };
  if (type === 'bridge') {                         // the start you picked, and the span to where you're aiming
    const st = game.bridgeStart;
    if (st == null) return box(t.i, !!owner[t.i]);
    const p = bridgePlan(st, t.i), C = p.s != null && owner[p.s] ? countryAt(p.s) : null;
    const ok = !p.why && C && !missingFor(p.cost, C);
    box(st, true);
    if (p.b >= 0 && p.b != null) { drawBridge(p.s, p.b, z, ok ? '#7bd389' : '#ff7a6b'); box(p.b, ok); }
    else if (p.tiles && p.tiles.length) drawBridge(p.s, p.tiles[p.tiles.length - 1], z, '#ff7a6b');
    return;
  }
  if (type === 'settlement') {
    const u = upgradeTargetAt(t.i);
    if (u) {
      const step = upgradeStep(cityLevel(u)), [sx, sy] = toScreen(...tileCenter(u.i)), ok = !!step && !missingFor(step.cost, countryAt(u.i));
      const r = Math.max(14, z * 3.2) * (1 + 0.06 * Math.sin(game.time * 6));
      ctx.setLineDash([6, 5]); ctx.lineWidth = 3; ctx.strokeStyle = ok ? '#8fd3ff' : '#ff7a6b';
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      pill(sx, sy - r - 12, step ? `Upgrade to ${levelDef(cityLevel(u) + 1).name}` : `${cityName(u)}: as big as it gets`, { fg: ok ? '#8fd3ff' : '#ff7a6b', border: ok ? '#8fd3ff' : '#ff7a6b', size: 12 });
      return;
    }
  }
  const plan = planFor(t.i, type);
  const ok = !canBuild(t.i, type) && !missingFor(totalCost(type, plan, t.i), countryAt(t.i) || activeCountry());
  if (plan && plan.path) strokeRoute(plan.path, type === 'station' ? 'rail' : 'sea', z, true);
  if (type === 'settlement') drawReachPreview(t.i, z);
  if (HARVESTS[type]) drawHarvestPreview(t.i, type, z);
  if (type === 'mortar') reachRing(t.i, '#7bd389', z, [4, 5], CFG.weapons.shell.range);
  if (type === 'turret') reachRing(t.i, '#7bd389', z, [4, 5], CFG.turret.range);
  if (CFG.buildings[type].defense) {              // what it would cover, and what your other air defenses already do
    unionRings(game.buildings.filter(b => b.type === 'airdef' && owner[b.i]).map(b => ringAt(b.i, CFG.airDefense.range, z)),
      { color: 'rgba(255,255,255,0.3)', dash: [3, 7] });
    reachRing(t.i, '#7bd389', z, [6, 5], CFG.airDefense.range);
  }
  const [sx, sy] = toScreen(t.x, t.y);
  ctx.fillStyle = ok ? 'rgba(123,211,137,0.3)' : 'rgba(255,122,107,0.3)';
  ctx.fillRect(sx, sy, z, z);
  ctx.strokeStyle = ok ? '#7bd389' : '#ff7a6b'; ctx.lineWidth = 2;
  ctx.strokeRect(sx, sy, z, z);
  if (z >= CFG.cityZoom) drawSprite(type, t.x + 0.5, t.y + 0.5, z * 1.3, 0.6);
}

// ======================================================================
// main loop
// ======================================================================
// How far (seconds) the picture runs ahead of the last sim step; 0 except while a frame is drawn (see frame()).
let lead = 0;
// where an expedition is on screen: carried on from its last step by its own speed, so it glides between steps
function shownPos(e) {
  if (!lead || e.done) return [e.x, e.y];
  if (e.auto) {
    const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy), s = Math.min(d, CFG.expeditionSpeed * lead);
    return d > 0 ? [e.x + dx / d * s, e.y + dy / d * s] : [e.x, e.y];
  }
  return [e.x + (e.vx || 0) * lead, e.y + (e.vy || 0) * lead];
}

function init() {
  resize();
  window.addEventListener('resize', resize);
  // let the "Generating world" screen paint before the heavy work starts
  setTimeout(start, 40);
}

function start() {
  const t0 = performance.now();
  generateWorld();
  paintTerrain();
  paintMoon();
  paintSun();
  paintVulcan();
  for (const b of Object.values(BODY)) b.paint(b);
  makeStars();
  iconFill();
  cam.x = spawn.x + 0.5; cam.y = spawn.y + 0.5;
  if (RESUME) {
    try { loadGame(RESUME); }
    catch (e) {                                     // a save from an incompatible version: drop it and start this map fresh
      console.warn('Could not load the save; starting fresh', e);
      noSave = true;
      try { localStorage.removeItem(SAVE_KEY); } catch (e2) { /* storage blocked */ }
      location.reload();
      return;
    }
  }
  buildMenu();
  bindTouchButtons();
  checkUnlocks(true);
  renderNewBadges();
  // autosave every 10 s, in a moment the browser has nothing else to do (not in the middle of a frame)
  setInterval(() => (window.requestIdleCallback ? requestIdleCallback(saveGame, { timeout: 2000 }) : saveGame()), 10000);
  if (params.has('bot')) {                         // ?bot: a simple AI plays your side (prototype/bot.js), for playtesting
    const sc = document.createElement('script');
    sc.src = 'bot.js?v=3';
    document.body.appendChild(sc);
  }
  window.addEventListener('beforeunload', saveGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
  window.__game.genMs = Math.round(performance.now() - t0);
  const ld = $('loading');
  if (ld) ld.remove();
  if (RESUME && !noSave) toast(`Welcome back: game loaded (seed ${SEED}, ${fmtTime(game.time)} played). It autosaves every 10 s; ${say('N starts a new map', 'New map is in the Build menu')}.`);
  else toast(`Map seed ${SEED} · this seed's far planet: ${SEED_PLANET.name}, a ${SEED_PLANET.kind === 'gas' ? 'gas giant' : 'rocky world'}${say(' (press G to visit)', '')}`);

  const step = 1 / CFG.tickHz;
  let last = performance.now(), acc = 0, hudT = 0;
  function frame(now) {
    // ask for the next frame first: a bug in one frame must never stop the game for good
    requestAnimationFrame(frame);
    try { frameBody(now); } catch (err) { reportError(err); }
  }
  function frameBody(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    // catch up at most 3 steps a frame: a slow phone that can't keep up runs the game a little slower,
    // instead of piling up more and more steps each frame until it freezes
    for (let n = 0; acc >= step && n < 3; n++) { acc -= step; tick(step); }
    if (acc > step) acc = step;
    // The sim steps 20 times a second, the screen 60+. Draw the world `lead` seconds past the last step
    // (game.time moved forward just for the drawing), so the sun, moon, planets, trucks and trains glide
    // instead of hopping 20 times a second. Ticks never see this: game.time goes back right after.
    const simTime = game.time;
    lead = acc; game.time = simTime + lead;
    try {
      panKeys(dt);
      stepCamAnim(dt);
      stepZoom(dt);
      applyFollow();
      render();
    } finally { game.time = simTime; lead = 0; }
    hudT += dt;
    // touch buttons first: they read the layout, which is only clean before the HUD writes into the page
    if (hudT > 0.1) { if (TOUCH) updateTouchButtons(); updateHud(); updateInspect(); hudT = 0; }
  }
  requestAnimationFrame(frame);
}

// handy for debugging/testing in the browser console
window.__game = { TOUCH, DISK, makeStation, orbitOf, inspect, pickAt, updateInspect, touchTap, mouse, nextVehicle, game, cam, CFG, SEED, tick, updateHud, liveCountry, countryAt, activeCountry, nearestCountryTo, countryOf, isUnlocked, toggleBuildMenu, startPush, SEED_PLANET, planetRecipe, BODY, LOCK, followBody, genericPos, genericBiomeAt, moonPos, sunPos, vulcanPos, followVulcan, vulcanBiomeAt, vulcanBiome, followSun, followMoon, lockWorld, moonBiomeAt, moonBiome, applyFollow, toWorld, toScreen, tryBuild, launchExpedition, recomputeNetwork, idx, biome, owner, landmass, isCoastal, OCEAN, depositOf, deposits, canBuild, aiOf, nationAt, defenseAt, fireMissile, setAiming, explode, saveGame, SAVE_KEY, recomputeBuildings, building, buildingAt, freePeople, params, isHarvested, harvestGain, render, recomputeNetwork2: recomputeNetwork, aiTake, stepRaid, tryIntercept, gunStep, yourMortars, underFire, isMilitary, aiThink, aiFire, provoke, pickWeapon, launchShot, keys, settleExpedition, settleSite, takeWheel, settlementGain, settlementCap, settlementLevel, isServed, sideOf, stopSaving: () => { noSave = true; }, bridgePlan, bridgeClick, bridgeAt, setTool, clickAt, dispatchFreight, supplyWish, shortOf, askFor, placeBuilding, arrive, upgradeCity, upgradeStep, cityLevel, poweredShare, poweredHousing, upgradeTargetAt };
init();
