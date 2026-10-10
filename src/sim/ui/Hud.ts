import { cardinal } from "../navigation";

export interface Telemetry {
  speed: number;
  heading: number;
  lat: number;
  lon: number;
  x: number;
  y: number;
  thrustLeft: number;
  thrustRight: number;
  maxThrust: number;
  paused: boolean;
  fps: number;
  realTimeFactor: number;
  time: number;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

export class Hud {
  readonly reset = byId<HTMLButtonElement>("btn-reset");
  readonly pause = byId<HTMLButtonElement>("btn-pause");
  readonly camera = byId<HTMLButtonElement>("btn-camera");
  readonly pip = byId<HTMLButtonElement>("btn-pip");
  readonly help = byId<HTMLButtonElement>("btn-help");
  readonly helpClose = byId<HTMLButtonElement>("btn-help-close");
  readonly seaState = byId<HTMLSelectElement>("hud-sea");
  readonly helpPanel = byId<HTMLElement>("sim-help");
  readonly pipLabels = byId<HTMLElement>("sim-pip-labels");

  private readonly mode = byId("hud-mode");
  private readonly speed = byId("hud-speed");
  private readonly speedKn = byId("hud-speed-kn");
  private readonly heading = byId("hud-heading");
  private readonly headingCard = byId("hud-heading-card");
  private readonly gps = byId("hud-gps");
  private readonly xy = byId("hud-xy");
  private readonly thrustLeft = byId("hud-thrust-left");
  private readonly thrustRight = byId("hud-thrust-right");
  private readonly thrustLeftValue = byId("hud-thrust-left-value");
  private readonly thrustRightValue = byId("hud-thrust-right-value");
  private readonly stats = byId("hud-stats");
  private readonly time = byId("hud-time");

  setSeaStates(labels: string[], selected: number): void {
    this.seaState.replaceChildren(
      ...labels.map((label, i) => {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = `${i + 1}. ${label}`;
        return option;
      }),
    );
    this.seaState.value = String(selected);
  }

  setHelpVisible(visible: boolean): void {
    this.helpPanel.classList.toggle("hidden", !visible);
    this.helpPanel.classList.toggle("flex", visible);
  }

  get helpVisible(): boolean {
    return !this.helpPanel.classList.contains("hidden");
  }

  setCameraLabel(label: string): void {
    this.camera.textContent = label;
  }

  setPipActive(active: boolean): void {
    this.pip.setAttribute("aria-pressed", String(active));
    this.pipLabels.classList.toggle("hidden", !active);
  }

  /** Places clickable, labelled frames over the onboard camera views (CSS pixels from the bottom-left). */
  setPipViews(
    views: { label: string; x: number; y: number; width: number; height: number }[],
    onSelect: (index: number) => void,
  ): void {
    if (this.pipLabels.childElementCount !== views.length) {
      this.pipLabels.replaceChildren(
        ...views.map((_, i) => {
          const button = document.createElement("button");
          button.className = "sim-pip-view";
          button.append(Object.assign(document.createElement("span"), { className: "sim-pip-label" }));
          button.addEventListener("click", () => {
            button.blur();
            onSelect(i);
          });
          return button;
        }),
      );
    }
    views.forEach((view, i) => {
      const button = this.pipLabels.children[i] as HTMLButtonElement;
      button.title = `Drive from the ${view.label.split(" · ")[0].toLowerCase()} camera`;
      (button.firstElementChild as HTMLElement).textContent = view.label;
      button.style.left = `${view.x}px`;
      button.style.bottom = `${view.y}px`;
      button.style.width = `${view.width}px`;
      button.style.height = `${view.height}px`;
    });
  }

  setActivePip(index: number | null): void {
    [...this.pipLabels.children].forEach((child, i) => child.setAttribute("aria-pressed", String(i === index)));
  }

  update(t: Telemetry): void {
    this.mode.textContent = t.paused ? "PAUSED" : "MANUAL";
    this.mode.classList.toggle("bg-amber-600", t.paused);
    this.mode.classList.toggle("bg-AquaBlue", !t.paused);
    this.pause.textContent = t.paused ? "Resume" : "Pause";
    this.speed.textContent = t.speed.toFixed(2);
    this.speedKn.textContent = `${(t.speed * 1.943844).toFixed(1)} kn`;
    const heading = Math.round(t.heading) % 360;
    this.heading.textContent = `${String(heading).padStart(3, "0")}°`;
    this.headingCard.textContent = cardinal(t.heading);
    this.gps.textContent = `${t.lat.toFixed(6)}, ${t.lon.toFixed(6)}`;
    this.xy.textContent = `${t.x.toFixed(1)}, ${t.y.toFixed(1)} m`;
    this.setThrust(this.thrustLeft, this.thrustLeftValue, t.thrustLeft, t.maxThrust);
    this.setThrust(this.thrustRight, this.thrustRightValue, t.thrustRight, t.maxThrust);
    this.stats.textContent = `${Math.round(t.fps)} fps · ${t.realTimeFactor.toFixed(2)}× real time`;
    this.time.textContent = `t ${t.time.toFixed(1)} s`;
  }

  private setThrust(bar: HTMLElement, value: HTMLElement, thrust: number, max: number): void {
    const fraction = Math.min(1, Math.abs(thrust) / max);
    bar.style.width = `${fraction * 100}%`;
    bar.style.background = thrust < 0 ? "#f59e0b" : "";
    value.textContent = `${Math.round(thrust)} N`;
  }
}
