import * as THREE from "three";
import Orrery3D from "../src/js/Orrery3D";
import { REBASE_DAYS, REFERENCE_JED } from "../src/js/Asteroids";

const status = document.getElementById("status");
const nextFrame = () => new Promise(requestAnimationFrame);
const percentile = (values, p) => {
  const a = [...values].sort((a, b) => a - b);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
};
const summarize = values => ({ median: percentile(values, 0.5), p95: percentile(values, 0.95) });
let catalog, app, active, lastReport, running = false, interrupted = false;
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertAvailable() {
  assert(!interrupted, "Benchmark interrupted; keep the tab visible and the window size unchanged, then run again.");
  assert(document.visibilityState === "visible", "Keep the benchmark tab visible; discard interrupted runs.");
  assert(!app.contextLost, "Graphics connection lost; run again after recovery.");
}

function setup({ count, dpr = 1, camera = "overview", startJed = REFERENCE_JED }) {
  assert(Number.isSafeInteger(count) && count > 0, "Count must be a positive integer");
  assert(Number.isFinite(dpr) && dpr > 0 && Number.isFinite(startJed), "Invalid DPR/date");
  assert(["overview", "close"].includes(camera), `Unknown camera: ${camera}`);
  app.jed = startJed;
  app.renderer.setPixelRatio(dpr);
  app.renderer.setSize(innerWidth, innerHeight);
  app.camera.position.set(...(camera === "close" ? [100, 100, 80] : [500, 500, 400]));
  app.controls.target.set(0, 0, 0); app.controls.update();
  // Repeat exact records/positions: vertex and overlap load, not new real orbits.
  const data = Array.from({ length: count }, (_, i) => catalog[i % catalog.length]);
  const start = performance.now();
  app.setupAsteroids(data);
  active = { count, dpr, camera, startJed, setupMs: performance.now() - start };
}

function frame(jed, beforeRender, afterRender) {
  assertAvailable();
  const start = performance.now();
  let updated;
  app.renderFrame(jed, {
    afterAsteroids: () => { updated = performance.now(); },
    beforeRender, afterRender, trackFps: true,
  });
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
  assert(!running, "A benchmark is already running.");
  assertAvailable();
  const { warmup = 45, frames = 180, step = 1.5 } = options;
  assert(Number.isSafeInteger(warmup) && warmup >= 0 && Number.isSafeInteger(frames) && frames > 0 && Number.isFinite(step), "Invalid frame count/warmup/step");
  setup(options);
  running = true;
  const interrupt = () => { interrupted = true; };
  window.addEventListener("resize", interrupt);
  document.addEventListener("visibilitychange", interrupt);
  app.renderer.domElement.addEventListener("webglcontextlost", interrupt);
  let observer;
  const pending = [];
  const gl = app.renderer.getContext();
  try {
    // Warm shader compilation, buffers, JIT and GPU before starting measurements.
    for (let i = 0; i < warmup; i++) { await nextFrame(); frame(active.startJed + i * step); }
    const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const intervals = [], work = [], updates = [], gpuMs = [];
    const longTasks = [];
    observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) observer.observe({ type: "longtask" });
    let previous = await nextFrame();
    for (let i = 0; i <= frames; i++) {
      const now = await nextFrame();
      assertAvailable();
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
    // Outside the regular-frame samples: force the production phase refresh so
    // its occasional O(N) cost is visible even in short runs.
    const result = {
      ...active, repeat: options.repeat, warmup, frames, step,
      discovered: app.asteroidsDiscovered, calls: app.renderer.info.render.calls,
      points: app.renderer.info.render.points,
      fps: 1000 * intervals.length / intervals.reduce((sum, x) => sum + x, 0),
      frameMs: summarize(intervals), mainThreadMs: summarize(work), asteroidUpdateMs: summarize(updates),
      gpuMs: summarize(gpuMs), gpuSamples: gpuMs.length,
      longTasks: { count: longTasks.length, maxMs: Math.max(0, ...longTasks) }, phaseRefresh: null,
      samples: { intervals, work, updates, gpuMs },
    };
    const beforeRefresh = await nextFrame();
    const refresh = frame(app.asteroids.epoch + REBASE_DAYS + 1);
    result.phaseRefresh = { updateMs: refresh.update, mainThreadMs: refresh.work,
      frameIntervalMs: (await nextFrame()) - beforeRefresh,
      uploadBytes: app.asteroidsGeometry.attributes.elements.array.byteLength, intervalDays: REBASE_DAYS };
    assertAvailable();
    status.textContent = `GPU · ${options.count.toLocaleString()} objects · ${result.fps.toFixed(1)} FPS\nFrame p95: ${result.frameMs.p95.toFixed(2)} ms · CPU update median: ${result.asteroidUpdateMs.median.toFixed(2)} ms`;
    return result;
  } finally {
    pending.forEach(q => gl.deleteQuery(q));
    observer?.disconnect();
    window.removeEventListener("resize", interrupt);
    document.removeEventListener("visibilitychange", interrupt);
    app.renderer.domElement.removeEventListener("webglcontextlost", interrupt);
    interrupted = false;
    running = false;
  }
}

async function preview(options) {
  assert(!running, "A benchmark is already running.");
  setup(options);
  frame(active.startJed); await nextFrame(); frame(active.startJed);
  // Capture in the rendering task: the canvas drawing buffer is not preserved.
  return { points: app.renderer.info.render.points, calls: app.renderer.info.render.calls,
    image: options.capture ? app.renderer.domElement.toDataURL("image/png") : undefined };
}

const run = document.getElementById("run"), download = document.getElementById("download");
const countInput = document.getElementById("count");
download.onclick = () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" }));
  link.download = "orrery3d-benchmark.json"; link.click(); URL.revokeObjectURL(link.href);
};
run.onclick = async () => {
  run.disabled = true; countInput.disabled = true; download.disabled = true;
  status.textContent = "Measuring… Keep this tab visible.";
  try {
    const result = await measure({ count: Number(countInput.value), dpr: devicePixelRatio });
    lastReport = { timestamp: new Date().toISOString(), environment: environment(), results: [result] };
    download.disabled = false;
  } catch (error) { status.textContent = error.message; }
  finally { run.disabled = false; countInput.disabled = false; }
};
window.benchmark = {
  ready: fetch("/catalog.json").then(response => {
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
    return response.json();
  }).then(async data => {
    assert(Array.isArray(data) && data.length > 0, "Catalogue must be a nonempty array.");
    catalog = data.slice().sort((a, b) => a.disc - b.disc);
    // Use the real app, but own scheduling for a finite and repeatable workload.
    app = new Orrery3D({ container: document.getElementById("orrery"), jedDelta: 0, autoRender: false });
    app.gui.hide();
    await preview({ count: catalog.length, dpr: devicePixelRatio });
    status.textContent = `${catalog.length.toLocaleString()} catalogue entries loaded. Ready.`;
    run.disabled = false;
  }),
  measure, preview, environment,
};
window.benchmark.ready.catch(error => { status.textContent = `Unable to start benchmark: ${error.message}`; });
