/**
 * Instrument recipes. Each renderer returns a self-contained one-shot buffer
 * that starts at exactly 0 (>= 1 ms smooth attack) and ends at exactly 0
 * (rendered until the slowest component is ~-60 dB, then a short cosine fade),
 * so voices can be summed anywhere without clicks.
 *
 * Levels here are "unit" levels (peaks roughly 1); the mix table in ./synth
 * sets how loud each kind sits in the mix.
 *
 * Decay naming: `tau` is always an exponential time constant (amplitude falls
 * to 1/e, -8.7 dB). The brief's "decay" figures are interpreted as the audible
 * length of a sound, so for the rapid lead sounds tau is chosen shorter than the
 * nominal decay (see PLACE / RECORD) to keep 16 notes/sec articulate.
 */
import {
  TWO_PI,
  bandpassCoeffs,
  biquadInPlace,
  clamp,
  fadeOutTail,
  hfComp,
  highpassCoeffs,
  lowpassCoeffs,
  midiToFreq,
  panGains,
  polyBlep,
  ramp,
  samplesFor,
  Svf,
  type BiquadCoeffs,
  type Rng,
} from './dsp'

export interface Voice {
  /** Left channel, or the only channel of a mono voice. */
  l: Float32Array
  /** Right channel; `null` for mono voices (panned at mix time). */
  r: Float32Array | null
}

/** Minimum attack applied to every voice onset (s). */
export const MIN_ATTACK = 0.001
/** Cosine fade applied to the very end of every voice buffer (s). */
const END_FADE = 0.005
/** Voices are rendered until their slowest component falls below this (-60 dB). */
const SILENT = 1e-3

/** Partials above this are dropped (no aliasing, no ear-piercing content). */
export function aliasGuardHz(sr: number): number {
  return Math.min(16000, 0.45 * sr)
}

/** Partials above this are rolled off at -6 dB/oct so high notes stay glassy, not shrill. */
const PARTIAL_ROLLOFF_HZ = 8000

function silentVoice(): Voice {
  return { l: new Float32Array(1), r: null }
}

function finishMono(out: Float32Array, sr: number): Voice {
  fadeOutTail(out, samplesFor(sr, END_FADE))
  return { l: out, r: null }
}

function finishStereo(l: Float32Array, r: Float32Array, sr: number): Voice {
  const n = samplesFor(sr, END_FADE)
  fadeOutTail(l, n)
  fadeOutTail(r, n)
  return { l, r }
}

/**
 * Adds amp * attackRamp(t) * exp(-t/tau) * sin(2 pi f t) starting at `offset`.
 * Uses a damped recursive oscillator (exact up to rounding, ~3 ns/sample).
 */
function addPartial(
  out: Float32Array,
  sr: number,
  freq: number,
  amp: number,
  tau: number,
  attack = MIN_ATTACK,
  offset = 0,
): void {
  if (!(freq > 0) || freq > aliasGuardHz(sr) || amp === 0 || !(tau > 0)) return
  if (freq > PARTIAL_ROLLOFF_HZ) amp *= PARTIAL_ROLLOFF_HZ / freq
  const w = (TWO_PI * freq) / sr
  const r = Math.exp(-1 / (tau * sr))
  const c = 2 * r * Math.cos(w)
  const r2 = r * r
  const na = Math.max(1, Math.round(attack * sr))
  const stop = Math.abs(amp) * 1e-6
  let ym1 = (-amp * Math.sin(w)) / r // y[-1]
  let y0 = 0 // y[0]
  let env = Math.abs(amp)
  for (let i = offset, j = 0; i < out.length; i++, j++) {
    out[i] += j < na ? y0 * ramp(j / na) : y0
    const yn = c * y0 - r2 * ym1
    ym1 = y0
    y0 = yn
    env *= r
    if (env < stop) break
  }
}

/**
 * Adds a white-noise burst with envelope ramp(attack) * exp(-t/tau), run
 * through `filters`, peak-normalised to `amp`, starting at `offset`.
 */
