// Ports of gz-waves WaveSpectrum.cc and WaveSpreadingFunction.cc.

export const GRAVITY = 9.81;

/** Elfouhaily et al. (1997) omnidirectional elevation spectrum S(k). */
export function eckvSpectrum(k: number, u10: number, capOmegaC = 0.84, gravity = GRAVITY): number {
  if (Math.abs(k) < 1e-8 || Math.abs(u10) < 1e-8) return 0;

  const cd10n = 0.00144;
  const km = 370.0;
  const cm = 0.23;

  const uStar = Math.sqrt(cd10n) * u10;
  const gamma = capOmegaC < 1 ? 1.7 : 1.7 + 6.0 * Math.log10(capOmegaC);
  const sigma = 0.08 * (1.0 + 4.0 * Math.pow(capOmegaC, -3.0));
  const alphaP = 0.006 * Math.pow(capOmegaC, 0.55);
  const alphaM = uStar <= cm ? 0.01 * (1.0 + Math.log(uStar / cm)) : 0.01 * (1.0 + 3.0 * Math.log(uStar / cm));

  const ko = gravity / u10 / u10;
  const kp = ko * capOmegaC * capOmegaC;
  const cp = Math.sqrt(gravity / kp);
  const c = Math.sqrt((gravity / k) * (1.0 + Math.pow(k / km, 2.0)));

  const lPm = Math.exp(-1.25 * Math.pow(kp / k, 2.0));
  const capGamma = Math.exp((-1.0 / (2.0 * sigma * sigma)) * Math.pow(Math.sqrt(k / kp) - 1.0, 2.0));
  const jP = Math.pow(gamma, capGamma);

  const fP = lPm * jP * Math.exp(-0.3162 * capOmegaC * (Math.sqrt(k / kp) - 1.0));
  const fM = lPm * jP * Math.exp(-0.25 * Math.pow(k / km - 1.0, 2.0));

  const bL = 0.5 * alphaP * (cp / c) * fP;
  const bH = 0.5 * alphaM * (cm / c) * fM;
  return (bL + bH) / (k * k * k);
}

function logGamma(x: number): number {
  const g = 7;
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = coefficients[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += coefficients[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Normalised cos-2s directional spreading function (travelling waves). */
export function cos2sSpreading(theta: number, thetaMean: number, spread: number): number {
  const scale = Math.exp(logGamma(spread + 1) - logGamma(spread + 0.5)) / 2 / Math.sqrt(Math.PI);
  let phi = theta - thetaMean;
  phi = Math.atan2(Math.sin(phi), Math.cos(phi));
  return scale * Math.pow(Math.cos(phi / 2), 2 * spread);
}
