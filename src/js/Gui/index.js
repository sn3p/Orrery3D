import * as dat from "dat.gui";
import { fromJED } from "../utils";
import Stats from "./Stats";

export default class Gui {
  constructor(orrery) {
    this.orrery = orrery;

    // Setup DOM elements
    this.fpsElement = document.getElementById("orrery-fps");
    this.dateElement = document.getElementById("orrery-date");
    this.countElement = document.getElementById("orrery-count");

    // Performance stats tracker
    this.stats = new Stats();

    // Controls
    this.gui = new dat.GUI({ hideable: false });
    this.gui.add(this.orrery, "jedDelta", -8, 8).name("speed");
  }

  update() {
    const date = fromJED(this.orrery.jed).toISOString().slice(0, 10);

    this.dateElement.textContent = date;
    this.fpsElement.textContent = `${this.stats.fps} FPS`;
    this.countElement.textContent = this.orrery.asteroidsDiscovered;
  }
}
