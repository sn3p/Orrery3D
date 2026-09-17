const fs = require("node:fs/promises");
const path = require("node:path");
const selectedCatalog = require("./catalog-selection.cjs");

(async () => {
  const config = selectedCatalog();
  const fallback = path.join(__dirname, "../retirement/404.html");
  if (process.argv.slice(2).some(arg => arg !== "--output-clean")) {
    throw new Error("Configured catalogue builds accept only --output-clean; their verified output is dist/.");
  }
  const result = await require("./catalog.cjs").buildTrial(config, "dist", {
    publicDefaults: true,
    stageOutput: output => fs.copyFile(fallback, path.join(output, "404.html")),
  });
  console.log(JSON.stringify({ ...result, fallback: "dist/404.html" }, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
