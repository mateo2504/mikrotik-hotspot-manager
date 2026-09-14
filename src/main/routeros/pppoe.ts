import type { RouterClient, RosObject } from './client'
import type {
  PppoeActiveSession,
  PppoeClient,
  PppoeClientInput,
  PppoePlan,
  PppoeSecretDefaults
} from '../../shared/types'
import { PPPOE_DEFAULT_PROFILE } from '../../shared/types'
import { getPppoePlan } from '../db/repos/pppoePlans'

export const PPP_SECRET_PATH = 'ppp/secret'
export const PPP_ACTIVE_PATH = 'ppp/active'
export const PPP_PROFILE_PATH = 'ppp/profile'
export const QUEUE_SIMPLE_PATH = 'queue/simple'

export { PPPOE_DEFAULT_PROFILE }

const PLAN_COMMENT_RE = /^plan:([^|]+?)(?:\s*\|\s*(.*))?$/s

export function encodePppoeComment(planName: string, comment: string): string {
  const tag = `plan:${planName}`
  const extra = comment.trim()
  return extra ? `${tag} | ${extra}` : tag
}

export function parsePppoeComment(raw: string): { planName: string; comment: string } {
  const m = raw.match(PLAN_COMMENT_RE)
  if (!m) return { planName: '', comment: raw }
  return { planName: m[1].trim(), comment: (m[2] ?? '').trim() }
}

export function simpleQueueName(username: string): string {
  return `pppoe-${username}`
}

/** Interfaz dinámica que RouterOS crea al conectar el secret. */
export function pppoeInterfaceTarget(username: string): string {
  return `<pppoe-${username}>`
}

function toMbpsToken(mbps: string): string {
  const trimmed = mbps.trim()
  if (!trimmed) return '0M'
  if (/^\d+(\.\d+)?[KkMmGg]$/.test(trimmed)) return trimmed
  const n = trimmed.replace(/[Mm]$/, '')
  return `${n}M`
}

/** max-limit de simple queue: subida/bajada (megas del secret/plan). */
export function simpleQueueMaxLimit(uploadMbps: string, downloadMbps: string): string {
  return `${toMbpsToken(uploadMbps)}/${toMbpsToken(downloadMbps)}`
}

export function parseQueueMaxLimit(raw: string): { uploadMbps: string; downloadMbps: string } {
  const [up = '', down = ''] = raw.split('/')
  const strip = (v: string): string => v.trim().replace(/[Mm]$/, '')
  return { uploadMbps: strip(up), downloadMbps: strip(down) }
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value.trim())
}

export function rosBool(value: string | undefined): boolean {
  const v = (value ?? '').toLowerCase()
  return v === 'true' || v === 'yes' || v === 'on'
}

export function isPppoeService(service: string): boolean {
  const s = (service || 'any').toLowerCase()
  return s === 'pppoe' || s === 'any'
}

/**
 * Lee local-address y remote-address del perfil PPP `default`.
 * Si el perfil no los tiene, se omiten en el secret (RouterOS usa pool/address del perfil).
 * No se inventa una IP remota fija: rompería varios clientes.
 */
export async function readPppoeSecretDefaults(client: RouterClient): Promise<PppoeSecretDefaults> {
  const rows = await client.print(PPP_PROFILE_PATH, { name: PPPOE_DEFAULT_PROFILE })
  const profile = rows[0]
  return {
    profile: PPPOE_DEFAULT_PROFILE,
    localAddress: profile?.['local-address'] ?? '',
    remoteAddress: profile?.['remote-address'] ?? ''
  }
}

export function pppoeSecretProps(
  input: PppoeClientInput,
  defaults: PppoeSecretDefaults
): Record<string, string> {
  const props: Record<string, string> = {
    name: input.name.trim(),
    password: input.password,
    service: 'pppoe',
    profile: defaults.profile || PPPOE_DEFAULT_PROFILE,
    comment: encodePppoeComment(input.planName, input.comment)
  }
  if (defaults.localAddress) props['local-address'] = defaults.localAddress
  if (defaults.remoteAddress) props['remote-address'] = defaults.remoteAddress
  return props
}

