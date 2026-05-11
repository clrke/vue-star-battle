/**
 * Pure math for the completion shimmer effect (see Cell.vue
 * @keyframes shimmer-gold + .cell__hl-complete styles).
 *
 * Design — continuous DIAGONAL directional gradient.
 *
 *   The gradient is tilted 25° below horizontal (CSS `linear-gradient(115deg,
 *   ...)`), so the bright band cuts across each cell as a slanted stripe.
 *   For the gradient to read as ONE continuous slice across the whole
 *   board, two conditions must hold simultaneously:
 *
 *     - horizontal continuity: between cells at the same row and adjacent
 *       columns, image-left must differ by exactly −1 cell-width.
 *     - vertical continuity: between cells at the same column and adjacent
 *       rows, image-left must differ by exactly −tan(25°) ≈ −0.466.
 *
 *   The vertical condition exists ONLY because the gradient is diagonal:
 *   the color at (image-x, image-y) depends on the projection onto the
 *   tilted axis, so a unit step down (image-y: 0→1) must be compensated
 *   by a horizontal shift of tan(tilt) to keep the projection equal.
 *
 *   Both conditions are satisfied by a single universal delay formula:
 *
 *     shimmerIndex(row, col) = col + row × tan(tilt)
 *     delay = shimmerIndex × step
 *
 *   With step = cycle / (IMG − 1). The image-left at any cell is a linear
 *   function of its (row, col), and adjacent cells in any direction land
 *   exactly the right offset apart — so the wave reads as one continuous
 *   diagonal band sweeping right-and-slightly-down across the board.
 *
 *   The formula is independent of which entity completed (row / column /
 *   region) — the universal delay produces a coherent diagonal sweep for
 *   any subset of visible cells. The `inCompleteLine` flag still gates
 *   the overlay's opacity so the wave is only visible on completed lines.
 *
 * All values here must stay in lockstep with the CSS — the tests in
 * src/lib/__tests__/shimmer.test.ts assert continuity using these
 * constants, so any change to the keyframe / bg-size / animation duration
 * / gradient angle in Cell.vue must be mirrored here.
 */

export type StarPos = [number, number]

export interface Completion {
  rows:    Map<number, StarPos>
  cols:    Map<number, StarPos>
  regions: Map<number, StarPos>
}

// ── CSS-mirrored constants ───────────────────────────────────────────────

/** Background-image width as a multiple of cell-width. Matches the
 *  `background-size: 1100% 100%` declaration on `.cell__hl-complete`. */
export const IMG_CELLS = 11

/** Total length of one sweep, ms. Matches the `animation: ... 0.8s`
 *  declaration on `.cell__hl-complete`. */
export const SHIMMER_CYCLE_MS = 800

/** Delay step per shimmerIndex unit, ms. Derived: step = cycle /
 *  (IMG − 1). For IMG=11, cycle=800: step = 80ms. */
export const SHIMMER_STEP_MS = SHIMMER_CYCLE_MS / (IMG_CELLS - 1)

/**
 * CSS gradient angle for `linear-gradient(Xdeg, …)` in Cell.vue. Must
 * be kept in lockstep with the CSS — every adjustment to the visual
 * angle of the band changes the per-cell delays needed for continuity.
 *
 *   - 90deg  → horizontal axis, no vertical delay component
 *   - 45deg  → axis pointing upper-right at 45°  (stripe goes /)
 *   - 115deg → axis pointing lower-right at 25°  (stripe goes \, mild)
 *   - 135deg → axis pointing lower-right at 45°  (stripe goes \, steep)
 */
export const SHIMMER_GRADIENT_DEG = 45

/**
 * Gradient axis tilt, in degrees from horizontal-right. Positive =
 * axis points below horizontal (toward lower-right); negative = axis
 * points above horizontal (toward upper-right). tan(tilt) is the
 * vertical-to-horizontal compensation needed for continuity across
 * horizontal cell boundaries.
 *
 *   CSS 90deg  → tilt   0° → tan = 0
 *   CSS 115deg → tilt +25° → tan ≈ +0.466
 *   CSS 135deg → tilt +45° → tan = +1
 *   CSS 45deg  → tilt −45° → tan = −1
 */
export const SHIMMER_TILT_DEG = SHIMMER_GRADIENT_DEG - 90
const TILT_RAD = SHIMMER_TILT_DEG * Math.PI / 180
const TAN_TILT = Math.tan(TILT_RAD)

