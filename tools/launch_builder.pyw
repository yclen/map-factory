"""Open the Biome Builder with saving switched on: the desktop shortcut runs this (with pythonw, so no window).

  double-click the "Biome Builder" shortcut on the desktop          (or: pythonw tools/launch_builder.pyw)
  python tools/launch_builder.pyw --shortcut                         (re)make that desktop shortcut

It looks for the Builder's save server on this computer (tools/builder_server.py, ports 8170-8179) and starts one in
the background if there isn't one, then opens http://localhost:<port>/biome-builder/ in the browser. The server
stops by itself 15 minutes after the last Builder page is closed. Its output goes to %TEMP%/biome-builder-server.log.
Unsaved changes are kept per address, so the launcher sticks to the first free port: normally always 8170.
"""
import json, os, socket, subprocess, sys, tempfile, time, urllib.request, webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTS = range(8170, 8180)
IDLE_MINUTES = 15
LOG = Path(tempfile.gettempdir()) / 'biome-builder-server.log'


def ping(port):
    """the ping reply if a Builder save server answers on this port, else None"""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/biome-builder/ping', timeout=1) as r:
            info = json.load(r)
            return info if info.get('app') == 'biome-builder' else None
    except Exception:
        return None


def in_use(port):
    # a quick look: something on this computer answers at once; Windows takes ~2 s to refuse an empty port
    with socket.socket() as s:
        s.settimeout(0.15)
        return s.connect_ex(('127.0.0.1', port)) == 0


def pythonw():
    exe = Path(sys.executable)
    w = exe.with_name('pythonw.exe')
    return w if w.exists() else exe


def find_or_start():
    # reuse a server the launcher started earlier (one that stops by itself); never someone's development server
    used = [p for p in PORTS if in_use(p)]
    for port in used:
        info = ping(port)
        if info and info.get('idleExit'):
            return port
    port = next(p for p in PORTS if p not in used)
    flags = 0
    if os.name == 'nt':
        flags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    log = open(LOG, 'a', encoding='utf-8')
    log.write(f'\n--- {time.strftime("%Y-%m-%d %H:%M:%S")} starting on port {port}\n')
    log.flush()
    subprocess.Popen([str(pythonw()), str(ROOT / 'tools' / 'builder_server.py'), str(port), '--idle-exit', str(IDLE_MINUTES)],
                     cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags, close_fds=True)
    for _ in range(150):                                   # making web copies of new art can take a moment at start
        if ping(port):
            break
        time.sleep(0.2)
    return port


def make_shortcut():
    """a "Biome Builder" shortcut on the desktop that runs this launcher with pythonw"""
    icon = ROOT / 'biome-builder' / 'icon.ico'
    ps = f"""
$desk = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Biome Builder.lnk'))
$s.TargetPath = '{pythonw()}'
$s.Arguments = '"{Path(__file__).resolve()}"'
$s.WorkingDirectory = '{ROOT}'
$s.IconLocation = '{icon},0'
$s.Description = 'Open the Biome Builder with saving switched on'
$s.Save()
Join-Path $desk 'Biome Builder.lnk'
"""
    out = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True)
    print(out.stdout.strip() or out.stderr.strip())


if __name__ == '__main__':
    if '--shortcut' in sys.argv:
        make_shortcut()
    else:
        webbrowser.open(f'http://localhost:{find_or_start()}/biome-builder/')
