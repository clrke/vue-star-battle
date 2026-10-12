import { describe, expect, it } from 'vitest'
import { encodeWav, measureLoudness, midiToFreq, renderAudio, renderPreMaster } from '../synth'
import { CUE_KINDS, type AudioCue, type CueKind, type StereoBuffer } from '../types'
import { denseScore } from '../fixtures'
import { mulberry32 } from '../dsp'
import {
  renderBass,
  renderChime,
  renderClap,
  renderConflict,
  renderHat,
  renderImpact,
  renderKick,
  renderPad,
  renderPing,
  renderPlace,
  renderPop,
  renderRecord,
  renderRemove,
  renderRiser,
  renderSnare,
  renderSparkle,
  renderTick,
  renderWhoosh,
  type Voice,
} from '../voices'

const SR = 48000

function maxAbs(b: StereoBuffer, from: number, to: number): number {
  let m = 0
  for (let i = Math.max(0, from); i < Math.min(to, b.left.length); i++) {
    m = Math.max(m, Math.abs(b.left[i]), Math.abs(b.right[i]))
  }
  return m
}

function rms(b: StereoBuffer, from: number, to: number): number {
  let s = 0
  let n = 0
  for (let i = Math.max(0, from); i < Math.min(to, b.left.length); i++) {
    s += b.left[i] * b.left[i] + b.right[i] * b.right[i]
    n += 2
  }
  return n ? Math.sqrt(s / n) : 0
}

function allFinite(b: StereoBuffer): boolean {
  for (let i = 0; i < b.left.length; i++) if (!Number.isFinite(b.left[i]) || !Number.isFinite(b.right[i])) return false
  return true
}

function sameBits(a: StereoBuffer, b: StereoBuffer): boolean {
  const eq = (x: Float32Array, y: Float32Array) =>
    x.length === y.length && Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength))
  return eq(a.left, b.left) && eq(a.right, b.right)
}

/** A representative cue of each kind at time t. */
function cueOf(kind: CueKind, t: number): AudioCue {
  switch (kind) {
    case 'pad':
      return { t, kind, notes: [60, 64, 67, 71], dur: 0.8 }
    case 'sparkle':
      return { t, kind, notes: [84, 86, 88, 91, 93], dur: 0.8 }
    case 'bass':
      return { t, kind, pitch: 36, dur: 0.5 }
    case 'riser':
      return { t, kind, dur: 0.8 }
    case 'whoosh':
      return { t, kind, dur: 0.4 }
    case 'place':
    case 'remove':
      return { t, kind, pitch: 76 }
    case 'record':
    case 'chime':
      return { t, kind, pitch: 88 }
    default:
      return { t, kind }
  }
}

/** Where each kind must have audible energy, relative to its start (s). */
function window(kind: CueKind): [number, number] {
  switch (kind) {
    case 'riser':
    case 'pad':
    case 'sparkle':
      return [0, 0.8]
    case 'whoosh':
      return [0, 0.4]
    case 'tick':
      return [0, 0.01]
    default:
      return [0, 0.15]
  }
}

