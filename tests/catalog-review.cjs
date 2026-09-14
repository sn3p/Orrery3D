const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const cases = require("./fixtures/consumer-v1/cases.json");
const through = 2451544.5;
const pin = cases.bundles.ties.pin;
async function close(page) {
  await page.evaluate(() => (window.catalogTest?.app || window.test?.app)?.dispose()).catch(() => {});
  await page.close();
}

async function shaderFailure(browser, url, output, name, native = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.shaderSource;
      WebGL2RenderingContext.prototype.shaderSource = function(shader, source) {
        return original.call(this, shader, source.includes("vec3 orbitPosition")
          ? source + "\ncontrolled_invalid_shader_token;\n" : source);
      };
    });
    await page.goto(url);
    await page.evaluate(native => native ? window.testReady : window.catalogReady, native);
    await page.getByRole("alert").waitFor();
    const before = await page.evaluate(() => {
      const app = window.catalogTest?.app || window.test.app;
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
      app.renderFrame();
      app.jedDelta = 1.5; app.autoRender = true;
      return { frame: app.renderer.info.render.frame, date: app.jed };
    });
    await page.getByRole("alert").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(before => {
      const app = window.catalogTest?.app || window.test.app;
      return app.renderer.info.render.frame > before.frame && app.jed > before.date;
    }, before);
    const rendered = await page.evaluate(() => {
      const app = window.catalogTest?.app || window.test.app;
      app.jedDelta = 0; app.renderFrame();
      const gl = app.renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit++;
      return { lit, complete: app.catalogLoader?.sceneComplete() ?? false };
    });
    assert(rendered.lit > 10, "Unaffected scene remains visible after shader failure and resize");
    assert(!rendered.complete);
    assert.match(await page.getByRole("alert").textContent(), /Unable to render/);
    await page.screenshot({ path: path.join(output, name + (native ? "-native" : "-trial") + "-shader-recovery.png") });
  } finally { await close(page); }
}

