import http from 'http'
import https from 'https'
import type { ConnectionParams, RosObject, RouterClient } from './client'

const TIMEOUT_MS = 8000

// Cliente REST API de RouterOS v7 (servicio www o www-ssl, endpoint /rest).
// Se usa http/https nativo para poder aceptar certificados autofirmados.
export class RestClient implements RouterClient {
  readonly kind = 'rest' as const
  private params: ConnectionParams

  constructor(params: ConnectionParams) {
    this.params = params
  }

  private request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: unknown }> {
    const { host, username, password, useSsl } = this.params
    const port = this.params.port ?? (useSsl ? 443 : 80)
    const lib = useSsl ? https : http
    const payload = body !== undefined ? JSON.stringify(body) : null

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          host,
          port,
          method,
          path: `/rest/${path}`,
          timeout: TIMEOUT_MS,
          rejectUnauthorized: false, // MikroTik usa certificados autofirmados normalmente
          auth: `${username}:${password}`,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
          }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let data: unknown = null
            if (text) {
              try {
                data = JSON.parse(text)
              } catch {
                data = text
              }
            }
            resolve({ status: res.statusCode ?? 0, data })
          })
        }
      )
      req.on('timeout', () => {
        req.destroy(new Error('Tiempo de espera agotado'))
      })
      req.on('error', (err) => reject(err))
      if (payload) req.write(payload)
      req.end()
    })
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const { status, data } = await this.request(method, path, body)
    if (status === 401) throw new Error('Credenciales incorrectas (401)')
    if (status === 404) throw new Error(`REST no disponible o ruta inválida (404): ${path}`)
    if (status < 200 || status >= 300) {
      const detail =
        data && typeof data === 'object'
          ? ((data as Record<string, unknown>).detail ??
            (data as Record<string, unknown>).message ??
            JSON.stringify(data))
          : String(data)
      throw new Error(`Error RouterOS (${status}): ${detail}`)
    }
    return data
  }

  async connect(): Promise<void> {
    const data = await this.call('GET', 'system/resource')
    if (!data || typeof data !== 'object') {
      throw new Error('Respuesta REST inesperada')
    }
  }

  async close(): Promise<void> {
    // REST no mantiene conexión persistente
  }

  async print(path: string, query?: Record<string, string>): Promise<RosObject[]> {
    let data: unknown
    if (query && Object.keys(query).length > 0) {
      const q = Object.entries(query).map(([k, v]) => `${k}=${v}`)
      data = await this.call('POST', `${path}/print`, { '.query': q })
    } else {
      data = await this.call('GET', path)
    }
    if (Array.isArray(data)) return data as RosObject[]
    if (data && typeof data === 'object') return [data as RosObject]
    return []
  }

  async add(path: string, props: Record<string, string>): Promise<void> {
    await this.call('PUT', path, props)
  }

  async set(path: string, id: string, props: Record<string, string>): Promise<void> {
    await this.call('PATCH', `${path}/${encodeURIComponent(id)}`, props)
  }

  async remove(path: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.call('POST', `${path}/remove`, { numbers: ids.join(',') })
  }
}
