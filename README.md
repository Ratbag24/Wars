# Ashline Command

An original real-time strategy game for the browser: fixed-pad base building, a supply economy,
squad-based armies with infantry / vehicle / air counters, commander powers and a computer opponent.
Rendered in 3D. Units use public-domain (CC0) animated models by Quaternius and Kenney, with run, shoot, idle
and death animations; buildings are assembled from Kenney's Space Kit pieces with animated lights, dishes
and reactor cores added in code. No build step; three.js and its glTF loader
are vendored in `vendor/` (MIT licence). Model credits are in `assets/models/README.md`.

## Play

Open `index.html` in a desktop browser with WebGL (or serve the folder, e.g. `python3 -m http.server`), then pick a difficulty.

- **Goal:** destroy every enemy Citadel; you lose if all of yours fall.
- **Build:** click an empty pad around your Citadel. Depots give supplies, Reactors raise tech (max 3),
  Barracks / Foundry / Skyport train units, Turrets defend.
- **Expand:** move a unit next to an unclaimed site and found a new Citadel there (7 more pads).
- **Counters:** infantry beat aircraft, aircraft beat vehicles, vehicles beat infantry.

| Input | Action |
| --- | --- |
| Drag / click | Select units (double-click: all of that type on screen) |
| Right-click | Move, attack, or set a rally point |
| `A` then click | Attack-move |
| `S` | Stop |
| `F` / `V` | Select whole army / units on screen |
| `Ctrl+1-9`, `1-9` | Set / recall control groups |
| `Q W E R T Y` | Command-panel buttons |
| `Z` / `X` | Rail Strike / Nanite Mend |
| Arrows, screen edge, middle-drag, wheel | Camera pan and zoom |
| `Space` / `G` | Jump to base / last alert |
| `P` / `M` | Pause / mute |

## Code

- `js/core.js` – constants and unit, building and power data
- `js/world.js` – map generation, A* pathfinding, fog of war
- `js/sim.js` – units, combat, production, powers
- `js/ai.js` – computer opponent
- `js/models.js` – model loading, unit animation and kit-built buildings
- `assets/models/` – the CC0 unit models; `js/model-data.js` is generated from them by `node tools/pack-models.js`
- `js/render.js` – three.js renderer, effects, overlay and minimap
- `js/ui.js` – input, HUD and sound
- `js/main.js` – menu and main loop

Debug URL flags: `?autoplay=1` (AI plays both sides), `&nofog=1`, `&speed=8`, `&seed=42`.
