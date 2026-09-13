const assert = require("node:assert/strict");

// Observe the actual WebGL calls made by the production renderer, including
// unchanged attributes. Array sizes or needsUpdate flags alone cannot prove
// what Three.js submits to the graphics driver.
module.exports = async function testPhaseUploads(page) {
  const result = await page.evaluate(() => {
    const { app, REFERENCE_JED, REBASE_DAYS } = window.test;
    const previous = { jed: app.jed, autoRender: app.autoRender };
    app.autoRender = false;
    app.cancelRender();
    const gl = app.renderer.getContext();
    const original = { bufferData: gl.bufferData, bufferSubData: gl.bufferSubData };
    const writes = [];
    const probes = [];
    const cloud = app.asteroids;
    const count = cloud.discoveryDates.length;
    try {
      // Warm the real scene after boot/replacement/context restoration, outside
      // the measured frames. Force an exact reference epoch for threshold cases.
      app.renderFrame(REFERENCE_JED - REBASE_DAYS * 2);
      app.renderFrame(REFERENCE_JED);
      for (const method of Object.keys(original)) {
        gl[method] = function (...args) {
          const data = args[method === "bufferData" ? 1 : 2];
          const offset = args[3] ?? 0;
          // WebGL2's optional source length of zero means the remaining data.
          const length = args[4] || (data.length - offset);
          const bytes = typeof data === "number" ? data : length * data.BYTES_PER_ELEMENT;
          const attribute = Object.entries(cloud.geometry.attributes).find(([, value]) => value.array === data)?.[0];
          writes.push({ method, bytes, attribute, target: args[0] });
          return original[method].apply(this, args);
        };
      }
      const checkFrame = (name, jed, refresh) => {
        writes.length = 0;
        app.renderFrame(jed);
        probes.push({ name, refresh, writes: writes.slice(), orbitTime: cloud.uniforms.orbitTime.value,
          expectedTime: jed - cloud.epoch, points: app.renderer.info.render.points,
          expectedPoints: Array.from(cloud.discoveryDates).filter(date => date <= jed).length });
      };
      checkFrame("ordinary", REFERENCE_JED + 1, false);
      checkFrame("exact forward threshold", REFERENCE_JED + REBASE_DAYS, false);
      checkFrame("forward refresh", REFERENCE_JED + REBASE_DAYS + 0.25, true);
      checkFrame("same date", app.jed, false);
      checkFrame("exact reverse threshold", cloud.epoch - REBASE_DAYS, false);
      checkFrame("reverse refresh", cloud.epoch - REBASE_DAYS - 0.25, true);
      checkFrame("large future jump", REFERENCE_JED + 100000, true);
      checkFrame("large past jump", REFERENCE_JED - 100000, true);
      checkFrame("return to reference", REFERENCE_JED, true);
      checkFrame("ordinary after jumps", REFERENCE_JED + 1, false);
      if (gl.getError() !== gl.NO_ERROR) throw new Error("Phase refresh produced a WebGL error");
      return { count, arrayBufferTarget: gl.ARRAY_BUFFER, probes };
    } finally {
      Object.assign(gl, original);
      app.renderFrame(previous.jed);
      app.autoRender = previous.autoRender;
      app.requestRender();
    }
  });
  for (const { name, refresh, writes, orbitTime, expectedTime, points, expectedPoints } of result.probes) {
    assert.equal(writes.length, refresh ? 1 : 0, `${name}: only refresh frames upload a buffer`);
    if (refresh) {
      assert.equal(writes[0].bytes, result.count * 4, `${name}: upload one Float32 per asteroid`);
      assert.equal(writes[0].attribute, "meanAnomaly", `${name}: fixed orbital attributes stay on the GPU`);
      assert.equal(writes[0].method, "bufferSubData", `${name}: update the existing allocation`);
      assert.equal(writes[0].target, result.arrayBufferTarget);
      assert.equal(orbitTime, 0);
    }
    assert.equal(orbitTime, expectedTime, `${name}: relative time matches the refreshed epoch`);
    assert.equal(points, expectedPoints, `${name}: discovery draw range follows the requested date`);
  }
  return result;
};
