const assert = require("node:assert/strict");
const path = require("node:path");

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
      const result = draw(...args);
      if (probe.capture) probe.image = app.renderer.domElement.toDataURL();
      return result;
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

exports.testPausedLifecycle = async page => {
  await page.evaluate(() => window.test.app.setupAsteroids([]));
  await settle(page);
  assert.equal(await page.locator("#orrery-count").textContent(), "0", "Empty replacement repaints while paused");
  assert.equal(await page.evaluate(() => window.test.app.renderer.info.render.points), 0);
  await page.evaluate(() => window.test.app.setupAsteroids(window.test.catalog));
  await settle(page);
  assert.equal(await page.locator("#orrery-count").textContent(), "100000", "Replacement refreshes the paused readout");
  const invalid = await page.evaluate(() => {
    const { app } = window.test;
    let rejected = false;
    try { app.setupAsteroids([{ e: 2 }]); } catch { rejected = true; }
    return { rejected, pending: app.animationFrame, draws: window.renderingProbe.draws };
  });
  await settle(page);
  assert(invalid.rejected);
  assert.equal(invalid.pending, null);
  assert.equal(await page.evaluate(() => window.renderingProbe.draws), invalid.draws, "Invalid replacement preserves the idle working scene");

  const visibility = [];
  for (const speed of [0, 1.5]) {
    const hidden = await page.evaluate(speed => {
      const app = window.test.app;
      app.jedDelta = speed;
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      app.requestRender();
      return { jed: app.jed, draws: window.renderingProbe.draws, pending: app.animationFrame };
    }, speed);
    await page.waitForTimeout(150);
    const waiting = await page.evaluate(() => ({ jed: window.test.app.jed,
      draws: window.renderingProbe.draws, pending: window.test.app.animationFrame }));
    assert.deepEqual(waiting, hidden, "Hidden documents stop work even with a pending frame");
    assert.equal(hidden.pending, null);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForFunction(draws => window.renderingProbe.draws > draws, hidden.draws);
    assert.equal(await page.evaluate(draws => window.renderingProbe.dates[draws], hidden.draws), hidden.jed,
      "Visibility recovery's first frame excludes hidden time");
    await settle(page);
    if (!speed) assert.equal(await page.evaluate(() => window.renderingProbe.draws), hidden.draws + 1,
      "Paused visibility recovery draws only once");
    else assert(await page.evaluate(jed => window.test.app.jed > jed, hidden.jed), "Running playback restarts after visibility recovery");
    visibility.push({ speed, firstFrameJed: hidden.jed });
    await page.evaluate(() => { window.test.app.jedDelta = 0; });
    await settle(page);
  }

  // The same speed property is written by the dat.gui pointer slider.
  const slider = page.locator(".dg .slider");
  const bounds = await slider.boundingBox();
  await slider.click({ position: { x: bounds.width * 0.7, y: bounds.height / 2 } });
  await page.waitForFunction(() => window.test.app.jedDelta > 0 && window.test.app.animationFrame !== null);
  const input = page.getByRole("textbox", { name: "Playback speed" });
  await input.fill("0");
  assert(await input.evaluate(element => element === document.activeElement), "Speed remains keyboard accessible");
  await input.press("Enter");
  await settle(page);
  assert.equal(await page.evaluate(() => window.test.app.animationFrame), null);
  return { replacement: "passed", visibility, sliderAndKeyboard: "passed" };
};

exports.testPausedLoading = async (page, url) => {
  // Keep the real fetch pending until the user has paused the initial scene.
  let release;
  const response = new Promise(resolve => { release = resolve; });
  await page.route("**/data/catalog.json", async route => { await response; await route.continue(); });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const speed = page.getByRole("textbox", { name: "Playback speed" });
    await speed.fill("0"); await speed.press("Enter");
    await settle(page);
    assert.match(await page.locator("#orrery-status").textContent(), /Loading/);
    const date = await page.locator("#orrery-date").textContent();
    release();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    assert(await page.locator("#orrery-status").isHidden());
    assert.equal(await page.locator("#orrery-date").textContent(), date, "Catalogue arriving after pause keeps its date");
    assert.equal(await page.locator("#orrery-fps").textContent(), "0 FPS");
  } finally { release(); await page.unroute("**/data/catalog.json"); }
};

exports.testRunningContextRecovery = async page => {
  await page.evaluate(() => {
    window.renderingProbe.capture = false;
    window.test.app.jedDelta = -1.5;
  });
  await settle(page);
  await page.evaluate(() => window.test.app.renderer.forceContextLoss());
  await page.waitForFunction(() => window.test.app.contextLost);
  const lost = await page.evaluate(() => ({ jed: window.test.app.jed,
    draws: window.renderingProbe.draws, pending: window.test.app.animationFrame }));
  await page.waitForTimeout(150);
  assert.equal(lost.pending, null);
  assert.equal(await page.evaluate(() => window.renderingProbe.draws), lost.draws);
  await page.evaluate(() => window.test.app.renderer.forceContextRestore());
  await page.waitForFunction(draws => !window.test.app.contextLost && window.renderingProbe.draws >= draws + 3, lost.draws);
  assert.equal(await page.evaluate(draws => window.renderingProbe.dates[draws], lost.draws), lost.jed,
    "First automatically resumed frame excludes graphics downtime");
  assert(await page.evaluate(jed => window.test.app.jed < jed, lost.jed), "Reverse playback automatically continues after recovery");
  await page.evaluate(() => { window.test.app.jedDelta = 0; });
  await settle(page);
  assert.equal(await page.evaluate(() => window.test.app.animationFrame), null);
  return "automatic restart and first-frame timestamp passed";
};

