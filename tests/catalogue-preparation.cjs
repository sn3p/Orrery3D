const assert = require("node:assert/strict");

// Native import in Node proves preparation has no browser/Three.js dependency.
exports.testPurePreparation = async () => {
  const { prepareCatalogue, REFERENCE_JED } = await import("../src/js/prepareCatalogue.js");
  const sample = { a: 1, e: 0, i: 0, W: 0, w: 0, M: 0, n: 1,
    epoch: REFERENCE_JED, disc: REFERENCE_JED };
  const records = Object.freeze([
    Object.freeze({ ...sample, a: 3, disc: REFERENCE_JED + 0.125 }),
    Object.freeze({ ...sample, a: 1 }), Object.freeze({ ...sample, a: 2 }),
  ]);
  const packed = prepareCatalogue(records, REFERENCE_JED);
  assert.deepEqual([...packed.p], [100, 0, 0, 200, 0, 0, 300, 0, 0], "Stable discovery sort preserves tied source order");
  assert.deepEqual([...packed.dates], [REFERENCE_JED, REFERENCE_JED, REFERENCE_JED + 0.125]);
  assert.deepEqual(records.map(record => record.a), [3, 1, 2], "Frozen input is never changed");
  assert(packed.phases instanceof Float64Array && packed.dates instanceof Float64Array);
  assert.equal(packed.radius, 300);
  assert.equal(packed.epoch, REFERENCE_JED);
  const empty = prepareCatalogue([], REFERENCE_JED);
  assert.equal(empty.radius, 0);
  assert.equal(empty.dates.length, 0);
  for (const epoch of [NaN, Infinity, undefined, "2458600.5"]) {
    assert.throws(() => prepareCatalogue([], epoch), /Invalid asteroid date/);
  }
  assert.throws(() => prepareCatalogue({}, REFERENCE_JED), /must be an array/);
  for (const data of [new Array(1), [null], [sample, , sample], [{ ...sample, e: 1 - 1e-10 }]]) {
    assert.throws(() => prepareCatalogue(data, REFERENCE_JED), /Invalid elliptical orbit at catalogue entry/);
  }
  // Period fallback and zero longitude remain valid, independent of the GPU.
  const fallback = prepareCatalogue([{ ...sample, n: 0, P: 360, wbar: 0, W: 25, w: 10 }], REFERENCE_JED);
  assert(Math.abs(fallback.p[0] - 100) < 1e-5 && Math.abs(fallback.p[1]) < 1e-5);
  assert(Math.abs(fallback.phases[1] - Math.PI / 180) < 1e-15);
  console.log("Pure catalogue preparation: frozen/stable sorting, empty/invalid inputs and numeric fallbacks passed");
};

exports.testReplacement = async page => {
  const result = await page.evaluate(() => {
    const { app, catalog, REFERENCE_JED } = window.test;
    const cloud = app.asteroids;
    const before = { date: app.jed, speed: app.jedDelta, status: app.statusMessage,
      count: app.asteroidsDiscovered, geometry: app.asteroidsGeometry };
    let disposed = false;
    const onDispose = () => { disposed = true; };
    cloud.geometry.addEventListener("dispose", onDispose);
    const sample = catalog[0];
    // The invalid record sorts first, but belongs to original input row 2.
    const invalid = [
      { ...sample, disc: REFERENCE_JED },
      { ...sample, a: 1e40, disc: REFERENCE_JED - 1 },
    ];
    let error;
    try { app.setupAsteroids(invalid); } catch (caught) { error = caught.message; }
    cloud.geometry.removeEventListener("dispose", onDispose);
    return { error, disposed, sameCloud: app.asteroids === cloud,
      sameGeometry: app.asteroidsGeometry === before.geometry,
      unchanged: app.jed === before.date && app.jedDelta === before.speed
        && app.statusMessage === before.status && app.asteroidsDiscovered === before.count,
      pointBatches: app.scene.children.filter(child => child.isPoints).length };
  });
  assert.equal(result.error, "Orbit exceeds rendering precision at catalogue entry 2.",
    "Packing failures identify the original input row, before discovery sorting");
  assert.equal(result.disposed, false);
  assert.equal(result.sameCloud, true);
  assert.equal(result.sameGeometry, true);
  assert.equal(result.unchanged, true);
  assert.equal(result.pointBatches, 1);
  return result;
};

