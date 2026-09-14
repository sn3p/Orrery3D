import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { toJED } from "./utils";
import planetData from "./planets";
import Gui from "./Gui";
import Sun from "./Sun";
import Planet from "./Planet";
import Orbit from "./Orbit";
import Asteroids from "./Asteroids";
import { prepareCatalogue, allocateCatalogue } from "./prepareCatalogue";
import PlaybackClock from "./PlaybackClock";
import CatalogSource from "./catalog/CatalogSource";
import CatalogLoader from "./catalog/CatalogLoader";

export default class Orrery3D {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate || new Date(1980, 1);
    this._jedDelta = options.jedDelta ?? 1.5;
    this._pixelRatio = "1";
    this.asteroidColor = new THREE.Color(options.asteroidColor ?? 0x999999);
    this.asteroidDiscoveryColor = new THREE.Color(options.asteroidDiscoveryColor ?? 0x00ff00);
    this.asteroidDiscoveryDuration = options.asteroidDiscoveryDuration ?? 200; // in Julian days

    this._jed = options.startJed ?? toJED(this.startDate);
    if (!Number.isFinite(this._jed)) throw new Error("Invalid starting Julian day.");
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
    window.addEventListener("online", this.onCatalogOnline);
    this.watchPixelRatio();
    this.setStatus(this.statusMessage);

