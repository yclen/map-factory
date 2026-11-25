// The Biome Builder's loading screen (index.html #splash): a blue star with planets circling it, a progress bar that
// follows the art as it arrives, a line about what's loading ("Planting oak trees") and tips. It's in the page itself,
// so it shows before any script has loaded; builder.js drives it with step / art / done / fail.

const $ = id => document.getElementById(id);
const root = $('splash');

// what each picture is, for the line under the title (file names are <name>_v<N>.png)
const LINES = {
  // trees
  oak: 'Planting oak trees', oak2: 'Turning some oaks to autumn', birch: 'Planting birches', blossom: 'Blooming cherry trees',
  willow: 'Growing weeping willows', deadtree: 'Twisting dead trees', saguaro: 'Raising saguaros', palm: 'Planting palms',
  jungle: 'Growing the jungle canopy', acacia: 'Spreading acacias', pine: 'Planting pines', fir: 'Planting firs',
  snowpine: 'Dusting the pines with snow',
  // rocks
  boulder: 'Rolling in boulders', mossy: 'Growing moss on the boulders', sandrock: 'Weathering sandstone',
  redrock: 'Baking red rocks', snowrock: 'Snowing on the rocks', darkrock: 'Cooling volcanic rock',
  sulfrock: 'Crusting rocks with sulfur', iceblock: 'Carving glacier ice', columns: 'Cracking basalt into columns',
  // small things
  tuft: 'Growing grass tufts', flowers: 'Sprinkling wildflowers', bush: 'Growing shrubs', reeds: 'Planting reeds',
  cactus: 'Growing cacti', pebbles: 'Scattering pebbles', pebblesr: 'Scattering red pebbles',
  pebblesd: 'Scattering black pebbles', rock: 'Placing stones', rocksand: 'Placing sandstone', rockred: 'Placing red stones',
  rocksnow: 'Capping stones with snow', bones: 'Bleaching old bones', shell: 'Washing up seashells',
  driftwood: 'Washing up driftwood', icechunk: 'Breaking off ice chunks', spire: 'Sharpening volcanic spires',
  'deadtree-small': 'Withering dead shrubs', 'sulfrock-small': 'Crusting pebbles with sulfur',
  // ground
  grass: 'Rolling out the meadows', forestfloor: 'Dropping leaves on the forest floor', junglefloor: 'Soaking the jungle floor',
  mud: 'Stirring the swamp mud', drygrass: 'Drying the savanna grass', sand: 'Pouring the desert sand',
  dunes: 'Blowing the dunes into ripples', beachsand: 'Raking the beaches', redsand: 'Rusting the mesa sand',
  salt: 'Cracking the salt flats', tundra: 'Growing tundra moss', needles: 'Dropping pine needles', snow: 'Packing the snow',
  ice: 'Freezing the ice sheets', ash: 'Settling the ash', obsidian: 'Polishing the obsidian', basalt: 'Cooling the basalt',
  sulfur: 'Spreading the sulfur', regolith: 'Dusting the regolith', rust: 'Rusting the iron plains',
};
const TIPS = [
  'Click a slice of the mix planet to design that biome.',
  'Zoom right in to see the shadows and the ground relief.',
  'The hottest biomes circle closest to the blue star.',
  'Save sends a biome straight into the Galaxy demo.',
  'Shadows are shared by every biome: set them in the System tab.',
  'Every planet has an ocean in the middle. The Ocean slider changes its size.',
  'Size ref shows a 3 × 3 machine, to judge how big things look.',
];

const t0 = performance.now();
let shown = 0, lastLine = 0, tipAt = Math.floor(Math.random() * TIPS.length);

function set(p) {
  shown = Math.max(shown, Math.min(1, p));
  $('splashFill').style.width = (shown * 100).toFixed(1) + '%';
  $('splashPct').textContent = Math.floor(shown * 100) + '%';
}
// the line under the title, changed at most every ~0.4 s so a burst of pictures doesn't flicker it
function line(text, now = false) {
  const t = performance.now();
  if (!now && t - lastLine < 380) return;
  lastLine = t;
  $('splashLine').textContent = text;
}
function nextTip() {
  const el = $('splashTip');
  el.classList.add('out');
  setTimeout(() => { tipAt = (tipAt + 1) % TIPS.length; el.textContent = 'Tip: ' + TIPS[tipAt]; el.classList.remove('out'); }, 300);
}
$('splashTip').textContent = 'Tip: ' + TIPS[tipAt];
const tipTimer = setInterval(nextTip, 4200);

export const splash = {
  // a stage of starting up, and how far along it puts the bar (0..1)
  step(text, p) { line(text + '…', true); set(p); $('splashDetail').textContent = ''; },
  // one more picture loaded: the art is the bar's 5%..90%
  art(n, total, label) {
    set(0.05 + 0.85 * n / total);
    $('splashDetail').textContent = `${n} / ${total} pictures`;
    const name = String(label).replace(/\.(png|webp)$/, '').replace(/_v\d+$/, '');
    line((LINES[name] || `Unpacking ${name}`) + '…');
  },
  // all ready: fill the bar, then fade away (shown for at least a moment, so it doesn't just flash)
  async done() {
    set(1);
    line('Ready', true);
    $('splashDetail').textContent = 'Welcome to the system';
    await new Promise(r => setTimeout(r, Math.max(350, 1100 - (performance.now() - t0))));
    clearInterval(tipTimer);
    root.classList.add('done');
    setTimeout(() => root.remove(), 800);
  },
  fail(message) {
    clearInterval(tipTimer);
    root.classList.add('failed');
    line(message, true);
    $('splashDetail').textContent = 'Reload the page to try again';
  },
};
