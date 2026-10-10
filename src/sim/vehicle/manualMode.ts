// ArduPilot Rover MANUAL mode for a skid-steer boat: Mode::get_pilot_input,
// Mode::get_pilot_desired_steering_and_throttle and
// AP_MotorsUGV::output_skid_steering, with default parameters.
import type { ThrusterDef } from "../types";
import { clamp } from "../math";

export interface ArduPilotParams {
  /** MOT_SLEWRATE, % of full throttle per second (0 disables). */
  slewRate: number;
  /** MOT_STR_THR_MIX */
  steeringThrottleMix: number;
  /** MOT_THST_ASYM */
  thrustAsymmetry: number;
  /** PILOT_STEER_TYPE 0: steering reverses while backing up. */
  reverseSteeringWhenReversing: boolean;
}

export const ARDUPILOT_DEFAULTS: ArduPilotParams = {
  slewRate: 100,
  steeringThrottleMix: 0.5,
  thrustAsymmetry: 1,
  reverseSteeringWhenReversing: true,
};

export interface ManualModeState {
  /** Slew-limited throttle from the previous update, -1 to 1. */
  throttle: number;
}

export interface MotorOutput {
  /** Motor outputs, -1 (full reverse) to 1 (full forward). */
  left: number;
  right: number;
  /** Throttle and steering after ArduPilot's limits, -1 to 1 (steering positive turns right). */
  throttle: number;
  steering: number;
}

export function createManualModeState(): ManualModeState {
  return { throttle: 0 };
}

/**
 * @param stickThrottle -1 to 1
 * @param stickSteering -1 to 1, positive turns clockwise (right)
 */
export function manualMode(
  stickThrottle: number,
  stickSteering: number,
  state: ManualModeState,
  dt: number,
  params: ArduPilotParams = ARDUPILOT_DEFAULTS,
): MotorOutput {
  let throttle = clamp(stickThrottle, -1, 1);
  let steering = clamp(stickSteering, -1, 1);
  if (params.reverseSteeringWhenReversing && throttle < 0) steering = -steering;

  const saturation = Math.abs(steering) + Math.abs(throttle);
  if (saturation > 1) {
    steering /= saturation;
    throttle /= saturation;
  }

  let limited = throttle;
  if (params.slewRate > 0) {
    const change = (params.slewRate / 100) * dt;
    limited = clamp(throttle, state.throttle - change, state.throttle + change);
  }
  if (params.reverseSteeringWhenReversing && throttle < 0 !== limited < 0) steering = -steering;
  state.throttle = limited;

  const { left, right } = skidSteerMix(limited, steering, params);
  return { left, right, throttle: limited, steering };
}

export function skidSteerMix(
  throttle: number,
  steering: number,
  params: ArduPilotParams = ARDUPILOT_DEFAULTS,
): { left: number; right: number } {
  const asymmetry = Math.max(params.thrustAsymmetry, 1);
  const lowerLimit = -1 / asymmetry;
  const bestSteeringThrottle = (1 + lowerLimit) * 0.5;
  const steeringRange = throttle < bestSteeringThrottle ? Math.max(throttle, 0) - lowerLimit : 1 - bestSteeringThrottle;

  let s = clamp(steering, -steeringRange, steeringRange);
  let t = clamp(throttle, lowerLimit, 1);

  const saturation = Math.max(t + Math.abs(s), (t - Math.abs(s)) / lowerLimit);
  if (saturation > 1) {
    const mix = clamp(params.steeringThrottleMix, 0, 1);
    const fair = 1 / saturation;
    if (mix >= 0.5) {
      s *= lerp(fair, 1, (mix - 0.5) / 0.5);
      t = t >= bestSteeringThrottle ? 1 - Math.abs(s) : Math.abs(s) + lowerLimit;
    } else {
      t *= lerp(fair, 1, (0.5 - mix) / 0.5);
      const sign = s > 0 ? 1 : -1;
      s = (t >= bestSteeringThrottle ? 1 - t : t - lowerLimit) * sign;
    }
  }

  let left = t + s;
  let right = t - s;
  if (left < 0) left *= asymmetry;
  if (right < 0) right *= asymmetry;
  return { left, right };
}

/** Motor output -> PWM (SERVO_MIN..SERVO_MAX around the midpoint) -> ArduPilotPlugin thrust in newtons. */
export function thrustFromOutput(output: number, thruster: ThrusterDef): number {
  const pwm = (thruster.servoMin + thruster.servoMax) / 2 + (clamp(output, -1, 1) * (thruster.servoMax - thruster.servoMin)) / 2;
  const normalised = (pwm - thruster.servoMin) / (thruster.servoMax - thruster.servoMin);
  return thruster.minThrust + normalised * (thruster.maxThrust - thruster.minThrust);
}

function lerp(low: number, high: number, t: number): number {
  return low + (high - low) * clamp(t, 0, 1);
}
