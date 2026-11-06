import { describe, it, expect } from 'vitest'
import { traceDfs } from '../trace'
import { buildTimeline } from '../timeline'
import { composeScore } from '../score'
import { MELODIES } from '../melodies'
import { dailyFormat, FORMATS } from '../cli'
import { PUZZLE_8 } from './fixtures'

const trace = traceDfs(PUZZLE_8, 'row')
const solutionCols = trace.solution.map(([, c]) => c)

describe('fixed-rate timeline (melody videos)', () => {
  const tl = buildTimeline(trace, { duration: 0, rate: 4 })
  const search = tl.steps.filter(s => !s.isFinalRun)

  it('puts every placement on an 8th and every take-back on a 1/32', () => {
    for (const s of search.slice(0, -1)) expect(s.dur).toBeCloseTo(s.kind === 'backtrack' ? 1 / 16 : 1 / 4)
  })

  it('runs as long as the search needs: solve + outro', () => {
    expect(tl.tEnd).toBeCloseTo(tl.tSolve + tl.opts.outro)
  })
})

describe('melody score', () => {
  const tl = buildTimeline(trace, { duration: 0, rate: 4 })
  const melody = MELODIES.find(m => m.id === 'ode-to-joy')!
  const cues = composeScore(tl, { key: 0, n: PUZZLE_8.n, solutionCols, melody: melody.notes })

  it('plays the tune in order, one note per placed star', () => {
    const placed = cues.filter(c => c.kind === 'place').map(c => c.pitch)
    expect(placed.length).toBeGreaterThan(melody.notes.length)
    placed.slice(0, melody.notes.length * 2).forEach((p, i) => expect(p).toBe(72 + melody.notes[i % melody.notes.length]))
  })

  it('drops the chord bed during the search', () => {
    expect(cues.some(c => c.kind === 'pad' && c.t < tl.tFinalRun - 1e-6)).toBe(false)
  })
})

describe('challenge score', () => {
  const tl = buildTimeline(trace, { duration: 30, intro: 5 })
  const cues = composeScore(tl, { key: 0, n: PUZZLE_8.n, solutionCols, countdown: 5 })

  it('ticks once a second through the countdown, then starts the search', () => {
    expect(cues.filter(c => c.kind === 'record' && c.t < 5).map(c => c.t)).toEqual([0, 1, 2, 3, 4])
    expect(tl.steps[0].t).toBeGreaterThanOrEqual(5)
    expect(tl.tEnd).toBeCloseTo(30)
  })
})

describe('dailyFormat rotation', () => {
  // 11:00 / 15:30 / 19:30 ET on three consecutive days (EST, UTC−5).
  const at = (day: number, h: number, m: number) => new Date(Date.UTC(2026, 10, 10 + day, h + 5, m))
  const grid = [0, 1, 2].map(d => [at(d, 11, 0), at(d, 15, 30), at(d, 19, 30)].map((t, i) => dailyFormat(t, d * 3 + i)))

  it('shows every format once a day', () => {
    for (const day of grid) expect(new Set(day).size).toBe(FORMATS.length)
  })

  it('moves each format to a different slot every day, so time of day does not bias the test', () => {
    for (let slot = 0; slot < 3; slot++) expect(new Set(grid.map(day => day[slot])).size).toBe(3)
  })
})
