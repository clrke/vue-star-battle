/**
 * Turns a DFS trace into a timed, beat-aligned schedule.
 *
 * Every step lands on a musical grid (BPM, 1/32-note resolution), so the sound of each
 * star snaps to the beat. Pacing:
 *
 *   intro    — board + hook text on screen from frame 0; first star on beat 3.
 *   ramp     — 2 steps/s, then 4, 8, 16, 32 … climbing one rung per ~second until
 *              the remaining steps fit the time budget, then cruising at that speed.
 *   final run— everything after the last backtrack: slowed back down to 8th notes so
 *              the winning line plays as a rising arpeggio, with a riser underneath.
 *   solve    — the last star lands; verification sweep; banner; stats; outro.
 */
import type { Trace, Unit } from './trace'

export type StepKind = 'advance' | 'fail' | 'backtrack'

export interface Step {
  kind: StepKind
  /** Start time (s). */
  t: number
  /** Time until the next step starts (s). */
  dur: number
  row: number
  col: number
  /** Stars on the board after this step. */
  depth: number
  /** Dead unit for a 'fail' step. */
  unit?: Unit
  /** First time the search reaches this depth (advance/fail steps only). */
  isRecord: boolean
  isFinalRun: boolean
  /** Speed multiplier shown on screen (1× = the opening pace). */
  speed: number
  /** Running totals after this step (backtracks = every star taken back off, incl. dead ends). */
  placements: number
  backtracks: number
}

export interface TimelineOptions {
  bpm: number
  /** Seconds before the first step. */
  intro: number
  /** Exact total video length, seconds (the search stretches/compresses to fill it). */
  duration: number
  /** Celebration + outro length after the solve, seconds. */
  outro: number
}

export const DEFAULT_TIMELINE: TimelineOptions = { bpm: 120, intro: 1.0, duration: 60, outro: 6.5 }

/** Slack reserved for snapping the final run to an 8th and the solve to a beat. */
const SNAP_SLACK = 0.625

export interface Timeline {
  opts: TimelineOptions
  steps: Step[]
  /** Final-run start, final star, end of video. */
  tFinalRun: number
  tSolve: number
  tEnd: number
  /** Post-solve choreography. */
  sweep: { t: number; stepDur: number; end: number }
  tBanner: number
  tStats: number
  tOutro: number
  beat: number
}

/** Steps per second for each speed rung (2/s = quarter notes at 120 BPM … several per 1/32). */
const RUNGS = [2, 4, 8, 16, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024]

/** Collapse raw events into the three visible step kinds. */
export function stepsFromTrace(trace: Trace): Omit<Step, 't' | 'dur' | 'isFinalRun' | 'speed'>[] {
  const out: Omit<Step, 't' | 'dur' | 'isFinalRun' | 'speed'>[] = []
  const ev = trace.events
  let maxDepth = 0, placements = 0, backtracks = 0
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]
    if (e.kind === 'place') {
      placements++
      const isRecord = e.depth > maxDepth
      maxDepth = Math.max(maxDepth, e.depth)
      const next = ev[i + 1]
      if (next?.kind === 'conflict') {
        backtracks++ // the failed star comes straight back off — that's a backtrack too
        out.push({ kind: 'fail', row: e.row, col: e.col, depth: e.depth, unit: next.unit, isRecord, placements, backtracks })
        i += 2 // conflict + its remove
      } else {
        out.push({ kind: 'advance', row: e.row, col: e.col, depth: e.depth, isRecord, placements, backtracks })
      }
    } else if (e.kind === 'remove') {
      backtracks++
      out.push({ kind: 'backtrack', row: e.row, col: e.col, depth: e.depth, isRecord: false, placements, backtracks })
    }
  }
  return out
}

