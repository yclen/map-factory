// Rocket flight: a small 2D physics sim around Home. Positions are in system units relative to Home's centre
// (Home's radius = HOME.r), y pointing down the screen, so Home's North Pole is at (0, -R).
// angle 0 = nose pointing north (up the screen); positive angles turn clockwise.
import { RULES } from './rules.js?v=20261125215454';

const P = RULES.rocket;
const TAU = Math.PI * 2;

export function makeRocket(id) {
  return { id, kind: 'rocket', name: `Rocket ${id}`, state: 'building', built: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0,
    fuel: P.fuel, throttle: 1, engine: false, on: null, offX: 0, offY: 0, crashT: 0, maxAlt: 0, _x: 0, _y: 0, _f: -1 };
}

// gravity sources at time t: [{ x, y, r, gm }], filled into a reused array by the caller's env.bodiesAt
function accel(rk, bodies, out) {
  let ax = 0, ay = 0;
  for (const b of bodies) {
    const dx = b.x - rk.x, dy = b.y - rk.y, d2 = dx * dx + dy * dy, d = Math.sqrt(d2);
    const k = b.gm / (d2 * d);
    ax += dx * k; ay += dy * k;
  }
  out[0] = ax; out[1] = ay;
}
const acc = [0, 0];

// one physics step. env: { bodiesAt(t), home (the body rockets launch from), len (rocket length, su) }
export function stepRocket(rk, dt, t, env, input) {
  const half = env.len / 2;
  if (rk.state === 'building') {
    rk.built = Math.min(1, rk.built + dt / P.buildTime);
    if (rk.built >= 1) rk.state = 'ready';
  }
  if (rk.state === 'crashed') { rk.crashT += dt; return; }
  const bodies = env.bodiesAt(t);
  // steering and throttle (only the rocket being controlled gets input)
  if (input) {
    if (rk.state === 'flying') rk.angle += input.turn * P.turnRate * dt;   // no spinning on the pad
    rk.throttle = Math.min(1, Math.max(0, rk.throttle + input.throttle * dt * 0.8));
  }
  // sitting on something: the pad, Home, or the Moon. It rides along with that body until it lifts off
  if (rk.state === 'building' || rk.state === 'ready' || rk.state === 'landed') {
    const b = bodies[rk.on || 0];
    rk.x = b.x + rk.offX; rk.y = b.y + rk.offY; rk.vx = b.vx || 0; rk.vy = b.vy || 0;
    if (rk.state === 'building') return;
    const m = P.dryMass + rk.fuel, thrust = rk.engine && rk.fuel > 0 ? P.thrust * rk.throttle : 0;
    if (rk.engine && rk.fuel > 0) rk.fuel = Math.max(0, rk.fuel - P.fuelRate * rk.throttle * dt);
    const dx = rk.x - b.x, dy = rk.y - b.y, d = Math.hypot(dx, dy), g = b.gm / (d * d);
    if (thrust / m > g * 1.02) { rk.state = 'flying'; rk.launchedAt = t; }   // more push than weight: lift off
    else return;
  }
  // flying
  const m = P.dryMass + rk.fuel;
  let thrust = 0;
  if (rk.engine && rk.fuel > 0) {
    thrust = P.thrust * rk.throttle;
    rk.fuel = Math.max(0, rk.fuel - P.fuelRate * rk.throttle * dt);
  }
  accel(rk, bodies, acc);
  let ax = acc[0] + Math.sin(rk.angle) * thrust / m, ay = acc[1] - Math.cos(rk.angle) * thrust / m;
  // air drag near Home only, fading out at the top of the atmosphere
  const home = bodies[0], hx = rk.x - home.x, hy = rk.y - home.y, r = Math.hypot(hx, hy);
  const alt = r - home.r;
  rk.maxAlt = Math.max(rk.maxAlt, alt);
  if (alt < P.atmosphere) {
    const rho = Math.exp(-alt / (P.atmosphere / 3)) * (1 - alt / P.atmosphere);
    const v = Math.hypot(rk.vx, rk.vy), k = P.drag * rho * v / m;
    ax -= rk.vx * k; ay -= rk.vy * k;
  }
  rk.vx += ax * dt; rk.vy += ay * dt;
  rk.x += rk.vx * dt; rk.y += rk.vy * dt;
  // touching a body: land gently and upright, otherwise crash
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i], dx = rk.x - b.x, dy = rk.y - b.y, d = Math.hypot(dx, dy);
    if (d >= b.r + half) continue;
    const nx = dx / d, ny = dy / d;
    const rvx = rk.vx - (b.vx || 0), rvy = rk.vy - (b.vy || 0), into = -(rvx * nx + rvy * ny);
    if (into <= 0) continue;                                  // already moving away (just lifted off)
    const up = Math.atan2(nx, -ny);                           // the angle that points straight away from the body
    let tilt = Math.abs(((rk.angle - up) % TAU + TAU + Math.PI) % TAU - Math.PI);
    const speed = Math.hypot(rvx, rvy);
    rk.x = b.x + nx * (b.r + half); rk.y = b.y + ny * (b.r + half);
    if (speed < P.landSpeed && tilt < P.landTilt) {
      rk.state = 'landed'; rk.on = i; rk.offX = rk.x - b.x; rk.offY = rk.y - b.y; rk.angle = up; rk.engine = false;
    } else { rk.state = 'crashed'; rk.engine = false; rk.crashT = 0; }
    break;
  }
}