function addNoise(
  out: Float32Array,
  sr: number,
  rng: Rng,
  attack: number,
  tau: number,
  amp: number,
  filters: BiquadCoeffs[],
  offset = 0,
): void {
  const room = out.length - offset
  if (room <= 0 || amp === 0) return
  const na = Math.max(1, Math.round(attack * sr))
  const n = Math.min(room, samplesFor(sr, attack + tau * 11.5)) // to -100 dB
  const tmp = new Float32Array(n)
  const dec = Math.exp(-1 / (tau * sr))
  let env = 1
  for (let i = 0; i < n; i++) {
    let e: number
    if (i < na) {
      e = ramp(i / na)
    } else {
      e = env
      env *= dec
    }
    tmp[i] = (rng() * 2 - 1) * e
  }
  for (const c of filters) biquadInPlace(tmp, c)
  let pk = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(tmp[i])
    if (a > pk) pk = a
  }
  if (pk === 0) return
  const g = amp / pk
  for (let i = 0; i < n; i++) out[offset + i] += tmp[i] * g
}

/** y = tanh(drive x) / tanh(drive): gentle saturation with unity gain at full scale. */
function saturate(buf: Float32Array, drive: number): void {
  const k = 1 / Math.tanh(drive)
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(drive * buf[i]) * k
}

// =================================================================== place

/** Marimba-bar mallet pluck. The lead sound; must stay articulate at 16 notes/s. */
export const PLACE = {
  /** Audible length (~ -20 dB point) at <= 220 Hz and at >= 1760 Hz (s). */
  decayLow: 0.45,
  decayHigh: 0.25,
  /** The fundamental has a fast "strike" stage and a softer ringing tail. */
  fastAmp: 0.62,
  fastTau: 0.09, // x decay
  slowTau: 0.55, // x decay
  /** Marimba bar overtones: [ratio, amp, nominal decay s] (tau = decay * partialTau). */
  partials: [
    [3.93, 0.2, 0.08],
    [9.2, 0.06, 0.025],
  ] as const,
  partialTau: 0.55,
  /** 2 ms band-passed mallet click. */
  clickAmp: 0.2,
  clickHz: 3200,
  clickQ: 1.6,
  clickLp: 7000,
}

export function renderPlace(sr: number, pitch: number, rng: Rng): Voice {
  const f = midiToFreq(pitch)
  if (f > aliasGuardHz(sr)) return silentVoice()
  const comp = hfComp(f)
  const x = clamp(Math.log2(f / 220) / 3, 0, 1)
  const decay = PLACE.decayLow + (PLACE.decayHigh - PLACE.decayLow) * x
  const tauFast = decay * PLACE.fastTau
  const tauSlow = decay * PLACE.slowTau
  const slowAmp = 1 - PLACE.fastAmp
  const out = new Float32Array(samplesFor(sr, tauSlow * Math.log(slowAmp / SILENT) + END_FADE))
  addPartial(out, sr, f, PLACE.fastAmp * comp, tauFast)
  addPartial(out, sr, f, slowAmp * comp, tauSlow)
  const scale = decay / PLACE.decayLow
  for (const [ratio, amp, d] of PLACE.partials) {
    addPartial(out, sr, f * ratio, amp * comp, d * PLACE.partialTau * scale)
  }
  addNoise(out, sr, rng, MIN_ATTACK, 0.0004, PLACE.clickAmp * comp, [
    bandpassCoeffs(sr, PLACE.clickHz, PLACE.clickQ),
    lowpassCoeffs(sr, PLACE.clickLp),
  ])
  return finishMono(out, sr)
}

// =================================================================== record

/** Glockenspiel / celesta sparkle for a new search record. */
export const RECORD = {
  ratios: [1, 2.756, 5.404, 8.933],
  amps: [1, 0.45, 0.22, 0.1],
  decays: [1.6, 0.7, 0.35, 0.18],
  /** tau = decay * tauScale. */
  tauScale: 0.45,
  /** Two sines an octave up, +-2.5 cents apart: slow beating shimmer. */
  shimmerAmp: 0.09,
  shimmerCents: 2.5,
  shimmerTau: 0.9,
  /** Tiny metallic "tink" of the mallet. */
  tinkAmp: 0.07,
}

export function renderRecord(sr: number, pitch: number, rng: Rng): Voice {
  const f = midiToFreq(pitch)
  if (f > aliasGuardHz(sr)) return silentVoice()
  const comp = hfComp(f)
  let longest = RECORD.shimmerTau * Math.log(RECORD.shimmerAmp / SILENT)
  for (let k = 0; k < RECORD.ratios.length; k++) {
    longest = Math.max(longest, RECORD.decays[k] * RECORD.tauScale * Math.log(RECORD.amps[k] / SILENT))
  }
  const out = new Float32Array(samplesFor(sr, longest + END_FADE))
  for (let k = 0; k < RECORD.ratios.length; k++) {
    addPartial(out, sr, f * RECORD.ratios[k], RECORD.amps[k] * comp, RECORD.decays[k] * RECORD.tauScale)
  }
  const det = Math.pow(2, RECORD.shimmerCents / 1200)
  addPartial(out, sr, 2 * f * det, RECORD.shimmerAmp * comp, RECORD.shimmerTau, 0.02)
  addPartial(out, sr, (2 * f) / det, RECORD.shimmerAmp * comp, RECORD.shimmerTau, 0.02)
  addNoise(out, sr, rng, MIN_ATTACK, 0.0005, RECORD.tinkAmp * comp, [
    highpassCoeffs(sr, 5000),
    lowpassCoeffs(sr, 11000),
  ])
  return finishMono(out, sr)
}

