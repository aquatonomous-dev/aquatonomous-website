import type * as Rapier from "@dimforge/rapier3d-compat";
import type { CollisionGeometry, CourseData, ModelDef, Pose, Quat, ThrusterDef, Vec3 } from "../types";
import { quatFromRpy, quatToMatrix } from "../math";
import {
  HullHydrodynamics,
  boxMesh,
  coefficientsFor,
  createRigidState,
  cylinderMesh,
  meshBounds,
  weldTriangles,
  type HydroCoefficients,
  type RigidState,
  type TriangleMesh,
} from "./Hydrodynamics";
import { WaterPatch, type WaveSampler } from "./WaterPatch";
import { sphereHydrodynamics } from "./sphereHydrodynamics";

let RAPIER: typeof Rapier;
let engineReady: Promise<void> | null = null;

/** Loads Rapier (a separate ~1.6 MB chunk with inlined WebAssembly) and initialises it. */
export function initPhysicsEngine(): Promise<void> {
  engineReady ??= import("@dimforge/rapier3d-compat").then(async (module) => {
    const rapier = (module.default ?? module) as typeof Rapier;
    await rapier.init();
    RAPIER = rapier;
  });
  return engineReady;
}

export interface BodyPose {
  position: Vec3;
  rotation: Quat;
}

type HydroModel =
  | { kind: "hull"; hull: HullHydrodynamics; patch: WaterPatch }
  | { kind: "sphere"; radius: number; offset: Vec3 }
  // Decoration with no collision geometry (e.g. the course's shoreline banks/trees): rendered,
  // but neither buoyant nor collidable.
  | { kind: "none" };

const scratch = { x: 0, y: 0, z: 0 };

export class FloatingBody {
  readonly state: RigidState = createRigidState();
  readonly force = new Float64Array(3);
  readonly torque = new Float64Array(3);
  readonly previous: BodyPose;
  readonly current: BodyPose;
  wetFraction = 0;

  constructor(
    readonly name: string,
    readonly model: ModelDef,
    readonly body: Rapier.RigidBody,
    private readonly hydro: HydroModel,
    private readonly coefficients: HydroCoefficients,
    readonly spawn: BodyPose,
  ) {
    this.previous = { position: [...spawn.position], rotation: [...spawn.rotation] };
    this.current = { position: [...spawn.position], rotation: [...spawn.rotation] };
  }

  get hull(): HullHydrodynamics | null {
    return this.hydro.kind === "hull" ? this.hydro.hull : null;
  }

  readState(): void {
    const t = this.body.translation();
    const q = this.body.rotation();
    const v = this.body.linvel();
    const w = this.body.angvel();
    const s = this.state;
    s.position[0] = t.x; s.position[1] = t.y; s.position[2] = t.z;
    quatToMatrix(q.x, q.y, q.z, q.w, s.rotation);
    const c = this.model.mass.com;
    const r = s.rotation;
    s.com[0] = t.x + r[0] * c[0] + r[1] * c[1] + r[2] * c[2];
    s.com[1] = t.y + r[3] * c[0] + r[4] * c[1] + r[5] * c[2];
    s.com[2] = t.z + r[6] * c[0] + r[7] * c[1] + r[8] * c[2];
    s.linVel[0] = v.x; s.linVel[1] = v.y; s.linVel[2] = v.z;
    s.angVel[0] = w.x; s.angVel[1] = w.y; s.angVel[2] = w.z;
  }

