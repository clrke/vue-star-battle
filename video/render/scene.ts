/**
 * Draws one 1080×1920 frame of the solver video at time t.
 *
 * Stateless with respect to time: render(t) depends only on t and the precomputed
 * SceneModel, so frames can be rendered in any order (handy for stills/thumbnails).
 */
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import { W, H, BOARD, LAYOUT, COLORS, REGION_COLORS, font } from './theme'
import { goldStar, redStar, glowDisc, starPath, STAR_FRACTION } from './sprites'
import { burst, rain, confettoState, type Confetto } from './confetti'
import { coverage, type SceneModel, type StarSpan } from './model'
import { stepIndexAt } from '../timeline'
import { mulberry32, hashSeed, randRange } from '../rng'
import { clamp01, clamp, easeOutBack, easeOutCubic, easeInCubic, bump, lerp } from './ease'

export interface SceneMeta {
  /** Running puzzle number shown in the header (omit for one-offs). */
  puzzleNumber?: number
  /** How long the bare DFS took on the CPU, ms. */
  cpuMs: number
  /** Call-to-action shown at the end. */
  cta: string
  ctaSub: string
  fps: number
}

const CONFETTI_COLORS = [...REGION_COLORS.slice(0, 10), '#f7c948', '#ffffff', '#ff6b81', '#4aa3df']

export class SceneRenderer {
  readonly canvas: Canvas
  private readonly ctx: SKRSContext2D
  private readonly model: SceneModel
  private readonly meta: SceneMeta
  private readonly bg: Canvas
  private readonly boardBase: Canvas
  private readonly glowBlue: Canvas
  private readonly glowGold: Canvas
  private readonly gold = goldStar()
  private readonly red = redStar()
  private readonly goldDisc = glowDisc('255,214,102')
  private readonly whiteDisc = glowDisc('255,255,255')
  private readonly cell: number
  private readonly confetti: Confetto[]
  private readonly twinkles: { x: number; y: number; r: number; p: number; w: number; a: number }[]
  private readonly bursts: { t: number; r: number; c: number; big: number }[]

  constructor(model: SceneModel, meta: SceneMeta, seed: number) {
    this.model = model
    this.meta = meta
    this.canvas = createCanvas(W, H)
    this.ctx = this.canvas.getContext('2d')
    this.cell = BOARD.size / model.n
    this.bg = this.makeBackground()
    this.boardBase = this.makeBoardBase()
    this.glowBlue = this.makeGlow('rgba(74, 163, 223, 0.55)')
    this.glowGold = this.makeGlow('rgba(255, 200, 70, 0.9)')

    const rng = mulberry32(hashSeed(seed, 'scene'))
    this.twinkles = Array.from({ length: 130 }, () => ({
      x: randRange(rng, 0, W), y: randRange(rng, 0, H), r: randRange(rng, 0.7, 2.3),
      p: randRange(rng, 0, Math.PI * 2), w: randRange(rng, 0.8, 2.6), a: randRange(rng, 0.25, 0.85),
    }))
    const tl = model.timeline
    const by = BOARD.y + BOARD.size
    this.confetti = [
      ...burst(rng, tl.tBanner, BOARD.x + 30, by, 110, -62, 22, [1500, 2700], CONFETTI_COLORS),
      ...burst(rng, tl.tBanner, BOARD.x + BOARD.size - 30, by, 110, -118, 22, [1500, 2700], CONFETTI_COLORS),
      ...rain(rng, tl.tBanner + 0.6, Math.max(0.5, tl.tEnd - tl.tBanner - 2.5), 90, W, CONFETTI_COLORS),
    ]
    // Placement bursts only where the eye can follow them (slow steps, records, the final run).
    this.bursts = model.stars
      .filter(s => !s.fail && (s.dur >= 0.1 || s.record || s.final))
      .map(s => ({ t: s.on, r: s.r, c: s.c, big: s === model.stars[model.stars.length - 1] ? 2 : s.record ? 1 : 0 }))
  }

  // ── Static layers ────────────────────────────────────────────────────────

