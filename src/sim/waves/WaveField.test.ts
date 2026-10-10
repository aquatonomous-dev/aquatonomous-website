import { describe, expect, it } from "vitest";
import { WaveField } from "./WaveField";
import { SEA_STATES } from "./presets";
import { course } from "../testing";

const gazebo = course.world.waves;

function heightStats(field: WaveField) {
  const h = field.next.height;
  let sum = 0, sumSq = 0;
  for (const value of h) {
    sum += value;
    sumSq += value * value;
  }
  return { mean: sum / h.length, variance: sumSq / h.length - (sum / h.length) ** 2 };
}

describe("WaveField", () => {
  it("is effectively flat with the Gazebo world's 0.5 m/s wind", () => {
    const field = new WaveField({ ...gazebo });
    expect(field.significantWaveHeight()).toBeLessThan(0.01);
  });

  it("produces waves whose height matches the spectrum for each preset", () => {
    let previous = 0;
    for (const preset of SEA_STATES.filter((s) => s.windSpeed !== null)) {
      const expectedHs = new WaveField({ ...gazebo, windSpeed: preset.windSpeed! }).significantWaveHeight();
      let variance = 0;
      const seeds = [1, 2, 3, 4];
      for (const seed of seeds) {
        const field = new WaveField({ ...gazebo, windSpeed: preset.windSpeed!, seed });
        for (const time of [0, 7.3, 19.1]) {
          field.setTime(time);
          const stats = heightStats(field);
          expect(Math.abs(stats.mean)).toBeLessThan(1e-6);
          variance += stats.variance;
        }
      }
      const realisedHs = 4 * Math.sqrt(variance / (seeds.length * 3));
      console.info(`${preset.label}: expected Hs ${expectedHs.toFixed(3)} m, realised ${realisedHs.toFixed(3)} m`);
      expect(realisedHs / expectedHs).toBeGreaterThan(0.75);
      expect(realisedHs / expectedHs).toBeLessThan(1.25);
      expect(expectedHs).toBeGreaterThan(previous);
      previous = expectedHs;
    }
  });

  it("repeats every tile and interpolates smoothly between snapshots", () => {
    const field = new WaveField({ ...gazebo, windSpeed: 5 });
    field.setTime(3.21);
    for (const [x, y] of [[0.3, 0.7], [-12.4, 30.1], [5.5, -2.25]]) {
      expect(field.sample(x + field.tileSize, y)).toBeCloseTo(field.sample(x, y), 9);
      expect(field.sample(x, y - 2 * field.tileSize)).toBeCloseTo(field.sample(x, y), 9);
    }
    const a = field.sample(1, 1);
    field.setTime(3.21 + 1e-4);
    expect(Math.abs(field.sample(1, 1) - a)).toBeLessThan(0.01);
  });

  it("travels downwind", () => {
    const windAngle = 30;
    const field = new WaveField({ ...gazebo, windSpeed: 5, windAngleDeg: windAngle, steepness: 0 });
    const dir = [Math.cos((windAngle * Math.PI) / 180), Math.sin((windAngle * Math.PI) / 180)];
    // Best-matching shift of a transect after a short time is downwind.
    const t0 = 10, dt = 0.5;
    const samples = (t: number, shift: number) => {
      field.setTime(t);
      const out: number[] = [];
      for (let s = -20; s <= 20; s += 0.25) out.push(field.sample((s + shift) * dir[0], (s + shift) * dir[1]));
      return out;
    };
    const before = samples(t0, 0);
    let bestShift = 0, bestError = Infinity;
    for (let shift = -3; shift <= 3; shift += 0.1) {
      const after = samples(t0 + dt, shift);
      const error = after.reduce((e, v, i) => e + (v - before[i]) ** 2, 0);
      if (error < bestError) {
        bestError = error;
        bestShift = shift;
      }
    }
    expect(bestShift).toBeGreaterThan(0);
  });
});
