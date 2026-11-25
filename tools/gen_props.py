"""Ask Codex (using the ChatGPT subscription, no API key) to draw a sheet of 6 variations of one big prop.

  python tools/gen_props.py oak "broadleaf oak trees with a rounded leafy crown and a short brown trunk"
  python tools/gen_props.py acacia "flat-topped acacia trees" --biome savanna
  python tools/gen_props.py boulder "grey granite boulders" --size 0.6 --ref art/props/raw/oak_v1.png

The sheet lands in art/props/raw/<kind>_vN.png (never overwriting an older one), and art/props/props.json is
pointed at it. Then run  python tools/pack_props.py --preview  to cut it into the demo's prop atlas.
<kind> is a big-prop name from galaxy-demo/js/skin.js; the new art replaces that prop everywhere it grows.

Every prompt includes art/style/style.md (the look shared by all the game's art). --biome adds
art/style/biomes/<name>.md (that biome's palette and mood) and attaches the reference images it lists, so
everything made for one biome matches. --ref attaches more images to match. See art/README.md.
--dry-run prints the prompt and the images it would attach, without calling Codex.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'props' / 'raw'
MANIFEST = ROOT / 'art' / 'props' / 'props.json'
STYLE = ROOT / 'art' / 'style' / 'style.md'
BIOMES = ROOT / 'art' / 'style' / 'biomes'

# what only props need on top of the shared style: a clean cut-out with nothing around it
PROP_RULES = """\
PROP SHEET RULES:
- NO ground, grass or soil under the objects, NO cast shadow (the game draws shadows), NO glow, outline or halo,
  NO text or labels.
- BACKGROUND: completely flat, uniform, pure magenta #FF00FF everywhere that is not the object, including every gap
  between leaves and branches. No gradient, no vignette, no transparency."""


def find_codex():
    """The Codex desktop app's own CLI (kept current by the app), else a codex on PATH."""
    base = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'OpenAI', 'Codex', 'bin')
    found = sorted(glob.glob(os.path.join(base, '*', 'codex.exe')), key=os.path.getmtime)
    if found:
        return found[-1]
    on_path = shutil.which('codex')
    if on_path:
        return on_path
    sys.exit('Codex not found: install the Codex app or CLI and sign in with ChatGPT')


def load_biome(name):
    """A biome theme file: its text goes into the prompt; lines 'ref: <path>' name images to attach instead."""
    path = BIOMES / f'{name}.md'
    if not path.exists():
        sys.exit(f'no biome theme at {path.relative_to(ROOT)}: copy art/style/biomes/_template.md to start one')
    text, refs = [], []
    for line in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\s*ref:\s*(.+?)\s*$', line)
        if m:
            refs.append(str((ROOT / m.group(1)).resolve()))
        elif not line.startswith('#'):          # '#' lines are notes for people, not for the image model
            text.append(line)
    return '\n'.join(text).strip(), refs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('kind', help='big-prop name from skin.js, e.g. oak, pine, boulder')
    ap.add_argument('subject', help='what to draw, e.g. "broadleaf oak trees with a rounded crown"')
    ap.add_argument('--biome', help='theme file in art/style/biomes/ to follow (palette, mood, reference images)')
    ap.add_argument('--ref', action='append', default=[], help='image(s) whose style to match')
    ap.add_argument('--size', type=float, help='how much of the prop space it fills, 0..1 (stored in props.json)')
    ap.add_argument('--small', action='store_true',
                    help='a small item (grass tuft, pebbles, shell...): ground-level wording, and props.json is left '
                         'alone (it lists the big props the demo packs); the Biome Lab sets small items\' sizes')
    ap.add_argument('--note', default='', help='extra instructions for this sheet')
    ap.add_argument('--dry-run', action='store_true', help='print the prompt instead of calling Codex')
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    n = 1
    while (RAW / f'{args.kind}_v{n}.png').exists():
        n += 1
    out = RAW / f'{args.kind}_v{n}.png'
    rel = out.relative_to(ROOT).as_posix()
    refs = [str(Path(r).resolve()) for r in args.ref]
    theme = ''
    if args.biome:
        theme, biome_refs = load_biome(args.biome)
        refs = biome_refs + refs
    for r in refs:
        if not Path(r).exists():
            sys.exit(f'reference image not found: {r}')

    if args.small:
        layout = f"""The image: a sprite sheet of 6 different {args.subject}, all the same kind, in a neat grid of
3 columns x 2 rows with generous empty space between them so they can be cut apart. These are SMALL ground-level
details of the game world (each only about knee-high or smaller in the world), but draw each one LARGE so it fills
most of its grid cell and its detail is clearly visible. Each one centred in its cell, resting on or growing out of
the (invisible) ground, all at the same scale and camera angle, each a little different in shape."""
    else:
        layout = f"""The image: a sprite sheet of 6 different individual {args.subject}, all the same species/type, in a neat grid of
3 columns x 2 rows with generous empty space between them so they can be cut apart. Each one centred in its grid
cell, standing upright, all at the same scale and camera angle, each a little different in shape."""
    prompt = f"""Use your built-in image generation tool (not the CLI/API fallback) to make ONE image, then save it in
this project at {rel} (create folders if needed). Do not create, change or delete any other file.

{layout}

{STYLE.read_text(encoding='utf-8').strip()}

{PROP_RULES}
"""
    if theme:
        prompt += f'\nBIOME THEME ({args.biome}) - these objects belong to this biome, so follow it:\n{theme}\n'
    if refs:
        colours = 'take colours from the biome theme' if theme else 'match their colour palette too'
        prompt += ('\nThe attached image(s) show art already made for this game: match their rendering style, '
                   f'lighting and level of detail ({colours}; the camera angle described above still applies).\n')
    if args.note:
        prompt += f'\nAlso: {args.note}\n'
    prompt += '\nWhen done, reply with just the saved file path.\n'

    if args.dry_run:
        print(prompt)
        print('attach:', *(refs or ['(none)']), sep='\n  ')
        return

    cmd = [find_codex(), 'exec', '-s', 'workspace-write', '-C', str(ROOT), '--ephemeral']
    for r in refs:
        cmd += ['-i', r]
    cmd.append('-')
    print(f'asking Codex for {rel} ...', flush=True)
    with tempfile.TemporaryFile() as log:
        res = subprocess.run(cmd, input=prompt.encode('utf-8'), stdout=log, stderr=subprocess.STDOUT)
        if res.returncode != 0 or not out.exists():
            log.seek(0)
            sys.stdout.write(log.read().decode('utf-8', 'replace')[-3000:])
            sys.exit(f'Codex did not produce {rel}')

    if args.small:
        print(f'saved {rel}. Reload the Biome Lab: small items named "{args.kind}" use it.')
        return
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8')) if MANIFEST.exists() else {'kinds': {}}
    entry = manifest.setdefault('kinds', {}).setdefault(args.kind, {})
    entry['sheet'] = out.name
    entry.setdefault('grid', [3, 2])
    if args.size is not None:
        entry['size'] = args.size
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'saved {rel}; props.json now uses it for "{args.kind}". Next: python tools/pack_props.py --preview')


if __name__ == '__main__':
    main()
