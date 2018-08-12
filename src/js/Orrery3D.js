import THREE from "./three";
import Sun from "./Sun";
import Planet from "./Planet";
import planetData from "./planets";
import { toJED } from "./utils";

export default class Orrery3D {
  constructor(options = {}) {
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta || 1.5;
    this.jed = toJED(this.startDate);

    // Create system
    this.createSystem();

    // Add planets
    this.planets = [];
    this.addPlanets(planetData);

    // Start rendering
    this.render();
  }

  createSystem() {
    // Create scene and renderer
    this.scene = new THREE.Scene();
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

  render = () => {
    requestAnimationFrame(this.render);

    this.jed += this.jedDelta;

    this.planets.forEach(planet => planet.render(this.jed));

    this.renderer.render(this.scene, this.camera);
  };
}
