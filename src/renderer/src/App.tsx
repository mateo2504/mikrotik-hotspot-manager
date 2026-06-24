import { useState } from 'react'
import type { RouterRecord } from '../../shared/types'
import { ToastProvider } from './components/ui'
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

export interface Connection {
  router: RouterRecord
  identity: string
  version: string
  api: 'rest' | 'binary'
}

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('routers')
  const [connection, setConnection] = useState<Connection | null>(null)

  const handleConnected = (conn: Connection): void => {
    setConnection(conn)
    setScreen('dashboard')
  }

  const handleDisconnect = (): void => {
    void api.routers.disconnect()
    setConnection(null)
    setScreen('routers')
  }

  const backToDashboard = (): void => setScreen('dashboard')

  return (
    <ToastProvider>
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <div className="logo">📶</div>
            Gestor Hotspot MikroTik
          </div>
          {connection && (
            <div className="conn-info">
              <span className="conn-dot" />
              <span>
                <b>{connection.router.name}</b> — {connection.identity} · RouterOS{' '}
                {connection.version} ·{' '}
                <span className="badge blue">
                  {connection.api === 'rest' ? 'REST' : 'API binaria'}
                </span>
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
        </div>
      </div>
    </ToastProvider>
  )
}

export default App
