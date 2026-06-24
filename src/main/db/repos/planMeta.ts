import { getDb } from '../database'
import type { PlanMeta } from '../../../shared/types'

interface MetaRow {
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

export function getPlanMeta(profileName: string): PlanMeta | null {
  const row = getDb().prepare('SELECT * FROM plan_meta WHERE profile_name = ?').get(profileName) as
    | MetaRow
    | undefined
  return row ? toMeta(row) : null
}

export function listPlanMeta(): Map<string, PlanMeta> {
  const rows = getDb().prepare('SELECT * FROM plan_meta').all() as MetaRow[]
  return new Map(rows.map((r) => [r.profile_name, toMeta(r)]))
}

export function upsertPlanMeta(meta: PlanMeta): void {
  getDb()
    .prepare(
      `INSERT INTO plan_meta (profile_name, price, plan_type, validity, uptime_limit, mac_aleatoria, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_name) DO UPDATE SET
         price = excluded.price, plan_type = excluded.plan_type,
         validity = excluded.validity, uptime_limit = excluded.uptime_limit,
         mac_aleatoria = excluded.mac_aleatoria,
         notes = excluded.notes`
    )
    .run(
      meta.profileName,
      meta.price,
      meta.planType,
      meta.validity,
      meta.uptimeLimit,
      meta.macAleatoria ? 1 : 0,
      meta.notes
    )
}

export function renamePlanMeta(oldName: string, newName: string): void {
  getDb().prepare('UPDATE plan_meta SET profile_name = ? WHERE profile_name = ?').run(newName, oldName)
}

export function deletePlanMeta(profileName: string): void {
  getDb().prepare('DELETE FROM plan_meta WHERE profile_name = ?').run(profileName)
}