// =================================================================== remove

/** Soft descending "bloop" for a backtrack. */
export const REMOVE = { semis: 7, glide: 0.09, tau: 0.06, h2: 0.15, attack: 0.002 }

export function renderRemove(sr: number, pitch: number): Voice {
  const f0 = midiToFreq(pitch)
  if (f0 > aliasGuardHz(sr)) return silentVoice()
  const comp = hfComp(f0)
  const out = new Float32Array(samplesFor(sr, REMOVE.tau * Math.log(1 / SILENT) + END_FADE))
  const h2 = 2 * f0 <= aliasGuardHz(sr) ? REMOVE.h2 : 0
  const na = samplesFor(sr, REMOVE.attack)
  const dec = Math.exp(-1 / (REMOVE.tau * sr))
  let ph = 0
  let env = comp
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    const x = t < REMOVE.glide ? t / REMOVE.glide : 1
    const shape = 1 - (1 - x) * (1 - x) // ease-out glide
    const f = f0 * Math.pow(2, (-REMOVE.semis * shape) / 12)
    const a = i < na ? env * ramp(i / na) : env
    out[i] = a * (Math.sin(ph) + h2 * Math.sin(2 * ph))
    ph += (TWO_PI * f) / sr
    env *= dec
  }
  return finishMono(out, sr)
}

// =================================================================== conflict

/** Gentle muted low "bonk" for a dead end. Never harsh. */
export const CONFLICT = {
  fStart: 180,
  fEnd: 70,
  pitchTau: 0.04,
  tau: 0.065,
  /** 2nd harmonic keeps it audible on phone speakers. */
  h2: 0.35,
  thumpAmp: 0.4,
  thumpLp: 280,
  drive: 1.3,
  lp: 1500,
}

export function renderConflict(sr: number, rng: Rng): Voice {
  const out = new Float32Array(samplesFor(sr, 0.5))
  const na = samplesFor(sr, 0.0015)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    const f = CONFLICT.fEnd + (CONFLICT.fStart - CONFLICT.fEnd) * Math.exp(-t / CONFLICT.pitchTau)
    let env = Math.exp(-t / CONFLICT.tau)
    if (i < na) env *= ramp(i / na)
    out[i] = env * (Math.sin(ph) + CONFLICT.h2 * Math.exp(-t / 0.05) * Math.sin(2 * ph))
    ph += (TWO_PI * f) / sr
  }
  const lp = lowpassCoeffs(sr, CONFLICT.thumpLp)
  addNoise(out, sr, rng, 0.0015, 0.012, CONFLICT.thumpAmp, [lp, lp])
  saturate(out, CONFLICT.drive)
  biquadInPlace(out, lowpassCoeffs(sr, CONFLICT.lp))
  return finishMono(out, sr)
}

// =================================================================== drums

/** 808-ish kick: pitch-swept sine + 2 ms click + light tanh saturation. */
export const KICK = { fStart: 110, fEnd: 42, pitchTau: 0.04, hold: 0.008, tau: 0.13, clickAmp: 0.25, drive: 1.6 }

export function renderKick(sr: number, rng: Rng): Voice {
  const out = new Float32Array(samplesFor(sr, KICK.hold + KICK.tau * Math.log(1 / SILENT) + END_FADE))
  const na = samplesFor(sr, MIN_ATTACK)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    const f = KICK.fEnd + (KICK.fStart - KICK.fEnd) * Math.exp(-t / KICK.pitchTau)
    let env = t < KICK.hold ? 1 : Math.exp(-(t - KICK.hold) / KICK.tau)
    if (i < na) env *= ramp(i / na)
    out[i] = env * Math.sin(ph)
    ph += (TWO_PI * f) / sr
  }
  addNoise(out, sr, rng, MIN_ATTACK, 0.0005, KICK.clickAmp, [lowpassCoeffs(sr, 5000)])
  saturate(out, KICK.drive)
  return finishMono(out, sr)
}

