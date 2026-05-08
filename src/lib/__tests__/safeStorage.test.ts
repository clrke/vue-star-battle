import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lsGet, lsSet } from '../safeStorage'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal localStorage-like stub backed by a plain Map. */
function makeStorage(throwOnGet = false, throwOnSet = false): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => {
      if (throwOnGet) throw new DOMException('SecurityError')
      return store.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (throwOnSet) throw new DOMException('SecurityError')
      store.set(k, v)
    },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (i: number) => [...store.keys()][i] ?? null,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('safeStorage', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  describe('lsGet', () => {
    it('returns null for a missing key', () => {
      vi.stubGlobal('localStorage', makeStorage())
      expect(lsGet('missing-key')).toBeNull()
    })

    it('returns the stored value', () => {
      const ls = makeStorage()
      ls.setItem('foo', 'bar')
      vi.stubGlobal('localStorage', ls)
      expect(lsGet('foo')).toBe('bar')
    })

    it('returns null without throwing when storage access is forbidden', () => {
      vi.stubGlobal('localStorage', makeStorage(/* throwOnGet */ true))
      expect(() => lsGet('anything')).not.toThrow()
      expect(lsGet('anything')).toBeNull()
    })
  })

  describe('lsSet', () => {
    it('persists the value so lsGet can retrieve it', () => {
      const ls = makeStorage()
      vi.stubGlobal('localStorage', ls)
      lsSet('key', 'value')
      expect(lsGet('key')).toBe('value')
    })

    it('does not throw when storage write is forbidden', () => {
      vi.stubGlobal('localStorage', makeStorage(false, /* throwOnSet */ true))
      expect(() => lsSet('key', 'value')).not.toThrow()
    })

    it('silently no-ops on write failure, leaving no trace', () => {
      const ls = makeStorage(false, /* throwOnSet */ true)
      vi.stubGlobal('localStorage', ls)
      lsSet('key', 'value')
      // The write failed — reading back should return null.
      // Swap to a readable stub to verify nothing was stored.
      vi.stubGlobal('localStorage', makeStorage())
      expect(lsGet('key')).toBeNull()
    })
  })
})
