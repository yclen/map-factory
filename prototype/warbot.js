/*
 * Combat playtest bot: the economy bot (bot.js) plus a soldier's brain, to see how a war plays out.
 *
 *   open index.html?bot&botsim&seed=7, load this script, then from the console:
 *   await WarBot.run({ warAt: 600, warMin: 20, missiles: 'cities', push: true })   -> a report
 *
 * It builds the economy with bot.js, arms each country on the side facing the nearest nation (mortars and gun
 * turrets on that border, an air defense by its biggest settlement, a missile silo), declares war on that nation
 * once the empire reaches `warAt` people, then for `warMin` minutes fires missiles (at its cities, at its
 * weapons, or not at all) and, with `push`, sends soldiers into its land when it has people to spare.
 * It doesn't touch the game's rules: it watches every shot fly and land, and reads the blast labels to count
 * who killed whom.
 */
(() => {
  const G = window.__game, g = G.game, CFG = G.CFG, W = 1000, B = CFG.buildings;
  const alive = () => g.countries.filter(c => c.alive && c.tiles);
  const mine = (C, i) => G.owner[i] && G.liveCountry(G.countryOf[i]) === C;
  const afford = (C, cost, keep = 0) => Object.entries(cost).every(([r, n]) => C.res[r] - keep >= n);
  const ofType = (C, t) => g.buildings.filter(b => b.type === t && mine(C, b.i));
  const dist = (i, x, y) => Math.hypot(i % W - x, ((i / W) | 0) - y);
  const isLand = i => G.biome[i] >= 1 && G.biome[i] <= 4;
  const r1 = v => Math.round(v * 10) / 10;

  let S = null, foe = null, opts = {}, warOn = false, seen = new Set(), raidsSeen = new Set(), floatsSeen = new WeakSet();

  const fresh = () => ({
    fired: { you: { shell: 0, missile: 0 }, ai: { shell: 0, missile: 0 } },
    landed: { you: 0, ai: 0 }, shotDown: { you: 0, ai: 0 },          // shots by that side that landed / were shot down
    killedBy: { you: 0, ai: 0 },                                     // people killed by that side's bombs
    wreckedBy: { you: 0, ai: 0 },                                    // buildings destroyed by that side's bombs
    hitsOnCities: { you: 0, ai: 0 },                                 // shots by that side that hit a settlement
    raids: 0, raidSoldiers: 0, turretKills: { you: 0, ai: 0 },
    pushes: 0, pushSoldiers: 0, events: [],
  });

  // ---------- watching: shots, blasts, raids ----------
  function watchTick() {
    const now = new Set(g.missiles);
    for (const m of g.missiles) if (!seen.has(m)) { const side = m.ai < 0 ? 'you' : 'ai'; S.fired[side][m.w]++; }
    const landed = [];
    for (const m of seen) if (!now.has(m)) {
      const side = m.ai < 0 ? 'you' : 'ai';
      if (m.t >= 1) { S.landed[side]++; landed.push(m); }
      else S.shotDown[side]++;
      if (m.t >= 1) {
        const R = CFG.weapons[m.w].radius, cx = Math.floor(m.x1), cy = Math.floor(m.y1);
        let city = false;
        for (let dy = -Math.ceil(R); dy <= Math.ceil(R) && !city; dy++) for (let dx = -Math.ceil(R); dx <= Math.ceil(R); dx++) {
          const i = (cy + dy) * W + cx + dx, b = G.building[i] && G.buildingAt(i);
          if (b && b.type === 'settlement' && dx * dx + dy * dy <= R * R + 0.5) { city = true; break; }
        }
        if (city) S.hitsOnCities[side]++;
      }
    }
    seen = now;
    // blast labels ("12 killed · 1 building destroyed") and turret labels ("-6")
    for (const f of g.floats) {
      if (floatsSeen.has(f)) continue;
      floatsSeen.add(f);
      const t = f.text;
      const blast = landed.find(m => Math.abs(m.x1 - f.x) < 0.01);
      if (blast) {
        const side = blast.ai < 0 ? 'you' : 'ai';
        const k1 = /(\d+) killed/.exec(t), k2 = /(\d+) buildings? destroyed/.exec(t);
        if (k1) S.killedBy[side] += +k1[1];
        if (k2) S.wreckedBy[side] += +k2[1];
      } else if (/^-\d+$/.test(t)) S.turretKills[f.color === '#7bd389' ? 'you' : 'ai'] += -t;
    }
    for (const r of g.raids) if (!raidsSeen.has(r)) { raidsSeen.add(r); S.raids++; S.raidSoldiers += r.budget; }
  }

  // ---------- the soldier's brain, once a second ----------
  // the nation to fight: the one nearest your biggest country
  function pickFoe() {
    const home = alive().sort((a, b) => b.people - a.people)[0];
    let best = null, bd = Infinity;
    for (const n of g.nations) { if (!n.alive) continue; const d = Math.hypot(n.lx - home.lx, n.ly - home.ly); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  // a free building spot in C, near the side facing the foe: among its tiles nearest the foe, a few in from the edge
  function spotToward(C, x, y, inward = 3) {
    const [bx0, by0, bx1, by1] = C.box, cands = [];
    for (let k = 0; k < 500; k++) {
      const tx = bx0 + ((Math.random() * (bx1 - bx0 + 1)) | 0), ty = by0 + ((Math.random() * (by1 - by0 + 1)) | 0), i = ty * W + tx;
      if (!mine(C, i) || !isLand(i) || G.building[i] || G.depositOf[i] >= 0) continue;
      let edge = false;                                  // stay `inward` tiles inside the border
      for (const [dx, dy] of [[inward, 0], [-inward, 0], [0, inward], [0, -inward]]) if (!mine(C, i + dy * W + dx)) edge = true;
      if (!edge) cands.push({ i, d: Math.hypot(tx - x, ty - y) });
    }
    cands.sort((a, b) => a.d - b.d);
    return cands.length ? cands[0].i : -1;
  }
  const build = (C, type, i) => { if (i < 0) return false; const n = g.buildings.length; G.tryBuild(i, type); return g.buildings.length > n; };

  function arm(C) {
    if (!foe || !foe.alive) return;
    const fx = foe.lx, fy = foe.ly, [bx0, by0, bx1, by1] = C.box;    // how far its land reaches toward the foe
    const near = Math.hypot(fx - Math.max(bx0, Math.min(bx1, fx)), fy - Math.max(by0, Math.min(by1, fy))) < 150;
    if (!near) return;
    const keep = 15;
    const want = [['mortar', 3], ['turret', 3], ['silo', 1], ['airdef', 1]];
    for (const [t, max] of want) {
      if (!G.isUnlocked(t) || ofType(C, t).length >= max || !afford(C, B[t].cost, keep)) continue;
      let i;
      if (t === 'airdef') {                            // by its biggest settlement
        const town = ofType(C, 'settlement').sort((a, b) => G.settlementCap(b) - G.settlementCap(a))[0];
        i = town ? spotToward(C, town.i % W, (town.i / W) | 0, 1) : -1;
      } else i = spotToward(C, fx, fy, t === 'turret' ? 2 : t === 'silo' ? 8 : 4);
      if (build(C, t, i)) S.events.push(`${min()} built ${t} in ${C.short}`);
    }
  }

  function fight() {
    if (!warOn || !foe || !foe.alive) return;
    // missiles: whichever silo is loaded and in range fires
    if (opts.missiles !== 'none') {
      const silo = g.buildings.find(b => b.type === 'silo' && G.owner[b.i] && (b.ready || 0) <= g.time);
      const C = silo && G.countryAt(silo.i);
      if (C && C.res.iron >= 60 + 25 && C.res.wood >= 10) {
        const sx = silo.i % W, sy = (silo.i / W) | 0, R = CFG.weapons.missile.range;
        const theirs = g.buildings.filter(b => G.aiOf[b.i] === foe.id + 1 && dist(b.i, sx, sy) <= R);
        let tgt = null;
        if (opts.missiles === 'cities') {
          // the settlement with the most people living there
          tgt = theirs.filter(b => b.type === 'settlement').sort((a, b) => G.settlementCap(b) - G.settlementCap(a))[0];
        } else {
          tgt = theirs.filter(b => G.isMilitary(b)).sort((a, b) => dist(a.i, sx, sy) - dist(b.i, sx, sy))[0];
        }
        if (tgt) G.fireMissile(tgt.i % W, (tgt.i / W) | 0);
      }
    }
    // soldiers: push into its land toward its nearest settlement when there are people to spare
    if (opts.push) for (const C of alive()) {
      if (g.pushes.some(p => p.war && G.liveCountry(p.country) === C)) continue;   // one war push at a time (the economy bot runs its own)
      if (G.freePeople(C) < 60 || C.people < C.cap * 0.8) continue;
      const [bx0, by0, bx1, by1] = C.box;              // distance from its land, not its middle
      const reach = i => { const x = i % W, y = (i / W) | 0; return Math.hypot(x - Math.max(bx0, Math.min(bx1, x)), y - Math.max(by0, Math.min(by1, y))); };
      const towns = g.buildings.filter(b => b.type === 'settlement' && G.aiOf[b.i] === foe.id + 1).sort((a, b) => reach(a.i) - reach(b.i));
      if (!towns.length || reach(towns[0].i) > 60) continue;
      const before = g.pushes.length;
      g.sendPct = 50; G.startPush(towns[0].i % W, (towns[0].i / W) | 0);
      if (g.pushes.length > before) { const p = g.pushes[g.pushes.length - 1]; p.war = true; S.pushes++; S.pushSoldiers += p.budget; }
    }
  }

  const min = () => `${Math.floor(g.time / 60)}:${String(Math.floor(g.time % 60)).padStart(2, '0')}`;
  const weaponsOf = side => g.buildings.filter(b => (side === 'you' ? G.owner[b.i] : G.aiOf[b.i] === foe.id + 1) && G.isMilitary(b)).length;
  function snapshot() {
    const cs = alive(), sum = f => cs.reduce((a, c) => a + f(c), 0);
    const myTowns = g.buildings.filter(b => b.type === 'settlement' && G.owner[b.i]);
    const foeTowns = foe ? g.buildings.filter(b => b.type === 'settlement' && G.aiOf[b.i] === foe.id + 1) : [];
    return {
      t: min(), war: warOn,
      you: { pop: Math.round(sum(c => c.people)), cap: Math.round(sum(c => c.cap)), tiles: sum(c => c.tiles), countries: cs.length,
             iron: Math.round(sum(c => c.res.iron)), towns: myTowns.length, underFire: myTowns.filter(G.underFire).length, weapons: weaponsOf('you') },
      foe: foe ? { name: foe.short, alive: foe.alive, pop: Math.round(foe.people), cap: Math.round(foe.cap), tiles: foe.tiles, iron: Math.round(foe.iron || 0),
                   towns: foeTowns.length, underFire: foeTowns.filter(G.underFire).length, weapons: weaponsOf('ai'), hostile: !!foe.hostile } : null,
      hostileNations: g.nations.filter(n => n.alive && n.hostile).length,
    };
  }

  // ---------- running it ----------
  function tick() { G.tick(0.05); watchTick(); }
  function second() {
    for (let k = 0; k < 20; k++) tick();
    window.MFBot.step();
    if (!foe || !foe.alive) foe = pickFoe();
    for (const C of alive()) arm(C);
    if (!warOn && g.peakPop >= opts.warAt) {
      warOn = true; S.warStart = g.time; G.provoke(foe);
      S.events.push(`${min()} declared war on ${foe.short} (${Math.round(foe.people)} people, ${foe.tiles} tiles)`);
    }
    fight();
  }
  let nextLog = 0, finished = false, t0 = 0;
  function start(o = {}) {
    opts = Object.assign({ warAt: 600, warMin: 20, maxSetupMin: 40, missiles: 'cities', push: true }, o);
    G.stopSaving();
    S = fresh(); S.opts = opts; S.log = []; warOn = false; foe = null; finished = false;
    seen = new Set(g.missiles); floatsSeen = new WeakSet(g.floats); raidsSeen = new Set(g.raids);
    nextLog = Math.ceil(g.time / 60) * 60; t0 = performance.now();
  }
  // run up to `secs` game-seconds without yielding (a hidden page throttles timers, so drive it in calls)
  function advance(secs) {
    const until = g.time + secs;
    while (!finished && g.time < until) {
      second();
      if (g.time >= nextLog) { S.log.push(snapshot()); nextLog += 60; }
      if (!alive().length) { S.events.push(`${min()} you lost: no country left`); finished = true; }
      else if (!warOn && g.time > opts.maxSetupMin * 60) { S.events.push(`${min()} never reached ${opts.warAt} people`); finished = true; }
      else if (warOn && g.time >= S.warStart + opts.warMin * 60) finished = true;
      else if (warOn && foe && !foe.alive) { S.events.push(`${min()} conquered ${foe.short}`); finished = true; }
    }
    if (finished && !S.end) {
      S.end = snapshot(); S.realSec = r1((performance.now() - t0) / 1000);
      S.raidSoldiers = Math.round(S.raidSoldiers); S.pushSoldiers = Math.round(S.pushSoldiers);
      for (const s of ['you', 'ai']) S.turretKills[s] = Math.round(S.turretKills[s]);
    }
    return { done: finished, t: min() };
  }
  async function run(o = {}) {
    start(o);
    while (!advance(30).done) await new Promise(r => setTimeout(r, 0));
    return S;
  }
  window.WarBot = { start, advance, run, snapshot, get stats() { return S; }, get foe() { return foe; } };
})();
