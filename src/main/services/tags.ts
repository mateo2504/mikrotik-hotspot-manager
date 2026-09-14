import { randomInt } from 'crypto'

// Mismo alfabeto que los tags de lote: sin I, L, O para evitar confusión.
const TAG_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ'

function randomCode(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += TAG_CHARSET[randomInt(TAG_CHARSET.length)]
  return out
}

/** Tag fechado, p. ej. `B-20260914-XKQM` o `T-20260914-XKQM`. */
export function makeDatedTag(prefix: string, now = new Date()): string {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `${prefix}-${date}-${randomCode(4)}`
}

/** Tag de lote. El comment en RouterOS queda `lote:${tag}`. */
export function makeBatchTag(now = new Date()): string {
  return makeDatedTag('B', now)
}

/** Tag de versión de plantilla, paralelo a `lote:B-…`. */
export function makeTemplateTag(now = new Date()): string {
  return `plantilla:${makeDatedTag('T', now)}`
}

export const TEMPLATE_TAG_RE = /^plantilla:T-\d{8}-[A-HJ-NP-Z]{4}$/
