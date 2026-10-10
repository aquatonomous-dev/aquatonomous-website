import * as THREE from "three";
import type { CourseData, Quat } from "./types";
import type { FloatingBody, PhysicsWorld } from "./physics/PhysicsWorld";
import { FixedStepper } from "./physics/FixedStepper";
import type { WaveField, WaveFieldOptions } from "./waves/WaveField";
import { OceanSurface, OCEAN_QUALITY_HIGH, OCEAN_QUALITY_LOW } from "./waves/OceanSurface";
import { SEA_STATES } from "./waves/presets";
import { createSkyDome, defaultSkyColors } from "./view/sky";
import { createGazeboRoot, gzToThree, threeToGz } from "./view/frames";
import type { ModelLibrary } from "./view/ModelLibrary";
import { CameraRig, createOnboardCameras, type CameraMode } from "./view/CameraRig";
import { Controls } from "./input/Controls";
import { createManualModeState, manualMode, thrustFromOutput } from "./vehicle/manualMode";
import { Hud } from "./ui/Hud";
import { Minimap, type MapObject } from "./ui/Minimap";
import { compassHeading, localToGps } from "./navigation";
import { slerpQuat, yawOf } from "./math";

export interface SimulatorOptions {
  lowPower: boolean;
}

const HELP_SEEN_KEY = "aquatonomous-sim-help-seen";

/** Render-only ripple layer standing in for Gazebo's wave normal map. */
export function rippleOptions(windSpeed: number, windAngleDeg: number, updateRate: number): WaveFieldOptions {
  return {
    tileSize: 7.3,
    cellCount: 64,
    windSpeed: Math.max(3, windSpeed),
    windAngleDeg,
    steepness: 0,
    displacement: false,
    maxWavelength: 2,
    seed: 7,
    updateRate,
  };
}

interface RenderedBody {
  body: FloatingBody;
  object: THREE.Object3D;
}

interface CameraView {
  label: string;
  mode: CameraMode;
  /** Index into course.boat.cameras for onboard views. */
  onboard?: number;
}

function cameraSide(yaw: number): string {
  return yaw > 0.2 ? "Left" : yaw < -0.2 ? "Right" : "Front";
}

export class Simulator {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly gzRoot = createGazeboRoot();
  private readonly rig: CameraRig;
  private readonly ocean: OceanSurface;
  private readonly sky: THREE.Mesh;
  private readonly controls: Controls;
  private readonly hud = new Hud();
  private readonly minimap: Minimap;
  private readonly rendered: RenderedBody[] = [];
  private readonly onboard: THREE.PerspectiveCamera[];
  private readonly onboardLabels: string[];
  private readonly views: CameraView[];
  private readonly stepper: FixedStepper;
  private readonly manual = createManualModeState();
  private readonly cameraGz = new THREE.Vector3();
  private readonly canvasSize = new THREE.Vector2();
  private readonly interpolated: Quat = [0, 0, 0, 1];

