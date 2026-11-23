# Pixel-art sprites

Any object in the game can wear a pixel-art skin in place of its drawn shape.

1. Draw a square PNG with a transparent background. 32×32 is a good size; 16×16 and 48×48 also work.
2. Save it here, named after the object, for example `settle1.png`.
3. Add the name to `sprites.json`, for example `["boat", "settle1"]`.
4. Reload the game. Your art replaces the shape on the map, in the build bar and in the build menu.

To go back to the drawn shape, take the name out of `sprites.json`.

Every PNG here except `boat.png` is drawn by `tools/pixel_sprites.py`, one short function per sprite.
Run `python tools/pixel_sprites.py --preview` to redraw them all, or name some (`... rig silo`) to redraw only those.
Running it overwrites those PNGs, so if you hand-paint one, take its name out of the script's `SPRITES` list first.

## Tips

- Leave a margin of about 3 pixels on each side of a 32×32 image (10%). The drawn shapes leave the same gap, so your art comes out the same size.
- Light comes from the top left. Put the bright side on the upper left and the shadow on the lower right, as the drawn shapes do.
- Stick to one palette for everything (pick one at lospec.com/palette-list) so all the objects look like one game.
- Pixels stay hard-edged when the game scales them up, so you don't need to draw large versions.
- If a name in `sprites.json` doesn't match an object, or its PNG is missing, the game keeps the drawn shape and logs a warning in the browser console (F12).

## Names

| Group | Names |
|---|---|
| Settlements (by level) | `settle1` `settle2` `settle3` `settle4` `settlement` (build-menu icon) |
| Houses round a settlement | `house` `house2` `house3` |
| Buildings | `station` `port` `burner` `rig` `solar` `cabin` `camp` `drill` `pad` `silo` |
| Defence | `turret` `airdef` `mortar` (build-menu icons) |
| Defence on the map: a fixed base and a top that turns to aim (drawn pointing right) | `turretBase` `turretGun` `mortarBase` `mortarTube` `airdefBase` `airdefTop` |
| Vehicles | `boat` `truck` `ship` `engine` `wagon` `rocket` |
| Trees | `treeA` `treeB` `treeC` `treeD` `tree` (icon) |
| Stone | `rockA` `rockB` `rockC` `rock` (icon) |
| Iron ore | `oreA` `oreB` `oreC` `ore` (icon) |
| Icons | `person` `bolt` `fuel` |

Trees, stone and ore are drawn thousands of times on screen, so a skin for those changes the look of the whole map.
