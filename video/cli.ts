/**
 * Star Battle solver videos — one command from nothing to a finished MP4.
 *
 *   npm run video -- [--size 8] [--seed 123] [--out output/video.mp4]
 *   npm run video -- --puzzle output/daily/<file>.json      re-render a saved puzzle
 *   npm run video -- --still 0,5,30 --out /tmp/frames        PNG stills, no encode
 *   npm run video:daily                                      dated render for the upload cron
 *
 * Every render writes a JSON sidecar (puzzle grid, seeds, stats) next to the MP4, so any
 * video can be reproduced exactly with --puzzle.
 */
import { parseArgs } from 'node:util'
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'
import type { Puzzle } from '../src/types/puzzle'
import { traceDfs, type Trace } from './trace'
import { buildTimeline, type Timeline } from './timeline'
import { buildSceneModel } from './render/model'
import { SceneRenderer } from './render/scene'
import { W, H } from './render/theme'
import { selectPuzzle } from './select'
import { composeScore } from './score'
import { encodeVideo, encodePreview } from './encode'
import { hashSeed, mulberry32, pick } from './rng'

const KEYS = [-3, -2, 0, 2, 3] // A, B♭, C, D, E♭
// 9×9+ confused viewers (Clarke 2026-10-14): 5×5 – 8×8 only, equal odds.
const SIZE_WEIGHTS: [number, number][] = [[5, 0.25], [6, 0.25], [7, 0.25], [8, 0.25]]

export interface RenderJob {
  seed: number
  size?: number
  puzzle?: Puzzle
  out: string
  fps: number
  /** Exact video length, seconds. */
  duration: number
  puzzleNumber?: number
  audio: boolean
  stills?: number[]
  quiet?: boolean
  /** Also write <out>-preview.mp4 (720p/30fps, chat-sized). */
  preview?: boolean
}

export interface RenderResult { out: string; sidecar: string; puzzle: Puzzle; trace: Trace; timeline: Timeline; seconds: number }

const log = (quiet: boolean | undefined, s: string) => { if (!quiet) console.error(s) }

function pickSize(seed: number): number {
  const r = mulberry32(hashSeed(seed, 'size'))()
  let acc = 0
  for (const [n, w] of SIZE_WEIGHTS) { acc += w; if (r < acc) return n }
  return 8
}

export async function renderVideo(job: RenderJob): Promise<RenderResult> {
  const t0 = performance.now()
  let puzzle: Puzzle, trace: Trace, puzzleSeed: number | undefined
  if (job.puzzle) {
    puzzle = job.puzzle
    trace = traceDfs(puzzle, 'row')
  } else {
    const n = job.size ?? pickSize(job.seed)
    log(job.quiet, `generating a ${n}×${n} puzzle (seed ${job.seed})…`)
    const sel = selectPuzzle(job.seed, n, { log: s => log(job.quiet, s) })
    puzzle = sel.puzzle; trace = sel.trace; puzzleSeed = sel.puzzleSeed
  }
  // "Real solve time" on screen: best of a few warm runs, so JIT warm-up doesn't count.
  for (let k = 0; k < 3; k++) trace.stats.cpuMs = Math.min(trace.stats.cpuMs, traceDfs(puzzle, 'row').stats.cpuMs)
  const n = puzzle.n
  const timeline = buildTimeline(trace, { duration: job.duration })
  const model = buildSceneModel(puzzle, timeline, trace.solution, 'row')
  const renderer = new SceneRenderer(model, {
    puzzleNumber: job.puzzleNumber,
    cpuMs: trace.stats.cpuMs,
    cta: '★ 3 NEW PUZZLES EVERY DAY ★',
    ctaSub: 'Follow so you never miss one',
    fps: job.fps,
  }, job.seed)
  log(job.quiet, `${trace.stats.placements} moves, ${trace.stats.removals} backtracks → ${timeline.tEnd.toFixed(1)} s video`)

  if (job.stills) {
    mkdirSync(job.out, { recursive: true })
    for (const t of job.stills) {
      const file = join(job.out, `still-${t.toFixed(2)}.png`)
      writeFileSync(file, await renderer.render(t).encode('png'))
      log(job.quiet, `wrote ${file}`)
    }
    return { out: job.out, sidecar: '', puzzle, trace, timeline, seconds: (performance.now() - t0) / 1000 }
  }

  mkdirSync(dirname(job.out), { recursive: true })
  const key = pick(mulberry32(hashSeed(job.seed, 'key')), KEYS)
  let wav: string | undefined
  if (job.audio) {
    const { renderAudio, encodeWav } = await loadAudio()
    const cues = composeScore(timeline, { key, n, solutionCols: trace.solution.map(([, c]) => c) })
    const buf = renderAudio(cues, timeline.tEnd, { seed: hashSeed(job.seed, 'audio') })
    fadeOut(buf.left, buf.right, buf.sampleRate, 0.6)
    wav = join(tmpdir(), `star-battle-${process.pid}-${Date.now()}.wav`)
    writeFileSync(wav, encodeWav(buf))
    log(job.quiet, `audio: ${cues.length} cues`)
  }

  const frameCount = Math.round(timeline.tEnd * job.fps)
  let lastPct = -1
  try {
    await encodeVideo(i => renderer.render(i / job.fps).data(), {
      out: job.out, width: W, height: H, fps: job.fps, frameCount, audioPath: wav,
      onProgress: i => {
        const pct = Math.floor((100 * (i + 1)) / frameCount)
        if (pct % 10 === 0 && pct !== lastPct && process.stderr.isTTY) { lastPct = pct; log(job.quiet, `  encoding ${pct}%`) }
      },
    })
  } finally {
    if (wav && existsSync(wav)) unlinkSync(wav)
  }

  if (job.preview) {
    const preview = job.out.replace(/\.mp4$/i, '') + '-preview.mp4'
    await encodePreview(job.out, preview)
    log(job.quiet, `preview: ${preview}`)
  }

  const sidecar = job.out.replace(/\.mp4$/i, '') + '.json'
  writeFileSync(sidecar, JSON.stringify({
    version: 1,
    renderedAt: new Date().toISOString(),
    seed: job.seed,
    puzzleSeed,
    puzzleNumber: job.puzzleNumber,
    key,
    fps: job.fps,
    duration: job.duration,
    durationSec: +timeline.tEnd.toFixed(3),
    solveAtSec: +timeline.tSolve.toFixed(3),
    stats: trace.stats,
    puzzle: { id: puzzle.id, n, grid: puzzle.grid },
    solution: trace.solution,
  }, null, 2) + '\n')
  return { out: job.out, sidecar, puzzle, trace, timeline, seconds: (performance.now() - t0) / 1000 }
}

