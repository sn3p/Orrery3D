const assert = require("node:assert/strict");

// Independent Kepler bisection and successive plane rotations. Do not use the
// production solver or derived-period helper as the expected-position oracle.
function positionAt(eph, jed) {
  const rad = Math.PI / 180;
  const mean = eph.M * rad + (eph.n ? eph.n * rad : 2 * Math.PI / eph.P) * (jed - eph.epoch);
  const M = ((mean % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let lo = 0, hi = 2 * Math.PI;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid - eph.e * Math.sin(mid) < M) lo = mid;
    else hi = mid;
  }
  const E = (lo + hi) / 2;
  const x = eph.a * (Math.cos(E) - eph.e) * 100;
  const y = eph.a * Math.sqrt(1 - eph.e * eph.e) * Math.sin(E) * 100;
  const w = ((eph.wbar ?? (eph.w + eph.W)) - eph.W) * rad;
  const px = x * Math.cos(w) - y * Math.sin(w);
  const py = x * Math.sin(w) + y * Math.cos(w);
  const iy = py * Math.cos(eph.i * rad);
  return [
    px * Math.cos(eph.W * rad) - iy * Math.sin(eph.W * rad),
    px * Math.sin(eph.W * rad) + iy * Math.cos(eph.W * rad),
    py * Math.sin(eph.i * rad),
  ];
}

module.exports = async function checkOrbitTracks(page) {
  const cases = await page.evaluate(() => {
    const { app, Orbit } = window.test;
    const tracks = app.scene.children.filter(child => child.isLine);
    if (tracks.length !== app.planets.length) throw new Error("Each scene planet needs one orbit track");
    const capture = (line, eph, jed, label, parts) => ({
      label, eph, jed, parts,
      positions: Array.from(line.geometry.attributes.position.array),
      distances: Array.from(line.geometry.attributes.lineDistance.array),
      dashed: line.material.isLineDashedMaterial,
      dashSize: line.material.dashSize,
      gapSize: line.material.gapSize,
    });
    // These are the tracks created by the real fetch/boot entry point, before
    // playback advances. They must also survive a fresh page reload correctly.
    const start = app.startDate.getTime() / 86400000 + 2440587.5;
    const result = app.planets.map((planet, i) => capture(tracks[i], planet.ephemeris,
      start, `scene ${planet.options.name}`, Orbit.getOrbitResolution(planet.ephemeris)));
    for (const planet of app.planets) {
      for (const jed of [2451545, 2378861.5, 2488070.5]) {
        const line = Orbit.createOrbit(planet.ephemeris, jed);
        result.push(capture(line, planet.ephemeris, jed,
          `${planet.options.name} at ${jed}`, Orbit.getOrbitResolution(planet.ephemeris)));
        line.geometry.dispose(); line.material.dispose();
      }
    }
    const eph = app.planets[2].ephemeris;
    // Mean motion takes precedence over P, and must also work without P.
    for (const P of [undefined, 999]) {
      const synthetic = { ...eph, n: 0.7, P };
      const line = Orbit.createOrbit(synthetic);
      result.push(capture(line, synthetic, 2451545, `mean motion, P=${P}`,
        Orbit.getOrbitResolution(synthetic)));
      line.geometry.dispose(); line.material.dispose();
    }
    for (const base of [1, 20000]) {
      const geometry = Orbit.getOrbitGeometry(eph, 2451545, base);
      result.push({ label: `resolution ${base}`, eph, jed: 2451545,
        parts: base === 1 ? 32 : 1024, positions: Array.from(geometry.attributes.position.array) });
      geometry.dispose();
    }
    return result;
  });
  let verticesChecked = 0;
  for (const { label, eph, jed, parts, positions, distances, dashed, dashSize, gapSize } of cases) {
    assert.equal(positions.length, (parts + 1) * 3, `${label}: include the closing vertex`);
    assert.deepEqual(positions.slice(-3), positions.slice(0, 3), `${label}: exact closure`);
    const period = eph.n ? 360 / eph.n : eph.P;
    const tolerance = Math.max(1, eph.a * 100) * 2e-7;
    for (let i = 0; i < parts; i++) {
      const expected = positionAt(eph, jed + period * i / parts);
      const actual = positions.slice(i * 3, i * 3 + 3);
      assert(Math.hypot(...actual.map((value, axis) => value - expected[axis])) < tolerance,
        `${label}: vertex ${i} follows the planet's period and ellipse`);
      verticesChecked++;
    }
    if (distances) {
      assert(dashed && dashSize === 5 && gapSize === 3, `${label}: preserve dashed styling`);
      assert.equal(distances.length, parts + 1, `${label}: dash distances include closure`);
      let length = 0;
      for (let i = 0; i <= parts; i++) {
        if (i) length += Math.hypot(...positions.slice(i * 3, i * 3 + 3)
          .map((value, axis) => value - positions[(i - 1) * 3 + axis]));
        assert(Math.abs(distances[i] - length) < Math.max(1, length) * 1e-6,
          `${label}: continuous dash distance at vertex ${i}`);
      }
      assert(distances[parts] > distances[parts - 1], `${label}: closing segment has length`);
    }
  }
  return { sceneTracks: 6, casesChecked: cases.length, verticesChecked };
};
