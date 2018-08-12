import THREE from "./three";
import { toJED } from "./utils";
import planetData from "./planets";
import Gui from "./Gui";
import Sun from "./Sun";
import Planet from "./Planet";
import Asteroid from "./Asteroid";

export default class Orrery3D {
  constructor(options = {}) {
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta || 1.5;
    this.jed = toJED(this.startDate);

    this.planets = [];
    this.asteroids = [];
    this.asteroidData = [];
    this.asteroidsGeometry = {};

    // Setup GUI
    this.gui = new Gui(this);

    // Create system
    this.createSystem();
    this.addPlanets(planetData);

    // Start rendering
    this.render();
  }

  createSystem() {
    // Create scene
    this.scene = new THREE.Scene();

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.001,
      2000000
    );
    this.camera.position.x = 500;
    this.camera.position.y = 500;
    this.camera.position.z = 400;
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(this.scene.position);

    // Add controls
    this.controls = new THREE.OrbitControls(this.camera);

    // Add Sun
    const sun = new Sun();
    this.scene.add(sun.body);

    // Add renderer
    this.containerElement = document.getElementById("orrery");
    this.containerElement.appendChild(this.renderer.domElement);
  }

  addPlanets(planetData) {
    planetData.forEach(data => {
      const planet = new Planet(data.ephemeris, {
        name: data.name,
        size: data.size,
        color: data.color
      });

      // Draw orbit
      const orbit = planet.orbit.createOrbit(this.jed);
      this.scene.add(orbit);

      // Add planet
      this.planets.push(planet);
      this.scene.add(planet.body);
    });
  }

  setAsteroids(asteroidData) {
    this.asteroidData = asteroidData;

    // Add all asteroids at once (for debugging/performance testing)
    // asteroidData.forEach(data => this.addAsteroid(data));

    // Create particle system
    this.asteroidsGeometry = new THREE.Geometry();
    const material = new THREE.PointsMaterial({ color: 0xaaaaaa, size: 1 });
    const particleSystem = new THREE.Points(this.asteroidsGeometry, material);
    this.scene.add(particleSystem);
  }

  discoverAsteroids() {
    for (let i = this.asteroids.length; i < this.asteroidData.length; ++i) {
      const data = this.asteroidData[i];

      if (data.disc > this.jed) {
        break;
      }

      // Add asteroid
      this.addAsteroid(data);
    }
  }

  addAsteroid(data) {
    const asteroid = new Asteroid(data);
    this.asteroids.push(asteroid);
    this.asteroidsGeometry.vertices.push(asteroid.body);
  }

  renderAsteroids() {
    this.asteroidsGeometry.verticesNeedUpdate = true;
    this.asteroids.forEach(asteroid => asteroid.render(this.jed));
  }

  render = () => {
    requestAnimationFrame(this.render);

    this.gui.stats.begin();

    this.jed += this.jedDelta;

    this.planets.forEach(planet => planet.render(this.jed));
    this.discoverAsteroids();
    this.renderAsteroids();

    this.renderer.render(this.scene, this.camera);

    this.gui.update();
    this.gui.stats.end();
  };
}
