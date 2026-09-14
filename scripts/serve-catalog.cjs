const path = require("node:path");
const { serve } = require("../benchmarks/catalog-loading.cjs");
const directory = path.resolve(process.argv[2] || ".context/catalog-site");
serve(directory, Number(process.env.PORT || 3002)).then(({ url }) => {
  console.log("Catalog trial: " + url + " (rebuild after source/config changes)");
}).catch(error => { console.error(error); process.exitCode = 1; });
