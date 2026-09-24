"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.LOUNGE_PASSWORD || "";   // leave empty for an open lounge
const MAX_PLAYERS = 30;
const B = { x0: 40, x1: 440, y0: 62, y1: 446 };       // must match the client's room bounds
const CHEST = { x: 240, y: 414, r: 40 };              // must match the client's chest position
const POWER_CHEST = { x: 90, y: 240, r: 40 };         // must match the client's power-chest position
const CENTER = { x: 240, y: 240 };                    // must match the client's canvas center
const FIRE_COOLDOWN_MS = 1900;                        // server-side backstop; client enforces 2000ms
const FIRE_HIT_WINDOW_MS = 1300;                      // fallback hit-report window (see fireHitWindowMs)
const FIRE_SPEED = 260;                               // must match the client's FIRE_SPEED (for spread math)

// Attack power-ups granted by the power chest. Exactly one is active per player at a time
// and they always replace whatever was active before. Durations are in ms.
const POWERUPS = [
  { id: "speedy", name: "Speedy Flames",   desc: "Fireballs fly almost twice as fast.",             durationMs: 10000 },
  { id: "big",    name: "Big Blast",       desc: "Fireballs are noticeably bigger.",                durationMs: 10000 },
  { id: "triple", name: "Triple Shot",     desc: "Every throw fires three fireballs in a spread.",  durationMs: 5000 },
  { id: "bouncy", name: "Bouncy Flames",   desc: "Fireballs bounce off the walls and last longer.", durationMs: 10000 },
  { id: "rapid",  name: "Rapid Fire",      desc: "Throw much more often.",                          durationMs: 10000 },
  { id: "pierce", name: "Piercing Flames", desc: "Fireballs punch through everyone in their path.", durationMs: 8000 },
  { id: "haste",  name: "Speed Boost",     desc: "You move noticeably faster.",                     durationMs: 10000 }
];
function activePowerupId(p) {
  return p.powerup && p.powerup.expiresAt > Date.now() ? p.powerup.id : null;
}

// ---------- rooms ----------
// Two rooms. A doorway on the lounge's right wall leads to the boss room; a doorway on
// the boss room's left wall leads back. The boss room is a bigger arena than the lounge.
const BOSS_BOUNDS = { x0: 40, x1: 680, y0: 62, y1: 686 };   // must match the client's BOSS_BOUNDS
const DOOR_Y0_LOUNGE = 205, DOOR_Y1_LOUNGE = 285;           // must match the client's DOOR_ZONE
const DOOR_Y0_BOSS = 320, DOOR_Y1_BOSS = 420;               // must match the client's BOSS_DOOR_ZONE
const ROOM_DOORS = {
  lounge: { x0: 412, x1: B.x1, y0: DOOR_Y0_LOUNGE, y1: DOOR_Y1_LOUNGE, toRoom: "boss" },
  boss:   { x0: BOSS_BOUNDS.x0, x1: 68, y0: DOOR_Y0_BOSS, y1: DOOR_Y1_BOSS, toRoom: "lounge" }
};
const ROOM_ENTRY = {
  lounge: { x: 400, y: (DOOR_Y0_LOUNGE + DOOR_Y1_LOUNGE) / 2 },   // appear just inside the lounge door
  boss:   { x: 80,  y: (DOOR_Y0_BOSS + DOOR_Y1_BOSS) / 2 }        // appear just inside the boss door
};
const BOSS_POS = { x: 560, y: 370 };                  // must match the client's BOSS_POS
const SWORD_CHEST = { x: 630, y: 370 };               // must match the client's SWORD_CHEST
const SWORD_PICK_R = 40;
const BOSS_FIRE_INTERVAL_MS = 2600;
const BOSS_ARC = Math.PI * 0.55;                      // total spread of a "fan" volley, in radians
const BOSS_MAX_HP = 30;                               // fireball hits needed to defeat the boss
let swordHolderId = null;                             // player id currently holding the magical sword, or null
let bossSeq = 0;
let bossHP = BOSS_MAX_HP;
let bossAlive = true;

