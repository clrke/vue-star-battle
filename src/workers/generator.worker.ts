import { generatePuzzle } from '../solver/generator'
import { computeDifficulty } from '../solver/difficulty'
import type { Puzzle } from '../types/puzzle'

/**
 * Strict pure-logic generation.
 *
 * Only return puzzles with difficulty === 0 (solvable end-to-end without
 * needing the solver-fallback hint).  If the time budget runs out without
 * finding one, fail outright — the UI surfaces "Generation timed out" and
 * the user can retry.  We do NOT ship non-pure puzzles, ever.
 */
self.onmessage = (e: MessageEvent<{ n: number; timeLimit: number }>) => {
  const { n, timeLimit } = e.data
  const deadline = Date.now() + timeLimit

  // Per-attempt budget — long enough for the SA generator to find a unique
  // puzzle, short enough to allow several retries within the overall budget.
  const SUB_BUDGET = Math.max(2_000, Math.floor(timeLimit / 5))

  while (Date.now() < deadline) {
    const subDeadline = Math.min(Date.now() + SUB_BUDGET, deadline)
    const puzzle: Puzzle | null = generatePuzzle(n, subDeadline)
    if (!puzzle) continue

    const d = computeDifficulty(puzzle)
    if (d === 0) {
      puzzle.difficulty = 0
      self.postMessage({ type: 'done', puzzle })
      return
    }
    // Non-pure candidate — discard and try again.
  }

  self.postMessage({ type: 'failed' })
}
