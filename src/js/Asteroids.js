import * as THREE from "three";
import { REFERENCE_JED, wrapPhase } from "./prepareCatalogue";

export { REFERENCE_JED } from "./prepareCatalogue";
export const REBASE_DAYS = 4096;

// Also executed directly by the benchmark's numerical accuracy checks.
export const orbitGLSL = `
  vec3 orbitPosition(vec3 p, vec3 q, vec2 orbit, float meanAnomaly, float time) {
    float e = orbit.x;
    float M = mod(meanAnomaly + orbit.y * time + 3.141592653589793, 6.283185307179586) - 3.141592653589793;
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

export default class Asteroids extends THREE.Points {
  constructor(packed, { jed, color, discoveryColor, discoveryDuration, committedCount = packed.dates.length }) {
    if (!Number.isFinite(jed) || !Number.isFinite(discoveryDuration) || discoveryDuration < 0) {
      throw new Error("Invalid asteroid date or discovery duration.");
    }
    const geometry = new THREE.BufferGeometry();
    // 'position' stores the first orbital basis, avoiding a dummy position buffer.
    geometry.setAttribute("position", new THREE.BufferAttribute(packed.p, 3));
    geometry.setAttribute("basisQ", new THREE.BufferAttribute(packed.q, 3));
    // Eccentricity and mean motion stay fixed; only the scalar phase refreshes.
    geometry.setAttribute("elements", new THREE.BufferAttribute(packed.elements, 2));
    geometry.setAttribute("meanAnomaly", new THREE.BufferAttribute(packed.meanAnomalies, 1));
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
        attribute vec2 elements;
        attribute float meanAnomaly;
        attribute float discovery;
        uniform float orbitTime;
        uniform float discoveryTime;
        uniform float fadeDuration;
        uniform vec3 freshColor;
        uniform vec3 oldColor;
        ${orbitGLSL}
      `).replace("#include <color_vertex>", `
        vColor = vec4(discoveryColor(discoveryTime, discovery, fadeDuration, freshColor, oldColor), 1.0);
      `).replace("#include <begin_vertex>", "vec3 transformed = orbitPosition(position, basisQ, elements, meanAnomaly, orbitTime);");
    };
    material.customProgramCacheKey = () => "asteroid-orbits-r186-v2";
    super(geometry, material);
    this.name = "Asteroids";
    this.discoveryDates = packed.dates;
    this.phases = packed.phases;
    this.epoch = packed.epoch;
    this.committedCount = committedCount;
    this.uniforms = uniforms;
    this.update(jed);
  }

  append(packed, start) {
    const end = start + packed.dates.length;
    if (start !== this.committedCount || end > this.discoveryDates.length || packed.epoch !== this.epoch
      || (start && packed.dates.length && packed.dates[0] < this.discoveryDates[start - 1])) {
      throw new Error("Invalid incremental catalogue commitment.");
    }
    const arrays = { position: packed.p, basisQ: packed.q, elements: packed.elements,
      meanAnomaly: packed.meanAnomalies, discovery: packed.discovery };
    for (const [name, values] of Object.entries(arrays)) {
      const attribute = this.geometry.attributes[name];
      const offset = start * attribute.itemSize;
      attribute.array.set(values, offset);
      attribute.addUpdateRange(offset, values.length);
      attribute.needsUpdate = true;
    }
    this.discoveryDates.set(packed.dates, start);
    this.phases.set(packed.phases, start * 2);
    this.geometry.boundingSphere.radius = Math.max(this.geometry.boundingSphere.radius, packed.radius * 1.00001 + 1);
    this.committedCount = end;
  }

  update(jed) {
    if (!Number.isFinite(jed)) throw new Error("Invalid asteroid date.");
    if (Math.abs(jed - this.epoch) > REBASE_DAYS) {
      // An occasional phase refresh bounds Float32 time error during long
      // playback and date jumps. Ordinary frames change only uniforms/range.
      const meanAnomaly = this.geometry.attributes.meanAnomaly;
      for (let i = 0; i < this.committedCount; i++) {
        meanAnomaly.array[i] = wrapPhase(this.phases[i * 2] + this.phases[i * 2 + 1] * (jed - REFERENCE_JED));
      }
      meanAnomaly.addUpdateRange(0, this.committedCount);
      meanAnomaly.needsUpdate = true;
      this.epoch = jed;
    }
    this.uniforms.orbitTime.value = jed - this.epoch;
    this.uniforms.discoveryTime.value = jed - REFERENCE_JED;
    let lo = 0, hi = this.committedCount;
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
