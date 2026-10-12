/**
 * Procedural audio engine: timed cues -> mastered stereo buffer.
 *
 *   cues --> voices (cached one-shots) --> dry bus (stereo)
 *                                      \-> duck bus (pad + bass, sidechained to kicks)
 *                                      \-> reverb send (mono) -> Freeverb -> return
 *   sum -> DC-block HPF -> shelf EQ -> BS.1770 loudness normalisation -> true-peak lookahead
 *   limiter (normalisation re-iterated to compensate limiter loss) -> clamp -> end fade
 *
 * Deterministic: noise is seeded from (seed, voice key), so the same cues and
 * seed always produce bit-identical output, independent of cue order.
 */
import type { AudioCue, CueKind, RenderOptions, StereoBuffer } from './types'
import { balanceGains, clamp, dbToGain, hashInts, hashString, midiToFreq, mulberry32, panGains } from './dsp'
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
} from './voices'
import { addReverb } from './reverb'
import { integratedLoudness } from './loudness'
import { clampInPlace, dcBlock, fadeOutEnd, limitInto, makeLimiterScratch, peakEnvelope, toneShape } from './master'

export type { AudioCue, CueKind, LoudnessReport, RenderOptions, StereoBuffer } from './types'
export { CUE_KINDS } from './types'
export { midiToFreq } from './dsp'
export { measureLoudness } from './loudness'
export { encodeWav } from './wav'

// ------------------------------------------------------------------ mix table

export interface KindMix {
  /** Default linear level (voices peak around 1 before this). */
  level: number
  /** Dry amount (multiplies level). */
  dry: number
  /** Reverb send amount (multiplies level). */
  send: number
  /** Routed through the kick-sidechain duck bus. */
  duck: boolean
}

function mix(level: number, send: number, dry = 1, duck = false): KindMix {
  return { level, dry, send, duck }
}

/**
 * Default level / reverb send per kind. `place` is the lead and sits on top;
 * drums and pad are background. Tune here.
 */
export const KIND_MIX: Readonly<Record<CueKind, KindMix>> = {
  place: mix(0.5, 0.25),
  record: mix(0.16, 0.55),
  remove: mix(0.18, 0.15),
  conflict: mix(0.31, 0.05),
  kick: mix(0.23, 0),
  snare: mix(0.35, 0.08),
  clap: mix(0.4, 0.1),
  hat: mix(0.17, 0),
  openhat: mix(0.13, 0.03),
  pad: mix(0.12, 0.4, 1, true),
  bass: mix(0.12, 0, 1, true),
  riser: mix(0.25, 0.1),
  impact: mix(0.56, 0.3),
  chime: mix(0.23, 0.5),
  sparkle: mix(0.27, 0.8, 0.55),
  pop: mix(0.7, 0.1),
  whoosh: mix(0.23, 0.1),
  tick: mix(0.1, 0),
}

/** Sidechain ducking of the pad + bass bus after each kick. */
export const DUCK_DEPTH = 0.3
export const DUCK_ATTACK = 0.005
export const DUCK_RELEASE = 0.15

/** Defaults for optional cue fields. */
export const CUE_DEFAULTS = {
  pitch: { place: 72, record: 84, remove: 72, chime: 84, bass: 36 } as Partial<Record<CueKind, number>>,
  dur: { pad: 2, bass: 0.5, riser: 1.5, sparkle: 2, whoosh: 0.4 } as Partial<Record<CueKind, number>>,
  sparkleNotes: [84, 86, 88, 91, 93],
  tickHz: 2400,
}

const MAX_DUR = 120
/** Extra make-up gain allowed on top of the pre-limiter normalisation (dB). */
const MAX_LIMITER_MAKEUP_DB = 3
const LOUDNESS_ITERATIONS = 3

// ------------------------------------------------------------------ voices

const KIND_INDEX = new Map<CueKind, number>(
  (Object.keys(KIND_MIX) as CueKind[]).map((k, i): [CueKind, number] => [k, i]),
)

const pitchKey = (p: number): number => Math.round(p * 100)
const durKey = (d: number): number => Math.round(d * 1000)

