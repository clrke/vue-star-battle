import type { Puzzle, DisplayCellState, HintHighlight, HintStep } from '../types/puzzle'
import { getSolution } from './solver'

/* ============================================================================
   Logical hint engine
   ----------------------------------------------------------------------------
   Tries — in order — to find a deduction the player can make from the *current*
   board state, and explains *why*. Stops at the first hit so each hint reveals
   exactly one step of reasoning, mirroring how a human plays.

   Search order (easiest → most advanced):
      1. CONTRADICTION         — marks/stars already break the puzzle
      2. FORCED-REGION         — region has exactly one eligible cell
      3. FORCED-ROW            — row    has exactly one eligible cell
      4. FORCED-COL            — column has exactly one eligible cell
      5. MARK-ADJACENT         — empty cell next to a placed star
      6. MARK-REGION           — empty cell in the region of a placed star
      7. MARK-ROW              — empty cell in the row    of a placed star
      8. MARK-COL              — empty cell in the column of a placed star
      9. POINTING-REGION       — region's candidates all share a row/column
                                 → eliminate from that row/column elsewhere
     10. CLAIMING-ROW/COL      — row/col candidates all share a region
                                 → eliminate from that region elsewhere
     11. PAIR-CONFINEMENT      — two regions confined to the same 2 rows/cols
                                 (or two rows/cols confined to the same
                                 2 regions) → eliminate elsewhere
     12. COMMON-NEIGHBOR       — region/row/col has 2 candidates; cells in the
                                 8-adj intersection of both are blocked
                                 regardless of which option wins
     13. TRIPLE-CONFINEMENT    — Hall-style N=3 extension of the pair rule:
                                 three regions whose candidate row/col union
                                 is exactly 3 (and mirror) → eliminate elsewhere
     14. FALLBACK              — reveal a cell from the unique solution
   ========================================================================== */

export type HintCategory =
  | 'forced-region'
  | 'forced-row'
  | 'forced-col'
  | 'mark-adjacent'
  | 'mark-region'
  | 'mark-row'
  | 'mark-col'
  | 'pointing-region-row'   // a region's candidates all sit in one row
  | 'pointing-region-col'   // a region's candidates all sit in one column
  | 'claiming-row'          // a row's candidates all sit in one region
  | 'claiming-col'          // a column's candidates all sit in one region
  | 'pair-rows'             // two regions confine their candidates to the same 2 rows
  | 'pair-cols'             // two regions confine their candidates to the same 2 columns
  | 'pair-regions-rows'     // two rows confine their candidates to the same 2 regions
  | 'pair-regions-cols'     // two cols confine their candidates to the same 2 regions
  | 'triple-rows'           // three regions confined to the same 3 rows
  | 'triple-cols'           // three regions confined to the same 3 columns
  | 'triple-regions-rows'   // three rows confined to the same 3 regions
  | 'triple-regions-cols'   // three cols confined to the same 3 regions
  | 'common-neighbor-region' // region has 2 candidates; this cell is 8-adjacent to both
  | 'common-neighbor-row'    // row has 2 candidates; this cell is 8-adjacent to both
  | 'common-neighbor-col'    // col has 2 candidates; this cell is 8-adjacent to both
  | 'squeeze-rows'           // two consecutive rows' eligible cols form exactly 2 non-adjacent cols → claim
  | 'squeeze-cols'           // two consecutive cols' eligible rows form exactly 2 non-adjacent rows → claim
  | 'fish-cols'              // 3 columns confined to the same 3 rows → eliminate other cols in those rows
  | 'fish-rows'              // 3 rows confined to the same 3 cols → eliminate other rows in those cols
  | 'wrong-mark'             // user marked a cell that's actually a star in the unique solution
  | 'wrong-star'             // user placed a star at a cell that's not in the unique solution
  | 'fallback'
  | 'contradiction'
  | 'already-solved'

export type HintAction = 'place-star' | 'place-mark' | 'remove-mark' | 'remove-star' | 'none'

export interface Hint {
  category: HintCategory
  cell: [number, number] | null
  action: HintAction
  /** Plain-English one-liner — kept for backward-compat / accessibility. */
  reason: string
  /** Short tag shown in the UI (e.g. "Forced region"). */
  label: string
  /** Walk-through of the deduction; final step's highlight has the primary cell. */
  steps: HintStep[]
}

const step = (text: string, highlight: HintHighlight = {}): HintStep => ({ text, highlight })

/** Build the "could a star still go here?" mask from the current board. */
function eligibilityMask(puzzle: Puzzle, state: DisplayCellState[][]) {
  const { n, grid } = puzzle
  const possible = Array.from({ length: n }, () => new Array<boolean>(n).fill(true))

  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (state[r][c] === 'marked' || state[r][c] === 'auto-marked') possible[r][c] = false

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

function placedSets(puzzle: Puzzle, state: DisplayCellState[][]) {
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
  state: DisplayCellState[][],
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
            `never go here.`,
          steps: [
            step(
              `There's a star at row ${ord(sr)}, column ${ord(sc)}.`,
              { cells: [[sr, sc]] },
            ),
            step(
              `Stars cannot touch — not even diagonally. So all 8 neighbors of this star are blocked.`,
              { cells: [[sr, sc]] },
            ),
            step(
              `Cell (row ${ord(r)}, column ${ord(c)}) is one of those neighbors. Mark it.`,
              { cells: [[sr, sc]], primaryCell: [r, c] },
            ),
          ],
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
            `row ${ord(sr)}, column ${ord(sc)}. Each region holds exactly one star.`,
          steps: [
            step(
              `Region ${rid + 1} already has its star at row ${ord(sr)}, column ${ord(sc)}.`,
              { regions: [rid], cells: [[sr, sc]] },
            ),
            step(
              `Each region holds exactly one star, so every other cell in Region ${rid + 1} can be ruled out.`,
              { regions: [rid] },
            ),
            step(
              `Mark cell (row ${ord(r)}, column ${ord(c)}).`,
              { regions: [rid], primaryCell: [r, c] },
            ),
          ],
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
          `Row ${ord(sr)} already has its star at column ${ord(sc)}. Each row holds exactly one star.`,
        steps: [
          step(
            `Row ${ord(sr)} already has its star at column ${ord(sc)}.`,
            { rows: [sr], cells: [[sr, sc]] },
          ),
          step(
            `Each row holds exactly one star — every other column in this row can be ruled out.`,
            { rows: [sr] },
          ),
          step(
            `Mark cell (row ${ord(sr)}, column ${ord(c)}).`,
            { rows: [sr], primaryCell: [sr, c] },
          ),
        ],
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
          `Column ${ord(sc)} already has its star at row ${ord(sr)}. Each column holds exactly one star.`,
        steps: [
          step(
            `Column ${ord(sc)} already has its star at row ${ord(sr)}.`,
            { cols: [sc], cells: [[sr, sc]] },
          ),
          step(
            `Each column holds exactly one star — every other row in this column can be ruled out.`,
            { cols: [sc] },
          ),
          step(
            `Mark cell (row ${ord(r)}, column ${ord(sc)}).`,
            { cols: [sc], primaryCell: [r, sc] },
          ),
        ],
      }
    }
  }

  return null
}

// ── Confinement reasoning (pointing / claiming) ─────────────────────────────

