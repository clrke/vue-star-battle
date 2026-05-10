/**
 * measure-lookaheads.ts — empirical study of how many lookahead-class hints
 * each puzzle size naturally produces, to inform the (size, max-lookaheads)
 * progression tier table.
 *
 * For each size, generate G puzzles, auto-solve with the hint engine, and
 * count how many `lookahead-mark`, `deep-lookahead-mark`, and `fallback`
 * hints fire over the solution path. Report min / median / p75 / p90 / max
 * per size.
 *
 * Run with:  npx tsx scripts/measure-lookaheads.ts
 */

import { generatePuzzle } from '../src/solver/generator.js'
import { deriveHint } from '../src/solver/hints.js'
import { applyAutoMarks } from '../src/solver/autoMarks.js'
import type { Puzzle, DisplayCellState } from '../src/types/puzzle.js'

const LOOKAHEAD_CATEGORIES = new Set([
  'lookahead-mark',
  'deep-lookahead-mark',
  'fallback',
])

function countLookaheads(puzzle: Puzzle): number | null {
  const { n } = puzzle
  const raw: DisplayCellState[][] = Array.from(
    { length: n },
    () => Array<DisplayCellState>(n).fill('empty'),
  )
  const MAX_ITER = n * n * 4
  let lookaheads = 0

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const display = applyAutoMarks(puzzle, raw)
    const hint = deriveHint(puzzle, display)
    if (hint.category === 'already-solved') return lookaheads
    if (hint.action === 'none' || hint.cell === null) return null   // stuck
    if (LOOKAHEAD_CATEGORIES.has(hint.category)) lookaheads++
    const [r, c] = hint.cell
    if (hint.action === 'place-star' && raw[r][c] === 'empty') raw[r][c] = 'star'
    else if (hint.action === 'place-mark' && raw[r][c] === 'empty') raw[r][c] = 'marked'
    else return null   // shouldn't happen on fresh play
  }
  return null   // infinite loop guard
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function main() {
  // [n, count, deadlineMs]
  const MIX: [number, number, number][] = [
    [4,  40,  3_000],
    [5,  40,  5_000],
    [6,  30, 12_000],
    [7,  20, 20_000],
    [8,  15, 30_000],
    [10, 10, 60_000],
  ]

  console.log('size | n  | min | p25 | p50 | p75 | p90 | max | mean | stuck')
  console.log('-----|----|-----|-----|-----|-----|-----|-----|------|------')

  for (const [n, count, deadlineMs] of MIX) {
    const lookaheadCounts: number[] = []
    let stuck = 0
    for (let i = 0; i < count; i++) {
      const deadline = Date.now() + deadlineMs
      const puzzle = generatePuzzle(n, deadline)
      if (!puzzle) { stuck++; continue }
      const k = countLookaheads(puzzle)
      if (k === null) { stuck++; continue }
      lookaheadCounts.push(k)
    }
    if (lookaheadCounts.length === 0) {
      console.log(`${String(n).padEnd(4)} | ${String(count).padEnd(2)} | (no successful runs)`)
      continue
    }
    const mean = lookaheadCounts.reduce((s, x) => s + x, 0) / lookaheadCounts.length
    const min = Math.min(...lookaheadCounts)
    const max = Math.max(...lookaheadCounts)
    const p25 = pct(lookaheadCounts, 25)
    const p50 = pct(lookaheadCounts, 50)
    const p75 = pct(lookaheadCounts, 75)
    const p90 = pct(lookaheadCounts, 90)
    console.log(
      `${String(n).padEnd(4)} | ${String(lookaheadCounts.length).padEnd(2)} | ` +
      `${String(min).padEnd(3)} | ${String(p25).padEnd(3)} | ${String(p50).padEnd(3)} | ` +
      `${String(p75).padEnd(3)} | ${String(p90).padEnd(3)} | ${String(max).padEnd(3)} | ` +
      `${mean.toFixed(2).padEnd(4)} | ${stuck}`,
    )
  }
}

main().catch(e => { console.error(e); process.exit(1) })
