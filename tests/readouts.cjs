const assert = require("node:assert/strict");

exports.testReadoutBoundaries = async page => page.evaluate(() => {
  const { app, catalog } = window.test;
  const saved = { jed: app.jed, speed: app.jedDelta, autoRender: app.autoRender };
  const elements = ["date", "fps", "count"].map(name => document.getElementById(`orrery-${name}`));
  const observer = new MutationObserver(() => {});
  let records = catalog;
  let frames = 0;
  let writes = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = label => {
    const before = elements.map(element => element.textContent);
    app.render();
    const expected = [new Date((app.jed - 2440587.5) * 86400000).toISOString().slice(0, 10),
      `${app.gui.stats.fps} FPS`, String(records.filter(record => record.disc <= app.jed).length)];
    const mutations = observer.takeRecords();
    elements.forEach((element, index) => {
      check(element.textContent === expected[index], `${label}: incorrect ${element.id}`);
      const count = mutations.filter(mutation => mutation.target === element).length;
      check(count === Number(before[index] !== expected[index]), `${label}: redundant or missing ${element.id} update`);
    });
    frames++; writes += mutations.length;
  };
  try {
    app.autoRender = false; app.cancelRender(); app.jedDelta = 0; app.render();
    elements.forEach(element => observer.observe(element, { childList: true }));
    frame("Unchanged paused frame");
    // Visit both sides in both directions, including Date's rounding before 1970.
    for (const midnight of ["1900-03-01", "1969-12-31", "1970-01-01", "2000-02-29", "2001-01-01"]) {
      const jed = Date.parse(`${midnight}T00:00:00Z`) / 86400000 + 2440587.5;
      const offsets = [-2 / 86400000, -0.5 / 86400000, 0, 0.5 / 86400000, 2 / 86400000,
        0.5 - 1 / 86400000, 0.5, 0.5 + 1 / 86400000, 1];
      for (const offset of [...offsets, ...offsets.toReversed()]) {
        app.jed = jed + offset; frame(`${midnight} ${offset}`);
      }
    }
    const discovery = catalog[50000].disc;
    for (const jed of [discovery - 0.001, discovery, discovery + 0.001, discovery, discovery - 0.001]) {
      app.jed = jed; frame("Real discovery cutoff");
    }
    const day = 2451544.5;
    records = [0.25, 0.75].map(offset => ({ ...catalog[0], disc: day + offset }));
    app.setupAsteroids(records);
    for (const offset of [0, 0.25, 0.5, 0.75, 0.5, 0.25, 0]) {
      app.jed = day + offset; frame("Same-day discoveries and rewind");
    }
    records = []; app.setupAsteroids(records); frame("Empty replacement");
    records = catalog; app.setupAsteroids(records); frame("Catalogue restored");
    return { frames, writes, unchangedWrites: 0 };
  } finally {
    observer.disconnect();
    app.setupAsteroids(catalog); app.jed = saved.jed; app.jedDelta = saved.speed;
    app.autoRender = saved.autoRender; app.render();
  }
});

// Exercise the real fetch/boot path and keyboard controls with known discoveries.
exports.testProductionReadouts = async page => {
  let releaseCatalogue;
  const catalogue = new Promise(resolve => { releaseCatalogue = resolve; });
  const fulfillCatalogue = async route => route.fulfill({ json: await catalogue });
  await page.route("**/data/catalog.json", fulfillCatalogue);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await require("./options.cjs").openOptions(page);
    const speed = page.getByRole("textbox", { name: "Playback speed" });
    await speed.fill("0"); await speed.press("Enter");
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const initialDate = await page.locator("#orrery-date").textContent();
    const day = Date.parse(`${initialDate}T00:00:00Z`) / 86400000 + 2440587.5;
    const orbit = { a: 2.5, e: 0.1, i: 5, w: 25, W: 45, M: 60, n: 0.25, epoch: 2451545 };
    // One baseline object and one upcoming discovery, independent of MPC updates.
    releaseCatalogue([{ ...orbit, disc: day - 36525 }, { ...orbit, a: 3, disc: day + 30 }]);
    await page.waitForFunction(() => document.getElementById("orrery-count").textContent === "1");
    await page.evaluate(() => {
      const probe = window.readoutProbe = { updates: { date: 0, fps: 0, count: 0 }, redundant: [] };
      probe.observers = Object.keys(probe.updates).map(name => {
        const element = document.getElementById(`orrery-${name}`);
        let previous = element.textContent;
        const observer = new MutationObserver(mutations => {
          probe.updates[name] += mutations.length;
          if (element.textContent === previous || mutations.length !== 1) probe.redundant.push(name);
          previous = element.textContent;
        });
        observer.observe(element, { childList: true });
        return observer;
      });
    });
    const countTransitions = [1];
    for (const [value, count] of [["1.5", 2], ["-1.5", 1]]) {
      const before = await page.locator("#orrery-date").textContent();
      await speed.fill(value); await speed.press("Enter");
      await page.waitForFunction(({ before, value }) => {
        const date = document.getElementById("orrery-date").textContent;
        return Number(value) > 0 ? date > before : date < before;
      }, { before, value });
      await page.waitForFunction(count => document.getElementById("orrery-count").textContent === String(count), count);
      await page.waitForFunction(() => parseInt(document.getElementById("orrery-fps").textContent) > 0);
      await speed.fill("0"); await speed.press("Enter");
      await page.waitForFunction(() => document.getElementById("orrery-fps").textContent === "0 FPS");
      assert.equal(await page.locator("#orrery-count").textContent(), String(count));
      countTransitions.push(count);
    }
    const result = await page.evaluate(() => ({ updates: window.readoutProbe.updates, redundant: window.readoutProbe.redundant }));
    assert.deepEqual(result.redundant, [], "Production frames only write changed readouts");
    assert(Object.values(result.updates).every(count => count > 0), "Date, FPS and discovery count all update during playback");
    return { ...result, countTransitions };
  } finally {
    releaseCatalogue([]);
    await page.unroute("**/data/catalog.json", fulfillCatalogue);
    await page.evaluate(() => { window.readoutProbe?.observers.forEach(observer => observer.disconnect()); delete window.readoutProbe; });
  }
};
