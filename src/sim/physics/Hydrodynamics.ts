// Port of gz-waves Physics.cc (Hydrodynamics class), which follows Jacques
// Kerner's "Water interaction model for boats in video games".
import type { HydrodynamicsFlags } from "../types";

export const WATER_DENSITY = 1025;
export const GRAVITY = 9.81;
export const KINEMATIC_VISCOSITY = 1.0533e-6;

export interface HydroCoefficients extends HydrodynamicsFlags {
  cDampL1: number;
  cDampL2: number;
  cDampR1: number;
  cDampR2: number;
  cPDrag1: number;
  cPDrag2: number;
  fPDrag: number;
  cSDrag1: number;
  cSDrag2: number;
  fSDrag: number;
  vRDrag: number;
}

export const GZ_WAVES_DEFAULTS: HydroCoefficients = {
  damping: true,
  viscousDrag: true,
  pressureDrag: true,
  cDampL1: 1e-6,
  cDampL2: 1e-6,
  cDampR1: 1e-6,
  cDampR2: 1e-6,
  cPDrag1: 100,
  cPDrag2: 100,
  fPDrag: 0.4,
  cSDrag1: 100,
  cSDrag2: 100,
  fSDrag: 0.4,
  vRDrag: 1,
};

export function coefficientsFor(flags: HydrodynamicsFlags | null): HydroCoefficients {
  return flags ? { ...GZ_WAVES_DEFAULTS, ...flags } : { ...GZ_WAVES_DEFAULTS };
}

/** 1957 ITTC friction line, with Rn floored at 1e3 to avoid the pole at 1e2. */
export function viscousDragCoefficient(reynolds: number): number {
  const d = Math.log10(Math.max(1e3, reynolds)) - 2;
  return 0.075 / (d * d);
}

export interface WaterSurface {
  /** Elevation of the water surface above (x, y). */
  height(x: number, y: number): number;
}

/** Pose and velocity of a rigid body, in world coordinates. */
export interface RigidState {
  /** Link origin. */
  position: Float64Array;
  /** Row-major rotation of the link frame. */
  rotation: Float64Array;
  /** Centre of mass. */
  com: Float64Array;
  /** Velocity of the centre of mass. */
  linVel: Float64Array;
  angVel: Float64Array;
}

export function createRigidState(): RigidState {
  return {
    position: new Float64Array(3),
    rotation: new Float64Array(9),
    com: new Float64Array(3),
    linVel: new Float64Array(3),
    angVel: new Float64Array(3),
  };
}

export interface TriangleMesh {
  /** Vertex positions in the link frame. */
  vertices: Float64Array;
  indices: Uint32Array;
}

