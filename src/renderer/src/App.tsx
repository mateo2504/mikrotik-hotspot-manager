import { useEffect, useRef, useState } from 'react'
import type { RouterRecord } from '../../shared/types'
import { ToastProvider, useToast } from './components/ui'
import { api } from './lib/api'
import RouterList from './screens/RouterList'
import Dashboard from './screens/Dashboard'
import Planes from './screens/Planes'
import Usuarios from './screens/Usuarios'
import Activos from './screens/Activos'
import Hosts from './screens/Hosts'
import IpBindings from './screens/IpBindings'
import Lotes from './screens/Lotes'
import Plantillas from './screens/Plantillas'
import PlanesPppoe from './screens/PlanesPppoe'
import ClientesPppoe from './screens/ClientesPppoe'
import ActivosPppoe from './screens/ActivosPppoe'

export type Screen =
  | 'routers'
  | 'dashboard'
  | 'planes'
  | 'usuarios'
  | 'activos'
  | 'hosts'
  | 'ipBindings'
  | 'lotes'
  | 'plantillas'
  | 'pppoePlanes'
  | 'pppoeClientes'
  | 'pppoeActivos'

export interface Connection {
  router: RouterRecord
  identity: string
  version: string
  api: 'rest' | 'binary'
}

function Footer(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [newVersion, setNewVersion] = useState<string | null>(null)

  useEffect(() => {
    void api.appInfo.getVersion().then(setVersion)
    const unsubscribe = api.appInfo.onUpdateAvailable((info) => {
      setNewVersion(info.version)
    })
    return unsubscribe
  }, [])

  return (
    <div className="app-footer">
      <span className="footer-copy">© Marcos Solis</span>
      <span className="footer-version">
        v{version}
        {newVersion && (
          <span className="update-badge" title={`Nueva versión disponible: ${newVersion}`}>
            🔄 {newVersion}
          </span>
        )}
      </span>
    </div>
  )
}

function AppContent(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('routers')
  const [connection, setConnection] = useState<Connection | null>(null)
  const [reconnectAttempt, setReconnectAttempt] = useState<number | null>(null)
  const toast = useToast()
  const activeConnection = useRef<Connection | null>(null)
  const reconnectRun = useRef(0)

  useEffect(() => {
    activeConnection.current = connection
  }, [connection])

  useEffect(() => {
    return api.routers.onConnectionLost(({ error }) => {
      const lostConnection = activeConnection.current
      if (!lostConnection) return

      const run = ++reconnectRun.current
      void (async () => {
        let lastError = error
        toast.info(`Conexión perdida. Reconectando a ${lostConnection.router.name}...`)

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          setReconnectAttempt(attempt)
          await new Promise<void>((resolve) => setTimeout(resolve, attempt === 1 ? 1000 : 3000))
          if (run !== reconnectRun.current) return

          try {
            const result = await api.routers.connect(lostConnection.router.id)
            if (run !== reconnectRun.current) return
            if (result.ok) {
              const restored = {
                router: lostConnection.router,
                identity: result.identity ?? '',
                version: result.version ?? '',
                api: result.api ?? 'binary'
              }
              activeConnection.current = restored
              setConnection(restored)
              setReconnectAttempt(null)
              toast.success(`Conexión recuperada con ${lostConnection.router.name}`)
              return
            }
            lastError = result.error ?? lastError
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err)
          }
        }

        if (run !== reconnectRun.current) return
        activeConnection.current = null
        setConnection(null)
        setReconnectAttempt(null)
        setScreen('routers')
        toast.error(`No se pudo recuperar la conexión: ${lastError}`)
      })()
    })
  }, [toast])

  const handleConnected = (conn: Connection): void => {
    reconnectRun.current += 1
    activeConnection.current = conn
    setReconnectAttempt(null)
    setConnection(conn)
    setScreen('dashboard')
  }

  const handleDisconnect = (): void => {
    reconnectRun.current += 1
    activeConnection.current = null
    setReconnectAttempt(null)
    void api.routers.disconnect()
    setConnection(null)
    setScreen('routers')
  }

  const backToDashboard = (): void => setScreen('dashboard')

  return (
    <div className="app">
        <div className="topbar">
          <div className="brand">
            <div className="logo">📶</div>
            Gestor Hotspot MikroTik
          </div>
          {connection && (
            <div className="conn-info">
              <span className={`conn-dot${reconnectAttempt ? ' reconnecting' : ''}`} />
              <span>
                <b>{connection.router.name}</b> — {connection.identity} · RouterOS{' '}
                {connection.version} ·{' '}
                <span className="badge blue">
                  {connection.api === 'rest' ? 'REST' : 'API binaria'}
                </span>
                {reconnectAttempt && (
                  <span className="reconnect-status">
                    <span className="spinner" /> Reconectando ({reconnectAttempt}/3)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="content">
          {screen === 'routers' && <RouterList onConnected={handleConnected} />}
          {screen === 'dashboard' && connection && (
            <Dashboard connection={connection} onNavigate={setScreen} onExit={handleDisconnect} />
          )}
          {screen === 'planes' && <Planes onBack={backToDashboard} />}
          {screen === 'usuarios' && <Usuarios onBack={backToDashboard} />}
          {screen === 'activos' && <Activos onBack={backToDashboard} />}
          {screen === 'hosts' && <Hosts onBack={backToDashboard} />}
          {screen === 'ipBindings' && <IpBindings onBack={backToDashboard} />}
          {screen === 'lotes' && <Lotes onBack={backToDashboard} />}
          {screen === 'plantillas' && <Plantillas onBack={backToDashboard} />}
          {screen === 'pppoePlanes' && <PlanesPppoe onBack={backToDashboard} />}
          {screen === 'pppoeClientes' && <ClientesPppoe onBack={backToDashboard} />}
          {screen === 'pppoeActivos' && <ActivosPppoe onBack={backToDashboard} />}
        </div>
        <Footer />
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}

export default App
