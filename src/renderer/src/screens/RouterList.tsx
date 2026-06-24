import { useEffect, useState } from 'react'
import type { ApiType, RouterInput, RouterRecord } from '../../../shared/types'
import type { Connection } from '../App'
import { ConfirmDialog, EmptyState, Modal, useToast } from '../components/ui'
import { api } from '../lib/api'

const emptyForm: RouterInput = {
  name: '',
  host: '',
  port: null,
  hotspotHost: null,
  username: 'admin',
  password: '',
  useSsl: false,
  apiType: 'auto'
}

export default function RouterList({
  onConnected
}: {
  onConnected: (conn: Connection) => void
}): React.JSX.Element {
  const toast = useToast()
  const [routers, setRouters] = useState<RouterRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<RouterRecord | null | 'new'>(null)
  const [deleting, setDeleting] = useState<RouterRecord | null>(null)
  const [connectingId, setConnectingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    setRouters(await api.routers.list())
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
  }, [])

  const connect = async (r: RouterRecord): Promise<void> => {
    setConnectingId(r.id)
    try {
      const res = await api.routers.connect(r.id)
      if (res.ok) {
        onConnected({
          router: r,
          identity: res.identity ?? '',
          version: res.version ?? '',
          api: res.api ?? 'binary'
        })
      } else {
        toast.error(`No se pudo conectar a ${r.name}: ${res.error}`)
      }
    } finally {
      setConnectingId(null)
    }
  }

  const remove = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    try {
      await api.routers.remove(deleting.id)
      toast.success(`"${deleting.name}" eliminado`)
      setDeleting(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="screen-head">
        <h1>Mis MikroTik</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuevo MikroTik
        </button>
      </div>

      {loaded && routers.length === 0 && (
        <EmptyState icon="📡" title="Sin equipos guardados">
          Agrega tu primer MikroTik con el botón &quot;Nuevo MikroTik&quot;.
        </EmptyState>
      )}

      <div className="router-grid">
        {routers.map((r) => (
          <div key={r.id} className="router-card">
            <div className="rc-head">
              <div className="rc-icon">📡</div>
              <div>
                <div className="rc-name">{r.name}</div>
                <div className="rc-host">
                  {r.host}
                  {r.port ? `:${r.port}` : ''}
                </div>
              </div>
            </div>
            <div className="rc-meta">
              Usuario: <span className="mono">{r.username}</span> ·{' '}
              <span className="badge">
                {r.apiType === 'auto'
                  ? r.detectedApi
                    ? `Auto (${r.detectedApi === 'rest' ? 'REST' : 'binaria'})`
                    : 'Auto'
                  : r.apiType === 'rest'
                    ? 'REST (v7)'
                    : 'API binaria (v6)'}
              </span>
              {r.useSsl && <span className="badge green"> SSL</span>}
            </div>
            <div className="rc-actions">
              <button
                className="btn primary"
                disabled={connectingId !== null}
                onClick={() => void connect(r)}
              >
                {connectingId === r.id ? <span className="spinner" /> : '⚡'} Conectar
              </button>
              <button className="btn sm" onClick={() => setEditing(r)}>
                Editar
              </button>
              <button className="btn sm danger" onClick={() => setDeleting(r)}>
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <RouterForm
          router={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar MikroTik"
          message={
            <>
              ¿Eliminar <b>{deleting.name}</b> de la lista? También se eliminarán sus lotes
              guardados localmente. Los usuarios en el router no se tocan.
            </>
          }
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  )
}

function RouterForm({
  router,
  onClose,
  onSaved
}: {
  router: RouterRecord | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<RouterInput>(
    router
      ? {
          name: router.name,
          host: router.host,
          port: router.port,
          hotspotHost: router.hotspotHost,
          username: router.username,
          password: null,
          useSsl: router.useSsl,
          apiType: router.apiType
        }
      : { ...emptyForm }
  )
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast.error('Nombre, dirección y usuario son obligatorios')
      return
    }
    if (!router && !form.password) {
      toast.error('La contraseña es obligatoria')
      return
    }
    setBusy(true)
    try {
      if (router) await api.routers.update(router.id, form)
      else await api.routers.create(form)
      toast.success('Guardado')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={router ? `Editar ${router.name}` : 'Nuevo MikroTik'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? <span className="spinner" /> : null} Guardar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Nombre</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ej. Hotspot Centro"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Dirección IP / Host (conexión)</label>
          <input
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="192.168.88.1"
          />
        </div>
        <div className="field">
          <label>IP / DNS del portal Hotspot (QR)</label>
          <input
            value={form.hotspotHost ?? ''}
            onChange={(e) => setForm({ ...form, hotspotHost: e.target.value || null })}
            placeholder="Opcional — ej. 192.168.88.1 o wifi.misitio.com"
          />
          <div className="hint">Si está vacío, usa la IP de conexión para el QR</div>
        </div>
        <div className="field">
          <label>Puerto</label>
          <input
            type="number"
            value={form.port ?? ''}
            onChange={(e) =>
              setForm({ ...form, port: e.target.value ? Number(e.target.value) : null })
            }
            placeholder="Automático"
          />
          <div className="hint">Vacío = automático según tipo de conexión</div>
        </div>
        <div className="field">
          <label>Usuario</label>
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Contraseña</label>
          <input
            type="password"
            value={form.password ?? ''}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={router ? '(sin cambios)' : ''}
          />
        </div>
        <div className="field">
          <label>Tipo de conexión</label>
          <select
            value={form.apiType}
            onChange={(e) => setForm({ ...form, apiType: e.target.value as ApiType })}
          >
            <option value="auto">Automático (recomendado)</option>
            <option value="rest">REST — RouterOS v7</option>
            <option value="binary">API binaria — RouterOS v6</option>
          </select>
        </div>
        <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <label className="check-row" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={form.useSsl}
              onChange={(e) => setForm({ ...form, useSsl: e.target.checked })}
            />
            Usar SSL (www-ssl / api-ssl)
          </label>
        </div>
      </div>
    </Modal>
  )
}
