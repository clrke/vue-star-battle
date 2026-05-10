import type { CellState, Puzzle } from './puzzle'

export interface SavedPuzzle {
  puzzle: Puzzle
  cellStates: CellState[][]
  hintsUsed: number
  startedAt: number          // ms epoch
  accumulatedMs: number      // active play time, paused on tab hide
  /** Player's level when the puzzle was started — for net level-change detection. */
  levelAtStart?: number
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

// ── Level → (size × lookahead-tier) progression ─────────────────────────────
//
// Earlier versions of this game capped progression at level 6 (the largest
// playable grid, 10×10). After completing all sizes pure-logic, the player
// hit "Max Level" with nothing left to grind for.
//
// The new model adds a *lookahead tier* dimension on top of size. After
// finishing 10×10 at tier 0 (zero lookahead-class hints permitted), the
// player wraps back to 4×4 at tier 1 (up to one lookahead allowed), then
// climbs through the sizes again, and so on.
//
//   Tier 0: pure logic — every move falls out of a direct deduction
//   Tier 1: at most 1 lookahead-class hint on the auto-solve path
//   Tier 2: at most 2
//   Tier 3: at most 3
//
// Each tier × size combination is one level. With 4 tiers × 6 sizes that's
// 24 total levels, each requiring a fresh batch of `winsToAdvance`-many
// solves. The XP reward for a size scales with the tier multiplier so
// higher tiers also pay off more (and cost more if you take a hint).

const SIZES = [4, 5, 6, 7, 8, 10] as const
/** How many lookahead-class hints each tier permits on the auto-solve path. */
const TIER_LOOKAHEADS = [0, 1, 2, 3] as const

/**
 * Reward and pacing for the *base* tier (tier 0). Higher tiers multiply the
 * reward via TIER_MULTIPLIER below — the wins-to-advance count stays the
 * same (= grid size) so each tier is roughly the same number of clean wins.
 */
const SIZE_BASE_REWARD: Record<number, number> = {
  4: 10, 5: 25, 6: 50, 7: 100, 8: 175, 10: 350,
}
const SIZE_WINS_TO_ADVANCE: Record<number, number> = {
  4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 10: 10,
}
const TIER_MULTIPLIER: Record<number, number> = {
  0: 1, 1: 2, 2: 3, 3: 4,
}

export interface Tier {
  level: number
  size: number
  /** Lookahead-class hints allowed on the auto-solve path (worker filter). */
  maxLookaheads: number
  reward: number
  winsToAdvance: number
}

const LEVEL_TIERS: Tier[] = (() => {
  const out: Tier[] = []
  for (const ml of TIER_LOOKAHEADS) {
    for (const size of SIZES) {
      out.push({
        level: out.length + 1,
        size,
        maxLookaheads: ml,
        reward: SIZE_BASE_REWARD[size] * TIER_MULTIPLIER[ml],
        winsToAdvance: SIZE_WINS_TO_ADVANCE[size],
      })
    }
  }
  return out
})()

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

function tierForLevel(level: number): Tier {
  const clamped = Math.min(Math.max(level, 1), LEVEL_TIERS[LEVEL_TIERS.length - 1].level)
  return LEVEL_TIERS.find(t => t.level === clamped)!
}

/** Grid size to play at the given level. */
export function sizeForLevel(level: number): number {
  return tierForLevel(level).size
}

/** Lookahead-tier cap for the given level (0..3). */
export function maxLookaheadsForLevel(level: number): number {
  return tierForLevel(level).maxLookaheads
}

/** Lookahead-tier index for the given level (0..3) — same value as the cap
 *  in this design but exposed under a tier-shaped name for the UI. */
export function lookaheadTierForLevel(level: number): number {
  return tierForLevel(level).maxLookaheads
}

/** Highest reachable level. */
export const MAX_LEVEL = LEVEL_TIERS[LEVEL_TIERS.length - 1].level

/** Number of distinct lookahead tiers (0, 1, 2, 3). */
export const TIER_COUNT = TIER_LOOKAHEADS.length

/** Human-friendly label for a lookahead tier index. */
export function tierLabel(tier: number): string {
  switch (tier) {
    case 0:  return 'Pure logic'
    case 1:  return '+1 lookahead'
    case 2:  return '+2 lookaheads'
    case 3:  return '+3 lookaheads'
    default: return `+${tier} lookaheads`
  }
}

// ── XP rewards ──────────────────────────────────────────────────────────────

/** XP cost per hint, scaled to the current tier's reward (1/5 of reward). */
function hintCost(level: number): number {
  const tier = tierForLevel(level)
  return Math.max(2, Math.round(tier.reward / 5))
}

/**
 * Solve award: the *level's* reward (which already factors in the tier
 * multiplier). Hint costs are debited from the player's XP immediately
 * in `recordHintUsed()` (not subtracted again here), so the model is
 * honest: the Hint button shows '−N XP' and applies it on click. The
 * solve reward is then the clean tier reward regardless of prior hint
 * use.
 */
export function xpForSolve(level: number): number {
  return tierForLevel(level).reward
}

export const baseXpForLevel = (level: number): number => tierForLevel(level).reward
export const hintCostForLevel = (level: number): number => hintCost(level)

// ── Backward-compat helpers (size-only) ─────────────────────────────────────
// Some callers — primarily test fixtures and stats screens — still ask for
// a per-size base reward without a tier in hand. Return the tier-0 reward.
export const baseXpForSize = (n: number): number => SIZE_BASE_REWARD[n] ?? 50
export const hintCostForSize = (n: number): number =>
  Math.max(2, Math.round((SIZE_BASE_REWARD[n] ?? 50) / 5))
