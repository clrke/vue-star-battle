/**
 * Freeverb (Jezar at Dreampoint, public domain) stereo reverb: 8 low-pass
 * feedback combs + 4 Schroeder allpasses per channel, standard tunings scaled
 * from 44.1 kHz to the render rate, right channel offset by the stereo spread.
 *
 * The send bus is mono; it is high-passed (and gently low-passed) before the
 * reverb so the tail never muddies the low end or splashes in the top octave.
 */
import { biquadInPlace, highpassCoeffs, lowpassCoeffs } from './dsp'

// ------------------------------------------------------------------ tweakables
/** Freeverb "room size" control (0..1). 0.82 -> comb feedback 0.93 (~2.5 s RT60). */
export const REVERB_ROOM_SIZE = 0.82
/** Freeverb "damping" control (0..1): higher = darker tail. */
export const REVERB_DAMPING = 0.35
/** Stereo width (0 = mono wet, 1 = full Freeverb decorrelation). */
export const REVERB_WIDTH = 1
/** High-pass on the reverb input (Hz). */
export const REVERB_INPUT_HPF_HZ = 200
/** Low-pass on the reverb input (Hz). */
export const REVERB_INPUT_LPF_HZ = 9000
/** Gain of the wet return into the master bus. */
export const REVERB_RETURN_GAIN = 0.3

// ------------------------------------------------------------------ Freeverb constants
const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_TUNING = [556, 441, 341, 225]
const STEREO_SPREAD = 23
const ALLPASS_FEEDBACK = 0.5
const FIXED_GAIN = 0.015
const SCALE_ROOM = 0.28
const OFFSET_ROOM = 0.7
const SCALE_DAMP = 0.4

/**
 * Runs the mono `send` bus through the reverb and ADDS the wet result
 * (times `returnGain`) to outL/outR. `send` is filtered in place.
 */
export function addReverb(
  send: Float32Array,
  sr: number,
  outL: Float32Array,
  outR: Float32Array,
  returnGain = REVERB_RETURN_GAIN,
): void {
  const n = Math.min(send.length, outL.length, outR.length)
  let any = false
  for (let i = 0; i < n; i++) {
    if (send[i] !== 0) {
      any = true
      break
    }
  }
  if (!any || returnGain === 0) return

  biquadInPlace(send, highpassCoeffs(sr, REVERB_INPUT_HPF_HZ), 0, n)
  biquadInPlace(send, lowpassCoeffs(sr, REVERB_INPUT_LPF_HZ), 0, n)

  const scale = sr / 44100
  const feedback = REVERB_ROOM_SIZE * SCALE_ROOM + OFFSET_ROOM
  const damp1 = REVERB_DAMPING * SCALE_DAMP
  // Freeverb feeds (inL + inR) * FIXED_GAIN into the tank; our send is the mono sum.
  const inGain = FIXED_GAIN * 2
  const wetL = new Float32Array(n)
  const wetR = new Float32Array(n)
  runTank(send, n, inGain, 0, scale, feedback, damp1, wetL)
  runTank(send, n, inGain, STEREO_SPREAD, scale, feedback, damp1, wetR)

  const wet1 = (REVERB_WIDTH / 2 + 0.5) * returnGain
  const wet2 = ((1 - REVERB_WIDTH) / 2) * returnGain
  for (let i = 0; i < n; i++) {
    const l = wetL[i]
    const r = wetR[i]
    outL[i] += l * wet1 + r * wet2
    outR[i] += r * wet1 + l * wet2
  }
}

/** One channel of the Freeverb tank: parallel combs then series allpasses. */
function runTank(
  input: Float32Array,
  n: number,
  inGain: number,
  spread: number,
  scale: number,
  feedback: number,
  damp1: number,
  out: Float32Array,
): void {
  const damp2 = 1 - damp1
  for (const tuning of COMB_TUNING) {
    const size = Math.max(1, Math.round((tuning + spread) * scale))
    const buf = new Float64Array(size)
    let idx = 0
    let store = 0
    for (let i = 0; i < n; i++) {
      const y = buf[idx]
      store = y * damp2 + store * damp1
      buf[idx] = input[i] * inGain + store * feedback
      if (++idx >= size) idx = 0
      out[i] += y
    }
  }
  for (const tuning of ALLPASS_TUNING) {
    const size = Math.max(1, Math.round((tuning + spread) * scale))
    const buf = new Float64Array(size)
    let idx = 0
    for (let i = 0; i < n; i++) {
      const bufout = buf[idx]
      const x = out[i]
      out[i] = bufout - x
      buf[idx] = x + bufout * ALLPASS_FEEDBACK
      if (++idx >= size) idx = 0
    }
  }
}
