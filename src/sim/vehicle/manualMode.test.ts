import { describe, expect, it } from "vitest";
import { createManualModeState, manualMode, skidSteerMix, thrustFromOutput } from "./manualMode";
import { course } from "../testing";

const [port, starboard] = course.boat.thrusters;

describe("ArduPilot MANUAL mode", () => {
  it("ramps throttle at MOT_SLEWRATE (100% per second)", () => {
    const state = createManualModeState();
    expect(manualMode(1, 0, state, 0.01).throttle).toBeCloseTo(0.01, 9);
    for (let i = 0; i < 99; i++) manualMode(1, 0, state, 0.01);
    const out = manualMode(1, 0, state, 0.01);
    expect(out.left).toBeCloseTo(1, 9);
    expect(out.right).toBeCloseTo(1, 9);
  });

  it("spins in place with steering only", () => {
    expect(skidSteerMix(0, 1)).toEqual({ left: 1, right: -1 });
    expect(skidSteerMix(0, -0.5)).toEqual({ left: -0.5, right: 0.5 });
  });

  it("shares full throttle and full steering evenly once throttle has settled", () => {
    // Saturated sticks are scaled to 0.5 throttle, 0.5 steering before mixing.
    const state = { throttle: 0.5 };
    const out = manualMode(1, 1, state, 0.01);
    expect(out.left).toBeCloseTo(1, 9);
    expect(out.right).toBeCloseTo(0, 9);
  });

  it("reverses steering while backing up", () => {
    const state = { throttle: -1 };
    const out = manualMode(-1, 1, state, 1);
    expect(out.left).toBeCloseTo(-1, 9);
    expect(out.right).toBeCloseTo(0, 9);
  });

  it("maps motor output through PWM to the plugin's thrust", () => {
    expect(thrustFromOutput(1, port)).toBeCloseTo(35, 9);
    expect(thrustFromOutput(-1, starboard)).toBeCloseTo(-35, 9);
    expect(thrustFromOutput(0, port)).toBeCloseTo(0, 9);
    expect(thrustFromOutput(0.5, port)).toBeCloseTo(17.5, 9);
  });
});
