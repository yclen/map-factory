# Towns and cities: how settlements look

A settlement is a collection of buildings, and its level shows in what those buildings are. The first version is
in the Galaxy demo: zoom into any settlement on Home (Quaix, Home's capital, is a Megalopolis).

## The idea: cities grow in rings

Every settlement level adds a newer kind of building, and that newer kind goes in the middle. The older kinds stay,
pushed out into rings around it. So you can read a city's level from its skyline, and every city still looks like
it grew out of a village:

| Level | Radius (tiles) | Newest building (tier) | What you see |
|---|---|---|---|
| Village | 5 | cottage (0) | a handful of thatched cottages at a dirt crossroads |
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
- **Streets.** Two main roads cross at the centre and run out into the country (1.3 to 2.3 radii). From City up, a
  grid of cross streets cuts the town into blocks of 3 or 4 lots.
- **Plazas.** Towers stand a little apart: some of the lots between offices and skyscrapers are left as paved
  plazas (`gap`), so the downtown isn't a solid wall.
- **Old buildings sit loose.** Cottages and houses stand slightly out of line; from townhouses up, everything is
  square on the street.
- **Ground.** Streets go from dirt tracks to grey cobbles to asphalt, following the tier of the buildings beside
  them; lots from trodden earth to paving. Trees and rocks never grow on a street or a lot.
- **Far away** each town is a patch of colour on the planet map (grey for a city, brown for a village), with its
  roads; further out, its pin and name.

The numbers are in `galaxy-demo/js/rules.js` (`settlements.radius` and `towns`).

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
- **Roads between cities.** Main roads that actually run to the nearest neighbours.
- **Farms and outskirts.** Fields, barns and orchards around villages and towns.
- **Landmarks.** One special building per city (a town hall, cathedral, stadium) at the centre plaza.
- **Growth.** When a settlement levels up in the game, its rings grow outward and new tiers appear in the middle.
- **Shore and slopes.** Docks where a town touches the sea; terraced houses on hills.
- **The lower tiers' camera.** Cottages, houses and townhouses came out closer to a straight front view than
  apartments and towers; regenerate them with a note to show more of the roof from above if it bothers.
