const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`The retirement server requires a value for ${name}.`);
  }
  return value;
}

function parseOptions(args = process.argv.slice(2)) {
  const host = option(args, "--host", "127.0.0.1");
  const port = Number(option(args, "--port", "3000"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The retirement server requires a valid --port.");
  }
  return { host, port };
}

async function handleRequest(request, response) {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", "Content-Length": "0" });
    response.end();
    return;
  }

  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  const roots = new Set(["/", "/index.html", "/Orrery3D", "/Orrery3D/", "/Orrery3D/index.html"]);
  const explicitFallbacks = new Set(["/404.html", "/Orrery3D/404.html"]);
  const found = roots.has(pathname) || explicitFallbacks.has(pathname);
  const filename = roots.has(pathname) ? "index.html" : "404.html";
  const body = await fs.readFile(path.join(output, filename));

  response.writeHead(found ? 200 : 404, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.length),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(method === "HEAD" ? undefined : body);
}

function start() {
  const { host, port } = parseOptions();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "Content-Length": "0" });
      response.end();
    });
  });

  server.listen(port, host, () => {
    process.stdout.write(`Orrery3D retirement notice: http://${host}:${port}/\n`);
  });

  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (require.main === module) start();

module.exports = { handleRequest, parseOptions };
