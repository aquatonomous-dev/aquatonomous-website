import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { CourseData, ModelDef, Pose, VisualDef } from "../types";
import { quatFromRpy } from "../math";

export function applyPose(object: THREE.Object3D, pose: Pose): void {
  object.position.set(pose[0], pose[1], pose[2]);
  const [x, y, z, w] = quatFromRpy(pose[3], pose[4], pose[5]);
  object.quaternion.set(x, y, z, w);
}

/** Builds Three.js objects for SDF visuals. Geometry stays in Gazebo's frame (z up). */
export class ModelLibrary {
  private readonly loader: GLTFLoader;
  private readonly draco: DRACOLoader;
  private readonly meshes = new Map<string, THREE.BufferGeometry>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(dracoDecoderPath = "/draco/") {
    this.draco = new DRACOLoader();
    this.draco.setDecoderPath(dracoDecoderPath);
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(this.draco);
  }

  static meshUrls(course: CourseData): string[] {
    const urls = new Set<string>();
    for (const model of Object.values(course.models)) {
      for (const visual of model.visuals) if (visual.geometry.type === "mesh") urls.add(visual.geometry.url);
    }
    return [...urls];
  }

  async preload(urls: string[], onProgress?: (fraction: number) => void): Promise<void> {
    let done = 0;
    await Promise.all(
      urls.map(async (url) => {
        const gltf = await this.loader.loadAsync(url);
        let geometry: THREE.BufferGeometry | null = null;
        gltf.scene.traverse((child) => {
          if (!geometry && child instanceof THREE.Mesh) geometry = child.geometry;
        });
        if (!geometry) throw new Error(`No mesh in ${url}`);
        this.meshes.set(url, geometry);
        onProgress?.(++done / urls.length);
      }),
    );
    this.draco.dispose();
  }

  private material(visual: VisualDef): THREE.MeshStandardMaterial {
    const [r, g, b, a] = visual.color;
    const key = [r, g, b, a, visual.roughness, visual.metalness, ...(visual.emissive ?? [])].join(",");
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace),
        roughness: visual.roughness,
        metalness: visual.metalness,
        transparent: a < 1,
        opacity: a,
      });
      if (visual.emissive) material.emissive.setRGB(visual.emissive[0], visual.emissive[1], visual.emissive[2], THREE.SRGBColorSpace);
      this.materials.set(key, material);
    }
    return material;
  }

  private geometry(visual: VisualDef): THREE.BufferGeometry {
    const g = visual.geometry;
    if (g.type === "mesh") {
      const mesh = this.meshes.get(g.url);
      if (!mesh) throw new Error(`Mesh not preloaded: ${g.url}`);
      return mesh;
    }
    const key = JSON.stringify(g);
    let geometry = this.meshes.get(key);
    if (!geometry) {
      if (g.type === "box") geometry = new THREE.BoxGeometry(g.size[0], g.size[1], g.size[2]);
      else if (g.type === "sphere") geometry = new THREE.SphereGeometry(g.radius, 24, 16);
      else geometry = new THREE.CylinderGeometry(g.radius, g.radius, g.length, 20).rotateX(Math.PI / 2);
      this.meshes.set(key, geometry);
    }
    return geometry;
  }

  build(model: ModelDef): THREE.Group {
    const group = new THREE.Group();
    group.name = model.name;
    for (const visual of model.visuals) {
      const mesh = new THREE.Mesh(this.geometry(visual), this.material(visual));
      mesh.name = visual.name;
      applyPose(mesh, visual.pose);
      group.add(mesh);
    }
    return group;
  }
}
