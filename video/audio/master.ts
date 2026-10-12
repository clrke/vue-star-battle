/**
 * Master-bus processing: DC-block high-pass, true-peak-aware lookahead
 * limiter, safety clamp and end fade. Loudness normalisation itself lives in
 * ./synth (it iterates limiter + ./loudness).
 */
import { biquadInPlace, highShelfCoeffs, highpassCoeffs, lowShelfCoeffs } from './dsp'

/** DC-block / rumble high-pass on the master (Hz). */
export const MASTER_HPF_HZ = 25
/**
 * Master tone shaping for phone-speaker playback (most viewers): a little less
 * sub (which phones can't reproduce but which eats headroom) and a touch more air.
 */
export const MASTER_LOW_SHELF = { hz: 90, db: -3 }
export const MASTER_HIGH_SHELF = { hz: 5000, db: 2 }
/** Limiter lookahead (s): gain reaches its target exactly when the peak arrives. */
export const LIMITER_LOOKAHEAD = 0.005
/** Limiter release time constant (s). */
export const LIMITER_RELEASE = 0.08
/** Final hard clamp (should never engage after the limiter). */
export const SAFETY_CLAMP = 0.999
/** Fade-out at the very end of the render (s). */
export const END_FADE_SEC = 0.02

export function dcBlock(L: Float32Array, R: Float32Array, sr: number): void {
  const c = highpassCoeffs(sr, MASTER_HPF_HZ, Math.SQRT1_2)
  biquadInPlace(L, c)
  biquadInPlace(R, c)
}

/** Gentle master EQ: low shelf cut + high shelf lift (see MASTER_LOW_SHELF / MASTER_HIGH_SHELF). */
export function toneShape(L: Float32Array, R: Float32Array, sr: number): void {
  for (const c of [
    lowShelfCoeffs(sr, MASTER_LOW_SHELF.hz, MASTER_LOW_SHELF.db),
    highShelfCoeffs(sr, MASTER_HIGH_SHELF.hz, MASTER_HIGH_SHELF.db),
  ]) {
    biquadInPlace(L, c)
    biquadInPlace(R, c)
  }
}

// ------------------------------------------------------------------ true-peak detection

/** 4x oversampling interpolator: 3 fractional phases x 12-tap Blackman-windowed sinc. */
const TP_HALF = 6
const TP_TAPS = 2 * TP_HALF
const TP_PHASES = 3
const TP_KERNEL = buildKernel()

function buildKernel(): Float64Array {
  const k = new Float64Array(TP_PHASES * TP_TAPS)
  for (let p = 0; p < TP_PHASES; p++) {
    const frac = (p + 1) / (TP_PHASES + 1)
    let sum = 0
    for (let j = 0; j < TP_TAPS; j++) {
      const d = j - (TP_HALF - 1) - frac // tap sample offset minus interpolation point
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)
      const u = d / TP_HALF
      const w = Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u)
      k[p * TP_TAPS + j] = sinc * w
      sum += sinc * w
    }
    for (let j = 0; j < TP_TAPS; j++) k[p * TP_TAPS + j] /= sum
  }
  return k
}

/**
 * Per-sample peak envelope including inter-sample (true) peaks, max over both
 * channels, widened by one sample so each sample covers [i-1, i+1).
 *
 * Inter-sample values are only interpolated where a neighbouring sample
 * exceeds `floor / 2` (intersample overs of real signals stay well under
 * +6 dB), since quieter regions can never reach the limiter threshold. The
 * envelope is always >= the sample peak, so the sample-peak guarantee holds
 * unconditionally.
 */
export function peakEnvelope(L: Float32Array, R: Float32Array, floor = 0): Float32Array {
  const n = L.length
  const env = new Float32Array(n)
  const thr = floor / 2
  const k = TP_KERNEL
  // Phase 0.25 taps (phase 0.75 is its mirror image); phase 0.5 is symmetric.
  const a0 = k[0], a1 = k[1], a2 = k[2], a3 = k[3], a4 = k[4], a5 = k[5]
  const a6 = k[6], a7 = k[7], a8 = k[8], a9 = k[9], a10 = k[10], a11 = k[11]
  const b0 = k[12], b1 = k[13], b2 = k[14], b3 = k[15], b4 = k[16], b5 = k[17]
  const padded = new Float32Array(n + TP_TAPS)
  for (const ch of [L, R]) {
    padded.fill(0)
    padded.set(ch, TP_HALF - 1) // padded[i + j] = ch[i - 5 + j]
    for (let i = 0; i < n; i++) {
      const s0 = Math.abs(padded[i + 5])
      const s1 = Math.abs(padded[i + 6])
      let m = s0
      if (s0 > thr || s1 > thr) {
        const x0 = padded[i], x1 = padded[i + 1], x2 = padded[i + 2], x3 = padded[i + 3]
        const x4 = padded[i + 4], x5 = padded[i + 5], x6 = padded[i + 6], x7 = padded[i + 7]
        const x8 = padded[i + 8], x9 = padded[i + 9], x10 = padded[i + 10], x11 = padded[i + 11]
        const q =
          a0 * x0 + a1 * x1 + a2 * x2 + a3 * x3 + a4 * x4 + a5 * x5 +
          a6 * x6 + a7 * x7 + a8 * x8 + a9 * x9 + a10 * x10 + a11 * x11
        const h =
          b0 * (x0 + x11) + b1 * (x1 + x10) + b2 * (x2 + x9) +
          b3 * (x3 + x8) + b4 * (x4 + x7) + b5 * (x5 + x6)
        const t =
          a11 * x0 + a10 * x1 + a9 * x2 + a8 * x3 + a7 * x4 + a6 * x5 +
          a5 * x6 + a4 * x7 + a3 * x8 + a2 * x9 + a1 * x10 + a0 * x11
        const aq = Math.abs(q)
        const ah = Math.abs(h)
        const at = Math.abs(t)
        if (aq > m) m = aq
        if (ah > m) m = ah
        if (at > m) m = at
      }
      if (m > env[i]) env[i] = m
    }
  }
  for (let i = n - 1; i > 0; i--) if (env[i - 1] > env[i]) env[i] = env[i - 1]
  return env
}

