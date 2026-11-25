# Galaxy demo

A test bed for the infinite-zoom world: a 1,000-star spiral galaxy you can zoom through, from the whole galaxy
to the tiles of a planet. Nothing is simulated yet: no items, no economy. The point is to get world generation right
and to prove it stays smooth on desktop and phones.

Run locally with any static server from the repo root, for example `python -m http.server 8160 --directory galaxy-demo`,
then open http://localhost:8160. Add `?seed=123` for a different galaxy.

## What's in it

- **Galaxy:** 1,000 stars on 4 spiral arms with a dense core. Red dwarfs are most common, especially in the core;
  blue giants cluster in the arms.
- **Systems:**
  - Red dwarfs have 1–3 rocky planets.
  - Yellow stars have 5–10, about 8 on average.
  - Blue giants have 16–24 planets, with more giants and moons.
  - What forms where depends on how much starlight a planet gets: lava worlds close in, terran and ocean worlds
    in the temperate band, gas and ice giants past the frost line.
- **The Sun:** Vulcan, Home (with the Moon), Aries, Zeus (Hephaestus, Athena, Hermes) and Poseidon (Amphitrite,
  Triton), as in Factory Conquest. The outermost planet's name and type come from the seed.
- **Surfaces:**
  - Every rocky planet and moon is a flat, non-rotating disk of tiles, like Home in Factory Conquest
    (Home is 4096 tiles across).
  - Maps are built as a pyramid of 256 x 256 chunks in background workers. A small whole-planet map is
    always ready; sharper chunks are built only for the part on screen, at the detail the zoom needs, and
    unused chunks are dropped to stay within a memory budget.
  - Biomes come from elevation, moisture and temperature. The centre is warmest and the rim coldest, so cold
    worlds end in an ice ring.
  - Resource deposits form round patches.
  - Settlements appear on Home and on worlds a civilisation has settled.
- **Zoom:**
  - Each thing switches from a dot to a sphere to tile art based on how big it is on screen.
  - Stars are tiny next to the gaps between them: zooming out, a system shrinks to one bright star long
    before any other star comes into view.
  - Star names only show when you hover over or select a star, or once its system is open.
  - Zooming toward a body locks onto it. Dragging pans across it.

## Where to change things

| File | What it controls |
|---|---|
| `js/rules.js` | **All generation rules**: the distance ladder (`scale`), star types and mix, planet counts, orbits, planet types per zone, moons, resources, settlements, the Sun's planets |
| `js/skin.js` | How every tile, deposit and building looks (colours and pixel patterns); swap it to reskin everything |
| `js/terrain.js` | How each planet type turns noise into biomes and deposits |
| `js/galaxy.js` | Galaxy shape and system layout (uses the rules) |
| `js/main.js` | Camera, zoom levels, input, map cache, stats panel, rocket pad and readout |
| `js/rocket.js` | Rocket physics: gravity, thrust, fuel, drag, landing and the predicted path |
| `js/renderer.js`, `js/shaders.js` | WebGL2 drawing |

## Rocket demo

**Rocket** in the bottom bar takes you to a launch pad at Home's North Pole.

- **Controls:** Space starts or stops the engine, Q/E lower or raise the throttle, and A/D turn. R brings the
  camera back to your rocket, Tab switches between rockets, and F makes the camera follow the rocket. Hover over
  the pad or a rocket to see what it is, and click it to take control.
