import { describe, it, expect } from 'vitest'
import {
  computePuzzleStats,
  computeDifficulty,
  computeLookaheads,
  UNSOLVABLE_LOOKAHEADS,
} from '../difficulty'
import { puzzles } from '../../data/puzzles'

// ── UNSOLVABLE_LOOKAHEADS constant ────────────────────────────────────────────

describe('UNSOLVABLE_LOOKAHEADS', () => {
  it('is 999', () => {
    expect(UNSOLVABLE_LOOKAHEADS).toBe(999)
  })
})

// ── computePuzzleStats() ──────────────────────────────────────────────────────

describe('computePuzzleStats()', () => {

  describe('return shape', () => {
    it('returns an object with fallbacks (number), lookaheads (number), solved (boolean)', () => {
      const stats = computePuzzleStats(puzzles[0])
      expect(typeof stats.fallbacks).toBe('number')
      expect(typeof stats.lookaheads).toBe('number')
      expect(typeof stats.solved).toBe('boolean')
    })
  })

  describe('all bundled puzzles', () => {
    it('solved=true for engine-solvable bundled puzzles (lookaheads < UNSOLVABLE_LOOKAHEADS)', () => {
      // Puzzles where withStats set lookaheads < 999 had solved=true at stamp time.
      // Puzzles with lookaheads === 999 (e.g. classic-5b, classic-5c) have multiple
      // solutions; the engine can't reach 'already-solved' → solved=false is expected.
      for (const puzzle of puzzles) {
        const stats = computePuzzleStats(puzzle)
        if (puzzle.lookaheads !== undefined && puzzle.lookaheads < UNSOLVABLE_LOOKAHEADS) {
          expect(stats.solved, `${puzzle.id} should be engine-solvable`).toBe(true)
        } else {
          expect(stats.solved, `${puzzle.id} is ambiguous — solved must be false`).toBe(false)
        }
      }
    })

    it('fallbacks and lookaheads are non-negative integers', () => {
      for (const puzzle of puzzles) {
        const { fallbacks, lookaheads } = computePuzzleStats(puzzle)
        expect(fallbacks, `${puzzle.id} fallbacks`).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(fallbacks), `${puzzle.id} fallbacks is integer`).toBe(true)
        expect(lookaheads, `${puzzle.id} lookaheads`).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(lookaheads), `${puzzle.id} lookaheads is integer`).toBe(true)
      }
    })

    it('fallbacks <= lookaheads (fallbacks are a subset of lookahead-class hints)', () => {
      for (const puzzle of puzzles) {
        const { fallbacks, lookaheads } = computePuzzleStats(puzzle)
        expect(
          fallbacks,
          `${puzzle.id}: fallbacks (${fallbacks}) must be <= lookaheads (${lookaheads})`,
        ).toBeLessThanOrEqual(lookaheads)
      }
    })
  })

  describe('determinism', () => {
    it('returns identical results on repeated calls for the same puzzle', () => {
      // First 6 puzzles for speed; the invariant is structural, not puzzle-specific
      for (const puzzle of puzzles.slice(0, 6)) {
        const a = computePuzzleStats(puzzle)
        const b = computePuzzleStats(puzzle)
        expect(b.fallbacks).toBe(a.fallbacks)
        expect(b.lookaheads).toBe(a.lookaheads)
        expect(b.solved).toBe(a.solved)
      }
    })
  })

  describe('pure-logic puzzles (lookaheads === 0)', () => {
    it('there is at least one pure-logic puzzle in the bundled set', () => {
      const pureLogic = puzzles.filter(p => p.lookaheads === 0)
      expect(pureLogic.length).toBeGreaterThan(0)
    })

    it('pure-logic puzzles report 0 fallbacks and 0 lookaheads', () => {
      const pureLogic = puzzles.filter(p => p.lookaheads === 0)
      for (const puzzle of pureLogic) {
        const stats = computePuzzleStats(puzzle)
        expect(stats.lookaheads, `${puzzle.id} lookaheads`).toBe(0)
        expect(stats.fallbacks, `${puzzle.id} fallbacks`).toBe(0)
      }
    })
  })

  describe('advanced puzzles (lookaheads > 0)', () => {
    it('advanced puzzles report non-zero lookaheads', () => {
      const advanced = puzzles.filter(
        p => p.lookaheads !== undefined && p.lookaheads > 0 && p.lookaheads < UNSOLVABLE_LOOKAHEADS,
      )
      // classic-4a, classic-7c, classic-8c are known to have non-zero lookaheads
      for (const puzzle of advanced) {
        const stats = computePuzzleStats(puzzle)
        expect(stats.lookaheads, `${puzzle.id}`).toBeGreaterThan(0)
      }
    })
  })

  describe('consistency with bundled puzzle metadata', () => {
    it('matches pre-computed lookaheads field on every tagged puzzle', () => {
      const tagged = puzzles.filter(
        p => p.lookaheads !== undefined && p.lookaheads < UNSOLVABLE_LOOKAHEADS,
      )
      for (const puzzle of tagged) {
        const stats = computePuzzleStats(puzzle)
        expect(stats.lookaheads, `${puzzle.id}`).toBe(puzzle.lookaheads)
      }
    })

    it('matches pre-computed difficulty field on every tagged puzzle', () => {
      const tagged = puzzles.filter(p => p.difficulty !== undefined)
      for (const puzzle of tagged) {
        const stats = computePuzzleStats(puzzle)
        expect(stats.fallbacks, `${puzzle.id}`).toBe(puzzle.difficulty)
      }
    })
  })
})

