import * as dat from "dat.gui";
import { fromJED } from "../utils";
import { UNIX_EPOCH_JULIAN_DATE } from "../constants";
import Stats from "./Stats";

export default class Gui {
  constructor(orrery) {
    this.orrery = orrery;

    // Setup DOM elements
    this.fpsElement = document.getElementById("orrery-fps");
    this.dateElement = document.getElementById("orrery-date");
    this.countElement = document.getElementById("orrery-count");
    this.lastDay = null;
    this.lastFps = null;
    this.lastCount = null;

    // Performance stats tracker
    this.stats = new Stats();

    // Controls
    this.gui = new dat.GUI({ hideable: false });
    const speed = this.gui.add(this.orrery, "jedDelta", -8, 8).name("speed");
    const input = speed.domElement.querySelector("input");
    input.setAttribute("aria-label", "Playback speed");
    input.title = "0 pauses; negative reverses. 1 = 60 days per second.";
  }

  update() {
    // Match Date's millisecond truncation, including times before the Unix epoch.
    const milliseconds = Math.trunc((this.orrery.jed - UNIX_EPOCH_JULIAN_DATE) * 86400000);
    const day = Math.floor(milliseconds / 86400000);
    if (day !== this.lastDay) {
      this.dateElement.textContent = fromJED(this.orrery.jed).toISOString().slice(0, 10);
      this.lastDay = day;
    }

    if (this.stats.fps !== this.lastFps) {
      this.fpsElement.textContent = `${this.stats.fps} FPS`;
      this.lastFps = this.stats.fps;
    }
    if (this.orrery.asteroidsDiscovered !== this.lastCount) {
      this.countElement.textContent = this.orrery.asteroidsDiscovered;
      this.lastCount = this.orrery.asteroidsDiscovered;
    }
  }

  hide() {
    this.gui.hide();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.gui.destroy();
  }
}
