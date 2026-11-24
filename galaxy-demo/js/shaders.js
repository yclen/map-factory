import { SLOPE_K } from './terrain.js?v=20261124123321';

// GLSL for the WebGL2 renderer. All colours leave the shaders premultiplied by alpha; output with alpha 0
// adds light (used for glows), output with alpha 1 covers what's behind.

const CLIP = `vec4 clip(vec2 p, vec2 res) { return vec4(p.x / res.x * 2.0 - 1.0, 1.0 - p.y / res.y * 2.0, 0.0, 1.0); }`;

// ---------- a rectangle given in device pixels (y down) ----------
export const RECT_VS = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rect;
uniform vec2 u_res;
out vec2 v_uv;
${CLIP}
void main() { v_uv = a_pos; gl_Position = clip(mix(u_rect.xy, u_rect.zw, a_pos), u_res); }`;

// ---------- faint background stars, fixed to the screen ----------
export const SKY_FS = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform float u_cell; uniform float u_alpha;
out vec4 o;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 fc = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 c = floor(fc / u_cell);
  float r = h(c);
  vec3 col = vec3(0.0);
  if (r > 0.985) {
    vec2 sp = (c + vec2(h(c + 1.7), h(c + 9.1))) * u_cell;
    float d = length(fc - sp);
    float b = (r - 0.985) / 0.015;
    col = mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.85, 0.7), h(c + 3.3)) * b * smoothstep(1.4, 0.2, d) * 0.55;
  }
  o = vec4(col * u_alpha, 0.0);
}`;

// ---------- the galaxy's glow (a pre-painted texture) ----------
export const TEX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex; uniform float u_alpha;
out vec4 o;
void main() { vec3 c = texture(u_tex, v_uv).rgb; o = vec4(c * u_alpha, 0.0); }`;

// ---------- instanced points: star glows, planet dots, orbit rings ----------
export const SPRITE_VS = `#version 300 es
in vec2 a_pos;        // corner, -1..1
in vec4 a_i0;         // x, y (device px), size (px), kind
in vec4 a_col;
uniform vec2 u_res; uniform float u_ringW;
out vec2 v_p; out float v_size; flat out int v_kind; out vec4 v_col;
${CLIP}
void main() {
  int kind = int(a_i0.w + 0.5);
  float ext = a_i0.z + (kind == 2 ? u_ringW + 2.0 : 1.5);
  v_p = a_pos * ext; v_size = a_i0.z; v_kind = kind; v_col = a_col;
  gl_Position = clip(a_i0.xy + v_p, u_res);
}`;
export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 v_p; in float v_size; flat in int v_kind; in vec4 v_col;
uniform float u_ringW;
out vec4 o;
void main() {
  float d = length(v_p);
  if (v_kind == 0) {                       // star glow: sharp core, soft halo (adds light)
    float x = d / max(v_size, 0.5);
    float core = exp(-x * x * 18.0), halo = pow(max(0.0, 1.0 - x), 2.2) * 0.45;
    o = vec4(v_col.rgb * (core + halo) * v_col.a, 0.0);
  } else if (v_kind == 3) {                // a nearby star: big white-hot core, wide halo and light spikes
    float x = d / max(v_size, 0.5);
    float core = exp(-x * x * 26.0) * 1.8, inner = exp(-x * x * 7.0) * 0.9, halo = pow(max(0.0, 1.0 - x), 1.5) * 0.55;
    vec2 q = abs(v_p) / max(v_size, 0.5);
    float spikes = (exp(-q.y * 38.0) * pow(max(0.0, 1.0 - q.x), 1.6) + exp(-q.x * 38.0) * pow(max(0.0, 1.0 - q.y), 1.6)) * 1.1;
    vec3 c = mix(v_col.rgb, vec3(1.0), core * 0.6);
    o = vec4(c * (core + inner + halo + spikes) * v_col.a, 0.0);
  } else if (v_kind == 1) {                // solid dot
    float a = clamp(v_size + 0.5 - d, 0.0, 1.0) * v_col.a;
    o = vec4(v_col.rgb * a, a);
  } else {                                 // ring
    float a = clamp(u_ringW * 0.5 + 0.5 - abs(d - v_size), 0.0, 1.0) * v_col.a;
    o = vec4(v_col.rgb * a, a);
  }
}`;

