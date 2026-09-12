// Benchmark CPU prototype and validation helpers. GPU GLSL comes from production.
import * as THREE from "three";
import { DEG_TO_RAD, PIXELS_PER_AU } from "../src/js/constants";

import { REFERENCE_JED, orbitGLSL } from "../src/js/Asteroids";
export { REFERENCE_JED, orbitGLSL };
const TAU = 2 * Math.PI;
export const wrap = (x) => ((x + Math.PI) % TAU + TAU) % TAU - Math.PI;

export function pack(data) {
  const packed = new Float64Array(data.length * 10);
  data.forEach((d, i) => {
    const o = d.W * DEG_TO_RAD;
    const w = ((d.wbar || d.w + d.W) - d.W) * DEG_TO_RAD;
    const inc = d.i * DEG_TO_RAD;
    const a = d.a * PIXELS_PER_AU;
    const b = a * Math.sqrt(1 - d.e * d.e);
    const n = d.n ? d.n * DEG_TO_RAD : TAU / d.P;
    packed.set([
      a * (Math.cos(o) * Math.cos(w) - Math.sin(o) * Math.sin(w) * Math.cos(inc)),
      a * (Math.sin(o) * Math.cos(w) + Math.cos(o) * Math.sin(w) * Math.cos(inc)),
      a * Math.sin(w) * Math.sin(inc),
      b * (-Math.cos(o) * Math.sin(w) - Math.sin(o) * Math.cos(w) * Math.cos(inc)),
      b * (-Math.sin(o) * Math.sin(w) + Math.cos(o) * Math.cos(w) * Math.cos(inc)),
      b * Math.cos(w) * Math.sin(inc),
      d.e, wrap(d.M * DEG_TO_RAD + n * (REFERENCE_JED - d.epoch)), n,
      d.disc - REFERENCE_JED,
    ], i * 10);
  });
  return packed;
}

export function cpuPositions(packed, jed, positions, count) {
  const time = jed - REFERENCE_JED;
  for (let i = 0; i < count; i++) {
    const j = i * 10;
    const e = packed[j + 6];
    const M = wrap(packed[j + 7] + packed[j + 8] * time);
    let E = e < 0.8 ? M : (M < 0 ? -Math.PI : Math.PI);
    for (let k = 0; k < 16; k++) {
      const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= step;
      if (Math.abs(step) <= 1e-7) break;
    }
    const x = Math.cos(E) - e;
    const y = Math.sin(E);
    positions[i * 3] = packed[j] * x + packed[j + 3] * y;
    positions[i * 3 + 1] = packed[j + 1] * x + packed[j + 4] * y;
    positions[i * 3 + 2] = packed[j + 2] * x + packed[j + 5] * y;
  }
}

export function discoveredCount(data, jed) {
  let lo = 0, hi = data.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data[mid].disc <= jed) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function gpuMaterial(packed, app, calculatePosition) {
  const geometry = app.asteroidsGeometry;
  const count = packed.length / 10;
  const p = new Float32Array(count * 3), q = new Float32Array(count * 3);
  const orbit = new Float32Array(count * 3), discovery = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p.set(packed.subarray(i * 10, i * 10 + 3), i * 3);
    q.set(packed.subarray(i * 10 + 3, i * 10 + 6), i * 3);
    orbit.set(packed.subarray(i * 10 + 6, i * 10 + 9), i * 3);
    discovery[i] = packed[i * 10 + 9];
  }
  if (calculatePosition) {
    geometry.setAttribute("basisP", new THREE.BufferAttribute(p, 3));
    geometry.setAttribute("basisQ", new THREE.BufferAttribute(q, 3));
    geometry.setAttribute("elements", new THREE.BufferAttribute(orbit, 3));
  }
  geometry.setAttribute("discovery", new THREE.BufferAttribute(discovery, 1));
  geometry.deleteAttribute("color");
  const uniforms = {
    orbitTime: { value: app.jed - REFERENCE_JED },
    fadeDuration: { value: app.asteroidDiscoveryDuration },
    freshColor: { value: app.asteroidDiscoveryColor },
    oldColor: { value: app.asteroidColor },
  };
  const material = new THREE.PointsMaterial({ size: 1, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `
      #include <common>
      uniform float orbitTime;
      uniform float fadeDuration;
      uniform vec3 freshColor;
      uniform vec3 oldColor;
      attribute float discovery;
      ${calculatePosition ? "attribute vec3 basisP; attribute vec3 basisQ; attribute vec3 elements;" : ""}
      ${orbitGLSL}
    `).replace("#include <color_vertex>", `
      // Three.js r186 uses an RGBA varying even for RGB vertex colours.
      vColor = vec4(discoveryColor(orbitTime, discovery, fadeDuration, freshColor, oldColor), 1.0);
    `);
    if (calculatePosition) shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>", "vec3 transformed = orbitPosition(basisP, basisQ, elements, orbitTime);"
    );
  };
  material.customProgramCacheKey = () => `benchmark-orbit-${calculatePosition}`;
  return { material, uniforms };
}