/** Soft lo-fi snare: band-passed noise + 185 Hz body. */
export const SNARE = {
  noiseTau: 0.045,
  noiseAmp: 0.75,
  hp: 1800,
  lp: 6000,
  bodyStart: 230,
  bodyHz: 185,
  bodyTau: 0.03,
  bodyAmp: 0.55,
  mode2Hz: 330,
  mode2Amp: 0.15,
  mode2Tau: 0.02,
  drive: 1.2,
  softLp: 7500,
}

export function renderSnare(sr: number, rng: Rng): Voice {
  const out = new Float32Array(samplesFor(sr, 0.4))
  addNoise(out, sr, rng, MIN_ATTACK, SNARE.noiseTau, SNARE.noiseAmp, [
    highpassCoeffs(sr, SNARE.hp),
    lowpassCoeffs(sr, SNARE.lp),
  ])
  const na = samplesFor(sr, MIN_ATTACK)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    const f = SNARE.bodyHz + (SNARE.bodyStart - SNARE.bodyHz) * Math.exp(-t / 0.008)
    let env = SNARE.bodyAmp * Math.exp(-t / SNARE.bodyTau)
    if (i < na) env *= ramp(i / na)
    out[i] += env * Math.sin(ph)
    ph += (TWO_PI * f) / sr
  }
  addPartial(out, sr, SNARE.mode2Hz, SNARE.mode2Amp, SNARE.mode2Tau)
  saturate(out, SNARE.drive)
  biquadInPlace(out, lowpassCoeffs(sr, SNARE.softLp))
  return finishMono(out, sr)
}

/** Clap: three noise bursts ~10 ms apart plus a short tail, band-passed at 1.2 kHz. */
export const CLAP = {
  bursts: [0, 0.0105, 0.021],
  burstAmps: [1, 0.85, 0.75],
  burstTau: 0.0035,
  tailStart: 0.021,
  tailAmp: 0.65,
  tailTau: 0.04,
  bp: 1200,
  q: 1.1,
  softLp: 6000,
}

export function renderClap(sr: number, rng: Rng): Voice {
  const out = new Float32Array(samplesFor(sr, 0.35))
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    let e = 0
    for (let b = 0; b < CLAP.bursts.length; b++) {
      const dt = t - CLAP.bursts[b]
      if (dt >= 0) e += CLAP.burstAmps[b] * ramp(dt / MIN_ATTACK) * Math.exp(-dt / CLAP.burstTau)
    }
    const dt = t - CLAP.tailStart
    if (dt >= 0) e += CLAP.tailAmp * ramp(dt / 0.002) * Math.exp(-dt / CLAP.tailTau)
    out[i] = (rng() * 2 - 1) * e
  }
  biquadInPlace(out, bandpassCoeffs(sr, CLAP.bp, CLAP.q))
  biquadInPlace(out, highpassCoeffs(sr, 500))
  biquadInPlace(out, lowpassCoeffs(sr, CLAP.softLp))
  let pk = 0
  for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]))
  if (pk > 0) for (let i = 0; i < out.length; i++) out[i] /= pk
  return finishMono(out, sr)
}

/** Hats: high-passed noise (> 7 kHz), short (closed) or longer (open) decay. */
export const HAT = { closedTau: 0.013, openTau: 0.07, hp: 6500, lp: 10000 }

export function renderHat(sr: number, rng: Rng, open: boolean): Voice {
  const tau = open ? HAT.openTau : HAT.closedTau
  const out = new Float32Array(samplesFor(sr, MIN_ATTACK + tau * Math.log(1 / SILENT) + END_FADE))
  const hp = highpassCoeffs(sr, HAT.hp)
  const lp = lowpassCoeffs(sr, HAT.lp)
  addNoise(out, sr, rng, MIN_ATTACK, tau, 1, [hp, hp, lp, lp])
  return finishMono(out, sr)
}

// =================================================================== pad

/** Warm detuned-saw chord pad. */
export const PAD = {
  detuneCents: 6,
  spread: 0.4,
  sawAmp: 0.5,
  subAmp: 0.3,
  attack: 0.25,
  release: 0.8,
  cutoff: 1400,
  lfoDepth: 200,
  lfoRate: 0.11,
  q: 0.7,
}

