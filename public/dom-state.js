"use strict";

  // ---------- DOM ----------
  var cv = document.getElementById("game");
  var ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  // Foreground overlay canvas (#fxGame, transparent, stacked above #pixiGame) — HP bars,
  // names, bubbles, weapon/sword icons, the boss, fireballs/swings all draw here now via
  // loop.js's render() temporarily pointing the shared `ctx` at it. See index.html for
  // the stacking order and pixi-app.js for the Pixi layer in between.
  var fxCv = document.getElementById("fxGame");
  var fxCtx = fxCv.getContext("2d");
  fxCtx.imageSmoothingEnabled = false;
  var overlay = document.getElementById("overlay");
  var nickEl = document.getElementById("nick");
  var swEl = document.getElementById("swatches");
  var logEl = document.getElementById("log");
  var chatInput = document.getElementById("chatInput");
  var dot = document.getElementById("dot");
  var statusText = document.getElementById("statusText");
  var boardEl = document.getElementById("board");
  var xpBarWrap = document.getElementById("xpBarWrap"), xpBarFill = document.getElementById("xpBarFill"), xpBarLabel = document.getElementById("xpBarLabel");
  var secondClassBtn = document.getElementById("secondClassBtn"), secondClassPanel = document.getElementById("secondClassPanel"),
      secondClassesLive = document.getElementById("secondClassesLive"), secondClassHint = document.getElementById("secondClassHint");

  // ---------- state ----------
  var joined = false;
  var me = { x: 240, y: 180, tx: null, ty: null, name: "", hue: 120, moving: false, hat: null, cls: C.DEFAULT_CLASS, secondCls: null, facing: { x: 0, y: 1 } };
  var fires = [];
  var swings = [];             // melee slash effects (cosmetic; the server resolves melee hits)
  // Lounge world state, owned by the server (wolf AI, drops, pickups); the client only mirrors and draws it.
  var wolf = { alive: false, x: 0, y: 0, tx: 0, ty: 0, dir: 1 };
  var lootItems = [];          // { id, x, y, born }
  var puffs = [];              // wolf death poofs (cosmetic)
  var myRope = 0;              // bag: rope count (server-confirmed)
  var lastFireAt = 0;
  var keys = {};
  var bubbles = new Map();     // key -> {text, until}
  var lastChatAt = 0;
  var activePowerup = null;    // { id, name, desc, expiresAt } | null
  var myHits = 0;
  var myPowerupClaims = 0;
  var myRoom = "lounge";       // "lounge" | "boss"
  var swordHolderId = null;    // player id currently holding the magical sword, or null
  var bossHP = BOSS_MAX_HP;
  var bossAlive = true;

  // ---------- helpers ----------
  function clean(s, n) {
    return String(s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function hashPhase(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 628; return h / 100; }

  // ---------- xp bar (fixed to the bottom of the screen) ----------
  // Single source of truth for the xp-bar fill/label — same C.levelFromXp() calc
  // ui-panels.js's bagItems() uses for the bag tooltip, so the two never disagree.
  // Called from network.js whenever me.xp/me.level change ("welcome", "xp").
  function updateXpBar() {
    if (!joined) { setShown(xpBarWrap, false); return; }
    var info = C.levelFromXp(me.xp || 0);
    var frac = isFinite(info.xpForNext) ? clamp(info.xpForNext > 0 ? info.xpIntoLevel / info.xpForNext : 1, 0, 1) : 1;
    xpBarFill.style.width = (frac * 100) + "%";
    setText(xpBarLabel, "Lv " + (me.level || 1) + (isFinite(info.xpForNext) ? " · " + info.xpIntoLevel + " / " + info.xpForNext + " xp" : " · Max level"));
    setShown(xpBarWrap, true);
  }
