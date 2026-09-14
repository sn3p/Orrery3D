const selectedCatalog = require("./catalog-selection.cjs");

(async () => {
  const config = selectedCatalog({ production: true });
  if (process.argv.slice(2).some(arg => arg !== "--output-clean")) {
    throw new Error("Configured catalogue builds accept only --output-clean; their verified output is dist/.");
  }
  const result = await require("./catalog.cjs").buildTrial(config, "dist", { publicDefaults: true });
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
