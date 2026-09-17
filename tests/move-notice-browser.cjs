const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const report = path.join(root, ".context", "move-notice-tests");
const fixtures = path.join(root, "tests", "fixtures", "browser-v1", "ties");
const destinations = [
  "https://sn3p.github.io/Orrery/?renderer=three",
  "https://sn3p.github.io/Orrery/",
];

async function routeCatalog(route) {
  const requestPath = new URL(route.request().url()).pathname.replace(/^\/orrery-data\//, "");
  const filename = path.join(fixtures, requestPath);
  try {
    await fs.access(filename);
    await route.fulfill({ path: filename, headers: { "Access-Control-Allow-Origin": "*" } });
  } catch {
    await route.abort("failed");
  }
}

async function inspectApplication(browser, viewport, screenshot) {
  const context = await browser.newContext({ viewport });
  await context.route("https://sn3p.github.io/orrery-data/**", routeCatalog);
  const page = await context.newPage();
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("pageerror", error => errors.push(`page: ${error.message}`));
  page.on("requestfailed", request => errors.push(`request: ${request.url()}`));

  await page.goto(`${pathToFileURL(path.join(output, "index.html")).href}?from=bookmark#notice`);
  const dialog = page.getByRole("dialog", { name: "Orrery3D has moved" });
  await dialog.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#orrery-status").hidden);

  assert.equal(await dialog.getByRole("heading").innerText(), "Orrery3D has moved");
  assert.equal(await dialog.getByRole("link").count(), 2);
  assert.deepEqual(await dialog.getByRole("link").evaluateAll(links => links.map(link => link.href)), destinations);
  assert.equal(await page.getByText("Historical site").count(), 0);
  assert.equal(await page.getByText("View the historical source").count(), 0);

  const contrast = await dialog.evaluate(element => {
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(channel => Number(channel) / 255);
    const luminance = value => channels(value)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)];
      return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    };
    const background = getComputedStyle(element).backgroundColor;
    const pairs = [
      [element.querySelector("p"), element],
      [element.querySelector(".orrery-move-close"), element],
      ...[...element.querySelectorAll(".orrery-move-mode, .orrery-move-renderer")]
        .map(text => [text, text.closest("a")]),
    ];
    return pairs.map(([text, surface]) => ratio(getComputedStyle(text).color, getComputedStyle(surface).backgroundColor || background));
  });
  for (const ratio of contrast) assert.ok(ratio >= 4.5, `Dialog text contrast is ${ratio.toFixed(2)}:1`);

  const close = dialog.getByRole("button", { name: "Close move notice" });
  assert(await close.evaluate(element => element === document.activeElement), "Close button receives initial focus");

  const speed = page.locator('[aria-label="Playback speed"]');
  assert.equal(await speed.inputValue(), "0", "Historical scene starts paused");
  const date = await page.locator("#orrery-date").innerText();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#orrery-date").innerText(), date, "Date remains paused behind the dialog");
  assert.equal(await page.locator("#orrery-fps").innerText(), "0 FPS");

  const layout = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const heading = element.querySelector("h1");
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      headingSize: parseFloat(getComputedStyle(heading).fontSize),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert.ok(layout.left >= 0 && layout.right <= layout.viewportWidth);
  assert.ok(layout.top >= 0 && layout.bottom <= layout.viewportHeight);
  assert.ok(layout.headingSize <= 28, `Compact heading is ${layout.headingSize}px`);
  assert.ok(layout.overflow <= 0, `Horizontal overflow is ${layout.overflow}px`);
  await page.screenshot({ path: path.join(report, screenshot), fullPage: true });

  await page.keyboard.press("Tab");
  assert.match(await page.locator(":focus").innerText(), /Open Orrery in 3D/);
  await page.keyboard.press("Tab");
  assert.match(await page.locator(":focus").innerText(), /Open Orrery in 2D/);

  await close.click();
  assert(await dialog.isHidden());
  await page.waitForFunction(() => document.activeElement?.classList.contains("orrery-options-trigger"));
  assert(await page.locator(".orrery-options-trigger").evaluate(element => element === document.activeElement));
  assert(await page.locator("canvas").isVisible());
  await page.screenshot({ path: path.join(report, screenshot.replace("dialog", "dismissed")), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
}

async function inspectFallback(browser, viewport, screenshot) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  const page = await context.newPage();
  await page.goto(`${pathToFileURL(path.join(output, "404.html")).href}?from=bookmark#missing`);
  assert.equal(await page.getByRole("heading").innerText(), "Orrery3D has moved");
  assert.deepEqual(await page.getByRole("link").evaluateAll(links => links.map(link => link.href)), destinations);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
  if (screenshot) await page.screenshot({ path: path.join(report, screenshot), fullPage: true });
  await context.close();
}

(async () => {
  await fs.rm(report, { recursive: true, force: true });
  await fs.mkdir(report, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await inspectApplication(browser, { width: 1280, height: 800 }, "dialog-1280x800.png");
    await inspectApplication(browser, { width: 320, height: 720 }, "dialog-320x720.png");
    await inspectApplication(browser, { width: 160, height: 720 }, "dialog-160x720.png");
    await inspectFallback(browser, { width: 320, height: 720 }, "fallback-320x720.png");
    await inspectFallback(browser, { width: 160, height: 720 });
  } finally {
    await browser.close();
  }
  process.stdout.write(`Rendered move-notice checks passed; screenshots: ${path.relative(root, report)}\n`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
