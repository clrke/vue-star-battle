/**
 * Solve "Kings #27" by encoding its grid and running our solver.
 *
 * Region map (8 regions for 8×8 = 1-star Star Battle):
 *   0  Rose (top-left + row 1 strip + row 2 left)
 *   1  Green (singleton at (0,2))
 *   2  Teal (top-right block)
 *   3  Purple (right-side strip)
 *   4  Lavender (3-cell L on the left)
 *   5  Orange (centre)
 *   6  Brown (lower-left)
 *   7  Sky (lower-right)
 */
import { solve } from '../src/solver/solver'

const puzzle = {
  id: 'kings-27',
  title: 'Kings #27',
  n: 8,
  grid: [
    [0, 0, 1, 2, 2, 2, 2, 2],
    [0, 0, 0, 0, 0, 3, 2, 2],
    [0, 0, 5, 5, 5, 3, 3, 2],
    [4, 4, 5, 5, 5, 3, 3, 3],
    [4, 6, 6, 6, 5, 5, 3, 3],
    [6, 6, 6, 6, 6, 5, 3, 7],
    [6, 6, 7, 7, 7, 7, 7, 7],
    [6, 6, 7, 7, 7, 7, 7, 7],
  ],
}

const sols = solve(puzzle, 5)
console.log(`Found ${sols.length} solution(s).`)
sols.forEach((sol, i) => {
  console.log(`\nSolution ${i + 1}:`)
  console.log('  Stars at:', sol.map(([r, c]) => `(row ${r + 1}, col ${c + 1})`).join(', '))
  console.log()
  // Pretty grid
  for (let r = 0; r < puzzle.n; r++) {
    let line = ''
    for (let c = 0; c < puzzle.n; c++) {
      const isStar = sol.some(([sr, sc]) => sr === r && sc === c)
      line += isStar ? ' ★ ' : ' · '
    }
    console.log('  ' + line)
  }
})
