import { BrowserWindow, dialog } from 'electron'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PrinterInfo, SimpleResult } from '../../shared/types'

async function loadHtmlWindow(html: string): Promise<{ win: BrowserWindow; cleanup: () => void }> {
  const tmpPath = join(tmpdir(), `vouchers-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  writeFileSync(tmpPath, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true }
  })
  const cleanup = (): void => {
    try { if (!win.isDestroyed()) win.destroy() } catch { /* ignore */ }
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
  await win.loadFile(tmpPath)
  await win.webContents.executeJavaScript(
    `Promise.all(Array.from(document.images).map(im => im.complete ? true : new Promise(r => { im.onload = r; im.onerror = r; })))`
  )
  // Esperar a que el renderizador termine de pintar (CSS, layout, fonts)
  await new Promise((r) => setTimeout(r, 600))
  return { win, cleanup }
}

export async function listPrinters(win: BrowserWindow): Promise<PrinterInfo[]> {
  const printers = await win.webContents.getPrintersAsync()
  return printers.map((p) => ({ name: p.name, isDefault: false }))
}

export async function printHtml(
  html: string,
  options: { printerName?: string; silent: boolean }
): Promise<SimpleResult> {
  const { win, cleanup } = await loadHtmlWindow(html)

  // Detectar si es térmica y dar más tiempo en silencioso
  const thermalMatch = html.match(/@page\s*\{[^}]*size:\s*(\d+)mm\s+auto[^}]*\}/i)
  const isThermal = !!thermalMatch

  if (isThermal && options.silent) {
    // El driver de impresoras térmicas necesita más tiempo para que el
    // renderizador termine de pintar el contenido antes de capturar el frame.
    await new Promise((r) => setTimeout(r, 2000))
  }

  // Para térmica: pasar tamaño de página custom. El driver necesita saber
  // el ancho del papel; si usa el default (A4) el ticket sale en blanco o
  // posicionado mal porque el contenido de 58mm queda fuera del viewport.
  const pageSize = isThermal
    ? { width: parseInt(thermalMatch[1], 10) * 1000, height: 210000 }
    : undefined

  return new Promise<SimpleResult>((resolve) => {
    win.webContents.print(
      {
        silent: options.silent,
        printBackground: true,
        margins: { marginType: 'none' },
        ...(options.printerName ? { deviceName: options.printerName } : {}),
        ...(pageSize ? { pageSize } : {})
      },
      (success, failureReason) => {
        cleanup()
        if (success) resolve({ ok: true })
        else resolve({ ok: false, error: failureReason || 'Impresión cancelada' })
      }
    )
  })
}

export async function exportPdf(html: string, suggestedName: string): Promise<SimpleResult> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Guardar PDF',
    defaultPath: suggestedName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { ok: false, error: 'cancelado' }
  const { win, cleanup } = await loadHtmlWindow(html)
  try {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    })
    writeFileSync(filePath, data)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    cleanup()
  }
}
