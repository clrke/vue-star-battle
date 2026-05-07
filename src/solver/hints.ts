import type { Puzzle, CellState } from '../types/puzzle'
import { getSolution } from './solver'

/* ============================================================================
   Logical hint engine
   ----------------------------------------------------------------------------
   Tries — in order — to find a deduction the player can make from the *current*
   board state, and explains *why*. Stops at the first hit so each hint reveals
   exactly one step of reasoning, mirroring how a human plays.

   Search order:
     1. CONTRADICTION    — marks/stars already break the puzzle
     2. FORCED-REGION    — a region has exactly one star-eligible cell
     3. FORCED-ROW       — a row     has exactly one star-eligible cell
     4. FORCED-COL       — a column  has exactly one star-eligible cell
     5. MARK-ADJACENT    — empty cell next to a placed star
     6. MARK-REGION      — empty cell in the same region as a placed star
     7. MARK-ROW         — empty cell in the same row as a placed star
     8. MARK-COL         — empty cell in the same column as a placed star
     9. FALLBACK         — reveal a cell from the unique solution
   ========================================================================== */

export type HintCategory =
  | 'forced-region'
  | 'forced-row'
  | 'forced-col'
  | 'mark-adjacent'
  | 'mark-region'
  | 'mark-row'
  | 'mark-col'
  | 'fallback'
  | 'contradiction'
  | 'already-solved'

export type HintAction = 'place-star' | 'place-mark' | 'none'

export interface Hint {
  category: HintCategory
  cell: [number, number] | null
  action: HintAction
  /** Plain-English reasoning shown to the player. */
  reason: string
  /** Short tag shown in the UI (e.g. "Forced region"). */
  label: string
}

/** Build the "could a star still go here?" mask from the current board. */
function eligibilityMask(puzzle: Puzzle, state: CellState[][]) {
  const { n, grid } = puzzle
  const possible = Array.from({ length: n }, () => new Array<boolean>(n).fill(true))

  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (state[r][c] === 'marked') possible[r][c] = false

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (state[r][c] !== 'star') continue
      possible[r][c] = false
      const rid = grid[r][c]
      for (let i = 0; i < n; i++) { possible[r][i] = false; possible[i][c] = false }
      for (let rr = 0; rr < n; rr++)
        for (let cc = 0; cc < n; cc++)
          if (grid[rr][cc] === rid) possible[rr][cc] = false
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc
          if (nr >= 0 && nr < n && nc >= 0 && nc < n) possible[nr][nc] = false
        }
    }
  }
  return possible
}

function placedSets(puzzle: Puzzle, state: CellState[][]) {
  const rows    = new Set<number>()
  const cols    = new Set<number>()
  const regions = new Set<number>()
  const stars: [number, number][] = []
  for (let r = 0; r < puzzle.n; r++)
    for (let c = 0; c < puzzle.n; c++)
      if (state[r][c] === 'star') {
        rows.add(r); cols.add(c); regions.add(puzzle.grid[r][c])
        stars.push([r, c])
      }
  return { rows, cols, regions, stars }
}

function eligibleInRegion(puzzle: Puzzle, mask: boolean[][], rid: number) {
  const out: [number, number][] = []
  for (let r = 0; r < puzzle.n; r++)
    for (let c = 0; c < puzzle.n; c++)
      if (puzzle.grid[r][c] === rid && mask[r][c]) out.push([r, c])
  return out
}
function eligibleInRow(mask: boolean[][], r: number) {
  const out: [number, number][] = []
  for (let c = 0; c < mask.length; c++) if (mask[r][c]) out.push([r, c])
  return out
}
function eligibleInCol(mask: boolean[][], c: number) {
  const out: [number, number][] = []
  for (let r = 0; r < mask.length; r++) if (mask[r][c]) out.push([r, c])
  return out
}

const ord = (n: number) => `${n + 1}`

// ── Mark-suggestion search ──────────────────────────────────────────────────

function findMarkHint(
  puzzle: Puzzle,
  state: CellState[][],
  stars: [number, number][],
): Hint | null {
  const { n, grid } = puzzle
  if (stars.length === 0) return null

  // 1. Adjacent to a placed star (most-overlooked rule for new players)
  for (const [sr, sc] of stars) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = sr + dr, c = sc + dc
        if (r < 0 || r >= n || c < 0 || c >= n) continue
        if (state[r][c] !== 'empty') continue
        return {
          category: 'mark-adjacent',
          cell: [r, c],
          action: 'place-mark',
          label: 'Mark adjacent',
          reason:
            `Row ${ord(r)}, column ${ord(c)} is adjacent to the star at row ${ord(sr)}, ` +
            `column ${ord(sc)}. Stars can't touch — not even diagonally — so a star can ` +
            `never go here. Place a mark to remember.`,
        }
      }
    }
  }

  // 2. Same region as a placed star
  for (const [sr, sc] of stars) {
    const rid = grid[sr][sc]
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (grid[r][c] !== rid) continue
        if (r === sr && c === sc) continue
        if (state[r][c] !== 'empty') continue
        return {
          category: 'mark-region',
          cell: [r, c],
          action: 'place-mark',
          label: 'Mark region',
          reason:
            `Row ${ord(r)}, column ${ord(c)} is in the same region as the star at ` +
            `row ${ord(sr)}, column ${ord(sc)}. Each region holds exactly one star, ` +
            `so this cell can be marked.`,
        }
      }
    }
  }

  // 3. Same row as a placed star
  for (const [sr, sc] of stars) {
    for (let c = 0; c < n; c++) {
      if (c === sc) continue
      if (state[sr][c] !== 'empty') continue
      return {
        category: 'mark-row',
        cell: [sr, c],
        action: 'place-mark',
        label: 'Mark row',
        reason:
          `Row ${ord(sr)} already has its star at column ${ord(sc)}. ` +
          `Each row holds exactly one star — mark column ${ord(c)} of this row.`,
      }
    }
  }

  // 4. Same column as a placed star
  for (const [sr, sc] of stars) {
    for (let r = 0; r < n; r++) {
      if (r === sr) continue
      if (state[r][sc] !== 'empty') continue
      return {
        category: 'mark-col',
        cell: [r, sc],
        action: 'place-mark',
        label: 'Mark column',
        reason:
          `Column ${ord(sc)} already has its star at row ${ord(sr)}. ` +
          `Each column holds exactly one star — mark row ${ord(r)} of this column.`,
      }
    }
  }

  return null
}

