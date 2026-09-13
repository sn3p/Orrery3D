import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { toJED } from "./utils";
import planetData from "./planets";
import Gui from "./Gui";
import Sun from "./Sun";
import Planet from "./Planet";
import Orbit from "./Orbit";
import Asteroids from "./Asteroids";
import { prepareCatalogue } from "./prepareCatalogue";
import PlaybackClock from "./PlaybackClock";

const pixelRatioKey = "orrery3d.pixelRatio";
const pixelRatioChoice = value => ["auto", "1", "2", "3"].includes(value) ? value : "1";

export default class Orrery3D {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate || new Date(1980, 1);
    this._jedDelta = options.jedDelta ?? 1.5;
    this.rememberPixelRatio = options.rememberPixelRatio ?? true;
    this._pixelRatio = "1";
    if (this.rememberPixelRatio) {
      try { this._pixelRatio = pixelRatioChoice(localStorage.getItem(pixelRatioKey)); }
      catch { /* Storage may be unavailable; keep the 1× default. */ }
    }
    this.asteroidColor = new THREE.Color(options.asteroidColor ?? 0x999999);
    this.asteroidDiscoveryColor = new THREE.Color(options.asteroidDiscoveryColor ?? 0x00ff00);
    this.asteroidDiscoveryDuration = options.asteroidDiscoveryDuration ?? 200; // in Julian days

    this._jed = toJED(this.startDate);
    this.planets = [];
    this.asteroidsDiscovered = 0;
    this.clock = new PlaybackClock();
    // Benchmarks can own a finite scheduler without starting an app loop.
    this.autoRender = options.autoRender ?? true;
    this.animationFrame = null;
    this.disposed = false;
    this.contextLost = false;
    this.statusMessage = "Loading asteroids…";

    // Create system
    this.createSystem();
    this.gui = new Gui(this);
    this.addPlanets(planetData);

    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("resize", this.resize);
    this.watchPixelRatio();
    this.setStatus(this.statusMessage);

