// Local, offline provisioning. Never resolves a mutable "latest" data release.
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createGunzip } = require("node:zlib");
const { isDeepStrictEqual } = require("node:util");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, ".context/catalog-cache");

async function hashFile(filename, decompress = false) {
  const input = createReadStream(filename), stream = decompress ? input.pipe(createGunzip()) : input;
  if (decompress) input.on("error", error => stream.destroy(error));
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) { digest.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: digest.digest("hex") };
}

async function verifyBundle(directory, pin) {
  const { parseJSON, validateIndex, verifyBytes, MAX_INDEX_BYTES, validateReference } = await import("../src/js/catalog/contract.js");
  validateReference(pin, "index.json");
  if (pin.bytes < 1 || pin.bytes > MAX_INDEX_BYTES) throw new Error("Invalid index size.");
  const regular = async file => {
    if (!(await fs.lstat(file)).isFile()) throw new Error("Expected regular file: " + file);
  };
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error("Expected real bundle directory.");
  await regular(path.join(directory, "index.json"));
  if ((await fs.stat(path.join(directory, "index.json"))).size !== pin.bytes) throw new Error("Index length mismatch.");
  const bytes = await fs.readFile(path.join(directory, "index.json"));
  await verifyBytes(bytes, pin);
  const info = validateIndex(parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const descriptors = [info.full, ...info.chunks];
  const references = [...Object.values(info.provenance), ...descriptors.flatMap(file => [file, file.gzip])];
  const names = ["index.json", "full/SHA256SUMS", ...references.map(file => file.url)].sort();
  const actual = [];
  for (const name of await fs.readdir(directory)) {
    const file = path.join(directory, name);
    if (name === "full" || name === "chunks") {
      if (!(await fs.lstat(file)).isDirectory()) throw new Error("Expected real directory: " + name);
      for (const child of await fs.readdir(file)) actual.push(name + "/" + child);
    } else actual.push(name);
  }
  if (!isDeepStrictEqual(actual.sort(), names)) throw new Error("Bundle inventory mismatch.");
  for (const name of names) await regular(path.join(directory, name));
  for (const ref of references) {
    const actual = await hashFile(path.join(directory, ref.url));
    if (actual.bytes !== ref.bytes || actual.sha256 !== ref.sha256) throw new Error("Artifact checksum mismatch: " + ref.url);
  }
  for (const ref of descriptors) {
    const decoded = await hashFile(path.join(directory, ref.gzip.url), true);
    if (decoded.bytes !== ref.bytes || decoded.sha256 !== ref.sha256) throw new Error("Gzip content mismatch: " + ref.url);
  }
  const manifest = parseJSON(await fs.readFile(path.join(directory, info.provenance.manifest.url), "utf8"));
  for (const key of ["selection", "counts", "exclusions", "sources", "snapshot_version", "schema_version"]) {
    if (!isDeepStrictEqual(manifest[key], info[key])) throw new Error("Manifest differs from index: " + key);
  }
  if (manifest.data_version !== info.catalog_id) throw new Error("Manifest catalog identity mismatch.");
  const fullRefs = references.filter(ref => ref.url.startsWith("full/"));
  for (const ref of fullRefs.filter(ref => ref.url !== "full/manifest.json")) {
    const entry = manifest.artifacts[path.basename(ref.url)];
    if (entry?.bytes !== ref.bytes || entry?.sha256 !== ref.sha256) throw new Error("Manifest artifact mismatch: " + ref.url);
  }
  // The producer uses Python/ASCII lexical sorting, independent of locale.
  const expected = fullRefs.map(ref => path.basename(ref.url)).sort()
    .map(name => fullRefs.find(ref => path.basename(ref.url) === name).sha256 + "  " + name + "\n").join("");
  if (await fs.readFile(path.join(directory, "full/SHA256SUMS"), "utf8") !== expected) throw new Error("SHA256SUMS mismatch.");
  return { info, names };
}

async function stageBundle(source, pin, destinationRoot = cache) {
  return (await stageVerifiedBundle(source, pin, destinationRoot, await verifyBundle(source, pin))).directory;
}

async function stageVerifiedBundle(source, pin, destinationRoot, verified) {
  source = path.resolve(source);
  destinationRoot = path.resolve(destinationRoot);
  if (source === destinationRoot || destinationRoot.startsWith(source + path.sep)
    || source.startsWith(destinationRoot + path.sep)) throw new Error("Source and staging directories must be disjoint.");
  const { names } = verified;
  await fs.mkdir(destinationRoot, { recursive: true });
  const destination = path.join(destinationRoot, "delivery-v1-" + pin.sha256);
  try { return { directory: destination, verified: await verifyBundle(destination, pin) }; }
  catch { /* A missing, incomplete or corrupt generated cache is replaceable. */ }
  const temp = await fs.mkdtemp(path.join(destinationRoot, ".staging-"));
  try {
    for (const name of names) {
      await fs.mkdir(path.dirname(path.join(temp, name)), { recursive: true });
      await fs.copyFile(path.join(source, name), path.join(temp, name));
    }
    verified = await verifyBundle(temp, pin);
    // Keep the old cache until its replacement is verified. Invalid source
    // files must never destroy an existing usable cache or deployment copy.
    await fs.rm(destination, { force: true, recursive: true });
    await fs.rename(temp, destination);
  } finally { await fs.rm(temp, { force: true, recursive: true }); }
  return { directory: destination, verified };
}

async function buildTrial(configPath, output = path.join(root, ".context/catalog-site"), { entry = "./src/index.js" } = {}) {
  output = path.resolve(output);
  // webpack clean recursively removes old files. Only generated app locations
  // are eligible; never clean a source checkout, config, input bundle or cache.
  if (output !== path.join(root, "dist") && !output.startsWith(path.join(root, ".context") + path.sep)) {
    throw new Error("Trial output must be dist or a generated directory inside .context.");
  }
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!["indexed", "whole"].includes(config.mode)) throw new Error("Choose indexed or whole mode.");
  const source = path.resolve(path.dirname(configPath), config.bundle);
  const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
  for (const protectedPath of [source, cache, path.resolve(configPath)]) {
    if (overlaps(output, protectedPath)) throw new Error("Trial output overlaps an input, config or cache.");
  }
  // Refuse symlinked output ancestors before the cleaner sees them.
  for (let directory = output; directory !== root; directory = path.dirname(directory)) {
    try { if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("Trial output must not traverse symlinks."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const staged = await stageVerifiedBundle(source, config.pin, cache, await verifyBundle(source, config.pin));
  const webpack = require("webpack"), base = require("../webpack.config.js");
  const runtime = { pin: { ...config.pin, url: "data/" + path.basename(staged.directory) + "/index.json" },
    mode: config.mode, startJed: config.startJed ?? 2444270.5, speed: config.speed ?? 1.5 };
  const plugins = base.plugins.map(plugin => plugin instanceof webpack.DefinePlugin
    && Object.hasOwn(plugin.definitions, "__CATALOG_TRIAL__")
    ? new webpack.DefinePlugin({ ...plugin.definitions, __CATALOG_TRIAL__: JSON.stringify(runtime) }) : plugin);
  await new Promise((resolve, reject) => {
    const compiler = webpack({ ...base, mode: "production", plugins, entry,
      output: { ...base.output, path: path.resolve(output), clean: true } });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
      else resolve();
    }));
  });
  // The cache survives webpack's clean. Copy original sidecars/provenance
  // afterward, then verify in the final deployment path.
  const deployed = await stageVerifiedBundle(staged.directory, config.pin,
    path.join(path.resolve(output), "data"), staged.verified);
  return { output: path.resolve(output), bundle: deployed.directory, runtime };
}

module.exports = { verifyBundle, stageBundle, buildTrial, hashFile };
if (require.main === module) {
  const [command, config, output] = process.argv.slice(2);
  if (command !== "build" || !config) {
    console.error("Usage: node scripts/catalog.cjs build CONFIG.json [OUTPUT_DIRECTORY]");
    process.exitCode = 1;
  } else buildTrial(path.resolve(config), output).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
