import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { closeDb, getDb, openMemoryDatabase } from '../database'
import {
  deletePppoePlan,
  getPppoePlan,
  listPppoePlans,
  renamePppoePlan,
  upsertPppoePlan
} from './pppoePlans'

function insertRouter(name: string): number {
  const res = getDb()
    .prepare(`INSERT INTO routers (name, host, username, password_enc) VALUES (?, ?, ?, ?)`)
    .run(name, '10.0.0.1', 'admin', Buffer.from('x'))
  return Number(res.lastInsertRowid)
}

describe('planes PPPoE', () => {
  beforeEach(() => {
    openMemoryDatabase()
  })

  afterEach(() => {
    closeDb()
  })

  it('crea, lista, edita y elimina por router', () => {
    const a = insertRouter('Equipo A')
    const b = insertRouter('Equipo B')

    upsertPppoePlan(a, {
      name: '10/20',
      uploadMbps: '10',
      downloadMbps: '20',
      price: '$200',
      notes: ''
    })
    upsertPppoePlan(b, {
      name: '10/20',
      uploadMbps: '5',
      downloadMbps: '5',
      price: '',
      notes: ''
    })

    assert.equal(listPppoePlans(a).length, 1)
    assert.equal(listPppoePlans(a)[0].downloadMbps, '20')
    assert.equal(listPppoePlans(b)[0].uploadMbps, '5')

    upsertPppoePlan(a, {
      name: '10/20',
      uploadMbps: '15',
      downloadMbps: '30',
      price: '$250',
      notes: ''
    })
    assert.equal(getPppoePlan(a, '10/20')?.uploadMbps, '15')

    renamePppoePlan(a, '10/20', 'Residencial')
    assert.equal(getPppoePlan(a, '10/20'), null)
    assert.equal(getPppoePlan(a, 'Residencial')?.downloadMbps, '30')

    deletePppoePlan(a, 'Residencial')
    assert.equal(listPppoePlans(a).length, 0)
    assert.equal(listPppoePlans(b).length, 1)
  })
})
