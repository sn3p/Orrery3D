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

function transformFeedback(packed, dates, epoch = REFERENCE_JED) {
  // Execute the same orbit/colour GLSL on the GPU, and read the result back only
  // in validation, never in the performance loop.
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  const program = gl.createProgram();
  const vs = `#version 300 es
    precision highp float;
    in vec3 p; in vec3 q; in vec3 elements; in float discovery;
    uniform float time; uniform float discoveryTime; out vec3 positionOut; out vec3 colorOut;
    ${orbitGLSL}
    void main() {
      positionOut = orbitPosition(p, q, elements, time);
      colorOut = discoveryColor(discoveryTime, discovery, 200.0, vec3(0,1,0), vec3(${app.asteroidColor.r}));
      gl_Position = vec4(positionOut, 1); gl_PointSize = 1.0;
    }`;
  const shaders = [];
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; out vec4 c; void main(){c=vec4(1);}"]]) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    assert(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader); shaders.push(shader);
  }
  gl.transformFeedbackVaryings(program, ["positionOut", "colorOut"], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program); assert(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const sourceBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, sourceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(packed), gl.STATIC_DRAW);
  for (const [name, size, offset] of [["p", 3, 0], ["q", 3, 3], ["elements", 3, 6], ["discovery", 1, 9]]) {
    const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4);
  }
  const count = packed.length / 10;
  const feedback = gl.createTransformFeedback(); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
  const destination = gl.createBuffer(); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, destination);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * 6 * 4, gl.STREAM_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, destination);
  gl.enable(gl.RASTERIZER_DISCARD);
  const results = dates.map(jed => {
    gl.uniform1f(gl.getUniformLocation(program, "time"), jed - epoch);
    gl.uniform1f(gl.getUniformLocation(program, "discoveryTime"), jed - REFERENCE_JED);
    gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, count); gl.endTransformFeedback();
    const output = new Float32Array(count * 6);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
    assert(gl.getError() === gl.NO_ERROR, "Transform feedback WebGL error");
    return output;
  });
  gl.disable(gl.RASTERIZER_DISCARD); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.deleteBuffer(sourceBuffer); gl.deleteBuffer(destination); gl.deleteTransformFeedback(feedback);
  gl.deleteVertexArray(vao); gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return results;
}

