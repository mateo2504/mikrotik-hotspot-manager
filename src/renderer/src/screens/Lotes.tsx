import { useEffect, useRef, useState } from 'react'
import type {
  Batch,
  CodeOptions,
  HotspotProfile,
  PrinterInfo,
  Template,
  Voucher
} from '../../../shared/types'
import { ConfirmDialog, EmptyState, Modal, SectionHead, useToast } from '../components/ui'
import { HtmlPreview } from '../components/HtmlPreview'
import { api, formatDate } from '../lib/api'

export default function Lotes({ onBack }: { onBack: () => void }): React.JSX.Element {
  const toast = useToast()
  const [batches, setBatches] = useState<Batch[]>([])
  const [profiles, setProfiles] = useState<HotspotProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState<Batch | null>(null)
  const [viewing, setViewing] = useState<Batch | null>(null)
  const [resuming, setResuming] = useState<Batch | null>(null)
  const [deleting, setDeleting] = useState<Batch | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const [b, p] = await Promise.all([api.batches.list(), api.profiles.list()])
      setBatches(b)
      setProfiles(p)
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
    const res = await api.batches.remove(deleting.id)
    setBusy(false)
    if (res.ok) {
      toast.success(`Lote eliminado (${res.removedFromRouter ?? 0} usuarios borrados del router)`)
      setDeleting(null)
      void reload()
    } else {
      toast.error(res.error ?? 'Error al eliminar el lote')
    }
  }

  return (
    <div>
      <SectionHead title="Lotes de fichas" onBack={onBack}>
        <button className="btn primary" onClick={() => setGenerating(true)}>
          + Generar lote
        </button>
      </SectionHead>

      {loaded && batches.length === 0 ? (
        <EmptyState icon="🎟️" title="Sin lotes">
          Genera tu primer lote de fichas con el botón &quot;Generar lote&quot;.
        </EmptyState>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lote</th>
                <th>Plan</th>
                <th>Fichas</th>
                <th>Fecha</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="mono">
                    <b>{b.commentTag.replace('lote:', '')}</b>
                  </td>
                  <td>{b.profileName}</td>
                  <td>{b.voucherCount}</td>
                  <td>{formatDate(b.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn sm" onClick={() => setViewing(b)}>
                        Ver fichas
                      </button>
                      <button className="btn sm primary" onClick={() => setResuming(b)}>
                        ↻ Reanudar
                      </button>
                      <button className="btn sm primary" onClick={() => setPrinting(b)}>
                        🖨️ Imprimir
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
      )}

      {generating && (
        <GenerateForm
          profiles={profiles}
          onClose={() => setGenerating(false)}
          onDone={(batch) => {
            setGenerating(false)
            void reload().then(() => {
              if (batch) setPrinting(batch)
            })
          }}
        />
      )}

      {printing && <PrintModal batch={printing} onClose={() => setPrinting(null)} />}

      {viewing && <VouchersModal batch={viewing} onClose={() => setViewing(null)} />}

      {resuming && (
        <ResumeBatchModal
          batch={resuming}
          onClose={() => setResuming(null)}
          onDone={() => {
            setResuming(null)
            void reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Eliminar lote"
          message={
            <>
              ¿Eliminar el lote <b>{deleting.commentTag.replace('lote:', '')}</b> (
              {deleting.voucherCount} fichas)? Se borrarán los usuarios del router y el registro
              local. Esta acción no se puede deshacer.
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

// ---------- Reanudar lote ----------

function ResumeBatchModal({
  batch,
  onClose,
  onDone
}: {
  batch: Batch
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [present, setPresent] = useState<string[] | null>(null)
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [waitingForConnection, setWaitingForConnection] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)
  const waitingUnsubRef = useRef<(() => void) | null>(null)

  const check = async (): Promise<void> => {
    setChecking(true)
    const result = await api.batches.checkOnRouter(batch.id)
    setChecking(false)
    if (result.ok) setPresent(result.present ?? [])
    else toast.error(result.error ?? 'No se pudo verificar el lote')
  }

  useEffect(() => {
    void check()
    return () => {
      unsubRef.current?.()
      waitingUnsubRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id])

  const resume = async (): Promise<void> => {
    setBusy(true)
    setWaitingForConnection(false)
    setProgress({ done: 0, total: Math.max(1, batch.voucherCount - (present?.length ?? 0)) })
    unsubRef.current = api.batches.onGenerateProgress((value) => {
      setWaitingForConnection(false)
      setProgress(value)
    })
    waitingUnsubRef.current = api.batches.onResumeWaitingConnection(() => {
      setWaitingForConnection(true)
    })
    const result = await api.batches.resume(batch.id)
    unsubRef.current?.()
    waitingUnsubRef.current?.()
    setBusy(false)
    if (!result.ok) {
      setProgress(null)
      toast.error(result.error ?? 'No se pudo reanudar el lote')
      return
    }
    toast.success(
      `Lote reanudado: ${result.created ?? 0} fichas creadas${result.failed ? `, ${result.failed} fallidas` : ''}`
    )
    onDone()
  }

  const missing = present === null ? null : Math.max(0, batch.voucherCount - present.length)
  return (
    <Modal
      title={`Reanudar lote ${batch.commentTag.replace('lote:', '')}`}
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={() => void check()} disabled={checking || busy}>
            {checking ? <span className="spinner" /> : '⟳'} Revalidar
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => void resume()} disabled={checking || busy || missing === 0}>
            {busy ? <span className="spinner" /> : '↻'} Reanudar {missing ?? ''} fichas
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-dim)', lineHeight: 1.55 }}>
        Se verificará de nuevo el lote en el router y solo se crearán las fichas que falten. Las
        fichas ya existentes no se duplicarán.
      </p>
      <div style={{ marginTop: 16, fontWeight: 600 }}>
        {checking
          ? 'Verificando fichas existentes en el router…'
          : missing === 0
            ? 'Todas las fichas de este lote ya existen en el router.'
            : `${present?.length ?? 0} de ${batch.voucherCount} ya existen; se crearán ${missing} fichas.`}
      </div>
      {progress && (
        <div className="field full" style={{ marginTop: 16 }}>
          <label>
            {waitingForConnection
              ? 'Esperando que se restablezca la conexión…'
              : `Creando fichas faltantes… ${progress.done} / ${progress.total}`}
          </label>
          <div className="progress-bar">
            <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------- Generar lote ----------

function GenerateForm({
  profiles,
  onClose,
  onDone
}: {
  profiles: HotspotProfile[]
  onClose: () => void
  onDone: (batch: Batch | null) => void
}): React.JSX.Element {
  const toast = useToast()
  const [profileName, setProfileName] = useState(profiles[0]?.name ?? '')
  const [options, setOptions] = useState<CodeOptions>({
    qty: 20,
    prefix: '',
    length: 6,
    charset: 'alnum',
    userMode: 'same',
    passwordLength: 6,
    passwordCharset: 'alnum'
  })
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      unsubRef.current?.()
    }
  }, [])

  const generate = async (): Promise<void> => {
    if (!profileName) {
      toast.error('Primero crea un plan en el menú Planes')
      return
    }
    if (options.qty < 1 || options.qty > 2000) {
      toast.error('La cantidad debe estar entre 1 y 2000')
      return
    }
    setBusy(true)
    setProgress({ done: 0, total: options.qty })
    unsubRef.current = api.batches.onGenerateProgress((p) => setProgress(p))
    const res = await api.batches.generate({ profileName, codeOptions: options })
    unsubRef.current?.()
    setBusy(false)
    if (res.ok) {
      toast.success(
        `Lote generado: ${res.created} fichas creadas${res.failed ? `, ${res.failed} fallidas` : ''}`
      )
      const batches = await api.batches.list()
      onDone(batches.find((b) => b.id === res.batchId) ?? null)
    } else {
      setProgress(null)
      toast.error(res.error ?? 'Error al generar el lote')
    }
  }

  return (
    <Modal
      title="Generar lote de fichas"
      onClose={busy ? () => {} : onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={() => void generate()} disabled={busy}>
            {busy ? <span className="spinner" /> : '⚡'} Generar
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label>Plan</label>
          <select value={profileName} onChange={(e) => setProfileName(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.meta?.price ? ` — ${p.meta.price}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Cantidad de fichas</label>
          <input
            type="number"
            min={1}
            max={2000}
            value={options.qty}
            onChange={(e) => setOptions({ ...options, qty: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>Tipo de ficha</label>
          <select
            value={options.userMode}
            onChange={(e) =>
              setOptions({
                ...options,
                userMode: e.target.value as CodeOptions['userMode']
              })
            }
          >
            <option value="separate">Usuario y Contraseña</option>
            <option value="same">Usuario = Contraseña</option>
            <option value="userOnly">Solo Usuario</option>
          </select>
        </div>
        <div className="field">
          <label>Prefijo</label>
          <input
            value={options.prefix}
            onChange={(e) => setOptions({ ...options, prefix: e.target.value.trim() })}
            placeholder="Opcional, ej. wifi-"
          />
        </div>
        <div className="field">
          <label>Largo del código</label>
          <input
            type="number"
            min={3}
            max={12}
            value={options.length}
            onChange={(e) => setOptions({ ...options, length: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>{'Caracteres del c\u00f3digo'}</label>
          <select
            value={options.charset}
            onChange={(e) =>
              setOptions({ ...options, charset: e.target.value as CodeOptions['charset'] })
            }
          >
            <option value="num">Solo números</option>
            <option value="lower">Letras minúsculas</option>
            <option value="upper">Letras MAYÚSCULAS</option>
            <option value="alnum">Letras y números</option>
          </select>
        </div>
        {options.userMode === 'separate' && (
          <>
            <div className="field">
              <label>{'Largo de la contrase\u00f1a'}</label>
              <input
                type="number"
                min={3}
                max={12}
                value={options.passwordLength}
                onChange={(e) => setOptions({ ...options, passwordLength: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>{'Caracteres de la contrase\u00f1a'}</label>
              <select
                value={options.passwordCharset}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    passwordCharset: e.target.value as CodeOptions['passwordCharset']
                  })
                }
              >
                <option value="num">{'Solo n\u00fameros'}</option>
                <option value="lower">{'Letras min\u00fasculas'}</option>
                <option value="upper">{'Letras MAY\u00daSCULAS'}</option>
                <option value="alnum">{'Letras y n\u00fameros'}</option>
              </select>
            </div>
          </>
        )}
        {progress && (
          <div className="field full">
            <label>
              Creando usuarios en el router… {progress.done} / {progress.total}
            </label>
            <div className="progress-bar">
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------- Ver fichas ----------

function VouchersModal({
  batch,
  onClose
}: {
  batch: Batch
  onClose: () => void
}): React.JSX.Element {
  const toast = useToast()
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  // present: Set de usernames que existen AHORA en el router (validación en vivo).
  // null = aún no verificado / no se pudo verificar.
  const [present, setPresent] = useState<Set<string> | null>(null)
  const [checking, setChecking] = useState(true)

  const check = async (): Promise<void> => {
    setChecking(true)
    const res = await api.batches.checkOnRouter(batch.id)
    setChecking(false)
    if (res.ok && res.present) {
      setPresent(new Set(res.present))
    } else {
      setPresent(null)
      if (res.error) toast.error(res.error)
    }
  }

  useEffect(() => {
    void api.batches.getVouchers(batch.id).then(setVouchers)
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.id])

  const existsCount = present ? vouchers.filter((v) => present.has(v.username)).length : 0

  return (
    <Modal
      title={`Fichas del lote ${batch.commentTag.replace('lote:', '')}`}
      onClose={onClose}
      footer={
        <>
          <div style={{ marginRight: 'auto', color: 'var(--text-dim)', fontSize: 13 }}>
            {checking
              ? 'Verificando en el router…'
              : present
                ? `${existsCount} de ${vouchers.length} siguen en el router`
                : 'No verificado (sin conexión al router)'}
          </div>
          <button className="btn" onClick={() => void check()} disabled={checking}>
            {checking ? <span className="spinner" /> : '⟳'} Revalidar
          </button>
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      <div className="panel table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Usuario</th>
              <th>Contraseña</th>
              <th>En router</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v, i) => {
              const exists = present ? present.has(v.username) : null
              return (
                <tr key={v.id}>
                  <td>{i + 1}</td>
                  <td className="mono">{v.username}</td>
                  <td className="mono">{v.password}</td>
                  <td>
                    {checking ? (
                      <span style={{ color: 'var(--text-dim)' }}>…</span>
                    ) : exists === null ? (
                      <span className="badge">?</span>
                    ) : exists ? (
                      <span style={{ color: 'var(--green)' }}>✔</span>
                    ) : (
                      <span style={{ color: 'var(--red)' }}>✖</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

// ---------- Imprimir ----------

function PrintModal({ batch, onClose }: { batch: Batch; onClose: () => void }): React.JSX.Element {
  const toast = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [printerName, setPrinterName] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [previewHtml, setPreviewHtml] = useState('')
  const [printed, setPrinted] = useState<number | null>(null)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const [t, p, savedTpl, savedPrinter] = await Promise.all([
        api.templates.list(),
        api.print.listPrinters(),
        api.settings.get(`lastTemplateId:${batch.routerId}`),
        api.settings.get('lastPrinter')
      ])
      setTemplates(t)
      setPrinters(p)
      const tplId =
        savedTpl && t.some((x) => x.id === Number(savedTpl)) ? Number(savedTpl) : (t[0]?.id ?? null)
      setTemplateId(tplId)
      setPrinterName(
        savedPrinter && p.some((x) => x.name === savedPrinter)
          ? savedPrinter
          : (p.find((x) => x.isDefault)?.name ?? '')
      )
    })()
  }, [])

  useEffect(() => {
    if (templateId === null) return
    api.print
      .previewHtml(batch.id, templateId, onlyActive)
      .then((res) => {
        setPreviewHtml(res.html)
        setPrinted(res.printed)
        setVerified(res.verified)
      })
      .catch((err: unknown) => {
        setPreviewHtml(
          `<p style="font-family:sans-serif;color:#c00;padding:12px">Error en la vista previa: ${
            err instanceof Error ? err.message : String(err)
          }</p>`
        )
      })
  }, [batch.id, templateId, onlyActive])

  const saveChoices = (): void => {
    if (templateId !== null) void api.settings.set(`lastTemplateId:${batch.routerId}`, String(templateId))
    if (printerName) void api.settings.set('lastPrinter', printerName)
  }

  const reportCount = (res: { printed?: number; total?: number; verified?: boolean }): string => {
    if (res.verified && res.printed !== undefined && res.total !== undefined) {
      const skipped = res.total - res.printed
      return skipped > 0
        ? ` (${res.printed} activas, ${skipped} omitidas por estar expiradas o eliminadas)`
        : ` (${res.printed} fichas)`
    }
    return ''
  }

  const print = async (silent: boolean): Promise<void> => {
    if (templateId === null) {
      toast.error('Crea una plantilla primero')
      return
    }
    saveChoices()
    setBusy(true)
    const res = await api.print.batch({
      batchId: batch.id,
      templateId,
      printerName: printerName || undefined,
      silent,
      onlyActive
    })
    setBusy(false)
    if (res.ok) toast.success(`Enviado a la impresora${reportCount(res)}`)
    else if (res.error !== 'Impresión cancelada') toast.error(res.error ?? 'Error al imprimir')
  }

  const exportPdf = async (): Promise<void> => {
    if (templateId === null) return
    saveChoices()
    setBusy(true)
    const res = await api.print.pdf(batch.id, templateId, onlyActive)
    setBusy(false)
    if (res.ok) toast.success(`PDF guardado${reportCount(res)}`)
    else if (res.error !== 'cancelado') toast.error(res.error ?? 'Error al exportar PDF')
  }

  return (
    <Modal
      title={`Imprimir lote ${batch.commentTag.replace('lote:', '')} (${batch.voucherCount} fichas)`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => void exportPdf()} disabled={busy}>
            Exportar PDF
          </button>
          <button className="btn primary" onClick={() => void print(false)} disabled={busy}>
            {busy ? <span className="spinner" /> : '🖨️'} Imprimir
          </button>
        </>
      }
    >
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Plantilla</label>
          <select
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(Number(e.target.value))}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.kind === 'a4' ? 'Hoja' : 'Térmica'} · v{t.version})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Impresora</label>
          <select value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
            <option value="">(Impresora predeterminada)</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field full">
          <label className="check-row">
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={(e) => setOnlyActive(e.target.checked)}
            />
            Imprimir solo fichas activas (omitir expiradas o eliminadas del router)
          </label>
        </div>
      </div>
      <div
        className="field"
        style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}
      >
        <label>Vista previa (primera página)</label>
        {printed !== null && (
          <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
            {onlyActive && verified
              ? `Se imprimirán ${printed} de ${batch.voucherCount} fichas`
              : onlyActive && !verified
                ? 'Sin conexión al router: se imprimirán todas'
                : `Se imprimirán las ${batch.voucherCount} fichas`}
          </span>
        )}
      </div>
      <HtmlPreview html={previewHtml} style={{ height: 420 }} />
    </Modal>
  )
}