// ---------- planets, moons, gas giants and stars: flat disks, one quad each ----------
// A planet's surface is a square tile map with the disk inscribed (like Home in Factory Conquest).
export const BODY_FS = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D;
uniform vec2 u_res; uniform vec2 u_center; uniform float u_R; uniform int u_mode; uniform float u_pix;
uniform vec3 u_light;
uniform int u_hasMap; uniform usampler2D u_ids; uniform sampler2D u_col; uniform sampler2D u_atlas;
uniform vec2 u_map; uniform float u_art; uniform float u_lod;
uniform vec3 u_c1, u_c2, u_c3; uniform float u_seed; uniform float u_time;
uniform vec4 u_ring; uniform vec4 u_atmo; uniform float u_alpha; uniform float u_atmoH;
uniform vec4 u_page;     // this chunk's place in the disk's square (x, y, width, height; 0..1)
uniform int u_detail;    // 1 = a detail chunk drawn over the whole-planet base: only its own square, inside the disk
// the terrain look (u_fx = 1): a field map per chunk (slopes, height relative to the sea, colour variation),
// tiles per device pixel (to exaggerate relief when zoomed out) and the skin's deep and shallow water colours
uniform sampler2D u_fld; uniform int u_fx; uniform float u_tpp; uniform vec3 u_deep, u_shallow;
// scattered decorations, per ground type (art.js decorTables): share of spots used, 4 atlas slots to pick from,
// and whether the ground under them is plain forest floor
uniform float u_decoD[32]; uniform ivec4 u_decoK[32]; uniform int u_floor[32];
out vec4 o;

const float SLOPE_K = ${SLOPE_K}.0;
const vec3 SUN = vec3(-0.55, -0.65, 0.75);   // light from the top left, the way relief maps are lit
// per screen pixel, shared by the art-pixel lookups below
vec2 g_warp = vec2(0.0);  // how far this pixel's ground lookup is nudged (art px): wiggly borders between biomes
vec3 g_land = vec3(1.0);  // hill shading x colour variation, for land
float g_depth = 0.0;      // water depth (elevation units)
vec2 g_off = vec2(0.0);   // this chunk's first art pixel on the whole map (so noise lines up across chunks)

uint hashu(uvec2 p) { uint h = (p.x * 0x27d4eb2du) ^ (p.y * 0x165667b1u); h ^= h >> 15; h *= 0x85ebca6bu; h ^= h >> 13; return h; }
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.15; }
float hf(uvec2 p) { return float(hashu(p) & 65535u) / 65535.0; }
float vn2(vec2 p, uint s) {           // 2D value noise, 0..1
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  uvec2 q = uvec2(ivec2(i)) + uvec2(s * 7919u, s * 104729u);
  return mix(mix(hf(q), hf(q + uvec2(1, 0)), f.x), mix(hf(q + uvec2(0, 1)), hf(q + uvec2(1, 1)), f.x), f.y);
}
// light near the shore, quickly darkening to open sea
vec3 waterCol(float depth) { return mix(u_shallow * 1.1, u_deep * 0.8, pow(smoothstep(0.0, 0.08, depth), 0.55)); }
// slope (elevation per tile) from a field sample -> brightness from the sun, 1 on flat ground
float hillShade(vec4 F) {
  vec2 y = clamp(F.rg * 2.0 - 1.0, -0.98, 0.98), sl = y / (1.0 - abs(y)) / SLOPE_K;
  // more relief when zoomed out, never more than a whole-planet look allows; smaller worlds have steeper slopes
  // per tile (the same continents squeezed into fewer tiles), so they get less exaggeration
  float W = u_tpp * 2.0 * u_R;
  float ex = min(65.0 * sqrt(max(u_tpp, 0.125) / 0.125), 0.1 * W) * sqrt(clamp(W / 4096.0, 0.06, 1.0));
  vec3 n = normalize(vec3(-sl * ex, 1.0)), L = normalize(SUN);
  return clamp(dot(n, L) / L.z, 0.55, 1.35);
}
vec3 landTint(vec4 F) {               // drier patches a little lighter and warmer, lusher ones darker and cooler
  float v = F.a * 2.0 - 1.0;
  return (1.0 + v * 0.09) * vec3(1.0 + v * 0.05, 1.0, 1.0 - v * 0.06);
}

