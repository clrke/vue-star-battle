/**
 * Small deterministic DSP building blocks for the procedural audio engine.
 * No Math.random anywhere: all noise comes from the seeded mulberry32 PRNG.
 */

export const TWO_PI = 2 * Math.PI

/** MIDI note number (float ok) -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(g: number): number {
  return g > 0 ? 20 * Math.log10(g) : -Infinity
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Number of samples needed to hold `sec` seconds (at least 1). */
export function samplesFor(sr: number, sec: number): number {
  return Math.max(1, Math.ceil(sec * sr))
}

// ---------------------------------------------------------------- randomness

/** A PRNG returning floats in [0, 1). */
export type Rng = () => number

/** mulberry32: tiny, fast, good-enough 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Murmur3-style hash of a list of integers -> unsigned 32-bit seed. */
export function hashInts(...vals: number[]): number {
  let h = 0x9e3779b9 | 0
  for (let i = 0; i < vals.length; i++) {
    let k = vals[i] | 0
    k = Math.imul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  h ^= vals.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** FNV-1a hash of a string -> unsigned 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ---------------------------------------------------------------- envelopes

/** Smooth 0 -> 1 ramp (sin^2) for x in [0, 1]; 0 below, 1 above. */
export function ramp(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const s = Math.sin(0.5 * Math.PI * x)
  return s * s
}

/** Raised-cosine fade over the last `n` samples, ending at exactly 0. */
export function fadeOutTail(buf: Float32Array, n: number): void {
  const len = buf.length
  const m = Math.min(n, len)
  for (let i = 0; i < m; i++) {
    const x = (i + 1) / m
    buf[len - m + i] *= 0.5 * (1 + Math.cos(Math.PI * x))
  }
}

// ---------------------------------------------------------------- panning

/** Constant-power pan law: [left, right] gains for pan in [-1, 1] (centre = 0.7071 each). */
export function panGains(pan: number): [number, number] {
  const p = Number.isFinite(pan) ? clamp(pan, -1, 1) : 0
  const th = ((p + 1) * Math.PI) / 4
  return [Math.cos(th), Math.sin(th)]
}

/** Balance for already-stereo sources: unity at centre, attenuates the far side. */
export function balanceGains(pan: number): [number, number] {
  const [l, r] = panGains(pan)
  return [Math.min(1, l * Math.SQRT2), Math.min(1, r * Math.SQRT2)]
}

/**
 * Equal-loudness style high-frequency compensation: unity below `kneeHz`,
 * then -`dbPerOct` dB per octave above it, so high notes aren't shrill.
 */
export function hfComp(freq: number, kneeHz = 1200, dbPerOct = 3): number {
  if (!(freq > kneeHz)) return 1
  return Math.pow(freq / kneeHz, -dbPerOct / 6.0206)
}

// ---------------------------------------------------------------- oscillators

/** PolyBLEP residual for a phase in [0, 1) with increment dt (removes saw aliasing). */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

// ---------------------------------------------------------------- filters

/** Normalised biquad coefficients (a0 = 1). */
export interface BiquadCoeffs {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function rbj(sr: number, f: number, q: number): { cw: number; alpha: number } {
  const w = (TWO_PI * clamp(f, 1, sr * 0.49)) / sr
  return { cw: Math.cos(w), alpha: Math.sin(w) / (2 * q) }
}

/** RBJ cookbook 2-pole low-pass. */
export function lowpassCoeffs(sr: number, f: number, q = Math.SQRT1_2): BiquadCoeffs {
  const { cw, alpha } = rbj(sr, f, q)
  const a0 = 1 + alpha
  return {
    b0: (1 - cw) / 2 / a0,
    b1: (1 - cw) / a0,
    b2: (1 - cw) / 2 / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  }
}

/** RBJ cookbook 2-pole high-pass. */
export function highpassCoeffs(sr: number, f: number, q = Math.SQRT1_2): BiquadCoeffs {
  const { cw, alpha } = rbj(sr, f, q)
  const a0 = 1 + alpha
  return {
    b0: (1 + cw) / 2 / a0,
    b1: -(1 + cw) / a0,
    b2: (1 + cw) / 2 / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  }
}

/** RBJ cookbook band-pass with 0 dB peak gain. */
export function bandpassCoeffs(sr: number, f: number, q = 1): BiquadCoeffs {
  const { cw, alpha } = rbj(sr, f, q)
  const a0 = 1 + alpha
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 }
}

function shelf(sr: number, f: number, gainDb: number, high: boolean): BiquadCoeffs {
  const A = Math.pow(10, gainDb / 40)
  const w = (TWO_PI * clamp(f, 1, sr * 0.49)) / sr
  const cw = Math.cos(w)
  const k = 2 * Math.sqrt(A) * (Math.sin(w) / 2) * Math.SQRT2 // shelf slope S = 1
  const s = high ? -1 : 1
  const a0 = A + 1 + s * (A - 1) * cw + k
  return {
    b0: (A * (A + 1 - s * (A - 1) * cw + k)) / a0,
    b1: (s * 2 * A * (A - 1 - s * (A + 1) * cw)) / a0,
    b2: (A * (A + 1 - s * (A - 1) * cw - k)) / a0,
    a1: (-s * 2 * (A - 1 + s * (A + 1) * cw)) / a0,
    a2: (A + 1 + s * (A - 1) * cw - k) / a0,
  }
}

/** RBJ cookbook low shelf (slope 1): `gainDb` below ~`f`. */
export function lowShelfCoeffs(sr: number, f: number, gainDb: number): BiquadCoeffs {
  return shelf(sr, f, gainDb, false)
}

/** RBJ cookbook high shelf (slope 1): `gainDb` above ~`f`. */
export function highShelfCoeffs(sr: number, f: number, gainDb: number): BiquadCoeffs {
  return shelf(sr, f, gainDb, true)
}

/** Runs a biquad (transposed direct form II) over x[from..to) in place, from zero state. */
export function biquadInPlace(x: Float32Array, c: BiquadCoeffs, from = 0, to = x.length): void {
  const { b0, b1, b2, a1, a2 } = c
  let z1 = 0
  let z2 = 0
  for (let i = from; i < to; i++) {
    const v = x[i]
    const y = b0 * v + z1
    z1 = b1 * v - a1 * y + z2
    z2 = b2 * v - a2 * y
    x[i] = y
  }
}

/**
 * Topology-preserving-transform state-variable filter (Zavalishin). Stable and
 * click-free under fast cutoff modulation, so it's used for sweeps.
 */
export class Svf {
  private ic1 = 0
  private ic2 = 0
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private k = 1

  set(sr: number, fc: number, q: number): void {
    const g = Math.tan((Math.PI * clamp(fc, 1, sr * 0.49)) / sr)
    this.k = 1 / q
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }

  /** Low-pass output. */
  lp(x: number): number {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v2
  }

  /** Band-pass output normalised to unity gain at the centre frequency. */
  bp(x: number): number {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return this.k * v1
  }
}
