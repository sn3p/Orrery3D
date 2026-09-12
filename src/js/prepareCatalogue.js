import { DEG_TO_RAD, PIXELS_PER_AU } from "./constants.js";

export const REFERENCE_JED = 2458600.5;
const TAU = 2 * Math.PI;
export const wrapPhase = value => value - TAU * Math.floor((value + Math.PI) / TAU);

// Pure CPU preparation: no Three.js, DOM, fetch or GPU resource allocation.
// The result owns its typed buffers, retains no input records, and can be
// transferred between threads. Hand ownership to one Asteroids instance;
// its phase refresh mutates elements. Epoch records when those phases apply.
export function prepareCatalogue(data, epoch) {
  if (!Number.isFinite(epoch)) throw new Error("Invalid asteroid date.");
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
  // Sort row indices so errors still identify the original input entry.
  // Stable sorting also preserves source order for equal discovery dates.
  const sorted = Array.from({ length: data.length }, (_, index) => index)
    .sort((a, b) => data[a].disc - data[b].disc);
  const count = sorted.length;
  const p = new Float32Array(count * 3), q = new Float32Array(count * 3);
  const elements = new Float32Array(count * 3), discovery = new Float32Array(count);
  const phases = new Float64Array(count * 2), dates = new Float64Array(count);
  let radius = 0;
  sorted.forEach((sourceIndex, index) => {
    const d = data[sourceIndex];
    const offset = index * 3;
    const o = d.W * DEG_TO_RAD;
    const w = ((d.wbar ?? d.w + d.W) - d.W) * DEG_TO_RAD;
    const inc = d.i * DEG_TO_RAD;
    const a = d.a * PIXELS_PER_AU, b = a * Math.sqrt(1 - d.e * d.e);
    const n = d.n ? d.n * DEG_TO_RAD : TAU / d.P;
    const mean = wrapPhase(d.M * DEG_TO_RAD + n * (REFERENCE_JED - d.epoch));
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
    elements.set([d.e, wrapPhase(mean + n * (epoch - REFERENCE_JED)), n], offset);
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
      throw new Error(`Orbit exceeds rendering precision at catalogue entry ${sourceIndex + 1}.`);
    }
  });
  return { p, q, elements, discovery, phases, dates, radius, epoch };
}
