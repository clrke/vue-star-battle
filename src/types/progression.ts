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
  /** Consecutive hint-free solves (resets to 0 on any hint use). */
  currentStreak?: number
  /** All-time best consecutive hint-free streak. */
  bestStreak?: number
}

// ── Level → grid size (level *determines* size; player has no choice) ────────

/**
 * Step XP curve: each level's threshold equals the cumulative XP earned
 * by completing `winsToAdvance` clean wins at every previous level's size.
 * So at level L, you need (winsToAdvance × cleanReward) more XP to reach L+1.
 *
 * Convention: winsToAdvance = the level's grid size (4 wins at 4×4, 5 at
 * 5×5, …). Hints cost XP, so a hint-heavy solve can leave you below the
 * previous threshold and drop you a level.
 */
const LEVEL_TIERS: Array<{ level: number; size: number; reward: number; winsToAdvance: number }> = [
  { level: 1, size: 4,  reward: 10,  winsToAdvance: 4  },
  { level: 2, size: 5,  reward: 25,  winsToAdvance: 5  },
  { level: 3, size: 6,  reward: 50,  winsToAdvance: 6  },
  { level: 4, size: 7,  reward: 100, winsToAdvance: 7  },
  { level: 5, size: 8,  reward: 175, winsToAdvance: 8  },
  { level: 6, size: 10, reward: 350, winsToAdvance: 10 },
  { level: 7, size: 12, reward: 600, winsToAdvance: 12 },
]

/** Cumulative XP required to *reach* level L (so L1 = 0). */
export function cumXpForLevel(level: number): number {
  let xp = 0
  for (const tier of LEVEL_TIERS) {
    if (tier.level >= level) break
    xp += tier.reward * tier.winsToAdvance
  }
  return xp
}

/** Level corresponding to a given XP total (clamped to [1, MAX]). */
export function levelForXp(xp: number): number {
  let level = 1
  for (const tier of LEVEL_TIERS) {
    if (xp >= cumXpForLevel(tier.level)) level = tier.level
    else break
  }
  return level
}

/** Grid size to play at the given level. */
export function sizeForLevel(level: number): number {
  const clamped = Math.min(Math.max(level, 1), LEVEL_TIERS[LEVEL_TIERS.length - 1].level)
  return LEVEL_TIERS.find(t => t.level === clamped)!.size
}

/** Highest reachable level. */
export const MAX_LEVEL = LEVEL_TIERS[LEVEL_TIERS.length - 1].level

// ── XP rewards ──────────────────────────────────────────────────────────────

const BASE_XP: Record<number, number> = Object.fromEntries(
  LEVEL_TIERS.map(t => [t.size, t.reward]),
)

/** XP cost per hint, scaled to the puzzle's clean reward (1/5 of base). */
function hintCost(n: number): number {
  const base = BASE_XP[n] ?? 50
  return Math.max(2, Math.round(base / 5))
}

/**
 * Solve award: full base XP for this grid size.
 *
 * Hint costs are debited from the player's XP *immediately* in
 * `recordHintUsed()` (not subtracted again here), so the model is honest:
 * the Hint button shows '−N XP' and applies it on click. The solve reward
 * is then the clean base reward regardless of prior hint use.
 */
export function xpForSolve(n: number): number {
  return BASE_XP[n] ?? 50
}

export const baseXpForSize = (n: number): number => BASE_XP[n] ?? 50
export const hintCostForSize = (n: number): number => hintCost(n)
