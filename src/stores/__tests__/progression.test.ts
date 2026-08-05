import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useProgressionStore } from '../progression'
import type { Puzzle, CellState } from '../../types/puzzle'
import type { PersistedProgression } from '../../types/progression'
import { cumXpForLevel, xpForSolve, hintCostForLevel, PRESTIGE_CYCLE_LEN } from '../../types/progression'

// Mirrors the private STORAGE_KEY constant in progression.ts (not exported).
const STORAGE_KEY = 'star-battle/progression/v1'

// ── Test helpers ──────────────────────────────────────────────────────────────

function makePuzzle(n: number, id = 'test-puzzle'): Puzzle {
  return {
    id,
    title: 'Test Puzzle',
    n,
    grid: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r + c) % n)),
  }
}

function makeCellStates(n: number): CellState[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, (): CellState => 'empty'))
}

/** Minimal localStorage stub backed by a Map, with vi.fn spies and optional throwing. */
function makeStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const map = new Map<string, string>()
  const storage = {
    getItem: vi.fn((k: string): string | null => {
      if (opts.throwOnGet) throw new DOMException('SecurityError')
      return map.get(k) ?? null
    }),
    setItem: vi.fn((k: string, v: string): void => {
      if (opts.throwOnSet) throw new DOMException('SecurityError')
      map.set(k, v)
    }),
    removeItem: vi.fn((k: string) => { map.delete(k) }),
    clear: vi.fn(() => map.clear()),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  return { storage: storage as unknown as Storage, map }
}

/** Repeatedly debits hints from the given store's active puzzle until XP floors at 0. */
function drainXpViaHints(store: ReturnType<typeof useProgressionStore>) {
  let guard = 0
  while (store.xp > 0 && guard++ < 200) store.recordHintUsed()
}

let ls: ReturnType<typeof makeStorage>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  ls = makeStorage()
  vi.stubGlobal('localStorage', ls.storage)
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ── Default state ─────────────────────────────────────────────────────────────

describe('default state (no persisted data)', () => {
  it('initializes all counters to zero/empty', () => {
    const store = useProgressionStore()
    expect(store.xp).toBe(0)
    expect(store.totalSolved).toBe(0)
    expect(store.totalHints).toBe(0)
    expect(store.totalTimeMs).toBe(0)
    expect(store.perSize).toEqual({})
    expect(store.current).toBeNull()
    expect(store.currentStreak).toBe(0)
    expect(store.bestStreak).toBe(0)
    expect(store.lastHintDebit).toBeNull()
  })

  it('starts at level 1', () => {
    const store = useProgressionStore()
    expect(store.level).toBe(1)
  })

  it('derives level-1 thresholds correctly (cost 40 XP, reward 10 XP)', () => {
    const store = useProgressionStore()
    expect(store.xpAtLevelStart).toBe(0)
    expect(store.xpAtNextLevel).toBe(40)
    expect(store.xpIntoLevel).toBe(0)
    expect(store.xpForLevelSpan).toBe(40)
    expect(store.xpToNextLevel).toBe(40)
  })

  it('derives size/tier/prestige for level 1', () => {
    const store = useProgressionStore()
    expect(store.currentSize).toBe(4)
    expect(store.currentMaxLookaheads).toBe(0)
    expect(store.currentTier).toBe(0)
    expect(store.currentPrestige).toBe(0)
    expect(store.currentTierLabel).toBe('Pure logic')
  })

  it('is never at max level (open-ended progression)', () => {
    const store = useProgressionStore()
    expect(store.isMaxLevel).toBe(false)
  })

  it('computes winsToNextLevel and nextHintCost from the level-1 economy', () => {
    const store = useProgressionStore()
    expect(store.winsToNextLevel).toBe(4)   // ceil(40 / 10)
    expect(store.nextHintCost).toBe(2)      // max(2, round(10/5))
  })
})

// ── Level economy sanity ───────────────────────────────────────────────────────
// Hand-verified against the SIZE_BASE_REWARD / TIER_MULTIPLIER / winsToAdvance
// tables in src/types/progression.ts, so the rest of the suite can build on
// these thresholds with confidence.

