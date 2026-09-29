import * as THREE from "three";
import type { EyeStyle, FaceLayout, MouthStyle, PatternId } from "./catalog";

// A MeshPhysicalMaterial that paints face + patterns in *rest space*, so the
// details stretch and squash with the soft body instead of sliding over it.

const EYES: Record<EyeStyle, number> = { none: 0, dot: 1, sparkle: 2, happy: 3, sleepy: 4 };
const MOUTHS: Record<MouthStyle, number> = { none: 0, smile: 1, cat: 2, open: 3, beak: 4 };

export interface Look {
  color: string;
  secondary: string;
  pattern: PatternId;
  eyes: EyeStyle;
  mouth: MouthStyle;
  blush: boolean;
  face: FaceLayout;
  glossy: boolean;
  /** 0 = off, 1 = paper pillow (seam around the middle), 2 = paper box (seams on edges) */
  paper?: 0 | 1 | 2;
}

/**
 * `physical` is the shaded 3D material; `basic` is unlit (flat colors) and is used to
 * render the printable paper templates so they match the 3D design exactly.
 */
export function createSquishyMaterial(kind: "physical" | "basic" = "physical") {
  const uniforms = {
    uSecondary: { value: new THREE.Color("#ffffff") },
    uPattern: { value: 0 },
    uEyes: { value: 1 },
    uMouth: { value: 1 },
    uBlush: { value: 1 },
    uFaceC: { value: new THREE.Vector3(0, 0, 1) }, // x, y, scale
    uEye: { value: new THREE.Vector3(0.3, 0.06, 0.07) },
    uMisc: { value: new THREE.Vector3(-0.08, 0.5, -0.08) }, // mouthY, blushX, blushY
    uPatch: { value: new THREE.Vector3(-0.3, 0.45, 0.34) },
    uPaper: { value: 0 },
  };

  const mat =
    kind === "basic"
      ? new THREE.MeshBasicMaterial({ color: "#ffd3e0" })
      : new THREE.MeshPhysicalMaterial({
          color: "#ffd3e0",
          roughness: 0.6,
          sheen: 0.5,
          sheenRoughness: 0.8,
          sheenColor: new THREE.Color("#ffffff"),
          clearcoat: 0.15,
          clearcoatRoughness: 0.6,
        });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 restPos;
attribute vec3 restNormal;
varying vec3 vRest;
varying vec3 vRestN;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vRest = restPos;
vRestN = restNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uSecondary;
uniform int uPattern;
uniform int uEyes;
uniform int uMouth;
uniform float uBlush;
uniform vec3 uFaceC;
uniform vec3 uEye;
uniform vec3 uMisc;
uniform vec3 uPatch;
uniform int uPaper;
varying vec3 vRest;
varying vec3 vRestN;

float cov(float d) { float w = fwidth(d) * 0.75 + 1e-4; return 1.0 - smoothstep(-w, w, d); }
float ring(vec2 p, vec2 c, float r, float w) { return abs(length(p - c) - r) - w; }
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  vec3 sec = uSecondary;
  // ---- patterns ----
  if (uPattern == 1) {
    col = mix(sec, col, smoothstep(-0.95, 0.75, vRest.y));
  } else if (uPattern == 2 || uPattern == 5) {
    float a = atan(vRest.z, vRest.x);
    float edge = 0.02 + 0.06 * sin(a * 9.0) + 0.025 * sin(a * 23.0 + 1.3);
    float icing = cov(edge - vRest.y);
    col = mix(col, sec, icing);
    if (uPattern == 5) {
      vec3 g = vRest * 11.0;
      vec3 cell = floor(g);
      float best = 1e9; vec3 bestCell = cell;
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
        vec3 c = cell + vec3(float(i), float(j), float(k));
        vec3 pt = c + hash33(c);
        float d = length(g - pt);
        if (d < best) { best = d; bestCell = c; }
      }
      float on = step(0.45, hash13(bestCell));
      vec3 pal[5];
      pal[0] = vec3(1.0, 0.95, 0.4); pal[1] = vec3(0.45, 0.8, 1.0); pal[2] = vec3(1.0, 1.0, 1.0);
      pal[3] = vec3(0.55, 0.9, 0.5); pal[4] = vec3(0.75, 0.5, 1.0);
      int pi = int(floor(hash13(bestCell + 7.0) * 4.999));
      vec3 sc = pal[0];
      for (int q = 0; q < 5; q++) if (q == pi) sc = pal[q];
      col = mix(col, sc, cov(best - 0.17) * on * icing * step(edge + 0.05, vRest.y));
    }
  } else if (uPattern == 6) {
    // foil wrapper covering the right end, with a torn wavy edge and crinkles
    float edge = 0.28 + 0.05 * sin(vRest.y * 18.0) + 0.03 * sin(vRest.z * 23.0);
    float w = cov(edge - vRest.x);
    float crinkle = 0.96 + 0.04 * sin(vRest.y * 55.0 + vRest.z * 37.0 + sin(vRest.x * 19.0) * 2.0);
    col = mix(col, sec * crinkle, w);
  } else if (uPattern == 3) {
    col = mix(col, sec, 1.0 - smoothstep(0.35, 0.7, abs(vRestN.z)));
  }

  // ---- face (front, projected along +Z in rest space) ----
  float front = smoothstep(0.05, 0.3, vRestN.z) * step(0.0, vRest.z);
  if (front > 0.0) {
    vec2 q = (vRest.xy - uFaceC.xy) / uFaceC.z;
    if (uPattern == 4) {
      float pd = length((q - vec2(0.0, uPatch.x)) / uPatch.yz) - 1.0;
      col = mix(col, sec, cov(pd * 0.3) * front);
    }
    vec3 ink = vec3(0.17, 0.11, 0.11);
    if (uBlush > 0.5) {
      for (int s = -1; s <= 1; s += 2) {
        float bd = length((q - vec2(float(s) * uMisc.y, uMisc.z)) / vec2(1.0, 0.6)) - 0.1;
        col = mix(col, vec3(1.0, 0.45, 0.55), 0.5 * (1.0 - smoothstep(-0.05, 0.03, bd)) * front);
      }
    }
    vec2 m = vec2(0.0, uMisc.x);
    if (uMouth == 1) {
      float d = max(ring(q, m + vec2(0.0, 0.045), 0.06, 0.011), q.y - (m.y + 0.02));
      col = mix(col, ink, cov(d) * front);
    } else if (uMouth == 2) {
      for (int s = -1; s <= 1; s += 2) {
        float d = max(ring(q, m + vec2(float(s) * 0.033, 0.02), 0.033, 0.009), q.y - (m.y + 0.02));
        col = mix(col, ink, cov(d) * front);
      }
    } else if (uMouth == 3) {
      float d = max(length(q - m - vec2(0.0, 0.01)) - 0.065, q.y - m.y - 0.01);
      col = mix(col, vec3(0.45, 0.1, 0.12), cov(d) * front);
      float t = max(length(q - m - vec2(0.0, -0.06)) - 0.035, d);
      col = mix(col, vec3(1.0, 0.5, 0.55), cov(t) * front);
    } else if (uMouth == 4) {
      float d = abs(q.x) / 0.095 + abs(q.y - m.y) / 0.055 - 1.0;
      col = mix(col, vec3(1.0, 0.6, 0.2), cov(d * 0.05) * front);
      col = mix(col, vec3(0.8, 0.4, 0.1), cov(abs(q.y - m.y) - 0.004) * cov(d * 0.05) * front);
    }
    for (int s = -1; s <= 1; s += 2) {
      vec2 e = vec2(float(s) * uEye.x, uEye.y);
      float r = uEye.z;
      if (uEyes == 1 || uEyes == 2) {
        float rr = uEyes == 2 ? r * 1.35 : r;
        col = mix(col, ink, cov(length(q - e) - rr) * front);
        col = mix(col, vec3(1.0), cov(length(q - e - vec2(-0.3, 0.35) * rr) - rr * 0.32) * front);
        if (uEyes == 2) col = mix(col, vec3(1.0), cov(length(q - e - vec2(0.35, -0.35) * rr) - rr * 0.16) * front);
      } else if (uEyes == 3) {
        float d = max(ring(q, e - vec2(0.0, r * 0.5), r, r * 0.2), (e.y - r * 0.35) - q.y);
        col = mix(col, ink, cov(d) * front);
      } else if (uEyes == 4) {
        float d = max(ring(q, e + vec2(0.0, r * 0.6), r, r * 0.2), q.y - (e.y + r * 0.3));
        col = mix(col, ink, cov(d) * front);
      }
    }
  }
  // ---- paper look: marker strokes, grain and inked seams ----
  if (uPaper > 0) {
    float marker = 0.965 + 0.035 * sin(dot(vRest.xy, vec2(95.0, 38.0)) + 3.0 * sin(vRest.y * 7.0 + vRest.z * 5.0));
    float grain = 0.97 + 0.03 * hash13(floor(vRest * 260.0));
    col *= marker * grain;
    float seam = abs(vRest.z) - 0.006;
    if (uPaper == 2) {
      // edges of the box: two normal components are large at the same time
      vec3 an = abs(vRestN);
      float second = an.x + an.y + an.z - max(an.x, max(an.y, an.z)) - min(an.x, min(an.y, an.z));
      seam = 0.7 - second;
    }
    col = mix(col, vec3(0.12, 0.1, 0.12), cov(seam) * 0.9);
  }
  diffuseColor.rgb = col;
}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
if (uPaper > 0) {
  // crinkly paper: wobble the shading normal
  vec3 cp = vRest * 26.0;
  normal = normalize(normal + 0.11 * vec3(
    sin(cp.x + 2.0 * sin(cp.y * 1.3)),
    sin(cp.y * 1.1 + 2.0 * sin(cp.z * 0.9)),
    sin(cp.z * 1.2 + 2.0 * sin(cp.x * 0.7))));
}`,
      );
  };

  const apply = (look: Look) => {
    mat.color.set(look.color);
    uniforms.uSecondary.value.set(look.secondary);
    uniforms.uPattern.value = look.pattern;
    uniforms.uEyes.value = EYES[look.eyes];
    uniforms.uMouth.value = MOUTHS[look.mouth];
    uniforms.uBlush.value = look.blush ? 1 : 0;
    const f = look.face;
    uniforms.uFaceC.value.set(f.x, f.y, f.scale);
    uniforms.uEye.value.set(f.eyeX, f.eyeY, f.eyeR);
    uniforms.uMisc.value.set(f.mouthY, f.blushX, f.blushY);
    uniforms.uPatch.value.set(f.patchY, f.patchRX, f.patchRY);
    uniforms.uPaper.value = look.paper ?? 0;
    if (!(mat instanceof THREE.MeshPhysicalMaterial)) return;
    if (look.paper) {
      mat.roughness = 0.92;
      mat.clearcoat = 0;
      mat.sheen = 0;
      return;
    }
    mat.roughness = look.glossy ? 0.18 : 0.6;
    mat.clearcoat = look.glossy ? 1 : 0.15;
    mat.clearcoatRoughness = look.glossy ? 0.08 : 0.6;
    mat.sheen = look.glossy ? 0.2 : 0.5;
  };

  return { material: mat, apply };
}
