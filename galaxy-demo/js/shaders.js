import { SLOPE_K } from './terrain.js?v=20261125163828';
import { ITEM_SLOTS } from './biomes.js?v=20261125163828';

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
// ground textures (the Biome Builder, for now): per ground type, the texture layer that replaces its tile art (-1 = tile
// art) and how many tiles one copy of the texture covers. Their relief is baked in (renderer.js bakeRelief). Sampled
// at every screen pixel, so they keep full detail
uniform mediump sampler2DArray u_gtex; uniform ivec4 u_gtexK[8]; uniform vec4 u_gtexS[8];
// how textured grounds blend into each other at borders (biomes.js blendTable; 1 = on, 0 = the old hard edges)
uniform sampler2D u_blend; uniform int u_blendOn;
// wet ground along shores: (how dark and glossy at the waterline 0..1, how far inland it reaches in tiles)
uniform vec2 u_wet;
// 1 = draw big props here, per pixel (the old way); 0 = they're drawn as pictures on top (PROPS_VS), the default
uniform int u_shaderProps;
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
vec2 g_dx = vec2(0.0), g_dy = vec2(0.0);   // how far g_ap moves per screen pixel (texture filtering)
vec4 g_gnd = vec4(0.0);   // the ground texture's colour at this screen pixel, blended across borders (a = 1 when set)
float g_wet = 0.0;        // how wet the ground is here (0..1): damp sand along shores
// the 4 tiles around this screen pixel (centres on whole numbers of g_ct; g_ci = the top-left one), read once
vec2 g_ct = vec2(0.0); ivec2 g_ci = ivec2(0); uvec4 g_cq[4];

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

// A tile's ids: ground, overlay, richness, and cliff (bit 7) + tiles from the nearest water (bits 0-6, 0 on water,
// 7 = far). The id map has a one-tile border from the neighbouring chunks (tile (0, 0) at texel (1, 1)), so borders
// blend and wiggle across chunk edges without a seam
uvec4 idAt(ivec2 t) { return texelFetch(u_ids, clamp(t, ivec2(-1), ivec2(u_map)) + 1, 0); }
// the ground tile an art pixel shows: its own tile, or a neighbour's when the border wiggles across
ivec2 groundTile(ivec2 a) {
  return clamp(ivec2(floor((vec2(a) + 0.5 + g_warp) / 8.0)), ivec2(-1), ivec2(u_map));
}
bool isWater(uint id) { return id <= 1u; }       // DEEP, SHALLOW
vec4 atlasPix(int s, ivec2 inT) { return texelFetch(u_atlas, ivec2((s & 31) * 8 + inT.x, (s >> 5) * 8 + inT.y), 0); }

// ---------- ground textures and the blend between them ----------
int gLayer(uint id) { return u_gtexK[int(id) >> 2][int(id) & 3]; }
bool textured(uint id) { return gLayer(id) >= 0 && !isWater(id); }
const vec3 LUM = vec3(0.3, 0.5, 0.2);
// one ground's texture at this screen pixel (full detail at any zoom). Its relief (light clumps standing up, dark
// cracks sinking, lit by the sun) is baked into the texture, each mip level on its own (renderer.js bakeRelief).
// Variety (blend table): so the texture doesn't visibly repeat, a smooth noise a few copies across picks one of 8
// shifted copies of it, blended over a narrow band where the pick changes, following the texture's own light and dark
// (Inigo Quilez's "texture repetition", technique 3). Two reads in those bands, one elsewhere
vec3 groundTex(uint gid) {
  int k = int(gid);
  float layer = float(gLayer(gid)), ts = u_gtexS[k >> 2][k & 3] * 8.0;   // art px per copy of the texture
  vec2 uv = g_ap / ts, gx = g_dx / ts, gy = g_dy / ts;
  float va = texelFetch(u_blend, ivec2(k, 1), 0).w;
  if (va <= 0.0) return textureGrad(u_gtex, vec3(uv, layer), gx, gy).rgb;
  float l = vn2(uv / 2.3 + float(k) * 7.31, 13u) * 8.0 * va, ia = floor(l), f = l - ia;
  vec3 ca = textureGrad(u_gtex, vec3(uv + sin(vec2(3.0, 7.0) * ia), layer), gx, gy).rgb;
  if (f < 0.2) return ca;
  vec3 cb = textureGrad(u_gtex, vec3(uv + sin(vec2(3.0, 7.0) * (ia + 1.0)), layer), gx, gy).rgb;
  if (f > 0.8) return cb;
  return mix(ca, cb, smoothstep(0.3, 0.7, f - 0.1 * dot(ca - cb, LUM)));
}
// how high a ground's texture stands at this pixel, for the blend: its brightness against the texture's average
// (its smallest mip level), scaled by the ground's height setting (< 0: its dark parts stand up)
float groundHeight(uint gid, vec3 c, float k) {
  float avg = dot(textureLod(u_gtex, vec3(0.5, 0.5, float(gLayer(gid))), 20.0).rgb, LUM);
  return clamp(0.5 + (dot(c, LUM) - avg) * 3.0 * k, 0.0, 1.0) * 0.5;
}
vec4 blendA(uint id) { return texelFetch(u_blend, ivec2(int(id), 0), 0); }   // width, creep, soft, style
vec4 blendB(uint id) { return texelFetch(u_blend, ivec2(int(id), 1), 0); }   // ragged, rim, height, -

