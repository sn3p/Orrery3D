import Orbit from "./Orbit";
import createSphere from "./createSphere";

export default class Planet {
  static defaultOptions = {
    size: 2,
    segments: 32,
    color: 0xffffff
  };

  constructor(ephemeris, options = {}) {
    this.options = Object.assign({}, Planet.defaultOptions, options);
    this.ephemeris = ephemeris;
    this.orbit = new Orbit(ephemeris);
    this.body = createSphere(this.options);
  }

  render(jed) {
    if (!this.orbit.matches(this.ephemeris)) this.orbit = new Orbit(this.ephemeris);
    this.orbit.getPosAtTime(jed, this.body.position);
  }
}
