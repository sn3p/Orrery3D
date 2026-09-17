const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { handleRequest, parseOptions } = require("../scripts/serve.cjs");

const root = path.resolve(__dirname, "..");

async function request(url, method = "GET") {
  let status;
  let headers;
  let body;
  const response = {
    headersSent: false,
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus;
      headers = nextHeaders;
      this.headersSent = true;
    },
    end(nextBody) {
      body = nextBody;
    },
  };

  await handleRequest({ method, url }, response);
  return { status, headers, body };
}

test("the local server exposes the retirement page at root and Pages subpaths", async () => {
  const expected = await fs.readFile(path.join(root, "dist", "index.html"));
  for (const url of ["/", "/index.html?from=run#notice", "/Orrery3D/", "/Orrery3D/index.html"]) {
    const result = await request(url);
    assert.equal(result.status, 200, url);
    assert.deepEqual(result.body, expected, url);
    assert.equal(result.headers["Content-Type"], "text/html; charset=utf-8");
  }
});

test("obsolete paths return the retirement fallback with a real 404 status", async () => {
  const expected = await fs.readFile(path.join(root, "dist", "404.html"));
  for (const url of ["/old/bookmark", "/Orrery3D/old/bookmark?mode=three#saved"]) {
    const result = await request(url);
    assert.equal(result.status, 404, url);
    assert.deepEqual(result.body, expected, url);
  }
});

test("the local server supports HEAD and rejects mutating methods", async () => {
  const head = await request("/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.ok(Number(head.headers["Content-Length"]) > 0);

  const post = await request("/", "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, "GET, HEAD");
  assert.equal(post.body, undefined);
});

test("Conductor Run selects the retirement server instead of the historical app", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const conductor = await fs.readFile(path.join(root, ".conductor", "settings.toml"), "utf8");

  assert.equal(packageJson.scripts.serve, "npm run build -- --output-clean && node scripts/serve.cjs");
  assert.doesNotMatch(packageJson.scripts.serve, /webpack/i);
  assert.match(packageJson.scripts["historical:serve"], /webpack serve/);
  assert.match(conductor, /command = 'npm run serve -- --host 127\.0\.0\.1 --port "\$\{CONDUCTOR_PORT:-3000\}" --no-open'/);
});

test("server options default to loopback and reject missing or invalid values", () => {
  assert.deepEqual(parseOptions([]), { host: "127.0.0.1", port: 3000 });
  assert.deepEqual(parseOptions(["--host", "localhost", "--port", "4321", "--no-open"]), {
    host: "localhost",
    port: 4321,
  });
  assert.throws(() => parseOptions(["--host"]), /requires a value for --host/);
  assert.throws(() => parseOptions(["--host", "--port", "4321"]), /requires a value for --host/);
  assert.throws(() => parseOptions(["--port"]), /requires a value for --port/);
  assert.throws(() => parseOptions(["--port", "0"]), /valid --port/);
  assert.throws(() => parseOptions(["--port", "not-a-port"]), /valid --port/);
});
