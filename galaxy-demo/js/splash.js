// The Galaxy demo's loading screen (index.html #splash): "Map Conquest", a turning spiral galaxy, a progress bar that
// follows the art as it arrives, a line about what's loading and tips. It's in the page itself, so it shows before any
// script has loaded; main.js drives it with step / expect / loaded / done / fail. Like the Biome Builder's
// (biome-builder/splash.js). A page without it (an old cached copy) just gets no loading screen.

const $ = id => document.getElementById(id);
const root = $('splash');

// what each ground texture is, for the line under the title (texture files are <name>_v<N>.png)
const GROUND_LINES = {
  grass: 'Rolling out the meadows', forestfloor: 'Dropping leaves on the forest floor', junglefloor: 'Soaking the jungle floor',
  mud: 'Stirring the swamp mud', drygrass: 'Drying the savanna grass', sand: 'Pouring the desert sand',
  dunes: 'Blowing the dunes into ripples', beachsand: 'Raking the beaches', redsand: 'Rusting the mesa sand',
  salt: 'Cracking the salt flats', tundra: 'Growing tundra moss', needles: 'Dropping pine needles', snow: 'Packing the snow',
  ice: 'Freezing the ice sheets', ash: 'Settling the ash', obsidian: 'Polishing the obsidian', basalt: 'Cooling the basalt',
  sulfur: 'Spreading the sulfur', regolith: 'Dusting the regolith', rust: 'Rusting the iron plains', rock: 'Raising the mountains',
};
export const groundLine = texture => {
  const name = String(texture || '').replace(/\.(png|webp)$/, '').replace(/_v\d+$/, '');
  return GROUND_LINES[name] || `Unpacking ${name || 'the ground'}`;
};
const TIPS = [
  'Scroll or pinch to zoom. Zooming toward a planet locks onto it.',
  'Move the mouse near a planet or moon: a yellow ring marks it. Click to fly there.',
  'Rocket takes you to the launch pad at Home\'s North Pole.',
  'Press B to compare the blended biome borders with the old hard edges.',
  'Every star, planet and moon comes from one seed. Try ?seed=123 in the address.',
  'Scale opens sliders for the distance ladder, from Home\'s size to the nearest star.',
  'Press P for the stats panel: frame time, map chunks, memory.',
  'Biomes are designed in the Biome Builder and saved straight into this demo.',
];

const t0 = performance.now();
let shown = 0, lastLine = 0, tipAt = Math.floor(Math.random() * TIPS.length), expected = 0, arrived = 0, over = false, known = false;
let tipTimer = 0;
const lo = 0.12, hi = 0.82;                              // the art fills the bar from lo to hi; Home's first map the rest

function set(p) {
  if (!root) return;
  shown = Math.max(shown, Math.min(1, p));
  $('splashFill').style.width = (shown * 100).toFixed(1) + '%';
  $('splashPct').textContent = Math.floor(shown * 100) + '%';
}
// the line under the title, changed at most every ~0.4 s so a burst of pictures doesn't flicker it
function line(text, now = false) {
  if (!root) return;
  const t = performance.now();
  if (!now && t - lastLine < 380) return;
  lastLine = t;
  $('splashLine').textContent = text;
}
const detail = text => { if (root) $('splashDetail').textContent = text; };
if (root) {
  $('splashTip').textContent = 'Tip: ' + TIPS[tipAt];
  tipTimer = setInterval(() => {
    const el = $('splashTip');
    el.classList.add('out');
    setTimeout(() => { tipAt = (tipAt + 1) % TIPS.length; el.textContent = 'Tip: ' + TIPS[tipAt]; el.classList.remove('out'); }, 300);
  }, 4500);
  set(0.05);
}

export const splash = {
  get isDone() { return over; },
  // a stage of starting up, and how far along it puts the bar (0..1)
  step(text, p) { line(text + '…', true); if (p != null) set(p); },
  // n more pictures to wait for; all = that's the last of them (until then the bar holds, so it doesn't race ahead
  // while it doesn't yet know how many there are)
  expect(n, all = false) {
    expected += n; known = known || all;
    if (known) set(lo + (hi - lo) * arrived / Math.max(expected, arrived, 1));
    if (!over) detail(`${arrived} / ${expected} pictures`);
  },
  // one of them arrived, with what to say about it
  loaded(text) {
    arrived++;
    if (over) return;
    if (known) set(lo + (hi - lo) * arrived / Math.max(expected, arrived));
    detail(`${arrived} / ${Math.max(expected, arrived)} pictures`);
    if (text) line(text + '…');
  },
  // the last stretch: how far along Home's first map is (0..1)
  map(f) { set(hi + (0.98 - hi) * f); },
  // all ready: fill the bar, then fade away (shown for at least a moment, so it doesn't just flash)
  async done() {
    if (over || !root) return;
    over = true;
    set(1);
    line('Ready', true);
    detail('Welcome home');
    await new Promise(r => setTimeout(r, Math.max(300, 1200 - (performance.now() - t0))));
    clearInterval(tipTimer);
    root.classList.add('done');
    setTimeout(() => root.remove(), 900);
  },
  fail(message) {
    if (over || !root) return;
    over = true;
    clearInterval(tipTimer);
    root.classList.add('failed');
    line(message, true);
    detail('Reload the page to try again');
  },
};