async function loadAudio() {
  const synth = await import('./audio/synth')
  const wav = await import('./audio/wav')
  return { renderAudio: synth.renderAudio, encodeWav: wav.encodeWav }
}

function fadeOut(l: Float32Array, r: Float32Array, sr: number, seconds: number) {
  const len = Math.min(l.length, Math.floor(seconds * sr))
  for (let i = 0; i < len; i++) {
    const g = i / len
    const k = l.length - 1 - i
    l[k] *= g * g; r[k] *= g * g
  }
}

function loadPuzzleFile(file: string): Puzzle {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const p = data.puzzle ?? data
  if (!Array.isArray(p.grid)) throw new Error(`${file}: no "grid" (expected a render sidecar or {n, grid})`)
  return { id: p.id ?? basename(file), title: `${p.grid.length}×${p.grid.length}`, n: p.grid.length, grid: p.grid }
}

/** Delete dated renders older than `days` (only files named YYYY-MM-DD-*.mp4/json). */
function prune(dir: string, days: number) {
  if (days <= 0 || !existsSync(dir)) return
  const cutoff = Date.now() - days * 86_400_000
  for (const f of readdirSync(dir)) {
    if (!/^\d{4}-\d{2}-\d{2}-.*\.(mp4|json)$/.test(f)) continue
    const p = join(dir, f)
    if (statSync(p).mtimeMs < cutoff) unlinkSync(p)
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      size: { type: 'string' }, seed: { type: 'string' }, puzzle: { type: 'string' },
      out: { type: 'string' }, 'out-dir': { type: 'string' }, fps: { type: 'string' },
      duration: { type: 'string' }, number: { type: 'string' }, still: { type: 'string' },
      'no-audio': { type: 'boolean' }, 'keep-days': { type: 'string' }, quiet: { type: 'boolean' },
      preview: { type: 'boolean' },
    },
  })
  const mode = positionals[0] ?? 'render'
  const seed = values.seed !== undefined ? Number(values.seed) >>> 0 : randomInt(2 ** 32 - 1)
  const fps = Number(values.fps ?? 60)
  const duration = Number(values.duration ?? 60)
  const common = { seed, fps, duration, audio: !values['no-audio'], quiet: values.quiet, preview: values.preview }

  if (mode === 'daily') {
    const dir = resolve(values['out-dir'] ?? 'output/daily')
    mkdirSync(dir, { recursive: true })
    prune(dir, Number(values['keep-days'] ?? 30))
    const logFile = join(dir, 'log.jsonl')
    const number = values.number ? Number(values.number)
      : (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0) + 1
    const size = values.size ? Number(values.size) : pickSize(seed)
    const date = new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD, like `date +%F`
    const out = join(dir, `${date}-star-battle-${size}x${size}-puzzle-${number}.mp4`)
    const res = await renderVideo({ ...common, size, out, puzzleNumber: number })
    appendFileSync(logFile, JSON.stringify({ number, file: basename(out), seed, n: size, stats: res.trace.stats, at: new Date().toISOString() }) + '\n')
    log(values.quiet, `done in ${res.seconds.toFixed(1)} s`)
    console.log(res.out)
    return
  }

  if (mode !== 'render') throw new Error(`unknown mode "${mode}" (expected render | daily)`)
  const puzzle = values.puzzle ? loadPuzzleFile(values.puzzle) : undefined
  const stills = values.still ? values.still.split(',').map(Number) : undefined
  const out = resolve(values.out ?? (stills ? 'output/stills' : `output/star-battle-${seed}.mp4`))
  const res = await renderVideo({
    ...common, puzzle, out, stills,
    size: values.size ? Number(values.size) : undefined,
    puzzleNumber: values.number ? Number(values.number) : undefined,
  })
  log(values.quiet, `done in ${res.seconds.toFixed(1)} s`)
  console.log(res.out)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch(err => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1) })
