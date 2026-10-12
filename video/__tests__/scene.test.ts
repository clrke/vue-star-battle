import { describe, it, expect } from 'vitest'
import { traceDfs } from '../trace'
import { buildTimeline } from '../timeline'
import { buildSceneModel } from '../render/model'
import { SceneRenderer, type SceneMeta } from '../render/scene'
import { W, H } from '../render/theme'
import { PUZZLE_8 } from './fixtures'

const trace = traceDfs(PUZZLE_8, 'row')
const tl = buildTimeline(trace)
const model = buildSceneModel(PUZZLE_8, tl, trace.solution, 'row')
const meta: SceneMeta = { puzzleNumber: 7, cpuMs: 0.3, cta: '★ TEST ★', ctaSub: 'sub', fps: 60 }
const frame = (sc: SceneRenderer, t: number) => Buffer.from(sc.render(t).data())

describe('SceneRenderer', () => {
  it('renders full-size, fully opaque RGBA frames', () => {
    const data = frame(new SceneRenderer(model, meta, 1), 0)
    expect(data.length).toBe(W * H * 4)
    for (let i = 3; i < data.length; i += 4 * 7919) expect(data[i]).toBe(255)
  })

  it('is a pure function of time: frame order and instance do not matter', () => {
    const a = new SceneRenderer(model, meta, 1)
    const t = tl.tSolve + 0.5 // mid-celebration: flash, sweep, confetti all in play
    const first = frame(a, t)
    a.render(3.3); a.render(0); a.render(tl.tEnd - 0.01)
    expect(frame(a, t).equals(first)).toBe(true)
    expect(frame(new SceneRenderer(model, meta, 1), t).equals(first)).toBe(true)
  })

  it('animates: the solved end screen differs from the opening frame', () => {
    const sc = new SceneRenderer(model, meta, 1)
    expect(frame(sc, 0).equals(frame(sc, tl.tEnd - 0.1))).toBe(false)
  })
})
