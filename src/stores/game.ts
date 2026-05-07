import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Puzzle, CellState } from '../types/puzzle'
import { puzzles } from '../data/puzzles'
import { getSolution } from '../solver/solver'

const MAX_HISTORY = 60

export const useGameStore = defineStore('game', () => {
  const currentPuzzle = ref<Puzzle>(puzzles[0])
  const cellStates    = ref<CellState[][]>([])
  const hintCell      = ref<[number, number] | null>(null)
  const history       = ref<CellState[][][]>([])  // undo stack
  const future        = ref<CellState[][][]>([])  // redo stack

  let hintTimer: ReturnType<typeof setTimeout> | null = null

  // ── Helpers ───────────────────────────────────────────────────────────────

  function snapshot(): CellState[][] {
    return cellStates.value.map(row => [...row])
  }

  function pushHistory() {
    history.value.push(snapshot())
    if (history.value.length > MAX_HISTORY) history.value.shift()
    future.value = []
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  function initBoard(puzzle: Puzzle) {
    currentPuzzle.value = puzzle
    cellStates.value = Array.from({ length: puzzle.n }, () =>
      Array<CellState>(puzzle.n).fill('empty'),
    )
    history.value = []
    future.value  = []
    clearHint()
  }

  function reset() {
    pushHistory()
    cellStates.value = Array.from({ length: currentPuzzle.value.n }, () =>
      Array<CellState>(currentPuzzle.value.n).fill('empty'),
    )
    clearHint()
  }

  // ── Cell interaction ──────────────────────────────────────────────────────

  /**
   * Left-click: toggle star.
   * star → empty, anything else → star.
   */
  function toggleStar(row: number, col: number) {
    clearHint()
    const cur = cellStates.value[row][col]
    pushHistory()
    cellStates.value[row][col] = cur === 'star' ? 'empty' : 'star'
  }

  /**
   * Right-click: toggle mark dot.
   * Starred cells are left alone; marked ↔ empty.
   */
  function toggleMark(row: number, col: number) {
    clearHint()
    const cur = cellStates.value[row][col]
    if (cur === 'star') return
    pushHistory()
    cellStates.value[row][col] = cur === 'marked' ? 'empty' : 'marked'
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  const canUndo = computed(() => history.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  function undo() {
    if (!canUndo.value) return
    future.value.push(snapshot())
    cellStates.value = history.value.pop()!
    clearHint()
  }

  function redo() {
    if (!canRedo.value) return
    history.value.push(snapshot())
    cellStates.value = future.value.pop()!
    clearHint()
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

    const cell = solution.find(([r, c]) => cellStates.value[r][c] !== 'star')
    if (!cell) return

    hintCell.value = cell
    hintTimer = setTimeout(() => { hintCell.value = null }, 2000)
  }

  // ── Constraint violations ─────────────────────────────────────────────────

  const violations = computed<Set<string>>(() => {
    const n     = currentPuzzle.value.n
    const grid  = currentPuzzle.value.grid
    const states = cellStates.value
    const bad   = new Set<string>()
    const key   = (r: number, c: number) => `${r},${c}`
    const stars: [number, number][] = []

    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (states[r][c] === 'star') stars.push([r, c])

    const rowCount    = new Map<number, [number, number][]>()
    const colCount    = new Map<number, [number, number][]>()
    const regionCount = new Map<number, [number, number][]>()

    for (const [r, c] of stars) {
      ;(rowCount.get(r)    ?? (rowCount.set(r, []),    rowCount.get(r)!)).push([r, c])
      ;(colCount.get(c)    ?? (colCount.set(c, []),    colCount.get(c)!)).push([r, c])
      const rid = grid[r][c]
      ;(regionCount.get(rid) ?? (regionCount.set(rid, []), regionCount.get(rid)!)).push([r, c])
    }

    for (const cells of [...rowCount.values(), ...colCount.values(), ...regionCount.values()])
      if (cells.length > 1) cells.forEach(([r, c]) => bad.add(key(r, c)))

    for (let i = 0; i < stars.length; i++)
      for (let j = i + 1; j < stars.length; j++) {
        const [r1, c1] = stars[i], [r2, c2] = stars[j]
        if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) {
          bad.add(key(r1, c1)); bad.add(key(r2, c2))
        }
      }

    return bad
  })

  // ── Progress / Win ────────────────────────────────────────────────────────

  const starCount = computed(() => {
    let n = 0
    for (const row of cellStates.value)
      for (const s of row) if (s === 'star') n++
    return n
  })

  const isSolved = computed(() =>
    starCount.value === currentPuzzle.value.n && violations.value.size === 0,
  )

  // Boot
  initBoard(puzzles[0])

  return {
    currentPuzzle,
    cellStates,
    violations,
    isSolved,
    starCount,
    hintCell,
    canUndo,
    canRedo,
    toggleStar,
    toggleMark,
    undo,
    redo,
    reset,
    initBoard,
    showHint,
  }
})