/**
 * Pointing & claiming, named by analogy with Sudoku:
 *
 *   POINTING — a region's eligible cells all sit on a single row (or column).
 *   That row's star is therefore *forced* into this region, so any other-region
 *   cell in that row can be marked.
 *
 *   CLAIMING — a row (or column) has all of its eligible cells inside a single
 *   region. That region's star is therefore forced into this row, so any other
 *   cell of the same region in a different row can be marked.
 *
 * These are the strongest non-trial deductions in 1★ Star Battle and unlock
 * most "no progress" situations after the easy moves are exhausted.
 */
function findConfinementHint(
  puzzle: Puzzle,
  state: DisplayCellState[][],
  mask: boolean[][],
  placed: ReturnType<typeof placedSets>,
): Hint | null {
  const { n, grid } = puzzle

  // ── Pointing: a region's candidates all share a row or column ──
  for (let rid = 0; rid < n; rid++) {
    if (placed.regions.has(rid)) continue
    const cells = eligibleInRegion(puzzle, mask, rid)
    if (cells.length < 2) continue   // 0/1 handled by forced-region

    const rows = new Set(cells.map(([r]) => r))
    const cols = new Set(cells.map(([, c]) => c))

    if (rows.size === 1) {
      const row = cells[0][0]
      // Eliminate empty cells in `row` that belong to a different region
      for (let c = 0; c < n; c++) {
        if (grid[row][c] === rid) continue
        if (state[row][c] !== 'empty') continue
        if (!mask[row][c]) continue   // already eliminated by something else
        return {
          category: 'pointing-region-row',
          cell: [row, c], action: 'place-mark',
          label: 'Region locks row',
          reason:
            `Every cell where Region ${rid + 1}'s star could still go is on row ${ord(row)}.`,
          steps: [
            step(
              `Look at Region ${rid + 1}.`,
              { regions: [rid] },
            ),
            step(
              `Every cell where its star could still go is on row ${ord(row)}.`,
              { regions: [rid], rows: [row] },
            ),
            step(
              `So row ${ord(row)}'s one star MUST come from Region ${rid + 1}. No other region may use row ${ord(row)}.`,
              { regions: [rid], rows: [row] },
            ),
            step(
              `Cell (row ${ord(row)}, column ${ord(c)}) is on row ${ord(row)} but in a different region. Mark it.`,
              { regions: [rid], rows: [row], primaryCell: [row, c] },
            ),
          ],
        }
      }
    }

    if (cols.size === 1) {
      const col = cells[0][1]
      for (let r = 0; r < n; r++) {
        if (grid[r][col] === rid) continue
        if (state[r][col] !== 'empty') continue
        if (!mask[r][col]) continue
        return {
          category: 'pointing-region-col',
          cell: [r, col], action: 'place-mark',
          label: 'Region locks column',
          reason:
            `Every cell where Region ${rid + 1}'s star could still go is in column ${ord(col)}.`,
          steps: [
            step(
              `Look at Region ${rid + 1}.`,
              { regions: [rid] },
            ),
            step(
              `Every cell where its star could still go is in column ${ord(col)}.`,
              { regions: [rid], cols: [col] },
            ),
            step(
              `So column ${ord(col)}'s one star MUST come from Region ${rid + 1}.`,
              { regions: [rid], cols: [col] },
            ),
            step(
              `Cell (row ${ord(r)}, column ${ord(col)}) is in column ${ord(col)} but a different region. Mark it.`,
              { regions: [rid], cols: [col], primaryCell: [r, col] },
            ),
          ],
        }
      }
    }
  }

  // ── Claiming: a row's candidates all share a region ──
  for (let r = 0; r < n; r++) {
    if (placed.rows.has(r)) continue
    const cells = eligibleInRow(mask, r)
    if (cells.length < 2) continue

    const regionsInRow = new Set(cells.map(([, c]) => grid[r][c]))
    if (regionsInRow.size !== 1) continue
    const rid = grid[r][cells[0][1]]

    // Eliminate empty cells in `rid` that are NOT in row r
    for (let rr = 0; rr < n; rr++) {
      if (rr === r) continue
      for (let c = 0; c < n; c++) {
        if (grid[rr][c] !== rid) continue
        if (state[rr][c] !== 'empty') continue
        if (!mask[rr][c]) continue
        return {
          category: 'claiming-row',
          cell: [rr, c], action: 'place-mark',
          label: 'Row claims region',
          reason:
            `Every column where row ${ord(r)}'s star could still go is inside Region ${rid + 1}.`,
          steps: [
            step(
              `Look at Row ${ord(r)}.`,
              { rows: [r] },
            ),
            step(
              `Every column where its star could still go is inside Region ${rid + 1}.`,
              { rows: [r], regions: [rid] },
            ),
            step(
              `So Region ${rid + 1}'s star MUST come from row ${ord(r)}. Cells in this region on other rows are out.`,
              { regions: [rid], rows: [r] },
            ),
            step(
              `Cell (row ${ord(rr)}, column ${ord(c)}) is in Region ${rid + 1} but on a different row. Mark it.`,
              { regions: [rid], rows: [r], primaryCell: [rr, c] },
            ),
          ],
        }
      }
    }
  }

  // ── Claiming: a column's candidates all share a region ──
  for (let c = 0; c < n; c++) {
    if (placed.cols.has(c)) continue
    const cells = eligibleInCol(mask, c)
    if (cells.length < 2) continue

    const regionsInCol = new Set(cells.map(([r]) => grid[r][c]))
    if (regionsInCol.size !== 1) continue
    const rid = grid[cells[0][0]][c]

    for (let r = 0; r < n; r++) {
      for (let cc = 0; cc < n; cc++) {
        if (cc === c) continue
        if (grid[r][cc] !== rid) continue
        if (state[r][cc] !== 'empty') continue
        if (!mask[r][cc]) continue
        return {
          category: 'claiming-col',
          cell: [r, cc], action: 'place-mark',
          label: 'Column claims region',
          reason:
            `Every row where column ${ord(c)}'s star could still go is inside Region ${rid + 1}.`,
          steps: [
            step(
              `Look at Column ${ord(c)}.`,
              { cols: [c] },
            ),
            step(
              `Every row where its star could still go is inside Region ${rid + 1}.`,
              { cols: [c], regions: [rid] },
            ),
            step(
              `So Region ${rid + 1}'s star MUST come from column ${ord(c)}. Cells in this region in other columns are out.`,
              { regions: [rid], cols: [c] },
            ),
            step(
              `Cell (row ${ord(r)}, column ${ord(cc)}) is in Region ${rid + 1} but on a different column. Mark it.`,
              { regions: [rid], cols: [c], primaryCell: [r, cc] },
            ),
          ],
        }
      }
    }
  }

  return null
}

// ── Pair-confinement reasoning (advanced) ───────────────────────────────────

/**
 * "If two regions both confine their candidates to the same 2 rows
 *  (or 2 columns), those rows belong exclusively to those two regions."
 *
 * This is the strongest commonly-applicable deduction in 1★ Star Battle
 * before falling back to hypothetical reasoning. Symmetrically, if two
 * rows (or two columns) confine their candidates to the same 2 regions,
 * those regions belong to those rows.
 */
