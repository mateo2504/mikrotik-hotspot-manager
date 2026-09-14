import { randomUUID } from 'crypto'
import { getDb } from '../database'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { Template, TemplateConfig, TemplateInput } from '../../../shared/types'
import { makeTemplateTag } from '../../services/tags'

interface TemplateRow {
  id: number
  router_id: number
  name: string
  kind: 'a4' | 'thermal'
  config_json: string
  bg_image_path: string | null
  created_at: string
  shared_key: string
  version: number
  tag: string
  published: number
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

export function imageToDataUrl(path: string | null): string | null {
  if (!path || !existsSync(path)) return null
  try {
    const mime = MIME[extname(path).toLowerCase()] ?? 'image/png'
    const b64 = readFileSync(path).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}

function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    config: JSON.parse(row.config_json) as TemplateConfig,
    bgImagePath: row.bg_image_path,
    bgDataUrl: imageToDataUrl(row.bg_image_path),
    createdAt: row.created_at,
    sharedKey: row.shared_key,
    version: row.version,
    tag: row.tag,
    published: !!row.published
  }
}

function listRouterIds(): number[] {
  return (getDb().prepare('SELECT id FROM routers').all() as { id: number }[]).map((r) => r.id)
}

function rowById(id: number, routerId: number): TemplateRow | undefined {
  return getDb()
    .prepare('SELECT * FROM templates WHERE id = ? AND router_id = ?')
    .get(id, routerId) as TemplateRow | undefined
}

function rowBySharedKey(routerId: number, sharedKey: string): TemplateRow | undefined {
  return getDb()
    .prepare('SELECT * FROM templates WHERE router_id = ? AND shared_key = ?')
    .get(routerId, sharedKey) as TemplateRow | undefined
}

function rowByName(routerId: number, name: string): TemplateRow | undefined {
  return getDb()
    .prepare('SELECT * FROM templates WHERE router_id = ? AND name = ? ORDER BY id LIMIT 1')
    .get(routerId, name) as TemplateRow | undefined
}

