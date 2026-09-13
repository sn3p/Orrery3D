// Instrument the real benchmark entry without adding a test API to its bundle.
import Orrery3D from "../src/js/Orrery3D";
import "../benchmarks/browser";

let app, frames = [], capture = false, draws = 0;
const sharedFrame = Orrery3D.prototype.renderFrame;
Orrery3D.prototype.renderFrame = function(jed, hooks = {}) {
  app = this;
  if (!capture) return sharedFrame.call(this, jed, hooks);
  const events = [];
  const restorers = [];
  const wrap = (object, key, event) => {
    const original = object[key];
    restorers.push(() => { object[key] = original; });
    object[key] = function(...args) { events.push(event); return original.apply(this, args); };
  };
  let asteroidEnd, beforeDraw, afterDraw;
  wrap(this, "updateAsteroids", "asteroids");
  this.planets.forEach(planet => wrap(planet, "render", "planet"));
  wrap(this.renderer, "render", "draw");
  wrap(this.gui.stats, "update", "fps");
  wrap(this.gui, "update", "gui");
  try {
    const result = sharedFrame.call(this, jed, {
      ...hooks,
      afterAsteroids: () => { asteroidEnd = events.length; hooks.afterAsteroids?.(); },
      beforeRender: () => { beforeDraw = events.length; hooks.beforeRender?.(); },
      afterRender: () => { afterDraw = events.length; hooks.afterRender?.(); },
    });
    draws++;
    frames.push({ jed, events, asteroidEnd, beforeDraw, afterDraw, trackFps: hooks.trackFps,
      guiFps: document.getElementById("orrery-fps").textContent, fps: this.gui.stats.fps,
      points: this.renderer.info.render.points, count: this.asteroidsDiscovered });
    return result;
  } finally { restorers.reverse().forEach(restore => restore()); }
};

window.benchmarkProbe = {
  async verify() {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const steps = [1.5, 0, -1.5];
    const startJed = 2458600.5;
    capture = true;
    try {
      for (const step of steps) {
        frames = [];
        const result = await window.benchmark.measure({ count: 10000, dpr: 1, warmup: 2, frames: 3, step, startJed });
        check(frames.length === 6, "Only warmup, measured frames and separate phase refresh draw");
        check(JSON.stringify(frames.slice(0, 5).map(frame => frame.jed)) === JSON.stringify(Array.from({ length: 5 }, (_, i) => startJed + i * step)), "Benchmark dates use the fixed step");
        check(result.samples.intervals.length === 3 && result.samples.work.length === 3 && result.samples.updates.length === 3, "Warmup/refresh excluded from samples");
        check(result.samples.updates.every((time, i) => time >= 0 && time <= result.samples.work[i]), "Asteroid time is contained by total frame work");
        for (const frame of frames) {
          check(frame.events[0] === "asteroids" && frame.asteroidEnd === 1, "Asteroid timer excludes planets/draw/GUI");
          check(frame.events.slice(1, frame.beforeDraw).every(event => event === "planet") && frame.beforeDraw === app.planets.length + 1, "All planets update before drawing");
          check(frame.events[frame.beforeDraw] === "draw" && frame.afterDraw === frame.beforeDraw + 1, "GPU query brackets drawing alone");
          check(frame.events.slice(frame.afterDraw).join() === "fps,gui", "FPS and GUI remain inside total work, outside draw timing");
          check(frame.trackFps && frame.guiFps === `${frame.fps} FPS`, "Benchmark readout gets the current-frame FPS even at step zero");
          check(frame.count === 10000 && frame.points === frame.count, "Benchmark discovers and submits the selected catalogue");
        }
        check(app.animationFrame === null && app.clock.previous === null, "Benchmark does not start an app loop or playback clock");
      }
      // Exercise the previously lagging FPS readout through the real preview path.
      let now = 0;
      const performance = app.gui.stats.performance;
      try {
        app.gui.stats.performance = { now: () => now };
        app.gui.stats.reset();
        await window.benchmark.preview({ count: 10000, dpr: 1, startJed });
        now = 1001;
        await window.benchmark.preview({ count: 10000, dpr: 1, startJed });
        check(frames.slice(-2).every(frame => frame.fps === 3 && frame.guiFps === "3 FPS"), "Preview publishes a new FPS sample in that same frame");
      } finally { app.gui.stats.performance = performance; app.gui.stats.reset(); }
      const completed = draws;
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      check(draws === completed && app.animationFrame === null, "Completed finite benchmark stays idle");
      return { steps, drawsAfterCompletion: draws - completed };
    } finally { capture = false; frames = []; }
  },
};
