import type { Puzzle, DisplayCellState } from '../types/puzzle'

/**
 * Derive the display state by overlaying auto-marks onto a raw user state.
 *
 * For every placed star, cells in the same row, column, region, and 8-adjacent
 * neighbourhood that are still 'empty' become 'auto-marked'. Auto-marks are
 * purely computed and never persisted; undoing a star removes them instantly.
 *
 * This is the canonical shared implementation.  The game store (game.ts) and
 * test helpers duplicate the same logic — they should be migrated here over
 * time, but are not changed in this commit to avoid churn.
 */
export function applyAutoMarks(
  puzzle: Puzzle,
  state: DisplayCellState[][],
): DisplayCellState[][] {
  const { n, grid } = puzzle
  const out: DisplayCellState[][] = state.map(row => row.slice() as DisplayCellState[])

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (out[r][c] !== 'star') continue
      const rid = grid[r][c]

      // Same row / column
      for (let i = 0; i < n; i++) {
        if (i !== c && out[r][i] === 'empty') out[r][i] = 'auto-marked'
        if (i !== r && out[i][c] === 'empty') out[i][c] = 'auto-marked'
      }
      // Same region
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++)
          if (grid[rr][cc] === rid && !(rr === r && cc === c) && out[rr][cc] === 'empty')
            out[rr][cc] = 'auto-marked'
      // 8-adjacent
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue
          if (out[nr][nc] === 'empty') out[nr][nc] = 'auto-marked'
        }
    }
  }
  return out
}
