# Map Factory

A Factorio-style growth game played entirely from a **map view**, in the spirit of openfront.io. Your territory is a border line that grows across a seeded **disk world floating in space**. People are the currency: the land you own, within reach of a settlement, sets how many you can have; you spend people to claim land, and the land you own produces the resources that build more settlements.

**▶ Play it in your browser:** https://yclen.github.io/map-factory/

**Your game autosaves in your browser** every 10 seconds; just open the link again to carry on. Press **N** in game for a fresh map.

Add `?seed=123` to the address to play a specific map (this starts that map, and its autosave replaces your current one), for example https://yclen.github.io/map-factory/?seed=42. Every seed gives a different world, a different Moon, and its own procedurally generated far planet.

![The core loop](art/core-loop.svg)

## What's in the prototype

- **A generated disk world:** 1000 × 1000 tiles of continents, islands, grassland, desert and snowy mountains, ringed by an ice wall, floating in a starfield.
- **The core loop:** people regrow toward the capacity of your land; click to push your border; deposits inside your territory produce wood, stone and iron; found settlements to house the land you've claimed.
- **Settlements:** the one housing building. Each houses what the land within 12 tiles can support and grows by itself from hamlet to city as your border moves out around it. A tile only counts once, for its nearest settlement, so spreading them out beats packing them in.
- **Countries:** every territory is a named country with its own people and stockpile. Right-click outside your border to send an expedition, drive it to a spot you like (a truck over land, a boat over water) and settle there to found a new one, then link your countries with **rail stations** (they lay their own track) or **ports** (ships sail the route) to move people and cargo between them. Linked countries share their output by population (at least a quarter each way), and the goods physically ride the trains and ships, so far colonies get their share late. Every country keeps a crew of 40 free people (100 on polar ice) to expand with, and trains and ships bring people from your bigger countries to any colony short of its crew. Countries merge when their borders touch, or when a **bridge** joins them: click your coast, then the land across the water, and it's built in stone, paid per tile of water with every tile costing more than the last (10 tiles: 125 stone, 30 tiles: 675, at most 50). Trucks drive over bridges and rail follows them, and a bridge to free land claims the tile it lands on, so you can push on from there. Names grow with the countries: *the Colony of Gorethus* → *Gorethus Harbor* → *the Free State of Gorethus* → … → *the United States of Gorethus*.
- **Population unlocks:** press **E** for the build menu (grouped by category; put any building on your 10-slot bar with hover + a number key); power, mining rigs, solar and missiles unlock as your empire grows.
- **AI nations that fight back:** nations in their own colours share the disk; they claim land, found settlements and arm themselves. Once your borders touch they may send waves of soldiers into your land, which you push back the same way. Their mortars and missile silos go for your buildings and expeditions; weapons destroy structures, and people are lost when a settlement falls. Push into their land to conquer it and take their settlements, or soften them up first with your own **mortars** (short range, quick, cheap) and **missile silos** (long range, slow, powered). Mortars and **gun turrets** fire by themselves (turrets cut down soldiers pushing into your land); you aim the silos. **Air defense** batteries shoot down shots aimed inside their circle.
- **Collectors:** deposits only produce once something works them: a logger's cabin or miner's camp (each employs 5 people and works the deposit tiles within 4 tiles of it) early on, powered mining rigs later. A tile goes to its nearest collector, so several on one deposit share it.
- **Energy:** every country has a power budget. Wood burners and solar panels make power; mining rigs and weapons use it first, and short on power they all slow down evenly. Whatever power is left over builds housing: every spare MW lets your settlements hold 10 more people, up to double what their land holds (that's how a City becomes a Metropolis). Cities draw power only for the people living in that extra housing, so burners burn more wood as they fill up. Power stays inside a territory.
- **Copy and paste:** drag a box over solar panels or burners, press **C** to paste the layout elsewhere.
- **A whole solar system:** the Moon (with phases), the Sun, lava world Vulcan, red planet Aries, gas giants Zeus and Poseidon with their moons, and a **seed world**: a planet generated entirely from the map seed.
- **Zoom from a single settlement out to the whole solar system**, and click any body to lock the camera onto it.

## Controls

| Input | Action |
|---|---|
| Click near your border | Expand toward that spot (into an AI nation: conquer it) |
| Right-click outside your border | Send an expedition from the country you're viewing, carrying people and supplies for a new colony: a truck, or a boat where your border or a port touches water |
| Arrow keys or WASD (while driving) | Steer the expedition · **Space** settle here · **Esc** let go of the wheel · **X** take it again |
| E | Build menu (everything, including what's still locked) |
| 1 – 9, 0 | Build whatever is on that slot of your build bar · Esc cancels |
| In the E menu: hover + 1 – 0 | Put that building on that key (right-click a building to add / remove it) |
| F, then click | Fire a missile from a silo in range (mortars and turrets fire by themselves) |
| Settlement tool, then hover | Shows the land a new settlement would add (green) and land already served (grey) |
| Point at a building | A ring glides onto it and a small card says what it's doing |
| Click one of your buildings | Open its card on the left with live stats (a settlement: level, people, housing from land and from power, MW used, growth) · Esc or × closes it |
| Click inside one of your countries | View that country in the top bar (zoomed out: fly the camera to it) |
| Tab · Shift+Tab | Fly to your next / previous country |
| Drag a box · C | Select solar panels or burners · paste a copy at the cursor |
| [ / ] | People sent per click (10 / 25 / 50 / 100 %) |
| Scroll · right-drag or WASD | Zoom · pan |
| M | Cycle views: whole disk → Moon orbit → solar system → back |
| Click a body, or L V R Z P G U | Lock onto the Moon, Vulcan, Aries, Zeus, Poseidon, the seed world, the Sun |
| H · N | Jump home · new random map (deletes your save) |

**On a phone or tablet:** tap to expand, drag to pan, pinch to zoom, and long-press outside your border to send an expedition (a long press also puts a picked building down). Building and firing take two taps: the first shows the preview, the second on the same spot builds or fires. A button row stands in for the keys (Build, Fire, Drive, Next country, Map, Home, Cancel), a steering pad with **Settle** and **Park** appears while you drive, and **New map** is in the Build menu. Box select and copy-paste are mouse-only.

## Map Conquest (a second game on the same world)

[`conquest/`](conquest/) is a separate, faster game on the same seeded disk and solar system: a territory-conquest game against 22 AI nations. Open `conquest/index.html`, or once pushed, https://yclen.github.io/map-factory/conquest/ (`?seed=42` works here too).

- **Spawn** anywhere on the disk with 25,000 troops. Troops, gold and combat follow OpenFront's published rules: the troop cap is 2 × (tiles^0.6 × 1,000 + 50,000) plus 250,000 per city, troops regrow fastest at about 42% full, and gold comes in at 1,000 a second.
- **Click land to attack it** with a share of your troops (20% by default). One click picks the way there: over your border on foot, by **boat** if a sea route exists, or by **rocket** if the land is on another world.
- **Attacks spread the way OpenFront's do:** tiles already hemmed in by your land fall first and rough ground last, so a front stays smooth. Free land is cheap; against a nation, losses and speed depend on how outnumbered the attack is and on the terrain. Land an attack cuts off falls at once, and a nation pushed under 100 tiles falls to its attacker, gold included.
- **Buildings:** city (+250,000 troop cap), port (gold), fort (attackers lose 5× the troops and move 3× slower within 30 tiles), and the **launch pad**.
- **Bombs:** a **missile silo** fires **atom bombs** (150k gold, about 22 tiles) and **hydrogen bombs** (1M gold, about 60 tiles) at targets on its own world. A blast razes land and buildings and kills the same share of the owner's troops. **Air defense** shoots at enemy bombs aimed within 70 tiles of it (90% against atom, 75% against hydrogen), then reloads for 7.5 seconds, so a salvo gets through.
- **Troop counts on the front:** each attack you are part of shows its remaining troops on the map, yours in white and attacks on you in red.
- **Mining rig:** strips the land within 9 tiles to bare rock and pays gold for the ore in it: nothing for grassland, some for rough ground, most for mountains. Other worlds are 2 to 4 times richer than the disk, so a rig on Vulcan's ridges can out-earn your whole base income. Mined rock stops counting toward your troop cap.
- **Launch pads** send rocket expeditions to other worlds. Range grows with distance from the Sun, so the next orbit out is always in reach and each world is a stepping stone, and flight time depends on where the planets are when you launch.
- **Every landable body is its own map:** the Moon, Vulcan, Aries, the moons of Zeus and Poseidon, and the seed world. The AI nations build pads and race you there.
- **Win** by holding 70% of all land in the system. Not in yet: saving, trade ships, diplomacy, retreating an attack.
- **On a phone:** tap land to attack, drag to pan, pinch to zoom; the button row has Worlds, Nations, Home, Zoom out and Pause. Pick a building or bomb, tap where it goes, and long-press to put it down.

All tuning numbers are in the `CFG` block at the top of [`conquest/game.js`](conquest/game.js).

## Repo layout

- [`prototype/`](prototype/): the game (plain HTML, CSS and JavaScript, no build step). All tuning numbers live in the `CFG` block at the top of [`prototype/game.js`](prototype/game.js).
- [`game-idea.md`](game-idea.md): the design document. Start with "How the game works now"; then the design direction, object catalogue, roadmap, and an archive of earlier versions.
- [`art/`](art/): concept art (SVG), generated by [`art/generate_art.py`](art/generate_art.py).

To run it locally, just open `prototype/index.html` in a browser. Add `?bot` to the address to watch a simple AI play (for playtesting).
