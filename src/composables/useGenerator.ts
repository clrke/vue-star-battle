import { ref } from 'vue'
import type { Puzzle } from '../types/puzzle'

export type GeneratorStatus = 'idle' | 'generating' | 'done' | 'failed'

const TIME_LIMITS: Record<number, number> = {
  5: 3_000,
  6: 6_000,
  7: 8_000,
  8: 10_000,
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
   */
  function generate(n: number): Promise<Puzzle> {
    if (status.value === 'generating') cancel()

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
          resolve(e.data.puzzle as Puzzle)
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
