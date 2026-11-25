import { SLOPE_K } from './terrain.js?v=20261124222346';

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
// scattered decorations and big props, per ground type (art.js decorTables): (share of small-decoration spots used,
// 1 = plain forest floor under the trees, share of big-prop spots used, -), 4 small-decoration atlas slots and
// 4 big props to pick from. Packed into vec4s to stay well inside phones' uniform limits
uniform vec4 u_biome[32]; uniform ivec4 u_decoK[32]; uniform ivec4 u_propK[32];
// high-resolution props (tools/pack_props.py): per prop kind, the atlas cell of variant 0 (-1 = pixel art), and the
// atlas layout (cell width and height in texels, cells per row, texels per art pixel) and size. Premultiplied alpha
uniform sampler2D u_hd; uniform ivec4 u_hdK[8]; uniform vec4 u_hdInfo; uniform vec2 u_hdSize;
// deposits, per overlay id: soil stain (rgb, strength) and (glint, pulse)
uniform vec4 u_oreStain[16]; uniform vec2 u_oreFx[16];
out vec4 o;

const float SLOPE_K = ${SLOPE_K}.0;
const vec3 SUN = vec3(-0.55, -0.65, 0.75);   // light from the top left, the way relief maps are lit
// per screen pixel, shared by the art-pixel lookups below
vec2 g_warp = vec2(0.0);  // how far this pixel's ground lookup is nudged (art px): wiggly borders between biomes
vec3 g_land = vec3(1.0);  // hill shading x colour variation, for land
float g_depth = 0.0;      // water depth (elevation units)
vec2 g_off = vec2(0.0);   // this chunk's first art pixel on the whole map (so noise lines up across chunks)
vec2 g_ap = vec2(0.0);    // this screen pixel's exact spot on the whole map, in art pixels (high-resolution props)
float g_hdLod = 0.0;      // mip level for high-resolution props at the current zoom

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
// spot looks at the ground under its foot (not nudged by the border wiggle, so they can spill a little past a
// biome's edge; a foot past the chunk's edge uses the edge tile, so neighbouring chunks agree) and maybe places a
// sprite there with a one-pixel shadow to the bottom right. An art pixel can be covered by the spots of at most
// 2 x 2 cells; lower rows are looked at first, since they're in front
vec3 decorate(ivec2 a, vec3 c) {
  ivec2 ga = a + ivec2(g_off);
  ivec2 cA = ivec2(floor(vec2(ga - 7) / 8.0)), cB = ga >> 3;
  bool shade = false;
  for (int cy = cB.y; cy >= cA.y; cy--) for (int cx = cB.x; cx >= cA.x; cx--) {
    uint hh = hashu(uvec2(ivec2(cx, cy)) ^ uvec2(0x51edu, 0x2701u));
    ivec2 A = ivec2(cx, cy) * 8 + ivec2(int(hh & 7u) % 7, int((hh >> 3) & 7u) % 7);
    ivec2 q = ga - A;
    if (any(lessThan(q, ivec2(0))) || any(greaterThan(q, ivec2(8)))) continue;   // too far for sprite or shadow
    ivec2 foot = clamp(((A + ivec2(4, 6)) - ivec2(g_off)) >> 3, ivec2(0), ivec2(u_map) - 1);
    uvec2 id = texelFetch(u_ids, foot, 0).rg;
    if (id.g != 0u || float((hh >> 8) & 1023u) / 1023.0 >= u_biome[int(id.r)].x) continue;
    int k = u_decoK[int(id.r)][int((hh >> 18) & 3u)];
    if (k < 0) continue;
    int slot = k + int((hh >> 20) & 3u);
    if (all(lessThan(q, ivec2(8)))) {
      vec4 sp = atlasPix(slot, q);
      if (sp.a > 0.5) return sp.rgb * g_land * (0.9 + 0.2 * float((hh >> 26) & 15u) / 15.0);
    }
    ivec2 qs = q - ivec2(1, 1);
    if (!shade && all(greaterThanEqual(qs, ivec2(0))) && all(lessThan(qs, ivec2(8)))) shade = atlasPix(slot, qs).a > 0.5;
  }
  return shade ? c * 0.68 : c;
}

