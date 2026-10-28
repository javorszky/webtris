import './style.css'
import '@tailwindplus/elements'
import { animate } from 'animejs'
import { Game, blocks } from './game'
import { squareBoard, townscaperDisc, townscaperWell, type Board } from './grid'
import { COLORS, Renderer } from './render'

const MODES: Record<string, { name: string; board: (seed: number) => Board }> = {
  classic: { name: 'Classic', board: () => squareBoard() },
  well: { name: 'Townscaper well', board: townscaperWell },
  disc: { name: 'Townscaper disc', board: townscaperDisc },
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
  mode = m
  $('mode').textContent = MODES[m].name
  game = new Game(MODES[m].board(Math.floor(Math.random() * 1e9)))
  renderer.setBoard(game.board)
  paused = false
  acc = 0
  hud()
}

function after(res: ReturnType<Game['tick']>) {
  if (res && game) renderer.lock(res, game)
  hud()
  if (game?.over) {
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

addEventListener('keydown', (e) => {
  if (!game || paused) return
  const g = game
  const keys: Record<string, () => unknown> = {
    ArrowLeft: () => g.move('left'),
    ArrowRight: () => g.move('right'),
    ArrowDown: () => after(g.softDrop()),
    ArrowUp: () => g.rotate(1),
    KeyX: () => g.rotate(1),
    KeyZ: () => g.rotate(-1),
    Space: () => {
      const from = g.cells()
      const kind = g.piece!.kind
      const res = g.hardDrop()
      if (from) renderer.trail(from, kind)
      after(res)
    },
    KeyP: () => {
      paused = true
      pause.showModal()
    },
  }
  const act = keys[e.code]
  if (!act) return
  e.preventDefault()
  act()
  hud()
})

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
// Esc on the game page opens pause; closing the pause dialog (Esc or button) resumes.
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && !paused && !document.querySelector('dialog[open]')) {
    paused = true
    pause.showModal()
  }
})
pause.addEventListener('close', () => {
  paused = false
  last = performance.now()
})
menu.addEventListener('cancel', (e) => game || e.preventDefault())
menu.addEventListener('close', () => {
  if (game && !game.over) paused = false
})
$('open-menu').addEventListener('click', () => {
  paused = true
  menu.showModal()
})

menu.showModal()
