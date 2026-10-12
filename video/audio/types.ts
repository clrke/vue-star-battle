/**
 * Public types for the procedural audio engine.
 *
 * The score (video/audio/score.ts) produces a list of timed `AudioCue`s; the
 * engine (`renderAudio` in ./synth) turns them into a mastered stereo buffer.
 */

/** Every sound the engine knows how to make. */
export type CueKind =
  | 'place' // star placed: warm marimba/kalimba mallet pluck at `pitch` (the lead)
  | 'record' // new deepest depth: glockenspiel/celesta sparkle at `pitch`
  | 'remove' // backtrack: soft short descending "bloop" starting at `pitch`
  | 'conflict' // dead end: gentle muted low "bonk"
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openhat'
  | 'pad' // warm chord pad: `notes`, sustained `dur` then released
  | 'bass' // bass note at `pitch`, sustained `dur`
  | 'riser' // tension riser starting at t, peaking exactly at t + dur
  | 'impact' // the big payoff hit when the puzzle is solved
  | 'chime' // bright FM bell at `pitch` (post-solve verification sweep)
  | 'sparkle' // shimmering cascade of tiny bell pings over `dur`, pitches from `notes`
  | 'pop' // confetti party-popper
  | 'whoosh' // transition swoosh over `dur` (default 0.4 s)
  | 'tick' // tiny quiet UI tick (counter roll)

/** All cue kinds, in a fixed order (handy for tests and tooling). */
export const CUE_KINDS: readonly CueKind[] = [
  'place',
  'record',
  'remove',
  'conflict',
  'kick',
  'snare',
  'clap',
  'hat',
  'openhat',
  'pad',
  'bass',
  'riser',
  'impact',
  'chime',
  'sparkle',
  'pop',
  'whoosh',
  'tick',
]

export interface AudioCue {
  /** Start time in seconds from the start of the video (fractional ok, not grid-aligned). */
  t: number
  kind: CueKind
  /** MIDI note number (float ok). Used by place, record, remove, chime, bass (and tick, optionally). */
  pitch?: number
  /** MIDI notes for pad (chord) and sparkle (pitch pool). */
  notes?: number[]
  /** Seconds, for pad, bass, riser, sparkle and whoosh. */
  dur?: number
  /** Linear multiplier on the kind's default level (default 1). */
  gain?: number
  /** -1 (left) .. +1 (right), constant-power pan law (default 0). */
  pan?: number
}

export interface RenderOptions {
  /** Output sample rate in Hz (default 48000). */
  sampleRate?: number
  /** Seed for every noise source (default 1). Same cues + same seed => bit-identical output. */
  seed?: number
  /** Integrated loudness target, ITU-R BS.1770-4 (default -14 LUFS). */
  targetLufs?: number
  /** Limiter ceiling in dBFS, true-peak aware (default -1). */
  ceilingDb?: number
}

export interface StereoBuffer {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

export interface LoudnessReport {
  /** Integrated loudness (BS.1770-4, gated). `-Infinity` for silence. */
  integratedLufs: number
  /** Sample peak over both channels in dBFS. `-Infinity` for silence. */
  peakDb: number
}
