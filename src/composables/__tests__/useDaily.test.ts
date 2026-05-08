import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayUTC } from '../useDaily'

// ── todayUTC ──────────────────────────────────────────────────────────────────

describe('todayUTC', () => {
  afterEach(() => { vi.useRealTimers() })

  it('returns a stable integer for the same point in time', () => {
    const day = todayUTC()
    expect(Number.isInteger(day)).toBe(true)
    expect(todayUTC()).toBe(day)
  })

  it('equals Math.floor(Date.now() / 86_400_000)', () => {
    const expected = Math.floor(Date.now() / 86_400_000)
    expect(todayUTC()).toBe(expected)
  })

  it('increments by 1 after exactly 24 hours', () => {
    vi.useFakeTimers()
    const before = todayUTC()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(todayUTC()).toBe(before + 1)
  })

  it('does NOT increment before a full day has passed', () => {
    vi.useFakeTimers()
    const before = todayUTC()
    // Advance to 1 ms before the day boundary
    const msUntilBoundary = 86_400_000 - (Date.now() % 86_400_000) - 1
    vi.advanceTimersByTime(msUntilBoundary)
    expect(todayUTC()).toBe(before)
  })

  it('returns a positive number (days since epoch, well into 2020s)', () => {
    // 2024-01-01 = day ~19_723. A sane lower bound.
    expect(todayUTC()).toBeGreaterThan(19_000)
  })
})
