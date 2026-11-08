import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DRAMA, selectPuzzle } from '../select'
import { pickSize, sizeFor, SIZE_WEIGHTS } from '../cli'
import { PUZZLE_8, PUZZLE_9 } from './fixtures'

vi.mock('../../src/solver/generator', () => ({ generatePuzzle: vi.fn() }))
import { generatePuzzle } from '../../src/solver/generator'
const mockGenerate = vi.mocked(generatePuzzle)

beforeEach(() => {
  mockGenerate.mockReset()
  mockGenerate.mockImplementation(() => structuredClone(PUZZLE_8))
})

describe('DRAMA table', () => {
  it('covers sizes 5–10 with sane windows', () => {
    expect(Object.keys(DRAMA).map(Number).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10])
    for (const [lo, hi] of Object.values(DRAMA)) expect(lo).toBeLessThan(hi)
    expect(DRAMA).toEqual({
      5: [22, 60], 6: [40, 150], 7: [100, 600], 8: [200, 900], 9: [280, 1600], 10: [350, 2500],
    })
  })
})

describe('selectPuzzle', () => {
  it('accepts a trace inside the window with finalRun >= 3', () => {
    const sel = selectPuzzle(123, 8, { drama: [61, 61] }) // PUZZLE_8: 61 placements, final run 4
    expect(sel.attempts).toBe(1)
    expect(mockGenerate.mock.calls.length).toBe(1) // early return, not best-miss
    expect(sel.trace.stats.placements).toBe(61)
    expect(sel.puzzle.id).toMatch(/^sb-8-[0-9a-z]+$/)
    expect(sel.puzzle.title).toBe('8×8')
  })

  it('accepts PUZZLE_9 under its default window', () => {
    mockGenerate.mockImplementation(() => structuredClone(PUZZLE_9))
    const sel = selectPuzzle(7, 9) // 431 placements in DRAMA[9] = [280, 1600], final run 4
    expect(sel.attempts).toBe(1)
  })

  it('honours the drama override (melody path)', () => {
    // 61 placements is below the default 8×8 floor (200) but inside the override:
    // accepted on attempt 0 with early return (1 generator call, not 5).
    const sel = selectPuzzle(123, 8, { drama: [60, 62], maxAttempts: 5 })
    expect(sel.attempts).toBe(1)
    expect(mockGenerate.mock.calls.length).toBe(1)
  })

  it('falls back to best-miss instead of throwing when nothing fits', () => {
    // 61 placements misses the default [200, 900] on all 3 attempts: returns rather
    // than throws. attempts is the 1-based index where the best was found — ties keep
    // the first, so identical candidates report attempts === 1 after 3 runs.
    const sel = selectPuzzle(123, 8, { maxAttempts: 3 })
    expect(sel.trace.stats.placements).toBe(61)
    expect(sel.attempts).toBe(1)
    expect(mockGenerate.mock.calls.length).toBe(3)
  })

  it('returns the closest-to-window candidate when nothing fits', () => {
    // Window [1000, 2000]: PUZZLE_8 (61, miss .939) then PUZZLE_9 (431, miss .569).
    mockGenerate.mockReset()
    mockGenerate.mockImplementationOnce(() => structuredClone(PUZZLE_8))
    mockGenerate.mockImplementationOnce(() => structuredClone(PUZZLE_9))
    const sel = selectPuzzle(123, 8, { drama: [1000, 2000], maxAttempts: 2 })
    expect(sel.trace.stats.placements).toBe(431)
    expect(sel.attempts).toBe(2)
  })

  it('throws only when the generator always returns null', () => {
    mockGenerate.mockReturnValue(null)
    expect(() => selectPuzzle(123, 8, { maxAttempts: 2 })).toThrow(/could not generate a 8×8 puzzle/)
  })

  it('is deterministic per (seed, n)', () => {
    const a = selectPuzzle(999, 8, { drama: [61, 61] })
    const b = selectPuzzle(999, 8, { drama: [61, 61] })
    expect(a.puzzleSeed).toBe(b.puzzleSeed)
    expect(a.trace.stats.placements).toBe(b.trace.stats.placements)
  })

  it('logs one line per attempt when given a logger', () => {
    const lines: string[] = []
    selectPuzzle(123, 8, { drama: [61, 61], log: s => lines.push(s) })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/attempt 0: 61 placements/)
  })
})

describe('pickSize / sizeFor', () => {
  it('SIZE_WEIGHTS sums to 1 over 5–8 only', () => {
    expect(SIZE_WEIGHTS.map(([n]) => n)).toEqual([5, 6, 7, 8])
    expect(SIZE_WEIGHTS.reduce((a, [, w]) => a + w, 0)).toBeCloseTo(1, 10)
  })

  it('pickSize deals equal odds over 5–8, never 9+', () => {
    const counts = new Map<number, number>()
    for (let seed = 0; seed < 2000; seed++) {
      const n = pickSize(seed)
      counts.set(n, (counts.get(n) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([5, 6, 7, 8])
    for (const n of [5, 6, 7, 8]) {
      expect(counts.get(n)!).toBeGreaterThanOrEqual(440)
      expect(counts.get(n)!).toBeLessThanOrEqual(560)
    }
  })

  it('sizeFor routes melody to 7 and challenge to 5|6', () => {
    for (const seed of [1, 2, 3, 42, 999, 123456]) expect(sizeFor('melody', seed)).toBe(7)
    const seen = new Set<number>()
    for (let seed = 0; seed < 500; seed++) seen.add(sizeFor('challenge', seed))
    expect([...seen].sort()).toEqual([5, 6])
  })

  it('sizeFor routes classic through pickSize', () => {
    for (const seed of [0, 1, 42, 777, 99999]) expect(sizeFor('classic', seed)).toBe(pickSize(seed))
  })
})
