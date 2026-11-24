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
  - Every rocky planet and moon is a flat, non-rotating disk of tiles, like Home in Factory Conquest.
    Its tile map is generated in background workers when you get close.
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
| `js/rules.js` | **All generation rules**: star types and mix, planet counts, orbits, planet types per zone, moons, resources, settlements, the Sun's planets |
| `js/skin.js` | How every tile, deposit and building looks (colours and pixel patterns); swap it to reskin everything |
| `js/terrain.js` | How each planet type turns noise into biomes and deposits |
| `js/galaxy.js` | Galaxy shape and system layout (uses the rules) |
| `js/main.js` | Camera, zoom levels, input, map cache, stats panel |
| `js/renderer.js`, `js/shaders.js` | WebGL2 drawing |

The **Stats** button shows frame time, how long each part of the frame takes, draw calls, maps in memory and GPU
memory. The **Walkers** button adds 1k–50k animated people to the planet you're on, to stress-test.
