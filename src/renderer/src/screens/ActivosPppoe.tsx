import { useEffect, useMemo, useState } from 'react'
import type { PppoeActiveSession } from '../../../shared/types'
import { EmptyState, SectionHead, useToast } from '../components/ui'
import { api } from '../lib/api'

export default function ActivosPppoe({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [sessions, setSessions] = useState<PppoeActiveSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    try {
      setSessions(await api.pppoeActive.list())
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
        s.name.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q) ||
        s.callerId.toLowerCase().includes(q)
    )
  }, [sessions, search])

  const disconnect = async (s: PppoeActiveSession): Promise<void> => {
    setDisconnecting(s.rosId)
    const res = await api.pppoeActive.disconnect(s.rosId)
    setDisconnecting(null)
    if (res.ok) {
      toast.success(`"${s.name}" desconectado`)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al desconectar')
    }
  }

  return (
    <div>
      <SectionHead title={`Activos PPPoE (${sessions.length})`} onBack={onBack}>
        <input
          className="search-input"
          placeholder="Buscar usuario, IP o caller-id…"
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
            ? 'Ninguna sesión PPPoE coincide con la búsqueda.'
            : 'Las sesiones PPPoE activas aparecerán aquí. Solo puedes desconectar. Se actualiza cada 15 segundos.'}
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Dirección IP</th>
                <th>Caller ID</th>
                <th>Tiempo conectado</th>
                <th>Servicio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.rosId}>
                  <td className="mono">
                    <b>{s.name}</b>
                  </td>
                  <td className="mono">{s.address || '—'}</td>
                  <td className="mono">{s.callerId || '—'}</td>
                  <td className="mono">{s.uptime || '—'}</td>
                  <td>{s.service || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="btn sm danger"
                        disabled={disconnecting === s.rosId}
                        onClick={() => void disconnect(s)}
                      >
                        {disconnecting === s.rosId ? <span className="spinner" /> : null}{' '}
                        Desconectar
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
