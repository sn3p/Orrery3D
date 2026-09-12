const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const webpack = require("webpack");
const browsers = require("playwright");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".context/tests");

async function build(entry, directory) {
  const config = require("../webpack.config");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ ...config, mode: "production", entry,
      output: { ...config.output, path: directory }, performance: { hints: false } });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
      else resolve();
    }));
  });
}

async function main() {
  await build("./tests/browser.js", path.join(output, "fixture"));
  await build("./src/index.js", path.join(output, "production"));
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.endsWith("/favicon.ico")) { res.writeHead(204); res.end(); return; }
    const filename = path.resolve(output, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (!filename.startsWith(output + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(filename)] || "application/octet-stream");
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const report = [];
  try {
    for (const name of (process.env.BROWSERS || "chromium").split(",")) {
      const browser = await browsers[name].launch({ headless: process.env.HEADLESS !== "0", ...(name === "chromium" ? { channel: "chrome" } : {}) });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(url + "/fixture/");
        await page.evaluate(() => window.testReady);
        await page.waitForFunction(() => window.test.app.asteroidsDiscovered > 0);
        const result = await page.evaluate(() => {
          const { app, catalog, REFERENCE_JED, REBASE_DAYS, Orbit, Asteroids, THREE } = window.test;
          const check = (condition, message) => { if (!condition) throw new Error(message); };
          check(catalog.length === 100000, "Real catalogue must load");
          check(app.asteroids instanceof Asteroids && app.asteroids.frustumCulled, "Production uses bounded GPU cloud");
          check(!app.asteroidsGeometry.attributes.color, "No dynamic CPU colour buffer");
          check(app.scene.children.filter(child => child.isPoints).length === 1, "One asteroid batch");
          const originalRAF = window.requestAnimationFrame;
          cancelAnimationFrame(app.animationFrame);
          window.requestAnimationFrame = () => 0;
          const timing = [];
          try {
            for (const hz of [30, 60, 120]) {
              app.clock.reset(); app.jed = REFERENCE_JED; app.jedDelta = 1.5;
              app.render(0);
              for (let i = 1; i <= hz; i++) app.render(i * 1000 / hz);
              const elapsed = app.jed - REFERENCE_JED;
              check(Math.abs(elapsed - 90) < 1e-6, `${hz} Hz playback: ${elapsed}`);
              timing.push({ hz, days: elapsed });
            }
            app.jedDelta = 0; app.render(2000);
            const paused = app.jed; app.render(3000); check(app.jed === paused, "Pause");
            app.jedDelta = -1.5; app.render(3016.6666667); check(app.jed < paused, "Reverse");
            app.clock.reset(); const before = app.jed; app.render(100000); check(app.jed === before, "Resume does not catch up");
            Object.defineProperty(document, "hidden", { configurable: true, value: true });
            document.dispatchEvent(new Event("visibilitychange"));
            app.render(200000); check(app.jed === before, "Hidden document does not advance");
            delete document.hidden;
            document.dispatchEvent(new Event("visibilitychange"));
            app.render(300000); check(app.jed === before, "Visibility resume excludes hidden time");
            app.onContextLost(); app.render(400000); check(app.jed === before, "Context downtime does not advance");
            app.onContextRestored(); app.render(500000); check(app.jed === before, "Context resume excludes downtime");
          } finally { window.requestAnimationFrame = originalRAF; app.jedDelta = 0; app.clock.reset(); app.render(); }
          const sample = catalog[50000];
          for (const date of [sample.disc - 0.001, sample.disc, sample.disc + 100, sample.disc + 201, sample.disc - 1, catalog[0].disc - 1, REFERENCE_JED]) {
            app.jed = date; app.updateAsteroids();
            const expected = catalog.filter(d => d.disc <= date).length;
            check(app.asteroidsDiscovered === expected && app.asteroidsGeometry.drawRange.count === expected, "Discovery boundary " + date);
          }
          const cloud = app.asteroids;
          const versions = Object.fromEntries(Object.entries(cloud.geometry.attributes).map(([key, attr]) => [key, attr.version]));
          app.jed += 1; app.updateAsteroids();
          for (const [key, version] of Object.entries(versions)) check(cloud.geometry.attributes[key].version === version, "Unexpected per-frame upload: " + key);
          app.jed = cloud.epoch + REBASE_DAYS + 1; app.updateAsteroids();
          check(cloud.geometry.attributes.elements.version === versions.elements + 1, "Phase rebase");
          check(cloud.uniforms.orbitTime.value === 0, "Relative time after rebase");
          for (const key of ["position", "basisQ", "discovery"]) check(cloud.geometry.attributes[key].version === versions[key], "Rebase changed fixed attributes");
          for (const d of catalog.filter((_, i) => i % 997 === 0)) {
            for (const date of [2378861.5, REFERENCE_JED, 2488070.5]) {
              check(Math.hypot(...Orbit.getPosAtTime(d, date)) <= cloud.geometry.boundingSphere.radius, "Conservative orbit bound");
            }
          }
          const invalidCatalogues = [new Array(1), [sample, , sample], [undefined], [null],
            ...[{ e: 1 }, { e: NaN }, { a: -1 }, { disc: Infinity }, { n: -1 }, { M: undefined },
              ...["", "20", NaN, Infinity, {}, false].map(wbar => ({ wbar, w: 10 }))]
              .map(patch => [{ ...sample, ...patch }])];
          for (const data of invalidCatalogues) {
            let rejected = false;
            try { app.setupAsteroids(data); } catch { rejected = true; }
            check(rejected && app.asteroids === cloud, "Invalid catalogue replaced the working cloud");
          }
          // Zero is a real longitude; only null/undefined select w + W.
          for (const wbar of [0, null, undefined]) {
            const d = { ...sample, wbar, w: 10, W: 25 };
            app.setupAsteroids([d]);
            const basis = Array.from(app.asteroidsGeometry.attributes.position.array);
            app.setupAsteroids([{ ...d, wbar: wbar ?? 35 }]);
            check(basis.every((v, i) => v === app.asteroidsGeometry.attributes.position.array[i]), "Longitude fallback changed orientation");
          }
          app.setupAsteroids(catalog);
          const replaced = app.asteroids;
          let disposed = false; replaced.geometry.addEventListener("dispose", () => { disposed = true; });
          app.setupAsteroids([]); check(disposed && app.asteroidsDiscovered === 0, "Empty replacement/disposal");
          app.setupAsteroids(catalog); app.jed = REFERENCE_JED; app.updateAsteroids();
          check(app.scene.children.filter(child => child.isPoints).length === 1, "Replacement leaked point batches");
          // Colour checks use the real production material and framebuffer.
          const renderColors = (ages, duration) => {
            const single = new Asteroids([{ ...sample, a: 1, e: 0, i: 0, W: 0, w: 0, wbar: 0, M: 0, n: 1, epoch: REFERENCE_JED, disc: REFERENCE_JED }], {
              jed: REFERENCE_JED, color: app.asteroidColor, discoveryColor: app.asteroidDiscoveryColor, discoveryDuration: duration,
            });
            single.material.size = 12;
            const scene = new THREE.Scene(); scene.add(single);
            const camera = new THREE.OrthographicCamera(-150, 150, 150, -150, 0.1, 1000);
            camera.position.set(0, 0, 500); camera.lookAt(0, 0, 0);
            const target = new THREE.WebGLRenderTarget(128, 128);
            const colors = ages.map(age => {
              single.update(REFERENCE_JED + age);
              app.renderer.setRenderTarget(target); app.renderer.render(scene, camera);
              const pixels = new Uint8Array(128 * 128 * 4);
              app.renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
              let rgb = [0, 0, 0];
              for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > rgb.reduce((a, b) => a + b, 0)) rgb = Array.from(pixels.slice(i, i + 3));
              return rgb;
            });
            app.renderer.setRenderTarget(null); single.dispose(); target.dispose();
            return colors;
          };
          const [fresh, almostFaded, faded, reversed, hidden, rediscovered] = renderColors([0, 199, 201, 0, -1, 0], 200);
          const [instant] = renderColors([0], 0);
          check(fresh[1] > 250 && fresh[0] === 0, "Discovery starts green");
          check(faded[0] > 0 && faded[0] === faded[1] && faded[1] === faded[2], "Fade ends neutral, without stale green");
          check(JSON.stringify(faded) === JSON.stringify(instant), "Zero duration fades immediately");
          check(hidden.every(x => x === 0), "Undiscovered asteroid hidden");
          check(almostFaded[1] > faded[1], "Crossing the cutoff finishes the fade");
          check(JSON.stringify(reversed) === JSON.stringify(fresh) && JSON.stringify(rediscovered) === JSON.stringify(fresh), "Rewind/re-discovery restores fresh colour");
          app.renderer.render(app.scene, app.camera);
          app.gui.gui.updateDisplay();
          return { timing, catalog: catalog.length, fresh, faded, instant, hidden };
        });
        const speed = page.getByRole("textbox", { name: "Playback speed" });
        await speed.fill("1.5"); await speed.press("Enter");
        assert.equal(await page.evaluate(() => window.test.app.jedDelta), 1.5);
        const date = await page.locator("#orrery-date").textContent();
        await page.waitForFunction(date => document.querySelector("#orrery-date").textContent > date, date);
        await speed.fill("0"); await speed.press("Enter");
        await page.waitForFunction(() => parseInt(document.querySelector("#orrery-fps").textContent) > 0);
        await page.screenshot({ path: path.join(output, `${name}-desktop.png`) });
        const before = await page.locator("canvas").screenshot();
        await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(750, 450, { steps: 12 }); await page.mouse.up();
        const rotated = await page.locator("canvas").screenshot(); assert(!before.equals(rotated), "Camera drag");
        await page.mouse.wheel(0, -350);
        const zoomed = await page.locator("canvas").screenshot(); assert(!rotated.equals(zoomed), "Camera zoom");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => document.querySelector("canvas").clientWidth === 390);
        const box = await speed.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 390);
        await page.screenshot({ path: path.join(output, `${name}-narrow.png`) });
        const lossSupported = await page.evaluate(() => !!window.test.app.renderer.getContext().getExtension("WEBGL_lose_context"));
        const canvasImage = () => page.evaluate(() => {
          const { app } = window.test;
          app.renderer.render(app.scene, app.camera);
          return app.renderer.domElement.toDataURL();
        });
        for (let recovery = 0; lossSupported && recovery < 2; recovery++) {
          const beforeLoss = await canvasImage();
          await page.evaluate(() => window.test.app.renderer.forceContextLoss());
          await page.waitForFunction(() => window.test.app.contextLost);
          assert.match(await page.locator("#orrery-status").textContent(), /Waiting to reconnect/);
          await page.waitForTimeout(100);
          await page.evaluate(() => window.test.app.renderer.forceContextRestore());
          await page.waitForFunction(() => !window.test.app.contextLost && window.test.app.renderer.info.render.points === 100000);
          assert(await page.locator("#orrery-status").isHidden());
          assert.equal(await canvasImage(), beforeLoss, "Context restoration recovers the rendered scene");
        }
        await page.evaluate(() => {
          const { app, Orrery3D, catalog } = window.test;
          app.dispose(); app.dispose();
          const replacement = new Orrery3D({ container: document.getElementById("orrery"), jedDelta: 0, asteroidColor: 0, asteroidDiscoveryColor: 0, asteroidDiscoveryDuration: 0 });
          replacement.setupAsteroids(catalog);
          if (replacement.jedDelta !== 0 || replacement.asteroidDiscoveryDuration !== 0 || replacement.asteroidColor.getHex() !== 0 || replacement.asteroidDiscoveryColor.getHex() !== 0) throw new Error("Zero constructor options");
          replacement.dispose();
          if (document.querySelector("canvas, .dg.main")) throw new Error("Dispose left a canvas or controls");
        });
        await page.reload(); await page.evaluate(() => window.testReady);
        await page.waitForFunction(() => window.test.app.asteroidsDiscovered > 0);
        assert.deepEqual(errors, []);
        // Actual production build, without a test API.
        await page.goto(url + "/production/");
        await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
        assert(await page.locator("#orrery-status").isHidden());
        assert.deepEqual(errors, []);
        // Loading and failure through the real fetch/boot boundary.
        await page.route("**/data/catalog.json", async route => {
          await new Promise(resolve => setTimeout(resolve, 200));
          await route.fulfill({ status: 503, body: "Unavailable" });
        });
        await page.reload({ waitUntil: "domcontentloaded" });
        assert.match(await page.locator("#orrery-status").textContent(), /Loading/);
        await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").textContent(), /Could not load/);
        const alertBox = await page.getByRole("alert").boundingBox();
        assert(alertBox.x >= 0 && alertBox.x + alertBox.width <= 390, "Error message fits narrow viewport");
        await page.screenshot({ path: path.join(output, `${name}-error.png`) });
        await page.unroute("**/data/catalog.json");
        await page.route("**/data/catalog.json", route => route.fulfill({ json: [{ e: 2 }] }));
        await page.reload(); await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").textContent(), /Could not load/);
        await page.addInitScript(() => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            return type.startsWith("webgl") ? null : getContext.call(this, type, ...args);
          };
        });
        await page.reload(); await page.getByRole("alert").waitFor();
        assert.match(await page.getByRole("alert").textContent(), /WebGL 2 is required/);
        assert.equal(await page.locator(".dg.main").count(), 0, "No controls for an unavailable renderer");
        report.push({ browser: name, version: browser.version(), ...result, contextRecovery: lossSupported, checks: "passed" });
        fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
        console.log(`${name}: production, controls, timing, discoveries, bounds, replacement, colours, recovery, errors passed`);
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
