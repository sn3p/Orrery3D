import * as THREE from "three";
import { DEG_TO_RAD, PIXELS_PER_AU } from "./constants";

export const REFERENCE_JED = 2458600.5;
export const REBASE_DAYS = 4096;
const TAU = 2 * Math.PI;
const wrap = value => value - TAU * Math.floor((value + Math.PI) / TAU);

// Also executed directly by the benchmark's numerical accuracy checks.
export const orbitGLSL = `
  vec3 orbitPosition(vec3 p, vec3 q, vec3 orbit, float time) {
    float e = orbit.x;
    float M = mod(orbit.y + orbit.z * time + 3.141592653589793, 6.283185307179586) - 3.141592653589793;
    float E = e < 0.8 ? M : sign(M) * 3.141592653589793;
    for (int k = 0; k < 12; k++) {
      E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    }
    // Very eccentric ellipses can converge more slowly near perihelion.
    if (e >= 0.99) {
      for (int k = 0; k < 12; k++) {
        E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
      }
    }
    return p * (cos(E) - e) + q * sin(E);
  }
  vec3 discoveryColor(float time, float discovery, float duration, vec3 fresh, vec3 old) {
    if (duration <= 0.0) return old;
    return mix(fresh, old, clamp((time - discovery) / duration, 0.0, 1.0));
  }
`;

function prepare(data, epoch) {
  if (!Array.isArray(data)) throw new Error("The asteroid catalogue must be an array.");
  // Reject invalid elements before allocating GPU resources or replacing a cloud.
  for (let index = 0; index < data.length; index++) {
    const d = data[index];
    const valid = d && ["a", "e", "i", "W", "M", "epoch", "disc"].every(key => Number.isFinite(d[key]))
      && d.a > 0 && d.e >= 0 && d.e < 1
      && Number.isFinite(d.wbar ?? d.w)
      && ((Number.isFinite(d.n) && d.n > 0) || (!d.n && Number.isFinite(d.P) && d.P > 0));
    // Float32 must still represent an ellipse, even when e is extremely near 1.
    if (!valid || Math.fround(d.e) >= 1) throw new Error(`Invalid elliptical orbit at catalogue entry ${index + 1}.`);
  }
  const sorted = data.slice().sort((a, b) => a.disc - b.disc);
  const count = sorted.length;
  const p = new Float32Array(count * 3), q = new Float32Array(count * 3);
  const elements = new Float32Array(count * 3), discovery = new Float32Array(count);
  const phases = new Float64Array(count * 2), dates = new Float64Array(count);
  let radius = 0;
  sorted.forEach((d, index) => {
    const offset = index * 3;
    const o = d.W * DEG_TO_RAD;
    const w = ((d.wbar ?? d.w + d.W) - d.W) * DEG_TO_RAD;
    const inc = d.i * DEG_TO_RAD;
    const a = d.a * PIXELS_PER_AU, b = a * Math.sqrt(1 - d.e * d.e);
    const n = d.n ? d.n * DEG_TO_RAD : TAU / d.P;
    const mean = wrap(d.M * DEG_TO_RAD + n * (REFERENCE_JED - d.epoch));
    p.set([
      a * (Math.cos(o) * Math.cos(w) - Math.sin(o) * Math.sin(w) * Math.cos(inc)),
      a * (Math.sin(o) * Math.cos(w) + Math.cos(o) * Math.sin(w) * Math.cos(inc)),
      a * Math.sin(w) * Math.sin(inc),
    ], offset);
    q.set([
      b * (-Math.cos(o) * Math.sin(w) - Math.sin(o) * Math.cos(w) * Math.cos(inc)),
      b * (-Math.sin(o) * Math.sin(w) + Math.cos(o) * Math.cos(w) * Math.cos(inc)),
      b * Math.cos(w) * Math.sin(inc),
    ], offset);
    elements.set([d.e, wrap(mean + n * (epoch - REFERENCE_JED)), n], offset);
    phases.set([mean, n], index * 2);
    dates[index] = d.disc;
    discovery[index] = d.disc - REFERENCE_JED;
    radius = Math.max(radius, a * (1 + d.e));
    let finite = Number.isFinite(discovery[index]) && Number.isFinite(radius);
    for (let axis = 0; axis < 3; axis++) {
      finite = finite && Number.isFinite(p[offset + axis]) && Number.isFinite(q[offset + axis])
        && Number.isFinite(elements[offset + axis]);
    }
    if (!finite) {
      throw new Error(`Orbit exceeds rendering precision at catalogue entry ${index + 1}.`);
    }
  });
  return { p, q, elements, discovery, phases, dates, radius };
}

