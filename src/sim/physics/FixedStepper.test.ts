import { describe, expect, it } from "vitest";
import { FixedStepper } from "./FixedStepper";

describe("FixedStepper", () => {
  it("runs whole steps and carries the remainder", () => {
    const stepper = new FixedStepper(1 / 240);
    let steps = 0;
    const alpha = stepper.advance(1 / 60 + 0.5 / 240, () => steps++);
    expect(steps).toBe(4);
    expect(alpha).toBeCloseTo(0.5, 6);
    stepper.advance(0.5 / 240, () => steps++);
    expect(steps).toBe(5);
  });

  it("drops time beyond the longest frame", () => {
    const stepper = new FixedStepper(0.01, 0.1);
    let steps = 0;
    stepper.advance(5, () => steps++);
    expect(steps).toBe(10);
  });
});
