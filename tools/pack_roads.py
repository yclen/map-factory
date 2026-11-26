"""Pack the road surface textures into the Galaxy demo's road texture strip.

  python tools/pack_roads.py

Makes them with:  python tools/gen_ground.py road<kind> "..." --note "<3 x 3 tile scale>"  then moves them from
art/ground/raw/ to art/roads/raw/ (so the Biome Builder doesn't offer them as biome grounds). See art/towns.md.
Each texture is made seamless (its edges cross-faded with its own middle), scaled to SIZE x SIZE and stacked top to
bottom into galaxy-demo/props/roads.webp, in the order the shader expects: dirt, gravel, cobbles, asphalt, paving.
"""
import re
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'roads' / 'raw'
OUT = ROOT / 'galaxy-demo' / 'props' / 'roads.webp'
ORDER = ['dirt', 'gravel', 'cobbles', 'asphalt', 'paving']
SIZE = 512
BAND = 0.12          # share of each side cross-faded


def newest(kind):
    found = sorted(RAW.glob(f'road{kind}_v*.png'), key=lambda p: int(re.search(r'_v(\d+)', p.name).group(1)))
    if not found:
        raise SystemExit(f'no art/roads/raw/road{kind}_v*.png')
    return found[-1]


def seamless(a):
    """Near each edge, fade to the texture shifted by half its size: both edges then show the same pixels, so copies
    meet without a seam (the middle keeps the original)."""
    for axis in (1, 0):
        n = a.shape[axis]
        x = np.arange(n) / n
        w = np.clip(np.minimum(x, 1 - x) / BAND, 0, 1)
        w = w * w * (3 - 2 * w)
        w = w.reshape((1, n, 1) if axis == 1 else (n, 1, 1))
        a = a * w + np.roll(a, n // 2, axis=axis) * (1 - w)
    return a


def main():
    layers = []
    for k in ORDER:
        p = newest(k)
        a = np.asarray(Image.open(p).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)).astype(np.float32)
        layers.append(seamless(a))
        print(f'{k}: {p.name}')
    strip = np.concatenate(layers, 0).clip(0, 255).astype(np.uint8)
    Image.fromarray(strip).save(OUT, quality=90, method=6)
    print(f'packed {len(ORDER)} road textures into {OUT.relative_to(ROOT).as_posix()} '
          f'({SIZE} x {SIZE * len(ORDER)}, {OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
