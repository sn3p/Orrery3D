const assert = require("node:assert/strict");

exports.testManualRendering = async page => {
  const result = await page.evaluate(async () => {
    const { Orrery3D, catalog, REFERENCE_JED } = window.test;
    const app = new Orrery3D({ container: document.getElementById("orrery"), autoRender: false });
    const nextFrame = () => new Promise(requestAnimationFrame);
    let draws = 0;
    const draw = app.renderer.render.bind(app.renderer);
    app.renderer.render = (...args) => { draws++; return draw(...args); };
    try {
      app.setupAsteroids(catalog);
      app.jed = REFERENCE_JED;
      app.jedDelta = -1.5;
      app.controls.rotateLeft(0.1);
      app.controls.update();
      window.dispatchEvent(new Event("resize"));
      app.requestRender();
      await nextFrame(); await nextFrame();
      const automaticDraws = draws;
      app.render();
      await nextFrame(); await nextFrame();
      return { automaticDraws, explicitDraws: draws - automaticDraws,
        pendingFrame: app.animationFrame, points: app.renderer.info.render.points };
    } finally { app.dispose(); }
  });
  assert.equal(result.automaticDraws, 0, "Manual benchmark mode never schedules an app draw");
  assert.equal(result.explicitDraws, 1, "Explicit rendering does not start an animation loop");
  assert.equal(result.pendingFrame, null);
  assert.equal(result.points, 100000);
  return result;
};
