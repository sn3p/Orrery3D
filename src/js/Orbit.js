import { PIXELS_PER_AU, J2000, YEAR, DEG_TO_RAD } from "./constants";
import * as THREE from "three";

export default class Orbit {
  // Get position at time for Julian Date
  static getPosAtTime(eph, jed) {
    const { cos, sin } = Math;

    const epoch = eph.epoch;
    const e = eph.e;
    const a = eph.a;
    const i = eph.i * DEG_TO_RAD;
    const o = eph.W * DEG_TO_RAD; // longitude of ascending node
    const p = (eph.wbar || eph.w + eph.W) * DEG_TO_RAD; // longitude of perihelion
    const ma = eph.M * DEG_TO_RAD; // mean anomaly at J2000

    // Mean motion
    // eph.n is provided for asteroids but not for planets
    let n;
    if (eph.n) {
      n = eph.n * DEG_TO_RAD;
    } else {
      n = (2 * Math.PI) / eph.P;
    }
    const d = jed - epoch;
    const M = ma + n * d;

    // Estimate eccentric and true anom using iterative approx
    let E0 = M;
    let lastdiff;

    do {
      const E1 = E0 - (E0 - e * sin(E0) - M) / (1 - e * cos(E0));
      lastdiff = Math.abs(E1 - E0);
      E0 = E1;
    } while (lastdiff > 0.0000001);

    const v = 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E0 / 2));

    // Radius vector in AU
    const r = ((a * (1 - e * e)) / (1 + e * cos(v))) * PIXELS_PER_AU;

    // Heliocentric coords
    const x = r * (cos(o) * cos(v + p - o) - sin(o) * sin(v + p - o) * cos(i));
    const y = r * (sin(o) * cos(v + p - o) + cos(o) * sin(v + p - o) * cos(i));
    const z = r * (sin(v + p - o) * sin(i));

    return [x, y, z];
  }

  static createOrbit(eph, jed = J2000) {
    const geometry = Orbit.getOrbitGeometry(eph, jed);

    // const material = new THREE.LineBasicMaterial({
    //   color: 0x555555,
    //   linewidth: 1
    // });

    const material = new THREE.LineDashedMaterial({
      color: 0x333333,
      linewidth: 1,
      dashSize: 5,
      gapSize: 3,
    });

    const line = new THREE.Line(geometry, material);

    // Required for dotted lines
    line.computeLineDistances();

    return line;
  }

  static getOrbitGeometry(eph, jed = J2000, baseResolution = 90) {
    const parts = Orbit.getOrbitResolution(eph, baseResolution);
    const period = Orbit.getPeriodInDays(eph);
    const delta = period / parts;
    const positions = new Float32Array(parts * 3);

    for (let i = 0; i < parts; ++i) {
      const j = jed + delta * i;
      const [x, y, z] = Orbit.getPosAtTime(eph, j);

      const offset = i * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    return geometry;
  }

  static getOrbitResolution(eph, base = 90) {
    // Scale resolution by eccentricity (for curvature) and size (for length)
    const eccentricityFactor = Math.max(eph.e * 2, 1); // 1× to ~2×
    const sizeFactor = Math.sqrt(eph.a); // √a scales with orbit size

    // Final resolution
    const parts = base * eccentricityFactor * sizeFactor;

    // Clamp to reasonable bounds
    return Math.max(32, Math.min(Math.floor(parts), 1024));
  }

  static getPeriodInDays(eph) {
    return Math.sqrt(Math.pow(eph.a, 3)) * YEAR;
  }
}
