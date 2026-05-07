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

/**
 * Skill-based unlocks: each new size opens after winning enough at the
 * previous one. Beginners ramp up gradually rather than grinding XP.
 *
 * The number of wins required at size n to unlock the next available size.
 * Sizes are 4, 5, 6, 7, 8, 10, 12 (3×3 has no valid Star Battle solution).
 */
export const UNLOCK_THRESHOLD: Record<number, number> = {
  4: 4,    // 4 wins at 4×4 → unlock 5×5
  5: 4,    // 4 wins at 5×5 → unlock 6×6
  6: 5,    // 5 wins at 6×6 → unlock 7×7
  7: 5,    // 5 wins at 7×7 → unlock 8×8
  8: 6,    // 6 wins at 8×8 → unlock 10×10
  10: 6,   // 6 wins at 10×10 → unlock 12×12
}
const UNLOCK_ORDER = [4, 5, 6, 7, 8, 10, 12] as const

/** Highest board size unlocked given per-size solve counts. */
export function maxNForSolves(perSize: Record<number, PerSizeStats>): number {
  let max: number = UNLOCK_ORDER[0]
  for (let i = 0; i < UNLOCK_ORDER.length - 1; i++) {
    const cur = UNLOCK_ORDER[i]
    const next = UNLOCK_ORDER[i + 1]
    const need = UNLOCK_THRESHOLD[cur] ?? Infinity
    const wonAtCur       = (perSize[cur]?.solved ?? 0) >= need
    const legacyUnlocked = (perSize[next]?.solved ?? 0) > 0   // grandfathered: user already played this size before the gating change
    if (wonAtCur || legacyUnlocked) {
      max = next
    } else {
      break
    }
  }
  return max
}

/** Required solves at the previous size before `n` unlocks. Null if `n` is the starter size or unknown. */
export function unlockRequirement(n: number): { previousSize: number; requiredSolves: number } | null {
  const idx = UNLOCK_ORDER.indexOf(n as typeof UNLOCK_ORDER[number])
  if (idx <= 0) return null
  const previousSize = UNLOCK_ORDER[idx - 1]
  return { previousSize, requiredSolves: UNLOCK_THRESHOLD[previousSize] ?? 0 }
}

// ── XP rewards ──────────────────────────────────────────────────────────────

const BASE_XP: Record<number, number> = {
  4: 10,    // tutorial-tier
  5: 25, 6: 50, 7: 100, 8: 175, 10: 350, 12: 600,
}

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