function findPairConfinementHint(
  puzzle: Puzzle,
  state: DisplayCellState[][],
  mask: boolean[][],
  placed: ReturnType<typeof placedSets>,
): Hint | null {
  const { n, grid } = puzzle

  /* ── A. Region-pair locking row/column pairs ─────────────────────── */

  // Pre-compute candidate row/col sets for each unplaced region
  const regionRows: (Set<number> | null)[] = new Array(n).fill(null)
  const regionCols: (Set<number> | null)[] = new Array(n).fill(null)
  for (let rid = 0; rid < n; rid++) {
    if (placed.regions.has(rid)) continue
    const rows = new Set<number>(), cols = new Set<number>()
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (grid[r][c] === rid && mask[r][c]) {
          rows.add(r); cols.add(c)
        }
    regionRows[rid] = rows
    regionCols[rid] = cols
  }

  const setEq = (a: Set<number>, b: Set<number>) =>
    a.size === b.size && [...a].every(x => b.has(x))

  // Two regions confined to the same 2 rows
  for (let a = 0; a < n; a++) {
    const rA = regionRows[a]
    if (!rA || rA.size !== 2) continue
    for (let b = a + 1; b < n; b++) {
      const rB = regionRows[b]
      if (!rB || rB.size !== 2 || !setEq(rA, rB)) continue
      const [r1, r2] = [...rA].sort()
      // Eliminate empty cells in those rows belonging to OTHER regions
      for (const row of [r1, r2]) {
        for (let c = 0; c < n; c++) {
          const rid = grid[row][c]
          if (rid === a || rid === b) continue
          if (state[row][c] !== 'empty' || !mask[row][c]) continue
          return {
            category: 'pair-rows',
            cell: [row, c], action: 'place-mark',
            label: 'Region pair locks rows',
            reason:
              `Regions ${a + 1} and ${b + 1} can both only place stars on rows ${ord(r1)} or ${ord(r2)}.`,
            steps: [
              step(
                `Look at Regions ${a + 1} and ${b + 1}.`,
                { regions: [a, b] },
              ),
              step(
                `Both can ONLY place their stars on rows ${ord(r1)} or ${ord(r2)}.`,
                { regions: [a, b], rows: [r1, r2] },
              ),
              step(
                `So those two rows are reserved for those two regions — no other region may use them.`,
                { rows: [r1, r2], regions: [a, b] },
              ),
              step(
                `Cell (row ${ord(row)}, column ${ord(c)}) is on row ${ord(row)} but in Region ${rid + 1}. Mark it.`,
                { rows: [r1, r2], regions: [a, b], primaryCell: [row, c] },
              ),
            ],
          }
        }
      }
    }
  }

  // Two regions confined to the same 2 columns
  for (let a = 0; a < n; a++) {
    const cA = regionCols[a]
    if (!cA || cA.size !== 2) continue
    for (let b = a + 1; b < n; b++) {
      const cB = regionCols[b]
      if (!cB || cB.size !== 2 || !setEq(cA, cB)) continue
      const [c1, c2] = [...cA].sort()
      for (const col of [c1, c2]) {
        for (let r = 0; r < n; r++) {
          const rid = grid[r][col]
          if (rid === a || rid === b) continue
          if (state[r][col] !== 'empty' || !mask[r][col]) continue
          return {
            category: 'pair-cols',
            cell: [r, col], action: 'place-mark',
            label: 'Region pair locks columns',
            reason:
              `Regions ${a + 1} and ${b + 1} can both only place stars in columns ${ord(c1)} or ${ord(c2)}.`,
            steps: [
              step(
                `Look at Regions ${a + 1} and ${b + 1}.`,
                { regions: [a, b] },
              ),
              step(
                `Both can ONLY place their stars in columns ${ord(c1)} or ${ord(c2)}.`,
                { regions: [a, b], cols: [c1, c2] },
              ),
              step(
                `Those two columns are reserved for those two regions.`,
                { cols: [c1, c2], regions: [a, b] },
              ),
              step(
                `Cell (row ${ord(r)}, column ${ord(col)}) is in Region ${rid + 1} on column ${ord(col)}. Mark it.`,
                { cols: [c1, c2], regions: [a, b], primaryCell: [r, col] },
              ),
            ],
          }
        }
      }
    }
  }

  /* ── B. Row-pair / col-pair locking region pairs ─────────────────── */

  const rowRegions: (Set<number> | null)[] = new Array(n).fill(null)
  const colRegions: (Set<number> | null)[] = new Array(n).fill(null)
  for (let r = 0; r < n; r++) {
    if (placed.rows.has(r)) { rowRegions[r] = null; continue }
    const s = new Set<number>()
    for (let c = 0; c < n; c++) if (mask[r][c]) s.add(grid[r][c])
    rowRegions[r] = s
  }
  for (let c = 0; c < n; c++) {
    if (placed.cols.has(c)) { colRegions[c] = null; continue }
    const s = new Set<number>()
    for (let r = 0; r < n; r++) if (mask[r][c]) s.add(grid[r][c])
    colRegions[c] = s
  }

  // Two rows whose candidates lie inside the same 2 regions
  for (let a = 0; a < n; a++) {
    const rA = rowRegions[a]
    if (!rA || rA.size !== 2) continue
    for (let b = a + 1; b < n; b++) {
      const rB = rowRegions[b]
      if (!rB || rB.size !== 2 || !setEq(rA, rB)) continue
      const [g1, g2] = [...rA].sort()
      // Eliminate empty cells of regions g1/g2 in OTHER rows
      for (const rid of [g1, g2]) {
        for (let r = 0; r < n; r++) {
          if (r === a || r === b) continue
          for (let c = 0; c < n; c++) {
            if (grid[r][c] !== rid) continue
            if (state[r][c] !== 'empty' || !mask[r][c]) continue
            return {
              category: 'pair-regions-rows',
              cell: [r, c], action: 'place-mark',
              label: 'Row pair locks regions',
              reason:
                `Rows ${ord(a)} and ${ord(b)} can both only place stars in regions ${g1 + 1} or ${g2 + 1}.`,
              steps: [
                step(
                  `Look at Rows ${ord(a)} and ${ord(b)}.`,
                  { rows: [a, b] },
                ),
                step(
                  `Both can ONLY place their stars in regions ${g1 + 1} or ${g2 + 1}.`,
                  { rows: [a, b], regions: [g1, g2] },
                ),
                step(
                  `Those two regions are reserved for those two rows.`,
                  { regions: [g1, g2], rows: [a, b] },
                ),
                step(
                  `Cell (row ${ord(r)}, column ${ord(c)}) is in Region ${rid + 1} but on a different row. Mark it.`,
                  { regions: [g1, g2], rows: [a, b], primaryCell: [r, c] },
                ),
              ],
            }
          }
        }
      }
    }
  }

  // Two columns whose candidates lie inside the same 2 regions
  for (let a = 0; a < n; a++) {
    const cA = colRegions[a]
    if (!cA || cA.size !== 2) continue
    for (let b = a + 1; b < n; b++) {
      const cB = colRegions[b]
      if (!cB || cB.size !== 2 || !setEq(cA, cB)) continue
      const [g1, g2] = [...cA].sort()
      for (const rid of [g1, g2]) {
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) {
            if (c === a || c === b) continue
            if (grid[r][c] !== rid) continue
            if (state[r][c] !== 'empty' || !mask[r][c]) continue
            return {
              category: 'pair-regions-cols',
              cell: [r, c], action: 'place-mark',
              label: 'Column pair locks regions',
              reason:
                `Columns ${ord(a)} and ${ord(b)} can both only place stars in regions ${g1 + 1} or ${g2 + 1}.`,
              steps: [
                step(
                  `Look at Columns ${ord(a)} and ${ord(b)}.`,
                  { cols: [a, b] },
                ),
                step(
                  `Both can ONLY place their stars in regions ${g1 + 1} or ${g2 + 1}.`,
                  { cols: [a, b], regions: [g1, g2] },
                ),
                step(
                  `Those two regions are reserved for those two columns.`,
                  { regions: [g1, g2], cols: [a, b] },
                ),
                step(
                  `Cell (row ${ord(r)}, column ${ord(c)}) is in Region ${rid + 1} but on a different column. Mark it.`,
                  { regions: [g1, g2], cols: [a, b], primaryCell: [r, c] },
                ),
              ],
            }
          }
        }
      }
    }
  }

  return null
}

