import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { RosObject, RouterClient } from './client'
import { closeDb, getDb, openMemoryDatabase } from '../db/database'
import { upsertPppoePlan } from '../db/repos/pppoePlans'
import {
  PPPOE_DEFAULT_PROFILE,
  createPppoeClient,
  disconnectPppoeActive,
  encodePppoeComment,
  isPppoeService,
  listPppoeActive,
  listPppoeClients,
  parsePppoeComment,
  pppoeInterfaceTarget,
  pppoeSecretProps,
  readPppoeSecretDefaults,
  removePppoeClient,
  resumePppoeClient,
  simpleQueueMaxLimit,
  simpleQueueName,
  simpleQueueProps,
  suspendPppoeClient,
  syncQueuesForPlan,
  updatePppoeClient
} from './pppoe'

class FakeClient implements RouterClient {
  readonly kind = 'rest' as const
  private nextId = 1
  readonly tables = new Map<string, RosObject[]>()

  private rows(path: string): RosObject[] {
    let list = this.tables.get(path)
    if (!list) {
      list = []
      this.tables.set(path, list)
    }
    return list
  }

  async connect(): Promise<void> {
    await Promise.resolve()
  }
  async close(): Promise<void> {
    await Promise.resolve()
  }

  async print(path: string, query?: Record<string, string>): Promise<RosObject[]> {
    const list = this.rows(path)
    if (!query || Object.keys(query).length === 0) return list.map((r) => ({ ...r }))
    return list
      .filter((row) => Object.entries(query).every(([k, v]) => row[k] === v))
      .map((r) => ({ ...r }))
  }

  async add(path: string, props: Record<string, string>): Promise<void> {
    this.rows(path).push({ ...props, '.id': `*${this.nextId++}` })
  }

  async set(path: string, id: string, props: Record<string, string>): Promise<void> {
    const row = this.rows(path).find((r) => r['.id'] === id)
    if (!row) throw new Error(`no encontrado ${path} ${id}`)
    Object.assign(row, props)
  }

  async remove(path: string, ids: string[]): Promise<void> {
    const wanted = new Set(ids)
    const list = this.rows(path)
    this.tables.set(
      path,
      list.filter((r) => !wanted.has(r['.id'] ?? ''))
    )
  }
}

function insertRouter(): number {
  const res = getDb()
    .prepare(`INSERT INTO routers (name, host, username, password_enc) VALUES (?, ?, ?, ?)`)
    .run('Equipo', '10.0.0.1', 'admin', Buffer.from('x'))
  return Number(res.lastInsertRowid)
}

describe('secret y simplequeue PPPoE', () => {
  it('el backend pone profile=default y copia local/remote del perfil', () => {
    const props = pppoeSecretProps(
      { name: 'juan', password: 'clave', planName: '10/20', comment: 'casa' },
      { profile: PPPOE_DEFAULT_PROFILE, localAddress: '10.10.10.1', remoteAddress: 'pppoe-pool' }
    )
    assert.equal(props.profile, 'default')
    assert.equal(props.service, 'pppoe')
    assert.equal(props['local-address'], '10.10.10.1')
    assert.equal(props['remote-address'], 'pppoe-pool')
    assert.equal(props.comment, 'plan:10/20 | casa')
    assert.equal('profile' in props && props.profile === 'default', true)
  })

  it('si el perfil default no trae addresses, no las inventa en el secret', () => {
    const props = pppoeSecretProps(
      { name: 'juan', password: 'x', planName: 'basico', comment: '' },
      { profile: 'default', localAddress: '', remoteAddress: '' }
    )
    assert.equal(props.profile, 'default')
    assert.equal(props['local-address'], undefined)
    assert.equal(props['remote-address'], undefined)
  })

  it('la velocidad del secret va a simplequeue como subida/bajada en M', () => {
    assert.equal(simpleQueueMaxLimit('5', '10'), '5M/10M')
    assert.equal(simpleQueueMaxLimit('8M', '20'), '8M/20M')
    const q = simpleQueueProps('juan', '5', '10', 'pppoe-pool')
    assert.equal(q.name, simpleQueueName('juan'))
    assert.equal(q['max-limit'], '5M/10M')
    assert.equal(q.target, pppoeInterfaceTarget('juan'))
  })

  it('si remote-address es IP, el simplequeue apunta a esa IP', () => {
    const q = simpleQueueProps('ana', '2', '4', '10.10.10.50')
    assert.equal(q.target, '10.10.10.50/32')
  })

  it('parsea el tag de plan en el comentario', () => {
    assert.deepEqual(parsePppoeComment(encodePppoeComment('Residencial', 'pto 4')), {
      planName: 'Residencial',
      comment: 'pto 4'
    })
    assert.deepEqual(parsePppoeComment('sin tag'), { planName: '', comment: 'sin tag' })
  })

  it('solo trata como PPPoE los secrets pppoe o any', () => {
    assert.equal(isPppoeService('pppoe'), true)
    assert.equal(isPppoeService('any'), true)
    assert.equal(isPppoeService('pptp'), false)
    assert.equal(isPppoeService('l2tp'), false)
  })
})

