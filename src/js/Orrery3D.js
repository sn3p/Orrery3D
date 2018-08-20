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
    // Create scene
    this.scene = new THREE.Scene();

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

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
      const orbit = Orbit.createOrbit(data.ephemeris, this.jed);
      this.scene.add(orbit);

      // Add planet
      this.planets.push(planet);
      this.scene.add(planet.body);
    });
  }

  setAsteroids(asteroidData) {
    asteroidData.length = 9000;
    this.asteroidData = asteroidData;

    // Particle system for asteroids
    const geometry = new THREE.BufferGeometry();

    // const material = new THREE.ShaderMaterial({
    //   uniforms: {
    //     // texture: {
    //     //   value: new THREE.TextureLoader().load("textures/sprites/spark1.png")
    //     // }
    //     // diffuse: {
    //     //   value: new THREE.Color("aqua")
    //     // },
    //     color1: {
    //       value: new THREE.Color(0x00ff00)
    //     },
    //     color2: {
    //       value: new THREE.Color("white")
    //     },
    //     // color: { type: "c", value: new THREE.Color( 0x00ff00 ) },
    //     size: { type: "f", value: 2.0 },
    //     time: { type: "f", value: 1.0 }
    //   },
    //   vertexShader: document.getElementById("vertexshader").textContent,
    //   fragmentShader: document.getElementById("fragmentshader").textContent,
    //   blending: THREE.AdditiveBlending,
    //   depthTest: false,
    //   transparent: true,
    //   vertexColors: true
    // });

    const positions = new Float32Array(asteroidData.length * 3);
    const colors = new Float32Array(asteroidData.length * 3);
    // console.log(positions);

    const green = new THREE.Color(0x00ff00);
    // const white = new THREE.Color("white");
    let index = 0;
    for (let i = 0; i < this.asteroidData.length; ++i) {
      colors[index++] = green;
      colors[index++] = green;
      colors[index++] = green;
      // geometry.colors[i] = new THREE.Color();
      // geometry.colors[i].setHSL(Math.random(), 1.0, 0.5);
    }
    geometry.addAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.addAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      // color: 0xaaaaaa,
      size: 2,
      // transparent: true,
      vertexColors: THREE.VertexColors
    });

    this.asteroidsGeometry = geometry;

    const particleSystem = new THREE.Points(geometry, material);
    this.scene.add(particleSystem);
  }

  renderAsteroids() {
    const positions = this.asteroidsGeometry.attributes.position.array;
    const colors = this.asteroidsGeometry.attributes.color.array;
    let index = 0;
    let i;

    // const green = new THREE.Color(0x00ff00);
    // const white = new THREE.Color("white");

    for (i = 0; i < this.asteroidData.length; ++i) {
      const data = this.asteroidData[i];

      if (data.disc > this.jed) {
        break;
      }

      const [x, y, z] = Orbit.getPosAtTime(data, this.jed);

      positions[index++] = x;
      positions[index++] = y;
      positions[index++] = z;

      // index = index - 3;
      // colors[index++] = green;
      // colors[index++] = green;
      // colors[index++] = green;

      // if (data.disc > this.jed - 100) {
      //   console.log("green");
      //   colors[index++] = green;
      //   colors[index++] = green;
      //   colors[index++] = green;
      //   // colors[index++] = colors[index++] = colors[index++] = green;
      // } else {
      //   // console.log("white");
      //   colors[index++] = white;
      //   colors[index++] = white;
      //   colors[index++] = white;
      //   //   colors[index++] = colors[index++] = colors[index++] = white;
      // }
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
