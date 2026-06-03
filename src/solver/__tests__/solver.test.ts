import { describe, it, expect } from 'vitest'
import { solve, hasUniqueSolution, getSolution } from '../solver'
import type { Puzzle } from '../../types/puzzle'
import { puzzles } from '../../data/puzzles'

// ── Hand-constructed test puzzles ─────────────────────────────────────────────

/**
 * 2×2 puzzle — no valid solution exists.
 *
 * With n=2, any star at (0,c) forces the row-1 star into the only remaining
 * column, but those two cells are always 8-diagonally adjacent:
 *   (0,0)→(1,1) and (0,1)→(1,0) are both diagonal neighbours.
 * Result: 0 solutions.
 */
const NO_SOLUTION_PUZZLE: Puzzle = {
  id: 'test-no-solution',
  title: 'Test: No Solution (2×2)',
  n: 2,
  grid: [
    [0, 1],
    [0, 1],
  ],
}

/**
 * 4×4 puzzle with exactly 2 valid solutions.
 *
 * Regions are symmetric 2×2 blocks:
 *   [0 0 1 1]
 *   [0 0 1 1]
 *   [2 2 3 3]
 *   [2 2 3 3]
 *
 * Solution A: (0,1) (1,3) (2,0) (3,2)   ← rows 0–3, all non-adjacent
 * Solution B: (0,2) (1,0) (2,3) (3,1)   ← rows 0–3, all non-adjacent
 *
 * (Verified by exhaustive hand-trace of the backtracking search tree.)
 */
const MULTI_SOLUTION_PUZZLE: Puzzle = {
  id: 'test-multi-solution',
  title: 'Test: Multi Solution (4×4)',
  n: 4,
  grid: [
    [0, 0, 1, 1],
    [0, 0, 1, 1],
    [2, 2, 3, 3],
    [2, 2, 3, 3],
  ],
}

// ── Solution validity helper ──────────────────────────────────────────────────

function assertValidSolution(sol: [number, number][], puzzle: Puzzle): void {
  const { n, grid } = puzzle
  expect(sol).toHaveLength(n)

  const usedRows    = new Set<number>()
  const usedCols    = new Set<number>()
  const usedRegions = new Set<number>()

  for (const [r, c] of sol) {
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(n)
    expect(c).toBeGreaterThanOrEqual(0)
    expect(c).toBeLessThan(n)

    expect(usedRows.has(r),    `row ${r} appears more than once`   ).toBe(false)
    expect(usedCols.has(c),    `col ${c} appears more than once`   ).toBe(false)
    const rid = grid[r][c]
    expect(usedRegions.has(rid), `region ${rid} appears more than once`).toBe(false)

    usedRows.add(r)
    usedCols.add(c)
    usedRegions.add(rid)
  }

  // No two stars may be 8-directionally adjacent
  for (let i = 0; i < sol.length; i++) {
    for (let j = i + 1; j < sol.length; j++) {
      const [r1, c1] = sol[i]
      const [r2, c2] = sol[j]
      expect(
        Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1,
        `stars at (${r1},${c1}) and (${r2},${c2}) are 8-adjacent`,
      ).toBe(false)
    }
  }
}

// ── solve() ───────────────────────────────────────────────────────────────────

