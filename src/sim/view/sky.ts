import * as THREE from "three";

/** GLSL shared by the sky dome and the water reflection. Directions are in Gazebo's frame (z up). */
export const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;

  vec3 skyColor(vec3 dir) {
    float h = clamp(dir.z, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(h, 0.5));
    float sun = max(dot(dir, uSunDir), 0.0);
    sky += uSunColor * (pow(sun, 900.0) * 18.0 + pow(sun, 24.0) * 0.18);
    float below = smoothstep(0.0, -0.08, dir.z);
    return mix(sky, uFogColor, below);
  }
`;

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
}

export function defaultSkyColors(): SkyColors {
  return {
    zenith: new THREE.Color("#4f86c6"),
    horizon: new THREE.Color("#cfe0ea"),
    fog: new THREE.Color("#b4c9d6"),
    sun: new THREE.Color("#fff3df"),
  };
}

export function skyUniforms(colors: SkyColors, sunDir: THREE.Vector3) {
  return {
    uSkyZenith: { value: colors.zenith },
    uSkyHorizon: { value: colors.horizon },
    uFogColor: { value: colors.fog },
    uSunDir: { value: sunDir },
    uSunColor: { value: colors.sun },
  };
}

/** Inside-out sphere that follows the camera; add it under the Gazebo-frame root. */
export function createSkyDome(colors: SkyColors, sunDir: THREE.Vector3, radius = 4000): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: skyUniforms(colors, sunDir),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // Pin to the far plane so cameras with short clip distances still see the sky.
        gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
