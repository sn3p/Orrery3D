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
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta || 1.5;
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
      antialias: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);

    // Add renderer
    this.containerElement = document.getElementById("orrery");
    this.containerElement.appendChild(this.renderer.domElement);

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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Add Sun
    const sun = new Sun();
    this.scene.add(sun.body);
  }

  addPlanets(planetData) {
    planetData.forEach(data => {
      const planet = new Planet(data.ephemeris, {
        name: data.name,
        size: data.size,
        color: data.color
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

    // Particle system for asteroids
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      color: 0xaaaaaa,
      size: 1
    });

    const positions = new Float32Array(asteroidData.length * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.asteroidsGeometry = geometry;

    const particleSystem = new THREE.Points(geometry, material);
    this.scene.add(particleSystem);
  }

  renderAsteroids() {
    const positions = this.asteroidsGeometry.attributes.position.array;
    let index = 0;
    let i;

    for (i = 0; i < this.asteroidData.length; ++i) {
      const data = this.asteroidData[i];

      if (data.disc > this.jed) {
        break;
      }

      const [x, y, z] = Orbit.getPosAtTime(data, this.jed);

      positions[index++] = x;
      positions[index++] = y;
      positions[index++] = z;
    }

    this.asteroidsDiscovered = i + 1;
    this.asteroidsGeometry.setDrawRange(0, this.asteroidsDiscovered);
    this.asteroidsGeometry.attributes.position.needsUpdate = true;
  }

  render = () => {
    requestAnimationFrame(this.render);

    this.gui.stats.begin();

    this.jed += this.jedDelta;

    this.planets.forEach(planet => planet.render(this.jed));

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
