import { describe, it, expect } from 'vitest'
import { dailyFormat, FORMATS, assertValidFormat, nextDailyNumber, dailyFilename, dailyLogEntry } from '../cli'
import { traceDfs } from '../trace'
import { PUZZLE_8 } from './fixtures'

describe('nextDailyNumber', () => {
  it('is 1 when the log is missing', () => {
    expect(nextDailyNumber(null)).toBe(1)
  })

  it('counts non-blank lines + 1', () => {
    expect(nextDailyNumber('')).toBe(1)
    expect(nextDailyNumber('a\n\nb\n')).toBe(3)
    expect(nextDailyNumber('{"number":1}\n{"number":2}\n')).toBe(3)
  })

  it('lets --number override the log, including 0', () => {
    expect(nextDailyNumber('a\nb\n', 42)).toBe(42)
    expect(nextDailyNumber(null, 0)).toBe(0)
  })
})

describe('dailyFilename', () => {
  it('has no prefix for classic, format prefixes otherwise', () => {
    expect(dailyFilename('2026-11-08', 'classic', 8, 7)).toBe('2026-11-08-star-battle-8x8-puzzle-7.mp4')
    expect(dailyFilename('2026-11-08', 'melody', 7, 7)).toBe('2026-11-08-melody-star-battle-7x7-puzzle-7.mp4')
    expect(dailyFilename('2026-11-08', 'challenge', 5, 7)).toBe('2026-11-08-challenge-star-battle-5x5-puzzle-7.mp4')
  })
})

describe('dailyLogEntry', () => {
  it('keeps the log line shape with a basename file', () => {
    const stats = traceDfs(PUZZLE_8, 'row').stats
    const entry = dailyLogEntry(7, '2026-11-08-star-battle-8x8-puzzle-7.mp4', 42, 8, 'classic', stats, '2026-11-08T00:00:00.000Z')
    expect(entry).toEqual({ number: 7, file: '2026-11-08-star-battle-8x8-puzzle-7.mp4', seed: 42, n: 8, format: 'classic', stats, at: '2026-11-08T00:00:00.000Z' })
    expect(entry.file).not.toContain('/')
  })
})

describe('assertValidFormat', () => {
  it('rejects unknown formats, accepts known ones and unset', () => {
    expect(() => assertValidFormat('bogus')).toThrow(/--format must be one of/)
    expect(() => assertValidFormat(undefined)).not.toThrow()
    for (const f of FORMATS) expect(() => assertValidFormat(f)).not.toThrow()
  })
})

describe('dailyFormat off-slot fallback', () => {
  const offSlot = new Date('2026-11-08T03:00:00-05:00') // 03:00 ET, not a slot hour

  it('falls back to number % 3', () => {
    const got = [0, 1, 2].map(n => dailyFormat(offSlot, n))
    expect(new Set(got).size).toBe(3) // covers all three formats
    expect(dailyFormat(offSlot, 0)).toBe(dailyFormat(offSlot, 3))
    expect(dailyFormat(offSlot, 1)).toBe(dailyFormat(offSlot, 4))
  })
})

describe('dailyFormat uses the ET calendar day', () => {
  // 2026-11-08 is EST (-05:00): 19:30 ET sits on 11-08 locally but 11-09 in UTC.
  const nov8evening = new Date('2026-11-08T19:30:00-05:00')
  const nov8afternoon = new Date('2026-11-08T15:30:00-05:00')
  const nov9afternoon = new Date('2026-11-09T15:30:00-05:00')
  const nov9evening = new Date('2026-11-09T19:30:00-05:00')

  it('keeps 19:30 ET on its local date, not the UTC date', () => {
    // (day + slot) % 3 with ET dates: Nov8/slot2 == Nov9/slot1, and differs from both same-date neighbours.
    // (number is ignored on slot hours — only the off-slot fallback uses it.)
    expect(dailyFormat(nov8evening, 0)).toBe(dailyFormat(nov9afternoon, 0))
    expect(dailyFormat(nov8evening, 0)).not.toBe(dailyFormat(nov8afternoon, 0))
    expect(dailyFormat(nov8evening, 0)).not.toBe(dailyFormat(nov9evening, 0))
  })
})
