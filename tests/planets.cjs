const assert = require("node:assert/strict");

module.exports = async function checkSaturnPosition(page) {
  const positions = await page.evaluate(() => {
    const { app } = window.test;
    const saturn = app.planets.find(planet => planet.options.name === "Saturn");
    if (!saturn || !app.scene.children.includes(saturn.body)) throw new Error("Saturn is missing from the scene");
    const original = { jed: app.jed, speed: app.jedDelta };
    try {
      app.jedDelta = 0;
      return [2451545, 2454234.805, 2448855.195].map(jed => {
        app.jed = jed;
        app.render();
        return saturn.body.position.toArray();
      });
    } finally {
      app.jed = original.jed;
      app.render();
      app.jedDelta = original.speed;
    }
  });
  // Independent bisection of Kepler's equation using M = L - wbar,
  // followed by orbital-plane rotations. World units: 100 per AU.
  // J2000, a quarter-period forward, then a quarter-period backward.
  const expected = [
    [641.5546167927974, 654.1377455743664, -36.90105591004567],
    [-751.1001963554454, 531.6205380165759, 20.560565514094243],
    [706.7054593797596, -693.1585990494149, -15.97803182322963],
  ];
  positions.forEach((position, i) => {
    const error = Math.hypot(...position.map((value, axis) => value - expected[i][axis]));
    assert(error < 1e-6, `Saturn render at date case ${i}: ${error} world units from expected position`);
  });
  return { datesChecked: positions.length };
};