describe('renderAudio: shape and edge cases', () => {
  it('returns exactly round(duration * sampleRate) samples', () => {
    for (const d of [0.5, 1.2345, 2]) {
      const out = renderAudio([{ t: 0.1, kind: 'place', pitch: 72 }], d)
      expect(out.left.length).toBe(Math.round(d * SR))
      expect(out.right.length).toBe(Math.round(d * SR))
      expect(out.sampleRate).toBe(SR)
    }
    const o44 = renderAudio([{ t: 0.1, kind: 'kick' }], 1.5, { sampleRate: 44100 })
    expect(o44.left.length).toBe(Math.round(1.5 * 44100))
    expect(o44.sampleRate).toBe(44100)
    expect(allFinite(o44)).toBe(true)
  })

  it('renders a silent score as exact zeros without NaN', () => {
    const out = renderAudio([], 2)
    expect(out.left.every((v) => v === 0)).toBe(true)
    expect(out.right.every((v) => v === 0)).toBe(true)
    const m = measureLoudness(out)
    expect(m.integratedLufs).toBe(-Infinity)
    expect(m.peakDb).toBe(-Infinity)
  })

  it('handles empty / invalid durations', () => {
    expect(renderAudio([{ t: 0, kind: 'kick' }], 0).left.length).toBe(0)
    expect(renderAudio([{ t: 0, kind: 'kick' }], -1).left.length).toBe(0)
    expect(renderAudio([{ t: 0, kind: 'kick' }], Number.NaN).left.length).toBe(0)
  })

  it('ignores cues with t < 0, t >= duration, non-finite t, unknown kinds and empty pads', () => {
    const cues = [
      { t: -0.5, kind: 'place', pitch: 72 },
      { t: 2, kind: 'kick' },
      { t: 7, kind: 'impact' },
      { t: Number.NaN, kind: 'snare' },
      { t: 0.5, kind: 'banana' },
      { t: 0.5, kind: 'pad', notes: [] },
      { t: 0.5, kind: 'pad' },
    ] as unknown as AudioCue[]
    const out = renderAudio(cues, 2)
    expect(out.left.every((v) => v === 0) && out.right.every((v) => v === 0)).toBe(true)
  })

  it('truncates sounds that run past the end and still ends on a fade to zero', () => {
    const cues: AudioCue[] = [
      { t: 1.0, kind: 'riser', dur: 5 },
      { t: 1.9, kind: 'pad', notes: [48, 55, 60, 64], dur: 10 },
      { t: 1.95, kind: 'impact' },
      { t: 1.99, kind: 'sparkle', notes: [84, 88], dur: 3 },
    ]
    const out = renderAudio(cues, 2)
    expect(out.left.length).toBe(2 * SR)
    expect(allFinite(out)).toBe(true)
    const n = out.left.length
    expect(Math.abs(out.left[n - 1])).toBe(0)
    expect(Math.abs(out.right[n - 1])).toBe(0)
    // The 20 ms fade: the last millisecond is far below the level just before the fade.
    expect(maxAbs(out, n - 48, n)).toBeLessThan(0.05 * maxAbs(out, n - 2400, n - 960) + 1e-6)
  })

  it('tolerates odd parameters (NaN gain/pitch/dur, out-of-range pan)', () => {
    const cues = [
      { t: 0.1, kind: 'place', pitch: Number.NaN, gain: Number.NaN, pan: 7 },
      { t: 0.2, kind: 'bass', pitch: 36, dur: Number.NaN },
      { t: 0.3, kind: 'whoosh', dur: -3 },
      { t: 0.4, kind: 'chime', pitch: 140 },
      { t: 0.5, kind: 'remove', pitch: 130, pan: -9 },
      { t: 0.6, kind: 'record', pitch: 20, gain: -2 },
    ] as AudioCue[]
    const out = renderAudio(cues, 1.5)
    expect(allFinite(out)).toBe(true)
    expect(rms(out, 0, out.left.length)).toBeGreaterThan(0)
  })
})

describe('renderAudio: dense score mastering', () => {
  const cues = denseScore(16)
  const out = renderAudio(cues, 16, { seed: 3 })

  it('contains no NaN or Inf', () => {
    expect(allFinite(out)).toBe(true)
  })

  it('keeps the peak at or below the ceiling', () => {
    expect(measureLoudness(out).peakDb).toBeLessThanOrEqual(-1 + 1e-4)
    const low = renderAudio(cues, 16, { seed: 3, ceilingDb: -3 })
    expect(measureLoudness(low).peakDb).toBeLessThanOrEqual(-3 + 1e-4)
  })

  it('normalises integrated loudness to within 1 LU of the target', () => {
    expect(Math.abs(measureLoudness(out).integratedLufs - -14)).toBeLessThan(1)
    const quiet = renderAudio(cues, 16, { seed: 3, targetLufs: -20 })
    expect(Math.abs(measureLoudness(quiet).integratedLufs - -20)).toBeLessThan(1)
  })
})

