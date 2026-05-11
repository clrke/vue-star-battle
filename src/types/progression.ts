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

/**
 * Lookahead caps per tier. Tiers grow Fibonacci-ish to keep the gap
 * meaningful as numbers get large — single-step graduation in the
 * early tiers (where every extra lookahead is a noticeable jump in
 * difficulty), wider spacing in the late tiers, and an unlimited top
 * tier that accepts any auto-solvable puzzle. Empirically a 10×10 can
 * naturally require 20+ lookaheads, so a hard ceiling at 3 would have
 * left some puzzles forever unreachable.
 */
const TIER_LOOKAHEADS = [0, 1, 2, 3, 5, 8, 13, Infinity] as const

/** XP-reward multiplier per tier INDEX (0..N-1). Higher tiers pay
 *  more — and cost more per hint — so the late game is meaningfully
 *  more rewarding than grinding tier 0 forever. */
const TIER_MULTIPLIER = [1, 2, 3, 4, 6, 8, 10, 12] as const

/**
 * Reward and pacing for the *base* tier (tier 0). Higher tiers multiply the
 * reward via TIER_MULTIPLIER above — the wins-to-advance count stays the
 * same (= grid size) so each tier is roughly the same number of clean wins.
 */
const SIZE_BASE_REWARD: Record<number, number> = {
  4: 10, 5: 25, 6: 50, 7: 100, 8: 175, 10: 350,
}
const SIZE_WINS_TO_ADVANCE: Record<number, number> = {
  4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 10: 10,
}

export interface Tier {
  level: number
  size: number
  /** Lookahead-class hints allowed on the auto-solve path. Worker
   *  filter; `Infinity` means any auto-solvable puzzle is accepted. */
  maxLookaheads: number
  /** Tier index 0..TIER_COUNT-1 — used for UI colour pills and for
   *  decoupling the visual ordering from the (numeric, possibly
   *  Infinity) cap value. */
  tierIndex: number
  reward: number
  winsToAdvance: number
}

const LEVEL_TIERS: Tier[] = (() => {
  const out: Tier[] = []
  for (let ti = 0; ti < TIER_LOOKAHEADS.length; ti++) {
    const ml = TIER_LOOKAHEADS[ti]
    for (const size of SIZES) {
      out.push({
        level: out.length + 1,
        size,
        maxLookaheads: ml,
        tierIndex: ti,
        reward: SIZE_BASE_REWARD[size] * TIER_MULTIPLIER[ti],
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

/** Lookahead-tier cap for the given level. Can be Infinity at the
 *  top tier — the worker treats that as "no cap, accept any
 *  auto-solvable puzzle". */
export function maxLookaheadsForLevel(level: number): number {
  return tierForLevel(level).maxLookaheads
}

/** Tier index (0..TIER_COUNT-1) for the given level — used by the UI
 *  to pick a colour pill independent of the (possibly Infinity) cap. */
export function lookaheadTierForLevel(level: number): number {
  return tierForLevel(level).tierIndex
}

/** Highest reachable level. */
export const MAX_LEVEL = LEVEL_TIERS[LEVEL_TIERS.length - 1].level

/** Number of distinct lookahead tiers (0, 1, 2, 3). */
export const TIER_COUNT = TIER_LOOKAHEADS.length

/** Human-friendly label for a tier INDEX (0..TIER_COUNT-1). */
export function tierLabel(tierIndex: number): string {
  if (tierIndex < 0 || tierIndex >= TIER_LOOKAHEADS.length) return ''
  const ml = TIER_LOOKAHEADS[tierIndex]
  if (ml === 0)        return 'Pure logic'
  if (ml === Infinity) return 'Unlimited'
  return `≤${ml} lookahead${ml === 1 ? '' : 's'}`
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
