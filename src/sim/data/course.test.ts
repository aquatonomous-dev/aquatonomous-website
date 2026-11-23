import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { course } from "../testing";

const publicFile = (url: string) => new URL(`../../../public${url}`, import.meta.url);

describe("course.json", () => {
  it("has the 37 course objects from roboboat2027_course.sdf", () => {
    expect(course.instances).toHaveLength(37);
    const counts: Record<string, number> = {};
    for (const instance of course.instances) counts[instance.model] = (counts[instance.model] ?? 0) + 1;
    expect(counts).toEqual({
      LightBuoyRed: 3,
      LightBuoyGreen: 3,
      LightBuoyBlue: 2,
      LightBuoyBlack: 2,
      LightBuoyRed1: 1,
      LightBuoyRed2: 1,
      LightBuoyGreen3: 1,
      PolyformA2Red: 1,
      PolyformA2Green: 1,
      PolyformA2Blue: 1,
      PolyformA2White: 1,
      PolyformA2Black: 1,
      PolyformA2Yellow: 1,
      StationaryVesselBlack: 1,
      StationaryVesselBlackCross: 1,
      StationaryVesselBlackSquare: 1,
      StationaryVesselBlackTriangle: 1,
      StationaryVesselYellowCircle: 1,
      StationaryVesselYellowTriangle: 1,
      DockIndicatorRed: 2,
      DockIndicatorGreen: 1,
      NumberBanner1: 1,
      NumberBanner2: 1,
      NumberBanner3: 1,
      shoreline: 1,
      marina_dock_N: 1,
      boundary_marker_0: 1,
      boundary_marker_1: 1,
      boundary_marker_2: 1,
      boundary_marker_3: 1,
    });
  });

  it("spawns the boat where the world puts it", () => {
    expect(course.boat.pose).toEqual([10.25, 3.3, 0, 0, 0, -3.14159]);
    expect(course.models[course.boat.model].mass.mass).toBeCloseTo(30.9, 6);
  });

  it("has two ±35 N thrusters pushing forward, port on the left", () => {
    expect(course.boat.thrusters.map((t) => t.side)).toEqual(["left", "right"]);
    for (const thruster of course.boat.thrusters) {
      expect(thruster.direction).toEqual([1, 0, 0]);
      expect(thruster.minThrust).toBe(-35);
      expect(thruster.maxThrust).toBe(35);
    }
  });

  it("references a model and existing files for every visual and collision", () => {
    for (const instance of course.instances) expect(course.models[instance.model], instance.name).toBeDefined();
    for (const model of Object.values(course.models)) {
      for (const visual of model.visuals) {
        if (visual.geometry.type === "mesh") expect(existsSync(publicFile(visual.geometry.url)), visual.geometry.url).toBe(true);
      }
      for (const collision of model.collisions) {
        if (collision.geometry.type === "mesh") expect(existsSync(publicFile(collision.geometry.url)), collision.geometry.url).toBe(true);
      }
    }
  });

  it("keeps the camera bridge topics from sim/2_bridges.sh", () => {
    expect(course.boat.cameras.map((c) => c.rosTopic)).toEqual(["/camera0/image_raw", "/camera1/image_raw", "/camera2/image_raw"]);
  });
});
