"""Get the AI art ready for the Biome Builder: small web copies of every sheet and texture, plus biome-builder/catalog.json.

  python tools/builder_catalog.py

The raw images from ChatGPT are 2-4 MB each, far more than the Builder draws, so the Builder loads small copies instead:
  art/props/web/<sheet>.webp     the sheet at 60% size with its magenta background already cut out (transparent)
  art/ground/web/<texture>.webp  the centre square at 512 x 512 (the Builder makes it seamless itself)
  art/props/hd/<sheet>.webp      big items' sheets (trees, boulders: the kinds in art/props/props.json) at full size,
                                 cut out too, for the sharp big-item atlas the Builder loads after starting up
Copies are only made for images that don't have one yet; the raw files stay the source. builder_server.py runs this on
start, and the Builder falls back to the raw image for anything without a copy.

catalog.json lists the files, for GitHub Pages, which can't list folders. Run this before pushing new art.
"""
import json, sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pack_props import cut_out          # noqa: E402  (the same background cut as the game's packer)

ROOT = Path(__file__).resolve().parent.parent
SHEET_W = 922                           # biome-builder/assets.js SHEET_W: 60% of ChatGPT's 1536 px wide sheets
TEX = 512                               # biome-builder/assets.js TEX


def sheet_copy(src, dst):
    rgba = cut_out(Image.open(src)).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(rgba)
    if img.width > SHEET_W:             # shrink with premultiplied alpha so edges don't pick up dark fringes
        h = round(img.height * SHEET_W / img.width)
        img = img.convert('RGBa').resize((SHEET_W, h), Image.LANCZOS).convert('RGBA')
    img.save(dst, 'WEBP', quality=90, alpha_quality=100, method=6)


def hd_copy(src, dst):
    rgba = cut_out(Image.open(src)).clip(0, 255).astype(np.uint8)
    Image.fromarray(rgba).save(dst, 'WEBP', quality=88, alpha_quality=100, method=6)


def ground_copy(src, dst):
    img = Image.open(src).convert('RGB')
    s = min(img.size)
    x, y = (img.width - s) // 2, (img.height - s) // 2
    img.crop((x, y, x + s, y + s)).resize((TEX, TEX), Image.LANCZOS).save(dst, 'WEBP', quality=90, method=6)


def main(quiet=False):
    listing, made = {}, 0
    for key, folder, copy in [('props', 'props', sheet_copy), ('ground', 'ground', ground_copy)]:
        raw, web = ROOT / 'art' / folder / 'raw', ROOT / 'art' / folder / 'web'
        web.mkdir(exist_ok=True)
        files = sorted(p.name for p in raw.glob('*.png'))
        for f in files:
            dst = web / (f[:-4] + '.webp')
            if not dst.exists():
                copy(raw / f, dst)
                made += 1
        listing[key] = files
        listing[key + 'Web'] = sorted(p.name for p in web.glob('*.webp'))
    # full-size copies of the big items' sheets
    big = set(json.loads((ROOT / 'art' / 'props' / 'props.json').read_text(encoding='utf-8'))['kinds'])
    raw, hd = ROOT / 'art' / 'props' / 'raw', ROOT / 'art' / 'props' / 'hd'
    hd.mkdir(exist_ok=True)
    for f in listing['props']:
        dst = hd / (f[:-4] + '.webp')
        if f.rsplit('_v', 1)[0] in big and not dst.exists():
            hd_copy(raw / f, dst)
            made += 1
    listing['propsHd'] = sorted(p.name for p in hd.glob('*.webp'))
    (ROOT / 'biome-builder' / 'catalog.json').write_text(json.dumps(listing, indent=1) + '\n', encoding='utf-8')
    if made or not quiet:
        print(f"Biome Builder art: {len(listing['props'])} item sheets, {len(listing['ground'])} ground textures "
              f"({made} new web copies); biome-builder/catalog.json written")


if __name__ == '__main__':
    main()
