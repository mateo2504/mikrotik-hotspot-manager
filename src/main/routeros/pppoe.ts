import type { RouterClient, RosObject } from './client'
import type {
  PppoeActiveSession,
  PppoeClient,
  PppoeClientInput,
  PppoePlan,
  PppoeSecretDefaults
} from '../../shared/types'
import { PPPOE_DEFAULT_PROFILE } from '../../shared/types'
import { formatSimpleQueueMaxLimit, parseMaxLimit } from '../../shared/mbps'
import { getPppoePlan } from '../db/repos/pppoePlans'

export const PPP_SECRET_PATH = 'ppp/secret'
export const PPP_ACTIVE_PATH = 'ppp/active'
export const PPP_PROFILE_PATH = 'ppp/profile'
export const QUEUE_SIMPLE_PATH = 'queue/simple'
export const IP_POOL_PATH = 'ip/pool'
export const IP_ADDRESS_PATH = 'ip/address'

export { PPPOE_DEFAULT_PROFILE }

export const PPPOE_POOL_NAME = 'pppoe-pool'
export const PPPOE_FALLBACK_LOCAL = '10.10.10.1'
export const PPPOE_FALLBACK_RANGE = '10.10.10.2-10.10.10.254'

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

/** max-limit de simple queue: subida/bajada en megas (`3M/8M`), nunca bits con M. */
export function simpleQueueMaxLimit(uploadMbps: string, downloadMbps: string): string {
  return formatSimpleQueueMaxLimit(uploadMbps, downloadMbps)
}

export function parseQueueMaxLimit(raw: string): { uploadMbps: string; downloadMbps: string } {
  return parseMaxLimit(raw)
}

function isIpv4(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value.trim())
}

function isUnsetAddress(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return !v || v === 'none' || v === '0.0.0.0'
}

function parseIpv4(value: string): number[] | null {
  if (!isIpv4(value)) return null
  const parts = value
    .trim()
    .split('.')
    .map((p) => Number(p))
  if (parts.some((n) => n > 255)) return null
  return parts
}

function ipToInt(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function poolRangeFromGateway(gateway: string, prefix = 24): string | null {
  const parts = parseIpv4(gateway)
  if (!parts || prefix < 8 || prefix > 30) return null
  const ip = ipToInt(parts)
  const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0
  const network = ip & mask
  const broadcast = network | (~mask >>> 0)
  const start = network + 2
  const end = broadcast - 1
  if (start > end) return null
  return `${intToIp(start)}-${intToIp(end)}`
}

function parseAddressCidr(address: string): { ip: string; prefix: number } | null {
  const m = address.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/)
  if (!m) return null
  const ip = m[1]
  if (!parseIpv4(ip)) return null
  const prefix = m[2] ? Number(m[2]) : 24
  if (prefix < 8 || prefix > 32) return null
  return { ip, prefix }
}

function lanCandidates(rows: RosObject[]): { ip: string; prefix: number; iface: string }[] {
  const out: { ip: string; prefix: number; iface: string }[] = []
  for (const row of rows) {
    if (rosBool(row.disabled)) continue
    const parsed = parseAddressCidr(row.address ?? '')
    if (!parsed || parsed.prefix > 30) continue
    const iface = (row.interface ?? '').toLowerCase()
    if (iface.includes('pppoe-out') || iface.includes('lte') || iface.startsWith('wg')) continue
    out.push({ ...parsed, iface })
  }
  return out
}

function localFromPoolRange(ranges: string): string | null {
  const start = (ranges.split(',')[0] ?? '').split('-')[0]?.trim() ?? ''
  const parts = parseIpv4(start)
  if (!parts) return null
  parts[3] = Math.max(1, parts[3] - 1)
  return parts.join('.')
}

async function findPoolName(client: RouterClient, name: string): Promise<RosObject | null> {
  const rows = await client.print(IP_POOL_PATH)
  return rows.find((r) => (r.name ?? '') === name) ?? null
}

