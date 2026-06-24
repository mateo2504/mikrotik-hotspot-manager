import { getDb } from '../database'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { Template, TemplateConfig, TemplateInput } from '../../../shared/types'

interface TemplateRow {
  id: number
  name: string
  kind: 'a4' | 'thermal'
  config_json: string
  bg_image_path: string | null
  created_at: string
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
    createdAt: row.created_at
  }
}

export function listTemplates(): Template[] {
  const rows = getDb().prepare('SELECT * FROM templates ORDER BY name').all() as TemplateRow[]
  return rows.map(toTemplate)
}

export function getTemplate(id: number): Template | null {
  const row = getDb().prepare('SELECT * FROM templates WHERE id = ?').get(id) as
    | TemplateRow
    | undefined
  return row ? toTemplate(row) : null
}

export function createTemplate(input: TemplateInput): Template {
  const res = getDb()
    .prepare('INSERT INTO templates (name, kind, config_json, bg_image_path) VALUES (?, ?, ?, ?)')
    .run(input.name, input.kind, JSON.stringify(input.config), input.bgImagePath)
  return getTemplate(Number(res.lastInsertRowid))!
}

export function updateTemplate(id: number, input: TemplateInput): Template {
  getDb()
    .prepare('UPDATE templates SET name = ?, kind = ?, config_json = ?, bg_image_path = ? WHERE id = ?')
    .run(input.name, input.kind, JSON.stringify(input.config), input.bgImagePath, id)
  return getTemplate(id)!
}

export function deleteTemplate(id: number): void {
  getDb().prepare('DELETE FROM templates WHERE id = ?').run(id)
}

export function countTemplates(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM templates').get() as { c: number }
  return row.c
}
