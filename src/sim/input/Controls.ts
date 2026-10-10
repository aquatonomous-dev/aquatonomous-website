import { clamp } from "../math";

export interface ControlActions {
  reset(): void;
  togglePause(): void;
  cycleCamera(): void;
  togglePip(): void;
  toggleHelp(): void;
  closeHelp(): void;
  setSeaState(index: number): void;
  stepSeaState(delta: number): void;
}

const DEADZONE = 0.1;
const STEER_RATE = 4;
const STEER_RETURN_RATE = 7;

function applyDeadzone(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < DEADZONE) return 0;
  return (Math.sign(value) * (magnitude - DEADZONE)) / (1 - DEADZONE);
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

/**
 * Turns keyboard, gamepad and touch input into RC-style sticks:
 * throttle and steering from -1 to 1, steering positive to the right.
 */
export class Controls {
  throttle = 0;
  steering = 0;
  source: "keyboard" | "gamepad" | "touch" = "keyboard";

  private readonly keys = new Set<string>();
  private keyboardSteering = 0;
  private readonly touch = { throttle: 0, steering: 0, throttleActive: false, steeringActive: false };
  private previousButtons: boolean[] = [];
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly actions: ControlActions,
    touchRoot: HTMLElement | null,
  ) {
    const onKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
    const onBlur = () => this.keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
    if (touchRoot) this.bindTouchSticks(touchRoot);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const code = event.code;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) event.preventDefault();
    if (!event.repeat) {
      switch (code) {
        case "KeyR": this.actions.reset(); break;
        case "KeyP": this.actions.togglePause(); break;
        case "KeyC": this.actions.cycleCamera(); break;
        case "KeyV": this.actions.togglePip(); break;
        case "KeyH":
        case "Slash": this.actions.toggleHelp(); break;
        case "Escape": this.actions.closeHelp(); break;
        case "Space":
          this.keyboardSteering = 0;
          this.keys.clear();
          break;
        default:
          if (/^Digit[1-9]$/.test(code)) this.actions.setSeaState(Number(code.slice(5)) - 1);
      }
    }
    this.keys.add(code);
    this.source = "keyboard";
  }

  private bindTouchSticks(root: HTMLElement): void {
    for (const stick of root.querySelectorAll<HTMLElement>("[data-stick]")) {
      const axis = stick.dataset.stick as "throttle" | "steering";
      const knob = stick.querySelector<HTMLElement>(".touch-knob");
      let pointer: number | null = null;
      const move = (event: PointerEvent) => {
        const rect = stick.getBoundingClientRect();
        const radius = rect.width / 2;
        const dx = clamp((event.clientX - rect.left - radius) / radius, -1, 1);
        const dy = clamp((event.clientY - rect.top - radius) / radius, -1, 1);
        if (axis === "throttle") {
          this.touch.throttle = applyDeadzone(-dy);
          if (knob) knob.style.transform = `translate(0, ${dy * radius * 0.6}px)`;
        } else {
          this.touch.steering = applyDeadzone(dx);
          if (knob) knob.style.transform = `translate(${dx * radius * 0.6}px, 0)`;
        }
      };
      const release = () => {
        pointer = null;
        if (axis === "throttle") {
          this.touch.throttle = 0;
          this.touch.throttleActive = false;
        } else {
          this.touch.steering = 0;
          this.touch.steeringActive = false;
        }
        if (knob) knob.style.transform = "";
      };
      const down = (event: PointerEvent) => {
        pointer = event.pointerId;
        stick.setPointerCapture(event.pointerId);
        if (axis === "throttle") this.touch.throttleActive = true;
        else this.touch.steeringActive = true;
        this.source = "touch";
        move(event);
        event.preventDefault();
      };
      const onMove = (event: PointerEvent) => {
        if (event.pointerId === pointer) move(event);
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId === pointer) release();
      };
      stick.addEventListener("pointerdown", down);
      stick.addEventListener("pointermove", onMove);
      stick.addEventListener("pointerup", onUp);
      stick.addEventListener("pointercancel", onUp);
      this.cleanup.push(() => {
        stick.removeEventListener("pointerdown", down);
        stick.removeEventListener("pointermove", onMove);
        stick.removeEventListener("pointerup", onUp);
        stick.removeEventListener("pointercancel", onUp);
      });
    }
  }

  update(dt: number): void {
    const has = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const scale = has("ShiftLeft", "ShiftRight") ? 0.5 : 1;
    const keyThrottle = ((has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0)) * scale;
    const steerTarget = ((has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0)) * scale;
    const rate = steerTarget === 0 ? STEER_RETURN_RATE : STEER_RATE;
    const delta = steerTarget - this.keyboardSteering;
    this.keyboardSteering += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);

    let throttle = keyThrottle;
    let steering = this.keyboardSteering;

    const pad = this.readGamepad();
    if (pad) {
      if (pad.throttle !== 0 || pad.steering !== 0) this.source = "gamepad";
      if (pad.throttle !== 0) throttle = pad.throttle;
      if (pad.steering !== 0) steering = pad.steering;
    }
    if (this.touch.throttleActive) throttle = this.touch.throttle;
    if (this.touch.steeringActive) steering = this.touch.steering;

    this.throttle = clamp(throttle, -1, 1);
    this.steering = clamp(steering, -1, 1);
  }

  private readGamepad(): { throttle: number; steering: number } | null {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    const pad = [...navigator.getGamepads()].find((g): g is Gamepad => !!g && g.connected);
    if (!pad) return null;

    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.previousButtons[i];
    if (edge(0)) this.actions.cycleCamera();
    if (edge(1)) this.actions.togglePip();
    if (edge(3)) this.actions.toggleHelp();
    if (edge(8)) this.actions.reset();
    if (edge(9)) this.actions.togglePause();
    if (edge(12)) this.actions.stepSeaState(1);
    if (edge(13)) this.actions.stepSeaState(-1);
    this.previousButtons = pressed;

    let throttle = applyDeadzone(-(pad.axes[1] ?? 0));
    const steering = applyDeadzone(pad.axes[2] ?? 0);
    if (throttle === 0) {
      const triggers = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
      throttle = Math.abs(triggers) > 0.05 ? triggers : 0;
    }
    return { throttle, steering };
  }

  dispose(): void {
    this.cleanup.forEach((fn) => fn());
  }
}
