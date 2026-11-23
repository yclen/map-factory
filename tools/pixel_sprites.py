"""Draws the game's pixel-art sprites and saves them to prototype/sprites/.

Every sprite is a 32x32 grid painted from a shared palette, then given a dark outline and a soft
ground shadow. Light comes from the top left: left faces are lighter, right faces darker.

    python tools/pixel_sprites.py            # writes every sprite
    python tools/pixel_sprites.py rig silo   # writes only these
    python tools/pixel_sprites.py --preview  # also writes 8x enlarged previews to tools/previews/

After adding a new name here, list it in prototype/sprites/sprites.json.
"""
import math
import random
import sys
from pathlib import Path
from PIL import Image

N = 32
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'prototype' / 'sprites'
PREVIEW = ROOT / 'tools' / 'previews'

PAL = {
    'K': '#2a1f1a',                                    # outline
    'r': '#c9553a', 'R': '#e07a54', 'q': '#8f3526',    # red roof: mid, lit, shade
    'w': '#e8d3a8', 'W': '#c9b088',                    # plaster wall, wall shade
    'b': '#6b4a2b', 'd': '#4e3a33',                    # timber, door
    'y': '#f2d98a', 'Y': '#f2c14e',                    # lit window, gold
    'u': '#4d6f96', 'U': '#7099c4',                    # blue roof, lit
    't': '#d9c7a0', 'T': '#b0996f',                    # tower stone, shade
    '1': '#3f4857', '2': '#5f6b7d', '3': '#7c8fa4', '4': '#a3b4c6',  # city blocks, dark to light
    'm': '#7d858f', 'M': '#b3b9be', 'n': '#4c535b',    # steel, lit steel, dark steel
    'o': '#c98f2a', 'O': '#e0a93a',                    # rig gold: shade, lit
    'c': '#c9a66b', 'C': '#e3c58d',                    # canvas tent, lit
    'e': '#e8ecef', 'E': '#b9c2ca',                    # rocket white, shade
    'x': '#d64045', 'X': '#9e2a30',                    # red, dark red
    'g': '#8d969e', 'G': '#c2c8cd',                    # rock grey, lit
    'f': '#7a4a38', 'F': '#bd7b56',                    # iron ore rust
    'k': '#1d2126',                                    # hazard black / deep hole
    'B': '#5fc4f0',                                    # fuel blue
}
SHADOW = (0, 0, 0, 56)


class Sprite:
    def __init__(self):
        self.g = [[None] * N for _ in range(N)]

    def px(self, x, y, c):
        if 0 <= x < N and 0 <= y < N:
            self.g[y][x] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def line(self, x0, y0, x1, y1, c, thick=1):
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(steps + 1):
            x = round(x0 + (x1 - x0) * i / steps)
            y = round(y0 + (y1 - y0) * i / steps)
            self.rect(x, y, thick, thick, c)

    def outline(self, c='K'):
        solid = {(x, y) for y in range(N) for x in range(N) if self.g[y][x]}
        for x, y in solid:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) not in solid:
                    self.px(x + dx, y + dy, c)

    # --- top-down shapes, in the game's SVG units: the 32 pixels span -15..15, centre at 0
    # Each pixel is filled when its centre lies inside the shape, after undoing translate(tx, ty) scale(s).
    def _cells(self, inside, tx=0.0, ty=0.0, s=1.0):
        for py in range(N):
            for px in range(N):
                u = ((px + 0.5) * 30 / N - 15 - tx) / s
                v = ((py + 0.5) * 30 / N - 15 - ty) / s
                if inside(u, v):
                    yield px, py

    def disc(self, cx, cy, r, c, **t):
        for x, y in self._cells(lambda u, v: (u - cx) ** 2 + (v - cy) ** 2 <= r * r, **t):
            self.px(x, y, c)

    def poly(self, pts, c, **t):
        def inside(u, v):
            hit = False
            for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
                if (y0 > v) != (y1 > v) and u < x0 + (v - y0) * (x1 - x0) / (y1 - y0):
                    hit = not hit
            return hit
        for x, y in self._cells(inside, **t):
            self.px(x, y, c)

    def blob_shadow(self, cx, cy, rx, ry, **t):
        """A soft shadow on the ground under a top-down object (drawn below the art)."""
        self.sh = getattr(self, 'sh', set())
        self.sh |= set(self._cells(lambda u, v: ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1, **t))

    def shadow_poly(self, pts, **t):
        """A shadow shaped like the polygon (in SVG units), drawn below the art."""
        self.g, scratch = [[None] * N for _ in range(N)], self.g
        self.poly(pts, 'S', **t)
        cells = {(x, y) for y in range(N) for x in range(N) if self.g[y][x]}
        self.g = scratch
        self.sh = getattr(self, 'sh', set()) | cells

    def image(self, shadow=(16, 29, 12)):
        img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        if hasattr(self, 'sh'):         # top-down: the blob shadow
            for x, y in self.sh:
                img.putpixel((x, y), SHADOW)
        else:                           # front-on: a flat ground shadow under the art
            cx, cy, rx = shadow
            for x in range(cx - rx, cx + rx):
                for y in (cy - 1, cy, cy + 1):
                    if abs(x - cx + 0.5) / rx + abs(y - cy) / 2.5 < 1.05:
                        img.putpixel((x, y), SHADOW)
        for y in range(N):
            for x in range(N):
                c = self.g[y][x]
                if c:
                    h = PAL.get(c, c)       # a palette letter, or a '#rrggbb' colour
                    img.putpixel((x, y), (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255))
        return img


def darken(h, k=0.55):
    return '#' + ''.join(f'{int(int(h[i:i + 2], 16) * k):02x}' for i in (1, 3, 5))


