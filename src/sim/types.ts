export type Vec3 = [number, number, number];
/** x, y, z, w */
export type Quat = [number, number, number, number];
/** x, y, z, roll, pitch, yaw in Gazebo's frame (metres, radians). */
export type Pose = [number, number, number, number, number, number];
export type Rgba = [number, number, number, number];

export type VisualGeometry =
  | { type: "mesh"; url: string }
  | { type: "box"; size: Vec3 }
  | { type: "sphere"; radius: number }
  | { type: "cylinder"; radius: number; length: number };

export type CollisionGeometry =
  | { type: "mesh"; url: string; triangles: number }
  | { type: "box"; size: Vec3 }
  | { type: "sphere"; radius: number }
  | { type: "cylinder"; radius: number; length: number };

export interface VisualDef {
  name: string;
  pose: Pose;
  geometry: VisualGeometry;
  color: Rgba;
  roughness: number;
  metalness: number;
  emissive?: Vec3;
}

export interface CollisionDef {
  name: string;
  pose: Pose;
  geometry: CollisionGeometry;
}

export interface MassProperties {
  mass: number;
  com: Vec3;
  principalInertia: Vec3;
  inertiaFrame: Quat;
}

export interface HydrodynamicsFlags {
  damping: boolean;
  viscousDrag: boolean;
  pressureDrag: boolean;
}

export interface ModelDef {
  name: string;
  sdfName: string;
  static: boolean;
  mass: MassProperties;
  collisions: CollisionDef[];
  visuals: VisualDef[];
  hydrodynamics: HydrodynamicsFlags | null;
}

export interface ThrusterDef {
  joint: string;
  side: "left" | "right";
  channel: number;
  position: Vec3;
  direction: Vec3;
  minThrust: number;
  maxThrust: number;
  servoMin: number;
  servoMax: number;
}

export interface CameraDef {
  name: string;
  pose: Pose;
  hfov: number;
  width: number;
  height: number;
  near: number;
  far: number;
  rate: number;
  topic: string | null;
  rosTopic: string | null;
}

export interface WaveSettings {
  algorithm: string;
  tileSize: number;
  cellCount: number;
  windSpeed: number;
  windAngleDeg: number;
  steepness: number;
  updateRate: number;
}

export interface CourseData {
  source: { repo: string; ref: string | null; label: string; world: string; generatedBy: string };
  frame: string;
  world: {
    name: string;
    physicsStep: number;
    gravity: Vec3;
    ambient: number[];
    background: number[];
    sun: { direction: Vec3; diffuse: number[] };
    waves: WaveSettings;
    home: { lat: number; lon: number; alt: number; heading: number };
  };
  boat: {
    name: string;
    model: string;
    pose: Pose;
    vehicle: string;
    thrusters: ThrusterDef[];
    cameras: CameraDef[];
  };
  models: Record<string, ModelDef>;
  instances: { name: string; model: string; pose: Pose }[];
}
