const fs = require("node:fs");
const path = require("node:path");

class Diagnostics {
  constructor(directory) {
    this.directory = directory;
    this.pages = [];
    this.results = [];
    this.run = { startedAt: new Date().toISOString(), status: "running", stage: "initialization",
      node: process.version, platform: process.platform, browsers: [] };
    fs.mkdirSync(directory, { recursive: true });
    this.save();
  }

  save() {
    fs.writeFileSync(path.join(this.directory, "run.json"), JSON.stringify(this.run, null, 2));
    fs.writeFileSync(path.join(this.directory, "results.json"), JSON.stringify(this.results, null, 2));
  }

  stage(stage) {
    this.run.stage = stage;
    this.save();
  }

  // Helpers receive this small browser interface too, so their pages retain
  // evidence before a finally block closes them and the assertion reaches main.
  browser(browser, name) {
    this.run.browsers.push({ name, version: browser.version() });
    this.save();
    return {
      version: () => browser.version(),
      newPage: async options => {
        const page = await browser.newPage(options);
        const id = `${name}-page-${this.pages.length + 1}`;
        const entry = { page, id };
        this.pages.push(entry);
        const log = event => {
          try {
            fs.appendFileSync(path.join(this.directory, `${id}.jsonl`),
              JSON.stringify({ time: new Date().toISOString(), stage: this.run.stage, url: page.url(), ...event }) + "\n");
          } catch (error) {
            // Reporting must not replace an assertion or prevent page cleanup.
            console.error(`Could not write ${id} diagnostics: ${error.message}`);
          }
        };
        entry.log = log;
        log({ type: "page-created" });
        page.on("console", message => log({ type: "console", level: message.type(), text: message.text(), location: message.location() }));
        page.on("pageerror", error => log({ type: "pageerror", message: error.message, stack: error.stack }));
        page.on("requestfailed", request => log({ type: "requestfailed", requestUrl: request.url(), error: request.failure() }));
        page.on("crash", () => log({ type: "crash" }));
        const close = page.close.bind(page);
        page.close = async options => {
          await this.capture(entry, "closed");
          return close(options);
        };
        return page;
      },
    };
  }

  async capture(entry, reason) {
    if (entry.page.isClosed()) return;
    const filename = `${entry.id}-${reason}.png`;
    try {
      // Software rendering on CI may need extra time for its first capture.
      // Keep cleanup bounded if the page or compositor is unresponsive.
      await entry.page.screenshot({ path: path.join(this.directory, filename), timeout: 30000 });
      entry.log({ type: "screenshot", filename, reason });
    } catch (error) {
      entry.log({ type: "capture-error", reason, message: error.message });
    }
  }

  async fail(error) {
    this.run.status = "failed";
    this.run.finishedAt = new Date().toISOString();
    this.run.error = { message: error.message, stack: error.stack };
    try { this.save(); }
    catch (failure) { console.error(`Could not save test failure: ${failure.message}`); }
    await Promise.all(this.pages.map(entry => this.capture(entry, "failure")));
  }

  pass() {
    this.run.status = "passed";
    this.run.finishedAt = new Date().toISOString();
    this.save();
  }
}

module.exports = Diagnostics;
