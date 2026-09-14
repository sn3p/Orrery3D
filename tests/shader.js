import * as THREE from "three";
import Asteroids, { orbitGLSL, REFERENCE_JED, REBASE_DAYS } from "../src/js/Asteroids";
import { prepareCatalogue } from "../src/js/prepareCatalogue";
import Orbit from "../src/js/Orbit";

const oldColor = new THREE.Color(0x999999), freshColor = new THREE.Color(0x00ff00);
const options = { jed: REFERENCE_JED, color: oldColor, discoveryColor: freshColor, discoveryDuration: 200 };
function assert(condition, message) { if (!condition) throw new Error(message); }

// Read back the production GLSL and packed attributes independently of Three's
// shader injection. Pixel checks below also exercise the real PointsMaterial.
function transformFeedback(gl, packed, dates, epoch = REFERENCE_JED) {
  // Execute the same orbit/colour GLSL on the GPU, and read the result back only
  // in validation, never in the performance loop.
  const program = gl.createProgram();
  const vao = gl.createVertexArray();
  const sourceBuffer = gl.createBuffer();
  const feedback = gl.createTransformFeedback();
  const destination = gl.createBuffer();
  const shaders = [];
  try {
    const vs = `#version 300 es
      precision highp float;
      in vec3 p; in vec3 q; in vec2 elements; in float meanAnomaly; in float discovery;
      uniform float time; uniform float discoveryTime; out vec3 positionOut; out vec3 colorOut;
      ${orbitGLSL}
      void main() {
        positionOut = orbitPosition(p, q, elements, meanAnomaly, time);
        colorOut = discoveryColor(discoveryTime, discovery, 200.0, vec3(0,1,0), vec3(${oldColor.r}));
        gl_Position = vec4(positionOut, 1); gl_PointSize = 1.0;
      }`;
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; out vec4 c; void main(){c=vec4(1);}"]]) {
      const shader = gl.createShader(type); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      assert(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
      gl.attachShader(program, shader);
    }
    gl.transformFeedbackVaryings(program, ["positionOut", "colorOut"], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(program); assert(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, sourceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(packed), gl.STATIC_DRAW);
    for (const [name, size, offset] of [["p", 3, 0], ["q", 3, 3], ["elements", 2, 6], ["meanAnomaly", 1, 8], ["discovery", 1, 9]]) {
      const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4);
    }
    const count = packed.length / 10;
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, destination);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * 6 * 4, gl.STREAM_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, destination);
    gl.enable(gl.RASTERIZER_DISCARD);
    return dates.map(jed => {
      gl.uniform1f(gl.getUniformLocation(program, "time"), jed - epoch);
      gl.uniform1f(gl.getUniformLocation(program, "discoveryTime"), jed - REFERENCE_JED);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, count); gl.endTransformFeedback();
      const output = new Float32Array(count * 6);
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
      assert(gl.getError() === gl.NO_ERROR, "Transform feedback WebGL error");
      return output;
    });
  } finally {
    gl.disable(gl.RASTERIZER_DISCARD); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null); gl.useProgram(null);
    gl.deleteBuffer(sourceBuffer); gl.deleteBuffer(destination); gl.deleteTransformFeedback(feedback);
    gl.deleteVertexArray(vao); gl.deleteProgram(program); shaders.forEach(shader => gl.deleteShader(shader));
  }
}

function packedAttributes(cloud) {
  const attributes = cloud.geometry.attributes;
  const actual = new Float32Array(attributes.position.count * 10);
  for (let i = 0; i < attributes.position.count; i++) {
    actual.set(attributes.position.array.subarray(i * 3, i * 3 + 3), i * 10);
    actual.set(attributes.basisQ.array.subarray(i * 3, i * 3 + 3), i * 10 + 3);
    actual.set(attributes.elements.array.subarray(i * 2, i * 2 + 2), i * 10 + 6);
    actual[i * 10 + 8] = attributes.meanAnomaly.array[i];
    actual[i * 10 + 9] = attributes.discovery.array[i];
  }
  return actual;
}

