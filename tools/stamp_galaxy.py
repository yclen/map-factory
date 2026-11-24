"""Stamp a release version onto every file the Galaxy demo loads, so browsers fetch fresh copies after a push.

GitHub Pages lets browsers reuse files for up to 10 minutes, so a new index.html can end up running old scripts.
Adding ?v=<stamp> to every import (the same stamp everywhere, so each module still loads once) avoids that.
Run before committing a galaxy-demo change:  python tools/stamp_galaxy.py
"""
import re, sys, time
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'galaxy-demo'
stamp = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y%m%d%H%M%S')

def stamp_text(text, pattern):
    return re.sub(pattern, lambda m: f"{m.group(1)}?v={stamp}{m.group(3)}", text)

changed = 0
for path in sorted((root / 'js').glob('*.js')):
    text = path.read_text(encoding='utf-8')
    # './name.js' or './name.js?v=old' inside import/from strings and new URL(...)
    new = stamp_text(text, r"('\./[\w-]+\.js)(\?v=\w+)?(')")
    if new != text:
        path.write_text(new, encoding='utf-8'); changed += 1
html = root / 'index.html'
text = html.read_text(encoding='utf-8')
new = stamp_text(text, r'("js/main\.js)(\?v=\w+)?(")')
new = stamp_text(new, r'("style\.css)(\?v=\w+)?(")')
if new != text:
    html.write_text(new, encoding='utf-8'); changed += 1
print(f'stamped v={stamp} into {changed} files')
