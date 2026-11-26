# AI art pipeline

The goal: every visible thing in the game gets high-detail art made with AI image generation, and all of it looks
like it belongs to one world. That covers the ground of each biome, the soft edges where biomes meet, the trees,
shrubs and rocks placed on the map, and later the things that move (units, items on belts).

Images are made by **Codex's built-in image tool**, which runs on the ChatGPT subscription (no API key, no
per-image cost). The scripts call Codex for you; you never open it yourself.

Every biome now has AI art for its **ground**, its **big items** (trees, boulders) and its **small items** (grass
tufts, flowers, shrubs, pebbles, shells...), and the Galaxy demo draws all of it through the Biome Builder's bake. Soft
biome borders, colour matching and moving things are next, see [Roadmap](#roadmap).

---

## Biome Builder: design each biome, save it, and the game uses it

`biome-builder/` (it used to be the Biome Lab; `biome-lab/` now redirects here) is a solar system drawn by the game's
own renderer, laid out by the Galaxy demo's rules for a blue giant (`RULES.stars.blue`: first orbit, then each orbit
1.13-1.22x the last; the **Orbits** slider shrinks the distances, 1 = the rules' own). The innermost planet is the
**mix planet**: an ocean in the middle and the land cut like a pizza, one slice per biome. Further out, one planet per
biome, hottest nearest the star, each one that biome all round an ocean. Planets are 512-4096 tiles across (the mix
planet twice the others). Pick a biome (click its planet, or its slice on the mix planet), design it, press **Save**,
and the Galaxy demo generates that biome from your design wherever it appears.

**Run it with saving on:** double-click **Biome Builder** on the desktop. It runs `tools/launch_builder.pyw`, which
starts the save server in the background (no window) and opens http://localhost:8170/biome-builder/ (the next free port
if 8170 is busy). Save is then one click. The server stops by itself 15 minutes after the last Builder page closes; its
log is `%TEMP%/biome-builder-server.log`. To make the shortcut again: `python tools/launch_builder.pyw --shortcut`.
By hand: `python tools/builder_server.py` (or the **biome-builder** preview, the same server on port 8171).
On GitHub Pages (`/map-factory/biome-builder/`) you can look and try things, but Save only works through the desktop
icon. Unsaved changes are kept per address, so changes made online don't show up in the desktop version.

**A biome design** (galaxy-demo/js/biomes.js has the exact format):
- **Ground:** a texture from `art/ground/raw/` (or the old tile art), its scale, brightness, saturation, hue and
  **relief** (0-2, 0.8 by default): the texture's light parts stand up as bumps and its dark parts sink, lit by the
  same sun as the hills, so flat AI textures look raised and cracked without new art.
- **Borders** (Biome tab, saved as `ground.blend`): how the ground meets its neighbours. Textured grounds blend into
  each other in the shader instead of switching on a hard line: **width** of the mixing band (tiles), **creep** (who
  pushes into whom), **softness**, **style** (soft = mixed by the textures' bumps, pixel = a ragged pixel-art edge,
  dither = stippled), **ragged** (noise along the line), **rim** (the band darkened or lightened), **bump height** (how
  much the texture's light parts poke through the neighbour) and **item straggle** (how far its trees, rocks and grass
  wander into the neighbour, in tiles). **Pair test** turns the mix planet into just this biome and one other, three
  slices each. **Fuzz** (System tab, shared by every planet) makes borders wander in ragged lines with little islands
  where the map is made. In the game, **B** switches between blended and the old hard borders.
- **Variety** (Ground, per biome, 0-1): hides the texture's repeat by mixing 8 shifted copies of it across the ground,
  picked by a slow noise (0 = it simply repeats). **Relief** is baked into each mip level when the textures load,
  so it costs nothing per pixel.
- **Wet shore** and **Wet width** (System tab, shared): the ground along every shore is darker and deeper in colour
  for a few tiles inland, with a ragged edge, as if the waves just washed over it (not on snow and ice).
