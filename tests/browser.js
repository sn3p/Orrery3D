// Test entry imports the real application boot path, including catalogue fetch.
import { orrery, ready } from "../src";
import Orrery3D from "../src/js/Orrery3D";
import Asteroids, { REBASE_DAYS, REFERENCE_JED } from "../src/js/Asteroids";
import Orbit from "../src/js/Orbit";
import * as THREE from "three";
import { validateShader } from "./shader";

window.testReady = ready.then(() => {
  window.test = { app: orrery, catalog: orrery?.asteroidData, Orrery3D, Asteroids, Orbit, THREE, REBASE_DAYS, REFERENCE_JED, validateShader };
});
