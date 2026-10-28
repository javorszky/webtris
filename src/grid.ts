import { blocks, KINDS } from './game'

export type Vec = { x: number; y: number }

export type Cell = {
  poly: Vec[] // clockwise on screen (y down); edge k runs poly[k] -> poly[k+1]
  cx: number
  cy: number
  nb: number[] // neighbour across edge k, or -1 for a wall
  line: number // row / band / ring; 0 is nearest the gravity target
  down: number
  downs: number[] // every neighbour that moves toward gravity, best first; down === downs[0]
  left: number[] // sideways candidates, best first
  right: number[]
}

export type Board = { cells: Cell[]; spawn: number; spawnFrame: number }

export function rng(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const centroid = (pts: Vec[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
})

// Neighbours with a positive score, best first.
function ranked(c: Cell, cells: Cell[], score: (n: Cell) => number) {
  return c.nb
    .filter((n) => n >= 0 && score(cells[n]) > 1e-6)
    .sort((a, b) => score(cells[b]) - score(cells[a]))
}


// Frame whose edge 0 faces most "up" (away from gravity, given as a unit vector).
function upEdge(c: Cell, gx: number, gy: number) {
  let pick = 0
  let top = -Infinity
  c.poly.forEach((p, k) => {
    const q = c.poly[(k + 1) % 4]
    const s = -(((p.x + q.x) / 2 - c.cx) * gx + ((p.y + q.y) / 2 - c.cy) * gy)
    if (s > top) [top, pick] = [s, k]
  })
  return pick
}

// Nearest cell to (x, y) where every piece fits with edge 0 facing up (away from gravity g).
function spawnAt(cells: Cell[], x: number, y: number, g: (c: Cell) => [number, number]): Board {
  const order = cells.map((_, i) => i).sort((a, b) =>
    Math.hypot(cells[a].cx - x, cells[a].cy - y) - Math.hypot(cells[b].cx - x, cells[b].cy - y))
  for (const spawn of order) {
    const board = { cells, spawn, spawnFrame: upEdge(cells[spawn], ...g(cells[spawn])) }
    if (KINDS.every((kind) => blocks(board, { kind, root: spawn, frame: board.spawnFrame }))) return board
  }
  throw new Error('no spawn cell fits every piece')
}

function nearest(cells: Cell[], x: number, y: number) {
  let pick = 0
  cells.forEach((c, i) => {
    if (Math.hypot(c.cx - x, c.cy - y) < Math.hypot(cells[pick].cx - x, cells[pick].cy - y)) pick = i
  })
  return pick
}

export function squareBoard(cols = 10, rows = 20): Board {
  const cells: Cell[] = []
  const at = (r: number, c: number) => (r < 0 || r >= rows || c < 0 || c >= cols ? -1 : r * cols + c)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({
        poly: [{ x: c, y: r }, { x: c + 1, y: r }, { x: c + 1, y: r + 1 }, { x: c, y: r + 1 }],
        cx: c + 0.5,
        cy: r + 0.5,
        nb: [at(r - 1, c), at(r, c + 1), at(r + 1, c), at(r, c - 1)],
        line: rows - 1 - r,
        down: at(r + 1, c),
        downs: r + 1 < rows ? [at(r + 1, c)] : [],
        left: c > 0 ? [at(r, c - 1)] : [],
        right: c + 1 < cols ? [at(r, c + 1)] : [],
      })
  return { cells, spawn: at(1, Math.floor((cols - 1) / 2)), spawnFrame: 0 }
}

const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)

