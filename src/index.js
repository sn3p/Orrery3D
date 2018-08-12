import { ajaxGet } from "./js/utils";
import Orrery3D from "./js/Orrery3D";
import catalog from "../data/catalog.json";
import "./main.css";

const MPC_DATA_URL = catalog;

// Init Orrery
const orrery = new Orrery3D();

// Load asteroids
ajaxGet(MPC_DATA_URL, data => {
  const asteroidData = JSON.parse(data);

  // Sort by discovery date
  asteroidData.sort((a, b) => a.disc - b.disc);

  orrery.setAsteroids(asteroidData);
});
