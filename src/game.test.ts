import { describe, expect, it } from 'vitest'
import { Game, blocks, KINDS } from './game'
import { linesConnected, squareBoard, townscaperDisc, townscaperWell, type Board } from './grid'

function invariants(b: Board) {
  b.cells.forEach((c, i) => {
    expect(c.poly).toHaveLength(4)
    c.nb.forEach((n) => n >= 0 && expect(b.cells[n].nb).toContain(i))
    if (c.down < 0) expect(c.line === 0 || c.nb.includes(-1)).toBe(true)
  })
  for (const kind of KINDS) expect(blocks(b, { kind, root: b.spawn, frame: b.spawnFrame })).not.toBeNull()
}

describe('boards', () => {
  it('square board is consistent', () => invariants(squareBoard()))

  it('townscaper boards are consistent', () => {
    for (let seed = 1; seed <= 20; seed++) {
      invariants(townscaperWell(seed))
      invariants(townscaperDisc(seed))
    }
  })

  it('every disc ring is one edge-connected piece', () => {
    for (let seed = 1; seed <= 50; seed++) expect(linesConnected(townscaperDisc(seed).cells)).toBe(true)
  })
})

describe('classic rules', () => {
  const at = (r: number, c: number) => r * 10 + c

  it('rotating a T four times returns to the start', () => {
    const g = new Game(squareBoard())
    g.piece = { kind: 'T', root: at(5, 4), frame: 0 }
    const start = g.cells()!.sort()
    for (let i = 0; i < 4; i++) g.rotate()
    expect(g.cells()!.sort()).toEqual(start)
  })

  it('pieces have tetromino shapes', () => {
    const g = new Game(squareBoard())
    g.piece = { kind: 'L', root: at(5, 4), frame: 0 }
    expect(g.cells()!.sort((a, b) => a - b)).toEqual([at(4, 5), at(5, 3), at(5, 4), at(5, 5)])
    g.rotate()
    expect(g.cells()!.sort((a, b) => a - b)).toEqual([at(4, 4), at(5, 4), at(6, 4), at(6, 5)])
  })

  it('a full row clears and the rows above shift down by one', () => {
    const g = new Game(squareBoard())
    for (let c = 0; c < 10; c++) if (c < 3 || c > 6) g.grid[at(19, c)] = 'O'
    g.grid[at(18, 0)] = 'Z'
    g.piece = { kind: 'I', root: at(1, 4), frame: 0 }
    const res = g.hardDrop()!
    expect(res.cleared).toHaveLength(10)
    expect(g.lines).toBe(1)
    expect(g.grid[at(19, 0)]).toBe('Z')
    expect(g.grid.filter(Boolean)).toHaveLength(1)
  })
})
