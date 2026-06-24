import { useEffect, useMemo, useState } from 'react'
import type { HotspotHost, IpBindingInput } from '../../../shared/types'
import { EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { api, formatBytes } from '../lib/api'

const EXPIRY_UNITS = [
  { value: 'm', label: 'minutos' },
  { value: 'h', label: 'horas' },
  { value: 'd', label: 'días' }
]

export default function Hosts({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [hosts, setHosts] = useState<HotspotHost[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [converting, setConverting] = useState<HotspotHost | null>(null)
  const [ipAddress, setIpAddress] = useState('')
  const [comment, setComment] = useState('')
  const [isVip, setIsVip] = useState(true)
  const [expiryValue, setExpiryValue] = useState(1)
  const [expiryUnit, setExpiryUnit] = useState<'m' | 'h' | 'd'>('d')
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      setHosts(await api.hosts.list())
      setLoaded(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    void reload()
    const interval = setInterval(() => void reload(), 10000)
    return () => clearInterval(interval)
  }, [])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return hosts
    return hosts.filter(
      (h) =>
        h.macAddress.toLowerCase().includes(s) ||
        h.address.toLowerCase().includes(s) ||
        h.comment.toLowerCase().includes(s)
    )
  }, [hosts, search])

  const convert = async (): Promise<void> => {
    if (!converting) return
    setBusy(true)
    const input: IpBindingInput = {
      macAddress: converting.macAddress,
      address: ipAddress.trim(),
      type: 'bypassed',
      comment: comment.trim(),
      expiryValue: isVip ? 0 : expiryValue,
      expiryUnit,
      isVip
    }
    const res = await api.hosts.convertToIpBinding(input)
    setBusy(false)
    if (res.ok) {
      toast.success('Convertido a IP Binding (bypassed)')
      setConverting(null)
      setIpAddress('')
      setComment('')
      setIsVip(true)
      setExpiryValue(1)
      setExpiryUnit('d')
      void reload()
    } else {
      toast.error(res.error ?? 'Error al convertir')
    }
  }

  return (
    <div>
      <SectionHead title="Hosts del Hotspot" onBack={onBack}>
        <button className="btn primary" onClick={() => void reload()}>
          ⟳ Actualizar
        </button>
      </SectionHead>

      <div className="form-grid" style={{ marginBottom: 12, maxWidth: 400 }}>
        <div className="field full">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Buscar por MAC, IP o comment..."
          />
        </div>
      </div>

      {loaded && filtered.length === 0 ? (
        <EmptyState icon="🖥️" title="Sin hosts">
          {search ? 'No hay hosts que coincidan con la búsqueda.' : 'No hay dispositivos conectados al hotspot en este momento.'}
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>MAC</th>
                <th>IP</th>
                <th>Estado</th>
                <th>Uptime</th>
                <th>Tráfico</th>
                <th>Comment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => (
                <tr key={h.rosId}>
                  <td className="mono">{h.macAddress}</td>
                  <td className="mono">{h.address}</td>
                  <td>
                    {h.bypassed ? (
                      <span className="badge green">Bypass</span>
                    ) : h.blocked ? (
                      <span className="badge red">Bloqueado</span>
                    ) : h.authorized ? (
                      <span className="badge green">Autorizado</span>
                    ) : (
                      <span className="badge">Pendiente</span>
                    )}
                  </td>
                  <td>{h.uptime}</td>
                  <td>
                    ↓{formatBytes(h.bytesIn)} ↑{formatBytes(h.bytesOut)}
                  </td>
                  <td>{h.comment || '—'}</td>
                  <td>
                    <button
                      className="btn sm primary"
                      disabled={h.bypassed}
                      onClick={() => {
                        setConverting(h)
                        setIpAddress(h.address)
                        setComment(h.comment)
                        setIsVip(true)
                        setExpiryValue(1)
                        setExpiryUnit('d')
                      }}
                    >
                      {h.bypassed ? '✓ Bypass' : 'Convertir a IP Binding'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {converting && (
        <Modal
          title="Convertir a IP Binding"
          onClose={() => { setConverting(null); setIpAddress(''); setComment(''); setIsVip(true); setExpiryValue(1); setExpiryUnit('d') }}
          footer={
            <>
              <button className="btn" onClick={() => { setConverting(null); setIpAddress(''); setComment(''); setIsVip(true); setExpiryValue(1); setExpiryUnit('d') }}>
                Cancelar
              </button>
              <button className="btn primary" onClick={() => void convert()} disabled={busy}>
                {busy ? <span className="spinner" /> : '✓'} Convertir
              </button>
            </>
          }
        >
          <div className="form-grid">
            <div className="field">
              <label>MAC</label>
              <input value={converting.macAddress} readOnly className="mono" />
            </div>
            <div className="field">
              <label>IP</label>
              <input
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value.trim())}
                placeholder="Ej. 192.168.88.100 (o vacío)"
                className="mono"
              />
            </div>
            <div className="field full">
              <label>Comment (opcional)</label>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Ej. PC del recepcionista"
              />
            </div>
            <div className="field full">
              <label className="check-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={isVip}
                  onChange={(e) => setIsVip(e.target.checked)}
                />
                VIP (sin expiración)
              </label>
            </div>
            {!isVip && (
              <div className="field full">
                <label>Expiración</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    min={1}
                    value={expiryValue}
                    onChange={(e) => setExpiryValue(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    style={{ width: 80, flexShrink: 0 }}
                  />
                  <select
                    value={expiryUnit}
                    onChange={(e) => setExpiryUnit(e.target.value as 'm' | 'h' | 'd')}
                  >
                    {EXPIRY_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
