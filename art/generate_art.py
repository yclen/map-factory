#!/usr/bin/env python3
"""
Concept-art generator for the map-view factory game.

Writes every SVG in this folder from shared building blocks, so the item
models, map, and UI always match across snapshots. Change a color or an
icon here, re-run, and every image updates.

    python generate_art.py
"""
import math
import os
import random

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 1280, 720
FONT = "'Segoe UI', Inter, Helvetica, Arial, sans-serif"

# ---------------------------------------------------------------- palette
C = {
    "land": "#86ad5f", "land_dark": "#739c4f", "land_light": "#9cc173",
    "water": "#4a86ab", "water_light": "#6aa3c4", "sand": "#dccf93",
    "team": "#2f7de1", "team_light": "#9cc6ff",
    "hud": "#141a25", "panel": "#1d2433", "panel_hi": "#2b3550",
    "text": "#eef2f8", "dim": "#97a3b6", "accent": "#f2c14e",
    "good": "#7bd389", "bad": "#ff7a6b",
}

# ------------------------------------------------------------ item models
# Every game object is a <g> in <defs>, drawn top-down around (0, 0) at
# roughly 20-24 px, then placed with <use>.
DEFS = f"""
<defs>
  <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="28"/></filter>
  <filter id="softsm" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
  <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
    <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#000" stroke-opacity="0.055" stroke-width="1"/>
  </pattern>
  <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="#c9d3e3"/>
  </marker>
  <marker id="arrowgold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" fill="{C['accent']}"/>
  </marker>

  <!-- PERSON: the currency -->
  <g id="person">
    <circle cx="0" cy="-4.5" r="3" fill="{C['accent']}" stroke="#5a4310" stroke-width="0.8"/>
    <path d="M-4.5 5 C-4.5 0 -2.5 -0.8 0 -0.8 C2.5 -0.8 4.5 0 4.5 5 Z" fill="{C['accent']}" stroke="#5a4310" stroke-width="0.8"/>
  </g>

  <!-- HOUSE: holds people -->
  <g id="house">
    <rect x="-7" y="-6" width="18" height="16" fill="#000" opacity="0.22"/>
    <rect x="-9" y="-8" width="18" height="8" fill="#de6d4c"/>
    <rect x="-9" y="0" width="18" height="8" fill="#b04a31"/>
    <rect x="-9" y="-8" width="18" height="16" fill="none" stroke="#6b2b1b" stroke-width="1"/>
    <line x1="-9" y1="0" x2="9" y2="0" stroke="#7d3220" stroke-width="1.2"/>
    <rect x="3" y="-6.5" width="3.2" height="4" fill="#4e3a33"/>
  </g>

  <!-- FARM: makes food -->
  <g id="farm">
    <rect x="-11" y="-9" width="26" height="22" fill="#000" opacity="0.2"/>
    <rect x="-13" y="-11" width="26" height="22" rx="1.5" fill="#d8c26a" stroke="#7d6a2a" stroke-width="1"/>
    <path d="M-10 -11 V11 M-5 -11 V11 M0 -11 V11" stroke="#8fae45" stroke-width="2.2"/>
    <rect x="3" y="-1" width="10" height="12" fill="#8fae45" opacity="0.55"/>
    <rect x="4" y="-10" width="8" height="8" fill="#b04a31" stroke="#6b2b1b" stroke-width="0.8"/>
    <line x1="4" y1="-6" x2="12" y2="-6" stroke="#7d3220" stroke-width="1"/>
  </g>

  <!-- FACTORY: turns resources into goods -->
  <g id="factory">
    <rect x="-11" y="-8" width="26" height="20" fill="#000" opacity="0.22"/>
    <rect x="-13" y="-10" width="26" height="20" rx="1.5" fill="#6f7c8f"/>
    <rect x="-13" y="-10" width="6.5" height="20" fill="#8a97ab"/>
    <rect x="0" y="-10" width="6.5" height="20" fill="#8a97ab"/>
    <rect x="-13" y="-10" width="26" height="20" rx="1.5" fill="none" stroke="#2f3744" stroke-width="1"/>
    <circle cx="9" cy="-5" r="3" fill="#3d4450" stroke="#22272f" stroke-width="0.8"/>
    <circle cx="12" cy="-10" r="2.6" fill="#e3e7ec" opacity="0.75"/>
    <circle cx="15.5" cy="-14.5" r="3.4" fill="#e3e7ec" opacity="0.5"/>
  </g>

  <!-- DRILL: mines without people -->
  <g id="drill">
    <rect x="-9" y="-9" width="22" height="22" rx="3" fill="#000" opacity="0.25"/>
    <rect x="-11" y="-11" width="22" height="22" rx="3" fill="#5a636f" stroke="#2a3037" stroke-width="1.2"/>
    <circle cx="-7.5" cy="-7.5" r="1.1" fill="#2a3037"/><circle cx="7.5" cy="-7.5" r="1.1" fill="#2a3037"/>
    <circle cx="-7.5" cy="7.5" r="1.1" fill="#2a3037"/><circle cx="7.5" cy="7.5" r="1.1" fill="#2a3037"/>
    <circle r="7" fill="#f0a23a" stroke="#7a4a12" stroke-width="1.2"/>
    <path d="M-5 0 H5 M0 -5 V5" stroke="#7a4a12" stroke-width="2" stroke-linecap="round"/>
    <circle r="1.8" fill="#3a2a10"/>
  </g>

  <!-- TREE: part of a forest (wood) -->
  <g id="tree">
    <ellipse cx="1.5" cy="3" rx="7" ry="4" fill="#000" opacity="0.18"/>
    <circle r="7" fill="#3d6b32"/>
    <circle cx="-2" cy="-2" r="4.2" fill="#558a3f"/>
    <circle cx="-3" cy="-3" r="1.6" fill="#72a855"/>
  </g>

  <!-- ROCK: part of a stone deposit -->
  <g id="rock">
    <ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 3 L-6 -4 L-1 -7 L5 -5 L8 1 L5 5 L-4 6 Z" fill="#8e959c" stroke="#5f666d" stroke-width="1"/>
    <path d="M-6 -4 L-1 -7 L5 -5 L1 -1 L-4 0 Z" fill="#bcc2c8"/>
  </g>

  <!-- ORE: part of an iron deposit -->
  <g id="ore">
    <ellipse cx="1" cy="4" rx="8" ry="3.5" fill="#000" opacity="0.2"/>
    <path d="M-8 2 L-5 -5 L1 -7 L6 -4 L8 2 L4 6 L-4 5 Z" fill="#7a5040" stroke="#45291f" stroke-width="1"/>
    <path d="M-5 -5 L1 -7 L6 -4 L2 0 L-4 -1 Z" fill="#a96d52"/>
    <circle cx="-3" cy="2" r="1.1" fill="#d6e1ea"/><circle cx="3" cy="-2.5" r="0.9" fill="#d6e1ea"/>
    <circle cx="4" cy="3" r="0.8" fill="#d6e1ea"/>
  </g>

  <!-- LOCKED: placeholder for future buildings -->
  <g id="locked">
    <rect x="-11" y="-11" width="22" height="22" rx="4" fill="#39425a" stroke="#56607a" stroke-dasharray="3 2"/>
    <text x="0" y="5" font-family="{FONT}" font-size="15" font-weight="700" fill="#8792ab" text-anchor="middle">?</text>
  </g>

  <!-- LEVEL 2 HOUSE: needs iron, holds more -->
  <g id="house2">
    <rect x="-9" y="-8" width="24" height="20" fill="#000" opacity="0.22"/>
    <rect x="-12" y="-10" width="24" height="10" fill="#7099c4"/>
    <rect x="-12" y="0" width="24" height="10" fill="#4d6f96"/>
    <rect x="-12" y="-10" width="24" height="20" fill="none" stroke="#2c4260" stroke-width="1"/>
    <line x1="-12" y1="0" x2="12" y2="0" stroke="#2c4260" stroke-width="1.2"/>
    <rect x="-8" y="-8" width="3" height="4" fill="#3a3f4a"/>
    <rect x="5" y="-8" width="3" height="4" fill="#3a3f4a"/>
  </g>

  <!-- DOCK: launches boat expeditions -->
  <g id="dock">
    <rect x="-12" y="-12" width="24" height="24" rx="2" fill="{C['water']}"/>
    <rect x="-12" y="-12" width="24" height="7" fill="{C['sand']}"/>
    <rect x="-4" y="-7" width="8" height="18" fill="#a67c52" stroke="#6b4a2b" stroke-width="0.9"/>
    <path d="M-4 -2 H4 M-4 3 H4 M-4 8 H4" stroke="#6b4a2b" stroke-width="0.8"/>
    <circle cx="-5.5" cy="10" r="1.4" fill="#5a3d22"/><circle cx="5.5" cy="10" r="1.4" fill="#5a3d22"/>
  </g>

  <!-- MOUNTAIN: biome decoration -->
  <g id="mount">
    <path d="M-15 8 L-2 -11 L12 8 Z" fill="#7b7466" stroke="#4f4a40" stroke-width="1" stroke-linejoin="round"/>
    <path d="M-2 -11 L12 8 L3 8 Z" fill="#000" opacity="0.16"/>
    <path d="M-2 -11 L3.5 -3.5 L0.5 -4.5 L-2 -1.5 L-4.5 -4.5 L-7 -3.5 Z" fill="#f1f1ec"/>
  </g>

  <!-- TERRITORY: small icon for diagrams -->
  <g id="terr">
    <path d="M-10 -4 C-10 -11 -2 -11 2 -9 C9 -9 11 -3 10 3 C9 10 1 11 -4 9 C-10 8 -10 3 -10 -4 Z"
          fill="{C['team']}" fill-opacity="0.35" stroke="{C['team']}" stroke-width="2"/>
  </g>

  <g id="cursor">
    <path d="M0 0 L0 17 L4.5 13 L7.5 20 L10.5 18.8 L7.5 12 L13 12 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/>
  </g>
</defs>
"""


