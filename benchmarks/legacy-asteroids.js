// Frozen CPU asteroid implementation from b12721a (before GPU integration).
// Benchmark/reference only; never imported by the production app.
import * as THREE from "three";
import Orbit from "../src/js/Orbit";

export default class LegacyAsteroids {
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

}
