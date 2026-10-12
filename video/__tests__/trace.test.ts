import { describe, it, expect } from 'vitest'
import { generatePuzzle } from '../../src/solver/generator'
import { getSolution } from '../../src/solver/solver'
import type { Puzzle } from '../../src/types/puzzle'
import { traceDfs, eliminatedBy, unitCells, type Strategy } from '../trace'
import { mulberry32 } from '../rng'

function puzzles(): Puzzle[] {
  return [6, 7, 8].flatMap(n => [1, 2].map(seed => generatePuzzle(n, Date.now() + 10_000, mulberry32(seed * 101 + n))!))
}

/** Replays a trace, asserting every move is legal and every dead end is real. */
function replay(p: Puzzle, strategy: Strategy) {
  const tr = traceDfs(p, strategy)
  const { n } = p
  const stack: [number, number][] = []
  const elim = new Int16Array(n * n)
  const filled = (type: 'row' | 'col' | 'region', idx: number) =>
    stack.some(([r, c]) => (type === 'row' ? r : type === 'col' ? c : p.grid[r][c]) === idx)
  for (const e of tr.events) {
    if (e.kind === 'place') {
      expect(elim[e.row * n + e.col]).toBe(0)
      expect(stack.some(([r, c]) => r === e.row && c === e.col)).toBe(false)
      stack.push([e.row, e.col])
      for (const [r, c] of eliminatedBy(p, e.row, e.col)) elim[r * n + c]++
      expect(e.depth).toBe(stack.length)
    } else if (e.kind === 'remove') {
      const [r, c] = stack.pop()!
      expect([r, c]).toEqual([e.row, e.col])
      for (const [rr, cc] of eliminatedBy(p, r, c)) elim[rr * n + cc]--
      expect(e.depth).toBe(stack.length)
    } else if (e.kind === 'conflict') {
      expect(filled(e.unit.type, e.unit.index)).toBe(false)
      const open = unitCells(p, e.unit).filter(([r, c]) => elim[r * n + c] === 0 && !stack.some(([sr, sc]) => sr === r && sc === c))
      expect(open).toEqual([])
    }
  }
  return { tr, stack }
}

describe('traceDfs', () => {
  for (const strategy of ['row', 'mrv'] as const) {
    it(`${strategy}: every move is legal, every dead end is real, and it ends on the unique solution`, () => {
      for (const p of puzzles()) {
        const { tr, stack } = replay(p, strategy)
        expect(tr.events[tr.events.length - 1].kind).toBe('solved')
        const sorted = [...stack].sort((a, b) => a[0] - b[0])
        expect(sorted).toEqual(getSolution(p))
        expect(tr.solution).toEqual(getSolution(p))
        expect(tr.stats.placements - tr.stats.removals).toBe(p.n)
        expect(tr.stats.maxDepth).toBe(p.n)
      }
    })
  }

  it('row strategy fills rows strictly top to bottom', () => {
    const p = puzzles()[3]
    let depth = 0
    for (const e of traceDfs(p, 'row').events) {
      if (e.kind === 'place') { expect(e.row).toBe(depth); depth++ }
      if (e.kind === 'remove') depth--
    }
  })

  it('reports the final run (placements after the last backtrack)', () => {
    for (const p of puzzles()) {
      const tr = traceDfs(p, 'row')
      const lastRemove = tr.events.map(e => e.kind).lastIndexOf('remove')
      const after = tr.events.slice(lastRemove + 1).filter(e => e.kind === 'place').length
      expect(tr.stats.finalRun).toBe(after)
    }
  })
})
