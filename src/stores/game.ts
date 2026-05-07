import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Puzzle, CellState } from '../types/puzzle'
import { puzzles } from '../data/puzzles'
import { getSolution } from '../solver/solver'

export const useGameStore = defineStore('game', () => {
  const currentPuzzle = ref<Puzzle>(puzzles[0])
  const cellStates = ref<CellState[][]>([])
  const hintCell = ref<[number, number] | null>(null)
  let hintTimer: ReturnType<typeof setTimeout> | null = null

  // ── Initialisation ────────────────────────────────────────────────────────

  function initBoard(puzzle: Puzzle) {
    currentPuzzle.value = puzzle
    cellStates.value = Array.from({ length: puzzle.n }, () =>
      Array<CellState>(puzzle.n).fill('empty'),
    )
    clearHint()
  }

  function reset() {
    initBoard(currentPuzzle.value)
  }

  // ── Cell interaction ──────────────────────────────────────────────────────

  /** Cycle a cell: empty → star → marked → empty */
  function cycleCell(row: number, col: number) {
    clearHint()
    const cur = cellStates.value[row][col]
    const next: Record<CellState, CellState> = {
      empty: 'star',
      star: 'marked',
      marked: 'empty',
    }
    cellStates.value[row][col] = next[cur]
  }

  // ── Hint ──────────────────────────────────────────────────────────────────

  function clearHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null }
    hintCell.value = null
  }

  function showHint() {
    clearHint()
    const solution = getSolution(currentPuzzle.value)
    if (!solution) return

    // Find the first solution cell the player hasn't starred correctly yet
    const cell = solution.find(([r, c]) => cellStates.value[r][c] !== 'star')
    if (!cell) return

    hintCell.value = cell
    hintTimer = setTimeout(() => { hintCell.value = null }, 2000)
  }

  // ── Constraint violations ─────────────────────────────────────────────────

  /**
   * Returns a Set of "row,col" keys for cells that are part of a violation:
   *   - row/column/region with more than one star
   *   - star adjacent (incl. diagonal) to another star
   */
  const violations = computed<Set<string>>(() => {
    const n = currentPuzzle.value.n
    const grid = currentPuzzle.value.grid
    const states = cellStates.value
    const bad = new Set<string>()

    const key = (r: number, c: number) => `${r},${c}`
    const stars: [number, number][] = []

    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (states[r][c] === 'star') stars.push([r, c])

    // Row duplicates
    const rowCount = new Map<number, [number, number][]>()
    for (const [r, c] of stars) {
      if (!rowCount.has(r)) rowCount.set(r, [])
      rowCount.get(r)!.push([r, c])
    }
    for (const cells of rowCount.values())
      if (cells.length > 1) cells.forEach(([r, c]) => bad.add(key(r, c)))

    // Column duplicates
    const colCount = new Map<number, [number, number][]>()
    for (const [r, c] of stars) {
      if (!colCount.has(c)) colCount.set(c, [])
      colCount.get(c)!.push([r, c])
    }
    for (const cells of colCount.values())
      if (cells.length > 1) cells.forEach(([r, c]) => bad.add(key(r, c)))

    // Region duplicates
    const regionCount = new Map<number, [number, number][]>()
    for (const [r, c] of stars) {
      const rid = grid[r][c]
      if (!regionCount.has(rid)) regionCount.set(rid, [])
      regionCount.get(rid)!.push([r, c])
    }
    for (const cells of regionCount.values())
      if (cells.length > 1) cells.forEach(([r, c]) => bad.add(key(r, c)))

    // Adjacency (8-directional)
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const [r1, c1] = stars[i]
        const [r2, c2] = stars[j]
        if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) {
          bad.add(key(r1, c1))
          bad.add(key(r2, c2))
        }
      }
    }

    return bad
  })

  // ── Win detection ─────────────────────────────────────────────────────────

  const isSolved = computed(() => {
    const n = currentPuzzle.value.n
    const states = cellStates.value

    let starCount = 0
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (states[r][c] === 'star') starCount++

    return starCount === n && violations.value.size === 0
  })

  // Boot
  initBoard(puzzles[0])

  return {
    currentPuzzle,
    cellStates,
    violations,
    isSolved,
    hintCell,
    cycleCell,
    reset,
    initBoard,
    showHint,
  }
})
