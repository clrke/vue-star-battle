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
  const deadline = Date.now() + 90_000   // 90 s per size
  process.stdout.write(`Generating ${n}×${n} …`)
  const start = Date.now()
  const puzzle = generatePuzzle(n, deadline)
  if (!puzzle) {
    console.log(' FAILED (time limit)')
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
