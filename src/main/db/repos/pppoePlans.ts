import { getDb } from '../database'
import type { PppoePlan } from '../../../shared/types'
import { normalizeMbps } from '../../../shared/mbps'

interface PlanRow {
  router_id: number
  name: string
  upload_mbps: string
  download_mbps: string
  price: string
  notes: string
}

function toPlan(row: PlanRow): PppoePlan {
  return {
    name: row.name,
    uploadMbps: normalizeMbps(row.upload_mbps),
    downloadMbps: normalizeMbps(row.download_mbps),
    price: row.price,
    notes: row.notes
  }
}

export function listPppoePlans(routerId: number): PppoePlan[] {
  const rows = getDb()
    .prepare('SELECT * FROM pppoe_plans WHERE router_id = ? ORDER BY name COLLATE NOCASE')
    .all(routerId) as PlanRow[]
  return rows.map(toPlan)
}

export function getPppoePlan(routerId: number, name: string): PppoePlan | null {
  const row = getDb()
    .prepare('SELECT * FROM pppoe_plans WHERE router_id = ? AND name = ?')
    .get(routerId, name) as PlanRow | undefined
  return row ? toPlan(row) : null
}

export function upsertPppoePlan(routerId: number, plan: PppoePlan): void {
  getDb()
    .prepare(
      `INSERT INTO pppoe_plans (router_id, name, upload_mbps, download_mbps, price, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(router_id, name) DO UPDATE SET
         upload_mbps = excluded.upload_mbps,
         download_mbps = excluded.download_mbps,
         price = excluded.price,
         notes = excluded.notes`
    )
    .run(
      routerId,
      plan.name,
      normalizeMbps(plan.uploadMbps),
      normalizeMbps(plan.downloadMbps),
      plan.price,
      plan.notes
    )
}

export function renamePppoePlan(routerId: number, oldName: string, newName: string): void {
  getDb()
    .prepare('UPDATE pppoe_plans SET name = ? WHERE router_id = ? AND name = ?')
    .run(newName, routerId, oldName)
}

export function deletePppoePlan(routerId: number, name: string): void {
  getDb().prepare('DELETE FROM pppoe_plans WHERE router_id = ? AND name = ?').run(routerId, name)
}
