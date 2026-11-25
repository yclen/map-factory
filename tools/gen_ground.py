"""Ask Codex (using the ChatGPT subscription, no API key) to paint one seamless ground texture.

  python tools/gen_ground.py grass "short green meadow grass with a few clover leaves" --biome forest
  python tools/gen_ground.py sand "fine pale desert sand with soft wind ripples"
  python tools/gen_ground.py snow "fresh packed snow with faint wind-carved ridges" --note "a hint of blue in the shade"

The texture lands in art/ground/raw/<name>_vN.png (never overwriting an older one). The Biome Builder (biome-builder/) picks
it up on its next load and offers it as a ground skin for every biome; it makes the edges seamless itself, so a
slightly visible seam in the raw image is fine.

<name> is a short ground name (grass, sand, snow, needles, mud, ...). The Builder's default pairing of ground names
with biomes is GROUND_FOR in biome-builder/builder.js; any texture can be tried on any biome there.

Same options as gen_props.py: --biome adds that biome's theme and reference images, --ref attaches more images,
--note adds a one-off instruction, --dry-run prints the prompt without calling Codex.
"""
import argparse, subprocess, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_props import find_codex, load_biome, STYLE, ROOT      # noqa: E402  (shared with the prop generator)

RAW = ROOT / 'art' / 'ground' / 'raw'

GROUND_RULES = """\
GROUND TEXTURE RULES (these override the camera notes above, which are for standing objects):
- ONE square image that is a SEAMLESS, TILEABLE texture of bare ground: its left edge continues into its right
  edge and its top into its bottom, so copies laid side by side show no seam.
- The ground is flat, so paint it as an even surface filling the whole square: no perspective, no horizon, no
  vanishing lines, no sky.
- ONLY the surface itself. NO trees, bushes, large rocks, buildings, paths, puddles or water, animals, people,
  NO cast shadows from objects, NO text, labels or borders.
- Even everywhere: the same lighting, colour and density of detail across the whole image. NO vignette, no
  brighter or darker corners or centre, no single feature that stands out (the texture repeats, so anything
  unique becomes an obvious pattern).
- SCALE: the square covers about 8 x 8 metres of ground (8 x 8 game tiles), seen from high above; size grass
  blades, pebbles, ripples and cracks to match."""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('name', help='short ground name, e.g. grass, sand, snow, needles, mud')
    ap.add_argument('subject', help='what the ground is, e.g. "short green meadow grass"')
    ap.add_argument('--biome', help='theme file in art/style/biomes/ to follow (palette, mood, reference images)')
    ap.add_argument('--ref', action='append', default=[], help='image(s) whose style to match')
    ap.add_argument('--note', default='', help='extra instructions for this texture')
    ap.add_argument('--dry-run', action='store_true', help='print the prompt instead of calling Codex')
    args = ap.parse_args()

    RAW.mkdir(parents=True, exist_ok=True)
    n = 1
    while (RAW / f'{args.name}_v{n}.png').exists():
        n += 1
    out = RAW / f'{args.name}_v{n}.png'
    rel = out.relative_to(ROOT).as_posix()
    refs = [str(Path(r).resolve()) for r in args.ref]
    theme = ''
    if args.biome:
        theme, biome_refs = load_biome(args.biome)
        refs = biome_refs + refs
    for r in refs:
        if not Path(r).exists():
            sys.exit(f'reference image not found: {r}')

    prompt = f"""Use your built-in image generation tool (not the CLI/API fallback) to make ONE square image, then save it
in this project at {rel} (create folders if needed). Do not create, change or delete any other file.

The image: a seamless top-down ground texture of {args.subject}, for the ground of a top-down factory / strategy
game.

{STYLE.read_text(encoding='utf-8').strip()}

{GROUND_RULES}
"""
    if theme:
        prompt += f'\nBIOME THEME ({args.biome}) - this ground belongs to this biome, so follow its palette and mood:\n{theme}\n'
    if refs:
        prompt += ('\nThe attached image(s) show objects already made for this game that will stand on this ground: '
                   'match their rendering style, lighting, colour palette and level of detail, but paint only bare '
                   'ground, not those objects.\n')
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
    print(f'saved {rel}. Open the Biome Builder to try it on a biome.')


if __name__ == '__main__':
    main()
