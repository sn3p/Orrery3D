import * as dat from "dat.gui";
import { fromJED } from "../utils";
import { UNIX_EPOCH_JULIAN_DATE } from "../constants";
import Stats from "./Stats";

let nextPanelId = 0;

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
    this.element = document.createElement("div");
    this.element.className = "orrery-options";
    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "orrery-options-trigger";
    this.trigger.textContent = "[+] options";
    this.trigger.setAttribute("aria-label", "Options");
    this.trigger.setAttribute("aria-expanded", "false");
    this.panel = document.createElement("section");
    this.panel.className = "orrery-options-panel";
    this.panel.id = `orrery-options-${++nextPanelId}`;
    this.panel.setAttribute("aria-label", "Options");
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-controls", this.panel.id);
    this.element.append(this.trigger, this.panel);
    document.body.appendChild(this.element);
    this.gui = new dat.GUI({ hideable: false, autoPlace: false });
    this.panel.appendChild(this.gui.domElement);
    const speed = this.gui.add(this.orrery, "jedDelta", -8, 8).name("speed");
    const input = speed.domElement.querySelector("input");
    input.setAttribute("aria-label", "Playback speed");
    input.title = "0 pauses; negative reverses. 1 = 60 days per second.";
    this.addHint(speed, "0 pauses; negative reverses.", input);

    this.pixelRatio = this.gui.add(this.orrery, "pixelRatio", { Auto: "auto" }).name("DPR");
    this.pixelRatioSelect = this.pixelRatio.domElement.querySelector("select");
    this.pixelRatioSelect.setAttribute("aria-label", "Rendering pixel ratio");
    this.pixelRatioSelect.title = "Auto uses your display's resolution. Lower values reduce sharpness and graphics work.";
    this.addHint(this.pixelRatio, "Auto matches your display. Lower DPR reduces detail and graphics work.", this.pixelRatioSelect);
    this.updatePixelRatio();
    this.trigger.addEventListener("click", this.onToggle);
    document.addEventListener("pointerdown", this.onOutsidePointer, true);
    document.addEventListener("keydown", this.onKeyDown);
  }

  addHint(controller, text, input) {
    const hint = document.createElement("p");
    hint.className = "orrery-options-hint";
    hint.id = `${this.panel.id}-${controller.property}-hint`;
    hint.textContent = text;
    controller.domElement.closest("li").appendChild(hint);
    input.setAttribute("aria-describedby", hint.id);
  }

  setOpen(open, restoreFocus = true) {
    const hadFocus = this.panel.contains(document.activeElement);
    this.panel.hidden = !open;
    this.trigger.textContent = open ? "[-] options" : "[+] options";
    this.trigger.setAttribute("aria-expanded", String(open));
    if (open) this.gui.domElement.querySelector("input").focus();
    else if (restoreFocus && hadFocus) this.trigger.focus();
  }

  onToggle = () => { this.setOpen(this.panel.hidden); };

  onOutsidePointer = event => {
    if (!this.panel.hidden && !this.element.contains(event.target)) this.setOpen(false);
  };

  onKeyDown = event => {
    if (event.key !== "Escape" || this.panel.hidden) return;
    event.preventDefault();
    this.setOpen(false, false);
    this.trigger.focus();
  };

  updatePixelRatio() {
    const native = window.devicePixelRatio;
    const current = this.orrery.pixelRatio;
    const format = value => `${Number(value.toFixed(2))}×`;
    const options = [new Option(`Auto (${format(native)})`, "auto")];
    for (const ratio of [1, 2, 3]) {
      if (ratio <= native || String(ratio) === current) {
        const label = ratio <= native ? format(ratio) : `${format(ratio)} (${format(native)} now)`;
        options.push(new Option(label, String(ratio)));
      }
    }
    this.pixelRatioSelect.replaceChildren(...options);
    this.pixelRatioSelect.value = current;
    this.pixelRatio.domElement.closest("li").style.display = native > 1 ? "" : "none";
    if (native <= 1 && document.activeElement === this.pixelRatioSelect) {
      this.gui.domElement.querySelector("input").focus();
    }
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
    this.setOpen(false, false);
    this.element.hidden = true;
    this.gui.hide();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.trigger.removeEventListener("click", this.onToggle);
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onKeyDown);
    this.gui.destroy();
    this.element.remove();
  }
}
