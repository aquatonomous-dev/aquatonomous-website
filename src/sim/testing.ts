import { readFileSync } from "node:fs";
import courseJson from "./data/course.json";
import type { CourseData } from "./types";

export const course = courseJson as unknown as CourseData;

/** Reads a file the sync script wrote to public/ (Node only). */
export function readPublicFloat32(url: string): Float32Array {
  const buffer = readFileSync(new URL(`../../public${url}`, import.meta.url));
  return new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

export function boatHullTriangles(): Float32Array {
  const collision = course.models[course.boat.model].collisions.find((c) => c.geometry.type === "mesh");
  if (!collision || collision.geometry.type !== "mesh") throw new Error("Boat has no mesh collision");
  return readPublicFloat32(collision.geometry.url);
}
