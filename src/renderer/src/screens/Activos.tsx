import { useEffect, useMemo, useState } from 'react'
import type { ActiveSession } from '../../../shared/types'
import { EmptyState, SectionHead, useToast } from '../components/ui'
import { api, formatBytes } from '../lib/api'

export default function Activos({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    try {
      setSessions(await api.active.list())
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 15000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.user.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.macAddress.toLowerCase().includes(q)
    )
  }, [sessions, search])

  const disconnect = async (s: ActiveSession): Promise<void> => {
    setDisconnecting(s.rosId)
    const res = await api.active.disconnect(s.rosId)
    setDisconnecting(null)
    if (res.ok) {
      toast.success(`"${s.user}" desconectado`)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al desconectar')
    }
  }

  return (
    <div>
      <SectionHead title={`Activos (${sessions.length})`} onBack={onBack}>
        <input
          className="search-input"
          placeholder="Buscar usuario, IP o MAC…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => void reload()}>
          ⟳ Refrescar
        </button>
      </SectionHead>

      {loaded && filtered.length === 0 ? (
        <EmptyState icon="🟢" title={search ? 'Sin resultados' : 'Nadie conectado'}>
          {search
            ? 'Ninguna sesión activa coincide con la búsqueda.'
            : 'Las sesiones activas del hotspot aparecerán aquí. Se actualiza cada 15 segundos.'}
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Dirección IP</th>
                <th>MAC</th>
                <th>Tiempo conectado</th>
                <th>Tráfico</th>
                <th>Método</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.rosId}>
                  <td className="mono">
                    <b>{s.user}</b>
                  </td>
                  <td className="mono">{s.address}</td>
                  <td className="mono">{s.macAddress}</td>
                  <td className="mono">{s.uptime}</td>
                  <td className="mono">
                    {formatBytes(s.bytesIn)} ↓ {formatBytes(s.bytesOut)} ↑
                  </td>
                  <td>{s.loginBy}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn sm danger"
                        disabled={disconnecting === s.rosId}
                        onClick={() => void disconnect(s)}
                      >
                        {disconnecting === s.rosId ? <span className="spinner" /> : null} Desconectar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
