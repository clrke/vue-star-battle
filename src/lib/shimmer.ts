/**
 * Pure math for the completion shimmer effect (see Cell.vue
 * @keyframes shimmer-gold + .cell__hl-complete styles).
 *
 * All values here must stay in lockstep with the CSS — the tests in
 * src/lib/__tests__/shimmer.test.ts assert structural properties of the
 * wave (continuity, direction) using these constants, so changes to
 * either the keyframes or background-size in Cell.vue must be mirrored
 * here.
 */

export type StarPos = [number, number]

export interface Completion {
  rows:    Map<number, StarPos>
  cols:    Map<number, StarPos>
  regions: Map<number, StarPos>
}

// ── CSS-mirrored constants ───────────────────────────────────────────────

/** Total length of one shimmer cycle, ms. Matches the `animation: ... 2.8s`
 *  declaration on `.cell__hl-complete`. */
export const SHIMMER_CYCLE_MS = 2800

/** Delay step per shimmerIndex unit, ms. Matches the inline style
 *  `animation-delay: ${shimmerIndex * 140}ms` in Cell.vue's template. */
export const SHIMMER_STEP_MS = 140

/**
 * Background image is sized 260% × 100% of the cell. The bright stripe in
 * the gradient is centered at the image's 50% mark.
 *
 * `background-position: P%` places image-left at  P × (container − image) / 100
 *                                                = −1.6 P × container-width.
 *
 * So the stripe (image-left + 130%) is at container-x = (−1.6 P + 130) × CW.
 * The stripe is visible within the cell when 0 ≤ x ≤ CW, i.e. P ∈ [18.75 %,
 * 81.25 %].
 *
 * The keyframes (see CSS below) sweep P from KEYFRAME_START_P (cycle 0%)
 * to KEYFRAME_END_P (cycle 100 %) linearly. Solving for the cycle fraction
 * that maps to each visibility endpoint gives the visible window below.
 */
export const BG_IMAGE_OVER_CELL = 2.6                  // background-size: 260%
const STRIPE_CENTER_IN_IMAGE = 0.5
// Stripe x (in cell-fraction units) = (P/100) × (1 − IMG) + STRIPE_CENTER × IMG.
// Solving for P at stripe_x = 0 (left edge) and stripe_x = 1 (right edge):
//   stripe_x = 0  →  P = (STRIPE_CENTER × IMG) / (IMG − 1) × 100
//   stripe_x = 1  →  P = (STRIPE_CENTER × IMG − 1) / (IMG − 1) × 100
// With STRIPE_CENTER = 0.5, IMG = 2.6 → P_LEFT = 81.25 %, P_RIGHT = 18.75 %.
const VISIBLE_P_LEFT  = 100 * (STRIPE_CENTER_IN_IMAGE * BG_IMAGE_OVER_CELL)         / (BG_IMAGE_OVER_CELL - 1)
const VISIBLE_P_RIGHT = 100 * (STRIPE_CENTER_IN_IMAGE * BG_IMAGE_OVER_CELL - 1)     / (BG_IMAGE_OVER_CELL - 1)

/** Keyframe endpoints, as the CSS `background-position` percentage.
 *  Sweeping HIGH → LOW makes the stripe enter at the left of the cell and
 *  exit on the right (the natural L→R reading direction). The constants
 *  are picked so the visible window is centered in the cycle (18.75 %
 *  through to 81.25 %), with equal "approaching" and "departed" tails. */
export const KEYFRAME_START_P = 100   // bg-pos at cycle 0 %   (stripe just off-screen left)
export const KEYFRAME_END_P   = 0     // bg-pos at cycle 100 % (stripe just off-screen right)

/** Cycle fraction (0–1) at which the bright stripe first becomes visible
 *  (touches the cell's left edge). With the keyframe running 100% → 0%
 *  this is the cycle position where P = P_LEFT = 81.25 %, i.e.
 *  (100 − 81.25) / 100 = 0.1875. */
export const SHIMMER_VISIBLE_START_FRAC =
  (KEYFRAME_START_P - VISIBLE_P_LEFT) / (KEYFRAME_START_P - KEYFRAME_END_P)