// ── Common-neighbor elimination ─────────────────────────────────────────────

/**
 * If a region/row/column has exactly TWO eligible cells A and B, the star
 * MUST land on one of them. Any empty cell that is 8-adjacent to BOTH A and B
 * therefore can't hold a star — whichever option wins, this cell is touching
 * a star. Mark it.
 *
 * Geometrically: candidates A and B must be within Chebyshev distance ≤ 2 for
 * any common neighbor to exist; otherwise no overlap.
 */
function findCommonNeighborHint(
  puzzle: Puzzle,
  state: DisplayCellState[][],
  mask: boolean[][],
  placed: ReturnType<typeof placedSets>,
): Hint | null {
  const { n } = puzzle

  /** First empty cell in the 8-adjacency intersection of two cells, if any. */
  function commonNeighbor(cands: [number, number][]): [number, number] | null {
    const [[r1, c1], [r2, c2]] = cands
    const minR = Math.max(0, Math.max(r1, r2) - 1)
    const maxR = Math.min(n - 1, Math.min(r1, r2) + 1)
    const minC = Math.max(0, Math.max(c1, c2) - 1)
    const maxC = Math.min(n - 1, Math.min(c1, c2) + 1)
    if (minR > maxR || minC > maxC) return null
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if ((r === r1 && c === c1) || (r === r2 && c === c2)) continue
        if (state[r][c] !== 'empty') continue
        return [r, c]
      }
    }
    return null
  }

  // ── Region with exactly 2 candidates ──
  for (let rid = 0; rid < n; rid++) {
    if (placed.regions.has(rid)) continue
    const cands = eligibleInRegion(puzzle, mask, rid)
    if (cands.length !== 2) continue
    const cn = commonNeighbor(cands)
    if (!cn) continue
    const [[r1, c1], [r2, c2]] = cands
    const [tr, tc] = cn
    return {
      category: 'common-neighbor-region',
      cell: [tr, tc], action: 'place-mark',
      label: 'Both options block this',
      reason:
        `Region ${rid + 1}'s star will go to (row ${ord(r1)}, col ${ord(c1)}) or ` +
        `(row ${ord(r2)}, col ${ord(c2)}). Either way, (row ${ord(tr)}, col ${ord(tc)}) is adjacent.`,
      steps: [
        step(`Look at Region ${rid + 1}.`, { regions: [rid] }),
        step(
          `Only two cells in this region could still hold its star: (row ${ord(r1)}, col ${ord(c1)}) or (row ${ord(r2)}, col ${ord(c2)}).`,
          { regions: [rid], cells: [[r1, c1], [r2, c2]] },
        ),
        step(
          `Cell (row ${ord(tr)}, col ${ord(tc)}) is 8-adjacent to BOTH options. Whichever one wins, this cell is touching a star.`,
          { regions: [rid], cells: [[r1, c1], [r2, c2]], primaryCell: [tr, tc] },
        ),
        step(
          `Mark it — it can never hold a star.`,
          { regions: [rid], cells: [[r1, c1], [r2, c2]], primaryCell: [tr, tc] },
        ),
      ],
    }
  }

  // ── Row with exactly 2 candidates ──
  for (let r = 0; r < n; r++) {
    if (placed.rows.has(r)) continue
    const cands = eligibleInRow(mask, r)
    if (cands.length !== 2) continue
    const cn = commonNeighbor(cands)
    if (!cn) continue
    const [[, c1], [, c2]] = cands
    const [tr, tc] = cn
    return {
      category: 'common-neighbor-row',
      cell: [tr, tc], action: 'place-mark',
      label: 'Both options block this',
      reason:
        `Row ${ord(r)}'s star will go to column ${ord(c1)} or ${ord(c2)}. ` +
        `Either way, (row ${ord(tr)}, col ${ord(tc)}) is adjacent.`,
      steps: [
        step(`Look at Row ${ord(r)}.`, { rows: [r] }),
        step(
          `Only two columns could hold this row's star: ${ord(c1)} or ${ord(c2)}.`,
          { rows: [r], cells: cands },
        ),
        step(
          `Cell (row ${ord(tr)}, col ${ord(tc)}) is 8-adjacent to BOTH options. Whichever wins, this cell is touching a star.`,
          { rows: [r], cells: cands, primaryCell: [tr, tc] },
        ),
        step(
          `Mark it.`,
          { rows: [r], cells: cands, primaryCell: [tr, tc] },
        ),
      ],
    }
  }

  // ── Column with exactly 2 candidates ──
  for (let c = 0; c < n; c++) {
    if (placed.cols.has(c)) continue
    const cands = eligibleInCol(mask, c)
    if (cands.length !== 2) continue
    const cn = commonNeighbor(cands)
    if (!cn) continue
    const [[r1], [r2]] = cands
    const [tr, tc] = cn
    return {
      category: 'common-neighbor-col',
      cell: [tr, tc], action: 'place-mark',
      label: 'Both options block this',
      reason:
        `Column ${ord(c)}'s star will go to row ${ord(r1)} or ${ord(r2)}. ` +
        `Either way, (row ${ord(tr)}, col ${ord(tc)}) is adjacent.`,
      steps: [
        step(`Look at Column ${ord(c)}.`, { cols: [c] }),
        step(
          `Only two rows could hold this column's star: ${ord(r1)} or ${ord(r2)}.`,
          { cols: [c], cells: cands },
        ),
        step(
          `Cell (row ${ord(tr)}, col ${ord(tc)}) is 8-adjacent to BOTH options. Whichever wins, this cell is touching a star.`,
          { cols: [c], cells: cands, primaryCell: [tr, tc] },
        ),
        step(
          `Mark it.`,
          { cols: [c], cells: cands, primaryCell: [tr, tc] },
        ),
      ],
    }
  }

  return null
}

// ── Triple confinement (Hall-style N=3 generalization of pair) ──────────────

/**
 * If three regions can together only place their stars in three rows, those
 * three rows are reserved for those three regions — even when no two of them
 * are individually confined to a 2-row pair. Same idea for columns, and the
 * mirror direction (three rows/cols confined to three regions).
 *
 * Distinct from pair confinement in that the *individual* regions might each
 * have 2 or 3 candidate rows; only the *union of the trio* equals exactly 3.
 */
