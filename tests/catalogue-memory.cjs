const assert = require("node:assert/strict");

// Exercise shared renderer startup with an uninstrumented fixture entry, so no
// test oracle keeps its records alive. CDP GC makes reachability deterministic.
module.exports = async (browser, url) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const session = await page.context().newCDPSession(page);
  try {
    await page.addInitScript(() => {
      const json = Response.prototype.json;
      Response.prototype.json = async function() {
        const data = await json.call(this);
        if (this.url.endsWith("/data/catalog.json")) {
          window.catalogueProbe = {
            count: data.length,
            references: [data, data[0], data[Math.floor(data.length / 2)], data.at(-1)].map(value => new WeakRef(value)),
          };
        }
        return data;
      };
    });
    const results = [];
    for (const navigation of ["boot", "reload"]) {
      if (navigation === "boot") await page.goto(url);
      else await page.reload();
      await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
      await require("./options.cjs").openOptions(page);
      const speed = page.getByRole("textbox", { name: "Playback speed" });
      await speed.fill("0"); await speed.press("Enter");
      await page.waitForFunction(() => document.querySelector("#orrery-fps").textContent === "0 FPS");
      await session.send("HeapProfiler.collectGarbage");
      const report = await page.evaluate(() => ({
        count: window.catalogueProbe.count,
        retained: window.catalogueProbe.references.map(reference => !!reference.deref()),
      }));
      Object.assign(report, await session.send("Runtime.getHeapUsage"), { navigation });
      console.log("Renderer fixture memory:", JSON.stringify(report));
      assert.equal(report.count, 100000, "The renderer fixture was parsed");
      assert.deepEqual(report.retained, [false, false, false, false],
        "Parsed catalogue array and sampled raw records must be collectible after renderer startup");
      const before = await page.locator("canvas").screenshot();
      const date = await page.locator("#orrery-date").textContent();
      const count = await page.locator("#orrery-count").textContent();
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.evaluate(() => {
          const gl = document.querySelector("canvas").getContext("webgl2");
          // getExtension returns null while the context is lost; keep the
          // original extension handle to restore it after garbage collection.
          window.contextLossExtension = gl.getExtension("WEBGL_lose_context");
          window.contextLossExtension.loseContext();
        });
        await page.waitForFunction(() => document.querySelector("#orrery-status").textContent.includes("Waiting to reconnect"));
        await session.send("HeapProfiler.collectGarbage");
        await page.evaluate(() => {
          window.contextLossExtension.restoreContext();
          delete window.contextLossExtension;
        });
        await page.waitForFunction(() => document.querySelector("#orrery-status").hidden);
        assert(before.equals(await page.locator("canvas").screenshot()), "Graphics recovery after GC preserves pixels");
        assert.equal(await page.locator("#orrery-date").textContent(), date);
        assert.equal(await page.locator("#orrery-count").textContent(), count);
      }
      results.push(report);
    }
    assert.deepEqual(errors, []);
    return results;
  } finally { await session.detach(); await page.close(); }
};

module.exports.testReplacement = async page => {
  const session = await page.context().newCDPSession(page);
  try {
    await page.evaluate(async () => {
      const { app, REFERENCE_JED } = window.test;
      app.jedDelta = 0;
      app.jed = REFERENCE_JED;
      // A fresh parse has distinct object identities from the test oracle.
      const data = await (await fetch("data/catalog.json")).json();
      data.reverse();
      const originalOrder = data.slice();
      window.replacementReferences = [data, data[0], data[Math.floor(data.length / 2)], data.at(-1)].map(value => new WeakRef(value));
      app.setupAsteroids(data);
      if (!data.every((record, i) => record === originalOrder[i])) throw new Error("Packing mutated caller catalogue order");
    });
    await page.waitForFunction(() => document.querySelector("#orrery-count").textContent === "100000");
    await session.send("HeapProfiler.collectGarbage");
    assert.deepEqual(await page.evaluate(() => window.replacementReferences.map(reference => !!reference.deref())),
      [false, false, false, false], "Replacement raw records are collectible while the new cloud is active");
    // Refresh phases in both directions after raw data has been collected.
    const counts = await page.evaluate(() => {
      const { app, catalog, REFERENCE_JED, REBASE_DAYS } = window.test;
      return [REFERENCE_JED + REBASE_DAYS + 1, REFERENCE_JED - REBASE_DAYS - 1, REFERENCE_JED].map(jed => {
        app.jed = jed; app.render();
        if (app.asteroids.epoch !== jed || app.asteroids.uniforms.orbitTime.value !== 0) throw new Error("Phase refresh failed after GC");
        return { expected: catalog.filter(record => record.disc <= jed).length,
          discovered: app.asteroidsDiscovered, drawn: app.renderer.info.render.points };
      });
    });
    for (const { expected, discovered, drawn } of counts) {
      assert.equal(discovered, expected);
      assert.equal(drawn, expected);
    }
    return { rawRecordsCollected: true, callerOrderPreserved: true, phaseRefreshCounts: counts };
  } finally { await session.detach(); }
};
