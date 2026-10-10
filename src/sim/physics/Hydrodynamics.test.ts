import { describe, expect, it } from "vitest";
import { GRAVITY, HullHydrodynamics, WATER_DENSITY, boxMesh, createRigidState, weldTriangles } from "./Hydrodynamics";
import { boatHullTriangles, course } from "../testing";

const flatWater = { height: () => 0 };

/** Inside intervals of vertical rays through the hull (independent of the Kerner model). */
function rayIntervals(triangles: Float32Array, cell: number): { enter: number; exit: number }[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    minX = Math.min(minX, triangles[i]); maxX = Math.max(maxX, triangles[i]);
    minY = Math.min(minY, triangles[i + 1]); maxY = Math.max(maxY, triangles[i + 1]);
  }
  const boxes: number[][] = [];
  for (let t = 0; t < triangles.length; t += 9) {
    const xs = [triangles[t], triangles[t + 3], triangles[t + 6]];
    const ys = [triangles[t + 1], triangles[t + 4], triangles[t + 7]];
    boxes.push([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
  }
  const intervals: { enter: number; exit: number }[] = [];
  for (let x = minX + cell / 2; x < maxX; x += cell) {
    for (let y = minY + cell / 2; y < maxY; y += cell) {
      const hits: number[] = [];
      for (let t = 0, b = 0; t < triangles.length; t += 9, b++) {
        const box = boxes[b];
        if (x < box[0] || x > box[1] || y < box[2] || y > box[3]) continue;
        const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = triangles.subarray(t, t + 9);
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-14) continue;
        const a = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / d;
        const bb = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / d;
        const c = 1 - a - bb;
        if (a < 0 || bb < 0 || c < 0) continue;
        hits.push(a * z0 + bb * z1 + c * z2);
      }
      hits.sort((p, q) => p - q);
      for (let i = 0; i < hits.length; i += 2) {
        intervals.push({ enter: hits[i], exit: i + 1 < hits.length ? hits[i + 1] : Infinity });
      }
    }
  }
  return intervals;
}

const CELL = 0.004;

/** Volume of the hull below z = level. */
function volumeBelow(intervals: { enter: number; exit: number }[], level: number): number {
  let length = 0;
  for (const { enter, exit } of intervals) length += Math.max(0, Math.min(exit, level) - enter);
  return length * CELL * CELL;
}

function buoyancyAtDepth(hull: HullHydrodynamics, z: number): Float64Array {
  const state = createRigidState();
  state.position.set([0, 0, z]);
  state.rotation.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  state.com.set([0, 0, z]);
  hull.update(state, flatWater);
  return hull.force;
}

describe("HullHydrodynamics", () => {
  const triangles = boatHullTriangles();
  const hull = new HullHydrodynamics(weldTriangles(triangles));
  const intervals = rayIntervals(triangles, CELL);

  it("matches Archimedes for the boat hull at several drafts", () => {
    for (const z of [0.25, 0.18, 0.12, 0.05]) {
      const force = buoyancyAtDepth(hull, z);
      const expected = WATER_DENSITY * GRAVITY * volumeBelow(intervals, -z);
      expect(force[2] / expected).toBeGreaterThan(0.99);
      expect(force[2] / expected).toBeLessThan(1.01);
      expect(Math.abs(force[0]) + Math.abs(force[1])).toBeLessThan(0.01 * expected);
    }
  });

  it("puts the boat at the draft where it displaces its own mass", () => {
    const mass = course.models[course.boat.model].mass.mass;
    const target = mass / WATER_DENSITY;
    let lo = -0.5, hi = 0.5;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (volumeBelow(intervals, -mid) > target) lo = mid;
      else hi = mid;
    }
    const equilibrium = (lo + hi) / 2;
    const force = buoyancyAtDepth(hull, equilibrium);
    console.info(`equilibrium link height ${equilibrium.toFixed(4)} m (draft ${(0.376 - equilibrium).toFixed(3)} m)`);
    expect(force[2]).toBeCloseTo(mass * GRAVITY, -1);
  });

  it("gives the exact buoyancy of a half-submerged box", () => {
    const box = new HullHydrodynamics(boxMesh([1.5, 0.5, 0.4]));
    const force = buoyancyAtDepth(box, 0);
    expect(force[2]).toBeCloseTo(WATER_DENSITY * GRAVITY * 1.5 * 0.5 * 0.2, 6);
  });

  it("resists motion through the water", () => {
    const state = createRigidState();
    state.position.set([0, 0, 0.14]);
    state.rotation.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    state.com.set([-0.05, 0, -0.01]);
    state.linVel.set([2, 0, 0]);
    hull.update(state, flatWater);
    expect(hull.force[0]).toBeLessThan(-10);
  });
});
