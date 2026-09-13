const assert = require("node:assert/strict");

exports.testSharedFrames = async page => {
  const result = await page.evaluate(() => {
    const { app, REFERENCE_JED } = window.test;
    const saved = { jed: app.jed, speed: app.jedDelta, autoRender: app.autoRender };
    const originals = [];
    const events = [];
    const wrap = (object, key, label) => {
      const original = object[key];
      originals.push(() => { object[key] = original; });
      object[key] = function(...args) { events.push(label); return original.apply(this, args); };
    };
    let image;
    const draw = app.renderer.render;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    try {
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
      wrap(app, "renderFrame", "frame");
      wrap(app, "updateAsteroids", "asteroids");
      app.planets.forEach(planet => wrap(planet, "render", "planet"));
      app.renderer.render = function(...args) {
        events.push("draw");
        const result = draw.apply(this, args);
        image = this.domElement.toDataURL();
        return result;
      };
      wrap(app.gui.stats, "reset", "fps");
      wrap(app.gui, "update", "gui");
      app.jed = REFERENCE_JED;
      app.render(0);
      const automatic = { events: [...events], image, positions: app.planets.map(p => p.body.position.toArray()),
        count: app.asteroidsDiscovered, date: document.getElementById("orrery-date").textContent };
      events.length = 0;
      let cutoff;
      app.renderFrame(REFERENCE_JED, {
        afterAsteroids: () => { cutoff = [...events]; },
        beforeRender: () => { events.push("beforeDraw"); },
        afterRender: () => { events.push("afterDraw"); },
      });
      const manual = { events: [...events], image, positions: app.planets.map(p => p.body.position.toArray()),
        count: app.asteroidsDiscovered, date: document.getElementById("orrery-date").textContent };
      check(JSON.stringify(cutoff) === JSON.stringify(["frame", "asteroids"]), "Asteroid timing excludes planets/draw/GUI");
      const drawIndex = events.indexOf("draw");
      check(events[drawIndex - 1] === "beforeDraw" && events[drawIndex + 1] === "afterDraw", "GPU timing brackets only drawing");
      check(events.indexOf("fps") > events.indexOf("afterDraw") && events.at(-1) === "gui", "Current-frame FPS reaches GUI after timed drawing");
      check(automatic.events[0] === "frame", "Production render uses the shared frame operation");
      check(app.animationFrame === null, "Explicit frames do not schedule playback");
      // Even with automatic scheduling enabled, explicit-date rendering owns no RAF or clock.
      app.autoRender = true;
      const clock = JSON.stringify(app.clock);
      app.renderFrame(REFERENCE_JED - 1);
      check(app.animationFrame === null && JSON.stringify(app.clock) === clock, "Explicit frame does not invalidate or advance the clock");
      events.length = 0;
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      app.renderFrame(REFERENCE_JED + 1);
      delete document.hidden;
      check(events.join() === "frame" && app.jed === REFERENCE_JED - 1, "Hidden explicit frame has no scene/date effects");
      events.length = 0;
      app.contextLost = true;
      app.renderFrame(REFERENCE_JED + 1);
      app.contextLost = false;
      check(events.join() === "frame" && app.jed === REFERENCE_JED - 1, "Lost context prevents explicit scene/date updates");
      return { automatic, manual };
    } finally {
      delete document.hidden;
      app.contextLost = false;
      originals.reverse().forEach(restore => restore());
      app.renderer.render = draw;
      app.autoRender = false; app.jed = saved.jed; app.jedDelta = saved.speed;
      app.autoRender = saved.autoRender; app.resetClock(); app.render();
    }
  });
  assert.deepEqual(result.manual.events.filter(event => !["beforeDraw", "afterDraw"].includes(event)), result.automatic.events);
  assert.equal(result.manual.image, result.automatic.image, "Explicit and playback frames render identical pixels");
  assert.deepEqual(result.manual.positions, result.automatic.positions);
  assert.equal(result.manual.count, result.automatic.count);
  assert.equal(result.manual.date, result.automatic.date);
  return { matchingPixelsAndState: true, timingBoundaries: "passed", schedulerIsolation: "passed" };
};

exports.testFps = async page => page.evaluate(() => {
  const { app } = window.test;
  const stats = app.gui.stats;
  const saved = { performance: stats.performance, speed: app.jedDelta, jed: app.jed, autoRender: app.autoRender };
  let now = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const readout = () => document.getElementById("orrery-fps").textContent;
  try {
    app.autoRender = false; app.cancelRender(); app.jedDelta = 1.5;
    stats.performance = { now: () => now };
    app.resetClock();
    app.render(0);
    now = 1000; app.render(1000);
    check(stats.frames === 2 && stats.fps === 0 && readout() === "0 FPS", "Sampling window stays open at exactly one second");
    now = 1001; app.render(1001);
    check(stats.frames === 0 && stats.fps === 3 && readout() === "3 FPS", "Rounded FPS counts each completed frame and updates the same readout");
    now = 2002; app.render(2002);
    check(stats.fps === 1 && readout() === "1 FPS", "Completed sample starts a fresh window");
    app.jedDelta = 0; app.render(3000);
    check(stats.frames === 0 && stats.fps === 0 && readout() === "0 FPS", "Paused app clears FPS");
    now = 9000; app.jedDelta = -1.5; app.render(9000);
    check(stats.frames === 1 && stats.fps === 0, "Resume excludes idle wall time");
    now = 10001; app.render(10001);
    check(stats.fps === 2 && readout() === "2 FPS", "Reverse playback counts completed frames");
    app.jedDelta = 0;
    now = 20000; stats.reset();
    app.renderFrame(app.jed, { trackFps: true });
    now = 21001; app.renderFrame(app.jed, { trackFps: true });
    check(stats.fps === 2 && readout() === "2 FPS", "Finite benchmark draws can count FPS at a fixed date");
    return { sampleBoundaryAndRounding: "passed", pauseResumeReverse: "passed", sameFrameReadout: "passed" };
  } finally {
    stats.performance = saved.performance;
    app.jed = saved.jed; app.jedDelta = saved.speed; app.autoRender = saved.autoRender;
    app.resetClock(); app.render();
  }
});

exports.testGuiDisposal = async page => page.evaluate(() => {
  const { app } = window.test;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const direct = new app.gui.constructor(app);
  const controls = direct.gui.domElement;
  let destroys = 0;
  const destroy = direct.gui.destroy.bind(direct.gui);
  direct.gui.destroy = () => { destroys++; destroy(); };
  direct.hide();
  check(getComputedStyle(controls).display === "none", "GUI owns benchmark hiding");
  direct.dispose(); direct.dispose();
  check(destroys === 1 && !controls.isConnected, "GUI disposal is idempotent and removes controls");
  let disposals = 0;
  const dispose = app.gui.dispose.bind(app.gui);
  app.gui.dispose = () => { disposals++; dispose(); };
  app.requestRender();
  app.dispose(); app.dispose();
  check(disposals === 1 && app.animationFrame === null, "App delegates GUI disposal once and cancels pending work");
  let draws = 0;
  app.renderer.render = () => { draws++; };
  app.renderFrame(); app.render();
  check(draws === 0 && !document.querySelector("canvas, .dg.main"), "Disposed app cannot draw or leave controls");
  return { directDisposals: destroys, appDisposals: disposals, drawsAfterDispose: draws };
});