    // Start rendering
    this.render();
  }

  get jed() { return this._jed; }

  set jed(value) {
    if (Object.is(value, this._jed)) return;
    this._jed = value;
    this.requestRender();
  }

  get jedDelta() { return this._jedDelta; }

  set jedDelta(value) {
    if (Object.is(value, this._jedDelta)) return;
    const wasPlaying = this.isPlaying;
    this._jedDelta = value;
    if (!wasPlaying || !this.isPlaying) this.resetClock();
    this.requestRender();
  }

  get isPlaying() { return Number.isFinite(this.jedDelta) && this.jedDelta !== 0; }

  get pixelRatio() { return this._pixelRatio; }

  set pixelRatio(value) {
    const ratio = pixelRatioChoice(value);
    if (ratio === this._pixelRatio || this.disposed) return;
    this._pixelRatio = ratio;
    if (this.rememberPixelRatio) {
      try {
        localStorage.setItem(pixelRatioKey, ratio);
      } catch { /* The choice still works for this session when storage is blocked. */ }
    }
    this.resize();
  }

  get effectivePixelRatio() {
    return this.pixelRatio === "auto" ? window.devicePixelRatio
      : Math.min(Number(this.pixelRatio), window.devicePixelRatio);
  }

  createSystem() {
    // Create scene
    this.scene = new THREE.Scene();

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.renderer.setPixelRatio(this.effectivePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);

    // Add renderer
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      console.error("Unable to compile the scene shaders:", gl.getProgramInfoLog(program),
        gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
      this.setStatus("Unable to render this scene on your graphics device.", true);
    };

    // Create camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 2000000);
    this.camera.position.set(500, 500, 400);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.scene.position);

    // Add controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener("change", this.requestRender);

    // Add Sun
    const sun = new Sun();
    this.scene.add(sun.body);
  }

  addPlanets(planetData) {
    planetData.forEach((data) => {
      const planet = new Planet(data.ephemeris, {
        name: data.name,
        size: data.size,
        color: data.color,
      });

      // Draw orbit
      const orbit = Orbit.createOrbit(data.ephemeris, this.jed);
      this.scene.add(orbit);

      // Add planet
      this.planets.push(planet);
      this.scene.add(planet.body);
    });
  }

  setupAsteroids(data) {
    if (this.disposed) return;
    const packed = prepareCatalogue(data, this.jed);
    const asteroids = new Asteroids(packed, {
      jed: this.jed, color: this.asteroidColor,
      discoveryColor: this.asteroidDiscoveryColor,
      discoveryDuration: this.asteroidDiscoveryDuration,
    });
    if (this.asteroids) {
      this.scene.remove(this.asteroids);
      this.asteroids.dispose();
    }
    this.asteroids = asteroids;
    this.asteroidsGeometry = asteroids.geometry;
    this.scene.add(asteroids);
    this.updateAsteroids();
    this.setStatus("");
    this.clock.reset();
    this.requestRender();
  }

  updateAsteroids() {
    this.asteroidsDiscovered = this.asteroids.update(this.jed);
  }

  setStatus(message, error = false) {
    this.statusMessage = message;
    this.statusError = error;
    const element = document.getElementById("orrery-status");
    if (!element) return;
    const text = this.contextLost ? "Graphics connection lost. Waiting to reconnect…" : message;
    element.textContent = text;
    element.hidden = !text;
    element.setAttribute("role", error && !this.contextLost ? "alert" : "status");
  }

  resetClock = () => {
    this.clock.reset();
    this.gui.stats.reset();
  };

  onVisibilityChange = () => {
    this.resetClock();
    if (document.hidden) this.cancelRender();
    else this.requestRender();
  };

  requestRender = () => {
    if (!this.autoRender || this.disposed || document.hidden || this.contextLost || this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(this.render);
  };

  cancelRender() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  onContextLost = () => {
    this.contextLost = true;
    this.cancelRender();
    this.resetClock();
    // Release Three's old GPU caches/listeners while the context is lost.
    // Geometry arrays and materials remain reusable and upload on restoration.
    this.disposeSceneResources();
    this.setStatus(this.statusMessage, this.statusError);
  };

  onContextRestored = () => {
    this.contextLost = false;
    this.resetClock();
    this.setStatus(this.statusMessage, this.statusError);
    this.requestRender();
  };

  render = (timestamp = performance.now()) => {
    if (this.disposed) return;
    // Also allow an explicit render to consume an already-requested frame.
    this.cancelRender();
    if (document.hidden || this.contextLost) {
      this.resetClock();
      return;
    }

    this.renderFrame(this.jed + this.clock.advance(timestamp, this.jedDelta));
    if (this.isPlaying) this.requestRender();
  };

  // Shared scene work; callers own date advancement and scheduling. Optional
  // benchmark hooks keep asteroid CPU time and GPU draw time separate.
  renderFrame(jed = this.jed, { afterAsteroids, beforeRender, afterRender, trackFps = this.isPlaying } = {}) {
    if (this.disposed || document.hidden || this.contextLost) return;
    // Explicit dates do not invalidate the scene or advance the playback clock.
    this._jed = jed;
    if (this.asteroidsGeometry) {
      this.updateAsteroids();
    }
    afterAsteroids?.();
    this.planets.forEach((planet) => planet.render(this.jed));

    beforeRender?.();
    this.renderer.render(this.scene, this.camera);
    afterRender?.();

    if (trackFps) this.gui.stats.update();
    else this.gui.stats.reset();
    this.gui.update();
  }

  watchPixelRatio() {
    this.pixelRatioQuery?.removeEventListener("change", this.onPixelRatioChange);
    this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.pixelRatioQuery.addEventListener("change", this.onPixelRatioChange);
  }

  onPixelRatioChange = () => {
    if (this.disposed) return;
    // Display/zoom changes can alter DPR without changing the CSS viewport.
    // Rearm at the new resolution, including while paused, without polling.
    this.watchPixelRatio();
    this.resize();
  };

  resize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(this.effectivePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.gui?.updatePixelRatio();
    this.requestRender();
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelRender();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("resize", this.resize);
    this.pixelRatioQuery.removeEventListener("change", this.onPixelRatioChange);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.onContextLost);
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.gui.dispose();
    this.disposeSceneResources();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  disposeSceneResources() {
    this.scene.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
  }
}
