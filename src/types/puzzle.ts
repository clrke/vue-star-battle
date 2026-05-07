/**
 * What a cell *is* in the user's saved state.
 * Persisted to localStorage and undone via the history stack.
 */
export type CellState = 'empty' | 'star' | 'marked'

/**
 * What a cell *displays as* on screen.
 * Adds 'auto-marked' — a derived state shown when an existing star eliminates
 * a still-empty cell (same row/column/region or 8-adjacent). Auto-marks are
 * recomputed every render and never written to user state, so undoing a star
 * removes them automatically without affecting the player's real marks.
 */
export type DisplayCellState = CellState | 'auto-marked'

export interface Puzzle {
  id: string
  title: string
  n: number
  /** n×n grid of 0-based region IDs */
  grid: number[][]
}

export interface BorderEdges {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

/**
 * Visual entities a hint step can highlight on the board.
 * The Board component translates these into per-cell flags.
 */
export interface HintHighlight {
  rows?: number[]
  cols?: number[]
  regions?: number[]
  /** Additional supporting cells (e.g. the source star for an adjacency hint). */
  cells?: [number, number][]
  /** The action target — pulses gold (star) or blue (mark) on the last step. */
  primaryCell?: [number, number]
}

export interface HintStep {
  /** Plain-English sentence shown to the player at this step. */
  text: string
  highlight: HintHighlight
}