async function ensurePppoePool(
  client: RouterClient,
  localHint: string
): Promise<{ poolName: string; localAddress: string }> {
  const existing = await findPoolName(client, PPPOE_POOL_NAME)
  if (existing) {
    const local =
      (!isUnsetAddress(localHint) && isIpv4(localHint)
        ? localHint.trim()
        : localFromPoolRange(existing.ranges ?? '')) || PPPOE_FALLBACK_LOCAL
    return { poolName: PPPOE_POOL_NAME, localAddress: local }
  }

  const addrs = lanCandidates(await client.print(IP_ADDRESS_PATH))
  const lan = addrs[0]
  const local =
    !isUnsetAddress(localHint) && isIpv4(localHint)
      ? localHint.trim()
      : (lan?.ip ?? PPPOE_FALLBACK_LOCAL)
  const range =
    poolRangeFromGateway(local, lan && lan.ip === local ? lan.prefix : 24) ?? PPPOE_FALLBACK_RANGE
  await client.add(IP_POOL_PATH, { name: PPPOE_POOL_NAME, ranges: range })
  return { poolName: PPPOE_POOL_NAME, localAddress: local }
}

/**
 * En v7 el secret no hereda bien local/remote si el perfil `default` los tiene vacíos
 * (`none`). Siempre se resuelve un local-address (IP del router) y un remote-address
 * (nombre de pool, para que cada cliente reciba una IP distinta).
 */
export async function readPppoeSecretDefaults(client: RouterClient): Promise<PppoeSecretDefaults> {
  const rows = await client.print(PPP_PROFILE_PATH, { name: PPPOE_DEFAULT_PROFILE })
  const profile = rows[0]
  let localAddress = (profile?.['local-address'] ?? '').trim()
  let remoteAddress = (profile?.['remote-address'] ?? '').trim()
  if (isUnsetAddress(localAddress)) localAddress = ''
  if (isUnsetAddress(remoteAddress)) remoteAddress = ''

  if (localAddress && remoteAddress) {
    return { profile: PPPOE_DEFAULT_PROFILE, localAddress, remoteAddress }
  }

  if (remoteAddress && !isIpv4(remoteAddress)) {
    const pool = await findPoolName(client, remoteAddress)
    if (pool && !localAddress) {
      localAddress = localFromPoolRange(pool.ranges ?? '') || PPPOE_FALLBACK_LOCAL
    }
  }

  if (!remoteAddress || !localAddress) {
    const ensured = await ensurePppoePool(client, localAddress)
    if (!remoteAddress) remoteAddress = ensured.poolName
    if (!localAddress) localAddress = ensured.localAddress
  }

  if (
    profile?.['.id'] &&
    (isUnsetAddress(profile['local-address']) || isUnsetAddress(profile['remote-address']))
  ) {
    await client.set(PPP_PROFILE_PATH, profile['.id'], {
      'local-address': localAddress,
      'remote-address': remoteAddress
    })
  }

  return { profile: PPPOE_DEFAULT_PROFILE, localAddress, remoteAddress }
}

export function pppoeSecretProps(
  input: PppoeClientInput,
  defaults: PppoeSecretDefaults
): Record<string, string> {
  const localAddress = defaults.localAddress.trim()
  const remoteAddress = defaults.remoteAddress.trim()
  if (!localAddress || !remoteAddress) {
    throw new Error('No se pudo asignar local-address y remote-address al secret PPPoE')
  }
  return {
    name: input.name.trim(),
    password: input.password,
    service: 'pppoe',
    profile: defaults.profile || PPPOE_DEFAULT_PROFILE,
    comment: encodePppoeComment(input.planName, input.comment),
    'local-address': localAddress,
    'remote-address': remoteAddress
  }
}

export function rosBool(value: string | undefined): boolean {
  const v = (value ?? '').toLowerCase()
  return v === 'true' || v === 'yes' || v === 'on'
}

export function isPppoeService(service: string): boolean {
  const s = (service || 'any').toLowerCase()
  return s === 'pppoe' || s === 'any'
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
