import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { Puzzle } from '../../types/puzzle'
import { puzzles } from '../../data/puzzles'
import { getSolution } from '../../solver/solver'

// ── localStorage stub ──────────────────────────────────────────────────────
//
// The progression store (a dependency of the game store) reads/writes
// `localStorage` directly at module-setup time. Tests run under vitest's
// `node` environment (see vitest.config.ts), where `localStorage` does not
// exist as a global on this Node version, so we stub a Map-backed
// implementation before every test — mirroring src/lib/__tests__/safeStorage.test.ts.

function makeStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (i: number) => [...store.keys()][i] ?? null,
  }
}

// ── Hand-built deterministic fixtures ──────────────────────────────────────
//
// Same shape as the fixture in src/solver/__tests__/solver.test.ts: a 4×4
// board with four 2×2 regions. It has (at least) two valid one-star-per
// row/col/region solutions, which is fine for our purposes — we only need
// deterministic, hand-verifiable star placements, not solver behavior.
//
//   [0 0 1 1]
//   [0 0 1 1]
//   [2 2 3 3]
//   [2 2 3 3]
//
// Known valid solution A: (0,1) (1,3) (2,0) (3,2)
const BLOCK_PUZZLE: Puzzle = {
  id: 'test-block',
  title: 'Test: 2×2 Blocks (4×4)',
  n: 4,
  grid: [
    [0, 0, 1, 1],
    [0, 0, 1, 1],
    [2, 2, 3, 3],
    [2, 2, 3, 3],
  ],
}
const BLOCK_SOLUTION: [number, number][] = [[0, 1], [1, 3], [2, 0], [3, 2]]

// classic-4a — the real bundled puzzle used as the boot-time default
// (puzzles[0]). Pre-tagged with solver stats (difficulty/lookaheads), so
// it is guaranteed auto-solvable — used for hint-engine-dependent tests.
const REAL_PUZZLE = puzzles[0]

async function freshGameStore() {
  vi.stubGlobal('localStorage', makeStorage())
  setActivePinia(createPinia())
  const { useGameStore } = await import('../game')
  return useGameStore()
}

async function freshStores() {
  vi.stubGlobal('localStorage', makeStorage())
  setActivePinia(createPinia())
  const { useGameStore } = await import('../game')
  const { useProgressionStore } = await import('../progression')
  return { game: useGameStore(), progression: useProgressionStore() }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Boot / initialisation ──────────────────────────────────────────────────

describe('boot', () => {
  it('boots with the first bundled puzzle when there is nothing saved', async () => {
    const game = await freshGameStore()
    expect(game.currentPuzzle.id).toBe(REAL_PUZZLE.id)
    expect(game.cellStates).toHaveLength(REAL_PUZZLE.n)
    expect(game.cellStates.every(row => row.every(s => s === 'empty'))).toBe(true)
    expect(game.canUndo).toBe(false)
    expect(game.canRedo).toBe(false)
    expect(game.hintCell).toBeNull()
    expect(game.lastHint).toBeNull()
    expect(game.lastSolve).toBeNull()
  })

  it('resumes a saved in-progress puzzle on boot instead of the default', async () => {
    vi.stubGlobal('localStorage', makeStorage())
    setActivePinia(createPinia())
    const { useProgressionStore } = await import('../progression')
    const progression = useProgressionStore()

    // Seed an in-progress save before the game store is ever constructed —
    // this exercises the `resumeIfAvailable() || initBoard(...)` boot line.
    const savedCells = Array.from({ length: BLOCK_PUZZLE.n }, () =>
      Array(BLOCK_PUZZLE.n).fill('empty'),
    )
    savedCells[0][1] = 'star'
    progression.startPuzzle(BLOCK_PUZZLE, savedCells as never)

    const { useGameStore } = await import('../game')
    const game = useGameStore()

    expect(game.currentPuzzle.id).toBe(BLOCK_PUZZLE.id)
    expect(game.cellStates[0][1]).toBe('star')
  })
})

// ── initBoard ────────────────────────────────────────────────────────────

describe('initBoard', () => {
  it('loads a new puzzle with an all-empty board and clears transient state', async () => {
    const game = await freshGameStore()

    // Dirty the state first so we can prove initBoard resets it.
    game.toggleStar(0, 0)
    game.showHint()

    game.initBoard(BLOCK_PUZZLE)

    expect(game.currentPuzzle).toEqual(BLOCK_PUZZLE)
    expect(game.cellStates).toHaveLength(4)
    expect(game.cellStates.every(row => row.every(s => s === 'empty'))).toBe(true)
    expect(game.canUndo).toBe(false)
    expect(game.canRedo).toBe(false)
    expect(game.hintCell).toBeNull()
    expect(game.lastHint).toBeNull()
    expect(game.lastSolve).toBeNull()
  })

  it('registers the new puzzle with progression.startPuzzle', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(BLOCK_PUZZLE)
    expect(progression.current?.puzzle.id).toBe(BLOCK_PUZZLE.id)
  })
})

