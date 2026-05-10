/**
 * visualize-shimmer.ts — render the completion-shimmer wave as ASCII at a
 * sequence of wall-clock timestamps, so you can sanity-check that:
 *   (a) the bright stripe sweeps L→R within each cell,
 *   (b) the wave emanates outward from the satisfying star (offset 0
 *       lights up first, then offsets 1, 2, … in order),
 *   (c) adjacent cells visibly overlap (no perceptible gap as the
 *       stripe crosses cell boundaries).
 *
 * Each cell is rendered as a 12-character wide column. The bright
 * stripe's screen position is computed from src/lib/shimmer.ts so the
 * picture matches what the browser actually paints. Stripe intensity is
 * shown as a small palette: . (dim base tint), : (mid), * (centred peak).
 *
 * Run with:  npx tsx scripts/visualize-shimmer.ts
 */

import {
  cellShimmerIndex,
  stripeXFrac,
  SHIMMER_CYCLE_MS,
  SHIMMER_STEP_MS,
  shimmerVisibilityWindow,
  BG_IMAGE_OVER_CELL,
  type Completion,
} from '../src/lib/shimmer.js'

const CELL_W = 12   // characters per cell column
const N      = 8    // grid size for the demo

// Mock 8×8 grid with arbitrary region ids — irrelevant for the row /
// column demos. Region demo gets a small custom region.
const grid: number[][] = Array.from({ length: N }, (_, r) =>
  Array.from({ length: N }, (_, c) => Math.floor((r + c) / 2) % N))

function brightnessAt(offset: number, tMs: number): number {
  // Stripe centre, in cell-fraction units.
  const centre = stripeXFrac(offset, tMs)
  // Stripe half-width matches the gradient's bright window. The gradient
  // peaks at 50 % of the image (24 % wide in image-fraction). In cell
  // fractions that's 0.5 × IMG = 0.5 × 2.6 = 1.3, centred on `centre`.
  // For visualization we treat the bright zone as ±0.12 cell-widths
  // around `centre` (the bright peak), with a softer envelope outward.
  const halfWidth = 0.12 * BG_IMAGE_OVER_CELL
  const cellCentre = 0.5
  const dist = Math.abs(cellCentre - centre)
  if (dist > halfWidth + 0.5) return 0
  if (dist < halfWidth) return 1
  // Linear falloff to 0 over the next 0.5 cell-widths
  return Math.max(0, 1 - (dist - halfWidth) / 0.5)
}

function renderCell(offset: number, tMs: number, completed: boolean): string {
  if (!completed) return ' '.repeat(CELL_W)
  const samples = CELL_W
  let out = ''
  for (let i = 0; i < samples; i++) {
    // sample the stripe brightness at fractional x = i / samples within
    // this cell. Approximate by recomputing brightnessAt with a virtual
    // offset that shifts the stripe's reference frame.
    // Equivalent trick: shift t so the cell's centre moves to the sample
    // point.
    const xFrac = (i + 0.5) / samples
    // Map xFrac to a "virtual cell centre" via a shifted bright window:
    const centre = stripeXFrac(offset, tMs)
    const halfWidth = 0.12 * BG_IMAGE_OVER_CELL
    const dist = Math.abs(xFrac - centre)
    let b = 0
    if (dist <= halfWidth) b = 1
    else if (dist <= halfWidth + 0.35) b = 1 - (dist - halfWidth) / 0.35
    if (b > 0.85)      out += '*'
    else if (b > 0.4)  out += ':'
    else if (b > 0.05) out += '.'
    else                out += ' '
  }
  return out
}

function drawRow(label: string, rowOffsets: Array<{ offset: number; completed: boolean }>, tMs: number) {
  const cells = rowOffsets.map(c => renderCell(c.offset, tMs, c.completed))
  const labels = rowOffsets.map(c =>
    (c.completed ? String(c.offset).padStart(2, ' ') : '  ').padEnd(CELL_W, ' '),
  )
  console.log(`${label}  ${cells.map(c => `|${c}`).join('')}|`)
  console.log(`${' '.repeat(label.length)}    ${labels.join(' ')}`)
}

function divider() {
  console.log('─'.repeat(80))
}

function bar(label: string) {
  console.log(`\n${'═'.repeat(80)}\n${label}\n${'═'.repeat(80)}`)
}