def lighten(h, k=0.35):
    return '#' + ''.join(f'{int(int(h[i:i + 2], 16) + (255 - int(h[i:i + 2], 16)) * k):02x}' for i in (1, 3, 5))


# ---------------------------------------------------------------- building blocks

def cottage(s, cx, base, w, roof='r', lit='R', shade='q'):
    """A front-on cottage: plaster wall with a door and window, gabled roof above. `base` is the bottom row."""
    h = max(3, round(w * 0.55))
    x0 = cx - w // 2
    s.rect(x0, base - h + 1, w, h, 'w')
    s.rect(x0 + w - 1, base - h + 1, 1, h, 'W')                       # shaded right edge
    s.rect(cx - (1 if w < 10 else 1), base - 2, 2, 3, 'd')           # door
    if w >= 8:
        s.rect(x0 + 1, base - h + 2, 2, 2, 'y')                       # window
    if w >= 12:
        s.rect(x0 + w - 4, base - h + 2, 2, 2, 'y')
    top = base - h
    half = w // 2 + 1                                                 # eaves stick out one pixel
    row = 0
    while half - row >= 0:
        y = top - row
        for x in range(cx - half + row, cx + half - row + (w % 2)):
            s.px(x, y, lit if x < cx else roof)
        row += 1
    s.rect(cx - half, top, 2 * half + (w % 2), 1, shade)             # dark eave line


def block(s, x, w, top, base, face='3', side='2'):
    """A city tower: lit face, shaded right side, rows of lit windows."""
    s.rect(x, top, w, base - top + 1, face)
    s.rect(x + w - 2, top, 2, base - top + 1, side)
    s.rect(x, top, w, 1, '4')                                          # roof edge catches the light
    for y in range(top + 2, base - 1, 3):
        for xx in range(x + 1, x + w - 2, 2):
            s.px(xx, y, 'y')


# ---------------------------------------------------------------- the sprites

def settle1():
    s = Sprite()
    cottage(s, 16, 26, 14)
    s.outline()
    return s.image()


def settle2():
    s = Sprite()
    cottage(s, 9, 21, 9)
    cottage(s, 23, 21, 9)
    cottage(s, 16, 27, 12)
    s.outline()
    return s.image()


def settle3():
    s = Sprite()
    cottage(s, 7, 20, 8)
    cottage(s, 25, 20, 8)
    # stone tower with a blue spire
    s.rect(13, 9, 7, 18, 't')
    s.rect(18, 9, 2, 18, 'T')
    s.rect(15, 12, 2, 2, 'd'); s.rect(15, 17, 2, 2, 'd')
    for row in range(6):
        for x in range(12 + row, 21 - row):
            s.px(x, 8 - row, 'U' if x < 16 else 'u')
    s.px(16, 2, 'Y')
    cottage(s, 8, 27, 8)
    cottage(s, 24, 27, 8)
    s.outline()
    return s.image()


def settle4():
    s = Sprite()
    block(s, 3, 6, 14, 27, '3', '2')
    block(s, 23, 7, 10, 27, '4', '3')
    block(s, 9, 7, 6, 27, '2', '1')
    block(s, 16, 7, 4, 27, '3', '2')
    s.rect(19, 2, 1, 2, 'm'); s.px(19, 1, 'x')                        # antenna with a red light
    cottage(s, 5, 28, 6)
    cottage(s, 27, 28, 6)
    s.outline()
    return s.image(shadow=(16, 29, 14))


def rig():
    s = Sprite()
    # steel base platform
    s.rect(4, 24, 24, 4, 'm'); s.rect(4, 24, 24, 1, 'M'); s.rect(4, 27, 24, 1, 'n')
    # gold A-frame derrick
    s.line(8, 23, 15, 4, 'O', 2)
    s.line(23, 23, 16, 4, 'o', 2)
    s.line(11, 17, 20, 17, 'O')
    s.line(13, 11, 18, 11, 'O')
    s.line(10, 20, 21, 14, 'o')                                         # cross brace
    # drill string down the middle and the lamp on top
    s.rect(15, 4, 2, 20, 'n')
    s.rect(14, 2, 4, 3, 'Y')
    # ore that came up, piled on the right
    s.rect(24, 21, 4, 3, 'f'); s.rect(25, 20, 2, 1, 'F'); s.px(24, 21, 'F')
    s.outline()
    return s.image(shadow=(16, 29, 13))


def camp():
    s = Sprite()
    # tent: lit left slope, shaded right, dark door flap
    for row in range(17):
        y = 26 - row
        half = 9 - row * 9 // 17
        for x in range(12 - half, 12 + half + 1):
            s.px(x, y, 'C' if x < 12 else 'c')
    s.rect(11, 21, 3, 6, 'd'); s.px(12, 20, 'd')
    s.rect(12, 9, 1, 3, 'b')                                            # ridge pole tip
    # pickaxe leaning on a rock pile
    s.rect(20, 23, 9, 4, 'g'); s.rect(21, 22, 6, 1, 'G'); s.rect(20, 23, 3, 1, 'G')
    s.px(24, 24, 'F'); s.px(27, 25, 'F')
    s.line(23, 22, 27, 11, 'b')
    s.line(23, 13, 25, 10, 'G'); s.rect(26, 9, 2, 2, 'g'); s.line(28, 10, 30, 13, 'g')   # pick head across the handle top
    s.outline()
    return s.image(shadow=(15, 29, 13))


