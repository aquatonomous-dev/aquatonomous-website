import { InverseFft2D } from "./fft";
import { GRAVITY, cos2sSpreading, eckvSpectrum } from "./spectrum";

export interface WaveFieldOptions {
  tileSize: number;
  cellCount: number;
  windSpeed: number;
  windAngleDeg: number;
  steepness: number;
  /** Snapshots per second of simulated time. */
  updateRate?: number;
  seed?: number;
  /** Drop components longer than this (used for the ripple layer). */
  maxWavelength?: number;
  displacement?: boolean;
}

export interface WaveSnapshot {
  time: number;
  version: number;
  height: Float32Array;
  slopeX: Float32Array;
  slopeY: Float32Array;
  dispX: Float32Array;
  dispY: Float32Array;
}

const SPREAD = 5;
const CAP_OMEGA_C = 0.84;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSnapshot(size: number): WaveSnapshot {
  return {
    time: Number.NaN,
    version: 0,
    height: new Float32Array(size),
    slopeX: new Float32Array(size),
    slopeY: new Float32Array(size),
    dispX: new Float32Array(size),
    dispY: new Float32Array(size),
  };
}

/**
 * Linear random FFT wave field (port of gz-waves LinearRandomFFTWaveSimulation):
 * ECKV spectrum, cos-2s spreading and Tessendorf horizontal displacement scaled
 * by the steepness. Grid sample (ix, iy) sits at (ix, iy) * cellSize and the
 * field repeats every tileSize metres.
 */
export class WaveField {
  readonly n: number;
  readonly tileSize: number;
  readonly cellSize: number;
  readonly period: number;
  windSpeed: number;
  windAngleDeg: number;
  steepness: number;

  time = 0;
  alpha = 0;
  prev: WaveSnapshot;
  next: WaveSnapshot;

  private readonly options: WaveFieldOptions;
  private readonly fft: InverseFft2D;
  private readonly kx: Float64Array;
  private readonly ky: Float64Array;
  private readonly amp: Float64Array;
  private readonly rho: Float64Array;
  private readonly sigma: Float64Array;
  private readonly omega: Float64Array;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly cRe: Float64Array;
  private readonly cIm: Float64Array;
  private flat = true;

  private i00 = 0;
  private i10 = 0;
  private i01 = 0;
  private i11 = 0;
  private w00 = 0;
  private w10 = 0;
  private w01 = 0;
  private w11 = 0;

  constructor(options: WaveFieldOptions) {
    this.options = options;
    this.n = options.cellCount;
    this.tileSize = options.tileSize;
    this.cellSize = options.tileSize / options.cellCount;
    this.period = 1 / (options.updateRate ?? 30);
    this.windSpeed = options.windSpeed;
    this.windAngleDeg = options.windAngleDeg;
    this.steepness = options.steepness;

    const size = this.n * this.n;
    this.fft = new InverseFft2D(this.n);
    this.kx = new Float64Array(this.n);
    this.ky = new Float64Array(this.n);
    this.amp = new Float64Array(size);
    this.rho = new Float64Array(size);
    this.sigma = new Float64Array(size);
    this.omega = new Float64Array(size);
    this.aRe = new Float64Array(size);
    this.aIm = new Float64Array(size);
    this.bRe = new Float64Array(size);
    this.bIm = new Float64Array(size);
    this.cRe = new Float64Array(size);
    this.cIm = new Float64Array(size);
    this.prev = createSnapshot(size);
    this.next = createSnapshot(size);

    const kf = (2 * Math.PI) / this.tileSize;
    for (let i = 0; i < this.n; i++) {
      const m = i < this.n / 2 ? i : i - this.n;
      this.kx[i] = m * kf;
      this.ky[i] = m * kf;
    }

    const random = mulberry32(options.seed ?? 1);
    const gaussian = () => {
      const u = Math.max(random(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    };
    for (let idx = 0; idx < size; idx++) {
      this.rho[idx] = gaussian();
      this.sigma[idx] = gaussian();
    }

    this.computeBaseAmplitudes();
    this.reset(0);
  }

  get isFlat(): boolean {
    return this.flat;
  }

  setWind(windSpeed: number, windAngleDeg = this.windAngleDeg): void {
    this.windSpeed = windSpeed;
    this.windAngleDeg = windAngleDeg;
    this.computeBaseAmplitudes();
    this.reset(this.time);
  }

  /** Expected significant wave height (4 standard deviations) from the discrete spectrum. */
  significantWaveHeight(): number {
    let variance = 0;
    for (let i = 0; i < this.amp.length; i++) variance += 4 * this.amp[i] * this.amp[i];
    return 4 * Math.sqrt(variance);
  }

  reset(time: number): void {
    const start = Math.floor(time / this.period) * this.period;
    this.compute(this.prev, start);
    this.compute(this.next, start + this.period);
    this.time = time;
    this.alpha = (time - start) / this.period;
  }

  setTime(time: number): void {
    if (time < this.prev.time || time > this.next.time + this.period) {
      this.reset(time);
      return;
    }
    while (time > this.next.time) {
      const recycled = this.prev;
      this.prev = this.next;
      this.compute(recycled, this.prev.time + this.period);
      this.next = recycled;
    }
    this.time = time;
    this.alpha = Math.min(1, Math.max(0, (time - this.prev.time) / this.period));
  }

  /** Elevation of the displaced surface above (x, y), in metres. */
  sample(x: number, y: number): number {
    if (this.flat) return 0;
    let px = x;
    let py = y;
    if (this.steepness > 0 && this.options.displacement !== false) {
      for (let i = 0; i < 3; i++) {
        this.locate(px, py);
        px = x - this.interpolate(this.prev.dispX, this.next.dispX);
        py = y - this.interpolate(this.prev.dispY, this.next.dispY);
      }
    }
    this.locate(px, py);
    return this.interpolate(this.prev.height, this.next.height);
  }

  private locate(x: number, y: number): void {
    const n = this.n;
    const u = x / this.cellSize;
    const v = y / this.cellSize;
    const fu = Math.floor(u);
    const fv = Math.floor(v);
    const tu = u - fu;
    const tv = v - fv;
    const i0 = ((fu % n) + n) % n;
    const j0 = ((fv % n) + n) % n;
    const i1 = i0 + 1 === n ? 0 : i0 + 1;
    const j1 = j0 + 1 === n ? 0 : j0 + 1;
    this.i00 = i0 + n * j0;
    this.i10 = i1 + n * j0;
    this.i01 = i0 + n * j1;
    this.i11 = i1 + n * j1;
    this.w00 = (1 - tu) * (1 - tv);
    this.w10 = tu * (1 - tv);
    this.w01 = (1 - tu) * tv;
    this.w11 = tu * tv;
  }

  private interpolate(a: Float32Array, b: Float32Array): number {
    const va = a[this.i00] * this.w00 + a[this.i10] * this.w10 + a[this.i01] * this.w01 + a[this.i11] * this.w11;
    const vb = b[this.i00] * this.w00 + b[this.i10] * this.w10 + b[this.i01] * this.w01 + b[this.i11] * this.w11;
    return va + (vb - va) * this.alpha;
  }

  private computeBaseAmplitudes(): void {
    const n = this.n;
    const kf = (2 * Math.PI) / this.tileSize;
    const phi10 = (this.windAngleDeg * Math.PI) / 180;
    const kMin = this.options.maxWavelength ? (2 * Math.PI) / this.options.maxWavelength : 0;
    let flat = true;
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const idx = ix + n * iy;
        const kx = this.kx[ix];
        const ky = this.ky[iy];
        const k = Math.hypot(kx, ky);
        this.omega[idx] = Math.sqrt(GRAVITY * k);
        if (k < 1e-12 || k < kMin) {
          this.amp[idx] = 0;
          continue;
        }
        const spreading = cos2sSpreading(Math.atan2(ky, kx), phi10, SPREAD);
        const spectrum = eckvSpectrum(k, this.windSpeed, CAP_OMEGA_C);
        const amp = 0.5 * Math.sqrt(((spectrum * spreading) / k) * kf * kf);
        this.amp[idx] = amp;
        if (amp > 1e-9) flat = false;
      }
    }
    this.flat = flat;
  }

