import { describe, expect, it } from 'vitest'
import { Game, blocks, KINDS } from './game'
import { linesConnected, rng, squareBoard, townscaperDisc, townscaperWell, type Board } from './grid'

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

describe('pieces and scoring', () => {
  const at = (r: number, c: number) => r * 10 + c

  it('deals every kind once per bag of seven', () => {
    const g = new Game(squareBoard(), rng(1))
    const seen = new Set<string>()
    for (let i = 0; i < 7; i++) {
      seen.add(g.piece!.kind)
      g.hardDrop()
    }
    expect(seen).toEqual(new Set(KINDS))
  })

  it('ends the game when a new piece cannot spawn', () => {
    const g = new Game(squareBoard())
    g.grid[at(1, 4)] = 'O'
    g.grid[at(1, 3)] = 'O'
    g.grid[at(1, 5)] = 'O'
    g.piece = { kind: 'I', root: at(18, 4), frame: 0 }
    g.hardDrop()
    expect(g.over).toBe(true)
  })

  it('scores four lines at once as 800 per level', () => {
    const g = new Game(squareBoard())
    for (let r = 16; r < 20; r++) for (let c = 1; c < 10; c++) g.grid[at(r, c)] = 'O'
    g.piece = { kind: 'I', root: at(17, 0), frame: 1 } // vertical, rows 16..19
    const res = g.hardDrop()!
    expect(res.cleared).toHaveLength(40)
    expect([g.lines, g.score]).toEqual([4, 800])
  })

  it('speeds up every ten lines', () => {
    const g = new Game(squareBoard())
    expect([g.level, g.interval]).toEqual([1, 800])
    g.lines = 10
    expect([g.level, g.interval]).toEqual([2, 730])
    g.lines = 1000
    expect(g.interval).toBe(80)
  })
})

describe.each([
  ['classic', () => squareBoard()],
  ['well', () => townscaperWell(3)],
  ['disc', () => townscaperDisc(3)],
])('%s board play', (_, make) => {
  it('a piece always lands within a bounded number of steps', () => {
    for (const kind of KINDS) {
      const g = new Game(make())
      g.piece = { ...g.piece!, kind }
      let n = 0
      while (g.move('down')) expect(++n).toBeLessThan(g.board.cells.length)
      expect(g.tick()).not.toBeNull()
    }
  })

  it('filling line 0 clears it and keeps every other block', () => {
    const board = make()
    const g = new Game(board, rng(2))
    const line0 = board.cells.flatMap((c, i) => (c.line === 0 ? [i] : []))
    // An I piece that covers some line-0 cells and fits on the empty board.
    let piece = null
    for (const root of line0)
      for (let frame = 0; frame < 4 && !piece; frame++) {
        const cells = blocks(board, { kind: 'I', root, frame })
        if (cells?.some((i) => board.cells[i].line === 0)) piece = { kind: 'I' as const, root, frame }
      }
    expect(piece).not.toBeNull()
    const covered = new Set(blocks(board, piece!))
    for (const i of line0) if (!covered.has(i)) g.grid[i] = 'O'
    const rand = rng(3)
    board.cells.forEach((c, i) => {
      if (c.line >= 2 && c.line <= 4 && !covered.has(i) && rand() < 0.3) g.grid[i] = 'T'
    })
    const before = g.grid.filter(Boolean).length

    g.piece = piece
    const res = g['lock']()!
    expect(res.cleared).toEqual(expect.arrayContaining(line0))
    expect(g.grid.filter(Boolean)).toHaveLength(before + 4 - res.cleared.length)
    for (const [from, to] of res.falls) expect(board.cells[to].line).toBeLessThanOrEqual(board.cells[from].line)
  })
})
