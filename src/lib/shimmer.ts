/**
 * Pure math for the completion shimmer effect (see Cell.vue
 * @keyframes shimmer-gold + .cell__hl-complete styles).
 *
 * Design — continuous directional gradient.
 *
 *   Each cell paints its own background-image, but the image is much
 *   wider than the cell (IMG × cell-width) so that any one moment only
 *   shows ~1/IMG of the gradient. The per-cell animation-delay is sized
 *   so that, at every wall-clock time T, cell N+1's `image-left` is
 *   exactly cell N's `image-left − 1`. That means cell N+1 picks up
 *   visually where cell N leaves off — together the cells render ONE
 *   continuous gradient band that sweeps across the line without
 *   breaking at cell boundaries.
 *
 *   The trick is the delay-step formula:
 *     step = cycle / (IMG - 1)
 *   Bigger IMG → smaller step → faster wave through the line; the
 *   gradient stops are kept narrow so the bright peak is ~half a cell
 *   wide.
 *
 *   Wave direction:
 *     - row    → L→R, shimmerIndex = col
 *     - column → T→B, shimmerIndex = row
 *     - region → ripples from the star (Chebyshev distance). Region
 *               cells aren't a line, so gradient continuity doesn't
 *               apply — the index just spaces out the per-cell phases.
 *
 *   Priority for cells in multiple completed entities: row > col >
 *   region.
 *
 * All values here must stay in lockstep with the CSS — the tests in
 * src/lib/__tests__/shimmer.test.ts assert continuity using these
 * constants, so any change to the keyframe / bg-size / animation
 * duration in Cell.vue must be mirrored here.
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
 *  (IMG − 1). This is the EXACT value that aligns adjacent cells'
 *  gradients so the band traverses cell boundaries seamlessly.
 *
 *  For IMG=11, cycle=800: step = 80ms. */
export const SHIMMER_STEP_MS = SHIMMER_CYCLE_MS / (IMG_CELLS - 1)

/** Keyframe endpoints. background-position goes from 100% (cycle 0,
 *  image-left = −(IMG−1) cell-widths, gradient off-left) to 0% (cycle
 *  100%, image-left = 0, gradient off-right). Within each cell the
 *  bright band sweeps L→R; combined with the positive per-cell delay,
 *  the band traverses the whole line L→R as one continuous wave. */
export const KEYFRAME_START_P = 100
export const KEYFRAME_END_P   = 0

// ── Per-cell shimmer offset ──────────────────────────────────────────────

/**
 * For a cell at (row, col), return the shimmer offset (number of
 * SHIMMER_STEP_MS to delay this cell's animation by).
 *
 *   - completed row    → offset = col       (wave traverses L→R)
 *   - completed column → offset = row       (wave traverses T→B)
 *   - completed region → offset = Chebyshev distance from the star
 *
 * Priority: row > col > region. A cell that's in a complete row uses
 * the row index regardless of column completion, so the gradient
 * continuity in that row isn't broken by the column's different phase.
 */
export function cellShimmerIndex(
  row: number,
  col: number,
  grid: number[][],
  completion: Completion,
): number {
  if (completion.rows.has(row)) return col
  if (completion.cols.has(col)) return row
  const regAnchor = completion.regions.get(grid[row][col])
  if (regAnchor) return Math.max(Math.abs(row - regAnchor[0]), Math.abs(col - regAnchor[1]))
  return 0
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
 * cell at the given shimmer offset, at wall-clock time tMs.
 *
 * This is a LINEAR extrapolation rather than a modulo-wrap of the
 * cycle, deliberately. It represents the "ideal" continuous wave the
 * design is meant to render, and that's the model the property tests
 * in shimmer.test.ts reason about: image-left must differ by exactly
 * −1 between adjacent cells at every time, including times before some
 * cells' animation-delay has expired.
 *
 * CSS approximates this by clamping at the 0% frame until each cell's
 * delay expires and by wrapping every cycle, so the visible gradient
 * briefly tears once per cycle as a new band enters at cell 0. The
 * lib's extrapolation hides that seam so the continuity invariant
 * holds unconditionally — what the test asserts is the design's
 * underlying motion, not the per-frame rasterisation.
 */
export function bgPositionAt(offset: number, tMs: number): number {
  const elapsed = tMs - offset * SHIMMER_STEP_MS
  const frac = elapsed / SHIMMER_CYCLE_MS
  return KEYFRAME_START_P + frac * (KEYFRAME_END_P - KEYFRAME_START_P)
}

/**
 * `image-left` in cell-width units. With container-width = 1 and
 * image-width = IMG, the CSS formula is image-left = bg-pos × (1 − IMG) / 100.
 *
 * For the gradient to read as one continuous band across the line, we
 * need imageLeftAt(offset + 1, t) − imageLeftAt(offset, t) === −1 at
 * every time t — the test "gradient continuity" pins this down.
 */
export function imageLeftAt(offset: number, tMs: number): number {
  return bgPositionAt(offset, tMs) * (1 - IMG_CELLS) / 100
}

/**
 * Bright-band position in ABSOLUTE row coordinates (where cell-col is
 * at integer screen-x = col). The band centre is at image-x = IMG/2,
 * so in container-x (within cell at given offset) it sits at
 * imageLeft + IMG/2. The "line index" parameter is the cell's position
 * along the completed line — same as shimmerIndex for the row/col
 * cases.
 */
export function bandAbsXAt(lineIndex: number, tMs: number): number {
  return lineIndex + imageLeftAt(lineIndex, tMs) + IMG_CELLS / 2
}

/** Time at which the bright band's centre passes through cell at the
 *  given shimmer offset. Used by the "wave direction" tests. */
export function bandPeakTime(offset: number): number {
  // image-left at peak = −IMG/2 + 0.5 (band centre at container-x 0.5).
  // Solve for cycle fraction: image-left = bg-pos × (1−IMG)/100.
  //   bg-pos at peak = (IMG/2 − 0.5) × 100 / (IMG − 1).
  //   For IMG=11: bg-pos = (5.5 − 0.5) × 100 / 10 = 50%.
  // Cycle fraction at peak = (KEYFRAME_START − bg-pos) / (KEYFRAME_START − KEYFRAME_END)
  const bgAtPeak = (IMG_CELLS / 2 - 0.5) * 100 / (IMG_CELLS - 1)
  const peakFrac = (KEYFRAME_START_P - bgAtPeak) / (KEYFRAME_START_P - KEYFRAME_END_P)
  return offset * SHIMMER_STEP_MS + peakFrac * SHIMMER_CYCLE_MS
}
