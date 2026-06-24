import { getDb } from '../database'
import { encryptPassword, decryptPassword } from '../../services/credentials'
import type { RouterRecord, RouterInput } from '../../../shared/types'

interface RouterRow {
  id: number
  name: string
  host: string
  port: number | null
  hotspot_host: string | null
  username: string
  password_enc: Buffer
  use_ssl: number
  api_type: 'auto' | 'rest' | 'binary'
  detected_api: 'rest' | 'binary' | null
  created_at: string
}

function toRecord(row: RouterRow): RouterRecord {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    hotspotHost: row.hotspot_host,
    username: row.username,
    useSsl: !!row.use_ssl,
    apiType: row.api_type,
    detectedApi: row.detected_api,
    createdAt: row.created_at
  }
}

export function listRouters(): RouterRecord[] {
  const rows = getDb().prepare('SELECT * FROM routers ORDER BY name').all() as RouterRow[]
  return rows.map(toRecord)
}

export function getRouter(id: number): RouterRecord | null {
  const row = getDb().prepare('SELECT * FROM routers WHERE id = ?').get(id) as RouterRow | undefined
  return row ? toRecord(row) : null
}

export function getRouterPassword(id: number): string {
  const row = getDb().prepare('SELECT password_enc FROM routers WHERE id = ?').get(id) as
    | { password_enc: Buffer }
    | undefined
  if (!row) throw new Error('Router no encontrado')
  return decryptPassword(row.password_enc)
}

export function createRouter(input: RouterInput): RouterRecord {
  const enc = encryptPassword(input.password ?? '')
  const res = getDb()
    .prepare(
      `INSERT INTO routers (name, host, port, hotspot_host, username, password_enc, use_ssl, api_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.name, input.host, input.port, input.hotspotHost, input.username, enc, input.useSsl ? 1 : 0, input.apiType)
  return getRouter(Number(res.lastInsertRowid))!
}

export function updateRouter(id: number, input: RouterInput): RouterRecord {
  const db = getDb()
  db.prepare(
    `UPDATE routers SET name = ?, host = ?, port = ?, hotspot_host = ?, username = ?, use_ssl = ?, api_type = ?,
     detected_api = NULL WHERE id = ?`
  ).run(input.name, input.host, input.port, input.hotspotHost, input.username, input.useSsl ? 1 : 0, input.apiType, id)
  if (input.password !== null && input.password !== '') {
    db.prepare('UPDATE routers SET password_enc = ? WHERE id = ?').run(
      encryptPassword(input.password),
      id
    )
  }
  return getRouter(id)!
}

export function setDetectedApi(id: number, api: 'rest' | 'binary'): void {
  getDb().prepare('UPDATE routers SET detected_api = ? WHERE id = ?').run(api, id)
}

export function deleteRouter(id: number): void {
  getDb().prepare('DELETE FROM routers WHERE id = ?').run(id)
}
