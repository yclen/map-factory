"""Turn AI-generated prop sheets into the Galaxy demo's high-resolution prop atlas.

Each entry in art/props/props.json names a big-prop kind from galaxy-demo/js/skin.js (oak, pine, boulder, ...) and
a raw sheet in art/props/raw/: several variations of that prop in a grid, on a flat magenta (#FF00FF) background or
a transparent one. This script cuts each variation out, stands it on the prop's foot point and packs 4 variations per
kind into galaxy-demo/props/props_hd.png, with props_hd.json saying where each kind is. The demo draws those kinds
from the atlas and keeps its pixel-art props for everything else.

Run after adding or changing a sheet:  python tools/pack_props.py
Add --preview to also write tools/previews/props_preview.png (every packed sprite on a ground colour, with its foot).

Manifest entry fields (only "sheet" is required):
  sheet  raw sheet, relative to art/props/raw/
  grid   [columns, rows] of the sheet (default [3, 2])
  pick   which cells to use, reading left to right, top to bottom (default the first 4)
  size   how much of the 16 x 23 art-pixel space the prop fills, 0..1 (default 1; boulders look right around 0.6)
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'props' / 'raw'
MANIFEST = ROOT / 'art' / 'props' / 'props.json'
OUT = ROOT / 'galaxy-demo' / 'props'

# must match the pixel-art props in galaxy-demo/js/ids.js: 16 x 24 art pixels, foot at the bottom middle of row 22
PROP_W, PROP_H, FOOT_X, FOOT_Y = 16, 24, 8.0, 23.0
SCALE = 8                       # atlas pixels per art pixel
CELL_W, CELL_H = PROP_W * SCALE, PROP_H * SCALE
COLS = 8                        # cells per atlas row (two kinds per row keeps the atlas under 4096 px tall for 32 kinds)
VARIANTS = 4                    # the demo picks one of 4 variants per prop


def cut_out(img):
    """RGBA float array (0..255) with the background made transparent and pink fringes pulled back to neutral."""
    a = np.asarray(img.convert('RGBA')).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3]
    if alpha.min() < 250:
        # a transparent sheet: generators leave a faint glow around the subject, so cut it hard and pull in 1 px
        keep = alpha >= 200
        keep &= np.roll(keep, 1, 0) & np.roll(keep, -1, 0) & np.roll(keep, 1, 1) & np.roll(keep, -1, 1)
        return np.dstack([rgb, keep * 255.0])
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    m = np.minimum(R, B) - G                          # magenta-ness: large on the background, below 0 on plants and rock
    alpha = np.clip(1 - (m - 20) / 100, 0, 1) * 255
    spill = np.clip(m, 0, None)                       # where pink bled into the edge, take it back out of red and blue
    rgb = np.dstack([R - spill, G, B - spill]).clip(0, 255)
    return np.dstack([rgb, alpha])


def sprite(cell, size):
    """One variation: cropped, scaled to fit the prop space and placed so its foot sits on the prop's foot point."""
    alpha = cell[..., 3]
    solid = alpha > 128
    rows, cols = np.where(solid.sum(1) >= 2)[0], np.where(solid.sum(0) >= 2)[0]   # ignore single stray pixels
    if len(rows) == 0:
        raise ValueError('empty cell')
    y0, y1, x0, x1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    crop = cell[y0:y1, x0:x1]
    # the foot: the middle of whatever touches the bottom few percent (a trunk, or a boulder's base)
    h = y1 - y0
    base = solid[y1 - max(2, h // 30):y1, x0:x1]
    xs = np.where(base.any(0))[0]
    foot_x = (xs[0] + xs[-1] + 1) / 2 if len(xs) else (x1 - x0) / 2
    # scale to fit 15.5 x 22.5 art pixels around the foot (a little margin keeps mipmaps from bleeding)
    max_w, max_h = 15.5 * SCALE * size, 22.5 * SCALE * size
    half = max(foot_x, (x1 - x0) - foot_x)            # widest side from the foot, so the foot stays centred
    k = min(max_w / (2 * half), max_h / h)
    w2, h2 = max(1, round((x1 - x0) * k)), max(1, round(h * k))
    # premultiply before resizing so transparent pixels don't darken the edges
    pre = crop.copy(); pre[..., :3] *= pre[..., 3:4] / 255
    im = Image.fromarray(pre.clip(0, 255).astype(np.uint8)).resize((w2, h2), Image.LANCZOS)
    out = Image.new('RGBA', (CELL_W, CELL_H), (0, 0, 0, 0))
    out.alpha_composite(im, (round(FOOT_X * SCALE - foot_x * k), round(FOOT_Y * SCALE - h2)))
    o = np.asarray(out).astype(np.float32)
    a = o[..., 3:4]
    o[..., :3] = np.where(a > 0, o[..., :3] * 255 / np.maximum(a, 1), 0)   # back to straight alpha
    return o


def main():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    kinds = manifest.get('kinds', {})
    skin = (ROOT / 'galaxy-demo' / 'js' / 'skin.js').read_text(encoding='utf-8')
    names = list(kinds)
    rows = max(1, -(-len(names) * VARIANTS // COLS))
    atlas = np.zeros((rows * CELL_H, COLS * CELL_W, 4), np.float32)
    index = {}
    for n, name in enumerate(names):
        e = kinds[name]
        if f'\n    {name}:' not in skin and f' {name}:' not in skin:
            print(f'warning: "{name}" is not a prop kind in skin.js, so the demo will never draw it')
        sheet = cut_out(Image.open(RAW / e['sheet']))
        gc, gr = e.get('grid', [3, 2])
        H, W = sheet.shape[:2]
        pick = e.get('pick', list(range(VARIANTS)))
        if len(pick) < VARIANTS:
            pick = (pick * VARIANTS)[:VARIANTS]
        for v, c in enumerate(pick[:VARIANTS]):
            cx, cy = c % gc, c // gc
            cell = sheet[cy * H // gr:(cy + 1) * H // gr, cx * W // gc:(cx + 1) * W // gc]
            s = sprite(cell, e.get('size', 1.0))
            i = n * VARIANTS + v
            ax, ay = (i % COLS) * CELL_W, (i // COLS) * CELL_H
            atlas[ay:ay + CELL_H, ax:ax + CELL_W] = s
        index[name] = n * VARIANTS
        print(f'{name}: {e["sheet"]} cells {pick[:VARIANTS]}')
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(atlas.clip(0, 255).astype(np.uint8)).save(OUT / 'props_hd.png', optimize=True)
    meta = {'scale': SCALE, 'cell': [CELL_W, CELL_H], 'cols': COLS, 'size': [COLS * CELL_W, rows * CELL_H], 'kinds': index}
    (OUT / 'props_hd.json').write_text(json.dumps(meta, indent=1) + '\n', encoding='utf-8')
    kb = (OUT / 'props_hd.png').stat().st_size // 1024
    print(f'packed {len(names)} kinds into galaxy-demo/props/props_hd.png ({COLS * CELL_W} x {rows * CELL_H}, {kb} KB)')

    if '--preview' in sys.argv:
        bg = Image.new('RGBA', (COLS * CELL_W, rows * CELL_H), (150, 105, 60, 255))
        bg.alpha_composite(Image.fromarray(atlas.clip(0, 255).astype(np.uint8)))
        px = bg.load()
        for i in range(len(names) * VARIANTS):
            fx, fy = (i % COLS) * CELL_W + int(FOOT_X * SCALE), (i // COLS) * CELL_H + int(FOOT_Y * SCALE)
            for d in range(-4, 5):
                px[fx + d, fy - 1] = (255, 0, 0, 255); px[fx, fy - 1 + d] = (255, 0, 0, 255)
        (ROOT / 'tools' / 'previews').mkdir(parents=True, exist_ok=True)
        bg.save(ROOT / 'tools' / 'previews' / 'props_preview.png')
        print('preview: tools/previews/props_preview.png')


if __name__ == '__main__':
    main()