function validateEccentricOrbits(gl) {
  const data = [0, 0.8, 0.961, 0.99, 0.9999, 0.99999994].flatMap(e =>
    [0, 0.000001, -0.000001, 0.0001, -0.0001, 1, -1, 179.999, -179.999].map(M => ({
      a: 1, e, M, i: 0, W: 0, wbar: 0, n: 1, epoch: REFERENCE_JED, disc: REFERENCE_JED,
    })));
  const cloud = new Asteroids(prepareCatalogue(data, REFERENCE_JED), { jed: REFERENCE_JED, color: oldColor,
    discoveryColor: freshColor, discoveryDuration: 200 });
  let output;
  try { output = transformFeedback(gl, packedAttributes(cloud), [REFERENCE_JED])[0]; }
  finally { cloud.dispose(); }
  let maxWorldError = 0;
  data.forEach((d, i) => {
    // Independent double-precision bisection: deliberately not the GPU's
    // Newton solver or the legacy solver's unbounded convergence loop.
    const M = d.M * Math.PI / 180;
    let lo = -Math.PI, hi = Math.PI;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if (mid - d.e * Math.sin(mid) < M) lo = mid; else hi = mid;
    }
    const E = (lo + hi) / 2;
    const expected = [100 * (Math.cos(E) - d.e), 100 * Math.sqrt(1 - d.e * d.e) * Math.sin(E), 0];
    const error = Math.hypot(...expected.map((v, axis) => v - output[i * 6 + axis]));
    assert(Number.isFinite(error) && error < 0.02, `Eccentric orbit error: e=${d.e}, M=${d.M}, error=${error}`);
    maxWorldError = Math.max(maxWorldError, error);
  });
  return { checks: data.length, maxWorldError };
}


