import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { toJED } from "./utils";
import planetData from "./planets";
import Gui from "./Gui";
import Sun from "./Sun";
import Planet from "./Planet";
import Orbit from "./Orbit";
import Asteroids from "./Asteroids";
import PlaybackClock from "./PlaybackClock";

export default class Orrery3D {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta ?? 1.5;
    this.asteroidColor = new THREE.Color(options.asteroidColor ?? 0x999999);
    this.asteroidDiscoveryColor = new THREE.Color(options.asteroidDiscoveryColor ?? 0x00ff00);
    this.asteroidDiscoveryDuration = options.asteroidDiscoveryDuration ?? 200; // in Julian days

    this.jed = toJED(this.startDate);
    this.planets = [];
    this.asteroidData = [];
    this.asteroidsDiscovered = 0;
    this.clock = new PlaybackClock();

    // Setup GUI
    this.gui = new Gui(this);

    // Create system
    this.createSystem();
    this.addPlanets(planetData);

    document.addEventListener("visibilitychange", this.resetClock);

    // Start rendering
    this.render();
  }

  createSystem() {
    // Create scene
    this.scene = new THREE.Scene();

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);

    // Add renderer
    this.container.appendChild(this.renderer.domElement);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 2000000);
    this.camera.position.set(500, 500, 400);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.scene.position);

    // Add controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

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
    const asteroids = new Asteroids(data, {
      jed: this.jed, color: this.asteroidColor,
      discoveryColor: this.asteroidDiscoveryColor,
      discoveryDuration: this.asteroidDiscoveryDuration,
    });
    if (this.asteroids) {
      this.scene.remove(this.asteroids);
      this.asteroids.dispose();
    }
    this.asteroids = asteroids;
    this.asteroidData = asteroids.data;
    this.asteroidsGeometry = asteroids.geometry;
    this.scene.add(asteroids);
    this.updateAsteroids();
    this.clock.reset();
  }

  updateAsteroids() {
    this.asteroidsDiscovered = this.asteroids.update(this.jed);
  }

  resetClock = () => { this.clock.reset(); };

  render = (timestamp = performance.now()) => {
    requestAnimationFrame(this.render);
    if (document.hidden) {
      this.resetClock();
      return;
    }

    this.gui.stats.begin();

    this.jed += this.clock.advance(timestamp, this.jedDelta);

    this.planets.forEach((planet) => planet.render(this.jed));

    if (this.asteroidsGeometry) {
      this.updateAsteroids();
    }

    this.renderer.render(this.scene, this.camera);

    this.gui.update();
    this.gui.stats.end();
  };

  resize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
