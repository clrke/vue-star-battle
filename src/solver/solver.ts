import type { Puzzle } from '../types/puzzle'

export type Solution = [number, number][] // list of (row, col) star positions

/**
 * Exact-cover backtracking solver for 1★ Star Battle.
 *
 * Processes rows in order. For each row it tries every column that:
 *   - hasn't had a star placed in it yet
 *   - belongs to a region that hasn't had a star placed yet
 *   - is not 8-directionally adjacent to any already-placed star
 *
 * Stops as soon as `limit` solutions are found (default 2 — enough to decide
 * uniqueness without exhausting the search space).
 *
 * Returns the list of solutions found (each is an array of [row, col] pairs
 * in row order).
 */
export function solve(puzzle: Puzzle, limit = 2): Solution[] {
  const { n, grid } = puzzle
  const solutions: Solution[] = []

  const colUsed    = new Uint8Array(n)  // colUsed[c]      = 1 if col c has a star
  const regionUsed = new Uint8Array(n)  // regionUsed[rid] = 1 if region rid has a star
  const stars      = new Int8Array(n)   // stars[r]        = col of star in row r (-1 = none)
  stars.fill(-1)

  function canPlace(row: number, col: number): boolean {
    if (colUsed[col]) return false
    if (regionUsed[grid[row][col]]) return false
    // adjacency check against all placed stars
    for (let r = 0; r < row; r++) {
      const sc = stars[r]
      if (sc !== -1 && Math.abs(r - row) <= 1 && Math.abs(sc - col) <= 1) return false
    }
    return true
  }

  function search(row: number): void {
    if (solutions.length >= limit) return

    if (row === n) {
      const sol: Solution = []
      for (let r = 0; r < n; r++) sol.push([r, stars[r]])
      solutions.push(sol)
      return
    }

    for (let col = 0; col < n; col++) {
      if (!canPlace(row, col)) continue

      stars[row] = col
      colUsed[col] = 1
      regionUsed[grid[row][col]] = 1

      search(row + 1)

      stars[row] = -1
      colUsed[col] = 0
      regionUsed[grid[row][col]] = 0

      if (solutions.length >= limit) return
    }
  }

  search(0)
  return solutions
}

/** Convenience wrappers */
export const hasUniqueSolution = (p: Puzzle): boolean => solve(p, 2).length === 1
export const getSolution       = (p: Puzzle): Solution | null => solve(p, 1)[0] ?? null
