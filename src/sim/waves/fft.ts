/**
 * Unnormalised inverse 2D FFT (kernel e^{+i k.x}) for an n x n grid stored as
 * [ix + n * iy], matching FFTW's backward transform used by gz-waves.
 */
export class InverseFft2D {
  readonly n: number;
  private readonly bitReverse: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly columnRe: Float64Array;
  private readonly columnIm: Float64Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    const bits = Math.log2(n);
    this.bitReverse = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.bitReverse[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.columnRe = new Float64Array(n);
    this.columnIm = new Float64Array(n);
  }

  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let iy = 0; iy < n; iy++) this.transform1d(re, im, iy * n);
    const cr = this.columnRe, ci = this.columnIm;
    for (let ix = 0; ix < n; ix++) {
      for (let iy = 0; iy < n; iy++) {
        cr[iy] = re[ix + n * iy];
        ci[iy] = im[ix + n * iy];
      }
      this.transform1d(cr, ci, 0);
      for (let iy = 0; iy < n; iy++) {
        re[ix + n * iy] = cr[iy];
        im[ix + n * iy] = ci[iy];
      }
    }
  }

  private transform1d(re: Float64Array, im: Float64Array, offset: number): void {
    const n = this.n;
    const rev = this.bitReverse;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const a = offset + i, b = offset + j;
        let t = re[a]; re[a] = re[b]; re[b] = t;
        t = im[a]; im[a] = im[b]; im[b] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = offset + start + k;
          const b = a + half;
          const br = re[b] * wr - im[b] * wi;
          const bi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - br;
          im[b] = im[a] - bi;
          re[a] += br;
          im[a] += bi;
        }
      }
    }
  }
}