exports.testProductionInteractions = async (browser, url, output, name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, hasTouch: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(url);
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    const speed = page.getByRole("textbox", { name: "Playback speed" });
    await speed.fill("0"); await speed.press("Enter");
    await settle(page);
    // Count actual WebGL submissions in the production build, without its test API.
    await page.evaluate(() => {
      window.productionDraws = 0;
      const gl = document.querySelector("canvas").getContext("webgl2");
      for (const method of ["drawArrays", "drawElements"]) {
        const original = gl[method].bind(gl);
        gl[method] = (...args) => { window.productionDraws++; return original(...args); };
      }
    });
    const checkIdle = async () => {
      await settle(page);
      const draws = await page.evaluate(() => window.productionDraws);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.productionDraws), draws, "Production stops all idle WebGL submissions");
      assert.equal(await page.locator("#orrery-fps").textContent(), "0 FPS");
    };
    await checkIdle();
    const date = await page.locator("#orrery-date").textContent();
    await speed.fill("1.5"); await speed.press("Enter");
    await page.waitForFunction(date => document.querySelector("#orrery-date").textContent > date, date);
    await page.waitForFunction(() => parseInt(document.querySelector("#orrery-fps").textContent) > 0);
    await speed.fill("0"); await speed.press("Enter");
    await checkIdle();
    await page.screenshot({ path: path.join(output, `${name}-paused-production-desktop.png`) });
    const canvas = page.locator("canvas");
    let previous = await canvas.screenshot();
    for (const button of ["left", "right"]) {
      await page.mouse.move(600, 400); await page.mouse.down({ button });
      await page.mouse.move(720, 460, { steps: 8 }); await page.mouse.up({ button });
      await checkIdle();
      const current = await canvas.screenshot();
      assert(!previous.equals(current), `Production paused camera ${button === "left" ? "rotation" : "pan"} repaints`);
      previous = current;
    }
    await page.mouse.wheel(0, -250);
    await checkIdle();
    assert(!previous.equals(await canvas.screenshot()), "Production paused camera zoom repaints");
    const beforeResize = await page.evaluate(() => window.productionDraws);
    await page.setViewportSize({ width: 390, height: 844 });
    await checkIdle();
    assert(await page.evaluate(draws => window.productionDraws > draws, beforeResize), "Retina resize automatically repaints before any camera interaction");
    assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [780, 1688], "Retina resize updates drawing buffer");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    const bounds = await speed.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    await page.screenshot({ path: path.join(output, `${name}-paused-production-resized.png`) });
    if (name === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      for (const fingers of [1, 2]) {
        previous = await canvas.screenshot();
        const points = step => fingers === 1
          ? [{ x: 130 + step * 12, y: 400 + step * 5, id: 1 }]
          : [{ x: 100 - step * 3, y: 400, id: 1 }, { x: 220 + step * 6, y: 400, id: 2 }];
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(0) });
        for (let step = 1; step <= 6; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(step) });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await checkIdle();
        assert(!previous.equals(await canvas.screenshot()), `Paused ${fingers}-finger gesture repaints`);
      }
      await cdp.detach();
    }
    await page.screenshot({ path: path.join(output, `${name}-paused-production-narrow.png`) });
    assert.deepEqual(errors, []);
    return { idleDraws: 0, desktopAndRetinaNarrow: "passed", rotationPanZoom: "passed",
      touch: name === "chromium" ? "native one/two-finger input passed" : "not exercised" };
  } finally { await page.close(); }
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
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
      const canvas = app.renderer.domElement;
      if (app.renderer.getContext().getExtension("WEBGL_lose_context")) {
        const event = type => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Manual renderer did not emit ${type}`)), 5000);
          canvas.addEventListener(type, () => { clearTimeout(timeout); resolve(); }, { once: true });
        });
        const lost = event("webglcontextlost");
        app.renderer.forceContextLoss(); await lost;
        // Restore after the loss event dispatch (including Three's preventDefault).
        await new Promise(resolve => setTimeout(resolve, 100));
        const restored = event("webglcontextrestored");
        app.renderer.forceContextRestore(); await restored;
      }
      await nextFrame(); await nextFrame();
      const automaticDraws = draws;
      app.render();
      await nextFrame(); await nextFrame();
      const result = { automaticDraws, explicitDraws: draws - automaticDraws,
        pendingFrame: app.animationFrame, points: app.renderer.info.render.points };
      app.autoRender = true;
      app.jedDelta = 0;
      app.requestRender();
      app.dispose();
      // Queued frames, a late fetch result and stale callers must not revive it.
      app.setupAsteroids(catalog);
      app.jed += 1;
      app.jedDelta = 1;
      app.controls.dispatchEvent({ type: "change" });
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new Event("visibilitychange"));
      await nextFrame(); await nextFrame();
      result.drawsAfterDisposal = draws - automaticDraws - result.explicitDraws;
      result.pendingAfterDisposal = app.animationFrame;
      return result;
    } finally { app.dispose(); }
  });
  assert.equal(result.automaticDraws, 0, "Manual benchmark mode never schedules an app draw");
  assert.equal(result.explicitDraws, 1, "Explicit rendering does not start an animation loop");
  assert.equal(result.pendingFrame, null);
  assert.equal(result.points, 100000);
  assert.equal(result.drawsAfterDisposal, 0);
  assert.equal(result.pendingAfterDisposal, null);
  return result;
};
