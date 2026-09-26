"use strict";

  // ---------- update / render ----------
  //
  // Rendering is now split across three stacked canvases (see index.html/dom-state.js):
  //   #game     (ctx)   — world/city ground, buildings, props. Canvas2D, unchanged below.
  //   #pixiGame (Pixi)  — player avatars, field mobs, the wolf. Real animated sprites
  //                        (public/assets/sprites/atlas.png) via actor-sprite.js.
  //   #fxGame   (fxCtx) — everything that used to draw *after* the old sprite pass: HP
  //                        bars, names, chat bubbles, weapon/sword icons, the boss,
  //                        fireballs/swings/puffs. Canvas2D, transparent, drawn on top of
  //                        Pixi so it still occludes correctly relative to sprites.
  //
  // Known trade-off: buildings (layer 1) can no longer occlude a player/mob sprite
  // (layer 2) the way the old single-canvas y-sort did — a tall house always renders
  // behind actors now. Fixing that means moving building art into Pixi too; out of scope
  // for this pass. Everything else keeps its original look and hit-detection behaviour.
  function update(dt) {
    if (activePowerup && Date.now() > activePowerup.expiresAt) {
      addSys((POWERUP_EMOJI[activePowerup.id] || "✨") + " Your " + activePowerup.name + " wore off.");
      activePowerup = null;
      refreshInventory();
    }
    var effSpeed = SPEED / curScale() * (activePowerup && activePowerup.id === "haste" ? 1.4 : 1);

    if (joined && document.activeElement !== chatInput) {
      var vx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
      var vy = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
      if (vx || vy) {
        me.tx = null; me.ty = null;
        var len = Math.hypot(vx, vy);
        var mv1 = resolveMove(me.x, me.y, vx / len * effSpeed * dt, vy / len * effSpeed * dt);
        me.x = mv1.x; me.y = mv1.y;
        me.moving = true;
        me.facing = { x: vx / len, y: vy / len };
      } else me.moving = false;
    } else me.moving = false;

    if (me.tx !== null && joined) {
      var dx = me.tx - me.x, dy = me.ty - me.y, dist = Math.hypot(dx, dy);
      if (dist < 3) { me.tx = null; me.ty = null; me.moving = false; }
      else {
        var step = Math.min(effSpeed * dt, dist);
        var mv2 = resolveMove(me.x, me.y, dx / dist * step, dy / dist * step);
        me.x = mv2.x; me.y = mv2.y; me.moving = true;
        me.facing = { x: dx / dist, y: dy / dist };
      }
    }
    pushPresence(false);

    var nearChest = myRoom === "lounge" && joined && !me.hat && Math.hypot(me.x - CHEST.x, me.y - CHEST.y) < CHEST.r;
    setShown(chestBtn, nearChest);

    var nearPower = myRoom === "lounge" && joined && Math.hypot(me.x - POWER_CHEST.x, me.y - POWER_CHEST.y) < POWER_CHEST.r;
    if (nearPower) {
      var nextAt = (myPowerupClaims + 1) * 10, need = nextAt - myHits;
      setText(powerChestBtn, myHits >= nextAt ? "✨ Open power chest" : "🔒 " + need + " more hit" + (need === 1 ? "" : "s"));
    }
    setShown(powerChestBtn, nearPower);

    var nearStand = myRoom === "lounge" && joined && Math.hypot(me.x - CLASS_STAND.x, me.y - CLASS_STAND.y) < CLASS_STAND.r;
    var standOpen = isOpen(classPanel);
    setShown(classBtn, nearStand && !standOpen);
    if (standOpen && !nearStand) closePanels();   // walked away from the stand

    var nearSecondStand = myRoom === "lounge" && joined && Math.hypot(me.x - SECOND_CLASS_STAND.x, me.y - SECOND_CLASS_STAND.y) < SECOND_CLASS_STAND.r;
    var secondStandOpen = isOpen(secondClassPanel);
    setShown(secondClassBtn, nearSecondStand && !secondStandOpen);
    if (secondStandOpen && !nearSecondStand) closePanels();   // walked away from the second-class stand

    if (activePowerup) {
      var remain = Math.max(0, (activePowerup.expiresAt - Date.now()) / 1000);
      setText(powerupBadge, (POWERUP_EMOJI[activePowerup.id] || "✨") + " " + activePowerup.name + " · " + remain.toFixed(1) + "s");
    }
    setShown(powerupBadge, !!activePowerup);
  }

  function render(t, now) {
    var scale = curScale();
    ctx.save();
    ctx.scale(scale, scale);
    // Same smoothing rate used for remote players / the wolf / field mobs' network
    // interpolation — still needed even though the drawing itself moved to Pixi, since
    // the eased x/y here is what hit-detection (stepAndDrawFires) and the HP-bar/name
    // overlay (fxCtx, below) both read.
    var k = 1 - Math.exp(-0.25 * 60 * 0.016);
    var worldCamX = 0, worldCamY = 0;
    var worldEntitySprites = null;
    if (myRoom === "world") {
      worldCamX = me.x - W / 2; worldCamY = me.y - W / 2;
      ctx.fillStyle = "#182a1c"; ctx.fillRect(0, 0, W, W);
      ctx.translate(-worldCamX, -worldCamY);
      drawWorldTiles(worldCamX, worldCamY);
      worldEntitySprites = collectWorldEntitySprites(worldCamX, worldCamY);
      fieldMobs.forEach(function (m) { m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; });
      drawWorldReturnPortal(now);
    } else if (myRoom === "lounge") {
      worldCamX = me.x - W / 2; worldCamY = me.y - W / 2;
      ctx.fillStyle = "#6f4529"; ctx.fillRect(0, 0, W, W);
      ctx.translate(-worldCamX, -worldCamY);
      drawCityGround(worldCamX, worldCamY);
      drawCityProps();
      worldEntitySprites = collectCityHouseSprites(worldCamX, worldCamY);
    } else {
      ctx.drawImage(floorBoss, 0, 0);
    }
    // Buildings/props (no longer y-sorted against actors — see the file header note).
    if (worldEntitySprites && worldEntitySprites.length) worldEntitySprites.forEach(drawWorldEntitySprite);

    var actors = [], i;
    if (joined) actors.push({ key: "me", x: me.x, y: me.y, hue: me.hue, name: me.name, moving: me.moving, phase: 0, self: true, hat: me.hat, cls: me.cls, scale: 1, hp: me.hp, maxHp: me.maxHp });
    remote.forEach(function (r) {
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k;
      actors.push({ key: r.id, x: r.x, y: r.y, hue: r.hue, name: r.name, moving: Math.hypot(r.tx - r.x, r.ty - r.y) > 2, phase: r.phase, self: false, hat: r.hat, cls: r.cls, scale: 1, hp: r.hp, maxHp: r.maxHp });
    });
    if (myRoom === "lounge" && wolf.alive) {
      wolf.x += (wolf.tx - wolf.x) * k; wolf.y += (wolf.ty - wolf.y) * k;
      actors.push({ key: "wolf", x: wolf.x, y: wolf.y, name: "Wolf", wolf: true, dir: wolf.dir, moving: Math.hypot(wolf.tx - wolf.x, wolf.ty - wolf.y) > 1.5, phase: 0, self: false, hat: null });
    }
    if (myRoom === "boss") {
      actors.push({
        key: "boss", x: BOSS_POS.x, y: BOSS_POS.y,
        name: bossAlive ? "The Big Slime" : "Defeated Slime",
        moving: false, phase: 0, self: false, hat: null, boss: true
      });
    }
    if (myRoom === "world") {
      fieldMobs.forEach(function (m) {
        actors.push({
          key: "mob:" + m.id, x: m.x, y: m.y,
          name: m.tier === "normal" ? "" : fieldMobLabel(m),
          moving: false, phase: 0, self: false, hat: null,
          fieldMob: true, tier: m.tier, mobId: m.mobId, hp: m.hp, maxHp: m.maxHp,
          topY: m.y - radiusFor(m)
        });
      });
    }
    // Player-kind actors never got a topY from a draw call now that drawSlime() isn't
    // invoked here every frame — HP bars/weapon icons/sword/bubbles all need it, so set
    // it directly. Static (no hop bounce baked in) since the Pixi body sprite's own
    // idle/walk squash-stretch frames carry the "alive" feel now instead.
    for (i = 0; i < actors.length; i++) { if (!actors[i].wolf && !actors[i].boss && !actors[i].fieldMob) actors[i].topY = actors[i].y - SH; }

    // click marker (ground decal, stays under everyone on the background layer)
    if (joined && me.tx !== null) {
      var pulse = 6 + Math.sin(t * 8) * 2;
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(me.tx, me.ty, pulse + 4, (pulse + 4) * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (myRoom === "lounge") drawLoot(t);   // on the ground, under everyone
    actors.sort(function (a, b) { return a.y - b.y; });
    ctx.restore();   // close the #game (background) pass

    // ---------- Pixi sprite pass (#pixiGame) ----------
    var pixiDescs = [];
    if (joined) pixiDescs.push({ key: "me", kind: "player", x: me.x, y: me.y, hue: me.hue, hat: me.hat, moving: me.moving });
    remote.forEach(function (r) { pixiDescs.push({ key: r.id, kind: "player", x: r.x, y: r.y, hue: r.hue, hat: r.hat, moving: Math.hypot(r.tx - r.x, r.ty - r.y) > 2 }); });
    if (myRoom === "lounge" && wolf.alive) pixiDescs.push({ key: "wolf", kind: "wolf", x: wolf.x, y: wolf.y, moving: Math.hypot(wolf.tx - wolf.x, wolf.ty - wolf.y) > 1.5 });
    if (myRoom === "world") {
      fieldMobs.forEach(function (m) {
        pixiDescs.push({ key: "mob:" + m.id, kind: "mob", mobId: m.mobId || "slimelet", x: m.x, y: m.y, moving: false, scale: radiusFor(m) / SpriteRegistry.mobBaseRadius() });
      });
    }
    ActorSprites.sync(pixiDescs, t);
    PixiCamera.update(scale, worldCamX, worldCamY);
    PixiLayer.render();

    // ---------- foreground fx pass (#fxGame, transparent, drawn on top of Pixi) ----------
    fxCtx.clearRect(0, 0, W, W);
    fxCtx.save();
    fxCtx.scale(scale, scale);
    if (myRoom !== "boss") fxCtx.translate(-worldCamX, -worldCamY);
    var _oldCtx = ctx; ctx = fxCtx;   // every draw* function below reads the module-scope `ctx` (same trick ui-panels.js uses for bag icons)

    if (myRoom === "boss") drawBoss(BOSS_POS.x, BOSS_POS.y, t);
    for (i = 0; i < actors.length; i++) drawWeapon(actors[i], t);
    for (i = 0; i < actors.length; i++) drawSword(actors[i]);
    for (i = 0; i < actors.length; i++) drawHPBar(actors[i]);
    for (i = 0; i < actors.length; i++) drawName(actors[i]);
    for (i = 0; i < actors.length; i++) {
      var b = bubbles.get(actors[i].key);
      if (b) { if (now > b.until) bubbles.delete(actors[i].key); else drawBubble(actors[i], b, now); }
    }
    if (myRoom === "boss" && !swordHolderId) drawRestingSword(now);
    drawSwings(now);
    drawPuffs(now);
    stepAndDrawFires(now, actors);
    fxCtx.restore();
    if (myRoom === "boss" && bossAlive) drawBossHP();   // raw screen space, same as before (drawn after the transform is restored)
    ctx = _oldCtx;
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    render(now / 1000, now);
    requestAnimationFrame(frame);
  }
