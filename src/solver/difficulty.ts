import type { Puzzle, DisplayCellState } from '../types/puzzle'
import { deriveHint } from './hints'
import { applyAutoMarks } from './autoMarks'

export interface PuzzleStats {
  /**
   * Number of solver-fallback hints emitted on the auto-solve path.
   * 0 = the engine never gave up and reached a solution. Higher = more
   * "leaps of faith" the player would have to take.
   */
  fallbacks: number
  /**
   * Combined count of lookahead-class hints over the auto-solve path:
   *   - lookahead-mark         (1-step hypothetical contradiction)
   *   - deep-lookahead-mark    (multi-step propagation contradiction)
   *   - fallback               (no logical rule fires; player must guess)
   *
   * 0 means the puzzle is solvable using only direct deductions
   * (forced-region/row/col, mark-adjacent, pointing/claiming, pair-confinement,
   *  squeeze, fish, etc.) — what we call "pure logic".
   */
  lookaheads: number
  /**
   * True iff auto-play reached `already-solved` without bailing on an
   * action='none' hint. False means the engine eventually got stuck and
   * couldn't suggest a concrete next move (the puzzle then needs a guess
   * or an even more advanced technique than the engine implements).
   */
  solved: boolean
}

/** Sentinel for puzzles the engine couldn't auto-solve. Anything above any
 *  realistic tier cap, so they're excluded from low-tier filters. */
export const UNSOLVABLE_LOOKAHEADS = 999

const LOOKAHEAD_CATEGORIES = new Set([
  'lookahead-mark',
  'deep-lookahead-mark',
  'fallback',
])

/**
 * Run the hint engine from an empty board to completion and report
 * fallback / lookahead counts.
 *
 * Complexity: O(n² × hint-engine-cost) per call — fast enough to run
 * synchronously after generation (< 50 ms for n ≤ 12 on a modern CPU).
 */
export function computePuzzleStats(puzzle: Puzzle): PuzzleStats {
  const { n } = puzzle

  // Raw user state — only 'empty', 'star', 'marked' (no auto-marks)
  const raw: DisplayCellState[][] = Array.from(
    { length: n },
    () => Array<DisplayCellState>(n).fill('empty'),
  )

  let fallbacks = 0
  let lookaheads = 0
  let solved = false
  const MAX_ITER = n * n * 4   // safety cap

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const display = applyAutoMarks(puzzle, raw)
    const hint = deriveHint(puzzle, display)

    if (hint.category === 'already-solved') { solved = true; break }
    if (hint.action === 'none') break                       // engine bailed (e.g. fallback with no concrete cell)
    if (hint.cell === null) break                           // no-op categories (contradiction etc.)

    if (LOOKAHEAD_CATEGORIES.has(hint.category)) lookaheads++
    if (hint.category === 'fallback') fallbacks++

    const [r, c] = hint.cell

    if (hint.action === 'place-star')      { if (raw[r][c] === 'empty') raw[r][c] = 'star' }
    else if (hint.action === 'place-mark') { if (raw[r][c] === 'empty') raw[r][c] = 'marked' }
    else break                                              // remove-* shouldn't appear on fresh board
  }

  return { fallbacks, lookaheads, solved }
}

/**
 * Legacy compat: number of fallback hints needed to solve from empty,
 * mirroring the old single-number difficulty field.
 */
export function computeDifficulty(puzzle: Puzzle): number {
  return computePuzzleStats(puzzle).fallbacks
}

/**
 * Lookahead count for a puzzle, with `UNSOLVABLE_LOOKAHEADS` for puzzles the
 * engine couldn't auto-solve (so they're excluded from low-tier filters).
 */
export function computeLookaheads(puzzle: Puzzle): number {
  const s = computePuzzleStats(puzzle)
  return s.solved ? s.lookaheads : UNSOLVABLE_LOOKAHEADS
}