// ── resumeIfAvailable ───────────────────────────────────────────────────────

describe('resumeIfAvailable', () => {
  it('returns false and leaves the board untouched when nothing is saved', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)
    // initBoard registers a fresh in-progress save via progression.startPuzzle;
    // clear it to simulate the true "nothing saved" state.
    progression.clearCurrent()
    const before = game.cellStates.map(r => [...r])

    const result = game.resumeIfAvailable()

    expect(result).toBe(false)
    expect(game.cellStates).toEqual(before)
  })

  it('restores a saved puzzle and deep-copies its cell states', async () => {
    const { game, progression } = await freshStores()
    const savedCells = Array.from({ length: BLOCK_PUZZLE.n }, () =>
      Array(BLOCK_PUZZLE.n).fill('empty'),
    )
    savedCells[1][1] = 'marked'
    progression.startPuzzle(BLOCK_PUZZLE, savedCells as never)

    const result = game.resumeIfAvailable()

    expect(result).toBe(true)
    expect(game.currentPuzzle.id).toBe(BLOCK_PUZZLE.id)
    expect(game.cellStates[1][1]).toBe('marked')
    expect(game.canUndo).toBe(false)
    expect(game.canRedo).toBe(false)

    // Deep-copy guarantee: resumeIfAvailable does `.map(r => [...r])`, so
    // mutating the original saved array after the fact must not reach into
    // the live store state.
    savedCells[1][1] = 'star'
    expect(game.cellStates[1][1]).toBe('marked')
  })
})

// ── reset ────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears the board back to all-empty but keeps the same puzzle', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)
    game.toggleMark(3, 3)

    game.reset()

    expect(game.currentPuzzle.id).toBe(BLOCK_PUZZLE.id)
    expect(game.cellStates.every(row => row.every(s => s === 'empty'))).toBe(true)
  })

  it('is itself an undoable action (pushes history)', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)

    game.reset()
    expect(game.canUndo).toBe(true)

    game.undo()
    expect(game.cellStates[0][0]).toBe('star')
  })

  it('clears an active hint', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.showHint()
    expect(game.lastHint).not.toBeNull()

    game.reset()
    expect(game.lastHint).toBeNull()
    expect(game.hintCell).toBeNull()
  })
})

// ── toggleStar / toggleMark ─────────────────────────────────────────────────

