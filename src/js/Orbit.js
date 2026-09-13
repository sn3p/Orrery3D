import { PIXELS_PER_AU, J2000, DEG_TO_RAD } from "./constants";
import * as THREE from "three";

const TAU = 2 * Math.PI;
const ELEMENT_KEYS = ["a", "e", "i", "W", "wbar", "w", "M", "n", "P", "epoch"];

function meanMotion(eph) {
  // Preserve the existing zero/absent-n period fallback.
  if (eph.n != null && (!Number.isFinite(eph.n) || eph.n < 0)) {
    throw new RangeError("Invalid orbital mean motion.");
  }
  if (!eph.n && (!Number.isFinite(eph.P) || eph.P <= 0)) {
    throw new RangeError("Invalid orbital period.");
  }
  const n = eph.n ? eph.n * DEG_TO_RAD : TAU / eph.P;
  if (!Number.isFinite(n) || n <= 0) throw new RangeError("Invalid orbital mean motion.");
  return n;
}

function eccentricAnomaly(mean, e) {
  // Signed wrapping preserves small negative phases without adding a full turn.
  let M = mean % TAU;
  if (M > Math.PI) M -= TAU;
  if (M < -Math.PI) M += TAU;
  if (M === 0 || e === 0) return M;
  const sign = Math.sign(M);
  M = Math.abs(M);
  let lo = 0, hi = Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  // Kepler's equation is monotonic for 0 <= e < 1. Keep a root bracket
  // throughout Newton iteration; reject steps that leave it.
  for (let i = 0; i < 16; i++) {
    const residual = E - e * Math.sin(E) - M;
    if (residual === 0) return sign * E;
    if (residual > 0) hi = E;
    else lo = E;
    const next = E - residual / (1 - e * Math.cos(E));
    if (!(next > lo && next < hi)) break;
    if (Math.abs(next - E) <= 1e-14) return sign * next;
    E = next;
  }
  // A fixed bisection budget guarantees termination even near e = 1.
  for (let i = 0; i < 64; i++) {
    E = (lo + hi) / 2;
    const residual = E - e * Math.sin(E) - M;
    if (residual === 0 || hi - lo <= 1e-14) break;
    if (residual > 0) hi = E;
    else lo = E;
  }
  return sign * E;
}

export default class Orbit {
  constructor(eph) {
    const { cos, sin } = Math;
    if (!eph) throw new RangeError("Invalid orbit or Julian date.");
    const perihelion = eph.wbar ?? eph.w;
    if (!Number.isFinite(eph.a) || eph.a <= 0 || !Number.isFinite(eph.e) || eph.e < 0 || eph.e >= 1
      || !Number.isFinite(eph.i) || !Number.isFinite(eph.W) || !Number.isFinite(perihelion)
      || !Number.isFinite(eph.M) || !Number.isFinite(eph.epoch)) {
      throw new RangeError("Invalid elliptical orbital elements.");
    }
    const longitude = eph.wbar ?? (perihelion + eph.W);
    const e = eph.e;
    const a = eph.a * PIXELS_PER_AU;
    const i = eph.i * DEG_TO_RAD;
    const o = eph.W * DEG_TO_RAD; // longitude of ascending node
    const w = (longitude - eph.W) * DEG_TO_RAD; // argument of perihelion
    const n = meanMotion(eph);
    if (!Number.isFinite(a) || !Number.isFinite(longitude)) {
      throw new RangeError("Orbit exceeds numerical range.");
    }
    // Keep a snapshot so a planet can detect edits to its public ephemeris.
    this.elements = {};
    for (const key of ELEMENT_KEYS) this.elements[key] = eph[key];
    this.epoch = eph.epoch;
    this.mean = eph.M * DEG_TO_RAD;
    this.n = n;
    this.e = e;
    this.a = a;
    this.b = a * Math.sqrt((1 - e) * (1 + e));
    const co = cos(o), so = sin(o), cw = cos(w), sw = sin(w), ci = cos(i), si = sin(i);
    this.px = co * cw - so * sw * ci;
    this.py = so * cw + co * sw * ci;
    this.pz = sw * si;
    this.qx = -co * sw - so * cw * ci;
    this.qy = -so * sw + co * cw * ci;
    this.qz = cw * si;
  }

  matches(eph) {
    if (!eph) return false;
    for (const key of ELEMENT_KEYS) {
      if (!Object.is(eph[key], this.elements[key])) return false;
    }
    return true;
  }

  // Pass an existing Vector3 for allocation-free updates; omitted targets
  // preserve the array-returning API used by one-off calculations.
  getPosAtTime(jed, target) {
    if (!Number.isFinite(jed)) throw new RangeError("Invalid orbit or Julian date.");
    const M = this.mean + this.n * (jed - this.epoch);
    if (!Number.isFinite(M)) throw new RangeError("Orbit exceeds numerical range.");
    const E = eccentricAnomaly(M, this.e);

    // Direct eccentric-anomaly coordinates avoid the near-parabolic 0/0
    // cancellation in r = a(1-e²)/(1+e cos(v)), especially at aphelion.
    const px = this.a * (Math.cos(E) - this.e);
    const py = this.b * Math.sin(E);
    const x = px * this.px + py * this.qx;
    const y = px * this.py + py * this.qy;
    const z = px * this.pz + py * this.qz;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new RangeError("Orbit exceeds numerical range.");
    }

    return target ? target.set(x, y, z) : [x, y, z];
  }

  // One-off callers always observe the supplied elements and own their result.
  static getPosAtTime(eph, jed) {
    return new Orbit(eph).getPosAtTime(jed);
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
    // Validate before allocating a track, including nonfinite elements that
    // would otherwise turn the segment count into NaN and skip every sample.
    const orbit = new Orbit(eph);
    const position = orbit.getPosAtTime(jed, new THREE.Vector3());
    const parts = Orbit.getOrbitResolution(eph, baseResolution);
    const period = Orbit.getPeriodInDays(eph);
    const delta = period / parts;
    const positions = new Float32Array((parts + 1) * 3);
    position.toArray(positions);

    for (let i = 1; i < parts; ++i) {
      const j = jed + delta * i;
      orbit.getPosAtTime(j, position).toArray(positions, i * 3);
    }

    // Repeat the first vertex exactly so the dashed line includes its closing segment.
    positions.set(positions.subarray(0, 3), parts * 3);

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
    // Match getPosAtTime: mean motion takes precedence over the supplied period.
    meanMotion(eph);
    const period = eph.n ? 360 / eph.n : eph.P;
    if (!Number.isFinite(period) || period <= 0) throw new RangeError("Invalid orbital period.");
    return period;
  }
}