export function renderPad(sr: number, notes: readonly number[], dur: number, rng: Rng): Voice {
  const n = samplesFor(sr, dur + PAD.release + END_FADE)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const [aL, aR] = panGains(-PAD.spread)
  const [bL, bR] = panGains(PAD.spread)
  const c = Math.SQRT1_2
  const det = Math.pow(2, PAD.detuneCents / 1200)
  let voices = 0
  for (const m of notes) {
    const f = midiToFreq(m)
    if (!(f > 0) || f * det > 0.45 * sr) continue
    voices++
    const dt1 = f / det / sr
    const dt2 = (f * det) / sr
    let p1 = rng()
    let p2 = rng()
    // Sub sine one octave down: recursive oscillator, random start phase.
    const ws = (TWO_PI * f * 0.5) / sr
    const cs = 2 * Math.cos(ws)
    const ph = rng() * TWO_PI
    let sm1 = PAD.subAmp * Math.sin(ph - ws)
    let s0 = PAD.subAmp * Math.sin(ph)
    for (let i = 0; i < n; i++) {
      const saw1 = 2 * p1 - 1 - polyBlep(p1, dt1)
      const saw2 = 2 * p2 - 1 - polyBlep(p2, dt2)
      p1 += dt1
      if (p1 >= 1) p1 -= 1
      p2 += dt2
      if (p2 >= 1) p2 -= 1
      const sub = s0
      const sn = cs * s0 - sm1
      sm1 = s0
      s0 = sn
      L[i] += (saw1 * aL + saw2 * bL) * PAD.sawAmp + sub * c
      R[i] += (saw1 * aR + saw2 * bR) * PAD.sawAmp + sub * c
    }
  }
  if (voices === 0) return silentVoice()
  const norm = 1 / Math.sqrt(voices)
  const fl = new Svf()
  const fr = new Svf()
  const lfoPhase = rng() * TWO_PI
  const lvlAtRelease = dur >= PAD.attack ? 1 : ramp(dur / PAD.attack)
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) {
      const fc = PAD.cutoff + PAD.lfoDepth * Math.sin(lfoPhase + (TWO_PI * PAD.lfoRate * i) / sr)
      fl.set(sr, fc, PAD.q)
      fr.set(sr, fc, PAD.q)
    }
    const t = i / sr
    let env: number
    if (t < dur) env = t < PAD.attack ? ramp(t / PAD.attack) : 1
    else if (t < dur + PAD.release) env = lvlAtRelease * 0.5 * (1 + Math.cos((Math.PI * (t - dur)) / PAD.release))
    else env = 0
    const g = env * norm
    L[i] = fl.lp(L[i]) * g
    R[i] = fr.lp(R[i]) * g
  }
  return finishStereo(L, R, sr)
}

// =================================================================== bass

/** Round bass: sine + soft 2nd/3rd harmonics, low-passed. */
export const BASS = { attack: 0.005, release: 0.08, h2: 0.25, h3: 0.1, lp: 600, sustainTau: 4 }

export function renderBass(sr: number, pitch: number, dur: number): Voice {
  const f = midiToFreq(pitch)
  if (!(f > 0) || f > 0.45 * sr) return silentVoice()
  const n = samplesFor(sr, dur + BASS.release + 0.01)
  const out = new Float32Array(n)
  const guard = aliasGuardHz(sr)
  const h2 = 2 * f < guard ? BASS.h2 : 0
  const h3 = 3 * f < guard ? BASS.h3 : 0
  const w = (TWO_PI * f) / sr
  const lvlAtRelease = (dur >= BASS.attack ? 1 : ramp(dur / BASS.attack)) * Math.exp(-dur / BASS.sustainTau)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let env: number
    if (t < dur) env = (t < BASS.attack ? ramp(t / BASS.attack) : 1) * Math.exp(-t / BASS.sustainTau)
    else if (t < dur + BASS.release) env = lvlAtRelease * 0.5 * (1 + Math.cos((Math.PI * (t - dur)) / BASS.release))
    else env = 0
    if (env === 0) continue
    const s = Math.sin(w * i)
    const co = Math.cos(w * i)
    out[i] = env * (s + h2 * 2 * s * co + h3 * s * (3 - 4 * s * s))
  }
  biquadInPlace(out, lowpassCoeffs(sr, BASS.lp))
  return finishMono(out, sr)
}

// =================================================================== riser

/** Tension riser: resonant band-passed noise sweeping up + rising sine, x^2 swell. */
export const RISER = {
  fLow: 300,
  fHigh: 7000,
  q: 4,
  noiseAmp: 2.2,
  toneLow: 220,
  toneHigh: 880,
  toneAmp: 0.22,
  power: 2,
  fade: 0.015,
}