export function simpleQueueProps(
  username: string,
  uploadMbps: string,
  downloadMbps: string,
  remoteAddress: string
): Record<string, string> {
  const target = isIpv4(remoteAddress)
    ? `${remoteAddress.trim()}/32`
    : pppoeInterfaceTarget(username)
  return {
    name: simpleQueueName(username),
    target,
    'max-limit': simpleQueueMaxLimit(uploadMbps, downloadMbps),
    comment: `pppoe:${username}`
  }
}

function mapSecret(
  row: RosObject,
  queues: Map<string, RosObject>,
  plans: Map<string, PppoePlan>
): PppoeClient {
  const name = row.name ?? ''
  const parsed = parsePppoeComment(row.comment ?? '')
  const queue = queues.get(simpleQueueName(name))
  const fromQueue = queue ? parseQueueMaxLimit(queue['max-limit'] ?? '') : null
  const plan = parsed.planName ? (plans.get(parsed.planName) ?? null) : null
  return {
    rosId: row['.id'] ?? '',
    name,
    password: row.password ?? '',
    profile: row.profile || PPPOE_DEFAULT_PROFILE,
    localAddress: row['local-address'] ?? '',
    remoteAddress: row['remote-address'] ?? '',
    comment: parsed.comment,
    planName: parsed.planName,
    uploadMbps: fromQueue?.uploadMbps || plan?.uploadMbps || '',
    downloadMbps: fromQueue?.downloadMbps || plan?.downloadMbps || '',
    disabled: rosBool(row.disabled),
    service: row.service ?? 'pppoe'
  }
}

function mapActive(row: RosObject): PppoeActiveSession {
  return {
    rosId: row['.id'] ?? '',
    name: row.name ?? '',
    address: row.address ?? '',
    callerId: row['caller-id'] ?? '',
    uptime: row.uptime ?? '',
    encoding: row.encoding ?? '',
    service: row.service ?? ''
  }
}

async function indexQueues(client: RouterClient): Promise<Map<string, RosObject>> {
  const rows = await client.print(QUEUE_SIMPLE_PATH)
  const map = new Map<string, RosObject>()
  for (const row of rows) {
    const n = row.name ?? ''
    if (n) map.set(n, row)
  }
  return map
}

export async function listPppoeClients(
  client: RouterClient,
  plans: PppoePlan[]
): Promise<PppoeClient[]> {
  const [secrets, queues] = await Promise.all([client.print(PPP_SECRET_PATH), indexQueues(client)])
  const planMap = new Map(plans.map((p) => [p.name, p]))
  return secrets
    .filter((r) => isPppoeService(r.service ?? ''))
    .map((r) => mapSecret(r, queues, planMap))
}

export async function listPppoeActive(client: RouterClient): Promise<PppoeActiveSession[]> {
  const rows = await client.print(PPP_ACTIVE_PATH)
  return rows.map(mapActive)
}

export async function disconnectPppoeActive(client: RouterClient, rosId: string): Promise<void> {
  await client.remove(PPP_ACTIVE_PATH, [rosId])
}

async function disconnectByUsername(client: RouterClient, username: string): Promise<void> {
  const actives = await client.print(PPP_ACTIVE_PATH)
  const ids = actives
    .filter((r) => (r.name ?? '') === username)
    .map((r) => r['.id'] ?? '')
    .filter(Boolean)
  if (ids.length > 0) await client.remove(PPP_ACTIVE_PATH, ids)
}

async function findByName(
  client: RouterClient,
  path: string,
  name: string
): Promise<RosObject | null> {
  const rows = await client.print(path, { name })
  return rows[0] ?? null
}

