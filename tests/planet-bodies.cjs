const assert = require("node:assert/strict");

exports.testScene = async page => {
  const result = await page.evaluate(() => {
    const { app, Orbit } = window.test;
    const saved = { jed: app.jed, speed: app.jedDelta, autoRender: app.autoRender };
    const positions = app.planets.map(planet => planet.body.position);
    const renders = app.planets.map(planet => planet.render);
    const counts = { sqrt: 0, sin: 0, cos: 0, arrayResults: 0 };
    const staticPosition = Orbit.getPosAtTime;
    let maxError = 0, frames = 0;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    try {
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
      // Count only the orbital work inside the actual production frame path.
      // GPU updates, renderer internals and the independent comparisons are excluded.
      app.planets.forEach((planet, i) => {
        planet.render = function(jed) {
          const math = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos };
          for (const key of Object.keys(math)) Math[key] = value => {
            counts[key]++; return math[key](value);
          };
          Orbit.getPosAtTime = (...args) => {
            const value = staticPosition(...args);
            if (Array.isArray(value)) counts.arrayResults++;
            return value;
          };
          try { return renders[i].call(this, jed); }
          finally { Object.assign(Math, math); Orbit.getPosAtTime = staticPosition; }
        };
      });
      for (const jed of [2451545, 2451546, 2451544, 2378861.5, 2488070.5, 2451545]) {
        app.renderFrame(jed);
        frames++;
        app.planets.forEach((planet, i) => {
          check(planet.body.position === positions[i], "Planet position vector was replaced");
          const expected = Orbit.getPosAtTime(planet.ephemeris, jed);
          const error = Math.hypot(...planet.body.position.toArray().map((v, axis) => v - expected[axis]));
          maxError = Math.max(maxError, error);
          check(error < 1e-9, `${planet.options.name} cached position differs at ${jed}`);
        });
      }
      return { counts, frames, planets: app.planets.length, maxError };
    } finally {
      app.planets.forEach((planet, i) => { planet.render = renders[i]; });
      Orbit.getPosAtTime = staticPosition;
      app.jed = saved.jed; app.jedDelta = saved.speed; app.autoRender = saved.autoRender;
      app.resetClock(); app.render();
    }
  });
  assert.equal(result.counts.sqrt, 0, "Unchanged planetary elements must reuse their ellipse scale");
  assert.equal(result.counts.arrayResults, 0, "Planet frames must not allocate temporary position arrays");
  assert(result.counts.sin + result.counts.cos < 20 * result.frames * result.planets,
    "Planet frames exceed the trigonometry budget with repeated orbital-basis work");
  assert.equal(result.planets, 6);
  return result;
};

