import * as THREE from "three";
import type { WaveField, WaveSnapshot } from "./WaveField";
import { SKY_GLSL, skyUniforms, type SkyColors } from "../view/sky";

export interface OceanQuality {
  /** Quads from the centre to the edge of the grid. */
  halfSegments: number;
  /** Uniform spacing near the camera, in metres. */
  innerSpacing: number;
  /** Quads per side covered by the uniform inner region. */
  innerSegments: number;
  /** Spacing growth factor per quad beyond the inner region. */
  growth: number;
}

export const OCEAN_QUALITY_HIGH: OceanQuality = { halfSegments: 160, innerSpacing: 0.5, innerSegments: 80, growth: 1.06 };
export const OCEAN_QUALITY_LOW: OceanQuality = { halfSegments: 100, innerSpacing: 1, innerSegments: 40, growth: 1.07 };

class FieldTextures {
  readonly disp: THREE.DataTexture[];
  readonly slope: THREE.DataTexture[];
  private readonly dispData: Uint16Array[];
  private readonly slopeData: Uint16Array[];
  private readonly snapshots: WaveSnapshot[];
  private readonly versions = [-1, -1];
  private readonly withDisplacement: boolean;

  constructor(private readonly field: WaveField, withDisplacement: boolean) {
    const n = field.n;
    this.withDisplacement = withDisplacement;
    this.snapshots = [field.prev, field.next];
    this.dispData = [0, 1].map(() => new Uint16Array(n * n * 4));
    this.slopeData = [0, 1].map(() => new Uint16Array(n * n * 2));
    this.disp = this.dispData.map((data) => this.texture(data, THREE.RGBAFormat, n));
    this.slope = this.slopeData.map((data) => this.texture(data, THREE.RGFormat, n));
  }

