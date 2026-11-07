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
import { MELODIES, type Melody } from './melodies'

const KEYS = [-3, -2, 0, 2, 3] // A, B♭, C, D, E♭
// 9×9+ confused viewers (Clarke 2026-10-14): 5×5 – 8×8 only, equal odds.
const SIZE_WEIGHTS: [number, number][] = [[5, 0.25], [6, 0.25], [7, 0.25], [8, 0.25]]

/**
 * Video formats (pivot test, 2026-11-06):
 *   classic   — the original 60 s "Can you beat the computer?" solve.
 *   melody    — every star placed plays the next note of a public-domain tune ("Can you name this song?"),
 *               7×7 boards at a fixed 4 notes/s, so the video runs ~35–58 s.
 *   challenge — 30 s: labelled 5×5/6×6 board, 5 s countdown "Where is row 1's star?", then the bot solves.
 */
export const FORMATS = ['classic', 'melody', 'challenge'] as const
export type Format = typeof FORMATS[number]
const MELODY_DRAMA: [number, number] = [80, 160] // placements: long enough for the tune, short enough for < 60 s
const CHALLENGE_SIZES = [5, 6]

/** Daily rotation: each format visits each ET slot equally (Latin square over days × slots). */
export function dailyFormat(now: Date, number: number): Format {
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now))
  const slot = ({ 11: 0, 15: 1, 19: 2 } as Record<number, number>)[etHour] ?? number % 3
  // Day number by the ET calendar date (19:30 ET is already the next day in UTC).
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now).split('-').map(Number)
  const day = Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000)
  return FORMATS[(day + slot) % 3]
}

export interface RenderJob {
  seed: number
  size?: number
  puzzle?: Puzzle
  out: string
  fps: number
  /** Exact video length, seconds. */
  duration: number
  puzzleNumber?: number
  format?: Format
  audio: boolean
  stills?: number[]
  quiet?: boolean
  /** Also write <out>-preview.mp4 (720p/30fps, chat-sized). */
  preview?: boolean
}

export interface RenderResult { out: string; sidecar: string; puzzle: Puzzle; trace: Trace; timeline: Timeline; seconds: number }

const stamp = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Progress lines go to stderr (stdout stays a clean machine channel) with a local timestamp so launchd.err.log runs stay attributable. */
export const log = (quiet: boolean | undefined, s: string): void => { if (!quiet) console.error(`[${stamp()}] ${s}`) }

function sizeFor(format: Format, seed: number): number {
  if (format === 'melody') return 7
  if (format === 'challenge') return CHALLENGE_SIZES[Math.floor(mulberry32(hashSeed(seed, 'size'))() * CHALLENGE_SIZES.length)]
  return pickSize(seed)
}

function pickSize(seed: number): number {
  const r = mulberry32(hashSeed(seed, 'size'))()
  let acc = 0
  for (const [n, w] of SIZE_WEIGHTS) { acc += w; if (r < acc) return n }
  return 8
}

