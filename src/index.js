import Orrery3D from "./js/Orrery3D";
import catalog from "../data/catalog.json";
import "./main.css";

const MPC_DATA_URL = catalog;

// Init Orrery
const orrery = new Orrery3D();

fetch(MPC_DATA_URL)
  .then((response) => response.json())
  .then((data) => {
    // Sort by discovery date
    data.sort((a, b) => a.disc - b.disc);

    orrery.setAsteroids(data);
  });

// Window resize
window.addEventListener("resize", orrery.resize, false);