  computeHydrodynamics(waves: WaveSampler): void {
    const s = this.state;
    if (this.hydro.kind === "hull") {
      const { hull, patch } = this.hydro;
      patch.update(waves, s.position[0], s.position[1]);
      hull.update(s, patch);
      this.force.set(hull.force);
      this.torque.set(hull.torque);
      this.wetFraction = hull.submergedArea / hull.area;
    } else if (this.hydro.kind === "sphere") {
      const { radius, offset } = this.hydro;
      const r = s.rotation;
      const center = [
        s.position[0] + r[0] * offset[0] + r[1] * offset[1] + r[2] * offset[2],
        s.position[1] + r[3] * offset[0] + r[4] * offset[1] + r[5] * offset[2],
        s.position[2] + r[6] * offset[0] + r[7] * offset[1] + r[8] * offset[2],
      ];
      const linVel = s.linVel;
      this.wetFraction = sphereHydrodynamics(
        center, linVel, s.angVel, radius, waves.sample(center[0], center[1]), this.coefficients, this.force, this.torque,
      );
      // The sphere's forces act through its centre; move them to the centre of mass.
      const rx = center[0] - s.com[0], ry = center[1] - s.com[1], rz = center[2] - s.com[2];
      const f = this.force;
      this.torque[0] += ry * f[2] - rz * f[1];
      this.torque[1] += rz * f[0] - rx * f[2];
      this.torque[2] += rx * f[1] - ry * f[0];
    } else {
      this.force.fill(0);
      this.torque.fill(0);
      this.wetFraction = 0;
    }
  }

  applyForces(): void {
    this.body.resetForces(false);
    this.body.resetTorques(false);
    scratch.x = this.force[0]; scratch.y = this.force[1]; scratch.z = this.force[2];
    this.body.addForce(scratch, true);
    scratch.x = this.torque[0]; scratch.y = this.torque[1]; scratch.z = this.torque[2];
    this.body.addTorque(scratch, true);
  }

  storePose(): void {
    const t = this.body.translation();
    const q = this.body.rotation();
    const { previous, current } = this;
    previous.position[0] = current.position[0];
    previous.position[1] = current.position[1];
    previous.position[2] = current.position[2];
    previous.rotation[0] = current.rotation[0];
    previous.rotation[1] = current.rotation[1];
    previous.rotation[2] = current.rotation[2];
    previous.rotation[3] = current.rotation[3];
    current.position[0] = t.x; current.position[1] = t.y; current.position[2] = t.z;
    current.rotation[0] = q.x; current.rotation[1] = q.y; current.rotation[2] = q.z; current.rotation[3] = q.w;
  }

  reset(): void {
    const [x, y, z] = this.spawn.position;
    const [qx, qy, qz, qw] = this.spawn.rotation;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: qx, y: qy, z: qz, w: qw }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.current.position = [x, y, z];
    this.current.rotation = [qx, qy, qz, qw];
    this.previous.position = [x, y, z];
    this.previous.rotation = [qx, qy, qz, qw];
  }
}

function poseToSpawn(pose: Pose): BodyPose {
  return { position: [pose[0], pose[1], pose[2]], rotation: quatFromRpy(pose[3], pose[4], pose[5]) };
}

function transformMesh(mesh: TriangleMesh, pose: Pose): TriangleMesh {
  const [qx, qy, qz, qw] = quatFromRpy(pose[3], pose[4], pose[5]);
  const r = quatToMatrix(qx, qy, qz, qw, new Float64Array(9));
  const out = new Float64Array(mesh.vertices.length);
  for (let i = 0; i < out.length; i += 3) {
    const x = mesh.vertices[i], y = mesh.vertices[i + 1], z = mesh.vertices[i + 2];
    out[i] = pose[0] + r[0] * x + r[1] * y + r[2] * z;
    out[i + 1] = pose[1] + r[3] * x + r[4] * y + r[5] * z;
    out[i + 2] = pose[2] + r[6] * x + r[7] * y + r[8] * z;
  }
  return { vertices: out, indices: mesh.indices };
}

function primitiveCollider(geometry: CollisionGeometry, pose: Pose): Rapier.ColliderDesc | null {
  let desc: Rapier.ColliderDesc;
  let rotation = quatFromRpy(pose[3], pose[4], pose[5]);
  if (geometry.type === "sphere") desc = RAPIER.ColliderDesc.ball(geometry.radius);
  else if (geometry.type === "box") desc = RAPIER.ColliderDesc.cuboid(geometry.size[0] / 2, geometry.size[1] / 2, geometry.size[2] / 2);
  else if (geometry.type === "cylinder") {
    // Rapier cylinders run along y; SDF cylinders run along z.
    desc = RAPIER.ColliderDesc.cylinder(geometry.length / 2, geometry.radius);
    rotation = quatFromRpy(pose[3] + Math.PI / 2, pose[4], pose[5]);
  } else return null;
  return desc
    .setTranslation(pose[0], pose[1], pose[2])
    .setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] })
    .setDensity(0)
    .setFriction(0.3)
    .setRestitution(0.05);
}

