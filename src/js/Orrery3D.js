import THREE from "./three";
import Sun from "./Sun";

export default class Orrery3D {
  constructor() {
    this.scene = new THREE.Scene();

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true
    });
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
    this.camera.position.y = 300;
    this.camera.position.z = 400;
    this.camera.lookAt(this.scene.position);

    // Add controls
    this.controls = new THREE.OrbitControls(this.camera);

    // Add grid
    const helper = new THREE.GridHelper(2000, 6, 0x666666, 0x666666);
    this.scene.add(helper);

    // Add Sun
    const sun = new Sun();
    this.scene.add(sun.body);

    // Start rendering
    this.render();
  }

  render = () => {
    requestAnimationFrame(this.render);

    this.renderer.render(this.scene, this.camera);
  };
}
