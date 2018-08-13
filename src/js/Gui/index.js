import { fromJED } from "../utils";
import Stats from "./Stats";

export default class Gui {
  constructor(orrery) {
    this.orrery = orrery;

    this.fpsElement = document.getElementById("orrery-fps");
    this.dateElement = document.getElementById("orrery-date");
    this.countElement = document.getElementById("orrery-count");

    this.stats = new Stats();
  }

  update() {
    const date = fromJED(this.orrery.jed)
      .toISOString()
      .slice(0, 10);

    this.dateElement.textContent = date;
    this.fpsElement.textContent = `${this.stats.fps} FPS`;
    this.countElement.textContent = this.orrery.asteroidsDiscovered;
  }
}