describe('level economy (hand-verified levels 1-8)', () => {
  it('matches hand-computed cumulative XP thresholds', () => {
    expect(cumXpForLevel(1)).toBe(0)
    expect(cumXpForLevel(2)).toBe(40)     // level1: size4, reward10, wins4  -> cost 40
    expect(cumXpForLevel(3)).toBe(165)    // level2: size5, reward25, wins5  -> cost 125
    expect(cumXpForLevel(4)).toBe(465)    // level3: size6, reward50, wins6  -> cost 300
    expect(cumXpForLevel(5)).toBe(1165)   // level4: size7, reward100,wins7  -> cost 700
    expect(cumXpForLevel(6)).toBe(2565)   // level5: size8, reward175,wins8  -> cost 1400
    expect(cumXpForLevel(7)).toBe(6065)   // level6: size10,reward350,wins10 -> cost 3500
    expect(cumXpForLevel(8)).toBe(6145)   // level7: size4, tier1, reward20, wins4 -> cost 80
  })
})

// ── store.level reacts to xp ────────────────────────────────────────────────────

describe('store.level reacts to xp (boundary crossing + multi-level jumps)', () => {
  it.each([
    [0, 1], [39, 1], [40, 2], [164, 2], [165, 3], [464, 3], [465, 4],
  ])('xp=%i -> level %i', (xpVal, expectedLevel) => {
    const store = useProgressionStore()
    store.xp = xpVal
    expect(store.level).toBe(expectedLevel)
  })

  it('jumps multiple levels at once when xp is set directly to a large value', () => {
    const store = useProgressionStore()
    expect(store.level).toBe(1)
    store.xp = 6065   // exact threshold for level 7
    expect(store.level).toBe(7)
    expect(store.currentSize).toBe(4)     // level 7 wraps back to size 4, tier 1
    expect(store.currentTier).toBe(1)
    expect(store.currentTierLabel).toBe('≤1 lookahead')
  })

  it('level drops immediately when xp is set back down (no ratchet/floor)', () => {
    const store = useProgressionStore()
    store.xp = 6065
    expect(store.level).toBe(7)
    store.xp = 0
    expect(store.level).toBe(1)
  })
})

// ── awardSolve(): XP award math ─────────────────────────────────────────────────

describe('awardSolve() - XP award math', () => {
  it('awards the level-1 reward (10 XP) for a clean 4x4 solve', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    vi.advanceTimersByTime(5000)
    const result = store.awardSolve()
    expect(result.gained).toBe(10)
    expect(store.xp).toBe(10)
    expect(result.elapsedMs).toBe(5000)
    expect(result.level).toBe(1)
    expect(result.leveledUp).toBe(false)
    expect(result.leveledDown).toBe(false)
    expect(result.isPersonalBest).toBe(true)
    expect(result.streak).toBe(1)
  })

  it('clears the in-progress puzzle and updates totals/perSize stats', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    vi.advanceTimersByTime(1234)
    store.awardSolve()
    expect(store.current).toBeNull()
    expect(store.totalSolved).toBe(1)
    expect(store.totalTimeMs).toBe(1234)
    expect(store.perSize[4]).toEqual({ solved: 1, bestTimeMs: 1234, totalTimeMs: 1234, hintsUsed: 0 })
  })

  it('with no in-progress puzzle, returns an inert result and touches no state', () => {
    const store = useProgressionStore()
    const result = store.awardSolve()
    expect(result).toEqual({
      gained: 0, level: 1, leveledUp: false, leveledDown: false,
      elapsedMs: 0, isPersonalBest: false, streak: 0,
    })
    expect(store.totalSolved).toBe(0)
  })
})

// ── awardSolve(): level-up / level-down transitions ─────────────────────────────

