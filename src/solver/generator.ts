import type { Puzzle } from '../types/puzzle'
import { solve } from './solver'

// ── Random valid solution ──────────────────────────────────────────────────

/** Find a random column-permutation solution (ignoring regions). */
export function findRandomSolution(n: number): number[] | null {
  const colUsed = new Uint8Array(n)
  const stars   = new Int8Array(n).fill(-1)
  const found: number[][] = []

  function search(row: number) {
    if (found.length) return
    if (row === n) { found.push(Array.from(stars)); return }
    const order = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5)
    for (const col of order) {
      if (colUsed[col]) continue
      let adj = false
      for (let r = 0; r < row; r++) {
        if (stars[r] !== -1 && Math.abs(r - row) <= 1 && Math.abs(stars[r] - col) <= 1) {
          adj = true; break
        }
      }
      if (adj) continue
      stars[row] = col; colUsed[col] = 1
      search(row + 1)
      stars[row] = -1; colUsed[col] = 0
      if (found.length) return
    }
  }

  search(0)
  return found[0] ? Array.from(found[0]) : null
}

// ── Region growth ──────────────────────────────────────────────────────────

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]

/** Balanced round-robin BFS region growth seeded at solution cells. */
function growRegions(n: number, solution: number[]): number[][] | null {
  const grid = Array.from({ length: n }, () => new Array<number>(n).fill(-1))
  for (let r = 0; r < n; r++) grid[r][solution[r]] = r

  const frontiers: [number, number][][] = Array.from({ length: n }, (_, i) => {
    const f: [number, number][] = []
    for (const [dr, dc] of DIRS) {
      const [nr, nc] = [i + dr, solution[i] + dc]
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && grid[nr][nc] === -1) f.push([nr, nc])
    }
    return f
  })

  let unassigned = n * n - n
  while (unassigned > 0) {
    let progress = false
    const order = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5)
    for (const rid of order) {
      frontiers[rid] = frontiers[rid].filter(([r, c]) => grid[r][c] === -1)
      if (!frontiers[rid].length) continue
      const idx = Math.floor(Math.random() * frontiers[rid].length)
      const [r, c] = frontiers[rid][idx]
      grid[r][c] = rid
      frontiers[rid].splice(idx, 1)
      unassigned--
      progress = true
      for (const [dr, dc] of DIRS) {
        const [nr, nc] = [r + dr, c + dc]
        if (nr >= 0 && nr < n && nc >= 0 && nc < n && grid[nr][nc] === -1
            && !frontiers[rid].some(([fr, fc]) => fr === nr && fc === nc))
          frontiers[rid].push([nr, nc])
      }
    }
    if (!progress) break
  }

  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] === -1) return null
  return grid
}

// ── Simulated-annealing region repair ─────────────────────────────────────

function regionSizes(n: number, grid: number[][]): number[] {
  const counts = new Array<number>(n).fill(0)
  for (const row of grid) for (const rid of row) counts[rid]++
  return counts
}

function connectedWithout(n: number, grid: number[][], row: number, col: number): boolean {
  const rid = grid[row][col]
  const cells: [number, number][] = []
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (grid[r][c] === rid && !(r === row && c === col)) cells.push([r, c])
  if (!cells.length) return false

  const visited = new Set([`${cells[0][0]},${cells[0][1]}`])
  const q = [cells[0]]
  while (q.length) {
    const [r, c] = q.shift()!
    for (const [dr, dc] of DIRS) {
      const [nr, nc] = [r + dr, c + dc]
      const key = `${nr},${nc}`
      if (nr >= 0 && nr < n && nc >= 0 && nc < n
          && grid[nr][nc] === rid && !(nr === row && nc === col)
          && !visited.has(key)) {
        visited.add(key); q.push([nr, nc])
      }
    }
  }
  return visited.size === cells.length
}

function boundaryMoves(
  n: number, grid: number[][], solution: number[],
  counts: number[], minSize: number, maxSize: number,
): [number, number, number, number[]][] {
  const moves: [number, number, number, number[]][] = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (solution[r] === c) continue          // never move seed cells
    const rid = grid[r][c]
    if (counts[rid] <= minSize) continue     // can't shrink this region
    const nbrs = new Set<number>()
    for (const [dr, dc] of DIRS) {
      const [nr, nc] = [r + dr, c + dc]
      if (nr >= 0 && nr < n && nc >= 0 && nc < n
          && grid[nr][nc] !== rid && counts[grid[nr][nc]] < maxSize)
        nbrs.add(grid[nr][nc])
    }
    if (nbrs.size) moves.push([r, c, rid, [...nbrs]])
  }
  return moves
}

function stub(n: number, grid: number[][]): Puzzle {
  return { id: '', title: '', n, grid }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a uniquely-solvable n×n Star Battle puzzle.
 *
 * Phase 1: fast random region growth (≤2 000 attempts).
 * Phase 2: simulated-annealing boundary repair until `deadline`.
 *
 * Returns null if no unique puzzle was found before the deadline.
 */
export function generatePuzzle(n: number, deadline: number): Puzzle | null {
  const minSize = Math.max(2, Math.floor(n * 0.45))
  const maxSize = Math.ceil(n * 2.2)

  // ── Phase 1: random growth ──
  for (let attempt = 0; attempt < 2000 && Date.now() < deadline - 300; attempt++) {
    const solution = findRandomSolution(n)
    if (!solution) continue
    const grid = growRegions(n, solution)
    if (!grid) continue
    const sizes = regionSizes(n, grid)
    if (Math.max(...sizes) > maxSize || Math.min(...sizes) < minSize) continue
    if (solve(stub(n, grid), 2).length === 1)
      return { id: `gen-${n}-${Date.now()}`, title: `${n}×${n}`, n, grid }
  }

  // ── Phase 2: SA repair ──
  const solution = findRandomSolution(n)
  if (!solution) return null
  const gridBase = growRegions(n, solution)
  if (!gridBase) return null

  const grid   = gridBase.map(r => [...r])
  const counts = regionSizes(n, grid)
  let T = 30
  let energy = solve(stub(n, grid), 3).length * 20

  while (Date.now() < deadline) {
    const moves = boundaryMoves(n, grid, solution, counts, minSize, maxSize)
    if (!moves.length) break

    const [r, c, oldRid, nbrs] = moves[Math.floor(Math.random() * moves.length)]
    const newRid = nbrs[Math.floor(Math.random() * nbrs.length)]

    if (!connectedWithout(n, grid, r, c)) continue

    grid[r][c] = newRid
    counts[oldRid]--; counts[newRid]++

    const nSols   = solve(stub(n, grid), 3).length
    const newEnergy = nSols === 1 ? 0 : nSols * 20
    const delta   = newEnergy - energy

    if (delta <= 0 || Math.random() < Math.exp(-delta / Math.max(T, 0.1))) {
      energy = newEnergy
      if (energy === 0)
        return { id: `gen-${n}-${Date.now()}`, title: `${n}×${n}`, n, grid: grid.map(r => [...r]) }
    } else {
      grid[r][c] = oldRid; counts[oldRid]++; counts[newRid]--
    }

    T *= 0.9997
  }

  return null
}
