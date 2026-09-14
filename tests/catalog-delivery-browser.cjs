const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const cases = require("./fixtures/consumer-v1/cases.json");
const root = path.resolve(__dirname, "..");

exports.build = output => {
  const config = path.join(output, "delivery-config.json");
  fs.writeFileSync(config, JSON.stringify({ bundle: path.join(__dirname, "fixtures/consumer-v1/ties"),
    pin: cases.bundles.ties.pin, mode: "indexed", startJed: 2451544.5, speed: 0 }));
  const cli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  const result = spawnSync(process.execPath, [cli, "run", "build", "--", "--output-clean"],
    { cwd: root, env: { ...process.env, CATALOG_CONFIG: config }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  fs.cpSync(path.join(root, "dist"), path.join(output, "delivery/Orrery3D"), { recursive: true });
};

exports.run = async (browser, base, output, name) => {
  const missing = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const missingRequests = [];
  missing.on("request", request => missingRequests.push(request.url()));
  try {
    await missing.goto(base + "/unconfigured/");
    await missing.getByRole("alert").waitFor();
    assert.match(await missing.getByRole("alert").textContent(), /Could not load the asteroid catalogue/);
    assert(!missingRequests.some(url => /\.json(?:\?|$)/.test(url)), "An unconfigured app cannot fetch a fallback dataset");
    await missing.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type.startsWith("webgl") ? null : getContext.call(this, type, ...args);
      };
    });
    await missing.goto(base + "/delivery/Orrery3D/");
    await missing.getByRole("alert").waitFor();
    assert.match(await missing.getByRole("alert").textContent(), /WebGL 2 is required/);
    assert.equal(await missing.locator(".dg.main, .orrery-options").count(), 0);
  } finally { await missing.close(); }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], requests = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => requests.push(request.url()));
  page.on("response", async response => {
    if (!/\/data\/delivery-v1-.*\.json$/.test(response.url())) return;
    checks.push((async () => {
      const bytes = await response.body();
      const index = require("./fixtures/consumer-v1/ties/index.json");
      const ref = response.url().endsWith("/index.json") ? cases.bundles.ties.pin
        : index.chunks.find(chunk => response.url().endsWith("/" + chunk.url));
      assert(ref, "Only expected index/chunks requested");
      assert.equal(bytes.length, ref.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256);
    })());
  });
  try {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(base + "/delivery/Orrery3D/");
      await page.waitForFunction(() => document.querySelector("#orrery-count").textContent.replace(/\D/g, "") === "4");
      await require("./options.cjs").openOptions(page);
      const speed = page.getByRole("textbox", { name: "Playback speed" });
      await speed.focus();
      assert(await speed.evaluate(el => document.activeElement === el));
      const bounds = await speed.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `${name}-delivery-${width}.png`) });
    }
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#orrery-count").textContent.replace(/\D/g, "") === "4");
    await Promise.all(checks);
    assert(!requests.some(url => /\/full\/catalog\.json|\/data\/catalog\.json$/.test(url)), "Indexed entry never requests whole catalogues");
    assert.deepEqual(errors, []);
    return { requests: requests.filter(url => url.includes("/data/")), viewports: [1280, 390], decodedHashes: true, reload: true };
  } finally { await page.close(); }
};
