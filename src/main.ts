import './style.css'
import '@tailwindplus/elements'
import { animate } from 'animejs'
import { Game, blocks } from './game'
import { squareBoard, organicDisc, organicWell, type Board } from './grid'
import { COLORS, Renderer } from './render'

const MODES: Record<string, { name: string; board: (seed: number) => Board }> = {
  classic: { name: 'Classic', board: () => squareBoard() },
  well: { name: 'Organic well', board: organicWell },
  disc: { name: 'Organic disc', board: organicDisc },
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const menu = $<HTMLDialogElement>('menu')
const pause = $<HTMLDialogElement>('pause')
const over = $<HTMLDialogElement>('over')
const renderer = await Renderer.create($('stage'))

let game: Game | null = null
let mode = 'classic'
let paused = true
let last = 0
let acc = 0
type Action = 'left' | 'right' | 'rotate' | 'rotate-back' | 'soft-drop' | 'hard-drop' | 'pause'
const activeControls = new Set<() => void>()
const stopControls = () => activeControls.forEach((stop) => stop())

const preview = squareBoard(4, 2)
const previewCells = preview.cells.map(() => {
  const d = document.createElement('div')
  d.className = 'aspect-square rounded-sm'
  return $('next').appendChild(d)
})

function hud() {
  if (!game) return
  const score = $('score')
  if (score.textContent !== String(game.score)) {
    score.textContent = String(game.score)
    animate(score, { scale: [1.25, 1], duration: 300, ease: 'outBack' })
  }
  $('level').textContent = String(game.level)
  $('lines').textContent = String(game.lines)
  const shown = new Set(blocks(preview, { kind: game.next, root: 5, frame: 0 }))
  previewCells.forEach((d, i) => {
    d.style.background = shown.has(i) ? `#${COLORS[game!.next].toString(16).padStart(6, '0')}` : 'transparent'
  })
  renderer.draw(game)
}

function start(m: string) {
  stopControls()
  mode = m
  $('mode').textContent = MODES[m].name
  game = new Game(MODES[m].board(Math.floor(Math.random() * 1e9)))
  renderer.setBoard(game.board)
  paused = false
  last = performance.now()
  acc = 0
  hud()
}

function after(res: ReturnType<Game['tick']>) {
  if (res && game) renderer.lock(res, game)
  hud()
  if (game?.over) {
    stopControls()
    paused = true
    $('final').textContent = String(game.score)
    over.showModal()
  }
}

function frame(t: number) {
  const dt = t - last
  last = t
  if (game && !paused) {
    acc += dt
    if (acc >= game.interval) {
      acc = 0
      after(game.tick())
    }
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

function runAction(action: Action) {
  if (!game || paused) return
  const g = game
  switch (action) {
    case 'left': g.move('left'); break
    case 'right': g.move('right'); break
    case 'rotate': g.rotate(1); break
    case 'rotate-back': g.rotate(-1); break
    case 'soft-drop': after(g.softDrop()); return
    case 'hard-drop': {
      const from = g.cells()
      const kind = g.piece!.kind
      const res = g.hardDrop()
      if (from) renderer.trail(from, kind)
      after(res)
      return
    }
    case 'pause':
      stopControls()
      paused = true
      pause.showModal()
      return
  }
  hud()
}

const keys: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'soft-drop',
  ArrowUp: 'rotate',
  KeyX: 'rotate',
  KeyZ: 'rotate-back',
  Space: 'hard-drop',
  KeyP: 'pause',
  Escape: 'pause',
}

addEventListener('keydown', (e) => {
  const action = keys[e.code]
  if (!action || !game || paused) return
  e.preventDefault()
  runAction(action)
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  const action = button.dataset.action as Action
  const repeatable = action === 'left' || action === 'right' || action === 'soft-drop'
  let pointerId: number | null = null
  let delay = 0
  let interval = 0
  const stop = () => {
    const id = pointerId
    pointerId = null
    clearTimeout(delay)
    clearInterval(interval)
    activeControls.delete(stop)
    if (id !== null && button.hasPointerCapture(id)) button.releasePointerCapture(id)
  }

  button.addEventListener('pointerdown', (e) => {
    if (pointerId !== null || !game || paused) return
    e.preventDefault()
    pointerId = e.pointerId
    button.setPointerCapture(e.pointerId)
    activeControls.add(stop)
    runAction(action)
    if (repeatable && pointerId === e.pointerId)
      delay = window.setTimeout(() => { interval = window.setInterval(() => runAction(action), 75) }, 180)
  })
  button.addEventListener('pointerup', (e) => { if (pointerId === e.pointerId) stop() })
  button.addEventListener('pointercancel', (e) => { if (pointerId === e.pointerId) stop() })
  button.addEventListener('lostpointercapture', stop)
  button.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId) return
    const r = button.getBoundingClientRect()
    if (e.clientX < r.left - 12 || e.clientX > r.right + 12 || e.clientY < r.top - 12 || e.clientY > r.bottom + 12) stop()
  })
  button.addEventListener('click', (e) => { if (e.detail === 0) runAction(action) })
}

$('pause-button').addEventListener('click', () => runAction('pause'))
addEventListener('blur', stopControls)

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mode]'))
  b.addEventListener('click', () => {
    menu.close()
    over.close()
    start(b.dataset.mode!)
  })
$('restart').addEventListener('click', () => {
  over.close()
  start(mode)
})
$('to-menu').addEventListener('click', () => {
  over.close()
  menu.showModal()
})
pause.addEventListener('close', () => {
  paused = false
  last = performance.now()
})
menu.addEventListener('cancel', (e) => game || e.preventDefault())
menu.addEventListener('close', () => {
  if (game && !game.over) {
    paused = false
    last = performance.now()
  }
})
$('open-menu').addEventListener('click', () => {
  stopControls()
  paused = true
  menu.showModal()
})

menu.showModal()
