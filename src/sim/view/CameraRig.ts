import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CameraDef } from "../types";
import { clamp } from "../math";
import { applyPose } from "./ModelLibrary";
import { gzToThree } from "./frames";

export type CameraMode = "chase" | "orbit" | "top" | "onboard";

const DEFAULT_FOV = 55;
const UP = new THREE.Vector3(0, 1, 0);
const NORTH_UP = new THREE.Vector3(0, 0, -1);

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "chase";

  private readonly orbit: OrbitControls;
  private chaseYaw = 0;
  private chaseDistance = 4.5;
  private topHeight = 40;
  private readonly boat = new THREE.Vector3();
  private readonly lastBoat = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private onboardSource: THREE.PerspectiveCamera | null = null;
  private onboardHfov = 1;
  private onboardAspect = 1;
  private snap = true;

  constructor(private readonly element: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.05, 6000);
    this.orbit = new OrbitControls(this.camera, element);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 120;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.enabled = false;
    element.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private readonly onWheel = (event: WheelEvent) => {
    if (this.mode === "orbit" || this.mode === "onboard") return;
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.001);
    if (this.mode === "chase") this.chaseDistance = clamp(this.chaseDistance * factor, 2, 20);
    else this.topHeight = clamp(this.topHeight * factor, 8, 160);
  };

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.orbit.enabled = mode === "orbit";
    this.camera.up.copy(mode === "top" ? NORTH_UP : UP);
    if (mode === "orbit") {
      this.orbit.target.copy(this.boat);
      this.camera.up.copy(UP);
      this.orbit.update();
    }
    this.updateFov();
    this.snap = true;
  }

  /** Drives the main view from an onboard camera. */
  setOnboard(source: THREE.PerspectiveCamera, hfov: number, sensorAspect: number): void {
    this.onboardSource = source;
    this.onboardHfov = hfov;
    this.onboardAspect = sensorAspect;
    this.setMode("onboard");
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.updateFov();
  }

  /** Onboard views fill the window with a crop of the sensor's image rather than widening it. */
  private updateFov(): void {
    if (this.mode === "onboard") {
      const tanHalfVertical = Math.tan(this.onboardHfov / 2) / Math.max(this.camera.aspect, this.onboardAspect);
      this.camera.fov = (2 * Math.atan(tanHalfVertical) * 180) / Math.PI;
    } else {
      this.camera.fov = DEFAULT_FOV;
    }
    this.camera.updateProjectionMatrix();
  }

  /** boat: link position in Gazebo's frame; yaw counter-clockwise from east. */
  update(dt: number, boatX: number, boatY: number, boatZ: number, yaw: number): void {
    gzToThree(boatX, boatY, boatZ, this.boat);
    const follow = this.snap ? 1 : 1 - Math.exp(-dt * 5);

    if (this.mode === "chase") {
      this.chaseYaw += shortestAngle(this.chaseYaw, yaw) * (this.snap ? 1 : 1 - Math.exp(-dt * 2.5));
      const cx = boatX - Math.cos(this.chaseYaw) * this.chaseDistance;
      const cy = boatY - Math.sin(this.chaseYaw) * this.chaseDistance;
      gzToThree(cx, cy, Math.max(boatZ, 0) + 0.4 + this.chaseDistance * 0.32, this.desired);
      this.camera.position.lerp(this.desired, follow);
      gzToThree(boatX + Math.cos(this.chaseYaw) * 2, boatY + Math.sin(this.chaseYaw) * 2, boatZ + 0.3, this.target);
      this.camera.lookAt(this.target);
    } else if (this.mode === "orbit") {
      if (this.snap) {
        gzToThree(boatX - 6, boatY - 6, boatZ + 4, this.camera.position);
        this.orbit.target.copy(this.boat);
      } else {
        const delta = this.desired.subVectors(this.boat, this.lastBoat);
        this.camera.position.add(delta);
        this.orbit.target.add(delta);
      }
      this.orbit.update();
    } else if (this.mode === "onboard" && this.onboardSource) {
      this.onboardSource.updateWorldMatrix(true, false);
      this.onboardSource.matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.scale);
    } else {
      gzToThree(boatX, boatY, this.topHeight, this.desired);
      this.camera.position.lerp(this.desired, follow);
      this.target.set(this.camera.position.x, 0, this.camera.position.z);
      this.camera.lookAt(this.target);
    }
    this.lastBoat.copy(this.boat);
    this.snap = false;
  }

  dispose(): void {
    this.element.removeEventListener("wheel", this.onWheel);
    this.orbit.dispose();
  }
}

/**
 * Onboard cameras from the SDF, to be added under the boat's Gazebo-frame group.
 * Gazebo cameras look along +x with z up; Three.js cameras look along -z with y up.
 */
export function createOnboardCameras(defs: CameraDef[]): THREE.PerspectiveCamera[] {
  const basis = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)),
  );
  return defs.map((def) => {
    const aspect = def.width / def.height;
    const vfov = (2 * Math.atan(Math.tan(def.hfov / 2) / aspect) * 180) / Math.PI;
    const camera = new THREE.PerspectiveCamera(vfov, aspect, Math.max(def.near, 0.05), Math.min(def.far, 2000));
    camera.name = def.name;
    applyPose(camera, def.pose);
    camera.quaternion.multiply(basis);
    return camera;
  });
}