    // Start rendering
    this.render();
  }

  get jed() { return this._jed; }

  get catalogWaiting() {
    const loader = this.catalogLoader;
    return !this.renderFailure && (!!this.catalogOpening || !!(loader?.source && (loader.buffering || !loader.initialRendered)));
  }

  set jed(value) {
    if (this.catalogLoader?.source) {
      if (!Number.isFinite(value)) throw new Error("Invalid Julian day.");
      if (Object.is(value, this.requestedJed ?? this.jed)) return;
      this.requestedJed = value;
      this.resetClock();
      this.demandCatalog(value);
      this.onCatalogChange();
      return;
    }
    if (Object.is(value, this._jed)) return;
    this.requestedJed = null;
    this._jed = value;
    this.requestRender();
  }

  get jedDelta() { return this._jedDelta; }

  set jedDelta(value) {
    if (Object.is(value, this._jedDelta)) return;
    const wasPlaying = this.isPlaying;
    this._jedDelta = value;
    this.demandCatalog();
    if (!wasPlaying || !this.isPlaying) this.resetClock();
    this.requestRender();
  }

  get isPlaying() { return Number.isFinite(this.jedDelta) && this.jedDelta !== 0; }

  get pixelRatio() { return this._pixelRatio; }

  set pixelRatio(value) {
    const ratio = value === "2" ? "2" : "1";
    if (ratio === this._pixelRatio || this.disposed) return;
    this._pixelRatio = ratio;
    this.resize();
  }

  get effectivePixelRatio() {
    return window.devicePixelRatio >= 2 ? Number(this.pixelRatio) : Math.min(1, window.devicePixelRatio);
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
      this.renderFailure = new Error("Unable to render this scene on your graphics device.");
      this.catalogLoader?.loseGraphics();
      this.setStatus(this.renderFailure.message, true);
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
    this.catalogOpening?.abort();
    this.catalogOpening = null;
    this.catalogLoader?.clear();
    this.catalogFailure = null;
    this.requestedJed = null;
    this.installAsteroids(packed);
    this.setStatus("");
    this.clock.reset();
    this.requestRender();
  }

  installAsteroids(packed, committedCount = packed.dates.length) {
    const asteroids = new Asteroids(packed, {
      jed: this.jed, color: this.asteroidColor,
      discoveryColor: this.asteroidDiscoveryColor,
      discoveryDuration: this.asteroidDiscoveryDuration, committedCount,
    });
    if (this.asteroids) {
      this.scene.remove(this.asteroids);
      this.asteroids.dispose();
    }
    this.asteroids = asteroids;
    asteroids.onAfterRender = () => { this.catalogGraphicsDrawn = true; };
    this.asteroidsGeometry = asteroids.geometry;
    this.scene.add(asteroids);
    this.updateAsteroids();
  }

  ensureCatalogLoader() {
    if (this.catalogLoader) return this.catalogLoader;
    this.catalogLoader = new CatalogLoader({
      activate: count => {
        const start = performance.now();
        this.installAsteroids(allocateCatalogue(count, this.jed), 0);
        performance.measure("catalog:allocate", { start });
      },
      commit: event => {
        const start = performance.now();
        this.asteroids.append(prepareCatalogue(event.records, this.asteroids.epoch), event.start);
        performance.measure("catalog:prepare-commit", { start });
      },
      changed: this.onCatalogChange,
    });
    return this.catalogLoader;
  }

  // Trial boot and internal source replacement use the same lifecycle. No
  // public catalog selector or date-navigation control is introduced.
  async loadCatalog(pin, { mode = "indexed" } = {}) {
    if (this.disposed) return;
    this.catalogOpening?.abort();
    const opening = this.catalogOpening = new AbortController();
    this.catalogFailure = null;
    const loader = this.ensureCatalogLoader();
    loader.clear();
    this.requestedJed = null;
    if (this.asteroids) {
      this.asteroids.geometry.setDrawRange(0, 0);
      this.asteroidsDiscovered = 0;
    }
    this.setStatus("Loading asteroids…");
    this.resetClock();
    try {
      const source = await CatalogSource.open(pin, { mode, signal: opening.signal });
      if (this.disposed || opening !== this.catalogOpening) { source.close(); return; }
      loader.activate(source, this.jed);
      this.demandCatalog(this.jed);
      this.catalogOpening = null;
      this.requestRender();
      return source;
    } catch (error) {
      if (this.disposed || opening !== this.catalogOpening || error.name === "AbortError") return;
      this.catalogOpening = null;
      this.catalogFailure = error;
      loader.clear();
      this.updateCatalogStatus();
      this.resetClock();
      this.requestRender();
      throw error;
    }
  }

  onCatalogChange = (request = true) => {
    if (this.disposed) return;
    if (this.catalogWaiting) this.resetClock();
    this.updateCatalogStatus();
    if (request) this.requestRender();
  };

  updateCatalogStatus() {
    const loader = this.catalogLoader;
    const failure = this.renderFailure?.message
      || (this.catalogFailure && "Could not load the asteroid catalogue. Reload to try again.")
      || (loader?.errorKind === "commit" && "This asteroid catalogue cannot be prepared for this renderer.")
      || (loader?.error && loader.buffering && "Could not load more asteroids. Reload to try again.");
    const message = failure || (this.catalogOpening || (loader?.source && !loader.initialRendered)
      ? "Loading asteroids…" : loader?.buffering ? "Buffering asteroids…" : "");
    if (message !== this.statusMessage || !!failure !== this.statusError) this.setStatus(message, !!failure);
  }

  demandCatalog(date = this.requestedJed ?? this.jed, hidden = this.contextLost || document.hidden) {
    // An opening failure or shader failure leaves the unaffected planets usable.
    // Graphics failure still prevents the trial from claiming a complete scene.
    if (this.renderFailure) return true;
    if (!this.catalogLoader?.source) return !this.catalogOpening;
    return this.catalogLoader.demand(date, { playing: this.isPlaying, hidden });
  }

  onCatalogOnline = () => { this.catalogLoader?.retry(); };

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
    this.demandCatalog();
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
    this.catalogLoader?.loseGraphics();
    this.demandCatalog(this.requestedJed ?? this.jed, true);
    // Release Three's old GPU caches/listeners while the context is lost.
    // Geometry arrays and materials remain reusable and upload on restoration.
    this.disposeSceneResources();
    this.setStatus(this.statusMessage, this.statusError);
  };

  onContextRestored = () => {
    this.contextLost = false;
    this.renderFailure = null;
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

    if (this.catalogWaiting) this.clock.reset();
    const elapsed = this.clock.advance(timestamp, this.jedDelta);
    const next = this.requestedJed ?? (this.jed + elapsed);
    this.renderFrame(next);
    if (this.isPlaying && !this.catalogOpening && !this.catalogWaiting) this.requestRender();
  };

  // Shared scene work; callers own date advancement and scheduling. Optional
  // benchmark hooks keep asteroid CPU time and GPU draw time separate.
  renderFrame(jed = this.requestedJed ?? this.jed, { afterAsteroids, beforeRender, afterRender, trackFps = this.isPlaying } = {}) {
    if (this.disposed || document.hidden || this.contextLost) return;
    const loader = this.catalogLoader;
    const commitStarted = loader?.source && (!loader.graphicsValid || loader.graphicsCount !== loader.committedCount)
      ? performance.now() : null;
    const hadInitialRender = loader?.initialRendered;
    if (!this.demandCatalog(jed)) {
      // Keep the requested demand while drawing the previous complete date;
      // fallback drawing must not cancel the work needed for a pending jump.
      this.requestedJed = jed;
      this.resetClock();
      this.onCatalogChange(false);
      jed = this.jed;
      trackFps = false;
    } else this.requestedJed = null;
    // Explicit dates do not invalidate the scene or advance the playback clock.
    this._jed = jed;
    if (this.asteroidsGeometry && !this.catalogOpening && !this.catalogFailure && (!loader?.source || (!this.renderFailure && loader.readyToDraw(jed)))) {
      this.updateAsteroids();
    } else if (this.asteroidsGeometry) {
      this.asteroidsGeometry.setDrawRange(0, 0);
      this.asteroidsDiscovered = 0;
    }
    afterAsteroids?.();
    this.planets.forEach((planet) => planet.render(this.jed));

    beforeRender?.();
    this.catalogGraphicsDrawn = false;
    this.renderer.render(this.scene, this.camera);
    if (commitStarted !== null) performance.measure("catalog:graphics-commit", { start: commitStarted });
    if (loader?.source && !this.contextLost && !this.renderFailure
      && (this.catalogGraphicsDrawn || loader.source.info.counts.discovery_export === 0)) {
      loader.rendered();
      if (loader.initialRendered && !hadInitialRender) {
        performance.mark("catalog:first-complete", { detail: { sourceId: loader.source.sourceId } });
      }
      this.updateCatalogStatus();
    }
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
    this.catalogOpening?.abort();
    this.catalogLoader?.dispose();
    this.cancelRender();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("online", this.onCatalogOnline);
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
