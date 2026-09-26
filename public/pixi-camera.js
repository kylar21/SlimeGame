"use strict";
// ---------- Pixi camera ----------
// loop.js's render() does `ctx.scale(scale, scale)` once for every room, then, only for
// the camera-scrolled rooms ("world"/"lounge"), `ctx.translate(-camX, -camY)`. A
// PIXI.Container composes position/scale the same way Canvas2D composes
// scale+translate (screen = position + local * scale), so mirroring it is one line.
var PixiCamera = {
  update: function (scale, camX, camY) {
    if (!PixiLayer.world) return;
    PixiLayer.world.scale.set(scale);
    PixiLayer.world.position.set(-camX * scale, -camY * scale);
  }
};
