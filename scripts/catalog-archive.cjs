// Transport container only: the producer's original bundle and index stay intact.
const fs = require("node:fs/promises");
const { createWriteStream } = require("node:fs");
const path = require("node:path");
const { Transform, Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const tar = require("tar");
const { verifyBundle, hashFile, stageBundle } = require("./catalog.cjs");
const root = path.resolve(__dirname, "..");
const MAX_BYTES = 1_000_000_000;

function validateArchive(archive) {
  if (!archive || !Number.isSafeInteger(archive.bytes) || archive.bytes < 1 || archive.bytes > MAX_BYTES
    || typeof archive.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(archive.sha256)) {
    throw new Error("An archive requires a trusted SHA-256 and byte length (at most 1 GB).");
  }
  const url = new URL(archive.url);
  if (url.username || url.password || url.hash || (url.protocol !== "https:"
    && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))) {
    throw new Error("Use an HTTPS archive URL (HTTP is allowed only for localhost tests).");
  }
  return url;
}

async function unpack(archive, directory, pin) {
  const names = new Set();
  let bytes = 0, inventoryError;
  // Inspect before writing. In addition to tar's safe defaults, this container
  // accepts regular producer files only, with no links, duplicate paths or roots.
  await tar.t({ file: archive, strict: true, onReadEntry(entry) {
    if (entry.type !== "File" || !/^(index\.json|full\/[A-Za-z0-9.-]+|chunks\/[0-9]+\.json(?:\.gz)?)$/.test(entry.path)
      || names.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0
      || names.size >= 10000 || (bytes += entry.size) > MAX_BYTES) {
      inventoryError = new Error("Invalid catalogue archive inventory.");
      return;
    }
    names.add(entry.path);
    if (entry.path === "index.json" && entry.size !== pin.bytes) inventoryError = new Error("Archive index length mismatch.");
  } });
  if (inventoryError) throw inventoryError;
  if (!names.has("index.json")) throw new Error("Archive has no index.json.");
  await fs.mkdir(directory);
  await tar.x({ file: archive, cwd: directory, strict: true, noMtime: true,
    filter: (name, entry) => entry.type === "File" && names.has(name) });
  await verifyBundle(directory, pin);
}

async function acquireArchive(archive, pin, cache = path.join(root, ".context/catalog-downloads")) {
  const url = validateArchive(archive);
  const { validateReference } = await import("../src/js/catalog/contract.js");
  validateReference(pin, "index.json");
  const destination = path.join(cache, "delivery-v1-" + pin.sha256);
  try { await verifyBundle(destination, pin); return destination; }
  catch { /* Repair a missing or damaged generated cache from verified input. */ }
  await fs.mkdir(path.dirname(cache), { recursive: true });
  const temporary = await fs.mkdtemp(path.join(path.dirname(cache), ".catalog-acquire-"));
  try {
    const filename = path.join(temporary, "bundle.tar.gz");
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error("Catalogue archive request failed: " + response.status);
    // Fetch transparently decodes HTTP Content-Encoding. The pin identifies
    // the archive body, independently of transfer encoding and Content-Length.
    let received = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, next) {
      received += chunk.length;
      next(received > archive.bytes ? new Error("Catalogue archive exceeds its pinned byte length.") : null, chunk);
    } }), createWriteStream(filename, { flags: "wx" }));
    const actual = await hashFile(filename);
    if (actual.bytes !== archive.bytes || actual.sha256 !== archive.sha256) throw new Error("Catalogue archive checksum mismatch.");
    const extracted = path.join(temporary, "bundle");
    await unpack(filename, extracted, pin);
    return await stageBundle(extracted, pin, cache);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

async function packBundle(bundle, pin, filename) {
  const { names } = await verifyBundle(bundle, pin);
  // Only the verified inventory; no local configuration, metadata or extra files.
  await tar.c({ file: filename, cwd: bundle, gzip: { level: 6 }, portable: true,
    noMtime: true, strict: true }, names);
  return hashFile(filename);
}

module.exports = { acquireArchive, packBundle };