describe('awardSolve() - level transitions', () => {
  it('reports leveledUp when the solve reward crosses the next threshold', () => {
    const store = useProgressionStore()
    store.xp = 39   // 1 XP shy of the level-2 threshold (40)
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    const result = store.awardSolve()
    expect(result.gained).toBe(10)
    expect(store.xp).toBe(49)
    expect(store.level).toBe(2)
    expect(result.leveledUp).toBe(true)
    expect(result.leveledDown).toBe(false)
    expect(result.level).toBe(2)
  })

  it('does not report leveledUp when the reward keeps xp within the same level', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    const result = store.awardSolve()
    expect(result.leveledUp).toBe(false)
  })

  it('reports leveledDown when heavy mid-puzzle hint use outweighs the solve reward', () => {
    const store = useProgressionStore()
    store.xp = 41   // level 2
    expect(store.level).toBe(2)
    store.startPuzzle(makePuzzle(5), makeCellStates(5))   // levelAtStart = 2
    drainXpViaHints(store)
    expect(store.xp).toBe(0)
    const result = store.awardSolve()
    // The solve reward is the level-2 reward (25 XP) - the level the puzzle
    // was *started* at - not the post-hint-drained level.
    expect(result.gained).toBe(25)
    expect(store.xp).toBe(25)
    expect(store.level).toBe(1)
    expect(result.leveledDown).toBe(true)
    expect(result.leveledUp).toBe(false)
  })

  it('solve reward is based on the level at puzzle START, not the level after hint debits', () => {
    const store = useProgressionStore()
    store.xp = 41   // level 2
    store.startPuzzle(makePuzzle(5), makeCellStates(5))
    store.recordHintUsed()   // cost 5 -> xp 36 -> drops to level 1
    expect(store.level).toBe(1)
    const result = store.awardSolve()
    expect(result.gained).toBe(25)   // still the level-2 reward, not level-1's 10
  })
})

// ── recordHintUsed(): XP debit ───────────────────────────────────────────────────

describe('recordHintUsed() - XP debit for hints', () => {
  it('does nothing when there is no in-progress puzzle', () => {
    const store = useProgressionStore()
    store.recordHintUsed()
    expect(store.totalHints).toBe(0)
    expect(store.xp).toBe(0)
    expect(store.lastHintDebit).toBeNull()
  })

  it('debits the level-1 hint cost (2 XP) and records the debit', () => {
    const store = useProgressionStore()
    store.xp = 20
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.recordHintUsed()
    expect(store.xp).toBe(18)
    expect(store.current?.hintsUsed).toBe(1)
    expect(store.totalHints).toBe(1)
    expect(store.lastHintDebit).toEqual({ cost: 2, seq: 1 })
  })

  it('increments seq on every debit even when the cost repeats', () => {
    const store = useProgressionStore()
    store.xp = 20
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.recordHintUsed()
    store.recordHintUsed()
    expect(store.lastHintDebit).toEqual({ cost: 2, seq: 2 })
    expect(store.current?.hintsUsed).toBe(2)
    expect(store.totalHints).toBe(2)
  })

  it('scales hint cost with the current level (level 5 -> 35 XP)', () => {
    const store = useProgressionStore()
    store.xp = 1165   // exact level-5 threshold
    expect(store.level).toBe(5)
    store.startPuzzle(makePuzzle(8), makeCellStates(8))
    store.recordHintUsed()
    expect(store.lastHintDebit?.cost).toBe(35)   // round(175 / 5)
    expect(store.xp).toBe(1130)
  })

  it('floors xp at 0 rather than going negative', () => {
    const store = useProgressionStore()
    store.xp = 1
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.recordHintUsed()   // cost 2, only 1 xp available
    expect(store.xp).toBe(0)
  })

  it('a single hint can drop the player a level immediately', () => {
    const store = useProgressionStore()
    store.xp = 41   // level 2
    store.startPuzzle(makePuzzle(5), makeCellStates(5))
    store.recordHintUsed()   // cost 5 -> xp 36 -> below the level-2 threshold (40)
    expect(store.xp).toBe(36)
    expect(store.level).toBe(1)
  })
})

// ── Streak tracking ──────────────────────────────────────────────────────────────

