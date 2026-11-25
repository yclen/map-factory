# AI art pipeline

The goal: every visible thing in the game gets high-detail art made with AI image generation, and all of it looks
like it belongs to one world. That covers the ground of each biome, the soft edges where biomes meet, the trees,
shrubs and rocks placed on the map, and later the things that move (units, items on belts).

Images are made by **Codex's built-in image tool**, which runs on the ChatGPT subscription (no API key, no
per-image cost). The scripts call Codex for you; you never open it yourself.

Right now the pipeline covers **big props** (trees, boulders) in the Galaxy demo, and **ground textures** in the
Biome Lab. Ground in the game itself, small decorations and moving things are planned, see [Roadmap](#roadmap).

---

## Biome Lab: try the art before it goes in the game

`biome-lab/` is a small Earth-like planet for designing biomes: a lake in the middle and biome regions around it,
drawn by **the game's own renderer** (the Galaxy demo's WebGL terrain shader, with maps built in background workers
in 256 x 256 chunks), so what you see is what the game shows. Zoomed out it's a ball in space; zoom in to the
tiles, trees and rocks. Open it locally with the **biome-lab** preview server (port 8170, serves the repo root) at
http://localhost:8170/biome-lab/, or on GitHub Pages at `/map-factory/biome-lab/`.

- **It reads the raw art directly.** Every sheet in `art/props/raw/` and texture in `art/ground/raw/` shows up on
  the next reload: the lab cuts the sheets out and builds the prop atlas in the browser, no packing needed.
- **World tab:** seed, planet size (128 to 512 tiles across), lake size, beach, number of biome regions, how
  irregular they are, hills, and which biomes appear.
- **Biome tab** (click the planet to pick a biome): its ground texture with scale, brightness, saturation and hue;
  prop density and clumping into groves; which prop kinds grow there (the game has 4 slots per biome), which sheet
  version each kind uses, which cells of the sheet are picked, and each kind's size. Also small decorations.
- **Art tab:** every ground texture (shown 2 x 2 so seams show) and every prop sheet, plus **Still needed**: the
  ground and props the planet still draws in pixel art, each with a ready-to-run generate command.
- **Toolbar:** Paint biomes onto the planet, Props / Decor on and off, Size ref (a 3 x 3 machine footprint under the
  cursor, to judge how big trees look), Fit.
- **Speed:** the status line shows frames per second. Like the Galaxy demo, the lab lowers its render resolution
  when frames are slow and raises it again when there's room. `biomeLab.planet.bench()` in the browser console
  times the current view.
- Defaults come from the game (`skin.js` `propsFor` / `decorFor`, `art/props/props.json`), and the lab keeps only
  your changes, in the browser. **Export** turns them into `skin.js` lines and `props.json` entries; ground textures
  and clumping work in the game's shader already (see below) but nothing in the game turns them on yet, so hand
  that part of the export to Claude.
- A kind's **Size** goes from 0.25 to 20 (1 = the 2 x 3 tile box the art is packed into). Past about 3x the art
  gets soft when zoomed in, since the sheets have ~300-500 px per tree.
- Before pushing new art, run `python tools/lab_catalog.py` (GitHub Pages can't list folders, so the lab reads
  `biome-lab/catalog.json` there) and `python tools/stamp_galaxy.py` (fresh copies of every script).

How the lab plugs into the game's code:
- `galaxy-demo/js/terrain.js` has a `lab` planet type (`labSampler`): lake, beach, regions and painted tiles from
  the planet description, which the lab sends to the map workers.
- `galaxy-demo/js/shaders.js` can draw a **ground texture** per ground type instead of its tile art (`u_gtex`,
  sampled at every screen pixel so it keeps full detail) and **clump** props into groves (`u_biome.w`). Both are
  off unless something sets them, so the Galaxy demo looks the same as before.
- `biome-lab/planet.js` is the demo's chunk and drawing code for one planet (from `main.js`): keep them in step.

### Make a ground texture

```powershell
python tools/gen_ground.py grass "short green meadow grass with a little clover" --biome forest
```

It lands in `art/ground/raw/<name>_vN.png` (a square, about 8 x 8 tiles of ground). Same options as `gen_props.py`.
The lab makes the edges seamless itself, and pairs ground names with biomes by `GROUND_FOR` in `biome-lab/lab.js`
(grass for grassland and forest, sand for desert and beach, snow for snowfields, ...). Any texture can be tried on
any biome from the Biome tab.

---

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
| `biome-lab/` | the Biome Lab sandbox (see above); `tools/lab_catalog.py` writes its `catalog.json` |

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
only, with no objects and no shadows. **Started:** `gen_ground.py` makes the textures and the Biome Lab already
makes them seamless (the same offset-and-blend, in `biome-lab/assets.js`) and blends biomes along soft borders;
the game's shader is next.

### Soft biome borders
Drawing a transition picture for every pair of biomes doesn't scale (30 biomes = hundreds of pairs). The shader
already has wiggly borders between biomes (`g_warp`); with textures it can blend the two textures along a noisy
edge instead, so every pair of biomes gets a natural border with no extra art.

### Small decorations
Grass tufts, pebbles, flowers, fallen branches: the same as props but small and plentiful (the `decor` layer in
`skin.js`). Best made as one kit sheet per biome, so they match each other and the ground.

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
