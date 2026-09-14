const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const cases = require("./fixtures/consumer-v1/cases.json");
const states = require("./fixtures/consumer-v1/loader-cases.json");
const { buildTrial } = require("../scripts/catalog.cjs");
const fixture = path.join(__dirname, "fixtures/consumer-v1");
const tie = states.cases.find(item => item.id === "tie-gap-and-graphics-commit");

async function build(output) {
  await fs.mkdir(output, { recursive: true });
  await fs.cp(fixture, path.join(output, "catalog-fixtures"), { recursive: true });
  for (const mode of ["indexed", "whole"]) {
    const configPath = path.join(output, "catalog-" + mode + ".json");
    await fs.writeFile(configPath, JSON.stringify({ bundle: path.join(fixture, "ties"), pin: cases.bundles.ties.pin,
      mode, speed: 0, startJed: tie.through }));
    await buildTrial(configPath, path.join(output, "catalog-" + mode), { entry: "./tests/catalog-browser.js" });
  }
}

function instrument() {
  window.catalogProbe = { uploads: [], raw: [] };
  const parse = JSON.parse;
  JSON.parse = function(...args) {
    const result = parse.apply(this, args);
    if (Array.isArray(result) && result[0] && Object.hasOwn(result[0], "disc")) {
      window.catalogProbe.raw.push(new WeakRef(result), new WeakRef(result[0]));
    }
    return result;
  };
  for (const operation of ["bufferData", "bufferSubData"]) {
    const original = WebGL2RenderingContext.prototype[operation];
    WebGL2RenderingContext.prototype[operation] = function(...args) {
      const array = args[operation === "bufferData" ? 1 : 2];
      const attributes = window.catalogTest?.app.asteroids?.geometry.attributes ?? {};
      for (const [name, attribute] of Object.entries(attributes)) {
        if (array === attribute.array) window.catalogProbe.uploads.push({ operation, name, bytes: array.byteLength,
          offset: operation === "bufferSubData" ? args[1] : 0, sourceOffset: args[3], length: args[4] });
      }
      return original.apply(this, args);
    };
  }
}

