// Thin WebGL2 renderer: a handful of programs, instanced sprites, one quad per visible body.
import * as S from './shaders.js?v=20261123210352';
import { ATLAS_W, ATLAS_H } from './art.js?v=20261123210352';

function compile(gl, vs, fs, attribs) {
  const mk = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
    return sh;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl; this.canvas = canvas;
    this.draws = 0; this.texBytes = 0;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.progSky = compile(gl, S.RECT_VS, S.SKY_FS, ['a_pos']);
    this.progTex = compile(gl, S.RECT_VS, S.TEX_FS, ['a_pos']);
    this.progBody = compile(gl, S.RECT_VS, S.BODY_FS, ['a_pos']);
    this.progSprite = compile(gl, S.SPRITE_VS, S.SPRITE_FS, ['a_pos', 'a_i0', 'a_col']);
    this.progOn = compile(gl, S.ONDISK_VS, S.ONDISK_FS, ['a_pos', 'a_s']);

    const buf = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const q01 = buf(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
    const qm = buf(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.vaoRect = gl.createVertexArray();
    gl.bindVertexArray(this.vaoRect);
    gl.bindBuffer(gl.ARRAY_BUFFER, q01); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.spriteBuf = gl.createBuffer(); this.spriteCap = 0;
    this.vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, qm); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);

    this.qm = qm;
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // tiny stand-in textures so samplers are always bound to something valid
    this.dummyIds = this.makeIdTexture(1, 1); this.dummyCol = this.makeColorTexture(1, 1);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
    this.w = w; this.h = h;
  }
  begin() {
    const gl = this.gl;
    this.draws = 0;
    gl.clearColor(0.012, 0.016, 0.035, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // ---------- textures ----------
  makeAtlas(data) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_W, ATLAS_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.atlas = t; this.texBytes += ATLAS_W * ATLAS_H * 4;
    return t;
  }
  makeIdTexture(W, H) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG8UI, W, H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.texBytes += W * H * 2;
    return t;
  }
  makeColorTexture(W, H) {
    const gl = this.gl, t = gl.createTexture();
    const levels = Math.floor(Math.log2(Math.max(W, H))) + 1;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, W, H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texBytes += W * H * 4 * 1.34;
    return t;
  }
  uploadBand(idTex, colTex, W, y0, rows, ids, col) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, idTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, rows, gl.RG_INTEGER, gl.UNSIGNED_BYTE, ids);
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, rows, gl.RGBA, gl.UNSIGNED_BYTE, col);
  }
  mipmap(colTex) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, colTex); gl.generateMipmap(gl.TEXTURE_2D); }
  freeMap(idTex, colTex, W, H) {
    this.gl.deleteTexture(idTex); this.gl.deleteTexture(colTex);
    this.texBytes -= W * H * 2 + W * H * 4 * 1.34;
  }
  makeGlowTexture(rgba, size) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texBytes += size * size * 4 * 1.34;
    return t;
  }

  // ---------- drawing ----------
  sky(cell, alpha) {
    const gl = this.gl, { p, u } = this.progSky;
    gl.useProgram(p); gl.bindVertexArray(this.vaoRect);
    gl.uniform4f(u.u_rect, 0, 0, this.w, this.h); gl.uniform2f(u.u_res, this.w, this.h);
    gl.uniform1f(u.u_cell, cell); gl.uniform1f(u.u_alpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.draws++;
  }
  texRect(tex, x0, y0, x1, y1, alpha) {
    const gl = this.gl, { p, u } = this.progTex;
    gl.useProgram(p); gl.bindVertexArray(this.vaoRect);
    gl.uniform4f(u.u_rect, x0, y0, x1, y1); gl.uniform2f(u.u_res, this.w, this.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.u_tex, 0); gl.uniform1f(u.u_alpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.draws++;
  }
  sprites(f32, count, ringW) {
    if (!count) return;
    const gl = this.gl, { p, u } = this.progSprite;
    gl.useProgram(p); gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf);
    if (f32.byteLength > this.spriteCap) { gl.bufferData(gl.ARRAY_BUFFER, f32.byteLength, gl.DYNAMIC_DRAW); this.spriteCap = f32.byteLength; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32, 0, count * 8);
    gl.uniform2f(u.u_res, this.w, this.h); gl.uniform1f(u.u_ringW, ringW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); this.draws++;
  }
  // b: a reused parameter object filled by main.js
  body(b) {
    const gl = this.gl, { p, u } = this.progBody;
    gl.useProgram(p); gl.bindVertexArray(this.vaoRect);
    gl.uniform4f(u.u_rect, b.x0, b.y0, b.x1, b.y1); gl.uniform2f(u.u_res, this.w, this.h);
    gl.uniform2f(u.u_center, b.cx, b.cy); gl.uniform1f(u.u_R, b.R);
    gl.uniform1i(u.u_mode, b.mode); gl.uniform1f(u.u_pix, b.pix);
    gl.uniform3f(u.u_light, b.lx, b.ly, b.lz);
    gl.uniform1i(u.u_hasMap, b.map ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, b.map ? b.map.ids : this.dummyIds); gl.uniform1i(u.u_ids, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b.map ? b.map.col : this.dummyCol); gl.uniform1i(u.u_col, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(u.u_atlas, 2);
    gl.uniform2f(u.u_map, b.map ? b.map.W : 1, b.map ? b.map.H : 1);
    gl.uniform1f(u.u_art, b.art); gl.uniform1f(u.u_lod, b.lod);
    gl.uniform4f(u.u_page, b.page[0], b.page[1], b.page[2], b.page[3]); gl.uniform1i(u.u_detail, b.detail ? 1 : 0);
    gl.uniform3f(u.u_c1, b.c1[0] / 255, b.c1[1] / 255, b.c1[2] / 255);
    gl.uniform3f(u.u_c2, b.c2[0] / 255, b.c2[1] / 255, b.c2[2] / 255);
    gl.uniform3f(u.u_c3, b.c3[0] / 255, b.c3[1] / 255, b.c3[2] / 255);
    gl.uniform1f(u.u_seed, b.seed); gl.uniform1f(u.u_time, b.time);
    gl.uniform4f(u.u_ring, b.ringIn, b.ringOut, b.ringA, b.ringGap);
    gl.uniform4f(u.u_atmo, b.atmo[0] / 255, b.atmo[1] / 255, b.atmo[2] / 255, b.atmo[3]);
    gl.uniform1f(u.u_atmoH, b.atmoH || 0.05);
    gl.uniform1f(u.u_alpha, b.alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.draws++;
  }
  // a layer of sprites standing on a planet's disk (own buffer, so static layers upload once)
  makeOnDiskLayer() {
    const gl = this.gl, L = { buf: gl.createBuffer(), vao: gl.createVertexArray(), cap: 0 };
    gl.bindVertexArray(L.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qm); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.buf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    return L;
  }
  onDisk(L, f32, count, upload, q) {
    if (!count) return;
    const gl = this.gl, { p, u } = this.progOn;
    gl.useProgram(p); gl.bindVertexArray(L.vao);
    if (upload) {
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buf);
      if (f32.byteLength > L.cap) { gl.bufferData(gl.ARRAY_BUFFER, f32.byteLength, gl.DYNAMIC_DRAW); L.cap = f32.byteLength; }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32, 0, count * 4);
    }
    gl.uniform2f(u.u_res, this.w, this.h); gl.uniform2f(u.u_center, q.cx, q.cy); gl.uniform1f(u.u_R, q.R);
    gl.uniform1f(u.u_size, q.size);
    gl.uniform1f(u.u_time, q.time); gl.uniform1f(u.u_walk, q.walk); gl.uniform1f(u.u_alpha, q.alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(u.u_atlas, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); this.draws++;
  }
}
