/**
 * The soundtrack, as a list of timed cues for the audio engine (video/audio).
 *
 * Musical idea — everything is built to feel rewarding:
 *   • Every star placed plays a mallet note from the current chord; deeper search = higher
 *     note, so progress literally sounds like climbing and backtracking like falling back.
 *   • New depth records add a glockenspiel sparkle; dead ends get a soft, low "bonk".
 *   • A lo-fi beat and an I–V–vi–IV pad (the most familiar progression in pop) run under
 *     the search; notes are on a 1/32 grid so even the fast part grooves.
 *   • The final run drops the drums and swaps to the V chord over a riser (tension), then
 *     the last star lands on the I chord with an impact (release), followed by an
 *     ascending chime per verified row, a confetti pop and a celebratory groove.
 */
import type { AudioCue } from './audio/types'
import type { Timeline } from './timeline'

type Chord = { root: number; pcs: number[] }
const I: Chord = { root: 0, pcs: [0, 4, 7] }
const V: Chord = { root: 7, pcs: [7, 11, 2] }
const vi: Chord = { root: 9, pcs: [9, 0, 4] }
const IV: Chord = { root: 5, pcs: [5, 9, 0] }
const PROGRESSION = [I, V, vi, IV]

export interface ScoreOptions {
  /** Semitones above C for the key (keeps a channel of daily videos from sounding identical). */
  key: number
  n: number
  /** Column of the solution star in each row (for panning the verification chimes). */
  solutionCols: number[]
}

/** Chord tones from `lowest` upward, as MIDI notes. */
function ladder(ch: Chord, key: number, lowest: number, count: number): number[] {
  const out: number[] = []
  for (let m = lowest; out.length < count; m++) if (ch.pcs.includes((((m - key) % 12) + 12) % 12)) out.push(m)
  return out
}

