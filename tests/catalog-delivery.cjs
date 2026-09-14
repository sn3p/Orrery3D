const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const tar = require("tar");
const { gzipSync } = require("node:zlib");
const { acquireArchive, packBundle } = require("../scripts/catalog-archive.cjs");
const { verifyBundle, hashFile, buildTrial } = require("../scripts/catalog.cjs");
const cases = require("./fixtures/consumer-v1/cases.json");
const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures/consumer-v1");
const pin = cases.bundles.ties.pin;

async function temporary(t) {
  await fs.mkdir(path.join(root, ".context"), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, ".context/delivery-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function host(t, filename) {
  let body = await fs.readFile(filename), status = 200, requests = 0, interrupted = false, compressed = false;
  const server = http.createServer((req, res) => {
    requests++;
    res.writeHead(status, compressed ? { "Content-Encoding": "gzip" } : {});
    if (interrupted) { res.write(body.subarray(0, 20)); res.destroy(); }
    else res.end(compressed ? gzipSync(body) : body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}/bundle.tar.gz`,
    get requests() { return requests; }, body(value) { body = value; }, status(value) { status = value; },
    interrupt(value) { interrupted = value; }, compress(value) { compressed = value; } };
}

async function command(args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, CATALOG_CONFIG: "", ...env } });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const [code] = await once(child, "exit");
  return { code, output };
}
// npm is normally supplied by npm test. Direct node --test uses the sibling CLI.
function npmArgs(args) {
  const cli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  return [cli, ...args];
}

test("the ordinary app selects the full indexed catalogue without a local override", async () => {
  const result = await command(["-e", 'process.stdout.write(require("./scripts/catalog-selection.cjs")())']);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.output, path.join(root, "catalog.config.json"));
  const config = JSON.parse(await fs.readFile(result.output, "utf8"));
  assert.equal(config.mode, "indexed", "Normal commands must not return to the historical 100,000-object selection");
  assert.equal(config.pin.sha256, "bf4252e0e20b6db07df83a2d87f731788235067fbcd2d3a78c98f92083880db2");
  assert(!Object.hasOwn(config, "startJed"), "Keep the browser-local public starting date");
  assert(!Object.hasOwn(config, "speed"), "Keep the public playback speed");
});

test("pinned HTTP archive acquisition: complete cold/warm/repair, transfer errors and independent index trust", async t => {
  const directory = await temporary(t), filename = path.join(directory, "bundle.tar.gz");
  const digest = await packBundle(path.join(fixtures, "ties"), pin, filename);
  const server = await host(t, filename), archive = { ...digest, url: server.url };
  const cache = path.join(directory, "cache");
  const acquired = await acquireArchive(archive, pin, cache);
  await verifyBundle(acquired, pin);
  assert.equal(server.requests, 1);
  server.status(404);
  assert.equal(await acquireArchive(archive, pin, cache), acquired, "Warm verified cache works offline");
  assert.equal(server.requests, 1);
  await fs.rm(path.join(acquired, "chunks/000001.json"));
  await assert.rejects(acquireArchive(archive, pin, cache), /404/);
  assert(await fs.stat(path.join(acquired, "index.json")), "Failed repair preserves the existing cache");
  server.status(200); server.compress(true);
  await acquireArchive(archive, pin, cache); await verifyBundle(acquired, pin);
  assert.equal(server.requests, 3);
  for (const [name, reference, indexPin] of [
    ["hash", { ...archive, sha256: "0".repeat(64) }, pin],
    ["oversize", { ...archive, bytes: archive.bytes - 1 }, pin],
    ["short", { ...archive, bytes: archive.bytes + 1 }, pin],
    ["index", archive, { ...pin, sha256: "0".repeat(64) }],
  ]) await assert.rejects(acquireArchive(reference, indexPin, path.join(directory, name)));
  server.interrupt(true);
  await assert.rejects(acquireArchive(archive, pin, path.join(directory, "interrupted")));
  await verifyBundle(acquired, pin);
  assert(!(await fs.readdir(directory)).some(name => name.startsWith(".catalog-acquire-")));
});

test("a checksum-valid archive still rejects links, duplicate entries and incomplete producer inventory", async t => {
  const directory = await temporary(t), filename = path.join(directory, "invalid.tar.gz");
  const source = path.join(directory, "source");
  await fs.cp(path.join(fixtures, "ties"), source, { recursive: true });
  await fs.symlink("index.json", path.join(source, "link"));
  for (const entries of [["index.json", "link"], ["index.json", "index.json"], ["index.json"]]) {
    await tar.c({ file: filename, cwd: source, gzip: true, portable: true }, entries);
    const server = await host(t, filename);
    await assert.rejects(acquireArchive({ ...await hashFile(filename), url: server.url }, pin, path.join(directory, "cache")));
  }
});

test("archive redirects validate every destination, support relative chains and stop loops", async t => {
  const directory = await temporary(t), filename = path.join(directory, "bundle.tar.gz");
  const digest = await packBundle(path.join(fixtures, "ties"), pin, filename);
  const body = await fs.readFile(filename), requests = [];
  let location;
  const statuses = [301, 302, 303, 307, 308];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const step = /^\/chain\/(\d+)$/.exec(req.url);
    if (step && Number(step[1]) < statuses.length) {
      res.writeHead(statuses[Number(step[1])], { Location: String(Number(step[1]) + 1) });
    } else if (req.url === "/redirect") {
      res.writeHead(302, location === undefined ? {} : { Location: location });
    } else { res.end(body); return; }
    res.end("redirect body must not be used as the archive");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const archive = { ...digest, url: origin + "/redirect" };
  for (const [name, target] of [
    ["http", `http://0.0.0.0:${server.address().port}/forbidden`],
    ["credentials", origin.replace("//", "//user:password@") + "/forbidden"],
    ["fragment", origin + "/forbidden#fragment"],
    ["protocol", "file:///forbidden"],
  ]) {
    location = target; requests.length = 0;
    await assert.rejects(acquireArchive(archive, pin, path.join(directory, name)), /Use an HTTPS archive URL/);
    assert.deepEqual(requests, ["/redirect"], "Reject the destination before making its request");
  }
  requests.length = 0;
  const cache = path.join(directory, "valid");
  const acquired = await acquireArchive({ ...digest, url: origin + "/chain/0" }, pin, cache);
  await verifyBundle(acquired, pin);
  assert.deepEqual(requests, Array.from({ length: 6 }, (_, i) => "/chain/" + i));
  // Failed repair through redirects must preserve the previous cache contents.
  const chunk = path.join(acquired, "chunks/000001.json");
  await fs.writeFile(chunk, "damaged cache retained for inspection");
  for (const [target, expected, count] of [
    ["/redirect", /Too many catalogue archive redirects/, 6],
    [undefined, /Catalogue archive redirect has no Location/, 1],
    ["http://[invalid", /Invalid URL/, 1],
  ]) {
    location = target; requests.length = 0;
    await assert.rejects(acquireArchive(archive, pin, cache), expected);
    assert.equal(requests.length, count);
    assert.equal(await fs.readFile(chunk, "utf8"), "damaged cache retained for inspection");
  }
  assert(!(await fs.readdir(directory)).some(name => name.startsWith(".catalog-acquire-")));
});