function cuePitch(c: AudioCue): number {
  return c.pitch !== undefined && Number.isFinite(c.pitch) ? c.pitch : (CUE_DEFAULTS.pitch[c.kind] ?? 72)
}

function cueDur(c: AudioCue): number {
  const d = c.dur !== undefined && Number.isFinite(c.dur) && c.dur > 0 ? c.dur : (CUE_DEFAULTS.dur[c.kind] ?? 0.5)
  return clamp(d, 0.01, MAX_DUR)
}

function cueNotes(c: AudioCue): number[] {
  return (c.notes ?? []).filter((m) => Number.isFinite(m))
}

/** Renders (or fetches from cache) the voice for a cue. Every voice is keyed by its parameters. */
class VoiceBank {
  private readonly cache = new Map<string, Voice>()
  private readonly pings = new Map<number, Float32Array>()
  private readonly sr: number
  private readonly seed: number

  constructor(sr: number, seed: number) {
    this.sr = sr
    this.seed = seed
  }

  private rng(key: string) {
    return mulberry32(hashInts(this.seed, hashString(key)))
  }

  private ping = (pitch: number): Float32Array => {
    const k = pitchKey(pitch)
    let b = this.pings.get(k)
    if (!b) {
      b = renderPing(this.sr, k / 100)
      this.pings.set(k, b)
    }
    return b
  }

  get(c: AudioCue): Voice | null {
    const key = this.key(c)
    if (key === null) return null
    let v = this.cache.get(key)
    if (!v) {
      v = this.render(c, key)
      this.cache.set(key, v)
    }
    return v
  }

  private key(c: AudioCue): string | null {
    switch (c.kind) {
      case 'place':
      case 'record':
      case 'remove':
      case 'chime':
        return `${c.kind}:${pitchKey(cuePitch(c))}`
      case 'tick':
        return `tick:${c.pitch !== undefined && Number.isFinite(c.pitch) ? pitchKey(c.pitch) : 'd'}`
      case 'bass':
        return `bass:${pitchKey(cuePitch(c))}:${durKey(cueDur(c))}`
      case 'pad': {
        const notes = cueNotes(c)
        if (notes.length === 0) return null
        return `pad:${notes.map(pitchKey).join(',')}:${durKey(cueDur(c))}`
      }
      case 'sparkle': {
        const notes = cueNotes(c)
        return `sparkle:${(notes.length ? notes : CUE_DEFAULTS.sparkleNotes).map(pitchKey).join(',')}:${durKey(cueDur(c))}`
      }
      case 'riser':
      case 'whoosh':
        return `${c.kind}:${durKey(cueDur(c))}`
      case 'conflict':
      case 'kick':
      case 'snare':
      case 'clap':
      case 'hat':
      case 'openhat':
      case 'impact':
      case 'pop':
        return c.kind
      default:
        return null
    }
  }

  private render(c: AudioCue, key: string): Voice {
    const sr = this.sr
    const pitch = pitchKey(cuePitch(c)) / 100
    const dur = durKey(cueDur(c)) / 1000
    switch (c.kind) {
      case 'place':
        return renderPlace(sr, pitch, this.rng(key))
      case 'record':
        return renderRecord(sr, pitch, this.rng(key))
      case 'remove':
        return renderRemove(sr, pitch)
      case 'conflict':
        return renderConflict(sr, this.rng(key))
      case 'kick':
        return renderKick(sr, this.rng(key))
      case 'snare':
        return renderSnare(sr, this.rng(key))
      case 'clap':
        return renderClap(sr, this.rng(key))
      case 'hat':
        return renderHat(sr, this.rng(key), false)
      case 'openhat':
        return renderHat(sr, this.rng(key), true)
      case 'pad':
        return renderPad(sr, cueNotes(c).map((m) => pitchKey(m) / 100), dur, this.rng(key))
      case 'bass':
        return renderBass(sr, pitch, dur)
      case 'riser':
        return renderRiser(sr, dur, this.rng(key))
      case 'impact':
        return renderImpact(sr, this.rng(key))
      case 'chime':
        return renderChime(sr, pitch)
      case 'sparkle': {
        const notes = cueNotes(c)
        const pool = (notes.length ? notes : CUE_DEFAULTS.sparkleNotes).map((m) => pitchKey(m) / 100)
        return renderSparkle(sr, pool, dur, this.rng(key), this.ping)
      }
      case 'pop':
        return renderPop(sr, this.rng(key))
      case 'whoosh':
        return renderWhoosh(sr, dur, this.rng(key))
      case 'tick': {
        const hasPitch = c.pitch !== undefined && Number.isFinite(c.pitch)
        return renderTick(sr, hasPitch ? midiToFreq(pitch) : CUE_DEFAULTS.tickHz)
      }
    }
  }
}

