import Orrery3D from "./js/Orrery3D";
import "./main.css";
import "./fonts/OFL.txt";

export let orrery;
export const ready = (async () => {
  try {
    const trial = __CATALOG_TRIAL__;
    orrery = new Orrery3D({ container: document.getElementById("orrery"),
      ...(trial ? { startJed: trial.startJed, jedDelta: trial.speed } : {}) });
    if (trial) {
      const pin = trial.latest ? null : { ...trial.pin, url: new URL(trial.pin.url, document.baseURI).href };
      await orrery.loadCatalog(pin, { mode: trial.mode, latest: trial.latest });
      return orrery;
    }
    if (__HISTORICAL_CATALOG__) {
      const response = await fetch(require("../data/catalog.json"));
      if (!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
      orrery.setupAsteroids(await response.json());
    }
    return orrery;
  } catch (error) {
    console.error(error);
    const message = orrery
      ? "Could not load the asteroid catalogue. Reload to try again."
      : "Unable to start the 3D visualization. WebGL 2 is required.";
    if (orrery) orrery.setStatus(message, true);
    else {
      const status = document.getElementById("orrery-status");
      status.textContent = message;
      status.setAttribute("role", "alert");
    }
    return null;
  }
})();
