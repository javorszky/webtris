import { Application, Container, Graphics } from 'pixi.js'
import { animate } from 'animejs'
import type { Board } from './grid'
import type { Game, Kind, LockResult } from './game'

export const COLORS: Record<Kind, number> = {
  I: 0x22d3ee,
  O: 0xfacc15,
  T: 0xa855f7,
  S: 0x4ade80,
  Z: 0xf87171,
  J: 0x60a5fa,
  L: 0xfb923c,
}
const EMPTY = 0x1e293b

export class Renderer {
  private layer = new Container()
  private base = new Container()
  private fx = new Container()
  private cells: Graphics[] = []
  private hidden = new Set<number>() // cells whose block is still falling in an animation
  private board!: Board
  private unit = 1

  private constructor(private app: Application, private host: HTMLElement) {
    app.stage.addChild(this.layer)
    this.layer.addChild(this.base, this.fx)
    new ResizeObserver(() => this.fit()).observe(host)
  }

  static async create(host: HTMLElement) {
    const app = new Application()
    await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: devicePixelRatio })
    host.appendChild(app.canvas)
    return new Renderer(app, host)
  }

  setBoard(board: Board) {
    this.board = board
    for (const g of this.cells) g.destroy()
    this.fx.removeChildren().forEach((c) => c.destroy())
    this.hidden.clear()
    const area = board.cells.reduce((s, c) => s + polyArea(c.poly), 0) / board.cells.length
    this.unit = Math.sqrt(area)
    this.cells = board.cells.map((_, i) => this.shape(i, 0x020617))
    this.base.addChild(...this.cells)
    this.fit()
  }

  // A polygon drawn around the cell centroid, so scale tweens grow from the middle.
  private shape(i: number, stroke: number) {
    const c = this.board.cells[i]
    const g = new Graphics()
      .poly(c.poly.map((p) => ({ x: p.x - c.cx, y: p.y - c.cy })))
      .fill(0xffffff)
      .stroke({ width: this.unit * 0.08, color: stroke, alignment: 0.5 })
    g.position.set(c.cx, c.cy)
    return g
  }

  private fit() {
    if (!this.board) return
    const xs = this.board.cells.flatMap((c) => c.poly.map((p) => p.x))
    const ys = this.board.cells.flatMap((c) => c.poly.map((p) => p.y))
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const { clientWidth: w, clientHeight: h } = this.host
    const s = Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.96
    this.layer.scale.set(s)
    this.layer.position.set((w - (maxX - minX) * s) / 2 - minX * s, (h - (maxY - minY) * s) / 2 - minY * s)
  }

  draw(game: Game) {
    const active = new Set(game.cells() ?? [])
    this.cells.forEach((g, i) => {
      const kind = active.has(i) ? game.piece!.kind : this.hidden.has(i) ? null : game.grid[i]
      g.tint = kind ? COLORS[kind] : EMPTY
    })
  }

  /** Fading copy of the piece where a hard drop started. */
  trail(cells: number[], kind: Kind) {
    for (const i of cells) {
      const g = this.fx.addChild(this.shape(i, COLORS[kind]))
      g.tint = COLORS[kind]
      animate(g, { alpha: [0.5, 0], duration: 250, ease: 'outQuad', onComplete: () => g.destroy() })
    }
  }

  lock(res: LockResult, game: Game) {
    for (const i of res.locked) this.flash(i, 0.7, 1, 220, 0)
    res.cleared
      .sort((a, b) => this.board.cells[a].cx - this.board.cells[b].cx)
      .forEach((i, n) => this.flash(i, 1, 1.5, 380, n * 12))

    for (const [from, to] of res.falls) {
      const kind = game.grid[to]!
      const { cx, cy } = this.board.cells[to]
      const g = this.fx.addChild(this.shape(from, 0x020617))
      g.tint = COLORS[kind]
      this.hidden.add(to)
      animate(g, {
        x: cx,
        y: cy,
        duration: 260,
        delay: 180,
        ease: 'inQuad',
        onComplete: () => {
          this.hidden.delete(to)
          g.destroy()
          this.draw(game)
        },
      })
    }
  }

  private flash(i: number, alpha: number, scale: number, duration: number, delay: number) {
    const g = this.fx.addChild(this.shape(i, 0xffffff))
    animate(g, { alpha: [alpha, 0], duration, delay, ease: 'outQuad', onComplete: () => g.destroy() })
    animate(g.scale, { x: [1, scale], y: [1, scale], duration, delay, ease: 'outQuad' })
  }
}

function polyArea(p: { x: number; y: number }[]) {
  let s = 0
  p.forEach((a, k) => {
    const b = p[(k + 1) % p.length]
    s += a.x * b.y - b.x * a.y
  })
  return Math.abs(s) / 2
}
