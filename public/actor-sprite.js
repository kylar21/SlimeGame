"use strict";
// ---------- Pixi actor sprites ----------
// Replaces the old per-frame Canvas2D drawSlime()/drawHat() (players) and
// drawFieldMobs()/drawWolf() (render-field-mobs-world.js / render-wolf-world.js) calls.
// Those functions still exist and are still used by ui-panels.js for the 64x64 bag-icon
// thumbnails — nothing there changes.
//
// One PIXI.Container per live actor, pooled by key ("me", a remote id, "mob:<id>",
// "wolf") and reused frame to frame instead of being rebuilt from scratch, which is the
// point of a scene graph over immediate-mode drawing. Each container holds a body Sprite
// (2-frame idle/walk swap, driven manually off game time `t` rather than Pixi's own
// ticker — see pixi-app.js) and, for players, a hat Sprite child.
var ActorSprites = (function () {
  var pool = {};   // key -> { container, body, hat, kind }

  function makeEntry(kind) {
    var container = new PIXI.Container();
    var body = new PIXI.Sprite(PIXI.Texture.EMPTY);
    var hat = new PIXI.Sprite(PIXI.Texture.EMPTY);
    hat.visible = false;
    container.addChild(body, hat);
    PixiLayer.world.addChild(container);
    return { container: container, body: body, hat: hat, kind: kind, curHat: null };
  }
  function get(key, kind) { return pool[key] || (pool[key] = makeEntry(kind)); }

  function pickFrame(frames, t, moving) {
    if (!frames || !frames.length) return null;
    var idx = Math.floor(t * (moving ? 6 : 2.2)) % frames.length;
    return frames[idx];
  }

  // desc: { key, kind: "player"|"mob"|"wolf", x, y, hue, hat, moving, scale }
  // (scale only meaningful for "mob", to reproduce per-tier sizing — see radiusFor()
  // in render-field-mobs-world.js; the caller in loop.js computes it so this file
  // doesn't need to know about FIELD_MOB_TIER_R.)
  function sync(descs, t) {
    if (!PixiLayer.isReady) return;
    var anchors = SpriteRegistry.anchors(), seen = {};
    for (var i = 0; i < descs.length; i++) {
      var d = descs[i], e = get(d.key, d.kind);
      seen[d.key] = true;
      e.container.visible = true;
      e.container.x = d.x; e.container.y = d.y;
      e.container.zIndex = d.y;

      var frames, anchor;
      if (d.kind === "player") { frames = SpriteRegistry.playerFrames(d.hue, d.moving); anchor = anchors.player; }
      else if (d.kind === "mob") { frames = SpriteRegistry.mobFrames(d.mobId, d.moving); anchor = anchors.mob; }
      else { frames = SpriteRegistry.wolfFrames(d.moving); anchor = anchors.wolf; }

      var tex = pickFrame(frames, t, d.moving);
      if (tex) { e.body.texture = tex; e.body.anchor.set(anchor.x, anchor.y); }
      e.body.scale.set(d.scale || 1);

      if (d.kind === "player" && d.hat) {
        if (e.curHat !== d.hat) {
          var htex = SpriteRegistry.hatTexture(d.hat);
          if (htex) { e.hat.texture = htex; e.curHat = d.hat; }
        }
        var ha = anchors.hat;
        e.hat.anchor.set(ha.x, ha.y);
        e.hat.position.set(0, -SpriteRegistry.playerHeadOffset());
        e.hat.visible = true;
      } else {
        e.hat.visible = false; e.curHat = null;
      }
    }
    // Recycle anything not present this frame (player left, mob despawned, wolf died).
    Object.keys(pool).forEach(function (key) {
      if (!seen[key]) { pool[key].container.destroy({ children: true }); delete pool[key]; }
    });
  }

  return { sync: sync };
})();