export function renderRiser(sr: number, dur: number, rng: Rng): Voice {
  const nRise = Math.max(1, Math.round(dur * sr))
  const nFade = samplesFor(sr, RISER.fade)
  const n = nRise + nFade + 1
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const fl = new Svf()
  const fr = new Svf()
  const fRatio = RISER.fHigh / RISER.fLow
  const tRatio = RISER.toneHigh / RISER.toneLow
  let ph = 0
  for (let i = 0; i < n; i++) {
    const x = Math.min(1, i / nRise)
    if ((i & 7) === 0) {
      const fc = RISER.fLow * Math.pow(fRatio, x)
      fl.set(sr, fc, RISER.q)
      fr.set(sr, fc, RISER.q)
    }
    let amp = Math.pow(x, RISER.power)
    if (i > nRise) {
      const y = (i - nRise) / nFade
      amp = y >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * y))
    }
    const nl = fl.bp(rng() * 2 - 1)
    const nr = fr.bp(rng() * 2 - 1)
    const tone = Math.sin(ph) * RISER.toneAmp * Math.SQRT1_2
    ph += (TWO_PI * RISER.toneLow * Math.pow(tRatio, x)) / sr
    L[i] = (nl * RISER.noiseAmp + tone) * amp
    R[i] = (nr * RISER.noiseAmp + tone) * amp
  }
  return finishStereo(L, R, sr)
}

// =================================================================== impact

/** The solve payoff: sub boom + punch + crash cymbal + broadband transient. */
export const IMPACT = {
  length: 3.4,
  subStart: 90,
  subEnd: 50,
  subPitchTau: 0.08,
  subTau: 0.4,
  subDrive: 1.5,
  subAmp: 1,
  punchStart: 170,
  punchEnd: 90,
  punchTau: 0.09,
  punchAmp: 0.35,
  /** Low-passed noise "body" so the hit reads on phone speakers (no sub there). */
  bodyAmp: 0.3,
  bodyTau: 0.07,
  bodyLp: 1400,
  transientAmp: 0.55,
  transientLp: 9000,
  crashTau: 0.4,
  crashAmp: 0.3,
  crashHp: 5000,
  crashLp: 12000,
  /** Metallic ring partials: [Hz, amp, tau]. */
  ring: [
    [3150, 0.05, 0.6],
    [3870, 0.04, 0.5],
    [4720, 0.045, 0.7],
    [5530, 0.035, 0.45],
    [6410, 0.03, 0.55],
    [7380, 0.025, 0.4],
  ] as const,
}

export function renderImpact(sr: number, rng: Rng): Voice {
  const n = samplesFor(sr, IMPACT.length)
  const mono = new Float32Array(n)
  const na = samplesFor(sr, 0.0015)
  const kSub = 1 / Math.tanh(IMPACT.subDrive)
  let phSub = 0
  let phPunch = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const a = i < na ? ramp(i / na) : 1
    const fSub = IMPACT.subEnd + (IMPACT.subStart - IMPACT.subEnd) * Math.exp(-t / IMPACT.subPitchTau)
    const sub = Math.tanh(IMPACT.subDrive * Math.sin(phSub) * Math.exp(-t / IMPACT.subTau)) * kSub
    const fP = IMPACT.punchEnd + (IMPACT.punchStart - IMPACT.punchEnd) * Math.exp(-t / 0.03)
    const punch = Math.sin(phPunch) * Math.exp(-t / IMPACT.punchTau)
    mono[i] = a * (IMPACT.subAmp * sub + IMPACT.punchAmp * punch)
    phSub += (TWO_PI * fSub) / sr
    phPunch += (TWO_PI * fP) / sr
  }
  addNoise(mono, sr, rng, MIN_ATTACK, 0.0015, IMPACT.transientAmp, [lowpassCoeffs(sr, IMPACT.transientLp)])
  const bodyLp = lowpassCoeffs(sr, IMPACT.bodyLp)
  addNoise(mono, sr, rng, 0.002, IMPACT.bodyTau, IMPACT.bodyAmp, [bodyLp, bodyLp, highpassCoeffs(sr, 120)])
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const hp = highpassCoeffs(sr, IMPACT.crashHp)
  const lp = lowpassCoeffs(sr, IMPACT.crashLp)
  addNoise(L, sr, rng, 0.002, IMPACT.crashTau, IMPACT.crashAmp, [hp, hp, lp])
  addNoise(R, sr, rng, 0.002, IMPACT.crashTau, IMPACT.crashAmp, [hp, hp, lp])
  for (const [hz, amp, tau] of IMPACT.ring) {
    addPartial(L, sr, hz * 0.998, amp, tau, 0.002)
    addPartial(R, sr, hz * 1.002, amp, tau, 0.002)
  }
  const c = Math.SQRT1_2
  for (let i = 0; i < n; i++) {
    L[i] += mono[i] * c
    R[i] += mono[i] * c
  }
  return finishStereo(L, R, sr)
}

