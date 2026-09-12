// Inspired by Stats.js
// https://github.com/mrdoob/stats.js

export default class Stats {
  constructor() {
    this.performance = performance || Date;
    this.reset();
  }

  reset() {
    this.fps = 0;
    this.frames = 0;
    this.prevTime = this.performance.now();
  }

  update() {
    this.frames++;
    const time = this.performance.now();

    if (time > this.prevTime + 1000) {
      this.fps = Math.round((this.frames * 1000) / (time - this.prevTime));
      this.prevTime = time;
      this.frames = 0;
    }
  }
}
