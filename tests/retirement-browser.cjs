const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const report = path.join(root, ".context", "retirement-tests");
const primaryUrl = "https://sn3p.github.io/Orrery/?renderer=three";

async function inspect(context, file, viewport, screenshot) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", error => errors.push(`page: ${error.message}`));
  page.on("requestfailed", request => errors.push(`request: ${request.url()}`));

  const url = `${pathToFileURL(path.join(root, "dist", file)).href}?from=bookmark#notice`;
  await page.goto(url);

  await page.locator("main").waitFor({ state: "visible" });
  assert.equal(await page.title(), "Orrery3D has moved");
  assert.equal(await page.locator("h1").innerText(), "Orrery3D has moved");
  assert.match(await page.locator(".summary").innerText(), /no longer maintained/);
  assert.equal(await page.locator("a").count(), 3);
  assert.equal(await page.locator("a.primary").getAttribute("href"), primaryUrl);

  const eyebrowContrast = await page.locator(".eyebrow").evaluate(element => {
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(channel => Number(channel) / 255);
    const luminance = value => channels(value)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(element.closest("main")).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  assert.ok(eyebrowContrast >= 4.5, `eyebrow contrast is ${eyebrowContrast}:1`);

  const overflow = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(overflow.scrollWidth <= overflow.width, `horizontal overflow: ${JSON.stringify(overflow)}`);

  await page.locator("a.primary").focus();
  const focus = await page.locator("a.primary").evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      left: rect.left,
      right: rect.right,
      viewport: innerWidth,
    };
  });
  assert.notEqual(focus.outlineStyle, "none");
  assert.notEqual(focus.outlineWidth, "0px");
  assert.ok(focus.left >= 4 && focus.right <= focus.viewport - 4, `clipped focus outline: ${JSON.stringify(focus)}`);

  if (screenshot) await page.screenshot({ path: path.join(report, screenshot), fullPage: true });

  await page.keyboard.press("Tab");
  assert.match(await page.locator(":focus").innerText(), /Open Orrery in 2D/);
  await page.keyboard.press("Tab");
  assert.match(await page.locator(":focus").innerText(), /View the historical source/);
  assert.deepEqual(errors, []);
  await page.close();
}

(async () => {
  await fs.rm(report, { recursive: true, force: true });
  await fs.mkdir(report, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await inspect(context, "index.html", { width: 320, height: 720 }, "root-320x720.png");
    await inspect(context, "index.html", { width: 1280, height: 800 }, "root-1280x800.png");
    await inspect(context, "404.html", { width: 320, height: 720 }, "fallback-320x720.png");
    // A 160 CSS-pixel viewport exercises the reflow pressure of 200% zoom at 320 px.
    await inspect(context, "index.html", { width: 160, height: 720 });
    await context.close();
  } finally {
    await browser.close();
  }

  process.stdout.write(`Rendered retirement checks passed; screenshots: ${path.relative(root, report)}\n`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
