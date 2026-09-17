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
export const IP_ADDRESS_PATH = 'ip/address'

export { PPPOE_DEFAULT_PROFILE }

export const PPPOE_FALLBACK_LOCAL = '10.10.10.1'

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

/** IPv4 suelta o con /32. No acepta nombres de pool. */
export function parseStaticIp(value: string): string | null {
  const v = value.trim()
  const m = v.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/)
  if (!m) return null
  if (!parseIpv4(m[1])) return null
  if (m[2] && Number(m[2]) !== 32) return null
  return m[1]
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
  const r = remoteIpBounds(gateway, prefix)
  if (!r) return null
  return `${intToIp(r.start)}-${intToIp(r.end)}`
}

export function pickNextRemoteIp(used: Iterable<string>, local: string, prefix = 24): string {
  const bounds = remoteIpBounds(local, prefix) ?? remoteIpBounds(PPPOE_FALLBACK_LOCAL, 24)
  if (!bounds) throw new Error('No se pudo calcular el rango de IPs remotas PPPoE')
  const taken = new Set<string>()
  for (const u of used) {
    const ip = u.trim()
    if (isIpv4(ip)) taken.add(ip)
  }
  taken.add(local.trim())
  for (let n = bounds.start; n <= bounds.end; n++) {
    const ip = intToIp(n)
    if (!taken.has(ip)) return ip
  }
  throw new Error('No hay IPs remotas libres para clientes PPPoE')
}