function rigidBodyDesc(model: ModelDef, spawn: BodyPose): Rapier.RigidBodyDesc {
  const { mass, com, principalInertia, inertiaFrame } = model.mass;
  const [x, y, z] = spawn.position;
  const [qx, qy, qz, qw] = spawn.rotation;
  return RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setRotation({ x: qx, y: qy, z: qz, w: qw })
    .setAdditionalMassProperties(
      mass,
      { x: com[0], y: com[1], z: com[2] },
      { x: principalInertia[0], y: principalInertia[1], z: principalInertia[2] },
      { x: inertiaFrame[0], y: inertiaFrame[1], z: inertiaFrame[2], w: inertiaFrame[3] },
    )
    .setCanSleep(false);
}

/** For decoration with no collision geometry and so no mass properties to give Rapier. */
function fixedBodyDesc(spawn: BodyPose): Rapier.RigidBodyDesc {
  const [x, y, z] = spawn.position;
  const [qx, qy, qz, qw] = spawn.rotation;
  return RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: qx, y: qy, z: qz, w: qw });
}

export interface PhysicsOptions {
  /** Fixed step in seconds. */
  step?: number;
}

/** Rapier rigid bodies with gz-waves style hydrodynamics. Requires initPhysicsEngine(). */
export class PhysicsWorld {
  readonly world: Rapier.World;
  readonly boat: FloatingBody;
  readonly floaters: FloatingBody[] = [];
  readonly bodies: FloatingBody[] = [];
  readonly thrusters: ThrusterDef[];
  /** Thrust per thruster in newtons, in the same order as `thrusters`. */
  readonly thrust: Float64Array;
  readonly step: number;
  time = 0;

  constructor(
    readonly course: CourseData,
    hullTriangles: Float32Array,
    private readonly waves: WaveSampler & { setTime(time: number): void },
    options: PhysicsOptions = {},
  ) {
    this.step = options.step ?? 1 / 240;
    const [gx, gy, gz] = course.world.gravity;
    this.world = new RAPIER.World({ x: gx, y: gy, z: gz });
    this.world.timestep = this.step;

    const boatModel = course.models[course.boat.model];
    const boatSpawn = poseToSpawn(course.boat.pose);
    const boatBody = this.world.createRigidBody(rigidBodyDesc(boatModel, boatSpawn));
    const hullMesh = weldTriangles(hullTriangles);
    this.addHullColliders(boatBody, hullMesh);
    this.boat = new FloatingBody(
      course.boat.name,
      boatModel,
      boatBody,
      { kind: "hull", hull: new HullHydrodynamics(hullMesh, coefficientsFor(boatModel.hydrodynamics)), patch: new WaterPatch(patchSize(hullMesh)) },
      coefficientsFor(boatModel.hydrodynamics),
      boatSpawn,
    );
    this.bodies.push(this.boat);
    this.thrusters = course.boat.thrusters;
    this.thrust = new Float64Array(this.thrusters.length);

    for (const instance of course.instances) {
      const model = course.models[instance.model];
      const spawn = poseToSpawn(instance.pose);
      if (model.collisions.length === 0) {
        // Decoration with nothing to collide or float on (e.g. the course's shoreline).
        const body = this.world.createRigidBody(fixedBodyDesc(spawn));
        this.bodies.push(new FloatingBody(instance.name, model, body, { kind: "none" }, coefficientsFor(model.hydrodynamics), spawn));
        continue;
      }
      const body = this.world.createRigidBody(rigidBodyDesc(model, spawn));
      for (const collision of model.collisions) {
        const desc = primitiveCollider(collision.geometry, collision.pose);
        if (desc) this.world.createCollider(desc, body);
      }
      const coefficients = coefficientsFor(model.hydrodynamics);
      const collision = model.collisions[0];
      let hydro: HydroModel;
      if (collision.geometry.type === "sphere") {
        hydro = { kind: "sphere", radius: collision.geometry.radius, offset: [collision.pose[0], collision.pose[1], collision.pose[2]] };
      } else if (collision.geometry.type === "box") {
        const mesh = transformMesh(boxMesh(collision.geometry.size), collision.pose);
        hydro = { kind: "hull", hull: new HullHydrodynamics(mesh, coefficients), patch: new WaterPatch(patchSize(mesh)) };
      } else if (collision.geometry.type === "cylinder") {
        const mesh = transformMesh(cylinderMesh(collision.geometry.radius, collision.geometry.length), collision.pose);
        hydro = { kind: "hull", hull: new HullHydrodynamics(mesh, coefficients), patch: new WaterPatch(patchSize(mesh)) };
      } else {
        throw new Error(`Unsupported collision for ${instance.name}: ${collision.geometry.type}`);
      }
      const floater = new FloatingBody(instance.name, model, body, hydro, coefficients, spawn);
      this.floaters.push(floater);
      this.bodies.push(floater);
    }
  }