// ── computeDifficulty() ───────────────────────────────────────────────────────

describe('computeDifficulty()', () => {
  it('equals computePuzzleStats().fallbacks for every bundled puzzle', () => {
    for (const puzzle of puzzles) {
      expect(computeDifficulty(puzzle), puzzle.id).toBe(computePuzzleStats(puzzle).fallbacks)
    }
  })

  it('returns 0 for all pure-logic puzzles', () => {
    for (const puzzle of puzzles.filter(p => p.lookaheads === 0)) {
      expect(computeDifficulty(puzzle), puzzle.id).toBe(0)
    }
  })

  it('returns a non-negative integer for every bundled puzzle', () => {
    for (const puzzle of puzzles) {
      const d = computeDifficulty(puzzle)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(d)).toBe(true)
    }
  })
})

// ── computeLookaheads() ───────────────────────────────────────────────────────

describe('computeLookaheads()', () => {
  it('equals computePuzzleStats().lookaheads when solved=true', () => {
    for (const puzzle of puzzles) {
      const stats = computePuzzleStats(puzzle)
      const la = computeLookaheads(puzzle)
      if (stats.solved) {
        expect(la, `${puzzle.id}`).toBe(stats.lookaheads)
      } else {
        expect(la, `${puzzle.id}`).toBe(UNSOLVABLE_LOOKAHEADS)
      }
    }
  })

  it('matches pre-computed lookaheads field on tagged bundled puzzles', () => {
    const tagged = puzzles.filter(
      p => p.lookaheads !== undefined && p.lookaheads < UNSOLVABLE_LOOKAHEADS,
    )
    for (const puzzle of tagged) {
      expect(computeLookaheads(puzzle), puzzle.id).toBe(puzzle.lookaheads)
    }
  })

  it('returns 0 for all pure-logic puzzles', () => {
    for (const puzzle of puzzles.filter(p => p.lookaheads === 0)) {
      expect(computeLookaheads(puzzle), puzzle.id).toBe(0)
    }
  })

  it('is always either a non-negative integer or UNSOLVABLE_LOOKAHEADS', () => {
    for (const puzzle of puzzles) {
      const la = computeLookaheads(puzzle)
      const valid = (Number.isInteger(la) && la >= 0) || la === UNSOLVABLE_LOOKAHEADS
      expect(valid, `${puzzle.id}: computeLookaheads returned ${la}`).toBe(true)
    }
  })
})
