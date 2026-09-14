// App-owned implementation of orrery-data consumer contract v1 (producer f6f4a1d).
export const MAX_INDEX_BYTES = 4 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const hash = value => typeof value === "string" && SHA.test(value);
const fields = "disc epoch a e i W w M n".split(" ");
const uint = value => Number.isSafeInteger(value) && value >= 0;
export const requireValue = (ok, label) => { if (!ok) throw new Error(`Invalid catalogue ${label}.`); };
export function keys(value, expected, optional = []) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value)
    && expected.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => expected.includes(key) || optional.includes(key)), "fields");
}

// Native parsing supplies JSON syntax checks. A bounded-depth lexical pass also
// rejects duplicate keys, including escaped aliases, which JSON.parse discards.
export function parseJSON(text) {
  const value = JSON.parse(text);
  const stack = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]/g;
  let match;
  try {
    while ((match = tokens.exec(text))) {
      const token = match[0], top = stack.at(-1);
      if (token === "{" || token === "[") {
        requireValue(stack.length < 32, "JSON nesting");
        stack.push(token === "{" ? { keys: new Set(), key: true } : {});
      } else if (token === "}" || token === "]") stack.pop();
      else if (token === ":" && top?.keys) top.key = false;
      else if (token === "," && top?.keys) top.key = true;
      else if (token[0] === '"' && top?.keys && top.key) {
        const key = JSON.parse(token);
        requireValue(!top.keys.has(key), "duplicate JSON key");
        top.keys.add(key);
      }
    }
  } finally {
    // Engines retain the last successful regexp input through legacy RegExp.$_.
    // Don't retain a whole-file JSON string on success or validation failure.
    /^$/.test("");
  }
  return value;
}

export function validateReference(ref, url) {
  keys(ref, ["url", "bytes", "sha256"]);
  requireValue(typeof ref.url === "string" && (!url || ref.url === url)
    && uint(ref.bytes) && hash(ref.sha256), "file reference");
}

