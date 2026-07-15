import type {
  RosObject,
  RouterClient
} from './client'
import type {
  ActiveSession,
  HotspotHost,
  HotspotProfile,
  HotspotUser,
  IpBinding,
  IpBindingInput,
  ProfileInput,
  UserInput
} from '../../shared/types'
import { buildInterval } from '../../shared/types'
import { getPlanMeta, listPlanMeta } from '../db/repos/planMeta'

const USER_PATH = 'ip/hotspot/user'
const PROFILE_PATH = 'ip/hotspot/user/profile'
const ACTIVE_PATH = 'ip/hotspot/active'
const HOST_PATH = 'ip/hotspot/host'
const IPBINDING_PATH = 'ip/hotspot/ip-binding'
const SCHEDULER_PATH = 'system/scheduler'

// ---- Script on-login ----
// Se ejecuta en CADA login del usuario, pero la lógica solo actúa la PRIMERA vez:
//  1) Añade al comentario la fecha y hora de inicio ("| inicio:<fecha> <hora>"),
//     sin pisar el tag "lote:<id>" (se concatena al final). Guard: solo si el
//     comentario aún no contiene "inicio:".
//  2) Si el plan tiene vigencia, crea un scheduler de un disparo "exp-<usuario>"
//     que al vencer elimina al usuario, su sesión activa y el propio scheduler.
//  3) Si macAleatoria está activo, cierra cualquier sesión activa del mismo
//     usuario que tenga una MAC distinta a la del login actual. Combinado con
//     shared-users=2 permite el cambio de MAC sin bloquear el acceso.
export function buildOnLoginScript(validity: string, macAleatoria = false): string {
  // Bloque 1: registrar fecha/hora de inicio en el comentario (siempre)
  const stampBlock =
    ':local cm [/ip hotspot user get [find name=$u] comment]; ' +
    ':if ([:typeof [:find $cm "inicio:"]] = "nil") do={ ' +
    '/ip hotspot user set [find name=$u] comment=($cm . " | inicio:" . ' +
    '[/system clock get date] . " " . [/system clock get time]) }'

  // Bloque 2: vigencia mediante scheduler (solo si hay validity)
  let expiryBlock = ''
  if (validity) {
    const onEvent =
      '("/ip hotspot user remove [find name=\\"" . $u . "\\"]; ' +
      '/ip hotspot active remove [find user=\\"" . $u . "\\"]; ' +
      '/system scheduler remove [find name=\\"exp-" . $u . "\\"]")'
    expiryBlock =
      '; :if ([:len [/system scheduler find name=("exp-" . $u)]] = 0) do={ ' +
      `/system scheduler add name=("exp-" . $u) interval=${validity} ` +
      `on-event=${onEvent} }`
  }

  // Bloque 3: MAC aleatoria — cerrar sesiones del usuario con otra MAC
  let macBlock = ''
  if (macAleatoria) {
    macBlock =
      '; :local curMac $"mac-address"; ' +
      ':foreach i in=[/ip hotspot active find where user=$u] do={ ' +
      ':if ([/ip hotspot active get $i mac-address] != $curMac) do={ ' +
      '/ip hotspot active remove $i } }'
  }

  return ':local u $user; ' + stampBlock + expiryBlock + macBlock
}

// ---- Planes (user profiles) ----

export async function listProfiles(client: RouterClient, routerId: number): Promise<HotspotProfile[]> {
  const [rows, metas] = await Promise.all([
    client.print(PROFILE_PATH),
    Promise.resolve(listPlanMeta(routerId))
  ])
  return rows.map((r) => ({
    rosId: r['.id'] ?? '',
    name: r.name ?? '',
    rateLimit: r['rate-limit'] ?? '',
    sharedUsers: r['shared-users'] ?? '',
    sessionTimeout: r['session-timeout'] ?? '',
    idleTimeout: r['idle-timeout'] ?? '',
    meta: metas.get(r.name ?? '') ?? null
  }))
}

export function profileProps(input: ProfileInput): Record<string, string> {
  const props: Record<string, string> = {
    name: input.name,
    'on-login': buildOnLoginScript(input.validity, input.macAleatoria),
    // Con MAC aleatoria se fuerza shared-users=2 para permitir el cambio de MAC
    'shared-users': input.macAleatoria ? '2' : input.sharedUsers || '1',
    // Valor por defecto: cierra sesiones inactivas tras 5 minutos
    'idle-timeout': '5m'
  }
  if (input.rateLimit) props['rate-limit'] = input.rateLimit
  return props
}

// ---- Usuarios ----

