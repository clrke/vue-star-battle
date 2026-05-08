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

const puzzle4x4a: Puzzle = {
  id: 'classic-4a',
  title: 'Classic 4×4',
  n: 4,
  grid: [
    [1, 0, 0, 0],
    [1, 3, 3, 0],
    [1, 3, 2, 2],
    [1, 3, 2, 2],
  ],
}

const puzzle4x4b: Puzzle = {
  id: 'classic-4b',
  title: 'Classic 4×4 II',
  n: 4,
  grid: [
    [0, 0, 1, 1],
    [2, 0, 1, 1],
    [2, 0, 1, 3],
    [2, 2, 3, 3],
  ],
}

const puzzle4x4c: Puzzle = {
  id: 'classic-4c',
  title: 'Classic 4×4 III',
  n: 4,
  grid: [
    [0, 0, 0, 1],
    [0, 0, 1, 1],
    [2, 2, 1, 1],
    [2, 3, 3, 3],
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

// Stars: (0,1),(1,3),(2,0),(3,4),(4,2) — all non-adjacent
const puzzle5x5b: Puzzle = {
  id: 'classic-5b',
  title: 'Classic 5×5 II',
  n: 5,
  grid: [
    [0, 0, 0, 1, 1],
    [2, 0, 0, 1, 1],
    [2, 4, 4, 3, 1],
    [2, 4, 4, 3, 3],
    [2, 2, 4, 3, 3],
  ],
}

// Stars: (0,3),(1,0),(2,2),(3,4),(4,1) — all non-adjacent
const puzzle5x5c: Puzzle = {
  id: 'classic-5c',
  title: 'Classic 5×5 III',
  n: 5,
  grid: [
    [1, 1, 0, 0, 0],
    [1, 1, 1, 0, 0],
    [4, 2, 2, 2, 3],
    [4, 4, 2, 2, 3],
    [4, 4, 3, 3, 3],
  ],
}

const puzzle7x7a: Puzzle = {
  id: 'classic-7a',
  title: 'Classic 7×7',
  n: 7,
  grid: [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0],
    [3, 3, 2, 2, 4, 0, 0],
    [6, 3, 5, 2, 4, 0, 0],
    [6, 6, 5, 4, 4, 0, 0],
    [6, 5, 5, 4, 4, 4, 4],
    [6, 6, 6, 6, 6, 6, 6],
  ],
}

const puzzle10x10a: Puzzle = {
  id: 'classic-10a',
  title: 'Classic 10×10',
  n: 10,
  grid: [
    [0, 0, 0, 0, 0, 0, 2, 2, 1, 1],
    [3, 3, 3, 5, 5, 0, 0, 2, 1, 1],
    [3, 3, 5, 5, 5, 4, 4, 2, 2, 2],
    [3, 3, 5, 5, 5, 5, 4, 4, 4, 4],
    [5, 5, 5, 8, 8, 8, 4, 4, 7, 7],
    [5, 8, 8, 8, 8, 6, 6, 4, 4, 7],
    [5, 8, 9, 9, 6, 6, 9, 4, 4, 7],
    [8, 8, 9, 9, 9, 9, 9, 4, 7, 7],
    [8, 8, 9, 8, 8, 8, 9, 4, 4, 9],
    [8, 8, 8, 8, 9, 9, 9, 9, 9, 9],
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

const puzzle6x6b: Puzzle = {
  id: 'classic-6b',
  title: 'Classic 6×6 II',
  n: 6,
  grid: [
    [2, 1, 3, 3, 3, 0],
    [2, 1, 1, 3, 3, 0],
    [2, 1, 3, 3, 3, 0],
    [1, 1, 1, 1, 3, 3],
    [4, 4, 1, 1, 1, 3],
    [5, 5, 5, 5, 1, 3],
  ],
}

const puzzle7x7b: Puzzle = {
  id: 'classic-7b',
  title: 'Classic 7×7 II',
  n: 7,
  grid: [
    [0, 0, 0, 0, 1, 1, 1],
    [0, 4, 0, 0, 0, 0, 1],
    [4, 4, 0, 0, 2, 0, 1],
    [3, 4, 2, 2, 2, 1, 1],
    [3, 4, 4, 2, 1, 1, 1],
    [3, 6, 4, 2, 2, 5, 5],
    [6, 6, 2, 2, 2, 2, 5],
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

const puzzle8x8b: Puzzle = {
  id: 'classic-8b',
  title: 'Classic 8×8 II',
  n: 8,
  grid: [
    [1, 1, 1, 0, 0, 0, 0, 0],
    [1, 0, 1, 1, 1, 0, 2, 0],
    [1, 0, 0, 0, 0, 0, 2, 2],
    [1, 1, 0, 4, 4, 3, 3, 2],
    [1, 4, 4, 4, 3, 3, 5, 2],
    [1, 4, 6, 4, 4, 3, 5, 2],
    [1, 4, 6, 7, 4, 5, 5, 2],
    [1, 4, 6, 7, 7, 5, 5, 5],
  ],
}

export const puzzles: Puzzle[] = [
  puzzle4x4a, puzzle4x4b, puzzle4x4c,
  puzzle5x5, puzzle5x5b, puzzle5x5c,
  puzzle6x6, puzzle6x6b,
  puzzle7x7a, puzzle7x7b,
  puzzle8x8, puzzle8x8b,
  puzzle10x10a,
].map(withDifficulty)