/** Close voicing of a chord with every note in [lo, lo + 12). */
function voicing(ch: Chord, key: number, lo: number): number[] {
  return ladder(ch, key, lo, 3)
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function composeScore(tl: Timeline, o: ScoreOptions): AudioCue[] {
  const cues: AudioCue[] = []
  const beat = tl.beat
  const bar = beat * 4
  const key = o.key
  const n = o.n
  const chordAt = (t: number): Chord => (t >= tl.tSolve ? I : t >= tl.tFinalRun ? V : PROGRESSION[Math.floor(t / bar + 1e-6) % 4])
  const pitchFor = (depth: number, t: number) => ladder(chordAt(t), key, 60 + key, n + 2)[Math.max(0, depth - 1)]
  const pan = (col: number) => (n > 1 ? (col / (n - 1)) * 1.2 - 0.6 : 0)

  // ── Harmony bed ──
  for (let t = 0; t < tl.tFinalRun - 1e-6; t += bar) {
    const ch = chordAt(t)
    const dur = Math.min(bar, tl.tFinalRun - t)
    cues.push({ t, kind: 'pad', notes: [...voicing(ch, key, 55 + key), 36 + key + ch.root + 12], dur: dur + 0.05, gain: 0.9 })
    for (let b = 0; b < 4; b += 2) {
      const tb = t + b * beat
      if (tb >= tl.opts.intro - 1e-6 && tb < tl.tFinalRun - 1e-6) cues.push({ t: tb, kind: 'bass', pitch: 36 + key + ch.root, dur: Math.min(beat * 1.8, tl.tFinalRun - tb) })
    }
  }
  // Final run: hold the dominant, riser into the solve.
  cues.push({ t: tl.tFinalRun, kind: 'pad', notes: [...voicing(V, key, 55 + key), 31 + key + 12], dur: tl.tSolve - tl.tFinalRun + 0.05, gain: 1.0 })
  const riserStart = Math.max(tl.opts.intro, tl.tFinalRun - beat * 2)
  cues.push({ t: riserStart, kind: 'riser', dur: tl.tSolve - riserStart, gain: 0.9 })

  // ── Beat under the search ──
  const steps = tl.steps
  const speedAt = (t: number) => {
    let lo = 0, hi = steps.length - 1, ans = -1
    while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m].t <= t) { ans = m; lo = m + 1 } else hi = m - 1 }
    return ans < 0 ? 1 : steps[ans].speed
  }
  const sixteenth = beat / 4
  for (let t = tl.opts.intro; t < tl.tFinalRun - 1e-6; t += sixteenth) {
    const pos = Math.round(t / sixteenth) % 16 // position in the bar, in 16ths
    const fast = speedAt(t) >= 8
    if (pos === 0 || pos === 8) cues.push({ t, kind: 'kick' })
    if (pos === 10 && fast) cues.push({ t, kind: 'kick', gain: 0.7 })
    if (pos === 4 || pos === 12) cues.push({ t, kind: 'clap', gain: 0.85 })
    if (pos % 2 === 0) cues.push({ t, kind: pos === 14 ? 'openhat' : 'hat', gain: pos % 4 === 0 ? 0.8 : 0.55, pan: 0.25 })
    else if (fast) cues.push({ t, kind: 'hat', gain: 0.3, pan: -0.25 })
  }

  // ── Intro: attention grab ──
  cues.push({ t: 0, kind: 'whoosh', dur: 0.5, gain: 0.7 })
  cues.push({ t: 0.08, kind: 'sparkle', notes: voicing(I, key, 72 + key), dur: 0.9, gain: 0.6 })

  // ── The search itself ──
  const slot = beat / 8 // 1/32 note
  // Cruise steps can fall between grid lines; their sounds snap to the nearest 1/32 (≤31 ms).
  const snap = (t: number) => Math.round(t / slot) * slot
  let lastNoteSlot = -1, lastBonk = -Infinity, lastBloop = -Infinity, lastRecord = -Infinity
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const isLast = i === steps.length - 1
    if (s.kind === 'advance' || s.kind === 'fail') {
      const sl = Math.round(s.t / slot)
      // One note per 1/32 slot; when several steps share a slot, the deepest one sings.
      let deepest = s.depth
      for (let j = i + 1; j < steps.length && Math.round(steps[j].t / slot) === sl; j++)
        if (steps[j].kind !== 'backtrack') deepest = Math.max(deepest, steps[j].depth)
      if (sl !== lastNoteSlot && (deepest === s.depth || isLast)) {
        lastNoteSlot = sl
        const slowness = clamp01((s.dur - 0.03) / (0.25 - 0.03))
        const g = isLast ? 1.15 : s.isFinalRun ? 1.0 : 0.55 + 0.45 * slowness
        cues.push({ t: snap(s.t), kind: 'place', pitch: pitchFor(s.depth, s.t), gain: g, pan: pan(s.col) })
        // Record sparkles ring for seconds: space the early ones a beat apart, never drop the deep ones.
        if (s.isRecord && s.depth >= 2 && (s.t - lastRecord >= beat || s.depth >= n - 2)) {
          lastRecord = s.t
          cues.push({ t: snap(s.t), kind: 'record', pitch: pitchFor(s.depth, s.t) + 12, gain: 0.55 + 0.25 * slowness, pan: pan(s.col) })
        }
      }
      if (s.kind === 'fail') {
        const tf = snap(s.t + Math.min(0.4 * s.dur, 0.2))
        const slowEnough = s.dur >= 0.1
        if (slowEnough || tf - lastBonk >= beat) {
          lastBonk = tf
          cues.push({ t: tf, kind: 'conflict', gain: slowEnough ? 0.9 : 0.45, pan: pan(s.col) * 0.5 })
        }
      }
    } else {
      const slowEnough = s.dur >= 0.1
      if (slowEnough || s.t - lastBloop >= beat / 2) {
        lastBloop = s.t
        cues.push({ t: snap(s.t), kind: 'remove', pitch: pitchFor(s.depth + 1, s.t), gain: slowEnough ? 0.9 : 0.4, pan: pan(s.col) })
      }
    }
  }

  // ── Solve: the payoff ──
  const tS = tl.tSolve
  cues.push({ t: tS, kind: 'impact', gain: 1 })
  cues.push({ t: tS, kind: 'chime', pitch: 84 + key, gain: 0.8 })
  cues.push({ t: tS, kind: 'bass', pitch: 36 + key, dur: bar })
  cues.push({ t: tS, kind: 'pad', notes: [...voicing(I, key, 55 + key), 48 + key, 72 + key], dur: tl.tEnd - tS, gain: 1.0 })
  // Verification sweep: one rising chime per row, panned to that row's star.
  const sweepNotes = ladder(I, key, 72 + key, n)
  for (let r = 0; r < n; r++)
    cues.push({ t: tl.sweep.t + r * tl.sweep.stepDur, kind: 'chime', pitch: sweepNotes[r], gain: 0.55 + 0.25 * (r / Math.max(1, n - 1)), pan: pan(o.solutionCols[r] ?? r) })
  // Banner: whoosh, confetti cannons, sparkle shower, and the groove comes back.
  cues.push({ t: tl.tBanner - 0.3, kind: 'whoosh', dur: 0.35, gain: 0.8 })
  cues.push({ t: tl.tBanner, kind: 'pop', pan: -0.7 }, { t: tl.tBanner + 0.03, kind: 'pop', pan: 0.7 })
  cues.push({ t: tl.tBanner, kind: 'sparkle', notes: voicing(I, key, 79 + key), dur: 2.4, gain: 0.8 })
  cues.push({ t: tl.tBanner, kind: 'chime', pitch: 91 + key, gain: 0.6 })
  const grooveEnd = tl.tEnd - beat
  for (let t = tl.tBanner, k = 0; t < grooveEnd - 1e-6; t += sixteenth, k++) {
    const pos = k % 16
    if (pos === 0 || pos === 8 || pos === 11) cues.push({ t, kind: 'kick', gain: pos === 11 ? 0.7 : 1 })
    if (pos === 4 || pos === 12) cues.push({ t, kind: 'clap' })
    if (pos % 2 === 0) cues.push({ t, kind: pos === 14 ? 'openhat' : 'hat', gain: 0.7, pan: 0.25 })
    if (pos === 0 && k > 0) {
      const ch = Math.floor(k / 16) % 2 === 1 ? IV : I
      cues.push({ t, kind: 'bass', pitch: 36 + key + ch.root, dur: bar * 0.95 })
    }
  }
  // Outro CTA
  cues.push({ t: tl.tOutro - 0.25, kind: 'whoosh', dur: 0.3, gain: 0.6 })
  cues.push({ t: tl.tOutro, kind: 'chime', pitch: 79 + key, gain: 0.6 }, { t: tl.tOutro + sixteenth, kind: 'chime', pitch: 84 + key, gain: 0.6 })

  return cues.filter(c => c.t >= 0 && c.t < tl.tEnd).sort((a, b) => a.t - b.t)
}
