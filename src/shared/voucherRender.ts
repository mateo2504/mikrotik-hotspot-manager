import type { TemplateConfig, TemplateField, VoucherPrintData } from './types'

const PAGE_MM = {
  A4: { w: 210, h: 297 },
  Letter: { w: 216, h: 279 }
}

const PAGE_MARGIN_MM = 6
const FONT_PT = { s: 7, m: 9, l: 12 }
const FONT_PT_THERMAL = { s: 8, m: 10, l: 13 }

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function qrPositionCss(pos: NonNullable<TemplateConfig['qrPosition']>): string {
  switch (pos) {
    case 'top-left':
      return 'top:0;left:0;'
    case 'top-right':
      return 'top:0;right:0;'
    case 'bottom-left':
      return 'bottom:0;left:0;'
    case 'bottom-right':
      return 'bottom:0;right:0;'
    case 'bottom-center':
      return 'bottom:0;left:50%;transform:translateX(-50%);'
    case 'center':
      return 'top:50%;left:50%;transform:translate(-50%,-50%);'
    default:
      return 'bottom:0;right:0;'
  }
}

function qrBgHtml(config: TemplateConfig, v: VoucherPrintData): string {
  if (!config.qrEnabled || !v.qrDataUrl) return ''
  const size = Math.max(10, Math.min(100, config.qrSize ?? 35))
  const pos = config.qrPosition ?? 'bottom-right'
  const opacity = Math.max(0.1, Math.min(1, config.qrOpacity ?? 0.85))
  return `<div class="qr-bg" style="${qrPositionCss(pos)}width:${size}%;opacity:${opacity};">
    <img src="${esc(v.qrDataUrl)}" style="width:100%;height:auto;display:block;" alt="QR" />
  </div>`
}

function fieldHtml(f: TemplateField, v: VoucherPrintData, isThermal: boolean): string {
  if (!f.visible) return ''
  let content = ''
  switch (f.id) {
    case 'header':
    case 'footer':
      content = esc(f.label)
      break
    case 'plan':
      content = v.plan ? esc(f.label ? `${f.label}: ${v.plan}` : v.plan) : ''
      break
    case 'usuario': {
      const label = f.label
      content = label
        ? `${esc(label)}: <span class="code">${esc(v.username)}</span>`
        : `<span class="code">${esc(v.username)}</span>`
      break
    }
    case 'password':
      if (v.userEqualsPass || v.userOnly) return ''
      content = f.label
        ? `${esc(f.label)}: <span class="code">${esc(v.password)}</span>`
        : `<span class="code">${esc(v.password)}</span>`
      break
    case 'price':
      content = v.price ? esc(f.label ? `${f.label}: ${v.price}` : v.price) : ''
      break
    case 'validity':
      content = v.validity ? esc(`${f.label || 'Vigencia'}: ${v.validity}`) : ''
      break
  }
  if (!content) return ''
  const fonts = isThermal ? FONT_PT_THERMAL : FONT_PT
  const style = [
    `font-size:${fonts[f.size]}pt`,
    `text-align:${f.align}`,
    f.bold ? 'font-weight:700' : 'font-weight:400'
  ].join(';')
  return `<div class="fld" style="${style}">${content}</div>`
}

function qrInlineHtml(config: TemplateConfig, v: VoucherPrintData): string {
  if (!config.qrEnabled || !v.qrDataUrl) return ''
  const size = Math.max(10, Math.min(100, config.qrSize ?? 45))
  return `<div class="qr-inline" style="margin-top:auto;align-self:center;width:100%;text-align:center;box-sizing:border-box;padding-top:1.5mm;">
    <img src="${esc(v.qrDataUrl)}" style="width:${size}%;max-width:100%;height:auto;display:block;margin:0 auto;" alt="QR" />
  </div>`
}

function voucherHtml(config: TemplateConfig, v: VoucherPrintData): string {
  const isThermal = config.kind === 'thermal'
  const qr = isThermal ? '' : qrBgHtml(config, v)
  const qrInline = isThermal ? qrInlineHtml(config, v) : ''
  const fields = config.fields.map((f) => fieldHtml(f, v, isThermal)).join('')
  return `<div class="voucher"><div class="vinner">${qr}<div class="content">${fields}${qrInline}</div></div></div>`
}

/**
 * Genera el documento HTML completo para imprimir (o previsualizar) fichas.
 * Mismo HTML para preview y para la ventana de impresión = WYSIWYG.
 */