function playersInRoom(room, exceptWs) {
  const out = [];
  for (const [ws2, p] of players) if (p.room === room && ws2 !== exceptWs) out.push(p);
  return out;
}
function broadcastRoom(room, obj, exceptWs) {
  const data = JSON.stringify(obj);
  for (const [ws2, p] of players) if (p.room === room && ws2 !== exceptWs && ws2.readyState === 1) ws2.send(data);
}
function maybeResetBoss() {
  const stillThere = [...players.values()].some((p) => p.room === "boss");
  if (!stillThere && (bossHP !== BOSS_MAX_HP || !bossAlive)) { bossHP = BOSS_MAX_HP; bossAlive = true; }
}
function changeRoom(ws, me, newRoom, reason) {
  if (newRoom === me.room) return;
  const oldRoom = me.room;
  broadcastRoom(oldRoom, { t: "left", id: me.id }, ws);
  if (oldRoom === "boss") me.bossHits = 0;
  me.room = newRoom;
  const entry = ROOM_ENTRY[newRoom];
  me.x = entry.x; me.y = entry.y; me.dirty = true;
  const peers = playersInRoom(newRoom, ws).map(publicView);
  send(ws, { t: "roomChanged", room: newRoom, x: me.x, y: me.y, peers, swordHolderId, bossHP, bossAlive, reason });
  broadcastRoom(newRoom, { t: "joined", peer: publicView(me) }, ws);
  if (oldRoom === "boss") maybeResetBoss();
}

// The boss picks a random attack pattern for each volley, so fights don't feel repetitive.
function bossFireOne(dx, dy) {
  broadcastRoom("boss", { t: "bossFire", seq: ++bossSeq, x: BOSS_POS.x, y: BOSS_POS.y, dx, dy });
}
function fireBossVolley() {
  const pattern = BOSS_PATTERNS[Math.floor(Math.random() * BOSS_PATTERNS.length)];
  pattern();
}
const BOSS_PATTERNS = [
  function fan() {   // a spreading fan aimed generally at the door
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const ang = t * BOSS_ARC;
      bossFireOne(-Math.cos(ang), Math.sin(ang));
    }
  },
  function aimed() {   // one shot straight at each player currently in the room
    const targets = playersInRoom("boss");
    for (const p of targets) {
      const dx = p.x - BOSS_POS.x, dy = p.y - BOSS_POS.y;
      const len = Math.hypot(dx, dy) || 1;
      bossFireOne(dx / len, dy / len);
    }
  },
  function ring() {   // a full circle, bullet-hell style
    const n = 12;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      bossFireOne(Math.cos(ang), Math.sin(ang));
    }
  },
  function wave() {   // a sweeping arc fired one shot at a time
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) - 0.5;
      const ang = t * BOSS_ARC;
      setTimeout(() => { if (bossAlive) bossFireOne(-Math.cos(ang), Math.sin(ang)); }, i * 90);
    }
  }
];

// 10 hats across 5 rarities. Weight is relative (not a percentage) — a bigger
// number means the hat comes up more often. Golden Crown is the rarest.
const HATS = [
  { id: "dragon", rarity: "legendary", weight: 1 },
  { id: "straw", rarity: "common", weight: 100 },
  { id: "acorn", rarity: "common", weight: 100 },
  { id: "bandana", rarity: "common", weight: 100 },
  { id: "flower", rarity: "uncommon", weight: 40 },
  { id: "wizard", rarity: "uncommon", weight: 40 },
  { id: "pirate", rarity: "rare", weight: 15 },
  { id: "silver", rarity: "rare", weight: 15 },
  { id: "halo", rarity: "epic", weight: 5 },
  { id: "horns", rarity: "epic", weight: 5 },
  { id: "golden", rarity: "rare", weight: 15 },
  { id: "flamecrown", rarity: "legendary", weight: 1 }
];
const HAT_TOTAL = HATS.reduce((s, h) => s + h.weight, 0);
function rollHat(nickname) {
  if (nickname === "Lester") return "dragon";
  if (nickname === "Lyn") return "flamecrown";
  let r = Math.random() * HAT_TOTAL;
  for (const h of HATS) { if (r < h.weight) return h.id; r -= h.weight; }
  return HATS[0].id;
}
const claims = new Map();   // clientId -> hat id (persists for as long as this server process runs)
const hitBoard = new Map(); // clientId -> number of fireball hits landed on others (reset when the room is empty)
const powerupClaims = new Map(); // clientId -> number of power-chest milestones (10, 20, 30...) claimed; resets with hitBoard