- **Shadows** (shared by every biome, System tab; kept in `art/biomes/index.json`): each item casts its own outline
  flat along the ground, the way Factorio does, so no separate shadow pictures are needed, plus a soft **contact
  shadow** on the ground right under it so it sits on the ground. Both start from the picture's **base** (the part
  touching the ground, measured from the art when the atlas is built: a tree's trunk, most of a boulder's width), so
  the cast shadow grows out from under the item instead of starting beside it. Length (per unit of the item's
  height), angle below the horizontal (12 by default, mostly sideways like Factorio's), darkness and contact.
- **Items:** up to 8 **big** ones (trees, boulders; one spot per 1.5 x 1.5 tiles) and 8 **small** ones (shrubs,
  grass tufts, flowers, pebbles; one spot per tile, drawn under the big ones). Each has a **density** (share of spots
  it fills), **size** (1 = a 2 x 3 tile box, up to 20x), **size spread**, **clumping** and clump size, and its
  **skins** (which AI sheet and which of its variations), tucked away under "Skins". Items without AI art use the
  game's pixel art until a sheet is made.

**The tabs:**
- **System:** which biome planets are shown, planet size, hills; each biome shows **saved**, **unsaved changes** or
  nothing (the game's current look). **Update the game** re-bakes without changing any design (after new AI art).
- **Biome:** the selected planet's design. Changes show on the planet at once and are kept in the browser until you
  **Save**. **Revert to saved** throws changes away; **Use game defaults** deletes the saved design.
- **Art:** every ground texture and item sheet, plus **Still needed**: what the shown planets still draw in pixel
  art, each with a ready-to-run generate command.

**What Save writes:**
- `art/biomes/<GROUND>.json`: the design (one file per saved biome; `index.json` lists them). This is the source.
- `galaxy-demo/biomes/`: what the game loads. `biomes.json` (every biome's design: yours where saved, the game's
  defaults elsewhere), `items.webp` (all item pictures) and `ground_N.webp` (the ground textures, already seamless
  and colour-adjusted). Commit and push both folders to ship a design.

Biomes nobody has saved keep the look from `galaxy-demo/js/skin.js` (`propsFor`, `decorFor`). If
`galaxy-demo/biomes/` is missing, the Galaxy demo falls back to its old in-shader props.

**How it runs:** items are pictures, one per spot (`PROPS_VS` in `shaders.js`). The map workers list every spot per
chunk (`propSpots` in `terrain.js`), and the GPU picks what grows there from the item table, so slider changes show
instantly. Items fade in once tiles are about 7 px across; further out a biome is just the map's colour.
`biomeBuilder.sys.bench()` in the browser console times the current view.

How the Builder plugs into the game's code:
- `galaxy-demo/js/terrain.js` has a `lab` planet type: `lab.mono` makes a single-biome planet and `lab.slices` the
  mix planet, both round an ocean in the middle (`lab.lake`).
- `galaxy-demo/js/biomes.js` turns designs into the table the prop shader reads; `renderer.js` `setItems` and
  `setGroundTextures` load them; `main.js` loads `galaxy-demo/biomes/` at startup.
- `biome-builder/system.js` is the demo's chunk and drawing code for a set of planets (from `main.js`): keep them in step.

### Make lots of art at once: the wishlist

```powershell
python tools/gen_batch.py                 # everything in art/wishlist.json that has no art yet, 3 at a time
python tools/gen_batch.py tuft pebbles    # just these
```

`art/wishlist.json` lists every piece of art the game needs, each with its prompt and biome theme: `small` and `big`
items (via `gen_props.py`) and `ground` textures (via `gen_ground.py`). Anything whose `_v1` already exists is
skipped, so add new entries and run it again. To redo one, run its `gen_props.py` / `gen_ground.py` line directly
(that makes a `_v2`). When the ChatGPT plan's usage limit is hit, the batch stops and prints when to try again
(roughly 30 images fit in one window).

### Make a ground texture

```powershell
python tools/gen_ground.py grass "short green meadow grass with a little clover" --biome forest
```

It lands in `art/ground/raw/<name>_vN.png` (a square, about 8 x 8 tiles of ground). Same options as `gen_props.py`.
The Builder makes the edges seamless itself, and pairs ground names with biomes by `GROUND_FOR` in `biome-builder/builder.js`
(grass for grassland and forest, sand for desert and beach, snow for snowfields, ...). Any texture can be tried on
any biome from the Biome tab.

---

### Make a small item

```powershell
python tools/gen_props.py tuft "tufts of wild meadow grass" --small --biome forest
```

`--small` asks for small ground-level things drawn large in each cell, and leaves `props.json` alone (that lists the
big props the demo packs). The Builder uses the newest sheet named after the item, and its starting size comes from
`ITEM_IDEAS` in `biome-builder/builder.js`. A small item named like a big one uses sheets called `<kind>-small` (the small
`deadtree` is a dead shrub, from `deadtree-small_v1.png`).

### How the Builder loads the art

The raw sheets are 2-4 MB each, so `tools/builder_catalog.py` makes small copies the Builder loads instead: sheets at 60%
with the background already cut out (`art/props/web/`, WebP) and ground textures at 512 x 512 (`art/ground/web/`),
about 5 MB for everything. `builder_server.py` runs it on start; run it yourself before pushing new art (it also writes
`biome-builder/catalog.json` for GitHub Pages). Anything without a copy loads from the raw file.

**Sharp big items:** trees start at size 3.5 (a 7 x 10.5 tile box) and sparse, so big items (trees, boulders) get their
own atlas at 20-24 texels per art px instead of 8, from full-size copies of their sheets (`art/props/hd/`, about 6 MB,
also made by `builder_catalog.py` for the kinds in `art/props/props.json`). They load after the loading screen, so
the Builder starts with the small copies and sharpens a few seconds later. The bake has it as `items_big.webp`, which
the Galaxy demo also loads after starting up.

**Far-away colour:** once items aren't drawn (zoomed out), a biome shows one colour: its ground texture's average
mixed with its items' average colours, by how much of the ground they cover. So a dense forest shows its tree
colour and a desert with a few rocks stays sandy.

## Make a prop, start to finish

```powershell
# 1. generate a sheet of 6 variations (about 1 minute)
python tools/gen_props.py acacia "flat-topped acacia trees with thin forked trunks" --biome savanna

# 2. look at the raw sheet it saved: art/props/raw/acacia_v1.png
#    not right? run step 1 again with a --note; it saves acacia_v2.png and leaves v1 alone

# 3. pack every sheet into the game's prop atlas, with a preview to check
python tools/pack_props.py --preview
#    preview: tools/previews/props_preview.png (each sprite on a ground colour, red cross = its foot)

# 4. try it locally (the "galaxy" preview server, port 8160), then release
python tools/stamp_galaxy.py
git add art galaxy-demo tools ; git commit ; git push
```

`<kind>` (here `acacia`) must be a big-prop name from `galaxy-demo/js/skin.js` (`props:`). The AI art replaces
that prop everywhere it grows; every kind without AI art keeps its pixel art. `skin.js` (`propsFor:`) decides
which props grow in which biome and how densely.

Useful options for `gen_props.py`:

| Option | What it does |
|---|---|
| `--biome savanna` | adds that biome's theme (palette, mood) to the prompt and attaches its reference images |
| `--ref <image>` | attaches an extra image to match in style (repeatable) |
| `--note "..."` | one-off extra instruction, e.g. "a bit greener" or "show more trunk" |
| `--size 0.6` | the prop fills 60% of the prop space (small things like boulders and shrubs) |
| `--dry-run` | prints the full prompt and the images it would attach, without calling Codex |

To pick other cells from a sheet, edit `art/props/props.json`: `"pick": [0, 2, 3, 5]` uses cells 1, 3, 4 and 6
(reading left to right, top to bottom). To go back to an older sheet, point `"sheet"` at it.

---

## Files

| Path | What it is |
|---|---|
| `art/style/style.md` | **the style bible**: camera, light and rendering rules sent with every prompt |
| `art/style/biomes/<biome>.md` | a biome's theme (palette, mood, materials, shapes) and its reference images |
| `art/style/biomes/_template.md` | copy this to start a new biome |
| `art/props/raw/` | every sheet Codex made, kept forever (`<kind>_v1.png`, `_v2`, ...) |
| `art/props/props.json` | which sheet each prop kind uses, and how to cut it |
| `tools/gen_props.py` | builds the prompt and asks Codex for a sheet |
| `tools/pack_props.py` | cuts sheets out and packs `galaxy-demo/props/props_hd.png` + `.json` |
| `galaxy-demo/props/` | the packed atlas the game loads (generated: don't edit by hand) |
| `art/ground/raw/` | every ground texture Codex made (`<name>_v1.png`, ...) |
| `tools/gen_ground.py` | asks Codex for a seamless ground texture |
| `art/wishlist.json` | every item and ground the game needs, with prompts; `tools/gen_batch.py` makes what's missing |
| `art/props/web/`, `art/ground/web/` | small copies the Biome Builder loads (generated by `tools/builder_catalog.py`) |
| `art/props/hd/` | full-size copies of the big items' sheets, for their sharp atlas (also `builder_catalog.py`) |
| `biome-builder/` | the Biome Builder sandbox (see above); `tools/builder_catalog.py` writes its `catalog.json` |
| `art/towns.md` | **towns and cities**: the plan (rings of building tiers, lots, streets) and how to make their art |
| `art/style/towns.md` | the towns theme sent with every building prompt |
| `art/towns/raw/`, `art/towns/towns.json` | every building sheet Codex made, and which cells each tier uses |
| `tools/gen_towns.py`, `tools/pack_towns.py` | make the six building sheets; pack them into `galaxy-demo/props/towns.webp` + `.json` |

How the game uses it: each prop kind gets 4 variants, each 16 x 24 art pixels (2 x 3 tiles) at 8 texels per art
pixel, standing on its foot point (bottom middle). They're drawn as **pictures**, one quad per prop (`PROPS_VS` in
`shaders.js`): the map workers list every spot a prop could stand on per chunk, and the GPU decides from the skin's
tables whether one grows there and which kind, so density and kinds can change live. Props are drawn front to back,
and each one's outline falls as a soft shadow down and to the right, onto one shadow layer (overlaps don't darken
twice). Any size works: `Renderer.setPropScale` sets a size per kind.

---

## Prompting: what we've learned

- **Camera angle is the hardest part.** Straight down makes trees look like round bushes; eye level shows the whole
  trunk like a catalogue photo. The style bible asks for a 45 degree three-quarter view with a short piece of trunk
  showing, which works. If a sheet drifts, attach both a too-high and a too-low example and ask for the middle.
- **Magenta background, not transparent.** Asking for transparency left a pale glow and light patches between
  branches. Flat `#FF00FF` cuts out cleanly, and the packer removes the pink fringe.
- **No shadows in the art.** The game draws its own, so every object's shadow matches the sun.
- **One sheet, many variations.** 6 objects in one image come out in the same style, scale and light, far more
  consistent than 6 separate images.
- **Reference images beat words.** Attaching an approved sheet keeps colour and detail level consistent better than
  any description.
- **Codex:** the scripts use the Codex desktop app's own CLI (`%LOCALAPPDATA%\OpenAI\Codex\bin\...\codex.exe`).
  The older one in `~/.codex/.sandbox-bin` is out of date and fails.

---

## Keeping a biome consistent

Everything in a biome (ground, trees, shrubs, rocks, decorations) has to look like one place. Four layers keep it
together, from broad to specific:

1. **Style bible** (`style.md`): the same for the whole game. Camera, sun, rendering. Change it rarely, because every
   existing asset was made with it.
2. **Biome theme** (`biomes/<biome>.md`): palette with hex codes, mood and climate, materials, shapes, and what to
   avoid. Written once per biome, before making any of its art.
3. **Anchor image**: the first asset made for the biome that looks right (usually its most typical tree). Add it to
   the theme file as `ref:` and it is attached to every later prompt for that biome, so everything else is matched
   against it.
4. **Kit sheets**: where possible, generate related things together in one image (for example the biome's shrub,
   rock and grass tuft side by side), since things drawn in the same image always match.

Suggested order for a new biome:

1. Copy `_template.md` to `<biome>.md`; fill in palette, mood, materials, shapes, and the list of members.
2. Make the anchor (`gen_props.py <tree> "..." --biome <biome>`), iterate until it's right, add it as `ref:`.
3. Make the rest of the biome's props with `--biome <biome>`.
4. Review everything together on the biome's ground colour (the packer preview), and regenerate whatever stands out.

Across biomes, the style bible and sun keep things related; the palettes keep them distinct. Neighbouring biomes
(savanna next to desert, forest next to grassland) can share a colour or two so their borders blend naturally.

---

## Roadmap

### Ground textures (one or two per biome)
Instead of a separate picture per tile (which shows a grid), each biome gets a **seamless texture** covering many
tiles (for example 512 x 512 px = 8 x 8 tiles), which the shader samples by world position, with a second variant
mixed in through noise so it never visibly repeats. AI images aren't seamless by default, so a packer step
(`pack_ground.py`) will make them tileable (offset-and-blend). Prompts ask for a straight-down view of the surface
only, with no objects and no shadows. **Done for every biome:** 21 textures (`gen_ground.py`), made seamless by the
Biome Builder (offset-and-blend in `biome-builder/assets.js`) and drawn by the game's shader through the bake. Next: a second
variant per biome mixed in through noise, so large areas never repeat visibly.

### Soft biome borders
Drawing a transition picture for every pair of biomes doesn't scale (30 biomes = hundreds of pairs). The shader
already has wiggly borders between biomes (`g_warp`); with textures it can blend the two textures along a noisy
edge instead, so every pair of biomes gets a natural border with no extra art.

### Small decorations: done
Grass tufts, flowers, shrubs, reeds, cacti, bones, shells, driftwood, pebbles and small rocks in several colours, ice
chunks, volcanic spires and sulfur stones all have AI sheets (`--small`). Next: more kinds per biome (ferns,
mushrooms, fallen branches, termite mounds) and second versions for variety.

### Edge fringe
Some sheets keep a thin pink edge where the image model blended magenta into dark leaves (visible on the oak when
zoomed right in). `cut_out` in `pack_props.py` (and `keyOut` in the Builder) could treat reddish pixels next to the
background as background.

### Things that move (units, vehicles, items on belts)
These need several facing directions (4 or 8) and animation frames, all matching exactly, which is the hardest
thing for image AI. Options to try when we get there: one sheet with a fixed grid of directions per object, or
generating a 3D model and rendering it from the game camera (what Factorio does), which gives perfect consistency.

### Colour matching
An automatic step in the packer that nudges each sheet's colours toward its biome palette, to fix small drift
between images without regenerating.

---

## Limits

- Each image takes about a minute. The ChatGPT plan has usage limits, so make sheets in small batches.
- The atlas grows by 2 prop kinds per 192 px row (a 1024 px wide image). The shader has room for 32 prop kinds,
  which at 3072 px tall stays within phones' 4096 px texture limit.
- Props are drawn once tiles are about 7 px across (the same point where the tile art appears); further out, a
  forest is just the map's colour.
