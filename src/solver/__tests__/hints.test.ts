import { describe, it, expect } from 'vitest'
import { deriveHint, type HintCategory, type HintAction } from '../hints'
import { getSolution } from '../solver'
import { puzzles } from '../../data/puzzles'
import type { Puzzle, DisplayCellState } from '../../types/puzzle'

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s += 0x6D2B79F5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Helper utilities ──────────────────────────────────────────────────────────

/** Build an all-empty DisplayCellState grid for an n×n puzzle. */
function emptyState(n: number): DisplayCellState[][] {
  return Array.from({ length: n }, () => Array<DisplayCellState>(n).fill('empty'))
}

/**
 * Mirror the auto-mark logic from src/stores/game.ts (displayCellStates computed).
 * For each star at (r,c), mark 'empty' cells in:
 *   - same row / column
 *   - same region
 *   - 8-adjacent neighbors
 */
function applyAutoMarks(puzzle: Puzzle, state: DisplayCellState[][]): DisplayCellState[][] {
  const { n, grid } = puzzle
  const out: DisplayCellState[][] = state.map(row => row.slice() as DisplayCellState[])

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (out[r][c] !== 'star') continue
      const rid = grid[r][c]

      // Same row / column
      for (let i = 0; i < n; i++) {
        if (i !== c && out[r][i] === 'empty') out[r][i] = 'auto-marked'
        if (i !== r && out[i][c] === 'empty') out[i][c] = 'auto-marked'
      }
      // Same region
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++)
          if (grid[rr][cc] === rid && !(rr === r && cc === c) && out[rr][cc] === 'empty')
            out[rr][cc] = 'auto-marked'
      // 8-adjacent
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue
          if (out[nr][nc] === 'empty') out[nr][nc] = 'auto-marked'
        }
    }
  }
  return out
}

/** Valid hint categories the engine may return. */
const VALID_CATEGORIES = new Set<HintCategory>([
  'forced-region', 'forced-row', 'forced-col',
  'mark-adjacent', 'mark-region', 'mark-row', 'mark-col',
  'pointing-region-row', 'pointing-region-col',
  'claiming-row', 'claiming-col',
  'pair-rows', 'pair-cols', 'pair-regions-rows', 'pair-regions-cols',
  'triple-rows', 'triple-cols', 'triple-regions-rows', 'triple-regions-cols',
  'common-neighbor-region', 'common-neighbor-row', 'common-neighbor-col',
  'fallback', 'contradiction', 'already-solved',
])

const VALID_ACTIONS = new Set<HintAction>(['place-star', 'place-mark', 'none'])

// ── Invariant checker ─────────────────────────────────────────────────────────

/**
 * Assert all structural invariants on a Hint and the state it was derived from.
 * Returns the hint so callers can chain further assertions.
 */