const INDEX = path.join(__dirname, "public", "index.html");

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/" || url === "/index.html") {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); res.end("Server error"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(data);
    });
  } else if (url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok");
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 });
const players = new Map();   // ws -> {id, name, hue, x, y, dirty, lastChat}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clean = (s, n) =>
  String(s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const passwordOk = (given) => !PASSWORD || crypto.timingSafeEqual(digest(given), digest(PASSWORD));

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, except) {
  const data = JSON.stringify(obj);
  for (const [ws] of players) if (ws !== except && ws.readyState === 1) ws.send(data);
}
const publicView = (p) => ({ id: p.id, name: p.name, hue: p.hue, x: p.x, y: p.y, hat: p.hat || null });
function boardList(extra) {
  const list = [...players.values()].map((p) => ({ id: p.id, name: p.name, hits: hitBoard.get(p.clientId) || 0 }));
  if (extra) list.push({ id: extra.id, name: extra.name, hits: hitBoard.get(extra.clientId) || 0 });
  return list;
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  send(ws, { t: "hello", needsPassword: !!PASSWORD });

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m.t !== "string") return;
    const me = players.get(ws);

    if (m.t === "join") {
      if (me) return;
      if (!passwordOk(m.password || "")) { send(ws, { t: "denied", reason: "password" }); return; }
      if (players.size >= MAX_PLAYERS) { send(ws, { t: "denied", reason: "full" }); return; }
      const clientId = typeof m.clientId === "string" && m.clientId.length >= 4 && m.clientId.length <= 64
        ? m.clientId : crypto.randomBytes(6).toString("hex");
      const p = {
        id: crypto.randomBytes(4).toString("hex"),
        clientId,
        name: clean(m.name || "", 14) || "Slime",
        hue: isNum(m.hue) ? ((Math.round(m.hue) % 360) + 360) % 360 : 120,
        x: clamp(isNum(m.x) ? m.x : 240, B.x0, B.x1),
        y: clamp(isNum(m.y) ? m.y : 310, B.y0, B.y1),
        room: "lounge",
        hat: claims.get(clientId) || null,
        dirty: false, lastChat: 0,
        lastFire: 0, timesHit: 0,
        fireHitBudget: 0, fireHitTargets: null, fireHitWindowMs: FIRE_HIT_WINDOW_MS,
        powerup: null, powerupClaims: powerupClaims.get(clientId) || 0,
        bossHits: 0, lastBossHitAt: 0
      };
      if (!hitBoard.has(clientId)) hitBoard.set(clientId, 0);
      send(ws, {
        t: "welcome", id: p.id, yourHat: p.hat,
        yourHits: hitBoard.get(clientId) || 0, yourPowerupClaims: p.powerupClaims,
        peers: playersInRoom("lounge", ws).map(publicView), board: boardList(p), swordHolderId, bossHP, bossAlive
      });
      players.set(ws, p);
      broadcastRoom("lounge", { t: "joined", peer: publicView(p) }, ws);
      broadcast({ t: "board", list: boardList() }, ws);
    } else if (!me) {
      return;
    } else if (m.t === "pos") {
      if (isNum(m.x) && isNum(m.y)) {
        const rb = me.room === "boss" ? BOSS_BOUNDS : B;
        me.x = clamp(m.x, rb.x0, rb.x1); me.y = clamp(m.y, rb.y0, rb.y1); me.dirty = true;
        const door = ROOM_DOORS[me.room];
        if (door && me.x >= door.x0 && me.x <= door.x1 && me.y >= door.y0 && me.y <= door.y1) {
          changeRoom(ws, me, door.toRoom);
        }
      }
    } else if (m.t === "chest") {
      if (me.hat) { send(ws, { t: "hatResult", hat: me.hat, already: true }); return; }
      if (Math.hypot(me.x - CHEST.x, me.y - CHEST.y) > CHEST.r + 10) return;   // out of range, ignore quietly
      const hat = rollHat(me.name);
      me.hat = hat;
      claims.set(me.clientId, hat);
      send(ws, { t: "hatResult", hat, already: false });
      broadcast({ t: "hat", id: me.id, hat }, ws);
    } else if (m.t === "fire") {
      const now = Date.now();
      const pu = activePowerupId(me);
      const speedMult = pu === "speedy" ? 1.9 : 1;
      const sizeMult = (me.hat === "dragon" ? 1.7 : 1) * (pu === "big" ? 1.5 : 1);
      const bounce = pu === "bouncy";
      const pierce = pu === "pierce";
      const life = bounce ? 4200 : (pierce ? 1300 : 900);
      const shots = pu === "triple" ? 3 : 1;
      const cooldown = pu === "rapid" ? Math.round(FIRE_COOLDOWN_MS * 0.35) : FIRE_COOLDOWN_MS;
      if (now - (me.lastFire || 0) < cooldown) return;
      if (!isNum(m.dx) || !isNum(m.dy)) return;
      const len = Math.hypot(m.dx, m.dy) || 1;
      const baseDx = m.dx / len, baseDy = m.dy / len;
      me.lastFire = now;
      me.fireHitBudget = pierce ? 6 : shots;
      me.fireHitTargets = new Set();
      me.fireHitWindowMs = life + 400;
      const spread = 0.34;
      for (let i = 0; i < shots; i++) {
        const ang = shots === 3 ? (i - 1) * spread : 0;
        const c = Math.cos(ang), s = Math.sin(ang);
        const ddx = baseDx * c - baseDy * s, ddy = baseDx * s + baseDy * c;
        broadcastRoom(me.room, { t: "fire", id: me.id, x: me.x, y: me.y, dx: ddx, dy: ddy, speedMult, sizeMult, bounce, life, pierce }, ws);
      }
    } else if (m.t === "hit") {
      if (typeof m.targetId !== "string" || m.targetId === me.id) return;
      const now = Date.now();
      if (now - (me.lastFire || 0) > (me.fireHitWindowMs || FIRE_HIT_WINDOW_MS)) return;   // no fresh fire to credit this to
      if (!me.fireHitBudget || me.fireHitBudget <= 0) return;                              // this throw is spent
      if (me.fireHitTargets && me.fireHitTargets.has(m.targetId)) return;                  // already credited this target

      if (m.targetId === "boss") {
        if (me.room !== "boss" || !bossAlive) return;
        me.fireHitBudget -= 1;
        if (me.fireHitTargets) me.fireHitTargets.add("boss");
        bossHP = Math.max(0, bossHP - 1);
        broadcastRoom("boss", { t: "bossHP", hp: bossHP });
        if (bossHP <= 0) { bossAlive = false; broadcastRoom("boss", { t: "bossDefeated" }); }
        return;
      }

      let target = null, targetWs = null;
      for (const [tws, p] of players) if (p.id === m.targetId) { target = p; targetWs = tws; break; }
      if (!target) return;
      me.fireHitBudget -= 1;
      if (me.fireHitTargets) me.fireHitTargets.add(m.targetId);
      hitBoard.set(me.clientId, (hitBoard.get(me.clientId) || 0) + 1);
      broadcast({ t: "board", list: boardList() });
      target.timesHit = (target.timesHit || 0) + 1;
      if (target.timesHit >= 2) {
        target.timesHit = 0;
        if (target.room === "boss") {
          changeRoom(targetWs, target, "lounge", "died");   // dying in the boss room sends you back to the lounge
        } else {
          target.x = CENTER.x; target.y = CENTER.y; target.dirty = true;
          broadcastRoom(target.room, { t: "death", id: target.id, x: CENTER.x, y: CENTER.y });
        }
      }
    } else if (m.t === "bossHit") {
      if (me.room !== "boss") return;
      const now = Date.now();
      if (now - (me.lastBossHitAt || 0) < 300) return;   // debounce: one fireball can't multi-count
      me.lastBossHitAt = now;
      me.bossHits = (me.bossHits || 0) + 1;
      if (me.bossHits >= 2) {
        changeRoom(ws, me, "lounge", "boss");   // two hits from the boss sends you back to the lounge
      }
    } else if (m.t === "powerchest") {
      if (Math.hypot(me.x - POWER_CHEST.x, me.y - POWER_CHEST.y) > POWER_CHEST.r + 10) return;   // out of range, ignore quietly
      const hits = hitBoard.get(me.clientId) || 0;
      const claimed = powerupClaims.get(me.clientId) || 0;
      const nextAt = (claimed + 1) * 10;
      if (hits < nextAt) { send(ws, { t: "powerchestResult", ok: false, nextAt, hits }); return; }
      const pu = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
      powerupClaims.set(me.clientId, claimed + 1);
      me.powerupClaims = claimed + 1;
      const expiresAt = Date.now() + pu.durationMs;
      me.powerup = { id: pu.id, expiresAt };
      send(ws, { t: "powerchestResult", ok: true, id: pu.id, name: pu.name, desc: pu.desc, expiresAt, claims: me.powerupClaims });
      broadcast({ t: "powerupGrant", id: me.id, name: me.name, puName: pu.name }, ws);
    } else if (m.t === "chat") {
      const now = Date.now();
      if (now - me.lastChat < 400) return;
      const text = clean(m.text || "", 120);
      if (!text) return;
      me.lastChat = now;
      broadcast({ t: "chat", id: me.id, name: me.name, text });
    }
  });

  ws.on("close", () => {
    const me = players.get(ws);
    if (me) {
      players.delete(ws);
      broadcastRoom(me.room, { t: "left", id: me.id });
      if (me.room === "boss") maybeResetBoss();
      if (players.size === 0) { hitBoard.clear(); powerupClaims.clear(); }
    }
  });
  ws.on("error", () => {});
});

