const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { gzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");
const fixtures = path.join(__dirname, "fixtures/consumer-v1");
const cases = require("./fixtures/consumer-v1/cases.json");
const identify = bytes => ({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("strict parsing does not retain the payload through legacy RegExp input", async () => {
  const { parseJSON } = await import("../src/js/catalog/contract.js");
  const text = '{"sample":"' + "x".repeat(10000) + '"}';
  assert.equal(parseJSON(text).sample.length, 10000);
  assert.equal(RegExp.input, "");
  for (const invalid of ['{"sample":"' + "x".repeat(10000) + '","sample":1}', "[".repeat(33) + "1" + "]".repeat(33)]) {
    assert.throws(() => parseJSON(invalid));
    assert.equal(RegExp.input, "");
  }
});

async function server(t, { gzip = false } = {}) {
  const overrides = new Map(), requests = [];
  const instance = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname.replace(/^\/Orrery3D/, "");
    requests.push(pathname);
    const override = overrides.get(pathname);
    if (override?.wait) await override.wait;
    if (res.destroyed) return;
    try {
      const bytes = override?.body ?? await fs.readFile(path.join(fixtures, pathname));
      res.writeHead(override?.status ?? 200, { "Content-Type": "application/json", ...(gzip ? { "Content-Encoding": "gzip" } : {}) });
      res.end(gzip ? gzipSync(bytes) : bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); });
  const url = "http://127.0.0.1:" + instance.address().port;
  const pin = (name = "ties", prefix = "") => ({ ...cases.bundles[name].pin, url: url + prefix + "/" + name + "/index.json" });
  return { overrides, requests, pin, url };
}

test("a verified file yields to the event loop before consumer preparation", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const host = await server(t);
  const source = await Source.open(host.pin(), { mode: "whole" });
  const descriptor = Object.getOwnPropertyDescriptor(performance, "measure");
  const measure = performance.measure.bind(performance);
  let yielded = false;
  Object.defineProperty(performance, "measure", { configurable: true, value: (...args) => {
    if (args[0] === "catalog:parse-validate") setTimeout(() => { yielded = true; }, 0);
    return measure(...args);
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(performance, "measure", descriptor);
    else delete performance.measure;
    source.close();
  });
  for await (const event of source.read({ start: 0, end: 6 })) {
    if (event.type === "batch") assert(yielded, "Parsing and synchronous consumer work must not share a task");
  }
});

test("browser task yields use posted messages and reads do not require AbortSignal.any", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const NativeMessageChannel = require("node:worker_threads").MessageChannel;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const channelDescriptor = Object.getOwnPropertyDescriptor(globalThis, "MessageChannel");
  const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  let channels = 0, closedPorts = 0;
  globalThis.window = {};
  globalThis.MessageChannel = class extends NativeMessageChannel {
    constructor() {
      super(); channels++;
      for (const port of [this.port1, this.port2]) {
        const close = port.close.bind(port);
        port.close = () => { closedPorts++; close(); };
      }
    }
  };
  Object.defineProperty(AbortSignal, "any", { configurable: true, value: undefined });
  t.after(() => {
    for (const [object, key, descriptor] of [[globalThis, "window", windowDescriptor],
      [globalThis, "MessageChannel", channelDescriptor], [AbortSignal, "any", anyDescriptor]]) {
      if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key];
    }
  });
  const host = await server(t);
  const source = await Source.open(host.pin(), { mode: "whole" });
  t.after(() => source.close());
  assert.equal((await collect(source.read({ start: 0, end: 6 }))).at(-1).type, "complete");
  assert.equal(channels, 2);
  assert.equal(closedPorts, 4, "Posted-message ports are released after each task");

  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(collect(source.read({ start: 0, end: 6 }, { signal: cancelled.signal })), { name: "AbortError" });
  let release;
  host.overrides.set("/ties/full/catalog.json", { wait: new Promise(resolve => { release = resolve; }) });
  const controller = new AbortController();
  const pending = collect(source.read({ start: 0, end: 6 }, { signal: controller.signal }));
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await delay(20); controller.abort(); await rejected; release();
  assert.equal(source.slots.active, 0);
});