// Townscaper-style mesh: tri lattice -> random tri-pair merge -> split all to quads -> relax.
function townscaperMesh(seed: number, cols: number, rows: number, keep: (x: number, y: number) => boolean) {
  const rand = rng(seed)
  const h = Math.sqrt(3) / 2
  const V: Vec[] = []
  const vid = new Map<string, number>()
  const P = (j: number, i: number) => {
    const k = `${j},${i}`
    if (!vid.has(k)) {
      vid.set(k, V.length)
      V.push({ x: i + (j % 2) / 2, y: j * h })
    }
    return vid.get(k)!
  }
  const tris: number[][] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const pair =
        j % 2 === 0
          ? [[P(j, i), P(j, i + 1), P(j + 1, i)], [P(j, i + 1), P(j + 1, i + 1), P(j + 1, i)]]
          : [[P(j, i), P(j + 1, i + 1), P(j + 1, i)], [P(j, i), P(j, i + 1), P(j + 1, i + 1)]]
      for (const t of pair) {
        const c = centroid(t.map((v) => V[v]))
        if (keep(c.x, c.y)) tris.push(t)
      }
    }

  const triEdges = new Map<string, number[]>()
  tris.forEach((t, ti) => t.forEach((v, k) => {
    const e = ek(v, t[(k + 1) % 3])
    triEdges.set(e, [...(triEdges.get(e) ?? []), ti])
  }))
  const shared = [...triEdges.entries()].filter(([, l]) => l.length === 2)
  for (let i = shared.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[shared[i], shared[j]] = [shared[j], shared[i]]
  }
  const used = new Set<number>()
  const polys: number[][] = []
  for (const [e, [a, b]] of shared) {
    if (used.has(a) || used.has(b) || rand() < 0.15) continue
    used.add(a)
    used.add(b)
    const [u, v] = e.split('_').map(Number)
    const A = tris[a]
    const ka = A.findIndex((x) => x !== u && x !== v)
    polys.push([A[ka], A[(ka + 1) % 3], tris[b].find((x) => x !== u && x !== v)!, A[(ka + 2) % 3]])
  }
  tris.forEach((t, i) => used.has(i) || polys.push(t))
  return quadify(V, polys).cells
}

/**
 * Splits every polygon into quads (one per corner, meeting at the centroid), then relaxes
 * with the boundary pinned. corner[i] is the polygon vertex that cell i was cut around.
 */
function quadify(V: Vec[], polys: number[][]) {
  const mids = new Map<string, number>()
  const M = (a: number, b: number) => {
    const k = ek(a, b)
    if (!mids.has(k)) {
      mids.set(k, V.length)
      V.push({ x: (V[a].x + V[b].x) / 2, y: (V[a].y + V[b].y) / 2 })
    }
    return mids.get(k)!
  }
  const quads: number[][] = []
  const corner: number[] = []
  const parent: number[] = []
  polys.forEach((p, pi) => {
    const n = p.length
    const c = V.length
    V.push(centroid(p.map((v) => V[v])))
    for (let i = 0; i < n; i++) {
      quads.push([p[i], M(p[i], p[(i + 1) % n]), c, M(p[(i - 1 + n) % n], p[i])])
      corner.push(p[i])
      parent.push(pi)
    }
  })
  // Same winding everywhere, so frame transport never mirrors a piece.
  for (const q of quads) if (area(q.map((v) => V[v])) < 0) q.reverse()

  const quadEdges = new Map<string, number[]>()
  quads.forEach((q, qi) => q.forEach((v, k) => {
    const e = ek(v, q[(k + 1) % 4])
    quadEdges.set(e, [...(quadEdges.get(e) ?? []), qi])
  }))
  const pinned = new Set<number>()
  for (const [e, l] of quadEdges) if (l.length === 1) e.split('_').forEach((v) => pinned.add(+v))

  // Stålberg squaring: pull each quad toward its best-fit square, scaled to the mean
  // cell size so cells even out in size as well as shape. Boundary stays pinned.
  const meanArea = quads.reduce((s, q) => s + area(q.map((v) => V[v])), 0) / 2 / quads.length
  const radius = Math.sqrt(meanArea / 2) // centre-to-corner distance of a square of that area
  for (let it = 0; it < 40; it++) {
    const F = V.map(() => ({ x: 0, y: 0 }))
    for (const q of quads) {
      const c = centroid(q.map((v) => V[v]))
      let vx = 0
      let vy = 0
      q.forEach((v, k) => {
        let [dx, dy] = [V[v].x - c.x, V[v].y - c.y]
        for (let r = 0; r < k; r++) [dx, dy] = [dy, -dx]
        vx += dx / 4
        vy += dy / 4
      })
      const len = Math.hypot(vx, vy) || 1
      ;[vx, vy] = [(vx / len) * radius, (vy / len) * radius]
      q.forEach((v, k) => {
        let [tx, ty] = [vx, vy]
        for (let r = 0; r < k; r++) [tx, ty] = [-ty, tx]
        F[v].x += c.x + tx - V[v].x
        F[v].y += c.y + ty - V[v].y
      })
    }
    V.forEach((v, i) => {
      if (pinned.has(i)) return
      v.x += F[i].x * 0.25
      v.y += F[i].y * 0.25
    })
  }

  const cells = quads.map((q, qi) => {
    const poly = q.map((v) => ({ ...V[v] }))
    const c = centroid(poly)
    const nb = q.map((v, k) => {
      const l = quadEdges.get(ek(v, q[(k + 1) % 4]))!
      return l.length === 2 ? (l[0] === qi ? l[1] : l[0]) : -1
    })
    return { poly, cx: c.x, cy: c.y, nb, line: 0, down: -1, downs: [], left: [], right: [] } as Cell
  })
  return { cells, corner, parent }
}

