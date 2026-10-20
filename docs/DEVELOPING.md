# Developing and hosting

## Running it locally

Requires Node 22+.

```bash
npm install
npm run dev        # app on http://localhost:5173, sync server on :8787
npm test           # unit tests
npm run build && npm start   # production: one server on :8787 serves the app and sync
```

Games are kept in memory and saved to `data/rooms/` (set `DATA_DIR` to change it).

## Hosting

The production server is a single Node process: it serves the built app, the WebSocket sync at `/ws` and a health check at `/healthz`. Any host that supports WebSockets will run it:

- **Render (free):** create a new Blueprint from this repo; `render.yaml` does the rest. On the free plan the server sleeps when idle (the first visit takes about a minute to wake it) and saved games reset on redeploy.
- **Discord (optional):** set `DISCORD_WEBHOOK_URL` on the server (in Render: the service's Environment page) to post newly opened public games to a Discord channel. Add the same URL as a repository secret named `DISCORD_WEBHOOK_URL` to post each update merged into main. Keep the URL out of the code: anyone who has it can post to your channel. Set `DISCORD_BOT_TOKEN` too, for a bot in the server with Manage Channels, and each game two players start gets its own voice channel under the server's Battlefields category (or `DISCORD_VOICE_CATEGORY_ID`), with its invite posted alongside new games. With the bot token set, the webhook is optional: the bot posts in the server's #find-a-game channel (or `DISCORD_GAMES_CHANNEL_ID`). The channel comes down five minutes after the game ends, or once both players have been away for fifteen minutes. The token is secret: it only ever goes in the server's environment.
- **Accounts (optional):** players can sign in with Discord to get a profile with their name and record. Make a free [Supabase](https://supabase.com) project, switch on its Discord provider, run [`supabase/schema.sql`](supabase/schema.sql) once in its SQL Editor, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the server (both are public). `SUPABASE_SERVICE_ROLE_KEY` is secret and only ever goes in the server's environment; the server uses it to check who is in each seat and to record results both players agreed on, which feed the leaderboard. Without these the site works as before, with no sign-in button.
- **Docker:** `docker build -t mesbg-tabletop . && docker run -p 8787:8787 -v mesbg-data:/data mesbg-tabletop`

## How it's built

- `src/shared/`: game state, the reducer that applies every action, measuring geometry, and list import. Both server and browser use this code.
- `server/`: a small Node HTTP and WebSocket server. It is authoritative: it validates every action, rolls the dice, and broadcasts results to everyone in the room.
- `src/client/`: the React app. The board is an SVG drawn in inches, with pointer events for mouse and touch.


## Controls

| | Mouse | Touch |
|---|---|---|
| Move a model | drag it | drag it |
| Select several | Select tool + drag a box, or shift-click | Select tool, then tap or drag a box |
| Pan | drag empty table | drag empty table |
| Zoom | scroll wheel | pinch |
| Turn models | Q / E, or the Turn buttons | Turn buttons |
| Fit board | F | ⤢ button |
| Turn the table view | R / Shift+R, ⟲ ⟳ buttons, or Shift + scroll wheel to turn freely | ⟲ ⟳ buttons, or twist two fingers |
