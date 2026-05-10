import { describe, it, expect } from 'vitest'
import {
  cellShimmerIndex,
  isInCompleteLine,
  shimmerVisibilityWindow,
  stripeXFrac,
  bgPositionAt,
  SHIMMER_CYCLE_MS,
  SHIMMER_STEP_MS,
  SHIMMER_VISIBLE_START_FRAC,
  SHIMMER_VISIBLE_END_FRAC,
  KEYFRAME_START_P,
  KEYFRAME_END_P,
  type Completion,
} from '../shimmer'

// A simple 5×5 puzzle grid, region ids in [0, 4]. The actual shape of
// regions doesn't matter for shimmer math except that we know which
// region each (r, c) belongs to.
const N = 5
const SAMPLE_GRID: number[][] = [
  [0, 0, 1, 1, 1],
  [0, 0, 1, 2, 2],
  [0, 3, 3, 2, 2],
  [3, 3, 4, 4, 2],
  [3, 4, 4, 4, 2],
]

function emptyCompletion(): Completion {
  return { rows: new Map(), cols: new Map(), regions: new Map() }
}

describe('cellShimmerIndex', () => {
  it('returns 0 when the cell is in no completed line', () => {
    const c = emptyCompletion()
    expect(cellShimmerIndex(2, 2, SAMPLE_GRID, c)).toBe(0)
  })

  it('measures distance along a completed row', () => {
    // Row 1 is complete; its star is at (1, 3).
    const c = emptyCompletion()
    c.rows.set(1, [1, 3])
    // The star itself is at offset 0.
    expect(cellShimmerIndex(1, 3, SAMPLE_GRID, c)).toBe(0)
    // Each step away grows the offset by 1.
    expect(cellShimmerIndex(1, 2, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(1, 4, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(1, 0, SAMPLE_GRID, c)).toBe(3)
  })

  it('measures distance down a completed column', () => {
    const c = emptyCompletion()
    c.cols.set(2, [3, 2])
    expect(cellShimmerIndex(3, 2, SAMPLE_GRID, c)).toBe(0)
    expect(cellShimmerIndex(2, 2, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(4, 2, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(0, 2, SAMPLE_GRID, c)).toBe(3)
  })

  it('measures Chebyshev distance across a completed region', () => {
    // Region 0 is complete; its star is at (1, 1).
    // Region 0 cells per SAMPLE_GRID: (0,0)(0,1)(1,0)(1,1)(2,0).
    const c = emptyCompletion()
    c.regions.set(0, [1, 1])
    expect(cellShimmerIndex(1, 1, SAMPLE_GRID, c)).toBe(0)      // the star
    expect(cellShimmerIndex(0, 0, SAMPLE_GRID, c)).toBe(1)      // Chebyshev = max(1,1) = 1
    expect(cellShimmerIndex(0, 1, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(1, 0, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(2, 0, SAMPLE_GRID, c)).toBe(1)
  })

  it('takes the minimum distance when multiple entities overlap', () => {
    // Row 2 complete (star at (2, 4)) AND region 3 complete (star at (3, 0)).
    // Cell (2, 1) is in row 2 (dist 3) and region 3 (Chebyshev 1) — should pick 1.
    const c = emptyCompletion()
    c.rows.set(2, [2, 4])
    c.regions.set(3, [3, 0])
    expect(cellShimmerIndex(2, 1, SAMPLE_GRID, c)).toBe(1)
  })

  it('always assigns offset 0 to the cell that holds the satisfying star', () => {
    // Whichever entity completes, the star anchor is at distance 0 from
    // itself by all three metrics — so the ripple visibly originates
    // there.
    for (const [r, c] of [[0, 0], [1, 3], [3, 2], [4, 4]]) {
      const comp = emptyCompletion()
      comp.rows.set(r, [r, c])
      comp.cols.set(c, [r, c])
      comp.regions.set(SAMPLE_GRID[r][c], [r, c])
      expect(cellShimmerIndex(r, c, SAMPLE_GRID, comp)).toBe(0)
    }
  })
})

describe('isInCompleteLine', () => {
  it('returns true if any contributing entity is complete', () => {
    const c = emptyCompletion()
    c.rows.set(2, [2, 4])
    expect(isInCompleteLine(2, 0, SAMPLE_GRID, c)).toBe(true)
    expect(isInCompleteLine(0, 0, SAMPLE_GRID, c)).toBe(false)
  })
})

// ── Wave direction ──────────────────────────────────────────────────────

describe('wave direction', () => {
  /**
   * The star (offset 0) should see the bright stripe FIRST. Adjacent cells
   * (offset 1) should see it later. Far cells should see it last. This is
   * the natural "ripple emanates outward from the placed move" feeling.
   *
   * With positive animation-delay (= offset × SHIMMER_STEP_MS) and a
   * keyframe that sweeps the bright stripe through the cell, the cell's
   * stripe-at-center moment is at delay + cycle/2. So time-to-centre is
   * monotonically increasing with offset.
   */
  it('the bright stripe reaches each cell later, the further it sits from the star', () => {
    const offsets = [0, 1, 2, 3, 4]
    const timesToCentre = offsets.map(off => shimmerVisibilityWindow(off))
      .map(w => (w.start + w.end) / 2)
    for (let i = 1; i < timesToCentre.length; i++) {
      expect(timesToCentre[i],
        `centre time at offset ${offsets[i]} must be later than at offset ${offsets[i - 1]}`,
      ).toBeGreaterThan(timesToCentre[i - 1])
    }
  })

  it('within each cell, the bright stripe sweeps left → right over time', () => {
    // Sample the stripe x-position at evenly spaced times inside the
    // first cell's visible window. Each successive sample should be at
    // a strictly larger x — left-to-right motion within the cell.
    const window = shimmerVisibilityWindow(0)
    const samples = 10
    const xs: number[] = []
    for (let i = 0; i <= samples; i++) {
      const t = window.start + (window.end - window.start) * (i / samples)
      xs.push(stripeXFrac(0, t))
    }
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i],
        `stripe x must increase L→R; got x[${i - 1}]=${xs[i - 1].toFixed(3)} x[${i}]=${xs[i].toFixed(3)}`,
      ).toBeGreaterThanOrEqual(xs[i - 1])
    }
  })

  it('stripe enters near x = 0 at start of visible window and exits near x = 1 at end', () => {
    const w = shimmerVisibilityWindow(0)
    expect(stripeXFrac(0, w.start)).toBeCloseTo(0, 5)
    expect(stripeXFrac(0, w.end)).toBeCloseTo(1, 5)
  })
})

// ── Wave continuity ─────────────────────────────────────────────────────

describe('wave continuity', () => {
  /**
   * For the wave to "connect" across cells, two consecutive cells (offset
   * differs by 1) must have overlapping visibility windows — otherwise
   * the eye sees a gap.
   *
   * Concretely: cell d's window ends at d×STEP + END_FRAC×CYCLE; cell d+1's
   * window starts at (d+1)×STEP + START_FRAC×CYCLE. Overlap requires:
   *   d×STEP + END_FRAC×CYCLE  >  (d+1)×STEP + START_FRAC×CYCLE
   *   (END_FRAC − START_FRAC)×CYCLE  >  STEP
   *   visible-span > step
   */
  it('adjacent cells have overlapping visibility windows', () => {
    const w0 = shimmerVisibilityWindow(0)
    const w1 = shimmerVisibilityWindow(1)
    const overlap = w0.end - w1.start
    expect(overlap,
      `expected w0=[${w0.start},${w0.end}] and w1=[${w1.start},${w1.end}] to overlap`,
    ).toBeGreaterThan(0)
  })

  it('the overlap is at least the step duration (so the wave is dense, not strobing)', () => {
    // If overlap < STEP, the wave has visible gaps as it crosses cell
    // boundaries. We want overlap ≥ STEP so by the time one cell's
    // stripe is exiting, the next one's is already meaningfully visible.
    const w0 = shimmerVisibilityWindow(0)
    const w1 = shimmerVisibilityWindow(1)
    const overlap = w0.end - w1.start
    expect(overlap).toBeGreaterThanOrEqual(SHIMMER_STEP_MS)
  })

  it('the wave does not stall: visible span exceeds the step', () => {
    const visibleSpan = (SHIMMER_VISIBLE_END_FRAC - SHIMMER_VISIBLE_START_FRAC) * SHIMMER_CYCLE_MS
    expect(visibleSpan).toBeGreaterThan(SHIMMER_STEP_MS)
  })

  it('every neighbouring pair (offsets 0..9) overlaps', () => {
    for (let d = 0; d < 9; d++) {
      const wA = shimmerVisibilityWindow(d)
      const wB = shimmerVisibilityWindow(d + 1)
      expect(wA.end,
        `pair (${d}, ${d + 1}) has no overlap: wA=[${wA.start},${wA.end}] wB=[${wB.start},${wB.end}]`,
      ).toBeGreaterThan(wB.start)
    }
  })
})

// ── CSS / math consistency ──────────────────────────────────────────────

describe('CSS-mirrored constants', () => {
  it('cycle and step are positive', () => {
    expect(SHIMMER_CYCLE_MS).toBeGreaterThan(0)
    expect(SHIMMER_STEP_MS).toBeGreaterThan(0)
  })

  it('visible window fractions are within [0, 1] and ordered', () => {
    expect(SHIMMER_VISIBLE_START_FRAC).toBeGreaterThanOrEqual(0)
    expect(SHIMMER_VISIBLE_END_FRAC).toBeLessThanOrEqual(1)
    expect(SHIMMER_VISIBLE_END_FRAC).toBeGreaterThan(SHIMMER_VISIBLE_START_FRAC)
  })

  it('keyframes sweep from offscreen-left to offscreen-right (so stripe goes L→R)', () => {
    // KEYFRAME_START_P should place the stripe just OFF-SCREEN LEFT, and
    // KEYFRAME_END_P should place it just OFF-SCREEN RIGHT.
    expect(stripeXFrac(0, 0)).toBeLessThan(0)                          // off left at t=0
    expect(stripeXFrac(0, SHIMMER_CYCLE_MS - 0.001)).toBeGreaterThan(1) // off right at t≈end
    // And consistency check: bgPositionAt(0, 0) = KEYFRAME_START_P,
    // bgPositionAt(0, CYCLE) wraps back to KEYFRAME_START_P (since the
    // animation is `infinite`, but at the very end of one cycle the
    // value approaches KEYFRAME_END_P).
    expect(bgPositionAt(0, 0)).toBeCloseTo(KEYFRAME_START_P, 5)
    expect(bgPositionAt(0, SHIMMER_CYCLE_MS - 0.001)).toBeCloseTo(KEYFRAME_END_P, 1)
  })
})
