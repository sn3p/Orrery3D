// Preserve the old slider scale: 1.5 at 60 FPS meant 90 days per second.
export const REFERENCE_FPS = 60;

export default class PlaybackClock {
  constructor() { this.reset(); }

  reset() { this.previous = null; }

  advance(timestamp, speed) {
    if (!Number.isFinite(timestamp)) { this.reset(); return 0; }
    const previous = this.previous;
    this.previous = timestamp;
    if (previous === null || !Number.isFinite(speed)) return 0;
    // Do not catch up an OS sleep or a long stall in a single frame.
    const seconds = Math.max(0, Math.min((timestamp - previous) / 1000, 0.25));
    return speed * REFERENCE_FPS * seconds;
  }
}