export async function renderVideo(job: RenderJob): Promise<RenderResult> {
  const t0 = performance.now()
  const format: Format = job.format ?? 'classic'
  const melody: Melody | undefined = format === 'melody' ? pick(mulberry32(hashSeed(job.seed, 'melody')), MELODIES) : undefined
  let puzzle: Puzzle, trace: Trace, puzzleSeed: number | undefined
  if (job.puzzle) {
    puzzle = job.puzzle
    trace = traceDfs(puzzle, 'row')
  } else {
    const n = job.size ?? sizeFor(format, job.seed)
    log(job.quiet, `generating a ${n}×${n} ${format} puzzle (seed ${job.seed})…`)
    const sel = selectPuzzle(job.seed, n, { log: s => log(job.quiet, s), drama: format === 'melody' ? MELODY_DRAMA : undefined })
    puzzle = sel.puzzle; trace = sel.trace; puzzleSeed = sel.puzzleSeed
  }
  // "Real solve time" on screen: best of a few warm runs, so JIT warm-up doesn't count.
  for (let k = 0; k < 3; k++) trace.stats.cpuMs = Math.min(trace.stats.cpuMs, traceDfs(puzzle, 'row').stats.cpuMs)
  const n = puzzle.n
  const COUNTDOWN = 5
  const timeline = buildTimeline(trace,
    format === 'melody' ? { duration: 0, rate: 4 }
      : format === 'challenge' ? { duration: 30, intro: COUNTDOWN }
        : { duration: job.duration })
  const model = buildSceneModel(puzzle, timeline, trace.solution, 'row')
  const base = { puzzleNumber: job.puzzleNumber, cpuMs: trace.stats.cpuMs, fps: job.fps }
  const renderer = new SceneRenderer(model,
    format === 'melody' ? { ...base, hook: ['CAN YOU NAME', 'THIS SONG?'], cta: '★ NAME THAT SONG? ★', ctaSub: 'Comment the title below' }
      : format === 'challenge' ? { ...base, hook: ["WHERE'S ROW 1'S STAR?", 'COMMENT IT!'], countdown: COUNTDOWN, labels: true, highlightRow: 0, cta: '★ DID YOU GET ROW 1? ★', ctaSub: 'Comment your answer, e.g. C1' }
        : { ...base, cta: '★ 3 NEW PUZZLES EVERY DAY ★', ctaSub: 'Follow so you never miss one' },
    job.seed)
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
    const cues = composeScore(timeline, { key, n, solutionCols: trace.solution.map(([, c]) => c), melody: melody?.notes, countdown: format === 'challenge' ? COUNTDOWN : undefined })
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
    format,
    melody: melody?.id,
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
      preview: { type: 'boolean' }, format: { type: 'string' },
    },
  })
  const mode = positionals[0] ?? 'render'
  const seed = values.seed !== undefined ? Number(values.seed) >>> 0 : randomInt(2 ** 32 - 1)
  const fps = Number(values.fps ?? 60)
  const duration = Number(values.duration ?? 60)
  const common = { seed, fps, duration, audio: !values['no-audio'], quiet: values.quiet, preview: values.preview }
  if (values.format && !(FORMATS as readonly string[]).includes(values.format)) throw new Error(`--format must be one of ${FORMATS.join(' | ')}`)

  if (mode === 'daily') {
    const dir = resolve(values['out-dir'] ?? 'output/daily')
    mkdirSync(dir, { recursive: true })
    prune(dir, Number(values['keep-days'] ?? 30))
    const logFile = join(dir, 'log.jsonl')
    const number = values.number ? Number(values.number)
      : (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0) + 1
    const format = (values.format as Format | undefined) ?? dailyFormat(new Date(), number)
    const size = values.size ? Number(values.size) : sizeFor(format, seed)
    const date = new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD, like `date +%F`
    // Non-classic files carry a "<format>-" prefix: youtube-upload.json's variants pick their title by it.
    const out = join(dir, `${date}-${format === 'classic' ? '' : `${format}-`}star-battle-${size}x${size}-puzzle-${number}.mp4`)
    const res = await renderVideo({ ...common, size, out, puzzleNumber: number, format })
    appendFileSync(logFile, JSON.stringify({ number, file: basename(out), seed, n: size, format, stats: res.trace.stats, at: new Date().toISOString() }) + '\n')
    log(values.quiet, `done in ${res.seconds.toFixed(1)} s`)
    console.log(res.out)
    return
  }

  if (mode !== 'render') throw new Error(`unknown mode "${mode}" (expected render | daily)`)
  const puzzle = values.puzzle ? loadPuzzleFile(values.puzzle) : undefined
  const stills = values.still ? values.still.split(',').map(Number) : undefined
  const out = resolve(values.out ?? (stills ? 'output/stills' : `output/star-battle-${seed}.mp4`))
  const res = await renderVideo({
    ...common, puzzle, out, stills, format: values.format as Format | undefined,
    size: values.size ? Number(values.size) : undefined,
    puzzleNumber: values.number ? Number(values.number) : undefined,
  })
  log(values.quiet, `done in ${res.seconds.toFixed(1)} s`)
  console.log(res.out)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch(err => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1) })