// ── Demo 1: a complete row, star at column 3 ────────────────────────────
function demoRow() {
  bar('DEMO 1: row 4 complete, star at (4, 3). Wave should emanate L↔R from col 3.')
  const completion: Completion = {
    rows:    new Map([[4, [4, 3]]]),
    cols:    new Map(),
    regions: new Map(),
  }
  const offsets = Array.from({ length: N }, (_, c) => ({
    offset:    cellShimmerIndex(4, c, grid, completion),
    completed: true,
  }))

  // Sample 6 evenly-spaced timestamps across the time when the wave is
  // most visible (covering offsets 0..N-1).
  const tStart = shimmerVisibilityWindow(0).start
  const tEnd   = shimmerVisibilityWindow(N - 1).end
  const frames = 8
  for (let f = 0; f < frames; f++) {
    const t = tStart + (tEnd - tStart) * (f / (frames - 1))
    divider()
    console.log(`t = ${t.toFixed(0)} ms`)
    drawRow(`row ${4}`, offsets, t)
  }
}

// ── Demo 2: a complete column, star at row 5 ────────────────────────────
function demoCol() {
  bar('DEMO 2: column 4 complete, star at (5, 4). Wave should emanate up/down from row 5.')
  const completion: Completion = {
    rows:    new Map(),
    cols:    new Map([[4, [5, 4]]]),
    regions: new Map(),
  }
  const tStart = shimmerVisibilityWindow(0).start
  const tEnd   = shimmerVisibilityWindow(N - 1).end
  const frames = 6
  for (let f = 0; f < frames; f++) {
    const t = tStart + (tEnd - tStart) * (f / (frames - 1))
    divider()
    console.log(`t = ${t.toFixed(0)} ms  (one cell per row of the column shown below)`)
    for (let r = 0; r < N; r++) {
      const off = cellShimmerIndex(r, 4, grid, completion)
      drawRow(`r${r}`, [{ offset: off, completed: true }], t)
    }
  }
}

// ── Demo 3: a complete region, star at (3, 3) ──────────────────────────
function demoRegion() {
  bar('DEMO 3: a square region around (3, 3) complete. Chebyshev ripple radiates outward.')
  // Carve a 5×5 region around (3, 3) into the grid for the demo. Anything
  // inside this square shares one region id; everywhere else is a junk id.
  const regionId = 99
  const regionGrid: number[][] = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) =>
      (r >= 1 && r <= 5 && c >= 1 && c <= 5) ? regionId : 0))
  const completion: Completion = {
    rows:    new Map(),
    cols:    new Map(),
    regions: new Map([[regionId, [3, 3]]]),
  }
  const tStart = shimmerVisibilityWindow(0).start
  const tEnd   = shimmerVisibilityWindow(4).end
  const frames = 6
  for (let f = 0; f < frames; f++) {
    const t = tStart + (tEnd - tStart) * (f / (frames - 1))
    divider()
    console.log(`t = ${t.toFixed(0)} ms`)
    for (let r = 0; r < N; r++) {
      const cells = Array.from({ length: N }, (_, c) => ({
        offset:    cellShimmerIndex(r, c, regionGrid, completion),
        completed: regionGrid[r][c] === regionId,
      }))
      drawRow(`r${r}`, cells, t)
    }
  }
}

// ── Continuity diagnostic ──────────────────────────────────────────────
function diagnostics() {
  bar('Continuity diagnostic')
  console.log(`SHIMMER_CYCLE_MS  = ${SHIMMER_CYCLE_MS}`)
  console.log(`SHIMMER_STEP_MS   = ${SHIMMER_STEP_MS}`)
  for (let off = 0; off < 5; off++) {
    const w = shimmerVisibilityWindow(off)
    console.log(`offset=${off}: visible ${w.start.toFixed(0)}–${w.end.toFixed(0)} ms ` +
      `(span ${(w.end - w.start).toFixed(0)} ms)`)
  }
  console.log('Adjacent-pair overlap (offset d vs d+1):')
  for (let d = 0; d < 4; d++) {
    const a = shimmerVisibilityWindow(d)
    const b = shimmerVisibilityWindow(d + 1)
    console.log(`  d=${d}↔${d + 1}: overlap = ${(a.end - b.start).toFixed(0)} ms`)
  }
}

diagnostics()
demoRow()
demoCol()
demoRegion()
