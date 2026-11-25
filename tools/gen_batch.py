"""Make many AI art sheets in one go, from a list: art/wishlist.json.

  python tools/gen_batch.py                 # everything on the list that has no art yet, 3 at a time
  python tools/gen_batch.py tuft pebbles    # just these
  python tools/gen_batch.py --jobs 2 --dry-run

Each entry is one gen_props.py (items) or gen_ground.py (ground) call. An entry is skipped when its first sheet
already exists (art/props/raw/<kind>_v1.png or art/ground/raw/<name>_v1.png), so a stopped run can just be started
again. To redo one, run gen_props.py / gen_ground.py for it directly (that makes a _v2). Each image takes about a
minute and counts toward the ChatGPT plan's limits.
"""
import argparse, json, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WISH = ROOT / 'art' / 'wishlist.json'


def command(e):
    if e['type'] == 'ground':
        cmd = [sys.executable, str(ROOT / 'tools' / 'gen_ground.py'), e['name'], e['subject']]
    else:
        cmd = [sys.executable, str(ROOT / 'tools' / 'gen_props.py'), e['name'], e['subject']]
        if e['type'] == 'small':
            cmd.append('--small')
        if e.get('size'):
            cmd += ['--size', str(e['size'])]
    if e.get('biome'):
        cmd += ['--biome', e['biome']]
    if e.get('note'):
        cmd += ['--note', e['note']]
    return cmd


def exists(e):
    folder = 'ground' if e['type'] == 'ground' else 'props'
    return (ROOT / 'art' / folder / 'raw' / f"{e['name']}_v1.png").exists()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*', help='only these entries (by name)')
    ap.add_argument('--jobs', type=int, default=3, help='how many images at once (default 3)')
    ap.add_argument('--dry-run', action='store_true', help='list what would be made')
    args = ap.parse_args()

    wish = json.loads(WISH.read_text(encoding='utf-8'))
    todo = [e for e in wish if (not args.names or e['name'] in args.names) and not exists(e)]
    if not todo:
        print('nothing to make: everything asked for already has art')
        return
    print(f'{len(todo)} to make, {args.jobs} at a time: ' + ', '.join(e['name'] for e in todo), flush=True)
    if args.dry_run:
        for e in todo:
            print(' ', subprocess.list2cmdline(command(e)))
        return

    limit = []                                  # set once the ChatGPT plan's usage limit is hit: skip the rest

    def run(e):
        if limit:
            return False
        t = time.time()
        r = subprocess.run(command(e), cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        ok = r.returncode == 0 and exists(e)
        out = r.stdout + r.stderr
        if not ok and 'usage limit' in out:
            when = out[out.find('try again'):].split('\n')[0].strip(' .')
            if not limit:
                print(f'STOPPED: the ChatGPT usage limit was hit ({when}). Run this again then to make the rest.', flush=True)
            limit.append(when)
            return False
        print(f"{'done' if ok else 'FAILED'} {e['type']} {e['name']} ({time.time() - t:.0f} s)", flush=True)
        if not ok:
            msg = out.strip()[-600:].replace('\n', '\n   ')
            print('   ' + msg.encode('ascii', 'replace').decode(), flush=True)  # the console may not take every character
        return ok

    with ThreadPoolExecutor(args.jobs) as pool:
        results = list(pool.map(run, todo))
    print(f'{sum(results)} made, {len(results) - sum(results)} failed. Then: python tools/builder_catalog.py', flush=True)


if __name__ == '__main__':
    main()
