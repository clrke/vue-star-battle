import { ref } from 'vue'
import type { Puzzle } from '../types/puzzle'

export type GeneratorStatus = 'idle' | 'generating' | 'done' | 'failed'

// Generation now strictly requires pure-logic puzzles (difficulty === 0).
// Budgets sized for ~95 % success rate based on empirical pure-rate per size.
// 12×12 was removed from progression (see types/progression.ts) — the SA
// generator cannot find unique 12×12 puzzles in any practical budget.
const TIME_LIMITS: Record<number, number> = {
  4:   3_000,
  5:   5_000,
  6:  12_000,
  7:  20_000,
  8:  30_000,
  10: 60_000,
}

// ── Module-level background pre-generation singleton ───────────────────────
// Persists across component re-mounts so the warm cache survives navigation.

let bgWorker: Worker | null = null
let bgPuzzle: Puzzle | null = null
let bgSize: number | null = null

/**
 * Start a background worker to pre-generate a puzzle of size n.
 * Idempotent — does nothing if already generating or caching for this size.
 */
export function preGenerate(n: number): void {
  // Don't restart if already generating or already have a cache for this size
  if (bgSize === n && (bgWorker !== null || bgPuzzle !== null)) return
  // Terminate any in-flight background gen for a different size
  if (bgWorker) { bgWorker.terminate(); bgWorker = null }
  bgPuzzle = null
  bgSize = n

  const w = new Worker(
    new URL('../workers/generator.worker.ts', import.meta.url),
    { type: 'module' },
  )
  bgWorker = w
  w.onmessage = (e: MessageEvent) => {
    bgWorker = null
    if (e.data.type === 'done') bgPuzzle = e.data.puzzle as Puzzle
  }
  w.onerror = () => { bgWorker = null }
  w.postMessage({ n, timeLimit: TIME_LIMITS[n] ?? 5_000 })
}

export function useGenerator() {
  const status  = ref<GeneratorStatus>('idle')
  const elapsed = ref(0)   // ms since generation started (for progress display)

  let worker: Worker | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let startedAt = 0

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null }
  }

  function terminate() {
    worker?.terminate()
    worker = null
    stopTicker()
  }

  /**
   * Start generating a puzzle of size n.
   * Resolves with the puzzle, or rejects after the time limit.
   * Checks the background cache first; if a puzzle is ready, resolves instantly.
   */
  function generate(n: number): Promise<Puzzle> {
    if (status.value === 'generating') cancel()

    // ── Fast path: serve from background cache ─────────────────────────────
    if (bgPuzzle && bgSize === n) {
      const cached = bgPuzzle
      bgPuzzle = null
      bgSize = null
      status.value = 'done'
      // Kick off the next background gen immediately
      preGenerate(n)
      return Promise.resolve(cached)
    }

    // ── In-flight path: reuse the already-running background worker ─────────
    if (bgWorker && bgSize === n) {
      // Capture the worker reference once so a synchronous onerror later in
      // this tick can't null `bgWorker` out from under us. (Without this,
      // `bgWorker!.onmessage = …` below could throw on the bang assertion.)
      const w = bgWorker
      status.value = 'generating'
      elapsed.value = 0
      startedAt = Date.now()
      ticker = setInterval(() => { elapsed.value = Date.now() - startedAt }, 100)

      return new Promise<Puzzle>((resolve, reject) => {
        const prevOnMessage = w.onmessage
        w.onmessage = (e: MessageEvent) => {
          // Let the singleton bookkeeping run first
          prevOnMessage?.call(w, e)
          stopTicker()
          if (e.data.type === 'done') {
            bgPuzzle = null   // consumed by this foreground call
            status.value = 'done'
            resolve(e.data.puzzle as Puzzle)
            preGenerate(n)   // start next background gen
          } else {
            status.value = 'failed'
            reject(new Error('Generation failed'))
          }
        }
        w.onerror = () => {
          stopTicker()
          status.value = 'failed'
          if (bgWorker === w) bgWorker = null
          reject(new Error('Worker error'))
        }
      })
    }

    // ── Cold path: no cache, no in-flight — start a fresh foreground gen ────
    status.value = 'generating'
    elapsed.value = 0
    startedAt = Date.now()

    ticker = setInterval(() => {
      elapsed.value = Date.now() - startedAt
    }, 100)

    return new Promise<Puzzle>((resolve, reject) => {
      worker = new Worker(
        new URL('../workers/generator.worker.ts', import.meta.url),
        { type: 'module' },
      )

      worker.onmessage = (e: MessageEvent) => {
        terminate()
        if (e.data.type === 'done') {
          status.value = 'done'
          const puzzle = e.data.puzzle as Puzzle
          resolve(puzzle)
          preGenerate(n)   // start next in background
        } else {
          status.value = 'failed'
          reject(new Error('Generation failed'))
        }
      }

      worker.onerror = () => {
        terminate()
        status.value = 'failed'
        reject(new Error('Worker error'))
      }

      worker.postMessage({ n, timeLimit: TIME_LIMITS[n] ?? 8_000 })
    })
  }

  function cancel() {
    terminate()
    status.value = 'idle'
    elapsed.value = 0
  }

  return { status, elapsed, generate, cancel }
}
