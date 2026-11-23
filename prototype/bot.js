/*
 * Playtest bot: a simple AI that plays your side, to see how the progression feels.
 *
 *   ?bot        watch it play live (one decision a second)
 *   MFBot.simulate(30)   from the console: fast-forward 30 game-minutes and return a report
 *
 * It plays like a sensible beginner: work every deposit it owns, found a settlement wherever
 * enough of its land has none in reach, push toward the nearest free deposit, send an expedition
 * to iron if it has none, link colonies by rail, then use what unlocks (burners, rigs, solar).
 */
(() => {
  const G = window.__game, g = G.game, CFG = G.CFG, W = 1000;
  const B = CFG.buildings;
  const RES = ['wood', 'stone', 'iron'];
  const afford = (C, cost, keep = 0) => Object.entries(cost).every(([r, n]) => C.res[r] - keep >= n);
  const alive = () => g.countries.filter(c => c.alive && c.tiles);
  const mine = (C, i) => G.owner[i] && G.liveCountry(G.countryOf[i]) === C;
  const isLand = i => G.biome[i] >= 1 && G.biome[i] <= 4;   // grass, desert, mountains, ice
  const cx = i => i % W, cy = i => (i / W) | 0;
  const dist = (i, x, y) => Math.hypot(cx(i) - x, cy(i) - y);

  // the best place for a new settlement: sample this country's land that no settlement reaches yet
  function settlementSite(C) {
    const [bx0, by0, bx1, by1] = C.box;
    let best = -1, bg = 0;
    for (let k = 0; k < 60; k++) {
      const x = bx0 + ((Math.random() * (bx1 - bx0 + 1)) | 0), y = by0 + ((Math.random() * (by1 - by0 + 1)) | 0), i = y * W + x;
      if (!mine(C, i) || G.isServed(i) || G.building[i] || G.depositOf[i] >= 0) continue;
      const g = G.settlementGain(i).gain;
      if (g > bg) { bg = g; best = i; }
    }
    return { i: best, gain: bg };
  }
  // free building spots in a country, nearest its centre first (keeps towns compact)
  function freeSpots(C, n = 6) {
    const out = [], x0 = Math.round(C.lx), y0 = Math.round(C.ly);
    for (let r = 0; r < 80 && out.length < n; r++) {      // rings outward from the centre
      for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= 1000) continue;
        const i = y * W + x;
        if (mine(C, i) && isLand(i) && !G.building[i] && G.depositOf[i] < 0) out.push(i);
      }
    }
    return out;
  }
  const owned = (C, type) => g.buildings.filter(b => b.type === type && mine(C, b.i));
  const tryB = (i, type) => { const n = g.buildings.length, t0 = owned(G.countryAt(i), type).length; G.tryBuild(i, type); return g.buildings.length > n || owned(G.countryAt(i), type).length > t0; };

  const report = { milestones: [], log: [], notes: [] };
  const mark = (what) => { if (!report.milestones.some(m => m.what === what)) report.milestones.push({ t: Math.round(g.time), what, pop: Math.round(g.population) }); };

  function stepCountry(C) {
    // 1) work every deposit we own part of
    const seen = new Set();
    for (const d of G.deposits) {
      // a collector wherever at least 4 of our tiles of this deposit have none in reach, on the unworked tile nearest its middle
      const free = d.tiles.filter(t => mine(C, t) && !G.isHarvested(t) && !G.building[t]);
      if (free.length < 4 || seen.has(d)) continue; seen.add(d);
      const mid = k => (k % W - d.cx) ** 2 + (((k / W) | 0) - d.cy) ** 2;
      const t = free.reduce((a, b) => (mid(a) <= mid(b) ? a : b));
      const type = d.type === 'forest' ? 'cabin' : 'camp';
      if (afford(C, B[type].cost) && tryB(t, type)) { if (d.type === 'iron') mark('first iron collector'); }
    }
    const mw = C.mw || { need: 0, max: 0 };
    // 2) power: a burner when short, solar when there's iron to spare
    if (G.isUnlocked('burner') && mw.need >= mw.max - 0.5 && owned(C, 'burner').length < 4 && afford(C, B.burner.cost, 10)) {
      const s = freeSpots(C, 1)[0]; if (s !== undefined && tryB(s, 'burner')) mark('first wood burner');
    }
    if (G.isUnlocked('solar') && mw.need > mw.max * 0.6 && afford(C, B.solar.cost, 20)) {
      for (const s of freeSpots(C, 3)) if (afford(C, B.solar.cost, 20)) { if (tryB(s, 'solar')) mark('first solar panel'); }
    }
    // 3) rigs: upgrade a collector when there's spare power
    if (G.isUnlocked('rig') && mw.max - mw.need >= 4 && afford(C, B.rig.cost, 10)) {
      const col = g.buildings.find(b => b.type === 'camp' && mine(C, b.i))
        || g.buildings.find(b => (b.type === 'camp' || b.type === 'cabin') && mine(C, b.i));
      if (col && tryB(col.i, 'rig')) mark('first mining rig');
    }
    // 4) a station in every country once there are two (they link themselves)
    if (alive().length > 1 && !owned(C, 'station').length && afford(C, B.station.cost, 0)) {
      const s = freeSpots(C, 1)[0]; if (s !== undefined && tryB(s, 'station') && g.links.length) mark('first rail link');
    }
    // 5) a new settlement wherever a good patch of land has none in reach
    const needStation = alive().length > 1 && alive().some(c => !owned(c, 'station').length);
    if (afford(C, B.settlement.cost, needStation ? 25 : 0) && G.freePeople(C) >= B.settlement.people + 10) {
      const site = settlementSite(C);
      if (site.gain >= 40 && tryB(site.i, 'settlement')) mark("first new settlement");
    }
    // 6) expand toward the nearest free deposit when there are people to spare
    const free = G.freePeople(C);
    if (free >= 40 && C.people >= C.cap * 0.9 && !g.pushes.some(p => G.liveCountry(p.country) === C)) {
      const rad = Math.sqrt(C.tiles / Math.PI);        // roughly how far the border is from the centre
      let best = null, bd = rad + 60;
      for (const d of G.deposits) {
        const i = d.tiles[0];
        if (G.owner[i] || G.aiOf[i]) continue;
        const dd = Math.hypot(d.cx - C.lx, d.cy - C.ly);
        if (dd < bd) { bd = dd; best = d; }
      }
      let tx = best ? Math.round(best.cx) : -1, ty = best ? Math.round(best.cy) : -1;
      for (let k = 0; k < 16 && tx < 0; k++) {         // no deposit nearby: any free land just past the border
        const a = Math.random() * Math.PI * 2, x = Math.round(C.lx + Math.cos(a) * (rad + 15)), y = Math.round(C.ly + Math.sin(a) * (rad + 15));
        if (x < 0 || y < 0 || x >= W || y >= 1000) continue;
        const i = y * W + x;
        if (isLand(i) && !G.owner[i] && !G.aiOf[i]) { tx = x; ty = y; }
      }
      if (tx < 0) return;
      g.sendPct = 50; G.startPush(tx, ty);
    }
  }

  // send an expedition to the nearest iron if the empire has none
  function maybeExpedition() {
    const home = alive().sort((a, b) => b.people - a.people)[0];
    if (!home || g.expeditions.length) return;
    const hasIron = g.buildings.some(b => G.owner[b.i] && b.work && b.work.iron > 0);
    if (hasIron || G.freePeople(home) < 40 || home.res.wood < 50 || home.res.stone < 50) return;
    let best = null, bd = Infinity;
    for (const d of G.deposits) {
      if (d.type !== 'iron') continue;
      const i = d.tiles[0];
      if (G.owner[i] || G.aiOf[i]) continue;
      const dd = Math.hypot(d.cx - home.lx, d.cy - home.ly);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (!best) return;
    g.active = home.id; g.sendPct = 25;
    const before = g.expeditions.length;
    G.launchExpedition(Math.round(best.cx), Math.round(best.cy), { auto: true });   // the bot does not drive
    if (g.expeditions.length > before) mark(`expedition to iron (${Math.round(bd)} tiles)`);
  }

  function step() {
    for (const C of alive()) stepCountry(C);
    maybeExpedition();
    for (const t of ['burner', 'rig', 'silo', 'solar']) if (G.isUnlocked(t)) mark(`unlocked ${B[t].name}`);
    for (const p of [150, 300, 500, 1000, 2000, 5000]) if (g.peakPop >= p) mark(`${p} people`);
    if (g.countries.filter(c => c.alive).length > 1) mark('second country');
  }

  function snapshot() {
    const cs = alive();
    const sum = f => Math.round(cs.reduce((a, c) => a + f(c), 0) * 10) / 10;
    return {
      min: Math.round(g.time / 60), pop: Math.round(g.population), cap: Math.round(sum(c => c.cap)), countries: cs.length,
      tiles: sum(c => c.tiles), wood: Math.round(sum(c => c.res.wood)), stone: Math.round(sum(c => c.res.stone)), iron: Math.round(sum(c => c.res.iron)),
      rate: RES.map(r => sum(c => (c.prod || {})[r] || 0)).join(' / '),
      power: `${sum(c => (c.mw || {}).need || 0)}/${sum(c => (c.mw || {}).max || 0)} MW`,
      // your settlements by level: hamlets / villages / towns / cities
      settlements: [0, 1, 2, 3].map(l => g.buildings.filter(b => b.type === 'settlement' && G.owner[b.i] && G.settlementLevel(b) === l).length).join('/'),
    };
  }

  // fast-forward `minutes` of game time with the bot deciding once a second
  function simulate(minutes) {
    G.stopSaving();
    const end = g.time + minutes * 60;
    let nextLog = Math.ceil(g.time / 60) * 60;
    while (g.time < end) {
      for (let k = 0; k < 20; k++) G.tick(0.05);
      step();
      if (g.time >= nextLog) { report.log.push(snapshot()); nextLog += 60; }
    }
    G.updateHud();
    return report;
  }

  // the same, in chunks, yielding to the browser between them (for long runs)
  async function simulateAsync(minutes, chunk = 1) {
    for (let m = 0; m < minutes; m += chunk) { simulate(Math.min(chunk, minutes - m)); await new Promise(r => setTimeout(r, 0)); }
    return report;
  }
  window.MFBot = { step, simulate, simulateAsync, report, snapshot };
  if (G.params.has('bot') && !G.params.has('botsim')) {
    setInterval(step, 1000);
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Bot is playing (remove ?bot from the address to play yourself)'; t.classList.add('show'); }
  }
})();
