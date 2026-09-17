import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { RosObject, RouterClient } from './client'
import { closeDb, getDb, openMemoryDatabase } from '../db/database'
import { upsertPppoePlan } from '../db/repos/pppoePlans'
import {
  PPPOE_DEFAULT_PROFILE,
  allocateRemoteAddress,
  createPppoeClient,
  disconnectPppoeActive,
  encodePppoeComment,
  isPppoeService,
  listPppoeActive,
  listPppoeClients,
  parsePppoeComment,
  parseStaticIp,
  pppoeSecretProps,
  pickNextRemoteIp,
  poolRangeFromGateway,
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
  it('el backend pone profile=default y remote-address IPv4 estática', () => {
    const props = pppoeSecretProps(
      { name: 'juan', password: 'clave', planName: '10/20', comment: 'casa' },
      { profile: PPPOE_DEFAULT_PROFILE, localAddress: '10.10.10.1', remoteAddress: '' },
      '10.10.10.2'
    )
    assert.equal(props.profile, 'default')
    assert.equal(props.service, 'pppoe')
    assert.equal(props['local-address'], '10.10.10.1')
    assert.equal(props['remote-address'], '10.10.10.2')
    assert.notEqual(props['remote-address'], 'pppoe-pool')
    assert.equal(props.comment, 'plan:10/20 | casa')
  })

  it('el secret siempre lleva local-address y remote-address IPv4', () => {
    const props = pppoeSecretProps(
      { name: 'juan', password: 'x', planName: 'basico', comment: '' },
      { profile: 'default', localAddress: '192.168.88.1', remoteAddress: '' },
      '192.168.88.10'
    )
    assert.equal(props['local-address'], '192.168.88.1')
    assert.equal(props['remote-address'], '192.168.88.10')
  })

  it('rechaza un secret sin IPs estáticas', () => {
    assert.throws(
      () =>
        pppoeSecretProps(
          { name: 'juan', password: 'x', planName: 'basico', comment: '' },
          { profile: 'default', localAddress: '', remoteAddress: '' },
          'pppoe-pool'
        ),
      /local-address y remote-address/
    )
  })

  it('la velocidad del secret va a simplequeue como 3M/8M sobre la IP remota', () => {
    assert.equal(simpleQueueMaxLimit('3', '8'), '3M/8M')
    assert.equal(simpleQueueMaxLimit('5', '10'), '5M/10M')
    assert.equal(simpleQueueMaxLimit('8M', '20'), '8M/20M')
    assert.equal(simpleQueueMaxLimit('3000000', '8000000'), '3M/8M')
    assert.equal(simpleQueueMaxLimit('3000000M', '8000000M'), '3M/8M')
    const q = simpleQueueProps('juan', '3', '8', '10.10.10.20')
    assert.equal(q.name, simpleQueueName('juan'))
    assert.equal(q['max-limit'], '3M/8M')
    assert.notEqual(q['max-limit'], '3000000M/8000000M')
    assert.equal(q.target, '10.10.10.20/32')
    assert.notEqual(q.target, '<pppoe-juan>')
  })

  it('simplequeue no acepta pool ni interfaz como target', () => {
    assert.throws(() => simpleQueueProps('ana', '2', '4', 'pppoe-pool'), /IP remota/)
    assert.throws(() => simpleQueueProps('ana', '2', '4', ''), /IP remota/)
  })

  it('parsea IPv4 suelta o /32', () => {
    assert.equal(parseStaticIp('10.10.10.50'), '10.10.10.50')
    assert.equal(parseStaticIp('10.10.10.50/32'), '10.10.10.50')
    assert.equal(parseStaticIp('pppoe-pool'), null)
    assert.equal(parseStaticIp('10.10.10.50/24'), null)
  })

  it('elige IPs remotas únicas saltando red, gateway y broadcast', () => {
    const a = pickNextRemoteIp(['10.10.10.1'], '10.10.10.1', 24)
    assert.equal(a, '10.10.10.2')
    const b = pickNextRemoteIp(['10.10.10.1', '10.10.10.2'], '10.10.10.1', 24)
    assert.equal(b, '10.10.10.3')
    assert.equal(poolRangeFromGateway('10.10.10.1', 24), '10.10.10.2-10.10.10.254')
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
      'local-address': '10.10.10.1'
    })
  })

  afterEach(() => {
    closeDb()
  })

  it('crea secret + simplequeue con IP estática y target /32', async () => {
    await createPppoeClient(client, routerId, {
      name: 'juan',
      password: 'secret',
      planName: '10/20',
      comment: ''
    })

    const defaults = await readPppoeSecretDefaults(client)
    assert.equal(defaults.profile, 'default')
    assert.equal(defaults.localAddress, '10.10.10.1')

    const clients = await listPppoeClients(client, [
      { name: '10/20', uploadMbps: '10', downloadMbps: '20', price: '', notes: '' }
    ])
    assert.equal(clients.length, 1)
    assert.equal(clients[0].name, 'juan')
    assert.equal(clients[0].profile, 'default')
    assert.equal(clients[0].localAddress, '10.10.10.1')
    assert.equal(clients[0].remoteAddress, '10.10.10.2')
    assert.equal(clients[0].uploadMbps, '10')
    assert.equal(clients[0].downloadMbps, '20')
    assert.equal(clients[0].disabled, false)

    const queues = await client.print('queue/simple')
    assert.equal(queues.length, 1)
    assert.equal(queues[0]['max-limit'], '10M/20M')
    assert.equal(queues[0].name, 'pppoe-juan')
    assert.equal(queues[0].target, '10.10.10.2/32')

    await client.add('ppp/active', { name: 'juan', address: '10.10.10.2' })
    assert.equal((await listPppoeActive(client)).length, 1)

    await suspendPppoeClient(client, clients[0].rosId, 'juan')
    const afterSuspend = await listPppoeClients(client, [])
    assert.equal(afterSuspend[0].disabled, true)
    assert.equal((await listPppoeActive(client)).length, 0)

    await resumePppoeClient(client, clients[0].rosId)
    assert.equal((await listPppoeClients(client, []))[0].disabled, false)
  })

  it('asigna IPs remotas distintas a cada cliente', async () => {
    await createPppoeClient(client, routerId, {
      name: 'ana',
      password: 'x',
      planName: '10/20',
      comment: ''
    })
    await createPppoeClient(client, routerId, {
      name: 'bob',
      password: 'y',
      planName: '10/20',
      comment: ''
    })
    const secrets = await client.print('ppp/secret')
    assert.equal(secrets[0]['remote-address'], '10.10.10.2')
    assert.equal(secrets[1]['remote-address'], '10.10.10.3')
    const queues = await client.print('queue/simple')
    assert.equal(queues[0].target, '10.10.10.2/32')
    assert.equal(queues[1].target, '10.10.10.3/32')
  })

  it('respeta una IP remota pedida y rechaza duplicados', async () => {
    await createPppoeClient(client, routerId, {
      name: 'ana',
      password: 'x',
      planName: '10/20',
      comment: '',
      remoteAddress: '10.10.10.50'
    })
    assert.equal((await client.print('ppp/secret'))[0]['remote-address'], '10.10.10.50')
    assert.equal((await client.print('queue/simple'))[0].target, '10.10.10.50/32')

    await assert.rejects(
      () =>
        createPppoeClient(client, routerId, {
          name: 'bob',
          password: 'y',
          planName: '10/20',
          comment: '',
          remoteAddress: '10.10.10.50'
        }),
      /ya está en otro secret/
    )
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

  it('editar cliente conserva la IP; editar plan solo cambia max-limit', async () => {
    await createPppoeClient(client, routerId, {
      name: 'juan',
      password: 'x',
      planName: '10/20',
      comment: 'casa'
    })
    const originalIp = (await client.print('ppp/secret'))[0]['remote-address']
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
    assert.equal(renamed[0].remoteAddress, originalIp)
    const queueAfterRename = (await client.print('queue/simple'))[0]
    assert.equal(queueAfterRename.name, 'pppoe-juan2')
    assert.equal(queueAfterRename.target, `${originalIp}/32`)

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
    const queueAfterPlan = (await client.print('queue/simple'))[0]
    assert.equal(queueAfterPlan['max-limit'], '8M/16M')
    assert.equal(queueAfterPlan.target, `${originalIp}/32`)
    assert.equal((await client.print('ppp/secret'))[0]['remote-address'], originalIp)

    await removePppoeClient(client, renamed[0].rosId, 'juan2')
    assert.equal((await listPppoeClients(client, [])).length, 0)
    assert.equal((await client.print('queue/simple')).length, 0)
  })

  it('al editar se puede cambiar la IP remota y el simplequeue sigue esa IP', async () => {
    await createPppoeClient(client, routerId, {
      name: 'juan',
      password: 'x',
      planName: '10/20',
      comment: ''
    })
    const rosId = (await listPppoeClients(client, []))[0].rosId
    await updatePppoeClient(client, routerId, rosId, 'juan', {
      name: 'juan',
      password: 'x',
      planName: '10/20',
      comment: '',
      remoteAddress: '10.10.10.80'
    })
    assert.equal((await client.print('ppp/secret'))[0]['remote-address'], '10.10.10.80')
    assert.equal((await client.print('queue/simple'))[0].target, '10.10.10.80/32')
  })

  it('si el perfil default no tiene IPs, pone local de la LAN y remote estático, sin pool', async () => {
    client = new FakeClient()
    await client.add('ppp/profile', { name: 'default' })
    await client.add('ip/address', { address: '192.168.88.1/24', interface: 'bridge' })

    await createPppoeClient(client, routerId, {
      name: 'luis',
      password: 'x',
      planName: '10/20',
      comment: ''
    })

    const secrets = await client.print('ppp/secret')
    assert.equal(secrets.length, 1)
    assert.equal(secrets[0]['local-address'], '192.168.88.1')
    assert.equal(secrets[0]['remote-address'], '192.168.88.2')
    assert.notEqual(secrets[0]['remote-address'], 'pppoe-pool')

    const pools = await client.print('ip/pool')
    assert.equal(pools.length, 0)

    const profile = (await client.print('ppp/profile', { name: 'default' }))[0]
    assert.equal(profile['local-address'], '192.168.88.1')
    assert.notEqual(profile['remote-address'], 'pppoe-pool')

    const queues = await client.print('queue/simple')
    assert.equal(queues[0]['max-limit'], '10M/20M')
    assert.equal(queues[0].target, '192.168.88.2/32')
  })

  it('si un secret viejo tenía pool, editar el plan le asigna IP estática y target /32', async () => {
    await client.add('ppp/secret', {
      name: 'viejo',
      password: 'x',
      service: 'pppoe',
      profile: 'default',
      comment: 'plan:10/20',
      'local-address': '10.10.10.1',
      'remote-address': 'pppoe-pool'
    })
    await client.add('queue/simple', {
      name: 'pppoe-viejo',
      target: '<pppoe-viejo>',
      'max-limit': '10M/20M',
      comment: 'pppoe:viejo'
    })
    await syncQueuesForPlan(client, '10/20', {
      name: '10/20',
      uploadMbps: '3',
      downloadMbps: '8',
      price: '',
      notes: ''
    })
    const secret = (await client.print('ppp/secret'))[0]
    assert.equal(secret['remote-address'], '10.10.10.2')
    const queue = (await client.print('queue/simple'))[0]
    assert.equal(queue['max-limit'], '3M/8M')
    assert.equal(queue.target, '10.10.10.2/32')
  })

  it('allocateRemoteAddress rechaza la local-address', async () => {
    await assert.rejects(
      () => allocateRemoteAddress(client, '10.10.10.1', 24, '10.10.10.1'),
      /no puede ser la local-address/
    )
  })

  it('lista megas aunque RouterOS v7 devuelva el max-limit en bits', async () => {
    await createPppoeClient(client, routerId, {
      name: 'bits',
      password: 'x',
      planName: '10/20',
      comment: ''
    })
    const stored = client.tables.get('queue/simple')?.[0]
    assert.ok(stored)
    stored['max-limit'] = '3000000/8000000'
    const listed = await listPppoeClients(client, [])
    assert.equal(listed[0].uploadMbps, '3')
    assert.equal(listed[0].downloadMbps, '8')
    assert.notEqual(`${listed[0].uploadMbps}M/${listed[0].downloadMbps}M`, '3000000M/8000000M')
  })
})