async function run(browser, base, output, name) {
  const results = [];
  for (const mode of ["indexed", "whole"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
    await page.addInitScript(instrument);
    const url = base + "/catalog-" + mode + "/";
    const firstFile = mode === "whole" ? "full/catalog.json" : "chunks/000000.json";
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    await page.route("**/" + firstFile, async route => { await firstGate; await route.continue().catch(() => {}); });
    try {
      await page.goto(url);
      await page.evaluate(() => window.catalogReady);
      await page.evaluate(() => { const app = window.catalogTest.app; app.autoRender = false; app.cancelRender(); });
      if (mode === "indexed") {
        await page.waitForFunction(() => performance.getEntriesByName("catalog:parse-validate").length === 1);
        assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.committedCount), 0, "Later verified file cannot cross prefix gap");
      }
      assert.equal(await page.locator("#orrery-count").textContent(), "0");
      assert.match(await page.locator("#orrery-status").textContent(), /Loading/);
      assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.sceneComplete()), false);
      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await page.locator("#orrery-status").boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await page.screenshot({ path: path.join(output, name + "-" + mode + "-loading.png") });
      // The actual production clock waits five wall seconds without advancing.
      assert.deepEqual(await page.evaluate(() => {
        const app = window.catalogTest.app, before = app.jed;
        app.jedDelta = 1.5;
        app.render(1000); app.render(6000);
        return [app.jed - before, app.jedDelta];
      }), [0, 1.5]);
      releaseFirst();
      await page.waitForFunction(required => window.catalogTest.app.catalogLoader.committedCount >= required, tie.requiredEnd);
      assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.sceneComplete()), false, "CPU preparation precedes graphics commitment");
      await page.setViewportSize({ width: 1280, height: 800 });
      const reset = await page.evaluate(() => {
        const app = window.catalogTest.app, before = app.jed;
        app.render(6000);
        const afterReset = app.jed;
        const visible = app.asteroidsDiscovered, complete = app.catalogLoader.sceneComplete();
        app.render(6100); app.jedDelta = 0;
        return { afterReset: afterReset - before, advance: app.jed - afterReset, visible, complete };
      });
      assert.deepEqual(reset, { afterReset: 0, advance: 9, visible: 4, complete: true });
      const duplicate = await page.evaluate(async () => {
        const app = window.catalogTest.app, loader = app.catalogLoader;
        const [event] = await Array.fromAsync(loader.source.read({ start: 0, end: 2 }));
        const count = loader.committedCount;
        return { accepted: loader.accept(event, loader.generation), count, after: loader.committedCount };
      });
      assert(!duplicate.accepted); assert.equal(duplicate.after, duplicate.count);
      await page.unroute("**/" + firstFile);
      await page.waitForFunction(() => !window.catalogTest.app.catalogLoader.request);

      // Explicit late jump, full commitment, reverse and committed-only rebase.
      await page.evaluate(() => { const app = window.catalogTest.app; app.jed = 9999999; app.renderFrame(); });
      await page.waitForFunction(() => window.catalogTest.app.catalogLoader.committedCount === 6);
      await page.evaluate(() => window.catalogTest.app.renderFrame());
      await page.waitForFunction(() => window.catalogTest.app.asteroidsDiscovered === 6);
      const packed = await page.evaluate(async () => {
        const { app, prepareCatalogue } = window.catalogTest;
        const response = await fetch(new URL("data/delivery-v1-" + app.catalogLoader.source.sourceId + "/full/catalog.json", location.href));
        const rows = await response.json(), reference = prepareCatalogue(rows, app.asteroids.epoch);
        const pairs = { position: "p", basisQ: "q", elements: "elements", meanAnomaly: "meanAnomalies", discovery: "discovery" };
        const match = Object.entries(pairs).every(([name, key]) => app.asteroids.geometry.attributes[name].array
          .every((value, i) => value === reference[key][i]));
        return { match, capacity: app.asteroids.discoveryDates.length, committed: app.asteroids.committedCount,
          slots: app.catalogLoader.source.slots.active };
      });
      assert.deepEqual(packed, { match: true, capacity: 6, committed: 6, slots: 0 });
      await page.evaluate(date => { const app = window.catalogTest.app; app.jed = date; app.renderFrame(); app.autoRender = true; }, tie.through);
      await page.waitForFunction(() => window.catalogTest.app.asteroidsDiscovered === 4);
      assert(await page.locator("#orrery-status").isHidden());
      await require("./options.cjs").openOptions(page);
      const speed = page.getByRole("textbox", { name: "Playback speed" });
      await speed.focus(); await speed.fill("0"); await speed.press("Enter");
      await page.screenshot({ path: path.join(output, name + "-" + mode + "-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await require("./options.cjs").openOptions(page);
      const speedBox = await speed.boundingBox();
      assert(speedBox.x >= 0 && speedBox.x + speedBox.width <= 390);
      await page.screenshot({ path: path.join(output, name + "-" + mode + "-narrow.png") });

      if (name === "chromium") {
        const session = await page.context().newCDPSession(page);
        await session.send("HeapProfiler.collectGarbage");
        assert.equal(await page.evaluate(() => window.catalogProbe.raw.some(ref => ref.deref())), false, "Raw payload arrays and rows are collectible");
        await session.detach();
      }
      const before = await page.locator("canvas").screenshot();
      const supported = await page.evaluate(() => !!window.catalogTest.app.renderer.getContext().getExtension("WEBGL_lose_context"));
      if (supported) {
        await page.evaluate(() => window.catalogTest.app.renderer.forceContextLoss());
        await page.waitForFunction(() => window.catalogTest.app.contextLost);
        assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.sceneComplete()), false);
        await page.evaluate(() => window.catalogTest.app.renderer.forceContextRestore());
        await page.waitForFunction(() => !window.catalogTest.app.contextLost && window.catalogTest.app.catalogLoader.sceneComplete());
        assert(before.equals(await page.locator("canvas").screenshot()), "Actual graphics restoration preserves reverse-date pixels");
      }
      const replacement = await page.evaluate(async ({ pin, base }) => {
        const app = window.catalogTest.app, source = app.catalogLoader.source;
        const generation = app.catalogLoader.generation;
        const [old] = await Array.fromAsync(source.read({ start: 0, end: 2 }));
        await app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/empty/index.json" }, { mode: source.mode });
        const accepted = app.catalogLoader.accept(old, generation);
        app.renderFrame();
        let closed = false;
        try { await Array.fromAsync(source.read({ start: 0, end: 2 })); } catch { closed = true; }
        source.close(); source.close();
        return { accepted, closed, count: app.asteroidsDiscovered, complete: app.catalogLoader.sceneComplete() };
      }, { pin: cases.bundles.empty.pin, base });
      assert.deepEqual(replacement, { accepted: false, closed: true, count: 0, complete: true });
      await page.evaluate(() => { const app = window.catalogTest.app; app.dispose(); app.dispose(); });
      assert.equal(await page.locator("canvas, .orrery-options").count(), 0);
      await page.reload();
      await page.waitForFunction(() => window.catalogTest?.app.catalogLoader.sceneComplete());
      assert.equal(await page.locator("#orrery-count").textContent(), "4");
      assert.deepEqual(errors, []);
      results.push({ mode, reset, packed, graphicsRecovery: supported, producerStates: states.cases.map(item => item.id) });
    } finally { releaseFirst(); await page.close(); }
  }

  // Retry/failure/reload at the actual fetch boundary, with native status UI.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    let attempts = 0;
    await page.route("**/chunks/000001.json", route => ++attempts === 1
      ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
    await page.goto(base + "/catalog-indexed/");
    await page.waitForFunction(() => window.catalogTest?.app.catalogLoader.sceneComplete());
    assert.equal(attempts, 2);
    await page.unroute("**/chunks/000001.json");
    attempts = 0;
    await page.route("**/chunks/000001.json", route => { attempts++; return route.fulfill({ status: 404, body: "missing" }); });
    await page.reload();
    await page.getByRole("alert").waitFor();
    assert.equal(attempts, 3, "Retries are bounded");
    assert.equal(await page.locator("#orrery-count").textContent(), "0", "A partial tie is never shown complete");
    assert.match(await page.getByRole("alert").textContent(), /Reload/);
    const box = await page.getByRole("alert").boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({ path: path.join(output, name + "-catalog-error.png") });
    await page.unroute("**/chunks/000001.json");
    await page.reload();
    await page.waitForFunction(() => window.catalogTest?.app.catalogLoader.sceneComplete());
    assert.equal(await page.locator("#orrery-count").textContent(), "4");
  } finally { await page.close(); }

  // Switching away from in-flight work, allocation failure, then native recovery.
  const lifecycle = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let release;
  try {
    const gate = new Promise(resolve => { release = resolve; });
    await lifecycle.route("**/chunks/*.json", async route => { await gate; await route.continue().catch(() => {}); });
    await lifecycle.goto(base + "/catalog-indexed/");
    await lifecycle.evaluate(() => window.catalogReady);
    const native = await lifecycle.evaluate(async ({ pin, tiesPin, base }) => {
      const app = window.catalogTest.app;
      const source = app.catalogLoader.source, generation = app.catalogLoader.generation;
      await app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/empty/index.json" });
      app.renderFrame();
      const emptyComplete = app.catalogLoader.sceneComplete();
      const response = await fetch(base + "/catalog-fixtures/ties/full/catalog.json");
      const rows = await response.json();
      // Reload a real pending trial, then replace it through the renderer setup API.
      await app.loadCatalog({ ...tiesPin, url: base + "/catalog-fixtures/ties/index.json" });
      app.autoRender = false; app.cancelRender();
      app.setupAsteroids(rows);
      app.jedDelta = 1.5;
      const start = app.jed;
      app.render(1000); app.render(1100);
      return { emptyComplete, oldClosed: source.closed, changedGeneration: app.catalogLoader.generation > generation,
        advance: app.jed - start, waiting: app.catalogWaiting, count: app.asteroidsDiscovered };
    }, { pin: cases.bundles.empty.pin, tiesPin: cases.bundles.ties.pin, base });
    assert(native.emptyComplete && native.oldClosed && native.changedGeneration);
    assert.equal(native.advance, 9); assert.equal(native.waiting, false); assert.equal(native.count, 4);
    release();
    await lifecycle.unroute("**/chunks/*.json");
    const activation = await lifecycle.evaluate(async ({ pin, base }) => {
      const app = window.catalogTest.app, install = app.installAsteroids;
      app.installAsteroids = () => { throw new Error("Controlled allocation failure"); };
      let message;
      try { await app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/ties/index.json" }); }
      catch (error) { message = error.message; }
      app.installAsteroids = install;
      return { message, status: app.statusMessage, source: !!app.catalogLoader.source };
    }, { pin: cases.bundles.ties.pin, base });
    assert.equal(activation.message, "Controlled allocation failure");
    assert.equal(activation.source, false);
    assert.match(activation.status, /Could not load/);
    await lifecycle.evaluate(async ({ pin, base }) => {
      await window.catalogTest.app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/ties/index.json" });
      window.catalogTest.app.autoRender = true;
      window.catalogTest.app.jedDelta = 0;
      window.catalogTest.app.requestRender();
    }, { pin: cases.bundles.ties.pin, base });
    await lifecycle.waitForFunction(() => window.catalogTest.app.catalogLoader.sceneComplete());
  } finally { release?.(); await lifecycle.close(); }

  const failedShader = await browser.newPage();
  try {
    await failedShader.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.shaderSource;
      WebGL2RenderingContext.prototype.shaderSource = function(shader, source) {
        return original.call(this, shader, source.includes("vec3 orbitPosition")
          ? source + "\ncontrolled_invalid_shader_token;\n" : source);
      };
    });
    await failedShader.goto(base + "/catalog-indexed/");
    await failedShader.getByRole("alert").waitFor();
    await failedShader.evaluate(() => window.catalogReady);
    await failedShader.waitForFunction(() => !window.catalogTest.app.catalogLoader.request);
    assert.match(await failedShader.getByRole("alert").textContent(), /Unable to render/);
    assert.equal(await failedShader.evaluate(() => window.catalogTest.app.catalogLoader.sceneComplete()), false);
    assert.equal(await failedShader.evaluate(() => performance.getEntriesByName("catalog:first-complete").length), 0);
  } finally { await failedShader.close(); }

  const prefetch = await browser.newPage();
  let releaseLookahead;
  try {
    let requests = 0;
    const gate = new Promise(resolve => { releaseLookahead = resolve; });
    await prefetch.route("**/chunks/000002.json", async route => {
      requests++; await gate; await route.continue().catch(() => {});
    });
    await prefetch.goto(base + "/catalog-indexed/");
    await prefetch.waitForFunction(() => window.catalogTest?.app.catalogLoader.sceneComplete());
    assert.equal(requests, 0, "Paused initial population does not trigger lookahead");
    for (const pause of ["speed", "hidden"]) {
      await prefetch.evaluate(() => { window.catalogTest.app.jedDelta = 1.5; });
      await prefetch.waitForFunction(() => !!window.catalogTest.app.catalogLoader.request);
      if (pause === "speed") await prefetch.evaluate(() => { window.catalogTest.app.jedDelta = 0; });
      else await prefetch.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await prefetch.waitForFunction(() => !window.catalogTest.app.catalogLoader.request
        && window.catalogTest.app.catalogLoader.source.slots.active === 0);
      assert.equal(await prefetch.evaluate(() => window.catalogTest.app.catalogLoader.committedCount), 4);
    }
    await prefetch.evaluate(() => {
      window.catalogTest.app.jedDelta = 0;
      delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
    });
  } finally { releaseLookahead?.(); await prefetch.close(); }

  for (const action of ["replace", "dispose"]) {
    const opening = await browser.newPage();
    let releaseIndex;
    try {
      const gate = new Promise(resolve => { releaseIndex = resolve; });
      await opening.route("**/data/*/index.json", async route => { await gate; await route.continue().catch(() => {}); });
      await opening.goto(base + "/catalog-indexed/");
      await opening.waitForFunction(() => !!window.catalogTest?.app.catalogOpening);
      if (action === "replace") {
        await opening.evaluate(async ({ pin, base }) => {
          await window.catalogTest.app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/empty/index.json" });
        }, { pin: cases.bundles.empty.pin, base });
        await opening.waitForFunction(() => window.catalogTest.app.catalogLoader.sceneComplete());
        releaseIndex();
        await opening.evaluate(() => window.catalogReady);
        assert.equal(await opening.evaluate(() => window.catalogTest.app.catalogLoader.source.info.counts.discovery_export), 0);
      } else {
        await opening.evaluate(() => window.catalogTest.app.dispose());
        releaseIndex();
        await opening.evaluate(() => window.catalogReady);
        assert.equal(await opening.locator("canvas, .orrery-options").count(), 0);
      }
    } finally { releaseIndex?.(); await opening.close(); }
  }
  results.push(...await require("./catalog-review.cjs").run(browser, base, output, name));
  return results;
}

module.exports = { build, run };
