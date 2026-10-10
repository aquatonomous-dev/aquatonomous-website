import {
  GRAVITY,
  KINEMATIC_VISCOSITY,
  WATER_DENSITY,
  viscousDragCoefficient,
  type HydroCoefficients,
} from "./Hydrodynamics";

/**
 * Closed-form version of the Kerner model for a sphere: exact buoyancy of the
 * submerged cap, and the pressure and viscous drag terms integrated over the
 * sphere's surface, scaled by the submerged fraction of that surface.
 * Forces act through the centre, so buoyancy adds no torque.
 */
export function sphereHydrodynamics(
  center: ArrayLike<number>,
  linVel: ArrayLike<number>,
  angVel: ArrayLike<number>,
  radius: number,
  waterHeight: number,
  c: HydroCoefficients,
  force: Float64Array,
  torque: Float64Array,
): number {
  force.fill(0);
  torque.fill(0);
  const depth = Math.min(2 * radius, Math.max(0, waterHeight - (center[2] - radius)));
  if (depth <= 0) return 0;

  const volume = (Math.PI * depth * depth * (3 * radius - depth)) / 3;
  force[2] += WATER_DENSITY * GRAVITY * volume;

  const wetFraction = depth / (2 * radius);
  const speed = Math.hypot(linVel[0], linVel[1], linVel[2]);
  const angSpeed = Math.hypot(angVel[0], angVel[1], angVel[2]);
  const surface = 2 * Math.PI * radius * radius;

  // Each term is a coefficient k with force = -k * velocity.
  let linear = 0;
  if (speed > 0) {
    if (c.pressureDrag) {
      const u = speed / c.vRDrag;
      const magnitude =
        ((c.cPDrag1 * u + c.cPDrag2 * u * u) * surface) / (c.fPDrag + 2) +
        ((c.cSDrag1 * u + c.cSDrag2 * u * u) * surface) / (c.fSDrag + 2);
      linear += magnitude / speed;
    }
    if (c.viscousDrag) {
      const waterline = 2 * Math.sqrt(depth * (2 * radius - depth));
      const cF = viscousDragCoefficient((speed * waterline) / KINEMATIC_VISCOSITY);
      linear += 0.5 * WATER_DENSITY * cF * (4 * Math.PI * radius * radius) * speed;
    }
  }
  if (c.damping) linear += c.cDampL1 + c.cDampL2 * speed;
  for (let k = 0; k < 3; k++) force[k] -= wetFraction * linear * linVel[k];

  if (angSpeed > 0) {
    // Viscous torque on a spinning sphere: 0.5 rho cF w^2 r^5 * 2 pi * (3 pi / 8).
    const cF = viscousDragCoefficient((angSpeed * radius * 2 * radius) / KINEMATIC_VISCOSITY);
    let angular = 0.5 * WATER_DENSITY * cF * Math.pow(radius, 5) * 2 * Math.PI * ((3 * Math.PI) / 8) * angSpeed;
    if (c.damping) angular += c.cDampR1 + c.cDampR2 * angSpeed;
    for (let k = 0; k < 3; k++) torque[k] -= wetFraction * angular * angVel[k];
  }
  return wetFraction;
}
