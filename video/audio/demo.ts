/**
 * Renders a ~20 s showcase of every cue kind to a WAV and prints stats.
 *
 *   npx tsx video/audio/demo.ts [out.wav] [--bench]
 *
 * --bench additionally renders a 60 s dense synthetic score and reports timing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import type { AudioCue } from './types'
import { renderAudio, measureLoudness, encodeWav } from './synth'
import { mulberry32, gainToDb } from './dsp'
import { peakEnvelope } from './master'
import { denseScore } from './fixtures'

const BEAT = 0.5 // 120 BPM
const BAR = 4 * BEAT
export const DEMO_DURATION = 20

/** C - G - Am - F: pad voicing, bass root, and the chord tones the solver "climbs". */
const CHORDS = {
  C: { pad: [60, 64, 67, 71], bass: 36, tones: [67, 72, 76, 79, 84, 88, 91, 96] },
  G: { pad: [59, 62, 67, 71], bass: 43, tones: [67, 71, 74, 79, 83, 86, 91, 95] },
  Am: { pad: [57, 60, 64, 69], bass: 45, tones: [69, 72, 76, 81, 84, 88, 93, 96] },
  F: { pad: [57, 60, 65, 69], bass: 41, tones: [69, 72, 77, 81, 84, 89, 93, 96] },
}
const BARS = [CHORDS.C, CHORDS.G, CHORDS.Am, CHORDS.F, CHORDS.C, CHORDS.G, CHORDS.Am]

function drums(cues: AudioCue[], bar: number, opts: { snare?: boolean; fourOnFloor?: boolean } = {}): void {
  const t0 = bar * BAR
  const kicks = opts.fourOnFloor ? [0, 1, 2, 3] : [0, 2]
  for (const k of kicks) cues.push({ t: t0 + k * BEAT, kind: 'kick' })
  if (opts.snare !== false) {
    cues.push({ t: t0 + BEAT, kind: 'snare' })
    cues.push({ t: t0 + 3 * BEAT, kind: 'snare' }, { t: t0 + 3 * BEAT + 0.012, kind: 'clap', gain: 0.8 })
  }
  for (let e = 0; e < 8; e++) {
    const t = t0 + e * (BEAT / 2)
    if (e === 7 && bar % 2 === 1) cues.push({ t, kind: 'openhat', pan: 0.2 })
    else cues.push({ t, kind: 'hat', gain: e % 2 ? 0.7 : 1, pan: 0.2 })
  }
}