  private addHullColliders(body: Rapier.RigidBody, mesh: TriangleMesh): void {
    const port: number[] = [];
    const starboard: number[] = [];
    const v = mesh.vertices;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i + 1] >= -1e-6) port.push(v[i], v[i + 1], v[i + 2]);
      if (v[i + 1] <= 1e-6) starboard.push(v[i], v[i + 1], v[i + 2]);
    }
    for (const points of [port, starboard]) {
      const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(points));
      if (desc) this.world.createCollider(desc.setDensity(0).setFriction(0.3).setRestitution(0.05), body);
    }
    const { min, max } = meshBounds(mesh);
    const deck = RAPIER.ColliderDesc.cuboid((max[0] - min[0]) / 2, ((max[1] - min[1]) / 2) * 0.9, 0.03)
      .setTranslation((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, max[2] - 0.03)
      .setDensity(0)
      .setFriction(0.3)
      .setRestitution(0.05);
    this.world.createCollider(deck, body);
  }

  advance(): void {
    this.waves.setTime(this.time);
    for (const body of this.bodies) {
      body.readState();
      body.computeHydrodynamics(this.waves);
    }
    this.applyThrust();
    for (const body of this.bodies) body.applyForces();
    this.world.step();
    for (const body of this.bodies) body.storePose();
    this.time += this.step;
  }

  /** Runs without thrust so the boat and buoys settle onto the water. */
  settle(seconds: number): void {
    const saved = Float64Array.from(this.thrust);
    this.thrust.fill(0);
    const steps = Math.round(seconds / this.step);
    for (let i = 0; i < steps; i++) this.advance();
    this.thrust.set(saved);
  }

  reset(): void {
    for (const body of this.bodies) body.reset();
    this.thrust.fill(0);
    this.time = 0;
  }

  private applyThrust(): void {
    const boat = this.boat;
    const r = boat.state.rotation;
    const p = boat.state.position;
    const com = boat.state.com;
    for (let i = 0; i < this.thrusters.length; i++) {
      const thrust = this.thrust[i];
      if (thrust === 0) continue;
      const { direction: d, position: q } = this.thrusters[i];
      const fx = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) * thrust;
      const fy = (r[3] * d[0] + r[4] * d[1] + r[5] * d[2]) * thrust;
      const fz = (r[6] * d[0] + r[7] * d[1] + r[8] * d[2]) * thrust;
      const px = p[0] + r[0] * q[0] + r[1] * q[1] + r[2] * q[2] - com[0];
      const py = p[1] + r[3] * q[0] + r[4] * q[1] + r[5] * q[2] - com[1];
      const pz = p[2] + r[6] * q[0] + r[7] * q[1] + r[8] * q[2] - com[2];
      boat.force[0] += fx;
      boat.force[1] += fy;
      boat.force[2] += fz;
      boat.torque[0] += py * fz - pz * fy;
      boat.torque[1] += pz * fx - px * fz;
      boat.torque[2] += px * fy - py * fx;
    }
  }

  dispose(): void {
    this.world.free();
  }
}

/** gz-waves sizes the water patch at twice the largest bounding-box side, at least 1 m. */
function patchSize(mesh: TriangleMesh): number {
  const { min, max } = meshBounds(mesh);
  return 2 * Math.max(1, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}
