const assert = require("node:assert/strict");
const path = require("node:path");

exports.openOptions = async page => {
  const trigger = page.getByRole("button", { name: "Options", exact: true });
  if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click();
};

exports.testOptions = async (browser, url, output, name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const trigger = page.getByRole("button", { name: "Options", exact: true });
  const panel = page.locator(".orrery-options-panel");
  const speed = page.getByRole("textbox", { name: "Playback speed" });
  const dpr = page.getByRole("combobox", { name: "Rendering pixel ratio" });
  try {
    await page.goto(url);
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    assert.equal(await trigger.count(), 1, "Production has an options trigger");
    assert(await panel.isHidden(), "Options start closed");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(await trigger.getAttribute("aria-controls"), await panel.getAttribute("id"));
    assert.equal(await speed.count(), 0, "Closed controls are absent from the accessibility tree");
    await page.screenshot({ path: path.join(output, `${name}-options-closed-desktop.png`) });

    await trigger.focus(); await trigger.press("Enter");
    assert(await panel.isVisible());
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert(await speed.evaluate(el => el === document.activeElement), "Opening moves focus to the first control");
    assert.match(await page.locator("#" + await speed.getAttribute("aria-describedby")).textContent(), /0 pauses/);
    assert.match(await page.locator("#" + await dpr.getAttribute("aria-describedby")).textContent(), /Lower DPR/);
    await speed.fill("0"); await speed.press("Enter");
    await dpr.selectOption("1");
    await page.waitForFunction(() => document.querySelector("#orrery-fps").textContent === "0 FPS");
    await page.evaluate(() => {
      window.panelDraws = 0;
      const gl = document.querySelector("canvas").getContext("webgl2");
      for (const method of ["drawArrays", "drawElements"]) {
        const draw = gl[method].bind(gl);
        gl[method] = (...args) => { window.panelDraws++; return draw(...args); };
      }
    });
    await page.waitForTimeout(100);
    const draws = await page.evaluate(() => window.panelDraws);
    const date = await page.locator("#orrery-date").textContent();
    await speed.press("Enter"); await page.keyboard.press("Escape");
    assert(await panel.isHidden());
    assert(await trigger.evaluate(el => el === document.activeElement), "Escape returns focus to the trigger");
    await trigger.press("Tab");
    assert(await page.evaluate(() => !document.activeElement.closest(".orrery-options-panel")), "Tab skips closed controls");
    await trigger.focus(); await trigger.press("Space");
    assert(await panel.isVisible(), "Space opens the panel");
    assert.equal(await speed.inputValue(), "0");
    assert.equal(await dpr.inputValue(), "1");
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.panelDraws), draws, "Panel toggles do not restart paused rendering");
    assert.equal(await page.locator("#orrery-date").textContent(), date);
    await page.screenshot({ path: path.join(output, `${name}-options-open-desktop.png`) });

    await trigger.click(); assert(await panel.isHidden(), "Trigger toggles the panel closed");
    await trigger.click(); await page.mouse.click(50, 150);
    assert(await panel.isHidden(), "An outside pointer closes the panel");
    await exports.openOptions(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 240 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => {
        const canvas = document.querySelector("canvas");
        return canvas.clientWidth === width && canvas.clientHeight === height;
      }, viewport);
      const bounds = await panel.boundingBox();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width
        && bounds.y + bounds.height <= viewport.height, "Options fit narrow and short viewports");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
      for (const control of [speed, dpr]) {
        const box = await control.boundingBox();
        assert(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
      }
      assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true, "Panel has no horizontal overflow");
      await page.screenshot({ path: path.join(output, `${name}-options-${viewport.width}x${viewport.height}.png`) });
    }
    await speed.fill("-1.5"); await speed.press("Enter");
    const reverseDate = await page.locator("#orrery-date").textContent();
    await trigger.click();
    await page.waitForFunction(date => document.querySelector("#orrery-date").textContent < date, reverseDate);
    await exports.openOptions(page);
    assert.equal(await speed.inputValue(), "-1.5", "Closing keeps playback settings");
    await page.reload();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    assert(await panel.isHidden(), "Reload starts with a closed panel");
    await exports.openOptions(page);
    assert.equal(await dpr.inputValue(), "1", "Panel visibility does not change persisted DPR");
    assert.deepEqual(errors, []);
    return { toggleAndDismissal: "passed", keyboardAndFocus: "passed", valuesAndIdle: "passed",
      desktopNarrowAndShort: "passed", reload: "passed" };
  } finally { await page.close(); }
};