// =================================================================== chime

/** Bright FM bell for the post-solve verification sweep. */
export const CHIME = { ratio: 3.5, index: 2.5, indexTime: 0.3, tau: 0.38, nominalAmp: 0.12, nominalTau: 0.25 }

export function renderChime(sr: number, pitch: number): Voice {
  const f = midiToFreq(pitch)
  const guard = aliasGuardHz(sr)
  if (!(f > 0) || f > guard) return silentVoice()
  const comp = hfComp(f)
  // FM sidebands sit at f + k * ratio * f with weight J_k(I); beyond k = I + 2 they are
  // below -40 dB. Keep that sideband under the guard so nothing folds past Nyquist.
  const iMax = Math.max(0, (guard / f - 1) / CHIME.ratio - 2)
  const i0 = Math.min(CHIME.index, iMax)
  const out = new Float32Array(samplesFor(sr, CHIME.tau * Math.log(1 / SILENT) + END_FADE))
  const wc = (TWO_PI * f) / sr
  const wm = wc * CHIME.ratio
  const na = samplesFor(sr, MIN_ATTACK)
  const dec = Math.exp(-1 / (CHIME.tau * sr))
  let env = comp
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    const u = t < CHIME.indexTime ? 1 - t / CHIME.indexTime : 0
    const index = i0 * u * u
    const a = i < na ? env * ramp(i / na) : env
    out[i] = a * Math.sin(wc * i + index * Math.sin(wm * i))
    env *= dec
  }
  addPartial(out, sr, 2 * f, CHIME.nominalAmp * comp, CHIME.nominalTau)
  return finishMono(out, sr)
}

// =================================================================== sparkle

/** Glockenspiel ping used by `sparkle` (quieter/shorter than `record`). */
export const PING = { ratios: [1, 2.756, 5.404], amps: [1, 0.35, 0.12], taus: [0.3, 0.1, 0.04] }

export function renderPing(sr: number, pitch: number): Float32Array {
  const f = midiToFreq(pitch)
  if (f > aliasGuardHz(sr)) return new Float32Array(1)
  const comp = hfComp(f)
  const out = new Float32Array(samplesFor(sr, PING.taus[0] * Math.log(1 / SILENT) + END_FADE))
  for (let k = 0; k < PING.ratios.length; k++) {
    addPartial(out, sr, f * PING.ratios[k], PING.amps[k] * comp, PING.taus[k])
  }
  fadeOutTail(out, samplesFor(sr, END_FADE))
  return out
}

export const SPARKLE = {
  /** Pings per second at the start; density decays to `rateEnd` x by the end. */
  rate: 16,
  rateEnd: 0.25,
  pan: 0.7,
  /** Probability of +12 / +24 semitones. */
  octaveUp: 0.3,
  twoOctavesUp: 0.12,
  /** Pings are folded down by octaves until below this. */
  maxHz: 6000,
  /** Amplitude falls to (1 - ampFall) by the end. */
  ampFall: 0.55,
}

export function renderSparkle(
  sr: number,
  notes: readonly number[],
  dur: number,
  rng: Rng,
  ping: (pitch: number) => Float32Array,
): Voice {
  const starts: number[] = []
  const bufs: Float32Array[] = []
  const gains: number[] = []
  const pans: number[] = []
  let t = rng() * 0.03
  let end = 1
  while (t < dur) {
    const x = t / dur
    let p = notes[Math.floor(rng() * notes.length)]
    const r = rng()
    if (r < SPARKLE.twoOctavesUp) p += 24
    else if (r < SPARKLE.twoOctavesUp + SPARKLE.octaveUp) p += 12
    while (midiToFreq(p) > SPARKLE.maxHz) p -= 12
    const buf = ping(Math.round(p * 100) / 100)
    const s = Math.round(t * sr)
    starts.push(s)
    bufs.push(buf)
    gains.push((0.55 + 0.45 * rng()) * (1 - SPARKLE.ampFall * x))
    pans.push((rng() * 2 - 1) * SPARKLE.pan)
    end = Math.max(end, s + buf.length)
    const rate = SPARKLE.rate * (1 - (1 - SPARKLE.rateEnd) * x)
    t += (0.4 + 1.2 * rng()) / rate
  }
  const L = new Float32Array(end)
  const R = new Float32Array(end)
  for (let k = 0; k < bufs.length; k++) {
    const [pl, pr] = panGains(pans[k])
    const gl = pl * gains[k]
    const gr = pr * gains[k]
    const b = bufs[k]
    const s = starts[k]
    for (let i = 0; i < b.length; i++) {
      L[s + i] += b[i] * gl
      R[s + i] += b[i] * gr
    }
  }
  return finishStereo(L, R, sr)
}