/** Cycle fraction (0–1) at which the bright stripe last visible (touches
 *  the cell's right edge). Likewise: P = P_RIGHT = 18.75 % → 0.8125. */
export const SHIMMER_VISIBLE_END_FRAC =
  (KEYFRAME_START_P - VISIBLE_P_RIGHT) / (KEYFRAME_START_P - KEYFRAME_END_P)

// ── Per-cell shimmer offset ──────────────────────────────────────────────

/**
 * For a cell at (row, col) on the given puzzle grid, return how many
 * SHIMMER_STEP_MS the cell's animation should be delayed relative to the
 * star that originated each completed entity passing through it.
 *
 * Each completed entity contributes a distance:
 *   - completed row    → |col − starCol|              (1-D along the row)
 *   - completed column → |row − starRow|              (1-D down the column)
 *   - completed region → max(|Δrow|, |Δcol|)          (Chebyshev — square)
 *
 * The cell's offset is the MINIMUM of those distances, so it shimmers
 * when the nearest wave reaches it. Cells that aren't part of any
 * completed entity return 0 (the value is harmless when the overlay
 * isn't rendered).
 */
export function cellShimmerIndex(
  row: number,
  col: number,
  grid: number[][],
  completion: Completion,
): number {
  let best = Infinity
  const rowAnchor = completion.rows.get(row)
  if (rowAnchor) best = Math.min(best, Math.abs(col - rowAnchor[1]))
  const colAnchor = completion.cols.get(col)
  if (colAnchor) best = Math.min(best, Math.abs(row - colAnchor[0]))
  const regAnchor = completion.regions.get(grid[row][col])
  if (regAnchor) best = Math.min(best, Math.max(Math.abs(row - regAnchor[0]), Math.abs(col - regAnchor[1])))
  return Number.isFinite(best) ? best : 0
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

// ── Visibility windows ───────────────────────────────────────────────────

/**
 * Wall-clock window during which the bright stripe is visible inside a
 * cell with the given shimmer offset, on the cell's first animation cycle
 * (which is when v-if mounts the overlay element).
 *
 * The offset shifts the entire cycle by `offset * SHIMMER_STEP_MS`, so
 * the visibility window slides forward by that same amount.
 */
export function shimmerVisibilityWindow(offset: number): { start: number; end: number } {
  const delay = offset * SHIMMER_STEP_MS
  return {
    start: delay + SHIMMER_VISIBLE_START_FRAC * SHIMMER_CYCLE_MS,
    end:   delay + SHIMMER_VISIBLE_END_FRAC   * SHIMMER_CYCLE_MS,
  }
}

/**
 * Pure CSS `background-position` for a given offset at wall-clock time T,
 * assuming the cell's overlay was mounted at T = 0 (so cycle elapsed =
 * T − offset×SHIMMER_STEP_MS, clamped to ≥ 0 before any cycle starts).
 *
 * Used by the visualization script and by tests to reason about the
 * stripe's screen position at sampled timestamps without spinning up a
 * real browser.
 */
export function bgPositionAt(offset: number, tMs: number): number {
  const elapsed = tMs - offset * SHIMMER_STEP_MS
  if (elapsed < 0) return KEYFRAME_START_P
  const frac = (elapsed % SHIMMER_CYCLE_MS) / SHIMMER_CYCLE_MS
  return KEYFRAME_START_P + frac * (KEYFRAME_END_P - KEYFRAME_START_P)
}

/**
 * Stripe centre's x position WITHIN the cell, as a fraction of cell width
 * (0 = left edge, 1 = right edge). Values outside [0, 1] mean the stripe
 * is off-screen.
 */
export function stripeXFrac(offset: number, tMs: number): number {
  const p = bgPositionAt(offset, tMs)
  // image-left (frac of cell width) = (P / 100) × (1 − BG_IMAGE_OVER_CELL)
  // stripe x = image-left + STRIPE_CENTER_IN_IMAGE × BG_IMAGE_OVER_CELL
  const imageLeftFrac = (p / 100) * (1 - BG_IMAGE_OVER_CELL)
  return imageLeftFrac + STRIPE_CENTER_IN_IMAGE * BG_IMAGE_OVER_CELL
}
