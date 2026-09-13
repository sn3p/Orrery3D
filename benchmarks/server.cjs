const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const webpack = require("webpack");
const root = path.resolve(__dirname, "..");

async function serve(port = 0, entry = path.join(__dirname, "browser.js")) {
  const output = path.join(root, ".context/benchmark/build");
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "production", entry,
      output: { path: output, filename: "benchmark.js" },
      performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
      else resolve();
    }));
  });
  const routes = {
    "/": [path.join(__dirname, "index.html"), "text/html"],
    "/benchmark.js": [path.join(output, "benchmark.js"), "text/javascript"],
    "/catalog.json": [path.join(root, "data/catalog.json"), "application/json"],
  };
  const server = http.createServer((req, res) => {
    const route = routes[new URL(req.url, "http://localhost").pathname];
    if (!route) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" });
    fs.createReadStream(route[0]).pipe(res);
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
module.exports = { serve };
if (require.main === module) serve(Number(process.env.PORT || 3001)).then(({ url }) => {
  console.log(`Benchmark: ${url}. Keep the tab visible while running.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