# ---------------------------------------------------------------- helpers
def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=12, fill=None, weight=400, anchor="start", ls=0, opacity=1):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" '
            f'font-weight="{weight}" fill="{fill or C["text"]}" text-anchor="{anchor}" '
            f'letter-spacing="{ls}" opacity="{opacity}">{esc(s)}</text>')


def use(ref, x, y, scale=1.0, opacity=1.0):
    op = f' opacity="{opacity}"' if opacity != 1 else ""
    return f'<use href="#{ref}" transform="translate({x:.1f},{y:.1f}) scale({scale})"{op}/>'


def text_w(s, size):
    """Rough width estimate for Segoe-UI-ish fonts."""
    return len(s) * size * 0.56


def svg(body, w=W, h=H):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">\n'
            f'{DEFS}\n{body}\n</svg>\n')


def write(name, content):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("wrote", name)


# ------------------------------------------------------------- map pieces
def blob_points(cx, cy, r, seed, n=36, wobble=0.2, squash=0.85):
    rnd = random.Random(seed)
    waves = [(2, wobble * 0.55), (3, wobble * 0.35), (5, wobble * 0.2), (7, wobble * 0.1)]
    phases = [rnd.uniform(0, 2 * math.pi) for _ in waves]
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + sum(amp * math.sin(f * a + p) for (f, amp), p in zip(waves, phases))
        pts.append((cx + r * k * math.cos(a), cy + r * k * math.sin(a) * squash))
    return pts


def smooth_path(pts):
    n = len(pts)
    d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f} "
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C {c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f} "
    return d + "Z"


