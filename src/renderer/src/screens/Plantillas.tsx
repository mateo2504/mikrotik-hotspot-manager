import { useMemo, useEffect, useState } from 'react'
import type {
  Template,
  TemplateConfig,
  TemplateField,
  TemplateInput,
  VoucherPrintData
} from '../../../shared/types'
import { renderVoucherHTML } from '../../../shared/voucherRender'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { HtmlPreview } from '../components/HtmlPreview'
import { api } from '../lib/api'

const FIELD_NAMES: Record<string, string> = {
  header: 'Encabezado',
  plan: 'Plan',
  usuario: 'Usuario',
  password: 'Contraseña',
  price: 'Precio',
  validity: 'Vigencia',
  footer: 'Pie de página'
}

const SAMPLE: VoucherPrintData = {
  username: 'abc123',
  password: 'xy89',
  plan: '1 Día',
  price: '$10',
  validity: '3d',
  userEqualsPass: false,
  userOnly: false,
  routerHost: '192.168.88.1',
  qrDataUrl: 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=http://192.168.88.1'
}

export default function Plantillas({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<Template | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    setTemplates(await api.templates.list())
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
  }, [])

  const remove = async (): Promise<void> => {
    if (!deleting) return
    setBusy(true)
    await api.templates.remove(deleting.id)
    setBusy(false)
    toast.success(`Plantilla "${deleting.name}" eliminada`)
    setDeleting(null)
    void reload()
  }

  return (
    <div>
      <SectionHead title="Plantillas de impresión" onBack={onBack}>
        <button className="btn primary" onClick={() => setEditing('new')}>
          + Nueva plantilla
        </button>
      </SectionHead>

      {loaded && templates.length === 0 ? (
        <EmptyState icon="🖨️" title="Sin plantillas">
          Crea una plantilla para imprimir tus fichas.
        </EmptyState>
      ) : (
        <div className="router-grid">
          {templates.map((t) => (
            <div key={t.id} className="router-card">
              <div className="rc-head">
                <div className="rc-icon">{t.kind === 'a4' ? '📄' : '🧾'}</div>
                <div>
                  <div className="rc-name">{t.name}</div>
                  <div className="rc-host">
                    {t.kind === 'a4'
                      ? `${t.config.page} · ${t.config.cols} x ${t.config.rows} fichas`
                      : `Térmica ${t.config.thermalWidth}mm`}
                  </div>
                </div>
              </div>
              <div className="rc-meta">
                {t.bgImagePath ? 'Con imagen de fondo' : 'Sin imagen de fondo'}
              </div>
              <div className="rc-actions">
                <button className="btn primary" onClick={() => setEditing(t)}>
                  Editar
                </button>
                <button className="btn sm danger" onClick={() => setDeleting(t)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditor
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar plantilla"
          message={
            <>
              ¿Eliminar la plantilla <b>{deleting.name}</b>?
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

const FONTS = [
  'Arial',
  'Segoe UI',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Impact',
  'Comic Sans MS'
]

function defaultConfig(): TemplateConfig {
  return {
    kind: 'a4',
    page: 'A4',
    cols: 2,
    rows: 5,
    thermalWidth: 58,
    paddingMm: 3,
    bgMode: 'stretch',
    textColor: '#000000',
    fontFamily: 'Arial',
    fields: [
      { id: 'header', label: 'WiFi Internet', visible: true, size: 'm', bold: true, align: 'center' },
      { id: 'plan', label: '', visible: true, size: 's', bold: false, align: 'center' },
      { id: 'usuario', label: 'Usuario', visible: true, size: 'm', bold: false, align: 'center' },
      { id: 'password', label: 'Contraseña', visible: true, size: 'm', bold: false, align: 'center' },
      { id: 'price', label: 'Precio', visible: true, size: 's', bold: false, align: 'center' },
      { id: 'validity', label: 'Vigencia', visible: true, size: 's', bold: false, align: 'center' },
      { id: 'footer', label: 'Gracias por su compra', visible: true, size: 's', bold: false, align: 'center' }
    ],
    qrEnabled: true,
    qrPosition: 'bottom-right',
    qrSize: 30,
    qrOpacity: 0.85
  }
}

function TemplateEditor({
  template,
  onClose,
  onSaved
}: {
  template: Template | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [name, setName] = useState(template?.name ?? '')
  const [config, setConfig] = useState<TemplateConfig>(() => {
    if (!template) return defaultConfig()
    // Plantillas guardadas antes de existir color/tipo de letra: aplicar defaults
    const c = structuredClone(template.config)
    c.textColor = c.textColor ?? '#000000'
    c.fontFamily = c.fontFamily ?? 'Arial'
    return c
  })
  const [bgImagePath, setBgImagePath] = useState<string | null>(template?.bgImagePath ?? null)
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(template?.bgDataUrl ?? null)
  const [busy, setBusy] = useState(false)

  const previewHtml = useMemo(() => {
    const samples =
      config.kind === 'a4'
        ? Array.from({ length: Math.min(config.cols * config.rows, 10) }, () => SAMPLE)
        : [SAMPLE]
    return renderVoucherHTML(config, bgDataUrl, samples, true)
  }, [config, bgDataUrl])

  const pickImage = async (): Promise<void> => {
    const res = await api.templates.pickImage()
    if (res) {
      setBgImagePath(res.path)
      setBgDataUrl(res.dataUrl)
    }
  }

  const updateField = (idx: number, patch: Partial<TemplateField>): void => {
    const fields = config.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f))
    setConfig({ ...config, fields })
  }

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    setBusy(true)
    const input: TemplateInput = { name, kind: config.kind, config, bgImagePath }
    try {
      if (template) await api.templates.update(template.id, input)
      else await api.templates.create(input)
      toast.success('Plantilla guardada')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={template ? `Editar plantilla ${template.name}` : 'Nueva plantilla'}
      onClose={onClose}
      wide
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
      <div className="tpl-editor">
        <div>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Nombre</label>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Formato</label>
              <select
                value={config.kind}
                onChange={(e) =>
                  setConfig({ ...config, kind: e.target.value as TemplateConfig['kind'] })
                }
              >
                <option value="a4">Hoja (A4 / Carta) en cuadrícula</option>
                <option value="thermal">Impresora térmica</option>
              </select>
            </div>
            {config.kind === 'a4' ? (
              <>
                <div className="field">
                  <label>Tamaño de hoja</label>
                  <select
                    value={config.page}
                    onChange={(e) =>
                      setConfig({ ...config, page: e.target.value as TemplateConfig['page'] })
                    }
                  >
                    <option value="A4">A4</option>
                    <option value="Letter">Carta</option>
                  </select>
                </div>
                <div className="field">
                  <label>Cuadrícula (columnas x filas)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={config.cols}
                      onChange={(e) => setConfig({ ...config, cols: Number(e.target.value) || 1 })}
                    />
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={config.rows}
                      onChange={(e) => setConfig({ ...config, rows: Number(e.target.value) || 1 })}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="field">
                <label>Ancho del papel</label>
                <select
                  value={config.thermalWidth}
                  onChange={(e) =>
                    setConfig({ ...config, thermalWidth: Number(e.target.value) as 58 | 80 })
                  }
                >
                  <option value={58}>58 mm</option>
                  <option value={80}>80 mm</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Margen interno (mm)</label>
              <input
                type="number"
                min={0}
                max={15}
                value={config.paddingMm}
                onChange={(e) => setConfig({ ...config, paddingMm: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>Tipo de letra</label>
              <select
                value={config.fontFamily ?? 'Arial'}
                onChange={(e) => setConfig({ ...config, fontFamily: e.target.value })}
              >
                {FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Color de letra</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={config.textColor ?? '#000000'}
                  onChange={(e) => setConfig({ ...config, textColor: e.target.value })}
                  style={{ width: 46, height: 32, padding: 2, cursor: 'pointer' }}
                />
                <span className="mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                  {config.textColor ?? '#000000'}
                </span>
              </div>
            </div>
            <div className="field full">
              <label>Imagen de fondo</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn sm" onClick={() => void pickImage()}>
                  {bgImagePath ? 'Cambiar imagen…' : 'Agregar imagen…'}
                </button>
                {bgImagePath && (
                  <>
                    <select
                      value={config.bgMode}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          bgMode: e.target.value as TemplateConfig['bgMode']
                        })
                      }
                      style={{
                        padding: '6px 8px',
                        background: 'var(--bg-soft)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        color: 'var(--text)'
                      }}
                    >
                      <option value="stretch">Estirar</option>
                      <option value="cover">Cubrir</option>
                      <option value="contain">Contener</option>
                    </select>
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        setBgImagePath(null)
                        setBgDataUrl(null)
                      }}
                    >
                      Quitar
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="field full" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={config.qrEnabled ?? false}
                onChange={(e) => setConfig({ ...config, qrEnabled: e.target.checked })}
              />
              Mostrar código QR (fondo, detrás de las letras)
            </label>
            {config.qrEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                <div className="field">
                  <label>Posición</label>
                  <select
                    value={config.qrPosition ?? 'bottom-right'}
                    onChange={(e) =>
                      setConfig({ ...config, qrPosition: e.target.value as TemplateConfig['qrPosition'] })
                    }
                  >
                    <option value="bottom-right">Esquina inferior derecha</option>
                    <option value="bottom-left">Esquina inferior izquierda</option>
                    <option value="bottom-center">Centro inferior</option>
                    <option value="top-right">Esquina superior derecha</option>
                    <option value="top-left">Esquina superior izquierda</option>
                    <option value="center">Centro</option>
                  </select>
                </div>
                <div className="field">
                  <label>Tamaño (% de la ficha)</label>
                  <input
                    type="number"
                    min={10}
                    max={80}
                    value={config.qrSize ?? 30}
                    onChange={(e) => setConfig({ ...config, qrSize: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Opacidad</label>
                  <select
                    value={String(config.qrOpacity ?? 0.85)}
                    onChange={(e) => setConfig({ ...config, qrOpacity: Number(e.target.value) })}
                  >
                    <option value="0.4">Muy transparente</option>
                    <option value="0.6">Transparente</option>
                    <option value="0.85">Normal</option>
                    <option value="1">Opaco</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="field" style={{ marginBottom: 8 }}>
            <label>Campos de la ficha (mostrar, texto, tamaño, negrita, alineación)</label>
          </div>
          <div className="fields-list">
            {config.fields.map((f, i) => (
              <div key={f.id} className="field-row">
                <input
                  type="checkbox"
                  checked={f.visible}
                  onChange={(e) => updateField(i, { visible: e.target.checked })}
                />
                <span className="fr-name">{FIELD_NAMES[f.id] ?? f.id}</span>
                <input
                  type="text"
                  value={f.label}
                  placeholder={
                    f.id === 'header' || f.id === 'footer' ? 'Texto…' : 'Etiqueta (opcional)'
                  }
                  onChange={(e) => updateField(i, { label: e.target.value })}
                />
                <select
                  value={f.size}
                  onChange={(e) => updateField(i, { size: e.target.value as TemplateField['size'] })}
                >
                  <option value="s">Chico</option>
                  <option value="m">Medio</option>
                  <option value="l">Grande</option>
                </select>
                <select
                  value={f.bold ? '1' : '0'}
                  onChange={(e) => updateField(i, { bold: e.target.value === '1' })}
                >
                  <option value="0">Normal</option>
                  <option value="1">Negrita</option>
                </select>
                <select
                  value={f.align}
                  onChange={(e) =>
                    updateField(i, { align: e.target.value as TemplateField['align'] })
                  }
                >
                  <option value="left">⬅</option>
                  <option value="center">⬌</option>
                  <option value="right">➡</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Vista previa</label>
          </div>
          <HtmlPreview
            html={previewHtml}
            style={{ height: 520 }}
            title="Vista previa de plantilla"
          />
        </div>
      </div>
    </Modal>
  )
}
