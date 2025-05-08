import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { toJED } from "./utils";
import planetData from "./planets";
import Gui from "./Gui";
import Sun from "./Sun";
import Planet from "./Planet";
import Orbit from "./Orbit";

export default class Orrery3D {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta || 1.5;
    this.asteroidColor = new THREE.Color(options.asteroidColor || 0xaaaaaa);
    this.asteroidDiscoveryColor = new THREE.Color(options.asteroidDiscoveryColor || 0x00ff00);
    this.asteroidDiscoveryDuration = options.asteroidDiscoveryDuration || 500; // in Julian days

    this.jed = toJED(this.startDate);
    this.planets = [];
    this.asteroidData = [];
    this.asteroidsDiscovered = 0;

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

  setupAsteroids(asteroidData) {
    // Sort by discovery date
    asteroidData.sort((a, b) => a.disc - b.disc);
    this.asteroidData = asteroidData;

    // Geometry setup
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(asteroidData.length * 3);
    const colors = new Float32Array(asteroidData.length * 3);

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.asteroidsGeometry = geometry;

    // Initialize with default colors
    for (let i = 0; i < asteroidData.length; ++i) {
      colors[i * 3] = this.asteroidColor.r;
      colors[i * 3 + 1] = this.asteroidColor.g;
      colors[i * 3 + 2] = this.asteroidColor.b;
    }

    // Store HSL of discovery color
    this.asteroidDiscoveryHSL = {};
    this.asteroidDiscoveryColor.getHSL(this.asteroidDiscoveryHSL);

    const material = new THREE.PointsMaterial({
      size: 1,
      vertexColors: true,
      // color: 0xaaaaaa,
    });

    const particleSystem = new THREE.Points(geometry, material);
    this.scene.add(particleSystem);
  }

  updateAsteroids() {
    // Precompute the fade cutoff JED at which the asteroid will be fully faded
    const fadeCutoff = this.jed - this.asteroidDiscoveryDuration;

    // Get the attributes that we need to update
    const { position, color } = this.asteroidsGeometry.attributes;

    let i;
    for (i = 0; i < this.asteroidData.length; ++i) {
      const data = this.asteroidData[i];

      // Break if asteroid is not yet discovered
      if (data.disc > this.jed) break;

      const offset = i * 3;

      // Calculate position and color
      this.updateAsteroidPosition(data, offset, position.array);

      // Only update color if asteroid is still fading
      if (data.disc > fadeCutoff) {
        this.updateAsteroidColor(data, offset, color.array);
      }
    }

    // Update geometry
    this.asteroidsGeometry.attributes.position.needsUpdate = true;
    this.asteroidsGeometry.attributes.color.needsUpdate = true;

    // Update the number of asteroids to draw
    this.asteroidsDiscovered = i;
    this.asteroidsGeometry.setDrawRange(0, this.asteroidsDiscovered);
  }

  updateAsteroidPosition(data, offset, positions) {
    const [x, y, z] = Orbit.getPosAtTime(data, this.jed);

    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
  }

  updateAsteroidColor(data, offset, colors) {
    const ageJED = this.jed - data.disc;
    const t = ageJED / this.asteroidDiscoveryDuration;

    colors[offset] = THREE.MathUtils.lerp(this.asteroidDiscoveryColor.r, this.asteroidColor.r, t);
    colors[offset + 1] = THREE.MathUtils.lerp(this.asteroidDiscoveryColor.g, this.asteroidColor.g, t);
    colors[offset + 2] = THREE.MathUtils.lerp(this.asteroidDiscoveryColor.b, this.asteroidColor.b, t);
  }

  render = () => {
    requestAnimationFrame(this.render);

    this.gui.stats.begin();

    this.jed += this.jedDelta;

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
