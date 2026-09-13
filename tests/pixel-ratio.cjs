const assert = require("node:assert/strict");
const path = require("node:path");
const { installDprProbe, deliverDprChanges } = require("./high-dpi.cjs");

const key = "orrery3d.pixelRatio";
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
});
const dimensions = page => page.evaluate(() => {
  const canvas = document.querySelector("canvas"), gl = canvas.getContext("webgl2");
  return { canvas: [canvas.width, canvas.height], buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
});
const checkBuffer = async (page, ratio) => {
  const { width, height } = page.viewportSize();
  const expected = [Math.floor(width * ratio), Math.floor(height * ratio)];
  assert.deepEqual(await dimensions(page), { canvas: expected, buffer: expected });
};

module.exports = async (browser, url, output, name) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 3 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const control = page.getByRole("combobox", { name: "Rendering pixel ratio" });
  const speed = page.getByRole("textbox", { name: "Playback speed" });
  const boot = async () => {
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    await speed.fill("0"); await speed.press("Enter"); await settle(page);
    await page.evaluate(() => {
      window.optionDraws = 0;
      const gl = document.querySelector("canvas").getContext("webgl2");
      for (const method of ["drawArrays", "drawElements"]) {
        const draw = gl[method].bind(gl);
        gl[method] = (...args) => { window.optionDraws++; return draw(...args); };
      }
    });
  };
  const idle = async () => {
    await settle(page);
    const before = await page.evaluate(() => window.optionDraws);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.optionDraws), before, "Changing DPR preserves paused idle rendering");
  };
  const choose = async value => {
    const before = await page.evaluate(() => window.optionDraws);
    const date = await page.locator("#orrery-date").textContent();
    await control.selectOption(value); await settle(page);
    assert(await page.evaluate(before => window.optionDraws > before, before), "DPR control repaints the real production app");
    assert.equal(await page.locator("#orrery-date").textContent(), date);
    await idle();
  };
  let cdp;
  try {
    await installDprProbe(page);
    await page.goto(url); await boot();
    assert.equal(await control.count(), 1, "High-DPI display exposes the DPR control");
    assert.equal(await control.inputValue(), "auto");
    assert.deepEqual(await control.locator("option").evaluateAll(options => options.map(o => o.value)), ["auto", "1", "2", "3"]);
    await checkBuffer(page, 3);
    await page.screenshot({ path: path.join(output, `${name}-dpr-auto-desktop.png`) });

    for (const ratio of [1, 2, 3]) {
      await choose(String(ratio)); await checkBuffer(page, ratio);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), String(ratio));
    }
    // Native select stays focused and operable with the keyboard.
    await control.focus(); await control.press("a"); await control.press("Enter");
    await settle(page);
    assert.equal(await control.inputValue(), "auto");
    assert(await control.evaluate(el => el === document.activeElement));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null);
    await checkBuffer(page, 3);

    await choose("2");
    await page.reload(); await boot();
    assert.equal(await control.inputValue(), "2", "Reload restores the choice through production boot");
    await checkBuffer(page, 2);
    await page.setViewportSize({ width: 390, height: 844 }); await idle();
    await checkBuffer(page, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    for (const input of [speed, control]) {
      const bounds = await input.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 390, "Controls fit narrow viewport");
    }
    await page.screenshot({ path: path.join(output, `${name}-dpr-manual-narrow.png`) });

    // A saved choice survives a move to a lower-resolution display and back.
    if (name === "chromium") {
      cdp = await page.context().newCDPSession(page);
      await control.focus();
      for (const native of [1.5, 1, 3]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { ...page.viewportSize(), deviceScaleFactor: native, mobile: false });
        await deliverDprChanges(page); await idle();
        await checkBuffer(page, Math.min(2, native));
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), "2");
        assert.equal(await page.locator("select[aria-label='Rendering pixel ratio']").isVisible(), native > 1);
        if (native === 1) assert(await speed.evaluate(el => el === document.activeElement),
          "Focus moves to the speed control when the DPR control becomes unavailable");
        if (native === 1.5) {
          assert.equal(await control.locator("option:checked").textContent(), "2× (1.5× now)");
          await page.screenshot({ path: path.join(output, `${name}-dpr-clamped.png`) });
        }
      }
    }

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenDraws = await page.evaluate(() => window.optionDraws);
    await control.selectOption("1"); await settle(page);
    assert.equal(await page.evaluate(() => window.optionDraws), hiddenDraws);
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
    await settle(page); await checkBuffer(page, 1); await idle();
    assert(await page.evaluate(n => window.optionDraws > n, hiddenDraws));

    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      window.optionLost = new Promise(resolve => canvas.addEventListener("webglcontextlost", resolve, { once: true }));
      window.optionRestored = new Promise(resolve => canvas.addEventListener("webglcontextrestored", resolve, { once: true }));
      window.optionContext = canvas.getContext("webgl2").getExtension("WEBGL_lose_context");
      window.optionContext.loseContext();
    });
    await page.evaluate(() => window.optionLost.then(() => true));
    await control.selectOption("2");
    await page.waitForTimeout(100);
    await page.evaluate(() => window.optionContext.restoreContext());
    await page.evaluate(() => window.optionRestored.then(() => true));
    await settle(page); await checkBuffer(page, 2); await idle();

    for (const [speedValue, ratio] of [["1.5", "1"], ["-1.5", "2"]]) {
      await speed.fill(speedValue); await speed.press("Enter");
      const date = await page.locator("#orrery-date").textContent();
      await control.selectOption(ratio); await checkBuffer(page, Number(ratio));
      await page.waitForFunction(({ date, forward }) => forward
        ? document.querySelector("#orrery-date").textContent > date
        : document.querySelector("#orrery-date").textContent < date, { date, forward: Number(speedValue) > 0 });
      await speed.fill("0"); await speed.press("Enter"); await idle();
    }
    await choose("auto"); await page.reload(); await boot();
    await checkBuffer(page, 3);
    assert.equal(await control.inputValue(), "auto");
    // Invalid stored input and unavailable storage do not break boot or control changes.
    await page.evaluate(key => localStorage.setItem(key, "not-a-ratio"), key);
    await page.reload(); await boot(); await checkBuffer(page, 3);
    assert.equal(await control.inputValue(), "auto");
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
    });
    await page.reload(); await boot(); await checkBuffer(page, 3);
    await choose("1"); await checkBuffer(page, 1);
    assert.deepEqual(errors, []);
  } finally {
    if (cdp) await cdp.detach();
    await page.close();
  }
  const standard = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  try {
    await standard.addInitScript(key => localStorage.setItem(key, "2"), key);
    await standard.goto(url);
    await standard.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    assert(await standard.locator("select[aria-label='Rendering pixel ratio']").isHidden());
    await checkBuffer(standard, 1);
    await standard.screenshot({ path: path.join(output, `${name}-dpr-standard.png`) });
  } finally { await standard.close(); }
  return { choicesAndKeyboard: "passed", persistenceAndStorageErrors: "passed", lifecycle: "passed",
    desktopAndNarrow: "passed", displayTransitions: name === "chromium" ? "CDP with delivered media events" : "not exercised" };
};