def silo():
    s = Sprite()
    # concrete bunker with a hazard-striped lip
    s.rect(3, 19, 26, 9, 'm'); s.rect(3, 19, 26, 1, 'M'); s.rect(27, 19, 2, 9, 'n')
    for x in range(3, 29):
        s.px(x, 20, 'Y' if (x // 2) % 2 == 0 else 'k')
    s.rect(9, 22, 14, 3, 'k')                                           # open hatch
    s.rect(4, 23, 4, 3, 'n'); s.rect(24, 23, 4, 3, 'n')                 # hatch doors folded back
    # missile rising out of it
    s.rect(13, 7, 6, 15, 'e'); s.rect(17, 7, 2, 15, 'E')
    s.rect(13, 12, 6, 2, 'x'); s.rect(17, 12, 2, 2, 'X')
    for row in range(4):
        for x in range(14 + row // 2, 18 - row // 2):
            s.px(x, 6 - row, 'x' if x < 17 else 'X')
    s.rect(11, 18, 2, 4, 'X'); s.rect(19, 18, 2, 4, 'X')                # fins
    s.outline()
    return s.image(shadow=(16, 29, 14))


def pad():
    s = Sprite()
    # launch deck with hazard stripes
    s.rect(2, 25, 28, 3, 'm'); s.rect(2, 25, 28, 1, 'M')
    for x in range(2, 30):
        if (x // 2) % 2 == 0:
            s.px(x, 27, 'Y')
    # service tower on the left
    s.rect(4, 6, 4, 19, 'n')
    for y in range(8, 24, 4):
        s.line(4, y, 7, y + 3, 'm')
    s.rect(8, 10, 5, 1, 'm'); s.rect(8, 16, 5, 1, 'm')                  # arms reaching the rocket
    s.px(5, 5, 'x')
    # rocket: white body, red nose and fins, blue fuel band
    s.rect(13, 7, 6, 17, 'e'); s.rect(17, 7, 2, 17, 'E')
    s.rect(13, 13, 6, 2, 'B')
    for row in range(5):
        for x in range(13 + row // 2 + (row > 3), 19 - row // 2 - (row > 3)):
            s.px(x, 6 - row, 'x' if x < 17 else 'X')
    s.rect(11, 19, 2, 5, 'x'); s.rect(19, 19, 2, 5, 'X')
    s.rect(14, 24, 4, 1, 'n')                                           # engine bell
    # fuel tank on the right
    s.rect(23, 18, 6, 7, 'e'); s.rect(27, 18, 2, 7, 'E'); s.rect(24, 20, 3, 3, 'B')
    s.outline()
    return s.image(shadow=(16, 29, 14))


def station():
    """Train station, front-on: a plaster hall with a red hipped roof and a clock, rails along the front."""
    s = Sprite()
    # rails in front: wooden sleepers under two steel rails
    for x in range(3, 29, 3):
        s.rect(x, 23, 2, 5, 'b')
    s.rect(2, 24, 28, 1, 'M'); s.rect(2, 26, 28, 1, 'm')
    s.rect(4, 21, 24, 2, 't'); s.rect(4, 21, 24, 1, '#e8dcc0')          # stone platform
    # the hall
    s.rect(6, 11, 20, 10, 'w'); s.rect(24, 11, 2, 10, 'W')
    s.rect(14, 15, 4, 6, 'd'); s.px(15, 14, 'd'); s.px(16, 14, 'd')      # arched door
    for x in (8, 20):                                                     # tall windows
        s.rect(x, 14, 2, 4, 'y'); s.px(x, 13, 'y')
    # red hipped roof, lit on the left
    for row in range(5):
        y = 10 - row
        for x in range(4 + row, 28 - row):
            s.px(x, y, 'R' if x < 16 else 'r')
    s.rect(4, 10, 24, 1, 'q')
    s.rect(14, 4, 4, 3, 'e'); s.px(15, 5, 'k'); s.px(16, 5, 'k'); s.px(16, 4, 'k')   # clock on the ridge
    s.outline()
    return s.image(shadow=(16, 29, 14))


def port():
    """Harbour, front-on: a wooden pier over the water, a gold crane lifting a container off it."""
    s = Sprite()
    # water along the bottom, with a few wave glints
    s.rect(2, 22, 28, 6, 'u')
    for x, y in ((4, 24), (5, 24), (12, 26), (13, 26), (24, 23), (25, 23), (27, 26)):
        s.px(x, y, 'U')
    # pier: planks on posts
    s.rect(3, 18, 22, 3, '#a67c52'); s.rect(3, 18, 22, 1, '#c99a6a'); s.rect(3, 20, 22, 1, 'b')
    for x in range(4, 25, 5):
        s.rect(x, 21, 2, 4, 'b')
    s.rect(4, 16, 2, 2, 'n'); s.rect(22, 16, 2, 2, 'n')                    # bollards
    s.rect(10, 14, 6, 4, '#2f7de1'); s.rect(10, 14, 6, 1, '#6aa8f0'); s.rect(15, 14, 1, 4, '#1c4f99')   # container on the pier
    # crane: a gold tower on the pier, its boom reaching out over the water
    s.rect(24, 5, 3, 13, 'O'); s.rect(26, 5, 1, 13, 'o')
    for y in range(7, 17, 3):
        s.px(25, y, 'o')
    s.rect(5, 4, 22, 2, 'O'); s.rect(5, 5, 22, 1, 'o')
    s.line(23, 6, 18, 4, 'o')                                             # brace
    s.rect(7, 6, 1, 6, 'n')                                               # cable
    s.rect(4, 12, 7, 4, '#e07a54'); s.rect(4, 12, 7, 1, lighten('#e07a54')); s.rect(10, 12, 1, 4, darken('#e07a54', 0.7))   # container on the hook
    s.outline()
    s.sh = set()                                                           # it stands in water: no ground shadow
    return s.image()


def burner():
    """Burner power plant, front-on: a brick boiler house with a fire glowing in its door, a chimney puffing smoke."""
    s = Sprite()
    brick, lit, dark = '#8a5a44', '#a8705a', '#6b4535'
    s.rect(4, 13, 20, 14, brick); s.rect(4, 13, 20, 1, lit); s.rect(22, 13, 2, 14, dark)
    for y in range(15, 27, 3):                                            # mortar lines, staggered
        s.rect(4, y, 18, 1, dark)
        for x in range(5 + (y // 3 % 2) * 2, 22, 4):
            s.px(x, y + 1, dark)
    s.rect(3, 11, 22, 2, 'n'); s.rect(3, 11, 22, 1, 'm')                 # roof slab
    # chimney
    s.rect(17, 3, 5, 8, dark); s.rect(17, 3, 1, 8, brick); s.rect(16, 2, 7, 2, 'n'); s.rect(16, 2, 7, 1, 'm')
    # firebox door with the flames inside
    s.rect(8, 18, 8, 8, 'k')
    s.rect(9, 22, 6, 4, 'x'); s.rect(10, 21, 4, 4, 'O'); s.rect(11, 22, 2, 3, 'Y'); s.px(9, 21, 'x'); s.px(14, 20, 'O')
    # coal heap on the right
    s.rect(25, 24, 5, 3, 'k'); s.rect(26, 23, 3, 1, 'k'); s.px(26, 24, 'n'); s.px(28, 25, 'n')
    s.outline()
    for x, y, c in ((24, 2, '#d6d9dc'), (25, 2, '#d6d9dc'), (24, 1, '#eef0f2'), (25, 1, '#b8bdc2'),     # smoke, soft: no outline
                    (27, 1, '#b8bdc2'), (28, 1, '#d6d9dc'), (28, 0, '#eef0f2')):
        s.px(x, y, c)
    return s.image(shadow=(16, 29, 14))


def solar():
    """Solar panel, front-on: a tilted blue panel in a pale frame on two legs, the sky glinting top left."""
    s = Sprite()
    top, bot = 6, 20
    edges = {}
    for y in range(top, bot + 1):
        f = (y - top) / (bot - top)
        edges[y] = (round(8 - f * 5), round(24 + f * 5))                  # wider at the bottom: tilted towards us
    for y, (x0, x1) in edges.items():
        for x in range(x0, x1 + 1):
            s.px(x, y, '#1d3e78')
    for k in (1, 2, 3):                                                    # cell lines: 4 columns, 3 rows
        for y, (x0, x1) in edges.items():
            s.px(round(x0 + (x1 - x0) * k / 4), y, '#6f93cf')
    for y in (11, 16):
        x0, x1 = edges[y]
        s.rect(x0, y, x1 - x0 + 1, 1, '#6f93cf')
    for y, (x0, x1) in edges.items():                                      # pale frame
        s.px(x0, y, '#c9d3df'); s.px(x1, y, '#c9d3df')
    s.rect(edges[top][0], top, edges[top][1] - edges[top][0] + 1, 1, '#e3e9ef')
    s.rect(edges[bot][0], bot, edges[bot][1] - edges[bot][0] + 1, 1, '#9aa6b4')
    for x, y in ((9, 8), (10, 8), (11, 8), (8, 9), (9, 9), (13, 8)):       # glare, top left
        s.px(x, y, '#9fc0f0')
    s.rect(9, 21, 2, 5, 'n'); s.rect(21, 21, 2, 5, 'n')                   # legs and foot
    s.rect(7, 26, 18, 1, 'm')
    s.outline()
    return s.image(shadow=(16, 29, 13))


def drill():
    """Ice drill, front-on: a white machine house with a blue fuel tank, a steel derrick and a blue lamp on top."""
    s = Sprite()
    s.rect(3, 19, 26, 8, 'e'); s.rect(3, 19, 26, 1, '#f6f8f9'); s.rect(27, 19, 2, 8, 'E'); s.rect(3, 26, 26, 1, 'E')
    # round fuel tank in the housing, and a hazard panel
    s.rect(5, 21, 7, 4, 'B'); s.rect(6, 20, 5, 6, 'B'); s.rect(6, 21, 2, 2, '#bfe9fb'); s.rect(10, 21, 1, 4, '#3a9fd0')
    s.rect(20, 21, 5, 4, 'Y')
    for x in range(20, 25, 2):
        s.px(x, 24, 'k'); s.px(x + 1, 23, 'k')
    # steel derrick
    s.line(9, 18, 15, 4, 'M', 2)
    s.line(22, 18, 16, 4, 'm', 2)
    s.line(12, 12, 19, 12, 'm')
    s.rect(15, 4, 2, 21, 'n')                                              # drill string, down through the housing
    s.rect(14, 1, 4, 3, 'B'); s.rect(14, 1, 2, 1, '#bfe9fb')               # blue lamp
    # chips of ice it brought up
    for x, y in ((29, 25), (30, 26), (29, 26), (1, 26), (2, 25)):
        s.px(x, y, '#d8eef8')
    s.outline()
    return s.image(shadow=(16, 29, 14))


# ---------------------------------------------------------------- defence (seen from above, like the houses)

def rbox(x, y, w, h, deg):
    """A box in SVG units, turned `deg` degrees about the centre (as SVG's rotate())."""
    a = math.radians(deg)
    c, sn = math.cos(a), math.sin(a)
    return [(u * c - v * sn, u * sn + v * c) for u, v in box(x, y, w, h)]


def sandbags(s, n, R, r):
    """A ring of sandbags round a gun pit: tan bags, each lit on its upper left, dark seams between them."""
    s.blob_shadow(1.5, 3, 12, 10)
    ring(s, n, R, r, '#8f7a52')
    ring(s, n, R, r * 0.72, '#bfa674', -0.4, -0.5)
    for k in range(n):                                                     # seams where two bags meet
        a = (k + 0.5) / n * math.tau
        s.disc(math.cos(a) * R, math.sin(a) * R, 0.7, '#6e5c3a')


# Each defence is a fixed base and a top that turns to face what it shoots at. The top is drawn pointing right
# (0 degrees) about the sprite's centre; the game turns it. The whole sprite (base + top at its resting angle)
# is the build-menu icon.

def turret_base(s):
    sandbags(s, 10, 9, 3)
    s.disc(0, 0, 6.6, '#3a332a')                                           # the pit


def turret_gun(s, deg):
    for y in (-2.6, 0.8):                                                  # twin barrels, dark-edged
        s.poly(rbox(1, y - 0.7, 12.6, 3.2, deg), '#1d2126')
    for y in (-2.6, 0.8):
        s.poly(rbox(1, y, 12, 1.8, deg), '#7d858f')
    s.poly(rbox(-4.4, -4.4, 8.8, 8.8, deg), '#262b18')                     # gun body, dark-edged so it stands off the pit
    s.poly(rbox(-3.4, -3.4, 6.8, 6.8, deg), '#6f7a4a')
    s.poly(rbox(-3.4, -3.4, 6.8, 2.2, deg), '#9aa66a')                     # lit edge


def mortar_base(s):
    sandbags(s, 9, 8.6, 3.3)
    s.disc(0, 0, 6.4, '#4a4034')
    s.disc(0, 0, 4.2, '#6b6f74'); s.disc(-1, -1, 2.2, '#8d9398')          # mount, lit top left


def mortar_tube(s, deg):
    s.poly(rbox(-1, -2.2, 13, 4.4, deg), '#3a4049')
    s.poly(rbox(-1, -2.2, 13, 1.6, deg), '#59616b')                        # lit edge
    a = math.radians(deg)
    s.disc(math.cos(a) * 10.7, math.sin(a) * 10.7, 1.5, '#111417')        # its mouth


def airdef_base(s):
    s.shadow_poly(box(-10, -9, 24, 23))
    s.poly(box(-12, -12, 24, 24), '#5f6f78')
    s.poly(box(-12, -12, 24, 2), '#7d8d96'); s.poly(box(10, -12, 2, 24), '#4a5860')   # lit top edge, shaded right
    for x, y in ((-10.5, -10.5), (8.5, -10.5), (-10.5, 8.5), (8.5, 8.5)):  # corner bolts
        s.poly(box(x, y, 2, 2), '#3d4a52')
    s.disc(0, 0, 8.5, '#3d4a52'); s.disc(0, 0, 7, '#46545d')


def airdef_launcher(s, deg):
    for y in (-4, 1.6):                                                    # two missiles on the rail, red tips
        s.poly(rbox(-6.5, y, 15, 2.4, deg), '#dfe6ea')
        s.poly(rbox(8.5, y, 2.5, 2.4, deg), '#d64045')
    s.poly(rbox(-7.5, -4.2, 5, 8.4, deg), '#7c8a93')                       # launcher block


DEFENCE = {   # name: (base, top, resting angle, outline)
    'turret': (turret_base, turret_gun, -30, '#262b18'),
    'mortar': (mortar_base, mortar_tube, -52, '#1d2126'),
    'airdef': (airdef_base, airdef_launcher, -35, '#263238'),
}


def defence(name, part='whole'):
    base, top, rest, line = DEFENCE[name]
    s = Sprite()
    if part != 'top':
        base(s)
    if part != 'base':
        top(s, rest if part == 'whole' else 0)
    if part == 'top':
        s.sh = set()                                                       # the base casts the shadow
    s.outline(line)
    return s.image()


# ---------------------------------------------------------------- rocket and icons (no ground shadow)

def rocket():
    """Standing rocket, nose up: drawn on its pad and turned to its heading in flight."""
    s = Sprite()
    s.rect(13, 7, 6, 18, 'e'); s.rect(17, 7, 2, 18, 'E'); s.rect(13, 7, 1, 18, '#f6f8f9')
    for row in range(6):                                                   # red nose cone
        for x in range(13 + row // 2 + (row > 4), 19 - row // 2 - (row > 4)):
            s.px(x, 6 - row, 'x' if x < 17 else 'X')
    s.rect(13, 7, 6, 1, 'x'); s.rect(17, 7, 2, 1, 'X')
    s.rect(15, 11, 2, 2, 'B'); s.px(15, 11, '#bfe9fb')                     # porthole
    s.rect(13, 17, 6, 1, 'n')                                              # stage seam
    s.rect(10, 19, 3, 6, 'x'); s.rect(11, 18, 2, 1, 'x'); s.rect(19, 19, 3, 6, 'X'); s.rect(19, 18, 2, 1, 'X')   # fins
    s.rect(14, 25, 4, 2, 'n'); s.rect(13, 27, 6, 1, 'n'); s.px(14, 25, 'm')   # engine bell
    s.outline()
    s.sh = set()
    return s.image()


def person():
    """The people icon: a gold head and shoulders."""
    s = Sprite()
    s.disc(0, -6, 3.8, '#f2c14e')
    s.poly([(-7, 8), (-7, 3.5), (-5.5, 0.6), (-2.5, -0.6), (2.5, -0.6), (5.5, 0.6), (7, 3.5), (7, 8)], '#f2c14e')
    s.disc(-1.4, -7.2, 1.3, '#f7dd8a')                                     # light on the head and left shoulder
    s.poly([(-6, 7), (-6, 3.5), (-4.8, 1.4), (-2.5, 0.4), (-3.5, 2.5)], '#f7dd8a')
    s.poly([(5, 8), (5, 1), (7, 3.5), (7, 8)], '#c99a2e')                  # shade on the right
    s.outline('#5a4310')
    s.sh = set()
    return s.image()


def bolt():
    """The power icon: a gold lightning bolt."""
    s = Sprite()
    pts = [(2, -12), (-7.5, 2), (-1, 2), (-3, 12), (7.5, -3), (1, -3)]
    s.poly(pts, '#f2c14e')
    s.poly([(2, -12), (-7.5, 2), (-4.5, 2), (1.5, -7)], '#f7dd8a')        # lit left edge
    s.outline('#5a4310')
    s.sh = set()
    return s.image()


def fuel():
    """The rocket-fuel icon: a blue drop."""
    s = Sprite()
    s.disc(0, 4, 7.8, 'B')
    s.poly([(0, -12), (6.6, 0), (-6.6, 0)], 'B')
    s.poly([(0, -12), (6.6, 0), (7.8, 4), (5, 9.5), (2, 11.5), (3.5, 4)], '#3a9fd0')   # shade on the right
    s.disc(-3.5, 5, 1.4, '#d8f3ff'); s.disc(-2.8, 7.6, 1, '#d8f3ff')        # glint
    s.outline('#1d5a7a')
    s.sh = set()
    return s.image()


# ---------------------------------------------------------------- the map: trees, rocks, ore (seen from above)
# Same shapes and colours as the drawn versions in game.js (SHAPES), turned into pixels and given
# a leafy texture and an outline one shade darker than the object, so forests stay soft, not inky.

def ring(s, n, R, r, c, ox=0.0, oy=0.0, rot=0.0):
    for k in range(n):
        a = rot + k / n * math.tau
        s.disc(ox + math.cos(a) * R, oy + math.sin(a) * R, r, c)


def leaf_texture(s, shades, seed, p=0.16):
    """Swap scattered pixels to the next darker shade, so a canopy reads as leaves, not flat discs."""
    rnd = random.Random(seed)
    down = {shades[i]: shades[i - 1] for i in range(1, len(shades))}
    for y in range(N):
        for x in range(N):
            if s.g[y][x] in down and rnd.random() < p:
                s.g[y][x] = down[s.g[y][x]]


def broadleaf(dark, mid, light, hi, seed):
    s = Sprite()
    s.blob_shadow(2.5, 3.5, 10, 8)
    ring(s, 7, 6.2, 4.4, dark)
    s.disc(0, 0, 7, dark)
    ring(s, 6, 3.8, 3.6, mid, -0.8, -0.8, 0.4)
    ring(s, 4, 2.2, 2.6, light, -1.8, -1.8, 0.9)
    ring(s, 3, 1.2, 1.3, hi, -3, -3, 0.2)
    leaf_texture(s, [dark, mid, light, hi], seed)
    s.outline(darken(dark))
    return s.image()


def star_pts(n, R, r, rot=0.0):
    return [((r if k % 2 else R) * math.cos(rot + k / (2 * n) * math.tau),
             (r if k % 2 else R) * math.sin(rot + k / (2 * n) * math.tau)) for k in range(2 * n)]


def conifer():
    s = Sprite()
    shades = ['#1c4030', '#28573c', '#35704a', '#4d8f5f']
    s.blob_shadow(2.5, 3.5, 10, 8)
    s.poly(star_pts(9, 11, 6), shades[0])
    s.poly(star_pts(9, 8.2, 4.4, 0.35), shades[1])
    s.poly(star_pts(8, 5.4, 2.8, 0.7), shades[2])
    s.poly(star_pts(6, 2.8, 1.4, 0.2), shades[3])
    leaf_texture(s, shades, 7, 0.1)
    s.outline(darken(shades[0]))
    return s.image()


GREY = ['#7b8289', '#c2c8cd', '#9aa1a8', '#5f666d', '#878e95']
PALE = ['#8a8f8c', '#d2d5cf', '#a9ada8', '#6b706d', '#969a96']
RUST = ['#7a4a38', '#bd7b56', '#96604a', '#4f2f25', '#85523f']
DEEP = ['#6a3d33', '#a8654a', '#84503f', '#43261f', '#74463a']


def chunk(s, p, tx=0.0, ty=0.0, sc=1.0):
    """A faceted lump of rock: base, lit top, a left side, a dark right side and a middle face."""
    t = dict(tx=tx, ty=ty, s=sc)
    s.blob_shadow(1.5, 5.5, 10, 4.5, **t)
    s.poly([(-9, 3), (-7, -4), (-2, -8), (5, -7), (9, -1), (8, 5), (2, 8), (-5, 7)], p[0], **t)
    s.poly([(-7, -4), (-2, -8), (5, -7), (3, -2), (-3, -1)], p[1], **t)
    s.poly([(-9, 3), (-7, -4), (-3, -1), (-4, 4)], p[2], **t)
    s.poly([(3, -2), (5, -7), (9, -1), (8, 5), (4, 3)], p[3], **t)
    s.poly([(-3, -1), (3, -2), (4, 3), (-4, 4)], p[4], **t)


def fleck(s, x, y, size):
    """A glint of metal in the ore; always at least one pixel."""
    before = sum(row.count('#e3edf4') for row in s.g)
    s.poly([(x, y - size), (x + size * 0.6, y), (x, y + size), (x - size * 0.6, y)], '#e3edf4')
    if sum(row.count('#e3edf4') for row in s.g) == before:
        s.px(int((x + 15) * N / 30), int((y + 15) * N / 30), '#e3edf4')


def rocks(parts, outline, flecks=()):
    s = Sprite()
    for p, tx, ty, sc in parts:
        chunk(s, p, tx, ty, sc)
    for f in flecks:
        fleck(s, *f)
    s.outline(outline)
    return s.image()


def rockA(): return rocks([(GREY, 0, 0, 1)], '#3e4348')
def rockB(): return rocks([(PALE, -4, 1, 0.62), (GREY, 5, -3, 0.5), (GREY, 4, 6, 0.4)], '#3e4348')
def rockC(): return rocks([(GREY, -5, -3, 0.36), (PALE, 4, -5, 0.3), (PALE, 0, 3, 0.46), (GREY, 8, 4, 0.28), (GREY, -8, 5, 0.25)], '#3e4348')
def oreA(): return rocks([(RUST, 0, 0, 1)], '#2e1a14', [(-2, -4.5, 1.7), (4.5, -1, 1.3), (-5.5, 2, 1.1)])
def oreB(): return rocks([(DEEP, -4, 1, 0.62), (RUST, 5, -3, 0.5), (RUST, 4, 6, 0.4)], '#2e1a14', [(-5, -1, 1.3), (5, -4.5, 1.1), (4, 5.5, 0.9)])
def oreC(): return rocks([(RUST, -5, -3, 0.36), (DEEP, 4, -5, 0.3), (RUST, 0, 3, 0.46), (DEEP, 8, 4, 0.28), (RUST, -8, 5, 0.25)], '#2e1a14', [(0, 1.5, 1.1), (-5, -4, 0.8)])


# ---------------------------------------------------------------- houses round a settlement (roofs seen from above)

def box(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def shingles(s, colour, every=2):
    """Darken every other row of a roof colour, so the roof reads as tiles."""
    dark = darken(colour, 0.85)
    for y in range(0, N, every):
        for x in range(N):
            if s.g[y][x] == colour:
                s.g[y][x] = dark


def house():
    s = Sprite()
    s.shadow_poly(box(-7, -6, 18, 16))
    s.poly(box(-9, -8, 18, 8), '#de6d4c')
    s.poly(box(-9, 0, 18, 8), '#b04a31')
    shingles(s, '#de6d4c'); shingles(s, '#b04a31')
    s.poly(box(-9, -0.6, 18, 1.2), '#7d3220')                   # ridge
    s.poly(box(3, -6.5, 3.2, 4), '#4e3a33')                     # chimney
    s.outline('#6b2b1b')
    return s.image()


def house2():
    s = Sprite()
    s.shadow_poly(box(-9, -8, 24, 20))
    s.poly(box(-12, -10, 24, 10), '#7099c4')
    s.poly(box(-12, 0, 24, 10), '#4d6f96')
    shingles(s, '#7099c4'); shingles(s, '#4d6f96')
    s.poly(box(-12, -0.6, 24, 1.2), '#2c4260')
    s.poly(box(-8, -8, 3, 4), '#3a3f4a'); s.poly(box(5, -8, 3, 4), '#3a3f4a')   # dormer windows
    s.outline('#2c4260')
    return s.image()


def house3():
    s = Sprite()
    s.shadow_poly(box(-10, -9, 26, 25))
    s.poly(box(-13, -13, 26, 26), '#5f6b7d')
    for x, y, c in ((-11, -11, '#8fa3b8'), (1, -11, '#7c8fa4'), (-11, 1, '#7c8fa4'), (1, 1, '#8fa3b8')):
        s.poly(box(x, y, 10, 10), c)
        for wy in (2.2, 6.2):                                    # two rows of lit windows per wing
            s.poly(box(x + 2, y + wy, 6, 1.4), '#f2d98a')
    s.outline('#2b323d')
    return s.image()


def cabin():
    s = Sprite()
    s.shadow_poly(box(-9, -5, 22, 18))
    s.poly([(-12, -1), (0, -11), (12, -1)], '#7a4a2a')
    s.poly([(-12, -1), (0, -11), (0, -1)], '#94603a')             # lit left slope
    s.poly(box(-10, -1, 20, 12), '#a0683e')
    for y in (3, 7):
        s.poly(box(-10, y - 0.5, 20, 1), '#6e4426')               # log seams
    s.poly(box(-3, 3, 6, 8), '#3e2414')                          # door
    s.outline('#3e2414')
    s.line(*upx(7, -14), *upx(11, -6), '#3e2414')                 # crossed axes by the roof: dark handles,
    s.line(*upx(11, -14), *upx(7, -6), '#3e2414')
    for u in (7, 11):                                            # grey blades at the top
        x, y = upx(u, -14)
        s.rect(x - 1 if u == 7 else x, y, 2, 2, '#cfd5db')
    return s.image()


def upx(u, v):
    """SVG units to the pixel they fall in."""
    return int((u + 15) * N / 30), int((v + 15) * N / 30)


# ---------------------------------------------------------------- vehicles (all face right; the game turns them)

def truck():
    """Expedition truck, side view: a flatbed carrying the starter package (wood, stone, iron), blue cab."""
    s = Sprite()
    s.rect(3, 19, 18, 3, 'n'); s.rect(3, 19, 18, 1, 'm')               # flatbed
    s.rect(4, 13, 5, 6, '#a0683e'); s.rect(4, 13, 5, 1, '#c98a55'); s.rect(4, 15, 5, 1, '#6e4426')   # wood crate
    s.rect(10, 14, 5, 5, 'g'); s.rect(10, 14, 5, 1, 'G'); s.px(12, 16, 'G')                         # stone block
    s.rect(16, 15, 4, 4, 'f'); s.rect(16, 15, 4, 1, 'F'); s.px(17, 17, '#e3edf4')                 # iron
    s.rect(21, 12, 6, 10, '#2f7de1'); s.rect(27, 15, 2, 7, '#2f7de1')     # cab and bonnet
    s.rect(21, 12, 6, 1, '#6aa8f0'); s.rect(26, 12, 1, 10, '#1c4f99')
    s.rect(23, 13, 3, 3, '#cfe3ff')                                       # window
    s.px(28, 16, 'Y')                                                     # headlight
    for x in (6, 12, 24):                                                 # wheels
        s.rect(x - 1, 21, 4, 4, 'k'); s.rect(x, 22, 2, 2, 'g')
    s.outline()
    return s.image(shadow=(16, 26, 13))


def engine():
    """Locomotive seen from above, facing right: red body, dark roof vents, headlight at the nose."""
    s = Sprite()
    s.rect(2, 11, 26, 10, '#b8432f'); s.rect(2, 11, 26, 2, '#d9654a'); s.rect(2, 19, 26, 2, '#8a2f21')
    s.rect(6, 14, 12, 4, '#2f3540')                                       # roof vents
    for x in range(7, 18, 2):
        s.px(x, 15, '#59616a'); s.px(x, 16, '#59616a')
    s.rect(20, 13, 5, 6, '#cfe3ff'); s.rect(20, 13, 5, 1, '#eaf3ff')      # cab windows
    s.rect(28, 13, 2, 6, '#2f3540'); s.rect(29, 15, 1, 2, 'Y')            # nose and headlight
    s.outline()
    s.sh = set()
    return s.image()


def wagon():
    """Freight wagon seen from above: grey hopper heaped with a load of ore."""
    s = Sprite()
    s.rect(3, 11, 26, 10, '#59616a'); s.rect(3, 11, 26, 1, '#8d969e'); s.rect(3, 20, 26, 1, '#3d434a')
    s.rect(5, 13, 22, 6, '#2f3540')
    rnd = random.Random(3)
    for x in range(5, 27):                                                # the load: lumps of ore and stone
        for y in range(13, 19):
            s.px(x, y, rnd.choice(['f', 'F', 'f', 'g', '#96604a']))
    s.outline()
    s.sh = set()
    return s.image()


def ship():
    """Cargo ship for sea routes, side view facing right: red hull, stacked containers, white bridge at the stern."""
    s = Sprite()
    for i, y in enumerate(range(18, 24)):                                 # hull, tapering to the bow
        s.rect(2 + i // 2, y, 27 - i - i // 2, 1, '#b8432f' if y < 21 else '#2f3540')
    s.rect(2, 18, 27, 1, '#e8ecef')                                       # deck line
    s.rect(4, 10, 6, 8, 'e'); s.rect(8, 10, 2, 8, 'E')                    # bridge
    s.rect(5, 12, 3, 1, '#2f3540'); s.rect(5, 14, 3, 1, '#2f3540')
    s.rect(6, 7, 2, 3, 'n'); s.px(6, 6, 'x')                              # funnel
    for x, y, c in ((11, 14, '#2f7de1'), (16, 14, '#f2c14e'), (21, 14, '#7bd389'),
                    (11, 10, '#e07a54'), (16, 10, '#2f7de1')):            # containers
        s.rect(x, y, 5, 4, c); s.rect(x, y, 5, 1, lighten(c)); s.rect(x + 4, y, 1, 4, darken(c, 0.7))
    s.outline()
    return s.image(shadow=(16, 25, 14))


MAP = {
    'truck': truck, 'engine': engine, 'wagon': wagon, 'ship': ship,
    'house': house, 'house2': house2, 'house3': house3, 'cabin': cabin,
    'treeA': lambda: broadleaf('#2f5a2b', '#3f7a35', '#56963f', '#7bb85a', 1),
    'treeB': lambda: broadleaf('#264d2f', '#33663a', '#447c44', '#5c9652', 2),
    'treeD': lambda: broadleaf('#566f2a', '#718f33', '#90ad43', '#b6cc68', 4),
    'treeC': conifer,
    'tree': lambda: broadleaf('#2f5a2b', '#3f7a35', '#56963f', '#7bb85a', 1),   # icon (wood)
    'rockA': rockA, 'rockB': rockB, 'rockC': rockC, 'rock': rockA,              # rock = stone icon
    'oreA': oreA, 'oreB': oreB, 'oreC': oreC, 'ore': oreA,                      # ore = iron icon
}

SPRITES = {
    **MAP,
    'settle1': settle1, 'settle2': settle2, 'settle3': settle3, 'settle4': settle4,
    'settlement': settle2,             # build-menu icon
    'rig': rig, 'camp': camp, 'silo': silo, 'pad': pad,
    'station': station, 'port': port, 'burner': burner, 'solar': solar, 'drill': drill,
    'turret': lambda: defence('turret'), 'turretBase': lambda: defence('turret', 'base'), 'turretGun': lambda: defence('turret', 'top'),
    'mortar': lambda: defence('mortar'), 'mortarBase': lambda: defence('mortar', 'base'), 'mortarTube': lambda: defence('mortar', 'top'),
    'airdef': lambda: defence('airdef'), 'airdefBase': lambda: defence('airdef', 'base'), 'airdefTop': lambda: defence('airdef', 'top'),
    'rocket': rocket, 'person': person, 'bolt': bolt, 'fuel': fuel,
}


def main(args):
    preview = '--preview' in args
    names = [a for a in args if not a.startswith('--')] or list(SPRITES)
    OUT.mkdir(parents=True, exist_ok=True)
    if preview:
        PREVIEW.mkdir(parents=True, exist_ok=True)
    for name in names:
        img = SPRITES[name]()
        img.save(OUT / f'{name}.png')
        if preview:
            bg = Image.new('RGBA', (N, N), (140, 176, 110, 255))     # grass, to judge it in place
            bg.alpha_composite(img)
            bg.resize((N * 8, N * 8), Image.NEAREST).save(PREVIEW / f'{name}.png')
        print('wrote', name)


if __name__ == '__main__':
    main(sys.argv[1:])