describe('determinism', () => {
  const cues = denseScore(6, 11)

  it('is bit-identical for the same cues and seed', () => {
    expect(sameBits(renderAudio(cues, 6, { seed: 5 }), renderAudio(cues, 6, { seed: 5 }))).toBe(true)
  })

  it('does not depend on cue order', () => {
    const rng = mulberry32(99)
    const shuffled = cues.map((c) => ({ c, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.c)
    expect(sameBits(renderAudio(cues, 6, { seed: 5 }), renderAudio(shuffled, 6, { seed: 5 }))).toBe(true)
  })

  it('changes the noise when the seed changes', () => {
    const hats: AudioCue[] = [{ t: 0.1, kind: 'hat' }, { t: 0.3, kind: 'snare' }]
    expect(sameBits(renderAudio(hats, 1, { seed: 1 }), renderAudio(hats, 1, { seed: 2 }))).toBe(false)
  })
})

describe('every cue kind', () => {
  for (const kind of CUE_KINDS) {
    it(`${kind}: silent before t, audible right after`, () => {
      const t = 0.5
      const out = renderAudio([cueOf(kind, t)], 2.5)
      const s = Math.round(t * SR)
      expect(allFinite(out)).toBe(true)
      expect(maxAbs(out, 0, s)).toBeLessThan(1e-9)
      const [a, b] = window(kind)
      expect(rms(out, s + Math.round(a * SR), s + Math.round(b * SR))).toBeGreaterThan(0.01)
    })
  }

  it('riser peaks at t + dur', () => {
    const pre = renderPreMaster([{ t: 0.2, kind: 'riser', dur: 1 }], 2)
    const env = (from: number) => rms(pre, Math.round(from * SR), Math.round((from + 0.05) * SR))
    expect(env(1.14)).toBeGreaterThan(env(0.9))
    expect(env(0.9)).toBeGreaterThan(env(0.6))
    // The dry riser is gone ~15 ms after the peak; only its (much quieter) reverb tail remains.
    expect(env(1.25)).toBeLessThan(0.05 * env(1.14))
  })
})

describe('place articulation (no wall of mush at 16 notes/s)', () => {
  it('each onset rises well above the decaying tails of earlier notes', () => {
    const cues: AudioCue[] = []
    const pent = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93]
    for (let k = 0; k < 48; k++) cues.push({ t: 0.1 + k / 16, kind: 'place', pitch: pent[k % pent.length] })
    const out = renderAudio(cues, 3.5)
    const win = Math.round(0.004 * SR)
    const env = (w: number) => rms(out, w * win, (w + 1) * win)
    const ratios: number[] = []
    for (const c of cues) {
      if (c.t < 1 || c.t > 3) continue
      const w0 = Math.round((c.t * SR) / win)
      let pk = 0
      for (let w = w0; w < w0 + 5; w++) pk = Math.max(pk, env(w))
      let tr = Infinity
      for (let w = w0 - 3; w < w0; w++) tr = Math.min(tr, env(w))
      ratios.push(20 * Math.log10(pk / tr))
    }
    ratios.sort((x, y) => x - y)
    expect(ratios[ratios.length >> 1]).toBeGreaterThan(6) // median onset contrast (measured ~9 dB)
    expect(ratios[0]).toBeGreaterThan(3)
  })
})

describe('voices are click-free', () => {
  const rng = () => mulberry32(1)
  const voices: [string, Voice][] = [
    ['place', renderPlace(SR, 76, rng())],
    ['record', renderRecord(SR, 88, rng())],
    ['remove', renderRemove(SR, 76)],
    ['conflict', renderConflict(SR, rng())],
    ['kick', renderKick(SR, rng())],
    ['snare', renderSnare(SR, rng())],
    ['clap', renderClap(SR, rng())],
    ['hat', renderHat(SR, rng(), false)],
    ['openhat', renderHat(SR, rng(), true)],
    ['pad', renderPad(SR, [60, 64, 67], 1, rng())],
    ['bass', renderBass(SR, 36, 0.5)],
    ['riser', renderRiser(SR, 0.5, rng())],
    ['impact', renderImpact(SR, rng())],
    ['chime', renderChime(SR, 96)],
    ['sparkle', renderSparkle(SR, [84, 88], 0.5, rng(), (p) => renderPing(SR, p))],
    ['pop', renderPop(SR, rng())],
    ['whoosh', renderWhoosh(SR, 0.4, rng())],
    ['tick', renderTick(SR, 2400)],
  ]
  for (const [name, v] of voices) {
    it(`${name} starts and ends at exactly zero with a smooth onset`, () => {
      for (const ch of v.r ? [v.l, v.r] : [v.l]) {
        expect(Math.abs(ch[0])).toBe(0)
        expect(Math.abs(ch[ch.length - 1])).toBe(0)
        let peak = 0
        for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]))
        expect(peak).toBeGreaterThan(0)
        // >= 1 ms attack: the first 0.2 ms stays well below the voice's peak.
        let early = 0
        for (let i = 0; i < Math.round(0.0002 * SR); i++) early = Math.max(early, Math.abs(ch[i]))
        expect(early).toBeLessThan(0.15 * peak)
      }
    })
  }
})

