// Same-pin catalog trial through the real configured boot and renderer.
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { gzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { buildTrial } = require("../scripts/catalog.cjs");
const root = path.resolve(__dirname, "..");

function observe() {
  window.catalogMetrics = { longTasks: [], frames: [], states: [] };
  const mark = performance.mark.bind(performance);
  performance.mark = function(name, options) {
    const entry = mark(name, options);
    if (name === "catalog:first-complete" && window.catalogMetrics.initialSubmissionMs === undefined) {
      window.catalogMetrics.initialSubmissionMs = entry.startTime;
      const gl = document.querySelector("canvas").getContext("webgl2");
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
          window.catalogMetrics.initialGpuMs = performance.now();
          gl.deleteSync(fence);
        } else if (status !== gl.WAIT_FAILED) setTimeout(poll, 1);
      };
      poll();
    }
    return entry;
  };
  new PerformanceObserver(list => {
    for (const task of list.getEntries()) window.catalogMetrics.longTasks.push({ start: task.startTime, duration: task.duration });
  }).observe({ type: "longtask", buffered: true });
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = callback => raf.call(window, timestamp => {
    window.catalogMetrics.frames.push(timestamp);
    callback(timestamp);
  });
  setInterval(() => {
    const app = window.catalogTest?.app, loader = app?.catalogLoader;
    if (loader?.source) window.catalogMetrics.states.push({ time: performance.now(), jed: app.jed,
      waiting: !!app.catalogWaiting, committed: loader.committedCount, count: app.asteroidsDiscovered,
      slots: loader.source.slots.active });
  }, 100);
}