  private texture(data: Uint16Array, format: THREE.PixelFormat, n: number): THREE.DataTexture {
    const texture = new THREE.DataTexture(data, n, n, format, THREE.HalfFloatType);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  /** Uploads changed snapshots; returns [prevSlot, nextSlot]. */
  sync(): [number, number] {
    for (let slot = 0; slot < 2; slot++) {
      const snapshot = this.snapshots[slot];
      if (snapshot.version === this.versions[slot]) continue;
      this.versions[slot] = snapshot.version;
      const toHalf = THREE.DataUtils.toHalfFloat;
      const disp = this.dispData[slot];
      const slope = this.slopeData[slot];
      for (let i = 0, count = snapshot.height.length; i < count; i++) {
        if (this.withDisplacement) {
          disp[i * 4] = toHalf(snapshot.dispX[i]);
          disp[i * 4 + 1] = toHalf(snapshot.dispY[i]);
          disp[i * 4 + 2] = toHalf(snapshot.height[i]);
        }
        slope[i * 2] = toHalf(snapshot.slopeX[i]);
        slope[i * 2 + 1] = toHalf(snapshot.slopeY[i]);
      }
      this.disp[slot].needsUpdate = this.withDisplacement;
      this.slope[slot].needsUpdate = true;
    }
    return [this.snapshots.indexOf(this.field.prev), this.snapshots.indexOf(this.field.next)];
  }

  dispose() {
    [...this.disp, ...this.slope].forEach((t) => t.dispose());
  }
}

function createGridGeometry(quality: OceanQuality): THREE.BufferGeometry {
  const { halfSegments, innerSpacing, innerSegments, growth } = quality;
  const offsets: number[] = [0];
  let spacing = innerSpacing;
  for (let i = 1; i <= halfSegments; i++) {
    if (i > innerSegments) spacing *= growth;
    offsets.push(offsets[i - 1] + spacing);
  }
  const coords = [...offsets.slice(1).reverse().map((o) => -o), ...offsets];
  const count = coords.length;
  const positions = new Float32Array(count * count * 3);
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const k = (i + j * count) * 3;
      positions[k] = coords[i];
      positions[k + 1] = coords[j];
    }
  }
  const indices = new Uint32Array((count - 1) * (count - 1) * 6);
  let p = 0;
  for (let j = 0; j < count - 1; j++) {
    for (let i = 0; i < count - 1; i++) {
      const a = i + j * count;
      const b = a + 1;
      const c = a + count;
      const d = c + 1;
      indices.set([a, b, d, a, d, c], p);
      p += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Displaced, camera-following water surface. Lives under the Gazebo-frame root group. */
export class OceanSurface {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly main: FieldTextures;
  private readonly ripples: FieldTextures;

  constructor(
    private readonly mainField: WaveField,
    private readonly rippleField: WaveField,
    colors: SkyColors,
    sunDir: THREE.Vector3,
    quality: OceanQuality,
  ) {
    this.main = new FieldTextures(mainField, true);
    this.ripples = new FieldTextures(rippleField, false);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...skyUniforms(colors, sunDir),
        uDisp0: { value: this.main.disp[0] },
        uDisp1: { value: this.main.disp[1] },
        uSlope0: { value: this.main.slope[0] },
        uSlope1: { value: this.main.slope[1] },
        uAlpha: { value: 0 },
        uTileSize: { value: mainField.tileSize },
        uTexel: { value: 0.5 / mainField.n },
        uRipple0: { value: this.ripples.slope[0] },
        uRipple1: { value: this.ripples.slope[1] },
        uRippleAlpha: { value: 0 },
        uRippleTile: { value: rippleField.tileSize },
        uRippleTexel: { value: 0.5 / rippleField.n },
        uRippleStrength: { value: 1 },
        uCenter: { value: new THREE.Vector2() },
        uCameraGz: { value: new THREE.Vector3() },
        uDeep: { value: new THREE.Color("#062f4a") },
        uScatter: { value: new THREE.Color("#13808f") },
        uFogDensity: { value: 1 / 900 },
      },
      vertexShader: /* glsl */ `
        uniform sampler2D uDisp0;
        uniform sampler2D uDisp1;
        uniform float uAlpha;
        uniform float uTileSize;
        uniform float uTexel;
        uniform vec2 uCenter;
        varying vec3 vPos;
        varying vec2 vBase;
        void main() {
          vec2 base = position.xy + uCenter;
          vec2 uv = base / uTileSize + uTexel;
          vec3 d = mix(texture2D(uDisp0, uv).xyz, texture2D(uDisp1, uv).xyz, uAlpha);
          vec3 p = vec3(base + d.xy, d.z);
          vPos = p;
          vBase = base;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        uniform sampler2D uSlope0;
        uniform sampler2D uSlope1;
        uniform float uAlpha;
        uniform float uTileSize;
        uniform float uTexel;
        uniform sampler2D uRipple0;
        uniform sampler2D uRipple1;
        uniform float uRippleAlpha;
        uniform float uRippleTile;
        uniform float uRippleTexel;
        uniform float uRippleStrength;
        uniform vec3 uCameraGz;
        uniform vec3 uDeep;
        uniform vec3 uScatter;
        uniform float uFogDensity;
        varying vec3 vPos;
        varying vec2 vBase;

        void main() {
          float dist = length(uCameraGz - vPos);
          vec2 uv = vBase / uTileSize + uTexel;
          vec2 slope = mix(texture2D(uSlope0, uv).xy, texture2D(uSlope1, uv).xy, uAlpha);
          vec2 ruv = vBase / uRippleTile + uRippleTexel;
          vec2 ripple = mix(texture2D(uRipple0, ruv).xy, texture2D(uRipple1, ruv).xy, uRippleAlpha);
          ripple *= uRippleStrength / (1.0 + dist * 0.06);
          slope /= 1.0 + dist * 0.004;

          vec3 n = normalize(vec3(-(slope + ripple), 1.0));
          vec3 v = normalize(uCameraGz - vPos);
          float nv = dot(n, v);
          if (nv < 0.02) {
            n = normalize(n + v * (0.02 - nv));
            nv = 0.02;
          }
          float fresnel = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
          vec3 r = reflect(-v, n);
          r.z = abs(r.z);
          vec3 reflection = skyColor(r);

          float sunLight = clamp(dot(n, uSunDir), 0.0, 1.0);
          vec3 body = uDeep + uScatter * (0.35 + 0.65 * sunLight) * (0.25 + 0.75 * (1.0 - nv));
          vec3 color = mix(body, reflection, fresnel);

          float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.6));
          color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new THREE.Mesh(createGridGeometry(quality), this.material);
    this.mesh.frustumCulled = false;
  }

  set rippleStrength(value: number) {
    this.material.uniforms.uRippleStrength.value = value;
  }

  /** cameraGz: camera position in Gazebo's frame. */
  update(cameraGz: THREE.Vector3): void {
    const u = this.material.uniforms;
    const [prev, next] = this.main.sync();
    u.uDisp0.value = this.main.disp[prev];
    u.uDisp1.value = this.main.disp[next];
    u.uSlope0.value = this.main.slope[prev];
    u.uSlope1.value = this.main.slope[next];
    u.uAlpha.value = this.mainField.alpha;

    const [rPrev, rNext] = this.ripples.sync();
    u.uRipple0.value = this.ripples.slope[rPrev];
    u.uRipple1.value = this.ripples.slope[rNext];
    u.uRippleAlpha.value = this.rippleField.alpha;

    const cell = this.mainField.cellSize;
    (u.uCenter.value as THREE.Vector2).set(
      Math.round(cameraGz.x / cell) * cell,
      Math.round(cameraGz.y / cell) * cell,
    );
    (u.uCameraGz.value as THREE.Vector3).copy(cameraGz);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.main.dispose();
    this.ripples.dispose();
  }
}
