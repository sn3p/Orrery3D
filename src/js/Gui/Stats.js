// Inspired by Stats.js
// https://github.com/mrdoob/stats.js

export default class Stats {
  constructor() {
    this.performance = performance || Date;
    this.fps = 0;
    this.frames = 0;
    this.beginTime = this.performance.now();
    this.prevTime = this.beginTime;
  }

  begin() {
    this.beginTime = this.performance.now();
  }

  end() {
    this.frames++;
    const time = this.performance.now();

    if (time > this.prevTime + 1000) {
      this.fps = Math.round((this.frames * 1000) / (time - this.prevTime));
      this.prevTime = time;
      this.frames = 0;
    }

    return time;
  }

  update() {
    this.beginTime = this.end();
  }
}
