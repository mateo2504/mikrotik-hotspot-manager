import { useEffect, useState } from 'react'

/**
 * Muestra HTML arbitrario (posiblemente con imágenes base64 de varios MB) en un
 * iframe. Usa un Blob URL en vez de srcDoc: meter megabytes en el atributo srcDoc
 * a través de React es lento y puede quedar en blanco. El Blob URL solo guarda una
 * referencia corta y el iframe carga el contenido pesado eficientemente.
 */
export function HtmlPreview({
  html,
  style,
  title = 'Vista previa'
}: {
  html: string
  style?: React.CSSProperties
  title?: string
}): React.JSX.Element {
  const [url, setUrl] = useState<string>('')

  useEffect(() => {
    if (!html) {
      setUrl('')
      return
    }
    const blob = new Blob([html], { type: 'text/html' })
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [html])

  return (
    <iframe className="preview-frame" style={style} src={url || undefined} title={title} />
  )
}
