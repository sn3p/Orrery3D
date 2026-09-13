const assert = require("node:assert/strict");

exports.testNumerics = async page => {
  const result = await page.evaluate(() => {
    const { Orbit, app, catalog } = window.test;
    const rad = Math.PI / 180, tau = 2 * Math.PI;
    // Independent bisection, then successive orbital-plane rotations. Neither
    // the production solver nor its period helper supplies expected positions.
    const reference = (eph, jed) => {
      let M = (eph.M * rad + (eph.n ? eph.n * rad : tau / eph.P) * (jed - eph.epoch)) % tau;
      if (M > Math.PI) M -= tau;
      if (M < -Math.PI) M += tau;
      let lo = -Math.PI, hi = Math.PI;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (mid - eph.e * Math.sin(mid) < M) lo = mid;
        else hi = mid;
      }
      const E = (lo + hi) / 2;
      const x = eph.a * 100 * (Math.cos(E) - eph.e);
      const y = eph.a * 100 * Math.sqrt((1 - eph.e) * (1 + eph.e)) * Math.sin(E);
      const w = ((eph.wbar ?? (eph.w + eph.W)) - eph.W) * rad;
      const px = x * Math.cos(w) - y * Math.sin(w);
      const py = x * Math.sin(w) + y * Math.cos(w);
      const iy = py * Math.cos(eph.i * rad);
      return [px * Math.cos(eph.W * rad) - iy * Math.sin(eph.W * rad),
        px * Math.sin(eph.W * rad) + iy * Math.cos(eph.W * rad), py * Math.sin(eph.i * rad)];
    };
    const failures = [];
    let cases = 0, maxError = 0, maxSinCalls = 0;
    const check = (eph, jed, label, bounded = false) => {
      const expected = reference(eph, jed);
      const sin = Math.sin;
      let calls = 0;
      try {
        // A deterministic work budget also prevents a regressed unbounded
        // solver from hanging the browser/test runner on the known hard case.
        if (bounded) Math.sin = x => {
          if (++calls > 128) throw new Error("CPU solve exceeded its work budget");
          return sin(x);
        };
        const actual = Orbit.getPosAtTime(eph, jed);
        const error = Math.hypot(...actual.map((value, axis) => value - expected[axis]));
        if (!Number.isFinite(error) || error > Math.max(1, eph.a * 100) * 1e-9) {
          failures.push({ label, error, actual, expected });
        }
        maxError = Math.max(maxError, error);
      } catch (error) { failures.push({ label, error: error.message }); }
      finally { Math.sin = sin; }
      maxSinCalls = Math.max(maxSinCalls, calls);
      cases++;
    };
    const base = { a: 1, e: 0, i: 0, W: 25, w: 10, wbar: 0,
      M: 0, n: 1, epoch: 2451545 };
    for (const wbar of [0, null, undefined]) {
      check({ ...base, wbar }, base.epoch, `longitude ${wbar}`, true);
    }
    check({ ...base, w: undefined }, base.epoch, "zero longitude without fallback fields", true);
    check({ ...base, e: 0.999, M: 0.013823007675795088 / rad }, base.epoch,
      "historical divergent Newton case", true);
    for (const e of [0, 0.0167, 0.8, 0.95, 0.999, 0.999999, 1 - Number.EPSILON]) {
      for (const M of [0, 1e-10, -1e-10, 0.1, -0.1, 1, 90, 180, -180, 359.99, -720.1]) {
        for (const offset of [0, 4097, -4097, 365250]) {
          check({ ...base, e, M, i: 37, W: 123, wbar: 45 }, base.epoch + offset,
            `e=${e}, M=${M}, offset=${offset}`, true);
        }
      }
    }
    for (const n of [undefined, null, 0, 0.7]) {
      check({ ...base, e: 0.3, n, P: 999 }, base.epoch - 4567, `mean motion ${n}`, true);
    }
    for (const planet of app.planets) {
      for (const jed of [2378861.5, 2451545, 2488070.5]) check(planet.ephemeris, jed, planet.options.name);
    }
    // CPU Orbit is the GPU suite's oracle. Independently check the actual
    // catalogue at past/current/future dates before trusting GPU comparisons.
    for (const eph of catalog) {
      for (const jed of [2378861.5, 2451545, 2488070.5]) check(eph, jed, "catalogue");
    }
    return { cases, maxError, maxSinCalls, failures: failures.slice(0, 12), failureCount: failures.length };
  });
  assert.equal(result.failureCount, 0, JSON.stringify(result, null, 2));
  return result;
};

