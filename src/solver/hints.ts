import type { Puzzle, DisplayCellState } from '../types/puzzle'
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
     12. TRIPLE-CONFINEMENT    — Hall-style N=3 extension of the pair rule:
                                 three regions whose candidate row/col union
                                 is exactly 3 (and mirror) → eliminate elsewhere
     13. FALLBACK              — reveal a cell from the unique solution
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
            `Every cell where region ${rid + 1}'s star could still go is on row ${ord(row)}. ` +
            `So row ${ord(row)}'s one star *must* come from region ${rid + 1} — ` +
            `which means row ${ord(row)}, column ${ord(c)} (a different region) cannot have one. Mark it.`,
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
            `Every cell where region ${rid + 1}'s star could still go is in column ${ord(col)}. ` +
            `So column ${ord(col)}'s one star *must* come from region ${rid + 1} — ` +
            `which means row ${ord(r)}, column ${ord(col)} (a different region) cannot have one. Mark it.`,
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
            `Every column where row ${ord(r)}'s star could still go is inside region ${rid + 1}. ` +
            `So region ${rid + 1}'s one star *must* come from row ${ord(r)} — ` +
            `which means row ${ord(rr)}, column ${ord(c)} (same region, different row) cannot have one. Mark it.`,
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
            `Every row where column ${ord(c)}'s star could still go is inside region ${rid + 1}. ` +
            `So region ${rid + 1}'s one star *must* come from column ${ord(c)} — ` +
            `which means row ${ord(r)}, column ${ord(cc)} (same region, different column) cannot have one. Mark it.`,
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
              `Regions ${a + 1} and ${b + 1} can both *only* place their stars on rows ${ord(r1)} or ${ord(r2)}. ` +
              `That means those two rows are reserved for those two regions — no other region may use them. ` +
              `Cell (row ${ord(row)}, column ${ord(c)}) is in region ${rid + 1}, so it can't have a star. Mark it.`,
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
              `Regions ${a + 1} and ${b + 1} can both *only* place their stars in columns ${ord(c1)} or ${ord(c2)}. ` +
              `That means those two columns are reserved for those two regions. Cell (row ${ord(r)}, column ${ord(col)}) ` +
              `is in region ${rid + 1}, so it can't have a star. Mark it.`,
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
                `Rows ${ord(a)} and ${ord(b)} can both *only* place their stars in regions ${g1 + 1} or ${g2 + 1}. ` +
                `Those two regions are reserved for those two rows. Cell (row ${ord(r)}, column ${ord(c)}) is in ` +
                `region ${rid + 1} but on a different row, so it can't have a star. Mark it.`,
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
                `Columns ${ord(a)} and ${ord(b)} can both *only* place their stars in regions ${g1 + 1} or ${g2 + 1}. ` +
                `Those two regions are reserved for those two columns. Cell (row ${ord(r)}, column ${ord(c)}) is in ` +
                `region ${rid + 1} but on a different column, so it can't have a star. Mark it.`,
            }
          }
        }
      }
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
            `Regions ${list(regions)} together can only place their stars on rows ${list(rows)}. ` +
            `Those three rows are reserved for those three regions — no other region may use them. ` +
            `Cell (row ${ord(row)}, column ${ord(c)}) is in region ${rid + 1}, so it can't have a star. Mark it.`,
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
            `Regions ${list(regions)} together can only place their stars in columns ${list(cols)}. ` +
            `Those three columns are reserved for those three regions. Cell (row ${ord(r)}, column ${ord(col)}) ` +
            `is in region ${rid + 1}, so it can't have a star. Mark it.`,
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
              `Rows ${list(rows)} together can only place their stars in regions ${list(regions)}. ` +
              `Those three regions are reserved for those three rows. Cell (row ${ord(r)}, column ${ord(cc)}) ` +
              `is in region ${rid + 1} but on a different row, so it can't have a star. Mark it.`,
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
              `Columns ${list(cols)} together can only place their stars in regions ${list(regions)}. ` +
              `Those three regions are reserved for those three columns. Cell (row ${ord(r)}, column ${ord(cc)}) ` +
              `is in region ${rid + 1} but on a different column, so it can't have a star. Mark it.`,
          }
        }
      }
    }
    return null
  })
  if (d) return d

  return null
}

// ── Public API ──────────────────────────────────────────────────────────────

export function deriveHint(puzzle: Puzzle, state: DisplayCellState[][]): Hint {
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

  // ── 5. Pointing / claiming (advanced confinement reasoning) ──
  const advanced = findConfinementHint(puzzle, state, mask, placed)
  if (advanced) return advanced

  // ── 6. Pair confinement (two regions or two lines locking each other) ──
  const pair = findPairConfinementHint(puzzle, state, mask, placed)
  if (pair) return pair

  // ── 7. Triple confinement (Hall-style N=3 generalization) ──
  const triple = findTripleConfinementHint(puzzle, state, mask, placed)
  if (triple) return triple

  // ── 8. Fallback: reveal from unique solution ──
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
