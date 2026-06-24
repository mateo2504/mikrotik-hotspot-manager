import { useEffect, useMemo, useState } from 'react'
import type { HotspotProfile, HotspotUser, UserInput } from '../../../shared/types'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { api, formatBytes } from '../lib/api'

export default function Usuarios({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [users, setUsers] = useState<HotspotUser[]>([])
  const [profiles, setProfiles] = useState<HotspotProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<HotspotUser | null | 'new'>(null)
  const [deleting, setDeleting] = useState<HotspotUser | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const [u, p] = await Promise.all([api.users.list(), api.profiles.list()])
      setUsers(u)
      setProfiles(p)
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
    if (!q) return users
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.profile.toLowerCase().includes(q) ||
        u.comment.toLowerCase().includes(q)
    )
  }, [users, search])

  const remove = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    const res = await api.users.remove(deleting.rosId)
    setBusy(false)
    if (res.ok) {
      toast.success(`Usuario "${deleting.name}" eliminado`)
      setDeleting(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al eliminar')
    }
  }

  return (
    <div>
      <SectionHead title={`Usuarios (${users.length})`} onBack={onBack}>
        <input
          className="search-input"
          placeholder="Buscar usuario…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn" onClick={() => void reload()}>
          ⟳ Refrescar
        </button>
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuevo usuario
        </button>
      </SectionHead>

      {loaded && filtered.length === 0 ? (
        <EmptyState icon="👤" title={search ? 'Sin resultados' : 'Sin usuarios'}>
          {search ? 'Prueba con otra búsqueda.' : 'Crea usuarios o genera un lote de fichas.'}
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Contraseña</th>
                <th>Plan</th>
                <th>Tiempo usado</th>
                <th>Límite</th>
                <th>Tráfico</th>
                <th>Comentario</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.rosId}>
                  <td className="mono">
                    <b>{u.name}</b>{' '}
                    {u.disabled && <span className="badge red">desactivado</span>}
                  </td>
                  <td className="mono">{u.password || '—'}</td>
                  <td>{u.profile}</td>
                  <td className="mono">{u.uptime || '—'}</td>
                  <td className="mono">{u.limitUptime || '—'}</td>
                  <td className="mono">
                    {formatBytes(u.bytesIn)} ↓ {formatBytes(u.bytesOut)} ↑
                  </td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.comment || '—'}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => setEditing(u)}>
                        Editar
                      </button>
                      <button className="btn sm danger" onClick={() => setDeleting(u)}>
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
        <UserForm
          user={editing === 'new' ? null : editing}
          profiles={profiles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar usuario"
          message={
            <>
              ¿Eliminar el usuario <b>{deleting.name}</b> del router?
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

function UserForm({
  user,
  profiles,
  onClose,
  onSaved
}: {
  user: HotspotUser | null
  profiles: HotspotProfile[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<UserInput>(
    user
      ? { name: user.name, password: user.password, profile: user.profile, comment: user.comment }
      : { name: '', password: '', profile: profiles[0]?.name ?? 'default', comment: '' }
  )
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('El nombre de usuario es obligatorio')
      return
    }
    setBusy(true)
    const res = user
      ? await api.users.update(user.rosId, form)
      : await api.users.create(form)
    setBusy(false)
    if (res.ok) {
      toast.success('Usuario guardado')
      onSaved()
    } else {
      toast.error(res.error ?? 'Error al guardar')
    }
  }

  return (
    <Modal
      title={user ? `Editar ${user.name}` : 'Nuevo usuario'}
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
          <label>Plan</label>
          <select
            value={form.profile}
            onChange={(e) => setForm({ ...form, profile: e.target.value })}
          >
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.meta ? ` (${p.meta.planType})` : ''}
              </option>
            ))}
          </select>
          <div className="hint">Si el plan es pausado se aplica su tiempo de uso</div>
        </div>
        <div className="field">
          <label>Comentario</label>
          <input
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  )
}
