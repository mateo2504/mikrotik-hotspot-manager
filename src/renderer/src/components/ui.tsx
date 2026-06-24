import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode
} from 'react'

// ---------- Modal ----------

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide = false
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  wide?: boolean
}): React.JSX.Element {
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal${wide ? ' wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------- Confirmación ----------

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Eliminar',
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : null} {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
    </Modal>
  )
}

// ---------- Estado vacío ----------

export function EmptyState({
  icon,
  title,
  children
}: {
  icon: string
  title: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="es-icon">{icon}</div>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  )
}

// ---------- Toasts ----------

interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface ToastApi {
  info: (text: string) => void
  success: (text: string) => void
  error: (text: string) => void
}

const ToastContext = createContext<ToastApi>({
  info: () => {},
  success: () => {},
  error: () => {}
})

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  const apiRef = useRef<ToastApi>({
    info: (t) => push('info', t),
    success: (t) => push('success', t),
    error: (t) => push('error', t)
  })

  return (
    <ToastContext.Provider value={apiRef.current}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ---------- Encabezado de sección con volver ----------

export function SectionHead({
  title,
  onBack,
  children
}: {
  title: string
  onBack: () => void
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="screen-head">
      <button className="btn" onClick={onBack}>
        ← Volver
      </button>
      <h1>{title}</h1>
      <div className="spacer" />
      {children}
    </div>
  )
}