OCEAN = "M 870 0 C 925 70 1005 115 1055 190 C 1105 268 1185 312 1280 332 L 1280 0 Z"
LAKE = smooth_path(blob_points(185, 605, 105, seed=3, wobble=0.25, squash=0.6))


def land():
    s = [f'<rect width="{W}" height="{H}" fill="{C["land"]}"/>']
    rnd = random.Random(7)
    for i in range(22):
        x, y, r = rnd.uniform(-50, W + 50), rnd.uniform(-50, H + 50), rnd.uniform(70, 170)
        col = C["land_dark"] if i % 2 else C["land_light"]
        s.append(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{r:.0f}" ry="{r * 0.7:.0f}" '
                 f'fill="{col}" opacity="0.6" filter="url(#soft)"/>')
    s.append(f'<rect width="{W}" height="{H}" fill="url(#grid)"/>')
    return "\n".join(s)


def water():
    s = []
    for d in (OCEAN, LAKE):
        s.append(f'<path d="{d}" fill="none" stroke="{C["sand"]}" stroke-width="12" stroke-linejoin="round"/>')
        s.append(f'<path d="{d}" fill="{C["water"]}"/>')
        s.append(f'<path d="{d}" fill="none" stroke="{C["water_light"]}" stroke-width="3" opacity="0.6"/>')
    # a few wave ticks
    for x, y in [(1150, 90), (1210, 180), (1050, 60), (1180, 250), (980, 40), (160, 600), (230, 618)]:
        s.append(f'<path d="M {x} {y} q 6 -5 12 0 q 6 5 12 0" fill="none" stroke="#dbeefa" '
                 f'stroke-width="1.6" opacity="0.55" stroke-linecap="round"/>')
    return "\n".join(s)


def territory(d, mask_id):
    return "\n".join([
        f'<mask id="{mask_id}"><rect width="{W}" height="{H}" fill="#fff"/><path d="{d}" fill="#000"/></mask>',
        f'<rect width="{W}" height="{H}" fill="#0b160c" opacity="0.2" mask="url(#{mask_id})"/>',
        f'<path d="{d}" fill="{C["team"]}" fill-opacity="0.2"/>',
        f'<path d="{d}" fill="none" stroke="{C["team"]}" stroke-width="4.5" stroke-linejoin="round"/>',
        f'<path d="{d}" fill="none" stroke="{C["team_light"]}" stroke-width="1.2" stroke-opacity="0.9"/>',
    ])


def scatter(cx, cy, r, n, seed, squash=0.8):
    rnd = random.Random(seed)
    pts = []
    for _ in range(n):
        a = rnd.uniform(0, 2 * math.pi)
        d = r * math.sqrt(rnd.random())
        pts.append((cx + d * math.cos(a), cy + d * math.sin(a) * squash, rnd.uniform(0.8, 1.15)))
    return sorted(pts, key=lambda p: p[1])


