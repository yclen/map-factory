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

## Releasing

Before committing a change, run `python tools/stamp_galaxy.py`. It writes a new `version.txt` and puts the same `?v=` stamp on every file the
page loads. Otherwise browsers can keep running old scripts for up to 10 minutes after a push, which breaks new
buttons.
