// Where the phone is, shared by the WebGL phone and its CSS fallback (one source of truth).
// Coordinates are fractions of the phone's stage box; angles in radians.
import type { ScreenKey } from '../content/media'

export type Pose = { cx: number; cy: number; h: number; rx: number; ry: number; rz: number }
/** What a stage asks of its phone each frame: the pose and which screen (float = crossfade). */
export type PhoneTarget = { pose: Pose; screen: number }
export type PhoneDriver = (width: number, height: number, time: number) => PhoneTarget

type Key = [number, Pose]

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// Same breakpoint as the CSS layout (Tailwind lg) so phone and text never disagree.
export const isNarrow = (width: number) => width < 1024

function interpolate(keys: Key[], progress: number): Pose {
  const p = clamp01(progress)
  let i = 0
  while (i < keys.length - 2 && p > keys[i + 1][0]) i++
  const [p0, a] = keys[i]
  const [p1, b] = keys[i + 1]
  const t = smooth(clamp01((p - p0) / (p1 - p0 || 1)))
  return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), h: lerp(a.h, b.h, t), rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), rz: lerp(a.rz, b.rz, t) }
}

/** Float screen index that crossfades at each switch point. */
export function screenAcross(progress: number, switches: number[], width = 0.035) {
  return switches.reduce((value, at) => value + smooth(clamp01((progress - (at - width)) / (2 * width))), 0)
}

// ── Hero: the phone stands on the pedestal, follows the pointer and turns as the hero scrolls away.
export const HERO_SCREENS: ScreenKey[] = ['product', 'home', 'catalog', 'cart']
export function heroPose(scroll: number, px: number, py: number): Pose {
  const s = clamp01(scroll)
  return { cx: 0.52, cy: 0.47 - s * 0.05, h: 0.86, rx: 0.06 + py * 0.1 + s * 0.22, ry: -0.42 + px * 0.22 + s * 0.7, rz: 0.06 - s * 0.05 }
}
/** Screens advance on their own in the hero: 3.6 s each, 0.5 s crossfade. */
export function heroScreen(time: number) {
  const n = HERO_SCREENS.length
  const slot = 3.6
  const t = (time / slot) % n
  const i = Math.floor(t)
  const f = smooth(clamp01((t - i - (1 - 0.5 / slot)) / (0.5 / slot)))
  return i + f >= n ? (i + f) - n : i + f
}

// ── "Cómo funciona": the sticky story, three acts (sube · comparte · recibe).
export const STORY_SCREENS: ScreenKey[] = ['product', 'catalog', 'cart']
export const STORY_SWITCHES = [0.36, 0.68]

const WIDE: Key[] = [
  [0, { cx: 0.7, cy: 0.64, h: 0.64, rx: 0.2, ry: -0.75, rz: 0.1 }],
  [0.12, { cx: 0.69, cy: 0.55, h: 0.72, rx: 0.03, ry: -0.22, rz: 0.02 }],
  [0.3, { cx: 0.68, cy: 0.54, h: 0.74, rx: 0, ry: -0.08, rz: 0 }],
  [0.38, { cx: 0.67, cy: 0.54, h: 0.72, rx: 0.04, ry: 0.5, rz: -0.02 }],
  [0.5, { cx: 0.67, cy: 0.54, h: 0.74, rx: 0, ry: 0.1, rz: 0 }],
  [0.69, { cx: 0.68, cy: 0.54, h: 0.72, rx: 0.05, ry: -0.5, rz: 0.03 }],
  [0.82, { cx: 0.68, cy: 0.54, h: 0.74, rx: 0.02, ry: -0.2, rz: -0.035 }],
  [1, { cx: 0.68, cy: 0.54, h: 0.74, rx: 0.02, ry: -0.2, rz: -0.035 }],
]
const NARROW: Key[] = [
  [0, { cx: 0.5, cy: 0.44, h: 0.42, rx: 0.2, ry: -0.7, rz: 0.08 }],
  [0.12, { cx: 0.5, cy: 0.37, h: 0.48, rx: 0.02, ry: -0.14, rz: 0 }],
  [0.3, { cx: 0.5, cy: 0.37, h: 0.5, rx: 0, ry: -0.06, rz: 0 }],
  [0.38, { cx: 0.5, cy: 0.37, h: 0.48, rx: 0.04, ry: 0.45, rz: 0 }],
  [0.5, { cx: 0.5, cy: 0.37, h: 0.5, rx: 0, ry: 0.08, rz: 0 }],
  [0.69, { cx: 0.5, cy: 0.37, h: 0.48, rx: 0.04, ry: -0.45, rz: 0.02 }],
  [0.82, { cx: 0.5, cy: 0.37, h: 0.5, rx: 0.02, ry: -0.16, rz: -0.03 }],
  [1, { cx: 0.5, cy: 0.37, h: 0.5, rx: 0.02, ry: -0.16, rz: -0.03 }],
]
export const storyPose = (progress: number, narrow: boolean) => interpolate(narrow ? NARROW : WIDE, progress)
