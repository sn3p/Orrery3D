import * as THREE from "three";
import Orrery3D from "../src/js/Orrery3D";
import Gui from "../src/js/Gui";
import Asteroids, { REBASE_DAYS } from "../src/js/Asteroids";
import PlaybackClock from "../src/js/PlaybackClock";
import LegacyAsteroids from "./legacy-asteroids";
import Orbit from "../src/js/Orbit";
import planets from "../src/js/planets";
import { pack, cpuPositions, discoveredCount, gpuMaterial, orbitGLSL, REFERENCE_JED } from "./orbits";

const status = document.getElementById("status");
const nextFrame = () => new Promise(requestAnimationFrame);
const percentile = (values, p) => {
  const a = [...values].sort((a, b) => a - b);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
};
const summarize = values => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95) });
let catalog, app, points, active, lastReport;

function initialize() {
  // Use the production scene, planet, GUI, asteroid setup and update methods.
  // Own the frame scheduler so each variant runs the same finite, timed workload.
  app = Object.create(Orrery3D.prototype);
  Object.assign(app, {
    container: document.getElementById("orrery"), jed: REFERENCE_JED, jedDelta: 1.5,
    planets: [], asteroidData: [], asteroidsDiscovered: 0, clock: new PlaybackClock(),
    updateAsteroidPosition: LegacyAsteroids.prototype.updateAsteroidPosition,
    updateAsteroidColor: LegacyAsteroids.prototype.updateAsteroidColor,
    asteroidColor: new THREE.Color(0x999999), asteroidDiscoveryColor: new THREE.Color(0x00ff00),
    asteroidDiscoveryDuration: 200,
  });
  app.gui = new Gui(app);
  app.createSystem();
  app.addPlanets(planets);
  window.addEventListener("resize", () => {
    app.camera.aspect = innerWidth / innerHeight;
    app.camera.updateProjectionMatrix();
    app.renderer.setSize(innerWidth, innerHeight);
  });
}

function dataFor(count) {
  // A repeat has the real elements, discovery date and exact same sky position.
  // This is a workload/overlap stress test, NOT an enlarged real catalogue.
  return Array.from({ length: count }, (_, i) => catalog[i % catalog.length]);
}

function setup({ mode, count, dpr = 1, camera = "overview", startJed = REFERENCE_JED }) {
  assert(["baseline", "cpu", "gpu", "frozen"].includes(mode), `Unknown mode: ${mode}`);
  assert(Number.isSafeInteger(count) && count > 0, "Count must be a positive integer");
  assert(Number.isFinite(dpr) && dpr > 0 && Number.isFinite(startJed), "Invalid DPR/date");
  assert(["overview", "close"].includes(camera), `Unknown camera: ${camera}`);
  if (points) {
    app.scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
  }
  app.asteroids = null;
  app.jed = startJed;
  app.renderer.setPixelRatio(dpr);
  app.renderer.setSize(innerWidth, innerHeight);
  app.camera.position.set(...(camera === "close" ? [100, 100, 80] : [500, 500, 400]));
  app.controls.target.set(0, 0, 0);
  app.controls.update();
  const start = performance.now();
  if (mode === "gpu") app.setupAsteroids(dataFor(count));
  else LegacyAsteroids.prototype.setupAsteroids.call(app, dataFor(count));
  points = app.scene.children.find(child => child.isPoints);
  const state = { mode, count, dpr, camera, startJed };
  if (mode === "cpu") {
    state.packed = pack(app.asteroidData);
    const { material, uniforms } = gpuMaterial(state.packed, app, mode === "gpu");
    points.material.dispose();
    points.material = material;
    state.uniforms = uniforms;
    // The CPU prototype does not maintain bounds after moving its positions.
    points.frustumCulled = false;
    if (mode === "cpu") app.asteroidsGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  }
  if (mode === "frozen") LegacyAsteroids.prototype.updateAsteroids.call(app);
  state.setupMs = performance.now() - start;
  active = state;
  return state;
}

function update(jed) {
  app.jed = jed;
  if (active.mode === "gpu") app.updateAsteroids();
  else if (active.mode === "baseline") LegacyAsteroids.prototype.updateAsteroids.call(app);
  else if (active.mode !== "frozen") {
    const count = discoveredCount(app.asteroidData, jed);
    app.asteroidsDiscovered = count;
    app.asteroidsGeometry.setDrawRange(0, count);
    active.uniforms.orbitTime.value = jed - REFERENCE_JED;
    if (active.mode === "cpu" && count) {
      const position = app.asteroidsGeometry.attributes.position;
      cpuPositions(active.packed, jed, position.array, count);
      position.clearUpdateRanges();
      position.addUpdateRange(0, count * 3);
      position.needsUpdate = true;
    }
  }
}

function frame(jed, beforeRender, afterRender) {
  const start = performance.now();
  update(jed);
  const updated = performance.now();
  app.planets.forEach(planet => planet.render(jed));
  beforeRender?.();
  app.renderer.render(app.scene, app.camera);
  afterRender?.();
  app.gui.update();
  return { update: updated - start, work: performance.now() - start };
}

function environment() {
  const gl = app.renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    userAgent: navigator.userAgent, three: THREE.REVISION,
    viewport: [innerWidth, innerHeight], nativeDpr: devicePixelRatio,
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    webglVersion: gl.getParameter(gl.VERSION),
    timerQueries: !!gl.getExtension("EXT_disjoint_timer_query_webgl2"),
    antialias: gl.getContextAttributes().antialias,
    catalogueCount: catalog.length, visibility: document.visibilityState,
    focused: document.hasFocus(),
  };
}

