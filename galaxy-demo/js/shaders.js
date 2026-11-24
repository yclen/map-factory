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
out vec4 o;

uint hashu(uvec2 p) { uint h = (p.x * 0x27d4eb2du) ^ (p.y * 0x165667b1u); h ^= h >> 15; h *= 0x85ebca6bu; h ^= h >> 13; return h; }
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1) * 0.3 + vnoise(p * 4.3) * 0.15; }

// one art pixel of the surface: ground tile + overlay, looked up through the tile-id map
vec3 artPix(ivec2 a) {
  int W8 = int(u_map.x) * 8, H8 = int(u_map.y) * 8;
  a = clamp(a, ivec2(0), ivec2(W8 - 1, H8 - 1));
  ivec2 tile = a >> 3, inT = a & 7;
  uvec2 id = texelFetch(u_ids, tile, 0).rg;
  uint h = hashu(uvec2(tile));
  int s = int(id.r) * 4 + int(h & 3u);
  vec4 c = texelFetch(u_atlas, ivec2((s & 31) * 8 + inT.x, (s >> 5) * 8 + inT.y), 0);
  if (id.g > 0u) {
    int j = 256 + int(id.g) * 4 + int((h >> 2) & 3u);
    vec4 v = texelFetch(u_atlas, ivec2((j & 31) * 8 + inT.x, (j >> 5) * 8 + inT.y), 0);
    c.rgb = mix(c.rgb, v.rgb, v.a);
  }
  return c.rgb;
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  if (u_pix > 1.0) fc = (floor(fc / u_pix) + 0.5) * u_pix;
  vec2 d = (fc - u_center) / u_R;                    // -1..1 across the disk, y down
  float rr = length(d);
  vec2 uv = d * 0.5 + 0.5;                           // 0..1 across the disk's square map
  vec2 lp = (uv - u_page.xy) / u_page.zw;            // 0..1 across this chunk
  vec2 ap = lp * u_map * 8.0 - 0.5;                  // art-pixel coordinate within the chunk
  vec2 fw = clamp(fwidth(ap), vec2(1e-3), vec2(2.0));
  float edgeW = max(u_pix, 1.0) / u_R;
  if (u_detail == 1 && (rr > 1.0 || lp.x < 0.0 || lp.y < 0.0 || lp.x > 1.0 || lp.y > 1.0)) discard;

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
      if (u_art < 1.0) cc = textureLod(u_col, lp, u_lod).rgb;
      if (u_art > 0.0) {
        vec2 i = floor(ap), f = clamp((fract(ap) - 0.5) / fw + 0.5, 0.0, 1.0);
        ivec2 ii = ivec2(i);
        ca = mix(mix(artPix(ii), artPix(ii + ivec2(1, 0)), f.x), mix(artPix(ii + ivec2(0, 1)), artPix(ii + ivec2(1, 1)), f.x), f.y);
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