describe('solve()', () => {

  describe('bundled puzzles — at least 1 valid solution', () => {
    for (const puzzle of puzzles) {
      it(`"${puzzle.title}" (n=${puzzle.n}) has at least 1 valid solution`, () => {
        const sols = solve(puzzle, 1)
        expect(sols.length).toBeGreaterThanOrEqual(1)
        assertValidSolution(sols[0], puzzle)
      })
    }
  })

  describe('bundled puzzles — uniqueness for engine-solvable subset', () => {
    // Puzzles tagged with lookaheads < UNSOLVABLE_LOOKAHEADS went through withStats
    // with solved=true, which means computePuzzleStats reached 'already-solved'.
    // For those the solver must confirm exactly 1 solution.
    const UNSOLVABLE = 999
    const unique = puzzles.filter(
      p => p.lookaheads !== undefined && p.lookaheads < UNSOLVABLE,
    )
    for (const puzzle of unique) {
      it(`"${puzzle.title}" (n=${puzzle.n}) has exactly 1 solution`, () => {
        const sols = solve(puzzle, 2)
        expect(sols).toHaveLength(1)
        assertValidSolution(sols[0], puzzle)
      })
    }
  })

  describe('no-solution puzzle', () => {
    it('returns [] for the 2×2 no-solution puzzle', () => {
      expect(solve(NO_SOLUTION_PUZZLE)).toHaveLength(0)
    })

    it('returns [] even when limit=1', () => {
      expect(solve(NO_SOLUTION_PUZZLE, 1)).toHaveLength(0)
    })
  })

  describe('multi-solution puzzle', () => {
    it('finds exactly 2 solutions when limit=2', () => {
      const sols = solve(MULTI_SOLUTION_PUZZLE, 2)
      expect(sols).toHaveLength(2)
      for (const sol of sols) assertValidSolution(sol, MULTI_SOLUTION_PUZZLE)
    })

    it('finds both known solutions', () => {
      const sols = solve(MULTI_SOLUTION_PUZZLE, 2)
      const keys = sols.map(s => s.map(([r, c]) => `${r},${c}`).join(';'))
      expect(keys).toContain('0,1;1,3;2,0;3,2')   // Solution A
      expect(keys).toContain('0,2;1,0;2,3;3,1')   // Solution B
    })

    it('stops at limit=1 and returns exactly 1 valid solution', () => {
      const sols = solve(MULTI_SOLUTION_PUZZLE, 1)
      expect(sols).toHaveLength(1)
      assertValidSolution(sols[0], MULTI_SOLUTION_PUZZLE)
    })

    it('returns 2 solutions even with an excess limit', () => {
      expect(solve(MULTI_SOLUTION_PUZZLE, 10)).toHaveLength(2)
    })
  })

  describe('limit parameter', () => {
    it('default limit=2 returns 2 solutions for the multi-solution puzzle', () => {
      expect(solve(MULTI_SOLUTION_PUZZLE)).toHaveLength(2)
    })

    it('limit=0 short-circuits immediately and returns []', () => {
      // The solver exits before any search: solutions.length (0) >= limit (0)
      expect(solve(puzzles[0], 0)).toHaveLength(0)
    })

    it('limit=1 on a valid puzzle returns exactly 1 solution', () => {
      for (const puzzle of puzzles) {
        expect(solve(puzzle, 1)).toHaveLength(1)
      }
    })
  })

  describe('solution structure invariants', () => {
    it('each solution contains exactly n [row, col] pairs', () => {
      for (const puzzle of puzzles) {
        const [sol] = solve(puzzle, 1)
        expect(sol).toHaveLength(puzzle.n)
        for (const entry of sol) {
          expect(Array.isArray(entry)).toBe(true)
          expect(entry).toHaveLength(2)
          expect(typeof entry[0]).toBe('number')
          expect(typeof entry[1]).toBe('number')
        }
      }
    })

    it('solutions are returned in row-ascending order', () => {
      for (const puzzle of puzzles) {
        const [sol] = solve(puzzle, 1)
        for (let i = 1; i < sol.length; i++) {
          expect(sol[i][0]).toBeGreaterThan(sol[i - 1][0])
        }
      }
    })

    it('every row 0..n-1 appears exactly once in the solution', () => {
      for (const puzzle of puzzles) {
        const [sol] = solve(puzzle, 1)
        const rows = sol.map(([r]) => r).sort((a, b) => a - b)
        expect(rows).toEqual(Array.from({ length: puzzle.n }, (_, i) => i))
      }
    })

    it('every column 0..n-1 appears exactly once in the solution', () => {
      for (const puzzle of puzzles) {
        const [sol] = solve(puzzle, 1)
        const cols = sol.map(([, c]) => c).sort((a, b) => a - b)
        expect(cols).toEqual(Array.from({ length: puzzle.n }, (_, i) => i))
      }
    })

    it('no two stars are 8-directionally adjacent', () => {
      for (const puzzle of puzzles) {
        const [sol] = solve(puzzle, 1)
        assertValidSolution(sol, puzzle)
      }
    })
  })
})

// ── hasUniqueSolution() ───────────────────────────────────────────────────────

describe('hasUniqueSolution()', () => {
  it('returns true for every engine-solvable bundled puzzle', () => {
    // Only assert uniqueness on puzzles the hint engine can solve end-to-end.
    // Puzzles with lookaheads === UNSOLVABLE (999) are known to have multiple
    // solutions (e.g. classic-5b, classic-5c) and correctly return false here.
    const UNSOLVABLE = 999
    const unique = puzzles.filter(
      p => p.lookaheads !== undefined && p.lookaheads < UNSOLVABLE,
    )
    expect(unique.length).toBeGreaterThan(0)
    for (const puzzle of unique) {
      expect(
        hasUniqueSolution(puzzle),
        `${puzzle.id} must have a unique solution`,
      ).toBe(true)
    }
  })

  it('returns false for non-unique bundled puzzles (lookaheads === UNSOLVABLE)', () => {
    const UNSOLVABLE = 999
    const nonUnique = puzzles.filter(p => p.lookaheads === UNSOLVABLE)
    for (const puzzle of nonUnique) {
      expect(hasUniqueSolution(puzzle), `${puzzle.id} has multiple solutions`).toBe(false)
    }
  })

  it('returns false for the multi-solution puzzle', () => {
    expect(hasUniqueSolution(MULTI_SOLUTION_PUZZLE)).toBe(false)
  })

  it('returns false for the no-solution puzzle', () => {
    expect(hasUniqueSolution(NO_SOLUTION_PUZZLE)).toBe(false)
  })
})

// ── getSolution() ─────────────────────────────────────────────────────────────

describe('getSolution()', () => {
  it('returns a valid solution for every bundled puzzle', () => {
    for (const puzzle of puzzles) {
      const sol = getSolution(puzzle)
      expect(sol, `${puzzle.id} must return a non-null solution`).not.toBeNull()
      assertValidSolution(sol!, puzzle)
    }
  })

  it('returns null for the no-solution puzzle', () => {
    expect(getSolution(NO_SOLUTION_PUZZLE)).toBeNull()
  })

  it('returns one valid solution for the multi-solution puzzle', () => {
    const sol = getSolution(MULTI_SOLUTION_PUZZLE)
    expect(sol).not.toBeNull()
    assertValidSolution(sol!, MULTI_SOLUTION_PUZZLE)
  })
})