async function validate() {
  const dates = [2378861.5, 2444270.5, REFERENCE_JED, REFERENCE_JED + 0.001,
    REFERENCE_JED + REBASE_DAYS - 0.001, REFERENCE_JED + REBASE_DAYS, REFERENCE_JED + REBASE_DAYS + 0.001,
    REFERENCE_JED, REFERENCE_JED - REBASE_DAYS + 0.001, REFERENCE_JED - REBASE_DAYS,
    REFERENCE_JED - REBASE_DAYS - 0.001, 2488070.5];
  const packed = pack(catalog);
  const cloud = new Asteroids(catalog, {
    jed: REFERENCE_JED, color: app.asteroidColor,
    discoveryColor: app.asteroidDiscoveryColor, discoveryDuration: 200,
  });
  const gpu = dates.map(jed => {
    cloud.update(jed);
    return transformFeedback(packedAttributes(cloud), [jed], cloud.epoch)[0];
  });
  cloud.dispose();
  const cpu = new Float64Array(catalog.length * 3);
  const errors = [], projectedErrors = [];
  let cpuMax = 0, gpuMax = 0, nonFinite = 0;
  app.camera.position.set(500, 500, 400); app.camera.lookAt(0, 0, 0); app.camera.updateMatrixWorld();
  const expectedVector = new THREE.Vector3(), actualVector = new THREE.Vector3();
  dates.forEach((jed, t) => {
    cpuPositions(packed, jed, cpu, catalog.length);
    for (let i = 0; i < catalog.length; i++) {
      const expected = Orbit.getPosAtTime(catalog[i], jed);
      const error = Math.hypot(...expected.map((v, axis) => v - gpu[t][i * 6 + axis]));
      const cpuError = Math.hypot(...expected.map((v, axis) => v - cpu[i * 3 + axis]));
      if (!Number.isFinite(error) || !Number.isFinite(cpuError)) nonFinite++;
      errors.push(error); gpuMax = Math.max(gpuMax, error); cpuMax = Math.max(cpuMax, cpuError);
      expectedVector.set(...expected).project(app.camera);
      actualVector.set(gpu[t][i * 6], gpu[t][i * 6 + 1], gpu[t][i * 6 + 2]).project(app.camera);
      if (Math.abs(expectedVector.x) <= 1 && Math.abs(expectedVector.y) <= 1 && Math.abs(expectedVector.z) <= 1) {
        projectedErrors.push(Math.hypot((expectedVector.x - actualVector.x) * innerWidth / 2, (expectedVector.y - actualVector.y) * innerHeight / 2));
      }
      const age = Math.max(0, Math.min(1, (jed - catalog[i].disc) / 200));
      for (let axis = 0; axis < 3; axis++) {
        const expectedColor = (axis === 1 ? 1 : 0) * (1 - age) + app.asteroidColor.r * age;
        assert(Math.abs(expectedColor - gpu[t][i * 6 + 3 + axis]) < 1e-4, "GPU discovery colour mismatch");
      }
    }
  });
  assert(nonFinite === 0 && cpuMax < 1e-5, "CPU orbit equivalence failed");
  const screenMaximum = projectedErrors.reduce((a, b) => Math.max(a, b), 0);
  assert(screenMaximum < 0.25, `GPU overview error exceeds 0.25 CSS pixels: ${screenMaximum}`);
  // Discovery boundaries, reverse time, pause, fade completion and a fresh setup.
  const sample = catalog[50000], discovery = sample.disc;
  const sequence = [discovery - 1, discovery, discovery + 100, discovery + 200, discovery + 201,
    discovery + 100, discovery - 1, discovery, discovery, catalog[0].disc - 1];
  const counts = [];
  for (const mode of ["baseline", "cpu", "gpu"]) {
    setup({ mode, count: catalog.length });
    for (const jed of sequence) {
      frame(jed);
      const expected = catalog.filter(d => d.disc <= jed).length;
      assert(app.asteroidsDiscovered === expected, `${mode} discovery count at ${jed}`);
      assert(app.asteroidsGeometry.drawRange.count === expected, `${mode} draw range at ${jed}`);
      assert(app.renderer.info.render.points === expected, `${mode} submitted point count at ${jed}`);
      counts.push({ mode, jed, count: expected });
    }
  }
  // Explicit GPU colour boundary check, including reverse ordering and fractions.
  const colorDates = sequence.slice(0, 9).concat(discovery + 0.125);
  const colorOutput = transformFeedback(pack([sample]), colorDates);
  colorDates.forEach((jed, t) => {
    const age = Math.max(0, Math.min(1, (jed - discovery) / 200));
    for (let axis = 0; axis < 3; axis++) {
      const value = (axis === 1 ? 1 : 0) * (1 - age) + app.asteroidColor.r * age;
      assert(Math.abs(colorOutput[t][3 + axis] - value) < 1e-5, "GPU colour boundary failed");
    }
  });
  // Preserve the legacy fade regression as evidence; production fixes it.
  setup({ mode: "baseline", count: catalog.length });
  update(discovery + 199); update(discovery + 201);
  const sampleIndex = app.asteroidData.indexOf(sample);
  const actualColor = Array.from(app.asteroidsGeometry.attributes.color.array.slice(sampleIndex * 3, sampleIndex * 3 + 3));
  const rendered = validateRenderedOutput();
  return {
    dates, cataloguePositionsChecked: catalog.length * dates.length, nonFinite,
    cpuMaxWorldError: cpuMax, gpuMaxWorldError: gpuMax, gpuP95WorldError: percentile(errors, 0.95),
    gpuMaxOverviewCssPixelError: screenMaximum, gpuP95OverviewCssPixelError: percentile(projectedErrors, 0.95),
    discoveryChecks: counts.length, colorBoundaryChecks: colorDates.length,
    existingFadeBug: { actualColor, expectedColor: app.asteroidColor.toArray() },
    rendered, eccentricOrbits: validateEccentricOrbits(),
  };
}

function packedAttributes(cloud) {
  const attributes = cloud.geometry.attributes;
  const actual = new Float32Array(cloud.data.length * 10);
  for (let i = 0; i < cloud.data.length; i++) {
    actual.set(attributes.position.array.subarray(i * 3, i * 3 + 3), i * 10);
    actual.set(attributes.basisQ.array.subarray(i * 3, i * 3 + 3), i * 10 + 3);
    actual.set(attributes.elements.array.subarray(i * 3, i * 3 + 3), i * 10 + 6);
    actual[i * 10 + 9] = attributes.discovery.array[i];
  }
  return actual;
}