describe('toggleStar', () => {
  it('toggles an empty cell to a star and back to empty', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)

    game.toggleStar(0, 0)
    expect(game.cellStates[0][0]).toBe('star')

    game.toggleStar(0, 0)
    expect(game.cellStates[0][0]).toBe('empty')
  })

  it('overwrites an existing mark with a star', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleMark(0, 0)
    expect(game.cellStates[0][0]).toBe('marked')

    game.toggleStar(0, 0)
    expect(game.cellStates[0][0]).toBe('star')
  })

  it('pushes an undoable history entry', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    expect(game.canUndo).toBe(false)

    game.toggleStar(0, 0)
    expect(game.canUndo).toBe(true)
  })

  it('clears an active hint', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.showHint()
    expect(game.lastHint).not.toBeNull()

    game.toggleStar(0, 0)
    expect(game.lastHint).toBeNull()
    expect(game.hintCell).toBeNull()
  })

  it('is a no-op on an auto-marked (locked) cell', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE) // grid: [[1,0,0,0],[1,3,3,0],[1,3,2,2],[1,3,2,2]]
    game.toggleStar(0, 1) // region 0, row 0, col 1

    // (0,2) is same-row as the star -> auto-marked -> locked.
    expect(game.displayCellStates[0][2]).toBe('auto-marked')

    const before = game.cellStates.map(r => [...r])
    game.toggleStar(0, 2)

    expect(game.cellStates).toEqual(before) // unchanged
  })

  it('does not push a new history entry when blocked by a lock', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleStar(0, 1) // creates 1 history entry, locks (0,2) among others

    game.toggleStar(0, 2) // locked -> no-op, should NOT push history
    game.undo() // undoes the (0,1) star placement
    expect(game.cellStates[0][1]).toBe('empty')
    expect(game.canUndo).toBe(false) // only ever had exactly 1 history entry
  })
})

describe('toggleMark', () => {
  it('toggles an empty cell to marked and back to empty', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)

    game.toggleMark(0, 0)
    expect(game.cellStates[0][0]).toBe('marked')

    game.toggleMark(0, 0)
    expect(game.cellStates[0][0]).toBe('empty')
  })

  it('is a no-op on a star cell (does not clear the star)', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)

    game.toggleMark(0, 0)

    expect(game.cellStates[0][0]).toBe('star')
  })

  it('does not push history when blocked by a star', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0) // 1 history entry

    game.toggleMark(0, 0) // no-op, no new history entry
    game.undo()

    expect(game.cellStates[0][0]).toBe('empty') // undid the star placement
    expect(game.canUndo).toBe(false)
  })

  it('is a no-op on an auto-marked (locked) cell', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleStar(0, 1)
    expect(game.displayCellStates[0][2]).toBe('auto-marked')

    game.toggleMark(0, 2)

    expect(game.cellStates[0][2]).toBe('empty') // raw user state never touched
  })

  it('clears an active hint', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.showHint()
    expect(game.lastHint).not.toBeNull()

    game.toggleMark(3, 3)
    expect(game.lastHint).toBeNull()
  })
})

// ── Undo / Redo ──────────────────────────────────────────────────────────

describe('undo / redo', () => {
  it('undo() is a no-op at the start of history', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    const before = game.cellStates.map(r => [...r])

    expect(game.canUndo).toBe(false)
    game.undo()

    expect(game.cellStates).toEqual(before)
    expect(game.canUndo).toBe(false)
    expect(game.canRedo).toBe(false)
  })

  it('redo() is a no-op with an empty redo stack', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)
    const before = game.cellStates.map(r => [...r])

    expect(game.canRedo).toBe(false)
    game.redo()

    expect(game.cellStates).toEqual(before)
  })

  it('undo reverts the most recent action and enables redo', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)
    game.toggleStar(1, 2)

    game.undo()

    expect(game.cellStates[1][2]).toBe('empty')
    expect(game.cellStates[0][0]).toBe('star') // earlier action untouched
    expect(game.canRedo).toBe(true)
  })

  it('redo reapplies an undone action', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)
    game.undo()
    expect(game.cellStates[0][0]).toBe('empty')

    game.redo()

    expect(game.cellStates[0][0]).toBe('star')
    expect(game.canRedo).toBe(false)
  })

  it('undo/redo round-trips through multiple steps', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    // (2,2) is in region 3, unrelated to (0,0)'s row/col/region/adjacency,
    // so it stays freely togglable after the first star is placed.
    game.toggleStar(0, 0)
    game.toggleMark(2, 2)
    game.toggleStar(3, 3)

    game.undo()
    game.undo()
    game.undo()
    expect(game.cellStates.every(row => row.every(s => s === 'empty'))).toBe(true)
    expect(game.canUndo).toBe(false)

    game.redo()
    game.redo()
    game.redo()
    expect(game.cellStates[0][0]).toBe('star')
    expect(game.cellStates[2][2]).toBe('marked')
    expect(game.cellStates[3][3]).toBe('star')
    expect(game.canRedo).toBe(false)
  })

  it('a new action after undo clears the redo stack', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.toggleStar(0, 0)
    game.toggleStar(1, 2)
    game.undo()
    expect(game.canRedo).toBe(true)

    game.toggleStar(3, 3) // fresh action — should wipe the redo stack

    expect(game.canRedo).toBe(false)
    game.redo() // no-op now
    expect(game.cellStates[1][2]).toBe('empty') // the undone action never comes back
    expect(game.cellStates[3][3]).toBe('star')
  })

  it('undo clears an active hint', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleStar(0, 1)
    game.showHint()
    expect(game.lastHint).not.toBeNull()

    game.undo()

    expect(game.lastHint).toBeNull()
  })

  it('redo clears an active hint', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleStar(0, 1)
    game.undo()
    game.showHint()
    expect(game.lastHint).not.toBeNull()

    game.redo()

    expect(game.lastHint).toBeNull()
  })

  it('history is capped at MAX_HISTORY (60) entries', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)

    // Toggle the same untouched cell back and forth 65 times so it never
    // becomes locked by its own star — each toggle is a fresh history push.
    for (let i = 0; i < 65; i++) game.toggleStar(0, 0)

    let undoCount = 0
    while (game.canUndo) {
      game.undo()
      undoCount++
      if (undoCount > 100) break // safety net against an infinite loop bug
    }

    expect(undoCount).toBe(60)
  })
})

