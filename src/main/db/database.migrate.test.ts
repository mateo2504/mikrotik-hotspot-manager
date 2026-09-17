import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { closeDb, MIGRATIONS, migrate, setDb } from './database'

describe('migración al arrancar', () => {
  afterEach(() => {
    closeDb()
  })

  it('pasa de user_version 5 (1.0.7) a 6 y deja usar pppoe_plans', () => {
    const d = new Database(':memory:')
    d.pragma('foreign_keys = ON')
    for (let v = 0; v < 5; v++) {
      d.exec(MIGRATIONS[v])
    }
    d.pragma('user_version = 5')
    assert.equal(d.pragma('user_version', { simple: true }), 5)

    migrate(d)
    setDb(d)

    assert.equal(d.pragma('user_version', { simple: true }), 6)
    const inserted = d
      .prepare(`INSERT INTO routers (name, host, username, password_enc) VALUES (?, ?, ?, ?)`)
      .run('Equipo', '10.0.0.1', 'admin', Buffer.from('x'))
    const routerId = Number(inserted.lastInsertRowid)
    d.prepare(
      `INSERT INTO pppoe_plans (router_id, name, upload_mbps, download_mbps, price, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(routerId, '10/20', '10', '20', '', '')
    const row = d.prepare('SELECT name FROM pppoe_plans WHERE router_id = ?').get(routerId) as {
      name: string
    }
    assert.equal(row.name, '10/20')
  })
})
