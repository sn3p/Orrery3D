import * as THREE from "three";

// Each body owns its resources; scene disposal and graphics recovery stay local.
export default function createSphere({ size, segments, color }) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(size, segments, segments),
    new THREE.MeshBasicMaterial({ color })
  );
}
