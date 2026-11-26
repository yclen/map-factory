'use strict';
/*
 * Shared worlds: play in the same world as your friends, each with an empire of your own, by sending them a link.
 * (Loaded before game.js. Nothing here runs until game.js calls NET.boot(), so it can use everything game.js sets up.)
 *
 * How it stays in step: every screen runs the same simulation, step for step. The host's screen keeps time: for each
 * sim step it sends out a numbered packet with the commands (clicks, keys) to apply before that step, its own and its
 * guests'. A guest runs exactly those steps with exactly those commands, so its world stays the same as the host's,
 * and the world itself only has to be sent once: a full copy when someone joins. Every 5 s the host adds a fingerprint
 * of its world; a guest whose fingerprint differs asks for a fresh copy. The sim's random numbers come from one
 * seeded generator kept in the shared state (game.rs), so every screen draws the same ones.
 *
 * Links: the host plays at ?seed=S&host=ROOM and sends friends ?seed=S&join=ROOM.
 * Connection: Trystero (peer-to-peer WebRTC; screens find each other through public Nostr relays, no server of ours).
 */
const NET = (() => {
  const Q = new URLSearchParams(location.search);
  const JOIN = Q.get('join'), HOST = Q.get('host');
  const PROTO = 1;                                 // bumped whenever the packets or the sim change in a way old screens can't follow
  const LIB = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
  const HASH_EVERY = 100;                          // sim steps between world fingerprints (5 s)
  const MAX_PLAYERS = 8;
  // The host's steps stopped coming (their tab closed, crashed or lost its connection): the world waits. If the same
  // host comes back, carry on; if they reopen the world (a new page), say hello to it and get a fresh copy.
  function loseHost() {
    welcomed = false; lostHost = true;
    style();
    hideOverlay();
    document.body.appendChild(el(`<div id="mp-ov"><div class="mp-card"><h2>Waiting for the host</h2><p>The world runs on the host's screen, and it has stopped (their game was closed or lost its connection). This page rejoins by itself when they open the world again.</p><div class="mp-st" id="mp-st"></div></div></div>`));
    if (room) for (const p of Object.keys(room.getPeers())) if (p !== hostPeer) sayHello(p);
  }
  const S = {
    on: !!JOIN,                                    // a guest is "on" from the start: its own world doesn't run, the host's does
    role: JOIN ? 'guest' : null, room: JOIN || null,
    T: 0,                                          // the last sim step run here
    act, frame, boot, host: startHosting, debug: {},
  };
  let room = null, tx = {};                        // the Trystero room and its actions
  // host
  let queued = [], inbox = [], joins = [], resyncs = [], out = [];
  const members = new Map();                       // peerId -> pid (guests who've joined)
  let tokens = {};                                 // a guest's token -> their pid (so they get their empire back)
  let nextPid = 0;                                 // (ids promised to guests whose join command hasn't run yet)
  // guest
  let hostPeer = null, inq = [], welcomed = false, snapT = -1, lastResync = -1e9, helloTimer = 0;
  let lastTickAt = 0, lostHost = false;            // (when the host's steps last came in; whether they've stopped)

  // ---------------------------------------------------------------- commands
  function act(cmd) {
    if (S.role === 'host') {                       // applied right away here, and sent out with the next step
      const r = applyCommand(ME, cmd);
      queued.push([ME, cmd]);
      return r;
    }
    if (welcomed && tx.cmd && hostPeer) tx.cmd.send(cmd, { target: hostPeer });
  }

  // ---------------------------------------------------------------- the frame loop (game.js calls this instead of ticking)
  function frame(acc, step) {
    if (S.role === 'host') {
      for (let n = 0; acc >= step && n < 3; n++) { acc -= step; hostStep(step); }
      if (out.length) { if (tx.ticks) tx.ticks.send(out); out = []; }
      return acc;
    }
    if (welcomed && performance.now() - lastTickAt > 9000) loseHost();
    if (!welcomed) return 0;
    feedSteer();
    // run the steps that have come in, at the game's own pace, catching up quickly when far behind
    let n = 0;
    while (inq.length && n < 80 && ((acc >= step && n < 3) || inq.length > 6)) {
      acc = Math.max(0, acc - step);
      guestStep(inq.shift().p, step);
      n++;
      if (!welcomed) break;                        // a fresh copy was asked for: wait for it
    }
    if (!inq.length && acc > step) acc = step;
    return acc;
  }
  function hostStep(step) {
    feedSteer();
    for (const [pid, cmd] of inbox) { applyCommand(pid, cmd); queued.push([pid, cmd]); }
    inbox = [];
    const sync = joins.length || resyncs.length;
    for (const j of joins) if (j.isNew) { const c = { t: 'join', name: j.name, col: j.col }; applyCommand(j.pid, c); queued.push([j.pid, c]); }
    const pkt = { T: ++S.T, c: queued };
    queued = [];
    simTick(step);
    if (sync) {                                    // everyone rebuilds their caches after this step, then the copies go out
      pkt.z = 1;
      resetSimCaches();
      const to = [...joins.map(j => [j.peer, j.pid]), ...resyncs.map(p => [p, members.get(p)])];
      joins = []; resyncs = [];
      sendSnap(to);
    }
    if (S.T % HASH_EVERY === 0) pkt.h = worldHash();
    out.push(pkt);
  }
  function guestStep(pkt, step) {
    for (const [pid, cmd] of pkt.c) applyCommand(pid, cmd);
    simTick(step);
    if (pkt.z) resetSimCaches();
    S.T = pkt.T;
    if (pkt.h != null) {
      const h = worldHash();
      if (h !== pkt.h) {
        console.warn(`Shared world: out of step at step ${pkt.T} (${h} here, ${pkt.h} at the host): asking for a fresh copy`);
        S.debug.desyncs = (S.debug.desyncs || 0) + 1;
        askResync();
      }
    }
  }
  function askResync() {
    if (performance.now() - lastResync < 4000) return;
    lastResync = performance.now();
    welcomed = false;
    status('Catching up with the host…');
    tx.resync.send(1, { target: hostPeer });
  }

  // ---------------------------------------------------------------- the world as a copy (snapshot)
  // Everything the sim reads that changes as it runs: the game object (but not this screen's own view of it), the
  // tile maps, the frontier and a few counters. Encoded as a graph, so things kept in two places stay one thing.
  const LOCAL = new Set(['active', 'sendPct', 'tool', 'bridgeStart', 'hotbar', 'barUsed', 'useTick', 'seenTech', 'aiming',
    'selection', 'driving', 'flying', 'savedAt', 'over', 'unlocked', 'peakPop', 'population']);
  const ARRAYS = () => ({ owner, countryOf, aiOf, building, bridgeAt, bridgeWide, bridgeEnd, depositOf });
  function snapRoots() {
    const g = {};
    for (const k of Object.keys(game)) if (!LOCAL.has(k)) g[k] = game[k];
    return { game: g, arr: ARRAYS(), frontier,
      vars: { rocketCount, stationCount, freightTimer, pushId, expeditionId, netTimer, landTimer, aiTimer, aiFireTimer, settleSid,
        landFullAt, capitalTile, spawn, landRoot } };
  }
  function applyRoots(R) {
    for (const k of Object.keys(game)) if (!LOCAL.has(k) && !(k in R.game)) delete game[k];
    for (const k of Object.keys(R.game)) game[k] = R.game[k];
    const A = ARRAYS();
    for (const k in R.arr) A[k].set(R.arr[k]);
    frontier.clear();
    for (const i of R.frontier) frontier.add(i);
    const V = R.vars;
    rocketCount = V.rocketCount; stationCount = V.stationCount; freightTimer = V.freightTimer; pushId = V.pushId;
    expeditionId = V.expeditionId; netTimer = V.netTimer; landTimer = V.landTimer; aiTimer = V.aiTimer; aiFireTimer = V.aiFireTimer;
    settleSid = V.settleSid; landFullAt = V.landFullAt; capitalTile = V.capitalTile; spawn = V.spawn; landRoot = V.landRoot;
    // this screen's own view: nothing driven or aimed, the HUD on one of its own countries, the land repainted
    game.driving = game.flying = null; game.aiming = false; game.over = false; game.bridgeStart = null; game.selection = [];
    fillLayer.img.data.fill(0); borderLayer.img.data.fill(0);
    for (let t = 0; t < N; t++) if (owner[t] || aiOf[t]) paintTerr(t);
    markDirty(fillLayer, 0, 0); markDirty(fillLayer, W - 1, H - 1); markDirty(borderLayer, 0, 0); markDirty(borderLayer, W - 1, H - 1);
    resetSimCaches();
  }
  function encode(v) {
    const ids = new Map();
    let next = 0;
    const walk = x => {
      if (x === null) return null;
      switch (typeof x) {
        case 'number': return Number.isFinite(x) ? (Object.is(x, -0) ? { $n: '-0' } : x) : { $n: String(x) };
        case 'string': case 'boolean': return x;
        case 'object': break;
        default: return { $u: 1 };                 // undefined (and functions, which the sim state shouldn't hold)
      }
      if (ids.has(x)) return { $r: ids.get(x) };
      const id = next++;
      ids.set(x, id);
      if (ArrayBuffer.isView(x)) return { $t: x.constructor.name, $i: id, v: rle(x) };
      if (Array.isArray(x)) return { $a: id, v: Array.from(x, walk) };
      if (x instanceof Set) return { $s: id, v: [...x].map(walk) };
      if (x instanceof Map) return { $m: id, v: [...x].map(([k, y]) => [walk(k), walk(y)]) };
      const o = {};
      for (const k of Object.keys(x)) o[k] = walk(x[k]);
      return { $o: id, v: o };
    };
    return walk(v);
  }
  function decode(root) {
    const refs = [];
    const walk = x => {
      if (x === null || typeof x !== 'object') return x;
      if ('$n' in x) return x.$n === '-0' ? -0 : Number(x.$n);
      if ('$u' in x) return undefined;
      if ('$r' in x) return refs[x.$r];
      if ('$t' in x) { const a = unrle(x.v, globalThis[x.$t]); refs[x.$i] = a; return a; }
      if ('$a' in x) { const a = []; refs[x.$a] = a; for (const e of x.v) a.push(walk(e)); return a; }
      if ('$s' in x) { const s = new Set(); refs[x.$s] = s; for (const e of x.v) s.add(walk(e)); return s; }
      if ('$m' in x) { const m = new Map(); refs[x.$m] = m; for (const [k, e] of x.v) m.set(walk(k), walk(e)); return m; }
      const o = {};
      refs[x.$o] = o;
      for (const k of Object.keys(x.v)) o[k] = walk(x.v[k]);
      return o;
    };
    return walk(root);
  }
  function rle(a) {                                // [value, run, value, run, ...]
    const r = [];
    let prev = a[0], n = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] === prev) { n++; continue; } r.push(prev, n); prev = a[i]; n = 1; }
    if (a.length) r.push(prev, n);
    return { n: a.length, r };
  }
  function unrle({ n, r }, Type) {
    const a = new Type(n);
    for (let k = 0, i = 0; k < r.length; k += 2) { a.fill(r[k], i, i + r[k + 1]); i += r[k + 1]; }
    return a;
  }
  async function gzip(str) { return new Uint8Array(await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
  async function gunzip(bytes) { return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
  // a packet of bytes: [4-byte header length][header JSON][gzipped world]
  function pack(head, body) {
    const h = new TextEncoder().encode(JSON.stringify(head)), out = new Uint8Array(4 + h.length + body.length);
    new DataView(out.buffer).setUint32(0, h.length);
    out.set(h, 4); out.set(body, 4 + h.length);
    return out;
  }
  function unpack(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), n = new DataView(b.buffer, b.byteOffset).getUint32(0);
    return [JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + n))), b.subarray(4 + n)];
  }
  function snapshotText() { return JSON.stringify(encode(snapRoots())); }   // (taken right now; sent later)
  function sendSnap(to) {
    if (!to.length) return;
    const T = S.T, text = snapshotText();
    gzip(text).then(body => {
      for (const [peer, pid] of to) if (peer && pid != null) tx.snap.send(pack({ T, pid, v: PROTO }, body), { target: peer });
      S.debug.lastSnap = { T, raw: text.length, gz: body.length };
    });
  }
  async function takeSnap(bytes) {
    const [head, body] = unpack(bytes);
    if (head.v !== PROTO) return refuse('The host is on another version of the game. Reload both pages and try again.');
    const roots = decode(JSON.parse(await gunzip(body)));
    const first = !S.debug.joinedAt;
    ME = PID = head.pid;                            // this screen plays as its own player from now on
    applyRoots(roots);
    useSharedRandom();
    S.T = snapT = head.T;
    inq = inq.filter(e => e.peer === hostPeer && e.p.T > snapT);
    welcomed = true; lostHost = false; lastTickAt = performance.now();
    S.debug.joinedAt = S.debug.joinedAt || Date.now();
    hideOverlay();
    game.peakPop = peakOf(ME); game.unlocked = new Set(); checkUnlocks(true); renderNewBadges();
    const c = myCountries()[0];
    if (c) { game.active = c.id; if (first) { flyCam(c.lx, c.ly, CFG.startZoom); toast(`Welcome to the shared world! This is your empire: ${c.full}. Grow it your own way.`, { good: true }); } }
    renderPlayers();
  }

  // ---------------------------------------------------------------- the world's fingerprint
  const f64 = new Float64Array(1), f32 = new Uint32Array(f64.buffer);
  function worldHash() {
    let h = 2166136261 >>> 0;
    const word = w => { h = Math.imul(h ^ w, 16777619); };
    const num = x => { f64[0] = +x || 0; word(f32[0]); word(f32[1]); };
    for (const a of [owner, aiOf, building, countryOf]) { const u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >> 2); for (let i = 0; i < u.length; i++) word(u[i]); }
    num(game.time); num(game.rs); num(game.buildings.length);
    for (const c of game.countries) { num(c.alive ? 1 : 0); num(c.people); num(c.tiles); for (const r in c.res) num(c.res[r]); }
    for (const n of game.nations) { num(n.people); num(n.tiles); num(n.iron); num(n.hostile ? 1 : 0); }
    for (const e of game.expeditions) { num(e.x); num(e.y); num(e.n); }
    for (const p of game.pushes) { num(p.budget); num(p.work); }
    for (const f of game.flights) { num(f.x); num(f.y); num(f.fuel); }
    for (const L of game.links) num(L.t);
    return h >>> 0;
  }

  // ---------------------------------------------------------------- the shared random numbers
  function sharedRand() {                          // mulberry32, its state in game.rs
    const a = game.rs = (game.rs + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function useSharedRandom() { simRand = sharedRand; pushRand = sharedRand; }

  // ---------------------------------------------------------------- hosting
  const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  const inviteLink = () => `${location.origin}${location.pathname}?seed=${SEED}&join=${S.room}`;
  function startHosting(code) {
    if (S.role) return;
    S.role = 'host'; S.on = true; S.room = code || newRoom();
    if (!game.players) {                            // the world becomes shared: you're player 1 (id 0)
      game.players = [{ name: localName() || 'Host', col: PLAYER_COL[0] }];
      game.peaks = [game.peakPop];
      game.rs = (crypto.getRandomValues(new Uint32Array(1))[0] | 0) || 1;
    }
    useSharedRandom();
    try { tokens = JSON.parse(localStorage.getItem('mf-mp-tokens-' + S.room)) || {}; } catch (e) { tokens = {}; }
    history.replaceState(null, '', `${location.pathname}?seed=${SEED}&host=${S.room}`);
    saveGame();
    connect();
    renderPlayers();
    backgroundTicker();
  }
  // A hidden tab gets no animation frames, and its timers are slowed to once a second: the host's world would stop for
  // everyone whenever the host looked at another tab (and a guest would fall behind). So while hidden, a tiny worker
  // (never slowed) keeps time instead.
  function backgroundTicker() {
    let last = performance.now(), acc = 0;
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
    w.onmessage = () => {
      const now = performance.now(), dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!document.hidden) { acc = 0; return; }   // visible: the normal frame loop keeps time
      acc = frame(acc + dt, 1 / CFG.tickHz);
    };
  }
  function onHello(msg, peer) {
    if (!msg || msg.v !== PROTO) return tx.nope.send({ why: 'version' }, { target: peer });
    let pid = typeof msg.token === 'string' ? tokens[msg.token] : undefined, isNew = false;
    if (pid == null || !game.players[pid]) {
      pid = Math.max(game.players.length, nextPid);
      if (pid >= MAX_PLAYERS) return tx.nope.send({ why: 'full' }, { target: peer });
      isNew = true;
      nextPid = pid + 1;
      tokens[msg.token] = pid;
      try { localStorage.setItem('mf-mp-tokens-' + S.room, JSON.stringify(tokens)); } catch (e) { /* storage blocked */ }
    } else if (!myCountries(pid).length) isNew = true;   // came back with nothing left: a fresh start
    members.set(peer, pid);
    const col = okCol(msg.col) && !game.players.some((p, k) => p && k !== pid && String(p.col) === String(msg.col)) ? msg.col : null;
    joins.push({ peer, pid, isNew, name: String(msg.name || '').slice(0, 24) || `Player ${pid + 1}`, col });
    if (!isNew) asPlayer(SYS, () => toast(`${playerName(pid)} is back`, { good: true }));
    renderPlayers();
  }

  // ---------------------------------------------------------------- the connection
  async function connect() {
    status(S.role === 'host' ? 'Opening your world to friends…' : 'Connecting…');
    let lib;
    try { lib = await import(LIB); }
    catch (e) { return refuse('Could not load the multiplayer library. Check your connection and reload.'); }
    room = lib.joinRoom({ appId: 'factory-conquest-shared-worlds' }, 'fc-' + S.room);
    for (const a of ['hello', 'nope', 'ticks', 'cmd', 'snap', 'resync', 'who']) tx[a] = room.makeAction(a);
    if (S.role === 'host') {
      tx.hello.onMessage = (m, { peerId }) => onHello(m, peerId);
      tx.cmd.onMessage = (cmd, { peerId }) => {
        const pid = members.get(peerId);
        if (pid == null || !cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string' || cmd.t === 'join') return;
        inbox.push([pid, cmd]);
      };
      tx.resync.onMessage = (m, { peerId }) => { if (members.has(peerId) && !resyncs.includes(peerId)) resyncs.push(peerId); };
      room.onPeerLeave = peer => {
        const pid = members.get(peer);
        members.delete(peer);
        if (pid != null && game.players[pid]) asPlayer(SYS, () => toast(`${playerName(pid)} left (their empire stays)`));
        renderPlayers();
      };
      status('');
      showInvite();
    } else {
      tx.nope.onMessage = m => refuse(m && m.why === 'full' ? 'This world is full.' : 'The host is on another version of the game. Reload both pages and try again.');
      tx.ticks.onMessage = (batch, { peerId }) => {
        if (!Array.isArray(batch) || !batch.length) return;
        if (welcomed && peerId !== hostPeer) return;
        if (lostHost && peerId === hostPeer && batch[0].T <= S.T + 1) { welcomed = true; lostHost = false; hideOverlay(); }   // the same host, back
        if (peerId === hostPeer) lastTickAt = performance.now();
        for (const p of batch) inq.push({ p, peer: peerId });   // (until the world arrives, from anyone: sorted out then)
        if (!welcomed && inq.length > 4000) inq.splice(0, inq.length - 4000);
        if (!welcomed && !S.debug.joinedAt) status('Found the host, waiting for the world…');
      };
      tx.snap.onMessage = (bytes, { peerId }) => { hostPeer = peerId; takeSnap(bytes).catch(e => { console.error(e); refuse('The world did not arrive whole. Reload to try again.'); }); };
      tx.who.onMessage = (m, { peerId }) => { if (peerId === hostPeer) { S.online = m; renderPlayers(); } };
      room.onPeerJoin = peer => { if (!welcomed) sayHello(peer); };
      room.onPeerLeave = peer => { if (peer === hostPeer && welcomed) loseHost(); };
      for (const p of Object.keys(room.getPeers ? room.getPeers() : {})) sayHello(p);
      clearInterval(helloTimer);
      helloTimer = setInterval(() => { if (S.debug.joinedAt) return clearInterval(helloTimer); status('Still looking for the host… (their game has to be open)'); }, 15000);
    }
    setInterval(() => { if (S.role === 'host' && tx.who) tx.who.send([0, ...members.values()]); }, 3000);
    setInterval(renderPlayers, 1500);               // (players come and go between frames: keep the list fresh)
  }
  function sayHello(peer) {
    tx.hello.send({ v: PROTO, token: myToken(), name: localName() || 'Friend', col: myCol }, { target: peer });
  }
  const myToken = () => {
    const k = 'mf-mp-me-' + S.room;
    let t = null;
    try { t = localStorage.getItem(k); } catch (e) { /* storage blocked */ }
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem(k, t); } catch (e) { /* */ } }
    return t;
  };
  const localName = () => { try { return localStorage.getItem('mf-mp-name') || ''; } catch (e) { return ''; } };

  // ---------------------------------------------------------------- boot (called by game.js once the world is made)
  function boot() {
    addInviteButton();
    if (HOST) return startHosting(HOST);
    if (JOIN) { noSave = true; showJoin(); backgroundTicker(); }
  }

  // ---------------------------------------------------------------- the panels: join, invite, players
  let myCol = null;
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const css = `
    #mp-ov{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(6,9,16,0.55);font-family:'Segoe UI',Arial,sans-serif}
    .mp-card{background:rgba(16,22,34,0.97);border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:20px 22px;width:min(360px,calc(100vw - 32px));color:#e8edf5;box-shadow:0 12px 40px rgba(0,0,0,0.5)}
    .mp-card h2{margin:0 0 4px;font-size:19px}.mp-card p{margin:6px 0 12px;font-size:13px;opacity:0.8;line-height:1.4}
    .mp-card input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.06);color:#fff;font-size:15px}
    .mp-cols{display:flex;gap:8px;margin:12px 0}.mp-cols b{width:28px;height:28px;border-radius:50%;cursor:pointer;border:3px solid transparent}.mp-cols b.on{border-color:#fff}
    .mp-go{width:100%;padding:10px;border:0;border-radius:9px;background:#f2c14e;color:#1a1408;font-weight:700;font-size:15px;cursor:pointer;margin-top:4px}
    .mp-go:disabled{opacity:0.5;cursor:default}.mp-st{font-size:12px;opacity:0.75;margin-top:10px;min-height:16px}
    #mp-inv{position:fixed;top:64px;right:12px;z-index:40;font-family:'Segoe UI',Arial,sans-serif}
    #mp-inv .mp-card{width:min(330px,calc(100vw - 24px));padding:14px 16px}
    .mp-link{display:flex;gap:6px}.mp-link input{font-size:12px}.mp-link button{padding:0 12px;border:0;border-radius:8px;background:#f2c14e;font-weight:700;cursor:pointer}
    #mp-list{position:fixed;left:12px;bottom:215px;z-index:30;font:600 12px 'Segoe UI',Arial,sans-serif;color:#e8edf5;background:rgba(10,14,22,0.7);border-radius:9px;padding:6px 9px;pointer-events:none}
    #mp-list div{display:flex;align-items:center;gap:6px;margin:2px 0}#mp-list i{width:10px;height:10px;border-radius:50%;display:inline-block}`;
  function style() { if (!document.getElementById('mp-css')) { const s = document.createElement('style'); s.id = 'mp-css'; s.textContent = css; document.head.appendChild(s); } }
  const rgb = c => `rgb(${c.join(',')})`;
  function showJoin() {
    style();
    myCol = PLAYER_COL[1 + ((crypto.getRandomValues(new Uint8Array(1))[0]) % (PLAYER_COL.length - 1))];
    const ov = el(`<div id="mp-ov"><div class="mp-card"><h2>Join a shared world</h2>
      <p>You'll start an empire of your own somewhere on your friend's map, and grow it alongside theirs.</p>
      <input id="mp-name" maxlength="24" placeholder="Your name" value="${(localName() || '').replace(/"/g, '')}">
      <div class="mp-cols">${PLAYER_COL.slice(1).map(c => `<b data-c="${c}" style="background:${rgb(c)}"></b>`).join('')}</div>
      <button class="mp-go">Join</button><div class="mp-st" id="mp-st"></div></div></div>`);
    document.body.appendChild(ov);
    const mark = () => ov.querySelectorAll('.mp-cols b').forEach(b => b.classList.toggle('on', b.dataset.c === String(myCol)));
    mark();
    ov.querySelectorAll('.mp-cols b').forEach(b => b.addEventListener('click', () => { myCol = b.dataset.c.split(',').map(Number); mark(); }));
    const go = ov.querySelector('.mp-go'), name = ov.querySelector('#mp-name');
    name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go.click(); });
    go.addEventListener('click', () => {
      try { localStorage.setItem('mf-mp-name', name.value.trim()); } catch (e) { /* */ }
      go.disabled = true; name.disabled = true;
      connect();
    });
    if (!TOUCH) setTimeout(() => name.focus(), 50);
  }
  function status(t) { const s = document.getElementById('mp-st'); if (s) s.textContent = t; else if (t && S.role === 'guest' && !welcomed && S.debug.joinedAt) toast(t); }
  function hideOverlay() { const o = document.getElementById('mp-ov'); if (o) o.remove(); }
  function refuse(msg) {
    style();
    hideOverlay();
    document.body.appendChild(el(`<div id="mp-ov"><div class="mp-card"><h2>Shared world</h2><p>${msg}</p><button class="mp-go" onclick="location.reload()">Reload</button></div></div>`));
  }
  function addInviteButton() {                     // on the HUD (mouse) and on the touch bar (phones)
    if (JOIN) return;
    const press = () => (S.role === 'host' ? toggleInvite() : startHosting());
    const bar = document.getElementById('hudbtns'), home = document.querySelector('#tbar [data-act="home"]');
    if (bar) {
      const b = document.createElement('button');
      b.className = 'hudbtn'; b.id = 'mp-btn'; b.title = 'Play this world with friends: they get an empire of their own on your map';
      b.textContent = 'Invite';
      b.addEventListener('click', press);
      bar.appendChild(b);
    }
    if (home) {
      const b = document.createElement('button');
      b.textContent = 'Invite';
      b.addEventListener('click', e => { e.stopPropagation(); press(); });
      home.after(b);
    }
  }
  function showInvite() {
    style();
    let p = document.getElementById('mp-inv');
    if (p) return p.style.display = '';
    p = el(`<div id="mp-inv"><div class="mp-card"><h2 style="font-size:16px">Your world is open</h2>
      <p>Send this link to a friend. They'll get an empire of their own on your map. The world runs on your screen, so keep this tab open while you play.</p>
      <div class="mp-link"><input readonly value="${inviteLink()}"><button>Copy</button></div>
      <div class="mp-st" id="mp-inv-st"></div>
      <p style="margin:10px 0 4px">Your name in this world</p><input id="mp-myname" maxlength="24" value="${playerName(0).replace(/"/g, '')}">
      <button class="mp-go" style="background:rgba(255,255,255,0.1);color:#e8edf5;margin-top:10px">Close</button></div></div>`);
    document.body.appendChild(p);
    const inp = p.querySelector('input'), st = p.querySelector('#mp-inv-st');
    inp.addEventListener('focus', () => inp.select());
    p.querySelector('.mp-link button').addEventListener('click', () => {
      (navigator.clipboard ? navigator.clipboard.writeText(inviteLink()) : Promise.reject()).then(() => { st.textContent = 'Copied!'; }, () => { inp.select(); st.textContent = 'Select the link and copy it'; });
    });
    p.querySelector('.mp-go').addEventListener('click', () => { p.style.display = 'none'; });
    const nm = p.querySelector('#mp-myname');
    nm.addEventListener('keydown', e => e.stopPropagation());   // (typing a name isn't playing: keep the keys off the map)
    nm.addEventListener('change', () => {
      const v = nm.value.trim().slice(0, 24);
      if (!v) return;
      try { localStorage.setItem('mf-mp-name', v); } catch (e) { /* */ }
      act({ t: 'name', name: v });
      renderPlayers();
    });
  }
  function toggleInvite() { const p = document.getElementById('mp-inv'); if (!p || p.style.display === 'none') showInvite(); else p.style.display = 'none'; }
  function renderPlayers() {
    if (!game.players) return;
    style();
    let box = document.getElementById('mp-list');
    if (!box) { box = document.createElement('div'); box.id = 'mp-list'; document.body.appendChild(box); }
    const online = S.role === 'host' ? new Set([0, ...members.values()]) : new Set(S.online || []);
    box.innerHTML = game.players.map((p, k) => p && `<div><i style="background:${rgb(p.col)}"></i>${p.name.replace(/</g, '&lt;')}${k === ME ? ' (you)' : ''}${online.has(k) || k === ME ? '' : ' <span style="opacity:0.5">away</span>'}</div>`).filter(Boolean).join('');
  }

  // testing hooks
  Object.assign(S.debug, { worldHash: () => worldHash(), snapshotText: () => snapshotText(), encode, decode, applyRoots, snapRoots,
    takeText: text => { applyRoots(decode(JSON.parse(text))); }, queueLen: () => inq.length, members: () => [...members] });
  return S;
})();
