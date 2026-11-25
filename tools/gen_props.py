"""Ask Codex (using the ChatGPT subscription, no API key) to draw a sheet of 6 variations of one big prop.

  python tools/gen_props.py oak "broadleaf oak trees with a rounded leafy crown and a short brown trunk"
  python tools/gen_props.py boulder "grey granite boulders" --size 0.6 --ref art/props/raw/oak_v1.png

The sheet lands in art/props/raw/<kind>_vN.png (never overwriting an older one), and art/props/props.json is
pointed at it. Then run  python tools/pack_props.py --preview  to cut it into the demo's prop atlas.
<kind> is a big-prop name from galaxy-demo/js/skin.js; the new art replaces that prop everywhere it grows.
--ref attaches existing images so the new sheet matches their style (use an approved sheet once you have one).
"""
import argparse, glob, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'art' / 'props' / 'raw'
MANIFEST = ROOT / 'art' / 'props' / 'props.json'

STYLE = """\
STYLE (the same for all of this game's art):
- Game asset for a top-down factory / strategy game.
- CAMERA: the classic three-quarter overhead view of such games. The camera is high up and looks down at about
  45 degrees, so you see the top AND the front of each object. For trees: most of the picture is the canopy seen
  from above and in front, with a short but clearly visible piece of trunk below it. Not a straight-down view
  (that hides the trunk) and not an eye-level side view.
- Light comes from the upper left: lit on the upper-left side, darker on the lower-right.
- Detailed, painterly-realistic rendering, like a pre-rendered 3D model. Muted, natural colours. Crisp, hard edges.
- NO ground, grass or soil under the objects, NO cast shadow, NO glow, outline or halo, NO text or labels.
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


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('kind', help='big-prop name from skin.js, e.g. oak, pine, boulder')
    ap.add_argument('subject', help='what to draw, e.g. "broadleaf oak trees with a rounded crown"')
    ap.add_argument('--ref', action='append', default=[], help='image(s) whose style to match')
    ap.add_argument('--size', type=float, help='how much of the prop space it fills, 0..1 (stored in props.json)')
    ap.add_argument('--note', default='', help='extra instructions for this sheet')
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    n = 1
    while (RAW / f'{args.kind}_v{n}.png').exists():
        n += 1
    out = RAW / f'{args.kind}_v{n}.png'
    rel = out.relative_to(ROOT).as_posix()
    refs = [str(Path(r).resolve()) for r in args.ref]

    prompt = f"""Use your built-in image generation tool (not the CLI/API fallback) to make ONE image, then save it in
this project at {rel} (create folders if needed). Do not create, change or delete any other file.

The image: a sprite sheet of 6 different individual {args.subject}, all the same species/type, in a neat grid of
3 columns x 2 rows with generous empty space between them so they can be cut apart. Each one centred in its grid
cell, standing upright, all at the same scale and camera angle, each a little different in shape.

{STYLE}
"""
    if refs:
        prompt += '\nThe attached image(s) show art already in the game: match their rendering style, lighting and level of detail (the camera angle described above still applies).\n'
    if args.note:
        prompt += f'\nAlso: {args.note}\n'
    prompt += '\nWhen done, reply with just the saved file path.\n'

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
