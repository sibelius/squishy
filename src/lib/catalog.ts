import type { SquishyType } from "./sdf";

export type EyeStyle = "dot" | "sparkle" | "happy" | "sleepy" | "none";
export type MouthStyle = "smile" | "cat" | "open" | "beak" | "none";
/** 0 none, 1 gradient, 2 donut icing, 3 crust, 4 snout/belly patch, 5 sprinkles icing, 6 butter wrapper */
export type PatternId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FaceLayout {
  x: number; // face centre
  y: number;
  eyeX: number;
  eyeY: number;
  eyeR: number;
  mouthY: number;
  blushX: number;
  blushY: number;
  scale: number;
  patchY: number;
  patchRX: number;
  patchRY: number;
}

export interface CatalogEntry {
  type: SquishyType;
  label: string;
  emoji: string;
  color: string;
  secondary: string;
  pattern: PatternId;
  patterns: PatternId[];
  eyes: EyeStyle;
  mouth: MouthStyle;
  material: string;
  face: FaceLayout;
}

const F: FaceLayout = { x: 0, y: 0, eyeX: 0.3, eyeY: 0.06, eyeR: 0.07, mouthY: -0.08, blushX: 0.5, blushY: -0.08, scale: 1, patchY: -0.32, patchRX: 0.45, patchRY: 0.34 };
const face = (o: Partial<FaceLayout>): FaceLayout => ({ ...F, ...o });

export const CATALOG: CatalogEntry[] = [
  { type: "mochi", label: "Mochi", emoji: "🍡", color: "#ffd3e0", secondary: "#fff5f8", pattern: 1, patterns: [0, 1], eyes: "dot", mouth: "cat", material: "mochi", face: face({ y: -0.05 }) },
  { type: "cat", label: "Kitty", emoji: "🐱", color: "#fff1e0", secondary: "#ffb4a2", pattern: 0, patterns: [0, 1, 4], eyes: "sparkle", mouth: "cat", material: "slowRise", face: face({ y: -0.08 }) },
  { type: "bear", label: "Bear", emoji: "🐻", color: "#c98b5c", secondary: "#f6dcbc", pattern: 4, patterns: [0, 1, 4], eyes: "dot", mouth: "smile", material: "slowRise", face: face({ y: 0.02, mouthY: -0.26, blushY: -0.16, blushX: 0.55, patchY: -0.22, patchRX: 0.3, patchRY: 0.22 }) },
  { type: "bunny", label: "Bunny", emoji: "🐰", color: "#fff6fa", secondary: "#ffc2d6", pattern: 0, patterns: [0, 1, 4], eyes: "happy", mouth: "cat", material: "mochi", face: face({ y: -0.35, scale: 0.9, patchY: -0.3, patchRX: 0.35, patchRY: 0.22 }) },
  { type: "frog", label: "Froggy", emoji: "🐸", color: "#9fd36b", secondary: "#e4f6c8", pattern: 4, patterns: [0, 1, 4], eyes: "dot", mouth: "smile", material: "jelly", face: face({ y: 0, eyeX: 0.45, eyeY: 0.46, eyeR: 0.09, mouthY: -0.08, blushX: 0.62, blushY: 0.0, patchY: -0.4, patchRX: 0.62, patchRY: 0.3 }) },
  { type: "heart", label: "Heart", emoji: "💗", color: "#ff7a9c", secondary: "#ffd0dc", pattern: 1, patterns: [0, 1], eyes: "happy", mouth: "smile", material: "slowRise", face: face({ y: 0.05 }) },
  { type: "star", label: "Star", emoji: "⭐", color: "#ffd84d", secondary: "#fff3b0", pattern: 1, patterns: [0, 1], eyes: "sparkle", mouth: "open", material: "stress", face: face({ y: -0.02, scale: 0.85 }) },
  { type: "donut", label: "Donut", emoji: "🍩", color: "#e7b57a", secondary: "#ff8fb8", pattern: 5, patterns: [0, 2, 5], eyes: "dot", mouth: "smile", material: "slowRise", face: face({ y: 0.03, scale: 0.5, blushX: 0.55 }) },
  { type: "peach", label: "Peach", emoji: "🍑", color: "#ffc09a", secondary: "#ff7f8e", pattern: 1, patterns: [0, 1], eyes: "sleepy", mouth: "cat", material: "slowRise", face: face({ y: -0.12, eyeX: 0.36 }) },
  { type: "cloud", label: "Cloud", emoji: "☁️", color: "#eef6ff", secondary: "#bcd8ff", pattern: 1, patterns: [0, 1], eyes: "sleepy", mouth: "smile", material: "mochi", face: face({ y: 0.02, scale: 0.9 }) },
  { type: "toast", label: "Toast", emoji: "🍞", color: "#fbe3b3", secondary: "#c7843f", pattern: 3, patterns: [0, 3], eyes: "dot", mouth: "smile", material: "slowRise", face: face({ y: -0.05 }) },
  { type: "butter", label: "Butter", emoji: "🧈", color: "#ffe9a3", secondary: "#e9eef5", pattern: 6, patterns: [0, 1, 6], eyes: "happy", mouth: "cat", material: "butter", face: face({ x: -0.3, y: -0.1, scale: 0.85, blushX: 0.48 }) },
  { type: "chick", label: "Chick", emoji: "🐥", color: "#ffe066", secondary: "#fff3b8", pattern: 4, patterns: [0, 1, 4], eyes: "dot", mouth: "beak", material: "mochi", face: face({ y: 0.18, patchY: -0.6, patchRX: 0.5, patchRY: 0.36 }) },
];

export const PATTERN_LABELS: Record<PatternId, string> = {
  0: "Solid",
  1: "Gradient",
  2: "Icing",
  3: "Crust",
  4: "Belly patch",
  5: "Icing + sprinkles",
  6: "Foil wrapper",
};

export const EYE_STYLES: EyeStyle[] = ["dot", "sparkle", "happy", "sleepy", "none"];
export const MOUTH_STYLES: MouthStyle[] = ["smile", "cat", "open", "beak", "none"];

export const getEntry = (t: SquishyType) => CATALOG.find((c) => c.type === t)!;
