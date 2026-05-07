import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Puzzle, CellState } from '../types/puzzle'
import { puzzles } from '../data/puzzles'
import { deriveHint, type Hint } from '../solver/hints'
import { useProgressionStore } from './progression'

const MAX_HISTORY = 60

export interface SolveResult {
  gained: number
  level: number
  leveledUp: boolean
}

export const useGameStore = defineStore('game', () => {
  const progression = useProgressionStore()

  // ── Reactive state ────────────────────────────────────────────────────────

  const currentPuzzle = ref<Puzzle>(puzzles[0])
  const cellStates    = ref<CellState[][]>([])
  const hintCell      = ref<[number, number] | null>(null)
  const lastHint      = ref<Hint | null>(null)
  const history       = ref<CellState[][][]>([])
  const future        = ref<CellState[][][]>([])
  const lastSolve     = ref<SolveResult | null>(null)

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
    lastSolve.value = null
    clearHint()
    progression.startPuzzle(puzzle, cellStates.value)
  }

  /** Restore a saved-in-progress puzzle from progression. */
  function resumeIfAvailable(): boolean {
    const saved = progression.current
    if (!saved) return false
    currentPuzzle.value = saved.puzzle
    cellStates.value = saved.cellStates.map(r => [...r])
    history.value = []
    future.value  = []
    lastSolve.value = null
    clearHint()
    return true
  }

  function reset() {
    pushHistory()
    cellStates.value = Array.from({ length: currentPuzzle.value.n }, () =>
      Array<CellState>(currentPuzzle.value.n).fill('empty'),
    )
    clearHint()
  }

  // ── Cell interaction ──────────────────────────────────────────────────────

  function toggleStar(row: number, col: number) {
    clearHint()
    const cur = cellStates.value[row][col]
    pushHistory()
    cellStates.value[row][col] = cur === 'star' ? 'empty' : 'star'
  }

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
    lastHint.value = null
  }

  /** Returns the hint so the UI can display its reasoning text. */
  function showHint(): Hint {
    clearHint()
    const hint = deriveHint(currentPuzzle.value, cellStates.value)
    lastHint.value = hint
    if (hint.cell) {
      hintCell.value = hint.cell
      hintTimer = setTimeout(() => { hintCell.value = null }, 4000)
    }
    progression.recordHintUsed()
    return hint
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

  // Auto-save every change & detect solve transitions
  watch(cellStates, (s) => progression.updatePuzzleState(s), { deep: true })

  watch(isSolved, (solved, wasSolved) => {
    if (solved && !wasSolved) {
      lastSolve.value = progression.awardSolve()
    }
  })

  // ── Boot ──────────────────────────────────────────────────────────────────

  if (!resumeIfAvailable()) {
    initBoard(puzzles[0])
  }

  return {
    currentPuzzle, cellStates, violations, isSolved, starCount,
    hintCell, lastHint, lastSolve,
    canUndo, canRedo,
    toggleStar, toggleMark, undo, redo, reset,
    initBoard, showHint, clearHint, resumeIfAvailable,
  }
})