export function validatePin(pin) {
  validateReference(pin);
  const url = new URL(pin.url);
  requireValue(["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    && pin.bytes > 0 && pin.bytes <= MAX_INDEX_BYTES, "index pin");
}

function payload(ref, url, chunk = false) {
  keys(ref, ["url", "bytes", "sha256", "gzip", ...(chunk ? ["start", "end", "first_disc", "last_disc"] : [])]);
  validateReference({ url: ref.url, bytes: ref.bytes, sha256: ref.sha256 }, url);
  requireValue(ref.bytes > 0, "payload size");
  validateReference(ref.gzip, url + ".gz");
}

function sourceMetadata(source) {
  keys(source, ["url", "retrieved_at", "acquisition", "etag", "last_modified", "content_length",
    "sha256", "bytes", "compression", "decoded"], ["resolved_url"]);
  for (const field of ["url", ...(Object.hasOwn(source, "resolved_url") ? ["resolved_url"] : [])]) {
    requireValue(typeof source[field] === "string" && !/\s/.test(source[field]) && /^https?:\/\//.test(source[field])
      && !!new URL(source[field]).hostname, "source URL");
  }
  requireValue(["local", "http"].includes(source.acquisition) && ["gzip", "none"].includes(source.compression)
    && hash(source.sha256) && uint(source.bytes), "source metadata");
  keys(source.decoded, ["sha256", "bytes"]);
  requireValue(hash(source.decoded.sha256) && uint(source.decoded.bytes), "decoded source");
  requireValue(source.retrieved_at === null || (typeof source.retrieved_at === "string"
    && /^\d{4}-\d\d-\d\d[Tt]\d\d:\d\d:\d\d(?:\.\d+)?(?:[Zz]|[+-]\d\d:\d\d)$/.test(source.retrieved_at)
    && Number.isFinite(Date.parse(source.retrieved_at))), "retrieval time");
  if (source.retrieved_at !== null) {
    const [year, month, day] = source.retrieved_at.slice(0, 10).split("-").map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    requireValue(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
      && Number(source.retrieved_at.slice(11, 13)) <= 23, "retrieval calendar date");
  }
  for (const key of ["etag", "last_modified"]) requireValue(source[key] === null || typeof source[key] === "string", key);
  requireValue(source.content_length === null || uint(source.content_length)
    || (typeof source.content_length === "string" && /^[0-9]+$/.test(source.content_length)), "content length");
  requireValue(source.acquisition !== "http" || (source.retrieved_at !== null && Object.hasOwn(source, "resolved_url")), "HTTP provenance");
  requireValue(source.acquisition !== "http" || source.content_length === null
    || Number(source.content_length) === source.bytes, "HTTP source length");
  requireValue(source.compression !== "none" || (source.bytes === source.decoded.bytes && source.sha256 === source.decoded.sha256), "uncompressed source");
}

export function countThrough(info, date) {
  requireValue(Number.isFinite(date), "Julian day");
  const dates = info.date_counts;
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dates[mid][0] <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo ? dates[lo - 1][1] : 0;
}

export function dateAt(info, ordinal) {
  let lo = 0, hi = info.date_counts.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (info.date_counts[mid][1] <= ordinal) lo = mid + 1;
    else hi = mid;
  }
  return info.date_counts[lo]?.[0];
}

export function validateIndex(info) {
  keys(info, ["contract_version", "schema_version", "encoding", "catalog_id", "snapshot_version", "producer",
    "selection", "counts", "exclusions", "sources", "full", "provenance", "chunk_bytes", "date_counts", "chunks"]);
  requireValue(info.contract_version === 1 && info.schema_version === 1 && info.encoding === "json-array", "version or encoding");
  requireValue(typeof info.catalog_id === "string" && /^export-v1-[a-f0-9]{64}$/.test(info.catalog_id)
    && typeof info.snapshot_version === "string" && /^snapshot-v1-[a-f0-9]{64}$/.test(info.snapshot_version), "identity");
  keys(info.producer, ["tool_version"]);
  requireValue(typeof info.producer.tool_version === "string"
    && /^[0-9]+(?:\.[0-9]+)+[a-zA-Z0-9.+-]*$/.test(info.producer.tool_version), "producer");
  keys(info.selection, ["profile", "limit", "select", "sort"]);
  const s = info.selection, c = info.counts, x = info.exclusions;
  requireValue(s.profile === "discovery" && s.select === "first-known-dates-in-mpcorb-order"
    && s.sort === "disc-ascending-stable" && (s.limit === null || uint(s.limit) && s.limit > 0), "selection");
  keys(c, ["orbital_records", "master_records", "known_discovery", "missing_discovery", "numbered_orbits",
    "unnumbered_orbits", "unsupported_orbits", "discovery_records", "unmatched_discovery_records", "discovery_export"]);
  requireValue(Object.values(c).every(uint) && c.master_records + c.unsupported_orbits === c.orbital_records
    && c.known_discovery + c.missing_discovery === c.master_records
    && c.numbered_orbits + c.unnumbered_orbits === c.orbital_records
    && c.known_discovery + c.unmatched_discovery_records === c.discovery_records
    && c.known_discovery <= c.numbered_orbits
    && c.discovery_export === Math.min(s.limit ?? c.known_discovery, c.known_discovery), "counts");
  keys(x, ["master", "discovery", "selection_limit"]);
  keys(x.master, ["non_elliptic_orbits"]); keys(x.discovery, ["missing_discovery_date"]);
  requireValue(x.master.non_elliptic_orbits === c.unsupported_orbits
    && x.discovery.missing_discovery_date === c.missing_discovery
    && x.selection_limit === c.known_discovery - c.discovery_export, "exclusions");
  keys(info.sources, ["mpcorb", "numbered"]);
  Object.values(info.sources).forEach(sourceMetadata);
  payload(info.full, "full/catalog.json");
  keys(info.provenance, ["manifest", "master", "header", "notice"]);
  for (const [key, name] of Object.entries({ manifest: "manifest.json", master: "master.jsonl.gz",
    header: "MPCORB-header.txt", notice: "NOTICE.txt" })) validateReference(info.provenance[key], "full/" + name);
  requireValue(uint(info.chunk_bytes) && info.chunk_bytes > 0 && info.chunk_bytes <= MAX_CHUNK_BYTES
    && Array.isArray(info.chunks) && Array.isArray(info.date_counts), "index tables");
  let previousDate = -Infinity, previousCount = 0;
  for (const pair of info.date_counts) {
    requireValue(Array.isArray(pair) && pair.length === 2 && Number.isFinite(pair[0]) && pair[0] > previousDate
      && uint(pair[1]) && pair[1] > previousCount && pair[1] <= c.discovery_export, "date counts");
    [previousDate, previousCount] = pair;
  }
  requireValue(previousCount === c.discovery_export, "date total");
  let end = 0;
  info.chunks.forEach((chunk, i) => {
    payload(chunk, `chunks/${String(i).padStart(6, "0")}.json`, true);
    requireValue(uint(chunk.start) && chunk.start === end && uint(chunk.end) && chunk.end > chunk.start
      && chunk.end <= c.discovery_export && chunk.bytes <= info.chunk_bytes
      && chunk.first_disc === dateAt(info, chunk.start) && chunk.last_disc === dateAt(info, chunk.end - 1), "chunk range");
    end = chunk.end;
  });
  requireValue(end === c.discovery_export, "chunk total");
  return info;
}

export function validateRecords(records, file, info) {
  requireValue(Array.isArray(records) && records.length === file.end - file.start, "record count");
  let dateIndex = 0;
  while (info.date_counts[dateIndex]?.[1] <= file.start) dateIndex++;
  records.forEach((row, i) => {
    keys(row, fields);
    requireValue(fields.every(key => Number.isFinite(row[key])) && row.a > 0 && row.n > 0
      && row.e >= 0 && row.e < 1 && row.i >= 0 && row.i <= 180
      && ["W", "w", "M"].every(key => row[key] >= 0 && row[key] <= 360), `orbit at ordinal ${file.start + i}`);
    while (info.date_counts[dateIndex]?.[1] <= file.start + i) dateIndex++;
    requireValue(row.disc === info.date_counts[dateIndex]?.[0], `discovery at ordinal ${file.start + i}`);
  });
  return records;
}

export function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export async function verifyBytes(bytes, ref) {
  requireValue(bytes.byteLength === ref.bytes, `byte length for ${ref.url}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  requireValue(hash === ref.sha256, `checksum for ${ref.url}`);
}