test("all producer queries, ranges, empty and invalid requests in both modes, root/subpath and HTTP gzip", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  for (const gzip of [false, true]) for (const prefix of ["", "/Orrery3D"]) {
    const host = await server(t, { gzip });
    for (const mode of ["whole", "indexed"]) {
      const sources = {};
      for (const name of ["ties", "empty"]) {
        sources[name] = await Source.open(host.pin(name, prefix), { mode });
        assert.equal(sources[name].sourceId, cases.bundles[name].pin.sha256);
        assert(Object.isFrozen(sources[name].info.sources.mpcorb.decoded));
        assert.throws(() => Object.defineProperty(sources[name], "sourceId", { value: "wrong" }));
      }
      for (const query of cases.queries) assert.equal(sources[query.bundle].countThrough(query.through), query.requiredEnd);
      for (const request of cases.reads) {
        const source = sources[request.bundle];
        const records = JSON.parse(await fs.readFile(path.join(fixtures, request.bundle, "full/catalog.json")));
        const events = await collect(source.read(request));
        assert.equal(events.filter(event => event.type === "complete").length, 1);
        assert.deepEqual(events.at(-1), { type: "complete", catalogId: source.info.catalog_id, sourceId: source.sourceId,
          start: request.start, end: request.end });
        let next = request.start;
        for (const event of events.slice(0, -1)) {
          assert.equal(event.type, "batch"); assert.equal(event.start, next); assert(event.end > event.start);
          assert.equal(event.sourceId, source.sourceId); assert.equal(event.catalogId, source.info.catalog_id);
          assert.deepEqual(event.records, records.slice(event.start, event.end)); next = event.end;
        }
        assert.equal(next, request.end);
        assert.deepEqual(events.flatMap(event => event.type === "batch"
          ? Array.from({ length: event.end - event.start }, (_, i) => event.start + i) : []), request.expectedOrdinals);
      }
      for (const request of [...cases.invalid_requests, ...[NaN, Infinity, -Infinity, new Date()].map(through => ({ through }))]) {
        if (request.read) await assert.rejects(collect(sources.ties.read(request.read)));
        else assert.throws(() => sources.ties.countThrough(request.through));
      }
      for (const source of Object.values(sources)) { source.close(); source.close(); await assert.rejects(collect(source.read({ start: 0, end: 0 }))); }
      assert(!host.requests.some(url => url.endsWith(".gz")), "Runtime uses decoded JSON URLs only");
      assert(!host.requests.some(url => url === "/empty/full/catalog.json"));
    }
  }
});

test("trusted index before use: versions, types, duplicate/unknown keys, paths and reconciled metadata", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const host = await server(t);
  const original = await fs.readFile(path.join(fixtures, "ties/index.json"), "utf8");
  const index = JSON.parse(original);
  host.overrides.set("/ties/index.json", { body: Buffer.from(original + " ") });
  await assert.rejects(Source.open(host.pin()), /byte length/);
  for (const change of [
    i => { i.contract_version = 2; }, i => { i.schema_version = 2; }, i => { i.encoding = "binary"; },
    i => { i.counts.discovery_export = true; }, i => { i.producer.extra = 1; },
    i => { i.sources.mpcorb.decoded.bytes = "4176"; }, i => { i.selection.limit = 0; },
    i => { i.chunks[0].url = "../escape.json"; }, i => { i.full.gzip.url = "https://untrusted/"; },
    i => { i.chunks[1].start = 1; }, i => { i.chunks[0].last_disc = 0; },
    i => { i.date_counts[1][1] = 1; }, i => { i.chunk_bytes = 9 * 1024 * 1024; },
    i => { i.counts.missing_discovery++; }, i => { i.exclusions.discovery.missing_discovery_date++; },
    i => { i.catalog_id = [i.catalog_id]; }, i => { i.snapshot_version = [i.snapshot_version]; },
    i => { i.full.sha256 = [i.full.sha256]; }, i => { i.sources.mpcorb.decoded.sha256 = [i.sources.mpcorb.decoded.sha256]; },
    i => { i.sources.mpcorb.acquisition = "http"; }, i => { i.sources.mpcorb.decoded.bytes++; },
    i => { i.sources.mpcorb.url += "\n"; }, i => { i.sources.mpcorb.retrieved_at = "2026-02-31T00:00:00Z"; },
    i => { Object.assign(i.sources.mpcorb, { acquisition: "http", retrieved_at: "2026-02-01T00:00:00Z",
      resolved_url: i.sources.mpcorb.url, content_length: i.sources.mpcorb.bytes + 1 }); },
  ]) {
    const modified = structuredClone(index); change(modified);
    const body = Buffer.from(JSON.stringify(modified));
    host.overrides.set("/ties/index.json", { body });
    await assert.rejects(Source.open({ ...host.pin(), ...identify(body) }));
  }
  const duplicate = Buffer.from(original.replace('"contract_version":1', '"contract_version":2,"contract_vers\\u0069on":1'));
  host.overrides.set("/ties/index.json", { body: duplicate });
  await assert.rejects(Source.open({ ...host.pin(), ...identify(duplicate) }), /duplicate/);
  assert(host.requests.every(url => url.endsWith("index.json")), "Invalid metadata never requests payloads");
});

