export type CellState = 'empty' | 'star' | 'marked'

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