// The ground at a screen pixel, blended where biomes meet. Ground ids are samples at tile centres: the 4 around the
// pixel (nudged by the same wiggle as groundTile) give smooth weights, and the two strongest grounds are mixed by
// their textures' bumps (sand settles between the stones, grass tufts poke over the dirt), with noise so the line
// isn't smooth. Where all 4 agree (most pixels) it's one texture read. Water and tile-art grounds take no part: they
// keep their own edges (a = 0 then)
vec4 groundBlend(vec2 ap) {
  // (plain vector maths, no little arrays indexed in loops: those make some GPUs slow down the whole shader)
  uvec4 I = uvec4(g_cq[0].r, g_cq[1].r, g_cq[2].r, g_cq[3].r);
  if (all(equal(I, I.xxxx))) return textured(I.x) ? vec4(groundTex(I.x), 1.0) : vec4(0.0);
  vec4 tx = vec4(textured(I.x), textured(I.y), textured(I.z), textured(I.w));   // 1 = a textured ground (takes part)
  vec4 A0 = blendA(I.x), A1 = blendA(I.y), A2 = blendA(I.z), A3 = blendA(I.w);
  // the band is as wide as the wider of the grounds wants
  vec4 wds = vec4(A0.x, A1.x, A2.x, A3.x) * tx;
  float wid = max(max(wds.x, wds.y), max(wds.z, wds.w));
  if (wid <= 0.0) return vec4(0.0);
  float hw = max(wid * 0.5, 0.02);
  // corner weights; the pixel and dither styles decide per art pixel (crisp, like the pixel art), soft per screen pixel
  vec2 tq = (floor(ap + 0.5) + 0.5 + g_warp) / 8.0 - 0.5;
  vec2 s = smoothstep(0.5 - hw, 0.5 + hw, g_ct - vec2(g_ci)), sq = smoothstep(0.5 - hw, 0.5 + hw, clamp(tq - vec2(g_ci), 0.0, 1.0));
  vec4 w = vec4((1.0 - s.x) * (1.0 - s.y), s.x * (1.0 - s.y), (1.0 - s.x) * s.y, s.x * s.y) * tx;
  vec4 wq = vec4((1.0 - sq.x) * (1.0 - sq.y), sq.x * (1.0 - sq.y), (1.0 - sq.x) * sq.y, sq.x * sq.y) * tx;
  // each corner's ground's whole weight (the same ground can sit at several corners), plus its creep: each ground
  // pushes into its neighbours a little
  vec4 e0 = vec4(equal(I, I.xxxx)), e1 = vec4(equal(I, I.yyyy)), e2 = vec4(equal(I, I.zzzz)), e3 = vec4(equal(I, I.wwww));
  vec4 cr = vec4(A0.y, A1.y, A2.y, A3.y) * 0.3;
  vec4 W = max(vec4(dot(w, e0), dot(w, e1), dot(w, e2), dot(w, e3)) + cr, 0.0) * tx;
  vec4 Wq = max(vec4(dot(wq, e0), dot(wq, e1), dot(wq, e2), dot(wq, e3)) + cr, 0.0) * tx;
  // the strongest ground, then the strongest other one
  float wa = max(max(W.x, W.y), max(W.z, W.w));
  int ka = W.x == wa ? 0 : W.y == wa ? 1 : W.z == wa ? 2 : 3;
  uint A = I[ka];
  vec4 Wb = W * vec4(notEqual(I, uvec4(A)));
  float wb = max(max(Wb.x, Wb.y), max(Wb.z, Wb.w));
  if (wb <= 0.0) return vec4(groundTex(A), 1.0);
  int kb = Wb.x == wb ? 0 : Wb.y == wb ? 1 : Wb.z == wb ? 2 : 3;
  uint B = I[kb];
  // the pair in a fixed order (lower id first), so nothing jumps where the strongest ground changes
  bool sw = B < A;
  uint P = sw ? B : A, Q = sw ? A : B;
  float wP = sw ? wb : wa, wQ = sw ? wa : wb, qP = Wq[sw ? kb : ka], qQ = Wq[sw ? ka : kb];
  vec4 aP = blendA(P), aQ = blendA(Q), bP = blendB(P), bQ = blendB(Q);
  float x = wP / max(wP + wQ, 1e-4), xq = qP / max(qP + qQ, 1e-4);   // P's share, 0..1
  float ragged = (bP.x + bQ.x) * 0.5;
  float style = aQ.y > aP.y ? aQ.w : aP.w;                             // the stronger-creeping ground's style
  vec3 cP = groundTex(P), cQ = groundTex(Q);
  float sh;                                                            // P's share of the colour
  if (style > 1.5) {                                                   // dither: stippled, anchored to the world
    ivec2 ac = ivec2(floor(g_ap));
    float nq = vn2((vec2(ac) + 0.5) / 5.0, 11u) - 0.5;
    sh = clamp(xq + nq * ragged * 0.6, 0.0, 1.0) > hf(uvec2(ac) ^ uvec2(0x51a7u, 0x2c4bu)) ? 1.0 : 0.0;
  } else if (style > 0.5) {                                            // pixel: whole art pixels, a ragged edge
    ivec2 ac = ivec2(floor(g_ap));
    float nq = (vn2((vec2(ac) + 0.5) / 5.0, 11u) - 0.5) * 0.7 + (hf(uvec2(ac)) - 0.5) * 0.3;
    sh = xq + nq * ragged > 0.5 ? 1.0 : 0.0;
  } else {                                                             // soft: mixed by the textures' bumps
    float nz = (vn2(g_ap / 5.0, 11u) - 0.5) * 0.7 + (vn2(g_ap / 1.7, 12u) - 0.5) * 0.3;
    x = clamp(x + nz * ragged * 0.5, 0.0, 1.0);
    float hP = groundHeight(P, cP, bP.z), hQ = groundHeight(Q, cQ, bQ.z);
    float depth = max((aP.z + aQ.z) * 0.5, 0.005);
    float ma = max(hP + x, hQ + 1.0 - x) - depth;
    float kP = max(hP + x - ma, 0.0), kQ = max(hQ + 1.0 - x - ma, 0.0);
    sh = kP / max(kP + kQ, 1e-5);
  }
  vec3 c = mix(cQ, cP, sh);
  // the rim: the band darkened or lightened, each ground on its own side
  float band = 1.0 - smoothstep(0.0, 0.32, abs(x - 0.5));
  c *= 1.0 + mix(bQ.y, bP.y, sh) * band * 0.45;
  return vec4(c, 1.0);
}

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
    uvec2 id = idAt(((A + ivec2(4, 6)) - ivec2(g_off)) >> 3).rg;
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
    uvec2 id = idAt(((A + ivec2(8, 22)) - ivec2(g_off)) >> 3).rg;
    // clumping (u_biome.w = clump size in tiles + strength 0..1 as its fraction; 0 = spread evenly): groves and gaps
    vec4 bi = u_biome[int(id.r)];
    float dens = bi.z;
    if (bi.w > 0.0) dens *= max(0.0, 1.0 + fract(bi.w) * 2.9 * (vn2(vec2(A) / (floor(bi.w) * 8.0), 9u) * 2.0 - 1.0));
    if (id.g != 0u || float((hh >> 8) & 1023u) / 1023.0 >= dens) continue;
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
  uvec4 gq = idAt(gt), tq = all(equal(gt, tile)) ? gq : idAt(tile);    // ground, overlay, richness, cliff + shore
  uint gid = gq.r, oid = tq.g;
  vec3 c;
  // a textured ground: this screen pixel's ground (blended across borders), worked out once per screen pixel in main;
  // else the tile art
  if (u_fx == 1 && textured(gid)) c = g_gnd.a > 0.0 ? g_gnd.rgb : groundTex(gid);
  else {
    int gslot = int(gid) * 4 + int(hashu(uvec2(gt)) & 3u);
    if (u_fx == 1 && u_biome[int(gid)].y > 0.5) gslot += 128;           // forest floor (SLOT_FLOOR) under scattered trees
    c = atlasPix(gslot, inT).rgb;
  }
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
  if (u_fx == 1 && !water && gid != 20u && g_wet > 0.0 && (gid < 14u || gid > 17u)) {   // not on snow and ice
    float lw = dot(c, LUM);
    c = mix(c, mix(vec3(lw), c, 1.3) * vec3(0.6, 0.62, 0.66), g_wet * 0.85);       // damp: darker, deeper colour
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
  uvec4 gq = idAt(groundTile(a));
  bool water = isWater(gq.r);
  if (water) {
    // surf: a bright line where the next art pixel is land, and a softer band that washes in and out
    // (open water well away from any coast skips the look)
    bool shore = g_depth < 0.012 && (!isWater(idAt(groundTile(a + ivec2(1, 0))).r) || !isWater(idAt(groundTile(a - ivec2(1, 0))).r)
              || !isWater(idAt(groundTile(a + ivec2(0, 1))).r) || !isWater(idAt(groundTile(a - ivec2(0, 1))).r));
    float r = hf(uvec2(a + ivec2(g_off)) ^ uvec2(0x9e37u, 0x79b9u));
    float wash = smoothstep(0.004, 0.0, g_depth) * (0.5 + 0.5 * sin(u_time * 1.6 + r * 1.5));
    float foam = shore ? 0.75 + 0.25 * sin(u_time * 2.0 + r * 6.0) : wash * 0.35;
    c = mix(c, vec3(0.93, 0.97, 1.0), foam);
    float ph = fract(u_time * 0.3 + r * 17.0);                                     // glints
    if (r > 0.955 && !shore) c += vec3(0.32) * smoothstep(0.0, 0.06, ph) * smoothstep(0.22, 0.06, ph);
    if (g_depth > 0.01) return c;
  } else if ((gq.a & 128u) != 0u && gq.r != 20u) c = cliff(a, c);
  float sh = 0.0;
  vec4 pr = vec4(0.0);
  if (u_shaderProps == 1) pr = props(a, sh);
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
  g_dx = dFdx(ap); g_dy = dFdy(ap);
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
          // the 4 tiles around this pixel (nudged by the same wiggle as groundTile), for the blend and the wet shore
          g_ct = (ap + 0.5 + g_warp) / 8.0 - 0.5;
          g_ci = ivec2(floor(g_ct));
          g_cq[0] = idAt(g_ci); g_cq[1] = idAt(g_ci + ivec2(1, 0)); g_cq[2] = idAt(g_ci + ivec2(0, 1)); g_cq[3] = idAt(g_ci + ivec2(1, 1));
          if (u_wet.x > 0.0) {
            // tiles from the water, smoothed between tile centres (0 on water: the waterline is about half a tile)
            vec2 f = g_ct - vec2(g_ci);
            float d0 = float(g_cq[0].a & 127u), d1 = float(g_cq[1].a & 127u), d2 = float(g_cq[2].a & 127u), d3 = float(g_cq[3].a & 127u);
            if (min(min(d0, d1), min(d2, d3)) < 7.0) {
              float d = mix(mix(d0, d1, f.x), mix(d2, d3, f.x), f.y) + (vn2(g / 9.0, 14u) - 0.5) * 1.2 + (vn2(g / 2.5, 15u) - 0.5) * 0.35;
              g_wet = u_wet.x * (1.0 - smoothstep(0.45, 0.5 + u_wet.y, d));
            }
          }
          g_gnd = u_blendOn == 1 ? groundBlend(ap) : vec4(0.0);
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

// ---------- items (trees, boulders, shrubs, grass) as pictures: one instanced quad per spot ----------
// Each instance is a spot from the map worker (terrain.js propSpots): box corner in global art px, ground id, hash.
// What grows there comes from the item table (biomes.js itemTable): the row for this ground type and layer lists up
// to 8 items with their density, clumping, atlas cell, size and size spread; a spot's random number picks one in
// proportion to their densities (or none). So designs change instantly, without rebuilding maps. Sizes scale the
// 16 x 24 art px box (2 x 3 tiles) about its foot. The shadow passes draw into the shadow layer:
//   u_shadow = 1, the cast shadow: each picture's silhouette laid down flat, the way Factorio casts shadows, its top
//     reaching out along u_shadowDir (art px per art px of height). Its base (the part touching the ground, u_cells)
//     stays where it is, so the shadow grows out from under the item instead of starting beside it. Drawn as a strip
//     of 6 points: bottom, top of the base (a_pos.y = 0.5), top
//   u_shadow = 2, the contact shadow: a soft dark oval on the ground under the base, so things sit on the ground
// u_cells: per atlas cell, its picture's base: (left, right, height) in art px across the cell (assets.js baseSpan)
export const PROPS_VS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
in vec2 a_pos; in uvec4 a_t;
uniform vec2 u_res; uniform vec2 u_center; uniform float u_R; uniform float u_W8;
uniform sampler2D u_items; uniform int u_layer;
uniform sampler2D u_fld; uniform vec4 u_chunk; uniform float u_tpp; uniform int u_shadow; uniform vec2 u_shadowDir;
uniform sampler2D u_cells; uniform int u_hasCells;
out vec2 v_s; out vec3 v_tint; flat out int v_cell;
const float SLOPE_K = ${SLOPE_K}.0;
const vec3 SUN = vec3(-0.55, -0.65, 0.75);
uint hashu(uvec2 p) { uint h = (p.x * 0x27d4eb2du) ^ (p.y * 0x165667b1u); h ^= h >> 15; h *= 0x85ebca6bu; h ^= h >> 13; return h; }
float hf(uvec2 p) { return float(hashu(p) & 65535u) / 65535.0; }
float vn2(vec2 p, uint s) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  uvec2 q = uvec2(ivec2(i)) + uvec2(s * 7919u, s * 104729u);
  return mix(mix(hf(q), hf(q + uvec2(1, 0)), f.x), mix(hf(q + uvec2(0, 1)), hf(q + uvec2(1, 1)), f.x), f.y);
}
float hillShade(vec4 F) {
  vec2 y = clamp(F.rg * 2.0 - 1.0, -0.98, 0.98), sl = y / (1.0 - abs(y)) / SLOPE_K;
  float W = u_tpp * 2.0 * u_R;
  float ex = min(65.0 * sqrt(max(u_tpp, 0.125) / 0.125), 0.1 * W) * sqrt(clamp(W / 4096.0, 0.06, 1.0));
  vec3 n = normalize(vec3(-sl * ex, 1.0)), L = normalize(SUN);
  return clamp(dot(n, L) / L.z, 0.55, 1.35);
}
vec3 landTint(vec4 F) { float v = F.a * 2.0 - 1.0; return (1.0 + v * 0.09) * vec3(1.0 + v * 0.05, 1.0, 1.0 - v * 0.06); }
void main() {
  uint hh = a_t.w;
  int row = int(a_t.z) * 2 + u_layer;
  vec2 A = vec2(ivec2(a_t.xy));
  float r = float((hh >> 8) & 1023u) / 1023.0, c = 0.0;
  vec4 it = vec4(0.0);
  for (int j = 0; j < ${ITEM_SLOTS}; j++) {
    vec4 a = texelFetch(u_items, ivec2(j, row), 0);
    if (a.x <= 0.0) continue;
    float d = a.x;
    vec4 b = texelFetch(u_items, ivec2(${ITEM_SLOTS} + j, row), 0);
    if (b.x > 0.0) d *= max(0.0, 1.0 + b.x * 2.9 * (vn2(A / (b.y * 8.0), uint(9 + j)) * 2.0 - 1.0));
    c += d;
    if (r < c) { it = a; break; }
  }
  if (it.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // nothing grows here: off screen
  uint h2 = hashu(uvec2(hh, 0x5bd1u));
  float sc = it.z * (1.0 + it.w * (float(h2 & 1023u) / 1023.0 * 2.0 - 1.0));
  int cell = int(it.y) + int((hh >> 20) & 3u);
  // the picture's base: left and right edge and how high it touches the ground (art px), else a typical one
  vec4 ci = u_hasCells == 1 ? texelFetch(u_cells, ivec2(cell & 255, cell >> 8), 0) : vec4(4.0, 12.0, 2.0, 0.0);
  vec2 FT = A + vec2(8.0, 23.0);                        // the foot, global art px
  vec2 s = a_pos * vec2(16.0, 24.0), g;                 // art px inside the sprite's box
  if (u_shadow == 2) {
    // the contact shadow: an oval a little wider than the base, mostly behind its front edge
    float rx = (ci.y - ci.x) * 0.6 + 0.8, ry = rx * 0.42;
    v_s = a_pos * 2.0 - 1.0;
    g = FT + (vec2((ci.x + ci.y) * 0.5 - 8.0, -ry * 0.4) + v_s * vec2(rx, ry)) * sc;
  } else {
    if (u_shadow == 1 && a_pos.y > 0.25 && a_pos.y < 0.75) s.y = 23.0 - ci.z;   // the middle row: the top of the base
    vec2 d = (s - vec2(8.0, 23.0)) * sc;                // art px from the foot (d.y < 0 above it)
    g = FT + d;
    // the cast shadow: the base stays put (it's on the ground); above it, each point moves out along the shadow's
    // direction by its height above the base. Nudged a touch down-right so a thin dark rim shows along the base
    if (u_shadow == 1) {
      float b = ci.z * sc, hgt = -d.y;
      g = FT + vec2(d.x, -min(hgt, b)) + max(hgt - b, 0.0) * u_shadowDir + vec2(0.8, 0.5) * sc;
    }
    v_s = s;
  }
  vec2 px = u_center + (g / u_W8 * 2.0 - 1.0) * u_R;    // device px, y down
  gl_Position = vec4(px.x / u_res.x * 2.0 - 1.0, 1.0 - px.y / u_res.y * 2.0, 0.0, 1.0);
  v_cell = cell;
  // each one a little lighter or darker, warmer or cooler, and lit like the ground under its foot
  float t = float((hh >> 22) & 255u) / 255.0 - 0.5;
  vec2 foot = floor((A + vec2(8.0, 22.0)) / 8.0);
  vec4 F = textureLod(u_fld, (foot - u_chunk.xy + 0.5) / u_chunk.zw, 0.0);
  v_tint = (1.0 + t * 0.2) * vec3(1.0 + t * 0.08, 1.0, 1.0 - t * 0.08) * hillShade(F) * landTint(F);
}`;

export const PROPS_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 v_s; in vec3 v_tint; flat in int v_cell;
uniform sampler2D u_hd; uniform vec4 u_hdInfo; uniform vec2 u_hdSize;
uniform int u_shadow; uniform float u_alpha;
out vec4 o;
void main() {
  // the shadow layer keeps the cast shadow in red and the contact shadow in green (blended by MAX, each its own)
  if (u_shadow == 2) { float a = 1.0 - smoothstep(0.1, 1.0, length(v_s)); o = vec4(0.0, a * a, 0.0, a * a); return; }
  int cols = int(u_hdInfo.z);
  vec2 s = clamp(v_s, vec2(0.25), vec2(15.75, 23.75));
  vec2 p = vec2(float(v_cell % cols), float(v_cell / cols)) * u_hdInfo.xy + s * u_hdInfo.w;
  if (u_shadow == 1) { float a = texture(u_hd, p / u_hdSize, 1.5).a; o = vec4(a, 0.0, 0.0, a); return; }   // softened
  vec4 c = texture(u_hd, p / u_hdSize);                 // premultiplied
  if (c.a < 0.003) discard;
  o = vec4(c.rgb * v_tint, c.a) * u_alpha;
}`;

// the shadow layer laid down once over the ground: darkens what's under it, never doubles up where shadows overlap
export const SHADE_FS = `#version 300 es
precision highp float;
in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha; uniform float u_dark; uniform float u_contact;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y));   // r: cast shadows, g: contact shadows
  o = vec4(0.0, 0.0, 0.0, u_alpha * (1.0 - (1.0 - u_dark * t.r) * (1.0 - u_contact * t.g)));
}`;