// where the rocket will coast if the engine stays off: positions every step until it hits something or
// the horizon runs out. Returns the number of points written into out (x, y pairs).
const ghost = makeRocket(0), pacc = [0, 0];
export function predictPath(rk, t, env, out, maxPts = 1500, dt = 0.35) {
  if (rk.state !== 'flying') return 0;
  ghost.x = rk.x; ghost.y = rk.y; ghost.vx = rk.vx; ghost.vy = rk.vy;
  let n = 0;
  for (let i = 0; i < maxPts; i++) {
    const bodies = env.bodiesAt(t + i * dt);
    // two half steps (velocity Verlet) keep long coasts from drifting
    accel(ghost, bodies, pacc);
    ghost.vx += pacc[0] * dt / 2; ghost.vy += pacc[1] * dt / 2;
    ghost.x += ghost.vx * dt; ghost.y += ghost.vy * dt;
    accel(ghost, bodies, pacc);
    ghost.vx += pacc[0] * dt / 2; ghost.vy += pacc[1] * dt / 2;
    out[n * 2] = ghost.x; out[n * 2 + 1] = ghost.y; n++;
    let hit = false;
    for (const b of bodies) if (Math.hypot(ghost.x - b.x, ghost.y - b.y) < b.r) { hit = true; break; }
    if (hit || Math.hypot(ghost.x, ghost.y) > 60) break;
  }
  return n;
}

// the shape of the orbit around Home, if it were the only thing pulling: highest and lowest altitude
export function orbitAround(rk, home) {
  const x = rk.x - home.x, y = rk.y - home.y, vx = rk.vx, vy = rk.vy;
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy, gm = home.gm;
  const energy = v2 / 2 - gm / r, h = x * vy - y * vx;
  if (energy >= 0) return { escaping: true, peri: null, apo: null };
  const a = -gm / (2 * energy), e = Math.sqrt(Math.max(0, 1 + 2 * energy * h * h / (gm * gm)));
  return { escaping: false, peri: a * (1 - e) - home.r, apo: a * (1 + e) - home.r };
}

// The exact path around Home alone (ignoring the Moon and drag): one conic, drawn by angle around Home from
// where the rocket is now, forward one full lap or until it would hit the ground or fly off. Cheap and steady,
// so it never jitters. Writes x, y pairs into out and returns { n, apo, peri, closed }.
export function conicPath(rk, home, out, steps = 240) {
  const x = rk.x - home.x, y = rk.y - home.y, vx = rk.vx, vy = rk.vy, mu = home.gm;
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy, h = x * vy - y * vx;
  const rv = x * vx + y * vy, k = v2 - mu / r;
  const ex = (k * x - rv * vx) / mu, ey = (k * y - rv * vy) / mu, e = Math.hypot(ex, ey);
  const p = h * h / mu, dir = h >= 0 ? 1 : -1;
  const w = e > 1e-6 ? Math.atan2(ey, ex) : Math.atan2(y, x);         // direction of the lowest point
  const nu0 = Math.atan2(y, x) - w;
  const closed = e < 1;
  const lap = closed ? 2 * Math.PI : Math.acos(Math.max(-1, -1 / e)) * 2;   // a hyperbola only sweeps so far
  let n = 0, passedTop = false;
  for (let i = 0; i <= steps; i++) {
    const nu = nu0 + dir * lap * i / steps, den = 1 + e * Math.cos(nu);
    if (den <= 0.02) break;
    const rr = p / den;
    if (rr < home.r * 0.999 && i > 0) { out[n * 2] = home.x + Math.cos(w + nu) * home.r; out[n * 2 + 1] = home.y + Math.sin(w + nu) * home.r; n++; break; }
    if (rr > 80) break;
    out[n * 2] = home.x + Math.cos(w + nu) * rr; out[n * 2 + 1] = home.y + Math.sin(w + nu) * rr; n++;
    if (closed && Math.cos(nu) < -0.999) passedTop = true;
  }
  const at = (ang, rr) => ({ x: home.x + Math.cos(ang) * rr, y: home.y + Math.sin(ang) * rr, alt: rr - home.r });
  const periR = p / (1 + e), apoR = closed ? p / (1 - e) : Infinity;
  // the top of the arc counts if the rocket gets there before landing; the bottom only if it's above ground
  const reachesTop = closed && (periR > home.r || passedTop || Math.cos(nu0) < -0.999);
  const nuEnd = nu0 + dir * lap * Math.max(0, n - 1) / steps;            // how far round the drawn arc goes
  return { n, closed, apo: reachesTop ? at(w + Math.PI, apoR) : null, peri: closed && periR > home.r ? at(w, periR) : null, apoR,
    p, e, w, nu0, nuEnd, hx: home.x, hy: home.y, rMin: home.r };
}