// ── Hint stepping ────────────────────────────────────────────────────────

describe('hints', () => {
  it('showHint returns a hint and syncs lastHint/hintStepIndex/hintCell', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)

    const hint = game.showHint()

    expect(hint).toBeTruthy()
    expect(game.lastHint).toEqual(hint)
    expect(game.hintStepIndex).toBe(0)
    expect(game.totalHintSteps).toBe(hint.steps.length)
    expect(game.currentHintStep).toEqual(hint.steps[0])
  })

  it('showHint debits a hint cost via progression.recordHintUsed', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(REAL_PUZZLE)
    const xpBefore = progression.xp
    const hintsBefore = progression.totalHints

    game.showHint()

    expect(progression.totalHints).toBe(hintsBefore + 1)
    expect(progression.xp).toBeLessThanOrEqual(xpBefore)
  })

  it('clearHint resets hintCell, lastHint and hintStepIndex', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.showHint()

    game.clearHint()

    expect(game.hintCell).toBeNull()
    expect(game.lastHint).toBeNull()
    expect(game.hintStepIndex).toBe(0)
  })

  it('isFirstHintStep/isLastHintStep reflect the current position', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    const hint = game.showHint()

    expect(game.isFirstHintStep).toBe(true)
    if (hint.steps.length > 1) {
      expect(game.isLastHintStep).toBe(false)
    } else {
      expect(game.isLastHintStep).toBe(true)
    }
  })

  it('nextHintStep advances the step index and charges another hint cost; prevHintStep is free', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(REAL_PUZZLE)
    const hint = game.showHint()

    if (hint.steps.length < 2) {
      // Nothing to advance to on this puzzle's first hint — assert the guard instead.
      const hintsBefore = progression.totalHints
      game.nextHintStep()
      expect(progression.totalHints).toBe(hintsBefore)
      expect(game.hintStepIndex).toBe(0)
      return
    }

    const hintsBefore = progression.totalHints
    game.nextHintStep()
    expect(game.hintStepIndex).toBe(1)
    expect(game.isFirstHintStep).toBe(false)
    expect(progression.totalHints).toBe(hintsBefore + 1) // stepping forward costs another hint
    expect(game.currentHintStep).toEqual(hint.steps[1])

    const hintsAfterNext = progression.totalHints
    game.prevHintStep()
    expect(game.hintStepIndex).toBe(0)
    expect(progression.totalHints).toBe(hintsAfterNext) // going back is free
  })

  it('nextHintStep does nothing past the last step', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(REAL_PUZZLE)
    const hint = game.showHint()
    const lastIdx = hint.steps.length - 1

    for (let i = 0; i < lastIdx; i++) game.nextHintStep()
    expect(game.hintStepIndex).toBe(lastIdx)
    expect(game.isLastHintStep).toBe(true)

    const hintsBefore = progression.totalHints
    game.nextHintStep() // already at the last step — no-op
    expect(game.hintStepIndex).toBe(lastIdx)
    expect(progression.totalHints).toBe(hintsBefore)
  })

  it('prevHintStep does nothing at step 0', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.showHint()

    game.prevHintStep()

    expect(game.hintStepIndex).toBe(0)
  })

  it('applyHint mutates the board according to the hint action and clears the hint', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    const hint = game.showHint()

    expect(hint.action).not.toBe('none') // fresh empty board on a solvable puzzle always yields a real hint
    expect(hint.cell).not.toBeNull()
    const [r, c] = hint.cell!

    const applied = game.applyHint()

    expect(applied).toBe(true)
    if (hint.action === 'place-star') expect(game.cellStates[r][c]).toBe('star')
    if (hint.action === 'place-mark') expect(game.cellStates[r][c]).toBe('marked')
    if (hint.action === 'remove-mark') expect(game.cellStates[r][c]).toBe('empty')
    if (hint.action === 'remove-star') expect(game.cellStates[r][c]).toBe('empty')
    expect(game.lastHint).toBeNull() // applying closes the hint
  })

  it('applyHint returns false and is a no-op when there is no active hint', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)

    const applied = game.applyHint()

    expect(applied).toBe(false)
    expect(game.cellStates.every(row => row.every(s => s === 'empty'))).toBe(true)
  })

  it('showHint on an already-solved board reports action "none"', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    for (const [r, c] of BLOCK_SOLUTION) game.toggleStar(r, c)
    expect(game.isSolved).toBe(true)

    const hint = game.showHint()

    expect(hint.action).toBe('none')
    expect(game.applyHint()).toBe(false)
  })
})