test("404, truncated, changed, oversized payloads and corrupt records never complete; retry works", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const host = await server(t);
  for (const mode of ["whole", "indexed"]) {
    const file = mode === "whole" ? "full/catalog.json" : "chunks/000000.json";
    const body = await fs.readFile(path.join(fixtures, "ties", file));
    for (const override of [{ status: 404, body: Buffer.from("missing") }, { body: body.subarray(0, -1) },
      { body: Buffer.from(body.toString().replace('"a":', '"z":')) }, { body: Buffer.concat([body, body]) }]) {
      const source = await Source.open(host.pin(), { mode });
      host.overrides.set("/ties/" + file, override);
      const events = [];
      await assert.rejects(async () => { for await (const event of source.read({ start: 0, end: 6 })) events.push(event); });
      assert(!events.some(event => event.type === "complete"));
      host.overrides.delete("/ties/" + file);
      assert.equal((await collect(source.read({ start: 0, end: 6 }))).at(-1).type, "complete");
      source.close();
    }
    for (const mutation of [rows => { rows[0].e = 1; }, rows => { rows[0].n = -1; },
      rows => { rows[0].M = "30"; }, rows => { rows[0].disc++; },
      rows => { rows.pop(); }, rows => { rows[0].extra = 1; }]) {
      const rows = JSON.parse(body); mutation(rows);
      const bytes = Buffer.from(JSON.stringify(rows));
      const index = JSON.parse(await fs.readFile(path.join(fixtures, "ties/index.json")));
      Object.assign(mode === "whole" ? index.full : index.chunks[0], identify(bytes));
      const indexBytes = Buffer.from(JSON.stringify(index));
      host.overrides.set("/ties/index.json", { body: indexBytes });
      host.overrides.set("/ties/" + file, { body: bytes });
      const source = await Source.open({ ...host.pin(), ...identify(indexBytes) }, { mode });
      await assert.rejects(collect(source.read({ start: 0, end: 6 })));
      source.close();
    }
    host.overrides.clear();
  }
});

test("read ordering, two global processing slots, abort isolation, opening lifetime and close", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const host = await server(t);
  const opening = new AbortController();
  const source = await Source.open(host.pin(), { signal: opening.signal });
  opening.abort(); // Open cancellation has no authority over subsequent reads.
  let release;
  host.overrides.set("/ties/chunks/000000.json", { wait: new Promise(resolve => { release = resolve; }) });
  const a = new AbortController(), b = new AbortController();
  const readA = collect(source.read({ start: 0, end: 4 }, { signal: a.signal }));
  const rejectedA = assert.rejects(readA, { name: "AbortError" });
  const readB = collect(source.read({ start: 2, end: 6 }, { signal: b.signal }));
  await delay(50);
  assert.equal(source.slots.active, 2);
  assert.equal(host.requests.filter(url => url.includes("/chunks/")).length, 2, "Ready later file holds its slot");
  a.abort();
  await rejectedA;
  const events = await readB;
  assert.deepEqual(events.filter(event => event.type === "batch").map(event => [event.start, event.end]), [[2, 4], [4, 6]]);
  release();
  await delay(10);
  assert.equal(source.slots.active, 0);
  const blocked = new Promise(resolve => { release = resolve; });
  host.overrides.set("/ties/chunks/000000.json", { wait: blocked });
  const pending = collect(source.read({ start: 0, end: 4 }));
  const closed = assert.rejects(pending, { name: "AbortError" });
  await delay(20); source.close(); source.close(); await closed; release();
  await assert.rejects(collect(source.read({ start: 0, end: 1 })));
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(Source.open(host.pin(), { signal: preAborted.signal }), { name: "AbortError" });
});

