import { useEffect, useMemo, useState } from 'react'
import type { IpBinding, IpBindingInput } from '../../../shared/types'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { api } from '../lib/api'

const EXPIRY_UNITS = [
  { value: 'm', label: 'minutos' },
  { value: 'h', label: 'horas' },
  { value: 'd', label: 'días' }
]

function parseInterval(interval?: string): { value: number; unit: 'm' | 'h' | 'd' } {
  if (!interval) return { value: 1, unit: 'd' }
  const match = interval.match(/^(\d+)([mhd])$/)
  if (!match) return { value: 1, unit: 'd' }
  return { value: parseInt(match[1], 10), unit: match[2] as 'm' | 'h' | 'd' }
}

const emptyForm: IpBindingInput = {
  macAddress: '',
  address: '',
  type: 'bypassed',
  comment: '',
  expiryValue: 1,
  expiryUnit: 'd',
  isVip: true
}

const TYPE_OPTIONS = [
  { value: 'bypassed', label: 'Bypassed' },
  { value: 'regular', label: 'Regular' },
  { value: 'blocked', label: 'Bloqueado' }
]

export default function IpBindings({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [bindings, setBindings] = useState<IpBinding[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<IpBinding | null | 'new'>(null)
  const [deleting, setDeleting] = useState<IpBinding | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      setBindings(await api.ipBindings.list())
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return bindings
    return bindings.filter(
      (b) =>
        b.macAddress.toLowerCase().includes(s) ||
        b.address.toLowerCase().includes(s) ||
        b.comment.toLowerCase().includes(s)
    )
  }, [bindings, search])

  const save = async (form: IpBindingInput): Promise<void> => {
    setBusy(true)
    try {
      if (editing && editing !== 'new') {
        const res = await api.ipBindings.update(editing.rosId, form)
        if (res.ok) {
          toast.success('IP Binding actualizado')
          setEditing(null)
          void reload()
        } else {
          toast.error(res.error ?? 'Error al actualizar')
        }
      } else {
        const res = await api.ipBindings.create(form)
        if (res.ok) {
          toast.success('IP Binding creado')
          setEditing(null)
          void reload()
        } else {
          toast.error(res.error ?? 'Error al crear')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    const res = await api.ipBindings.remove(deleting.rosId)
    setBusy(false)
    if (res.ok) {
      toast.success('IP Binding eliminado')
      setDeleting(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al eliminar')
    }
  }

  const toggleDisable = async (b: IpBinding): Promise<void> => {
    const res = b.disabled
      ? await api.ipBindings.enable(b.rosId)
      : await api.ipBindings.disable(b.rosId)
    if (res.ok) {
      toast.success(b.disabled ? 'Habilitado' : 'Deshabilitado')
      void reload()
    } else {
      toast.error(res.error ?? 'Error')
    }
  }

  return (
    <div>
      <SectionHead title="IP Binding" onBack={onBack}>
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nuevo IP Binding
        </button>
      </SectionHead>

      {loaded && bindings.length === 0 ? (
        <EmptyState icon="🔗" title="Sin IP Bindings">
          Crea un IP Binding manual o convierte un host desde la pantalla Hosts.
        </EmptyState>
      ) : (
        <>
          <div className="form-grid" style={{ marginBottom: 12, maxWidth: 400 }}>
            <div className="field full">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Buscar por MAC, IP o comment..."
              />
            </div>
          </div>
          <div className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MAC</th>
                  <th>IP</th>
                  <th>Tipo</th>
                  <th>Comment</th>
                  <th>Expiración</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.rosId} className={b.disabled ? 'disabled-row' : ''}>
                    <td className="mono">{b.macAddress}</td>
                    <td className="mono">{b.address || '—'}</td>
                    <td>
                      <span
                        className={`badge ${b.type === 'bypassed' ? 'green' : b.type === 'blocked' ? 'red' : ''}`}
                      >
                        {b.type}
                      </span>
                    </td>
                    <td>{b.comment || '—'}</td>
                    <td>
                      {b.hasScheduler ? (
                        <span className="badge">{b.schedulerInterval || 'Con timer'}</span>
                      ) : (
                        <span className="badge green">VIP</span>
                      )}
                    </td>
                    <td>{b.disabled ? <span className="badge">Deshabilitado</span> : 'Activo'}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => setEditing(b)}>
                          Editar
                        </button>
                        <button className="btn sm" onClick={() => void toggleDisable(b)}>
                          {b.disabled ? 'Habilitar' : 'Deshabilitar'}
                        </button>
                        <button className="btn sm danger" onClick={() => setDeleting(b)}>
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <IpBindingEditor
          binding={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={save}
          busy={busy}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar IP Binding"
          message={
            <>
              ¿Eliminar el IP Binding de <b>{deleting.macAddress}</b>?
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

function IpBindingEditor({
  binding,
  onClose,
  onSave,
  busy
}: {
  binding: IpBinding | null
  onClose: () => void
  onSave: (form: IpBindingInput) => void
  busy: boolean
}): React.JSX.Element {
  const toast = useToast()
  const [form, setForm] = useState<IpBindingInput>(() => {
    if (!binding) return { ...emptyForm }
    const parsed = parseInterval(binding.schedulerInterval)
    return {
      macAddress: binding.macAddress,
      address: binding.address,
      type: binding.type,
      comment: binding.comment,
      expiryValue: binding.hasScheduler ? parsed.value : 1,
      expiryUnit: binding.hasScheduler ? parsed.unit : 'd',
      isVip: !binding.hasScheduler
    }
  })

  const handleSubmit = (): void => {
    if (!form.macAddress.trim()) {
      toast.error('La MAC es obligatoria')
      return
    }
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(form.macAddress)) {
      toast.error('Formato de MAC inválido (ej: AA:BB:CC:DD:EE:FF)')
      return
    }
    onSave(form)
  }

  return (
    <Modal
      title={binding ? 'Editar IP Binding' : 'Nuevo IP Binding'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => handleSubmit()} disabled={busy}>
            {busy ? <span className="spinner" /> : '💾'} Guardar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>MAC *</label>
          <input
            value={form.macAddress}
            onChange={(e) => setForm({ ...form, macAddress: e.target.value.trim() })}
            placeholder="AA:BB:CC:DD:EE:FF"
            className="mono"
            disabled={!!binding}
            autoFocus
          />
        </div>
        <div className="field">
          <label>IP (opcional)</label>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value.trim() })}
            placeholder="192.168.88.100"
            className="mono"
          />
        </div>
        <div className="field">
          <label>Tipo</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as IpBindingInput['type'] })}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field full">
          <label className="check-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isVip}
              onChange={(e) =>
                setForm({
                  ...form,
                  isVip: e.target.checked,
                  expiryValue: e.target.checked ? 0 : 1
                })
              }
            />
            VIP (sin expiración)
          </label>
        </div>
        {!form.isVip && (
          <div className="field full">
            <label>Expiración</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min={1}
                value={form.expiryValue}
                onChange={(e) => setForm({ ...form, expiryValue: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                style={{ width: 80, flexShrink: 0 }}
              />
              <select
                value={form.expiryUnit}
                onChange={(e) => setForm({ ...form, expiryUnit: e.target.value as 'm' | 'h' | 'd' })}
              >
                {EXPIRY_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className="field full">
          <label>Comment</label>
          <input
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            placeholder="Ej. PC del recepcionista"
          />
        </div>
      </div>
    </Modal>
  )
}
