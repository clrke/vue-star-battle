/**
 * Daily puzzle — one deterministic 5×5 puzzle per UTC calendar day.
 *
 * Everyone on the same calendar day (UTC) gets the same puzzle, making it
 * a community challenge. Fixed at 5×5 so it's accessible at any level and
 * fast to generate (<100 ms typical).
 *
 * Seeding: we temporarily replace Math.random with a mulberry32 PRNG keyed
 * to the day index during generation. The generator is synchronous with no
 * async interleaving, so monkey-patching is safe.
 */
import { ref } from 'vue'
import { generatePuzzle } from '../solver/generator'
import type { Puzzle } from '../types/puzzle'

const DAILY_SIZE   = 5
const STORAGE_KEY  = 'star-battle/daily/v1'

// ── Utilities ─────────────────────────────────────────────────────────────────

export function todayUTC(): number {
  return Math.floor(Date.now() / 86_400_000)   // UTC day index since epoch
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

// ── Generation (lazy, cached per day) ─────────────────────────────────────────

let _cachedDay    = -1
let _cachedPuzzle: Puzzle | null = null

function generateForDay(day: number): Puzzle | null {
  // Try up to 4 seeds; stop on first success (different seeds → different shapes)
  for (let attempt = 0; attempt < 4; attempt++) {
    const seed   = day * 31_337 + attempt * 9_973
    const rng    = mulberry32(seed)
    const prev   = Math.random
    Math.random  = rng
    try {
      const puzzle = generatePuzzle(DAILY_SIZE, Date.now() + 8_000)
      if (puzzle) {
        puzzle.id    = `daily-${day}`
        puzzle.title = `Daily #${day}`
        return puzzle
      }
    } finally {
      Math.random = prev
    }
  }
  return null
}

export function getDailyPuzzle(): Puzzle | null {
  const day = todayUTC()
  if (day !== _cachedDay) {
    _cachedDay    = day
    _cachedPuzzle = generateForDay(day)
  }
  return _cachedPuzzle
}

// ── Solved-today state (localStorage) ─────────────────────────────────────────

interface DailyRecord { day: number }

function loadRecord(): DailyRecord | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') }
  catch { return null }
}

const _today  = todayUTC()
const _record = loadRecord()

export const dailySolvedToday = ref(_record?.day === _today)

export function markDailySolved() {
  dailySolvedToday.value = true
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: _today } satisfies DailyRecord)) }
  catch { /* storage unavailable */ }
}
