const fs = require("node:fs");
const path = require("node:path");

module.exports = function selectedCatalog({ production = false } = {}) {
  const filename = path.resolve(process.env.CATALOG_CONFIG || path.join(__dirname, "../catalog.config.json"));
  const config = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (config?.mode === "historical") {
    if (Object.keys(config).some(key => !["mode", "retained"].includes(key))) throw new Error("Historical selection accepts only mode and retained bundles.");
    return !production && config.retained === undefined ? null : filename;
  }
  return filename;
};
