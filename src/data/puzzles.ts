import type { Puzzle } from '../types/puzzle'
import { computeDifficulty } from '../solver/difficulty'

function withDifficulty(p: Puzzle): Puzzle {
  return { ...p, difficulty: computeDifficulty(p) }
}

/**
 * Pre-vetted pure-logic puzzles (difficulty === 0).
 * Found via scripts/find-pure-puzzles.ts.  If you ever swap a grid here, the
 * `withDifficulty` helper will recompute the badge automatically — but please
 * also re-run the find-pure script and keep `difficulty === 0`.
 */

const puzzle4x4: Puzzle = {
  id: 'classic-4',
  title: 'Classic 4×4',
  n: 4,
  grid: [
    [1, 0, 0, 0],
    [1, 3, 3, 0],
    [1, 3, 2, 2],
    [1, 3, 2, 2],
  ],
}

const puzzle5x5: Puzzle = {
  id: 'classic-5',
  title: 'Classic 5×5',
  n: 5,
  grid: [
    [2, 0, 0, 1, 1],
    [2, 2, 0, 0, 1],
    [4, 2, 3, 3, 3],
    [4, 2, 4, 3, 3],
    [4, 4, 4, 3, 3],
  ],
}

const puzzle6x6: Puzzle = {
  id: 'classic-6',
  title: 'Classic 6×6',
  n: 6,
  grid: [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 2, 0, 0, 1],
    [0, 2, 2, 1, 1, 1],
    [3, 5, 2, 2, 2, 2],
    [3, 5, 2, 2, 4, 2],
    [3, 5, 5, 5, 4, 4],
  ],
}

const puzzle8x8: Puzzle = {
  id: 'classic-8',
  title: 'Classic 8×8',
  n: 8,
  grid: [
    [4, 4, 3, 1, 0, 0, 0, 2],
    [4, 3, 3, 1, 1, 0, 2, 2],
    [4, 3, 3, 3, 1, 1, 2, 7],
    [4, 4, 3, 6, 1, 1, 1, 7],
    [4, 4, 4, 6, 5, 5, 1, 7],
    [4, 4, 6, 6, 5, 5, 1, 7],
    [4, 6, 6, 6, 6, 6, 6, 7],
    [4, 4, 6, 6, 6, 7, 7, 7],
  ],
}

export const puzzles: Puzzle[] = [puzzle4x4, puzzle5x5, puzzle6x6, puzzle8x8].map(withDifficulty)