exports.testTransferredCloud = async page => {
  const result = await page.evaluate(() => {
    const { app, catalog, Asteroids, prepareCatalogue, REFERENCE_JED, REBASE_DAYS } = window.test;
    const data = catalog.slice(0, 10);
    const options = { color: app.asteroidColor, discoveryColor: app.asteroidDiscoveryColor,
      discoveryDuration: app.asteroidDiscoveryDuration };
    const checks = [];
    for (const delta of [17.125, REBASE_DAYS + 1, -REBASE_DAYS - 1]) {
      const source = prepareCatalogue(data, REFERENCE_JED);
      const arrays = Object.values(source).filter(ArrayBuffer.isView);
      const packed = structuredClone(source, { transfer: arrays.map(array => array.buffer) });
      if (!arrays.every(array => array.byteLength === 0)) throw new Error("Transfer did not detach source buffers");
      const jed = REFERENCE_JED + delta;
      const cloud = new Asteroids(packed, { ...options, jed });
      try {
        if (cloud.geometry.attributes.position.array !== packed.p || cloud.phases !== packed.phases
          || cloud.discoveryDates !== packed.dates) throw new Error("Renderer copied prepared buffers");
        const expectedEpoch = Math.abs(delta) > REBASE_DAYS ? jed : REFERENCE_JED;
        if (cloud.epoch !== expectedEpoch || cloud.uniforms.orbitTime.value !== jed - expectedEpoch) {
          throw new Error("Renderer lost preparation epoch after transfer/delayed construction");
        }
        if (cloud.geometry.drawRange.count !== data.filter(record => record.disc <= jed).length) {
          throw new Error("Transferred discovery dates did not initialize the draw range");
        }
        cloud.update(jed + REBASE_DAYS * 2);
        cloud.update(jed - REBASE_DAYS * 2);
        const expected = prepareCatalogue(data, jed - REBASE_DAYS * 2);
        if (!cloud.geometry.attributes.elements.array.every((value, index) => value === expected.elements[index])) {
          throw new Error("Transferred phases changed a subsequent refresh");
        }
        checks.push({ delta, transferredBytes: Object.values(packed).filter(ArrayBuffer.isView)
          .reduce((sum, array) => sum + array.byteLength, 0), expectedEpoch });
      } finally { cloud.dispose(); }
    }
    return checks;
  });
  assert.equal(result.length, 3);
  return result;
};

exports.testLoading = async (browser, url) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  try {
    // Firefox's console transport can render Error as a handle, without its
    // message. Capture the original Error before browser-specific formatting.
    await page.addInitScript(() => {
      window.catalogueLoadErrors = [];
      const log = console.error;
      console.error = (...args) => {
        window.catalogueLoadErrors.push(...args.map(value => value?.message ?? String(value)));
        log(...args);
      };
    });
    const record = { a: 1, e: 0, i: 0, W: 0, w: 0, M: 0, n: 1, epoch: 2458600.5, disc: 2400000 };
    for (const body of ["{broken", JSON.stringify([record, { ...record, a: 1e40, disc: 2399999 }])]) {
      errors.length = 0;
      await page.route("**/data/catalog.json", route => route.fulfill({ contentType: "application/json", body }));
      await page.goto(url);
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").textContent(), /Could not load the asteroid catalogue/);
      if (body !== "{broken") assert(await page.evaluate(() =>
        window.catalogueLoadErrors.some(error => error.includes("catalogue entry 2."))));
      await page.unroute("**/data/catalog.json");
    }
    errors.length = 0;
    await page.reload();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    assert(await page.locator("#orrery-status").isHidden(), "Reload recovers from preparation failure");
    assert.deepEqual(errors, []);
    return "Malformed JSON and original-row precision failure recover on production reload";
  } finally { await page.close(); }
};
