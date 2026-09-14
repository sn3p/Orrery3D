// Instrument the explicit renderer fixture, preserving its shared app startup.
import { orrery, ready } from "./renderer-entry";
import Orrery3D from "../src/js/Orrery3D";
import Asteroids, { REBASE_DAYS, REFERENCE_JED } from "../src/js/Asteroids";
import { prepareCatalogue } from "../src/js/prepareCatalogue";
import Orbit from "../src/js/Orbit";
import Planet from "../src/js/Planet";
import Sun from "../src/js/Sun";
import * as THREE from "three";
import { validateShader } from "./shader";
import catalogUrl from "../data/catalog.json";

window.testReady = ready.then(async () => {
  // Reference records belong to the tests. Fetch a separate copy after the
  // fixture boot so assertions never depend on runtime retention of raw objects.
  const response = await fetch(catalogUrl);
  if (!response.ok) throw new Error(`Reference catalogue request failed: ${response.status}`);
  const catalog = (await response.json()).sort((a, b) => a.disc - b.disc);
  window.test = { app: orrery, catalog, Orrery3D, Asteroids, prepareCatalogue, Orbit, Planet, Sun, THREE, REBASE_DAYS, REFERENCE_JED, validateShader };
});
