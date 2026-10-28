#!/usr/bin/env node
/**
 * Syncs the /sim course and boat from the team's Gazebo workspace.
 *
 *   node scripts/sim/sync-gazebo-assets.mjs [--ref <commit>] [--local <autonomy-ws path>] [--boat <model>]
 *
 * Reads roboboat2026_course.sdf (the RoboBoat 2026 course: gates, channel,
 * docking, speed challenge, plus the shoreline/dock/boundary-marker scenery
 * defined inline in the world) plus every model SDF and mesh it references,
 * from aQuatonomous/autonomy-workspace-26-27 (the pinned commit below, another
 * --ref, or a local clone), then writes src/sim/data/course.json and
 * Draco-compressed GLBs in public/sim/models/. --boat swaps in another model
 * folder from the same workspace as the vessel, keeping the world's spawn pose.
 *
 * All output geometry stays in Gazebo's frame: metres, Z up, x East, y North.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { draco, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

const REPO = "aQuatonomous/autonomy-workspace-26-27";
const DEFAULT_REF = "99cd9a7724f170799a964c50b135002534518012";
const SIM_DIR = "src/asv_wave_sim";
const MODELS_ROOT = `${SIM_DIR}/gz-waves-models`;
const WORLD_PATH = `${MODELS_ROOT}/worlds/roboboat2026_course.sdf`;
const ANSWER_KEY_PATH = `${MODELS_ROOT}/worlds/roboboat2026_course.answer_key.json`;
const BRIDGES_SCRIPT_PATH = `${SIM_DIR}/sim/2_bridges.sh`;
const MODEL_SEARCH_DIRS = [`${MODELS_ROOT}/models`, `${MODELS_ROOT}/world_models`];

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_MODELS_DIR = path.join(SITE_ROOT, "public/sim/models");
const OUT_COURSE_PATH = path.join(SITE_ROOT, "src/sim/data/course.json");
const PUBLIC_MODELS_URL = "/sim/models";

// The Task 4 vessel STLs were exported Y-up with their origin about 1 m from
// the hull, so the world's pose leaves them upside down and away from their
// collision boxes. Re-centre them and flip them upright.
const VISUAL_FIXUPS = {
  aqua_t4_yellow: { center: true, rotateX: Math.PI },
  aqua_t4_black: { center: true, rotateX: Math.PI },
};

const ARRAY_TAGS = new Set([
  "include", "model", "link", "joint", "visual", "collision", "sensor", "plugin", "light", "control",
]);

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

// ---------------------------------------------------------------------------
// Arguments and source access

function parseArgs(argv) {
  const args = { ref: DEFAULT_REF, local: null, boat: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ref") args.ref = argv[++i];
    else if (arg === "--local") args.local = path.resolve(argv[++i]);
    else if (arg === "--boat") args.boat = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/sim/sync-gazebo-assets.mjs [--ref <commit>] [--local <path>] [--boat <model>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

async function listLocalFiles(root, dir) {
  const out = [];
  const walk = async (rel) => {
    let entries;
    try {
      entries = await readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) await walk(child);
      else out.push(child);
    }
  };
  await walk(dir);
  return out;
}

function createSource({ ref, local }) {
  if (local) {
    return {
      label: `${local} (local clone)`,
      ref: null,
      text: (p) => readFile(path.join(local, p), "utf8"),
      binary: async (p) => new Uint8Array(await readFile(path.join(local, p))),
      list: (dir) => listLocalFiles(local, dir),
    };
  }
  let tree;
  const loadTree = async () => {
    tree ??= fetchOk(`https://api.github.com/repos/${REPO}/git/trees/${ref}?recursive=1`)
      .then((res) => res.json())
      .then((json) => {
        if (json.truncated) throw new Error("GitHub tree listing was truncated; use --local instead");
        return json.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
      });
    return tree;
  };
  const raw = (p) => `https://raw.githubusercontent.com/${REPO}/${ref}/${p.split("/").map(encodeURIComponent).join("/")}`;
  return {
    label: `${REPO}@${ref}`,
    ref,
    text: async (p) => (await fetchOk(raw(p))).text(),
    binary: async (p) => new Uint8Array(await (await fetchOk(raw(p))).arrayBuffer()),
    list: async (dir) => (await loadTree()).filter((p) => p.startsWith(`${dir}/`)),
  };
}

// ---------------------------------------------------------------------------
// SDF value helpers

const textOf = (node) => {
  if (node == null) return undefined;
  if (typeof node === "object") return node["#text"];
  return String(node);
};

const numbersOf = (node, fallback) => {
  const value = textOf(node);
  if (value == null || value.trim() === "") return fallback;
  return value.trim().split(/\s+/).map(Number);
};

const numberOf = (node, fallback) => {
  const value = textOf(node);
  if (value == null || value.trim() === "") return fallback;
  return Number(value);
};

const boolOf = (node, fallback) => {
  const value = textOf(node);
  if (value == null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
};

function poseOf(node) {
  if (node == null) return [0, 0, 0, 0, 0, 0];
  const values = numbersOf(node, [0, 0, 0, 0, 0, 0]);
  if (typeof node === "object" && node["@_degrees"] === "true") {
    for (let i = 3; i < 6; i++) values[i] *= Math.PI / 180;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Small linear algebra (row-major 3x3)

function rpyToMatrix(roll, pitch, yaw) {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

function matrixToRpy(m) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[2][0])));
  return [Math.atan2(m[2][1], m[2][2]), pitch, Math.atan2(m[1][0], m[0][0])];
}

const matMul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const matVec = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const transpose = (m) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize3 = (a) => scale3(a, 1 / Math.hypot(a[0], a[1], a[2]));

function composePose(parent, child) {
  const rp = rpyToMatrix(parent[3], parent[4], parent[5]);
  const rc = rpyToMatrix(child[3], child[4], child[5]);
  const position = add3(parent.slice(0, 3), matVec(rp, child.slice(0, 3)));
  return [...position, ...matrixToRpy(matMul(rp, rc))];
}

const poseRotation = (pose) => rpyToMatrix(pose[3], pose[4], pose[5]);

// Cyclic Jacobi eigen-decomposition of a symmetric 3x3 matrix.
function symmetricEigen(input) {
  const a = input.map((row) => row.slice());
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  // Columns of v are eigenvectors; keep the frame right-handed.
  const det =
    v[0][0] * (v[1][1] * v[2][2] - v[1][2] * v[2][1]) -
    v[0][1] * (v[1][0] * v[2][2] - v[1][2] * v[2][0]) +
    v[0][2] * (v[1][0] * v[2][1] - v[1][1] * v[2][0]);
  if (det < 0) for (let k = 0; k < 3; k++) v[k][2] = -v[k][2];
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}

function matrixToQuaternion(m) {
  const trace = m[0][0] + m[1][1] + m[2][2];
  let x, y, z, w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m[2][1] - m[1][2]) / s;
    y = (m[0][2] - m[2][0]) / s;
    z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s;
    x = 0.25 * s;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = 0.25 * s;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

// ---------------------------------------------------------------------------
// SDF model parsing

function parseGeometry(geometry) {
  if (!geometry) throw new Error("Missing <geometry>");
  if (geometry.box) return { type: "box", size: numbersOf(geometry.box.size, [1, 1, 1]) };
  if (geometry.sphere) return { type: "sphere", radius: numberOf(geometry.sphere.radius, 1) };
  if (geometry.cylinder) {
    return {
      type: "cylinder",
      radius: numberOf(geometry.cylinder.radius, 1),
      length: numberOf(geometry.cylinder.length, 1),
    };
  }
  if (geometry.mesh) {
    return { type: "mesh", uri: textOf(geometry.mesh.uri), scale: numbersOf(geometry.mesh.scale, [1, 1, 1]) };
  }
  throw new Error(`Unsupported geometry: ${Object.keys(geometry).join(", ")}`);
}

function parseMaterial(material) {
  if (!material) return null;
  const metal = material.pbr?.metal;
  return {
    diffuse: numbersOf(material.diffuse),
    emissive: numbersOf(material.emissive),
    metalness: numberOf(metal?.metalness),
    roughness: numberOf(metal?.roughness),
  };
}

function parseInertial(inertial) {
  if (!inertial) return null;
  const i = inertial.inertia ?? {};
  return {
    mass: numberOf(inertial.mass, 1),
    pose: poseOf(inertial.pose),
    tensor: [
      [numberOf(i.ixx, 1), numberOf(i.ixy, 0), numberOf(i.ixz, 0)],
      [numberOf(i.ixy, 0), numberOf(i.iyy, 1), numberOf(i.iyz, 0)],
      [numberOf(i.ixz, 0), numberOf(i.iyz, 0), numberOf(i.izz, 1)],
    ],
  };
}

function parseSensor(sensor) {
  const base = {
    name: sensor["@_name"],
    type: sensor["@_type"],
    pose: poseOf(sensor.pose),
    rate: numberOf(sensor.update_rate, 0),
    topic: textOf(sensor.topic) ?? null,
  };
  if (sensor.camera) {
    const camera = sensor.camera;
    return {
      ...base,
      hfov: numberOf(camera.horizontal_fov, 1.047),
      width: numberOf(camera.image?.width, 320),
      height: numberOf(camera.image?.height, 240),
      near: numberOf(camera.clip?.near, 0.1),
      far: numberOf(camera.clip?.far, 100),
    };
  }
  const lidar = sensor.lidar ?? sensor.ray;
  if (lidar) {
    const scan = lidar.scan ?? {};
    const axis = (a) => ({
      samples: numberOf(a?.samples, 1),
      minAngle: numberOf(a?.min_angle, 0),
      maxAngle: numberOf(a?.max_angle, 0),
    });
    return {
      ...base,
      horizontal: axis(scan.horizontal),
      vertical: axis(scan.vertical),
      rangeMin: numberOf(lidar.range?.min, 0.1),
      rangeMax: numberOf(lidar.range?.max, 10),
    };
  }
  return base;
}

// Parses a model already extracted from an SDF document (a standalone model.sdf's root
// <model>, or a <model> embedded directly in a world file, e.g. the course's shoreline/dock/
// boundary-marker scenery).
function parseModelNode(model, modelDir) {
  const links = (model.link ?? []).map((link) => ({
    name: link["@_name"],
    pose: poseOf(link.pose),
    inertial: parseInertial(link.inertial),
    collisions: (link.collision ?? []).map((c) => ({
      name: c["@_name"],
      pose: poseOf(c.pose),
      geometry: parseGeometry(c.geometry),
    })),
    visuals: (link.visual ?? []).map((v) => ({
      name: v["@_name"],
      pose: poseOf(v.pose),
      geometry: parseGeometry(v.geometry),
      material: parseMaterial(v.material),
    })),
    sensors: (link.sensor ?? []).map(parseSensor),
  }));
  const joints = (model.joint ?? []).map((joint) => ({
    name: joint["@_name"],
    type: joint["@_type"],
    parent: textOf(joint.parent),
    child: textOf(joint.child),
    axis: numbersOf(joint.axis?.xyz, [0, 0, 1]),
    lower: numberOf(joint.axis?.limit?.lower),
    upper: numberOf(joint.axis?.limit?.upper),
  }));
  const plugins = (model.plugin ?? []).map((plugin) => ({
    name: plugin["@_name"] ?? "",
    filename: plugin["@_filename"] ?? "",
    raw: plugin,
  }));
  return { name: model["@_name"], isStatic: boolOf(model.static, false), links, joints, plugins, dir: modelDir };
}

function parseModelSdf(sdfText, modelDir) {
  const root = xml.parse(sdfText).sdf;
  const model = root.model?.[0];
  if (!model) throw new Error(`No <model> in ${modelDir}/model.sdf`);
  return parseModelNode(model, modelDir);
}

// ---------------------------------------------------------------------------
// Meshes

function parseStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  if (84 + count * 50 === bytes.byteLength) {
    const positions = new Float32Array(count * 9);
    for (let t = 0; t < count; t++) {
      const offset = 84 + t * 50 + 12;
      for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(offset + k * 4, true);
    }
    return positions;
  }
  const textContent = new TextDecoder().decode(bytes);
  const values = [...textContent.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [
    Number(m[1]), Number(m[2]), Number(m[3]),
  ]);
  if (values.length === 0 || values.length % 9 !== 0) throw new Error("Unreadable STL file");
  return new Float32Array(values);
}

// Wavefront OBJ, as written by tools/make_course_models.py for the course's shared shapes
// (indicator frustum, number banner, sign triangle, stationary-vessel hull). Faces may be
// n-gons (quads); fan-triangulate them. Normals, if present, are ignored -- flatNormals()
// recomputes them per triangle the same way parseStl's output does.
function parseObj(text) {
  const vertices = [];
  const positions = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const [x, y, z] = trimmed.slice(2).trim().split(/\s+/).map(Number);
      vertices.push([x, y, z]);
    } else if (trimmed.startsWith("f ")) {
      const face = trimmed
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((token) => {
          const i = Number(token.split("/")[0]);
          return i > 0 ? vertices[i - 1] : vertices[vertices.length + i];
        });
      for (let i = 1; i < face.length - 1; i++) positions.push(face[0], face[i], face[i + 1]);
    }
  }
  if (positions.length === 0) throw new Error("Unreadable OBJ file (no faces)");
  return new Float32Array(positions.flat());
}

function parseMesh(bytes, ext) {
  return ext === ".obj" ? parseObj(new TextDecoder().decode(bytes)) : parseStl(bytes);
}

function transformPositions(positions, { scale = [1, 1, 1], pose = null, fixup = null }) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i] * scale[0];
    out[i + 1] = positions[i + 1] * scale[1];
    out[i + 2] = positions[i + 2] * scale[2];
  }
  if (fixup?.center) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < out.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], out[i + k]);
        max[k] = Math.max(max[k], out[i + k]);
      }
    }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    for (let i = 0; i < out.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] -= center[k];
  }
  if (fixup?.rotateX) {
    const c = Math.cos(fixup.rotateX), s = Math.sin(fixup.rotateX);
    for (let i = 0; i < out.length; i += 3) {
      const y = out[i + 1], z = out[i + 2];
      out[i + 1] = c * y - s * z;
      out[i + 2] = s * y + c * z;
    }
  }
  if (pose) {
    const r = poseRotation(pose);
    for (let i = 0; i < out.length; i += 3) {
      const p = add3(matVec(r, [out[i], out[i + 1], out[i + 2]]), pose.slice(0, 3));
      out[i] = p[0];
      out[i + 1] = p[1];
      out[i + 2] = p[2];
    }
  }
  return out;
}

function flatNormals(positions) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const a = [positions[i], positions[i + 1], positions[i + 2]];
    const b = [positions[i + 3], positions[i + 4], positions[i + 5]];
    const c = [positions[i + 6], positions[i + 7], positions[i + 8]];
    const u = sub3(b, a), v = sub3(c, a);
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    n = len > 0 ? scale3(n, 1 / len) : [0, 0, 1];
    for (let k = 0; k < 3; k++) normals.set(n, i + k * 3);
  }
  return normals;
}

async function writeGlb(io, positions, name, file) {
  const document = new Document();
  const buffer = document.createBuffer();
  const position = document.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer);
  const normal = document.createAccessor().setType("VEC3").setArray(flatNormals(positions)).setBuffer(buffer);
  const material = document.createMaterial(name).setBaseColorFactor([0.8, 0.8, 0.8, 1]).setRoughnessFactor(0.6).setMetallicFactor(0);
  const primitive = document.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setMaterial(material);
  const mesh = document.createMesh(name).addPrimitive(primitive);
  document.createScene(name).addChild(document.createNode(name).setMesh(mesh));
  await document.transform(weld(), draco({ method: "edgebreaker" }));
  await writeFile(file, await io.writeBinary(document));
}

// ---------------------------------------------------------------------------
// Main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = createSource(args);
  console.log(`Reading ${source.label}`);

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      "draco3d.encoder": await draco3d.createEncoderModule(),
      "draco3d.decoder": await draco3d.createDecoderModule(),
    });

  const modelDirCache = new Map();
  async function findModelDir(name) {
    if (modelDirCache.has(name)) return modelDirCache.get(name);
    for (const dir of MODEL_SEARCH_DIRS) {
      const files = await source.list(`${dir}/${name}`);
      if (files.includes(`${dir}/${name}/model.sdf`)) {
        modelDirCache.set(name, `${dir}/${name}`);
        return `${dir}/${name}`;
      }
    }
    throw new Error(`Model "${name}" not found under ${MODEL_SEARCH_DIRS.join(" or ")}`);
  }

  async function resolveUri(uri, modelDir) {
    const match = /^models?:\/\/([^/]+)\/(.+)$/.exec(uri);
    if (match) return `${await findModelDir(match[1])}/${match[2]}`;
    return path.posix.normalize(path.posix.join(modelDir, uri));
  }

  async function meshSource(repoPath) {
    const ext = path.posix.extname(repoPath).toLowerCase();
    if (ext === ".stl" || ext === ".obj") return repoPath;
    const dir = path.posix.dirname(repoPath);
    const base = path.posix.basename(repoPath, path.posix.extname(repoPath)).toLowerCase();
    const stls = (await source.list(dir)).filter(
      (p) => path.posix.dirname(p) === dir && p.toLowerCase().endsWith(".stl"),
    );
    const sameName = stls.find((p) => path.posix.basename(p, path.posix.extname(p)).toLowerCase() === base);
    if (sameName) return sameName;
    if (stls.length === 1) return stls[0];
    throw new Error(`No STL alongside ${repoPath}; export one so the browser sim can load it`);
  }

  const modelCache = new Map();
  async function loadModel(name) {
    if (!modelCache.has(name)) {
      const dir = await findModelDir(name);
      modelCache.set(name, parseModelSdf(await source.text(`${dir}/model.sdf`), dir));
    }
    return modelCache.get(name);
  }

  await rm(OUT_MODELS_DIR, { recursive: true, force: true });
  await mkdir(OUT_MODELS_DIR, { recursive: true });
  await mkdir(path.dirname(OUT_COURSE_PATH), { recursive: true });

  const writtenMeshes = new Map();
  async function emitMesh(repoPath, { scale, fixup }) {
    const stlPath = await meshSource(repoPath);
    const ext = path.posix.extname(stlPath).toLowerCase();
    const positions = transformPositions(parseMesh(await source.binary(stlPath), ext), { scale, fixup });
    const hash = createHash("sha1").update(Buffer.from(positions.buffer)).digest("hex");
    if (!writtenMeshes.has(hash)) {
      const baseName = path.posix.basename(stlPath, path.posix.extname(stlPath));
      let fileName = `${baseName}.glb`;
      const taken = new Set([...writtenMeshes.values()].map((m) => m.fileName));
      for (let n = 2; taken.has(fileName); n++) fileName = `${baseName}-${n}.glb`;
      await writeGlb(io, positions, baseName, path.join(OUT_MODELS_DIR, fileName));
      writtenMeshes.set(hash, { fileName, source: stlPath, triangles: positions.length / 9 });
    }
    return `${PUBLIC_MODELS_URL}/${writtenMeshes.get(hash).fileName}`;
  }

  // World
  const world = xml.parse(await source.text(WORLD_PATH)).sdf.world;
  const worldDir = path.posix.dirname(WORLD_PATH);
  const includes = (world.include ?? []).map((inc) => {
    const uri = textOf(inc.uri);
    const model = uri.replace(/^models?:\/\//, "").replace(/\/$/, "");
    return { model, name: textOf(inc.name) ?? model, pose: poseOf(inc.pose) };
  });
  // Course scenery (shoreline, docks, boundary markers, ...) defined as <model> directly in
  // the world file, rather than placed by <include> from the shared model library.
  const inlineModels = (world.model ?? []).map((m) => ({
    name: m["@_name"],
    parsed: parseModelNode(m, worldDir),
    pose: poseOf(m.pose),
  }));
  const sun = (world.light ?? []).find((l) => l["@_type"] === "directional") ?? world.light?.[0];

  // Waves: an <include> of the shared "waves" model, or (in the RoboBoat 2026 course) a <model>
  // with the WavesModel plugin embedded directly in the world.
  const wavesInclude = includes.find((inc) => inc.model === "waves");
  const wavesInline = inlineModels.find((m) => m.name === "waves");
  if (!wavesInclude && !wavesInline) throw new Error("World has no waves model (include or inline)");
  const wavesModel = wavesInline ? wavesInline.parsed : await loadModel("waves");
  const wavesPlugin = wavesModel.plugins.find((p) => p.filename.includes("waves-model"));
  const wave = wavesPlugin?.raw.wave ?? {};
  const waves = {
    algorithm: textOf(wave.algorithm) ?? "fft",
    tileSize: numberOf(wave.tile_size, 256),
    cellCount: numberOf(wave.cell_count, 128),
    windSpeed: numberOf(wave.wind_speed, 5),
    windAngleDeg: numberOf(wave.wind_angle_deg, 0),
    steepness: numberOf(wave.steepness, 1),
    updateRate: numberOf(wavesPlugin?.raw.update_rate, 30),
  };

  // Details that live outside the course SDF: the SITL home (lat,lon,alt,heading, same string
  // format select_course.sh writes) comes from the course's answer key, and the ROS topic each
  // camera ends up on comes from the ros_gz_bridge remaps in sim/2_bridges.sh.
  const answerKeyText = await source.text(ANSWER_KEY_PATH).catch(() => null);
  const home = answerKeyText && /"sitl_home"\s*:\s*"([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)"/.exec(answerKeyText);
  const bridgesScript = await source.text(BRIDGES_SCRIPT_PATH).catch(() => "");
  const cameraTopics = Object.fromEntries(
    [...bridgesScript.matchAll(/-r\s+\/(\w*camera\w*):=(\S+)/g)].map((m) => [m[1], m[2]]),
  );

  // Models
  const describedModels = {};

  async function describeVisuals(model, link, { colorFallback }) {
    const visuals = [];
    for (const visual of link.visuals) {
      const material = visual.material;
      const color = material?.diffuse?.length >= 3 ? [...material.diffuse.slice(0, 3), material.diffuse[3] ?? 1] : colorFallback;
      const entry = {
        name: visual.name,
        pose: composePose(link.pose, visual.pose),
        color,
        roughness: material?.roughness ?? 0.6,
        metalness: material?.metalness ?? 0,
        ...(material?.emissive?.length >= 3 ? { emissive: material.emissive.slice(0, 3) } : {}),
      };
      const g = visual.geometry;
      if (g.type === "mesh") {
        const repoPath = await resolveUri(g.uri, model.dir);
        entry.geometry = {
          type: "mesh",
          url: await emitMesh(repoPath, { scale: g.scale, fixup: VISUAL_FIXUPS[path.posix.basename(model.dir)] }),
        };
      } else {
        entry.geometry = g;
      }
      visuals.push(entry);
    }
    return visuals;
  }

  function massProperties(model) {
    const parts = [];
    for (const link of model.links) {
      if (!link.inertial || !(link.inertial.mass > 0)) continue;
      const framePose = composePose(link.pose, link.inertial.pose);
      const r = poseRotation(framePose);
      let tensor = matMul(matMul(r, link.inertial.tensor), transpose(r));
      const joint = model.joints.find((j) => j.child === link.name);
      const freeRevolute =
        joint && (joint.type === "revolute" || joint.type === "continuous") && !(joint.lower === joint.upper && joint.lower != null);
      if (freeRevolute) {
        // A freely spinning link does not follow the hull about its joint axis.
        const a = normalize3(matVec(poseRotation(link.pose), joint.axis));
        const p = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - a[i] * a[j]));
        tensor = matMul(matMul(p, tensor), p);
      }
      parts.push({ mass: link.inertial.mass, com: framePose.slice(0, 3), tensor });
    }
    const mass = parts.reduce((s, p) => s + p.mass, 0);
    const com = scale3(parts.reduce((s, p) => add3(s, scale3(p.com, p.mass)), [0, 0, 0]), 1 / mass);
    const total = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const part of parts) {
      const d = sub3(part.com, com);
      const d2 = dot3(d, d);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          total[i][j] += part.tensor[i][j] + part.mass * ((i === j ? d2 : 0) - d[i] * d[j]);
        }
      }
    }
    const { values, vectors } = symmetricEigen(total);
    return { mass, com, principalInertia: values, inertiaFrame: matrixToQuaternion(vectors) };
  }

  async function describeCollisions(model, link) {
    const collisions = [];
    for (const collision of link.collisions) {
      const pose = composePose(link.pose, collision.pose);
      const g = collision.geometry;
      if (g.type === "mesh") {
        const repoPath = await resolveUri(g.uri, model.dir);
        const stlPath = await meshSource(repoPath);
        const ext = path.posix.extname(stlPath).toLowerCase();
        const positions = transformPositions(parseMesh(await source.binary(stlPath), ext), { scale: g.scale, pose });
        const fileName = `${path.posix.basename(model.dir)}-${collision.name}.f32`;
        await writeFile(path.join(OUT_MODELS_DIR, fileName), Buffer.from(positions.buffer));
        collisions.push({
          name: collision.name,
          pose: [0, 0, 0, 0, 0, 0],
          geometry: { type: "mesh", url: `${PUBLIC_MODELS_URL}/${fileName}`, triangles: positions.length / 9 },
        });
      } else {
        collisions.push({ name: collision.name, pose, geometry: g });
      }
    }
    return collisions;
  }

  function hydrodynamicsOf(model) {
    const plugin = model.plugins.find((p) => p.filename.includes("hydrodynamics"));
    if (!plugin) return null;
    const h = plugin.raw.hydrodynamics ?? {};
    const enabled = plugin.raw.enable;
    const links = enabled == null ? null : [enabled].flat().map((e) => textOf(e).split("::").pop());
    return {
      links,
      damping: boolOf(h.damping_on, true),
      viscousDrag: boolOf(h.viscous_drag_on, true),
      pressureDrag: boolOf(h.pressure_drag_on, true),
    };
  }

  async function describeParsedModel(model, name, { isBoat }) {
    const hydrodynamics = hydrodynamicsOf(model);
    const bodyLinks = isBoat
      ? model.links.filter((l) => (hydrodynamics?.links ?? [model.links[0].name]).includes(l.name))
      : model.links;
    const visuals = [];
    const collisions = [];
    for (const link of bodyLinks) {
      visuals.push(...(await describeVisuals(model, link, { colorFallback: defaultColor(name) })));
      collisions.push(...(await describeCollisions(model, link)));
    }
    return {
      name,
      sdfName: model.name,
      static: model.isStatic,
      mass: massProperties(model),
      collisions,
      visuals,
      hydrodynamics: hydrodynamics && {
        damping: hydrodynamics.damping,
        viscousDrag: hydrodynamics.viscousDrag,
        pressureDrag: hydrodynamics.pressureDrag,
      },
    };
  }

  async function describeModel(name, { isBoat }) {
    return describeParsedModel(await loadModel(name), name, { isBoat });
  }

  function describeThrusters(model) {
    const ardupilot = model.plugins.find((p) => p.filename.includes("ArduPilotPlugin") || p.name === "ArduPilotPlugin");
    const controls = ardupilot ? [ardupilot.raw.control ?? []].flat() : [];
    return model.plugins
      .filter((p) => p.filename.includes("thruster-system"))
      .map((plugin) => {
        const jointName = textOf(plugin.raw.joint_name);
        const joint = model.joints.find((j) => j.name === jointName);
        const link = model.links.find((l) => l.name === joint?.child);
        if (!joint || !link) throw new Error(`Thruster joint ${jointName} not found`);
        const control = controls.find((c) => textOf(c.jointName) === jointName);
        if (!control) throw new Error(`No ArduPilotPlugin <control> for ${jointName}`);
        const multiplier = numberOf(control.multiplier, 1);
        const offset = numberOf(control.offset, 0);
        const position = link.pose.slice(0, 3);
        return {
          joint: jointName,
          side: position[1] >= 0 ? "left" : "right",
          channel: Number(control["@_channel"] ?? 0) + 1,
          position,
          direction: normalize3(matVec(poseRotation(link.pose), joint.axis)),
          minThrust: offset * multiplier,
          maxThrust: (1 + offset) * multiplier,
          servoMin: numberOf(control.servo_min, 1000),
          servoMax: numberOf(control.servo_max, 2000),
        };
      })
      .sort((a, b) => (a.side === b.side ? 0 : a.side === "left" ? -1 : 1));
  }

  function describeSensors(model) {
    const cameras = [];
    let lidar = null;
    for (const link of model.links) {
      for (const sensor of link.sensors) {
        const pose = composePose(link.pose, sensor.pose);
        if (sensor.type === "camera") {
          cameras.push({ ...sensor, pose, rosTopic: cameraTopics[sensor.topic] ?? null });
        } else if (sensor.type === "gpu_lidar" || sensor.type === "lidar" || sensor.type === "ray") {
          lidar ??= { ...sensor, pose };
        }
      }
    }
    cameras.sort((a, b) => b.pose[5] - a.pose[5]);
    return { cameras, lidar };
  }

  const boatInclude = args.boat
    ? includes.find((inc) => inc.model === "ourboat") ?? includes[0]
    : includes.find((inc) => inc.model === "ourboat");
  if (!boatInclude) throw new Error("World has no model://ourboat include; pass --boat <model>");
  const boatModelName = args.boat ?? boatInclude.model;

  const boatSdf = await loadModel(boatModelName);
  const boatModel = await describeModel(boatModelName, { isBoat: true });
  if (!boatModel.collisions.some((c) => c.geometry.type === "mesh")) {
    throw new Error(`${boatModelName} needs a mesh collision (a closed hull) for buoyancy`);
  }
  describedModels[boatModelName] = boatModel;
  const thrusters = describeThrusters(boatSdf);
  if (thrusters.length === 0) throw new Error(`${boatModelName} has no thruster plugins`);
  const sensors = describeSensors(boatSdf);

  const instances = [];
  for (const inc of includes) {
    if (inc === wavesInclude || inc === boatInclude) continue;
    describedModels[inc.model] ??= await describeModel(inc.model, { isBoat: false });
    instances.push({ name: inc.name, model: inc.model, pose: inc.pose });
  }
  for (const m of inlineModels) {
    if (m === wavesInline) continue;
    describedModels[m.name] ??= await describeParsedModel(m.parsed, m.name, { isBoat: false });
    instances.push({ name: m.name, model: m.name, pose: m.pose });
  }

  const course = {
    source: {
      repo: REPO,
      ref: source.ref,
      label: source.label,
      world: WORLD_PATH,
      generatedBy: "scripts/sim/sync-gazebo-assets.mjs",
    },
    frame: "gazebo: metres, z up, x east, y north",
    world: {
      name: world["@_name"],
      physicsStep: numberOf(world.physics?.max_step_size, 0.001),
      gravity: [0, 0, -9.81],
      ambient: numbersOf(world.scene?.ambient, [0.4, 0.4, 0.4, 1]),
      background: numbersOf(world.scene?.background, [0.7, 0.7, 0.7, 1]),
      sun: {
        direction: numbersOf(sun?.direction, [-0.5, 0.1, -0.9]),
        diffuse: numbersOf(sun?.diffuse, [0.8, 0.8, 0.8, 1]),
      },
      waves,
      home: home
        ? { lat: Number(home[1]), lon: Number(home[2]), alt: Number(home[3]), heading: Number(home[4]) }
        : { lat: 0, lon: 0, alt: 0, heading: 0 },
    },
    boat: {
      name: boatInclude.name,
      model: boatModelName,
      pose: boatInclude.pose,
      vehicle: "ArduPilot Rover, rover-skid frame",
      thrusters,
      cameras: sensors.cameras,
      lidar: sensors.lidar,
    },
    models: describedModels,
    instances,
  };

  await writeFile(OUT_COURSE_PATH, `${JSON.stringify(roundDeep(course), null, 2)}\n`);

  console.log(`Boat ${boatModelName}: ${course.models[boatModelName].mass.mass.toFixed(2)} kg, ${thrusters.length} thrusters, ${sensors.cameras.length} cameras`);
  console.log(`Course: ${instances.length} objects from ${Object.keys(describedModels).length - 1} models`);
  for (const file of (await readdir(OUT_MODELS_DIR)).sort()) {
    const { size } = await stat(path.join(OUT_MODELS_DIR, file));
    console.log(`  public/sim/models/${file}  ${(size / 1024).toFixed(1)} KB`);
  }
  console.log(`Wrote ${path.relative(SITE_ROOT, OUT_COURSE_PATH)}`);
}

function defaultColor(modelName) {
  const name = modelName.toLowerCase();
  if (name.includes("red")) return [0.62, 0.04, 0.03, 1];
  if (name.includes("green")) return [0.04, 0.42, 0.1, 1];
  if (name.includes("yellow")) return [0.95, 0.8, 0.05, 1];
  if (name.includes("black")) return [0.035, 0.035, 0.04, 1];
  return [0.7, 0.7, 0.7, 1];
}

function roundDeep(value) {
  if (typeof value === "number") return Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(6));
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v)]));
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
