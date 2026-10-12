import { describe, it, expect } from 'vitest'
import { traceDfs } from '../trace'
import { buildTimeline } from '../timeline'
import { composeScore } from '../score'
import { PUZZLE_9 } from './fixtures'

const puzzle = PUZZLE_9
const trace = traceDfs(puzzle, 'row')
const tl = buildTimeline(trace)
const n = puzzle.n
const cues = composeScore(tl, { key: 2, n, solutionCols: trace.solution.map(([, c]) => c) })

describe('composeScore', () => {
  it('produces time-ordered cues inside the video', () => {
    for (let i = 1; i < cues.length; i++) expect(cues[i].t).toBeGreaterThanOrEqual(cues[i - 1].t)
    expect(cues[0].t).toBeGreaterThanOrEqual(0)
    expect(cues[cues.length - 1].t).toBeLessThan(tl.tEnd)
  })

  it('lands exactly one impact on the winning star, after a riser that peaks there', () => {
    const impacts = cues.filter(c => c.kind === 'impact')
    expect(impacts).toHaveLength(1)
    expect(impacts[0].t).toBeCloseTo(tl.tSolve, 9)
    const riser = cues.find(c => c.kind === 'riser')!
    expect(riser.t + riser.dur!).toBeCloseTo(tl.tSolve, 9)
  })

  it('plays a rising chime for every verified row', () => {
    const sweep = cues.filter(c => c.kind === 'chime' && c.t >= tl.sweep.t - 1e-9 && c.t < tl.sweep.end - 1e-9)
    expect(sweep).toHaveLength(n)
    for (let i = 1; i < n; i++) expect(sweep[i].pitch!).toBeGreaterThan(sweep[i - 1].pitch!)
  })

  it('keeps star notes musical: in range, at most one per 1/32 note', () => {
    const slot = tl.beat / 8
    const seen = new Set<number>()
    for (const c of cues.filter(c => c.kind === 'place')) {
      expect(c.pitch!).toBeGreaterThanOrEqual(55)
      expect(c.pitch!).toBeLessThanOrEqual(100)
      const s = Math.floor(c.t / slot + 1e-6)
      expect(seen.has(s)).toBe(false)
      seen.add(s)
    }
    expect(seen.size).toBeGreaterThan(20)
  })

  it('drops the drums for the final run, and brings them back after the banner', () => {
    const drums = cues.filter(c => ['kick', 'clap', 'snare', 'hat', 'openhat'].includes(c.kind))
    expect(drums.some(c => c.t > tl.tFinalRun + 1e-6 && c.t < tl.tBanner - 1e-6)).toBe(false)
    expect(drums.some(c => c.t >= tl.tBanner)).toBe(true)
    expect(drums.some(c => c.t < tl.tFinalRun)).toBe(true)
  })

  it('higher search depth means a higher note within a chord', () => {
    const places = tl.steps.filter(s => s.kind !== 'backtrack' && !s.isFinalRun)
    const byBar = new Map<number, { d: number; p: number }[]>()
    for (const c of cues.filter(c => c.kind === 'place')) {
      const s = places.find(s => Math.abs(s.t - c.t) < 1e-9)
      if (!s) continue
      const bar = Math.floor(c.t / (tl.beat * 4) + 1e-6)
      byBar.set(bar, [...(byBar.get(bar) ?? []), { d: s.depth, p: c.pitch! }])
    }
    for (const notes of byBar.values())
      for (const a of notes) for (const b of notes) if (a.d < b.d) expect(a.p).toBeLessThan(b.p)
  })
})