/** Merges bitwise-identical vertices of a triangle soup (x, y, z per corner). */
export function weldTriangles(triangles: Float32Array): TriangleMesh {
  const lookup = new Map<string, number>();
  const vertices: number[] = [];
  const indices = new Uint32Array(triangles.length / 3);
  for (let i = 0; i < triangles.length; i += 3) {
    const key = `${triangles[i]},${triangles[i + 1]},${triangles[i + 2]}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      lookup.set(key, index);
      vertices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
    }
    indices[i / 3] = index;
  }
  return { vertices: new Float64Array(vertices), indices };
}

/** Closed box mesh with outward-facing triangles, each face split into `divisions` x `divisions` quads. */
export function boxMesh(size: ArrayLike<number>, divisions = 3): TriangleMesh {
  const half = [size[0] / 2, size[1] / 2, size[2] / 2];
  const faces: [number, number, number, number][] = [
    // [normal axis, sign, u axis, v axis] with u x v pointing outward
    [0, 1, 1, 2], [0, -1, 2, 1],
    [1, 1, 2, 0], [1, -1, 0, 2],
    [2, 1, 0, 1], [2, -1, 1, 0],
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [axis, sign, ua, va] of faces) {
    const base = vertices.length / 3;
    for (let j = 0; j <= divisions; j++) {
      for (let i = 0; i <= divisions; i++) {
        const p = [0, 0, 0];
        p[axis] = sign * half[axis];
        p[ua] = -half[ua] + (2 * half[ua] * i) / divisions;
        p[va] = -half[va] + (2 * half[va] * j) / divisions;
        vertices.push(p[0], p[1], p[2]);
      }
    }
    const row = divisions + 1;
    for (let j = 0; j < divisions; j++) {
      for (let i = 0; i < divisions; i++) {
        const a = base + i + j * row;
        indices.push(a, a + 1, a + 1 + row, a, a + 1 + row, a + row);
      }
    }
  }
  return { vertices: new Float64Array(vertices), indices: new Uint32Array(indices) };
}

export function meshBounds(mesh: TriangleMesh): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], mesh.vertices[i + k]);
      max[k] = Math.max(max[k], mesh.vertices[i + k]);
    }
  }
  return { min, max };
}

const EPSILON = 2.220446049250313e-16;

/** Hydrostatic and hydrodynamic forces on a closed collision mesh. */
export class HullHydrodynamics {
  readonly force = new Float64Array(3);
  readonly torque = new Float64Array(3);
  readonly area: number;
  submergedArea = 0;
  waterlineLength = 0;

  private readonly world: Float64Array;
  private readonly heights: Float64Array;
  private readonly subCentroid: Float64Array;
  private readonly subNormal: Float64Array;
  private readonly subArea: Float64Array;
  private subCount = 0;
  private water: WaterSurface | null = null;
  private state: RigidState | null = null;

  constructor(
    readonly mesh: TriangleMesh,
    readonly coefficients: HydroCoefficients = GZ_WAVES_DEFAULTS,
  ) {
    const vertexCount = mesh.vertices.length / 3;
    const triangleCount = mesh.indices.length / 3;
    this.world = new Float64Array(vertexCount * 3);
    this.heights = new Float64Array(vertexCount);
    this.subCentroid = new Float64Array(triangleCount * 2 * 3);
    this.subNormal = new Float64Array(triangleCount * 2 * 3);
    this.subArea = new Float64Array(triangleCount * 2);

    let area = 0;
    const v = mesh.vertices;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t] * 3, b = mesh.indices[t + 1] * 3, c = mesh.indices[t + 2] * 3;
      area += triangleArea(v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]);
    }
    this.area = area;
  }

  get submergedTriangleCount(): number {
    return this.subCount;
  }

  update(state: RigidState, water: WaterSurface): void {
    this.state = state;
    this.water = water;
    const { force, torque } = this;
    force.fill(0);
    torque.fill(0);
    this.subCount = 0;
    this.submergedArea = 0;

    const r = state.rotation;
    const p = state.position;
    const local = this.mesh.vertices;
    const world = this.world;
    const heights = this.heights;
    for (let i = 0, k = 0; k < local.length; i++, k += 3) {
      const lx = local[k], ly = local[k + 1], lz = local[k + 2];
      const wx = p[0] + r[0] * lx + r[1] * ly + r[2] * lz;
      const wy = p[1] + r[3] * lx + r[4] * ly + r[5] * lz;
      const wz = p[2] + r[6] * lx + r[7] * ly + r[8] * lz;
      world[k] = wx;
      world[k + 1] = wy;
      world[k + 2] = wz;
      heights[i] = wz - water.height(wx, wy);
    }

    // Body x axis, used to project the waterline.
    const ax = r[0], ay = r[3], az = r[6];
    let waterline = 0;
    const idx = this.mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      let ih = idx[t], im = idx[t + 1], il = idx[t + 2];
      const ia = ih * 3, ib = im * 3, ic = il * 3;
      const e1x = world[ib] - world[ia], e1y = world[ib + 1] - world[ia + 1], e1z = world[ib + 2] - world[ia + 2];
      const e2x = world[ic] - world[ia], e2y = world[ic + 1] - world[ia + 1], e2z = world[ic + 2] - world[ia + 2];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len === 0) continue;
      nx /= len; ny /= len; nz /= len;

      // Sort the corners by height above the water: high, mid, low.
      if (heights[ih] < heights[im]) [ih, im] = [im, ih];
      if (heights[im] < heights[il]) [im, il] = [il, im];
      if (heights[ih] < heights[im]) [ih, im] = [im, ih];
      const hh = heights[ih], hm = heights[im], hl = heights[il];
      const H = ih * 3, M = im * 3, L = il * 3;

      if (hl > 0) continue;
      if (hm > 0) {
        // Only the low corner is under water.
        const tm = -hl / (hm - hl);
        const th = -hl / (hh - hl);
        const mix = world[M] - world[L], miy = world[M + 1] - world[L + 1], miz = world[M + 2] - world[L + 2];
        const hix = world[H] - world[L], hiy = world[H + 1] - world[L + 1], hiz = world[H + 2] - world[L + 2];
        const vmx = world[L] + mix * tm, vmy = world[L + 1] + miy * tm, vmz = world[L + 2] + miz * tm;
        const vhx = world[L] + hix * th, vhy = world[L + 1] + hiy * th, vhz = world[L + 2] + hiz * th;
        this.addSubmerged(world[L], world[L + 1], world[L + 2], vmx, vmy, vmz, vhx, vhy, vhz, nx, ny, nz);
        waterline += Math.abs((vhx - vmx) * ax + (vhy - vmy) * ay + (vhz - vmz) * az);
      } else if (hh > 0) {
        // Mid and low corners are under water: the submerged part is a quad.
        const tm = -hm / (hh - hm);
        const tl = -hl / (hh - hl);
        const vmx = world[M] + (world[H] - world[M]) * tm;
        const vmy = world[M + 1] + (world[H + 1] - world[M + 1]) * tm;
        const vmz = world[M + 2] + (world[H + 2] - world[M + 2]) * tm;
        const vlx = world[L] + (world[H] - world[L]) * tl;
        const vly = world[L + 1] + (world[H + 1] - world[L + 1]) * tl;
        const vlz = world[L + 2] + (world[H + 2] - world[L + 2]) * tl;
        this.addSubmerged(world[M], world[M + 1], world[M + 2], vmx, vmy, vmz, world[L], world[L + 1], world[L + 2], nx, ny, nz);
        this.addSubmerged(vmx, vmy, vmz, vlx, vly, vlz, world[L], world[L + 1], world[L + 2], nx, ny, nz);
        waterline += Math.abs((vlx - vmx) * ax + (vly - vmy) * ay + (vlz - vmz) * az);
      } else {
        this.addSubmerged(world[H], world[H + 1], world[H + 2], world[M], world[M + 1], world[M + 2], world[L], world[L + 1], world[L + 2], nx, ny, nz);
      }
    }
    this.waterlineLength = waterline * 0.5;

    if (this.subCount > 0) this.applyVelocityForces();
  }

  /** Stores a submerged triangle and adds its buoyancy at the centre of pressure. */
  private addSubmerged(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    nx: number, ny: number, nz: number,
  ): void {
    const area = triangleArea(x0, y0, z0, x1, y1, z1, x2, y2, z2);
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
    const i = this.subCount++;
    this.subCentroid[i * 3] = cx;
    this.subCentroid[i * 3 + 1] = cy;
    this.subCentroid[i * 3 + 2] = cz;
    this.subNormal[i * 3] = nx;
    this.subNormal[i * 3 + 1] = ny;
    this.subNormal[i * 3 + 2] = nz;
    this.subArea[i] = area;
    this.submergedArea += area;

    // Sort by z: high, mid, low.
    let hx = x0, hy = y0, hz = z0, mx = x1, my = y1, mz = z1, lx = x2, ly = y2, lz = z2;
    if (hz < mz) { [hx, mx] = [mx, hx]; [hy, my] = [my, hy]; [hz, mz] = [mz, hz]; }
    if (mz < lz) { [mx, lx] = [lx, mx]; [my, ly] = [ly, my]; [mz, lz] = [lz, mz]; }
    if (hz < mz) { [hx, mx] = [mx, hx]; [hy, my] = [my, hy]; [hz, mz] = [mz, hz]; }

    const depthC = this.water!.height(cx, cy) - cz;

    // Horizontal intercept D on the high-low edge at the mid height, and base midpoint B.
    const div = hz - lz;
    const t = Math.abs(div) > EPSILON ? (mz - lz) / div : 0;
    const dx = lx + t * (hx - lx), dy = ly + t * (hy - ly), dz = mz;
    const bx = (mx + dx) / 2, by = (my + dy) / 2, bz = (mz + dz) / 2;

    const rhoG = -WATER_DENSITY * GRAVITY;
    let fU = 0, fL = 0;
    let cuX = bx, cuY = by, cuZ = bz, clX = bx, clY = by, clZ = bz;
    {
      const z0u = depthC - (hz - cz);
      const h = hz - mz;
      const d = 6 * z0u + 4 * h;
      const tc = Math.abs(d) > 1e-16 ? (4 * z0u + 3 * h) / d : 2 / 3;
      cuX = hx + (bx - hx) * tc; cuY = hy + (by - hy) * tc; cuZ = hz + (bz - hz) * tc;
      const centroidZ = (hz + mz + dz) / 3;
      fU = rhoG * triangleArea(hx, hy, hz, mx, my, mz, dx, dy, dz) * (depthC + (cz - centroidZ));
    }
    if (mz > lz) {
      const z0l = depthC + (cz - mz);
      const h = mz - lz;
      const d = 6 * z0l + 2 * h;
      const tc = Math.abs(d) > 1e-16 ? (2 * z0l + h) / d : 1 / 3;
      clX = bx + (lx - bx) * tc; clY = by + (ly - by) * tc; clZ = bz + (lz - bz) * tc;
      const centroidZ = (lz + mz + dz) / 3;
      fL = rhoG * triangleArea(lx, ly, lz, mx, my, mz, dx, dy, dz) * (depthC + (cz - centroidZ));
    }
    const f = fU + fL;
    let px = clX, py = clY, pz = clZ;
    if (Math.abs(f) > 1e-16) {
      const s = fU / f;
      px = clX + (cuX - clX) * s; py = clY + (cuY - clY) * s; pz = clZ + (cuZ - clZ) * s;
    }
    this.accumulate(nx * f, ny * f, nz * f, px, py, pz);
  }

  private applyVelocityForces(): void {
    const c = this.coefficients;
    const s = this.state!;
    const com = s.com, v = s.linVel, w = s.angVel;
    const speed = Math.hypot(v[0], v[1], v[2]);

    if (c.viscousDrag || c.pressureDrag) {
      const cF = viscousDragCoefficient((speed * this.waterlineLength) / KINEMATIC_VISCOSITY);
      for (let i = 0; i < this.subCount; i++) {
        const cx = this.subCentroid[i * 3], cy = this.subCentroid[i * 3 + 1], cz = this.subCentroid[i * 3 + 2];
        const nx = this.subNormal[i * 3], ny = this.subNormal[i * 3 + 1], nz = this.subNormal[i * 3 + 2];
        const area = this.subArea[i];
        const rx = cx - com[0], ry = cy - com[1], rz = cz - com[2];
        const vpx = v[0] + w[1] * rz - w[2] * ry;
        const vpy = v[1] + w[2] * rx - w[0] * rz;
        const vpz = v[2] + w[0] * ry - w[1] * rx;
        const vp = Math.hypot(vpx, vpy, vpz);
        if (vp === 0) continue;
        const cosTheta = (vpx * nx + vpy * ny + vpz * nz) / vp;

        if (c.viscousDrag) {
          // gz-waves subtracts the unit normal scaled by cos(theta), not the normal velocity.
          const vtx = vpx - nx * cosTheta, vty = vpy - ny * cosTheta, vtz = vpz - nz * cosTheta;
          const vt = Math.hypot(vtx, vty, vtz);
          if (vt > 0) {
            const drag = 0.5 * WATER_DENSITY * cF * area * vp * vp;
            this.accumulate((-vtx / vt) * drag, (-vty / vt) * drag, (-vtz / vt) * drag, cx, cy, cz);
          }
        }

        if (c.pressureDrag) {
          const u = vp / c.vRDrag;
          const drag = cosTheta >= 0
            ? -(c.cPDrag1 * u + c.cPDrag2 * u * u) * area * Math.pow(cosTheta, c.fPDrag)
            : (c.cSDrag1 * u + c.cSDrag2 * u * u) * area * Math.pow(-cosTheta, c.fSDrag);
          this.accumulate(nx * drag, ny * drag, nz * drag, cx, cy, cz);
        }
      }
    }

    if (c.damping) {
      const rs = this.submergedArea / this.area;
      const cL = -rs * (c.cDampL1 + c.cDampL2 * speed);
      this.force[0] += v[0] * cL;
      this.force[1] += v[1] * cL;
      this.force[2] += v[2] * cL;
      const angSpeed = Math.hypot(w[0], w[1], w[2]);
      const cR = -rs * (c.cDampR1 + c.cDampR2 * angSpeed);
      this.torque[0] += w[0] * cR;
      this.torque[1] += w[1] * cR;
      this.torque[2] += w[2] * cR;
    }
  }

  private accumulate(fx: number, fy: number, fz: number, px: number, py: number, pz: number): void {
    const com = this.state!.com;
    const rx = px - com[0], ry = py - com[1], rz = pz - com[2];
    this.force[0] += fx;
    this.force[1] += fy;
    this.force[2] += fz;
    this.torque[0] += ry * fz - rz * fy;
    this.torque[1] += rz * fx - rx * fz;
    this.torque[2] += rx * fy - ry * fx;
  }
}

function triangleArea(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
): number {
  const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
  const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return 0.5 * Math.hypot(cx, cy, cz);
}
