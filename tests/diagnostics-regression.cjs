const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Diagnostics = require("./diagnostics.cjs");

module.exports = async (browser, output, name) => {
  const directory = path.join(output, `${name}-expected-diagnostic-failure`);
  const report = new Diagnostics(directory);
  const observed = report.browser(browser, name);
  report.stage("intentional helper failure");
  report.results.push({ checks: "passed", stage: "previous completed check" });
  const failure = new Error("Expected regression-test assertion");
  const page = await observed.newPage({ viewport: { width: 320, height: 240 } });
  try {
    await assert.rejects(async () => {
      try {
        await page.route("https://diagnostics.invalid/**", route => route.abort("failed"));
        await page.setContent("<p>Expected failure screenshot</p>");
        await page.evaluate(async () => {
          console.error("Expected diagnostic console error");
          await fetch("https://diagnostics.invalid/asset").catch(() => {});
        });
        const pageError = page.waitForEvent("pageerror");
        await page.evaluate(() => { setTimeout(() => { throw new Error("Expected diagnostic page error"); }); });
        await pageError;
        throw failure;
      } finally { await page.close(); }
    }, error => error === failure);
    await report.fail(failure);
    const saved = JSON.parse(fs.readFileSync(path.join(directory, "run.json")));
    assert.equal(saved.status, "failed");
    assert.equal(saved.stage, "intentional helper failure");
    assert.equal(saved.error.stack, failure.stack);
    const events = fs.readFileSync(path.join(directory, `${name}-page-1.jsonl`), "utf8")
      .trim().split("\n").map(line => JSON.parse(line));
    assert(events.some(event => event.type === "console" && event.text === "Expected diagnostic console error"));
    assert(events.some(event => event.type === "pageerror" && event.message === "Expected diagnostic page error"));
    assert(events.some(event => event.type === "requestfailed"));
    const screenshot = events.find(event => event.type === "screenshot");
    assert.equal(screenshot.reason, "closed", "Helper evidence precedes finally cleanup");
    assert(fs.statSync(path.join(directory, screenshot.filename)).size > 100);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "results.json"))),
      [{ checks: "passed", stage: "previous completed check" }], "Earlier results survive a later failure");
  } finally { if (!page.isClosed()) await page.close(); }

  // A lost/crashed page may reject screenshots. Retain the original error and
  // still close the page; do not let diagnostic capture mask the test failure.
  const unavailable = await observed.newPage();
  unavailable.screenshot = async () => { throw new Error("Expected unavailable screenshot"); };
  await report.fail(failure);
  await unavailable.close();
  assert(unavailable.isClosed());
  const captureLog = fs.readFileSync(path.join(directory, `${name}-page-2.jsonl`), "utf8");
  assert.match(captureLog, /capture-error/);
  assert.equal(report.run.error.stack, failure.stack);

  return { helperFailure: "passed", consoleAndPageErrors: "passed", requestFailure: "passed", captureFailure: "passed" };
};
