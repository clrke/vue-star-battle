import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Puzzle, CellState } from '../types/puzzle'
import {
  cumXpForLevel,
  levelForXp,
  sizeForLevel,
  xpForSolve,
  type PerSizeStats,
  type PersistedProgression,
  type SavedPuzzle,
} from '../types/progression'

const STORAGE_KEY = 'star-battle/progression/v1'

const emptyStats = (): PerSizeStats => ({
  solved: 0, bestTimeMs: null, totalTimeMs: 0, hintsUsed: 0,
})

function load(): PersistedProgression | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as PersistedProgression
    if (data.version !== 1) return null
    return data
  } catch {
    return null
  }
}

function defaultState(): PersistedProgression {
  return {
    version: 1,
    xp: 0,
    totalSolved: 0,
    totalHints: 0,
    totalTimeMs: 0,
    perSize: {},
    current: null,
  }
}

export const useProgressionStore = defineStore('progression', () => {
  const initial = load() ?? defaultState()

  const xp           = ref(initial.xp)
  const totalSolved  = ref(initial.totalSolved)
  const totalHints   = ref(initial.totalHints)
  const totalTimeMs  = ref(initial.totalTimeMs)
  const perSize      = ref<Record<number, PerSizeStats>>(initial.perSize)
  const current      = ref<SavedPuzzle | null>(initial.current)

  // Treat the gap between save and reload as a pause: the saved
  // accumulatedMs already covers all real play time, so we reset
  // startedAt to "now" rather than counting the page-closed window.
  if (current.value) current.value.startedAt = Date.now()

  // ── Derived ────────────────────────────────────────────────────────────────

  const level             = computed(() => levelForXp(xp.value))
  const xpAtLevelStart    = computed(() => cumXpForLevel(level.value))
  const xpAtNextLevel     = computed(() => cumXpForLevel(level.value + 1))
  const xpIntoLevel       = computed(() => xp.value - xpAtLevelStart.value)
  const xpForLevelSpan    = computed(() => xpAtNextLevel.value - xpAtLevelStart.value)
  const xpToNextLevel     = computed(() => xpAtNextLevel.value - xp.value)
  /** Grid size to play right now — derived from level, no player choice. */
  const currentSize       = computed(() => sizeForLevel(level.value))
  /** Backwards-compat alias (some components still reference maxN). */
  const maxN              = currentSize

  // ── Persistence ────────────────────────────────────────────────────────────

  function persist() {
    const payload: PersistedProgression = {
      version: 1,
      xp: xp.value,
      totalSolved: totalSolved.value,
      totalHints: totalHints.value,
      totalTimeMs: totalTimeMs.value,
      perSize: perSize.value,
      current: current.value,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)) }
    catch { /* quota etc. — silent */ }
  }

  // Debounced auto-save on any change
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    () => [xp.value, totalSolved.value, totalHints.value, totalTimeMs.value, perSize.value, current.value],
    () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(persist, 250)
    },
    { deep: true },
  )

  // ── Actions ────────────────────────────────────────────────────────────────

  function ensureSizeStats(n: number): PerSizeStats {
    if (!perSize.value[n]) perSize.value[n] = emptyStats()
    return perSize.value[n]
  }

  function startPuzzle(puzzle: Puzzle, cellStates: CellState[][]) {
    current.value = {
      puzzle,
      cellStates: cellStates.map(r => [...r]),
      hintsUsed: 0,
      startedAt: Date.now(),
      accumulatedMs: 0,
    }
  }

  function updatePuzzleState(cellStates: CellState[][]) {
    if (!current.value) return
    current.value.cellStates = cellStates.map(r => [...r])
  }

  function recordHintUsed() {
    if (!current.value) return
    current.value.hintsUsed += 1
    totalHints.value += 1
  }

  /** Active play time in this session (excludes time since startedAt while paused). */
  function getElapsedMs(): number {
    if (!current.value) return 0
    return current.value.accumulatedMs + (Date.now() - current.value.startedAt)
  }

  function pause() {
    if (!current.value) return
    current.value.accumulatedMs += Date.now() - current.value.startedAt
    current.value.startedAt = Date.now()  // dummy to allow seamless resume
  }

  /**
   * Record a successful solve. Returns the XP awarded so the UI can announce it.
   */
  function awardSolve(): { gained: number; level: number; leveledUp: boolean; leveledDown: boolean; elapsedMs: number } {
    if (!current.value) return { gained: 0, level: level.value, leveledUp: false, leveledDown: false, elapsedMs: 0 }

    const n          = current.value.puzzle.n
    const elapsedMs  = getElapsedMs()
    const hintsUsed  = current.value.hintsUsed
    const gained     = xpForSolve(n, hintsUsed)

    const prevLevel  = level.value
    // XP can drop from heavy hint use. Floor at 0 so a player can't sink
    // below level 1.
    xp.value         = Math.max(0, xp.value + gained)
    totalSolved.value += 1
    totalTimeMs.value += elapsedMs

    const stats = ensureSizeStats(n)
    stats.solved += 1
    stats.totalTimeMs += elapsedMs
    stats.hintsUsed += hintsUsed
    if (stats.bestTimeMs === null || elapsedMs < stats.bestTimeMs)
      stats.bestTimeMs = elapsedMs

    current.value = null  // puzzle complete; clear in-progress save

    return {
      gained,
      level: level.value,
      leveledUp:   level.value > prevLevel,
      leveledDown: level.value < prevLevel,
      elapsedMs,
    }
  }

  function clearCurrent() {
    current.value = null
  }

  function reset() {
    xp.value = 0
    totalSolved.value = 0
    totalHints.value = 0
    totalTimeMs.value = 0
    perSize.value = {}
    current.value = null
  }

  return {
    // state
    xp, totalSolved, totalHints, totalTimeMs, perSize, current,
    // derived
    level, xpAtLevelStart, xpAtNextLevel, xpIntoLevel, xpForLevelSpan, xpToNextLevel,
    currentSize, maxN,
    // actions
    startPuzzle, updatePuzzleState, recordHintUsed, getElapsedMs, pause,
    awardSolve, clearCurrent, reset,
  }
})