  private compute(snapshot: WaveSnapshot, time: number): void {
    snapshot.time = time;
    snapshot.version++;
    if (this.flat) {
      snapshot.height.fill(0);
      snapshot.slopeX.fill(0);
      snapshot.slopeY.fill(0);
      snapshot.dispX.fill(0);
      snapshot.dispY.fill(0);
      return;
    }

    const n = this.n;
    const half = n / 2;
    const { amp, rho, sigma, omega, aRe, aIm, bRe, bIm, cRe, cIm } = this;
    const displacement = this.options.displacement !== false;
    for (let iy = 0; iy < n; iy++) {
      const cy = (n - iy) % n;
      const ky = iy === half ? 0 : this.ky[iy];
      for (let ix = 0; ix < n; ix++) {
        const idx = ix + n * iy;
        const cdx = ((n - ix) % n) + n * cy;
        let hr = 0;
        let hi = 0;
        if (idx !== 0) {
          const wt = omega[idx] * time;
          const c = Math.cos(wt);
          const s = Math.sin(wt);
          const rp = rho[idx] * amp[idx];
          const rc = rho[cdx] * amp[cdx];
          const sp = sigma[idx] * amp[idx];
          const sc = sigma[cdx] * amp[cdx];
          hr = (rp + rc) * c + (sp + sc) * s;
          hi = -(rp - rc) * s + (sp - sc) * c;
        }
        // Nyquist terms of derivatives must be zero.
        const kx = ix === half ? 0 : this.kx[ix];
        const k = Math.hypot(this.kx[ix], this.ky[iy]);
        const ook = k > 1e-12 ? 1 / k : 0;

        // A = h + i (i kx h): real part height, imaginary part d(height)/dx
        aRe[idx] = hr - kx * hr;
        aIm[idx] = hi - kx * hi;
        // B = i ky h + i (i kx/k h): real part d(height)/dy, imaginary part x displacement
        bRe[idx] = -ky * hi - kx * ook * hr;
        bIm[idx] = ky * hr - kx * ook * hi;
        if (displacement) {
          // C = i ky/k h: real part y displacement
          cRe[idx] = -ky * ook * hi;
          cIm[idx] = ky * ook * hr;
        }
      }
    }

    this.fft.transform(aRe, aIm);
    this.fft.transform(bRe, bIm);
    const lambda = displacement ? this.steepness : 0;
    if (displacement) this.fft.transform(cRe, cIm);
    for (let i = 0; i < n * n; i++) {
      snapshot.height[i] = aRe[i];
      snapshot.slopeX[i] = aIm[i];
      snapshot.slopeY[i] = bRe[i];
      snapshot.dispX[i] = lambda * bIm[i];
      snapshot.dispY[i] = displacement ? lambda * cRe[i] : 0;
    }
  }
}
