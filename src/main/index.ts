import { app, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb, closeDb } from './db/database'
import { registerIpcHandlers } from './ipc/handlers'
import { initAutoUpdater } from './autoUpdater'
import { attachMainWindowShow, type ShowableWindow } from './showMainWindow'

// Depuración remota solo en desarrollo
if (is.dev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9223')
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  attachMainWindowShow(mainWindow as unknown as ShowableWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mikrotik.hotspot')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  let startupError: string | null = null
  try {
    getDb()
  } catch (err) {
    startupError = err instanceof Error ? err.message : String(err)
    console.error('Error al abrir la base de datos:', err)
  }
  try {
    registerIpcHandlers(() => mainWindow)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    startupError = startupError ? `${startupError}\n${msg}` : msg
    console.error('Error al registrar IPC:', err)
  }

  createWindow()

  if (startupError) {
    dialog.showErrorBox(
      'No se pudo iniciar',
      `La ventana se abrió pero falló el arranque:\n\n${startupError}`
    )
  }

  // Inicializar verificación de actualizaciones (solo en producción)
  if (!is.dev) {
    initAutoUpdater()
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show()
  }
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
