import { beforeAll, describe, expect, it } from "vitest";
import { WaveField } from "../waves/WaveField";
import { boatHullTriangles, course } from "../testing";
import { initPhysicsEngine, PhysicsWorld } from "./PhysicsWorld";
import { WATER_DENSITY } from "./Hydrodynamics";
import { manualMode, createManualModeState, thrustFromOutput } from "../vehicle/manualMode";

function calmWorld() {
  const waves = new WaveField({ ...course.world.waves });
  return new PhysicsWorld(course, boatHullTriangles(), waves);
}

describe("PhysicsWorld", () => {
  beforeAll(async () => {
    await initPhysicsEngine();
  });

  it("settles the boat where buoyancy carries its weight", () => {
    const world = calmWorld();
    world.settle(20);
    const boat = world.boat;
    boat.readState();
    boat.computeHydrodynamics({ sample: () => 0 });
    const mass = course.models[course.boat.model].mass.mass;
    console.info(`boat z after settling: ${boat.state.position[2].toFixed(4)} m, buoyancy ${boat.force[2].toFixed(2)} N`);
    expect(boat.force[2]).toBeCloseTo(mass * 9.81, -1);
    expect(Math.hypot(...boat.state.linVel)).toBeLessThan(0.01);
    world.dispose();
  });

  it("reaches about the BlueBoat's documented 3 m/s at full throttle", () => {
    const world = calmWorld();
    world.settle(5);
    const state = createManualModeState();
    for (let i = 0; i < 40 / world.step; i++) {
      const out = manualMode(1, 0, state, world.step);
      world.thrust[0] = thrustFromOutput(out.left, world.thrusters[0]);
      world.thrust[1] = thrustFromOutput(out.right, world.thrusters[1]);
      world.advance();
    }
    world.boat.readState();
    const v = world.boat.state.linVel;
    const speed = Math.hypot(v[0], v[1]);
    console.info(`top speed ${speed.toFixed(3)} m/s, position x ${world.boat.state.position[0].toFixed(2)}`);
    expect(speed).toBeGreaterThan(1.5);
    expect(speed).toBeLessThan(4.5);
    // Velocity should point the way the boat's spawn heading faces, whatever that heading is.
    const yaw = course.boat.pose[5];
    const forwardSpeed = v[0] * Math.cos(yaw) + v[1] * Math.sin(yaw);
    expect(forwardSpeed).toBeGreaterThan(0);
    world.dispose();
  });

  it("keeps every course object afloat", () => {
    const world = calmWorld();
    world.settle(10);
    for (const floater of world.floaters) {
      floater.readState();
      expect(floater.state.position[2], floater.name).toBeGreaterThan(-1);
      expect(floater.state.position[2], floater.name).toBeLessThan(1);
    }
    expect(WATER_DENSITY).toBe(1025);
    world.dispose();
  });
});