// batch position updates ~15 times per second, and check the magical sword's holder
let lastSwordHolderId = null;
setInterval(() => {
  const moved = [];
  for (const [, p] of players) if (p.dirty) { moved.push([p.id, p.x, p.y]); p.dirty = false; }
  if (moved.length) broadcast({ t: "state", p: moved });

  // The sword sits at the chest until someone walks up to it; after that, anyone who
  // walks up to whoever is currently holding it takes it from them.
  let holder = swordHolderId ? [...players.values()].find((p) => p.id === swordHolderId) : null;
  if (swordHolderId && !holder) swordHolderId = null;
  for (const [, p] of players) {
    if (!swordHolderId) {
      if (p.room === "boss" && Math.hypot(p.x - SWORD_CHEST.x, p.y - SWORD_CHEST.y) < SWORD_PICK_R) { swordHolderId = p.id; break; }
    } else if (holder && p.id !== swordHolderId && p.room === holder.room && Math.hypot(p.x - holder.x, p.y - holder.y) < SWORD_PICK_R) {
      swordHolderId = p.id; break;
    }
  }
  if (swordHolderId !== lastSwordHolderId) { lastSwordHolderId = swordHolderId; broadcast({ t: "sword", holderId: swordHolderId }); }
}, 66);

// the big bad slime's fireball volleys, only while alive and someone is in the boss room
setInterval(() => {
  if (!bossAlive) return;
  const inBoss = [...players.values()].some((p) => p.room === "boss");
  if (!inBoss) return;
  fireBossVolley();
}, BOSS_FIRE_INTERVAL_MS);

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log("Slime Lounge running on port " + PORT + (PASSWORD ? " (password protected)" : "")));
