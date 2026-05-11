import { describe, it, expect } from 'vitest'
import {
  cellShimmerIndex,
  isInCompleteLine,
  imageLeftAt,
  bandAbsXAt,
  bandPeakTime,
  bgPositionAt,
  IMG_CELLS,
  SHIMMER_CYCLE_MS,
  SHIMMER_STEP_MS,
  KEYFRAME_START_P,
  KEYFRAME_END_P,
  type Completion,
} from '../shimmer'

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

// ── cellShimmerIndex correctness ────────────────────────────────────────

describe('cellShimmerIndex', () => {
  it('returns 0 when the cell is in no completed line', () => {
    const c = emptyCompletion()
    expect(cellShimmerIndex(2, 2, SAMPLE_GRID, c)).toBe(0)
  })

  it('row completion: shimmerIndex = column index (so the wave sweeps L→R)', () => {
    const c = emptyCompletion()
    c.rows.set(1, [1, 3])
    for (let col = 0; col < N; col++) {
      expect(cellShimmerIndex(1, col, SAMPLE_GRID, c)).toBe(col)
    }
  })

  it('column completion: shimmerIndex = row index (so the wave sweeps T→B)', () => {
    const c = emptyCompletion()
    c.cols.set(2, [3, 2])
    for (let row = 0; row < N; row++) {
      expect(cellShimmerIndex(row, 2, SAMPLE_GRID, c)).toBe(row)
    }
  })

  it('region completion: shimmerIndex = Chebyshev distance from the star', () => {
    const c = emptyCompletion()
    c.regions.set(0, [1, 1])
    expect(cellShimmerIndex(1, 1, SAMPLE_GRID, c)).toBe(0)
    expect(cellShimmerIndex(0, 0, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(0, 1, SAMPLE_GRID, c)).toBe(1)
    expect(cellShimmerIndex(2, 0, SAMPLE_GRID, c)).toBe(1)
  })

  it('row beats column when a cell sits in both completed entities', () => {
    // Row 2 complete AND col 1 complete. (2, 1) is in both — it should
    // pick up the ROW's continuity (offset = col = 1), not the
    // column's (which would be offset = row = 2). Otherwise the row's
    // gradient would be broken at this cell.
    const c = emptyCompletion()
    c.rows.set(2, [2, 4])
    c.cols.set(1, [2, 1])
    expect(cellShimmerIndex(2, 1, SAMPLE_GRID, c)).toBe(1)
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

// ── Gradient continuity ─────────────────────────────────────────────────

describe('gradient continuity ("the shimmer connects")', () => {
  /**
   * The whole point of the directional design: for every adjacent cell
   * pair along a completed line (offset d and d+1), the second cell's
   * `image-left` is exactly the first cell's `image-left − 1` at every
   * moment. That's the algebraic condition for the gradient to render
   * as ONE continuous band rather than per-cell tiles.
   *
   * The continuity property kicks in once all cells in the line have
   * started animating — i.e. after the largest offset's delay has
   * elapsed. Before that the right-most cells are pinned to the 0%
   * keyframe by `animation-fill-mode: backwards`, which actually
   * KEEPS the wave coherent (no visible band on those cells; the band
   * is still off-left). We sample from `MAX_OFFSET × step` onward.
   */
  const MAX_OFFSET = 9
  const T_FULL_WAVE = MAX_OFFSET * SHIMMER_STEP_MS

  it('once the wave is fully started, adjacent cells have image-left differing by exactly -1', () => {
    for (let t = T_FULL_WAVE; t < T_FULL_WAVE + SHIMMER_CYCLE_MS * 2; t += 23) {
      for (let d = 0; d < MAX_OFFSET; d++) {
        const lA = imageLeftAt(d,     t)
        const lB = imageLeftAt(d + 1, t)
        expect(lB - lA,
          `at t=${t}, offsets ${d}↔${d + 1}: image-left diff = ${(lB - lA).toFixed(6)}, expected -1`,
        ).toBeCloseTo(-1, 6)
      }
    }
  })

  it('once fully started, the bright band is at the SAME absolute screen position when viewed from either side of a cell boundary', () => {
    // bandAbsXAt(d, t) gives the band's centre in row-absolute units.
    // If continuous, cell d's idea of where the band is must match cell
    // d+1's idea, even though they paint independent gradient instances.
    for (let t = T_FULL_WAVE; t < T_FULL_WAVE + SHIMMER_CYCLE_MS * 2; t += 31) {
      for (let d = 0; d < MAX_OFFSET; d++) {
        const fromA = bandAbsXAt(d,     t)
        const fromB = bandAbsXAt(d + 1, t)
        expect(fromB,
          `at t=${t}, offsets ${d}↔${d + 1}: absolute band x differs (${fromA.toFixed(4)} vs ${fromB.toFixed(4)})`,
        ).toBeCloseTo(fromA, 5)
      }
    }
  })

  it('during ramp-up the band is OFF-SCREEN for all cells (so no broken-wave is visible)', () => {
    // Continuity isn't algebraically perfect before T_FULL_WAVE — but
    // the bright band is still hidden off the left of every cell, so
    // the user only sees the gentle base gold tint. Verify that the
    // band never appears inside any cell's visible range during the
    // ramp.
    for (let t = 0; t < SHIMMER_STEP_MS; t += 10) {
      for (let d = 0; d < MAX_OFFSET; d++) {
        const bandX = bandAbsXAt(d, t) - d   // position within cell d
        // band x within [0, 1] would mean it's visibly inside that cell.
        // We allow it to be off-LEFT (negative) or off-RIGHT (>1).
        // Specifically, during ramp-up all cells should have the band
        // still approaching from off-left, never already inside.
        if (bandX >= 0 && bandX <= 1) {
          // If band IS visible in some cell during ramp-up, that cell
          // must be cell 0 (the only one animating fully).
          expect(d, `band visible inside cell ${d} during ramp-up (t=${t})`).toBeLessThanOrEqual(0)
        }
      }
    }
  })

  it('step is the algebraically-required cycle / (IMG − 1)', () => {
    expect(SHIMMER_STEP_MS).toBeCloseTo(SHIMMER_CYCLE_MS / (IMG_CELLS - 1), 9)
  })
})

// ── Wave direction ──────────────────────────────────────────────────────

describe('wave direction', () => {
  /**
   * With positive delay step, cell N+1 lags cell N. The band reaches
   * cell N first; later it reaches cell N+1. Result: the wave moves
   * along the line in the direction of increasing shimmerIndex —
   * L→R for rows, T→B for columns.
   */
  it('the band reaches each cell later, the higher its shimmer offset', () => {
    const peaks = [0, 1, 2, 3, 4].map(bandPeakTime)
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i],
        `peak at offset ${i} must be later than at offset ${i - 1}`,
      ).toBeGreaterThan(peaks[i - 1])
    }
  })

  it('the wave traverses one cell per SHIMMER_STEP_MS', () => {
    // Successive peak times differ by exactly one step.
    for (let i = 1; i < 5; i++) {
      const dt = bandPeakTime(i) - bandPeakTime(i - 1)
      expect(dt).toBeCloseTo(SHIMMER_STEP_MS, 6)
    }
  })

  it('absolute band x advances monotonically along the line as time progresses', () => {
    // Sample the band's absolute position at fixed cell (offset 4)
    // across increasing t; it must move right (increasing x) over time.
    let prev = -Infinity
    for (let t = 0; t < SHIMMER_CYCLE_MS; t += 20) {
      const x = bandAbsXAt(4, t)
      expect(x,
        `at t=${t}, band moved backward: prev=${prev.toFixed(3)} now=${x.toFixed(3)}`,
      ).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = x
    }
  })
})

// ── Speed sanity ────────────────────────────────────────────────────────

describe('speed', () => {
  it('the wave traverses an 8-cell row in under one second', () => {
    // First cell peaks at bandPeakTime(0); last cell peaks at bandPeakTime(7).
    const traversal = bandPeakTime(7) - bandPeakTime(0)
    expect(traversal).toBeLessThan(1000)
  })

  it('cycle is brisk — under 1 second', () => {
    expect(SHIMMER_CYCLE_MS).toBeLessThanOrEqual(1000)
  })
})

// ── CSS-mirror consistency ──────────────────────────────────────────────

describe('CSS-mirrored constants', () => {
  it('cycle and step are positive', () => {
    expect(SHIMMER_CYCLE_MS).toBeGreaterThan(0)
    expect(SHIMMER_STEP_MS).toBeGreaterThan(0)
  })

  it('IMG is large enough that the per-cell visible slice (1 / IMG) is small', () => {
    // We need IMG >> 1 so the bright band (only a few percent of the
    // gradient) doesn't dominate a whole cell. 4 is comfortably above
    // "tile-per-cell".
    expect(IMG_CELLS).toBeGreaterThanOrEqual(4)
  })

  it('keyframe endpoints differ (so something actually animates)', () => {
    expect(KEYFRAME_START_P).not.toBe(KEYFRAME_END_P)
  })

  it('bgPositionAt at cycle endpoints matches the keyframe values', () => {
    expect(bgPositionAt(0, 0)).toBeCloseTo(KEYFRAME_START_P, 6)
    expect(bgPositionAt(0, SHIMMER_CYCLE_MS - 0.001)).toBeCloseTo(KEYFRAME_END_P, 1)
  })
})