function remoteIpBounds(gateway: string, prefix: number): { start: number; end: number } | null {
  const parts = parseIpv4(gateway)
  if (!parts || prefix < 8 || prefix > 30) return null
  const ip = ipToInt(parts)
  const mask = prefix === 32 ? 0xffffffff : ~((1 << (32 - prefix)) - 1) >>> 0
  const network = ip & mask
  const broadcast = network | (~mask >>> 0)
  const start = network + 2
  const end = broadcast - 1
  if (start > end) return null
  return { start, end }
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

/**
 * local-address estático del router. remote-address es IP por cliente, no pool.
 */
export async function resolvePppoeLocal(client: RouterClient): Promise<{
  profile: string
  localAddress: string
  prefix: number
}> {
  const rows = await client.print(PPP_PROFILE_PATH, { name: PPPOE_DEFAULT_PROFILE })
  const profile = rows[0]
  const lans = lanCandidates(await client.print(IP_ADDRESS_PATH))
  let localAddress = (profile?.['local-address'] ?? '').trim()
  if (!isIpv4(localAddress)) localAddress = ''
  let prefix = 24
  if (localAddress) {
    const match = lans.find((l) => l.ip === localAddress)
    if (match) prefix = match.prefix
  } else if (lans[0]) {
    localAddress = lans[0].ip
    prefix = lans[0].prefix
  } else {
    localAddress = PPPOE_FALLBACK_LOCAL
    prefix = 24
  }

  if (profile?.['.id'] && !isIpv4(profile['local-address'] ?? '')) {
    await client.set(PPP_PROFILE_PATH, profile['.id'], { 'local-address': localAddress })
  }

  return { profile: PPPOE_DEFAULT_PROFILE, localAddress, prefix }
}

/** @deprecated usar resolvePppoeLocal; se mantiene para tests de local. */
export async function readPppoeSecretDefaults(client: RouterClient): Promise<PppoeSecretDefaults> {
  const resolved = await resolvePppoeLocal(client)
  return { profile: resolved.profile, localAddress: resolved.localAddress, remoteAddress: '' }
}

function usedRemoteIps(secrets: RosObject[], exceptRosId?: string): string[] {
  const used: string[] = []
  for (const row of secrets) {
    if (exceptRosId && row['.id'] === exceptRosId) continue
    const remote = parseStaticIp(row['remote-address'] ?? '')
    if (remote) used.push(remote)
  }
  return used
}

export async function allocateRemoteAddress(
  client: RouterClient,
  localAddress: string,
  prefix: number,
  preferred: string | undefined,
  exceptRosId?: string,
  keepIfValid?: string
): Promise<string> {
  const secrets = await client.print(PPP_SECRET_PATH)
  const used = usedRemoteIps(secrets, exceptRosId)
  const wantedRaw = (preferred ?? '').trim()
  if (wantedRaw) {
    const wanted = parseStaticIp(wantedRaw)
    if (!wanted) throw new Error(`IP remota inválida: ${wantedRaw}`)
    if (wanted === localAddress) throw new Error('La IP remota no puede ser la local-address')
    if (used.includes(wanted)) throw new Error(`La IP remota ${wanted} ya está en otro secret`)
    return wanted
  }
  const current = parseStaticIp(keepIfValid ?? '')
  if (current && current !== localAddress && !used.includes(current)) return current
  return pickNextRemoteIp([...used, localAddress], localAddress, prefix)
}

export function pppoeSecretProps(
  input: PppoeClientInput,
  defaults: PppoeSecretDefaults,
  remoteAddress: string
): Record<string, string> {
  const localAddress = defaults.localAddress.trim()
  const remote = remoteAddress.trim()
  if (!isIpv4(localAddress) || !isIpv4(remote)) {
    throw new Error('No se pudo asignar local-address y remote-address estáticos al secret PPPoE')
  }
  return {
    name: input.name.trim(),
    password: input.password,
    service: 'pppoe',
    profile: defaults.profile || PPPOE_DEFAULT_PROFILE,
    comment: encodePppoeComment(input.planName, input.comment),
    'local-address': localAddress,
    'remote-address': remote
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
  const ip = parseStaticIp(remoteAddress)
  if (!ip) {
    throw new Error(`simplequeue PPPoE requiere la IP remota del cliente, no "${remoteAddress}"`)
  }
  return {
    name: simpleQueueName(username),
    target: `${ip}/32`,
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
  const resolved = await resolvePppoeLocal(client)
  const remote = await allocateRemoteAddress(
    client,
    resolved.localAddress,
    resolved.prefix,
    input.remoteAddress
  )
  const defaults: PppoeSecretDefaults = {
    profile: resolved.profile,
    localAddress: resolved.localAddress,
    remoteAddress: remote
  }
  const props = pppoeSecretProps(input, defaults, remote)
  await client.add(PPP_SECRET_PATH, props)
  try {
    await upsertSimpleQueue(client, props.name, plan.uploadMbps, plan.downloadMbps, remote)
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
  const resolved = await resolvePppoeLocal(client)
  const current = (await client.print(PPP_SECRET_PATH)).find((r) => r['.id'] === rosId)
  const remote = await allocateRemoteAddress(
    client,
    resolved.localAddress,
    resolved.prefix,
    input.remoteAddress,
    rosId,
    current?.['remote-address']
  )
  const defaults: PppoeSecretDefaults = {
    profile: resolved.profile,
    localAddress: resolved.localAddress,
    remoteAddress: remote
  }
  const props = pppoeSecretProps(input, defaults, remote)
  await client.set(PPP_SECRET_PATH, rosId, props)
  await upsertSimpleQueue(
    client,
    props.name,
    plan.uploadMbps,
    plan.downloadMbps,
    remote,
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
  let resolved: { localAddress: string; prefix: number } | null = null
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
    let remote = parseStaticIp(row['remote-address'] ?? '') ?? ''
    if (!remote) {
      if (!resolved) resolved = await resolvePppoeLocal(client)
      remote = await allocateRemoteAddress(
        client,
        resolved.localAddress,
        resolved.prefix,
        undefined,
        row['.id']
      )
      await client.set(PPP_SECRET_PATH, row['.id'] ?? '', { 'remote-address': remote })
    }
    await upsertSimpleQueue(client, username, plan.uploadMbps, plan.downloadMbps, remote)
  }
}