// =================================================================== pop / whoosh / tick

/** Party popper: 15 ms band-passed burst + 120 Hz thump + a little confetti rustle. */
export const POP = {
  burstTau: 0.004,
  thumpStart: 170,
  thumpEnd: 115,
  thumpTau: 0.018,
  thumpAmp: 0.6,
  crackles: 24,
  crackleAmp: 0.12,
  crackleSpan: 0.55,
}

export function renderPop(sr: number, rng: Rng): Voice {
  const out = new Float32Array(samplesFor(sr, 0.75))
  addNoise(out, sr, rng, MIN_ATTACK, POP.burstTau, 1, [highpassCoeffs(sr, 1000), lowpassCoeffs(sr, 4000)])
  const na = samplesFor(sr, MIN_ATTACK)
  let ph = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / sr
    const env = Math.exp(-t / POP.thumpTau)
    if (env < 1e-6) break
    const f = POP.thumpEnd + (POP.thumpStart - POP.thumpEnd) * Math.exp(-t / 0.01)
    out[i] += POP.thumpAmp * env * (i < na ? ramp(i / na) : 1) * Math.sin(ph)
    ph += (TWO_PI * f) / sr
  }
  const hp = highpassCoeffs(sr, 2500)
  const lp = lowpassCoeffs(sr, 10000)
  for (let k = 0; k < POP.crackles; k++) {
    const tk = 0.02 + POP.crackleSpan * Math.pow(rng(), 1.6)
    const amp = POP.crackleAmp * (0.35 + 0.65 * rng()) * (1 - tk / 0.65)
    addNoise(out, sr, rng, 0.0003, 0.0004, amp, [hp, lp], Math.round(tk * sr))
  }
  return finishMono(out, sr)
}

/** Transition swoosh: band-passed noise sweeping 4 kHz -> 400 Hz, bell envelope, L->R pan. */
export const WHOOSH = { fStart: 4000, fEnd: 400, q: 0.9, gain: 3.2, panFrom: -0.6, panTo: 0.6 }

export function renderWhoosh(sr: number, dur: number, rng: Rng): Voice {
  const nW = Math.max(2, Math.round(dur * sr))
  const n = nW + 1
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const svf = new Svf()
  const svf2 = new Svf()
  const ratio = WHOOSH.fEnd / WHOOSH.fStart
  let gl = 0
  let gr = 0
  for (let i = 0; i < n; i++) {
    const x = Math.min(1, i / nW)
    if ((i & 7) === 0) {
      const fc = WHOOSH.fStart * Math.pow(ratio, x)
      svf.set(sr, fc, WHOOSH.q)
      svf2.set(sr, fc, WHOOSH.q)
      ;[gl, gr] = panGains(WHOOSH.panFrom + (WHOOSH.panTo - WHOOSH.panFrom) * x)
    }
    const b = Math.sin(Math.PI * x)
    const s = svf2.bp(svf.bp(rng() * 2 - 1)) * WHOOSH.gain * b * b
    L[i] = s * gl
    R[i] = s * gr
  }
  return finishStereo(L, R, sr)
}

/** Tiny UI tick: 5 ms Hann-windowed sine. */
export function renderTick(sr: number, freq: number): Voice {
  if (!(freq > 0) || freq > aliasGuardHz(sr)) return silentVoice()
  const n = Math.max(3, Math.round(0.005 * sr))
  const out = new Float32Array(n)
  for (let i = 1; i < n - 1; i++) {
    const w = Math.sin((Math.PI * i) / (n - 1))
    out[i] = w * w * Math.sin((TWO_PI * freq * i) / sr)
  }
  return { l: out, r: null }
}
