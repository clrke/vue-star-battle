import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Puzzle, CellState } from '../types/puzzle'
import {
  cumXpForLevel,
  levelForXp,
  sizeForLevel,
  xpForSolve,
  baseXpForSize,
  hintCostForSize,
  MAX_LEVEL,
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

  const xp            = ref(initial.xp)
  const totalSolved   = ref(initial.totalSolved)
  const totalHints    = ref(initial.totalHints)
  const totalTimeMs   = ref(initial.totalTimeMs)
  const perSize       = ref<Record<number, PerSizeStats>>(initial.perSize)
  const current       = ref<SavedPuzzle | null>(initial.current)
  const currentStreak = ref(initial.currentStreak ?? 0)
  const bestStreak    = ref(initial.bestStreak    ?? 0)

  // Ephemeral signal for UI toasts — not persisted.
  // Each hint debit increments `seq` so watchers fire even for same cost.
  const lastHintDebit = ref<{ cost: number; seq: number } | null>(null)
  let hintDebitSeq = 0

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
  /** True when the player has reached the highest available level. */
  const isMaxLevel        = computed(() => level.value >= MAX_LEVEL)
  /**
   * Approximate number of *clean* (hint-free) wins needed to reach the next
   * level. Null at max level. Rounds up; heavy hint use will require more.
   */
  const winsToNextLevel   = computed(() =>
    isMaxLevel.value ? null : Math.ceil(xpToNextLevel.value / baseXpForSize(currentSize.value)),
  )
  /**
   * XP the player would earn right now if they solved the current puzzle.
   * Decreases with each hint used; can go negative (level-down territory).
   * Null when there is no puzzle in progress.
   */
  const potentialXp       = computed(() => {
    if (!current.value) return null
    return xpForSolve(current.value.puzzle.n)
  })
  /** Cost in XP of the *next* hint for the current puzzle size. */
  const nextHintCost      = computed(() => hintCostForSize(currentSize.value))

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
      currentStreak: currentStreak.value,
      bestStreak: bestStreak.value,
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
      levelAtStart: level.value,   // used in awardSolve to detect net level change
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
    // Debit the hint cost from XP immediately. Level cascades automatically
    // via the levelForXp computed, so the player can level *down* on a hint.
    // Floor at 0 so they can't go negative — this is the soft cap.
    const cost = hintCostForSize(current.value.puzzle.n)
    xp.value = Math.max(0, xp.value - cost)
    lastHintDebit.value = { cost, seq: ++hintDebitSeq }
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
  function awardSolve(): { gained: number; level: number; leveledUp: boolean; leveledDown: boolean; elapsedMs: number; isPersonalBest: boolean; streak: number } {
    if (!current.value) return { gained: 0, level: level.value, leveledUp: false, leveledDown: false, elapsedMs: 0, isPersonalBest: false, streak: 0 }

    const n             = current.value.puzzle.n
    const elapsedMs     = getElapsedMs()
    const hintsUsed     = current.value.hintsUsed
    // Level at puzzle *start* — for detecting net level change across the whole
    // puzzle (hints may have already dropped the level mid-puzzle).
    const levelAtStart  = current.value.levelAtStart ?? level.value

    // Hint costs were already debited in recordHintUsed(); the solve reward
    // is the clean base XP for the grid size.
    const gained     = xpForSolve(n)
    // Floor at 0 just in case some other code path subtracts XP later.
    xp.value         = Math.max(0, xp.value + gained)
    totalSolved.value += 1
    totalTimeMs.value += elapsedMs

    const stats = ensureSizeStats(n)
    const prevBestTimeMs = stats.bestTimeMs   // capture before update
    stats.solved += 1
    stats.totalTimeMs += elapsedMs
    stats.hintsUsed += hintsUsed
    if (stats.bestTimeMs === null || elapsedMs < stats.bestTimeMs)
      stats.bestTimeMs = elapsedMs

    const isPersonalBest = prevBestTimeMs === null || elapsedMs < prevBestTimeMs

    // Streak: only clean (hint-free) solves count
    if (hintsUsed === 0) {
      currentStreak.value += 1
    } else {
      currentStreak.value = 0
    }
    bestStreak.value = Math.max(bestStreak.value, currentStreak.value)

    current.value = null  // puzzle complete; clear in-progress save

    return {
      gained,
      level:         level.value,
      // Compare final level to level at puzzle *start*, not just pre-solve level,
      // so that hint-induced level-drops that were later recovered are visible.
      leveledUp:     level.value > levelAtStart,
      leveledDown:   level.value < levelAtStart,
      elapsedMs,
      isPersonalBest,
      streak:        currentStreak.value,
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
    currentStreak.value = 0
    bestStreak.value = 0
  }

  return {
    // state
    xp, totalSolved, totalHints, totalTimeMs, perSize, current,
    currentStreak, bestStreak, lastHintDebit,
    // derived
    level, xpAtLevelStart, xpAtNextLevel, xpIntoLevel, xpForLevelSpan, xpToNextLevel,
    currentSize, maxN, isMaxLevel, winsToNextLevel, potentialXp, nextHintCost,
    // actions
    startPuzzle, updatePuzzleState, recordHintUsed, getElapsedMs, pause,
    awardSolve, clearCurrent, reset,
  }
})
