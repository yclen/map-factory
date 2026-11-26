# Towns and cities: how settlements look

A settlement is a collection of buildings, and its level shows in what those buildings are. The first version is
in the Galaxy demo: zoom into any settlement on Home (Quaix, Home's capital, is a Megalopolis).

## The idea: cities grow in rings

Every settlement level adds a newer kind of building, and that newer kind goes in the middle. The older kinds stay,
pushed out into rings around it. So you can read a city's level from its skyline, and every city still looks like
it grew out of a village:

| Level | Radius (tiles) | Newest building (tier) | What you see |
|---|---|---|---|
| Village | 5 | cottage (0) | a handful of thatched cottages along a dirt track or two |
| Town | 7 | house (1) | two-storey red-roof houses in the middle, cottages round the edge |
| City | 10 | townhouse (2) | brick townhouses on cobbled streets laid out in blocks |
| Metropolis | 13 | apartment (3) | apartment blocks on paved lots, asphalt streets |
| Megacity | 16 | office (4) | a cluster of glass office towers with plazas between |
| Megalopolis | 20 | skyscraper (5) | a skyline of spire-topped skyscrapers |

## The buildings: one civilisation, six tiers

Six building sheets, 4 variants each, all in one style (`art/style/towns.md`): warm, hand-built materials early on
(stone, timber, thatch, clay tile), keeping a little of that warmth as they modernise (brick, warm concrete,
bronze-tinted glass), so a skyscraper downtown still sits naturally beside cottages on the outskirts.

| Tier | Kind | Size (a tree = 1) |
|---|---|---|
| 0 | thatched or shingled cottage | 0.9 |
| 1 | two-storey house, red clay tile roof | 0.98 |
| 2 | three-storey brick townhouse with a shop front | 1.04 |
| 3 | six to eight storey apartment block | 1.15 |
| 4 | fifteen-storey glass office tower | 1.4 |
| 5 | supertall skyscraper with a spire | 1.7 |

## The layout

All of it is worked out from the planet seed (`terrain.js` `townLayout`), the same in every chunk and at every zoom.

- **Lots.** Buildings stand on 2 x 2 tile lots. Near the middle most lots are built on (`fill`); toward the edge
  fewer, and the edge itself is ragged.
- **Rings.** A lot's tier is the settlement's level, falling off with the square of the distance from the middle,
  give or take one: a big core of the newest buildings, and thinner rings of older ones outside it.
- **Arms, not a cross.** Each town runs a straight street out to every road that leaves it, then adds a few arms of
  its own at random angles (villages 1-3 in all, the biggest cities 4-6), which wander off into the country and peter
  out. From City up, a grid of cross streets (set off by a random amount) cuts the town into blocks of 3 or 4 lots, and
  the arms cut across it like boulevards.
- **Houses line the streets.** In villages and towns a lot away from any street is seldom built on, and every house
  gets a small yard where no trees grow.
- **Plazas.** Towers stand a little apart: some of the lots between offices and skyscrapers are left as paved
  plazas (`gap`), so the downtown isn't a solid wall.
- **Old buildings sit loose.** Cottages and houses stand slightly out of line; from townhouses up, everything is
  square on the street.
- **Ground.** Lots go from trodden earth to paving; downtown (apartments up) is paved all over, with pavements along
  the streets. Trees and rocks never grow on a road, a lot or a yard.
- **Far away** each town is a patch of colour on the planet map (grey for a city, brown for a village), with its
  roads; further out, its pin and name.

The numbers are in `galaxy-demo/js/rules.js` (`settlements.radius` and `towns`).

## Roads

Neighbouring settlements that can reach each other over land are joined by a winding road (`terrain.js`
`roadNetwork`, worked out once per planet):

- **Which towns.** The relative neighbourhood graph: a and b are joined unless some third town is nearer to both.
  That gives a natural network with no long parallel roads, every town linked to its real neighbours.
- **The route.** A path search on a coarse grid (16 tiles on Home) that never crosses water or lava, climbs
  mountains only when it must, goes round other towns, and is cheaper along roads already built, so later roads join
  earlier ones. Noise in the cost makes it wander. No path over land, no road.
- **The shape.** The route is smoothed (corner cutting) and given a gentle two-scale meander (never into water,
  straight where it meets a town), then laid on the tiles. Each road tile remembers where the curve crosses it to a
  quarter tile, and the shader joins those points, so roads curve smoothly instead of stepping.
- **Quality.** A road is as good as its poorer end: between villages a dirt track, towns gravel, cities cobbles,
  metropolises asphalt with a kerb, megacities and up a highway with white edge lines and a dashed yellow centre line.
  Town streets follow the tier of the buildings beside them, so a city's streets get rougher toward its edge.

| Tier | Road | Half-width (tiles) |
|---|---|---|
| 0 | dirt track: wheel ruts, grass down the middle | 0.24 |
| 1 | gravel | 0.28 |
| 2 | cobbles | 0.32 |
| 3 | asphalt with a kerb | 0.36 |
| 4-5 | highway: edge lines, dashed centre line (in town: asphalt with a kerb) | 0.40-0.44 |

Roads are drawn per screen pixel (`shaders.js` `roadAt` and `roadCol`, only near a road), so their edges and
surfaces stay sharp at any zoom. The surfaces are seamless AI textures, one copy per 3 x 3 tiles: dirt, gravel,
cobbles, asphalt, and paving slabs for downtown lots, plazas and pavements. Ruts, worn edges, kerbs and lane lines
are drawn on top by the shader.

```powershell
# a new surface (then move it from art/ground/raw/ to art/roads/raw/, so the Biome Builder doesn't list it)
python tools/gen_ground.py roadcobbles "an old cobblestone street ..." --note "covers only 3 x 3 metres ..."
# pack all five into galaxy-demo/props/roads.webp (made seamless, 512 px each)
python tools/pack_roads.py
```
From far away they show in the planet map as thin lines that fade out before they'd look too thick.

## Making the art

```powershell
# every tier that has no sheet yet (about 2 minutes, 3 at a time)
python tools/gen_towns.py
# redo one tier: a new _v2 sheet, the old one kept
python tools/gen_towns.py cottage --note "show more of the roof from above"
# cut the sheets into the demo's atlas (galaxy-demo/props/towns.webp + towns.json), with a preview
python tools/pack_towns.py --preview
```

`art/towns/towns.json` says which sheet and which 4 of its 6 cells each tier uses (the packer fills in the newest
sheet and cells 0-3 the first time). Raw sheets are kept in `art/towns/raw/`.

## Next

- **Night lights.** Lit windows on the night side, brighter in bigger cities.
- **Regional styles.** Desert towns in adobe, tundra towns with snowy roofs, using the biome under the town.
- **Bridges and ferries.** Roads stop at water for now; short bridges over rivers and ferry lines across straits.
- **Farms and outskirts.** Fields, barns and orchards around villages and towns.
- **Landmarks.** One special building per city (a town hall, cathedral, stadium) at the centre plaza.
- **Growth.** When a settlement levels up in the game, its rings grow outward and new tiers appear in the middle.
- **Shore and slopes.** Docks where a town touches the sea; terraced houses on hills.
- **The lower tiers' camera.** Cottages, houses and townhouses came out closer to a straight front view than
  apartments and towers; regenerate them with a note to show more of the roof from above if it bothers.
