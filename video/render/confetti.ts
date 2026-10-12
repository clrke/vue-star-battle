/** Closed-form confetti (linear drag + gravity): position is a pure function of time. */
import type { Rng } from '../rng'
import { randRange, pick } from '../rng'

export interface Confetto {
  t0: number; x0: number; y0: number; vx: number; vy: number
  k: number; g: number; life: number
  w: number; h: number; color: string
  rot0: number; vrot: number; flip0: number; vflip: number
  sway: number; swayW: number; swayP: number
}

export function burst(rng: Rng, t0: number, x: number, y: number, count: number, angleDeg: number,
  spreadDeg: number, speed: [number, number], colors: readonly string[]): Confetto[] {
  const out: Confetto[] = []
  for (let i = 0; i < count; i++) {
    const a = ((angleDeg + randRange(rng, -spreadDeg, spreadDeg)) * Math.PI) / 180
    const v = randRange(rng, speed[0], speed[1])
    out.push({
      t0: t0 + randRange(rng, 0, 0.06), x0: x, y0: y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      k: randRange(rng, 1.4, 2.6), g: randRange(rng, 1100, 1700), life: randRange(rng, 3.2, 4.8),
      w: randRange(rng, 12, 22), h: randRange(rng, 7, 12), color: pick(rng, colors),
      rot0: randRange(rng, 0, Math.PI * 2), vrot: randRange(rng, -9, 9),
      flip0: randRange(rng, 0, Math.PI * 2), vflip: randRange(rng, 6, 16),
      sway: randRange(rng, 6, 26), swayW: randRange(rng, 2, 5), swayP: randRange(rng, 0, Math.PI * 2),
    })
  }
  return out
}

/** Gentle rain from above the frame. */
export function rain(rng: Rng, t0: number, dur: number, count: number, width: number, colors: readonly string[]): Confetto[] {
  const out: Confetto[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      t0: t0 + randRange(rng, 0, dur), x0: randRange(rng, 0, width), y0: -30,
      vx: randRange(rng, -60, 60), vy: randRange(rng, 80, 220),
      k: randRange(rng, 1.8, 2.6), g: randRange(rng, 500, 800), life: 4.5,
      w: randRange(rng, 12, 20), h: randRange(rng, 7, 11), color: pick(rng, colors),
      rot0: randRange(rng, 0, Math.PI * 2), vrot: randRange(rng, -6, 6),
      flip0: randRange(rng, 0, Math.PI * 2), vflip: randRange(rng, 5, 12),
      sway: randRange(rng, 15, 40), swayW: randRange(rng, 1.5, 3.5), swayP: randRange(rng, 0, Math.PI * 2),
    })
  }
  return out
}

export function confettoState(p: Confetto, t: number) {
  const dt = t - p.t0
  if (dt < 0 || dt > p.life) return null
  const e = Math.exp(-p.k * dt)
  const x = p.x0 + (p.vx / p.k) * (1 - e) + p.sway * Math.sin(p.swayW * dt + p.swayP) * Math.min(1, dt * 2)
  const y = p.y0 + (p.g / p.k) * dt + ((p.vy - p.g / p.k) / p.k) * (1 - e)
  const alpha = Math.min(1, (p.life - dt) / 0.6)
  return { x, y, rot: p.rot0 + p.vrot * dt, flip: Math.cos(p.flip0 + p.vflip * dt), alpha }
}