export function renderVoucherHTML(
  config: TemplateConfig,
  bgDataUrl: string | null,
  vouchers: VoucherPrintData[],
  forPreview = false
): string {
  const pad = config.paddingMm
  let pageCss: string
  let bodyHtml: string

  if (config.kind === 'a4') {
    const page = PAGE_MM[config.page] ?? PAGE_MM.A4
    const cols = Math.max(1, config.cols)
    const rows = Math.max(1, config.rows)
    const innerW = page.w - PAGE_MARGIN_MM * 2
    const innerH = page.h - PAGE_MARGIN_MM * 2
    const cellH = innerH / rows
    const perPage = cols * rows
    const pages: string[] = []
    for (let i = 0; i < vouchers.length; i += perPage) {
      const cells = vouchers
        .slice(i, i + perPage)
        .map((v) => voucherHtml(config, v))
        .join('')
      pages.push(`<div class="page">${cells}</div>`)
    }
    pageCss = `
      @page { size: ${config.page === 'Letter' ? 'letter' : 'A4'}; margin: ${PAGE_MARGIN_MM}mm; }
      .page {
        display: grid;
        grid-template-columns: repeat(${cols}, 1fr);
        grid-auto-rows: ${cellH.toFixed(2)}mm;
        width: ${innerW}mm;
        break-after: page;
      }
      .voucher { padding: 1mm; box-sizing: border-box; height: 100%; }
      .vinner { border: 0.3mm dashed #999; }
    `
    bodyHtml = pages.join('')
  } else {
    const w = config.thermalWidth || 58
    pageCss = `
      @page { size: ${w}mm auto; margin: 0mm; }
      body { width: ${w}mm; }
      .voucher { width: ${w}mm; box-sizing: border-box; padding: 2mm 0; border-bottom: 0.5mm dashed #ccc; }
      .voucher:last-child { border-bottom: none; }
      .vinner { position: relative; overflow: hidden; box-sizing: border-box; }
      .content {
        position: relative;
        z-index: 2;
        box-sizing: border-box;
        padding: ${pad}mm;
        display: block;
      }
      .qr-inline { margin-top: 2mm; text-align: center; }
      .fld { line-height: 1.25; word-break: break-all; margin-bottom: 0.8mm; }
    `
    bodyHtml = vouchers.map((v) => voucherHtml(config, v)).join('')
  }

  // En vista previa: fondo blanco y, para térmica, centrar y enmarcar cada ficha
  // para que la franja angosta de 58/80mm no se confunda con una página en blanco.
  const previewCss = forPreview
    ? config.kind === 'thermal'
      ? `body { background: #eceff3; padding: 10px 0; }
         .voucher { margin: 0 auto 10px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.25); border-bottom: none; }`
      : `body { background: #fff; } .page { margin: 0 auto; }`
    : ''

  // La imagen de fondo se incrusta UNA sola vez como CSS (no por ficha):
  // con lotes grandes el data URL repetido hacía el HTML gigante.
  const bgSize =
    config.bgMode === 'stretch' ? '100% 100%' : (config.bgMode ?? 'stretch')
  const bgCss = bgDataUrl
    ? `.vinner {
    background-image: url("${bgDataUrl}");
    background-repeat: no-repeat;
    background-position: center;
    background-size: ${bgSize};
  }`
    : ''
  const fontFamily = config.fontFamily || 'Arial'
  const textColor = config.textColor || '#000000'

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; }
  body { font-family: "${fontFamily}", Arial, sans-serif; color: ${textColor}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${pageCss}
  .vinner {
    position: relative;
    height: 100%;
    overflow: hidden;
    box-sizing: border-box;
  }
  ${bgCss}
  .qr-bg {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    box-sizing: border-box;
    padding: 1mm;
  }
  .content {
    position: relative;
    z-index: 2;
    height: 100%;
    box-sizing: border-box;
    padding: ${pad}mm;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.8mm;
  }
  .fld { line-height: 1.25; word-break: break-all; }
  .code { font-weight: 700; letter-spacing: 0.5px; }
  ${previewCss}
</style>
</head>
<body>${bodyHtml}</body>
</html>`
}

/** Plantillas de fábrica */
export function defaultTemplates(): { name: string; config: TemplateConfig }[] {
  const baseFields = (): TemplateField[] => [
    { id: 'header', label: 'WiFi Internet', visible: true, size: 'm', bold: true, align: 'center' },
    { id: 'plan', label: '', visible: true, size: 's', bold: false, align: 'center' },
    { id: 'usuario', label: 'Usuario', visible: true, size: 'm', bold: false, align: 'center' },
    { id: 'password', label: 'Contraseña', visible: true, size: 'm', bold: false, align: 'center' },
    { id: 'price', label: 'Precio', visible: true, size: 's', bold: false, align: 'center' },
    { id: 'validity', label: 'Vigencia', visible: true, size: 's', bold: false, align: 'center' },
    { id: 'footer', label: 'Gracias por su compra', visible: true, size: 's', bold: false, align: 'center' }
  ]
  return [
    {
      name: 'A4 — 2 x 5 fichas',
      config: {
        kind: 'a4',
        page: 'A4',
        cols: 2,
        rows: 5,
        thermalWidth: 58,
        paddingMm: 3,
        bgMode: 'stretch',
        textColor: '#000000',
        fontFamily: 'Arial',
        fields: baseFields(),
        qrEnabled: true,
        qrPosition: 'bottom-right',
        qrSize: 30,
        qrOpacity: 0.85
      }
    },
    {
      name: 'Térmica 58mm',
      config: {
        kind: 'thermal',
        page: 'A4',
        cols: 1,
        rows: 1,
        thermalWidth: 58,
        paddingMm: 2,
        bgMode: 'stretch',
        textColor: '#000000',
        fontFamily: 'Arial',
        fields: baseFields(),
        qrEnabled: true,
        qrPosition: 'bottom-center',
        qrSize: 45,
        qrOpacity: 0.85
      }
    }
  ]
}