exports.testElementChanges = async page => {
  const result = await page.evaluate(() => {
    const { app, Orbit } = window.test;
    const planet = app.planets[0];
    const saved = { ephemeris: planet.ephemeris, jed: app.jed, speed: app.jedDelta, autoRender: app.autoRender };
    const position = planet.body.position;
    const base = { a: 1, e: 0, i: 0, W: 25, wbar: 0, M: 0, n: 1, P: 999, epoch: 2451545 };
    let cases = 0, rejected = 0;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const renderAndCheck = (eph, expected) => {
      planet.ephemeris = eph;
      app.renderFrame(base.epoch);
      check(planet.body.position === position, "Element updates preserve the mesh position vector");
      const error = Math.hypot(...position.toArray().map((v, i) => v - expected[i]));
      check(error < 1e-8, `Stale orbital elements: ${error}`);
      cases++;
    };
    try {
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
      renderAndCheck({ ...base }, [100, 0, 0]);
      planet.ephemeris.M = 90;
      renderAndCheck(planet.ephemeris, [0, 100, 0]);
      const inclined = { ...base, e: 0.3, i: 31, wbar: 12, w: 10, M: 23, epoch: base.epoch - 37 };
      for (const [initial, key, value] of [
        ...Object.entries({ a: 2, e: 0.8, i: 43, W: 72, wbar: 64, M: -73, epoch: base.epoch - 12, n: 0.7 })
          .map(([key, value]) => [inclined, key, value]),
        [{ ...inclined, wbar: undefined }, "w", 33],
        [{ ...inclined, n: 0, P: 360 }, "P", 720],
        [{ ...inclined, n: 0, P: 360 }, "n", 0.7],
        [inclined, "wbar", undefined],
      ]) {
        const eph = { ...initial };
        // The static API is independently validated against a bisection oracle
        // for all catalogue rows; it must remain uncached for mutable inputs.
        renderAndCheck(eph, Orbit.getPosAtTime(eph, base.epoch));
        // Change exactly one field on the existing object. Replacing the object
        // or changing several fields could hide a missing invalidation key.
        eph[key] = value;
        renderAndCheck(eph, Orbit.getPosAtTime(eph, base.epoch));
      }
      for (const patch of [{ a: -1 }, { e: 1 }, { wbar: undefined, w: null }, { n: NaN }, { epoch: Infinity }]) {
        const eph = { ...base };
        renderAndCheck(eph, [100, 0, 0]);
        Object.assign(eph, patch);
        try { app.renderFrame(base.epoch); throw new Error("Invalid changed elements were accepted"); }
        catch (error) { if (!(error instanceof RangeError)) throw error; rejected++; }
        check(Math.hypot(position.x - 100, position.y, position.z) < 1e-8, "Invalid changes moved the planet");
        Object.assign(eph, base);
        renderAndCheck(eph, [100, 0, 0]);
      }
      const first = Orbit.getPosAtTime(base, base.epoch);
      const second = Orbit.getPosAtTime(base, base.epoch);
      check(Array.isArray(first) && first !== second && first.join() === second.join(), "Static callers own fresh position arrays");
      return { cases, rejected, positionReused: true };
    } finally {
      planet.ephemeris = saved.ephemeris;
      app.jed = saved.jed; app.jedDelta = saved.speed; app.autoRender = saved.autoRender;
      app.resetClock(); app.render();
    }
  });
  assert.equal(result.rejected, 5);
  return result;
};

exports.testBodies = async page => {
  const result = await page.evaluate(() => {
    const { app, Sun, Planet } = window.test;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const bodies = app.scene.children.filter(body => body.isMesh);
    const expected = [[5, 0xffff00], [1.6, 0xeccd9e], [1.8, 0xeccd9e], [2.8, 0x98c0ff],
      [2.2, 0xffbc83], [4, 0xc5c3bd], [3.2, 0xeccd9e]];
    const inspect = (body, size, color, segments = 32) => {
      const params = body.geometry.parameters;
      check(body.isMesh && body.geometry.type === "SphereGeometry", "Body remains a sphere mesh");
      check(params.radius === size && params.widthSegments === segments && params.heightSegments === segments,
        "Sphere shape changed");
      check(body.material.isMeshBasicMaterial && body.material.color.getHex() === color, "Body material changed");
    };
    check(bodies.length === expected.length, "Sun and six planets are present");
    bodies.forEach((body, i) => inspect(body, ...expected[i]));
    check(bodies[0].position.length() === 0, "Sun remains at the origin");
    const custom = [new Sun(), new Planet(app.planets[0].ephemeris),
      new Sun({ size: 7, segments: 12, color: 0x123456 }),
      new Planet(app.planets[0].ephemeris, { size: 3, segments: 16, color: 0xabcdef })];
    try {
      inspect(custom[0].body, 5, 0xffff00);
      inspect(custom[1].body, 2, 0xffffff);
      inspect(custom[2].body, 7, 0x123456, 12);
      inspect(custom[3].body, 3, 0xabcdef, 16);
      const all = [...bodies, ...custom.map(body => body.body)];
      for (const key of ["geometry", "material"]) {
        check(new Set(all.map(body => body[key])).size === all.length, `Bodies unexpectedly share ${key}`);
      }
      let otherDisposals = 0;
      custom[1].body.geometry.addEventListener("dispose", () => otherDisposals++);
      custom[1].body.material.addEventListener("dispose", () => otherDisposals++);
      custom[0].body.geometry.dispose(); custom[0].body.material.dispose();
      check(otherDisposals === 0, "Disposing the Sun affects another body");
      return { sceneBodies: bodies.length, customBodies: custom.length, independentResources: true };
    } finally {
      custom.forEach(({ body }) => { body.geometry.dispose(); body.material.dispose(); });
    }
  });
  assert.equal(result.sceneBodies, 7);
  return result;
};
