# MESBG Tabletop

An unofficial virtual tabletop for the **Middle-earth Strategy Battle Game** that runs in any web browser, on a computer or a phone. You don't need an account, and nothing to install: start a game, send your opponent the link, and play.

Build your army in the [MESBG List Builder](https://v2024.mesbg-list-builder.com/), export it, and drop it onto the table.

> Unofficial fan project. Not affiliated with or endorsed by Games Workshop or Middle-earth Enterprises. No official artwork or rules text is included; you need your own rules to play.

## What it does

- **Real-scale board.** The board is 48"×48" by default (or 72"×48" / 24"×24"), with a 1" grid. Bases are real sizes: 25mm infantry, 25×50mm cavalry, and 40mm/60mm monsters.
- **Two players in real time** over a room link, plus spectators. Moves, dice and phases sync instantly, and you reconnect automatically if the connection drops.
- **Built-in list builder.** Pick an army (all 106 army lists), add heroes and warriors, choose wargear and mounts, and see points as you go. Lists are saved in your browser. The data comes from the open-source [MESBG List Builder](https://github.com/mhollink/mesbg-list-builder-v2024) (see [src/data/README.md](src/data/README.md)).
- **Unit photos and stat cards.** Models show their unit's photo on the base, and selecting a model shows its profile: Mv, Fv, Sv, S, D, A, W, C, I, wargear and special rule names. Mounted heroes get a cavalry base and their mount's move. Photos load from the list builder's image host and can be turned off in the Table panel.
- **List import.** Upload the list builder's .json export (read exactly, with options and mounts), or paste a plain list like `12x Warrior of Minas Tirith`. Each army deploys in its own zone (player 1 at the bottom, player 2 at the top), so armies never spawn on top of each other.
- **Measuring the MESBG way**, base edge to base edge:
  - **Ruler tool:** shows base-to-base distance when you start or end on a model.
  - **Move and control zones:** a selected model shows its move distance and its 1" control zone.
  - **Drag feedback:** while you drag, it shows distance moved against the model's Move, and turns red if you go over.
- **Dice rolled on the server**, so nobody can fudge them. The shared log shows who rolled what, and counts successes against a target (e.g. 4+).
- **Turn tracker.** It shows the turn number and phase (Priority, Move, Shoot, Fight, End), plus who has priority and a priority roll.
- **Model cards.** Each model tracks wounds, Might/Will/Fate for heroes, facing and base size. A casualty pile and a Broken check (half or more of the army lost) are built in.
- **Terrain and starter boards.** Four original starter boards (River Crossing, Ruined City, Woodland Edge, Mountain Pass), laid out like tournament tables: each half mirrors the other so both sides deploy facing the same terrain, about a quarter to a third of the table is covered, and something in the middle blocks line of sight. One button places five Domination-style objective markers. Terrain is drawn with natural outlines and shadows on textured ground (grassland, plains, forest floor, mud, flagstones, snow, sand), and you can add, resize, rotate and lock woods, rocks, hills, buildings, ruins, walls, water, rivers, cliffs, fields and objectives.
- **Matched play scenarios.** Pick any of the 24 matched play scenarios (six pools of four) or roll for one with server dice. The app draws each side's deployment zone, places the fixed objective markers, summarises the special rules and how the game ends, and keeps a shared victory points tally with a VP score in the top bar. The summaries are our own shorthand; the Matched Play Guide has the full rules.
- **Rules quick reference.** The 📖 Rules tab rolls to wound from Strength and Defence (including 6+/4+ results, where the server rolls the second die), to hit, In the Way, Courage and Intelligence tests, and the Jump, Leap, Climb, Swim and Thrown Rider tables, and shows the result. It can fill in stats from the selected model, and has the wound chart, missile weapons, turn sequence and heroic actions in short form.
- **Your look.** The ⚙ Look menu has six colour themes (Classic, The Shire, Gondor, Rohan, Rivendell, Mordor) and Middle-earth style fonts, and lets you toggle photos, zones and the grid. These only change your own screen.
- **Save and load** a game as a file.

### Controls

| | Mouse | Touch |
|---|---|---|
| Move a model | drag it | drag it |
| Select several | Select tool + drag a box, or shift-click | Select tool, then tap or drag a box |
| Pan | drag empty table | drag empty table |
| Zoom | scroll wheel | pinch |
| Turn models | Q / E, or the Turn buttons | Turn buttons |
| Fit board | F | ⤢ button |

## Running it

Requires Node 22+.

```bash
npm install
npm run dev        # app on http://localhost:5173, sync server on :8787
npm test           # unit tests
npm run build && npm start   # production: one server on :8787 serves the app and sync
```

Games are kept in memory and saved to `data/rooms/` (set `DATA_DIR` to change it).

### Hosting

The production server is a single Node process: it serves the built app, the WebSocket sync at `/ws` and a health check at `/healthz`. Any host that supports WebSockets will run it:

- **Render (free):** create a new Blueprint from this repo; `render.yaml` does the rest. On the free plan the server sleeps when idle (the first visit takes about a minute to wake it) and saved games reset on redeploy.
- **Docker:** `docker build -t mesbg-tabletop . && docker run -p 8787:8787 -v mesbg-data:/data mesbg-tabletop`

## How it's built

- `src/shared/`: game state, the reducer that applies every action, measuring geometry, and list import. Both server and browser use this code.
- `server/`: a small Node HTTP and WebSocket server. It is authoritative: it validates every action, rolls the dice, and broadcasts results to everyone in the room.
- `src/client/`: the React app. The board is an SVG drawn in inches, with pointer events for mouse and touch.

## Credits

- Unit data: [MESBG List Builder](https://github.com/mhollink/mesbg-list-builder-v2024) (AGPL-3.0); see [src/data/README.md](src/data/README.md).
- Fonts (SIL Open Font License, via Fontsource): Cinzel, Uncial Antiqua, MedievalSharp, Almendra, IM Fell English, Alegreya, EB Garamond.
- Ground and terrain textures: from [0 A.D.](https://play0ad.com/) by [Wildfire Games](https://www.wildfiregames.com/), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); see [src/client/tex/README.md](src/client/tex/README.md). Water is generated by the app.

## Licence

[AGPL-3.0-or-later](LICENSE), the same licence as the MESBG List Builder.