/**
 * Bias subtracted from every cell's animation-delay so the effective
 * delay is comfortably negative — the CSS animation engine therefore
 * treats every cell as having been running since before puzzle-load.
 * That's the key to the "no ramp-up" trick: when the player completes
 * a line and the overlay's opacity transitions from 0 to 1, the wave
 * is already in steady state at whatever phase it happens to be at,
 * rather than re-entering from a 0 % keyframe.
 *
 * The bias must exceed (max shimmerIndex × step) for every supported
 * grid size. 80 000 ms is 100 cycles, comfortably more than the widest
 * 10 × 10 grid (max index ≈ 9 × (1 + tan(25°)) ≈ 13.2 → 13.2 × 80 ≈
 * 1.06 s). The bias cancels modulo the cycle, so the wave's relative
 * phase across cells is preserved exactly.
 */
export const SHIMMER_DELAY_BIAS_MS = 80_000

/** Keyframe endpoints. background-position goes from 100% (cycle 0,
 *  image-left = −(IMG−1) cell-widths, gradient off-left) to 0% (cycle
 *  100%, image-left = 0, gradient off-right). Within each cell the
 *  bright band sweeps L→R; combined with the positive per-cell delay,
 *  the wave traverses the whole board diagonally. */
export const KEYFRAME_START_P = 100
export const KEYFRAME_END_P   = 0

// ── Per-cell shimmer index ───────────────────────────────────────────────

/**
 * Universal shimmer index for a cell at (row, col): its position projected
 * onto the gradient axis, in cell-width units. The animation-delay is
 * this index × SHIMMER_STEP_MS (minus the bias).
 *
 * Because the formula is linear in (row, col), adjacent cells in any
 * direction land at exactly the offset along the axis that makes the
 * gradient continuous across their shared boundary:
 *
 *   - horizontal neighbour (Δcol = ±1): Δindex = ±1
 *   - vertical neighbour   (Δrow = ±1): Δindex = ±tan(tilt) ≈ ±0.466
 *
 * Note: the function ignores `grid` and `completion` — the formula is
 * the same regardless of which entity completed. `isInCompleteLine`
 * still uses completion state to decide whether to render the wave.
 */
export function cellShimmerIndex(row: number, col: number): number {
  return col + row * TAN_TILT
}

/** Whether the cell belongs to ANY completed row, column, or region. */
export function isInCompleteLine(
  row: number,
  col: number,
  grid: number[][],
  completion: Completion,
): boolean {
  return completion.rows.has(row)
      || completion.cols.has(col)
      || completion.regions.has(grid[row][col])
}

// ── Gradient state (for tests + visualization) ──────────────────────────

/**
 * `background-position` value (as the same percentage CSS sees) for a
 * cell at the given shimmer index, at wall-clock time tMs.
 *
 * This is a LINEAR extrapolation rather than a modulo-wrap of the
 * cycle, deliberately. It represents the "ideal" continuous wave the
 * design is meant to render, and that's the model the property tests
 * in shimmer.test.ts reason about. CSS approximates this with a
 * modulo-cycle wrap; the wrap is hidden in production by the opacity-
 * gated visibility — the wave only ever needs to look continuous WHEN
 * IT'S VISIBLE, which is always within a single cycle worth of
 * phases.
 */
export function bgPositionAt(shimmerIndex: number, tMs: number): number {
  const elapsed = tMs - shimmerIndex * SHIMMER_STEP_MS
  const frac = elapsed / SHIMMER_CYCLE_MS
  return KEYFRAME_START_P + frac * (KEYFRAME_END_P - KEYFRAME_START_P)
}

/**
 * `image-left` in cell-width units. With container-width = 1 and
 * image-width = IMG, the CSS formula is image-left = bg-pos × (1 − IMG) / 100.
 */
export function imageLeftAt(shimmerIndex: number, tMs: number): number {
  return bgPositionAt(shimmerIndex, tMs) * (1 - IMG_CELLS) / 100
}

/** Convenience: image-left for the cell at (row, col), at time t. */
export function imageLeftAtCell(row: number, col: number, tMs: number): number {
  return imageLeftAt(cellShimmerIndex(row, col), tMs)
}

/** Time at which the bright band's centre passes through a cell with
 *  the given shimmer index. */
export function bandPeakTime(shimmerIndex: number): number {
  // image-left at peak = −IMG/2 + 0.5 (band centre at container-x 0.5).
  const bgAtPeak = (IMG_CELLS / 2 - 0.5) * 100 / (IMG_CELLS - 1)
  const peakFrac = (KEYFRAME_START_P - bgAtPeak) / (KEYFRAME_START_P - KEYFRAME_END_P)
  return shimmerIndex * SHIMMER_STEP_MS + peakFrac * SHIMMER_CYCLE_MS
}
