"""Ask Codex (the ChatGPT subscription, no API key) for the building sheets towns and cities are made of.

  python tools/gen_towns.py                 # every tier that has no sheet yet, 3 at a time
  python tools/gen_towns.py cottage tower   # just these tiers (a new _vN each time, older ones kept)
  python tools/gen_towns.py cottage --note "smaller windows" --ref art/towns/raw/house_v1.png
  python tools/gen_towns.py --dry-run cottage

Each tier is one sheet of 6 variations (3 x 2) in art/towns/raw/<tier>_vN.png, drawn in the game's style
(art/style/style.md) and the towns theme (art/style/towns.md, with the images it lists). Then run
python tools/pack_towns.py --preview  to cut them into the Galaxy demo's building atlas. The plan for how the
buildings make up towns and cities is in art/towns.md.
"""
import argparse, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_props import ROOT, STYLE, PROP_RULES, find_codex  # noqa: E402

RAW = ROOT / 'art' / 'towns' / 'raw'
THEME = ROOT / 'art' / 'style' / 'towns.md'

# tier order is the game's: 0 village ... 5 megalopolis (galaxy-demo/js/rules.js towns.tiers names the same keys)
TIERS = {
    'cottage': ('Village', 'small single-storey village cottages: rough stone or timber-framed walls, steep '
                'thatched or wooden-shingle roofs, one small chimney, a wooden door and one or two small windows'),
    'house': ('Town', 'two-storey town houses: whitewashed or pale limestone walls, red clay tile roofs, wooden '
              'shutters, a chimney, some with a small porch'),
    'townhouse': ('City', 'three-storey city townhouses and corner shops: red brick and pale stone, grey slate '
                  'roofs with dormer windows, a shop front with an awning at street level'),
    'apartment': ('Metropolis', 'six to eight storey apartment blocks: brick and warm concrete, flat roofs with '
                  'water tanks, stair housings and vents, rows of windows and small balconies'),
    'office': ('Megacity', 'modern office towers about fifteen storeys tall: steel and blue-grey glass with warm '
               'reflections, stone-clad bases, flat roofs with air-conditioning units; tall and fairly slim'),
    'skyscraper': ('Megalopolis', 'supertall glass skyscrapers: tall and slender, glass curtain walls, stepped '
                   'setbacks near the top, some with a spire or antenna; much taller than wide'),
}


def load_theme():
    text, refs = [], []
    for line in THEME.read_text(encoding='utf-8').splitlines():
        if line.strip().startswith('ref:'):
            refs.append(str((ROOT / line.split(':', 1)[1].strip()).resolve()))
        elif not line.startswith('#'):
            text.append(line)
    return '\n'.join(text).strip(), refs


def next_path(tier):
    n = 1
    while (RAW / f'{tier}_v{n}.png').exists():
        n += 1
    return RAW / f'{tier}_v{n}.png'


def prompt_for(tier, out, theme, note, has_refs):
    level, subject = TIERS[tier]
    rel = out.relative_to(ROOT).as_posix()
    tall = tier in ('office', 'skyscraper')
    p = f"""Use your built-in image generation tool (not the CLI/API fallback) to make ONE image, then save it in
this project at {rel} (create folders if needed). Do not create, change or delete any other file.

The image: a sprite sheet of 6 different individual buildings for a game's {level}-sized settlements:
{subject}. All the same kind and era, in a neat grid of 3 columns x 2 rows with generous empty space between them
so they can be cut apart. Each one centred in its grid cell, standing upright on its (invisible) ground, all at
the same scale and camera angle, each a little different (shape, colours, roof, details).
{'Each building is much taller than it is wide and fills the full height of its cell.' if tall else
 'Each building fills most of the width of its cell.'}

{STYLE.read_text(encoding='utf-8').strip()}

{PROP_RULES}

TOWNS THEME - every building in the game follows it:
{theme}
"""
    if has_refs:
        p += ('\nThe attached image(s) show art already made for this game: match their rendering style, lighting '
              'and level of detail (colours come from the theme above; the camera angle described above applies).\n')
    if note:
        p += f'\nAlso: {note}\n'
    return p + '\nWhen done, reply with just the saved file path.\n'


def run(tier, args, theme, refs):
    out = next_path(tier)
    prompt = prompt_for(tier, out, theme, args.note, bool(refs))
    if args.dry_run:
        print(prompt); print('attach:', *(refs or ['(none)']), sep='\n  ')
        return True
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [find_codex(), 'exec', '-s', 'workspace-write', '-C', str(ROOT), '--ephemeral']
    for r in refs:
        cmd += ['-i', r]
    cmd.append('-')
    print(f'asking Codex for {out.relative_to(ROOT).as_posix()} ...', flush=True)
    with tempfile.TemporaryFile() as log:
        res = subprocess.run(cmd, input=prompt.encode('utf-8'), stdout=log, stderr=subprocess.STDOUT)
        if res.returncode != 0 or not out.exists():
            log.seek(0)
            print(log.read().decode('utf-8', 'replace')[-2000:])
            print(f'FAILED: {tier}', flush=True)
            return False
    print(f'saved {out.relative_to(ROOT).as_posix()}', flush=True)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('tiers', nargs='*', help=f'which tiers ({", ".join(TIERS)}); default: those without a sheet')
    ap.add_argument('--ref', action='append', default=[], help='more image(s) whose style to match')
    ap.add_argument('--note', default='', help='extra instructions for these sheets')
    ap.add_argument('--jobs', type=int, default=3, help='sheets to make at the same time')
    ap.add_argument('--dry-run', action='store_true', help='print the prompt instead of calling Codex')
    args = ap.parse_args()
    for t in args.tiers:
        if t not in TIERS:
            sys.exit(f'unknown tier "{t}": one of {", ".join(TIERS)}')
    tiers = args.tiers or [t for t in TIERS if not (RAW / f'{t}_v1.png').exists()]
    theme, refs = load_theme()
    refs += [str(Path(r).resolve()) for r in args.ref]
    with ThreadPoolExecutor(max(1, args.jobs)) as ex:
        ok = list(ex.map(lambda t: run(t, args, theme, refs), tiers))
    if not all(ok):
        sys.exit(1)


if __name__ == '__main__':
    main()