test("private assembly preserves prior output on compile/final-copy failure and rejects concurrent replacement", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json"), output = path.join(directory, "site");
  await fs.writeFile(config, JSON.stringify({ bundle: path.join(fixtures, "ties"), pin, mode: "indexed" }));
  const entry = path.join(directory, "entry.js");
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_TRIAL__;");
  const built = await buildTrial(config, output, { entry, publicDefaults: true });
  assert(!Object.hasOwn(built.runtime, "startJed")); assert(!Object.hasOwn(built.runtime, "speed"));
  const before = await hashFile(path.join(output, "bundle.js"));
  await fs.writeFile(entry, "import './missing-module.js';");
  await assert.rejects(buildTrial(config, output, { entry }));
  assert.deepEqual(await hashFile(path.join(output, "bundle.js")), before);
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_TRIAL__;");
  const original = fs.copyFile;
  fs.copyFile = async (source, destination, ...args) => {
    if (destination.includes(".build-lock/site/data/")) throw new Error("Simulated staging failure");
    return original(source, destination, ...args);
  };
  try { await assert.rejects(buildTrial(config, output, { entry }), /Simulated staging failure/); }
  finally { fs.copyFile = original; }
  assert.deepEqual(await hashFile(path.join(output, "bundle.js")), before);
  await verifyBundle(built.bundle, pin);
  await fs.mkdir(output + ".build-lock");
  await assert.rejects(buildTrial(config, output, { entry }), /locked/);
  await fs.rm(output + ".build-lock", { recursive: true });
});

