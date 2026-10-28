import type { Board } from './grid'

// Piece-relative directions: 0 up, 1 right, 2 down, 3 left. Each walk leads from the root to one block.
export const PIECES = {
  I: [[], [3], [1], [1, 1]],
  O: [[], [1], [0], [1, 0]],
  T: [[], [3], [1], [0]],
  S: [[], [3], [0], [0, 1]],
  Z: [[], [1], [0], [0, 3]],
  J: [[], [3], [1], [3, 0]],
  L: [[], [3], [1], [1, 0]],
} as const
export type Kind = keyof typeof PIECES
export const KINDS = Object.keys(PIECES) as Kind[]

export type Piece = { kind: Kind; root: number; frame: number }

const mod4 = (n: number) => ((n % 4) + 4) % 4

/** Crosses edge `edge` of `cell`; returns the neighbour and the frame carried across. */
export function step(board: Board, cell: number, frame: number, edge: number): [number, number] {
  const n = board.cells[cell].nb[edge]
  if (n < 0) return [-1, frame]
  const d = mod4(edge - frame)
  const back = board.cells[n].nb.indexOf(cell)
  return [n, mod4(back - d - 2)]
}

/** Frame in `to` whose edge 0 faces the same way as edge `frame` of `from` (for moves across a corner). */
export function align(board: Board, from: number, frame: number, to: number) {
  const facing = (c: number, k: number) => {
    const { poly, cx, cy } = board.cells[c]
    const [a, b] = [poly[k], poly[(k + 1) % 4]]
    return Math.atan2((a.y + b.y) / 2 - cy, (a.x + b.x) / 2 - cx)
  }
  const want = facing(from, frame)
  const off = (k: number) => Math.abs(Math.atan2(Math.sin(facing(to, k) - want), Math.cos(facing(to, k) - want)))
  return [0, 1, 2, 3].reduce((best, k) => (off(k) < off(best) ? k : best))
}

/** Cells a piece covers, or null if a walk leaves the board or two blocks land on one cell. */
export function blocks(board: Board, p: Piece): number[] | null {
  const out: number[] = []
  for (const walk of PIECES[p.kind]) {
    let [cur, f] = [p.root, p.frame]
    for (const d of walk) {
      ;[cur, f] = step(board, cur, f, mod4(f + d))
      if (cur < 0) return null
    }
    if (out.includes(cur)) return null
    out.push(cur)
  }
  return out
}

export type LockResult = { locked: number[]; cleared: number[]; falls: [number, number][] }

export class Game {
  grid: (Kind | null)[]
  piece: Piece | null = null
  next: Kind
  score = 0
  lines = 0
  over = false
  private bag: Kind[] = []

  constructor(public board: Board, private rand: () => number = Math.random) {
    this.grid = board.cells.map(() => null)
    this.next = this.draw()
    this.spawn()
  }

  get level() {
    return Math.floor(this.lines / 10) + 1
  }

  get interval() {
    return Math.max(80, 800 - (this.level - 1) * 70)
  }

  cells(p = this.piece) {
    return p ? blocks(this.board, p) : null
  }

  private draw(): Kind {
    if (!this.bag.length) {
      this.bag = [...KINDS]
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1))
        ;[this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]
      }
    }
    return this.bag.pop()!
  }

  private fits(p: Piece) {
    const c = blocks(this.board, p)
    return !!c && c.every((i) => this.grid[i] === null)
  }

  private spawn() {
    this.piece = { kind: this.next, root: this.board.spawn, frame: this.board.spawnFrame }
    this.next = this.draw()
    if (!this.fits(this.piece)) this.over = true
  }

  /** Moves the root to its left/right neighbour, or to the first downward neighbour that fits. */
  move(dir: 'down' | 'left' | 'right') {
    const p = this.piece
    if (!p || this.over) return false
    const cell = this.board.cells[p.root]
    for (const to of dir === 'down' ? cell.downs : cell[dir]) {
      const edge = cell.nb.indexOf(to)
      const [root, frame] = edge >= 0 ? step(this.board, p.root, p.frame, edge) : [to, align(this.board, p.root, p.frame, to)]
      const moved = { ...p, root, frame }
      if (!this.fits(moved)) continue
      this.piece = moved
      return true
    }
    return false
  }

  /** Rotates by a quarter turn; tries one step left/right as a wall kick. */
  rotate(turn: 1 | -1 = 1) {
    const p = this.piece
    if (!p || this.over) return false
    const turned = { ...p, frame: mod4(p.frame + turn) }
    this.piece = turned
    if (this.fits(turned) || this.move('left') || this.move('right')) return true
    this.piece = p
    return false
  }

  /** Gravity step: falls one cell, or locks when it cannot. */
  tick() {
    return this.move('down') ? null : this.lock()
  }

  softDrop() {
    if (this.move('down')) {
      this.score += 1
      return null
    }
    return this.lock()
  }

  hardDrop() {
    let n = 0
    while (this.move('down')) n++
    this.score += 2 * n
    return this.lock()
  }

  private lock(): LockResult | null {
    const locked = this.cells()
    if (!locked || !this.piece) return null
    for (const i of locked) this.grid[i] = this.piece.kind
    const { cells } = this.board

    // Nothing floats: a piece that cannot move down but rests on nothing (the grid's shape
    // blocked it, not a block or the floor) drops block by block, lowest first.
    const falls: [number, number][] = []
    const rests = (i: number) => cells[i].down < 0 || (this.grid[cells[i].down] !== null && !locked.includes(cells[i].down))
    if (!locked.some(rests))
      for (const from of [...locked].sort((a, b) => cells[b].cy - cells[a].cy)) {
        let at = from
        while (cells[at].down >= 0 && this.grid[cells[at].down] === null) {
          this.grid[cells[at].down] = this.grid[at]
          this.grid[at] = null
          at = cells[at].down
        }
        if (at !== from) falls.push([from, at])
      }

    const byLine = new Map<number, number[]>()
    cells.forEach((c, i) => byLine.set(c.line, [...(byLine.get(c.line) ?? []), i]))
    const full = [...byLine.keys()].filter((l) => byLine.get(l)!.every((i) => this.grid[i] !== null))
    const cleared = full.flatMap((l) => byLine.get(l)!)
    for (const i of cleared) this.grid[i] = null

    // Each block falls until it has dropped one line per cleared line below it.
    // ponytail: irregular grids can leave gaps after a clear; full cascade if it plays badly.
    const order = cells.map((_, i) => i).filter((i) => this.grid[i] !== null).sort((a, b) => cells[a].line - cells[b].line)
    for (const from of order) {
      const target = cells[from].line - full.filter((l) => l < cells[from].line).length
      let at = from
      while (cells[at].line > target && cells[at].down >= 0 && this.grid[cells[at].down] === null) {
        const to = cells[at].down
        this.grid[to] = this.grid[at]
        this.grid[at] = null
        at = to
      }
      if (at !== from) falls.push([from, at])
    }

    this.lines += full.length
    this.score += [0, 100, 300, 500, 800][Math.min(full.length, 4)] * this.level
    this.spawn()
    return { locked, cleared, falls }
  }
}
