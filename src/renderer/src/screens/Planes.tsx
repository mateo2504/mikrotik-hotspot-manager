import { useEffect, useState } from 'react'
import type { HotspotProfile, PlanType, ProfileInput } from '../../../shared/types'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { api } from '../lib/api'

const emptyForm: ProfileInput = {
  name: '',
  rateLimit: '',
  sharedUsers: '1',
  price: '',
  planType: 'pausado',
  validity: '',
  uptimeLimit: '',
  macAleatoria: false
}

export default function Planes({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [profiles, setProfiles] = useState<HotspotProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<HotspotProfile | null | 'new'>(null)
  const [deleting, setDeleting] = useState<HotspotProfile | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      setProfiles(await api.profiles.list())
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const remove = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    const res = await api.profiles.remove(deleting.rosId, deleting.name)
    setBusy(false)
    if (res.ok) {
      toast.success(`Plan "${deleting.name}" eliminado`)
      setDeleting(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al eliminar')
    }
  }

  return (
    <div>
      <SectionHead title="Planes" onBack={onBack}>
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuevo plan
        </button>
      </SectionHead>

      {loaded && profiles.length === 0 ? (
        <EmptyState icon="📋" title="Sin planes">
          Crea el primer plan para poder generar fichas.
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Vigencia</th>
                <th>Tiempo de uso</th>
                <th>Velocidad</th>
                <th>Compartidos</th>
                <th>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.rosId || p.name}>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td>
                    {p.meta ? (
                      <span className={`badge ${p.meta.planType === 'pausado' ? 'amber' : 'blue'}`}>
                        {p.meta.planType === 'pausado' ? 'Pausado' : 'Corrido'}
                      </span>
                    ) : (
                      <span className="badge">—</span>
                    )}
                  </td>
                  <td className="mono">{p.meta?.validity || '—'}</td>
                  <td className="mono">
                    {p.meta?.planType === 'pausado' ? p.meta.uptimeLimit || '—' : '—'}
                  </td>
                  <td className="mono">{p.rateLimit || '—'}</td>
                  <td>{p.sharedUsers || '1'}</td>
                  <td>{p.meta?.price || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => setEditing(p)}>
                        Editar
                      </button>
                      <button className="btn sm danger" onClick={() => setDeleting(p)}>
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
        <PlanForm
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar plan"
          message={
            <>
              ¿Eliminar el plan <b>{deleting.name}</b> del router? Los usuarios que lo usan quedarán
              sin perfil válido.
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

function PlanForm({
  profile,
  onClose,
  onSaved
}: {
  profile: HotspotProfile | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<ProfileInput>(
    profile
      ? {
          name: profile.name,
          rateLimit: profile.rateLimit,
          sharedUsers: profile.sharedUsers || '1',
          price: profile.meta?.price ?? '',
          planType: profile.meta?.planType ?? 'pausado',
          validity: profile.meta?.validity ?? '',
          uptimeLimit: profile.meta?.uptimeLimit ?? '',
          macAleatoria: profile.meta?.macAleatoria ?? false
        }
      : { ...emptyForm }
  )
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    if (form.planType === 'pausado' && !form.uptimeLimit.trim()) {
      toast.error('Un plan pausado necesita tiempo de uso (ej. 5h)')
      return
    }
    setBusy(true)
    const res = profile
      ? await api.profiles.update(profile.rosId, profile.name, form)
      : await api.profiles.create(form)
    setBusy(false)
    if (res.ok) {
      toast.success('Plan guardado')
      onSaved()
    } else {
      toast.error(res.error ?? 'Error al guardar')
    }
  }

  return (
    <Modal
      title={profile ? `Editar plan ${profile.name}` : 'Nuevo plan'}
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
          <label>Nombre del plan</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Ej. 1 Hora, 1 Día, Semanal"
            autoFocus
          />
        </div>
        <div className="field full">
          <label>Tipo de plan</label>
          <div className="radio-group">
            {(['pausado', 'corrido'] as PlanType[]).map((t) => (
              <div
                key={t}
                className={`radio-pill${form.planType === t ? ' active' : ''}`}
                onClick={() => setForm({ ...form, planType: t })}
              >
                {t === 'pausado' ? '⏸ Pausado' : '▶ Corrido'}
              </div>
            ))}
          </div>
          <div className="hint">
            {form.planType === 'pausado'
              ? 'El tiempo solo corre mientras el usuario está conectado. La vigencia es la fecha límite para consumirlo.'
              : 'La vigencia corre desde el primer inicio de sesión, conectado o no.'}
          </div>
        </div>
        {form.planType === 'pausado' && (
          <div className="field">
            <label>Tiempo de uso</label>
            <input
              value={form.uptimeLimit}
              onChange={(e) => setForm({ ...form, uptimeLimit: e.target.value })}
              placeholder="Ej. 5h, 1d"
            />
            <div className="hint">limit-uptime del usuario</div>
          </div>
        )}
        <div className="field">
          <label>Vigencia</label>
          <input
            value={form.validity}
            onChange={(e) => setForm({ ...form, validity: e.target.value })}
            placeholder="Ej. 3d, 12h, 30d"
          />
          <div className="hint">Vacío = sin expiración automática</div>
        </div>
        <div className="field">
          <label>Velocidad (rate-limit)</label>
          <input
            value={form.rateLimit}
            onChange={(e) => setForm({ ...form, rateLimit: e.target.value })}
            placeholder="Ej. 5M/10M (subida/bajada)"
          />
        </div>
        <div className="field">
          <label>Usuarios compartidos</label>
          <input
            value={form.macAleatoria ? '2' : form.sharedUsers}
            onChange={(e) => setForm({ ...form, sharedUsers: e.target.value })}
            placeholder="1"
            disabled={form.macAleatoria}
          />
          {form.macAleatoria && (
            <div className="hint">Fijado en 2 por la MAC aleatoria</div>
          )}
        </div>
        <div className="field full">
          <label className="check-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.macAleatoria}
              onChange={(e) => setForm({ ...form, macAleatoria: e.target.checked })}
            />
            <span>MAC aleatoria</span>
          </label>
          <div className="hint">
            Cierra las sesiones del usuario con otra MAC al iniciar sesión y fija usuarios
            compartidos en 2, para soportar dispositivos con MAC aleatoria.
          </div>
        </div>
        <div className="field">
          <label>Precio</label>
          <input
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="Ej. $10"
          />
          <div className="hint">Solo informativo, aparece en la ficha</div>
        </div>
      </div>
    </Modal>
  )
}
