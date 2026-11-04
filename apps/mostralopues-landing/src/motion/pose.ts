// Single source of truth for where the phone is during the story, shared by the WebGL
// phone and the CSS fallback. Coordinates are fractions of the sticky viewport.
export type Pose = { cx: number; cy: number; h: number; rx: number; ry: number; rz: number }
type Key = [number, Pose]

const WIDE: Key[] = [
  [0, { cx: 0.735, cy: 0.565, h: 0.78, rx: 0.08, ry: -0.5, rz: 0.07 }],
  [0.13, { cx: 0.7, cy: 0.52, h: 0.82, rx: 0.02, ry: -0.26, rz: 0.02 }],
  [0.27, { cx: 0.69, cy: 0.5, h: 0.84, rx: 0, ry: -0.12, rz: 0 }],
  [0.45, { cx: 0.68, cy: 0.5, h: 0.84, rx: 0, ry: -0.06, rz: 0 }],
  [0.53, { cx: 0.67, cy: 0.5, h: 0.82, rx: 0.04, ry: 0.42, rz: -0.02 }],
  [0.66, { cx: 0.67, cy: 0.5, h: 0.84, rx: 0, ry: 0.12, rz: 0 }],
  [0.8, { cx: 0.68, cy: 0.5, h: 0.84, rx: 0.02, ry: -0.2, rz: -0.035 }],
  [1, { cx: 0.68, cy: 0.5, h: 0.84, rx: 0.02, ry: -0.2, rz: -0.035 }],
]

const NARROW: Key[] = [
  [0, { cx: 0.5, cy: 0.46, h: 0.74, rx: 0.06, ry: -0.3, rz: -0.06 }],
  [0.13, { cx: 0.5, cy: 0.38, h: 0.48, rx: 0.02, ry: -0.12, rz: 0 }],
  [0.27, { cx: 0.5, cy: 0.38, h: 0.5, rx: 0, ry: -0.08, rz: 0 }],
  [0.45, { cx: 0.5, cy: 0.38, h: 0.5, rx: 0, ry: -0.04, rz: 0 }],
  [0.53, { cx: 0.5, cy: 0.38, h: 0.48, rx: 0.04, ry: 0.4, rz: 0 }],
  [0.66, { cx: 0.5, cy: 0.38, h: 0.5, rx: 0, ry: 0.1, rz: 0 }],
  [0.8, { cx: 0.5, cy: 0.38, h: 0.5, rx: 0.02, ry: -0.16, rz: -0.03 }],
  [1, { cx: 0.5, cy: 0.38, h: 0.5, rx: 0.02, ry: -0.16, rz: -0.03 }],
]

const smooth = (t: number) => t * t * (3 - 2 * t)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Same breakpoint as the CSS layout (Tailwind lg) so phone and text never disagree.
export const isNarrow = (width: number, _height?: number) => width < 1024

export function poseAt(progress: number, narrow: boolean): Pose {
  const keys = narrow ? NARROW : WIDE
  const p = Math.min(1, Math.max(0, progress))
  let i = 0
  while (i < keys.length - 2 && p > keys[i + 1][0]) i++
  const [p0, a] = keys[i]
  const [p1, b] = keys[i + 1]
  const t = smooth(Math.min(1, Math.max(0, (p - p0) / (p1 - p0 || 1))))
  return { cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), h: lerp(a.h, b.h, t), rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), rz: lerp(a.rz, b.rz, t) }
}

/** Which real screen is on the phone, as a float index into SCREEN_ORDER (fraction = crossfade). */
export const SCREEN_ORDER = ['home', 'product', 'catalog', 'cart'] as const
const SWITCHES = [0.31, 0.5, 0.74]
export function screenAt(progress: number): number {
  const w = 0.035
  let value = 0
  SWITCHES.forEach((at, index) => {
    value += smooth(Math.min(1, Math.max(0, (progress - (at - w)) / (2 * w))))
    void index
  })
  return value
}
