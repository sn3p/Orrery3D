const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "retirement", "index.html");
const output = path.join(root, "dist");

(async () => {
  if (process.argv.slice(2).some(arg => arg !== "--output-clean")) {
    throw new Error("The retirement build accepts only --output-clean and always writes to dist/.");
  }

  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output);
  await Promise.all([
    fs.copyFile(source, path.join(output, "index.html")),
    fs.copyFile(source, path.join(output, "404.html")),
  ]);

  process.stdout.write("Built the Orrery3D retirement site: dist/index.html, dist/404.html\n");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
