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
    this.jed = toJED(this.startDate);

    this.fadeDurationJED = 500;

    // Colors
    this.asteroidColor = new THREE.Color(options.asteroidColor || 0xaaaaaa);
    this.asteroidDiscoveryColor = new THREE.Color(options.asteroidDiscoveryColor || 0x00ff00);

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
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.001,
      2000000
    );
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

  setAsteroids(asteroidData) {
    this.asteroidData = asteroidData;

    // Geometry setup
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(asteroidData.length * 3);
    const colors = new Float32Array(asteroidData.length * 3);

    // Initialize all positions and colors to gray
    // for (let i = 0; i < asteroidData.length; i++) {
    //   positions[i * 3] = 0;
    //   positions[i * 3 + 1] = 0;
    //   positions[i * 3 + 2] = 0;

    //   colors[i * 3] = 0.666;
    //   colors[i * 3 + 1] = 0.666;
    //   colors[i * 3 + 2] = 0.666;
    // }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.asteroidsGeometry = geometry;

    // Store HSL of discovery color
    this.asteroidDiscoveryHSL = {};
    this.asteroidDiscoveryColor.getHSL(this.asteroidDiscoveryHSL);
    this.tempColor = new THREE.Color(); // reusable scratch color

    const material = new THREE.PointsMaterial({
      // color: 0xaaaaaa,
      size: 1,
      vertexColors: true,
    });

    const particleSystem = new THREE.Points(geometry, material);
    this.scene.add(particleSystem);
  }

  renderAsteroids() {
    const positions = this.asteroidsGeometry.attributes.position.array;
    const colors = this.asteroidsGeometry.attributes.color.array;

    let index = 0;
    let i;

    for (i = 0; i < this.asteroidData.length; ++i) {
      const data = this.asteroidData[i];

      // Break if asteroid is not yet discovered
      if (data.disc > this.jed) {
        break;
      }

      // Set position
      const [x, y, z] = Orbit.getPosAtTime(data, this.jed);
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = z;

      // Set color
      const ageJED = this.jed - data.disc;
      const fadeProgress = Math.min(Math.max(ageJED / this.fadeDurationJED, 0), 1);
      const { h, l } = this.asteroidDiscoveryHSL;
      const s = 1 - fadeProgress;
      this.tempColor.setHSL(h, s, l);
      colors[index] = this.tempColor.r;
      colors[index + 1] = this.tempColor.g;
      colors[index + 2] = this.tempColor.b;

      index += 3;
    }

    this.asteroidsDiscovered = i + 1;
    this.asteroidsGeometry.setDrawRange(0, this.asteroidsDiscovered);
    this.asteroidsGeometry.attributes.position.needsUpdate = true;
    this.asteroidsGeometry.attributes.color.needsUpdate = true;
  }

  render = () => {
    requestAnimationFrame(this.render);

    this.gui.stats.begin();

    this.jed += this.jedDelta;

    this.planets.forEach((planet) => planet.render(this.jed));

    if (this.asteroidsGeometry) {
      this.renderAsteroids();
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