function area(p: Vec[]) {
  let s = 0
  p.forEach((a, k) => {
    const b = p[(k + 1) % p.length]
    s += a.x * b.y - b.x * a.y
  })
  return s
}

// Keeps cells where keep(i) is true; remaps neighbour indices.
function crop(cells: Cell[], keep: (i: number) => boolean) {
  const map = new Map<number, number>()
  const out: Cell[] = []
  cells.forEach((c, i) => {
    if (!keep(i)) return
    map.set(i, out.length)
    out.push(c)
  })
  for (const c of out) c.nb = c.nb.map((n) => map.get(n) ?? -1)
  return out
}

/**
 * Rectangular well built upwards from a flat floor, one triangle-lattice row at a time.
 * Walls cut the lattice at x = 0 and x = cols, so edge cells keep their natural shape.
 * Triangles merge into quads only along their row; after the quad split, each lattice
 * row divides into a lower and an upper strip of cells. Each strip is one clean band
 * running wall to wall, so the well has 2 * rows bands of about 10 cells each.
 */
const MERGE = 0.6

export function townscaperWell(seed: number, cols = 4, rows = 10): Board {
  const rand = rng(seed)
  const h = Math.sqrt(3) / 2
  const V: Vec[] = []
  const vLine: number[] = [] // lattice line of each lattice vertex
  const vid = new Map<string, number>()
  // Lattice line L sits at y = (rows - L) * h, so line 0 is the floor. Its points are
  // offset by half a unit on odd lines, plus the two wall points.
  const line = (L: number) => {
    const xs = new Set([0, cols])
    for (let x = (L % 2) / 2; x < cols; x++) if (x > 0) xs.add(x)
    return [...xs].sort((a, b) => a - b).map((x) => {
      const k = `${L},${x}`
      if (!vid.has(k)) {
        vid.set(k, V.length)
        vLine.push(L)
        V.push({ x, y: (rows - L) * h })
      }
      return vid.get(k)!
    })
  }

  const polys: number[][] = []
  const polyRow: number[] = []
  for (let r = 0; r < rows; r++) {
    const [bot, top] = [line(r), line(r + 1)]
    // Zip the two lines into triangles; each is a [bottom range, top range] of indices.
    const tris: [number, number, number, number][] = []
    for (let b = 0, t = 0; b < bot.length - 1 || t < top.length - 1; ) {
      const stepBottom = t === top.length - 1 || (b < bot.length - 1 && V[bot[b + 1]].x < V[top[t + 1]].x)
      tris.push(stepBottom ? [b, b + 1, t, t] : [b, b, t, t + 1])
      stepBottom ? b++ : t++
    }
    // Half-width triangles at the walls always merge, so wall cells are not tiny.
    const half = (i: number) => i === 0 || i === tris.length - 1
    for (let i = 0; i < tris.length; i++) {
      let [b0, b1, t0, t1] = tris[i]
      const isHalf = half(i) && Math.abs(V[bot[b1]].x - V[bot[b0]].x + V[top[t1]].x - V[top[t0]].x) < 0.75
      if (i + 1 < tris.length && (isHalf || half(i + 1) || rand() < MERGE)) [, b1, , t1] = tris[++i]
      const poly = [...bot.slice(b0, b1 + 1), ...top.slice(t0, t1 + 1).reverse()]
      polys.push(poly)
      polyRow.push(r)
    }
  }
  const { cells, corner, parent } = quadify(V, polys)
  cells.forEach((c, i) => {
    const r = polyRow[parent[i]]
    c.line = 2 * r + (vLine[corner[i]] === r ? 0 : 1)
  })
  for (const c of cells) {
    // Fall to a lower band first; within a band only slide downhill.
    c.downs = ranked(c, cells, (n) => (n.line < c.line ? 100 : n.line === c.line ? 0 : -100) + n.cy - c.cy)
    c.down = c.downs[0] ?? -1
    // Steer along the band first, then to any neighbour on that side.
    const side = (sign: number) =>
      ranked(c, cells, (n) => sign * (n.cx - c.cx)).sort(
        (a, b) => Number(cells[a].line !== c.line) - Number(cells[b].line !== c.line),
      )
    c.left = side(-1)
    c.right = side(1)
  }
  const top = Math.min(...cells.map((c) => c.cy))
  return spawnAt(cells, cols / 2, top + 0.6, () => [0, 1])
}