test("explicit retention survives update and rollback with each original pin", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json"), output = path.join(directory, "site");
  const entry = path.join(directory, "entry.js");
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_TRIAL__;");
  const profiles = ["ties", "empty"].map(name => ({ bundle: path.join(fixtures, name), pin: cases.bundles[name].pin }));
  const server = http.createServer(async (req, res) => {
    try { res.end(await fs.readFile(path.join(output, req.url))); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const opened = [];
  t.after(() => opened.forEach(source => source.close()));
  const collect = async read => { const rows = []; for await (const event of read) if (event.type === "batch") rows.push(...event.records); return rows; };
  for (const [current, retained] of [[0, 1], [1, 0], [0, 1]]) {
    await fs.writeFile(config, JSON.stringify({ ...profiles[current], mode: "indexed", retained: [profiles[retained]] }));
    await buildTrial(config, output, { entry, publicDefaults: true });
    for (const profile of profiles) await verifyBundle(path.join(output, "data/delivery-v1-" + profile.pin.sha256), profile.pin);
    if (opened.length === 0) {
      const source = await Source.open({ ...pin, url: `http://127.0.0.1:${server.address().port}/data/delivery-v1-${pin.sha256}/index.json` });
      opened.push(source);
      assert.equal((await collect(source.read({ start: 0, end: 2 }))).length, 2);
    } else {
      // Already-open source requests previously unfetched chunks after replacement.
      assert.equal((await collect(opened[0].read({ start: 2, end: 6 }))).length, 4);
      const other = profiles[1].pin;
      const source = await Source.open({ ...other, url: `http://127.0.0.1:${server.address().port}/data/delivery-v1-${other.sha256}/index.json` });
      opened.push(source);
      assert.equal((await collect(source.read({ start: 0, end: 0 }))).length, 0);
    }
  }
  await fs.writeFile(config, JSON.stringify({ ...profiles[0], mode: "indexed", retained: [profiles[1]] }));
  // The public command must keep old indexed clients alive during rollback.
  const rollback = await command(npmArgs(["run", "build", "--", "--output-clean"]), { CATALOG_CONFIG: config });
  assert.equal(rollback.code, 0, rollback.output);
  for (const profile of profiles) await verifyBundle(path.join(root, "dist/data/delivery-v1-" + profile.pin.sha256), profile.pin);
  const built = await buildTrial(config, output, { entry, publicDefaults: true });
  assert.equal(built.runtime.pin.sha256, profiles[0].pin.sha256);
  assert.equal((await collect(opened[0].read({ start: 2, end: 6 }))).length, 4);
});

test("standard indexed build selects configuration, omits historical asset, and fails closed for missing configuration", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json");
  await fs.writeFile(config, JSON.stringify({ bundle: path.join(fixtures, "ties"), pin, mode: "indexed" }));
  const result = await command(npmArgs(["run", "build", "--", "--output-clean"]), { CATALOG_CONFIG: config });
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /MODULE_TYPELESS_PACKAGE_JSON/, "Build must load catalogue modules with an explicit module type");
  await verifyBundle(path.join(root, "dist/data/delivery-v1-" + pin.sha256), pin);
  await assert.rejects(fs.stat(path.join(root, "dist/data/catalog.json")), { code: "ENOENT" });
  const previous = await hashFile(path.join(root, "dist/bundle.js"));
  for (const script of ["build", "serve", "watch"]) {
    const failed = await command(npmArgs(["run", script]), { CATALOG_CONFIG: path.join(directory, "missing.json") });
    assert.notEqual(failed.code, 0, script + " must reject an explicitly missing configuration");
  }
  assert.deepEqual(await hashFile(path.join(root, "dist/bundle.js")), previous);
});

