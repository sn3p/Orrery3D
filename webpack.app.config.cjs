// Keep the base object import stable for fixture tests and benchmark compilers.
const base = require("./webpack.config.js");
const path = require("node:path");
const expectedOutput = path.join(__dirname, "dist");
const selectedCatalog = require("./scripts/catalog-selection.cjs");
const { prepareCatalog, catalogPlugins, stageCatalog, checkOutput } = require("./scripts/catalog.cjs");

module.exports = async (env, argv = {}) => {
  const filename = selectedCatalog();
  if (!filename) return base;
  if (Object.keys(argv).some(key => key.startsWith("static"))) {
    throw new Error("Configured catalogue development must serve static files from dist/.");
  }
  await checkOutput(filename, base.output.path);
  // One fixed selection per dev/watch process. Restart to select another pin.
  const prepared = await prepareCatalog(filename, { publicDefaults: true });
  const data = { apply(compiler) {
    // CLI overrides are applied after this async config returns. Check the
    // actual compiler destination before webpack can run its cleaner.
    if (path.resolve(compiler.options.output.path) !== expectedOutput) {
      throw new Error("Configured catalogue dev/watch output must remain dist/.");
    }
    if (compiler.options.devServer?.static?.directory !== expectedOutput) {
      throw new Error("Configured catalogue development must serve static files from dist/.");
    }
    compiler.hooks.afterEmit.tapPromise("VerifiedCatalogueFiles", () => stageCatalog(prepared, compiler.outputPath));
  } };
  return { ...base, plugins: [...catalogPlugins(base, prepared.runtime), data] };
};
