import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { course } from "../testing";

const publicFile = (url: string) => new URL(`../../../public${url}`, import.meta.url);

describe("course.json", () => {
  it("has the 36 course objects from aquatonomous_world.sdf", () => {
    expect(course.instances).toHaveLength(36);
    const counts: Record<string, number> = {};
    for (const instance of course.instances) counts[instance.model] = (counts[instance.model] ?? 0) + 1;
    expect(counts).toEqual({
      RedSurMark: 3,
      GreenSurMark: 3,
      ColourIndicatorRed: 2,
      ColourIndicatorGreen: 1,
      YellowRopehold: 1,
      BlackRopehold: 16,
      RedRopehold: 4,
      GreenRopehold: 4,
      aqua_t4_yellow: 1,
      aqua_t4_black: 1,
    });
  });

  it("spawns the boat where the world puts it", () => {
    expect(course.boat.pose).toEqual([-27.192, 0, 0, 0, 0, 0]);
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

  it("keeps the camera bridge topics from the launch script", () => {
    expect(course.boat.cameras.map((c) => c.rosTopic)).toEqual(["/camera2/image_raw", "/camera1/image_raw", "/camera0/image_raw"]);
  });
});
