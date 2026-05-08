/**
 * Generate one uniquely-solvable puzzle for each requested size and print the
 * grid as a copy-pasteable TypeScript literal.
 *
 * Usage:  npx tsx scripts/gen-bundled.ts 7 10
 */
import { generatePuzzle } from '../src/solver/generator'
import { solve } from '../src/solver/solver'

const sizes = process.argv.slice(2).map(Number).filter(n => n > 0)
if (!sizes.length) { console.error('Usage: npx tsx scripts/gen-bundled.ts <n1> [n2 ...]'); process.exit(1) }

for (const n of sizes) {
  const totalBudget = n >= 12 ? 720_000 : n >= 10 ? 180_000 : 90_000
  const subBudget   = n >= 12 ?  60_000 : n >= 10 ?  30_000 : 20_000
  const deadline    = Date.now() + totalBudget
  console.log(`Generating ${n}×${n} … (total ${totalBudget/1000}s, sub-budget ${subBudget/1000}s)`)
  const start = Date.now()

  // Retry strategy: many short SA runs beat one long stuck-in-local-minimum run.
  // Mirrors the live worker's loop so success rate stays empirical.
  let puzzle: ReturnType<typeof generatePuzzle> = null
  let attempts = 0
  while (!puzzle && Date.now() < deadline) {
    attempts++
    const subDeadline = Math.min(Date.now() + subBudget, deadline)
    puzzle = generatePuzzle(n, subDeadline)
    if (!puzzle) console.log(`  attempt ${attempts} failed in ${Date.now() - start}ms — retrying`)
  }
  if (!puzzle) {
    console.log(`  FAILED (time limit) after ${attempts} attempts, ${Date.now() - start}ms`)
    continue
  }
  const ms = Date.now() - start
  const sols = solve(puzzle, 2)
  const unique = sols.length === 1 ? '✓ unique' : `✗ ${sols.length} solutions`
  const star = sols[0]?.map(([r, c]) => `(${r},${c})`).join(' ') ?? '?'
  console.log(` done in ${ms}ms — ${unique}`)
  console.log(`  stars: ${star}`)
  console.log()
  console.log(`const puzzle${n}x${n}a: Puzzle = {`)
  console.log(`  id: 'classic-${n}a',`)
  console.log(`  title: 'Classic ${n}×${n}',`)
  console.log(`  n: ${n},`)
  console.log('  grid: [')
  for (const row of puzzle.grid) console.log(`    [${row.join(', ')}],`)
  console.log('  ],')
  console.log('}')
  console.log()
}