// ── Public API ──────────────────────────────────────────────────────────────

export function deriveHint(puzzle: Puzzle, state: CellState[][]): Hint {
  const { n } = puzzle
  const mask  = eligibilityMask(puzzle, state)
  const placed = placedSets(puzzle, state)

  const everySet =
    placed.rows.size === n &&
    placed.cols.size === n &&
    placed.regions.size === n
  if (everySet) {
    return {
      category: 'already-solved',
      cell: null, action: 'none',
      label: 'Already solved',
      reason: 'Every row, column, and region already has its star. Nice work!',
    }
  }

  // ── 1. Forced region ──
  for (let rid = 0; rid < n; rid++) {
    if (placed.regions.has(rid)) continue
    const cells = eligibleInRegion(puzzle, mask, rid)
    if (cells.length === 0) {
      return {
        category: 'contradiction',
        cell: null, action: 'none',
        label: 'Stuck',
        reason:
          `Region ${rid + 1} has no cells where a star can still go — your marks have ruled them all out. ` +
          `Undo a recent mark or reset and try again.`,
      }
    }
    if (cells.length === 1) {
      const [r, c] = cells[0]
      return {
        category: 'forced-region',
        cell: [r, c], action: 'place-star',
        label: 'Forced region',
        reason:
          `Region ${rid + 1} has exactly one cell where a star can still go: ` +
          `row ${ord(r)}, column ${ord(c)}. Every other cell in that region is either marked, ` +
          `in the same row/column as a placed star, or adjacent to one — so this cell is forced.`,
      }
    }
  }

  // ── 2. Forced row ──
  for (let r = 0; r < n; r++) {
    if (placed.rows.has(r)) continue
    const cells = eligibleInRow(mask, r)
    if (cells.length === 0) {
      return {
        category: 'contradiction',
        cell: null, action: 'none',
        label: 'Stuck',
        reason:
          `Row ${ord(r)} has no cells where a star can still go. ` +
          `Undo a recent mark or reset and try again.`,
      }
    }
    if (cells.length === 1) {
      const [, c] = cells[0]
      return {
        category: 'forced-row',
        cell: [r, c], action: 'place-star',
        label: 'Forced row',
        reason:
          `Row ${ord(r)} only has one valid column left for its star — column ${ord(c)}. ` +
          `Other columns in this row are either marked or blocked by a star above/below.`,
      }
    }
  }

  // ── 3. Forced column ──
  for (let c = 0; c < n; c++) {
    if (placed.cols.has(c)) continue
    const cells = eligibleInCol(mask, c)
    if (cells.length === 0) {
      return {
        category: 'contradiction',
        cell: null, action: 'none',
        label: 'Stuck',
        reason:
          `Column ${ord(c)} has no valid cells left. Undo a recent mark or reset.`,
      }
    }
    if (cells.length === 1) {
      const [r] = cells[0]
      return {
        category: 'forced-col',
        cell: [r, c], action: 'place-star',
        label: 'Forced column',
        reason:
          `Column ${ord(c)} only has one valid row left for its star — row ${ord(r)}. ` +
          `Other rows in this column are either marked or already 'taken' by a region/star.`,
      }
    }
  }

  // ── 4. Suggest a mark from a placed star's eliminations ──
  const markHint = findMarkHint(puzzle, state, placed.stars)
  if (markHint) return markHint

  // ── 5. Fallback: reveal from unique solution ──
  const solution = getSolution(puzzle)
  if (solution) {
    const next = solution.find(([r, c]) => state[r][c] !== 'star')
    if (next) {
      const [r, c] = next
      return {
        category: 'fallback',
        cell: [r, c], action: 'place-star',
        label: 'Solver hint',
        reason:
          `No single forced move follows from the current board — you'll need a 2-step look-ahead ` +
          `(e.g. "if I place here, this region runs out of options"). For now, the next solution star ` +
          `is at row ${ord(r)}, column ${ord(c)}. Try marking impossible cells around it to see why.`,
      }
    }
  }

  return {
    category: 'fallback',
    cell: null, action: 'none',
    label: 'No deduction',
    reason: 'No further deduction available from this state.',
  }
}
