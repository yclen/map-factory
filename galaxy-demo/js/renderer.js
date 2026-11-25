// Thin WebGL2 renderer: a handful of programs, instanced sprites, one quad per visible body.
import * as S from './shaders.js?v=20261125141207';
import { ATLAS_W, ATLAS_H } from './art.js?v=20261125141207';

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
    this.progProps = compile(gl, S.PROPS_VS, S.PROPS_FS, ['a_pos', 'a_t']);
    this.progShade = compile(gl, S.RECT_VS, S.SHADE_FS, ['a_pos']);

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

    this.qm = qm; this.q01 = q01;
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // tiny stand-in textures so samplers are always bound to something valid
    this.dummyIds = this.makeIdTexture(1, 1); this.dummyCol = this.makeColorTexture(1, 1);
    this.dummyFld = this.makeColorTexture(1, 1, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 128]));
    this.water = [[0, 0, 0], [0, 0, 0]];      // deep and shallow water colours (0..255), set from the skin
    this.gtex = this.makeGroundTextures([], 1);   // no ground textures until setGroundTextures
    // the tables both the terrain and the prop programs read (kept, so either can be changed alone)
    this.tables = null; this.hdK = new Int32Array(32).fill(-1); this.hdInfo = [128, 192, 8, 8]; this.hdSize = [1, 1];
    this.gK = new Int32Array(32).fill(-1); this.gS = new Float32Array(32).fill(8); this.gR = new Float32Array(32);
    // item shadows, Factorio style: len = shadow length per unit of an item's height, angle = degrees below the
    // horizontal (to the right), dark = how dark (0..1). biomes.js SHADOW has the defaults
    this.shadow = { len: 1.1, angle: 25, dark: 0.45 };
    this.items = null; this.itemTex = null; this.itemTable = null; this.itemInfo = [128, 192, 8, 8]; this.itemSize = [1, 1];
    this.shadowFb = null; this.shadowTex = null; this.shadowW = 0; this.shadowH = 0;
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
  // decoration tables (art.js decorTables): uniforms keep their values, so they're set once
  setDecor(t) {
    this.tables = t;
    const gl = this.gl, { p, u } = this.progBody;
    gl.useProgram(p);
    gl.uniform4fv(u['u_biome[0]'], t.B); gl.uniform4iv(u['u_propK[0]'], t.PK);
    gl.uniform4iv(u['u_decoK[0]'], t.K); gl.uniform4fv(u['u_oreStain[0]'], t.S); gl.uniform2fv(u['u_oreFx[0]'], t.X);
    this.applyPropTables();
  }
  // the old per-pixel props' atlas cells (only used when no item designs are loaded) and the ground textures
  applyPropTables() {
    const gl = this.gl, { p, u } = this.progBody;
    gl.useProgram(p);
    gl.uniform4iv(u['u_hdK[0]'], this.hdK);
    gl.uniform4f(u.u_hdInfo, this.hdInfo[0], this.hdInfo[1], this.hdInfo[2], this.hdInfo[3]);
    gl.uniform2f(u.u_hdSize, this.hdSize[0], this.hdSize[1]);
    gl.uniform4iv(u['u_gtexK[0]'], this.gK); gl.uniform4fv(u['u_gtexS[0]'], this.gS); gl.uniform4fv(u['u_gtexR[0]'], this.gR);
    gl.uniform1i(u.u_shaderProps, this.items ? 0 : 1);
    if (this.tables) {                                      // items include the small things: no tile-art decorations
      const B = this.tables.B.slice();
      if (this.items) for (let i = 0; i < B.length; i += 4) B[i] = 0;
      gl.uniform4fv(u['u_biome[0]'], B);
    }
  }
  // Items (biomes.js): the atlas of their pictures (4 variants per skin, 16 x 24 art px cells, premultiplied
  // alpha) and the table of what grows where. Once set, items are drawn as pictures (drawProps) and the terrain
  // shader stops drawing props itself. img = null keeps the current atlas
  setItems(img, meta, table) {
    const gl = this.gl;
    if (img) {
      if (this.itemTex) gl.deleteTexture(this.itemTex);
      this.itemTex = this.uploadSpriteAtlas(img);
      this.itemInfo = [meta.cell[0], meta.cell[1], meta.cols, meta.scale]; this.itemSize = [img.width, img.height];
    }
    if (table) {
      if (!this.itemTable) {
        this.itemTable = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.itemTable);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, table.width, table.height);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      }
      gl.bindTexture(gl.TEXTURE_2D, this.itemTable);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, table.width, table.height, gl.RGBA, gl.FLOAT, table.data);
    }
    this.items = !!(this.itemTex && this.itemTable);
    this.applyPropTables();
  }
  uploadSpriteAtlas(img) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);    // premultiplied, so smooth edges and mipmaps stay clean
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 5);   // past this, neighbouring cells would blur together
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texBytes += img.width * img.height * 4 * 1.34;
    return t;
  }
  // Ground textures (Biome Builder): `layers` = square images (canvases) of `size` px, one texture-array layer each;
  // K = per ground type, its layer or -1 (tile art); S = per ground type, tiles covered by one copy of its texture
  makeGroundTextures(layers, size) {
    const gl = this.gl, t = gl.createTexture(), n = Math.max(1, layers.length);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    const levels = Math.floor(Math.log2(size)) + 1;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, n);
    layers.forEach((img, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, img));
    if (layers.length) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  // K, S, Rl: per ground id, its layer (-1 = none), tiles per copy, relief (0 = flat; optional)
  setGroundTextures(layers, size, K, S, Rl) {
    const gl = this.gl;
    gl.deleteTexture(this.gtex);
    this.gtex = this.makeGroundTextures(layers, size);
    this.gK = K; this.gS = S; this.gR = Rl || new Float32Array(32);
    this.applyPropTables();
  }

  // ---------- items as pictures ----------
  // one chunk's spots for one layer (terrain.js propSpots: 4 x uint32 per spot) as an instance buffer
  makePropBuffer(u32) {
    const gl = this.gl, P = { buf: gl.createBuffer(), vao: gl.createVertexArray(), n: u32.length / 4, bytes: u32.byteLength };
    gl.bindVertexArray(P.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.q01); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.buf);
    gl.bufferData(gl.ARRAY_BUFFER, u32, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_INT, 16, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.texBytes += P.bytes;
    return P;
  }
  freePropBuffer(P) { this.gl.deleteBuffer(P.buf); this.gl.deleteVertexArray(P.vao); this.texBytes -= P.bytes; }
  // Draw the items of some chunks (listed top to bottom, so nearer ones end up in front; small items under big ones):
  // first every item's silhouette, laid down flat from its foot (this.shadow), onto a shadow layer (overlaps keep the darkest, never add up),
  // laid over the ground once; then the items themselves. chunks: [{ big, small (spot buffers), fld,
  // chunk: [x0, y0, w, h] in tiles }]; q: { cx, cy, R (device px), W8 (art px across the disk's square), tpp, alpha, shadows }
  // how far shadows reach from an item's foot, in tiles per unit of item size (it's 3 tiles tall): [sideways, down]
  shadowReach() {
    const a = this.shadow.angle * Math.PI / 180;
    return [3 * this.shadow.len * Math.abs(Math.cos(a)), 3 * this.shadow.len * Math.abs(Math.sin(a))];
  }
  drawProps(chunks, q) {
    if (!chunks.length || !this.items) return;
    const gl = this.gl, { p, u } = this.progProps;
    const pass = shadow => {
      gl.useProgram(p);
      gl.uniform2f(u.u_res, this.w, this.h); gl.uniform2f(u.u_center, q.cx, q.cy); gl.uniform1f(u.u_R, q.R);
      gl.uniform1f(u.u_W8, q.W8); gl.uniform1f(u.u_tpp, q.tpp); gl.uniform1i(u.u_shadow, shadow ? 1 : 0);
      const sa = this.shadow.angle * Math.PI / 180;
      gl.uniform2f(u.u_shadowDir, Math.cos(sa) * this.shadow.len, Math.sin(sa) * this.shadow.len);
      gl.uniform1f(u.u_alpha, q.alpha);
      gl.uniform4f(u.u_hdInfo, ...this.itemInfo); gl.uniform2f(u.u_hdSize, ...this.itemSize);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.itemTex); gl.uniform1i(u.u_hd, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.itemTable); gl.uniform1i(u.u_items, 1);
      gl.uniform1i(u.u_fld, 2);
      for (const layer of ['small', 'big']) {
        gl.uniform1i(u.u_layer, layer === 'big' ? 0 : 1);
        for (const c of chunks) {
          const buf = c[layer];
          if (!buf || !buf.n) continue;
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, c.fld);
          gl.uniform4f(u.u_chunk, c.chunk[0], c.chunk[1], c.chunk[2], c.chunk[3]);
          gl.bindVertexArray(buf.vao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buf.n); this.draws++;
        }
      }
    };
    if (q.shadows !== false) {
      // the shadow layer is drawn at half resolution: shadows are soft anyway, and it's 4x fewer pixels
      const sw = Math.max(1, this.w >> 1), sh = Math.max(1, this.h >> 1);
      if (!this.shadowFb || this.shadowW !== sw || this.shadowH !== sh) {
        if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFb); }
        this.shadowTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, sw, sh);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.shadowFb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shadowTex, 0);
        this.shadowW = sw; this.shadowH = sh;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
      gl.viewport(0, 0, sw, sh);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendEquation(gl.MAX);
      pass(true);
      gl.blendEquation(gl.FUNC_ADD);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
      const sp = this.progShade;
      gl.useProgram(sp.p); gl.bindVertexArray(this.vaoRect);
      gl.uniform4f(sp.u.u_rect, 0, 0, this.w, this.h); gl.uniform2f(sp.u.u_res, this.w, this.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(sp.u.u_tex, 0);
      gl.uniform1f(sp.u.u_alpha, q.alpha); gl.uniform1f(sp.u.u_dark, this.shadow.dark);
      gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.draws++;
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    pass(false);
  }
  // High-resolution props (tools/pack_props.py): an image atlas of 4 variants per prop kind, drawn smoothly instead
  // of the pixel-art props. hdK = per prop kind (skin order), the atlas cell of its variant 0, or -1 = keep pixel art
  setHdProps(img, meta, hdK) {
    if (this.hdProps) this.gl.deleteTexture(this.hdProps);
    this.hdProps = this.uploadSpriteAtlas(img);
    this.hdK = hdK; this.hdInfo = [meta.cell[0], meta.cell[1], meta.cols, meta.scale]; this.hdSize = [img.width, img.height];
    this.applyPropTables();
  }
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
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8UI, W, H);   // ground, overlay, richness, cliff mask
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.texBytes += W * H * 4;
    return t;
  }
  // smooth = filter between samples when magnified (the field map); the colour map stays crisp
  makeColorTexture(W, H, smooth = false) {
    const gl = this.gl, t = gl.createTexture();
    const levels = Math.floor(Math.log2(Math.max(W, H))) + 1;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, W, H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texBytes += W * H * 4 * 1.34;
    return t;
  }
  uploadBand(idTex, colTex, W, y0, rows, ids, col, fldTex, fld) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, idTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, rows, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, ids);
    gl.bindTexture(gl.TEXTURE_2D, colTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, rows, gl.RGBA, gl.UNSIGNED_BYTE, col);
    gl.bindTexture(gl.TEXTURE_2D, fldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, rows, gl.RGBA, gl.UNSIGNED_BYTE, fld);
  }
  mipmap(...texs) { const gl = this.gl; for (const t of texs) { gl.bindTexture(gl.TEXTURE_2D, t); gl.generateMipmap(gl.TEXTURE_2D); } }
  freeMap(idTex, colTex, fldTex, W, H) {
    this.gl.deleteTexture(idTex); this.gl.deleteTexture(colTex); this.gl.deleteTexture(fldTex);
    this.texBytes -= W * H * 4 + W * H * 8 * 1.34;
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
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, b.map ? b.map.fld : this.dummyFld); gl.uniform1i(u.u_fld, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.hdProps || this.dummyCol); gl.uniform1i(u.u_hd, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.gtex); gl.uniform1i(u.u_gtex, 5);
    gl.uniform1i(u.u_fx, b.fx ? 1 : 0); gl.uniform1f(u.u_tpp, b.tpp || 0);
    const [wd, ws] = this.water;
    gl.uniform3f(u.u_deep, wd[0] / 255, wd[1] / 255, wd[2] / 255); gl.uniform3f(u.u_shallow, ws[0] / 255, ws[1] / 255, ws[2] / 255);
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