describe('streak tracking', () => {
  it('increments currentStreak on consecutive clean solves and tracks bestStreak', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    let r = store.awardSolve()
    expect(r.streak).toBe(1)
    expect(store.currentStreak).toBe(1)
    expect(store.bestStreak).toBe(1)

    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    r = store.awardSolve()
    expect(r.streak).toBe(2)
    expect(store.bestStreak).toBe(2)
  })

  it('resets currentStreak to 0 on a hinted solve, without lowering bestStreak', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.awardSolve()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.awardSolve()
    expect(store.bestStreak).toBe(2)

    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.recordHintUsed()
    const r = store.awardSolve()
    expect(r.streak).toBe(0)
    expect(store.currentStreak).toBe(0)
    expect(store.bestStreak).toBe(2)   // untouched by the reset
  })
})

// ── perSize stats / personal bests ────────────────────────────────────────────────

describe('perSize stats and personal-best tracking', () => {
  it('first solve of a size is always a personal best', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    vi.advanceTimersByTime(10_000)
    const r = store.awardSolve()
    expect(r.isPersonalBest).toBe(true)
    expect(store.perSize[6]?.bestTimeMs).toBe(10_000)
  })

  it('a slower repeat solve is not a personal best and does not change bestTimeMs', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    vi.advanceTimersByTime(10_000)
    store.awardSolve()

    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    vi.advanceTimersByTime(20_000)
    const r = store.awardSolve()
    expect(r.isPersonalBest).toBe(false)
    expect(store.perSize[6]?.bestTimeMs).toBe(10_000)
    expect(store.perSize[6]?.solved).toBe(2)
    expect(store.perSize[6]?.totalTimeMs).toBe(30_000)
  })

  it('a faster repeat solve becomes the new personal best', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    vi.advanceTimersByTime(10_000)
    store.awardSolve()

    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    vi.advanceTimersByTime(4_000)
    const r = store.awardSolve()
    expect(r.isPersonalBest).toBe(true)
    expect(store.perSize[6]?.bestTimeMs).toBe(4_000)
  })

  it('tracks hintsUsed per size across solves', () => {
    const store = useProgressionStore()
    store.xp = 100
    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    store.recordHintUsed()
    store.recordHintUsed()
    store.awardSolve()
    expect(store.perSize[6]?.hintsUsed).toBe(2)
  })

  it('attributes stats to the puzzle size actually solved, not currentSize', () => {
    const store = useProgressionStore()
    // Level 1's currentSize is 4, but startPuzzle/awardSolve record whatever
    // puzzle.n was actually passed in.
    store.startPuzzle(makePuzzle(10), makeCellStates(10))
    store.awardSolve()
    expect(store.perSize[10]?.solved).toBe(1)
    expect(store.perSize[4]).toBeUndefined()
  })
})

// ── getElapsedMs() / pause() ───────────────────────────────────────────────────────

describe('getElapsedMs() and pause()', () => {
  it('returns 0 with no puzzle in progress', () => {
    const store = useProgressionStore()
    expect(store.getElapsedMs()).toBe(0)
  })

  it('accumulates elapsed time since startPuzzle', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    vi.advanceTimersByTime(3000)
    expect(store.getElapsedMs()).toBe(3000)
  })

  it('pause() banks elapsed time into accumulatedMs and resets the running clock', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    vi.advanceTimersByTime(3000)
    store.pause()
    expect(store.current?.accumulatedMs).toBe(3000)
    expect(store.getElapsedMs()).toBe(3000)
    vi.advanceTimersByTime(2000)
    expect(store.getElapsedMs()).toBe(5000)
  })

  it('pause() is a no-op with no puzzle in progress', () => {
    const store = useProgressionStore()
    expect(() => store.pause()).not.toThrow()
    expect(store.current).toBeNull()
  })
})

// ── startPuzzle() / updatePuzzleState() / clearCurrent() ───────────────────────────

