import { validatePin, validateIndex, validateRecords, verifyBytes, parseJSON, freeze,
  countThrough, requireValue } from "./contract.js";

const aborted = () => new DOMException("Catalogue read cancelled.", "AbortError");
const check = signal => { if (signal?.aborted) throw aborted(); };
// Digest completion is a microtask. Keep file parsing and consumer preparation
// in separate tasks: otherwise individually bounded phases can combine into a
// long task. The processing slot remains held across these scheduling points.
const nextTask = () => new Promise(resolve => {
  // Posted messages keep a task boundary without background-tab timer clamping.
  // Node's timer fallback also lets command-line consumers exit naturally.
  if (typeof window === "undefined" || typeof MessageChannel === "undefined") {
    setTimeout(resolve, 0);
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close(); channel.port2.close(); resolve();
  };
  channel.port2.postMessage(null);
});

// Link only this read's lifetime; remove the listeners on completion as well as
// cancellation. This also supports browsers without AbortSignal.any.
function linkCancellation(controller, signals) {
  if (signals.some(signal => signal.aborted)) { controller.abort(); return () => {}; }
  const cancel = () => controller.abort();
  for (const signal of signals) signal.addEventListener("abort", cancel, { once: true });
  return () => { for (const signal of signals) signal.removeEventListener("abort", cancel); };
}

// The slot lasts until the consumer resumes after yielding, so verified records
// waiting for ordered commitment count toward the same bound as network work.
class FileSlots {
  active = 0;
  waiting = [];
  acquire(signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const entry = { start: () => {
        this.active++;
        signal.removeEventListener("abort", cancel);
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.active--;
          this.waiting.shift()?.start();
        };
        resolve(release);
      } };
      const cancel = () => {
        this.waiting = this.waiting.filter(item => item !== entry);
        reject(aborted());
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (this.active < 2) entry.start();
      else this.waiting.push(entry);
    });
  }
}

export async function fetchVerified(ref, url, signal) {
  check(signal);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Catalogue request failed (${response.status}): ${ref.url}`);
  // Content-Length can describe compressed HTTP bytes. Enforce the trusted
  // decoded length while streaming, before allocating/parsing an oversized body.
  const bytes = new Uint8Array(ref.bytes);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      check(signal);
      const { value, done } = await reader.read();
      if (done) break;
      requireValue(offset + value.length <= bytes.length, `byte length for ${ref.url}`);
      bytes.set(value, offset);
      offset += value.length;
    }
    requireValue(offset === bytes.length, `byte length for ${ref.url}`);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  await verifyBytes(bytes, ref);
  check(signal);
  return bytes;
}

export default class CatalogSource {
  static async open(pin, { mode = "indexed", signal } = {}) {
    validatePin(pin);
    requireValue(mode === "indexed" || mode === "whole", "source mode");
    const bytes = await fetchVerified(pin, pin.url, signal);
    const info = validateIndex(parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    check(signal);
    return new CatalogSource(pin, info, mode);
  }

  constructor(pin, info, mode) {
    Object.defineProperties(this, {
      info: { value: freeze(info), enumerable: true },
      sourceId: { value: pin.sha256, enumerable: true },
      mode: { value: mode, enumerable: true },
    });
    this.url = pin.url;
    this.closed = false;
    this.lifetime = new AbortController();
    this.slots = new FileSlots();
    this.files = mode === "indexed" ? info.chunks : info.counts.discovery_export
      ? [{ ...info.full, start: 0, end: info.counts.discovery_export }] : [];
  }

  countThrough(date) { return countThrough(this.info, date); }

  async *read({ start, end }, { signal } = {}) {
    requireValue(!this.closed, "closed source");
    requireValue(Number.isSafeInteger(start) && Number.isSafeInteger(end)
      && 0 <= start && start <= end && end <= this.info.counts.discovery_export, "read range");
    const controller = new AbortController();
    const combined = controller.signal;
    const unlink = linkCancellation(controller, [this.lifetime.signal, ...(signal ? [signal] : [])]);
    const identity = { catalogId: this.info.catalog_id, sourceId: this.sourceId };
    const files = start === end ? [] : this.files.filter(file => file.end > start && file.start < end);
    const pending = [];
    let nextFile = 0;
    const enqueue = () => {
      if (nextFile >= files.length) return;
      const file = files[nextFile++];
      // Resolve failures as values until their ordered turn, avoiding an
      // unhandled rejection if a later file fails before its predecessor.
      pending.push((async () => {
        const release = await this.slots.acquire(combined);
        try {
          check(combined);
          const bytes = await fetchVerified(file, new URL(file.url, this.url).href, combined);
          await nextTask();
          check(combined);
          const start = performance.now();
          const records = validateRecords(parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), file, this.info);
          performance.measure("catalog:parse-validate", { start });
          check(combined);
          const result = { file, records, release: () => {
            combined.removeEventListener("abort", discard);
            result.records = null;
            release();
          } };
          const discard = () => result.release();
          combined.addEventListener("abort", discard, { once: true });
          return result;
        } catch (error) { release(); throw error; }
      })().catch(error => ({ error })));
    };
    try {
      check(combined);
      enqueue(); enqueue();
      while (pending.length) {
        let result = await pending.shift();
        check(combined);
        if (result.error) throw result.error;
        await nextTask();
        check(combined);
        const batchStart = Math.max(start, result.file.start), batchEnd = Math.min(end, result.file.end);
        try {
          yield { type: "batch", ...identity, start: batchStart, end: batchEnd,
            records: result.records.slice(batchStart - result.file.start, batchEnd - result.file.start) };
        } finally { result.release(); result = null; }
        check(combined);
        enqueue();
      }
      check(combined);
      yield { type: "complete", ...identity, start, end };
    } finally { controller.abort(); unlink(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
  }
}
