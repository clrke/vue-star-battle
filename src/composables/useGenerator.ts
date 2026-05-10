import { ref } from 'vue'
import type { Puzzle } from '../types/puzzle'

export type GeneratorStatus = 'idle' | 'generating' | 'done' | 'failed'

// Generation enforces the active tier's lookahead cap as well as uniqueness.
// Budgets sized for ~95 % success rate based on empirical pure-rate per size.
// 12×12 was removed from progression (see types/progression.ts) — the SA
// generator cannot find unique 12×12 puzzles in any practical budget.
//
// Smaller grids are inherently lookahead-heavy: ~5–12 % of random unique 4×4
// puzzles are 0-lookahead, so we give them the same budget as 5×5 to allow
// enough SA retries to find one. Higher tiers (more lookaheads allowed) hit
// these budgets comfortably; tier 0 at n=4/5 is the worst case.
const TIME_LIMITS: Record<number, number> = {
  4:   8_000,
  5:  10_000,
  6:  12_000,
  7:  20_000,
  8:  30_000,
  10: 60_000,
}

// ── Module-level background pre-generation singleton ───────────────────────
// Persists across component re-mounts so the warm cache survives navigation.
//
// Cache key is (size, maxLookaheads) — a tier change must invalidate any
// in-flight or cached puzzle from the previous tier, otherwise the player
// could level-up and instantly receive an easier-tier puzzle from cache.

let bgWorker: Worker | null = null
let bgPuzzle: Puzzle | null = null
let bgSize: number | null = null
let bgMaxLookaheads: number | null = null

function cacheMatches(n: number, maxLookaheads: number): boolean {
  return bgSize === n && bgMaxLookaheads === maxLookaheads
}

/**
 * Start a background worker to pre-generate a puzzle of size n at the given
 * lookahead-tier cap. Idempotent — does nothing if already generating or
 * caching a matching (n, maxLookaheads) pair.
 */
export function preGenerate(n: number, maxLookaheads = 0): void {
  // Don't restart if already generating or already have a cache for this combo
  if (cacheMatches(n, maxLookaheads) && (bgWorker !== null || bgPuzzle !== null)) return
  // Terminate any in-flight background gen for a different combo
  if (bgWorker) { bgWorker.terminate(); bgWorker = null }
  bgPuzzle = null
  bgSize = n
  bgMaxLookaheads = maxLookaheads

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
  w.postMessage({ n, timeLimit: TIME_LIMITS[n] ?? 5_000, maxLookaheads })
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
   * Start generating a puzzle of size n at the given lookahead-tier cap.
   * Resolves with the puzzle, or rejects after the time limit.
   * Checks the background cache first; if a puzzle is ready, resolves instantly.
   */
  function generate(n: number, maxLookaheads = 0): Promise<Puzzle> {
    if (status.value === 'generating') cancel()

    // ── Fast path: serve from background cache ─────────────────────────────
    if (bgPuzzle && cacheMatches(n, maxLookaheads)) {
      const cached = bgPuzzle
      bgPuzzle = null
      bgSize = null
      bgMaxLookaheads = null
      status.value = 'done'
      // Kick off the next background gen immediately
      preGenerate(n, maxLookaheads)
      return Promise.resolve(cached)
    }

    // ── In-flight path: reuse the already-running background worker ─────────
    if (bgWorker && cacheMatches(n, maxLookaheads)) {
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
            preGenerate(n, maxLookaheads)   // start next background gen
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
    // Also kill any stale background work for a different (n, maxLookaheads).
    if (bgWorker) { bgWorker.terminate(); bgWorker = null }
    bgPuzzle = null

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
          preGenerate(n, maxLookaheads)   // start next in background
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

      worker.postMessage({ n, timeLimit: TIME_LIMITS[n] ?? 8_000, maxLookaheads })
    })
  }

  function cancel() {
    terminate()
    status.value = 'idle'
    elapsed.value = 0
  }

  return { status, elapsed, generate, cancel }
}
