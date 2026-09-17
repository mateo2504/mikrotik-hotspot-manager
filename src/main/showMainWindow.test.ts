import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WINDOW_SHOW_FALLBACK_MS,
  attachMainWindowShow,
  type ShowableWindow
} from './showMainWindow'

function fakeWindow(): {
  win: ShowableWindow
  shown: { n: number }
  windowEvents: Map<string, () => void>
  webEvents: Map<string, (...args: unknown[]) => void>
} {
  const windowEvents = new Map<string, () => void>()
  const webEvents = new Map<string, (...args: unknown[]) => void>()
  const shown = { n: 0 }
  const win: ShowableWindow = {
    show: (): void => {
      shown.n += 1
    },
    isDestroyed: (): boolean => false,
    once: (event, listener): void => {
      windowEvents.set(event, listener)
    },
    webContents: {
      once: (event, listener): void => {
        webEvents.set(event, listener)
      }
    }
  }
  return { win, shown, windowEvents, webEvents }
}

describe('attachMainWindowShow', () => {
  it('muestra en ready-to-show y no vuelve a mostrar', () => {
    const { win, shown, windowEvents, webEvents } = fakeWindow()
    const scheduled: Array<() => void> = []
    attachMainWindowShow(win, (fn) => scheduled.push(fn))

    assert.equal(shown.n, 0)
    windowEvents.get('ready-to-show')?.()
    assert.equal(shown.n, 1)
    webEvents.get('did-finish-load')?.()
    scheduled[0]?.()
    assert.equal(shown.n, 1)
  })

  it('muestra al terminar de cargar si ready-to-show no llega', () => {
    const { win, shown, webEvents } = fakeWindow()
    attachMainWindowShow(win, () => undefined)
    webEvents.get('did-finish-load')?.()
    assert.equal(shown.n, 1)
  })

  it('muestra si la carga falla', () => {
    const { win, shown, webEvents } = fakeWindow()
    attachMainWindowShow(win, () => undefined)
    webEvents.get('did-fail-load')?.()
    assert.equal(shown.n, 1)
  })

  it('muestra por timeout de respaldo', () => {
    const { win, shown } = fakeWindow()
    let fallback: (() => void) | undefined
    let delay = 0
    attachMainWindowShow(win, (fn, ms) => {
      fallback = fn
      delay = ms
    })
    assert.equal(delay, WINDOW_SHOW_FALLBACK_MS)
    fallback?.()
    assert.equal(shown.n, 1)
  })

  it('no muestra una ventana destruida', () => {
    const { win, shown, windowEvents } = fakeWindow()
    win.isDestroyed = (): boolean => true
    attachMainWindowShow(win, () => undefined)
    windowEvents.get('ready-to-show')?.()
    assert.equal(shown.n, 0)
  })
})