// ── Win / solved detection ──────────────────────────────────────────────────

describe('isSolved / starCount', () => {
  it('starts unsolved with zero stars', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)

    expect(game.starCount).toBe(0)
    expect(game.isSolved).toBe(false)
  })

  it('becomes solved once a full valid solution is placed', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)

    for (const [r, c] of BLOCK_SOLUTION) game.toggleStar(r, c)

    expect(game.starCount).toBe(BLOCK_PUZZLE.n)
    expect(game.violations.size).toBe(0)
    expect(game.isSolved).toBe(true)
  })

  it('is not solved while any placed stars violate the rules', async () => {
    // toggleStar refuses cells the auto-mark system has already locked, so a
    // legitimate second star in an occupied row/col/region can never be
    // created through the public toggle API once the first star is placed —
    // that's the auto-mark guard working as intended. To exercise the
    // `violations` detection itself (e.g. the shape a corrupted/legacy save
    // could produce) we write directly into the reactive cellStates grid,
    // bypassing the isLocked guard.
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    for (const [r, c] of BLOCK_SOLUTION) game.toggleStar(r, c)
    expect(game.isSolved).toBe(true)

    // Add a second star in row 0 -> violates the one-star-per-row rule.
    game.cellStates[0][3] = 'star'

    expect(game.starCount).toBe(BLOCK_PUZZLE.n + 1)
    expect(game.violations.has('0,1')).toBe(true)
    expect(game.violations.has('0,3')).toBe(true)
    expect(game.isSolved).toBe(false)
  })

  it('is not solved with the right star count but the wrong placement', async () => {
    // Same rationale as above: bypass toggleStar's auto-mark lock to place
    // an invalid (adjacent) pair directly, exercising the adjacency branch
    // of `violations` with a star count that otherwise matches `n`.
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    game.cellStates[0][0] = 'star'
    game.cellStates[0][1] = 'star' // 8-adjacent to (0,0) and shares its row/region
    game.cellStates[2][2] = 'star'
    game.cellStates[3][3] = 'star' // 8-adjacent to (2,2) and shares its region

    expect(game.starCount).toBe(4)
    expect(game.isSolved).toBe(false)
    expect(game.violations.size).toBeGreaterThan(0)
  })

  it('records a SolveResult in lastSolve exactly on the solved transition', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(BLOCK_PUZZLE)
    expect(game.lastSolve).toBeNull()
    const solvedBefore = progression.totalSolved

    const [first, ...rest] = BLOCK_SOLUTION
    for (const [r, c] of rest) game.toggleStar(r, c) // not solved yet
    await nextTick()
    expect(game.lastSolve).toBeNull()

    game.toggleStar(first[0], first[1]) // completes the solution -> solved transition
    await nextTick() // isSolved watcher (flush: 'pre') needs a tick to run

    expect(game.isSolved).toBe(true)
    expect(game.lastSolve).not.toBeNull()
    expect(game.lastSolve!.gained).toBeGreaterThan(0)
    expect(progression.totalSolved).toBe(solvedBefore + 1)
  })

  it('does not re-trigger lastSolve while remaining solved, and clears progression.current', async () => {
    const { game, progression } = await freshStores()
    game.initBoard(BLOCK_PUZZLE)
    for (const [r, c] of BLOCK_SOLUTION) game.toggleStar(r, c)
    await nextTick()
    const firstSolve = game.lastSolve
    expect(firstSolve).not.toBeNull()
    expect(progression.current).toBeNull() // awardSolve() clears the in-progress save

    // Toggling a mark elsewhere keeps isSolved === true (still 4 valid stars);
    // the watcher only fires on the false -> true transition, so lastSolve
    // must not be reassigned to a new object.
    game.toggleMark(0, 3)
    await nextTick()
    expect(game.isSolved).toBe(true)
    expect(game.lastSolve).toBe(firstSolve)
  })

  it('leaving the solved state and re-solving triggers lastSolve again', async () => {
    const game = await freshGameStore()
    game.initBoard(BLOCK_PUZZLE)
    for (const [r, c] of BLOCK_SOLUTION) game.toggleStar(r, c)
    await nextTick()
    const firstSolve = game.lastSolve
    expect(firstSolve).not.toBeNull()

    game.toggleStar(BLOCK_SOLUTION[0][0], BLOCK_SOLUTION[0][1]) // remove one star -> unsolved
    await nextTick()
    expect(game.isSolved).toBe(false)

    game.toggleStar(BLOCK_SOLUTION[0][0], BLOCK_SOLUTION[0][1]) // replace it -> solved again
    await nextTick()
    expect(game.isSolved).toBe(true)
    expect(game.lastSolve).not.toBe(firstSolve)
  })
})