  private paused = false;
  private pipEnabled: boolean;
  private seaIndex = 0;
  private viewIndex = 0;
  private lastFrame = 0;
  private hudTimer = 0;
  private mapTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private simTimeMark = 0;
  private realTimeFactor = 1;
  private frameHandle = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly course: CourseData,
    private readonly physics: PhysicsWorld,
    private readonly waves: WaveField,
    private readonly ripples: WaveField,
    library: ModelLibrary,
    private readonly options: SimulatorOptions,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !options.lowPower, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.lowPower ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);

    const colors = defaultSkyColors();
    const light = course.world.sun.direction;
    const sunDir = new THREE.Vector3(-light[0], -light[1], -light[2]).normalize();

    this.scene.add(this.gzRoot);
    this.scene.fog = new THREE.FogExp2(colors.fog, 1 / 900);
    this.scene.add(new THREE.HemisphereLight(colors.zenith, new THREE.Color("#0b3a4a"), 0.9));
    const sun = new THREE.DirectionalLight(colors.sun, 2.4);
    gzToThree(sunDir.x, sunDir.y, sunDir.z, sun.position).multiplyScalar(100);
    this.scene.add(sun);
    this.scene.environment = this.createEnvironment(colors, sunDir);
    this.scene.environmentIntensity = 0.6;

    this.sky = createSkyDome(colors, sunDir);
    this.gzRoot.add(this.sky);
    this.ocean = new OceanSurface(waves, ripples, colors, sunDir, options.lowPower ? OCEAN_QUALITY_LOW : OCEAN_QUALITY_HIGH);
    this.gzRoot.add(this.ocean.mesh);

    for (const body of physics.bodies) {
      const object = library.build(body.model);
      this.gzRoot.add(object);
      this.rendered.push({ body, object });
    }
    const boatObject = this.rendered[0].object;
    this.onboard = createOnboardCameras(course.boat.cameras);
    this.onboard.forEach((camera) => boatObject.add(camera));
    const cameras = course.boat.cameras;
    this.onboardLabels = cameras.map((def) => {
      const side = cameraSide(def.pose[5]);
      return def.rosTopic ? `${side} · ${def.rosTopic}` : side;
    });
    const frontFirst = cameras
      .map((_, i) => i)
      .sort((a, b) => Math.abs(cameras[a].pose[5]) - Math.abs(cameras[b].pose[5]) || cameras[b].pose[5] - cameras[a].pose[5]);
    this.views = [
      { label: "Chase", mode: "chase" },
      { label: "Orbit", mode: "orbit" },
      { label: "Top-down", mode: "top" },
      ...frontFirst.map((i) => ({ label: `${cameraSide(cameras[i].pose[5])} cam`, mode: "onboard" as const, onboard: i })),
    ];

    this.rig = new CameraRig(this.renderer.domElement);
    this.stepper = new FixedStepper(physics.step);

    this.minimap = new Minimap(document.getElementById("hud-minimap") as HTMLCanvasElement);
    this.minimap.setExtent([
      ...physics.floaters.map((f) => ({ x: f.spawn.position[0], y: f.spawn.position[1] })),
      { x: physics.boat.spawn.position[0], y: physics.boat.spawn.position[1] },
    ]);

    const touchRoot = document.getElementById("touch-controls");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (coarse && touchRoot) touchRoot.classList.remove("hidden");
    this.controls = new Controls(
      {
        reset: () => this.reset(),
        togglePause: () => this.setPaused(!this.paused),
        cycleCamera: () => this.cycleCamera(),
        togglePip: () => this.setPip(!this.pipEnabled),
        toggleHelp: () => this.setHelp(!this.hud.helpVisible),
        closeHelp: () => this.setHelp(false),
        setSeaState: (i) => this.setSeaState(i),
        stepSeaState: (d) => this.setSeaState(this.seaIndex + d),
      },
      coarse ? touchRoot : null,
    );

    this.pipEnabled = !options.lowPower;
    this.bindHud();
    this.setSeaState(this.seaIndex);
    this.resize();
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private createEnvironment(colors: ReturnType<typeof defaultSkyColors>, sunDir: THREE.Vector3): THREE.Texture {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const root = createGazeboRoot();
    root.add(createSkyDome(colors, sunDir, 50));
    envScene.add(root);
    const texture = pmrem.fromScene(envScene, 0.02, 0.1, 100).texture;
    pmrem.dispose();
    return texture;
  }

  private bindHud(): void {
    const hud = this.hud;
    hud.setSeaStates(
      SEA_STATES.map((s) => (s.windSpeed === null ? `${s.label}, ${this.course.world.waves.windSpeed} m/s` : s.label)),
      this.seaIndex,
    );
    hud.seaState.addEventListener("change", () => {
      this.setSeaState(Number(hud.seaState.value));
      hud.seaState.blur();
    });
    // Drop focus after a click so Space (centre the sticks) doesn't press the button again.
    const onClick = (button: HTMLButtonElement, action: () => void) =>
      button.addEventListener("click", () => {
        button.blur();
        action();
      });
    onClick(hud.reset, () => this.reset());
    onClick(hud.pause, () => this.setPaused(!this.paused));
    onClick(hud.camera, () => this.cycleCamera());
    onClick(hud.pip, () => this.setPip(!this.pipEnabled));
    onClick(hud.help, () => this.setHelp(!hud.helpVisible));
    onClick(hud.helpClose, () => this.setHelp(false));
    hud.helpPanel.addEventListener("click", (event) => {
      if (event.target === hud.helpPanel) this.setHelp(false);
    });
    hud.setCameraLabel(this.views[this.viewIndex].label);
    hud.setPipActive(this.pipEnabled);
    const source = document.getElementById("sim-source");
    if (source) source.textContent = `Course and boat from ${this.course.source.label}`;

    let seen = true;
    try {
      seen = localStorage.getItem(HELP_SEEN_KEY) === "1";
    } catch {
      // Storage can be unavailable (private mode); just show help.
      seen = false;
    }
    this.setHelp(!seen);
  }

  start(): void {
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number) => {
    this.frameHandle = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastFrame) / 1000, 0.25);
    this.lastFrame = now;

    this.controls.update(dt);
    let alpha = 1;
    if (!this.paused) alpha = this.stepper.advance(dt, this.physicsStep);
    this.ripples.setTime(this.physics.time);

    for (const { body, object } of this.rendered) {
      const a = body.previous, b = body.current;
      object.position.set(
        a.position[0] + (b.position[0] - a.position[0]) * alpha,
        a.position[1] + (b.position[1] - a.position[1]) * alpha,
        a.position[2] + (b.position[2] - a.position[2]) * alpha,
      );
      const q = slerpQuat(a.rotation, b.rotation, alpha, this.interpolated);
      object.quaternion.set(q[0], q[1], q[2], q[3]);
    }

    const boat = this.rendered[0].object;
    const yaw = yawOf(boat.quaternion.x, boat.quaternion.y, boat.quaternion.z, boat.quaternion.w);
    this.rig.update(dt, boat.position.x, boat.position.y, boat.position.z, yaw);

    threeToGz(this.rig.camera.position, this.cameraGz);
    this.sky.position.copy(this.cameraGz);
    this.ocean.update(this.cameraGz);

    this.render();
    this.updateStats(dt);
  };

  private readonly physicsStep = () => {
    const out = manualMode(this.controls.throttle, this.controls.steering, this.manual, this.physics.step);
    this.physics.thrusters.forEach((thruster, i) => {
      this.physics.thrust[i] = thrustFromOutput(thruster.side === "left" ? out.left : out.right, thruster);
    });
    this.physics.advance();
  };

  private render(): void {
    const renderer = this.renderer;
    renderer.setScissorTest(false);
    renderer.render(this.scene, this.rig.camera);
    if (!this.pipEnabled) return;
    renderer.setScissorTest(true);
    for (const [i, view] of this.pipLayout().entries()) {
      renderer.setViewport(view.x, view.y, view.width, view.height);
      renderer.setScissor(view.x, view.y, view.width, view.height);
      renderer.render(this.scene, this.onboard[i]);
    }
    renderer.setScissorTest(false);
    renderer.getSize(this.canvasSize);
    renderer.setViewport(0, 0, this.canvasSize.x, this.canvasSize.y);
  }

  private pipLayout() {
    const width = this.container.clientWidth;
    const gap = 8;
    const count = this.onboard.length;
    const viewWidth = Math.floor(Math.min(232, (width - gap * (count + 1) - (width >= 640 ? 470 : 0)) / count));
    const viewHeight = Math.round(viewWidth / 1.6);
    const total = viewWidth * count + gap * (count - 1);
    const x0 = Math.round((width - total) / 2);
    return this.onboard.map((_, i) => ({ x: x0 + i * (viewWidth + gap), y: 12, width: viewWidth, height: viewHeight }));
  }

  private updateStats(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.realTimeFactor = this.paused ? 0 : (this.physics.time - this.simTimeMark) / this.fpsTime;
      this.simTimeMark = this.physics.time;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const boat = this.physics.boat;
    const p = boat.current.position;
    const q = boat.current.rotation;
    const yaw = yawOf(q[0], q[1], q[2], q[3]);

    this.hudTimer += dt;
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      const v = boat.state.linVel;
      const gps = localToGps(p[0], p[1], this.course.world.home);
      const left = this.physics.thrusters.findIndex((t) => t.side === "left");
      const right = this.physics.thrusters.findIndex((t) => t.side === "right");
      this.hud.update({
        speed: Math.hypot(v[0], v[1]),
        heading: compassHeading(yaw),
        lat: gps.lat,
        lon: gps.lon,
        x: p[0],
        y: p[1],
        thrustLeft: this.physics.thrust[left] ?? 0,
        thrustRight: this.physics.thrust[right] ?? 0,
        maxThrust: Math.max(...this.physics.thrusters.map((t) => t.maxThrust)),
        paused: this.paused,
        fps: this.fps,
        realTimeFactor: this.realTimeFactor,
        time: this.physics.time,
      });
    }

    this.mapTimer += dt;
    if (this.mapTimer >= 0.2) {
      this.mapTimer = 0;
      const objects: MapObject[] = this.physics.floaters.map((f) => {
        const [r, g, b] = f.model.visuals[0]?.color ?? [0.7, 0.7, 0.7];
        const geometry = f.model.collisions[0]?.geometry;
        const radius = geometry?.type === "sphere" ? geometry.radius : geometry?.type === "box" ? geometry.size[0] / 2 : 0.3;
        return {
          x: f.current.position[0],
          y: f.current.position[1],
          color: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
          radius,
        };
      });
      this.minimap.draw(objects, p[0], p[1], yaw);
    }
  }

  private reset(): void {
    this.physics.reset();
    this.manual.throttle = 0;
    this.stepper.reset();
    this.physics.settle(3);
    this.minimap.clearTrack();
    this.simTimeMark = this.physics.time;
    this.rig.setMode(this.rig.mode);
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.stepper.reset();
    this.simTimeMark = this.physics.time;
    this.hudTimer = 1;
  }

  private setView(index: number): void {
    this.viewIndex = (index + this.views.length) % this.views.length;
    const view = this.views[this.viewIndex];
    if (view.onboard !== undefined) {
      const def = this.course.boat.cameras[view.onboard];
      this.rig.setOnboard(this.onboard[view.onboard], def.hfov, def.width / def.height);
    } else {
      this.rig.setMode(view.mode);
    }
    this.hud.setCameraLabel(view.label);
    this.hud.setActivePip(view.onboard ?? null);
  }

  private cycleCamera(): void {
    this.setView(this.viewIndex + 1);
  }

  /** Clicking a camera view drives from it; clicking the active one goes back to the chase view. */
  private selectOnboard(camera: number): void {
    const active = this.views[this.viewIndex].onboard === camera;
    this.setView(active ? 0 : this.views.findIndex((view) => view.onboard === camera));
  }

  private setPip(enabled: boolean): void {
    this.pipEnabled = enabled;
    this.hud.setPipActive(enabled);
    this.layoutPipLabels();
  }

  private setHelp(visible: boolean): void {
    this.hud.setHelpVisible(visible);
    if (!visible) {
      try {
        localStorage.setItem(HELP_SEEN_KEY, "1");
      } catch {
        // Ignore storage errors.
      }
    }
  }

  private setSeaState(index: number): void {
    if (index < 0 || index >= SEA_STATES.length) return;
    this.seaIndex = index;
    const wind = SEA_STATES[index].windSpeed ?? this.course.world.waves.windSpeed;
    this.waves.setWind(wind);
    this.ripples.setWind(Math.max(3, wind));
    this.ocean.rippleStrength = wind <= 1 ? 0.45 : 1;
    this.hud.seaState.value = String(index);
  }

  private layoutPipLabels(): void {
    this.hud.setPipViews(
      this.pipLayout().map((view, i) => ({ ...view, label: this.onboardLabels[i] })),
      (camera) => this.selectOnboard(camera),
    );
    this.hud.setActivePip(this.views[this.viewIndex].onboard ?? null);
  }

  private readonly resize = () => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.rig.setAspect(width / Math.max(height, 1));
    this.layoutPipLabels();
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === "visible") {
      this.lastFrame = performance.now();
      this.stepper.reset();
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.controls.dispose();
    this.rig.dispose();
    this.ocean.dispose();
    this.renderer.dispose();
    this.physics.dispose();
  }
}
