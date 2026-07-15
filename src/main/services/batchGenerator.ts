import { randomInt } from 'crypto'
import type { RouterClient } from '../routeros/client'
import type { CodeOptions, GenerateBatchResult } from '../../shared/types'
import { getPlanMeta } from '../db/repos/planMeta'
import { createBatch, getBatch, getVouchers, insertVouchers, markVoucherCreated } from '../db/repos/batches'
import { addUser, findUsersByComment } from '../routeros/hotspot'
import type { ResumeBatchResult } from '../../shared/types'

const CHARSETS: Record<CodeOptions['charset'], string> = {
  num: '0123456789',
  lower: 'abcdefghjkmnpqrstuvwxyz', // sin i, l, o para evitar confusión
  upper: 'ABCDEFGHJKMNPQRSTUVWXYZ',
  alnum: 'abcdefghjkmnpqrstuvwxyz23456789' // sin 0, 1, i, l, o
}

function randomCode(length: number, charset: string): string {
  let out = ''
  for (let i = 0; i < length; i++) out += charset[randomInt(charset.length)]
  return out
}

export function makeBatchTag(): string {
  const d = new Date()
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `B-${date}-${randomCode(4, CHARSETS.upper)}`
}

export function generateCodes(options: CodeOptions): { username: string; password: string }[] {
  const charset = CHARSETS[options.charset]
  const passwordCharset = CHARSETS[options.passwordCharset ?? options.charset]
  const used = new Set<string>()
  const out: { username: string; password: string }[] = []
  while (out.length < options.qty) {
    const username = options.prefix + randomCode(options.length, charset)
    if (used.has(username)) continue
    used.add(username)
    const password =
      options.userMode === 'same'
        ? username
        : options.userMode === 'userOnly'
          ? ''
          : randomCode(options.passwordLength, passwordCharset)
    out.push({ username, password })
  }
  return out
}

export async function generateBatch(
  client: RouterClient,
  routerId: number,
  profileName: string,
  options: CodeOptions,
  onProgress: (done: number, total: number) => void
): Promise<GenerateBatchResult> {
  const meta = getPlanMeta(routerId, profileName)
  const tag = makeBatchTag()
  // El comentario al crear la ficha es solo el tag de lote. La fecha y hora de
  // inicio la añade el script on-login del plan en el PRIMER login de la ficha,
  // concatenándola al final del comentario sin pisar este tag.
  const comment = `lote:${tag}`
  const codes = generateCodes(options)

  const batchId = createBatch(routerId, profileName, options, comment)
  insertVouchers(batchId, codes)

  let created = 0
  let failed = 0
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    const props: Record<string, string> = {
      name: c.username,
      profile: profileName,
      comment
    }
    if (options.userMode !== 'userOnly') {
      props.password = c.password
    }
    if (meta && meta.planType === 'pausado' && meta.uptimeLimit) {
      props['limit-uptime'] = meta.uptimeLimit
    }
    try {
      await addUser(client, props)
      markVoucherCreated(batchId, c.username)
      created++
    } catch {
      failed++
    }
    if ((i + 1) % 10 === 0 || i + 1 === codes.length) onProgress(i + 1, codes.length)
  }
  return { ok: true, batchId, created, failed }
}

/**
 * Reintenta solamente las fichas que no están actualmente en el router.
 * La consulta en vivo es la fuente de verdad, incluso si el corte ocurrió
 * después de que RouterOS creó un usuario pero antes de guardar el avance local.
 */
export async function resumeBatch(
  client: RouterClient,
  batchId: number,
  onProgress: (done: number, total: number) => void
): Promise<ResumeBatchResult> {
  const batch = getBatch(batchId)
  if (!batch) throw new Error('Lote no encontrado')

  const vouchers = getVouchers(batchId)
  const existing = new Set(
    (await findUsersByComment(client, batch.commentTag)).map((user) => user.name ?? '').filter(Boolean)
  )
  const pending = vouchers.filter((voucher) => !existing.has(voucher.username))

  // Mantiene el registro local alineado con lo que realmente existe en el router.
  for (const voucher of vouchers) {
    if (existing.has(voucher.username)) markVoucherCreated(batchId, voucher.username)
  }

  const meta = getPlanMeta(batch.routerId, batch.profileName)
  let created = 0
  let failed = 0
  for (let i = 0; i < pending.length; i++) {
    const voucher = pending[i]
    const props: Record<string, string> = {
      name: voucher.username,
      profile: batch.profileName,
      comment: batch.commentTag
    }
    if (batch.codeOptions.userMode !== 'userOnly') props.password = voucher.password
    if (meta?.planType === 'pausado' && meta.uptimeLimit) props['limit-uptime'] = meta.uptimeLimit

    try {
      await addUser(client, props)
      markVoucherCreated(batchId, voucher.username)
      created++
    } catch {
      failed++
    }
    if ((i + 1) % 10 === 0 || i + 1 === pending.length) onProgress(i + 1, pending.length)
  }

  return { ok: true, alreadyPresent: existing.size, created, failed, total: pending.length }
}
