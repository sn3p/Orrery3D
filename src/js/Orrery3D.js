import THREE from "./three";
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
    // THREE.Object3D.DefaultUp.set(0, 0, 1);

    // Create scene
    this.scene = new THREE.Scene();
    // this.scene.rotation.x = 2;

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // this.renderer.setClearColor(0x000000, 1);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.001,
      2000000
    );
    // this.camera.position.x = 500;
    // this.camera.position.y = 500;
    // this.camera.position.z = 400;
    // this.camera.up.set(0, 0, 1);
    // this.camera.lookAt(this.scene.position);
    // this.camera.rotation.x = Math.PI / 2;

    // Space
    this.space = new THREE.Group();
    // this.space = this.scene;
    this.scene.add(this.space);

    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(geometry, material);
    this.space.add(plane);

    // this.space.position.y = 0.5;
    // this.space.position.y = 500;
    // this.scene.rotation.x = 2;
    // this.space.rotation.x = 2;
    // this.space.updateMatrixWorld();
    // plane.position.x = 0;
    // plane.position.y = 0;
    // plane.position.z = 0;
    plane.rotation.x = Math.PI / 2;
    plane.position.y = geometry.parameters.height / 2;

    // Add controls
    // this.controls = new THREE.OrbitControls(this.camera);

    // Add Sun
    const sun = new Sun();
    this.space.add(sun.body);

    // Add renderer
    this.containerElement = document.getElementById("orrery");
    this.containerElement.appendChild(this.renderer.domElement);

    // Array of functions for the rendering loop
    this.onRenderFuntions = [];
    // Init AR
    this.initAR();

    // Window resize
    window.addEventListener("resize", this.resize, false);
  }

  initAR() {
    // Create arToolkitSource
    this.arToolkitSource = new THREEx.ArToolkitSource({
      sourceType: "webcam"
    });
    this.arToolkitSource.init(this.resize);

    // Create atToolkitContext
    this.arToolkitContext = new THREEx.ArToolkitContext({
      // debug: true,
      cameraParametersUrl: "data/camera_para.dat",
      detectionMode: "mono"
      // maxDetectionRate: 30,
      // canvasWidth: 80 * 3,
      // canvasHeight: 60 * 3
    });

    this.arToolkitContext.init(() => {
      // Copy projection matrix to camera
      this.camera.projectionMatrix.copy(
        this.arToolkitContext.getProjectionMatrix()
      );
    });

    // Update artoolkit on every frame
    this.onRenderFuntions.push(() => {
      if (this.arToolkitSource.ready === false) return;
      this.arToolkitContext.update(this.arToolkitSource.domElement);
    });

    // Create ArMarkerControls
    const markerRoot = new THREE.Group();
    this.scene.add(markerRoot);

    const artoolkitMarker = new THREEx.ArMarkerControls(
      this.arToolkitContext,
      markerRoot,
      {
        type: "pattern",
        patternUrl: "data/patt.hiro"
      }
    );

    // Build a smoothedControls
    const smoothedControls = new THREEx.ArSmoothedControls(this.space, {
      lerpPosition: 0.4,
      lerpQuaternion: 0.3,
      lerpScale: 1
    });

    this.onRenderFuntions.push(delta => {
      smoothedControls.update(markerRoot);
    });
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
      this.space.add(orbit);

      // Add planet
      this.planets.push(planet);
      this.space.add(planet.body);
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
    geometry.addAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.asteroidsGeometry = geometry;

    const particleSystem = new THREE.Points(geometry, material);
    this.space.add(particleSystem);
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

    this.onRenderFuntions.forEach(fn => fn());
  };

  resize = () => {
    // Resize stage
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Resize AR
    this.arToolkitSource.onResize();
    this.arToolkitSource.copySizeTo(this.renderer.domElement);

    if (this.arToolkitContext.arController !== null) {
      this.arToolkitSource.copySizeTo(
        this.arToolkitContext.arController.canvas
      );
    }
  };
}