describe('measureLoudness (BS.1770-4)', () => {
  const sine = (sr: number, amp: number, sec: number): StereoBuffer => {
    const n = Math.round(sec * sr)
    const l = new Float32Array(n)
    for (let i = 0; i < n; i++) l[i] = amp * Math.sin((2 * Math.PI * 1000 * i) / sr)
    return { left: l, right: l.slice(), sampleRate: sr }
  }

  it('reads a -23 dBFS 1 kHz stereo sine as -23 LUFS (EBU Tech 3341 case 1)', () => {
    for (const sr of [48000, 44100]) {
      const m = measureLoudness(sine(sr, Math.pow(10, -23 / 20), 20))
      expect(Math.abs(m.integratedLufs - -23)).toBeLessThan(0.1)
      expect(Math.abs(m.peakDb - -23)).toBeLessThan(0.01)
    }
  })

  it('gates out signals below -70 LUFS', () => {
    expect(measureLoudness(sine(SR, Math.pow(10, -80 / 20), 2)).integratedLufs).toBe(-Infinity)
  })
})

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM stereo RIFF/WAVE header', () => {
    const buf = renderAudio([{ t: 0.05, kind: 'chime', pitch: 84 }], 0.25)
    const wav = encodeWav(buf)
    const n = buf.left.length
    expect(wav.length).toBe(44 + n * 4)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(36 + n * 4)
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.readUInt32LE(16)).toBe(16)
    expect(wav.readUInt16LE(20)).toBe(1) // PCM
    expect(wav.readUInt16LE(22)).toBe(2) // stereo
    expect(wav.readUInt32LE(24)).toBe(48000)
    expect(wav.readUInt32LE(28)).toBe(48000 * 4)
    expect(wav.readUInt16LE(32)).toBe(4)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(n * 4)
  })

  it('quantises within dither range, deterministically, and keeps silence silent', () => {
    const n = 1000
    const left = new Float32Array(n)
    const right = new Float32Array(n)
    for (let i = 0; i < n; i++) left[i] = Math.sin(i / 10) * 0.5
    const buf = { left, right, sampleRate: SR }
    const a = encodeWav(buf)
    expect(a.equals(encodeWav(buf))).toBe(true)
    for (let i = 0; i < n; i++) {
      expect(Math.abs(a.readInt16LE(44 + i * 4) - left[i] * 32767)).toBeLessThanOrEqual(1.5)
      expect(a.readInt16LE(44 + i * 4 + 2)).toBe(0)
    }
  })
})

describe('midiToFreq', () => {
  it('maps A4 = 69 to 440 Hz, octaves double', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 10)
    expect(midiToFreq(81)).toBeCloseTo(880, 10)
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3)
  })
})