export async function listUsers(client: RouterClient): Promise<HotspotUser[]> {
  const rows = await client.print(USER_PATH)
  return rows
    .filter((r) => (r.name ?? '') !== 'default-trial')
    .map((r) => ({
      rosId: r['.id'] ?? '',
      name: r.name ?? '',
      password: r.password ?? '',
      profile: r.profile ?? 'default',
      comment: r.comment ?? '',
      limitUptime: r['limit-uptime'] ?? '',
      uptime: r.uptime ?? '',
      bytesIn: r['bytes-in'] ?? '0',
      bytesOut: r['bytes-out'] ?? '0',
      disabled: (r.disabled ?? 'false') === 'true'
    }))
}

/** Props para crear un usuario aplicando limit-uptime si el plan es pausado */
export function userProps(routerId: number, input: UserInput): Record<string, string> {
  const props: Record<string, string> = {
    name: input.name,
    password: input.password,
    profile: input.profile
  }
  if (input.comment) props.comment = input.comment
  const meta = getPlanMeta(routerId, input.profile)
  if (meta && meta.planType === 'pausado' && meta.uptimeLimit) {
    props['limit-uptime'] = meta.uptimeLimit
  }
  return props
}

export async function addUser(client: RouterClient, props: Record<string, string>): Promise<void> {
  await client.add(USER_PATH, props)
}

// ---- Activos ----

export async function listActive(client: RouterClient): Promise<ActiveSession[]> {
  const rows = await client.print(ACTIVE_PATH)
  return rows.map((r) => ({
    rosId: r['.id'] ?? '',
    user: r.user ?? '',
    address: r.address ?? '',
    macAddress: r['mac-address'] ?? '',
    uptime: r.uptime ?? '',
    bytesIn: r['bytes-in'] ?? '0',
    bytesOut: r['bytes-out'] ?? '0',
    loginBy: r['login-by'] ?? ''
  }))
}

export async function disconnectActive(client: RouterClient, rosId: string): Promise<void> {
  await client.remove(ACTIVE_PATH, [rosId])
}

// ---- Hotspot Hosts ----

export async function listHosts(client: RouterClient): Promise<HotspotHost[]> {
  const rows = await client.print(HOST_PATH)
  return rows.map((r) => ({
    rosId: r['.id'] ?? '',
    macAddress: r['mac-address'] ?? '',
    address: r.address ?? '',
    toAddress: r['to-address'] ?? '',
    server: r.server ?? '',
    uptime: r.uptime ?? '',
    bytesIn: r['bytes-in'] ?? '0',
    bytesOut: r['bytes-out'] ?? '0',
    comment: r.comment ?? '',
    authorized: (r['authorized'] ?? 'false') === 'true',
    bypassed: (r['bypassed'] ?? 'false') === 'true',
    blocked: (r['blocked'] ?? 'false') === 'true'
  }))
}

export async function convertHostToIpBinding(
  client: RouterClient,
  input: IpBindingInput
): Promise<void> {
  const props: Record<string, string> = {
    'mac-address': input.macAddress,
    type: input.type,
    address: input.address || '0.0.0.0',
    comment: input.comment
  }
  await client.add(IPBINDING_PATH, props)

  if (!input.isVip && input.expiryValue > 0) {
    const schedulerName = `exp-${input.macAddress}`
    const interval = buildInterval(input.expiryValue, input.expiryUnit)
    const onEvent = `/ip hotspot ip-binding set [find mac-address="${input.macAddress}"] disabled=yes; /system scheduler remove [find name="${schedulerName}"]`
    await client.add(SCHEDULER_PATH, {
      name: schedulerName,
      interval,
      'on-event': onEvent,
      'start-time': 'startup'
    })
  }
}

// ---- IP Binding ----

export async function listIpBindings(client: RouterClient): Promise<IpBinding[]> {
  const [bindings, schedulers] = await Promise.all([
    client.print(IPBINDING_PATH),
    client.print(SCHEDULER_PATH)
  ])
  const schedulerByName = new Map<string, RosObject>()
  for (const s of schedulers) {
    const n = s.name ?? ''
    if (n) schedulerByName.set(n, s)
  }
  return bindings.map((r) => {
    const name = r.name ?? ''
    const schedName = schedulerByName.has(`exp-${name}`) ? `exp-${name}` : (schedulerByName.has(`exp-${r['mac-address']}`) ? `exp-${r['mac-address']}` : undefined)
    const sched = schedName ? schedulerByName.get(schedName) : undefined
    return {
      rosId: r['.id'] ?? '',
      macAddress: r['mac-address'] ?? '',
      address: r.address ?? '',
      type: (r.type ?? 'bypassed') as IpBinding['type'],
      comment: r.comment ?? '',
      disabled: (r.disabled ?? 'false') === 'true',
      hasScheduler: sched !== undefined,
      schedulerName: schedName,
      schedulerInterval: sched?.interval ?? undefined
    }
  })
}

