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

/**
 * Levels per prestige cycle: one pass through every (size × tier)
 * combination = SIZES.length × TIER_LOOKAHEADS.length levels.
 */
const LEVELS_PER_CYCLE = SIZES.length * TIER_LOOKAHEADS.length

/**
 * Tier descriptor for any level (≥ 1) — generated on demand so the
 * progression is open-ended.
 *
 * Within a cycle, the player walks (size 0 → size N) at tier 0, then
 * (size 0 → size N) at tier 1, and so on through every lookahead tier.
 * Once the top tier is finished, the cycle restarts at size 4 / tier 0
 * but with a higher REWARD MULTIPLIER — cycle 1 pays out at (base × 2),
 * cycle 2 at (base × 3), and so on indefinitely. The size and lookahead
 * cap repeat, but the XP economy grows so each subsequent climb feels
 * worth doing.
 */
export function tierForLevel(level: number): Tier {
  const lvl = Math.max(1, level)
  const idx = lvl - 1                                   // 0-based
  const cycle = Math.floor(idx / LEVELS_PER_CYCLE)      // 0, 1, 2, …
  const inCycle = idx % LEVELS_PER_CYCLE
  const tierIdx = Math.floor(inCycle / SIZES.length)    // 0..TIER_LOOKAHEADS.length-1
  const sizeIdx = inCycle % SIZES.length
  const size = SIZES[sizeIdx]
  const ml = TIER_LOOKAHEADS[tierIdx]
  const cycleMultiplier = cycle + 1                     // 1×, 2×, 3×, …
  return {
    level: lvl,
    size,
    maxLookaheads: ml,
    tierIndex: tierIdx,
    reward: SIZE_BASE_REWARD[size] * TIER_MULTIPLIER[tierIdx] * cycleMultiplier,
    winsToAdvance: SIZE_WINS_TO_ADVANCE[size],
  }
}

/**
 * Closed-form total XP awarded over one full cycle at base multiplier
 * 1× — i.e. summed (reward × winsToAdvance) for every level in cycle 0.
 * Cycle K's contribution is (K+1) × this value because the reward
 * multiplier scales linearly with the cycle number.
 */
const CYCLE_XP_BASE = (() => {
  let total = 0
  for (let ti = 0; ti < TIER_LOOKAHEADS.length; ti++) {
    for (const size of SIZES) {
      total += SIZE_BASE_REWARD[size] * TIER_MULTIPLIER[ti] * SIZE_WINS_TO_ADVANCE[size]
    }
  }
  return total
})()

/** Cumulative XP required to *reach* level L (so L1 = 0). Handles any
 *  level — the closed-form sum across completed cycles makes it cheap
 *  even at level 10 000. */
export function cumXpForLevel(level: number): number {
  const lvl = Math.max(1, level)
  const idx = lvl - 1
  const completedCycles = Math.floor(idx / LEVELS_PER_CYCLE)
  const inCycle = idx % LEVELS_PER_CYCLE

  // XP from every completed prestige cycle. Cycle K contributes (K+1)
  // × CYCLE_XP_BASE, so cycles [0..completedCycles-1] sum to
  // CYCLE_XP_BASE × (1 + 2 + … + completedCycles)
  //              = CYCLE_XP_BASE × completedCycles × (completedCycles + 1) / 2.
  const cyclesTotal = CYCLE_XP_BASE * completedCycles * (completedCycles + 1) / 2

  // Partial XP within the current cycle, at the current cycle's multiplier.
  const cycleMultiplier = completedCycles + 1
  let withinCycle = 0
  for (let i = 0; i < inCycle; i++) {
    const tierIdx = Math.floor(i / SIZES.length)
    const sizeIdx = i % SIZES.length
    const size = SIZES[sizeIdx]
    withinCycle += SIZE_BASE_REWARD[size] * TIER_MULTIPLIER[tierIdx] * SIZE_WINS_TO_ADVANCE[size]
  }
  withinCycle *= cycleMultiplier

  return cyclesTotal + withinCycle
}

/** Level corresponding to a given XP total. Open-ended; iterates the
 *  per-level XP cost so it's O(level) per call. For very large XP it
 *  short-circuits across completed cycles via the closed-form
 *  CYCLE_XP_BASE × K(K+1)/2 sum. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1
  // First, skip whole cycles quickly. Cumulative XP through cycle K
  // (inclusive) = CYCLE_XP_BASE × (K+1)(K+2)/2; solve for largest K
  // with that ≤ xp.
  // We don't need a closed-form invert — iterating cycles is O(√xp)
  // and easily fast enough.
  let cycle = 0
  while (true) {
    const through = CYCLE_XP_BASE * (cycle + 1) * (cycle + 2) / 2
    if (through > xp) break
    cycle++
    if (cycle > 100_000) break   // safety; far beyond any practical play
  }
  // Now we know levels 1..(cycle × LEVELS_PER_CYCLE) are paid for.
  // Advance through the partial cycle one level at a time.
  let level = cycle * LEVELS_PER_CYCLE + 1
  let cumXp = CYCLE_XP_BASE * cycle * (cycle + 1) / 2
  while (true) {
    const t = tierForLevel(level)
    const cost = t.reward * t.winsToAdvance
    if (cumXp + cost > xp) break
    cumXp += cost
    level++
  }
  return level
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

/**
 * Highest reachable level. The progression is open-ended — each
 * subsequent cycle through (size × tier) pays out more XP — so this
 * sentinel is just `Number.POSITIVE_INFINITY`. `isMaxLevel` in the
 * store therefore stays false forever; the UI no longer collapses
 * progress / wins-to-next into a "max level" branch.
 */
export const MAX_LEVEL = Number.POSITIVE_INFINITY

/** Levels per prestige cycle (size × tier-cap matrix). Exposed for
 *  the UI's prestige-suffix logic. */
export const PRESTIGE_CYCLE_LEN = LEVELS_PER_CYCLE

/** Prestige cycle index (0-based) the given level belongs to. Cycle 0
 *  covers the first PRESTIGE_CYCLE_LEN levels; each subsequent cycle
 *  reuses the same tier ladder but at a higher XP multiplier. */
export function prestigeCycleForLevel(level: number): number {
  return Math.floor((Math.max(1, level) - 1) / PRESTIGE_CYCLE_LEN)
}

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
