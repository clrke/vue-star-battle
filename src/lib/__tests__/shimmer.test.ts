import { describe, it, expect } from 'vitest'
import {
  cellShimmerIndex,
  isInCompleteLine,
  imageLeftAtCell,
  bandPeakTime,
  bgPositionAt,
  IMG_CELLS,
  SHIMMER_CYCLE_MS,
  SHIMMER_STEP_MS,
  SHIMMER_DELAY_BIAS_MS,
  SHIMMER_TILT_DEG,
  KEYFRAME_START_P,
  KEYFRAME_END_P,
  type Completion,
} from '../shimmer'

const TAN_TILT = Math.tan(SHIMMER_TILT_DEG * Math.PI / 180)

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

describe('cellShimmerIndex (universal diagonal projection)', () => {
  it('is zero at the top-left corner', () => {
    expect(cellShimmerIndex(0, 0)).toBeCloseTo(0, 9)
  })

  it('grows by 1 per column at the top row', () => {
    for (let col = 0; col < N; col++) {
      expect(cellShimmerIndex(0, col)).toBeCloseTo(col, 9)
    }
  })

  it('grows by tan(tilt) per row in the left column', () => {
    for (let row = 0; row < N; row++) {
      expect(cellShimmerIndex(row, 0)).toBeCloseTo(row * TAN_TILT, 9)
    }
  })

  it('is the sum of horizontal and vertical contributions', () => {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        expect(cellShimmerIndex(r, c)).toBeCloseTo(c + r * TAN_TILT, 9)
      }
    }
  })
})

// ── isInCompleteLine ────────────────────────────────────────────────────

describe('isInCompleteLine', () => {
  it('returns true if any contributing entity is complete', () => {
    const c = emptyCompletion()
    c.rows.set(2, [2, 4])
    expect(isInCompleteLine(2, 0, SAMPLE_GRID, c)).toBe(true)
    expect(isInCompleteLine(0, 0, SAMPLE_GRID, c)).toBe(false)
  })
})

// ── Gradient continuity — horizontal AND vertical AND diagonal ──────────

describe('gradient continuity ("the diagonal shimmer connects in every direction")', () => {
  /**
   * Horizontal continuity: cells at the same row, neighbouring columns
   * must have image-left differing by exactly −1 (one cell-width left)
   * at every moment. That's the algebraic condition for the gradient
   * to span the vertical boundary between them without a tear.
   */
  it('horizontally adjacent cells: image-left diff is exactly -1', () => {
    for (let t = 0; t < SHIMMER_CYCLE_MS * 2; t += 23) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N - 1; c++) {
          const lA = imageLeftAtCell(r, c,     t)
          const lB = imageLeftAtCell(r, c + 1, t)
          expect(lB - lA,
            `at t=${t}, (${r},${c})↔(${r},${c + 1}): diff=${(lB - lA).toFixed(6)}, expected -1`,
          ).toBeCloseTo(-1, 9)
        }
      }
    }
  })

  /**
   * Vertical continuity: cells at the same column, neighbouring rows
   * must have image-left differing by exactly −tan(tilt). With the
   * gradient diagonal, a unit step in image-y shifts the projection
   * by sin(tilt); compensating horizontally by tan(tilt) keeps the
   * gradient colour identical along the horizontal boundary.
   */
  it('vertically adjacent cells: image-left diff is exactly -tan(tilt)', () => {
    for (let t = 0; t < SHIMMER_CYCLE_MS * 2; t += 23) {
      for (let r = 0; r < N - 1; r++) {
        for (let c = 0; c < N; c++) {
          const lA = imageLeftAtCell(r,     c, t)
          const lB = imageLeftAtCell(r + 1, c, t)
          expect(lB - lA,
            `at t=${t}, (${r},${c})↔(${r + 1},${c}): diff=${(lB - lA).toFixed(6)}, expected ${(-TAN_TILT).toFixed(6)}`,
          ).toBeCloseTo(-TAN_TILT, 9)
        }
      }
    }
  })

  /**
   * Diagonal continuity (corner-sharing cells): the gradient values
   * must match at the corner pixel. With horizontal diff −1 and
   * vertical diff −tan(tilt), the diagonal diff is −(1 + tan(tilt)),
   * which keeps the colour matched there too.
   */
  it('diagonally adjacent cells: image-left diff is -(1 + tan(tilt))', () => {
    for (let t = 0; t < SHIMMER_CYCLE_MS * 2; t += 31) {
      for (let r = 0; r < N - 1; r++) {
        for (let c = 0; c < N - 1; c++) {
          const lA = imageLeftAtCell(r,     c,     t)
          const lB = imageLeftAtCell(r + 1, c + 1, t)
          expect(lB - lA).toBeCloseTo(-(1 + TAN_TILT), 9)
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
   * With the universal formula `delay = (col + row × tan(tilt)) × step`,
   * the band reaches each cell later, the larger its shimmer index —
   * i.e. moving right OR down advances the wave. The result is a single
   * diagonal sweep originating from the upper-left of the board.
   */
  it('the band reaches each cell later, the higher its shimmerIndex', () => {
    const cells = [[0, 0], [0, 1], [1, 0], [0, 2], [1, 1], [2, 0], [3, 4]]
    cells.sort((a, b) => cellShimmerIndex(a[0], a[1]) - cellShimmerIndex(b[0], b[1]))
    const peaks = cells.map(([r, c]) => bandPeakTime(cellShimmerIndex(r, c)))
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i]).toBeGreaterThanOrEqual(peaks[i - 1] - 1e-9)
    }
  })

  it('row sweep: cell (R, C+1) lights up SHIMMER_STEP_MS after (R, C)', () => {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N - 1; c++) {
        const dt = bandPeakTime(cellShimmerIndex(r, c + 1)) - bandPeakTime(cellShimmerIndex(r, c))
        expect(dt).toBeCloseTo(SHIMMER_STEP_MS, 6)
      }
    }
  })

  it('column sweep: cell (R+1, C) lights up tan(tilt) × SHIMMER_STEP_MS after (R, C)', () => {
    for (let r = 0; r < N - 1; r++) {
      for (let c = 0; c < N; c++) {
        const dt = bandPeakTime(cellShimmerIndex(r + 1, c)) - bandPeakTime(cellShimmerIndex(r, c))
        expect(dt).toBeCloseTo(TAN_TILT * SHIMMER_STEP_MS, 6)
      }
    }
  })
})

