import Orrery3D from "./js/Orrery3D";
import "./main.css";
import "./fonts/OFL.txt";

// Keep renderer startup and error presentation shared with the renderer tests.
// The production entry supplies only the configured catalogue loader.
export default function startApp(loadCatalog, options = {}) {
  let orrery;
  const ready = (async () => {
    try {
      orrery = new Orrery3D({ ...options, container: document.getElementById("orrery") });
      await loadCatalog(orrery);
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
  return { orrery, ready };
}
