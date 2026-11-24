// Labels on a 2D overlay canvas. Map-engine style: candidates come in every frame with a priority; every
// ~120 ms a greedy pass in priority order keeps the ones that don't overlap; each label fades toward
// shown/hidden, so nothing pops. Label images are cached, so text is rasterised once.

const cache = new Map();
function labelImage(text, style, dpr) {
  const key = text + '|' + style + '|' + dpr;
  let img = cache.get(key);
  if (img) return img;
  const big = style === 'star', small = style === 'small';
  const size = big ? 13 : small ? 10.5 : 12;
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `${big ? 700 : 600} ${size}px "Segoe UI", system-ui, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 12, h = Math.ceil(size + 8);
  c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
  g.scale(dpr, dpr);
  g.fillStyle = 'rgba(6, 9, 20, 0.62)';
  g.beginPath(); g.roundRect(0.5, 0.5, w - 1, h - 1, h / 2); g.fill();
  g.strokeStyle = style === 'home' ? 'rgba(242,193,78,0.8)' : 'rgba(150,170,220,0.22)'; g.lineWidth = 1; g.stroke();
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = style === 'home' ? '#f6d27a' : style === 'star' ? '#f2f5fb' : small ? '#c7d0e2' : '#e3e8f4';
  g.fillText(text, w / 2, h / 2 + 0.5);
  img = { c, w, h };
  if (cache.size > 3000) cache.clear();
  cache.set(key, img);
  return img;
}

export class Labels {
  constructor(canvas) {
    this.canvas = canvas; this.g = canvas.getContext('2d');
    this.cand = []; this.n = 0;
    this.state = new Map();       // key -> { a, show, seen }
    this.lastPlace = 0; this.frame = 0;
  }
  begin() { this.n = 0; this.frame++; }
  // x, y = anchor (css px), label is drawn centred below it at dy
  add(key, text, x, y, dy, priority, alpha, style) {
    if (alpha <= 0.01) return;
    let c = this.cand[this.n];
    if (!c) c = this.cand[this.n] = {};
    c.key = key; c.text = text; c.x = x; c.y = y; c.dy = dy; c.pri = priority; c.alpha = alpha; c.style = style;
    this.n++;
  }
  end(now, dt, dpr, cw, ch) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const list = this.cand.slice(0, this.n);
    for (const c of list) {
      let s = this.state.get(c.key);
      if (!s) { s = { a: 0, show: false, seen: 0, fresh: true }; this.state.set(c.key, s); }
      s.seen = this.frame; c.s = s;
      c.img = labelImage(c.text, c.style, dpr);
    }
    if (now - this.lastPlace > 120) {                  // greedy placement by priority
      this.lastPlace = now;
      list.sort((a, b) => (b.pri + (b.s.show ? 5 : 0)) - (a.pri + (a.s.show ? 5 : 0)));
      const placed = [];
      for (const c of list) {
        const w = c.img.w, h = c.img.h, x0 = c.x - w / 2, y0 = c.y + c.dy;
        let ok = x0 > -w && y0 > -h && x0 < cw && y0 < ch;
        if (ok) for (const r of placed) if (x0 < r[2] && x0 + w > r[0] && y0 < r[3] && y0 + h > r[1]) { ok = false; break; }
        if (ok) placed.push([x0 - 3, y0 - 2, x0 + w + 3, y0 + h + 2]);
        if (ok && !c.s.show && c.s.fresh) c.s.a = 0;
        c.s.show = ok; c.s.fresh = false;
      }
    }
    const k = Math.min(1, dt / 0.22);
    for (const c of list) {
      const s = c.s;
      s.a += ((s.show ? 1 : 0) - s.a) * k;
      const a = s.a * c.alpha;
      if (a < 0.02) continue;
      g.globalAlpha = a;
      g.drawImage(c.img.c, Math.round(c.x - c.img.w / 2), Math.round(c.y + c.dy), c.img.w, c.img.h);
    }
    g.globalAlpha = 1;
    if (this.frame % 120 === 0) for (const [k2, s] of this.state) if (this.frame - s.seen > 60) this.state.delete(k2);
  }
}
