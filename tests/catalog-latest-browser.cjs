const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { buildTrial } = require("../scripts/catalog.cjs");
const fixture = path.join(__dirname, "fixtures/browser-v1");
let server, latest, current = "ties", corrupt = false, pending;

exports.build = async output => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.url.includes("?pending") && pending) {
      pending.arrived();
      await pending.gate;
      if (res.destroyed) return;
    }
    try {
      let body = await fs.readFile(path.join(fixture, current, pathname));
      if (corrupt && pathname.includes("/chunks/")) body = Buffer.from("[{}");
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" });
      res.end(body);
    } catch { res.writeHead(404, { "Access-Control-Allow-Origin": "*" }); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  latest = `http://127.0.0.1:${server.address().port}/latest.json`;
  const config = path.join(output, "latest-config.json");
  await fs.writeFile(config, JSON.stringify({ mode: "indexed", latest, startJed: 2451544.5, speed: 0 }));
  const result = await buildTrial(config, path.join(output, "latest/Orrery3D"), { entry: "./tests/catalog-browser.js", publicDefaults: true });
  assert.equal(result.bundle, null);
  await assert.rejects(fs.stat(path.join(result.output, "data")), { code: "ENOENT" });
};

exports.close = async () => {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
};

exports.run = async (browser, base, output, name) => {
  current = "ties"; corrupt = false;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => requests.push(req.url()));
  const population = count => page.waitForFunction(expected => {
    const app = window.catalogTest?.app;
    return app?.catalogLoader?.initialRendered && app.catalogLoader.committedCount === expected;
  }, count);
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(base + "/latest/Orrery3D/");
      await population(4);
      await require("./options.cjs").openOptions(page);
      const speed = page.getByRole("textbox", { name: "Playback speed" });
      await speed.focus();
      assert(await speed.evaluate(el => document.activeElement === el));
      const bounds = await speed.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `${name}-latest-${width}.png`) });
    }
    const oldIdentity = await page.evaluate(() => window.catalogTest.app.catalogLoader.source.sourceId);
    current = "empty";
    await page.evaluate(() => { window.catalogTest.app.jed = 2458847.5; });
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").textContent(), /Reload/);
    assert.deepEqual(await page.evaluate(() => [window.catalogTest.app.catalogLoader.committedCount,
      window.catalogTest.app.catalogLoader.source.sourceId]), [4, oldIdentity]);
    await page.reload();
    await population(0);
    assert.notEqual(await page.evaluate(() => window.catalogTest.app.catalogLoader.source.sourceId), oldIdentity);
    current = "ties";
    await page.reload();
    await population(4);
    corrupt = true;
    await page.evaluate(() => { window.catalogTest.app.jed = 2458847.5; });
    await page.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.committedCount), 4);
    corrupt = false;
    await page.reload();
    await population(4);
    await page.evaluate(() => { window.catalogTest.app.jed = 2458847.5; });
    await population(6);
    for (const operation of ["replace", "dispose"]) {
      let arrived, release;
      const started = new Promise(resolve => { arrived = resolve; });
      pending = { arrived, gate: new Promise(resolve => { release = resolve; }) };
      try {
        await page.evaluate(url => { window.pendingLatest = window.catalogTest.app.loadCatalog(null, { latest: url + "?pending" }); }, latest);
        await started;
        if (operation === "replace") {
          current = "empty";
          await page.evaluate(url => window.catalogTest.app.loadCatalog(null, { latest: url }), latest);
          await population(0);
          release();
          await page.evaluate(() => window.pendingLatest);
          assert.equal(await page.evaluate(() => window.catalogTest.app.catalogLoader.source.info.counts.discovery_export), 0);
        } else {
          await page.evaluate(() => window.catalogTest.app.dispose());
          release();
          await page.evaluate(() => window.pendingLatest);
          assert(await page.evaluate(() => window.catalogTest.app.disposed && !window.catalogTest.app.catalogLoader.source));
        }
      } finally { release(); pending = null; }
    }
    assert(!requests.some(url => /\/full\/catalog\.json|\/data\/catalog\.json$/.test(url)));
    assert(requests.some(url => url === latest));
    assert.deepEqual(errors, []);
    return { sharedOrigin: true, omittedHistoricalAsset: true, reloadedLatest: true,
      staleSessionPreserved: true, corruptChunkRejected: true, pendingReplacement: true, pendingDisposal: true,
      finalPopulation: 6, viewports: [1280, 390] };
  } finally { await page.close(); current = "ties"; corrupt = false; }
};
