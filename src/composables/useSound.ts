/**
 * useSound — lightweight Web Audio API sound effects.
 *
 * AudioContext is lazy-initialised on first call and stays alive for the
 * session.  All sounds fire synchronously with user gestures (click/keydown),
 * so there are no autoplay-policy issues.
 *
 * Mute state is persisted to localStorage so the preference survives reloads.
 */
import { ref, watch } from 'vue'

const STORAGE_KEY = 'star-battle/sound/muted'

// ── Shared mute state ──────────────────────────────────────────────────────
const muted = ref<boolean>(localStorage.getItem(STORAGE_KEY) === 'true')
watch(muted, (v) => localStorage.setItem(STORAGE_KEY, String(v)))

export function useSound() {
  function toggleMute() { muted.value = !muted.value }
  return { muted, toggleMute }
}

// ── AudioContext (lazy, singleton) ─────────────────────────────────────────
let ctx: AudioContext | null = null

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  // Resume if the browser suspended it (can happen after inactivity)
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// ── Primitive: play one oscillator with an ADSR-style envelope ─────────────
function tone(
  freq: number,
  type: OscillatorType,
  volume: number,
  attackMs: number,
  decayMs: number,
  startSec: number,
) {
  const c    = ac()
  const osc  = c.createOscillator()
  const gain = c.createGain()
  osc.connect(gain)
  gain.connect(c.destination)
  osc.type          = type
  osc.frequency.value = freq
  const t = startSec
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(volume, t + attackMs / 1000)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + (attackMs + decayMs) / 1000)
  osc.start(t)
  osc.stop(t + (attackMs + decayMs) / 1000 + 0.02)
}

// ── Public sound effects ───────────────────────────────────────────────────

/** Soft chime played when the player places a ★. */
export function playStarPlace() {
  if (muted.value) return
  const t = ac().currentTime
  tone(523.25, 'sine', 0.15, 6,  220, t)        // C5 fundamental
  tone(783.99, 'sine', 0.07, 6,  200, t + 0.01) // G5 harmonic (+5th), slight delay
}

/** Subtle tick played when the player places a dot mark. */
export function playMarkPlace() {
  if (muted.value) return
  tone(900, 'sine', 0.06, 3, 55, ac().currentTime)
}

/** Short low tone signalling an invalid star placement (violation detected). */
export function playWrong() {
  if (muted.value) return
  const t = ac().currentTime
  // Two descending semitones — quick, clearly negative, not jarring
  tone(330, 'sine', 0.10, 5,  80, t)
  tone(277, 'sine', 0.10, 5, 130, t + 0.08)
}

/** Ascending C-major arpeggio played when the puzzle is solved. */
export function playSolve() {
  if (muted.value) return
  const t     = ac().currentTime
  const notes = [261.63, 329.63, 392.00, 523.25] // C4 E4 G4 C5
  notes.forEach((freq, i) => {
    tone(freq, 'sine', 0.18, 10, 280, t + i * 0.085)
  })
  // Shimmer on top: E5 with a longer tail
  tone(659.25, 'sine', 0.10, 10, 480, t + notes.length * 0.085)
}
