"""The Biome Builder's local server: serves the project (like python -m http.server) and saves biome designs.

  python tools/builder_server.py            then open http://localhost:8170/biome-builder/
  python tools/builder_server.py 8172 --idle-exit 15    another port; stop after 15 minutes without a Builder page
Or just double-click the Biome Builder shortcut on the desktop (tools/launch_builder.pyw), which runs this for you.

Save in the Builder sends the biome's template and a fresh bake for the game. This writes:
  art/biomes/<GROUND>.json      the template you saved (the source, kept in git)
  art/biomes/index.json         which biomes have saved templates, and the look they share (item shadows)
  galaxy-demo/biomes/           what the Galaxy demo loads: biomes.json, the item atlas and ground textures
Revert to the game's defaults sends no template, which deletes the biome's file. "Update the game" sends no biome:
it only re-bakes (for new AI art).
Only listens on this computer (127.0.0.1).
"""
import argparse, base64, http.server, json, re, sys, threading, time
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / 'art' / 'biomes'
BAKE = ROOT / 'galaxy-demo' / 'biomes'
_args = argparse.ArgumentParser()
_args.add_argument('port', nargs='?', type=int, default=8170)
_args.add_argument('--idle-exit', type=float, default=0, help='stop after this many minutes without any request (0 = never)')
ARGS = _args.parse_args()
PORT = ARGS.port
last_request = time.time()           # an open Builder page pings every minute, so this stays fresh while one is open
BIOME_NAME = re.compile(r'^[A-Z_]{2,20}$')
FILE_NAME = re.compile(r'^[\w-]{1,40}\.(webp|png)$')


def write_bake(bake):
    """Replace galaxy-demo/biomes/ with this bake: biomes.json plus its images (data: URLs)."""
    BAKE.mkdir(parents=True, exist_ok=True)
    files = bake.get('files', {})
    for name in files:
        if not FILE_NAME.match(name):
            raise ValueError(f'bad file name {name!r}')
    keep = set(files) | {'biomes.json'}
    for old in BAKE.iterdir():
        if old.is_file() and old.name not in keep:
            old.unlink()
    for name, url in files.items():
        head, _, data = url.partition(',')
        if not head.startswith('data:image/') or ';base64' not in head:
            raise ValueError(f'{name} is not a base64 image')
        (BAKE / name).write_bytes(base64.b64decode(data))
    (BAKE / 'biomes.json').write_text(json.dumps(bake['json'], indent=1) + '\n', encoding='utf-8')
    return sorted(keep)


class Handler(http.server.SimpleHTTPRequestHandler):
    def setup(self):
        global last_request
        last_request = time.time()
        super().setup()

    def do_GET(self):
        if self.path.startswith('/api/biome-builder/ping'):         # the launcher and open Builder pages check in
            body = json.dumps({'ok': True, 'app': 'biome-builder', 'idleExit': ARGS.idle_exit}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')          # always the latest files while designing
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/biome-builder/save':
            return self.send_error(404)
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
            biome = req.get('biome') or ''                      # none: just re-bake ("Update the game")
            if biome and not BIOME_NAME.match(biome):
                raise ValueError(f'bad biome name {biome!r}')
            TEMPLATES.mkdir(parents=True, exist_ok=True)
            path = TEMPLATES / f'{biome or "index"}.json'
            if not biome:
                pass
            elif req.get('template') is None:
                path.unlink(missing_ok=True)
            else:
                path.write_text(json.dumps(req['template'], indent=2) + '\n', encoding='utf-8')
            saved = sorted(p.stem for p in TEMPLATES.glob('*.json') if p.stem != 'index')
            index = {'saved': saved}
            try:
                old = json.loads((TEMPLATES / 'index.json').read_text(encoding='utf-8'))
                if 'look' in old: index['look'] = old['look']
            except (OSError, ValueError):
                pass
            if isinstance(req.get('look'), dict): index['look'] = req['look']
            (TEMPLATES / 'index.json').write_text(json.dumps(index, indent=1) + '\n', encoding='utf-8')
            wrote = write_bake(req['bake'])
            body = json.dumps({'ok': True, 'template': str(path.relative_to(ROOT).as_posix()), 'saved': saved,
                               'bake': [f'galaxy-demo/biomes/{n}' for n in wrote]}).encode()
            self.send_response(200)
        except Exception as e:                                  # report it to the Builder instead of failing silently
            body = json.dumps({'ok': False, 'error': str(e)}).encode()
            self.send_response(400)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    def catalog():                                              # small copies of any new AI art, for fast loading
        try:
            import builder_catalog
            builder_catalog.main(quiet=True)
        except Exception as e:                                  # the Builder still works from the raw images
            print(f'could not make web copies of the art: {e}', flush=True)
    threading.Thread(target=catalog, daemon=True).start()       # in the background: serve straight away
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), partial(Handler, directory=str(ROOT)))
    print(f'Biome Builder: http://localhost:{PORT}/biome-builder/  (saving to art/biomes/ and galaxy-demo/biomes/)', flush=True)
    if ARGS.idle_exit > 0:                                      # started by the launcher: stop once nobody's using it
        def watch():
            while time.time() - last_request < ARGS.idle_exit * 60:
                time.sleep(20)
            print('no Builder page for a while: stopping', flush=True)
            server.shutdown()
        threading.Thread(target=watch, daemon=True).start()
    server.serve_forever()