test("bundle verification rejects corruption and provisioning repairs stale generated copies", async t => {
  const { stageBundle, verifyBundle } = require("../scripts/catalog.cjs");
  const destination = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "orrery-catalog-"));
  t.after(() => fs.rm(destination, { recursive: true, force: true }));
  for (const name of ["ties", "empty"]) {
    const pin = cases.bundles[name].pin;
    const staged = await stageBundle(path.join(fixtures, name), pin, destination);
    const result = await verifyBundle(staged, pin);
    assert.equal(result.info.catalog_id, cases.bundles[name].catalog_id);
    await stageBundle(path.join(fixtures, name), pin, destination);
    await fs.appendFile(path.join(staged, "full/NOTICE.txt"), "changed");
    await assert.rejects(verifyBundle(staged, pin), /checksum/);
    assert.equal(await stageBundle(path.join(fixtures, name), pin, destination), staged);
    await verifyBundle(staged, pin);
    await fs.rm(path.join(staged, "index.json"));
    assert.equal(await stageBundle(path.join(fixtures, name), pin, destination), staged);
    await verifyBundle(staged, pin);

    const broken = path.join(destination, "broken-" + name);
    await fs.cp(path.join(fixtures, name), broken, { recursive: true });
    await fs.appendFile(path.join(broken, "full/NOTICE.txt"), "changed");
    await assert.rejects(stageBundle(broken, pin, path.join(destination, "other-cache")), /checksum/);
    await assert.rejects(stageBundle(broken, pin, destination), /checksum/);
    await verifyBundle(staged, pin);
    assert(!(await fs.readdir(destination)).some(name => name.startsWith(".staging-")));
  }
});

test("trial assembly retains unrelated webpack defines while replacing the trial setting", async t => {
  const { buildTrial, verifyBundle } = require("../scripts/catalog.cjs");
  const webpack = require("webpack"), base = require("../webpack.config.js");
  const directory = await fs.mkdtemp(path.resolve(__dirname, "../.context/define-preservation-"));
  const entry = path.join(directory, "entry.js"), config = path.join(directory, "config.json");
  const originalPlugins = base.plugins;
  base.plugins = base.plugins.map(plugin => plugin instanceof webpack.DefinePlugin
    ? new webpack.DefinePlugin({ ...plugin.definitions, __SAME_PLUGIN_DEFINE__: '"same plugin"' }) : plugin);
  base.plugins.push(new webpack.DefinePlugin({ __OTHER_PLUGIN_DEFINE__: '"other plugin"' }));
  t.after(async () => { base.plugins = originalPlugins; await fs.rm(directory, { recursive: true, force: true }); });
  await fs.writeFile(entry, "globalThis.catalogDefinitions = [__SAME_PLUGIN_DEFINE__, __OTHER_PLUGIN_DEFINE__, __CATALOG_TRIAL__.mode];");
  await fs.writeFile(config, JSON.stringify({ bundle: path.join(fixtures, "ties"), pin: cases.bundles.ties.pin, mode: "indexed" }));
  const result = await buildTrial(config, path.join(directory, "site"), { entry });
  const context = {};
  require("node:vm").runInNewContext(await fs.readFile(path.join(result.output, "bundle.js"), "utf8"), context);
  assert.equal(JSON.stringify(context.catalogDefinitions), JSON.stringify(["same plugin", "other plugin", "indexed"]));
  await verifyBundle(result.bundle, cases.bundles.ties.pin);
});

test("trial clean output rejects source and input locations before building", async t => {
  const { buildTrial } = require("../scripts/catalog.cjs");
  const config = path.resolve(__dirname, "../.context/clean-preflight/config.json");
  await fs.mkdir(path.dirname(config), { recursive: true });
  await fs.writeFile(config, JSON.stringify({ bundle: fixturePath(), pin: cases.bundles.ties.pin, mode: "indexed" }));
  t.after(() => fs.rm(path.dirname(config), { recursive: true, force: true }));
  for (const output of [".", "src", ".context", ".context/clean-preflight", ".context/catalog-cache/site"]) {
    await assert.rejects(buildTrial(config, path.resolve(output)), /output/);
  }
  function fixturePath() { return path.join(fixtures, "ties"); }
});
