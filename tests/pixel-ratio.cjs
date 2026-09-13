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
    await require("./options.cjs").openOptions(page);
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
    assert.equal(await control.inputValue(), "1", "Fresh production boot defaults to 1×");
    assert.deepEqual(await control.locator("option").evaluateAll(options => options.map(o => o.value)), ["1", "2"]);
    await checkBuffer(page, 1);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null, "Boot does not invent a saved preference");
    await page.screenshot({ path: path.join(output, `${name}-dpr-default-desktop.png`) });
    await page.reload(); await boot();
    assert.equal(await control.inputValue(), "1", "An unset preference stays at 1× after reload");
    await checkBuffer(page, 1);
    for (const ratio of [2, 1, 2]) {
      await choose(String(ratio)); await checkBuffer(page, ratio);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), null, "DPR choices are not saved");
    }
    await page.reload(); await boot();
    assert.equal(await control.inputValue(), "1", "Reload starts at 1× after choosing 2×");
    await checkBuffer(page, 1);
    // Native select stays focused and operable with the keyboard.
    await control.focus(); await control.press("2"); await control.press("Enter");
    await settle(page);
    assert.equal(await control.inputValue(), "2");
    assert(await control.evaluate(el => el === document.activeElement));
    await checkBuffer(page, 2);
    await idle();
    await page.screenshot({ path: path.join(output, `${name}-dpr-2x-desktop.png`) });
    await page.setViewportSize({ width: 390, height: 844 }); await idle();
    await checkBuffer(page, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    for (const input of [speed, control]) {
      const bounds = await input.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 390, "Controls fit narrow viewport");
    }
    await page.screenshot({ path: path.join(output, `${name}-dpr-manual-narrow.png`) });

    // The current page's choice resumes when 2× becomes available again.
    if (name === "chromium") {
      cdp = await page.context().newCDPSession(page);
      await control.focus();
      for (const native of [2.5, 1.5, 0.75, 1, 2, 3]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { ...page.viewportSize(), deviceScaleFactor: native, mobile: false });
        await deliverDprChanges(page); await idle();
        await checkBuffer(page, native >= 2 ? 2 : Math.min(1, native));
        assert.equal(await page.locator("select[aria-label='Rendering pixel ratio']").inputValue(), "2");
        assert.equal(await page.locator("select[aria-label='Rendering pixel ratio']").isVisible(), native >= 2);
        if (native < 2) assert(await speed.evaluate(el => el === document.activeElement),
          "Focus moves to the speed control when the DPR control becomes unavailable");
        if (native === 1.5) {
          await page.screenshot({ path: path.join(output, `${name}-dpr-unavailable.png`) });
        } else if (native >= 2) {
          assert.deepEqual(await control.locator("option").allTextContents(), ["1×", "2×"]);
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
    // Every legacy saved choice is ignored: each boot starts at 1×.
    for (const value of ["auto", "1", "2", "3", "not-a-ratio"]) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value });
      await page.reload(); await boot(); await checkBuffer(page, 1);
      assert.equal(await control.inputValue(), "1", `Legacy ${value} cannot override the default`);
      await choose("2"); await checkBuffer(page, 2);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), key), value, "Controls do not write preferences");
    }
    // Unavailable storage does not break boot or control changes.
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
    });
    await page.reload(); await boot(); await checkBuffer(page, 1);
    await choose("2"); await checkBuffer(page, 2);
    await page.reload(); await boot(); await checkBuffer(page, 1);
    assert.deepEqual(errors, []);
  } finally {
    if (cdp) await cdp.detach();
    await page.close();
  }
  for (const native of [0.75, 1, 1.5, 2, 2.5]) {
    const standard = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: native });
    try {
      await standard.addInitScript(key => localStorage.setItem(key, "2"), key);
      await standard.goto(url);
      await standard.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
      await require("./options.cjs").openOptions(standard);
      const select = standard.locator("select[aria-label='Rendering pixel ratio']");
      assert.equal(await select.isVisible(), native >= 2, "2× availability controls visibility, including fractional displays");
      assert.equal(await select.inputValue(), "1");
      assert.deepEqual(await select.locator("option").allTextContents(), ["1×", "2×"]);
      await checkBuffer(standard, Math.min(1, native));
      await standard.screenshot({ path: path.join(output, `${name}-dpr-native-${native}.png`) });
    } finally { await standard.close(); }
  }
  return { freshDefaultAndReload: "always 1×", choicesAndKeyboard: "1×/2×", legacyAndUnavailableStorage: "ignored", lifecycle: "passed",
    desktopAndNarrow: "passed", displayTransitions: name === "chromium" ? "CDP with delivered media events" : "not exercised" };
};
