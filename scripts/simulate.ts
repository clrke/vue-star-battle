/**
 * simulate.ts — auto-solve 100 generated Star Battle puzzles using the hint
 * engine and report statistics.
 *
 * Run with:  npx tsx scripts/simulate.ts
 */

import { generatePuzzle } from '../src/solver/generator.js'
import { deriveHint } from '../src/solver/hints.js'
import { applyAutoMarks } from '../src/solver/autoMarks.js'
import type { Puzzle, DisplayCellState } from '../src/types/puzzle.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyState(n: number): DisplayCellState[][] {
  return Array.from({ length: n }, () => Array<DisplayCellState>(n).fill('empty'))
}

// ── Types ──────────────────────────────────────────────────────────────────

type PlayResult = 'solved' | 'stuck' | 'engine-bug' | 'infinite-loop'

interface PuzzleRun {
  n: number
  result: PlayResult
  hintsUsed: number
  categoryCounts: Map<string, number>
  usedFallback: boolean
}

// ── Auto-play a single puzzle ──────────────────────────────────────────────

function autoPlay(puzzle: Puzzle): PuzzleRun {
  const { n } = puzzle
  const maxIter = n * n * 4

  // Raw user state — only 'empty' | 'star' | 'marked' (never auto-marked)
  const rawState: DisplayCellState[][] = emptyState(n)

  const categoryCounts = new Map<string, number>()
  let hintsUsed = 0
  let usedFallback = false
  let result: PlayResult = 'stuck'

  for (let iter = 0; iter < maxIter; iter++) {
    // Compute display state (with auto-marks) from raw state each iteration
    const displayState = applyAutoMarks(puzzle, rawState)
    const hint = deriveHint(puzzle, displayState)

    categoryCounts.set(hint.category, (categoryCounts.get(hint.category) ?? 0) + 1)

    if (hint.category === 'already-solved') {
      result = 'solved'
      break
    }

    if (hint.category === 'contradiction' || hint.category === 'wrong-mark' || hint.category === 'wrong-star') {
      // These shouldn't fire during clean auto-play
      result = 'engine-bug'
      break
    }

    if (hint.action === 'none') {
      result = 'stuck'
      break
    }

    if (hint.category === 'fallback') {
      usedFallback = true
    }

    hintsUsed++

    const [r, c] = hint.cell!
    if (hint.action === 'place-star') {
      rawState[r][c] = 'star'
    } else if (hint.action === 'place-mark') {
      rawState[r][c] = 'marked'
    }
    // 'remove-mark' / 'remove-star' shouldn't fire during clean auto-play
    // but handle defensively
    else if (hint.action === 'remove-mark') {
      rawState[r][c] = 'empty'
    } else if (hint.action === 'remove-star') {
      rawState[r][c] = 'empty'
    }

    // Continue — auto-marks are recomputed next iteration
  }

  // If we exhausted iterations without resolving
  if (result === 'stuck' && hintsUsed === maxIter) {
    result = 'infinite-loop'
  }

  return { n, result, hintsUsed, categoryCounts, usedFallback }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const wallStart = Date.now()

  // Puzzle mix: [n, count, deadlineMs]
  // Covers all sizes used in progression (4–10); bookends (4, 10) were
  // previously missing, so generation failures and hint-engine gaps at
  // those sizes went undetected.
  const MIX: [number, number, number][] = [
    [4,  20,  8000],
    [5,  30,  3000],
    [6,  30,  6000],
    [7,  30,  8000],
    [8,  10, 10000],
    [10,  5, 60000],
  ]

  const runs: PuzzleRun[] = []
  let genFailures = 0
  let puzzleIndex = 0
  const totalTarget = MIX.reduce((s, [, count]) => s + count, 0)

  for (const [n, count, deadlineMs] of MIX) {
    console.log(`\nGenerating ${count} × n=${n} puzzles (deadline ${deadlineMs}ms each)...`)

    for (let i = 0; i < count; i++) {
      puzzleIndex++
      process.stdout.write(`  [${puzzleIndex}/${totalTarget}] n=${n} generating... `)

      let puzzle: Puzzle | null = null
      for (let attempt = 0; attempt < 3 && puzzle === null; attempt++) {
        const deadline = Date.now() + deadlineMs
        puzzle = generatePuzzle(n, deadline)
      }

      if (puzzle === null) {
        genFailures++
        console.log(`FAILED (generation)`)
        continue
      }

      process.stdout.write(`playing... `)
      const run = autoPlay(puzzle)
      runs.push(run)
      console.log(`${run.result} (${run.hintsUsed} hints)`)
    }
  }

  // ── Aggregate stats ──────────────────────────────────────────────────────

  const total = runs.length
  const solved = runs.filter(r => r.result === 'solved').length
  const stuck = runs.filter(r => r.result === 'stuck').length
  const bugs = runs.filter(r => r.result === 'engine-bug').length
  const loops = runs.filter(r => r.result === 'infinite-loop').length

  // Global category histogram
  const globalCats = new Map<string, number>()
  for (const run of runs) {
    for (const [cat, cnt] of run.categoryCounts) {
      globalCats.set(cat, (globalCats.get(cat) ?? 0) + cnt)
    }
  }
  const sortedCats = [...globalCats.entries()].sort((a, b) => b[1] - a[1])

  // Fallback stats
  const fallbackPuzzles = runs.filter(r => r.usedFallback).length
  const totalFallbackHints = globalCats.get('fallback') ?? 0

  // Per-size breakdown
  const sizes = [...new Set(runs.map(r => r.n))].sort((a, b) => a - b)

  const elapsed = ((Date.now() - wallStart) / 1000).toFixed(1)

  console.log('\n' + '='.repeat(60))
  console.log('SIMULATION RESULTS')
  console.log('='.repeat(60))
  console.log(`Total puzzles attempted : ${total + genFailures}`)
  console.log(`  Generated OK          : ${total}`)
  console.log(`  Generation failures   : ${genFailures}`)
  console.log(`Solved                  : ${solved} / ${total}`)
  console.log(`Stuck                   : ${stuck}`)
  console.log(`Infinite loop           : ${loops}`)
  console.log(`Engine bugs             : ${bugs}`)
  console.log(`Wall-clock time         : ${elapsed}s`)

  console.log('\n── Per-size breakdown ──────────────────────────────────────')
  console.log(`${'n'.padEnd(4)} ${'puzzles'.padEnd(10)} ${'solved'.padEnd(10)} ${'stuck'.padEnd(8)} ${'bugs'.padEnd(8)} ${'avg hints'.padEnd(10)}`)
  for (const n of sizes) {
    const sizeRuns = runs.filter(r => r.n === n)
    const sizeSolved = sizeRuns.filter(r => r.result === 'solved').length
    const sizeStuck = sizeRuns.filter(r => r.result === 'stuck').length
    const sizeBugs = sizeRuns.filter(r => r.result === 'engine-bug').length
    const avgHints = sizeRuns.length
      ? (sizeRuns.reduce((s, r) => s + r.hintsUsed, 0) / sizeRuns.length).toFixed(1)
      : 'n/a'
    console.log(
      `${String(n).padEnd(4)} ${String(sizeRuns.length).padEnd(10)} ${String(sizeSolved).padEnd(10)} ` +
      `${String(sizeStuck).padEnd(8)} ${String(sizeBugs).padEnd(8)} ${String(avgHints).padEnd(10)}`
    )
  }

  console.log('\n── Hint category histogram (top 20) ────────────────────────')
  console.log(`${'category'.padEnd(32)} ${'count'.padEnd(8)} pct`)
  const totalHints = sortedCats.reduce((s, [, c]) => s + c, 0)
  for (const [cat, cnt] of sortedCats.slice(0, 20)) {
    const pct = totalHints > 0 ? ((cnt / totalHints) * 100).toFixed(1) : '0.0'
    console.log(`${cat.padEnd(32)} ${String(cnt).padEnd(8)} ${pct}%`)
  }

  console.log('\n── Fallback usage ──────────────────────────────────────────')
  console.log(`Puzzles needing fallback: ${fallbackPuzzles} / ${total}`)
  console.log(`Total fallback hints    : ${totalFallbackHints}`)
  console.log(`Total hints (all)       : ${totalHints}`)

  if (bugs > 0) {
    console.log('\n*** ENGINE BUGS DETECTED ***')
    console.log(`${bugs} puzzle(s) hit contradiction/wrong-mark/wrong-star during clean auto-play.`)
    console.log('This indicates a hint engine defect — review the hint logic.')
  }
  if (stuck > 0) {
    console.log(`\n*** ${stuck} PUZZLE(S) GOT STUCK ***`)
    console.log('The hint engine returned action=none before the puzzle was solved.')
    console.log('These puzzles needed a hint the engine could not provide (without fallback).')
  }
  if (loops > 0) {
    console.log(`\n*** ${loops} PUZZLE(S) HIT INFINITE LOOP CAP ***`)
  }
  if (bugs === 0 && stuck === 0 && loops === 0) {
    console.log('\nAll puzzles solved successfully with no bugs.')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