// ------------------------------------------------------------------ limiter

export interface LimiterScratch {
  req: Float32Array
  gain: Float32Array
  dq: Int32Array
}

export function makeLimiterScratch(n: number): LimiterScratch {
  return { req: new Float32Array(n), gain: new Float32Array(n), dq: new Int32Array(Math.max(1, n)) }
}

/** dst[i] = min(src[i .. i+w-1]) (window clipped at the end). Monotonic deque, O(n). */
function slidingMinForward(src: Float32Array, w: number, dst: Float32Array, dq: Int32Array): void {
  const n = src.length
  let head = 0
  let tail = 0
  for (let j = n - 1; j >= 0; j--) {
    const v = src[j]
    while (tail > head && src[dq[tail - 1]] >= v) tail--
    dq[tail++] = j
    while (dq[head] > j + w - 1) head++
    dst[j] = src[dq[head]]
  }
}

/**
 * Lookahead peak limiter. out = src * preGain * g, where g is smooth and
 * guarantees |peak[i] * preGain * g[i]| <= ceiling for every sample:
 *   1. required gain r[i] = min(1, ceiling / (peak[i] * preGain))
 *   2. forward sliding min over the lookahead window
 *   3. instant attack / exponential release
 *   4. moving average over the lookahead window (linear attack ramp, no clicks)
 * Returns the maximum gain reduction in dB (>= 0).
 */
export function limitInto(
  srcL: Float32Array,
  srcR: Float32Array,
  peak: Float32Array,
  preGain: number,
  ceiling: number,
  sr: number,
  outL: Float32Array,
  outR: Float32Array,
  s: LimiterScratch,
): number {
  const n = srcL.length
  if (n === 0) return 0
  const w = Math.max(1, Math.round(LIMITER_LOOKAHEAD * sr))
  const { req, gain, dq } = s
  for (let i = 0; i < n; i++) {
    const p = peak[i] * preGain
    req[i] = p > ceiling ? ceiling / p : 1
  }
  slidingMinForward(req, w, gain, dq)
  const a = 1 - Math.exp(-1 / (LIMITER_RELEASE * sr))
  let cur = gain[0]
  for (let i = 0; i < n; i++) {
    const t = gain[i]
    cur = t < cur ? t : cur + (t - cur) * a
    gain[i] = cur
  }
  const g0 = gain[0]
  let sum = g0 * w
  let minG = 1
  for (let i = 0; i < n; i++) {
    sum += gain[i] - (i >= w ? gain[i - w] : g0)
    const g = sum / w
    if (g < minG) minG = g
    const k = g * preGain
    outL[i] = srcL[i] * k
    outR[i] = srcR[i] * k
  }
  return -20 * Math.log10(minG)
}

// ------------------------------------------------------------------ final touches

export function clampInPlace(L: Float32Array, R: Float32Array, lim = SAFETY_CLAMP): void {
  for (let i = 0; i < L.length; i++) {
    const v = L[i]
    if (v > lim) L[i] = lim
    else if (v < -lim) L[i] = -lim
  }
  for (let i = 0; i < R.length; i++) {
    const v = R[i]
    if (v > lim) R[i] = lim
    else if (v < -lim) R[i] = -lim
  }
}

/** Raised-cosine fade over the last `sec` seconds, reaching exactly 0 on the last sample. */
export function fadeOutEnd(L: Float32Array, R: Float32Array, sr: number, sec = END_FADE_SEC): void {
  const n = L.length
  const m = Math.min(n, Math.max(1, Math.round(sec * sr)))
  for (let i = 0; i < m; i++) {
    const g = 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / m))
    L[n - m + i] *= g
    R[n - m + i] *= g
  }
}
