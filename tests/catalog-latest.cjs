const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const fixtures = path.join(__dirname, "fixtures/browser-v1");
const collect = async source => {
  const records = [];
  for await (const event of source.read({ start: 0, end: source.info.counts.discovery_export })) {
    if (event.type === "batch") records.push(...event.records);
  }
  return records;
};

async function host(t) {
  let current = "ties";
  const overrides = new Map(), requests = [];
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname.replace(/^\/shared\//, "");
    requests.push({ path: pathname, cacheControl: req.headers["cache-control"] });
    const override = overrides.get(pathname);
    if (override?.wait) await override.wait;
    if (res.destroyed) return;
    try {
      const body = override?.body ?? await fs.readFile(path.join(fixtures, current, pathname));
      res.writeHead(override?.status ?? 200, { "Content-Type": "application/json", ...(override?.headers || {}) });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}/shared/latest.json`, requests, overrides,
    select(name) { current = name; } };
}

test("shared latest discovery opens verified chunks, preserves ties, and refreshes on reopening", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const server = await host(t), first = await Source.openLatest(server.url);
  t.after(() => first.close());
  assert.equal(first.info.browser_contract_version, 1);
  assert.equal(first.countThrough(2451544.5), 4);
  assert.equal((await collect(first)).length, 6);
  assert(server.requests[0].cacheControl?.includes("max-age=0"), "Discovery must revalidate on every open");
  assert(!server.requests.some(req => req.path.includes("full/") || req.path === "catalog.json"));
  await assert.rejects(Source.open({ ...JSON.parse(await fs.readFile(path.join(fixtures, "ties/latest.json"))).index,
    url: first.url }, { mode: "whole" }), /whole-file mode unavailable/);
  server.select("empty");
  const second = await Source.openLatest(server.url);
  t.after(() => second.close());
  assert.notEqual(first.sourceId, second.sourceId);
  assert.equal(first.info.counts.discovery_export, 6, "Existing source keeps its identity and counts");
  assert.equal(second.info.counts.discovery_export, 0);
  assert.deepEqual(await collect(second), []);
  await assert.rejects(collect(first), /404/, "Retired chunks fail rather than mixing source versions");
});

test("latest discovery fails closed for bad descriptors, payloads and cancelled requests", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const server = await host(t);
  for (const override of [
    { body: "x", status: 503 }, { body: "", status: 204 }, { body: "x".repeat(4097) },
    { body: '{"browser_contract_version":1,"browser_contract_version":1,"index":{}}' },
    { body: JSON.stringify({ browser_contract_version: 2, index: {} }) },
    { body: "redirect", status: 302, headers: { Location: server.url + "?redirected" } },
  ]) {
    server.overrides.set("latest.json", override);
    await assert.rejects(Source.openLatest(server.url));
  }
  server.overrides.clear();
  const latest = JSON.parse(await fs.readFile(path.join(fixtures, "ties/latest.json")));
  for (const url of ["../index.json", "https://example.com/index.json", latest.index.url + "?changed"]) {
    server.overrides.set("latest.json", { body: JSON.stringify({ ...latest, index: { ...latest.index, url } }) });
    await assert.rejects(Source.openLatest(server.url), /file reference/);
  }
  server.overrides.clear();
  const indexBody = await fs.readFile(path.join(fixtures, "ties", latest.index.url), "utf8");
  server.overrides.set(latest.index.url, { body: indexBody.replace('"discovery_export":6', '"discovery_export":7') });
  await assert.rejects(Source.openLatest(server.url), /checksum/);
  server.overrides.clear();
  let release;
  server.overrides.set("latest.json", { wait: new Promise(resolve => { release = resolve; }) });
  const controller = new AbortController(), opening = Source.openLatest(server.url, { signal: controller.signal });
  controller.abort();
  await assert.rejects(opening, { name: "AbortError" });
  release();
  const requests = server.requests.length;
  for (const url of ["http://example.com/latest.json", "https://user:password@example.com/latest.json", server.url + "#fragment"]) {
    await assert.rejects(Source.openLatest(url), /latest URL/);
  }
  assert.equal(server.requests.length, requests, "Invalid discovery URLs must not be requested");
});

test("latest discovery accepts producer loopback URLs and rejects lookalikes before fetching", async t => {
  const { default: Source } = await import("../src/js/catalog/CatalogSource.js");
  const server = await host(t), original = globalThis.fetch, requested = [];
  // Exercise openLatest and its verified HTTP reads without requiring local
  // interface aliases or DNS for each supported loopback spelling.
  globalThis.fetch = (value, options) => {
    const url = new URL(value);
    requested.push(url.href);
    return original(new URL(url.pathname + url.search, server.url), options);
  };
  try {
    for (const origin of ["http://localhost", "http://localhost.", "http://LOCALHOST.", "http://127.0.0.0",
      "http://127.0.0.2", "http://127.255.255.255", "http://127.1", "http://2130706434", "http://[::1]", "https://example.com"]) {
      const source = await Source.openLatest(origin + "/shared/latest.json");
      try {
        assert.equal(new URL(source.url).hostname, new URL(origin).hostname);
        assert.equal((await collect(source)).length, 6);
      } finally { source.close(); }
    }
    const before = requested.length;
    for (const origin of ["http://localhost.example", "http://localhost..", "http://127.0.0.2.example",
      "http://126.255.255.255", "http://128.0.0.0", "http://192.168.1.1", "http://[::2]",
      "http://[::ffff:127.0.0.1]", "http://user@localhost", "ftp://localhost"]) {
      await assert.rejects(Source.openLatest(origin + "/shared/latest.json"), /latest URL/);
    }
    assert.equal(requested.length, before, "Rejected origins never reach fetch");
  } finally { globalThis.fetch = original; }
});
