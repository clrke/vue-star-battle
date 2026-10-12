/**
 * Picks a puzzle that makes a good video: unique solution (the generator guarantees it)
 * and a DFS run with enough drama — plenty of dead ends, but not so many that the search
 * becomes a blur.
 */
import { generatePuzzle } from '../src/solver/generator'
import type { Puzzle } from '../src/types/puzzle'
import { traceDfs, type Trace } from './trace'
import { hashSeed, mulberry32 } from './rng'

/** Acceptable placement counts per board size (row-order DFS with forward checking). */
export const DRAMA: Record<number, [number, number]> = {
  6: [25, 200], 7: [35, 300], 8: [60, 450], 9: [90, 700], 10: [140, 1100],
}

export interface Selected { puzzle: Puzzle; trace: Trace; attempts: number; puzzleSeed: number }

export function selectPuzzle(seed: number, n: number, opts: { maxAttempts?: number; genMs?: number; log?: (s: string) => void } = {}): Selected {
  const [lo, hi] = DRAMA[n] ?? [n * 10, n * 120]
  const maxAttempts = opts.maxAttempts ?? 40
  let best: Selected | null = null
  let bestMiss = Infinity
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const puzzleSeed = hashSeed(seed, 'puzzle', n, attempt)
    const puzzle = generatePuzzle(n, Date.now() + (opts.genMs ?? 20_000), mulberry32(puzzleSeed))
    if (!puzzle) continue
    puzzle.id = `sb-${n}-${puzzleSeed.toString(36)}`
    puzzle.title = `${n}×${n}`
    const trace = traceDfs(puzzle, 'row')
    const p = trace.stats.placements
    const ok = p >= lo && p <= hi && trace.stats.finalRun >= 3
    opts.log?.(`  attempt ${attempt}: ${p} placements, ${trace.stats.conflicts} dead ends, final run ${trace.stats.finalRun}${ok ? '  ✓' : ''}`)
    if (ok) return { puzzle, trace, attempts: attempt + 1, puzzleSeed }
    const miss = p < lo ? (lo - p) / lo : (p - hi) / hi
    if (miss < bestMiss) { bestMiss = miss; best = { puzzle, trace, attempts: attempt + 1, puzzleSeed } }
  }
  if (!best) throw new Error(`could not generate a ${n}×${n} puzzle`)
  return best
}