test("shared runtime build needs no local bundle or data host and emits no historical dataset", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json");
  const latest = "http://127.0.0.1:9/shared/latest.json";
  await fs.writeFile(config, JSON.stringify({ mode: "indexed", latest }));
  const result = await command(npmArgs(["run", "build", "--", "--output-clean"]), { CATALOG_CONFIG: config });
  assert.equal(result.code, 0, result.output);
  assert((await fs.readFile(path.join(root, "dist/bundle.js"), "utf8")).includes(latest));
  await assert.rejects(fs.stat(path.join(root, "dist/data")), { code: "ENOENT" });
  const { prepareCatalog } = require("../scripts/catalog.cjs");
  assert.deepEqual(await prepareCatalog(config), { staged: [], runtime: { mode: "indexed", latest } });
  for (const invalid of [
    { mode: "whole", latest }, { mode: "indexed", latest, pin }, { mode: "indexed", latest, retained: [] },
    { mode: "indexed", latest, bundle: "missing" }, { mode: "indexed", latest: "http://example.com/latest.json" },
  ]) {
    await fs.writeFile(config, JSON.stringify(invalid));
    await assert.rejects(prepareCatalog(config));
  }
});

test("production source changes preserve every prior asset on a late compilation failure", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json");
  const output = path.join(root, "dist");
  await fs.writeFile(config, JSON.stringify({ mode: "indexed", latest: "http://127.0.0.1:9/latest.json" }));
  const initial = await command(npmArgs(["run", "build"]), { CATALOG_CONFIG: config });
  assert.equal(initial.code, 0, initial.output);
  await fs.writeFile(path.join(output, "previous-site.txt"), "Preserve the entire working site.");
  const inventory = async () => {
    const names = (await fs.readdir(output, { recursive: true, withFileTypes: true }))
      .filter(item => item.isFile()).map(item => path.relative(output, path.join(item.parentPath, item.name))).sort();
    return Promise.all(names.map(async name => ({ name, ...await hashFile(path.join(output, name)) })));
  };
  const before = await inventory();
  await fs.writeFile(config, JSON.stringify({ mode: "whole", bundle: path.join(fixtures, "ties"), pin }));
  const preload = path.join(directory, "late-failure.cjs");
  await fs.writeFile(preload, `require(${JSON.stringify(path.join(root, "webpack.config.js"))}).plugins.push({
    apply(compiler) { compiler.hooks.afterEmit.tap("SimulatedLateFailure", () => { throw new Error("Simulated late compilation failure"); }); }
  });`);
  const failed = await command(npmArgs(["run", "build", "--", "--output-clean"]),
    { CATALOG_CONFIG: config, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` });
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /Simulated late compilation failure/);
  assert.deepEqual(await inventory(), before, "Even emitted assets must stay private until the build succeeds");
  const restored = await command(npmArgs(["run", "build", "--", "--output-clean"]), { CATALOG_CONFIG: config });
  assert.equal(restored.code, 0, restored.output);
  await verifyBundle(path.join(output, "data/delivery-v1-" + pin.sha256), pin);
  assert((await fs.readFile(path.join(output, "bundle.js"), "utf8")).includes('mode:"whole"'));
  await assert.rejects(fs.stat(path.join(output, "previous-site.txt")), { code: "ENOENT" });
  await assert.rejects(fs.stat(output + ".build-lock"), { code: "ENOENT" });
});

test("removed historical mode rejects every public command without changing previous output", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json");
  await fs.writeFile(config, JSON.stringify({ mode: "indexed", latest: "http://127.0.0.1:9/latest.json" }));
  const built = await command(npmArgs(["run", "build"]), { CATALOG_CONFIG: config });
  assert.equal(built.code, 0, built.output);
  const output = path.join(root, "dist/bundle.js"), before = await hashFile(output);
  for (const settings of [{ mode: "historical" }, { mode: "historical", retained: [] }]) {
    await fs.writeFile(config, JSON.stringify(settings));
    for (const script of ["build", "serve", "watch", "catalog:build"]) {
      const result = await command(npmArgs(["run", script, ...(script === "catalog:build" ? ["--", config] : [])]),
        { CATALOG_CONFIG: config });
      assert.notEqual(result.code, 0, script + " must reject historical mode");
      assert.match(result.output, /Choose indexed or whole mode/);
      assert.deepEqual(await hashFile(output), before);
    }
  }
});

async function eventually(check, message) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch { /* Compilation/server startup in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

test("standard serve and watch keep the selected pin through source recompilation", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json"), entry = path.join(directory, "entry.js");
  const reads = path.join(directory, "reads.log"), preload = path.join(directory, "observe-reads.cjs");
  await fs.writeFile(preload, `const fs = require("node:fs"), original = fs.createReadStream;
    fs.createReadStream = function(filename, ...args) {
      if (String(filename).startsWith(${JSON.stringify(path.join(root, "dist/data") + path.sep)}))
        fs.appendFileSync(${JSON.stringify(reads)}, String(filename) + "\\n");
      return original.call(this, filename, ...args);
    };`);
  for (const [selection, clean] of [[{ bundle: path.join(fixtures, "ties"), pin }, false],
    [{ bundle: path.join(fixtures, "ties"), pin }, true], [{ latest: "http://127.0.0.1:9/latest.json" }, false]]) {
    await fs.writeFile(config, JSON.stringify({ ...selection, mode: "indexed" }));
    for (const script of ["serve", "watch"]) {
      await fs.writeFile(reads, "");
      await fs.writeFile(entry, 'globalThis.deliveryMarker = "delivery-before";');
      const probe = http.createServer();
      await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
      const port = probe.address().port;
      await new Promise(resolve => probe.close(resolve));
      const extra = script === "serve" ? ["--host", "127.0.0.1", "--port", String(port), "--no-open"] : [];
      if (clean) extra.push("--output-clean");
      const child = spawn(process.execPath, npmArgs(["run", script, "--", "--entry-reset", "--entry", "./src/index.js", "--entry", entry, ...extra]),
        { cwd: root, detached: true, env: { ...process.env, CATALOG_CONFIG: config, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` } });
      let log = "";
      child.stdout.on("data", chunk => { log += chunk; }); child.stderr.on("data", chunk => { log += chunk; });
      const stopped = once(child, "exit");
      const app = async () => script === "serve" ? (await fetch(`http://127.0.0.1:${port}/bundle.js`)).text()
        : fs.readFile(path.join(root, "dist/bundle.js"), "utf8");
      try {
        await eventually(async () => (await app()).includes("delivery-before"), script + " did not compile: " + log);
        if (script === "serve" && !selection.latest) {
          const data = await fetch(`http://127.0.0.1:${port}/data/delivery-v1-${pin.sha256}/index.json`);
          assert.equal(data.status, 200);
          assert.equal((await data.arrayBuffer()).byteLength, pin.bytes);
        }
        await eventually(() => /compiled successfully/.test(log), script + " did not finish initial staging");
        const initialReads = await fs.readFile(reads, "utf8"), initialCompilations = log.match(/compiled successfully/g).length;
        if (!selection.latest) assert(initialReads.length > 0, "Initial staging verifies on-disk data");
        await fs.writeFile(entry, 'globalThis.deliveryMarker = "delivery-after";');
        await eventually(async () => (await app()).includes("delivery-after"), script + " did not rebuild: " + log);
        await eventually(() => (log.match(/compiled successfully/g) || []).length > initialCompilations,
          script + " did not finish recompilation");
        const afterReads = await fs.readFile(reads, "utf8");
        if (clean) assert(afterReads.length > initialReads.length, "Clean output is staged and verified again");
        else assert.equal(afterReads, initialReads, "A source-only rebuild must not rehash unchanged catalogue files");
        if (!selection.latest) await verifyBundle(path.join(root, "dist/data/delivery-v1-" + pin.sha256), pin);
        assert((await app()).includes(selection.latest || pin.sha256), "Recompilation retains the configured runtime source");
      } catch (error) { throw new Error(error.message + "\n" + log, { cause: error }); } finally {
        try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        await stopped;
      }
      assert.doesNotMatch(log, /MODULE_TYPELESS_PACKAGE_JSON/, script + " must load catalogue modules with an explicit module type");
    }
  }
});

test("dev/watch CLI output overrides cannot clean source bundles or split data from the static root", async t => {
  const directory = await temporary(t), bundle = path.join(directory, "bundle"), config = path.join(directory, "config.json");
  await fs.cp(path.join(fixtures, "ties"), bundle, { recursive: true });
  await fs.writeFile(config, JSON.stringify({ bundle, pin, mode: "indexed" }));
  for (const script of ["serve", "watch"]) {
    const result = await command(npmArgs(["run", script, "--", "--output-path", bundle, "--output-clean"]), { CATALOG_CONFIG: config });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /output must remain dist/);
    await verifyBundle(bundle, pin);
  }
  const moved = await command(npmArgs(["run", "serve", "--", "--static-directory", directory]), { CATALOG_CONFIG: config });
  assert.notEqual(moved.code, 0);
  assert.match(moved.output, /static files from dist/);
});
