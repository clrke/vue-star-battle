/** Fixed puzzles (from real renders) so timeline/score tests don't depend on the time-budgeted generator. */
import type { Puzzle } from '../../src/types/puzzle'

/** 8×8 — 61 placements, 30 dead ends. */
export const PUZZLE_8: Puzzle = {
  id: 'sb-8-1vbsum2',
  title: '8×8',
  n: 8,
  grid: [
    [1, 0, 0, 0, 2, 2, 2, 2],
    [1, 0, 2, 0, 0, 0, 2, 2],
    [1, 1, 2, 2, 2, 2, 2, 3],
    [1, 1, 1, 1, 1, 3, 2, 3],
    [4, 4, 4, 3, 1, 3, 3, 3],
    [6, 6, 4, 3, 3, 3, 5, 5],
    [6, 6, 4, 3, 3, 7, 5, 5],
    [6, 3, 3, 3, 3, 7, 7, 5],
  ],
}

/** 9×9 — 431 placements, 294 dead ends. */
export const PUZZLE_9: Puzzle = {
  id: 'sb-9-9coy3r',
  title: '9×9',
  n: 9,
  grid: [
    [1, 1, 0, 0, 0, 2, 2, 2, 2],
    [3, 1, 1, 0, 5, 5, 5, 5, 2],
    [3, 1, 4, 0, 5, 5, 5, 2, 2],
    [3, 4, 4, 0, 0, 8, 5, 5, 2],
    [3, 4, 4, 4, 0, 8, 5, 6, 6],
    [7, 4, 0, 0, 0, 8, 5, 5, 6],
    [7, 4, 4, 8, 8, 8, 6, 6, 6],
    [7, 7, 8, 8, 8, 8, 8, 6, 6],
    [8, 8, 8, 8, 8, 8, 8, 8, 6],
  ],
}
