import { useEffect, useState } from 'react'
import type { PppoePlan, PppoePlanInput } from '../../../shared/types'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { api } from '../lib/api'

const emptyForm: PppoePlanInput = {
  name: '',
  uploadMbps: '',
  downloadMbps: '',
  price: ''
}

export default function PlanesPppoe({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [plans, setPlans] = useState<PppoePlan[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<PppoePlan | null | 'new'>(null)
  const [deleting, setDeleting] = useState<PppoePlan | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      setPlans(await api.pppoePlans.list())
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
    const res = await api.pppoePlans.remove(deleting.name)
    setBusy(false)
    if (res.ok) {
      toast.success(`Plan PPPoE "${deleting.name}" eliminado`)
      setDeleting(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al eliminar')
    }
  }

  return (
    <div>
      <SectionHead title="Planes PPPoE" onBack={onBack}>
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuevo plan
        </button>
      </SectionHead>

      {loaded && plans.length === 0 ? (
        <EmptyState icon="📋" title="Sin planes PPPoE">
          Crea un plan con megas de subida y bajada. La velocidad se aplica con simplequeue al crear
          el cliente.
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Subida</th>
                <th>Bajada</th>
                <th>Precio</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.name}>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td className="mono">{p.uploadMbps ? `${p.uploadMbps}M` : '—'}</td>
                  <td className="mono">{p.downloadMbps ? `${p.downloadMbps}M` : '—'}</td>
                  <td>{p.price || '—'}</td>
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
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar plan PPPoE"
          message={
            <>
              ¿Eliminar el plan <b>{deleting.name}</b>? Los clientes que lo usan conservan su
              simplequeue hasta que los edites.
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
  plan,
  onClose,
  onSaved
}: {
  plan: PppoePlan | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<PppoePlanInput>(
    plan
      ? {
          name: plan.name,
          uploadMbps: plan.uploadMbps,
          downloadMbps: plan.downloadMbps,
          price: plan.price
        }
      : { ...emptyForm }
  )
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!form.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    if (!form.uploadMbps.trim() || !form.downloadMbps.trim()) {
      toast.error('Indica los megas de subida y bajada')
      return
    }
    setBusy(true)
    const res = plan
      ? await api.pppoePlans.update(plan.name, form)
      : await api.pppoePlans.create(form)
    setBusy(false)
    if (res.ok) {
      toast.success('Plan PPPoE guardado')
      onSaved()
    } else {
      toast.error(res.error ?? 'Error al guardar')
    }
  }

  return (
    <Modal
      title={plan ? `Editar plan ${plan.name}` : 'Nuevo plan PPPoE'}
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
            placeholder="Ej. Residencial 10/20"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Megas de subida</label>
          <input
            value={form.uploadMbps}
            onChange={(e) => setForm({ ...form, uploadMbps: e.target.value })}
            placeholder="Ej. 5"
          />
          <div className="hint">Se aplica en el simplequeue al crear el secret</div>
        </div>
        <div className="field">
          <label>Megas de bajada</label>
          <input
            value={form.downloadMbps}
            onChange={(e) => setForm({ ...form, downloadMbps: e.target.value })}
            placeholder="Ej. 10"
          />
        </div>
        <div className="field">
          <label>Precio</label>
          <input
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="Ej. $200"
          />
          <div className="hint">Solo informativo</div>
        </div>
      </div>
    </Modal>
  )
}
