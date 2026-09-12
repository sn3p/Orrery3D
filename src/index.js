import Orrery3D from "./js/Orrery3D";
import catalog from "../data/catalog.json";
import "./main.css";
import "./fonts/OFL.txt";

const MPC_DATA_URL = catalog;

export let orrery;
export const ready = (async () => {
  try {
    orrery = new Orrery3D({ container: document.getElementById("orrery") });
    const response = await fetch(MPC_DATA_URL);
    if (!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
    orrery.setupAsteroids(await response.json());
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