export function validateShader(app, catalog) {
  // Reuse one validation context for all dates and edge cases. Losing many
  // short-lived contexts still depends on GC to free WebKit's context slots.
  const gl = document.createElement("canvas").getContext("webgl2");
  assert(gl, "WebGL 2 is required for shader checks");
  try { return validateShaderWithContext(app, catalog, gl); }
  finally { if (!gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}

function validateShaderWithContext(app, catalog, gl) {
  const dates = [2378861.5, 2444270.5, REFERENCE_JED, REFERENCE_JED + 0.001,
    REFERENCE_JED + REBASE_DAYS - 0.001, REFERENCE_JED + REBASE_DAYS, REFERENCE_JED + REBASE_DAYS + 0.001,
    REFERENCE_JED, REFERENCE_JED - REBASE_DAYS + 0.001, REFERENCE_JED - REBASE_DAYS,
    REFERENCE_JED - REBASE_DAYS - 0.001, 2488070.5];
  const cloud = new Asteroids(prepareCatalogue(catalog, options.jed), options);
  const camera = app.camera.clone();
  camera.position.set(500, 500, 400); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const expectedVector = new THREE.Vector3(), actualVector = new THREE.Vector3();
  let maxWorldError = 0, maxOverviewCssPixelError = 0;
  try {
    for (const jed of dates) {
      cloud.update(jed);
      const output = transformFeedback(gl, packedAttributes(cloud), [jed], cloud.epoch)[0];
      for (let i = 0; i < catalog.length; i++) {
        const expected = Orbit.getPosAtTime(catalog[i], jed);
        const error = Math.hypot(...expected.map((v, axis) => v - output[i * 6 + axis]));
        assert(Number.isFinite(error), `Nonfinite GPU position at ${i}, JED ${jed}`);
        maxWorldError = Math.max(maxWorldError, error);
        expectedVector.set(...expected).project(camera);
        actualVector.set(output[i * 6], output[i * 6 + 1], output[i * 6 + 2]).project(camera);
        if (Math.abs(expectedVector.x) <= 1 && Math.abs(expectedVector.y) <= 1 && Math.abs(expectedVector.z) <= 1) {
          maxOverviewCssPixelError = Math.max(maxOverviewCssPixelError,
            Math.hypot((expectedVector.x - actualVector.x) * innerWidth / 2, (expectedVector.y - actualVector.y) * innerHeight / 2));
        }
        const age = Math.max(0, Math.min(1, (jed - catalog[i].disc) / 200));
        for (let axis = 0; axis < 3; axis++) {
          const color = (axis === 1 ? 1 : 0) * (1 - age) + oldColor.r * age;
          assert(Math.abs(color - output[i * 6 + 3 + axis]) < 1e-4, "GPU discovery colour mismatch");
        }
      }
    }
    assert(maxOverviewCssPixelError < 0.25, `GPU overview error exceeds 0.25 CSS pixels: ${maxOverviewCssPixelError}`);
  } finally { cloud.dispose(); }

  const sample = catalog[Math.floor(catalog.length / 2)];
  const single = new Asteroids(prepareCatalogue([sample], options.jed), options);
  const colorDates = [-1, 0, 100, 200, 201, 100, -1, 0, 0, 0.125].map(age => sample.disc + age);
  try {
    const output = transformFeedback(gl, packedAttributes(single), colorDates);
    colorDates.forEach((jed, t) => {
      const age = Math.max(0, Math.min(1, (jed - sample.disc) / 200));
      for (let axis = 0; axis < 3; axis++) {
        const color = (axis === 1 ? 1 : 0) * (1 - age) + oldColor.r * age;
        assert(Math.abs(output[t][3 + axis] - color) < 1e-5, "GPU colour boundary failed");
      }
    });
  } finally { single.dispose(); }
  return { cataloguePositionsChecked: catalog.length * dates.length, dates, maxWorldError,
    maxOverviewCssPixelError, colorBoundaryChecks: colorDates.length,
    eccentricOrbits: validateEccentricOrbits(gl), rendered: validateRenderedOutput(app, catalog) };
}

// Static test oracle using the project's double-precision orbital model.
// There is no CPU animation path or alternative renderer in the application.
function referencePoints(catalog, jed) {
  const discovered = catalog.filter(d => d.disc <= jed);
  const positions = new Float32Array(discovered.length * 3), colors = new Float32Array(positions.length);
  discovered.forEach((d, i) => {
    positions.set(Orbit.getPosAtTime(d, jed), i * 3);
    const age = Math.max(0, Math.min(1, (jed - d.disc) / 200));
    colors.set(freshColor.clone().lerp(oldColor, age).toArray(), i * 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 1, vertexColors: true }));
}

function validateRenderedOutput(app, catalog) {
  const results = [], camera = app.camera.clone();
  const target = new THREE.WebGLRenderTarget(640, 400, { samples: 4 });
  const cloud = app.asteroids, originalJed = app.jed;
  const capture = surface => {
    app.renderer.setRenderTarget(surface === "canvas" ? null : target);
    app.renderer.render(app.scene, camera);
    if (surface === "canvas") {
      const gl = app.renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      assert(gl.getError() === gl.NO_ERROR, "Canvas readback failed");
      return pixels;
    }
    const pixels = new Uint8Array(640 * 400 * 4);
    app.renderer.readRenderTargetPixels(target, 0, 0, 640, 400, pixels);
    return pixels;
  };
  try {
    for (const [view, jed] of [["overview", REFERENCE_JED], ["close", REFERENCE_JED], ["overview", 2444270.5]]) {
      camera.position.set(...(view === "close" ? [100, 100, 80] : [500, 500, 400]));
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      cloud.update(jed);
      app.planets.forEach(planet => planet.render(jed));
      const reference = referencePoints(catalog, jed);
      try {
        for (const surface of ["render-target", "canvas"]) {
          app.scene.remove(cloud); app.scene.add(reference);
          const expected = capture(surface);
          app.scene.remove(reference); app.scene.add(cloud);
          const actual = capture(surface);
          let lit = 0, expectedLit = 0, absolute = 0;
          for (let i = 0; i < actual.length; i += 4) {
            if (actual[i] || actual[i + 1] || actual[i + 2]) lit++;
            if (expected[i] || expected[i + 1] || expected[i + 2]) expectedLit++;
            for (let c = 0; c < 3; c++) absolute += Math.abs(actual[i + c] - expected[i + c]);
          }
          const meanChannelError = absolute / (actual.length * 0.75);
          assert(lit > 100 && Math.abs(lit - expectedLit) / expectedLit < 0.02, `${surface} ${view}: point coverage mismatch`);
          assert(meanChannelError < 0.25, `${surface} ${view}: colour/position mismatch ${meanChannelError}`);
          results.push({ surface, view, jed, litPixels: lit, meanChannelError });
        }
      } finally {
        app.scene.remove(reference); app.scene.add(cloud);
        reference.geometry.dispose(); reference.material.dispose();
      }
    }
  } finally {
    cloud.update(originalJed); app.planets.forEach(planet => planet.render(originalJed));
    app.renderer.setRenderTarget(null); target.dispose();
  }
  return results;
}
