"use strict";
// ---------- Pixi bootstrap ----------
// Renders on its own transparent canvas (#pixiGame), stacked between the background
// canvas (#game) and the foreground-fx canvas (#fxGame) — see dom-state.js/index.html.
// Pixi's own ticker is stopped: loop.js's existing requestAnimationFrame loop is still
// the single clock for the whole game, and calls PixiLayer.render() explicitly once per
// frame (same place it used to call the old Canvas2D sprite-drawing code) so nothing
// gets a second, independently-drifting animation clock.
var PixiLayer = (function () {
  var app = null, world = null, ready = false, readyCbs = [], sheet = null;

  function init() {
    var view = document.getElementById("pixiGame");
    app = new PIXI.Application({
      view: view, width: W, height: W, backgroundAlpha: 0, antialias: false, resolution: 1
    });
    app.ticker.stop();
    world = new PIXI.Container();
    world.sortableChildren = true;   // actor-sprite.js sets container.zIndex = y for depth
    app.stage.addChild(world);

    PIXI.Assets.add({ alias: "gameAtlas", src: "assets/sprites/atlas.json" });
    PIXI.Assets.load("gameAtlas").then(function (loaded) {
      sheet = loaded; ready = true;
      readyCbs.forEach(function (cb) { cb(sheet); });
      readyCbs = [];
    }).catch(function (e) { console.error("PixiLayer: failed to load sprite atlas", e); });
  }

  // Calls cb(sheet) once the atlas has loaded — immediately if it already has.
  function onReady(cb) { if (ready) cb(sheet); else readyCbs.push(cb); }
  function render() { if (app) app.renderer.render(app.stage); }

  return {
    init: init, onReady: onReady, render: render,
    get app() { return app; }, get world() { return world; },
    get sheet() { return sheet; }, get isReady() { return ready; }
  };
})();
