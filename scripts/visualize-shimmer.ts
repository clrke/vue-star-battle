/**
 * visualize-shimmer.ts — render the completion-shimmer wave as ASCII at
 * a sequence of wall-clock timestamps, using the actual shimmer.ts math
 * so the picture matches what the browser paints.
 *
 * The key thing to look at is whether the bright band reads as one
 * continuous moving block across cell boundaries (it should, with the
 * positive delay step = cycle/(IMG-1)) — or as separate bands per
 * cell (it would, without the carefully-tuned step).
 *
 * Run with:  npx tsx scripts/visualize-shimmer.ts
 */

import {
  cellShimmerIndex,
  imageLeftAt,
  bandAbsXAt,
  IMG_CELLS,
  SHIMMER_CYCLE_MS,
  SHIMMER_STEP_MS,
  bandPeakTime,
  type Completion,
} from '../src/lib/shimmer.js'

const CELL_W = 10   // characters per cell column
const N      = 8    // grid size for the demo

// Dummy grid (region ids irrelevant for row/column demos).
const grid: number[][] = Array.from({ length: N }, (_, r) =>
  Array.from({ length: N }, (_, c) => Math.floor((r + c) / 2) % N))

/** Brightness 0-1 at sample x (in cell-fraction) for the cell at the
 *  given shimmer offset, at wall-clock time t. Re-implements the
 *  effective brightness of the CSS gradient at stops 47-50-53. */
function brightnessAtX(offset: number, t: number, xFrac: number): number {
  // image-x at this point in this cell: xFrac − imageLeft.
  const imgLeft = imageLeftAt(offset, t)
  const imgX = (xFrac - imgLeft) / IMG_CELLS     // 0..1 in image-fraction
  // CSS gradient stops, in image-fraction:
  //   0.00 – 0.47: alpha 0.08
  //   0.47 – 0.50: ramp 0.08 → 0.52
  //   0.50 – 0.53: ramp 0.52 → 0.08
  //   0.53 – 1.00: alpha 0.08
  let alpha: number
  if (imgX < 0 || imgX > 1)        alpha = 0
  else if (imgX < 0.47)            alpha = 0.08
  else if (imgX < 0.50)            alpha = 0.08 + (imgX - 0.47) / 0.03 * (0.52 - 0.08)
  else if (imgX < 0.53)            alpha = 0.52 - (imgX - 0.50) / 0.03 * (0.52 - 0.08)
  else                             alpha = 0.08
  return alpha + 0.14   // plus the static base tint
}

function renderCellRow(offset: number, t: number, completed: boolean): string {
  if (!completed) return ' '.repeat(CELL_W)
  let out = ''
  for (let i = 0; i < CELL_W; i++) {
    const xFrac = (i + 0.5) / CELL_W
    const b = brightnessAtX(offset, t, xFrac)
    if (b > 0.55)      out += '*'
    else if (b > 0.40) out += ':'
    else if (b > 0.25) out += '.'
    else                out += ' '
  }
  return out
}

function dividerLine() { console.log('─'.repeat(80)) }
function bar(label: string) {
  console.log(`\n${'═'.repeat(80)}\n${label}\n${'═'.repeat(80)}`)
}

function diagnostics() {
  bar('Constants + continuity check')
  console.log(`IMG_CELLS         = ${IMG_CELLS}`)
  console.log(`SHIMMER_CYCLE_MS  = ${SHIMMER_CYCLE_MS}`)
  console.log(`SHIMMER_STEP_MS   = ${SHIMMER_STEP_MS}`)
  console.log(`Wave through ${N} cells: ${(N * SHIMMER_STEP_MS).toFixed(0)} ms\n`)

  console.log('Continuity sample — image-left for adjacent offsets at t=400 ms:')
  for (let d = 0; d <= 5; d++) {
    const l = imageLeftAt(d, 400)
    const next = imageLeftAt(d + 1, 400)
    console.log(`  offset ${d}: image-left = ${l.toFixed(4)} cells   ` +
      `(next − this = ${(next - l).toFixed(4)}, expect -1)`)
  }
}

function demoRow() {
  bar('DEMO 1: row complete (star at col 3). Wave sweeps L→R as one band.')
  const completion: Completion = {
    rows:    new Map([[0, [0, 3]]]),
    cols:    new Map(),
    regions: new Map(),
  }

  // Frames spaced so we see the band traversing the row.
  const frames = 9
  const tEnd = bandPeakTime(N - 1) + 100
  for (let f = 0; f < frames; f++) {
    const t = (tEnd) * f / (frames - 1)
    dividerLine()
    const bandX = bandAbsXAt(0, t)
    console.log(`t = ${t.toFixed(0)} ms   (band abs-x = ${bandX.toFixed(2)})`)
    let line = '      '
    for (let c = 0; c < N; c++) {
      const off = cellShimmerIndex(0, c, grid, completion)
      line += `|${renderCellRow(off, t, true)}`
    }
    line += '|'
    console.log(line)
  }
}

function demoCol() {
  bar('DEMO 2: column complete (star at row 4). Wave sweeps T→B as one band.')
  const completion: Completion = {
    rows:    new Map(),
    cols:    new Map([[0, [4, 0]]]),
    regions: new Map(),
  }
  const frames = 6
  const tEnd = bandPeakTime(N - 1) + 100
  for (let f = 0; f < frames; f++) {
    const t = tEnd * f / (frames - 1)
    dividerLine()
    console.log(`t = ${t.toFixed(0)} ms`)
    for (let r = 0; r < N; r++) {
      const off = cellShimmerIndex(r, 0, grid, completion)
      console.log(`  r${r}  |${renderCellRow(off, t, true)}|`)
    }
  }
}

diagnostics()
demoRow()
demoCol()
