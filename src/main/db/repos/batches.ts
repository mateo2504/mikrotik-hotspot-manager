import { getDb } from '../database'
import type { Batch, CodeOptions, Voucher } from '../../../shared/types'

interface BatchRow {
  id: number
  router_id: number
  profile_name: string
  qty: number
  prefix: string
  code_options_json: string
  created_at: string
  comment_tag: string
  voucher_count: number
}

function toBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    routerId: row.router_id,
    profileName: row.profile_name,
    qty: row.qty,
    prefix: row.prefix,
    codeOptions: JSON.parse(row.code_options_json) as CodeOptions,
    createdAt: row.created_at,
    commentTag: row.comment_tag,
    voucherCount: row.voucher_count
  }
}

export function listBatches(routerId: number): Batch[] {
  const rows = getDb()
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = b.id) AS voucher_count
       FROM batches b WHERE b.router_id = ? ORDER BY b.id DESC`
    )
    .all(routerId) as BatchRow[]
  return rows.map(toBatch)
}

export function getBatch(id: number): Batch | null {
  const row = getDb()
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = b.id) AS voucher_count
       FROM batches b WHERE b.id = ?`
    )
    .get(id) as BatchRow | undefined
  return row ? toBatch(row) : null
}

export function createBatch(
  routerId: number,
  profileName: string,
  options: CodeOptions,
  commentTag: string
): number {
  const res = getDb()
    .prepare(
      `INSERT INTO batches (router_id, profile_name, qty, prefix, code_options_json, comment_tag)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(routerId, profileName, options.qty, options.prefix, JSON.stringify(options), commentTag)
  return Number(res.lastInsertRowid)
}

export function insertVouchers(
  batchId: number,
  vouchers: { username: string; password: string }[]
): void {
  const db = getDb()
  const stmt = db.prepare(
    'INSERT INTO vouchers (batch_id, username, password, created_on_router) VALUES (?, ?, ?, 0)'
  )
  db.transaction(() => {
    for (const v of vouchers) stmt.run(batchId, v.username, v.password)
  })()
}

export function markVoucherCreated(batchId: number, username: string): void {
  getDb()
    .prepare('UPDATE vouchers SET created_on_router = 1 WHERE batch_id = ? AND username = ?')
    .run(batchId, username)
}

export function getVouchers(batchId: number): Voucher[] {
  const rows = getDb()
    .prepare('SELECT * FROM vouchers WHERE batch_id = ? ORDER BY id')
    .all(batchId) as {
    id: number
    batch_id: number
    username: string
    password: string
    created_on_router: number
  }[]
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    username: r.username,
    password: r.password,
    createdOnRouter: !!r.created_on_router
  }))
}

export function deleteBatch(id: number): void {
  getDb().prepare('DELETE FROM batches WHERE id = ?').run(id)
}