async function upsertSimpleQueue(
  client: RouterClient,
  username: string,
  uploadMbps: string,
  downloadMbps: string,
  remoteAddress: string,
  previousUsername?: string
): Promise<void> {
  const props = simpleQueueProps(username, uploadMbps, downloadMbps, remoteAddress)
  const currentName =
    previousUsername && previousUsername !== username
      ? simpleQueueName(previousUsername)
      : props.name
  const existing = await findByName(client, QUEUE_SIMPLE_PATH, currentName)
  if (existing?.['.id']) {
    await client.set(QUEUE_SIMPLE_PATH, existing['.id'], props)
    return
  }
  const already =
    currentName === props.name ? existing : await findByName(client, QUEUE_SIMPLE_PATH, props.name)
  if (already?.['.id']) {
    await client.set(QUEUE_SIMPLE_PATH, already['.id'], props)
    return
  }
  await client.add(QUEUE_SIMPLE_PATH, props)
}

async function removeSimpleQueue(client: RouterClient, username: string): Promise<void> {
  const existing = await findByName(client, QUEUE_SIMPLE_PATH, simpleQueueName(username))
  if (existing?.['.id']) await client.remove(QUEUE_SIMPLE_PATH, [existing['.id']])
}

export async function createPppoeClient(
  client: RouterClient,
  routerId: number,
  input: PppoeClientInput
): Promise<void> {
  const plan = getPppoePlan(routerId, input.planName)
  if (!plan) throw new Error(`Plan PPPoE "${input.planName}" no encontrado`)
  const defaults = await readPppoeSecretDefaults(client)
  const props = pppoeSecretProps(input, defaults)
  await client.add(PPP_SECRET_PATH, props)
  try {
    await upsertSimpleQueue(
      client,
      props.name,
      plan.uploadMbps,
      plan.downloadMbps,
      props['remote-address'] ?? defaults.remoteAddress
    )
  } catch (err) {
    const created = await findByName(client, PPP_SECRET_PATH, props.name)
    if (created?.['.id']) await client.remove(PPP_SECRET_PATH, [created['.id']])
    throw err
  }
}

export async function updatePppoeClient(
  client: RouterClient,
  routerId: number,
  rosId: string,
  previousName: string,
  input: PppoeClientInput
): Promise<void> {
  const plan = getPppoePlan(routerId, input.planName)
  if (!plan) throw new Error(`Plan PPPoE "${input.planName}" no encontrado`)
  const defaults = await readPppoeSecretDefaults(client)
  const props = pppoeSecretProps(input, defaults)
  await client.set(PPP_SECRET_PATH, rosId, props)
  await upsertSimpleQueue(
    client,
    props.name,
    plan.uploadMbps,
    plan.downloadMbps,
    props['remote-address'] ?? defaults.remoteAddress,
    previousName
  )
}

export async function removePppoeClient(
  client: RouterClient,
  rosId: string,
  username: string
): Promise<void> {
  await disconnectByUsername(client, username)
  await client.remove(PPP_SECRET_PATH, [rosId])
  await removeSimpleQueue(client, username)
}

export async function suspendPppoeClient(
  client: RouterClient,
  rosId: string,
  username: string
): Promise<void> {
  await client.set(PPP_SECRET_PATH, rosId, { disabled: 'yes' })
  await disconnectByUsername(client, username)
}

export async function resumePppoeClient(client: RouterClient, rosId: string): Promise<void> {
  await client.set(PPP_SECRET_PATH, rosId, { disabled: 'no' })
}

export async function syncQueuesForPlan(
  client: RouterClient,
  oldPlanName: string,
  plan: PppoePlan
): Promise<void> {
  const secrets = await client.print(PPP_SECRET_PATH)
  for (const row of secrets) {
    if (!isPppoeService(row.service ?? '')) continue
    const parsed = parsePppoeComment(row.comment ?? '')
    if (parsed.planName !== oldPlanName) continue
    const username = row.name ?? ''
    if (!username) continue
    if (oldPlanName !== plan.name) {
      await client.set(PPP_SECRET_PATH, row['.id'] ?? '', {
        comment: encodePppoeComment(plan.name, parsed.comment)
      })
    }
    await upsertSimpleQueue(
      client,
      username,
      plan.uploadMbps,
      plan.downloadMbps,
      row['remote-address'] ?? ''
    )
  }
}
