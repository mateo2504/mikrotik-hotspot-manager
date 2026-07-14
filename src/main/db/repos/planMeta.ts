import { getDb } from '../database'
import type { PlanMeta } from '../../../shared/types'

interface MetaRow {
  router_id: number
  profile_name: string
  price: string
  plan_type: 'pausado' | 'corrido'
  validity: string
  uptime_limit: string
  mac_aleatoria: number
  notes: string
}

function toMeta(row: MetaRow): PlanMeta {
  return {
    profileName: row.profile_name,
    price: row.price,
    planType: row.plan_type,
    validity: row.validity,
    uptimeLimit: row.uptime_limit,
    macAleatoria: row.mac_aleatoria === 1,
    notes: row.notes
  }
}

export function getPlanMeta(routerId: number, profileName: string): PlanMeta | null {
  const row = getDb()
    .prepare('SELECT * FROM plan_meta WHERE router_id = ? AND profile_name = ?')
    .get(routerId, profileName) as MetaRow | undefined
  return row ? toMeta(row) : null
}

export function listPlanMeta(routerId: number): Map<string, PlanMeta> {
  const rows = getDb().prepare('SELECT * FROM plan_meta WHERE router_id = ?').all(routerId) as MetaRow[]
  return new Map(rows.map((r) => [r.profile_name, toMeta(r)]))
}

export function upsertPlanMeta(routerId: number, meta: PlanMeta): void {
  getDb()
    .prepare(
      `INSERT INTO plan_meta (router_id, profile_name, price, plan_type, validity, uptime_limit, mac_aleatoria, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(router_id, profile_name) DO UPDATE SET
         price = excluded.price, plan_type = excluded.plan_type,
         validity = excluded.validity, uptime_limit = excluded.uptime_limit,
         mac_aleatoria = excluded.mac_aleatoria,
         notes = excluded.notes`
    )
    .run(
      routerId,
      meta.profileName,
      meta.price,
      meta.planType,
      meta.validity,
      meta.uptimeLimit,
      meta.macAleatoria ? 1 : 0,
      meta.notes
    )
}

export function renamePlanMeta(routerId: number, oldName: string, newName: string): void {
  getDb()
    .prepare('UPDATE plan_meta SET profile_name = ? WHERE router_id = ? AND profile_name = ?')
    .run(newName, routerId, oldName)
}

export function deletePlanMeta(routerId: number, profileName: string): void {
  getDb().prepare('DELETE FROM plan_meta WHERE router_id = ? AND profile_name = ?').run(routerId, profileName)
}