describe('startPuzzle(), updatePuzzleState(), clearCurrent()', () => {
  it('startPuzzle snapshots the level and deep-copies cellStates', () => {
    const store = useProgressionStore()
    store.xp = 41   // level 2
    const cells = makeCellStates(5)
    store.startPuzzle(makePuzzle(5), cells)
    expect(store.current?.levelAtStart).toBe(2)
    expect(store.current?.hintsUsed).toBe(0)
    expect(store.current?.accumulatedMs).toBe(0)
    cells[0][0] = 'star'
    expect(store.current?.cellStates[0][0]).toBe('empty')   // unaffected by later mutation of the source array
  })

  it('updatePuzzleState deep-copies the new cellStates', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    const next = makeCellStates(4)
    next[1][1] = 'marked'
    store.updatePuzzleState(next)
    expect(store.current?.cellStates[1][1]).toBe('marked')
    next[1][1] = 'star'
    expect(store.current?.cellStates[1][1]).toBe('marked')   // unaffected by later mutation of the source array
  })

  it('updatePuzzleState is a no-op with no puzzle in progress', () => {
    const store = useProgressionStore()
    expect(() => store.updatePuzzleState(makeCellStates(4))).not.toThrow()
    expect(store.current).toBeNull()
  })

  it('clearCurrent discards the in-progress puzzle without touching xp/totals', () => {
    const store = useProgressionStore()
    store.xp = 50
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.clearCurrent()
    expect(store.current).toBeNull()
    expect(store.xp).toBe(50)
    expect(store.totalSolved).toBe(0)
  })
})

// ── reset() ────────────────────────────────────────────────────────────────────────

describe('reset()', () => {
  it('restores xp/totals/perSize/current/streaks to defaults', () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.awardSolve()
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.recordHintUsed()
    store.reset()
    expect(store.xp).toBe(0)
    expect(store.totalSolved).toBe(0)
    expect(store.totalHints).toBe(0)
    expect(store.totalTimeMs).toBe(0)
    expect(store.perSize).toEqual({})
    expect(store.current).toBeNull()
    expect(store.currentStreak).toBe(0)
    expect(store.bestStreak).toBe(0)
  })

  it('does NOT clear lastHintDebit (not one of the fields reset() touches)', () => {
    const store = useProgressionStore()
    store.xp = 20
    store.startPuzzle(makePuzzle(4), makeCellStates(4))
    store.recordHintUsed()
    expect(store.lastHintDebit).not.toBeNull()
    store.reset()
    expect(store.lastHintDebit).not.toBeNull()
  })
})

// ── Board-size / lookahead-tier gating across levels ────────────────────────────────

describe('board-size and lookahead-tier gating across levels', () => {
  it.each([
    [1, 4, 0, 0, 'Pure logic'],
    [6, 10, 0, 0, 'Pure logic'],
    [7, 4, 1, 0, '≤1 lookahead'],
  ] as const)('level %i -> size %i, tier %i, prestige %i, label "%s"', (level, size, tier, prestige, label) => {
    const store = useProgressionStore()
    store.xp = cumXpForLevel(level)
    expect(store.level).toBe(level)
    expect(store.currentSize).toBe(size)
    expect(store.currentTier).toBe(tier)
    expect(store.currentPrestige).toBe(prestige)
    expect(store.currentTierLabel).toBe(label)
  })

  it('the top lookahead tier (index 7) is labelled Unlimited with no lookahead cap', () => {
    const store = useProgressionStore()
    // Tier index 7 (the last of 8 tiers) starts at in-cycle index 42 (= 7 * 6 sizes),
    // i.e. level 43 (idx 42) within cycle 0.
    const level = 43
    store.xp = cumXpForLevel(level)
    expect(store.level).toBe(level)
    expect(store.currentSize).toBe(4)
    expect(store.currentTier).toBe(7)
    expect(store.currentMaxLookaheads).toBe(Infinity)
    expect(store.currentTierLabel).toBe('Unlimited')
  })
})

// ── Prestige cycling (open-ended progression) ───────────────────────────────────────

