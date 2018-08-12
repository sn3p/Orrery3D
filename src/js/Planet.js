import * as THREE from "three";
import Orbit from "./Orbit";

export default class Planet {
  static defaultOptions = {
    size: 2,
    segments: 32,
    color: 0xffffff
  };

  constructor(ephemeris, options = {}) {
    this.options = Object.assign({}, Planet.defaultOptions, options);

    // Planet orbit
    this.orbit = new Orbit(ephemeris);

    // Create body
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(
        this.options.size,
        this.options.segments,
        this.options.segments
      ),
      new THREE.MeshBasicMaterial({
        color: this.options.color
      })
    );
  }

  render(jed) {
    const pos = this.orbit.getPosAtTime(jed);

    this.body.position.set(...pos);
  }
}