// ── Speed sanity ────────────────────────────────────────────────────────

describe('speed', () => {
  it('the wave traverses an 8-cell row in under one second', () => {
    const traversal = bandPeakTime(cellShimmerIndex(0, 7)) - bandPeakTime(cellShimmerIndex(0, 0))
    expect(traversal).toBeLessThan(1000)
  })

  it('cycle is brisk — under 1 second', () => {
    expect(SHIMMER_CYCLE_MS).toBeLessThanOrEqual(1000)
  })
})

// ── Always-on / no ramp-up ──────────────────────────────────────────────

describe('always-on animation (no ramp-up)', () => {
  it('the bias keeps the animation always in cycle for every supported grid size', () => {
    // With diagonal delays, the max shimmerIndex on a 10×10 grid is
    // 9 + 9 × tan(25°) ≈ 13.2 — max delay ≈ 1.06 s. The bias (80 s)
    // dwarfs this, so every effective delay is comfortably negative.
    const maxIndex = 9 + 9 * TAN_TILT
    expect(SHIMMER_DELAY_BIAS_MS).toBeGreaterThan(maxIndex * SHIMMER_STEP_MS)
  })
})

// ── CSS-mirror consistency ──────────────────────────────────────────────

describe('CSS-mirrored constants', () => {
  it('cycle and step are positive', () => {
    expect(SHIMMER_CYCLE_MS).toBeGreaterThan(0)
    expect(SHIMMER_STEP_MS).toBeGreaterThan(0)
  })

  it('tilt is between 0 and 45 degrees (mild diagonal)', () => {
    expect(SHIMMER_TILT_DEG).toBeGreaterThan(0)
    expect(SHIMMER_TILT_DEG).toBeLessThan(45)
  })

  it('keyframe endpoints differ (so something actually animates)', () => {
    expect(KEYFRAME_START_P).not.toBe(KEYFRAME_END_P)
  })

  it('bgPositionAt at cycle endpoints matches the keyframe values', () => {
    expect(bgPositionAt(0, 0)).toBeCloseTo(KEYFRAME_START_P, 6)
    expect(bgPositionAt(0, SHIMMER_CYCLE_MS - 0.001)).toBeCloseTo(KEYFRAME_END_P, 1)
  })
})
