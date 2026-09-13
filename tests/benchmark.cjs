const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { serve } = require("../benchmarks/server.cjs");

module.exports = async function testBenchmark(browser, output, name) {
  const { server, url } = await serve(0, path.join(__dirname, "benchmark-browser.js"));
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    await page.goto(url); await page.evaluate(() => window.benchmark.ready);
    const frames = await page.evaluate(() => window.benchmarkProbe.verify());
    assert.deepEqual(frames.steps, [1.5, 0, -1.5]);
    assert.equal(frames.drawsAfterCompletion, 0);
    await page.screenshot({ path: path.join(output, `${name}-benchmark-desktop.png`) });
    // A real viewport resize invokes Orrery3D.resize(), which restores native DPR.
    // An explicitly DPR-1 run must not publish a mixture of DPR-1/DPR-2 samples.
    await page.evaluate(() => {
      window.resizeResult = window.benchmark.measure({ count: 10000, dpr: 1, warmup: 0, frames: 120 })
        .then(() => "accepted", error => error.message);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.match(await page.evaluate(() => window.resizeResult), /interrupted/i);
    // Clean up interrupted timing queries, then exercise the normal UI again.
    await page.getByLabel("Asteroids", { exact: true }).selectOption("10000");
    await page.getByRole("button", { name: "Run benchmark" }).click();
    await page.waitForFunction(() => !document.querySelector("#download").disabled);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JSON" }).click();
    const download = await downloading;
    const filename = path.join(output, `${name}-benchmark-ui.json`);
    await download.saveAs(filename);
    const result = JSON.parse(fs.readFileSync(filename)).results[0];
    assert.equal(result.count, 10000); assert.equal(result.dpr, 2);
    assert.equal(result.samples.intervals.length, 180);
    assert(result.fps > 0); assert.equal(result.phaseRefresh.uploadBytes, 40000);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.screenshot({ path: path.join(output, `${name}-benchmark-narrow.png`) });
    assert.deepEqual(errors, []);
    return { ...frames, interruptionRecoveryAndDownload: "passed" };
  } finally {
    await page.close();
    await new Promise(resolve => server.close(resolve));
  }
};
