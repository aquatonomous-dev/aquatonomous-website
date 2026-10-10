import type { WaterSurface } from "./Hydrodynamics";

export interface WaveSampler {
  sample(x: number, y: number): number;
}

/**
 * Like gz-waves' Hydrodynamics water patch: a 4 x 4 cell grid of wave heights
 * centred on the link origin, twice the size of the collision mesh's bounds.
 */
export class WaterPatch implements WaterSurface {
  private readonly heights = new Float64Array(25);
  private readonly cell: number;
  private x0 = 0;
  private y0 = 0;

  constructor(readonly size: number) {
    this.cell = size / 4;
  }

  update(waves: WaveSampler, cx: number, cy: number): void {
    this.x0 = cx - this.size / 2;
    this.y0 = cy - this.size / 2;
    for (let j = 0; j < 5; j++) {
      for (let i = 0; i < 5; i++) {
        this.heights[i + 5 * j] = waves.sample(this.x0 + i * this.cell, this.y0 + j * this.cell);
      }
    }
  }

  height(x: number, y: number): number {
    const u = Math.min(4, Math.max(0, (x - this.x0) / this.cell));
    const v = Math.min(4, Math.max(0, (y - this.y0) / this.cell));
    const i = Math.min(3, Math.floor(u));
    const j = Math.min(3, Math.floor(v));
    const tu = u - i;
    const tv = v - j;
    const h = this.heights;
    const k = i + 5 * j;
    return (h[k] * (1 - tu) + h[k + 1] * tu) * (1 - tv) + (h[k + 5] * (1 - tu) + h[k + 6] * tu) * tv;
  }
}