function findTripleConfinementHint(
  puzzle: Puzzle,
  state: DisplayCellState[][],
  mask: boolean[][],
  placed: ReturnType<typeof placedSets>,
): Hint | null {
  const { n, grid } = puzzle

  type Item = { id: number; set: Set<number> }

  const regionRows: Item[] = []
  const regionCols: Item[] = []
  for (let rid = 0; rid < n; rid++) {
    if (placed.regions.has(rid)) continue
    const rows = new Set<number>(), cols = new Set<number>()
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (grid[r][c] === rid && mask[r][c]) { rows.add(r); cols.add(c) }
    regionRows.push({ id: rid, set: rows })
    regionCols.push({ id: rid, set: cols })
  }
  const rowRegions: Item[] = []
  const colRegions: Item[] = []
  for (let r = 0; r < n; r++) {
    if (placed.rows.has(r)) continue
    const s = new Set<number>()
    for (let c = 0; c < n; c++) if (mask[r][c]) s.add(grid[r][c])
    rowRegions.push({ id: r, set: s })
  }
  for (let c = 0; c < n; c++) {
    if (placed.cols.has(c)) continue
    const s = new Set<number>()
    for (let r = 0; r < n; r++) if (mask[r][c]) s.add(grid[r][c])
    colRegions.push({ id: c, set: s })
  }

  /** Iterate every triple in `items` whose union has exactly 3 elements. */
  function tryTriples(
    items: Item[],
    onTriple: (objIds: number[], targetIds: number[]) => Hint | null,
  ): Hint | null {
    for (let i = 0; i < items.length; i++) {
      const a = items[i]; if (a.set.size === 0 || a.set.size > 3) continue
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]; if (b.set.size === 0 || b.set.size > 3) continue
        for (let k = j + 1; k < items.length; k++) {
          const c = items[k]; if (c.set.size === 0 || c.set.size > 3) continue
          const union = new Set<number>([...a.set, ...b.set, ...c.set])
          if (union.size !== 3) continue
          const objIds    = [a.id, b.id, c.id].sort((x, y) => x - y)
          const targetIds = [...union].sort((x, y) => x - y)
          const h = onTriple(objIds, targetIds)
          if (h) return h
        }
      }
    }
    return null
  }

  const list = (xs: number[]) => xs.map(x => x + 1).join(', ')

  // ── A. Three regions lock three rows ──
  const a = tryTriples(regionRows, (regions, rows) => {
    for (const row of rows) {
      for (let c = 0; c < n; c++) {
        const rid = grid[row][c]
        if (regions.includes(rid)) continue
        if (state[row][c] !== 'empty' || !mask[row][c]) continue
        return {
          category: 'triple-rows',
          cell: [row, c], action: 'place-mark',
          label: 'Region triple locks rows',
          reason:
            `Regions ${list(regions)} together can only place stars on rows ${list(rows)}.`,
          steps: [
            step(`Look at Regions ${list(regions)}.`, { regions }),
            step(
              `Together, all their candidates fit in rows ${list(rows)}.`,
              { regions, rows },
            ),
            step(
              `Three regions, three rows — those rows are reserved for those regions.`,
              { regions, rows },
            ),
            step(
              `Cell (row ${ord(row)}, column ${ord(c)}) is on row ${ord(row)} but in Region ${rid + 1}. Mark it.`,
              { regions, rows, primaryCell: [row, c] },
            ),
          ],
        }
      }
    }
    return null
  })
  if (a) return a

  // ── B. Three regions lock three columns ──
  const b = tryTriples(regionCols, (regions, cols) => {
    for (const col of cols) {
      for (let r = 0; r < n; r++) {
        const rid = grid[r][col]
        if (regions.includes(rid)) continue
        if (state[r][col] !== 'empty' || !mask[r][col]) continue
        return {
          category: 'triple-cols',
          cell: [r, col], action: 'place-mark',
          label: 'Region triple locks columns',
          reason:
            `Regions ${list(regions)} together can only place stars in columns ${list(cols)}.`,
          steps: [
            step(`Look at Regions ${list(regions)}.`, { regions }),
            step(
              `Together, all their candidates fit in columns ${list(cols)}.`,
              { regions, cols },
            ),
            step(
              `Three regions, three columns — those columns are reserved for those regions.`,
              { regions, cols },
            ),
            step(
              `Cell (row ${ord(r)}, column ${ord(col)}) is in column ${ord(col)} but in Region ${rid + 1}. Mark it.`,
              { regions, cols, primaryCell: [r, col] },
            ),
          ],
        }
      }
    }
    return null
  })
  if (b) return b

  // ── C. Three rows lock three regions ──
  const c = tryTriples(rowRegions, (rows, regions) => {
    for (const rid of regions) {
      for (let r = 0; r < n; r++) {
        if (rows.includes(r)) continue
        for (let cc = 0; cc < n; cc++) {
          if (grid[r][cc] !== rid) continue
          if (state[r][cc] !== 'empty' || !mask[r][cc]) continue
          return {
            category: 'triple-regions-rows',
            cell: [r, cc], action: 'place-mark',
            label: 'Row triple locks regions',
            reason:
              `Rows ${list(rows)} together can only place stars in regions ${list(regions)}.`,
            steps: [
              step(`Look at Rows ${list(rows)}.`, { rows }),
              step(
                `Together, all their candidates fit in regions ${list(regions)}.`,
                { rows, regions },
              ),
              step(
                `Three rows, three regions — those regions are reserved for those rows.`,
                { rows, regions },
              ),
              step(
                `Cell (row ${ord(r)}, column ${ord(cc)}) is in Region ${rid + 1} but on a different row. Mark it.`,
                { rows, regions, primaryCell: [r, cc] },
              ),
            ],
          }
        }
      }
    }
    return null
  })
  if (c) return c

  // ── D. Three columns lock three regions ──
  const d = tryTriples(colRegions, (cols, regions) => {
    for (const rid of regions) {
      for (let r = 0; r < n; r++) {
        for (let cc = 0; cc < n; cc++) {
          if (cols.includes(cc)) continue
          if (grid[r][cc] !== rid) continue
          if (state[r][cc] !== 'empty' || !mask[r][cc]) continue
          return {
            category: 'triple-regions-cols',
            cell: [r, cc], action: 'place-mark',
            label: 'Column triple locks regions',
            reason:
              `Columns ${list(cols)} together can only place stars in regions ${list(regions)}.`,
            steps: [
              step(`Look at Columns ${list(cols)}.`, { cols }),
              step(
                `Together, all their candidates fit in regions ${list(regions)}.`,
                { cols, regions },
              ),
              step(
                `Three columns, three regions — those regions are reserved for those columns.`,
                { cols, regions },
              ),
              step(
                `Cell (row ${ord(r)}, column ${ord(cc)}) is in Region ${rid + 1} but on a different column. Mark it.`,
                { cols, regions, primaryCell: [r, cc] },
              ),
            ],
          }
        }
      }
    }
    return null
  })
  if (d) return d

  return null
}

// ── Squeeze (row-pair / col-pair confinement) ─────────────────────────────────

/**
 * For two consecutive rows where neither has a placed star:
 * If the union of eligible columns is exactly 2 and those columns are NOT
 * adjacent (so they can each host a star without touching), those two columns
 * are "claimed" by these rows — any cell in those columns in other rows can be
 * eliminated.
 *
 * If the union is exactly 2 adjacent columns, that is a contradiction (two
 * stars in a 2×2 block would touch).
 *
 * Symmetric for consecutive columns.
 */
