/**
 * Daily puzzle — one deterministic 5×5 puzzle per UTC calendar day.
 *
 * Everyone on the same UTC day gets the same puzzle. The generator worker
 * is seeded with mulberry32(dayIndex × 31337) so the result is
 * bit-for-bit identical for every player. Generation runs off the main
 * thread (no UI freeze), is kicked off on app mount, and cached for the
 * session.
 */
import { ref } from 'vue'
import type { Puzzle } from '../types/puzzle'

export const DAILY_SIZE  = 5          // fixed 5×5: fast, accessible at any level
const DAILY_TIME_LIMIT   = 10_000     // ms budget per attempt in the worker
const STORAGE_KEY        = 'star-battle/daily/v1'

// ── Day index ─────────────────────────────────────────────────────────────────

export function todayUTC(): number {
  return Math.floor(Date.now() / 86_400_000)
}

// ── Worker management (module-level singleton, like preGenerate) ──────────────

let _day:       number          = -1
let _puzzle:    Puzzle | null   = null
let _worker:    Worker | null   = null
let _pending:   Array<(p: Puzzle | null) => void> = []

function startWorker(day: number) {
  if (_worker) return      // already in flight for this day
  _puzzle = null

  const w = new Worker(
    new URL('../workers/generator.worker.ts', import.meta.url),
    { type: 'module' },
  )
  _worker = w

  // Each day gets a unique but stable seed (prime-scaled to avoid low-entropy clumps)
  const seed = (day * 31_337) >>> 0

  w.onmessage = (e: MessageEvent) => {
    _worker = null
    if (e.data.type === 'done') {
      const puzzle = e.data.puzzle as Puzzle
      puzzle.id    = `daily-${day}`
      puzzle.title = `Daily #${day}`
      _puzzle = puzzle
    }
    const result = _puzzle
    _pending.forEach(cb => cb(result))
    _pending = []
  }
  w.onerror = () => {
    _worker = null
    _pending.forEach(cb => cb(null))
    _pending = []
  }
  w.postMessage({ n: DAILY_SIZE, timeLimit: DAILY_TIME_LIMIT, seed })
}

/**
 * Kick off background generation for today's daily puzzle.
 * Idempotent — safe to call multiple times. Call on app mount so the
 * puzzle is ready before the user ever clicks the 📅 button.
 */
export function preGenerateDaily(): void {
  const day = todayUTC()
  if (_day === day && (_puzzle !== null || _worker !== null)) return
  _day    = day
  _puzzle = null
  startWorker(day)
}

/**
 * Resolve to today's daily puzzle (waits for background generation if
 * not yet complete). Rejects never — returns null on failure.
 */
export function getDailyPuzzle(): Promise<Puzzle | null> {
  const day = todayUTC()
  if (_day === day && _puzzle) return Promise.resolve(_puzzle)

  return new Promise(resolve => {
    // Ensure generation is running for today
    if (_day !== day) {
      _day    = day
      _puzzle = null
      if (_worker) { _worker.terminate(); _worker = null }
      startWorker(day)
    } else if (!_worker) {
      // Same day but worker finished without a puzzle — retry once
      startWorker(day)
    }
    _pending.push(resolve)
  })
}

// ── Solved-today persistence ──────────────────────────────────────────────────

interface DailyRecord { day: number }

function loadRecord(): DailyRecord | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') }
  catch { return null }
}

/** True when the player has already solved today's daily puzzle. */
export const dailySolvedToday = ref(loadRecord()?.day === todayUTC())

export function markDailySolved(): void {
  dailySolvedToday.value = true
  try {
    // Use todayUTC() at call-time (not a cached value) so marking works
    // correctly even when the app has been open across midnight.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: todayUTC() } satisfies DailyRecord))
  } catch { /* storage unavailable */ }
}

/**
 * Re-evaluate whether today's daily has been solved.
 * Call on tab-focus so the state updates if midnight passed while the tab
 * was hidden (avoids the yesterday-solved / today-unsolvable bug).
 */
export function refreshDailyState(): void {
  dailySolvedToday.value = loadRecord()?.day === todayUTC()
}