function validateEccentricOrbits() {
  const data = [0, 0.8, 0.961, 0.99, 0.9999, 0.99999994].flatMap(e =>
    [0, 0.000001, -0.000001, 0.0001, -0.0001, 1, -1, 179.999, -179.999].map(M => ({
      a: 1, e, M, i: 0, W: 0, wbar: 0, n: 1, epoch: REFERENCE_JED, disc: REFERENCE_JED,
    })));
  const cloud = new Asteroids(data, { jed: REFERENCE_JED, color: app.asteroidColor,
    discoveryColor: app.asteroidDiscoveryColor, discoveryDuration: 200 });
  const output = transformFeedback(packedAttributes(cloud), [REFERENCE_JED])[0];
  cloud.dispose();
  let maxWorldError = 0;
  data.forEach((d, i) => {
    // Independent double-precision bisection: deliberately not the GPU's
    // Newton solver or the legacy solver's unbounded convergence loop.
    const M = d.M * Math.PI / 180;
    let lo = -Math.PI, hi = Math.PI;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (mid - d.e * Math.sin(mid) < M) lo = mid; else hi = mid;
    }
    const E = (lo + hi) / 2;
    const expected = [100 * (Math.cos(E) - d.e), 100 * Math.sqrt(1 - d.e * d.e) * Math.sin(E), 0];
    const error = Math.hypot(...expected.map((v, axis) => v - output[i * 6 + axis]));
    assert(Number.isFinite(error) && error < 0.02, `Eccentric orbit error: e=${d.e}, M=${d.M}, error=${error}`);
    maxWorldError = Math.max(maxWorldError, error);
  });
  return { checks: data.length, maxWorldError };
}

function validateRenderedOutput() {
  const results = [];
  // Read actual rendered pixels, in addition to checking the shared maths shader.
  // Multisampling matches the main canvas; output is compared in linear space.
  const target = new THREE.WebGLRenderTarget(640, 400, { samples: 4 });
  for (const [camera, jed] of [["overview", REFERENCE_JED], ["close", REFERENCE_JED], ["overview", 2444270.5]]) {
    let baseline;
    for (const mode of ["baseline", "cpu", "gpu"]) {
      setup({ mode, count: catalog.length, camera });
      app.renderer.setRenderTarget(target);
      frame(jed);
      const pixels = new Uint8Array(640 * 400 * 4);
      app.renderer.readRenderTargetPixels(target, 0, 0, 640, 400, pixels);
      app.renderer.setRenderTarget(null);
      if (mode === "baseline") baseline = pixels;
      let absolute = 0, lit = 0, baselineLit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit++;
        if (baseline[i] || baseline[i + 1] || baseline[i + 2]) baselineLit++;
        for (let c = 0; c < 3; c++) absolute += Math.abs(pixels[i + c] - baseline[i + c]);
      }
      const meanChannelError = absolute / (640 * 400 * 3);
      assert(lit > 100 && Math.abs(lit - baselineLit) / baselineLit < 0.02,
        `${mode} rendered point coverage mismatch: ${lit} vs ${baselineLit} baseline pixels (${camera}, JED ${jed}, mean channel error ${meanChannelError})`);
      assert(meanChannelError < 0.25, `${mode} rendered colour/position mismatch: ${meanChannelError}`);
      results.push({ surface: "render-target", mode, camera, jed, litPixels: lit, meanChannelError });
    }
  }
  target.dispose();
  // Exercise the actual canvas and GPU -> CPU transition too. These readbacks
  // are correctness checks only, outside every timed measurement.
  let baseline;
  for (const mode of ["baseline", "cpu", "gpu", "cpu"]) {
    setup({ mode, count: catalog.length });
    frame(REFERENCE_JED);
    const gl = app.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    assert(gl.getError() === gl.NO_ERROR, `${mode} canvas readback failed`);
    if (mode === "baseline") baseline = pixels;
    let lit = 0, baselineLit = 0, absolute = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit++;
      if (baseline[i] || baseline[i + 1] || baseline[i + 2]) baselineLit++;
      for (let c = 0; c < 3; c++) absolute += Math.abs(pixels[i + c] - baseline[i + c]);
    }
    const meanChannelError = absolute / (pixels.length * 0.75);
    assert(lit > 100 && Math.abs(lit - baselineLit) / baselineLit < 0.02,
      `${mode} canvas coverage mismatch: ${lit} vs ${baselineLit}`);
    assert(meanChannelError < 0.25, `${mode} canvas colour/position mismatch: ${meanChannelError}`);
    results.push({ surface: "canvas", mode, camera: "overview", jed: REFERENCE_JED, litPixels: lit, meanChannelError });
  }
  return results;
}

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
    const report = { environment: environment(), validation: await validate(), results: [] };
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
  measure, validate, preview, environment,
};
