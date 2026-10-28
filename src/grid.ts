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

/**
 * Organic quad mesh with no triangles left: tri lattice -> random perfect pairing of
 * triangles into quads -> split all to quads -> relax. The region is a union of whole
 * hexagons (6 triangles around every third lattice vertex), which always has a perfect
 * pairing; keep(x, y) picks hexagons by their centre.
 */
function organicMesh(seed: number, cols: number, rows: number, keep: (x: number, y: number) => boolean) {
  const rand = rng(seed)
  const shuffle = <T>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  const h = Math.sqrt(3) / 2
  const V: Vec[] = []
  const hexCentre: boolean[] = []
  const vid = new Map<string, number>()
  const P = (j: number, i: number) => {
    const k = `${j},${i}`
    if (!vid.has(k)) {
      vid.set(k, V.length)
      // Axial q - r taken mod 3 colours the lattice so every triangle has one vertex of each colour.
      hexCentre.push((((i - Math.floor(j / 2) - j) % 3) + 3) % 3 === 0)
      V.push({ x: i + (j % 2) / 2, y: j * h })
    }
    return vid.get(k)!
  }
  const tris: number[][] = []
  const up: boolean[] = []
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const pair =
        j % 2 === 0
          ? [[P(j, i), P(j, i + 1), P(j + 1, i)], [P(j, i + 1), P(j + 1, i + 1), P(j + 1, i)]]
          : [[P(j, i), P(j + 1, i + 1), P(j + 1, i)], [P(j, i), P(j, i + 1), P(j + 1, i + 1)]]
      pair.forEach((t, k) => {
        const centre = V[t.find((v) => hexCentre[v])!]
        if (!keep(centre.x, centre.y)) return
        tris.push(t)
        up.push((j % 2 === 0) === (k === 0)) // two corners on lattice row j
      })
    }

  const triEdges = new Map<string, number[]>()
  tris.forEach((t, ti) => t.forEach((v, k) => {
    const e = ek(v, t[(k + 1) % 3])
    triEdges.set(e, [...(triEdges.get(e) ?? []), ti])
  }))
  const adj = tris.map(() => [] as number[])
  for (const l of triEdges.values()) if (l.length === 2) adj[l[0]].push(l[1]), adj[l[1]].push(l[0])

  // Up and down triangles only touch each other, so this is bipartite matching (Kuhn's
  // augmenting paths), visited in random order for a random pairing.
  const mate = tris.map(() => -1)
  const augment = (a: number, seen: Set<number>): boolean => {
    for (const b of shuffle([...adj[a]])) {
      if (seen.has(b)) continue
      seen.add(b)
      if (mate[b] < 0 || augment(mate[b], seen)) {
        mate[a] = b
        mate[b] = a
        return true
      }
    }
    return false
  }
  for (const a of shuffle(tris.map((_, i) => i).filter((i) => up[i]))) augment(a, new Set())

  const polys: number[][] = []
  tris.forEach((A, a) => {
    const b = mate[a]
    if (b < 0) throw new Error('triangle left unpaired')
    if (b < a) return
    const shared = A.filter((v) => tris[b].includes(v))
    const ka = A.findIndex((x) => !shared.includes(x))
    polys.push([A[ka], A[(ka + 1) % 3], tris[b].find((x) => !shared.includes(x))!, A[(ka + 2) % 3]])
  })
  return quadify(V, polys)
}

/** Splits every polygon into quads (one per corner, meeting at the centroid), then relaxes with the boundary pinned. */
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
  for (const p of polys) {
    if (p.length !== 4) throw new Error(`source polygon with ${p.length} corners; boards use quads only`)
    const c = V.length
    V.push(centroid(p.map((v) => V[v])))
    for (let i = 0; i < 4; i++) quads.push([p[i], M(p[i], p[(i + 1) % 4]), c, M(p[(i + 3) % 4], p[i])])
  }
  // Same winding everywhere, so frame transport never mirrors a piece.
  for (const q of quads) if (area(q.map((v) => V[v])) < 0) q.reverse()

  const quadEdges = new Map<string, number[]>()
  quads.forEach((q, qi) => q.forEach((v, k) => {
    const e = ek(v, q[(k + 1) % 4])
    quadEdges.set(e, [...(quadEdges.get(e) ?? []), qi])
  }))
  const pinned = new Set<number>()
  for (const [e, l] of quadEdges) if (l.length === 1) e.split('_').forEach((v) => pinned.add(+v))
  relax(V, quads, pinned, [])

  return quads.map((q, qi) => {
    const poly = q.map((v) => ({ ...V[v] }))
    const c = centroid(poly)
    const nb = q.map((v, k) => {
      const l = quadEdges.get(ek(v, q[(k + 1) % 4]))!
      return l.length === 2 ? (l[0] === qi ? l[1] : l[0]) : -1
    })
    return { poly, cx: c.x, cy: c.y, nb, line: 0, down: -1, downs: [], left: [], right: [] } as Cell
  })
}

/**
 * Stålberg squaring: pulls each quad toward its best-fit square, scaled to the mean cell
 * size so cells even out in size as well as shape. Pinned vertices stay put; levelled
 * quads are nudged toward one shared centre height (roughly level is enough).
 */
function relax(V: Vec[], quads: number[][], pinned: Set<number>, levelled: number[]) {
  const cy = (qi: number) => centroid(quads[qi].map((v) => V[v])).y
  const levelY = levelled.reduce((s, qi) => s + cy(qi), 0) / (levelled.length || 1)
  const level = (k: number) => {
    for (const qi of levelled) {
      const dy = (levelY - cy(qi)) * k
      for (const v of quads[qi]) V[v].y += dy
    }
  }
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
    level(0.5)
  }
  for (let i = 0; i < 5; i++) level(1)
}