function findSqueezeHint(
  puzzle: Puzzle,
  state: DisplayCellState[][],
  mask: boolean[][],
  placed: ReturnType<typeof placedSets>,
): Hint | null {
  const { n } = puzzle

  // ── Squeeze-rows ──
  for (let r = 0; r < n - 1; r++) {
    if (placed.rows.has(r) || placed.rows.has(r + 1)) continue

    const colSet = new Set<number>()
    for (let c = 0; c < n; c++) {
      if (mask[r][c] || mask[r + 1][c]) colSet.add(c)
    }
    if (colSet.size !== 2) continue

    const [c1, c2] = [...colSet].sort((a, b) => a - b)

    if (Math.abs(c1 - c2) === 1) {
      // Adjacent columns → 2×2 block → contradiction
      return {
        category: 'contradiction',
        cell: null, action: 'none',
        label: 'Squeeze conflict',
        reason:
          `Rows ${ord(r)} and ${ord(r + 1)} each need a star, but their only eligible columns ` +
          `(${ord(c1)} and ${ord(c2)}) form a 2×2 block that can hold at most one star.`,
        steps: [
          step(
            `Rows ${ord(r)} and ${ord(r + 1)} each need a star, but together their eligible cells are confined to columns ${ord(c1)} and ${ord(c2)}.`,
            { rows: [r, r + 1], cols: [c1, c2] },
          ),
          step(
            `Columns ${ord(c1)} and ${ord(c2)} are adjacent — two stars in a 2×2 block would touch. This is a contradiction. Undo a recent mark.`,
            { rows: [r, r + 1], cols: [c1, c2] },
          ),
        ],
      }
    }

    // Non-adjacent: c1 and c2 are "claimed" by rows r, r+1
    // Eliminate any other row's eligible cell in col c1 or c2
    for (const col of [c1, c2]) {
      for (let rr = 0; rr < n; rr++) {
        if (rr === r || rr === r + 1) continue
        if (!mask[rr][col]) continue
        if (state[rr][col] !== 'empty') continue
        return {
          category: 'squeeze-rows',
          cell: [rr, col], action: 'place-mark',
          label: 'Squeeze (rows)',
          reason:
            `Rows ${ord(r)} and ${ord(r + 1)} can only place stars in columns ${ord(c1)} and ${ord(c2)}, so those columns are claimed.`,
          steps: [
            step(
              `Look at rows ${ord(r)} and ${ord(r + 1)}. Each needs a star, and together their eligible cells are confined to just 2 columns: ${ord(c1)} and ${ord(c2)}.`,
              { rows: [r, r + 1], cols: [c1, c2] },
            ),
            step(
              `Since those two rows must each place a star in one of those two columns, columns ${ord(c1)} and ${ord(c2)} are fully claimed by rows ${ord(r)} and ${ord(r + 1)}.`,
              { rows: [r, r + 1], cols: [c1, c2] },
            ),
            step(
              `No other row can place its star in column ${ord(col)}. Mark this cell.`,
              { rows: [r, r + 1], cols: [c1, c2], primaryCell: [rr, col] },
            ),
          ],
        }
      }
    }
  }

  // ── Squeeze-cols ──
  for (let c = 0; c < n - 1; c++) {
    if (placed.cols.has(c) || placed.cols.has(c + 1)) continue

    const rowSet = new Set<number>()
    for (let r = 0; r < n; r++) {
      if (mask[r][c] || mask[r][c + 1]) rowSet.add(r)
    }
    if (rowSet.size !== 2) continue

    const [r1, r2] = [...rowSet].sort((a, b) => a - b)

    if (Math.abs(r1 - r2) === 1) {
      // Adjacent rows → 2×2 block → contradiction
      return {
        category: 'contradiction',
        cell: null, action: 'none',
        label: 'Squeeze conflict',
        reason:
          `Columns ${ord(c)} and ${ord(c + 1)} each need a star, but their only eligible rows ` +
          `(${ord(r1)} and ${ord(r2)}) form a 2×2 block that can hold at most one star.`,
        steps: [
          step(
            `Columns ${ord(c)} and ${ord(c + 1)} each need a star, but together their eligible cells are confined to rows ${ord(r1)} and ${ord(r2)}.`,
            { cols: [c, c + 1], rows: [r1, r2] },
          ),
          step(
            `Rows ${ord(r1)} and ${ord(r2)} are adjacent — two stars in a 2×2 block would touch. This is a contradiction. Undo a recent mark.`,
            { cols: [c, c + 1], rows: [r1, r2] },
          ),
        ],
      }
    }

    // Non-adjacent: r1 and r2 are "claimed" by cols c, c+1
    for (const row of [r1, r2]) {
      for (let cc = 0; cc < n; cc++) {
        if (cc === c || cc === c + 1) continue
        if (!mask[row][cc]) continue
        if (state[row][cc] !== 'empty') continue
        return {
          category: 'squeeze-cols',
          cell: [row, cc], action: 'place-mark',
          label: 'Squeeze (columns)',
          reason:
            `Columns ${ord(c)} and ${ord(c + 1)} can only place stars in rows ${ord(r1)} and ${ord(r2)}, so those rows are claimed.`,
          steps: [
            step(
              `Look at columns ${ord(c)} and ${ord(c + 1)}. Each needs a star, and together their eligible cells are confined to just 2 rows: ${ord(r1)} and ${ord(r2)}.`,
              { cols: [c, c + 1], rows: [r1, r2] },
            ),
            step(
              `Since those two columns must each place a star in one of those two rows, rows ${ord(r1)} and ${ord(r2)} are fully claimed by columns ${ord(c)} and ${ord(c + 1)}.`,
              { cols: [c, c + 1], rows: [r1, r2] },
            ),
            step(
              `No other column can place its star in row ${ord(row)}. Mark this cell.`,
              { cols: [c, c + 1], rows: [r1, r2], primaryCell: [row, cc] },
            ),
          ],
        }
      }
    }
  }

  return null
}

// ── Fish (k=3, Swordfish-analog) ──────────────────────────────────────────────

/**
 * Fish at k=3 (Swordfish): if 3 columns have ALL their eligible cells confined
 * to the same set of 3 rows, those 3 rows are "owned" by those 3 columns.
 * Any other column that has eligible cells in those rows can be eliminated.
 *
 * Symmetric for 3 rows confined to 3 columns.
 */