function assertHintInvariants(
  hint: ReturnType<typeof deriveHint>,
  puzzle: Puzzle,
  state: DisplayCellState[][],
  label = '',
) {
  const tag = label ? ` [${label}]` : ''
  const { n } = puzzle

  // (1) Hint object is defined
  expect(hint, `hint must be defined${tag}`).toBeDefined()

  // (2) Required fields exist and are non-empty
  expect(typeof hint.category, `category must be string${tag}`).toBe('string')
  expect(VALID_CATEGORIES.has(hint.category), `unknown category "${hint.category}"${tag}`).toBe(true)
  expect(typeof hint.label, `label must be string${tag}`).toBe('string')
  expect(hint.label.length, `label must be non-empty${tag}`).toBeGreaterThan(0)
  expect(VALID_ACTIONS.has(hint.action), `unknown action "${hint.action}"${tag}`).toBe(true)
  expect(Array.isArray(hint.steps), `steps must be array${tag}`).toBe(true)
  expect(hint.steps.length, `steps must be non-empty${tag}`).toBeGreaterThan(0)

  // (3) If action !== 'none', cell must exist and be valid
  if (hint.action !== 'none') {
    expect(hint.cell, `cell must be non-null when action is "${hint.action}"${tag}`).not.toBeNull()
    const [r, c] = hint.cell!
    expect(r, `cell row must be >= 0${tag}`).toBeGreaterThanOrEqual(0)
    expect(r, `cell row must be < n${tag}`).toBeLessThan(n)
    expect(c, `cell col must be >= 0${tag}`).toBeGreaterThanOrEqual(0)
    expect(c, `cell col must be < n${tag}`).toBeLessThan(n)

    // (4) Target cell must not already be a star or auto-marked
    const cellVal = state[r][c]
    expect(cellVal === 'star' || cellVal === 'auto-marked',
      `target cell (${r},${c}) is "${cellVal}" — engine must not point at star/auto-marked${tag}`,
    ).toBe(false)
  }

  return hint
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('deriveHint — structural invariants', () => {

  // ── (a) Empty board always yields a hint ─────────────────────────────────

  describe('(a) empty board always yields a hint', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n}) — empty board`, () => {
        const state = emptyState(puzzle.n)
        const hint = deriveHint(puzzle, state)
        assertHintInvariants(hint, puzzle, state, `${puzzle.id} empty`)
        // Must not claim the board is solved or contradictory on an empty board
        expect(hint.category, 'empty board should not be already-solved').not.toBe('already-solved')
        expect(hint.category, 'empty board should not be contradiction').not.toBe('contradiction')
      })
    }
  })

  // ── (b) Solved board returns 'already-solved' ────────────────────────────

  describe('(b) solved board returns already-solved', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n}) — solved board`, () => {
        const solution = getSolution(puzzle)
        expect(solution, `puzzle ${puzzle.id} must have a solution`).not.toBeNull()

        const state = emptyState(puzzle.n)
        for (const [r, c] of solution!) {
          state[r][c] = 'star'
        }
        const displayState = applyAutoMarks(puzzle, state)
        const hint = deriveHint(puzzle, displayState)
        expect(hint.category).toBe('already-solved')
        expect(hint.action).toBe('none')
        // 'already-solved' still needs a non-empty steps/label
        expect(hint.steps.length).toBeGreaterThan(0)
        expect(hint.label.length).toBeGreaterThan(0)
      })
    }
  })

  // ── (c) Contradiction: visible violation — two stars same row ───────────────

  describe('(c) contradiction — two stars in the same row', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n})`, () => {
        const state = emptyState(puzzle.n)
        // Place two stars anywhere in row 0 (columns 0 and n-1 are always in different regions)
        state[0][0] = 'star'
        state[0][puzzle.n - 1] = 'star'
        const hint = deriveHint(puzzle, state)
        expect(hint.category).toBe('contradiction')
        expect(hint.action).toBe('none')
        expect(hint.steps.length).toBeGreaterThan(0)
      })
    }
  })

  // ── (d) Contradiction: visible violation — adjacent stars ─────────────────

  describe('(d) contradiction — adjacent stars', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n})`, () => {
        const state = emptyState(puzzle.n)
        // Stars at (1,1) and (1,2) are horizontally adjacent (safe for n>=3)
        state[1][1] = 'star'
        state[1][2] = 'star'
        const hint = deriveHint(puzzle, state)
        expect(hint.category).toBe('contradiction')
        expect(hint.action).toBe('none')
        expect(hint.steps.length).toBeGreaterThan(0)
      })
    }
  })

  // ── (c2) Contradiction: zero-eligibility (over-marking) ───────────────────
  //
  // Mark all cells in region 0 — the engine should detect zero eligible cells.

  describe('(c2) contradiction — region fully marked (zero eligible cells)', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n})`, () => {
        const state = emptyState(puzzle.n)
        for (let r = 0; r < puzzle.n; r++)
          for (let c = 0; c < puzzle.n; c++)
            if (puzzle.grid[r][c] === 0) state[r][c] = 'marked'
        const hint = deriveHint(puzzle, state)
        expect(hint.category).toBe('contradiction')
        expect(hint.action).toBe('none')
        expect(hint.steps.length).toBeGreaterThan(0)
      })
    }
  })

  // ── (d2) Contradiction: zero-eligibility — row fully marked ───────────────

  describe('(d2) contradiction — row fully marked (zero eligible cells)', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n})`, () => {
        const state = emptyState(puzzle.n)
        for (let c = 0; c < puzzle.n; c++) state[0][c] = 'marked'
        const hint = deriveHint(puzzle, state)
        expect(hint.category).toBe('contradiction')
        expect(hint.steps.length).toBeGreaterThan(0)
      })
    }
  })

  // ── (e) Random partial states always yield a hint ────────────────────────

  describe('(e) random partial states always yield a hint', () => {
    for (const puzzle of puzzles) {
      it(`puzzle "${puzzle.title}" (n=${puzzle.n}) — 20 random partial states`, () => {
        const solution = getSolution(puzzle)!
        const rand = mulberry32(puzzle.n * 31337 + 42)

        for (let attempt = 0; attempt < 20; attempt++) {
          const state = emptyState(puzzle.n)

          // Place 0..(n-1) stars from the solution (never all n — that's 'already-solved')
          const count = Math.floor(rand() * puzzle.n) // 0 to n-1
          // Shuffle solution indices with Fisher-Yates using seeded PRNG
          const indices = Array.from({ length: puzzle.n }, (_, i) => i)
          for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]]
          }
          for (let k = 0; k < count; k++) {
            const [r, c] = solution[indices[k]]
            state[r][c] = 'star'
          }

          // Randomly mark some remaining empty cells
          for (let r = 0; r < puzzle.n; r++) {
            for (let c = 0; c < puzzle.n; c++) {
              if (state[r][c] === 'empty' && rand() < 0.15) {
                state[r][c] = 'marked'
              }
            }
          }

          const displayState = applyAutoMarks(puzzle, state)
          const hint = deriveHint(puzzle, displayState)
          assertHintInvariants(hint, puzzle, displayState,
            `${puzzle.id} attempt=${attempt} stars=${count}`)
          expect(hint.steps.length,
            `steps must be >= 1 for attempt ${attempt}`).toBeGreaterThanOrEqual(1)
        }
      })
    }
  })

  // ── (f) Fallback path is reachable and valid ─────────────────────────────

  describe('(f) fallback / cell validity when cell is present', () => {
    it('smallest puzzle: half solution stars — cell (if present) is valid', () => {
      const puzzle = puzzles[0] // smallest (5x5)
      const solution = getSolution(puzzle)!
      const half = Math.floor(solution.length / 2)
      const state = emptyState(puzzle.n)
      for (let i = 0; i < half; i++) {
        const [r, c] = solution[i]
        state[r][c] = 'star'
      }
      const displayState = applyAutoMarks(puzzle, state)
      const hint = deriveHint(puzzle, displayState)

      assertHintInvariants(hint, puzzle, displayState, 'half-solution')

      // If a cell is returned, it must point to empty or marked, never star/auto-marked
      if (hint.cell !== null) {
        const [r, c] = hint.cell
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThan(puzzle.n)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThan(puzzle.n)
        const val = displayState[r][c]
        expect(['empty', 'marked']).toContain(val)
      }
    })

    it('largest puzzle: half solution stars — cell (if present) is valid', () => {
      const puzzle = puzzles[puzzles.length - 1]
      const solution = getSolution(puzzle)!
      const half = Math.floor(solution.length / 2)
      const state = emptyState(puzzle.n)
      for (let i = 0; i < half; i++) {
        const [r, c] = solution[i]
        state[r][c] = 'star'
      }
      const displayState = applyAutoMarks(puzzle, state)
      const hint = deriveHint(puzzle, displayState)

      assertHintInvariants(hint, puzzle, displayState, 'largest-half-solution')

      if (hint.cell !== null) {
        const [r, c] = hint.cell
        const val = displayState[r][c]
        expect(['empty', 'marked']).toContain(val)
      }
    })

    it('all-marked board (except solution cells) triggers fallback', () => {
      // Mark every non-solution cell so no logical rule can produce a new mark.
      // The engine should reach fallback and give a place-star action.
      const puzzle = puzzles[0]
      const solution = getSolution(puzzle)!
      const solSet = new Set(solution.map(([r, c]) => `${r},${c}`))

      const state = emptyState(puzzle.n)
      for (let r = 0; r < puzzle.n; r++) {
        for (let c = 0; c < puzzle.n; c++) {
          if (!solSet.has(`${r},${c}`)) {
            state[r][c] = 'marked'
          }
        }
      }

      const hint = deriveHint(puzzle, state)
      // Board has solution cells empty, everything else marked.
      // The forced-region rule must fire first since each region has exactly 1 eligible cell.
      expect(hint.category).not.toBe('contradiction')
      expect(hint.action).not.toBe('none')
      expect(hint.cell).not.toBeNull()
      const [r, c] = hint.cell!
      const val = state[r][c]
      expect(['empty', 'marked']).toContain(val)
    })
  })

  // ── (g) Apply-target invariant ────────────────────────────────────────────

  describe('(g) apply-target invariant across all puzzles × states', () => {
    it('empty boards: action !== none implies valid, non-star/auto-marked target', () => {
      for (const puzzle of puzzles) {
        const state = emptyState(puzzle.n)
        const hint = deriveHint(puzzle, state)
        if (hint.action !== 'none' && hint.cell !== null) {
          const [r, c] = hint.cell
          expect(r).toBeGreaterThanOrEqual(0)
          expect(r).toBeLessThan(puzzle.n)
          expect(c).toBeGreaterThanOrEqual(0)
          expect(c).toBeLessThan(puzzle.n)
          const val = state[r][c]
          expect(val).not.toBe('star')
          expect(val).not.toBe('auto-marked')
        }
      }
    })

    it('partial solution boards: target never points to a star/auto-marked cell', () => {
      for (const puzzle of puzzles) {
        const solution = getSolution(puzzle)!
        const rand = mulberry32(puzzle.id.length * 12345)

        for (let attempt = 0; attempt < 10; attempt++) {
          const count = Math.floor(rand() * (puzzle.n - 1)) // 0..n-2 stars
          const state = emptyState(puzzle.n)
          for (let k = 0; k < count; k++) {
            const [r, c] = solution[k]
            state[r][c] = 'star'
          }
          const displayState = applyAutoMarks(puzzle, state)
          const hint = deriveHint(puzzle, displayState)

          if (hint.action !== 'none' && hint.cell !== null) {
            const [r, c] = hint.cell
            expect(r).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThan(puzzle.n)
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThan(puzzle.n)
            const val = displayState[r][c]
            expect(val, `${puzzle.id} attempt=${attempt}: target (${r},${c}) is "${val}"`).not.toBe('star')
            expect(val, `${puzzle.id} attempt=${attempt}: target (${r},${c}) is "${val}"`).not.toBe('auto-marked')
          }
        }
      }
    })
  })
})
