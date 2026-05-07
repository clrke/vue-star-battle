/**
 * Hunt for pure-logic puzzles (difficulty === 0) at sizes 5, 6, 8 and emit
 * them as TS literals ready to paste into src/data/puzzles.ts.
 */

import { generatePuzzle } from '../src/solver/generator'
import { computeDifficulty } from '../src/solver/difficulty'

const SIZES = [4, 5, 6, 7, 8]
const PER_SIZE_BUDGET_MS = 30_000

function emit(title: string, p: ReturnType<typeof generatePuzzle>) {
  if (!p) return
  const grid = p.grid.map(row => `    [${row.join(', ')}],`).join('\n')
  console.log(`\nconst ${title}: Puzzle = {`)
  console.log(`  id: '${title}',`)
  console.log(`  title: 'Classic ${p.n}×${p.n}',`)
  console.log(`  n: ${p.n},`)
  console.log(`  grid: [`)
  console.log(grid)
  console.log(`  ],`)
  console.log(`}`)
}

for (const n of SIZES) {
  const stopAt = Date.now() + PER_SIZE_BUDGET_MS
  let attempts = 0
  let found = null
  while (Date.now() < stopAt) {
    attempts++
    const subDeadline = Math.min(Date.now() + 5_000, stopAt)
    const p = generatePuzzle(n, subDeadline)
    if (!p) continue
    const d = computeDifficulty(p)
    if (d === 0) { found = p; break }
  }
  console.error(`n=${n}: ${attempts} attempts, ${found ? 'FOUND pure puzzle' : 'no pure puzzle within budget'}`)
  if (found) emit(`puzzle${n}x${n}`, found)
}