async function serve(directory, port = 0) {
  const compressed = new Map();
  const traffic = [];
  const server = http.createServer(async (req, res) => {
    // Count encoded bodies actually written by the test origin, including
    // aborted/speculative requests. CDP can undercount cancelled compressed
    // responses, so retain its figures separately instead of treating them as
    // complete Pages-egress accounting.
    for (const method of ["write", "end"]) {
      const original = res[method];
      res[method] = function(chunk, ...args) {
        if (chunk) traffic.push({ time: Date.now(), bytes: Buffer.byteLength(chunk), url: req.url });
        return original.call(this, chunk, ...args);
      };
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.endsWith("/favicon.ico")) { res.writeHead(204); res.end(); return; }
    const relative = decodeURIComponent(url.pathname).replace(/^\/Orrery3D\//, "/");
    const file = path.resolve(directory, "." + (relative.endsWith("/") ? relative + "index.html" : relative));
    if (!file.startsWith(directory + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(file)];
      const headers = { "Content-Type": type || "application/octet-stream", "Cache-Control": "no-store" };
      if (type) {
        headers["Content-Encoding"] = "gzip";
        if (fs.existsSync(file + ".gz")) {
          headers["Content-Length"] = (await fsp.stat(file + ".gz")).size;
          res.writeHead(200, headers); fs.createReadStream(file + ".gz").pipe(res);
        } else {
          if (!compressed.has(file)) compressed.set(file, gzipSync(await fsp.readFile(file)));
          const bytes = compressed.get(file); headers["Content-Length"] = bytes.length;
          res.writeHead(200, headers); res.end(bytes);
        }
      } else { res.writeHead(200, headers); fs.createReadStream(file).pipe(res); }
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { server, traffic, url: "http://127.0.0.1:" + server.address().port + "/Orrery3D/" };
}

async function measure(browser, url, profile, seconds, traffic = []) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), session = await context.newCDPSession(page);
  const errors = [], transfers = [], requests = new Map(), memory = [];
  let origin, originWall;
  session.on("Network.requestWillBeSent", event => {
    if (origin === undefined) { origin = event.timestamp; originWall = event.wallTime * 1000; }
    requests.set(event.requestId, { url: event.request.url, received: 0 });
  });
  session.on("Network.dataReceived", event => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.received += event.encodedDataLength;
    transfers.push({ time: (event.timestamp - origin) * 1000, bytes: event.encodedDataLength, url: request.url });
  });
  session.on("Network.loadingFinished", event => {
    const request = requests.get(event.requestId);
    if (request) transfers.push({ time: (event.timestamp - origin) * 1000,
      bytes: Math.max(0, event.encodedDataLength - request.received), url: request.url });
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (profile === "10mbps-100ms") await session.send("Network.emulateNetworkConditions", {
    offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 10_000_000 / 8,
  });
  await page.addInitScript(observe);
  try {
    const started = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.bringToFront();
    let first, nextLog = 30, state;
    while (true) {
      const values = await Promise.all([session.send("Runtime.getHeapUsage"), page.evaluate(() => {
        const app = window.catalogTest?.app, loader = app?.catalogLoader;
        return { now: performance.now(), first: window.catalogMetrics.initialGpuMs,
          committed: loader?.committedCount, total: loader?.source?.info.counts.discovery_export, error: app?.statusError };
      })]);
      memory.push({ time: values[1].now, ...values[0] }); state = values[1];
      if (state.error) throw new Error("Catalog error: " + await page.locator("#orrery-status").textContent());
      if (state.first && !first) { first = state.first; console.log(JSON.stringify({ profile, initialMs: first })); }
      if (state.now >= nextLog * 1000) {
        console.log(JSON.stringify({ profile, seconds: nextLog, committed: state.committed }));
        nextLog += 30;
      }
      if (first && state.now >= seconds * 1000) break;
      if (Date.now() - started > Math.max(90000, (seconds + 90) * 1000)) throw new Error("Trial timed out.");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const playbackEnd = state.now;
    // Explicit late-date demand measures any remaining prefix through the same
    // loader. Report separately from timed playback; don't label this replay.
    const jumpStart = await page.evaluate(() => {
      const app = window.catalogTest.app;
      app.jedDelta = 0;
      app.jed = app.catalogLoader.source.info.date_counts.at(-1)[0];
      return performance.now();
    });
    while (true) {
      const [heap, state] = await Promise.all([session.send("Runtime.getHeapUsage"), page.evaluate(() => {
        const app = window.catalogTest.app;
        return { time: performance.now(), complete: app.catalogLoader.sceneComplete()
          && app.asteroidsDiscovered === app.catalogLoader.source.info.counts.discovery_export };
      })]);
      memory.push({ time: state.time, ...heap });
      if (state.complete) break;
      if (state.time - jumpStart > 120000) throw new Error("Late jump timed out.");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const fullAt = await page.evaluate(() => performance.now());
    await session.send("HeapProfiler.collectGarbage");
    const retained = await session.send("Runtime.getHeapUsage");
    // A finite full-population render window (speed resumes at the final date).
    await page.evaluate(() => { window.catalogTest.app.jedDelta = 1.5; });
    await new Promise(resolve => setTimeout(resolve, 3000));
    await page.evaluate(() => { window.catalogTest.app.jedDelta = 0; });
    const data = await page.evaluate(() => {
      const app = window.catalogTest.app, gl = app.renderer.getContext(), debug = gl.getExtension("WEBGL_debug_renderer_info");
      return { ...window.catalogMetrics, measures: performance.getEntriesByType("measure").filter(entry => entry.name.startsWith("catalog:"))
        .map(entry => ({ name: entry.name, start: entry.startTime, duration: entry.duration })),
        gpu: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        dpr: app.renderer.getPixelRatio(), sourceId: app.catalogLoader.source.sourceId,
        catalogId: app.catalogLoader.source.info.catalog_id,
        catalogCpuBytes: app.asteroids.discoveryDates.byteLength + app.asteroids.phases.byteLength
          + Object.values(app.asteroids.geometry.attributes).reduce((sum, attr) => sum + attr.array.byteLength, 0),
        nominalGpuBytes: Object.values(app.asteroids.geometry.attributes).reduce((sum, attr) => sum + attr.array.byteLength, 0) };
    });
    const bytesAt = time => transfers.filter(entry => entry.time <= time).reduce((sum, entry) => sum + entry.bytes, 0);
    const originBytesAt = time => traffic.filter(entry => entry.time - originWall <= time).reduce((sum, entry) => sum + entry.bytes, 0);
    const loading = data.measures;
    const attributableTasks = data.longTasks.filter(task => loading.some(operation =>
      operation.start < task.start + task.duration && operation.start + operation.duration > task.start));
    const bufferingMs = data.states.slice(1).reduce((sum, value, i) =>
      sum + (data.states[i].waiting ? value.time - data.states[i].time : 0), 0);
    const playbackBufferingMs = data.states.slice(1).reduce((sum, value, i) =>
      sum + (data.states[i].waiting && data.states[i].time >= first && value.time <= playbackEnd
        ? value.time - data.states[i].time : 0), 0);
    const fullFrames = data.frames.filter(time => time > fullAt + 500);
    const fullFps = fullFrames.length > 1 ? (fullFrames.length - 1) * 1000 / (fullFrames.at(-1) - fullFrames[0]) : 0;
    return { profile, initialMs: first, playbackEndMs: playbackEnd, lateJumpMs: fullAt - jumpStart, fullAtMs: fullAt,
      bytes: { at30s: seconds >= 30 ? bytesAt(30000) : null, at60s: seconds >= 60 ? bytesAt(60000) : null,
        at120s: seconds >= 120 ? bytesAt(120000) : null, full: bytesAt(fullAt) },
      originBodyBytes: { at30s: seconds >= 30 ? originBytesAt(30000) : null, at60s: seconds >= 60 ? originBytesAt(60000) : null,
        at120s: seconds >= 120 ? originBytesAt(120000) : null, full: originBytesAt(fullAt) },
      retained, retainedCpuBytes: retained.usedSize + retained.backingStorageSize,
      sampledPeakCpuBytes: Math.max(...memory.map(item => item.usedSize + item.backingStorageSize)),
      maxCatalogOperationMs: Math.max(0, ...loading.map(item => item.duration)),
      maxCatalogAssociatedTaskMs: Math.max(0, ...attributableTasks.map(item => item.duration)),
      maxPageTaskMs: Math.max(0, ...data.longTasks.map(item => item.duration)),
      bufferingMs, playbackBufferingMs, fullFps, errors, memory, transfers,
      originTraffic: traffic.map(entry => ({ ...entry, time: entry.time - originWall })), ...data };
  } finally { await context.close(); }
}

async function main() {
  const configs = process.argv.slice(2);
  if (!configs.length) throw new Error("Pass one or more local trial configuration JSON paths.");
  const seconds = Number(process.env.DURATION_SECONDS ?? 120);
  const output = path.resolve(process.env.OUTPUT || ".context/catalog-trial/measurements.json");
  const report = { timestamp: new Date().toISOString(), hardware: { platform: os.platform(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ram: os.totalmem() },
    base: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTree: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
    metricNotes: "Cold separate browser contexts, HTTP gzip including index/app, 1280x800 DPR1. initialSubmissionMs is renderer.render return; initialMs/initialGpuMs waits for a WebGL fence after that first complete scene, not compositor presentation. originBodyBytes counts encoded bodies submitted to origin writes, including aborted/speculative responses, excludes HTTP headers, and can precede delivery through Chrome throttling. CDP bytes include headers/partial downloads but can undercount cancelled gzip; retain both. Memory=Runtime usedSize+backingStorageSize, retained after forced GC; sampled peak ~250ms is a lower bound, excludes GPU/native allocations and may miss synchronous peaks. Catalog-associated long tasks overlap measured operations, not every millisecond is attributable. Timed playback then separate late jump and 3s full-population rendering; no phone certification.",
    results: [] };
  await fsp.mkdir(path.dirname(output), { recursive: true });
  for (const config of configs) {
    const mode = JSON.parse(await fsp.readFile(config)).mode;
    const directory = path.join(root, ".context/catalog-trial/site-" + mode);
    const built = await buildTrial(path.resolve(config), directory, { entry: "./tests/catalog-browser.js" });
    const bundle = await fsp.readFile(path.join(directory, "bundle.js"));
    const { server, url, traffic } = await serve(directory);
    const browser = await chromium.launch({ channel: "chrome", headless: process.env.HEADLESS === "1" });
    report.browser = browser.version(); report.headless = process.env.HEADLESS === "1";
    try {
      for (const profile of (process.env.PROFILES || "native,10mbps-100ms").split(",")) {
        console.log(JSON.stringify({ mode, profile, state: "starting" }));
        traffic.length = 0;
        const result = await measure(browser, url, profile, seconds, traffic);
        report.results.push({ mode, config: built.runtime, appBundleSha256: createHash("sha256").update(bundle).digest("hex"), ...result });
        await fsp.writeFile(output, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ mode, profile, initialMs: result.initialMs, retainedMB: result.retainedCpuBytes / 1e6,
          peakMB: result.sampledPeakCpuBytes / 1e6, maxCatalogMs: result.maxCatalogOperationMs, maxTaskMs: result.maxPageTaskMs,
          bytes: result.bytes, fullFps: result.fullFps }));
      }
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  }
}
module.exports = { serve, measure };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