function findFishHint(
  puzzle: Puzzle,
  state: DisplayCellState[][],
  mask: boolean[][],
  placed: ReturnType<typeof placedSets>,
): Hint | null {
  const { n } = puzzle

  const list3 = (xs: number[]) => xs.map(x => ord(x)).join(', ')

  // ── Fish-cols: 3 columns confined to the same 3 rows ──
  const unplacedCols: number[] = []
  for (let c = 0; c < n; c++) {
    if (!placed.cols.has(c)) unplacedCols.push(c)
  }

  for (let i = 0; i < unplacedCols.length; i++) {
    const c1 = unplacedCols[i]
    const rows1 = new Set<number>()
    for (let r = 0; r < n; r++) if (mask[r][c1]) rows1.add(r)
    if (rows1.size === 0 || rows1.size > 3) continue

    for (let j = i + 1; j < unplacedCols.length; j++) {
      const c2 = unplacedCols[j]
      const rows2 = new Set<number>()
      for (let r = 0; r < n; r++) if (mask[r][c2]) rows2.add(r)
      if (rows2.size === 0 || rows2.size > 3) continue

      for (let k = j + 1; k < unplacedCols.length; k++) {
        const c3 = unplacedCols[k]
        const rows3 = new Set<number>()
        for (let r = 0; r < n; r++) if (mask[r][c3]) rows3.add(r)
        if (rows3.size === 0 || rows3.size > 3) continue

        const unionRows = new Set<number>([...rows1, ...rows2, ...rows3])
        if (unionRows.size !== 3) continue

        const fishCols = [c1, c2, c3].sort((a, b) => a - b)
        const fishRows = [...unionRows].sort((a, b) => a - b)

        // Look for eliminations: eligible cells in fishRows but NOT in fishCols
        for (const row of fishRows) {
          for (let c = 0; c < n; c++) {
            if (fishCols.includes(c)) continue
            if (!mask[row][c]) continue
            if (state[row][c] !== 'empty') continue
            return {
              category: 'fish-cols',
              cell: [row, c], action: 'place-mark',
              label: 'Fish (columns)',
              reason:
                `Columns ${list3(fishCols)} can only place stars in rows ${list3(fishRows)}, ` +
                `so no other column can use those rows.`,
              steps: [
                step(
                  `Look at Columns ${list3(fishCols)}. Each must hold a star, and all their candidates lie in just 3 rows: ${list3(fishRows)}.`,
                  { cols: fishCols },
                ),
                step(
                  `Those 3 columns' stars must occupy those 3 rows — one per row.`,
                  { rows: fishRows, cols: fishCols },
                ),
                step(
                  `So in row ${ord(row)}, no star can go in any column other than ${list3(fishCols)}. Mark this cell.`,
                  { rows: [row], primaryCell: [row, c] },
                ),
              ],
            }
          }
        }
      }
    }
  }

  // ── Fish-rows: 3 rows confined to the same 3 columns ──
  const unplacedRows: number[] = []
  for (let r = 0; r < n; r++) {
    if (!placed.rows.has(r)) unplacedRows.push(r)
  }

  for (let i = 0; i < unplacedRows.length; i++) {
    const r1 = unplacedRows[i]
    const cols1 = new Set<number>()
    for (let c = 0; c < n; c++) if (mask[r1][c]) cols1.add(c)
    if (cols1.size === 0 || cols1.size > 3) continue

    for (let j = i + 1; j < unplacedRows.length; j++) {
      const r2 = unplacedRows[j]
      const cols2 = new Set<number>()
      for (let c = 0; c < n; c++) if (mask[r2][c]) cols2.add(c)
      if (cols2.size === 0 || cols2.size > 3) continue

      for (let k = j + 1; k < unplacedRows.length; k++) {
        const r3 = unplacedRows[k]
        const cols3 = new Set<number>()
        for (let c = 0; c < n; c++) if (mask[r3][c]) cols3.add(c)
        if (cols3.size === 0 || cols3.size > 3) continue

        const unionCols = new Set<number>([...cols1, ...cols2, ...cols3])
        if (unionCols.size !== 3) continue

        const fishRows = [r1, r2, r3].sort((a, b) => a - b)
        const fishCols = [...unionCols].sort((a, b) => a - b)

        // Look for eliminations: eligible cells in fishCols but NOT in fishRows
        for (const col of fishCols) {
          for (let r = 0; r < n; r++) {
            if (fishRows.includes(r)) continue
            if (!mask[r][col]) continue
            if (state[r][col] !== 'empty') continue
            return {
              category: 'fish-rows',
              cell: [r, col], action: 'place-mark',
              label: 'Fish (rows)',
              reason:
                `Rows ${list3(fishRows)} can only place stars in columns ${list3(fishCols)}, ` +
                `so no other row can use those columns.`,
              steps: [
                step(
                  `Look at Rows ${list3(fishRows)}. Each must hold a star, and all their candidates lie in just 3 columns: ${list3(fishCols)}.`,
                  { rows: fishRows },
                ),
                step(
                  `Those 3 rows' stars must occupy those 3 columns — one per column.`,
                  { rows: fishRows, cols: fishCols },
                ),
                step(
                  `So in column ${ord(col)}, no star can go in any row other than ${list3(fishRows)}. Mark this cell.`,
                  { cols: [col], primaryCell: [r, col] },
                ),
              ],
            }
          }
        }
      }
    }
  }

  return null
}

// ── Public API ──────────────────────────────────────────────────────────────