describe('prestige cycling (open-ended progression)', () => {
  it('PRESTIGE_CYCLE_LEN covers every (size x tier) combination once (6 sizes x 8 tiers = 48)', () => {
    expect(PRESTIGE_CYCLE_LEN).toBe(48)
  })

  it('level 48 is the last level of prestige cycle 0; level 49 starts cycle 1', () => {
    const store = useProgressionStore()
    store.xp = cumXpForLevel(48)
    expect(store.level).toBe(48)
    expect(store.currentPrestige).toBe(0)

    store.xp = cumXpForLevel(49)
    expect(store.level).toBe(49)
    expect(store.currentPrestige).toBe(1)
  })

  it('cycle 1 reuses the same size/tier ladder as cycle 0, suffixed with a roman numeral', () => {
    const store = useProgressionStore()
    store.xp = cumXpForLevel(49)   // cycle-1 equivalent of level 1 (size 4, tier 0)
    expect(store.currentSize).toBe(4)
    expect(store.currentTier).toBe(0)
    expect(store.currentTierLabel).toBe('Pure logic II')
  })

  it('cycle 2 is suffixed III, and so on', () => {
    const store = useProgressionStore()
    store.xp = cumXpForLevel(97)   // 2 * 48 + 1
    expect(store.currentPrestige).toBe(2)
    expect(store.currentTierLabel).toBe('Pure logic III')
  })

  it('reward and hint cost double in cycle 1 vs. cycle 0 for the equivalent level', () => {
    expect(xpForSolve(49)).toBe(2 * xpForSolve(1))
    expect(hintCostForLevel(49)).toBe(2 * hintCostForLevel(1))
  })

  it('isMaxLevel stays false arbitrarily far into the progression', () => {
    const store = useProgressionStore()
    store.xp = cumXpForLevel(500)
    expect(store.level).toBe(500)
    expect(store.isMaxLevel).toBe(false)
  })
})

// ── Persistence: load on store creation ─────────────────────────────────────────────

describe('persistence - load on store creation', () => {
  it('falls back to default state when nothing is stored', () => {
    const store = useProgressionStore()
    expect(store.xp).toBe(0)
    expect(store.current).toBeNull()
  })

  it('falls back to default state on corrupt JSON', () => {
    ls.map.set(STORAGE_KEY, 'not-json{')
    const store = useProgressionStore()
    expect(store.xp).toBe(0)
    expect(store.totalSolved).toBe(0)
  })

  it('falls back to default state on a version mismatch', () => {
    ls.map.set(STORAGE_KEY, JSON.stringify({
      version: 2, xp: 999, totalSolved: 5, totalHints: 0, totalTimeMs: 0, perSize: {}, current: null,
    }))
    const store = useProgressionStore()
    expect(store.xp).toBe(0)
    expect(store.totalSolved).toBe(0)
  })

  it('falls back to default state when localStorage.getItem throws', () => {
    const bad = makeStorage({ throwOnGet: true })
    vi.stubGlobal('localStorage', bad.storage)
    const store = useProgressionStore()
    expect(store.xp).toBe(0)
  })

  it('restores xp/totals/perSize/streaks from valid stored data', () => {
    const saved: PersistedProgression = {
      version: 1,
      xp: 500,
      totalSolved: 12,
      totalHints: 3,
      totalTimeMs: 999_000,
      perSize: { 4: { solved: 12, bestTimeMs: 8000, totalTimeMs: 999_000, hintsUsed: 3 } },
      current: null,
      currentStreak: 4,
      bestStreak: 9,
    }
    ls.map.set(STORAGE_KEY, JSON.stringify(saved))
    const store = useProgressionStore()
    expect(store.xp).toBe(500)
    expect(store.totalSolved).toBe(12)
    expect(store.totalHints).toBe(3)
    expect(store.totalTimeMs).toBe(999_000)
    expect(store.perSize).toEqual(saved.perSize)
    expect(store.currentStreak).toBe(4)
    expect(store.bestStreak).toBe(9)
  })

  it('defaults currentStreak/bestStreak to 0 when absent from older saved data', () => {
    const saved: PersistedProgression = {
      version: 1, xp: 10, totalSolved: 1, totalHints: 0, totalTimeMs: 100,
      perSize: {}, current: null,
      // currentStreak / bestStreak intentionally omitted - pre-dates the fields
    }
    ls.map.set(STORAGE_KEY, JSON.stringify(saved))
    const store = useProgressionStore()
    expect(store.currentStreak).toBe(0)
    expect(store.bestStreak).toBe(0)
  })

  it('resets a restored in-progress puzzle startedAt to "now" (pause-on-reload semantics)', () => {
    const saved: PersistedProgression = {
      version: 1, xp: 0, totalSolved: 0, totalHints: 0, totalTimeMs: 0, perSize: {},
      current: {
        puzzle: makePuzzle(4), cellStates: makeCellStates(4),
        hintsUsed: 1, startedAt: -99999, accumulatedMs: 7000, levelAtStart: 1,
      },
    }
    ls.map.set(STORAGE_KEY, JSON.stringify(saved))
    vi.setSystemTime(123456)
    const store = useProgressionStore()
    expect(store.current?.startedAt).toBe(123456)
    expect(store.current?.accumulatedMs).toBe(7000)   // preserved
    expect(store.getElapsedMs()).toBe(7000)            // no time has passed since "resume"
  })

  it('falls back to the current level when a restored puzzle predates levelAtStart', () => {
    const saved: PersistedProgression = {
      version: 1, xp: 0, totalSolved: 0, totalHints: 0, totalTimeMs: 0, perSize: {},
      current: {
        puzzle: makePuzzle(4), cellStates: makeCellStates(4),
        hintsUsed: 0, startedAt: 0, accumulatedMs: 0,
        // levelAtStart intentionally omitted - pre-dates the field
      },
    }
    ls.map.set(STORAGE_KEY, JSON.stringify(saved))
    const store = useProgressionStore()
    expect(store.level).toBe(1)
    const result = store.awardSolve()
    expect(result.gained).toBe(10)   // falls back to the current level's (1) reward
  })
})