export function buildTimeline(trace: Trace, partial: Partial<TimelineOptions> = {}): Timeline {
  const opts = { ...DEFAULT_TIMELINE, ...partial }
  const beat = 60 / opts.bpm
  const raw = stepsFromTrace(trace)

  // Final run: everything after the last backtrack.
  let lastBack = -1
  raw.forEach((s, i) => { if (s.kind === 'backtrack') lastBack = i })
  const searchCount = lastBack + 1

  // ── Final run: rising 8th notes into the solve (16ths for fails / long runs) ──
  const finalCount = raw.length - searchCount
  const finalDurs: number[] = []
  for (let k = 0; k < finalCount; k++) {
    const s = raw[searchCount + k]
    const fromEnd = finalCount - k
    finalDurs.push(s.kind === 'fail' || fromEnd > 5 ? beat / 4 : beat / 2)
  }
  // The last final-run step is the solve itself (dur 0), so it adds no time.
  const finalTime = finalDurs.slice(0, -1).reduce((a, b) => a + b, 0)
  const budget = Math.max(1, opts.duration - opts.intro - opts.outro - finalTime - SNAP_SLACK)

  // ── Ramp + cruise for the search part ──
  // Climb the rungs (2, 4, 8, 16 … steps/s, about a second each, all on the beat grid) while
  // the current rung is too slow to finish in time; then cruise at exactly the speed that
  // uses up the remaining budget, so every video lands on the same total length.
  const durs: number[] = []
  const speeds: number[] = []
  let rung = 0, done = 0, time = 0
  while (done < searchCount) {
    const v = RUNGS[rung] * (opts.bpm / 120)
    const left = searchCount - done
    const remaining = budget - time
    if (left / v <= remaining || rung === RUNGS.length - 1) {
      const vc = Math.max(left / Math.max(remaining, 1e-3), 0.25) // small boards cruise slowly to fill 60 s
      for (let k = 0; k < left; k++) { durs.push(1 / vc); speeds.push(Math.max(1, Math.round(vc / RUNGS[0]))) }
      done = searchCount
      break
    }
    const take = Math.min(left, Math.max(1, Math.round(v)))
    for (let k = 0; k < take; k++) { durs.push(1 / v); speeds.push(RUNGS[rung] / RUNGS[0]) }
    done += take
    time += take / v
    rung++
  }
  for (const d of finalDurs) { durs.push(d); speeds.push(1) }

  const steps: Step[] = []
  let t = opts.intro
  raw.forEach((s, i) => {
    // Cruise speeds like 48/s end between grid lines; start the final run on the next 8th note
    // (a beat of suspense at most) so the winning arpeggio sits on the beat.
    if (i === searchCount && i > 0) {
      const eighth = beat / 2
      const snapped = Math.ceil(t / eighth - 1e-9) * eighth
      steps[i - 1].dur += snapped - t
      t = snapped
    }
    steps.push({ ...s, t, dur: durs[i], isFinalRun: i >= searchCount, speed: speeds[i] })
    t += durs[i]
  })

  // The last step is the winning star; the solve hits on its start time. Hold it back to the
  // next beat (≤ 3 sixteenths) — a breath of suspense, and the impact lands on the beat.
  const last = steps[steps.length - 1]
  if (steps.length > 1) {
    const snapped = Math.ceil(last.t / beat - 1e-9) * beat
    steps[steps.length - 2].dur += snapped - last.t
    last.t = snapped
  }
  const tSolve = last.t
  last.dur = 0
  const tFinalRun = searchCount < steps.length ? steps[searchCount].t : tSolve

  const n = trace.solution.length
  const sweep = { t: tSolve + beat / 2, stepDur: beat / 4, end: 0 }
  sweep.end = sweep.t + n * sweep.stepDur
  const tBanner = sweep.end + beat / 4
  const tStats = tBanner + beat * 2
  // Exact length: the outro absorbs the few hundred ms of snapping slack.
  const tEnd = Math.max(opts.duration, tSolve + opts.outro)
  const tOutro = tEnd - 2.5

  return { opts, steps, tFinalRun, tSolve, tEnd, sweep, tBanner, tStats, tOutro, beat }
}

/** Index of the step active at time t (-1 before the first step). Binary search. */
export function stepIndexAt(tl: Timeline, t: number): number {
  const s = tl.steps
  let lo = 0, hi = s.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (s[mid].t <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}
