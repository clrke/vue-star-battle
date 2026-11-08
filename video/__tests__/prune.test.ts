import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prune } from '../cli'

const DAY = 86_400_000
let dir = ''

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'prune-test-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function aged(name: string, ageMs: number): string {
  const p = join(dir, name)
  writeFileSync(p, 'x')
  const t = new Date(Date.now() - ageMs)
  utimesSync(p, t, t)
  return p
}

describe('prune', () => {
  it('deletes dated mp4/json older than keep-days, keeps newer ones', () => {
    const oldMp4 = aged('2026-01-01-x.mp4', 40 * DAY)
    const oldJson = aged('2026-01-01-x.json', 40 * DAY)
    const fresh = aged('2026-11-08-x.mp4', DAY)
    prune(dir, 30)
    expect(existsSync(oldMp4)).toBe(false)
    expect(existsSync(oldJson)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('never deletes the numbering log, however old', () => {
    const log = aged('log.jsonl', 400 * DAY)
    prune(dir, 30)
    expect(existsSync(log)).toBe(true)
  })

  it('ignores non-dated and oddly-named files', () => {
    const names = ['star-battle-123.mp4', 'draft.txt', '2026-1-8-x.mp4', '2026-11-08-x.mp4.bak',
      // Regex has no `i` flag: uppercase extensions survive (current behavior).
      '2026-11-08-x.MP4', '2026-11-08-x.JSON']
    const paths = names.map(n => aged(n, 400 * DAY))
    prune(dir, 30)
    for (const p of paths) expect(existsSync(p)).toBe(true)
  })

  it('treats days <= 0 as a no-op', () => {
    const old = aged('2026-01-01-x.mp4', 400 * DAY)
    prune(dir, 0)
    prune(dir, -1)
    expect(existsSync(old)).toBe(true)
  })

  it('treats a missing dir as a no-op', () => {
    expect(() => prune(join(dir, 'nope'), 30)).not.toThrow()
  })

  it('keeps files on the fresh side of the cutoff, deletes past it', () => {
    const cutoff = Date.now() - 30 * DAY
    const justFresh = join(dir, '2026-11-01-fresh.mp4')
    const justStale = join(dir, '2026-11-01-stale.mp4')
    writeFileSync(justFresh, 'x')
    writeFileSync(justStale, 'x')
    utimesSync(justFresh, new Date(cutoff + 60_000), new Date(cutoff + 60_000))
    utimesSync(justStale, new Date(cutoff - 60_000), new Date(cutoff - 60_000))
    prune(dir, 30)
    expect(existsSync(justFresh)).toBe(true)
    expect(existsSync(justStale)).toBe(false)
  })
})