export default class Asteroids extends THREE.Points {
  constructor(data, { jed, color, discoveryColor, discoveryDuration }) {
    if (!Number.isFinite(jed) || !Number.isFinite(discoveryDuration) || discoveryDuration < 0) {
      throw new Error("Invalid asteroid date or discovery duration.");
    }
    const packed = prepare(data, jed);
    const geometry = new THREE.BufferGeometry();
    // 'position' stores the first orbital basis, avoiding a dummy position buffer.
    geometry.setAttribute("position", new THREE.BufferAttribute(packed.p, 3));
    geometry.setAttribute("basisQ", new THREE.BufferAttribute(packed.q, 3));
    geometry.setAttribute("elements", new THREE.BufferAttribute(packed.elements, 3));
    geometry.setAttribute("discovery", new THREE.BufferAttribute(packed.discovery, 1));
    // All possible positions lie inside the largest aphelion, with a small
    // numerical/point-size margin. Never derive moving bounds from the basis.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), packed.radius * 1.00001 + 1);
    geometry.setDrawRange(0, 0);
    const uniforms = {
      orbitTime: { value: 0 }, discoveryTime: { value: jed - REFERENCE_JED },
      fadeDuration: { value: discoveryDuration },
      freshColor: { value: discoveryColor }, oldColor: { value: color },
    };
    const material = new THREE.PointsMaterial({ size: 1, vertexColors: true });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `
        #include <common>
        attribute vec3 basisQ;
        attribute vec3 elements;
        attribute float discovery;
        uniform float orbitTime;
        uniform float discoveryTime;
        uniform float fadeDuration;
        uniform vec3 freshColor;
        uniform vec3 oldColor;
        ${orbitGLSL}
      `).replace("#include <color_vertex>", `
        vColor = vec4(discoveryColor(discoveryTime, discovery, fadeDuration, freshColor, oldColor), 1.0);
      `).replace("#include <begin_vertex>", "vec3 transformed = orbitPosition(position, basisQ, elements, orbitTime);");
    };
    material.customProgramCacheKey = () => "asteroid-orbits-r186-v1";
    super(geometry, material);
    this.name = "Asteroids";
    this.discoveryDates = packed.dates;
    this.phases = packed.phases;
    this.epoch = jed;
    this.uniforms = uniforms;
    this.update(jed);
  }

  update(jed) {
    if (!Number.isFinite(jed)) throw new Error("Invalid asteroid date.");
    if (Math.abs(jed - this.epoch) > REBASE_DAYS) {
      // An occasional phase refresh bounds Float32 time error during long
      // playback and date jumps. Ordinary frames change only uniforms/range.
      const elements = this.geometry.attributes.elements;
      for (let i = 0; i < this.discoveryDates.length; i++) {
        elements.array[i * 3 + 1] = wrap(this.phases[i * 2] + this.phases[i * 2 + 1] * (jed - REFERENCE_JED));
      }
      elements.needsUpdate = true;
      this.epoch = jed;
    }
    this.uniforms.orbitTime.value = jed - this.epoch;
    this.uniforms.discoveryTime.value = jed - REFERENCE_JED;
    let lo = 0, hi = this.discoveryDates.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.discoveryDates[mid] <= jed) lo = mid + 1;
      else hi = mid;
    }
    this.geometry.setDrawRange(0, lo);
    return lo;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    super.dispose();
  }
}
