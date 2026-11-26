"""Cut the building sheets (tools/gen_towns.py) into the Galaxy demo's building atlas.

  python tools/pack_towns.py            # writes galaxy-demo/props/towns.webp + towns.json
  python tools/pack_towns.py --preview  # also tools/previews/towns_preview.png (every building, red cross = foot)

art/towns/towns.json says which sheet each tier uses and which 4 of its 6 cells (default: the newest sheet, cells
0-3). Each building is packed like a big prop (pack_props.py): 16 x 24 art px at 8 texels per art px, standing on
its foot at the bottom middle, 4 variants per tier in tier order (cell = tier * 4 + variant, as the demo expects).
"""
import json, re, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack_props import cut_out, sprite, CELL_W, CELL_H, SCALE, FOOT_X, FOOT_Y  # noqa: E402
from gen_towns import TIERS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'towns' / 'raw'
MANIFEST = ROOT / 'art' / 'towns' / 'towns.json'
OUT = ROOT / 'galaxy-demo' / 'props'
COLS, VARIANTS = 8, 4


def newest(tier):
    found = sorted(RAW.glob(f'{tier}_v*.png'), key=lambda p: int(re.search(r'_v(\d+)', p.name).group(1)))
    return found[-1].name if found else None


def base_of(s):
    """The building's base in art px: its left and right edge along the bottom, and how high the part touching the
    ground reaches (its footprint seen from the camera); the cast shadow starts above that."""
    a = s[..., 3] > 128
    rows = np.where(a.any(1))[0]
    y1 = rows[-1] + 1
    band = a[max(0, y1 - 2 * SCALE):y1]
    xs = np.where(band.sum(0) >= 2)[0]
    l, r = xs[0] / SCALE, (xs[-1] + 1) / SCALE
    h = (y1 - rows[0]) / SCALE
    return [round(l, 2), round(r, 2), round(min(h * 0.3, (r - l) * 0.45), 2)]


def main():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {}
    tiers = list(TIERS)
    rows = -(-len(tiers) * VARIANTS // COLS)
    atlas = np.zeros((rows * CELL_H, COLS * CELL_W, 4), np.float32)
    base = []
    for t, tier in enumerate(tiers):
        e = manifest.setdefault(tier, {})
        e.setdefault('sheet', newest(tier))
        if not e['sheet']:
            sys.exit(f'no sheet for "{tier}": run python tools/gen_towns.py {tier}')
        e.setdefault('grid', [3, 2])
        e.setdefault('pick', [0, 1, 2, 3])
        sheet = cut_out(Image.open(RAW / e['sheet']))
        gc, gr = e['grid']
        H, W = sheet.shape[:2]
        for v, c in enumerate(e['pick'][:VARIANTS]):
            cx, cy = c % gc, c // gc
            s = sprite(sheet[cy * H // gr:(cy + 1) * H // gr, cx * W // gc:(cx + 1) * W // gc], e.get('size', 1.0))
            i = t * VARIANTS + v
            atlas[(i // COLS) * CELL_H:(i // COLS + 1) * CELL_H, (i % COLS) * CELL_W:(i % COLS + 1) * CELL_W] = s
            base.extend(base_of(s))
        print(f'{tier}: {e["sheet"]} cells {e["pick"]}')
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1) + '\n', encoding='utf-8')
    img = Image.fromarray(atlas.clip(0, 255).astype(np.uint8))
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / 'towns.webp', quality=92, method=6)
    meta = {'scale': SCALE, 'cell': [CELL_W, CELL_H], 'cols': COLS, 'size': [img.width, img.height],
            'tiers': tiers, 'base': base}
    (OUT / 'towns.json').write_text(json.dumps(meta) + '\n', encoding='utf-8')
    kb = (OUT / 'towns.webp').stat().st_size // 1024
    print(f'packed {len(tiers)} tiers into galaxy-demo/props/towns.webp ({img.width} x {img.height}, {kb} KB)')
    if '--preview' in sys.argv:
        bg = Image.new('RGBA', img.size, (96, 140, 70, 255))
        bg.alpha_composite(img)
        px = bg.load()
        for i in range(len(tiers) * VARIANTS):
            fx, fy = (i % COLS) * CELL_W + int(FOOT_X * SCALE), (i // COLS) * CELL_H + int(FOOT_Y * SCALE)
            for d in range(-4, 5):
                px[fx + d, fy - 1] = (255, 0, 0, 255); px[fx, fy - 1 + d] = (255, 0, 0, 255)
        (ROOT / 'tools' / 'previews').mkdir(parents=True, exist_ok=True)
        bg.save(ROOT / 'tools' / 'previews' / 'towns_preview.png')
        print('preview: tools/previews/towns_preview.png')


if __name__ == '__main__':
    main()