/** True when every line's cells form one edge-connected group. */
export function linesConnected(cells: Cell[]) {
  const lines = new Map<number, number[]>()
  cells.forEach((c, i) => lines.set(c.line, [...(lines.get(c.line) ?? []), i]))
  return [...lines.values()].every((line) => {
    const seen = new Set([line[0]])
    const stack = [line[0]]
    while (stack.length)
      for (const n of cells[stack.pop()!].nb)
        if (n >= 0 && cells[n].line === cells[line[0]].line && !seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
    return seen.size === line.length
  })
}

/**
 * Disc, gravity toward the centre, lines are vertex-layer rings: ring k+1 is every
 * cell sharing a vertex with ring k, so each ring is a closed, edge-connected loop.
 * The centre cell becomes a solid core; rings that touch the outer boundary are cropped.
 * A rare pocket in the layer growth can split a ring; such meshes are rejected for the next seed.
 */
export function townscaperDisc(seed: number, radius = 9): Board {
  const h = Math.sqrt(3) / 2
  const cols = Math.ceil(radius * 2) + 2
  const rows = Math.ceil((radius * 2) / h) + 2
  const ox = cols / 2 + 0.25
  const oy = (rows * h) / 2
  let cells = townscaperMesh(seed, cols, rows, (x, y) => Math.hypot(x - ox, y - oy) <= radius)

  const key = (p: Vec) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`
  const byVertex = new Map<string, number[]>()
  cells.forEach((c, i) => c.poly.forEach((p) => byVertex.set(key(p), [...(byVertex.get(key(p)) ?? []), i])))
  const ring = cells.map(() => -1)
  const core = nearest(cells, ox, oy)
  ring[core] = 0
  for (let k = 0, cur = [core]; cur.length; k++) {
    const next = new Set<number>()
    for (const i of cur)
      for (const p of cells[i].poly)
        for (const j of byVertex.get(key(p))!)
          if (ring[j] < 0) {
            ring[j] = k + 1
            next.add(j)
          }
    cur = [...next]
  }
  let last = Infinity
  cells.forEach((c, i) => c.nb.includes(-1) && (last = Math.min(last, ring[i] - 1)))
  cells.forEach((c, i) => (c.line = ring[i] - 1))
  cells = crop(cells, (i) => ring[i] >= 1 && ring[i] <= last)
  if (!linesConnected(cells)) return townscaperDisc(seed + 1, radius)

  const dist = (c: Cell) => Math.hypot(c.cx - ox, c.cy - oy)
  for (const c of cells) {
    const [rx, ry] = [(c.cx - ox) / dist(c), (c.cy - oy) / dist(c)]
    c.downs = ranked(c, cells, (n) => (n.line < c.line ? 100 : n.line === c.line ? 0 : -100) + dist(c) - dist(n))
    c.down = c.downs[0] ?? -1
    const side = (sign: number) =>
      ranked(c, cells, (n) => sign * ((n.cx - c.cx) * -ry + (n.cy - c.cy) * rx)).sort(
        (a, b) => Math.min(0, dist(c) - dist(cells[b])) - Math.min(0, dist(c) - dist(cells[a])),
      )
    c.right = side(1)
    c.left = side(-1)
  }
  const top = Math.min(...cells.map((c) => c.cy))
  return spawnAt(cells, ox, top + 0.6, (c) => [-(c.cx - ox) / dist(c), -(c.cy - oy) / dist(c)])
}
