import { generatePuzzle } from '../solver/generator'
import { computePuzzleStats } from '../solver/difficulty'
import type { Puzzle } from '../types/puzzle'

/**
 * Strict pure-logic generation, optionally constrained by max lookaheads.
 *
 * Only return puzzles that:
 *   - have a unique solution (enforced by the SA generator),
 *   - are auto-solvable by the hint engine (so the player isn't stranded),
 *   - and emit at most `maxLookaheads` lookahead-class hints
 *     (lookahead-mark + deep-lookahead-mark + fallback combined) on the
 *     auto-solve path.
 *
 * If the time budget runs out without finding one, fail outright — the UI
 * surfaces "Generation timed out" and the user can retry.
 *
 * `maxLookaheads` defaults to 0 (the strictest tier) for backward compatibility.
 *
 * Optional `seed` field: if provided, Math.random is replaced with a
 * mulberry32 PRNG seeded by that value for the entire generation run.
 * Since the worker runs in isolation this is safe — it only affects this
 * worker's Math.random and has no cross-thread impact.
 */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

interface GenerateMessage {
  n: number
  timeLimit: number
  /**
   * Maximum lookahead-class hints allowed on the auto-solve path.
   *   - undefined: no cap — accept any auto-solvable puzzle. Used by the
   *                daily-puzzle path so the deterministic seed isn't
   *                rejected for being mildly lookahead-heavy.
   *   - number:    cap. Used by the level-progression path; the lookup
   *                table comes from src/types/progression.ts.
   */
  maxLookaheads?: number
  seed?: number
}

self.onmessage = (e: MessageEvent<GenerateMessage>) => {
  const { n, timeLimit, seed } = e.data
  const maxLookaheads = e.data.maxLookaheads
  const enforceCap    = typeof maxLookaheads === 'number'

  // Deterministic generation for daily puzzles — safe to set permanently in
  // this worker since it never needs to be restored (workers are single-use).
  if (seed !== undefined) Math.random = mulberry32(seed)
  const deadline = Date.now() + timeLimit

  // Per-attempt budget — long enough for the SA generator to find a unique
  // puzzle, short enough to allow several retries within the overall budget.
  const SUB_BUDGET = Math.max(2_000, Math.floor(timeLimit / 5))

  while (Date.now() < deadline) {
    const subDeadline = Math.min(Date.now() + SUB_BUDGET, deadline)
    const puzzle: Puzzle | null = generatePuzzle(n, subDeadline)
    if (!puzzle) continue

    const stats = computePuzzleStats(puzzle)
    if (!stats.solved) continue                          // engine bails on this grid — discard
    if (enforceCap && stats.lookaheads > maxLookaheads!) continue   // exceeds tier cap — discard

    puzzle.difficulty = stats.fallbacks
    puzzle.lookaheads = stats.lookaheads
    self.postMessage({ type: 'done', puzzle })
    return
  }

  self.postMessage({ type: 'failed' })
}
