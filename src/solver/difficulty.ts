import type { Puzzle, DisplayCellState } from '../types/puzzle'
import { deriveHint } from './hints'
import { applyAutoMarks } from './autoMarks'

/**
 * Run the hint engine from an empty board to completion and count how many
 * times the 'fallback' (solver-reveal) hint was needed.
 *
 * Returns 0 if the puzzle is solvable by pure logic alone, or a positive
 * integer equal to the number of cells the engine couldn't deduce logically.
 *
 * Complexity: O(n² × hint-engine-cost) per call — fast enough to run
 * synchronously after generation (< 50 ms for n ≤ 12 on a modern CPU).
 */
export function computeDifficulty(puzzle: Puzzle): number {
  const { n } = puzzle

  // Raw user state — only 'empty', 'star', 'marked' (no auto-marks)
  const raw: DisplayCellState[][] = Array.from(
    { length: n },
    () => Array<DisplayCellState>(n).fill('empty'),
  )

  let fallbacks = 0
  const MAX_ITER = n * n * 4   // safety cap; a solved n×n board needs at most n stars

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const display = applyAutoMarks(puzzle, raw)
    const hint = deriveHint(puzzle, display)

    if (hint.category === 'already-solved') break
    if (hint.action === 'none') break                       // stuck (shouldn't happen on valid puzzle)
    if (hint.cell === null) break                           // no-op categories (contradiction etc.)

    const [r, c] = hint.cell

    if (hint.action === 'place-star')  { if (raw[r][c] === 'empty') raw[r][c] = 'star' }
    else if (hint.action === 'place-mark')  { if (raw[r][c] === 'empty') raw[r][c] = 'marked' }
    else break                                              // remove-* shouldn't appear on fresh board

    if (hint.category === 'fallback') fallbacks++
  }

  return fallbacks
}
