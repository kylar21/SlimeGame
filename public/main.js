"use strict";

  // ---------- go ----------
  updateStatus();
  PixiLayer.init();   // creates the #pixiGame renderer + starts loading assets/sprites/atlas.json
  connect();
  requestAnimationFrame(frame);