async function run(browser, base, output, name) {
  // Failure at the real configured opening boundary must not freeze planets.
  const opening = await browser.newPage();
  try {
    await opening.route("**/data/*/index.json", route => route.fulfill({ status: 404, body: "missing" }));
    await opening.goto(base + "/catalog-indexed/");
    await opening.evaluate(() => window.catalogReady);
    await opening.getByRole("alert").waitFor();
    const result = await opening.evaluate(() => {
      const app = window.catalogTest.app;
      app.autoRender = false; app.cancelRender(); app.jedDelta = 1.5;
      const before = app.jed, position = app.planets[0].body.position.clone();
      app.render(1000); app.render(1100);
      return { advance: app.jed - before, waiting: app.catalogWaiting,
        moved: !position.equals(app.planets[0].body.position), count: app.asteroidsDiscovered };
    });
    assert.deepEqual(result, { advance: 9, waiting: false, moved: true, count: 0 });
  } finally { await close(opening); }

  const pending = await browser.newPage();
  let releaseIndex;
  try {
    const gate = new Promise(resolve => { releaseIndex = resolve; });
    await pending.route("**/data/*/index.json", async route => { await gate; await route.continue().catch(() => {}); });
    await pending.goto(base + "/catalog-indexed/");
    await pending.waitForFunction(() => !!window.catalogTest?.app.catalogOpening);
    await pending.evaluate(() => {
      const app = window.catalogTest.app; app.autoRender = false; app.cancelRender();
      app.render(1000); app.jed = 9999999; app.renderFrame();
    });
    releaseIndex();
    await pending.waitForFunction(() => window.catalogTest.app.catalogLoader?.committedCount === 6);
    const date = await pending.evaluate(() => { const app = window.catalogTest.app; app.renderFrame(); return app.jed; });
    assert.equal(date, 9999999, "A date assigned while opening survives index activation");
  } finally { releaseIndex?.(); await close(pending); }

  const page = await browser.newPage();
  try {
    await page.goto(base + "/catalog-indexed/");
    await page.waitForFunction(() => window.catalogTest?.app.catalogLoader.sceneComplete());
    await page.evaluate(() => {
      const app = window.catalogTest.app; app.autoRender = false; app.cancelRender();
      app.jed = 2445240.5; app.renderFrame();
    });
    let requests = 0, unavailable = true;
    await page.route("**/chunks/000002.json", route => {
      requests++;
      return unavailable ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue();
    });
    await page.evaluate(() => { window.catalogTest.app.jedDelta = 1.5; });
    await page.waitForFunction(() => window.catalogTest.app.catalogLoader.errorKind === "read");
    assert.equal(requests, 3);
    assert(await page.locator("#orrery-status").isHidden(), "Speculative failure doesn't interrupt a complete scene");
    await page.evaluate(() => { for (let i = 0; i < 10; i++) window.catalogTest.app.renderFrame(); });
    assert.equal(requests, 3, "Repeated demands don't restart an exhausted speculative read");
    assert.equal(await page.evaluate(through => {
      const app = window.catalogTest.app, error = app.catalogLoader.error;
      app.jed = through; app.renderFrame();
      return app.catalogLoader.error === error && app.catalogLoader.errorKind === "read";
    }, through), true);
    assert.equal(requests, 3, "Advancing within retained data doesn't reset the speculative retry budget");
    unavailable = false;
    await page.evaluate(() => { const app = window.catalogTest.app; app.jed = app.catalogLoader.source.info.date_counts.at(-1)[0]; app.renderFrame(); });
    await page.waitForFunction(() => window.catalogTest.app.catalogLoader.committedCount === 6);
    await page.evaluate(() => window.catalogTest.app.renderFrame());
    assert.equal(requests, 4, "Required demand revives the failed speculative chunk once");
    assert.equal(await page.locator("#orrery-count").textContent(), "6");
    await page.unroute("**/chunks/000002.json");

    const culling = await page.evaluate(() => {
      const app = window.catalogTest.app, loader = app.catalogLoader;
      app.asteroids.geometry.boundingSphere.center.set(1e12, 1e12, 1e12);
      loader.loseGraphics(); app.renderFrame(); const skipped = loader.sceneComplete();
      app.asteroids.geometry.boundingSphere.center.set(0, 0, 0); app.renderFrame();
      return { skipped, restored: loader.sceneComplete() };
    });
    assert.deepEqual(culling, { skipped: false, restored: true });

    // Required exhaustion is recoverable through the app's online signal.
    requests = 0; unavailable = true;
    await page.route("**/chunks/000001.json", route => {
      requests++; return unavailable ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue();
    });
    await page.evaluate(async ({ pin, base, through }) => {
      const app = window.catalogTest.app; app.jedDelta = 0; app.jed = through; app.renderFrame();
      await app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/ties/index.json" });
    }, { pin, base, through });
    await page.waitForFunction(() => window.catalogTest.app.catalogLoader.errorKind === "read");
    assert.equal(requests, 3);
    unavailable = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => window.catalogTest.app.catalogLoader.committedCount === 4);
    await page.evaluate(() => window.catalogTest.app.renderFrame());
    assert.equal(requests, 4);
    assert(await page.locator("#orrery-status").isHidden());
    await page.unroute("**/chunks/000001.json");

    // Keep required in-flight work when a pause removes trailing lookahead.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/chunks/000001.json", async route => { await gate; await route.continue().catch(() => {}); });
    try {
      await page.evaluate(async ({ pin, base }) => {
        const app = window.catalogTest.app; app.jed = 2445240.5; app.renderFrame();
        await app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/ties/index.json" });
      }, { pin, base });
      await page.waitForFunction(() => window.catalogTest.app.catalogLoader.committedCount === 2);
      const paused = await page.evaluate(through => {
        const app = window.catalogTest.app; app.renderFrame(); app.jedDelta = 1.5;
        const request = app.catalogLoader.request;
        app.jed = through; app.jedDelta = 0; app.renderFrame();
        return { same: app.catalogLoader.request === request, aborted: request.controller.signal.aborted,
          demand: app.catalogLoader.date, displayed: app.jed };
      }, through);
      assert.deepEqual(paused, { same: true, aborted: false, demand: through, displayed: 2445240.5 });
      release();
      await page.waitForFunction(() => !window.catalogTest.app.catalogLoader.request);
      await page.evaluate(() => window.catalogTest.app.renderFrame());
      assert.equal(await page.locator("#orrery-count").textContent(), "4");
      assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.committedCount), 4);
    } finally { release(); await page.unroute("**/chunks/000001.json"); }

    const empty = await page.evaluate(async ({ pin, base }) => {
      const app = window.catalogTest.app; app.jed = 0; app.renderFrame();
      await app.loadCatalog({ ...pin, url: base + "/catalog-fixtures/ties/index.json" });
      app.renderFrame(); const attribute = app.asteroids.geometry.attributes.meanAnomaly, before = attribute.version;
      app.asteroids.update(app.asteroids.epoch + 2 * window.catalogTest.REBASE_DAYS);
      return { changed: attribute.version !== before, ranges: attribute.updateRanges };
    }, { pin, base });
    assert.deepEqual(empty, { changed: false, ranges: [] });
  } finally { await close(page); }

  // Producer-valid values outside the renderer's Float32 range fail once at commit.
  const index = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures/consumer-v1/ties/index.json")));
  const original = JSON.parse(await fs.readFile(path.join(__dirname, "fixtures/consumer-v1/ties/chunks/000000.json")));
  for (const mutation of [{ e: 1 - 1e-9 }, { a: 1e99 }]) {
    const page = await browser.newPage();
    try {
      await page.goto(base + "/catalog-indexed/");
      await page.waitForFunction(() => window.catalogTest?.app.catalogLoader.sceneComplete());
      const rows = structuredClone(original); Object.assign(rows[0], mutation);
      const bytes = Buffer.from(JSON.stringify(rows)), changed = structuredClone(index);
      Object.assign(changed.chunks[0], { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      const encoded = Buffer.from(JSON.stringify(changed));
      const replacement = { url: base + "/review-float/index.json", bytes: encoded.length, sha256: createHash("sha256").update(encoded).digest("hex") };
      let requests = 0;
      await page.route("**/review-float/index.json", route => route.fulfill({ contentType: "application/json", body: encoded }));
      await page.route("**/review-float/chunks/*", route => {
        requests++;
        return route.request().url().endsWith("000000.json") ? route.fulfill({ contentType: "application/json", body: bytes })
          : route.fulfill({ path: path.join(__dirname, "fixtures/consumer-v1/ties/chunks", route.request().url().split("/").at(-1)) });
      });
      await page.evaluate(pin => window.catalogTest.app.loadCatalog(pin), replacement);
      await page.waitForFunction(() => window.catalogTest.app.catalogLoader.errorKind === "commit");
      const count = requests;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      assert.deepEqual(await page.evaluate(() => {
        const loader = window.catalogTest.app.catalogLoader;
        return { committed: loader.committedCount, failures: loader.failures, timer: loader.retryTimer, kind: loader.errorKind };
      }), { committed: 0, failures: 0, timer: null, kind: "commit" });
      assert.equal(requests, count);
      assert.match(await page.getByRole("alert").textContent(), /cannot be prepared/);
      assert(!/Reload/.test(await page.getByRole("alert").textContent()));
    } finally { await close(page); }
  }
  await shaderFailure(browser, base + "/catalog-indexed/", output, name);
  return [{ suppliedReview: "opening/shader/commit failures, speculative recovery, required cancellation, manual dates, culling and empty uploads" }];
}
async function runNative(browser, base, output, name) {
  await shaderFailure(browser, base + "/fixture/", output, name, true);
}
module.exports = { run, runNative };