exports.testScene = async page => {
  const result = await page.evaluate(() => {
    const { app } = window.test;
    const original = { jed: app.jed, speed: app.jedDelta };
    const first = app.planets.length;
    const children = new Set(app.scene.children);
    try {
      app.jedDelta = 0;
      // Use the real scene construction and frame/render path, including the
      // generated track. Both fixtures have analytically known apsides.
      app.addPlanets([0, 1 - Number.EPSILON].map(e => ({ name: `CPU regression ${e}`,
        size: 2, color: 0xffffff,
        ephemeris: { a: 1, e, i: 0, W: 25, wbar: 0, M: 0, P: 360, epoch: 2451545 },
      })));
      const positions = [2451545, 2451725, 2451365].map(jed => {
        app.jed = jed;
        app.render();
        return app.planets.slice(first).map(planet => planet.body.position.toArray());
      });
      const tracks = app.scene.children.filter(child => !children.has(child) && child.isLine);
      return { positions, tracks: tracks.map(track => {
        const values = Array.from(track.geometry.attributes.position.array);
        return { finite: values.every(Number.isFinite), first: values.slice(0, 3), last: values.slice(-3) };
      }) };
    } finally {
      for (const child of [...app.scene.children]) {
        if (!children.has(child)) {
          app.scene.remove(child); child.geometry.dispose(); child.material.dispose();
        }
      }
      app.planets.splice(first);
      app.jed = original.jed; app.render(); app.jedDelta = original.speed;
    }
  });
  result.positions.forEach((positions, date) => positions.forEach((actual, i) => {
    const e = i ? 1 - Number.EPSILON : 0;
    const expected = [date === 0 ? 100 * (1 - e) : -100 * (1 + e), 0, 0];
    assert(Math.hypot(...actual.map((value, axis) => value - expected[axis])) < 1e-6,
      `Rendered CPU planet ${i}, date ${date}: ${actual}`);
  }));
  assert.equal(result.tracks.length, 2);
  for (const track of result.tracks) {
    assert(track.finite, "Edge-case scene tracks contain only finite vertices");
    assert.deepEqual(track.first, track.last, "Edge-case scene tracks remain closed");
  }
  return result;
};

exports.testInvalidInputs = async page => {
  const result = await page.evaluate(() => {
    const { Orbit } = window.test;
    const base = { a: 1, e: 0.1, i: 0, W: 0, wbar: 0, M: 0, n: 1, epoch: 2451545 };
    const invalid = [null,
      ...["a", "e", "i", "W", "wbar", "M", "epoch"].flatMap(key =>
        [NaN, Infinity, "0"].map(value => ({ ...base, [key]: value }))),
      ...[{ a: 0 }, { a: -1 }, { e: -0.1 }, { e: 1 }, { e: 2 },
        { n: -1 }, { n: NaN, P: 360 }, { n: "1" }, { n: Infinity },
        { n: 0 }, { n: 0, P: 0 }, { n: undefined, P: -1 },
        { n: undefined, P: Infinity }, { n: undefined, P: "360" },
        { a: Number.MAX_VALUE }].map(patch => ({ ...base, ...patch }))];
    let rejected = 0;
    const failures = [];
    const expectRejection = (eph, jed, label) => {
      for (const method of ["getPosAtTime", "getOrbitGeometry"]) {
        try {
          const value = Orbit[method](eph, jed);
          value.dispose?.();
          failures.push(`${method} accepted ${label}`);
        } catch (error) {
          if (!(error instanceof RangeError)) failures.push(`${method}: unexpected ${error}`);
          else rejected++;
        }
      }
    };
    invalid.forEach((eph, i) => expectRejection(eph, base.epoch, `elements ${i}`));
    for (const jed of [NaN, Infinity, "2451545"]) expectRejection(base, jed, `date ${jed}`);
    expectRejection({ ...base, epoch: -Number.MAX_VALUE }, Number.MAX_VALUE, "overflowing elapsed time");
    return { rejected, failures };
  });
  assert.deepEqual(result.failures, []);
  return result;
};