// ------------------------------------------------------------------ mixing

interface Buses {
  dryL: Float32Array
  dryR: Float32Array
  duckL: Float32Array
  duckR: Float32Array
  send: Float32Array
}

function mixVoice(v: Voice, start: number, level: number, pan: number, m: KindMix, b: Buses): void {
  const dstL = m.duck ? b.duckL : b.dryL
  const dstR = m.duck ? b.duckR : b.dryR
  const send = b.send
  const len = Math.min(v.l.length, dstL.length - start)
  if (len <= 0) return
  const dry = level * m.dry
  const snd = level * m.send
  if (v.r === null) {
    const [pl, pr] = panGains(pan)
    const gl = dry * pl
    const gr = dry * pr
    const src = v.l
    if (snd !== 0) {
      for (let i = 0; i < len; i++) {
        const s = src[i]
        dstL[start + i] += s * gl
        dstR[start + i] += s * gr
        send[start + i] += s * snd
      }
    } else {
      for (let i = 0; i < len; i++) {
        const s = src[i]
        dstL[start + i] += s * gl
        dstR[start + i] += s * gr
      }
    }
  } else {
    const [bl, br] = balanceGains(pan)
    const gl = dry * bl
    const gr = dry * br
    const gs = snd * Math.SQRT1_2
    const srcL = v.l
    const srcR = v.r
    for (let i = 0; i < len; i++) {
      const a = srcL[i]
      const c = srcR[i]
      dstL[start + i] += a * gl
      dstR[start + i] += c * gr
      send[start + i] += (a + c) * gs
    }
  }
}

/** Gain curve for the duck bus: quick dip after each kick, smooth recovery. */
function duckEnvelope(n: number, sr: number, kicks: { start: number; depth: number }[]): Float32Array {
  const env = new Float32Array(n).fill(1)
  const na = Math.max(1, Math.round(DUCK_ATTACK * sr))
  const nr = Math.max(1, Math.round(DUCK_RELEASE * sr))
  for (const { start, depth } of kicks) {
    for (let i = 0; i < na + nr; i++) {
      const idx = start + i
      if (idx >= n) break
      const shape = i < na ? Math.pow(Math.sin((0.5 * Math.PI * i) / na), 2) : 0.5 * (1 + Math.cos((Math.PI * (i - na)) / nr))
      const g = 1 - depth * shape
      if (g < env[idx]) env[idx] = g
    }
  }
  return env
}

function cmpNum(a: number | undefined, b: number | undefined): number {
  const x = a ?? 0
  const y = b ?? 0
  return x < y ? -1 : x > y ? 1 : 0
}

/** Canonical cue order, so the float summation order (and output bits) never depend on input order. */
function compareCues(a: AudioCue, b: AudioCue): number {
  return (
    cmpNum(a.t, b.t) ||
    cmpNum(KIND_INDEX.get(a.kind), KIND_INDEX.get(b.kind)) ||
    cmpNum(a.pitch, b.pitch) ||
    cmpNum(a.dur, b.dur) ||
    cmpNum(a.gain, b.gain) ||
    cmpNum(a.pan, b.pan) ||
    (a.notes ?? []).join(',').localeCompare((b.notes ?? []).join(','))
  )
}

/**
 * Mixes all cues into the pre-master stereo bus (dry + ducked + reverb return),
 * before DC-blocking, normalisation and limiting. Exposed for diagnostics.
 */
