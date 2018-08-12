import * as THREE from "three";

export default class Sun {
  static defaultOptions = {
    size: 5,
    segments: 32,
    color: 0xffff00
  };

  constructor(options) {
    this.options = Object.assign({}, Sun.defaultOptions, options);

    // Create body
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(
        this.options.size,
        this.options.segments,
        this.options.segments
      ),
      new THREE.MeshBasicMaterial({
        color: this.options.color
      })
    );
  }
}