// Big props (trees, boulders): 16 x 24 art px sprites (art.js), one spot per 12 x 12 cell of global art pixels,
// nudged 0..11 px, standing on the ground under its foot (sprite pixel (8, 22)). Lower rows are nearer, so they're
// looked at first and layered front to back until something fully covers the spot. A pixel-art sprite carries its
// own shadow (alpha ~0.38); a high-resolution one casts its own outline, softened, down and to the right. Returns
// premultiplied colour + coverage, and how much shadow falls on the ground here (0..1)
const int PG = 12;
const vec2 HD_SHADOW = vec2(3.0, 2.0);   // how far a high-resolution prop's shadow falls (art px)
// a high-resolution prop's texel at s (art px inside its 16 x 24 box); nothing outside the box
vec4 hdTex(int cell, vec2 s, float lod) {
  if (any(lessThan(s, vec2(0.0))) || any(greaterThanEqual(s, vec2(16.0, 24.0)))) return vec4(0.0);
  int cols = int(u_hdInfo.z);
  vec2 p = vec2(float(cell % cols), float(cell / cols)) * u_hdInfo.xy + s * u_hdInfo.w;
  return textureLod(u_hd, p / u_hdSize, lod);
}
vec4 props(ivec2 a, out float shade) {
  ivec2 ga = a + ivec2(g_off);
  ivec2 cA = ivec2(floor(vec2(ga - ivec2(30, 37)) / float(PG))), cB = ivec2(floor(vec2(ga) / float(PG)));
  shade = 0.0;
  vec4 acc = vec4(0.0);
  for (int cy = cB.y; cy >= cA.y; cy--) for (int cx = cB.x; cx >= cA.x; cx--) {
    uint hh = hashu(uvec2(ivec2(cx, cy)) ^ uvec2(0x2b9fu, 0x6d31u));
    ivec2 A = ivec2(cx, cy) * PG + ivec2(int(hh & 15u) % PG, int((hh >> 4) & 15u) % PG);
    ivec2 q = ga - A;
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, ivec2(19, 26)))) continue;   // past sprite and shadow
    ivec2 foot = clamp(((A + ivec2(8, 22)) - ivec2(g_off)) >> 3, ivec2(0), ivec2(u_map) - 1);
    uvec2 id = texelFetch(u_ids, foot, 0).rg;
    if (id.g != 0u || float((hh >> 8) & 1023u) / 1023.0 >= u_biome[int(id.r)].z) continue;
    int k = u_propK[int(id.r)][int((hh >> 18) & 3u)];
    if (k < 0) continue;
    int v = int((hh >> 20) & 3u);
    float t = float((hh >> 22) & 255u) / 255.0 - 0.5;     // each one a little lighter or darker, warmer or cooler
    vec3 tint = g_land * (1.0 + t * 0.2) * vec3(1.0 + t * 0.08, 1.0, 1.0 - t * 0.08);
    int hd = u_hdK[k >> 4][(k >> 2) & 3];                  // k = prop kind * 4
    if (hd >= 0) {
      vec2 s = g_ap - vec2(A);
      vec4 sp = hdTex(hd + v, s, g_hdLod);
      if (sp.a > 0.003) {
        acc += (1.0 - acc.a) * vec4(sp.rgb * tint, sp.a);
        if (acc.a > 0.98) return vec4(acc.rgb / acc.a, 1.0);
      }
      shade = max(shade, hdTex(hd + v, s - HD_SHADOW, g_hdLod + 1.5).a);
      continue;
    }
    if (any(greaterThanEqual(q, ivec2(16, 24)))) continue;
    vec4 sp = texelFetch(u_atlas, ivec2(((k + v) & 15) * 16 + q.x, 256 + ((k + v) >> 4) * 24 + q.y), 0);
    if (sp.a > 0.7) return vec4(acc.rgb + (1.0 - acc.a) * sp.rgb * tint, 1.0);
    if (sp.a > 0.2) shade = 1.0;
  }
  return acc;
}

