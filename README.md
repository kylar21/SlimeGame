# Slime Lounge

A tiny multiplayer lounge: everyone is a slime, moves around a square room and chats.
Node.js server (WebSocket) + one HTML file. No database, nothing is stored.

## Run it on your own computer (optional test)
1. Install Node.js 18 or newer from https://nodejs.org
2. In this folder run:  `npm install`  then  `npm start`
3. Open http://localhost:3000 in two browser tabs and you will see two slimes.

## Put it online for friends (Render, free tier)
1. Create a free account on https://github.com and upload this folder as a new repository.
2. Create a free account on https://render.com  ->  New  ->  Web Service  ->  connect the repository.
3. Settings: Runtime = Node, Build command = `npm install`, Start command = `npm start`.
4. (Optional) Environment tab: add `LOUNGE_PASSWORD` with a password of your choice.
   Friends must then type it when joining. Leave it out for an open lounge.
5. Deploy. Render gives you an https:// address. Send that link to your friends.

Notes
- Free Render services go to sleep after ~15 minutes without visitors, so the first person
  may wait ~30-60 seconds. A paid instance or Fly.io / Railway / a small VPS avoids that.
- HTTPS is handled by the host; the game automatically uses a secure WebSocket (wss).
- Keep one server instance running: players are kept in memory, so all friends must connect to the same one.
- Limits: 30 players, 120-character messages, 1 message per 0.4 seconds per player, power chest every 10 fireball hits, boss defeated at 30 hits.
- Opening `public/index.html` directly from disk (without the server) runs solo mode only.

## Hat chest
A treasure chest sits at the bottom of the room. Walk up to it and press **E**
(or tap the "Open chest" button on mobile) to get one free random hat. There
are 10 hats across 5 rarities — Common, Uncommon, Rare, Epic and the glowing
**Legendary Golden Crown**, the rarest of all.

Each visitor can only claim one hat, ever. This is tied to a random ID the
game stores in the browser's local storage the first time it loads, so the
same hat comes back even after refreshing or reconnecting — but clearing
site data, or opening the game in a different browser, counts as a new
visitor. Like the rest of the game, hat assignments live only in the running
server's memory and reset if the server restarts.

## Throwing fire
Press **F** to throw a fireball in the direction you're currently facing, or
double-tap (or quickly click twice near the same spot) to aim and throw at
that point. There's a 2-second cooldown between throws, enforced by the
server too so one player can't flood everyone else with fire.

Land two hits on the same player and they "die" — teleported back to the
center of the room with an "i died" message on their screen (and a note in
the chat log for everyone else). A row of chips above the room shows every
connected player's name and how many hits their fireballs have landed; it
resets to zero once the room is completely empty, but survives players
coming and going while others stay.

Anyone wearing the Dragon Head hat throws a fireball twice the size (and
with a bigger hit radius to match).

## Power-up chest
A second, glowing purple chest sits on the left side of the room. Walk up
to it and press **E** (or tap "Open power chest") to grab a random,
temporary attack power-up:

- **Speedy Flames** — fireballs fly almost twice as fast (10s)
- **Big Blast** — fireballs are noticeably bigger, with a matching bigger
  hit radius (10s)
- **Triple Shot** — every throw fires three fireballs in a spread instead
  of one (5s)
- **Bouncy Flames** — fireballs bounce off the walls instead of vanishing,
  and last much longer (10s)
- **Rapid Fire** — throw far more often, cooldown cut to about a third
  (10s)
- **Piercing Flames** — a fireball keeps flying after a hit and can strike
  several different players in its path (8s)
- **Speed Boost** — move noticeably faster (10s)

Only one power-up is active at a time; opening the chest again while one
is running replaces it. The power chest can't just be farmed, though: it
only unlocks once your fireball-hit count (shown on the leaderboard chips)
reaches a new multiple of 10 — 10, then 20, then 30, and so on. Standing
near the chest before you've reached the next milestone shows how many
more hits you need. Like the hat chest and the leaderboard, this progress
lives only in the running server's memory and resets when the room goes
completely empty.

## The boss chamber
A glowing doorway on the right wall of the lounge leads into a second
room: a dim chamber guarded by a big red slime.

- The boss fires a spreading volley of fireballs every couple of seconds
  at whoever's inside. Get hit twice and you're knocked straight back to
  the lounge.
- Your own thrown fireballs (hats, power-ups and all) work on the boss
  too. Land 30 hits and it's defeated — its health bar is shown at the
  top of the screen while you're in the room. A defeated boss stops
  firing and stays down as long as someone's still in the chamber; once
  the room is completely empty again, both its health and the fight
  reset for the next group.
- Behind the boss sits a chest with a magical sword. Walk up to it (or up
  to whoever's currently holding it) to take hold of it yourself — it
  can change hands any time someone else gets close enough, in the
  boss chamber or back in the lounge.

Walk back through the doorway on the boss chamber's left wall to return
to the lounge at any time.

## Files
- `server.js`        game server (players, positions, chat, optional password)
- `public/index.html` the game client (served at `/`)
- `package.json`     dependencies (`ws`)