// the ground tile an art pixel shows: its own tile, or a neighbour's when the border wiggles across
ivec2 groundTile(ivec2 a) {
  return clamp(ivec2(floor((vec2(a) + 0.5 + g_warp) / 8.0)), ivec2(0), ivec2(u_map) - 1);
}
bool isWater(uint id) { return id <= 1u; }       // DEEP, SHALLOW
vec4 atlasPix(int s, ivec2 inT) { return texelFetch(u_atlas, ivec2((s & 31) * 8 + inT.x, (s >> 5) * 8 + inT.y), 0); }

// Decorations: one spot per 8x8 cell of global art pixels, nudged 0..6 px so they don't line up with tiles. Each
// spot looks at the ground under its foot (not nudged by the border wiggle, so trees can spill a little past a
// forest's edge) and maybe places a sprite there with a one-pixel shadow to the bottom right. An art pixel can be
// covered by the spots of at most 2 x 2 cells; lower rows are drawn last so they overlap the ones behind
vec3 decorate(ivec2 a, vec3 c) {
  ivec2 ga = a + ivec2(g_off);
  ivec2 cA = ivec2(floor(vec2(ga - 7) / 8.0)), cB = ga >> 3;
  for (int cy = cA.y; cy <= cB.y; cy++) for (int cx = cA.x; cx <= cB.x; cx++) {
    uint hh = hashu(uvec2(ivec2(cx, cy)) ^ uvec2(0x51edu, 0x2701u));
    ivec2 A = ivec2(cx, cy) * 8 + ivec2(int(hh & 7u) % 7, int((hh >> 3) & 7u) % 7);
    ivec2 foot = ((A + ivec2(4, 6)) - ivec2(g_off)) >> 3;
    if (any(lessThan(foot, ivec2(0))) || any(greaterThanEqual(foot, ivec2(u_map)))) continue;
    uvec2 id = texelFetch(u_ids, foot, 0).rg;
    if (id.g != 0u || float((hh >> 8) & 1023u) / 1023.0 >= u_decoD[int(id.r)]) continue;
    int k = u_decoK[int(id.r)][int((hh >> 18) & 3u)];
    if (k < 0) continue;
    int slot = (k & 4095) + int((hh >> 20) & 3u);
    ivec2 q = ga - A;
    if (k >= 4096 && q.y < 4) {                    // treetops lean with the wind, each tree in its own rhythm
      float ph = float((hh >> 22) & 255u) / 40.0;
      q.x -= int(sin(u_time * 1.7 + ph + float(A.x) * 0.05) > 0.55);
    }
    ivec2 qs = q - ivec2(1, 1);
    if (all(greaterThanEqual(qs, ivec2(0))) && all(lessThan(qs, ivec2(8))) && atlasPix(slot, qs).a > 0.5) c *= 0.68;
    if (all(greaterThanEqual(q, ivec2(0))) && all(lessThan(q, ivec2(8)))) {
      vec4 sp = atlasPix(slot, q);
      if (sp.a > 0.5) c = sp.rgb * g_land * (0.9 + 0.2 * float((hh >> 26) & 15u) / 15.0);
    }
  }
  return c;
}