  private makeBackground(): Canvas {
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, COLORS.bgTop); g.addColorStop(1, COLORS.bgBottom)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    const cx = BOARD.x + BOARD.size / 2, cy = BOARD.y + BOARD.size / 2
    const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, 900)
    r.addColorStop(0, 'rgba(90, 110, 255, 0.16)'); r.addColorStop(1, 'rgba(90, 110, 255, 0)')
    ctx.fillStyle = r
    ctx.fillRect(0, 0, W, H)
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75)
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)
    return cv
  }

  private makeGlow(color: string): Canvas {
    const pad = 220
    const cv = createCanvas(BOARD.size + pad * 2, BOARD.size + pad * 2)
    const ctx = cv.getContext('2d')
    ctx.shadowColor = color
    ctx.shadowBlur = 110
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(pad - 10, pad - 10, BOARD.size + 20, BOARD.size + 20, 34)
    ctx.fill()
    return cv
  }

  private makeBoardBase(): Canvas {
    const { n, grid } = this.model.puzzle
    const cv = createCanvas(W, H)
    const ctx = cv.getContext('2d')
    const { x, y, size } = BOARD
    const c = this.cell
    // Frame
    ctx.fillStyle = COLORS.boardFrame
    ctx.beginPath(); ctx.roundRect(x - 18, y - 18, size + 36, size + 36, 30); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.stroke()
    ctx.save()
    ctx.beginPath(); ctx.roundRect(x, y, size, size, 14); ctx.clip()
    for (let r = 0; r < n; r++)
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = REGION_COLORS[grid[r][k] % REGION_COLORS.length]
        ctx.fillRect(x + k * c, y + r * c, c + 0.5, c + 0.5)
      }
    // Thin grid
    ctx.strokeStyle = COLORS.gridLine; ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 1; i < n; i++) {
      ctx.moveTo(x + i * c, y); ctx.lineTo(x + i * c, y + size)
      ctx.moveTo(x, y + i * c); ctx.lineTo(x + size, y + i * c)
    }
    ctx.stroke()
    // Thick region borders
    ctx.strokeStyle = COLORS.regionBorder; ctx.lineWidth = Math.max(5, c * 0.07); ctx.lineCap = 'round'
    ctx.beginPath()
    for (let r = 0; r < n; r++)
      for (let k = 0; k < n; k++) {
        if (k + 1 < n && grid[r][k] !== grid[r][k + 1]) { ctx.moveTo(x + (k + 1) * c, y + r * c); ctx.lineTo(x + (k + 1) * c, y + (r + 1) * c) }
        if (r + 1 < n && grid[r][k] !== grid[r + 1][k]) { ctx.moveTo(x + k * c, y + (r + 1) * c); ctx.lineTo(x + (k + 1) * c, y + (r + 1) * c) }
      }
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = COLORS.regionBorder; ctx.lineWidth = 7
    ctx.beginPath(); ctx.roundRect(x, y, size, size, 14); ctx.stroke()
    return cv
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  render(t: number): Canvas {
    const ctx = this.ctx
    const tl = this.model.timeline
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(this.bg, 0, 0)
    this.drawTwinkles(t)

    // Camera: tiny shake on slow dead ends, punch-in on the solve.
    let dx = 0, dy = 0
    for (const f of this.recentFlashes(t, 0.35)) {
      if (!f.slow) continue
      const a = t - f.t
      const amp = 7 * Math.exp(-a / 0.07)
      dx += amp * Math.sin(2 * Math.PI * 26 * a)
      dy += amp * 0.5 * Math.cos(2 * Math.PI * 21 * a)
    }
    // Slow push-in through the final run (tension), then a punch on the solve (release).
    const push = t >= tl.tFinalRun && t < tl.tSolve ? 0.025 * easeInCubic((t - tl.tFinalRun) / Math.max(0.01, tl.tSolve - tl.tFinalRun)) : 0
    const zoom = t >= tl.tSolve ? 1 + 0.035 * Math.exp(-(t - tl.tSolve) / 0.16) : 1 + push
    ctx.save()
    ctx.translate(W / 2 + dx, H / 2 + dy); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2)
    this.drawHeader(t)
    this.drawBoard(t)
    this.drawHud(t)
    ctx.restore()
    this.drawConfetti(t)
    // White flash on the solve
    if (t >= tl.tSolve && t < tl.tSolve + 0.6) {
      ctx.globalAlpha = 0.5 * Math.exp(-(t - tl.tSolve) / 0.11)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
      ctx.globalAlpha = 1
    }
    return this.canvas
  }

  private drawTwinkles(t: number) {
    const ctx = this.ctx
    ctx.fillStyle = '#ffffff'
    for (const s of this.twinkles) {
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(s.w * t + s.p))
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private recentFlashes(t: number, window: number) {
    const fl = this.model.flashes
    let lo = 0, hi = fl.length - 1, first = fl.length
    while (lo <= hi) { const m = (lo + hi) >> 1; if (fl[m].t >= t - window) { first = m; hi = m - 1 } else lo = m + 1 }
    const out = []
    for (let k = first; k < fl.length && fl[k].t <= t; k++) out.push(fl[k])
    return out
  }

  /** Seconds per step right now — drives animation lengths and the smoothing window. */
  private pace(t: number): number {
    const tl = this.model.timeline
    const i = stepIndexAt(tl, t)
    if (i < 0) return 0.5
    return tl.steps[i].dur || 0.5
  }

  private text(str: string, x: number, y: number, f: string, fill: string, opts: { align?: 'center' | 'left' | 'right'; alpha?: number; scale?: number; stroke?: string; strokeW?: number; spacing?: number; glow?: string } = {}) {
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = opts.alpha ?? 1
    ctx.translate(x, y)
    if (opts.scale && opts.scale !== 1) ctx.scale(opts.scale, opts.scale)
    ctx.font = f
    ctx.textAlign = opts.align ?? 'center'
    ctx.textBaseline = 'middle'
    if (opts.spacing) ctx.letterSpacing = `${opts.spacing}px`
    if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = 28 }
    if (opts.stroke) {
      ctx.lineJoin = 'round'; ctx.lineWidth = opts.strokeW ?? 8; ctx.strokeStyle = opts.stroke
      ctx.strokeText(str, 0, 0)
    }
    ctx.fillStyle = fill
    ctx.fillText(str, 0, 0)
    ctx.restore()
  }

  /** Centered text where each '★' is drawn as the star sprite (system fonts lack the glyph). */
  private richText(str: string, x: number, y: number, f: string, fill: string, opts: { alpha?: number; scale?: number; spacing?: number } = {}) {
    const ctx = this.ctx
    ctx.save()
    ctx.font = f
    if (opts.spacing) ctx.letterSpacing = `${opts.spacing}px`
    const px = Number(/(\d+)px/.exec(f)?.[1] ?? 32)
    const icon = px * 1.05
    const parts = str.split('★')
    const widths = parts.map(p => ctx.measureText(p).width)
    const total = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * icon
    ctx.restore()
    ctx.save()
    ctx.translate(x, y)
    if (opts.scale && opts.scale !== 1) ctx.scale(opts.scale, opts.scale)
    let cx = -total / 2
    parts.forEach((p, i) => {
      if (p) this.text(p, cx, 0, f, fill, { align: 'left', alpha: opts.alpha, spacing: opts.spacing })
      cx += widths[i]
      if (i < parts.length - 1) {
        const d = (icon * 0.95) / STAR_FRACTION
        ctx.globalAlpha = opts.alpha ?? 1
        ctx.drawImage(this.gold, cx + icon / 2 - d / 2, -d / 2 - px * 0.04, d, d)
        ctx.globalAlpha = 1
        cx += icon
      }
    })
    ctx.restore()
  }

  // ── Header ───────────────────────────────────────────────────────────────

  private drawHeader(t: number) {
    const tl = this.model.timeline
    const n = this.model.n
    const beat = tl.beat
    const beatPulse = Math.exp(-(((t % beat) + beat) % beat) / 0.12)
    const preBanner = t < tl.tBanner
    if (preBanner) {
      const fadeOut = clamp01((tl.tBanner - t) / 0.15)
      const intro = easeOutBack(clamp01(t / 0.35), 1.4)
      this.text('CAN YOU BEAT', W / 2, LAYOUT.hook1Y, font(800, 76), COLORS.text,
        { alpha: fadeOut, scale: lerp(0.92, 1, intro), stroke: 'rgba(0,0,0,0.35)', strokeW: 10, spacing: 2 })
      const s2 = lerp(0.85, 1, intro) * (1 + 0.025 * beatPulse * (t > tl.opts.intro ? 1 : 0))
      this.text('THE COMPUTER?', W / 2, LAYOUT.hook2Y, font(900, 104), COLORS.gold,
        { alpha: fadeOut, scale: s2, stroke: '#5a3300', strokeW: 12, glow: 'rgba(247, 201, 72, 0.55)' })
      const num = this.meta.puzzleNumber ? `  ·  PUZZLE #${this.meta.puzzleNumber}` : ''
      this.text(`${n}×${n} STAR BATTLE${num}`, W / 2, LAYOUT.subY, font(700, 36), COLORS.muted, { alpha: fadeOut, spacing: 3 })
      this.richText('One ★ per row, column & region · stars never touch', W / 2, LAYOUT.rulesY, font(600, 31), 'rgba(220, 222, 255, 0.8)', { alpha: fadeOut })
      return
    }
    // SOLVED! slam + stats
    const k = (t - tl.tBanner) / 0.32
    const settle = easeOutBack(k, 2.2)
    const scale = 1 + 1.4 * (1 - settle)
    const breathe = 1 + 0.03 * beatPulse
    this.text('SOLVED!', W / 2, (LAYOUT.hook1Y + LAYOUT.hook2Y) / 2 + 6, font(900, 168), COLORS.gold,
      { alpha: clamp01(k * 4), scale: scale * breathe, stroke: '#5a3300', strokeW: 16, glow: 'rgba(255, 210, 80, 0.8)' })
    const m = this.model
    const last = m.timeline.steps[m.timeline.steps.length - 1]
    const statA = clamp01((t - tl.tStats) / 0.25)
    this.text(`${last.placements.toLocaleString('en-US')} moves  ·  ${last.backtracks.toLocaleString('en-US')} backtracks`, W / 2, LAYOUT.subY, font(700, 38), COLORS.text,
      { alpha: statA, scale: lerp(0.9, 1, easeOutCubic(statA)), spacing: 1 })
    const cpuA = clamp01((t - tl.tStats - 0.5) / 0.25)
    const ms = this.meta.cpuMs < 1 ? this.meta.cpuMs.toFixed(2) : this.meta.cpuMs.toFixed(1)
    this.text(`Real solve time: ${ms} ms`, W / 2, LAYOUT.rulesY, font(600, 31), 'rgba(220, 222, 255, 0.85)', { alpha: cpuA })
  }

  // ── Board ────────────────────────────────────────────────────────────────

  private cellCenter(r: number, c: number): [number, number] {
    return [BOARD.x + (c + 0.5) * this.cell, BOARD.y + (r + 0.5) * this.cell]
  }

  private drawBoard(t: number) {
    const ctx = this.ctx
    const m = this.model
    const tl = m.timeline
    const n = m.n
    const c = this.cell
    const pace = this.pace(t)
    const solved = t >= tl.tSolve

    // Glow behind the board: cool during the search, warming through the final run, gold when solved.
    const warm = solved ? 1 : t >= tl.tFinalRun ? 0.35 * clamp01((t - tl.tFinalRun) / Math.max(0.01, tl.tSolve - tl.tFinalRun)) : 0
    const pulse = solved ? 0.75 + 0.25 * Math.exp(-(((t - tl.tSolve) % tl.beat) + tl.beat) % tl.beat / 0.2) : 1
    // During the search the cool glow throbs on every beat, in time with the kick/clap.
    const searching = t >= tl.opts.intro && t < tl.tFinalRun
    const beatGlow = searching ? 0.28 * Math.exp(-((((t - tl.opts.intro) % tl.beat) + tl.beat) % tl.beat) / 0.16) : 0
    ctx.globalAlpha = Math.min(1, (0.5 + beatGlow) * (1 - warm))
    ctx.drawImage(this.glowBlue, BOARD.x - 220, BOARD.y - 220)
    if (warm > 0) { ctx.globalAlpha = warm * pulse; ctx.drawImage(this.glowGold, BOARD.x - 220, BOARD.y - 220) }
    ctx.globalAlpha = 1
    ctx.drawImage(this.boardBase, 0, 0)

    ctx.save()
    ctx.beginPath(); ctx.roundRect(BOARD.x, BOARD.y, BOARD.size, BOARD.size, 14); ctx.clip()

    // Intro sheen: one diagonal glint across the board to grab attention.
    if (t < 1.2) this.drawSheen(t / 1.1, 0.3, 'rgba(255,255,255,')

    // Cursor: the row DFS is working on.
    if (m.strategy === 'row' && t >= tl.opts.intro - 0.3 && !solved) {
      const w = clamp(pace * 1.5, 0.05, 0.16)
      const row = m.cursorRow.mean(t, w)
      const y = BOARD.y + row * c
      const rgb = t >= tl.tFinalRun ? '255,214,102' : '255,255,255' // gold on the winning run
      const peak = t >= tl.tFinalRun ? 0.3 : 0.2
      const g = ctx.createLinearGradient(0, y - c * 0.15, 0, y + c * 1.15)
      g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.2, `rgba(${rgb},${peak})`)
      g.addColorStop(0.8, `rgba(${rgb},${peak})`); g.addColorStop(1, `rgba(${rgb},0)`)
      ctx.fillStyle = g
      ctx.fillRect(BOARD.x, y - c * 0.15, BOARD.size, c * 1.3)
    }

    // Dead-end flashes: the row / column / region that ran out of room.
    for (const f of this.recentFlashes(t, 1.0)) {
      const a = 0.62 * Math.exp(-(t - f.t) / f.tau)
      if (a < 0.01) continue
      ctx.fillStyle = `rgba(255, 60, 80, ${a.toFixed(3)})`
      ctx.beginPath()
      for (const [r, k] of f.cells) ctx.rect(BOARD.x + k * c, BOARD.y + r * c, c, c)
      ctx.fill()
    }

    // Ruled-out dots, smoothed over a short window so fast phases shimmer instead of strobe.
    const dotFade = solved ? lerp(1, 0.35, clamp01((t - tl.sweep.t) / 0.6)) : 1
    ctx.fillStyle = COLORS.dot
    for (let i = 0; i < n * n; i++) {
      const a = coverage(m.elim[i], t, 0.12) * dotFade
      if (a < 0.02) continue
      const [x, y] = this.cellCenter(Math.floor(i / n), i % n)
      ctx.globalAlpha = a
      ctx.beginPath(); ctx.arc(x, y, c * 0.085, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1

    // Verification sweep: each solution row lights up in turn.
    if (solved) {
      for (let r = 0; r < n; r++) {
        const k = (t - (tl.sweep.t + r * tl.sweep.stepDur)) / 0.42
        const a = 0.5 * bump(k)
        if (a <= 0) continue
        ctx.fillStyle = `rgba(255, 214, 102, ${a.toFixed(3)})`
        ctx.fillRect(BOARD.x, BOARD.y + r * c, BOARD.size, c)
      }
      if (t >= tl.sweep.end) {
        const period = 1.5
        this.drawSheen(((t - tl.sweep.end) % period) / period, 0.16, 'rgba(255,214,102,')
      }
    }

    this.drawBursts(t)
    for (const s of m.stars) this.drawStarSpan(s, t)
    ctx.restore()
  }

  /** A soft diagonal band sweeping across the board (progress p: 0 → 1). */
  private drawSheen(p: number, alpha: number, rgbaPrefix: string) {
    if (p < 0 || p > 1) return
    const ctx = this.ctx
    const { x, y, size } = BOARD
    const pos = lerp(-0.45, 1.45, p)
    const cx = x + size * pos, cy = y + size * pos
    const half = size * 0.16
    const g = ctx.createLinearGradient(cx - half, cy - half, cx + half, cy + half)
    g.addColorStop(0, `${rgbaPrefix}0)`)
    g.addColorStop(0.5, `${rgbaPrefix}${alpha})`)
    g.addColorStop(1, `${rgbaPrefix}0)`)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = g
    ctx.fillRect(x, y, size, size)
    ctx.restore()
  }

  private drawBursts(t: number) {
    const ctx = this.ctx
    const c = this.cell
    for (const b of this.bursts) {
      const life = b.big === 2 ? 0.9 : 0.55
      const age = t - b.t
      if (age < 0 || age > life) continue
      const k = age / life
      const [x, y] = this.cellCenter(b.r, b.c)
      const reach = b.big === 2 ? 2.6 : b.big === 1 ? 1.35 : 0.95
      // Glow
      ctx.globalAlpha = (1 - k) * (b.big ? 0.9 : 0.5)
      const g = c * (0.9 + reach * easeOutCubic(k))
      ctx.drawImage(this.goldDisc, x - g, y - g, g * 2, g * 2)
      // Ring
      ctx.globalAlpha = (1 - k) * 0.9
      ctx.strokeStyle = '#ffe27a'
      ctx.lineWidth = (b.big ? 7 : 5) * (1 - k) + 1
      ctx.beginPath(); ctx.arc(x, y, c * (0.3 + reach * 0.75 * easeOutCubic(k)), 0, Math.PI * 2); ctx.stroke()
      // Particles
      const count = b.big === 2 ? 16 : b.big === 1 ? 12 : 8
      ctx.fillStyle = b.big ? '#fff3b0' : '#f7c948'
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + b.r * 0.7
        const d = c * reach * easeOutCubic(k)
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, (b.big ? 6 : 4.5) * (1 - k) + 0.5, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawStarSpan(s: StarSpan, t: number) {
    const tl = this.model.timeline
    const fps = this.meta.fps
    if (t < s.on) return
    const popDur = clamp(0.6 * s.dur, 1 / fps, s.final ? 0.3 : 0.22)
    const outDur = clamp(0.5 * s.dur, 1.6 / fps, 0.14)
    let scale: number, alpha = 1
    if (t < s.off) {
      scale = easeOutBack((t - s.on) / popDur, s.final ? 2.4 : 1.9)
    } else {
      const k = (t - s.off) / outDur
      if (k >= 1) return
      const atOff = easeOutBack((s.off - s.on) / popDur)
      scale = atOff * (1 - easeInCubic(k))
      alpha = 1 - k * 0.6
    }
    // Post-solve: pulse as the sweep passes, then breathe on the beat.
    if (!s.fail && !Number.isFinite(s.off) && t >= tl.tSolve) {
      const k = (t - (tl.sweep.t + s.r * tl.sweep.stepDur)) / 0.35
      scale *= 1 + 0.4 * bump(k)
      if (t >= tl.tBanner) scale *= 1 + 0.06 * Math.exp(-((((t - tl.tBanner) % tl.beat) + tl.beat) % tl.beat) / 0.15)
      const glow = bump(k)
      if (glow > 0) {
        const [x, y] = this.cellCenter(s.r, s.c)
        const g = this.cell * 1.1
        this.ctx.globalAlpha = 0.85 * glow
        this.ctx.drawImage(this.whiteDisc, x - g, y - g, g * 2, g * 2)
      }
    }
    const sprite = s.fail && t >= s.conflictAt ? this.red : this.gold
    const [x, y] = this.cellCenter(s.r, s.c)
    const d = (this.cell * 0.8 * scale) / STAR_FRACTION
    this.ctx.globalAlpha = alpha
    this.ctx.drawImage(sprite, x - d / 2, y - d / 2, d, d)
    this.ctx.globalAlpha = 1
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  private drawHud(t: number) {
    const ctx = this.ctx
    const m = this.model
    const tl = m.timeline
    const n = m.n
    const solved = t >= tl.tSolve
    const outroK = clamp01((t - tl.tOutro) / 0.35)

    // Progress slots: one star per row/column/region still to fill.
    const gap = 12
    const size = Math.min(66, (860 - (n - 1) * gap) / n)
    const total = n * size + (n - 1) * gap
    const x0 = (W - total) / 2 + size / 2
    const y = LAYOUT.slotsY
    const depth = solved ? n : m.depth.mean(t, clamp(this.pace(t) * 1.5, 0.03, 0.12))
    let best = 0
    for (const r of m.records) if (r.t <= t) best = Math.max(best, r.depth)
    best = Math.max(best, Math.floor(depth + 1e-6))
    for (let k = 0; k < n; k++) {
      const x = x0 + k * (size + gap)
      let pop = 1
      for (const r of m.records) if (r.depth === k + 1 && t >= r.t && t - r.t < 0.5) pop = 1 + 0.55 * Math.exp(-(t - r.t) / 0.12)
      if (solved) pop *= 1 + 0.35 * bump((t - (tl.sweep.t + k * tl.sweep.stepDur)) / 0.35)
      ctx.save()
      ctx.translate(x, y)
      ctx.globalAlpha = 1 - outroK
      starPath(ctx, 0, 0, (size / 2) * 0.95)
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3
      ctx.strokeStyle = k < best ? 'rgba(247, 201, 72, 0.75)' : 'rgba(154, 154, 196, 0.45)'
      ctx.stroke()
      const fill = clamp01(depth - k)
      if (fill > 0.01) {
        const d = (size * 1.02 * pop) / STAR_FRACTION
        ctx.globalAlpha = fill * (1 - outroK)
        ctx.drawImage(this.gold, -d / 2, -d / 2, d, d)
      }
      ctx.restore()
    }

    // Counters
    const i = stepIndexAt(tl, t)
    const step = i >= 0 ? tl.steps[i] : null
    const cols = [W / 2 - 330, W / 2, W / 2 + 330]
    const a = 1 - outroK
    if (a > 0) {
      const labels = ['MOVES', 'BACKTRACKS', solved ? 'STARS' : 'SPEED']
      const values = [
        (step?.placements ?? 0).toLocaleString('en-US'),
        (step?.backtracks ?? 0).toLocaleString('en-US'),
        solved ? `${n}/${n}` : `${step && !step.isFinalRun ? step.speed : 1}×`,
      ]
      // The speed readout pops each time the search shifts up a gear.
      let gearPop = 1
      if (i > 0 && !solved) {
        for (let j = i; j > 0 && t - tl.steps[j].t < 0.3; j--) {
          if (tl.steps[j].speed !== tl.steps[j - 1].speed && !tl.steps[j].isFinalRun) { gearPop = 1 + 0.45 * Math.exp(-(t - tl.steps[j].t) / 0.09); break }
        }
      }
      for (let k = 0; k < 3; k++) {
        this.text(labels[k], cols[k], LAYOUT.countersY - 40, font(700, 28), COLORS.muted, { alpha: a, spacing: 4 })
        this.text(values[k], cols[k], LAYOUT.countersY + 14, font(800, 64), k === 2 ? COLORS.gold : COLORS.text,
          { alpha: a, scale: k === 2 ? gearPop : 1, glow: k === 2 && gearPop > 1.05 ? 'rgba(247, 201, 72, 0.8)' : undefined })
      }
    }

    // Outro call-to-action
    if (outroK > 0) {
      const s = easeOutBack(outroK, 1.6) * (1 + 0.02 * Math.exp(-((((t - tl.tOutro) % tl.beat) + tl.beat) % tl.beat) / 0.15))
      ctx.save()
      ctx.translate(W / 2, LAYOUT.countersY - 10)
      ctx.scale(s, s)
      ctx.globalAlpha = outroK
      const g = ctx.createLinearGradient(0, -60, 0, 60)
      g.addColorStop(0, '#ffe27a'); g.addColorStop(1, '#f39c12')
      ctx.fillStyle = g
      ctx.shadowColor = 'rgba(255, 200, 70, 0.6)'; ctx.shadowBlur = 30
      ctx.beginPath(); ctx.roundRect(-420, -58, 840, 116, 58); ctx.fill()
      ctx.restore()
      this.richText(this.meta.cta, W / 2, LAYOUT.countersY - 10, font(900, 44), '#241400', { alpha: outroK, scale: s, spacing: 1 })
      this.text(this.meta.ctaSub, W / 2, LAYOUT.countersY + 92, font(600, 32), COLORS.text, { alpha: outroK * 0.9 })
    }
  }

  private drawConfetti(t: number) {
    const ctx = this.ctx
    for (const p of this.confetti) {
      const st = confettoState(p, t)
      if (!st || st.y > H + 40) continue
      const cos = Math.cos(st.rot), sin = Math.sin(st.rot)
      ctx.setTransform(cos, sin, -sin * st.flip, cos * st.flip, st.x, st.y)
      ctx.globalAlpha = st.alpha
      ctx.fillStyle = p.color
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
  }
}
