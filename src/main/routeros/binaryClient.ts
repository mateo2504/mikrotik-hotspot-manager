import { RouterOSAPI } from 'node-routeros'
import type { ConnectionParams, RosObject, RouterClient } from './client'

// Cliente de la API binaria de RouterOS (puerto 8728 / api-ssl 8729).
// Funciona en v6 y v7; node-routeros maneja el login post-6.43 con fallback MD5.
export class BinaryClient implements RouterClient {
  readonly kind = 'binary' as const
  private conn: RouterOSAPI

  constructor(params: ConnectionParams) {
    this.conn = new RouterOSAPI({
      host: params.host,
      user: params.username,
      password: params.password,
      port: params.port ?? (params.useSsl ? 8729 : 8728),
      timeout: 8,
      keepalive: true,
      ...(params.useSsl ? { tls: { rejectUnauthorized: false } } : {})
    })
  }

  async connect(): Promise<void> {
    try {
      await this.conn.connect()
    } catch (err) {
      throw new Error(translateError(err))
    }
  }

  async close(): Promise<void> {
    try {
      await this.conn.close()
    } catch {
      // ignorar errores al cerrar
    }
  }

  private async write(menu: string, words: string[]): Promise<RosObject[]> {
    try {
      const res = await this.conn.write(menu, words)
      return (res ?? []) as RosObject[]
    } catch (err) {
      throw new Error(translateError(err))
    }
  }

  async print(path: string, query?: Record<string, string>): Promise<RosObject[]> {
    const words = query ? Object.entries(query).map(([k, v]) => `?${k}=${v}`) : []
    return this.write(`/${path}/print`, words)
  }

  async add(path: string, props: Record<string, string>): Promise<void> {
    const words = Object.entries(props).map(([k, v]) => `=${k}=${v}`)
    await this.write(`/${path}/add`, words)
  }

  async set(path: string, id: string, props: Record<string, string>): Promise<void> {
    const words = [`=.id=${id}`, ...Object.entries(props).map(([k, v]) => `=${k}=${v}`)]
    await this.write(`/${path}/set`, words)
  }

  async remove(path: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.write(`/${path}/remove`, [`=numbers=${ids.join(',')}`])
  }
}

function translateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/cannot log in|invalid user|login failure/i.test(msg)) return 'Credenciales incorrectas'
  if (/ETIMEDOUT|timed? ?out/i.test(msg)) return 'Tiempo de espera agotado'
  if (/ECONNREFUSED/i.test(msg)) return 'Conexión rechazada (¿servicio api habilitado?)'
  if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) return 'Equipo inalcanzable'
  return msg
}