/** Relaxes existing cells again with nothing pinned (after a crop), levelling the given cells. */
function relaxCells(cells: Cell[], levelled: number[]) {
  const ids = new Map<string, number>()
  const V: Vec[] = []
  const quads = cells.map((c) =>
    c.poly.map((p) => {
      const k = `${p.x.toFixed(6)},${p.y.toFixed(6)}`
      if (!ids.has(k)) ids.set(k, V.push({ ...p }) - 1)
      return ids.get(k)!
    }),
  )
  relax(V, quads, new Set(), levelled)
  cells.forEach((c, i) => {
    c.poly = quads[i].map((v) => ({ ...V[v] }))
    const m = centroid(c.poly)
    ;[c.cx, c.cy] = [m.x, m.y]
  })
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
 * Rectangular well cut out of a larger organic quad mesh (whole hexagons, every triangle
 * paired into a quad at random). The cut keeps whole cells by their centres, so the cells
 * decide where the walls are; the piece is then relaxed again with nothing pinned and the
 * bottom row's centres held roughly level. Lines are horizontal bands one cell high,
 * counted from the floor.
 *
 * Down means down: a cell falls only to a neighbour that is lower and at most 45 degrees
 * off straight down, the most direct first; an edge neighbour beats one sharing only a
 * corner. Only if nothing qualifies does the limit widen to 60 degrees.
 */
export function organicWell(seed: number, width = 4.6, height = 9.4): Board {
  const h = Math.sqrt(3) / 2
  // Hexagons around the cut with a margin, so the cut never meets the mesh's own edge.
  const cols = Math.ceil(width) + 8
  const rows = Math.ceil(height / h) + 8
  const [x0, y0] = [4, 4 * h]
  const mesh = organicMesh(seed, cols, rows, (x, y) => x > x0 - 2 && x < x0 + width + 2 && y > y0 - 2 && y < y0 + height + 2)
  const cells = crop(mesh, (i) => {
    const c = mesh[i]
    return c.cx >= x0 && c.cx <= x0 + width && c.cy >= y0 && c.cy <= y0 + height
  })

  // Bottom row: cells with an open edge facing down.
  const facesDown = (c: Cell) =>
    c.nb.some((n, k) => n < 0 && (c.poly[k].y + c.poly[(k + 1) % 4].y) / 2 - c.cy > Math.abs((c.poly[k].x + c.poly[(k + 1) % 4].x) / 2 - c.cx))
  const floor = cells.flatMap((c, i) => (facesDown(c) && c.cy > y0 + height - 1 ? [i] : []))
  relaxCells(cells, floor)

  const size = Math.sqrt(cells.reduce((s, c) => s + Math.abs(area(c.poly)), 0) / 2 / cells.length)
  const floorY = floor.reduce((s, i) => s + cells[i].cy, 0) / floor.length

  const byCorner = new Map<string, number[]>()
  const key = (p: Vec) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`
  cells.forEach((c, i) => c.poly.forEach((p) => byCorner.set(key(p), [...(byCorner.get(key(p)) ?? []), i])))
  // Score for falling from c to n within `slope` (sideways per unit down); 0 if outside.
  const downward = (c: Cell, slope: number) => (n: Cell) => {
    const [dx, dy] = [n.cx - c.cx, n.cy - c.cy]
    return dy > 0 && Math.abs(dx) <= slope * dy ? dy - Math.abs(dx) / slope + 1e-3 : 0
  }
  for (const c of cells) {
    const touching = [...new Set(c.poly.flatMap((p) => byCorner.get(key(p))!))].filter((n) => cells[n] !== c)
    for (const slope of [1, Math.sqrt(3)]) {
      const score = downward(c, slope)
      c.downs = ranked(c, cells, score)
      if (!c.downs.length)
        c.downs = touching.filter((n) => score(cells[n]) > 0).sort((a, b) => score(cells[b]) - score(cells[a]))
      if (c.downs.length) break
    }
    c.down = c.downs[0] ?? -1
    // Sideways: neighbours on that side, the flattest first.
    const side = (sign: number) => ranked(c, cells, (n) => sign * (n.cx - c.cx) - 0.5 * Math.abs(n.cy - c.cy))
    c.left = side(-1)
    c.right = side(1)
  }
  // Band 0 is the levelled floor row plus any cell at floor height with nowhere lower to go.
  const onFloor = new Set(floor)
  for (const [i, c] of cells.entries()) {
    const band = Math.max(0, Math.round((floorY - c.cy) / size))
    c.line = onFloor.has(i) || (band === 0 && c.down < 0) ? 0 : Math.max(1, band)
  }
  const midX = cells.reduce((s, c) => s + c.cx, 0) / cells.length
  const top = Math.min(...cells.map((c) => c.cy))
  return spawnAt(cells, midX, top + 0.6, () => [0, 1])
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
export function organicDisc(seed: number, radius = 9): Board {
  const h = Math.sqrt(3) / 2
  // Two units of margin so every hexagon that keep() picks lies whole inside the lattice.
  const cols = Math.ceil(radius * 2) + 4
  const rows = Math.ceil((radius * 2) / h) + 4
  const ox = cols / 2 + 0.25
  const oy = (rows * h) / 2
  let cells = organicMesh(seed, cols, rows, (x, y) => Math.hypot(x - ox, y - oy) <= radius)

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
  if (!linesConnected(cells)) return organicDisc(seed + 1, radius)

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
