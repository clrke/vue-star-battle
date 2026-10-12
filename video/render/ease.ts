export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
export const easeInCubic = (x: number) => Math.pow(clamp01(x), 3)
export const easeInOutCubic = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
/** Overshoots past 1 then settles — the "pop" in every star placement. */
export const easeOutBack = (x: number, s = 1.9) => {
  const t = clamp01(x) - 1
  return 1 + (s + 1) * t * t * t + s * t * t
}
/** 0 → 1 → 0 bump over [0, 1]. */
export const bump = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x))
