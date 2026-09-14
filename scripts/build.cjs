const { spawnSync } = require("node:child_process");
const selectedCatalog = require("./catalog-selection.cjs");

(async () => {
  const config = selectedCatalog();
  if (!config) {
    const child = spawnSync(process.execPath, [require.resolve("webpack-cli/bin/cli.js"),
      "--config", "webpack.config.js", "--mode", "production", ...process.argv.slice(2)], { stdio: "inherit" });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
    return;
  }
  if (process.argv.slice(2).some(arg => arg !== "--output-clean")) {
    throw new Error("Configured catalogue builds accept only --output-clean; their verified output is dist/.");
  }
  const result = await require("./catalog.cjs").buildTrial(config, "dist", { publicDefaults: true });
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
