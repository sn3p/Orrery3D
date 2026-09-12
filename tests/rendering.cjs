const assert = require("node:assert/strict");

const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});

exports.testPausedRendering = async page => {
  await page.evaluate(() => {
    const app = window.test.app;
    const probe = window.renderingProbe = { draws: 0, updates: 0, dates: [] };
    const draw = app.renderer.render.bind(app.renderer);
    const update = app.updateAsteroids.bind(app);
    app.renderer.render = (...args) => {
      probe.draws++; probe.dates.push(app.jed);
      return draw(...args);
    };
    app.updateAsteroids = () => { probe.updates++; return update(); };
  });
  const speed = page.getByRole("textbox", { name: "Playback speed" });
  const pause = async () => { await speed.fill("0"); await speed.press("Enter"); await settle(page); };
  const idle = async () => {
    const before = await page.evaluate(() => ({ draws: window.renderingProbe.draws,
      updates: window.renderingProbe.updates, jed: window.test.app.jed }));
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({ draws: window.renderingProbe.draws,
      updates: window.renderingProbe.updates, jed: window.test.app.jed }));
    assert.deepEqual(after, before, "Paused scene has no recurring draw, asteroid update or date change");
    assert.equal(await page.evaluate(() => window.test.app.animationFrame), null);
    assert.equal(await page.locator("#orrery-fps").textContent(), "0 FPS");
    return before;
  };
  await pause();
  const paused = await idle();
  await page.evaluate(() => {
    window.test.app.jed = window.test.REFERENCE_JED;
    for (let i = 0; i < 10; i++) window.test.app.requestRender();
  });
  await settle(page);
  assert.equal(await page.evaluate(() => window.renderingProbe.draws), paused.draws + 1,
    "Date changes and simultaneous requests coalesce into one draw");
  assert.equal(await page.locator("#orrery-count").textContent(), "100000");
  assert.equal(await page.locator("#orrery-date").textContent(), "2019-04-27");
  await idle();
  for (const value of ["1.5", "-1.5"]) {
    const before = await page.evaluate(() => ({ jed: window.test.app.jed, draws: window.renderingProbe.draws }));
    await speed.fill(value); await speed.press("Enter");
    await page.waitForFunction(draws => window.renderingProbe.draws >= draws + 3, before.draws);
    const after = await page.evaluate(draws => ({ jed: window.test.app.jed,
      first: window.renderingProbe.dates[draws] }), before.draws);
    assert.equal(after.first, before.jed, "First resumed frame excludes all paused time");
    assert(Number(value) > 0 ? after.jed > before.jed : after.jed < before.jed, "Playback resumes in selected direction");
    await pause(); await idle();
  }
  return { idleDraws: 0, coalescedDraws: 1, forwardAndReverse: "passed" };
};

exports.testManualRendering = async page => {
  const result = await page.evaluate(async () => {
    const { Orrery3D, catalog, REFERENCE_JED } = window.test;
    const app = new Orrery3D({ container: document.getElementById("orrery"), autoRender: false });
    const nextFrame = () => new Promise(requestAnimationFrame);
    let draws = 0;
    const draw = app.renderer.render.bind(app.renderer);
    app.renderer.render = (...args) => { draws++; return draw(...args); };
    try {
      app.setupAsteroids(catalog);
      app.jed = REFERENCE_JED;
      app.jedDelta = -1.5;
      app.controls.rotateLeft(0.1);
      app.controls.update();
      window.dispatchEvent(new Event("resize"));
      app.requestRender();
      await nextFrame(); await nextFrame();
      const automaticDraws = draws;
      app.render();
      await nextFrame(); await nextFrame();
      return { automaticDraws, explicitDraws: draws - automaticDraws,
        pendingFrame: app.animationFrame, points: app.renderer.info.render.points };
    } finally { app.dispose(); }
  });
  assert.equal(result.automaticDraws, 0, "Manual benchmark mode never schedules an app draw");
  assert.equal(result.explicitDraws, 1, "Explicit rendering does not start an animation loop");
  assert.equal(result.pendingFrame, null);
  assert.equal(result.points, 100000);
  return result;
};
