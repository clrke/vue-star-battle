import { generatePuzzle } from '../solver/generator'
import { computeDifficulty } from '../solver/difficulty'
import type { Puzzle } from '../types/puzzle'

self.onmessage = (e: MessageEvent<{ n: number; timeLimit: number }>) => {
  const { n, timeLimit } = e.data
  const deadline = Date.now() + timeLimit

  const puzzle: Puzzle | null = generatePuzzle(n, deadline)

  if (puzzle) {
    puzzle.difficulty = computeDifficulty(puzzle)
    self.postMessage({ type: 'done', puzzle })
  } else {
    self.postMessage({ type: 'failed' })
  }
}
