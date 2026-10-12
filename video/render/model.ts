/**
 * Everything the renderer needs, precomputed once from the timeline so that drawing a
 * frame is a pure function of time (any frame can be rendered alone, in any order).
 */
import type { Puzzle } from '../../src/types/puzzle'
import type { Timeline } from '../timeline'
import { eliminatedBy, unitCells, type Cell } from '../trace'

export interface StarSpan {
  r: number; c: number
  on: number; off: number          // off = Infinity if the star stays
  fail: boolean; record: boolean; final: boolean
  /** Duration of the step that placed it (drives how big its pop animation is). */
  dur: number
  /** When a failed star turns red (the conflict moment). */
  conflictAt: number
}

export interface Flash { t: number; tau: number; cells: Cell[]; slow: boolean }

/** Piecewise-constant signal: value v[k] on [t[k], t[k+1]). */
export class StepSignal {
  readonly t: number[] = []
  readonly v: number[] = []
  private cum: number[] = []
  push(t: number, v: number) {
    if (this.t.length && t === this.t[this.t.length - 1]) { this.v[this.v.length - 1] = v; return }
    this.t.push(t); this.v.push(v)
  }
  private seal() {
    if (this.cum.length === this.t.length) return
    this.cum = [0]
    for (let k = 1; k < this.t.length; k++) this.cum.push(this.cum[k - 1] + this.v[k - 1] * (this.t[k] - this.t[k - 1]))
  }
  private index(x: number): number {
    let lo = 0, hi = this.t.length - 1, ans = -1
    while (lo <= hi) { const m = (lo + hi) >> 1; if (this.t[m] <= x) { ans = m; lo = m + 1 } else hi = m - 1 }
    return ans
  }
  at(x: number): number { const k = this.index(x); return k < 0 ? (this.v[0] ?? 0) : this.v[k] }
  /** ∫ from -∞ (clamped to first breakpoint) to x. */
  private integral(x: number): number {
    this.seal()
    const k = this.index(x)
    if (k < 0) return (this.v[0] ?? 0) * (x - (this.t[0] ?? 0))
    return this.cum[k] + this.v[k] * (x - this.t[k])
  }
  /** Mean value over [x - w, x] — a box-filter used to smooth fast-moving signals. */
  mean(x: number, w: number): number {
    if (w <= 1e-9) return this.at(x)
    return (this.integral(x) - this.integral(x - w)) / w
  }
}

export interface SceneModel {
  puzzle: Puzzle
  n: number
  timeline: Timeline
  stars: StarSpan[]
  flashes: Flash[]
  /** Per cell (r*n+c): sorted, disjoint [start, end) spans while the cell is ruled out. */
  elim: [number, number][][]
  depth: StepSignal
  cursorRow: StepSignal
  records: { t: number; depth: number }[]
  /** Steps' running counters, aligned with timeline.steps. */
  solution: Cell[]
  strategy: 'row' | 'mrv'
}

export function buildSceneModel(puzzle: Puzzle, timeline: Timeline, solution: Cell[], strategy: 'row' | 'mrv'): SceneModel {
  const { n } = puzzle
  const stars: StarSpan[] = []
  const flashes: Flash[] = []
  const open = new Map<number, StarSpan>()

  for (const s of timeline.steps) {
    const key = s.row * n + s.col
    if (s.kind === 'advance') {
      const span: StarSpan = { r: s.row, c: s.col, on: s.t, off: Infinity, fail: false, record: s.isRecord, final: s.isFinalRun, dur: s.dur || 0.5, conflictAt: Infinity }
      stars.push(span); open.set(key, span)
    } else if (s.kind === 'backtrack') {
      const span = open.get(key)
      if (span) { span.off = s.t; open.delete(key) }
    } else {
      // Failed attempt: star in, dead unit flashes red, star out — all inside the step.
      const flashAt = s.t + Math.min(0.4 * s.dur, 0.2)
      const off = s.t + Math.min(0.75 * s.dur, 0.38)
      stars.push({ r: s.row, c: s.col, on: s.t, off, fail: true, record: s.isRecord, final: s.isFinalRun, dur: s.dur, conflictAt: flashAt })
      const tau = Math.min(Math.max(0.35 * s.dur, 0.035), 0.2)
      flashes.push({ t: flashAt, tau, cells: unitCells(puzzle, s.unit!), slow: s.dur >= 0.2 })
    }
  }

  // Sweep star on/off toggles in time order to get each cell's "ruled out" spans.
  const toggles: { t: number; d: number; r: number; c: number }[] = []
  for (const s of stars) {
    toggles.push({ t: s.on, d: +1, r: s.r, c: s.c })
    if (Number.isFinite(s.off)) toggles.push({ t: s.off, d: -1, r: s.r, c: s.c })
  }
  toggles.sort((a, b) => a.t - b.t || a.d - b.d)
  const count = new Int16Array(n * n)
  const since = new Float64Array(n * n)
  const elim: [number, number][][] = Array.from({ length: n * n }, () => [])
  const depth = new StepSignal()
  depth.push(-1e9, 0)
  let d = 0
  for (const tg of toggles) {
    d += tg.d
    depth.push(tg.t, d)
    for (const [rr, cc] of eliminatedBy(puzzle, tg.r, tg.c)) {
      const i = rr * n + cc
      if (tg.d > 0) { if (count[i]++ === 0) since[i] = tg.t }
      else if (--count[i] === 0 && tg.t > since[i]) elim[i].push([since[i], tg.t])
    }
  }
  for (let i = 0; i < n * n; i++) if (count[i] > 0) elim[i].push([since[i], Infinity])

  const cursorRow = new StepSignal()
  cursorRow.push(-1e9, 0)
  for (const s of timeline.steps) {
    const row = s.kind === 'advance' ? Math.min(s.row + 1, n - 1) : s.row
    cursorRow.push(s.kind === 'fail' ? s.t : s.t, row)
  }

  const records = timeline.steps.filter(s => s.isRecord && s.depth >= 2).map(s => ({ t: s.t, depth: s.depth }))
  return { puzzle, n, timeline, stars, flashes, elim, depth, cursorRow, records, solution, strategy }
}

/** Fraction of [t - w, t] covered by a cell's ruled-out spans (smooth fade, flicker-free at speed). */
export function coverage(spans: [number, number][], t: number, w: number): number {
  let lo = 0, hi = spans.length - 1, first = spans.length
  // first span whose end > t - w
  while (lo <= hi) { const m = (lo + hi) >> 1; if (spans[m][1] > t - w) { first = m; hi = m - 1 } else lo = m + 1 }
  let covered = 0
  for (let k = first; k < spans.length && spans[k][0] < t; k++) {
    const a = Math.max(spans[k][0], t - w), b = Math.min(spans[k][1], t)
    if (b > a) covered += b - a
  }
  return Math.min(1, covered / w)
}
