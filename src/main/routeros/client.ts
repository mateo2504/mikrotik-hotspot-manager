// Interfaz común sobre las dos APIs de RouterOS:
// - REST (v7.1+, servicio www/www-ssl)
// - Binaria (puerto 8728/8729, v6 y v7)
// Todo el código de la app habla con RouterClient, nunca con la librería directa.

export interface RosObject {
  [key: string]: string
}

export interface RouterClient {
  readonly kind: 'rest' | 'binary'
  connect(): Promise<void>
  close(): Promise<void>
  /** path estilo 'ip/hotspot/user'. query: coincidencia exacta campo=valor */
  print(path: string, query?: Record<string, string>): Promise<RosObject[]>
  add(path: string, props: Record<string, string>): Promise<void>
  set(path: string, id: string, props: Record<string, string>): Promise<void>
  remove(path: string, ids: string[]): Promise<void>
}

export interface ConnectionParams {
  host: string
  port: number | null
  username: string
  password: string
  useSsl: boolean
}

export interface ConnectedRouter {
  client: RouterClient
  identity: string
  version: string
  api: 'rest' | 'binary'
}

import { RestClient } from './restClient'
import { BinaryClient } from './binaryClient'

async function finishConnect(client: RouterClient): Promise<ConnectedRouter> {
  const [identityRes, resourceRes] = await Promise.all([
    client.print('system/identity'),
    client.print('system/resource')
  ])
  return {
    client,
    identity: identityRes[0]?.name ?? '',
    version: resourceRes[0]?.version ?? '',
    api: client.kind
  }
}

export async function connectRouter(
  params: ConnectionParams,
  apiType: 'auto' | 'rest' | 'binary',
  detectedApi: 'rest' | 'binary' | null
): Promise<ConnectedRouter> {
  const tryRest = async (): Promise<ConnectedRouter> => {
    const c = new RestClient(params)
    await c.connect()
    return finishConnect(c)
  }
  const tryBinary = async (): Promise<ConnectedRouter> => {
    const c = new BinaryClient(params)
    await c.connect()
    try {
      return await finishConnect(c)
    } catch (e) {
      await c.close()
      throw e
    }
  }

  if (apiType === 'rest') return tryRest()
  if (apiType === 'binary') return tryBinary()

  // Automático: respetar lo ya detectado; si no, REST primero y caer a binaria
  if (detectedApi === 'rest') return tryRest()
  if (detectedApi === 'binary') return tryBinary()
  try {
    return await tryRest()
  } catch (restErr) {
    // Si REST falló por credenciales, no tiene caso probar binaria con las mismas
    if (restErr instanceof Error && /401|credenciales/i.test(restErr.message)) throw restErr
    return tryBinary()
  }
}
