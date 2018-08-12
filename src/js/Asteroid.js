import * as THREE from "three";
import Orbit from "./Orbit.js";

export default class Asteroid {
  constructor(data) {
    this.disc = data.disc;

    // Orbit
    this.orbit = new Orbit(data);

    // Body
    this.body = new THREE.Vector3(0, 0, 0);
  }

  render(jed) {
    const [x, y, z] = this.orbit.getPosAtTime(jed);

    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
  }
}
