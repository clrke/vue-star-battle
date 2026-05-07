import type { Puzzle } from '../types/puzzle'

/**
 * 5×5 — unique solution: (r0,c3) (r1,c1) (r2,c4) (r3,c2) (r4,c0)
 * Region sizes: 4 6 5 5 5
 */
const puzzle5x5: Puzzle = {
  id: 'classic-5',
  title: 'Classic 5×5',
  n: 5,
  grid: [
    [1, 1, 1, 0, 0],
    [1, 1, 0, 0, 2],
    [4, 1, 2, 2, 2],
    [4, 3, 3, 3, 2],
    [4, 4, 4, 3, 3],
  ],
}

/**
 * 6×6 — unique solution: (r0,c3) (r1,c5) (r2,c2) (r3,c0) (r4,c4) (r5,c1)
 * Region sizes: 4 4 7 8 7 6
 */
const puzzle6x6: Puzzle = {
  id: 'classic-6',
  title: 'Classic 6×6',
  n: 6,
  grid: [
    [2, 2, 2, 0, 0, 1],
    [3, 3, 2, 2, 0, 1],
    [3, 3, 2, 2, 0, 1],
    [3, 4, 4, 4, 4, 1],
    [3, 3, 3, 5, 4, 4],
    [5, 5, 5, 5, 5, 4],
  ],
}

/**
 * 8×8 — unique solution: (r0,c0) (r1,c2) (r2,c4) (r3,c6) (r4,c1) (r5,c3) (r6,c5) (r7,c7)
 * Region sizes: 11 11 11 5 10 6 5 5
 */
const puzzle8x8: Puzzle = {
  id: 'classic-8',
  title: 'Classic 8×8',
  n: 8,
  grid: [
    [0, 0, 0, 1, 1, 2, 2, 2],
    [0, 0, 1, 1, 1, 2, 2, 2],
    [0, 0, 1, 2, 2, 2, 2, 2],
    [0, 4, 1, 1, 5, 3, 3, 3],
    [0, 4, 1, 1, 5, 3, 6, 6],
    [0, 4, 1, 5, 5, 3, 6, 7],
    [0, 4, 4, 4, 5, 6, 6, 7],
    [4, 4, 4, 4, 5, 7, 7, 7],
  ],
}

export const puzzles: Puzzle[] = [puzzle5x5, puzzle6x6, puzzle8x8]
