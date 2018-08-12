import * as THREE from "three";

export default class Sun {
  constructor() {
    const geometry = new THREE.SphereGeometry(5, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00
    });

    this.body = new THREE.Mesh(geometry, material);
  }
}
