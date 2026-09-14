import { requireValue } from "./contract.js";

// Playback needs a retained prefix, not arbitrary interval merging. Source reads
// own ordered verification; this layer owns preparation, GPU commitment and time.
export default class CatalogLoader {
  constructor({ activate, commit, changed, retryDelays = [250, 1000] }) {
    this.activateCloud = activate;
    this.commitCloud = commit;
    this.changed = changed;
    this.retryDelays = retryDelays;
    this.generation = 0;
    this.disposed = false;
    this.clear();
  }

  clear() {
    this.generation++;
    this.request?.controller.abort();
    this.source?.close();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.source = null;
    this.request = null;
    this.committedCount = 0;
    this.graphicsCount = 0;
    this.graphicsValid = false;
    this.initialRendered = false;
    this.error = null;
    this.failures = 0;
  }

  activate(source, date) {
    requireValue(!this.disposed && !source.closed, "loader source");
    requireValue(Number.isFinite(date), "Julian day");
    this.clear();
    this.source = source;
    this.date = date;
    this.playing = false;
    this.hidden = false;
    this.activateCloud(source.info.counts.discovery_export);
    this.changed();
    this.pump();
  }

  get requiredCount() { return this.source ? this.source.countThrough(this.date) : 0; }
  get buffering() { return !!this.source && this.requiredCount > this.committedCount; }
  readyToDraw(date) { return !!this.source && this.source.countThrough(date) <= this.committedCount; }
  sceneComplete(date = this.date) {
    return this.graphicsValid && this.readyToDraw(date) && this.source.countThrough(date) <= this.graphicsCount;
  }

  demand(date, { playing = this.playing, hidden = this.hidden } = {}) {
    if (this.disposed || !this.source) return false;
    this.source.countThrough(date); // Validate even if it is the same date.
    this.date = date;
    this.playing = playing;
    this.hidden = hidden;
    if (this.request && this.request.end > this.targetEnd()) this.request.controller.abort();
    this.pump();
    return this.readyToDraw(date);
  }

  targetEnd() {
    const count = this.requiredCount, total = this.source.info.counts.discovery_export;
    if (this.source.mode === "whole") return count ? total : 0;
    const chunks = this.source.info.chunks;
    let lo = 0, hi = chunks.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (chunks[mid].end < count) lo = mid + 1;
      else hi = mid;
    }
    const requiredChunks = count ? lo + 1 : 0;
    const lookahead = this.initialRendered && this.playing && !this.hidden ? 3 : 0;
    return chunks[Math.min(chunks.length, requiredChunks + lookahead) - 1]?.end ?? 0;
  }

  accept(event, generation) {
    if (this.disposed || generation !== this.generation || !this.source
      || event.sourceId !== this.source.sourceId || event.catalogId !== this.source.info.catalog_id) return false;
    if (event.end <= this.committedCount) return false;
    requireValue(event.type === "batch" && event.start === this.committedCount, "noncontiguous commitment");
    // Synchronous preparation/commit uses the cloud's current epoch. No async
    // result can arrive between phase calculation and ownership transfer.
    this.commitCloud(event);
    this.committedCount = event.end;
    this.failures = 0;
    this.changed();
    return true;
  }

  rendered() {
    if (!this.source || this.disposed) return;
    this.graphicsCount = this.committedCount;
    this.graphicsValid = true;
    if (this.readyToDraw(this.date)) this.initialRendered = true;
    this.pump();
  }

  loseGraphics() { this.graphicsValid = false; this.changed(); }

  pump() {
    if (!this.source || this.disposed || this.request || this.retryTimer || this.error) return;
    const end = this.targetEnd(), start = this.committedCount;
    if (end <= start) return;
    const generation = this.generation, source = this.source, controller = new AbortController();
    const request = this.request = { start, end, controller };
    request.done = (async () => {
      try {
        for await (const event of source.read({ start, end }, { signal: controller.signal })) {
          if (generation !== this.generation || this.disposed) break;
          if (event.type === "batch") this.accept(event, generation);
        }
      } catch (error) {
        if (generation !== this.generation || this.disposed || error.name === "AbortError") return;
        if (this.failures < this.retryDelays.length) {
          const delay = this.retryDelays[this.failures++];
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (generation === this.generation && !this.disposed) this.pump();
          }, delay);
        } else this.error = error;
        this.changed();
      } finally {
        if (generation === this.generation && this.request === request) {
          this.request = null;
          this.pump();
        }
      }
    })();
  }

  retry() {
    if (this.disposed) return;
    this.error = null;
    this.failures = 0;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.changed();
    this.pump();
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }
}
