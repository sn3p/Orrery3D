// Complete pinned-bundle provisioning. Never resolves a mutable "latest" release.
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

async function prepareCatalog(configPath, { publicDefaults = false } = {}) {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!["indexed", "whole"].includes(config.mode)) throw new Error("Choose indexed or whole mode.");
  for (const key of ["startJed", "speed"]) {
    if (config[key] !== undefined && !Number.isFinite(config[key])) throw new Error("Invalid catalogue " + key + ".");
  }
  const playback = {};
  if (config.startJed !== undefined || !publicDefaults) playback.startJed = config.startJed ?? 2444270.5;
  if (config.speed !== undefined || !publicDefaults) playback.speed = config.speed ?? 1.5;
  if (Object.hasOwn(config, "latest")) {
    if (config.mode !== "indexed" || Object.keys(config).some(key => !["mode", "latest", "startJed", "speed"].includes(key))) {
      throw new Error("Latest catalogue selection accepts indexed mode, latest URL and optional date/speed only.");
    }
    const { validateLatestURL } = await import("../src/js/catalog/contract.js");
    const runtime = { mode: "indexed", latest: validateLatestURL(config.latest).href, ...playback };
    return { staged: [], runtime };
  }
  if (config.retained !== undefined && !Array.isArray(config.retained)) throw new Error("retained must be an array of pinned bundles.");
  const inputs = [config, ...(config.retained || [])];
  const staged = [];
  for (const input of inputs) {
    if (!input || (typeof input.bundle === "string") === !!input.archive) {
      throw new Error("Choose exactly one local bundle or pinned archive.");
    }
    const source = input.bundle !== undefined
      ? path.resolve(path.dirname(configPath), input.bundle)
      : await require("./catalog-archive.cjs").acquireArchive(input.archive, input.pin);
    const item = await stageVerifiedBundle(source, input.pin, cache, await verifyBundle(source, input.pin));
    if (!staged.some(other => other.pin.sha256 === input.pin.sha256)) staged.push({ ...item, pin: input.pin });
  }
  const runtime = { pin: { ...config.pin, url: "data/" + path.basename(staged[0].directory) + "/index.json" }, mode: config.mode, ...playback };
  return { staged, runtime };
}

function catalogPlugins(base, runtime) {
  const webpack = require("webpack");
  return base.plugins.map(plugin => plugin instanceof webpack.DefinePlugin
    && Object.hasOwn(plugin.definitions, "__CATALOG_TRIAL__")
    ? new webpack.DefinePlugin({ ...plugin.definitions, __CATALOG_TRIAL__: JSON.stringify(runtime) }) : plugin);
}

async function stageCatalog(prepared, output) {
  for (const item of prepared.staged) {
    await stageVerifiedBundle(item.directory, item.pin, path.join(output, "data"), item.verified);
  }
}

async function checkOutput(configPath, output) {
  if (output !== path.join(root, "dist") && !output.startsWith(path.join(root, ".context") + path.sep)) {
    throw new Error("Trial output must be dist or a generated directory inside .context.");
  }
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
  const sources = [config, ...(Array.isArray(config.retained) ? config.retained : [])]
    .filter(input => typeof input?.bundle === "string").map(input => path.resolve(path.dirname(configPath), input.bundle));
  for (const protectedPath of [...sources, cache, path.join(root, ".context/catalog-downloads"), path.resolve(configPath)]) {
    if (overlaps(output, protectedPath)) throw new Error("Trial output overlaps an input, config or cache.");
  }
  for (let directory = output; directory !== root; directory = path.dirname(directory)) {
    try { if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("Trial output must not traverse symlinks."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function buildTrial(configPath, output = path.join(root, ".context/catalog-site"),
  { entry = "./src/index.js", publicDefaults = false, stageOutput } = {}) {
  output = path.resolve(output);
  await checkOutput(configPath, output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  // A competing build must not replace this output. An interrupted lock retains
  // its private stage/previous output for inspection rather than deleting it.
  const lock = output + ".build-lock";
  try { await fs.mkdir(lock); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Catalogue output is locked: " + lock); throw error; }
  const temporary = path.join(lock, "site"), previous = path.join(lock, "previous");
  let preserveRecovery = false;
  try {
    const prepared = await prepareCatalog(configPath, { publicDefaults });
    const webpack = require("webpack"), base = require("../webpack.config.js");
    await new Promise((resolve, reject) => {
      const compiler = webpack({ ...base, mode: "production", plugins: catalogPlugins(base, prepared.runtime), entry,
        output: { ...base.output, path: temporary, clean: true } });
      compiler.run((error, stats) => compiler.close(() => {
        if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
        else resolve();
      }));
    });
    await stageCatalog(prepared, temporary);
    if (stageOutput) await stageOutput(temporary);
    let siteBytes = 0;
    for (const name of await fs.readdir(temporary, { recursive: true, withFileTypes: true })) {
      if (name.isFile()) siteBytes += (await fs.stat(path.join(name.parentPath, name.name))).size;
    }
    if (siteBytes > 900_000_000) throw new Error("Catalogue site exceeds its 900 MB Pages preparation budget.");
    let hadPrevious = false;
    try { await fs.rename(output, previous); hadPrevious = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await fs.rename(temporary, output); }
    catch (error) {
      if (hadPrevious) {
        try { await fs.rename(previous, output); }
        catch (restoreError) { preserveRecovery = true; throw new Error("Restore previous output from " + previous, { cause: restoreError }); }
      }
      throw error;
    }
    return { output, bundle: prepared.runtime?.pin ? path.join(output, "data", path.basename(prepared.staged[0].directory)) : null,
      runtime: prepared.runtime, siteBytes, retained: prepared.staged.slice(prepared.runtime?.pin ? 1 : 0).map(item => item.pin.sha256) };
  } finally { if (!preserveRecovery) await fs.rm(lock, { force: true, recursive: true }); }
}

module.exports = { verifyBundle, stageBundle, buildTrial, hashFile, prepareCatalog, catalogPlugins, stageCatalog, checkOutput };
if (require.main === module) {
  const [command, config, output] = process.argv.slice(2);
  if (command === "pack" && config && output) {
    (async () => {
      const settings = JSON.parse(await fs.readFile(config, "utf8"));
      if (typeof settings.bundle !== "string") throw new Error("Packing requires a local complete bundle.");
      const filename = path.resolve(output), bundle = path.resolve(path.dirname(config), settings.bundle);
      if (!filename.startsWith(path.join(root, ".context") + path.sep) || !filename.endsWith(".tar.gz")) {
        throw new Error("Archive output must be a .tar.gz file inside .context.");
      }
      if (filename.startsWith(bundle + path.sep)) throw new Error("Archive output must be outside the source bundle.");
      try { await fs.lstat(filename); throw new Error("Archive output already exists."); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const archive = await require("./catalog-archive.cjs").packBundle(bundle, settings.pin, filename);
      console.log(JSON.stringify({ filename, archive, pin: settings.pin }, null, 2));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  } else if (command !== "build" || !config) {
    console.error("Usage: node scripts/catalog.cjs build CONFIG.json [OUTPUT_DIRECTORY] | pack CONFIG.json OUTPUT.tar.gz");
    process.exitCode = 1;
  } else buildTrial(path.resolve(config), output).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
