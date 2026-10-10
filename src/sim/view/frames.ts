import * as THREE from "three";

// Gazebo is z-up (x east, y north); Three.js is y-up. The scene's Gazebo root
// group is rotated -90 degrees about x, so (x, y, z) maps to (x, z, -y).

export function gzToThree(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x, z, -y);
}

export function threeToGz(v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v.x, -v.z, v.y);
}

export function createGazeboRoot(): THREE.Group {
  const root = new THREE.Group();
  root.name = "gazebo";
  root.rotation.x = -Math.PI / 2;
  return root;
}
