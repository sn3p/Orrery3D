const fs = require("node:fs");
const path = require("node:path");

module.exports = function selectedCatalog() {
  const filename = path.resolve(process.env.CATALOG_CONFIG || path.join(__dirname, "../catalog.config.json"));
  const config = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (!["indexed", "whole"].includes(config?.mode)) throw new Error("Choose indexed or whole mode.");
  return filename;
};
