"""List the AI art for the Biome Lab: writes biome-lab/catalog.json (every raw prop sheet and ground texture).

The lab reads the folders directly when it runs on a local server (python -m http.server shows folder listings),
but GitHub Pages has no listings, so run this before pushing new art:  python tools/lab_catalog.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
listing = {
    'props': sorted(p.name for p in (ROOT / 'art' / 'props' / 'raw').glob('*.png')),
    'ground': sorted(p.name for p in (ROOT / 'art' / 'ground' / 'raw').glob('*.png')),
}
(ROOT / 'biome-lab' / 'catalog.json').write_text(json.dumps(listing, indent=1) + '\n', encoding='utf-8')
print(f"biome-lab/catalog.json: {len(listing['props'])} prop sheets, {len(listing['ground'])} ground textures")