// one art pixel of the surface: ground tile + overlay, looked up through the tile-id map. Deposits and buildings
// always sit on their own tile; only the ground under them wiggles
vec3 artPix(ivec2 a) {
  int W8 = int(u_map.x) * 8, H8 = int(u_map.y) * 8;
  a = clamp(a, ivec2(0), ivec2(W8 - 1, H8 - 1));
  ivec2 tile = a >> 3, inT = a & 7, gt = groundTile(a);
  uint gid = texelFetch(u_ids, gt, 0).r, oid = texelFetch(u_ids, tile, 0).g;
  uint h = hashu(uvec2(gt));
  int gslot = int(gid) * 4 + int(h & 3u);
  if (u_fx == 1 && u_floor[int(gid)] == 1) gslot += 128;             // forest floor (SLOT_FLOOR) under scattered trees
  vec3 c = atlasPix(gslot, inT).rgb;
  bool water = u_fx == 1 && isWater(gid);
  if (water) {
    // smooth depth colour, keeping the tile art's ripples as light and dark
    vec3 tileBase = gid == 0u ? u_deep : u_shallow;
    float lum = dot(c, vec3(0.3, 0.5, 0.2)) / max(dot(tileBase, vec3(0.3, 0.5, 0.2)), 1e-3);
    vec2 g = vec2(a) + g_off;
    c = waterCol(g_depth) * clamp(lum, 0.88, 1.2);
    c *= 1.0 + 0.035 * sin(dot(g, vec2(0.31, 0.17)) + u_time * 1.3);           // slow swell
    // surf: a bright line where the next art pixel is land, and a softer band that washes in and out
    bool shore = !isWater(texelFetch(u_ids, groundTile(a + ivec2(1, 0)), 0).r) || !isWater(texelFetch(u_ids, groundTile(a - ivec2(1, 0)), 0).r)
              || !isWater(texelFetch(u_ids, groundTile(a + ivec2(0, 1)), 0).r) || !isWater(texelFetch(u_ids, groundTile(a - ivec2(0, 1)), 0).r);
    float r = hf(uvec2(ivec2(g)) ^ uvec2(0x9e37u, 0x79b9u));
    float wash = smoothstep(0.004, 0.0, g_depth) * (0.5 + 0.5 * sin(u_time * 1.6 + r * 1.5));
    float foam = shore ? 0.75 + 0.25 * sin(u_time * 2.0 + r * 6.0) : wash * 0.35;
    c = mix(c, vec3(0.93, 0.97, 1.0), foam);
    // glints: now and then a pixel catches the light
    float ph = fract(u_time * 0.3 + r * 17.0);
    if (r > 0.955 && !shore) c += vec3(0.32) * smoothstep(0.0, 0.06, ph) * smoothstep(0.22, 0.06, ph);
  } else if (u_fx == 1 && gid == 20u) {          // lava: patches glow brighter and dimmer
    vec2 g = vec2(a) + g_off;
    c *= 0.85 + 0.3 * (0.5 + 0.5 * sin(u_time * 0.9 + vn2(g / 9.0, 5u) * 6.283));
  }
  if (oid > 0u) {
    vec4 v = atlasPix(256 + int(oid) * 4 + int((hashu(uvec2(tile)) >> 2) & 3u), inT);
    c = mix(c, v.rgb, v.a);
  }
  if (u_fx == 1 && !water && gid != 20u) c *= g_land;
  if (u_fx == 1) c = decorate(a, c);
  return c;
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  if (u_pix > 1.0) fc = (floor(fc / u_pix) + 0.5) * u_pix;
  vec2 d = (fc - u_center) / u_R;                    // -1..1 across the disk, y down
  float rr = length(d);
  vec2 uv = d * 0.5 + 0.5;                           // 0..1 across the disk's square map
  // 0..1 across this chunk. A detail chunk only covers its own square on screen; a far-view pixel block that
  // hangs over the chunk's edge takes the chunk's edge colour rather than leaving a gap (that gap was a visible
  // seam along every chunk border at middle distances)
  vec2 lp = (uv - u_page.xy) / u_page.zw;
  if (u_detail == 1) lp = clamp(lp, vec2(0.0), vec2(1.0));
  vec2 ap = lp * u_map * 8.0 - 0.5;                  // art-pixel coordinate within the chunk
  vec2 fw = clamp(fwidth(ap), vec2(1e-3), vec2(2.0));
  float edgeW = max(u_pix, 1.0) / u_R;
  if (u_detail == 1 && rr > 1.0) discard;

  vec4 outc = vec4(0.0);
  if (rr > 1.0) {
    if (u_mode == 2) {                               // corona (adds light)
      float g = exp(-(rr - 1.0) * 3.0) * 0.7 + exp(-(rr - 1.0) * 14.0) * 0.6;
      outc = vec4(u_c1 * g, 0.0);
    } else {
      if (u_atmo.a > 0.0) {                          // a thin glowing rim of atmosphere
        float g = pow(1.0 - smoothstep(1.0, 1.0 + max(u_atmoH, edgeW * 3.0), rr), 1.6) * u_atmo.a;   // fades out at the top of the atmosphere
        outc += vec4(u_atmo.rgb * g, 0.0);
      }
      if (u_ring.z > 0.0 && rr > u_ring.x && rr < u_ring.y) {      // rings, with the planet's shadow across them
        float t = (rr - u_ring.x) / (u_ring.y - u_ring.x);
        float band = vnoise(vec3(t * 38.0, u_seed, 0.0)) * 0.6 + 0.4;
        if (abs(t - u_ring.w) < 0.035) band *= 0.15;
        float a = u_ring.z * band * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.85, t);
        vec2 L2 = normalize(vec2(u_light.x, -u_light.y) + 1e-5);
        float along = dot(d, L2), across = abs(d.x * L2.y - d.y * L2.x);
        float shadow = along < 0.0 ? mix(1.0, 0.28, smoothstep(1.02, 0.94, across)) : 1.0;
        vec3 rc = mix(u_c3, u_c1, band * 0.5) * shadow;
        outc = vec4(rc * a, a) + outc * (1.0 - a);
      }
    }
  } else {
    float edge = u_pix > 1.0 ? 1.0 : 1.0 - smoothstep(1.0 - edgeW * 1.5, 1.0, rr);
    float limb = 1.0 - 0.22 * pow(rr, 4.0);          // the same gentle edge darkening the base game uses
    vec3 c;
    if (u_mode == 2) {                               // a star's face
      float gran = fbm3(vec3(d * 7.0, u_time * 0.05) + u_seed);
      c = mix(u_c2, u_c1, 0.55 + 0.45 * gran) * (0.75 + 0.25 * (1.0 - rr * rr)) + vec3(0.22) * pow(1.0 - rr * rr, 2.0);
    } else if (u_mode == 1) {                        // gas giant: static bands
      float freq = 9.0 + fract(u_seed * 7.13) * 9.0;
      float turb = fbm3(vec3(d.x * 2.5, d.y * 7.0, u_seed)) - 0.5;
      float b = d.y * freq + turb * 2.6;
      float s1 = sin(b) * 0.5 + 0.5, s2 = sin(b * 2.3 + 1.7 + turb * 3.0) * 0.5 + 0.5;
      c = mix(mix(u_c2, u_c1, s1), u_c3, s2 * 0.45) * limb;
    } else if (u_hasMap == 0) {                      // map still being built: plain colour
      c = u_c1 * (0.85 + 0.3 * vnoise(vec3(d * 6.0, u_seed))) * limb;
    } else {
      vec3 cc = vec3(0.0), ca = vec3(0.0);
      if (u_art < 1.0) {
        cc = textureLod(u_col, lp, u_lod).rgb;
        if (u_fx == 1) {                             // far view: the same shading and water colours, smoothly
          vec4 F = textureLod(u_fld, lp, u_lod);
          float rel = (F.b * 255.0 - 127.5) / 600.0;
          cc = mix(cc * hillShade(F) * landTint(F), waterCol(max(-rel, 0.0)), clamp(-rel / 0.0008, 0.0, 1.0));
        }
      }
      if (u_art > 0.0) {
        vec2 i = floor(ap), f = clamp((fract(ap) - 0.5) / fw + 0.5, 0.0, 1.0);
        ivec2 ii = ivec2(i);
        if (u_fx == 1) {
          // per screen pixel: the border wiggle, and shading + water depth at the nearest art pixel's centre
          g_off = floor(u_page.xy * u_map / u_page.zw + 0.5) * 8.0;
          vec2 g = ap + g_off;
          g_warp = (vec2(vn2(g / 11.0, 1u), vn2(g / 11.0, 2u)) - 0.5) * 6.5
                 + (vec2(vn2(g / 4.0, 3u), vn2(g / 4.0, 4u)) - 0.5) * 2.4;
          vec4 F = texture(u_fld, (floor(ap + 0.5) + 0.5) / (u_map * 8.0));
          g_land = hillShade(F) * landTint(F);
          g_depth = max(0.0, -(F.b * 255.0 - 127.5) / 600.0);
        }
        // anti-aliased pixel art: blend neighbouring art pixels only across art-pixel edges, one lookup elsewhere
        bvec2 mid = bvec2(f.x > 0.0 && f.x < 1.0, f.y > 0.0 && f.y < 1.0);
        ivec2 jj = ii + ivec2(step(1.0, f));
        if (!mid.x && !mid.y) ca = artPix(jj);
        else if (!mid.y) ca = mix(artPix(ivec2(ii.x, jj.y)), artPix(ivec2(ii.x + 1, jj.y)), f.x);
        else if (!mid.x) ca = mix(artPix(ivec2(jj.x, ii.y)), artPix(ivec2(jj.x, ii.y + 1)), f.y);
        else ca = mix(mix(artPix(ii), artPix(ii + ivec2(1, 0)), f.x), mix(artPix(ii + ivec2(0, 1)), artPix(ii + ivec2(1, 1)), f.x), f.y);
      }
      c = mix(cc, ca, u_art) * mix(limb, 1.0, u_art * 0.7);
    }
    outc = vec4(c * edge, edge);
  }
  o = outc * u_alpha;
}`;

// ---------- sprites standing on a planet's disk: settlement pins, walkers ----------
export const ONDISK_VS = `#version 300 es
in vec2 a_pos; in vec4 a_s;     // u, v (disk position, -1..1), atlas slot, phase
uniform vec2 u_res; uniform vec2 u_center; uniform float u_R;
uniform float u_size; uniform float u_time; uniform float u_walk;
out vec2 v_uv; flat out int v_slot; out float v_a;
${CLIP}
void main() {
  vec2 p = a_s.xy; float slot = a_s.z;
  if (u_walk > 0.0) {
    float ang = u_time * (0.4 + fract(a_s.w * 7.0) * 0.5) + a_s.w * 6.2831;
    p += vec2(cos(ang), sin(ang)) * u_walk;
    slot += mod(floor(u_time * 5.0 + a_s.w * 8.0), 2.0);
  }
  v_a = 1.0 - smoothstep(0.97, 1.0, length(p));
  v_uv = a_pos * 0.5 + 0.5; v_slot = int(slot + 0.5);
  gl_Position = clip(u_center + p * u_R + a_pos * u_size * 0.5, u_res);
}`;
export const ONDISK_FS = `#version 300 es
precision highp float;
in vec2 v_uv; flat in int v_slot; in float v_a;
uniform sampler2D u_atlas; uniform float u_alpha;
out vec4 o;
void main() {
  ivec2 t = ivec2((v_slot & 31) * 8, (v_slot >> 5) * 8) + ivec2(min(v_uv * 8.0, vec2(7.999)));
  vec4 c = texelFetch(u_atlas, t, 0);
  float a = c.a * v_a * u_alpha;
  if (a < 0.01) discard;
  o = vec4(c.rgb * a, a);
}`;
