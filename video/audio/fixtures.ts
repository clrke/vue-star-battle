/**
 * Synthetic cue sequences for tests and benchmarks (NOT the real score; that
 * lives in ./score). `denseScore` mimics a busy solve video: a 120 BPM lo-fi
 * beat, a chord per bar, and a depth-first-search stream of place / record /
 * remove / conflict cues at ~16-26 events per second, then the solve finale.
 */
import type { AudioCue } from './types'
import { mulberry32 } from './dsp'

export const BEAT = 0.5 // 120 BPM
export const BAR = 4 * BEAT

/** C - G - Am - F, as pad voicings + bass roots. */
export const PROGRESSION = [
  { pad: [60, 64, 67, 71], bass: 36 },
  { pad: [59, 62, 67, 71], bass: 43 },
  { pad: [57, 60, 64, 69], bass: 45 },
  { pad: [57, 60, 65, 69], bass: 41 },
]

const PENTATONIC = [0, 2, 4, 7, 9]

/** Depth -> pitch: ascending C-major pentatonic from G4. */
export function depthPitch(depth: number): number {
  return 67 + 12 * Math.floor(depth / 5) + PENTATONIC[depth % 5]
}

/** Lo-fi beat + chords + bass for bars [fromBar, toBar). */
export function backing(fromBar: number, toBar: number, out: AudioCue[] = []): AudioCue[] {
  for (let b = fromBar; b < toBar; b++) {
    const t0 = b * BAR
    const ch = PROGRESSION[b % PROGRESSION.length]
    out.push({ t: t0, kind: 'pad', notes: ch.pad, dur: BAR - 0.1 })
    out.push({ t: t0, kind: 'bass', pitch: ch.bass, dur: 0.9 })
    out.push({ t: t0 + 2 * BEAT, kind: 'bass', pitch: ch.bass, dur: 0.4 })
    out.push({ t: t0, kind: 'kick' }, { t: t0 + 2 * BEAT, kind: 'kick' })
    out.push({ t: t0 + BEAT, kind: 'snare' }, { t: t0 + 3 * BEAT, kind: 'snare' })
    for (let k = 0; k < 4; k++) out.push({ t: t0 + (k + 0.5) * BEAT, kind: 'hat', gain: k % 2 ? 0.8 : 1 })
  }
  return out
}

/** A busy, solve-video-like score of `durationSec` seconds. */
export function denseScore(durationSec: number, seed = 7): AudioCue[] {
  const rng = mulberry32(seed)
  const cues: AudioCue[] = []
  const finale = durationSec >= 12
  const solveAt = finale ? durationSec - 6.5 : durationSec
  backing(0, Math.ceil(solveAt / BAR), cues)

  // DFS stream.
  let t = 0.05
  let depth = 0
  let best = 0
  while (t < solveAt - (finale ? 1.6 : 0.1)) {
    const burst = Math.floor(t / 3) % 3 === 2
    const rate = burst ? 34 : 26
    const pBack = Math.min(0.42, 0.1 + 0.025 * depth)
    if (rng() > pBack || depth === 0) {
      depth = Math.min(depth + 1, 15)
      const pitch = depthPitch(depth)
      const pan = (rng() * 2 - 1) * 0.25
      cues.push({ t, kind: 'place', pitch, pan })
      if (depth > best) {
        best = depth
        cues.push({ t, kind: 'record', pitch: pitch + 12, pan })
      }
    } else {
      if (rng() < 0.45) cues.push({ t, kind: 'conflict' })
      cues.push({ t, kind: 'remove', pitch: depthPitch(depth) })
      depth--
    }
    t += (0.75 + 0.5 * rng()) / rate
  }

  if (finale) {
    cues.push({ t: solveAt - 1.5, kind: 'riser', dur: 1.5 })
    cues.push({ t: solveAt, kind: 'impact' }, { t: solveAt, kind: 'pop' })
    cues.push({ t: solveAt, kind: 'pad', notes: [48, 55, 60, 64, 67, 71, 74], dur: 4 })
    cues.push({ t: solveAt, kind: 'bass', pitch: 36, dur: 3.5 })
    cues.push({ t: solveAt, kind: 'sparkle', notes: [84, 86, 88, 91, 93], dur: 2.5 })
    const arp = [72, 76, 79, 84, 88, 91, 96, 100]
    arp.forEach((p, i) => cues.push({ t: solveAt + i * (BEAT / 4), kind: 'chime', pitch: p }))
    for (let k = 0; k < 25; k++) cues.push({ t: solveAt + 3 + k * 0.04, kind: 'tick' })
    cues.push({ t: durationSec - 1.5, kind: 'whoosh', dur: 0.6 })
  }
  return cues
}