function insertRow(
  routerId: number,
  input: TemplateInput,
  meta: { sharedKey: string; version: number; tag: string; published: boolean }
): number {
  const res = getDb()
    .prepare(
      `INSERT INTO templates
        (router_id, name, kind, config_json, bg_image_path, shared_key, version, tag, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      routerId,
      input.name,
      input.kind,
      JSON.stringify(input.config),
      input.bgImagePath,
      meta.sharedKey,
      meta.version,
      meta.tag,
      meta.published ? 1 : 0
    )
  return Number(res.lastInsertRowid)
}

function updateRow(
  id: number,
  input: TemplateInput,
  meta: { sharedKey: string; version: number; tag: string; published: boolean }
): void {
  getDb()
    .prepare(
      `UPDATE templates
       SET name = ?, kind = ?, config_json = ?, bg_image_path = ?,
           shared_key = ?, version = ?, tag = ?, published = ?
       WHERE id = ?`
    )
    .run(
      input.name,
      input.kind,
      JSON.stringify(input.config),
      input.bgImagePath,
      meta.sharedKey,
      meta.version,
      meta.tag,
      meta.published ? 1 : 0,
      id
    )
}

/** Replica la versión publicada en cada equipo (por shared_key o por nombre). */
function upsertPublishedOnRouter(
  routerId: number,
  input: TemplateInput,
  meta: { sharedKey: string; version: number; tag: string },
  previousName?: string
): void {
  const existing =
    rowBySharedKey(routerId, meta.sharedKey) ??
    rowByName(routerId, previousName ?? input.name) ??
    (previousName && previousName !== input.name ? rowByName(routerId, input.name) : undefined)
  if (existing) {
    updateRow(existing.id, input, { ...meta, published: true })
  } else {
    insertRow(routerId, input, { ...meta, published: true })
  }
}

function publishToAllRouters(
  input: TemplateInput,
  meta: { sharedKey: string; version: number; tag: string },
  previousName?: string
): void {
  const ids = listRouterIds()
  const db = getDb()
  db.transaction(() => {
    for (const routerId of ids) {
      upsertPublishedOnRouter(routerId, input, meta, previousName)
    }
  })()
}

export function listTemplates(routerId: number): Template[] {
  const rows = getDb()
    .prepare('SELECT * FROM templates WHERE router_id = ? ORDER BY name')
    .all(routerId) as TemplateRow[]
  return rows.map(toTemplate)
}

export function getTemplate(id: number, routerId: number): Template | null {
  const row = rowById(id, routerId)
  return row ? toTemplate(row) : null
}

/** Plantilla local de fábrica: no se publica a los demás equipos hasta crear/editar. */
export function createLocalTemplate(routerId: number, input: TemplateInput): Template {
  const id = insertRow(routerId, input, {
    sharedKey: randomUUID(),
    version: 1,
    tag: makeTemplateTag(),
    published: false
  })
  return getTemplate(id, routerId)!
}

/** Crea una versión 1 publicada y la deja disponible en todos los equipos. */
export function createTemplate(routerId: number, input: TemplateInput): Template {
  const meta = {
    sharedKey: randomUUID(),
    version: 1,
    tag: makeTemplateTag()
  }
  const ids = listRouterIds()
  if (!ids.includes(routerId)) ids.push(routerId)
  const db = getDb()
  db.transaction(() => {
    for (const id of ids) {
      upsertPublishedOnRouter(id, input, meta)
    }
  })()
  const row = rowBySharedKey(routerId, meta.sharedKey) ?? rowByName(routerId, input.name)
  if (!row) throw new Error('No se pudo publicar la plantilla')
  return toTemplate(row)
}

/** Crea una nueva versión (tag nuevo) y la publica a todos los equipos. */
export function updateTemplate(routerId: number, id: number, input: TemplateInput): Template {
  const current = rowById(id, routerId)
  if (!current) throw new Error('Plantilla no encontrada para este router')
  const meta = {
    sharedKey: current.shared_key || randomUUID(),
    version: current.version + 1,
    tag: makeTemplateTag()
  }
  publishToAllRouters(input, meta, current.name)
  return getTemplate(id, routerId) ?? toTemplate(rowBySharedKey(routerId, meta.sharedKey)!)
}

export function deleteTemplate(routerId: number, id: number): void {
  getDb().prepare('DELETE FROM templates WHERE id = ? AND router_id = ?').run(id, routerId)
}

export function countTemplates(routerId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM templates WHERE router_id = ?')
    .get(routerId) as {
    c: number
  }
  return row.c
}

/**
 * En connect: copia al equipo las últimas versiones publicadas
 * (las que se crearon o editaron en cualquier otro equipo).
 */
export function syncPublishedTemplates(routerId: number): void {
  const published = getDb()
    .prepare('SELECT * FROM templates WHERE published = 1 ORDER BY version DESC, id DESC')
    .all() as TemplateRow[]
  const latestByKey = new Map<string, TemplateRow>()
  for (const row of published) {
    if (!latestByKey.has(row.shared_key)) latestByKey.set(row.shared_key, row)
  }

  const db = getDb()
  db.transaction(() => {
    for (const row of latestByKey.values()) {
      const input: TemplateInput = {
        name: row.name,
        kind: row.kind,
        config: JSON.parse(row.config_json) as TemplateConfig,
        bgImagePath: row.bg_image_path
      }
      const local = rowBySharedKey(routerId, row.shared_key) ?? rowByName(routerId, row.name)
      if (!local) {
        insertRow(routerId, input, {
          sharedKey: row.shared_key,
          version: row.version,
          tag: row.tag,
          published: true
        })
        continue
      }
      if (local.version < row.version) {
        updateRow(local.id, input, {
          sharedKey: row.shared_key,
          version: row.version,
          tag: row.tag,
          published: true
        })
      }
    }
  })()
}