// Cliffs: the land's height (field map B, smooth between tiles) is cut into steps. Where a step drops toward the
// viewer, the art pixels below the edge are a rock face up to CLIFF_H tall: a lip of the ground above hanging over
// it, then three courses of rock blocks (see below), with cracks, darkening toward the foot. The face ends at a
// slightly different height every few pixels, so the foot is jagged, and below it lie a shadow and fallen stones. Steps that drop away or sideways draw only a lit edge
// on top, so cliffs come and go along a slope like real cliff bands. Only where the tile's cliff mask is on. A few
// looks up decide whether a face is near at all
const float CLIFF_STEP = 0.016;
const int CLIFF_H = 15;
float cliffLevel(ivec2 p) {
  float b = textureLod(u_fld, (vec2(p) + 0.5 + g_warp) / (u_map * 8.0), 0.0).b * 255.0 - 127.5;
  return floor((b >= 0.0 ? b / 300.0 : b / 600.0) / CLIFF_STEP);
}
vec3 cliff(ivec2 a, vec3 c) {
  float L0 = cliffLevel(a);
  if (cliffLevel(a - ivec2(0, CLIFF_H + 3)) != L0 || cliffLevel(a - ivec2(0, CLIFF_H / 2)) != L0 || cliffLevel(a - ivec2(0, 2)) != L0) {
    ivec2 ga = a + ivec2(g_off);
    for (int k = 1; k <= CLIFF_H + 3; k++) {
      float Lk = cliffLevel(a - ivec2(0, k));
      if (Lk <= L0) continue;
      int H = CLIFF_H - int(hashu(uvec2(uint(ga.x >> 2), uint(int(Lk)) + 31u)) & 3u);   // a jagged foot
      vec3 rock = mix(c, vec3(0.42, 0.37, 0.33), 0.62) * 0.9;
      if (k > H) {                                    // below the face: its shadow, and fallen stones
        if (k > H + 3) return c;
        float rr = hf(uvec2(ga) ^ uvec2(0x1234u, 0x5678u));
        if (rr > 0.84 && k <= H + 2) return rock * (1.0 - 0.3 * rr);
        return c * (k == H + 1 ? 0.45 : k == H + 2 ? 0.6 : 0.78);
      }
      if (k == 1) return c * 0.72;                    // the ground above, hanging over the edge
      // the face is three courses of rock blocks 3-7 px wide, staggered like rough masonry: each block lighter or
      // darker, lit along its top and left, creased dark along its right and bottom
      int cH = (H - 1) / 3, tier = min(2, (k - 2) / cH);
      int t0 = 2 + tier * cH, t1 = tier == 2 ? H : t0 + cH - 1;
      uint th = hashu(uvec2(uint(int(Lk) * 3 + tier), 0x9d2cu));
      int bx = ga.x + int(th % 10u), cell = bx / 10, inC = bx - cell * 10;
      uint ch = hashu(uvec2(uint(cell), th));
      int sp = 3 + int(ch % 5u);
      bool second = inC >= sp;
      int lx = second ? inC - sp : inC, w = second ? 10 - sp : sp;
      float f = 0.62 + 0.45 * float((second ? ch >> 8 : ch >> 16) & 255u) / 255.0;
      if (lx == 0) f += 0.22; else if (lx == w - 1) f -= 0.25;
      if (k == t0) f += 0.25; else if (k == t1) f -= 0.28;
      float grad = 1.0 - 0.32 * float(k - 2) / float(H - 1);
      float crack = hf(uvec2(ga) ^ uvec2(0xbeefu, 0x1ce5u)) > 0.94 ? 0.75 : 1.0;
      return rock * f * grad * crack;
    }
  }
  if (cliffLevel(a + ivec2(0, 1)) < L0) return c * 1.12 + 0.04;               // top edge of a drop toward the viewer
  return c;
}

// one art pixel of the surface: ground tile + overlay, looked up through the tile-id map. Deposits and buildings
// always sit on their own tile; only the ground under them wiggles
vec3 artPix(ivec2 a) {
  int W8 = int(u_map.x) * 8, H8 = int(u_map.y) * 8;
  a = clamp(a, ivec2(0), ivec2(W8 - 1, H8 - 1));
  ivec2 tile = a >> 3, inT = a & 7, gt = groundTile(a);
  uvec4 gq = texelFetch(u_ids, gt, 0), tq = texelFetch(u_ids, tile, 0);    // ground, overlay, richness, cliff mask
  uint gid = gq.r, oid = tq.g;
  uint h = hashu(uvec2(gt));
  int gslot = int(gid) * 4 + int(h & 3u);
  if (u_fx == 1 && u_biome[int(gid)].y > 0.5) gslot += 128;             // forest floor (SLOT_FLOOR) under scattered trees
  vec3 c = atlasPix(gslot, inT).rgb;
  bool water = u_fx == 1 && isWater(gid);
  if (water) {
    // smooth depth colour, keeping the tile art's ripples as light and dark
    vec3 tileBase = gid == 0u ? u_deep : u_shallow;
    float lum = dot(c, vec3(0.3, 0.5, 0.2)) / max(dot(tileBase, vec3(0.3, 0.5, 0.2)), 1e-3);
    vec2 g = vec2(a) + g_off;
    c = waterCol(g_depth) * clamp(lum, 0.88, 1.2);
    c *= 1.0 + 0.035 * sin(dot(g, vec2(0.31, 0.17)) + u_time * 1.3);           // slow swell
  } else if (u_fx == 1 && gid == 20u) {          // lava: patches glow brighter and dimmer
    vec2 g = vec2(a) + g_off;
    c *= 0.85 + 0.3 * (0.5 + 0.5 * sin(u_time * 0.9 + vn2(g / 9.0, 5u) * 6.283));
  }
  if (u_fx == 1 && !water && gid != 20u) {
    // soil stain under a deposit (following the wiggly ground borders), stronger toward the rich middle
    if (gq.g > 0u && gq.g < 16u) { vec4 st = u_oreStain[int(gq.g)]; c = mix(c, st.rgb, st.a * (0.35 + 0.65 * float(gq.b) / 255.0)); }
  }
  if (oid > 0u) {
    int var = int((hashu(uvec2(tile)) >> 2) & 3u);
    bool ore = u_fx == 1 && u_oreStain[int(oid)].a > 0.0;
    // the new look draws deposits by richness (SLOT_ORE): a few lumps at a patch's edge, packed in its middle
    vec4 v = atlasPix(ore ? 512 + int(oid) * 16 + min(3, int(float(tq.b) / 64.0)) * 4 + var : 256 + int(oid) * 4 + var, inT);
    if (ore && v.a > 0.5) {
      vec2 fx = u_oreFx[int(oid)];
      float r = hf(uvec2(a + ivec2(g_off)) ^ uvec2(0x3c6eu, 0xa54fu)), ph = fract(u_time * 0.4 + r * 23.0);
      if (r > 1.0 - 0.08 * fx.x) v.rgb += vec3(0.55) * smoothstep(0.0, 0.05, ph) * smoothstep(0.2, 0.05, ph);   // glint
      v.rgb *= 1.0 + fx.y * 0.5 * (0.5 + 0.5 * sin(u_time * 2.2 + float(tile.x + tile.y) * 0.6));             // glow
    }
    c = mix(c, v.rgb, v.a);
  }
  if (u_fx == 1 && !water && gid != 20u) c *= g_land;
  return c;
}