export function renderPreMaster(cues: AudioCue[], durationSec: number, opts: RenderOptions = {}): StereoBuffer {
  const sr = opts.sampleRate ?? 48000
  if (!(Number.isFinite(sr) && sr >= 8000 && sr <= 384000)) throw new RangeError(`bad sampleRate ${sr}`)
  const seed = opts.seed ?? 1
  const n = Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * sr) : 0
  const buses: Buses = {
    dryL: new Float32Array(n),
    dryR: new Float32Array(n),
    duckL: new Float32Array(n),
    duckR: new Float32Array(n),
    send: new Float32Array(n),
  }
  const bank = new VoiceBank(sr, seed)
  const kicks: { start: number; depth: number }[] = []
  let ducked = false

  const valid = cues.filter((c) => c && Number.isFinite(c.t) && c.t >= 0 && c.t < durationSec && KIND_INDEX.has(c.kind))
  valid.sort(compareCues)
  for (const c of valid) {
    const start = Math.round(c.t * sr)
    if (start >= n) continue
    const m = KIND_MIX[c.kind]
    const gain = c.gain === undefined ? 1 : Number.isFinite(c.gain) ? Math.max(0, c.gain) : 1
    const level = m.level * gain
    if (c.kind === 'kick' && gain > 0) kicks.push({ start, depth: DUCK_DEPTH * Math.min(1, gain) })
    if (level === 0) continue
    const v = bank.get(c)
    if (!v) continue
    mixVoice(v, start, level, c.pan ?? 0, m, buses)
    if (m.duck) ducked = true
  }

  if (ducked) {
    const env = kicks.length ? duckEnvelope(n, sr, kicks) : null
    for (let i = 0; i < n; i++) {
      const g = env ? env[i] : 1
      buses.dryL[i] += buses.duckL[i] * g
      buses.dryR[i] += buses.duckR[i] * g
    }
  }
  addReverb(buses.send, sr, buses.dryL, buses.dryR)
  return { left: buses.dryL, right: buses.dryR, sampleRate: sr }
}

/**
 * Renders `cues` into a mastered stereo buffer of exactly round(durationSec * sr)
 * samples, normalised to `targetLufs` integrated loudness with a true-peak
 * ceiling of `ceilingDb`.
 */
export function renderAudio(cues: AudioCue[], durationSec: number, opts: RenderOptions = {}): StereoBuffer {
  const pre = renderPreMaster(cues, durationSec, opts)
  const sr = pre.sampleRate
  const target = opts.targetLufs ?? -14
  const ceiling = dbToGain(opts.ceilingDb ?? -1) * (1 - 1e-6)
  const L = pre.left
  const R = pre.right
  const n = L.length
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  if (n === 0) return { left: outL, right: outR, sampleRate: sr }

  dcBlock(L, R, sr)
  toneShape(L, R, sr)
  const lin = integratedLoudness(L, R, sr)
  const normalise = Number.isFinite(lin) && Number.isFinite(target)
  let gainDb = normalise ? target - lin : 0
  const maxGainDb = gainDb + (normalise ? MAX_LIMITER_MAKEUP_DB : 0)
  // Below ceiling / maxGain nothing can ever need limiting: skip true-peak interpolation there.
  const peak = peakEnvelope(L, R, ceiling / dbToGain(maxGainDb))
  const scratch = makeLimiterScratch(n)
  limitInto(L, R, peak, dbToGain(gainDb), ceiling, sr, outL, outR, scratch)

  if (normalise) {
    // The limiter shaves a little loudness off; re-aim (bounded) so we land on target.
    for (let it = 0; it < LOUDNESS_ITERATIONS; it++) {
      const lout = integratedLoudness(outL, outR, sr)
      if (!Number.isFinite(lout)) break
      const next = Math.min(maxGainDb, gainDb + (target - lout))
      if (Math.abs(target - lout) < 0.05 || Math.abs(next - gainDb) < 0.01) break
      gainDb = next
      limitInto(L, R, peak, dbToGain(gainDb), ceiling, sr, outL, outR, scratch)
    }
  }

  clampInPlace(outL, outR)
  fadeOutEnd(outL, outR, sr)
  return { left: outL, right: outR, sampleRate: sr }
}
