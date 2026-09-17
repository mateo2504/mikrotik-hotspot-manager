/** Evita que la ventana quede oculta si `ready-to-show` nunca llega. */
export const WINDOW_SHOW_FALLBACK_MS = 2500

export interface ShowableWindow {
  show: () => void
  isDestroyed: () => boolean
  once: (event: string, listener: () => void) => unknown
  webContents: {
    once: (event: string, listener: (...args: unknown[]) => void) => unknown
  }
}

/**
 * Muestra la ventana en el primer evento útil (ready-to-show, carga OK/error)
 * o por timeout. Idempotente: no llama `show()` dos veces.
 */
export function attachMainWindowShow(
  win: ShowableWindow,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout
): () => void {
  let shown = false
  const show = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', show)
  win.webContents.once('did-finish-load', show)
  win.webContents.once('did-fail-load', show)
  schedule(show, WINDOW_SHOW_FALLBACK_MS)
  return show
}
