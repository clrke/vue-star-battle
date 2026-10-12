/** Pre-rendered bitmaps (stars with glow, soft discs) — drawn scaled each frame, which is
 *  far cheaper than re-running gradients + shadow blur per star per frame. */
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'

export const SPRITE = 320
/** Star tip-to-tip diameter as a fraction of the sprite size (rest is glow margin). */
export const STAR_FRACTION = 0.62

export function starPath(ctx: SKRSContext2D, cx: number, cy: number, outer: number, inner = 0.47) {
  ctx.beginPath()
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5
    const r = k % 2 === 0 ? outer : outer * inner
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function starSprite(stops: [string, string, string], stroke: string, glow: string, glowBlur: number): Canvas {
  const cv = createCanvas(SPRITE, SPRITE)
  const ctx = cv.getContext('2d')
  const c = SPRITE / 2
  const R = (SPRITE * STAR_FRACTION) / 2
  // Outer glow
  ctx.save()
  ctx.shadowColor = glow
  ctx.shadowBlur = glowBlur
  starPath(ctx, c, c + R * 0.04, R)
  ctx.fillStyle = stops[1]
  ctx.fill()
  ctx.restore()
  // Body gradient
  const g = ctx.createLinearGradient(c, c - R, c, c + R)
  g.addColorStop(0, stops[0]); g.addColorStop(0.55, stops[1]); g.addColorStop(1, stops[2])
  starPath(ctx, c, c + R * 0.04, R)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = R * 0.07
  ctx.strokeStyle = stroke
  ctx.stroke()
  // Glossy highlight on the upper half
  ctx.save()
  starPath(ctx, c, c + R * 0.04, R * 0.8)
  ctx.clip()
  const hl = ctx.createLinearGradient(c, c - R, c, c + R * 0.2)
  hl.addColorStop(0, 'rgba(255,255,255,0.75)'); hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  ctx.beginPath()
  ctx.ellipse(c - R * 0.12, c - R * 0.35, R * 0.55, R * 0.42, -0.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return cv
}

export function goldStar(): Canvas {
  return starSprite(['#fff4b8', '#f7c948', '#e8890c'], '#b8650a', 'rgba(255, 196, 60, 0.95)', SPRITE * 0.12)
}
export function redStar(): Canvas {
  return starSprite(['#ffc2c2', '#ff5a68', '#c0293b'], '#8e1424', 'rgba(255, 70, 90, 0.95)', SPRITE * 0.12)
}
export function ghostStar(): Canvas {
  return starSprite(['#ffffff', '#cfd6ff', '#9aa6e8'], '#6b76b8', 'rgba(170, 185, 255, 0.8)', SPRITE * 0.08)
}

/** Soft radial disc, opaque centre fading to transparent. */
export function glowDisc(rgb: string, size = 256): Canvas {
  const cv = createCanvas(size, size)
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, `rgba(${rgb},1)`)
  g.addColorStop(0.35, `rgba(${rgb},0.45)`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return cv
}
