/** Runs whole fixed-size physics steps for variable-length frames. */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly step: number,
    /** Longest frame that is simulated in full; longer gaps (e.g. a background tab) are dropped. */
    readonly maxFrameTime = 0.1,
  ) {}

  /** Calls `onStep` once per whole step and returns how far the next step has progressed (0 to 1). */
  advance(frameTime: number, onStep: () => void): number {
    this.accumulator += Math.min(Math.max(frameTime, 0), this.maxFrameTime);
    while (this.accumulator >= this.step) {
      onStep();
      this.accumulator -= this.step;
    }
    return this.accumulator / this.step;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
