/**
 * Channel art for "Star Battle Daily": logo (800×800, YouTube shows it as a circle) and banner
 * (2560×1440; the centre 1546×423 is the safe area visible on every device).
 *
 *   npx tsx video/branding.ts [out-dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { REGION_COLORS, COLORS, font } from './render/theme'
import { goldStar, glowDisc, STAR_FRACTION } from './render/sprites'

// A real, uniquely solvable 5×5 puzzle, shown solved.
const GRID = [
  [1, 0, 0, 0, 3],
  [1, 0, 0, 0, 3],
  [1, 1, 2, 2, 3],
  [4, 2, 2, 3, 3],
  [4, 4, 2, 2, 3],
]
/** Its unique solution (checked with src/solver/solver.ts). */
const STARS: [number, number][] = [[0, 3], [1, 0], [2, 2], [3, 4], [4, 1]]

function background(ctx: SKRSContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, COLORS.bgTop); g.addColorStop(1, COLORS.bgBottom)
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  const r = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6)
  r.addColorStop(0, 'rgba(90,110,255,0.22)'); r.addColorStop(1, 'rgba(90,110,255,0)')
  ctx.fillStyle = r; ctx.fillRect(0, 0, w, h)
  // faint starfield (deterministic)
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  ctx.fillStyle = '#fff'
  for (let i = 0; i < (w * h) / 9000; i++) {
    ctx.globalAlpha = 0.2 + 0.5 * rnd()
    ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.8 + 1.6 * rnd(), 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Pastel mini board with gold stars; `hero` = index of the star drawn big and glowing. */
function board(ctx: SKRSContext2D, x: number, y: number, size: number, hero: number) {
  const n = GRID.length, c = size / n
  ctx.save()
  ctx.shadowColor = 'rgba(255,200,70,0.55)'; ctx.shadowBlur = size * 0.12
  ctx.fillStyle = COLORS.boardFrame
  ctx.beginPath(); ctx.roundRect(x - c * 0.18, y - c * 0.18, size + c * 0.36, size + c * 0.36, c * 0.35); ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath(); ctx.roundRect(x, y, size, size, c * 0.2); ctx.clip()
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    ctx.fillStyle = REGION_COLORS[[0, 2, 3, 4, 5][GRID[r][k]]]
    ctx.fillRect(x + k * c, y + r * c, c + 0.5, c + 0.5)
  }
  ctx.strokeStyle = COLORS.gridLine; ctx.lineWidth = c * 0.03; ctx.beginPath()
  for (let i = 1; i < n; i++) { ctx.moveTo(x + i * c, y); ctx.lineTo(x + i * c, y + size); ctx.moveTo(x, y + i * c); ctx.lineTo(x + size, y + i * c) }
  ctx.stroke()
  ctx.strokeStyle = COLORS.regionBorder; ctx.lineWidth = c * 0.09; ctx.lineCap = 'round'; ctx.beginPath()
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    if (k + 1 < n && GRID[r][k] !== GRID[r][k + 1]) { ctx.moveTo(x + (k + 1) * c, y + r * c); ctx.lineTo(x + (k + 1) * c, y + (r + 1) * c) }
    if (r + 1 < n && GRID[r][k] !== GRID[r + 1][k]) { ctx.moveTo(x + k * c, y + (r + 1) * c); ctx.lineTo(x + (k + 1) * c, y + (r + 1) * c) }
  }
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = COLORS.regionBorder; ctx.lineWidth = c * 0.12
  ctx.beginPath(); ctx.roundRect(x, y, size, size, c * 0.2); ctx.stroke()
  const star = goldStar(), glow = glowDisc('255,214,102')
  STARS.forEach(([r, k], i) => {
    const cx = x + (k + 0.5) * c, cy = y + (r + 0.5) * c
    const big = i === hero
    if (big) { const g = c * 1.6; ctx.globalAlpha = 0.85; ctx.drawImage(glow, cx - g, cy - g, g * 2, g * 2); ctx.globalAlpha = 1 }
    const d = (c * (big ? 1.25 : 0.82)) / STAR_FRACTION
    ctx.drawImage(star, cx - d / 2, cy - d / 2, d, d)
  })
}

function text(ctx: SKRSContext2D, s: string, x: number, y: number, px: number, fill: string, weight = 900, glow?: string) {
  ctx.save()
  ctx.font = font(weight, px); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = px * 0.35 }
  ctx.lineJoin = 'round'; ctx.lineWidth = px * 0.12; ctx.strokeStyle = '#3a2200'
  if (fill === COLORS.gold) ctx.strokeText(s, x, y)
  ctx.fillStyle = fill; ctx.fillText(s, x, y)
  ctx.restore()
}

const out = process.argv[2] ?? 'output/branding'
mkdirSync(out, { recursive: true })

// Logo: board fills the circle-safe area, centre star big.
{
  const S = 800, cv = createCanvas(S, S), ctx = cv.getContext('2d')
  background(ctx, S, S)
  board(ctx, S * 0.17, S * 0.17, S * 0.66, 2)
  writeFileSync(join(out, 'logo-800.png'), cv.toBuffer('image/png'))
}

// Banner: everything important inside the 1546×423 centre safe area.
{
  const W = 2560, H = 1440, cv = createCanvas(W, H), ctx = cv.getContext('2d')
  background(ctx, W, H)
  const bs = 340, bx = W / 2 - 1546 / 2 + 40, by = H / 2 - bs / 2
  board(ctx, bx, by, bs, 2)
  const tx = bx + bs + 40 + (W / 2 + 1546 / 2 - (bx + bs + 40)) / 2
  text(ctx, 'STAR BATTLE DAILY', tx, H / 2 - 70, 112, COLORS.gold, 900, 'rgba(247,201,72,0.6)')
  text(ctx, 'A computer solves a logic puzzle · 3 new every day', tx, H / 2 + 40, 38, COLORS.text, 700)
  text(ctx, 'Can you beat it?', tx, H / 2 + 110, 40, COLORS.muted, 600)
  writeFileSync(join(out, 'banner-2560x1440.png'), cv.toBuffer('image/png'))
}
console.log(`wrote ${out}/logo-800.png and ${out}/banner-2560x1440.png`)
