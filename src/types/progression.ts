import type { CellState, Puzzle } from './puzzle'

export interface SavedPuzzle {
  puzzle: Puzzle
  cellStates: CellState[][]
  hintsUsed: number
  startedAt: number          // ms epoch
  accumulatedMs: number      // active play time, paused on tab hide
}

export interface PerSizeStats {
  solved: number
  bestTimeMs: number | null
  totalTimeMs: number
  hintsUsed: number
}

export interface PersistedProgression {
  version: 1
  xp: number
  totalSolved: number
  totalHints: number
  totalTimeMs: number
  perSize: Record<number, PerSizeStats>
  current: SavedPuzzle | null
}

// ── XP curve ────────────────────────────────────────────────────────────────

/** Cumulative XP required to *reach* level L (so L1 = 0). */
export const cumXpForLevel = (L: number): number => Math.max(0, 100 * L * L - 100)

/** Level corresponding to a given XP total. */
export const levelForXp = (xp: number): number =>
  Math.max(1, Math.floor(Math.sqrt((xp + 100) / 100)))

/** Maximum board size unlocked at this level. */
export function maxNForLevel(level: number): number {
  if (level < 3)  return 5
  if (level < 6)  return 6
  if (level < 10) return 7
  if (level < 16) return 8
  if (level < 24) return 10
  return 12
}

// ── XP rewards ──────────────────────────────────────────────────────────────

const BASE_XP: Record<number, number> = { 5: 25, 6: 50, 7: 100, 8: 175, 10: 350, 12: 600 }

/**
 * Award curve: base × max(0.10, 1 − 0.20 × hints)
 *   0 hints → 100 %     3 hints → 40 %
 *   1 hint  →  80 %     4 hints → 20 %
 *   2 hints →  60 %     5+      → 10 % floor
 */
export function xpForSolve(n: number, hintsUsed: number): number {
  const base = BASE_XP[n] ?? 50
  const mult = Math.max(0.10, 1 - 0.20 * hintsUsed)
  return Math.round(base * mult)
}

export const baseXpForSize = (n: number): number => BASE_XP[n] ?? 50