// The new look's finishing touches, once per screen pixel on the art pixel under it (after the anti-aliasing blend,
// which only needs the plain ground): surf and glints on water; cliffs on land; then big props (also just off the
// shore, so trees can hang over the water), and small decorations on land
vec3 finish(ivec2 a, vec3 c) {
  a = clamp(a, ivec2(0), ivec2(u_map) * 8 - 1);
  uvec4 gq = texelFetch(u_ids, groundTile(a), 0);
  bool water = isWater(gq.r);
  if (water) {
    // surf: a bright line where the next art pixel is land, and a softer band that washes in and out
    // (open water well away from any coast skips the look)
    bool shore = g_depth < 0.012 && (!isWater(texelFetch(u_ids, groundTile(a + ivec2(1, 0)), 0).r) || !isWater(texelFetch(u_ids, groundTile(a - ivec2(1, 0)), 0).r)
              || !isWater(texelFetch(u_ids, groundTile(a + ivec2(0, 1)), 0).r) || !isWater(texelFetch(u_ids, groundTile(a - ivec2(0, 1)), 0).r));
    float r = hf(uvec2(a + ivec2(g_off)) ^ uvec2(0x9e37u, 0x79b9u));
    float wash = smoothstep(0.004, 0.0, g_depth) * (0.5 + 0.5 * sin(u_time * 1.6 + r * 1.5));
    float foam = shore ? 0.75 + 0.25 * sin(u_time * 2.0 + r * 6.0) : wash * 0.35;
    c = mix(c, vec3(0.93, 0.97, 1.0), foam);
    float ph = fract(u_time * 0.3 + r * 17.0);                                     // glints
    if (r > 0.955 && !shore) c += vec3(0.32) * smoothstep(0.0, 0.06, ph) * smoothstep(0.22, 0.06, ph);
    if (g_depth > 0.01) return c;
  } else if (gq.a > 0u && gq.r != 20u) c = cliff(a, c);
  float sh;
  vec4 pr = props(a, sh);
  if (pr.a >= 1.0) return pr.rgb;
  if (!water) c = decorate(a, c);
  return pr.rgb + (1.0 - pr.a) * c * (1.0 - 0.38 * sh);
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
          g_ap = g + 0.5;
          // art pixels per screen pixel (u_pix > 1 draws blocks of pixels alike) x texels per art pixel
          g_hdLod = max(0.0, log2(u_map.x * 4.0 / (u_R * u_page.z) * max(u_pix, 1.0) * u_hdInfo.w));
          uint wj = hashu(uvec2(ivec2(floor(g))) ^ uvec2(0x7f4au, 0x1b3du));
          g_warp = (vec2(vn2(g / 11.0, 1u), vn2(g / 11.0, 2u)) - 0.5) * 6.5
                 + (vec2(float(wj & 255u), float((wj >> 8) & 255u)) / 255.0 - 0.5) * 1.6;
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
        if (u_fx == 1) ca = finish(ivec2(floor(ap + 0.5)), ca);
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
