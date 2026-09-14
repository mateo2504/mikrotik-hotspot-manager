import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { TemplateConfig, TemplateInput } from '../../../shared/types'
import { closeDb, getDb, openMemoryDatabase } from '../database'
import {
  createLocalTemplate,
  createTemplate,
  listTemplates,
  syncPublishedTemplates,
  updateTemplate
} from './templates'
import { TEMPLATE_TAG_RE, makeBatchTag, makeTemplateTag } from '../../services/tags'

function sampleConfig(): TemplateConfig {
  return {
    kind: 'thermal',
    page: 'A4',
    cols: 1,
    rows: 1,
    thermalWidth: 58,
    paddingMm: 2,
    bgMode: 'stretch',
    fields: []
  }
}

function input(name: string, extra?: Partial<TemplateConfig>): TemplateInput {
  return {
    name,
    kind: 'thermal',
    config: { ...sampleConfig(), ...extra },
    bgImagePath: null
  }
}

function insertRouter(name: string): number {
  const res = getDb()
    .prepare(`INSERT INTO routers (name, host, username, password_enc) VALUES (?, ?, ?, ?)`)
    .run(name, '10.0.0.1', 'admin', Buffer.from('x'))
  return Number(res.lastInsertRowid)
}

describe('tags de versión', () => {
  it('usa el mismo modelo fechado que los lotes', () => {
    const now = new Date(2026, 8, 14)
    assert.match(makeBatchTag(now), /^B-20260914-[A-HJ-NP-Z]{4}$/)
    assert.match(makeTemplateTag(now), TEMPLATE_TAG_RE)
    assert.equal(makeTemplateTag(now).startsWith('plantilla:T-20260914-'), true)
  })
})

describe('publicación de plantillas', () => {
  beforeEach(() => {
    openMemoryDatabase()
  })

  afterEach(() => {
    closeDb()
  })

  it('al crear, publica versión 1 con tag en todos los equipos', () => {
    const a = insertRouter('Equipo A')
    const b = insertRouter('Equipo B')

    const created = createTemplate(a, input('Ficha custom'))
    assert.equal(created.version, 1)
    assert.equal(created.published, true)
    assert.match(created.tag, TEMPLATE_TAG_RE)

    const onB = listTemplates(b)
    assert.equal(onB.length, 1)
    assert.equal(onB[0].name, 'Ficha custom')
    assert.equal(onB[0].version, 1)
    assert.equal(onB[0].tag, created.tag)
    assert.equal(onB[0].sharedKey, created.sharedKey)
  })

  it('al editar, crea una nueva versión y tag y la replica', () => {
    const a = insertRouter('Equipo A')
    const b = insertRouter('Equipo B')
    const created = createTemplate(a, input('Ficha custom', { thermalWidth: 58 }))
    const firstTag = created.tag

    const updated = updateTemplate(a, created.id, input('Ficha custom', { thermalWidth: 80 }))
    assert.equal(updated.version, 2)
    assert.notEqual(updated.tag, firstTag)
    assert.match(updated.tag, TEMPLATE_TAG_RE)
    assert.equal(updated.config.thermalWidth, 80)

    const onB = listTemplates(b)
    assert.equal(onB.length, 1)
    assert.equal(onB[0].version, 2)
    assert.equal(onB[0].tag, updated.tag)
    assert.equal(onB[0].config.thermalWidth, 80)
  })

  it('al conectar, un equipo nuevo recibe la última versión publicada', () => {
    const a = insertRouter('Equipo A')
    const created = createTemplate(a, input('Ficha custom', { thermalWidth: 58 }))
    updateTemplate(a, created.id, input('Ficha custom', { thermalWidth: 80 }))

    const c = insertRouter('Equipo C')
    assert.equal(listTemplates(c).length, 0)

    syncPublishedTemplates(c)

    const onC = listTemplates(c)
    assert.equal(onC.length, 1)
    assert.equal(onC[0].name, 'Ficha custom')
    assert.equal(onC[0].version, 2)
    assert.equal(onC[0].config.thermalWidth, 80)
    assert.equal(onC[0].published, true)
  })

  it('las plantillas locales de fábrica no se publican hasta crear o editar', () => {
    const a = insertRouter('Equipo A')
    const b = insertRouter('Equipo B')
    createLocalTemplate(a, input('A4 — 2 x 5 fichas'))

    assert.equal(listTemplates(a).length, 1)
    assert.equal(listTemplates(a)[0].published, false)
    assert.equal(listTemplates(b).length, 0)

    syncPublishedTemplates(b)
    assert.equal(listTemplates(b).length, 0)
  })
})