export function demoScore(): AudioCue[] {
  const cues: AudioCue[] = []
  const rng = mulberry32(2024)

  // Bars 0-6: chords + bass; drums on bars 0-5, four-on-the-floor build in bar 6.
  BARS.forEach((ch, b) => {
    const t0 = b * BAR
    cues.push({ t: t0, kind: 'pad', notes: ch.pad, dur: BAR - 0.15 })
    cues.push({ t: t0, kind: 'bass', pitch: ch.bass, dur: 0.85 })
    cues.push({ t: t0 + 2 * BEAT, kind: 'bass', pitch: ch.bass, dur: 0.4 })
    cues.push({ t: t0 + 3.5 * BEAT, kind: 'bass', pitch: ch.bass + 12, dur: 0.2, gain: 0.7 })
    if (b < 6) drums(cues, b)
    else drums(cues, b, { snare: false, fourOnFloor: true })
  })

  // The "solver": a depth-first walk over chord tones at increasing speed.
  // 8ths in bars 0-2, 16ths in bars 3-4, 32nds in bar 5; its depth cap grows
  // over time, so new records keep appearing.
  let depth = 0
  let best = 0
  for (let b = 0; b < 6; b++) {
    const ch = BARS[b]
    const rate = b < 3 ? 4 : b < 5 ? 8 : 16
    const cap = Math.min(ch.tones.length - 1, 2 + b)
    for (let k = 0; k < BAR * rate; k++) {
      const t = b * BAR + k / rate
      const back = depth > 0 && (depth >= cap || rng() < 0.18 + 0.05 * depth)
      if (back) {
        if (depth >= cap && rng() < 0.6) cues.push({ t, kind: 'conflict' })
        cues.push({ t, kind: 'remove', pitch: ch.tones[depth], pan: 0.1 })
        depth--
      } else {
        depth++
        const pan = (depth / 7 - 0.5) * 0.5
        cues.push({ t, kind: 'place', pitch: ch.tones[depth], pan })
        if (depth > best) {
          best = depth
          cues.push({ t, kind: 'record', pitch: ch.tones[depth] + 12, pan })
        }
      }
    }
  }
  // Bar 6: the final ascent at 32nds, straight up the A-minor/C tones, with the riser.
  const climb = [69, 72, 76, 79, 81, 84, 88, 91, 93, 96, 100, 103]
  for (let k = 0; k < 32; k++) {
    const t = 6 * BAR + k / 16
    cues.push({ t, kind: 'place', pitch: climb[Math.min(climb.length - 1, Math.floor(k / 2.7))], pan: (k / 31 - 0.5) * 0.4 })
  }
  const solveAt = 7 * BAR // 14 s, a downbeat
  cues.push({ t: solveAt - 1.5, kind: 'riser', dur: 1.5 })

  // The payoff.
  cues.push({ t: solveAt, kind: 'impact' }, { t: solveAt, kind: 'pop' })
  cues.push({ t: solveAt, kind: 'pad', notes: [48, 55, 60, 64, 67, 71, 74], dur: 3.6 })
  cues.push({ t: solveAt, kind: 'bass', pitch: 36, dur: 3.4 })
  cues.push({ t: solveAt, kind: 'sparkle', notes: [84, 86, 88, 91, 93], dur: 3 })
  // Verification sweep: C-major chime arpeggio on 16ths.
  ;[72, 76, 79, 84, 88, 91, 96, 100].forEach((p, i) =>
    cues.push({ t: solveAt + i * (BEAT / 2 / 2), kind: 'chime', pitch: p, pan: (i / 7 - 0.5) * 0.6 }),
  )
  // Groove returns, counter rolls up.
  drums(cues, 8)
  for (let k = 0; k < 25; k++) cues.push({ t: 16.2 + k * 0.04, kind: 'tick', pan: -0.1 })
  // Transition out + resolving outro.
  cues.push({ t: 18, kind: 'whoosh', dur: 0.6 })
  cues.push({ t: 18.4, kind: 'pad', notes: [53, 60, 64, 69], dur: 0.6, gain: 0.8 })
  cues.push({ t: 18.4, kind: 'pad', notes: [48, 55, 64, 67, 72], dur: 0.7, gain: 0.8 })
  ;[96, 91, 88, 84].forEach((p, i) => cues.push({ t: 18.6 + i * 0.125, kind: 'place', pitch: p, gain: 0.8 - i * 0.1 }))
  return cues
}

function report(label: string, ms: number, buf: ReturnType<typeof renderAudio>): void {
  const m = measureLoudness(buf)
  const tp = peakEnvelope(buf.left, buf.right)
  let tpMax = 0
  for (let i = 0; i < tp.length; i++) if (tp[i] > tpMax) tpMax = tp[i]
  console.log(
    `${label}: rendered ${(buf.left.length / buf.sampleRate).toFixed(1)} s in ${ms.toFixed(0)} ms | ` +
      `integrated ${m.integratedLufs.toFixed(2)} LUFS | sample peak ${m.peakDb.toFixed(2)} dBFS | ` +
      `true peak ~${gainToDb(tpMax).toFixed(2)} dBTP`,
  )
}

function main(): void {
  const args = process.argv.slice(2)
  const outPath = args.find((a) => !a.startsWith('--')) ?? 'output/audio-demo.wav'

  const cues = demoScore()
  const t0 = performance.now()
  const buf = renderAudio(cues, DEMO_DURATION, { seed: 1 })
  const ms = performance.now() - t0
  report(`demo (${cues.length} cues)`, ms, buf)
  mkdirSync(dirname(resolve(outPath)), { recursive: true })
  writeFileSync(outPath, encodeWav(buf))
  console.log(`wrote ${outPath}`)

  if (args.includes('--bench')) {
    const dense = denseScore(60)
    const counts: Record<string, number> = {}
    for (const c of dense) counts[c.kind] = (counts[c.kind] ?? 0) + 1
    console.log('dense 60 s score:', JSON.stringify(counts))
    for (let rep = 0; rep < 2; rep++) {
      const s = performance.now()
      const out = renderAudio(dense, 60, { seed: 1 })
      report(`bench run ${rep + 1}`, performance.now() - s, out)
    }
  }
}

// Run only when executed directly (the score is importable for tooling).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