def deposit(kind, cx, cy, r, seed):
    """kind: forest | stone | iron"""
    s = []
    if kind == "forest":
        s.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{r}" ry="{r * 0.8:.0f}" fill="#4d7a37" opacity="0.45" filter="url(#softsm)"/>')
        for x, y, k in scatter(cx, cy, r, int(r * 0.85), seed):
            s.append(use("tree", x, y, k))
    else:
        tint = "#7d7a66" if kind == "stone" else "#8a5a40"
        ref = "rock" if kind == "stone" else "ore"
        s.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{r * 1.15:.0f}" ry="{r * 0.9:.0f}" fill="{tint}" opacity="0.45" filter="url(#softsm)"/>')
        for x, y, k in scatter(cx, cy, r, int(r * 0.5), seed):
            s.append(use(ref, x, y, k))
    return "\n".join(s)


def town(x0, y0, cols, count, sp=26):
    s = []
    for i in range(count):
        s.append(use("house", x0 + (i % cols) * sp, y0 + (i // cols) * sp))
    return "\n".join(s)


def pill(x, y, label, dot=None, anchor="middle"):
    size = 12
    w = text_w(label, size) + (30 if dot else 20)
    left = x - w / 2 if anchor == "middle" else x
    s = [f'<rect x="{left:.1f}" y="{y - 11:.1f}" width="{w:.1f}" height="22" rx="11" fill="{C["hud"]}" fill-opacity="0.86"/>']
    tx = left + 10
    if dot:
        s.append(f'<circle cx="{left + 12:.1f}" cy="{y:.1f}" r="4" fill="{dot}"/>')
        tx = left + 21
    s.append(text(tx, y + 4.2, label, size, C["text"], 600))
    return "\n".join(s)


def workers(cx, cy, r, n_icons, seed, label, label_dy, label_dx=0):
    rnd = random.Random(seed)
    s = []
    for i in range(n_icons):
        a = math.pi * 0.15 + (math.pi * 0.7) * i / max(1, n_icons - 1) + rnd.uniform(-0.08, 0.08)
        rr = r * rnd.uniform(0.75, 1.0)
        s.append(use("person", cx + rr * math.cos(a), cy + rr * math.sin(a) * 0.8, 1.15))
    s.append(pill(cx + label_dx, cy + label_dy, label, C["accent"]))
    return "\n".join(s)


def progress(x, y, w, frac, label):
    return "\n".join([
        f'<rect x="{x}" y="{y}" width="{w}" height="6" rx="3" fill="{C["hud"]}" fill-opacity="0.85"/>',
        f'<rect x="{x}" y="{y}" width="{w * frac:.1f}" height="6" rx="3" fill="{C["accent"]}"/>',
        pill(x + w / 2, y - 14, label),
    ])


# ----------------------------------------------------------------- the UI
RES_ICONS = {"Wood": "tree", "Stone": "rock", "Iron": "ore"}
PANEL_Y = H - 104 - 14   # top of the bottom UI row
PANEL_H = 104


def hud(resources, territory_pct, clock):
    """Top bar: resources, territory, time. resources = [(name, value, rate)]."""
    s = [f'<rect width="{W}" height="58" fill="{C["hud"]}" fill-opacity="0.93"/>',
         f'<rect y="58" width="{W}" height="1.5" fill="#000" opacity="0.35"/>']
    x = 24
    for name, value, rate in resources:
        s.append(use(RES_ICONS[name], x + 12, 30, 1.35))
        s.append(text(x + 32, 23, name.upper(), 10, C["dim"], 700, ls=1.3))
        s.append(text(x + 152, 23, rate, 10.5, C["dim"] if rate.startswith("+0") else C["good"], 600, anchor="end"))
        s.append(text(x + 32, 44, value, 18, C["text"], 700))
        s.append(f'<rect x="{x + 168}" y="12" width="1" height="34" fill="#2e3850"/>')
        x += 184
    s.append(text(x + 4, 23, "TERRITORY", 10, C["dim"], 700, ls=1.3))
    s.append(f'<rect x="{x + 4}" y="32" width="12" height="12" rx="2" fill="{C["team"]}" fill-opacity="0.5" stroke="{C["team"]}" stroke-width="1.5"/>')
    s.append(text(x + 22, 43, territory_pct, 16, C["text"], 700))
    s.append(text(W - 24, 23, "TIME", 10, C["dim"], 700, ls=1.3, anchor="end"))
    s.append(text(W - 24, 44, clock, 18, C["text"], 700, anchor="end"))
    return "\n".join(s)


def people_panel(people, cap, rate, send_pct):
    """Bottom-centre: the people bar (openfront-style) + people-per-click slider."""
    x, y, w, h = 398, PANEL_Y, 524, PANEL_H
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{C["hud"]}" fill-opacity="0.94" stroke="#000" stroke-opacity="0.3"/>',
         use("person", x + 30, y + 36, 2.3),
         text(x + 56, y + 25, "PEOPLE", 10, C["dim"], 700, ls=1.3),
         text(x + 56, y + 50, f"{people:,} / {cap:,}", 21, C["text"], 700),
         text(x + w - 18, y + 25, rate, 11.5, C["good"], 600, anchor="end")]
    bx, by, bw = x + 196, y + 36, w - 196 - 18
    frac = min(1, people / cap)
    s.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="13" rx="6.5" fill="#2b3446"/>')
    s.append(f'<rect x="{bx}" y="{by}" width="{bw * frac:.1f}" height="13" rx="6.5" fill="{C["accent"]}"/>')
    s.append(f'<rect x="{bx + bw / 2 - 1:.1f}" y="{by - 4}" width="2" height="21" fill="#fff" opacity="0.55"/>')
    s.append(text(bx + bw / 2, by + 27, "regrows fastest at half full", 9.5, C["dim"], 500, anchor="middle"))
    # slider row
    ry = y + 74
    s.append(text(x + 18, ry + 16, "SEND PER CLICK", 10, C["dim"], 700, ls=1.3))
    sx = x + 140
    for i, pct in enumerate((10, 25, 50, 100)):
        px = sx + i * 58
        on = pct == send_pct
        s.append(f'<rect x="{px}" y="{ry}" width="52" height="22" rx="6" fill="{C["accent"] if on else C["panel_hi"]}" stroke="{"#5a4310" if on else "#3d4a6a"}"/>')
        s.append(text(px + 26, ry + 15.5, f"{pct}%", 11.5, "#2a1f05" if on else C["dim"], 700, anchor="middle"))
    s.append(text(sx + 4 * 58 + 6, ry + 16, f"= {round(people * send_pct / 100)} people", 12, C["accent"], 700))
    return "\n".join(s)


BUILD = [("house", "House", [("tree", 10), ("rock", 10)], "1"),
         ("house2", "Level 2", [("tree", 20), ("ore", 10)], "2"),
         ("farm", "Farm", [("tree", 15), ("rock", 5)], "3"),
         ("dock", "Dock", [("tree", 30), ("rock", 10)], "4")]


def build_menu(selected=None, red=(), dimmed=()):
    bw, gap = 88, 6
    x0, y0, bh = 16, PANEL_Y, PANEL_H
    s = []
    for i, (ref, name, cost, key) in enumerate(BUILD):
        bx = x0 + i * (bw + gap)
        sel, dim = ref == selected, ref in dimmed
        stroke = f'stroke="{C["accent"]}" stroke-width="2"' if sel else 'stroke="#000" stroke-opacity="0.3"'
        s.append(f'<rect x="{bx}" y="{y0}" width="{bw}" height="{bh}" rx="12" fill="{C["panel_hi"] if sel else C["hud"]}" fill-opacity="0.94" {stroke}/>')
        s.append(f'<rect x="{bx + 20}" y="{y0 + 10}" width="48" height="46" rx="8" fill="{C["land"]}" opacity="{0.4 if dim else 1}"/>')
        s.append(use(ref, bx + 44, y0 + 33, 1.55, 0.45 if dim else 1))
        s.append(text(bx + 44, y0 + 73, name, 12.5, C["dim"] if dim else C["text"], 700, anchor="middle"))
        cx = bx + 10
        for icon, n in cost:
            col = C["bad"] if ref in red and icon == "ore" or (ref in red and ref != "house2") else C["dim"]
            s.append(use(icon, cx + 6, y0 + 89, 0.72, 0.5 if dim else 1))
            s.append(text(cx + 14, y0 + 93, str(n), 11, col, 700))
            cx += 36
        s.append(f'<rect x="{bx + bw - 20}" y="{y0 + 7}" width="14" height="14" rx="3" fill="#2a3348"/>')
        s.append(text(bx + bw - 13, y0 + 17.5, key, 9.5, C["dim"], 700, anchor="middle"))
    return "\n".join(s)


def mouse(x, y, side):
    hl = (f"M {x - 6} {y - 1} V {y - 3} A 6 6 0 0 1 {x} {y - 9} V {y - 1} Z" if side == "left"
          else f"M {x} {y - 9} A 6 6 0 0 1 {x + 6} {y - 3} V {y - 1} Z")
    return (f'<rect x="{x - 6}" y="{y - 9}" width="12" height="18" rx="6" fill="none" stroke="{C["dim"]}" stroke-width="1.3"/>'
            f'<path d="{hl}" fill="{C["accent"]}"/>'
            f'<line x1="{x}" y1="{y - 9}" x2="{x}" y2="{y - 1}" stroke="{C["dim"]}" stroke-width="1"/>'
            f'<line x1="{x - 6}" y1="{y - 1}" x2="{x + 6}" y2="{y - 1}" stroke="{C["dim"]}" stroke-width="1"/>')


def controls_panel():
    x, y, w, h = 938, PANEL_Y, W - 938 - 16, PANEL_H
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{C["hud"]}" fill-opacity="0.94" stroke="#000" stroke-opacity="0.3"/>',
         text(x + 16, y + 22, "CONTROLS", 10, C["dim"], 700, ls=1.3)]
    rows = [("left", "Click near border: expand there"),
            ("right", "Right-click far away: expedition"),
            (None, "Slider: people sent per click")]
    for i, (side, label) in enumerate(rows):
        ry = y + 46 + i * 22
        if side:
            s.append(mouse(x + 24, ry, side))
        else:
            s.append(f'<rect x="{x + 15}" y="{ry - 4}" width="18" height="6" rx="3" fill="{C["accent"]}"/>')
        s.append(text(x + 42, ry + 4, label, 12, C["text"], 500))
    return "\n".join(s)


def caption(label, y=72):
    return (f'<rect x="16" y="{y}" width="{text_w(label, 12) + 24:.0f}" height="24" rx="6" fill="{C["accent"]}"/>'
            + text(28, y + 16.5, label, 12, "#2a1f05", 700))


# --------------------------------------------------------- map features
def territory2(main, claims, mask_id):
    """main/claims: lists of path strings. Draws one merged territory with a single
    outer border, plus 'being claimed' areas (dashed) outside it."""
    black = lambda ps: "".join(f'<path d="{d}" fill="#000"/>' for d in ps)
    s = [f'<mask id="{mask_id}o"><rect width="{W}" height="{H}" fill="#fff"/>{black(main)}</mask>',
         f'<mask id="{mask_id}f"><rect width="{W}" height="{H}" fill="#fff"/>{black(main + claims)}</mask>',
         f'<rect width="{W}" height="{H}" fill="#0b160c" opacity="0.2" mask="url(#{mask_id}f)"/>']
    if claims:
        s.append(f'<g mask="url(#{mask_id}o)"><g opacity="0.22">'
                 + "".join(f'<path d="{d}" fill="{C["team"]}"/>' for d in claims) + '</g>'
                 + "".join(f'<path d="{d}" fill="none" stroke="{C["team_light"]}" stroke-width="2.2" stroke-dasharray="7 5"/>' for d in claims)
                 + '</g>')
    s.append('<g opacity="0.2">' + "".join(f'<path d="{d}" fill="{C["team"]}"/>' for d in main) + '</g>')
    s.append(f'<g mask="url(#{mask_id}o)">'
             + "".join(f'<path d="{d}" fill="none" stroke="{C["team"]}" stroke-width="9" stroke-linejoin="round"/>' for d in main)
             + "".join(f'<path d="{d}" fill="none" stroke="{C["team_light"]}" stroke-width="2.6"/>' for d in main)
             + '</g>')
    return "\n".join(s)


def push_marker(x, y, n):
    """Gold number at the border: people currently claiming land."""
    label = str(n)
    w = 34 + text_w(label, 14)
    return (f'<rect x="{x - w / 2:.1f}" y="{y - 13}" width="{w:.1f}" height="26" rx="13" fill="{C["hud"]}" fill-opacity="0.92" stroke="{C["accent"]}" stroke-width="2"/>'
            + use("person", x - w / 2 + 14, y + 1, 1.15)
            + text(x - w / 2 + 25, y + 5, label, 14, C["accent"], 800))


def target(x, y):
    return (f'<circle cx="{x}" cy="{y}" r="17" fill="none" stroke="{C["accent"]}" stroke-width="1.5" opacity="0.5"/>'
            f'<circle cx="{x}" cy="{y}" r="9" fill="none" stroke="{C["accent"]}" stroke-width="2.5"/>'
            f'<path d="M {x - 22} {y} h 7 M {x + 15} {y} h 7 M {x} {y - 22} v 7 M {x} {y + 15} v 7" stroke="{C["accent"]}" stroke-width="2" stroke-linecap="round"/>')


def expedition(path_d, mx, my, n, eta):
    return "\n".join([
        f'<path d="{path_d}" fill="none" stroke="#1b1405" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 10" opacity="0.35"/>',
        f'<path d="{path_d}" fill="none" stroke="{C["accent"]}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 10"/>',
        f'<circle cx="{mx}" cy="{my}" r="17" fill="{C["hud"]}" stroke="{C["accent"]}" stroke-width="2.5"/>',
        use("person", mx, my + 1, 1.5),
        pill(mx, my + 32, f"Expedition · {n} people · arrives in {eta}", C["accent"]),
    ])


def countdown_ring(cx, cy, r, frac):
    circ = 2 * math.pi * r
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="7"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#ff9f43" stroke-width="5" stroke-linecap="round" '
            f'stroke-dasharray="{circ * frac:.1f} {circ:.1f}" transform="rotate(-90 {cx} {cy})"/>')


def ghost(ref, x, y, tip_lines, tip_x, tip_y, w=196):
    s = [f'<rect x="{x - 13}" y="{y - 12}" width="26" height="24" rx="3" fill="{C["good"]}" fill-opacity="0.25" stroke="{C["good"]}" stroke-width="1.5" stroke-dasharray="4 3"/>',
         use(ref, x, y, 1, 0.6),
         use("cursor", x + 6, y + 4)]
    h = 18 + 18 * len(tip_lines)
    s.append(f'<rect x="{tip_x}" y="{tip_y}" width="{w}" height="{h}" rx="9" fill="{C["hud"]}" fill-opacity="0.95" stroke="{C["good"]}" stroke-opacity="0.6"/>')
    for i, (line, col, wt) in enumerate(tip_lines):
        s.append(text(tip_x + 12, tip_y + 22 + 18 * i, line, 13 if i == 0 else 11.5, col, wt))
    return "\n".join(s)


# ----------------------------------------------------------- map (v2)
START = (600, 355)
MOUNTAINS = smooth_path(blob_points(225, 200, 150, seed=21, wobble=0.22, squash=0.72))
DESERT = smooth_path(blob_points(1045, 520, 170, seed=22, wobble=0.2, squash=0.66))

DEPOSITS = {
    "forest_a": ("forest", 498, 318, 42, 1),
    "stone_a": ("stone", 714, 402, 28, 2),
    "forest_b": ("forest", 418, 470, 38, 4),
    "forest_c": ("forest", 792, 258, 36, 7),
    "iron_m": ("iron", 205, 180, 30, 3),
    "stone_m": ("stone", 318, 262, 24, 5),
    "iron_d": ("iron", 1040, 500, 30, 6),
    "stone_d": ("stone", 1160, 575, 24, 10),
    "forest_w": ("forest", 80, 420, 44, 9),
    "forest_s": ("forest", 700, 545, 36, 12),
}
MOUNT_PEAKS = [(110, 150), (150, 230), (270, 120), (330, 170), (250, 250), (95, 205), (370, 225), (180, 120),
               (300, 205), (140, 270), (215, 280)]


def biomes():
    s = [f'<path d="{DESERT}" fill="#dcc584" opacity="0.9" filter="url(#softsm)"/>',
         f'<path d="{DESERT}" fill="#e0ca8a" opacity="0.55"/>']
    for x, y in [(960, 470), (1110, 450), (990, 590), (1120, 520), (1200, 610), (930, 545)]:
        s.append(f'<path d="M {x} {y} q 14 -9 28 0 q 10 6 20 0" fill="none" stroke="#c2a75f" stroke-width="2" stroke-linecap="round" opacity="0.8"/>')
    s.append(f'<path d="{MOUNTAINS}" fill="#8f8b72" opacity="0.85" filter="url(#softsm)"/>')
    s.append(f'<path d="{MOUNTAINS}" fill="#959078" opacity="0.5"/>')
    for x, y in sorted(MOUNT_PEAKS, key=lambda p: p[1]):
        s.append(use("mount", x, y, 1.25))
    return "\n".join(s)


def biome_label(x, y, name, fert):
    return pill(x, y, f"{name} · fertility {fert}")


def dep(name):
    _, x, y, r, _ = DEPOSITS[name]
    return x, y, r


def all_deposits():
    return "\n".join(deposit(*v) for v in DEPOSITS.values())


def produce(name, label, dy):
    x, y, r = dep(name)
    return pill(x, y + dy, label, C["good"])


def base2(main, claims, mask_id):
    return "\n".join([land(), biomes(), territory2(main, claims, mask_id), water(), all_deposits()])


def blob(cx, cy, r, seed, **kw):
    return smooth_path(blob_points(cx, cy, r, seed=seed, **kw))


def bottom_ui(people, cap, rate, send_pct, **build_kw):
    return "\n".join([build_menu(**build_kw), people_panel(people, cap, rate, send_pct), controls_panel()])


# -------------------------------------------------------------- snapshots
def snapshot_start():
    main = [blob(*START, 165, 11)]
    claims = [blob(752, 270, 72, 31, wobble=0.25)]
    body = [
        base2(main, claims, "t1"),
        town(553, 332, 5, 10),
        produce("forest_a", "+1.0 wood/s", -54),
        produce("stone_a", "+1.0 stone/s", 44),
        pill(605, 392, "Starting town · 10 houses", "#de6d4c"),
        target(800, 236),
        use("cursor", 806, 242),
        push_marker(770, 290, 25),
        pill(842, 330, "Claiming grassland · 1 person / tile"),
        biome_label(225, 330, "Mountains", "10%"),
        biome_label(1045, 420, "Desert", "20%"),
        hud([("Wood", "14", "+1.0/s"), ("Stone", "12", "+1.0/s"), ("Iron", "0", "+0/s")], "0.4%", "00:20"),
        bottom_ui(75, 100, "+1.9 / sec", 25, red=("house2",), dimmed=("dock",)),
        caption("SNAPSHOT 1 · FIRST PUSH"),
    ]
    write("snapshot-1-start.svg", svg("\n".join(body)))


def snapshot_early():
    main = [blob(*START, 235, 11), blob(785, 262, 78, 31)]
    ix, iy, _ = dep("iron_d")
    path = f"M 815 372 C 880 380 930 420 {ix - 22} {iy - 8}"
    body = [
        base2(main, [], "t2"),
        town(553, 332, 5, 18),
        produce("forest_a", "+1.0 wood/s", -54),
        produce("forest_b", "+1.0 wood/s", 50),
        produce("forest_c", "+1.0 wood/s", -46),
        produce("stone_a", "+1.0 stone/s", 44),
        target(ix, iy),
        expedition(path, 905, 405, 40, "0:14"),
        use("cursor", ix + 8, iy + 6),
        biome_label(225, 330, "Mountains", "10%"),
        biome_label(1150, 432, "Desert", "20%"),
        hud([("Wood", "86", "+3.0/s"), ("Stone", "41", "+1.0/s"), ("Iron", "0", "+0/s")], "1.3%", "06:30"),
        bottom_ui(98, 180, "+2.6 / sec", 25, red=("house2",), dimmed=("dock",)),
        caption("SNAPSHOT 2 · EXPEDITION"),
    ]
    write("snapshot-2-early.svg", svg("\n".join(body)))


def snapshot_mid():
    main = [blob(*START, 250, 11), blob(785, 262, 78, 31)]
    ix, iy, _ = dep("iron_d")
    outpost = blob(ix, iy + 10, 72, 41, squash=0.8)
    claims = [blob(352, 228, 62, 33, wobble=0.25)]
    body = [
        base2(main + [outpost], claims, "t3"),
        town(553, 332, 5, 23),
        produce("forest_a", "+1.0 wood/s", -54),
        produce("stone_a", "+1.0 stone/s", 44),
        pill(ix + 128, iy + 14, "+1.0 iron/s", C["good"]),
        # push into the mountains
        push_marker(318, 214, 48),
        pill(322, 300, "Claiming mountains · 5 people / tile"),
        # outpost
        countdown_ring(ix, iy + 8, 90, 0.35),
        use("farm", ix - 44, iy + 34),
        use("house", ix - 12, iy + 46),
        use("house", ix + 14, iy + 46),
        pill(ix, iy - 128, "Outpost · 40 people · housing for 12", C["bad"]),
        pill(ix, iy - 102, "Supplies 0:21 · build more or 28 will starve", "#ff9f43"),
        ghost("house", ix - 50, iy - 6,
              [("Place House", C["text"], 700),
               ("Holds 6 here (desert 20%, farm +40%)", C["good"], 600),
               ("10 wood · 10 stone", C["dim"], 400)],
              ix - 300, iy - 46, 226),
        biome_label(110, 330, "Mountains", "10%"),
        hud([("Wood", "112", "+3.0/s"), ("Stone", "38", "+1.0/s"), ("Iron", "4", "+1.0/s")], "1.9%", "09:50"),
        bottom_ui(131, 230, "+3.1 / sec", 25, selected="house", red=("house2",), dimmed=("dock",)),
        caption("SNAPSHOT 3 · OUTPOST"),
    ]
    write("snapshot-3-mid.svg", svg("\n".join(body)))


# ------------------------------------------------------------- item sheet
ITEMS = [
    ("person", "Person", ["The currency.", "Spent to claim land.", "Regrows toward capacity."]),
    ("house", "House", ["Holds 10 × fertility.", "Cost: 10 wood · 10 stone.", "Only source of capacity."]),
    ("house2", "Level 2 house", ["Holds 30 × fertility.", "Cost: 20 wood · 10 iron.", "Iron is far: expedition."]),
    ("farm", "Farm", ["Raises fertility nearby.", "e.g. desert 20% → 60%.", "Cost: 15 wood · 5 stone."]),
    ("dock", "Dock", ["Launches boat expeditions.", "Must be on the coast.", "Cost: 30 wood · 10 stone."]),
    ("territory", "Territory", ["Your land + border line.", "Deposits inside produce.", "1–5 people per tile."]),
    ("forest", "Forest", ["Gives wood (+1/s).", "Used for most buildings.", "Near the start."]),
    ("stone", "Stone deposit", ["Gives stone (+1/s).", "Used for houses, farms.", "Near the start."]),
    ("iron", "Iron deposit", ["Gives iron (+1/s).", "Never near the start.", "Unlocks level 2 houses."]),
    ("locked", "Parked", ["Factories, drills,", "roads... come back", "once the core works."]),
]


def item_sheet():
    sw, sh = 1280, 750
    cols, gap, mx, top = 5, 16, 30, 110
    cw, ch = (sw - 2 * mx - (cols - 1) * gap) // cols, 300
    s = [f'<rect width="{sw}" height="{sh}" fill="#121722"/>',
         text(mx, 56, "Item models", 30, C["text"], 700),
         text(mx, 84, "Top-down, flat shapes, readable at 20 px. Every number is a placeholder to tune later.", 14, C["dim"])]
    for i, (ref, name, lines) in enumerate(ITEMS):
        x = mx + (i % cols) * (cw + gap)
        y = top + (i // cols) * (ch + gap)
        tx, ty, tw, th = x + 12, y + 12, cw - 24, 150
        cx, cy = tx + tw / 2, ty + th / 2
        s.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="14" fill="{C["panel"]}" stroke="#2c3650"/>')
        s.append(f'<clipPath id="clip{i}"><rect x="{tx}" y="{ty}" width="{tw}" height="{th}" rx="10"/></clipPath>')
        s.append(f'<g clip-path="url(#clip{i})">')
        s.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="{th}" fill="{C["land"]}"/>')
        s.append(f'<rect x="{tx}" y="{ty}" width="{tw}" height="{th}" fill="url(#grid)"/>')
        if ref in ("forest", "stone", "iron"):
            s.append(f'<g transform="translate({cx},{cy}) scale(1.9)">{deposit(ref, 0, 0, 30, 99 + i)}</g>')
        elif ref == "territory":
            d = smooth_path(blob_points(cx, cy, 78, seed=11, squash=0.68))
            s.append(f'<path d="{d}" fill="{C["team"]}" fill-opacity="0.22"/>')
            s.append(f'<path d="{d}" fill="none" stroke="{C["team"]}" stroke-width="4.5"/>')
            s.append(f'<path d="{d}" fill="none" stroke="{C["team_light"]}" stroke-width="1.2"/>')
            s.append(use("house", cx - 16, cy, 1.6) + use("house", cx + 16, cy, 1.6))
        elif ref == "person":
            for dx in (-34, 0, 34):
                s.append(use("person", cx + dx, cy + 4, 4.2 if dx == 0 else 3.2, 1 if dx == 0 else 0.75))
        else:
            s.append(use(ref, cx, cy, 4))
        s.append("</g>")
        s.append(text(x + 16, y + 194, name, 19, C["text"], 700))
        for j, line in enumerate(lines):
            s.append(text(x + 16, y + 221 + j * 21, line, 12.5, C["dim"]))
    return svg("\n".join(s), sw, sh)


# ----------------------------------------------------- food-zone concept
def zone(cx, cy, r):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{C["good"]}" fill-opacity="0.12" '
            f'stroke="{C["good"]}" stroke-width="2.5" stroke-dasharray="9 6"/>')


def food_zones():
    fw, fh = 1280, 600
    t = smooth_path(blob_points(560, 310, 345, seed=5, squash=0.72))
    hx, hy = 560, 478  # hungry houses
    body = [
        land(),
        territory(t, "fogf"),
        water(),
        deposit("forest", 205, 190, 40, 51),
        deposit("stone", 470, 175, 26, 52),
        deposit("iron", 835, 300, 28, 53),
        deposit("forest", 1120, 470, 50, 54),
        # main town + its farm zone
        zone(345, 300, 165),
        town(300, 250, 5, 15),
        use("farm", 285, 355), use("farm", 318, 355), use("farm", 351, 355),
        pill(345, 120, "Farm zone: 3 farms feed up to 150 people", C["good"]),
        # outpost
        zone(800, 345, 105),
        use("farm", 770, 385), use("house", 760, 335), use("house", 786, 335), use("house", 760, 361),
        workers(835, 300, 28, 4, 61, "Outpost: 30 workers on far iron", -48),
        pill(800, 470, "Outpost: build the farm first, then houses", C["good"]),
        # hungry houses
        use("house", hx - 26, hy), use("house", hx, hy), use("house", hx + 26, hy),
        f'<rect x="{hx - 42}" y="{hy - 16}" width="84" height="32" rx="6" fill="none" stroke="{C["bad"]}" stroke-width="2.5"/>',
        f'<circle cx="{hx + 42}" cy="{hy - 16}" r="10" fill="{C["bad"]}"/>',
        text(hx + 42, hy - 11, "!", 14, "#fff", 800, anchor="middle"),
        pill(hx, hy + 38, "Outside any farm zone: no growth, people leave", C["bad"]),
        caption("FOOD IDEA · FARM ZONES (OPTION B)").replace('y="72"', 'y="16"').replace('y="88.5"', 'y="32.5"'),
    ]
    return svg("\n".join(body), fw, fh)


# ---------------------------------------------------------- loop diagram
def node(x, y, w, h, icon, title, sub, color):
    return "\n".join([
        f'<rect x="{x - w / 2}" y="{y - h / 2}" width="{w}" height="{h}" rx="14" fill="{C["panel"]}" stroke="{color}" stroke-width="2"/>',
        f'<rect x="{x - w / 2 + 12}" y="{y - 22}" width="44" height="44" rx="9" fill="{C["land"]}"/>',
        use(icon, x - w / 2 + 34, y, 1.45),
        text(x - w / 2 + 68, y - 3, title, 17, C["text"], 700),
        text(x - w / 2 + 68, y + 16, sub, 11.5, C["dim"]),
    ])


def edge(d, label, lx, ly, gold=False, dashed=False):
    col = C["accent"] if gold else "#c9d3e3"
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    marker = "arrowgold" if gold else "arrow"
    return (f'<path d="{d}" fill="none" stroke="{col}" stroke-width="2.4"{dash} marker-end="url(#{marker})"/>'
            + text(lx, ly, label, 12.5, col, 600, anchor="middle"))


def loop_diagram():
    lw, lh = 1100, 500
    dim = "#c9d3e3"
    s = [f'<rect width="{lw}" height="{lh}" fill="#121722"/>',
         text(40, 52, "The core loop", 28, C["text"], 700),
         text(40, 80, "Houses are the engine, people are the fuel. Land you own makes resources; resources build houses.", 14, C["dim"]),
         node(260, 190, 220, 72, "person", "People", "regrow toward capacity", C["accent"]),
         node(840, 190, 220, 72, "terr", "Territory", "your border", C["team"]),
         node(840, 400, 220, 72, "rock", "Resources", "wood · stone · iron", dim),
         node(260, 400, 220, 72, "house", "Houses", "set people capacity", "#de6d4c"),
         ]
    s.append(edge("M 376 190 L 722 190", "", 0, 0, gold=True))
    s.append(text(549, 168, "spend people to claim land", 13, C["accent"], 700, anchor="middle"))
    s.append(text(549, 216, "left-click: expand  ·  right-click: expedition", 12, C["accent"], 500, anchor="middle"))
    s.append(edge("M 840 230 L 840 360", "", 0, 0))
    s.append(text(858, 290, "deposits inside", 12.5, dim, 600))
    s.append(text(858, 308, "your border produce", 12.5, dim, 600))
    s.append(edge("M 722 400 L 376 400", "", 0, 0))
    s.append(text(549, 388, "spend wood + stone to build", 12.5, dim, 600, anchor="middle"))
    s.append(edge("M 260 360 L 260 230", "", 0, 0, gold=True))
    s.append(text(242, 290, "more capacity,", 12.5, C["accent"], 600, anchor="end"))
    s.append(text(242, 308, "people regrow to fill it", 12.5, C["accent"], 600, anchor="end"))
    s.append(text(549, 470, "Iron (far away, reached by expedition) unlocks level 2 houses: a bigger engine.", 12.5, C["dim"], 500, anchor="middle"))
    return svg("\n".join(s), lw, lh)


if __name__ == "__main__":
    write("items.svg", item_sheet())
    write("core-loop.svg", loop_diagram())
    write("food-zones.svg", food_zones())
    snapshot_start()
    snapshot_early()
    snapshot_mid()