describe('CRUD PPPoE sobre RouterOS simulado', () => {
  let client: FakeClient
  let routerId: number

  beforeEach(async () => {
    openMemoryDatabase()
    routerId = insertRouter()
    upsertPppoePlan(routerId, {
      name: '10/20',
      uploadMbps: '10',
      downloadMbps: '20',
      price: '',
      notes: ''
    })
    client = new FakeClient()
    await client.add('ppp/profile', {
      name: 'default',
      'local-address': '10.10.10.1',
      'remote-address': 'pppoe-pool'
    })
  })

  afterEach(() => {
    closeDb()
  })

  it('crea secret + simplequeue, suspende (disabled) y desconecta activos', async () => {
    await createPppoeClient(client, routerId, {
      name: 'juan',
      password: 'secret',
      planName: '10/20',
      comment: ''
    })

    const defaults = await readPppoeSecretDefaults(client)
    assert.equal(defaults.profile, 'default')
    assert.equal(defaults.localAddress, '10.10.10.1')
    assert.equal(defaults.remoteAddress, 'pppoe-pool')

    const clients = await listPppoeClients(client, [
      { name: '10/20', uploadMbps: '10', downloadMbps: '20', price: '', notes: '' }
    ])
    assert.equal(clients.length, 1)
    assert.equal(clients[0].name, 'juan')
    assert.equal(clients[0].profile, 'default')
    assert.equal(clients[0].localAddress, '10.10.10.1')
    assert.equal(clients[0].uploadMbps, '10')
    assert.equal(clients[0].downloadMbps, '20')
    assert.equal(clients[0].disabled, false)

    const queues = await client.print('queue/simple')
    assert.equal(queues.length, 1)
    assert.equal(queues[0]['max-limit'], '10M/20M')
    assert.equal(queues[0].name, 'pppoe-juan')

    await client.add('ppp/active', { name: 'juan', address: '10.10.10.20' })
    assert.equal((await listPppoeActive(client)).length, 1)

    await suspendPppoeClient(client, clients[0].rosId, 'juan')
    const afterSuspend = await listPppoeClients(client, [])
    assert.equal(afterSuspend[0].disabled, true)
    assert.equal((await listPppoeActive(client)).length, 0)

    await resumePppoeClient(client, clients[0].rosId)
    assert.equal((await listPppoeClients(client, []))[0].disabled, false)
  })

  it('en activos solo desconecta, sin tocar el secret', async () => {
    await createPppoeClient(client, routerId, {
      name: 'ana',
      password: 'x',
      planName: '10/20',
      comment: ''
    })
    await client.add('ppp/active', { name: 'ana', address: '10.10.10.21' })
    const sessions = await listPppoeActive(client)
    await disconnectPppoeActive(client, sessions[0].rosId)
    assert.equal((await listPppoeActive(client)).length, 0)
    assert.equal((await listPppoeClients(client, []))[0].name, 'ana')
  })

  it('editar plan actualiza el simplequeue y eliminar quita secret y cola', async () => {
    await createPppoeClient(client, routerId, {
      name: 'juan',
      password: 'x',
      planName: '10/20',
      comment: 'casa'
    })
    await updatePppoeClient(
      client,
      routerId,
      (await listPppoeClients(client, []))[0].rosId,
      'juan',
      {
        name: 'juan2',
        password: 'y',
        planName: '10/20',
        comment: 'casa'
      }
    )
    const renamed = await listPppoeClients(client, [
      { name: '10/20', uploadMbps: '10', downloadMbps: '20', price: '', notes: '' }
    ])
    assert.equal(renamed[0].name, 'juan2')
    assert.equal((await client.print('queue/simple'))[0].name, 'pppoe-juan2')

    upsertPppoePlan(routerId, {
      name: '10/20',
      uploadMbps: '8',
      downloadMbps: '16',
      price: '',
      notes: ''
    })
    await syncQueuesForPlan(client, '10/20', {
      name: '10/20',
      uploadMbps: '8',
      downloadMbps: '16',
      price: '',
      notes: ''
    })
    assert.equal((await client.print('queue/simple'))[0]['max-limit'], '8M/16M')

    await removePppoeClient(client, renamed[0].rosId, 'juan2')
    assert.equal((await listPppoeClients(client, [])).length, 0)
    assert.equal((await client.print('queue/simple')).length, 0)
  })
})
