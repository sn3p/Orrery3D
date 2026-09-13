const assert = require("node:assert/strict");

const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
});
const buffer = page => page.evaluate(() => {
  const canvas = document.querySelector("canvas"), gl = canvas.getContext("webgl2");
  return { nativeDpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
    canvas: [canvas.width, canvas.height], drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
});
const checkBuffer = async (page, dpr, width, height) => {
  // Production selected 2×: lower-resolution displays fall back to 1×.
  const effective = dpr >= 2 ? 2 : Math.min(1, dpr);
  assert.deepEqual(await buffer(page), { nativeDpr: dpr, viewport: [width, height],
    canvas: [width * effective, height * effective], drawingBuffer: [width * effective, height * effective] });
};

// CDP changes DPR and query.matches, but Chrome does not dispatch the native
// MediaQueryList change event for this emulation. Deliver that event at the
// real browser listener boundary; do not call app.resize()/its DPR handler.
exports.installDprProbe = page => page.addInitScript(() => {
  const match = window.matchMedia.bind(window);
  window.dpiQueries = new Map();
  window.matchMedia = query => {
    const result = match(query);
    window.dpiQueries.set(result, result.matches);
    return result;
  };
});
const deliverDprChanges = exports.deliverDprChanges = page => page.evaluate(() => {
  for (const [query, previous] of [...window.dpiQueries]) {
    if (query.matches === previous) continue;
    window.dpiQueries.set(query, query.matches);
    query.dispatchEvent(new MediaQueryListEvent("change", { matches: query.matches, media: query.media }));
  }
});

exports.testProductionDpr = async (page, name) => {
  // The caller has paused the actual production app and counts real GL draws.
  if (name !== "chromium") return "DPR2 resize covered; live DPR transitions require CDP";
  const cdp = await page.context().newCDPSession(page);
  const viewport = page.viewportSize();
  const speed = page.getByRole("textbox", { name: "Playback speed" });
  await page.evaluate(() => {
    window.dpiResizeEvents = 0;
    window.addEventListener("resize", () => window.dpiResizeEvents++);
  });
  const changeDpr = async dpr => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: dpr, mobile: false });
    await deliverDprChanges(page);
    await settle(page);
    await checkBuffer(page, dpr, viewport.width, viewport.height);
  };
  const idle = async () => {
    const draws = await page.evaluate(() => window.productionDraws);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.productionDraws), draws, "DPR change does not start recurring paused draws");
  };
  const date = await page.locator("#orrery-date").textContent();
  try {
    for (const dpr of [1, 3, 2, 1.5, 2]) {
      const before = await page.evaluate(() => window.productionDraws);
      await changeDpr(dpr);
      assert(await page.evaluate(before => window.productionDraws > before, before), "DPR-only change repaints the paused app");
      assert.equal(await page.locator("#orrery-date").textContent(), date);
      await idle();
    }
    assert.equal(await page.evaluate(() => window.dpiResizeEvents), 0, "Transitions exercised DPR changes without resize events");
    // A hidden paused app must adopt the new resolution on resume, then settle.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenDraws = await page.evaluate(() => window.productionDraws);
    await changeDpr(3);
    assert.equal(await page.evaluate(() => window.productionDraws), hiddenDraws);
    await page.evaluate(() => {
      delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle(page); await idle();
    assert(await page.evaluate(n => window.productionDraws > n, hiddenDraws));
    // Context restoration retains the current backing resolution and idle policy.
    const lostDate = await page.locator("#orrery-date").textContent();
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      window.dpiContextLost = new Promise(resolve => canvas.addEventListener("webglcontextlost", resolve, { once: true }));
      window.dpiContextRestored = new Promise(resolve => canvas.addEventListener("webglcontextrestored", resolve, { once: true }));
      window.dpiLoseExtension = canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
      window.dpiLoseExtension.loseContext();
    });
    await page.evaluate(() => window.dpiContextLost.then(() => true));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.dpiLoseExtension.restoreContext());
    await page.evaluate(() => window.dpiContextRestored.then(() => true));
    await settle(page); await checkBuffer(page, 3, viewport.width, viewport.height); await idle();
    assert.equal(await page.locator("#orrery-date").textContent(), lostDate);
    for (const value of ["1.5", "-1.5"]) {
      await speed.fill(value); await speed.press("Enter");
      const before = await page.locator("#orrery-date").textContent();
      await changeDpr(value === "1.5" ? 1 : 2);
      await page.waitForFunction(({ before, forward }) => forward
        ? document.querySelector("#orrery-date").textContent > before
        : document.querySelector("#orrery-date").textContent < before, { before, forward: value === "1.5" });
      await speed.fill("0"); await speed.press("Enter"); await settle(page); await idle();
    }
    return "CDP DPR1/2/3/fractional with delivered media events; pause/forward/reverse, hidden/resume and context recovery passed";
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride"); await cdp.detach(); await settle(page);
  }
};

exports.testBenchmarkDpr = async (page, name) => {
  const resolutions = [];
  for (const dpr of [1, 2, 3]) {
    const result = await page.evaluate(dpr => window.benchmark.measure({ count: 10000, dpr, warmup: 1, frames: 3, step: 0 }), dpr);
    const actual = await buffer(page);
    assert.deepEqual(actual.drawingBuffer, [800 * dpr, 600 * dpr]);
    assert.equal(result.resolution.rendererDpr, dpr);
    assert.equal(result.resolution.nativeDpr, 2);
    assert.deepEqual(result.resolution.drawingBuffer, actual.drawingBuffer);
    assert.deepEqual(result.resolution.effectiveDpr, [dpr, dpr]);
    resolutions.push(result.resolution);
  }
  const mutated = await page.evaluate(async () => {
    const result = window.benchmark.measure({ count: 10000, dpr: 1, warmup: 0, frames: 3 })
      .then(() => "accepted", error => error.message);
    document.querySelector("canvas").width += 1;
    return result;
  });
  assert.match(mutated, /interrupted/i, "Reject a drawing-buffer change without a resize event");
  if (name === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    try {
      // Explicit DPR1 is valid on native DPR2. Changing only native DPR mid-run
      // must invalidate it even if the renderer/buffer were to remain at DPR1.
      await page.evaluate(() => {
        window.dpiResizeEvents = 0;
        window.addEventListener("resize", () => window.dpiResizeEvents++);
        window.dpiResult = window.benchmark.measure({ count: 10000, dpr: 1, warmup: 0, frames: 120 })
          .then(() => "accepted", error => error.message);
      });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 3, mobile: false });
      assert.match(await page.evaluate(() => window.dpiResult), /interrupted/i);
      assert.equal(await page.evaluate(() => window.dpiResizeEvents), 0);
      const recovery = await page.evaluate(() => window.benchmark.measure({ count: 10000, dpr: 1, warmup: 1, frames: 3 }));
      assert.equal(recovery.resolution.nativeDpr, 3); assert.equal(recovery.resolution.rendererDpr, 1);
      assert.deepEqual(recovery.resolution.drawingBuffer, [800, 600]);
    } finally { await cdp.send("Emulation.clearDeviceMetricsOverride"); await cdp.detach(); await settle(page); }
  }
  return { resolutions, dprOnlyInterruption: name === "chromium" ? "passed" : "requires CDP" };
};