// ── Persistence: debounced save on mutation ─────────────────────────────────────────

describe('persistence - debounced save on mutation', () => {
  it('does not write to storage before the 250ms debounce elapses', async () => {
    const store = useProgressionStore()
    store.xp = 5
    await nextTick()
    vi.advanceTimersByTime(100)
    expect(ls.storage.setItem).not.toHaveBeenCalled()
  })

  it('writes the full persisted shape after the debounce elapses', async () => {
    const store = useProgressionStore()
    store.xp = 5
    await nextTick()
    vi.advanceTimersByTime(300)
    expect(ls.storage.setItem).toHaveBeenCalledTimes(1)
    const raw = ls.map.get(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed).toMatchObject({
      version: 1, xp: 5, totalSolved: 0, totalHints: 0, totalTimeMs: 0,
      perSize: {}, current: null, currentStreak: 0, bestStreak: 0,
    })
  })

  it('collapses rapid successive mutations into a single debounced write of the final state', async () => {
    const store = useProgressionStore()
    store.xp = 5
    await nextTick()
    vi.advanceTimersByTime(100)   // first save timer scheduled, not yet fired
    store.xp = 10
    await nextTick()              // reschedules - clears the first timer
    vi.advanceTimersByTime(300)
    expect(ls.storage.setItem).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(ls.map.get(STORAGE_KEY)!)
    expect(parsed.xp).toBe(10)
  })

  it('does not throw when localStorage.setItem fails (quota exceeded)', async () => {
    const bad = makeStorage({ throwOnSet: true })
    vi.stubGlobal('localStorage', bad.storage)
    const store = useProgressionStore()
    store.xp = 5
    await nextTick()
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  })

  it('round-trips through save + reload: a second store instance picks up the saved state', async () => {
    const store = useProgressionStore()
    store.startPuzzle(makePuzzle(6), makeCellStates(6))
    vi.advanceTimersByTime(15_000)
    store.awardSolve()
    await nextTick()
    vi.advanceTimersByTime(300)

    // Simulate a page reload: fresh pinia instance, same underlying storage.
    setActivePinia(createPinia())
    const reloaded = useProgressionStore()
    expect(reloaded.xp).toBe(store.xp)
    expect(reloaded.totalSolved).toBe(1)
    expect(reloaded.perSize[6]?.bestTimeMs).toBe(15_000)
  })
})