export function deriveHint(puzzle: Puzzle, state: DisplayCellState[][]): Hint {
  const { n } = puzzle
  const mask  = eligibilityMask(puzzle, state)
  const placed = placedSets(puzzle, state)

  // ── 0. Visible violation check ────────────────────────────────────────────
  // Detect stars that are already conflicting (same row/col/region or adjacent).
  // The eligibility-mask logic assumes one star per row/col/region, so it would
  // otherwise skip those lines and return a misleading "next move" hint.
  {
    const stars = placed.stars
    const rowCount    = new Map<number, [number, number]>()
    const colCount    = new Map<number, [number, number]>()
    const regionCount = new Map<number, [number, number]>()

    for (const [r, c] of stars) {
      const rid = puzzle.grid[r][c]

      if (rowCount.has(r)) {
        const [pr, pc] = rowCount.get(r)!
        return {
          category: 'contradiction', cell: null, action: 'none',
          label: 'Conflict',
          reason: `Two stars share Row ${ord(r)}: columns ${ord(pc)} and ${ord(c)}.`,
          steps: [step(
            `Two stars share Row ${ord(r)} — columns ${ord(pc)} and ${ord(c)}. Each row can hold only one star. Undo one of them.`,
            { rows: [r], cells: [[pr, pc], [r, c]] },
          )],
        }
      }
      rowCount.set(r, [r, c])

      if (colCount.has(c)) {
        const [pr, pc] = colCount.get(c)!
        return {
          category: 'contradiction', cell: null, action: 'none',
          label: 'Conflict',
          reason: `Two stars share Column ${ord(c)}: rows ${ord(pr)} and ${ord(r)}.`,
          steps: [step(
            `Two stars share Column ${ord(c)} — rows ${ord(pr)} and ${ord(r)}. Each column can hold only one star. Undo one of them.`,
            { cols: [c], cells: [[pr, pc], [r, c]] },
          )],
        }
      }
      colCount.set(c, [r, c])

      if (regionCount.has(rid)) {
        const [pr, pc] = regionCount.get(rid)!
        return {
          category: 'contradiction', cell: null, action: 'none',
          label: 'Conflict',
          reason: `Two stars share Region ${rid + 1}.`,
          steps: [step(
            `Two stars share Region ${rid + 1} — at (${ord(pr)}, ${ord(pc)}) and (${ord(r)}, ${ord(c)}). Each region holds exactly one star. Undo one of them.`,
            { regions: [rid], cells: [[pr, pc], [r, c]] },
          )],
        }
      }
      regionCount.set(rid, [r, c])
    }

    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const [r1, c1] = stars[i], [r2, c2] = stars[j]
        if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) {
          return {
            category: 'contradiction', cell: null, action: 'none',
            label: 'Conflict',
            reason: `Stars at (${ord(r1)}, ${ord(c1)}) and (${ord(r2)}, ${ord(c2)}) are adjacent.`,
            steps: [step(
              `Stars at row ${ord(r1)} col ${ord(c1)} and row ${ord(r2)} col ${ord(c2)} are touching — stars may not be adjacent (including diagonally). Undo one of them.`,
              { cells: [[r1, c1], [r2, c2]] },
            )],
          }
        }
      }
    }
  }

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
      steps: [step('Every row, column, and region already has its star. Nice work!')],
    }
  }

  // ── 0b. Wrong stars / wrong marks ─────────────────────────────────────────
  // Compare the user's placements against the unique solution. If a star sits
  // on a non-solution cell, or a mark sits on a solution cell, no logical
  // deduction below can be trusted — the player must undo first.
  // Wrong stars are checked before wrong marks (a stray star can cascade
  // auto-marks onto solution cells, masking the real issue).
  {
    const solution = getSolution(puzzle)
    if (solution) {
      const solSet = new Set(solution.map(([r, c]) => `${r},${c}`))

      for (const [r, c] of placed.stars) {
        if (!solSet.has(`${r},${c}`)) {
          return {
            category: 'wrong-star', cell: [r, c], action: 'remove-star',
            label: 'Wrong star',
            reason: `The star at row ${ord(r)}, column ${ord(c)} doesn't belong here.`,
            steps: [
              step(`You've placed a star at row ${ord(r)}, column ${ord(c)}.`,
                { primaryCell: [r, c] }),
              step(`But the unique solution doesn't put a star here. Remove this star and try again.`,
                { primaryCell: [r, c] }),
            ],
          }
        }
      }

      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (state[r][c] === 'marked' && solSet.has(`${r},${c}`)) {
            return {
              category: 'wrong-mark', cell: [r, c], action: 'remove-mark',
              label: 'Wrong mark',
              reason: `You've marked row ${ord(r)}, column ${ord(c)} as impossible, but a star actually goes there.`,
              steps: [
                step(`You've marked row ${ord(r)}, column ${ord(c)} as impossible.`,
                  { primaryCell: [r, c] }),
                step(`But the unique solution places a star at this exact cell. Remove this mark — it's blocking you from finding the right move.`,
                  { primaryCell: [r, c] }),
              ],
            }
          }
        }
      }
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
          `Region ${rid + 1} has no cells where a star can still go — your marks have ruled them all out.`,
        steps: [
          step(
            `Region ${rid + 1} has no cells where a star can still go — your marks have over-constrained it. Undo a recent mark or reset.`,
            { regions: [rid] },
          ),
        ],
      }
    }
    if (cells.length === 1) {
      const [r, c] = cells[0]
      return {
        category: 'forced-region',
        cell: [r, c], action: 'place-star',
        label: 'Forced region',
        reason:
          `Region ${rid + 1} has exactly one cell where a star can still go: row ${ord(r)}, column ${ord(c)}.`,
        steps: [
          step(
            `Look at Region ${rid + 1}. Each region holds exactly one star.`,
            { regions: [rid] },
          ),
          step(
            `Every cell in this region except one is blocked — by a mark, a star sharing its row or column, or an adjacent star.`,
            { regions: [rid] },
          ),
          step(
            `Only row ${ord(r)}, column ${ord(c)} remains. Place the star here.`,
            { regions: [rid], primaryCell: [r, c] },
          ),
        ],
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
        reason: `Row ${ord(r)} has no cells where a star can still go.`,
        steps: [
          step(
            `Row ${ord(r)} has no cells where a star can still go. Undo a recent mark or reset.`,
            { rows: [r] },
          ),
        ],
      }
    }
    if (cells.length === 1) {
      const [, c] = cells[0]
      return {
        category: 'forced-row',
        cell: [r, c], action: 'place-star',
        label: 'Forced row',
        reason: `Row ${ord(r)} only has one valid column left — column ${ord(c)}.`,
        steps: [
          step(
            `Look at Row ${ord(r)}. Each row holds exactly one star.`,
            { rows: [r] },
          ),
          step(
            `All columns in this row are blocked except one — by marks, stars in the same column, or adjacency.`,
            { rows: [r] },
          ),
          step(
            `Only column ${ord(c)} remains. Place the star here.`,
            { rows: [r], primaryCell: [r, c] },
          ),
        ],
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
        reason: `Column ${ord(c)} has no valid cells left.`,
        steps: [
          step(
            `Column ${ord(c)} has no valid cells left. Undo a recent mark or reset.`,
            { cols: [c] },
          ),
        ],
      }
    }
    if (cells.length === 1) {
      const [r] = cells[0]
      return {
        category: 'forced-col',
        cell: [r, c], action: 'place-star',
        label: 'Forced column',
        reason: `Column ${ord(c)} only has one valid row left — row ${ord(r)}.`,
        steps: [
          step(
            `Look at Column ${ord(c)}. Each column holds exactly one star.`,
            { cols: [c] },
          ),
          step(
            `All rows in this column are blocked except one — by marks, stars in the same row, or adjacency.`,
            { cols: [c] },
          ),
          step(
            `Only row ${ord(r)} remains. Place the star here.`,
            { cols: [c], primaryCell: [r, c] },
          ),
        ],
      }
    }
  }

  // ── 4. Suggest a mark from a placed star's eliminations ──
  const markHint = findMarkHint(puzzle, state, placed.stars)
  if (markHint) return markHint

  // ── 5. Pointing / claiming (advanced confinement reasoning) ──
  const advanced = findConfinementHint(puzzle, state, mask, placed)
  if (advanced) return advanced

  // ── 6. Pair confinement (two regions or two lines locking each other) ──
  const pair = findPairConfinementHint(puzzle, state, mask, placed)
  if (pair) return pair

  // ── 7. Common-neighbor elimination (2-candidate intersection) ──
  const cn = findCommonNeighborHint(puzzle, state, mask, placed)
  if (cn) return cn

  // ── 8. Triple confinement (Hall-style N=3 generalization) ──
  const triple = findTripleConfinementHint(puzzle, state, mask, placed)
  if (triple) return triple

  // ── 9. Squeeze (row/col-pair confinement to 2 columns/rows) ──
  const squeeze = findSqueezeHint(puzzle, state, mask, placed)
  if (squeeze) return squeeze

  // ── 10. Fish k=3 (Swordfish-analog) ──
  const fish = findFishHint(puzzle, state, mask, placed)
  if (fish) return fish

  // ── 11. Fallback: reveal from unique solution ──
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
          `No single forced move follows from the current board — you'll need a 2-step look-ahead. ` +
          `The next solution star is at row ${ord(r)}, column ${ord(c)}.`,
        steps: [
          step(
            `No single forced deduction is available from the current board.`,
          ),
          step(
            `You'd need a 2-step look-ahead (e.g. "if I place here, that region runs out of options").`,
          ),
          step(
            `The next star in the unique solution is at row ${ord(r)}, column ${ord(c)}. Place it, then mark cells around it to find the next move.`,
            { primaryCell: [r, c] },
          ),
        ],
      }
    }
  }

  return {
    category: 'fallback',
    cell: null, action: 'none',
    label: 'No deduction',
    reason: 'No further deduction available from this state.',
    steps: [step('No further deduction available from this state.')],
  }
}
