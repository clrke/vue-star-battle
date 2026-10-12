/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement.
 *
 * K-weighting = high-shelf pre-filter + RLB high-pass (coefficients derived for
 * any sample rate from the libebur128 analog prototypes; identical to the
 * published 48 kHz tables). 400 ms blocks with 75 % overlap, absolute gate
 * -70 LUFS, relative gate -10 LU. Silence yields -Infinity (never NaN).
 */
import type { LoudnessReport, StereoBuffer } from './types'
import { gainToDb } from './dsp'

interface KWeighting {
  pb0: number
  pb1: number
  pb2: number
  pa1: number
  pa2: number
  ra1: number
  ra2: number
}

const kCache = new Map<number, KWeighting>()

function kWeighting(sr: number): KWeighting {
  const hit = kCache.get(sr)
  if (hit) return hit
  // Stage 1: high shelf (~+4 dB above ~1.7 kHz), models the head.
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sr)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  const pb0 = (Vh + (Vb * K) / Q + K * K) / a0
  const pb1 = (2 * (K * K - Vh)) / a0
  const pb2 = (Vh - (Vb * K) / Q + K * K) / a0
  const pa1 = (2 * (K * K - 1)) / a0
  const pa2 = (1 - K / Q + K * K) / a0
  // Stage 2: RLB high-pass (~38 Hz), numerator [1, -2, 1].
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sr)
  const d = 1 + K / Q + K * K
  const ra1 = (2 * (K * K - 1)) / d
  const ra2 = (1 - K / Q + K * K) / d
  const k = { pb0, pb1, pb2, pa1, pa2, ra1, ra2 }
  kCache.set(sr, k)
  return k
}

/**
 * K-weights `x[0..n)` and adds the sum of squares of each complete `hop`-sized
 * segment into `seg`. Returns the sum of squares over all n samples.
 */
function accumulateSegments(x: Float32Array, n: number, k: KWeighting, hop: number, seg: Float64Array): number {
  const { pb0, pb1, pb2, pa1, pa2, ra1, ra2 } = k
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let z1 = 0
  let z2 = 0
  let total = 0
  let acc = 0
  let count = 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const v = x[i]
    const y = pb0 * v + pb1 * x1 + pb2 * x2 - pa1 * y1 - pa2 * y2
    const z = y - 2 * y1 + y2 - ra1 * z1 - ra2 * z2
    x2 = x1
    x1 = v
    y2 = y1
    y1 = y
    z2 = z1
    z1 = z
    acc += z * z
    if (++count === hop) {
      if (s < seg.length) seg[s] += acc
      total += acc
      s++
      acc = 0
      count = 0
    }
  }
  return total + acc
}

/**
 * Per-block mean-square energies (channels summed, G = 1 for L/R) of the
 * 400 ms / 75 %-overlap gating blocks. Inputs shorter than one block are
 * measured as a single block over their whole length.
 */
export function blockEnergies(left: Float32Array, right: Float32Array, sr: number): Float64Array {
  const n = Math.min(left.length, right.length)
  if (n === 0) return new Float64Array(0)
  const k = kWeighting(sr)
  const hop = Math.max(1, Math.round(0.1 * sr))
  const blockLen = 4 * hop
  const nSeg = Math.floor(n / hop)
  const seg = new Float64Array(nSeg)
  const total = accumulateSegments(left, n, k, hop, seg) + accumulateSegments(right, n, k, hop, seg)
  if (n < blockLen) return Float64Array.of(total / n)
  const nb = nSeg - 3
  const out = new Float64Array(nb)
  for (let j = 0; j < nb; j++) out[j] = (seg[j] + seg[j + 1] + seg[j + 2] + seg[j + 3]) / blockLen
  return out
}

function energyToLufs(e: number): number {
  return e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity
}

/** Momentary loudness (LUFS) of each 400 ms block, hop 100 ms. */
export function momentaryLoudness(left: Float32Array, right: Float32Array, sr: number): Float64Array {
  const e = blockEnergies(left, right, sr)
  const out = new Float64Array(e.length)
  for (let i = 0; i < e.length; i++) out[i] = energyToLufs(e[i])
  return out
}

/** Gated integrated loudness in LUFS (BS.1770-4). -Infinity if every block is gated out. */
export function integratedLoudness(left: Float32Array, right: Float32Array, sr: number): number {
  const e = blockEnergies(left, right, sr)
  const absGate = Math.pow(10, (-70 + 0.691) / 10)
  let sum = 0
  let cnt = 0
  for (let i = 0; i < e.length; i++) {
    if (e[i] > absGate) {
      sum += e[i]
      cnt++
    }
  }
  if (cnt === 0) return -Infinity
  const relGate = (sum / cnt) * Math.pow(10, -10 / 10)
  let sum2 = 0
  let cnt2 = 0
  for (let i = 0; i < e.length; i++) {
    if (e[i] > absGate && e[i] > relGate) {
      sum2 += e[i]
      cnt2++
    }
  }
  return cnt2 === 0 ? -Infinity : energyToLufs(sum2 / cnt2)
}

/** Largest absolute sample value over both channels. */
export function samplePeak(left: Float32Array, right: Float32Array): number {
  let pk = 0
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i])
    if (a > pk) pk = a
  }
  for (let i = 0; i < right.length; i++) {
    const a = Math.abs(right[i])
    if (a > pk) pk = a
  }
  return pk
}

/** Integrated loudness (LUFS) and sample peak (dBFS) of a stereo buffer. */
export function measureLoudness(buf: StereoBuffer): LoudnessReport {
  return {
    integratedLufs: integratedLoudness(buf.left, buf.right, buf.sampleRate),
    peakDb: gainToDb(samplePeak(buf.left, buf.right)),
  }
}
