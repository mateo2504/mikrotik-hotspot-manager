/** Tasas PPPoE/simplequeue: el usuario habla en megas; RouterOS v7 REST a veces devuelve bits. */

const BITS_PER_MEG = 1_000_000
/** Sin unidad, RouterOS v7 REST suele devolver bits (3 Mbps = 3000000). */
const BARE_BITS_THRESHOLD = 100_000
/** Con sufijo M absurdo (3000000M) = bits a los que se les volvió a pegar la M. */
const SUFFIXED_BITS_THRESHOLD = 1_000_000

export function normalizeMbps(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null) return ''
  const trimmed = String(raw).trim()
  if (!trimmed) return ''
  const m = trimmed.match(/^(\d+(?:\.\d+)?)([KkMmGg])?$/)
  if (!m) {
    const fallback = trimmed.replace(/[Mm]$/, '')
    return fallback === trimmed ? trimmed : normalizeMbps(fallback)
  }
  const n = Number(m[1])
  if (!Number.isFinite(n) || n < 0) return ''
  const unit = (m[2] ?? '').toUpperCase()
  let megs = n
  if (unit === 'K') megs = n / 1000
  else if (unit === 'G') megs = n * 1000
  else if (unit === 'M') {
    if (n >= SUFFIXED_BITS_THRESHOLD) megs = n / BITS_PER_MEG
  } else if (n >= BARE_BITS_THRESHOLD) {
    megs = n / BITS_PER_MEG
  }
  return formatMegsNumber(megs)
}

function formatMegsNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return ''
  const rounded = Math.round(n * 1000) / 1000
  if (rounded === 0) return '0'
  return String(rounded)
}

/** Token RouterOS v7 para un lado del max-limit: `3M`, nunca `3000000M`. */
export function formatMbpsToken(raw: string | number | undefined | null): string {
  const megs = normalizeMbps(raw)
  return megs ? `${megs}M` : '0M'
}

/** `max-limit` de simple queue: `3M/8M`. */
export function formatSimpleQueueMaxLimit(
  upload: string | number | undefined | null,
  download: string | number | undefined | null
): string {
  return `${formatMbpsToken(upload)}/${formatMbpsToken(download)}`
}

export function parseMaxLimit(raw: string | undefined | null): {
  uploadMbps: string
  downloadMbps: string
} {
  const [up = '', down = ''] = String(raw ?? '').split('/')
  return { uploadMbps: normalizeMbps(up), downloadMbps: normalizeMbps(down) }
}

/** Texto de tabla: `3M`, sin duplicar la M. */
export function displayMbps(raw: string | number | undefined | null): string {
  const megs = normalizeMbps(raw)
  return megs ? `${megs}M` : '—'
}
