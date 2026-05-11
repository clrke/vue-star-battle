/**
 * visualize-shimmer.ts — render the completion-shimmer wave as ASCII at
 * a sequence of wall-clock timestamps, using the actual shimmer.ts math
 * so the picture matches what the browser paints.
 *
 * The key thing to look at: the bright band should read as one
 * continuous diagonal sweep across cell boundaries, with adjacent cells
 * picking up exactly where their neighbour left off — both horizontally
 * (cell at col+1 lags by step) AND vertically (cell at row+1 lags by
 * step × tan(tilt)).
 *
 * Run with:  npx tsx scripts/visualize-shimmer.ts
 */

import {
  cellShimmerIndex,
  imageLeftAt,
  imageLeftAtCell,
  IMG_CELLS,
  SHIMMER_CYCLE_MS,
  SHIMMER_STEP_MS,
  SHIMMER_TILT_DEG,
  bandPeakTime,
} from '../src/lib/shimmer.js'

const CELL_W = 10   // characters per cell column
const N      = 8    // grid size for the demo

/** Brightness 0-1 at sample (xFrac, yFrac) within the cell at the given
 *  shimmer index, at wall-clock time t. Re-implements the brightness of
 *  the diagonal CSS gradient at stops 47-50-53 with a 115° axis. */
function brightnessAt(shimmerIndex: number, t: number, xFrac: number, yFrac: number): number {
  const imgLeft = imageLeftAt(shimmerIndex, t)
  const imageX = xFrac - imgLeft                              // 0..IMG cell-widths
  const imageXFrac = imageX / IMG_CELLS                       // 0..1 along image x

  // For the diagonal axis projection, compose with image-y (= cont-y).
  const tilt = SHIMMER_TILT_DEG * Math.PI / 180
  // Projection onto 115° axis, normalised to image-axis-length:
  //   along axis (image-frac units) = imageX × cos(tilt) + imageY × sin(tilt)
  //   image-axis-length (in same units) ≈ IMG_CELLS × cos(tilt) (axis is mostly horizontal)
  // For the visualization we sample a single y so the imageXFrac already
  // captures most of the variation; we ignore yFrac except to confirm
  // the bright peak shifts with y.
  void imageXFrac  // mark used
  void yFrac

  // Use 2D gradient: projection = imageX × cos + imageY × sin, normalised.
  const projection = imageX * Math.cos(tilt) + yFrac * Math.sin(tilt)
  const axisLength = IMG_CELLS * Math.cos(tilt)
  const f = projection / axisLength

  let alpha: number
  if (f < 0 || f > 1)        alpha = 0
  else if (f < 0.47)         alpha = 0.08
  else if (f < 0.50)         alpha = 0.08 + (f - 0.47) / 0.03 * (0.52 - 0.08)
  else if (f < 0.53)         alpha = 0.52 - (f - 0.50) / 0.03 * (0.52 - 0.08)
  else                       alpha = 0.08
  return alpha + 0.14
}

/** Render one cell as a (CELL_W × 2) ASCII tile so vertical tilt is visible. */
function renderCellTile(row: number, col: number, t: number): string[] {
  const idx = cellShimmerIndex(row, col)
  const lines: string[] = ['', '']
  for (let y = 0; y < 2; y++) {
    const yFrac = (y + 0.5) / 2
    for (let i = 0; i < CELL_W; i++) {
      const xFrac = (i + 0.5) / CELL_W
      const b = brightnessAt(idx, t, xFrac, yFrac)
      lines[y] += b > 0.55 ? '*' : b > 0.40 ? ':' : b > 0.25 ? '.' : ' '
    }
  }
  return lines
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
  console.log(`SHIMMER_TILT_DEG  = ${SHIMMER_TILT_DEG}`)
  const tan = Math.tan(SHIMMER_TILT_DEG * Math.PI / 180)
  console.log(`tan(tilt)         = ${tan.toFixed(4)}`)
  console.log(`Wave through ${N} cells (row): ${(N * SHIMMER_STEP_MS).toFixed(0)} ms`)
  console.log(`Wave through ${N} cells (col): ${(N * SHIMMER_STEP_MS * tan).toFixed(0)} ms\n`)

  console.log('Continuity sample at t=400 ms — image-left for cells along a row:')
  for (let c = 0; c <= 5; c++) {
    const l = imageLeftAtCell(0, c, 400)
    const lNext = imageLeftAtCell(0, c + 1, 400)
    console.log(`  (0,${c}): image-left = ${l.toFixed(4)}  (next − this = ${(lNext - l).toFixed(4)}, expect -1)`)
  }
  console.log('Continuity sample — image-left for cells along a column:')
  for (let r = 0; r <= 5; r++) {
    const l = imageLeftAtCell(r, 0, 400)
    const lNext = imageLeftAtCell(r + 1, 0, 400)
    console.log(`  (${r},0): image-left = ${l.toFixed(4)}  (next − this = ${(lNext - l).toFixed(4)}, expect ${(-tan).toFixed(4)})`)
  }
}

function demoRow() {
  bar('DEMO 1: row 0 — wave sweeps diagonally across (tilt is visible top vs bottom).')
  const frames = 7
  const tEnd = bandPeakTime(cellShimmerIndex(0, N - 1)) + 100
  for (let f = 0; f < frames; f++) {
    const t = tEnd * f / (frames - 1)
    dividerLine()
    console.log(`t = ${t.toFixed(0)} ms`)
    const tiles = Array.from({ length: N }, (_, c) => renderCellTile(0, c, t))
    for (let y = 0; y < 2; y++) {
      console.log(`  ${tiles.map(t => `|${t[y]}`).join('')}|`)
    }
  }
}

function demoCol() {
  bar('DEMO 2: column 0 — wave also travels DOWN, with a smaller per-row delay because tan(tilt) < 1.')
  const frames = 6
  const tEnd = bandPeakTime(cellShimmerIndex(N - 1, 0)) + 100
  for (let f = 0; f < frames; f++) {
    const t = tEnd * f / (frames - 1)
    dividerLine()
    console.log(`t = ${t.toFixed(0)} ms`)
    for (let r = 0; r < N; r++) {
      const tile = renderCellTile(r, 0, t)
      console.log(`  r${r} top |${tile[0]}|`)
      console.log(`  r${r} bot |${tile[1]}|`)
    }
  }
}

diagnostics()
demoRow()
demoCol()
