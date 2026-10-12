import { describe, it, expect } from 'vitest'
import { traceDfs } from '../trace'
import { buildTimeline, stepsFromTrace, stepIndexAt } from '../timeline'
import { buildSceneModel, coverage, StepSignal } from '../render/model'
import { PUZZLE_8, PUZZLE_9 } from './fixtures'

const puzzle = PUZZLE_9
const trace = traceDfs(puzzle, 'row')

describe('stepsFromTrace', () => {
  it('folds place+conflict+remove into fail steps and keeps running totals', () => {
    const steps = stepsFromTrace(trace)
    const fails = steps.filter(s => s.kind === 'fail').length
    const advances = steps.filter(s => s.kind === 'advance').length
    const backs = steps.filter(s => s.kind === 'backtrack').length
    expect(fails).toBe(trace.stats.conflicts)
    expect(advances + fails).toBe(trace.stats.placements)
    expect(backs + fails).toBe(trace.stats.removals)
    expect(steps[steps.length - 1].placements).toBe(trace.stats.placements)
    expect(steps[steps.length - 1].backtracks).toBe(trace.stats.removals)
  })
})

describe('buildTimeline', () => {
  const tl = buildTimeline(trace, { duration: 40 })

  it('schedules steps in order, on the beat grid, within budget', () => {
    const slot = tl.beat / 8
    let prev = -Infinity
    for (const s of tl.steps) {
      expect(s.t).toBeGreaterThan(prev)
      prev = s.t
      // Ramp rungs up to 16 steps/s are one step per 1/32 or slower → exactly on the grid;
      // the final run is re-snapped to the grid after faster (k-per-slot) cruising.
      if (s.isFinalRun || (s.speed <= 8 && s.t < tl.steps[0].t + 4)) expect(Math.abs(s.t / slot - Math.round(s.t / slot))).toBeLessThan(1e-6)
    }
    expect(tl.steps[0].t).toBe(tl.opts.intro)
    expect(tl.tEnd).toBe(40)
  })

  it('ends the search on the winning star, then celebrates', () => {
    const last = tl.steps[tl.steps.length - 1]
    expect(last.kind).toBe('advance')
    expect(last.depth).toBe(puzzle.n)
    expect(tl.tSolve).toBe(last.t)
    expect(tl.sweep.t).toBeGreaterThan(tl.tSolve)
    expect(tl.tBanner).toBeGreaterThan(tl.sweep.end - 1e-9)
    expect(tl.tEnd).toBeGreaterThan(tl.tOutro)
    expect(tl.steps.filter(s => s.isFinalRun).every(s => s.t >= tl.tFinalRun)).toBe(true)
  })

  it('hits the exact duration, starts the final run on an 8th and lands the solve on a beat', () => {
    const speeds = new Set<number>()
    for (const [p, budget] of [[PUZZLE_8, 60], [PUZZLE_8, 30], [PUZZLE_9, 60], [PUZZLE_9, 45], [PUZZLE_9, 30], [PUZZLE_9, 20]] as const) {
      const t2 = buildTimeline(traceDfs(p, 'row'), { duration: budget })
      t2.steps.forEach(s => speeds.add(s.speed))
      const eighth = t2.beat / 2
      expect(Math.abs(t2.tFinalRun / eighth - Math.round(t2.tFinalRun / eighth))).toBeLessThan(1e-6)
      expect(Math.abs(t2.tSolve / t2.beat - Math.round(t2.tSolve / t2.beat))).toBeLessThan(1e-6)
      for (let i = 1; i < t2.steps.length; i++)
        expect(t2.steps[i].t).toBeCloseTo(t2.steps[i - 1].t + t2.steps[i - 1].dur, 9)
      expect(t2.tEnd).toBe(budget) // exact length, whatever the puzzle
    }
    expect(speeds.size).toBeGreaterThan(3)
  })

  it('opens slowly and speeds up', () => {
    expect(tl.steps[0].dur).toBeCloseTo(0.5)
    expect(tl.steps[0].speed).toBe(1)
    const fastest = Math.max(...tl.steps.map(s => s.speed))
    expect(fastest).toBeGreaterThan(1)
  })

  it('stepIndexAt finds the active step', () => {
    expect(stepIndexAt(tl, 0)).toBe(-1)
    expect(stepIndexAt(tl, tl.steps[3].t)).toBe(3)
    expect(stepIndexAt(tl, tl.steps[3].t + tl.steps[3].dur / 2)).toBe(3)
    expect(stepIndexAt(tl, tl.tEnd)).toBe(tl.steps.length - 1)
  })
})

describe('scene model', () => {
  const tl = buildTimeline(trace)
  const m = buildSceneModel(puzzle, tl, trace.solution, 'row')

  it('leaves exactly the solution on the board, with every other cell ruled out', () => {
    const t = tl.tEnd
    const visible = m.stars.filter(s => s.on <= t && t < s.off).map(s => [s.r, s.c])
    expect(visible.sort((a, b) => a[0] - b[0])).toEqual(trace.solution)
    const n = puzzle.n
    for (let i = 0; i < n * n; i++) {
      const isStar = trace.solution.some(([r, c]) => r * n + c === i)
      expect(coverage(m.elim[i], t, 0.1)).toBe(isStar ? 0 : 1)
    }
    expect(m.depth.at(t)).toBe(n)
  })

  it('StepSignal box-filters a piecewise-constant signal', () => {
    const s = new StepSignal()
    s.push(0, 0); s.push(1, 10); s.push(2, 4)
    expect(s.at(0.5)).toBe(0)
    expect(s.at(1.5)).toBe(10)
    expect(s.mean(1.5, 1)).toBeCloseTo(5)
    expect(s.mean(2.5, 1)).toBeCloseTo(7)
    expect(s.mean(1.5, 0)).toBe(10)
  })

  it('coverage measures the fraction of the window a cell was ruled out', () => {
    const spans: [number, number][] = [[1, 2], [3, Infinity]]
    expect(coverage(spans, 0.5, 0.5)).toBe(0)
    expect(coverage(spans, 1.5, 1)).toBeCloseTo(0.5)
    expect(coverage(spans, 3.5, 2)).toBeCloseTo(0.5)
    expect(coverage(spans, 10, 1)).toBe(1)
  })
})