export async function addIpBinding(
  client: RouterClient,
  input: IpBindingInput
): Promise<void> {
  const props: Record<string, string> = {
    'mac-address': input.macAddress,
    type: input.type,
    address: input.address || '0.0.0.0',
    comment: input.comment
  }
  await client.add(IPBINDING_PATH, props)

  // Si no es VIP y tiene expiración, crear scheduler
  if (!input.isVip && input.expiryValue > 0) {
    const schedulerName = `exp-${input.macAddress}`
    const interval = buildInterval(input.expiryValue, input.expiryUnit)
    const onEvent = `/ip hotspot ip-binding set [find mac-address="${input.macAddress}"] disabled=yes; /system scheduler remove [find name="${schedulerName}"]`
    await client.add(SCHEDULER_PATH, {
      name: schedulerName,
      interval,
      'on-event': onEvent,
      'start-time': 'startup'
    })
  }
}

export async function updateIpBinding(
  client: RouterClient,
  rosId: string,
  input: IpBindingInput
): Promise<void> {
  const props: Record<string, string> = {
    'mac-address': input.macAddress,
    type: input.type,
    address: input.address || '0.0.0.0',
    comment: input.comment ?? ''
  }
  await client.set(IPBINDING_PATH, rosId, props)

  // Manejar scheduler: si es VIP, eliminar scheduler; si no es VIP y tiene expiración, crear/actualizar
  const schedulerName = `exp-${input.macAddress}`
  const existing = await client.print(SCHEDULER_PATH, { name: schedulerName })

  if (input.isVip || input.expiryValue <= 0) {
    // Eliminar scheduler si existe
    if (existing.length > 0 && existing[0]['.id']) {
      await client.remove(SCHEDULER_PATH, [existing[0]['.id']])
    }
  } else {
    // Crear o actualizar scheduler
    const interval = buildInterval(input.expiryValue, input.expiryUnit)
    const onEvent = `/ip hotspot ip-binding set [find mac-address="${input.macAddress}"] disabled=yes; /system scheduler remove [find name="${schedulerName}"]`
    if (existing.length > 0 && existing[0]['.id']) {
      await client.set(SCHEDULER_PATH, existing[0]['.id'], {
        interval,
        'on-event': onEvent
      })
    } else {
      await client.add(SCHEDULER_PATH, {
        name: schedulerName,
        interval,
        'on-event': onEvent,
        'start-time': 'startup'
      })
    }
  }
}

export async function removeIpBinding(client: RouterClient, rosId: string): Promise<void> {
  await client.remove(IPBINDING_PATH, [rosId])
}

export async function disableIpBinding(client: RouterClient, rosId: string): Promise<void> {
  await client.set(IPBINDING_PATH, rosId, { disabled: 'yes' })
}

export async function enableIpBinding(client: RouterClient, rosId: string): Promise<void> {
  await client.set(IPBINDING_PATH, rosId, { disabled: 'no' })
}

// ---- Operaciones de lote ----

const CHUNK = 50

/**
 * Busca los usuarios de un lote por el PREFIJO del comentario ("lote:<tag>").
 * Se filtra localmente porque el comentario de cada ficha lleva además la fecha
 * y hora de inicio al final, por lo que una coincidencia exacta ya no sirve.
 */
export async function findUsersByComment(
  client: RouterClient,
  commentPrefix: string
): Promise<RosObject[]> {
  const all = await client.print(USER_PATH)
  return all.filter((u) => (u.comment ?? '').startsWith(commentPrefix))
}

export async function removeUsers(client: RouterClient, ids: string[]): Promise<number> {
  let removed = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    await client.remove(USER_PATH, chunk)
    removed += chunk.length
  }
  return removed
}

/** Elimina los schedulers de vigencia (exp-<usuario>) de un conjunto de usuarios */
export async function removeExpirySchedulers(
  client: RouterClient,
  usernames: string[]
): Promise<void> {
  if (usernames.length === 0) return
  const wanted = new Set(usernames.map((u) => `exp-${u}`))
  const all = await client.print(SCHEDULER_PATH)
  const ids = all
    .filter((s) => wanted.has(s.name ?? ''))
    .map((s) => s['.id'] ?? '')
    .filter(Boolean)
  for (let i = 0; i < ids.length; i += CHUNK) {
    await client.remove(SCHEDULER_PATH, ids.slice(i, i + CHUNK))
  }
}

export { USER_PATH, PROFILE_PATH, ACTIVE_PATH }
