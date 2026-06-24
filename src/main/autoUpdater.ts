import { autoUpdater } from 'electron-updater'
import { dialog } from 'electron'

export function initAutoUpdater(): void {
  // Verificar actualizaciones al iniciar
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Error checking for updates:', err)
  })

  // Cuando se detecta una nueva versión disponible
  autoUpdater.on('update-available', (info) => {
    console.info('Update available:', info)
    dialog.showMessageBox({
      type: 'info',
      title: 'Actualización disponible',
      message: `Se encontró una nueva versión: ${info.version}`,
      detail: 'Se descargará en segundo plano. Te avisaremos cuando esté lista para instalar.',
      buttons: ['OK']
    })
  })

  // Cuando NO hay actualizaciones (solo log en desarrollo)
  autoUpdater.on('update-not-available', () => {
    console.info('No hay actualizaciones disponibles')
  })

  // Progreso de descarga (opcional)
  autoUpdater.on('download-progress', (progressObj) => {
    const percent = progressObj.percent.toFixed(2)
    console.info(`Download progress: ${percent}%`)
  })

  // Cuando la actualización ya se descargó
  autoUpdater.on('update-downloaded', (info) => {
    console.info('Update downloaded:', info)
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Actualización lista',
        message: `La versión ${info.version} se descargó correctamente.`,
        detail: '¿Deseas reiniciar la aplicación ahora para instalar la actualización?',
        buttons: ['Reiniciar ahora', 'Más tarde'],
        defaultId: 0,
        cancelId: 1
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  // Manejo de errores
  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err)
  })
}