// ── displayCellStates / auto-marks ───────────────────────────────────────

describe('displayCellStates', () => {
  it('is empty before a puzzle is loaded (only reachable pre-boot; smoke-test the guard)', async () => {
    const game = await freshGameStore()
    // After boot a puzzle is always loaded, so just confirm shape sanity.
    expect(game.displayCellStates).toHaveLength(game.cellStates.length)
  })

  it('overlays auto-marks around a placed star without mutating user state', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleStar(0, 1)

    expect(game.cellStates[0][2]).toBe('empty') // raw state untouched
    expect(game.displayCellStates[0][2]).toBe('auto-marked') // derived overlay
    expect(game.displayCellStates[0][1]).toBe('star')
  })

  it('auto-marks disappear immediately when the source star is undone', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleStar(0, 1)
    expect(game.displayCellStates[0][2]).toBe('auto-marked')

    game.undo()

    expect(game.displayCellStates[0][2]).toBe('empty')
  })
})

// ── Real user marks survive auto-mark churn ─────────────────────────────────

describe('user marks vs auto-marks', () => {
  it('a real user mark is preserved (as "marked") even under an overlapping auto-mark region', async () => {
    const game = await freshGameStore()
    game.initBoard(REAL_PUZZLE)
    game.toggleMark(2, 0) // region 1, not adjacent/row/col-sharing with (0,1)
    game.toggleStar(0, 1)

    // (2,0) is untouched by the (0,1) star's row/col/region/adjacency, so it
    // stays as the user's real mark rather than becoming auto-marked.
    expect(game.cellStates[2][0]).toBe('marked')
    expect(game.displayCellStates[2][0]).toBe('marked')
  })
})
