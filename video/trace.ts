/**
 * Instrumented depth-first search for 1★ Star Battle.
 *
 * Same idea as src/solver/solver.ts (place one star per unit, backtrack on failure)
 * but it records every move as an event so the video can replay the search:
 *
 *   place    → a star goes down
 *   conflict → forward check found a row / column / region with no room left
 *   remove   → the star comes back off (backtrack)
 *   solved   → every row, column and region holds exactly one star
 *
 * Eliminated cells (same row / column / region as a star, or touching one) are never
 * tried — exactly the dots the game shows as auto-marks — so every star the viewer sees
 * placed is legal at that moment, and every dead end has a visible reason.
 *
 * Two branching strategies:
 *   'row' — classic DFS: fill rows top to bottom, columns left to right.
 *   'mrv' — "most constrained first": branch on whichever unfilled row / column / region
 *           has the fewest open cells. Fewer steps; looks more deliberate.
 */
import type { Puzzle } from '../src/types/puzzle'

export type Cell = [number, number]
export type UnitType = 'row' | 'col' | 'region'
export interface Unit { type: UnitType; index: number }
export type Strategy = 'row' | 'mrv'

export type TraceEvent =
  | { kind: 'place'; row: number; col: number; depth: number }
  | { kind: 'conflict'; unit: Unit }
  | { kind: 'remove'; row: number; col: number; depth: number }
  | { kind: 'solved' }

export interface TraceStats {
  placements: number
  removals: number
  conflicts: number
  maxDepth: number
  /** Placements after the last backtrack — the final, successful run to the solution. */
  finalRun: number
  /** Wall-clock the bare search took, in ms (for the "solved in X ms" stat). */
  cpuMs: number
}

export interface Trace {
  strategy: Strategy
  events: TraceEvent[]
  solution: Cell[]
  stats: TraceStats
}

/** Cells of each unit, precomputed. */
export function unitCells(puzzle: Puzzle, unit: Unit): Cell[] {
  const { n, grid } = puzzle
  const out: Cell[] = []
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (unit.type === 'row' ? r === unit.index
        : unit.type === 'col' ? c === unit.index
        : grid[r][c] === unit.index) out.push([r, c])
    }
  return out
}

/** Every cell a star at (r, c) rules out: its row, column, region and 8 neighbours. */
export function eliminatedBy(puzzle: Puzzle, r: number, c: number): Cell[] {
  const { n, grid } = puzzle
  const out: Cell[] = []
  for (let rr = 0; rr < n; rr++)
    for (let cc = 0; cc < n; cc++) {
      if (rr === r && cc === c) continue
      if (rr === r || cc === c || grid[rr][cc] === grid[r][c]
        || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) out.push([rr, cc])
    }
  return out
}

const UNIT_PRIORITY: Record<UnitType, number> = { region: 0, row: 1, col: 2 }

export function traceDfs(puzzle: Puzzle, strategy: Strategy = 'row', maxEvents = 200_000): Trace {
  const { n, grid } = puzzle
  const t0 = performance.now()

  const elim = new Int16Array(n * n)        // how many stars rule this cell out
  const star = new Uint8Array(n * n)
  const rowUsed = new Uint8Array(n), colUsed = new Uint8Array(n), regUsed = new Uint8Array(n)
  const kills: Cell[][] = []                 // eliminatedBy cache, index r*n+c
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) kills.push(eliminatedBy(puzzle, r, c))

  const units: { unit: Unit; cells: number[] }[] = []
  for (const type of ['region', 'row', 'col'] as const)
    for (let i = 0; i < n; i++)
      units.push({ unit: { type, index: i }, cells: unitCells(puzzle, { type, index: i }).map(([r, c]) => r * n + c) })

  const events: TraceEvent[] = []
  let depth = 0, maxDepth = 0
  const isUsed = (u: Unit) => (u.type === 'row' ? rowUsed : u.type === 'col' ? colUsed : regUsed)[u.index] === 1
  const open = (i: number) => elim[i] === 0 && star[i] === 0

  function place(r: number, c: number) {
    const i = r * n + c
    star[i] = 1; rowUsed[r] = 1; colUsed[c] = 1; regUsed[grid[r][c]] = 1
    for (const [rr, cc] of kills[i]) elim[rr * n + cc]++
    depth++
    maxDepth = Math.max(maxDepth, depth)
    events.push({ kind: 'place', row: r, col: c, depth })
  }
  function remove(r: number, c: number) {
    const i = r * n + c
    star[i] = 0; rowUsed[r] = 0; colUsed[c] = 0; regUsed[grid[r][c]] = 0
    for (const [rr, cc] of kills[i]) elim[rr * n + cc]--
    depth--
    events.push({ kind: 'remove', row: r, col: c, depth })
  }
  /** First unfilled unit left with zero open cells (regions reported first: they read best). */
  function deadUnit(): Unit | null {
    for (const { unit, cells } of units) {
      if (isUsed(unit)) continue
      if (!cells.some(open)) return unit
    }
    return null
  }
  /** Unfilled unit with the fewest open cells (ties → region, row, col, then index). */
  function tightestUnit(): { unit: Unit; cells: number[] } {
    let best: { unit: Unit; cells: number[] } | null = null
    let bestCount = Infinity
    for (const u of units) {
      if (isUsed(u.unit)) continue
      const count = u.cells.reduce((k, i) => k + (open(i) ? 1 : 0), 0)
      if (count < bestCount || (count === bestCount && best
        && UNIT_PRIORITY[u.unit.type] < UNIT_PRIORITY[best.unit.type])) {
        best = u; bestCount = count
      }
    }
    return best!
  }

  function search(): boolean {
    if (depth === n) return true
    if (events.length > maxEvents) throw new Error(`trace exceeded ${maxEvents} events`)
    const candidates = strategy === 'row'
      ? Array.from({ length: n }, (_, c) => depth * n + c)
      : tightestUnit().cells
    for (const i of candidates) {
      if (!open(i)) continue
      const r = Math.floor(i / n), c = i % n
      place(r, c)
      const dead = depth < n ? deadUnit() : null
      if (dead) {
        events.push({ kind: 'conflict', unit: dead })
        remove(r, c)
        continue
      }
      if (search()) return true
      remove(r, c)
    }
    return false
  }

  // Row strategy relies on depth === row index, which holds because rows fill in order.
  const ok = search()
  const cpuMs = performance.now() - t0
  if (!ok) throw new Error('puzzle has no solution')
  events.push({ kind: 'solved' })

  const solution: Cell[] = []
  for (let i = 0; i < n * n; i++) if (star[i]) solution.push([Math.floor(i / n), i % n])

  let lastRemove = -1
  events.forEach((e, k) => { if (e.kind === 'remove') lastRemove = k })
  const stats: TraceStats = {
    placements: events.filter(e => e.kind === 'place').length,
    removals: events.filter(e => e.kind === 'remove').length,
    conflicts: events.filter(e => e.kind === 'conflict').length,
    maxDepth,
    finalRun: events.slice(lastRemove + 1).filter(e => e.kind === 'place').length,
    cpuMs,
  }
  return { strategy, events, solution, stats }
}
