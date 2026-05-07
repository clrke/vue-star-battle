import type { Puzzle } from '../types/puzzle'

/**
 * 5×5 puzzle — 5 regions
 * Known solution: (r0,c2) (r1,c4) (r2,c1) (r3,c3) (r4,c0)
 *
 * Grid:
 *   0 0 0 1 1
 *   0 2 2 1 1
 *   3 2 2 4 4
 *   3 3 2 4 4
 *   3 3 3 4 4
 */
const puzzle5x5: Puzzle = {
  id: 'classic-5',
  title: 'Classic 5×5',
  n: 5,
  grid: [
    [0, 0, 0, 1, 1],
    [0, 2, 2, 1, 1],
    [3, 2, 2, 4, 4],
    [3, 3, 2, 4, 4],
    [3, 3, 3, 4, 4],
  ],
}

/**
 * 6×6 puzzle — 6 regions
 *
 * Grid:
 *   0 0 1 1 2 2
 *   0 0 1 1 2 2
 *   3 3 1 4 4 2
 *   3 3 3 4 4 5
 *   3 5 5 5 5 5
 *   6 6 6 6 6 5   <-- wait, we only have 6 regions (0–5)
 *
 * Grid (corrected):
 *   0 0 1 1 2 2
 *   0 0 1 1 2 2
 *   3 3 1 4 4 2
 *   3 3 3 4 4 5
 *   3 5 5 4 5 5
 *   3 5 5 5 5 5
 */
const puzzle6x6: Puzzle = {
  id: 'classic-6',
  title: 'Classic 6×6',
  n: 6,
  grid: [
    [0, 0, 1, 1, 2, 2],
    [0, 0, 1, 1, 2, 2],
    [3, 3, 1, 4, 4, 2],
    [3, 3, 3, 4, 4, 5],
    [3, 5, 5, 4, 5, 5],
    [3, 5, 5, 5, 5, 5],
  ],
}

/**
 * 8×8 puzzle — 8 regions
 *
 * Grid:
 *   0 0 0 1 1 1 2 2
 *   0 0 1 1 3 1 2 2
 *   0 4 4 3 3 5 5 2
 *   4 4 4 3 5 5 6 6
 *   4 7 4 3 5 6 6 6
 *   7 7 7 3 5 5 6 8
 *   7 7 7 7 5 8 8 8
 *   7 7 7 7 8 8 8 8
 */
const puzzle8x8: Puzzle = {
  id: 'classic-8',
  title: 'Classic 8×8',
  n: 8,
  grid: [
    [0, 0, 0, 1, 1, 1, 2, 2],
    [0, 0, 1, 1, 3, 1, 2, 2],
    [0, 4, 4, 3, 3, 5, 5, 2],
    [4, 4, 4, 3, 5, 5, 6, 6],
    [4, 7, 4, 3, 5, 6, 6, 6],
    [7, 7, 7, 3, 5, 5, 6, 8],
    [7, 7, 7, 7, 5, 8, 8, 8],
    [7, 7, 7, 7, 8, 8, 8, 8],
  ],
}

export const puzzles: Puzzle[] = [puzzle5x5, puzzle6x6, puzzle8x8]