- **Physics** (`js/rocket.js`):
  - gravity from Home and the Moon;
  - fuel that burns with throttle, so the rocket gets lighter;
  - air drag that fades to nothing at the top of the atmosphere (the outer edge of Home's hazy glow);
  - gentle, upright touchdowns land, and anything else crashes.
- **Orbit path:** the dashed line is where the rocket will coast with the engine off: one exact orbit around Home,
  with its highest and lowest points and their heights marked. Near the Moon, where its pull matters, the path is
  simulated instead, for about one lap.
- **Rebuilds:** a new rocket is built on the pad 10 s after each launch.
- **Tuning:** all the numbers are in `rules.js` under `rocket`. With the defaults, a low orbit takes about 100 s and
  reaching it uses roughly 40% of the fuel.

## The distance ladder

Every size and distance hangs off four numbers in `rules.js` (`scale`), each measured in the one before it:

1. **Home size**: tiles across Home (4096). Every planet's map is sized relative to Home.
2. **Home → Moon**: in Home radii (17). Every moon orbit scales with it.
3. **Home → Sun**: in Home–Moon distances (28). Every planet orbit scales with it.
4. **Sun → nearest star**: in Home–Sun distances (1,000). This sets how small systems are next to the gaps
   between stars.

The **Scale** button opens sliders for all four, applied live and saved in your browser. **Reset** goes back to
the values in `rules.js`.

The **Stats** button shows frame time, how long each part of the frame takes, draw calls, maps in memory and GPU
memory. The **Walkers** button adds 1k–50k animated people to the planet you're on, to stress-test.

## Terrain look

The **Terrain** button (or **T**) switches between the new planet-surface look and the old flat one, to compare.
The new look adds these, all drawn in the planet shader (`BODY_FS` in `shaders.js`):

- **Hill shading:** each map chunk carries a small field map (`fld`, built in `terrain.js` next to the tile ids)
  with the ground's slope. Slopes are lit from the top left, so mountains and hills look raised, from orbit and
  close up. Relief is exaggerated more when zoomed out and less on small planets.
- **Water:** smooth depth colours from the shore to open sea, a surf line along every coast, slow swells and
  glinting pixels. Lava pulses.
- **Natural borders:** each pixel's ground lookup is nudged by a little noise, so biome edges and coastlines curve
  instead of following the tile grid. Deposits and buildings stay exactly on their tiles, and the game's tile
  grid doesn't change.
- **Colour variation:** slow patches inside one biome, a little drier and lighter or lusher and darker.
- **Trees and boulders:** big sprites, 16 x 24 art pixels (about 2 x 3 tiles), each with its own shadow cast
  down and to the right. Trees come in species: oaks (an occasional one in autumn colours), birches, blossom
  trees, pines and firs (snow-capped in the cold), palms, huge jungle trees with vines, willows, acacias, dead
  trees and saguaro cacti. Boulders are chiselled rocks with a flat lit top and shaded facets: plain, mossy, sandy,
  red, snow-capped, dark, sulfur and ice, plus clusters of basalt columns. Every leaf cluster, pine tier and rock
  facet is lit from the top left. Each one is a little lighter or darker than its neighbours. Which ones grow
  where, and how densely, is set per ground type in `skin.js` (`props`, `propsFor`). Forest, jungle and
  pine-forest tiles switch to plain forest floor under them.
- **Scattered decorations:** smaller bits between them: bushes, flowers, grass tufts, pebbles, rocks, small cacti,
  bones, shells, reeds, ice chunks and spires, each with a small shadow (`decor`, `decorFor`). Nothing is placed on
  water, ore or buildings. Trees, boulders and decorations only appear at close zoom, where the pixel art shows,
  and none of them move.
- **Ore fields:** each deposit tile knows how rich it is (0 at a patch's edge, rising toward the middle), and
  draws 1 to 4 levels of ore lumps to match. The soil under a patch is stained (rusty for iron, orange for copper,
  black for coal, green for uranium...), so patches show from mid zoom and from orbit. Metal ores and crystals
  glint, and uranium glows. Colours, stains, glint and glow are set per deposit in `skin.js` (`over`).
- **Mountains and cliffs:** high ground gets sharp ridgelines in its shading. The land's height is cut into steps,
  and where a step drops toward the viewer a rock wall about two tiles tall is drawn: a lip of the ground above
  hanging over it, three courses of rock blocks (each lit on its top and left, creased dark on its right and
  bottom), a jagged foot, and a shadow with fallen stones below it. Cliffs
  form on mountains, peaks, mesas, highlands and canyons, and in scattered bands elsewhere, never on water or
  settlements. They are visual only and don't block anything yet.

Tile ids are now 4 bytes per tile (ground, overlay, richness, cliff mask), and the field map adds 4 more on the GPU.
Chunk building takes about 20–35% longer in the background workers. On a desktop GPU, a full-screen close-up costs
about 1.3–1.8× the old look's draw time before trees and boulders were added. They add more on top of that, most
in dense forest. Surf, cliffs, trees and decorations are worked out once per screen pixel. The shader skips its extra work wherever the look is switched off.

## Releasing

Before committing a change, run `python tools/stamp_galaxy.py`. It writes a new `version.txt` and puts the same `?v=` stamp on every file the
page loads. Otherwise browsers can keep running old scripts for up to 10 minutes after a push, which breaks new
buttons.
