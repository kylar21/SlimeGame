"use strict";
// ---------- sprite registry ----------
// Thin lookup layer over the atlas PixiLayer/PIXI.Assets loads (public/assets/sprites/
// atlas.png + atlas.json, built by tools/gen-spritesheets.js). Keeps every other Pixi
// file ignorant of frame-naming conventions and the atlas's custom `meta.anchors`.
var SpriteRegistry = (function () {
  function sheet() { return PixiLayer.sheet; }

  // Two Texture[] per actor "kind": idle loop and walk loop (see gen-spritesheets.js —
  // each is a 2-frame ping-pong: [own, other]). Returns null before the atlas has loaded.
  function mobFrames(mobId, moving) {
    var s = sheet(); if (!s || !s.animations) return null;
    var key = "mob_" + mobId + "_" + (moving ? "walk" : "idle");
    return s.animations[key] || s.animations["mob_slimelet_" + (moving ? "walk" : "idle")] || null;
  }
  var NEAREST_HUE_CACHE = {};
  function nearestHue(h) {
    if (NEAREST_HUE_CACHE[h] != null) return NEAREST_HUE_CACHE[h];
    var best = HUES[0], bestD = Infinity;
    HUES.forEach(function (H) { var d = Math.min(Math.abs(H - h), 360 - Math.abs(H - h)); if (d < bestD) { bestD = d; best = H; } });
    return (NEAREST_HUE_CACHE[h] = best);
  }
  function playerFrames(hue, moving) {
    var s = sheet(); if (!s || !s.animations) return null;
    var key = "player_h" + nearestHue(Math.round(hue)) + "_" + (moving ? "walk" : "idle");
    return s.animations[key] || null;
  }
  function wolfFrames(moving) {
    var s = sheet(); if (!s || !s.animations) return null;
    return s.animations["wolf_" + (moving ? "walk" : "idle")] || null;
  }
  function hatTexture(hatId) {
    var s = sheet(); if (!s || !s.textures || !hatId) return null;
    return s.textures["hat_" + hatId] || null;
  }
  function anchors() { var s = sheet(); return (s && s.data && s.data.meta && s.data.meta.anchors) || { mob: { x: .5, y: .5 }, player: { x: .5, y: .5 }, wolf: { x: .5, y: .5 }, hat: { x: .5, y: .5 } }; }
  function mobBaseRadius() { var s = sheet(); return (s && s.data && s.data.meta && s.data.meta.mobBaseRadius) || 20; }
  function playerHeadOffset() { var s = sheet(); return (s && s.data && s.data.meta && s.data.meta.playerHeadOffset) || 66; }

  return {
    mobFrames: mobFrames, playerFrames: playerFrames, wolfFrames: wolfFrames, hatTexture: hatTexture,
    anchors: anchors, mobBaseRadius: mobBaseRadius, playerHeadOffset: playerHeadOffset
  };
})();
