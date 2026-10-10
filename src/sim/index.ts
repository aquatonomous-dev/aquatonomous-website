import courseJson from "./data/course.json";
import type { CourseData } from "./types";
import { initPhysicsEngine, PhysicsWorld } from "./physics/PhysicsWorld";
import { WaveField } from "./waves/WaveField";
import { ModelLibrary } from "./view/ModelLibrary";
import { Simulator, rippleOptions } from "./Simulator";

const course = courseJson as unknown as CourseData;

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(message: string, progress: number): void {
  const status = element("sim-loading-status");
  const bar = element("sim-loading-bar");
  if (status) status.textContent = message;
  if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
}

function showError(error: unknown): void {
  console.error(error);
  element("sim-loading")?.classList.add("hidden");
  const panel = element("sim-error");
  panel?.classList.remove("hidden");
  panel?.classList.add("flex");
  const message = element("sim-error-message");
  if (message) message.textContent = error instanceof Error ? error.message : String(error);
}

function hasWebGl2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

async function fetchFloat32(url: string): Promise<Float32Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
  return new Float32Array(await response.arrayBuffer());
}

export async function boot(): Promise<Simulator | null> {
  const viewport = element("sim-viewport");
  if (!viewport) return null;
  try {
    if (!hasWebGl2()) throw new Error("This browser doesn't support WebGL 2, which the simulator needs.");

    const hull = course.models[course.boat.model].collisions.find((c) => c.geometry.type === "mesh");
    if (!hull || hull.geometry.type !== "mesh") throw new Error("The boat model has no hull mesh.");
    const library = new ModelLibrary();
    let meshes = 0;
    let engine = false;
    const progress = () => {
      setStatus(engine ? "Loading the course…" : "Loading the physics engine…", 0.1 + 0.4 * meshes + (engine ? 0.35 : 0));
    };
    progress();
    const [hullTriangles] = await Promise.all([
      fetchFloat32(hull.geometry.url),
      library.preload(ModelLibrary.meshUrls(course), (f) => {
        meshes = f;
        progress();
      }),
      initPhysicsEngine().then(() => {
        engine = true;
        progress();
      }),
    ]);

    setStatus("Putting the boat in the water…", 0.85);
    const { waves: settings } = course.world;
    const waves = new WaveField({ ...settings });
    const ripples = new WaveField(rippleOptions(settings.windSpeed, settings.windAngleDeg, settings.updateRate));
    const physics = new PhysicsWorld(course, hullTriangles, waves);
    physics.settle(4);

    const lowPower = window.matchMedia("(pointer: coarse)").matches || Math.min(window.innerWidth, window.innerHeight) < 600;
    const simulator = new Simulator(viewport, course, physics, waves, ripples, library, { lowPower });
    simulator.start();
    setStatus("Ready", 1);
    element("sim-loading")?.classList.add("hidden");
    return simulator;
  } catch (error) {
    showError(error);
    return null;
  }
}