async function measure(options) {
  if (document.visibilityState !== "visible") throw new Error("Keep the benchmark tab visible.");
  const { warmup = 45, frames = 180, step = 1.5 } = options;
  assert(Number.isSafeInteger(warmup) && warmup >= 0 && Number.isSafeInteger(frames) && frames > 0 && Number.isFinite(step), "Invalid frame count/warmup/step");
  setup(options);
  // Warm shader compilation, buffers, JIT and GPU before starting measurements.
  for (let i = 0; i < warmup; i++) { await nextFrame(); frame(active.startJed + i * step); }
  const gl = app.renderer.getContext();
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const intervals = [], work = [], updates = [], gpuMs = [], pending = [];
  const longTasks = [];
  const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
  observer.observe({ type: "longtask" });
  let previous = await nextFrame();
  for (let i = 0; i <= frames; i++) {
    const now = await nextFrame();
    if (document.visibilityState !== "visible") throw new Error("Tab became hidden; discard this run.");
    if (i) intervals.push(now - previous);
    previous = now;
    if (i === frames) break;
    let query;
    const timing = frame(active.startJed + (warmup + i) * step,
      ext ? () => { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); } : undefined,
      ext ? () => { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); } : undefined);
    updates.push(timing.update); work.push(timing.work);
    if (ext && gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      pending.forEach(q => gl.deleteQuery(q)); pending.length = 0; gpuMs.length = 0;
    }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift(); gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
  }
  // No synchronous GPU waits inside timed frames.
  for (let i = 0; pending.length && i < 60; i++) {
    await nextFrame();
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { gpuMs.length = 0; break; }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = pending.shift(); gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q);
    }
  }
  pending.forEach(q => gl.deleteQuery(q));
  observer.disconnect();
  // Outside the regular-frame samples: force the production phase refresh so
  // its occasional O(N) cost is visible even in short comparisons.
  const result = {
    ...options, warmup, frames, step, setupMs: active.setupMs,
    discovered: app.asteroidsDiscovered, calls: app.renderer.info.render.calls,
    points: app.renderer.info.render.points,
    fps: 1000 * intervals.length / intervals.reduce((sum, x) => sum + x, 0),
    frameMs: summarize(intervals), mainThreadMs: summarize(work), asteroidUpdateMs: summarize(updates),
    gpuMs: summarize(gpuMs), gpuSamples: gpuMs.length,
    longTasks: { count: longTasks.length, maxMs: Math.max(0, ...longTasks) }, phaseRefresh: null,
    samples: { intervals, work, updates, gpuMs },
  };
  if (active.mode === "gpu") {
    const beforeRefresh = await nextFrame();
    const refresh = frame(app.asteroids.epoch + REBASE_DAYS + 1);
    result.phaseRefresh = { updateMs: refresh.update, mainThreadMs: refresh.work,
      frameIntervalMs: (await nextFrame()) - beforeRefresh,
      uploadBytes: app.asteroidsGeometry.attributes.elements.array.byteLength, intervalDays: REBASE_DAYS };
  }
  status.textContent = `${options.mode} · ${options.count.toLocaleString()} objects · ${result.fps.toFixed(1)} FPS\nFrame p95: ${result.frameMs.p95.toFixed(2)} ms · CPU update median: ${result.asteroidUpdateMs.median.toFixed(2)} ms`;
  return result;
}

function assert(condition, message) { if (!condition) throw new Error(message); }

async function preview(options) {
  setup(options);
  status.textContent = `Preview: ${options.mode} · ${options.count.toLocaleString()} objects`;
  frame(options.startJed ?? REFERENCE_JED); await nextFrame();
  frame(options.startJed ?? REFERENCE_JED);
  // Capture synchronously with rendering. The default WebGL drawing buffer is
  // not preserved; a later page screenshot can capture an incomplete preview.
  const image = options.capture ? app.renderer.domElement.toDataURL("image/png") : undefined;
  return { points: app.renderer.info.render.points, calls: app.renderer.info.render.calls, image };
}

function save(report) {
  lastReport = report; document.getElementById("download").disabled = false;
}
document.getElementById("download").onclick = () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" }));
  link.download = "orrery3d-benchmark.json"; link.click(); URL.revokeObjectURL(link.href);
};
document.getElementById("run").onclick = async () => {
  document.getElementById("run").disabled = true;
  try {
    const report = { environment: environment(), results: [] };
    for (const count of [10000, 100000, 500000, 1000000]) {
      for (const mode of ["baseline", "cpu", "gpu"]) {
        status.textContent = `Running ${mode}: ${count.toLocaleString()}…`;
        report.results.push(await measure({ mode, count, dpr: devicePixelRatio }));
      }
    }
    save(report); status.textContent = "Finished. Download JSON for all measurements.";
  } catch (error) { status.textContent = error.stack; }
  finally { document.getElementById("run").disabled = false; }
};
window.benchmark = {
  ready: fetch("/catalog.json").then(r => r.json()).then(data => {
    catalog = data.sort((a, b) => a.disc - b.disc); initialize(); status.textContent = `${catalog.length.toLocaleString()} catalogue entries loaded.`;
  }),
  measure, preview, environment,
};
