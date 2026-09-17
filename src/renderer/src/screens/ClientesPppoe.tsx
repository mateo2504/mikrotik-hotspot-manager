import { useEffect, useMemo, useState } from 'react'
import type { PppoeClient, PppoeClientInput, PppoePlan } from '../../../shared/types'
import { displayMbps } from '../../../shared/mbps'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { api } from '../lib/api'

export default function ClientesPppoe({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [clients, setClients] = useState<PppoeClient[]>([])
  const [plans, setPlans] = useState<PppoePlan[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PppoeClient | null | 'new'>(null)
  const [deleting, setDeleting] = useState<PppoeClient | null>(null)
  const [suspending, setSuspending] = useState<PppoeClient | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const [c, p] = await Promise.all([api.pppoeClients.list(), api.pppoePlans.list()])
      setClients(c)
      setPlans(p)
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.planName.toLowerCase().includes(q) ||
        c.comment.toLowerCase().includes(q) ||
        c.remoteAddress.toLowerCase().includes(q)
    )
  }, [clients, search])

  const remove = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    const res = await api.pppoeClients.remove(deleting.rosId, deleting.name)
    setBusy(false)
    if (res.ok) {
      toast.success(`Cliente "${deleting.name}" eliminado`)
      setDeleting(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al eliminar')
    }
  }

  const suspend = async (): Promise<void> => {
    if (!suspending) return
    setBusy(true)
    const res = await api.pppoeClients.suspend(suspending.rosId, suspending.name)
    setBusy(false)
    if (res.ok) {
      toast.success(`Cliente "${suspending.name}" suspendido`)
      setSuspending(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al suspender')
    }
  }

  const resume = async (c: PppoeClient): Promise<void> => {
    const res = await api.pppoeClients.resume(c.rosId)
    if (res.ok) {
      toast.success(`Cliente "${c.name}" reactivado`)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al reactivar')
    }
  }

  return (
    <div>
      <SectionHead title={`Clientes PPPoE (${clients.length})`} onBack={onBack}>
        <input
          className="search-input"
          placeholder="Buscar cliente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => void reload()}>
          ⟳ Refrescar
        </button>
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuevo cliente
        </button>
      </SectionHead>

      {loaded && filtered.length === 0 ? (
        <EmptyState icon="👤" title={search ? 'Sin resultados' : 'Sin clientes PPPoE'}>
          {search
            ? 'Prueba con otra búsqueda.'
            : 'Crea un plan PPPoE y luego el cliente (secret + simplequeue).'}
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Contraseña</th>
                <th>IP remota</th>
                <th>Plan</th>
                <th>Velocidad</th>
                <th>Comentario</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.rosId} className={c.disabled ? 'disabled-row' : ''}>
                  <td className="mono">
                    <b>{c.name}</b> {c.disabled && <span className="badge red">suspendido</span>}
                  </td>
                  <td className="mono">{c.password || '—'}</td>
                  <td className="mono">{c.remoteAddress || '—'}</td>
                  <td>{c.planName || '—'}</td>
                  <td className="mono">
                    {c.uploadMbps || c.downloadMbps
                      ? `${displayMbps(c.uploadMbps)} ↑ ${displayMbps(c.downloadMbps)} ↓`
                      : '—'}
                  </td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.comment || '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => setEditing(c)}>
                        Editar
                      </button>
                      {c.disabled ? (
                        <button className="btn sm" onClick={() => void resume(c)}>
                          Reactivar
                        </button>
                      ) : (
                        <button className="btn sm" onClick={() => setSuspending(c)}>
                          Suspender
                        </button>
                      )}
                      <button className="btn sm danger" onClick={() => setDeleting(c)}>
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ClientForm
          client={editing === 'new' ? null : editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar cliente PPPoE"
          message={
            <>
              ¿Eliminar el cliente <b>{deleting.name}</b>? Se borra el secret y su simplequeue.
            </>
          }
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        />
      )}

      {suspending && (
        <ConfirmDialog
          title="Suspender cliente"
          message={
            <>
              ¿Suspender a <b>{suspending.name}</b>? No podrá conectar hasta reactivarlo. Si está en
              línea se desconecta.
            </>
          }
          confirmLabel="Suspender"
          busy={busy}
          onCancel={() => setSuspending(null)}
          onConfirm={() => void suspend()}
        />
      )}
    </div>
  )
}

function ClientForm({
  client,
  plans,
  onClose,
  onSaved
}: {
  client: PppoeClient | null
  plans: PppoePlan[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<PppoeClientInput>(
    client
      ? {
          name: client.name,
          password: client.password,
          planName: client.planName || plans[0]?.name || '',
          comment: client.comment,
          remoteAddress: /^\d{1,3}(?:\.\d{1,3}){3}$/.test(client.remoteAddress.trim())
            ? client.remoteAddress.trim()
            : ''
        }
      : { name: '', password: '', planName: plans[0]?.name ?? '', comment: '', remoteAddress: '' }
  )
  const [busy, setBusy] = useState(false)
  const selected = plans.find((p) => p.name === form.planName)

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('El nombre de usuario es obligatorio')
      return
    }
    if (!form.planName) {
      toast.error('Elige un plan PPPoE')
      return
    }
    setBusy(true)
    const res = client
      ? await api.pppoeClients.update(client.rosId, client.name, form)
      : await api.pppoeClients.create(form)
    setBusy(false)
    if (res.ok) {
      toast.success('Cliente PPPoE guardado')
      onSaved()
    } else {
      toast.error(res.error ?? 'Error al guardar')
    }
  }

  return (
    <Modal
      title={client ? `Editar ${client.name}` : 'Nuevo cliente PPPoE'}
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
      {plans.length === 0 ? (
        <p>Crea un plan PPPoE antes de dar de alta clientes.</p>
      ) : (
        <div className="form-grid">
          <div className="field">
            <label>Usuario</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Plan PPPoE</label>
            <select
              value={form.planName}
              onChange={(e) => setForm({ ...form, planName: e.target.value })}
            >
              {plans.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({displayMbps(p.uploadMbps)}/{displayMbps(p.downloadMbps)})
                </option>
              ))}
            </select>
            <div className="hint">
              {selected
                ? `Simplequeue ${displayMbps(selected.uploadMbps)}/${displayMbps(selected.downloadMbps)} sobre la IP remota del cliente (/32).`
                : 'La velocidad se aplica con simplequeue al guardar el secret.'}
            </div>
          </div>
          <div className="field">
            <label>IP remota (opcional)</label>
            <input
              className="mono"
              placeholder="Vacío = asignar automáticamente"
              value={form.remoteAddress ?? ''}
              onChange={(e) => setForm({ ...form, remoteAddress: e.target.value })}
            />
            <div className="hint">
              Cada cliente tiene una IPv4 fija y única. Si lo dejas vacío, se toma la siguiente libre
              de la LAN del router (se saltan red, gateway y broadcast).
            </div>
          </div>
          <div className="field">
            <label>Comentario</label>
            <input
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
